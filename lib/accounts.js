import { randomBytes, createHash, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { read, mutate } from './storage.js';
import { AppError } from './schema.js';
import { isCloud, mcpResource } from './config.js';
export const scrypt = promisify(scryptCallback);
export const random = () => randomBytes(12).toString('hex');
export const hash = value => createHash('sha256').update(value).digest('hex');
export const date = () => new Date().toISOString();
export function username(value) { if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{3,32}$/.test(value)) throw new AppError(400, 'Usuario: 3 a 32 letras, números o guiones.'); return value.toLowerCase(); }
export function password(value) { if (typeof value !== 'string' || value.length < 10 || value.length > 200) throw new AppError(400, 'La contraseña debe tener entre 10 y 200 caracteres.'); return value; }
export function issueSession(state) {
  const token = `aa_session_${state.username}.${randomBytes(32).toString('hex')}`;
  state.sessions = state.sessions.filter(s => s.expires > Date.now()).slice(-9);
  state.sessions.push({ digest: hash(token), expires: Date.now() + 12 * 3600000 });
  return token;
}
export function profile(state) { return { name: state.name, username: state.username }; }
export async function rate(req, purpose, max, interval) {
  const address = isCloud ? (req.headers['x-vercel-forwarded-for'] || req.headers['x-forwarded-for'] || 'unknown') : req.socket.remoteAddress;
  await mutate(`limits/${hash(`${purpose}:${address}`)}`, value => {
    value.times = value.times.filter(t => Date.now() - t < interval);
    if (value.times.length >= max) throw new AppError(429, 'Demasiados intentos. Espera unos minutos.');
    value.times.push(Date.now());
  }, { times: [] });
}
export function credential(req) {
  const token = req.headers.authorization?.match(/^Bearer (aa_(?:live|session)_[a-z0-9_-]{3,32}\.[a-f0-9]{64})$/)?.[1];
  if (!token) throw new AppError(401, 'Inicia sesión o utiliza un token válido.');
  const [, type, handle] = token.match(/^aa_(live|session)_([a-z0-9_-]{3,32})\./);
  return { token, type, username: handle, digest: hash(token) };
}
export function verify(state, auth, writeAccess = false, sessionOnly = false) {
  if (!state || state.username !== auth.username) throw new AppError(401, 'Acceso inválido.');
  const entry = auth.type === 'session' ? state.sessions.find(s => s.digest === auth.digest && s.expires > Date.now()) : state.tokens.find(t => t.digest === auth.digest);
  if (!entry || (entry.expires && entry.expires <= Date.now())) throw new AppError(401, 'Tu sesión o token dejó de estar activo.');
  if (entry.kind === 'oauth' && entry.resource !== mcpResource) throw new AppError(401, 'Este acceso pertenece a otro recurso.');
  if (sessionOnly && auth.type !== 'session' || writeAccess && auth.type === 'live' && entry.scope !== 'write') throw new AppError(403, 'No tienes permiso para esta operación.');
}
export async function authenticate(req, sessionOnly = false) {
  const auth = credential(req); const record = await read(`accounts/${auth.username}`); verify(record?.value, auth, false, sessionOnly); return { auth, state: record.value };
}
export async function changeAccount(auth, fn) { return mutate(`accounts/${auth.username}`, state => { verify(state, auth, true, true); return fn(state); }); }
export async function authorizeWrite(auth) { const current = await read(`accounts/${auth.username}`); verify(current?.value, auth, true); }

export async function createAccount(handle, pwd, name = handle, kind = 'person') {
  handle = username(handle); pwd = password(pwd);
  if (await read(`accounts/${handle}`)) throw new AppError(409, 'Ese usuario ya está registrado.');
  const salt = randomBytes(16).toString('hex');
  return { username: handle, name, kind, salt, passwordHash: (await scrypt(pwd, salt, 64)).toString('hex'), createdAt: date(), sessions: [], tokens: [] };
}
export async function passwordAccount(handle, pwd) {
  handle = username(handle); pwd = password(pwd);
  const record = await read(`accounts/${handle}`);
  if (!record) { await scrypt(pwd, 'missing-account-timing', 64); throw new AppError(401, 'Usuario o contraseña incorrectos.'); }
  const candidate = await scrypt(pwd, record.value.salt, 64);
  if (!timingSafeEqual(candidate, Buffer.from(record.value.passwordHash, 'hex'))) throw new AppError(401, 'Usuario o contraseña incorrectos.');
  return record.value;
}
export function issueToken(state, name, scope) {
  if (state.tokens.length >= 20) throw new AppError(400, 'Máximo 20 conexiones activas.');
  const secret = `aa_live_${state.username}.${randomBytes(32).toString('hex')}`;
  state.tokens.push({ id: random(), name, scope, suffix: secret.slice(-6), createdAt: date(), digest: hash(secret) });
  return secret;
}
