import React, { useMemo, useState } from 'react';
import { Braces, RotateCcw } from 'lucide-react';
import type { ApiRequestBody, JsonSchema } from '../types';
import type { RefResolver } from '../lib/spec/normalize';
import { exampleFromMedia, isJsonMediaType } from '../lib/spec/schema';
import { SchemaTree } from './SchemaTree';

interface RequestBodyEditorProps {
  body: ApiRequestBody;
  resolver: RefResolver;
  contentType: string;
  readOnly?: boolean;
  onContentTypeChange: (contentType: string) => void;
  text: string;
  onTextChange: (text: string) => void;
}

export const RequestBodyEditor: React.FC<RequestBodyEditorProps> = ({
  body,
  resolver,
  contentType,
  readOnly = false,
  onContentTypeChange,
  text,
  onTextChange,
}) => {
  const [tab, setTab] = useState<'example' | 'schema'>('example');
  const contentTypes = Object.keys(body.content);
  const media = body.content[contentType] || body.content[contentTypes[0]];
  const mediaType = body.content[contentType] ? contentType : contentTypes[0];
  const isJson = isJsonMediaType(mediaType);

  const invalidJson = useMemo(() => {
    if (!isJson || !text.trim()) return false;
    try {
      JSON.parse(text);
      return false;
    } catch {
      return true;
    }
  }, [isJson, text]);

  const formatJson = () => {
    if (!isJson) return;
    try {
      onTextChange(JSON.stringify(JSON.parse(text), null, 2));
    } catch {
      /* leave invalid input untouched */
    }
  };

  const resetExample = () => {
    const example = exampleFromMedia(media, resolver, { mode: 'request' });
    onTextChange(
      example === null || example === undefined
        ? ''
        : typeof example === 'string'
          ? example
          : JSON.stringify(example, null, 2),
    );
  };

  return (
    <div className={`request-body-editor ${readOnly ? 'is-readonly' : ''}`}>
      <div className="section-head">
        <div className="section-head-title">
          <h3>Request body</h3>
          {body.required ? <span className="required-badge">required</span> : null}
        </div>
        {contentTypes.length > 1 ? (
          <select
            className="input input-compact mono"
            value={mediaType}
            disabled={readOnly}
            onChange={(event) => onContentTypeChange(event.target.value)}
            aria-label="Request content type"
            data-testid="content-type-select"
          >
            {contentTypes.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>
        ) : (
          <span className="content-type-label mono">{mediaType}</span>
        )}
      </div>

      <div className="editor-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'example'}
          className={tab === 'example' ? 'is-active' : ''}
          onClick={() => setTab('example')}
        >
          Example
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'schema'}
          className={tab === 'schema' ? 'is-active' : ''}
          onClick={() => setTab('schema')}
        >
          Schema
        </button>
        <div className="editor-tabs-spacer" />
        {tab === 'example' ? (
          <>
            {isJson ? (
              <button type="button" className="text-btn" onClick={formatJson} title="Format JSON" disabled={readOnly}>
                <Braces size={12} /> Format
              </button>
            ) : null}
            <button type="button" className="text-btn" onClick={resetExample} title="Reset to schema example" disabled={readOnly}>
              <RotateCcw size={12} /> Reset
            </button>
          </>
        ) : null}
      </div>

      {tab === 'example' ? (
        <div className={`editor-area ${invalidJson ? 'has-error' : ''}`}>
          <textarea
            className="input code-input body-input"
            value={text}
            readOnly={readOnly}
            onChange={(event) => onTextChange(event.target.value)}
            placeholder={isJson ? '{\n  "key": "value"\n}' : 'Request body'}
            spellCheck={false}
            autoCapitalize="off"
            aria-label="Request body"
            data-testid="request-body-input"
          />
          {invalidJson ? <div className="field-error">This is not valid JSON yet.</div> : null}
        </div>
      ) : (
        <div className="schema-panel">
          <SchemaTree schema={media?.schema as JsonSchema} resolver={resolver} mode="request" />
        </div>
      )}
    </div>
  );
};
