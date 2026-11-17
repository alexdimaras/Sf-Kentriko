'use strict';
// The coordinator: one shared queue of work, many computers that do it.
//
//  • The cloud program (this server) is the only place that decides: what is to be done, who does it, and what the
//    result is. The computers of the shops (workers, app/worker.js) only DO the work they are given and send the
//    result back; they never decide which data is right.
//  • A job is given to ONE worker at a time, with a lease (a time limit). The worker says «still working» every few
//    seconds (heartbeat), which extends the lease. A worker that disappears (switched off, asleep, no internet) loses
//    the job when its lease ends: the job goes back to the queue and another worker takes it — up to `maxAttempts`.
//  • The same work is never done twice at the same time: a job has a `dedupKey`; asking again for a job that is
//    waiting or running joins it, and a fresh enough result (`fresh` ms) is used again instead of doing it again.
//  • A result is written once: it carries the job id and the worker's idempotency key, so a result sent twice (the
//    answer was lost on the way and the worker sent it again) changes nothing the second time.
//  • Each worker says what it can do (job types, memory, processors, version); a job says what it needs. A small old
//    PC gets the light jobs, a strong one the heavy ones.
//  • The cloud itself is a worker too ("cloud"), with the smallest capacity: it takes a job only when no computer of
//    the shops can (none is online, or none has been seen for `cloudAfterMs`), so the work never stops at night.
//
// Storage: through `backend` (lib/coord-store.js: the program's data folder today, PostgreSQL when it is set up).
const crypto = require('crypto');
const U = require('./util');

const LEASE_MS = Number(process.env.SFK_LEASE_MS) || 90 * 1000;          // a job is lost by its worker 90 s after its last sign of life
const OFFLINE_MS = Number(process.env.SFK_OFFLINE_MS) || 2 * 60 * 1000;    // a worker not heard of for 2 minutes is offline
const CLOUD_AFTER_MS = Number(process.env.SFK_CLOUD_AFTER_MS) || 10 * 60 * 1000; // the cloud takes waiting jobs when no computer has been online for 10 minutes

const handlers = new Map(); // type -> { label, needs: { ramMB }, cloudOk, maxAttempts, fresh, prepare(payload), apply(job, result), run(job, api) }
let backend = null;
const listeners = new Set();
function onChange(fn) { listeners.add(fn); }
function changed() { for (const fn of listeners) { try { fn(); } catch (_) { /* a listener never breaks the queue */ } } }
const now = () => Date.now();
const iso = (ms) => new Date(ms == null ? now() : ms).toISOString();
const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');

function use(b) { backend = b; }
/** A kind of job: what it needs, how its result is taken in, and how it is run (by a worker or, as a last resort, here). */
function register(type, h) { handlers.set(type, Object.assign({ label: type, needs: {}, cloudOk: true, maxAttempts: 3, fresh: 0 }, h)); }
function handler(type) { return handlers.get(type) || null; }

// ---------- jobs ----------
const LIVE = new Set(['queued', 'assigned', 'running']);
/**
 * Ask for work. → the job (a new one, the one already waiting/running with the same dedupKey, or a fresh finished
 * one). opts: { priority (higher first), dedupKey, by (who asked), label, auto (started by the program itself) }
 */
async function enqueue(type, payload, opts) {
  const o = opts || {};
  const h = handler(type);
  if (!h) throw new Error('Άγνωστο είδος εργασίας: ' + type);
  const key = o.dedupKey || '';
  if (key) {
    const same = await backend.findByKey(key);
    const live = same.find((j) => LIVE.has(j.status));
    if (live) {
      // a person asks for what the program queued by itself: it goes up the queue
      if (!o.auto && live.auto && live.status === 'queued') { live.auto = false; live.priority = Math.max(live.priority, o.priority || 0); await backend.save(live); changed(); }
      return Object.assign({ joined: true }, live);
    }
    const done = same.filter((j) => j.status === 'completed').sort((a, b) => (b.completedAt || '').localeCompare(a.completedAt || ''))[0];
    if (done && h.fresh && now() - new Date(done.completedAt).getTime() < h.fresh) return Object.assign({ cached: true }, done);
  }
  const job = {
    id: U.uid('q'), type, label: o.label || h.label, priority: Number(o.priority) || 0, status: 'queued', dedupKey: key,
    workerId: '', leaseUntil: 0, attempts: 0, maxAttempts: h.maxAttempts, payload: payload || {}, result: null, error: '',
    progress: { done: 0, total: 0, msg: 'Στη σειρά' }, by: o.by || '', auto: !!o.auto, cancel: false,
    createdAt: iso(), startedAt: null, completedAt: null, notBefore: 0, log: [],
  };
  await backend.save(job);
  changed();
  return job;
}

