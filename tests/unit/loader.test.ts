import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  SpecLoadError,
  loadSpecFromText,
  normalizeUrlInput,
  parseSpecText,
} from '../../src/lib/spec/loader';

const fixtureDir = fileURLToPath(new URL('../api/fixtures/', import.meta.url));

function text(name: string) {
  return readFileSync(fixtureDir + name, 'utf8');
}

describe('spec loader', () => {
  it('parses JSON and YAML documents', () => {
    expect(parseSpecText(text('fastapi.json')).title).toBe('FastAPI Demo');
    expect(parseSpecText(text('express.yaml')).title).toBe('Express Users API');
    expect(parseSpecText(text('django.yaml')).title).toBe('Django Shop API');
  });

  it('strips a UTF-8 BOM', () => {
    expect(parseSpecText(`\uFEFF${text('nestjs.json')}`).title).toBe('NestJS Tasks');
  });

  it('rejects empty documents', () => {
    expect(() => parseSpecText('   ')).toThrow(SpecLoadError);
  });

  it('rejects HTML pages with a useful hint', () => {
    try {
      parseSpecText('<!doctype html><html><body>Docs</body></html>');
      throw new Error('Expected parseSpecText to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(SpecLoadError);
      expect((error as SpecLoadError).message).toMatch(/HTML page/);
      expect((error as SpecLoadError).hint).toMatch(/openapi\.json/);
    }
  });

  it('rejects unsupported versions', () => {
    expect(() =>
      parseSpecText(JSON.stringify({ openapi: '4.0.0', info: { title: 'x' }, paths: {} })),
    ).toThrow(/Unsupported OpenAPI version/);
    expect(() =>
      parseSpecText(JSON.stringify({ swagger: '1.2', info: { title: 'x' }, paths: {} })),
    ).toThrow(/Unsupported Swagger version/);
  });

  it('rejects unrelated JSON', () => {
    expect(() => parseSpecText('{"hello":"world"}')).toThrow(/does not look like an OpenAPI/);
  });

  it('accepts a paths-only document', () => {
    const spec = parseSpecText(
      JSON.stringify({ info: { title: 'Paths only', version: '1' }, paths: { '/x': { get: { responses: {} } } } }),
    );
    expect(spec.operations).toHaveLength(1);
  });

  it('normalizes bare hosts', () => {
    expect(normalizeUrlInput('localhost:8000')).toBe('http://localhost:8000');
    expect(normalizeUrlInput('127.0.0.1:8000/openapi.json')).toBe('http://127.0.0.1:8000/openapi.json');
    expect(normalizeUrlInput('https://example.com/spec.json')).toBe('https://example.com/spec.json');
  });

  it('labels pasted specs and keeps their text for reload', async () => {
    const loaded = await loadSpecFromText(text('flask.json'), 'flask.json');
    expect(loaded.source.kind).toBe('paste');
    expect(loaded.source.label).toBe('flask.json');
    expect(loaded.text).toContain('Flask Inventory');
  });
});
