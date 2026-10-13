#!/usr/bin/env node
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { AlertBoard, isAlertId, parseAlert } from './alerts.mjs';
import { jsonPostAllowed, tokenMatches } from './guard.mjs';
import { handleMcp } from './mcp.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PAGE = fs.readFileSync(path.join(ROOT, 'frame.html'));
const MCP_BODY_MAX = 64 * 1024;

function readJson(req, limit) {
  const max = limit || 1024;
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > max) {
        reject(new Error('too big'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

function send(res, status, body, type, extra) {
  const headers = { 'content-type': type, 'cache-control': 'no-store', ...(extra || {}) };
  res.writeHead(status, headers);
  res.end(body);
}

function sendJson(res, status, body) {
  send(res, status, JSON.stringify(body), 'application/json; charset=utf-8');
}

export function createServer(options) {
  const token = options.token || '';
  const alerts = options.alerts;
  const now = options.now || (() => Date.now());

  function tokenOk(req, res) {
    if (!token || token.length < 16) {
      send(res, 404, 'Not found', 'text/plain; charset=utf-8');
      return false;
    }
    if (!tokenMatches(req.headers.authorization, token)) {
      sendJson(res, 401, { error: 'token' });
      return false;
    }
    return true;
  }

  return http.createServer(async (req, res) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/frame')) {
      send(res, 200, PAGE, 'text/html; charset=utf-8');
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/alerts') {
      sendJson(res, 200, alerts.publicBody());
      return;
    }
    if (req.method === 'POST' && url.pathname === '/mcp') {
      if (!jsonPostAllowed(req.headers)) {
        sendJson(res, 403, { error: 'not allowed' });
        return;
      }
      if (!tokenOk(req, res)) return;
      let message;
      try {
        message = await readJson(req, MCP_BODY_MAX);
      } catch {
        sendJson(res, 400, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
        return;
      }
      const answer = handleMcp(message, { alerts, now });
      if (!answer) {
        send(res, 202, '', 'text/plain; charset=utf-8');
        return;
      }
      sendJson(res, 200, answer);
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/alerts') {
      if (!jsonPostAllowed(req.headers)) {
        sendJson(res, 403, { error: 'not allowed' });
        return;
      }
      if (!tokenOk(req, res)) return;
      let raw;
      try {
        raw = await readJson(req);
      } catch {
        sendJson(res, 400, { error: 'json' });
        return;
      }
      const parsed = parseAlert(raw, now());
      if (parsed.error) {
        sendJson(res, 400, { error: parsed.error });
        return;
      }
      if (!alerts.allow(parsed.alert.source)) {
        sendJson(res, 429, { error: 'slow down' });
        return;
      }
      sendJson(res, 200, { id: alerts.add(parsed.alert).id });
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/alerts/dismiss') {
      if (!jsonPostAllowed(req.headers)) {
        sendJson(res, 403, { error: 'not allowed' });
        return;
      }
      let raw;
      try {
        raw = await readJson(req);
      } catch {
        sendJson(res, 400, { error: 'json' });
        return;
      }
      if (!raw || Object.keys(raw).length !== 1 || !isAlertId(raw.id)) {
        sendJson(res, 400, { error: 'id' });
        return;
      }
      alerts.dismiss(raw.id);
      send(res, 204, '', 'text/plain; charset=utf-8');
      return;
    }
    if (url.pathname === '/mcp') {
      send(res, 405, 'Method not allowed', 'text/plain; charset=utf-8', { allow: 'POST' });
      return;
    }
    send(res, 404, 'Not found', 'text/plain; charset=utf-8');
  });
}

function loadEnvFile() {
  const file = path.join(process.cwd(), '.env');
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 1) continue;
    const key = trimmed.slice(0, eq).trim();
    if (process.env[key] != null) continue;
    process.env[key] = trimmed.slice(eq + 1).trim();
  }
}

export function listen(options = {}) {
  loadEnvFile();
  const token = options.token ?? process.env.FRAME_NOTIFY_TOKEN ?? '';
  const host = options.host || process.env.FRAME_HOST || '127.0.0.1';
  const port = Number(options.port || process.env.FRAME_PORT || 8090);
  const file = options.file || process.env.FRAME_ALERTS_FILE || path.join(process.cwd(), 'data', 'alerts.json');
  const alerts = options.alerts || new AlertBoard({ file });
  const server = createServer({ token, alerts, now: options.now });
  return new Promise((resolve) => {
    server.listen(port, host, () => resolve(server));
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const server = await listen();
  const address = server.address();
  console.log('frame notifications on http://' + address.address + ':' + address.port + '/');
}