/** How much memory the cloud machine has for one job (SFK_CLOUD_RAM_MB, else what the machine is given, 90%). */
function cloudRamMB() {
  if (Number(process.env.SFK_CLOUD_RAM_MB) > 0) return Number(process.env.SFK_CLOUD_RAM_MB);
  const lim = typeof process.constrainedMemory === 'function' ? process.constrainedMemory() : 0;
  const total = lim > 0 && lim < require('os').totalmem() ? lim : require('os').totalmem();
  return Math.floor((total / 1048576) * 0.9);
}
/** Can this worker do this job? (the job's type, its memory, the worker's free places) */
function fits(w, j) {
  const h = handler(j.type);
  if (!h) return false;
  // the cloud machine: only what it may do, and only what fits in its memory (measured, not the computers' sizing)
  if (w.id === 'cloud') return !!h.cloudOk && ((h.cloudRamMB || (h.needs && h.needs.ramMB) || 0) <= cloudRamMB());
  if (Array.isArray(w.caps.types) && w.caps.types.length && !w.caps.types.includes(j.type)) return false;
  const need = (h.needs && h.needs.ramMB) || 0;
  return !need || (Number(w.caps.ramMB) || 0) >= need;
}

/**
 * A worker asks for work. → up to `max` jobs, now its own until their lease ends. The best job first: the highest
 * priority, what a person asked for before what the program queued, the oldest.
 */
async function claim(workerId, max) {
  const w = await backend.worker(workerId);
  if (!w || w.revoked) return [];
  await touchWorker(w, {});
  const room = Math.max(0, Math.min(Number(max) || 1, (Number(w.caps.slots) || 1) - (await backend.byWorker(w.id)).length));
  if (!room) return [];
  const out = [];
  // the backend hands a job to one worker only, even when two ask at the same moment (PostgreSQL: SKIP LOCKED)
  for (let i = 0; i < room; i++) {
    const j = await backend.takeNext((x) => fits(w, x) && (!x.notBefore || x.notBefore <= now()), (x) => {
      x.status = 'assigned'; x.workerId = w.id; x.workerName = w.name; x.attempts++; x.leaseUntil = now() + LEASE_MS;
      x.startedAt = iso(); x.progress = { done: 0, total: 0, msg: 'Ξεκινάει στο ' + w.name };
    });
    if (!j) break;
    const h = handler(j.type);
    out.push({ id: j.id, type: j.type, attempt: j.attempts, payload: h.prepare ? await h.prepare(j.payload, j) : j.payload, leaseMs: LEASE_MS });
  }
  if (out.length) changed();
  return out;
}

/** «Still working»: the lease is extended, the progress shown. → { cancel } (the person stopped it: end now). */
async function heartbeat(workerId, jobId, progress, logLines) {
  const j = await backend.job(jobId);
  if (!j || j.workerId !== workerId || !LIVE.has(j.status)) return { cancel: true, gone: true };
  j.status = 'running';
  j.leaseUntil = now() + LEASE_MS;
  if (progress) j.progress = { done: Number(progress.done) || 0, total: Number(progress.total) || 0, msg: String(progress.msg || '').slice(0, 300) };
  if (Array.isArray(logLines) && logLines.length) { j.log = (j.log || []).concat(logLines.map((l) => String(l).slice(0, 300))).slice(-100); }
  await backend.save(j, { light: true });
  const w = await backend.worker(workerId);
  if (w) await touchWorker(w, {});
  changed();
  return { cancel: !!j.cancel };
}

/**
 * The result of a job. Taken in once: a second delivery of the same result (same idempotency key) is answered «ok»
 * without doing anything; a result for a job that is no longer this worker's is refused.
 */
