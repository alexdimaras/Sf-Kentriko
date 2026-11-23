'use strict';
// SF Κέντρο — the research of the internet for one of our products: codes (SKU / maker's code), EAN, photos, brand,
// prices — from ANY shop of the internet, not only the competitors on our list.
//
//  1. A PLAN of searches from what we know: brand + code, the EAN, the exact model with its colour (in quotes), the
//     whole title, brand + model words, the model WITHOUT colour (to find the family), the code alone and without dashes,
//     the maker's code, the English kind and colour, the Latin words, a product without a brand by its model words —
//     and, when the AI of a computer is on, a few searches it proposes. Sent to every search provider that answers
//     (DuckDuckGo / Bing / Yahoo, and the optional APIs: SearXNG / Brave / Google Programmable Search). The pages the
//     competitors' catalogs already showed for this product are read too (provider «catalog»).
//  2. Every result is written down (address, site, engine, place) and every site is classed: competitor, new shop,
//     maker, supplier, marketplace, unrelated. Up to `perHost` pages of a site are read (other colours of a model often
//     have their own pages); never the same address twice.
//  3. FAMILY and VARIANT are two different answers: the same model in another colour is «the same family, another
//     variant» — kept (it tells what the model is and which variants exist), but never its code, EAN, photos or price
//     for ours. Only «the same variant» (the same EAN / the same whole code / brand + model + OUR colour) gives values.
//  4. Photos only of OUR variant: the variant's own photos (schema.org variants, WooCommerce / Shopify variations), or a
//     one-colour page in our colour; a page with several colours whose photos cannot be told apart gives none.
//  5. The research goes on until the plan's first searches are done AND what is missing is confirmed by `minShops` shops
//     (auto), or to the end of the plan («full», the button «Πλήρης έρευνα Internet») — always within the limits of the
//     settings (searches, pages per search, pages per site, pages in all).
// What happened is kept per product (every search, every result, every page and why), a failed or cut research is
// never taken for a finished one, and nothing found is lost when a research is stopped.
const store = require('./store');
const U = require('./util');

const KEY = 'web-codes';          // { products: { 'site:id': { at, okAt, status, hits, family, sum, … } }, shops: { host: {...} } }
const TRACE_KEY = 'web-trace';    // (older: one file) the detail of the researches is kept in shards: web-trace-NN
const TRACE_SHARDS = 32, TRACE_PER_SHARD = 20; // the detail of the last ~640 products researched
const DECISIONS = 'web-shop-decisions'; // { approved: [host], rejected: [host] } — a person's word about new shops
const AGAIN_DAYS = 21;            // (old entries without a status: as before)
const HIT_DAYS = 120;             // a shop page that showed the product counts for four months, unless read again and changed
const PRICE_DAYS = 14;            // a price from the internet is looked up again after two weeks
const STALE_DAYS = 60;            // a research older than this is «old»
const FAILED = new Set(['blocked', 'search_failed', 'pages_failed', 'cancelled', 'error']);
const SUCCESS = new Set(['complete', 'partial', 'not_found', 'no_results', 'family_only']);
const WEIGHT = { sku: 5, price: 4, ean: 3, images: 2, brand: 1 };
const DEFAULT_LIMITS = { maxQueries: 12, pagesPerQuery: 8, perHost: 4, maxPages: 60, minQueries: 4, minShops: 4, fullQueries: 20, fullPages: 120, minImages: 3 };

function data() { const d = store.read(KEY, null) || {}; d.products = d.products || {}; d.shops = d.shops || {}; return d; }
function hostOf(u) { try { return new URL(u).hostname.replace(/^www\./, '').toLowerCase(); } catch (_) { return ''; } }
const gtin = (v) => require('./market').gtinOf(v);
const days = (iso) => (iso ? (Date.now() - new Date(iso).getTime()) / 864e5 : Infinity);
function limits() { try { return Object.assign({}, DEFAULT_LIMITS, require('./settings').all().webResearch || {}); } catch (_) { return Object.assign({}, DEFAULT_LIMITS); } }

/** What a product misses that the internet can give (photos: fewer than `minImages`, not only none). */
function needsOf(p, mk, lim) {
  const L = lim || limits();
  const n = [];
  if (!String(p.sku || '').trim()) n.push('sku');
  // no price from any shop yet (the competitors' catalogs did not have it): the internet may
  if (mk && !(mk.stats && mk.stats.count)) n.push('price');
  if ((p.images || []).length < (L.minImages || 3)) n.push('images');
  if (!p.brand) n.push('brand');
  if (p.type === 'simple' && !p.ean) n.push('ean');
  return n;
}
const ORDER = { sku: 0, price: 1, images: 2, brand: 3, ean: 4 };

/**
 * Of what a product misses, what the research has NOT covered yet (field by field): a code given by one shop only is
 * looked for again (a second shop makes it sure); one photo source → more; a product found without a price → its
 * price; a price gets old after two weeks. Only «the same variant» counts here (never a family page).
 */
function openNeeds(needs, hits) {
  const hs = (hits || []).filter((h) => h && h.host);
  const agree = (vals) => { const c = new Map(); for (const v of vals) if (v) c.set(v, (c.get(v) || 0) + 1); return Math.max(0, ...c.values()); };
  const left = [];
  for (const n of needs) {
    if (n === 'sku' && agree(hs.map((h) => U.normSku(h.code || h.sku || ''))) >= 2) continue;
    if (n === 'ean' && agree(hs.map((h) => gtin(h.ean))) >= 2) continue;
    if (n === 'brand' && (agree(hs.map((h) => U.foldKey(h.brand || ''))) >= 2 || hs.some((h) => h.brand && (h.how === 'code' || h.how === 'ean')))) continue;
    if (n === 'images') { const withImg = hs.filter((h) => (h.images || []).length); const all = new Set(withImg.flatMap((h) => h.images).map((u) => String(u).split('?')[0].split('/').pop())); if (withImg.length >= 2 && all.size >= 2) continue; }
    if (n === 'price' && hs.filter((h) => h.price > 0 && (h.avail === 'in' || (h.avail == null && h.inStock === true)) && days(h.at) <= PRICE_DAYS).length >= 2) continue;
    left.push(n);
  }
  return left;
}

/** When a product is due again: soon after a failure, later after «nothing anywhere», in between for what is missing. */
function dueAt(prev) {
  if (!prev) return 0;
  const at = new Date(prev.at || 0).getTime();
  if (!prev.status) {
    const again = (prev.hits || []).some((h) => h.price > 0) ? 14 : (prev.hits || []).length ? 60 : AGAIN_DAYS;
    return at + again * 864e5;
  }
  if (FAILED.has(prev.status)) return at + Math.min(3 * 864e5, 6 * 36e5 * Math.pow(2, Math.max(0, (prev.fails || 1) - 1)));
  if (prev.status === 'not_found' || prev.status === 'no_results' || prev.status === 'family_only') return at + [7, 14, 30][Math.min(2, Math.max(0, (prev.empties || 1) - 1))] * 864e5;
  return at + 10 * 864e5; // something found, something still missing
}

/** The pages of the competitors' catalogs that the price research found for a product (read like search results). */
function knownPages(key) {
  const e = require('./market').results()[key];
  return e ? (e.competitors || []).filter((c) => c.url && !c.web && !c.manual && ['exact', 'family', 'similar'].includes(c.match)).slice(0, 10).map((c) => ({ url: c.url, shop: c.shop, match: c.match })) : [];
}
function itemOf(site, p, prev, needs) {
  const k = site + ':' + p.id;
  return { k, name: p.name, brand: p.brand || '', sku: p.sku || '', ean: p.ean || '', price: p.price || 0, inStock: p.inStock !== false, needs, round: (prev && prev.rounds) || 0, known: knownPages(k), aiQueries: (prev && prev.aiq && days(prev.aiq.at) < 60 ? prev.aiq.list : []) || [] };
}

