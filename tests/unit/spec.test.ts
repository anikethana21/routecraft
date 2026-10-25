import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseSpecText } from '../../src/lib/spec/loader';
import { parseSpec, resolverFor } from '../../src/lib/spec/parse';
import {
  flattenSchema,
  sampleFromSchema,
  schemaKind,
  schemaTypeLabel,
} from '../../src/lib/spec/schema';
import {
  resolveServerUrl,
  substituteServerVariables,
} from '../../src/lib/spec/normalize';

const fixtureDir = fileURLToPath(new URL('../api/fixtures/', import.meta.url));

function fixture(name: string) {
  return parseSpecText(readFileSync(fixtureDir + name, 'utf8'));
}

const FRAMEWORKS = [
  { file: 'fastapi.json', title: 'FastAPI Demo', operations: 6, tag: 'pets' },
  { file: 'express.yaml', title: 'Express Users API', operations: 4, tag: 'users' },
  { file: 'flask.json', title: 'Flask Inventory', operations: 3, tag: 'inventory' },
  { file: 'django.yaml', title: 'Django Shop API', operations: 2, tag: 'orders' },
  { file: 'nestjs.json', title: 'NestJS Tasks', operations: 3, tag: 'tasks' },
  { file: 'spring.json', title: 'Spring Pet Clinic', operations: 3, tag: 'owners' },
  { file: 'aspnet.json', title: 'ASP.NET Weather', operations: 2, tag: 'WeatherForecast' },
  { file: 'go.json', title: 'Go Orders API', operations: 4, tag: 'orders' },
];

describe('framework fixtures', () => {
  for (const framework of FRAMEWORKS) {
    it(`parses ${framework.file}`, () => {
      const spec = fixture(framework.file);
      expect(spec.title).toBe(framework.title);
      expect(spec.operations).toHaveLength(framework.operations);
      expect(spec.tags.some((tag) => tag.name === framework.tag)).toBe(true);
      expect(spec.operations.every((operation) => operation.path.startsWith('/'))).toBe(true);
      expect(spec.operations.every((operation) => operation.responses.length > 0)).toBe(true);
      expect(spec.servers.length).toBeGreaterThan(0);
      expect(spec.openapiVersion).toBeTruthy();
    });
  }

  it('keeps the OpenAPI version and Swagger conversion flag', () => {
    expect(fixture('fastapi.json').openapiVersion).toBe('3.1.0');
    expect(fixture('fastapi.json').isSwagger2).toBe(false);
    expect(fixture('go.json').isSwagger2).toBe(true);
    expect(fixture('go.json').openapiVersion).toBe('3.0.3');
  });
});

describe('FastAPI fixture', () => {
  const spec = fixture('fastapi.json');

  it('groups operations by declared tags', () => {
    expect(spec.tags.map((tag) => tag.name)).toEqual(['pets', 'auth']);
    expect(spec.tags[0].operations.map((operation) => operation.key)).toEqual([
      'get:/pets',
      'post:/pets',
      'get:/pets/{petId}',
      'delete:/pets/{petId}',
    ]);
  });

  it('normalizes path, query, header and cookie parameters', () => {
    const getPet = spec.operations.find((operation) => operation.key === 'get:/pets/{petId}')!;
    expect(getPet.parameters.map((parameter) => `${parameter.in}:${parameter.name}`)).toEqual([
      'path:petId',
      'cookie:session',
    ]);
    expect(getPet.parameters[0].required).toBe(true);

    const listPets = spec.operations.find((operation) => operation.key === 'get:/pets')!;
    expect(listPets.parameters).toHaveLength(3);
    expect(listPets.parameters.find((parameter) => parameter.name === 'status')?.schema.enum).toEqual([
      'available',
      'pending',
      'sold',
    ]);
  });

  it('parses a request body with example and a bearer scheme', () => {
    const createPet = spec.operations.find((operation) => operation.key === 'post:/pets')!;
    expect(createPet.requestBody?.required).toBe(true);
    expect(createPet.requestBody?.content['application/json'].schema?.$ref).toBe(
      '#/components/schemas/NewPet',
    );
    expect(createPet.requestBody?.content['application/json'].example).toEqual({
      name: 'Rex',
      status: 'available',
      tag: 'dog',
    });
    expect(createPet.security).toEqual([{ bearerAuth: [] }]);
    expect(spec.securitySchemes.bearerAuth.scheme).toBe('bearer');
  });

  it('renders rich response definitions and headers', () => {
    const listPets = spec.operations.find((operation) => operation.key === 'get:/pets')!;
    expect(listPets.responses.map((response) => response.status)).toEqual(['200', '422']);
    expect(listPets.responses[0].headers?.['X-Total-Count']).toBeTruthy();
  });
});

