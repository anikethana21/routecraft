import type {
  ApiOperation,
  ApiParameter,
  ApiRequestBody,
  ApiResponseDef,
  ApiTag,
  HttpMethod,
  JsonSchema,
  MediaType,
  ParsedSpec,
  SecurityRequirement,
  Server,
} from '../../types';
import {
  HTTP_METHODS,
  normalizeDocument,
  normalizeParameter,
  normalizeSecuritySchemes,
  normalizeServers,
  RefResolver,
  sortStatusCodes,
  type RawObject,
} from './normalize';

/** Resolve one wrapper object (`$ref`) without expanding nested schemas. */
function resolveWrapper(resolver: RefResolver, value: RawObject | undefined, stack = new Set<string>()): RawObject | undefined {
  if (!value || typeof value !== 'object') return value;
  if (typeof value.$ref !== 'string') return value;
  const ref = value.$ref;
  if (stack.has(ref)) return value;
  stack.add(ref);
  const target = resolver.resolvePointer(ref) as RawObject | undefined;
  if (!target) return value;
  const merged = { ...target, ...Object.fromEntries(Object.entries(value).filter(([key]) => key !== '$ref')) };
  if (typeof merged.$ref === 'string') return resolveWrapper(resolver, merged, stack);
  return merged;
}

function normalizeMedia(content: RawObject | undefined): Record<string, MediaType> | undefined {
  if (!content || typeof content !== 'object') return undefined;
  const result: Record<string, MediaType> = {};
  for (const [mediaType, media] of Object.entries(content)) {
    if (!media || typeof media !== 'object') continue;
    const item = media as RawObject;
    result[mediaType] = {
      schema: item.schema,
      example: item.example,
      examples: item.examples,
      encoding: item.encoding,
    };
  }
  return Object.keys(result).length ? result : undefined;
}

function normalizeRequestBody(resolver: RefResolver, input: RawObject | undefined): ApiRequestBody | undefined {
  const body = resolveWrapper(resolver, input);
  if (!body) return undefined;
  const content = normalizeMedia(body.content) ||
    (body.schema ? { 'application/json': { schema: body.schema as JsonSchema } } : undefined);
  if (!content) return undefined;
  return {
    description: body.description,
    required: Boolean(body.required),
    content,
  };
}

function normalizeResponses(resolver: RefResolver, input: RawObject | undefined): ApiResponseDef[] {
  if (!input || typeof input !== 'object') return [];
  const result: ApiResponseDef[] = [];
  for (const [status, rawResponse] of Object.entries(input)) {
    if (status.startsWith('x-')) continue;
    const response = resolveWrapper(resolver, rawResponse as RawObject) || {};
    const headers: Record<string, { description?: string; schema?: JsonSchema }> = {};
    for (const [name, rawHeader] of Object.entries(response.headers || {})) {
      const header = (rawHeader || {}) as RawObject;
      headers[name] = {
        description: header.description,
        schema: header.schema || {
          type: header.type,
          format: header.format,
          description: header.description,
          items: header.items,
          enum: header.enum,
          default: header.default,
        },
      };
    }
    const content = normalizeMedia(response.content) ||
      (response.schema ? { 'application/json': { schema: response.schema as JsonSchema } } : undefined);
    result.push({
      status,
      description: response.description || '',
      content,
      headers: Object.keys(headers).length ? headers : undefined,
      links: response.links,
    });
  }
  const byStatus = new Map(result.map((item) => [item.status, item]));
  return sortStatusCodes([...byStatus.keys()]).map((status) => byStatus.get(status)!);
}

function normalizeOperationParameters(
  resolver: RefResolver,
  pathParams: RawObject[],
  operationParams: RawObject[],
): ApiParameter[] {
  const merged = new Map<string, ApiParameter>();
  for (const raw of [...pathParams, ...operationParams]) {
    const param = resolveWrapper(resolver, raw);
    if (!param || typeof param !== 'object') continue;
    const normalized = normalizeParameter(param) as RawObject;
    if (!normalized.name || !normalized.in) continue;
    const key = `${normalized.in}:${normalized.name}`;
    merged.set(key, {
      key,
      name: normalized.name,
      in: normalized.in,
      description: normalized.description,
      required: Boolean(normalized.required),
      deprecated: normalized.deprecated,
      schema: (normalized.schema || {}) as JsonSchema,
      example: normalized.example,
      examples: normalized.examples,
      style: normalized.style,
      explode: normalized.explode,
    });
  }
  return [...merged.values()];
}

function operationSecurity(raw: RawObject, rootSecurity: SecurityRequirement[] | undefined): SecurityRequirement[] | undefined {
  if (Array.isArray(raw.security)) return raw.security as SecurityRequirement[];
  return rootSecurity;
}

