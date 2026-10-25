import React, { useState } from 'react';
import type { ApiResponseDef } from '../types';
import type { RefResolver } from '../lib/spec/normalize';
import { exampleFromMedia, isJsonMediaType, preferredMediaType } from '../lib/spec/schema';
import { JsonView } from './JsonView';
import { SchemaTree } from './SchemaTree';

function statusClass(status: string): string {
  const code = parseInt(status, 10);
  if (Number.isNaN(code)) return 'status-default';
  if (code >= 200 && code < 300) return 'status-2xx';
  if (code >= 300 && code < 400) return 'status-3xx';
  if (code >= 400 && code < 500) return 'status-4xx';
  return 'status-5xx';
}

interface ResponsesDocProps {
  responses: ApiResponseDef[];
  resolver: RefResolver;
}

type ResponseTab = 'example' | 'schema';

export const ResponsesDoc: React.FC<ResponsesDocProps> = ({ responses, resolver }) => {
  const [mediaTypes, setMediaTypes] = useState<Record<string, string>>({});
  const [tabs, setTabs] = useState<Record<string, ResponseTab>>({});

  if (responses.length === 0) return null;

  return (
    <div className="responses-doc">
      <div className="section-head">
        <div className="section-head-title">
          <h3>Responses</h3>
        </div>
      </div>
      <div className="responses-list">
        <div className="responses-table-head" aria-hidden="true">
          <span>Code</span>
          <span>Description</span>
          <span>Links</span>
        </div>
        {responses.map((response) => {
          const contentTypes = Object.keys(response.content || {});
          const mediaType = mediaTypes[response.status]
            || (contentTypes.length ? preferredMediaType(response.content) : '');
          const media = mediaType ? response.content?.[mediaType] : undefined;
          const example = media ? exampleFromMedia(media, resolver, { mode: 'response' }) : undefined;
          const tab = tabs[response.status] || 'example';
          const links = response.links ? Object.keys(response.links) : [];
          const exampleText = isJsonMediaType(mediaType)
            ? undefined
            : typeof example === 'string'
              ? example
              : example === undefined
                ? undefined
                : JSON.stringify(example, null, 2);
          return (
            <div className="response-doc" key={response.status} data-testid={`response-doc-${response.status}`}>
              <div className="response-doc-row">
                <span className={`doc-status ${statusClass(response.status)}`}>{response.status}</span>
                <span className="response-doc-description">{response.description || 'No description'}</span>
                <span className={`response-doc-links ${links.length === 0 ? 'is-empty' : ''}`}>
                  {links.length > 0 ? links.join(', ') : 'No links'}
                </span>
              </div>

              {media ? (
                <div className="response-doc-body">
                  <div className="response-media-row">
                    <label className="response-media-label">
                      <span className="mini-label">Media type</span>
                      <select
                        className="input input-compact mono"
                        value={mediaType}
                        onChange={(event) => setMediaTypes((previous) => ({ ...previous, [response.status]: event.target.value }))}
                        aria-label={`Media type for ${response.status}`}
                        data-testid={`response-media-${response.status}`}
                      >
                        {contentTypes.map((type) => (
                          <option key={type} value={type}>
                            {type}
                          </option>
                        ))}
                      </select>
                    </label>
                    <span className="response-accept-hint">Controls Accept header.</span>
                  </div>

                  <div className="editor-tabs" role="tablist">
                    <button
                      type="button"
                      role="tab"
                      aria-selected={tab === 'example'}
                      className={tab === 'example' ? 'is-active' : ''}
                      onClick={() => setTabs((previous) => ({ ...previous, [response.status]: 'example' }))}
                      data-testid={`response-tab-${response.status}-example`}
                    >
                      Example Value
                    </button>
                    <button
                      type="button"
                      role="tab"
                      aria-selected={tab === 'schema'}
                      className={tab === 'schema' ? 'is-active' : ''}
                      onClick={() => setTabs((previous) => ({ ...previous, [response.status]: 'schema' }))}
                      data-testid={`response-tab-${response.status}-schema`}
                    >
                      Schema
                    </button>
                  </div>

                  {tab === 'example' ? (
                    <div className="response-doc-example">
                      {example === undefined || example === null ? (
                        <p className="muted response-empty">No example available.</p>
                      ) : (
                        <JsonView value={example} rawText={exampleText} />
                      )}
                    </div>
                  ) : (
                    <div className="schema-panel response-schema">
                      <SchemaTree schema={media.schema} resolver={resolver} mode="response" />
                    </div>
                  )}

                  {response.headers ? (
                    <div className="response-doc-headers">
                      <div className="mini-label">Response headers</div>
                      <table className="table">
                        <tbody>
                          {Object.entries(response.headers).map(([name, header]) => (
                            <tr key={name}>
                              <td className="header-key">{name}</td>
                              <td className="header-value">
                                {header.description || header.schema?.type || 'string'}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : null}
                </div>
              ) : response.headers ? (
                <div className="response-doc-body">
                  <div className="response-doc-headers">
                    <div className="mini-label">Response headers</div>
                    <table className="table">
                      <tbody>
                        {Object.entries(response.headers).map(([name, header]) => (
                          <tr key={name}>
                            <td className="header-key">{name}</td>
                            <td className="header-value">
                              {header.description || header.schema?.type || 'string'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
};
