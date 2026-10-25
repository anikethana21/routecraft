import type { JsonSchema, SecurityScheme, Server } from '../../types';

export type RawObject = Record<string, any>;

export const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete', 'options', 'head', 'trace'] as const;

const MAX_DEPTH = 32;

/**
 * Resolves local JSON pointers (`#/components/schemas/Pet`) against a document.
 * Circular references are replaced with a small marker instead of recursing
 * forever, which keeps recursive models and rendering safe.
 */
export class RefResolver {
  private readonly root: RawObject;
  private readonly refCache = new Map<string, unknown>();

  constructor(root: RawObject) {
    this.root = root;
  }

  resolvePointer(ref: string): unknown {
    if (!ref.startsWith('#/')) return undefined;
    if (this.refCache.has(ref)) return this.refCache.get(ref);
    const parts = ref
      .slice(2)
      .split('/')
      .map((part) => decodeURIComponent(part).replace(/~1/g, '/').replace(/~0/g, '~'));
    let current: any = this.root;
    for (const part of parts) {
      if (current === null || typeof current !== 'object') return undefined;
      current = current[part];
    }
    this.refCache.set(ref, current);
    return current;
  }

  deref<T = any>(value: T, stack: Set<string> = new Set(), depth = 0): T {
    if (depth > MAX_DEPTH) {
      return { type: 'object', description: 'Nested schema truncated' } as unknown as T;
    }
    if (value === null || value === undefined || typeof value !== 'object') return value;
    if (Array.isArray(value)) {
      return value.map((item) => this.deref(item, stack, depth + 1)) as unknown as T;
    }
    const obj = value as RawObject;

    if (typeof obj.$ref === 'string') {
      const ref = obj.$ref;
      if (stack.has(ref)) {
        return {
          type: 'object',
          title: ref.split('/').pop(),
          description: 'Circular reference',
          'x-circular': ref,
        } as unknown as T;
      }
      const target = this.resolvePointer(ref);
      if (target === undefined) {
        return { ...obj, description: `Unresolved reference: ${ref}` } as unknown as T;
      }
      const nextStack = new Set(stack);
      nextStack.add(ref);
      const resolved = this.deref(target, nextStack, depth + 1) as RawObject;
      if (resolved && typeof resolved === 'object' && !Array.isArray(resolved)) {
        const siblings = Object.fromEntries(Object.entries(obj).filter(([key]) => key !== '$ref'));
        if (Object.keys(siblings).length === 0) return resolved as unknown as T;
        return { ...resolved, ...this.deref(siblings, nextStack, depth + 1) } as unknown as T;
      }
      return resolved as unknown as T;
    }

    const result: RawObject = Array.isArray(obj) ? [] : {};
    for (const [key, item] of Object.entries(obj)) {
      result[key] = this.deref(item, stack, depth + 1);
    }
    return result as unknown as T;
  }
}

function swaggerSchema(input: RawObject): JsonSchema {
  if (!input) return {};
  const schema: JsonSchema = {};
  const copyKeys = [
    '$ref',
    'type',
    'format',
    'description',
    'title',
    'default',
    'enum',
    'minimum',
    'maximum',
    'exclusiveMinimum',
    'exclusiveMaximum',
    'minLength',
    'maxLength',
    'pattern',
    'minItems',
    'maxItems',
    'uniqueItems',
    'multipleOf',
    'readOnly',
    'example',
  ];
  for (const key of copyKeys) {
    if (input[key] !== undefined) (schema as RawObject)[key] = input[key];
  }
  if (input.type === 'file') {
    schema.type = 'string';
    schema.format = 'binary';
  }
  if (input.items) {
    schema.items = Array.isArray(input.items) ? input.items.map(swaggerSchema) : swaggerSchema(input.items);
  }
  if (input.properties) {
    schema.properties = Object.fromEntries(
      Object.entries(input.properties).map(([key, value]) => [key, swaggerSchema(value as RawObject)]),
    );
    if (Array.isArray(input.required)) schema.required = [...input.required];
  }
  if (input.additionalProperties !== undefined) {
    schema.additionalProperties =
      typeof input.additionalProperties === 'object'
        ? swaggerSchema(input.additionalProperties)
        : input.additionalProperties;
  }
  if (input.allOf) schema.allOf = input.allOf.map(swaggerSchema);
  if (input.oneOf) schema.oneOf = input.oneOf.map(swaggerSchema);
  if (input.anyOf) schema.anyOf = input.anyOf.map(swaggerSchema);
  return schema;
}

