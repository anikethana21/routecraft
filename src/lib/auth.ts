import type { Credential, SecurityRequirement, SecurityScheme } from '../types';
import { executeRequest } from './transport';

export type CredentialMap = Record<string, Credential>;

export interface AuthTarget {
  headers: Record<string, string>;
  query: Record<string, string>;
  cookies: Record<string, string>;
}

export function hasCredential(credential: Credential | undefined): boolean {
  if (!credential) return false;
  if (credential.type === 'bearer') return Boolean(credential.token.trim());
  if (credential.type === 'basic') return Boolean(credential.username.trim());
  if (credential.type === 'apiKey') return Boolean(credential.value.trim());
  if (credential.type === 'oauth2' || credential.type === 'openIdConnect') {
    return Boolean(credential.accessToken.trim());
  }
  return false;
}

export function requirementNames(requirements: SecurityRequirement[] | undefined): string[] {
  if (!requirements) return [];
  return [...new Set(requirements.flatMap((requirement) => Object.keys(requirement)))];
}

/** True when at least one complete security requirement is satisfied. */
export function isAuthorized(
  requirements: SecurityRequirement[] | undefined,
  credentials: CredentialMap,
): boolean {
  if (!requirements || requirements.length === 0) return false;
  return requirements.some((requirement) => {
    const names = Object.keys(requirement);
    if (names.length === 0) return true;
    return names.every((name) => hasCredential(credentials[name]));
  });
}

function bearerValue(token: string, tokenType = 'Bearer'): string {
  const trimmed = token.trim();
  if (/^(bearer|basic|token)\s+/i.test(trimmed)) return trimmed;
  return `${tokenType} ${trimmed}`;
}

function basicValue(username: string, password: string): string {
  const raw = `${username}:${password}`;
  try {
    return `Basic ${btoa(unescape(encodeURIComponent(raw)))}`;
  } catch {
    return `Basic ${btoa(raw)}`;
  }
}

/**
 * Apply every configured credential referenced by the operation's security
 * requirements. This mirrors Swagger UI: authorization is global, and a lock
 * icon means the operation accepts one of the configured schemes.
 */
export function applyAuth(
  target: AuthTarget,
  requirements: SecurityRequirement[] | undefined,
  schemes: Record<string, SecurityScheme>,
  credentials: CredentialMap,
): string[] {
  if (!requirements || requirements.length === 0) return [];
  const applied: string[] = [];
  const seen = new Set<string>();

  for (const requirement of requirements) {
    for (const schemeName of Object.keys(requirement)) {
      if (seen.has(schemeName)) continue;
      seen.add(schemeName);
      const scheme = schemes[schemeName];
      const credential = credentials[schemeName];
      if (!scheme || !hasCredential(credential)) continue;

      if (scheme.type === 'apiKey') {
        const value = (credential as { value: string }).value;
        if (scheme.in === 'query') target.query[scheme.paramName || schemeName] = value;
        else if (scheme.in === 'cookie') target.cookies[scheme.paramName || schemeName] = value;
        else target.headers[scheme.paramName || schemeName] = value;
        applied.push(schemeName);
        continue;
      }

      if (scheme.type === 'http') {
        const httpScheme = (scheme.scheme || '').toLowerCase();
        if (httpScheme === 'bearer' && credential.type === 'bearer') {
          if (!target.headers.Authorization) target.headers.Authorization = bearerValue(credential.token);
          applied.push(schemeName);
        } else if (httpScheme === 'basic' && credential.type === 'basic') {
          if (!target.headers.Authorization) {
            target.headers.Authorization = basicValue(credential.username, credential.password);
          }
          applied.push(schemeName);
        }
        continue;
      }

      if (scheme.type === 'oauth2' && credential.type === 'oauth2') {
        if (!target.headers.Authorization) {
          target.headers.Authorization = bearerValue(credential.accessToken, credential.tokenType || 'Bearer');
        }
        applied.push(schemeName);
        continue;
      }
      if (scheme.type === 'openIdConnect' && credential.type === 'openIdConnect') {
        if (!target.headers.Authorization) target.headers.Authorization = bearerValue(credential.accessToken);
        applied.push(schemeName);
      }
    }
  }
  return applied;
}

