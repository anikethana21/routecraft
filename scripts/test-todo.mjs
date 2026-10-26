/**
 * Starts the To-Do demo (unless it is already running), exercises auth,
 * authorization, validation, CRUD, filters, admin routes, CORS and timing
 * headers, then drives the OAuth password flow and GET /todos in RouteCraft.
 *
 *   npm run test:todo
 */
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const root = resolve(here, '..');
const origin = 'http://127.0.0.1:8012';
const userscript = resolve(root, 'routecraft.user.js');
const source = existsSync(userscript) ? readFileSync(userscript, 'utf8') : null;
const children = [];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function stopChildren() {
  for (const child of children) {
    try {
      child.kill();
    } catch {
      /* ignore */
    }
  }
}

process.on('exit', stopChildren);
process.on('SIGINT', () => {
  stopChildren();
  process.exit(130);
});

async function ready(url) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(2000) });
    return response.status > 0;
  } catch {
    return false;
  }
}

async function waitReady(url, label) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (await ready(url)) return;
    await new Promise((resolveWait) => setTimeout(resolveWait, 150));
  }
  throw new Error(`${label} did not start at ${url}.`);
}

async function startDemo() {
  if (await ready(`${origin}/health`)) return;
  const child = spawn('python', ['demos/todo/main.py'], {
    cwd: root,
    env: { ...process.env, PORT: '8012' },
    stdio: 'ignore',
  });
  children.push(child);
  await waitReady(`${origin}/health`, 'To-Do demo');
}

async function api(path, { method = 'GET', token, body, form, expected = 200, headers: extraHeaders = {} } = {}) {
  const headers = { accept: 'application/json', ...extraHeaders };
  let payload;
  if (body !== undefined) {
    headers['content-type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  if (form) {
    headers['content-type'] = 'application/x-www-form-urlencoded';
    payload = new URLSearchParams(form).toString();
  }
  if (token) headers.authorization = `Bearer ${token}`;
  const response = await fetch(`${origin}${path}`, {
    method,
    headers,
    body: payload,
    redirect: 'manual',
  });
  const text = await response.text();
  let json = null;
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
  }
  if (response.status !== expected) {
    throw new Error(`${method} ${path} expected ${expected}, got ${response.status}: ${text.slice(0, 500)}`);
  }
  return { response, json, text };
}

async function checkSpec() {
  const { json: spec } = await api('/openapi.json');
  assert(spec.info?.title === 'To-Do List Auth Demo', `Unexpected spec title: ${spec.info?.title}`);
  const expectedPaths = [
    '/auth/register',
    '/auth/login',
    '/auth/token',
    '/auth/me',
    '/auth/logout',
    '/todos',
    '/todos/stats',
    '/todos/{todo_id}',
    '/todos/{todo_id}/complete',
    '/todos/{todo_id}/reopen',
    '/admin/todos',
    '/admin/stats',
    '/admin/todos/{todo_id}',
  ];
  for (const path of expectedPaths) assert(spec.paths?.[path], `Spec is missing ${path}.`);
  for (const method of ['get', 'put', 'patch', 'delete']) {
    assert(spec.paths['/todos/{todo_id}']?.[method], `Spec is missing ${method.toUpperCase()} /todos/{todo_id}.`);
  }
  for (const method of ['get', 'post', 'delete']) {
    assert(spec.paths['/todos']?.[method], `Spec is missing ${method.toUpperCase()} /todos.`);
  }
  const security = spec.components?.securitySchemes?.todoAuth;
  assert(security?.type === 'oauth2', 'todoAuth is not an OAuth 2.0 scheme.');
  assert(security?.flows?.password?.tokenUrl === '/auth/token', 'todoAuth password tokenUrl is wrong.');
  console.log(`Spec: ${Object.keys(spec.paths).length} paths and the OAuth password flow verified.`);
}