async function complete(workerId, jobId, idemKey, result) {
  const j = await backend.job(jobId);
  if (!j) return { ok: false, error: 'Η εργασία δεν υπάρχει.' };
  if (j.status === 'completed') return j.idem && j.idem === idemKey ? { ok: true, again: true } : { ok: false, error: 'Η εργασία έχει ήδη ολοκληρωθεί από άλλον.' };
  if (j.workerId !== workerId || !LIVE.has(j.status)) return { ok: false, error: 'Η εργασία δεν είναι πια δική σου (έληξε ο χρόνος ή σταμάτησε).' };
  const h = handler(j.type);
  let summary = null;
  try { summary = h.apply ? await h.apply(j, result) : result; } catch (e) {
    j.error = 'Το αποτέλεσμα δεν έγινε δεκτό: ' + e.message;
    return finish(j, 'failed');
  }
  j.idem = String(idemKey || '');
  j.result = summary === undefined ? null : summary;
  return finish(j, j.cancel ? 'cancelled' : 'completed');
}
async function finish(j, status) {
  j.status = status; j.completedAt = iso(); j.leaseUntil = 0;
  if (status !== 'completed' && status !== 'failed') j.progress = Object.assign({}, j.progress, { msg: status === 'cancelled' ? 'Σταμάτησε.' : j.progress.msg });
  await backend.save(j);
  const h = handler(j.type);
  if (h && h.after) { try { await h.after(j); } catch (e) { console.error('[coord after]', j.type, e.message); } }
  changed();
  return { ok: status === 'completed', status };
}

/** The worker could not do it. Retryable errors go back to the queue (a little later), up to maxAttempts. */
async function fail(workerId, jobId, error, retryable) {
  const j = await backend.job(jobId);
  if (!j || j.workerId !== workerId || !LIVE.has(j.status)) return { ok: false };
  j.error = String(error || 'Άγνωστο σφάλμα').slice(0, 500);
  if (j.cancel) return finish(j, 'cancelled');
  if (retryable !== false && j.attempts < j.maxAttempts) return requeue(j, 30000 * j.attempts);
  return finish(j, 'failed');
}
async function requeue(j, delayMs) {
  j.status = 'queued'; j.workerId = ''; j.leaseUntil = 0; j.notBefore = now() + (delayMs || 0);
  j.progress = { done: 0, total: 0, msg: 'Ξανά στη σειρά' + (j.error ? ' (' + j.error.slice(0, 80) + ')' : '') };
  await backend.save(j);
  changed();
  return { ok: true, requeued: true };
}

/** Stop a job: one in line leaves it; a running one is told at its next heartbeat. */
async function cancel(jobId) {
  const j = await backend.job(jobId);
  if (!j || !LIVE.has(j.status)) return j ? view(j) : null;
  if (j.status === 'queued') { await finish(j, 'cancelled'); return view(j); }
  j.cancel = true; j.progress = Object.assign({}, j.progress, { msg: 'Σταματάει…' });
  await backend.save(j);
  changed();
  return view(j);
}

/** Every few seconds: leases that ended go back to the queue; workers not heard of are offline. */
async function sweep() {
  const t = now();
  for (const j of await backend.live()) {
    if (j.status === 'queued' || !j.leaseUntil || j.leaseUntil > t) continue;
    j.error = `Ο υπολογιστής «${j.workerName || j.workerId}» σταμάτησε να απαντά.`;
    if (j.cancel) await finish(j, 'cancelled');
    else if (j.attempts < j.maxAttempts) await requeue(j, 0);
    else await finish(j, 'failed');
  }
  let any = false;
  for (const w of await backend.workers()) {
    const online = !w.revoked && t - new Date(w.lastSeen || 0).getTime() < OFFLINE_MS;
    if (w.online !== online) { w.online = online; await backend.saveWorker(w, { light: true }); any = true; }
  }
  if (any) changed();
}

