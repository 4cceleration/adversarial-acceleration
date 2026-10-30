import { generateUsername, generatePassword } from '../docs/identity.js';
import { createAccount, passwordAccount, issueToken } from './accounts.js';
import { write, mutate } from './storage.js';
import { AppError } from './schema.js';
import { apiBase, site, mcpResource } from './config.js';
import { agentName, reserveAgent, attachAgent, agentSummary, checkConnectionCapacity } from './agent-identity.js';

function options(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new AppError(400, 'Envía un objeto JSON.');
  const name = agentName(input.name), scope = input.scope ?? 'write';
  if (typeof name !== 'string' || !name.trim() || name.length > 60 || !['read', 'write'].includes(scope)) throw new AppError(400, 'Nombre o permiso inválido.');
  return { name: name.trim(), scope };
}
function connection(handle, token, scope, agent) {
  return { username: handle, token, token_type: 'Bearer', scope, agent: agentSummary(agent), api_url: apiBase, mcp_url: mcpResource, site_url: site };
}
export async function registerAgent(input) {
  const { name, scope } = options(input);
  for (let attempt = 0; attempt < 10; attempt++) {
    const handle = generateUsername(), password = generatePassword();
    try {
      const state = await createAccount(handle, password, handle, 'agent');
      const agent = await reserveAgent(handle, input.name === undefined ? undefined : name);
      attachAgent(state, agent);
      const token = issueToken(state, agent.name, scope, agent.id);
      // Persist the account and token together; no temporary browser session is created.
      await write(`accounts/${handle}`, state);
      return { ...connection(handle, token, scope, agent), password };
    } catch (error) { if (error.status !== 409 || input.name !== undefined) throw error; }
  }
  throw new AppError(503, 'No se pudo asignar un alias. Inténtalo de nuevo.');
}
export async function loginAgent(input) {
  const { name, scope } = options(input);
  const state = await passwordAccount(input.username, input.password);
  checkConnectionCapacity(state);
  const agent = await reserveAgent(state.username, input.name === undefined ? undefined : name);
  const token = await mutate(`accounts/${state.username}`, current => {
    attachAgent(current, agent);
    return issueToken(current, agent.name, scope, agent.id);
  });
  return connection(state.username, token, scope, agent);
}
