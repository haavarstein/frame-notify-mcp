import assert from 'node:assert/strict';
import test from 'node:test';
import { AlertBoard } from '../src/alerts.mjs';
import { createServer } from '../src/server.mjs';

const TOKEN = '0123456789abcdef';

function start() {
  const alerts = new AlertBoard({ file: '', now: () => Date.parse('2026-10-12T14:00:00Z') });
  const server = createServer({ token: TOKEN, alerts, now: () => Date.parse('2026-10-12T14:00:00Z') });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port, alerts }));
  });
}

async function post(port, pathname, body, token) {
  const headers = { 'content-type': 'application/json' };
  if (token) headers.authorization = 'Bearer ' + token;
  const res = await fetch('http://127.0.0.1:' + port + pathname, { method: 'POST', headers, body: JSON.stringify(body) });
  const text = await res.text();
  return { status: res.status, text };
}

test('the frame page and alert read need no token, and notify requires one', async () => {
  const { server, port } = await start();
  try {
    const page = await fetch('http://127.0.0.1:' + port + '/');
    assert.equal(page.status, 200);
    assert.match(await page.text(), /api\/alerts/);
    const open = await fetch('http://127.0.0.1:' + port + '/api/alerts');
    assert.deepEqual(await open.json(), { alerts: [] });
    const missing = await post(port, '/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/list' });
    assert.equal(missing.status, 401);
    const listed = await post(port, '/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/list' }, TOKEN);
    assert.equal(listed.status, 200);
    assert.match(listed.text, /frame_notify/);
    const shown = await post(port, '/api/alerts', { text: 'Backup finished', level: 'nudge', source: 'grok-build' }, TOKEN);
    assert.equal(shown.status, 200);
    const id = JSON.parse(shown.text).id;
    const live = await fetch('http://127.0.0.1:' + port + '/api/alerts').then((res) => res.json());
    assert.equal(live.alerts[0].text, 'Backup finished');
    assert.equal(live.alerts[0].source, 'Grok Build');
    const gone = await post(port, '/api/alerts/dismiss', { id });
    assert.equal(gone.status, 204);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('an unset token hides the notify endpoints', async () => {
  const alerts = new AlertBoard({ file: '' });
  const server = createServer({ token: '', alerts });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  try {
    const hidden = await post(port, '/mcp', { jsonrpc: '2.0', id: 1, method: 'ping' }, TOKEN);
    assert.equal(hidden.status, 404);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
