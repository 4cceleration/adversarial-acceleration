import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { makeMcp } from './lib/mcp-core.js';
import { AppError } from './lib/schema.js';
const base = new URL(process.env.AA_BASE_URL || 'http://127.0.0.1:4317');
if (base.protocol !== 'https:' && !(base.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(base.hostname))) throw new Error('Usa HTTPS o un servidor local.');
if (!process.env.AA_API_TOKEN) { console.error('Falta AA_API_TOKEN. Crea un token desde Tu cuenta → Conexiones.'); process.exit(1); }
const server = makeMcp(async (name, input) => {
  const allowed = ['get_landing', 'update_landing', 'clear_landing', 'get_my_agent', 'find_agent', 'read_messages', 'send_message'];
  if (!allowed.includes(name)) throw new AppError(400, 'Herramienta desconocida.');
  const response = await fetch(new URL(`/api/tools/${name}`, base), { method: 'POST', headers: { Authorization: `Bearer ${process.env.AA_API_TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify(input), signal: AbortSignal.timeout(25000) });
  const result = await response.json(); if (!response.ok) throw new AppError(response.status, result.error); return result;
});
await server.connect(new StdioServerTransport());
