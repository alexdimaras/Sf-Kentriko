'use strict';
// SF Κέντρο — the internet research measured for real (audit 23/11, phase 5): N products of specialforces.gr (its
// public list, no password), the program's own research for each with the search engines of THIS computer, and what
// it found: the same product elsewhere, code, EAN, price in stock, photos — and wrong colours (must be 0).
// Run by a computer (job «research.measure», a button in Σύστημα) or by hand (node worker.js measure 30).
// Polite: one product at a time, the usual pace of the search engines.

/** opts: { log(text), progress(done, total, msg), cancelled() } → { stats, summary } */
async function run(n, opts) {
  const o = opts || {};
  const log = o.log || (() => {});
  const N = Math.max(5, Math.min(100, Number(n) || 30));
  const http = require('./http');
  const catalog = require('./catalog');
  const cf = require('./codefind');
  const sfind = require('./supplierfind');
  const extract = require('./extract');
  const market = require('./market');
  const ours = [];
  for (let page = 1; page <= 30 && ours.length < N * 4; page += 3) {
    try { const r = await http.getJson(`https://www.specialforces.gr/wp-json/wc/store/v1/products?per_page=100&page=${page}`, { timeout: 60000, gap: 1500 }); for (const p of r.json || []) ours.push(catalog.fromStoreApi(p)); } catch (e) { log('λίστα προϊόντων: ' + e.message); }
  }
  // a spread of kinds: every few-th product of the list (not only the first category)
  const pick = ours.filter((p) => p.type !== 'variation' && p.name).filter((_, i, a) => i % Math.max(1, Math.floor(a.length / N)) === 0).slice(0, N);
  log(`Μέτρηση της έρευνας internet σε ${pick.length} προϊόντα (ένα τη φορά, με τις πραγματικές μηχανές αναζήτησης)…`);
  const state = { blocked: new Set(), used: new Set() };
  const io = { own: new Set(['specialforces.gr', 'stratiotikaeidi.gr']), compHosts: new Set(), supplierHosts: new Set(), search: (q) => sfind.searchWide(q, state), page: (url) => extract.fromUrl(url, { gap: 1500 }), parallel: 2, cancelled: o.cancelled };
  const M = { at: new Date().toISOString(), products: 0, found: 0, sku: 0, ean: 0, price: 0, images: 0, family: 0, statuses: {}, engines: {}, wrongColour: 0, ms: 0, rows: [] };
  let k = 0;
  for (const p of pick) {
    if (o.cancelled && o.cancelled()) break;
    if (o.progress) o.progress(k++, pick.length, 'Μέτρηση: ' + p.name.slice(0, 60));
    const it = { k: 'sf:' + p.id, name: p.name, brand: p.brand || '', sku: p.sku || '', ean: p.ean || '', price: p.price, needs: ['sku', 'ean', 'images', 'price'], mode: 'auto', cat: (p.catNames || [])[0] || '' };
    const t0 = Date.now();
    let r;
    try { r = await cf.lookUp(it, io); } catch (e) { log(`  ✗ ${p.name}: ${e.message}`); M.statuses.error = (M.statuses.error || 0) + 1; continue; }
    M.products++; M.ms += Date.now() - t0;
    M.statuses[r.status] = (M.statuses[r.status] || 0) + 1;
    for (const [id, e] of Object.entries(r.sum.engines || {})) { const x = M.engines[id] || (M.engines[id] = { ok: 0, failed: 0, blocked: 0 }); x.ok += e.ok; x.failed += e.failed; x.blocked += e.blocked; }
    if (r.hits.length) M.found++;
    if (r.hits.some((h) => h.code)) M.sku++;
    if (r.hits.some((h) => market.gtinOf(h.ean))) M.ean++;
    if (r.hits.some((h) => h.price > 0 && h.avail === 'in')) M.price++;
    if (r.hits.some((h) => (h.images || []).length)) M.images++;
    if (r.family.length) M.family++;
    const ourC = market.coloursOf(p.name);
    for (const h of r.hits) { const hc = market.coloursOf(h.name); if (ourC.size && hc.size && [...ourC].some((c) => !hc.has(c)) && [...hc].some((c) => !ourC.has(c))) M.wrongColour++; }
    M.rows.push({ name: p.name.slice(0, 100), sku: p.sku, status: r.status, coverage: r.coverage, queries: r.queries, found: r.hits.map((h) => h.host).slice(0, 8), family: r.family.length });
    log(`  ${r.hits.length ? '✓' : '·'} ${p.name.slice(0, 60)} — ${r.status} · ${r.queries} αναζητ. · ίδιο σε: ${r.hits.map((h) => h.host).join(', ') || '—'}`);
  }
  const pc = (x) => (M.products ? Math.round((100 * x) / M.products) : 0) + '%';
  const summary = `Μέτρηση έρευνας (${M.products} προϊόντα, ${Math.round(M.ms / Math.max(1, M.products) / 1000)}″/προϊόν): βρέθηκε το ίδιο ${pc(M.found)} · κωδικός ${pc(M.sku)} · EAN ${pc(M.ean)} · τιμή διαθέσιμου ${pc(M.price)} · φωτο ${pc(M.images)} · λάθος χρώμα ${M.wrongColour} · καταστάσεις ${JSON.stringify(M.statuses)} · μηχανές ${Object.entries(M.engines).map(([k2, e]) => `${k2} ok ${e.ok}/σφάλμα ${e.failed}/παύση ${e.blocked}`).join(', ')}`;
  return { stats: M, summary };
}

module.exports = { run };
