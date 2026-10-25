/**
 * Smoke-tests the built Chrome extension in a real Chromium profile:
 * the MV3 service worker must load, the toolbar popup must launch a protected
 * spec with a session header, and a request to an API without CORS headers must
 * succeed through the service-worker proxy.
 *
 *   npm run build
 *   node scripts/test-extension.mjs
 */
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const root = resolve(here, '..');
const extensionPath = resolve(root, 'dist');
const profile = resolve(root, '.extension-profile');
const apiOrigin = 'http://127.0.0.1:4010';

async function apiReady() {
  try {
    const response = await fetch(`${apiOrigin}/health`);
    return response.ok;
  } catch {
    return false;
  }
}

let mockApi = null;
if (!(await apiReady())) {
  mockApi = spawn(process.execPath, ['tests/api/server.mjs'], { cwd: root, stdio: 'ignore' });
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (await apiReady()) break;
    await new Promise((resolveWait) => setTimeout(resolveWait, 150));
  }
  if (!(await apiReady())) throw new Error('The mock API did not start on port 4010.');
}

rmSync(profile, { recursive: true, force: true });
mkdirSync(profile, { recursive: true });

const context = await chromium.launchPersistentContext(profile, {
  channel: 'chromium',
  headless: true,
  args: [
    `--disable-extensions-except=${extensionPath}`,
    `--load-extension=${extensionPath}`,
  ],
});

const errors = [];
try {
  let [worker] = context.serviceWorkers();
  if (!worker) worker = await context.waitForEvent('serviceworker', { timeout: 20000 });
  const extensionId = new URL(worker.url()).host;
  console.log('Service worker:', worker.url());

  const manifest = JSON.parse(readFileSync(resolve(extensionPath, 'manifest.json'), 'utf8'));
  if (manifest.action?.default_popup !== 'popup.html') {
    throw new Error('The toolbar action is missing its popup.');
  }
  if (manifest.omnibox?.keyword !== 'rc') {
    throw new Error('The omnibox keyword is missing.');
  }
  if (manifest.background?.type !== 'module') {
    throw new Error('The service worker must be a module to import the omnibox parser.');
  }
  if (!manifest.permissions?.includes('storage')) {
    throw new Error('The storage permission is required for one-time spec headers.');
  }
  console.log('Popup, omnibox and storage manifest entries present.');

  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(
    `chrome-extension://${extensionId}/index.html?url=${encodeURIComponent('http://127.0.0.1:4010/specs/fastapi.json')}`,
  );
  await page.getByTestId('spec-title').waitFor({ timeout: 20000 });
  console.log('Loaded spec:', await page.getByTestId('spec-title').textContent());

  // Normal request through the extension page.
  await page.getByTestId('operation-get-/pets').click();
  await page.getByTestId('try-it-out-get-/pets').click();
  await page.getByTestId('send-get-/pets').click();
  await page.locator('.status-pill').waitFor({ timeout: 15000 });
  console.log('Docs request status:', await page.locator('.status-pill').textContent());

  // This endpoint sends no CORS headers, which proves the service-worker proxy.
  await page.getByTestId('nav-request').click();
  await page.getByTestId('composer-url').fill('http://127.0.0.1:4010/no-cors');
  await page.getByTestId('composer-send').click();
  await page.locator('.status-pill').waitFor({ timeout: 15000 });
  console.log('CORS-free request status:', await page.locator('.status-pill').textContent());
  const body = await page.locator('.response').textContent();
  if (!body?.includes('proxied')) throw new Error('The proxied response was not rendered.');
  console.log('Proxied body rendered:', body.includes('No CORS headers'));

  // Toolbar popup: quick-launch a protected spec with a header. The header is
  // stored in chrome.storage.session by the service worker, and the app reads
  // it back for the initial spec fetch. This exercises popup -> background ->
  // session storage -> app -> FETCH_PROXY without relying on Chrome's omnibox.
  const popup = await context.newPage();
  popup.on('pageerror', (error) => errors.push(`popup: ${error.message}`));
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  await popup.locator('#target').waitFor({ timeout: 10000 });
  await popup.locator('#target').fill(
    'http://127.0.0.1:4010/protected/openapi.json -H "Authorization: Bearer demo-token"',
  );
  const protectedPagePromise = context.waitForEvent('page', { timeout: 20000 });
  await popup.locator('#quick-open button[type="submit"]').click();
  const protectedPage = await protectedPagePromise;
  protectedPage.on('pageerror', (error) => errors.push(`protected spec: ${error.message}`));
  await protectedPage.getByTestId('spec-title').waitFor({ timeout: 20000 });
  const protectedTitle = (await protectedPage.getByTestId('spec-title').textContent()) || '';
  if (!protectedTitle.includes('Protected FastAPI Demo')) {
    throw new Error(`The protected spec did not load: ${protectedTitle}`);
  }
  if (!protectedPage.url().includes('specHeadersKey=')) {
    throw new Error('The protected spec launch did not include a header key.');
  }
  console.log('Popup launch with spec header:', protectedTitle);

  if (errors.length) throw new Error(`Page errors: ${errors.join(' | ')}`);
  console.log('Extension smoke test passed.');
} finally {
  await context.close();
  rmSync(profile, { recursive: true, force: true });
  if (mockApi) mockApi.kill();
}