async function checkCorsAndHeaders() {
  const preflight = await fetch(`${origin}/todos`, {
    method: 'OPTIONS',
    headers: {
      Origin: 'http://example.test',
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'authorization,content-type',
    },
  });
  assert([200, 204].includes(preflight.status), `CORS preflight returned ${preflight.status}.`);
  assert(preflight.headers.get('access-control-allow-origin') === '*', 'CORS preflight is missing allow-origin.');
  assert((preflight.headers.get('access-control-allow-methods') || '').includes('POST'), 'CORS preflight is missing POST.');
  assert(
    (preflight.headers.get('access-control-allow-headers') || '').toLowerCase().includes('authorization'),
    'CORS preflight is missing the Authorization header.',
  );

  const health = await api('/health', { headers: { Origin: 'http://example.test' } });
  assert(health.response.headers.get('access-control-allow-origin') === '*', 'Normal response is missing CORS headers.');
  assert(health.response.headers.get('x-process-time')?.endsWith('ms'), 'X-Process-Time is missing.');
  assert(health.response.headers.get('x-request-id'), 'X-Request-Id is missing.');
  assert(health.response.headers.get('x-demo-server') === 'todo:8012', 'X-Demo-Server is missing.');
  console.log('CORS, X-Request-Id, X-Process-Time and X-Demo-Server verified.');
}

async function checkAuth() {
  const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const username = `tester_${suffix}`;
  const password = 'secret123';

  const registered = await api('/auth/register', {
    method: 'POST',
    body: { username, password, display_name: 'API Tester' },
    expected: 201,
  });
  assert(registered.json.username === username, 'Register returned the wrong username.');
  assert(registered.json.role === 'user', 'Register should create a regular user.');

  await api('/auth/register', {
    method: 'POST',
    body: { username, password },
    expected: 409,
  });
  await api('/auth/register', {
    method: 'POST',
    body: { username: 'x', password: 'short' },
    expected: 422,
  });

  const login = await api('/auth/login', {
    method: 'POST',
    body: { username, password },
  });
  assert(login.json.token_type === 'bearer', 'Login did not return a bearer token.');
  assert(login.json.expires_in === 8 * 60 * 60, 'Token lifetime is not eight hours.');
  assert(login.json.access_token?.length > 20, 'Login token is too short.');
  const token = login.json.access_token;

  await api('/auth/login', {
    method: 'POST',
    body: { username, password: 'wrong-password' },
    expected: 401,
  });

  const formLogin = await api('/auth/token', {
    method: 'POST',
    form: { grant_type: 'password', username, password },
  });
  assert(formLogin.json.access_token, 'OAuth password form login did not return a token.');
  const formToken = formLogin.json.access_token;

  const me = await api('/auth/me', { token });
  assert(me.json.username === username, '/auth/me returned the wrong user.');
  assert(me.json.display_name === 'API Tester', '/auth/me lost the display name.');

  await api('/todos', { expected: 401 });
  await api('/todos', { token: 'not-a-real-token', expected: 401 });

  return { username, password, token, formToken };
}

