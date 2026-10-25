/**
 * Packages the production build as a Chrome Web Store upload.
 *
 *   npm run build
 *   npm run package:extension
 */
import { createWriteStream } from 'node:fs';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ZipArchive } from 'archiver';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const dist = resolve(root, 'dist');
const out = resolve(root, 'routecraft-extension.zip');

mkdirSync(dirname(out), { recursive: true });

const output = createWriteStream(out);
const archive = new ZipArchive({ zlib: { level: 9 } });

await new Promise((resolvePromise, reject) => {
  output.on('close', resolvePromise);
  output.on('error', reject);
  archive.on('warning', (error) => {
    if (error.code === 'ENOENT') console.warn(error.message);
    else reject(error);
  });
  archive.on('error', reject);
  archive.pipe(output);
  // `false` keeps manifest.json at the archive root, which the Web Store and
  // Chrome's "Load unpacked" both require.
  archive.directory(dist, false);
  archive.finalize();
});

console.log(`Wrote ${out} (${Math.round(archive.pointer() / 1024)} KB)`);
