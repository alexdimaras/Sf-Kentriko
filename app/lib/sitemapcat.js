'use strict';
// Competitor shops that are NOT WooCommerce or Shopify (PrestaShop, OpenCart, Joomla, custom): most of them.
// They have no public product list to download, but nearly all publish
//   • a site map (sitemap.xml): every product page, usually with the date it last changed, and
//   • on each product page a small standard block for Google (schema.org "Product"): name, code, EAN, brand,
//     price, in stock or not.
// So such a shop is read little by little, and politely:
//   1. the site map is read (in pieces: it can be 20 MB);
//   2. only the pages whose address looks like one of OUR products are kept (same brand + a model word, or a code)
//      — reading 13.000 pages to compare 2.000 would be a waste for them and for us;
//   3. a limited number of pages per run is opened (new ones first, then the ones the shop changed, then the oldest),
//      one every second and a half;
//   4. what was read is written down every few pages: a stop, a crash or a restart loses nothing, and the next run
//      goes on from there. A page the shop has not changed is not opened again (its date in the site map says so).
const http = require('./http');
const U = require('./util');

const SITEMAP_GUESSES = ['/sitemap.xml', '/sitemap_index.xml', '/1_index_sitemap.xml', '/sitemap/products.xml'];
const UA_HEADERS = { Accept: 'application/xml,text/xml,*/*;q=0.8' };

/** The addresses of the site maps a shop announces (robots.txt), or the usual places. */
async function findSitemaps(base, opts) {
  const o = Object.assign({ timeout: 30000, retries: 0 }, opts || {});
  const out = [];
  try {
    const r = await http.get(base + '/robots.txt', o);
    for (const m of r.text.matchAll(/^\s*sitemap:\s*(\S+)/gim)) out.push(m[1].trim());
  } catch (_) { /* no robots.txt */ }
  if (out.length) return [...new Set(out)];
  for (const g of SITEMAP_GUESSES) {
    try { const r = await http.get(base + g, Object.assign({}, o, { headers: UA_HEADERS })); if (/<(urlset|sitemapindex)\b/i.test(r.text.slice(0, 4000))) return [base + g]; } catch (_) { /* try the next */ }
  }
  return [];
}

const unxml = (s) => U.decodeEntities(String(s).replace(/^<!\[CDATA\[|\]\]>$/g, '').trim());

/**
 * Every address of a site map, read as a stream (never the whole file in memory): onUrl(loc, lastmod).
 * An index of site maps is followed (those that look like products first; pages of categories/brands/CMS are left out).
 */
