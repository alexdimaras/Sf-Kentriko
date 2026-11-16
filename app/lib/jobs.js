'use strict';
// Background jobs with progress, so long tasks (sync, price research) never block the screen.
//  • One job of each kind at a time (a second request for the same kind gets the one that is running).
//  • Heavy jobs (reading the shops, the price research, the mass searches) take turns: on a small cloud machine
//    two of them together are more than it has. The second one waits in line («Στη σειρά») and starts by itself.
//    What a person asked for goes before what the program started on its own.
//  • Light jobs (one supplier, one brand, one product) start at once, also while a heavy one is running.
//  • Stopping answers at once: the job is marked «σταματάει», its open requests to other sites are cut, and it
//    ends at its next step. A job still waiting in line is simply taken out.
const { uid } = require('./util');

const jobs = new Map();
const listeners = new Set();
function onChange(fn) { listeners.add(fn); }
// how a job's work is started (the server runs it outside the request that asked for it, so every screen —
// also the one that started it — hears about the data it changes)
let runner = (fn) => fn();
function setRunner(r) { runner = r; }
function changed() { for (const fn of listeners) { try { fn(); } catch (_) { /* ignore */ } } }

let heavyLimit = 1;
/** How many heavy jobs may run together (1 on a small machine; the server sets it at start). */
function setHeavyLimit(n) { heavyLimit = Math.max(1, Number(n) || 1); }
const live = (j) => j.status === 'running' || j.status === 'queued';
const heavyRunning = () => [...jobs.values()].filter((j) => j.heavy && j.status === 'running').length;

/**
 * Start a job. opts: { heavy: takes its turn with the other heavy jobs, auto: started by the program itself }.
 * fn(job) gets: progress(done, total, msg), log(line), cancelled(), signal (cut when the job is stopped).
 */
function start(type, label, fn, opts) {
  opts = opts || {};
  for (const j of jobs.values()) {
    if (j.type === type && live(j)) return view(j); // one of each kind at a time
  }
  const ctl = new AbortController();
  const job = { id: uid('j'), type, label, status: 'running', done: 0, total: 0, msg: 'Ξεκινάει…', log: [], result: null, error: null, createdAt: Date.now(), startedAt: Date.now(), endedAt: null, cancel: false, heavy: !!opts.heavy, auto: !!opts.auto, fn, ctl };
  jobs.set(job.id, job);
  if (job.heavy && heavyRunning() > heavyLimit) { // (this job is already counted)
    job.status = 'queued';
    const first = [...jobs.values()].find((j) => j.heavy && j.status === 'running' && j !== job);
    job.msg = 'Στη σειρά' + (first ? ` — περιμένει να τελειώσει: ${first.label}` : '');
    changed();
    return view(job);
  }
  run(job);
  return view(job);
}

function run(job) {
  job.status = 'running'; job.startedAt = Date.now(); job.msg = 'Ξεκινάει…';
  changed();
  const api = {
    progress(done, total, msg) { if (job.cancel) return; if (done != null) job.done = done; if (total != null) job.total = total; if (msg) job.msg = msg; },
    log(line) { job.log.push(line); if (job.log.length > 200) job.log.shift(); },
    cancelled() { return job.cancel; },
    signal: job.ctl.signal,
    id: job.id, type: job.type,
  };
  const fn = job.fn; job.fn = null;
  Promise.resolve().then(() => runner(() => fn(api))).then((r) => {
    job.result = r === undefined ? null : r;
    job.status = job.cancel ? 'cancelled' : 'done';
  }).catch((e) => {
    if (job.cancel || (e && e.cancelled)) { job.status = 'cancelled'; return; } // a request cut by the stop is not an error
    job.status = 'error';
    job.error = e && e.message ? e.message : String(e);
    if (!(e && e.status) && !(e && e.network)) console.error('[job ' + job.type + ']', e);
  }).finally(() => {
    job.endedAt = Date.now();
    job.cancelling = false;
    next();
    changed();
    // keep finished jobs for 30 minutes
    setTimeout(() => jobs.delete(job.id), 30 * 60 * 1000).unref();
  });
}

/** The next job in line: a person's request first, then the oldest. */
function next() {
  while (heavyRunning() < heavyLimit) {
    const q = [...jobs.values()].filter((j) => j.status === 'queued').sort((a, b) => (a.auto ? 1 : 0) - (b.auto ? 1 : 0) || a.createdAt - b.createdAt)[0];
    if (!q) return;
    run(q);
  }
}

function view(j) {
  if (!j) return null;
  return { id: j.id, type: j.type, label: j.label, status: j.status, cancelling: !!j.cancelling, heavy: j.heavy, auto: j.auto, done: j.done, total: j.total, msg: j.msg, log: j.log.slice(-30), result: j.result, error: j.error, startedAt: j.startedAt, endedAt: j.endedAt };
}
function get(id) { return view(jobs.get(id)); }
/**
 * Stop a job. The answer is immediate: a job in line leaves it; a running one is marked «σταματάει» (the screen shows
 * it at once), its open requests are cut, and it ends at its next step.
 */
function cancel(id) {
  const j = jobs.get(id);
  if (!j) return null;
  if (j.status === 'queued') { j.status = 'cancelled'; j.cancel = true; j.endedAt = Date.now(); j.fn = null; j.msg = 'Βγήκε από τη σειρά.'; changed(); setTimeout(() => jobs.delete(j.id), 30 * 60 * 1000).unref(); return view(j); }
  if (j.status === 'running' && !j.cancel) {
    j.cancel = true; j.cancelling = true; j.msg = 'Σταματάει…';
    try { j.ctl.abort(); } catch (_) { /* ignore */ }
    changed();
  }
  return view(j);
}
function running() { return [...jobs.values()].filter(live).map(view); }
function recent() { return [...jobs.values()].sort((a, b) => b.createdAt - a.createdAt).slice(0, 10).map(view); }
/** Is a job of this kind running or waiting? */
function busy(type) { for (const j of jobs.values()) if (j.type === type && live(j)) return true; return false; }
/** Wait while a job of this kind is running (a mass search steps aside for a person's own search). */
async function whileBusy(type, stop) {
  while (busy(type) && !(stop && stop())) await new Promise((r) => setTimeout(r, 400));
}

module.exports = { start, get, cancel, running, recent, onChange, setRunner, setHeavyLimit, busy, whileBusy };
