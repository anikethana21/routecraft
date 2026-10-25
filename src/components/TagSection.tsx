import React, { useEffect, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { ApiTag } from '../types';
import { Markdown } from './Markdown';
import { OperationCard } from './OperationCard';

interface TagSectionProps {
  tag: ApiTag;
  filtering?: boolean;
  defaultOpen?: boolean;
}

export function tagSlug(name: string): string {
  return name.toLowerCase().replace(/[^\w]+/g, '-').replace(/^-|-$/g, '') || 'default';
}

export const TagSection: React.FC<TagSectionProps> = ({ tag, filtering = false, defaultOpen = true }) => {
  const [open, setOpen] = useState(defaultOpen || filtering);

  useEffect(() => {
    if (filtering) setOpen(true);
  }, [filtering]);

  if (tag.operations.length === 0) return null;

  return (
    <section className={`tag-section ${open ? 'is-open' : ''}`} id={`tag-${tagSlug(tag.name)}`}>
      <button
        type="button"
        className="tag-head"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
      >
        <span className="tag-chevron">{open ? <ChevronDown size={17} /> : <ChevronRight size={17} />}</span>
        <span className="tag-name">{tag.name === 'default' ? 'Default' : tag.name}</span>
        <span className="tag-count">{tag.operations.length}</span>
        {tag.description ? <span className="tag-description">{tag.description}</span> : null}
      </button>

      {open ? (
        <div className="tag-body">
          {tag.description ? (
            <div className="tag-intro">
              <Markdown text={tag.description} />
            </div>
          ) : null}
          {tag.operations.map((operation) => (
            <OperationCard key={operation.key} operation={operation} tagName={tag.name} />
          ))}
        </div>
      ) : null}
    </section>
  );
};
