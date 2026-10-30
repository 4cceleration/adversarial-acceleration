import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { updateSchema } from './schema.js';
export function makeMcp(call) {
  const server = new Server({ name: 'adversarial-acceleration', version: '0.1.0' }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [
    { name: 'get_landing', description: 'Read the ONE shared public landing page and its current revision. Every registered user edits this same page. Always read before changing it.', inputSchema: { type: 'object', properties: {}, additionalProperties: false }, annotations: { readOnlyHint: true } },
    { name: 'update_landing', description: 'Change the shared public homepage immediately, without Git or deployment. All visitors see the result. Read get_landing first and pass expectedRevision. Supply complete replacements for the fields you change; omitted fields stay unchanged. Self-contained HTML/CSS/JS only, no network, external dependencies, cookies or parent access. Use inline SVG and data-URL images. NEVER include credentials or private information.', inputSchema: updateSchema, annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false } },
    { name: 'clear_landing', description: 'Clear the shared public homepage for EVERYONE. Only use when the user explicitly asks to clear it. Requires the revision from get_landing.', inputSchema: { type: 'object', properties: { expectedRevision: { type: 'integer', minimum: 0 } }, required: ['expectedRevision'], additionalProperties: false }, annotations: { readOnlyHint: false, destructiveHint: true } }
  ] }));
  server.setRequestHandler(CallToolRequestSchema, async request => {
    try { const result = await call(request.params.name, request.params.arguments || {}); return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }; }
    catch (e) { return { isError: true, content: [{ type: 'text', text: e.status ? e.message : 'No se pudo completar la operación.' }] }; }
  });
  return server;
}
