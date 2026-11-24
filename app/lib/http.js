'use strict';
// HTTP client for reading public shop data: timeouts, retries, per-host pacing, clear Greek errors.
const { sleep, hostOf } = require('./util');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const lastHit = new Map();
/** A pause that ends at once when the job that asked for it is stopped. */
function nap(ms, signal) {
  if (!signal) return sleep(ms);
  if (signal.aborted) return Promise.resolve();
  return new Promise((r) => { const t = setTimeout(done, ms); function done() { clearTimeout(t); signal.removeEventListener('abort', done); r(); } signal.addEventListener('abort', done, { once: true }); });
}

class HttpError extends Error {
  constructor(msg, info) { super(msg); Object.assign(this, info || {}); }
}

// ---------- only the public internet (no requests into a private network) ----------
// Addresses come from people (a competitor, a supplier page) and from other sites (search results, site maps,
// redirects). The program never opens one that leads into a private network: this machine, the local network, the
// cloud provider's internal addresses. Checked for the first address and for every redirect. (SFK_ALLOW_PRIVATE=1:
// the tests, which run little shops on this machine.)
const dns = require('dns');
const net = require('net');
function privateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) || (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19)) || a >= 224;
  }
  const x = ip.toLowerCase();
  if (x.startsWith('::ffff:')) return privateIp(x.slice(7));
  return x === '::' || x === '::1' || x.startsWith('fc') || x.startsWith('fd') || x.startsWith('fe8') || x.startsWith('fe9') || x.startsWith('fea') || x.startsWith('feb') || x.startsWith('ff');
}
const okHosts = new Map(); // host → time it was checked (for a minute)
async function assertPublic(url) {
  if (process.env.SFK_ALLOW_PRIVATE === '1') return;
  let u;
  try { u = new URL(url); } catch (_) { throw new HttpError('Λάθος διεύθυνση.', { fatal: true }); }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new HttpError('Μόνο διευθύνσεις http/https.', { fatal: true });
  if (u.username || u.password) throw new HttpError('Διεύθυνση με κωδικό μέσα: δεν επιτρέπεται.', { fatal: true });
  const host = u.hostname.replace(/^\[|\]$/g, '');
  // (tests only: a little server on this machine that stands for a public site)
  if (process.env.SFK_TREAT_PUBLIC && process.env.SFK_TREAT_PUBLIC.split(',').includes(u.host)) return;
  if (/^(localhost|.*\.localhost|.*\.local|.*\.internal|metadata(\..*)?)$/i.test(host)) throw new HttpError(`Η διεύθυνση ${host} είναι εσωτερική: δεν επιτρέπεται.`, { fatal: true, private: true });
  const seen = okHosts.get(host);
  if (seen && Date.now() - seen < 60000) return;
  const addrs = net.isIP(host) ? [{ address: host }] : await new Promise((ok, no) => dns.lookup(host, { all: true }, (e, a) => (e ? no(e) : ok(a)))).catch((e) => { const er = new Error(e.message); er.cause = e; throw er; });
  if (!addrs.length || addrs.some((a) => privateIp(a.address))) throw new HttpError(`Η διεύθυνση ${host} οδηγεί σε εσωτερικό δίκτυο: δεν επιτρέπεται.`, { fatal: true, private: true });
  okHosts.set(host, Date.now());
}

/**
 * The address checked IS the address connected to (audit 23/11, «DNS rebinding»): the name is looked up once more at
 * the moment of the connection, inside the connection itself, and a private address is refused there too — a name
 * that answers «public» to the check and «127.0.0.1» to the connection gets nothing. (Node's own fetch: a dispatcher
 * of the same kind as its global one, with this lookup — no extra package.)
 */
function guardLookup(host, opts, cb) {
  const o = Object.assign({}, opts || {});
  dns.lookup(host, Object.assign({}, o, { all: true }), (e, addrs) => {
    if (e) return cb(e);
    const list = Array.isArray(addrs) ? addrs : [{ address: addrs, family: o.family || 4 }];
    if (!list.length || list.some((a) => privateIp(a.address))) { const er = new Error(`Η διεύθυνση ${host} οδηγεί σε εσωτερικό δίκτυο: δεν επιτρέπεται.`); er.code = 'EPRIVATE'; return cb(er); }
    if (o.all) return cb(null, list);
    return cb(null, list[0].address, list[0].family);
  });
}
let guarded;
async function guardedDispatcher() {
  if (process.env.SFK_ALLOW_PRIVATE === '1' || process.env.SFK_TREAT_PUBLIC) return undefined;
  if (guarded !== undefined) return guarded || undefined;
  try {
    const sym = Symbol.for('undici.globalDispatcher.1');
    if (!globalThis[sym]) { const c = new AbortController(); c.abort(); await fetch('http://127.0.0.1:9/', { signal: c.signal }).catch(() => {}); }
    const G = globalThis[sym];
    guarded = G && typeof G.constructor === 'function' ? new G.constructor({ connect: { lookup: guardLookup } }) : null;
  } catch (_) { guarded = null; }
  return guarded || undefined;
}

