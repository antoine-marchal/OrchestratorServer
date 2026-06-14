import zlib from 'zlib';
import crypto from 'crypto';
import type { Request, Response } from 'express';
import { hashObject, parseCommit, parseTree, type GitObjectType } from './gitObjects';
import { getObject, putObject, getRef, setRef, deleteRef } from './gitStore';
import { syncDocFromRefIfActive } from './flowCommit';

// Custom git-receive-pack (push) handler.
//
// @fusebit/cloud-git's built-in parser resolves delta bases only from objects
// inside the incoming pack, so any *thin pack* — which git sends by default on
// push, deltifying against objects the server already has — fails with
// "Base object ... is not present in the pack". This handler buffers the body
// and unpacks with delta-base fallback to the stored objects, so thin packs
// work. It also enforces compare-and-swap on refs and emits report-status.

const ZERO = '0'.repeat(40);
const FLUSH = Buffer.from('0000');
const TYPE_NAMES: Record<number, GitObjectType> = { 1: 'commit', 2: 'tree', 3: 'blob', 4: 'tag' };

function pktLine(payload: Buffer | string): Buffer {
  const b = Buffer.isBuffer(payload) ? payload : Buffer.from(payload, 'utf8');
  const len = b.length + 4;
  return Buffer.concat([Buffer.from(len.toString(16).padStart(4, '0'), 'utf8'), b]);
}

// Wrap a payload into side-band-64k band 1 (data) pkt-lines.
function bandData(payload: Buffer): Buffer {
  const MAX = 65515; // 65520 - 4 (pkt header) - 1 (band byte)
  const out: Buffer[] = [];
  for (let i = 0; i < payload.length; i += MAX) {
    out.push(pktLine(Buffer.concat([Buffer.from([1]), payload.subarray(i, i + MAX)])));
  }
  return Buffer.concat(out);
}

// Minimal structural type so we don't import FlowGitRepository (avoids a cycle).
interface RefSource {
  getRefs(req: Request): Promise<Array<{ ref: string; sha: string }>>;
  getHeadRef(req: Request): Promise<string | undefined>;
}

// Smart-HTTP ref advertisement. We serve this instead of @fusebit/cloud-git's
// handler so we can advertise `report-status` (and `delete-refs`) for pushes —
// without it the client never negotiates report-status and its sideband
// demultiplexer rejects our push report.
export async function handleInfoRefs(repo: RefSource, req: Request, res: Response): Promise<void> {
  const service = String(req.query.service || '');
  if (service !== 'git-upload-pack' && service !== 'git-receive-pack') {
    res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Only smart git protocol is supported' } });
    return;
  }
  res.set('content-type', `application/x-${service}-advertisement`);
  res.set('cache-control', 'no-cache');
  try {
    const refs = await repo.getRefs(req);
    const head = await repo.getHeadRef(req);
    let caps = service === 'git-receive-pack'
      ? 'report-status delete-refs side-band-64k'
      : 'side-band-64k';
    if (head && service === 'git-upload-pack') caps += ` symref=HEAD:${head}`;

    const out: Buffer[] = [pktLine(`# service=${service}\n`), FLUSH];
    if (!refs.length) {
      out.push(pktLine(`${ZERO} capabilities^{}\0${caps}\n`));
    } else {
      out.push(pktLine(`${refs[0].sha} ${refs[0].ref}\0${caps}\n`));
      for (let i = 1; i < refs.length; i++) out.push(pktLine(`${refs[i].sha} ${refs[i].ref}\n`));
    }
    out.push(FLUSH);
    res.end(Buffer.concat(out));
  } catch (e: any) {
    console.error('[git] info/refs failed:', e.message);
    res.status(500).end();
  }
}

// ── upload-pack (fetch/clone) ────────────────────────────────────────────────
// Own implementation so we control side-band negotiation: fusebit's always
// frames the pack in side-band even when the client didn't request it, yielding
// "expected ACK/NAK, got '?PACK'" on clients that fetch without side-band-64k.

const PACK_TYPE_NUM: Record<GitObjectType, number> = { commit: 1, tree: 2, blob: 3, tag: 4 };

// Iterate pkt-lines in a buffer, skipping flush packets.
function* pktLines(body: Buffer): Generator<string> {
  let off = 0;
  while (off + 4 <= body.length) {
    const len = parseInt(body.subarray(off, off + 4).toString('utf8'), 16);
    if (Number.isNaN(len)) break;
    if (len === 0) { off += 4; continue; }
    yield body.subarray(off + 4, off + len).toString('utf8');
    off += len;
  }
}

// Reachable object closure from a set of root shas.
async function closure(flowId: string, roots: string[]): Promise<Set<string>> {
  const seen = new Set<string>();
  const queue = [...roots];
  while (queue.length) {
    const sha = queue.pop();
    if (!sha || seen.has(sha)) continue;
    const o = await getObject(flowId, sha);
    if (!o) continue; // not present — can't traverse/send
    seen.add(sha);
    if (o.objectType === 'commit') {
      const c = parseCommit(o.data);
      if (c.tree) queue.push(c.tree);
      for (const p of c.parents) queue.push(p);
    } else if (o.objectType === 'tree') {
      for (const e of parseTree(o.data)) queue.push(e.sha);
    }
  }
  return seen;
}

