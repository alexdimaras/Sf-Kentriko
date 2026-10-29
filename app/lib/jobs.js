'use strict';
// Background jobs with progress, so long tasks (sync, price research) never block the screen.
const { uid } = require('./util');

const jobs = new Map();
const listeners = new Set();
function onChange(fn) { listeners.add(fn); }
function changed() { for (const fn of listeners) { try { fn(); } catch (_) { /* ignore */ } } }

function start(type, label, fn) {
  for (const j of jobs.values()) {
    if (j.type === type && j.status === 'running') return j; // one of each kind at a time
  }
  const job = { id: uid('j'), type, label, status: 'running', done: 0, total: 0, msg: 'Ξεκινάει…', log: [], result: null, error: null, startedAt: Date.now(), endedAt: null, cancel: false };
  jobs.set(job.id, job);
  changed();
  const api = {
    progress(done, total, msg) { job.done = done; if (total != null) job.total = total; if (msg) job.msg = msg; },
    log(line) { job.log.push(line); if (job.log.length > 200) job.log.shift(); },
    cancelled() { return job.cancel; },
  };
  Promise.resolve().then(() => fn(api)).then((r) => {
    job.result = r === undefined ? null : r;
    job.status = job.cancel ? 'cancelled' : 'done';
  }).catch((e) => {
    job.status = 'error';
    job.error = e && e.message ? e.message : String(e);
    if (!(e && e.status) && !(e && e.network)) console.error('[job ' + type + ']', e);
  }).finally(() => {
    job.endedAt = Date.now();
    changed();
    // keep finished jobs for 30 minutes
    setTimeout(() => jobs.delete(job.id), 30 * 60 * 1000).unref();
  });
  return job;
}

function view(j) {
  if (!j) return null;
  return { id: j.id, type: j.type, label: j.label, status: j.status, done: j.done, total: j.total, msg: j.msg, log: j.log.slice(-30), result: j.result, error: j.error, startedAt: j.startedAt, endedAt: j.endedAt };
}
function get(id) { return view(jobs.get(id)); }
function cancel(id) { const j = jobs.get(id); if (j && j.status === 'running') j.cancel = true; return view(j); }
function running() { return [...jobs.values()].filter((j) => j.status === 'running').map(view); }
function recent() { return [...jobs.values()].sort((a, b) => b.startedAt - a.startedAt).slice(0, 10).map(view); }

module.exports = { start, get, cancel, running, recent, onChange };