/** The products to look up, those with the most important gaps first (code, price, EAN, photos, brand; in stock; dearer). */
function candidates(limit) {
  const catalog = require('./catalog');
  const L = catalog.links();
  const d = data();
  const now = Date.now();
  const out = [];
  const mk = require('./market').results();
  const lim = limits();
  for (const site of catalog.SITES) {
    for (const p of catalog.load(site).products) {
      if (p.type === 'variation' || p.status === 'draft' || p.status === 'private') continue;
      if (site === 'st' && L.stToSf.has(p.id)) continue; // the same product on SpecialForces is looked up once
      const needs = needsOf(p, mk[site + ':' + p.id] || { stats: null }, lim);
      if (!needs.length) continue;
      const k = site + ':' + p.id;
      const prev = d.products[k];
      const left = prev && prev.status ? openNeeds(needs, prev.hits) : needs;
      if (!left.length) continue;
      if (dueAt(prev) > now) continue;
      const score = left.reduce((a, n) => a + WEIGHT[n], 0) + (prev ? 0 : 3) + (p.inStock !== false ? 1 : 0);
      out.push(Object.assign(itemOf(site, p, prev, left), { rank: Math.min(...left.map((x) => ORDER[x])), score }));
      if (limit && out.length > limit * 4) break; // enough to choose from (never the whole catalog in memory twice)
    }
  }
  out.sort((a, b) => b.score - a.score || a.rank - b.rank || b.price - a.price);
  return out.slice(0, limit || out.length);
}

/** The products a person chose (or one product) — searched now, whatever the schedule. mode 'full': the whole plan. */
function itemsFor(keys, mode) {
  const catalog = require('./catalog');
  const d = data();
  const mk = require('./market').results();
  const out = [];
  for (const k of keys) {
    const m = String(k).match(/^(sf|st):(\d+)$/);
    if (!m) continue;
    const p = catalog.byId(m[1]).get(Number(m[2]));
    if (!p) continue;
    const prev = d.products[k];
    const needs = needsOf(p, mk[k] || { stats: null });
    const left = prev && prev.status ? openNeeds(needs, prev.hits) : needs;
    // a full research looks for everything (a product with a code is checked too: its code, EAN, photos, prices)
    const all = ['sku', 'ean', 'images', 'brand', 'price'];
    out.push(Object.assign(itemOf(m[1], p, prev, mode === 'full' ? all : left.length ? left : needs.length ? needs : all), mode === 'full' ? { mode: 'full' } : {}));
  }
  return out;
}

// the kind of product in English: the shops abroad (and many Greek ones) write it so
const KIND_EN = [[/^ΣΑΚΙΔ/, 'backpack'], [/^ΠΑΝΤΕΛ/, 'pants'], [/^ΜΠΟΥΦΑΝ/, 'jacket'], [/^ΑΡΒΥΛ|^ΜΠΟΤ/, 'boots'], [/^ΠΑΠΟΥΤΣ/, 'shoes'], [/^ΓΑΝΤ/, 'gloves'], [/^ΦΑΚΟΣ|^ΦΑΚΟΙ|^ΦΑΚΟ$/, 'flashlight'],
  [/^ΜΑΧΑΙΡ|^ΣΟΥΓΙ/, 'knife'], [/^ΘΗΚ/, 'pouch'], [/^ΖΩΝ/, 'belt'], [/^ΚΑΠΕΛ|^ΤΖΟΚΕ/, 'cap'], [/^ΣΚΟΥΦ/, 'beanie'], [/^ΓΥΑΛΙ/, 'glasses'], [/^ΚΙΑΛ/, 'binoculars'], [/^ΔΙΟΠΤΡ/, 'scope'],
  [/^ΦΥΣΙΓΓ/, 'shells'], [/^ΒΟΛΙΔ|^ΣΚΑΓΙ/, 'pellets'], [/^ΜΠΛΟΥΖ|^ΦΑΝΕΛ/, 't-shirt'], [/^ΠΟΥΚΑΜ|^ΧΙΤΩΝ/, 'shirt'], [/^ΓΙΛΕΚ/, 'vest'], [/^ΚΑΛΤΣ/, 'socks'], [/^ΣΚΗΝ/, 'tent'],
  [/^ΥΠΝΟΣΑΚ/, 'sleeping bag'], [/^ΜΠΑΤΑΡ/, 'battery'], [/^ΦΟΡΤΙΣΤ/, 'charger'], [/^ΡΟΛΟΙ/, 'watch'], [/^ΣΗΜΑ/, 'patch'], [/^ΖΑΚΕΤ|^FLEECE/, 'fleece'], [/^ΦΟΥΤΕΡ/, 'hoodie'],
  [/^ΤΣΑΝΤ|^ΣΑΚΟΣ/, 'bag'], [/^ΒΕΡΜΟΥΔ|^ΣΟΡΤΣ/, 'shorts'], [/^ΓΕΜΙΣΤΗΡ/, 'magazine'], [/^ΑΕΡΟΒΟΛ/, 'air rifle'], [/^ΚΑΡΑΜΠΙΝ/, 'shotgun'], [/^ΜΑΣΚ/, 'mask'], [/^ΚΡΑΝ/, 'helmet'],
  [/^ΕΠΙΓΟΝΑΤ/, 'knee pads'], [/^ΠΑΓΟΥΡ/, 'bottle'], [/^ΦΙΛΤΡ/, 'filter'], [/^ΠΥΞΙΔ/, 'compass'], [/^ΣΚΟΠΕΥΤ/, 'sight'], [/^ΛΑΒ/, 'grip'], [/^ΙΜΑΝΤ/, 'sling'], [/^ΚΟΝΤΟΜΑΝΙΚ/, 't-shirt']];
function kindEn(title) {
  const first = U.stripTonos(String(title || '').split(/\s+/)[0] || '').toUpperCase();
  const k = KIND_EN.find(([re]) => re.test(first));
  return k ? k[1] : '';
}

/**
 * The plan of searches for a product → [{ q, why }] (why: code · ean · exact · title · model · family · code-alone ·
 * code-flat · mpn · english · latin · nobrand · codes · ai). it.round: later rounds put the other ways first;
 * it.aiQueries: searches the AI of a computer proposed (checked: never a search with a code that is not ours).
 */
