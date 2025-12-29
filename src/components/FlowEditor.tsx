import React, { useCallback, useEffect, useState, useMemo } from 'react';
import ToolbarButton from './ToolbarButton';
import { pathUtils } from '../utils/pathUtils';
import FlowNodeCreationModal from './FlowNodeCreationModal';

import ReactFlow, {
  Edge,
  Background,
  Panel,
  NodeTypes,
  OnNodesChange,
  OnEdgesChange,
  Connection,
  getOutgoers,
  addEdge,
  applyNodeChanges,
  applyEdgeChanges,
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
import {
  Save,
  Upload,
  Trash2,
  PlayCircle,
  Layout,
  Plus,
  FileCode,
  Server,
  Coffee,
  Terminal,
  TerminalSquare,
  Hash,
  MessageSquare,
  GitBranch,
  FilePlus,
  XCircle,
  Undo,
  Redo,
  Copy,
  Clipboard,
  CornerRightDown,
  Sun,
  Moon
} from 'lucide-react';
import { useTheme } from "../context/ThemeContext";

import dagre from 'dagre';
import CommentNode from './node/CommentNode';
const nodeTypes: NodeTypes = {
  custom: CustomNode,
  comment: CommentNode,
};

const NODE_TYPES = [
  {
    id: 'javascript',
    label: 'JavaScript',
    code: 'console.log(\'Hello\')\nreturn input;\n',
    icon: FileCode,
    iconColor: 'text-yellow-500'
  },
  {
    id: 'jsbackend',
    label: 'Backend JS',
    code: `console.log('Received input:', input);

    const result = Array.isArray(input)
      ? input.map(x => x * 2)    // Doubles each item
      : [];

    output = result;`,
    icon: Server,
    iconColor: 'text-blue-500'
  },
  {
    id: 'groovy',
    label: 'Groovy',
    code: 'println "beginning processing with $input"\noutput= input',
    icon: Coffee,
    iconColor: 'text-red-500'
  },
  {
    id: 'batch',
    label: 'Batch',
    code: 'echo Hello %INPUT% > %OUTPUT%',
    icon: Terminal,
    iconColor: 'text-gray-400'
  },
  {
    id: 'powershell',
    label: 'PowerShell',
    code: 'Write-Output "Hello $env:INPUT"\nSet-Content -Path $env:OUTPUT -Value $env:INPUT',
    icon: TerminalSquare,
    iconColor: 'text-blue-400'
  },
  {
    id: 'constant',
    label: 'Constant',
    value: '0',
    icon: Hash,
    iconColor: 'text-purple-500'
  },
  {
    id: 'comment',
    label: 'Comment',
    value: '',
    icon: MessageSquare,
    iconColor: 'text-gray-500'
  },
  {
    id: 'flow',
    label: 'Flow',
    code: '',
    icon: GitBranch,
    iconColor: 'text-emerald-500'
  },
  {
    id: 'goto',
    label: 'Goto',
    icon: CornerRightDown,       
    iconColor: 'text-yellow-400',
  }
  
];

const dagreGraph = new dagre.graphlib.Graph();
dagreGraph.setDefaultEdgeLabel(() => ({}));

const NODE_WIDTH = 320;
const NODE_HEIGHT = 150;
const NODE_MARGIN = 100;

const getLayoutedElements = (nodes: Node[], edges: any[], direction = 'LR') => {
  dagreGraph.setGraph({
    rankdir: direction,
    nodesep: NODE_MARGIN,
    ranksep: NODE_MARGIN * 1.5,
    marginx: NODE_MARGIN,
    marginy: NODE_MARGIN,
    acyclicer: 'greedy',
    ranker: 'network-simplex',
  });

  nodes.forEach((node) => {
    dagreGraph.setNode(node.id, {
      width: node.width,
      height: node.height,
    });
  });

  edges.forEach((edge) => {
    dagreGraph.setEdge(edge.source, edge.target);
  });

  dagre.layout(dagreGraph);

  const layoutedNodes = nodes.map((node) => {
    const nodeWithPosition = dagreGraph.node(node.id);
    return {
      ...node,
      position: {
        x: nodeWithPosition.x - ((node.width || NODE_WIDTH) / 2),
        y: nodeWithPosition.y - ((node.height || NODE_HEIGHT) / 2),

      },
    };
  });

  return layoutedNodes;
};

function Flow() {
  const { theme, toggleTheme } = useTheme();
  const edgeLabelStyles = useMemo(() => {
    const isDark = theme === 'dark';
    return {
      labelStyle: {
        fontSize: 10,
        fill: isDark ? '#e5e7eb' /* gray-200 */ : '#475569' /* slate-600 */,
      },
      labelBgStyle: {
        fill: isDark ? 'rgba(17,24,39,0.9)'   /* gray-900 */ 
                     : 'rgba(255,255,255,0.9)',

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
    addToHistory
  } = useFlowStore();
  
  // Add state for edge animations
  const { fitView, getNodes, getEdges, screenToFlowPosition  } = useReactFlow();
  const [contextMenu, setContextMenu] = useState<null | {
    x: number; y: number; flowX: number; flowY: number
  }>(null);
  
  const [dropdownMenu, setDropdownMenu] = useState(false);
  const [selectedNodes, setSelectedNodes] = useState<string[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [flowNodeModal, setFlowNodeModal] = useState<{
    isOpen: boolean;
    position?: { x: number; y: number };
  }>({ isOpen: false });
  
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
  
  // Add keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // Prevent default browser actions for our shortcuts
      if (event.ctrlKey || event.metaKey) {
        // Get current state of output zone, title editing, and mouse over console
        const isModalOpen = editorModal.isOpen;
        
        // Skip handling CTRL+C and CTRL+V when modal editor is open, output zone is active, title is being edited, or mouse is over console
        const shouldSkipCopyPaste = isModalOpen || isOutputZoneActive || isTitleEditing || isMouseOverConsole;
        
        switch (event.key.toLowerCase()) {
          case 'n':
            event.preventDefault();
            createNewFlow();
            break;
          case 'd':
            event.preventDefault();
            clearFlow();
            break;
          case 'r':
            event.preventDefault();
            executeFlow();
            break;
          case 'p':
            event.preventDefault();
            handlePrettifyFlow();
            break;
          case 'w':
            event.preventDefault();
            clearAllOutputs();
            break;
          case 'z':
            event.preventDefault();
            if (canUndo()) undo();
            break;
          case 'y':
            event.preventDefault();
            if (canRedo()) redo();
            break;
          case 'c':
            // Only handle copy if we're not in a special state and have selected nodes
            if (!shouldSkipCopyPaste && selectedNodes.length > 0) {
              event.preventDefault();
              copySelectedNodes(selectedNodes);
            }
            break;
          case 'v':
            // Only handle paste if we're not in a special state
            if (!shouldSkipCopyPaste) {
              event.preventDefault();
              handlePasteNodes();
            }
            break;
        }
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [clearFlow, executeFlow, clearAllOutputs, undo, redo, canUndo, canRedo, selectedNodes, copySelectedNodes, handlePasteNodes]);
  
  // Function to create a new flow
  const createNewFlow = () => {
    clearFlow(); // This clears nodes, edges, and sets flowPath to null
    // TODO: Replace with browser API for title management
    // window.electronAPI?.setTitle?.('New Flow');
  };
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
    [getNodes, getEdges],
  );
  const onNodesChange: OnNodesChange = useCallback(
    (changes) => {
      // Check if any of the changes is a position change (dragging)
      const hasDragChange = changes.some(
        change => change.type === 'position' && change.dragging !== undefined
      );
      
      // If there's a drag change, update the dragging state
      if (hasDragChange) {
        const isDraggingNow = changes.some(change =>
          change.type === 'position' && change.dragging === true
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
    [setNodes, isDragging, nodes]
  );
// Build dashed, labeled edges for forwardInput + restyle real edges if they match
const displayEdges = useMemo<Edge[]>(() => {
  // Map forward pairs and the condition text(s)
  const forwardLabels = new Map<string, string[]>();
  const nodeIds = new Set(nodes.map(n => n.id));

  nodes.forEach(n => {
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
    return arr.length === 1 ? arr[0] : arr.map(s => `(${s})`).join(' OR ');
  };

  // Restyle any existing edges that match a forward pair + attach label
  const restyled = edges.map(e => {
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
  const existingKeys = new Set(restyled.map(e => `${e.source}->${e.target}`));
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
    const existingLabels = nodes.map(node => node.data.label);
    let counter = 1;
    let newLabel = baseLabel;

    while (existingLabels.includes(newLabel)) {
      newLabel = `${baseLabel} ${counter}`;
      counter++;
    }

    return newLabel;
  };
  // For context menu (right-click in pane)
  const handlePaneContextMenu = useCallback((event: React.MouseEvent) => {
    event.preventDefault();
    const bounds = event.currentTarget.getBoundingClientRect();
    const flowPoint = screenToFlowPosition({
      x: event.clientX - bounds.left,
      y: event.clientY - bounds.top
    });
    setContextMenu({
      x: event.clientX, // <- screen X for menu position
      y: event.clientY - 46, // <- screen Y for menu position
      flowX: flowPoint.x, // <- if you want to use for node creation
      flowY: flowPoint.y + 23
    });
    setDropdownMenu(false);
  }, [screenToFlowPosition]);
  

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
 
  const addNewNode = async (type: string, pos?: { x: number, y: number }) => {
    // Handle flow node type - show modal for selection
    if (type === 'flow') {
      setFlowNodeModal({ isOpen: true, position: pos });
      closeMenus();
      return;
    }
    const nodeType = NODE_TYPES.find(t => t.id === type);
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
    if (type === 'goto'){
      const newNode = {
        id: `node-${Date.now()}`,
        type: 'custom',
        position,
        data: {
          label: 'Goto',
          type: 'goto',

          conditions: [
            // starter example row users can edit/remove:
            { expr: 'input < 50', goto: '',forwardInput:true },
          ],
        },
        draggable: true,
      };
      
      setNodes((nds) => [...nds, newNode]);
      closeMenus();
      return;
    }
    // Comment nodes only have label/value, and type "comment"
    const newNode = type === 'comment'
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
            language: type === 'constant' ? undefined : type,
            code: type === 'constant' ? undefined : nodeType.code,
            value: type === 'constant' ? nodeType.value : undefined,
          },
          draggable: true,
        };
  
    setNodes((nds) => [...nds, newNode]);
    closeMenus();
  };
  
  
  const handlePrettifyFlow = () => {
    // Only layout non-comment nodes
    const nonCommentNodes = nodes.filter(n => n.type !== 'comment');
    const commentNodes = nodes.filter(n => n.type === 'comment');
    const layoutedNodes = getLayoutedElements(nonCommentNodes, edges);
  
    // Merge back comment nodes, preserving their original positions
    const allNodes = [
      ...layoutedNodes,
      ...commentNodes
    ].sort((a, b) => {
      // Keep original order (optional)
      return nodes.findIndex(n => n.id === a.id) - nodes.findIndex(n => n.id === b.id);
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
  

  
  // Handle opening the editor modal for flow nodes
  const handleNodeDoubleClick = async (event: React.MouseEvent, node: Node) => {
    // In browser environment, we can't access external files directly
    // The code is already stored in the node data, so we just open the editor

    if (node.data.type === 'flow') {
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
        const newSessionId = await sessionStore.createSession(sessionName);

        // Parse the flow content from code field
        let flowData: { nodes: Node[], edges: Edge[] } | null = null;
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
            historyIndex: -1
          });
        } else {
          // Initialize with empty flow
          sessionStore.updateActiveFlowState({
            nodes: [],
            edges: [],
            flowPath: `${node.data.label}.or`,
            history: [],
            historyIndex: -1
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
    } else if (node.data.type !== 'goto') {
      // For other node types, open the regular editor modal
      openEditorModal(node.id);
    }
  };

  // Track selected nodes
  const onSelectionChange = useCallback(({ nodes }: { nodes: Node[] }) => {
    setSelectedNodes(nodes.map(node => node.id));
  }, []);

  // Handle flow node creation from existing session (link directly to it)
  const handleFlowNodeFromSession = useCallback((sessionId: string, sessionName: string) => {
    const session = useSessionStore.getState().getSession(sessionId);
    if (!session) {
      alert('Session not found');
      return;
    }

    const nodePosition = flowNodeModal.position || { x: 100, y: 100 };

    // Serialize the session's flow state to JSON
    const flowContent = JSON.stringify({
      nodes: session.flowState.nodes,
      edges: session.flowState.edges,
    });

    const newNode = {
      id: `node-${Date.now()}`,
      type: 'custom',
      position: nodePosition,
      data: {
        label: sessionName,
        type: 'flow' as const,
        code: flowContent,
        isRelativePath: false,
        linkedSessionId: sessionId, // Link directly to the existing session
      },
      draggable: true,
    };

    setNodes((nds) => [...nds, newNode]);

    // Switch to the linked session so user can view/edit it
    useSessionStore.getState().switchSession(sessionId);
  }, [flowNodeModal.position, setNodes]);

  // Handle flow node creation from file upload (create new session)
  const handleFlowNodeFromFile = useCallback(async (file: File) => {
    try {
      const fileContent = await file.text();
      const fileName = file.name;
      const flowName = fileName.replace('.or', '');

      // Parse and validate the flow content
      const flowData = JSON.parse(fileContent);
      if (!flowData || !Array.isArray(flowData.nodes) || !Array.isArray(flowData.edges)) {
        throw new Error('Invalid flow file format: missing nodes or edges');
      }

      const nodePosition = flowNodeModal.position || { x: 100, y: 100 };

      // Remember current session to add the node to it
      const currentSessionId = useSessionStore.getState().activeSessionId;

      // Create a new session for this flow
      const newSessionName = `Flow: ${flowName}`;
      const newSessionId = await useSessionStore.getState().createSession(newSessionName);

      // Load the flow data into the new session
      useSessionStore.getState().updateActiveFlowState({
        nodes: flowData.nodes,
        edges: flowData.edges,
        flowPath: fileName,
        history: [],
        historyIndex: -1,
      });

      // Create the flow node linked to the new session
      const newNode = {
        id: `node-${Date.now()}`,
        type: 'custom',
        position: nodePosition,
        data: {
          label: flowName,
          type: 'flow' as const,
          code: fileContent,
          isRelativePath: false,
          linkedSessionId: newSessionId, // Link to the newly created session
        },
        draggable: true,
      };

      // Switch back to original session to add the node
      if (currentSessionId) {
        useSessionStore.getState().switchSession(currentSessionId);
        setNodes((nds) => [...nds, newNode]);

        // Then switch to the new session to show the uploaded flow
        useSessionStore.getState().switchSession(newSessionId);
      }
    } catch (error) {
      alert(`Error creating flow node: ${error instanceof Error ? error.message : String(error)}`);
    }
  }, [flowNodeModal.position, setNodes]);

  return (
    <div className="w-full" style={{ height: 'calc(100vh - 46px)' }}>
      <ReactFlow
        className='react-flow__dark'
        nodes={nodes}
        edges={displayEdges}
        onNodesChange={onNodesChange}
 
        onConnect={onConnect}
        nodeTypes={nodeTypes}
        fitView
        snapToGrid={true}
        snapGrid={[15, 15]}
        deleteKeyCode="Delete"
        onPaneClick={handlePaneClick}
        minZoom={0.1}
        maxZoom={2}
        nodesDraggable={false}
        panOnDrag={panOnDrag}
        panOnScroll={false}
        zoomOnScroll={zoomOnScroll}
        zoomOnPinch={false}
        onlyRenderVisibleElements={true}
        isValidConnection={isValidConnection}
        onPaneContextMenu={handlePaneContextMenu}
        onNodeDoubleClick={handleNodeDoubleClick}
        onSelectionChange={onSelectionChange}
        multiSelectionKeyCode="Shift"
        defaultEdgeOptions={{
          type: 'smoothstep',
          style: { strokeDasharray: '6 4', strokeWidth: 2},
          animated: true,
        }}
        proOptions={{ hideAttribution: true }}
      >
        <Background />
{/*}
        <MiniMap
          nodeColor={(node) => {
            if (node.data.type === 'constant') return '#9333ea';
            if (node.data.type === 'flow') return '#10b981'; // Green color for flow nodes
            return '#3b82f6';
          }}
        />
        */}
            <div className="absolute top-4 left-4 flex items-center gap-2 z-50">
  <button
    onClick={toggleTheme}
    className="p-2 rounded-full bg-gray-700 dark:bg-gray-200 text-white dark:text-black shadow hover:scale-105 transition"
    title={theme === "dark" ? "Light mode" : "Dark mode"}
  >
    {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
  </button>
</div>
       <Panel position="top-right" className="flex gap-2 flex-wrap">
        {/* File Operations Group */}
        <div className="flex gap-2 mr-2">
          <ToolbarButton
            onClick={createNewFlow}
            icon={FilePlus}
            label="New Flow"
            color="bg-teal-500 hover:bg-teal-600"
            title="New Flow (Ctrl+N)"
          />
          <ToolbarButton
            onClick={saveFlow}
            icon={Save}
            label="Save Flow"
            color="bg-blue-500 hover:bg-blue-600"
            title="Save Flow (Ctrl+S)"
          />
          <ToolbarButton
            onClick={loadFlow}
            icon={Upload}
            label="Load Flow"
            color="bg-green-500 hover:bg-green-600"
            title="Load Flow (Ctrl+O)"
          />
        </div>

        {/* Flow Operations Group */}
        <div className="flex gap-2 mr-2">
          <ToolbarButton
            onClick={clearFlow}
            icon={Trash2}
            label="Erase Flow"
            color="bg-red-500 hover:bg-red-600"
            title="Erase Flow (Ctrl+D)"
          />
          <ToolbarButton
            onClick={executeFlow}
            icon={PlayCircle}
            label="Run Flow"
            color="bg-yellow-500 hover:bg-yellow-600"
            title="Run Flow (Ctrl+R)"
          />
          <ToolbarButton
            onClick={stopFlow}
            icon={XCircle}
            label="Stop Flow"
            color="bg-red-600 hover:bg-red-700"
            title="Stop Flow Execution"
          />
        </div>

        {/* History Navigation Group */}
        <div className="flex gap-2 mr-2">
          <ToolbarButton
            onClick={undo}
            icon={Undo}
            label="Undo"
            color={canUndo() ? "bg-gray-500 hover:bg-gray-600" : "bg-gray-400"}
            title="Undo (Ctrl+Z)"
          />
          <ToolbarButton
            onClick={redo}
            icon={Redo}
            label="Redo"
            color={canRedo() ? "bg-gray-500 hover:bg-gray-600" : "bg-gray-400"}
            title="Redo (Ctrl+Y)"
          />
        </div>

        {/* Clipboard Operations Group */}
        <div className="flex gap-2 mr-2">
          <ToolbarButton
            onClick={handleCopyNodes}
            icon={Copy}
            label="Copy"
            color={selectedNodes.length > 0 ? "bg-purple-500 hover:bg-purple-600" : "bg-purple-400"}
            title="Copy Selected Nodes (Ctrl+C)"
          />
          <ToolbarButton
            onClick={handlePasteNodes}
            icon={Clipboard}
            label="Paste"
            color="bg-purple-500 hover:bg-purple-600"
            title="Paste Nodes (Ctrl+V)"
          />
        </div>

        {/* Utility Operations Group */}
        <div className="flex gap-2 mr-2">
          <ToolbarButton
            onClick={handlePrettifyFlow}
            icon={Layout}
            label="Prettify"
            color="bg-indigo-500 hover:bg-indigo-600"
            title="Prettify (Ctrl+P)"
          />
          <ToolbarButton
            onClick={clearAllOutputs}
            icon={XCircle}
            label="Clear Output"
            color="bg-orange-500 hover:bg-orange-600"
            title="Clear All Node Outputs (Ctrl+W)"
          />
        </div>

        {/* Add Node Button with Dropdown */}
        <div className="relative">
          <ToolbarButton
            onClick={handleAddNodeClick}
            icon={Plus}
            label="Add Node"
            color="bg-purple-500 hover:bg-purple-600"
            title="Add Node"
          />
    {dropdownMenu && (
      <div className="absolute right-0 mt-2 w-48 
        bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 
        rounded-lg shadow-2xl py-2 z-50"
      >
        {NODE_TYPES.map(type => (
          <button
            key={type.id}
            className="w-full text-left px-4 py-2
              text-gray-800 dark:text-gray-100
              hover:bg-gray-100 dark:hover:bg-gray-700
              focus:bg-gray-200 dark:focus:bg-gray-600
              transition-colors flex items-center gap-2"
            onClick={() => addNewNode(type.id)}
          >
            {type.icon && React.createElement(type.icon, {
              className: `w-4 h-4 ${type.iconColor}`
            })}
            {type.label}
          </button>
        ))}
      </div>
    )}
    

  </div>
</Panel>
        {contextMenu && (
  <div
  className="absolute right-0 mt-2 w-48 
  bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 
  rounded-lg shadow-2xl py-2 z-50"
    style={{
      left: contextMenu.x,
      top: contextMenu.y,
      pointerEvents: 'auto'
    }}
    onClick={e => e.stopPropagation()}
  >
    {NODE_TYPES.map(type => (
      <button
        key={type.id}
        className="w-full text-left px-4 py-2
                      text-gray-800 dark:text-gray-100
                      hover:bg-gray-100 dark:hover:bg-gray-700
                      focus:bg-gray-200 dark:focus:bg-gray-600
                      transition-colors flex items-center gap-2"
        onClick={() => addNewNode(type.id, { x: contextMenu.flowX, y: contextMenu.flowY })}
      >
        {type.icon && React.createElement(type.icon, {
          className: `w-4 h-4 ${type.iconColor}`
        })}
        {type.label}
      </button>
    ))}
  </div>
)}

      </ReactFlow>
      <Console />
      
      {/* Flow Node Creation Modal */}
      <FlowNodeCreationModal
        isOpen={flowNodeModal.isOpen}
        onClose={() => setFlowNodeModal({ isOpen: false })}
        onSelectSession={handleFlowNodeFromSession}
        onUploadFile={handleFlowNodeFromFile}
      />
    </div>
  );
}

export default function FlowEditor() {
  
  return (
    <ReactFlowProvider>
      <Flow />
    </ReactFlowProvider>
  );
}