function packObjectHeader(type: number, size: number): Buffer {
  let first = (type << 4) | (size & 0x0f);
  size >>= 4;
  const bytes: number[] = [];
  if (size > 0) first |= 0x80;
  bytes.push(first);
  while (size > 0) {
    let b = size & 0x7f;
    size >>= 7;
    if (size > 0) b |= 0x80;
    bytes.push(b);
  }
  return Buffer.from(bytes);
}

async function buildPack(flowId: string, shas: string[]): Promise<Buffer> {
  const parts: Buffer[] = [];
  const header = Buffer.alloc(12);
  header.write('PACK', 0, 'ascii');
  header.writeUInt32BE(2, 4);
  header.writeUInt32BE(shas.length, 8);
  parts.push(header);
  for (const sha of shas) {
    const o = await getObject(flowId, sha);
    if (!o) continue;
    parts.push(packObjectHeader(PACK_TYPE_NUM[o.objectType], o.data.length));
    parts.push(zlib.deflateSync(o.data));
  }
  const pack = Buffer.concat(parts);
  const trailer = crypto.createHash('sha1').update(pack).digest();
  return Buffer.concat([pack, trailer]);
}

export async function handleUploadPack(req: Request, res: Response): Promise<void> {
  const flowId = (req as any).gitFlowId || (req.params as any)?.flowId;
  res.set('content-type', 'application/x-git-upload-pack-result');
  res.set('cache-control', 'no-cache');
  try {
    const body = await readBody(req);
    const wants: string[] = [];
    const haves: string[] = [];
    let caps = '';
    let done = false;
    for (const line of pktLines(body)) {
      const t = line.trim();
      if (t === 'done') {
        done = true;
      } else if (t.startsWith('want ')) {
        const rest = t.slice(5);
        const sp = rest.indexOf(' ');
        if (sp >= 0) { wants.push(rest.slice(0, sp)); if (!caps) caps = rest.slice(sp + 1); }
        else wants.push(rest);
      } else if (t.startsWith('have ')) {
        haves.push(t.slice(5).trim());
      }
    }

    // Multi-round (stateless) negotiation: a request without `done` is a probe —
    // the client expects only acknowledgments, no pack. Sending the pack here is
    // what produces "expected ACK/NAK, got '?PACK'". Reply NAK and wait for the
    // round that carries `done`.
    if (!done) {
      res.write(pktLine('NAK\n'));
      res.end();
      return;
    }

    const haveClosure = haves.length ? await closure(flowId, haves) : new Set<string>();
    const sendClosure = await closure(flowId, wants);
    const toSend = [...sendClosure].filter((sha) => !haveClosure.has(sha));

    const pack = await buildPack(flowId, toSend);
    const sb = caps.includes('side-band-64k') || caps.includes('side-band');
    res.write(pktLine('NAK\n'));
    if (sb) {
      res.write(bandData(pack));
      res.write(FLUSH);
    } else {
      res.write(pack);
    }
    res.end();
  } catch (e: any) {
    console.error('[git] upload-pack failed:', e.message);
    res.end();
  }
}

interface PushCommand {
  oldSha: string;
  newSha: string;
  ref: string;
}

function readBody(req: Request): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

// ── delta application (ported from cloud-git's pure undeltify logic) ──────────
function parseVarint(buf: Buffer, ctx: { off: number }): number {
  let v = 0;
  let shift = 0;
  let more = true;
  while (more) {
    const b = buf[ctx.off++];
    more = !!(b & 0x80);
    v += (b & 0x7f) << shift;
    shift += 7;
  }
  return v;
}

function undeltify(base: Buffer, delta: Buffer): Buffer {
  const ctx = { off: 0 };
  const srcLen = parseVarint(delta, ctx);
  if (srcLen !== base.length) {
    throw new Error(`delta source length ${srcLen} != base length ${base.length}`);
  }
  const destLen = parseVarint(delta, ctx);
  const result = Buffer.alloc(destLen);
  let ro = 0;
  while (ctx.off < delta.length) {
    const op = delta[ctx.off++];
    if (op & 0x80) {
      // copy from base
      let start = 0;
      let size = 0;
      if (op & 0x01) start |= delta[ctx.off++];
      if (op & 0x02) start |= delta[ctx.off++] << 8;
      if (op & 0x04) start |= delta[ctx.off++] << 16;
      if (op & 0x08) start |= delta[ctx.off++] << 24;
      if (op & 0x10) size |= delta[ctx.off++];
      if (op & 0x20) size |= delta[ctx.off++] << 8;
      if (op & 0x40) size |= delta[ctx.off++] << 16;
      if (size === 0) size = 0x10000;
      base.copy(result, ro, start, start + size);
      ro += size;
    } else if (op) {
      // insert literal
      delta.copy(result, ro, ctx.off, ctx.off + op);
      ro += op;
      ctx.off += op;
    } else {
      throw new Error('delta instruction 0 is invalid');
    }
  }
  if (ro !== destLen) throw new Error('undeltified object incomplete');
  return result;
}

