import { afterEach, describe, expect, it } from 'vitest';
import { executeRequest } from '../../src/lib/transport';
import { fetchSpecText } from '../../src/lib/spec/loader';
import { getGmBridge, getStorageBridge, isUserScriptMode } from '../../src/lib/gm';

const bridgeKey = '__ROUTECRAFT_GM_REQUEST__';
const storageKey = '__ROUTECRAFT_STORAGE__';
const shadowKey = '__ROUTECRAFT_SHADOW_ROOT__';

afterEach(() => {
  delete (globalThis as Record<string, unknown>)[bridgeKey];
  delete (globalThis as Record<string, unknown>)[storageKey];
  delete (globalThis as Record<string, unknown>)[shadowKey];
});

describe('userscript bridge', () => {
  it('detects the zero-CORS request bridge without confusing it for the userscript overlay', () => {
    expect(getGmBridge()).toBeNull();
    expect(isUserScriptMode()).toBe(false);

    (globalThis as Record<string, unknown>)[bridgeKey] = async () => ({});
    expect(getGmBridge()).toBeTypeOf('function');
    expect(isUserScriptMode()).toBe(false);

    (globalThis as Record<string, unknown>)[shadowKey] = {};
    expect(isUserScriptMode()).toBe(true);
  });

  it('sends requests through GM_xmlhttpRequest and parses the response', async () => {
    (globalThis as Record<string, unknown>)[bridgeKey] = async (request: { method: string; url: string }) => ({
      status: 418,
      statusText: "I'm a Teapot",
      headers: { 'content-type': 'application/json' },
      rawText: JSON.stringify({ requestMethod: request.method, requestUrl: request.url, proxied: true }),
      finalUrl: request.url,
    });

    const result = await executeRequest({
      method: 'GET',
      url: 'http://127.0.0.1:4011/no-cors',
      headers: { Accept: 'application/json' },
    });

    expect(result.status).toBe(418);
    expect(result.data).toMatchObject({
      requestMethod: 'GET',
      requestUrl: 'http://127.0.0.1:4011/no-cors',
      proxied: true,
    });
  });

  it('loads specs through the same bridge', async () => {
    (globalThis as Record<string, unknown>)[bridgeKey] = async () => ({
      status: 200,
      statusText: 'OK',
      headers: { 'content-type': 'application/json' },
      rawText: '{"openapi":"3.0.0","info":{"title":"Bridged API","version":"1"},"paths":{}}',
      finalUrl: 'http://example.test/openapi.json',
    });

    const result = await fetchSpecText('http://example.test/openapi.json');
    expect(result.text).toContain('Bridged API');
    expect(result.finalUrl).toBe('http://example.test/openapi.json');
  });

  it('surfaces the userscript storage bridge', () => {
    const values = new Map<string, string>();
    (globalThis as Record<string, unknown>)[storageKey] = {
      get: (key: string) => values.get(key) ?? null,
      set: (key: string, value: string) => values.set(key, value),
      remove: (key: string) => values.delete(key),
    };

    const storage = getStorageBridge();
    expect(storage).not.toBeNull();
    storage?.set('routecraft.theme', 'dark');
    expect(storage?.get('routecraft.theme')).toBe('dark');
    storage?.remove('routecraft.theme');
    expect(storage?.get('routecraft.theme')).toBeNull();
  });
});
