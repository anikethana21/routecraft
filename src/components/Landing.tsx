import React, { useRef, useState } from 'react';
import { ArrowRight, FileJson, FolderOpen, Globe, Loader2, Upload, X } from 'lucide-react';
import { useApp } from '../state/AppContext';
import { LogoMark } from './Logo';

const PRESETS = [
  { label: 'FastAPI · :8000', url: 'http://127.0.0.1:8000/openapi.json' },
  { label: 'Express · :3000', url: 'http://localhost:3000' },
  { label: 'Flask · :5000', url: 'http://localhost:5000/openapi.json' },
  { label: 'Django REST · :8000', url: 'http://localhost:8000/api/schema/' },
  { label: 'NestJS · :3000', url: 'http://localhost:3000/api-json' },
  { label: 'Spring Boot · :8080', url: 'http://localhost:8080/v3/api-docs' },
  { label: 'ASP.NET · :5000', url: 'http://localhost:5000/swagger/v1/swagger.json' },
  { label: 'Go · :8080', url: 'http://localhost:8080/swagger/doc.json' },
];

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function hostOf(value: string): string {
  try {
    const url = new URL(value);
    return url.host;
  } catch {
    return value;
  }
}

export const Landing: React.FC = () => {
  const {
    loadUrl,
    loadText,
    loadFile,
    loading,
    error,
    spec,
    source,
    recent,
    setView,
    closeSpec,
    clearError,
  } = useApp();
  const [input, setInput] = useState('');
  const [showPaste, setShowPaste] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const submitUrl = (event?: React.FormEvent) => {
    event?.preventDefault();
    if (input.trim()) void loadUrl(input.trim());
  };

  const onDrop = (event: React.DragEvent) => {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer.files?.[0];
    if (file) void loadFile(file);
  };

  return (
    <main
      className={`landing ${dragging ? 'is-dragging' : ''}`}
      onDragOver={(event) => {
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
    >
      {dragging ? (
        <div className="drop-overlay">
          <Upload size={30} />
          <strong>Drop an OpenAPI file</strong>
          <span>JSON or YAML</span>
        </div>
      ) : null}

      <section className="landing-hero">
        <LogoMark size={54} />
        <h1>Read the docs. Send the request.</h1>
        <p>
          RouteCraft turns any OpenAPI document into clean, readable API docs — and lets you call
          every endpoint from the same page.
        </p>

        {spec && source ? (
          <div className="current-spec">
            <div className="current-spec-text">
              <span className="eyebrow">Currently open</span>
              <strong>{spec.title}</strong>
              <span className="mono">{source.kind === 'url' ? hostOf(source.value) : source.label}</span>
            </div>
            <div className="current-spec-actions">
              <button type="button" className="btn btn-secondary" onClick={() => setView('docs')}>
                Open docs <ArrowRight size={14} />
              </button>
              <button type="button" className="text-btn" onClick={closeSpec}>
                Close
              </button>
            </div>
          </div>
        ) : null}

        <form className="spec-loader" onSubmit={submitUrl}>
          <Globe size={17} className="spec-loader-icon" />
          <input
            value={input}
            onChange={(event) => {
              setInput(event.target.value);
              if (error) clearError();
            }}
            placeholder="http://localhost:8000/openapi.json"
            spellCheck={false}
            autoCapitalize="off"
            aria-label="OpenAPI document URL"
            data-testid="spec-url-input"
          />
          <button type="submit" className="btn btn-primary" disabled={loading || !input.trim()} data-testid="load-spec">
            {loading ? <Loader2 size={15} className="spin" /> : null}
            {loading ? 'Loading' : 'Explore'}
          </button>
        </form>

        <div className="landing-tools">
          <button type="button" className="text-btn" onClick={() => fileInput.current?.click()}>
            <FolderOpen size={14} /> Open a file
          </button>
          <span className="dot-sep">·</span>
          <button type="button" className="text-btn" onClick={() => setShowPaste((value) => !value)}>
            <FileJson size={14} /> Paste a spec
          </button>
          <span className="dot-sep">·</span>
          <label className="preset-select">
            <span>Try an example</span>
            <select
              defaultValue=""
              onChange={(event) => {
                const value = event.target.value;
                if (value) void loadUrl(value);
                event.target.value = '';
              }}
              aria-label="Load an example API"
            >
              <option value="" disabled>
                Choose a framework
              </option>
              {PRESETS.map((preset) => (
                <option key={preset.label} value={preset.url}>
                  {preset.label}
                </option>
              ))}
            </select>
          </label>
          <input
            ref={fileInput}
            type="file"
            accept=".json,.yaml,.yml,application/json,application/yaml,text/yaml"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void loadFile(file);
              event.target.value = '';
            }}
            data-testid="spec-file-input"
          />
        </div>

        {showPaste ? (
          <div className="paste-panel">
            <div className="paste-head">
              <strong>Paste a JSON or YAML specification</strong>
              <button type="button" className="icon-btn" onClick={() => setShowPaste(false)} aria-label="Close paste panel">
                <X size={15} />
              </button>
            </div>
            <textarea
              className="input code-input"
              rows={8}
              value={pasteText}
              onChange={(event) => setPasteText(event.target.value)}
              placeholder={'openapi: 3.0.0\ninfo:\n  title: My API\n  version: 1.0.0\npaths: {}'}
              spellCheck={false}
              data-testid="paste-spec-input"
            />
            <div className="paste-actions">
              <button
                type="button"
                className="btn btn-primary"
                disabled={!pasteText.trim() || loading}
                onClick={() => void loadText(pasteText, 'Pasted specification')}
              >
                Load pasted spec
              </button>
            </div>
          </div>
        ) : null}

        {error ? (
          <div className="load-error" role="alert" data-testid="load-error">
            <div className="load-error-head">
              <strong>{error.message}</strong>
              <button type="button" className="icon-btn" onClick={clearError} aria-label="Dismiss error">
                <X size={15} />
              </button>
            </div>
            {error.hint ? <p>{error.hint}</p> : null}
            {error.attempts && error.attempts.length > 0 ? (
              <details>
                <summary>What was tried ({error.attempts.length})</summary>
                <ul>
                  {error.attempts.map((attempt, index) => (
                    <li key={index} className="mono">
                      {attempt}
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
          </div>
        ) : null}

        {recent.length > 0 ? (
          <section className="recent">
            <div className="section-label">Recent</div>
            <div className="recent-list">
              {recent.slice(0, 5).map((item) => (
                <button
                  type="button"
                  key={item.url}
                  className="recent-item"
                  onClick={() => void loadUrl(item.url)}
                >
                  <span className="recent-title">{item.title}</span>
                  <span className="recent-meta mono">
                    {hostOf(item.url)}
                    {item.version ? ` · v${item.version}` : ''} · {timeAgo(item.loadedAt)}
                  </span>
                  <ArrowRight size={14} className="recent-arrow" />
                </button>
              ))}
            </div>
          </section>
        ) : null}
      </section>

      <footer className="landing-foot">
        <span>OpenAPI 2.0 · 3.0 · 3.1</span>
        <span className="dot-sep">·</span>
        <span>JSON or YAML</span>
        <span className="dot-sep">·</span>
        <span>Drop a file, paste a spec, or load a URL</span>
      </footer>
    </main>
  );
};
