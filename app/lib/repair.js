'use strict';
// SF Κέντρο — safe self-repair (audit 23/11, phase 3). Only actions on the program's own running parts, every one
// reversible and harmless; never the shops' data (prices, codes, texts, photos), never settings, never code.
//
//   proof first: an action runs only when a real check (lib/health.js) says what is wrong
//   then the action (from the list below — nothing else can run)
//   then the same check again: «fixed» or «not fixed» goes into the log (lib/events.js) with the levels before / after
//   limits: each action rests 30 minutes after it ran, at most 4 times a day; a person can run one at once
const events = require('./events');

const COOL_MS = 30 * 60000;
const PER_DAY = 4;
const ran = {};          // action → [times]

/**
 * The allowed actions. when(h): does the health (health.view()) call for it? do(d): the action. check: which health
 * line proves it (checked again after). Each `d` comes from the program (server.js), so this file runs nothing itself.
 */
const ACTIONS = {
  'db-reconnect': { label: 'Νέα σύνδεση με τη βάση', check: 'db', when: (h) => h.db && h.db.level === 'crit', do: (d) => d.dbReconnect() },
  'save-retry': { label: 'Νέα προσπάθεια αποθήκευσης', check: 'save', when: (h) => h.save && (h.save.level === 'warn' || h.save.level === 'crit') && !/άλλαξε κάποιος|σταματημένη|δίσκο/.test(h.save.text), do: (d) => d.saveNow() },
  'queue-sweep': { label: 'Επιστροφή κολλημένων εργασιών στη σειρά', check: 'queue', when: (h) => h.queue && h.queue.level === 'crit' && /κολλημένες/.test(h.queue.text), do: (d) => d.sweepQueue() },
  'backup-now': { label: 'Ημερήσιο αντίγραφο τώρα', check: 'backup', when: (h) => h.backup && (h.backup.level === 'warn' || h.backup.level === 'crit') && !/δεν έχει ρυθμιστεί/.test(h.backup.text), do: (d) => d.backupNow() },
  'engine-rebuild': { label: 'Νέος υπολογισμός των στοιχείων των οθονών', check: 'engine', when: (h, d) => !!(d && d.engineError && d.engineError()), do: (d) => d.rebuild() },
};

function allowedNow(id, force) {
  const now = Date.now();
  const t = (ran[id] = (ran[id] || []).filter((x) => now - x < 864e5));
  if (t.length >= PER_DAY) return { ok: false, why: `έγινε ήδη ${PER_DAY} φορές σήμερα` };
  if (!force && t.length && now - t[t.length - 1] < COOL_MS) return { ok: false, why: 'έγινε πριν από λίγο (ξανά σε 30 λεπτά)' };
  return { ok: true };
}

/** Run one allowed action, then check again. d: { probe(), view(), dbReconnect(), saveNow(), sweepQueue(), backupNow(), rebuild(), engineError() } */
async function run(id, d, opts) {
  const a = ACTIONS[id];
  if (!a) throw new Error('Άγνωστη ενέργεια επισκευής (επιτρέπονται μόνο: ' + Object.keys(ACTIONS).join(', ') + ').');
  const o = opts || {};
  const can = allowedNow(id, o.force);
  if (!can.ok) return { id, ran: false, why: can.why };
  const before = levelOf(a, d);
  ran[id].push(Date.now());
  let error = '';
  try { await a.do(d); } catch (e) { error = String(e && e.message || e).slice(0, 200); }
  // the same check again: fixed or not, said with the evidence
  try { await d.probe(); } catch (_) { /* the check says it below */ }
  const after = levelOf(a, d);
  const fixed = !error && (after === 'ok' || (before === 'crit' && after === 'warn'));
  events.record({ severity: fixed ? 'info' : 'warn', service: 'health', code: 'REPAIR_' + id.toUpperCase().replace(/-/g, '_'),
    message: `${a.label}: ${fixed ? 'διορθώθηκε' : 'δεν διορθώθηκε'} (πριν ${before.toUpperCase()}, μετά ${after.toUpperCase()})${error ? ' — ' + error : ''}${o.by ? ' · από ' + o.by : ' · αυτόματα'}` });
  return { id, ran: true, label: a.label, before, after, fixed, error };
}
function levelOf(a, d) {
  if (a.check === 'engine') return d.engineError && d.engineError() ? 'crit' : 'ok';
  const h = d.view();
  return (h[a.check] && h[a.check].level) || 'unknown';
}

/** After each round of checks: every action the health calls for (within its limits). */
async function auto(d) {
  const h = d.view();
  const out = [];
  for (const [id, a] of Object.entries(ACTIONS)) {
    let need = false;
    try { need = a.when(h, d); } catch (_) { need = false; }
    if (!need) continue;
    out.push(await run(id, d));
  }
  return out;
}

/** For the screen: the allowed actions and when each last ran. */
function list() {
  return Object.entries(ACTIONS).map(([id, a]) => ({ id, label: a.label, lastAt: (ran[id] || []).length ? new Date(ran[id][ran[id].length - 1]).toISOString() : null, today: (ran[id] || []).filter((x) => Date.now() - x < 864e5).length }));
}
function resetLimits() { for (const k of Object.keys(ran)) delete ran[k]; }

module.exports = { ACTIONS, run, auto, list, resetLimits, COOL_MS, PER_DAY };
