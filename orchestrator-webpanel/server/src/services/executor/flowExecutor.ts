import { jobs, emitJobLog, collectFlowVariables, sanitizeVariableName, nowUid, createLogCollector, emitNodeStatus, processJob, jobLogBuffers, DEFAULT_FLOW_TIMEOUT_MS, runningProcesses, executionNodeStatuses, executionSSEListeners, extractArtifacts, cleanupArtifacts, SERVER_EXECUTION_ENABLED, scopeKey, NODE_SCOPE_SEP } from './nodeExecutor';
import { getCollection } from '../db/index';
import { dispatchToWorker, isWorkerOnline } from '../../routes/workers';
import { resolveSecretsDetailed } from '../../routes/secrets';
import { eventBus } from '../scheduler/eventBus';
import kill from 'tree-kill';
import { ChildProcess } from 'child_process';

const EXECUTION_DIR = process.env.ORCHESTRATOR_EXECUTION_DIR || process.env.ORCHESTRATOR_WORK_DIR || process.cwd();
const KEEP_ARTIFACTS = process.env.ORCHESTRATOR_KEEP_ARTIFACTS === 'true';

const REMOTE_TYPES = new Set(['powershell', 'batch', 'python', 'groovy', 'jsbackend', 'shell', 'bash']);

// How the server schedules top-level flow executions. Mirrors the worker's
// WORKER_EXECUTION_MODE (see orchestrator-worker/src/agent.ts):
//   'parallel'   (default) — every triggered flow run starts immediately, so
//                 multiple flow executions run concurrently in-process.
//   'sequential' — flow runs are serialized: each waits for the previous one to
//                 finish before its job is dispatched. Within a single flow,
//                 node traversal is already sequential (DFS) regardless of mode.
const SERVER_EXECUTION_MODE: 'parallel' | 'sequential' =
  (process.env.SERVER_EXECUTION_MODE || 'parallel').toLowerCase() === 'sequential' ? 'sequential' : 'parallel';

// Promise chain used to serialize flow executions in sequential mode. Each new
// run is appended; it only starts once the previous link resolves. `.catch`
// keeps the chain alive even if a link ever rejects.
let executionChain: Promise<void> = Promise.resolve();

export function parseFlowContent(flowContent: string): any {
  let flow: any;
  try { flow = JSON.parse(flowContent); } catch (e: any) { throw new Error(`Invalid JSON in flow content: ${e.message}`); }
  if (!flow || !Array.isArray(flow.nodes) || !Array.isArray(flow.edges)) throw new Error('Invalid flow content: missing nodes or edges');
  const nodeMap: Record<string, any> = {};
  flow.nodes.forEach((n: any) => (nodeMap[n.id] = n));
  const incomingMap: Record<string, any[]> = {};
  const outgoingMap: Record<string, any[]> = {};
  flow.edges.forEach((e: any) => {
    (incomingMap[e.target] ||= []).push(e);
    (outgoingMap[e.source] ||= []).push(e);
  });
  const roots = flow.nodes.map((n: any) => n.id).filter((id: string) => !(incomingMap[id] && incomingMap[id].length));
  return { flow, nodeMap, incomingMap, outgoingMap, roots };
}

