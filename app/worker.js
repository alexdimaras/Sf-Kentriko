'use strict';
// SF Κέντρο — the worker of a shop's computer.
// It does the heavy work the cloud program hands it (today: the price research, one competitor at a time) and sends
// back the result. It never decides which data is right and never holds the database password: it only talks to the
// cloud program, with its own token (given once, with a pairing code from Settings → Υπολογιστές).
//
//   node worker.js pair <address> <code>    once: e.g. node worker.js pair https://sf-kentro.onrender.com ABCD-2345
//   node worker.js                           works (in the background: low priority, steps aside on battery)
//   node worker.js status [--all]            what it is (and, with --all, what it tells the cloud)
//
// On Windows: SF-Kentro-Worker.cmd does the pairing and starts it with Windows, hidden, at low priority.
const os = require('os');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const VERSION = require('./package.json').version;
// its own small folder: settings, the token (protected by Windows), the competitor catalogs it read last
const HOME = process.env.SFK_WORKER_HOME || path.join(process.env.APPDATA || path.join(os.homedir(), '.config'), 'SF-Kentro-Worker');
process.env.SFK_DATA = process.env.SFK_DATA || path.join(HOME, 'data');
process.env.APPDATA = process.env.APPDATA || path.join(os.homedir(), '.config');
fs.mkdirSync(process.env.SFK_DATA, { recursive: true });
const CONF = path.join(HOME, 'worker.json');
const POLL = Number(process.env.SFK_POLL_MS) || 15000;
// a shop's own connection: the searches can come a little faster than from the cloud (each engine 2.5–4 s apart)
process.env.SFK_SEARCH_GAP_MS = process.env.SFK_SEARCH_GAP_MS || '2000';

const store = require('./lib/store');
const coord = require('./lib/coord');
const jobtypes = require('./lib/jobtypes');
const secrets = require('./lib/secrets');

const log = (...a) => { const line = `[${new Date().toISOString()}] ${a.join(' ')}`; console.log(line); try { fs.appendFileSync(path.join(HOME, 'worker.log'), line + '\n'); } catch (_) { /* optional */ } };

function readConf() { try { return JSON.parse(fs.readFileSync(CONF, 'utf8')); } catch (_) { return null; } }
function writeConf(c) { fs.mkdirSync(HOME, { recursive: true }); const tmp = CONF + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(c, null, 2)); fs.renameSync(tmp, CONF); }

/** What this computer can do (the cloud gives it work that fits). */
function caps() {
  const ram = Math.round(os.totalmem() / 1048576);
  const cpus = os.cpus() || [];
  return {
    cpus: cpus.length, cpuModel: (cpus[0] && cpus[0].model) || '', ramMB: ram, freeMB: Math.round(os.freemem() / 1048576), version: VERSION, platform: process.platform + '-' + process.arch,
    // the internet search reads web pages: it needs the page reader (in the full program folder)
    types: ['market.shop'].concat(canRead() ? ['codes.web'] : []),
    // as many jobs side by side as the computer can carry: one per core (one core left for the person), ~1,5 GB each
    slots: slotsOf(),
    battery: onBattery(),
  };
}
function slotsOf() {
  if (Number(process.env.SFK_SLOTS) > 0) return Math.min(32, Math.floor(Number(process.env.SFK_SLOTS)));
  const cpus = (os.cpus() || []).length || 1;
  const ramGB = os.totalmem() / 1073741824;
  return Math.max(1, Math.min(cpus > 1 ? cpus - 1 : 1, Math.floor(ramGB / 1.5) || 1, 16));
}
function canRead() { try { require('./lib/extract'); return true; } catch (_) { return false; } }
let batteryAt = 0, batteryVal = false;
/** On battery (a laptop unplugged): no new work. */
function onBattery() {
  if (Date.now() - batteryAt < 60000) return batteryVal;
  batteryAt = Date.now();
  try {
    if (process.platform === 'win32') {
      const out = require('child_process').execFileSync('powershell.exe', ['-NoProfile', '-Command', '(Get-CimInstance Win32_Battery | Select-Object -First 1 -ExpandProperty BatteryStatus)'], { encoding: 'utf8', timeout: 8000, windowsHide: true }).trim();
      batteryVal = out === '1'; // 1 = discharging
    } else if (process.platform === 'linux') {
      const dir = '/sys/class/power_supply';
      batteryVal = fs.existsSync(dir) && fs.readdirSync(dir).some((d) => { try { return fs.readFileSync(path.join(dir, d, 'status'), 'utf8').trim() === 'Discharging'; } catch (_) { return false; } });
    }
  } catch (_) { batteryVal = false; }
  return batteryVal;
}