// ---------- workers ----------
/** A one-off code (15 minutes) an administrator gives to a new computer. */
async function newPairing(by) {
  const code = Array.from(crypto.randomBytes(8)).map((b) => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[b % 32]).join('');
  await backend.savePairing({ hash: sha(code), by: by || '', until: now() + 15 * 60000 });
  return { code: code.slice(0, 4) + '-' + code.slice(4), minutes: 15 };
}
/** A computer with a pairing code becomes a worker. → { id, token } (the token is shown only this once). */
async function pair(code, name, caps) {
  const c = String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const p = c.length === 8 ? await backend.takePairing(sha(c)) : null;
  if (!p || p.until < now()) throw Object.assign(new Error('Ο κωδικός δεν ισχύει (λάθος ή έληξε). Φτιάξε νέο από Ρυθμίσεις → Υπολογιστές.'), { status: 403 });
  const token = 'sfkw_' + crypto.randomBytes(32).toString('base64url');
  const w = { id: U.uid('w'), name: U.collapse(String(name || 'Υπολογιστής')).slice(0, 60), tokenHash: sha(token), caps: cleanCaps(caps), createdAt: iso(), by: p.by, lastSeen: iso(), online: true, revoked: false, load: 0, done: 0, failed: 0 };
  await backend.saveWorker(w);
  changed();
  return { id: w.id, name: w.name, token };
}
function cleanCaps(caps) {
  const c = caps || {};
  return {
    cpus: Math.max(0, Math.min(256, Number(c.cpus) || 0)), cpuModel: String(c.cpuModel || '').slice(0, 80), ramMB: Math.max(0, Number(c.ramMB) || 0), freeMB: Math.max(0, Number(c.freeMB) || 0),
    version: String(c.version || '').slice(0, 20), platform: String(c.platform || '').slice(0, 20), types: Array.isArray(c.types) ? c.types.map(String).slice(0, 30) : [],
    slots: Math.max(1, Math.min(4, Number(c.slots) || 1)), battery: !!c.battery, busyUser: !!c.busyUser,
  };
}
/** The worker of a token (constant-time compare of the hashes), or null. */
async function workerByToken(token) {
  const t = String(token || '');
  if (!t.startsWith('sfkw_')) return null;
  const h = sha(t);
  const w = await backend.workerByHash(h);
  if (!w || w.revoked) return null;
  const a = Buffer.from(w.tokenHash), b = Buffer.from(h);
  return a.length === b.length && crypto.timingSafeEqual(a, b) ? w : null;
}
async function touchWorker(w, caps) {
  const t = now();
  const before = w.online;
  if (caps && Object.keys(caps).length) w.caps = cleanCaps(Object.assign({}, w.caps, caps));
  w.online = true;
  // the last sign of life is written at most once a minute (a heartbeat every few seconds would be a write each time)
  const stale = t - new Date(w.lastSeen || 0).getTime() > 60000;
  w.lastSeen = iso(t);
  await backend.saveWorker(w, { light: !stale && before });
}
async function hello(workerId, caps) { const w = await backend.worker(workerId); if (!w) return null; await touchWorker(w, caps || {}); changed(); return w; }
async function revoke(id) {
  const w = await backend.worker(id);
  if (!w) return false;
  w.revoked = true; w.online = false;
  await backend.saveWorker(w);
  // its jobs go back to the queue at once
  for (const j of await backend.byWorker(id)) { j.error = 'Ο υπολογιστής αφαιρέθηκε.'; await requeue(j, 0); }
  changed();
  return true;
}

// ---------- the cloud as the last worker ----------
let cloudBusy = false;
/** Is any computer of the shops able to take this job now (or lately)? */
async function someoneFor(j) {
  const t = now();
  for (const w of await backend.workers()) if (!w.revoked && fits(w, j) && t - new Date(w.lastSeen || 0).getTime() < CLOUD_AFTER_MS) return true;
  return false;
}
/**
 * Called every few seconds: when a job has waited and no computer can take it, the cloud does it itself, in this
 * process, one at a time (a small machine). The handler's run() is the same code a worker runs.
 */
