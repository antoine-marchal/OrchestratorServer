#!/usr/bin/env node
/**
 * airflow.cjs — fixed
 * Generate an Airflow 3.1.0 DAG (Python) from a .or flow, expanding nested flows.
 * Usage:
 *   node airflow.cjs --flow path/to/flow.or --out path/to/dag.py --dag-id my_dag
 */

const fs = require('fs');
const path = require('path');

function fail(msg, code = 1) { console.error(msg); process.exit(code); }

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--flow') args.flow = argv[++i];
    else if (a === '--out') args.out = argv[++i];
    else if (a === '--dag-id') args.dagId = argv[++i];
    else if (a === '--start-date') args.startDate = argv[++i];
    else if (a === '--schedule') args.schedule = argv[++i];
    else if (a === '--owner') args.owner = argv[++i];
    else if (a === '--description') args.description = argv[++i];
    else if (a === '--tags') args.tags = argv[++i];
    else if (a === '--default-pool') args.defaultPool = argv[++i];
  }
  if (!args.flow) fail('Missing --flow');
  if (!args.out) fail('Missing --out');
  if (!args.dagId) {
    const base = path.basename(args.flow).replace(/\.[^.]+$/, '');
    args.dagId = slugify(`dag_${base}`);
  }
  return args;
}

function slugify(s) {
  return String(s)
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')   // remove non word/space/hyphen
    .replace(/\s+/g, '_')       // spaces -> _
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase();
}

/** Python-safe identifier (no dashes, no spaces, ascii, no leading digit) */
function pyIdent(s, prefix='id') {
  let t = String(s).normalize('NFKD').replace(/[^\w\s-]/g, '').replace(/[\s-]+/g, '_');
  if (!t) t = prefix;
  if (/^\d/.test(t)) t = `${prefix}_${t}`;
  return t.toLowerCase();
}

function readJson(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); }
  catch (e) { fail(`Failed to read/parse JSON: ${p}\n${e.stack || e}`); }
}

function ensureUniqueTaskId(base, exists) {
  let id = slugify(base);
  if (!exists.has(id)) { exists.add(id); return id; }
  let i = 2;
  while (exists.has(`${id}_${i}`)) i++;
  const finalId = `${id}_${i}`; exists.add(finalId); return finalId;
}

/** Flatten flow and inline nested flows */
function flattenFlow(entryPath, flowJson, seen = new Set(), prefix = '') {
  const baseDir = path.dirname(entryPath);
  const nodes = [];
  const edges = [];

  const idMap = new Map(); // original id -> fullId

  const addNode = (n, labelPrefix) => {
    const label = (n?.data?.label ?? 'node').toString();
    const labelPath = labelPrefix ? `${labelPrefix}__${label}` : label;
    const fullId = `${prefix}${n.id}`;
    nodes.push({ ...n, fullId, labelPath });
    idMap.set(n.id, fullId);
  };
  const addEdge = (e) => edges.push({ ...e, source: idMap.get(e.source), target: idMap.get(e.target) });

  for (const n of (flowJson.nodes || [])) addNode(n, prefix ? prefix.replace(/__$/, '') : '');
  for (const e of (flowJson.edges || [])) addEdge(e);

  const flowNodes = nodes.filter(n => n?.data?.type === 'flow');
  for (const fn of flowNodes) {
    let subPath = fn?.data?.code;
    if (!subPath) continue;
    if (fn?.data?.isRelativePath !== false) subPath = path.resolve(baseDir, subPath);
    if (!fs.existsSync(subPath)) fail(`Nested flow not found: ${subPath}`);
    const key = path.resolve(subPath);
    if (seen.has(key)) fail(`Cycle detected with nested flow: ${key}`);
    seen.add(key);

    const subJson = readJson(subPath);
    const sub = flattenFlow(subPath, subJson, seen, fn.labelPath + '__');

    // compute upstream/downstream of fn
    const up = edges.filter(e => e.target === fn.fullId).map(e => e.source);
    const down = edges.filter(e => e.source === fn.fullId).map(e => e.target);

    // remove fn and edges touching it
    const keepNodes = nodes.filter(n => n.fullId !== fn.fullId);
    const keepEdges = edges.filter(e => e.source !== fn.fullId && e.target !== fn.fullId);
    nodes.length = 0; nodes.push(...keepNodes);
    edges.length = 0; edges.push(...keepEdges);

    // merge subflow, remap ids to avoid collisions
    const subRemap = new Map();
    for (const sn of sub.nodes) {
      const newFullId = `${sn.fullId}#${path.basename(subPath)}`;
      subRemap.set(sn.fullId, newFullId);
      nodes.push({ ...sn, fullId: newFullId });
    }
    for (const se of sub.edges) {
      edges.push({ ...se, source: subRemap.get(se.source), target: subRemap.get(se.target) });
    }

    // starters/leaves of subflow (within current edges set)
    const subNodeSet = new Set([...subRemap.values()]);
    const hasIncoming = new Set(edges.filter(e => subNodeSet.has(e.target)).map(e => e.target));
    const hasOutgoing = new Set(edges.filter(e => subNodeSet.has(e.source)).map(e => e.source));
    const starters = [...subNodeSet].filter(id => ![...edges].some(e => e.target === id && subNodeSet.has(e.source)));
    const leaves = [...subNodeSet].filter(id => ![...edges].some(e => e.source === id && subNodeSet.has(e.target)));

    if (starters.length === 0) {
      // degenerate: connect upstream directly to downstream
      for (const u of up) for (const d of down) edges.push({ source: u, target: d });
    } else {
      for (const u of up) for (const s of starters) edges.push({ source: u, target: s });
      for (const l of leaves) for (const d of down) edges.push({ source: l, target: d });
    }
    seen.delete(key);
  }

  return { nodes, edges };
}

