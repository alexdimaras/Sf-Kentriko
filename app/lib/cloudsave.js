'use strict';
// Data that survives restarts on a free cloud host (Render's disk is wiped at every restart): the data folder is
// kept in a PRIVATE GitHub repository of the shop, ONE COMPRESSED FILE PER DATA FILE (data/<name>.json.gz).
//  • a save sends only the files that changed since the last one (a decision: a few KB — not the 60 MB of products);
//  • the results the screens need (checks, ready fixes) are saved too, so a restart loads them instead of
//    calculating them again for minutes;
//  • every save replaces the previous one (one commit without history), so the repository stays small;
//  • it is read back at start, saved a few minutes after every change and when the host stops the program.
//   SFK_GITHUB_DATA  = owner/repository (private), e.g. alexdimaras/sf-kentro-data
//   SFK_GITHUB_TOKEN = a fine-grained token with "Contents: read and write" on that repository only
const fs = require('fs');
const path = require('path');
const os = require('os');
const zlib = require('zlib');
const { pipeline } = require('stream/promises');
const { Readable } = require('stream');
const store = require('./store');

const REPO = String(process.env.SFK_GITHUB_DATA || '').trim().replace(/^https?:\/\/github\.com\//i, '').replace(/\.git$/i, '').replace(/\/+$/, '');
const TOKEN = String(process.env.SFK_GITHUB_TOKEN || '').trim();
const API = String(process.env.SFK_GITHUB_API || 'https://api.github.com').replace(/\/+$/, '');
const BRANCH = String(process.env.SFK_GITHUB_BRANCH || 'main').trim();
const DIR = 'data';
const FILE = 'sf-kentro-data.json.gz'; // the previous way (everything in one file): read once, replaced at the next save
// kept in the cloud although the daily copies on a PC leave them out: the open sessions (a restart does not sign
// everybody out), what was found at the suppliers, what was learned from the catalog, the results of the screens
const KEEP = ['sessions', 'enrich-cache', 'types', 'accents', 'catalog-meta', 'derived-checks', 'derived-fixes', 'derived-words', 'derived-meta'];
// …and the competitors' catalogs as they were last read (comp-<id>): on a host whose disk is wiped at every restart the
// daily research then goes on from where it was, instead of downloading every shop again
const COMP = /^comp-[a-z0-9]+$/i;
const keepNames = () => { let extra = []; try { extra = require('fs').readdirSync(store.dir()).filter((f) => f.endsWith('.json') && COMP.test(f.slice(0, -5))).map((f) => f.slice(0, -5)); } catch (_) { /* no folder yet */ } return KEEP.concat(extra); };
const EVERY = Math.max(1, Number(process.env.SFK_GITHUB_MINUTES) || 2) * 60000; // a save sends only what changed, so it can be frequent
const NAME_OK = /^[a-z0-9][a-z0-9._-]{0,80}\.json$/i;

// blocked: the saved data could not be read at start → nothing is saved over it (an empty start must never replace it)
const state = { enabled: !!(REPO && TOKEN), repo: REPO, loadedAt: null, savedAt: null, error: '', pending: false, blocked: false, files: 0, size: 0, sent: 0, sentSize: 0 };
// what GitHub holds for each file, and how the file on disk looked then (size and time): the same → not sent again
const known = new Map(); // 'name.json' → { sha, gz, size, mtimeMs }
let changes = 0;
let saving = null;
let restored = false; // nothing is ever saved before the saved data was read (a half-empty disk must not replace it)
// data saved the previous way (one file) stays in the repository, untouched, until a start has read the parts back
let oldKeep = null;

function check() {
  if (!/^[\w.-]+\/[\w.-]+$/.test(REPO)) throw new Error('SFK_GITHUB_DATA: γράψε το αποθετήριο ως όνομα/αποθετήριο, π.χ. alexdimaras/sf-kentro-data.');
}
const HEADERS = (accept, json) => Object.assign({ Authorization: 'Bearer ' + TOKEN, 'User-Agent': 'sf-kentro', Accept: accept || 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' }, json ? { 'Content-Type': 'application/json' } : {});
async function denied(r) {
  if (r.status === 401) throw new Error('GitHub: το κλειδί (token) δεν ισχύει ή έληξε. Φτιάξε νέο και βάλ’ το στο SFK_GITHUB_TOKEN.');
  if (r.status === 403) { const t = await r.text(); throw new Error('GitHub: δεν επιτρέπεται (' + t.slice(0, 120) + '). Το κλειδί θέλει «Contents: Read and write» σε αυτό το αποθετήριο.'); }
  return r;
}
async function gh(method, p, body, accept) {
  // a request that never ends must not hold the save (or the start) for ever
  const r = await fetch(API + p, { method, headers: HEADERS(accept, !!body), body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(120000) });
  return denied(r);
}
function tmpFile() { return path.join(os.tmpdir(), `sfk-cloud-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.gz`); }
function statOf(f) { try { const s = fs.statSync(path.join(store.dir(), f)); return { size: s.size, mtimeMs: s.mtimeMs }; } catch (_) { return null; } }

// ---------- at start: the data saved last time ----------
/** At start, before anything else: the data saved last time (nothing when this is the first start). */
async function restore() {
  if (!state.enabled) return null;
  for (let i = 0; ; i++) {
    try { const out = await restoreOnce(); restored = true; return out; } catch (e) {
      if (i >= 4) { state.blocked = true; state.error = e.message + ' Δεν αποθηκεύεται τίποτα μέχρι την επόμενη επανεκκίνηση, για να μη χαθούν τα σωσμένα δεδομένα.'; throw e; }
      await new Promise((x) => setTimeout(x, 3000 * (i + 1)));
    }
  }
}
async function restoreOnce() {
  check();
  const t0 = Date.now();
  const tr = await gh('GET', `/repos/${REPO}/git/trees/${encodeURIComponent(BRANCH)}?recursive=1`);
  // an empty repository (409) or no such branch yet (404): the first start
  if (tr.status === 404 || tr.status === 409) { state.loadedAt = new Date().toISOString(); return { files: 0, first: true }; }
  if (!tr.ok) throw new Error(`GitHub: δεν διαβάστηκαν τα δεδομένα (${tr.status}).`);
  const tree = ((await tr.json()).tree || []).filter((e) => e.type === 'blob');
  const parts = tree.filter((e) => e.path.startsWith(DIR + '/') && e.path.endsWith('.gz') && NAME_OK.test(e.path.slice(DIR.length + 1, -3)) && (store.kept(e.path.slice(DIR.length + 1, -3), KEEP) || COMP.test(e.path.slice(DIR.length + 1, -8))));
  if (!parts.length) {
    const old = tree.find((e) => e.path === FILE);
    if (old) { const out = await restoreOld(); oldKeep = old.sha; return out; }
    state.loadedAt = new Date().toISOString();
    return { files: 0, first: true };
  }
  // three at a time, each straight from the network to the disk (never a whole file in memory)
  let size = 0, next = 0;
  const one = async () => {
    for (;;) {
      const e = parts[next++];
      if (!e) return;
      const name = e.path.slice(DIR.length + 1, -3);
      const r = await fetch(`${API}/repos/${REPO}/git/blobs/${e.sha}`, { headers: HEADERS('application/vnd.github.raw+json'), signal: AbortSignal.timeout(300000) });
      await denied(r);
      if (!r.ok) throw new Error(`GitHub: δεν διαβάστηκε το ${name} (${r.status}).`);
      const target = path.join(store.dir(), name), tmp = target + '.cloud-' + process.pid;
      try { await pipeline(Readable.fromWeb(r.body), zlib.createGunzip(), fs.createWriteStream(tmp)); fs.renameSync(tmp, target); } catch (err) { try { fs.unlinkSync(tmp); } catch (_) { /* none */ } throw new Error(`GitHub: το ${name} δεν διαβάστηκε ολόκληρο (${err.message}).`); }
      const st = statOf(name);
      known.set(name, { sha: e.sha, gz: e.size || 0, size: st.size, mtimeMs: st.mtimeMs });
      size += e.size || 0;
    }
  };
  await Promise.all([one(), one(), one()]);
  store.forgetAll();
  state.loadedAt = new Date().toISOString();
  state.files = parts.length; state.size = size;
  return { files: parts.length, size, ms: Date.now() - t0 };
}
/** The previous way: everything in one compressed file. Read as before; the next save writes the parts. */
async function restoreOld() {
  const r = await gh('GET', `/repos/${REPO}/contents/${FILE}?ref=${encodeURIComponent(BRANCH)}`, null, 'application/vnd.github.raw');
  if (r.status === 404) { state.loadedAt = new Date().toISOString(); return { files: 0, first: true }; }
  if (!r.ok) throw new Error(`GitHub: δεν διαβάστηκαν τα δεδομένα (${r.status}).`);
  const tmp = tmpFile();
  try {
    await pipeline(Readable.fromWeb(r.body), fs.createWriteStream(tmp));
    const out = await store.restoreFile(null, { allow: KEEP, fresh: true, file: tmp });
    state.loadedAt = new Date().toISOString();
    state.pending = true; // not yet in parts: the first save sends them
    return Object.assign(out, { old: true });
  } finally { try { fs.unlinkSync(tmp); } catch (_) { /* gone */ } }
}

// ---------- saving ----------
/**
 * A file sent to GitHub inside JSON (base64) without ever holding it in memory: the JSON is written in pieces,
 * the file read 3 MB at a time (whole groups of 3 bytes, so the base64 pieces join exactly).
 */
function sendFile(method, p, before, file, after) {
  const size = fs.statSync(file).size;
  const head = Buffer.from(before), tail = Buffer.from(after);
  const u = new URL(API + p);
  const mod = u.protocol === 'https:' ? require('https') : require('http');
  return new Promise((resolve, reject) => {
    const req = mod.request(u, { method, headers: Object.assign(HEADERS(null, true), { 'Content-Length': head.length + Math.ceil(size / 3) * 4 + tail.length }) }, (res) => {
      const ch = [];
      res.on('data', (c) => ch.push(c));
      res.on('end', () => {
        const text = Buffer.concat(ch).toString('utf8');
        resolve({ status: res.statusCode, ok: res.statusCode >= 200 && res.statusCode < 300, json: async () => JSON.parse(text || '{}'), text: async () => text });
      });
    });
    req.setTimeout(300000, () => req.destroy(new Error('GitHub: η αποστολή άργησε πολύ.')));
    req.on('error', reject);
    (async () => {
      const w = (b) => new Promise((ok) => { if (req.write(b)) ok(); else req.once('drain', ok); });
      await w(head);
      const fd = fs.openSync(file, 'r');
      try {
        const step = 3 * 1024 * 1024;
        const chunk = Buffer.allocUnsafe(step);
        for (let at = 0; at < size;) { const n = fs.readSync(fd, chunk, 0, Math.min(step, size - at), at); await w(Buffer.from(chunk.subarray(0, n).toString('base64'))); at += n; }
      } finally { fs.closeSync(fd); }
      req.end(tail);
    })().catch(reject);
  }).then(denied);
}
/** One data file → a compressed blob in the repository. Returns its id there, or 'empty' for a repository without any commit. */
async function sendPart(name) {
  const tmp = tmpFile();
  try {
    // big files a little lighter on the processor (a small cloud machine has a tenth of one)
    const big = (statOf(name) || { size: 0 }).size > 4e6;
    await pipeline(fs.createReadStream(path.join(store.dir(), name)), zlib.createGzip({ level: big ? 4 : 6 }), fs.createWriteStream(tmp));
    const gz = fs.statSync(tmp).size;
    const r = await sendFile('POST', `/repos/${REPO}/git/blobs`, '{"encoding":"base64","content":"', tmp, '"}');
    if (r.status === 409) return { empty: true };
    if (!r.ok) throw new Error(`GitHub: δεν αποθηκεύτηκε το ${name} (${r.status}).`);
    return { sha: (await r.json()).sha, gz };
  } finally { try { fs.unlinkSync(tmp); } catch (_) { /* gone */ } }
}

/** Saves now what changed since the last save (nothing is sent when nothing changed). */
function save(reason) {
  if (!state.enabled || state.blocked || !restored) return Promise.resolve(null);
  if (saving) return saving;
  const at = changes;
  saving = (async () => {
    check();
    const names = store.dataFiles(keepNames()).filter((f) => NAME_OK.test(f));
    const now = new Map(); // what the repository will hold after this save
    const send = [];
    for (const f of names) {
      const st = statOf(f);
      if (!st || !st.size) continue;
      const k = known.get(f);
      if (k && k.size === st.size && k.mtimeMs === st.mtimeMs) now.set(f, k); else send.push([f, st]);
    }
    const gone = [...known.keys()].filter((f) => !now.has(f) && !send.some((x) => x[0] === f));
    if (!send.length && !gone.length) { state.pending = changes !== at; return { same: true }; }
    let sentSize = 0;
    for (const [f, st] of send) {
      let r = await sendPart(f);
      if (r.empty) {
        // a repository without any commit takes no blobs: a first small file starts it (it is gone at this save's commit)
        const init = await gh('PUT', `/repos/${REPO}/contents/README.md`, { message: 'SF Κέντρο: αρχή', branch: BRANCH, content: Buffer.from('Δεδομένα του SF Κέντρο (γράφονται από το πρόγραμμα).\n').toString('base64') });
        if (!init.ok && init.status !== 422) throw new Error(`GitHub: δεν αποθηκεύτηκαν τα δεδομένα (${init.status}).`);
        r = await sendPart(f);
        if (r.empty) throw new Error('GitHub: το αποθετήριο δεν δέχεται αρχεία (409).');
      }
      now.set(f, { sha: r.sha, gz: r.gz, size: st.size, mtimeMs: st.mtimeMs });
      sentSize += r.gz;
    }
    const message = `SF Κέντρο: δεδομένα (${reason || 'αλλαγές'}) ${new Date().toISOString()}`;
    // one commit without history: the old copies are not kept in the repository
    const entries = [...now].map(([f, k]) => ({ path: `${DIR}/${f}.gz`, mode: '100644', type: 'blob', sha: k.sha }));
    if (oldKeep) entries.push({ path: FILE, mode: '100644', type: 'blob', sha: oldKeep });
    const tree = await gh('POST', `/repos/${REPO}/git/trees`, { tree: entries });
    if (!tree.ok) throw new Error(`GitHub: δεν αποθηκεύτηκαν τα δεδομένα (${tree.status}).`);
    const commit = await gh('POST', `/repos/${REPO}/git/commits`, { message, tree: (await tree.json()).sha, parents: [] });
    if (!commit.ok) throw new Error(`GitHub: δεν αποθηκεύτηκαν τα δεδομένα (${commit.status}).`);
    const sha = (await commit.json()).sha;
    let ref = await gh('PATCH', `/repos/${REPO}/git/refs/heads/${BRANCH}`, { sha, force: true });
    if (ref.status === 422 || ref.status === 404) ref = await gh('POST', `/repos/${REPO}/git/refs`, { ref: 'refs/heads/' + BRANCH, sha });
    if (!ref.ok) throw new Error(`GitHub: δεν αποθηκεύτηκαν τα δεδομένα (${ref.status}).`);
    known.clear();
    let size = 0;
    for (const [f, k] of now) { known.set(f, k); size += k.gz || 0; }
    state.savedAt = new Date().toISOString();
    state.error = '';
    state.files = now.size; state.size = size; state.sent = send.length; state.sentSize = sentSize;
    state.pending = changes !== at;
    return { saved: true, files: now.size, sent: send.length, size: sentSize };
  })().catch((e) => { state.error = e.message; state.pending = true; console.error('cloud save:', e.message); return { error: e.message }; })
    .finally(() => { saving = null; });
  return saving;
}

/** After the start: save after changes (every few minutes at most) and when the host stops the program. */
function start() {
  if (!state.enabled) return;
  store.onWrite((name) => { if (name !== 'sessions') { changes++; state.pending = true; } });
  setInterval(() => { if (state.pending) save('αλλαγές'); }, EVERY).unref();
  // the sessions alone are saved once an hour (a restart then keeps the people signed in)
  setInterval(() => save('συνδέσεις'), 60 * 60000).unref();
}

function status() { return Object.assign({}, state); }
/**
 * With the shared database as the live copy, GitHub is only the daily backup: its saves are allowed without reading
 * it first (the database was read instead) — the first backup sends every file.
 */
function backupOnly() { restored = true; }

module.exports = { restore, save, start, status, backupOnly, FILE, DIR, KEEP };
