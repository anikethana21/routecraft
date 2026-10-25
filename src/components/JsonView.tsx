import React from 'react';

interface Token {
  text: string;
  type: 'plain' | 'key' | 'string' | 'number' | 'boolean' | 'null' | 'punct';
}

function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  const pattern = /("(?:\\u[a-fA-F0-9]{4}|\\[^u]|[^\\"])*")(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g;
  let cursor = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > cursor) tokens.push({ text: text.slice(cursor, match.index), type: 'plain' });
    if (match[1]) {
      tokens.push({ text: match[1], type: match[2] ? 'key' : 'string' });
      if (match[2]) tokens.push({ text: match[2], type: 'punct' });
    } else if (match[3]) {
      tokens.push({ text: match[3], type: match[3] === 'null' ? 'null' : 'boolean' });
    } else if (match[0]) {
      tokens.push({ text: match[0], type: 'number' });
    }
    cursor = match.index + match[0].length;
  }
  if (cursor < text.length) tokens.push({ text: text.slice(cursor), type: 'plain' });
  return tokens;
}

interface JsonViewProps {
  value: unknown;
  rawText?: string;
  className?: string;
}

export const JsonView: React.FC<JsonViewProps> = ({ value, rawText, className = '' }) => {
  let text = '';
  let isJson = false;
  if (typeof value === 'object' && value !== null) {
    try {
      text = JSON.stringify(value, null, 2);
      isJson = true;
    } catch {
      text = String(value);
    }
  } else if (typeof value === 'string') {
    text = rawText || value;
    try {
      const parsed = JSON.parse(text);
      if (parsed && typeof parsed === 'object') {
        text = JSON.stringify(parsed, null, 2);
        isJson = true;
      }
    } catch {
      isJson = false;
    }
  } else {
    text = rawText || (value === null || value === undefined ? '' : String(value));
  }

  if (!text) {
    return <pre className={`code-block json-code ${className}`}><code className="empty-body">(empty response body)</code></pre>;
  }

  const shouldHighlight = isJson && text.length < 300000;
  return (
    <pre className={`code-block json-code ${className}`}>
      <code>
        {shouldHighlight
          ? tokenize(text).map((token, index) => (
              <span key={index} className={`tok-${token.type}`}>
                {token.text}
              </span>
            ))
          : text}
      </code>
    </pre>
  );
};