describe('Swagger 2 conversion', () => {
  const spec = fixture('go.json');

  it('builds servers from host, basePath and schemes', () => {
    expect(spec.servers[0].url).toBe('http://127.0.0.1:4010/api/v1');
  });

  it('converts body parameters into request bodies', () => {
    const createOrder = spec.operations.find((operation) => operation.key === 'post:/orders')!;
    expect(Object.keys(createOrder.requestBody?.content || {})).toEqual(['application/json']);
    expect(createOrder.requestBody?.content['application/json'].schema?.$ref).toBe(
      '#/definitions/NewOrder',
    );
    expect(createOrder.parameters).toHaveLength(0);
  });

  it('converts formData parameters into multipart content', () => {
    const attach = spec.operations.find((operation) => operation.key === 'post:/orders/{orderId}/attachments')!;
    const media = attach.requestBody?.content['multipart/form-data'];
    expect(media?.schema?.properties?.file?.format).toBe('binary');
    expect(media?.schema?.properties?.note?.type).toBe('string');
    expect(media?.schema?.required).toEqual(['file']);
  });

  it('keeps security definitions and resolves Swagger refs', () => {
    expect(spec.securitySchemes.api_key).toMatchObject({
      type: 'apiKey',
      in: 'header',
      paramName: 'X-API-Key',
    });
    const listOrders = spec.operations.find((operation) => operation.key === 'get:/orders')!;
    expect(spec.schemas.Order.properties?.id.example).toBe('ord_123');
    const responseSchema = listOrders.responses[0].content?.['application/json'].schema;
    const items = Array.isArray(responseSchema?.items) ? responseSchema.items[0] : responseSchema?.items;
    expect(items?.$ref).toBe('#/definitions/Order');
  });
});

describe('schemas and examples', () => {
  const spec = fixture('fastapi.json');
  const resolver = resolverFor(spec);

  it('samples a model with a circular reference without recursing forever', () => {
    const sample = sampleFromSchema({ $ref: '#/components/schemas/Pet' }, resolver);
    expect(sample).toMatchObject({ name: 'Rex', status: 'available' });
    expect(JSON.stringify(sample).length).toBeLessThan(4000);
  });

  it('labels nullable and union types', () => {
    const owner = spec.schemas.Owner;
    const pet = spec.schemas.Pet;
    expect(schemaTypeLabel(pet.properties?.tag)).toBe('string | null');
    expect(schemaKind(owner)).toBe('object');
    expect(schemaTypeLabel({ type: ['string', 'null'] })).toBe('string | null');
  });

  it('flattens allOf models (Spring style)', () => {
    const spring = fixture('spring.json');
    const springResolver = resolverFor(spring);
    const flattened = flattenSchema(spring.schemas.Owner, springResolver);
    expect(flattened.properties).toHaveProperty('firstName');
    expect(flattened.properties).toHaveProperty('lastName');
    expect(flattened.properties).toHaveProperty('id');
    expect(flattened.properties).toHaveProperty('pets');
    expect(flattened.required).toEqual(expect.arrayContaining(['firstName', 'lastName']));
  });

  it('resolves server variables before URL resolution', () => {
    const spring = fixture('spring.json');
    const server = substituteServerVariables(spring.servers[0]);
    expect(server).toBe('http://localhost:4010/api');
    expect(resolveServerUrl(server)).toBe('http://localhost:4010/api');
    expect(resolveServerUrl('/v1', 'http://localhost:8080/spec/openapi.json')).toBe(
      'http://localhost:8080/v1',
    );
  });

  it('handles recursive nodes in the edge fixture', () => {
    const edge = fixture('edge.json');
    const edgeResolver = resolverFor(edge);
    const node = sampleFromSchema({ $ref: '#/components/schemas/Node' }, edgeResolver);
    expect(node).toBeTypeOf('object');
    expect(JSON.stringify(node)).toContain('children');
  });
});

describe('raw parsing', () => {
  it('parses a document passed directly as an object', () => {
    const spec = parseSpec({
      openapi: '3.0.0',
      info: { title: 'Inline', version: '1' },
      paths: {
        '/ping': { get: { responses: { 200: { description: 'ok' } } } },
      },
    });
    expect(spec.title).toBe('Inline');
    expect(spec.operations[0].summary).toBe('GET /ping');
    expect(spec.operations[0].tags).toEqual(['default']);
  });

  it('does not invent requests for invalid paths', () => {
    const spec = parseSpec({
      swagger: '2.0',
      info: { title: 'Empty', version: '1' },
      paths: { '/x': { parameters: [] } },
    });
    expect(spec.operations).toHaveLength(0);
    expect(spec.tags).toHaveLength(0);
  });

  it('sorts responses numerically with default last', () => {
    const spec = parseSpec({
      openapi: '3.0.0',
      info: { title: 'Codes', version: '1' },
      paths: {
        '/x': {
          get: {
            responses: {
              default: { description: 'fallback' },
              404: { description: 'missing' },
              200: { description: 'ok' },
            },
          },
        },
      },
    });
    expect(spec.operations[0].responses.map((response) => response.status)).toEqual([
      '200',
      '404',
      'default',
    ]);
  });
});