async function pace(host, minGap, signal) {
  if (!minGap) return;
  for (;;) {
    const last = lastHit.get(host) || 0;
    const wait = last + minGap - Date.now();
    if (wait <= 0 || (signal && signal.aborted)) break;
    await nap(wait, signal);
  }
  lastHit.set(host, Date.now());
}

function explain(status, url, bodyStart, headers) {
  const h = hostOf(url);
  const cf = /cloudflare/i.test(headers.get('server') || '') || /cf-ray|cf-mitigated/i.test([...headers.keys()].join(' '));
  if (cf && (status === 403 || status === 503 || /challenge|just a moment|cf-chl/i.test(bodyStart))) {
    return `Το ${h} μπλόκαρε την ανάγνωση (Cloudflare). Δοκίμασε ξανά αργότερα ή χρησιμοποίησε εισαγωγή αρχείου CSV από το διαχειριστικό.`;
  }
  if (status === 401 || status === 403) return `Το ${h} δεν επιτρέπει πρόσβαση σε αυτά τα δεδομένα (σφάλμα ${status}).`;
  if (status === 404) return `Δεν βρέθηκε η διεύθυνση στο ${h} (404). Ίσως το site δεν είναι WooCommerce ή έχει κλειστό το δημόσιο API.`;
  if (status === 429) return `Το ${h} ζήτησε να κάνουμε πιο αργά αιτήματα (429).`;
  if (status >= 500) return `Το ${h} απάντησε με σφάλμα διακομιστή (${status}).`;
  return `Το ${h} απάντησε με σφάλμα ${status}.`;
}

/**
 * GET a URL. opts: { timeout, retries, gap (ms between hits to the same host), json, accept, headers }
 * Returns { status, headers, text, json, url }.
 */
