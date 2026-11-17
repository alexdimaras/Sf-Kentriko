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
  // ---- the price research for ONE competitor: read its catalog (or part of its site map), compare with ours ----
  coord.register('market.shop', {
    label: 'Έρευνα τιμών σε ένα κατάστημα',
    needs: { ramMB: 1500 },
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
        const cat = JSON.parse(zlib.gunzipSync(Buffer.from(String(r.catalogGz), 'base64')).toString('utf8'));
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

function registerCodes() {
  // ---- codes (SKU / EAN) of products without one, from the shops of the internet that show the same product ----
  // A shop's computer searches from its own connection (the search engines often turn a cloud machine away).
  coord.register('codes.web', {
    label: 'Κωδικοί από το internet',
    needs: { ramMB: 500 },
    cloudOk: true,
    maxAttempts: 2,
    async run(payload, api) {
      const cf = require('./codefind');
      const sfind = require('./supplierfind');
      const extract = require('./extract');
      const state = { blocked: new Set(), used: new Set(), signal: api.signal };
      const io = { own: new Set(payload.own || []), search: (q) => sfind.search(q, state), page: (url) => extract.fromUrl(url, { gap: 1500 }), cancelled: api.cancelled };
      const results = {};
      const items = (payload.items || []).slice(0, 40);
      let i = 0;
      for (const it of items) {
        if (api.cancelled()) break;
        api.progress(i, items.length, `Κωδικοί από το internet: ${it.name}`);
        try { results[it.k] = await cf.lookUp(it, io); } catch (e) { if (e instanceof sfind.Blocked) break; results[it.k] = { hits: [], read: 0 }; }
        i++;
      }
      return { results };
    },
    async apply(job, result) {
      const want = new Set((job.payload.items || []).map((x) => x.k));
      const clean = {};
      for (const [k, r] of Object.entries((result && result.results) || {})) {
        if (!KEY_RE.test(k) || !want.has(k) || !r || !Array.isArray(r.hits)) continue;
        clean[k] = { read: Number(r.read) || 0, hits: r.hits.slice(0, 10).filter((h) => h && typeof h === 'object').map((h) => ({ host: String(h.host || '').slice(0, 100), url: /^https?:\/\//.test(String(h.url || '')) ? String(h.url).slice(0, 500) : '', name: String(h.name || '').slice(0, 200), brand: String(h.brand || '').slice(0, 60), code: String(h.code || '').slice(0, 60), ean: String(h.ean || '').replace(/\D/g, '').slice(0, 14), price: Number(h.price) > 0 ? U.r2(Number(h.price)) : 0, img: /^https?:\/\//.test(String(h.img || '')) ? String(h.img).slice(0, 500) : '', proof: String(h.proof || '').slice(0, 200) })).filter((h) => h.host) };
      }
      require('./codefind').save(clean);
      return { products: Object.keys(clean).length, withCode: Object.values(clean).filter((r) => r.hits.some((h) => h.code || h.ean)).length };
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

module.exports = { register, localIO, packFor, compFor };
