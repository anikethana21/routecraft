#!/usr/bin/env node
/**
 * RouteCraft MCP server.
 *
 * It serves the built RouteCraft app from a loopback-only HTTP server and
 * injects a small request bridge into the page. The bridge uses the local
 * server as a zero-CORS transport, so an agent can open a normal browser tab
 * with a spec loaded and without installing the extension or userscript.
 *
 * MCP transport: stdio.
 * CLI shortcut:  node mcp/server.mjs open <spec-url-or-file>
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { basename, dirname, extname, isAbsolute, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const PACKAGED_DIST = resolve(HERE, 'dist');
const REPO_DIST = resolve(ROOT, 'dist');
const IS_REPO_CHECKOUT = existsSync(resolve(ROOT, 'src', 'main.tsx'));
const DIST = process.env.ROUTECRAFT_DIST
  ? resolve(process.env.ROUTECRAFT_DIST)
  : IS_REPO_CHECKOUT
    ? REPO_DIST
    : PACKAGED_DIST;
const VERSION = '0.1.0';
const requestedPort = Number(process.env.ROUTECRAFT_PORT || 4199);
const DEFAULT_PORT = Number.isInteger(requestedPort) && requestedPort > 0 && requestedPort < 65535 ? requestedPort : 4199;
const MAX_BODY_BYTES = 2 * 1024 * 1024;
const MAX_RESPONSE_CHARS = 200_000;
const HTTP_METHODS = new Set(['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace']);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.yaml': 'application/yaml; charset=utf-8',
  '.yml': 'application/yaml; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
};

let appServer = null;
let appPort = null;
let appToken = null;
let appStartedAt = null;
const localSpecs = new Map();

function textResult(text, isError = false) {
  return {
    content: [{ type: 'text', text }],
    ...(isError ? { isError: true } : {}),
  };
}

function errorText(error) {
  return error instanceof Error ? error.message : String(error);
}

function appBaseUrl() {
  return `http://127.0.0.1:${appPort}`;
}

function json(res, status, value) {
  const body = JSON.stringify(value);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(body);
}

function text(res, status, body, type = 'text/plain; charset=utf-8') {
  res.writeHead(status, {
    'Content-Type': type,
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(body);
}

async function readJsonBody(req) {
  return new Promise((resolveBody, rejectBody) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        rejectBody(new Error('The request body is larger than 2 MB.'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        resolveBody(raw ? JSON.parse(raw) : {});
      } catch (error) {
        rejectBody(new Error(`The request body is not valid JSON: ${errorText(error)}`));
      }
    });
    req.on('error', rejectBody);
  });
}

async function proxyRequest(payload) {
  const target = String(payload.url || '').trim();
  if (!/^https?:\/\//i.test(target)) {
    throw new Error('The proxy only accepts http:// and https:// URLs.');
  }

  const method = String(payload.method || 'GET').toUpperCase();
  const headers = payload.headers && typeof payload.headers === 'object' ? payload.headers : {};
  const timeoutMs = Math.min(300_000, Math.max(1_000, Number(payload.timeoutMs) || 90_000));
  const init = {
    method,
    headers,
    redirect: 'follow',
    signal: AbortSignal.timeout(timeoutMs),
  };
  if (!['GET', 'HEAD'].includes(method) && payload.body !== undefined && payload.body !== null) {
    init.body = String(payload.body);
  }

  const response = await fetch(target, init);
  const buffer = Buffer.from(await response.arrayBuffer());
  const responseHeaders = {};
  response.headers.forEach((value, key) => {
    responseHeaders[key] = value;
  });

  return {
    status: response.status,
    statusText: response.statusText,
    headers: responseHeaders,
    rawText: buffer.toString('utf8'),
    finalUrl: response.url,
  };
}

function injectBridge(html) {
  const token = JSON.stringify(appToken);
  const bridge = `<script>(function(){
  var token = ${token};
  window.__ROUTECRAFT_MCP__ = true;
  window.__ROUTECRAFT_GM_REQUEST__ = function(request) {
    return fetch('/__proxy', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-routecraft-token': token
      },
      body: JSON.stringify(request)
    }).then(function(response) {
      return response.json().then(function(data) {
        if (!response.ok || data.error) {
          throw new Error(data.error || ('Local proxy returned HTTP ' + response.status));
        }
        return data;
      });
    });
  };
})();</script>`;
  return html.replace('</head>', `${bridge}</head>`);
}

async function serveStatic(res, pathname) {
  if (pathname === '/' || pathname === '/index.html') {
    const html = await readFile(join(DIST, 'index.html'), 'utf8');
    return text(res, 200, injectBridge(html), MIME['.html']);
  }

  const relative = decodeURIComponent(pathname).replace(/^\/+/, '');
  const filePath = resolve(DIST, relative);
  if (filePath !== DIST && !filePath.startsWith(DIST + sep)) {
    return text(res, 403, 'Forbidden');
  }

  try {
    const body = await readFile(filePath);
    const type = MIME[extname(filePath).toLowerCase()] || 'application/octet-stream';
    res.writeHead(200, {
      'Content-Type': type,
      'Content-Length': body.length,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(body);
  } catch {
    text(res, 404, 'Not found');
  }
}

async function handleRequest(req, res) {
  res.setHeader('Referrer-Policy', 'no-referrer');
  const url = new URL(req.url || '/', appBaseUrl());

  try {
    if (url.pathname === '/__health') {
      return json(res, 200, {
        ok: true,
        service: 'routecraft-mcp',
        version: VERSION,
        port: appPort,
        startedAt: appStartedAt,
      });
    }

    if (url.pathname === '/__proxy') {
      if (req.method !== 'POST') return json(res, 405, { error: 'Use POST for the local proxy.' });
      if (req.headers['x-routecraft-token'] !== appToken) {
        return json(res, 403, { error: 'The local proxy token is missing or invalid.' });
      }
      try {
        const payload = await readJsonBody(req);
        return json(res, 200, await proxyRequest(payload));
      } catch (error) {
        return json(res, 502, { error: errorText(error) });
      }
    }

    if (url.pathname.startsWith('/__spec/')) {
      const match = url.pathname.match(/^\/__spec\/([^/]+)\/(.+)$/);
      if (!match) return text(res, 404, 'Not found');
      const entry = localSpecs.get(match[1]);
      if (!entry) return text(res, 404, 'Not found');
      try {
        const body = await readFile(entry.filePath);
        res.writeHead(200, {
          'Content-Type': entry.contentType,
          'Content-Length': body.length,
          'Cache-Control': 'no-store',
          'X-Content-Type-Options': 'nosniff',
        });
        return res.end(body);
      } catch (error) {
        return text(res, 404, `Could not read the local specification: ${errorText(error)}`);
      }
    }

    return await serveStatic(res, url.pathname);
  } catch (error) {
    return text(res, 500, `RouteCraft MCP server error: ${errorText(error)}`);
  }
}

function listen(server, port) {
  return new Promise((resolveListen, rejectListen) => {
    const onError = (error) => {
      server.off('listening', onListening);
      rejectListen(error);
    };
    const onListening = () => {
      server.off('error', onError);
      resolveListen();
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, '127.0.0.1');
  });
}

async function startAppServer() {
  if (appServer) return { port: appPort, url: appBaseUrl() };
  if (!existsSync(join(DIST, 'index.html'))) {
    throw new Error(`The RouteCraft build is missing at ${DIST}. Run "npm run build" first.`);
  }

  appToken = randomBytes(24).toString('hex');
  appStartedAt = new Date().toISOString();
  const candidates = [DEFAULT_PORT];
  for (let offset = 1; offset <= 10; offset += 1) candidates.push(DEFAULT_PORT + offset);
  candidates.push(0);

  let lastError = null;
  for (const port of candidates) {
    const server = createServer((req, res) => {
      void handleRequest(req, res);
    });
    try {
      await listen(server, port);
      appServer = server;
      appPort = server.address().port;
      server.on('error', (error) => console.error(`[routecraft] app server error: ${errorText(error)}`));
      console.error(`[routecraft] MCP app server listening on ${appBaseUrl()}`);
      return { port: appPort, url: appBaseUrl() };
    } catch (error) {
      lastError = error;
      server.close();
      if (error?.code !== 'EADDRINUSE') break;
    }
  }
  throw new Error(`Could not start the RouteCraft app server: ${errorText(lastError)}`);
}

async function stopAppServer() {
  if (!appServer) return;
  const server = appServer;
  appServer = null;
  appPort = null;
  appToken = null;
  appStartedAt = null;
  localSpecs.clear();
  await new Promise((resolveClose) => server.close(() => resolveClose()));
  console.error('[routecraft] MCP app server stopped');
}

function looksLikeHttpUrl(value) {
  return /^https?:\/\//i.test(value);
}

function looksLikeLocalPath(value) {
  if (value.startsWith('file://')) return true;
  if (isAbsolute(value)) return true;
  if (/^[a-zA-Z]:[\\/]/.test(value)) return true;
  if (value.startsWith('.') || value.startsWith('..')) return true;
  try {
    return existsSync(resolve(process.cwd(), value));
  } catch {
    return false;
  }
}

function resolveLocalPath(value) {
  if (value.startsWith('file://')) return fileURLToPath(value);
  return resolve(process.cwd(), value);
}

function contentTypeForSpec(filePath) {
  const extension = extname(filePath).toLowerCase();
  if (extension === '.yaml' || extension === '.yml') return 'application/yaml; charset=utf-8';
  return 'application/json; charset=utf-8';
}

async function registerLocalSpec(filePath) {
  if (!existsSync(filePath)) throw new Error(`The specification file does not exist: ${filePath}`);
  const id = randomUUID();
  localSpecs.set(id, {
    filePath,
    contentType: contentTypeForSpec(filePath),
  });
  return `${appBaseUrl()}/__spec/${id}/${encodeURIComponent(basename(filePath))}`;
}

function normalizeHttpInput(value) {
  if (looksLikeHttpUrl(value)) return value;
  if (/^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(?::\d+)?(?:[/?#]|$)/i.test(value)) {
    return `http://${value}`;
  }
  return null;
}

async function prepareSpecForApp(input) {
  const value = String(input || '').trim();
  if (!value) throw new Error('specUrl is required.');
  const httpUrl = normalizeHttpInput(value);
  if (httpUrl) return httpUrl;
  if (looksLikeLocalPath(value)) {
    const filePath = resolveLocalPath(value);
    await startAppServer();
    return registerLocalSpec(filePath);
  }
  throw new Error('specUrl must be an http(s) URL or a path to a local OpenAPI JSON/YAML file.');
}

async function readSpecDocument(input, headers = {}) {
  const value = String(input || '').trim();
  if (!value) throw new Error('specUrl is required.');

  const httpUrl = normalizeHttpInput(value);
  if (httpUrl) {
    const response = await fetch(httpUrl, {
      headers: { Accept: 'application/json, application/yaml, text/yaml, text/plain, */*', ...headers },
      redirect: 'follow',
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error(`Could not load the spec: HTTP ${response.status} ${response.statusText}.`);
    return { text: await response.text(), source: response.url || httpUrl };
  }

  if (looksLikeLocalPath(value)) {
    const filePath = resolveLocalPath(value);
    return { text: await readFile(filePath, 'utf8'), source: filePath };
  }

  throw new Error('specUrl must be an http(s) URL or a path to a local OpenAPI JSON/YAML file.');
}