function planOf(it, max) {
  const market = require('./market');
  const title = U.collapse(U.decodeEntities(it.name));
  const brand = U.collapse(U.decodeEntities(it.brand || ''));
  const withBrand = brand && !U.foldKey(title).includes(U.foldKey(brand)) ? brand + ' ' + title : title;
  const f = market.features({ name: it.name, brand: it.brand });
  const keys = f.keys.filter((k) => /[A-Z0-9]/.test(k));
  const sku = U.collapse(it.sku || '');
  const skuFlat = U.normSku(sku);
  const ean = gtin(it.ean) ? String(it.ean).replace(/\D/g, '') : '';
  const mpn = U.collapse(it.mpn || '');
  const en = kindEn(title);
  const colours = [...market.coloursOf(it.name)].map((c) => c.toLowerCase());
  // the model as the shops write it, in Latin letters (no Greek type words, colours or sizes)
  const latin = title.split(/\s+/).filter((w) => !/[Ͱ-Ͽ]/.test(w)).join(' ');
  const model = keys.join(' ');
  const first = [], alt = [];
  const add = (list, q, why) => list.push({ q, why });
  if (sku) add(first, `${brand} ${sku}`.trim(), 'code');
  if (ean) add(first, ean, 'ean');
  if (brand && model && colours.length) add(first, `"${brand} ${model}" ${colours.join(' ')}`, 'exact');
  add(first, withBrand, 'title');
  if (brand && model) add(first, `${brand} ${model}`, 'model');
  if (sku && skuFlat.length >= 5 && /\d/.test(skuFlat)) { add(alt, sku, 'code-alone'); if (skuFlat !== sku.toUpperCase()) add(alt, skuFlat, 'code-flat'); }
  if (mpn && U.normSku(mpn) !== skuFlat) add(alt, `${brand} ${mpn}`.trim(), 'mpn');
  if (en && (brand || keys.length)) add(alt, `${brand} ${model} ${en} ${colours.join(' ')}`.replace(/\s+/g, ' ').trim(), 'english');
  // the model without its colour: finds the family (the other colours / sizes and their pages), never a value for ours
  if (brand && model && colours.length) add(alt, `"${brand} ${model}"${en ? ' ' + en : ''}`, 'family');
  if (!brand) {
    // no brand: the model words / codes of the title (a product without a brand is still searched in earnest)
    if (latin && latin !== title) add(alt, latin, 'latin');
    if (keys.length >= 2) add(alt, model + (en ? ' ' + en : ''), 'nobrand');
  } else if (latin && U.foldKey(latin) !== U.foldKey(withBrand)) add(alt, latin.includes(brand) ? latin : `${brand} ${latin}`, 'latin');
  for (const c of f.codes.slice(0, 2)) add(alt, brand ? `${brand} ${c}` : c, 'codes');
  for (const q of (it.aiQueries || []).slice(0, 4)) add(alt, q, 'ai');
  const order = (it.round || 0) % 2 === 1 ? first.slice(0, 1).concat(alt, first.slice(1)) : first.concat(alt);
  const seen = new Set();
  return order.map((x) => ({ q: U.collapse(x.q), why: x.why })).filter((x) => { const k = U.foldKey(x.q.replace(/"/g, '')) + '|' + /"/.test(x.q); if (x.q.replace(/"/g, '').length < 4 || seen.has(k)) return false; seen.add(k); return true; }).slice(0, max || DEFAULT_LIMITS.maxQueries);
}
function queriesOf(it, max) { return planOf(it, max).map((x) => x.q); }
function queryOf(it) { return queriesOf(it)[0]; }

/** One address, written one way (no #, no tracking tails, no trailing slash): the same page is never read twice. */
function normUrl(u) {
  try {
    const x = new URL(u);
    x.hash = '';
    for (const k of [...x.searchParams.keys()]) if (/^(utm_|gclid|fbclid|srsltid|msclkid|ref$|_pos|_sid|_ss)/i.test(k)) x.searchParams.delete(k);
    return (x.origin + x.pathname.replace(/\/+$/, '') + (x.search || '')).toLowerCase();
  } catch (_) { return String(u || '').toLowerCase(); }
}
// pages that are never a product: the shop's search, tags, blog posts, files
const NOT_PRODUCT = /[?&](s|q|search|query|keyword)=|\/(search|tag|tags|blog|news|article|articles)(\/|$)|\.(pdf|jpe?g|png|webp|gif|zip|docx?|xlsx?)$/i;

/**
 * What kind of site a host is: own · competitor · supplier · maker · marketplace · irrelevant · shop (a shop not on our
 * list: recorded, proposed when it has several of our products — never thrown away because it is not on the list).
 */
function classify(host, ctx) {
  const sfind = require('./supplierfind');
  const c = ctx || {};
  if (c.own && c.own.has(host)) return 'own';
  if (c.compHosts && c.compHosts.has(host)) return 'competitor';
  if (c.supplierHosts && c.supplierHosts.has(host)) return 'supplier';
  if (sfind.MARKETPLACE.test(host)) return 'marketplace';
  if (sfind.NEVER.test(host)) return 'irrelevant';
  const b = U.slugify(c.brand || '').replace(/-/g, '');
  if (b.length >= 3 && host.replace(/[.-]/g, '').includes(b)) return 'maker';
  return 'shop';
}
const CLASS_LABEL = { own: 'δικό μας', competitor: 'γνωστός ανταγωνιστής', supplier: 'αντιπρόσωπος / προμηθευτής', maker: 'επίσημος κατασκευαστής', marketplace: 'marketplace', irrelevant: 'άσχετη πηγή', shop: 'νέο πιθανό κατάστημα' };

/** The brand written in a title of ours when the product has none filed: its first Latin word(s) (MIL-TEC of «ΣΑΚΙΔΙΟ MIL-TEC …»). */
function guessBrand(name) {
  const w = U.collapse(U.decodeEntities(name || '')).split(/\s+/).find((x) => /^[A-Za-z][A-Za-z0-9&.-]{2,}$/.test(x));
  return w || '';
}

/** Run `fn` over `list`, `n` at a time. */
async function pool(list, n, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.max(1, Math.min(n, list.length)) }, async () => { while (i < list.length) { const x = list[i++]; await fn(x); } }));
}

// ---------- the colour of a photo, from its file name (the makers name their files: …_olive_20lt.jpg) ----------
const FILE_COLOUR = [[/(^|[^a-z])(black|schwarz|negro|noir|nero|mavro|blk)([^a-z]|$)/, 'BLACK'], [/(^|[^a-z])(olive|oliv|olivgrun|olivgruen|ladi|od[-_]?green|ranger[-_]?green)([^a-z]|$)/, 'OLIVE'],
  [/(^|[^a-z])(coyote|coyot)([^a-z]|$)/, 'COYOTE'], [/(^|[^a-z])(khaki|kaki|chaki)([^a-z]|$)/, 'KHAKI'], [/(^|[^a-z])(tan|sand|beige|desert)([^a-z]|$)/, 'SAND'], [/(^|[^a-z])(woodland)([^a-z]|$)/, 'WOODLAND'],
  [/(^|[^a-z])(multicam|mc)([^a-z]|$)/, 'MULTICAM'], [/(^|[^a-z])(flecktarn)([^a-z]|$)/, 'FLECKTARN'], [/(^|[^a-z])(grey|gray|grau|gkri)([^a-z]|$)/, 'GREY'], [/(^|[^a-z])(navy)([^a-z]|$)/, 'NAVY'],
  [/(^|[^a-z])(green|grun|gruen|prasino)([^a-z]|$)/, 'GREEN'], [/(^|[^a-z])(blue|blau|mple)([^a-z]|$)/, 'BLUE'], [/(^|[^a-z])(red|rot|kokkino)([^a-z]|$)/, 'RED'], [/(^|[^a-z])(white|weiss|lefko|aspro)([^a-z]|$)/, 'WHITE']];
function fileColours(u) {
  const f = String(u || '').split('?')[0].split('/').pop().toLowerCase().replace(/\.(jpe?g|png|webp|gif|avif)$/, '');
  const out = new Set();
  for (const [re, c] of FILE_COLOUR) if (re.test(f)) out.add(c);
  return out;
}
const COLOUR_NEAR = { GREEN: ['OLIVE'], OLIVE: ['GREEN'], SAND: ['COYOTE', 'KHAKI', 'BEIGE'], COYOTE: ['SAND'], KHAKI: ['SAND'], BEIGE: ['SAND'] };
const sameColour = (a, ours) => ours.has(a) || (COLOUR_NEAR[a] || []).some((x) => ours.has(x));

/**
 * The photos of a page that are OUR variant's, and how that is known → { images, how }
 *   variant  — the photos of the variant in our colour (schema.org / WooCommerce / Shopify variants)
 *   page     — a page of one colour, ours (its photos, minus any whose file names another colour)
 *   filename — the file name says our colour
 *   none     — several colours that cannot be told apart, or our colour is not there: no photo (never a guess)
 */
function imagesForVariant(pg, ourColours, ourSku) {
  const market = require('./market');
  const all = (pg.images || []).filter((u) => /^https?:\/\//i.test(u));
  const flat = U.normSku(ourSku || '');
  const byCode = flat.length >= 6 ? (pg.variants || []).filter((v) => v && U.normSku(v.sku || '') === flat && (v.images || []).length) : [];
  if (byCode.length) return { images: [...new Set(byCode.flatMap((v) => v.images))].slice(0, 6), how: 'variant' };
  const notOther = (u) => { const fc = fileColours(u); return !fc.size || [...fc].some((c) => sameColour(c, ourColours)); };
  const namesOurs = (u) => [...fileColours(u)].some((c) => sameColour(c, ourColours));
  const vs = (pg.variants || []).filter((v) => v && typeof v === 'object');
  const colourVars = vs.filter((v) => v.color);
  const pageColours = market.coloursOf(pg.name || '');
  if (!ourColours.size) {
    // our title names no colour: a page of several colours gives no photo (which one is ours?)
    if (new Set(colourVars.map((v) => U.foldKey(v.color))).size > 1) return { images: [], how: 'none' };
    return { images: all.filter((u) => fileColours(u).size <= 1).slice(0, 6), how: 'page' };
  }
  if (colourVars.length) {
    const mine = colourVars.filter((v) => [...market.coloursOf(v.color)].some((c) => sameColour(c, ourColours)));
    if (!mine.length) return { images: [], how: 'none' };
    const own = [...new Set(mine.flatMap((v) => v.images || []))].filter(notOther);
    if (own.length) return { images: own.concat(all.filter((u) => namesOurs(u) && !own.includes(u))).slice(0, 6), how: 'variant' };
    const named = all.filter(namesOurs);
    return { images: named.slice(0, 6), how: named.length ? 'filename' : 'none' };
  }
  if (pageColours.size && [...pageColours].some((c) => sameColour(c, ourColours))) return { images: all.filter(notOther).slice(0, 6), how: 'page' };
  // the page names no colour, ours does: only photos whose file names our colour
  const named = all.filter(namesOurs);
  return { images: named.slice(0, 6), how: named.length ? 'filename' : 'none' };
}

/**
 * A page with sizes / colours seen for OUR product: the price, EAN, code and stock of our colour (never another
 * variant's). → { price, ean, sku, avail, priceKind: 'single' | 'from' | 'other-colour', variant: 'ours' | 'other' | 'unknown' }
 */
function variantView(pg, ourColours, ourSku) {
  const market = require('./market');
  const vs = (pg.variants || []).filter((v) => v && typeof v === 'object');
  const avail0 = pg.availability || (pg.inStock === true ? 'in' : pg.inStock === false ? 'out' : 'unknown');
  if (!vs.length) return { price: Number(pg.price) || 0, ean: gtin(pg.ean) ? String(pg.ean).replace(/\D/g, '') : '', sku: '', avail: avail0, priceKind: 'single', variant: 'unknown' };
  let poolV = vs, kind = '', variant = 'unknown';
  // the variant with OUR whole code is ours (whatever the page calls its colour)
  const flat = U.normSku(ourSku || '');
  const byCode = flat.length >= 6 ? vs.filter((v) => U.normSku(v.sku || '') === flat) : [];
  if (byCode.length) { poolV = byCode; variant = 'ours'; }
  else if (ourColours.size && vs.some((v) => v.color)) {
    poolV = vs.filter((v) => [...market.coloursOf(v.color || '')].some((c) => sameColour(c, ourColours)));
    if (!poolV.length) { poolV = vs; kind = 'other-colour'; variant = 'other'; } else variant = 'ours';
  }
  const st = (v) => (v.inStock === true ? 'in' : v.inStock === false ? 'out' : 'unknown');
  const told = poolV.filter((v) => st(v) !== 'unknown');
  const inV = poolV.filter((v) => st(v) === 'in' && v.price > 0);
  const priced = poolV.filter((v) => v.price > 0);
  const price = inV.length ? Math.min(...inV.map((v) => v.price)) : priced.length ? Math.min(...priced.map((v) => v.price)) : Number(pg.price) || 0;
  const varies = new Set((inV.length ? inV : priced).map((v) => v.price)).size > 1;
  let avail = told.length ? (told.some((v) => st(v) === 'in') ? 'in' : told.length === poolV.length ? 'out' : 'unknown') : avail0;
  if (kind === 'other-colour') avail = 'unknown'; // our colour is not on their page: nothing is known of its stock
  const eans = [...new Set(poolV.map((v) => gtin(v.ean)).filter(Boolean))];
  const ean = kind === 'other-colour' ? '' : eans.length === 1 && poolV.every((v) => gtin(v.ean) === eans[0]) ? eans[0] : !vs.some((v) => v.ean) && gtin(pg.ean) ? String(pg.ean).replace(/\D/g, '') : '';
  const skus = [...new Set(poolV.map((v) => String(v.sku || '').trim()).filter(Boolean))];
  const sku = kind === 'other-colour' ? '' : skus.length === 1 ? skus[0] : skus.length > 1 ? require('./extract').commonCode(skus) : '';
  return { price, ean, sku, avail, priceKind: kind || (varies ? 'from' : 'single'), variant };
}

/** The same code: whole, or a word of their title that is our code (never a part of a longer number). */
function sameCodeOf(it, pg) {
  const ours = U.normSku(it.sku || '');
  if (ours.length < 4) return false;
  const theirs = [pg.code, pg.sku, pg.mpn].concat((pg.variants || []).map((v) => v.sku)).map((x) => U.normSku(x || '')).filter((x) => x.length >= 4);
  if (theirs.includes(ours)) return true;
  if (ours.length < 5) return false;
  const words = U.foldKey(pg.name || '').split(/[^A-Z0-9Α-Ω.\-_/]+/).map((w) => U.normSku(w)).filter(Boolean);
  for (let i = 0; i < words.length; i++) if (words[i] === ours || (words[i + 1] && words[i] + words[i + 1] === ours)) return true;
  return false;
}

/**
 * One product: the plan of searches, the shop pages read, «the same variant» kept, «the same family» noted — and what
 * happened, step by step.
 * io = { search(q) → [{ url, title }] (.engines), page(url) → { name, brand, code, sku, mpn, ean, price, currency,
 *        availability, images, variants }, own: Set(host), compHosts, supplierHosts, parallel, cancelled(), limits,
 *        judge(our, page, deterministic) → AI verdict (optional) }
 * → { hits, family, read, queries, status, needsLeft, sum, trace, stop }
 *   status: complete · partial (something missing) · family_only (only other variants of the model) · not_found ·
 *   no_results · pages_failed · search_failed · blocked · cancelled
 */
async function lookUp(it, io) {
  const market = require('./market');
  const sfind = require('./supplierfind');
  const L = Object.assign({}, DEFAULT_LIMITS, io.limits || {});
  const full = it.mode === 'full';
  const maxQ = full ? L.fullQueries : L.maxQueries, maxPages = full ? L.fullPages : L.maxPages;
  const needs = Array.isArray(it.needs) && it.needs.length ? it.needs : ['sku', 'images', 'brand', 'price'];
  const hits = [], family = [];
  const tried = new Set(), perHost = new Map(), sameHost = new Set();
  const trace = { at: U.nowIso(), mode: full ? 'full' : 'auto', queries: [], results: [], pages: [] };
  const sum = { queries: 0, engines: {}, results: 0, opened: 0, read: 0, exact: 0, family: 0, rejected: 0, errors: 0, domains: 0, newShops: 0, reasons: {} };
  let read = 0, queries = 0, status = '', engineOk = 0, engineErr = 0, stop = '';
  const ourColours = market.coloursOf(it.name);
  const ourEan = gtin(it.ean);
  const our = { name: it.name, brand: it.brand, sku: it.sku || '', price: it.price, ean: it.ean || '' };
  const ctx = { own: io.own, compHosts: io.compHosts, supplierHosts: io.supplierHosts, brand: it.brand || guessBrand(it.name) };
  const domains = new Map(); // host → class
  const reason = (k) => { sum.reasons[k] = (sum.reasons[k] || 0) + 1; };
  const note = (pg0, outcome, why, extra) => { if (trace.pages.length < 200) trace.pages.push(Object.assign({ url: String(pg0.url).slice(0, 300), host: pg0.host, q: pg0.qi, cls: domains.get(pg0.host) || '', outcome, why: String(why || '').slice(0, 160), at: U.nowIso() }, extra || {})); };
  const plan = planOf(it, maxQ);
  // the pages of the competitors' catalogs the price research already found for it: read first (no search needed)
  const known = (it.known || []).filter((x) => x && /^https?:\/\//.test(x.url));
  const steps = (known.length ? [{ q: '(κατάλογοι ανταγωνιστών)', why: 'catalog', known }] : []).concat(plan);
  for (const step of steps) {
    if (io.cancelled && io.cancelled()) { status = 'cancelled'; break; }
    if (sum.opened >= maxPages) { stop = 'pages'; break; }
    // enough (auto): the first searches done, what is missing confirmed, by enough shops
    const shops = new Set(hits.map((h) => h.host)).size;
    if (!full && queries >= L.minQueries && !openNeeds(needs, hits).length && shops >= Math.min(L.minShops, 2 + Math.floor(queries / 4))) { stop = 'enough'; break; }
    let results;
    if (step.known) { results = step.known.map((x, i) => ({ url: x.url, title: x.shop, rank: i, engine: 'catalog' })); results.engines = [{ id: 'catalog', state: 'ok', n: results.length }]; }
    else {
      try { results = await io.search(step.q); } catch (e) {
        if (e instanceof sfind.Blocked) {
          if (!queries) throw e; // nothing done yet: the job waits and asks again for this product
          status = 'blocked'; trace.queries.push({ q: step.q, why: step.why, n: 0, engines: e.engines || null, error: 'οι μηχανές αναζήτησης ζήτησαν παύση' }); break;
        }
        if (e && e.cancelled) { status = 'cancelled'; break; }
        engineErr++; sum.errors++;
        trace.queries.push({ q: step.q, why: step.why, n: 0, error: String(e.message || e).slice(0, 140) });
        continue;
      }
      queries++;
    }
    const eng = (results && results.engines) || null;
    if (eng) for (const x of eng) { if (x.id === 'catalog') continue; sum.engines[x.id] = sum.engines[x.id] || { ok: 0, failed: 0, blocked: 0, results: 0 }; if (x.state === 'ok') { sum.engines[x.id].ok++; sum.engines[x.id].results += x.n || 0; engineOk++; } else if (x.state === 'blocked' || x.state === 'paused' || x.state === 'quota') sum.engines[x.id].blocked++; else { sum.engines[x.id].failed++; engineErr++; } }
    else if (!step.known) engineOk++;
    const qi = trace.queries.length;
    trace.queries.push({ q: step.q, why: step.why, n: (results || []).length, engines: eng });
    sum.results += step.known ? 0 : (results || []).length;
    const pages = [];
    // the likelier pages first (a title with our code or brand), another colour last: fewer pages to open
    const ourBrand = U.foldKey(it.brand || ''), ourSku = U.normSku(it.sku || '');
    const like = (r) => { const t = String(r.title || ''); if (!t) return 0; let v = 0; if (ourSku.length >= 4 && U.normSku(t).includes(ourSku)) v += 3; if (ourBrand && U.foldKey(t).includes(ourBrand)) v += 1; const c = market.coloursOf(t); if (ourColours.size && c.size && ![...c].some((x) => ourColours.has(x))) v -= 1; return v; };
    const ranked = (results || []).map((r, i) => [r, like(r), i]).sort((a, b) => b[1] - a[1] || a[2] - b[2]).map((x) => x[0]);
    for (const r of ranked) {
      if (!r || !/^https?:\/\//i.test(r.url)) continue;
      const host = hostOf(r.url);
      if (!host) continue;
      if (!domains.has(host)) { domains.set(host, classify(host, ctx)); if (domains.get(host) === 'shop') sum.newShops++; }
      const cls = domains.get(host);
      const nu = normUrl(r.url);
      const rec = { q: qi, url: String(r.url).slice(0, 300), host, title: String(r.title || '').slice(0, 120), engine: r.engine || '', rank: r.rank == null ? null : r.rank, cls, open: '' };
      if (trace.results.length < 400) trace.results.push(rec);
      if (tried.has(nu)) { rec.open = 'ήδη'; continue; }
      tried.add(nu);
      // our own sites, marketplaces and unrelated sites: recorded, not read
      if (cls === 'own' || cls === 'marketplace' || cls === 'irrelevant') { rec.open = cls; continue; }
      if (NOT_PRODUCT.test(r.url)) { rec.open = 'όχι σελίδα προϊόντος'; continue; }
      if ((perHost.get(host) || 0) >= L.perHost) { rec.open = 'όριο σελίδων του site'; continue; }
      if (pages.length >= L.pagesPerQuery || sum.opened + pages.length >= maxPages) { rec.open = 'όριο σελίδων'; continue; }
      perHost.set(host, (perHost.get(host) || 0) + 1);
      rec.open = 'ναι';
      pages.push({ host, url: r.url, qi });
    }
    await pool(pages, io.parallel || 2, async (pg0) => {
      if (io.cancelled && io.cancelled()) return;
      let pg;
      sum.opened++;
      try { pg = await io.page(pg0.url); read++; sum.read++; sfind.count('page'); } catch (e) { sum.errors++; reason('error'); note(pg0, 'error', e.message || e); return; }
      if (!pg || !pg.name) { reason('no_data'); note(pg0, 'no_data', 'η σελίδα δεν έδωσε στοιχεία προϊόντος'); return; }
      if (pg.isProduct === false && !(Number(pg.price) > 0) && !pg.code && !pg.sku && !pg.ean) { reason('not_product'); note(pg0, 'not_product', 'δεν είναι σελίδα ενός προϊόντος', { title: String(pg.name).slice(0, 120) }); return; }
      const view = variantView(pg, ourColours, it.sku);
      const title = String(pg.name).slice(0, 200);
      const facts = { title, sku: String(pg.sku || pg.code || '').slice(0, 60), ean: view.ean, price: view.price, avail: view.avail, colour: [...market.coloursOf(pg.name)].join(' ') };
      // the same product: the same EAN, the same code as ours, or the matching of the price research says «exact»
      const sameEan = !!(ourEan && (gtin(pg.ean) === ourEan || (pg.variants || []).some((v) => gtin(v.ean) === ourEan)));
      const sameCode = sameCodeOf(it, pg);
      const chk = market.score(our, { name: pg.name, sku: pg.sku || pg.code || '', mpn: pg.mpn || '', brand: pg.brand || '', price: view.price, ean: view.ean || (pg.variants && pg.variants.length ? '' : pg.ean || '') });
      let match = '', how = '', why = '';
      // the WHOLE code of ours on one variant of their page, the brand not disagreeing: the maker's page of the model
      // («US Assault Pack SM» with the variant 14002001) is ours whatever its title says
      const ourFlat = U.normSku(it.sku || '');
      const varCode = ourFlat.length >= 6 && (pg.variants || []).some((v) => U.normSku(v.sku || '') === ourFlat);
      const brandAgrees = !pg.brand || !(it.brand || guessBrand(it.name)) || U.foldKey(pg.brand).replace(/[^A-Z0-9]/g, '').includes(U.foldKey(it.brand || guessBrand(it.name)).replace(/[^A-Z0-9]/g, '').slice(0, 5));
      if (sameEan) { match = 'exact'; how = 'ean'; }
      else if (varCode && brandAgrees) { match = 'exact'; how = 'code'; }
      else if (sameCode && chk.match !== 'none') { match = chk.match === 'exact' ? 'exact' : 'code'; how = 'code'; }
      else if (chk.match === 'exact') { match = 'exact'; how = 'words'; }
      else if (chk.match === 'family') { match = 'family'; why = chk.why; }
      // a page of the whole model with variants: the variant of OUR colour is the product; without it, the family
      if (match === 'exact' && !sameEan && !varCode && view.variant === 'other') { match = 'family'; why = 'η σελίδα έχει το μοντέλο σε άλλα χρώματα, όχι στο δικό μας'; }
      if (match && match !== 'family' && !sameEan && ourColours.size && !(pg.variants || []).length) {
        // each title names a colour the other has not (URBAN of «URBAN LINE» on both sides proves nothing)
        const theirs = market.coloursOf(pg.name);
        const onlyOurs = [...ourColours].filter((c) => !theirs.has(c)), onlyTheirs = [...theirs].filter((c) => !ourColours.has(c));
        if (onlyOurs.length && onlyTheirs.length) { match = 'family'; why = 'άλλο χρώμα: ' + onlyTheirs.join(' '); }
      }
      // another version (PRO, MK2, MINI…) found by the base of the code only: not the same (the whole code or the EAN would be)
      if (match && match !== 'family' && !sameEan && !varCode && U.normSku(pg.sku || pg.code || '') !== U.normSku(it.sku || '-')) {
        const ourW = new Set(market.keyTokens(it.name, it.brand)), theirW = market.keyTokens(pg.name, pg.brand || it.brand);
        const mod = theirW.find((w) => market.MODIFIERS.has(w) && !ourW.has(w)) || [...ourW].find((w) => market.MODIFIERS.has(w) && !theirW.includes(w));
        if (mod) { match = ''; chk.match = 'similar'; chk.why = `άλλη έκδοση («${mod}»)`; }
      }
      // a doubtful page: the AI of the computer may look at it — it can take a «same» away or propose one for a person's
      // yes, never make a page «the same» by itself
      let ai = null;
      if (io.judge && (match === 'code' || (!match && chk.match === 'similar') || (match === 'exact' && how === 'words' && !view.ean && !facts.sku))) {
        try { ai = await io.judge(our, { name: pg.name, brand: pg.brand || '', sku: pg.sku || pg.code || '', ean: view.ean, price: view.price, avail: view.avail, variants: (pg.variants || []).slice(0, 12).map((v) => [v.color, v.size, v.sku].filter(Boolean).join(' ')), url: pg0.url }, { match: match || chk.match, why: chk.why || '' }); } catch (_) { ai = null; }
        if (ai && match === 'exact' && ai.verdict && ai.verdict !== 'exact') { match = ai.verdict === 'family' ? 'family' : ''; why = 'το AI: ' + (ai.reason || ai.verdict); if (!match) { chk.match = 'similar'; chk.why = 'το AI είδε διαφορά: ' + (ai.reason || ''); } }
      }
      const cur = String(pg.currency || '').toUpperCase();
      const euro = cur === 'EUR' || (!cur && /\.(gr|cy)$/.test(pg0.host));
      if (match === 'family') {
        sum.family++; reason('family');
        // the same model, another variant: kept for what it tells (the model, its colours), never as a value of ours
        const fv = (pg.variants || []).filter((v) => v.color).slice(0, 8).map((v) => ({ colour: v.color, size: v.size || '', sku: v.sku || '', ean: gtin(v.ean) || '', price: v.price || 0, avail: v.inStock === true ? 'in' : v.inStock === false ? 'out' : 'unknown', img: (v.images || [])[0] || '' }));
        if (family.length < 20) family.push({ host: pg0.host, url: pg.url || pg0.url, name: title, colour: facts.colour, sku: facts.sku, ean: gtin(pg.ean) || '', price: euro ? Number(pg.price) || 0 : 0, avail: pg.availability || 'unknown', img: (pg.images || [])[0] || '', variants: fv, at: U.nowIso(), cls: domains.get(pg0.host) });
        note(pg0, 'family', 'ίδιο μοντέλο, άλλη παραλλαγή: ' + (why || chk.why || ''), { title, facts });
        return;
      }
      if (!match) {
        sum.rejected++; reason(chk.match === 'similar' ? 'similar' : 'other');
        note(pg0, chk.match === 'similar' ? 'similar' : 'other', (chk.match === 'similar' ? 'παρόμοιο, όχι ίδιο: ' + (chk.why || '') : 'άλλο προϊόν'), Object.assign({ title, facts }, ai ? { ai: { verdict: ai.verdict, reason: String(ai.reason || '').slice(0, 160), confidence: ai.confidence || 0 } } : {}));
        return;
      }
      // one «same» per site (a second page of the same site for the same variant: written, not counted twice)
      if (sameHost.has(pg0.host)) { note(pg0, 'duplicate', 'το site έδειξε ήδη το ίδιο προϊόν σε άλλη σελίδα', { title }); return; }
      sameHost.add(pg0.host);
      sum.exact++;
      const im = imagesForVariant(pg, ourColours, it.sku);
      // a price counts only in euro (a Greek shop without a currency is in euro; any other is left out)
      hits.push({ host: pg0.host, url: pg.url || pg0.url, name: title, brand: String(pg.brand || '').slice(0, 60), code: String(view.sku || pg.mpn || pg.sku || pg.code || '').slice(0, 60), sku: String(view.sku || pg.sku || '').slice(0, 60), mpn: String(pg.mpn || '').slice(0, 60),
        ean: view.ean, price: euro ? Number(view.price) || 0 : 0, regular: euro && Number(pg.regular) > view.price ? Number(pg.regular) : 0, currency: cur, avail: view.avail, priceKind: view.priceKind,
        img: im.images[0] || '', images: im.images.slice(0, 4), imgHow: im.how, how, match, cls: domains.get(pg0.host), at: U.nowIso(),
        // the sizes / colours of their page, each with ITS code / EAN (the evidence for our variations' codes)
        variants: (pg.variants || []).slice(0, 30).filter((v) => v && (v.sku || v.ean)).map((v) => ({ colour: String(v.color || '').slice(0, 40), size: String(v.size || '').slice(0, 20), sku: String(v.sku || '').slice(0, 60), ean: gtin(v.ean) || '' })),
        proof: how === 'ean' ? 'ίδιο EAN' : how === 'code' ? 'ίδιος κωδικός' + (match === 'code' ? ' (οι τίτλοι διαφέρουν: ' + (chk.why || 'έλεγξέ το') + ')' : '') : (chk.ev || []).join(' · ') || 'ίδιο προϊόν',
        ...(ai ? { ai: { verdict: ai.verdict, reason: String(ai.reason || '').slice(0, 160) } } : {}) });
      note(pg0, 'same', (how === 'ean' ? 'ίδιο EAN' : how === 'code' ? 'ίδιος κωδικός' : 'ίδιο προϊόν') + (view.avail === 'in' ? ' · διαθέσιμο' : view.avail === 'out' ? ' · εξαντλημένο' : ' · διαθεσιμότητα άγνωστη') + (euro ? '' : ' · τιμή όχι σε ευρώ') + (im.images.length ? ` · φωτογραφίες: ${im.images.length} (${{ variant: 'της παραλλαγής', page: 'σελίδα ενός χρώματος', filename: 'όνομα αρχείου' }[im.how]})` : ' · καμία σίγουρη φωτογραφία'), { title, facts, imgs: im.images.length, imgHow: im.how });
    });
  }
  if (!stop && !status) stop = 'plan';
  if (!status) {
    const anyPages = sum.opened > 0;
    if (!queries && engineErr && !known.length) status = 'search_failed';
    else if (queries && !engineOk && engineErr && !hits.length) status = 'search_failed';
    else if (hits.length) status = openNeeds(needs, hits).length ? 'partial' : 'complete';
    else if (family.length) status = 'family_only';
    else if (anyPages && !read) status = 'pages_failed';
    else if (anyPages) status = 'not_found';
    else status = 'no_results';
  }
  sum.queries = queries;
  sum.domains = domains.size;
  trace.stop = stop;
  trace.domains = [...domains].slice(0, 120).map(([host, cls]) => ({ host, cls }));
  return { hits, family, read, queries, status, needsLeft: openNeeds(needs, hits), sum, trace, stop };
}

/** The pages of before and of now, together: a page found again is the new one; one not read again stays (4 months). */
function mergeHits(prev, r) {
  const fresh = (r.hits || []).filter((h) => h && h.host);
  if (!r.status) return fresh; // a result written as it is (by hand, or an old one): it replaces
  const byUrl = new Set(fresh.map((h) => normUrl(h.url)));
  const reread = new Set(((r.trace && r.trace.pages) || []).filter((p) => p.outcome !== 'error' && p.outcome !== 'skipped').map((p) => normUrl(p.url)));
  const keep = ((prev && prev.hits) || []).filter((h) => h && h.host && !byUrl.has(normUrl(h.url)) && !reread.has(normUrl(h.url)) && days(h.at || prev.at) <= HIT_DAYS && !fresh.some((x) => x.host === h.host));
  return fresh.concat(keep).slice(0, 20);
}

function shardOf(k) { let h = 0; for (const ch of String(k)) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return 'web-trace-' + String(h % TRACE_SHARDS).padStart(2, '0'); }

/** Keep what was found for a product (with what happened), and count the sites of the internet that sell our products. */
function save(results) {
  const own = ownHosts();
  const traces = {};
  const merged = {};
  store.update(KEY, {}, (d) => {
    d.products = d.products || {}; d.shops = d.shops || {};
    for (const [k, r] of Object.entries(results)) {
      const prev = d.products[k] || null;
      const hits = mergeHits(prev, Object.assign({}, r, { hits: (r.hits || []).filter((h) => h && h.host && !own.has(h.host)) }));
      merged[k] = hits;
      const now = U.nowIso();
      const e = { at: now, hits, read: r.read || 0 };
      // the same research handed in twice (a part during the work, then the whole): counted once
      const again = !!(r.trace && r.trace.at && prev && prev.runAt === r.trace.at);
      if (r.status && again) { Object.assign(e, { status: prev.status, okAt: prev.okAt, queries: prev.queries, needsLeft: prev.needsLeft, sum: prev.sum, rounds: prev.rounds, fails: prev.fails, empties: prev.empties, runAt: prev.runAt, at: prev.at, family: prev.family, mode: prev.mode, stop: prev.stop }); }
      else if (r.status) {
        const ok = SUCCESS.has(r.status);
        const gotNew = (r.hits || []).length > 0;
        Object.assign(e, {
          status: r.status, okAt: ok ? now : (prev && prev.okAt) || null, queries: r.queries || 0, needsLeft: r.needsLeft || [], sum: r.sum || null,
          rounds: ((prev && prev.rounds) || 0) + 1,
          fails: FAILED.has(r.status) ? ((prev && prev.fails) || 0) + 1 : 0,
          empties: ok && !gotNew ? ((prev && prev.empties) || 0) + 1 : 0,
          runAt: (r.trace && r.trace.at) || now, mode: (r.trace && r.trace.mode) || 'auto', stop: r.stop || (r.trace && r.trace.stop) || '',
          // the other variants of the model seen on the way (kept apart: never a value of ours)
          family: (r.family || []).concat(((prev && prev.family) || []).filter((x) => !(r.family || []).some((y) => normUrl(y.url) === normUrl(x.url)) && days(x.at) <= HIT_DAYS)).slice(0, 20),
          ...(prev && prev.aiq ? { aiq: prev.aiq } : {}),
        });
        if (r.aiq) e.aiq = r.aiq;
        // a failed or cut research changes nothing of what was found before
        if (FAILED.has(r.status) && prev) e.hits = mergeHits(prev, { status: r.status, hits: r.hits || [], trace: null });
        if (r.trace) traces[k] = Object.assign({ status: r.status }, r.trace, { sum: r.sum || null });
      }
      d.products[k] = e;
      // every site seen: what kind it is, how often, with which of our products («the same» or only met)
      const doms = (r.trace && r.trace.domains) || [];
      for (const { host, cls } of doms) {
        if (!host || cls === 'own') continue;
        const s = d.shops[host] || { host, url: 'https://' + host + '/', products: [], seen: 0, firstAt: now };
        s.kind = cls; s.seen = (s.seen || 0) + 1; s.at = now;
        d.shops[host] = s;
      }
      for (const h of e.hits) {
        const s = d.shops[h.host] || { host: h.host, url: 'https://' + h.host + '/', products: [], seen: 0, firstAt: now, kind: h.cls || 'shop' };
        if (!s.products.includes(k)) s.products.push(k);
        s.products = s.products.slice(-50);
        s.at = now;
        d.shops[h.host] = s;
      }
    }
    // the list of sites stays small: the ones seen least (and with none of our products) go first
    const hosts = Object.keys(d.shops);
    if (hosts.length > 3000) for (const h of hosts.sort((a, b) => (d.shops[a].products.length - d.shops[b].products.length) || ((d.shops[a].seen || 0) - (d.shops[b].seen || 0))).slice(0, hosts.length - 3000)) delete d.shops[h];
    return d;
  });
  // the detail of each research, in shards (one small file is opened at a time, never all of them)
  const byShard = {};
  for (const [k, t] of Object.entries(traces)) (byShard[shardOf(k)] = byShard[shardOf(k)] || {})[k] = t;
  for (const [shard, items] of Object.entries(byShard)) {
    store.update(shard, {}, (t) => {
      t.items = t.items || {}; t.order = (t.order || []).filter((k) => !items[k]);
      for (const [k, v] of Object.entries(items)) { t.items[k] = v; t.order.push(k); }
      while (t.order.length > TRACE_PER_SHARD) delete t.items[t.order.shift()];
      return t;
    });
    store.forget(shard);
  }
  // the prices of those shops go into the price research (for the products with no price from the competitors too)
  try { require('./market').mergeWeb(merged); } catch (e) { console.error('internet prices:', e.message); }
  try { require('./fixes').invalidate(); } catch (_) { /* not loaded */ }
}
function ownHosts() { const s = require('./settings').all(); return new Set(['sf', 'st'].map((x) => hostOf(s.sites[x] && s.sites[x].url)).filter(Boolean)); }
/** The hosts the research classes as competitors / suppliers (sent with the jobs). */
function contextHosts() {
  const comp = [], sup = [];
  try { for (const c of require('./market').competitors()) { const h = hostOf(c.url); if (h) comp.push(h); } } catch (_) { /* none */ }
  try { for (const s of require('./suppliers').list()) { const h = hostOf(U.normUrl(s.website || '') || ''); if (h) sup.push(h); } } catch (_) { /* none */ }
  return { compHosts: comp, supplierHosts: sup };
}

/** The pages of the web, for the program itself (the cloud machine, or a shop's PC in local mode). */
function localIO(signal, job) {
  const sfind = require('./supplierfind');
  const extract = require('./extract');
  const state = { blocked: new Set(), used: new Set(), signal };
  try { state.apis = require('./searchkeys').config(); } catch (_) { /* none */ }
  const ch = contextHosts();
  return {
    own: ownHosts(), compHosts: new Set(ch.compHosts), supplierHosts: new Set(ch.supplierHosts), limits: limits(),
    search: (q) => sfind.searchWide(q, state),
    page: (url) => extract.fromUrl(url, { gap: 1500, signal }),
    cancelled: () => !!(job && job.cancelled()),
    parallel: 2,
    state,
  };
}

/**
 * Look up the next `max` products (a job of the program). Stops when the search engines ask for a pause (it goes on
 * later: those products are due again within hours). → { looked, withCode, blocked, failed }
 */
async function run(job, opts) {
  opts = opts || {};
  const sfind = require('./supplierfind');
  const list = opts.items || candidates(Math.max(1, Number(opts.max) || 20));
  const io = opts.io || localIO(job && job.signal, job);
  let looked = 0, withCode = 0, blocked = false, failed = 0;
  const results = {};
  job && job.progress(0, list.length, `Έρευνα στο internet: ${list.length} προϊόντα (κωδικός, EAN, φωτογραφίες, μάρκα, τιμή)…`);
  for (const it of list) {
    if (job && job.cancelled()) break;
    try {
      const r = await lookUp(it, io);
      results[it.k] = r;
      looked++;
      if (r.hits.length) withCode++;
      if (FAILED.has(r.status)) failed++;
      job && job.log(`${it.name.slice(0, 60)}: ${STATUS_LABEL[r.status] || r.status} · ${r.queries} αναζητήσεις, ${r.sum.read} σελίδες, ίδιο σε ${r.hits.length} sites, άλλη παραλλαγή σε ${r.family.length}`);
      if (r.status === 'blocked') { blocked = true; job && job.log('Οι μηχανές αναζήτησης ζήτησαν παύση· η αναζήτηση συνεχίζει αργότερα.'); break; }
      if (r.status === 'cancelled') break;
    } catch (e) {
      if (e instanceof sfind.Blocked) { blocked = true; job && job.log('Οι μηχανές αναζήτησης ζήτησαν παύση· η αναζήτηση συνεχίζει αργότερα.'); break; }
      // an error is written as an error (looked up again soon), never as «nothing found»
      results[it.k] = { hits: [], read: 0, status: 'error', trace: { at: U.nowIso(), queries: [], pages: [], error: String(e.message || e).slice(0, 200) } };
      failed++;
    }
    // each product is kept as soon as it is done (a stop or a restart loses nothing found)
    save(results); for (const k of Object.keys(results)) delete results[k];
    job && job.progress(looked, list.length, `Έρευνα στο internet: ${looked}/${list.length} · ίδιο προϊόν σε άλλα καταστήματα για ${withCode}`);
  }
  save(results);
  return { looked, withCode, blocked, failed };
}

const STATUS_LABEL = { never: 'Δεν έχει ξεκινήσει', queued: 'Σε αναμονή', running: 'Σε εξέλιξη', complete: 'Ολοκληρώθηκε με αποτελέσματα', partial: 'Ολοκληρώθηκε με ελλείψεις', family_only: 'Βρέθηκε μόνο άλλη παραλλαγή του μοντέλου',
  not_found: 'Ολοκληρώθηκε: δεν βρέθηκε το ίδιο προϊόν', no_results: 'Ολοκληρώθηκε: καμία σελίδα καταστήματος', pages_failed: 'Δεν διαβάστηκαν οι σελίδες', search_failed: 'Απέτυχαν οι μηχανές αναζήτησης', blocked: 'Μπλοκαρίστηκε προσωρινά',
  cancelled: 'Διακόπηκε', error: 'Σφάλμα', due: 'Χρειάζεται επανάληψη', stale: 'Παρωχημένη έρευνα' };

/** What the shops of the web say about one of our products (for the proposals): only «the same variant». */
function hitsFor(key) { const e = data().products[key]; return e ? e.hits || [] : []; }
/**
 * What the research did for one product, in detail (the last time), page by page: q.page / q.per for the pages and
 * the results (all of them are kept, not only the first ones on the screen).
 */
function traceFor(key, q) {
  const o = q || {};
  const per = Math.max(1, Math.min(200, Number(o.per) || 50)), page = Math.max(1, Number(o.page) || 1);
  const e = data().products[key] || null;
  const shard = store.read(shardOf(key), null);
  let t = shard && shard.items ? shard.items[key] || null : null;
  store.forget(shardOf(key));
  if (!t) t = ((store.read(TRACE_KEY, null) || {}).items || {})[key] || null; // (kept by an older version)
  if (!e && !t) return null;
  const pages = (t && t.pages) || [], results = (t && t.results) || [];
  const slice = (a) => a.slice((page - 1) * per, page * per);
  const ds = data().shops;
  return {
    at: e ? e.at : t.at, okAt: e ? e.okAt || null : null, status: stateWord(e) || (t && t.status) || 'never', mode: (e && e.mode) || (t && t.mode) || 'auto', stop: (e && e.stop) || (t && t.stop) || '',
    needsLeft: e ? e.needsLeft || [] : [], nextAt: e ? new Date(dueAt(e)).toISOString() : null,
    hits: e ? (e.hits || []).map((h) => ({ host: h.host, url: h.url, name: h.name, code: h.code, ean: h.ean, price: h.price, avail: h.avail || 'unknown', how: h.how, match: h.match, images: h.images || [], imgHow: h.imgHow || '', at: h.at, cls: h.cls || (ds[h.host] && ds[h.host].kind) || '', proof: h.proof || '' })) : [],
    family: e ? e.family || [] : [],
    sum: (e && e.sum) || (t && t.sum) || null, queries: t ? t.queries : [],
    pages: slice(pages), results: slice(results), totals: { pages: pages.length, results: results.length }, page, per,
    domains: (t && t.domains) || [], error: t && t.error ? t.error : '', quality: e ? qualityOf(e) : [],
  };
}
/** The state of a research in one word (a research needing a new pass, or old, is said so). */
function stateWord(e) {
  if (!e) return '';
  const s = e.status || ((e.hits || []).length ? 'complete' : 'not_found');
  if (FAILED.has(s)) return dueAt(e) <= Date.now() ? 'due' : s;
  if (days(e.okAt || e.at) > STALE_DAYS) return 'stale';
  return s;
}
/** What does not add up in what was found (a person should look before approving). */
function qualityOf(e) {
  const out = [];
  const hs = e.hits || [];
  const codes = new Set(hs.map((h) => U.normSku(h.code || '')).filter((x) => x.length >= 4));
  if (codes.size > 1) out.push(`Διαφορετικοί κωδικοί για το ίδιο προϊόν: ${[...codes].slice(0, 4).join(', ')}`);
  const eans = new Set(hs.map((h) => gtin(h.ean)).filter(Boolean));
  if (eans.size > 1) out.push(`Διαφορετικά EAN: ${[...eans].slice(0, 3).join(', ')} (ίσως ανά μέγεθος/χρώμα)`);
  if (hs.some((h) => h.priceKind === 'from')) out.push('Η τιμή αλλάζει ανά μέγεθος σε κάποιο κατάστημα (τιμή «από»)');
  if (hs.length && hs.every((h) => !h.avail || h.avail === 'unknown')) out.push('Καμία πηγή δεν επιβεβαιώνει διαθεσιμότητα');
  if (hs.some((h) => h.match === 'code')) out.push('Κάποια πηγή έχει ίδιο κωδικό αλλά άλλο τίτλο: επιβεβαίωσέ το');
  if ((e.family || []).length && !hs.length) out.push('Βρέθηκαν μόνο άλλες παραλλαγές του μοντέλου (άλλο χρώμα/μέγεθος)');
  return out;
}

/** A person's word about a site of the internet: approved (its prices count), rejected, or nothing. */
function decideShop(host, answer) {
  const h = String(host || '').toLowerCase().replace(/^www\./, '');
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)*$/.test(h) || h.length > 100) throw new Error('Λάθος διεύθυνση καταστήματος.');
  store.update(DECISIONS, {}, (d) => {
    d.approved = (d.approved || []).filter((x) => x !== h); d.rejected = (d.rejected || []).filter((x) => x !== h);
    if (answer === 'approve') d.approved.push(h); else if (answer === 'reject') d.rejected.push(h);
    return d;
  });
  // the prices of that shop count (or stop counting) at once
  const d = data();
  const byKey = {};
  for (const [k, e] of Object.entries(d.products)) if ((e.hits || []).some((x) => x.host === h)) byKey[k] = e.hits;
  try { require('./market').mergeWeb(byKey); } catch (_) { /* later */ }
  return shopDecisions();
}
function shopDecisions() { const d = store.read(DECISIONS, null) || {}; return { approved: d.approved || [], rejected: d.rejected || [] }; }

/** Sites that sell several of our products and are not competitors yet: proposed for the price research. */
function suggestedShops(min) {
  const market = require('./market');
  const have = new Set(market.competitors().map((c) => hostOf(c.url)));
  const dec = shopDecisions();
  return Object.values(data().shops).filter((s) => !have.has(s.host) && !dec.rejected.includes(s.host) && ['shop', 'maker', 'supplier', undefined].includes(s.kind) && (s.products.length >= (min || 3) || (s.seen || 0) >= 10 && s.products.length >= 1))
    .sort((a, b) => b.products.length - a.products.length || (b.seen || 0) - (a.seen || 0)).slice(0, 30)
    .map((s) => ({ host: s.host, url: s.url, count: s.products.length, seen: s.seen || 0, kind: s.kind || 'shop', label: CLASS_LABEL[s.kind || 'shop'], at: s.at, approved: dec.approved.includes(s.host) }));
}
/** Every site the research met, by kind (for the screen «Πηγές του internet»). */
function sites(q) {
  const o = q || {};
  const dec = shopDecisions();
  let list = Object.values(data().shops).map((s) => ({ host: s.host, url: s.url, kind: s.kind || 'shop', label: CLASS_LABEL[s.kind || 'shop'], products: s.products.length, seen: s.seen || 0, at: s.at, approved: dec.approved.includes(s.host), rejected: dec.rejected.includes(s.host) }));
  if (o.kind) list = list.filter((s) => s.kind === o.kind);
  list.sort((a, b) => b.products - a.products || b.seen - a.seen);
  const counts = {};
  for (const s of Object.values(data().shops)) counts[s.kind || 'shop'] = (counts[s.kind || 'shop'] || 0) + 1;
  return { total: list.length, counts, rows: list.slice(0, Math.min(500, Number(o.limit) || 200)) };
}

/** Where the internet research stands for some products: { 'site:id': { at, hits, prices, status, family } } (only those looked up). */
function stateOf(keys) {
  const d = data();
  const out = {};
  for (const k of keys) { const e = d.products[k]; if (e) out[k] = { at: e.at, hits: (e.hits || []).length, prices: (e.hits || []).filter((h) => h.price > 0).length, status: stateWord(e), family: (e.family || []).length }; }
  return out;
}
/** How far the search has come (failed researches are counted apart: they are not «looked up»). */
function status() {
  const d = data();
  const all = Object.values(d.products);
  const by = {};
  for (const e of all) { const s = stateWord(e); by[s] = (by[s] || 0) + 1; }
  return { looked: all.filter((e) => !FAILED.has(e.status)).length, withCode: all.filter((e) => (e.hits || []).length).length, waiting: candidates(2000).length, byStatus: by, failed: all.filter((e) => FAILED.has(e.status)).length, sites: Object.keys(d.shops).length };
}

module.exports = { itemsFor, stateOf, candidates, lookUp, run, save, hitsFor, traceFor, suggestedShops, sites, decideShop, shopDecisions, status, queryOf, queriesOf, planOf, needsOf, openNeeds, dueAt, variantView, imagesForVariant, fileColours, classify, normUrl, kindEn, contextHosts, ownHosts, limits, stateWord, qualityOf, KEY, TRACE_KEY, FAILED, STATUS_LABEL, CLASS_LABEL };
