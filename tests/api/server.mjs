/**
 * Mock API used by the end-to-end tests and for manual UI checks.
 *
 *   node tests/api/server.mjs
 *
 * It serves every fixture under /specs/<name> and a small live API on the
 * same origin, with permissive CORS so the browser build can call it.
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = resolve(here, 'fixtures');
const port = Number(process.env.PORT || 4010);

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS, HEAD',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Expose-Headers': 'X-Total-Count, X-Request-Id, Content-Type',
};

const pets = [
  { id: 1, name: 'Rex', status: 'available', tag: 'dog', owner: { name: 'Ada' } },
  { id: 2, name: 'Milo', status: 'pending', tag: 'cat', owner: { name: 'Linus' } },
  { id: 3, name: 'Zoe', status: 'sold', tag: 'dog', owner: { name: 'Grace' } },
];

function json(res, status, body, extra = {}) {
  const text = JSON.stringify(body, null, 2);
  res.writeHead(status, {
    ...CORS,
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(text),
    ...extra,
  });
  res.end(text);
}

function text(res, status, body, contentType = 'text/plain; charset=utf-8') {
  res.writeHead(status, {
    ...CORS,
    'Content-Type': contentType,
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

function authorized(req) {
  const header = req.headers.authorization || '';
  const apiKey = req.headers['x-api-key'];
  return /^Bearer\s+demo-token$/i.test(header) || /^Basic\s+ZGVtbzpzZWNyZXQ=$/i.test(header) || apiKey === 'demo-key';
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const path = url.pathname;
  const method = (req.method || 'GET').toUpperCase();

  if (method === 'OPTIONS') {
    res.writeHead(204, CORS);
    res.end();
    return;
  }

  // Fixtures: /specs/fastapi.json, /specs/express.yaml, ...
  if (path.startsWith('/specs/')) {
    const name = path.slice('/specs/'.length).replace(/[^a-zA-Z0-9._-]/g, '');
    if (!name) {
      json(res, 404, { detail: 'Spec not found' });
      return;
    }
    try {
      const content = await readFile(resolve(fixtures, name), 'utf8');
      const type = extname(name) === '.yaml' ? 'application/yaml; charset=utf-8' : 'application/json; charset=utf-8';
      res.writeHead(200, { ...CORS, 'Content-Type': type, 'Content-Length': Buffer.byteLength(content) });
      res.end(content);
    } catch {
      json(res, 404, { detail: `No fixture named ${name}` });
    }
    return;
  }

  if (path === '/protected/openapi.json') {
    if (!authorized(req)) {
      json(res, 401, { detail: 'A bearer token is required to read this spec.' });
      return;
    }
    try {
      const content = await readFile(resolve(fixtures, 'fastapi.json'), 'utf8');
      const document = JSON.parse(content);
      document.info = { ...(document.info || {}), title: 'Protected FastAPI Demo' };
      const body = JSON.stringify(document, null, 2);
      res.writeHead(200, {
        ...CORS,
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': Buffer.byteLength(body),
      });
      res.end(body);
    } catch (error) {
      json(res, 500, { detail: String(error) });
    }
    return;
  }

  if (path === '/openapi.json' || path === '/swagger.json') {
    try {
      const content = await readFile(resolve(fixtures, 'fastapi.json'), 'utf8');
      res.writeHead(200, { ...CORS, 'Content-Type': 'application/json; charset=utf-8' });
      res.end(content);
    } catch (error) {
      json(res, 500, { detail: String(error) });
    }
    return;
  }

  if (path === '/health') {
    json(res, 200, { status: 'ok', uptime: Math.round(process.uptime()) });
    return;
  }

  if (path === '/docs') {
    text(
      res,
      200,
      `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>FastAPI Swagger UI</title>
</head>
<body>
  <main>
    <h1>FastAPI Swagger UI</h1>
    <p>Mock framework docs page used by the RouteCraft browser tests.</p>
    <a href="/openapi.json">OpenAPI JSON</a>
  </main>
</body>
</html>`,
      'text/html; charset=utf-8',
    );
    return;
  }

  // Swagger 2 fixture base path.
  if (path === '/api/v1/orders' && method === 'GET') {
    json(res, 200, [
      { id: 'ord_1', total: 42.5, state: 'open', items: [{ sku: 'ABC-1', quantity: 2 }] },
      { id: 'ord_2', total: 12, state: 'paid', items: [] },
    ]);
    return;
  }

  if (path === '/api/v1/orders' && method === 'POST') {
    const raw = await readBody(req);
    let body = {};
    try {
      body = raw ? JSON.parse(raw) : {};
    } catch {
      json(res, 400, { message: 'Invalid JSON', code: 400 });
      return;
    }
    json(res, 201, { id: `ord_${Date.now()}`, state: 'open', total: 0, ...body });
    return;
  }

  if (/^\/api\/v1\/orders\/[^/]+$/.test(path) && method === 'GET') {
    json(res, 200, { id: path.split('/').pop(), total: 42.5, state: 'open', items: [] });
    return;
  }

  if (path === '/pets' && method === 'GET') {
    const status = url.searchParams.get('status');
    const limit = Math.max(1, Math.min(100, Number(url.searchParams.get('limit') || 10)));
    const filtered = status ? pets.filter((pet) => pet.status === status) : pets;
    json(res, 200, filtered.slice(0, limit), {
      'X-Total-Count': String(filtered.length),
      'X-Request-Id': `req_${Date.now()}`,
    });
    return;
  }

  if (path === '/pets' && method === 'POST') {
    if (!authorized(req)) {
      json(res, 401, { detail: 'Missing or invalid bearer token.', code: 401 });
      return;
    }
    const raw = await readBody(req);
    let body = {};
    try {
      body = raw ? JSON.parse(raw) : {};
    } catch {
      json(res, 422, { detail: 'Body is not valid JSON.' });
      return;
    }
    if (!body.name) {
      json(res, 422, { detail: 'name is required' });
      return;
    }
    json(res, 201, { id: pets.length + 1, status: 'available', ...body });
    return;
  }

  const petMatch = path.match(/^\/pets\/(\d+)$/);
  if (petMatch) {
    const id = Number(petMatch[1]);
    const pet = pets.find((item) => item.id === id);
    if (method === 'GET') {
      if (!pet) json(res, 404, { detail: 'Pet not found.' });
      else json(res, 200, pet);
      return;
    }
    if (method === 'DELETE') {
      if (!authorized(req)) {
        json(res, 401, { detail: 'Unauthorized' });
        return;
      }
      res.writeHead(204, CORS);
      res.end();
      return;
    }
    if (method === 'PATCH' || method === 'PUT') {
      const raw = await readBody(req);
      json(res, 200, { ...(pet || { id }), ...(raw ? JSON.parse(raw) : {}) });
      return;
    }
  }

  if (path === '/echo' && (method === 'POST' || method === 'PUT' || method === 'PATCH')) {
    const raw = await readBody(req);
    let parsed = raw;
    try {
      parsed = raw ? JSON.parse(raw) : null;
    } catch {
      /* keep the raw text */
    }
    json(res, 200, {
      method,
      query: Object.fromEntries(url.searchParams),
      headers: req.headers,
      body: parsed,
    });
    return;
  }

  if (path === '/form' && method === 'POST') {
    const raw = await readBody(req);
    json(res, 200, { received: Object.fromEntries(new URLSearchParams(raw)), contentType: req.headers['content-type'] });
    return;
  }

  if (path === '/secure') {
    if (!authorized(req)) {
      json(res, 401, { detail: 'Unauthorized. Use the token demo-token.' });
      return;
    }
    json(res, 200, { ok: true, user: 'demo', scopes: ['pets:read', 'pets:write'] });
    return;
  }

  if (path === '/headers') {
    json(res, 200, { headers: req.headers, method });
    return;
  }

  // Deliberately no CORS headers: only a privileged client (the extension's
  // service worker) can read this response from a browser page.
  if (path === '/no-cors') {
    const body = JSON.stringify({ proxied: true, message: 'No CORS headers on this response.' });
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(body);
    return;
  }

  if (path.startsWith('/status/')) {
    const code = Number(path.slice('/status/'.length));
    if (!Number.isInteger(code) || code < 100 || code > 599) {
      json(res, 400, { detail: 'Use a status code between 100 and 599.' });
      return;
    }
    if (code === 204) {
      res.writeHead(204, CORS);
      res.end();
      return;
    }
    json(res, code, { status: code, message: `This response has status ${code}.` });
    return;
  }

  if (path === '/slow') {
    const delay = Math.min(10000, Number(url.searchParams.get('ms') || 1200));
    await new Promise((resolve) => setTimeout(resolve, delay));
    json(res, 200, { waitedMs: delay });
    return;
  }

  if (path === '/plain') {
    text(res, 200, 'Plain text from the mock API.');
    return;
  }

  if (path === '/xml') {
    text(res, 200, '<note><to>RouteCraft</to><body>Hello</body></note>', 'application/xml; charset=utf-8');
    return;
  }

  json(res, 404, { detail: `No mock route for ${method} ${path}`, code: 404 });
});

server.listen(port, '127.0.0.1', () => {
  console.log(`RouteCraft mock API listening on http://127.0.0.1:${port}`);
  console.log(`  Specs: http://127.0.0.1:${port}/specs/fastapi.json`);
});
