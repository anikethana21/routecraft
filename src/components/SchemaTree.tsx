import React, { useEffect, useState } from 'react';
import { ChevronDown, ChevronRight, RotateCcw } from 'lucide-react';
import type { JsonSchema } from '../types';
import type { RefResolver } from '../lib/spec/normalize';
import {
  constraintList,
  flattenSchema,
  resolveSchemaRef,
  schemaCanHaveChildren,
  schemaKind,
  schemaTypeLabel,
  sampleFromSchema,
} from '../lib/spec/schema';

interface SchemaTreeProps {
  schema: JsonSchema | undefined;
  resolver: RefResolver;
  name?: string;
  required?: boolean;
  depth?: number;
  initiallyOpen?: boolean;
  mode?: 'request' | 'response' | 'neutral';
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

function preview(value: unknown): string {
  if (typeof value === 'string') return `"${value}"`;
  try {
    const text = JSON.stringify(value);
    return text.length > 70 ? `${text.slice(0, 67)}…` : text;
  } catch {
    return String(value);
  }
}

const SchemaNode: React.FC<SchemaTreeProps> = ({
  schema,
  resolver,
  name,
  required,
  depth = 0,
  initiallyOpen = depth < 1,
  mode = 'neutral',
}) => {
  const [open, setOpen] = useState(initiallyOpen);
  useEffect(() => {
    setOpen(depth < 1);
  }, [schema, depth]);

  if (!schema) return null;
  const resolved = flattenSchema(schema, resolver);
  const circular = Boolean(resolved['x-circular']);
  const kind = schemaKind(resolved);
  const properties = resolved.properties || {};
  const items = Array.isArray(resolved.items) ? resolved.items[0] : resolved.items;
  const variants = resolved.oneOf || resolved.anyOf || [];
  const additional = typeof resolved.additionalProperties === 'object' ? resolved.additionalProperties : null;
  const hasChildren =
    !circular &&
    depth < 10 &&
    (Object.keys(properties).length > 0 || Boolean(items) || variants.length > 0 || Boolean(additional));
  const constraints = constraintList(resolved);
  const example = resolved.example !== undefined ? resolved.example : sampleFromSchema(resolved, resolver, { mode });

  return (
    <div className={`schema-node ${depth > 0 ? 'is-nested' : ''}`} data-depth={depth}>
      <div className="schema-row">
        {hasChildren ? (
          <button
            type="button"
            className="schema-toggle"
            onClick={() => setOpen((value) => !value)}
            aria-label={open ? 'Collapse schema' : 'Expand schema'}
          >
            {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          </button>
        ) : (
          <span className="schema-toggle-spacer" />
        )}
        {name ? (
          <code className="schema-name">
            {name}
            {required ? <span className="required-mark">*</span> : null}
          </code>
        ) : (
          <span className="schema-name schema-root">schema</span>
        )}
        <span className={`type-badge ${typeClass(kind)}`}>{schemaTypeLabel(resolved)}</span>
        {resolved.deprecated ? <span className="tiny-badge is-warn">deprecated</span> : null}
        {circular ? <span className="tiny-badge">circular</span> : null}
        {resolved.readOnly ? <span className="tiny-badge">read-only</span> : null}
        {resolved.writeOnly ? <span className="tiny-badge">write-only</span> : null}
      </div>

      {resolved.description ? <div className="schema-description">{resolved.description}</div> : null}

      {constraints.length > 0 || resolved.enum || resolved.default !== undefined || example !== undefined ? (
        <div className="schema-meta">
          {constraints.map((constraint) => (
            <span key={constraint} className="constraint">
              {constraint}
            </span>
          ))}
          {resolved.enum ? (
            <span className="constraint">
              enum: {resolved.enum.slice(0, 6).map((value) => String(value)).join(', ')}
              {resolved.enum.length > 6 ? '…' : ''}
            </span>
          ) : null}
          {resolved.default !== undefined ? <span className="constraint">default: {preview(resolved.default)}</span> : null}
          {example !== undefined && example !== null && Object.keys(properties).length === 0 ? (
            <span className="constraint">example: {preview(example)}</span>
          ) : null}
        </div>
      ) : null}

      {open && hasChildren ? (
        <div className="schema-children">
          {Object.entries(properties).map(([propertyName, property]) => (
            <SchemaNode
              key={propertyName}
              schema={property}
              resolver={resolver}
              name={propertyName}
              required={resolved.required?.includes(propertyName)}
              depth={depth + 1}
              mode={mode}
            />
          ))}
          {items ? (
            <SchemaNode
              schema={items}
              resolver={resolver}
              name="items[]"
              depth={depth + 1}
              mode={mode}
            />
          ) : null}
          {variants.map((variant, index) => (
            <SchemaNode
              key={`variant-${index}`}
              schema={variant}
              resolver={resolver}
              name={`${resolved.oneOf ? 'oneOf' : 'anyOf'} [${index + 1}]`}
              depth={depth + 1}
              mode={mode}
            />
          ))}
          {additional ? (
            <SchemaNode
              schema={additional}
              resolver={resolver}
              name="additionalProperties"
              depth={depth + 1}
              mode={mode}
            />
          ) : null}
        </div>
      ) : null}
    </div>
  );
};

export const SchemaTree: React.FC<{
  schema: JsonSchema | undefined;
  resolver: RefResolver;
  emptyLabel?: string;
  mode?: 'request' | 'response' | 'neutral';
}> = ({ schema, resolver, emptyLabel = 'No schema provided.', mode = 'neutral' }) => {
  if (!schema) return <div className="schema-empty">{emptyLabel}</div>;
  const resolved = resolveSchemaRef(schema, resolver);
  if (!resolved || Object.keys(resolved).length === 0) return <div className="schema-empty">{emptyLabel}</div>;
  return (
    <div className="schema-tree">
      <SchemaNode schema={schema} resolver={resolver} depth={0} initiallyOpen mode={mode} />
    </div>
  );
};

export const SchemaResetButton: React.FC<{ onClick: () => void }> = ({ onClick }) => (
  <button type="button" className="text-btn" onClick={onClick}>
    <RotateCcw size={12} /> Reset example
  </button>
);
