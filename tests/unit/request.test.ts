import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { Credential, RequestDraft } from '../../src/types';
import { parseSpecText } from '../../src/lib/spec/loader';
import { resolverFor } from '../../src/lib/spec/parse';
import {
  RequestBuildError,
  buildComposerRequest,
  joinBaseAndPath,
  makeKeyValue,
  operationBodyInitialValue,
  prepareOperationRequest,
  substitutePathParams,
} from '../../src/lib/request';
import { applyAuth, isAuthorized, requestOAuthToken } from '../../src/lib/auth';

const fixtureDir = fileURLToPath(new URL('../api/fixtures/', import.meta.url));
const fastapi = parseSpecText(readFileSync(fixtureDir + 'fastapi.json', 'utf8'));
const baseUrl = 'http://127.0.0.1:4010';

function operation(key: string) {
  const found = fastapi.operations.find((item) => item.key === key);
  if (!found) throw new Error(`Missing operation ${key}`);
  return found;
}

describe('URL helpers', () => {
  it('joins base URLs and paths without duplicate slashes', () => {
    expect(joinBaseAndPath('http://localhost:8000/', '/pets')).toBe('http://localhost:8000/pets');
    expect(joinBaseAndPath('http://localhost:8000/api', 'pets')).toBe('http://localhost:8000/api/pets');
    expect(joinBaseAndPath('', '/pets')).toBe('/pets');
  });

  it('encodes path parameter values', () => {
    expect(substitutePathParams('/pets/{petId}', { petId: 'a b/c' })).toBe('/pets/a%20b%2Fc');
    expect(substitutePathParams('/pets/{petId}', {})).toBe('/pets/{petId}');
  });
});

describe('prepareOperationRequest', () => {
  it('builds path, query, header and cookie values', () => {
    const prepared = prepareOperationRequest({
      operation: operation('get:/pets/{petId}'),
      spec: fastapi,
      baseUrl,
      values: { 'path:petId': '5', 'cookie:session': 'abc123' },
      bodyText: '',
      contentType: 'application/json',
      credentials: {},
    });
    expect(prepared.method).toBe('GET');
    expect(prepared.url).toBe(`${baseUrl}/pets/5`);
    expect(prepared.headers.Cookie).toBe('session=abc123');
    expect(prepared.headers.Accept).toBe('application/json');
    expect(prepared.bodyText).toBeUndefined();
  });

  it('sends query parameters and auth for a JSON body', () => {
    const prepared = prepareOperationRequest({
      operation: operation('post:/pets'),
      spec: fastapi,
      baseUrl,
      values: {},
      bodyText: '{"name":"Rex"}',
      contentType: 'application/json',
      credentials: { bearerAuth: { type: 'bearer', token: 'demo-token' } },
    });
    expect(prepared.method).toBe('POST');
    expect(prepared.headers.Authorization).toBe('Bearer demo-token');
    expect(prepared.headers['Content-Type']).toBe('application/json');
    expect(prepared.bodyText).toBe('{"name":"Rex"}');
    expect(prepared.appliedAuth).toEqual(['bearerAuth']);
  });

  it('appends query values from query parameters', () => {
    const prepared = prepareOperationRequest({
      operation: operation('get:/pets'),
      spec: fastapi,
      baseUrl,
      values: { 'query:limit': '2', 'query:status': 'available' },
      bodyText: '',
      contentType: 'application/json',
      credentials: {},
    });
    const url = new URL(prepared.url);
    expect(url.pathname).toBe('/pets');
    expect(url.searchParams.get('limit')).toBe('2');
    expect(url.searchParams.get('status')).toBe('available');
  });

  it('rejects an invalid JSON body before sending', () => {
    expect(() =>
      prepareOperationRequest({
        operation: operation('post:/pets'),
        spec: fastapi,
        baseUrl,
        values: {},
        bodyText: '{ nope',
        contentType: 'application/json',
        credentials: {},
      }),
    ).toThrow(RequestBuildError);
  });

  it('leaves the body out when the editor is empty', () => {
    const prepared = prepareOperationRequest({
      operation: operation('post:/pets'),
      spec: fastapi,
      baseUrl,
      values: {},
      bodyText: '   ',
      contentType: 'application/json',
      credentials: {},
    });
    expect(prepared.bodyText).toBeUndefined();
    expect(prepared.headers['Content-Type']).toBeUndefined();
  });

  it('does not overwrite a manually supplied Authorization header', () => {
    const prepared = buildComposerRequest(
      {
        method: 'get',
        url: `${baseUrl}/secure`,
        params: [],
        headers: [makeKeyValue('Authorization', 'Token manual')],
        body: '',
        bodyMode: 'none',
        contentType: 'application/json',
      },
      { bearerAuth: { type: 'bearer', token: 'demo-token' } },
      [{ bearerAuth: [] }],
      fastapi.securitySchemes,
    );
    expect(prepared.headers.Authorization).toBe('Token manual');
  });

  it('generates a body example from the schema', () => {
    const resolver = resolverFor(fastapi);
    const body = operationBodyInitialValue(operation('post:/pets'), resolver);
    expect(body.contentType).toBe('application/json');
    expect(JSON.parse(body.text)).toMatchObject({ name: 'Rex' });
  });
});

