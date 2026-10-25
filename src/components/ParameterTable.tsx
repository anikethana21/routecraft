import React from 'react';
import type { ApiParameter } from '../types';
import { constraintList, schemaTypeLabel } from '../lib/spec/schema';

interface ParameterTableProps {
  parameters: ApiParameter[];
  values: Record<string, string>;
  disabled?: boolean;
  onChange: (key: string, value: string) => void;
}

function placeholderFor(parameter: ApiParameter): string {
  if (parameter.example !== undefined) return String(parameter.example);
  if (parameter.schema.default !== undefined) return String(parameter.schema.default);
  if (parameter.schema.enum?.length) return String(parameter.schema.enum[0]);
  const type = parameter.schema.type;
  if (Array.isArray(type)) return 'value';
  if (type === 'integer' || type === 'number') return '0';
  if (type === 'boolean') return 'false';
  if (type === 'array') return 'one, two';
  return 'value';
}

export const ParameterTable: React.FC<ParameterTableProps> = ({ parameters, values, disabled = false, onChange }) => {
  if (parameters.length === 0) return null;

  return (
    <div className={`table-wrap param-table-wrap ${disabled ? 'is-readonly' : ''}`}>
      <table className="table param-table">
        <thead>
          <tr>
            <th className="param-name-col">Name</th>
            <th>Description</th>
            <th className="param-value-col">Value</th>
          </tr>
        </thead>
        <tbody>
          {parameters.map((parameter) => {
            const value = values[parameter.key] ?? '';
            const constraints = constraintList(parameter.schema);
            const enumValues = parameter.schema.enum;
            const isBoolean = parameter.schema.type === 'boolean';
            return (
              <tr key={parameter.key}>
                <td className="param-name-cell">
                  <div className="param-name-line">
                    <code className="param-name">
                      {parameter.name}
                      {parameter.required ? <span className="required-mark">*</span> : null}
                    </code>
                  </div>
                  <div className="param-tags">
                    <span className="type-badge type-string">{schemaTypeLabel(parameter.schema)}</span>
                    <span className={`param-in param-in-${parameter.in}`}>{parameter.in}</span>
                    {parameter.deprecated ? <span className="tiny-badge is-warn">deprecated</span> : null}
                  </div>
                </td>
                <td className="param-desc-cell">
                  {parameter.description ? <p>{parameter.description}</p> : <p className="muted">—</p>}
                  {constraints.length > 0 ? (
                    <div className="param-meta">
                      {constraints.map((constraint) => (
                        <span key={constraint} className="constraint">
                          {constraint}
                        </span>
                      ))}
                    </div>
                  ) : null}
                  {enumValues && enumValues.length > 0 ? (
                    <div className="param-meta">
                      <span className="constraint">
                        enum: {enumValues.slice(0, 8).map((item) => String(item)).join(', ')}
                        {enumValues.length > 8 ? '…' : ''}
                      </span>
                    </div>
                  ) : null}
                </td>
                <td className="param-value-cell">
                  {enumValues && enumValues.length > 0 ? (
                    <select
                      className="input mono"
                      value={value}
                      disabled={disabled}
                      onChange={(event) => onChange(parameter.key, event.target.value)}
                      aria-label={`Value for ${parameter.name}`}
                      data-testid={`param-${parameter.in}-${parameter.name}`}
                    >
                      <option value="">—</option>
                      {enumValues.map((item) => (
                        <option key={String(item)} value={String(item)}>
                          {String(item)}
                        </option>
                      ))}
                    </select>
                  ) : isBoolean ? (
                    <select
                      className="input mono"
                      value={value}
                      disabled={disabled}
                      onChange={(event) => onChange(parameter.key, event.target.value)}
                      aria-label={`Value for ${parameter.name}`}
                      data-testid={`param-${parameter.in}-${parameter.name}`}
                    >
                      <option value="">—</option>
                      <option value="true">true</option>
                      <option value="false">false</option>
                    </select>
                  ) : (
                    <input
                      className="input mono"
                      value={value}
                      disabled={disabled}
                      onChange={(event) => onChange(parameter.key, event.target.value)}
                      placeholder={placeholderFor(parameter)}
                      spellCheck={false}
                      autoCapitalize="off"
                      aria-label={`Value for ${parameter.name}`}
                      data-testid={`param-${parameter.in}-${parameter.name}`}
                    />
                  )}
                  {parameter.required ? <span className="param-required-hint">required</span> : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};
