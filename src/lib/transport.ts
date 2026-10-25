import type { HttpResponseResult } from '../types';
import { getGmBridge } from './gm';

declare const chrome: any;

/** Error raised when a request cannot be delivered or the target times out. */
export class RequestExecutionError extends Error {
  kind: 'cors' | 'network' | 'timeout' | 'proxy';
  detail?: string;
  constructor(kind: 'cors' | 'network' | 'timeout' | 'proxy', message: string, detail?: string) {
    super(message);
    this.name = 'RequestExecutionError';
    this.kind = kind;
    this.detail = detail;
  }
}

export interface TransportRequest {
  method: string;
  url: string;
  headers: Record<string, string>;
  bodyText?: string;
}

export function isChromeExtension(): boolean {
  return typeof chrome !== 'undefined' && Boolean(chrome?.runtime?.sendMessage) && Boolean(chrome?.runtime?.id);
}

function parseResponseBody(text: string, contentType: string): unknown {
  if (!text) return null;
  if (/json/i.test(contentType) || /^[\s]*[[{]/.test(text)) {
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }
  return text;
}

function toResult(
  started: number,
  rawText: string,
  status: number,
  statusText: string,
  headers: Record<string, string>,
  finalUrl?: string,
): HttpResponseResult {
  return {
    status,
    statusText,
    headers,
    data: parseResponseBody(rawText, headers['content-type'] || ''),
    rawText,
    latencyMs: Math.round(performance.now() - started),
    sizeBytes: new Blob([rawText]).size,
    timestamp: new Date().toISOString(),
    finalUrl,
    contentType: headers['content-type'],
  };
}

async function proxyRequest(prepared: TransportRequest): Promise<HttpResponseResult> {
  const response = await new Promise<any>((resolve, reject) => {
    const timer = setTimeout(() => reject(new RequestExecutionError('timeout', 'The request timed out after 90 seconds.')), 90000);
    try {
      chrome.runtime.sendMessage(
        {
          type: 'FETCH_PROXY',
          payload: {
            url: prepared.url,
            options: {
              method: prepared.method,
              headers: prepared.headers,
              body: prepared.bodyText,
            },
          },
        },
        (result: any) => {
          clearTimeout(timer);
          if (chrome.runtime?.lastError) reject(new RequestExecutionError('proxy', chrome.runtime.lastError.message));
          else resolve(result);
        },
      );
    } catch (error: any) {
      clearTimeout(timer);
      reject(new RequestExecutionError('proxy', error.message));
    }
  });
  if (!response?.success || !response.data) {
    throw new RequestExecutionError('network', response?.error || 'The request failed.');
  }
  return response.data as HttpResponseResult;
}

async function userscriptRequest(prepared: TransportRequest): Promise<HttpResponseResult> {
  const bridge = getGmBridge();
  if (!bridge) throw new RequestExecutionError('proxy', 'The userscript request bridge is unavailable.');
  const started = performance.now();
  try {
    const response = await bridge({
      url: prepared.url,
      method: prepared.method,
      headers: prepared.headers,
      body: prepared.bodyText,
      timeoutMs: 90000,
    });
    return toResult(
      started,
      response.rawText || '',
      response.status,
      response.statusText || '',
      response.headers || {},
      response.finalUrl || prepared.url,
    );
  } catch (error: any) {
    if (/timed?\s*out|timeout/i.test(error?.message || '')) {
      throw new RequestExecutionError('timeout', 'The request timed out after 90 seconds.');
    }
    throw new RequestExecutionError('network', error?.message || 'The userscript request failed.', String(error));
  }
}

async function directRequest(prepared: TransportRequest): Promise<HttpResponseResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60000);
  const started = performance.now();
  try {
    const response = await fetch(prepared.url, {
      method: prepared.method,
      headers: prepared.headers,
      body: ['GET', 'HEAD'].includes(prepared.method) ? undefined : prepared.bodyText,
      signal: controller.signal,
      credentials: 'omit',
      redirect: 'follow',
    });
    const rawText = await response.text();
    const headers: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      headers[key] = value;
    });
    return toResult(started, rawText, response.status, response.statusText, headers, response.url);
  } finally {
    clearTimeout(timer);
  }
}

async function devProxyRequest(prepared: TransportRequest): Promise<HttpResponseResult> {
  const started = performance.now();
  const response = await fetch(`/__cors_proxy?url=${encodeURIComponent(prepared.url)}`, {
    method: prepared.method,
    headers: prepared.headers,
    body: ['GET', 'HEAD'].includes(prepared.method) ? undefined : prepared.bodyText,
    credentials: 'omit',
  });
  if (response.status === 404) {
    throw new RequestExecutionError('proxy', 'No development proxy is available.');
  }
  const rawText = await response.text();
  const headers: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    if (!['access-control-allow-origin', 'access-control-allow-headers', 'access-control-allow-methods'].includes(key)) {
      headers[key] = value;
    }
  });
  return toResult(started, rawText, response.status, response.statusText, headers, prepared.url);
}

/**
 * Send a request through the extension proxy when available, otherwise
 * directly, with a development proxy as a last resort.
 *
 * Keep all network traffic in one place so every feature - API calls, OAuth
 * token exchange and spec loading - gets the same zero-CORS behaviour.
 */
export async function executeRequest(prepared: TransportRequest): Promise<HttpResponseResult> {
  if (isChromeExtension()) {
    try {
      return await proxyRequest(prepared);
    } catch (error) {
      if (error instanceof RequestExecutionError && error.kind === 'timeout') throw error;
    }
  }

  if (getGmBridge()) {
    return userscriptRequest(prepared);
  }

  try {
    return await directRequest(prepared);
  } catch (error: any) {
    if (error?.name === 'AbortError') {
      throw new RequestExecutionError('timeout', 'The request timed out after 60 seconds.');
    }
    // A dev proxy turns "Failed to fetch" into a real response when running
    // `npm run dev`. It is harmless in production and reports a clear error.
    try {
      return await devProxyRequest(prepared);
    } catch (proxyError: any) {
      if (proxyError instanceof RequestExecutionError && proxyError.kind === 'timeout') throw proxyError;
      const isCors = error instanceof TypeError;
      throw new RequestExecutionError(
        isCors ? 'cors' : 'network',
        isCors
          ? 'The browser blocked this request (CORS), or the server could not be reached.'
          : error?.message || 'The request failed.',
        isCors
          ? 'The Chrome extension or Tampermonkey userscript sends requests without CORS restrictions. In a plain browser tab, enable CORS on the API or use the development server.'
          : undefined,
      );
    }
  }
}
