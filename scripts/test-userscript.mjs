/**
 * Smoke-tests the generated Tampermonkey userscript in Chromium.
 *
 * It installs a GM_xmlhttpRequest shim backed by Node's fetch (the same
 * privilege boundary Tampermonkey gives the script), loads the userscript on
 * the FastAPI demo docs page, verifies auto-detection, and proves that a
 * cross-origin request without CORS headers succeeds through the userscript.
 *
 *   npm run build:userscript
 *   node scripts/test-userscript.mjs
 */
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const root = resolve(here, '..');
const userscript = resolve(root, 'routecraft.user.js');
const apiOrigin = 'http://127.0.0.1:4010';
const noCorsPort = 4011;
const noCorsOrigin = `http://127.0.0.1:${noCorsPort}`;
const children = [];

if (!existsSync(userscript)) throw new Error('routecraft.user.js is missing. Run npm run build:userscript.');
const source = readFileSync(userscript, 'utf8');

async function ready(url) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(2000) });
    return response.ok;
  } catch {
    return false;
  }
}

async function waitReady(url, label) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (await ready(url)) return;
    await new Promise((resolveWait) => setTimeout(resolveWait, 150));
  }
  throw new Error(`${label} did not start at ${url}.`);
}

if (!(await ready(`${apiOrigin}/health`))) {
  const mock = spawn(process.execPath, ['tests/api/server.mjs'], { cwd: root, stdio: 'ignore' });
  children.push(mock);
  await waitReady(`${apiOrigin}/health`, 'Mock API');
}

// A deliberately CORS-free endpoint on a different origin. Browser fetch must
// fail here, while the userscript's GM_xmlhttpRequest bridge must succeed.
const noCorsServer = createServer((_request, response) => {
  response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify({ proxied: true, message: 'No CORS headers on this response.' }));
});
await new Promise((resolveListen, rejectListen) => {
  noCorsServer.once('error', rejectListen);
  noCorsServer.listen(noCorsPort, '127.0.0.1', resolveListen);
});

