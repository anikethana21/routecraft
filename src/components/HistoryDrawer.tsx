import React, { useEffect, useMemo, useState } from 'react';
import { Clock3, Download, History, Search, Trash2, X } from 'lucide-react';
import type { HistoryEntry } from '../types';
import { useApp } from '../state/AppContext';
import {
  clearHistory,
  deleteHistoryItem,
  downloadHistory,
  getHistory,
  groupHistory,
} from '../lib/history';
import { MethodBadge } from './MethodBadge';

function statusClass(status: number): string {
  if (status >= 200 && status < 300) return 'status-2xx';
  if (status >= 300 && status < 400) return 'status-3xx';
  if (status >= 400 && status < 500) return 'status-4xx';
  if (status >= 500) return 'status-5xx';
  return 'status-error';
}

function timeOf(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

function formatBytes(bytes: number): string {
  if (!bytes) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

export const HistoryDrawer: React.FC = () => {
  const { closeHistory, loadHistoryIntoComposer, notify } = useApp();
  const [items, setItems] = useState<HistoryEntry[]>(() => getHistory());
  const [query, setQuery] = useState('');

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeHistory();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [closeHistory]);

  const normalizedQuery = query.trim().toLowerCase();
  const filtered = useMemo(
    () =>
      normalizedQuery
        ? items.filter((entry) =>
            [entry.url, entry.method, entry.specTitle || '', String(entry.status)]
              .join(' ')
              .toLowerCase()
              .includes(normalizedQuery),
          )
        : items,
    [items, normalizedQuery],
  );
  const groups = groupHistory(filtered);

  const remove = (event: React.MouseEvent, id: string) => {
    event.stopPropagation();
    setItems(deleteHistoryItem(id));
  };

  const clear = () => {
    if (!items.length) return;
    if (!window.confirm('Clear the whole request history? This cannot be undone.')) return;
    clearHistory();
    setItems([]);
    notify('Request history cleared.', 'success');
  };

  return (
    <div className="drawer-overlay" onMouseDown={closeHistory} role="presentation">
      <aside
        className="drawer"
        role="dialog"
        aria-modal="true"
        aria-label="Request history"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="drawer-head">
          <div className="drawer-title">
            <History size={17} />
            <h2>History</h2>
            <span className="tag-count">{items.length}</span>
          </div>
          <button type="button" className="icon-btn" onClick={closeHistory} aria-label="Close history">
            <X size={17} />
          </button>
        </div>

        <div className="drawer-body">
          {items.length > 0 ? (
            <label className="search-field history-search">
              <Search size={14} />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search requests"
                spellCheck={false}
                aria-label="Search request history"
                data-testid="history-search"
              />
              {query ? (
                <button
                  type="button"
                  className="icon-btn is-subtle"
                  onClick={() => setQuery('')}
                  aria-label="Clear history search"
                >
                  <X size={13} />
                </button>
              ) : null}
            </label>
          ) : null}

          {items.length === 0 ? (
            <div className="drawer-empty">
              <Clock3 size={22} />
              <strong>No requests yet</strong>
              <span>Send a request from the docs or the console and it will show up here.</span>
            </div>
          ) : filtered.length === 0 ? (
            <div className="drawer-empty">
              <Search size={22} />
              <strong>No matching requests</strong>
              <span>Try a different URL, method, status or spec name.</span>
            </div>
          ) : (
            groups.map((group) => (
              <div className="history-group" key={group.label}>
                <div className="history-group-label">{group.label}</div>
                {group.items.map((entry) => (
                  <div
                    className="history-item"
                    key={entry.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => loadHistoryIntoComposer(entry)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        loadHistoryIntoComposer(entry);
                      }
                    }}
                    title={entry.url}
                  >
                    <div className="history-main">
                      <div className="history-line">
                        <MethodBadge method={entry.method} small />
                        <code className="history-url">{entry.url}</code>
                      </div>
                      <div className="history-meta">
                        <span className={`doc-status ${statusClass(entry.status)}`}>{entry.status}</span>
                        <span>{timeOf(entry.timestamp)}</span>
                        <span>{entry.latencyMs} ms</span>
                        <span>{formatBytes(entry.sizeBytes)}</span>
                        {entry.specTitle ? <span className="history-spec">{entry.specTitle}</span> : null}
                      </div>
                    </div>
                    <button
                      type="button"
                      className="icon-btn history-delete"
                      onClick={(event) => remove(event, entry.id)}
                      aria-label="Delete this history entry"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
              </div>
            ))
          )}
        </div>

        <div className="drawer-foot">
          <button type="button" className="text-btn" onClick={downloadHistory} disabled={items.length === 0}>
            <Download size={13} /> Export
          </button>
          <div className="op-action-spacer" />
          <button type="button" className="text-btn is-danger" onClick={clear} disabled={items.length === 0}>
            Clear history
          </button>
        </div>
      </aside>
    </div>
  );
};
