import type { Edge, Node } from '../../types/xyflow';

import { FlowState } from '../types';
import { addToHistoryWithState } from './historyActions';

/**
 * Clipboard operations for copy/paste nodes
 */

/**
 * Copy selected nodes to clipboard (localStorage)
 */
export function copySelectedNodes(
  nodeIds: string[],
  nodes: Node[],
  edges: Edge[]
): void {
  const selectedNodes = nodes.filter(node => nodeIds.includes(node.id));
  const selectedEdges = edges.filter(
    edge => nodeIds.includes(edge.source) && nodeIds.includes(edge.target)
  );

  if (selectedNodes.length > 0) {
    const clipboardData = {
      nodes: selectedNodes,
      edges: selectedEdges,
      timestamp: Date.now()
    };
    localStorage.setItem('orchestrator-clipboard', JSON.stringify(clipboardData));
  }
}

/**
 * Get clipboard nodes (read from localStorage)
 */
export function getClipboardNodes(): Node[] | null {
  try {
    const clipboardData = localStorage.getItem('orchestrator-clipboard');
    if (!clipboardData) return null;
    return JSON.parse(clipboardData).nodes;
  } catch (error) {
    console.error('Error reading clipboard:', error);
    return null;
  }
}

/**
 * Paste nodes from clipboard
 */
export function pasteNodes(
  activeFlowState: FlowState,
  updateFlowState: (updates: Partial<FlowState>) => void
): void {
  try {
    const clipboardJson = localStorage.getItem('orchestrator-clipboard');
    if (!clipboardJson) return;

    const clipboard = JSON.parse(clipboardJson);
    const nodes = activeFlowState.nodes;
    const edges = activeFlowState.edges;

    const idMapping: Record<string, string> = {};

    const newNodes = clipboard.nodes.map((node: Node) => {
      const newId = `node-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
      idMapping[node.id] = newId;

      const position = {
        x: node.position.x + 150,
        y: node.position.y + 150
      };

      return {
        ...node,
        id: newId,
        position,
        data: {
          ...node.data,
          label: `${node.data.label} (copy)`
        },
        selected: true
      };
    });

    const newEdges = clipboard.edges.map((edge: Edge) => ({
      ...edge,
      id: `e${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
      source: idMapping[edge.source],
      target: idMapping[edge.target]
    }));

    updateFlowState({
      nodes: [...nodes, ...newNodes],
      edges: [...edges, ...newEdges]
    });

    // Add to history
    const historyUpdate = addToHistoryWithState(
      [...nodes, ...newNodes],
      [...edges, ...newEdges],
      activeFlowState
    );
    updateFlowState(historyUpdate);

  } catch (error) {
    console.error('Error pasting nodes:', error);
  }
}

/**
 * Clear node selection
 */
export function clearNodeSelection(
  targetedNodes: Node[],
  allNodes: Node[],
  updateFlowState: (updates: Partial<FlowState>) => void
): void {
  const targetedIds = new Set(targetedNodes.map(n => n.id));
  updateFlowState({
    nodes: allNodes.map(node => ({
      ...node,
      selected: targetedIds.has(node.id) ? false : node.selected
    }))
  });
}
