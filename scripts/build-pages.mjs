/**
 * Assemble the GitHub Pages site into docs/.
 *
 * GitHub Pages serves this folder from the main branch. The landing page lives
 * in site/, the web app is the production build at /app/, and the userscript is
 * copied to the site root so Tampermonkey can install it from github.io.
 */
import { copyFileSync, cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const root = resolve(here, '..');
const docs = resolve(root, 'docs');

const required = [
  resolve(root, 'dist', 'index.html'),
  resolve(root, 'routecraft.user.js'),
  resolve(root, 'site', 'index.html'),
  resolve(root, 'public', 'icons', 'icon128.png'),
  resolve(root, 'screenshots', 'docs-light.png'),
  resolve(root, 'screenshots', 'composer-dark.png'),
];

for (const file of required) {
  if (!existsSync(file)) {
    throw new Error(`Missing ${file}. Run npm run build && npm run build:userscript first.`);
  }
}

rmSync(docs, { recursive: true, force: true });
mkdirSync(docs, { recursive: true });

cpSync(resolve(root, 'site'), docs, { recursive: true });
cpSync(resolve(root, 'dist'), resolve(docs, 'app'), { recursive: true });
copyFileSync(resolve(root, 'routecraft.user.js'), resolve(docs, 'routecraft.user.js'));
copyFileSync(resolve(root, 'public', 'icons', 'icon128.png'), resolve(docs, 'icon128.png'));
copyFileSync(resolve(root, 'screenshots', 'docs-light.png'), resolve(docs, 'screenshot-light.png'));
copyFileSync(resolve(root, 'screenshots', 'composer-dark.png'), resolve(docs, 'screenshot-dark.png'));
writeFileSync(resolve(docs, '.nojekyll'), '');

console.log('Wrote docs/');
console.log('  landing:    index.html');
console.log('  web app:    app/');
console.log('  userscript: routecraft.user.js');
