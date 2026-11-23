'use strict';
// The program's data in the shared database (SFK_DATABASE_URL — Supabase): the live copy, the one source of truth.
// The same contract as lib/cloudsave.js (GitHub), which it replaces as the live copy:
//  • at start, before anything is answered, every data file is brought from the database to the program's folder;
//  • afterwards every file that changed (size / time on disk) is written back — over the version it was read at
//    (optimistic locking): if somebody else wrote it in between, nothing is overwritten and the screen says so;
//  • nothing is ever written before the data was read (a half-empty start must never replace the real data);
//  • the very first time, with an empty database, the data is brought once from GitHub (where it was kept until now);
//  • GitHub stays as a daily compressed copy (backup), when it is set (SFK_GITHUB_DATA / SFK_GITHUB_TOKEN).
const fs = require('fs');
const path = require('path');
const store = require('./store');
const db = require('./db');

const URL_ = String(process.env.SFK_DATABASE_URL || '').trim();
// kept in the database although the daily copies on a PC leave them out (as in the GitHub copy)
const KEEP = ['sessions', 'enrich-cache', 'types', 'accents', 'catalog-meta', 'derived-checks', 'derived-fixes', 'derived-words', 'derived-meta'];
const COMP = /^comp-[a-z0-9-]+$/i;
const NAME_OK = /^[a-z0-9][a-z0-9._-]{0,80}\.json$/i;
const EVERY = Math.max(10, Number(process.env.SFK_DB_SECONDS) || 30) * 1000;

const state = { enabled: !!URL_, where: 'βάση δεδομένων', loadedAt: null, savedAt: null, error: '', pending: false, blocked: false, files: 0, size: 0, sent: 0, sentSize: 0, conflicts: [], backupAt: null };
const known = new Map(); // 'name.json' → { version, size, mtimeMs }
let pool = null, restored = false, saving = null, changes = 0;

function statOf(f) { try { const s = fs.statSync(path.join(store.dir(), f)); return { size: s.size, mtimeMs: s.mtimeMs }; } catch (_) { return null; } }
const keepNames = () => { let extra = []; try { extra = fs.readdirSync(store.dir()).filter((f) => f.endsWith('.json') && COMP.test(f.slice(0, -5))).map((f) => f.slice(0, -5)); } catch (_) { /* none */ } return KEEP.concat(extra); };

async function getPool() { if (!pool) pool = await db.connect(URL_); return pool; }

/** At start: every data file from the database (or, the first time, from GitHub, and then into the database). */
async function restore() {
  if (!state.enabled) return null;
  for (let i = 0; ; i++) {
    try { const out = await restoreOnce(); restored = true; return out; } catch (e) {
      if (i >= 4) { state.blocked = true; state.error = 'Η βάση δεν διαβάστηκε: ' + e.message + ' Δεν αποθηκεύεται τίποτα μέχρι την επόμενη επανεκκίνηση, για να μη χαθούν τα δεδομένα.'; throw e; }
      await new Promise((x) => setTimeout(x, 3000 * (i + 1)));
    }
  }
}
async function restoreOnce() {
  const t0 = Date.now();
  const p = await getPool();
  const list = (await db.docList(p)).filter((d) => NAME_OK.test(d.name));
  // a restore from a dated copy of GitHub (SFK_RESTORE_FROM=backup-YYYY-MM-DD), once: it replaces what the database holds
  const gh0 = require('./cloudsave');
  if (gh0.RESTORE_FROM && gh0.status().enabled) {
    const mark = list.find((d) => d.name === 'restore-mark.json') ? JSON.parse((await db.docGet(p, 'restore-mark.json')).text || '{}') : {};
    if (mark.from !== gh0.RESTORE_FROM) {
      const r = await gh0.restoreFrom(gh0.RESTORE_FROM);
      if (!r || !r.files) throw new Error('Το αντίγραφο ' + gh0.RESTORE_FROM + ' δεν βρέθηκε ή είναι άδειο.');
      store.forgetAll();
      store.write('restore-mark', { from: gh0.RESTORE_FROM, at: new Date().toISOString() });
      // every file is written over the database's version at the next save
      for (const d of list) known.set(d.name, { version: d.version, size: -1, mtimeMs: -1 });
      console.log(`Database: restored from ${gh0.RESTORE_FROM} (${r.files} files); written into the database now.`);
      state.loadedAt = new Date().toISOString(); state.pending = true; changes++;
      return { files: r.files, restoredFrom: gh0.RESTORE_FROM };
    }
  }
  if (!list.length) {
    // the first time: what was kept in GitHub until now comes over once
    const gh = require('./cloudsave');
    let from = null;
    if (gh.status().enabled) { from = await gh.restore(); console.log(`Database: first start — ${from && from.files ? from.files + ' files brought from GitHub' : 'nothing in GitHub either'}.`); }
    state.loadedAt = new Date().toISOString();
    state.pending = true; changes++;
    return { files: 0, first: true, fromGithub: from ? from.files || 0 : 0 };
  }
  let size = 0;
  for (const d of list) {
    const r = await db.docGetRaw(p, d.name);
    if (!r) continue;
    const target = path.join(store.dir(), d.name), tmp = target + '.db-' + process.pid;
    fs.writeFileSync(tmp, r.buf); fs.renameSync(tmp, target);
    const st = statOf(d.name);
    known.set(d.name, { version: r.version, size: st.size, mtimeMs: st.mtimeMs });
    size += r.buf.length;
  }
  store.forgetAll();
  state.loadedAt = new Date().toISOString();
  state.files = list.length; state.size = size;
  return { files: list.length, size, ms: Date.now() - t0 };
}

