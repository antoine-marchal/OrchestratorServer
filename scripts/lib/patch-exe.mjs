// Shared Windows-exe resource patcher for the pkg-built binaries
// (orchestrator-server-win.exe, orchestrator-worker-win.exe). The caller passes
// its own `resedit` import (ESM bare specifiers resolve from the importing
// file's node_modules, and this lib lives at the repo root with none) plus the
// per-binary identity strings.
import path from 'path';
import fs from 'fs';

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

/**
 * Patch version info + icon into a pkg-built Windows exe.
 * @param {*} ResEdit  the caller's `import * as ResEdit from 'resedit'`
 * @param {object} opts
 * @param {string} opts.scriptDir         the calling script's directory (used to find ../package.json and ../assets/icon.ico)
 * @param {string} opts.exePath           absolute path to the exe to patch
 * @param {string} opts.fileDescription   FileDescription resource string
 * @param {string} opts.originalFilename  OriginalFilename resource string
 * @param {string} opts.internalName      InternalName resource string
 * @param {string} [opts.productName]     ProductName (default 'Orchestrator')
 * @param {string} [opts.companyName]     CompanyName / copyright holder (default 'Antoine Marchal')
 */
export async function patchExe(ResEdit, {
  scriptDir,
  exePath,
  fileDescription,
  originalFilename,
  internalName,
  productName = 'Orchestrator',
  companyName = 'Antoine Marchal',
}) {
  const pkg = JSON.parse(fs.readFileSync(path.resolve(scriptDir, '../package.json'), 'utf8'));
  const [major, minor, patch] = (pkg.version || '1.0.0').split('.').map(Number);
  const ICON = path.resolve(scriptDir, '../assets/icon.ico');

  if (!fs.existsSync(exePath)) {
    console.error(`[patch-exe] Exe not found: ${exePath}`);
    process.exit(1);
  }

  const FILE_VERSION    = [major, minor, patch, 0];
  const PRODUCT_VERSION = [major, minor, patch, 0];
  const LANG = 1033;     // English (US)
  const CODEPAGE = 1200; // UTF-16 LE

  console.log('[patch-exe] Reading exe...');
  const exeData = fs.readFileSync(exePath);
  const exe = ResEdit.NtExecutable.from(exeData, { ignoreCert: true });
  const res = ResEdit.NtExecutableResource.from(exe);

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
    FileDescription:  fileDescription,
    ProductName:      productName,
    CompanyName:      companyName,
    LegalCopyright:   `Copyright (c) ${new Date().getFullYear()} ${companyName}`,
    OriginalFilename: originalFilename,
    InternalName:     internalName,
    FileVersion:      FILE_VERSION.slice(0, 3).join('.'),
    ProductVersion:   PRODUCT_VERSION.slice(0, 3).join('.'),
  });

  res.entries = res.entries.filter(e => e.type !== 16 /* RT_VERSION */);
  viList.forEach(v => v.outputToResourceEntries(res.entries));

  if (fs.existsSync(ICON)) {
    console.log('[patch-exe] Applying icon...');
    const iconData = fs.readFileSync(ICON);
    // Slice to the exact bytes: a Buffer may be a view into a larger pooled
    // ArrayBuffer (non-zero byteOffset), so `.buffer` alone is not the file.
    const iconFile = ResEdit.Data.IconFile.from(
      iconData.buffer.slice(iconData.byteOffset, iconData.byteOffset + iconData.byteLength),
    );
    if (iconFile.icons.length === 0) {
      throw new Error(`[patch-exe] No icon images parsed from ${ICON}`);
    }
    ResEdit.Resource.IconGroupEntry.replaceIconsForResource(
      res.entries, 1, LANG,
      iconFile.icons.map(i => i.data),
    );
  } else {
    console.warn('[patch-exe] No icon found at assets/icon.ico — skipping.');
  }

  res.outputResource(exe);
  const outData = Buffer.from(exe.generate());

  await writeWithRetry(exePath, outData);
  console.log('[patch-exe] Done.');
}
