import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type {
  CodeRequest,
  Credential,
  HistoryEntry,
  HttpMethod,
  ParsedSpec,
  RecentSpec,
  RequestDraft,
  SpecSource,
  Theme,
} from '../types';
import { loadSpecFromText, loadSpecFromUrl, readLaunchSpecHeaders, SpecLoadError } from '../lib/spec/loader';
import type { LoadedSpec } from '../lib/spec/loader';
import { resolverFor } from '../lib/spec/parse';
import {
  resolveServerUrl,
  safeOrigin,
  substituteServerVariables,
  type RefResolver,
} from '../lib/spec/normalize';
import {
  addRecent,
  loadComposer,
  loadCredentials,
  loadRecent,
  loadServerOverride,
  loadSource,
  loadTheme,
  saveComposer,
  saveCredentials,
  saveServerOverride,
  saveSource,
  saveTheme,
} from '../lib/storage';
import { recordToKeyValues } from '../lib/request';
import type { CredentialMap } from '../lib/auth';
import { getUserScriptHost, isUserScriptMode } from '../lib/gm';

export type View = 'landing' | 'docs' | 'composer';

export interface LoadErrorState {
  message: string;
  hint?: string;
  attempts?: string[];
}

interface ToastState {
  id: number;
  message: string;
  tone: 'success' | 'error' | 'info';
}

interface CodeModalState {
  request: CodeRequest;
  title?: string;
}

interface AppContextValue {
  view: View;
  setView: (view: View) => void;
  spec: ParsedSpec | null;
  source: SpecSource | null;
  resolver: RefResolver | null;
  loading: boolean;
  error: LoadErrorState | null;
  recent: RecentSpec[];
  theme: Theme;
  setTheme: (theme: Theme) => void;
  resolvedTheme: 'light' | 'dark';
  servers: Array<{ url: string; description?: string }>;
  activeServer: string;
  setActiveServer: (url: string) => void;
  focusOperation: string | null;
  clearFocusOperation: () => void;
  credentials: CredentialMap;
  setCredentials: (credentials: CredentialMap) => void;
  authOpen: boolean;
  openAuth: () => void;
  closeAuth: () => void;
  historyOpen: boolean;
  openHistory: () => void;
  closeHistory: () => void;
  codeModal: CodeModalState | null;
  openCode: (request: CodeRequest, title?: string) => void;
  closeCode: () => void;
  toast: ToastState | null;
  notify: (message: string, tone?: ToastState['tone']) => void;
  dismissToast: () => void;
  composerDraft: RequestDraft;
  updateComposerDraft: (draft: RequestDraft) => void;
  loadHistoryIntoComposer: (entry: HistoryEntry) => void;
  endpointFilter: string;
  setEndpointFilter: (value: string) => void;
  loadUrl: (url: string, headers?: Record<string, string>) => Promise<void>;
  loadText: (text: string, label: string) => Promise<void>;
  loadFile: (file: File) => Promise<void>;
  reload: () => Promise<void>;
  goLanding: () => void;
  closeSpec: () => void;
  clearError: () => void;
}

const AppContext = createContext<AppContextValue | undefined>(undefined);

const DEFAULT_COMPOSER: RequestDraft = {
  method: 'get',
  url: '',
  params: [],
  headers: [],
  body: '',
  bodyMode: 'none',
  contentType: 'application/json',
};

function toLoadError(error: unknown): LoadErrorState {
  if (error instanceof SpecLoadError) {
    return { message: error.message, hint: error.hint, attempts: error.attempts };
  }
  return { message: error instanceof Error ? error.message : String(error) };
}

