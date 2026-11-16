'use strict';
// The coordinator. Everything the screens need (checks, ready fixes, the work flow) is calculated in the
// background, in slices, kept on disk, and answered from memory:
//  • a request never starts a heavy calculation (on a small cloud machine that froze the program for a minute);
//  • while new results are being built, the screens keep getting the last ones;
//  • after a restart the saved results are loaded (seconds) instead of calculated again (a minute or more).
const crypto = require('crypto');
const store = require('./store');
const bg = require('./bg');
const settings = require('./settings');
const catalog = require('./catalog');
const checks = require('./checks');
const fixes = require('./fixes');
const flow = require('./flow');
const U = require('./util');

const FORMAT = 1;
const state = { started: false, loaded: false, ready: false, busy: false, step: '', gen: 0, bootMs: 0, buildMs: 0, error: '' };
let readyResolve, loadedResolve;
const readyP = new Promise((r) => { readyResolve = r; });
const loadedP = new Promise((r) => { loadedResolve = r; }); // the products are in memory (the checks may still be on their way)
const pending = new Set();
let running = null, timer = null, holds = 0;
const listeners = new Set();
function onChange(fn) { listeners.add(fn); }
function emit() { for (const fn of listeners) { try { fn(); } catch (_) { /* a listener never breaks the work */ } } }
// how long each step took (shown in the log: on a small cloud machine this is where the minutes go)
let stepAt = 0, stepName = '';
const took = [];
function step(text) {
  const now = Date.now();
  if (stepName) took.push(`${stepName.replace(/…$/, '')} ${((now - stepAt) / 1000).toFixed(1)}s`);
  stepName = text; stepAt = now; state.step = text;
}
function stepsDone(label) { step(''); if (took.length) console.log(`${label}: ${took.join(' · ')}`); took.length = 0; }

/** What the saved results were calculated from: when this changes they are calculated again. */
function signature() {
  const meta = store.read('catalog-meta', null) || {};
  const ec = store.read(fixes.CACHE, null) || {};
  return crypto.createHash('sha1').update(JSON.stringify([FORMAT, (meta.sf || {}).syncedAt || '', (meta.st || {}).syncedAt || '', settings.all(), store.read('links', {}), ec.at || '', (store.read('types', null) || {}).at || ''])).digest('hex');
}

// the checks as one long list of rows (written and read in slices) instead of 45 lists inside each other
function packChecks(raw) {
  const defs = [], items = [];
  raw.checks.forEach((c, i) => { const d = Object.assign({}, c); delete d.items; defs.push(d); for (const it of c.items) items.push(Object.assign({ _c: i }, it)); });
  while (items.length < 500) items.push(null); // a "big list" for the store, so it is written line by line
  return { at: raw.at, defs, items };
}
function unpackChecks(o) {
  if (!o || !Array.isArray(o.defs) || !Array.isArray(o.items)) return null;
  const out = o.defs.map((d) => Object.assign({}, d, { items: [] }));
  for (const it of o.items) { if (!it) continue; const c = out[it._c]; if (!c) continue; delete it._c; c.items.push(it); }
  return { checks: out, at: o.at };
}

async function saveDerived() {
  const raw = checks.raw();
  await store.writeAsync('derived-checks', packChecks(raw), bg.breathe); store.forget('derived-checks');
  const fx = fixes.forSave();
  if (fx) { while (fx.items.length < 500) fx.items.push(null); await store.writeAsync('derived-fixes', fx, bg.breathe); store.forget('derived-fixes'); }
  const w = checks.wordsForSave();
  if (w) { await store.writeAsync('derived-words', w, bg.breathe); store.forget('derived-words'); }
  store.write('derived-meta', { format: FORMAT, sig: signature(), at: U.nowIso(), banned: [...catalog.bannedOnAds()] });
}
async function loadDerived() {
  const meta = store.read('derived-meta', null);
  if (!meta || meta.format !== FORMAT) return null;
  const ck = unpackChecks(await store.readAsync('derived-checks', null, bg.breathe)); store.forget('derived-checks');
  const fx = await store.readAsync('derived-fixes', null, bg.breathe); store.forget('derived-fixes');
  if (!ck || !fx) return null;
  fx.items = fx.items.filter(Boolean);
  const w = await store.readAsync('derived-words', null, bg.breathe); store.forget('derived-words');
  if (Array.isArray(meta.banned) && meta.sig === signature()) catalog.setBanned(meta.banned);
  checks.setRaw(ck);
  if (w) checks.setWords(w);
  if (!fixes.setSaved(fx)) return null;
  return meta;
}

function hasProducts() { return !!(catalog.load('sf').syncedAt || catalog.load('st').syncedAt); }

