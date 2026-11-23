'use strict';
// SF Κέντρο — the health of the system, proved by real checks (audit 23/11): never green only because no error was
// written down. Four levels:
//   ok       — a real check passed lately (the database answered and a test write was read back, …)
//   warn     — it works with limits or old data (an old backup, one search engine paused, a catalog read in part)
//   crit     — a needed part fails or data may be lost (database not answering / not writing, a save conflict)
//   unknown  — no recent check: said so, never shown as fine
// probe() runs the checks (the database, the backup, the queue) — every 15 minutes by itself and with «Έλεγχος όλων»;
// view() puts the last results together, with when each was checked. Nothing here changes any data of the shops.
const store = require('./store');

const FRESH_MS = 30 * 60000;           // a check older than this is «unknown» again
const PROBE_DOC = '_health-probe';     // (no «.json»: never brought to the data folder, never in the backup)
const last = {};                       // id → { level, text, at, ms, evidence }

function set(id, level, text, evidence, ms) { last[id] = { level, text, at: new Date().toISOString(), ms: ms || 0, evidence: evidence || null }; return last[id]; }

/** The database: it answers (SELECT 1), a test document is written and read back, its size against the free plan. */
async function probeDb(pool) {
  if (!pool) return set('db', 'unknown', 'Δεν χρησιμοποιείται βάση δεδομένων (τα δεδομένα είναι σε αρχεία).');
  const db = require('./db');
  const t0 = Date.now();
  try {
    await pool.query('SELECT 1');
    const ping = Date.now() - t0;
    const cur = await db.docGetRaw(pool, PROBE_DOC);
    const stamp = new Date().toISOString();
    await db.docPutRaw(pool, PROBE_DOC, Buffer.from(JSON.stringify({ at: stamp })), cur ? cur.version : 0, 'έλεγχος υγείας');
    const back = await db.docGetRaw(pool, PROBE_DOC);
    const okRead = back && JSON.parse(back.buf.toString('utf8')).at === stamp;
    if (!okRead) return set('db', 'crit', 'Η βάση δέχτηκε την εγγραφή αλλά δεν τη διάβασε πίσω ίδια.', { ping }, Date.now() - t0);
    let sizeMB = 0;
    try { sizeMB = Math.round((await db.size(pool)) / 1048576); } catch (_) { /* not allowed: fine */ }
    const level = sizeMB > 480 ? 'crit' : sizeMB > 400 ? 'warn' : 'ok';
    return set('db', level, `Η βάση απαντά (${ping} ms), γράφει και διαβάζει σωστά${sizeMB ? ` · μέγεθος ${sizeMB} MB από 500 MB${level !== 'ok' ? ' — κοντά στο όριο του δωρεάν πλάνου' : ''}` : ''}.`, { ping, sizeMB }, Date.now() - t0);
  } catch (e) {
    if (e && e.conflict) return set('db', 'warn', 'Δοκιμαστική εγγραφή: άλλη εγγραφή στο μεταξύ (ξαναδοκιμάζει).', null, Date.now() - t0);
    return set('db', 'crit', 'Η βάση δεν απαντά ή δεν γράφει: ' + String(e && e.message || e).slice(0, 160), null, Date.now() - t0);
  }
}

/** The program's own saving to the database (or GitHub): last success, conflicts, a blocked start. */
function probeSave(saveStatus) {
  const c = saveStatus || {};
  if (!c.enabled) return set('save', 'warn', 'Τα δεδομένα μένουν μόνο στον δίσκο του διακομιστή (στο δωρεάν Render χάνονται σε κάθε επανεκκίνηση).');
  if (c.blocked) return set('save', 'crit', 'Η αποθήκευση είναι σταματημένη: ' + (c.error || 'τα δεδομένα δεν διαβάστηκαν στην εκκίνηση'));
  if ((c.conflicts || []).length) return set('save', 'crit', `Δεν γράφτηκαν ${c.conflicts.length} αρχεία (τα άλλαξε κάποιος άλλος στο μεταξύ): ${c.conflicts.slice(0, 3).join(', ')}.`);
  if (c.error) return set('save', 'crit', c.error);
  if (!c.savedAt) return set('save', process.uptime() < 600 ? 'unknown' : 'warn', process.uptime() < 600 ? 'Δεν έχει γίνει ακόμα αποθήκευση από την εκκίνηση (γίνεται μέσα σε λίγα λεπτά).' : 'Δεν έχει γίνει καμία αποθήκευση από την εκκίνηση.');
  const age = Date.now() - new Date(c.savedAt).getTime();
  if (c.pending && age > 10 * 60000) return set('save', 'warn', `Υπάρχουν αλλαγές που δεν έχουν σωθεί εδώ και ${Math.round(age / 60000)} λεπτά.`);
  return set('save', 'ok', `Σωσμένα στη ${c.where || 'αποθήκευση'}${c.savedAt ? ' · τελευταία φορά ' + new Date(c.savedAt).toLocaleTimeString('el-GR', { timeZone: 'Europe/Athens' }) : ''}.`);
}

