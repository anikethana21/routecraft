/**
 * Wrap the self-contained Vite IIFE bundle in Tampermonkey metadata and a
 * shadow-root bootstrapper.
 *
 * The app stays isolated from the host page: page CSS cannot leak in, app CSS
 * cannot leak out, and the whole overlay is mounted under one fixed host.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const root = resolve(here, '..');
const outDir = resolve(root, 'dist-userscript');
const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));

if (!process.argv.includes('--no-build')) {
  const vite = resolve(root, 'node_modules', 'vite', 'bin', 'vite.js');
  execFileSync(process.execPath, [vite, 'build', '--config', 'vite.userscript.config.ts'], {
    cwd: root,
    stdio: 'inherit',
  });
}

const files = readdirSync(outDir);
const jsName = files.find((name) => name.endsWith('-app.js'));
const cssName = files.find((name) => name.endsWith('-app.css'));
if (!jsName || !cssName) throw new Error(`Could not find the userscript JS/CSS in ${outDir}.`);

let appJs = readFileSync(resolve(outDir, jsName), 'utf8').replace(/\n?\/\/# sourceMappingURL=.*$/u, '');
const appCss = readFileSync(resolve(outDir, cssName), 'utf8');

// CSS is injected into a shadow root. Convert document-level selectors to
// host-level selectors so the app's variables, dark theme and body typography
// still work without touching the page.
const shadowCss = appCss
  .replace(/:root\s*\{/g, ':host {')
  .replace(/html\[data-theme=(?:"dark"|'dark'|dark)\]/g, ':host([data-theme="dark"])')
  .replace(/html\{scroll-behavior:smooth\}/g, '')
  // Only the document-level body rule, never a class name ending in "-body".
  .replace(/(^|[},])\s*body\s*\{/g, '$1\n#root {');

const wrapper = `(function () {
  'use strict';
  if (window.top !== window.self) return;

  var HOST_ID = 'routecraft-userscript-host';
  if (document.getElementById(HOST_ID)) return;

  var APP_CSS = ${JSON.stringify(shadowCss)};
  var EXTRA_CSS = [
    ':host {',
    '  display: block;',
    '  position: fixed;',
    '  inset: 0;',
    '  z-index: 2147483600;',
    '  overflow: hidden;',
    '  background: var(--bg);',
    '  color: var(--text);',
    '  font-family: var(--font-sans);',
    '  font-size: 14px;',
    '  line-height: 1.5;',
    '  -webkit-font-smoothing: antialiased;',
    '  text-rendering: optimizeLegibility;',
    '}',
    '#root { height: 100%; overflow-y: auto; overscroll-behavior: contain; }',
    '.os-close {',
    '  position: fixed; right: 10px; bottom: 12px; z-index: 2147483647;',
    '  display: inline-flex; align-items: center; justify-content: center;',
    '  width: 36px; height: 36px; padding: 0; border: 1px solid var(--border-strong); border-radius: 999px;',
    '  background: var(--surface); color: var(--text-2);',
    '  font: 500 19px/1 var(--font-sans); box-shadow: var(--shadow-md); cursor: pointer;',
    '}',
    '.os-close:hover { background: var(--surface-2); }',
    '.os-close:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }'
  ].join('\\n');

  var appHost = document.createElement('div');
  appHost.id = HOST_ID;
  appHost.setAttribute('data-routecraft', '');
  appHost.style.cssText = 'position:fixed;inset:0;z-index:2147483600;display:none;';
  var shadow = appHost.attachShadow({ mode: 'open' });
  var style = document.createElement('style');
  style.textContent = APP_CSS + '\\n' + EXTRA_CSS;
  shadow.appendChild(style);
  var root = document.createElement('div');
  root.id = 'root';
  shadow.appendChild(root);
  var closeButton = document.createElement('button');
  closeButton.type = 'button';
  closeButton.className = 'os-close';
  closeButton.title = 'Close RouteCraft (Esc)';
  closeButton.setAttribute('aria-label', 'Close RouteCraft');
  closeButton.textContent = '\\u00d7';
  shadow.appendChild(closeButton);
  window.__ROUTECRAFT_SHADOW_ROOT__ = shadow;
  document.documentElement.appendChild(appHost);

  function toHeaders(raw) {
    var headers = {};
    String(raw || '').split(/\\r?\\n/).forEach(function (line) {
      var index = line.indexOf(':');
      if (index <= 0) return;
      var key = line.slice(0, index).trim().toLowerCase();
      var value = line.slice(index + 1).trim();
      if (key) headers[key] = value;
    });
    return headers;
  }

  function gmRequest(request) {
    return new Promise(function (resolve, reject) {
      if (typeof GM_xmlhttpRequest !== 'function') {
        reject(new Error('GM_xmlhttpRequest is unavailable.'));
        return;
      }
      var details = {
        method: request.method || 'GET',
        url: request.url,
        headers: request.headers || {},
        timeout: request.timeoutMs || 90000,
        responseType: 'text',
        onload: function (response) {
          resolve({
            status: response.status,
            statusText: response.statusText || '',
            headers: toHeaders(response.responseHeaders),
            rawText: response.responseText || '',
            finalUrl: response.finalUrl || request.url
          });
        },
        onerror: function (response) {
          reject(new Error((response && response.statusText) || 'The userscript network request failed.'));
        },
        ontimeout: function () {
          reject(new Error('The userscript request timed out.'));
        },
        onabort: function () {
          reject(new Error('The userscript request was aborted.'));
        }
      };
      if (request.body !== undefined && request.body !== null && !['GET', 'HEAD'].includes(String(details.method).toUpperCase())) {
        details.data = request.body;
      }
      try {
        GM_xmlhttpRequest(details);
      } catch (error) {
        reject(error);
      }
    });
  }
  window.__ROUTECRAFT_GM_REQUEST__ = gmRequest;

  function fallbackGet(key) {
    try { return localStorage.getItem(key); } catch (error) { return null; }
  }
  function fallbackSet(key, value) {
    try { localStorage.setItem(key, value); } catch (error) { /* ignore */ }
  }
  function fallbackRemove(key) {
    try { localStorage.removeItem(key); } catch (error) { /* ignore */ }
  }
  var storage = {
    get: function (key) {
      try {
        if (typeof GM_getValue === 'function') {
          var value = GM_getValue(key, null);
          return value === undefined ? null : value;
        }
      } catch (error) { /* fall through */ }
      return fallbackGet(key);
    },
    set: function (key, value) {
      try {
        if (typeof GM_setValue === 'function') {
          GM_setValue(key, value);
          return;
        }
      } catch (error) { /* fall through */ }
      fallbackSet(key, value);
    },
    remove: function (key) {
      try {
        if (typeof GM_deleteValue === 'function') {
          GM_deleteValue(key);
          return;
        }
      } catch (error) { /* fall through */ }
      fallbackRemove(key);
    }
  };
  window.__ROUTECRAFT_STORAGE__ = storage;

  function absoluteUrl(value) {
    try { return new URL(value, location.href).href; } catch (error) { return ''; }
  }

  function detectSpecUrl() {
    try {
      var path = location.pathname || '';
      var title = document.title || '';
      var links = document.querySelectorAll('link[href], a[href]');
      for (var index = 0; index < links.length; index += 1) {
        var href = links[index].getAttribute('href');
        if (!href || href.charAt(0) === '#') continue;
        var candidate = absoluteUrl(href);
        if (candidate && /(openapi|swagger|api-docs)/i.test(candidate) && /\\.(json|ya?ml)(\\?|#|$)/i.test(candidate)) {
          return candidate;
        }
      }
      if (/\\.(json|ya?ml)(\\?|#|$)/i.test(path) && /(openapi|swagger|spec)/i.test(path)) {
        return location.href;
      }
      if (/\\/(docs|redoc|swagger|swagger-ui|api-docs)(\\/|$)/i.test(path)
          || /\\b(swagger|openapi|api docs)\\b/i.test(title)) {
        return location.origin;
      }
    } catch (error) { /* ignore detection errors */ }
    return null;
  }

  var openState = false;
  var openedOnce = false;
  var lastDetected = null;
  var previousOverflow = '';

  function openApp() {
    if (openState) return;
    openState = true;
    var detected = detectSpecUrl();
    previousOverflow = document.documentElement.style.overflow;
    appHost.style.display = 'block';
    document.documentElement.style.overflow = 'hidden';

    if (detected && detected !== lastDetected) {
      lastDetected = detected;
      openedOnce = true;
      window.setTimeout(function () {
        window.dispatchEvent(new CustomEvent('routecraft:open', { detail: { url: detected } }));
      }, 30);
    } else if (!openedOnce) {
      openedOnce = true;
      window.setTimeout(function () {
        window.dispatchEvent(new CustomEvent('routecraft:open'));
      }, 30);
    }
  }

  function closeApp() {
    if (!openState) return;
    openState = false;
    appHost.style.display = 'none';
    document.documentElement.style.overflow = previousOverflow;
  }

  closeButton.addEventListener('click', closeApp);
  window.addEventListener('keydown', function (event) {
    if (event.key === 'Escape' && openState) {
      event.preventDefault();
      closeApp();
      return;
    }
    if (!openState && event.altKey && event.shiftKey && (event.key === 'S' || event.key === 's')) {
      event.preventDefault();
      openApp();
    }
  }, true);
})();

