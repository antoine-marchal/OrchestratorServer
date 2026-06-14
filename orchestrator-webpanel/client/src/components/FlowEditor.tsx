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
import { useUIStore } from '../store/uiStore';
import { useFlowLibraryStore } from '../store/flowLibraryStore';
import { flowsApi } from '../api';
import { openFlowNodeEditor, makeFlowNode } from '../store/flowNodeContent';
import { sanitizeNodesForSave, sanitizeEdgesForSave } from '../utils/flowSanitize';
import CustomNode from './node/CustomNode';
import Console from './Console';
import { useTheme } from '../context/ThemeContext';
import { NODE_TYPES } from '../constants/nodeTypes';
import { getLayoutedElements } from '../utils/flowLayout';
import { useKeyboardShortcuts } from '../hooks/useKeyboardShortcuts';
import {
  handleFlowNodeFromFile as flowNodeFromFileHandler,
  handleFlowNodeFromLibrary as flowNodeFromLibraryHandler,
  handleFlowNodeNewSession as flowNodeNewSessionHandler,
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
  versionsVisible?: boolean;
  onToggleVersions?: () => void;
}

function Flow({ embedded = false, readOnly = false, flowId, versionsVisible, onToggleVersions }: FlowEditorProps) {
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
  // Transient hint shown when a connection drag is rejected by
  // isValidConnection (otherwise the drag just vanishes with no explanation).
  const [connectHint, setConnectHint] = useState<string | null>(null);
  const connectStartNodeRef = useRef<string | null>(null);
  const connectMadeRef = useRef(false);
  const connectHintTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
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

  // Force a version snapshot on the server right now (bypasses the autosave
  // debounce window). Push the live canvas graph first so the snapshot captures
  // exactly what the user sees, then create the manual version and reveal the
  // history panel so the new entry is visible.
  const forceSaveVersion = useCallback(async () => {
    if (!flowId) return;
    try {
      // Use the shared sanitizer so manual snapshots strip exactly the same
      // transient UI/run state as autosave (selection, drag, measured size,
      // output, executionTime, …) — keeps git diffs to real edits.
      const cleanNodes = sanitizeNodesForSave(getNodes() as any[]);
      const cleanEdges = sanitizeEdgesForSave(getEdges() as any[]);
      // Await the persist so the snapshot below sees the latest graph.
      await flowsApi.update(flowId, { nodes: cleanNodes, edges: cleanEdges });
      // Keep the local library mirror in sync (drives the version-diff view).
      useFlowLibraryStore.getState().updateFlow(flowId, { nodes: cleanNodes, edges: cleanEdges });
      await flowsApi.createVersion(flowId);
      if (!versionsVisible) onToggleVersions?.();
    } catch (e) {
      console.error('Force save version failed:', e);
    }
  }, [flowId, getNodes, getEdges, versionsVisible, onToggleVersions]);

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

        // Goto nodes are explicit, condition-guarded loop points. A cycle that
        // closes through a Goto can always terminate (its condition decides
        // whether to jump), so paths through a Goto are NOT illegal infinite
        // loops — stop traversal here. Cycles with no Goto on the path are real
        // infinite loops and stay blocked.
        if ((node.data as any)?.type === 'goto') return false;

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
        if (!c?.forwardInput) return;
        const targets: string[] = (Array.isArray(c?.goto) ? c.goto : c?.goto ? [c.goto] : []);
        targets.forEach((t) => {
          if (!nodeIds.has(t)) return;
          const key = `${n.id}->${t}`;
          const label = (c.expr ?? '').trim() || '(no expr)';
          if (!forwardLabels.has(key)) forwardLabels.set(key, []);
          forwardLabels.get(key)!.push(label);
        });
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
    (params: Connection) => {
      connectMadeRef.current = true;
      setEdges((eds) => addEdge({ ...params, id: `e${Date.now()}` }, eds));
    },
    [setEdges]
  );

  const showConnectHint = useCallback((msg: string) => {
    setConnectHint(msg);
    if (connectHintTimer.current) clearTimeout(connectHintTimer.current);
    connectHintTimer.current = setTimeout(() => setConnectHint(null), 4000);
  }, []);

  const onConnectStart = useCallback(
    (_e: unknown, params: { nodeId?: string | null }) => {
      connectStartNodeRef.current = params?.nodeId ?? null;
      connectMadeRef.current = false;
    },
    []
  );

  // ReactFlow drops a rejected connection silently (isValidConnection returned
  // false). Detect the case where the drag ended on another node's handle but
  // no edge was created, and explain why — almost always a cycle, which the
  // editor forbids (loops are expressed via a Goto node's condition instead).
  const onConnectEnd = useCallback(
    (event: MouseEvent | TouchEvent) => {
      if (connectMadeRef.current) return;
      // During a connection drag ReactFlow overlays a connection line, so
      // event.target is usually that line, not the handle under the cursor.
      // Resolve what's actually beneath the drop point instead.
      const pt: { clientX: number; clientY: number } | undefined =
        'changedTouches' in event ? event.changedTouches[0] : (event as MouseEvent);
      const el = pt ? (document.elementFromPoint(pt.clientX, pt.clientY) as Element | null) : null;
      const handle = el?.closest?.('.react-flow__handle');
      if (!handle) return; // dropped on empty canvas — normal cancel, no hint
      const targetNodeId = handle.closest('.react-flow__node')?.getAttribute('data-id') ?? null;
      const sourceNodeId = connectStartNodeRef.current;
      if (targetNodeId && sourceNodeId && targetNodeId === sourceNodeId) {
        showConnectHint("Can't connect a node to itself.");
      } else {
        showConnectHint('Connection blocked — it would create a loop. To loop back, use a Goto node condition.');
      }
    },
    [showConnectHint]
  );

  useEffect(() => () => { if (connectHintTimer.current) clearTimeout(connectHintTimer.current); }, []);

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
      // Cascade away from any node already near this spot so new nodes from the
      // "Add Node" button don't all stack on the exact viewport center.
      const tooClose = (p: { x: number; y: number }) =>
        nodes.some((n) => Math.abs(n.position.x - p.x) < 40 && Math.abs(n.position.y - p.y) < 40);
      let guard = 0;
      while (tooClose(position) && guard < 50) {
        position = { x: position.x + 40, y: position.y + 40 };
        guard++;
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
  const handleNodeDoubleClick = async (_event: React.MouseEvent, node: Node) => {
    if (readOnly) return;
    // In browser environment, we can't access external files directly
    // The code is already stored in the node data, so we just open the editor

    if (node.data.type === 'flow') {
      try {
        const { navigateTo } = await openFlowNodeEditor(node, useSessionStore.getState().activeSessionId);
        if (navigateTo) navigate(navigateTo);
      } catch (error) {
        console.error('Error opening flow node:', error);
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

  // Handle flow node creation from an existing session — live OR closed. A
  // closed session has no store entry, so reconstruct its snapshot from any flow
  // node that still references it (avoids the "Session not found" error).
  const handleFlowNodeFromSession = useCallback(
    (sessionId: string, sessionName: string) => {
      const position = flowNodeModal.position || { x: 100, y: 100 };
      const live = useSessionStore.getState().getSession(sessionId);
      let code: string;
      if (live) {
        code = JSON.stringify({ nodes: live.flowState.nodes, edges: live.flowState.edges });
      } else {
        const ref = nodes.find((n) => n.data?.linkedSessionId === sessionId && n.data?.code);
        code = ref?.data?.code || JSON.stringify({ nodes: [], edges: [] });
      }
      const newNode = makeFlowNode({ label: sessionName, linkedSessionId: sessionId, code, position });
      setNodes((nds) => [...nds, newNode]);
    },
    [flowNodeModal.position, setNodes, nodes]
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

  // Create flow node from a brand-new empty session (create modal).
  const handleFlowNodeNewSession = useCallback(() => {
    flowNodeNewSessionHandler({
      position: flowNodeModal.position || { x: 100, y: 100 },
      setNodes,
      parentFlowId: flowId,
    });
  }, [flowNodeModal.position, setNodes, flowId]);

  // ---- Re-point an EXISTING flow node ("Modify Flow Node") — issue 3 ----
  const repointNodeId = useUIStore((s) => s.repointNodeId);
  const setRepointNodeId = useUIStore((s) => s.setRepointNodeId);
  const repointNode = repointNodeId ? nodes.find((n) => n.id === repointNodeId) : null;

  // Sub-flow sessions of this flow whose tab was closed — still reachable via the
  // flow nodes that reference them, so they stay selectable in the modal.
  const closedSessions = useMemo(() => {
    const live = new Set(useSessionStore.getState().sessions.map((s) => s.id));
    const seen = new Set<string>();
    const out: Array<{ id: string; name: string }> = [];
    for (const n of nodes) {
      const sid = n.data?.type === 'flow' ? n.data?.linkedSessionId : null;
      if (sid && !live.has(sid) && !seen.has(sid)) { seen.add(sid); out.push({ id: sid, name: n.data?.label || sid }); }
    }
    return out;
  }, [nodes, repointNodeId]);

  const repointSelectSession = useCallback((sid: string) => {
    if (!repointNodeId) return;
    const live = useSessionStore.getState().getSession(sid);
    let code = '';
    if (live) code = JSON.stringify({ nodes: live.flowState.nodes, edges: live.flowState.edges });
    else { const ref = nodes.find((n) => n.data?.linkedSessionId === sid && n.data?.code); code = ref?.data?.code || ''; }
    updateNodeData(repointNodeId, { linkedSessionId: sid, flowRef: undefined, code });
    setRepointNodeId(null);
  }, [repointNodeId, nodes, updateNodeData, setRepointNodeId]);

  const repointSelectLibrary = useCallback((refFlowId: string) => {
    if (!repointNodeId) return;
    updateNodeData(repointNodeId, { flowRef: refFlowId, linkedSessionId: undefined, code: '' });
    setRepointNodeId(null);
  }, [repointNodeId, updateNodeData, setRepointNodeId]);

  const repointUploadFile = useCallback(async (file: File) => {
    if (!repointNodeId) return;
    try {
      const text = await file.text();
      updateNodeData(repointNodeId, { code: text, linkedSessionId: undefined, flowRef: undefined });
    } catch (e) {
      alert(`Error reading flow file: ${e instanceof Error ? e.message : String(e)}`);
    }
    setRepointNodeId(null);
  }, [repointNodeId, updateNodeData, setRepointNodeId]);

  // Re-point an existing flow node to a brand-new empty session (modify modal).
  const repointNewSession = useCallback(async () => {
    if (!repointNodeId) return;
    const store = useSessionStore.getState();
    const originalSessionId = store.activeSessionId;
    const sid = await store.createSession('Sub-flow', flowId); // switches active to new empty session
    if (originalSessionId) store.switchSession(originalSessionId);
    updateNodeData(repointNodeId, { linkedSessionId: sid, flowRef: undefined, code: JSON.stringify({ nodes: [], edges: [] }) });
    setRepointNodeId(null);
  }, [repointNodeId, flowId, updateNodeData, setRepointNodeId]);

  return (
    <div ref={wrapperRef} className="w-full h-full relative" style={{ height: embedded ? '100%' : 'calc(100vh - 46px)' }}>
      {connectHint && (
        <div
          role="status"
          className="absolute left-1/2 -translate-x-1/2 top-3 z-20 px-3 py-2 rounded-md text-xs shadow-lg"
          style={{
            background: 'var(--surface)',
            border: '1px solid var(--accent-line, rgba(255,255,255,0.15))',
            color: 'var(--text, #E6ECF2)',
            fontFamily: 'var(--font-mono)',
            maxWidth: 420,
          }}
        >
          {connectHint}
        </div>
      )}
      <ReactFlow
        className="react-flow__dark"
        nodes={nodes}
        edges={displayEdges}
        onNodesChange={readOnly ? undefined : onNodesChange}
        onConnect={readOnly ? undefined : onConnect}
        onConnectStart={readOnly ? undefined : onConnectStart}
        onConnectEnd={readOnly ? undefined : onConnectEnd}
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
          versionsVisible={versionsVisible}
          onToggleVersions={onToggleVersions}
          onForceSaveVersion={forceSaveVersion}
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
        onCreateNewSession={handleFlowNodeNewSession}
        flowId={flowId}
        closedSessions={closedSessions}
      />}

      {/* Modify Flow Node modal — re-point an existing flow node (issue 3) */}
      {!readOnly && <FlowNodeCreationModal
        isOpen={!!repointNodeId}
        mode="modify"
        onClose={() => setRepointNodeId(null)}
        onSelectSession={repointSelectSession}
        onUploadFile={repointUploadFile}
        onSelectLibraryFlow={repointSelectLibrary}
        onCreateNewSession={repointNewSession}
        flowId={flowId}
        closedSessions={closedSessions}
        currentLinkedSessionId={repointNode?.data?.linkedSessionId}
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