// Parse the pkt-line command list; returns commands, capabilities and the byte
// offset where the PACK data begins.
function parseCommands(body: Buffer): { commands: PushCommand[]; caps: string; packOffset: number } {
  const commands: PushCommand[] = [];
  let caps = '';
  let off = 0;
  while (off + 4 <= body.length) {
    const len = parseInt(body.subarray(off, off + 4).toString('utf8'), 16);
    if (Number.isNaN(len)) break;
    if (len === 0) { off += 4; break; } // flush — end of commands
    let line = body.subarray(off + 4, off + len).toString('utf8');
    off += len;
    const nul = line.indexOf('\0');
    if (nul >= 0) { caps = line.slice(nul + 1); line = line.slice(0, nul); }
    const [oldSha, newSha, ref] = line.replace(/\n$/, '').trim().split(' ');
    if (ref) commands.push({ oldSha, newSha, ref });
  }
  return { commands, caps, packOffset: off };
}

async function unpackObjects(flowId: string, pack: Buffer): Promise<void> {
  if (pack.length < 12 || pack.subarray(0, 4).toString('utf8') !== 'PACK') return; // delete-only push: no pack
  const count = pack.readUInt32BE(8);
  let p = 12;
  const inPack = new Map<string, { type: GitObjectType; data: Buffer }>();

  for (let i = 0; i < count; i++) {
    let c = pack[p++];
    const type = (c >> 4) & 0x07;
    let size = c & 0x0f;
    let shift = 4;
    while (c & 0x80) { c = pack[p++]; size += (c & 0x7f) << shift; shift += 7; }

    let baseSha: string | null = null;
    if (type === 7) { baseSha = pack.subarray(p, p + 20).toString('hex'); p += 20; }
    else if (type === 6) throw new Error('ofs-delta objects are not supported');

    const res: any = zlib.inflateSync(pack.subarray(p), { info: true } as any);
    const inflated: Buffer = res.buffer;
    p += res.engine.bytesWritten;

    if (type === 7 && baseSha) {
      let base = inPack.get(baseSha);
      if (!base) {
        const stored = await getObject(flowId, baseSha);
        if (!stored) throw new Error(`thin-pack base object ${baseSha} not found in repository`);
        base = { type: stored.objectType, data: stored.data };
      }
      const data = undeltify(base.data, inflated);
      const sha = hashObject(base.type, data);
      inPack.set(sha, { type: base.type, data });
    } else {
      const objType = TYPE_NAMES[type];
      if (!objType) throw new Error(`unsupported object type ${type}`);
      const sha = hashObject(objType, inflated);
      inPack.set(sha, { type: objType, data: inflated });
    }
  }

  for (const [sha, o] of inPack) await putObject(flowId, sha, o.type, o.data);
}

function writeReport(res: Response, report: Buffer, caps: string): void {
  if (caps.includes('side-band-64k') || caps.includes('side-band')) {
    res.write(bandData(report));
    res.write(FLUSH);
  } else {
    res.write(report);
  }
  res.end();
}

export async function handleReceivePack(req: Request, res: Response): Promise<void> {
  const flowId = (req as any).gitFlowId || (req.params as any)?.flowId;
  res.set('content-type', 'application/x-git-receive-pack-result');
  res.set('cache-control', 'no-cache');
  let caps = '';
  try {
    const body = await readBody(req);
    const parsed = parseCommands(body);
    caps = parsed.caps;
    const { commands, packOffset } = parsed;

    await unpackObjects(flowId, body.subarray(packOffset));

    // Apply ref updates with compare-and-swap to reject stale (non-ff) pushes.
    const results: Array<{ ref: string; ok: boolean; reason?: string }> = [];
    const updated: string[] = [];
    for (const cmd of commands) {
      const current = (await getRef(flowId, cmd.ref)) || ZERO;
      if (cmd.oldSha !== current) {
        results.push({ ref: cmd.ref, ok: false, reason: 'fetch first' });
        continue;
      }
      if (cmd.newSha === ZERO) {
        await deleteRef(flowId, cmd.ref);
      } else {
        await setRef(flowId, cmd.ref, cmd.newSha);
        updated.push(cmd.ref);
      }
      results.push({ ref: cmd.ref, ok: true });
    }

    for (const ref of updated) {
      try { await syncDocFromRefIfActive(flowId, ref); }
      catch (e: any) { console.warn(`[git] sync doc from ${ref} failed:`, e.message); }
    }

    // report-status
    let report = pktLine('unpack ok\n');
    for (const r of results) {
      report = Buffer.concat([report, pktLine(r.ok ? `ok ${r.ref}\n` : `ng ${r.ref} ${r.reason}\n`)]);
    }
    report = Buffer.concat([report, FLUSH]);
    writeReport(res, report, caps);
  } catch (e: any) {
    console.error('[git] receive-pack failed:', e.message);
    const report = Buffer.concat([pktLine(`unpack ${e.message}\n`), FLUSH]);
    try { writeReport(res, report, caps); } catch { res.end(); }
  }
}
