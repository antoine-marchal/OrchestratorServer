import { Node } from 'reactflow';
import { FlowState, Session } from '../types';
import { pathUtils } from '../../utils/pathUtils';

/**
 * File operations for saving and loading flows
 */

type SessionStoreGetter = () => {
  getActiveFlowState: () => FlowState | null;
  updateActiveFlowState: (updates: Partial<FlowState>) => void;
  getActiveSession: () => Session | null;
  createSession: (name?: string) => Promise<string>;
};

/**
 * Save flow to file
 */
export async function saveFlow(sessionStore: SessionStoreGetter): Promise<void> {
  const activeFlowState = sessionStore().getActiveFlowState();
  if (!activeFlowState) return;

  // Create a deep copy of nodes to avoid modifying the original nodes
  let nodesToSave = JSON.parse(JSON.stringify(activeFlowState.nodes));

  // If we have a flow path, convert all flow node paths to relative paths
  // and save code to separate files
  if (activeFlowState.flowPath) {
    // Create a folder with the same name as the .or file (without extension)
    const flowFileName = activeFlowState.flowPath.split(/[\\/]/).pop() || 'flow';
    const flowFolderName = flowFileName.replace(/\.or$/, '');

    // Process each node
    nodesToSave = await Promise.all(nodesToSave.map(async (node: Node) => {
      // Preserve the dontWaitForOutput property when saving
      if (node.data.dontWaitForOutput) {
        node.data.dontWaitForOutput = true;
      }

      // Handle flow nodes (convert paths to relative)
      if (node.data.type === 'flow' && node.data.code) {
        // Check if the path is absolute (regardless of isRelativePath flag)
        const isAbsolutePath = pathUtils.isAbsolute(node.data.code);

        // Convert absolute paths to relative paths
        if (isAbsolutePath) {
          // Convert absolute path to relative path
          let relativePath;
          const baseDir = pathUtils.dirname(activeFlowState.flowPath || '');
          relativePath = pathUtils.relative(baseDir, node.data.code);

          return {
            ...node,
            data: {
              ...node.data,
              code: relativePath,
              isRelativePath: true
            }
          };
        } else if (!node.data.isRelativePath) {
          // If it's not an absolute path but not marked as relative,
          // mark it as relative for consistency
          return {
            ...node,
            data: {
              ...node.data,
              isRelativePath: true
            }
          };
        }
      }

      return node;
    }));
  }

  const flow = { nodes: nodesToSave, edges: activeFlowState.edges };
  const flowJson = JSON.stringify(flow, null, 2);

  // Get the current session name for the suggested filename
  const activeSession = sessionStore().getActiveSession();
  const suggestedFilename = activeSession ? `${activeSession.name}.or` : 'flow.or';

  try {
    // Use browser download as fallback
    const blob = new Blob([flowJson], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = suggestedFilename;
    a.click();
    URL.revokeObjectURL(url);
  } catch (error) {
    console.error('Error saving flow:', error);
    alert(`Error saving flow: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Load flow from file
 */
export async function loadFlow(sessionStore: SessionStoreGetter): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    // Create a file input element
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.or';
    input.style.display = 'none';

    input.onchange = async (event) => {
      const file = (event.target as HTMLInputElement).files?.[0];
      if (!file) {
        resolve(); // User cancelled
        return;
      }

      // Validate file extension
      if (!file.name.toLowerCase().endsWith('.or')) {
        alert('Please select a valid .or file');
        resolve();
        return;
      }

      try {
        const text = await file.text();
        const flowData = JSON.parse(text);

        // Validate JSON structure
        if (!flowData || typeof flowData !== 'object') {
          throw new Error('Invalid flow file format');
        }

        if (!Array.isArray(flowData.nodes) || !Array.isArray(flowData.edges)) {
          throw new Error('Flow file must contain nodes and edges arrays');
        }

        // Process nodes - flow nodes already have their content in the code field
        const processedNodes = flowData.nodes;

        // Create a new session FIRST with the file name (without .or extension)
        // createSession switches to the new session automatically
        const sessionName = file.name.replace(/\.or$/i, '');
        await sessionStore().createSession(sessionName);

        // Now load the flow data into the NEW active session
        sessionStore().updateActiveFlowState({
          nodes: processedNodes,
          edges: flowData.edges,
          flowPath: file.name,
          history: [],
          historyIndex: -1
        });

        resolve();
      } catch (error) {
        console.error('Error loading flow:', error);
        alert(`Error loading flow: ${error instanceof Error ? error.message : String(error)}`);
        resolve();
      }
    };

    // Handle cancellation
    input.oncancel = () => {
      resolve();
    };

    // Trigger file selection
    document.body.appendChild(input);
    input.click();
    document.body.removeChild(input);
  });
}
