'use strict';
// Data that survives restarts on a free cloud host (Render's disk is wiped at every restart): the whole data folder,
// in one compressed file, in a PRIVATE GitHub repository of the shop. It is read back at start, saved a few minutes
// after every change and when the host stops the program.
// Every save replaces the previous one (one commit without history), so the repository stays small.
//   SFK_GITHUB_DATA  = owner/repository (private), e.g. alexdimaras/sf-kentro-data
//   SFK_GITHUB_TOKEN = a fine-grained token with "Contents: read and write" on that repository only
const store = require('./store');

const REPO = String(process.env.SFK_GITHUB_DATA || '').trim().replace(/^https?:\/\/github\.com\//i, '').replace(/\.git$/i, '').replace(/\/+$/, '');
const TOKEN = String(process.env.SFK_GITHUB_TOKEN || '').trim();
const API = String(process.env.SFK_GITHUB_API || 'https://api.github.com').replace(/\/+$/, '');
const BRANCH = String(process.env.SFK_GITHUB_BRANCH || 'main').trim();
const FILE = 'sf-kentro-data.json.gz';
const KEEP = ['sessions']; // a restart does not sign everybody out
const EVERY = Math.max(1, Number(process.env.SFK_GITHUB_MINUTES) || 5) * 60000;

// blocked: the saved data could not be read at start → nothing is saved over it (an empty start must never replace it)
const state = { enabled: !!(REPO && TOKEN), repo: REPO, loadedAt: null, savedAt: null, error: '', pending: false, blocked: false };
let lastHash = '';
let changes = 0;
let saving = null;

function check() {
  if (!/^[\w.-]+\/[\w.-]+$/.test(REPO)) throw new Error('SFK_GITHUB_DATA: γράψε το αποθετήριο ως όνομα/αποθετήριο, π.χ. alexdimaras/sf-kentro-data.');
}
async function gh(method, p, body, accept) {
  const r = await fetch(API + p, {
    method,
    headers: Object.assign({ Authorization: 'Bearer ' + TOKEN, 'User-Agent': 'sf-kentro', Accept: accept || 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' }, body ? { 'Content-Type': 'application/json' } : {}),
    body: body ? JSON.stringify(body) : undefined,
  });
  if (r.status === 401) throw new Error('GitHub: το κλειδί (token) δεν ισχύει ή έληξε. Φτιάξε νέο και βάλ’ το στο SFK_GITHUB_TOKEN.');
  if (r.status === 403) { const t = await r.text(); throw new Error('GitHub: δεν επιτρέπεται (' + t.slice(0, 120) + '). Το κλειδί θέλει «Contents: Read and write» σε αυτό το αποθετήριο.'); }
  return r;
}

/** At start, before anything else: the data saved last time (nothing when this is the first start). */
async function restore() {
  if (!state.enabled) return null;
  for (let i = 0; ; i++) {
    try { return await restoreOnce(); } catch (e) {
      if (i >= 4) { state.blocked = true; state.error = e.message + ' Δεν αποθηκεύεται τίποτα μέχρι την επόμενη επανεκκίνηση, για να μη χαθούν τα σωσμένα δεδομένα.'; throw e; }
      await new Promise((x) => setTimeout(x, 3000 * (i + 1)));
    }
  }
}
async function restoreOnce() {
  check();
  const r = await gh('GET', `/repos/${REPO}/contents/${FILE}?ref=${encodeURIComponent(BRANCH)}`, null, 'application/vnd.github.raw');
  if (r.status === 404) { state.loadedAt = new Date().toISOString(); return { files: 0, first: true }; }
  if (!r.ok) throw new Error(`GitHub: δεν διαβάστηκαν τα δεδομένα (${r.status}).`);
  const buf = Buffer.from(await r.arrayBuffer());
  const out = store.unbundle(buf, { allow: KEEP, fresh: true });
  lastHash = store.bundle({ allow: KEEP }).hash;
  state.loadedAt = new Date().toISOString();
  return out;
}

/** Saves now if anything changed since the last save. */
function save(reason) {
  if (!state.enabled || state.blocked) return Promise.resolve(null);
  if (saving) return saving;
  const at = changes;
  saving = (async () => {
    check();
    const b = store.bundle({ allow: KEEP });
    if (b.hash === lastHash) { state.pending = changes !== at; return { same: true }; }
    const message = `SF Κέντρο: δεδομένα (${reason || 'αλλαγές'}) ${new Date().toISOString()}`;
    // one commit without history: the old copies are not kept in the repository
    const blob = await gh('POST', `/repos/${REPO}/git/blobs`, { content: b.buffer.toString('base64'), encoding: 'base64' });
    if (blob.status === 409) {
      // an empty repository has no history to build on: the first file goes in the simple way
      const put = await gh('PUT', `/repos/${REPO}/contents/${FILE}`, { message, content: b.buffer.toString('base64'), branch: BRANCH });
      if (!put.ok) throw new Error(`GitHub: δεν αποθηκεύτηκαν τα δεδομένα (${put.status}).`);
    } else {
      if (!blob.ok) throw new Error(`GitHub: δεν αποθηκεύτηκαν τα δεδομένα (${blob.status}).`);
      const tree = await gh('POST', `/repos/${REPO}/git/trees`, { tree: [{ path: FILE, mode: '100644', type: 'blob', sha: (await blob.json()).sha }] });
      if (!tree.ok) throw new Error(`GitHub: δεν αποθηκεύτηκαν τα δεδομένα (${tree.status}).`);
      const commit = await gh('POST', `/repos/${REPO}/git/commits`, { message, tree: (await tree.json()).sha, parents: [] });
      if (!commit.ok) throw new Error(`GitHub: δεν αποθηκεύτηκαν τα δεδομένα (${commit.status}).`);
      const sha = (await commit.json()).sha;
      let ref = await gh('PATCH', `/repos/${REPO}/git/refs/heads/${BRANCH}`, { sha, force: true });
      if (ref.status === 422 || ref.status === 404) ref = await gh('POST', `/repos/${REPO}/git/refs`, { ref: 'refs/heads/' + BRANCH, sha });
      if (!ref.ok) throw new Error(`GitHub: δεν αποθηκεύτηκαν τα δεδομένα (${ref.status}).`);
    }
    lastHash = b.hash;
    state.savedAt = new Date().toISOString();
    state.error = '';
    state.pending = changes !== at;
    return { saved: true, files: b.files, size: b.buffer.length };
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

module.exports = { restore, save, start, status, FILE };
