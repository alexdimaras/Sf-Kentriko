'use strict';
process.env.SFK_ALLOW_PRIVATE = '1';
// SF Κέντρο — the research of the internet, piece by piece and the whole way: the searches built for a product, the
// pages of the shops (several per shop, never one twice), what a page gives (codes, EAN, prices, stock, variants),
// «the same product» only with proof, what happened written down, the research done again field by field, the
// results that survive a computer switched off, and the cloud going on when every computer is off.
// Everything runs on this machine: little shops and search engines on 127.0.0.x (nothing goes to the internet).
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const APP = path.join(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sfk-research-'));
process.env.SFK_DATA = path.join(tmp, 'data');
process.env.APPDATA = path.join(tmp, 'cfg');
process.env.SFK_SEARCH_FAST = '1';
process.env.NO_PROXY = process.env.no_proxy = '127.0.0.1,127.0.0.2,127.0.0.3,127.0.0.4,localhost';
fs.mkdirSync(process.env.SFK_DATA, { recursive: true });

let fails = 0, passes = 0;
function ok(cond, name, detail) {
  if (cond) passes++; else fails++;
  console.log((cond ? '  ok   ' : '  FAIL ') + name + (cond || detail === undefined ? '' : ' — ' + detail));
}
const section = (t) => console.log('\n' + t);
const W = (n, v) => fs.writeFileSync(path.join(process.env.SFK_DATA, n + '.json'), JSON.stringify(v));
const gtin = (base) => { const d = String(base).padStart(12, '0').slice(0, 12); let s = 0; for (let i = 0; i < 12; i++) s += Number(d[11 - i]) * (i % 2 === 0 ? 3 : 1); return d + ((10 - (s % 10)) % 10); };
const now = new Date().toISOString();

// ---------- a product page as shops write it ----------
function page(o) {
  const offers = o.variants ? undefined : { '@type': 'Offer', price: o.price, priceCurrency: o.currency || 'EUR', ...(o.avail ? { availability: 'https://schema.org/' + o.avail } : {}) };
  const ld = o.variants
    ? { '@context': 'https://schema.org', '@type': 'ProductGroup', name: o.name, brand: { '@type': 'Brand', name: o.brand }, productGroupID: o.sku || 'G1', hasVariant: o.variants.map((v) => ({ '@type': 'Product', name: o.name + ' ' + v.color, color: v.color, sku: v.sku, gtin13: v.ean, offers: { '@type': 'Offer', price: v.price, priceCurrency: 'EUR', availability: 'https://schema.org/' + v.avail } })) }
    : { '@context': 'https://schema.org', '@type': 'Product', name: o.name, sku: o.sku, mpn: o.mpn, gtin13: o.ean, brand: o.brand ? { '@type': 'Brand', name: o.brand } : undefined, image: o.images || [], offers };
  const related = o.related ? `<script type="application/ld+json">${JSON.stringify({ '@type': 'ItemList', itemListElement: [{ '@type': 'ListItem', item: { '@type': 'Product', name: o.related, image: 'https://x/related-photo-123.jpg', offers: { price: 1 } } }] })}</script>` : '';
  return `<!doctype html><html><head><title>${o.name}</title><script type="application/ld+json">${JSON.stringify(ld)}</script>${related}</head><body><h1>${o.name}</h1></body></html>`;
}

(async () => {
  const store = require(APP + '/lib/store'); store.init();
  const cf = require(APP + '/lib/codefind');
  const extract = require(APP + '/lib/extract');
  const market = require(APP + '/lib/market');
  const sfind = require(APP + '/lib/supplierfind');

  section('Τα ερωτήματα: πολλά, από ό,τι ξέρουμε');
  const q1 = cf.queriesOf({ name: 'ΣΑΚΙΔΙΟ PENTAGON KYLER 36L ΜΑΥΡΟ', brand: 'PENTAGON', sku: 'K16110-01', ean: gtin('521234567890') });
  ok(q1[0] === 'PENTAGON K16110-01' && q1.includes(gtin('521234567890')) && q1.some((q) => /^PENTAGON KYLER 36L$/.test(q)), 'with brand + code + EAN: brand+code first, the EAN, brand + model', JSON.stringify(q1));
  ok(q1.includes('K16110-01') && q1.includes('K1611001') && q1.some((q) => /backpack/i.test(q)), 'the code alone, written without the dash, and the English name of the kind (backpack)', JSON.stringify(q1));
  ok(q1.length >= 6 && q1.length <= 12 && new Set(q1.map((q) => q.toUpperCase())).size === q1.length, 'six to twelve searches (the setting), none twice', String(q1.length));
  const plan = cf.planOf({ name: 'ΣΑΚΙΔΙΟ MIL-TEC ASSAULT MOLLE OLIVE SMALL', brand: 'MIL-TEC', sku: '14002001' }, 20);
  const whys = plan.map((x) => x.why);
  ok(plan[0].q === 'MIL-TEC 14002001' && plan.some((x) => x.why === 'exact' && /^"MIL-TEC ASSAULT MOLLE SMALL" olive$/.test(x.q)) && plan.some((x) => x.why === 'family' && /^"MIL-TEC ASSAULT MOLLE SMALL" backpack$/.test(x.q)) && whys.includes('english') && whys.includes('code-alone'),
    'the plan for the MIL-TEC bag: code, the exact model with its colour in quotes, the model without colour (family), English, the code alone', JSON.stringify(plan));
  const q2 = cf.queriesOf({ name: 'ΦΑΚΟΣ ΚΕΦΑΛΗΣ XTAR H3 WARBOY', brand: '', sku: '' });
  ok(q2.length >= 3 && q2.some((q) => q === 'XTAR H3 WARBOY') && q2.some((q) => /headlamp|flashlight/.test(q)), 'no brand and no code: the title, its Latin words, the model words with the English kind (still searched in earnest)', JSON.stringify(q2));
  const q3 = cf.queriesOf({ name: 'ΜΑΧΑΙΡΙ MORAKNIV ELDRIS', brand: 'MORAKNIV', sku: '', round: 1 });
  ok(q3[0] !== 'ΜΑΧΑΙΡΙ MORAKNIV ELDRIS' || q3.length > 1, 'a later round puts the other ways of writing it first', JSON.stringify(q3));
  ok(cf.queriesOf({ name: 'ΘΗΚΗ SAFARILAND 6360', brand: 'SAFARILAND', sku: '6360-832-411' })[0] === 'SAFARILAND 6360-832-411', 'brand + our code is still the first search');

  section('Ανάγνωση σελίδας: κωδικοί, EAN, τιμή, διαθεσιμότητα, παραλλαγές');
  const e1 = extract.fromHtml(page({ name: 'Pentagon Kyler 36L Backpack', brand: 'Pentagon', sku: 'K16110-01', mpn: 'K16110', ean: gtin('521234567890'), price: '79.90', avail: 'OutOfStock', related: 'Mil-Tec Assault Pack' }), 'https://a.example/kyler');
  extract.finish(e1);
  ok(e1.sku === 'K16110-01' && e1.mpn === 'K16110' && e1.code === 'K16110' && e1.ean === gtin('521234567890'), 'sku, maker code (mpn) and EAN kept apart (code = the maker\'s)', JSON.stringify([e1.sku, e1.mpn, e1.code, e1.ean]));
  ok(e1.availability === 'out' && e1.price === 79.9 && e1.isProduct, 'out of stock is read as out of stock');
  ok(e1.name === 'Pentagon Kyler 36L Backpack' && !e1.images.some((u) => /related/.test(u)), 'a «related products» list on the page is not the product (its photo and name are left out)');
  const e2 = extract.fromHtml(page({ name: 'Pentagon Kyler 36L', brand: 'Pentagon', price: '79.90' }), 'https://a.example/k'); extract.finish(e2);
  ok(e2.availability === 'unknown', 'a page that says nothing about stock: unknown (it used to count as «in stock»)');
  const e3 = extract.fromHtml(page({ name: 'Helikon Raccoon Mk2', brand: 'Helikon-Tex', sku: 'PL-RCN', variants: [
    { color: 'Black', sku: 'PL-RCN-CD-01', ean: gtin('590582000001'), price: 89.9, avail: 'InStock' },
    { color: 'Coyote', sku: 'PL-RCN-CD-11', ean: gtin('590582000011'), price: 84.9, avail: 'OutOfStock' },
    { color: 'Olive Green', sku: 'PL-RCN-CD-02', ean: gtin('590582000002'), price: 92.9, avail: 'InStock' }] }), 'https://b.example/raccoon');
  extract.finish(e3);
  ok(e3.variants.length === 3 && e3.variants[1].inStock === false && e3.variants[0].ean === gtin('590582000001'), 'each colour keeps its own code, EAN, price and stock', JSON.stringify(e3.variants.map((v) => [v.color, v.sku, v.price, v.inStock])));
  ok(e3.price === 89.9 && e3.availability === 'in', 'the product\'s price: the lowest IN STOCK (the cheaper colour is sold out)', String(e3.price));
  const vv = cf.variantView(e3, market.coloursOf('ΣΑΚΙΔΙΟ HELIKON-TEX RACCOON MK2 COYOTE'));
  ok(vv.price === 84.9 && vv.ean === gtin('590582000011') && vv.avail === 'out', 'for OUR colour (coyote): its price, its EAN, its stock — never another colour\'s', JSON.stringify(vv));
  const vb = cf.variantView(e3, market.coloursOf('ΣΑΚΙΔΙΟ HELIKON-TEX RACCOON MK2'));
  ok(vb.ean === '' && vb.priceKind === 'from' && vb.avail === 'in', 'no colour in our title: no EAN (each colour has its own), the price is «from»', JSON.stringify(vb));
  const woo = extract.fromHtml('<html><head><meta property="og:title" content="Γάντια Mechanix M-Pact"></head><body><div id="product-5" class="product type-product outofstock"><div class="summary"><p class="stock out-of-stock">Εξαντλημένο</p><span class="sku_wrapper">Κωδικός: <span class="sku">MPT-72</span></span><span itemprop="gtin13">' + gtin('781513624418') + '</span></div></div><meta property="product:price:amount" content="39.90"></body></html>', 'https://c.example/p');
  extract.finish(woo);
  ok(woo.sku === 'MPT-72' && woo.availability === 'out' && woo.ean === gtin('781513624418'), 'WooCommerce page without JSON-LD: the code, «εξαντλημένο» and the EAN of its microdata', JSON.stringify([woo.sku, woo.availability, woo.ean]));
  const bad = extract.fromHtml(page({ name: 'X', price: 1, ean: '5201234567891' }), 'https://x/'); extract.finish(bad);
  ok(bad.ean === '', 'an EAN with a wrong check digit is never kept');
  ok(extract.commonCode(['K16110-01-S', 'K16110-01-M', 'K16110-01-XL']) === 'K16110-01' && extract.commonCode(['AB1', 'CD2']) === '', 'the code of all the sizes = their common part, cut at a dash (or nothing)');
  ok(extract.availOf('https://schema.org/PreOrder') === 'unknown' && extract.availOf('InStock') === 'in' && extract.availOf('SoldOut') === 'out', 'pre-order / back-order is not «in stock»');
  // Shopify catalog: the first size's code is not the product's; every EAN of the variants kept
  const compcat = require(APP + '/lib/compcat');
  const sh = compcat.fromShopify({ id: 1, title: 'Kyler', vendor: 'Pentagon', handle: 'k', variants: [{ sku: 'K16110-01-S', barcode: gtin('521000000001'), price: '79.90', available: true }, { sku: 'K16110-01-M', barcode: gtin('521000000002'), price: '79.90', available: false }] }, 'https://s.example');
  ok(sh.s === 'K16110-01' && sh.g === '' && sh.gs.length === 2, 'Shopify catalog: code = common part, no single EAN for a product with one EAN per size, all of them kept', JSON.stringify(sh));
  const cmpF = market.features({ name: 'ΣΑΚΙΔΙΟ PENTAGON KYLER', brand: 'PENTAGON', sku: '' }, { ean: gtin('521000000002') });
  ok(market.compare(cmpF, { n: sh.n, b: sh.b, p: sh.p }, market.candFeatures(sh)).how === 'ean', 'our EAN = the EAN of one of their sizes → the same product');
  const wf = compcat.fromWoo({ id: 3, name: 'X', sku: 'A1', prices: { price: '1000', currency_minor_unit: 2 }, is_in_stock: true, global_unique_id: gtin('400638133393'), attributes: [] });
  const wf2 = compcat.fromWoo({ id: 4, name: 'Y', prices: { price: '1000', currency_minor_unit: 2 }, is_in_stock: true, attributes: [{ name: 'EAN', terms: [{ name: gtin('400638133394') }] }] });
  const wf3 = compcat.fromWoo({ id: 5, name: 'Z', prices: { price: '1000', currency_minor_unit: 2 }, is_in_stock: true, global_unique_id: '1234567890123' });
  ok(wf.g === gtin('400638133393') && wf2.g === gtin('400638133394') && !wf3.g, 'WooCommerce catalog: the EAN from its GTIN field or an «EAN» attribute; a wrong one never', JSON.stringify([wf.g, wf2.g, wf3.g]));
  const sm = require(APP + '/lib/sitemapcat').productOf(page({ name: 'Nitecore MH40', brand: 'Nitecore', price: '99' }), 'https://m.example/mh40');
  ok(sm && sm.st === null, 'a site-map shop page that does not say its stock: unknown (null), not «in stock»', JSON.stringify(sm && sm.st));

  section('Η έρευνα ενός προϊόντος');
  const PAGES = {};
  const add = (url, o) => { PAGES[url] = Object.assign({ url }, o); };
  // shop A: first result is ANOTHER colour (camo), the second the right one → a shop is not lost because of its first page
  add('https://shop-a.gr/kyler-multicam', { name: 'Pentagon Kyler 36L Multicam', brand: 'Pentagon', sku: 'K16110-56', price: 85, availability: 'in', images: ['https://shop-a.gr/i/k56.jpg'], isProduct: true });
  add('https://shop-a.gr/kyler-black', { name: 'Pentagon Kyler 36L Black', brand: 'Pentagon', sku: 'K16110-01', price: 79.9, currency: 'EUR', availability: 'in', images: ['https://shop-a.gr/i/k16110-01-a.jpg', 'https://shop-a.gr/i/k16110-01-b.jpg'], isProduct: true });
  // shop B: the first page does not open at all, the second is right
  add('https://shop-b.gr/broken', { fail: true });
  add('https://shop-b.gr/p/kyler-36', { name: 'ΣΑΚΙΔΙΟ PENTAGON KYLER 36L ΜΑΥΡΟ', brand: 'PENTAGON', sku: 'K16110-01', ean: gtin('521234567890'), price: 82, availability: 'out', images: ['https://shop-b.gr/img/k16110-01-a.jpg'], isProduct: true });
  // shop C: the PRO version (another model) only
  add('https://shop-c.gr/kyler-pro', { name: 'Pentagon Kyler PRO 36L Black', brand: 'Pentagon', sku: 'K16120-01', price: 120, availability: 'in', images: [], isProduct: true });
  // shop D: same product, price in dollars
  add('https://shop-d.com/kyler', { name: 'Pentagon Kyler 36L Backpack Black', brand: 'Pentagon', sku: 'K16110-01', price: 75, currency: 'USD', availability: 'in', images: [], isProduct: true });
  // shop E: same words, ANOTHER EAN (a real one): not the same
  add('https://shop-e.gr/kyler', { name: 'ΣΑΚΙΔΙΟ PENTAGON KYLER 36L ΜΑΥΡΟ', brand: 'PENTAGON', sku: '', ean: gtin('521999999990'), price: 70, availability: 'in', images: [], isProduct: true });
  let reads = [];
  const searches = [];
  const RESULTS = {
    'PENTAGON K16110-01': ['https://shop-a.gr/kyler-multicam', 'https://shop-b.gr/broken', 'https://shop-c.gr/kyler-pro', 'https://www.skroutz.gr/s/1', 'https://shop.example/our-own'],
    default: ['https://shop-a.gr/kyler-multicam?utm_source=x', 'https://www.skroutz.gr/s/9', 'https://shop-b.gr/broken', 'https://shop-c.gr/kyler-pro', 'https://shop-a.gr/kyler-black', 'https://shop-b.gr/p/kyler-36', 'https://shop-d.com/kyler', 'https://shop-e.gr/kyler', 'https://shop-a.gr/search?q=kyler'],
  };
  const io = (opts) => Object.assign({
    own: new Set(['shop.example']),
    search: async (q) => { searches.push(q); const r = (RESULTS[q] || RESULTS.default).map((url) => ({ url })); r.engines = [{ id: 'ddg', state: 'ok', n: r.length }, { id: 'bing', state: 'error', error: 'timeout' }]; return r; },
    page: async (url) => { reads.push(url); const p = PAGES[url.replace(/\?.*$/, '')]; if (!p) throw new Error('404'); if (p.fail) throw new Error('Η σελίδα δεν απάντησε (503)'); return p; },
  }, opts || {});
  const it = { k: 'sf:1', name: 'ΣΑΚΙΔΙΟ PENTAGON KYLER 36L ΜΑΥΡΟ', brand: 'PENTAGON', sku: '', ean: '', price: 79.9, needs: ['sku', 'images', 'price'] };
  const r = await cf.lookUp(it, io());
  const hosts = r.hits.map((h) => h.host).sort();
  ok(hosts.includes('shop-a.gr'), 'shop A found although its first page was another colour (a second page of the same shop is read)', JSON.stringify(hosts));
  ok(hosts.includes('shop-b.gr'), 'shop B found although its first page did not open', JSON.stringify(hosts));
  ok(!hosts.includes('shop-c.gr'), 'another model (PRO) is left out', JSON.stringify(hosts));
  ok(reads.filter((u) => /kyler-multicam/.test(u)).length === 1 && !reads.some((u) => /skroutz|shop\.example|search\?q/.test(u)), 'the same page from two searches is read once; marketplaces, our own site and search pages never', JSON.stringify(reads));
  const ha = r.hits.find((h) => h.host === 'shop-a.gr'), hb = r.hits.find((h) => h.host === 'shop-b.gr'), hd = r.hits.find((h) => h.host === 'shop-d.com');
  ok(ha && ha.avail === 'in' && ha.price === 79.9 && hb && hb.avail === 'out', 'each hit says in stock / out of stock as its page does');
  ok(!hd || hd.price === 0, 'a price in dollars is never taken as a price', JSON.stringify(hd));
  ok(r.status === 'complete' && r.needsLeft.length === 0, 'the code is given by two shops, photos by two, a price in stock: «complete»', JSON.stringify([r.status, r.needsLeft]));
  const pg = r.trace.pages;
  ok(pg.some((x) => x.outcome === 'error' && /503/.test(x.why)) && pg.some((x) => x.outcome === 'family' && /MULTICAM/.test(x.why)) && pg.some((x) => x.outcome === 'similar' || x.outcome === 'other') && pg.some((x) => x.outcome === 'same'), 'what happened to each page is written: did not open, the same model in another colour (family), other product (why), the same', JSON.stringify(pg.map((x) => x.outcome)));
  ok(r.trace.results.some((x) => x.cls === 'marketplace' && x.open === 'marketplace') && r.trace.results.some((x) => x.open === 'όχι σελίδα προϊόντος') && r.trace.results.every((x) => x.url && x.host && x.cls), 'every search result is written (address, site, kind of site, opened or why not): marketplaces and search pages too', JSON.stringify(r.trace.results.map((x) => [x.host, x.cls, x.open])));
  ok(r.family.some((x) => x.host === 'shop-a.gr' && /MULTICAM/.test(x.colour)) && !r.hits.some((h) => /multicam/.test(h.url)), 'the multicam page is kept as «another variant of the model», never as ours');
  ok(r.trace.queries.length >= 1 && r.trace.queries.length < 8 && r.trace.queries[0].engines.some((e) => e.state === 'error') && r.sum.engines.bing.failed >= 1, 'the searches and what each engine did (Bing failed, DuckDuckGo answered); it stopped as soon as all it missed was found', JSON.stringify(r.sum.engines));

  // our EAN: the surest proof, whatever the titles
  reads = [];
  const rE = await cf.lookUp(Object.assign({}, it, { k: 'sf:2', ean: gtin('521234567890'), needs: ['sku'] }), io());
  ok(rE.hits.some((h) => h.host === 'shop-b.gr' && h.how === 'ean') && !rE.hits.some((h) => h.host === 'shop-e.gr'), 'our EAN on their page → the same product (how: EAN); the page with another EAN → not', JSON.stringify(rE.hits.map((h) => [h.host, h.how])));

  // the engines fail / pause
  const failing = await cf.lookUp(Object.assign({}, it, { k: 'sf:3' }), io({ search: async () => { throw new Error('timeout'); } }));
  ok(failing.status === 'search_failed' && failing.hits.length === 0, 'no engine answers → «search failed» (not «not found»)', failing.status);
  let thrown = null;
  try { await cf.lookUp(Object.assign({}, it, { k: 'sf:4' }), io({ search: async () => { throw new sfind.Blocked('all'); } })); } catch (e) { thrown = e; }
  ok(thrown instanceof sfind.Blocked, 'the engines ask for a pause at the first search → the job waits and asks again (nothing is written)');
  let n = 0;
  const half = await cf.lookUp(Object.assign({}, it, { k: 'sf:5', needs: ['ean'] }), io({ search: async (q) => { if (n++ >= 1) throw new sfind.Blocked('all'); return RESULTS.default.map((url) => ({ url })); } }));
  ok(half.status === 'blocked' && half.hits.length >= 1, 'a pause in the middle → what was found is kept, the status says «blocked» (done again soon)', JSON.stringify([half.status, half.hits.length]));
  const deadPages = await cf.lookUp(Object.assign({}, it, { k: 'sf:6' }), io({ page: async () => { throw new Error('ECONNRESET'); } }));
  ok(deadPages.status === 'pages_failed', 'no page opens → «pages failed»', deadPages.status);
  const none = await cf.lookUp(Object.assign({}, it, { k: 'sf:7', name: 'ΣΑΚΙΔΙΟ PENTAGON EPSILON 20L', sku: '' }), io());
  ok(none.status === 'not_found' && none.read > 0 && none.trace.pages.every((x) => x.outcome !== 'same'), 'pages read, none the same product → «not found», with the reasons', none.status);
  const empty = await cf.lookUp(Object.assign({}, it, { k: 'sf:8' }), io({ search: async () => [] }));
  ok(empty.status === 'no_results', 'the searches gave no shop page → «no results»', empty.status);
  const stopped = await cf.lookUp(Object.assign({}, it, { k: 'sf:9' }), io({ cancelled: () => true }));
  ok(stopped.status === 'cancelled', 'stopped → «cancelled» (never «nothing found»)');

  // the same product under very different titles; another colour; another version with the same base code
  const P2 = {
    'https://en.example/p': { name: 'Helikon-Tex Raccoon Mk2 Backpack 20L Coyote', brand: 'Helikon-Tex', sku: 'PL-RCN-CD-11', price: 89, currency: 'EUR', availability: 'in', images: ['https://en.example/1.jpg'], isProduct: true },
    'https://gr.example/p': { name: 'ΣΑΚΙΔΙΟ RACCOON MK2 20 ΛΙΤΡΑ HELIKON COYOTE', brand: '', sku: 'PL-RCN-CD-11', price: 91, availability: 'in', images: [], isProduct: true },
    'https://col.example/p': { name: 'Helikon-Tex Raccoon Mk2 Backpack 20L Olive Green', brand: 'Helikon-Tex', sku: 'PL-RCN-CD-02', price: 89, availability: 'in', images: [], isProduct: true },
    'https://ver.example/p': { name: 'Helikon-Tex Raccoon Mk2 PRO Backpack 20L Coyote', brand: 'Helikon-Tex', sku: 'PL-RCN-CD-11P', price: 129, availability: 'in', images: [], isProduct: true },
    'https://urb.example/p': { name: 'Haix Urban Line Boots Khaki', brand: 'Haix', sku: '', price: 150, availability: 'in', images: [], isProduct: true },
  };
  const io2 = { own: new Set(), search: async () => Object.keys(P2).map((url) => ({ url })), page: async (url) => Object.assign({ url }, P2[url]) };
  const rt = await cf.lookUp({ k: 'sf:20', name: 'ΣΑΚΙΔΙΟ HELIKON-TEX RACCOON MK2 20L COYOTE', brand: 'HELIKON-TEX', sku: 'PL-RCN-CD-11', price: 89.9, needs: ['ean', 'images'] }, io2);
  const th = rt.hits.map((h) => h.host).sort();
  ok(th.join() === 'en.example,gr.example', 'the same product in English and in Greek (other words, no brand field) is found on both; another colour and the PRO version are not', JSON.stringify(th));
  ok(rt.trace.pages.some((x) => x.outcome === 'family' && /OLIVE/.test(x.why)) && rt.trace.pages.some((x) => /PRO/.test(x.why) && /έκδοση/.test(x.why)), 'and the reasons are written (the olive one: same family, another variant · the PRO: another version)', JSON.stringify(rt.trace.pages.map((x) => x.why)));
  const ru = await cf.lookUp({ k: 'sf:21', name: 'ΑΡΒΥΛΑ HAIX URBAN LINE ΜΑΥΡΟ', brand: 'HAIX', sku: '', price: 150, needs: ['sku'] }, io2);
  ok(!ru.hits.some((h) => h.host === 'urb.example'), '«URBAN» of a model name is not a colour that makes black = khaki');

  section('Αποθήκευση και επανάληψη ανά πεδίο');
  W('catalog-sf', { syncedAt: now, source: 'api', products: [
    { id: 1, type: 'simple', name: it.name, brand: 'PENTAGON', sku: '', price: 79.9, inStock: true, images: ['https://our/1.jpg'], status: 'publish', attrs: [], cats: [], catNames: [], variations: [] },
    { id: 2, type: 'simple', name: 'ΦΑΚΟΣ NITECORE MH40', brand: 'NITECORE', sku: 'MH40', price: 99, inStock: true, images: ['a', 'b'], status: 'publish', attrs: [], cats: [], catNames: [], variations: [] },
  ], categories: [] });
  W('catalog-st', { syncedAt: now, source: 'api', products: [], categories: [] });
  store.forget('catalog-sf'); store.forget('catalog-st');
  require(APP + '/lib/catalog').invalidate && require(APP + '/lib/catalog').invalidate();
  cf.save({ 'sf:1': r });
  let e = store.read('web-codes').products['sf:1'];
  ok(e.status === 'complete' && e.okAt && e.hits.length >= 2 && e.runAt, 'kept: status, last successful research, the hits');
  ok(!cf.candidates().some((x) => x.k === 'sf:1'), 'everything it missed is found (by two shops) → not searched again', JSON.stringify(cf.candidates().map((x) => [x.k, x.needs])));
  const tr = cf.traceFor('sf:1');
  ok(tr && tr.queries.length >= 1 && tr.pages.length >= 4 && tr.nextAt, 'the detail of the research can be shown for the product (searches, pages, next time)');
  // a failed research changes nothing that was found
  cf.save({ 'sf:1': failing });
  e = store.read('web-codes').products['sf:1'];
  ok(e.status === 'search_failed' && e.hits.length >= 2 && e.okAt && e.fails === 1, 'a failed research keeps what was found before, and its last success', JSON.stringify([e.status, e.hits.length, e.fails]));
  const due = cf.dueAt(e) - Date.now();
  ok(due > 0 && due <= 6 * 36e5 + 1000, 'after a failure it is due again within hours (6 h), not three weeks', String(Math.round(due / 36e5)) + ' h');
  // only one shop gives the code → the code is still searched for
  const one = Object.assign({}, r, { hits: r.hits.filter((h) => h.host === 'shop-a.gr'), trace: Object.assign({}, r.trace, { at: new Date(Date.now() + 1000).toISOString(), pages: [] }) });
  W('web-codes', {}); store.forget('web-codes');
  cf.save({ 'sf:1': Object.assign(one, { status: 'partial', needsLeft: ['sku'] }) });
  e = store.read('web-codes').products['sf:1'];
  ok(JSON.stringify(cf.openNeeds(['sku', 'images', 'price'], e.hits)) === '["sku","images","price"]', 'a code from one shop only, one photo source, one price: all three still searched for', JSON.stringify(cf.openNeeds(['sku', 'images', 'price'], e.hits)));
  ok(cf.dueAt(e) - Date.now() > 9 * 864e5 && cf.dueAt(e) - Date.now() <= 10 * 864e5 + 1000, 'something found, something missing → again in 10 days (with other searches first)');
  // the same research handed in twice (a part, then the whole) is counted once
  const roundsBefore = e.rounds;
  cf.save({ 'sf:1': Object.assign(one, { status: 'partial', needsLeft: ['sku'] }) });
  ok(store.read('web-codes').products['sf:1'].rounds === roundsBefore, 'handed in twice → counted once');
  // the prices get old
  const old = JSON.parse(JSON.stringify(r.hits)).map((h) => Object.assign(h, { at: new Date(Date.now() - 20 * 864e5).toISOString() }));
  ok(cf.openNeeds(['price'], old).includes('price') && !cf.openNeeds(['price'], r.hits).includes('price'), 'a price found 20 days ago is looked up again; one of today is not');
  // nothing found → later and later
  const nf = { status: 'not_found', at: now, empties: 1 }, nf3 = { status: 'not_found', at: now, empties: 3 };
  ok(Math.round((cf.dueAt(nf) - Date.now()) / 864e5) === 7 && Math.round((cf.dueAt(nf3) - Date.now()) / 864e5) === 30, 'not found anywhere: again in 7 days, then 14, then 30');
  // a research result without availability (an older computer): never «in stock»
  W('market', {}); store.forget('market');
  // a shop of the internet that is not ours to trust yet: shown as «new shop», counted after a yes for the shop
  market.mergeWeb({ 'sf:1': [{ host: 'b.gr', url: 'https://b.gr/1', name: it.name, price: 71, avail: 'in', how: 'words', at: now }] });
  ok(market.results()['sf:1'].competitors[0].flag === 'newshop' && market.results()['sf:1'].stats.count === 0, 'a price from a new shop of the internet does not count before the shop is approved');
  for (const h of ['a.gr', 'b.gr', 'c.gr', 'd.gr']) cf.decideShop(h, 'approve');
  market.mergeWeb({ 'sf:1': [{ host: 'a.gr', url: 'https://a.gr/1', name: it.name, price: 70, how: 'words' }, { host: 'b.gr', url: 'https://b.gr/1', name: it.name, price: 71, avail: 'in', how: 'words', at: now }, { host: 'c.gr', url: 'https://c.gr/1', name: it.name, price: 69, avail: 'out', how: 'words', at: now }, { host: 'd.gr', url: 'https://d.gr/1', name: it.name, price: 72, avail: 'in', currency: 'USD', how: 'words', at: now }] });
  const mk = market.results()['sf:1'];
  const fl = Object.fromEntries(mk.competitors.map((c) => [c.shop, c.flag]));
  ok(fl['a.gr'] === 'unknown' && fl['b.gr'] === 'used' && fl['c.gr'] === 'out' && !fl['d.gr'] && mk.stats.count === 1, 'internet prices: unknown stock → shown, not counted; out of stock → not counted; another currency → left out', JSON.stringify(fl));
  ok(mk.action === 'nodata' || mk.action === 'hold' || mk.action === 'watch', 'one shop in stock is never enough for a change of price (minShops)', mk.action);
  const oldWeb = market.stats([{ shop: 'x', price: 50, match: 'exact', inStock: true, web: true, seenAt: now, country: 'GR' }], {});
  ok(oldWeb.count === 0 && oldWeb.unknownStock === 1, 'an internet price kept from before (no stock word) does not count either');

  section('Υπολογιστής που σβήνει στη μέση: τίποτα δεν χάνεται');
  const coord = require(APP + '/lib/coord');
  // the same with the database (as with Supabase) when COORD_PG=postgres://… is given
  let B;
  if (process.env.COORD_PG) { const db = require(APP + '/lib/db'); const pool = await db.connect(process.env.COORD_PG); await db.reset(pool); B = db.coordBackend(pool); } else B = require(APP + '/lib/coord-store').fileBackend();
  coord.use(B);
  require(APP + '/lib/jobtypes').register();
  const pr = await coord.newPairing('t');
  const w = await coord.pair(pr.code, 'PC', { cpus: 4, ramMB: 8000, types: ['codes.web'], slots: 2 });
  const items = [{ k: 'sf:1', name: it.name, brand: 'PENTAGON' }, { k: 'sf:2', name: 'ΦΑΚΟΣ NITECORE MH40', brand: 'NITECORE' }, { k: 'sf:3', name: 'X' }];
  const job = await coord.enqueue('codes.web', { items, own: [] }, {});
  const [c1] = await coord.claim(w.id, 1);
  const partHit = Object.assign({}, r.hits[0], { at: now });
  const beat1 = await coord.heartbeat(w.id, c1.id, { done: 1, total: 3 }, [], { results: { 'sf:1': { hits: [partHit], read: 1, status: 'partial', needsLeft: ['sku'], trace: { at: 'T1', queries: [], pages: [] } } } });
  ok(beat1.took === 1 && store.read('web-codes').products['sf:1'].hits.some((h) => h.url === partHit.url), 'what a computer found is taken in with its «still working», before the job ends');
  // the computer goes off: the lease ends, the job comes back — without the product already handed in
  const lj = await coord.rawJob(c1.id);
  lj.leaseUntil = Date.now() - 1; await B.save(lj);
  await coord.sweep();
  const again = await coord.rawJob(c1.id);
  again.notBefore = 0; await B.save(again);
  const [c2] = await coord.claim(w.id, 1);
  ok(c2 && c2.id === job.id && c2.attempt === 2 && c2.payload.items.map((x) => x.k).join() === 'sf:2,sf:3', 'the second attempt does only the products not handed in', JSON.stringify(c2 && c2.payload.items.map((x) => x.k)));
  const done = await coord.complete(w.id, c2.id, 'idem-1', { results: { 'sf:1': { hits: [], read: 0, status: 'not_found', trace: { at: 'T2' } }, 'sf:2': { hits: [], read: 2, status: 'not_found', trace: { at: 'T3', queries: [], pages: [] } } } });
  ok(done.ok && store.read('web-codes').products['sf:1'].hits.length === 1 && store.read('web-codes').products['sf:2'].status === 'not_found', 'the end: the new products written, the one handed in before not overwritten');

  section('Όλοι οι υπολογιστές κλειστοί: το cloud συνεχίζει');
  // a little internet: a search engine and two shops on 127.0.0.x
  const shop = http.createServer((req, res) => {
    const host = req.headers.host.split(':')[0];
    const u = new URL(req.url, 'http://' + req.headers.host);
    if (u.pathname === '/ddg') {
      const port = srv.address().port;
      const links = ['127.0.0.2', '127.0.0.3'].map((h) => `<div class="result results_links"><a class="result__a" href="http://${h}:${port}/p/mh40">Nitecore MH40</a><a class="result__snippet">x</a></div>`).join('');
      res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end(`<html><body>${links}</body></html>`);
    }
    if (u.pathname === '/bing') { res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end('<html><body><ol id="b_results"></ol></body></html>'); }
    if (u.pathname === '/p/mh40') { res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end(page({ name: 'Nitecore MH40 Flashlight', brand: 'Nitecore', sku: 'MH40', price: host === '127.0.0.2' ? '95' : '97', avail: 'InStock', images: [`http://${host}/i/mh40-1.jpg`] })); }
    res.writeHead(404); res.end();
  });
  const srv = shop;
  await new Promise((x) => shop.listen(0, '0.0.0.0', x));
  const base = 'http://127.0.0.1:' + shop.address().port;
  process.env.SFK_SEARCH_DDG = base + '/ddg'; process.env.SFK_SEARCH_BING = base + '/bing'; process.env.SFK_SEARCH_YAHOO = base + '/bing';
  W('web-codes', {}); store.forget('web-codes');
  // the computer was last seen long ago (offline)
  const wo = await coord.workersView();
  const back = B;
  for (const x of await back.workers()) { x.lastSeen = new Date(Date.now() - 3600e3).toISOString(); x.online = false; await back.saveWorker(x); }
  void wo;
  const cj = await coord.enqueue('codes.web', { items: [{ k: 'sf:2', name: 'ΦΑΚΟΣ NITECORE MH40', brand: 'NITECORE', sku: 'MH40', price: 99, needs: ['price'] }], own: [] }, { auto: true });
  const took = await coord.cloudTick({});
  const cv = await coord.job(cj.id);
  const e2w = store.read('web-codes').products['sf:2'];
  ok(took && cv.status === 'completed' && cv.worker === 'cloud', 'no computer for a while → the cloud does the internet research itself', JSON.stringify([took, cv.status, cv.worker, cv.error]));
  ok(e2w && e2w.hits.length === 2 && e2w.hits.every((h) => h.avail === 'in' && h.price > 0) && e2w.status === 'complete', 'and finds the product at both shops, with prices in stock', JSON.stringify(e2w && [e2w.status, e2w.hits.map((h) => [h.host, h.price, h.avail])]));
  // a job of the cloud cut by a restart goes back to the queue at once
  const rj = await coord.enqueue('codes.web', { items: [{ k: 'sf:1', name: 'x' }], own: [] }, {});
  const raw = await coord.rawJob(rj.id);
  Object.assign(raw, { status: 'running', workerId: 'cloud', workerName: 'cloud', attempts: 1, leaseUntil: Date.now() + 3600e3 });
  await back.save(raw);
  const rec = await coord.recoverCloud();
  ok(rec === 1 && (await coord.rawJob(rj.id)).status === 'queued', 'after a restart the cloud\'s unfinished job is back in the queue at once (not after an hour)');
  // work queued by the program that nobody took for days ends (it is queued anew when still needed)
  const ex = await coord.enqueue('codes.web', { items: [{ k: 'sf:1', name: 'x' }], own: [] }, { auto: true });
  const exr = await coord.rawJob(ex.id); exr.createdAt = new Date(Date.now() - 4 * 864e5).toISOString(); await back.save(exr);
  await coord.sweep();
  ok((await coord.rawJob(ex.id)).status === 'cancelled', 'a group nobody could take for 3 days ends, with the reason');
  shop.close();

  console.log(`\n${passes} ok, ${fails} failed`);
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) { /* ignore */ }
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
