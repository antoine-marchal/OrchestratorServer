import { Node, Edge } from 'reactflow';
import { useSessionStore } from './sessionStore';
import { pathUtils } from '../utils/pathUtils';
import { apiClient } from '../utils/apiClient';

function prettyFormat(val: any): string {
  if (val == null) return '';
  if (typeof val === 'object') {
    try {
      return JSON.stringify(val, null, 2);
    } catch {
      return String(val);
    }
  }
  if (typeof val === 'string') {
    // Try to pretty-print if string looks like JSON
    try {
      const parsed = JSON.parse(val);
      return JSON.stringify(parsed, null, 2);
    } catch {
      return val;
    }
  }
  return String(val);
}

// Re-export the FlowState interface from sessionStore
export interface FlowState {
  nodes: Node[];
  edges: Edge[];
  nodeLoading: { [key: string]: boolean };
  panOnDrag: boolean;
  zoomOnScroll: boolean;
  consoleMessages: ConsoleMessage[];
  showConsole: boolean;
  fullscreen: boolean;
  nodeExecutionTimeout: number;
  isOutputZoneActive: boolean;
  isTitleEditing: boolean;
  isMouseOverConsole: boolean;
  editorModal: {
    isOpen: boolean;
    nodeId: string | null;
  };
  flowPath?: string | null;
  history: Array<{ nodes: Node[]; edges: Edge[] }>;
  historyIndex: number;
  maxHistorySize: number;
  starterNodeId: string | null;
  stoppingNodes: Set<string>;
  outputClearCounter: number;
}

interface ConsoleMessage {
  nodeId: string;
  type: 'input' | 'output' | 'error' | 'log';
  message: string;
  timestamp: number;
}

interface FlowStoreInterface {
  nodes: Node[];
  edges: Edge[];
  nodeLoading: { [key: string]: boolean };
  panOnDrag: boolean;
  zoomOnScroll: boolean;
  consoleMessages: ConsoleMessage[];
  showConsole: boolean;
  fullscreen: boolean;
  nodeExecutionTimeout: number;
  isOutputZoneActive: boolean;
  isTitleEditing: boolean;
  isMouseOverConsole: boolean;
  editorModal: {
    isOpen: boolean;
    nodeId: string | null;
  };
  flowPath?: string | null;
  history: Array<{ nodes: Node[]; edges: Edge[] }>;
  historyIndex: number;
  maxHistorySize: number;
  starterNodeId: string | null;
  stoppingNodes: Set<string>;
  outputClearCounter: number;
  setFlowPath: (path: string | null) => void;
  setNodeExecutionTimeout: (timeout: number) => void;
  convertToRelativePath: (absolutePath: string, basePath: string) => string;
  convertToAbsolutePath: (relativePath: string, basePath: string) => string;
  setOutputZoneActive: (active: boolean) => void;
  setTitleEditing: (editing: boolean) => void;
  setMouseOverConsole: (isOver: boolean) => void;
  setStarterNode: (nodeId: string) => void;
  updateNodeDraggable: (nodeId: string, isDraggable: boolean) => void;
  updatePanOnDrag: (isDraggable: boolean) => void;
  updateZoomOnScroll: (isDraggable: boolean) => void;
  setNodes: (nodes: Node[] | ((nodes: Node[]) => Node[])) => void;
  setEdges: (edges: Edge[] | ((edges: Edge[]) => Edge[])) => void;
  addNode: (node: Node) => void;
  removeNode: (nodeId: string) => void;
  updateNodeData: (nodeId: string, data: any, addHistory?: boolean) => void;
  updateCodeFilePath: (nodeId: string, label: string) => void;
  toggleDontWaitForOutput: (nodeId: string) => void;
  toggleConsole: () => void;
  setFullscreen: () => void;
  addConsoleMessage: (message: ConsoleMessage) => void;
  clearConsole: () => void;
  clearFlow: () => void;
  executeNode: (nodeId: string, isStopAction?: boolean) => void;
  stopNodeExecution: (nodeId: string) => void;
  executeFlow: () => void;
  stopFlow: () => void;
  saveFlow: () => void;
  loadFlow: () => void;
  removeConnection: (edgeId: string) => void;
  moveConnection: (nodeId: string, type: 'input' | 'output', edgeId: string, direction: 'up' | 'down') => void;
  openEditorModal: (nodeId: string) => void;
  closeEditorModal: () => void;
  setNodeLoading: (nodeId: string, loading: boolean) => void;
  clearAllOutputs: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;
  undo: () => void;
  redo: () => void;
  addToHistory: () => void;
  copySelectedNodes: (nodeIds: string[]) => void;
  pasteNodes: () => void;
  getClipboardNodes: () => Node[] | null;
  clearNodeSelection: (nodes: Node[]) => void;
}

