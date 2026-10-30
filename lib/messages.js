import { read, write, mutate } from './storage.js';
import { hash, date } from './accounts.js';
import { currentAgent, findAgent } from './agent-identity.js';
import { AppError } from './schema.js';

const mailboxLimit = 5000;
async function indexMessage(agentId, id) {
  await mutate(`mailboxes/${agentId}`, box => {
    if (box.ids.includes(id)) return;
    if (box.ids.length >= mailboxLimit) throw new AppError(409, 'El buzón alcanzó su límite de 5000 mensajes.');
    box.ids.push(id);
  }, { ids: [] });
}
function sameMessage(message, from, to, text) {
  if (message.from.id !== from.id || message.to.id !== to.id || message.text !== text) throw new AppError(409, 'Ese clientMessageId ya se utilizó para otro mensaje.');
  return message;
}
export async function sendMessage(auth, input) {
  const from = await currentAgent(auth, input.agentId, true);
  const text = typeof input.text === 'string' ? input.text.trim() : '';
  if (!text || text.length > 4000 || typeof input.clientMessageId !== 'string' || !/^[A-Za-z0-9_-]{8,100}$/.test(input.clientMessageId)) throw new AppError(400, 'Envía text (1–4000 caracteres) y un clientMessageId único (8–100 letras, números o guiones).');
  const to = await findAgent(input.to);
  if (to.id === from.id) throw new AppError(400, 'Elige otro agente como destinatario.');
  const id = hash(`${from.id}:${input.clientMessageId}`);
  const key = `messages/${id}`;
  const existing = (await read(key))?.value;
  if (existing) return sameMessage(existing, from, to, text);
  if (!to.active) throw new AppError(409, 'El agente destinatario no tiene una conexión activa.');
  await mutate(`message-limits/${from.id}`, value => {
    value.times = value.times.filter(t => Date.now() - t < 3600000);
    if (value.times.length >= 60) throw new AppError(429, 'Máximo 60 envíos por agente y hora.');
    value.times.push(Date.now());
  }, { times: [] });
  // Reserve both mailbox entries first. A failed write can be retried with the
  // same clientMessageId. Readers ignore empty reservations and check participants.
  await indexMessage(from.id, id);
  await indexMessage(to.id, id);
  const message = { id, from: { id: from.id, alias: from.alias }, to: { id: to.id, alias: to.alias }, text, createdAt: date() };
  try { await write(key, message); }
  catch (error) {
    if (error.status !== 409) throw error;
    return sameMessage((await read(key)).value, from, to, text);
  }
  return message;
}
export async function readMessages(auth, input = {}) {
  const agent = await currentAgent(auth, input.agentId);
  const limit = input.limit ?? 20;
  const cursor = input.cursor;
  if (!Number.isInteger(limit) || limit < 1 || limit > 50 || (cursor !== undefined && (!Number.isInteger(cursor) || cursor < 0))) throw new AppError(400, 'Paginación inválida. Usa limit de 1 a 50 y el nextCursor recibido.');
  const box = (await read(`mailboxes/${agent.id}`))?.value || { ids: [] };
  const end = Math.min(cursor ?? box.ids.length, box.ids.length);
  const start = Math.max(0, end - limit);
  const records = await Promise.all(box.ids.slice(start, end).reverse().map(id => read(`messages/${id}`)));
  const messages = records.map(record => record?.value).filter(message => message && (message.from.id === agent.id || message.to.id === agent.id));
  return { agent, messages, nextCursor: start || null };
}
