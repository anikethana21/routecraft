import React, { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Code2, Loader2, Lock, Play, RotateCcw, Send, ShieldCheck } from 'lucide-react';
import type { ApiOperation } from '../types';
import { useApp } from '../state/AppContext';
import {
  RequestBuildError,
  RequestExecutionError,
  executeRequest,
  joinBaseAndPath,
  operationBodyInitialValue,
  prepareOperationRequest,
  substitutePathParams,
} from '../lib/request';
import { isAuthorized } from '../lib/auth';
import { addHistory } from '../lib/history';
import { exampleFromMedia } from '../lib/spec/schema';
import { resolveServerUrl, substituteServerVariables } from '../lib/spec/normalize';
import { MethodBadge } from './MethodBadge';
import { Markdown } from './Markdown';
import { ParameterTable } from './ParameterTable';
import { RequestBodyEditor } from './RequestBodyEditor';
import { ResponsesDoc } from './ResponsesDoc';
import { ResponsePanel, type ResponseError } from './ResponsePanel';

interface OperationCardProps {
  operation: ApiOperation;
  tagName: string;
}

function firstExample(value: unknown): unknown {
  if (value === undefined || value === null || typeof value !== 'object') return value;
  const record = value as Record<string, unknown>;
  if ('value' in record) return record.value;
  const first = Object.values(record)[0];
  if (first && typeof first === 'object' && 'value' in (first as Record<string, unknown>)) {
    return (first as { value: unknown }).value;
  }
  return first;
}

function initialValues(operation: ApiOperation): Record<string, string> {
  const values: Record<string, string> = {};
  for (const parameter of operation.parameters) {
    const candidates = [
      parameter.example,
      firstExample(parameter.examples),
      parameter.schema.default,
      parameter.schema.example,
      parameter.schema.enum?.[0],
    ];
    const found = candidates.find((candidate) => candidate !== undefined && candidate !== null);
    values[parameter.key] = found === undefined ? '' : typeof found === 'object' ? JSON.stringify(found) : String(found);
  }
  return values;
}

