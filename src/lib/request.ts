import type {
  ApiOperation,
  Credential,
  KeyValue,
  ParsedSpec,
  RequestDraft,
  SecurityRequirement,
  SecurityScheme,
} from '../types';
import { applyAuth } from './auth';
import { exampleFromMedia, preferredMediaType, isJsonMediaType, isFormMediaType, isMultipartMediaType } from './spec/schema';
import type { RefResolver } from './spec/normalize';

export { executeRequest, RequestExecutionError } from './transport';

export class RequestBuildError extends Error {}

export interface PreparedRequest {
  method: string;
  url: string;
  headers: Record<string, string>;
  bodyText?: string;
  appliedAuth: string[];
}

export function uid(prefix = 'kv'): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}`;
}

export function makeKeyValue(key = '', value = '', enabled = true): KeyValue {
  return { id: uid(), key, value, enabled };
}

export function keyValuesToRecord(rows: KeyValue[]): Record<string, string> {
  const record: Record<string, string> = {};
  for (const row of rows) {
    if (!row.enabled || !row.key.trim()) continue;
    record[row.key.trim()] = row.value;
  }
  return record;
}

export function recordToKeyValues(record: Record<string, string> | undefined, prefix = 'h'): KeyValue[] {
  return Object.entries(record || {}).map(([key, value]) => makeKeyValue(key, value));
}

export function joinBaseAndPath(base: string, path: string): string {
  const cleanBase = (base || '').replace(/\/+$/, '');
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  if (!cleanBase) return cleanPath;
  return cleanBase + cleanPath;
}

export function substitutePathParams(path: string, values: Record<string, string>): string {
  return path.replace(/\{([^}]+)\}/g, (match, name: string) => {
    const value = values[name];
    return value === undefined || value === '' ? match : encodeURIComponent(value);
  });
}

function parseJsonObject(text: string): Record<string, unknown> | null {
  if (!text.trim()) return null;
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
    return null;
  } catch {
    return null;
  }
}

function multipartBody(fields: Record<string, unknown>, boundary: string): string {
  const chunks: string[] = [];
  for (const [name, value] of Object.entries(fields)) {
    const stringValue = typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value ?? '');
    chunks.push(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${stringValue}\r\n`);
  }
  chunks.push(`--${boundary}--\r\n`);
  return chunks.join('');
}

export function prepareOperationRequest(options: {
  operation: ApiOperation;
  spec: ParsedSpec;
  baseUrl: string;
  values: Record<string, string>;
  bodyText: string;
  contentType: string;
  credentials: Record<string, Credential>;
}): PreparedRequest {
  const { operation, spec, baseUrl, values, bodyText, contentType, credentials } = options;
  const pathValues: Record<string, string> = {};
  const query: Record<string, string> = {};
  const headers: Record<string, string> = {};
  const cookies: Record<string, string> = {};

  for (const param of operation.parameters) {
    const value = values[param.key];
    if (value === undefined) continue;
    if (param.in === 'path') pathValues[param.name] = value;
    else if (param.in === 'query' && value !== '') query[param.name] = value;
    else if (param.in === 'header' && value !== '') headers[param.name] = value;
    else if (param.in === 'cookie' && value !== '') cookies[param.name] = value;
  }

  const path = substitutePathParams(operation.path, pathValues);
  let url = joinBaseAndPath(baseUrl, path);
  url = appendQuery(url, query);

  let bodyTextOut: string | undefined;
  const body = operation.requestBody;
  if (body && contentType) {
    const media = body.content[contentType];
    if (media) {
      const trimmed = bodyText.trim();
      if (!trimmed) {
        bodyTextOut = undefined;
      } else if (isJsonMediaType(contentType)) {
        try {
          JSON.parse(trimmed);
          bodyTextOut = trimmed;
        } catch (error: any) {
          throw new RequestBuildError(`Request body is not valid JSON: ${error.message}`);
        }
      } else if (isFormMediaType(contentType)) {
        const object = parseJsonObject(trimmed);
        bodyTextOut = object ? new URLSearchParams(Object.entries(object).map(([k, v]) => [k, String(v)])).toString() : trimmed;
      } else if (isMultipartMediaType(contentType)) {
        const boundary = `----RouteCraft${Math.random().toString(16).slice(2)}`;
        const object = parseJsonObject(trimmed);
        bodyTextOut = object ? multipartBody(object, boundary) : trimmed;
        headers['Content-Type'] = `multipart/form-data; boundary=${boundary}`;
      } else {
        bodyTextOut = trimmed;
      }
      if (!headers['Content-Type'] && bodyTextOut && !isMultipartMediaType(contentType)) {
        headers['Content-Type'] = contentType;
      }
    }
  }

  const appliedAuth = applyAuth(
    { headers, query, cookies },
    operation.security ?? spec.security,
    spec.securitySchemes,
    credentials,
  );
  if (Object.keys(query).length > 0) {
    // applyAuth may have added API-key query params after the first append.
    url = appendQuery(url, query);
  }
  if (Object.keys(cookies).length > 0) {
    headers.Cookie = Object.entries(cookies)
      .map(([key, value]) => `${key}=${value}`)
      .join('; ');
  }
  if (!headers.Accept) headers.Accept = 'application/json';

  return { method: operation.method.toUpperCase(), url, headers, bodyText: bodyTextOut, appliedAuth };
}

