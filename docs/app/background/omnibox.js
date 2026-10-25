/**
 * Pure parsing helpers for the extension popup and the Chrome omnibox.
 *
 * The popup accepts `8010`, `localhost:8010`, a docs URL, or a spec URL.
 * `-H "Name: Value"` adds a header that the MV3 service worker sends when it
 * fetches a protected OpenAPI document. Keeping this file free of Chrome APIs
 * makes the syntax testable in Vitest.
 */

const LOCAL_HOST =
  /^(localhost|127(?:\.\d{1,3}){3}|0\.0\.0\.0|\[::1\])(?::\d+)?(?:[/?#].*)?$/i;
const IPV4_HOST = /^\d{1,3}(?:\.\d{1,3}){3}(?::\d+)?(?:[/?#].*)?$/;
const HOST_WITH_PATH = /^[\w.-]+(?::\d+)?(?:[/?#].*)?$/;
const FORBIDDEN_HEADERS = new Set([
  'accept-encoding',
  'connection',
  'content-length',
  'cookie',
  'host',
  'origin',
  'proxy-authorization',
  'referer',
  'set-cookie',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'user-agent',
]);

/** Split on whitespace while keeping quoted values together. */
export function tokenize(input) {
  const tokens = [];
  let current = '';
  let quote = null;
  const text = String(input || '');
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quote) {
      if (character === quote) quote = null;
      else current += character;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (/\s/.test(character)) {
      if (current) {
        tokens.push(current);
        current = '';
      }
      continue;
    }
    current += character;
  }
  if (current) tokens.push(current);
  return tokens;
}

/** Normalize a port, hostname, docs URL or spec URL to an absolute URL. */
export function normalizeTarget(input) {
  const value = String(input || '').trim();
  if (!value) return '';
  if (/^\d+$/.test(value)) return `http://127.0.0.1:${value}`;
  if (/^https?:\/\//i.test(value)) return value;
  if (value.startsWith('//')) return `https:${value}`;
  if (LOCAL_HOST.test(value)) return `http://${value}`;
  if (IPV4_HOST.test(value)) return `http://${value}`;
  if (HOST_WITH_PATH.test(value) && !value.includes(' ')) return `https://${value}`;
  return value;
}

/**
 * Parse one popup/omnibox line into a target URL and headers.
 * Headers are written as `-H "Authorization: Bearer token"`.
 */
export function parseTarget(input) {
  const raw = String(input || '');
  const tokens = tokenize(raw);
  const positional = [];
  const headers = {};

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === '-H' || token === '--header') {
      const header = tokens[index + 1];
      if (!header) continue;
      index += 1;
      const separator = header.indexOf(':');
      if (separator <= 0) continue;
      const name = header.slice(0, separator).trim();
      const value = header.slice(separator + 1).trim();
      if (!name || FORBIDDEN_HEADERS.has(name.toLowerCase())) continue;
      headers[name] = value;
      continue;
    }
    positional.push(token);
  }

  return {
    raw,
    target: normalizeTarget(positional[0] || ''),
    headers,
  };
}

/** Build the full-tab app URL with the deep-link parameters it understands. */
export function buildAppUrl(base, target, options = {}) {
  const url = new URL(base);
  if (target) url.searchParams.set('url', target);
  if (options.operation) url.searchParams.set('operation', options.operation);
  if (options.server) url.searchParams.set('server', options.server);
  if (options.specHeadersKey) url.searchParams.set('specHeadersKey', options.specHeadersKey);
  return url.toString();
}

function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Suggestions rendered in Chrome's address bar after the `rc` keyword. */
export function suggestionsFor(input) {
  const parsed = parseTarget(input);
  if (!parsed.target) {
    return [
      {
        content: '8010',
        description:
          'Open <match>http://127.0.0.1:8010</match> <dim>(FastAPI / Java demo)</dim>',
      },
      {
        content: '3000',
        description: 'Open <match>http://127.0.0.1:3000</match>',
      },
      {
        content: 'http://127.0.0.1:8010/openapi.json',
        description: 'Open an OpenAPI document',
      },
      {
        content: '8010 -H "Authorization: Bearer "',
        description: 'Open a protected spec with a header',
      },
    ];
  }

  const headerCount = Object.keys(parsed.headers).length;
  const target = escapeXml(parsed.target);
  const suggestions = [
    {
      content: parsed.raw.trim() || parsed.target,
      description: `Open <match>${target}</match>${
        headerCount
          ? ` <dim>with ${headerCount} spec header${headerCount === 1 ? '' : 's'}</dim>`
          : ''
      }`,
    },
  ];
  if (!headerCount) {
    suggestions.push({
      content: `${parsed.raw.trim()} -H "Authorization: Bearer "`,
      description: 'Add a header for a protected OpenAPI document',
    });
  }
  return suggestions;
}