function parseSpecDocument(text, source) {
  const clean = text.replace(/^\uFEFF/, '').trim();
  if (!clean) throw new Error(`The specification at ${source} is empty.`);
  if (clean.startsWith('{') || clean.startsWith('[')) return JSON.parse(clean);
  return parseYaml(clean);
}

function summarizeSpec(document, source) {
  if (!document || typeof document !== 'object') throw new Error('The OpenAPI document is not an object.');
  const info = document.info || {};
  const paths = document.paths && typeof document.paths === 'object' ? document.paths : {};
  const operations = [];
  for (const [path, item] of Object.entries(paths)) {
    if (!item || typeof item !== 'object') continue;
    for (const [method, operation] of Object.entries(item)) {
      if (!HTTP_METHODS.has(method) || !operation || typeof operation !== 'object') continue;
      operations.push({
        method: method.toUpperCase(),
        path,
        summary: operation.summary || '',
        operationId: operation.operationId || '',
      });
    }
  }

  const securitySchemes = document.components?.securitySchemes || document.securityDefinitions || {};
  const servers = Array.isArray(document.servers)
    ? document.servers.map((server) => server.url).filter(Boolean)
    : document.host
      ? [`${document.schemes?.[0] || 'https'}://${document.host}${document.basePath || ''}`]
      : [];
  return {
    source,
    title: info.title || 'Untitled API',
    version: info.version || '',
    description: info.description || '',
    format: document.openapi ? `OpenAPI ${document.openapi}` : document.swagger ? `Swagger ${document.swagger}` : 'Unknown',
    servers,
    tags: Array.isArray(document.tags) ? document.tags.map((tag) => tag.name).filter(Boolean) : [],
    securitySchemes: Object.keys(securitySchemes),
    operationCount: operations.length,
    operations: operations.slice(0, 100),
    operationsTruncated: operations.length > 100,
  };
}

