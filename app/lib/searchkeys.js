'use strict';
// The optional search APIs of the research on the internet (SearXNG / Brave / Google Programmable Search): their
// addresses and keys, kept encrypted (lib/secrets.js), apart from the settings (which every screen reads). A key is
// never sent back to a screen, written to a log or put in a job of the queue: a computer that helps asks for them on its
// own authenticated line (server.js /api/worker/search-keys) and keeps them in memory only.
const store = require('./store');
const secrets = require('./secrets');

const KEY = 'search-keys';

function raw() { return store.read(KEY, null) || {}; }
/** The configuration for supplierfind.apiEngines, with the keys opened; only the providers switched on in the settings. */
function config() {
  const on = (require('./settings').all().webResearch || {}).apis || {};
  const r = raw();
  const open = (v) => { try { return v ? secrets.reveal(v) : ''; } catch (_) { return ''; } };
  const out = {};
  if (on.searxng && r.searxng && r.searxng.url) out.searxng = { url: r.searxng.url };
  if (on.brave && r.brave && r.brave.key) out.brave = { key: open(r.brave.key), perDay: r.brave.perDay || 60 };
  if (on.google && r.google && r.google.key && r.google.cx) out.google = { key: open(r.google.key), cx: r.google.cx, perDay: r.google.perDay || 90 };
  return out;
}
/** What a screen may see: which providers have an address / key, never the key itself. */
function view() {
  const r = raw();
  return { searxng: { url: (r.searxng && r.searxng.url) || '' }, brave: { set: !!(r.brave && r.brave.key), perDay: (r.brave && r.brave.perDay) || 60 }, google: { set: !!(r.google && r.google.key), cx: (r.google && r.google.cx) || '', perDay: (r.google && r.google.perDay) || 90 } };
}
/** p: { searxng: { url }, brave: { key, perDay }, google: { key, cx, perDay } } — an empty key leaves the old one, '-' removes it. */
function save(p) {
  const r = raw();
  const b = p || {};
  if (b.searxng) { const u = String(b.searxng.url || '').trim(); if (u && !/^https?:\/\/[^\s]+$/i.test(u)) throw new Error('Η διεύθυνση του SearXNG πρέπει να ξεκινά με http:// ή https://'); r.searxng = { url: u.replace(/\/+$/, '') }; }
  for (const id of ['brave', 'google']) {
    if (!b[id]) continue;
    const cur = r[id] || {};
    const k = String(b[id].key || '').trim();
    if (k === '-') delete cur.key; else if (k) cur.key = secrets.protect(k);
    if (id === 'google' && b.google.cx != null) cur.cx = String(b.google.cx).trim().slice(0, 100);
    if (b[id].perDay != null) cur.perDay = Math.max(1, Math.min(10000, Math.round(Number(b[id].perDay) || 0))) || undefined;
    r[id] = cur;
  }
  store.write(KEY, r);
  return view();
}

module.exports = { config, view, save };
