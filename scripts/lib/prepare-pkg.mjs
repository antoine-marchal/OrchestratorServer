// Shared pkg-prepare helpers: stage groovyExec.jar (worker + server) and, for
// the server, copy the built web panel into dist/webpanel. Uses only Node
// builtins, so it resolves fine from the repo-root location regardless of caller.
import fs from 'fs';
import path from 'path';

export function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dst, entry.name);
    if (entry.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

// Copy groovyExec.jar into <root>/dist from the first existing candidate path.
export function copyGroovyJar({ root, candidates }) {
  const jarDest = path.join(root, 'dist', 'groovyExec.jar');
  for (const src of candidates.filter(Boolean)) {
    try {
      if (fs.existsSync(src)) {
        fs.mkdirSync(path.dirname(jarDest), { recursive: true });
        fs.copyFileSync(src, jarDest);
        console.log(`[prepare] groovyExec.jar → dist/  (source: ${path.relative(root, src)})`);
        return true;
      }
    } catch (e) {
      console.warn(`[prepare] Could not copy groovyExec.jar from ${src}: ${e.message}`);
    }
  }
  console.warn('[prepare] groovyExec.jar not found — Groovy nodes will not work in the packaged binary.');
  return false;
}

// Copy the built client (clientDist) into <root>/dist/webpanel. Server only.
export function copyClientDist({ root, clientDist }) {
  const dest = path.join(root, 'dist', 'webpanel');
  if (!fs.existsSync(clientDist) || !fs.existsSync(path.join(clientDist, 'index.html'))) {
    console.warn('[prepare] client/dist not found or incomplete.');
    console.warn('[prepare] Run "npm run build" inside orchestrator-webpanel/client first.');
    console.warn('[prepare] The packaged server will serve API only (no web panel).');
    return false;
  }
  if (fs.existsSync(dest)) fs.rmSync(dest, { recursive: true });
  copyDir(clientDist, dest);
  console.log(`[prepare] client/dist → dist/webpanel/  (${fs.readdirSync(dest).length} entries)`);
  return true;
}
