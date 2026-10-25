import React from 'react';

/**
 * A deliberately small Markdown renderer for API descriptions: paragraphs,
 * headings, lists, fenced code, bold/italic, inline code, and links.
 */
function safeHref(url: string): string | null {
  const trimmed = url.trim();
  if (/^(https?:\/\/|mailto:|\/)/i.test(trimmed)) return trimmed;
  return null;
}

function renderInline(text: string, keyPrefix: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  const pattern = /\[([^\]]+)\]\(([^)\s]+)\)|(https?:\/\/[^\s<>)]+)|(\*\*[^*]+\*\*)|(`[^`]+`)|(\*[^*]+\*)/g;
  let cursor = 0;
  let match: RegExpExecArray | null;
  let index = 0;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > cursor) nodes.push(text.slice(cursor, match.index));
    const key = `${keyPrefix}-${index++}`;
    if (match[1] && match[2]) {
      const href = safeHref(match[2]);
      nodes.push(
        href ? (
          <a key={key} href={href} target="_blank" rel="noreferrer noopener">
            {match[1]}
          </a>
        ) : (
          match[1]
        ),
      );
    } else if (match[3]) {
      const href = safeHref(match[3]);
      nodes.push(
        href ? (
          <a key={key} href={href} target="_blank" rel="noreferrer noopener">
            {match[3]}
          </a>
        ) : (
          match[3]
        ),
      );
    } else if (match[4]) {
      nodes.push(<strong key={key}>{match[4].slice(2, -2)}</strong>);
    } else if (match[5]) {
      nodes.push(<code key={key}>{match[5].slice(1, -1)}</code>);
    } else if (match[6]) {
      nodes.push(<em key={key}>{match[6].slice(1, -1)}</em>);
    }
    cursor = match.index + match[0].length;
  }
  if (cursor < text.length) nodes.push(text.slice(cursor));
  return nodes;
}

export const Markdown: React.FC<{ text?: string; className?: string }> = ({ text, className = '' }) => {
  if (!text) return null;
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const blocks: React.ReactNode[] = [];
  let paragraph: string[] = [];
  let list: string[] = [];
  let code: string[] | null = null;

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    blocks.push(
      <p key={`p-${blocks.length}`}>{renderInline(paragraph.join(' '), `p${blocks.length}`)}</p>,
    );
    paragraph = [];
  };
  const flushList = () => {
    if (list.length === 0) return;
    blocks.push(
      <ul key={`ul-${blocks.length}`}>
        {list.map((item, index) => (
          <li key={index}>{renderInline(item, `li${blocks.length}-${index}`)}</li>
        ))}
      </ul>,
    );
    list = [];
  };

  for (const line of lines) {
    if (line.trim().startsWith('```')) {
      if (code === null) {
        flushParagraph();
        flushList();
        code = [];
      } else {
        blocks.push(
          <pre key={`pre-${blocks.length}`} className="md-code">
            <code>{code.join('\n')}</code>
          </pre>,
        );
        code = null;
      }
      continue;
    }
    if (code !== null) {
      code.push(line);
      continue;
    }
    if (!line.trim()) {
      flushParagraph();
      flushList();
      continue;
    }
    const heading = line.match(/^(#{1,4})\s+(.*)$/);
    if (heading) {
      flushParagraph();
      flushList();
      const level = Math.min(heading[1].length + 2, 6);
      const Tag = `h${level}` as keyof React.JSX.IntrinsicElements;
      blocks.push(<Tag key={`h-${blocks.length}`}>{renderInline(heading[2], `h${blocks.length}`)}</Tag>);
      continue;
    }
    const listItem = line.match(/^\s*[-*+]\s+(.*)$/);
    if (listItem) {
      flushParagraph();
      list.push(listItem[1]);
      continue;
    }
    paragraph.push(line.trim());
  }
  if (code !== null) {
    blocks.push(
      <pre key={`pre-${blocks.length}`} className="md-code">
        <code>{code.join('\n')}</code>
      </pre>,
    );
  }
  flushParagraph();
  flushList();

  return <div className={`markdown ${className}`}>{blocks}</div>;
};