function openBrowser(url) {
  if (process.env.ROUTECRAFT_NO_BROWSER === '1' || process.env.ROUTECRAFT_NO_BROWSER === 'true') {
    return false;
  }
  try {
    let child;
    if (process.platform === 'win32') {
      // Do not route the URL through cmd.exe: the query string can contain
      // `&` and `%`, which cmd would treat as shell syntax. rundll32 receives
      // the URL as a normal CreateProcess argument.
      child = spawn('rundll32.exe', ['url.dll,FileProtocolHandler', url], {
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
      });
    } else if (process.platform === 'darwin') {
      child = spawn('open', [url], { detached: true, stdio: 'ignore' });
    } else {
      child = spawn('xdg-open', [url], { detached: true, stdio: 'ignore' });
    }
    child.on('error', (error) => console.error(`[routecraft] Could not open a browser: ${errorText(error)}`));
    child.unref();
    return true;
  } catch (error) {
    console.error(`[routecraft] Could not open a browser: ${errorText(error)}`);
    return false;
  }
}

async function openSwagger({ specUrl, operation, serverUrl, openBrowser: shouldOpen = true }) {
  await startAppServer();
  const specForApp = await prepareSpecForApp(specUrl);
  const appUrl = new URL(appBaseUrl());
  appUrl.searchParams.set('url', specForApp);
  if (operation) appUrl.searchParams.set('operation', operation);
  if (serverUrl) appUrl.searchParams.set('server', serverUrl);
  const browserOpened = shouldOpen ? openBrowser(appUrl.toString()) : false;

  return {
    appUrl: appUrl.toString(),
    specUrl: specForApp,
    port: appPort,
    browserOpened,
  };
}

