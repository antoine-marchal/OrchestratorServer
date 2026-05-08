import { Node, Edge } from 'reactflow';

/**
 * Console message type for execution logging
 */
export interface ConsoleMessage {
  nodeId: string;
  type: 'input' | 'output' | 'error' | 'log' | 'flow';
  message: string;
  timestamp: number;
}

/**
 * Flow state interface - represents the state of a flow graph
 * Used by both sessionStore and sessionFlowStore
 */
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
  // VSCode-style editor card state
  activeCard: 'graph' | 'code';
  editingNodeId: string | null;
}

/**
 * Session interface - represents a workflow session
 */
export interface Session {
  id: string;
  name: string;
  flowState: FlowState;
  createdAt: number;
  lastActivity: number;
  linkedFlowId?: string;  // flow library flow this session belongs to
}

/**
 * Flow store interface - defines all flow operations and state
 */
export interface FlowStoreInterface {
  // State getters
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

  // Methods
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

/**
 * Session store interface - defines session management operations
 */
export interface SessionStore {
  sessions: Session[];
  activeSessionId: string | null;
  isLoading: boolean;

  // Session management
  createSession: (name?: string, linkedFlowId?: string) => Promise<string>;
  createLocalSession: (name?: string, linkedFlowId?: string) => string;
  switchSession: (sessionId: string) => void;
  closeSession: (sessionId: string) => Promise<void>;
  reorderSessions: (sourceIndex: number, destinationIndex: number) => void;
  getActiveSession: () => Session | null;
  getSession: (sessionId: string) => Session | null;

  // Flow state management
  updateActiveFlowState: (updates: Partial<FlowState>) => void;
  getActiveFlowState: () => FlowState | null;
  syncToLinkedFlowNodes: (sessionId: string) => void;

  // Persistence
  saveSessions: () => void;
  loadSessions: () => Promise<void>;

  // VSCode-style editor
  openNodeEditor: (nodeId: string) => void;
  closeNodeEditor: () => void;
}

/**
 * Default flow state factory
 */
export const createDefaultFlowState = (): FlowState => ({
  nodes: [],
  edges: [],
  consoleMessages: [],
  showConsole: false,
  fullscreen: false,
  nodeExecutionTimeout: Infinity,
  editorModal: {
    isOpen: false,
    nodeId: null,
  },
  nodeLoading: {},
  panOnDrag: true,
  zoomOnScroll: true,
  flowPath: null,
  isOutputZoneActive: false,
  isTitleEditing: false,
  isMouseOverConsole: false,
  history: [],
  historyIndex: -1,
  maxHistorySize: 10,
  starterNodeId: null,
  outputClearCounter: 0,
  stoppingNodes: new Set<string>(),
  activeCard: 'graph',
  editingNodeId: null,
});
