'use strict';
// The kinds of work the shared queue (lib/coord.js) hands out. Each one runs the SAME code on a shop's computer
// (app/worker.js) or, when no computer can, in the cloud: `run(payload, api, io)` gets what it needs through `io`
// (over the internet on a computer, directly in the cloud), and the cloud alone takes the result in (`apply`).
const zlib = require('zlib');
const store = require('./store');
const coord = require('./coord');
const U = require('./util');

const KEY_RE = /^(sf|st):\d+$/;

/** In the cloud: the pack and the competitor catalogs are right here. */
const localIO = {
  local: true,
  async pack() { const r = require('./research'); return r.readPack((await r.matchPack()).gz); },
  async prev() { return null; }, // the catalog is already in this program's store
};

function register() {
  registerCodes();
  registerAI();
  // ---- the price research for ONE competitor: read its catalog (or part of its site map), compare with ours ----
  coord.register('market.shop', {
    label: 'Έρευνα τιμών σε ένα κατάστημα',
    // a shop's computer: room to spare; the cloud: one shop at a time measured at ~450 MB in all (test/perf: the whole
    // research of 10 shops on a 512 MB machine peaked at 452 MB) — it takes it only with that much memory
    needs: { ramMB: 1500 },
    cloudRamMB: 450,
    cloudOk: true,
    maxAttempts: 3,
    async run(payload, api, io0) {
      const io = io0 || localIO;
      const research = require('./research');
      const compcat = require('./compcat');
      const comp = payload.comp;
      api.progress(0, 0, `${comp.name}: τα δικά μας προϊόντα…`);
      const pack = await io.pack();
      if (!io.local) {
        // the catalog as the cloud keeps it (incremental reading needs it; site-map shops know which pages they read)
        const prev = await io.prev(comp.id);
        if (prev) store.write('comp-' + comp.id, prev);
      }
      const extra = { budget: payload.budget || 300, want: comp.kind === 'sitemap' ? await research.wantedFromPack(pack) : null };
      let total = 0, done = 0;
      const prog = { note: (t) => api.progress(done, total, `${comp.name}: ${t}`), addTotal: (n) => { total += n; api.progress(done, total, `${comp.name}: κατάλογος…`); }, add: (n) => { done += n; api.progress(done, total, `${comp.name}: ${done.toLocaleString('el-GR')}/${total.toLocaleString('el-GR')}`); } };
      let read = null;
      if (!payload.skipDownload) read = await compcat.syncOne(comp, Object.assign({ prog, cancelled: api.cancelled, signal: api.signal, full: false }, extra));
      if (api.cancelled()) throw Object.assign(new Error('Σταμάτησε.'), { cancelled: true });
      const cmp = await research.compareShop(pack, comp, api);
      const out = { catAt: cmp.catAt, offers: cmp.offers, read };
      if (!io.local) out.catalogGz = zlib.gzipSync(Buffer.from(JSON.stringify(compcat.load(comp.id)))).toString('base64');
      return out;
    },
    async apply(job, result) {
      const comp = job.payload.comp;
      const r = result || {};
      if (r.catalogGz) {
        // at most 64 MB once opened (a shop's catalog is a few MB): a result that would open bigger is refused
        let raw;
        try { raw = zlib.gunzipSync(Buffer.from(String(r.catalogGz), 'base64'), { maxOutputLength: 64 * 1024 * 1024 }); } catch (e) { throw new Error('Ο κατάλογος του αποτελέσματος είναι πολύ μεγάλος ή χαλασμένος.'); }
        const cat = JSON.parse(raw.toString('utf8'));
        if (!cat || !Array.isArray(cat.products) || cat.products.length > 200000) throw new Error('Λάθος κατάλογος.');
        if (!cat || !Array.isArray(cat.products)) throw new Error('Λάθος κατάλογος.');
        store.write('comp-' + comp.id, cat);
        store.forget('comp-' + comp.id);
      }
      // only offers for our products, from this competitor (a result never writes anything else)
      const offers = {};
      for (const [k, o] of Object.entries(r.offers || {})) {
        if (!KEY_RE.test(k) || !o || typeof o !== 'object' || !(Number(o.price) > 0)) continue;
        offers[k] = Object.assign({}, o, { competitorId: comp.id, shop: comp.name, price: U.r2(Number(o.price)) });
      }
      const m = await require('./research').mergeShop(comp.id, String(r.catAt || ''), offers);
      return { offers: Object.keys(offers).length, products: m.touched, changes: m.changes, read: r.read || null };
    },
  });
}

