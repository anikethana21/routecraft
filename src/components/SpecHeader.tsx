import React, { useMemo, useState } from 'react';
import {
  Check,
  ExternalLink,
  Globe2,
  Lock,
  Pencil,
  RefreshCw,
  Server,
  ShieldCheck,
  X,
} from 'lucide-react';
import { useApp } from '../state/AppContext';
import { hasCredential } from '../lib/auth';
import { Markdown } from './Markdown';

export const SpecHeader: React.FC = () => {
  const {
    spec,
    source,
    servers,
    activeServer,
    setActiveServer,
    credentials,
    openAuth,
    loading,
    reload,
  } = useApp();
  const [editingServer, setEditingServer] = useState(false);
  const [serverDraft, setServerDraft] = useState(activeServer);
  const [showFullDescription, setShowFullDescription] = useState(false);

  const authorizedCount = useMemo(
    () => Object.values(credentials).filter(hasCredential).length,
    [credentials],
  );

  if (!spec) return null;

  const hasSecurity = Object.keys(spec.securitySchemes).length > 0;
  const descriptionLong = (spec.description?.length || 0) > 320 || (spec.description?.split('\n').length || 0) > 4;
  const oasLabel = spec.isSwagger2 ? 'Swagger 2.0' : spec.openapiVersion;

  const startEditing = () => {
    setServerDraft(activeServer);
    setEditingServer(true);
  };

  const saveServer = () => {
    setActiveServer(serverDraft.trim());
    setEditingServer(false);
  };

  return (
    <section className="spec-header">
      <div className="spec-title-row">
        <div className="spec-title-block">
          <div className="spec-title-line">
            <h1 data-testid="spec-title">{spec.title}</h1>
            {spec.version ? <span className="pill pill-version">v{spec.version}</span> : null}
            <span className="pill pill-oas">{oasLabel}</span>
            {spec.isSwagger2 ? <span className="pill pill-muted">converted</span> : null}
          </div>

          {source?.kind === 'url' ? (
            <a
              className="spec-raw-link mono"
              href={source.url || source.value}
              target="_blank"
              rel="noreferrer noopener"
              title="Open the raw specification"
            >
              {source.value.replace(/^https?:\/\//, '')} <ExternalLink size={11} />
            </a>
          ) : (
            <span className="spec-raw-link mono">{source?.label || 'Local specification'}</span>
          )}
        </div>

        <div className="spec-actions">
          {source?.url ? (
            <button
              type="button"
              className="icon-btn"
              onClick={() => void reload()}
              title="Reload specification"
              aria-label="Reload specification"
              data-testid="reload-spec"
            >
              <RefreshCw size={16} className={loading ? 'spin' : ''} />
            </button>
          ) : null}
          {hasSecurity ? (
            <button
              type="button"
              className={`btn btn-auth ${authorizedCount > 0 ? 'is-authorized' : ''}`}
              onClick={openAuth}
              data-testid="authorize-button"
            >
              {authorizedCount > 0 ? <ShieldCheck size={15} /> : <Lock size={14} />}
              {authorizedCount > 0 ? `Authorized (${authorizedCount})` : 'Authorize'}
            </button>
          ) : null}
        </div>
      </div>

      {spec.description ? (
        <div className={`spec-description ${descriptionLong && !showFullDescription ? 'is-clamped' : ''}`}>
          <Markdown text={spec.description} />
          {descriptionLong ? (
            <button
              type="button"
              className="text-btn spec-more"
              onClick={() => setShowFullDescription((value) => !value)}
            >
              {showFullDescription ? 'Show less' : 'Show more'}
            </button>
          ) : null}
        </div>
      ) : null}

      <div className="spec-meta-row">
        <div className="server-control">
          <span className="server-label">
            <Server size={13} /> Base URL
          </span>
          {editingServer ? (
            <div className="server-edit">
              <input
                className="input mono"
                value={serverDraft}
                onChange={(event) => setServerDraft(event.target.value)}
                placeholder="http://localhost:8000"
                spellCheck={false}
                autoFocus
                onKeyDown={(event) => {
                  if (event.key === 'Enter') saveServer();
                  if (event.key === 'Escape') setEditingServer(false);
                }}
                aria-label="Base URL"
                data-testid="server-input"
              />
              <button type="button" className="icon-btn" onClick={saveServer} title="Save base URL">
                <Check size={15} />
              </button>
              <button type="button" className="icon-btn" onClick={() => setEditingServer(false)} title="Cancel">
                <X size={15} />
              </button>
            </div>
          ) : (
            <div className="server-value">
              {servers.length > 1 ? (
                <select
                  className="server-select mono"
                  value={activeServer}
                  onChange={(event) => setActiveServer(event.target.value)}
                  aria-label="Base URL"
                  data-testid="server-select"
                >
                  {servers.map((server) => (
                    <option key={server.url} value={server.url}>
                      {server.url}
                    </option>
                  ))}
                  {activeServer && !servers.some((server) => server.url === activeServer) ? (
                    <option value={activeServer}>{activeServer}</option>
                  ) : null}
                </select>
              ) : (
                <code className="server-url" title={activeServer} data-testid="server-url">
                  {activeServer || 'No base URL yet'}
                </code>
              )}
              <button
                type="button"
                className="icon-btn is-subtle"
                onClick={startEditing}
                title="Edit base URL"
                aria-label="Edit base URL"
              >
                <Pencil size={13} />
              </button>
            </div>
          )}
        </div>

        <div className="spec-links">
          {servers[0]?.description && servers[0].description !== 'Spec origin' ? (
            <span className="spec-server-desc">
              <Globe2 size={12} /> {servers[0].description}
            </span>
          ) : null}
          {spec.externalDocs?.url ? (
            <a className="text-btn" href={spec.externalDocs.url} target="_blank" rel="noreferrer noopener">
              More docs <ExternalLink size={11} />
            </a>
          ) : null}
          {spec.termsOfService ? (
            <a className="text-btn" href={spec.termsOfService} target="_blank" rel="noreferrer noopener">
              Terms <ExternalLink size={11} />
            </a>
          ) : null}
        </div>
      </div>
    </section>
  );
};