async function eachUrl(url, onUrl, opts, depth) {
  const o = opts || {};
  if (o.signal && o.signal.aborted) return;
  // never waits for ever: 4 minutes for a whole map, 45 seconds of silence at most (a stalled site held the research)
  const ctl = new AbortController();
  const stopAll = () => { try { ctl.abort(); } catch (_) { /* ignore */ } };
  if (o.signal) { if (o.signal.aborted) return; o.signal.addEventListener('abort', stopAll, { once: true }); }
  const IDLE = o.idleMs || 45000;
  let idle = setTimeout(stopAll, IDLE);
  const whole = setTimeout(stopAll, o.totalMs || 240000);
  const quiet = () => { clearTimeout(idle); idle = setTimeout(stopAll, IDLE); };
  let res;
  try {
    // redirects one by one, each address checked (never into a private network)
    let at = url;
    for (let hop = 0; ; hop++) {
      await http.assertPublic(at);
      res = await fetch(at, { redirect: 'manual', signal: ctl.signal, headers: Object.assign({ 'User-Agent': http.UA, 'Accept-Language': 'el-GR,el;q=0.9' }, UA_HEADERS) });
      const loc = res.status >= 300 && res.status < 400 ? res.headers.get('location') : null;
      if (!loc || hop >= 5) break;
      try { await res.body?.cancel(); } catch (_) { /* nothing */ }
      at = new URL(loc, at).toString();
    }
  } catch (e) { clearTimeout(idle); clearTimeout(whole); if (o.signal) o.signal.removeEventListener('abort', stopAll); if (o.signal && o.signal.aborted) return; throw new Error('Ο χάρτης του site δεν απάντησε εγκαίρως.'); }
  if (!res.ok || !res.body) { clearTimeout(idle); clearTimeout(whole); if (o.signal) o.signal.removeEventListener('abort', stopAll); throw new Error(`Ο χάρτης του site δεν διαβάστηκε (${res.status}).`); }
  const dec = new TextDecoder('utf-8');
  let rest = '', children = [], isIndex = null;
  const eat = (text, last) => {
    rest += text;
    if (isIndex === null && (last || rest.length > 400)) isIndex = /<sitemapindex\b/i.test(rest.slice(0, 3000));
    if (isIndex === null) return; // too little to tell yet
    const tag = isIndex ? 'sitemap' : 'url';
    const re = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'g');
    let m, end = 0;
    while ((m = re.exec(rest))) {
      end = re.lastIndex;
      const loc = (m[1].match(/<loc>([\s\S]*?)<\/loc>/) || [])[1];
      if (!loc) continue;
      const lm = (m[1].match(/<lastmod>([\s\S]*?)<\/lastmod>/) || [])[1] || '';
      if (isIndex) children.push(unxml(loc)); else onUrl(unxml(loc), unxml(lm));
    }
    rest = last ? '' : rest.slice(end).slice(-200000); // an entry is never longer than this
  };
  try {
    for await (const chunk of res.body) { quiet(); eat(dec.decode(chunk, { stream: true }), false); if (o.signal && o.signal.aborted) { if (o.cut) o.cut(); return; } }
  } catch (e) {
    if (o.signal && o.signal.aborted) { if (o.cut) o.cut(); return; }
    // cut by the time limit: what was read is used (the rest of the map is read at the next run) — but the map is
    // not whole: nothing may be taken for «deleted» because it was not seen
    if (o.cut) o.cut();
  } finally { clearTimeout(idle); clearTimeout(whole); if (o.signal) o.signal.removeEventListener('abort', stopAll); }
  eat(dec.decode(), true);
  if (isIndex && (depth || 0) < 2) {
    // product maps first; maps that are clearly something else are skipped
    const skip = /(categor|brand|manufactur|cms|page|blog|post|tag|supplier|image)[^/]*$/i;
    const prod = children.filter((c) => /product/i.test(c));
    const pick = prod.length ? prod : children.filter((c) => !skip.test(c.split('?').pop().split('/').pop()) || /product/i.test(c));
    // one language is enough (the Greek pages when there are several)
    const el = pick.filter((c) => /[_/-]el[_/.-]|[?&]lang=el/i.test(c));
    // up to 200 maps (a big shop splits its products into many); one that fails makes the reading partial, not wrong
    const list = (el.length ? el : pick);
    if (list.length > 200 && o.cut) o.cut();
    for (const c of list.slice(0, 200)) {
      try { await eachUrl(c, onUrl, o, (depth || 0) + 1); } catch (e) { if (o.cut) o.cut(); }
    }
  }
}

/** The words of an address that can name a product: «…/sakidio-platis-mil-tec-assault-20l-olive» → MIL TEC MILTEC ASSAULT 20L … */
function slugTokens(loc) {
  let path = loc;
  try { path = decodeURIComponent(new URL(loc).pathname); } catch (_) { /* as it is */ }
  const last = path.replace(/\/+$/, '').split('/').pop().replace(/\.(html?|php|aspx?)$/i, '');
  const toks = U.foldKey(last).split(/[^A-Z0-9Α-Ω]+/).filter(Boolean);
  const out = new Set(toks);
  for (let i = 0; i < toks.length - 1; i++) out.add(toks[i] + toks[i + 1]); // mil-tec → MILTEC, mh-40 → MH40
  return out;
}
/** A page in another language of the same shop (kept: the Greek one, or the one without a language). */
const otherLanguage = (loc) => /\/(en|de|fr|it|es|bg|ro|tr)(\/|$)/i.test(loc.replace(/^https?:\/\/[^/]+/, ''));