const browser = await chromium.launch({ channel: 'chromium', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
const errors = [];

try {
  page.on('pageerror', (error) => errors.push(error.message));

  // Simulate the privileged Tampermonkey network layer with Node's fetch.
  await page.exposeFunction('__gmFetch', async (request) => {
    try {
      const response = await fetch(request.url, {
        method: request.method || 'GET',
        headers: request.headers || {},
        body: ['GET', 'HEAD'].includes(String(request.method || 'GET').toUpperCase()) ? undefined : request.body,
        redirect: 'follow',
        signal: AbortSignal.timeout(30000),
      });
      const rawText = await response.text();
      const headers = {};
      response.headers.forEach((value, key) => {
        headers[key] = value;
      });
      return {
        status: response.status,
        statusText: response.statusText,
        headers,
        rawText,
        finalUrl: response.url,
      };
    } catch (error) {
      return { error: String(error) };
    }
  });

  await page.addInitScript(() => {
    window.GM_getValue = (key, fallback) => {
      const value = localStorage.getItem(`__gm__${key}`);
      return value === null ? fallback : value;
    };
    window.GM_setValue = (key, value) => localStorage.setItem(`__gm__${key}`, String(value));
    window.GM_deleteValue = (key) => localStorage.removeItem(`__gm__${key}`);
    window.GM_xmlhttpRequest = (details) => {
      window
        .__gmFetch({
          url: details.url,
          method: details.method,
          headers: details.headers,
          body: details.data,
        })
        .then((result) => {
          if (result.error) {
            details.onerror?.({ statusText: result.error });
            return;
          }
          const responseHeaders = Object.entries(result.headers || {})
            .map(([key, value]) => `${key}: ${value}`)
            .join('\r\n');
          details.onload?.({
            status: result.status,
            statusText: result.statusText,
            responseHeaders,
            responseText: result.rawText,
            finalUrl: result.finalUrl,
          });
        })
        .catch((error) => details.onerror?.({ statusText: String(error) }));
    };
  });

  await page.goto(`${apiOrigin}/docs`, { waitUntil: 'domcontentloaded' });
  await page.addScriptTag({ content: source });
  await page.waitForFunction(() => !!document.getElementById('routecraft-userscript-host'), null, { timeout: 15000 });

  const directFetch = await page.evaluate(async (target) => {
    try {
      const response = await fetch(target);
      return `HTTP ${response.status}`;
    } catch (error) {
      return `blocked: ${error instanceof Error ? error.message : String(error)}`;
    }
  }, `${noCorsOrigin}/no-cors`);
  if (!directFetch.startsWith('blocked:')) {
    throw new Error(`Expected the browser to block the cross-origin request, got ${directFetch}.`);
  }
  console.log('Direct browser fetch:', directFetch.slice(0, 80));

  await page.keyboard.press('Alt+Shift+S');
  await page.getByTestId('spec-title').waitFor({ timeout: 20000 });
  const title = (await page.getByTestId('spec-title').textContent())?.trim();
  if (!title?.includes('FastAPI Demo')) {
    throw new Error(`Auto-detected the wrong spec: ${title}`);
  }
  console.log('Auto-detected spec:', title);

  // Theme variables must be scoped to the shadow host, not the page's html.
  await page.getByTestId('theme-toggle').click();
  await page.getByTestId('theme-toggle').click();
  const theme = await page.evaluate(() => {
    const host = document.getElementById('routecraft-userscript-host');
    const root = host?.shadowRoot?.getElementById('root');
    return {
      host: host?.dataset.theme,
      page: document.documentElement.dataset.theme ?? null,
      background: root ? getComputedStyle(root).backgroundColor : '',
    };
  });
  if (theme.host !== 'dark' || theme.page !== null || theme.background !== 'rgb(12, 17, 24)') {
    throw new Error(`Shadow theme was not isolated: ${JSON.stringify(theme)}`);
  }
  console.log('Shadow theme:', theme.host, theme.background);

  // The userscript bridge must bypass CORS for a response with no CORS headers.
  await page.getByTestId('nav-request').click();
  await page.getByTestId('composer-url').fill(`${noCorsOrigin}/no-cors`);
  await page.getByTestId('composer-send').click();
  await page.locator('.status-pill').waitFor({ timeout: 15000 });
  const status = (await page.locator('.status-pill').textContent())?.trim();
  const responseBody = (await page.locator('.response').textContent()) || '';
  if (!status?.startsWith('200')) throw new Error(`Userscript proxy returned ${status}.`);
  if (!responseBody.includes('proxied')) throw new Error('The no-CORS response body was not rendered.');
  console.log('No-CORS request through userscript:', status);

  // Execute a normal endpoint and a non-2xx endpoint from the docs view.
  await page.getByTestId('nav-docs').click();
  await page.getByTestId('operation-get-/pets').click();
  await page.getByTestId('try-it-out-get-/pets').click();
  await page.getByTestId('send-get-/pets').click();
  await page.locator('.status-pill').filter({ hasText: '200' }).waitFor({ timeout: 15000 });
  console.log('Docs execution status: 200');

  await page.getByTestId('operation-get-/pets/{petId}').click();
  await page.getByTestId('try-it-out-get-/pets/{petId}').click();
  await page.getByTestId('param-path-petId').fill('999');
  await page.getByTestId('send-get-/pets/{petId}').click();
  await page.locator('.status-pill').filter({ hasText: '404' }).waitFor({ timeout: 15000 });
  console.log('Docs execution status: 404');

  // Escape closes the overlay without destroying the app state.
  await page.keyboard.press('Escape');
  const hidden = await page.evaluate(() => {
    const host = document.getElementById('routecraft-userscript-host');
    return {
      host: host ? getComputedStyle(host).display : 'missing',
      launcher: document.getElementById('routecraft-userscript-launcher-host') ? 'present' : 'missing',
      roots: host?.shadowRoot?.querySelectorAll('#root').length ?? 0,
    };
  });
  if (hidden.host !== 'none' || hidden.launcher !== 'missing' || hidden.roots !== 1) {
    throw new Error(`Unexpected overlay state after close: ${JSON.stringify(hidden)}`);
  }
  console.log('Closed overlay; single app root remains, no floating launcher:', hidden.roots);

  if (errors.length) throw new Error(`Page errors: ${errors.join(' | ')}`);
  console.log('Userscript smoke test passed.');
} finally {
  await browser.close();
  await new Promise((resolveClose) => noCorsServer.close(resolveClose));
  for (const child of children) {
    try {
      child.kill();
    } catch {
      /* ignore */
    }
  }
}