/** The daily copy on GitHub: how old the last good one is (kept in the data, so it survives a restart). */
function probeBackup(ghEnabled) {
  if (!ghEnabled) return set('backup', 'warn', 'Δεν υπάρχει ημερήσιο αντίγραφο στο GitHub (δεν έχει ρυθμιστεί).');
  const m = store.read('backup-meta', null);
  if (!m || !m.at) return set('backup', 'unknown', 'Δεν έχει καταγραφεί ακόμα επιτυχημένο ημερήσιο αντίγραφο (γίνεται 10′ μετά την εκκίνηση και μετά μία φορά τη μέρα).');
  const h = (Date.now() - new Date(m.at).getTime()) / 36e5;
  const level = h > 72 ? 'crit' : h > 26 ? 'warn' : 'ok';
  return set('backup', level, `Τελευταίο ημερήσιο αντίγραφο στο GitHub πριν από ${h < 1 ? Math.round(h * 60) + ' λεπτά' : Math.round(h) + ' ώρες'}${level !== 'ok' ? ' — παλιό' : ''}.`, { hours: Math.round(h) });
}

/** The queue: work stuck (running with its lease long gone, waiting for days), failures of the last day. */
async function probeQueue(coord) {
  if (!coord) return set('queue', 'unknown', 'Η ουρά εργασιών δεν έχει ξεκινήσει ακόμα.');
  try {
    const q = await coord.healthOf();
    const level = q.stuck ? 'crit' : q.old || q.failed >= 5 ? 'warn' : 'ok';
    return set('queue', level, `${q.queued} σε αναμονή · ${q.running} τρέχουν` + (q.stuck ? ` · ${q.stuck} κολλημένες (έληξε ο χρόνος τους)` : '') + (q.old ? ` · ${q.old} περιμένουν πάνω από 2 μέρες` : '') + (q.failed ? ` · ${q.failed} απέτυχαν το τελευταίο 24ωρο` : '') + '.', q);
  } catch (e) { return set('queue', 'crit', 'Η ουρά δεν απαντά: ' + String(e.message || e).slice(0, 160)); }
}

/** All the checks that cost little (no AI: that one runs with «Έλεγχος όλων»). */
async function probe(deps) {
  const d = deps || {};
  await probeDb(d.pool || null);
  probeSave(d.saveStatus);
  probeBackup(!!d.ghEnabled);
  await probeQueue(d.coord || null);
  return view();
}

/** The last result of each check; one older than 30 minutes is «unknown» again. */
function view() {
  const out = {};
  for (const [id, r] of Object.entries(last)) out[id] = Date.now() - new Date(r.at).getTime() > FRESH_MS ? Object.assign({}, r, { level: 'unknown', text: 'Δεν έχει ελεγχθεί πρόσφατα (τελευταία: ' + r.text + ')' }) : r;
  return out;
}

/** Record a good daily copy (called by the program after it). */
function backupDone(at) { store.write('backup-meta', { at: at || new Date().toISOString() }); }

/** The worst of some levels (crit > warn > unknown > ok). */
function worst(levels) { const o = { crit: 3, warn: 2, unknown: 1, ok: 0 }; return levels.reduce((a, b) => (o[b] > o[a] ? b : a), 'ok'); }

module.exports = { probe, probeDb, probeSave, probeBackup, probeQueue, view, backupDone, worst, set, FRESH_MS, PROBE_DOC };