function buildGraph(nodes, edges) {
  const byId = new Map(nodes.map(n => [n.fullId, n]));
  const inAdj = new Map([...byId.keys()].map(k => [k, []]));
  const outAdj = new Map([...byId.keys()].map(k => [k, []]));
  for (const e of edges) {
    if (!byId.has(e.source) || !byId.has(e.target)) continue;
    outAdj.get(e.source).push(e.target);
    inAdj.get(e.target).push(e.source);
  }
  return { byId, inAdj, outAdj };
}

function pythonTripleQuoted(s) {
  return String(s).replace(/"""/g, '\\"""');
}

function generateDagPython({
  dagId,
  description = '',
  schedule = 'None',
  startDate = null,
  owner = 'airflow',
  tags = [],
  defaultPool = null,
  nodes,
  edges
}) {
  const { byId, inAdj } = buildGraph(nodes, edges);

  // task_id (Airflow) uniqueness from label; Python identifiers safe
  const existingTaskIds = new Set();
  const taskIdOf = new Map();        // fullId -> task_id
  const pyCallableOf = new Map();    // fullId -> python function name
  const pyVarOf = new Map();         // fullId -> python variable name (t_*)

  for (const n of nodes) {
    const baseLabel = n?.data?.label ? n.data.label : (n?.data?.type || 'node');
    const taskId = ensureUniqueTaskId(baseLabel, existingTaskIds);
    taskIdOf.set(n.fullId, taskId);
    pyCallableOf.set(n.fullId, `task_${pyIdent(taskId)}`);
    pyVarOf.set(n.fullId, `t_${pyIdent(taskId)}`);
  }

  const pyStartDate = startDate ? `datetime.strptime("${startDate}", "%Y-%m-%d")` : `datetime(2024, 1, 1)`;
  const pyTags = `[${tags.map(t => `"${t}"`).join(', ')}]`;
  const pySchedule = schedule && schedule !== 'None' ? `"${schedule}"` : 'None';
  const poolLine = defaultPool ? `, pool="${defaultPool}"` : '';

  const header = `# Generated by airflow.cjs — do not edit by hand
from __future__ import annotations
import json, os, sys, tempfile, subprocess, shlex, pathlib, textwrap
from datetime import datetime, timedelta
from airflow import DAG
from airflow.operators.python import PythonOperator

def _write(p, content, mode='w', enc='utf-8'):
    with open(p, mode, encoding=enc) as f:
        f.write(content)

def _read(p, enc='utf-8'):
    with open(p, 'r', encoding=enc) as f:
        return f.read()

def _maybe_json(s):
    try:
        return json.loads(s)
    except Exception:
        return s

def _json_or_str(obj):
    try:
        return json.dumps(obj)
    except Exception:
        return str(obj)

def _xcom_input(ti, upstream_task_ids):
    if not upstream_task_ids:
        return None
    if len(upstream_task_ids) == 1:
        return ti.xcom_pull(task_ids=upstream_task_ids[0])
    result = {}
    for tid in upstream_task_ids:
        result[tid] = ti.xcom_pull(task_ids=tid)
    return result

# ---- Wrappers faithful to poller.cjs semantics ----

def _run_js_with_inline_input(code:str, input_obj):
    \"\"\"processJsNode: inline const input = <json>; write output to temp file via fs.\"\"\"
    with tempfile.TemporaryDirectory() as td:
        out_path = os.path.join(td, "out.json")
        script_path = os.path.join(td, "script.js")
        input_json = json.dumps(input_obj)
        script = f\"\"\"\nconst input = {input_json};\nconst fs = require('fs');\n{code}\nfs.writeFileSync(\"{out_path}\", JSON.stringify(typeof output==='undefined'?null:output), 'utf8');\n\"\"\".strip()
        _write(script_path, script)
        proc = subprocess.run(["node", script_path], capture_output=True, text=True)
        stdout, stderr = proc.stdout, proc.stderr
        output = None
        if os.path.exists(out_path):
            try:
                output = _maybe_json(_read(out_path))
            except Exception:
                output = _read(out_path)
        if proc.returncode != 0 or (stderr and 'error' in stderr.lower()):
            return {"log": stdout or None, "error": (stderr or '') or f"exit {proc.returncode}", "output": output}
        if stdout and any(k in stdout.lower() for k in ["error","exception","failed","not found"]):
            return {"log": None, "error": stdout, "output": output}
        return output

def _run_js_backend_with_inline_input(code:str, input_obj):
    \"\"\"processJsBackendNode: same runner; backend-style imports allowed inside code.\"\"\"\n    return _run_js_with_inline_input(code, input_obj)

def _run_batch_with_env(code:str, input_obj):
    \"\"\"processBatchNode: set INPUT/OUTPUT env, write .bat, run via cmd.exe /c.\"\"\"\n    with tempfile.TemporaryDirectory() as td:
        out_path = os.path.join(td, "out.txt")
        bat_path = os.path.join(td, "script.bat")
        input_str = "" if input_obj is None else str(input_obj).replace('"','\\\\\"')
        batch = f\"\"\"@echo off\nset INPUT=\"{input_str}\"\nset OUTPUT=\"{out_path}\"\n{code}\n\"\"\"\n        _write(bat_path, batch, enc='utf-8')
        proc = subprocess.run(["cmd.exe", "/c", bat_path], capture_output=True, text=True)
        stdout, stderr = proc.stdout, proc.stderr
        output = None
        if os.path.exists(out_path):
            try:
                output = _read(out_path)
                try: output = json.loads(output)
                except: pass
            except Exception:
                output = None
        if proc.returncode != 0 or (stderr and 'error' in stderr.lower()):
            return {"log": stdout or None, "error": (stderr or '') or f"exit {proc.returncode}", "output": (output or stdout)}
        if stdout and any(k in stdout.lower() for k in ["error","exception","failed","not recognized","not found"]):
            return {"log": None, "error": stdout, "output": (output or None)}
        return output if output is not None else stdout

def _run_powershell_with_env(code:str, input_obj):
    \"\"\"processPowershellNode: $env:INPUT, $env:OUTPUT, run powershell -ExecutionPolicy Bypass -File ...\"\"\"\n    with tempfile.TemporaryDirectory() as td:
        out_path = os.path.join(td, "out.txt")
        ps1_path = os.path.join(td, "script.ps1")
        input_str = "" if input_obj is None else str(input_obj).replace('"','\"\"')
        ps = f\"\"\"$env:INPUT=\"{input_str}\"\n$env:OUTPUT=\"{out_path}\"\n{code}\n\"\"\"\n        _write(ps1_path, ps, enc='utf-8')
        proc = subprocess.run(["powershell", "-ExecutionPolicy", "Bypass", "-File", ps1_path], capture_output=True, text=True)
        stdout, stderr = proc.stdout, proc.stderr
        output = None
        if os.path.exists(out_path):
            try:
                output = _read(out_path)
                try: output = json.loads(output)
                except: pass
            except Exception:
                output = None
        if proc.returncode != 0 or (stderr and 'error' in stderr.lower()):
            return {"log": stdout or None, "error": (stderr or '') or f"exit {proc.returncode}", "output": (output or stdout)}
        if stdout and any(k in stdout.lower() for k in ["error","exception","failed","not recognized","not found"]):
            return {"log": None, "error": stdout, "output": (output or None)}
        return output if output is not None else stdout

def _run_groovy_with_io_file(code:str, input_obj):
    \"\"\"processGroovyNode: write input.json, groovy reads it, write output.json\"\"\"\n    with tempfile.TemporaryDirectory() as td:
        in_path = os.path.join(td, "in.json").replace(\"\\\\\",\"/\")
        out_path = os.path.join(td, "out.json").replace(\"\\\\\",\"/\")
        groovy_path = os.path.join(td, "script.groovy")
        _write(in_path, json.dumps(input_obj))
        groovy_code = f\"\"\"\nimport groovy.json.JsonSlurper\nimport groovy.json.JsonOutput\n\ndef smartParse = {{ s ->\n  try {{ return new JsonSlurper().parseText(s) }} catch(e) {{ return s }}\n}}\n\ndef input = smartParse(new File('{in_path}').text)\ndef output = null\n{code}\n\ndef asJson = {{ obj ->\n  try {{ JsonOutput.toJson(obj) }} catch(e) {{ return JsonOutput.toJson([value: obj?.toString(), error: e.toString()]) }}\n}}\nnew File('{out_path}').text = asJson(output)\n\"\"\"\n        _write(groovy_path, groovy_code)\n        proc = subprocess.run([\"groovy\", groovy_path], capture_output=True, text=True)
        stdout, stderr = proc.stdout, proc.stderr
        output = None
        if os.path.exists(out_path):
            try: output = _maybe_json(_read(out_path))
            except: output = _read(out_path)
        if proc.returncode != 0 or (stderr and 'error' in stderr.lower()):
            return {"log": stdout or None, "error": (stderr or '') or f"exit {proc.returncode}", "output": output}
        if stdout and any(k in stdout.lower() for k in ["error","exception","failed","not found"]):
            return {"log": None, "error": stdout, "output": output}
        return output

default_args = {
    "owner": "${owner}",
    "depends_on_past": False,
    "retries": 0,
}

dag = DAG(
    dag_id="${dagId}",
    description=${JSON.stringify(description)},
    start_date=${pyStartDate},
    schedule=${pySchedule},
    catchup=False,
    tags=${pyTags},
)
`;

  const body = [];

  // Node callables
  for (const n of nodes) {
    const tId = taskIdOf.get(n.fullId);
    const funcName = pyCallableOf.get(n.fullId);
    const type = (n?.data?.type || '').toLowerCase();
    const lang = (n?.data?.language || '').toLowerCase();
    const label = n?.data?.label || tId;
    const code = pythonTripleQuoted(n?.data?.code || '');

    let runner = null;
    if (type === 'javascript' || lang === 'javascript' || lang === 'js')
      runner = (type === 'jsbackend' || label.toLowerCase().includes('backend')) ? '_run_js_backend_with_inline_input' : '_run_js_with_inline_input';
    else if (type === 'batch' || lang === 'batch') runner = '_run_batch_with_env';
    else if (type === 'powershell' || lang === 'powershell' || lang === 'ps') runner = '_run_powershell_with_env';
    else if (type === 'groovy' || lang === 'groovy') runner = '_run_groovy_with_io_file';
    else if (type === 'flow') continue; // flattened away
    else runner = '_run_js_with_inline_input';

    const upstreams = (inAdj.get(n.fullId) || []).map(uid => taskIdOf.get(uid)).filter(Boolean);
    body.push(`
def ${funcName}(ti, **context):
    """
    NODE: ${label}
    TYPE: ${type || lang || 'javascript'}
    Embedded node code (exact):
    """
    node_code = """${code}"""
    input_obj = _xcom_input(ti, ${JSON.stringify(upstreams)})
    return ${runner}(node_code, input_obj)
`);
  }

  // Task declarations
  for (const n of nodes) {
    if ((n?.data?.type || '').toLowerCase() === 'flow') continue;
    const tId = taskIdOf.get(n.fullId);
    const varName = pyVarOf.get(n.fullId);
    const funcName = pyCallableOf.get(n.fullId);
    body.push(`${varName} = PythonOperator(
    task_id="${tId}",
    python_callable=${funcName},
    dag=dag${poolLine}
)`);
  }

  // Dependencies
  for (const e of edges) {
    const s = pyVarOf.get(e.source);
    const t = pyVarOf.get(e.target);
    if (s && t && s !== t) body.push(`${s} >> ${t}`);
  }

  return `${header}
# ---------- Node callables ----------
${body.join('\n\n')}
`.trim() + '\n';
}

/** MAIN */
(function main() {
  const args = parseArgs(process.argv);
  const flowPath = path.resolve(args.flow);
  if (!fs.existsSync(flowPath)) fail(`Flow file not found: ${flowPath}`);
  const root = readJson(flowPath);

  const flat = flattenFlow(flowPath, root);
  const dagText = generateDagPython({
    dagId: args.dagId,
    description: args.description || `DAG generated from ${path.basename(flowPath)}`,
    schedule: args.schedule || 'None',
    startDate: args.startDate || null,
    owner: args.owner || 'airflow',
    tags: (args.tags ? args.tags.split(',').map(s => s.trim()).filter(Boolean) : []),
    defaultPool: args.defaultPool || null,
    nodes: flat.nodes,
    edges: flat.edges
  });

  const outPath = path.resolve(args.out);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, dagText, 'utf8');
  console.log(`✅ Wrote DAG to ${outPath}\n- dag_id: ${args.dagId}`);
})();