describe('buildComposerRequest', () => {
  const draft: RequestDraft = {
    method: 'post',
    url: 'http://127.0.0.1:4010/echo',
    params: [makeKeyValue('page', '2'), makeKeyValue('off', 'x', false)],
    headers: [makeKeyValue('X-Test', 'yes')],
    body: '{"hello":"world"}',
    bodyMode: 'json',
    contentType: 'application/json',
  };

  it('adds query parameters and headers', () => {
    const prepared = buildComposerRequest(draft, {}, undefined, {});
    const url = new URL(prepared.url);
    expect(url.searchParams.get('page')).toBe('2');
    expect(url.searchParams.get('off')).toBeNull();
    expect(prepared.headers['X-Test']).toBe('yes');
    expect(prepared.headers['Content-Type']).toBe('application/json');
    expect(prepared.bodyText).toBe('{"hello":"world"}');
  });

  it('validates JSON bodies', () => {
    expect(() => buildComposerRequest({ ...draft, body: '{' }, {}, undefined, {})).toThrow(
      RequestBuildError,
    );
  });

  it('encodes form bodies', () => {
    const prepared = buildComposerRequest(
      { ...draft, bodyMode: 'form', body: '{"a":"1","b":"two"}' },
      {},
      undefined,
      {},
    );
    expect(prepared.bodyText).toBe('a=1&b=two');
    expect(prepared.headers['Content-Type']).toBe('application/x-www-form-urlencoded');
  });

  it('prepends http:// to bare hosts', () => {
    const prepared = buildComposerRequest({ ...draft, url: 'localhost:4010/health' }, {}, undefined, {});
    expect(prepared.url).toBe('http://localhost:4010/health?page=2');
  });

  it('applies spec auth in the composer', () => {
    const prepared = buildComposerRequest(
      draft,
      { bearerAuth: { type: 'bearer', token: 'abc' } },
      [{ bearerAuth: [] }],
      fastapi.securitySchemes,
    );
    expect(prepared.headers.Authorization).toBe('Bearer abc');
  });
});

