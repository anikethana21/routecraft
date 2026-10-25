import { describe, expect, it } from 'vitest';
import { CODE_LANGUAGES, generateCode, languageLabel } from '../../src/lib/codegen';
import type { CodeRequest } from '../../src/types';

const request: CodeRequest = {
  method: 'POST',
  url: 'http://127.0.0.1:4010/echo?page=2',
  headers: { 'Content-Type': 'application/json', Authorization: 'Bearer abc' },
  body: '{"hello":"world"}',
};

describe('code generation', () => {
  it('generates a snippet for every supported language', () => {
    for (const language of CODE_LANGUAGES) {
      const code = generateCode(language.id, request);
      expect(code.length, language.id).toBeGreaterThan(20);
      expect(code, language.id).toContain('127.0.0.1:4010');
      expect(code.toLowerCase(), language.id).toContain('post');
    }
  });

  it('builds a curl command with headers and body', () => {
    const curl = generateCode('curl', request);
    expect(curl).toContain("--request POST");
    expect(curl).toContain("--header 'Authorization: Bearer abc'");
    expect(curl).toContain('--data-raw');
  });

  it('escapes single quotes safely in shell snippets', () => {
    const curl = generateCode('curl', { ...request, url: "http://x.test/it's" });
    expect(curl).toContain("it'\\''s");
  });

  it('generates requests code with JSON payloads', () => {
    const python = generateCode('python', request);
    expect(python).toContain('import requests');
    expect(python).toContain('json=payload');
    const fetch = generateCode('fetch', request);
    expect(fetch).toContain('await fetch(');
    expect(fetch).toContain('JSON.stringify');
  });

  it('handles requests without bodies', () => {
    const code = generateCode('go', { method: 'GET', url: 'https://example.com', headers: {} });
    expect(code).toContain('http.NewRequest("GET"');
    expect(code).not.toContain('strings.NewReader');
  });

  it('exposes friendly language labels', () => {
    expect(languageLabel('curl')).toBe('cURL');
    expect(languageLabel('csharp')).toBe('C#');
    expect(CODE_LANGUAGES).toHaveLength(11);
  });
});
