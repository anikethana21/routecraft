import React, { useMemo, useRef, useState } from 'react';
import { Code2, Loader2, Lock, Send, ShieldCheck, Terminal } from 'lucide-react';
import type { BodyMode, HttpMethod, HttpResponseResult, KeyValue } from '../types';
import { useApp } from '../state/AppContext';
import {
  RequestBuildError,
  RequestExecutionError,
  buildComposerRequest,
  executeRequest,
} from '../lib/request';
import { addHistory } from '../lib/history';
import { hasCredential } from '../lib/auth';
import { KeyValueEditor } from './KeyValueEditor';
import { ResponsePanel, type ResponseError } from './ResponsePanel';

const METHODS: HttpMethod[] = ['get', 'post', 'put', 'patch', 'delete', 'options', 'head'];
const BODY_MODES: Array<{ id: BodyMode; label: string }> = [
  { id: 'none', label: 'None' },
  { id: 'json', label: 'JSON' },
  { id: 'form', label: 'Form' },
  { id: 'text', label: 'Text' },
];

export const Composer: React.FC = () => {
  const {
    spec,
    source,
    composerDraft,
    updateComposerDraft,
    credentials,
    openAuth,
    openCode,
    notify,
  } = useApp();
  const [tab, setTab] = useState<'params' | 'headers' | 'body'>('params');
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<HttpResponseResult | null>(null);
  const [error, setError] = useState<ResponseError | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  const enabledParams = composerDraft.params.filter((row) => row.enabled && row.key.trim()).length;
  const enabledHeaders = composerDraft.headers.filter((row) => row.enabled && row.key.trim()).length;
  const authorizedSchemes = useMemo(
    () => Object.entries(credentials).filter(([, credential]) => hasCredential(credential)).length,
    [credentials],
  );
  const hasSecurity = Boolean(spec && Object.keys(spec.securitySchemes).length > 0);

  const update = (patch: Partial<typeof composerDraft>) => {
    updateComposerDraft({ ...composerDraft, ...patch });
  };

  const prepare = () =>
    buildComposerRequest(
      composerDraft,
      credentials,
      spec?.security,
      spec?.securitySchemes || {},
    );

  const send = async () => {
    if (sending || !composerDraft.url.trim()) return;
    setResult(null);
    let prepared;
    try {
      prepared = prepare();
    } catch (buildError) {
      setError({
        kind: buildError instanceof RequestBuildError ? 'build' : undefined,
        message: buildError instanceof Error ? buildError.message : String(buildError),
      });
      return;
    }
    setSending(true);
    setError(null);
    setResult(null);
    try {
      const response = await executeRequest(prepared);
      setResult(response);
      addHistory({
        timestamp: response.timestamp,
        method: prepared.method,
        url: prepared.url,
        status: response.status,
        statusText: response.statusText,
        latencyMs: response.latencyMs,
        sizeBytes: response.sizeBytes,
        requestHeaders: prepared.headers,
        requestBodyText: prepared.bodyText,
        responsePreview: response.rawText.slice(0, 600),
        specTitle: spec?.title,
      });
    } catch (sendError) {
      if (sendError instanceof RequestExecutionError) {
        setError({ kind: sendError.kind, message: sendError.message, hint: sendError.detail });
      } else {
        setError({ message: sendError instanceof Error ? sendError.message : String(sendError) });
      }
    } finally {
      setSending(false);
    }
  };

  const showCode = () => {
    try {
      const prepared = prepare();
      openCode(
        {
          method: prepared.method,
          url: prepared.url,
          headers: prepared.headers,
          body: prepared.bodyText,
        },
        `${prepared.method} ${prepared.url}`,
      );
    } catch (buildError) {
      notify(buildError instanceof Error ? buildError.message : String(buildError), 'error');
    }
  };

  const setRows = (key: 'params' | 'headers', rows: KeyValue[]) => update({ [key]: rows } as Partial<typeof composerDraft>);

  return (
    <main className="composer">
      <div className="composer-container">
        <div className="composer-title">
          <div>
            <span className="eyebrow">HTTP console</span>
            <h1>Send a request</h1>
          </div>
          {spec ? (
            <button type="button" className="text-btn" onClick={openAuth} title="Manage authorization">
              {authorizedSchemes > 0 ? <ShieldCheck size={14} /> : <Lock size={13} />}
              {authorizedSchemes > 0 ? `Authorized (${authorizedSchemes})` : 'Authorize'}
            </button>
          ) : null}
        </div>

        <div
          className="composer-card"
          ref={cardRef}
          onKeyDown={(event) => {
            if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
              event.preventDefault();
              void send();
            }
          }}
        >
          <div className="composer-request-row">
            <select
              className={`method-select method-${composerDraft.method}`}
              value={composerDraft.method}
              onChange={(event) => update({ method: event.target.value as HttpMethod })}
              aria-label="HTTP method"
              data-testid="composer-method"
            >
              {METHODS.map((method) => (
                <option key={method} value={method}>
                  {method.toUpperCase()}
                </option>
              ))}
            </select>
            <input
              className="input composer-url mono"
              value={composerDraft.url}
              onChange={(event) => update({ url: event.target.value })}
              placeholder={source?.url ? source.url : 'https://api.example.com/v1/resource'}
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
              aria-label="Request URL"
              data-testid="composer-url"
            />
            <button
              type="button"
              className="btn btn-primary composer-send"
              onClick={() => void send()}
              disabled={sending || !composerDraft.url.trim()}
              data-testid="composer-send"
            >
              {sending ? <Loader2 size={15} className="spin" /> : <Send size={14} />}
              {sending ? 'Sending' : 'Send'}
            </button>
          </div>

          <div className="composer-tabs" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'params'}
              className={tab === 'params' ? 'is-active' : ''}
              onClick={() => setTab('params')}
              data-testid="composer-tab-params"
            >
              Params {enabledParams > 0 ? <span className="tab-count">{enabledParams}</span> : null}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'headers'}
              className={tab === 'headers' ? 'is-active' : ''}
              onClick={() => setTab('headers')}
              data-testid="composer-tab-headers"
            >
              Headers {enabledHeaders > 0 ? <span className="tab-count">{enabledHeaders}</span> : null}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'body'}
              className={tab === 'body' ? 'is-active' : ''}
              onClick={() => setTab('body')}
              data-testid="composer-tab-body"
            >
              Body {composerDraft.bodyMode !== 'none' ? <span className="tab-dot" /> : null}
            </button>
            <div className="composer-tabs-spacer" />
            <button type="button" className="text-btn" onClick={showCode} title="Generate code for this request">
              <Code2 size={14} /> Code
            </button>
          </div>

          <div className="composer-body">
            {tab === 'params' ? (
              <div className="composer-panel">
                <div className="mini-label">Query parameters</div>
                <KeyValueEditor
                  rows={composerDraft.params}
                  onChange={(rows) => setRows('params', rows)}
                  keyPlaceholder="Parameter"
                  valuePlaceholder="Value"
                  addLabel="Add parameter"
                />
              </div>
            ) : null}

            {tab === 'headers' ? (
              <div className="composer-panel">
                <div className="mini-label">Request headers</div>
                <KeyValueEditor
                  rows={composerDraft.headers}
                  onChange={(rows) => setRows('headers', rows)}
                  keyPlaceholder="Header"
                  valuePlaceholder="Value"
                  addLabel="Add header"
                />
                <p className="composer-hint">
                  Content-Type is set automatically from the body mode unless you add it here.
                </p>
              </div>
            ) : null}

            {tab === 'body' ? (
              <div className="composer-panel">
                <div className="body-mode-row">
                  <div className="mini-label">Request body</div>
                  <div className="body-mode" role="group" aria-label="Body type">
                    {BODY_MODES.map((mode) => (
                      <button
                        type="button"
                        key={mode.id}
                        className={composerDraft.bodyMode === mode.id ? 'is-active' : ''}
                        onClick={() => update({ bodyMode: mode.id })}
                      >
                        {mode.label}
                      </button>
                    ))}
                  </div>
                </div>
                {composerDraft.bodyMode === 'none' ? (
                  <div className="composer-empty-body">
                    <Terminal size={18} />
                    <span>This request has no body.</span>
                  </div>
                ) : (
                  <textarea
                    className="input code-input composer-body-input"
                    value={composerDraft.body}
                    onChange={(event) => update({ body: event.target.value })}
                    placeholder={
                      composerDraft.bodyMode === 'json'
                        ? '{\n  "key": "value"\n}'
                        : composerDraft.bodyMode === 'form'
                          ? '{\n  "field": "value"\n}'
                          : 'Plain text body'
                    }
                    spellCheck={false}
                    aria-label="Request body"
                    data-testid="composer-body"
                  />
                )}
                {composerDraft.bodyMode === 'form' ? (
                  <p className="composer-hint">
                    Enter a JSON object. It is encoded as <code>application/x-www-form-urlencoded</code> when sent.
                  </p>
                ) : null}
                {composerDraft.bodyMode === 'json' ? (
                  <p className="composer-hint">Sent as <code>application/json</code>. Invalid JSON is reported before sending.</p>
                ) : null}
              </div>
            ) : null}
          </div>

          <div className="composer-footer">
            <span>
              {hasSecurity
                ? 'Auth from the spec is applied automatically using your authorized credentials.'
                : 'Add an Authorization header to send a token with this request.'}
            </span>
            <span className="composer-shortcut mono">Ctrl + Enter to send</span>
          </div>
        </div>

        <ResponsePanel result={result} error={error} />
      </div>
    </main>
  );
};
