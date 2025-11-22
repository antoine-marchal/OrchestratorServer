'use strict';
const { exec } = require('child_process');
const fs = require('fs');
const fsp = require('fs').promises;
const path = require('path');
const kill = require('tree-kill');

/* ===============================
   Configuration & Environment
   =============================== */
const nodeExecutablePath = process.env.NODE_EXECUTABLE_PATH || 'node';

const INBOX = path.join(__dirname, 'inbox');
const OUTBOX = path.join(__dirname, 'outbox');

const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS ?? 200);
const STOP_CHECK_INTERVAL_MS = Number(process.env.STOP_CHECK_INTERVAL_MS ?? 500);
const DEFAULT_FLOW_TIMEOUT_MS = Number(process.env.DEFAULT_FLOW_TIMEOUT_MS ?? 0);   // 0 = infinite
const JS_BACKEND_TIMEOUT_MS = Number(process.env.JS_BACKEND_TIMEOUT_MS ?? 0);    // 0 = infinite
if (!fs.existsSync(INBOX)) fs.mkdirSync(INBOX, { recursive: true });
if (!fs.existsSync(OUTBOX)) fs.mkdirSync(OUTBOX, { recursive: true });

const argv = process.argv;
const isSilent = argv.includes('--silent') || argv.includes('-s');
const shouldShutdownAfterExecution = argv.includes('-s');

const isPackaged = (() => {
  return process.resourcesPath !== undefined;
})();
const COLORS = {
  reset: '\x1b[0m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
};
const indent = '  ';
function colorize(color, text) {
  const c = COLORS[color] || '';
  return c + text + COLORS.reset;
}

function printSectionTitle(title, color = 'cyan') {
  console.log(colorize(color, `\n=== ${title} ===`));
}

function printLabeledLine(label, value, color = 'gray') {
  console.log(colorize(color, `${label}: `) + value);
}

function printOutputBlock(formattedOutput, lineColor = 'cyan') {
  const indented =
    typeof formattedOutput === 'string'
      ? formattedOutput
        .split(/\r?\n/)
        .map(line => colorize(lineColor, indent + line))
        .join('\n')
      : formattedOutput;

  console.log(colorize('yellow', 'Output:'));
  console.log(indented);
  console.log(colorize('yellow', '---'));
}

/* ===============================
   Globals
   =============================== */
global.localStorage = {};

let isMasterFlowRunning = false;
const runningProcesses = new Map(); // jobId -> ChildProcess

/* ===============================
   Paths & Resources
   =============================== */

const getResourcePath = () => {
  if (isPackaged && process.resourcesPath) {
    return path.join(process.resourcesPath, 'backend');
  }
  return path.join(__dirname);
};

const groovyJarPath = path.join(getResourcePath(), 'groovyExec.jar');

/* ===============================
   Utilities
   =============================== */

const nowUid = () => {
  // Unique-ish id across processes
  const n = process.hrtime.bigint();
  return `${Date.now()}_${n.toString(36)}_${Math.random().toString(36).slice(2)}`;
};

function registerProcess(jobId, child) {
  runningProcesses.set(jobId, child);
}

function terminateProcess(jobId) {
  const child = runningProcesses.get(jobId);
  if (!child) return;
  try {
    kill(child.pid, 'SIGTERM', (err) => {
      if (err && !isSilent) console.error(`Error killing process for job ${jobId}:`, err);
      runningProcesses.delete(jobId);
    });
  } catch (err) {
    if (!isSilent) console.error(`Error in terminateProcess for job ${jobId}:`, err);
    runningProcesses.delete(jobId);
  }
}

function shouldStopJob(jobId) {
  return fs.existsSync(path.join(INBOX, `${jobId}.stop`));
}

function cleanupStopSignal(jobId) {
  const stopFilePath = path.join(INBOX, `${jobId}.stop`);
  try {
    if (fs.existsSync(stopFilePath)) fs.unlinkSync(stopFilePath);
  } catch (err) {
    if (!isSilent) console.error(`Error cleaning up stop signal for job ${jobId}:`, err);
  }
}

function readJSONSync(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  return JSON.parse(raw);
}

function writeJSONSync(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
}

function safeUnlinkSync(filePath) {
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch (e) {
    if (!isSilent) console.warn(`Failed to unlink ${filePath}: ${e.message}`);
  }
}
function normalizeValue(v) {
  if (typeof v === 'string') return v.trim();
  return v;
}

function normalizeDeep(value) {
  if (Array.isArray(value)) return value.map(normalizeDeep);
  if (value && typeof value === 'object' && !Buffer.isBuffer(value)) {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = normalizeDeep(v);
    }
    return out;
  }
  return normalizeValue(value);
}

function normalizeInput(value) {
  return normalizeDeep(value);
}

function normalizeOutput(value) {
  return normalizeDeep(value);
}

/**
 * Console capture with restore
 */
