import * as ResEdit from 'resedit';
import path from 'path';
import { fileURLToPath } from 'url';
import { patchExe } from '../../scripts/lib/patch-exe.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));

await patchExe(ResEdit, {
  scriptDir,
  exePath: path.resolve(scriptDir, '../../release/orchestrator-worker-win.exe'),
  fileDescription: 'Orchestrator Worker Agent',
  originalFilename: 'orchestrator-worker-win.exe',
  internalName: 'orchestrator-worker',
});
