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
  // a job may ask for more than memory: e.g. the AI question, only a computer that has the model asked for
  if (h.canTake && !h.canTake(w, j)) return false;
  const need = (h.needs && h.needs.ramMB) || 0;
  return !need || (Number(w.caps.ramMB) || 0) >= need;
}

/**
 * A worker asks for work. → up to `max` jobs, now its own until their lease ends. The best job first: the highest
 * priority, what a person asked for before what the program queued, the oldest.
 */
// quick work (a question to the AI of a computer): a lane of its own on each computer, never behind the long jobs
// (and the research of ONE product a person waits for: its own lane too — codes.one, lib/jobtypes.js)
const QUICK = new Set(['ai.call', 'codes.one']);
async function claim(workerId, max, types) {
  const w = await backend.worker(workerId);
  if (!w || w.revoked) return [];
  await touchWorker(w, {});
  const only = Array.isArray(types) && types.length ? new Set(types.map(String)) : null;
  const quick = only && [...only].every((t) => QUICK.has(t));
  const room = quick ? 1 : Math.max(0, Math.min(Number(max) || 1, (Number(w.caps.slots) || 1) - (await backend.byWorker(w.id)).filter((x) => !QUICK.has(x.type)).length));
  if (!room) return [];
  const out = [];
  // the backend hands a job to one worker only, even when two ask at the same moment (PostgreSQL: SKIP LOCKED)
  for (let i = 0; i < room; i++) {
    const j = await backend.takeNext((x) => fits(w, x) && (!only || only.has(x.type)) && (!x.notBefore || x.notBefore <= now()), (x) => {
      x.status = 'assigned'; x.workerId = w.id; x.workerName = w.name; x.attempts++; x.leaseUntil = now() + LEASE_MS;
      x.startedAt = iso(); x.beatAt = now(); x.restartGrace = 0; x.progress = { done: 0, total: 0, msg: 'Ξεκινάει στο ' + w.name };
    });
    if (!j) break;
    const h = handler(j.type);
    out.push({ id: j.id, type: j.type, attempt: j.attempts, payload: h.prepare ? await h.prepare(j.payload, j) : j.payload, leaseMs: LEASE_MS });
  }
  if (out.length) changed();
  return out;
}

/** «Still working»: the lease is extended, the progress shown. → { cancel } (the person stopped it: end now). */
// (attempt fencing: a try of a job that was given out again — even to the same computer — is not the job any more)
const staleTry = (j, attempt) => attempt != null && attempt !== '' && Number(attempt) !== Number(j.attempts);
async function heartbeat(workerId, jobId, progress, logLines, partial, attempt) {
  const j = await backend.job(jobId);
  if (!j || j.workerId !== workerId || !LIVE.has(j.status) || staleTry(j, attempt)) return { cancel: true, gone: true };
  j.status = 'running';
  j.leaseUntil = now() + LEASE_MS;
  j.beatAt = now();
  if (progress) j.progress = { done: Number(progress.done) || 0, total: Number(progress.total) || 0, msg: String(progress.msg || '').slice(0, 300) };
  if (Array.isArray(logLines) && logLines.length) { j.log = (j.log || []).concat(logLines.map((l) => String(l).slice(0, 300))).slice(-100); }
  // a part of the result, handed in while the work goes on: taken in now (a computer that goes off loses nothing)
  let took = 0;
  if (partial && typeof partial === 'object') took = await takePartial(j, partial);
  await backend.save(j, { light: !took });
  const w = await backend.worker(workerId);
  if (w) await touchWorker(w, {});
  changed();
  return { cancel: !!j.cancel, took };
}
/** A part of a job's result (handler.applyPartial → the keys it wrote): remembered, so a retry does not redo them. */
async function takePartial(j, partial) {
  const h = handler(j.type);
  if (!h || !h.applyPartial) return 0;
  let keys = [];
  try { keys = (await h.applyPartial(j, partial)) || []; } catch (e) { console.error('[coord partial]', j.type, e.message); return 0; }
  if (keys.length) j.payload = Object.assign({}, j.payload, { doneKeys: [...new Set((j.payload.doneKeys || []).concat(keys))].slice(0, 500) });
  return keys.length;
}

