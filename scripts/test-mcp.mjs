/**
 * End-to-end test for the RouteCraft MCP server.
 *
 * It starts the repository's mock API, connects to mcp/server.mjs over stdio,
 * exercises the MCP tools, then loads the server-rendered RouteCraft page in
 * Chromium. The page receives a bridge from the MCP server, so a request to a
 * deliberately CORS-free origin must succeed without the extension/userscript.
 *
 *   npm run build
 *   node scripts/test-mcp.mjs
 */
import { chromium } from '@playwright/test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const root = resolve(here, '..');
const serverPath = resolve(root, 'mcp', 'server.mjs');
const apiOrigin = 'http://127.0.0.1:4010';
const noCorsPort = 4011;
const noCorsOrigin = `http://127.0.0.1:${noCorsPort}`;
const mcpPort = Number(process.env.ROUTECRAFT_TEST_PORT || 4299);
const children = [];

if (!existsSync(resolve(root, 'dist', 'index.html'))) {
  throw new Error('dist/index.html is missing. Run npm run build before test:mcp.');
}

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

function resultText(result) {
  if (result.isError) {
    throw new Error(result.content?.map((item) => item.text).filter(Boolean).join('\n') || 'MCP tool failed.');
  }
  return (result.content || [])
    .filter((item) => item.type === 'text')
    .map((item) => item.text)
    .join('\n');
}

if (!(await ready(`${apiOrigin}/health`))) {
  const mock = spawn(process.execPath, ['tests/api/server.mjs'], { cwd: root, stdio: 'ignore' });
  children.push(mock);
  await waitReady(`${apiOrigin}/health`, 'Mock API');
}

