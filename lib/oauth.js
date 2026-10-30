import express from 'express';
import { randomBytes } from 'node:crypto';
import { mcpAuthRouter } from '@modelcontextprotocol/sdk/server/auth/router.js';
import { InvalidGrantError, InvalidClientMetadataError, InvalidRequestError, InvalidScopeError, InvalidTargetError, InvalidTokenError } from '@modelcontextprotocol/sdk/server/auth/errors.js';
import { read, write, mutate } from './storage.js';
import { hash, random, date, rate, changeAccount, credential, verify } from './accounts.js';
import { AppError } from './schema.js';
import { apiBase, site, mcpResource } from './config.js';

const scopesSupported = ['read', 'write'];
const lifetime = 10 * 60 * 1000;
const nonce = () => randomBytes(32).toString('hex');
const clientKey = id => `oauth/clients/${hash(id)}`;
const requestKey = id => {
  if (typeof id !== 'string' || !/^[a-f0-9]{64}$/.test(id)) throw new AppError(400, 'Solicitud de conexión inválida.');
  return `oauth/requests/${hash(id)}`;
};
function validRedirect(value) {
  const url = new URL(value);
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (value.length > 2048 || url.hash || url.username || url.password || (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback))) throw new InvalidClientMetadataError('Use an HTTPS redirect URI or an HTTP loopback callback.');
}
function scopes(values = [], fallback = ['read', 'write']) {
  const result = [...new Set(values.length ? values : fallback)];
  if (result.some(scope => !scopesSupported.includes(scope))) throw new InvalidScopeError('Supported scopes: read write.');
  return result;
}
function resource(value) {
  if (value && value.href !== mcpResource) throw new InvalidTargetError('The token must target this MCP server.');
  return mcpResource;
}
function accountFromToken(token, type) {
  const match = typeof token === 'string' && token.match(new RegExp(`^aa_${type}_([a-z0-9_-]{3,32})\\.[a-f0-9]{64}$`));
  if (!match) throw new InvalidGrantError('Invalid credential.');
  return match[1];
}
function pendingRequest(record) {
  if (!record || record.expires <= Date.now() || record.used) throw new AppError(400, 'La solicitud expiró o ya fue utilizada. Vuelve a conectar desde tu agente.');
  return record;
}
function authorizationGrant(state, client, code) {
  const grant = state?.tokens.find(t => t.kind === 'oauth' && t.codeDigest === hash(code));
  if (!grant || grant.clientId !== client.client_id || grant.codeUsed || grant.codeExpires <= Date.now()) throw new InvalidGrantError('Authorization code expired, used or invalid.');
  return grant;
}
function grantTokens(state, grant) {
  const access = `aa_live_${state.username}.${nonce()}`;
  const refresh = `aa_refresh_${state.username}.${nonce()}`;
  grant.digest = hash(access); grant.suffix = access.slice(-6); grant.expires = Date.now() + 3600000;
  grant.refreshDigest = hash(refresh); grant.refreshExpires ||= Date.now() + 30 * 86400000;
  return { access_token: access, refresh_token: refresh, token_type: 'Bearer', expires_in: 3600, scope: grant.scopes.join(' ') };
}

