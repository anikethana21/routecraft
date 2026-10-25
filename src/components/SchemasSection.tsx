import React, { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Layers } from 'lucide-react';
import type { JsonSchema } from '../types';
import type { RefResolver } from '../lib/spec/normalize';
import { schemaKind, schemaTypeLabel } from '../lib/spec/schema';
import { SchemaTree } from './SchemaTree';

interface SchemasSectionProps {
  schemas: Record<string, JsonSchema>;
  resolver: RefResolver;
  query?: string;
}

function typeClass(kind: string): string {
  if (kind.startsWith('array')) return 'type-array';
  if (kind === 'object' || kind === 'allOf') return 'type-object';
  if (kind === 'string') return 'type-string';
  if (kind === 'integer' || kind === 'number') return 'type-number';
  if (kind === 'boolean') return 'type-boolean';
  if (kind === 'null') return 'type-null';
  if (kind === 'oneOf' || kind === 'anyOf') return 'type-union';
  return 'type-any';
}

export const SchemasSection: React.FC<SchemasSectionProps> = ({ schemas, resolver, query = '' }) => {
  const [sectionOpen, setSectionOpen] = useState(true);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const entries = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return Object.entries(schemas)
      .filter(([name]) => !normalized || name.toLowerCase().includes(normalized))
      .sort(([a], [b]) => a.localeCompare(b));
  }, [schemas, query]);

  if (Object.keys(schemas).length === 0) return null;
  if (entries.length === 0) return null;

  return (
    <section className="schemas-section" id="schemas">
      <button
        type="button"
        className="schemas-head"
        onClick={() => setSectionOpen((value) => !value)}
        aria-expanded={sectionOpen}
      >
        <span className="tag-chevron">{sectionOpen ? <ChevronDown size={17} /> : <ChevronRight size={17} />}</span>
        <Layers size={16} className="schemas-icon" />
        <span className="tag-name">Schemas</span>
        <span className="tag-count">{entries.length}</span>
      </button>

      {sectionOpen ? (
        <div className="schemas-list">
          {entries.map(([name, schema]) => {
            const isOpen = Boolean(expanded[name]);
            const kind = schemaKind(schema);
            return (
              <div className={`schema-card ${isOpen ? 'is-open' : ''}`} key={name}>
                <button
                  type="button"
                  className="schema-card-head"
                  onClick={() => setExpanded((previous) => ({ ...previous, [name]: !previous[name] }))}
                  aria-expanded={isOpen}
                >
                  <span className="schema-card-chevron">
                    {isOpen ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                  </span>
                  <code className="schema-card-name">{name}</code>
                  <span className={`type-badge ${typeClass(kind)}`}>{schemaTypeLabel(schema)}</span>
                  {schema.description ? <span className="schema-card-desc">{schema.description}</span> : null}
                </button>
                {isOpen ? (
                  <div className="schema-card-body">
                    <SchemaTree schema={schema} resolver={resolver} />
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}
    </section>
  );
};
