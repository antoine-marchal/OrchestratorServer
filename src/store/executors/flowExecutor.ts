import { Node } from 'reactflow';
import { FlowState } from '../types';
import { collectVariables } from '../utils/variableUtils';
import { executeNode } from './nodeExecutor';

/**
 * Flow execution orchestrator
 * Handles execution of entire flow graphs with goto nodes, loops, and control flow
 */

type SessionStoreGetter = () => {
  getActiveFlowState: () => FlowState | null;
  updateActiveFlowState: (updates: Partial<FlowState>) => void;
};

/**
 * Execute entire flow from entry point
 */
export async function executeFlow(
  sessionStore: SessionStoreGetter
): Promise<void> {
  let activeFlowState = sessionStore().getActiveFlowState();
  if (!activeFlowState) return;

  const updateFlowState = (updates: Partial<FlowState>) => {
    sessionStore().updateActiveFlowState(updates);
  };

  // ---------- helpers that always read fresh state ----------
  const byId = (id: string) => {
    activeFlowState = sessionStore().getActiveFlowState()!;
    return activeFlowState.nodes.find(n => n.id === id) || null;
  };
  const incoming = (id: string) => {
    activeFlowState = sessionStore().getActiveFlowState()!;
    return activeFlowState.edges.filter(e => e.target === id);
  };
  const outgoing = (id: string) => {
    activeFlowState = sessionStore().getActiveFlowState()!;
    return activeFlowState.edges.filter(e => e.source === id);
  };
  const isRoot = (id: string) => incoming(id).length === 0;

  const creationIndex = (id: string) => {
    activeFlowState = sessionStore().getActiveFlowState()!;
    const i = activeFlowState.nodes.findIndex(n => n.id === id);
    return i < 0 ? Number.MAX_SAFE_INTEGER : i;
  };

  const rootOf = (id: string) => {
    const seen = new Set<string>();
    let q = [id];
    const roots: string[] = [];
    while (q.length) {
      const cur = q.pop()!;
      if (seen.has(cur)) continue;

      seen.add(cur);
      const inc = incoming(cur);
      if (inc.length === 0) roots.push(cur);
      else inc.forEach(e => q.push(e.source));
    }
    if (!roots.length) return id;
    roots.sort((a, b) => creationIndex(a) - creationIndex(b));
    return roots[0];
  };

  const firstCreatedRoot = () => {
    activeFlowState = sessionStore().getActiveFlowState()!;
    const roots = activeFlowState.nodes.map(n => n.id).filter(isRoot);
    if (!roots.length) return null;
    roots.sort((a, b) => creationIndex(a) - creationIndex(b));
    return roots[0];
  };

  const firstCreatedGoto = () => {
    activeFlowState = sessionStore().getActiveFlowState()!;
    const gotos = activeFlowState.nodes.filter(n => n.data?.type === 'goto');
    if (!gotos.length) return null;
    gotos.sort((a, b) => creationIndex(a.id) - creationIndex(b.id));
    return gotos[0].id;
  };

  const stripTrailingSemis = (s: string) => (s ?? '').trim().replace(/;+\s*$/, '');
  const toNumberIfNumeric = (v: any) =>
    (typeof v === 'string' && v.trim() !== '' && !isNaN(+v) ? +v : v);

  const evalGotoExpr = (expr: string, input: any, variables: Record<string, any> = {}): boolean => {
    try {
      const cleaned = stripTrailingSemis(expr);
      const ninput = toNumberIfNumeric(input);
      // Build variable declarations for injection
      const varNames = Object.keys(variables);
      const varDeclarations = varNames.map(name => `var ${name} = __vars__[${JSON.stringify(name)}];`).join('\n');
      const fn = new Function('input', 'ninput', '__vars__', `${varDeclarations}\nreturn !!(${cleaned});`);
      return !!fn(input, ninput, variables);
    } catch {
      return false;
    }
  };

  // ---------- choose entry ----------
  activeFlowState = sessionStore().getActiveFlowState()!;
  let entryId: string | null = null;
  if (activeFlowState.starterNodeId) entryId = activeFlowState.starterNodeId!;
  else {
    const g = firstCreatedGoto();
    entryId = g ? rootOf(g) : firstCreatedRoot();
  }

  if (!entryId) {
    updateFlowState({
      consoleMessages: [...activeFlowState.consoleMessages, {
        nodeId: '',
        type: 'error',
        message: 'No valid entry point found.',
        timestamp: Date.now(),
      }],
    });
    return;
  }

  // reset goto decisions freshly and injectedvalues
  updateFlowState({
    nodes: activeFlowState.nodes.map(n =>
      n.data?.type === 'goto' ? { ...n, data: { ...n.data, gotoDecision: null } } : n
    ),
  });
  updateFlowState({
    nodes: activeFlowState.nodes.map(n =>
      n.data?._injectedInput ? { ...n, data: { ...n.data, _injectedInput: undefined } } : n
    ),
  });

  // ---------- scheduler ----------
  const executed = new Set<string>();
  const executing = new Set<string>();
  const visitCount: Record<string, number> = {};
  const executedAt: Record<string, number> = {};
  let tick = 0;

  const MAX_VISITS_PER_NODE = 1000;
  const MAX_STEPS = 1000;

  const ensureExecuted = async (nodeId: string, force = false): Promise<void> => {
    if (executing.has(nodeId)) return;
    if (executed.has(nodeId) && !force) return;

    const node = byId(nodeId);
    if (!node) return;

    executing.add(nodeId);

    // predecessors first
    const preds = incoming(nodeId).map(e => e.source);
    for (const p of preds) await ensureExecuted(p, false);

    if (node.data?.type === 'goto') {
      // 1) If a previous goto forwarded an input, prefer it
      const injected = (node.data as any)?._injectedInput;
      let processedInputs: any;

      if (typeof injected !== 'undefined') {
        processedInputs = injected;
        // clear it so it's single-use
        activeFlowState = sessionStore().getActiveFlowState()!;
        updateFlowState({
          nodes: activeFlowState.nodes.map(n =>
            n.id === nodeId ? { ...n, data: { ...n.data, _injectedInput: undefined } } : n
          ),
        });
      } else {
        // 2) Otherwise, compute from predecessors
        const inEdges = incoming(nodeId);
        const inputNodes = inEdges
          .map(e => byId(e.source))
          .filter((n): n is NonNullable<typeof n> => !!n);

        const inputs = await Promise.all(
          inputNodes.map(async (n) => {
            if (n.data?.type === 'variable') {
              // Parse JSON if possible
              try {
                return JSON.parse(n.data.value || '');
              } catch {
                return n.data.value;
              }
            }
            return byId(n.id)?.data?.output;
          })
        );
        processedInputs = inputs.length === 1 ? inputs[0] : inputs;
      }

      // 3) Evaluate rules and capture per-rule forward flag
      const rules = Array.isArray(node.data?.conditions) ? node.data.conditions : [];
      let decision: string | null = null;
      let forward = false;

      // Collect variables from all Variable nodes for condition evaluation
      activeFlowState = sessionStore().getActiveFlowState()!;
      const gotoVariables = collectVariables(activeFlowState.nodes);

      for (const r of rules) {
        if (r?.expr && r?.goto) {
          if (evalGotoExpr(r.expr, processedInputs, gotoVariables)) {
            decision = r.goto;
            forward = !!r.forwardInput; // per-condition forwarding
            //break; // evaluate ALL conditions, the last one is the good one.
          }
        }
      }

      // 4) Persist decision + visible output on the goto node
      activeFlowState = sessionStore().getActiveFlowState()!;
      updateFlowState({
        nodes: activeFlowState.nodes.map(n =>
          n.id === nodeId ? { ...n, data: { ...n.data, output: processedInputs, gotoDecision: decision } } : n
        ),
      });

      // 5) If the matched rule says so, forward the input to the jump target
      if (decision && forward) {
        activeFlowState = sessionStore().getActiveFlowState()!;
        updateFlowState({
          nodes: activeFlowState.nodes.map(n =>
            n.id === decision ? { ...n, data: { ...n.data, _injectedInput: processedInputs } } : n
          ),
        });
      }
    } else {
      // Execute regular nodes using the full executeNode logic
      // Pass true to indicate this is from flow execution context
      await executeNode(nodeId, true, sessionStore);

      // CRITICAL: Wait for state to be fully updated before continuing
      // This ensures the node's output is available before goto nodes read it
      await new Promise(resolve => setTimeout(resolve, 0));

      // Refresh the node reference to get the updated output
      activeFlowState = sessionStore().getActiveFlowState()!;
      const updatedNode = byId(nodeId);

      // Verify the output was actually set
      if (updatedNode && typeof updatedNode.data?.output === 'undefined') {
        // If output is still undefined after execution, wait a bit more
        await new Promise(resolve => setTimeout(resolve, 10));
      }
    }

    executed.add(nodeId);
    executedAt[nodeId] = ++tick;
    executing.delete(nodeId);
  };

  const stepTo = async (nextId: string, stepBudget: { left: number }) => {
    if (stepBudget.left-- <= 0) return;

    visitCount[nextId] = (visitCount[nextId] ?? 0) + 1;
    if (visitCount[nextId] > MAX_VISITS_PER_NODE) return;

    const node = byId(nextId);
    const preds = incoming(nextId).map(e => e.source);

    // refresh rule applies to ALL nodes, not just goto
    const needsRefresh =
      preds.some(p => (executedAt[p] || 0) > (executedAt[nextId] || 0));

    await ensureExecuted(nextId, needsRefresh);

    const n = byId(nextId);
    if (!n) return;

    if (n.data?.type === 'goto') {
      const decision = n.data.gotoDecision;

      if (decision) {
        // Re-run the jump target so loops and cross-branch jumps recompute
        await ensureExecuted(decision, true);
        await stepTo(decision, stepBudget);
        return;
      }

      const outs = outgoing(nextId);
      for (const e of outs) await stepTo(e.target, stepBudget);
      return;
    }

    // normal node: follow outs
    const outs = outgoing(nextId);
    for (const e of outs) await stepTo(e.target, stepBudget);
  };

  await stepTo(entryId, { left: MAX_STEPS });
}
