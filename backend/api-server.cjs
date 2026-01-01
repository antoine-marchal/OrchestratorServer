'use strict';

/* ===============================
   API Server for Orchestrator
   
   This server provides a REST API for job execution and session management.
   It supports multiple execution types: JavaScript, Groovy, Batch, PowerShell, and Flow files.
   =============================== */

const express = require('express');
const cors = require('cors');
const { exec } = require('child_process');
const fs = require('fs');
const fsp = require('fs').promises;
const path = require('path');
const kill = require('tree-kill');

/* ===============================
   Configuration & Environment
   =============================== */

const PORT = process.env.PORT || 3000;

// Detect if running in packaged environment (pkg bundles to snapshot)
const isPackaged = (() => {
  // pkg sets process.pkg when running from snapshot
  return !!(process.pkg || __dirname.includes('snapshot'));
})();

// Get the path to system Node.js executable
// When packaged, we must use system node, not the packaged exe
const getNodeExecutablePath = () => {
  if (process.env.NODE_EXECUTABLE_PATH) {
    return process.env.NODE_EXECUTABLE_PATH;
  }
  if (isPackaged) {
    // When packaged, try to find system node
    const os = require('os');
    const { execSync } = require('child_process');
    const platform = os.platform();

    if (platform === 'win32') {
      // Try using 'where' command to find node.exe
      try {
        const result = execSync('where node.exe', { encoding: 'utf8', timeout: 5000 });
        const paths = result.trim().split(/\r?\n/);
        // Filter out any path that points to our packaged exe
        const exePath = process.execPath.toLowerCase();
        for (const p of paths) {
          if (p.toLowerCase() !== exePath && fs.existsSync(p)) {
            return p;
          }
        }
      } catch (e) {
        // 'where' command failed, try known paths
      }

      // Try common Windows Node.js locations
      const possiblePaths = [
        'C:\\Program Files\\nodejs\\node.exe',
        'C:\\Program Files (x86)\\nodejs\\node.exe',
        path.join(os.homedir(), 'AppData', 'Roaming', 'nvm', 'current', 'node.exe'),
        path.join(os.homedir(), '.nvm', 'current', 'node.exe'),
      ];
      for (const p of possiblePaths) {
        if (fs.existsSync(p)) return p;
      }

      console.warn('Warning: Could not find system Node.js. Set NODE_EXECUTABLE_PATH environment variable.');
    } else {
      // Linux/macOS - try 'which' command
      try {
        const result = execSync('which node', { encoding: 'utf8', timeout: 5000 });
        const nodePath = result.trim();
        if (nodePath && fs.existsSync(nodePath)) {
          return nodePath;
        }
      } catch (e) {
        // 'which' command failed
      }
    }

    // Last resort - this may cause issues if PATH has packaged exe first
    return 'node';
  }
  // When not packaged, use current Node.js process
  return process.execPath;
};

const nodeExecutablePath = getNodeExecutablePath();

// Log which Node.js is being used (helpful for debugging)
if (isPackaged) {
  console.log(`[Packaged Mode] Using Node.js: ${nodeExecutablePath}`);
}

// Use temp directory for INBOX/OUTBOX when packaged, otherwise use __dirname
const getWorkDir = () => {
  if (isPackaged) {
    // Use a directory next to the executable or in temp
    const os = require('os');
    const workDir = process.env.ORCHESTRATOR_WORK_DIR || path.join(os.tmpdir(), 'orchestrator-backend');
    return workDir;
  }
  return __dirname;
};

const WORK_DIR = getWorkDir();
const INBOX = path.join(WORK_DIR, 'inbox');
const OUTBOX = path.join(WORK_DIR, 'outbox');

const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS ?? 200);
const STOP_CHECK_INTERVAL_MS = Number(process.env.STOP_CHECK_INTERVAL_MS ?? 500);
const DEFAULT_FLOW_TIMEOUT_MS = Number(process.env.DEFAULT_FLOW_TIMEOUT_MS ?? 0);   // 0 = infinite
const JS_BACKEND_TIMEOUT_MS = Number(process.env.JS_BACKEND_TIMEOUT_MS ?? 0);    // 0 = infinite

// Ensure directories exist
if (!fs.existsSync(WORK_DIR)) fs.mkdirSync(WORK_DIR, { recursive: true });
if (!fs.existsSync(INBOX)) fs.mkdirSync(INBOX, { recursive: true });
if (!fs.existsSync(OUTBOX)) fs.mkdirSync(OUTBOX, { recursive: true });

// Command line arguments
const argv = process.argv;
const isSilent = argv.includes('--silent') || argv.includes('-s');
const shouldShutdownAfterExecution = argv.includes('-s');

/* ===============================
   Console Utilities
   =============================== */

