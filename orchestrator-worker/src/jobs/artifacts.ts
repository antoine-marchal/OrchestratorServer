// Per-flow-execution artifact lifecycle. A flow's many per-node jobs share one
// artifact set; we download + extract it once per execution, reuse it across the
// execution's nodes, then sweep it a grace window after the last node finishes.
import fs from 'fs';
import path from 'path';
import { pipeline } from 'stream/promises';
import { http } from '../transport/httpClient';
import { EXECUTION_DIR, KEEP_ARTIFACTS, ARTIFACT_CLEANUP_DELAY_MS } from '../config';

type OnLog = (type: 'log' | 'error', message: string) => void;

// Reject absolute paths and any `..` traversal that escapes EXECUTION_DIR.
// Returns null when the artifact name is unsafe; callers should skip it.
function safeArtifactPath(name: string): string | null {
  if (typeof name !== 'string') return null;
  const trimmed = name.trim();
  if (!trimmed) return null;
  const normalized = trimmed.replace(/\\/g, '/');
  if (path.isAbsolute(normalized) || /^[a-zA-Z]:/.test(normalized) || normalized.startsWith('//')) return null;
  const resolvedTarget = path.resolve(EXECUTION_DIR);
  const resolved = path.resolve(resolvedTarget, normalized);
  const rel = path.relative(resolvedTarget, resolved);
  if (rel.startsWith('..') || path.isAbsolute(rel)) return null;
  return resolved;
}

// Extensions auto-unpacked at the start of a job — mirrors the server side.
const ARCHIVE_EXTS = ['.zip', '.tar', '.tar.gz', '.tgz', '.gz', '.7z'];
function isArchiveName(name: string): boolean {
  const lower = name.toLowerCase();
  return ARCHIVE_EXTS.some(ext => lower.endsWith(ext));
}
function unpackArchive(archivePath: string, targetDir: string): boolean {
  const { execFileSync } = require('child_process');
  try {
    execFileSync('tar', ['-xf', archivePath, '-C', targetDir], { stdio: 'pipe' });
    return true;
  } catch (e: any) {
    if (archivePath.toLowerCase().endsWith('.7z')) {
      for (const bin of ['7z', '7za']) {
        try {
          execFileSync(bin, ['x', '-y', `-o${targetDir}`, archivePath], { stdio: 'pipe' });
          return true;
        } catch { /* try next */ }
      }
    }
    console.warn(`[worker] failed to unpack ${path.basename(archivePath)}: ${e.message}`);
    return false;
  }
}

function cleanupArtifacts(artifacts: Array<{name: string}>): void {
  if (!artifacts || !artifacts.length) return;
  for (const artifact of artifacts) {
    const p = safeArtifactPath(artifact.name);
    if (!p) continue;
    try { if (fs.existsSync(p)) fs.unlinkSync(p); } catch { }
  }
}

// Per-flow-execution artifact state. Keyed by the parent flow's executionId so
// that the many per-node jobs of one flow share a single extraction. `active`
// is the count of that execution's nodes currently running on this worker; when
// it hits 0 we arm `cleanupTimer` to sweep the artifacts after a grace window
// (covers the inter-node gap so we don't delete files the next node needs).
interface ExecArtifactState {
  sig: string;
  names: Array<{ name: string }>; // for cleanup; bodies live on disk, never in memory
  active: number;
  cleanupTimer: NodeJS.Timeout | null;
}
const execArtifacts = new Map<string, ExecArtifactState>();

// Stable signature of an artifact set so we can tell when a job's artifacts
// match what we already extracted for its execution (by content sha, or by
// name + inline length when the body is inlined on older builds).
function artifactSignature(refs: Array<{ name: string; sha?: string; data?: string }>): string {
  return refs
    .map(r => `${r.name}:${r.sha ?? `inline${r.data ? r.data.length : 0}`}`)
    .sort()
    .join('|');
}