// ---------- talking to the cloud ----------
function client(conf) {
  const token = secrets.reveal(conf.token);
  const call = async (method, p, body, raw) => {
    const r = await fetch(conf.server + p, { method, headers: Object.assign({ Authorization: 'Bearer ' + token, 'User-Agent': 'sf-kentro-worker/' + VERSION }, body ? { 'Content-Type': 'application/json' } : {}), body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(raw ? 300000 : 120000) });
    if (r.status === 401 || r.status === 403) { const e = new Error('Ο υπολογιστής δεν αναγνωρίζεται πια (αφαιρέθηκε;). Κάνε ξανά σύζευξη.'); e.fatal = true; throw e; }
    if (r.status === 503) { const e = new Error('Το πρόγραμμα στο cloud ξεκινάει.'); e.retry = true; throw e; }
    if (raw) { if (!r.ok) throw new Error('HTTP ' + r.status); return { buf: Buffer.from(await r.arrayBuffer()), etag: r.headers.get('etag') || '' }; }
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || 'HTTP ' + r.status);
    return j;
  };
  return { call };
}

/** The cloud's pack of our products, kept here by version (fetched again only when it changed). */
function remoteIO(api, jobId) {
  return {
    local: false,
    async pack() {
      const research = require('./lib/research');
      const f = path.join(HOME, 'pack.json.gz');
      let have = '';
      try { have = fs.readFileSync(f + '.v', 'utf8'); } catch (_) { /* none */ }
      const r = await api.call('GET', '/api/worker/pack?have=' + encodeURIComponent(have), null, true).catch((e) => { if (have && !e.fatal) return null; throw e; });
      if (r && r.buf.length) { fs.writeFileSync(f, r.buf); fs.writeFileSync(f + '.v', r.etag); }
      return research.readPack(fs.readFileSync(f));
    },
    async prev(compId) {
      const r = await api.call('GET', `/api/worker/comp?job=${encodeURIComponent(jobId)}&id=${encodeURIComponent(compId)}`, null, true).catch(() => null);
      if (!r || !r.buf.length) return null;
      return JSON.parse(require('zlib').gunzipSync(r.buf).toString('utf8'));
    },
  };
}

// ---------- doing the work ----------
async function runJob(api, conf, j) {
  const h = coord.handler(j.type);
  if (!h) { await api.call('POST', '/api/worker/fail', { id: j.id, error: 'Αυτός ο υπολογιστής δεν ξέρει αυτή την εργασία (παλιά έκδοση;).', retryable: true }); return; }
  log(`εργασία ${j.id} (${j.type}) — ${j.payload.comp ? j.payload.comp.name : ''}, προσπάθεια ${j.attempt}`);
  const ctl = new AbortController();
  let cancel = false, prog = { done: 0, total: 0, msg: 'Ξεκινάει…' }, lines = [];
  // «still working», every 15 s (the cloud gives the job to another computer if this one goes silent for 90 s)
  const beat = async () => {
    try {
      const r = await api.call('POST', '/api/worker/heartbeat', { id: j.id, progress: prog, log: lines.splice(0) });
      if (r.cancel) { cancel = true; ctl.abort(); }
    } catch (e) { if (e.fatal) { cancel = true; ctl.abort(); } }
  };
  const iv = setInterval(beat, Number(process.env.SFK_BEAT_MS) || 15000);
  const japi = {
    signal: ctl.signal, id: j.id, type: j.type,
    cancelled: () => cancel,
    progress: (done, total, msg) => { prog = { done: done == null ? prog.done : done, total: total == null ? prog.total : total, msg: msg || prog.msg }; },
    log: (l) => lines.push(String(l)),
  };
  // the same idempotency key for every attempt to deliver this result (a lost answer is sent again, written once)
  const idem = crypto.createHash('sha256').update(conf.id + ':' + j.id + ':' + j.attempt).digest('hex').slice(0, 32);
  try {
    const result = await h.run(j.payload, japi, remoteIO(api, j.id));
    clearInterval(iv);
    for (let i = 0; ; i++) {
      try { const r = await api.call('POST', '/api/worker/complete', { id: j.id, idem, result }); log(`εργασία ${j.id}: ${r.ok ? 'παραδόθηκε' : 'δεν έγινε δεκτή — ' + (r.error || '')}`); break; } catch (e) {
        if (e.fatal || i >= 5) { log(`εργασία ${j.id}: το αποτέλεσμα δεν παραδόθηκε (${e.message})`); break; }
        await new Promise((x) => setTimeout(x, 5000 * (i + 1)));
      }
    }
  } catch (e) {
    clearInterval(iv);
    log(`εργασία ${j.id}: ${cancel ? 'σταμάτησε' : 'σφάλμα — ' + e.message}`);
    await api.call('POST', '/api/worker/fail', { id: j.id, error: cancel ? 'Σταμάτησε.' : e.message, retryable: !cancel && !(e && e.fatal) }).catch(() => {});
  }
}