async function get(url, opts) {
  const o = Object.assign({ timeout: 25000, retries: 2, gap: 0, json: false }, opts || {});
  const host = hostOf(url);
  let lastErr;
  for (let attempt = 0; attempt <= o.retries; attempt++) {
    if (o.signal && o.signal.aborted) throw new HttpError('Σταμάτησε.', { cancelled: true, fatal: true });
    await pace(host, o.gap, o.signal);
    if (o.signal && o.signal.aborted) throw new HttpError('Σταμάτησε.', { cancelled: true, fatal: true });
    const ctl = new AbortController();
    const onStop = () => { try { ctl.abort(); } catch (_) { /* ignore */ } };
    if (o.signal) o.signal.addEventListener('abort', onStop, { once: true });
    let t = null;
    try {
      // A hard deadline for the whole answer (headers AND body). The abort signal alone is not enough: after a
      // connection dies quietly, reading the body can wait for ever, and a whole job would hang with it.
      const work = (async () => {
        // redirects one by one: each new address is checked like the first
        let at = url, r = null;
        for (let hop = 0; ; hop++) {
          await assertPublic(at);
          const dispatcher = await guardedDispatcher();
          r = await fetch(at, Object.assign(dispatcher ? { dispatcher } : {}, {
            redirect: 'manual',
            signal: ctl.signal,
            headers: Object.assign({
              'User-Agent': UA,
              'Accept': o.accept || (o.json ? 'application/json, text/plain, */*' : 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'),
              'Accept-Language': 'el-GR,el;q=0.9,en;q=0.8',
            }, o.headers || {}),
          }));
          const loc = r.status >= 300 && r.status < 400 ? r.headers.get('location') : null;
          if (!loc) break;
          if (hop >= 8) throw new HttpError(`Πάρα πολλές ανακατευθύνσεις από το ${host}.`, { fatal: true });
          try { await r.body?.cancel(); } catch (_) { /* nothing to read */ }
          at = new URL(loc, at).toString();
        }
        const buf = Buffer.from(await r.arrayBuffer());
        return { res: r, buf, finalUrl: at };
      })();
      work.catch(() => {}); // if the deadline wins, a late failure of the abandoned request is nobody's problem
      const deadline = new Promise((_, reject) => { t = setTimeout(() => { try { ctl.abort(); } catch (_) { /* ignore */ } const e = new Error('deadline'); e.name = 'AbortError'; reject(e); }, o.timeout); });
      // (the listener is taken off again below: one left on a long job's signal kept every page it read in memory —
      // 0,3 MB a page, until a small cloud machine ran out)
      let onAbort = null;
      const stopped = new Promise((_, reject) => { if (o.signal) { onAbort = () => reject(new HttpError('Σταμάτησε.', { cancelled: true, fatal: true })); o.signal.addEventListener('abort', onAbort, { once: true }); } });
      let res, buf, finalUrl;
      try { ({ res, buf, finalUrl } = await Promise.race([work, deadline, stopped])); } finally { if (onAbort) o.signal.removeEventListener('abort', onAbort); }
      clearTimeout(t);
      const text = o.raw ? '' : buf.toString('utf8');
      if (res.status === 429 || res.status === 503) {
        const ra = parseInt(res.headers.get('retry-after') || '0', 10);
        lastErr = new HttpError(explain(res.status, url, text.slice(0, 2000), res.headers), { status: res.status });
        if (attempt < o.retries && !/Cloudflare/.test(lastErr.message)) { await nap(Math.min(30, ra || (attempt + 1) * 4) * 1000, o.signal); continue; }
        throw lastErr;
      }
      if (res.status >= 400) throw new HttpError(explain(res.status, url, text.slice(0, 2000), res.headers), { status: res.status, fatal: res.status < 500 });
      if (o.signal) o.signal.removeEventListener('abort', onStop);
      const out = { status: res.status, headers: res.headers, text, buf, url: finalUrl || res.url || url };
      if (o.json) {
        const trimmed = text.replace(/^﻿/, '').trimStart();
        if (!/^[[{]/.test(trimmed)) {
          const cf = /challenge|just a moment|cf-chl|cloudflare/i.test(text.slice(0, 3000));
          throw new HttpError(cf
            ? `Το ${host} έδειξε σελίδα ελέγχου ασφαλείας (Cloudflare) αντί για δεδομένα. Χρησιμοποίησε εισαγωγή αρχείου CSV ή δοκίμασε αργότερα.`
            : `Το ${host} δεν επέστρεψε δεδομένα προϊόντων (δεν είναι JSON). Ίσως δεν είναι WooCommerce ή το API είναι κλειστό.`, { status: res.status, fatal: true });
        }
        try { out.json = JSON.parse(trimmed); } catch (e) { throw new HttpError(`Χαλασμένα δεδομένα από ${host}.`, { fatal: true }); }
      }
      return out;
    } catch (e) {
      clearTimeout(t);
      if (o.signal) o.signal.removeEventListener('abort', onStop);
      if (o.signal && o.signal.aborted) throw new HttpError('Σταμάτησε.', { cancelled: true, fatal: true });
      if (e instanceof HttpError) {
        if (e.fatal || attempt >= o.retries) throw e;
        lastErr = e;
      } else {
        const code = (e.cause && (e.cause.code || e.cause.name)) || e.name;
        let msg;
        if (e.name === 'AbortError') msg = `Το ${host} άργησε να απαντήσει.`;
        else if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') msg = `Δεν βρέθηκε το ${host}. Έλεγξε τη διεύθυνση ή τη σύνδεση στο internet.`;
        else if (code === 'ECONNREFUSED') msg = `Το ${host} αρνήθηκε τη σύνδεση.`;
        else if (code === 'EPRIVATE' || (e.cause && e.cause.code === 'EPRIVATE')) throw new HttpError(`Η διεύθυνση ${host} οδηγεί σε εσωτερικό δίκτυο: δεν επιτρέπεται.`, { fatal: true, private: true });
        else if (/CERT|SSL|TLS/i.test(String(code) + e.message)) msg = `Πρόβλημα πιστοποιητικού ασφαλείας με το ${host}.`;
        else msg = `Αποτυχία σύνδεσης με ${host}: ${e.message}`;
        lastErr = new HttpError(msg, { network: true });
        if (attempt >= o.retries) throw lastErr;
      }
      await nap(1500 * (attempt + 1), o.signal);
    }
  }
  throw lastErr;
}

async function getJson(url, opts) { return get(url, Object.assign({}, opts, { json: true })); }

/** Run async fn over items with limited concurrency. fn(item, index). Stops early if shouldStop() returns true. */
async function pool(items, limit, fn, shouldStop) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    for (;;) {
      if (shouldStop && shouldStop()) return;
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
  return results;
}

module.exports = { guardLookup, guardedDispatcher, assertPublic, privateIp, get, getJson, pool, nap, HttpError, UA };