// ---------- one product page ----------
const LD = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
function ldProducts(html) {
  const out = [];
  let m;
  LD.lastIndex = 0;
  while ((m = LD.exec(html))) {
    let j;
    const raw = m[1].trim();
    try { j = JSON.parse(raw); } catch (_) {
      try { j = JSON.parse(raw.replace(/[\u0000-\u001f]+/g, ' ')); } catch (_e) { continue; } // line breaks inside texts
    }
    const walk = (x, d) => {
      if (!x || d > 4) return;
      if (Array.isArray(x)) { for (const y of x) walk(y, d + 1); return; }
      if (typeof x !== 'object') return;
      const t = [].concat(x['@type'] || []).join(' ');
      if (/\bProduct\b/i.test(t)) out.push(x);
      if (x['@graph']) walk(x['@graph'], d + 1);
      if (x.mainEntity) walk(x.mainEntity, d + 1);
    };
    walk(j, 0);
  }
  return out;
}
const str = (v) => (v == null ? '' : typeof v === 'object' ? str(v.name || v['@value'] || '') : U.collapse(U.decodeEntities(String(v))));
const metaOf = (html, prop) => { const m = html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]*content=["']([^"']*)["']`, 'i')) || html.match(new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${prop}["']`, 'i')); return m ? U.decodeEntities(m[1]).trim() : ''; };

/**
 * The product of a page, in the form the competitor catalogs use → { n, s, m, g, b, u, p, r, st, i, c } or null when
 * the page is not a product page (a category, an article) or shows no price.
 */
function productOf(html, url) {
  const list = ldProducts(html);
  // the page's own product: the one whose address matches, else the first with an offer
  const offersOf = (x) => [].concat(x.offers || []).flatMap((o) => (o && o.offers ? [].concat(o.offers) : [o])).filter(Boolean);
  const same = (u) => { if (!u || typeof u !== 'string') return false; try { const a = new URL(u, url), b = new URL(url); return a.host === b.host && a.pathname.replace(/\/$/, '') === b.pathname.replace(/\/$/, ''); } catch (_) { return false; } };
  const p = list.find((x) => offersOf(x).length && (same(x.url) || same(x['@id'] || '') || offersOf(x).some((o) => same(o.url || '')))) || list.find((x) => offersOf(x).length) || list[0];
  let price = 0, cur = 'EUR', stock = true, high = 0;
  if (p) {
    const all = offersOf(p);
    const out = (o) => /OutOfStock|SoldOut|Discontinued/i.test(String(o.availability || 'InStock'));
    // the price a buyer can pay today: only the offers in stock (none in stock → sold out, with its lowest price)
    const inStock = all.filter((o) => !out(o));
    const offs = inStock.length ? inStock : all;
    const prices = [];
    for (const o of offs) {
      const v = U.parseNumber(o.price != null ? o.price : o.lowPrice != null ? o.lowPrice : (o.priceSpecification && [].concat(o.priceSpecification)[0] && [].concat(o.priceSpecification)[0].price));
      if (v > 0) prices.push(v);
      if (o.highPrice) high = Math.max(high, U.parseNumber(o.highPrice));
      if (o.priceCurrency) cur = String(o.priceCurrency).toUpperCase();
    }
    if (prices.length) { price = Math.min(...prices); high = Math.max(high, Math.max(...prices)); }
    if (all.length) stock = inStock.length > 0;
  }
  // shops whose block has no price: the meta tags Facebook reads
  if (!(price > 0)) {
    price = U.parseNumber(metaOf(html, 'product:price:amount') || metaOf(html, 'og:price:amount'));
    cur = (metaOf(html, 'product:price:currency') || metaOf(html, 'og:price:currency') || cur).toUpperCase();
    const av = metaOf(html, 'product:availability') || metaOf(html, 'og:availability');
    if (av) stock = !/out|oos|sold/i.test(av);
  }
  const name = str(p && p.name) || metaOf(html, 'og:title');
  if (!name || !(price > 0)) return null;
  const img = p ? [].concat(p.image || [])[0] : '';
  return {
    n: U.untexturize(name), s: str(p && p.sku), m: str(p && p.mpn), g: String(str(p && (p.gtin13 || p.gtin || p.gtin12 || p.gtin14 || p.gtin8 || p.ean)) || '').replace(/\D/g, ''),
    b: str(p && p.brand), u: url, p: U.r2(price), pm: high > price ? U.r2(high) : 0, r: 0, st: stock,
    i: typeof img === 'string' ? img : str(img && (img.url || img.contentUrl)) || metaOf(html, 'og:image'), c: cur || 'EUR',
  };
}

