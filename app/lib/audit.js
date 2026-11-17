'use strict';
// Who did what, and when: approvals, files, settings, users, computers. In the shared database when there is one
// (lib/db.js, table audit_log), else in the program's data folder (the newest 3.000). Never a password or a token.
const store = require('./store');

let poolP = null;
function usePool(p) { poolP = p; }
const SECRET = /pass|token|secret|key|code|pin|csrf|cookie/i;

/** A short, safe summary of a request body: counts instead of lists, no secrets. */
function summary(body) {
  const out = {};
  for (const [k, v] of Object.entries(body || {})) {
    if (SECRET.test(k)) continue;
    if (Array.isArray(v)) out[k] = v.length > 5 ? `${v.length} στοιχεία` : v.map((x) => (typeof x === 'object' ? '…' : String(x).slice(0, 60)));
    else if (v && typeof v === 'object') out[k] = '…';
    else if (v != null && v !== '') out[k] = String(v).slice(0, 120);
  }
  return out;
}

async function record(actor, action, target, detail) {
  const row = { at: new Date().toISOString(), actor: String(actor || 'πρόγραμμα').slice(0, 80), action: String(action).slice(0, 80), target: String(target || '').slice(0, 200), detail: detail || null };
  try {
    const pool = poolP ? await poolP : null;
    if (pool) { await require('./db').audit(pool, row.actor, row.action, row.target, row.detail); return; }
  } catch (e) { console.error('audit:', e.message); }
  store.update('audit-log', [], (l) => { l.unshift(row); return l.slice(0, 3000); });
}
async function list(n) {
  try {
    const pool = poolP ? await poolP : null;
    if (pool) return (await require('./db').auditList(pool, n || 200)).map((r) => ({ at: r.at, actor: r.actor, action: r.action, target: r.target, detail: r.detail }));
  } catch (e) { console.error('audit:', e.message); }
  return (store.read('audit-log', []) || []).slice(0, n || 200);
}

module.exports = { usePool, record, list, summary };
