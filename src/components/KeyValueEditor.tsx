import React from 'react';
import { Plus, Trash2 } from 'lucide-react';
import type { KeyValue } from '../types';
import { makeKeyValue } from '../lib/request';

interface KeyValueEditorProps {
  rows: KeyValue[];
  onChange: (rows: KeyValue[]) => void;
  keyPlaceholder?: string;
  valuePlaceholder?: string;
  addLabel?: string;
  mono?: boolean;
}

export const KeyValueEditor: React.FC<KeyValueEditorProps> = ({
  rows,
  onChange,
  keyPlaceholder = 'Key',
  valuePlaceholder = 'Value',
  addLabel = 'Add row',
  mono = true,
}) => {
  const update = (index: number, patch: Partial<KeyValue>) => {
    onChange(rows.map((row, rowIndex) => (rowIndex === index ? { ...row, ...patch } : row)));
  };

  return (
    <div className="kv-editor">
      {rows.length === 0 ? (
        <div className="kv-empty">No entries yet.</div>
      ) : (
        rows.map((row, index) => (
          <div className={`kv-row ${row.enabled ? '' : 'is-disabled'}`} key={row.id}>
            <input
              type="checkbox"
              className="kv-check"
              checked={row.enabled}
              onChange={(event) => update(index, { enabled: event.target.checked })}
              aria-label={`Enable ${row.key || 'row'}`}
            />
            <input
              className={`input kv-key ${mono ? 'mono' : ''}`}
              value={row.key}
              onChange={(event) => update(index, { key: event.target.value })}
              placeholder={keyPlaceholder}
              spellCheck={false}
              autoCapitalize="off"
            />
            <input
              className={`input kv-value ${mono ? 'mono' : ''}`}
              value={row.value}
              onChange={(event) => update(index, { value: event.target.value })}
              placeholder={valuePlaceholder}
              spellCheck={false}
              autoCapitalize="off"
            />
            <button
              type="button"
              className="icon-btn kv-remove"
              onClick={() => onChange(rows.filter((_, rowIndex) => rowIndex !== index))}
              aria-label="Remove row"
            >
              <Trash2 size={14} />
            </button>
          </div>
        ))
      )}
      <button
        type="button"
        className="text-btn kv-add"
        onClick={() => onChange([...rows, makeKeyValue()])}
      >
        <Plus size={13} /> {addLabel}
      </button>
    </div>
  );
};
