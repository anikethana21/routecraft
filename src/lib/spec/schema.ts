import type { JsonSchema, MediaType } from '../../types';
import type { RefResolver } from './normalize';

const MAX_SAMPLE_DEPTH = 10;

export function resolveSchemaRef(
  schema: JsonSchema | undefined,
  resolver: RefResolver,
  stack: Set<string> = new Set(),
): JsonSchema {
  if (!schema || typeof schema !== 'object') return {};
  if (typeof schema.$ref !== 'string') return schema;
  const ref = schema.$ref;
  if (stack.has(ref)) {
    return {
      ...schema,
      'x-circular': ref,
      description: schema.description || 'Circular reference',
    };
  }
  const target = resolver.resolvePointer(ref) as JsonSchema | undefined;
  if (!target) {
    return { ...schema, description: schema.description || `Unresolved reference: ${ref}` };
  }
  const nextStack = new Set(stack);
  nextStack.add(ref);
  const resolved = resolveSchemaRef(target, resolver, nextStack);
  const siblings = Object.fromEntries(Object.entries(schema).filter(([key]) => key !== '$ref'));
  return { ...resolved, ...siblings };
}

/** Merge allOf members into a single object schema for display and sampling. */
export function flattenSchema(
  schema: JsonSchema | undefined,
  resolver: RefResolver,
  stack: Set<string> = new Set(),
): JsonSchema {
  const resolved = resolveSchemaRef(schema, resolver, stack);
  if (!Array.isArray(resolved.allOf) || resolved.allOf.length === 0) return resolved;

  const merged: JsonSchema = { ...resolved };
  delete merged.allOf;
  const properties: Record<string, JsonSchema> = {};
  const required = new Set<string>();
  let type = resolved.type;

  for (const member of resolved.allOf) {
    const flat = flattenSchema(member, resolver, stack);
    if (flat.type) type = type || flat.type;
    if (flat.properties) Object.assign(properties, flat.properties);
    if (Array.isArray(flat.required)) flat.required.forEach((name) => required.add(name));
    if (flat.additionalProperties !== undefined && merged.additionalProperties === undefined) {
      merged.additionalProperties = flat.additionalProperties;
    }
    if (flat.description && !merged.description) merged.description = flat.description;
    if (flat.example !== undefined && merged.example === undefined) merged.example = flat.example;
    if (flat.enum && !merged.enum) merged.enum = flat.enum;
  }

  if (Object.keys(properties).length > 0) {
    merged.properties = { ...(resolved.properties || {}), ...properties };
    merged.type = type || 'object';
  }
  if (required.size > 0) {
    merged.required = [...new Set([...(resolved.required || []), ...required])];
  }
  return merged;
}

export function schemaKind(schema: JsonSchema | undefined): string {
  if (!schema) return 'any';
  const type = schema.type;
  if (Array.isArray(type)) {
    const real = type.filter((item) => item !== 'null');
    if (real.length === 1) return real[0];
    if (real.length === 0) return 'null';
    return real.join(' | ');
  }
  if (type) return String(type);
  if (schema.properties || schema.additionalProperties) return 'object';
  if (schema.items) return 'array';
  if (schema.oneOf?.length) return 'oneOf';
  if (schema.anyOf?.length) return 'anyOf';
  if (schema.allOf?.length) return 'allOf';
  if (schema.const !== undefined) return 'const';
  if (schema.enum) return 'enum';
  return 'any';
}

export function schemaTypeLabel(schema: JsonSchema | undefined): string {
  if (!schema) return 'any';
  const kind = schemaKind(schema);
  if (kind === 'array') {
    const items = Array.isArray(schema.items) ? schema.items[0] : schema.items;
    return `array<${items ? schemaTypeLabel(items) : 'any'}>`;
  }
  if (schema.format) return `${kind} (${schema.format})`;
  if (Array.isArray(schema.type) && schema.type.includes('null')) return `${kind} | null`;
  if (schema.nullable) return `${kind} | null`;
  return kind;
}

export function schemaCanHaveChildren(schema: JsonSchema | undefined): boolean {
  if (!schema) return false;
  return Boolean(
    schema.properties ||
      schema.additionalProperties ||
      schema.items ||
      schema.allOf ||
      schema.oneOf ||
      schema.anyOf,
  );
}

export function constraintList(schema: JsonSchema): string[] {
  const list: string[] = [];
  if (schema.minimum !== undefined) list.push(`min ${schema.minimum}`);
  if (schema.maximum !== undefined) list.push(`max ${schema.maximum}`);
  if (typeof schema.exclusiveMinimum === 'number') list.push(`> ${schema.exclusiveMinimum}`);
  if (typeof schema.exclusiveMaximum === 'number') list.push(`< ${schema.exclusiveMaximum}`);
  if (schema.minLength !== undefined) list.push(`minLength ${schema.minLength}`);
  if (schema.maxLength !== undefined) list.push(`maxLength ${schema.maxLength}`);
  if (schema.minItems !== undefined) list.push(`minItems ${schema.minItems}`);
  if (schema.maxItems !== undefined) list.push(`maxItems ${schema.maxItems}`);
  if (schema.uniqueItems) list.push('unique items');
  if (schema.pattern) list.push(`/${schema.pattern}/`);
  if (schema.multipleOf !== undefined) list.push(`multiple of ${schema.multipleOf}`);
  if (schema.const !== undefined) list.push(`= ${JSON.stringify(schema.const)}`);
  return list;
}

