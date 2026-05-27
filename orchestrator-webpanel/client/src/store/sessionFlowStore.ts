import { Node, Edge } from 'reactflow';
import { useSessionStore } from './sessionStore';
import { pathUtils } from '../utils/pathUtils';
import { apiClient } from '../utils/apiClient';

// Import shared types
import { FlowState, ConsoleMessage, FlowStoreInterface } from './types';

// Import utilities
import { prettyFormat } from './utils/formatUtils';
import { collectVariables } from './utils/variableUtils';

// Import actions
import * as historyActions from './actions/historyActions';
import * as clipboardActions from './actions/clipboardActions';

// Import executors
import { executeNode as executeNodeInternal } from './executors/nodeExecutor';
import { executeFlow as executeFlowInternal } from './executors/flowExecutor';

// Import operations
import { saveFlow as saveFlowOperation, loadFlow as loadFlowOperation } from './operations/fileOperations';

// Re-export the FlowState interface for backward compatibility
export type { FlowState };

/**
 * Custom hook that provides the flow store interface using session store
 * This is the main entry point for accessing flow state and operations
 */
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

  // Create a session store getter for executors
  const getSessionStore = () => ({
    getActiveFlowState: sessionStore.getActiveFlowState,
    updateActiveFlowState: sessionStore.updateActiveFlowState,
    getSession: sessionStore.getSession,
    getActiveSession: sessionStore.getActiveSession,
    createSession: sessionStore.createSession,
  });

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

    // Basic setters
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

    // Starter node management
    setStarterNode: (nodeId: string) => {
      const nodes = activeFlowState.nodes;
      const starterNodeId = activeFlowState.starterNodeId;

      // Add to history
      const historyUpdate = historyActions.addToHistoryWithState(nodes, activeFlowState.edges, activeFlowState);

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
          ...historyUpdate
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
          ...historyUpdate
        });
      }
    },

    // History actions
    canUndo: () => historyActions.canUndo(activeFlowState),
    canRedo: () => historyActions.canRedo(activeFlowState),
    addToHistory: () => historyActions.addToHistory(activeFlowState, updateFlowState),
    undo: () => historyActions.undo(activeFlowState, updateFlowState),
    redo: () => historyActions.redo(activeFlowState, updateFlowState),

    // Clipboard actions
    copySelectedNodes: (nodeIds: string[]) =>
      clipboardActions.copySelectedNodes(nodeIds, activeFlowState.nodes, activeFlowState.edges),
    getClipboardNodes: () => clipboardActions.getClipboardNodes(),
    pasteNodes: () => clipboardActions.pasteNodes(activeFlowState, updateFlowState),
    clearNodeSelection: (targetedNodes: Node[]) =>
      clipboardActions.clearNodeSelection(targetedNodes, activeFlowState.nodes, updateFlowState),

    // Flow management
    clearFlow: () => {
      updateFlowState({
        nodes: [],
        edges: [],
        flowPath: null,
        history: [],
        historyIndex: -1
      });
    },

    // Node and edge management
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
      console.log(`Removing node ${nodeId}`);
      updateFlowState({
        nodes: activeFlowState.nodes.filter(n => n.id !== nodeId),
        edges: activeFlowState.edges.filter(e => e.source !== nodeId && e.target !== nodeId)
      });
    },
    updateNodeData: (nodeId, data, addHistory = true) => {
      if (addHistory) {
        const historyUpdate = historyActions.addToHistoryWithState(
          activeFlowState.nodes,
          activeFlowState.edges,
          activeFlowState
        );
        updateFlowState({
          nodes: activeFlowState.nodes.map((node) =>
            node.id === nodeId ? { ...node, data: { ...node.data, ...data } } : node
          ),
          ...historyUpdate
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

    // Console management
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

    // Connection management
    removeConnection: (edgeId) => updateFlowState({
      edges: activeFlowState.edges.filter((edge) => edge.id !== edgeId)
    }),
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

    // Editor modal management
    openEditorModal: (nodeId) => {
      updateFlowState({ editorModal: { isOpen: true, nodeId } });
    },
    closeEditorModal: () => updateFlowState({ editorModal: { isOpen: false, nodeId: null } }),

    // Node execution
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
        // Stop job via HTTP API — the polling loop in executeNode will see the
        // 'stopped' status and clear the loading/jobId state.
        apiClient.stopJob(node.data.jobId)
          .then(() => {
            console.log(`Stop signal sent for job ${node.data.jobId}`);
          })
          .catch((err: Error) => {
            console.error(`Error stopping job: ${err.message}`);
          });
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
      await executeNodeInternal(nodeId, false, getSessionStore);
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
      // Local walker: gives live per-node feedback in the editor console and
      // preserves the legacy api-server.cjs log streaming behavior. The walker
      // submits each node through /api/v1/jobs with the linked flow's workerId,
      // so script-type nodes get dispatched to the assigned worker server-side.

      // If a session in the current flow scope is marked as main, load it before running.
      const ss = useSessionStore.getState();
      const active = ss.getActiveSession();
      const scopeFlowId = active?.linkedFlowId ?? null;
      const main = ss.sessions.find(s => s.isMain && (s.linkedFlowId ?? null) === scopeFlowId);
      if (main && main.id !== ss.activeSessionId) {
        ss.switchSession(main.id);
      }

      await executeFlowInternal(getSessionStore);
    },

    // File operations
    saveFlow: async () => {
      await saveFlowOperation(getSessionStore);
    },

    loadFlow: async () => {
      await loadFlowOperation(getSessionStore);
    },
  };
};
