import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

// Alerts an agent puts on the frame.
// whisper is a short line in the corner.
// nudge is a card with a yellow border that leaves on its own.
// urgent is the same card with a red bar, and it stays until someone taps it.
// The frame receives the text, the sender's display name, and the timing.

export const LEVELS = new Set(['whisper', 'nudge', 'urgent']);
const SOURCE_RE = /^[a-z0-9][a-z0-9-]{0,31}$/;
const ID_RE = /^[a-f0-9]{12}$/;
const TEXT_MAX = 140;
const TTL_MIN_S = 10;
const TTL_MAX_S = 60 * 60;
const DEFAULT_TTL_S = { whisper: 10 * 60, nudge: 60 };
const KEEP_MAX = 20;
const RATE_MAX = 30;
const RATE_MS = 60 * 1000;

const NAMES = {
  'claude-code': 'Claude Code',
  codex: 'Codex',
  'grok-build': 'Grok Build',
  'grok-bot': 'Grok Bot',
};

export function sourceName(id) {
  if (!id) return '';
  if (NAMES[id]) return NAMES[id];
  return id.split('-').map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
}

function cleanText(value) {
  return String(value == null ? '' : value)
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, TEXT_MAX)
    .trim();
}

export function isAlertId(value) {
  return typeof value === 'string' && ID_RE.test(value);
}

export function parseAlert(body, nowMs) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { error: 'the alert must be a JSON object' };
  const allowed = new Set(['text', 'level', 'source', 'ttl_s']);
  const extra = Object.keys(body).filter((key) => !allowed.has(key));
  if (extra.length) return { error: 'unknown field ' + extra.join(', ') };
  const text = cleanText(body.text);
  if (!text) return { error: 'text is required' };
  const level = body.level == null ? 'nudge' : String(body.level);
  if (!LEVELS.has(level)) return { error: 'level must be whisper, nudge or urgent' };
  const source = body.source == null ? '' : String(body.source).toLowerCase();
  if (source && !SOURCE_RE.test(source)) return { error: 'source must be lower case letters, digits and dashes, up to 32 characters' };
  let ttlS = DEFAULT_TTL_S[level] || 0;
  if (body.ttl_s != null && level !== 'urgent') {
    const n = Number(body.ttl_s);
    if (!Number.isInteger(n) || n < TTL_MIN_S || n > TTL_MAX_S) return { error: 'ttl_s must be a whole number from ' + TTL_MIN_S + ' to ' + TTL_MAX_S };
    ttlS = n;
  }
  return {
    alert: {
      id: randomBytes(6).toString('hex'),
      level,
      text,
      source,
      at: nowMs,
      expiresAt: level === 'urgent' ? null : nowMs + ttlS * 1000,
    },
  };
}

export class AlertBoard {
  constructor(options) {
    this.file = options.file;
    this.now = options.now || (() => Date.now());
    this.items = [];
    this.rate = new Map();
    this.loaded = false;
  }

  load() {
    if (this.loaded) return;
    this.loaded = true;
    if (!this.file) return;
    try {
      const saved = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      this.items = (Array.isArray(saved.items) ? saved.items : [])
        .filter((row) => row && isAlertId(row.id) && LEVELS.has(row.level) && typeof row.text === 'string')
        .slice(-KEEP_MAX);
    } catch {
      /* first run */
    }
  }

  save() {
    if (!this.file) return;
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const tmp = this.file + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify({ items: this.items }));
      fs.renameSync(tmp, this.file);
    } catch {
      /* keep the in-memory state */
    }
  }

  allow(source) {
    const key = source || '(none)';
    const now = this.now();
    const row = this.rate.get(key);
    if (!row || now - row.start >= RATE_MS) {
      this.rate.set(key, { start: now, count: 1 });
      return true;
    }
    row.count += 1;
    return row.count <= RATE_MAX;
  }

  add(alert) {
    this.load();
    this.prune();
    this.items.push(alert);
    while (this.items.length > KEEP_MAX) {
      const index = this.items.findIndex((row) => row.level !== 'urgent');
      this.items.splice(index === -1 ? 0 : index, 1);
    }
    this.save();
    return alert;
  }

  dismiss(id) {
    this.load();
    const before = this.items.length;
    this.items = this.items.filter((row) => row.id !== id);
    if (this.items.length === before) return false;
    this.save();
    return true;
  }

  prune() {
    const now = this.now();
    const before = this.items.length;
    this.items = this.items.filter((row) => row.expiresAt == null || row.expiresAt > now);
    if (this.items.length !== before) this.save();
  }

  publicBody() {
    this.load();
    this.prune();
    const now = this.now();
    return {
      alerts: this.items.slice().reverse().map((row) => ({
        id: row.id,
        level: row.level,
        text: row.text,
        source: sourceName(row.source),
        at: new Date(row.at).toISOString(),
        remainingMs: row.expiresAt == null ? null : Math.max(0, row.expiresAt - now),
        ttlMs: row.expiresAt == null ? null : row.expiresAt - row.at,
      })),
    };
  }
}
