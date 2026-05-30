import dagre from 'dagre';
import { Node } from 'reactflow';

const dagreGraph = new dagre.graphlib.Graph();
dagreGraph.setDefaultEdgeLabel(() => ({}));

const NODE_WIDTH = 320;
const NODE_HEIGHT = 150;
const NODE_MARGIN = 100;

export const getLayoutedElements = (nodes: Node[], edges: any[], direction = 'LR') => {
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
