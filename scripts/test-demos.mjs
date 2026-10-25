/**
 * Starts the FastAPI and Java demo APIs (unless already running), verifies
 * every advertised status code, loads both OpenAPI documents, and executes
 * GET /status/418 through the Tampermonkey userscript in Chromium.
 *
 *   npm run test:demos
 */
import { chromium } from '@playwright/test';
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const root = resolve(here, '..');
const userscript = resolve(root, 'routecraft.user.js');
const codes = [200, 201, 202, 204, 301, 400, 401, 403, 404, 409, 418, 422, 429, 500, 502, 503];
const demos = [
  { name: 'FastAPI', origin: 'http://127.0.0.1:8010', title: 'FastAPI Status Codes Demo' },
  { name: 'Java', origin: 'http://127.0.0.1:8011', title: 'Java Status Codes Demo' },
];
const children = [];

if (!existsSync(userscript)) throw new Error('routecraft.user.js is missing. Run npm run build:userscript.');
const source = readFileSync(userscript, 'utf8');

async function ready(url) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(2000) });
    return response.status > 0;
  } catch {
    return false;
  }
}

async function waitReady(url, label) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (await ready(url)) return;
    await new Promise((resolveWait) => setTimeout(resolveWait, 150));
  }
  throw new Error(`${label} did not start at ${url}.`);
}

async function startDemos() {
  if (!(await ready(`${demos[0].origin}/codes`))) {
    const fastapi = spawn(
      'python',
      ['-m', 'uvicorn', 'main:app', '--host', '127.0.0.1', '--port', '8010'],
      { cwd: resolve(root, 'demos', 'fastapi'), stdio: 'ignore' },
    );
    children.push(fastapi);
    await waitReady(`${demos[0].origin}/codes`, 'FastAPI demo');
  }

  if (!(await ready(`${demos[1].origin}/codes`))) {
    const javaSource = resolve(root, 'demos', 'java', 'RouteCraftJavaDemo.java');
    const javaClass = resolve(root, 'demos', 'java', 'bin', 'RouteCraftJavaDemo.class');
    if (!existsSync(javaClass) || statSync(javaSource).mtimeMs > statSync(javaClass).mtimeMs) {
      execFileSync('javac', ['-encoding', 'UTF-8', '-d', resolve(root, 'demos', 'java', 'bin'), javaSource], {
        cwd: root,
        stdio: 'inherit',
      });
    }
    const java = spawn('java', ['-cp', resolve(root, 'demos', 'java', 'bin'), 'RouteCraftJavaDemo', '8011'], {
      cwd: root,
      stdio: 'ignore',
    });
    children.push(java);
    await waitReady(`${demos[1].origin}/codes`, 'Java demo');
  }
}

async function checkApi(demo) {
  for (const code of codes) {
    const response = await fetch(`${demo.origin}/status/${code}`, { redirect: 'manual' });
    if (response.status !== code) {
      throw new Error(`${demo.name} /status/${code} returned ${response.status}.`);
    }
  }
  const specResponse = await fetch(`${demo.origin}/openapi.json`);
  const spec = await specResponse.json();
  if (spec.info?.title !== demo.title) throw new Error(`${demo.name} spec title is ${spec.info?.title}.`);
  for (const path of ['/codes', '/status/{code}', '/items', '/secure', '/echo']) {
    if (!spec.paths?.[path]) throw new Error(`${demo.name} spec is missing ${path}.`);
  }
  console.log(`${demo.name}: ${codes.length} status codes and ${Object.keys(spec.paths).length} paths verified.`);
}

async function installShim(page) {
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
      return { status: response.status, statusText: response.statusText, headers, rawText, finalUrl: response.url };
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
        .__gmFetch({ url: details.url, method: details.method, headers: details.headers, body: details.data })
        .then((result) => {
          if (result.error) {
            details.onerror?.({ statusText: result.error });
            return;
          }
          details.onload?.({
            status: result.status,
            statusText: result.statusText,
            responseHeaders: Object.entries(result.headers || {})
              .map(([key, value]) => `${key}: ${value}`)
              .join('\r\n'),
            responseText: result.rawText,
            finalUrl: result.finalUrl,
          });
        })
        .catch((error) => details.onerror?.({ statusText: String(error) }));
    };
  });
}

async function checkUi(browser, demo) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  try {
    await installShim(page);
    await page.goto(`${demo.origin}/docs`, { waitUntil: 'domcontentloaded' });
    await page.addScriptTag({ content: source });
    await page.getByRole('button', { name: 'Open RouteCraft' }).click();
    await page.getByTestId('spec-title').waitFor({ timeout: 20000 });
    const title = (await page.getByTestId('spec-title').textContent())?.trim();
    if (title !== demo.title) throw new Error(`${demo.name} UI loaded "${title}" instead of "${demo.title}".`);

    await page.getByTestId('operation-get-/status/{code}').click();
    await page.getByTestId('try-it-out-get-/status/{code}').click();
    await page.getByTestId('param-path-code').fill('418');
    await page.getByTestId('send-get-/status/{code}').click();
    await page.locator('.status-pill').filter({ hasText: '418' }).waitFor({ timeout: 15000 });
    console.log(`${demo.name}: UI loaded the spec and received 418 I'm a Teapot.`);
    const shots = resolve(root, 'test-results');
    mkdirSync(shots, { recursive: true });
    await page.screenshot({ path: resolve(shots, `userscript-${demo.name.toLowerCase()}.png`) });
    if (errors.length) throw new Error(`${demo.name} page errors: ${errors.join(' | ')}`);
  } finally {
    await page.close();
  }
}

await startDemos();
for (const demo of demos) await checkApi(demo);

const browser = await chromium.launch({ channel: 'chromium', headless: true });
try {
  for (const demo of demos) await checkUi(browser, demo);
} finally {
  await browser.close();
  for (const child of children) {
    try {
      child.kill();
    } catch {
      /* ignore */
    }
  }
}

console.log('\nStatus code URLs:');
for (const demo of demos) {
  console.log(`  ${demo.name}: ${codes.map((code) => `${demo.origin}/status/${code}`).join(' ')}`);
}
console.log('\nDemo API test passed.');
