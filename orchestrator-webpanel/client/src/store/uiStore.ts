import { create } from 'zustand';

/**
 * Small transient UI store decoupled from session/flow state.
 * `repointNodeId` carries the flow node the user asked to re-point (issue 3):
 * NodeHeader sets it, FlowEditor opens the "Modify Flow Node" modal for it.
 */
interface UIStore {
  repointNodeId: string | null;
  setRepointNodeId: (id: string | null) => void;
}

export const useUIStore = create<UIStore>((set) => ({
  repointNodeId: null,
  setRepointNodeId: (id) => set({ repointNodeId: id }),
}));