/**
 * Read (a part of) a shop through its site map. prev: what was kept from the last runs. opts:
 *   want(tokens) → is this address worth opening (it looks like one of our products)?
 *   budget       → how many pages may be opened in this run
 *   gap, signal, cancelled, onProgress(done, total, note), save(state) → called every few pages with what to keep
 * Returns the new state { products, pages, sitemaps, left, opened, … }.
 */
async function sync(c, prev, opts) {
  const o = Object.assign({ budget: 150, gap: 1500, maxMs: 6 * 60000 }, opts || {});
  const t0 = Date.now();
  const now = Date.now();
  const stopped = () => !!((o.cancelled && o.cancelled()) || (o.signal && o.signal.aborted));
  const base = c.url.replace(/\/+$/, '');
  let maps = Array.isArray(c.sitemaps) && c.sitemaps.length ? c.sitemaps : await findSitemaps(base, { signal: o.signal });
  if (!maps.length) throw new Error('Δεν βρέθηκε χάρτης του site (sitemap).');
  // 1. the site map: which addresses look like our products, and when each last changed
  o.onProgress && o.onProgress(0, 0, 'χάρτης του site…');
  const wanted = new Map(); // url → lastmod
  let seen = 0, whole = true; // whole: every map read to its end (only then is «not in the map» = deleted)
  const cut = () => { whole = false; };
  for (const m of maps) {
    if (stopped()) { whole = false; break; }
    try {
      await eachUrl(m, (loc, lm) => {
        seen++;
        if (otherLanguage(loc) || wanted.has(loc)) return;
        if (!o.want || o.want(slugTokens(loc))) wanted.set(loc, lm || '');
      }, { signal: o.signal, cut });
    } catch (e) { whole = false; if (stopped()) break; if (!wanted.size && m === maps[maps.length - 1]) throw e; }
  }
  const pages = Object.assign({}, (prev && prev.pages) || {}); // url → { lm, at, ok }
  const byUrl = new Map(((prev && prev.products) || []).map((p) => [p.u, p]));
  if (stopped() && !wanted.size) return state();
  // pages that left the site map (deleted products) leave the catalog
  // (only after a whole reading of the map: a map cut short says nothing about what it did not reach)
  if (wanted.size && whole) for (const u of Object.keys(pages)) if (!wanted.has(u)) { delete pages[u]; byUrl.delete(u); }
  // 2. what to open in this run: never opened → changed by the shop → the oldest (a price may change without the date)
  const fresh = [], changed = [], old = [];
  for (const [u, lm] of wanted) {
    const pg = pages[u];
    if (!pg) fresh.push(u);
    else if (lm && pg.lm !== lm) changed.push(u);
    else if (now - new Date(pg.at).getTime() > (lm ? 6 : 3) * 864e5) old.push(u); // with a date in the map: once in 6 days is enough
    else if (lm && pg.ok && byUrl.has(u)) byUrl.get(u).t = pg.at; // not changed, read lately: still what the shop shows
  }
  old.sort((a, b) => new Date(pages[a].at) - new Date(pages[b].at));
  const queue = fresh.concat(changed, old);
  const todo = queue.slice(0, Math.max(0, o.budget));
  let opened = 0, found = 0, errors = 0, lastSave = Date.now();
  function state() {
    const products = [...byUrl.values()];
    return { products, pages, sitemaps: maps, mapUrls: seen, wanted: wanted.size, left: Math.max(0, queue.length - opened), opened, found, count: products.length, mapWhole: whole };
  }
  for (const u of todo) {
    if (stopped()) break;
    // one shop never holds the research for long: what is left is read at the next run (nothing is lost)
    if (Date.now() - t0 > o.maxMs) break;
    o.onProgress && o.onProgress(opened, todo.length, '');
    try {
      const r = await http.get(u, { gap: o.gap, timeout: 40000, retries: 1, signal: o.signal, headers: o.headers });
      const p = productOf(r.text, u);
      const at = U.nowIso();
      pages[u] = { lm: wanted.get(u) || '', at, ok: !!p };
      if (p) { p.t = at; p.id = u; byUrl.set(u, JSON.parse(JSON.stringify(p))); found++; } else byUrl.delete(u);
      errors = 0;
    } catch (e) {
      if (e && e.cancelled) break;
      // a page that is gone is not asked for again until the shop changes it; a block ends this run (politely)
      if (e.status === 404 || e.status === 410) { pages[u] = { lm: wanted.get(u) || '', at: U.nowIso(), ok: false }; byUrl.delete(u); }
      else if (++errors >= 5 || e.status === 403 || e.status === 429) { opened++; if (o.save) await o.save(state()); throw new Error(`${U.hostOf(base)}: σταμάτησε μετά από ${opened} σελίδες (${e.message})`); }
    }
    opened++;
    if (o.save && Date.now() - lastSave > 20000) { await o.save(state()); lastSave = Date.now(); }
  }
  o.onProgress && o.onProgress(opened, todo.length, '');
  return state();
}