async function cloudTick(opts) {
  if (cloudBusy) return false;
  const o = opts || {};
  // never beside other heavy work of this machine (one big job at a time on a small cloud machine)
  if (o.canRun && !o.canRun()) return false;
  const waiting = (await backend.live()).filter((j) => j.status === 'queued' && (!j.notBefore || j.notBefore <= now()) && fits({ id: 'cloud' }, j));
  let pick = null;
  for (const j of waiting.sort(order)) {
    if (o.always || !(await someoneFor(j))) { pick = j; break; }
  }
  if (!pick) return false;
  cloudBusy = true;
  const w = { id: 'cloud', name: 'cloud' };
  try {
    const j = await backend.takeNext((x) => x.id === pick.id, (x) => { x.status = 'running'; x.workerId = 'cloud'; x.workerName = 'cloud'; x.attempts++; x.leaseUntil = now() + 3600e3; x.startedAt = iso(); });
    if (!j) return false;
    const h = handler(j.type);
    const payload = h.prepare ? await h.prepare(j.payload, j) : j.payload;
    const ctl = new AbortController();
    const api = {
      signal: ctl.signal, id: j.id, type: j.type,
      cancelled: () => !!j.cancel,
      progress: (done, total, msg) => { j.progress = { done: done == null ? j.progress.done : done, total: total == null ? j.progress.total : total, msg: msg || j.progress.msg }; j.leaseUntil = now() + 3600e3; changed(); },
      log: (l) => { j.log = (j.log || []).concat([String(l).slice(0, 300)]).slice(-100); },
    };
    const stopWatch = setInterval(async () => { const cur = await backend.job(j.id); if (cur && cur.cancel) { j.cancel = true; ctl.abort(); } }, 1000);
    try {
      const result = await h.run(payload, api);
      if (j.cancel) await finish(j, 'cancelled');
      else await complete(w.id, j.id, 'cloud-' + j.id + '-' + j.attempts, result);
    } catch (e) {
      if (j.cancel || (e && e.cancelled)) await finish(j, 'cancelled');
      else await fail(w.id, j.id, e.message, !(e && e.fatal));
    } finally { clearInterval(stopWatch); }
    return true;
  } finally { cloudBusy = false; }
}
function order(a, b) { return (b.priority - a.priority) || ((a.auto ? 1 : 0) - (b.auto ? 1 : 0)) || a.createdAt.localeCompare(b.createdAt); }

// ---------- views ----------
function view(j) {
  if (!j) return null;
  return { id: j.id, type: j.type, label: j.label, status: j.status === 'assigned' ? 'running' : j.status, queued: j.status === 'queued', cancelling: !!j.cancel && LIVE.has(j.status), worker: j.workerName || '', attempts: j.attempts,
    done: j.progress.done, total: j.progress.total, msg: j.progress.msg, log: (j.log || []).slice(-30), result: j.result, error: j.error || null, startedAt: j.startedAt ? new Date(j.startedAt).getTime() : null,
    endedAt: j.completedAt ? new Date(j.completedAt).getTime() : null, createdAt: j.createdAt, auto: j.auto, distributed: true };
}
async function job(id) { return view(await backend.job(id)); }
/** The job itself (the server checks with it that a computer only fetches data for its own job). */
async function rawJob(id) { return backend ? backend.job(id) : null; }
/** The waiting / running jobs of one type, as they are (with their payload): for whoever keeps the queue fed. */
async function liveOf(type) { return (await backend.live()).filter((j) => j.type === type); }
async function live() { return (await backend.live()).sort(order).map(view); }
async function recent(n) { return (await backend.recent(n || 20)).map(view); }
async function workersView() {
  const t = now();
  const jobsBy = new Map();
  for (const j of await backend.live()) if (j.workerId) { const a = jobsBy.get(j.workerId) || []; a.push(view(j)); jobsBy.set(j.workerId, a); }
  return (await backend.workers()).filter((w) => !w.revoked).map((w) => ({ id: w.id, name: w.name, caps: w.caps, createdAt: w.createdAt, lastSeen: w.lastSeen, online: t - new Date(w.lastSeen || 0).getTime() < OFFLINE_MS, jobs: jobsBy.get(w.id) || [], done: w.done || 0, failed: w.failed || 0 }));
}
async function stats() {
  const l = await backend.live();
  const ws = await workersView();
  return { queued: l.filter((j) => j.status === 'queued').length, running: l.filter((j) => j.status !== 'queued').length, workers: ws.length, online: ws.filter((w) => w.online).length };
}

module.exports = { cloudRamMB, liveOf, rawJob, use, register, handler, enqueue, claim, heartbeat, complete, fail, cancel, sweep, newPairing, pair, workerByToken, hello, revoke, cloudTick, job, live, recent, workersView, stats, onChange, LEASE_MS, OFFLINE_MS, sha };