// Custom hook that provides the flow store interface using session store
export const useFlowStore = (): FlowStoreInterface => {
  const sessionStore = useSessionStore();
  const activeFlowState = sessionStore.getActiveFlowState();

  // If no active session, return default values
  if (!activeFlowState) {
    return {
      nodes: [],
      edges: [],
      nodeLoading: {},
      panOnDrag: true,
      zoomOnScroll: true,
      consoleMessages: [],
      showConsole: false,
      fullscreen: false,
      nodeExecutionTimeout: Infinity,
      isOutputZoneActive: false,
      isTitleEditing: false,
      isMouseOverConsole: false,
      editorModal: { isOpen: false, nodeId: null },
      flowPath: null,
      history: [],
      historyIndex: -1,
      maxHistorySize: 10,
      starterNodeId: null,
      stoppingNodes: new Set<string>(),
      outputClearCounter: 0,
      setFlowPath: () => {},
      setNodeExecutionTimeout: () => {},
      convertToRelativePath: () => '',
      convertToAbsolutePath: () => '',
      setOutputZoneActive: () => {},
      setTitleEditing: () => {},
      setMouseOverConsole: () => {},
      setStarterNode: () => {},
      updateNodeDraggable: () => {},
      updatePanOnDrag: () => {},
      updateZoomOnScroll: () => {},
      setNodes: () => {},
      setEdges: () => {},
      addNode: () => {},
      removeNode: () => {},
      updateNodeData: () => {},
      updateCodeFilePath: () => {},
      toggleDontWaitForOutput: () => {},
      toggleConsole: () => {},
      setFullscreen: () => {},
      addConsoleMessage: () => {},
      clearConsole: () => {},
      clearFlow: () => {},
      executeNode: () => {},
      stopNodeExecution: () => {},
      executeFlow: () => {},
      stopFlow: () => {},
      saveFlow: () => {},
      loadFlow: () => {},
      removeConnection: () => {},
      moveConnection: () => {},
      openEditorModal: () => {},
      closeEditorModal: () => {},
      setNodeLoading: () => {},
      clearAllOutputs: () => {},
      canUndo: () => false,
      canRedo: () => false,
      undo: () => {},
      redo: () => {},
      addToHistory: () => {},
      copySelectedNodes: () => {},
      pasteNodes: () => {},
      getClipboardNodes: () => null,
      clearNodeSelection: () => {},
    };
  }

  // Helper function to update flow state
  const updateFlowState = (updates: Partial<FlowState>) => {
    sessionStore.updateActiveFlowState(updates);
  };

  // Internal executeNode function that can be called from executeFlow
  const internalExecuteNode = async (nodeId: string, fromFlowExecution = false) => {
    let activeFlowState = sessionStore.getActiveFlowState();
    if (!activeFlowState) return;

    // Check if the node is already executing
    if (activeFlowState.nodeLoading[nodeId]) {
      // Node is already running, show a message in the console
      updateFlowState({
        consoleMessages: [...activeFlowState.consoleMessages, {
          nodeId,
          type: 'error',
          message: `Cannot execute node: already running`,
          timestamp: Date.now(),
        }],
      });
      return;
    }

    updateFlowState({ nodeLoading: { ...activeFlowState.nodeLoading, [nodeId]: true } });
    const node = activeFlowState.nodes.find((n) => n.id === nodeId);
    if (!node) return;

    // We don't clear previous output anymore to preserve it during execution
    // The output will be updated with new results when execution completes

    const addLog = (type: ConsoleMessage['type'], message: string) => {
      activeFlowState = sessionStore.getActiveFlowState()!;
      updateFlowState({
        consoleMessages: [...activeFlowState.consoleMessages, {
          nodeId,
          type,
          message,
          timestamp: Date.now(),
        }],
      });
    };

    // If this node has dontWaitForOutput set, log it
    if (node.data.dontWaitForOutput) {
      addLog('log', 'Node is set to not wait for output - execution will continue in parallel');
      addLog('log', 'This node will run indefinitely until manually stopped');
    }

    try {
      let result: any, log: any, error: any;
      if (node.data.type === 'goto') {
        // When executing individually, goto nodes just pass through their input
        // They don't evaluate conditions or forward input
        activeFlowState = sessionStore.getActiveFlowState()!;
        const inEdges = activeFlowState.edges.filter(e => e.target === nodeId);
        const inputNodes = inEdges
          .map(e => {
            activeFlowState = sessionStore.getActiveFlowState()!;
            return activeFlowState.nodes.find(n => n.id === e.source);
          })
          .filter((n): n is Node => n !== undefined);
        const inputs = await Promise.all(inputNodes.map(n => n.data.type === 'constant' ? n.data.value : n.data.output));
        const processedInputs = inputs.length === 1 ? inputs[0] : inputs;
        
        updateFlowState({
          nodes: activeFlowState.nodes.map(n =>
            n.id === nodeId ? { ...n, data: { ...n.data, output: processedInputs, gotoDecision: null } } : n
          ),
        });
        updateFlowState({ nodeLoading: { ...activeFlowState.nodeLoading, [nodeId]: false } });
        return;
      } else if (node.data.type === 'constant') {
        result = node.data.value;
      } else if (node.data.type === 'flow') {
        // For flow nodes, we execute the referenced flow file using the backend poller
        try {
          // Start execution time tracking
          const startTime = Date.now();

          // Get the flow file path - use absolutePath if available, otherwise use code
          let flowPath = node.data.absolutePath || node.data.code;
          if (!flowPath) {
            throw new Error('No flow file specified');
          }


          // Find input nodes and sort them by connection order
          activeFlowState = sessionStore.getActiveFlowState()!;
          const inputEdges = activeFlowState.edges.filter(e => e.target === nodeId);
          const inputNodes = inputEdges
            .map(e => {
              activeFlowState = sessionStore.getActiveFlowState()!;
              return activeFlowState.nodes.find(n => n.id === e.source);
            })
            .filter((n): n is Node => n !== undefined);

          // Get input values from connected nodes
          const inputs = await Promise.all(inputNodes.map(async (inputNode) => {
            if (inputNode.data.type === 'constant') {
              return inputNode.data.value;
            }
            return inputNode.data.output;
          }));

          // When executing individually, always use predecessor outputs, never injected input
          const processedInputs = inputs.length === 1 ? inputs[0] : inputs;
          if (inputs.length > 0) addLog('input', prettyFormat(processedInputs));

          // Create a payload for the backend poller
          const payload = {
            id: 'job-' + Date.now() + '-' + Math.random().toString(36).slice(2),
            code: flowPath,
            type: 'flow',
            input: processedInputs,
            timeout: activeFlowState.nodeExecutionTimeout,
            // Pass the directory of the flow file as the base path for resolving nested flows
            basePath: pathUtils.dirname(flowPath),
            // Store the flow file path for reference
            flowFilePath: flowPath
          };

          addLog('log', `Executing flow: ${flowPath}`);

          // Submit job via HTTP API
          const jobRequest = {
            type: 'flow',
            code: flowPath,
            input: processedInputs,
            timeout: activeFlowState.nodeExecutionTimeout,
            basePath: pathUtils.dirname(flowPath),
          };

          try {
            const { jobId } = await apiClient.submitJob(jobRequest);

            // Poll for job completion
            const jobResult = await apiClient.pollJobStatus(jobId, (status) => {
              // Optional: handle progress updates if needed
              if (status.progress !== undefined) {
                addLog('log', `Flow execution progress: ${status.progress}%`);
              }
            });

            // Process the result from the flow execution
            result = jobResult.output;

            // Process logs from nested flow execution
            log = jobResult.log;

            // If we have logs from nested flow execution, process them to display properly
            if (log && typeof log === 'string' && log.includes('[Nested]')) {
              // Split the log by lines to process each nested log entry
              const logLines = log.split('\n');

              // Process each line of the log
              logLines.forEach(line => {
                if (line.includes('[Nested]')) {
                  // Extract the nested log message
                  const nestedLogMessage = line.substring(line.indexOf('[Nested]') + 9).trim();

                  // Determine if it's an error or regular log
                  if (nestedLogMessage.startsWith('ERROR:')) {
                    // It's an error log from a nested node
                    const errorMessage = nestedLogMessage.substring(7).trim();
                    addLog('error', `Nested: ${errorMessage}`);
                  } else {
                    // It's a regular log from a nested node
                    addLog('log', `Nested: ${nestedLogMessage}`);
                  }
                }
              });
            }

            error = jobResult.error;

            // Calculate execution time - use the one from backend if available, otherwise calculate locally
            const executionTime = jobResult.executionTime || (Date.now() - startTime);

            // Store execution time in node data
            node.data.executionTime = executionTime;

            // Ensure the node data is updated with the nested flow execution result
            updateFlowState({
              nodes: activeFlowState.nodes.map(n =>
                n.id === nodeId ? { ...n, data: { ...n.data, output: result, executionTime } } : n
              ),
            });
          } catch (err) {
            error = (err as Error).message;
          }
        } catch (err) {
          error = (err as Error).message;
        }
      } else {
        // Find input nodes and sort them by connection order
        activeFlowState = sessionStore.getActiveFlowState()!;
        const inputEdges = activeFlowState.edges.filter(e => e.target === nodeId);
        const inputNodes = inputEdges
          .map(e => {
            activeFlowState = sessionStore.getActiveFlowState()!;
            return activeFlowState.nodes.find(n => n.id === e.source);
          })
          .filter((n): n is Node => n !== undefined);

        // Check for injected input ONLY when called from flow execution
        let processedInputs: any;
        const injected = fromFlowExecution ? (node.data as any)?._injectedInput : undefined;
        
        if (typeof injected !== 'undefined') {
          processedInputs = injected;
          addLog('input', prettyFormat(processedInputs));
          // clear it so it's single-use
          activeFlowState = sessionStore.getActiveFlowState()!;
          updateFlowState({
            nodes: activeFlowState.nodes.map(n =>
              n.id === nodeId ? { ...n, data: { ...n.data, _injectedInput: undefined } } : n
            ),
          });
        } else {
          const inputs = await Promise.all(inputNodes.map(async (inputNode) => {
            if (inputNode.data.type === 'constant') return inputNode.data.value;
            return inputNode.data.output;
          }));
          processedInputs = inputs.length === 1 ? inputs[0] : inputs;
          if (inputs.length > 0) addLog('input', prettyFormat(processedInputs));
        }

        const originalConsoleLog = console.log;
        let code = node.data.code?.trim() || '';
        // TODO: Replace with browser API for file operations
        /*
        if (node.data.codeFilePath && window.electronAPI?.readTextFile) {
          try {
            const flowPath = activeFlowState.flowPath || ''; // fallback if no master flowPath available
            const codeFilePath = pathUtils.isAbsolute(node.data.codeFilePath)
              ? node.data.codeFilePath
              : pathUtils.join(pathUtils.dirname(flowPath), node.data.codeFilePath);

            code = await window.electronAPI.readTextFile(codeFilePath);
            // Optionally update the node state so the editor reflects the loaded code
            updateFlowState({
              nodes: activeFlowState.nodes.map(n =>
                n.id === nodeId ? { ...n, data: { ...n.data, code } } : n
              ),
            });
            node.data.code = code;
          } catch (err) {
            addLog('error', `Failed to load code from file: ${node.data.codeFilePath}`);
            code = '';
          }
        }
        */
        // --- NEW: Run JS directly if language is javascript ---
        if (node.data.language === 'javascript') {
          try {
            // Start execution time tracking
            const startTime = Date.now();

            // Generate a job ID for this execution
            const jobId = 'job-' + Date.now() + '-' + Math.random().toString(36).slice(2);

            // Store the job ID in the node data for potential termination
            updateFlowState({
              nodes: activeFlowState.nodes.map(n =>
                n.id === nodeId ? { ...n, data: { ...n.data, jobId } } : n
              ),
            });

            let code = node.data.code?.trim() || '';
            let fn;
            if (/^function\s*\w*\s*\(/.test(code)) {
              fn = new Function(`${code}; return process(arguments[0]);`);
            } else {
              fn = new Function('input', code.includes('return') ? code : `return (${code})`);
            }
            const logBuffer: any[] = [];
            console.log = (...args) => {
              args.forEach(arg => addLog('log', prettyFormat(arg)));
              logBuffer.push(args);
            };
            result = fn(processedInputs);
            console.log = originalConsoleLog;

            // Calculate execution time
            const executionTime = Date.now() - startTime;

            // Store execution time in node data
            // We'll update the execution time when we update the output
            node.data.executionTime = executionTime;
          } catch (err) {
            console.log = originalConsoleLog;
            error = (err as Error).message;
          }
        }
        else {
          // --- FALLBACK: Use backend for Groovy/Batch etc ---
          if (node.data.code) {
            // Start execution time tracking

            const startTime = Date.now();

            let codeFilePath = node.data.codeFilePath;
            const flowPath = activeFlowState.flowPath;
            const basePath = flowPath ? pathUtils.dirname(flowPath) : undefined;
            if (codeFilePath) {
              if (!pathUtils.isAbsolute(codeFilePath) && flowPath) {
                codeFilePath = pathUtils.join(pathUtils.dirname(flowPath), codeFilePath);
              }
            }

            // Submit job via HTTP API
            const jobRequest = {
              type: node.data.type,
              code: node.data.code,
              codeFilePath: codeFilePath,
              input: processedInputs,
              timeout: activeFlowState.nodeExecutionTimeout,
              dontWaitForOutput: node.data.dontWaitForOutput,
              basePath: basePath,
            };

            const { jobId } = await apiClient.submitJob(jobRequest);

            // Store the job ID in the node data for potential termination
            updateFlowState({
              nodes: activeFlowState.nodes.map(n =>
                n.id === nodeId ? { ...n, data: { ...n.data, jobId } } : n
              ),
            });

            // For dontWaitForOutput nodes, we don't wait for completion
            if (node.data.dontWaitForOutput) {
              // Keep the node in loading state and store jobId for stopping
              return;
            }

            // Poll for job completion
            const jobResult = await apiClient.pollJobStatus(jobId, (status) => {
              // Optional: handle progress updates if needed
              if (status.progress !== undefined) {
                addLog('log', `Execution progress: ${status.progress}%`);
              }
            });

            result = jobResult.output !== '[]' ? jobResult.output : null;
            log = jobResult.log;
            error = jobResult.error;

            // Calculate execution time
            const executionTime = jobResult.executionTime || (Date.now() - startTime);

            // Store execution time in node data
            node.data.executionTime = executionTime;
          }
        }
      }

      // Only set loading to false if this is not a dontWaitForOutput node
      // or if it's a dontWaitForOutput node that has actually completed
      if (!(node.data.dontWaitForOutput && result?.dontWaitForOutput)) {
        updateFlowState({ nodeLoading: { ...activeFlowState.nodeLoading, [nodeId]: false } });
      }
      if (log) addLog('log', prettyFormat(log));
      if (result !== undefined && result !== null && typeof result === 'object' && 'output' in result) addLog('output', prettyFormat(result.output));
      else if (result !== undefined && result !== null) addLog('output', prettyFormat(result));
      if (error) addLog('error', prettyFormat(error));

      // For nodes with dontWaitForOutput, we need to keep the jobId
      // so that the node can be stopped later
      if (node.data.dontWaitForOutput && result?.dontWaitForOutput) {
        // Only update the output, keep the jobId
        updateFlowState({
          nodes: activeFlowState.nodes.map(n =>
            n.id === nodeId ? { ...n, data: { ...n.data, output: result } } : n
          ),
        });
      } else {
        // For regular nodes, update node data with result and clear jobId
        updateFlowState({
          nodes: activeFlowState.nodes.map(n =>
            n.id === nodeId ? { ...n, data: { ...n.data, output: result, jobId: undefined } } : n
          ),
        });
      }
    } catch (error: any) {
      addLog('error', `Error: ${error instanceof Error ? error.message : String(error)}`);
      updateFlowState({ nodeLoading: { ...activeFlowState.nodeLoading, [nodeId]: false } });

      // Clear the job ID when an error occurs
      updateFlowState({
        nodes: activeFlowState.nodes.map(n =>
          n.id === nodeId ? { ...n, data: { ...n.data, jobId: undefined } } : n
        ),
      });
    }
  };

  return {
    // State getters
    nodes: activeFlowState.nodes,
    edges: activeFlowState.edges,
    nodeLoading: activeFlowState.nodeLoading,
    panOnDrag: activeFlowState.panOnDrag,
    zoomOnScroll: activeFlowState.zoomOnScroll,
    consoleMessages: activeFlowState.consoleMessages,
    showConsole: activeFlowState.showConsole,
    fullscreen: activeFlowState.fullscreen,
    nodeExecutionTimeout: activeFlowState.nodeExecutionTimeout,
    isOutputZoneActive: activeFlowState.isOutputZoneActive,
    isTitleEditing: activeFlowState.isTitleEditing,
    isMouseOverConsole: activeFlowState.isMouseOverConsole,
    editorModal: activeFlowState.editorModal,
    flowPath: activeFlowState.flowPath,
    history: activeFlowState.history,
    historyIndex: activeFlowState.historyIndex,
    maxHistorySize: activeFlowState.maxHistorySize,
    starterNodeId: activeFlowState.starterNodeId,
    stoppingNodes: activeFlowState.stoppingNodes,
    outputClearCounter: activeFlowState.outputClearCounter,

    // Methods
    setFlowPath: (path: string | null) => updateFlowState({ flowPath: path }),
    setNodeExecutionTimeout: (timeout: number) => updateFlowState({ nodeExecutionTimeout: timeout }),
    convertToRelativePath: pathUtils.relative,
    convertToAbsolutePath: pathUtils.resolve,
    setOutputZoneActive: (active: boolean) => {
      if (activeFlowState.isOutputZoneActive !== active) {
        updateFlowState({ isOutputZoneActive: active });
      }
    },
    setTitleEditing: (editing: boolean) => updateFlowState({ isTitleEditing: editing }),
    setMouseOverConsole: (isOver: boolean) => updateFlowState({ isMouseOverConsole: isOver }),

    setStarterNode: (nodeId: string) => {
      const nodes = activeFlowState.nodes;
      const starterNodeId = activeFlowState.starterNodeId;

      // Add current state to history before making changes
      const currentState = {
        nodes: nodes.map(node => ({ ...node })),
        edges: activeFlowState.edges.map(edge => ({ ...edge }))
      };
      const newHistory = activeFlowState.historyIndex < activeFlowState.history.length - 1
        ? activeFlowState.history.slice(0, activeFlowState.historyIndex + 1)
        : [...activeFlowState.history];
      newHistory.push(currentState);
      if (newHistory.length > activeFlowState.maxHistorySize) {
        newHistory.shift();
      }

      // If the clicked node is already the starter, unset it
      if (starterNodeId === nodeId) {
        updateFlowState({
          starterNodeId: null,
          nodes: nodes.map((node) => ({
            ...node,
            data: {
              ...node.data,
              isStarterNode: false
            }
          })),
          history: newHistory,
          historyIndex: newHistory.length - 1
        });
      } else {
        // Set the new starter node
        updateFlowState({
          starterNodeId: nodeId,
          nodes: nodes.map((node) => ({
            ...node,
            data: {
              ...node.data,
              isStarterNode: node.id === nodeId
            }
          })),
          history: newHistory,
          historyIndex: newHistory.length - 1
        });
      }
    },

    toggleDontWaitForOutput: (nodeId: string) => {
      const nodes = activeFlowState.nodes;
      const node = nodes.find(n => n.id === nodeId);

      if (node) {
        // Add current state to history before making changes
        const currentState = {
          nodes: nodes.map(node => ({ ...node })),
          edges: activeFlowState.edges.map(edge => ({ ...edge }))
        };
        const newHistory = activeFlowState.historyIndex < activeFlowState.history.length - 1
          ? activeFlowState.history.slice(0, activeFlowState.historyIndex + 1)
          : [...activeFlowState.history];
        newHistory.push(currentState);
        if (newHistory.length > activeFlowState.maxHistorySize) {
          newHistory.shift();
        }

        updateFlowState({
          nodes: nodes.map((n) =>
            n.id === nodeId ? { ...n, data: { ...n.data, dontWaitForOutput: !n.data.dontWaitForOutput } } : n
          ),
          history: newHistory,
          historyIndex: newHistory.length - 1
        });
      }
    },

    canUndo: () => activeFlowState.historyIndex > 0,
    canRedo: () => activeFlowState.historyIndex < activeFlowState.history.length - 1,

    addToHistory: () => {
      const nodes = activeFlowState.nodes;
      const edges = activeFlowState.edges;
      const currentState = {
        nodes: nodes.map(node => ({ ...node })),
        edges: edges.map(edge => ({ ...edge }))
      };

      const newHistory = activeFlowState.historyIndex < activeFlowState.history.length - 1
        ? activeFlowState.history.slice(0, activeFlowState.historyIndex + 1)
        : [...activeFlowState.history];

      newHistory.push(currentState);

      if (newHistory.length > activeFlowState.maxHistorySize) {
        newHistory.shift();
      }

      updateFlowState({
        history: newHistory,
        historyIndex: newHistory.length - 1
      });
    },

    undo: () => {
      if (activeFlowState.historyIndex > 0) {
        const prevState = activeFlowState.history[activeFlowState.historyIndex - 1];
        updateFlowState({
          nodes: prevState.nodes,
          edges: prevState.edges,
          historyIndex: activeFlowState.historyIndex - 1
        });
      }
    },

    redo: () => {
      if (activeFlowState.historyIndex < activeFlowState.history.length - 1) {
        const nextState = activeFlowState.history[activeFlowState.historyIndex + 1];
        updateFlowState({
          nodes: nextState.nodes,
          edges: nextState.edges,
          historyIndex: activeFlowState.historyIndex + 1
        });
      }
    },

    copySelectedNodes: (nodeIds: string[]) => {
      const nodes = activeFlowState.nodes;
      const edges = activeFlowState.edges;

      const selectedNodes = nodes.filter(node => nodeIds.includes(node.id));
      const selectedEdges = edges.filter(
        edge => nodeIds.includes(edge.source) && nodeIds.includes(edge.target)
      );

      if (selectedNodes.length > 0) {
        const clipboardData = {
          nodes: selectedNodes,
          edges: selectedEdges,
          timestamp: Date.now()
        };
        localStorage.setItem('orchestrator-clipboard', JSON.stringify(clipboardData));
      }
    },

    getClipboardNodes: () => {
      try {
        const clipboardData = localStorage.getItem('orchestrator-clipboard');
        if (!clipboardData) return null;
        return JSON.parse(clipboardData).nodes;
      } catch (error) {
        console.error('Error reading clipboard:', error);
        return null;
      }
    },

    pasteNodes: () => {
      try {
        const clipboardJson = localStorage.getItem('orchestrator-clipboard');
        if (!clipboardJson) return;

        const clipboard = JSON.parse(clipboardJson);
        const nodes = activeFlowState.nodes;
        const edges = activeFlowState.edges;

        const idMapping: Record<string, string> = {};

        const newNodes = clipboard.nodes.map((node: Node) => {
          const newId = `node-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
          idMapping[node.id] = newId;

          const position = {
            x: node.position.x + 150,
            y: node.position.y + 150
          };

          return {
            ...node,
            id: newId,
            position,
            data: {
              ...node.data,
              label: `${node.data.label} (copy)`
            },
            selected: true
          };
        });

        const newEdges = clipboard.edges.map((edge: Edge) => ({
          ...edge,
          id: `e${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
          source: idMapping[edge.source],
          target: idMapping[edge.target]
        }));

        updateFlowState({
          nodes: [...nodes, ...newNodes],
          edges: [...edges, ...newEdges]
        });

        // Add to history
        const currentState = {
          nodes: [...nodes, ...newNodes],
          edges: [...edges, ...newEdges]
        };
        const newHistory = activeFlowState.historyIndex < activeFlowState.history.length - 1
          ? activeFlowState.history.slice(0, activeFlowState.historyIndex + 1)
          : [...activeFlowState.history];
        newHistory.push(currentState);
        if (newHistory.length > activeFlowState.maxHistorySize) {
          newHistory.shift();
        }
        updateFlowState({
          history: newHistory,
          historyIndex: newHistory.length - 1
        });

      } catch (error) {
        console.error('Error pasting nodes:', error);
      }
    },

    clearNodeSelection: (targetedNodes: Node[]) => {
      const targetedIds = new Set(targetedNodes.map(n => n.id));
      updateFlowState({
        nodes: activeFlowState.nodes.map(node => ({
          ...node,
          selected: targetedIds.has(node.id) ? false : node.selected
        }))
      });
    },

    clearFlow: () => {
      updateFlowState({
        nodes: [],
        edges: [],
        flowPath: null,
        history: [],
        historyIndex: -1
      });
    },

    updatePanOnDrag: (isDraggable: boolean) => updateFlowState({ panOnDrag: isDraggable }),
    updateZoomOnScroll: (isDraggable: boolean) => updateFlowState({ zoomOnScroll: isDraggable }),
    setNodeLoading: (nodeId: string, loading: boolean) =>
      updateFlowState({
        nodeLoading: {
          ...activeFlowState.nodeLoading,
          [nodeId]: loading,
        },
      }),
    updateNodeDraggable: (nodeId: string, isDraggable: boolean) => updateFlowState({
      nodes: activeFlowState.nodes.map((node) =>
        node.id === nodeId ? { ...node, draggable: isDraggable } : node
      ),
    }),
    setNodes: (nodes) => {
      const newNodes = typeof nodes === 'function' ? nodes(activeFlowState.nodes) : nodes;
      updateFlowState({ nodes: newNodes });
    },

    setEdges: (edges) => {
      const newEdges = typeof edges === 'function' ? edges(activeFlowState.edges) : edges;
      updateFlowState({ edges: newEdges });
    },

    addNode: (node) => {
      updateFlowState({ nodes: [...activeFlowState.nodes, node] });
    },
    removeNode: (nodeId) => {
      updateFlowState({
        nodes: activeFlowState.nodes.filter(n => n.id !== nodeId),
        edges: activeFlowState.edges.filter(e => e.source !== nodeId && e.target !== nodeId)
      });
    },
    updateNodeData: (nodeId, data, addHistory = true) => {
      if (addHistory) {
        const currentState = {
          nodes: activeFlowState.nodes.map(node => ({ ...node })),
          edges: activeFlowState.edges.map(edge => ({ ...edge }))
        };
        const newHistory = activeFlowState.historyIndex < activeFlowState.history.length - 1
          ? activeFlowState.history.slice(0, activeFlowState.historyIndex + 1)
          : [...activeFlowState.history];
        newHistory.push(currentState);
        if (newHistory.length > activeFlowState.maxHistorySize) {
          newHistory.shift();
        }
        updateFlowState({
          nodes: activeFlowState.nodes.map((node) =>
            node.id === nodeId ? { ...node, data: { ...node.data, ...data } } : node
          ),
          history: newHistory,
          historyIndex: newHistory.length - 1
        });
      } else {
        updateFlowState({
          nodes: activeFlowState.nodes.map((node) =>
            node.id === nodeId ? { ...node, data: { ...node.data, ...data } } : node
          ),
        });
      }
    },
    updateCodeFilePath: (nodeId: string, label: string) => {
      const node = activeFlowState.nodes.find(n => n.id === nodeId);
      if (!node) return;

      const oldFilePath = node.data.codeFilePath;
      if (!oldFilePath) return;

      try {
        const flowPath = activeFlowState.flowPath || '';
        const baseDir = pathUtils.dirname(flowPath || '');
        const oldAbsolutePath = pathUtils.isAbsolute(oldFilePath)
          ? oldFilePath
          : pathUtils.join(baseDir, oldFilePath);

        const extension = oldFilePath.split('.').pop() || 'txt';
        const sanitizedLabel = label.replace(/[^a-zA-Z0-9_\-]/g, '_');
        const newFileName = `${sanitizedLabel}.${extension}`;
        const newRelativePath = pathUtils.join(pathUtils.dirname(oldFilePath), newFileName);

        if (oldAbsolutePath === pathUtils.join(baseDir, newRelativePath)) return;

        // Update the node with the new relative path
        updateFlowState({
          nodes: activeFlowState.nodes.map((n) =>
            n.id === nodeId ? { ...n, data: { ...n.data, codeFilePath: newRelativePath.replace(/\\/g, '/') } } : n
          ),
        });
      } catch (err) {
        console.error(`Failed to rename code file for node ${nodeId}:`, err);
      }
    },

    toggleConsole: () => updateFlowState({
      showConsole: !activeFlowState.showConsole,
      fullscreen: false
    }),
    setFullscreen: () => updateFlowState({
      fullscreen: !activeFlowState.fullscreen
    }),
    addConsoleMessage: (message) => updateFlowState({
      consoleMessages: [...activeFlowState.consoleMessages, message],
      showConsole: true
    }),
    clearConsole: () => updateFlowState({ consoleMessages: [] }),
    clearAllOutputs: () => updateFlowState({
      nodes: activeFlowState.nodes.map(node => ({
        ...node,
        data: {
          ...node.data,
          output: undefined
        }
      })),
      outputClearCounter: activeFlowState.outputClearCounter + 1,
    }),
    removeConnection: (edgeId) => updateFlowState({
      edges: activeFlowState.edges.filter((edge) => edge.id !== edgeId)
    }),

    openEditorModal: (nodeId) => {
      updateFlowState({ editorModal: { isOpen: true, nodeId } });
    },

    closeEditorModal: () => updateFlowState({ editorModal: { isOpen: false, nodeId: null } }),

    moveConnection: (nodeId, type, edgeId, direction) => {
      const relevantEdges = activeFlowState.edges.filter(edge =>
        type === 'input' ? edge.target === nodeId : edge.source === nodeId
      );
      const currentIndex = relevantEdges.findIndex(e => e.id === edgeId);
      const newIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;

      if (newIndex < 0 || newIndex >= relevantEdges.length) {
        return;
      }

      const reorderedEdges = [...relevantEdges];
      [reorderedEdges[currentIndex], reorderedEdges[newIndex]] =
        [reorderedEdges[newIndex], reorderedEdges[currentIndex]];

      const otherEdges = activeFlowState.edges.filter(edge =>
        type === 'input' ? edge.target !== nodeId : edge.source !== nodeId
      );

      updateFlowState({
        edges: [...otherEdges, ...reorderedEdges]
      });
    },

    stopNodeExecution: (nodeId: string) => {
      if (!activeFlowState.nodeLoading[nodeId]) {
        return;
      }

      // Mark this node as being stopped - ensure stoppingNodes is always a Set
      let currentStoppingNodes: Set<string>;
      try {
        if (activeFlowState.stoppingNodes instanceof Set) {
          currentStoppingNodes = activeFlowState.stoppingNodes;
        } else if (Array.isArray(activeFlowState.stoppingNodes)) {
          currentStoppingNodes = new Set(activeFlowState.stoppingNodes);
        } else {
          currentStoppingNodes = new Set<string>();
        }
      } catch (error) {
        console.warn('stoppingNodes was corrupted, resetting to empty Set:', error);
        currentStoppingNodes = new Set<string>();
      }
      const newStoppingNodes = new Set(currentStoppingNodes);
      newStoppingNodes.add(nodeId);

      updateFlowState({
        stoppingNodes: newStoppingNodes,
      });

      // Log that we're stopping the node
      const newConsoleMessages = [...activeFlowState.consoleMessages, {
        nodeId,
        type: 'log' as const,
        message: `Stopping node execution...`,
        timestamp: Date.now(),
      }];

      updateFlowState({
        consoleMessages: newConsoleMessages,
      });

      // Find the job ID for this node
      const node = activeFlowState.nodes.find(n => n.id === nodeId);
      if (node && node.data && node.data.jobId) {
        // Stop job via HTTP API
        apiClient.stopJob(node.data.jobId)
          .then(() => {
            console.log(`Stop signal sent for job ${node.data.jobId}`);

            // For nodes with dontWaitForOutput, we need to manually set the loading state to false
            if (node.data.dontWaitForOutput) {
              setTimeout(() => {
                let currentStoppingNodes: Set<string>;
                try {
                  if (activeFlowState.stoppingNodes instanceof Set) {
                    currentStoppingNodes = activeFlowState.stoppingNodes;
                  } else if (Array.isArray(activeFlowState.stoppingNodes)) {
                    currentStoppingNodes = new Set(activeFlowState.stoppingNodes);
                  } else {
                    currentStoppingNodes = new Set<string>();
                  }
                } catch (error) {
                  console.warn('stoppingNodes was corrupted, resetting to empty Set:', error);
                  currentStoppingNodes = new Set<string>();
                }
                updateFlowState({
                  nodeLoading: { ...activeFlowState.nodeLoading, [nodeId]: false },
                  stoppingNodes: new Set([...currentStoppingNodes].filter(id => id !== nodeId)),
                });

                updateFlowState({
                  nodes: activeFlowState.nodes.map(n =>
                    n.id === nodeId ? { ...n, data: { ...n.data, jobId: undefined } } : n
                  ),
                });

                const stopMessage = {
                  nodeId,
                  type: 'log' as const,
                  message: `Node execution stopped`,
                  timestamp: Date.now(),
                };
                updateFlowState({
                  consoleMessages: [...activeFlowState.consoleMessages, stopMessage],
                });
              }, 500);
            }
          })
          .catch((err: Error) => {
            console.error(`Error stopping job: ${err.message}`);
          });
      }

      // For regular nodes (not dontWaitForOutput), call executeNode with the stop action flag
      if (!node?.data.dontWaitForOutput) {
        // This will be handled by executeNode
      }
    },

    executeNode: async (nodeId: string, isStopAction = false) => {
      if (isStopAction) {
        // Handle stop action
        const activeFlowState = sessionStore.getActiveFlowState();
        if (!activeFlowState) return;

        if (activeFlowState.nodeLoading[nodeId]) {
          // Mark the node as no longer loading
          updateFlowState({
            nodeLoading: { ...activeFlowState.nodeLoading, [nodeId]: false },
            stoppingNodes: (() => {
              let currentStoppingNodes: Set<string>;
              try {
                if (activeFlowState.stoppingNodes instanceof Set) {
                  currentStoppingNodes = activeFlowState.stoppingNodes;
                } else if (Array.isArray(activeFlowState.stoppingNodes)) {
                  currentStoppingNodes = new Set(activeFlowState.stoppingNodes);
                } else {
                  currentStoppingNodes = new Set<string>();
                }
              } catch (error) {
                console.warn('stoppingNodes was corrupted, resetting to empty Set:', error);
                currentStoppingNodes = new Set<string>();
              }
              return new Set([...currentStoppingNodes].filter(id => id !== nodeId));
            })(),
            nodes: activeFlowState.nodes.map(n =>
              n.id === nodeId ? { ...n, data: { ...n.data, jobId: undefined } } : n
            ),
          });

          // Log that execution was stopped
          updateFlowState({
            consoleMessages: [...activeFlowState.consoleMessages, {
              nodeId,
              type: 'log',
              message: `Node execution stopped`,
              timestamp: Date.now(),
            }],
          });
        }
        return;
      }

      // Execute the node using the internal function
      await internalExecuteNode(nodeId);
    },

    stopFlow: () => {
      const activeFlowState = sessionStore.getActiveFlowState();
      if (!activeFlowState) return;

      // Collect all job IDs to stop (including flow-level jobs)
      const jobIdsToStop = new Set<string>();

      // Stop all currently executing nodes
      Object.keys(activeFlowState.nodeLoading).forEach(nodeId => {
        if (activeFlowState.nodeLoading[nodeId]) {
          // Find the job ID for this node and add it to the set
          const node = activeFlowState.nodes.find(n => n.id === nodeId);
          if (node && node.data && node.data.jobId) {
            jobIdsToStop.add(node.data.jobId);
          }
        }
      });

      // Stop all collected jobs (this will handle both individual nodes and flow-level jobs)
      jobIdsToStop.forEach(jobId => {
        apiClient.stopJob(jobId)
          .then(() => {
            console.log(`Stop signal sent for job ${jobId}`);
          })
          .catch((err: Error) => {
            console.error(`Error stopping job: ${err.message}`);
          });
      });

      // Reset all node loading states and clear injected inputs
      const resetNodeLoading: { [key: string]: boolean } = {};
      Object.keys(activeFlowState.nodeLoading).forEach(nodeId => {
        resetNodeLoading[nodeId] = false;
      });

      // Clear all injected inputs and goto decisions from nodes
      const resetNodes = activeFlowState.nodes.map(node => ({
        ...node,
        data: {
          ...node.data,
          _injectedInput: undefined,
          gotoDecision: node.data.type === 'goto' ? null : node.data.gotoDecision,
          jobId: undefined,
        }
      }));

      // Update state with reset values
      updateFlowState({
        nodeLoading: resetNodeLoading,
        stoppingNodes: new Set<string>(),
        nodes: resetNodes,
        consoleMessages: [...activeFlowState.consoleMessages, {
          nodeId: '',
          type: 'error',
          message: 'Flow execution stopped by user',
          timestamp: Date.now(),
        }],
      });
    },

    executeFlow: async () => {
      let activeFlowState = sessionStore.getActiveFlowState();
      if (!activeFlowState) return;

      // ---------- helpers that always read fresh state ----------
      const byId = (id: string) => {
        activeFlowState = sessionStore.getActiveFlowState()!;
        return activeFlowState.nodes.find(n => n.id === id) || null;
      };
      const incoming = (id: string) => {
        activeFlowState = sessionStore.getActiveFlowState()!;
        return activeFlowState.edges.filter(e => e.target === id);
      };
      const outgoing = (id: string) => {
        activeFlowState = sessionStore.getActiveFlowState()!;
        return activeFlowState.edges.filter(e => e.source === id);
      };
      const isRoot = (id: string) => incoming(id).length === 0;

      const creationIndex = (id: string) => {
        activeFlowState = sessionStore.getActiveFlowState()!;
        const i = activeFlowState.nodes.findIndex(n => n.id === id);
        return i < 0 ? Number.MAX_SAFE_INTEGER : i;
      };

      const rootOf = (id: string) => {
        const seen = new Set<string>();
        let q = [id];
        const roots: string[] = [];
        while (q.length) {
          const cur = q.pop()!;
          if (seen.has(cur)) continue;

          seen.add(cur);
          const inc = incoming(cur);
          if (inc.length === 0) roots.push(cur);
          else inc.forEach(e => q.push(e.source));
        }
        if (!roots.length) return id;
        roots.sort((a, b) => creationIndex(a) - creationIndex(b));
        return roots[0];
      };

      const firstCreatedRoot = () => {
        activeFlowState = sessionStore.getActiveFlowState()!;
        const roots = activeFlowState.nodes.map(n => n.id).filter(isRoot);
        if (!roots.length) return null;
        roots.sort((a, b) => creationIndex(a) - creationIndex(b));
        return roots[0];
      };

      const firstCreatedGoto = () => {
        activeFlowState = sessionStore.getActiveFlowState()!;
        const gotos = activeFlowState.nodes.filter(n => n.data?.type === 'goto');
        if (!gotos.length) return null;
        gotos.sort((a, b) => creationIndex(a.id) - creationIndex(b.id));
        return gotos[0].id;
      };

      const stripTrailingSemis = (s: string) => (s ?? '').trim().replace(/;+\s*$/, '');
      const toNumberIfNumeric = (v: any) =>
        (typeof v === 'string' && v.trim() !== '' && !isNaN(+v) ? +v : v);

      const evalGotoExpr = (expr: string, input: any): boolean => {
        try {
          const cleaned = stripTrailingSemis(expr);
          const ninput = toNumberIfNumeric(input);
          const fn = new Function('input', 'ninput', `return !!(${cleaned});`);
          return !!fn(input, ninput);
        } catch {
          return false;
        }
      };

      // ---------- choose entry ----------
      activeFlowState = sessionStore.getActiveFlowState()!;
      let entryId: string | null = null;
      if (activeFlowState.starterNodeId) entryId = activeFlowState.starterNodeId!;
      else {
        const g = firstCreatedGoto();
        entryId = g ? rootOf(g) : firstCreatedRoot();
      }

      if (!entryId) {
        updateFlowState({
          consoleMessages: [...activeFlowState.consoleMessages, {
            nodeId: '',
            type: 'error',
            message: 'No valid entry point found.',
            timestamp: Date.now(),
          }],
        });
        return;
      }

      // reset goto decisions freshly and injectedvalues
      updateFlowState({
        nodes: activeFlowState.nodes.map(n =>
          n.data?.type === 'goto' ? { ...n, data: { ...n.data, gotoDecision: null } } : n
        ),
      });
        updateFlowState({
        nodes: activeFlowState.nodes.map(n =>
          n.data?._injectedInput? { ...n, data: { ...n.data, _injectedInput: undefined } } : n
        ),
      });


      // ---------- scheduler ----------
      const executed = new Set<string>();
      const executing = new Set<string>();
      const visitCount: Record<string, number> = {};
      const executedAt: Record<string, number> = {};
      let tick = 0;

      const MAX_VISITS_PER_NODE = 1000;
      const MAX_STEPS = 1000;

      const ensureExecuted = async (nodeId: string, force = false): Promise<void> => {
        if (executing.has(nodeId)) return;
        if (executed.has(nodeId) && !force) return;

        const node = byId(nodeId);
        if (!node) return;

        executing.add(nodeId);

        // predecessors first
        const preds = incoming(nodeId).map(e => e.source);
        for (const p of preds) await ensureExecuted(p, false);

        if (node.data?.type === 'goto') {
          // 1) If a previous goto forwarded an input, prefer it
          const injected = (node.data as any)?._injectedInput;
          let processedInputs: any;

          if (typeof injected !== 'undefined') {
            processedInputs = injected;
            // clear it so it's single-use
            activeFlowState = sessionStore.getActiveFlowState()!;
            updateFlowState({
              nodes: activeFlowState.nodes.map(n =>
                n.id === nodeId ? { ...n, data: { ...n.data, _injectedInput: undefined } } : n
              ),
            });
          } else {
            // 2) Otherwise, compute from predecessors
            const inEdges = incoming(nodeId);
            const inputNodes = inEdges
              .map(e => byId(e.source))
              .filter((n): n is NonNullable<typeof n> => !!n);

            const inputs = await Promise.all(
              inputNodes.map(async (n) => {
                if (n.data?.type === 'constant') return n.data.value;
                return byId(n.id)?.data?.output;
              })
            );
            processedInputs = inputs.length === 1 ? inputs[0] : inputs;
          }

          // 3) Evaluate rules and capture per-rule forward flag
          const rules = Array.isArray(node.data?.conditions) ? node.data.conditions : [];
          let decision: string | null = null;
          let forward = false;

          for (const r of rules) {
            if (r?.expr && r?.goto) {
              if (evalGotoExpr(r.expr, processedInputs)) {
                decision = r.goto;
                forward = !!r.forwardInput; // per-condition forwarding
                //break; // evaluate ALL conditions, the last one is the good one.
              }
            }
          }

          // 4) Persist decision + visible output on the goto node
          activeFlowState = sessionStore.getActiveFlowState()!;
          updateFlowState({
            nodes: activeFlowState.nodes.map(n =>
              n.id === nodeId ? { ...n, data: { ...n.data, output: processedInputs, gotoDecision: decision } } : n
            ),
          });

          // 5) If the matched rule says so, forward the input to the jump target
          if (decision && forward) {
            activeFlowState = sessionStore.getActiveFlowState()!;
            updateFlowState({
              nodes: activeFlowState.nodes.map(n =>
                n.id === decision ? { ...n, data: { ...n.data, _injectedInput: processedInputs } } : n
              ),
            });
          }
        } else {
          // Execute regular nodes using the full executeNode logic
          // Pass true to indicate this is from flow execution context
          await internalExecuteNode(nodeId, true);
          
          // CRITICAL: Wait for state to be fully updated before continuing
          // This ensures the node's output is available before goto nodes read it
          await new Promise(resolve => setTimeout(resolve, 0));
          
          // Refresh the node reference to get the updated output
          activeFlowState = sessionStore.getActiveFlowState()!;
          const updatedNode = byId(nodeId);
          
          // Verify the output was actually set
          if (updatedNode && typeof updatedNode.data?.output === 'undefined') {
            // If output is still undefined after execution, wait a bit more
            await new Promise(resolve => setTimeout(resolve, 10));
          }
        }

        executed.add(nodeId);
        executedAt[nodeId] = ++tick;
        executing.delete(nodeId);
      };

      const stepTo = async (nextId: string, stepBudget: { left: number }) => {
        if (stepBudget.left-- <= 0) return;

        visitCount[nextId] = (visitCount[nextId] ?? 0) + 1;
        if (visitCount[nextId] > MAX_VISITS_PER_NODE) return;

        const node = byId(nextId);
        const preds = incoming(nextId).map(e => e.source);

        // refresh rule applies to ALL nodes, not just goto
        const needsRefresh =
          preds.some(p => (executedAt[p] || 0) > (executedAt[nextId] || 0));

        await ensureExecuted(nextId, needsRefresh);

        const n = byId(nextId);
        if (!n) return;

        if (n.data?.type === 'goto') {
          const decision = n.data.gotoDecision;

          if (decision) {
            // Re-run the jump target so loops and cross-branch jumps recompute
            await ensureExecuted(decision, true);
            await stepTo(decision, stepBudget);
            return;
          }

          const outs = outgoing(nextId);
          for (const e of outs) await stepTo(e.target, stepBudget);
          return;
        }

        // normal node: follow outs
        const outs = outgoing(nextId);
        for (const e of outs) await stepTo(e.target, stepBudget);
      };

      await stepTo(entryId, { left: MAX_STEPS });
    },

    saveFlow: async () => {
      const activeFlowState = sessionStore.getActiveFlowState();
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
      const activeSession = sessionStore.getActiveSession();
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
    },

    loadFlow: async () => {
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

            // Load the flow data
            updateFlowState({
              nodes: processedNodes,
              edges: flowData.edges,
              flowPath: file.name,
              history: [],
              historyIndex: -1
            });

            // Create a new session with the file name (without .or extension)
            const sessionName = file.name.replace(/\.or$/i, '');
            await sessionStore.createSession(sessionName);

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
    },
  };
};