const COLORS = {
  reset: '\x1b[0m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  green: '\x1b[32m',
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
   Global State Management
   =============================== */

global.localStorage = {};

let isMasterFlowRunning = false;
const runningProcesses = new Map(); // jobId -> ChildProcess
const jobs = new Map(); // jobId -> job object
const sessions = new Map(); // sessionId -> session object

/* ===============================
   Path & Resource Utilities
   =============================== */

const getResourcePath = () => {
  if (isPackaged) {
    // In pkg, assets are bundled and accessible via __dirname (snapshot path)
    // But for external files like groovyExec.jar, check next to executable first
    const exeDir = path.dirname(process.execPath);
    if (fs.existsSync(path.join(exeDir, 'groovyExec.jar'))) {
      return exeDir;
    }
    // Fallback to snapshot path (if bundled as asset)
    return __dirname;
  }
  return __dirname;
};

const groovyJarPath = path.join(getResourcePath(), 'groovyExec.jar');

/* ===============================
   Core Utilities
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
  const job = jobs.get(jobId);
  return job && job.stopRequested;
}

function cleanupStopSignal(jobId) {
  // No-op for HTTP-based jobs
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
 * Sanitize a variable name to be a valid identifier
 */
function sanitizeVariableName(name) {
  if (!name) return '_var';
  // Replace invalid characters with underscores
  let sanitized = name.replace(/[^a-zA-Z0-9_$]/g, '_');
  // Ensure it doesn't start with a number
  if (/^[0-9]/.test(sanitized)) {
    sanitized = '_' + sanitized;
  }
  // Avoid reserved words
  const reserved = ['input', 'output', 'console', 'process', 'require', 'module', 'exports'];
  if (reserved.includes(sanitized)) {
    sanitized = 'var_' + sanitized;
  }
  return sanitized || '_var';
}

/**
 * Collect variables from flow's variable nodes
 */
function collectFlowVariables(nodes) {
  const variables = {};
  nodes.forEach(node => {
    if (node?.data?.type === 'variable' && node.data.label) {
      const varName = sanitizeVariableName(node.data.label);
      const rawValue = node.data.value || '';
      try {
        variables[varName] = JSON.parse(rawValue);
      } catch {
        variables[varName] = rawValue;
      }
    }
  });
  return variables;
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

function parseFlowContent(flowContent) {
  let flow;
  try {
    flow = JSON.parse(flowContent);
  } catch (e) {
    throw new Error(`Invalid JSON in flow content: ${e.message}`);
  }

  if (!flow || !Array.isArray(flow.nodes) || !Array.isArray(flow.edges)) {
    throw new Error('Invalid flow content format: missing nodes or edges array');
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
   Flow Execution Engine
   =============================== */

async function executeFlowFile(
  flowFilePath,
  flowInput = null,
  flowPath = [],
  isTopLevel = true,
  _respectStarterNode = true,
  basePath = null,
  timeout = 0,
  jobId = null
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

        // Collect variables from all Variable nodes in the flow
        const flowVariables = collectFlowVariables(flow.nodes);

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

          // Skip predecessor execution if this is the starter node
          if (nodeId !== starterId) {
            const preds = incoming(nodeId).map((e) => e.source);
            for (const p of preds) await ensureExecuted(p, false);
          }

          let processedInputs;
          if (Object.prototype.hasOwnProperty.call(injectedInputs, nodeId)) {
            // forwarded input from a previous goto rule wins
            processedInputs = injectedInputs[nodeId];
            delete injectedInputs[nodeId];
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
          } else if (node?.data?.type === 'variable') {
            // Parse JSON if possible, otherwise use raw value
            const rawValue = node.data.value || '';
            try {
              nodeResults[nodeId] = JSON.parse(rawValue);
            } catch {
              nodeResults[nodeId] = rawValue;
            }
          } else {
            const res = await executeRegularNode(
              node,
              nodeId,
              processedInputs,
              nodeResults,
              true,
              timeout,
              basePath || path.dirname(flowFilePath),
              flowVariables
            );
            // Merge returned variables into flowVariables
            if (res?.variables && Object.keys(res.variables).length > 0) {
              Object.assign(flowVariables, res.variables);
              // Also update nodeResults for variable nodes
              for (const [varName, varValue] of Object.entries(res.variables)) {
                const varNode = flow.nodes.find(n => n.data?.type === 'variable' && sanitizeVariableName(n.data.label) === varName);
                if (varNode) {
                  nodeResults[varNode.id] = varValue;
                }
              }
            }
            nodeResults[nodeId] = res?.output !== undefined ? res.output : res;
          }

          if (node?.data?.type !== 'goto') lastExecutedId = nodeId;

          executed.add(nodeId);
          executedAt[nodeId] = ++tick;
          executing.delete(nodeId);
        };

        const stepTo = async (nextId, budget) => {
          // Check for stop signal at the start of each step
          if (jobId) {
            const flowJob = jobs.get(jobId);
            if (flowJob && flowJob.stopRequested) {
              if (!isSilent) console.log(`Flow execution stopped for job ${jobId}`);
              return;
            }
          }

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
   Inline Flow Execution
   =============================== */

async function executeInlineFlow(tempFlow, flowInput, flowPath, basePath, timeout, jobId) {
  const { flow, nodeMap, incomingMap, outgoingMap, roots } = tempFlow;

  const starter = flow.nodes.find((n) => n?.data?.isStarterNode);
  const starterId = starter ? starter.id : null;

  // Collect variables from all Variable nodes in the flow
  const flowVariables = collectFlowVariables(flow.nodes);

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

    // Skip predecessor execution if this is the starter node
    if (nodeId !== starterId) {
      const preds = incoming(nodeId).map((e) => e.source);
      for (const p of preds) await ensureExecuted(p, false);
    }

    let processedInputs;
    if (Object.prototype.hasOwnProperty.call(injectedInputs, nodeId)) {
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

      if (decision && forward) {
        injectedInputs[decision] = processedInputs;
      }
    } else if (node?.data?.type === 'variable') {
      // Parse JSON if possible, otherwise use raw value
      const rawValue = node.data.value || '';
      try {
        nodeResults[nodeId] = JSON.parse(rawValue);
      } catch {
        nodeResults[nodeId] = rawValue;
      }
    } else {
      const res = await executeRegularNode(
        node,
        nodeId,
        processedInputs,
        nodeResults,
        true,
        timeout,
        basePath,
        flowVariables
      );
      // Merge returned variables into flowVariables
      if (res?.variables && Object.keys(res.variables).length > 0) {
        Object.assign(flowVariables, res.variables);
        // Also update nodeResults for variable nodes
        for (const [varName, varValue] of Object.entries(res.variables)) {
          const varNode = flow.nodes.find(n => n.data?.type === 'variable' && sanitizeVariableName(n.data.label) === varName);
          if (varNode) {
            nodeResults[varNode.id] = varValue;
          }
        }
      }
      nodeResults[nodeId] = res?.output !== undefined ? res.output : res;
    }

    if (node?.data?.type !== 'goto') lastExecutedId = nodeId;

    executed.add(nodeId);
    executedAt[nodeId] = ++tick;
    executing.delete(nodeId);
  };

  const stepTo = async (nextId, budget) => {
    if (jobId) {
      const flowJob = jobs.get(jobId);
      if (flowJob && flowJob.stopRequested) {
        if (!isSilent) console.log(`Flow execution stopped for job ${jobId}`);
        return;
      }
    }

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
  return finalResult;
}

/* ===============================
   Node Executors
   =============================== */

async function executeFlowNode(node, nodeId, nodeInput, flowPath, nodeResults, currentFlowDir, timeout = 0) {
  const startTime = Date.now();
  const { restore: restoreNestedConsole } = createLogCollector();
  
  try {
    let flowData;
    let nestedFlowPath = '';

    // Check if code contains JSON flow content (starts with '{' or '[')
    const code = node.data.code || '';
    const trimmedCode = code.trim();
    
    if (trimmedCode.startsWith('{') || trimmedCode.startsWith('[')) {
      // Code contains inline flow content - parse it directly
      console.log(`Using inline flow content for node ${nodeId}`);
      try {
        flowData = JSON.parse(trimmedCode);
        
        // Validate the parsed flow data
        if (!flowData || !Array.isArray(flowData.nodes) || !Array.isArray(flowData.edges)) {
          throw new Error('Invalid inline flow format: missing nodes or edges array');
        }
        
        // Execute the inline flow directly
        const nodeMap = {};
        flowData.nodes.forEach((n) => (nodeMap[n.id] = n));

        const incomingMap = {};
        const outgoingMap = {};
        flowData.edges.forEach((e) => {
          (incomingMap[e.target] ||= []).push(e);
          (outgoingMap[e.source] ||= []).push(e);
        });

        const roots = flowData.nodes.map((n) => n.id).filter((id) => !(incomingMap[id] && incomingMap[id].length));
        
        // Create a temporary flow structure for execution
        const tempFlow = { flow: flowData, nodeMap, incomingMap, outgoingMap, roots };
        
        // Execute using the same logic as executeFlowFile but with inline data
        const nestedFlowResult = await executeInlineFlow(
          tempFlow,
          nodeInput,
          flowPath,
          currentFlowDir,
          timeout,
          null
        );
        
        const executionTime = Date.now() - startTime;
        const nestedLogs = restoreNestedConsole();

        printSectionTitle(`Node ${node.data.label || nodeId} (${node.data.type})`, 'cyan');

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
        
      } catch (parseError) {
        console.error(`Error parsing inline flow content: ${parseError.message}`);
        throw new Error(`Invalid inline flow content: ${parseError.message}`);
      }
    } else {
      // Code contains a file path - use existing file-based logic
      if (node.data.codeFilePath) {
        nestedFlowPath = node.data.codeFilePath;
        console.log(`Using external flow file path: ${nestedFlowPath}`);
      } else {
        nestedFlowPath = code;
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

      // Parse once to validate and allow future checks
      parseFlowFile(nestedFlowPath);

      const nestedFlowResult = await executeFlowFile(
        nestedFlowPath,
        nodeInput,
        flowPath,
        false,
        true,
        currentFlowDir,
        timeout,
        null
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
    }
  } catch (err) {
    restoreNestedConsole();
    console.error(`Error executing nested flow: ${err.message}`);
    throw err;
  }
}

async function executeRegularNode(node, nodeId, nodeInput, nodeResults, waitForResult = true, timeout = 0, jobBasePath, variables = {}) {
  const nodeJobId = `flow-node-${nowUid()}`;
  const code = node.data.code || '';
  const type = node.data.type;
  const execCwd = jobBasePath || process.cwd();

  printSectionTitle(`Executing node ${node.data.label || nodeId} (${type})`, 'cyan');
  printLabeledLine('Input', JSON.stringify(nodeInput, null, 2), 'gray');

  const startTime = Date.now();

  // Handle non-blocking execution
  if (node.data.dontWaitForOutput && !waitForResult) {
    console.log(colorize('gray', `Started non-blocking execution for node ${node.data.label || nodeId} (${type})`));
    const executionTime = Date.now() - startTime;
    nodeResults[nodeId] = nodeInput;
    return { output: nodeInput, executionTime, nonBlocking: true };
  }

  return new Promise((resolveNode, rejectNode) => {
    let timeoutId;
    let resolved = false;

    const finish = (result) => {
      if (resolved) return;
      resolved = true;
      if (timeoutId) clearTimeout(timeoutId);

      const executionTime = Date.now() - startTime;

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
    };

    // Set up timeout
    if (timeout > 0) {
      timeoutId = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          if (runningProcesses.has(nodeJobId)) {
            terminateProcess(nodeJobId);
          }
          rejectNode(new Error(`Execution timed out after ${timeout / 1000} seconds`));
        }
      }, timeout);
    }

    // Execute based on node type
    if (type === 'flow') {
      // Nested flow execution - parse and execute inline
      const flowContent = code.trim();
      if (!flowContent) {
        finish({ output: null, log: null, error: 'No flow content provided' });
        return;
      }

      let flowData;
      try {
        flowData = JSON.parse(flowContent);
      } catch (e) {
        finish({ output: null, log: null, error: `Invalid flow content: ${e.message}` });
        return;
      }

      if (!flowData || !Array.isArray(flowData.nodes) || !Array.isArray(flowData.edges)) {
        finish({ output: null, log: null, error: 'Invalid flow content - missing nodes or edges' });
        return;
      }

      (async () => {
        try {
          const tempFlow = parseFlowContent(flowContent);
          const flowResult = await executeInlineFlow(
            tempFlow,
            nodeInput,
            [],
            execCwd,
            timeout || DEFAULT_FLOW_TIMEOUT_MS,
            nodeJobId
          );
          finish({ output: flowResult, log: 'Flow executed successfully', error: null });
        } catch (err) {
          finish({ output: null, log: null, error: `Error executing nested flow: ${err.message}` });
        }
      })();
    } else if (type === 'groovy') {
      processGroovyNode(nodeJobId, code, nodeInput, finish, null, execCwd, variables);
    } else if (type === 'batch') {
      processBatchNode(nodeJobId, code, nodeInput, finish, null, execCwd, variables);
    } else if (type === 'jsbackend' || type === 'playwright') {
      processJsBackendNode(nodeJobId, code, nodeInput, finish, null, execCwd, variables);
    } else if (type === 'powershell') {
      processPowershellNode(nodeJobId, code, nodeInput, finish, null, execCwd, variables);
    } else if (type === 'python') {
      processPythonNode(nodeJobId, code, nodeInput, finish, null, execCwd, variables);
    } else if (type === 'javascript' || type === 'js') {
      processJsNode(nodeJobId, code, nodeInput, finish);
    } else {
      finish({ output: null, log: null, error: `Unknown node type: ${type}` });
    }
  });
}

/* ===============================
   Job Management
   =============================== */

function finalizeJob(id, result) {
  try {
    runningProcesses.delete(id);
    const job = jobs.get(id);
    if (job) {
      job.status = result.error ? 'failed' : 'completed';
      job.output = result.output;
      job.error = result.error;
      job.log = result.log;
      job.executionTime = result.executionTime;
      job.endTime = new Date().toISOString();
      // Store modified variables from execution
      if (result.variables && Object.keys(result.variables).length > 0) {
        job.variables = { ...(job.variables || {}), ...result.variables };
      }
      if (result.dontWaitForOutput) {
        job.status = 'completed'; // or running? but since async, completed
      }
    }
  } catch (err) {
    if (!isSilent) console.error(`Error during job finalize for ${id}: ${err.message}`);
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
    // Flow execution - expects JSON content with nodes and edges
    const flowContent = (code || '').trim();

    if (!flowContent) {
      finish({ output: null, log: null, error: 'No flow content provided' });
      return;
    }

    // Parse flow content as JSON
    let flowData;
    try {
      flowData = JSON.parse(flowContent);
    } catch (parseErr) {
      finish({ output: null, log: null, error: `Invalid flow content - not valid JSON: ${parseErr.message}` });
      return;
    }

    if (!flowData || !Array.isArray(flowData.nodes) || !Array.isArray(flowData.edges)) {
      finish({ output: null, log: null, error: 'Invalid flow content - missing nodes or edges array' });
      return;
    }

    console.log('Executing flow content');

    (async () => {
      try {
        const { logs, restore: restoreConsole } = createLogCollector();
        try {
          const tempFlow = parseFlowContent(flowContent);
          const flowResult = await executeInlineFlow(
            tempFlow,
            input,
            [],
            job.basePath || process.cwd(),
            job.timeout || DEFAULT_FLOW_TIMEOUT_MS,
            jobId
          );
          restoreConsole();

          const logMessages = logs
            .map((log) => (log.type === 'error' ? `ERROR: ${log.message}` : log.message))
            .join('\n');

          finish({
            output: flowResult,
            log: logMessages || 'Successfully executed flow',
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
  } else if (type === 'python') {
    processPythonNode(id, code, input, finish, codeFilePath, execCwd);
  } else {
    processJsNode(id, code, input, finish);
  }
}

/* ===============================
   Language-Specific Runners
   =============================== */

function processGroovyNode(id, code, input, finish, _codeFilePath, execCwd, variables = {}) {
  const uid = nowUid();
  const tempGroovyPath = path.join(INBOX, `node_groovy_${uid}.groovy`);
  const tempInputPath = path.join(INBOX, `node_groovy_${uid}.input`);
  const tempOutputPath = path.join(INBOX, `node_groovy_${uid}.output`);
  const tempVariablesPath = path.join(INBOX, `node_groovy_${uid}.variables`);
  const libPath = _codeFilePath ? path.join(path.dirname(_codeFilePath), 'lib') : undefined;

  fs.writeFileSync(tempInputPath, JSON.stringify(input === undefined ? null : input), 'utf8');
  fs.writeFileSync(tempVariablesPath, JSON.stringify(variables), 'utf8');

  const inputPathGroovy = tempInputPath.replace(/\\/g, '/');
  const outputPathGroovy = tempOutputPath.replace(/\\/g, '/');
  const variablesPathGroovy = tempVariablesPath.replace(/\\/g, '/');

  // Generate Groovy variable loading code
  const varNames = Object.keys(variables);
  const variableLoading = varNames.length > 0
    ? `def __variables = new groovy.json.JsonSlurper().parseText(new File('${variablesPathGroovy}').text)\n` +
      varNames.map(name => `def ${name} = __variables['${name}']`).join('\n')
    : '';

  // Generate variable capture code
  const variableCapture = varNames.length > 0
    ? `def __capturedVars = [${varNames.map(name => `'${name}': ${name}`).join(', ')}]\nnew File('${variablesPathGroovy}').text = groovy.json.JsonOutput.toJson(__capturedVars)`
    : '';

  const groovyCode = `
  def smartParse = { s ->
      try { (s?.trim()?.startsWith('{') || s?.trim()?.startsWith('[')) && s?.contains('\"') ? new groovy.json.JsonSlurper().parseText(s) : Eval.me(s) }
      catch(e) { s }
  }
  ${variableLoading}
  input = smartParse(new File('${inputPathGroovy}').text)
  def output = ""
  ${code}
  ${variableCapture}
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
    finish({ output: null, log: `Failed to write Groovy script: ${err.message}`, error: err.message, variables: {} });
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

    // Read modified variables
    let modifiedVariables = {};
    try {
      if (fs.existsSync(tempVariablesPath)) {
        const raw = fs.readFileSync(tempVariablesPath, 'utf8').trim();
        modifiedVariables = JSON.parse(raw);
        safeUnlinkSync(tempVariablesPath);
      }
    } catch {
      modifiedVariables = {};
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
      variables: modifiedVariables,
    });
  });


  registerProcess(id, child);

  const checkStopInterval = setInterval(() => {
    if (shouldStopJob(id)) {
      clearInterval(checkStopInterval);
      terminateProcess(id);
      cleanupStopSignal(id);
      finish({ output: null, log: 'Process terminated by user', error: 'Process terminated by user', variables: {} });
    }
  }, STOP_CHECK_INTERVAL_MS);

  child.on('exit', () => clearInterval(checkStopInterval));
}

function processBatchNode(id, code, input, finish, _codeFilePath, execCwd, variables = {}) {
  const uid = nowUid();
  const tempBatchPath = path.join(INBOX, `node_batch_${uid}.bat`);
  const tempOutputPath = path.join(INBOX, `node_batch_${uid}.output`);
  const inputVar = input !== undefined ? String(input).replace(/\\"/g, '\\\\\\"') : '';

  // For batch, only support simple string/number variables via environment (read-only)
  const variableEnvVars = Object.entries(variables)
    .filter(([_, v]) => typeof v === 'string' || typeof v === 'number')
    .map(([name, val]) => `set ${name}=${String(val).replace(/"/g, '\\"')}`)
    .join('\n');

  const batchCode =
    `@echo off
${variableEnvVars}
set INPUT="${inputVar}"
set OUTPUT="${tempOutputPath}"
${code}
` + `\r\n`;

  try {
    fs.writeFileSync(tempBatchPath, batchCode, 'utf8');
  } catch (err) {
    finish({ output: null, log: `Failed to write batch file: ${err.message}`, error: err.message, variables: {} });
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

    // Batch variables are read-only, return empty
    finish({
      log: errorInStdout === '' ? stdout.trim() : null,
      error: ((stderr || '') + (error ? error.message : '') + errorInStdout).trim() || null,
      output: outputValue,
      variables: {},
    });
  });


  registerProcess(id, child);

  const checkStopInterval = setInterval(() => {
    if (shouldStopJob(id)) {
      clearInterval(checkStopInterval);
      terminateProcess(id);
      cleanupStopSignal(id);
      finish({ output: null, log: 'Process terminated by user', error: 'Process terminated by user', variables: {} });
    }
  }, STOP_CHECK_INTERVAL_MS);

  child.on('exit', () => clearInterval(checkStopInterval));
}

function processJsBackendNode(id, code, input, finish, codeFilePath, execCwd, variables = {}) {
  const uid = nowUid();
  const tempId = `node_jsbackend_${uid}`;
  const tempScriptPath = path.join(INBOX, `${tempId}.mjs`); // use ESM to support import
  const tempOutputPath = path.join(INBOX, `${tempId}.output`);
  const tempVariablesPath = path.join(INBOX, `${tempId}.variables`);

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

  // Generate variable declarations
  const varNames = Object.keys(variables);
  const variableDeclarations = varNames.map(name => `let ${name} = __variables["${name}"];`).join('\n');
  const variableCapture = varNames.length > 0
    ? `const __capturedVariables = { ${varNames.join(', ')} };\nfs.writeFileSync(${JSON.stringify(tempVariablesPath)}, JSON.stringify(__capturedVariables), 'utf8');`
    : '';

  const codeWithInput = `
let output = "";
const input = ${JSON.stringify(input)};
const __variables = ${JSON.stringify(variables)};
import fs from 'fs';

// Inject variables (accessible by their node labels)
${variableDeclarations}

${code}

// Capture modified variables
${variableCapture}

fs.writeFileSync(${JSON.stringify(tempOutputPath)}, JSON.stringify(output), 'utf8');
`;

  fs.writeFileSync(tempScriptPath, codeWithInput, 'utf8');

  const child = exec(
    `"${nodeExecutablePath}" "${tempScriptPath}"`,
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

      // Read modified variables
      let modifiedVariables = {};
      try {
        if (fs.existsSync(tempVariablesPath)) {
          const raw = fs.readFileSync(tempVariablesPath, 'utf8').trim();
          modifiedVariables = JSON.parse(raw);
          safeUnlinkSync(tempVariablesPath);
        }
      } catch {
        modifiedVariables = {};
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
        variables: modifiedVariables,
      });
    }
  );


  registerProcess(id, child);

  const checkStopInterval = setInterval(() => {
    if (shouldStopJob(id)) {
      clearInterval(checkStopInterval);
      terminateProcess(id);
      cleanupStopSignal(id);
      finish({ output: null, log: 'Process terminated by user', error: 'Process terminated by user', variables: {} });
    }
  }, STOP_CHECK_INTERVAL_MS);

  child.on('exit', () => clearInterval(checkStopInterval));
}

function processPowershellNode(id, code, input, finish, _codeFilePath, execCwd, variables = {}) {
  const uid = nowUid();
  const tempPs1Path = path.join(INBOX, `node_ps_${uid}.ps1`);
  const tempOutputPath = path.join(INBOX, `node_ps_${uid}.output`);
  const tempVariablesPath = path.join(INBOX, `node_ps_${uid}.variables.json`);
  const inputVar = input !== undefined ? String(input).replace(/"/g, '""') : '';

  // Write variables to JSON file
  const varNames = Object.keys(variables);
  try {
    fs.writeFileSync(tempVariablesPath, JSON.stringify(variables), 'utf8');
  } catch (err) {
    // Continue without variables if file write fails
  }

  // Generate PowerShell variable loading code
  const variableLoading = varNames.length > 0
    ? `$__variablesJson = Get-Content -Path "${tempVariablesPath.replace(/\\/g, '\\\\')}" -Raw | ConvertFrom-Json\n` +
      varNames.map(name => `$${name} = $__variablesJson.${name}`).join('\n')
    : '';

  // Generate variable capture code
  const variableCapture = varNames.length > 0
    ? `$__capturedVars = @{\n${varNames.map(name => `    '${name}' = $${name}`).join('\n')}\n}\n$__capturedVars | ConvertTo-Json -Depth 10 | Set-Content -Path "${tempVariablesPath.replace(/\\/g, '\\\\')}"`
    : '';

  const psCode = `${variableLoading}
$env:INPUT="${inputVar}"
$env:OUTPUT="${tempOutputPath}"
${code}
${variableCapture}
`;

  try {
    fs.writeFileSync(tempPs1Path, psCode, 'utf8');
  } catch (err) {
    finish({ output: null, log: `Failed to write PowerShell file: ${err.message}`, error: err.message, variables: {} });
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

      // Read modified variables
      let modifiedVariables = {};
      try {
        if (fs.existsSync(tempVariablesPath)) {
          const raw = fs.readFileSync(tempVariablesPath, 'utf8').trim();
          modifiedVariables = JSON.parse(raw);
          safeUnlinkSync(tempVariablesPath);
        }
      } catch {
        modifiedVariables = {};
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
        variables: modifiedVariables,
      });
    }
  );


  registerProcess(id, child);

  const checkStopInterval = setInterval(() => {
    if (shouldStopJob(id)) {
      clearInterval(checkStopInterval);
      terminateProcess(id);
      cleanupStopSignal(id);
      finish({ output: null, log: 'Process terminated by user', error: 'Process terminated by user', variables: {} });
    }
  }, STOP_CHECK_INTERVAL_MS);

  child.on('exit', () => clearInterval(checkStopInterval));
}

function processPythonNode(id, code, input, finish, _codeFilePath, execCwd, variables = {}) {
  const uid = nowUid();
  const tempPythonPath = path.join(INBOX, `node_python_${uid}.py`);
  const tempInputPath = path.join(INBOX, `node_python_${uid}.input`);
  const tempOutputPath = path.join(INBOX, `node_python_${uid}.output`);
  const tempVariablesPath = path.join(INBOX, `node_python_${uid}.variables.json`);

  // Write input and variables to temp files
  fs.writeFileSync(tempInputPath, JSON.stringify(input === undefined ? null : input), 'utf8');
  fs.writeFileSync(tempVariablesPath, JSON.stringify(variables), 'utf8');

  // Path conversion for Python (forward slashes)
  const inputPathPy = tempInputPath.replace(/\\/g, '/');
  const outputPathPy = tempOutputPath.replace(/\\/g, '/');
  const variablesPathPy = tempVariablesPath.replace(/\\/g, '/');

  // Variable injection code
  const varNames = Object.keys(variables);
  const variableLoading = varNames.length > 0
    ? varNames.map(name => `${name} = __variables.get('${name}')`).join('\n')
    : '';
  const variableCapture = varNames.length > 0
    ? `__captured_vars = {${varNames.map(name => `'${name}': ${name}`).join(', ')}}\nwith open('${variablesPathPy}', 'w') as __f:\n    json.dump(__captured_vars, __f)`
    : '';

  // Build Python script
  const pythonCode = `import json

# Load input
with open('${inputPathPy}', 'r') as __f:
    input = json.load(__f)

# Load variables
with open('${variablesPathPy}', 'r') as __f:
    __variables = json.load(__f)
${variableLoading}

output = None

# User code
${code}

# Capture variables
${variableCapture}

# Write output
with open('${outputPathPy}', 'w') as __f:
    json.dump(output, __f)
`;

  try {
    fs.writeFileSync(tempPythonPath, pythonCode, 'utf8');
  } catch (err) {
    finish({ output: null, log: `Failed to write Python script: ${err.message}`, error: err.message, variables: {} });
    return;
  }

  const child = exec(
    `python "${tempPythonPath}"`,
    { cwd: execCwd, timeout: JS_BACKEND_TIMEOUT_MS },
    (error, stdout, stderr) => {
      runningProcesses.delete(id);
      safeUnlinkSync(tempPythonPath);
      safeUnlinkSync(tempInputPath);

      // Read output
      let outputValue = null;
      try {
        if (fs.existsSync(tempOutputPath)) {
          const raw = fs.readFileSync(tempOutputPath, 'utf8').trim();
          try { outputValue = JSON.parse(raw); } catch { outputValue = raw; }
          safeUnlinkSync(tempOutputPath);
        }
      } catch { outputValue = null; }

      // Read modified variables
      let modifiedVariables = {};
      try {
        if (fs.existsSync(tempVariablesPath)) {
          const raw = fs.readFileSync(tempVariablesPath, 'utf8').trim();
          modifiedVariables = JSON.parse(raw);
          safeUnlinkSync(tempVariablesPath);
        }
      } catch { modifiedVariables = {}; }

      if (typeof outputValue === 'string') {
        outputValue = outputValue.trim();
      }
      outputValue = normalizeOutput(outputValue);

      // Check for Python errors in stdout
      let errorInStdout = '';
      if (/Traceback|Error|Exception/i.test(stdout)) {
        errorInStdout = stdout;
      }

      finish({
        log: errorInStdout === '' ? stdout.trim() : null,
        error: ((stderr || '') + (error ? error.message : '') + errorInStdout).trim() || null,
        output: outputValue,
        variables: modifiedVariables,
      });
    }
  );

  registerProcess(id, child);

  // Stop signal checking
  const checkStopInterval = setInterval(() => {
    if (shouldStopJob(id)) {
      clearInterval(checkStopInterval);
      terminateProcess(id);
      cleanupStopSignal(id);
      finish({ output: null, log: 'Process terminated by user', error: 'Process terminated by user', variables: {} });
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
   HTTP API Routes
   =============================== */

const app = express();
app.use(cors());
app.use(express.json());

// Serve static files from parent directory (frontend)
app.use(express.static(path.join(__dirname, '..')));

// Job Management Routes
app.post('/api/v1/jobs', (req, res) => {
  try {
    const { type, code, codeFilePath, input, timeout, dontWaitForOutput, basePath, sessionId, runnerId, variables } = req.body;

    if (!type) {
      return res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'Job type is required' } });
    }

    const jobId = nowUid();
    const job = {
      jobId,
      type,
      code,
      codeFilePath,
      input,
      timeout,
      dontWaitForOutput,
      basePath,
      sessionId,
      runnerId,
      variables: variables || {},
      status: 'queued',
      startTime: new Date().toISOString(),
      stopRequested: false,
    };

    jobs.set(jobId, job);

    // Start processing asynchronously
    setTimeout(() => processJob(job), 0);

    res.status(202).json({
      jobId,
      status: 'queued',
      estimatedStartTime: new Date(Date.now() + 100).toISOString(), // small delay
      queuePosition: 0,
    });
  } catch (err) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: err.message } });
  }
});

app.get('/api/v1/jobs/:jobId', (req, res) => {
  const { jobId } = req.params;
  const job = jobs.get(jobId);
  if (!job) {
    return res.status(404).json({ error: { code: 'JOB_NOT_FOUND', message: 'Job not found' } });
  }

  res.json({
    jobId: job.jobId,
    status: job.status,
    progress: job.progress || null,
    output: job.output,
    error: job.error,
    log: job.log,
    executionTime: job.executionTime,
    startTime: job.startTime,
    endTime: job.endTime,
    variables: job.variables || {},
  });
});

app.post('/api/v1/jobs/:jobId/stop', (req, res) => {
  const { jobId } = req.params;
  const job = jobs.get(jobId);
  if (!job) {
    return res.status(404).json({ error: { code: 'JOB_NOT_FOUND', message: 'Job not found' } });
  }

  if (job.status === 'completed' || job.status === 'failed' || job.status === 'stopped') {
    return res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'Job is not running' } });
  }

  job.stopRequested = true;
  job.status = 'stopped';
  job.endTime = new Date().toISOString();

  // Terminate if running
  if (runningProcesses.has(jobId)) {
    terminateProcess(jobId);
  }

  res.json({
    jobId,
    status: 'stopped',
    message: 'Job stopped successfully',
  });
});

app.get('/api/v1/jobs', (req, res) => {
  const { status, limit = 50, offset = 0 } = req.query;
  let jobList = Array.from(jobs.values());

  if (status) {
    jobList = jobList.filter(job => job.status === status);
  }

  jobList = jobList.slice(offset, offset + limit);

  res.json({
    jobs: jobList.map(job => ({
      jobId: job.jobId,
      type: job.type,
      status: job.status,
      startTime: job.startTime,
      executionTime: job.executionTime,
    })),
    total: jobs.size,
    hasMore: offset + jobList.length < jobs.size,
  });
});

// Session Management Routes
app.post('/api/v1/sessions', (req, res) => {
  try {
    const { metadata } = req.body;
    const sessionId = nowUid();
    const token = nowUid(); // Simple token generation
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(); // 24 hours

    const session = {
      sessionId,
      token,
      expiresAt,
      metadata: metadata || {},
      createdAt: new Date().toISOString(),
      activeJobs: 0,
      totalJobs: 0,
    };

    sessions.set(sessionId, session);

    res.status(201).json({
      sessionId,
      token,
      expiresAt,
      metadata: session.metadata,
    });
  } catch (err) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: err.message } });
  }
});

