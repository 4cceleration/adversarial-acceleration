import { generateUsername } from '../docs/identity.js';
import { read, write } from './storage.js';
import { random, date, verify } from './accounts.js';
import { AppError } from './schema.js';

export function agentName(value) {
  const name = value === undefined ? generateUsername() : value;
  if (typeof name !== 'string' || !name.trim() || name.length > 60) throw new AppError(400, 'Nombre de agente inválido.');
  return name.trim();
}
export function agentSummary(agent) {
  return { id: agent.id, alias: agent.alias, name: agent.name, createdAt: agent.createdAt };
}
export function checkConnectionCapacity(state) {
  if (state.tokens.length >= 20) throw new AppError(400, 'Máximo 20 conexiones activas.');
  if (Object.keys(state.agents || {}).length >= 100) throw new AppError(400, 'Máximo 100 identidades de agente por cuenta.');
}
// Reserve the alias before changing the account. Reservations never expose an
// identity until the canonical account contains it; failed reservations stay private.
export async function reserveAgent(owner, name) {
  const generated = name === undefined;
  name = agentName(name);
  const chosen = !generated && /^[a-z]{3,32}$/.test(name);
  for (let attempt = 0; attempt < 15; attempt++) {
    const alias = chosen ? name : generateUsername();
    const agent = { id: random(), alias, name: generated ? alias : name, createdAt: date() };
    try { await write(`agent-aliases/${alias}`, { ...agent, owner }); return agent; }
    catch (error) {
      if (error.status !== 409) throw error;
      if (chosen) throw new AppError(409, 'Ese alias ya existe. Usa el dado para generar otro.');
    }
  }
  throw new AppError(503, 'No se pudo asignar un alias. Inténtalo de nuevo.');
}
export function attachAgent(state, agent) {
  checkConnectionCapacity(state);
  state.agents ||= {};
  if (state.agents[agent.id]) throw new AppError(409, 'El agente ya existe.');
  state.agents[agent.id] = agent;
}
export async function currentAgent(auth, agentId, writeAccess = false) {
  const state = (await read(`accounts/${auth.username}`))?.value;
  verify(state, auth, writeAccess);
  const token = auth.type === 'live' ? state.tokens.find(t => t.digest === auth.digest) : null;
  if (auth.type === 'live' && agentId && agentId !== token.agentId) throw new AppError(403, 'Solo puedes acceder al buzón de tu agente.');
  const id = token ? token.agentId : agentId;
  const agent = typeof id === 'string' && /^[a-f0-9]{24}$/.test(id) && Object.hasOwn(state.agents || {}, id) ? state.agents[id] : null;
  if (!agent) throw new AppError(404, 'Esta conexión no tiene un alias de agente. Crea una conexión nueva desde tu cuenta.');
  return agentSummary(agent);
}
export async function findAgent(alias) {
  if (typeof alias !== 'string' || !/^[a-z]{3,32}$/.test(alias)) throw new AppError(400, 'Indica el alias del agente.');
  const entry = (await read(`agent-aliases/${alias}`))?.value;
  const state = entry ? (await read(`accounts/${entry.owner}`))?.value : null;
  const agent = state?.agents?.[entry?.id];
  if (!agent || agent.alias !== alias) throw new AppError(404, 'Agente no encontrado.');
  const active = state.tokens.some(t => t.agentId === agent.id && t.digest && (!t.expires || t.expires > Date.now()));
  return { ...agentSummary(agent), active };
}