// Download one artifact body straight to disk, streaming it chunk-by-chunk so a
// large body never sits in memory (no giant base64 JSON). Falls back to a legacy
// inline `data` body if the server still provides one. Unpacks archives in place.
async function streamArtifactToDisk(
  workerId: string,
  jobId: string,
  ref: { name: string; sha?: string; data?: string },
): Promise<void> {
  const destPath = safeArtifactPath(ref.name);
  if (!destPath) { console.warn(`[worker] rejected unsafe artifact name: ${ref.name}`); return; }
  const destDir = path.dirname(destPath);
  if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });

  if (typeof ref.data === 'string') {
    // Legacy inline body (older orchestrator) — small enough to write directly.
    fs.writeFileSync(destPath, Buffer.from(ref.data, 'base64'));
  } else if (ref.sha) {
    // Stream the raw bytes from the server to the file. responseType:'stream'
    // means axios never buffers the whole body; pipeline applies backpressure.
    const res = await http.get(
      `/api/v1/workers/${workerId}/jobs/${jobId}/artifacts/${ref.sha}/raw`,
      { responseType: 'stream', maxContentLength: Infinity, maxBodyLength: Infinity, timeout: 0 },
    );
    await pipeline(res.data as NodeJS.ReadableStream, fs.createWriteStream(destPath));
  } else {
    return; // nothing to fetch
  }

  if (isArchiveName(ref.name)) {
    const ok = unpackArchive(destPath, EXECUTION_DIR);
    if (ok && !KEEP_ARTIFACTS) {
      try { fs.unlinkSync(destPath); } catch { /* non-fatal */ }
    }
  }
}

// Ensure this execution's artifacts are on disk. Downloads + extracts them only
// on the first node of the execution (or if the artifact set changed); later
// nodes reuse the already-extracted files instead of re-downloading and
// re-decompressing them on every node.
export async function ensureArtifactsExtracted(
  workerId: string,
  jobId: string,
  execKey: string,
  artifactRefs: Array<{ name: string; sha?: string; data?: string }>,
  onLog: OnLog,
): Promise<void> {
  const sig = artifactSignature(artifactRefs);
  const existing = execArtifacts.get(execKey);
  if (existing && existing.sig === sig) {
    onLog('log', `[worker] reusing ${existing.names.length} artifact(s) already extracted for this execution`);
    return; // already extracted for this flow run — nothing to do
  }
  for (const ref of artifactRefs) {
    await streamArtifactToDisk(workerId, jobId, ref);
  }
  const names = artifactRefs.map(r => ({ name: r.name }));
  execArtifacts.set(execKey, { sig, names, active: 0, cleanupTimer: existing?.cleanupTimer ?? null });
  onLog('log', `[worker] ${names.length} artifact(s) streamed to ${EXECUTION_DIR}`);
}

// Mark a node of `execKey` as started — cancels any pending cleanup so a late
// node doesn't run against half-deleted artifacts.
export function markExecNodeStart(execKey: string): void {
  const st = execArtifacts.get(execKey);
  if (!st) return;
  if (st.cleanupTimer) { clearTimeout(st.cleanupTimer); st.cleanupTimer = null; }
  st.active++;
}

// Mark a node finished. When the execution has no more in-flight nodes, arm a
// delayed sweep of its artifacts (skipped when ORCHESTRATOR_KEEP_ARTIFACTS=true).
export function markExecNodeEnd(execKey: string): void {
  const st = execArtifacts.get(execKey);
  if (!st) return;
  st.active = Math.max(0, st.active - 1);
  if (st.active > 0) return;
  if (KEEP_ARTIFACTS) { execArtifacts.delete(execKey); return; }
  if (st.cleanupTimer) clearTimeout(st.cleanupTimer);
  st.cleanupTimer = setTimeout(() => {
    const cur = execArtifacts.get(execKey);
    if (!cur || cur.active > 0) return; // a new node arrived during the window
    cleanupArtifacts(cur.names);
    execArtifacts.delete(execKey);
  }, ARTIFACT_CLEANUP_DELAY_MS);
  // Don't keep the process alive just for the cleanup timer.
  if (typeof st.cleanupTimer.unref === 'function') st.cleanupTimer.unref();
}
