import { create } from 'zustand';
import { Node, Edge } from 'reactflow';
import { pathUtils } from '../utils/pathUtils';


interface ConsoleMessage {
  nodeId: string;
  type: 'input' | 'output' | 'error' | 'log';
  message: string;
  timestamp: number;
}

interface FlowState {
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
  flowPath?: string | null; // add this!
  // Flow history tracking
  history: Array<{ nodes: Node[]; edges: Edge[] }>;
  historyIndex: number;
  maxHistorySize: number;
  starterNodeId: string | null;
  stoppingNodes: Set<string>; // Track nodes that are being stopped
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
  toggleDontWaitForOutput: (nodeId: string) => void; // Add method to toggle dontWaitForOutput
  toggleConsole: () => void;
  setFullscreen: () => void;
  addConsoleMessage: (message: ConsoleMessage) => void;
  clearConsole: () => void;
  clearFlow: () => void;
  executeNode: (nodeId: string, isStopAction?: boolean) => void;
  stopNodeExecution: (nodeId: string) => void;
  executeFlow: () => void;
  saveFlow: () => void;
  loadFlow: () => void;
  removeConnection: (edgeId: string) => void;
  moveConnection: (nodeId: string, type: 'input' | 'output', edgeId: string, direction: 'up' | 'down') => void;
  openEditorModal: (nodeId: string) => void;
  closeEditorModal: () => void;
  setNodeLoading: (nodeId: string, loading: boolean) => void;
  clearAllOutputs: () => void;
  // History navigation
  canUndo: () => boolean;
  canRedo: () => boolean;
  undo: () => void;
  redo: () => void;
  addToHistory: () => void;
  // Copy/Paste functionality
  copySelectedNodes: (nodeIds: string[]) => void;
  pasteNodes: () => void;
  getClipboardNodes: () => Node[] | null;
  clearNodeSelection: (nodes: Node[]) => void;
  outputClearCounter: number;
}
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