`;

const header = `// ==UserScript==
// @name         RouteCraft
// @namespace    https://github.com/anikethana21/routecraft
// @version      ${pkg.version}
// @description  RouteCraft - a clean OpenAPI explorer with a built-in request console.
// @author       RouteCraft
// @license      MIT
// @homepageURL  https://anikethana21.github.io/routecraft/
// @supportURL   https://github.com/anikethana21/routecraft/issues
// @updateURL    https://anikethana21.github.io/routecraft/routecraft.user.js
// @downloadURL  https://anikethana21.github.io/routecraft/routecraft.user.js
// @icon         https://anikethana21.github.io/routecraft/icon128.png
// @match        *://*/*
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @connect      *
// @run-at       document-idle
// @noframes
// ==/UserScript==

/*
 * Generated by scripts/build-userscript.mjs. Do not edit by hand.
 * Press Alt+Shift+S to open the app.
 */
`;

const output = resolve(root, 'routecraft.user.js');
writeFileSync(output, header + wrapper + appJs + '\n', 'utf8');
console.log(`Wrote ${output}`);
console.log(`  app JS:  ${(appJs.length / 1024).toFixed(0)} KB`);
console.log(`  app CSS: ${(appCss.length / 1024).toFixed(0)} KB`);
console.log(`  total:   ${(readFileSync(output).length / 1024).toFixed(0)} KB`);