async function httpRequest({ url, method = 'GET', headers = {}, body, timeoutMs = 90_000 }) {
  const started = performance.now();
  const init = {
    method: String(method).toUpperCase(),
    headers: { ...headers },
    redirect: 'follow',
    signal: AbortSignal.timeout(Math.min(300_000, Math.max(1_000, timeoutMs))),
  };
  if (body !== undefined && body !== null) {
    if (typeof body === 'string') {
      init.body = body;
    } else {
      init.body = JSON.stringify(body);
      if (!Object.keys(init.headers).some((key) => key.toLowerCase() === 'content-type')) {
        init.headers['content-type'] = 'application/json';
      }
    }
  }

  const response = await fetch(url, init);
  const rawText = await response.text();
  const responseHeaders = {};
  response.headers.forEach((value, key) => {
    responseHeaders[key] = value;
  });
  let jsonBody;
  const contentType = responseHeaders['content-type'] || '';
  if (contentType.includes('json')) {
    try {
      jsonBody = JSON.parse(rawText);
    } catch {
      /* not JSON after all */
    }
  }

  return {
    status: response.status,
    statusText: response.statusText,
    url: response.url,
    headers: responseHeaders,
    json: jsonBody,
    body: rawText.length > MAX_RESPONSE_CHARS ? `${rawText.slice(0, MAX_RESPONSE_CHARS)}\n\n[truncated]` : rawText,
    truncated: rawText.length > MAX_RESPONSE_CHARS,
    latencyMs: Math.round(performance.now() - started),
  };
}

