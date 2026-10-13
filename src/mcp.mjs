import { isAlertId, parseAlert } from './alerts.mjs';

// MCP over streamable HTTP, JSON responses only. Notifications only:
// show an alert, take it down, and read what is on the frame.

export const PROTOCOL_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];
const SERVER_INFO = { name: 'frame-notify', title: 'Frame notifications', version: '0.1.0' };
const INSTRUCTIONS = 'Use frame_notify to put a short message on the wall frame, frame_dismiss to take it down, and frame_state to see the alerts that are up. '
  + 'Prefer whisper or nudge. Nudge is a yellow-bordered card that leaves on its own. Urgent is the same card with a red bar and it stays until someone taps it. '
  + 'Do not send secrets, prompts, commands, or file contents.';

export const TOOLS = [
  {
    name: 'frame_notify',
    title: 'Show an alert on the frame',
    description: 'Put a short message on the wall frame. whisper is a small line in the corner. nudge is a card with a yellow border that leaves on its own. '
      + 'urgent is the same card with a red bar and stays until someone taps it. Links and line breaks are removed. Returns the alert id.',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', maxLength: 140, description: 'The message, up to 140 characters.' },
        level: { type: 'string', enum: ['whisper', 'nudge', 'urgent'], description: 'Defaults to nudge.' },
        source: { type: 'string', pattern: '^[a-z0-9][a-z0-9-]{0,31}$', description: 'Who is sending it, for example claude-code.' },
        ttl_s: { type: 'integer', minimum: 10, maximum: 3600, description: 'Seconds on screen. Defaults to 600 for whisper and 60 for nudge. Urgent ignores it.' },
      },
      required: ['text'],
      additionalProperties: false,
    },
  },
  {
    name: 'frame_dismiss',
    title: 'Remove an alert',
    description: 'Take an alert off the frame by the id frame_notify returned.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string', pattern: '^[a-f0-9]{12}$', description: 'The 12-character id frame_notify returned.' } },
      required: ['id'],
      additionalProperties: false,
    },
  },
  {
    name: 'frame_state',
    title: 'Read alerts on the frame',
    description: 'The alerts on the frame now. Newest first.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
];

function reply(id, result) {
  return { jsonrpc: '2.0', id, result };
}

function failure(id, code, message) {
  return { jsonrpc: '2.0', id: id === undefined ? null : id, error: { code, message } };
}

function toolText(text, isError) {
  const result = { content: [{ type: 'text', text }] };
  if (isError) result.isError = true;
  return result;
}

function callTool(name, args, ctx) {
  const input = args && typeof args === 'object' && !Array.isArray(args) ? args : {};
  const now = ctx.now();
  if (name === 'frame_notify') {
    const parsed = parseAlert(input, now);
    if (parsed.error) return toolText(parsed.error, true);
    if (!ctx.alerts.allow(parsed.alert.source)) return toolText('Too many alerts from this source in the last minute. Try again shortly.', true);
    const alert = ctx.alerts.add(parsed.alert);
    const how = alert.expiresAt == null ? 'until someone taps it' : 'for ' + Math.round((alert.expiresAt - alert.at) / 1000) + ' s';
    return toolText('Shown as ' + alert.level + ' ' + how + '. Alert id ' + alert.id + '.');
  }
  if (name === 'frame_dismiss') {
    if (!isAlertId(input.id)) return toolText('id must be the 12-character id frame_notify returned', true);
    return ctx.alerts.dismiss(input.id) ? toolText('Removed.') : toolText('No alert with that id is on the frame.', true);
  }
  if (name === 'frame_state') {
    return toolText(JSON.stringify({ alerts: ctx.alerts.publicBody().alerts }));
  }
  return null;
}

export function handleMcp(message, ctx) {
  if (!message || typeof message !== 'object' || Array.isArray(message) || message.jsonrpc !== '2.0') {
    return failure(null, -32600, 'Invalid request');
  }
  const hasId = Object.prototype.hasOwnProperty.call(message, 'id');
  if (typeof message.method !== 'string') return hasId && ('result' in message || 'error' in message) ? null : failure(message.id, -32600, 'Invalid request');
  if (!hasId) return null;
  const id = message.id;
  const params = message.params && typeof message.params === 'object' ? message.params : {};
  switch (message.method) {
    case 'initialize': {
      const asked = typeof params.protocolVersion === 'string' ? params.protocolVersion : '';
      return reply(id, {
        protocolVersion: PROTOCOL_VERSIONS.indexOf(asked) !== -1 ? asked : PROTOCOL_VERSIONS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions: INSTRUCTIONS,
      });
    }
    case 'ping':
      return reply(id, {});
    case 'tools/list':
      return reply(id, { tools: TOOLS });
    case 'tools/call': {
      const result = callTool(String(params.name || ''), params.arguments, ctx);
      return result ? reply(id, result) : failure(id, -32602, 'Unknown tool: ' + String(params.name || ''));
    }
    default:
      return failure(id, -32601, 'Method not found: ' + message.method);
  }
}
