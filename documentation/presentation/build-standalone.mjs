#!/usr/bin/env node
/**
 * build-standalone.mjs — produit une version autonome (un seul fichier) de la
 * présentation Orchestrator.
 *
 * Ce que fait le script :
 *   1. Lit  "Orchestrator Presentation.html"
 *   2. Inline le contenu de deck-stage.js  (<script src> → <script> … </script>)
 *   3. (par défaut) Télécharge la feuille Google Fonts + chaque .woff2 et les
 *      encode en data-URI base64, pour un rendu hors-ligne identique.
 *   4. Inline les éventuelles captures référencées (<img src="screenshots/…">)
 *      si les fichiers existent localement.
 *   5. Écrit "Orchestrator Presentation - Standalone.html"
 *
 * Usage :
 *   node build-standalone.mjs                 # tout inliner (réseau requis pour les fonts)
 *   node build-standalone.mjs --no-fonts      # garder le <link> Google Fonts (CDN)
 *   node build-standalone.mjs --in "x.html" --out "y.html"
 *
 * Node ≥ 18 requis (fetch global).
 */

import { readFile, writeFile, access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

// ── args ────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const getOpt = (name, def) => {
  const i = args.indexOf(name);
  return i !== -1 && args[i + 1] ? args[i + 1] : def;
};
const NO_FONTS = args.includes('--no-fonts');
const IN_FILE  = resolve(HERE, getOpt('--in',  'Orchestrator Presentation.html'));
const OUT_FILE = resolve(HERE, getOpt('--out', 'Orchestrator Presentation - Standalone.html'));
const DECK_JS  = resolve(HERE, 'deck-stage.js');

const log = (...m) => console.log('[standalone]', ...m);

const exists = async (p) => { try { await access(p, constants.R_OK); return true; } catch { return false; } };

const MIME = {
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.otf': 'font/otf',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml',
};
const mimeFor = (url) => {
  const m = url.toLowerCase().match(/\.[a-z0-9]+(?=$|[?#])/);
  return (m && MIME[m[0]]) || 'application/octet-stream';
};

// ── inline Google Fonts → data-URIs ─────────────────────────────────────────
async function inlineFonts(html) {
  // match: <link ... href="https://fonts.googleapis.com/css2?...">
  const linkRe = /<link[^>]+href="(https:\/\/fonts\.googleapis\.com\/css2[^"]+)"[^>]*>/i;
  const m = html.match(linkRe);
  if (!m) { log('aucun <link> Google Fonts trouvé — rien à inliner'); return html; }
  const cssUrl = m[1].replace(/&amp;/g, '&');

  log('téléchargement de la CSS Google Fonts …');
  // UA "navigateur" pour obtenir des woff2 modernes
  const cssRes = await fetch(cssUrl, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36' },
  });
  if (!cssRes.ok) throw new Error(`CSS HTTP ${cssRes.status}`);
  let css = await cssRes.text();

  // collecte des url(...) uniques
  const urls = [...new Set([...css.matchAll(/url\((https:\/\/[^)]+)\)/g)].map((x) => x[1]))];
  log(`${urls.length} fichiers de police à inliner …`);
  for (const u of urls) {
    const r = await fetch(u);
    if (!r.ok) { log(`  ! échec ${u} (HTTP ${r.status}) — laissé tel quel`); continue; }
    const buf = Buffer.from(await r.arrayBuffer());
    const dataUri = `data:${mimeFor(u)};base64,${buf.toString('base64')}`;
    css = css.split(u).join(dataUri);
  }

  // supprime les autres <link> fonts (preconnect/preload) + remplace le css2
  let out = html
    .replace(/<link[^>]+rel="preconnect"[^>]*>\s*/gi, '')
    .replace(linkRe, `<style>\n${css}\n</style>`);
  log('fonts inlinées ✔');
  return out;
}

// ── inline <img src="screenshots/…"> locales ────────────────────────────────
async function inlineImages(html) {
  const imgRe = /<img([^>]*?)src="([^"]+)"([^>]*?)>/gi;
  const tasks = [];
  html.replace(imgRe, (full, pre, src, post) => {
    if (/^(data:|https?:)/i.test(src)) return full;
    tasks.push({ full, src });
    return full;
  });
  if (!tasks.length) return html;
  for (const t of tasks) {
    const p = join(HERE, t.src);
    if (!(await exists(p))) { log(`  ! image absente ${t.src} — laissée telle quelle`); continue; }
    const buf = await readFile(p);
    const dataUri = `data:${mimeFor(t.src)};base64,${buf.toString('base64')}`;
    html = html.split(`"${t.src}"`).join(`"${dataUri}"`);
    log(`  image inlinée ${t.src}`);
  }
  return html;
}

// ── main ─────────────────────────────────────────────────────────────────────
async function main() {
  if (!(await exists(IN_FILE))) throw new Error(`introuvable : ${IN_FILE}`);
  if (!(await exists(DECK_JS))) throw new Error(`introuvable : ${DECK_JS}`);

  let html = await readFile(IN_FILE, 'utf8');
  const deck = await readFile(DECK_JS, 'utf8');

  // 1. inline deck-stage.js  (échappe </script> pour ne pas casser le parseur)
  const deckSafe = deck.replace(/<\/script>/gi, '<\\/script>');
  const scriptRe = /<script\s+src="deck-stage\.js"\s*><\/script>/i;
  if (!scriptRe.test(html)) throw new Error('balise <script src="deck-stage.js"> introuvable');
  html = html.replace(scriptRe, `<script>\n${deckSafe}\n</script>`);
  log('deck-stage.js inliné ✔');

  // 2. images locales
  html = await inlineImages(html);

  // 3. fonts
  if (NO_FONTS) {
    log('--no-fonts : le <link> Google Fonts reste sur le CDN');
  } else {
    try { html = await inlineFonts(html); }
    catch (e) { log(`! inline fonts échoué (${e.message}) — CDN conservé. Relancer avec --no-fonts pour ignorer.`); }
  }

  // 4. bannière
  const banner = `<!-- Généré par build-standalone.mjs le ${new Date().toISOString()} — NE PAS éditer à la main. -->\n`;
  html = html.replace(/<!DOCTYPE html>/i, `<!DOCTYPE html>\n${banner}`);

  await writeFile(OUT_FILE, html, 'utf8');
  const kb = (Buffer.byteLength(html, 'utf8') / 1024).toFixed(1);
  log(`écrit : ${OUT_FILE} (${kb} Ko)`);
}

main().catch((e) => { console.error('[standalone] ÉCHEC :', e.message); process.exit(1); });
