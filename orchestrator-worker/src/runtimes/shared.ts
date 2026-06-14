// Filesystem layout + small helpers shared by every language runtime.
import fs from 'fs';
import path from 'path';

export const WORK_DIR = process.env.ORCHESTRATOR_WORK_DIR || process.cwd();
export const EXECUTION_DIR = process.env.ORCHESTRATOR_EXECUTION_DIR || WORK_DIR;
// Scratch directory for generated wrapper scripts and their I/O sidecar files.
export const INBOX = path.join(WORK_DIR, 'inbox');
export const GROOVY_JAR = process.env.GROOVY_JAR || path.join(WORK_DIR, 'groovyExec.jar');

if (!fs.existsSync(INBOX)) fs.mkdirSync(INBOX, { recursive: true });

export function nowUid(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

export function safeUnlink(f: string): void {
  try { if (fs.existsSync(f)) fs.unlinkSync(f); } catch { /* non-fatal */ }
}

// Coerce a runner's raw output into a value: parse JSON when it looks like JSON,
// otherwise keep the trimmed string; empty becomes null.
export function normalizeOutput(v: any): any {
  if (v === undefined || v === null || v === '') return null;
  if (typeof v === 'string') {
    const t = v.trim();
    try { return JSON.parse(t); } catch { return t || null; }
  }
  return v;
}
