import React, { useMemo, useState } from 'react';
import { ExternalLink, KeyRound, Loader2, Lock, ShieldCheck } from 'lucide-react';
import type { Credential, OAuthFlow, SecurityScheme } from '../types';
import { useApp } from '../state/AppContext';
import { flowLabel, requestOAuthToken, resolveAuthUrl, schemeSummary } from '../lib/auth';
import type { CredentialMap } from '../lib/auth';
import { Modal } from './Modal';

type Draft = Record<string, string>;

function draftFromCredential(credential: Credential | undefined): Draft {
  if (!credential) return {};
  switch (credential.type) {
    case 'bearer':
      return { token: credential.token };
    case 'basic':
      return { username: credential.username, password: credential.password };
    case 'apiKey':
      return { value: credential.value };
    case 'oauth2':
      return { token: credential.accessToken };
    case 'openIdConnect':
      return { token: credential.accessToken };
    default:
      return {};
  }
}

function hasValue(draft: Draft): boolean {
  return Object.values(draft).some((value) => value.trim() !== '');
}

function credentialFromDraft(scheme: SecurityScheme, draft: Draft): Credential | null {
  if (scheme.type === 'apiKey') {
    return draft.value?.trim() ? { type: 'apiKey', value: draft.value.trim() } : null;
  }
  if (scheme.type === 'http') {
    if ((scheme.scheme || '').toLowerCase() === 'basic') {
      return draft.username?.trim()
        ? { type: 'basic', username: draft.username.trim(), password: draft.password || '' }
        : null;
    }
    return draft.token?.trim() ? { type: 'bearer', token: draft.token.trim() } : null;
  }
  if (scheme.type === 'oauth2') {
    return draft.token?.trim() ? { type: 'oauth2', accessToken: draft.token.trim() } : null;
  }
  if (scheme.type === 'openIdConnect') {
    return draft.token?.trim() ? { type: 'openIdConnect', accessToken: draft.token.trim() } : null;
  }
  return null;
}