/** Can this shop be read through its site map? → { ok, sitemaps, sample } (opens at most 6 product pages). */
async function probe(c, opts) {
  const base = c.url.replace(/\/+$/, '');
  const maps = await findSitemaps(base, opts);
  if (!maps.length) return { ok: false, why: 'δεν έχει χάρτη του site' };
  const urls = [];
  const ctl = new AbortController();
  try {
    for (const m of maps) {
      await eachUrl(m, (loc) => { if (!otherLanguage(loc) && slugTokens(loc).size >= 3) { urls.push(loc); if (urls.length >= 400) ctl.abort(); } }, { signal: ctl.signal }).catch(() => {});
      if (urls.length >= 400) break;
    }
  } catch (_) { /* enough */ }
  if (!urls.length) return { ok: false, why: 'ο χάρτης του site δεν έχει σελίδες προϊόντων' };
  // a few pages spread over the list: product pages have the longest addresses
  const pick = urls.slice().sort((a, b) => b.length - a.length).filter((_, i) => i % Math.max(1, Math.floor(urls.length / 6)) === 0).slice(0, 6);
  let good = 0, sample = null;
  for (const u of pick) {
    try { const r = await http.get(u, { gap: 1200, timeout: 30000, retries: 0, signal: opts && opts.signal }); const p = productOf(r.text, u); if (p) { good++; sample = sample || p; } } catch (_) { /* next */ }
    if (good >= 2) break;
  }
  return good >= 2 ? { ok: true, sitemaps: maps, sample } : { ok: false, why: 'οι σελίδες προϊόντων δεν δείχνουν τιμή σε τυποποιημένη μορφή' };
}

module.exports = { sync, probe, productOf, eachUrl, findSitemaps, slugTokens, ldProducts };
