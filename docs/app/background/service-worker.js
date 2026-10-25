/* RouteCraft - MV3 service worker
 * Opens the app from the popup/omnibox, stores one-time spec headers, and
 * performs CORS-free fetches for the app.
 */
import { buildAppUrl, parseTarget, suggestionsFor } from './omnibox.js';

const APP_URL = chrome.runtime.getURL('index.html');
const SPEC_HEADER_PREFIX = 'routecraft.specHeaders.';
const SPEC_HEADER_TTL_MS = 2 * 60 * 1000;
const memorySpecHeaders = new Map();

chrome.runtime.onInstalled.addListener(() => {
  try {
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false });
  } catch (_) {
    /* older Chromium */
  }
});

function randomKey() {
  if (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

async function storeSpecHeaders(headers) {
  if (!headers || Object.keys(headers).length === 0) return null;
  const key = randomKey();
  const entry = { headers, expiresAt: Date.now() + SPEC_HEADER_TTL_MS };
  if (chrome.storage && chrome.storage.session) {
    await chrome.storage.session.set({ [SPEC_HEADER_PREFIX + key]: entry });
  } else {
    memorySpecHeaders.set(key, entry);
  }
  return key;
}

async function readSpecHeaders(key) {
  if (!key) return null;
  if (chrome.storage && chrome.storage.session) {
    const storageKey = SPEC_HEADER_PREFIX + key;
    const items = await chrome.storage.session.get(storageKey);
    const entry = items && items[storageKey];
    if (!entry) return null;
    if (entry.expiresAt < Date.now()) {
      await chrome.storage.session.remove(storageKey);
      return null;
    }
    return entry.headers;
  }
  const entry = memorySpecHeaders.get(key);
  if (!entry) return null;
  memorySpecHeaders.delete(key);
  return entry.expiresAt < Date.now() ? null : entry.headers;
}

async function focusExistingApp() {
  const tabs = await chrome.tabs.query({ url: APP_URL + '*' });
  if (tabs.length === 0) return false;
  const tab = tabs[0];
  try {
    await chrome.tabs.update(tab.id, { active: true });
    await chrome.windows.update(tab.windowId, { focused: true });
  } catch (_) {
    /* the tab may have closed between query and update */
  }
  return true;
}

/**
 * @param {{target?: string, headers?: Record<string,string>, disposition?: string, reuse?: boolean}} options
 */
async function openApp({ target = '', headers = {}, disposition = 'newForegroundTab', reuse = false } = {}) {
  const headersKey = await storeSpecHeaders(headers);
  const appUrl = buildAppUrl(APP_URL, target, { specHeadersKey: headersKey });

  if (reuse && (await focusExistingApp())) {
    return { ok: true, url: appUrl, reused: true };
  }

  if (disposition === 'currentTab') {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (tab && tab.id) {
      try {
        await chrome.tabs.update(tab.id, { url: appUrl });
        return { ok: true, url: appUrl };
      } catch (_) {
        /* chrome:// and similar pages cannot be navigated; fall through */
      }
    }
  }

  await chrome.tabs.create({
    url: appUrl,
    active: disposition !== 'newBackgroundTab',
  });
  return { ok: true, url: appUrl };
}

async function openInput(input, { disposition = 'newForegroundTab' } = {}) {
  const parsed = parseTarget(input);
  return openApp({
    target: parsed.target,
    headers: parsed.headers,
    disposition,
  });
}

chrome.omnibox.onInputChanged.addListener((text, suggest) => {
  suggest(suggestionsFor(text));
});

chrome.omnibox.onInputEntered.addListener((text, disposition) => {
  // Keep the user's page intact: an address-bar launch opens a foreground tab
  // unless Chrome explicitly asks for a background tab.
  openInput(text, {
    disposition: disposition === 'newBackgroundTab' ? 'newBackgroundTab' : 'newForegroundTab',
  }).catch((error) => {
    console.error('[RouteCraft] Could not open the address-bar target:', error);
  });
});

function parseBody(text, contentType) {
  if (!text) return null;
  const type = (contentType || '').toLowerCase();
  if (type.includes('json') || /^[\s]*[[{]/.test(text)) {
    try {
      return JSON.parse(text);
    } catch (_) {
      return text;
    }
  }
  return text;
}

async function proxyFetch({ url, options }) {
  const started = performance.now();
  const headers = new Headers(options && options.headers ? options.headers : {});
  const method = (options && options.method) || 'GET';
  const init = {
    method,
    headers,
    redirect: 'follow',
    cache: 'no-store',
    credentials: 'omit',
  };
  if (options && options.body !== undefined && options.body !== null && method !== 'GET' && method !== 'HEAD') {
    init.body = typeof options.body === 'string' ? options.body : JSON.stringify(options.body);
  }

  const response = await fetch(url, init);
  const latencyMs = Math.round(performance.now() - started);
  const rawText = await response.text();
  const responseHeaders = {};
  response.headers.forEach((value, key) => {
    responseHeaders[key] = value;
  });

  return {
    status: response.status,
    statusText: response.statusText,
    headers: responseHeaders,
    data: parseBody(rawText, responseHeaders['content-type']),
    rawText,
    latencyMs,
    sizeBytes: new Blob([rawText]).size,
    timestamp: new Date().toISOString(),
    finalUrl: response.url || url,
  };
}

/** Try the usual places frameworks expose their OpenAPI document. */
async function detectSpec() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab || !tab.url || !/^https?:/i.test(tab.url)) {
    return { ok: false, error: 'The current tab is not a web page.' };
  }
  const origin = new URL(tab.url).origin;
  const candidates = [
    '/openapi.json',
    '/swagger.json',
    '/v3/api-docs',
    '/api-docs',
    '/api-docs/swagger.json',
    '/docs/openapi.json',
    '/swagger/v1/swagger.json',
    '/openapi.yaml',
  ];
  for (const path of candidates) {
    const url = origin + path;
    try {
      const response = await fetch(url, { cache: 'no-store', credentials: 'omit' });
      if (!response.ok) continue;
      const text = await response.text();
      if (/"openapi"\s*:/.test(text) || /"swagger"\s*:/.test(text) || /openapi\s*:/.test(text)) {
        return { ok: true, url, origin };
      }
    } catch (_) {
      /* keep looking */
    }
  }
  return { ok: false, error: 'No OpenAPI document found on ' + origin, origin };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message && message.type === 'OPEN_APP') {
    openApp({ reuse: true })
      .then((result) => sendResponse(result))
      .catch((error) => sendResponse({ ok: false, error: error.message || 'Could not open RouteCraft' }));
    return true;
  }
  if (message && message.type === 'OPEN_INPUT') {
    openInput(message.input, { disposition: message.disposition || 'newForegroundTab' })
      .then((result) => sendResponse(result))
      .catch((error) => sendResponse({ ok: false, error: error.message || 'Could not open RouteCraft' }));
    return true;
  }
  if (message && message.type === 'GET_SPEC_HEADERS') {
    readSpecHeaders(message.key)
      .then((headers) => sendResponse({ headers }))
      .catch(() => sendResponse({ headers: null }));
    return true;
  }
  if (message && message.type === 'FETCH_PROXY') {
    proxyFetch(message.payload)
      .then((data) => sendResponse({ success: true, data }))
      .catch((error) => sendResponse({ success: false, error: error.message || 'Network request failed' }));
    return true;
  }
  if (message && message.type === 'DETECT_SPEC') {
    detectSpec()
      .then((result) => sendResponse(result))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  return false;
});

