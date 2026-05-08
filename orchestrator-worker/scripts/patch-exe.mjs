import * as ResEdit from 'resedit';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import { createRequire } from 'module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../package.json'), 'utf8'));
const [major, minor, patch] = (pkg.version || '1.0.0').split('.').map(Number);

const EXE  = path.resolve(__dirname, '../release/orchestrator-worker-win.exe');
const ICON = path.resolve(__dirname, '../assets/icon.ico');

if (!fs.existsSync(EXE)) {
  console.error(`[patch-exe] Exe not found: ${EXE}`);
  process.exit(1);
}

const FILE_VERSION    = [major, minor, patch, 0];
const PRODUCT_VERSION = [major, minor, patch, 0];
const LANG = 1033;     // English (US)
const CODEPAGE = 1200; // UTF-16 LE

console.log('[patch-exe] Reading exe...');
const exeData = fs.readFileSync(EXE);
const exe = ResEdit.NtExecutable.from(exeData, { ignoreCert: true });
const res = ResEdit.NtExecutableResource.from(exe);

// --- Version info ---
let viList = ResEdit.Resource.VersionInfo.fromEntries(res.entries);
let vi;
if (viList.length > 0) {
  vi = viList[0];
} else {
  vi = ResEdit.Resource.VersionInfo.createEmpty();
  viList = [vi];
}

vi.setFileVersion(...FILE_VERSION);
vi.setProductVersion(...PRODUCT_VERSION);

vi.setStringValues({ lang: LANG, codepage: CODEPAGE }, {
  FileDescription:  'Orchestrator Worker Agent',
  ProductName:      'Orchestrator',
  CompanyName:      'Antoine Marchal',
  LegalCopyright:   `Copyright (c) ${new Date().getFullYear()} Antoine Marchal`,
  OriginalFilename: 'orchestrator-worker-win.exe',
  InternalName:     'orchestrator-worker',
  FileVersion:      FILE_VERSION.slice(0, 3).join('.'),
  ProductVersion:   PRODUCT_VERSION.slice(0, 3).join('.'),
});

res.entries = res.entries.filter(e => e.type !== 16 /* RT_VERSION */);
viList.forEach(v => v.outputToResourceEntries(res.entries));

// --- Icon ---
if (fs.existsSync(ICON)) {
  console.log('[patch-exe] Applying icon...');
  const iconData = fs.readFileSync(ICON);
  const iconFile = ResEdit.Data.IconFile.from(iconData.buffer);
  ResEdit.Resource.IconGroupEntry.replaceIconsForResource(
    res.entries,
    1,
    LANG,
    iconFile.icons.map(i => i.data),
  );
} else {
  console.warn('[patch-exe] No icon found at assets/icon.ico — skipping.');
}

res.outputResource(exe);
const outData = Buffer.from(exe.generate());

async function writeWithRetry(filePath, data, attempts = 10, baseDelayMs = 300) {
  for (let i = 0; i < attempts; i++) {
    try {
      fs.writeFileSync(filePath, data);
      return;
    } catch (e) {
      if (e.code !== 'EBUSY' || i === attempts - 1) throw e;
      const delay = baseDelayMs * (i + 1);
      process.stderr.write(`[patch-exe] File busy (attempt ${i + 1}/${attempts}), retrying in ${delay}ms...\n`);
      await new Promise(r => setTimeout(r, delay));
    }
  }
}

await writeWithRetry(EXE, outData);
console.log('[patch-exe] Done.');
