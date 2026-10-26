import React from 'react';
import { BookOpen, History, Monitor, Moon, Search, Sun, Terminal, X } from 'lucide-react';
import { useApp } from '../state/AppContext';

function hostLabel(value: string): string {
  try {
    const url = new URL(value);
    return url.host + (url.pathname === '/' ? '' : url.pathname);
  } catch {
    return value;
  }
}

export const TopBar: React.FC = () => {
  const {
    view,
    setView,
    spec,
    source,
    goLanding,
    openHistory,
    theme,
    setTheme,
    endpointFilter,
    setEndpointFilter,
  } = useApp();
  const hasSpec = Boolean(spec);
  const showTabs = hasSpec || view === 'composer';

  const cycleTheme = () => {
    setTheme(theme === 'light' ? 'dark' : theme === 'dark' ? 'system' : 'light');
  };
  const ThemeIcon = theme === 'light' ? Sun : theme === 'dark' ? Moon : Monitor;
  const themeTitle = `Theme: ${theme}. Click to change.`;

  return (
    <header className="topbar">
      <div className="topbar-inner">
        <button type="button" className="brand" onClick={goLanding} title="RouteCraft home" data-testid="brand">
          <span className="brand-name">RouteCraft</span>
          <span className="brand-version">v2</span>
        </button>

        {hasSpec && source ? (
          <span className="source-pill" title={source.value}>
            {hostLabel(source.kind === 'url' ? source.value : source.label)}
          </span>
        ) : null}

        {showTabs ? (
          <nav className="view-tabs" aria-label="Views">
            <button
              type="button"
              className={view === 'docs' ? 'is-active' : ''}
              onClick={() => setView('docs')}
              disabled={!hasSpec}
              data-testid="nav-docs"
            >
              <BookOpen size={14} /> <span>Docs</span>
            </button>
            <button
              type="button"
              className={view === 'composer' ? 'is-active' : ''}
              onClick={() => setView('composer')}
              data-testid="nav-request"
            >
              <Terminal size={14} /> <span>Request</span>
            </button>
          </nav>
        ) : null}

        <div className="topbar-actions">
          {view === 'docs' && hasSpec ? (
            <label className="topbar-search">
              <Search size={14} />
              <input
                value={endpointFilter}
                onChange={(event) => setEndpointFilter(event.target.value)}
                placeholder="Filter endpoints"
                spellCheck={false}
                aria-label="Filter endpoints"
                data-testid="endpoint-filter"
              />
              {endpointFilter ? (
                <button
                  type="button"
                  className="icon-btn is-subtle"
                  onClick={() => setEndpointFilter('')}
                  aria-label="Clear filter"
                >
                  <X size={13} />
                </button>
              ) : null}
            </label>
          ) : null}
          <button
            type="button"
            className="icon-btn"
            onClick={openHistory}
            title="Request history"
            aria-label="Request history"
            data-testid="history-button"
          >
            <History size={17} />
          </button>
          <button
            type="button"
            className="icon-btn"
            onClick={cycleTheme}
            title={themeTitle}
            aria-label={themeTitle}
            data-testid="theme-toggle"
          >
            <ThemeIcon size={17} />
          </button>
        </div>
      </div>
    </header>
  );
};