function registerAI() {
  // ---- the free AI (Ollama) of a shop's computer, for the program in the cloud: one question, one answer ----
  coord.register('ai.call', {
    label: 'Τοπικό AI (Ollama)',
    needs: { ramMB: 4000 },
    cloudOk: false,
    maxAttempts: 1,
    // only a computer that has the model asked for (and the one asked for, when the cloud names it)
    canTake(w, j) {
      const p = j.payload || {};
      if (p.worker && p.worker !== w.id) return false;
      if (p.model && Array.isArray(w.caps.ollama) && w.caps.ollama.length && !w.caps.ollama.includes(p.model)) return false;
      return true;
    },
    async run(payload, api) {
      const localai = require('./localai');
      const path = payload.path === '/api/tags' ? '/api/tags' : payload.path === '/api/generate' ? '/api/generate' : null;
      if (!path) throw new Error('Άγνωστη ερώτηση προς το AI.');
      api.progress(0, 1, path === '/api/tags' ? 'Έλεγχος του Ollama…' : 'Το AI του υπολογιστή γράφει…');
      // the same address the worker checks every minute (worker.json «ollamaUrl», else SFK_OLLAMA_URL, else 127.0.0.1)
      const base = localai.resolveUrl(process.env.SFK_WORKER_OLLAMA_URL || '');
      const b = payload.body || {};
      const body = path === '/api/generate' ? { model: String(b.model || ''), prompt: String(b.prompt || '').slice(0, 60000), stream: false, keep_alive: b.keep_alive || '15m', options: b.options && typeof b.options === 'object' ? b.options : {} } : null;
      const t0 = Date.now();
      let j;
      try { j = await localai.ollamaFetch(base, path, body, { timeout: path === '/api/tags' ? 15000 : Number(payload.timeout) || 300000, signal: api.signal }); } catch (e) {
        // the reason travels to the cloud as it is (missing model, memory, Ollama closed…)
        throw Object.assign(new Error(e.message), { fatal: true, cancelled: !!e.cancelled });
      }
      if (path === '/api/tags') return { models: (j.models || []).map((x) => ({ name: x.name, size: x.size || 0, details: x.details ? { family: x.details.family || '', families: x.details.families || [], parameter_size: x.details.parameter_size || '' } : {} })) };
      return { response: String(j.response || ''), model: String(j.model || body.model), eval_count: Number(j.eval_count) || 0, done_reason: String(j.done_reason || ''), ms: Date.now() - t0 };
    },
    async apply(job, result) {
      const r = result || {};
      if (r.models) return { models: r.models.slice(0, 50).map((x) => ({ name: String(x.name || '').slice(0, 100), size: Number(x.size) || 0, details: { family: String((x.details || {}).family || '').slice(0, 40), families: ((x.details || {}).families || []).slice(0, 6).map((f) => String(f).slice(0, 40)), parameter_size: String((x.details || {}).parameter_size || '').slice(0, 20) } })) };
      return { response: String(r.response || '').slice(0, 40000), model: String(r.model || '').slice(0, 100), eval_count: Number(r.eval_count) || 0, done_reason: String(r.done_reason || '').slice(0, 20), ms: Number(r.ms) || 0 };
    },
  });
}