function stringSample(schema: JsonSchema): string {
  if (schema.format) {
    switch (schema.format) {
      case 'date':
        return '2024-01-01';
      case 'date-time':
        return '2024-01-01T00:00:00Z';
      case 'time':
        return '12:00:00Z';
      case 'email':
        return 'user@example.com';
      case 'uuid':
        return '3fa85f64-5717-4562-b3fc-2c963f66afa6';
      case 'uri':
      case 'url':
        return 'https://example.com';
      case 'hostname':
        return 'example.com';
      case 'ipv4':
        return '192.168.0.1';
      case 'ipv6':
        return '2001:db8::1';
      case 'byte':
      case 'binary':
        return 'string';
      default:
        return 'string';
    }
  }
  if (schema.pattern) return 'string';
  return 'string';
}

export interface SampleOptions {
  mode?: 'request' | 'response' | 'neutral';
}

/**
 * Build a realistic example value from a schema, the way Swagger UI does in
 * its "Example Value" tab.
 */
export function sampleFromSchema(
  schema: JsonSchema | undefined,
  resolver: RefResolver,
  options: SampleOptions = {},
  stack: Set<string> = new Set(),
  depth = 0,
): unknown {
  if (!schema || typeof schema !== 'object') return null;
  if (typeof schema.$ref === 'string') {
    if (stack.has(schema.$ref)) return { circular: schema.$ref };
    const next = new Set(stack);
    next.add(schema.$ref);
    return sampleFromSchema(resolveSchemaRef(schema, resolver), resolver, options, next, depth);
  }
  if (depth > MAX_SAMPLE_DEPTH) return null;

  if (schema.example !== undefined) return schema.example;
  if (schema.const !== undefined) return schema.const;
  if (Array.isArray(schema.examples) && schema.examples.length) return schema.examples[0];
  if (schema.default !== undefined) return schema.default;
  if (Array.isArray(schema.enum) && schema.enum.length) return schema.enum[0];

  if (schema.oneOf?.length) {
    const real = schema.oneOf.find((item) => schemaKind(item) !== 'null') || schema.oneOf[0];
    return sampleFromSchema(real, resolver, options, stack, depth + 1);
  }
  if (schema.anyOf?.length) {
    const real = schema.anyOf.find((item) => schemaKind(item) !== 'null') || schema.anyOf[0];
    return sampleFromSchema(real, resolver, options, stack, depth + 1);
  }
  if (schema.allOf?.length) {
    const flat = flattenSchema(schema, resolver);
    return sampleFromSchema(flat, resolver, options, stack, depth + 1);
  }

  const kind = schemaKind(schema);
  if (kind === 'object' || schema.properties) {
    const flat = flattenSchema(schema, resolver);
    const result: Record<string, unknown> = {};
    for (const [name, property] of Object.entries(flat.properties || {})) {
      if (options.mode === 'request' && property.readOnly) continue;
      if (options.mode === 'response' && property.writeOnly) continue;
      result[name] = sampleFromSchema(property, resolver, options, stack, depth + 1);
    }
    if (Object.keys(result).length === 0 && flat.additionalProperties) {
      const value =
        typeof flat.additionalProperties === 'object'
          ? sampleFromSchema(flat.additionalProperties, resolver, options, stack, depth + 1)
          : 'string';
      result.additionalProp1 = value;
    }
    return result;
  }

  if (kind === 'array') {
    const items = Array.isArray(schema.items) ? schema.items[0] : schema.items;
    if (items) return [sampleFromSchema(items, resolver, options, stack, depth + 1)];
    return [];
  }

  if (kind === 'string') return stringSample(schema);
  if (kind === 'integer') {
    if (typeof schema.minimum === 'number') return Math.ceil(schema.minimum);
    return 0;
  }
  if (kind === 'number') {
    if (typeof schema.minimum === 'number') return schema.minimum;
    return 0.0;
  }
  if (kind === 'boolean') return true;
  if (kind === 'null') return null;
  if (kind === 'any') return null;
  return null;
}

export function exampleFromMedia(
  media: MediaType | undefined,
  resolver: RefResolver,
  options: SampleOptions = {},
): unknown {
  if (!media) return null;
  if (media.example !== undefined) return media.example;
  if (media.examples && typeof media.examples === 'object') {
    const first = Object.values(media.examples)[0];
    if (first && typeof first === 'object' && 'value' in (first as Record<string, unknown>)) {
      return (first as { value: unknown }).value;
    }
    return first;
  }
  return sampleFromSchema(media.schema, resolver, options);
}

export function exampleToText(value: unknown): string {
  if (value === undefined) return '';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export function mediaTypesFor(requestBody: { content: Record<string, MediaType> } | undefined): string[] {
  if (!requestBody) return [];
  return Object.keys(requestBody.content);
}

export function preferredMediaType(content: Record<string, MediaType> | undefined, fallback = 'application/json'): string {
  if (!content) return fallback;
  const types = Object.keys(content);
  if (types.length === 0) return fallback;
  return (
    types.find((type) => type.includes('json')) ||
    types.find((type) => type.includes('x-www-form-urlencoded')) ||
    types[0]
  );
}

export function isJsonMediaType(mediaType: string): boolean {
  return /json/i.test(mediaType);
}

export function isFormMediaType(mediaType: string): boolean {
  return /x-www-form-urlencoded/i.test(mediaType);
}

export function isMultipartMediaType(mediaType: string): boolean {
  return /multipart\/form-data/i.test(mediaType);
}

export function isTextMediaType(mediaType: string): boolean {
  return /^text\//i.test(mediaType) || /xml|html|csv|yaml/i.test(mediaType);
}