app.get('/api/v1/sessions/:sessionId', (req, res) => {
  const { sessionId } = req.params;
  const session = sessions.get(sessionId);
  if (!session) {
    return res.status(404).json({ error: { code: 'SESSION_NOT_FOUND', message: 'Session not found' } });
  }

  // Count active jobs for this session
  const sessionJobs = Array.from(jobs.values()).filter(job => job.sessionId === sessionId);
  const activeJobs = sessionJobs.filter(job => ['queued', 'running'].includes(job.status)).length;
  const totalJobs = sessionJobs.length;

  res.json({
    sessionId: session.sessionId,
    createdAt: session.createdAt,
    expiresAt: session.expiresAt,
    metadata: session.metadata,
    activeJobs,
    totalJobs,
  });
});

app.post('/api/v1/sessions/:sessionId/extend', (req, res) => {
  const { sessionId } = req.params;
  const session = sessions.get(sessionId);
  if (!session) {
    return res.status(404).json({ error: { code: 'SESSION_NOT_FOUND', message: 'Session not found' } });
  }

  session.expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(); // Extend by 24 hours

  res.json({
    sessionId,
    expiresAt: session.expiresAt,
    message: 'Session extended successfully',
  });
});

app.delete('/api/v1/sessions/:sessionId', (req, res) => {
  const { sessionId } = req.params;
  const session = sessions.get(sessionId);
  if (!session) {
    return res.status(404).json({ error: { code: 'SESSION_NOT_FOUND', message: 'Session not found' } });
  }

  // Stop all jobs for this session
  const sessionJobs = Array.from(jobs.values()).filter(job => job.sessionId === sessionId);
  for (const job of sessionJobs) {
    if (['queued', 'running'].includes(job.status)) {
      job.stopRequested = true;
      job.status = 'stopped';
      job.endTime = new Date().toISOString();
      if (runningProcesses.has(job.jobId)) {
        terminateProcess(job.jobId);
      }
    }
  }

  sessions.delete(sessionId);

  res.json({
    sessionId,
    message: 'Session terminated successfully',
    stoppedJobs: sessionJobs.filter(job => job.status === 'stopped').length,
  });
});