function normalizeOperationServers(input: unknown): Server[] | undefined {
  const servers = normalizeServers(input);
  return servers.length ? servers : undefined;
}

/**
 * Parse a raw OpenAPI 2.0 / 3.0 / 3.1 document into the flat model used by the UI.
 */
export function parseSpec(raw: RawObject): ParsedSpec {
  const { doc, isSwagger2 } = normalizeDocument(raw);
  const resolver = new RefResolver(doc);
  const info = (doc.info || {}) as RawObject;
  const rootSecurity = Array.isArray(doc.security) ? (doc.security as SecurityRequirement[]) : undefined;
  const operations: ApiOperation[] = [];

  for (const [path, rawPathItem] of Object.entries(doc.paths || {})) {
    if (!rawPathItem || typeof rawPathItem !== 'object' || path.startsWith('x-')) continue;
    const pathItem = (resolveWrapper(resolver, rawPathItem as RawObject) || {}) as RawObject;
    const pathParams = Array.isArray(pathItem.parameters) ? pathItem.parameters : [];

    for (const method of HTTP_METHODS) {
      const rawOperation = pathItem[method] as RawObject | undefined;
      if (!rawOperation || typeof rawOperation !== 'object') continue;

      const tags = Array.isArray(rawOperation.tags) && rawOperation.tags.length
        ? [...new Set(rawOperation.tags.map(String))]
        : ['default'];

      const operation: ApiOperation = {
        key: `${method}:${path}`,
        method: method as HttpMethod,
        path,
        summary: String(rawOperation.summary || rawOperation.operationId || `${method.toUpperCase()} ${path}`).trim(),
        description: rawOperation.description ? String(rawOperation.description) : undefined,
        operationId: rawOperation.operationId,
        tags,
        deprecated: Boolean(rawOperation.deprecated),
        parameters: normalizeOperationParameters(
          resolver,
          pathParams,
          Array.isArray(rawOperation.parameters) ? rawOperation.parameters : [],
        ),
        requestBody: normalizeRequestBody(resolver, rawOperation.requestBody),
        responses: normalizeResponses(resolver, rawOperation.responses),
        security: operationSecurity(rawOperation, rootSecurity),
        servers: normalizeOperationServers(rawOperation.servers),
        externalDocs: rawOperation.externalDocs,
        raw: rawOperation,
      };
      operations.push(operation);
    }
  }

  // Tag order: declared tags first, then encounter order. Empty tags are hidden.
  const byTag = new Map<string, ApiOperation[]>();
  for (const operation of operations) {
    for (const tag of operation.tags) {
      const list = byTag.get(tag) || [];
      list.push(operation);
      byTag.set(tag, list);
    }
  }
  const declared = Array.isArray(doc.tags) ? (doc.tags as RawObject[]) : [];
  const declaredNames = declared.map((tag) => String(tag.name)).filter(Boolean);
  const orderedNames = [
    ...declaredNames.filter((name) => byTag.has(name)),
    ...[...byTag.keys()].filter((name) => !declaredNames.includes(name)),
  ];
  const descriptionByName = new Map(declared.map((tag) => [String(tag.name), tag.description]));
  const tags: ApiTag[] = orderedNames.map((name) => ({
    name,
    description: descriptionByName.get(name),
    operations: byTag.get(name) || [],
  }));

  const schemas = ((doc.components && doc.components.schemas) || doc.definitions || {}) as Record<string, JsonSchema>;

  return {
    title: String(info.title || 'Untitled API'),
    version: info.version !== undefined ? String(info.version) : '',
    description: info.description ? String(info.description) : undefined,
    termsOfService: info.termsOfService,
    openapiVersion: String(doc.openapi || doc.swagger || 'OpenAPI'),
    isSwagger2,
    servers: normalizeServers(doc.servers),
    tags,
    operations,
    schemas,
    securitySchemes: normalizeSecuritySchemes(doc.components?.securitySchemes),
    security: rootSecurity,
    externalDocs: doc.externalDocs,
    raw,
  };
}

/** Resolver for schemas stored on a parsed spec. */
export function resolverFor(spec: ParsedSpec): RefResolver {
  return new RefResolver(spec.raw as RawObject);
}

export function operationsCount(spec: ParsedSpec | null): number {
  return spec?.operations.length || 0;
}

export function specDisplayHost(sourceUrl: string): string {
  try {
    const url = new URL(sourceUrl);
    return url.host + (url.pathname === '/' ? '' : url.pathname);
  } catch {
    return sourceUrl;
  }
}
