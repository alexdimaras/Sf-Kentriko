'use strict';
// the little shops of the tests run on this machine: the program may open private addresses here (never in use)
process.env.SFK_ALLOW_PRIVATE = '1';
// SF Κέντρο — tests of the shared queue (lib/coord.js): one job to one computer, leases, retries, no double results.
const fs = require('fs');
const os = require('os');
const path = require('path');

const APP = path.join(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sfk-coord-'));
process.env.SFK_DATA = path.join(tmp, 'data');
process.env.APPDATA = path.join(tmp, 'cfg');
fs.mkdirSync(process.env.SFK_DATA, { recursive: true });

let fails = 0, passes = 0;
function ok(cond, name, detail) {
  if (cond) passes++; else fails++;
  console.log((cond ? '  ok   ' : '  FAIL ') + name + (cond || detail === undefined ? '' : ' — ' + detail));
}
const section = (t) => console.log('\n' + t);

// a clock the tests move forward
const realNow = Date.now;
let skew = 0;
Date.now = () => realNow() + skew;
const later = (ms) => { skew += ms; };

/** A backend for PostgreSQL is tested by the same suite: COORD_PG=postgres://… (see lib/db.js). */
async function makeBackend() {
  if (process.env.COORD_PG) { const db = require(APP + '/lib/db'); const pool = await db.connect(process.env.COORD_PG); await db.reset(pool); return db.coordBackend(pool); }
  return require(APP + '/lib/coord-store').fileBackend();
}

(async () => {
  const store = require(APP + '/lib/store'); store.init();
  const coord = require(APP + '/lib/coord');
  const backend = await makeBackend();
  coord.use(backend);
  const applied = [];
  coord.register('test.heavy', { label: 'Βαριά', needs: { ramMB: 6000 }, maxAttempts: 2, apply: (j, r) => { applied.push([j.id, r.n]); return { n: r.n }; }, run: async () => ({ n: 99 }) });
  coord.register('test.light', { label: 'Ελαφριά', fresh: 60 * 60000, apply: (j, r) => { applied.push([j.id, r.n]); return { n: r.n }; }, run: async (p, api) => { api.progress(1, 1, 'εδώ'); return { n: p.n * 10 }; } });
  coord.register('test.local', { label: 'Μόνο σε υπολογιστή', cloudOk: false, apply: (j, r) => r });

  section('Υπολογιστές: σύζευξη με κωδικό μίας χρήσης');
  const code = await coord.newPairing('alex');
  ok(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(code.code) && code.minutes === 15, 'a one-off code of 8 characters, valid 15 minutes', code.code);
  const big = await coord.pair(code.code.toLowerCase(), 'PC Μαγαζί 1', { cpus: 8, ramMB: 16000, types: [], slots: 2, version: '1.5.0' });
  ok(big.token.startsWith('sfkw_') && big.token.length > 40, 'the computer gets a long secret token (shown only once)');
  let err = null; try { await coord.pair(code.code, 'again', {}); } catch (e) { err = e; }
  ok(err && /δεν ισχύει/.test(err.message), 'the same code cannot be used twice');
  const c2 = await coord.newPairing('alex');
  const old = await coord.pair(c2.code, 'Παλιό Core Duo', { cpus: 2, ramMB: 4000, slots: 1 });
  ok((await coord.workerByToken(big.token)).id === big.id && !(await coord.workerByToken('sfkw_wrong')) && !(await coord.workerByToken('')), 'the token finds its computer; a wrong one finds nothing');
  const saved = JSON.stringify(await backend.workers());
  ok(!saved.includes(big.token) && saved.includes(coord.sha(big.token)), 'only a fingerprint (hash) of the token is kept, never the token itself');
  const c3 = await coord.newPairing('alex');
  later(16 * 60000);
  err = null; try { await coord.pair(c3.code, 'late', {}); } catch (e) { err = e; }
  ok(err, 'a code older than 15 minutes is refused');

  section('Ουρά: κάθε εργασία σε έναν υπολογιστή, ο κατάλληλος');
  const h1 = await coord.enqueue('test.heavy', { n: 1 }, { dedupKey: 'heavy:1', priority: 1 });
  const again = await coord.enqueue('test.heavy', { n: 1 }, { dedupKey: 'heavy:1' });
  ok(again.id === h1.id && again.joined, 'asking again for the same work joins the one waiting (no second job)');
  const l1 = await coord.enqueue('test.light', { n: 2 }, { dedupKey: 'light:2', auto: true });
  const l2 = await coord.enqueue('test.light', { n: 3 }, { dedupKey: 'light:3' });
  let got = await coord.claim(old.id, 5);
  ok(got.length === 1 && got[0].id === l2.id, 'the old PC (4 GB) gets one light job — the one a person asked for before the automatic one; never the heavy job', JSON.stringify(got.map((x) => x.id)));
  got = await coord.claim(big.id, 5);
  ok(got.length === 2 && got[0].id === h1.id && got[1].id === l1.id, 'the strong PC gets the heavy job first (priority), and has room for two', JSON.stringify(got.map((x) => x.type)));
  ok((await coord.claim(big.id, 5)).length === 0, 'nothing more while it is full');

  section('Αποτέλεσμα μία φορά (idempotency)');
  const r1 = await coord.complete(old.id, l2.id, 'idem-1', { n: 30 });
  const r2 = await coord.complete(old.id, l2.id, 'idem-1', { n: 30 });
  const r3 = await coord.complete(old.id, l2.id, 'idem-2', { n: 31 });
  ok(r1.ok && r2.ok && r2.again && !r3.ok && applied.filter((a) => a[0] === l2.id).length === 1, 'the same result sent twice is written once; a different second result is refused', JSON.stringify([r1, r2, r3]));
  const cached = await coord.enqueue('test.light', { n: 3 }, { dedupKey: 'light:3' });
  ok(cached.cached && cached.id === l2.id, 'a fresh result is used again instead of doing the work again');

  section('Heartbeat, μίσθωση, επανάληψη σε άλλον');
  ok(!(await coord.heartbeat(big.id, h1.id, { done: 1, total: 4, msg: 'δουλεύει' })).cancel, 'heartbeat: the job goes on');
  ok((await coord.heartbeat(old.id, h1.id, {})).gone, 'another computer cannot speak for a job that is not its own');
  later(60000); await coord.heartbeat(big.id, h1.id, {}); later(60000); await coord.sweep();
  ok((await coord.job(h1.id)).status === 'running', 'a worker that keeps saying «still working» keeps its job beyond the first 90 s');
  later(100000); await coord.sweep();
  let j = await coord.job(h1.id);
  ok(j.status === 'queued' && /σταμάτησε να απαντά/.test(j.error), 'a worker that goes silent loses the job when its lease ends: back to the queue', j.status + ' ' + j.error);
  const c4 = await coord.newPairing('alex');
  const big2 = await coord.pair(c4.code, 'PC Μαγαζί 2', { cpus: 8, ramMB: 8000 });
  got = await coord.claim(big2.id, 1);
  ok(got.length === 1 && got[0].id === h1.id && got[0].attempt === 2, 'another strong PC takes it (2nd attempt)');
  const late = await coord.complete(big.id, h1.id, 'k-old', { n: 5 });
  ok(!late.ok && /δεν είναι πια δική σου/.test(late.error) && !applied.some((a) => a[0] === h1.id), 'a late result from the computer that lost the job is refused (nothing is written)');
  later(200000); await coord.sweep();
  ok((await coord.job(h1.id)).status === 'failed', 'after its last attempt a job that never finishes is marked failed (not retried for ever)');

  section('Διακοπή');
  const l4 = await coord.enqueue('test.light', { n: 4 }, {});
  const cq = await coord.cancel(l4.id);
  ok(cq.status === 'cancelled', 'a job still in the queue is stopped at once');
  const l5 = await coord.enqueue('test.light', { n: 5 }, {});
  await coord.complete(big.id, l1.id, 'x', { n: 20 });
  got = await coord.claim(big.id, 1);
  await coord.cancel(l5.id);
  ok((await coord.heartbeat(big.id, l5.id, {})).cancel === true, 'a running job is told at its next heartbeat: stop');
  await coord.fail(big.id, l5.id, 'stopped', false);
  ok((await coord.job(l5.id)).status === 'cancelled', 'and ends as stopped, not as failed');

  section('Αφαίρεση υπολογιστή');
  const l6 = await coord.enqueue('test.light', { n: 6 }, {});
  got = await coord.claim(big2.id, 1);
  await coord.revoke(big2.id);
  ok((await coord.job(l6.id)).status === 'queued' && !(await coord.workerByToken(big2.token)), 'a removed computer loses its token and its jobs go back to the queue at once');

  section('Το cloud ως τελευταίος worker');
  ok(!(await coord.cloudTick()), 'while a computer of the shops is online, the cloud leaves the work to it');
  later(11 * 60000);
  ok(await coord.cloudTick(), 'no computer for 10 minutes: the cloud does the job itself');
  j = await coord.job(l6.id);
  ok(j.status === 'completed' && j.worker === 'cloud' && j.result.n === 60, 'with the same code a worker runs', JSON.stringify(j && [j.status, j.worker, j.result]));
  const loc = await coord.enqueue('test.local', {}, {});
  await coord.cloudTick();
  ok((await coord.job(loc.id)).status === 'queued', 'work that needs a shop PC is never done by the cloud');
  coord.register('test.big', { label: 'Μεγάλη', needs: { ramMB: 1500 }, cloudRamMB: 450, apply: (jj, r) => r, run: async () => ({ n: 1 }) });
  const bigJob = await coord.enqueue('test.big', {}, {});
  later(11 * 60000);
  process.env.SFK_CLOUD_RAM_MB = '400';
  await coord.cloudTick();
  ok((await coord.job(bigJob.id)).status === 'queued', 'the cloud never takes work bigger than its memory (450 MB measured > 400 MB it has)');
  process.env.SFK_CLOUD_RAM_MB = '600';
  ok(!(await coord.cloudTick({ canRun: () => false })), 'nor beside another heavy job of its own');
  await coord.cloudTick();
  ok((await coord.job(bigJob.id)).status === 'completed', 'with enough memory and nothing else heavy, it does it');
  delete process.env.SFK_CLOUD_RAM_MB;
  const ws = await coord.workersView();
  ok(ws.length === 2 && ws.every((w) => w.caps && 'online' in w) && !JSON.stringify(ws).includes('tokenHash'), 'the list of computers shows what they are, never their token');

  section('Ταυτόχρονα αιτήματα: καμία εργασία σε δύο υπολογιστές');
  {
    const ids = [];
    for (let i = 0; i < 30; i++) ids.push((await coord.enqueue('test.light', { n: i }, {})).id);
    const many = [];
    for (let i = 0; i < 6; i++) { const cc = await coord.newPairing('alex'); many.push(await coord.pair(cc.code, 'PC ' + i, { cpus: 4, ramMB: 8000, slots: 4 })); }
    const rounds = await Promise.all(many.map((w) => coord.claim(w.id, 4)));
    const given = rounds.flat().map((x) => x.id);
    const owners = new Map();
    for (const w of many) for (const j2 of (await coord.workersView()).find((x) => x.id === w.id).jobs) owners.set(j2.id, (owners.get(j2.id) || 0) + 1);
    ok(given.length === new Set(given).size && [...owners.values()].every((n) => n === 1), `6 computers asking at once: ${given.length} jobs given, each to one computer only`, JSON.stringify(given.length));
  }

  console.log(`\n${passes} ok, ${fails} failed`);
  if (backend.close) await backend.close();
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) { /* ignore */ }
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