export function appendQuery(url: string, query: Record<string, string>): string {
  if (Object.keys(query).length === 0) return url;
  try {
    const parsed = new URL(url);
    for (const [key, value] of Object.entries(query)) {
      parsed.searchParams.set(key, value);
    }
    return parsed.toString();
  } catch {
    const separator = url.includes('?') ? '&' : '?';
    const params = new URLSearchParams(query).toString();
    return `${url}${separator}${params}`;
  }
}

export function buildComposerRequest(
  draft: RequestDraft,
  credentials: Record<string, Credential>,
  requirements: SecurityRequirement[] | undefined,
  schemes: Record<string, SecurityScheme>,
): PreparedRequest {
  const query = keyValuesToRecord(draft.params);
  const headers = keyValuesToRecord(draft.headers);
  const cookies: Record<string, string> = {};

  let url = draft.url.trim();
  if (!/^https?:\/\//i.test(url) && url) url = `http://${url}`;
  url = appendQuery(url, query);

  let bodyText: string | undefined;
  if (draft.bodyMode === 'json') {
    if (draft.body.trim()) {
      try {
        JSON.parse(draft.body);
      } catch (error: any) {
        throw new RequestBuildError(`Body is not valid JSON: ${error.message}`);
      }
      bodyText = draft.body;
    }
    if (!headers['Content-Type']) headers['Content-Type'] = 'application/json';
  } else if (draft.bodyMode === 'form') {
    const object = parseJsonObject(draft.body);
    bodyText = object ? new URLSearchParams(Object.entries(object).map(([k, v]) => [k, String(v)])).toString() : draft.body;
    if (!headers['Content-Type']) headers['Content-Type'] = 'application/x-www-form-urlencoded';
  } else if (draft.bodyMode === 'text') {
    bodyText = draft.body;
    if (!headers['Content-Type']) headers['Content-Type'] = 'text/plain';
  }

  const appliedAuth = applyAuth({ headers, query, cookies }, requirements, schemes, credentials);
  if (Object.keys(query).length > 0) url = appendQuery(url, query);
  if (Object.keys(cookies).length > 0) {
    headers.Cookie = Object.entries(cookies).map(([key, value]) => `${key}=${value}`).join('; ');
  }

  return {
    method: draft.method.toUpperCase(),
    url,
    headers,
    bodyText,
    appliedAuth,
  };
}

export function operationBodyInitialValue(
  operation: ApiOperation,
  resolver: RefResolver,
): { contentType: string; text: string } {
  const content = operation.requestBody?.content;
  if (!content) return { contentType: 'application/json', text: '' };
  const contentType = preferredMediaType(content);
  const media = content[contentType];
  const example = exampleFromMedia(media, resolver, { mode: 'request' });
  const text =
    example === null || example === undefined
      ? ''
      : typeof example === 'string'
        ? example
        : JSON.stringify(example, null, 2);
  return { contentType, text };
}
