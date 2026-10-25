/** Shared data model for the whole app. */

export type HttpMethod = 'get' | 'post' | 'put' | 'patch' | 'delete' | 'options' | 'head' | 'trace';
export type ParameterLocation = 'path' | 'query' | 'header' | 'cookie';

/** A pragmatic subset of JSON Schema used by OpenAPI 2/3.1 documents. */
export interface JsonSchema {
  $ref?: string;
  type?: string | string[];
  format?: string;
  title?: string;
  description?: string;
  default?: unknown;
  example?: unknown;
  examples?: unknown[];
  enum?: unknown[];
  const?: unknown;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema | JsonSchema[];
  additionalProperties?: boolean | JsonSchema;
  allOf?: JsonSchema[];
  oneOf?: JsonSchema[];
  anyOf?: JsonSchema[];
  not?: JsonSchema;
  nullable?: boolean;
  readOnly?: boolean;
  writeOnly?: boolean;
  deprecated?: boolean;
  minimum?: number;
  maximum?: number;
  exclusiveMinimum?: number | boolean;
  exclusiveMaximum?: number | boolean;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  minItems?: number;
  maxItems?: number;
  uniqueItems?: boolean;
  minProperties?: number;
  maxProperties?: number;
  multipleOf?: number;
  contentMediaType?: string;
  'x-circular'?: string;
  [key: string]: unknown;
}

export interface ApiExample {
  value?: unknown;
  summary?: string;
  description?: string;
  externalValue?: string;
}

export interface MediaType {
  schema?: JsonSchema;
  example?: unknown;
  examples?: Record<string, ApiExample | unknown>;
  encoding?: Record<string, unknown>;
}

export interface ApiRequestBody {
  description?: string;
  required?: boolean;
  content: Record<string, MediaType>;
}

export interface ApiResponseDef {
  status: string;
  description: string;
  content?: Record<string, MediaType>;
  headers?: Record<string, { description?: string; schema?: JsonSchema }>;
  links?: Record<string, unknown>;
}

export interface ApiParameter {
  /** Stable key: `in:name` because the same name can exist in two locations. */
  key: string;
  name: string;
  in: ParameterLocation;
  description?: string;
  required: boolean;
  deprecated?: boolean;
  schema: JsonSchema;
  example?: unknown;
  examples?: Record<string, unknown>;
  style?: string;
  explode?: boolean;
}

export interface SecurityRequirement {
  [schemeName: string]: string[];
}

export interface OAuthFlow {
  authorizationUrl?: string;
  tokenUrl?: string;
  refreshUrl?: string;
  scopes?: Record<string, string>;
}

export interface SecurityScheme {
  name: string;
  type: string;
  description?: string;
  scheme?: string;
  bearerFormat?: string;
  in?: 'header' | 'query' | 'cookie';
  paramName?: string;
  flows?: Record<string, OAuthFlow>;
  openIdConnectUrl?: string;
}

export interface Server {
  url: string;
  description?: string;
  variables?: Record<string, { default?: string; enum?: string[]; description?: string }>;
}

export interface ApiOperation {
  key: string;
  method: HttpMethod;
  path: string;
  summary: string;
  description?: string;
  operationId?: string;
  tags: string[];
  deprecated: boolean;
  parameters: ApiParameter[];
  requestBody?: ApiRequestBody;
  responses: ApiResponseDef[];
  security?: SecurityRequirement[];
  servers?: Server[];
  externalDocs?: { url?: string; description?: string };
  raw?: unknown;
}

export interface ApiTag {
  name: string;
  description?: string;
  operations: ApiOperation[];
}

export interface ParsedSpec {
  title: string;
  version: string;
  description?: string;
  termsOfService?: string;
  openapiVersion: string;
  isSwagger2: boolean;
  servers: Server[];
  tags: ApiTag[];
  operations: ApiOperation[];
  schemas: Record<string, JsonSchema>;
  securitySchemes: Record<string, SecurityScheme>;
  security?: SecurityRequirement[];
  externalDocs?: { url?: string; description?: string };
  raw: Record<string, unknown>;
}

export interface SpecSource {
  kind: 'url' | 'file' | 'paste';
  /** URL for URL sources; a display label for files/paste. */
  value: string;
  label: string;
  /** Full source text, for file/paste sources. */
  text?: string;
  /** Resolved URL when the source is remote (used to resolve relative servers). */
  url?: string;
}

export interface RecentSpec {
  url: string;
  title: string;
  version: string;
  loadedAt: string;
}

/* ------------------------------- HTTP ------------------------------- */

export interface KeyValue {
  id: string;
  key: string;
  value: string;
  enabled: boolean;
}

export type BodyMode = 'none' | 'json' | 'text' | 'form';

export interface RequestDraft {
  method: HttpMethod;
  url: string;
  params: KeyValue[];
  headers: KeyValue[];
  body: string;
  bodyMode: BodyMode;
  contentType: string;
}

export interface HttpResponseResult {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  data: unknown;
  rawText: string;
  latencyMs: number;
  sizeBytes: number;
  timestamp: string;
  finalUrl?: string;
  contentType?: string;
}

export interface RequestError {
  kind: 'cors' | 'network' | 'timeout' | 'proxy';
  message: string;
  detail?: string;
}

export type Credential =
  | { type: 'bearer'; token: string }
  | { type: 'basic'; username: string; password: string }
  | { type: 'apiKey'; value: string }
  | { type: 'oauth2'; accessToken: string; tokenType?: string; scopes?: string[] }
  | { type: 'openIdConnect'; accessToken: string };

export interface HistoryEntry {
  id: string;
  timestamp: string;
  method: string;
  url: string;
  status: number;
  statusText: string;
  latencyMs: number;
  sizeBytes: number;
  requestHeaders: Record<string, string>;
  requestBodyText?: string;
  responsePreview?: string;
  specTitle?: string;
}

export type Theme = 'light' | 'dark' | 'system';

export interface CodeRequest {
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: string;
}
