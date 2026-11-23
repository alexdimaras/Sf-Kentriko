'use strict';
// SF Κέντρο — the worker of a shop's computer.
// It does the heavy work the cloud program hands it (today: the price research, one competitor at a time) and sends
// back the result. It never decides which data is right and never holds the database password: it only talks to the
// cloud program, with its own token (given once, with a pairing code from Settings → Υπολογιστές).
//
//   node worker.js pair <address> <code>    once: e.g. node worker.js pair https://sf-kentro.onrender.com ABCD-2345
//   node worker.js                           works (in the background: low priority, steps aside on battery)
//   node worker.js status [--all]            what it is (and, with --all, what it tells the cloud)
//   node worker.js ai-test [model]           the AI (Ollama) of this computer, step by step, with a real answer
//   node worker.js ollama <address|default>  where this computer's Ollama is (another PC of the shop, if needed)
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
process.env.SFK_SEARCH_GAP_MS = process.env.SFK_SEARCH_GAP_MS || '1200';

const store = require('./lib/store');
const coord = require('./lib/coord');
const jobtypes = require('./lib/jobtypes');
const secrets = require('./lib/secrets');

// the log of this computer: at most 2 × 5 MB (the full one becomes worker.log.1, the older one goes)
let logN = 0;
const log = (...a) => {
  const line = `[${new Date().toISOString()}] ${a.join(' ')}`;
  console.log(line);
  const f = path.join(HOME, 'worker.log');
  try {
    if (++logN % 100 === 1 && fs.existsSync(f) && fs.statSync(f).size > 5 * 1048576) fs.renameSync(f, f + '.1');
    fs.appendFileSync(f, line + '\n');
  } catch (_) { /* optional */ }
};

function readConf() { try { const c = JSON.parse(fs.readFileSync(CONF, 'utf8')); if (c && c.ollamaUrl && !process.env.SFK_WORKER_OLLAMA_URL) process.env.SFK_WORKER_OLLAMA_URL = c.ollamaUrl; return c; } catch (_) { return null; } }
function writeConf(c) { fs.mkdirSync(HOME, { recursive: true }); const tmp = CONF + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(c, null, 2)); fs.renameSync(tmp, CONF); }

