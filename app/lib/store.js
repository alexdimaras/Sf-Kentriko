'use strict';
// JSON files in a data folder (default: Documents\SF-Kentro). Atomic writes, in-memory cache, daily backups.
const fs = require('fs');
const zlib = require('zlib');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const cache = new Map();
let dataDir = null;

function appConfigDir() {
  const base = process.env.APPDATA || path.join(os.homedir(), '.config');
  return path.join(base, 'SF-Kentro');
}
function configPath() { return path.join(appConfigDir(), 'config.json'); }

function documentsDir() {
  if (process.platform === 'win32') {
    try {
      const out = execFileSync('reg', ['query', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\User Shell Folders', '/v', 'Personal'], { encoding: 'utf8', windowsHide: true, timeout: 4000 });
      const m = out.match(/Personal\s+REG_(?:EXPAND_)?SZ\s+(.+)/);
      if (m) {
        const p = m[1].trim().replace(/%([^%]+)%/g, (x, v) => process.env[v] || process.env[v.toUpperCase()] || x);
        if (fs.existsSync(p)) return p;
      }
    } catch (_) { /* fall back */ }
  }
  const d = path.join(os.homedir(), 'Documents');
  return fs.existsSync(d) ? d : os.homedir();
}

function readConfig() {
  try { return JSON.parse(fs.readFileSync(configPath(), 'utf8')); } catch (_) { return {}; }
}
function writeConfig(c) {
  fs.mkdirSync(appConfigDir(), { recursive: true });
  fs.writeFileSync(configPath(), JSON.stringify(c, null, 2));
}

function canWrite(d) {
  try {
    fs.mkdirSync(d, { recursive: true });
    const probe = path.join(d, '.write-test');
    fs.writeFileSync(probe, 'ok');
    fs.unlinkSync(probe);
    return true;
  } catch (_) { return false; }
}

/** Pick the data folder: saved choice → Documents\SF-Kentro → AppData → next to the program. */
function init() {
  const cfg = readConfig();
  const candidates = [process.env.SFK_DATA, cfg.dataDir];
  try { candidates.push(path.join(documentsDir(), 'SF-Kentro')); } catch (_) { /* ignore */ }
  candidates.push(path.join(process.env.LOCALAPPDATA || appConfigDir(), 'SF-Kentro-data'));
  candidates.push(path.join(path.dirname(process.execPath), 'SF-Kentro-data'));
  candidates.push(path.join(os.tmpdir(), 'SF-Kentro-data'));
  for (const c of candidates) {
    if (!c) continue;
    if (canWrite(c)) {
      dataDir = c;
      try { fs.mkdirSync(path.join(dataDir, 'exports'), { recursive: true }); } catch (_) { /* ignore */ }
      return dataDir;
    }
  }
  throw new Error('Δεν βρέθηκε φάκελος όπου μπορεί να γράψει το πρόγραμμα (Έγγραφα / AppData).');
}
function dir() { return dataDir || init(); }

/** Move the data folder (e.g. to OneDrive so both stores share it). Copies files when the target is empty. */
function setDataDir(target) {
  target = path.resolve(String(target || '').trim());
  if (!target) throw new Error('Δώσε φάκελο.');
  fs.mkdirSync(target, { recursive: true });
  const cur = dir();
  const targetHasData = fs.existsSync(path.join(target, 'settings.json'));
  if (!targetHasData && path.resolve(cur) !== target) {
    for (const f of fs.readdirSync(cur)) {
      if (f.endsWith('.json')) fs.copyFileSync(path.join(cur, f), path.join(target, f));
    }
  }
  const cfg = readConfig(); cfg.dataDir = target; writeConfig(cfg);
  cache.clear();
  dataDir = target;
  fs.mkdirSync(path.join(dataDir, 'exports'), { recursive: true });
  return { dataDir, usedExisting: targetHasData };
}

function file(name) { return path.join(dir(), name + '.json'); }

// A file that does not exist (yet) is remembered as MISSING, never as some caller's default: two callers can ask
// for the same file with different defaults (e.g. null and an empty list) and each must get its own.
const MISSING = Symbol('missing');
function fresh(def) { return typeof def === 'function' ? def() : (def === undefined || def === null ? null : JSON.parse(JSON.stringify(def))); }

function read(name, def) {
  if (cache.has(name)) { const c = cache.get(name); return c === MISSING ? fresh(def) : c; }
  let v;
  try { v = JSON.parse(fs.readFileSync(file(name), 'utf8')); } catch (e) {
    if (e.code !== 'ENOENT') {
      // Corrupt file: keep a copy, start from default so the app still opens.
      try { fs.copyFileSync(file(name), file(name) + '.broken-' + Date.now()); } catch (_) { /* ignore */ }
    }
    v = MISSING;
  }
  if (v === null) v = MISSING; // an empty ("null") file counts as missing
  cache.set(name, v);
  return v === MISSING ? fresh(def) : v;
}

// who wants to know about every change (live updates on the other PCs)
const listeners = new Set();
function onWrite(fn) { listeners.add(fn); return () => listeners.delete(fn); }

function write(name, value) {
  cache.set(name, value);
  const f = file(name);
  const tmp = f + '.tmp-' + process.pid;
  if (isBig(value)) writeStreamed(tmp, value); else fs.writeFileSync(tmp, JSON.stringify(value));
  fs.renameSync(tmp, f);
  for (const fn of listeners) { try { fn(name); } catch (_) { /* a listener never breaks a save */ } }
  return value;
}

// A catalog (thousands of products with their descriptions) as ONE string would need hundreds of MB on a small
// cloud machine (Greek text takes 2 bytes a letter in memory). Big lists are written item by item instead:
// the file is exactly the same JSON.
function isBig(v) {
  if (!v || typeof v !== 'object') return false;
  if (Array.isArray(v)) return v.length >= 500;
  for (const k in v) if (Array.isArray(v[k]) && v[k].length >= 500) return true;
  return false;
}
function writeStreamed(target, value) {
  const fd = fs.openSync(target, 'w');
  try {
    let buf = '';
    const put = (s) => { buf += s; if (buf.length > 1 << 20) { fs.writeSync(fd, buf); buf = ''; } };
    const list = (arr) => {
      put('[');
      for (let i = 0; i < arr.length; i++) { const x = JSON.stringify(arr[i]); put((i ? ',' : '') + (x === undefined ? 'null' : x)); }
      put(']');
    };
    if (Array.isArray(value)) list(value);
    else {
      put('{');
      let first = true;
      for (const k of Object.keys(value)) {
        const v = value[k];
        if (v === undefined || typeof v === 'function' || typeof v === 'symbol') continue;
        put((first ? '' : ',') + JSON.stringify(k) + ':');
        first = false;
        if (Array.isArray(v) && v.length >= 500) list(v);
        else put(JSON.stringify(v));
      }
      put('}');
    }
    if (buf) fs.writeSync(fd, buf);
  } finally { fs.closeSync(fd); }
}

function update(name, def, fn) {
  const v = read(name, def);
  const r = fn(v);
  return write(name, r === undefined ? v : r);
}

/** Does the file exist (saved at least once)? */
function exists(name) { read(name); return cache.get(name) !== MISSING; }

/** Drop a big file from memory (it is read again from disk when needed). */
function forget(name) { cache.delete(name); }

function exportPath(fname) {
  const safe = String(fname).replace(/[\\/:*?"<>|]+/g, '-');
  return path.join(dir(), 'exports', safe);
}

// Files that are only copies of something that can be read again (competitors' catalogs, supplier pages,
// learned words, sessions) are not backed up; the rest is compressed (JSON shrinks about 10×).
const NO_BACKUP = /^(comp-.+|enrich-cache|accents|types|sessions)\.json$/;
function backup(keep) {
  const day = new Date().toISOString().slice(0, 10);
  const root = path.join(dir(), 'backups');
  const bdir = path.join(root, day);
  if (fs.existsSync(bdir)) return null;
  fs.mkdirSync(bdir, { recursive: true });
  for (const f of fs.readdirSync(dir())) {
    if (!f.endsWith('.json') || NO_BACKUP.test(f)) continue;
    fs.writeFileSync(path.join(bdir, f + '.gz'), zlib.gzipSync(fs.readFileSync(path.join(dir(), f)), { level: 6 }));
  }
  const all = fs.readdirSync(root).filter((d) => /^\d{4}-\d\d-\d\d$/.test(d)).sort();
  while (all.length > (keep || 14)) {
    const old = all.shift();
    fs.rmSync(path.join(root, old), { recursive: true, force: true });
  }
  // the safety copies made before a restore: the last 3 are enough
  const safety = fs.readdirSync(root).filter((d) => /^before-restore-\d+$/.test(d)).sort();
  while (safety.length > 3) fs.rmSync(path.join(root, safety.shift()), { recursive: true, force: true });
  return bdir;
}

/**
 * Every data file in one compressed file (the same files as the daily backup). opts.allow: names kept although they
 * are normally left out (the cloud copy keeps the open sessions, so a restart does not sign everybody out).
 * `hash` changes only when the data changes (not with the time of the copy).
 */
function bundle(opts) {
  const allow = new Set((opts && opts.allow) || []);
  const skip = (f) => NO_BACKUP.test(f) && !allow.has(f.slice(0, -5));
  const files = {};
  for (const f of fs.readdirSync(dir()).sort()) {
    if (!f.endsWith('.json') || skip(f)) continue;
    try { files[f.slice(0, -5)] = JSON.parse(fs.readFileSync(path.join(dir(), f), 'utf8')); } catch (_) { /* a broken file is left out */ }
  }
  const body = JSON.stringify(files);
  const hash = require('crypto').createHash('sha256').update(body).digest('hex');
  const buffer = zlib.gzipSync(Buffer.from(`{"app":"sf-kentro","at":${JSON.stringify(new Date().toISOString())},"files":${body}}`), { level: 6 });
  return { buffer, files: Object.keys(files).length, hash };
}
/**
 * The same file as bundle(), made without stopping the program: the files are joined as they are (they are JSON
 * already, nothing is parsed) and compressed in the background.
 */
async function bundleAsync(opts) {
  const allow = new Set((opts && opts.allow) || []);
  const parts = [];
  for (const f of fs.readdirSync(dir()).sort()) {
    if (!f.endsWith('.json') || (NO_BACKUP.test(f) && !allow.has(f.slice(0, -5)))) continue;
    let raw;
    try { raw = fs.readFileSync(path.join(dir(), f), 'utf8'); } catch (_) { continue; }
    if (!raw || !/^[[{"\dtfn-]/.test(raw)) continue; // an empty or broken file is left out
    parts.push(JSON.stringify(f.slice(0, -5)) + ':' + raw);
  }
  const body = '{' + parts.join(',') + '}';
  const hash = require('crypto').createHash('sha256').update(body).digest('hex');
  const buffer = await require('util').promisify(zlib.gzip)(Buffer.from(`{"app":"sf-kentro","at":${JSON.stringify(new Date().toISOString())},"files":${body}}`), { level: 6 });
  return { buffer, files: parts.length, hash };
}
// ---------- the "pack": every data file as it is on disk, one after the other, compressed as a stream ----------
// Nothing is parsed or joined into one big string, so it works with catalogs of any size on a small machine:
// SFKPACK2\n, then for each file "name\nsize\n" and its bytes.
const PACK_MAGIC = 'SFKPACK2\n';
function packNames(allow) { return fs.readdirSync(dir()).filter((f) => f.endsWith('.json') && (!NO_BACKUP.test(f) || allow.has(f.slice(0, -5)))).sort(); }
async function pack(opts) {
  const allow = new Set((opts && opts.allow) || []);
  const crypto = require('crypto');
  const hash = crypto.createHash('sha256');
  const gz = zlib.createGzip({ level: 6 });
  const out = [];
  let done;
  // opts.file: written straight to a file (the copy never sits in memory; for the cloud upload)
  if (opts && opts.file) { const ws = fs.createWriteStream(opts.file); gz.pipe(ws); done = new Promise((resolve, reject) => { ws.on('finish', resolve); ws.on('error', reject); gz.on('error', reject); }); }
  else { gz.on('data', (c) => out.push(c)); done = new Promise((resolve, reject) => { gz.on('end', resolve); gz.on('error', reject); }); }
  const put = (b) => new Promise((resolve) => { if (gz.write(b)) resolve(); else gz.once('drain', resolve); });
  await put(Buffer.from(PACK_MAGIC));
  let files = 0;
  for (const f of packNames(allow)) {
    // read in pieces: the program keeps answering while a big catalog is packed
    let fd, size;
    try { fd = fs.openSync(path.join(dir(), f), 'r'); size = fs.fstatSync(fd).size; } catch (_) { continue; }
    try {
      if (!size) continue;
      const head = Buffer.from(`${f.slice(0, -5)}\n${size}\n`);
      hash.update(head);
      await put(head);
      for (let at = 0; at < size;) {
        const chunk = Buffer.allocUnsafe(Math.min(1 << 20, size - at));
        const n = fs.readSync(fd, chunk, 0, chunk.length, at);
        if (!n) throw new Error('Το αρχείο ' + f + ' άλλαξε την ώρα της φύλαξης.');
        const part = chunk.subarray(0, n);
        hash.update(part);
        await put(part);
        at += n;
        await new Promise((r) => setImmediate(r));
      }
      files++;
    } finally { fs.closeSync(fd); }
  }
  gz.end();
  await done;
  if (opts && opts.file) return { file: opts.file, size: fs.statSync(opts.file).size, files, hash: hash.digest('hex') };
  return { buffer: Buffer.concat(out), files, hash: hash.digest('hex') };
}
/** Puts back a pack: each file written as it is (no parsing), atomically. Returns the same hash as pack(). */
async function unpack(buf, opts) {
  const allow = new Set((opts && opts.allow) || []);
  const crypto = require('crypto');
  const hash = crypto.createHash('sha256');
  if (!(opts && opts.fresh)) safetyCopy();
  const gun = zlib.createGunzip();
  let pending = Buffer.alloc(0), magic = false, cur = null, fd = null, names = [];
  const finishFile = () => { fs.closeSync(fd); fd = null; fs.renameSync(cur.tmp, cur.target); names.push(cur.name); cur = null; };
  const take = (chunk) => {
    pending = pending.length ? Buffer.concat([pending, chunk]) : chunk;
    for (;;) {
      if (!magic) {
        if (pending.length < PACK_MAGIC.length) return;
        if (pending.subarray(0, PACK_MAGIC.length).toString() !== PACK_MAGIC) throw new Error('Δεν είναι αντίγραφο του προγράμματος.');
        pending = pending.subarray(PACK_MAGIC.length); magic = true;
      }
      if (!cur) {
        const a = pending.indexOf(10); if (a < 0) return;
        const b = pending.indexOf(10, a + 1); if (b < 0) return;
        const name = pending.subarray(0, a).toString('utf8'), size = Number(pending.subarray(a + 1, b).toString());
        if (!/^[a-z0-9][a-z0-9._-]{0,80}$/i.test(name) || !(size >= 0)) throw new Error('Το αντίγραφο είναι χαλασμένο.');
        hash.update(pending.subarray(0, b + 1));
        pending = pending.subarray(b + 1);
        const keep = !NO_BACKUP.test(name + '.json') || allow.has(name);
        const target = file(name);
        cur = { name, left: size, keep, target, tmp: target + '.tmp-' + process.pid };
        fd = fs.openSync(keep ? cur.tmp : (process.platform === 'win32' ? 'NUL' : '/dev/null'), 'w');
        if (!size) { if (keep) finishFile(); else { fs.closeSync(fd); fd = null; cur = null; } continue; }
      }
      if (!pending.length) return;
      const part = pending.subarray(0, Math.min(cur.left, pending.length));
      hash.update(part); fs.writeSync(fd, part);
      cur.left -= part.length; pending = pending.subarray(part.length);
      if (!cur.left) { if (cur.keep) finishFile(); else { fs.closeSync(fd); fd = null; cur = null; } }
    }
  };
  await new Promise((resolve, reject) => {
    gun.on('data', (c) => { try { take(c); } catch (e) { gun.destroy(); reject(e); } });
    gun.on('end', resolve); gun.on('error', () => reject(new Error('Δεν είναι αντίγραφο του προγράμματος (λάθος αρχείο).')));
    // opts.file: read from a file in pieces (a big copy never sits in memory)
    if (opts && opts.file) fs.createReadStream(opts.file).on('error', reject).pipe(gun); else gun.end(buf);
  });
  if (cur) throw new Error('Το αντίγραφο είναι κομμένο (δεν κατέβηκε ολόκληρο).');
  cache.clear();
  if (!names.length) throw new Error('Το αντίγραφο είναι άδειο.');
  for (const n of names) for (const fn of listeners) { try { fn(n); } catch (_) { /* ignore */ } }
  return { files: names.length, hash: hash.digest('hex'), at: null };
}
function safetyCopy() {
  const safety = path.join(dir(), 'backups', 'before-restore-' + Date.now());
  fs.mkdirSync(safety, { recursive: true });
  for (const f of fs.readdirSync(dir())) if (f.endsWith('.json') && !NO_BACKUP.test(f)) fs.writeFileSync(path.join(safety, f + '.gz'), zlib.gzipSync(fs.readFileSync(path.join(dir(), f))));
}
/** Is this compressed file a pack (new) or a bundle (older versions)? */
function isPack(buf) { try { return zlib.gunzipSync(buf.subarray(0, Math.min(buf.length, 4096)), { finishFlush: zlib.constants.Z_SYNC_FLUSH }).subarray(0, PACK_MAGIC.length).toString() === PACK_MAGIC; } catch (_) { return false; } }
/** Restore from a file of any version. */
async function restoreFile(buf, opts) {
  if (opts && opts.file) {
    const fd = fs.openSync(opts.file, 'r'); const head = Buffer.alloc(4096); const n = fs.readSync(fd, head, 0, 4096, 0); fs.closeSync(fd);
    return isPack(head.subarray(0, n)) ? unpack(null, opts) : unbundle(fs.readFileSync(opts.file), opts);
  }
  return isPack(buf) ? unpack(buf, opts) : unbundle(buf, opts);
}

/**
 * Put back a bundle made by bundle(): a safety copy of today's state first, then every file of the bundle.
 * opts.allow: the same as for bundle(); opts.fresh: an empty data folder at start (no safety copy needed).
 */
function unbundle(buf, opts) {
  const allow = new Set((opts && opts.allow) || []);
  let data;
  try { data = JSON.parse(zlib.gunzipSync(buf).toString('utf8')); } catch (_) { throw new Error('Δεν είναι αντίγραφο του προγράμματος (λάθος αρχείο).'); }
  if (!data || data.app !== 'sf-kentro' || !data.files || typeof data.files !== 'object') throw new Error('Δεν είναι αντίγραφο του προγράμματος.');
  const names = Object.keys(data.files).filter((n) => /^[a-z0-9][a-z0-9._-]{0,80}$/i.test(n) && (!NO_BACKUP.test(n + '.json') || allow.has(n)));
  if (!names.length) throw new Error('Το αντίγραφο είναι άδειο.');
  if (!(opts && opts.fresh)) {
    const safety = path.join(dir(), 'backups', 'before-restore-' + Date.now());
    fs.mkdirSync(safety, { recursive: true });
    for (const f of fs.readdirSync(dir())) if (f.endsWith('.json') && !NO_BACKUP.test(f)) fs.writeFileSync(path.join(safety, f + '.gz'), zlib.gzipSync(fs.readFileSync(path.join(dir(), f))));
  }
  for (const n of names) write(n, data.files[n]);
  cache.clear();
  return { files: names.length, at: data.at || null };
}

function listBackups() {
  const b = path.join(dir(), 'backups');
  if (!fs.existsSync(b)) return [];
  return fs.readdirSync(b).filter((d) => /^\d{4}-\d\d-\d\d$/.test(d)).sort().reverse();
}

function restoreBackup(day) {
  if (!/^\d{4}-\d\d-\d\d$/.test(day)) throw new Error('Λάθος αντίγραφο.');
  const bdir = path.join(dir(), 'backups', day);
  if (!fs.existsSync(bdir)) throw new Error('Δεν βρέθηκε το αντίγραφο.');
  // Safety copy of the current state first.
  const safety = path.join(dir(), 'backups', 'before-restore-' + Date.now());
  fs.mkdirSync(safety, { recursive: true });
  for (const f of fs.readdirSync(dir())) if (f.endsWith('.json') && !NO_BACKUP.test(f)) fs.writeFileSync(path.join(safety, f + '.gz'), zlib.gzipSync(fs.readFileSync(path.join(dir(), f))));
  // older backups are plain .json, newer ones .json.gz
  for (const f of fs.readdirSync(bdir)) {
    if (f.endsWith('.json.gz')) fs.writeFileSync(path.join(dir(), f.slice(0, -3)), zlib.gunzipSync(fs.readFileSync(path.join(bdir, f))));
    else if (f.endsWith('.json')) fs.copyFileSync(path.join(bdir, f), path.join(dir(), f));
  }
  cache.clear();
}

module.exports = { pack, unpack, restoreFile, isPack, bundle, bundleAsync, unbundle, exists, onWrite, forget, init, dir, setDataDir, read, write, update, exportPath, backup, listBackups, restoreBackup, appConfigDir };
