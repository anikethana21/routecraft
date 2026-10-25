/**
 * Bridge helpers for the optional Tampermonkey userscript build.
 *
 * The userscript injects the same React app into a shadow root. It installs a
 * `GM_xmlhttpRequest` bridge before the app bundle executes, which gives the
 * app the same zero-CORS behaviour as the Chrome extension without needing a
 * separate extension install.
 */

export interface GmBridgeRequest {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
}

export interface GmBridgeResponse {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  rawText: string;
  finalUrl?: string;
}

export type GmBridge = (request: GmBridgeRequest) => Promise<GmBridgeResponse>;

export interface StorageBridge {
  get: (key: string) => string | null;
  set: (key: string, value: string) => void;
  remove: (key: string) => void;
}

function bridgeFromGlobal<T>(key: string): T | null {
  const value = (globalThis as Record<string, unknown>)[key];
  return typeof value === 'object' && value !== null ? (value as T) : null;
}

export function getGmBridge(): GmBridge | null {
  const bridge = (globalThis as Record<string, unknown>).__ROUTECRAFT_GM_REQUEST__;
  return typeof bridge === 'function' ? (bridge as GmBridge) : null;
}

export function getStorageBridge(): StorageBridge | null {
  return bridgeFromGlobal<StorageBridge>('__ROUTECRAFT_STORAGE__');
}

export function isUserScriptMode(): boolean {
  // A GM bridge can also be injected by the local MCP browser server. Only
  // the shadow root means the app is living inside the userscript overlay.
  return Boolean((globalThis as Record<string, unknown>).__ROUTECRAFT_SHADOW_ROOT__);
}

export function getUserScriptHost(): HTMLElement | null {
  if (typeof document === 'undefined') return null;
  return document.getElementById('routecraft-userscript-host');
}