function swaggerSecurityScheme(name: string, input: RawObject): SecurityScheme {
  if (!input) return { name, type: 'http' };
  if (input.type === 'basic') {
    return { name, type: 'http', scheme: 'basic', description: input.description };
  }
  if (input.type === 'apiKey') {
    return {
      name,
      type: 'apiKey',
      paramName: input.name,
      in: input.in,
      description: input.description,
    };
  }
  if (input.type === 'oauth2') {
    const flows: Record<string, any> = {};
    if (input.flow === 'implicit') {
      flows.implicit = { authorizationUrl: input.authorizationUrl, scopes: input.scopes || {} };
    } else if (input.flow === 'password') {
      flows.password = { tokenUrl: input.tokenUrl, scopes: input.scopes || {} };
    } else if (input.flow === 'application') {
      flows.clientCredentials = { tokenUrl: input.tokenUrl, scopes: input.scopes || {} };
    } else if (input.flow === 'accessCode') {
      flows.authorizationCode = {
        authorizationUrl: input.authorizationUrl,
        tokenUrl: input.tokenUrl,
        scopes: input.scopes || {},
      };
    }
    return { name, type: 'oauth2', flows, description: input.description };
  }
  return { name, type: input.type || 'http', description: input.description };
}

function swaggerServers(raw: RawObject): Server[] {
  const host = raw.host;
  const basePath = raw.basePath || '';
  const schemes: string[] = Array.isArray(raw.schemes) && raw.schemes.length ? raw.schemes : ['http'];
  if (!host) return basePath ? [{ url: basePath }] : [];
  return schemes.map((scheme) => ({
    url: `${scheme}://${host}${basePath}`,
    description: scheme === 'https' ? 'HTTPS' : undefined,
  }));
}

function convertSwaggerParameter(resolver: RefResolver, input: RawObject): RawObject {
  const param = input.$ref ? resolver.deref(input) : input;
  if (!param || typeof param !== 'object') return input;
  if (param.in === 'body') {
    return {
      name: param.name || 'body',
      in: 'body',
      description: param.description,
      required: param.required,
      schema: swaggerSchema(param.schema || {}),
      example: param['x-example'] ?? param.example,
    };
  }
  const schema = swaggerSchema(param);
  return {
    name: param.name,
    in: param.in,
    description: param.description,
    required: param.required ?? param.in === 'path',
    allowEmptyValue: param.allowEmptyValue,
    deprecated: param.deprecated,
    style: param.collectionFormat === 'csv' ? 'form' : undefined,
    explode: param.collectionFormat === 'multi' ? true : undefined,
    schema,
    example: param['x-example'] ?? param.example,
  };
}

function convertSwaggerOperation(
  resolver: RefResolver,
  raw: RawObject,
  pathItem: RawObject,
  root: RawObject,
): RawObject {
  const op = raw;
  const rawParams = [...(pathItem.parameters || []), ...(op.parameters || [])].map((p: RawObject) =>
    convertSwaggerParameter(resolver, p),
  );

  const bodyParam = rawParams.find((p) => p.in === 'body');
  const formParams = rawParams.filter((p) => p.in === 'formData');
  const normalParams = rawParams.filter((p) => p.in !== 'body' && p.in !== 'formData');

  const consumes: string[] =
    (op.consumes && op.consumes.length ? op.consumes : root.consumes) || ['application/json'];
  const produces: string[] =
    (op.produces && op.produces.length ? op.produces : root.produces) || ['application/json'];

  let requestBody: RawObject | undefined;
  if (bodyParam) {
    const content: RawObject = {};
    for (const media of consumes) content[media] = { schema: bodyParam.schema };
    requestBody = { description: bodyParam.description, required: bodyParam.required, content };
  } else if (formParams.length > 0) {
    const properties: Record<string, JsonSchema> = {};
    const required: string[] = [];
    for (const param of formParams) {
      properties[param.name] = {
        ...param.schema,
        description: param.description,
      };
      if (param.required) required.push(param.name);
    }
    const isMultipart = formParams.some((p) => p.type === 'file') || consumes.includes('multipart/form-data');
    const media = isMultipart ? 'multipart/form-data' : 'application/x-www-form-urlencoded';
    requestBody = {
      required: required.length > 0,
      content: { [media]: { schema: { type: 'object', properties, required } } },
    };
  }

  const responses: RawObject = {};
  for (const [status, response] of Object.entries(op.responses || {})) {
    if (status.startsWith('x-')) continue;
    const res = (response as RawObject).$ref ? (resolver.deref(response as RawObject) as RawObject) : (response as RawObject);
    const content: RawObject = {};
    if (res?.schema) {
      for (const media of produces) content[media] = { schema: swaggerSchema(res.schema) };
    }
    const headers: RawObject = {};
    for (const [name, header] of Object.entries(res?.headers || {})) {
      headers[name] = {
        description: (header as RawObject).description,
        schema: swaggerSchema(header as RawObject),
      };
    }
    responses[status] = {
      description: res?.description || '',
      content: Object.keys(content).length ? content : undefined,
      headers: Object.keys(headers).length ? headers : undefined,
      schema: res?.schema, // keep for the universal response normalizer
    };
  }

  return {
    tags: op.tags,
    summary: op.summary,
    description: op.description,
    operationId: op.operationId,
    deprecated: op.deprecated,
    security: op.security,
    parameters: normalParams,
    requestBody,
    responses,
    externalDocs: op.externalDocs,
    'x-consumes': consumes,
  };
}

/**
 * Converts Swagger 2.0 into an OpenAPI-3-like shape. The original `definitions`,
 * `parameters`, and `responses` trees are retained so `$ref` pointers keep working.
 */