describe('authorization', () => {
  const schemes = {
    bearerAuth: { name: 'bearerAuth', type: 'http', scheme: 'bearer' },
    basicAuth: { name: 'basicAuth', type: 'http', scheme: 'basic' },
    keyHeader: { name: 'keyHeader', type: 'apiKey', in: 'header' as const, paramName: 'X-Key' },
    keyQuery: { name: 'keyQuery', type: 'apiKey', in: 'query' as const, paramName: 'api_key' },
    keyCookie: { name: 'keyCookie', type: 'apiKey', in: 'cookie' as const, paramName: 'session' },
    oauth: { name: 'oauth', type: 'oauth2' },
  };

  it('applies header, query and cookie API keys', () => {
    const target = { headers: {} as Record<string, string>, query: {} as Record<string, string>, cookies: {} as Record<string, string> };
    const applied = applyAuth(
      target,
      [{ keyHeader: [], keyQuery: [], keyCookie: [] }],
      schemes,
      {
        keyHeader: { type: 'apiKey', value: 'h' },
        keyQuery: { type: 'apiKey', value: 'q' },
        keyCookie: { type: 'apiKey', value: 'c' },
      },
    );
    expect(target.headers['X-Key']).toBe('h');
    expect(target.query.api_key).toBe('q');
    expect(target.cookies.session).toBe('c');
    expect(applied).toHaveLength(3);
  });

  it('encodes basic credentials', () => {
    const target = { headers: {} as Record<string, string>, query: {} as Record<string, string>, cookies: {} as Record<string, string> };
    applyAuth(target, [{ basicAuth: [] }], schemes, {
      basicAuth: { type: 'basic', username: 'demo', password: 'secret' },
    });
    expect(target.headers.Authorization).toBe('Basic ZGVtbzpzZWNyZXQ=');
  });

  it('accepts any complete security requirement', () => {
    const credentials = { bearerAuth: { type: 'bearer', token: 'x' } } as Record<string, Credential>;
    expect(isAuthorized([{ bearerAuth: [] }], credentials)).toBe(true);
    expect(isAuthorized([{ basicAuth: [] }], credentials)).toBe(false);
    expect(isAuthorized([], credentials)).toBe(false);
  });

  it('applies OAuth access tokens as bearer headers', () => {
    const target = { headers: {} as Record<string, string>, query: {} as Record<string, string>, cookies: {} as Record<string, string> };
    applyAuth(target, [{ oauth: ['read'] }], schemes, {
      oauth: { type: 'oauth2', accessToken: 'token-1' },
    });
    expect(target.headers.Authorization).toBe('Bearer token-1');
  });

  it('preserves an existing bearer prefix', () => {
    const target = { headers: {} as Record<string, string>, query: {} as Record<string, string>, cookies: {} as Record<string, string> };
    applyAuth(target, [{ bearerAuth: [] }], schemes, {
      bearerAuth: { type: 'bearer', token: 'Bearer already' },
    });
    expect(target.headers.Authorization).toBe('Bearer already');
  });

  it('routes OAuth token exchange through the extension proxy', async () => {
    const originalChrome = (globalThis as any).chrome;
    let proxiedUrl = '';
    (globalThis as any).chrome = {
      runtime: {
        id: 'test-extension',
        sendMessage: (message: any, callback: (result: unknown) => void) => {
          proxiedUrl = message.payload.url;
          callback({
            success: true,
            data: {
              status: 200,
              statusText: 'OK',
              headers: { 'content-type': 'application/json' },
              rawText: '{"access_token":"token-from-proxy","token_type":"Bearer"}',
              data: { access_token: 'token-from-proxy', token_type: 'Bearer' },
              latencyMs: 3,
              sizeBytes: 54,
              timestamp: new Date().toISOString(),
            },
          });
        },
      },
    };

    try {
      const result = await requestOAuthToken({
        tokenUrl: 'https://api.example.com/oauth/token',
        grantType: 'client_credentials',
        clientId: 'client',
        clientSecret: 'secret',
      });
      expect(result.accessToken).toBe('token-from-proxy');
      expect(proxiedUrl).toBe('https://api.example.com/oauth/token');
    } finally {
      (globalThis as any).chrome = originalChrome;
    }
  });

  it('reports a clear error when a token endpoint fails', async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response('denied', { status: 401, statusText: 'Unauthorized' })) as typeof fetch;
    await expect(
      requestOAuthToken({ tokenUrl: 'https://example.com/token', grantType: 'client_credentials' }),
    ).rejects.toThrow(/401/);
    globalThis.fetch = original;
  });
});