// ---------- a runner: one job at a time, in its own process (one per core) ----------
const toParent = (m) => { try { if (process.send) process.send(m); } catch (_) { /* parent gone */ } };
async function runnerLoop() {
  const conf = readConf();
  if (!conf || !conf.token) process.exit(2);
  try { os.setPriority(0, os.constants.priority.PRIORITY_BELOW_NORMAL); } catch (_) { /* not allowed: fine */ }
  store.init();
  jobtypes.register();
  const api = client(conf);
  let paused = false, running = 0, wait = 1000;
  process.on('message', (m) => { if (m && m.t === 'pause') paused = !!m.on; });
  process.on('disconnect', () => process.exit(0)); // the supervisor stopped: so does its runner
  setInterval(() => toParent({ t: 'mem', rss: process.memoryUsage().rss }), 3000).unref();
  for (;;) {
    try {
      if (!paused && running === 0) {
        const r = await api.call('POST', '/api/worker/claim', { max: 1 });
        const j = (r.jobs || [])[0];
        if (j) {
          running++;
          toParent({ t: 'job', job: { id: j.id, type: j.type, label: (coord.handler(j.type) || {}).label || j.type } });
          await runJob(api, conf, j).finally(() => { running--; toParent({ t: 'job', job: null }); toParent({ t: 'count', k: 'job' }); });
          wait = 300;
        } else wait = POLL;
      } else wait = POLL;
    } catch (e) {
      if (e.fatal) { log(e.message); process.exit(3); }
      log('σύνδεση: ' + e.message);
      wait = Math.min(120000, Math.max(wait, 2000) * 2);
    }
    await new Promise((x) => setTimeout(x, wait));
  }
}

