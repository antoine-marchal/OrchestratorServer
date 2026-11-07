import { describe, it, expect } from 'vitest';
import { executeInlineFlow, parseFlowContent } from '../src/domain/execution/flowExecutor';

describe('parseFlowContent', () => {
  it('parses a minimal valid flow', () => {
    const json = JSON.stringify({
      nodes: [{ id: 'n1', data: { type: 'javascript' } }],
      edges: [],
    });
    const { flow, nodeMap, roots } = parseFlowContent(json);
    expect(flow.nodes.length).toBe(1);
    expect(nodeMap.n1.id).toBe('n1');
    expect(roots).toEqual(['n1']);
  });

  it('builds incoming/outgoing maps', () => {
    const json = JSON.stringify({
      nodes: [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
      edges: [{ source: 'a', target: 'b' }, { source: 'b', target: 'c' }],
    });
    const { incomingMap, outgoingMap, roots } = parseFlowContent(json);
    expect(roots).toEqual(['a']);
    expect(outgoingMap.a.length).toBe(1);
    expect(incomingMap.b[0].source).toBe('a');
    expect(incomingMap.c[0].source).toBe('b');
  });

  it('throws on invalid JSON', () => {
    expect(() => parseFlowContent('{not json')).toThrow(/Invalid JSON/);
  });

  it('throws when nodes/edges missing', () => {
    expect(() => parseFlowContent(JSON.stringify({ nodes: [] }))).toThrow(/missing nodes or edges/);
    expect(() => parseFlowContent(JSON.stringify({ edges: [] }))).toThrow(/missing nodes or edges/);
  });

  it('supplies flow input to the first root node', async () => {
    const parsed = parseFlowContent(JSON.stringify({
      nodes: [{ id: 'root', data: { type: 'javascript', code: 'return input;' } }],
      edges: [],
    }));

    const result = await executeInlineFlow(parsed, 'from-api-path', [], process.cwd(), 1000, null);

    expect(result).toBe('from-api-path');
  });
});
