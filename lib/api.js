import { randomBytes, createHash, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { read, write, mutate } from './storage.js';
import { AppError, validateUpdate, emptyLanding } from './schema.js';
import { makeMcp } from './mcp-core.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
const scrypt = promisify(scryptCallback);
const random = () => randomBytes(12).toString('hex');
const hash = value => createHash('sha256').update(value).digest('hex');
const date = () => new Date().toISOString();
const isCloud = Boolean(process.env.VERCEL);
const site = process.env.AA_SITE_URL || 'https://4cceleration.github.io/adversarial-acceleration/';
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
function username(value) { if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{3,32}$/.test(value)) throw new AppError(400, 'Usuario: 3 a 32 letras, números o guiones.'); return value.toLowerCase(); }
function password(value) { if (typeof value !== 'string' || value.length < 10 || value.length > 200) throw new AppError(400, 'La contraseña debe tener entre 10 y 200 caracteres.'); return value; }
function issueSession(state) {
  const token = `aa_session_${state.username}.${randomBytes(32).toString('hex')}`;
  state.sessions = state.sessions.filter(s => s.expires > Date.now()).slice(-9);
  state.sessions.push({ digest: hash(token), expires: Date.now() + 12 * 3600000 });
  return token;
}
function profile(state) { return { name: state.name, username: state.username }; }
async function rate(req, purpose, max, interval) {
  const address = isCloud ? (req.headers['x-vercel-forwarded-for'] || req.headers['x-forwarded-for'] || 'unknown') : req.socket.remoteAddress;
  await mutate(`limits/${hash(`${purpose}:${address}`)}`, value => {
    value.times = value.times.filter(t => Date.now() - t < interval);
    if (value.times.length >= max) throw new AppError(429, 'Demasiados intentos. Espera unos minutos.');
    value.times.push(Date.now());
  }, { times: [] });
}
function credential(req) {
  const token = req.headers.authorization?.match(/^Bearer (aa_(?:live|session)_[a-z0-9_-]{3,32}\.[a-f0-9]{64})$/)?.[1];
  if (!token) throw new AppError(401, 'Inicia sesión o utiliza un token válido.');
  const [, type, handle] = token.match(/^aa_(live|session)_([a-z0-9_-]{3,32})\./);
  return { token, type, username: handle, digest: hash(token) };
}
function verify(state, auth, writeAccess = false, sessionOnly = false) {
  if (!state || state.username !== auth.username) throw new AppError(401, 'Acceso inválido.');
  const entry = auth.type === 'session' ? state.sessions.find(s => s.digest === auth.digest && s.expires > Date.now()) : state.tokens.find(t => t.digest === auth.digest);
  if (!entry) throw new AppError(401, 'Tu sesión o token dejó de estar activo.');
  if (sessionOnly && auth.type !== 'session' || writeAccess && auth.type === 'live' && entry.scope !== 'write') throw new AppError(403, 'No tienes permiso para esta operación.');
}
async function authenticate(req, sessionOnly = false) {
  const auth = credential(req); const record = await read(`accounts/${auth.username}`); verify(record?.value, auth, false, sessionOnly); return { auth, state: record.value };
}
async function changeAccount(auth, fn) { return mutate(`accounts/${auth.username}`, state => { verify(state, auth, true, true); return fn(state); }); }
async function authorizeWrite(auth) { const current = await read(`accounts/${auth.username}`); verify(current?.value, auth, true); }
export async function landingOperation(auth, name, input) {
  if (name === 'get_landing') return { ...((await read('landing'))?.value || emptyLanding()), url: site };
  await authorizeWrite(auth);
  if (!['update_landing', 'clear_landing'].includes(name)) throw new AppError(400, 'Operación desconocida.');
  const update = validateUpdate(name === 'clear_landing' ? { expectedRevision: input.expectedRevision, html: '', css: '', js: '', title: '' } : input);
  return mutate('landing', landing => {
    if (landing.revision !== update.expectedRevision) throw new AppError(409, 'Alguien cambió la landing. Vuelve a leerla antes de publicar.');
    const { expectedRevision, ...fields } = update;
    Object.assign(landing, fields, { revision: landing.revision + 1, updatedAt: date() });
    return { ...landing, url: site };
  }, emptyLanding());
}
export async function handleApi(req, res) {
  res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Vary', 'Origin');
  const origin = req.headers.origin;
  try {
    const localOrigin = !isCloud && /^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(origin || '');
    if (origin && !origins.has(origin) && !localOrigin) throw new AppError(403, 'Origen no autorizado.');
    if (origin) res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, Accept, MCP-Protocol-Version, MCP-Session-Id');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
    const url = new URL(req.url, 'http://localhost');
    const path = url.searchParams.has('route') ? `/api/${url.searchParams.get('route')}` : url.pathname;
    const method = req.method;
    if (path === '/api/status' && method === 'GET') { json(res, 200, { service: 'adversarial-acceleration', mode: isCloud ? 'cloud' : 'local', shared: true }); return; }
    if (path === '/api/landing' && method === 'GET') { json(res, 200, await landingOperation(null, 'get_landing', {})); return; }
    if (path === '/api/auth/register' && method === 'POST') {
      await rate(req, 'register', 12, 3600000);
      const input = await body(req); const handle = username(input.username); const pwd = password(input.password);
      const name = typeof input.name === 'string' ? input.name.trim() : handle;
      if (!name || name.length > 60) throw new AppError(400, 'Nombre inválido.');
      if (await read(`accounts/${handle}`)) throw new AppError(409, 'Ese usuario ya está registrado.');
      const salt = randomBytes(16).toString('hex');
      const state = { username: handle, name, salt, passwordHash: (await scrypt(pwd, salt, 64)).toString('hex'), createdAt: date(), sessions: [], tokens: [] };
      const session = issueSession(state);
      await write(`accounts/${handle}`, state);
      json(res, 201, { session, profile: profile(state) }); return;
    }
    if (path === '/api/auth/login' && method === 'POST') {
      await rate(req, 'login', 30, 900000);
      const input = await body(req); const handle = username(input.username); const pwd = password(input.password);
      const record = await read(`accounts/${handle}`);
      if (!record) { await scrypt(pwd, 'missing-account-timing', 64); throw new AppError(401, 'Usuario o contraseña incorrectos.'); }
      const candidate = await scrypt(pwd, record.value.salt, 64);
      if (!timingSafeEqual(candidate, Buffer.from(record.value.passwordHash, 'hex'))) throw new AppError(401, 'Usuario o contraseña incorrectos.');
      const session = await mutate(`accounts/${handle}`, state => issueSession(state));
      json(res, 200, { session, profile: profile(record.value) }); return;
    }
    const { auth, state } = await authenticate(req, path.startsWith('/api/tokens') || path.startsWith('/api/auth/') || path === '/api/me');
    if (path === '/api/me' && method === 'GET') { json(res, 200, { profile: profile(state) }); return; }
    if (path === '/api/auth/logout' && method === 'POST') {
      await changeAccount(auth, value => { value.sessions = value.sessions.filter(s => s.digest !== auth.digest); }); json(res, 200, { ok: true }); return;
    }
    if (path === '/api/tokens' && method === 'GET') { json(res, 200, { tokens: state.tokens.map(({ digest, ...token }) => token) }); return; }
    if (path === '/api/tokens' && method === 'POST') {
      const input = await body(req);
      if (typeof input.name !== 'string' || !input.name.trim() || input.name.length > 60 || !['read', 'write'].includes(input.scope)) throw new AppError(400, 'Nombre o permiso inválido.');
      const secret = `aa_live_${state.username}.${randomBytes(32).toString('hex')}`;
      const token = { id: random(), name: input.name.trim(), scope: input.scope, suffix: secret.slice(-6), createdAt: date(), digest: hash(secret) };
      await changeAccount(auth, value => { if (value.tokens.length >= 20) throw new AppError(400, 'Máximo 20 tokens activos.'); value.tokens.push(token); });
      json(res, 201, { token: secret, name: token.name }); return;
    }
    const tokenMatch = path.match(/^\/api\/tokens\/([a-f0-9]{24})\/revoke$/);
    if (tokenMatch && method === 'POST') { await changeAccount(auth, value => { value.tokens = value.tokens.filter(t => t.id !== tokenMatch[1]); }); json(res, 200, { ok: true }); return; }
    if (path === '/api/mcp') {
      if (auth.type !== 'live') throw new AppError(403, 'Conecta el MCP con un token de agente.');
      if (method !== 'POST') { res.setHeader('Allow', 'POST'); json(res, 405, { error: 'MCP usa POST con Streamable HTTP.' }); return; }
      const parsed = await body(req);
      const mcp = makeMcp((name, input) => landingOperation(auth, name, input));
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
      res.on('close', () => { transport.close(); mcp.close(); });
      await mcp.connect(transport); await transport.handleRequest(req, res, parsed); return;
    }
    if (path === '/api/landing' && method === 'PUT') { json(res, 200, await landingOperation(auth, 'update_landing', await body(req))); return; }
    if (path === '/api/landing/clear' && method === 'POST') { json(res, 200, await landingOperation(auth, 'clear_landing', await body(req))); return; }
    throw new AppError(404, 'Ruta no encontrada.');
  } catch (error) {
    if (!error.status) console.error('API error:', error.message);
    if (!res.headersSent) json(res, error.status || 500, { error: error.status ? error.message : 'No se pudo completar la operación. Inténtalo de nuevo.' }); else res.end();
  }
}