function specKeyOf(source: SpecSource | null, spec: ParsedSpec | null): string {
  return source?.url || source?.value || spec?.title || 'default';
}

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [view, setView] = useState<View>('landing');
  const [spec, setSpec] = useState<ParsedSpec | null>(null);
  const [source, setSource] = useState<SpecSource | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<LoadErrorState | null>(null);
  const [recent, setRecent] = useState<RecentSpec[]>(() => loadRecent());
  const [theme, setThemeState] = useState<Theme>(() => loadTheme());
  const [resolvedTheme, setResolvedTheme] = useState<'light' | 'dark'>('light');
  const [credentials, setCredentialsState] = useState<CredentialMap>({});
  const [serverOverride, setServerOverrideState] = useState<string | null>(null);
  const [endpointFilter, setEndpointFilter] = useState('');
  const [focusOperation, setFocusOperation] = useState<string | null>(null);
  const [authOpen, setAuthOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [codeModal, setCodeModal] = useState<CodeModalState | null>(null);
  const [toast, setToast] = useState<ToastState | null>(null);
  const [composerDraft, setComposerDraft] = useState<RequestDraft>(() => {
    const stored = loadComposer<RequestDraft>(DEFAULT_COMPOSER);
    return {
      ...DEFAULT_COMPOSER,
      ...stored,
      params: Array.isArray(stored.params) ? stored.params : [],
      headers: Array.isArray(stored.headers) ? stored.headers : [],
    };
  });
  const requestId = useRef(0);
  const booted = useRef(false);
  const launchParams = useRef(new URLSearchParams(window.location.search));
  const launchConsumed = useRef(false);
  const autoComposerUrl = useRef('');
  const composerUrlRef = useRef(composerDraft.url);
  const lastSpecKeyRef = useRef('');
  const specHeadersRef = useRef(new Map<string, Record<string, string>>());

  const specKey = specKeyOf(source, spec);
  const resolver = useMemo(() => (spec ? resolverFor(spec) : null), [spec]);

  const servers = useMemo(() => {
    if (!spec) return [];
    const resolved = spec.servers.map((server) => ({
      url: resolveServerUrl(substituteServerVariables(server), source?.url || source?.value),
      description: server.description,
    }));
    if (resolved.length === 0) {
      const origin = source?.url ? safeOrigin(source.url) : source?.kind === 'url' ? safeOrigin(source.value) : '';
      if (origin) resolved.push({ url: origin, description: 'Spec origin' });
    }
    const seen = new Set<string>();
    return resolved.filter((server) => {
      if (!server.url || seen.has(server.url)) return false;
      seen.add(server.url);
      return true;
    });
  }, [spec, source]);

  const activeServer = serverOverride || servers[0]?.url || '';

  const applyLoaded = useCallback((loaded: LoadedSpec, options: { keepView?: boolean } = {}) => {
    const key = loaded.source.url || loaded.source.value;
    const isLaunchLoad = !launchConsumed.current;
    launchConsumed.current = true;
    setSpec(loaded.spec);
    setSource(loaded.source);
    setError(null);
    setEndpointFilter('');
    setCredentialsState(loadCredentials(key));
    if (!isUserScriptMode()) {
      // `?server=` and `?operation=` belong to the launch URL only. Applying
      // them to later pasted specs would pin the old port and operation.
      const serverParam = isLaunchLoad ? launchParams.current.get('server') : null;
      if (serverParam) {
        // MCP and other launchers can override the spec's server for this tab.
        setServerOverrideState(serverParam);
        saveServerOverride(key, serverParam);
      } else {
        setServerOverrideState(loadServerOverride(key));
      }
      if (isLaunchLoad) setFocusOperation(launchParams.current.get('operation'));
    } else {
      setServerOverrideState(loadServerOverride(key));
    }
    saveSource(loaded.source);
    if (!options.keepView) setView('docs');
    if (!isUserScriptMode()) document.title = `RouteCraft — ${loaded.spec.title}`;
    if (loaded.source.kind === 'url') {
      setRecent(
        addRecent({
          url: loaded.source.value,
          title: loaded.spec.title,
          version: loaded.spec.version,
          loadedAt: new Date().toISOString(),
        }),
      );
    }
    // Follow the new spec's base URL in the request console unless the user
    // has typed their own URL there. Decide outside the state updater so
    // StrictMode's double invocation cannot corrupt the marker ref.
    const isNewSpec = key !== lastSpecKeyRef.current;
    lastSpecKeyRef.current = key;
    const firstServer = loaded.spec.servers[0];
    const base = firstServer
      ? resolveServerUrl(substituteServerVariables(firstServer), loaded.source.url)
      : loaded.source.url
        ? safeOrigin(loaded.source.url)
        : '';
    if (base) {
      const current = composerUrlRef.current.trim();
      // Switching specs always follows the new spec's base. Reloading the
      // same spec keeps a hand-edited request URL intact.
      if (isNewSpec || !current || current === autoComposerUrl.current) {
        autoComposerUrl.current = base;
        composerUrlRef.current = base;
        setComposerDraft((previous) => ({ ...previous, url: base }));
      }
    }
  }, []);

  const loadUrl = useCallback(async (url: string, headers?: Record<string, string>) => {
    const id = requestId.current + 1;
    requestId.current = id;
    setLoading(true);
    setError(null);
    setView('docs');
    try {
      const loaded = await loadSpecFromUrl(url, headers);
      if (requestId.current !== id) return;
      if (headers) {
        // Remember launch headers so the reload button works for a protected spec.
        specHeadersRef.current.set(loaded.source.value, headers);
        if (loaded.source.url) specHeadersRef.current.set(loaded.source.url, headers);
      }
      applyLoaded(loaded);
    } catch (loadError) {
      if (requestId.current !== id) return;
      setError(toLoadError(loadError));
      if (!spec) setView('landing');
    } finally {
      if (requestId.current === id) setLoading(false);
    }
  }, [applyLoaded, spec]);

  const loadText = useCallback(async (text: string, label: string) => {
    setLoading(true);
    setError(null);
    try {
      const loaded = await loadSpecFromText(text, label);
      applyLoaded(loaded);
    } catch (loadError) {
      setError(toLoadError(loadError));
      setView('landing');
    } finally {
      setLoading(false);
    }
  }, [applyLoaded]);

  const loadFile = useCallback(async (file: File) => {
    if (file.size > 20 * 1024 * 1024) {
      setError({ message: 'That file is larger than 20 MB.' });
      return;
    }
    const text = await file.text();
    await loadText(text, file.name);
  }, [loadText]);

  const reload = useCallback(async () => {
    if (!source?.url) {
      notify('Reload is only available for specs loaded from a URL.', 'info');
      return;
    }
    setLoading(true);
    try {
      const headers = specHeadersRef.current.get(source.url) || specHeadersRef.current.get(source.value);
      const loaded = await loadSpecFromUrl(source.url, headers);
      applyLoaded(loaded, { keepView: true });
      notify('Spec reloaded.', 'success');
    } catch (loadError) {
      const info = toLoadError(loadError);
      notify(info.message, 'error');
    } finally {
      setLoading(false);
    }
  }, [source, applyLoaded]);

  const goLanding = useCallback(() => {
    setView('landing');
    setError(null);
  }, []);

  const closeSpec = useCallback(() => {
    setSpec(null);
    setSource(null);
    setView('landing');
    setError(null);
    setCredentialsState({});
    setServerOverrideState(null);
    specHeadersRef.current.clear();
    saveSource(null);
    if (!isUserScriptMode()) document.title = 'RouteCraft — API docs you can run';
  }, []);

  const setCredentials = useCallback((next: CredentialMap) => {
    setCredentialsState(next);
    if (specKey) saveCredentials(specKey, next);
  }, [specKey]);

  const setActiveServer = useCallback((url: string) => {
    setServerOverrideState(url);
    if (specKey) saveServerOverride(specKey, url || null);
    if (!url) return;
    const current = composerUrlRef.current.trim();
    if (!current || current === autoComposerUrl.current) {
      autoComposerUrl.current = url;
      composerUrlRef.current = url;
      setComposerDraft((previous) => ({ ...previous, url }));
    }
  }, [specKey]);

  const clearFocusOperation = useCallback(() => setFocusOperation(null), []);

  const updateComposerDraft = useCallback((draft: RequestDraft) => {
    setComposerDraft(draft);
  }, []);

  const loadHistoryIntoComposer = useCallback((entry: HistoryEntry) => {
    let bodyMode: RequestDraft['bodyMode'] = 'none';
    if (entry.requestBodyText) {
      const contentType = Object.entries(entry.requestHeaders).find(([key]) => key.toLowerCase() === 'content-type')?.[1] || '';
      if (/json/i.test(contentType)) bodyMode = 'json';
      else if (/x-www-form-urlencoded/i.test(contentType)) bodyMode = 'form';
      else bodyMode = 'text';
    }
    setComposerDraft({
      method: entry.method.toLowerCase() as HttpMethod,
      url: entry.url,
      params: [],
      headers: recordToKeyValues(entry.requestHeaders),
      body: entry.requestBodyText || '',
      bodyMode,
      contentType: entry.requestHeaders['Content-Type'] || 'application/json',
    });
    setHistoryOpen(false);
    setView('composer');
  }, []);

  const notify = useCallback((message: string, tone: ToastState['tone'] = 'success') => {
    setToast({ id: Date.now(), message, tone });
  }, []);

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next);
    saveTheme(next);
  }, []);

  const openAuth = useCallback(() => {
    if (!spec) return;
    if (Object.keys(spec.securitySchemes).length === 0) {
      notify('This spec does not declare any security schemes.', 'info');
      return;
    }
    setAuthOpen(true);
  }, [spec, notify]);

  const openCode = useCallback((request: CodeRequest, title?: string) => {
    setCodeModal({ request, title });
  }, []);

  // Theme resolution + system changes.
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const dark = theme === 'dark' || (theme === 'system' && media.matches);
      const resolved = dark ? 'dark' : 'light';
      setResolvedTheme(resolved);
      const host = getUserScriptHost();
      if (host) {
        // The userscript lives in a shadow root. Theme the host instead of
        // changing the page's own documentElement and CSS variables.
        host.dataset.theme = resolved;
        host.style.colorScheme = resolved;
      } else {
        document.documentElement.dataset.theme = resolved;
        document.documentElement.style.colorScheme = resolved;
      }
    };
    apply();
    if (theme === 'system') {
      media.addEventListener('change', apply);
      return () => media.removeEventListener('change', apply);
    }
  }, [theme]);

  // Toast lifecycle.
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(timer);
  }, [toast]);

  // Persist the composer draft (debounced).
  useEffect(() => {
    const timer = setTimeout(() => saveComposer(composerDraft), 350);
    return () => clearTimeout(timer);
  }, [composerDraft]);

  useEffect(() => {
    composerUrlRef.current = composerDraft.url;
  }, [composerDraft.url]);
  // Boot: explicit URL, tab origin, or the last spec.
  useEffect(() => {
    if (booted.current) return;
    booted.current = true;
    // The userscript mounts hidden on every page. Wait for the Alt+Shift+S
    // shortcut to open the app, then load a detected spec or the last spec.
    if (isUserScriptMode()) return;
    const params = new URLSearchParams(window.location.search);
    const urlParam = params.get('url');
    const specHeadersKey = params.get('specHeadersKey');
    const loadInitial = async (target: string) => {
      const headers = await readLaunchSpecHeaders(specHeadersKey);
      await loadUrl(target, headers);
    };
    if (urlParam) {
      void loadInitial(urlParam);
      return;
    }
    const from = params.get('from');
    if (from) {
      try {
        void loadInitial(new URL(from).origin);
        return;
      } catch {
        /* fall through */
      }
    }
    const saved = loadSource();
    if (saved) void loadUrl(saved.value);
  }, [loadUrl]);

  // The userscript overlay communicates with the hidden app through this
  // event. A detected spec URL wins; otherwise reopen the last spec.
  useEffect(() => {
    if (!isUserScriptMode()) return;
    const onOpen = (event: Event) => {
      const detail = (event as CustomEvent<{ url?: string }>).detail;
      const url = typeof detail?.url === 'string' ? detail.url.trim() : '';
      if (url) {
        void loadUrl(url);
        return;
      }
      if (!spec) {
        const saved = loadSource();
        if (saved) void loadUrl(saved.value);
      }
    };
    window.addEventListener('routecraft:open', onOpen);
    return () => window.removeEventListener('routecraft:open', onOpen);
  }, [loadUrl, spec]);

  const value: AppContextValue = {
    view,
    setView,
    spec,
    source,
    resolver,
    loading,
    error,
    recent,
    theme,
    setTheme,
    resolvedTheme,
    servers,
    activeServer,
    setActiveServer,
    focusOperation,
    clearFocusOperation,
    credentials,
    setCredentials,
    authOpen,
    openAuth,
    closeAuth: () => setAuthOpen(false),
    historyOpen,
    openHistory: () => setHistoryOpen(true),
    closeHistory: () => setHistoryOpen(false),
    codeModal,
    openCode,
    closeCode: () => setCodeModal(null),
    toast,
    notify,
    dismissToast: () => setToast(null),
    composerDraft,
    updateComposerDraft,
    loadHistoryIntoComposer,
    endpointFilter,
    setEndpointFilter,
    loadUrl,
    loadText,
    loadFile,
    reload,
    goLanding,
    closeSpec,
    clearError: () => setError(null),
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
};

export function useApp(): AppContextValue {
  const context = useContext(AppContext);
  if (!context) throw new Error('useApp must be used inside AppProvider');
  return context;
}
