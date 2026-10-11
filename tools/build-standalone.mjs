// Bundles the whole site (HTML + CSS + JS + three.js) into ONE file that opens with a double-click.
// Usage: npm i esbuild && node tools/build-standalone.mjs   → writes bulstroy-standalone.html
import { build } from 'esbuild';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const threeAlias = {
  name: 'three-alias',
  setup(b) {
    b.onResolve({ filter: /^three$/ }, () => ({ path: resolve(root, 'vendor/three/build/three.module.min.js') }));
    b.onResolve({ filter: /^three\/addons\// }, (a) => ({ path: resolve(root, 'vendor/three/examples/jsm', a.path.slice('three/addons/'.length)) }));
  },
};

const result = await build({
  entryPoints: [resolve(root, 'js/main.js')],
  bundle: true, format: 'iife', minify: true, write: false, target: 'es2020', legalComments: 'none',
  plugins: [threeAlias],
});
const js = result.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const css = readFileSync(resolve(root, 'css/style.css'), 'utf8');
const favicon = 'data:image/svg+xml;base64,' + Buffer.from(readFileSync(resolve(root, 'assets/favicon.svg'))).toString('base64');

let html = readFileSync(resolve(root, 'index.html'), 'utf8');
html = html
  .replace(/<script type="importmap">[\s\S]*?<\/script>\s*/, '')
  .replace('<link rel="stylesheet" href="css/style.css">', () => `<style>${css}</style>`)
  .replace('href="assets/favicon.svg"', `href="${favicon}"`)
  .replace('<script type="module" src="js/main.js"></script>', () => `<script>${js}</script>`);
if (/src="js\/|href="css\//.test(html)) throw new Error('unreplaced asset reference');
writeFileSync(resolve(root, 'bulstroy-standalone.html'), html);
console.log(`bulstroy-standalone.html — ${(html.length / 1024).toFixed(0)} KB`);
