export interface ParsedTarget {
  raw: string;
  target: string;
  headers: Record<string, string>;
}

export interface BuildAppUrlOptions {
  operation?: string;
  server?: string;
  specHeadersKey?: string | null;
}

export interface OmniboxSuggestion {
  content: string;
  description: string;
}

export function tokenize(input: string): string[];
export function normalizeTarget(input: string): string;
export function parseTarget(input: string): ParsedTarget;
export function buildAppUrl(base: string, target: string, options?: BuildAppUrlOptions): string;
export function suggestionsFor(input: string): OmniboxSuggestion[];
