import { execSync } from 'child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const webviewDir = resolve(root, 'webview');
// Runtime must live INSIDE src-tauri/ so the path has no "../" prefix.
// Any "../" in fixedRuntime.path causes NSIS to place files via _up_/ (above $INSTDIR),
// which breaks the runtime lookup relative to the exe.
const runtimeBase = resolve(root, 'src-tauri', 'WebView2');
const tauriConf = resolve(root, 'src-tauri', 'tauri.conf.json');

// Pick the highest-version CAB present in webview/
const cabs = readdirSync(webviewDir)
  .filter(f => f.startsWith('Microsoft.WebView2.FixedVersionRuntime') && f.endsWith('.cab'))
  .sort().reverse();

if (cabs.length === 0) {
  console.error('No WebView2 FixedVersionRuntime .cab found in', webviewDir);
  process.exit(1);
}

const cab = resolve(webviewDir, cabs[0]);
console.log(`Using CAB: ${cabs[0]}`);

// Extract if not already done
if (!existsSync(runtimeBase)) {
  console.log('Extracting WebView2 fixed runtime into src-tauri/WebView2/ ...');
  mkdirSync(runtimeBase, { recursive: true });
  execSync(`expand "${cab}" -F:* "${runtimeBase}"`, { stdio: 'inherit' });
  console.log('Extraction complete.');
} else {
  console.log('src-tauri/WebView2/ already present, skipping extraction.');
}

// Locate the versioned subdirectory (e.g. Microsoft.WebView2.FixedVersionRuntime.147.0.3912.98.x64)
const subdirs = readdirSync(runtimeBase)
  .filter(e => e.startsWith('Microsoft.WebView2.FixedVersionRuntime'))
  .sort().reverse();

if (subdirs.length === 0) {
  console.error('No runtime subdirectory found in', runtimeBase);
  process.exit(1);
}

// Relative to src-tauri/ — no leading "../", so NSIS installs it inside $INSTDIR
const runtimeRelPath = `WebView2/${subdirs[0]}`;
console.log(`fixedRuntime.path = ${runtimeRelPath}  (installed at $INSTDIR\\${runtimeRelPath.replace(/\//g, '\\')})`);

// Patch tauri.conf.json in-place so both tauri_build::build() (build.rs) and the CLI see it
const originalConf = readFileSync(tauriConf, 'utf8');
const conf = JSON.parse(originalConf);
conf.bundle.windows = conf.bundle.windows ?? {};
conf.bundle.windows.webviewInstallMode = { type: 'fixedRuntime', path: runtimeRelPath };
writeFileSync(tauriConf, JSON.stringify(conf, null, 2) + '\n');
console.log('tauri.conf.json patched.');

try {
  execSync('npx tauri build', { stdio: 'inherit', cwd: root });
} finally {
  writeFileSync(tauriConf, originalConf);
  console.log('tauri.conf.json restored.');
}
