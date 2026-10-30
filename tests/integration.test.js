import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

test('registration, shared edits, conflicts, scoped tokens, revocation, persistence and real MCP', async t => {
  const data = await mkdtemp(join(tmpdir(), 'aa-test-'));
  const port = 18000 + Math.floor(Math.random() * 10000);
  const base = `http://127.0.0.1:${port}`;
  let child;
  async function start() {
    child = spawn(process.execPath, ['server.js'], { cwd: new URL('..', import.meta.url), env: { ...process.env, PORT: String(port), AA_DATA_DIR: data, VERCEL: '' }, stdio: ['ignore', 'pipe', 'pipe'] });
    await Promise.race([once(child.stdout, 'data'), once(child, 'exit').then(() => { throw new Error('Server failed to start'); })]);
  }
  async function stop() { if (child && child.exitCode === null) { child.kill('SIGTERM'); await once(child, 'exit'); } }
  t.after(async () => { await stop(); await rm(data, { recursive: true, force: true }); });
  await start();
  async function api(path, method = 'GET', input, token, extra = {}) {
    const response = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...extra }, body: input === undefined ? undefined : JSON.stringify(input) });
    return { status: response.status, value: await response.json() };
  }
  const initial = await api('/api/landing'); assert.equal(initial.value.html, ''); assert.equal(initial.value.revision, 0);
  assert.equal((await api('/api/landing', 'PUT', { expectedRevision: 0, html: 'x' })).status, 401);
  assert.equal((await api('/api/status', 'GET', undefined, undefined, { Origin: 'https://untrusted.example' })).status, 403);
  const a = await api('/api/auth/register', 'POST', { username: 'tester_a', name: 'Tester A', password: 'test-only-password-123!' });
  const b = await api('/api/auth/register', 'POST', { username: 'tester_b', name: 'Tester B', password: 'test-only-password-456!' });
  assert.equal(a.status, 201); assert.equal(b.status, 201);
  assert.equal((await api('/api/auth/register', 'POST', { username: 'tester_a', password: 'another-password-123' })).status, 409);
  assert.equal((await api('/api/auth/login', 'POST', { username: 'tester_a', password: 'wrong-password-123' })).status, 401);
  const sa = a.value.session, sb = b.value.session;
  const writeToken = (await api('/api/tokens', 'POST', { name: 'MCP test', scope: 'write' }, sa)).value.token;
  const readToken = (await api('/api/tokens', 'POST', { name: 'Read test', scope: 'read' }, sa)).value.token;
  assert.equal((await api('/api/tokens', 'GET', undefined, writeToken)).status, 403);
  assert.equal((await api('/api/landing', 'PUT', { expectedRevision: 0, html: 'x' }, readToken)).status, 403);
  const first = await api('/api/landing', 'PUT', { expectedRevision: 0, title: 'Test', html: '<h1>Shared</h1>', css: 'h1{color:green}', js: '' }, writeToken);
  assert.equal(first.status, 200);
  const concurrent = await Promise.all([
    api('/api/landing', 'PUT', { expectedRevision: 1, html: '<p>Writer A</p>' }, sa),
    api('/api/landing', 'PUT', { expectedRevision: 1, html: '<p>Writer B</p>' }, sb)
  ]);
  assert.deepEqual(concurrent.map(r => r.status).sort(), [200, 409]);
  const client = new Client({ name: 'integration-test', version: '1.0.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(base + '/api/mcp'), { requestInit: { headers: { Authorization: `Bearer ${writeToken}` } } }));
  assert.deepEqual((await client.listTools()).tools.map(t => t.name), ['get_landing', 'update_landing', 'clear_landing']);
  const current = JSON.parse((await client.callTool({ name: 'get_landing', arguments: {} })).content[0].text);
  const edited = await client.callTool({ name: 'update_landing', arguments: { expectedRevision: current.revision, html: '<h1>Written by MCP</h1>' } });
  assert.equal(edited.isError, undefined);
  assert.equal((await api('/api/landing')).value.html, '<h1>Written by MCP</h1>');
  await client.close();
  const tokens = (await api('/api/tokens', 'GET', undefined, sa)).value.tokens;
  assert.ok(tokens.every(token => !token.digest));
  await api(`/api/tokens/${tokens.find(token => token.name === 'MCP test').id}/revoke`, 'POST', {}, sa);
  assert.equal((await api('/api/landing', 'PUT', { expectedRevision: 3, html: 'No' }, writeToken)).status, 401);
  await api('/api/auth/logout', 'POST', {}, sa);
  assert.equal((await api('/api/me', 'GET', undefined, sa)).status, 401);
  const raw = await readFile(join(data, 'accounts/tester_a.json'), 'utf8');
  assert.ok(!raw.includes('test-only-password-123!')); assert.ok(!raw.includes(readToken));
  await stop(); await start();
  assert.equal((await api('/api/landing')).value.html, '<h1>Written by MCP</h1>');
  assert.equal((await api('/api/auth/login', 'POST', { username: 'tester_a', password: 'test-only-password-123!' })).status, 200);
  assert.equal((await api('/api/landing/clear', 'POST', { expectedRevision: 3 }, sb)).status, 200);
  assert.equal((await api('/api/landing')).value.html, '');
});
