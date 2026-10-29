'use strict';
// JSON files in a data folder (default: Documents\SF-Kentro). Atomic writes, in-memory cache, daily backups.
const fs = require('fs');
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

function read(name, def) {
  if (cache.has(name)) return cache.get(name);
  let v;
  try { v = JSON.parse(fs.readFileSync(file(name), 'utf8')); } catch (e) {
    if (e.code !== 'ENOENT') {
      // Corrupt file: keep a copy, start from default so the app still opens.
      try { fs.copyFileSync(file(name), file(name) + '.broken-' + Date.now()); } catch (_) { /* ignore */ }
    }
    v = typeof def === 'function' ? def() : (def === undefined ? null : JSON.parse(JSON.stringify(def)));
  }
  cache.set(name, v);
  return v;
}

function write(name, value) {
  cache.set(name, value);
  const f = file(name);
  const tmp = f + '.tmp-' + process.pid;
  fs.writeFileSync(tmp, JSON.stringify(value));
  fs.renameSync(tmp, f);
  return value;
}

function update(name, def, fn) {
  const v = read(name, def);
  const r = fn(v);
  return write(name, r === undefined ? v : r);
}

/** Drop a big file from memory (it is read again from disk when needed). */
function forget(name) { cache.delete(name); }

function exportPath(fname) {
  const safe = String(fname).replace(/[\\/:*?"<>|]+/g, '-');
  return path.join(dir(), 'exports', safe);
}

function backup(keep) {
  const day = new Date().toISOString().slice(0, 10);
  const bdir = path.join(dir(), 'backups', day);
  if (fs.existsSync(bdir)) return null;
  fs.mkdirSync(bdir, { recursive: true });
  for (const f of fs.readdirSync(dir())) {
    if (f.endsWith('.json')) fs.copyFileSync(path.join(dir(), f), path.join(bdir, f));
  }
  const all = fs.readdirSync(path.join(dir(), 'backups')).filter((d) => /^\d{4}-\d\d-\d\d$/.test(d)).sort();
  while (all.length > (keep || 14)) {
    const old = all.shift();
    fs.rmSync(path.join(dir(), 'backups', old), { recursive: true, force: true });
  }
  return bdir;
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
  for (const f of fs.readdirSync(dir())) if (f.endsWith('.json')) fs.copyFileSync(path.join(dir(), f), path.join(safety, f));
  for (const f of fs.readdirSync(bdir)) if (f.endsWith('.json')) fs.copyFileSync(path.join(bdir, f), path.join(dir(), f));
  cache.clear();
}

module.exports = { forget, init, dir, setDataDir, read, write, update, exportPath, backup, listBackups, restoreBackup, appConfigDir };