// ---------- the supervisor: starts the runners, paces the searches for all of them, reports the load ----------
async function supervise() {
  const conf = readConf();
  if (!conf || !conf.token) { console.error('Δεν έχει γίνει σύζευξη. Τρέξε: node worker.js pair <διεύθυνση> <κωδικός>'); process.exit(2); }
  try { os.setPriority(0, os.constants.priority.PRIORITY_BELOW_NORMAL); } catch (_) { /* not allowed: fine */ }
  const api = client(conf);
  const K = slotsOf();
  log(`SF Κέντρο worker ${VERSION} — ${conf.name} → ${conf.server} · ${K} εργασίες μαζί (${(os.cpus() || []).length} πυρήνες, ${Math.round(os.totalmem() / 1073741824)} GB)`);
  const { fork } = require('child_process');
  const runners = new Map(); // index → { p, rss, job }
  const counts = []; // [time, kind]
  const gap = Number(process.env.SFK_SEARCH_GAP_MS) || 2000;
  const lastBy = {}, pausedUntil = {};
  let stopping = false, paused = false;
  const start = (i) => {
    const p = fork(__filename, [], { env: Object.assign({}, process.env, { SFK_RUNNER: '1', SFK_RUNNER_ID: String(i) }), stdio: ['ignore', 'inherit', 'inherit', 'ipc'] });
    const r = { p, rss: 0, job: null };
    runners.set(i, r);
    p.on('message', (m) => {
      if (!m || typeof m !== 'object') return;
      if (m.t === 'mem') r.rss = Number(m.rss) || 0;
      else if (m.t === 'job') r.job = m.job || null;
      else if (m.t === 'count') counts.push([Date.now(), String(m.k)]);
      else if (m.t === 'blocked') { pausedUntil[m.eng] = Date.now() + 10 * 60000; log(`η μηχανή αναζήτησης ${m.eng} ζήτησε παύση: 10 λεπτά`); }
      else if (m.t === 'permit') {
        // one search at a time per engine for the whole computer, at a steady pace
        if ((pausedUntil[m.eng] || 0) > Date.now()) { p.send({ t: 'permit', id: m.id, ok: false }); return; }
        const at = Math.max(Date.now(), (lastBy[m.eng] || 0) + gap + Math.random() * gap * 0.4);
        lastBy[m.eng] = at;
        setTimeout(() => { try { p.send({ t: 'permit', id: m.id, ok: true }); } catch (_) { /* gone */ } }, at - Date.now());
      }
    });
    p.on('exit', (code) => {
      runners.delete(i);
      if (stopping) return;
      if (code === 3 || code === 2) { stopping = true; for (const x of runners.values()) x.p.kill(); log('ο υπολογιστής δεν αναγνωρίζεται πια: τέλος'); process.exit(code); }
      setTimeout(() => start(i), 5000);
    });
    if (paused) p.send({ t: 'pause', on: true });
  };
  for (let i = 0; i < K; i++) start(i);
  for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { stopping = true; for (const x of runners.values()) x.p.kill(); process.exit(0); });

  // the load, every 3 seconds: processor and memory of the whole computer, what each runner does, how fast
  let prev = cpuTimes();
  const report = async () => {
    const now = cpuTimes();
    const cpu = now.total > prev.total ? Math.round(100 * (1 - (now.idle - prev.idle) / (now.total - prev.total))) : 0;
    prev = now;
    const cut = Date.now() - 10 * 60000;
    while (counts.length && counts[0][0] < cut) counts.shift();
    const per = (k) => Math.round(counts.filter((c) => c[1] === k).length * 6); // in 10 minutes → per hour
    const load = {
      cpu, ram: Math.round(100 * (1 - os.freemem() / os.totalmem())), ramTotalMB: Math.round(os.totalmem() / 1048576),
      procMB: Math.round(([...runners.values()].reduce((a, r) => a + r.rss, 0) + process.memoryUsage().rss) / 1048576),
      runners: runners.size, slots: K, busy: [...runners.values()].filter((r) => r.job).length,
      jobs: [...runners.values()].filter((r) => r.job).map((r) => r.job.label).slice(0, 16),
      perHour: { products: per('product'), pages: per('page'), searches: per('search'), jobs: per('job') },
      engines: Object.fromEntries(['ddg', 'bing'].map((e) => [e, (pausedUntil[e] || 0) > Date.now() ? 'paused' : 'ok'])),
      battery: paused,
    };
    try { await api.call('POST', '/api/worker/load', { load }); } catch (e) { if (e.fatal) { stopping = true; for (const x of runners.values()) x.p.kill(); process.exit(3); } }
  };
  setInterval(() => { report().catch(() => {}); }, Number(process.env.SFK_LOAD_MS) || 3000);
  // «I am here, this is what I can do», once a minute; on battery the runners take no new work
  for (;;) {
    try {
      const c = caps();
      if (c.battery !== paused) { paused = c.battery; for (const r of runners.values()) r.p.send({ t: 'pause', on: paused }); log(paused ? 'μπαταρία: καμία νέα εργασία' : 'ρεύμα: συνέχεια'); }
      await api.call('POST', '/api/worker/hello', { caps: c });
    } catch (e) {
      if (e.fatal) { log(e.message); stopping = true; for (const x of runners.values()) x.p.kill(); process.exit(3); }
      log('σύνδεση: ' + e.message);
    }
    await new Promise((x) => setTimeout(x, 60000));
  }
}
function cpuTimes() {
  let idle = 0, total = 0;
  for (const c of os.cpus() || []) { for (const v of Object.values(c.times)) total += v; idle += c.times.idle; }
  return { idle, total };
}

async function pair(server, code) {
  const url = String(server || '').replace(/\/+$/, '');
  if (!/^https?:\/\//.test(url)) throw new Error('Γράψε τη διεύθυνση, π.χ. https://sf-kentro.onrender.com');
  if (!/^https:\/\//.test(url) && !/^http:\/\/(127\.0\.0\.1|localhost|192\.168\.|10\.)/.test(url)) throw new Error('Μόνο με https (εκτός από το τοπικό δίκτυο).');
  const name = os.hostname();
  const r = await fetch(url + '/api/worker/pair', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code, name, caps: caps() }), signal: AbortSignal.timeout(60000) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || 'HTTP ' + r.status);
  writeConf({ server: url, id: j.id, name: j.name, token: secrets.protect(j.token), pairedAt: new Date().toISOString() });
  console.log(`Έτοιμο: ο υπολογιστής «${j.name}» δουλεύει πλέον για το SF Κέντρο (${url}).`);
}

const [cmd, a1, a2] = process.argv.slice(2);
if (cmd === 'pair') pair(a1, a2).catch((e) => { console.error(e.message); process.exit(1); });
else if (cmd === 'status') { const c = readConf(); console.log(c ? `Σύζευξη: ${c.name} → ${c.server} (από ${c.pairedAt})` : 'Δεν έχει γίνει σύζευξη.'); if (a1 === '--all') console.log(JSON.stringify(caps(), null, 2)); else { const c2 = caps(); console.log(`${c2.cpus} πυρήνες · ${Math.round(c2.ramMB / 1024)} GB · έκδοση ${c2.version}`); } }
else if (process.env.SFK_RUNNER) runnerLoop().catch((e) => { log('τέλος: ' + e.message); process.exit(1); });
else supervise().catch((e) => { log('τέλος: ' + e.message); process.exit(1); });