async function executeRegularNode(node: any, nodeId: string, processedInputs: any, nodeResults: Record<string, any>, _isInline: boolean, timeout: number, basePath: string, flowVariables: Record<string, any>, jobId: string | null, workerId: string | null = null, parentNodeId: string | null = null, artifacts?: Array<{name: string; data: string}>, parentScope: string = ''): Promise<any> {
  let rawCode: string = node?.data?.code || '';
  let nodeType = node?.data?.type;
  // Effective artifacts for this node = parent artifacts + (for flowRef nodes)
  // the referenced flow's own artifacts. A flowRef pointing at flow2 needs
  // flow2's artifacts deployed before any of its inner nodes run.
  let effectiveArtifacts: Array<{name: string; data: string}> | undefined = artifacts;
  // When this node is a flowRef invocation, we also create a dedicated
  // execution record for the referenced flow so it appears in its own
  // executions list and the global one — with triggeredBy = "triggered - <flow1>".
  let nestedExec: { execId: string; flowId: string; startTime: string; nodeIds: Set<string> } | null = null;
  // flowRef sub-flows run under their OWN assigned worker, not the parent
  // flow's. flow1 (workerA) calling flow2 (workerB) → flow2 dispatched to
  // workerB. Falls back to the parent's workerId only when the sub-flow has
  // no worker assigned.
  let effectiveWorkerId: string | null = workerId;

  // flowRef: node references another flow by ID — load it from DB and execute inline.
  if (nodeType === 'flow' && node?.data?.flowRef) {
    try {
      const flowsCol = getCollection('flows');
      const referencedFlow = await flowsCol.findOne({ _id: node.data.flowRef });
      if (!referencedFlow) throw new Error(`Referenced flow not found: ${node.data.flowRef}`);
      rawCode = JSON.stringify({ nodes: referencedFlow.nodes || [], edges: referencedFlow.edges || [] });
      // Honour flow2's own worker assignment, otherwise inherit flow1's.
      effectiveWorkerId = referencedFlow.workerId || workerId || null;
      const refArtifacts: Array<{name: string; data: string}> = referencedFlow.artifacts || [];
      if (refArtifacts.length) {
        // De-dupe by name — parent wins so a flow1 artifact still shadows a
        // flow2 artifact when both ship the same filename. Then extract the
        // merged set locally so server-side leaf nodes inside flow2 find them.
        const byName = new Map<string, {name: string; data: string}>();
        for (const a of refArtifacts) byName.set(a.name, a);
        for (const a of artifacts || []) byName.set(a.name, a);
        effectiveArtifacts = Array.from(byName.values());
        if (!effectiveWorkerId) {
          try { extractArtifacts(refArtifacts, EXECUTION_DIR); } catch (e: any) {
            console.warn(`[flow] flowRef artifact extraction warning: ${e.message}`);
          }
        }
      }
      // Create the flow2 execution record. triggeredBy carries the parent
      // flow's name so the executions list shows "triggered - <flow1>".
      try {
        const execsCol = getCollection('executions');
        const workersCol = getCollection('workers');
        let parentFlowName: string | null = null;
        if (jobId) {
          const parentExec = await execsCol.findOne({ jobId });
          parentFlowName = parentExec?.flowName || null;
        }
        let workerName: string | null = null;
        if (effectiveWorkerId) {
          const w = await workersCol.findOne({ _id: effectiveWorkerId });
          workerName = w?.name || null;
        }
        const execId = nowUid();
        const startTime = new Date().toISOString();
        const nestedNodeIds = new Set<string>((referencedFlow.nodes || []).map((n: any) => n.id));
        await execsCol.insert({
          _id: execId,
          flowId: referencedFlow._id,
          flowName: referencedFlow.name,
          namespace: referencedFlow.namespace || 'default',
          status: 'RUNNING',
          triggeredBy: parentFlowName ? `triggered - ${parentFlowName}` : 'triggered',
          triggeredUser: null,
          startTime,
          endTime: null,
          duration: null,
          jobId: null,
          workerId: effectiveWorkerId,
          workerName,
          logs: [],
          output: null,
          error: null,
          nodeStatuses: {},
          nodes: referencedFlow.nodes || [],
          edges: referencedFlow.edges || [],
          parentExecutionId: jobId || null,
          parentNodeId: nodeId,
        });
        nestedExec = { execId, flowId: referencedFlow._id, startTime, nodeIds: nestedNodeIds };
      } catch (e: any) {
        console.warn(`[flow] failed to create nested execution record: ${e.message}`);
      }
    } catch (err: any) {
      throw new Error(`Failed to load referenced flow: ${err.message}`);
    }
  }

  // Remote dispatch: send script-type nodes to the assigned worker.
  // The node's code is sent with its `${{ secrets.NAME }}` placeholders INTACT —
  // the worker fetches the decrypted values from the server right before it runs
  // the node (see /workers/:id/jobs/:jobId/secrets), so secret plaintext never
  // lands in the worker_jobs record or the poll response. JS nodes stay local
  // because they need direct access to flowVariables.
  if (workerId && jobId && REMOTE_TYPES.has(nodeType)) {
    try {
      const remoteNode = {
        type: nodeType,
        data: {
          code: rawCode,
          input: processedInputs,
          variables: flowVariables,
          timeout: timeout && timeout !== Infinity ? Math.ceil(timeout / 1000) : 0,
        },
      };
      emitJobLog(jobId, 'log', `[remote] dispatching ${nodeType} node to worker ${workerId}`, nodeId, parentScope);
      const { output, variables: workerVars } = await dispatchToWorker(workerId, remoteNode, jobId, nodeId, effectiveArtifacts);
      emitJobLog(jobId, 'log', `[remote] node ${nodeId} completed on worker`, nodeId, parentScope);
      // Merge variable mutations from the remote node back into the flow's shared dict.
      if (workerVars && typeof workerVars === 'object') Object.assign(flowVariables, workerVars);
      return { output, variables: workerVars || {} };
    } catch (err: any) {
      throw new Error(`Worker dispatch failed for node ${nodeId}: ${err.message}`);
    }
  }

  // Gate: server-side execution disabled via ORCHESTRATOR_SERVER_EXECUTION_ENABLED=false.
  // Only orchestration ('flow' nodes) keeps running in-process — every leaf node
  // must be bound to a worker.
  if (!SERVER_EXECUTION_ENABLED && !workerId && nodeType !== 'flow') {
    throw new Error(
      `Server execution disabled (ORCHESTRATOR_SERVER_EXECUTION_ENABLED=false). Node ${nodeId} (${nodeType}) requires an assigned worker.`,
    );
  }

  // Local execution path: resolve `${{ secrets.NAME }}` now — i.e. at the moment
  // the node runs, not when the flow was queued. Treated the same as variables:
  // they exist as references until execution time. The original node is untouched.
  let resolvedCode = rawCode;
  if (rawCode.includes('${{')) {
    // Worker-scoped secrets shadow globals: when no worker is bound the node
    // runs on the server and only global / flow-scoped secrets apply.
    const { text, resolved, missing } = await resolveSecretsDetailed(rawCode, { workerId }, nodeType);
    resolvedCode = text;
    if (jobId && resolved.length > 0) {
      emitJobLog(jobId, 'log', `[secrets] resolved: ${resolved.join(', ')}`, nodeId, parentScope);
    }
    if (jobId && missing.length > 0) {
      emitJobLog(jobId, 'error',
        `[secrets] no secret found for: ${missing.map(m => `\`${m}\``).join(', ')} — create one in /admin or remove the placeholder`,
        nodeId, parentScope);
    }
  }

  return new Promise((resolve, reject) => {
    const { type, codeFilePath } = node.data || {};
    const code = resolvedCode;
    const finish = (result: any) => {
      if (result.error) reject(new Error(result.error));
      else resolve(result);
    };

    // Inline JS node
    if (type === 'javascript') {
      const AsyncFunction = Object.getPrototypeOf(async function () { }).constructor;
      const logs: string[] = [];
      const customConsole = {
        log: (...args: any[]) => { const m = args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' '); logs.push(m); if (jobId) emitJobLog(jobId, 'log', m, nodeId, parentScope); },
        warn: (...args: any[]) => { const m = '[WARN] ' + args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' '); logs.push(m); if (jobId) emitJobLog(jobId, 'log', m, nodeId, parentScope); },
        error: (...args: any[]) => { const m = '[ERROR] ' + args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' '); logs.push(m); if (jobId) emitJobLog(jobId, 'error', m, nodeId, parentScope); },
      };
      const varNames = Object.keys(flowVariables);
      const varDeclarations = varNames.map(n => `let ${n} = __variables[${JSON.stringify(n)}];`).join('\n');
      const varCapture = varNames.map(n => `try { __variables[${JSON.stringify(n)}] = ${n}; } catch(e) {}`).join('\n');
      try {
        const wrapped = `${varDeclarations}\nlet __userReturn;\ntry {\n  __userReturn = await (async () => { ${code || ''} })();\n} finally {\n  ${varCapture || '//'}\n}\nreturn __userReturn;`;
        const fn = new AsyncFunction('input', 'console', '__variables', wrapped);
        fn(processedInputs, customConsole, flowVariables)
          .then((out: any) => {
            if (out === undefined || out === null || out === '') out = null;
            finish({ output: out, log: logs.join('\n'), error: null, variables: flowVariables });
          })
          .catch((err: any) => reject(err));
      } catch (err) { reject(err); }
      return;
    }

    // All other types go through processJob via a transient job
    const transientJobId = nowUid();
    const isFlowNode = (type || 'javascript') === 'flow';
    const job: any = {
      jobId: transientJobId,
      type: type || 'javascript',
      code: code || '',
      codeFilePath: codeFilePath || null,
      input: processedInputs,
      timeout,
      basePath,
      variables: flowVariables,
      // Carry artifacts through so nested flows (flowRef) see the merged set
      // — parent flow's plus the referenced flow's own artifacts.
      artifacts: effectiveArtifacts && effectiveArtifacts.length ? effectiveArtifacts : undefined,
      // For flowRef sub-flows, use the sub-flow's own assigned worker so
      // flow1 (workerA) → flow2 (workerB) actually runs flow2 on workerB.
      // Non-flowRef nodes inherit the parent's workerId (effectiveWorkerId
      // equals workerId when this isn't a flowRef).
      workerId: effectiveWorkerId,
      // For flow nodes, the inner sub-graph's emit_status should be tagged with
      // the current node id so the SSE stream's parentNodeId field lets the UI
      // render an expandable group.
      parentNodeId: isFlowNode ? nodeId : parentNodeId,
      // Ancestor flow-node chain of THIS node (its own scope prefix). For a flow
      // node, processJob appends this node's id before running the sub-graph, so
      // inner nodes are tagged `…<thisNodeId>`. Lets A.F1 and B.F1 stay distinct.
      parentScope,
      // The real flow-graph node id (e.g. `node-1779129478624`). process*Node
      // tags every emitted log entry with this so the UI shows the node's
      // label (`Groovy`) instead of the throwaway transient job id, and so the
      // log line is routed to the correct execution stream.
      nodeId,
      // Forward to the parent execution's SSE listeners.
      execId: jobId,
      status: 'queued',
      startTime: new Date().toISOString(),
      stopRequested: false,
    };
    jobs.set(transientJobId, job);
    processJob(job);

    const monitor = setInterval(() => {
      const j = jobs.get(transientJobId);
      if (!j) { clearInterval(monitor); resolve({ output: null, variables: {} }); return; }
      if (!['completed', 'failed', 'stopped'].includes(j.status)) return;
      clearInterval(monitor);

      // Drain transient sub-job logs into the parent flow's log buffer so
      // flowExecutor's completion monitor can persist them on the execution record.
      const subLogs = jobLogBuffers.get(transientJobId) || [];
      if (jobId && subLogs.length) {
        if (!jobLogBuffers.has(jobId)) jobLogBuffers.set(jobId, []);
        jobLogBuffers.get(jobId)!.push(...subLogs);
      }

      // If this transient job was a flowRef, finalize the dedicated flow2
      // execution record we created earlier. Copy over the slice of logs
      // tagged with flow2's node ids so the new execution row is complete.
      if (nestedExec) {
        const ne = nestedExec;
        (async () => {
          try {
            const execsCol = getCollection('executions');
            const flowsCol = getCollection('flows');
            const endTime = new Date().toISOString();
            const duration = new Date(endTime).getTime() - new Date(ne.startTime).getTime();
            // Rebase scopes for the standalone flow2 execution row: inside the
            // parent run these inner nodes were tagged `<A's full scope>…`, but
            // in flow2's own view they are root-level, so strip that prefix.
            const stripPrefix = scopeKey(parentScope, nodeId);
            const rebaseScope = (s: string | null | undefined): string | null => {
              if (!s) return s ?? null;
              if (s === stripPrefix) return '';
              if (s.startsWith(stripPrefix + NODE_SCOPE_SEP)) return s.slice(stripPrefix.length + NODE_SCOPE_SEP.length);
              return s;
            };
            const nestedLogs = subLogs
              .filter((l: any) => !l.nodeId || ne.nodeIds.has(l.nodeId))
              .map((l: any) => ({ ...l, parentScope: rebaseScope(l.parentScope) }));
            const status = j.status === 'completed' ? 'SUCCESS' : j.status === 'stopped' ? 'KILLED' : 'FAILED';
            await execsCol.update({ _id: ne.execId }, { $set: {
              status, endTime, duration,
              output: j.output ?? null,
              error: j.error ?? null,
              logs: nestedLogs,
            } });
            await flowsCol.update({ _id: ne.flowId }, { $set: {
              lastExecution: { id: ne.execId, status, startTime: ne.startTime, endTime, duration },
            } });
          } catch (e: any) {
            console.warn(`[flow] failed to finalize nested execution: ${e.message}`);
          }
        })();
      }

      if (j.status === 'failed') reject(new Error(j.error || 'Job failed'));
      else {
        if (j.variables) Object.assign(flowVariables, j.variables);
        resolve({ output: j.output, variables: flowVariables });
      }
    }, 200);
  });
}