function createLogCollector() {
  const logs = [];
  const originalConsole = {
    log: console.log,
    warn: console.warn,
    error: console.error,
  };

  const stamp = () => new Date().toISOString();

  console.log = (...args) => {
    const message = args.map(a => (typeof a === 'object' ? JSON.stringify(a, null, 2) : String(a))).join(' ');
    logs.push({ type: 'log', message: `[${stamp()}] ${message}` });
    originalConsole.log.apply(console, args);
  };
  console.warn = (...args) => {
    const message = args.map(a => (typeof a === 'object' ? JSON.stringify(a, null, 2) : String(a))).join(' ');
    logs.push({ type: 'log', message: `[${stamp()}] [WARN] ${message}` });
    originalConsole.warn.apply(console, args);
  };
  console.error = (...args) => {
    const message = args.map(a => (typeof a === 'object' ? JSON.stringify(a, null, 2) : String(a))).join(' ');
    logs.push({ type: 'error', message: `[${stamp()}] ${message}` });
    originalConsole.error.apply(console, args);
  };

  const restore = () => {
    console.log = originalConsole.log;
    console.warn = originalConsole.warn;
    console.error = originalConsole.error;
    return logs;
  };

  return { logs, restore };
}

/* ===============================
   Flow Parsing & Helpers
   =============================== */

function parseFlowFile(flowFilePath) {
  if (!fs.existsSync(flowFilePath)) throw new Error(`Flow file not found: ${flowFilePath}`);

  let flow;
  try {
    const flowContent = fs.readFileSync(flowFilePath, 'utf8');
    flow = JSON.parse(flowContent);
  } catch (e) {
    throw new Error(`Invalid JSON in flow file: ${flowFilePath} (${e.message})`);
  }

  if (!flow || !Array.isArray(flow.nodes) || !Array.isArray(flow.edges)) {
    throw new Error('Invalid flow file format: missing nodes or edges array');
  }

  const nodeMap = {};
  flow.nodes.forEach((n) => (nodeMap[n.id] = n));

  const incomingMap = {};
  const outgoingMap = {};
  flow.edges.forEach((e) => {
    (incomingMap[e.target] ||= []).push(e);
    (outgoingMap[e.source] ||= []).push(e);
  });

  const roots = flow.nodes.map((n) => n.id).filter((id) => !(incomingMap[id] && incomingMap[id].length));

  return { flow, nodeMap, incomingMap, outgoingMap, roots };
}

/* ===============================
   Flow Execution
   =============================== */

