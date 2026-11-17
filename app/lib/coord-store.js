'use strict';
// Where the coordinator keeps the queue and the workers.
//  • fileBackend(): the program's data folder (lib/store.js) — for one PC, and for the cloud until a database is set.
//    Jobs live in memory; a change of state (new, given out, finished) is written at once, a heartbeat only in memory
//    (it changes every few seconds). After a restart the running jobs get a fresh lease: if their worker is still
//    there it goes on, if not they return to the queue when the lease ends.
//  • pgBackend(pool): PostgreSQL (Supabase) — the same calls, with row locks so that two computers asking at the same
//    moment never get the same job (FOR UPDATE SKIP LOCKED). See lib/db.js.
const store = require('./store');

const KEEP_DONE = 300; // finished jobs kept (the newest)

function fileBackend() {
  const jobs = new Map();
  const workers = new Map();
  let pairings = [];
  let loaded = false;
  const load = () => {
    if (loaded) return;
    loaded = true;
    const t = Date.now();
    for (const j of store.read('coord-jobs', []) || []) { if (j.status === 'assigned' || j.status === 'running') j.leaseUntil = t + 90000; jobs.set(j.id, j); }
    for (const w of store.read('coord-workers', []) || []) workers.set(w.id, w);
    pairings = (store.read('coord-pairings', []) || []).filter((p) => p.until > t);
  };
  let timer = null;
  const persistJobs = () => {
    clearTimeout(timer); timer = null;
    const all = [...jobs.values()];
    const live = all.filter((j) => ['queued', 'assigned', 'running'].includes(j.status));
    const done = all.filter((j) => !live.includes(j)).sort((a, b) => (b.completedAt || '').localeCompare(a.completedAt || '')).slice(0, KEEP_DONE);
    for (const j of all) if (!live.includes(j) && !done.includes(j)) jobs.delete(j.id);
    store.write('coord-jobs', live.concat(done));
  };
  const soon = () => { if (!timer) timer = setTimeout(persistJobs, 300); };
  const persistWorkers = () => store.write('coord-workers', [...workers.values()]);
  return {
    kind: 'file',
    async save(j, opt) { load(); jobs.set(j.id, j); if (!(opt && opt.light)) soon(); },
    async job(id) { load(); return jobs.get(id) || null; },
    async findByKey(key) { load(); return [...jobs.values()].filter((j) => j.dedupKey === key); },
    async live() { load(); return [...jobs.values()].filter((j) => j.status === 'queued' || j.status === 'assigned' || j.status === 'running'); },
    async byWorker(id) { load(); return [...jobs.values()].filter((j) => j.workerId === id && (j.status === 'assigned' || j.status === 'running')); },
    async recent(n) { load(); return [...jobs.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, n); },
    /** The best queued job that passes `ok`, changed by `take` — in one step (one process: nothing can come between). */
    async takeNext(ok, take) {
      load();
      const order = (a, b) => (b.priority - a.priority) || ((a.auto ? 1 : 0) - (b.auto ? 1 : 0)) || a.createdAt.localeCompare(b.createdAt);
      const j = [...jobs.values()].filter((x) => x.status === 'queued' && ok(x)).sort(order)[0];
      if (!j) return null;
      take(j);
      soon();
      return j;
    },
    async worker(id) { load(); return workers.get(id) || null; },
    async workers() { load(); return [...workers.values()]; },
    async workerByHash(h) { load(); return [...workers.values()].find((w) => w.tokenHash === h) || null; },
    async saveWorker(w, opt) { load(); workers.set(w.id, w); if (!(opt && opt.light)) persistWorkers(); },
    async savePairing(p) { load(); pairings = pairings.filter((x) => x.until > Date.now()).concat([p]); store.write('coord-pairings', pairings); },
    async takePairing(h) { load(); const p = pairings.find((x) => x.hash === h); if (!p) return null; pairings = pairings.filter((x) => x !== p); store.write('coord-pairings', pairings); return p; },
    flush() { if (timer) persistJobs(); },
  };
}

module.exports = { fileBackend };