export async function executeInlineFlow(tempFlow: any, flowInput: any, flowPath: string[], basePath: string, timeout: number, jobId: string | null, workerId: string | null = null, parentNodeId: string | null = null, artifacts?: Array<{name: string; data: string}>, parentScope: string = ''): Promise<any> {
  const { flow, nodeMap, incomingMap, outgoingMap, roots } = tempFlow;

  const starter = flow.nodes.find((n: any) => n?.data?.isStarterNode);
  const starterId = starter ? starter.id : null;
  const flowVariables = collectFlowVariables(flow.nodes);

  const byId = (id: string) => nodeMap[id] || null;
  const incoming = (id: string) => incomingMap[id] || [];
  const outgoing = (id: string) => outgoingMap[id] || [];
  const creationIndex = (id: string) => flow.nodes.findIndex((n: any) => n.id === id);

  const rootOf = (id: string) => {
    const seen = new Set<string>();
    const acc: string[] = [];
    const stack = [id];
    while (stack.length) {
      const cur = stack.pop()!;
      if (seen.has(cur)) continue;
      seen.add(cur);
      const inc = incoming(cur);
      if (!inc.length) acc.push(cur);
      else inc.forEach((e: any) => stack.push(e.source));
    }
    if (!acc.length) return id;
    acc.sort((a, b) => creationIndex(a) - creationIndex(b));
    return acc[0];
  };

  const firstCreatedRoot = () => {
    if (!roots.length) return null;
    const r = [...roots];
    r.sort((a: string, b: string) => creationIndex(a) - creationIndex(b));
    return r[0];
  };

  const firstCreatedGoto = () => {
    const gotos = flow.nodes.filter((n: any) => n?.data?.type === 'goto');
    if (!gotos.length) return null;
    gotos.sort((a: any, b: any) => creationIndex(a.id) - creationIndex(b.id));
    return gotos[0].id;
  };

  const stripSemis = (s: string) => (s ?? '').trim().replace(/;+\s*$/, '');
  const toNumberIfNumeric = (v: any) => (typeof v === 'string' && v.trim() !== '' && !isNaN(+v) ? +v : v);
  const evalGotoExpr = (expr: string, input: any, variables: Record<string, any> = {}) => {
    try {
      const cleaned = stripSemis(expr);
      const ninput = toNumberIfNumeric(input);
      const varDecls = Object.keys(variables).map(n => `var ${n} = __vars__[${JSON.stringify(n)}];`).join('\n');
      const fn = new Function('input', 'ninput', '__vars__', `${varDecls}\nreturn !!(${cleaned});`);
      return !!fn(input, ninput, variables);
    } catch { return false; }
  };

  let entryId = starterId;
  if (!entryId) {
    const g = firstCreatedGoto();
    entryId = g ? rootOf(g) : firstCreatedRoot();
  }
  if (!entryId) throw new Error('No valid entry point found.');

  // A goto condition's `goto` may be a single node id or an array of ids (issue 4).
  const gotoTargets = (g: any): string[] =>
    (Array.isArray(g) ? g : g ? [g] : []).filter((t: any) => typeof t === 'string' && t);

  const gotoDecision: Record<string, string | string[] | null> = {};
  const nodeResults: Record<string, any> = {};
  const injectedInputs: Record<string, any> = {};
  const executed = new Set<string>();
  const executing = new Set<string>();
  const executedAt: Record<string, number> = {};
  let tick = 0;
  let lastExecutedId: string | null = null;
  const visitCount: Record<string, number> = {};
  const MAX_VISITS_PER_NODE = 1000;
  const MAX_STEPS = 1000;

  // `skipPreds`: a goto jump executes its target WITHOUT pulling in the
  // target's graph predecessors (issue 2).
  const ensureExecuted = async (nodeId: string, force = false, skipPreds = false): Promise<void> => {
    if (jobId) {
      const flowJob = jobs.get(jobId);
      if (flowJob && flowJob.stopRequested) return;
    }
    if (executing.has(nodeId)) return;
    if (executed.has(nodeId) && !force) return;

    const node = byId(nodeId);
    if (!node) return;
    executing.add(nodeId);

    if (nodeId !== starterId && !skipPreds) {
      const preds = incoming(nodeId).map((e: any) => e.source);
      for (const p of preds) await ensureExecuted(p, false);
    }

    let processedInputs: any;
    if (Object.prototype.hasOwnProperty.call(injectedInputs, nodeId)) {
      processedInputs = injectedInputs[nodeId];
    } else if (starterId && nodeId === starterId) {
      processedInputs = flowInput;
    } else {
      const preds = incoming(nodeId).map((e: any) => e.source);
      if (preds.length) {
        const vals = preds.map((p: string) => nodeResults[p]);
        processedInputs = vals.length === 1 ? vals[0] : vals;
      } else {
        processedInputs = flowInput;
      }
    }

    if (node?.data?.type === 'goto') {
      const rules = Array.isArray(node?.data?.conditions) ? node.data.conditions : [];
      let decision: string | string[] | null = null;
      let forward = false;
      let matchedExpr: string | null = null;
      for (const r of rules) {
        if (r?.expr && gotoTargets(r?.goto).length && evalGotoExpr(r.expr, processedInputs, flowVariables)) {
          decision = r.goto; forward = !!r.forwardInput; matchedExpr = r.expr; break;
        }
      }
      gotoDecision[nodeId] = decision;
      nodeResults[nodeId] = processedInputs;
      const decisionTargets = gotoTargets(decision);
      if (decisionTargets.length && forward) for (const t of decisionTargets) injectedInputs[t] = processedInputs;
      if (jobId) {
        const gotoLabel = node.data?.label || nodeId;
        if (decisionTargets.length) {
          const targetLabel = decisionTargets.map(t => byId(t)?.data?.label || t).join(', ');
          const exprStr = matchedExpr ? ` [${matchedExpr}]` : '';
          emitJobLog(jobId, 'flow', `[goto] ${gotoLabel}${exprStr} → ${targetLabel}`, nodeId, parentScope);
        } else {
          const outs = outgoing(nodeId);
          const nextLabel = outs.length > 0 ? (byId(outs[0].target)?.data?.label || outs[0].target) : '(end)';
          emitJobLog(jobId, 'flow', `[goto] ${gotoLabel} no match → ${nextLabel}`, nodeId, parentScope);
        }
      }
    } else if (node?.data?.type === 'variable') {
      const rawValue = node.data.value || '';
      try { nodeResults[nodeId] = JSON.parse(rawValue); } catch { nodeResults[nodeId] = rawValue; }
    } else {
      if (jobId && node?.data?.type === 'flow') {
        emitJobLog(jobId, 'flow', `[flow] ${node.data?.label || nodeId}`, nodeId, parentScope);
      }

      // Error-handling policy for this node:
      //   'stop'     — (default) a failure aborts the whole flow.
      //   'continue' — log the failure and carry on with a null result.
      //   'retry'    — re-run up to retry.maxAttempts with a fixed / linear /
      //                exponential backoff; if every attempt fails, the flow stops.
      const onErrorRaw = node.data?.onError;
      const onError: 'stop' | 'continue' | 'retry' =
        onErrorRaw === 'continue' || onErrorRaw === 'retry' ? onErrorRaw : 'stop';
      const retryCfg = node.data?.retry || {};
      const maxAttempts = onError === 'retry' ? Math.max(1, Number(retryCfg.maxAttempts) || 3) : 1;
      // Accept either the new `delaySec` or the legacy `delayMs`.
      const baseDelayMs = retryCfg.delayMs != null ? Number(retryCfg.delayMs) : (Number(retryCfg.delaySec) || 1) * 1000;
      const backoff: 'fixed' | 'linear' | 'exponential' =
        retryCfg.backoff === 'linear' || retryCfg.backoff === 'exponential' ? retryCfg.backoff : 'fixed';
      const nodeLabel = node.data?.label || nodeId;

      // True once the flow execution has been killed — aborts retries / waits.
      const killed = () => { const fj = jobId ? jobs.get(jobId) : null; return !!(fj && fj.stopRequested); };

      let attempt = 0;
      let res: any;

      // eslint-disable-next-line no-constant-condition
      while (true) {
        if (killed()) return;
        if (attempt > 0) {
          const waitMs = backoff === 'exponential' ? baseDelayMs * Math.pow(2, attempt - 1)
            : backoff === 'linear' ? baseDelayMs * attempt
            : baseDelayMs;
          if (jobId) {
            emitJobLog(jobId, 'flow', `[FLOW] node "${nodeLabel}" retry ${attempt}/${maxAttempts - 1} in ${Math.round(waitMs / 1000)}s`, nodeId, parentScope);
            emitNodeStatus(jobId, nodeId, 'retrying', { attempt, waitMs, parentNodeId, parentScope });
          }
          // Interruptible back-off: a kill during the wait aborts immediately.
          for (let waited = 0; waited < waitMs; waited += 200) {
            if (killed()) return;
            await new Promise(r => setTimeout(r, Math.min(200, waitMs - waited)));
          }
          if (killed()) return;
        }

        if (jobId) emitNodeStatus(jobId, nodeId, attempt === 0 ? 'running' : 'retrying', { attempt, parentNodeId, parentScope });

        // One input log per attempt: computeNodeRuns opens a new run on each
        // input log, so every retry becomes its own timeline segment (started
        // after the back-off wait, coloured by that attempt's own outcome).
        if (jobId) emitJobLog(jobId, 'input', JSON.stringify(processedInputs, null, 2), nodeId, parentScope);

        try {
          res = await executeRegularNode(node, nodeId, processedInputs, nodeResults, true, timeout, basePath, flowVariables, jobId, workerId, parentNodeId, artifacts, parentScope);
          if (jobId) emitNodeStatus(jobId, nodeId, 'success', { attempt, parentNodeId, parentScope });
          break;
        } catch (err: any) {
          // A failure caused by the execution being killed isn't a real failure —
          // don't retry, don't mark it failed; just unwind.
          if (killed()) return;
          attempt++;
          if (attempt < maxAttempts) {
            if (jobId) emitJobLog(jobId, 'flow', `[FLOW] node "${nodeLabel}" failed: ${err.message}`, nodeId, parentScope);
            continue;
          }
          // No retries left (or none configured).
          if (jobId) emitNodeStatus(jobId, nodeId, 'failed', { attempt, error: err.message, parentNodeId, parentScope });
          if (onError === 'continue') {
            if (jobId) emitJobLog(jobId, 'flow', `[FLOW] node "${nodeLabel}" failed: ${err.message} — continuing`, nodeId, parentScope);
            res = { output: null, variables: {} };
            break;
          }
          if (jobId) {
            const suffix = maxAttempts > 1 ? ` after ${maxAttempts} attempts` : '';
            emitJobLog(jobId, 'flow', `[FLOW] node "${nodeLabel}" failed${suffix}: ${err.message} — stopping flow`, nodeId, parentScope);
          }
          throw err;
        }
      }

      if (res?.variables && Object.keys(res.variables).length > 0) {
        Object.assign(flowVariables, res.variables);
        for (const [varName, varValue] of Object.entries(res.variables)) {
          const varNode = flow.nodes.find((n: any) => n.data?.type === 'variable' && sanitizeVariableName(n.data.label) === varName);
          if (varNode) nodeResults[varNode.id] = varValue;
        }
      }
      nodeResults[nodeId] = res?.output !== undefined ? res.output : res;

      if (jobId) {
        const outVal = nodeResults[nodeId];
        let formatted: string;
        try { formatted = typeof outVal === 'string' ? outVal : JSON.stringify(outVal, null, 2); }
        catch { formatted = String(outVal); }
        emitJobLog(jobId, 'output', formatted ?? 'null', nodeId, parentScope);
      }
    }

    if (node?.data?.type !== 'goto') lastExecutedId = nodeId;
    executed.add(nodeId);
    executedAt[nodeId] = ++tick;
    executing.delete(nodeId);
  };

  const stepTo = async (nextId: string, budget: { left: number }): Promise<void> => {
    if (jobId) {
      const flowJob = jobs.get(jobId);
      if (flowJob && flowJob.stopRequested) return;
    }
    if (budget.left-- <= 0) return;
    visitCount[nextId] = (visitCount[nextId] ?? 0) + 1;
    if (visitCount[nextId] > MAX_VISITS_PER_NODE) return;

    const node = byId(nextId);
    if (!node) return;

    const preds = incoming(nextId).map((e: any) => e.source);
    const needsRefresh = preds.some((p: string) => (executedAt[p] || 0) > (executedAt[nextId] || 0));
    await ensureExecuted(nextId, needsRefresh);

    const n = byId(nextId);
    if (!n) return;

    if (n?.data?.type === 'goto') {
      const targets = gotoTargets(gotoDecision[nextId]);
      if (targets.length) {
        // skipPreds=true: a goto jump must not execute the target's predecessors (issue 2).
        for (const t of targets) {
          await ensureExecuted(t, true, true);
          await stepTo(t, budget);
        }
        return;
      }
      for (const e of outgoing(nextId)) await stepTo(e.target, budget);
      return;
    }

    for (const e of outgoing(nextId)) await stepTo(e.target, budget);
  };

  await stepTo(entryId, { left: MAX_STEPS });
  return lastExecutedId ? nodeResults[lastExecutedId] : null;
}

