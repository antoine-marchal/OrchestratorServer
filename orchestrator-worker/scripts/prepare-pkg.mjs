import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const dest = path.join(root, 'dist', 'groovyExec.jar');

// Search order: worker root → workspace root → GROOVY_JAR env var
const candidates = [
  path.join(root, 'groovyExec.jar'),
  path.join(root, '..', 'groovyExec.jar'),
  process.env.GROOVY_JAR,
].filter(Boolean);

let copied = false;
for (const src of candidates) {
  try {
    if (fs.existsSync(src)) {
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(src, dest);
      console.log(`[prepare] groovyExec.jar → dist/  (source: ${path.relative(root, src)})`);
      copied = true;
      break;
    }
  } catch (e) {
    console.warn(`[prepare] Could not copy from ${src}: ${e.message}`);
  }
}

if (!copied) {
  console.warn('[prepare] groovyExec.jar not found — Groovy nodes will not work in the packaged binary.');
  console.warn('[prepare] Place groovyExec.jar next to package.json (orchestrator-worker/) and rebuild.');
}