export function schemeSummary(scheme: SecurityScheme): string {
  if (scheme.type === 'apiKey') {
    return `API key in ${scheme.in || 'header'}${scheme.paramName ? ` · ${scheme.paramName}` : ''}`;
  }
  if (scheme.type === 'http') return `HTTP ${scheme.scheme || 'auth'}${scheme.bearerFormat ? ` · ${scheme.bearerFormat}` : ''}`;
  if (scheme.type === 'oauth2') {
    const flows = Object.keys(scheme.flows || {});
    return `OAuth 2.0${flows.length ? ` · ${flows.join(', ')}` : ''}`;
  }
  if (scheme.type === 'openIdConnect') return 'OpenID Connect';
  return scheme.type;
}

export function flowLabel(flow: string): string {
  switch (flow) {
    case 'authorizationCode':
      return 'Authorization code';
    case 'clientCredentials':
      return 'Client credentials';
    case 'implicit':
      return 'Implicit';
    case 'password':
      return 'Password';
    default:
      return flow;
  }
}

export interface OAuthTokenRequest {
  tokenUrl: string;
  grantType: 'password' | 'client_credentials' | 'authorization_code' | 'refresh_token';
  username?: string;
  password?: string;
  clientId?: string;
  clientSecret?: string;
  scope?: string;
  code?: string;
  redirectUri?: string;
  refreshToken?: string;
  useBasicAuth?: boolean;
}

export interface OAuthTokenResult {
  accessToken: string;
  tokenType?: string;
  scopes?: string[];
  raw: unknown;
}

function extractToken(raw: any): OAuthTokenResult | null {
  const accessToken = raw?.access_token || raw?.accessToken || raw?.token || raw?.jwt || raw?.id_token;
  if (!accessToken) return null;
  const scopes = typeof raw?.scope === 'string' ? raw.scope.split(/\s+/).filter(Boolean) : raw?.scopes;
  return {
    accessToken: String(accessToken),
    tokenType: raw?.token_type ? String(raw.token_type) : 'Bearer',
    scopes: Array.isArray(scopes) ? scopes.map(String) : undefined,
    raw,
  };
}

/** Exchange credentials for an OAuth 2.0 access token. */
export async function requestOAuthToken(request: OAuthTokenRequest): Promise<OAuthTokenResult> {
  const body = new URLSearchParams();
  body.set('grant_type', request.grantType);
  if (request.grantType === 'password') {
    body.set('username', request.username || '');
    body.set('password', request.password || '');
  }
  if (request.grantType === 'authorization_code' && request.code) body.set('code', request.code);
  if (request.grantType === 'refresh_token' && request.refreshToken) body.set('refresh_token', request.refreshToken);
  if (request.redirectUri) body.set('redirect_uri', request.redirectUri);
  if (request.scope) body.set('scope', request.scope);
  if (request.clientId && !request.useBasicAuth) body.set('client_id', request.clientId);
  if (request.clientSecret && !request.useBasicAuth) body.set('client_secret', request.clientSecret);

  const headers: Record<string, string> = {
    'Content-Type': 'application/x-www-form-urlencoded',
    Accept: 'application/json',
  };
  if (request.useBasicAuth && request.clientId) {
    headers.Authorization = basicValue(request.clientId, request.clientSecret || '');
  }

  // Route token exchange through the same transport as API calls so OAuth
  // works from the Chrome extension even when the token endpoint omits CORS.
  const response = await executeRequest({
    method: 'POST',
    url: request.tokenUrl,
    headers,
    bodyText: body.toString(),
  });
  const text = response.rawText;
  let data: unknown = null;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  if (response.status < 200 || response.status >= 300) {
    const message = typeof data === 'string' ? data : JSON.stringify(data);
    throw new Error(`Token request failed (${response.status}): ${message.slice(0, 300)}`);
  }
  const result = extractToken(data);
  if (!result) {
    throw new Error('The token endpoint responded, but no access_token was present.');
  }
  return result;
}

/** Resolve a token/authorization URL relative to the spec origin. */
export function resolveAuthUrl(url: string, specUrl?: string): string {
  if (!url) return url;
  if (/^https?:\/\//i.test(url)) return url;
  if (!specUrl) return url;
  try {
    return new URL(url, specUrl).toString();
  } catch {
    return url;
  }
}
