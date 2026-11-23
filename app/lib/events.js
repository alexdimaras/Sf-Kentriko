'use strict';
// SF Κέντρο — one log of what went wrong (or needs a look), from every part of the program, in one shape:
//   { id, at, severity: info|warn|error, service: server|queue|db|health|ai|search|worker|engine, code, message,
//     jobId, rid (the request it happened in), count (the same thing again within a minute), last, rev }
// so that from one error one finds the part, the job, the cause and the request (audit 23/11, phase 2).
//
// Safe by construction: every text goes through redact() (tokens, passwords, keys, cookies, database addresses, e-mail
// addresses never stay); kept 14 days / 2.000 events at most; written to the data every minute (not on every event).
const store = require('./store');

const KEY = 'events';
const MAX = 2000;
const DAYS = 14;
const SERVICES = new Set(['server', 'queue', 'db', 'health', 'ai', 'search', 'worker', 'engine', 'backup']);
let list = null;     // newest last
let dirty = false;
let seq = 0;
let rev = '';

/** No secret and no personal address ever stays in a text of the log. */
function redact(s, max) {
  return String(s == null ? '' : s)
    .replace(/\b(postgres(?:ql)?|mysql|mongodb(?:\+srv)?):\/\/[^\s'"]+/gi, '$1://[κρυφό]')
    .replace(/\bsfkw_[A-Za-z0-9_-]+/g, 'sfkw_[κρυφό]')
    .replace(/\b(gh[pousr]_[A-Za-z0-9]{10,}|github_pat_[A-Za-z0-9_]{10,})/g, '[κρυφό token]')
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi, '$1 [κρυφό]')
    .replace(/\b(password|passwd|pwd|secret|token|api[_-]?key|apikey|key|cookie|authorization|sfk_sid)\s*[=:]\s*["']?[^\s"'&,;]+/gi, '$1=[κρυφό]')
    .replace(/([?&](?:key|token|t|k|sig|signature|api_key|access_token)=)[^&\s#]+/gi, '$1[κρυφό]')
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[email]')
    .slice(0, max || 600);
}

function load() {
  if (list) return list;
  const d = store.read(KEY, null);
  list = Array.isArray(d && d.items) ? d.items : [];
  return list;
}
function prune() {
  const cut = Date.now() - DAYS * 864e5;
  const l = load();
  let i = 0;
  while (i < l.length && (new Date(l[i].last || l[i].at).getTime() < cut)) i++;
  if (i) l.splice(0, i);
  if (l.length > MAX) l.splice(0, l.length - MAX);
}
function setRev(r) { rev = String(r || '').slice(0, 20); }

/**
 * Write down one event. e: { severity, service, code, message, jobId, rid, detail } → the event.
 * The same service + code + message again within a minute raises its count (a loop never floods the log).
 */
function record(e) {
  const x = e || {};
  const l = load();
  const severity = ['info', 'warn', 'error'].includes(x.severity) ? x.severity : 'error';
  const service = SERVICES.has(x.service) ? x.service : 'server';
  const code = String(x.code || 'UNKNOWN').toUpperCase().replace(/[^A-Z0-9_]/g, '_').slice(0, 40);
  const message = redact(x.message || code);
  const now = new Date().toISOString();
  const prev = l[l.length - 1] && l.slice(-20).reverse().find((y) => y.service === service && y.code === code && y.message === message && Date.now() - new Date(y.last || y.at).getTime() < 60000);
  if (prev) { prev.count = (prev.count || 1) + 1; prev.last = now; dirty = true; return prev; }
  const ev = { id: Date.now().toString(36) + (++seq).toString(36), at: now, severity, service, code, message, count: 1, last: now, rev };
  if (x.jobId) ev.jobId = String(x.jobId).slice(0, 40);
  if (x.rid) ev.rid = String(x.rid).slice(0, 20);
  if (x.detail != null) ev.detail = redact(typeof x.detail === 'string' ? x.detail : JSON.stringify(x.detail)).slice(0, 400);
  l.push(ev);
  dirty = true;
  if (l.length > MAX + 100) prune();
  return ev;
}

/** The events, newest first. q: { severity, service, code, since (ISO), limit } */
function query(q) {
  const o = q || {};
  const sev = { info: 0, warn: 1, error: 2 };
  const min = sev[o.severity] != null ? sev[o.severity] : 0;
  const since = o.since ? new Date(o.since).getTime() : 0;
  const out = [];
  const l = load();
  for (let i = l.length - 1; i >= 0 && out.length < Math.min(500, Number(o.limit) || 100); i--) {
    const e = l[i];
    if (sev[e.severity] < min) continue;
    if (o.service && e.service !== o.service) continue;
    if (o.code && e.code !== String(o.code).toUpperCase()) continue;
    if (since && new Date(e.last || e.at).getTime() < since) continue;
    out.push(e);
  }
  return out;
}

/** Counts of the last day: by service and severity, and the most frequent codes. */
function summary() {
  const cut = Date.now() - 864e5;
  const by = {}, codes = new Map();
  for (const e of load()) {
    if (new Date(e.last || e.at).getTime() < cut) continue;
    const k = e.service + ':' + e.severity;
    by[k] = (by[k] || 0) + (e.count || 1);
    const c = e.service + ':' + e.code;
    codes.set(c, (codes.get(c) || 0) + (e.count || 1));
  }
  return { by, top: [...codes].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([k, n]) => ({ key: k, n })) };
}

/** Keep what changed (every minute from the program, and at its end). */
function flush() {
  if (!dirty) return false;
  prune();
  store.write(KEY, { v: 1, items: load() });
  dirty = false;
  return true;
}
function reset() { list = []; dirty = true; flush(); }

module.exports = { record, query, summary, flush, redact, setRev, reset, KEY };
