import { create } from 'zustand';
import { Node, Edge } from 'reactflow';
import { apiClient } from '../utils/apiClient';

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
  flowPath?: string | null;
  history: Array<{ nodes: Node[]; edges: Edge[] }>;
  historyIndex: number;
  maxHistorySize: number;
  starterNodeId: string | null;
  stoppingNodes: Set<string>;
  outputClearCounter: number;
}

interface Session {
  id: string;
  name: string;
  flowState: FlowState;
  createdAt: number;
  lastActivity: number;
}

interface SessionStore {
  sessions: Session[];
  activeSessionId: string | null;
  isLoading: boolean;

  // Session management
  createSession: (name?: string) => Promise<string>;
  switchSession: (sessionId: string) => void;
  closeSession: (sessionId: string) => Promise<void>;
  getActiveSession: () => Session | null;
  getSession: (sessionId: string) => Session | null;

  // Flow state management
  updateActiveFlowState: (updates: Partial<FlowState>) => void;
  getActiveFlowState: () => FlowState | null;
  syncToLinkedFlowNodes: (sessionId: string) => void;

  // Persistence
  saveSessions: () => void;
  loadSessions: () => Promise<void>;
}

// Default flow state
const createDefaultFlowState = (): FlowState => ({
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
});

export const useSessionStore = create<SessionStore>((set, get) => ({
  sessions: [],
  activeSessionId: null,
  isLoading: false,

  createSession: async (name?: string) => {
    const sessionName = name || `Session ${get().sessions.length + 1}`;

    // Create session on backend first to get the backend-generated sessionId
    const backendSession = await apiClient.createSession({ name: sessionName });
    const sessionId = backendSession.sessionId;

    const newSession: Session = {
      id: sessionId,
      name: sessionName,
      flowState: createDefaultFlowState(),
      createdAt: Date.now(),
      lastActivity: Date.now(),
    };

    set((state) => ({
      sessions: [...state.sessions, newSession],
      activeSessionId: sessionId,
    }));

    get().saveSessions();
    return sessionId;
  },

  switchSession: (sessionId: string) => {
    const session = get().sessions.find(s => s.id === sessionId);
    if (session) {
      set({ activeSessionId: sessionId });
      // Update last activity
      set((state) => ({
        sessions: state.sessions.map(s =>
          s.id === sessionId ? { ...s, lastActivity: Date.now() } : s
        ),
      }));
      get().saveSessions();
    }
  },

  closeSession: async (sessionId: string) => {
    const state = get();
    const session = state.sessions.find(s => s.id === sessionId);

    if (!session) return;

    // Terminate session on backend - don't catch errors, let them propagate
    try{
    await apiClient.deleteSession(sessionId);
    }catch(e){}
    const updatedSessions = state.sessions.filter(s => s.id !== sessionId);
    let newActiveSessionId = state.activeSessionId;

    // If closing active session, switch to another session or create new one
    if (state.activeSessionId === sessionId) {
      if (updatedSessions.length > 0) {
        newActiveSessionId = updatedSessions[0].id;
      } else {
        // Create a new session if no sessions left
        newActiveSessionId = null; // Will be set by createSession
        setTimeout(() => get().createSession(), 0);
      }
    }

    set({
      sessions: updatedSessions,
      activeSessionId: newActiveSessionId,
    });

    get().saveSessions();
  },

  getActiveSession: () => {
    const { sessions, activeSessionId } = get();
    return sessions.find(s => s.id === activeSessionId) || null;
  },

  getSession: (sessionId: string) => {
    return get().sessions.find(s => s.id === sessionId) || null;
  },

  updateActiveFlowState: (updates: Partial<FlowState>) => {
    const { activeSessionId, sessions } = get();
    if (!activeSessionId) return;
    set((state) => ({
      sessions: state.sessions.map(session =>
        session.id === activeSessionId
          ? {
              ...session,
              flowState: { ...session.flowState, ...updates },
              lastActivity: Date.now(),
            }
          : session
      ),
    }));

    get().saveSessions();
    
    // Sync changes back to linked flow nodes in other sessions
    const activeSession = get().getActiveSession();
    if (activeSession && (updates.nodes || updates.edges)) {
      get().syncToLinkedFlowNodes(activeSessionId);
    }
  },
  
  syncToLinkedFlowNodes: (sessionId: string) => {
    const session = get().getSession(sessionId);
    if (!session) return;
    
    // Serialize the current flow state
    const flowContent = JSON.stringify({
      nodes: session.flowState.nodes,
      edges: session.flowState.edges,
    });
    
    // Find all sessions that have flow nodes linked to this session
    const { sessions } = get();
    sessions.forEach(otherSession => {
      if (otherSession.id === sessionId) return; // Skip the current session
      
      const hasLinkedNodes = otherSession.flowState.nodes.some(
        node => node.data?.type === 'flow' && node.data?.linkedSessionId === sessionId
      );
      
      if (hasLinkedNodes) {
        // Update the flow nodes in this session
        const updatedNodes = otherSession.flowState.nodes.map(node => {
          if (node.data?.type === 'flow' && node.data?.linkedSessionId === sessionId) {
            return {
              ...node,
              data: {
                ...node.data,
                code: flowContent, // Store in code field instead of flowContent
              }
            };
          }
          return node;
        });
        
        // Update the session with the new nodes
        set((state) => ({
          sessions: state.sessions.map(s =>
            s.id === otherSession.id
              ? {
                  ...s,
                  flowState: { ...s.flowState, nodes: updatedNodes },
                }
              : s
          ),
        }));
      }
    });
    
    get().saveSessions();
  },

  getActiveFlowState: () => {
    const activeSession = get().getActiveSession();
    return activeSession ? activeSession.flowState : null;
  },

  saveSessions: () => {
    const { sessions, activeSessionId } = get();
    try {
      const dataToSave = {
        sessions: sessions.map(session => ({
          ...session,
          // Don't save large objects like history in localStorage
          flowState: {
            ...session.flowState,
            history: [], // Clear history to save space
            consoleMessages: session.flowState.consoleMessages.slice(-50), // Keep last 50 messages
          },
        })),
        activeSessionId,
      };
      localStorage.setItem('orchestrator-sessions', JSON.stringify(dataToSave));
    } catch (error) {
      console.error('Failed to save sessions:', error);
    }
  },

  loadSessions: async () => {
    try {
      const saved = localStorage.getItem('orchestrator-sessions');
      if (!saved) {
        // Create initial session
        await get().createSession('Default Session');
        return;
      }

      const data = JSON.parse(saved);
      const sessions: Session[] = data.sessions.map((session: any) => ({
        ...session,
        flowState: {
          ...createDefaultFlowState(),
          ...session.flowState,
          // Restore history as empty since we cleared it on save
          history: [],
          historyIndex: -1,
          // Ensure stoppingNodes is a proper Set
          stoppingNodes: (() => {
            try {
              if (session.flowState.stoppingNodes instanceof Set) {
                return session.flowState.stoppingNodes;
              } else if (Array.isArray(session.flowState.stoppingNodes)) {
                return new Set(session.flowState.stoppingNodes);
              } else {
                return new Set<string>();
              }
            } catch (error) {
              console.warn('stoppingNodes was corrupted during load, resetting to empty Set:', error);
              return new Set<string>();
            }
          })(),
        },
      }));

      set({
        sessions,
        activeSessionId: data.activeSessionId || sessions[0]?.id || null,
      });
    } catch (error) {
      console.error('Failed to load sessions:', error);
      // Create initial session on error
      await get().createSession('Default Session');
    }
  },
}));