const OPEN_TOOL = {
  title: 'Open RouteCraft',
  description:
    'Open RouteCraft in the user\'s default browser with an OpenAPI/Swagger spec loaded. Starts a loopback-only app server that also provides zero-CORS API requests. Use this when the user wants to see, explore, or test an API.',
  inputSchema: {
    specUrl: z.string().min(1).describe('An http(s) URL or an absolute/relative path to a local OpenAPI JSON or YAML file.'),
    operation: z.string().optional().describe('Optional operation to expand, for example "GET /pets" or "POST /items".'),
    serverUrl: z.string().optional().describe('Optional base URL override when the spec has no servers or points at the wrong host.'),
    openBrowser: z.boolean().optional().describe('Set false to start the app server without opening a browser.'),
  },
};

const INSPECT_TOOL = {
  title: 'Inspect an OpenAPI spec',
  description: 'Fetch and summarize an OpenAPI 2.0, 3.0 or 3.1 document. Returns the title, version, servers, security schemes and operations.',
  inputSchema: {
    specUrl: z.string().min(1).describe('An http(s) URL or a path to a local OpenAPI JSON or YAML file.'),
    headers: z.record(z.string(), z.string()).optional().describe('Optional headers for authenticated spec endpoints.'),
  },
};

const REQUEST_TOOL = {
  title: 'Send a CORS-free HTTP request',
  description: 'Send an HTTP request from the MCP server (outside the browser CORS sandbox) and return the status, headers and body. Useful for verifying an API without opening a browser.',
  inputSchema: {
    url: z.string().url().describe('The absolute http(s) URL to call.'),
    method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']).optional(),
    headers: z.record(z.string(), z.string()).optional(),
    body: z.union([z.string(), z.record(z.string(), z.unknown())]).optional(),
    timeoutMs: z.number().int().min(1_000).max(300_000).optional(),
  },
};

const CLOSE_TOOL = {
  title: 'Close the RouteCraft MCP app server',
  description: 'Stop the local app/proxy server started by open_swagger. Open browser tabs will need the MCP server running to load new requests.',
  inputSchema: {},
};

