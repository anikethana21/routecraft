import React, { useMemo } from 'react';
import { Loader2, Search, X } from 'lucide-react';
import { useApp } from '../state/AppContext';
import { SpecHeader } from './SpecHeader';
import { TagSection } from './TagSection';
import { SchemasSection } from './SchemasSection';

export const DocsView: React.FC = () => {
  const { spec, resolver, loading, error, clearError, endpointFilter, setEndpointFilter } = useApp();

  const normalizedQuery = endpointFilter.trim().toLowerCase();

  const tags = useMemo(() => {
    if (!spec) return [];
    if (!normalizedQuery) return spec.tags;
    return spec.tags
      .map((tag) => {
        const tagMatches = tag.name.toLowerCase().includes(normalizedQuery)
          || Boolean(tag.description?.toLowerCase().includes(normalizedQuery));
        const operations = tagMatches
          ? tag.operations
          : tag.operations.filter((operation) =>
              [
                operation.path,
                operation.summary,
                operation.description,
                operation.operationId || '',
                operation.method,
              ]
                .join(' ')
                .toLowerCase()
                .includes(normalizedQuery),
            );
        return { ...tag, operations };
      })
      .filter((tag) => tag.operations.length > 0);
  }, [spec, normalizedQuery]);

  const visibleCount = useMemo(
    () => tags.reduce((total, tag) => total + tag.operations.length, 0),
    [tags],
  );

  if (!spec) {
    return (
      <main className="docs-view docs-loading">
        {loading ? (
          <div className="loading-state">
            <Loader2 size={22} className="spin" />
            <span>Loading the specification…</span>
          </div>
        ) : error ? (
          <div className="load-error" role="alert">
            <div className="load-error-head">
              <strong>{error.message}</strong>
              <button type="button" className="icon-btn" onClick={clearError} aria-label="Dismiss error">
                <X size={15} />
              </button>
            </div>
            {error.hint ? <p>{error.hint}</p> : null}
          </div>
        ) : (
          <div className="loading-state">No specification is loaded.</div>
        )}
      </main>
    );
  }

  return (
    <main className="docs-view">
      <div className="docs-container">
        <SpecHeader />

        <div className="docs-toolbar">
          <span className="docs-count" data-testid="operation-count">
            {normalizedQuery
              ? `${visibleCount} of ${spec.operations.length} endpoints`
              : `${spec.operations.length} endpoint${spec.operations.length === 1 ? '' : 's'}`}
          </span>
          {loading ? <Loader2 size={15} className="spin docs-spinner" /> : null}
        </div>

        {tags.length === 0 ? (
          <div className="docs-empty">
            <Search size={22} />
            <strong>No endpoints match “{endpointFilter.trim()}”</strong>
            <button type="button" className="text-btn" onClick={() => setEndpointFilter('')}>
              Clear the filter
            </button>
          </div>
        ) : (
          <div className="tags">
            {tags.map((tag) => (
              <TagSection key={tag.name} tag={tag} filtering={Boolean(normalizedQuery)} />
            ))}
          </div>
        )}

        {resolver ? (
          <SchemasSection schemas={spec.schemas} resolver={resolver} query={normalizedQuery} />
        ) : null}
      </div>
    </main>
  );
};