export function normalizeDocument(raw: RawObject): { doc: RawObject; isSwagger2: boolean } {
  const isSwagger2 = Boolean(raw.swagger) && !raw.openapi;
  if (!isSwagger2) return { doc: raw, isSwagger2: false };

  const resolver = new RefResolver(raw);
  const paths: RawObject = {};
  for (const [path, pathItem] of Object.entries(raw.paths || {})) {
    if (!pathItem || typeof pathItem !== 'object') continue;
    const source = pathItem as RawObject;
    const converted: RawObject = {
      parameters: (source.parameters || []).map((p: RawObject) => convertSwaggerParameter(resolver, p)),
    };
    for (const method of HTTP_METHODS) {
      if (source[method]) {
        converted[method] = convertSwaggerOperation(resolver, source[method], source, raw);
      }
    }
    paths[path] = converted;
  }

  const securitySchemes: Record<string, SecurityScheme> = {};
  for (const [name, scheme] of Object.entries(raw.securityDefinitions || {})) {
    securitySchemes[name] = swaggerSecurityScheme(name, scheme as RawObject);
  }

  const doc: RawObject = {
    ...raw,
    openapi: '3.0.3',
    paths,
    servers: swaggerServers(raw),
    components: {
      schemas: raw.definitions || {},
      securitySchemes,
    },
    // Keep these so `#/definitions/X`, `#/parameters/X`, `#/responses/X` refs resolve.
    definitions: raw.definitions,
    parameters: raw.parameters,
    responses: raw.responses,
    securityDefinitions: raw.securityDefinitions,
  };
  return { doc, isSwagger2: true };
}

export function normalizeParameter(input: RawObject, fallbackIn = 'query'): RawObject {
  if (!input) return input;
  if (input.in === 'body') return input;
  let schema: JsonSchema = input.schema || {};
  if ((!input.schema || Object.keys(input.schema).length === 0) && input.content) {
    const firstMedia = Object.values(input.content)[0] as RawObject | undefined;
    schema = firstMedia?.schema || {};
  }
  if (!input.schema && !input.content) {
    const inline: RawObject = {};
    for (const key of ['type', 'format', 'items', 'enum', 'default', 'minimum', 'maximum', 'pattern', 'minLength', 'maxLength']) {
      if (input[key] !== undefined) inline[key] = input[key];
    }
    schema = inline as JsonSchema;
  }
  return {
    name: input.name,
    in: input.in || fallbackIn,
    description: input.description,
    required: input.required ?? (input.in || fallbackIn) === 'path',
    deprecated: input.deprecated,
    allowEmptyValue: input.allowEmptyValue,
    style: input.style,
    explode: input.explode,
    schema,
    example: input.example ?? schema.example,
    examples: input.examples,
  };
}

export function normalizeServers(input: unknown): Server[] {
  if (!Array.isArray(input)) return [];
  return input
    .filter((server) => server && typeof server === 'object' && typeof (server as RawObject).url === 'string')
    .map((server) => {
      const item = server as RawObject;
      return {
        url: item.url,
        description: item.description,
        variables: item.variables,
      } as Server;
    });
}

export function normalizeSecuritySchemes(input: unknown): Record<string, SecurityScheme> {
  const result: Record<string, SecurityScheme> = {};
  if (!input || typeof input !== 'object') return result;
  for (const [name, raw] of Object.entries(input as RawObject)) {
    if (!raw || typeof raw !== 'object') continue;
    const item = raw as RawObject;
    const scheme: SecurityScheme = {
      name,
      type: item.type || 'http',
      description: item.description,
      scheme: item.scheme,
      bearerFormat: item.bearerFormat,
      in: item.in,
      paramName: item.paramName || item.name,
      flows: item.flows,
      openIdConnectUrl: item.openIdConnectUrl,
    };
    result[name] = scheme;
  }
  return result;
}

export function resolveServerUrl(serverUrl: string, sourceUrl?: string): string {
  const value = (serverUrl || '').trim();
  if (!value) return sourceUrl ? safeOrigin(sourceUrl) : '';
  if (/^https?:\/\//i.test(value)) return value.replace(/\/+$/, '');
  if (!sourceUrl) return value;
  try {
    return new URL(value, sourceUrl).toString().replace(/\/+$/, '');
  } catch {
    return value;
  }
}

export function safeOrigin(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return '';
  }
}

export function substituteServerVariables(server: Server): string {
  return server.url.replace(/\{([^}]+)\}/g, (match: string, name: string) => {
    const variable = server.variables?.[name];
    if (variable?.default !== undefined) return String(variable.default);
    if (variable?.enum?.length) return String(variable.enum[0]);
    return match;
  });
}

export function sortStatusCodes(statuses: string[]): string[] {
  return [...statuses].sort((a, b) => {
    if (a.toLowerCase() === 'default') return 1;
    if (b.toLowerCase() === 'default') return -1;
    const aNum = parseInt(a, 10);
    const bNum = parseInt(b, 10);
    if (!Number.isNaN(aNum) && !Number.isNaN(bNum)) return aNum - bNum;
    return a.localeCompare(b);
  });
}
