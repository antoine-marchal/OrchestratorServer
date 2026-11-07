import type { Edge, Node } from '../../types/xyflow';

import { FlowState } from '../types';

/**
 * History management action creators
 * These functions handle undo/redo functionality
 */

/**
 * Add current state to history
 */
export function addToHistory(
  activeFlowState: FlowState,
  updateFlowState: (updates: Partial<FlowState>) => void
): void {
  const nodes = activeFlowState.nodes;
  const edges = activeFlowState.edges;
  const currentState = {
    nodes: nodes.map(node => ({ ...node })),
    edges: edges.map(edge => ({ ...edge }))
  };

  const newHistory = activeFlowState.historyIndex < activeFlowState.history.length - 1
    ? activeFlowState.history.slice(0, activeFlowState.historyIndex + 1)
    : [...activeFlowState.history];

  newHistory.push(currentState);

  if (newHistory.length > activeFlowState.maxHistorySize) {
    newHistory.shift();
  }

  updateFlowState({
    history: newHistory,
    historyIndex: newHistory.length - 1
  });
}

/**
 * Undo to previous state
 */
export function undo(
  activeFlowState: FlowState,
  updateFlowState: (updates: Partial<FlowState>) => void
): void {
  if (activeFlowState.historyIndex > 0) {
    const prevState = activeFlowState.history[activeFlowState.historyIndex - 1];
    updateFlowState({
      nodes: prevState.nodes,
      edges: prevState.edges,
      historyIndex: activeFlowState.historyIndex - 1
    });
  }
}

/**
 * Redo to next state
 */
export function redo(
  activeFlowState: FlowState,
  updateFlowState: (updates: Partial<FlowState>) => void
): void {
  if (activeFlowState.historyIndex < activeFlowState.history.length - 1) {
    const nextState = activeFlowState.history[activeFlowState.historyIndex + 1];
    updateFlowState({
      nodes: nextState.nodes,
      edges: nextState.edges,
      historyIndex: activeFlowState.historyIndex + 1
    });
  }
}

/**
 * Check if undo is possible
 */
export function canUndo(activeFlowState: FlowState): boolean {
  return activeFlowState.historyIndex > 0;
}

/**
 * Check if redo is possible
 */
export function canRedo(activeFlowState: FlowState): boolean {
  return activeFlowState.historyIndex < activeFlowState.history.length - 1;
}

/**
 * Add to history with custom nodes/edges (used by other actions)
 */
export function addToHistoryWithState(
  nodes: Node[],
  edges: Edge[],
  activeFlowState: FlowState
): { history: Array<{ nodes: Node[]; edges: Edge[] }>; historyIndex: number } {
  const currentState = {
    nodes: nodes.map(node => ({ ...node })),
    edges: edges.map(edge => ({ ...edge }))
  };

  const newHistory = activeFlowState.historyIndex < activeFlowState.history.length - 1
    ? activeFlowState.history.slice(0, activeFlowState.historyIndex + 1)
    : [...activeFlowState.history];

  newHistory.push(currentState);

  if (newHistory.length > activeFlowState.maxHistorySize) {
    newHistory.shift();
  }

  return {
    history: newHistory,
    historyIndex: newHistory.length - 1
  };
}