export const useFlowStore = create<FlowState>((set, get) => ({

  nodes: [],
  edges: [],
  consoleMessages: [],
  showConsole: false,
  fullscreen: false,
  nodeExecutionTimeout: Infinity, // Default timeout: Infinitys seconds
  editorModal: {
    isOpen: false,
    nodeId: null,
  },
  nodeLoading: {},
  panOnDrag: true,
  flowPath: null,
  isOutputZoneActive: false,
  isTitleEditing: false,
  isMouseOverConsole: false,
  // History state
  history: [],
  historyIndex: -1,
  maxHistorySize: 10,
  starterNodeId: null,
  outputClearCounter: 0,
  stoppingNodes: new Set<string>(),
  setFlowPath: (path: string | null) => set({ flowPath: path }),
  setNodeExecutionTimeout: (timeout: number) => set({ nodeExecutionTimeout: timeout }),
  // Optimized version of setOutputZoneActive to reduce state updates
  setOutputZoneActive: (active: boolean) => {
    // Only update state if the value is actually changing
    if (get().isOutputZoneActive !== active) {
      set({ isOutputZoneActive: active });
    }
  },
  setTitleEditing: (editing: boolean) => set({ isTitleEditing: editing }),
  setMouseOverConsole: (isOver: boolean) => set({ isMouseOverConsole: isOver }),

  // Set a node as the starter node for flow execution
  setStarterNode: (nodeId: string) => {
    const { nodes, starterNodeId } = get();

    // Add current state to history before making changes
    get().addToHistory();

    // If the clicked node is already the starter, unset it
    if (starterNodeId === nodeId) {
      set({ starterNodeId: null });

      // Update all nodes to remove the starter flag
      set((state) => ({
        nodes: state.nodes.map((node) => ({
          ...node,
          data: {
            ...node.data,
            isStarterNode: false
          }
        }))
      }));
    } else {
      // Set the new starter node
      set({ starterNodeId: nodeId });

      // Update all nodes to set the starter flag only on the selected node
      set((state) => ({
        nodes: state.nodes.map((node) => ({
          ...node,
          data: {
            ...node.data,
            isStarterNode: node.id === nodeId
          }
        }))
      }));
    }
  },

  // Method to toggle the dontWaitForOutput property
  toggleDontWaitForOutput: (nodeId: string) => {
    const { nodes } = get();
    const node = nodes.find(n => n.id === nodeId);

    if (node) {
      // Add current state to history before making changes
      get().addToHistory();

      // Toggle the dontWaitForOutput property
      get().updateNodeData(nodeId, {
        dontWaitForOutput: !node.data.dontWaitForOutput
      }, false); // Don't add to history again since we already did
    }
  },

  // History management functions
  canUndo: () => {
    const { historyIndex } = get();
    return historyIndex > 0;
  },

  canRedo: () => {
    const { historyIndex, history } = get();
    return historyIndex < history.length - 1;
  },

  addToHistory: () => {
    const { nodes, edges, history, historyIndex, maxHistorySize } = get();
    // Create a deep copy of the current state using a more efficient approach
    const currentState = {
      nodes: nodes.map(node => ({ ...node })),
      edges: edges.map(edge => ({ ...edge }))
    };

    // If we're not at the end of the history, truncate the future states
    const newHistory = historyIndex < history.length - 1
      ? history.slice(0, historyIndex + 1)
      : [...history];

    // Add the current state to history
    newHistory.push(currentState);

    // If history exceeds max size, remove oldest entries
    if (newHistory.length > maxHistorySize) {
      newHistory.shift();
    }

    set({
      history: newHistory,
      historyIndex: newHistory.length - 1
    });
  },

  undo: () => {
    const { history, historyIndex } = get();

    if (historyIndex > 0) {
      const prevState = history[historyIndex - 1];
      set({
        nodes: prevState.nodes,
        edges: prevState.edges,
        historyIndex: historyIndex - 1
      });
    }
  },

  redo: () => {
    const { history, historyIndex } = get();

    if (historyIndex < history.length - 1) {
      const nextState = history[historyIndex + 1];
      set({
        nodes: nextState.nodes,
        edges: nextState.edges,
        historyIndex: historyIndex + 1
      });
    }
  },

  // Clipboard functionality
  copySelectedNodes: (nodeIds: string[]) => {
    const { nodes, edges } = get();

    // Get the selected nodes
    const selectedNodes = nodes.filter(node => nodeIds.includes(node.id));

    // Get edges between selected nodes
    const selectedEdges = edges.filter(
      edge => nodeIds.includes(edge.source) && nodeIds.includes(edge.target)
    );

    // Store in localStorage (as a simple clipboard)
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
      const { nodes, edges } = get();

      // Create a mapping of old node IDs to new node IDs
      const idMapping: Record<string, string> = {};

      // Create new nodes with new IDs
      const newNodes = clipboard.nodes.map((node: Node) => {
        const newId = `node-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
        idMapping[node.id] = newId;

        // Offset position slightly to make it clear these are new nodes
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
          selected: true // Ensure new nodes are not selected
        };
      });

      // Create new edges with updated source/target IDs
      const newEdges = clipboard.edges.map((edge: Edge) => {
        return {
          ...edge,
          id: `e${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
          source: idMapping[edge.source],
          target: idMapping[edge.target]
        };
      });

      // Add the new nodes and edges to the flow
      set({
        nodes: [...nodes, ...newNodes],
        edges: [...edges, ...newEdges]
      });

      // Add this change to history
      get().addToHistory();

      // Clear selection after paste

      get().clearNodeSelection(clipboard.nodes);

    } catch (error) {
      console.error('Error pasting nodes:', error);
    }
  },

  // Helper function to clear node selection
  clearNodeSelection: (targetedNodes: Node[]) => {
    const targetedIds = new Set(targetedNodes.map(n => n.id));
    set((state) => ({
      nodes: state.nodes.map(node => ({
        ...node,
        selected: targetedIds.has(node.id) ? false : node.selected
      }))
    }));
  },


  clearFlow: async () => {
    const state = get();
    {/** 
    const oldFlowPath = state.flowPath;
    
    // If we have a flow path, check if we need to delete the associated code files folder
    if (oldFlowPath && window.electronAPI?.directoryExists && window.electronAPI?.deleteDirectory) {
      const oldFlowFileName = oldFlowPath.split(/[\\/]/).pop() || 'flow';
      const oldFlowFolderName = oldFlowFileName.replace(/\.or$/, '');
      const oldFlowFolderPath = pathUtils.join(pathUtils.dirname(oldFlowPath), oldFlowFolderName);
      
      // Check if the folder exists
      const folderExists = await window.electronAPI.directoryExists(oldFlowFolderPath);
      if (folderExists) {
        // Ask user for confirmation before deleting the folder
        const confirmDelete = confirm(
          `Do you want to delete the associated code files folder?\n${oldFlowFolderPath}`
        );
        
        if (confirmDelete) {
          try {
            await window.electronAPI.deleteDirectory(oldFlowFolderPath);
            console.log(`Deleted code files folder: ${oldFlowFolderPath}`);
          } catch (err) {
            console.error(`Error deleting code files folder: ${err}`);
          }
        }
      }
    }
    */}
    set({
      nodes: [],
      edges: [],
      flowPath: null,
      // Reset history when clearing the flow
      history: [],
      historyIndex: -1
    });
    window.electronAPI?.setTitle?.('default'); // Triggers reset to versioned title
  },

  updatePanOnDrag: (isDraggable) => set((state) => ({
    panOnDrag: isDraggable
  })),
  zoomOnScroll: true,
  updateZoomOnScroll: (isDraggable) => set((state) => ({
    zoomOnScroll: isDraggable
  })),
  setNodeLoading: (nodeId, loading) =>
    set((state) => ({
      nodeLoading: {
        ...state.nodeLoading,
        [nodeId]: loading,
      },
    })),
  updateNodeDraggable: (nodeId, isDraggable) => set((state) => ({
    nodes: state.nodes.map((node) =>
      node.id === nodeId ? { ...node, draggable: isDraggable } : node
    ),
  })),
  setNodes: (nodes, addHistory = true) => {
    // Add current state to history before making changes (if addHistory is true)
    if (addHistory) {
      get().addToHistory();
    }

    set((state) => ({
      nodes: typeof nodes === 'function' ? nodes(state.nodes) : nodes
    }));
  },

  setEdges: (edges) => {
    // Add current state to history before making changes
    get().addToHistory();

    set((state) => ({
      edges: typeof edges === 'function' ? edges(state.edges) : edges
    }));
  },

  addNode: (node) => {
    // Add current state to history before making changes
    get().addToHistory();

    set((state) => ({ nodes: [...state.nodes, node] }));
  },
  removeNode: async (nodeId) => {
    const { nodes, edges } = get();
    const node = nodes.find(n => n.id === nodeId);

    // Add current state to history before making changes
    get().addToHistory();

    // If the node has a codeFilePath, ask the user if they want to delete the file
    if (node?.data?.codeFilePath && window.electronAPI?.deleteFile) {
      const codeFilePath = node.data.codeFilePath;

      // Resolve the full path if it's relative
      const flowPath = get().flowPath || '';
      const absolutePath = pathUtils.isAbsolute(codeFilePath)
        ? codeFilePath
        : pathUtils.join(pathUtils.dirname(flowPath), codeFilePath);

      const shouldDelete = confirm(`Do you want to delete the associated code file?\n${absolutePath}`);


      if (shouldDelete) {
        try {
          await window.electronAPI.deleteFile(absolutePath);
          console.log(`Deleted file: ${absolutePath}`);
        } catch (err) {
          console.error(`Failed to delete file ${absolutePath}:`, err);
        }
      }
    }

    // Finally, remove the node and any related edges
    set({
      nodes: nodes.filter(n => n.id !== nodeId),
      edges: edges.filter(e => e.source !== nodeId && e.target !== nodeId)
    });
  },

  updateNodeData: (nodeId, data, addHistory = true) => {
    // Add current state to history before making changes (if addHistory is true)
    if (addHistory) {
      get().addToHistory();
    }

    set((state) => ({
      nodes: state.nodes.map((node) =>
        node.id === nodeId ? { ...node, data: { ...node.data, ...data } } : node
      ),
    }));
  },
  updateCodeFilePath: async (nodeId: string, label: string) => {
    const state = get();
    const node = state.nodes.find(n => n.id === nodeId);
    if (!node) return;

    const oldFilePath = node.data.codeFilePath;
    if (!oldFilePath) return;

    // Confirm rename action with the user
    //const shouldRename = confirm(`Do you want to rename the code file for this node using its label?\nOld: ${oldFilePath}`);
    const shouldRename = true;
    if (!shouldRename) return;

    try {
      const flowPath = state.flowPath || '';
      const baseDir = pathUtils.dirname(flowPath);
      const oldAbsolutePath = pathUtils.isAbsolute(oldFilePath)
        ? oldFilePath
        : pathUtils.join(baseDir, oldFilePath);

      const extension = oldFilePath.split('.').pop() || 'txt';

      // Create new file name based on label
      const sanitizedLabel = label.replace(/[^a-zA-Z0-9_\-]/g, '_'); // replace problematic characters
      const newFileName = `${sanitizedLabel}.${extension}`;
      const newRelativePath = pathUtils.join(pathUtils.dirname(oldFilePath), newFileName);
      const newAbsolutePath = pathUtils.join(baseDir, newRelativePath);

      if (oldAbsolutePath === newAbsolutePath) return; // nothing to do

      // Rename the file via Electron API
      if (window.electronAPI?.renameFile) {
        await window.electronAPI.renameFile(oldAbsolutePath, newAbsolutePath);
        console.log(`Renamed file: ${oldAbsolutePath} → ${newAbsolutePath}`);

        // Update the node with the new relative path
        state.updateNodeData(nodeId, {
          codeFilePath: newRelativePath.replace(/\\/g, '/')
        });
      } else {
        console.warn('renameFile API not available.');
      }
    } catch (err) {
      console.error(`Failed to rename code file for node ${nodeId}:`, err);
      //alert(`Failed to rename code file:\n${err instanceof Error ? err.message : String(err)}`);
    }
  },

  toggleConsole: () => {
    set((state) => ({
      showConsole: !state.showConsole,
      fullscreen: false
    }))
  },
  setFullscreen: () => {
    set((state) => ({
      fullscreen: !state.fullscreen
    }))
  },
  addConsoleMessage: (message) =>
    set((state) => ({
      consoleMessages: [...state.consoleMessages, message],
      showConsole: true
    })),
  clearConsole: () => set({ consoleMessages: [] }),
  clearAllOutputs: () => set((state) => ({
    nodes: state.nodes.map(node => ({
      ...node,
      data: {
        ...node.data,
        output: undefined
      }
    })),
    outputClearCounter: state.outputClearCounter + 1,
  })),
  removeConnection: (edgeId) => {
    // Add current state to history before making changes
    get().addToHistory();

    set((state) => ({
      edges: state.edges.filter((edge) => edge.id !== edgeId)
    }));
  },

  openEditorModal: (nodeId) => {
    const state = get();
    const node = state.nodes.find((n) => n.id === nodeId);

    // Helper: actually open the modal
    const open = () => {
      set({ editorModal: { isOpen: true, nodeId } });
    };

    // If no external file, just open
    if (!node?.data?.codeFilePath || !(window as any).electronAPI?.readTextFile) {
      open();
      return;
    }

    try {
      const flowPath = state.flowPath || '';
      const codeFilePath = pathUtils.isAbsolute(node.data.codeFilePath)
        ? node.data.codeFilePath
        : pathUtils.join(pathUtils.dirname(flowPath), node.data.codeFilePath);

      // Load the file, then update the node, then open the modal
      (window as any).electronAPI
        .readTextFile(codeFilePath)
        .then((code: string) => {
          // Update node's code in the store so the editor gets the latest
          state.updateNodeData(nodeId, { code }, false);
        })
        .catch((err: any) => {
          state.addConsoleMessage?.({
            nodeId,
            type: 'error',
            message: `Failed to load code from file: ${node.data.codeFilePath}`,
            timestamp: Date.now(),
          });
          console.error('Failed to load code file for editor:', err);
        })
        .finally(() => {
          // Only open after we’ve tried to sync the code
          open();
        });
    } catch (err) {
      state.addConsoleMessage?.({
        nodeId,
        type: 'error',
        message: `Error resolving code file path: ${node?.data?.codeFilePath ?? ''}`,
        timestamp: Date.now(),
      });
      console.error('Error resolving code file path for editor:', err);
      open();
    }
  },


  closeEditorModal: () =>
    set({ editorModal: { isOpen: false, nodeId: null } }),

  // Utility function to convert absolute path to relative path
  convertToRelativePath: (absolutePath: string, basePath: string) => {
    if (!absolutePath || !basePath) return absolutePath;

    try {
      // Use the Electron API if available
      if (window.electronAPI?.getRelativePath) {
        return window.electronAPI.getRelativePath(absolutePath, basePath);
      }

      // Fallback to the original implementation
      // Normalize paths to use forward slashes
      const normalizedAbsolutePath = absolutePath.replace(/\\/g, '/');
      const normalizedBasePath = basePath.replace(/\\/g, '/');

      // Get directory of the base path
      const baseDir = pathUtils.dirname(normalizedBasePath);

      // If the absolute path is in a completely different location than the base path,
      // it might be better to keep it as absolute
      if (!normalizedAbsolutePath.startsWith(baseDir.substring(0, 3))) {
        return absolutePath;
      }

      // Convert absolute path to relative path
      const relativePath = pathUtils.relative(baseDir, normalizedAbsolutePath);

      // For paths in the same directory, ensure they don't start with ./ for cleaner paths
      const cleanRelativePath = relativePath.startsWith('./') ? relativePath.substring(2) : relativePath;

      // Return the relative path with forward slashes for consistency
      return cleanRelativePath.replace(/\\/g, '/');
    } catch (error) {
      console.error('Error converting to relative path:', error);
      return absolutePath;
    }
  },

  // Utility function to convert relative path to absolute path
  convertToAbsolutePath: (relativePath: string, basePath: string) => {
    if (!relativePath || !basePath) return relativePath;

    try {
      // Use the Electron API if available
      if (window.electronAPI?.getAbsolutePath) {
        return window.electronAPI.getAbsolutePath(relativePath, basePath);
      }

      // Fallback to the original implementation
      // Check if the path is already absolute
      if (pathUtils.isAbsolute(relativePath)) {
        return relativePath;
      }

      // Normalize paths to use forward slashes
      const normalizedBasePath = basePath.replace(/\\/g, '/');

      // Extract the directory from the base path
      const baseDir = pathUtils.dirname(normalizedBasePath);


      // For simple relative paths without directory components,
      // place them in the same directory as the master flow
      if (!relativePath.includes('/') && !relativePath.includes('\\')) {
        // Ensure we have a separator between baseDir and relativePath
        let resolvedPath;
        if (baseDir.endsWith('/')) {
          resolvedPath = baseDir + relativePath;
        } else {
          resolvedPath = baseDir + '/' + relativePath;
        }

        return resolvedPath;
      }

      // For more complex relative paths, use the resolve function
      const resolvedPath = pathUtils.resolve(baseDir, relativePath);

      return resolvedPath;
    } catch (error) {
      console.error('Error converting to absolute path:', error);
      return relativePath;
    }
  },

  saveFlow: async () => {
    const state = get();

    // Create a deep copy of nodes to avoid modifying the original nodes
    let nodesToSave = JSON.parse(JSON.stringify(state.nodes));

    // If we have a flow path, convert all flow node paths to relative paths
    // and save code to separate files
    if (state.flowPath) {
      // Create a folder with the same name as the .or file (without extension)
      const flowFileName = state.flowPath.split(/[\\/]/).pop() || 'flow';
      const flowFolderName = flowFileName.replace(/\.or$/, '');
      //const flowFolderPath = pathUtils.join(pathUtils.dirname(state.flowPath), flowFolderName);

      // Ensure the folder exists
      //if (window.electronAPI?.ensureDirectoryExists) {
      //await window.electronAPI.ensureDirectoryExists(flowFolderPath);
      //}

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
            const baseDir = pathUtils.dirname(state.flowPath || '');
            if (window.electronAPI?.getRelativePath) {

              relativePath = window.electronAPI.getRelativePath(node.data.code, baseDir);

            } else {
              relativePath = get().convertToRelativePath(node.data.code, baseDir || '');
            }

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

        // Handle code nodes (save code to separate files)
        if (node.data.code && ['javascript', 'jsbackend', 'groovy', 'batch', 'powershell'].includes(node.data.type)) {
          // Determine file extension based on node type
          let extension;
          switch (node.data.type) {
            case 'javascript':
            case 'jsbackend':
              extension = 'js';
              break;
            case 'groovy':
              extension = 'groovy';
              break;
            case 'batch':
              extension = 'bat';
              break;
            case 'powershell':
              extension = 'ps1';
              break;
            default:
              extension = 'txt';
          }
          {/** 
          // Create filename: {nodeId}.{extension}
          const codeFileName = `${node.id}.${extension}`;
          const codeFilePath = pathUtils.join(flowFolderName, codeFileName);
          // Ensure state.flowPath is not null or undefined
          const flowPath = state.flowPath || '';
          const absoluteCodeFilePath = pathUtils.join(pathUtils.dirname(flowPath), codeFilePath);
          
          // Save the code to the file
          if (window.electronAPI?.writeTextFile) {
            await window.electronAPI.writeTextFile(absoluteCodeFilePath, node.data.code);
          }
          else{
            console.log('writeTextFile not available');
          }
          // Update the node data to include the codeFilePath but keep the original code
          return {
            ...node,
            data: {
              ...node.data,
              codeFilePath: codeFilePath.replace(/\\/g, '/') // Use forward slashes for consistency
              // Keep the original code in the code property for backward compatibility
            }
          };
          */}
        }

        return node;
      }));
    }

    const flow = { nodes: nodesToSave, edges: state.edges };
    const flowJson = JSON.stringify(flow, null, 2);

    try {
      if (state.flowPath && window.electronAPI?.saveFlowToPath) {
        await window.electronAPI.saveFlowToPath(state.flowPath, flowJson);
        // After saving, update the nodes in the store with relative paths and codeFilePaths
        if (JSON.stringify(nodesToSave) !== JSON.stringify(state.nodes)) {
          set({ nodes: nodesToSave });
        }
      } else if (window.electronAPI?.saveFlowAs) {
        // Use Electron Save As
        const filePath = await window.electronAPI.saveFlowAs(flowJson);
        if (filePath) {
          // Check if this is a rename operation (we already had a flowPath)
          const oldFlowPath = state.flowPath;
          if (oldFlowPath && oldFlowPath !== filePath) {
            // This is a rename operation
            const oldFlowFileName = oldFlowPath.split(/[\\/]/).pop() || 'flow';
            const oldFlowFolderName = oldFlowFileName.replace(/\.or$/, '');
            const oldFlowFolderPath = pathUtils.join(pathUtils.dirname(oldFlowPath), oldFlowFolderName);

            const newFlowFileName = filePath.split(/[\\/]/).pop() || 'flow';
            const newFlowFolderName = newFlowFileName.replace(/\.or$/, '');
            const newFlowFolderPath = pathUtils.join(pathUtils.dirname(filePath), newFlowFolderName);

            // Move code files from old folder to new folder if the old folder exists
            if (window.electronAPI?.directoryExists && window.electronAPI?.moveDirectory) {
              const oldFolderExists = await window.electronAPI.directoryExists(oldFlowFolderPath);
              if (oldFolderExists) {
                // Ensure the new directory exists
                await window.electronAPI.ensureDirectoryExists(newFlowFolderPath);

                // Move the files from old folder to new folder
                await window.electronAPI.moveDirectory(oldFlowFolderPath, newFlowFolderPath);

                // Update codeFilePath properties in all nodes
                const updatedNodes = state.nodes.map(node => {
                  if (node.data.codeFilePath) {
                    const newCodeFilePath = node.data.codeFilePath.replace(
                      oldFlowFolderName,
                      newFlowFolderName
                    );
                    return {
                      ...node,
                      data: {
                        ...node.data,
                        codeFilePath: newCodeFilePath
                      }
                    };
                  }
                  return node;
                });

                // Update nodes in the store
                set({ nodes: updatedNodes });
              }
            }
          }

          get().setFlowPath(filePath);
          const fileName = filePath.split(/[\\/]/).pop();
          if (fileName) window.electronAPI?.setTitle?.(fileName);

          // After saving for the first time, we need to save the flow again
          // to properly create the code files in the new location
          setTimeout(() => {
            get().saveFlow();
          }, 100);
        }
      } else {
        // fallback: browser download (cannot get path!)
        const blob = new Blob([flowJson], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'flow.or';
        a.click();
        URL.revokeObjectURL(url);
        if (window.electronAPI?.setTitle) window.electronAPI.setTitle('flow.or');
      }
    } catch (error) {
      console.error('Error saving flow:', error);
      alert(`Error saving flow: ${error instanceof Error ? error.message : String(error)}`);
    }
  },

  loadFlow: async () => {
    if (window.electronAPI?.openFlowFile) {
      const result = await window.electronAPI.openFlowFile();
      if (result && result.data) {
        try {
          const flow = JSON.parse(result.data);

          // Store the master flow path for reference
          const masterFlowPath = result.filePath;

          // Get the flow folder path (same name as .or file without extension)
          const flowFileName = masterFlowPath.split(/[\\/]/).pop() || 'flow';
          const flowFolderName = flowFileName.replace(/\.or$/, '');
          const flowFolderPath = pathUtils.join(pathUtils.dirname(masterFlowPath), flowFolderName);

          // Process each node to load code from external files and convert paths
          const nodes = await Promise.all(flow.nodes.map(async (node: Node) => {
            // Ensure dontWaitForOutput property is preserved when loading
            if (node.data.dontWaitForOutput === true) {
              node.data.dontWaitForOutput = true;
            }

            // Handle flow nodes (convert relative paths to absolute)
            if (node.data.type === 'flow' && node.data.code) {
              // Process both relative and absolute paths
              const isAbsolutePath = window.electronAPI?.getAbsolutePath
                ? false // We'll use the API to determine this
                : pathUtils.isAbsolute(node.data.code);

              if (!isAbsolutePath || node.data.isRelativePath) {
                // It's a relative path - store both versions
                const relativePath = node.data.code;
                // Convert relative path to absolute path using the master flow file's location
                let absolutePath;

                if (window.electronAPI?.getAbsolutePath) {
                  absolutePath = window.electronAPI.getAbsolutePath(relativePath, pathUtils.dirname(masterFlowPath || ''));
                } else {
                  absolutePath = get().convertToAbsolutePath(relativePath, pathUtils.dirname(masterFlowPath || ''));
                }

                return {
                  ...node,
                  data: {
                    ...node.data,
                    absolutePath: absolutePath, // Store absolute path for execution
                    code: relativePath, // Keep relative path for display
                    isRelativePath: true,
                    flowFilePath: masterFlowPath // Store the parent flow path for nested resolution
                  }
                };
              } else {
                // It's an absolute path - convert to relative for display
                const absolutePath = node.data.code;
                let relativePath;
                const baseDir = pathUtils.dirname(masterFlowPath || '');
                if (window.electronAPI?.getRelativePath) {
                  relativePath = window.electronAPI.getRelativePath(absolutePath, baseDir);
                } else {
                  relativePath = get().convertToRelativePath(absolutePath, baseDir);
                }

                return {
                  ...node,
                  data: {
                    ...node.data,
                    absolutePath: absolutePath, // Store absolute path for execution
                    code: relativePath, // Show relative path in UI
                    isRelativePath: true,
                    flowFilePath: masterFlowPath // Store the parent flow path for nested resolution
                  }
                };
              }
            }

            // Handle code nodes with external code files
            if (node.data.codeFilePath && ['javascript', 'jsbackend', 'groovy', 'batch', 'powershell'].includes(node.data.type)) {
              try {
                // Resolve the code file path (could be relative or absolute)
                let codeFilePath = node.data.codeFilePath;
                if (!pathUtils.isAbsolute(codeFilePath)) {
                  // It's a relative path, resolve it relative to the flow file
                  codeFilePath = pathUtils.join(pathUtils.dirname(masterFlowPath), codeFilePath);
                }

                // Read the code from the file if it exists
                if (window.electronAPI?.readTextFile) {
                  try {
                    const code = await window.electronAPI.readTextFile(codeFilePath);
                    // Update the node with the code from the file
                    return {
                      ...node,
                      data: {
                        ...node.data,
                        code: code, // Update the code property with the file content
                        codeFilePath: node.data.codeFilePath // Keep the codeFilePath for future saves
                      }
                    };
                  } catch (err) {
                    console.warn(`Could not read code file ${codeFilePath}, using embedded code instead:`, err);
                    // Keep the existing code if the file can't be read
                  }
                }
              } catch (err) {
                console.warn(`Error processing code file for node ${node.id}:`, err);
              }
            }

            return node;
          }));

          set({ nodes, edges: flow.edges });
          get().setFlowPath(result.filePath);
          const fileName = result.filePath.split(/[\\/]/).pop();
          if (fileName) window.electronAPI?.setTitle?.(fileName);
        } catch (error) {
          console.error('Error loading flow:', error);
        }
      }
    }
  },



  executeFlow: async () => {
    // ---------- helpers that always read fresh state ----------
    const byId = (id: string) => get().nodes.find(n => n.id === id) || null;
    const incoming = (id: string) => get().edges.filter(e => e.target === id);
    const outgoing = (id: string) => get().edges.filter(e => e.source === id);
    const isRoot = (id: string) => incoming(id).length === 0;

    const creationIndex = (id: string) => {
      const i = get().nodes.findIndex(n => n.id === id);
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
      const roots = get().nodes.map(n => n.id).filter(isRoot);
      if (!roots.length) return null;
      roots.sort((a, b) => creationIndex(a) - creationIndex(b));
      return roots[0];
    };

    const firstCreatedGoto = () => {
      const gotos = get().nodes.filter(n => n.data?.type === 'goto');
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
    let entryId: string | null = null;
    if (get().starterNodeId) entryId = get().starterNodeId!;
    else {
      const g = firstCreatedGoto();
      entryId = g ? rootOf(g) : firstCreatedRoot();
    }

    if (!entryId) {
      get().addConsoleMessage({
        nodeId: '',
        type: 'error',
        message: 'No valid entry point found.',
        timestamp: Date.now(),
      });
      return;
    }

    // reset goto decisions freshly
    get().nodes
      .filter(n => n.data?.type === 'goto')
      .forEach(n => get().updateNodeData(n.id, { gotoDecision: null }, false));

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
          // clear it so it’s single-use
          get().updateNodeData(nodeId, { _injectedInput: undefined }, false);
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
              break;
            }
          }
        }

        // 4) Persist decision + visible output on the goto node
        get().updateNodeData(nodeId, { output: processedInputs, gotoDecision: decision }, false);

        // 5) If the matched rule says so, forward the input to the jump target
        if (decision && forward) {
          get().updateNodeData(decision, { _injectedInput: processedInputs }, false);
        }
      }
      else {
        await get().executeNode(nodeId);
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

      //  refresh rule applies to ALL nodes, not just goto
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




  moveConnection: (nodeId, type, edgeId, direction) =>
    set((state) => {
      const relevantEdges = state.edges.filter(edge =>
        type === 'input' ? edge.target === nodeId : edge.source === nodeId
      );
      const currentIndex = relevantEdges.findIndex(e => e.id === edgeId);
      const newIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;

      if (newIndex < 0 || newIndex >= relevantEdges.length) {
        return state;
      }

      const reorderedEdges = [...relevantEdges];
      [reorderedEdges[currentIndex], reorderedEdges[newIndex]] =
        [reorderedEdges[newIndex], reorderedEdges[currentIndex]];

      const otherEdges = state.edges.filter(edge =>
        type === 'input' ? edge.target !== nodeId : edge.source !== nodeId
      );

      return {
        edges: [...otherEdges, ...reorderedEdges]
      };
    }),


  // Add a dedicated method to stop node execution
  stopNodeExecution: (nodeId: string) => {
    const state = get();

    // If the node is not running, there's nothing to stop
    if (!state.nodeLoading[nodeId]) {
      return;
    }

    // Mark this node as being stopped
    state.stoppingNodes.add(nodeId);

    // Log that we're stopping the node
    state.addConsoleMessage({
      nodeId,
      type: 'log',
      message: `Stopping node execution...`,
      timestamp: Date.now(),
    });

    // Find the job ID for this node
    const node = state.nodes.find(n => n.id === nodeId);
    if (node && node.data && node.data.jobId) {
      // Create a stop signal file for the backend
      if (window.backendAPI?.createStopSignal) {
        window.backendAPI.createStopSignal(node.data.jobId)
          .then(() => {
            console.log(`Stop signal created for job ${node.data.jobId}`);

            // For nodes with dontWaitForOutput, we need to manually set the loading state to false
            // since the IPC handler won't do it for us (it returned immediately)
            if (node.data.dontWaitForOutput) {
              // Add a small delay to allow the backend to process the stop signal
              setTimeout(() => {
                state.setNodeLoading(nodeId, false);
                state.stoppingNodes.delete(nodeId);

                // Clear the job ID
                state.updateNodeData(nodeId, { jobId: undefined }, false);

                // Log that execution was stopped
                state.addConsoleMessage({
                  nodeId,
                  type: 'log',
                  message: `Node execution stopped`,
                  timestamp: Date.now(),
                });
              }, 500);
            }
          })
          .catch((err: Error) => {
            console.error(`Error creating stop signal: ${err.message}`);
          });
      }
    }

    // For regular nodes (not dontWaitForOutput), call executeNode with the stop action flag
    // For dontWaitForOutput nodes, we handle the state update in the createStopSignal callback above
    if (!node?.data.dontWaitForOutput) {
      state.executeNode(nodeId, true);
    }
  },

  executeNode: async (nodeId: string, isStopAction = false) => {
    const state = get();

    // Check if the node is already executing
    if (state.nodeLoading[nodeId] && !isStopAction) {
      // Node is already running, show a message in the console
      state.addConsoleMessage({
        nodeId,
        type: 'error',
        message: `Cannot execute node: already running`,
        timestamp: Date.now(),
      });
      return;
    }

    // If this is a stop action for a running node, handle it differently
    if (isStopAction && state.nodeLoading[nodeId]) {
      // Mark the node as no longer loading
      state.setNodeLoading(nodeId, false);

      // Remove from stopping nodes set
      state.stoppingNodes.delete(nodeId);

      // Clear the job ID
      state.updateNodeData(nodeId, { jobId: undefined }, false);

      // Log that execution was stopped
      state.addConsoleMessage({
        nodeId,
        type: 'log',
        message: `Node execution stopped`,
        timestamp: Date.now(),
      });

      return;
    }

    state.setNodeLoading(nodeId, true);
    const node = state.nodes.find((n) => n.id === nodeId);
    if (!node) return;

    // We don't clear previous output anymore to preserve it during execution
    // The output will be updated with new results when execution completes

    const addLog = (type: ConsoleMessage['type'], message: string) => {
      state.addConsoleMessage({
        nodeId,
        type,
        message,
        timestamp: Date.now(),
      });
    };

    // If this node has dontWaitForOutput set, log it
    if (node.data.dontWaitForOutput) {
      addLog('log', 'Node is set to not wait for output - execution will continue in parallel');
      addLog('log', 'This node will run indefinitely until manually stopped');
      // For nodes with dontWaitForOutput, we need to ensure the node stays in loading state
      // even after the IPC handler returns immediately
    }

    try {
      let result: any, log: any, error: any;
      if (node.data.type === 'goto') {
        // pass-through on manual execute
        const inEdges = state.edges.filter(e => e.target === nodeId);
        const inputNodes = inEdges
          .map(e => state.nodes.find(n => n.id === e.source))
          .filter((n): n is Node => n !== undefined);
        const inputs = await Promise.all(inputNodes.map(n => n.data.type === 'constant' ? n.data.value : n.data.output));
        const processedInputs = inputs.length === 1 ? inputs[0] : inputs;
        state.updateNodeData(nodeId, { output: processedInputs, gotoDecision: null }, false);
        state.setNodeLoading(nodeId, false);
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


          // If we have a relative path and no absolutePath, we need to resolve it
          if (node.data.isRelativePath && !node.data.absolutePath) {
            // Determine the base path for resolution
            // Use the node's flowFilePath if available (for nested flows), otherwise use the master flow path
            const basePath = node.data.flowFilePath || state.flowPath;

            if (basePath) {
              const baseDir = pathUtils.dirname(basePath || '');
              if (window.electronAPI?.getAbsolutePath) {
                flowPath = window.electronAPI.getAbsolutePath(flowPath, baseDir);
              } else {
                flowPath = get().convertToAbsolutePath(flowPath, baseDir);
              }
            } else {
              // If we have a relative path but no base path, we can't resolve it
              throw new Error('Cannot resolve relative path: flow file has not been saved');
            }
          }

          // Find input nodes and sort them by connection order
          const inputEdges = state.edges.filter(e => e.target === nodeId);
          const inputNodes = inputEdges
            .map(e => state.nodes.find(n => n.id === e.source))
            .filter((n): n is Node => n !== undefined);

          // Get input values from connected nodes
          const inputs = await Promise.all(inputNodes.map(async (inputNode) => {
            if (inputNode.data.type === 'constant') {
              return inputNode.data.value;
            }
            return inputNode.data.output;
          }));

          // -------- INJECTION-AWARE INPUT GATHERING (flow) --------
          let processedInputs: any;

          const injected = (node.data as any)?._injectedInput;
          if (typeof injected !== 'undefined') {
            processedInputs = injected;
            addLog('input', prettyFormat(processedInputs));
            // clear it so it’s single-use
            state.updateNodeData(nodeId, { _injectedInput: undefined }, false);
          } else {
            const inputEdges = state.edges.filter(e => e.target === nodeId);
            const inputNodes = inputEdges
              .map(e => state.nodes.find(n => n.id === e.source))
              .filter((n): n is Node => n !== undefined);

            const inputs = await Promise.all(inputNodes.map(async (inputNode) => {
              if (inputNode.data.type === 'constant') return inputNode.data.value;
              return inputNode.data.output;
            }));
            processedInputs = inputs.length === 1 ? inputs[0] : inputs;
            if (inputs.length > 0) addLog('input', prettyFormat(processedInputs));
          }
          // --------------------------------------------------------

          // Create a payload for the backend poller
          const payload = {
            id: 'job-' + Date.now() + '-' + Math.random().toString(36).slice(2),
            code: flowPath,
            type: 'flow',
            input: processedInputs,
            timeout: get().nodeExecutionTimeout,
            // Pass the directory of the flow file as the base path for resolving nested flows
            basePath: pathUtils.dirname(flowPath),
            // Store the flow file path for reference
            flowFilePath: flowPath
          };

          addLog('log', `Executing flow: ${flowPath}`);
          // Call the backend API to execute the flow
          const resultData = await (window as any).backendAPI.executeNodeJob(payload);

          // Process the result from the flow execution
          // The output could be any valid value, so we shouldn't filter based on string comparison
          result = resultData.output;

          // Get execution time if available (will be used later)

          // Process logs from nested flow execution
          // These logs will include the [Nested] prefix added by the backend
          log = resultData.log;

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

          error = resultData.error !== null && resultData.error !== 'null' ? resultData.error : null;

          // Calculate execution time - use the one from backend if available, otherwise calculate locally
          const executionTime = resultData.executionTime || (Date.now() - startTime);

          // Store execution time in node data
          node.data.executionTime = executionTime;

          // Ensure the node data is updated with the nested flow execution result
          state.updateNodeData(nodeId, { output: result, executionTime });
        } catch (err) {
          error = (err as Error).message;
        }
      } else {
        // Find input nodes and sort them by connection order
        const inputEdges = state.edges.filter(e => e.target === nodeId);
        const inputNodes = inputEdges
          .map(e => state.nodes.find(n => n.id === e.source))
          .filter((n): n is Node => n !== undefined);

        // -------- INJECTION-AWARE INPUT GATHERING (regular) --------
        let processedInputs: any;

        const injected = (node.data as any)?._injectedInput;
        if (typeof injected !== 'undefined') {
          processedInputs = injected;
          addLog('input', prettyFormat(processedInputs));
          // clear it so it’s single-use
          state.updateNodeData(nodeId, { _injectedInput: undefined }, false);
        } else {
          const inputEdges = state.edges.filter(e => e.target === nodeId);
          const inputNodes = inputEdges
            .map(e => state.nodes.find(n => n.id === e.source))
            .filter((n): n is Node => n !== undefined);

          const inputs = await Promise.all(inputNodes.map(async (inputNode) => {
            if (inputNode.data.type === 'constant') return inputNode.data.value;
            return inputNode.data.output;
          }));
          processedInputs = inputs.length === 1 ? inputs[0] : inputs;
          if (inputs.length > 0) addLog('input', prettyFormat(processedInputs));
        }
        // -----------------------------------------------------------

        const originalConsoleLog = console.log;
        let code = node.data.code?.trim() || '';
        if (node.data.codeFilePath && window.electronAPI?.readTextFile) {
          try {
            const flowPath = state.flowPath || ''; // fallback if no master flowPath available
            const codeFilePath = pathUtils.isAbsolute(node.data.codeFilePath)
              ? node.data.codeFilePath
              : pathUtils.join(pathUtils.dirname(flowPath), node.data.codeFilePath);

            code = await window.electronAPI.readTextFile(codeFilePath);
            // Optionally update the node state so the editor reflects the loaded code
            state.updateNodeData(nodeId, { code }, false);
            node.data.code = code;
          } catch (err) {
            addLog('error', `Failed to load code from file: ${node.data.codeFilePath}`);
            code = '';
          }
        }
        // --- NEW: Run JS directly if language is javascript ---
        if (node.data.language === 'javascript') {
          try {
            // Start execution time tracking
            const startTime = Date.now();

            // Generate a job ID for this execution
            const jobId = 'job-' + Date.now() + '-' + Math.random().toString(36).slice(2);

            // Store the job ID in the node data for potential termination
            state.updateNodeData(nodeId, { jobId }, false);

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

            const jobId = 'job-' + Date.now() + '-' + Math.random().toString(36).slice(2);

            let codeFilePath = node.data.codeFilePath;
            const flowPath = get().flowPath;
            const basePath = flowPath ? pathUtils.dirname(flowPath) : undefined;
            if (codeFilePath) {
              if (!pathUtils.isAbsolute(codeFilePath) && flowPath) {
                codeFilePath = pathUtils.join(pathUtils.dirname(flowPath), codeFilePath);
              }
            }

            const payload = {
              id: jobId,
              code: node.data.code,
              codeFilePath: codeFilePath,
              basePath: basePath,
              type: node.data.type,
              input: processedInputs,
              timeout: get().nodeExecutionTimeout,
              dontWaitForOutput: node.data.dontWaitForOutput
            };

            // Store the job ID in the node data for potential termination
            state.updateNodeData(nodeId, { jobId }, false);

            // For nodes with dontWaitForOutput, we need to ensure the jobId is preserved
            // so that the node can be stopped later
            // CALL THE EXPOSED API FROM PRELOAD
            const resultData = await (window as any).backendAPI.executeNodeJob(payload);
            result = resultData.output !== '[]' ? resultData.output : null;
            log = resultData.log;
            error = resultData.error !== null && resultData.error !== 'null' ? resultData.error : null;

            // For nodes with dontWaitForOutput, the resultData will have dontWaitForOutput=true
            // We need to preserve this information to maintain the loading state
            //if (resultData.dontWaitForOutput) {
            //  result = { ...result, dontWaitForOutput: true };
            //}

            // Calculate execution time
            const executionTime = resultData.executionTime || (Date.now() - startTime);

            // Store execution time in node data
            node.data.executionTime = executionTime;

            // For nodes with dontWaitForOutput, we need to keep the loading state active
            // since the process is still running in the background
            if (node.data.dontWaitForOutput && resultData.dontWaitForOutput) {
              // Keep the node in loading state
              // We'll only update the output, but keep the loading state and jobId
              state.updateNodeData(nodeId, {
                output: result,
                // Keep jobId to allow stopping the node later
              }, false);

              // Return early to prevent setting nodeLoading to false
              return;
            }
          }
        }
      }

      // Only set loading to false if this is not a dontWaitForOutput node
      // or if it's a dontWaitForOutput node that has actually completed
      if (!(node.data.dontWaitForOutput && result?.dontWaitForOutput)) {
        state.setNodeLoading(nodeId, false);
      }
      if (log) addLog('log', prettyFormat(log));
      if (result !== undefined && result !== null && typeof result === 'object' && 'output' in result) addLog('output', prettyFormat(result.output));
      else if (result !== undefined && result !== null) addLog('output', prettyFormat(result));
      if (error) addLog('error', prettyFormat(error));

      // For nodes with dontWaitForOutput, we need to keep the jobId
      // so that the node can be stopped later
      if (node.data.dontWaitForOutput && result?.dontWaitForOutput) {
        // Only update the output, keep the jobId
        state.updateNodeData(nodeId, {
          output: result
        });
      } else {
        // For regular nodes, update node data with result and clear jobId
        state.updateNodeData(nodeId, {
          output: result,
          jobId: undefined // Clear the job ID when execution is complete
        });
      }
    } catch (error: any) {
      addLog('error', `Error: ${error instanceof Error ? error.message : String(error)}`);
      state.setNodeLoading(nodeId, false);

      // Clear the job ID when an error occurs
      state.updateNodeData(nodeId, { jobId: undefined }, false);
    }
  },




}));