/* ===============================
   Job Processing (HTTP-based)
   =============================== */

function processJob(job) {
  const { jobId, code, codeFilePath, type, input, dontWaitForOutput, timeout } = job;

  // Normalize/trim input early
  job.input = normalizeInput(input);

  // Determine working directory
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

  const finish = (result) => finalizeJob(jobId, result);

  if (codeFilePath) {
    try {
      let resolvedCodePath = codeFilePath;
      if (!path.isAbsolute(codeFilePath)) {
        const basePath = job.basePath;
        resolvedCodePath = path.resolve(basePath || process.cwd(), codeFilePath);
        codeFilePath = resolvedCodePath;
      }
      if (fs.existsSync(resolvedCodePath)) {
        job.code = fs.readFileSync(resolvedCodePath, 'utf8');
      } else {
        console.warn(`Code file not found: ${resolvedCodePath}, falling back to embedded code`);
      }
    } catch (err) {
      console.error(`Error loading code from file ${codeFilePath}: ${err.message}`);
    }
  }

  job.status = 'running';

  // Set up timeout handling for individual node execution
  let timeoutId = null;
  let timedOut = false;
  const effectiveTimeout = timeout && timeout !== Infinity && timeout > 0 ? timeout : 0;

  if (effectiveTimeout > 0) {
    timeoutId = setTimeout(() => {
      timedOut = true;
      if (runningProcesses.has(jobId)) {
        terminateProcess(jobId);
      }
      finish({
        output: null,
        log: null,
        error: `Execution timed out after ${effectiveTimeout / 1000} seconds`
      });
    }, effectiveTimeout);
  }

  // Wrap finish to clear timeout and prevent double-finishing
  const wrappedFinish = (result) => {
    if (timedOut) return; // Already timed out, ignore this result
    if (timeoutId) clearTimeout(timeoutId);
    finish(result);
  };

  if (type === 'flow') {
    // Flow execution - expects JSON content with nodes and edges
    const flowContent = (job.code || '').trim();

    if (!flowContent) {
      wrappedFinish({ output: null, log: null, error: 'No flow content provided' });
      return;
    }

    // Parse flow content as JSON
    let flowData;
    try {
      flowData = JSON.parse(flowContent);
    } catch (parseErr) {
      wrappedFinish({ output: null, log: null, error: `Invalid flow content - not valid JSON: ${parseErr.message}` });
      return;
    }

    if (!flowData || !Array.isArray(flowData.nodes) || !Array.isArray(flowData.edges)) {
      wrappedFinish({ output: null, log: null, error: 'Invalid flow content - missing nodes or edges array' });
      return;
    }

    console.log('Executing flow content');

    (async () => {
      try {
        const { logs, restore: restoreConsole } = createLogCollector();
        try {
          const tempFlow = parseFlowContent(flowContent);
          const flowResult = await executeInlineFlow(
            tempFlow,
            job.input,
            [],
            job.basePath || process.cwd(),
            effectiveTimeout || DEFAULT_FLOW_TIMEOUT_MS,
            job.jobId
          );
          restoreConsole();

          const logMessages = logs
            .map((log) => (log.type === 'error' ? `ERROR: ${log.message}` : log.message))
            .join('\n');

          wrappedFinish({
            output: flowResult,
            log: logMessages || 'Successfully executed flow',
            error: null,
          });
        } catch (err) {
          restoreConsole();
          throw err;
        }
      } catch (err) {
        wrappedFinish({ output: null, log: null, error: `Error executing flow: ${err.message}` });
      }
    })();
  } else if (type === 'groovy') {
    processGroovyNode(jobId, code, input, wrappedFinish, codeFilePath, execCwd, job.variables || {});
  } else if (type === 'batch') {
    processBatchNode(jobId, code, input, wrappedFinish, codeFilePath, execCwd, job.variables || {});
  } else if (type === 'jsbackend' || type === 'playwright') {
    processJsBackendNode(jobId, code, input, wrappedFinish, codeFilePath, execCwd, job.variables || {});
  } else if (type === 'powershell') {
    processPowershellNode(jobId, code, input, wrappedFinish, codeFilePath, execCwd, job.variables || {});
  } else if (type === 'python') {
    processPythonNode(jobId, code, input, wrappedFinish, codeFilePath, execCwd, job.variables || {});
  } else {
    processJsNode(jobId, code, input, wrappedFinish);
  }
}

/* ===============================
   Server Startup & Shutdown
   =============================== */

const server = app.listen(PORT, () => {
  if (!isSilent) console.log(colorize('green', `\n🚀 Orchestrator API Server started on port ${PORT}`));
  if (!isSilent) console.log(colorize('cyan', `   API endpoint: http://localhost:${PORT}/api/v1`));
  if (!isSilent) console.log(colorize('gray', `   Environment: ${process.env.NODE_ENV || 'development'}\n`));
});

const shutdown = (signal) => {
  if (!isSilent) console.log(`\nReceived ${signal}. Shutting down gracefully...`);
  server.close(() => {
    // best-effort terminate child processes
    for (const [jobId] of runningProcesses) {
      try {
        terminateProcess(jobId);
      } catch { }
    }
    if (!isSilent) console.log('Server shut down successfully.');
    process.exit(0);
  });
};

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

/* ===============================
   Module Exports
   =============================== */

module.exports = {
  executeInlineFlow,
  parseFlowContent,
};