const OAuthEditor: React.FC<{
  scheme: SecurityScheme;
  flows: Array<[string, OAuthFlow]>;
  draft: Draft;
  patch: (values: Draft) => void;
  onToken: (token: string) => void;
}> = ({ scheme, flows, draft, patch, onToken }) => {
  const { source, notify } = useApp();
  const [flowKey, setFlowKey] = useState(flows[0]?.[0] || '');
  const [busy, setBusy] = useState(false);
  const flow = flows.find(([key]) => key === flowKey)?.[1] || flows[0]?.[1];
  const tokenUrl = resolveAuthUrl(flow?.tokenUrl || '', source?.url);
  const authorizeUrl = resolveAuthUrl(flow?.authorizationUrl || '', source?.url);
  const grantType =
    flowKey === 'authorizationCode'
      ? 'authorization_code'
      : flowKey === 'clientCredentials'
        ? 'client_credentials'
        : flowKey === 'password'
          ? 'password'
          : null;

  const fields: Record<string, string> = draft;

  const startAuthorization = () => {
    if (!authorizeUrl) {
      notify('This flow does not declare an authorization URL.', 'info');
      return;
    }
    try {
      const url = new URL(authorizeUrl);
      url.searchParams.set('response_type', flowKey === 'implicit' ? 'token' : 'code');
      if (fields.clientId) url.searchParams.set('client_id', fields.clientId);
      if (fields.scope) url.searchParams.set('scope', fields.scope);
      url.searchParams.set('redirect_uri', fields.redirectUri || window.location.origin);
      window.open(url.toString(), '_blank', 'noopener,noreferrer');
    } catch {
      notify('The authorization URL is not valid.', 'error');
    }
  };

  const getToken = async () => {
    if (!tokenUrl || !grantType) {
      notify('This flow needs a token URL. Paste an access token instead.', 'info');
      return;
    }
    if (grantType === 'authorization_code' && !fields.code?.trim()) {
      notify('Paste the authorization code first.', 'info');
      return;
    }
    setBusy(true);
    try {
      const token = await requestOAuthToken({
        tokenUrl,
        grantType,
        clientId: fields.clientId,
        clientSecret: fields.clientSecret,
        username: fields.username,
        password: fields.password,
        scope: fields.scope,
        code: fields.code,
        redirectUri: fields.redirectUri || window.location.origin,
      });
      patch({ token: token.accessToken });
      notify('Access token received.', 'success');
      onToken(token.accessToken);
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-oauth">
      {flows.length > 1 ? (
        <label className="field">
          <span>Flow</span>
          <select className="input" value={flowKey} onChange={(event) => setFlowKey(event.target.value)}>
            {flows.map(([key]) => (
              <option key={key} value={key}>
                {flowLabel(key)}
              </option>
            ))}
          </select>
        </label>
      ) : flow ? (
        <span className="auth-flow-label">{flowLabel(flowKey)}</span>
      ) : null}

      <div className="auth-oauth-grid">
        <label className="field">
          <span>Client ID</span>
          <input
            className="input mono"
            value={fields.clientId || ''}
            onChange={(event) => patch({ clientId: event.target.value })}
            spellCheck={false}
          />
        </label>
        <label className="field">
          <span>Client secret</span>
          <input
            className="input mono"
            type="password"
            value={fields.clientSecret || ''}
            onChange={(event) => patch({ clientSecret: event.target.value })}
            spellCheck={false}
          />
        </label>
        {flowKey === 'password' ? (
          <>
            <label className="field">
              <span>Username</span>
              <input
                className="input"
                value={fields.username || ''}
                onChange={(event) => patch({ username: event.target.value })}
                spellCheck={false}
              />
            </label>
            <label className="field">
              <span>Password</span>
              <input
                className="input"
                type="password"
                value={fields.password || ''}
                onChange={(event) => patch({ password: event.target.value })}
              />
            </label>
          </>
        ) : null}
        <label className="field">
          <span>Scope</span>
          <input
            className="input mono"
            value={fields.scope || ''}
            onChange={(event) => patch({ scope: event.target.value })}
            placeholder={Object.keys(flow?.scopes || {}).join(' ') || 'read:things'}
            spellCheck={false}
          />
        </label>
        {flowKey === 'authorizationCode' ? (
          <>
            <label className="field">
              <span>Authorization code</span>
              <input
                className="input mono"
                value={fields.code || ''}
                onChange={(event) => patch({ code: event.target.value })}
                spellCheck={false}
              />
            </label>
            <label className="field">
              <span>Redirect URI</span>
              <input
                className="input mono"
                value={fields.redirectUri || ''}
                onChange={(event) => patch({ redirectUri: event.target.value })}
                placeholder={typeof window !== 'undefined' ? window.location.origin : ''}
                spellCheck={false}
              />
            </label>
          </>
        ) : null}
        <label className="field auth-token-field">
          <span>Access token</span>
          <input
            className="input mono"
            type="password"
            value={fields.token || ''}
            onChange={(event) => patch({ token: event.target.value })}
            placeholder="Paste an access token"
            spellCheck={false}
            data-testid="auth-token-input"
          />
        </label>
      </div>

      {flow?.scopes && Object.keys(flow.scopes).length > 0 ? (
        <div className="auth-scopes">
          {Object.entries(flow.scopes).map(([scope, description]) => (
            <span className="constraint" key={scope} title={description}>
              {scope}
            </span>
          ))}
        </div>
      ) : null}

      <div className="auth-oauth-actions">
        {authorizeUrl ? (
          <button type="button" className="text-btn" onClick={startAuthorization}>
            <ExternalLink size={13} /> Open authorization URL
          </button>
        ) : null}
        {tokenUrl ? <span className="auth-flow-label mono">{tokenUrl}</span> : null}
        <div className="op-action-spacer" />
        <button type="button" className="btn btn-secondary" onClick={() => void getToken()} disabled={busy}>
          {busy ? <Loader2 size={14} className="spin" /> : <KeyRound size={14} />}
          {busy ? 'Requesting' : 'Get token'}
        </button>
      </div>
    </div>
  );
};

export const AuthModal: React.FC = () => {
  const { spec, source, credentials, setCredentials, closeAuth, notify } = useApp();
  const [drafts, setDrafts] = useState<Record<string, Draft>>(() => {
    const initial: Record<string, Draft> = {};
    if (spec) {
      for (const name of Object.keys(spec.securitySchemes)) {
        initial[name] = draftFromCredential(credentials[name]);
      }
    }
    return initial;
  });

  const schemes = useMemo(() => Object.entries(spec?.securitySchemes || {}), [spec]);

  if (!spec) return null;

  const patch = (name: string, values: Draft) => {
    setDrafts((previous) => ({ ...previous, [name]: { ...(previous[name] || {}), ...values } }));
  };

  const save = () => {
    const next: CredentialMap = {};
    for (const [name, scheme] of schemes) {
      const credential = credentialFromDraft(scheme, drafts[name] || {});
      if (credential) next[name] = credential;
    }
    setCredentials(next);
    closeAuth();
    const count = Object.keys(next).length;
    notify(count > 0 ? `Saved ${count} authorization${count === 1 ? '' : 's'}.` : 'Authorization cleared.', 'success');
  };

  const clearAll = () => {
    setDrafts(Object.fromEntries(schemes.map(([name]) => [name, {}])));
    notify('Credentials cleared. Press Save to apply.', 'info');
  };

  return (
    <Modal
      title="Authorize"
      subtitle="Credentials stay in this browser and are sent only to the API."
      onClose={closeAuth}
      width={720}
      className="auth-modal"
      footer={
        <>
          <button type="button" className="text-btn" onClick={clearAll}>
            Clear all
          </button>
          <div className="op-action-spacer" />
          <button type="button" className="btn btn-secondary" onClick={closeAuth}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" onClick={save} data-testid="auth-save">
            Save
          </button>
        </>
      }
    >
      <div className="auth-list">
        {schemes.map(([name, scheme]) => {
          const draft = drafts[name] || {};
          const active = hasValue(draft);
          const flows = Object.entries(scheme.flows || {});
          return (
            <div className={`auth-card ${active ? 'is-active' : ''}`} key={name}>
              <div className="auth-card-head">
                <span className={`auth-icon ${active ? 'is-active' : ''}`}>
                  {active ? <ShieldCheck size={16} /> : <Lock size={15} />}
                </span>
                <div className="auth-card-title">
                  <strong>{name}</strong>
                  <span>{schemeSummary(scheme)}</span>
                </div>
                {active ? <span className="tiny-badge is-ok">configured</span> : null}
              </div>

              {scheme.description ? <p className="auth-card-desc">{scheme.description}</p> : null}

              {scheme.type === 'apiKey' ? (
                <div className="auth-fields">
                  <label className="field">
                    <span>API key</span>
                    <input
                      className="input mono"
                      type="password"
                      value={draft.value || ''}
                      onChange={(event) => patch(name, { value: event.target.value })}
                      placeholder={`Value for ${scheme.paramName || name}`}
                      spellCheck={false}
                      data-testid={`auth-input-${name}`}
                    />
                  </label>
                  <span className="auth-hint">
                    Sent in the {scheme.in || 'header'} as <code>{scheme.paramName || name}</code>.
                  </span>
                </div>
              ) : null}

              {scheme.type === 'http' ? (
                (scheme.scheme || '').toLowerCase() === 'basic' ? (
                  <div className="auth-fields">
                    <label className="field">
                      <span>Username</span>
                      <input
                        className="input"
                        value={draft.username || ''}
                        onChange={(event) => patch(name, { username: event.target.value })}
                        spellCheck={false}
                      />
                    </label>
                    <label className="field">
                      <span>Password</span>
                      <input
                        className="input"
                        type="password"
                        value={draft.password || ''}
                        onChange={(event) => patch(name, { password: event.target.value })}
                      />
                    </label>
                  </div>
                ) : (
                  <div className="auth-fields">
                    <label className="field auth-token-field">
                      <span>{scheme.bearerFormat ? `${scheme.bearerFormat} token` : 'Bearer token'}</span>
                      <input
                        className="input mono"
                        type="password"
                        value={draft.token || ''}
                        onChange={(event) => patch(name, { token: event.target.value })}
                        placeholder="Paste a token"
                        spellCheck={false}
                        data-testid={`auth-input-${name}`}
                      />
                    </label>
                    <span className="auth-hint">
                      Sent as <code>Authorization: Bearer …</code>.
                    </span>
                  </div>
                )
              ) : null}

              {scheme.type === 'oauth2' ? (
                <OAuthEditor
                  scheme={scheme}
                  flows={flows}
                  draft={draft}
                  patch={(values) => patch(name, values)}
                  onToken={() => undefined}
                />
              ) : null}

              {scheme.type === 'openIdConnect' ? (
                <div className="auth-fields">
                  <label className="field auth-token-field">
                    <span>Access token</span>
                    <input
                      className="input mono"
                      type="password"
                      value={draft.token || ''}
                      onChange={(event) => patch(name, { token: event.target.value })}
                      placeholder="Paste a token"
                      spellCheck={false}
                    />
                  </label>
                  {scheme.openIdConnectUrl ? (
                    <span className="auth-hint mono">{scheme.openIdConnectUrl}</span>
                  ) : null}
                </div>
              ) : null}

              {!['apiKey', 'http', 'oauth2', 'openIdConnect'].includes(scheme.type) ? (
                <p className="auth-hint">This scheme type ({scheme.type}) cannot be configured here.</p>
              ) : null}
            </div>
          );
        })}
      </div>
    </Modal>
  );
};