const noCorsServer = createServer((_request, response) => {
  response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify({ proxied: true, message: 'No CORS headers on this response.' }));
});
await new Promise((resolveListen, rejectListen) => {
  noCorsServer.once('error', rejectListen);
  noCorsServer.listen(noCorsPort, '127.0.0.1', resolveListen);
});

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [serverPath],
  cwd: root,
  env: {
    ...process.env,
    ROUTECRAFT_PORT: String(mcpPort),
    ROUTECRAFT_NO_BROWSER: '1',
  },
  stderr: 'inherit',
});
const client = new Client({ name: 'routecraft-mcp-test', version: '1.0.0' });
const browser = await chromium.launch({ channel: 'chromium', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
const errors = [];

try {
  page.on('pageerror', (error) => errors.push(error.message));

  await client.connect(transport);
  console.log('MCP connected.');

  const toolList = await client.listTools();
  const toolNames = toolList.tools.map((tool) => tool.name).sort();
  for (const required of ['close_swagger', 'http_request', 'inspect_spec', 'open_swagger']) {
    if (!toolNames.includes(required)) throw new Error(`MCP tool ${required} is missing.`);
  }
  console.log('MCP tools:', toolNames.join(', '));

  const inspect = await client.callTool({
    name: 'inspect_spec',
    arguments: { specUrl: `${apiOrigin}/openapi.json` },
  });
  const summary = JSON.parse(resultText(inspect));
  if (summary.title !== 'FastAPI Demo') throw new Error(`Unexpected spec title: ${summary.title}`);
  if (!summary.operations.some((operation) => operation.method === 'GET' && operation.path === '/pets')) {
    throw new Error('inspect_spec did not list GET /pets.');
  }
  console.log('inspect_spec:', summary.title, `${summary.operationCount} operations`);

  const swagger = await client.callTool({
    name: 'inspect_spec',
    arguments: { specUrl: `${apiOrigin}/specs/go.json` },
  });
  const swaggerSummary = JSON.parse(resultText(swagger));
  if (!swaggerSummary.format.startsWith('Swagger 2.0') || !swaggerSummary.servers.includes('http://127.0.0.1:4010/api/v1')) {
    throw new Error(`Failed to summarize the Swagger 2.0 fixture: ${JSON.stringify(swaggerSummary)}`);
  }
  console.log('inspect_spec Swagger 2.0:', swaggerSummary.servers[0]);

  const direct = await client.callTool({
    name: 'http_request',
    arguments: { url: `${apiOrigin}/pets` },
  });
  const directResult = JSON.parse(resultText(direct));
  if (directResult.status !== 200 || !directResult.body.includes('Rex')) {
    throw new Error(`http_request returned ${directResult.status}: ${directResult.body.slice(0, 200)}`);
  }
  console.log('http_request:', directResult.status, `${directResult.latencyMs}ms`);

  const posted = await client.callTool({
    name: 'http_request',
    arguments: {
      url: `${apiOrigin}/echo`,
      method: 'POST',
      body: { from: 'mcp-test', ok: true },
    },
  });
  const postResult = JSON.parse(resultText(posted));
  if (postResult.status !== 200 || !postResult.body.includes('mcp-test')) {
    throw new Error(`http_request POST returned ${postResult.status}: ${postResult.body.slice(0, 200)}`);
  }
  console.log('http_request POST:', postResult.status);

  const opened = await client.callTool({
    name: 'open_swagger',
    arguments: {
      specUrl: `${apiOrigin}/openapi.json`,
      operation: 'GET /pets',
      openBrowser: false,
    },
  });
  const openedText = resultText(opened);
  const appUrl = openedText.match(/App URL: (\S+)/)?.[1];
  if (!appUrl) throw new Error(`open_swagger did not return an App URL:\n${openedText}`);
  const appOrigin = new URL(appUrl).origin;
  console.log('App URL:', appUrl);

  const health = await fetch(`${appOrigin}/__health`);
  if (!health.ok) throw new Error(`MCP health endpoint returned ${health.status}.`);
  const healthBody = await health.json();
  if (healthBody.service !== 'routecraft-mcp') throw new Error('Unexpected MCP health response.');

  await page.goto(appUrl, { waitUntil: 'domcontentloaded' });
  await page.getByTestId('spec-title').waitFor({ timeout: 20000 });
  const title = (await page.getByTestId('spec-title').textContent())?.trim();
  if (!title?.includes('FastAPI Demo')) throw new Error(`The MCP page loaded the wrong spec: ${title}`);
  console.log('MCP page spec:', title);

  // The ?operation= deep link must expand the matching endpoint.
  const operation = page.getByTestId('operation-get-/pets');
  await operation.waitFor({ timeout: 15000 });
  let expanded = await operation.getAttribute('aria-expanded');
  for (let attempt = 0; attempt < 40 && expanded !== 'true'; attempt += 1) {
    await page.waitForTimeout(100);
    expanded = await operation.getAttribute('aria-expanded');
  }
  if (expanded !== 'true') throw new Error('The ?operation= deep link did not expand GET /pets.');
  console.log('Deep link expanded: GET /pets');

  // Local files are served by the MCP origin, so the browser never needs a
  // file:// fetch (which Chromium blocks).
  const localSpec = resolve(root, 'tests', 'api', 'fixtures', 'fastapi.json');
  const localOpened = await client.callTool({
    name: 'open_swagger',
    arguments: {
      specUrl: localSpec,
      openBrowser: false,
      operation: 'GET /pets/{petId}',
    },
  });
  const localText = resultText(localOpened);
  const localAppUrl = localText.match(/App URL: (\S+)/)?.[1];
  if (!localAppUrl || !decodeURIComponent(localAppUrl).includes('/__spec/')) {
    throw new Error(`open_swagger did not serve the local spec:\n${localText}`);
  }
  await page.goto(localAppUrl, { waitUntil: 'domcontentloaded' });
  await page.getByTestId('spec-title').waitFor({ timeout: 20000 });
  const localTitle = (await page.getByTestId('spec-title').textContent())?.trim();
  if (!localTitle?.includes('FastAPI Demo')) throw new Error(`Local spec loaded incorrectly: ${localTitle}`);
  const localOperation = page.getByTestId('operation-get-/pets/{petId}');
  await localOperation.waitFor({ timeout: 15000 });
  let localExpanded = await localOperation.getAttribute('aria-expanded');
  for (let attempt = 0; attempt < 40 && localExpanded !== 'true'; attempt += 1) {
    await page.waitForTimeout(100);
    localExpanded = await localOperation.getAttribute('aria-expanded');
  }
  if (localExpanded !== 'true') throw new Error('The local spec deep link did not expand GET /pets/{petId}.');
  console.log('Local spec loaded and deep-linked:', localTitle);

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

  // The injected bridge must route through the MCP server and bypass CORS.
  await page.getByTestId('nav-request').click();
  await page.getByTestId('composer-url').fill(`${noCorsOrigin}/no-cors`);
  await page.getByTestId('composer-send').click();
  await page.locator('.status-pill').waitFor({ timeout: 15000 });
  const status = (await page.locator('.status-pill').textContent())?.trim();
  const responseBody = (await page.locator('.response').textContent()) || '';
  if (!status?.startsWith('200')) throw new Error(`MCP proxy returned ${status}.`);
  if (!responseBody.includes('proxied')) throw new Error('The no-CORS response body was not rendered.');
  console.log('No-CORS request through MCP proxy:', status);

  const closed = await client.callTool({ name: 'close_swagger', arguments: {} });
  resultText(closed);
  await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  let stillUp = false;
  try {
    stillUp = (await fetch(`${appOrigin}/__health`, { signal: AbortSignal.timeout(1000) })).ok;
  } catch {
    stillUp = false;
  }
  if (stillUp) throw new Error('close_swagger did not stop the local app server.');
  console.log('close_swagger stopped the app server.');

  if (errors.length) throw new Error(`Page errors: ${errors.join(' | ')}`);
  console.log('MCP smoke test passed.');
} finally {
  try {
    await client.close();
  } catch {
    /* ignore */
  }
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
