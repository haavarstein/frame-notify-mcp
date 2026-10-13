import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { AlertBoard } from '../src/alerts.mjs';
import { handleMcp, PROTOCOL_VERSIONS, TOOLS } from '../src/mcp.mjs';

const NOW = Date.parse('2026-10-12T14:00:00Z');

function context() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'frame-notify-'));
  const now = () => NOW;
  return {
    alerts: new AlertBoard({ file: path.join(dir, 'alerts.json'), now }),
    now,
  };
}

function call(ctx, name, args, id) {
  return handleMcp({ jsonrpc: '2.0', id: id || 1, method: 'tools/call', params: { name, arguments: args } }, ctx);
}

test('initialize agrees on a known protocol version and offers tools only', () => {
  const ctx = context();
  const known = handleMcp({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } } }, ctx);
  assert.equal(known.result.protocolVersion, '2025-06-18');
  assert.equal(known.result.serverInfo.name, 'frame-notify');
  const unknown = handleMcp({ jsonrpc: '2.0', id: 'a', method: 'initialize', params: { protocolVersion: '1999-01-01' } }, ctx);
  assert.equal(unknown.result.protocolVersion, PROTOCOL_VERSIONS[0]);
});

test('tools/list names the three notification tools', () => {
  const list = handleMcp({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, context()).result.tools;
  assert.deepEqual(list.map((tool) => tool.name), ['frame_notify', 'frame_dismiss', 'frame_state']);
  TOOLS.forEach((tool) => {
    assert.equal(tool.inputSchema.additionalProperties, false);
  });
});

test('frame_notify puts an alert up, frame_state shows it, and frame_dismiss takes it down', () => {
  const ctx = context();
  const shown = call(ctx, 'frame_notify', { text: 'Build is green', level: 'whisper', source: 'claude-code' });
  assert.equal(shown.result.isError, undefined);
  const id = /Alert id ([a-f0-9]{12})/.exec(shown.result.content[0].text)[1];
  assert.match(shown.result.content[0].text, /whisper for 600 s/);
  const state = JSON.parse(call(ctx, 'frame_state', {}).result.content[0].text);
  assert.equal(state.alerts[0].id, id);
  assert.equal(state.alerts[0].source, 'Claude Code');
  assert.equal(call(ctx, 'frame_dismiss', { id }).result.content[0].text, 'Removed.');
  assert.equal(call(ctx, 'frame_dismiss', { id }).result.isError, true);
  assert.deepEqual(ctx.alerts.publicBody().alerts, []);
});

test('an urgent alert stays until someone taps it, and a bad level is a tool error', () => {
  const ctx = context();
  const text = call(ctx, 'frame_notify', { text: 'Door left open', level: 'urgent' }).result.content[0].text;
  assert.match(text, /^Shown as urgent until someone taps it\./);
  const bad = call(ctx, 'frame_notify', { text: 'x', level: 'siren' });
  assert.equal(bad.result.isError, true);
  for (let i = 0; i < 30; i++) call(ctx, 'frame_notify', { text: 'n' + i, source: 'codex' });
  assert.match(call(ctx, 'frame_notify', { text: 'one more', source: 'codex' }).result.content[0].text, /Too many alerts/);
});

test('unknown tools and extra fields are refused', () => {
  const ctx = context();
  assert.equal(call(ctx, 'frame_reboot', {}).error.code, -32602);
  assert.equal(call(ctx, 'frame_notify', { text: 'hi', prompt: 'secret' }).result.isError, true);
});
