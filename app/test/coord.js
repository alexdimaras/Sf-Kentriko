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
const LIVE = (st) => st === 'assigned' || st === 'running';
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

  // ---- the profiles of a computer (Ήπια / Κανονική / Ενίσχυση): pure rules, then kept per computer ----
  {
    const perf = require(APP + '/lib/perf');
    const P = (x) => perf.policy(Object.assign({ cpus: 8, ramTotalMB: 16384, ramUsedPct: 40, cpuPct: 20, ollama: false }, x));
    const g = P({ profile: 'gentle' }), n = P({ profile: 'normal' }), b = P({ profile: 'boost' });
    ok(g.slots === 2 && g.pages === 1 && n.slots === 4 && n.pages === 2 && b.slots === 8 && b.pages === 3, '8 cores / 16 GB: gentle 2 jobs (1 page) · normal 4 (2) · boost 8 (3)', JSON.stringify([g.slots, n.slots, b.slots]));
    ok(g.domainGap > n.domainGap && n.domainGap > b.domainGap && !('engineGap' in b), 'the gentler, the more polite to each shop; the pace of the search engines is not the profile\'s to change');
    ok(P({ profile: 'boost', ramTotalMB: 8192, ollama: true }).slots === 1, '8 GB with the AI model: the room of Ollama is kept → 1 job');
    const down = P({ profile: 'normal', ramUsedPct: 85 });
    ok(down.used === 'gentle' && down.down && /μνήμη/.test(down.reason) && down.slots === 2, 'memory over the line → one profile down by itself, and says why', JSON.stringify(down));
    ok(P({ profile: 'boost', ramUsedPct: 96 }).slots === 1, 'memory almost full → one job only');
    ok(P({ profile: 'boost', cpuPct: 95 }).used === 'normal', 'the processor busy with the person\'s work → one step down');
    ok(P({ profile: 'boost' }).used === 'boost' && P({ profile: 'x' }).profile === 'normal', 'free computer: the chosen profile · unknown → normal');
    const prp = await coord.newPairing('t');
    const wp = await coord.pair(prp.code, 'PC-perf', { cpus: 8, ramMB: 16000 });
    await coord.setPerf(wp.id, 'gentle');
    ok((await coord.workersView()).find((x) => x.id === wp.id).perf === 'gentle', 'the profile is kept per computer (and given to it with its «hello»)');
  }

  // ---- a computer: starts stopped, keeps no work from the cloud while stopped; installer; its own update ----
  {
    const prs = await coord.newPairing('t', 24 * 60);
    ok(prs.minutes === 24 * 60, 'the code inside an installer file lives 24 hours (a code by hand: 15 minutes)');
    const ws = await coord.pair(prs.code, 'PC-new', { cpus: 4, ramMB: 8000, types: ['test.light'] });
    ok((await coord.workersView()).find((x) => x.id === ws.id).mode === 'off', 'a new computer starts STOPPED (uses nothing until switched on)');
    coord.setActiveCheck((w) => (w.mode || 'off') !== 'off');
    const others = (await coord.workersView()).filter((x) => x.id !== ws.id);
    for (const o of others) await coord.setMode(o.id, 'off');
    const jw = await coord.enqueue('test.light', { n: 7 }, {});
    const jr = await coord.rawJob(jw.id);
    ok(await coord.someoneFor(jr) === false, 'only stopped computers → nobody keeps the job: the cloud does it');
    await coord.setMode(ws.id, 'always');
    ok(await coord.someoneFor(jr) === true, 'switched on → the job waits for the computer (faster than the cloud)');
    await coord.cancel(jw.id);
    coord.setActiveCheck(null);

    const inst = require(APP + '/lib/installer');
    const txt = inst.cmdText({ server: 'https://sf-kentro.onrender.com', code: 'ABCD-EF23', zip: 'https://github.com/a/b/archive/refs/heads/x.zip', until: '24/11' });
    ok(/set "CODE=ABCD-EF23"/.test(txt) && /worker\.js" ensure/.test(txt) && /SF-Kentro-Worker\.vbs/.test(txt) && /\r\n/.test(txt) && /STAMATIMENOS/.test(txt), 'installer: address + one-time code, «ensure» (no second pairing), starts with Windows, says it starts stopped');
    // (seen 24/11: run again on an installed computer, it did not download — the old worker stayed)
    ok(!/goto connect\r\n[\s\S]*Katevasma/.test(txt.split(':connect')[0].replace(/:nodl[\s\S]*/, '')) && !/if exist "%DEST%\\runtime\\node\.exe" if exist/.test(txt) && txt.indexOf('Invoke-WebRequest') < txt.indexOf(':connect'), 'installer: always downloads the current program, also over an older installation');
    let bad = null; try { inst.cmdText({ server: 'https://x.gr" & del *', code: 'A', zip: 'https://github.com/a' }); } catch (e) { bad = e; }
    ok(bad, 'installer: a value that could break out of the script is refused');
    let bad2 = null; try { inst.cmdText({ server: 'https://x.gr', code: 'ABCD', zip: 'https://evil.example/x.zip' }); } catch (e) { bad2 = e; }
    ok(bad2, 'installer: the program is downloaded only from GitHub');

    const su = require(APP + '/lib/selfupdate');
    const rev = require(APP + '/lib/workerrev');
    ok(su.shouldUpdate('2026-11-18c', rev).ok && !su.shouldUpdate(rev, rev).ok && !su.shouldUpdate('2026-12-01a', rev).ok, 'update: newer → yes · same → no · never back to an older one');
    ok(!su.shouldUpdate('2026-11-18c', rev, { [rev]: Date.now() - 20 * 60000 }).ok && su.shouldUpdate('2026-11-18c', rev, { [rev]: Date.now() - 61 * 60000 }).ok, 'a revision that failed is tried again after 1 hour, not before (was 6 hours)');
    // (seen 23/11: a worker of 2026-11-23b refused a pack with the computer's menu file — an older one gets only what it knows)
    const OLD_NAMES = /^(worker\.js|package\.json|lib\/[\w.-]+\.js|vendor\/[\w.-]+\.js)$/;
    const pOld = JSON.parse(require('zlib').gunzipSync(su.build(APP, { forRev: '2026-11-23b' }).buf));
    ok(Object.keys(pOld.files).every((n) => OLD_NAMES.test(n)), 'an older worker gets a pack it can take (no file it does not know)', Object.keys(pOld.files).filter((n) => !OLD_NAMES.test(n)).join());
    const pNew = JSON.parse(require('zlib').gunzipSync(su.build(APP, { forRev: rev }).buf));
    ok(Object.keys(pNew.files).every((n) => su.NAME_OK.test(n)), 'a current worker gets the whole pack (also the computer\'s menu)');
    const pk = su.build(APP);
    ok(pk.rev === rev && pk.buf.length < 2e6, `the pack of the worker: its revision, ${Math.round(pk.buf.length / 1024)} KB (not the 40 MB zip)`);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sfk-upd-'));
    fs.mkdirSync(path.join(dir, 'lib')); fs.writeFileSync(path.join(dir, 'worker.js'), 'old'); fs.writeFileSync(path.join(dir, 'lib', 'workerrev.js'), "module.exports = '2026-11-18c';");
    const done = su.apply(pk.buf, dir, { want: rev });
    ok(done.rev === rev && require(path.join(dir, 'lib', 'workerrev.js')) === rev && fs.readFileSync(path.join(dir, 'worker.js'), 'utf8').length > 1000 && !fs.readdirSync(dir).some((n) => n.startsWith('.update-')), 'update applied: every file checked by Node first, then put in place (nothing left behind)');
    const zlib = require('zlib');
    const P = JSON.parse(zlib.gunzipSync(pk.buf));
    const tamper = (fn) => { const q = JSON.parse(JSON.stringify(P)); fn(q); return zlib.gzipSync(Buffer.from(JSON.stringify(q))); };
    fs.writeFileSync(path.join(dir, 'worker.js'), 'mine');
    let e1 = null; try { su.apply(tamper((q) => { q.files['worker.js'].b64 = Buffer.from('evil').toString('base64'); }), dir, { want: rev }); } catch (e) { e1 = e; }
    ok(e1 && /Χαλασμένο/.test(e1.message) && fs.readFileSync(path.join(dir, 'worker.js'), 'utf8') === 'mine', 'a file that does not match its SHA-256 → refused, nothing replaced');
    let e2 = null; try { su.apply(tamper((q) => { q.files['../evil.js'] = q.files['worker.js']; }), dir, { want: rev }); } catch (e) { e2 = e; }
    ok(e2 && /Μη επιτρεπτό/.test(e2.message) && !fs.existsSync(path.join(dir, '..', 'evil.js')), 'a name outside the worker\'s folders → refused');
    let e3 = null; try { const b = Buffer.from('module.exports = ;'); su.apply(tamper((q) => { q.files['lib/perf.js'] = { b64: b.toString('base64'), sha: require('crypto').createHash('sha256').update(b).digest('hex') }; }), dir, { want: rev }); } catch (e) { e3 = e; }
    ok(e3 && /περνά τον έλεγχο/.test(e3.message) && fs.readFileSync(path.join(dir, 'worker.js'), 'utf8') === 'mine', 'a new file Node cannot read → nothing is replaced (the running worker stays as it is)');
    fs.rmSync(dir, { recursive: true, force: true });
  }

  section('Πακέτο διάγνωσης 24/11: προσπάθεια, επιστροφή, «ζωντανός αλλά αργός»');
  {
    const cA = await coord.newPairing('alex');
    const pcA = await coord.pair(cA.code, 'PC Fence', { cpus: 8, ramMB: 8000, slots: 4 });
    coord.register('test.fence', { label: 'Φράχτης', apply: (j2, r) => { applied.push([j2.id, r.n]); return r; } });
    const fj = await coord.enqueue('test.fence', { n: 70 }, {});
    const g1 = (await coord.claim(pcA.id, 1, ['test.fence'])).find((x) => x.id === fj.id);
    ok(g1 && g1.attempt === 1, 'a computer takes a job: try 1', JSON.stringify(g1 && g1.attempt));
    later(100000); await coord.sweep();
    const g2 = (await coord.claim(pcA.id, 1, ['test.fence'])).find((x) => x.id === fj.id);
    ok(g2 && g2.attempt === 2, 'it lost it (silent) and took it again: try 2 — the same computer');
    ok((await coord.heartbeat(pcA.id, fj.id, {}, null, null, 1)).gone && !(await coord.heartbeat(pcA.id, fj.id, {}, null, null, 2)).gone, 'a «still working» of the older try changes nothing; the newer one goes on');
    const oldDone = await coord.complete(pcA.id, fj.id, 'try-1', { n: 1 }, 1);
    ok(!oldDone.ok && !applied.some((x) => x[0] === fj.id), 'the result of the older try is refused (a runner that woke up late never writes over the newer try)');
    ok((await coord.heldBy(pcA.id)) === 1, 'the queue knows how many jobs a computer holds (it finishes them before it rests)');
    const rel = await coord.release(pcA.id, fj.id, 2, 'ο υπολογιστής ενημερώνεται');
    let jj = await coord.job(fj.id);
    ok(rel.ok && jj.status === 'queued' && jj.attempts === 1 && /ενημερώνεται/.test(jj.error), 'a computer that has to stop gives the job back: to the queue at once, the try not counted', JSON.stringify([jj.status, jj.attempts]));
    ok(!(await coord.release(pcA.id, fj.id, 2, 'x')).ok, 'a job given back cannot be given back twice');
    await coord.claim(pcA.id, 1, ['test.fence']);
    await coord.setMode(pcA.id, 'off');
    jj = await coord.job(fj.id);
    ok(jj.status === 'queued' && jj.attempts === 1, 'switched off by a person: its jobs go back to the queue now (not 90 s later, no try used)', JSON.stringify([jj.status, jj.attempts]));
    await coord.setMode(pcA.id, 'always');
    const take = async () => { for (let i = 0; i < 5; i++) { const g = await coord.claim(pcA.id, 4, ['test.fence']); if (g.some((x) => x.id === fj.id)) return true; if (!g.length) return false; } return false; };
    ok(await take(), 'switched on again: it takes the job again');
    // its load report says a runner still has the job, its «still working» is late: it keeps the job (up to 10 minutes)
    coord.setAliveCheck((x) => x.id === fj.id ? true : null);
    later(100000); await coord.sweep();
    { const z = await coord.job(fj.id); ok(LIVE(z.status) && z.worker === 'PC Fence', 'a slow «still working» while the computer says it still works on the job: the job stays its own', JSON.stringify([z.status, z.worker, z.error])); }
    later(11 * 60000); await coord.sweep();
    ok((await coord.job(fj.id)).status === 'queued', '…but not for ever: 10 minutes without any «still working» → back to the queue');
    await take();
    coord.setAliveCheck((x) => x.id === fj.id ? false : null);
    later(100000); await coord.sweep();
    jj = await coord.job(fj.id);
    ok(jj.status !== 'assigned' && /κανένας εργάτης του/.test(jj.error), 'the computer answers but none of its runners has the job: said so (not «stopped answering»)', jj.error);
    coord.setAliveCheck(null);
    // (24/11: a click on «Έρευνα» waited for a free runner) — the research of ONE product has a lane of its own:
    // a computer full of long batches still takes it at once
    coord.register('codes.one', { label: 'Ένα προϊόν', apply: (j2, r2) => r2 });
    await coord.setMode(pcA.id, 'always');
    const fill = [];
    for (let i = 0; i < 4; i++) fill.push(await coord.enqueue('test.fence', { n: 100 + i }, {}));
    await coord.claim(pcA.id, 4, ['test.fence']);
    ok((await coord.claim(pcA.id, 1, ['test.fence'])).length === 0, 'the computer is full of long work (4 of 4)');
    const one = await coord.enqueue('codes.one', { items: [{ k: 'sf:1' }] }, { priority: 40, by: 'person' });
    const q = await coord.claim(pcA.id, 1, ['codes.one']);
    ok(q.length === 1 && q[0].id === one.id, 'the research of one product a person asked for is taken at once on the quick lane', JSON.stringify(q.map((x) => x.type)));
    await coord.revoke(pcA.id);
  }

  console.log(`\n${passes} ok, ${fails} failed`);
  if (backend.close) await backend.close();
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) { /* ignore */ }
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
