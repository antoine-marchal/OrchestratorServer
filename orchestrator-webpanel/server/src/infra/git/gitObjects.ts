import crypto from 'crypto';

// Build and parse loose git objects (blob/tree/commit) by hand. @fusebit/cloud-git
// exposes no construction helpers, so we re-implement the on-disk object format —
// identical to what its pack parser hashes: sha1("<type> <len>\0" + data).

export type GitObjectType = 'commit' | 'tree' | 'blob' | 'tag';

export interface BuiltObject {
  sha: string; // 40-char hex
  objectType: GitObjectType;
  data: Buffer; // raw, uncompressed object content (no header)
}

export interface TreeEntry {
  mode: string; // '100644' file, '40000' subtree
  name: string;
  sha: string; // hex
}

const NUL = Buffer.from([0]);

// sha1 of the canonical git object: "<type> <length>\0<data>".
export function hashObject(type: GitObjectType, data: Buffer): string {
  return crypto
    .createHash('sha1')
    .update(type)
    .update(' ')
    .update(String(data.length))
    .update(NUL)
    .update(data)
    .digest('hex');
}

export function buildBlob(content: Buffer): BuiltObject {
  return { sha: hashObject('blob', content), objectType: 'blob', data: content };
}

// Git requires tree entries sorted by name, with subtree names treated as if a
// trailing '/' were appended. fsck rejects mis-ordered trees, so honor the rule.
function treeSortKey(e: TreeEntry): Buffer {
  return Buffer.from(e.name + (e.mode === '40000' ? '/' : ''), 'utf8');
}

export function buildTree(entries: TreeEntry[]): BuiltObject {
  const sorted = [...entries].sort((a, b) => Buffer.compare(treeSortKey(a), treeSortKey(b)));
  const parts: Buffer[] = [];
  for (const e of sorted) {
    parts.push(Buffer.from(`${e.mode} ${e.name}`, 'utf8'));
    parts.push(NUL);
    parts.push(Buffer.from(e.sha, 'hex')); // 20 raw bytes
  }
  const data = Buffer.concat(parts);
  return { sha: hashObject('tree', data), objectType: 'tree', data };
}

export interface CommitInput {
  tree: string; // hex
  parents?: string[]; // hex
  authorName: string;
  authorEmail: string;
  message: string;
  when?: Date;
}

function personLine(label: string, name: string, email: string, when: Date): string {
  const ts = Math.floor(when.getTime() / 1000);
  // Always emit UTC; keeps round-trips deterministic regardless of host TZ.
  return `${label} ${name} <${email}> ${ts} +0000\n`;
}

export function buildCommit(input: CommitInput): BuiltObject {
  const when = input.when ?? new Date();
  let text = `tree ${input.tree}\n`;
  for (const p of input.parents ?? []) text += `parent ${p}\n`;
  text += personLine('author', input.authorName, input.authorEmail, when);
  text += personLine('committer', input.authorName, input.authorEmail, when);
  text += '\n';
  text += input.message.endsWith('\n') ? input.message : input.message + '\n';
  const data = Buffer.from(text, 'utf8');
  return { sha: hashObject('commit', data), objectType: 'commit', data };
}

export function parseTree(data: Buffer): TreeEntry[] {
  const entries: TreeEntry[] = [];
  let i = 0;
  while (i < data.length) {
    const sp = data.indexOf(0x20, i); // space
    const mode = data.subarray(i, sp).toString('utf8');
    const nul = data.indexOf(0x00, sp + 1);
    const name = data.subarray(sp + 1, nul).toString('utf8');
    const sha = data.subarray(nul + 1, nul + 21).toString('hex');
    entries.push({ mode, name, sha });
    i = nul + 21;
  }
  return entries;
}

export interface ParsedCommit {
  tree: string;
  parents: string[];
  author: string; // raw author line value (without label)
  message: string;
  authorDate: Date | null;
}

export function parseCommit(data: Buffer): ParsedCommit {
  const text = data.toString('utf8');
  const sepIdx = text.indexOf('\n\n');
  const header = sepIdx >= 0 ? text.slice(0, sepIdx) : text;
  const message = sepIdx >= 0 ? text.slice(sepIdx + 2) : '';
  let tree = '';
  const parents: string[] = [];
  let author = '';
  let authorDate: Date | null = null;
  for (const line of header.split('\n')) {
    if (line.startsWith('tree ')) tree = line.slice(5).trim();
    else if (line.startsWith('parent ')) parents.push(line.slice(7).trim());
    else if (line.startsWith('author ')) {
      author = line.slice(7).trim();
      const m = author.match(/>\s+(\d+)\s/);
      if (m) authorDate = new Date(parseInt(m[1], 10) * 1000);
    }
  }
  return { tree, parents, author, message: message.replace(/\n$/, ''), authorDate };
}
