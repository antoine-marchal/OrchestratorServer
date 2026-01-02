import { create } from 'zustand';
import { apiClient } from '../utils/apiClient';
import { SessionStore, Session, FlowState, createDefaultFlowState } from './types';

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

  reorderSessions: (sourceIndex: number, destinationIndex: number) => {
    const sessions = [...get().sessions];
    const [movedSession] = sessions.splice(sourceIndex, 1);
    sessions.splice(destinationIndex, 0, movedSession);

    set({ sessions });
    get().saveSessions();
  },

  closeSession: async (sessionId: string) => {
    const state = get();
    const session = state.sessions.find(s => s.id === sessionId);

    if (!session) return;

    // Terminate session on backend
    try {
      await apiClient.deleteSession(sessionId);
    } catch (e) {}

    // Remove the session and cleanup linkedSessionId references in other sessions
    const updatedSessions = state.sessions
      .filter(s => s.id !== sessionId)
      .map(s => ({
        ...s,
        flowState: {
          ...s.flowState,
          // Remove linkedSessionId from flow nodes that referenced the closed session
          nodes: s.flowState.nodes.map(node => {
            if (node.data?.linkedSessionId === sessionId) {
              const { linkedSessionId, ...restData } = node.data;
              return { ...node, data: restData };
            }
            return node;
          }),
        },
      }));

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