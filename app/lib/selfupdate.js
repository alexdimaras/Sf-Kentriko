'use strict';
// SF Κέντρο — the worker of a computer updates itself from the program in the cloud: no new download, no click.
//
//   cloud  — build(): the files the worker runs (worker.js, package.json, lib/*.js, vendor/*), gzipped, with their
//            revision (lib/workerrev.js) and a SHA-256 of each file; served only to a paired computer (its token).
//   worker — on its «hello» it learns the cloud's revision; a newer one → apply(): every name checked (only these
//            folders, never «..»), every file checked against its SHA-256, the new worker.js checked by Node
//            (`node --check`) BEFORE anything is replaced; then it ends with code 4 and its starter starts it again.
//   Never older (no downgrade); a revision that failed is tried again after 1 hour.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');

// (root/SF-Kentro-Worker.cmd: the menu of the computer, one folder up — new choices come with the update too)
const NAME_OK = /^(worker\.js|package\.json|lib\/[\w.-]+\.js|vendor\/[\w.-]+\.js|root\/SF-Kentro-Worker\.cmd)$/;
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');

/** The files the worker needs, from the app folder → [relative names] (the dictionary and the tests are not). */
function filesOf(appDir) {
  const out = ['worker.js', 'package.json'];
  for (const d of ['lib', 'vendor']) {
    let list = [];
    try { list = fs.readdirSync(path.join(appDir, d)); } catch (_) { list = []; }
    for (const f of list) if (/\.js$/.test(f) && fs.statSync(path.join(appDir, d, f)).isFile()) out.push(d + '/' + f);
  }
  try { if (fs.statSync(path.join(appDir, '..', 'SF-Kentro-Worker.cmd')).isFile()) out.push('root/SF-Kentro-Worker.cmd'); } catch (_) { /* not in this copy */ }
  return out.filter((n) => NAME_OK.test(n));
}
/** Where a name of the pack goes (root/… is one folder up from the app). */
function target(appDir, n) { return n.startsWith('root/') ? path.join(appDir, '..', n.slice(5)) : path.join(appDir, n); }

/** The pack of the worker's files → Buffer (gzip of JSON { rev, files: { name: { b64, sha } } }). */
// a worker older than this does not know «root/…» names (it refuses the whole pack): it gets a pack without them
const ROOT_FROM = '2026-11-23c';
/** opts: { forRev } — the revision of the worker that asks (an older one gets only what it can take) */
function build(appDir, opts) {
  const rev = String(require(path.join(appDir, 'lib', 'workerrev.js')));
  const withRoot = !(opts && opts.forRev != null) || String(opts.forRev) >= ROOT_FROM;
  const files = {};
  for (const n of filesOf(appDir).filter((x) => withRoot || !x.startsWith('root/'))) { const b = fs.readFileSync(target(appDir, n)); files[n] = { b64: b.toString('base64'), sha: sha(b) }; }
  return { rev, buf: zlib.gzipSync(Buffer.from(JSON.stringify({ rev, files }))) };
}

function copyRetry(from, to) {
  for (let i = 0; ; i++) {
    try { return fs.copyFileSync(from, to); } catch (e) {
      if (i >= 5 || !['EBUSY', 'EPERM', 'EACCES'].includes(e.code)) throw e;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 300 * (i + 1));
    }
  }
}
/** Should this worker update now? → { ok, why } (pure: the tests check it alone). */
function shouldUpdate(mine, theirs, tried, now) {
  const t = String(theirs || ''), m = String(mine || '');
  if (process.env.SFK_NO_UPDATE === '1') return { ok: false, why: 'ενημέρωση κλειστή (SFK_NO_UPDATE)' };
  if (!/^\d{4}-\d\d-\d\d[a-z]?$/.test(t)) return { ok: false, why: 'καμία έκδοση από το cloud' };
  if (t === m) return { ok: false, why: 'ίδια έκδοση' };
  if (t < m) return { ok: false, why: 'το cloud έχει παλιότερη έκδοση (ποτέ προς τα πίσω)' };
  const last = tried && tried[t];
  if (last && (now || Date.now()) - last < 3600e3) return { ok: false, why: 'απέτυχε πριν από λίγο: ξανά σε 1 ώρα' };
  return { ok: true, why: `νέα έκδοση ${t} (τρέχει ${m || '—'})` };
}

/**
 * Apply a pack to the app folder. → { rev, files } · throws (and changes nothing) when anything is wrong.
 * opts: { want (the revision expected), nodeExe (to check the new worker.js), check: false (tests without Node) }
 */
function apply(buf, appDir, opts) {
  const o = opts || {};
  const pack = JSON.parse(zlib.gunzipSync(buf).toString('utf8'));
  if (!pack || typeof pack.files !== 'object') throw new Error('Άκυρο πακέτο ενημέρωσης.');
  if (o.want && pack.rev !== o.want) throw new Error(`Το πακέτο είναι η έκδοση ${pack.rev}, όχι η ${o.want}.`);
  const names = Object.keys(pack.files);
  if (!names.includes('worker.js') || !names.includes('lib/workerrev.js')) throw new Error('Το πακέτο δεν έχει τον worker.');
  // 1. every file checked, written beside the app (nothing of the running app is touched yet)
  const stage = path.join(appDir, '.update-' + process.pid);
  fs.rmSync(stage, { recursive: true, force: true });
  try {
    for (const n of names) {
      if (!NAME_OK.test(n) || n.includes('..')) throw new Error('Μη επιτρεπτό όνομα αρχείου: ' + n);
      const b = Buffer.from(String(pack.files[n].b64 || ''), 'base64');
      if (sha(b) !== pack.files[n].sha) throw new Error('Χαλασμένο αρχείο στο πακέτο: ' + n);
      fs.mkdirSync(path.join(stage, path.dirname(n)), { recursive: true });
      fs.writeFileSync(path.join(stage, n), b);
    }
    // 2. Node reads the new worker and its modules (a broken file is never put in place)
    if (o.check !== false) {
      const { spawnSync } = require('child_process');
      for (const n of names.filter((x) => /\.js$/.test(x))) {
        const r = spawnSync(o.nodeExe || process.execPath, ['--check', path.join(stage, n)], { encoding: 'utf8', timeout: 30000, windowsHide: true });
        if (r.status !== 0) throw new Error('Η νέα έκδοση δεν περνά τον έλεγχο (' + n + '): ' + String(r.stderr || '').split('\n')[0].slice(0, 160));
      }
    }
    // 3. in place, file by file (a .js read by Node is not locked, also on Windows) — the revision LAST: a copy cut in
    // the middle never says «new version» (it is tried again); a file held a moment (antivirus) is tried again 5 times
    const order = names.filter((x) => x !== 'lib/workerrev.js').concat(['lib/workerrev.js']);
    for (const n of order) {
      const to = target(appDir, n);
      // (the computer's menu only where it already is: never a new file outside the worker's folders)
      if (n.startsWith('root/') && !fs.existsSync(to)) continue;
      fs.mkdirSync(path.dirname(to), { recursive: true });
      copyRetry(path.join(stage, n), to);
    }
  } finally {
    // (a folder Windows still holds is left for the next time: never a reason to call a done update «failed»)
    try { fs.rmSync(stage, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch (_) { /* left behind */ }
  }
  return { rev: pack.rev, files: names.length };
}

module.exports = { build, apply, shouldUpdate, filesOf, NAME_OK, ROOT_FROM };