export const OperationCard: React.FC<OperationCardProps> = ({ operation, tagName }) => {
  const {
    spec,
    source,
    resolver,
    servers,
    activeServer,
    focusOperation,
    clearFocusOperation,
    credentials,
    openAuth,
    openCode,
    notify,
  } = useApp();
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState<Record<string, string>>(() => initialValues(operation));
  const initialBody = useMemo(
    () => (resolver ? operationBodyInitialValue(operation, resolver) : { contentType: 'application/json', text: '' }),
    [operation, resolver],
  );
  const [bodyText, setBodyText] = useState(initialBody.text);
  const [contentType, setContentType] = useState(initialBody.contentType);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<Awaited<ReturnType<typeof executeRequest>> | null>(null);
  const [error, setError] = useState<ResponseError | null>(null);
  const [tryItOut, setTryItOut] = useState(false);

  // Deep links such as ?operation=GET%20%2Fpets open the matching endpoint.
  useEffect(() => {
    if (!focusOperation) return;
    const wanted = focusOperation.trim().toLowerCase().replace(/\s+/g, ' ');
    const method = operation.method.toLowerCase();
    const path = operation.path.toLowerCase();
    const matches = wanted === `${method} ${path}`
      || wanted === `${method}:${path}`
      || wanted === operation.key.toLowerCase();
    if (!matches) return;

    setOpen(true);
    clearFocusOperation();
    const id = `op-${operation.key.replace(/[^\w-]/g, '-')}`;
    const timer = window.setTimeout(() => {
      const host = document.getElementById('routecraft-userscript-host');
      const target = document.getElementById(id) || host?.shadowRoot?.getElementById(id);
      target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 60);
    return () => window.clearTimeout(timer);
  }, [focusOperation, operation, clearFocusOperation]);

  const security = operation.security ?? spec?.security;
  const securityNames = useMemo(
    () => [...new Set((security || []).flatMap((requirement) => Object.keys(requirement)))],
    [security],
  );
  const authorized = useMemo(() => isAuthorized(security, credentials), [security, credentials]);
  const hasParameters = operation.parameters.length > 0;
  const hasBody = Boolean(operation.requestBody);
  const missingRequired = operation.parameters.filter(
    (parameter) => parameter.required && !(values[parameter.key] || '').trim(),
  );

  const baseUrl = useMemo(() => {
    if (operation.servers && operation.servers.length > 0) {
      return resolveServerUrl(substituteServerVariables(operation.servers[0]), source?.url);
    }
    return activeServer || servers[0]?.url || '';
  }, [operation, source, activeServer, servers]);

  const pathPreview = useMemo(() => {
    const pathValues: Record<string, string> = {};
    for (const parameter of operation.parameters) {
      if (parameter.in === 'path' && values[parameter.key]) pathValues[parameter.name] = values[parameter.key];
    }
    return joinBaseAndPath(baseUrl, substitutePathParams(operation.path, pathValues));
  }, [operation, values, baseUrl]);

  const resetRequest = () => {
    setValues(initialValues(operation));
    setBodyText(initialBody.text);
    setContentType(initialBody.contentType);
    setResult(null);
    setError(null);
  };

  const startTryItOut = () => {
    setTryItOut(true);
    setError(null);
    const id = `op-${operation.key.replace(/[^\w-]/g, '-')}`;
    window.setTimeout(() => {
      const host = document.getElementById('routecraft-userscript-host');
      const target = document.getElementById(id) || host?.shadowRoot?.getElementById(id);
      const firstField = target?.querySelector<HTMLElement>(
        '[data-testid^="param-"], [data-testid="request-body-input"]',
      );
      firstField?.focus();
    }, 40);
  };

  const cancelTryItOut = () => {
    setTryItOut(false);
    setResult(null);
    setError(null);
  };

  const buildPrepared = () => {
    if (!spec) throw new RequestBuildError('No specification is loaded.');
    return prepareOperationRequest({
      operation,
      spec,
      baseUrl,
      values,
      bodyText,
      contentType,
      credentials,
    });
  };

  const send = async () => {
    if (sending) return;
    setResult(null);
    let prepared;
    try {
      prepared = buildPrepared();
    } catch (buildError) {
      setError({
        kind: 'build',
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
      const prepared = buildPrepared();
      openCode(
        {
          method: prepared.method,
          url: prepared.url,
          headers: prepared.headers,
          body: prepared.bodyText,
        },
        `${operation.method.toUpperCase()} ${operation.path}`,
      );
    } catch (buildError) {
      notify(buildError instanceof Error ? buildError.message : String(buildError), 'error');
    }
  };

  return (
    <article className={`op-card ${open ? 'is-open' : ''} ${operation.deprecated ? 'is-deprecated' : ''}`} id={`op-${operation.key.replace(/[^\w-]/g, '-')}`}>
      <button
        type="button"
        className="op-row"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        data-testid={`operation-${operation.method}-${operation.path}`}
      >
        <MethodBadge method={operation.method} />
        <code className="op-path">{operation.path}</code>
        <span className="op-summary">{operation.summary}</span>
        <span className="op-flags">
          {operation.deprecated ? <span className="tiny-badge is-warn">deprecated</span> : null}
          {securityNames.length > 0 ? (
            <span className={`op-lock ${authorized ? 'is-authorized' : ''}`} title={authorized ? 'Authorized' : 'Requires authorization'}>
              {authorized ? <ShieldCheck size={14} /> : <Lock size={13} />}
            </span>
          ) : null}
          <span className="op-chevron">{open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}</span>
        </span>
      </button>

      {open ? (
        <div className="op-body">
          {operation.description ? (
            <div className="op-description">
              <Markdown text={operation.description} />
            </div>
          ) : null}

          <div className="op-meta">
            <span className="op-meta-item">
              <span className="op-meta-label">Operation</span>
              <code>{operation.operationId || operation.key}</code>
            </span>
            <span className="op-meta-item">
              <span className="op-meta-label">Tag</span>
              <span>{tagName}</span>
            </span>
          </div>

          {securityNames.length > 0 ? (
            <div className={`op-auth-note ${authorized ? 'is-authorized' : ''}`}>
              {authorized ? <ShieldCheck size={15} /> : <Lock size={14} />}
              <span>
                {authorized ? 'Authorized' : 'Requires'} {securityNames.join(', ')}
              </span>
              {!authorized ? (
                <button type="button" className="text-btn" onClick={openAuth}>
                  Authorize
                </button>
              ) : null}
            </div>
          ) : null}

          <div className="op-section">
            <div className="section-head">
              <div className="section-head-title">
                <h3>Parameters</h3>
                {missingRequired.length > 0 ? (
                  <span className="required-badge">{missingRequired.length} required</span>
                ) : null}
              </div>
              <button
                type="button"
                className={`btn btn-secondary btn-tryout ${tryItOut ? 'is-active' : ''}`}
                onClick={tryItOut ? cancelTryItOut : startTryItOut}
                aria-pressed={tryItOut}
                title={tryItOut ? 'Leave try-it-out mode' : 'Enable request editing and execution'}
                data-testid={`try-it-out-${operation.method}-${operation.path}`}
              >
                {tryItOut ? 'Cancel' : <><Play size={13} /> Try it out</>}
              </button>
            </div>
            {hasParameters ? (
              <ParameterTable
                parameters={operation.parameters}
                values={values}
                disabled={!tryItOut}
                onChange={(key, value) => setValues((previous) => ({ ...previous, [key]: value }))}
              />
            ) : (
              <p className="op-empty">No parameters</p>
            )}
          </div>

          {hasBody && operation.requestBody && resolver ? (
            <div className="op-section">
              <RequestBodyEditor
                body={operation.requestBody}
                resolver={resolver}
                readOnly={!tryItOut}
                contentType={contentType}
                onContentTypeChange={(next) => {
                  setContentType(next);
                  const media = operation.requestBody?.content[next];
                  if (media) {
                    const example = exampleFromMedia(media, resolver, { mode: 'request' });
                    setBodyText(
                      example === null || example === undefined
                        ? ''
                        : typeof example === 'string'
                          ? example
                          : JSON.stringify(example, null, 2),
                    );
                  }
                }}
                text={bodyText}
                onTextChange={setBodyText}
              />
            </div>
          ) : null}

          <div className="op-actions">
            <code className="op-url" title={pathPreview}>
              {pathPreview || 'No base URL'}
            </code>
            <div className="op-action-spacer" />
            <button type="button" className="text-btn" onClick={showCode} title="Show code for this request">
              <Code2 size={14} /> Code
            </button>
            {tryItOut ? (
              <>
                <button
                  type="button"
                  className="text-btn"
                  onClick={resetRequest}
                  disabled={sending}
                  title="Clear request values and response"
                  data-testid={`clear-${operation.method}-${operation.path}`}
                >
                  <RotateCcw size={13} /> Clear
                </button>
                <button
                  type="button"
                  className="btn btn-primary op-send"
                  onClick={() => void send()}
                  disabled={sending || missingRequired.length > 0}
                  title={
                    missingRequired.length > 0
                      ? `Fill in: ${missingRequired.map((parameter) => parameter.name).join(', ')}`
                      : 'Execute request'
                  }
                  data-testid={`send-${operation.method}-${operation.path}`}
                >
                  {sending ? <Loader2 size={15} className="spin" /> : <Send size={14} />}
                  {sending ? 'Sending' : 'Execute'}
                </button>
              </>
            ) : (
              <span className="op-tryout-hint">
                Click <strong>Try it out</strong> to enable execution.
              </span>
            )}
          </div>

          <ResponsePanel result={result} error={error} />

          {resolver ? <ResponsesDoc responses={operation.responses} resolver={resolver} /> : null}
        </div>
      ) : null}
    </article>
  );
};
