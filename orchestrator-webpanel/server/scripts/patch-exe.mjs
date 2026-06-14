import * as ResEdit from 'resedit';
import path from 'path';
import { fileURLToPath } from 'url';
import { patchExe } from '../../../scripts/lib/patch-exe.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));

await patchExe(ResEdit, {
  scriptDir,
  exePath: path.resolve(scriptDir, '../../../release/orchestrator-server-win.exe'),
  fileDescription: 'Orchestrator Server',
  originalFilename: 'orchestrator-server-win.exe',
  internalName: 'orchestrator-server',
});