/** What this computer can do (the cloud gives it work that fits). */
function caps() {
  const ram = Math.round(os.totalmem() / 1048576);
  const cpus = os.cpus() || [];
  return {
    cpus: cpus.length, cpuModel: (cpus[0] && cpus[0].model) || '', ramMB: ram, freeMB: Math.round(os.freemem() / 1048576), version: VERSION, platform: process.platform + '-' + process.arch,
    // the internet search reads web pages: it needs the page reader (in the full program folder)
    // the AI only with a model that writes text (an Ollama without one cannot answer anything)
    types: ['market.shop'].concat(canRead() ? ['codes.web'] : [], ollama.ok && ollama.models.length ? ['ai.call'] : []),
    ollama: ollama.ok ? ollama.models.slice(0, 20) : null,
    ollamaInfo: { ok: ollama.ok, version: ollama.version, error: ollama.ok ? (ollama.models.length ? '' : 'χωρίς μοντέλο που γράφει κείμενο') : ollama.error, at: ollama.at },
    rev: require('./lib/workerrev'),
    // as many jobs side by side as the computer can carry: one per core, ~1 GB each
    slots: slotsOf(),
    battery: onBattery(),
  };
}
// the free AI of this computer (Ollama), if it runs here: the cloud may ask it questions. The address: the one set
// with «node worker.js ollama <address>» (worker.json), else SFK_OLLAMA_URL, else 127.0.0.1:11434 — the same one the
// runners use for the questions (lib/localai.js resolveUrl)
const ollama = { ok: false, models: [], at: 0, url: '', version: '', error: '' };
function ollamaBase() { return require('./lib/localai').resolveUrl(process.env.SFK_WORKER_OLLAMA_URL || ''); }
async function probeOllama() {
  const localai = require('./lib/localai');
  try {
    ollama.url = ollamaBase();
    const j = await localai.ollamaFetch(ollama.url, '/api/tags', null, { timeout: 4000 });
    // only models that write text can answer (an embedding model cannot)
    ollama.models = localai.modelsOf(j).filter((m) => !m.embedding).map((m) => m.name);
    ollama.ok = true; ollama.error = '';
    const v = await localai.ollamaFetch(ollama.url, '/api/version', null, { timeout: 3000 }).catch(() => null);
    ollama.version = v && v.version ? String(v.version).slice(0, 20) : '';
  } catch (e) { ollama.ok = false; ollama.models = []; ollama.error = String(e.message || e).slice(0, 200); }
  ollama.at = Date.now();
}
function slotsOf() {
  if (Number(process.env.SFK_SLOTS) > 0) return Math.min(32, Math.floor(Number(process.env.SFK_SLOTS)));
  const cpus = (os.cpus() || []).length || 1;
  const ramGB = os.totalmem() / 1073741824;
  // every core (the work is mostly waiting for the internet; the runners have low priority, the person comes first),
  // about 1 GB of memory each, at most 24
  return Math.max(1, Math.min(cpus, Math.floor(ramGB / 1.0) || 1, 24));
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
    // the keys of the optional search APIs: asked on this computer's own line, kept in memory for 10 minutes
    async searchKeys() {
      if (remoteIO.keys && Date.now() - remoteIO.keys.at < 600000) return remoteIO.keys.v;
      const r = await api.call('GET', '/api/worker/search-keys').catch(() => null);
      remoteIO.keys = { at: Date.now(), v: (r && r.apis) || null };
      return remoteIO.keys.v;
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
  log(`εργασία ${j.id} (${j.type}) — ${j.payload.comp ? j.payload.comp.name : (j.payload.items || []).length + ' προϊόντα'}, προσπάθεια ${j.attempt}`);
  const ctl = new AbortController();
  let cancel = false, prog = { done: 0, total: 0, msg: 'Ξεκινάει…' }, lines = [];
  // «still working», every 15 s (the cloud gives the job to another computer if this one goes silent for 90 s)
  // parts of the result handed in with the next «still working» (a computer switched off loses nothing found)
  let parts = null, beating = null;
  const beat = async () => {
    if (beating) return beating;
    const part = parts; parts = null;
    beating = (async () => {
      try {
        const r = await api.call('POST', '/api/worker/heartbeat', Object.assign({ id: j.id, progress: prog, log: lines.splice(0) }, part ? { partial: part } : {}));
        if (r.cancel) { cancel = true; ctl.abort(); }
      } catch (e) {
        if (e.fatal) { cancel = true; ctl.abort(); }
        if (part) parts = mergeParts(part, parts); // not delivered: with the next one (or with the whole result)
      }
    })().finally(() => { beating = null; });
    return beating;
  };
  const iv = setInterval(beat, Number(process.env.SFK_BEAT_MS) || 15000);
  const japi = {
    signal: ctl.signal, id: j.id, type: j.type,
    cancelled: () => cancel,
    progress: (done, total, msg) => { prog = { done: done == null ? prog.done : done, total: total == null ? prog.total : total, msg: msg || prog.msg }; },
    log: (l) => lines.push(String(l)),
    partial: (part) => { parts = mergeParts(parts, part); },
  };
  // the same idempotency key for every attempt to deliver this result (a lost answer is sent again, written once)
  const idem = crypto.createHash('sha256').update(conf.id + ':' + j.id + ':' + j.attempt).digest('hex').slice(0, 32);
  try {
    const result = await h.run(j.payload, japi, remoteIO(api, j.id));
    clearInterval(iv);
    if (beating) await beating; // a part on its way arrives before the whole result (each product written once)
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

function mergeParts(a, b) { if (!a) return b || null; if (!b) return a; return { results: Object.assign({}, a.results || {}, b.results || {}) }; }

// ---------- a runner: one job at a time, in its own process (one per core) ----------
const toParent = (m) => { try { if (process.send) process.send(m); } catch (_) { /* parent gone */ } };
const LANE = process.env.SFK_RUNNER_LANE || ''; // '' = any work; 'ai.call' = only quick questions to the AI
async function runnerLoop() {
  const conf = readConf();
  if (!conf || !conf.token) process.exit(2);
  try { os.setPriority(0, os.constants.priority.PRIORITY_BELOW_NORMAL); } catch (_) { /* not allowed: fine */ }
  store.init();
  jobtypes.register();
  const api = client(conf);
  let paused = false, running = 0, wait = 1000;
  process.on('message', (m) => {
    if (m && m.t === 'pause') paused = !!m.on;
    // the profile of the computer (Ήπια / Κανονική / Ενίσχυση): how many pages of a product are read at once
    if (m && m.t === 'perf' && Number(m.pages) > 0) process.env.SFK_PAGES_PARALLEL = String(Math.min(6, Math.floor(m.pages)));
  });
  process.on('disconnect', () => process.exit(0)); // the supervisor stopped: so does its runner
  setInterval(() => toParent({ t: 'mem', rss: process.memoryUsage().rss }), 3000).unref();
  for (;;) {
    try {
      if (!paused && running === 0) {
        const r = await api.call('POST', '/api/worker/claim', LANE ? { max: 1, types: [LANE] } : { max: 1 });
        const j = (r.jobs || [])[0];
        if (j) {
          running++;
          toParent({ t: 'job', job: { id: j.id, type: j.type, label: (coord.handler(j.type) || {}).label || j.type } });
          await runJob(api, conf, j).finally(() => { running--; toParent({ t: 'job', job: null }); toParent({ t: 'count', k: 'job' }); });
          wait = 300;
        } else wait = POLL;
      } else wait = LANE ? 1500 : POLL;
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
  // K: the most this computer can do (its cores and memory); the profile (lib/perf.js) says how many of them work now
  const K = slotsOf();
  const perf = require('./lib/perf');
  let perfName = 'normal', P = perf.policy({ profile: perfName, cpus: (os.cpus() || []).length, ramTotalMB: Math.round(os.totalmem() / 1048576), ollama: false });
  let lastCpu = 0;
  log(`SF Κέντρο worker ${VERSION} — ${conf.name} → ${conf.server} · έως ${K} εργασίες μαζί (${(os.cpus() || []).length} πυρήνες, ${Math.round(os.totalmem() / 1073741824)} GB) · προφίλ ${P.label}: ${Math.min(K, P.slots)}`);
  const { fork } = require('child_process');
  const runners = new Map(); // index → { p, rss, job }
  const counts = []; // [time, kind]
  // the pace of the searches adapts: a little faster while the engines answer, twice slower after a refusal
  // the pace that worked without refusals (1,5″ per engine ≈ 1.300 products an hour): from the start, not after an
  // hour; a refusal halves the pace of that engine, and every 3 minutes without one it comes back 15% (never below 1,2″)
  const MIN_GAP = Math.max(800, Number(process.env.SFK_SEARCH_GAP_MS) || 1200), MAX_GAP = 6000, START_GAP = 1500;
  const gapBy = {};
  let okSince = Date.now();
  const lastBy = {}, pausedUntil = {};
  let stopping = false, paused = false, dormant = false;
  // one question to this computer's Ollama at a time, whichever runner asks (it is one program, one memory)
  const aiQueue = [];
  let aiBusy = false, aiOwner = null;
  const nextAi = () => { while (!aiBusy && aiQueue.length) { const [p, id] = aiQueue.shift(); if (p.connected === false) continue; aiBusy = true; aiOwner = p; try { p.send({ t: 'ailock', id }); } catch (_) { aiBusy = false; aiOwner = null; } } };
  const start = (i, lane) => {
    const p = fork(__filename, [], { env: Object.assign({}, process.env, { SFK_RUNNER: '1', SFK_RUNNER_ID: String(i), SFK_RUNNER_LANE: lane || '' }), stdio: ['ignore', 'inherit', 'inherit', 'ipc'] });
    const r = { p, rss: 0, job: null };
    runners.set(i, r);
    p.on('message', (m) => {
      if (!m || typeof m !== 'object') return;
      if (m.t === 'mem') r.rss = Number(m.rss) || 0;
      else if (m.t === 'job') r.job = m.job || null;
      else if (m.t === 'count') counts.push([Date.now(), String(m.k)]);
      else if (m.t === 'blocked') { pausedUntil[m.eng] = Date.now() + 10 * 60000; gapBy[m.eng] = Math.min(MAX_GAP, (gapBy[m.eng] || START_GAP) * 2); okSince = Date.now(); log(`η μηχανή αναζήτησης ${m.eng} ζήτησε παύση: 10 λεπτά, μετά πιο αργά (${gapBy[m.eng]} ms)`); }
      else if (m.t === 'ailock') { aiQueue.push([p, m.id]); nextAi(); }
      else if (m.t === 'aiunlock') { if (aiOwner === p) { aiBusy = false; aiOwner = null; } nextAi(); }
      else if (m.t === 'permit' && String(m.eng).startsWith('site:')) {
        // one page of the same shop at a time for the whole computer, at the profile's pace (polite to the shops)
        const at = Math.max(Date.now(), (lastBy[m.eng] || 0) + P.domainGap);
        lastBy[m.eng] = at;
        setTimeout(() => { try { p.send({ t: 'permit', id: m.id, ok: true }); } catch (_) { /* gone */ } }, at - Date.now());
      }
      else if (m.t === 'permit') {
        // one search at a time per engine for the whole computer, at a steady pace
        if ((pausedUntil[m.eng] || 0) > Date.now()) { p.send({ t: 'permit', id: m.id, ok: false }); return; }
        // ten minutes without a refusal: 10% faster (never below the floor)
        if (Date.now() - okSince > 3 * 60000) { for (const e of Object.keys(gapBy)) gapBy[e] = Math.max(MIN_GAP, Math.round(gapBy[e] * 0.85)); okSince = Date.now(); }
        const gap = gapBy[m.eng] || (gapBy[m.eng] = START_GAP);
        const at = Math.max(Date.now(), (lastBy[m.eng] || 0) + gap + Math.random() * gap * 0.3);
        lastBy[m.eng] = at;
        setTimeout(() => { try { p.send({ t: 'permit', id: m.id, ok: true }); } catch (_) { /* gone */ } }, at - Date.now());
      }
    });
    p.on('exit', (code) => {
      runners.delete(i);
      if (aiOwner === p) { aiBusy = false; aiOwner = null; nextAi(); } // (a runner that ends while holding the AI gives it back)
      if (stopping || (dormant && !lane)) return; // stopped on purpose (the mode of this computer)
      if (code === 3 || code === 2) { stopping = true; for (const x of runners.values()) x.p.kill(); log('ο υπολογιστής δεν αναγνωρίζεται πια: τέλος'); process.exit(code); }
      setTimeout(() => start(i, lane), 5000);
    });
    if (!lane) { if (paused || i >= Math.min(K, P.slots)) p.send({ t: 'pause', on: true }); p.send({ t: 'perf', pages: P.pages }); }
  };
  // a runner beyond the profile's number takes no new work (it ends what it does: nothing is lost)
  const applyPerf = () => { for (const [i, r] of runners) if (i < K) { try { r.p.send({ t: 'pause', on: paused || i >= Math.min(K, P.slots) }); r.p.send({ t: 'perf', pages: P.pages }); } catch (_) { /* gone */ } } };
  for (let i = 0; i < K; i++) start(i);
  // one more runner, only for questions to the AI of this computer (answered in seconds, never behind the long jobs)
  start(K, 'ai.call');
  for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { stopping = true; for (const x of runners.values()) x.p.kill(); process.exit(0); });

  // the load, every 3 seconds: processor and memory of the whole computer, what each runner does, how fast
  let prev = cpuTimes();
  const report = async () => {
    const now = cpuTimes();
    const cpu = now.total > prev.total ? Math.round(100 * (1 - (now.idle - prev.idle) / (now.total - prev.total))) : 0;
    prev = now;
    lastCpu = Math.round(lastCpu * 0.7 + cpu * 0.3); // smoothed: a moment's peak is no reason to step down
    const cut = Date.now() - 10 * 60000;
    while (counts.length && counts[0][0] < cut) counts.shift();
    const per = (k) => Math.round(counts.filter((c) => c[1] === k).length * 6); // in 10 minutes → per hour
    const load = {
      cpu, ram: Math.round(100 * (1 - os.freemem() / os.totalmem())), ramTotalMB: Math.round(os.totalmem() / 1048576),
      procMB: Math.round(([...runners.values()].reduce((a, r) => a + r.rss, 0) + process.memoryUsage().rss) / 1048576),
      runners: runners.size, slots: K, busy: [...runners.values()].filter((r) => r.job).length,
      jobs: [...runners.values()].filter((r) => r.job).map((r) => r.job.label).slice(0, 16),
      perHour: { products: per('product'), pages: per('page'), searches: per('search'), jobs: per('job') },
      engines: Object.fromEntries(['ddg', 'bing', 'yahoo'].map((e) => [e, (pausedUntil[e] || 0) > Date.now() ? 'paused' : 'ok'])),
      gaps: Object.assign({}, gapBy),
      battery: paused, dormant,
      perf: { profile: P.profile, used: P.used, label: P.label, slots: Math.min(K, P.slots), max: K, pages: P.pages, domainGap: P.domainGap, down: P.down, reason: P.reason },
    };
    try { await api.call('POST', '/api/worker/load', { load }); } catch (e) { if (e.fatal) { stopping = true; for (const x of runners.values()) x.p.kill(); process.exit(3); } }
  };
  setInterval(() => { report().catch(() => {}); }, Number(process.env.SFK_LOAD_MS) || 3000);
  // «I am here, this is what I can do», every 15 seconds; on battery the runners take no new work. The mode set in
  // Ρυθμίσεις → Υπολογιστές: when this computer should not work (stopped, or «only while the program is open» and it
  // is closed), the runners are stopped altogether — nothing of the computer is used — and started again when it should
  let n = 0;
  for (;;) {
    try {
      if (n++ % 4 === 0) await probeOllama();
      const c = caps();
      // (the lane of the AI questions goes on: a person is waiting for that answer, and it takes seconds)
      if (c.battery !== paused) { paused = c.battery; applyPerf(); log(paused ? 'μπαταρία: καμία νέα εργασία' : 'ρεύμα: συνέχεια'); }
      const h = await api.call('POST', '/api/worker/hello', { caps: c });
      // the profile chosen for this computer + what it measures now → how many jobs, pages, how polite
      if (h && h.perf) perfName = h.perf;
      const ramUsed = Math.round(100 * (1 - os.freemem() / os.totalmem()));
      const next = perf.policy({ profile: perfName, cpus: (os.cpus() || []).length, ramTotalMB: Math.round(os.totalmem() / 1048576), ramUsedPct: ramUsed, cpuPct: lastCpu, ollama: !!(c.ollama && c.ollama.length) });
      if (next.slots !== P.slots || next.pages !== P.pages || next.used !== P.used) {
        log(`προφίλ ${next.label}${next.down ? ' (κατέβηκε από ' + perf.PROFILES[next.profile].label + ': ' + next.reason + ')' : ''}: ${Math.min(K, next.slots)} εργασίες μαζί, ${next.pages} σελίδες ανά προϊόν`);
        P = next; applyPerf();
      } else P = next;
      const should = !h || h.active !== false;
      if (!should && !dormant) {
        dormant = true;
        for (const [i, r] of runners) if (i < K) r.p.kill();
        log(h && h.mode === 'off' ? 'σταμάτησε από τις Ρυθμίσεις (κανένας πόρος δεν χρησιμοποιείται)' : 'το πρόγραμμα είναι κλειστό: αναμονή χωρίς χρήση πόρων');
      } else if (should && dormant) {
        dormant = false;
        for (let i = 0; i < K; i++) if (!runners.has(i)) start(i);
        log('συνέχεια της δουλειάς');
      }
    } catch (e) {
      if (e.fatal) { log(e.message); stopping = true; for (const x of runners.values()) x.p.kill(); process.exit(3); }
      log('σύνδεση: ' + e.message);
    }
    await new Promise((x) => setTimeout(x, 15000));
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

/** «node worker.js ai-test»: the whole path of the AI on THIS computer, step by step, with a real answer. */
async function aiTest() {
  const localai = require('./lib/localai');
  const say = (ok, t) => console.log((ok ? '  ✓ ' : '  ✗ ') + t);
  let base;
  try { base = ollamaBase(); } catch (e) { say(false, e.message); return 1; }
  console.log('Ollama στη διεύθυνση: ' + base);
  let tags;
  try { tags = await localai.ollamaFetch(base, '/api/tags', null, { timeout: 8000 }); say(true, 'Το Ollama απαντά.'); } catch (e) { say(false, e.message); return 1; }
  const v = await localai.ollamaFetch(base, '/api/version', null, { timeout: 4000 }).catch(() => null);
  if (v && v.version) say(true, 'Έκδοση Ollama: ' + v.version);
  const models = localai.modelsOf(tags);
  if (!models.length) { say(false, 'Κανένα μοντέλο. Τρέξε: ollama pull qwen2.5:7b'); return 1; }
  say(true, 'Μοντέλα: ' + models.map((m) => m.name + (m.embedding ? ' [embedding]' : '')).join(', '));
  const p = localai.pickModel(models, process.argv[3] || '');
  if (p.error) { say(false, p.error.message); return 1; }
  console.log('Δοκιμή παραγωγής κειμένου με ' + p.model + ' (την πρώτη φορά το μοντέλο φορτώνει: έως 1–2 λεπτά)…');
  const t0 = Date.now();
  try {
    const r = await localai.ollamaFetch(base, '/api/generate', { model: p.model, prompt: 'Απάντησε στα ελληνικά με μία πρόταση: τι είναι ένα σακίδιο;', stream: false, options: { num_predict: 60, temperature: 0, num_ctx: 2048 } }, { timeout: 240000 });
    const text = localai.cleanAnswer(r.response);
    say(!!text, `Απάντηση σε ${((Date.now() - t0) / 1000).toFixed(1)}″: «${text.slice(0, 200)}»`);
    const ms = (v) => ((Number(v) || 0) / 1e9).toFixed(1) + '″';
    console.log(`  · φόρτωση μοντέλου ${ms(r.load_duration)} · ανάγνωση ερώτησης ${ms(r.prompt_eval_duration)} (${Number(r.prompt_eval_count) || 0} tokens) · γράψιμο ${ms(r.eval_duration)} (${Number(r.eval_count) || 0} tokens${r.eval_duration ? ', ' + ((Number(r.eval_count) || 0) / (r.eval_duration / 1e9)).toFixed(1) + ' tokens/″' : ''}) · σύνολο ${ms(r.total_duration)}`);
    if (!text) return 1;
    // the structured answer (JSON Schema in «format») the research uses: really kept by this Ollama?
    try {
      const j = await localai.ollamaFetch(base, '/api/generate', { model: p.model, prompt: 'Είναι ίδιο προϊόν το «ΣΑΚΙΔΙΟ MIL-TEC ASSAULT OLIVE» με το «Mil-Tec Assault Pack Black»;', system: 'Απαντάς μόνο JSON.', format: { type: 'object', properties: { verdict: { type: 'string', enum: ['exact', 'family', 'similar', 'different'] } }, required: ['verdict'] }, stream: false, options: { num_predict: 40, temperature: 0, num_ctx: 2048 } }, { timeout: 120000 });
      let v = null; try { v = JSON.parse(j.response).verdict; } catch (_) { v = null; }
      say(!!v, v ? `Δομημένη απάντηση (JSON Schema): «${v}»` : 'Το Ollama δεν τήρησε το JSON Schema (παλιά έκδοση Ollama; αναβάθμισε από ollama.com)');
    } catch (e) { say(false, 'Δομημένη απάντηση: ' + e.message); }
  } catch (e) { say(false, e.message); return 1; }
  const c = readConf();
  say(!!c, c ? `Σύζευξη με ${c.server}: το cloud μπορεί να στέλνει ερωτήσεις σε αυτόν τον υπολογιστή.` : 'Δεν έχει γίνει σύζευξη με το cloud (Ρυθμίσεις → Υπολογιστές).');
  return 0;
}

const [cmd, a1, a2] = process.argv.slice(2);
if (cmd === 'ai-test') aiTest().then((code) => process.exit(code), (e) => { console.error(e.message); process.exit(1); });
else if (cmd === 'ollama') {
  // the address of Ollama for this worker (e.g. another, stronger PC of the shop): node worker.js ollama http://192.168.1.20:11434
  const c = readConf();
  if (!c) { console.error('Δεν έχει γίνει σύζευξη ακόμα.'); process.exit(2); }
  let u = '';
  try { u = a1 && a1 !== 'default' ? require('./lib/localai').resolveUrl(a1) : ''; } catch (e) { console.error(e.message); process.exit(1); }
  if (u) c.ollamaUrl = u; else delete c.ollamaUrl;
  writeConf(c);
  console.log('Ollama: ' + (u || 'η συνηθισμένη διεύθυνση (127.0.0.1:11434)') + '. Ξεκίνα ξανά τον worker.');
}
else if (cmd === 'pair') pair(a1, a2).catch((e) => { console.error(e.message); process.exit(1); });
else if (cmd === 'status') { const c = readConf(); console.log(c ? `Σύζευξη: ${c.name} → ${c.server} (από ${c.pairedAt})` : 'Δεν έχει γίνει σύζευξη.'); if (a1 === '--all') console.log(JSON.stringify(caps(), null, 2)); else { const c2 = caps(); console.log(`${c2.cpus} πυρήνες · ${Math.round(c2.ramMB / 1024)} GB · έκδοση ${c2.version}`); } }
else if (process.env.SFK_RUNNER) runnerLoop().catch((e) => { log('τέλος: ' + e.message); process.exit(1); });
else supervise().catch((e) => { log('τέλος: ' + e.message); process.exit(1); });
