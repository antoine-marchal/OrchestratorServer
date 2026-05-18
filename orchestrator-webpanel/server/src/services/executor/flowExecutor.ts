import { jobs, emitJobLog, collectFlowVariables, sanitizeVariableName, nowUid, createLogCollector, emitNodeStatus, processJob, jobLogBuffers, DEFAULT_FLOW_TIMEOUT_MS, runningProcesses, executionNodeStatuses, extractArtifacts, cleanupArtifacts } from './nodeExecutor';
import { getCollection } from '../db/index';
import { dispatchToWorker } from '../../routes/workers';
import { resolveSecretsDetailed } from '../../routes/secrets';
import kill from 'tree-kill';
import { ChildProcess } from 'child_process';

const EXECUTION_DIR = process.env.ORCHESTRATOR_EXECUTION_DIR || process.env.ORCHESTRATOR_WORK_DIR || process.cwd();
const KEEP_ARTIFACTS = process.env.ORCHESTRATOR_KEEP_ARTIFACTS === 'true';

const REMOTE_TYPES = new Set(['powershell', 'batch', 'python', 'groovy', 'jsbackend', 'playwright', 'shell', 'bash']);

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

async function executeRegularNode(node: any, nodeId: string, processedInputs: any, nodeResults: Record<string, any>, _isInline: boolean, timeout: number, basePath: string, flowVariables: Record<string, any>, jobId: string | null, workerId: string | null = null, parentNodeId: string | null = null, artifacts?: Array<{name: string; data: string}>): Promise<any> {
  let rawCode: string = node?.data?.code || '';
  let nodeType = node?.data?.type;

  // flowRef: node references another flow by ID — load it from DB and execute inline.
  if (nodeType === 'flow' && node?.data?.flowRef) {
    try {
      const flowsCol = getCollection('flows');
      const referencedFlow = await flowsCol.findOne({ _id: node.data.flowRef });
      if (!referencedFlow) throw new Error(`Referenced flow not found: ${node.data.flowRef}`);
      rawCode = JSON.stringify({ nodes: referencedFlow.nodes || [], edges: referencedFlow.edges || [] });
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
      emitJobLog(jobId, 'log', `[remote] dispatching ${nodeType} node to worker ${workerId}`, nodeId);
      const { output, variables: workerVars } = await dispatchToWorker(workerId, remoteNode, jobId, nodeId, artifacts);
      emitJobLog(jobId, 'log', `[remote] node ${nodeId} completed on worker`, nodeId);
      // Merge variable mutations from the remote node back into the flow's shared dict.
      if (workerVars && typeof workerVars === 'object') Object.assign(flowVariables, workerVars);
      return { output, variables: workerVars || {} };
    } catch (err: any) {
      throw new Error(`Worker dispatch failed for node ${nodeId}: ${err.message}`);
    }
  }

  // Local execution path: resolve `${{ secrets.NAME }}` now — i.e. at the moment
  // the node runs, not when the flow was queued. Treated the same as variables:
  // they exist as references until execution time. The original node is untouched.
  let resolvedCode = rawCode;
  if (rawCode.includes('${{')) {
    const { text, resolved, missing } = await resolveSecretsDetailed(rawCode);
    resolvedCode = text;
    if (jobId && resolved.length > 0) {
      emitJobLog(jobId, 'log', `[secrets] resolved: ${resolved.join(', ')}`, nodeId);
    }
    if (jobId && missing.length > 0) {
      emitJobLog(jobId, 'error',
        `[secrets] no secret found for: ${missing.map(m => `\`${m}\``).join(', ')} — create one in /admin or remove the placeholder`,
        nodeId);
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
        log: (...args: any[]) => { const m = args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' '); logs.push(m); if (jobId) emitJobLog(jobId, 'log', m, nodeId); },
        warn: (...args: any[]) => { const m = '[WARN] ' + args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' '); logs.push(m); if (jobId) emitJobLog(jobId, 'log', m, nodeId); },
        error: (...args: any[]) => { const m = '[ERROR] ' + args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' '); logs.push(m); if (jobId) emitJobLog(jobId, 'error', m, nodeId); },
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
      // Carry workerId so nested flow nodes still dispatch their inner script-type
      // children to the same worker.
      workerId,
      // For flow nodes, the inner sub-graph's emit_status should be tagged with
      // the current node id so the SSE stream's parentNodeId field lets the UI
      // render an expandable group.
      parentNodeId: isFlowNode ? nodeId : parentNodeId,
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
      if (jobId) {
        const subLogs = jobLogBuffers.get(transientJobId) || [];
        if (subLogs.length) {
          if (!jobLogBuffers.has(jobId)) jobLogBuffers.set(jobId, []);
          jobLogBuffers.get(jobId)!.push(...subLogs);
        }
      }

      if (j.status === 'failed') reject(new Error(j.error || 'Job failed'));
      else {
        if (j.variables) Object.assign(flowVariables, j.variables);
        resolve({ output: j.output, variables: flowVariables });
      }
    }, 200);
  });
}

export async function executeInlineFlow(tempFlow: any, flowInput: any, flowPath: string[], basePath: string, timeout: number, jobId: string | null, workerId: string | null = null, parentNodeId: string | null = null, artifacts?: Array<{name: string; data: string}>): Promise<any> {
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

  const gotoDecision: Record<string, string | null> = {};
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

  const ensureExecuted = async (nodeId: string, force = false): Promise<void> => {
    if (jobId) {
      const flowJob = jobs.get(jobId);
      if (flowJob && flowJob.stopRequested) return;
    }
    if (executing.has(nodeId)) return;
    if (executed.has(nodeId) && !force) return;

    const node = byId(nodeId);
    if (!node) return;
    executing.add(nodeId);

    if (nodeId !== starterId) {
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
      let decision: string | null = null;
      let forward = false;
      let matchedExpr: string | null = null;
      for (const r of rules) {
        if (r?.expr && r?.goto && evalGotoExpr(r.expr, processedInputs, flowVariables)) {
          decision = r.goto; forward = !!r.forwardInput; matchedExpr = r.expr; break;
        }
      }
      gotoDecision[nodeId] = decision;
      nodeResults[nodeId] = processedInputs;
      if (decision && forward) injectedInputs[decision] = processedInputs;
      if (jobId) {
        const gotoLabel = node.data?.label || nodeId;
        if (decision) {
          const targetLabel = byId(decision)?.data?.label || decision;
          const exprStr = matchedExpr ? ` [${matchedExpr}]` : '';
          emitJobLog(jobId, 'flow', `[goto] ${gotoLabel}${exprStr} → ${targetLabel}`, nodeId);
        } else {
          const outs = outgoing(nodeId);
          const nextLabel = outs.length > 0 ? (byId(outs[0].target)?.data?.label || outs[0].target) : '(end)';
          emitJobLog(jobId, 'flow', `[goto] ${gotoLabel} no match → ${nextLabel}`, nodeId);
        }
      }
    } else if (node?.data?.type === 'variable') {
      const rawValue = node.data.value || '';
      try { nodeResults[nodeId] = JSON.parse(rawValue); } catch { nodeResults[nodeId] = rawValue; }
    } else {
      if (jobId) {
        if (node?.data?.type === 'flow') {
          emitJobLog(jobId, 'flow', `[flow] ${node.data?.label || nodeId}`, nodeId);
        }
        emitJobLog(jobId, 'input', JSON.stringify(processedInputs, null, 2), nodeId);
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
            emitJobLog(jobId, 'flow', `[FLOW] node "${nodeLabel}" retry ${attempt}/${maxAttempts - 1} in ${Math.round(waitMs / 1000)}s`, nodeId);
            emitNodeStatus(jobId, nodeId, 'retrying', { attempt, waitMs, parentNodeId });
          }
          // Interruptible back-off: a kill during the wait aborts immediately.
          for (let waited = 0; waited < waitMs; waited += 200) {
            if (killed()) return;
            await new Promise(r => setTimeout(r, Math.min(200, waitMs - waited)));
          }
          if (killed()) return;
        }

        if (jobId) emitNodeStatus(jobId, nodeId, attempt === 0 ? 'running' : 'retrying', { attempt, parentNodeId });

        try {
          res = await executeRegularNode(node, nodeId, processedInputs, nodeResults, true, timeout, basePath, flowVariables, jobId, workerId, parentNodeId, artifacts);
          if (jobId) emitNodeStatus(jobId, nodeId, 'success', { attempt, parentNodeId });
          break;
        } catch (err: any) {
          // A failure caused by the execution being killed isn't a real failure —
          // don't retry, don't mark it failed; just unwind.
          if (killed()) return;
          attempt++;
          if (attempt < maxAttempts) {
            if (jobId) emitJobLog(jobId, 'flow', `[FLOW] node "${nodeLabel}" failed: ${err.message}`, nodeId);
            continue;
          }
          // No retries left (or none configured).
          if (jobId) emitNodeStatus(jobId, nodeId, 'failed', { attempt, error: err.message, parentNodeId });
          if (onError === 'continue') {
            if (jobId) emitJobLog(jobId, 'flow', `[FLOW] node "${nodeLabel}" failed: ${err.message} — continuing`, nodeId);
            res = { output: null, variables: {} };
            break;
          }
          if (jobId) {
            const suffix = maxAttempts > 1 ? ` after ${maxAttempts} attempts` : '';
            emitJobLog(jobId, 'flow', `[FLOW] node "${nodeLabel}" failed${suffix}: ${err.message} — stopping flow`, nodeId);
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
        emitJobLog(jobId, 'output', formatted ?? 'null', nodeId);
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
      const jump = gotoDecision[nextId];
      if (jump) {
        await ensureExecuted(jump, true);
        await stepTo(jump, budget);
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
    const ONLINE_THRESHOLD_MS = 30_000;
    const isOnline = w?.lastSeenAt && (Date.now() - new Date(w.lastSeenAt).getTime() < ONLINE_THRESHOLD_MS);
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

  setTimeout(() => processJob(job), 0);

  const monitor = setInterval(async () => {
    const j = jobs.get(jobId);
    if (!j) { clearInterval(monitor); return; }
    if (!['completed', 'failed', 'stopped'].includes(j.status)) return;
    clearInterval(monitor);

    const endTime = new Date().toISOString();
    const duration = new Date(endTime).getTime() - new Date(startTime).getTime();
    const status = j.stopRequested ? 'KILLED' : j.status === 'completed' ? 'SUCCESS' : j.status === 'stopped' ? 'KILLED' : 'FAILED';
    const logBuf = jobLogBuffers.get(jobId) || [];
    // Snapshot final per-node statuses so the graph can re-render them on
    // future visits (after the in-memory buffer is freed).
    const nodeStatuses = executionNodeStatuses.get(jobId) || executionNodeStatuses.get(executionId) || {};

    await execsCol.update({ _id: executionId }, { $set: { status, endTime, duration, output: j.output, error: j.error, logs: logBuf, nodeStatuses } });
    await flowsCol.update({ _id: flowId }, { $set: { lastExecution: { id: executionId, status, startTime, endTime, duration } } });

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
  }, 1000);

  return executionId;
}
