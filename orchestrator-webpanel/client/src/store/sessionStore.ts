import { create } from 'zustand';
import { apiClient } from '../utils/apiClient';
import { SessionStore, Session, FlowState, createDefaultFlowState, coerceStoppingNodes } from './types';

// Debounce handle for syncToLinkedFlowNodes. Linked flow-node `code` only needs
// to be fresh for export / library persistence — in-app execution reads the
// linked session live — so it's wasteful to re-serialize the whole graph on
// every keystroke. Coalesce instead.
let syncTimer: ReturnType<typeof setTimeout> | null = null;

export const useSessionStore = create<SessionStore>((set, get) => ({
  sessions: [],
  activeSessionId: null,
  isLoading: false,

  createSession: async (name?: string, linkedFlowId?: string, opts?: { isFlowRoot?: boolean }) => {
    const sessionName = name || `Session ${get().sessions.length + 1}`;
    const sessionId = `local_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

    // The first session of a workspace (scope = linkedFlowId, or the un-scoped
    // pool) becomes its main session automatically — and a main session can't be
    // closed (see SessionTabs). No sibling in scope ⇒ this is the first.
    const scopeKey = linkedFlowId ?? null;
    const isFirstInScope = !get().sessions.some(s => (s.linkedFlowId ?? null) === scopeKey);

    const newSession: Session = {
      id: sessionId,
      name: sessionName,
      flowState: createDefaultFlowState(),
      createdAt: Date.now(),
      lastActivity: Date.now(),
      ...(linkedFlowId ? { linkedFlowId } : {}),
      ...(opts?.isFlowRoot ? { isFlowRoot: true } : {}),
      ...(isFirstInScope ? { isMain: true } : {}),
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

  renameSession: (sessionId: string, name: string) => {
    const clean = name.trim();
    if (!clean) return;
    set((state) => ({
      sessions: state.sessions.map(s => {
        if (s.id === sessionId) return { ...s, name: clean };
        // Stamp the new name onto any flow node in this session that points at
        // the renamed session, so it survives into the saved flow doc and drives
        // the session folder name (file tree + git clone).
        const hasLinked = s.flowState.nodes.some(
          n => n.data?.type === 'flow' && n.data?.linkedSessionId === sessionId,
        );
        if (!hasLinked) return s;
        return {
          ...s,
          flowState: {
            ...s.flowState,
            nodes: s.flowState.nodes.map(n =>
              n.data?.type === 'flow' && n.data?.linkedSessionId === sessionId
                ? { ...n, data: { ...n.data, sessionName: clean } }
                : n,
            ),
          },
        };
      }),
    }));
    get().saveSessions();
  },

  setMainSession: (sessionId: string) => {
    const target = get().sessions.find(s => s.id === sessionId);
    if (!target) return;
    const scopeFlowId = target.linkedFlowId;
    set((state) => ({
      sessions: state.sessions.map(s => {
        const sameScope = (s.linkedFlowId ?? null) === (scopeFlowId ?? null);
        if (!sameScope) return s;
        const nextIsMain = s.id === sessionId ? !s.isMain : false;
        if (!!s.isMain === nextIsMain) return s;
        return { ...s, isMain: nextIsMain };
      }),
    }));
    get().saveSessions();
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
    // Main session is undeletable — the UI hides its close button; guard here too.
    if (session.isMain) return;

    // Stop all running jobs in this session before closing
    const runningJobIds = session.flowState.nodes
      .map(n => n.data?.jobId)
      .filter((id): id is string => !!id);
    await Promise.allSettled(runningJobIds.map(jobId => apiClient.stopJob(jobId)));

    // Sessions are JWT-based — nothing to invalidate server-side.

    // Flush the latest sub-flow snapshot into every flow node that points at
    // this session BEFORE removing it, so closing a tab never loses edits
    // (the debounced sync may not have fired yet) — issue 3.
    get().syncToLinkedFlowNodes(sessionId);

    // Remove the session. We deliberately KEEP `linkedSessionId` on referencing
    // flow nodes: closing a tab must NOT desolidarize flow nodes that share a
    // sub-flow (issue 3). The live content lives on in their `code` snapshot
    // (just synced above); re-opening any of them recreates the SAME session id
    // (see openFlowNodeEditor) so they all re-link together.
    const updatedSessions = get().sessions.filter(s => s.id !== sessionId);

    let newActiveSessionId = state.activeSessionId;

    // If closing active session, switch to another session or create new one
    if (state.activeSessionId === sessionId) {
      const sameScopeSessions = session.linkedFlowId
        ? updatedSessions.filter(s => s.linkedFlowId === session.linkedFlowId)
        : updatedSessions.filter(s => !s.linkedFlowId);

      if (sameScopeSessions.length > 0) {
        newActiveSessionId = sameScopeSessions[0].id;
      } else if (updatedSessions.length > 0 && !session.linkedFlowId) {
        newActiveSessionId = updatedSessions[0].id;
      } else {
        newActiveSessionId = null;
        setTimeout(() => get().createSession(undefined, session.linkedFlowId), 0);
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

  getCanonicalSession: (flowId: string) => {
    const scoped = get().sessions.filter(s => s.linkedFlowId === flowId);
    return scoped.find(s => s.isMain) || scoped.find(s => s.isFlowRoot) || scoped[0] || null;
  },

  updateActiveFlowState: (updates: Partial<FlowState>) => {
    const { activeSessionId } = get();
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

    // Sync changes back to linked flow nodes in other sessions — debounced so a
    // burst of edits collapses into one pass instead of re-serializing the whole
    // graph on every keystroke.
    if (updates.nodes || updates.edges) {
      if (syncTimer) clearTimeout(syncTimer);
      syncTimer = setTimeout(() => {
        syncTimer = null;
        get().syncToLinkedFlowNodes(activeSessionId);
      }, 500);
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

  openNodeEditor: (nodeId: string) => {
    get().updateActiveFlowState({ activeCard: 'code', editingNodeId: nodeId });
  },

  closeNodeEditor: () => {
    get().updateActiveFlowState({ activeCard: 'graph', editingNodeId: null });
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
          stoppingNodes: coerceStoppingNodes(session.flowState.stoppingNodes),
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