async function checkCrud({ username, token }) {
  const dueDate = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const first = await api('/todos', {
    method: 'POST',
    token,
    body: {
      title: 'Write integration test',
      description: 'Exercise every endpoint.',
      status: 'pending',
      priority: 'high',
      due_date: dueDate.toISOString(),
      tags: ['test', 'routecraft', 'test'],
    },
    expected: 201,
  });
  assert(first.json.owner === username, 'Created todo has the wrong owner.');
  assert(first.json.tags.length === 2, 'Duplicate tags were not removed.');
  assert(first.json.completed_at === null, 'A pending todo should not be completed.');
  assert(first.response.headers.get('location') === `/todos/${first.json.id}`, 'Create did not set Location.');

  const done = await api('/todos', {
    method: 'POST',
    token,
    body: { title: 'Already done', status: 'completed', priority: 'low', tags: ['done'] },
    expected: 201,
  });
  assert(done.json.completed_at, 'A completed todo should have completed_at.');

  const third = await api('/todos', {
    method: 'POST',
    token,
    body: { title: 'Low priority item', priority: 'low', tags: ['test'] },
    expected: 201,
  });

  await api('/todos', {
    method: 'POST',
    token,
    body: { title: '   ' },
    expected: 422,
  });
  await api('/todos', {
    method: 'POST',
    token,
    body: { title: 'Bad priority', priority: 'urgent' },
    expected: 422,
  });
  await api('/todos', {
    method: 'POST',
    token,
    body: { title: 'Unknown field', nope: true },
    expected: 422,
  });

  const list = await api('/todos', { token });
  assert(list.response.headers.get('x-total-count') === String(list.json.total), 'X-Total-Count is missing or wrong.');
  assert(list.json.total >= 3, 'The list should include the three created todos.');
  assert(list.json.items.every((todo) => todo.owner === username), 'The list leaked another owner.');
  assert(list.json.items.some((todo) => todo.id === first.json.id), 'The list is missing the first todo.');

  const pending = await api('/todos?status=pending', { token });
  assert(pending.json.items.every((todo) => todo.status === 'pending'), 'Status filtering failed.');

  const high = await api('/todos?priority=high', { token });
  assert(high.json.items.every((todo) => todo.priority === 'high'), 'Priority filtering failed.');
  assert(high.json.items.some((todo) => todo.id === first.json.id), 'High-priority filter missed the first todo.');

  const search = await api('/todos?q=integration', { token });
  assert(search.json.total === 1 && search.json.items[0].id === first.json.id, 'Text search failed.');

  const tagged = await api('/todos?tag=test', { token });
  assert(tagged.json.total === 2, 'Tag filtering failed.');

  const page = await api('/todos?limit=1&offset=1&sort=title&order=asc', { token });
  assert(page.json.limit === 1 && page.json.offset === 1 && page.json.items.length === 1, 'Pagination failed.');
  assert(page.json.total === list.json.total, 'Pagination changed the total.');

  const sorted = await api('/todos?sort=title&order=asc&limit=100', { token });
  const titles = sorted.json.items.map((todo) => todo.title.toLowerCase());
  assert(
    titles.every((title, index) => index === 0 || titles[index - 1] <= title),
    'Title sorting failed.',
  );

  const naiveDue = dueDate.toISOString().replace('Z', '');
  const dueBefore = await api(`/todos?due_before=${encodeURIComponent(naiveDue)}`, { token });
  assert(dueBefore.json.items.some((todo) => todo.id === first.json.id), 'Naive due_before query failed.');
  const dueAfter = await api('/todos?due_after=2000-01-01T00:00:00Z', { token });
  assert(dueAfter.json.items.some((todo) => todo.id === first.json.id), 'Due-after filtering failed.');

  const stats = await api('/todos/stats', { token });
  assert(stats.json.total >= 3, 'Stats total is wrong.');
  assert(stats.json.completed >= 1, 'Stats completed count is wrong.');
  assert(stats.json.by_priority.high >= 1, 'Stats high-priority count is wrong.');

  const one = await api(`/todos/${first.json.id}`, { token });
  assert(one.json.title === 'Write integration test', 'GET one returned the wrong todo.');

  const replaced = await api(`/todos/${first.json.id}`, {
    method: 'PUT',
    token,
    body: {
      title: 'Updated via PUT',
      description: null,
      status: 'in_progress',
      priority: 'low',
      due_date: null,
      tags: ['put'],
    },
  });
  assert(replaced.json.title === 'Updated via PUT', 'PUT did not replace the title.');
  assert(replaced.json.status === 'in_progress', 'PUT did not replace the status.');
  assert(replaced.json.description === null, 'PUT did not clear the description.');
  assert(replaced.json.completed_at === null, 'PUT did not clear completed_at.');

  await api(`/todos/${first.json.id}`, {
    method: 'PUT',
    token,
    body: { status: 'completed' },
    expected: 422,
  });

  const patched = await api(`/todos/${first.json.id}`, {
    method: 'PATCH',
    token,
    body: { title: 'Patched title' },
  });
  assert(patched.json.title === 'Patched title', 'PATCH did not update the title.');
  assert(patched.json.status === 'in_progress', 'PATCH should not reset the status.');
  assert(patched.json.priority === 'low', 'PATCH should not reset the priority.');

  await api(`/todos/${first.json.id}`, {
    method: 'PATCH',
    token,
    body: {},
    expected: 422,
  });
  await api(`/todos/${first.json.id}`, {
    method: 'PATCH',
    token,
    body: { priority: 'urgent' },
    expected: 422,
  });

  const completed = await api(`/todos/${first.json.id}/complete`, { method: 'POST', token });
  assert(completed.json.status === 'completed' && completed.json.completed_at, 'Complete did not set completed_at.');
  const reopened = await api(`/todos/${first.json.id}/reopen`, { method: 'POST', token });
  assert(reopened.json.status === 'pending' && reopened.json.completed_at === null, 'Reopen did not reset the status.');

  await api(`/todos/${done.json.id}`, { method: 'DELETE', token, expected: 204 });
  await api(`/todos/${done.json.id}`, { token, expected: 404 });

  return { first, third };
}