async function executeFlowFile(
  flowFilePath,
  flowInput = null,
  flowPath = [],
  isTopLevel = true,
  _respectStarterNode = true,
  basePath = null,
  timeout = 0
) {
  return new Promise((resolve, reject) => {
    (async () => {
      try {
        if (flowPath.includes(flowFilePath)) {
          console.warn(`Circular reference detected in flow execution: ${flowFilePath}`);
          return resolve(null);
        }
        const currentFlowPath = [...flowPath, flowFilePath];
        if (isTopLevel) isMasterFlowRunning = true;

        const { flow, nodeMap, incomingMap, outgoingMap, roots } = parseFlowFile(flowFilePath);

        const starter = flow.nodes.find((n) => n?.data?.isStarterNode);
        const starterId = starter ? starter.id : null;

        const byId = (id) => nodeMap[id] || null;
        const incoming = (id) => incomingMap[id] || [];
        const outgoing = (id) => outgoingMap[id] || [];
        const creationIndex = (id) => flow.nodes.findIndex((n) => n.id === id);

        const rootOf = (id) => {
          const seen = new Set();
          const acc = [];
          const stack = [id];
          while (stack.length) {
            const cur = stack.pop();
            if (seen.has(cur)) continue;
            seen.add(cur);
            const inc = incoming(cur);
            if (!inc.length) acc.push(cur);
            else inc.forEach((e) => stack.push(e.source));
          }
          if (!acc.length) return id;
          acc.sort((a, b) => creationIndex(a) - creationIndex(b));
          return acc[0];
        };
        const firstCreatedRoot = () => {
          if (!roots.length) return null;
          const r = [...roots];
          r.sort((a, b) => creationIndex(a) - creationIndex(b));
          return r[0];
        };
        const firstCreatedGoto = () => {
          const gotos = flow.nodes.filter((n) => n?.data?.type === 'goto');
          if (!gotos.length) return null;
          gotos.sort((a, b) => creationIndex(a.id) - creationIndex(b.id));
          return gotos[0].id;
        };

        const stripSemis = (s) => (s ?? '').trim().replace(/;+\\s*$/, '');
        const toNumberIfNumeric = (v) => (typeof v === 'string' && v.trim() !== '' && !isNaN(+v) ? +v : v);
        const evalGotoExpr = (expr, input) => {
          try {
            const cleaned = stripSemis(expr);
            const ninput = toNumberIfNumeric(input);
            // eslint-disable-next-line no-new-func
            const fn = new Function('input', 'ninput', `return !!(${cleaned});`);
            return !!fn(input, ninput);
          } catch {
            return false;
          }
        };

        let entryId = starterId;
        if (!entryId) {
          const g = firstCreatedGoto();
          entryId = g ? rootOf(g) : firstCreatedRoot();
        }
        if (!entryId) throw new Error('No valid entry point found.');

        const gotoDecision = {};
        const nodeResults = {};
        const injectedInputs = {};
        const executed = new Set();
        const executing = new Set();
        const executedAt = {};
        let tick = 0;
        let lastExecutedId = null;
        const visitCount = {};
        const MAX_VISITS_PER_NODE = 1000;
        const MAX_STEPS = 1000;

        const ensureExecuted = async (nodeId, force = false) => {
          if (executing.has(nodeId)) return;
          if (executed.has(nodeId) && !force) return;

          const node = byId(nodeId);
          if (!node) return;

          executing.add(nodeId);

          const preds = incoming(nodeId).map((e) => e.source);
          for (const p of preds) await ensureExecuted(p, false);

          let processedInputs;
          if (Object.prototype.hasOwnProperty.call(injectedInputs, nodeId)) {
            // forwarded input from a previous goto rule wins
            processedInputs = injectedInputs[nodeId];
          } else if (starterId && nodeId === starterId) {
            processedInputs = flowInput;
          } else {
            const preds = incoming(nodeId).map((e) => e.source);
            if (preds.length) {
              const vals = preds.map((p) => nodeResults[p]);
              processedInputs = vals.length === 1 ? vals[0] : vals;
            } else {
              processedInputs = flowInput;
            }
          }

          if (node?.data?.type === 'goto') {
            const rules = Array.isArray(node?.data?.conditions) ? node.data.conditions : [];
            let decision = null;
            let forward = false;

            for (const r of rules) {
              if (r?.expr && r?.goto) {
                if (evalGotoExpr(r.expr, processedInputs)) {
                  decision = r.goto;
                  forward = !!r.forwardInput;
                  break;
                }
              }
            }

            gotoDecision[nodeId] = decision;
            nodeResults[nodeId] = processedInputs;

            // If rule asks to forward, inject input into the jump target
            if (decision && forward) {
              injectedInputs[decision] = processedInputs;
            }

          } else if (node?.data?.type === 'flow') {
            const currentDir = path.dirname(flowFilePath);
            const nested = await executeFlowNode(
              node,
              nodeId,
              processedInputs,
              currentFlowPath,
              nodeResults,
              currentDir,
              timeout
            );
            nodeResults[nodeId] = nested?.output !== undefined ? nested.output : nested;
          } else if (node?.data?.type === 'constant') {
            nodeResults[nodeId] = node.data.value;
          } else {
            const res = await executeRegularNode(
              node,
              nodeId,
              processedInputs,
              nodeResults,
              true,
              timeout,
              basePath || path.dirname(flowFilePath)
            );
            nodeResults[nodeId] = res?.output !== undefined ? res.output : res;
          }

          if (node?.data?.type !== 'goto') lastExecutedId = nodeId;

          executed.add(nodeId);
          executedAt[nodeId] = ++tick;
          executing.delete(nodeId);
        };

        const stepTo = async (nextId, budget) => {
          if (budget.left-- <= 0) return;

          visitCount[nextId] = (visitCount[nextId] ?? 0) + 1;
          if (visitCount[nextId] > MAX_VISITS_PER_NODE) return;

          const node = byId(nextId);
          if (!node) return;

          const preds = incoming(nextId).map((e) => e.source);
          const needsRefresh = preds.some((p) => (executedAt[p] || 0) > (executedAt[nextId] || 0));

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

        const finalResult = lastExecutedId ? nodeResults[lastExecutedId] : null;

        if (isTopLevel && shouldShutdownAfterExecution) {
          setTimeout(() => process.exit(0), 500);
        }
        if (isTopLevel) isMasterFlowRunning = false;

        resolve(finalResult);
      } catch (err) {
        if (isTopLevel) isMasterFlowRunning = false;
        reject(err);
      }
    })();
  });
}

/* ===============================
   Node Executors
   =============================== */

async function executeFlowNode(node, nodeId, nodeInput, flowPath, nodeResults, currentFlowDir, timeout = 0) {
  let nestedFlowPath = '';

  if (node.data.codeFilePath) {
    nestedFlowPath = node.data.codeFilePath;
    console.log(`Using external flow file path: ${nestedFlowPath}`);
  } else {
    nestedFlowPath = node.data.code || '';
    console.log(`Using embedded flow path: ${nestedFlowPath}`);
  }

  if (!nestedFlowPath) {
    throw new Error(`Flow node ${nodeId} has no flow file path specified`);
  }

  if (!path.isAbsolute(nestedFlowPath) && flowPath.length > 0) {
    const parentFlowPath = flowPath[flowPath.length - 1];
    const parentDir = path.dirname(parentFlowPath);
    console.log(`Resolving nested flow path: ${nestedFlowPath} relative to parent flow directory: ${parentDir}`);
    nestedFlowPath = path.resolve(parentDir, nestedFlowPath);
    console.log(`Resolved nested flow path: ${nestedFlowPath}`);
  }

  const startTime = Date.now();

  const { restore: restoreNestedConsole } = createLogCollector();
  try {
    // Parse once to validate and allow future checks
    parseFlowFile(nestedFlowPath);

    const nestedFlowResult = await executeFlowFile(
      nestedFlowPath,
      nodeInput,
      flowPath,
      false,
      true,
      currentFlowDir,
      timeout
    );

    const executionTime = Date.now() - startTime;
    const nestedLogs = restoreNestedConsole();

    printSectionTitle(`Node ${node.data.label || nodeId} (${node.data.type})`, 'cyan');

    if (nestedLogs.length > 0) {
      // logs have already been printed via overridden console; no need to duplicate here
    }

    let formattedOutput;
    if (typeof nestedFlowResult === 'string') {
      formattedOutput = nestedFlowResult;
    } else {
      try {
        formattedOutput = JSON.stringify(nestedFlowResult, null, 2);
      } catch {
        formattedOutput = String(nestedFlowResult);
      }
    }

    printOutputBlock(formattedOutput, 'cyan');


    nodeResults[nodeId] = nestedFlowResult;
    nodeResults[`${nodeId}_executionTime`] = executionTime;

    return { output: nestedFlowResult, executionTime };
  } catch (err) {
    restoreNestedConsole();
    console.error(`Error executing nested flow: ${err.message}`);
    throw err;
  }
}

async function executeRegularNode(node, nodeId, nodeInput, nodeResults, waitForResult = true, timeout = 0, jobBasePath) {
  const nodeJobId = `flow-cli-${nowUid()}`;
  const nodeJob = {
    id: nodeJobId,
    code: node.data.code || '',
    codeFilePath: node.data.codeFilePath || null,
    type: node.data.type,
    input: nodeInput,
    dontWaitForOutput: node.data.dontWaitForOutput,
    basePath: jobBasePath,
    timeout: timeout,
  };

  printSectionTitle(`Executing node ${node.data.label || nodeId} (${node.data.type})`, 'cyan');
  printLabeledLine('Input', JSON.stringify(nodeInput, null, 2), 'gray');


  const startTime = Date.now();
  const nodeJobPath = path.join(INBOX, `${nodeJobId}.json`);
  writeJSONSync(nodeJobPath, nodeJob);

  if (node.data.dontWaitForOutput && !waitForResult) {
    console.log(colorize('gray',
      `Started non-blocking execution for node ${node.data.label || nodeId} (${node.data.type})`
    ));

    const executionTime = Date.now() - startTime;

    console.log(colorize('gray',
      `Non-blocking node ${node.data.label || nodeId} (${node.data.type}) completed in ${executionTime} ms`
    ));

    let formattedOutput;
    if (typeof nodeInput === 'string') {
      formattedOutput = nodeInput;
    } else {
      try {
        formattedOutput = JSON.stringify(nodeInput, null, 2);
      } catch {
        formattedOutput = String(nodeInput);
      }
    }

    printOutputBlock(formattedOutput, 'cyan');

    nodeResults[nodeId] = nodeInput;
    return { output: nodeInput, executionTime, nonBlocking: true };
  }

  return new Promise((resolveNode, rejectNode) => {
    let timeoutId;
    if (!node.data.dontWaitForOutput && timeout > 0) {
      timeoutId = setTimeout(() => {
        console.error(colorize(
          'red',
          `Node ${node.data.label || nodeId} execution timed out after ${timeout / 1000} seconds`
        ));

        if (runningProcesses.has(nodeJobId)) {
          terminateProcess(nodeJobId);
          const outFile = path.join(OUTBOX, `${nodeJobId}.result.json`);
          try {
            writeJSONSync(outFile, {
              id: nodeJobId,
              output: null,
              log: 'Process terminated due to timeout',
              error: `Process terminated after ${timeout / 1000} seconds timeout`,
              dontWaitForOutput: node.data.dontWaitForOutput,
            });
          } catch (err) {
            console.error(`Error writing timeout result file: ${err.message}`);
          }
        }
        rejectNode(new Error(`Execution timed out after ${timeout / 1000} seconds`));
      }, timeout);
    }

    const checkResult = () => {
      const resultPath = path.join(OUTBOX, `${nodeJobId}.result.json`);
      if (fs.existsSync(resultPath)) {
        try {
          if (timeoutId) clearTimeout(timeoutId);
          const result = readJSONSync(resultPath);
          safeUnlinkSync(resultPath);

          const executionTime = Date.now() - startTime;

          printSectionTitle(`Node ${node.data.label || nodeId} (${node.data.type})`, 'cyan');

          if (result.log) {
            printLabeledLine('Log', result.log, 'gray');
          }
          if (result.error) {
            console.error(colorize('red', `Error: ${result.error}`));
          }

          let formattedOutput;
          if (typeof result.output === 'string') {
            formattedOutput = result.output;
          } else {
            try {
              formattedOutput = JSON.stringify(result.output, null, 2);
            } catch {
              formattedOutput = String(result.output);
            }
          }

          printOutputBlock(formattedOutput, 'cyan');


          nodeResults[nodeId] = result.output;
          nodeResults[`${nodeId}_executionTime`] = executionTime;

          result.executionTime = executionTime;
          resolveNode(result);
        } catch (err) {
          if (timeoutId) clearTimeout(timeoutId);
          rejectNode(err);
        }
      } else {
        setTimeout(checkResult, 100);
      }
    };

    setTimeout(checkResult, 100);
  });
}

/* ===============================
   Job Processing
   =============================== */

function finalizeJob(id, result, processingPath) {
  try {
    runningProcesses.delete(id);
    const outFile = path.join(OUTBOX, `${id}.result.json`);
    writeJSONSync(outFile, { id, ...result, dontWaitForOutput: result?.dontWaitForOutput });
  } catch (err) {
    if (!isSilent) console.error(`Error during job finalize for ${id}: ${err.message}`);
  } finally {
    try {
      if (processingPath && fs.existsSync(processingPath)) fs.unlinkSync(processingPath);
    } catch (err) {
      if (!isSilent) console.error(`Error removing processing file ${processingPath}: ${err.message}`);
    }
    try {
      cleanupStopSignal(id);
    } catch (cleanupErr) {
      if (!isSilent) console.error(`Error cleaning up stop signal for ${id}: ${cleanupErr.message}`);
    }
  }
}

function processJobFile(filePath) {
  const job = readJSONSync(filePath);
  let { id, code, codeFilePath, type, input, dontWaitForOutput, timeout } = job;
  // Normalize/trim input early
  input = normalizeInput(input);
  job.input = input;

  // Determine working directory: prefer job.basePath (flow directory) if it exists
  let execCwd = process.cwd();
  try {
    if (job.basePath && fs.existsSync(job.basePath)) {
      execCwd = job.basePath;
    } else if (codeFilePath && fs.existsSync(path.dirname(codeFilePath))) {
      execCwd = path.dirname(codeFilePath);
    }
  } catch {
    // fallback to default cwd
  }

  const existingResultPath = path.join(OUTBOX, `${id}.result.json`);
  if (fs.existsSync(existingResultPath)) {
    if (!isSilent) console.log(`Job ${id} already has a result file. Skipping execution.`);
    safeUnlinkSync(filePath);
    return;
  }

  const stopFilePath = path.join(INBOX, `${id}.stop`);
  if (fs.existsSync(stopFilePath)) {
    console.log(`Found stop signal for job ${id}. Terminating process.`);
    try {
      terminateProcess(id);
      cleanupStopSignal(id);
      const outFile = path.join(OUTBOX, `${id}.result.json`);
      writeJSONSync(outFile, {
        id,
        output: null,
        log: 'Process terminated by user',
        error: 'Process terminated by user',
        dontWaitForOutput,
      });
      safeUnlinkSync(filePath);
    } catch (err) {
      if (!isSilent) console.error(`Error terminating process for job ${id}: ${err.message}`);
    }
    return;
  }

  const finish = (result) => finalizeJob(id, result, filePath);

  if (codeFilePath) {
    try {
      let resolvedCodePath = codeFilePath;
      if (!path.isAbsolute(codeFilePath)) {
        const basePath = job.basePath;
        console.log('BasePath is :', basePath);
        resolvedCodePath = path.resolve(basePath || process.cwd(), codeFilePath);
        codeFilePath = resolvedCodePath;
      }
      console.log(`Loading code from external file: ${resolvedCodePath}`);
      if (fs.existsSync(resolvedCodePath)) {
        code = fs.readFileSync(resolvedCodePath, 'utf8');
        console.log(`Successfully loaded code from ${resolvedCodePath}`);
      } else {
        console.warn(`Code file not found: ${resolvedCodePath}, falling back to embedded code`);
      }
    } catch (err) {
      console.error(`Error loading code from file ${codeFilePath}: ${err.message}`);
    }
  }
  job.code = code || '';

  if (type === 'flow') {
    let flowFilePath = '';
    if (codeFilePath) {
      flowFilePath = codeFilePath;
      console.log(`Using external flow file path: ${flowFilePath}`);
    } else {
      flowFilePath = code;
      console.log(`Using embedded flow path: ${flowFilePath}`);
    }

    if (!path.isAbsolute(flowFilePath) && job.basePath) {
      console.log(`Resolving relative path: ${flowFilePath} relative to ${job.basePath}`);
      flowFilePath = path.resolve(job.basePath, flowFilePath);
      console.log(`Resolved to: ${flowFilePath}`);
    }

    if (!fs.existsSync(flowFilePath)) {
      finish({ output: null, log: null, error: `Flow file not found: ${flowFilePath}` });
      return;
    }

    const flowPath = job.flowPath || [];
    if (flowPath.includes(flowFilePath)) {
      finish({
        output: null,
        log: `Circular reference detected in flow execution: ${flowFilePath}`,
        error: `Circular reference detected: ${flowFilePath} is already in the execution path`,
      });
      return;
    }

    (async () => {
      try {
        const { logs, restore: restoreConsole } = createLogCollector();
        try {
          const flowResult = await executeFlowFile(
            flowFilePath,
            input,
            flowPath,
            false,
            true,
            job.basePath || path.dirname(flowFilePath),
            job.timeout || DEFAULT_FLOW_TIMEOUT_MS
          );
          restoreConsole();

          const logMessages = logs
            .map((log) => (log.type === 'error' ? `ERROR: ${log.message}` : log.message))
            .join('\n');

          finish({
            output: flowResult,
            log: logMessages || `Successfully executed flow`,
            error: null,
          });
        } catch (err) {
          restoreConsole();
          throw err;
        }
      } catch (err) {
        finish({ output: null, log: null, error: `Error executing flow: ${err.message}` });
      }
    })();
  } else if (type === 'groovy') {
    processGroovyNode(id, code, input, finish, codeFilePath, execCwd);
  } else if (type === 'batch') {
    processBatchNode(id, code, input, finish, codeFilePath, execCwd);
  } else if (type === 'jsbackend' || type === 'playwright') {
    processJsBackendNode(id, code, input, finish, codeFilePath, execCwd);
  } else if (type === 'powershell') {
    processPowershellNode(id, code, input, finish, codeFilePath, execCwd);
  } else {
    processJsNode(id, code, input, finish);
  }
}

/* ===============================
   Language Runners
   =============================== */

function processGroovyNode(id, code, input, finish, _codeFilePath, execCwd) {
  const uid = nowUid();
  const tempGroovyPath = path.join(INBOX, `node_groovy_${uid}.groovy`);
  const tempInputPath = path.join(INBOX, `node_groovy_${uid}.input`);
  const tempOutputPath = path.join(INBOX, `node_groovy_${uid}.output`);
  const libPath = _codeFilePath ? path.join(path.dirname(_codeFilePath), 'lib') : undefined;

  fs.writeFileSync(tempInputPath, JSON.stringify(input === undefined ? null : input), 'utf8');

  const inputPathGroovy = tempInputPath.replace(/\\/g, '/');
  const outputPathGroovy = tempOutputPath.replace(/\\/g, '/');

  const groovyCode = `
  def smartParse = { s ->
      try { (s?.trim()?.startsWith('{') || s?.trim()?.startsWith('[')) && s?.contains('\"') ? new groovy.json.JsonSlurper().parseText(s) : Eval.me(s) }
      catch(e) { s }
  }
  input = smartParse(new File('${inputPathGroovy}').text)
  def output = ""
  ${code}
  def asJson = { obj ->
    try {
        groovy.json.JsonOutput.toJson(obj)
    } catch (e) {
        return groovy.json.JsonOutput.toJson([value: obj?.toString(), error: e.toString()])
    }
  }
  new File('${outputPathGroovy}').text = asJson(output)
  `.trim();

  try {
    fs.writeFileSync(tempGroovyPath, groovyCode, 'utf8');
  } catch (err) {
    finish({ output: null, log: `Failed to write Groovy script: ${err.message}`, error: err.message });
    return;
  }

  const javaCmd = `java -jar "${groovyJarPath}" "${tempGroovyPath}" "${libPath ? libPath : 'lib'}"`;
  const child = exec(javaCmd, { cwd: execCwd }, (error, stdout, stderr) => {
    runningProcesses.delete(id);
    safeUnlinkSync(tempGroovyPath);

    let outputValue = null;
    try {
      if (fs.existsSync(tempOutputPath)) {
        const rawOutput = fs.readFileSync(tempOutputPath, 'utf8').trim();
        try {
          outputValue = JSON.parse(rawOutput);
        } catch {
          outputValue = rawOutput;
        }
      }
    } catch {
      outputValue = null;
    } finally {
      safeUnlinkSync(tempInputPath);
      safeUnlinkSync(tempOutputPath);
    }

    if (typeof outputValue === 'string') {
      outputValue = outputValue.trim();
    }
    outputValue = normalizeOutput(outputValue);

    let errorInStdout = '';
    if (/Exception|Error|Caused by|groovy.lang|java\.lang/i.test(stdout)) {
      errorInStdout = stdout;
    }

    finish({
      log: errorInStdout === '' ? stdout.trim() : null,
      error: ((stderr || '') + (error ? error.message : '') + errorInStdout).trim() || null,
      output: outputValue,
    });
  });


  registerProcess(id, child);

  const checkStopInterval = setInterval(() => {
    if (shouldStopJob(id)) {
      clearInterval(checkStopInterval);
      terminateProcess(id);
      cleanupStopSignal(id);
      finish({ output: null, log: 'Process terminated by user', error: 'Process terminated by user' });
    }
  }, STOP_CHECK_INTERVAL_MS);

  child.on('exit', () => clearInterval(checkStopInterval));
}

function processBatchNode(id, code, input, finish, _codeFilePath, execCwd) {
  const uid = nowUid();
  const tempBatchPath = path.join(INBOX, `node_batch_${uid}.bat`);
  const tempOutputPath = path.join(INBOX, `node_batch_${uid}.output`);
  const inputVar = input !== undefined ? String(input).replace(/\\"/g, '\\\\\\"') : '';

  const batchCode =
    `@echo off
set INPUT="${inputVar}"
set OUTPUT="${tempOutputPath}"
${code}
` + `\r\n`;

  try {
    fs.writeFileSync(tempBatchPath, batchCode, 'utf8');
  } catch (err) {
    finish({ output: null, log: `Failed to write batch file: ${err.message}`, error: err.message });
    return;
  }

  const child = exec(`cmd /C "${tempBatchPath}"`, { cwd: execCwd }, (error, stdout, stderr) => {
    runningProcesses.delete(id);
    safeUnlinkSync(tempBatchPath);
    let outputValue = null;

    try {
      if (fs.existsSync(tempOutputPath)) {
        outputValue = fs.readFileSync(tempOutputPath, 'utf8').trim();
        safeUnlinkSync(tempOutputPath);
      }
    } catch {
      outputValue = null;
    }

    if (!outputValue && stdout) outputValue = stdout.trim();

    const parseJsonSafely = (data) => {
      try {
        let trimmed = typeof data === 'string' ? data.trim() : data;
        if (
          typeof trimmed === 'string' &&
          ((trimmed.startsWith("'") && trimmed.endsWith("'")) || (trimmed.startsWith('"') && trimmed.endsWith('"')))
        ) {
          trimmed = trimmed.slice(1, -1).trim();
        }
        return trimmed && (typeof trimmed === 'string') && (trimmed.startsWith('{') || trimmed.startsWith('['))
          ? JSON.parse(trimmed)
          : data;
      } catch (err) {
        console.warn(`Batch output is not valid JSON: ${err.message}`);
        return data;
      }
    };

    outputValue = parseJsonSafely(outputValue);
    outputValue = normalizeOutput(outputValue);

    let errorInStdout = '';
    if (/error|not recognized|failed|exception|not found/i.test(stdout)) {
      errorInStdout = stdout;
    }

    finish({
      log: errorInStdout === '' ? stdout.trim() : null,
      error: ((stderr || '') + (error ? error.message : '') + errorInStdout).trim() || null,
      output: outputValue,
    });
  });


  registerProcess(id, child);

  const checkStopInterval = setInterval(() => {
    if (shouldStopJob(id)) {
      clearInterval(checkStopInterval);
      terminateProcess(id);
      cleanupStopSignal(id);
      finish({ output: null, log: 'Process terminated by user', error: 'Process terminated by user' });
    }
  }, STOP_CHECK_INTERVAL_MS);

  child.on('exit', () => clearInterval(checkStopInterval));
}

function processJsBackendNode(id, code, input, finish, codeFilePath, execCwd) {
  const uid = nowUid();
  const tempId = `node_jsbackend_${uid}`;
  const tempScriptPath = path.join(INBOX, `${tempId}.mjs`); // use ESM to support import
  const tempOutputPath = path.join(INBOX, `${tempId}.output`);

  if (codeFilePath) {
    const baseFolder = path.dirname(codeFilePath);
    const importRegex = /import\s+[\s\S]*?\s+from\s+['"](.+?\.(?:js|cjs|mjs))['"]/g;
    const rewriteImports = (src, base) =>
      src.replace(importRegex, (m, importPath) => {
        if (importPath.startsWith('.') || importPath.startsWith('/')) {
          const rewrittenPath = path.join(base, importPath).replace(/\\/g, '/');
          return m.replace(importPath, 'file://' + rewrittenPath);
        }
        return m;
      });
    code = rewriteImports(code, baseFolder);
  }

  const codeWithInput = `
let output = "";
const input = ${JSON.stringify(input)};
import fs from 'fs';
${code}
fs.writeFileSync(${JSON.stringify(tempOutputPath)}, JSON.stringify(output), 'utf8');
`;

  fs.writeFileSync(tempScriptPath, codeWithInput, 'utf8');

  const child = exec(
    `${nodeExecutablePath} "${tempScriptPath}"`,
    { cwd: execCwd, timeout: JS_BACKEND_TIMEOUT_MS },
    (error, stdout, stderr) => {
      runningProcesses.delete(id);
      safeUnlinkSync(tempScriptPath);

      let outputValue = null;
      try {
        if (fs.existsSync(tempOutputPath)) {
          let raw = fs.readFileSync(tempOutputPath, 'utf8').trim();
          safeUnlinkSync(tempOutputPath);
          try {
            outputValue = JSON.parse(raw);
          } catch {
            outputValue = raw;
          }
        }
      } catch {
        outputValue = null;
      }

      if (typeof outputValue === 'string') {
        outputValue = outputValue.trim();
      }
      outputValue = normalizeOutput(outputValue);

      let errorInStdout = '';
      if (/error|not found|failed|exception/i.test(stdout)) errorInStdout = stdout;

      finish({
        log: errorInStdout === '' ? stdout.trim() : null,
        error: ((stderr || '') + (error ? error.message : '') + errorInStdout).trim() || null,
        output: outputValue,
      });
    }
  );


  registerProcess(id, child);

  const checkStopInterval = setInterval(() => {
    if (shouldStopJob(id)) {
      clearInterval(checkStopInterval);
      terminateProcess(id);
      cleanupStopSignal(id);
      finish({ output: null, log: 'Process terminated by user', error: 'Process terminated by user' });
    }
  }, STOP_CHECK_INTERVAL_MS);

  child.on('exit', () => clearInterval(checkStopInterval));
}

function processPowershellNode(id, code, input, finish, _codeFilePath, execCwd) {
  const uid = nowUid();
  const tempPs1Path = path.join(INBOX, `node_ps_${uid}.ps1`);
  const tempOutputPath = path.join(INBOX, `node_ps_${uid}.output`);
  const inputVar = input !== undefined ? String(input).replace(/"/g, '""') : '';
  const psCode = `$env:INPUT="${inputVar}"
$env:OUTPUT="${tempOutputPath}"
${code}
`;

  try {
    fs.writeFileSync(tempPs1Path, psCode, 'utf8');
  } catch (err) {
    finish({ output: null, log: `Failed to write PowerShell file: ${err.message}`, error: err.message });
    return;
  }

  const child = exec(
    `powershell -ExecutionPolicy Bypass -File "${tempPs1Path}"`,
    { cwd: execCwd },
    (error, stdout, stderr) => {
      runningProcesses.delete(id);
      safeUnlinkSync(tempPs1Path);

      let outputValue = null;
      try {
        if (fs.existsSync(tempOutputPath)) {
          outputValue = fs.readFileSync(tempOutputPath, 'utf8').trim();
          safeUnlinkSync(tempOutputPath);
        }
      } catch {
        outputValue = null;
      }

      if (!outputValue && stdout) outputValue = stdout.trim();

      if (typeof outputValue === 'string') {
        const trimmed = outputValue.trim();
        try {
          outputValue = JSON.parse(trimmed);
        } catch {
          outputValue = trimmed;
        }
      }

      outputValue = normalizeOutput(outputValue);

      const errorInStdout = /error|not recognized|failed|exception|not found/i.test(stdout) ? stdout : '';

      finish({
        log: errorInStdout === '' ? stdout.trim() : null,
        error: ((stderr || '') + (error ? error.message : '') + errorInStdout).trim() || null,
        output: outputValue,
      });
    }
  );


  registerProcess(id, child);

  const checkStopInterval = setInterval(() => {
    if (shouldStopJob(id)) {
      clearInterval(checkStopInterval);
      terminateProcess(id);
      cleanupStopSignal(id);
      finish({ output: null, log: 'Process terminated by user', error: 'Process terminated by user' });
    }
  }, STOP_CHECK_INTERVAL_MS);

  child.on('exit', () => clearInterval(checkStopInterval));
}

function processJsNode(id, code, input, finish) {
  let logs = [];
  const customConsole = {
    log: (...args) => {
      logs.push(args.map((a) => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' '));
    },
    warn: (...args) => {
      logs.push('[WARN] ' + args.map((a) => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' '));
    },
    error: (...args) => {
      logs.push('[ERROR] ' + args.map((a) => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' '));
    },
  };

  const AsyncFunction = Object.getPrototypeOf(async function () { }).constructor;
  let finished = false;
  let stopCheckInterval = null;

  stopCheckInterval = setInterval(() => {
    if (shouldStopJob(id)) {
      clearInterval(stopCheckInterval);
      cleanupStopSignal(id);
      if (!finished) {
        finished = true;
        finish({ output: null, log: 'Process terminated by user', error: 'Process terminated by user' });
      }
    }
  }, STOP_CHECK_INTERVAL_MS);

  try {
    const fn = new AsyncFunction('input', 'console', `${code}\nreturn typeof process === "function" ? await process(input) : undefined;`);
    fn(input, customConsole)
      .then((output) => {
        clearInterval(stopCheckInterval);
        if (!finished) {
          finished = true;
          output = normalizeOutput(output);
          finish({ output, log: logs.length > 0 ? logs.join('\n').trim() : '', error: null });
        }
      })
      .catch((err) => {
        clearInterval(stopCheckInterval);
        if (!finished) {
          finished = true;
          let errorInLogs = '';
          if (logs.some((log) => /error|exception|fail|not found/i.test(log))) errorInLogs = logs.join('\n');
          finish({
            output: null,
            log: logs.length > 0 ? logs.join('\n').trim() : '',
            error: ((err && err.message ? err.message : '') + (errorInLogs ? '\n' + errorInLogs : '')).trim(),
          });
        }
      });
  } catch (err) {
    clearInterval(stopCheckInterval);
    if (!finished) {
      finished = true;
      finish({
        output: null,
        log: logs.length > 0 ? logs.join('\n').trim() : '',
        error: (err && err.message ? err.message : String(err)).trim(),
      });
    }
  }

}
/* ===============================
   Inbox Polling
   =============================== */

function isJsonJobFile(name) {
  return name.endsWith('.json') && !name.endsWith('.result.json') && !name.endsWith('.processing') && !name.startsWith('.');
}

function pollInbox() {
  try {
    const files = fs.readdirSync(INBOX).filter(isJsonJobFile);
    files.forEach((file) => {
      try {
        const filePath = path.join(INBOX, file);
        const processingPath = filePath + '.processing';

        try {
          fs.renameSync(filePath, processingPath); // atomic claim
        } catch {
          return; // someone else took it
        }

        try {
          processJobFile(processingPath);
        } catch (processErr) {
          console.error(`Error processing job file ${processingPath}: ${processErr.message}`);
          try {
            if (fs.existsSync(processingPath)) fs.unlinkSync(processingPath);
          } catch (cleanupErr) {
            console.error(`Failed to clean up processing file after error: ${cleanupErr.message}`);
          }
        }
      } catch (fileErr) {
        console.error(`Error handling file ${file}: ${fileErr.message}`);
      }
    });
  } catch (err) {
    console.error(`Error polling inbox directory: ${err.message}`);
  }
}

/* ===============================
   Startup & Shutdown
   =============================== */

if (!isSilent) console.log(colorize('green', 'Backend file-based executor started.'));

const pollTimer = setInterval(pollInbox, POLL_INTERVAL_MS);

const shutdown = (signal) => {
  if (!isSilent) console.log(`Received ${signal}. Shutting down...`);
  clearInterval(pollTimer);
  // best-effort terminate child processes
  for (const [jobId] of runningProcesses) {
    try {
      terminateProcess(jobId);
    } catch { }
  }
  process.exit(0);
};

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

/* ===============================
   Exports
   =============================== */

module.exports = {
  executeFlowFile,
};
