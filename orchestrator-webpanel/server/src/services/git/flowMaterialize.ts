import {
  buildBlob,
  buildTree,
  parseTree,
  type BuiltObject,
  type TreeEntry,
} from './gitObjects';
import { getObject, type StoredObject } from './gitStore';

// Bridges a flow document and a git working tree. Layout (recursive):
//   nodes/<camelTitle>.<ext>   one file per leaf node, contents = node.data.code
//   sessions/<camelTitle>/     one folder per flow node (type 'flow'), holding its
//                              sub-graph expanded the same way (nodes/, sessions/,
//                              relations.json) — recursively
//   relations.json             graph structure (nodes minus externalized code + edges
//                              + meta + file/session path maps)
//   artifacts/<name>           one file per flow artifact (top level only)
//
// File/session names derive from the node title (data.label) in camelCase; the
// relations.json `files`/`sessions` maps key node id -> exact path, so the
// round-trip is lossless regardless of naming or collisions.

const LANG_TO_EXT: Record<string, string> = {
  powershell: 'ps1',
  groovy: 'groovy',
  python: 'py',
  javascript: 'js',
  jsbackend: 'js',
  typescript: 'ts',
  batch: 'bat',
  bash: 'sh',
  shell: 'sh',
  sh: 'sh',
  sql: 'sql',
  json: 'json',
  yaml: 'yaml',
  html: 'html',
  css: 'css',
};

function extForLanguage(lang: unknown, fallbackType?: unknown): string {
  const key = (typeof lang === 'string' && lang) || (typeof fallbackType === 'string' && fallbackType) || '';
  return LANG_TO_EXT[key.toLowerCase()] || 'txt';
}

function sanitize(name: string): string {
  return name.replace(/[^A-Za-z0-9._-]/g, '_');
}

// "My PowerShell Node" -> "myPowerShellNode"
function camelCase(s: string): string {
  const parts = String(s || '').split(/[^A-Za-z0-9]+/).filter(Boolean);
  if (!parts.length) return '';
  return parts
    .map((w, i) => (i === 0 ? w.charAt(0).toLowerCase() + w.slice(1) : w.charAt(0).toUpperCase() + w.slice(1)))
    .join('');
}

function baseName(node: any): string {
  return camelCase(node?.data?.label || '') || sanitize(String(node?.id ?? 'node'));
}

function uniqueName(candidate: string, used: Set<string>): string {
  let name = candidate;
  let n = 1;
  while (used.has(name)) name = `${candidate}_${n++}`;
  used.add(name);
  return name;
}

// A flow node embeds its sub-flow as a JSON string in data.code.
function parseGraph(code: unknown): { nodes: any[]; edges: any[] } | null {
  if (typeof code !== 'string' || !code.trim()) return null;
  try {
    const o = JSON.parse(code);
    if (Array.isArray(o?.nodes) && Array.isArray(o?.edges)) return { nodes: o.nodes, edges: o.edges };
  } catch { /* not a graph */ }
  return null;
}

// Artifact reference, either a content-addressed ref ({name,sha}) or a legacy
// inline body ({name,data}). The materializer prefers `sha`.
export interface ArtifactEntry { name: string; sha?: string; data?: string }

export interface FlowLike {
  name?: string;
  namespace?: string;
  description?: string;
  nodes?: any[];
  edges?: any[];
  artifacts?: ArtifactEntry[];
}

export interface FlowFields {
  name: string;
  namespace: string;
  description: string;
  nodes: any[];
  edges: any[];
  artifacts: ArtifactEntry[];
}

// Artifact bodies are stored as real git blobs (raw bytes) so a `git clone`
// gets the actual files, and a push that adds files under artifacts/ round-trips
// back into the flow. The bytes are ALSO content-addressed in artifact_blobs for
// the frontend/worker paths (accepted duplication). Older commits stored an
// LFS-style pointer blob instead — still read here for back-compat.
const ARTIFACT_POINTER_TAG = 'orchestrator.artifact/v1';
function parseArtifactPointer(text: string): string | null {
  if (!text.startsWith(ARTIFACT_POINTER_TAG)) return null;
  const m = text.match(/sha256:([a-f0-9]+)/);
  return m ? m[1] : null;
}