export const oauthProvider = {
  clientsStore: {
    async getClient(id) {
      if (typeof id !== 'string' || id.length > 2048) return undefined;
      return (await read(clientKey(id)))?.value;
    },
    async registerClient(client) {
      if (!client.redirect_uris?.length || client.redirect_uris.length > 10 || (client.client_name || '').length > 80) throw new InvalidClientMetadataError('Provide a client name and 1–10 redirect URIs.');
      for (const uri of client.redirect_uris) validRedirect(uri);
      if (client.token_endpoint_auth_method && !['none', 'client_secret_post'].includes(client.token_endpoint_auth_method)) throw new InvalidClientMetadataError('Supported authentication methods: none, client_secret_post.');
      const info = { ...client, token_endpoint_auth_method: client.token_endpoint_auth_method || 'client_secret_post', grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'] };
      await write(clientKey(info.client_id), info);
      return info;
    }
  },
  async authorize(client, params, res) {
    validRedirect(params.redirectUri);
    if (!/^[A-Za-z0-9_-]{43}$/.test(params.codeChallenge) || (params.state || '').length > 2048) throw new InvalidRequestError('Invalid PKCE challenge or state.');
    const id = nonce();
    await write(requestKey(id), {
      clientId: client.client_id, redirectUri: params.redirectUri, state: params.state || '',
      codeChallenge: params.codeChallenge, scopes: scopes(params.scopes), resource: resource(params.resource),
      expires: Date.now() + lifetime, used: false
    });
    const consent = new URL(site); consent.hash = new URLSearchParams({ authorize: id }).toString();
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.redirect(303, consent.href);
  },
  async challengeForAuthorizationCode(client, code) {
    const handle = accountFromToken(code, 'code');
    const state = (await read(`accounts/${handle}`))?.value;
    return authorizationGrant(state, client, code).codeChallenge;
  },
  async exchangeAuthorizationCode(client, code, _verifier, redirectUri, requestedResource) {
    const handle = accountFromToken(code, 'code'); resource(requestedResource);
    return mutate(`accounts/${handle}`, state => {
      const grant = authorizationGrant(state, client, code);
      if (redirectUri !== grant.redirectUri) throw new InvalidGrantError('The redirect URI does not match.');
      grant.codeUsed = true; delete grant.codeDigest; delete grant.codeChallenge;
      return grantTokens(state, grant);
    });
  },
  async exchangeRefreshToken(client, refreshToken, requestedScopes, requestedResource) {
    const handle = accountFromToken(refreshToken, 'refresh'); resource(requestedResource);
    const digest = hash(refreshToken);
    const result = await mutate(`accounts/${handle}`, state => {
      const grant = state.tokens.find(t => t.kind === 'oauth' && t.clientId === client.client_id && (t.refreshDigest === digest || t.usedRefreshDigests?.includes(digest)));
      if (!grant || grant.refreshExpires <= Date.now()) throw new InvalidGrantError('Refresh token expired or invalid.');
      if (grant.refreshDigest !== digest) {
        state.tokens = state.tokens.filter(t => t.id !== grant.id);
        return { replay: true };
      }
      if (requestedScopes) {
        const selected = scopes(requestedScopes, grant.scopes);
        if (selected.some(scope => !grant.scopes.includes(scope))) throw new InvalidScopeError('Cannot increase the authorized scope.');
        grant.scopes = selected; grant.scope = selected.includes('write') ? 'write' : 'read';
      }
      grant.usedRefreshDigests = [...(grant.usedRefreshDigests || []), digest].slice(-128);
      return grantTokens(state, grant);
    });
    if (result.replay) throw new InvalidGrantError('Refresh token reuse detected. Authorize the connection again.');
    return result;
  },
  async verifyAccessToken(token) {
    try {
      const auth = credential({ headers: { authorization: `Bearer ${token}` } });
      const state = (await read(`accounts/${auth.username}`))?.value; verify(state, auth);
      const grant = state.tokens.find(t => t.digest === auth.digest);
      if (grant?.kind !== 'oauth' || grant.resource !== mcpResource) throw new Error();
      return { token, clientId: grant.clientId, scopes: grant.scopes, expiresAt: Math.floor(grant.expires / 1000), resource: new URL(grant.resource) };
    } catch { throw new InvalidTokenError('Access token expired, revoked or invalid.'); }
  },
  async revokeToken(client, request) {
    const match = request.token?.match(/^aa_(?:live|refresh)_([a-z0-9_-]{3,32})\.[a-f0-9]{64}$/);
    if (!match || !(await read(`accounts/${match[1]}`))) return;
    const digest = hash(request.token);
    await mutate(`accounts/${match[1]}`, state => {
      state.tokens = state.tokens.filter(t => !(t.kind === 'oauth' && t.clientId === client.client_id && (t.digest === digest || t.refreshDigest === digest || t.usedRefreshDigests?.includes(digest))));
    });
  }
};

export async function consentRequest(id) {
  const pending = pendingRequest((await read(requestKey(id)))?.value);
  const client = await oauthProvider.clientsStore.getClient(pending.clientId);
  if (!client) throw new AppError(400, 'La aplicación ya no está disponible.');
  return { name: client.client_name || 'Agente MCP', destination: new URL(pending.redirectUri).origin, scope: pending.scopes.includes('write') ? 'write' : 'read' };
}
export async function consentDecision(auth, { requestId, allow }) {
  if (typeof allow !== 'boolean') throw new AppError(400, 'Indica si autorizas la conexión.');
  const pending = await mutate(requestKey(requestId), value => {
    pendingRequest(value); value.used = true; return { ...value };
  });
  const redirect = new URL(pending.redirectUri);
  if (pending.state) redirect.searchParams.set('state', pending.state);
  if (!allow) { redirect.searchParams.set('error', 'access_denied'); return { redirect: redirect.href }; }
  const client = await oauthProvider.clientsStore.getClient(pending.clientId);
  if (!client) throw new AppError(400, 'Aplicación no encontrada.');
  const code = `aa_code_${auth.username}.${nonce()}`;
  await changeAccount(auth, state => {
    state.tokens = state.tokens.filter(t => t.kind !== 'oauth' || t.codeUsed || t.codeExpires > Date.now());
    if (state.tokens.length >= 20) throw new AppError(400, 'Máximo 20 conexiones activas. Revoca una antes de continuar.');
    state.tokens.push({
      id: random(), kind: 'oauth', name: (client.client_name || 'Agente MCP').slice(0, 60),
      clientId: pending.clientId, resource: pending.resource, scopes: pending.scopes,
      scope: pending.scopes.includes('write') ? 'write' : 'read', createdAt: date(), suffix: '',
      codeDigest: hash(code), codeChallenge: pending.codeChallenge, codeExpires: Date.now() + lifetime,
      codeUsed: false, redirectUri: pending.redirectUri
    });
  });
  redirect.searchParams.set('code', code);
  return { redirect: redirect.href };
}

const app = express();
app.disable('x-powered-by');
app.use(mcpAuthRouter({
  provider: oauthProvider, issuerUrl: new URL(apiBase), resourceServerUrl: new URL(mcpResource),
  scopesSupported, resourceName: 'Adversarial Acceleration', serviceDocumentationUrl: new URL('llms.txt', site),
  authorizationOptions: { rateLimit: false }, tokenOptions: { rateLimit: false },
  clientRegistrationOptions: { rateLimit: false }, revocationOptions: { rateLimit: false }
}));
const paths = new Set(['/authorize', '/token', '/register', '/revoke', '/.well-known/oauth-authorization-server', '/.well-known/oauth-protected-resource/api/mcp', '/.well-known/oauth-protected-resource']);
export async function handleOAuth(req, res, path, search) {
  if (!paths.has(path)) return false;
  if (path === '/.well-known/oauth-protected-resource') path += '/api/mcp';
  if (!path.startsWith('/.well-known/') && req.method !== 'OPTIONS') await rate(req, `oauth:${path}`, path === '/register' ? 20 : 100, 3600000);
  if (req.body !== undefined && Buffer.byteLength(JSON.stringify(req.body)) > 100000) throw new AppError(413, 'Solicitud demasiado grande.');
  if (typeof req.body === 'string') {
    if (Buffer.byteLength(req.body) > 100000) throw new AppError(413, 'Solicitud demasiado grande.');
    if (req.headers['content-type']?.startsWith('application/x-www-form-urlencoded')) req.body = Object.fromEntries(new URLSearchParams(req.body));
    else if (req.headers['content-type']?.startsWith('application/json')) { try { req.body = JSON.parse(req.body); } catch { throw new AppError(400, 'JSON inválido.'); } }
  }
  req.url = `${path}${search ? `?${search}` : ''}`;
  await new Promise((resolve, reject) => {
    res.once('finish', resolve); res.once('close', resolve);
    app(req, res, error => {
      if (error) reject(error);
      else { res.writeHead(404); res.end(); resolve(); }
    });
  });
  return true;
}
