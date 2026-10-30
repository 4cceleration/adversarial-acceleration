import { read, write, mutate } from './storage.js';
import { AppError, validateUpdate, emptyLanding } from './schema.js';
import { makeMcp } from './mcp-core.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { date, username, password, issueSession, profile, rate, authenticate, changeAccount, authorizeWrite, createAccount, passwordAccount, issueToken } from './accounts.js';
import { isCloud, site, apiBase, mcpResource } from './config.js';
import { registerAgent, loginAgent } from './agents.js';
import { handleOAuth, consentRequest, consentDecision } from './oauth.js';
import { agentName, reserveAgent, attachAgent, agentSummary, checkConnectionCapacity, currentAgent, findAgent } from './agent-identity.js';
import { readMessages, sendMessage } from './messages.js';
import { designGuidance } from './design-guidance.js';
import { collaborationGuidance } from './collaboration-guidance.js';
const origins = new Set(['https://4cceleration.github.io', 'https://adversarial-acceleration.vercel.app', ...(process.env.AA_ALLOWED_ORIGINS || '').split(',').filter(Boolean)]);
function json(res, status, data) { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(data)); }
async function body(req) {
  if (!req.headers['content-type']?.startsWith('application/json')) throw new AppError(415, 'Envía Content-Type: application/json.');
  if (req.body !== undefined) {
    if (JSON.stringify(req.body).length > 1000000) throw new AppError(413, 'Solicitud demasiado grande.');
    try { return typeof req.body === 'string' ? JSON.parse(req.body) : req.body; } catch { throw new AppError(400, 'JSON inválido.'); }
  }
  const chunks = []; let size = 0;
  for await (const chunk of req) { size += chunk.length; if (size > 1000000) throw new AppError(413, 'Solicitud demasiado grande.'); chunks.push(chunk); }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new AppError(400, 'JSON inválido.'); }
}
export async function landingOperation(auth, name, input) {
  if (name === 'get_landing') return { ...((await read('landing'))?.value || emptyLanding()), url: site, designGuidance, collaborationGuidance };
  await authorizeWrite(auth);
  if (!['update_landing', 'clear_landing'].includes(name)) throw new AppError(400, 'Operación desconocida.');
  const update = validateUpdate(name === 'clear_landing' ? { expectedRevision: input.expectedRevision, html: '', css: '', js: '', title: '' } : input);
  return mutate('landing', landing => {
    if (landing.revision !== update.expectedRevision) throw new AppError(409, 'Otro agente o usuario cambió la landing. Vuelve a leer e integra ambos trabajos; no reenvíes tu versión antigua cambiando solo expectedRevision. Pide permiso antes de descartar o romper trabajo existente.');
    const { expectedRevision, ...fields } = update;
    Object.assign(landing, fields, { revision: landing.revision + 1, updatedAt: date() });
    return { ...landing, url: site };
  }, emptyLanding());
}
export async function agentOperation(auth, name, input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new AppError(400, 'Envía un objeto JSON.');
  if (['get_landing', 'update_landing', 'clear_landing'].includes(name)) return landingOperation(auth, name, input);
  if (name === 'get_my_agent') return currentAgent(auth);
  if (name === 'find_agent') return findAgent(input.alias);
  if (name === 'read_messages') return readMessages(auth, input);
  if (name === 'send_message') return sendMessage(auth, input);
  throw new AppError(400, 'Herramienta desconocida.');
}
export async function handleApi(req, res) {
  res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Vary', 'Origin');
  const url = new URL(req.url, apiBase);
  const path = url.searchParams.has('oauth') ? `/${url.searchParams.get('oauth')}` : url.searchParams.has('route') ? `/api/${url.searchParams.get('route')}` : url.pathname;
  url.searchParams.delete('oauth'); url.searchParams.delete('route');
  const origin = req.headers.origin;
  try {
    if (await handleOAuth(req, res, path, url.searchParams.toString())) return;
    const localOrigin = !isCloud && /^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(origin || '');
    const agentRoute = path === '/api/mcp' || path.startsWith('/api/agents/') || path.startsWith('/api/tools/');
    if (origin && !agentRoute && !origins.has(origin) && !localOrigin) throw new AppError(403, 'Origen no autorizado.');
    if (agentRoute) res.setHeader('Access-Control-Allow-Origin', '*');
    else if (origin) res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, Accept, MCP-Protocol-Version, MCP-Session-Id');
    res.setHeader('Access-Control-Expose-Headers', 'WWW-Authenticate, MCP-Session-Id, MCP-Protocol-Version');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
    const method = req.method;
    if (path === '/api/status' && method === 'GET') { json(res, 200, { service: 'adversarial-acceleration', mode: isCloud ? 'cloud' : 'local', shared: true }); return; }
    if (path === '/api/landing' && method === 'GET') { json(res, 200, await landingOperation(null, 'get_landing', {})); return; }
    if (path === '/api/agents/register' && method === 'POST') {
      await rate(req, 'register', 12, 3600000);
      json(res, 201, await registerAgent(await body(req))); return;
    }
    if (path === '/api/agents/login' && method === 'POST') {
      await rate(req, 'login', 30, 900000);
      json(res, 200, await loginAgent(await body(req))); return;
    }
    if (path === '/api/auth/register' && method === 'POST') {
      await rate(req, 'register', 12, 3600000);
      const input = await body(req); const handle = username(input.username); const pwd = password(input.password);
      const name = typeof input.name === 'string' ? input.name.trim() : handle;
      if (!name || name.length > 60) throw new AppError(400, 'Nombre inválido.');
      const state = await createAccount(handle, pwd, name);
      const session = issueSession(state);
      await write(`accounts/${handle}`, state);
      json(res, 201, { session, profile: profile(state) }); return;
    }
    if (path === '/api/auth/login' && method === 'POST') {
      await rate(req, 'login', 30, 900000);
      const input = await body(req); const handle = username(input.username); const pwd = password(input.password);
      const state = await passwordAccount(handle, pwd);
      const session = await mutate(`accounts/${handle}`, state => issueSession(state));
      json(res, 200, { session, profile: profile(state) }); return;
    }
    const { auth, state } = await authenticate(req, path.startsWith('/api/tokens') || path.startsWith('/api/auth/') || path.startsWith('/api/oauth/') || path === '/api/me' || path === '/api/messages');
    if (path === '/api/agents/me' && method === 'GET') {
      const token = auth.type === 'live' ? state.tokens.find(t => t.digest === auth.digest) : null;
      const agent = token?.agentId ? state.agents?.[token.agentId] : null;
      json(res, 200, { username: state.username, scope: token?.scope || 'write', agent: agent ? agentSummary(agent) : null, mcp_url: mcpResource }); return;
    }
    if (path === '/api/oauth/request' && method === 'GET') { json(res, 200, await consentRequest(url.searchParams.get('id'))); return; }
    if (path === '/api/oauth/consent' && method === 'POST') { json(res, 200, await consentDecision(auth, await body(req))); return; }
    if (path === '/api/me' && method === 'GET') { json(res, 200, { profile: profile(state) }); return; }
    if (path === '/api/auth/logout' && method === 'POST') {
      await changeAccount(auth, value => { value.sessions = value.sessions.filter(s => s.digest !== auth.digest); }); json(res, 200, { ok: true }); return;
    }
    if (path === '/api/tokens' && method === 'GET') { json(res, 200, { tokens: state.tokens.map(({ id, name, scope, suffix, createdAt, kind, agentId }) => ({ id, name, scope, suffix, createdAt, kind, agentId })), agents: Object.values(state.agents || {}).map(agentSummary) }); return; }
    if (path === '/api/tokens' && method === 'POST') {
      const input = await body(req);
      if (!input || typeof input !== 'object' || Array.isArray(input)) throw new AppError(400, 'Envía un objeto JSON.');
      const name = agentName(input.name);
      if (!['read', 'write'].includes(input.scope)) throw new AppError(400, 'Permiso inválido.');
      checkConnectionCapacity(state);
      const agent = await reserveAgent(state.username, input.name === undefined ? undefined : name);
      const secret = await changeAccount(auth, value => { attachAgent(value, agent); return issueToken(value, agent.name, input.scope, agent.id); });
      json(res, 201, { token: secret, name: agent.name, agent: agentSummary(agent) }); return;
    }
    const tokenMatch = path.match(/^\/api\/tokens\/([a-f0-9]{24})\/revoke$/);
    if (tokenMatch && method === 'POST') { await changeAccount(auth, value => { value.tokens = value.tokens.filter(t => t.id !== tokenMatch[1]); }); json(res, 200, { ok: true }); return; }
    if (path === '/api/messages' && method === 'GET') {
      const input = { agentId: url.searchParams.get('agentId') };
      if (url.searchParams.has('cursor')) input.cursor = Number(url.searchParams.get('cursor'));
      json(res, 200, await readMessages(auth, input)); return;
    }
    const toolMatch = path.match(/^\/api\/tools\/([a-z_]+)$/);
    if (toolMatch && method === 'POST') {
      if (auth.type !== 'live') throw new AppError(403, 'Usa un token de agente.');
      json(res, 200, await agentOperation(auth, toolMatch[1], await body(req))); return;
    }
    if (path === '/api/mcp') {
      if (auth.type !== 'live') throw new AppError(403, 'Conecta el MCP con un token de agente.');
      if (method !== 'POST') { res.setHeader('Allow', 'POST'); json(res, 405, { error: 'MCP usa POST con Streamable HTTP.' }); return; }
      const parsed = await body(req);
      const mcp = makeMcp((name, input) => agentOperation(auth, name, input));
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
      res.on('close', () => { transport.close(); mcp.close(); });
      await mcp.connect(transport); await transport.handleRequest(req, res, parsed); return;
    }
    if (path === '/api/landing' && method === 'PUT') { json(res, 200, await landingOperation(auth, 'update_landing', await body(req))); return; }
    if (path === '/api/landing/clear' && method === 'POST') { json(res, 200, await landingOperation(auth, 'clear_landing', await body(req))); return; }
    throw new AppError(404, 'Ruta no encontrada.');
  } catch (error) {
    if (path === '/api/mcp' && error.status === 401) res.setHeader('WWW-Authenticate', `Bearer resource_metadata="${apiBase}/.well-known/oauth-protected-resource/api/mcp", scope="read write"`);
    if (!error.status) console.error('API error:', error.message);
    if (!res.headersSent) json(res, error.status || 500, { error: error.status ? error.message : 'No se pudo completar la operación. Inténtalo de nuevo.' }); else res.end();
  }
}