export interface TreeBuildResult {
  rootSha: string;
  objects: BuiltObject[]; // every blob + subtree + root tree, deduped by sha
}

interface RelationsFile {
  flow: { name: string; namespace: string; description: string };
  nodes: any[]; // node objects, code stripped for externalized ones
  edges: any[];
  files: Record<string, string>; // nodeId -> "nodes/<file>" for leaf code nodes
  sessions: Record<string, string>; // nodeId -> "sessions/<name>" for flow nodes
}

const RELATIONS = 'relations.json';

// Top-level tree names the materializer owns and regenerates from the flow doc
// on every save. Anything else a user adds to the cloned repo (a .gitignore,
// README, docs/ folder, …) is NOT managed here and must be carried across saves
// instead of being clobbered — see readPreservedRootEntries / flowToTree.
export const MANAGED_ROOT_NAMES = new Set<string>(['nodes', 'sessions', 'artifacts', RELATIONS]);

// Read the non-managed top-level entries from an existing tree so a regenerated
// save can re-attach them. Entries reference already-persisted objects, so no
// new objects need building.
export async function readPreservedRootEntries(flowId: string, treeSha: string | null): Promise<TreeEntry[]> {
  if (!treeSha) return [];
  const root = await getObject(flowId, treeSha);
  if (!root || root.objectType !== 'tree') return [];
  return parseTree(root.data).filter((e) => !MANAGED_ROOT_NAMES.has(e.name));
}

// A user-pushed (non-managed) entry in the flow's committed git tree, surfaced
// read-only in the editor file tree. `path` is the full slash path from the tree
// root; dirs carry their (recursively listed) children, files carry a byte size.
export interface ExtraEntry {
  name: string;
  path: string;
  type: 'file' | 'dir';
  size?: number;
  children?: ExtraEntry[];
}

async function buildExtraEntry(flowId: string, entry: TreeEntry, path: string): Promise<ExtraEntry> {
  if (entry.mode === '40000') {
    const tree = await getObject(flowId, entry.sha);
    const children: ExtraEntry[] = [];
    if (tree && tree.objectType === 'tree') {
      for (const child of parseTree(tree.data)) {
        children.push(await buildExtraEntry(flowId, child, `${path}/${child.name}`));
      }
    }
    children.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'dir' ? -1 : 1));
    return { name: entry.name, path, type: 'dir', children };
  }
  const blob = await getObject(flowId, entry.sha);
  return { name: entry.name, path, type: 'file', size: blob?.data.length ?? 0 };
}

// List the non-managed top-level entries of a tree (recursively), i.e. the files
// and folders a user pushed that the materializer doesn't own (a .gitignore,
// README, docs/, …). Returns [] when the tree is empty/missing.
export async function listExtraEntries(flowId: string, treeSha: string | null): Promise<ExtraEntry[]> {
  if (!treeSha) return [];
  const root = await getObject(flowId, treeSha);
  if (!root || root.objectType !== 'tree') return [];
  const top = parseTree(root.data).filter((e) => !MANAGED_ROOT_NAMES.has(e.name));
  const out: ExtraEntry[] = [];
  for (const e of top) out.push(await buildExtraEntry(flowId, e, e.name));
  out.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'dir' ? -1 : 1));
  return out;
}

// Resolve a non-managed file path within a tree to its blob. Returns null if the
// path escapes into a managed root, doesn't exist, or isn't a regular file.
export async function resolveExtraPath(
  flowId: string,
  treeSha: string | null,
  path: string,
): Promise<(StoredObject & { name: string }) | null> {
  if (!treeSha) return null;
  const parts = String(path).split('/').filter(Boolean);
  if (!parts.length || MANAGED_ROOT_NAMES.has(parts[0])) return null;
  let curSha = treeSha;
  for (let i = 0; i < parts.length; i++) {
    const obj = await getObject(flowId, curSha);
    if (!obj || obj.objectType !== 'tree') return null;
    const entry = parseTree(obj.data).find((e) => e.name === parts[i]);
    if (!entry) return null;
    if (i === parts.length - 1) {
      const blob = await getObject(flowId, entry.sha);
      if (!blob || blob.objectType !== 'blob') return null;
      return { ...blob, name: entry.name };
    }
    if (entry.mode !== '40000') return null;
    curSha = entry.sha;
  }
  return null;
}

