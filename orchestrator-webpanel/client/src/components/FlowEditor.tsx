import React, { useCallback, useEffect, useState, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import FlowNodeCreationModal from './FlowNodeCreationModal';
import FlowEditorToolbar from './FlowEditorToolbar';
import NodeCreationMenu from './NodeCreationMenu';

import ReactFlow, {
  Edge,
  Background,
  NodeTypes,
  OnNodesChange,
  Connection,
  getOutgoers,
  addEdge,
  applyNodeChanges,
  useReactFlow,
  ReactFlowProvider,
  IsValidConnection,
  Node,
} from 'reactflow';
import 'reactflow/dist/style.css';
import { useFlowStore } from '../store/sessionFlowStore';
import { useSessionStore } from '../store/sessionStore';
import CustomNode from './node/CustomNode';
import Console from './Console';
import { useTheme } from '../context/ThemeContext';
import { NODE_TYPES } from '../constants/nodeTypes';
import { getLayoutedElements } from '../utils/flowLayout';
import { useKeyboardShortcuts } from '../hooks/useKeyboardShortcuts';
import {
  handleFlowNodeFromSession as flowNodeFromSessionHandler,
  handleFlowNodeFromFile as flowNodeFromFileHandler,
  handleFlowNodeFromLibrary as flowNodeFromLibraryHandler,
} from '../utils/flowNodeHandlers';

import CommentNode from './node/CommentNode';

const nodeTypes: NodeTypes = {
  custom: CustomNode,
  comment: CommentNode,
};

interface FlowEditorProps {
  embedded?: boolean;
  readOnly?: boolean;
  flowId?: string;
}

function Flow({ embedded = false, readOnly = false, flowId }: FlowEditorProps) {
  const navigate = useNavigate();
  const { theme } = useTheme();
  const edgeLabelStyles = useMemo(() => {
    const isDark = theme === 'dark';
    return {
      labelStyle: {
        fontSize: 10,
        fill: isDark ? '#e5e7eb' /* gray-200 */ : '#475569' /* slate-600 */,
      },
      labelBgStyle: {
        fill: isDark ? 'rgba(17,24,39,0.9)' /* gray-900 */ : 'rgba(255,255,255,0.9)',
      },
      labelBgPadding: [8, 4] as [number, number],
      labelBgBorderRadius: 4,
    };
  }, [theme]);

  const {
    nodes,
    edges,
    setNodes,
    setEdges,
    saveFlow,
    loadFlow,
    executeFlow,
    stopFlow,
    panOnDrag,
    zoomOnScroll,
    clearFlow,
    updateNodeData,
    openEditorModal,
    clearAllOutputs,
    // History navigation
    undo,
    redo,
    canUndo,
    canRedo,
    // Copy/Paste functionality
    copySelectedNodes,
    pasteNodes,
    // Additional state needed for keyboard shortcuts
    isOutputZoneActive,
    isTitleEditing,
    editorModal,
    isMouseOverConsole,
    addToHistory,
  } = useFlowStore();

  // Add state for edge animations
  const { fitView, getNodes, getEdges, screenToFlowPosition } = useReactFlow();
  const [contextMenu, setContextMenu] = useState<null | {
    x: number;
    y: number;
    flowX: number;
    flowY: number;
  }>(null);

  const [dropdownMenu, setDropdownMenu] = useState(false);
  const [selectedNodes, setSelectedNodes] = useState<string[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [flowNodeModal, setFlowNodeModal] = useState<{
    isOpen: boolean;
    position?: { x: number; y: number };
  }>({ isOpen: false });

  // Get active session ID to detect session switches
  const activeSessionId = useSessionStore((state) => state.activeSessionId);
  const prevSessionIdRef = useRef<string | null>(null);

  // Some browsers/layouts mount this editor before the container has a real
  // size (e.g. it's inside a tab that just became visible). When that happens
  // ReactFlow measures 0×0, `fitView` is a no-op and `onlyRenderVisibleElements`
  // culls every node — so the canvas looks empty until a resize/scroll forces a
  // re-measure. Watch the wrapper and re-fit the first time it has real
  // dimensions so the graph shows up immediately.
  const wrapperRef = useRef<HTMLDivElement>(null);
  const didInitialFitRef = useRef(false);
  useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      if (didInitialFitRef.current) return;
      const { width, height } = el.getBoundingClientRect();
      if (width > 0 && height > 0) {
        didInitialFitRef.current = true;
        // Defer a frame so ReactFlow has picked up the same dimensions.
        requestAnimationFrame(() => {
          fitView({ padding: 0.2, minZoom: 0.3, maxZoom: 1.5 });
        });
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [fitView]);

  // Auto-fit view when switching sessions
  useEffect(() => {
    // Skip on initial render (when prevSessionIdRef is null and we're just mounting)
    if (prevSessionIdRef.current !== null && prevSessionIdRef.current !== activeSessionId) {
      // Session changed - fit view with a small delay to let nodes render
      setTimeout(() => {
        fitView({
          padding: 0.2,
          duration: 400,
          minZoom: 0.5,
          maxZoom: 1.5,
        });
      }, 50);
    }
    prevSessionIdRef.current = activeSessionId;
  }, [activeSessionId, fitView]);

  // Function to create a new flow
  const createNewFlow = () => {
    clearFlow(); // This clears nodes, edges, and sets flowPath to null
    // TODO: Replace with browser API for title management
    // window.electronAPI?.setTitle?.('New Flow');
  };

  // Handle copy selected nodes
  const handleCopyNodes = useCallback(() => {
    if (selectedNodes.length > 0) {
      copySelectedNodes(selectedNodes);
    }
  }, [selectedNodes, copySelectedNodes]);

  // Handle paste nodes with deselection
  const handlePasteNodes = useCallback(() => {
    pasteNodes();
    // Note: pasteNodes now handles deselection internally
  }, [pasteNodes]);

  const handlePrettifyFlow = () => {
    // Only layout non-comment nodes
    const nonCommentNodes = nodes.filter((n) => n.type !== 'comment');
    const commentNodes = nodes.filter((n) => n.type === 'comment');
    const layoutedNodes = getLayoutedElements(nonCommentNodes, edges);

    // Merge back comment nodes, preserving their original positions
    const allNodes = [...layoutedNodes, ...commentNodes].sort((a, b) => {
      // Keep original order (optional)
      return nodes.findIndex((n) => n.id === a.id) - nodes.findIndex((n) => n.id === b.id);
    });

    setNodes(allNodes);

    setTimeout(() => {
      fitView({
        padding: 0.2,
        duration: 800,
        minZoom: 0.5,
        maxZoom: 1.5,
      });
    }, 50);
  };

  // Add keyboard shortcuts
  useKeyboardShortcuts({
    clearFlow,
    executeFlow,
    clearAllOutputs,
    undo,
    redo,
    canUndo,
    canRedo,
    selectedNodes,
    copySelectedNodes,
    handlePasteNodes,
    createNewFlow,
    handlePrettifyFlow,
    editorModal,
    isOutputZoneActive,
    isTitleEditing,
    isMouseOverConsole,
  });

  const isValidConnection: IsValidConnection = useCallback(
    (connection) => {
      // we are using getNodes and getEdges helpers here
      // to make sure we create isValidConnection function only once
      const nodes = getNodes();
      const edges = getEdges();
      const target = nodes.find((node) => node.id === connection.target);
      const hasCycle = (node: Node, visited = new Set()) => {
        if (visited.has(node.id)) return false;

        visited.add(node.id);

        for (const outgoer of getOutgoers(node, nodes, edges)) {
          if (outgoer.id === connection.source) return true;
          if (hasCycle(outgoer, visited)) return true;
        }
      };
      if (!target) return false;
      if (target.id === connection.source) return false;
      return !hasCycle(target);
    },
    [getNodes, getEdges]
  );

  const onNodesChange: OnNodesChange = useCallback(
    (changes) => {
      // Check if any of the changes is a position change (dragging)
      const hasDragChange = changes.some(
        (change) => change.type === 'position' && change.dragging !== undefined
      );

      // If there's a drag change, update the dragging state
      if (hasDragChange) {
        const isDraggingNow = changes.some(
          (change) => change.type === 'position' && change.dragging === true
        );

        if (isDraggingNow !== isDragging) {
          setIsDragging(isDraggingNow);

          // If dragging just ended, add to history
          if (isDragging && !isDraggingNow) {
            // Add to history after the position update is applied
            setTimeout(() => {
              addToHistory();
            }, 0);
          }
        }
      }

      // During dragging, don't add to history
      if (isDragging) {
        // Apply changes directly without adding to history
        const updatedNodes = applyNodeChanges(changes, nodes);
        // Use the store's set function directly to avoid adding to history
        setNodes(updatedNodes);
      } else {
        // For non-dragging changes, use the normal setNodes which adds to history
        setNodes((nds) => applyNodeChanges(changes, nds));
      }
    },
    [setNodes, isDragging, nodes, addToHistory]
  );

  // Build dashed, labeled edges for forwardInput + restyle real edges if they match
  const displayEdges = useMemo<Edge[]>(() => {
    // Map forward pairs and the condition text(s)
    const forwardLabels = new Map<string, string[]>();
    const nodeIds = new Set(nodes.map((n) => n.id));

    nodes.forEach((n) => {
      if (n.data?.type !== 'goto') return;
      const conds = Array.isArray(n.data?.conditions) ? n.data.conditions : [];
      conds.forEach((c: any) => {
        if (c?.forwardInput && c?.goto && nodeIds.has(c.goto)) {
          const key = `${n.id}->${c.goto}`;
          const label = (c.expr ?? '').trim() || '(no expr)';
          if (!forwardLabels.has(key)) forwardLabels.set(key, []);
          forwardLabels.get(key)!.push(label);
        }
      });
    });

    // Helper to join multiple conditions to the same (source,target)
    const labelFor = (key: string) => {
      const arr = forwardLabels.get(key);
      if (!arr || arr.length === 0) return undefined;
      return arr.length === 1 ? arr[0] : arr.map((s) => `(${s})`).join(' OR ');
    };

    // Restyle any existing edges that match a forward pair + attach label
    const restyled = edges.map((e) => {
      const key = `${e.source}->${e.target}`;
      if (!forwardLabels.has(key)) return e;
      return {
        ...e,
        style: { ...(e.style || {}), strokeDasharray: '4 6', strokeWidth: 1.25 },
        animated: true,
        label: labelFor(key),
        data: { ...(e.data || {}), __forwardOverlay: false },
      };
    });

    // Add synthetic dashed edges for forward pairs that don't exist as real edges
    const existingKeys = new Set(restyled.map((e) => `${e.source}->${e.target}`));
    const synthetic: Edge[] = [];
    forwardLabels.forEach((_labels, key) => {
      if (existingKeys.has(key)) return;
      const [source, target] = key.split('->');
      synthetic.push({
        id: `fwd-${source}-${target}`,
        source,
        target,
        type: 'smoothstep',
        style: { strokeDasharray: '4 6', strokeWidth: 1.25, opacity: 0.9 },
        animated: true,
        focusable: false,
        deletable: false,
        interactionWidth: 0,
        data: { __forwardOverlay: true },
        zIndex: 0,
        label: labelFor(key),
        labelStyle: edgeLabelStyles.labelStyle,
        labelBgStyle: edgeLabelStyles.labelBgStyle,
        labelBgPadding: edgeLabelStyles.labelBgPadding,
        labelBgBorderRadius: edgeLabelStyles.labelBgBorderRadius,
      });
    });

    return [...restyled, ...synthetic];
  }, [nodes, edges, edgeLabelStyles]);

  const onConnect = useCallback(
    (params: Connection) => setEdges((eds) => addEdge({ ...params, id: `e${Date.now()}` }, eds)),
    [setEdges]
  );

  const getUniqueNodeLabel = (baseLabel: string) => {
    const existingLabels = nodes.map((node) => node.data.label);
    let counter = 1;
    let newLabel = baseLabel;

    while (existingLabels.includes(newLabel)) {
      newLabel = `${baseLabel} ${counter}`;
      counter++;
    }

    return newLabel;
  };

  // For context menu (right-click in pane)
  const handlePaneContextMenu = useCallback(
    (event: React.MouseEvent) => {
      event.preventDefault();
      const bounds = event.currentTarget.getBoundingClientRect();
      const flowPoint = screenToFlowPosition({
        x: event.clientX - bounds.left,
        y: event.clientY - bounds.top,
      });
      setContextMenu({
        x: event.clientX, // <- screen X for menu position
        y: event.clientY - 46, // <- screen Y for menu position
        flowX: flowPoint.x, // <- if you want to use for node creation
        flowY: flowPoint.y + 23,
      });
      setDropdownMenu(false);
    },
    [screenToFlowPosition]
  );

  // For Add Node button (dropdown)
  const handleAddNodeClick = () => {
    setDropdownMenu(true);
    setContextMenu(null); // close context menu if open
  };

  const closeMenus = () => {
    setContextMenu(null);
    setDropdownMenu(false);
  };

  // When clicking anywhere else, close all menus
  const handlePaneClick = () => {
    closeMenus();
  };

  const addNewNode = async (type: string, pos?: { x: number; y: number }) => {
    if (readOnly) return;
    // Handle flow node type - show modal for selection
    if (type === 'flow') {
      setFlowNodeModal({ isOpen: true, position: pos });
      closeMenus();
      return;
    }
    const nodeType = NODE_TYPES.find((t) => t.id === type);
    if (!nodeType) return;
    const uniqueLabel = getUniqueNodeLabel(nodeType.label);
    let position = pos;

    if (!position) {
      const container = document.querySelector('.react-flow') as HTMLElement;
      let center;
      if (container) {
        const rect = container.getBoundingClientRect();
        center = { x: rect.width / 2, y: rect.height / 2 };
        position = screenToFlowPosition(center);
      } else {
        position = { x: 100, y: 100 };
      }
    }

    // goto node behavior
    if (type === 'goto') {
      const newNode = {
        id: `node-${Date.now()}`,
        type: 'custom',
        position,
        data: {
          label: 'Goto',
          type: 'goto',

          conditions: [
            // starter example row users can edit/remove:
            { expr: 'input < 50', goto: '', forwardInput: true },
          ],
        },
        draggable: true,
      };

      setNodes((nds) => [...nds, newNode]);
      closeMenus();
      return;
    }
    // Comment nodes only have label/value, and type "comment"
    const newNode =
      type === 'comment'
        ? {
            id: `node-${Date.now()}`,
            type: 'comment',
            position,
            data: {
              label: uniqueLabel,
              value: nodeType.value || '',
              type: 'comment',
            },
            draggable: true,
          }
        : {
            id: `node-${Date.now()}`,
            type: 'custom',
            position,
            data: {
              label: uniqueLabel,
              type: type,
              language: type === 'variable' ? undefined : type,
              code: type === 'variable' ? undefined : nodeType.code,
              value: type === 'variable' ? nodeType.value : undefined,
            },
            draggable: true,
          };

    setNodes((nds) => [...nds, newNode]);
    closeMenus();
  };

  // Handle opening the editor modal for flow nodes
  const handleNodeDoubleClick = async (event: React.MouseEvent, node: Node) => {
    if (readOnly) return;
    // In browser environment, we can't access external files directly
    // The code is already stored in the node data, so we just open the editor

    if (node.data.type === 'flow') {
      // flowRef node: navigate to the referenced flow in the library
      if (node.data.flowRef) {
        navigate(`/flows/${node.data.flowRef}?tab=edit`);
        return;
      }

      // For flow nodes, open or switch to linked session
      try {
        const sessionStore = useSessionStore.getState();

        // Check if this flow node already has a linked session
        if (node.data.linkedSessionId) {
          const linkedSession = sessionStore.getSession(node.data.linkedSessionId);
          if (linkedSession) {
            // Switch to the existing linked session
            sessionStore.switchSession(node.data.linkedSessionId);
            return;
          }
          // If linked session doesn't exist anymore, clear the link and create new one
          updateNodeData(node.id, { linkedSessionId: undefined }, false);
        }

        // Create a new linked session
        const sessionName = `Flow: ${node.data.label || 'Untitled'}`;
        const parentFlowId = sessionStore.getActiveSession()?.linkedFlowId;
        const newSessionId = await sessionStore.createSession(sessionName, parentFlowId);

        // Parse the flow content from code field
        let flowData: { nodes: Node[]; edges: Edge[] } | null = null;
        if (node.data.code) {
          try {
            flowData = JSON.parse(node.data.code);
          } catch (error) {
            console.error('Error parsing flow content:', error);
          }
        }

        // Load the flow data into the new session
        if (flowData && Array.isArray(flowData.nodes) && Array.isArray(flowData.edges)) {
          sessionStore.updateActiveFlowState({
            nodes: flowData.nodes,
            edges: flowData.edges,
            flowPath: `${node.data.label}.or`,
            history: [],
            historyIndex: -1,
          });
        } else {
          // Initialize with empty flow
          sessionStore.updateActiveFlowState({
            nodes: [],
            edges: [],
            flowPath: `${node.data.label}.or`,
            history: [],
            historyIndex: -1,
          });
        }

        // Link the session to the flow node
        updateNodeData(node.id, { linkedSessionId: newSessionId }, false);

        // Switch to the new session
        sessionStore.switchSession(newSessionId);
      } catch (error) {
        console.error('Error creating session for flow:', error);
        alert(`Error opening flow: ${error instanceof Error ? error.message : String(error)}`);
      }
      return;
    } else if (node.data.type !== 'goto' && node.data.type !== 'variable') {
      // For other node types (not goto, variable), open the regular editor modal
      openEditorModal(node.id);
    }
  };

  // Track selected nodes
  const onSelectionChange = useCallback(({ nodes }: { nodes: Node[] }) => {
    setSelectedNodes(nodes.map((node) => node.id));
  }, []);

  // Handle flow node creation from existing session (link directly to it)
  const handleFlowNodeFromSession = useCallback(
    (sessionId: string, sessionName: string) => {
      flowNodeFromSessionHandler({
        sessionId,
        sessionName,
        position: flowNodeModal.position || { x: 100, y: 100 },
        setNodes,
      });
    },
    [flowNodeModal.position, setNodes]
  );

  // Handle flow node creation from file upload (create new session)
  const handleFlowNodeFromFile = useCallback(
    async (file: File) => {
      await flowNodeFromFileHandler({
        file,
        position: flowNodeModal.position || { x: 100, y: 100 },
        setNodes,
        currentSessionId: useSessionStore.getState().activeSessionId,
        parentFlowId: flowId,
      });
    },
    [flowNodeModal.position, setNodes, flowId]
  );

  // Handle flow node creation referencing a library flow by ID
  const handleFlowNodeFromLibrary = useCallback(
    (refFlowId: string, refFlowName: string) => {
      flowNodeFromLibraryHandler({
        flowId: refFlowId,
        flowName: refFlowName,
        position: flowNodeModal.position || { x: 100, y: 100 },
        setNodes,
      });
    },
    [flowNodeModal.position, setNodes]
  );

  return (
    <div ref={wrapperRef} className="w-full h-full relative" style={{ height: embedded ? '100%' : 'calc(100vh - 46px)' }}>
      <ReactFlow
        className="react-flow__dark"
        nodes={nodes}
        edges={displayEdges}
        onNodesChange={readOnly ? undefined : onNodesChange}
        onConnect={readOnly ? undefined : onConnect}
        nodeTypes={nodeTypes}
        fitView
        snapToGrid={true}
        snapGrid={[15, 15]}
        deleteKeyCode="Delete"
        onPaneClick={handlePaneClick}
        minZoom={0.1}
        maxZoom={2}
        nodesDraggable={!readOnly}
        nodesConnectable={!readOnly}
        elementsSelectable={!readOnly}
        panOnDrag={readOnly ? true : panOnDrag}
        panOnScroll={false}
        zoomOnScroll={zoomOnScroll}
        zoomOnPinch={false}
        onlyRenderVisibleElements={true}
        isValidConnection={isValidConnection}
        onPaneContextMenu={readOnly ? undefined : handlePaneContextMenu}
        onNodeDoubleClick={readOnly ? undefined : handleNodeDoubleClick}
        onSelectionChange={readOnly ? undefined : onSelectionChange}
        multiSelectionKeyCode="Shift"
        panActivationKeyCode={null}
        defaultEdgeOptions={{
          type: 'smoothstep',
          style: { strokeDasharray: '6 4', strokeWidth: 2 },
          animated: true,
        }}
        proOptions={{ hideAttribution: true }}
      >
        <Background />
        <FlowEditorToolbar
          embedded={embedded}
          readOnly={readOnly}
          createNewFlow={createNewFlow}
          saveFlow={saveFlow}
          loadFlow={loadFlow}
          clearFlow={clearFlow}
          executeFlow={executeFlow}
          stopFlow={stopFlow}
          undo={undo}
          redo={redo}
          canUndo={canUndo}
          canRedo={canRedo}
          handleCopyNodes={handleCopyNodes}
          handlePasteNodes={handlePasteNodes}
          selectedNodes={selectedNodes}
          handlePrettifyFlow={handlePrettifyFlow}
          clearAllOutputs={clearAllOutputs}
          handleAddNodeClick={handleAddNodeClick}
          dropdownMenu={dropdownMenu}
          addNewNode={addNewNode}
        />
        {contextMenu && !readOnly && (
          <NodeCreationMenu
            onAddNode={addNewNode}
            position={{ x: contextMenu.x, y: contextMenu.y }}
            flowPosition={{ x: contextMenu.flowX, y: contextMenu.flowY }}
            type="context"
          />
        )}
      </ReactFlow>
      {!readOnly && <Console />}

      {/* Flow Node Creation Modal */}
      {!readOnly && <FlowNodeCreationModal
        isOpen={flowNodeModal.isOpen}
        onClose={() => setFlowNodeModal({ isOpen: false })}
        onSelectSession={handleFlowNodeFromSession}
        onUploadFile={handleFlowNodeFromFile}
        onSelectLibraryFlow={handleFlowNodeFromLibrary}
        flowId={flowId}
      />}
    </div>
  );
}

export default function FlowEditor(props: FlowEditorProps) {
  return (
    <ReactFlowProvider>
      <Flow {...props} />
    </ReactFlowProvider>
  );
}
