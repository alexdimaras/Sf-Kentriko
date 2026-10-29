'use strict';
// HTTP client for reading public shop data: timeouts, retries, per-host pacing, clear Greek errors.
const { sleep, hostOf } = require('./util');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const lastHit = new Map();

class HttpError extends Error {
  constructor(msg, info) { super(msg); Object.assign(this, info || {}); }
}

async function pace(host, minGap) {
  if (!minGap) return;
  for (;;) {
    const last = lastHit.get(host) || 0;
    const wait = last + minGap - Date.now();
    if (wait <= 0) break;
    await sleep(wait);
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
    await pace(host, o.gap);
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), o.timeout);
    try {
      const res = await fetch(url, {
        redirect: 'follow',
        signal: ctl.signal,
        headers: Object.assign({
          'User-Agent': UA,
          'Accept': o.accept || (o.json ? 'application/json, text/plain, */*' : 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'),
          'Accept-Language': 'el-GR,el;q=0.9,en;q=0.8',
        }, o.headers || {}),
      });
      const buf = Buffer.from(await res.arrayBuffer());
      clearTimeout(t);
      const text = o.raw ? '' : buf.toString('utf8');
      if (res.status === 429 || res.status === 503) {
        const ra = parseInt(res.headers.get('retry-after') || '0', 10);
        lastErr = new HttpError(explain(res.status, url, text.slice(0, 2000), res.headers), { status: res.status });
        if (attempt < o.retries && !/Cloudflare/.test(lastErr.message)) { await sleep(Math.min(30, ra || (attempt + 1) * 4) * 1000); continue; }
        throw lastErr;
      }
      if (res.status >= 400) throw new HttpError(explain(res.status, url, text.slice(0, 2000), res.headers), { status: res.status, fatal: res.status < 500 });
      const out = { status: res.status, headers: res.headers, text, buf, url: res.url || url };
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
      if (e instanceof HttpError) {
        if (e.fatal || attempt >= o.retries) throw e;
        lastErr = e;
      } else {
        const code = (e.cause && (e.cause.code || e.cause.name)) || e.name;
        let msg;
        if (e.name === 'AbortError') msg = `Το ${host} άργησε να απαντήσει.`;
        else if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') msg = `Δεν βρέθηκε το ${host}. Έλεγξε τη διεύθυνση ή τη σύνδεση στο internet.`;
        else if (code === 'ECONNREFUSED') msg = `Το ${host} αρνήθηκε τη σύνδεση.`;
        else if (/CERT|SSL|TLS/i.test(String(code) + e.message)) msg = `Πρόβλημα πιστοποιητικού ασφαλείας με το ${host}.`;
        else msg = `Αποτυχία σύνδεσης με ${host}: ${e.message}`;
        lastErr = new HttpError(msg, { network: true });
        if (attempt >= o.retries) throw lastErr;
      }
      await sleep(1500 * (attempt + 1));
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

module.exports = { get, getJson, pool, HttpError, UA };