interface Graph {
  name?: string;
  namespace?: string;
  description?: string;
  nodes: any[];
  edges: any[];
  artifacts?: ArtifactEntry[];
}

// Build the tree entries for one directory level, recursing into flow nodes.
function buildLevel(graph: Graph, add: (o: BuiltObject) => void): TreeEntry[] {
  const nodes = Array.isArray(graph.nodes) ? graph.nodes : [];
  const edges = Array.isArray(graph.edges) ? graph.edges : [];

  const nodeEntries: TreeEntry[] = [];
  const sessionEntries: TreeEntry[] = [];
  const relNodes: any[] = [];
  const files: Record<string, string> = {};
  const sessions: Record<string, string> = {};
  const usedFiles = new Set<string>();
  const usedSessions = new Set<string>();
  // Several flow nodes can bind to the SAME editor session via data.linkedSessionId
  // (same sub-graph). They must collapse into ONE sessions/<sid>/ folder, named by
  // the session id, with every referencing node id mapped to that one path — not a
  // folder per flow node. Falls back to the node id when a flow node isn't linked
  // to a session yet, so each still appears once. Mirrors NodeFileTree.tsx.
  const sessionPathByKey = new Map<string, string>();

  for (const node of nodes) {
    const id = String(node?.id ?? '');
    const isFlow = node?.data?.type === 'flow';
    const sub = isFlow ? parseGraph(node?.data?.code) : null;

    if (sub) {
      // Flow node with an embedded sub-graph -> expand into sessions/<sid>/.
      const sessionKey = String(node?.data?.linkedSessionId || id);
      let path = sessionPathByKey.get(sessionKey);
      if (!path) {
        // Folder name: the session's display name when renamed, else the session
        // id, else the node title. Mirrors NodeFileTree.tsx.
        const candidate = node?.data?.sessionName
          ? sanitize(String(node.data.sessionName))
          : node?.data?.linkedSessionId
            ? sanitize(String(node.data.linkedSessionId))
            : baseName(node);
        const name = uniqueName(candidate, usedSessions);
        const subEntries = buildLevel({ name: node?.data?.label, nodes: sub.nodes, edges: sub.edges }, add);
        const subTree = buildTree(subEntries);
        add(subTree);
        sessionEntries.push({ mode: '40000', name, sha: subTree.sha });
        path = `sessions/${name}`;
        sessionPathByKey.set(sessionKey, path);
      }
      sessions[id] = path;
      const meta = { ...node, data: { ...node.data } };
      delete meta.data.code;
      relNodes.push(meta);
    } else if (typeof node?.data?.code === 'string') {
      // Leaf node with source code -> nodes/<name>.<ext>.
      const ext = extForLanguage(node?.data?.language, node?.data?.type);
      const filename = uniqueName(`${baseName(node)}.${ext}`, usedFiles);
      const blob = buildBlob(Buffer.from(node.data.code, 'utf8'));
      add(blob);
      nodeEntries.push({ mode: '100644', name: filename, sha: blob.sha });
      files[id] = `nodes/${filename}`;
      const meta = { ...node, data: { ...node.data } };
      delete meta.data.code;
      relNodes.push(meta);
    } else {
      relNodes.push(node); // nothing externalizable (e.g. flowRef-only, comment)
    }
  }

  const entries: TreeEntry[] = [];
  if (nodeEntries.length) {
    const t = buildTree(nodeEntries); add(t);
    entries.push({ mode: '40000', name: 'nodes', sha: t.sha });
  }
  if (sessionEntries.length) {
    const t = buildTree(sessionEntries); add(t);
    entries.push({ mode: '40000', name: 'sessions', sha: t.sha });
  }
  const artifacts = Array.isArray(graph.artifacts) ? graph.artifacts : [];
  if (artifacts.length) {
    const artEntries: TreeEntry[] = [];
    for (const a of artifacts) {
      // Write the real bytes as a git blob so clone gets the file. Caller resolves
      // refs → {name,data} before commit (see commitFlowState).
      if (!a || typeof a.name !== 'string' || typeof a.data !== 'string') continue;
      const blob = buildBlob(Buffer.from(a.data, 'base64')); add(blob);
      artEntries.push({ mode: '100644', name: sanitize(a.name), sha: blob.sha });
    }
    if (artEntries.length) {
      const t = buildTree(artEntries); add(t);
      entries.push({ mode: '40000', name: 'artifacts', sha: t.sha });
    }
  }

  const relations: RelationsFile = {
    flow: {
      name: graph.name ?? '',
      namespace: graph.namespace ?? 'default',
      description: graph.description ?? '',
    },
    nodes: relNodes,
    edges,
    files,
    sessions,
  };
  const relBlob = buildBlob(Buffer.from(JSON.stringify(relations, null, 2), 'utf8'));
  add(relBlob);
  entries.push({ mode: '100644', name: RELATIONS, sha: relBlob.sha });

  return entries;
}

