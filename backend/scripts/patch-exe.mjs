import * as ResEdit from 'resedit';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const EXE  = path.resolve(__dirname, '../dist/orchestrator-backend.exe');
const ICON = path.resolve(__dirname, '../assets/icon.ico');

if (!fs.existsSync(EXE)) {
  console.error(`[patch-exe] Exe not found: ${EXE}`);
  process.exit(1);
}

const FILE_VERSION    = [1, 5, 0, 0];
const PRODUCT_VERSION = [1, 5, 0, 0];
const LANG = 1033;      // English (US)
const CODEPAGE = 1200;  // UTF-16 LE

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
  FileDescription:  'Orchestrator Backend Server',
  ProductName:      'Orchestrator',
  CompanyName:      'Antoine Marchal',
  LegalCopyright:   `Copyright (c) ${new Date().getFullYear()} Antoine Marchal`,
  OriginalFilename: 'orchestrator-backend.exe',
  InternalName:     'orchestrator-backend',
  FileVersion:      FILE_VERSION.join('.'),
  ProductVersion:   PRODUCT_VERSION.join('.'),
});

// Remove old version entries then write updated ones
res.entries = res.entries.filter(e => e.type !== 16 /* RT_VERSION */);
viList.forEach(v => v.outputToResourceEntries(res.entries));

// --- Icon ---
if (fs.existsSync(ICON)) {
  console.log('[patch-exe] Applying icon...');
  const iconData = fs.readFileSync(ICON);
  const iconFile = ResEdit.Data.IconFile.from(iconData.buffer);
  ResEdit.Resource.IconGroupEntry.replaceIconsForResource(
    res.entries,
    1,       // icon group ID
    LANG,
    iconFile.icons.map(i => i.data),
  );
} else {
  console.warn('[patch-exe] No icon at assets/icon.ico — skipping. Add one to include it.');
}

// Write back
res.outputResource(exe);
const outData = Buffer.from(exe.generate());
fs.writeFileSync(EXE, outData);
console.log('[patch-exe] Done.');
