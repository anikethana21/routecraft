import { describe, expect, it } from 'vitest';
import {
  buildAppUrl,
  normalizeTarget,
  parseTarget,
  suggestionsFor,
} from '../../extension/omnibox.js';

describe('extension popup / omnibox parser', () => {
  it('normalizes ports, local hosts and public hosts', () => {
    expect(normalizeTarget('8010')).toBe('http://127.0.0.1:8010');
    expect(normalizeTarget('localhost:8010')).toBe('http://localhost:8010');
    expect(normalizeTarget('127.0.0.1:8010/docs')).toBe('http://127.0.0.1:8010/docs');
    expect(normalizeTarget('192.168.1.10:8000')).toBe('http://192.168.1.10:8000');
    expect(normalizeTarget('example.com/api')).toBe('https://example.com/api');
    expect(normalizeTarget('//example.com/api')).toBe('https://example.com/api');
    expect(normalizeTarget('http://example.com/openapi.json')).toBe(
      'http://example.com/openapi.json',
    );
  });

  it('parses quoted and unquoted header flags', () => {
    const parsed = parseTarget(
      '8010 -H "Authorization: Bearer demo-token" --header "X-API-Key: demo-key"',
    );
    expect(parsed.target).toBe('http://127.0.0.1:8010');
    expect(parsed.headers).toEqual({
      Authorization: 'Bearer demo-token',
      'X-API-Key': 'demo-key',
    });

    const compact = parseTarget('http://127.0.0.1:4010/protected/openapi.json -H Authorization:Bearer');
    expect(compact.target).toBe('http://127.0.0.1:4010/protected/openapi.json');
    expect(compact.headers).toEqual({ Authorization: 'Bearer' });
  });

  it('supports single quotes and ignores malformed or forbidden headers', () => {
    const parsed = parseTarget(
      "8010 -H 'Authorization: Bearer demo-token' -H 'Host: evil.example' -H 'NoColon'",
    );
    expect(parsed.headers).toEqual({ Authorization: 'Bearer demo-token' });
  });

  it('builds the app deep link with headers and optional operation/server', () => {
    const url = new URL(
      buildAppUrl('chrome-extension://abc/index.html', 'http://127.0.0.1:8010', {
        operation: 'GET /status/{code}',
        server: 'http://127.0.0.1:8010',
        specHeadersKey: 'launch-key',
      }),
    );
    expect(url.searchParams.get('url')).toBe('http://127.0.0.1:8010');
    expect(url.searchParams.get('operation')).toBe('GET /status/{code}');
    expect(url.searchParams.get('server')).toBe('http://127.0.0.1:8010');
    expect(url.searchParams.get('specHeadersKey')).toBe('launch-key');
  });

  it('returns useful address-bar suggestions and escapes markup', () => {
    const defaults = suggestionsFor('');
    expect(defaults.some((item) => item.description.includes('http://127.0.0.1:8010'))).toBe(true);

    const suggestions = suggestionsFor('8010 -H "Authorization: Bearer demo-token"');
    expect(suggestions[0].description).toContain('1 spec header');

    const escaped = suggestionsFor('http://example.com/<demo>');
    expect(escaped[0].description).toContain('&lt;demo&gt;');
    expect(escaped[0].description).not.toContain('<demo>');
  });
});