// Build the full set of git objects representing a flow's current state and
// return the root tree sha. Pure — caller persists the returned objects.
// `preservedEntries` carries non-managed top-level files/folders forward from a
// prior tree (e.g. a pushed .gitignore) so a regenerated save doesn't erase
// them; they reference already-persisted objects, so nothing extra is built.
export function flowToTree(flow: FlowLike, preservedEntries: TreeEntry[] = []): TreeBuildResult {
  const collected = new Map<string, BuiltObject>();
  const add = (o: BuiltObject) => collected.set(o.sha, o);
  const entries = buildLevel(
    {
      name: flow.name,
      namespace: flow.namespace,
      description: flow.description,
      nodes: flow.nodes || [],
      edges: flow.edges || [],
      artifacts: flow.artifacts || [],
    },
    add,
  );
  // Re-attach preserved entries, but never let them shadow a managed name.
  const managedNames = new Set(entries.map((e) => e.name));
  for (const e of preservedEntries) {
    if (!MANAGED_ROOT_NAMES.has(e.name) && !managedNames.has(e.name)) entries.push(e);
  }
  const root = buildTree(entries);
  add(root);
  return { rootSha: root.sha, objects: [...collected.values()] };
}

// Read one directory level back into a graph (recursing into sessions/).
async function readLevel(flowId: string, treeSha: string): Promise<FlowFields> {
  const root = await getObject(flowId, treeSha);
  if (!root || root.objectType !== 'tree') throw new Error(`tree ${treeSha} not found`);
  const rootEntries = parseTree(root.data);

  const relEntry = rootEntries.find((e) => e.name === RELATIONS);
  if (!relEntry) throw new Error(`${RELATIONS} missing in tree ${treeSha}`);
  const relObj = await getObject(flowId, relEntry.sha);
  if (!relObj) throw new Error(`${RELATIONS} blob ${relEntry.sha} not found`);
  const relations: RelationsFile = JSON.parse(relObj.data.toString('utf8'));

  // nodes/ — path -> code
  const codeByFile = new Map<string, string>();
  const nodesEntry = rootEntries.find((e) => e.name === 'nodes' && e.mode === '40000');
  if (nodesEntry) {
    const nt = await getObject(flowId, nodesEntry.sha);
    if (nt && nt.objectType === 'tree') {
      for (const fe of parseTree(nt.data)) {
        const blob = await getObject(flowId, fe.sha);
        if (blob) codeByFile.set(`nodes/${fe.name}`, blob.data.toString('utf8'));
      }
    }
  }

  // sessions/ — path -> sub tree sha
  const sessionSha = new Map<string, string>();
  const sessionsEntry = rootEntries.find((e) => e.name === 'sessions' && e.mode === '40000');
  if (sessionsEntry) {
    const st = await getObject(flowId, sessionsEntry.sha);
    if (st && st.objectType === 'tree') {
      for (const fe of parseTree(st.data)) sessionSha.set(`sessions/${fe.name}`, fe.sha);
    }
  }

  const files = relations.files || {};
  const sessions = relations.sessions || {};
  const nodes: any[] = [];
  for (const node of relations.nodes || []) {
    const id = String(node?.id ?? '');
    if (files[id] && codeByFile.has(files[id])) {
      nodes.push({ ...node, data: { ...node.data, code: codeByFile.get(files[id]) } });
    } else if (sessions[id] && sessionSha.has(sessions[id])) {
      const sub = await readLevel(flowId, sessionSha.get(sessions[id])!);
      nodes.push({ ...node, data: { ...node.data, code: JSON.stringify({ nodes: sub.nodes, edges: sub.edges }) } });
    } else {
      nodes.push(node);
    }
  }

  // artifacts/ — each git blob is a pointer to a sha256 in artifact_blobs.
  // Legacy commits stored the raw bytes inline; detect that and surface them as
  // {name,data} so fieldsToDoc re-homes them into artifact_blobs on read.
  const artifacts: ArtifactEntry[] = [];
  const artEntry = rootEntries.find((e) => e.name === 'artifacts' && e.mode === '40000');
  if (artEntry) {
    const at = await getObject(flowId, artEntry.sha);
    if (at && at.objectType === 'tree') {
      for (const fe of parseTree(at.data)) {
        const blob = await getObject(flowId, fe.sha);
        if (!blob) continue;
        const sha = parseArtifactPointer(blob.data.toString('utf8'));
        if (sha) artifacts.push({ name: fe.name, sha });
        else artifacts.push({ name: fe.name, data: blob.data.toString('base64') }); // legacy inline
      }
    }
  }

  return {
    name: relations.flow?.name ?? '',
    namespace: relations.flow?.namespace ?? 'default',
    description: relations.flow?.description ?? '',
    nodes,
    edges: relations.edges || [],
    artifacts,
  };
}

