'use strict';
// SF Κέντρο — the research of the internet measured LIVE, on real shops and real product pages.
//
//   node test/bench/live-research.js [--terms a,b,c] [--per 1] [--json out.json]
//
// Our products come live from specialforces.gr (its public product list); the research is the program's own
// (codefind.lookUp: the plan of searches, the pages read with extract.fromUrl, «the same variant» / «the same family»,
// the photos of our variant). The «search engine» here is the public product search of real Greek shops (WooCommerce
// Store API) — where this runs the web search engines may be closed (in the cloud test environment they are), on the
// shop's PC the program uses DuckDuckGo / Bing / Yahoo and the optional APIs as well. Polite: few searches per product,
// 1,2 s between two requests to the same shop.
process.env.SFK_ALLOW_PRIVATE = process.env.SFK_ALLOW_PRIVATE || '';
const fs = require('fs');
const os = require('os');
const path = require('path');
const APP = path.join(__dirname, '..', '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sfk-live-'));
process.env.SFK_DATA = path.join(tmp, 'data');
process.env.APPDATA = path.join(tmp, 'cfg');
fs.mkdirSync(process.env.SFK_DATA, { recursive: true });
const args = process.argv.slice(2);
const arg = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const OUR = 'https://www.specialforces.gr';
const SHOPS = (arg('--shops', 'amerikaniki-agora.gr,sergeant.gr,hardgearhellas.gr')).split(',');
const TERMS = arg('--terms', 'assault molle,mil-tec,helikon,pentagon,nitecore,mechanix,fenix,brandit,σακίδιο,αρβύλα,φακός,μαχαίρι,γάντια,παντελόνι,ζώνη,καπέλο,θήκη,κιάλια,μπουφάν,παγούρι,τζόκεϊ,μπλούζα').split(',');
const PER = Number(arg('--per', '1'));

