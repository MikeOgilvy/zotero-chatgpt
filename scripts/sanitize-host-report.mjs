import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const URL_KEY = /(?:url|uri|href|location|target|source)$/iu;
const EMBEDDED_URL = /\b[a-z][a-z0-9+.-]*:\/\/[^\s"'<>]+/giu;

export function sanitizeReportedWebURL(value) {
  try {
    const parsed = new URL(String(value || ''));
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') return `${parsed.origin}${parsed.pathname}`.slice(0, 320);
    if (parsed.protocol === 'about:' && parsed.pathname === 'blank') return 'about:blank';
    const scheme = parsed.protocol.replace(/:$/u, '').slice(0, 24) || 'unknown';
    return `[${scheme}-url-omitted]`;
  } catch { return null; }
}

export function sanitizeReportedText(value) {
  return String(value || '').replace(EMBEDDED_URL, candidate => sanitizeReportedWebURL(candidate) ?? '[url-omitted]');
}

export function sanitizeHostReport(report) {
  let redactedCount = 0;
  const visit = (value, key = '') => {
    if (Array.isArray(value)) return value.map(entry => visit(entry));
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([name, entry]) => [name, visit(entry, name)]));
    if (typeof value !== 'string') return value;
    let next = sanitizeReportedText(value);
    if (URL_KEY.test(key) && /^[a-z][a-z0-9+.-]*:/iu.test(next)) next = sanitizeReportedWebURL(next) ?? '[url-omitted]';
    if (next !== value) redactedCount += 1;
    return next;
  };
  return { report: visit(report), redactedCount };
}

export async function sanitizeHostReportFile(filePath) {
  const resolved = resolve(filePath); const original = JSON.parse(await readFile(resolved, 'utf8'));
  const sanitized = sanitizeHostReport(original);
  sanitized.report.reportRedaction = {
    schemaVersion: 1,
    sanitizedAt: new Date().toISOString(),
    fieldsChanged: sanitized.redactedCount,
    note: 'Web URLs retain only HTTP(S) origin and pathname. Query, fragment, userinfo, and unsupported-scheme values were removed without retaining their original values.',
  };
  await writeFile(resolved, JSON.stringify(sanitized.report, null, 2) + '\n');
  return sanitized.redactedCount;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length < 3) throw new Error('Pass one or more explicit host-report JSON paths.');
  for (const file of process.argv.slice(2)) console.log(`${file}: ${await sanitizeHostReportFile(file)} URL field(s) sanitized`);
}
