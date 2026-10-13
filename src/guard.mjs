import { timingSafeEqual } from 'node:crypto';

export function tokenMatches(header, expected) {
  if (!expected || expected.length < 16) return false;
  const match = /^Bearer\s+(\S+)$/i.exec(String(header || ''));
  if (!match) return false;
  const given = Buffer.from(match[1]);
  const want = Buffer.from(expected);
  return given.length === want.length && timingSafeEqual(given, want);
}

// JSON posts only. A browser Origin must name this same host.
export function jsonPostAllowed(headers) {
  const type = String((headers && headers['content-type']) || '').split(';')[0].trim().toLowerCase();
  if (type !== 'application/json') return false;
  const origin = headers && headers.origin;
  if (!origin) return true;
  try {
    return new URL(origin).host === String(headers.host || '');
  } catch {
    return false;
  }
}