(async () => {
  const http = require(APP + '/lib/http');
  const catalog = require(APP + '/lib/catalog');
  require(APP + '/lib/store').init();
  const cf = require(APP + '/lib/codefind');
  const market = require(APP + '/lib/market');
  const extract = require(APP + '/lib/extract');
  // 1. our products, live: the MIL-TEC bag of the example first, then a few of every kind
  const ours = [];
  const seen = new Set();
  for (const t of TERMS) {
    let list = [];
    try { list = (await http.getJson(`${OUR}/wp-json/wc/store/v1/products?search=${encodeURIComponent(t)}&per_page=20`, { gap: 800, timeout: 30000 })).json || []; } catch (e) { console.error('our shop:', t, e.message); continue; }
    let n = 0;
    for (const raw of list) {
      const p = catalog.fromStoreApi(raw);
      if (seen.has(p.id) || p.type === 'variation') continue;
      if (t === 'assault molle' && p.sku !== '14002001') continue; // the example: ΣΑΚΙΔΙΟ MIL-TEC ASSAULT MOLLE OLIVE SMALL
      seen.add(p.id); ours.push(p); n++;
      if (n >= PER) break;
    }
  }
  console.log(`Προϊόντα του specialforces.gr: ${ours.length} (${ours.filter((p) => p.sku).length} με κωδικό, ${ours.filter((p) => p.brand).length} με μάρκα, ${ours.filter((p) => p.type === 'variable').length} με παραλλαγές, ${ours.filter((p) => (p.images || []).length < 3).length} με <3 φωτογραφίες)\n`);
  // 2. the «engine»: the public product search of real shops
  const shopsUp = new Set();
  const search = async (q) => {
    const out = [], engines = [];
    for (const host of SHOPS) {
      try {
        const r = await http.getJson(`https://${host}/wp-json/wc/store/v1/products?search=${encodeURIComponent(q.replace(/"/g, ''))}&per_page=8`, { gap: 1200, timeout: 25000, retries: 0 });
        const list = Array.isArray(r.json) ? r.json : [];
        list.forEach((p, i) => out.push({ url: p.permalink, title: extract.cleanHtml ? String(p.name || '') : '', rank: i, engine: host.split('.')[0] }));
        engines.push({ id: host.split('.')[0], state: 'ok', n: list.length }); shopsUp.add(host);
      } catch (e) { engines.push({ id: host.split('.')[0], state: 'error', error: String(e.message).slice(0, 80) }); }
    }
    out.engines = engines;
    return out;
  };
  const io = { own: new Set(['specialforces.gr', 'stratiotikaeidi.gr']), compHosts: new Set(SHOPS), supplierHosts: new Set(), parallel: 2,
    limits: { maxQueries: 4, pagesPerQuery: 6, perHost: 3, maxPages: 18, minQueries: 4, minShops: 3 },
    search, page: (url) => extract.fromUrl(url, { gap: 1200 }) };
  // 3. the research, product by product
  const M = { products: 0, queries: 0, engOk: 0, engFail: 0, results: 0, domains: new Set(), opened: 0, read: 0, exact: 0, family: 0, rejected: 0, reasons: {}, sku: [0, 0], ean: [0, 0], price: [0, 0], images: [0, 0], complete: 0, partial: 0, family_only: 0, none: 0, colourClash: 0, imgOtherColour: 0, rows: [] };
  for (const p of ours) {
    const needs = ['sku', 'ean', 'images', 'price'];
    const it = { k: 'sf:' + p.id, name: p.name, brand: p.brand || '', sku: p.sku || '', ean: p.ean || '', price: p.price, needs, mode: 'auto' };
    const t0 = Date.now();
    let r;
    try { r = await cf.lookUp(it, io); } catch (e) { console.log(`✗ ${p.name}: ${e.message}`); continue; }
    M.products++; M.queries += r.queries; M.results += r.sum.results; M.opened += r.sum.opened; M.read += r.sum.read; M.exact += r.hits.length; M.family += r.family.length; M.rejected += r.sum.rejected;
    for (const e of Object.values(r.sum.engines)) { M.engOk += e.ok; M.engFail += e.failed; }
    for (const [k, v] of Object.entries(r.sum.reasons || {})) M.reasons[k] = (M.reasons[k] || 0) + v;
    for (const d of r.trace.domains) M.domains.add(d.host);
    const st = r.status === 'complete' ? 'complete' : r.status === 'partial' ? 'partial' : r.status === 'family_only' ? 'family_only' : 'none';
    M[st]++;
    // what it gives (only «the same variant»)
    const agree = (vals) => { const c = new Map(); for (const v of vals) if (v) c.set(v, (c.get(v) || 0) + 1); return Math.max(0, ...c.values()); };
    const got = { sku: r.hits.some((h) => h.code), ean: r.hits.some((h) => market.gtinOf(h.ean)), price: r.hits.some((h) => h.price > 0 && h.avail === 'in'), images: r.hits.some((h) => (h.images || []).length) };
    for (const k of Object.keys(got)) { M[k][1]++; if (got[k]) M[k][0]++; }
    // the critical check: no hit of another colour, no photo whose file names another colour
    const ourC = market.coloursOf(p.name);
    for (const h of r.hits) {
      const hc = market.coloursOf(h.name);
      if (ourC.size && hc.size && [...ourC].some((c) => !hc.has(c)) && [...hc].some((c) => !ourC.has(c))) M.colourClash++;
      for (const u of h.images || []) { const fc = cf.fileColours(u); if (ourC.size && fc.size && ![...fc].some((c) => ourC.has(c) || (c === 'GREEN' && ourC.has('OLIVE')) || (c === 'OLIVE' && ourC.has('GREEN')))) M.imgOtherColour++; }
    }
    const row = { name: p.name, sku: p.sku, brand: p.brand, status: r.status, queries: r.queries, results: r.sum.results, opened: r.sum.opened, read: r.sum.read, shops: r.hits.map((h) => h.host), family: r.family.map((f) => f.host + ' ' + (f.colour || '')), sec: Math.round((Date.now() - t0) / 1000),
      hits: r.hits.map((h) => ({ host: h.host, url: h.url, name: h.name, code: h.code, ean: h.ean, price: h.price, avail: h.avail, images: h.images, imgHow: h.imgHow, how: h.how })) };
    M.rows.push(row);
    console.log(`${r.hits.length ? '✓' : '·'} ${p.name}${p.sku ? ' [' + p.sku + ']' : ''}: ${r.status} · ${r.queries} αναζητ. · ${r.sum.results} αποτελ. · ${r.sum.read}/${r.sum.opened} σελίδες · ίδιο: ${r.hits.map((h) => h.host).join(', ') || '—'} · άλλη παραλλαγή: ${r.family.length}`);
    if (p.sku === '14002001') {
      console.log('   ── το παράδειγμα MIL-TEC ──');
      for (const q of r.trace.queries) console.log(`   αναζήτηση «${q.q}» (${q.why}) → ${q.n} αποτελέσματα · ${(q.engines || []).map((e) => e.id + ':' + (e.state === 'ok' ? e.n : e.state)).join(' ')}`);
      for (const x of r.trace.pages) console.log(`   σελίδα ${x.outcome.padEnd(9)} ${x.url} — ${x.why}`);
      for (const h of r.hits) console.log(`   ΙΔΙΟ: ${h.host} · κωδ. ${h.code || '—'} · EAN ${h.ean || '—'} · ${h.price} € · ${h.avail} · φωτο ${(h.images || []).length} (${h.imgHow}) ${(h.images || [])[0] || ''}`);
      for (const f of r.family) console.log(`   ΑΛΛΗ ΠΑΡΑΛΛΑΓΗ: ${f.host} · ${f.name} · ${f.colour}`);
    }
  }
  const pct = (a) => (a[1] ? Math.round((100 * a[0]) / a[1]) + '%' : '—');
  console.log(`\n=== Σύνοψη (ζωντανά, ${new Date().toISOString().slice(0, 16)}) ===
Προϊόντα: ${M.products} · αναζητήσεις: ${M.queries} · απαντήσεις καταστημάτων ok/σφάλμα: ${M.engOk}/${M.engFail} · αποτελέσματα: ${M.results}
Μοναδικά domains: ${M.domains.size} · σελίδες άνοιξαν/διαβάστηκαν: ${M.opened}/${M.read}
Ίδια παραλλαγή: ${M.exact} · άλλη παραλλαγή (οικογένεια): ${M.family} · απορρίψεις: ${M.rejected} ${JSON.stringify(M.reasons)}
Βρέθηκε (σε ≥1 πηγή): κωδικός ${pct(M.sku)} · EAN ${pct(M.ean)} · τιμή διαθέσιμου ${pct(M.price)} · φωτογραφίες ${pct(M.images)}
Καταστάσεις: πλήρεις ${M.complete} · με ελλείψεις ${M.partial} · μόνο άλλη παραλλαγή ${M.family_only} · χωρίς αποτέλεσμα ${M.none}
Λάθος χρώμα σε αντιστοίχιση: ${M.colourClash} · φωτογραφίες με όνομα άλλου χρώματος: ${M.imgOtherColour}
Καταστήματα που απάντησαν: ${[...shopsUp].join(', ')}`);
  if (arg('--json')) fs.writeFileSync(arg('--json'), JSON.stringify(Object.assign({}, M, { domains: [...M.domains] }), null, 2));
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) { /* ignore */ }
})().catch((e) => { console.error(e); process.exit(1); });