/**
 * The result of a job. Taken in once: a second delivery of the same result (same idempotency key) is answered «ok»
 * without doing anything; a result for a job that is no longer this worker's is refused.
 */
async function complete(workerId, jobId, idemKey, result, attempt) {
  const j = await backend.job(jobId);
  if (!j) return { ok: false, error: 'Η εργασία δεν υπάρχει.' };
  if (j.status === 'completed') return j.idem && j.idem === idemKey ? { ok: true, again: true } : { ok: false, error: 'Η εργασία έχει ήδη ολοκληρωθεί από άλλον.' };
  if (j.workerId !== workerId || !LIVE.has(j.status) || staleTry(j, attempt)) return { ok: false, error: 'Η εργασία δεν είναι πια δική σου (έληξε ο χρόνος ή σταμάτησε).' };
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
function ev(e) { try { require('./events').record(e); } catch (_) { /* the log never breaks the queue */ } }
async function finish(j, status) {
  j.status = status; j.completedAt = iso(); j.leaseUntil = 0;
  if (status === 'failed') ev({ severity: 'error', service: 'queue', code: 'JOB_FAILED', message: `${j.label || j.type}: ${j.error || 'απέτυχε'} (προσπάθειες ${j.attempts}/${j.maxAttempts})`, jobId: j.id });
  if (status !== 'completed' && status !== 'failed') j.progress = Object.assign({}, j.progress, { msg: status === 'cancelled' ? 'Σταμάτησε.' : j.progress.msg });
  await backend.save(j);
  const h = handler(j.type);
  if (h && h.after) { try { await h.after(j); } catch (e) { console.error('[coord after]', j.type, e.message); } }
  changed();
  return { ok: status === 'completed', status };
}

/** The worker could not do it. Retryable errors go back to the queue (a little later), up to maxAttempts. */
async function fail(workerId, jobId, error, retryable, attempt) {
  const j = await backend.job(jobId);
  if (!j || j.workerId !== workerId || !LIVE.has(j.status) || staleTry(j, attempt)) return { ok: false };
  j.error = String(error || 'Άγνωστο σφάλμα').slice(0, 500);
  if (j.cancel) return finish(j, 'cancelled');
  if (retryable !== false && j.attempts < j.maxAttempts) return requeue(j, 30000 * j.attempts);
  return finish(j, 'failed');
}
/**
 * The computer gives a job back (it updates itself, a person switched it off, it closes): to the queue at once and the
 * try is not counted — up to 5 times for one job (a computer that always gives it back does not hold it for ever).
 */
async function release(workerId, jobId, attempt, why) {
  const j = await backend.job(jobId);
  if (!j || j.workerId !== workerId || !LIVE.has(j.status) || staleTry(j, attempt)) return { ok: false };
  if (j.cancel) return finish(j, 'cancelled');
  j.releases = (j.releases || 0) + 1;
  if (j.releases <= 5) j.attempts = Math.max(0, (j.attempts || 1) - 1);
  j.error = String(why || 'Ο υπολογιστής την έδωσε πίσω.').slice(0, 200);
  ev({ severity: 'info', service: 'queue', code: 'JOB_RELEASED', message: `${j.label || j.type}: ${j.workerName || workerId} την έδωσε πίσω (${j.error}) — ξανά στη σειρά`, jobId: j.id });
  if (j.attempts >= j.maxAttempts) return finish(j, 'failed');
  return requeue(j, 0);
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

/**
 * Is this job still worked on, by what its computer says (the jobs of its runners, in its load report every 3 s)?
 * Set by the program; lib/coord knows no load reports. → true | false | null (nothing known: the lease decides).
 */
let aliveCheck = null;
function setAliveCheck(fn) { aliveCheck = typeof fn === 'function' ? fn : null; }
// a computer that says its runner still works on the job, while its «still working» does not arrive (a slow answer of
// the cloud, a request that hangs): the job waits up to 10 minutes since its last «still working», not 90 seconds
const ALIVE_GRACE_MS = Number(process.env.SFK_ALIVE_GRACE_MS) || 10 * 60000;
// A restart of the program (every deploy on Render): the computers could not reach us meanwhile — no «still working»,
// no result delivered. A job that was running when this program started gets ONE more lease of this length, counted
// from the start, instead of being taken away at the first sweep (24/11: LEASE_EXPIRED / JOB_FAILED after deploys).
const RESTART_GRACE_MS = Number(process.env.SFK_RESTART_GRACE_MS) || 3 * 60000;
let startedAt = Date.now(); // (when this program started: jobs that beat before it ran on the previous instance)
let lastSweep = 0;
/** Every few seconds: leases that ended go back to the queue; workers not heard of are offline. */
async function sweep() {
  const t = now();
  // the program itself could not run for a while (a small cloud machine busy, a restart): the «still working» of the
  // computers waited in line too — the leases that ended meanwhile get one more lease before they are taken away
  const SWEEP_GAP = Number(process.env.SFK_SWEEP_GAP_MS) || 45000;
  // (the real clock of this machine: how long the program itself did not run — not the time of the queue)
  const wall = Number(process.hrtime.bigint() / 1000000n); // (monotonic: a changed clock does not count)
  const stalled = !!lastSweep && wall - lastSweep > SWEEP_GAP;
  lastSweep = wall;
  for (const j of await backend.live()) {
    // work the program queued by itself that nobody could take for days (all computers off): it ends, said why;
    // the program queues what is still needed anew (a person's request never expires)
    const h = handler(j.type);
    if (j.status === 'queued' && j.auto && h && h.expireMs && t - new Date(j.createdAt).getTime() > h.expireMs) { j.error = 'Κανείς δεν την πήρε για μέρες (υπολογιστές κλειστοί): μπαίνει ξανά στη σειρά όταν χρειαστεί.'; await finish(j, 'cancelled'); continue; }
    if (j.status === 'queued' || !j.leaseUntil || j.leaseUntil > t) continue;
    if (j.workerId !== 'cloud' && !j.cancel && (j.beatAt || 0) < startedAt && !j.restartGrace) {
      j.restartGrace = startedAt; j.leaseUntil = startedAt + RESTART_GRACE_MS;
      if (j.leaseUntil > t) { await backend.save(j, { light: true }); continue; }
    }
    let still = null;
    if (j.workerId !== 'cloud' && !j.cancel) {
      try { still = aliveCheck ? aliveCheck(j) : null; } catch (_) { still = null; }
      if (stalled || (still === true && t - (j.beatAt || 0) < ALIVE_GRACE_MS)) { j.leaseUntil = t + LEASE_MS; await backend.save(j, { light: true }); continue; }
    }
    // given out, never started (no «still working» at all): the answer of the hand-out was lost on the way (a restart,
    // the network) — back to the queue at once, WITHOUT using up a try
    if (still === false && j.status === 'assigned') {
      j.attempts = Math.max(0, (j.attempts || 1) - 1);
      j.error = '';
      ev({ severity: 'info', service: 'queue', code: 'CLAIM_LOST', message: `${j.label || j.type}: η ανάθεση στο ${j.workerName || j.workerId} δεν έφτασε σε εργάτη — ξανά στη σειρά (χωρίς να χαθεί προσπάθεια)` });
      await requeue(j, 0);
      continue;
    }
    // (the computer answers and says none of its runners has this job: said so — not «stopped answering»)
    j.error = still === false ? `Ο υπολογιστής «${j.workerName || j.workerId}» απαντά, αλλά κανένας εργάτης του δεν δουλεύει πια αυτή την εργασία.` : `Ο υπολογιστής «${j.workerName || j.workerId}» σταμάτησε να απαντά.`;
    ev({ severity: 'warn', service: 'queue', code: 'LEASE_EXPIRED', message: `${j.label || j.type}: ${j.error} — ${j.cancel ? 'ακυρώνεται' : j.attempts < j.maxAttempts ? 'ξανά στη σειρά' : 'τέλος προσπαθειών'}`, jobId: j.id });
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
async function newPairing(by, minutes) {
  const code = Array.from(crypto.randomBytes(8)).map((b) => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[b % 32]).join('');
  // 15 minutes for a code typed by hand; the one inside an installer file lives longer (one use, all the same)
  const m = Math.max(5, Math.min(48 * 60, Number(minutes) || 15));
  await backend.savePairing({ hash: sha(code), by: by || '', until: now() + m * 60000 });
  return { code: code.slice(0, 4) + '-' + code.slice(4), minutes: m };
}
/** A computer with a pairing code becomes a worker. → { id, token } (the token is shown only this once). */
async function pair(code, name, caps) {
  const c = String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const p = c.length === 8 ? await backend.takePairing(sha(c)) : null;
  if (!p || p.until < now()) throw Object.assign(new Error('Ο κωδικός δεν ισχύει (λάθος ή έληξε). Φτιάξε νέο από Ρυθμίσεις → Υπολογιστές.'), { status: 403 });
  const token = 'sfkw_' + crypto.randomBytes(32).toString('base64url');
  // a new computer starts stopped (it uses nothing until a person switches it on: Ρυθμίσεις → Σύστημα)
  const w = { id: U.uid('w'), name: U.collapse(String(name || 'Υπολογιστής')).slice(0, 60), tokenHash: sha(token), caps: cleanCaps(caps), createdAt: iso(), by: p.by, mode: 'off', lastSeen: iso(), online: true, revoked: false, load: 0, done: 0, failed: 0 };
  await backend.saveWorker(w);
  changed();
  return { id: w.id, name: w.name, token };
}
function cleanCaps(caps) {
  const c = caps || {};
  return {
    cpus: Math.max(0, Math.min(256, Number(c.cpus) || 0)), cpuModel: String(c.cpuModel || '').slice(0, 80), ramMB: Math.max(0, Number(c.ramMB) || 0), freeMB: Math.max(0, Number(c.freeMB) || 0),
    version: String(c.version || '').slice(0, 20), platform: String(c.platform || '').slice(0, 20), types: Array.isArray(c.types) ? c.types.map(String).slice(0, 30) : [],
    // (as many as the computer says, up to 32: a cap of 4 left 8 of the 12 runners of a strong PC without work)
    slots: Math.max(1, Math.min(32, Number(c.slots) || 1)), battery: !!c.battery, busyUser: !!c.busyUser,
    ollama: Array.isArray(c.ollama) ? c.ollama.map((x) => String(x).slice(0, 80)).slice(0, 20) : null,
    // why its Ollama can / cannot answer (shown in Ρυθμίσεις → Υπολογιστές and in the AI test)
    ollamaInfo: c.ollamaInfo && typeof c.ollamaInfo === 'object' ? { ok: !!c.ollamaInfo.ok, version: String(c.ollamaInfo.version || '').slice(0, 20), error: String(c.ollamaInfo.error || '').slice(0, 200), at: Number(c.ollamaInfo.at) || 0 } : null,
    rev: String(c.rev || '').slice(0, 20),
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
/** How a computer works: 'always' (in the background), 'app' (only while the program is open somewhere), 'off'. */
async function setMode(id, mode) {
  const w = await backend.worker(id);
  if (!w || w.revoked) return false;
  w.mode = ['always', 'app', 'off'].includes(mode) ? mode : 'always';
  await backend.saveWorker(w);
  // switched off by a person: what it was doing goes back to the queue now (another computer or the cloud takes it),
  // without using up a try; its runners learn it at their next «still working» and stop
  if (w.mode === 'off') for (const j of await backend.byWorker(id)) if (j.type !== 'ai.call') await release(id, j.id, null, 'Ο υπολογιστής σταμάτησε από τις Ρυθμίσεις.');
  changed();
  return true;
}
/** How much of a computer the work may use: 'gentle' (Ήπια) · 'normal' (Κανονική) · 'boost' (Ενίσχυση) — lib/perf.js. */
async function setPerf(id, profile) {
  const w = await backend.worker(id);
  if (!w || w.revoked) return false;
  w.perf = ['gentle', 'normal', 'boost'].includes(profile) ? profile : 'normal';
  await backend.saveWorker(w);
  changed();
  return true;
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
/**
 * At the start of the program: the jobs the cloud itself was doing when it stopped (a restart, a deploy) are not
 * running any more — they go back to the queue at once (they used to wait an hour for their lease), counted as a try.
 */
async function recoverCloud() {
  let n = 0;
  for (const j of await backend.live()) {
    if (j.workerId !== 'cloud' || j.status === 'queued') continue;
    // a restart of the cloud (a new version, the free plan's sleep) is not the job's fault: it does not use up one of
    // its tries — up to 3 restarts (a job that brings the machine down every time still ends, said why)
    j.restarts = (j.restarts || 0) + 1;
    j.error = 'Το πρόγραμμα στο cloud ξεκίνησε ξανά στη μέση της εργασίας.';
    if (j.cancel) await finish(j, 'cancelled');
    else if (j.restarts <= 3) { j.attempts = Math.max(0, (j.attempts || 1) - 1); await requeue(j, 0); }
    else await finish(j, 'failed');
    n++;
  }
  return n;
}
// whether a computer should work now (its mode, set by the program: lib/coord knows no screens) — a stopped computer
// never keeps work from the cloud
let activeCheck = null;
function setActiveCheck(fn) { activeCheck = typeof fn === 'function' ? fn : null; }
/** Is any computer of the shops able to take this job now (or lately)? */
async function someoneFor(j) {
  const t = now();
  for (const w of await backend.workers()) if (!w.revoked && fits(w, j) && (!activeCheck || activeCheck(w)) && t - new Date(w.lastSeen || 0).getTime() < CLOUD_AFTER_MS) return true;
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
      signal: ctl.signal, id: j.id, type: j.type, cloud: true,
      cancelled: () => !!j.cancel,
      partial: async (part) => { try { if (await takePartial(j, part)) await backend.save(j); } catch (_) { /* the whole result comes at the end anyway */ } },
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
/** How many jobs (not the quick questions to the AI) a computer holds now — it finishes them before it rests. */
async function heldBy(workerId) { return (await backend.byWorker(workerId)).filter((j) => j.type !== 'ai.call' && (j.status === 'assigned' || j.status === 'running') && !j.cancel).length; }
async function liveOf(type) { return (await backend.live()).filter((j) => j.type === type); }
async function live() { return (await backend.live()).sort(order).map(view); }
async function recent(n) { return (await backend.recent(n || 20)).map(view); }
async function workersView() {
  const t = now();
  const jobsBy = new Map();
  for (const j of await backend.live()) if (j.workerId) { const a = jobsBy.get(j.workerId) || []; a.push(view(j)); jobsBy.set(j.workerId, a); }
  return (await backend.workers()).filter((w) => !w.revoked).map((w) => ({ id: w.id, name: w.name, caps: w.caps, mode: w.mode || 'off', perf: w.perf || 'normal', createdAt: w.createdAt, lastSeen: w.lastSeen, online: t - new Date(w.lastSeen || 0).getTime() < OFFLINE_MS, jobs: jobsBy.get(w.id) || [], done: w.done || 0, failed: w.failed || 0 }));
}
/** For the health check: work stuck (its lease long gone), waiting for days, failed in the last day. */
async function healthOf() {
  const t = now();
  const live = await backend.live();
  const failed = (await backend.recent(100)).filter((j) => j.status === 'failed' && j.completedAt && t - new Date(j.completedAt).getTime() < 864e5);
  return {
    queued: live.filter((j) => j.status === 'queued').length, running: live.filter((j) => j.status !== 'queued').length,
    stuck: live.filter((j) => j.status !== 'queued' && j.leaseUntil && j.leaseUntil < t - 5 * 60000).length,
    old: live.filter((j) => j.status === 'queued' && j.createdAt && t - new Date(j.createdAt).getTime() > 2 * 864e5).length,
    failed: failed.length,
    // (the last 3 hours apart: failures of a problem already solved do not keep the queue yellow for a whole day)
    failedRecent: failed.filter((j) => t - new Date(j.completedAt).getTime() < 3 * 3600e3).length,
  };
}
async function stats() {
  const l = await backend.live();
  const ws = await workersView();
  return { queued: l.filter((j) => j.status === 'queued').length, running: l.filter((j) => j.status !== 'queued').length, workers: ws.length, online: ws.filter((w) => w.online).length };
}

module.exports = { _setStartedAt: (t) => { startedAt = t; }, heldBy, release, setAliveCheck, healthOf, someoneFor, setActiveCheck, recoverCloud, takePartial, setMode, setPerf, cloudRamMB, liveOf, rawJob, use, register, handler, enqueue, claim, heartbeat, complete, fail, cancel, sweep, newPairing, pair, workerByToken, hello, revoke, cloudTick, job, live, recent, workersView, stats, onChange, LEASE_MS, OFFLINE_MS, sha };