/** A research result as the cloud keeps it: only known fields, bounded (a computer's answer is never trusted as it is). */
function cleanResearch(r) {
  const str = (v, n) => String(v == null ? '' : v).slice(0, n);
  const url = (v) => (/^https?:\/\//.test(String(v || '')) ? String(v).slice(0, 500) : '');
  const out = { read: Number(r.read) || 0, hits: r.hits.slice(0, 12).filter((h) => h && typeof h === 'object').map((h) => ({
    host: str(h.host, 100), url: url(h.url), name: str(h.name, 200), brand: str(h.brand, 60), code: str(h.code, 60), sku: str(h.sku, 60), mpn: str(h.mpn, 60),
    ean: String(h.ean || '').replace(/\D/g, '').slice(0, 14), price: Number(h.price) > 0 ? U.r2(Number(h.price)) : 0, regular: Number(h.regular) > 0 ? U.r2(Number(h.regular)) : 0,
    currency: str(h.currency, 5).toUpperCase(), avail: ['in', 'out'].includes(h.avail) ? h.avail : 'unknown', priceKind: ['single', 'from', 'other-colour'].includes(h.priceKind) ? h.priceKind : 'single',
    img: url(h.img), images: (Array.isArray(h.images) ? h.images : []).map(url).filter(Boolean).slice(0, 4),
    how: ['code', 'ean'].includes(h.how) ? h.how : 'words', match: h.match === 'code' ? 'code' : 'exact', at: /^\d{4}-\d\d-\d\dT/.test(String(h.at || '')) ? str(h.at, 30) : U.nowIso(), proof: str(h.proof, 200),
  })).filter((h) => h.host) };
  // what happened (a result from an older worker has none: it is kept as before)
  const ST = ['complete', 'partial', 'not_found', 'no_results', 'pages_failed', 'search_failed', 'blocked', 'cancelled', 'error'];
  if (ST.includes(r.status)) {
    out.status = r.status;
    out.queries = Number(r.queries) || 0;
    out.needsLeft = (Array.isArray(r.needsLeft) ? r.needsLeft : []).filter((x) => ['sku', 'ean', 'images', 'brand', 'price'].includes(x));
    if (r.sum && typeof r.sum === 'object') out.sum = JSON.parse(JSON.stringify(r.sum, (k, v) => (typeof v === 'string' ? v.slice(0, 40) : v)).slice(0, 2000));
    const t = r.trace && typeof r.trace === 'object' ? r.trace : null;
    if (t) out.trace = { at: str(t.at, 30), error: str(t.error, 200),
      queries: (Array.isArray(t.queries) ? t.queries : []).slice(0, 12).map((q) => ({ q: str(q.q, 160), n: Number(q.n) || 0, error: str(q.error, 140), engines: Array.isArray(q.engines) ? q.engines.slice(0, 4).map((e) => ({ id: str(e.id, 10), state: str(e.state, 10), n: Number(e.n) || 0, error: str(e.error, 120) })) : null })),
      pages: (Array.isArray(t.pages) ? t.pages : []).slice(0, 40).map((x) => ({ url: url(x.url).slice(0, 300), host: str(x.host, 100), q: Number(x.q) || 0, outcome: str(x.outcome, 16), why: str(x.why, 140) })) };
  }
  return out;
}

function registerCodes() {
  // ---- codes (SKU / EAN) of products without one, from the shops of the internet that show the same product ----
  // A shop's computer searches from its own connection (the search engines often turn a cloud machine away); when no
  // computer has been on for a while, the cloud does a few itself (coord.cloudTick), more slowly.
  coord.register('codes.web', {
    label: 'Έρευνα στο internet (κωδικοί, EAN, φωτογραφίες, μάρκα, τιμή)',
    needs: { ramMB: 500 },
    cloudOk: true,
    cloudRamMB: 250,
    maxAttempts: 2,
    // a group left waiting for days (all computers off, the cloud turned away by the engines): it ends, it is queued anew
    expireMs: 3 * 864e5,
    // a second attempt (the first computer went off): the products already handed in are not searched again
    prepare(payload) {
      const done = new Set(payload.doneKeys || []);
      return done.size ? Object.assign({}, payload, { items: (payload.items || []).filter((x) => !done.has(x.k)) }) : payload;
    },
    async run(payload, api) {
      const cf = require('./codefind');
      const sfind = require('./supplierfind');
      const extract = require('./extract');
      const state = { blocked: new Set(), used: new Set(), signal: api.signal };
      const io = { own: new Set(payload.own || []), search: (q) => sfind.searchWide(q, state), page: (url) => extract.fromUrl(url, { gap: 1500, signal: state.signal }), cancelled: api.cancelled, parallel: api.cloud ? 2 : 6 };
      const results = {};
      const items = (payload.items || []).slice(0, 40);
      let i = 0;
      let rested = 0;
      let sent = {};
      for (const it of items) {
        if (api.cancelled()) break;
        api.progress(i, items.length, `Έρευνα στο internet: ${it.name}`);
        let r = null;
        for (;;) {
          try { r = await cf.lookUp(it, io); break; } catch (e) {
            if (!(e instanceof sfind.Blocked)) { r = { hits: [], read: 0, status: e && e.cancelled ? 'cancelled' : 'error', trace: { at: U.nowIso(), queries: [], pages: [], error: String(e.message || e).slice(0, 200) } }; break; }
            // the search engines rest: on a computer, wait a minute and go on (up to a quarter of an hour); in the cloud
            // (one job at a time there) stop: the products left are due again in a few hours
            if (api.cloud || rested >= 15 || api.cancelled()) break;
            api.progress(i, items.length, 'Οι μηχανές αναζήτησης ζήτησαν παύση· συνεχίζει σε λίγο…');
            await new Promise((x) => setTimeout(x, 60000));
            rested++; state.blocked.clear();
          }
        }
        if (!r) break; // blocked: what is left stays for later (never written as «nothing found»)
        results[it.k] = r; sent[it.k] = r;
        // handed in as it goes: a computer switched off in the middle loses nothing that was found
        if (api.partial && Object.keys(sent).length >= 3) { await api.partial({ results: sent }); sent = {}; }
        if (r.status === 'blocked' && api.cloud) break;
        if (r.status === 'cancelled') break;
        sfind.count('product');
        i++;
      }
      if (api.partial && Object.keys(sent).length) await api.partial({ results: sent });
      return { results };
    },
    async applyPartial(job, result) {
      const want = new Set((job.payload.items || []).map((x) => x.k));
      // each product is written once (a part handed in during the work is not written again with the whole result)
      const done = new Set(job.payload.doneKeys || []);
      const clean = {};
      for (const [k, r] of Object.entries((result && result.results) || {})) {
        if (!KEY_RE.test(k) || !want.has(k) || done.has(k) || !r || !Array.isArray(r.hits)) continue;
        clean[k] = cleanResearch(r);
      }
      if (Object.keys(clean).length) require('./codefind').save(clean);
      return Object.keys(clean);
    },
    async apply(job, result) {
      await this.applyPartial(job, result);
      const res = (result && result.results) || {};
      const keys = Object.keys(res).filter((k) => KEY_RE.test(k) && res[k] && Array.isArray(res[k].hits));
      return { products: keys.length, withCode: keys.filter((k) => (res[k].hits || []).some((h) => h.code || h.ean)).length, failed: keys.filter((k) => require('./codefind').FAILED.has(res[k].status)).length };
    },
  });
}

/** The data a computer may fetch for a job it holds: the pack, and the catalog of that job's competitor. */
async function packFor() { return require('./research').matchPack(); }
function compFor(job, compId) {
  if (!job || job.type !== 'market.shop' || job.payload.comp.id !== compId) return null;
  const c = store.read('comp-' + compId, null);
  return c ? zlib.gzipSync(Buffer.from(JSON.stringify(c))) : null;
}

module.exports = { register, localIO, packFor, compFor, cleanResearch };