// Read a git tree back into flow document fields.
export async function treeToFlowFields(flowId: string, treeSha: string): Promise<FlowFields> {
  return readLevel(flowId, treeSha);
}

export interface NodeSignature {
  ids: string[]; // top-level node ids
  shas: Map<string, string>; // nodeId -> content sha (blob for leaf, subtree for flow node)
}

// Per-node content fingerprint at the top level of a tree. Because both sides of
// a comparison come from the same flowToTree serializer, equal content yields
// equal shas regardless of JSON formatting — the basis for the amend decision.
export async function nodeContentSignature(flowId: string, treeSha: string): Promise<NodeSignature> {
  const root = await getObject(flowId, treeSha);
  if (!root || root.objectType !== 'tree') throw new Error(`tree ${treeSha} not found`);
  const entries = parseTree(root.data);

  const relEntry = entries.find((e) => e.name === RELATIONS);
  if (!relEntry) throw new Error(`${RELATIONS} missing in tree ${treeSha}`);
  const relObj = await getObject(flowId, relEntry.sha);
  if (!relObj) throw new Error(`${RELATIONS} blob ${relEntry.sha} not found`);
  const rel: RelationsFile = JSON.parse(relObj.data.toString('utf8'));

  const subShas = async (folder: string): Promise<Map<string, string>> => {
    const m = new Map<string, string>();
    const e = entries.find((x) => x.name === folder && x.mode === '40000');
    if (e) {
      const t = await getObject(flowId, e.sha);
      if (t && t.objectType === 'tree') for (const fe of parseTree(t.data)) m.set(fe.name, fe.sha);
    }
    return m;
  };
  const nodeShas = await subShas('nodes');
  const sessShas = await subShas('sessions');

  const shas = new Map<string, string>();
  for (const [id, p] of Object.entries(rel.files || {})) {
    const base = String(p).replace(/^nodes\//, '');
    if (nodeShas.has(base)) shas.set(id, nodeShas.get(base)!);
  }
  for (const [id, p] of Object.entries(rel.sessions || {})) {
    const base = String(p).replace(/^sessions\//, '');
    if (sessShas.has(base)) shas.set(id, sessShas.get(base)!);
  }
  const ids = (rel.nodes || []).map((n: any) => String(n?.id ?? ''));
  return { ids, shas };
}