async function checkAuthorization({ token, username }, { first }) {
  const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const otherName = `other_${suffix}`;
  const otherPassword = 'secret456';
  await api('/auth/register', {
    method: 'POST',
    body: { username: otherName, password: otherPassword },
    expected: 201,
  });
  const otherLogin = await api('/auth/login', {
    method: 'POST',
    body: { username: otherName, password: otherPassword },
  });
  const otherToken = otherLogin.json.access_token;

  const otherTodo = await api('/todos', {
    method: 'POST',
    token: otherToken,
    body: { title: 'Other user todo', priority: 'medium' },
    expected: 201,
  });

  await api(`/todos/${otherTodo.json.id}`, { token, expected: 403 });
  await api(`/todos/${otherTodo.json.id}`, { method: 'PATCH', token, body: { title: 'Nope' }, expected: 403 });
  await api(`/todos/${otherTodo.json.id}`, { method: 'DELETE', token, expected: 403 });
  await api(`/todos/${otherTodo.json.id}`, {
    method: 'PUT',
    token,
    body: { title: 'Nope', status: 'pending', priority: 'low', tags: [] },
    expected: 403,
  });
  await api(`/todos?owner=${otherName}`, { token, expected: 403 });
  await api('/admin/todos', { token, expected: 403 });

  const otherList = await api('/todos', { token: otherToken });
  assert(otherList.json.items.every((todo) => todo.owner === otherName), 'The other user can see foreign todos.');
  assert(!otherList.json.items.some((todo) => todo.id === first.json.id), 'The other user can see the first user todo.');

  const adminLogin = await api('/auth/login', {
    method: 'POST',
    body: { username: 'admin', password: 'admin123' },
  });
  const adminToken = adminLogin.json.access_token;

  const all = await api('/admin/todos', { token: adminToken });
  assert(all.json.items.some((todo) => todo.owner === username), 'Admin list is missing the test user.');
  assert(all.json.items.some((todo) => todo.owner === otherName), 'Admin list is missing the other user.');

  const adminStats = await api('/admin/stats', { token: adminToken });
  assert(adminStats.json.total >= all.json.items.length, 'Admin stats total is too small.');

  const adminGet = await api(`/admin/todos/${otherTodo.json.id}`, { token: adminToken });
  assert(adminGet.json.owner === otherName, 'Admin GET returned the wrong owner.');

  const adminFiltered = await api(`/todos?owner=${otherName}`, { token: adminToken });
  assert(
    adminFiltered.json.items.length > 0 &&
      adminFiltered.json.items.every((todo) => todo.owner === otherName),
    'Admin owner filtering failed.',
  );

  await api(`/admin/todos/${otherTodo.json.id}`, { method: 'DELETE', token: adminToken, expected: 204 });
  await api(`/todos/${otherTodo.json.id}`, { token: otherToken, expected: 404 });

  await api(`/admin/todos?owner=${username}`, { method: 'DELETE', token: adminToken, expected: 204 });
  const cleared = await api('/todos', { token });
  assert(cleared.json.total === 0, 'Admin owner clear did not delete the test user todos.');

  return { otherName, otherToken, adminToken };
}