/** Write back what changed since the last time (nothing is sent when nothing changed). */
function save(reason) {
  if (!state.enabled || state.blocked || !restored) return Promise.resolve(null);
  if (saving) return saving;
  const at = changes;
  saving = (async () => {
    const p = await getPool();
    const names = store.dataFiles(keepNames()).filter((f) => NAME_OK.test(f));
    let sent = 0, sentSize = 0;
    const conflicts = [];
    for (const f of names) {
      const st = statOf(f);
      if (!st || !st.size) continue;
      const k = known.get(f);
      if (k && k.size === st.size && k.mtimeMs === st.mtimeMs) continue;
      if (state.conflicts.includes(f)) continue; // somebody else changed it: not overwritten (see below)
      try {
        const buf = fs.readFileSync(path.join(store.dir(), f));
        const r = await db.docPutRaw(p, f, buf, k ? k.version : 0, reason || '');
        known.set(f, { version: r.version, size: st.size, mtimeMs: st.mtimeMs });
        sent++; sentSize += r.gz;
      } catch (e) {
        if (!e.conflict) throw e;
        // written by another program in between: kept as it is in the database; this copy is not written over it
        conflicts.push(f);
        console.error('database: ' + e.message);
        try { require('./events').record({ severity: 'error', service: 'db', code: 'DB_CONFLICT', message: e.message }); } catch (_) { /* fine */ }
      }
    }
    // files that are no longer in the folder (removed competitors…) leave the database too
    for (const f of [...known.keys()]) if (!names.includes(f) && !statOf(f)) { await db.docDelete(p, f); known.delete(f); }
    if (conflicts.length) { state.conflicts = [...new Set(state.conflicts.concat(conflicts))]; state.error = `Δεν γράφτηκαν ${conflicts.length} αρχεία: άλλαξαν στο μεταξύ από άλλο πρόγραμμα (${conflicts.slice(0, 3).join(', ')}). Κάνε επανεκκίνηση για να φορτωθούν τα νεότερα.`; }
    else state.error = '';
    state.savedAt = new Date().toISOString();
    state.files = known.size; state.sent = sent; state.sentSize = sentSize;
    state.pending = changes !== at;
    return { saved: true, files: known.size, sent, size: sentSize };
  })().catch((e) => { state.error = 'Βάση: ' + e.message; state.pending = true; console.error('database save:', e.message); try { require('./events').record({ severity: 'error', service: 'db', code: 'DB_SAVE_FAILED', message: e.message }); } catch (_) { /* fine */ } return { error: e.message }; })
    .finally(() => { saving = null; });
  return saving;
}

/** After the start: save after changes (every 30 s at most), and a daily copy to GitHub when it is set. */
function start() {
  if (!state.enabled) return;
  store.onWrite((name) => { if (name !== 'sessions') { changes++; state.pending = true; } });
  setInterval(() => { if (state.pending) save('αλλαγές'); }, EVERY).unref();
  setInterval(() => save('συνδέσεις'), 60 * 60000).unref();
  const gh = require('./cloudsave');
  if (gh.status().enabled) {
    const daily = async () => {
      // (the time of the last good copy is kept in the data: a restart does not make one more, nor forget it)
      if (!state.backupAt) { const m = store.read('backup-meta', null); if (m && m.at) state.backupAt = m.at; }
      const last = state.backupAt ? new Date(state.backupAt).getTime() : 0;
      if (Date.now() - last < 23 * 36e5 || !restored) return;
      gh.backupOnly();
      const r = await gh.save('ημερήσιο αντίγραφο');
      if (r && !r.error) { state.backupAt = new Date().toISOString(); require('./health').backupDone(state.backupAt); }
    };
    setTimeout(daily, 10 * 60000).unref();
    setInterval(daily, 60 * 60000).unref();
  }
}

function status() { return Object.assign({}, state, { tls: require('./db').tlsMode() }); }
/** The shared database's pool (the coordinator and the audit log use the same one). */
function poolNow() { return state.enabled ? getPool() : Promise.resolve(null); }

module.exports = { restore, save, start, status, poolNow, KEEP };