async function runMcpServer() {
  const mcp = new McpServer(
    { name: 'routecraft', version: VERSION },
    {
      instructions:
        'RouteCraft is an OpenAPI explorer and API console. Use open_swagger when the user wants to see or interact with an API in a browser. Use inspect_spec to summarize a spec, and http_request to verify endpoints without opening a browser. Always give the user the app URL returned by open_swagger.',
    },
  );

  mcp.registerTool('open_swagger', OPEN_TOOL, async (args) => {
    try {
      const result = await openSwagger(args);
      return textResult(
        [
          'RouteCraft is ready.',
          `App URL: ${result.appUrl}`,
          `Spec URL: ${result.specUrl}`,
          args.operation ? `Operation: ${args.operation}` : null,
          args.serverUrl ? `Server override: ${args.serverUrl}` : null,
          result.browserOpened
            ? 'A browser launch was requested. If it did not appear, open the App URL above.'
            : 'Open the App URL above in a browser.',
          '',
          'The page has a local zero-CORS bridge. Paste or load any other spec from the app if needed.',
        ]
          .filter(Boolean)
          .join('\n'),
      );
    } catch (error) {
      return textResult(`Could not open RouteCraft: ${errorText(error)}`, true);
    }
  });

  mcp.registerTool('inspect_spec', INSPECT_TOOL, async (args) => {
    try {
      const loaded = await readSpecDocument(args.specUrl, args.headers || {});
      const summary = summarizeSpec(parseSpecDocument(loaded.text, loaded.source), loaded.source);
      return textResult(JSON.stringify(summary, null, 2));
    } catch (error) {
      return textResult(`Could not inspect the specification: ${errorText(error)}`, true);
    }
  });

  mcp.registerTool('http_request', REQUEST_TOOL, async (args) => {
    try {
      const result = await httpRequest(args);
      return textResult(JSON.stringify(result, null, 2));
    } catch (error) {
      return textResult(`The request failed: ${errorText(error)}`, true);
    }
  });

  mcp.registerTool('close_swagger', CLOSE_TOOL, async () => {
    await stopAppServer();
    return textResult('The RouteCraft MCP app server is stopped.');
  });

  const transport = new StdioServerTransport();
  await mcp.connect(transport);
  console.error(`[routecraft] MCP server v${VERSION} ready (stdio)`);

  const shutdown = async () => {
    await stopAppServer();
    process.exit(0);
  };
  process.once('SIGINT', () => void shutdown());
  process.once('SIGTERM', () => void shutdown());
}

function parseCli(argv) {
  const args = [...argv];
  if (!args.length || args[0] === '--help' || args[0] === '-h') {
    console.log(`RouteCraft MCP server v${VERSION}

Usage:
  node mcp/server.mjs                         Start the MCP stdio server
  node mcp/server.mjs open <spec> [options]  Open a spec in the browser
  node mcp/server.mjs --help                 Show this help

Options for "open":
  --no-browser        Print the app URL without launching a browser
  --port <number>     Preferred local app port (default 4199)
  --operation <op>    Expand an operation, for example "GET /pets"
  --server <url>      Override the spec's server base URL
`);
    return null;
  }

  const [command, spec] = args;
  if (command !== 'open' || !spec) throw new Error('Use: node mcp/server.mjs open <spec-url-or-file>');

  let port = null;
  let operation = null;
  let serverUrl = null;
  let shouldOpen = true;
  for (let index = 2; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--no-browser') shouldOpen = false;
    else if (arg === '--port') port = Number(args[++index]);
    else if (arg === '--operation') operation = args[++index];
    else if (arg === '--server') serverUrl = args[++index];
    else throw new Error(`Unknown option: ${arg}`);
  }
  return { spec, port, operation, serverUrl, shouldOpen };
}

async function runCli() {
  const parsed = parseCli(process.argv.slice(2));
  if (!parsed) return;
  if (parsed.port) process.env.ROUTECRAFT_PORT = String(parsed.port);
  const result = await openSwagger({
    specUrl: parsed.spec,
    operation: parsed.operation,
    serverUrl: parsed.serverUrl,
    openBrowser: parsed.shouldOpen,
  });
  console.log(`RouteCraft app: ${result.appUrl}`);
  console.log('Press Ctrl+C to stop the local server.');
  process.once('SIGINT', () => {
    void stopAppServer().then(() => process.exit(0));
  });
}

if (process.argv[2] === 'open' || process.argv[2] === '--help' || process.argv[2] === '-h') {
  runCli().catch((error) => {
    console.error(`[routecraft] ${errorText(error)}`);
    process.exit(1);
  });
} else {
  runMcpServer().catch((error) => {
    console.error(`[routecraft] ${errorText(error)}`);
    process.exit(1);
  });
}