async function checkLogout({ formToken }) {
  await api('/auth/logout', { method: 'POST', token: formToken, expected: 204 });
  await api('/auth/me', { token: formToken, expected: 401 });
  await api('/auth/logout', { method: 'POST', token: 'missing-token', expected: 401 });
  console.log('Logout invalidated the token.');
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

async function checkUi(browser) {
  if (!source) {
    console.log('UI check skipped because routecraft.user.js is missing. Run npm run build:userscript.');
    return;
  }
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  try {
    await installShim(page);
    await page.goto(`${origin}/docs`, { waitUntil: 'domcontentloaded' });
    await page.addScriptTag({ content: source });
    await page.waitForFunction(() => !!document.getElementById('routecraft-userscript-host'), null, { timeout: 15000 });
    await page.keyboard.press('Alt+Shift+S');
    await page.getByTestId('spec-title').waitFor({ timeout: 20000 });
    const title = (await page.getByTestId('spec-title').textContent())?.trim();
    assert(title === 'To-Do List Auth Demo', `UI loaded "${title}" instead of "To-Do List Auth Demo".`);

    await page.getByTestId('authorize-button').click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Username').fill('demo');
    await dialog.getByLabel('Password').fill('demo123');
    await dialog.getByRole('button', { name: /Get token/i }).evaluate((element) => element.click());
    await page.waitForFunction(
      () => {
        const host = document.querySelector('#routecraft-userscript-host');
        const input = host?.shadowRoot?.querySelector('[data-testid="auth-token-input"]');
        return input && input.value.length > 20;
      },
      undefined,
      { timeout: 20000 },
    );
    await page.getByTestId('auth-save').evaluate((element) => element.click());
    await page.getByTestId('authorize-button').filter({ hasText: 'Authorized' }).waitFor({ timeout: 10000 });

    await page.getByTestId('operation-get-/todos').click();
    await page.getByTestId('try-it-out-get-/todos').click();
    await page.getByTestId('send-get-/todos').click();
    await page.locator('.status-pill').filter({ hasText: '200' }).waitFor({ timeout: 15000 });
    const responseText = await page.locator('.response .json-code').last().textContent();
    assert(responseText?.includes('"items"'), 'UI GET /todos response did not contain items.');

    const shots = resolve(root, 'test-results');
    mkdirSync(shots, { recursive: true });
    await page.screenshot({ path: resolve(shots, 'userscript-todo.png') });
    if (errors.length) throw new Error(`UI page errors: ${errors.join(' | ')}`);
    console.log('UI: OAuth password flow authorized and GET /todos returned 200.');
  } finally {
    await page.close();
  }
}

await startDemo();
await checkSpec();
await checkCorsAndHeaders();
const auth = await checkAuth();
const crud = await checkCrud(auth);
await checkAuthorization(auth, crud);
await checkLogout(auth);

const browser = await chromium.launch({ channel: 'chromium', headless: true });
try {
  await checkUi(browser);
} finally {
  await browser.close();
  stopChildren();
}

console.log('\nTo-Do demo test passed.');
console.log(`  Docs:    ${origin}/docs`);
console.log(`  OpenAPI: ${origin}/openapi.json`);
console.log('  Accounts: demo / demo123 (user), admin / admin123 (admin)');