/* ============================
   Orchestrator flow execution (library)
   ============================ */

export async function executeOrchestratorFlow(flowId: string, triggeredBy: string = 'manual', triggeredUser?: string): Promise<string | null> {
  const flowsCol = getCollection('flows');
  const execsCol = getCollection('executions');

  const flow = await flowsCol.findOne({ _id: flowId });
  if (!flow) return null;

  const { nowUid: uid } = await import('./nodeExecutor');
  const executionId = nowUid();
  const startTime = new Date().toISOString();
  const WORK_DIR = process.env.ORCHESTRATOR_WORK_DIR || process.cwd();

  // Resolve worker before inserting the execution so we can store the name.
  let resolvedWorkerId: string | null = null;
  let resolvedWorkerName: string | null = null;
  if (flow.workerId) {
    const workersCol = getCollection('workers');
    const w = await workersCol.findOne({ _id: flow.workerId });
    const isOnline = isWorkerOnline(w?.lastSeenAt);
    if (!w || !isOnline) {
      const endTime = new Date().toISOString();
      const duration = new Date(endTime).getTime() - new Date(startTime).getTime();
      const reason = !w ? 'Assigned worker not found' : `Assigned worker "${w.name}" is offline`;
      const failedExec: any = {
        _id: executionId, flowId, flowName: flow.name, namespace: flow.namespace || 'default',
        status: 'FAILED', triggeredBy, triggeredUser: triggeredUser || null, startTime, endTime, duration, jobId: null,
        workerId: flow.workerId, workerName: w?.name || null,
        logs: [{ type: 'error', message: reason, nodeId: null, timestamp: Date.now() }],
        output: null, error: reason, nodeStatuses: {}, nodes: flow.nodes || [], edges: flow.edges || [],
      };
      await execsCol.insert(failedExec);
      await flowsCol.update({ _id: flowId }, { $set: { lastExecution: { id: executionId, status: 'FAILED', startTime, endTime, duration } } });
      return executionId;
    }
    resolvedWorkerId = flow.workerId;
    resolvedWorkerName = w.name || null;
  }

  const execution: any = {
    _id: executionId,
    flowId,
    flowName: flow.name,
    namespace: flow.namespace || 'default',
    status: 'RUNNING',
    triggeredBy,
    triggeredUser: triggeredUser || null,
    startTime,
    endTime: null,
    duration: null,
    jobId: null,
    workerId: resolvedWorkerId,
    workerName: resolvedWorkerName,
    logs: [],
    output: null,
    error: null,
    nodeStatuses: {},
    nodes: flow.nodes || [],
    edges: flow.edges || [],
  };

  await execsCol.insert(execution);
  await flowsCol.update({ _id: flowId }, { $set: { lastExecution: { id: executionId, status: 'RUNNING', startTime, endTime: null, duration: null } } });

  const jobId = nowUid();
  const flowContent = JSON.stringify({ nodes: flow.nodes || [], edges: flow.edges || [] });
  const flowArtifacts: Array<{name: string; data: string}> = flow.artifacts || [];

  // Extract artifacts locally before execution (for server-side nodes)
  if (flowArtifacts.length && !resolvedWorkerId) {
    try { extractArtifacts(flowArtifacts, EXECUTION_DIR); } catch (e: any) {
      console.warn('[flow] artifact extraction warning:', e.message);
    }
  }

  const job: any = {
    jobId,
    sessionId: 'flows-internal',
    type: 'flow',
    code: flowContent,
    codeFilePath: null,
    input: null,
    timeout: 0,
    basePath: EXECUTION_DIR,
    variables: {},
    workerId: resolvedWorkerId,
    artifacts: flowArtifacts.length ? flowArtifacts : undefined,
    status: 'queued',
    startTime: new Date().toISOString(),
    stopRequested: false,
  };

  jobs.set(jobId, job);
  await execsCol.update({ _id: executionId }, { $set: { jobId } });

  // Start the job and resolve once it reaches a terminal state. In sequential
  // mode this promise is what the next queued flow waits on.
  const runFlow = (): Promise<void> => new Promise<void>((resolveRun) => {
  setTimeout(() => processJob(job), 0);

  const monitor = setInterval(async () => {
    const j = jobs.get(jobId);
    if (!j) { clearInterval(monitor); resolveRun(); return; }
    if (!['completed', 'failed', 'stopped'].includes(j.status)) return;
    clearInterval(monitor);

    const endTime = new Date().toISOString();
    const duration = new Date(endTime).getTime() - new Date(startTime).getTime();
    const status = j.stopRequested ? 'KILLED' : j.status === 'completed' ? 'SUCCESS' : j.status === 'stopped' ? 'KILLED' : 'FAILED';
    const logBuf = jobLogBuffers.get(jobId) || [];
    // Sweep stale `running`/`retrying` node statuses: when the flow ends
    // (kill, fatal error, server-side abort), per-node `success`/`failed`
    // emit_status calls may never have fired for nodes still in flight.
    // Without this they'd stay spinning forever in the execution graph.
    const finalNodeState = status === 'SUCCESS' ? 'success' : status === 'KILLED' ? 'killed' : 'failed';
    const ns = executionNodeStatuses.get(jobId) || executionNodeStatuses.get(executionId);
    if (ns) {
      for (const [nodeId, payload] of Object.entries(ns)) {
        if (payload && (payload.status === 'running' || payload.status === 'retrying')) {
          (payload as any).status = finalNodeState;
          (payload as any).ts = Date.now();
          // Broadcast to any live SSE listeners so the graph overlay updates immediately.
          const listeners = executionSSEListeners.get(jobId) || executionSSEListeners.get(executionId);
          if (listeners) {
            for (const res of listeners) {
              try { res.write(`data: ${JSON.stringify({ ...payload, nodeId })}\n\n`); } catch { /* client gone */ }
            }
          }
        }
      }
    }
    // Snapshot final per-node statuses so the graph can re-render them on
    // future visits (after the in-memory buffer is freed).
    const nodeStatuses = ns || {};

    await execsCol.update({ _id: executionId }, { $set: { status, endTime, duration, output: j.output, error: j.error, logs: logBuf, nodeStatuses } });
    await flowsCol.update({ _id: flowId }, { $set: { lastExecution: { id: executionId, status, startTime, endTime, duration } } });

    // Emit lifecycle events so `type=event` schedules bound to flow.completed /
    // flow.failed actually fire. SUCCESS → flow.completed, anything else → flow.failed.
    try {
      const eventName = status === 'SUCCESS' ? 'flow.completed' : 'flow.failed';
      eventBus.emit(eventName, { flowId, executionId, status, flowName: flow.name });
    } catch (e: any) {
      console.warn('[flow] failed to emit lifecycle event:', e.message);
    }

    // Clean up locally extracted artifacts if ORCHESTRATOR_KEEP_ARTIFACTS is not set
    if (flowArtifacts.length && !resolvedWorkerId && !KEEP_ARTIFACTS) {
      try { cleanupArtifacts(flowArtifacts, EXECUTION_DIR); } catch { }
    }

    // Drop the in-memory buffer for this run after a grace period (let any
    // currently-connected SSE clients finish their last replay first).
    setTimeout(() => {
      executionNodeStatuses.delete(jobId);
      executionNodeStatuses.delete(executionId);
    }, 60_000);
    resolveRun();
  }, 1000);
  });

  // Sequential: queue behind any in-flight run. Parallel: fire immediately.
  if (SERVER_EXECUTION_MODE === 'sequential') {
    executionChain = executionChain.catch(() => {}).then(runFlow);
  } else {
    runFlow();
  }

  return executionId;
}
