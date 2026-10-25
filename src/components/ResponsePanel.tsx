import React, { useEffect, useState } from 'react';
import { AlertTriangle, Check, Clock3, Copy, Download, HardDrive, ShieldAlert } from 'lucide-react';
import type { HttpResponseResult } from '../types';
import { useApp } from '../state/AppContext';
import { JsonView } from './JsonView';

export interface ResponseError {
  message: string;
  hint?: string;
  kind?: 'cors' | 'network' | 'timeout' | 'proxy' | 'build';
}

interface ResponsePanelProps {
  result: HttpResponseResult | null;
  error: ResponseError | null;
}

function formatBytes(bytes: number): string {
  if (!bytes) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

function statusClass(status: number): string {
  if (status >= 200 && status < 300) return 'status-2xx';
  if (status >= 300 && status < 400) return 'status-3xx';
  if (status >= 400 && status < 500) return 'status-4xx';
  if (status >= 500) return 'status-5xx';
  return 'status-error';
}

function errorTitle(error: ResponseError): string {
  switch (error.kind) {
    case 'cors':
      return 'The browser blocked this request (CORS)';
    case 'timeout':
      return 'The request timed out';
    case 'proxy':
      return 'The request proxy failed';
    case 'build':
      return 'The request could not be built';
    default:
      return 'The request failed';
  }
}

export const ResponsePanel: React.FC<ResponsePanelProps> = ({ result, error }) => {
  const { notify } = useApp();
  const [tab, setTab] = useState<'body' | 'headers'>('body');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (result) setTab('body');
  }, [result]);

  if (!result && !error) return null;

  if (error && !result) {
    return (
      <div className="response-error" role="alert">
        {error.kind === 'cors' ? <ShieldAlert size={18} /> : <AlertTriangle size={18} />}
        <div>
          <strong>{errorTitle(error)}</strong>
          <p>{error.message}</p>
          {error.hint ? <p className="response-hint">{error.hint}</p> : null}
        </div>
      </div>
    );
  }

  if (!result) return null;

  const bodyText =
    typeof result.data === 'object' && result.data !== null
      ? JSON.stringify(result.data, null, 2)
      : result.rawText || '';

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(bodyText);
      setCopied(true);
      notify('Response copied to the clipboard.');
      setTimeout(() => setCopied(false), 1600);
    } catch {
      notify('Could not access the clipboard.', 'error');
    }
  };

  const download = () => {
    const blob = new Blob([bodyText], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `routecraft-response-${result.status}-${Date.now()}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const headers = Object.entries(result.headers || {});

  return (
    <div className="response" aria-live="polite">
      <div className="response-bar">
        <div className="response-stats">
          <span className={`status-pill ${statusClass(result.status)}`}>
            {result.status || 0} {result.statusText || (result.status === 0 ? 'Error' : '')}
          </span>
          <span className="response-stat">
            <Clock3 size={13} /> {result.latencyMs} ms
          </span>
          <span className="response-stat">
            <HardDrive size={13} /> {formatBytes(result.sizeBytes)}
          </span>
          {result.contentType ? <span className="response-type">{result.contentType.split(';')[0]}</span> : null}
        </div>
        <div className="response-tools">
          <button type="button" className="icon-btn" onClick={copy} title="Copy response body">
            {copied ? <Check size={14} /> : <Copy size={14} />}
          </button>
          <button type="button" className="icon-btn" onClick={download} title="Download response">
            <Download size={14} />
          </button>
        </div>
      </div>

      <div className="response-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'body'}
          className={tab === 'body' ? 'is-active' : ''}
          onClick={() => setTab('body')}
        >
          Body
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'headers'}
          className={tab === 'headers' ? 'is-active' : ''}
          onClick={() => setTab('headers')}
        >
          Headers <span className="tab-count">{headers.length}</span>
        </button>
      </div>

      {tab === 'body' ? (
        <JsonView value={result.data} rawText={result.rawText} />
      ) : (
        <div className="headers-table-wrap">
          {headers.length === 0 ? (
            <div className="headers-empty">No response headers were exposed.</div>
          ) : (
            <table className="table headers-table">
              <tbody>
                {headers.map(([key, value]) => (
                  <tr key={key}>
                    <td className="header-key">{key}</td>
                    <td className="header-value">{value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {error ? (
        <div className="response-error is-inline" role="alert">
          <AlertTriangle size={15} />
          <div>
            <strong>{errorTitle(error)}</strong>
            <p>{error.message}</p>
          </div>
        </div>
      ) : null}
    </div>
  );
};
