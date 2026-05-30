import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

// --- groovyExec.jar ---
const jarDest = path.join(root, 'dist', 'groovyExec.jar');
const jarCandidates = [
  path.join(root, 'groovyExec.jar'),
  path.join(root, '../..', 'groovyExec.jar'),
  process.env.GROOVY_JAR,
].filter(Boolean);

let jarCopied = false;
for (const src of jarCandidates) {
  try {
    if (src && fs.existsSync(src)) {
      fs.mkdirSync(path.dirname(jarDest), { recursive: true });
      fs.copyFileSync(src, jarDest);
      console.log(`[prepare] groovyExec.jar → dist/  (source: ${path.relative(root, src)})`);
      jarCopied = true;
      break;
    }
  } catch (e) {
    console.warn(`[prepare] Could not copy groovyExec.jar from ${src}: ${e.message}`);
  }
}
if (!jarCopied) {
  console.warn('[prepare] groovyExec.jar not found — Groovy nodes will not work in the packaged binary.');
  console.warn('[prepare] Place groovyExec.jar next to server/package.json and rebuild.');
}

// --- Client build ---
// Client build is expected at server/../client/dist (monorepo layout)
const clientDist = path.resolve(root, '../client/dist');
const dest = path.join(root, 'dist', 'webpanel');

if (!fs.existsSync(clientDist) || !fs.existsSync(path.join(clientDist, 'index.html'))) {
  console.warn('[prepare] client/dist not found or incomplete.');
  console.warn('[prepare] Run "npm run build" inside orchestrator-webpanel/client first.');
  console.warn('[prepare] The packaged server will serve API only (no web panel).');
  process.exit(0);
}

function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dst, entry.name);
    if (entry.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

if (fs.existsSync(dest)) fs.rmSync(dest, { recursive: true });
copyDir(clientDist, dest);
console.log(`[prepare] client/dist → dist/webpanel/  (${fs.readdirSync(dest).length} entries)`);
