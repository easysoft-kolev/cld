// Bundles the whole site — HTML, CSS, JS and every rendered frame — into ONE file that opens with a double-click.
// Usage: npm i esbuild && node tools/build-standalone.mjs   → writes bulstroy-standalone.html
import { build } from 'esbuild';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = process.env.SITE_ROOT || resolve(dirname(fileURLToPath(import.meta.url)), '..');

const result = await build({
  entryPoints: [resolve(root, 'js/main.js')],
  bundle: true, format: 'iife', minify: true, write: false, target: 'es2020', legalComments: 'none',
});
const js = result.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const css = readFileSync(resolve(root, 'css/style.css'), 'utf8');
const favicon = 'data:image/svg+xml;base64,' + readFileSync(resolve(root, 'assets/favicon.svg')).toString('base64');

const config = readFileSync(resolve(root, 'js/config.js'), 'utf8');
const count = Number(/count:\s*(\d+)/.exec(config)[1]);
const frames = [];
for (let i = 0; i < count; i++) {
  const f = resolve(root, 'frames', `f${String(i).padStart(4, '0')}.webp`);
  frames.push(existsSync(f) ? 'data:image/webp;base64,' + readFileSync(f).toString('base64') : '');
}
const missing = frames.filter((f) => !f).length;
if (missing === count) throw new Error('no frames found in frames/ — run render/render.py first');

let html = readFileSync(resolve(root, 'index.html'), 'utf8');
html = html
  .replace('<link rel="stylesheet" href="css/style.css">', () => `<style>${css}</style>`)
  .replace('href="assets/favicon.svg"', `href="${favicon}"`)
  .replace('<script type="module" src="js/main.js"></script>', () => `<script>window.__BSG_FRAMES=${JSON.stringify(frames)};</script>\n<script>${js}</script>`);
if (/src="js\/|href="css\//.test(html)) throw new Error('unreplaced asset reference');
writeFileSync(resolve(root, 'bulstroy-standalone.html'), html);
console.log(`bulstroy-standalone.html — ${(html.length / 1048576).toFixed(1)} MB, ${count - missing}/${count} frames`);
