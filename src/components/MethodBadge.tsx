import React from 'react';

export function methodClass(method: string): string {
  return `method-${method.toLowerCase()}`;
}

export const MethodBadge: React.FC<{ method: string; small?: boolean }> = ({ method, small }) => (
  <span className={`method-badge ${methodClass(method)} ${small ? 'is-small' : ''}`}>
    {method.toUpperCase()}
  </span>
);