/** Called once when the program starts: load, or calculate, everything; then keep it up to date. */
function start() {
  if (state.started) return readyP;
  state.started = true;
  const t0 = Date.now();
  checks.setLazy(true, mark); fixes.setLazy(true, mark); flow.setLazy(true, mark); catalog.setLazy(true, mark);
  (async () => {
    state.busy = true;
    step('Φόρτωση προϊόντων…');
    await catalog.preload();
    state.loaded = true; loadedResolve();
    if (hasProducts()) {
      if (await catalog.warmLearned()) console.log('Learned again from the catalog: product types and accents (they were not in the saved data).');
      step('Φόρτωση ελέγχων…');
      let meta = null;
      try { meta = await loadDerived(); } catch (e) { console.error('saved results:', e.message); }
      if (!meta) { pending.add('checks'); pending.add('fixes'); await build(); } else {
        step('Ροή εργασίας…');
        await catalog.warmLinks();
        await catalog.warmBanned();
        await flow.rebuild();
        if (meta.sig !== signature()) { pending.add('checks'); pending.add('fixes'); } // older than the data: shown now, built again behind
      }
    }
  })().catch((e) => { state.error = e.message; console.error('engine start:', e); }).finally(() => {
    stepsDone('Start'); state.busy = false; state.ready = true; if (!state.loaded) { state.loaded = true; loadedResolve(); } state.bootMs = Date.now() - t0; state.gen++;
    readyResolve();
    emit();
    bg.drain(catalog.warmLateGen()).catch(() => {}).then(() => { if (pending.size) schedule(); });
  });
  return readyP;
}

function mark(kind) {
  if (process.env.SFK_DEBUG_MARK && !pending.has(kind)) console.log('mark', kind, 'busy=' + state.busy, 'step=' + state.step, new Error().stack.split('\n').slice(2, 7).map((l) => l.trim().replace(/^at /, '').replace(/\(.*\/lib\//, '(')).join(' < '));
  pending.add(kind || 'checks');
  if (state.ready) schedule();
}
function schedule() {
  if (holds > 0 || running) return;
  clearTimeout(timer);
  timer = setTimeout(() => { run().catch((e) => console.error('engine:', e)); }, 250);
}
function run() {
  if (running) return running;
  running = build().catch((e) => { state.error = e.message; console.error('engine build:', e); }).finally(() => { running = null; if (pending.size && !holds) schedule(); });
  return running;
}
async function build() {
  const t0 = Date.now();
  state.busy = true;
  try {
    while (pending.size) {
      const kinds = new Set(pending);
      pending.clear();
      if (!hasProducts()) break;
      if (kinds.has('links')) kinds.add('checks'); // the links between the sites changed: everything is checked again
      // a job that replaces the catalogs has started (reading the shops): this build stops at the next step and
      // is done once, whole, when the job ends — two heavy works at once are more than a small machine has
      const stop = () => { if (!holds) return false; for (const k of kinds) pending.add(k); return true; };
      step('Αντιστοίχιση των δύο sites…');
      await catalog.warmLinks();
      await catalog.warmBanned();
      if (stop()) break;
      if (kinds.has('checks')) {
        step('Λέξεις για την ορθογραφία…'); await checks.warmWords();
        if (stop()) break;
        step('Έλεγχοι καταλόγου…'); await checks.rebuild();
        kinds.add('fixes');
        if (stop()) break;
      }
      if (kinds.has('fixes')) { step('Έτοιμες διορθώσεις…'); await checks.warmWords(); await fixes.rebuild(); }
      if (stop()) break;
      step('Ροή εργασίας…');
      await flow.rebuild();
      if (kinds.has('checks') || kinds.has('fixes')) { step('Φύλαξη…'); await saveDerived(); }
    }
    if (bg.small) require('./spell').release(); // the dictionary (38 MB) is only needed while the checks are built
    state.error = '';
  } finally {
    if (state.ready) stepsDone('Rebuilt'); else step('');
    state.busy = false; state.buildMs = Date.now() - t0; state.gen++;
    emit();
    if (state.ready) bg.drain(catalog.warmLateGen()).catch(() => {}); // the order of the product list, for the next visit there
  }
}

/** While a job changes a lot of data (reading the shops, the price research) nothing is built; once at its end. */
function hold() { holds++; clearTimeout(timer); }
function release() { holds = Math.max(0, holds - 1); if (!holds && pending.size && state.ready) schedule(); }
/** Wait until everything that changed has been built (jobs end with this; `say` gets the step for the progress bar). */
async function settle(say) {
  await readyP;
  for (;;) {
    if (!running && !pending.size) return;
    const p = running || run();
    const iv = say ? setInterval(() => { if (state.step) say(state.step); }, 400) : null;
    try { await p; } finally { if (iv) clearInterval(iv); }
  }
}

function ready() { return readyP; }
function loaded() { return loadedP; }
function status() { return { loaded: state.loaded, ready: state.ready, busy: state.busy || pending.size > 0, step: state.step, gen: state.gen, bootMs: state.bootMs, buildMs: state.buildMs, error: state.error }; }

module.exports = { start, ready, loaded, mark, hold, release, settle, status, onChange, signature };
