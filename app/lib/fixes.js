'use strict';
// Ready fixes, waiting for a yes. Whatever is missing or wrong, the program fills it in by itself HERE, in the
// program (never on the sites): each change says what, why, from where, and how sure it is.
//   high   — mechanical rules or a sure source (same EAN / code at the supplier, our own other site)
//   medium — probably right (match by name, spelling, type word, category): worth a look
// Nothing is guessed: no source → no proposal. Approved changes become ONE WooCommerce update file per site,
// with the product ID and only the changed columns.
//
// Sources of content, in order of trust: the same product on our other site, the supplier's price list / feed
// (code, EAN, description, photos), the supplier's product page (read politely, kept for 30 days), a page the
// user gives. Competitors' texts are never copied (their work, and duplicate content hurts SEO).
const crypto = require('crypto');
const store = require('./store');
const settings = require('./settings');
const U = require('./util');

const KEY = 'fixes';            // decisions: changeId -> { status, hash, at, by, edited }
const CACHE = 'enrich-cache';   // what was found for each product + the supplier pages read (re-readable: not in backups)
const PAGE_DAYS = 30;

const FIELD = {
  name: 'Τίτλος', desc: 'Περιγραφή', short: 'Σύντομη περιγραφή', images: 'Φωτογραφίες', brand: 'Μάρκα', gtin: 'EAN / GTIN',
  price: 'Τιμή', cats: 'Κατηγορία', published: 'Δημοσίευση', gla: 'Google Shopping', sku: 'Κωδικός (SKU)', varsku: 'Κωδικοί μεγεθών / χρωμάτων',
};
const GROUP = { name: 'titles', desc: 'content', short: 'content', images: 'content', brand: 'content', gtin: 'content', price: 'prices', cats: 'cats', published: 'ads', gla: 'ads', sku: 'codes', varsku: 'codes' };
const GROUPS = { codes: 'Κωδικοί (SKU)', content: 'Περιεχόμενο', titles: 'Τίτλοι', prices: 'Τιμές', cats: 'Κατηγορίες', ads: 'Διαφημίσεις' };

/** Meta description for Google: the text after the title heading, cut at ~155 characters on a word. */
function metaOf(html) { return require('./wooexport').metaDescription(String(html || '').replace(/^\s*<(h[1-6]|p)>(?:<strong>)?[^<]*(?:<\/strong>)?<\/\1>/i, ''), ''); }
const hashOf = (v) => crypto.createHash('sha1').update(JSON.stringify(v)).digest('hex').slice(0, 12);
const stripText = (html) => { const h = String(html || ''); return h ? U.collapse(U.stripTags(h)) : ''; };
/** Share of Greek letters among all letters (0..1): below ~0.3 the text is in English (or another language). */
function greekShare(text) {
  const t = String(text || '');
  let gr = 0, all = 0;
  for (let i = 0; i < t.length; i++) {
    const c = t.charCodeAt(i);
    if ((c >= 0x370 && c <= 0x3ff) || (c >= 0x1f00 && c <= 0x1fff)) { gr++; all++; } else if ((c >= 65 && c <= 90) || (c >= 97 && c <= 122) || (c >= 0xc0 && c <= 0xff)) all++;
  }
  return all ? gr / all : 1;
}
/** GTIN-8/12/13/14 with a correct check digit. */
function validGtin(s) {
  const g = String(s || '').replace(/\D/g, '');
  if (![8, 12, 13, 14].includes(g.length) || /^0+$/.test(g)) return '';
  let sum = 0;
  for (let i = 0; i < g.length - 1; i++) sum += Number(g[g.length - 2 - i]) * (i % 2 === 0 ? 3 : 1);
  return (10 - (sum % 10)) % 10 === Number(g[g.length - 1]) ? g : '';
}

function decisions() { return store.read(KEY, null) || {}; }
function cache() { const c = store.read(CACHE, null) || {}; c.products = c.products || {}; c.pages = c.pages || {}; return c; }

// ---------- what a product needs ----------
// What the description is like, worked out once per text (the description is kept compressed: opening it for
// every product at every pass would be slow). Kept on the product, not saved.
const NEED = new WeakMap(); // beside the products, not on them (an extra field on each product changes its shape: 1 KB each)
function textInfo(p) {
  // still about the same texts? (the texts themselves are compared, never copied: a copy of every compressed
  // description as a "key" cost 35 MB)
  const c = NEED.get(p);
  if (c && c.dz === p.descZ && c.sz === p.shortZ && c.name === p.name) return c;
  // products packed by this version carry the facts of their description; older ones are opened once
  let desc, gr;
  if (p.descHead !== undefined && p.descGr !== undefined) { desc = { length: p.descLen || 0, head: p.descHead }; gr = p.descGr; }
  else { const t = stripText(p.desc); desc = { length: t.length, head: t.slice(0, 200) }; gr = greekShare(t); }
  let onlyTitle = false;
  if (desc.length && desc.length <= p.name.length + 40) {
    const title = U.foldKey(p.name), fd = U.foldKey(desc.head);
    onlyTitle = fd.replace(/[^A-Z0-9Α-Ω ]/g, '').trim().length <= title.length + 12 && fd.includes(title.slice(0, Math.min(20, title.length)));
  }
  const info = { dz: p.descZ, sz: p.shortZ, name: p.name, len: desc.length, onlyTitle, english: desc.length >= 80 && gr < 0.3, greek: desc.length ? gr : 0, short: p.shortLen !== undefined ? p.shortLen > 0 : !!stripText(p.short) };
  NEED.set(p, info);
  return info;
}
function contentNeeds(p, s) {
  const ti = textInfo(p);
  const desc = { length: ti.len };
  // a "description" that is only the title again (checked only for short texts: it is cheap that way)
  const onlyTitle = ti.onlyTitle, english = ti.english;
  return {
    desc: !desc.length || desc.length < Math.max(300, s.descMinChars || 150) || onlyTitle || english,
    descWhy: !desc.length ? 'Δεν έχει περιγραφή' : onlyTitle ? 'Η περιγραφή επαναλαμβάνει μόνο τον τίτλο' : english ? 'Η περιγραφή είναι στα αγγλικά' : `Πολύ μικρή περιγραφή (${desc.length} χαρακτήρες)`,
    english, hasOwn: desc.length >= 40 && !onlyTitle && !english,
    short: !ti.short,
    images: (p.images || []).length < ((s.webResearch || {}).minImages || 3), // too few photos, not only none
    brand: !p.brand,
  };
}

// ---------- what must never reach our site from a supplier's text ----------
// Paragraphs / list items with the supplier's contacts, links, prices, "our shop", wholesale / B2B words
// are dropped (they are true for the supplier, wrong on our site).
// (checked without accents, in small letters: ΑΝΤΙΠΡΟΣΩΠΟΣ = αντιπρόσωπος = αντιπροσωπος)
const RISKY = /@|https?:\/\/|www\.|(?:\+?30\s?)?(?:^|\D)(?:2\d{9}|69\d{8})(?:\D|$)|\d{3}[\s.-]\d{3}[\s.-]\d{4}|τηλ[.:ε]|τηλεφων|επικοινων|χονδρικ|b2b|αντιπροσωπ|αποκλειστικ|e-?mail|καταστηματα μας|καταστημα μας|(?:^|[^α-ωa-z])τιμη(?:[^α-ωa-z]|$)|€|(?:^|[^a-z])eur(?:[^a-z]|$)|δωρεαν μεταφορικ|αποστολη σε|παραδοση σε|cookie|καλαθι|add to cart|in stock|σε αποθεμα|διαθεσιμοτητα|ημερες παραδοσης/;
const LEGAL = /\b(AE|EPE|IKE|OE|EE|LTD|GMBH|SA|SRL|INC|CO|ΑΕ|ΕΠΕ|ΙΚΕ|ΟΕ|ΕΕ)\b\.?/g;
const risky = (t) => RISKY.test(U.stripTonos(String(t || '')).toLowerCase());
function scrub(html, supName) {
  const name = U.foldKey(supName || '').replace(LEGAL, ' ').replace(/[^A-Z0-9Α-Ω ]/g, ' ').replace(/\s+/g, ' ').trim();
  const bad = (inner) => { const t = U.stripTags(inner); return risky(t) || (name.length >= 4 && (' ' + U.foldKey(t).replace(/[^A-Z0-9Α-Ω ]/g, ' ').replace(/\s+/g, ' ') + ' ').includes(' ' + name + ' ')); };
  let out = String(html || '').replace(/<(p|li|h[2-5]|blockquote)>([\s\S]*?)<\/\1>/g, (m, tag, inner) => (bad(inner) ? '' : m));
  out = out.replace(/<(ul|ol)>\s*<\/\1>/g, '').replace(/<table>[\s\S]*?<\/table>/g, (m) => (bad(m) ? '' : m));
  return out.trim();
}

// ---------- the description, in the shop's style ----------
// <h2>Title in Title Case</h2> + what the shop already wrote (kept) + the supplier's official text
// + a list: manufacturer, code, specs, features + the shop's footer (Settings → New products).
function buildDesc(p, data, own, fixedName) {
  const catalog = require('./catalog');
  const s = settings.all();
  const extract = require('./extract');
  const title = U.titleCase(fixedName || p.name, catalog.accents());
  const tag = ['h2', 'h3', 'p'].includes(s.newProduct.titleTag) ? s.newProduct.titleTag : 'h2';
  let html = tag === 'p' ? `<p><strong>${U.escapeHtml(title)}</strong></p>` : `<${tag}>${U.escapeHtml(title)}</${tag}>`;
  const ownHtml = own ? extract.cleanHtml(p.desc).replace(/^<h\d>[^<]*<\/h\d>/, '') : '';
  const ownText = U.foldKey(stripText(ownHtml));
  if (ownHtml) html += ownHtml;
  let official = data.descHtml ? scrub(extract.cleanHtml(data.descHtml), data.supplier) : '';
  if (official && ownText && ownText.length > 60 && U.foldKey(stripText(official)).includes(ownText.slice(0, 60))) official = ''; // already there
  if (official) html += official;
  const have = U.foldKey(stripText(html));
  const li = [];
  const brand = p.brand || data.brand;
  if (brand && !/ΚΑΤΑΣΚΕΥΑΣΤΗΣ|MANUFACTURER|BRAND/.test(have)) li.push(`Κατασκευαστής: ${U.escapeHtml(brand)}`);
  if (p.sku && !have.includes(U.foldKey(p.sku))) li.push(`Κωδικός: ${U.escapeHtml(p.sku)}`);
  for (const sp of (data.specs || []).slice(0, 15)) if (!have.includes(U.foldKey(sp.v)) && !risky(sp.k + ' ' + sp.v)) li.push(`${U.escapeHtml(sp.k)}: ${U.escapeHtml(sp.v)}`);
  for (const f of (data.features || []).slice(0, 12)) if (!have.includes(U.foldKey(f).slice(0, 40)) && !risky(f)) li.push(U.escapeHtml(f));
  if (li.length) html += `<ul>${li.map((x) => `<li>${x}</li>`).join('')}</ul>`;
  if (s.newProduct.footer && !have.includes(U.foldKey(s.newProduct.footer).slice(0, 30))) html += `<p>${U.escapeHtml(s.newProduct.footer)}</p>`;
  return html;
}
/** Short description: the 3–6 facts a customer looks for next to the price. */
function buildShort(p, data, sizes) {
  const facts = [];
  for (const f of (data.features || []).filter((x) => x.length <= 90 && !risky(x)).slice(0, 3)) facts.push(U.escapeHtml(f));
  if (!facts.length) for (const sp of (data.specs || []).filter((x) => !risky(x.k + ' ' + x.v)).slice(0, 3)) facts.push(`${U.escapeHtml(sp.k)}: ${U.escapeHtml(sp.v)}`);
  if (sizes.length) facts.push(`Μεγέθη: ${U.escapeHtml(sizes.join(', '))}`);
  if (!facts.length) return ''; // only brand and code: not worth a box
  const brand = p.brand || data.brand;
  // (no product code here: this text stands right under the title — the code has its own field and its line in the description)
  const pts = (brand ? [`Κατασκευαστής: ${U.escapeHtml(brand)}`] : []).concat(facts);
  return `<ul>${pts.map((x) => `<li>${x}</li>`).join('')}</ul>`;
}
function sizesOf(site, p) {
  if (p.type !== 'variable') return [];
  const catalog = require('./catalog');
  const out = [];
  for (const v of catalog.load(site).products) {
    if (v.type !== 'variation' || v.parent !== p.id) continue;
    const m = String(v.varLabel || '').match(/(?:μέγεθος|μεγεθος|νούμερο|νουμερο|size)[^:]*:\s*([^,]+)/i);
    if (m && !out.includes(m[1].trim())) out.push(m[1].trim());
  }
  return out.slice(0, 20);
}
/**
 * The shops that sell the SAME product (from the price research): only offers proven by the same code or EAN, or
 * confirmed by a person — never a match by words alone. → [{ shop, url, brand, ean, img, proof }]
 */
function witnessesFor(C, site, pid) {
  if (!C.market) return [];
  let e = C.market[site + ':' + pid];
  if (!e && site === 'st') { const sfId = C.L.stToSf.get(pid); if (sfId != null) e = C.market['sf:' + sfId]; }
  if (!e || !Array.isArray(e.competitors)) return [];
  const out = [];
  for (const c of e.competitors) {
    if (c.ignored || c.manual || c.web || c.match !== 'exact') continue; // (the internet's are counted on their own: webHits)
    let proof = c.confirmed ? 'το επιβεβαίωσες εσύ' : c.how === 'ean' ? 'ίδιο EAN' : c.how === 'sku' ? 'ίδιος κωδικός' : '';
    // matched by the words of the title (brand + model): good enough for a code or a photo to look at, never for sure
    const byWords = !proof && (c.ev || []).includes('ίδια μάρκα') && (c.ev || []).some((x) => /^λέξεις μοντέλου/.test(x));
    if (byWords) proof = 'ίδια μάρκα και μοντέλο';
    if (!proof) continue;
    // «exact»: the whole code, the EAN, or a person's yes — not only the base of a code (that one is shared by every
    // colour and size of a model: good enough for the brand, never for an EAN or a photo)
    const ev = c.ev || [];
    const exact = !!c.confirmed || c.how === 'ean' || ev.includes('ίδιος κωδικός');
    out.push({ shop: c.shop, url: c.url, brand: c.brand || '', ean: c.ean || '', img: c.img || '', proof: exact || c.how !== 'sku' || byWords ? proof : 'ίδιος κωδικός μοντέλου', exact: exact && !byWords, byWords, name: c.name || '', code: c.mpn || c.sku || '' });
  }
  return out;
}
/** A brand as the shop writes it: one of its known brands when the names agree («511 TACTICAL SERIES» → «5.11 TACTICAL»). */
function brandName(raw, known) {
  const t = U.collapse(U.decodeEntities(String(raw || '')));
  const k = U.foldKey(t).replace(/[^A-Z0-9Α-Ω]/g, '');
  if (k.length < 2 || /^(BRAND|NOBRAND|ΧΩΡΙΣ|GENERIC|OEM|ΔΙΑΦΟΡΑ)$/.test(k)) return null;
  let best = null;
  for (const [fk, name] of known) {
    const kk = fk.replace(/[^A-Z0-9Α-Ω]/g, '');
    if (kk.length < 2) continue;
    if (kk === k || (kk.length >= 4 && k.startsWith(kk) && k.length - kk.length <= 8)) { if (!best || kk.length > best.kk.length) best = { kk, name }; }
  }
  return best ? { key: best.kk, name: best.name, known: true } : { key: k, name: t, known: false };
}
/** The full photo instead of a shop's small copy (WordPress «-300x300», Shopify «_200x»). */
/**
 * Is a shop's offer close enough to take its EAN or photo? → 'sure' | 'maybe' | false. The whole code (or the EAN) is the same, or the base of
 * the code is the same AND both titles name the same colour (the base alone is shared by every colour and size).
 */
function safeWitness(p, w) {
  if (!sameColours(p.name, w.name)) return false;
  if (w.exact) return 'sure';
  const m = require('./market');
  if (m.coloursOf(p.name).size > 0 && m.coloursOf(w.name).size > 0) return 'sure';
  // our title names no colour: maybe a product in one colour, maybe not — at most «look at it»
  return m.coloursOf(p.name).size === 0 ? 'maybe' : false;
}
/** The sizes / colours of a product that have no code yet (WooCommerce variations), by product. */
function variationsOf(C, site) {
  C.vars = C.vars || {};
  if (!C.vars[site]) {
    const m = new Map();
    for (const v of require('./catalog').load(site).products) if (v.type === 'variation') { if (!m.has(v.parent)) m.set(v.parent, []); m.get(v.parent).push(v); }
    C.vars[site] = m;
  }
  return C.vars[site];
}
/**
 * A code for every size / colour without one: the product's code and the values of the variation, in Latin letters
 * («SF-24761-XL», «K07014-MAVRO-42»). The same labels give the same codes on both sites. → [{ id, label, sku }]
 */
/**
 * A code that is not a code: a WordPress copy of a product writes the moment of the copy at its end
 * (K16107-1755357657, 58-1756480828: «-» + ten digits of a date between 2017 and 2033). → the code before it, or ''.
 */
function junkSku(sku) { return U.junkSku(sku); }
/**
 * The code of a size / colour that is its own size with a number of a copy after it (44-4147, 46-68529, 58-1756480828):
 * not a code of the maker. Seen 24/11 on ΠΑΝΤΕΛΟΝΙ PENTAGON BDU ARCTIC: 9 of the 12 sizes were caught, these 3 were not.
 */
function sizeJunk(v) {
  const m = String((v && v.sku) || '').trim().match(/^(.+?)[-_ ](\d{3,})$/);
  if (!m) return false;
  const want = variantWant(v.varLabel);
  const head = U.normSku(U.greeklish(m[1]));
  return !!head && (head === want.size || [...String(v.varLabel || '').split(',')].some((x) => U.normSku(U.greeklish(x.slice(x.indexOf(':') + 1).trim())) === head));
}
/**
 * A product's code that is the code of ANOTHER product of the shop with «-1», «-2» after it: what WordPress writes when a
 * product is copied (ΠΑΝΤΕΛΟΝΙ PENTAGON BDU ARCTIC PANTS K05068 has «K05001-2.0-MC-1»: the code of the BDU 2.0
 * MULTICAM it was copied from). Never «the product's code» for its sizes. → the other product, or null.
 */
function copiedFrom(C, site, p) {
  // (one digit 1–9, as WordPress writes it — never «-01» / «-16»: a maker's colour or length, K17140-STL-01, TSR-16)
  const m = String((p && p.sku) || '').trim().match(/^(.+?)\s*-([1-9])$/);
  if (!m || !C.skuOwner) return null;
  const o = C.skuOwner[site] && C.skuOwner[site].get(U.normSku(m[1]));
  return o && o.id !== p.id ? o : null;
}
/** «Μέγεθος: 43 (UK8 1/2), Χρώμα: Μαύρο» → { size: '43UK812', colours: Set } (what a shop's variant must match). */
function variantWant(label) {
  const parts = String(label || '').split(',').map((x) => x.trim()).filter(Boolean);
  let size = '', colourText = '';
  for (const x of parts) {
    const k = x.includes(':') ? x.slice(0, x.indexOf(':')) : '', v = x.includes(':') ? x.slice(x.indexOf(':') + 1).trim() : x;
    if (/χρώμ|χρωμ|colou?r/i.test(k)) colourText += ' ' + v; else if (!size) size = U.normSku(U.greeklish(v));
  }
  return { size, colours: require('./market').coloursOf(colourText) };
}
/**
 * «One code for the whole product» (the shop's rule when no other shop shows a real code for a size / colour): the
 * sizes / colours whose code is not a code — the date of a copy (60-1755476639), the same code twice, or our own code
 * with the size at its end (K05068-54) — lose it, and show the product's code. Never a new code. Those with a real
 * code from other shops (`ev`) are left to that proposal. → [{ id, label, sku: '', was, srcs: [] }]
 */
function unifyCodes(C, site, p, code, ev) {
  const all = variationsOf(C, site).get(p.id) || [];
  const count = new Map();
  for (const v of all) if (v.sku) count.set(U.normSku(v.sku), (count.get(U.normSku(v.sku)) || 0) + 1);
  const own = U.normSku(code || '');
  const done = new Set((ev || []).map((v) => v.id));
  return all.filter((v) => {
    const k = U.normSku(v.sku || '');
    if (!k || done.has(v.id)) return false;
    return !!junkSku(v.sku) || sizeJunk(v) || count.get(k) > 1 || (own.length >= 4 && k !== own && k.startsWith(own)) || (own.length >= 4 && k === own);
  }).map((v) => ({ id: v.id, label: v.varLabel || '', sku: '', was: String(v.sku || ''), srcs: [] }));
}
/**
 * The codes of a product's sizes / colours that have none (or a «code» that is the date of a copy, or the same code
 * twice) — ONLY from other shops that show the same product with that very size / colour and its code: the same code
 * at two independent sites at least. Never made from our own code (no K07014-XL, no P-B-10-M): a code nobody shows is
 * not a code. → [{ id, label, sku, was, srcs: [{ host, url }] }]
 */
function variationCodes(C, site, p, code, hits) {
  if (settings.all().variantSku === 'same') return []; // one code for the product and all its sizes / colours
  const all = variationsOf(C, site).get(p.id) || [];
  const count = new Map();
  for (const v of all) if (v.sku) count.set(U.normSku(v.sku), (count.get(U.normSku(v.sku)) || 0) + 1);
  const bad = (v) => !String(v.sku || '').trim() || !!junkSku(v.sku) || sizeJunk(v) || count.get(U.normSku(v.sku)) > 1 || (code && U.normSku(v.sku) === U.normSku(code));
  const vs = all.filter(bad);
  if (!vs.length) return [];
  let H = hits;
  if (!H) { try { H = webHits(C, site, p); } catch (_) { H = []; } }
  const taken = new Set();
  for (const v of all) if (v.sku && !bad(v)) taken.add(U.normSku(v.sku));
  const m = require('./market');
  const out = [];
  for (const v of vs) {
    const want = variantWant(v.varLabel);
    if (!want.size && !want.colours.size) continue;
    const votes = new Map();
    for (const h of H || []) {
      for (const x of h.variants || []) {
        const sku = String(x.sku || '').trim();
        if (!sku || junkSku(sku) || !/\d/.test(sku)) continue;
        if (want.size && U.normSku(U.greeklish(x.size || '')) !== want.size) continue;
        if (want.colours.size && ![...m.coloursOf(x.colour || '')].some((c) => want.colours.has(c))) continue;
        const k = U.normSku(sku);
        const e = votes.get(k) || { sku, hosts: new Map() };
        if (!e.hosts.has(U.siteOf(h.host))) e.hosts.set(U.siteOf(h.host), h.url);
        votes.set(k, e);
      }
    }
    const ranked = [...votes.values()].sort((a, b) => b.hosts.size - a.hosts.size);
    const top = ranked[0];
    // two independent sites at least, nobody else disagreeing as strongly, not a code already used here
    if (!top || top.hosts.size < 2 || (ranked[1] && ranked[1].hosts.size >= top.hosts.size) || taken.has(U.normSku(top.sku)) || C.skus[site].has(U.normSku(top.sku))) continue;
    taken.add(U.normSku(top.sku));
    out.push({ id: v.id, label: v.varLabel || '', sku: top.sku, was: String(v.sku || ''), srcs: [...top.hosts].map(([host, url]) => ({ host, url })) });
  }
  return out;
}
/** What the shops of the internet say about a product (lib/codefind.js); the same product on SpecialForces counts for the ads site. */
function webHits(C, site, p) {
  if (!C.web) C.web = (store.read('web-codes', null) || {}).products || {};
  let e = C.web[site + ':' + p.id];
  if (!e && site === 'st') { const sfId = C.L.stToSf.get(p.id); if (sfId != null) e = C.web['sf:' + sfId]; }
  return e && Array.isArray(e.hits) ? e.hits : [];
}
/**
 * A product code as shops write it, cleaned: the first word of «8020860 Katadyn BeFree…»; never an EAN, a long
 * internal number of a shop (10+ digits), or a word without digits. For a product with sizes/colours: the model part.
 */
function codeOf(raw, variable) {
  let t = U.collapse(U.decodeEntities(String(raw || ''))).replace(/[–—]/g, '-');
  if (!t) return '';
  const words = t.split(' ');
  if (words.length > 2) t = words[0];
  if (t.length < 3 || t.length > 40 || !/\d/.test(t)) return '';
  if (/^\d+$/.test(t) && (t.length >= 9 || t.length <= 3)) return '';
  if (validGtin(t)) return '';
  if (/\.vs\d+$/i.test(t)) return ''; // a shop's own number for a variation (amerikaniki-agora: «3498.vs1»), not the maker's code
  if (junkSku(t)) return ''; // the date of a copy at its end (Mora-1755379572): not a code
  if (variable) { const cb = require('./market').codeBase(t); if (cb && cb.base.length >= 4 && cb.base !== U.normSku(t)) return baseText(t, cb.base); }
  return t;
}
/** The part of a written code that makes its base (K09012-01 → K09012, MORA-12210-B → MORA-12210). */
function baseText(t, base) {
  let acc = '';
  for (let i = 0; i < t.length; i++) { const ch = t[i].toUpperCase(); if (/[A-Z0-9]/.test(ch)) acc += ch; if (acc === base) return t.slice(0, i + 1); }
  return t;
}
/** No colour named on one side that the other does not name (a black and a green bag share the model, not the EAN). */
function sameColours(a, b) {
  const m = require('./market');
  const ca = m.coloursOf(a), cb = m.coloursOf(b);
  if (!ca.size || !cb.size) return true;
  for (const c of ca) if (cb.has(c)) return true;
  return false;
}
function fullImage(u) { return String(u || '').replace(/-\d{2,4}x\d{2,4}(?=\.(jpe?g|png|webp|gif)(\?|$))/i, '').replace(/_\d{2,4}x(?=\.(jpe?g|png|webp|gif)(\?|$))/i, ''); }
function imageKey(u) { return require('./market').imageKey(u); }
function sameImage(a, b) { const k = (u) => String(u || '').replace(/\?.*$/, '').replace(/-\d{2,4}x\d{2,4}(?=\.\w+$)/, '').toLowerCase().split('/').pop(); return k(a) === k(b); }

/**
 * The category of similar products, for products that are only in the general category: the categories of
 * the shop's products whose title starts with the same type word (same brand counts more), plus the
 * categories named after the type (ΣΑΚΙΔΙΟ → ΣΑΚΙΔΙΑ). Built once per site, answers are remembered.
 */
function categoryGuesser(site, isDefault) {
  const catalog = require('./catalog');
  const idx = catalog.categoryIndex(site);
  let keyed = null, catWords = null;
  const prepare = () => {
    keyed = catalog.load(site).products.filter((p) => p.type !== 'variation' && (p.cats || []).some((c) => !isDefault(c))).map((p) => ({ t: U.foldKey(p.name), b: U.foldKey(p.brand || ''), cats: p.cats.filter((c) => !isDefault(c)) }));
    catWords = idx.cats.filter((c) => !isDefault(c.id)).map((c) => ({ id: c.id, words: U.foldKey(c.name).split(/[\s\-–/,]+/) }));
  };
  const memo = new Map();
  return (typeRaw, brandRaw) => {
    const type = U.foldKey(typeRaw), brand = U.foldKey(brandRaw || '');
    const mk = type + '|' + brand;
    if (memo.has(mk)) return memo.get(mk);
    if (!keyed) prepare();
    const score = new Map();
    for (const k of keyed) {
      if (k.t !== type && !k.t.startsWith(type + ' ')) continue;
      for (const c of k.cats) score.set(c, (score.get(c) || 0) + 2 + (brand && k.b === brand ? 1 : 0));
    }
    const word = type.split(' ')[0] || '';
    if (word.length >= 4) { const stem = word.slice(0, Math.max(4, word.length - 2)); for (const c of catWords) if (c.words.some((w) => w.startsWith(stem))) score.set(c.id, (score.get(c.id) || 0) + 3); }
    const best = [...score.entries()].filter(([id]) => idx.byId.has(id)).sort((a, b) => b[1] - a[1] || idx.pathOf(b[0]).length - idx.pathOf(a[0]).length)[0];
    const res = best ? { id: best[0], path: idx.pathOf(best[0]).join(' › '), score: best[1] } : null;
    memo.set(mk, res);
    return res;
  };
}

// ---------- proposals ----------
// The heavy part: what the program proposes for every product, from the catalogs, the checks and the sources.
// It knows nothing about decisions (yes / no): those, and the "ignore" marks, are laid over it by compute(). So a
// yes never recalculates anything here — on a small cloud machine that used to take half a minute per approval.
const bg = require('./bg');
const TITLE_CHECKS = ['broken', 'mixed', 'typos', 'suspect', 'typefirst', 'caps', 'accents', 'spaces', 'codetitle'];
const MIRROR = ['name', 'desc', 'short', 'images', 'brand', 'gtin', 'sku'];
const QK = ['desc', 'images', 'brand', 'short', 'title', 'sku'];
const QW = [30, 25, 10, 10, 15, 10];

let prop = null;      // { at, cacheAt, byProduct: Map('site:pid' → items), tw, q, qv, rev }
let dirty = false;    // the data changed: build again
let lazy = false;     // server: keep answering from the last result while the new one is built in the background
let onDirty = null;
let ctx = null;       // what the proposals of one product need (kept to refresh single products)
let memo = null;      // the proposals with the decisions laid over them
function setLazy(on, fn) { lazy = !!on; onDirty = fn || null; }
function invalidate() { dirty = true; ctx = null; if (onDirty) onDirty('fixes'); }
/**
 * The same, at most once every `ms` (the research on the internet hands in a few products every few seconds, from
 * 12 runners at once: on the small cloud machine each rebuild of the proposals takes ~90 s — seen 24/11 on /ping as
 * «Έτοιμες διορθώσεις…» without end, the program slow for everyone). Not in the background engine: at once.
 */
let soonTimer = null;
function invalidateSoon(ms) {
  if (!lazy || !(ms > 0)) return invalidate();
  dirty = true;
  if (soonTimer) return;
  soonTimer = setTimeout(() => { soonTimer = null; invalidate(); }, ms);
  if (soonTimer.unref) soonTimer.unref();
}
function isDirty() { return dirty || !prop; }

/**
 * How sure a proposal is, in %, from where it comes and how many sources agree: a rule of the shop or our own other
 * site 97–99; a sure source 90–96 (+2 for each other source that says the same); «look at it» 60–85.
 */
function confidenceOf(c) {
  const kinds = [c.source && c.source.kind].concat((c.sources || []).map((x) => x && x.kind)).filter(Boolean);
  const n = 1 + (c.sources || []).length;
  if (kinds.includes('rule') || kinds.includes('mirror')) return 98;
  if (kinds.includes('twin')) return 97;
  if (c.level === 'high') return Math.min(96, 90 + 2 * (n - 1) + (kinds.includes('supplier') ? 2 : 0));
  return Math.min(85, 70 + 5 * (n - 1) + (kinds.includes('supplier') ? 5 : 0));
}
/**
 * Where a proposal comes from, in four kinds people can tell apart (asked 24/11: «τι βρέθηκε από το site, τι από κανόνες,
 * τι από τι κατάλαβες»): rules of the shop · the data of our site itself · other sites (supplier first, our other site,
 * shops, internet) · what the program worked out (similar products, AI) · a person's own change.
 */
const ORIGINS = { rules: 'Κανόνες', site: 'Δεδομένα του site', sources: 'Αντιπρόσωποι & άλλα sites', infer: 'Συμπέρασμα', mine: 'Δικές σου' };
function originOf(c) {
  const k = (c.source && c.source.kind) || ((c.sources || [])[0] || {}).kind || '';
  if (k === 'manual') return 'mine';
  if (k === 'site') return 'site';
  if (['supplier', 'twin', 'competitor', 'web', 'page'].includes(k)) return 'sources';
  if (k === 'ai' || /παρόμοια προϊόντα|AI/.test((c.source && c.source.label) || '')) return 'infer';
  if (k === 'rule' || k === 'mirror') return c.field === 'varsku' || c.field === 'sku' ? 'site' : 'rules';
  return k ? 'sources' : 'rules';
}
const finish = (c) => { c.id = `${c.site}:${c.pid}:${c.field}`; c.group = GROUP[c.field]; c.label = FIELD[c.field]; c.hash = hashOf(c.to); c.confidence = confidenceOf(c); c.origin = originOf(c); return c; };

function buildCtx() {
  const catalog = require('./catalog');
  const checks = require('./checks');
  const wx = require('./wooexport');
  const L = catalog.links();
  const C = { manual: store.read(MANUAL, null) || {}, s: settings.all(), L, ec: cache(), ign: checks.ignored(), banned: catalog.bannedOnAds(), sites: {}, price: new Map(), tw: new Map(), market: store.read('market', null) || {}, brands: catalog.knownBrands(), skus: { sf: new Set(), st: new Set() } };
  C.skuOwner = { sf: new Map(), st: new Map() }; // code → the product (not a variation) that has it
  for (const st of catalog.SITES) for (const x of catalog.load(st).products) if (x.sku) { C.skus[st].add(U.normSku(x.sku)); if (x.type !== 'variation') C.skuOwner[st].set(U.normSku(x.sku), x); }
  for (const site of catalog.SITES) {
    const cat = catalog.load(site);
    if (!cat.syncedAt) continue;
    const other = site === 'sf' ? 'st' : 'sf';
    const idx = catalog.categoryIndex(site);
    const isDefault = (id) => { const cc = idx.byId.get(id); return !cc || /^(uncategorized|default|xoris-katigoria|χωρις-κατηγορια|genika)$/i.test(String(cc.slug || '')) || /^(uncategorized|χωρις κατηγορια)$/i.test(U.stripTonos(cc.name).toLowerCase()); };
    C.sites[site] = { cat, other, oById: catalog.byId(other), map: site === 'sf' ? L.sfToSt : L.stToSf, title: checks.titleContext(site), idx, isDefault, attrBrands: !wx.usesBrandTaxonomy(site), guessCat: categoryGuesser(site, isDefault), seo: wx.seoColumns(wx.seoMode(site)) };
  }
  // prices: the two sites must agree (the reference site wins)
  for (const it of (checks.raw().checks.find((c) => c.id === 'x-price') || { items: [] }).items) C.price.set(it.site + ':' + it.id, it);
  return C;
}

/** Every proposal for one product (no status yet). */
// a person's own change written on the product's page (title, short text, description): it IS the approval;
// it waits in Διορθώσεις with the rest until the file for the site is made. { 'site:id': { name|short|desc: { to, at, by } } }
const MANUAL = 'fixes-manual';
const MANUAL_FIELDS = ['name', 'short', 'desc'];
function proposalsFor(site, p, C) {
  const list = proposalsFor0(site, p, C);
  const man = (C.manual || {})[site + ':' + p.id];
  if (!man) return list;
  const out = list.filter((c) => !(man[c.field] && MANUAL_FIELDS.includes(c.field)));
  for (const f of MANUAL_FIELDS) {
    const m = man[f];
    if (!m) continue;
    const cur = f === 'name' ? p.name : f === 'short' ? p.short : p.desc;
    const val = f === 'desc' ? (m.to && m.to.html) || '' : m.to;
    if (U.collapse(stripText(String(cur || ''))) === U.collapse(stripText(String(val || '')))) continue; // the site has it already
    out.push(finish({ site, pid: p.id, name: p.name, img: p.thumb || (p.images || [])[0] || '', url: p.url, sku: p.sku, type: p.type, field: f, from: f === 'desc' ? '' : String(cur || ''), to: m.to, manual: true,
      why: 'Η αλλαγή γράφτηκε από ' + (m.by || 'εσένα') + ' στη σελίδα του προϊόντος.', source: { kind: 'manual', label: 'Από ' + (m.by || 'εσένα') }, level: 'high' }));
  }
  return out;
}
/** Write a person's own change (it counts as approved) → the proposal as the screens show it. */
function setManual(site, pid, field, value, by) {
  if (!MANUAL_FIELDS.includes(field)) throw new Error('Αυτό το πεδίο δεν αλλάζει από εδώ.');
  const c0 = { field, to: field === 'desc' ? { html: '', meta: '' } : '' };
  const to = editedValue(c0, value);
  const key = site + ':' + Number(pid);
  store.update(MANUAL, {}, (d) => { d[key] = Object.assign({}, d[key], { [field]: { to, at: U.nowIso(), by: by || '' } }); return d; });
  const id = `${key}:${field}`;
  store.update(KEY, {}, (d) => { d[id] = { status: 'approved', hash: hashOf(to), at: U.nowIso(), by: by || '' }; return d; });
  refreshProduct(site, Number(pid));
  return { id, to };
}
function proposalsFor0(site, p, C) {
  const catalog = require('./catalog');
  const checks = require('./checks');
  const S = C.sites[site];
  const { title: ctx, isDefault, guessCat, map, oById, seo, attrBrands, other } = S; // eslint-disable-line no-shadow
  const s = C.s, ec = C.ec;
  const key = site + ':' + p.id;
  const list = [];
  const add = (c) => { list.push(finish(c)); };
  const ignoredIn = (id) => { const arr = C.ign[id]; return !!arr && arr.includes(key); };
  const base = { site, pid: p.id, name: p.name, img: p.thumb || (p.images || [])[0] || '', url: p.url, sku: p.sku, type: p.type };
  // ads site: what Google / Meta do not allow. A product that is not allowed there only gets "take it off the site":
  // no text, photo, price or title is ever asked for it.
  let adLevel = '', adWhy = '';
  if (site === 'st') {
    const oid = map.get(p.id);
    const ad = catalog.adStatus(site, p, oid ? oById.get(oid) : null, other);
    adLevel = ad.level; adWhy = ad.why;
    if (ad.level === 'banned') {
      if (!ignoredIn('st-ads-banned')) add(Object.assign({}, base, { field: 'published', ign: ['st-ads-banned'], from: 'Δημοσιευμένο', to: -1, why: `Απαγορεύεται σε Google και Meta (${ad.why}): γίνεται «Πρόχειρο» στο ${s.sites.st.name}, δεν διαγράφεται. Στο ${s.sites.sf.name} μένει κανονικά.`, source: { kind: 'rule', label: 'Κανόνες διαφημίσεων Google / Meta' }, level: 'high' }));
      return list;
    }
  }
    // titles: every rule of the checks, combined into one corrected title
    let fixedName = '';
    if (!TITLE_CHECKS.some((k) => ignoredIn(site + '-' + k))) {
      const tf = checks.titleFix(p, ctx);
      if (tf.fix && tf.fix !== p.name && tf.steps.length) {
        fixedName = tf.fix;
        add(Object.assign({}, base, { field: 'name', ign: TITLE_CHECKS.map((k) => site + '-' + k), from: p.name, to: tf.fix, why: tf.steps.map((x) => x.why).join(' · '), source: { kind: 'rule', label: 'Κανόνες τίτλων του καταστήματος' }, level: tf.steps.some((x) => x.level === 'medium') ? 'medium' : 'high' }));
      }
    }
    // category: only in the general category → the category of similar products (same type word)
    if ((!p.cats.length || p.cats.every(isDefault)) && !ignoredIn(site + '-nocat')) {
      // the type word: the first Greek word of the title (5.11 TACTICAL ΜΠΟΥΦΑΝ … → ΜΠΟΥΦΑΝ)
      // the kind: the word the (corrected) title starts with, or what a trade name proves (12ΒΟΛΑ → ΦΥΣΙΓΓΙΑ)
      const kn = require('./kinds');
      const t0 = fixedName || p.name;
      const comp = kn.startsWithoutKind(t0) ? kn.compound(t0) : null;
      const type = comp ? comp.kind : (U.greekUpper(t0).match(/[Α-Ω]{3,}(?:\s[Α-Ω]{3,})?/) || [''])[0];
      const sug = type ? guessCat(type, p.brand) : null;
      if (sug && sug.score >= 6) add(Object.assign({}, base, { field: 'cats', ign: [site + '-nocat'], from: (p.catNames || []).join(', ') || '—', to: { id: sug.id, path: sug.path }, why: `Είναι μόνο στη γενική κατηγορία. Προϊόντα «${type}» είναι στην «${sug.path}».`, source: { kind: 'rule', label: 'Από παρόμοια προϊόντα του καταστήματος' }, level: 'medium' }));
    }
    // ads site, Google Shopping only
    if (adLevel === 'google' && !ignoredIn('st-ads-google')) add(Object.assign({}, base, { field: 'gla', ign: ['st-ads-google'], from: 'Στο Google Shopping', to: 'dont-sync-and-show', why: `Το Google δεν το δέχεται (${adWhy}): μένει στο site, βγαίνει από το Google Shopping.`, source: { kind: 'rule', label: 'Κανόνες διαφημίσεων Google' }, level: 'high' }));
    // content: description, short description, photos, brand, EAN — only from a real source
    const need = contentNeeds(p, s);
    const found = ec.products[site + ':' + p.id];
    const twin = (() => { const oid = map.get(p.id); return oid ? oById.get(oid) : null; })();
    // our other site already has a good text / more photos: the safest source of all (our own work)
    const twinDesc = need.desc && !need.hasOwn && twin && textInfo(twin).len >= 300 && textInfo(twin).greek >= 0.3 ? twin.desc : '';
    if (need.desc && twinDesc && !need.hasOwn) {
      add(Object.assign({}, base, { field: 'desc', lazyFrom: true, to: { html: twinDesc, meta: seo ? metaOf(twinDesc) : '' }, why: need.descWhy + `. Το ίδιο προϊόν στο ${s.sites[other].name} έχει πλήρη περιγραφή.`, source: { kind: 'twin', label: 'Από το ' + s.sites[other].name, url: twin.url }, level: 'high' }));
    } else if (need.desc && found && found.data && stripText(scrub(found.data.descHtmlEl || found.data.descHtml, found.data.supplier)).length >= 80) {
      const html = buildDesc(p, Object.assign({}, found.data, found.data.descHtmlEl ? { descHtml: found.data.descHtmlEl } : {}), need.hasOwn, fixedName);
      const englishSrc = !found.data.descHtmlEl && greekShare(stripText(found.data.descHtml)) < 0.3;
      add(Object.assign({}, base, { field: 'desc', lazyFrom: true, to: { html, meta: seo ? metaOf(html) : '' }, why: need.descWhy + '.' + (englishSrc ? ' Το κείμενο του αντιπροσώπου είναι στα αγγλικά: μετάφρασέ το (AI) ή κράτα το.' : '') + (found.data.descHtmlEl ? ' Μετάφραση με AI: διάβασέ τη πριν την έγκριση.' : ''), source: found.src, level: found.src.level === 'high' && !englishSrc && !found.data.descHtmlEl ? 'high' : 'medium', english: englishSrc }));
    }
    if (need.short && found && found.data) {
      const sh = buildShort(p, found.data, sizesOf(site, p));
      if (sh) add(Object.assign({}, base, { field: 'short', lazyFrom: true, to: sh, why: 'Δεν έχει σύντομη περιγραφή: τα βασικά δίπλα στην τιμή βοηθούν τον πελάτη να αποφασίσει.', source: found.src, level: found.src.level }));
    }
    // ---- several sources, one answer ----
    // Besides the supplier, the shops that sell THE SAME product (proven by the same code or EAN in the price research,
    // or confirmed by a person) are witnesses: what they agree on (brand, EAN, the maker's photo) is proposed, with every
    // source named and a confidence that grows with the agreement. Their texts are never copied (their work, and the
    // same text on two shops hurts both in Google).
    const wit = witnessesFor(C, site, p.id);
    // photos from ONE source: our other site first (our own photos), else the supplier's, else the same product at other shops
    const extraImgs = [];
    let fromTwin = false, imgSource = null, imgLevel = 'medium', imgWhy = '';
    const imgAlso = [];
    if (need.images) {
      const twinMore = twin && (twin.images || []).length > (p.images || []).length;
      fromTwin = !!twinMore;
      // (a page found by the older photo research: its photos only when its title shows OUR colour — it took a whole gallery)
      const oldResearch = found && found.src && found.src.kind === 'research' && !(require('./market').coloursOf(p.name).size === 0 ? require('./market').coloursOf(found.data.name || '').size <= 1 : sameColours(p.name, found.data.name || '') && require('./market').coloursOf(found.data.name || '').size > 0);
      let cand = twinMore ? twin.images : found && found.data && !oldResearch ? found.data.images || [] : [];
      if (fromTwin) { imgSource = { kind: 'twin', label: 'Από το ' + s.sites[other].name, url: twin.url }; imgLevel = 'high'; }
      else if (cand.length) { imgSource = found.src; imgLevel = found.src.level; }
      else if ((p.images || []).length < ((s.webResearch || {}).minImages || 3)) {
        // only the photo of a shop that has the SAME product (code / EAN, or brand + model + colour), never of a look-alike
        const byKey = new Map();
        for (const w of wit) { const safe = safeWitness(p, w); if (!safe) continue; const u = fullImage(w.img); if ((p.images || []).some((x) => sameImage(x, u))) continue; const k = imageKey(u); if (!u || !k) continue; const e = byKey.get(k) || { u, shops: [] }; if (!e.shops.some((x) => x.shop === w.shop)) e.shops.push(w); if (safe === 'maybe' || w.byWords) e.weak = true; byKey.set(k, e); }
        // …and the shops of the internet with the same product (each photo of their page; the same file at two shops = the maker's)
        for (const hh of webHits(C, site, p)) {
          // only photos the research tied to OUR variant (its own photos, a one-colour page in our colour, or the file
          // name says our colour): an older result without that knowledge gives none (it is researched again)
          if (!hh.imgHow || hh.imgHow === 'none' || hh.match === 'code') continue;
          const w = { shop: hh.host, url: hh.url, name: hh.name, web: true, exact: hh.how === 'code' || hh.how === 'ean', proof: hh.how === 'ean' ? 'ίδιο EAN, internet' : hh.how === 'code' ? 'ίδιος κωδικός, internet' : 'ίδιο προϊόν, internet' };
          const safe = safeWitness(p, w);
          if (!safe) continue;
          for (const u0 of (hh.images || []).slice(0, 4)) {
            // (a short file name has no «maker's file» key: the address itself is its key — never dropped silently)
            const u = fullImage(u0); const k = imageKey(u) || String(u).split('?')[0].toLowerCase();
            if (!u || !k || (p.images || []).some((x) => sameImage(x, u))) continue;
            const e = byKey.get(k) || { u, shops: [] };
            if (!e.shops.some((x) => x.shop === w.shop)) e.shops.push(w);
            if (safe === 'maybe') e.weak = true;
            byKey.set(k, e);
          }
        }
        const best = [...byKey.values()].sort((a1, b1) => b1.shops.length - a1.shops.length)[0];
        if (best) {
          // the best photo, and the other views of the same product (as surely sourced as the best one)
          cand = [best.u].concat([...byKey.values()].filter((e) => e !== best && e.shops.length >= Math.min(2, best.shops.length) && !(e.weak && !best.weak)).sort((a1, b1) => b1.shops.length - a1.shops.length).map((e) => e.u)).slice(0, 5);
          const w0 = best.shops[0];
          imgSource = { kind: w0.web ? 'web' : 'competitor', label: `Φωτογραφία του ίδιου προϊόντος στο ${w0.shop} (${w0.proof})`, url: w0.url };
          imgLevel = best.shops.length >= 2 && !best.weak ? 'high' : 'medium';
          for (const w of best.shops.slice(1)) imgAlso.push({ kind: w.web ? 'web' : 'competitor', label: `ίδια φωτογραφία στο ${w.shop}`, url: w.url });
          imgWhy = (best.shops.length >= 2 ? ` Η ίδια φωτογραφία (ίδιο αρχείο) σε ${best.shops.length} καταστήματα: είναι του κατασκευαστή.` : ' Είναι φωτογραφία άλλου καταστήματος: δες ότι είναι του κατασκευαστή (χωρίς λογότυπο καταστήματος) πριν την έγκριση.') + ((p.images || []).length ? ' Προστίθεται δίπλα στην υπάρχουσα: δες ότι δεν είναι η ίδια λήψη.' : '');
        }
      }
      for (const u of cand) if (!(p.images || []).some((x) => sameImage(x, u)) && !extraImgs.some((x) => sameImage(x, u))) extraImgs.push(u);
      // the same photo file at a shop with the same product: a second witness for the supplier's photos
      if (imgSource && imgSource.kind !== 'competitor') for (const w of wit) { const k = imageKey(fullImage(w.img)); if (k && extraImgs.some((u) => imageKey(u) === k) && !imgAlso.some((x) => x.label.endsWith(w.shop))) imgAlso.push({ kind: 'competitor', label: `ίδια φωτογραφία στο ${w.shop}`, url: w.url }); }
      if (imgAlso.length && imgLevel === 'medium' && imgSource && imgSource.kind !== 'competitor') imgLevel = 'high';
    }
    if (extraImgs.length) {
      add(Object.assign({}, base, { field: 'images', from: p.images || [], to: (p.images || []).concat(extraImgs).slice(0, 6), why: ((p.images || []).length ? 'Μόνο μία φωτογραφία: περισσότερες όψεις = περισσότερες πωλήσεις.' : 'Δεν έχει φωτογραφία: χωρίς αυτή δεν πουλάει και το Google Shopping το απορρίπτει.') + imgWhy, source: imgSource, sources: imgAlso, level: imgLevel }));
    }
    if (need.brand) {
      // votes: the supplier (its list or page) and every shop with the same product; a brand the shop already uses wins
      const votes = new Map();
      const vote = (raw, src, weight) => { const b = brandName(raw, C.brands); if (!b) return; const e = votes.get(b.key) || { name: b.name, known: b.known, n: 0, srcs: [] }; e.n += weight; e.srcs.push(src); votes.set(b.key, e); };
      if (found && found.data && found.data.brand) vote(found.data.brand, found.src, found.src.level === 'high' ? 2 : 1);
      for (const w of wit) if (w.brand && !w.byWords) vote(w.brand, { kind: 'competitor', label: `${w.shop} (${w.proof})`, url: w.url }, 1);
      for (const hh of webHits(C, site, p)) if (hh.brand && hh.how === 'code') vote(hh.brand, { kind: 'web', label: `${hh.host} (ίδιος κωδικός, internet)`, url: hh.url }, 1);
      const ranked = [...votes.values()].sort((a1, b1) => b1.n - a1.n);
      const top = ranked[0];
      // two sources that disagree (and neither is clearly ahead): nothing is proposed — a wrong brand is worse than none
      if (top && !(ranked[1] && ranked[1].n >= top.n)) {
        const exportable = attrBrands && p.type === 'simple' && !(p.attrs || []).length;
        const sure = top.n >= 2 && (top.known || top.srcs.some((x) => x.kind === 'supplier'));
        add(Object.assign({}, base, { field: 'brand', from: '', to: top.name, why: 'Χωρίς μάρκα: η μάρκα μπαίνει στα φίλτρα, στο Google και συνδέει το προϊόν με τον αντιπρόσωπο.' + (top.srcs.length > 1 ? ` Συμφωνούν ${top.srcs.length} πηγές.` : '') + (top.known ? '' : ' (Νέα μάρκα για το κατάστημα: έλεγξε τη γραφή.)') + (exportable ? '' : ' (Δεν μπαίνει στο αρχείο: ' + (attrBrands ? 'το προϊόν έχει ήδη ιδιότητες/μεγέθη' : 'το κατάστημα χρησιμοποιεί «Brands»') + ' — βάλ’ τη από τη μαζική επεξεργασία.)'), source: top.srcs[0], sources: top.srcs.slice(1), level: sure ? 'high' : 'medium', exportable }));
      }
    }
    const copy = copiedFrom(C, site, p);
    const junk = junkSku(p.sku) || copy;
    if (!String(p.sku || '').trim() || junk) {
      // Code: our other site → the supplier's list → the shops with the same product (their maker's code). A «code»
      // that is the date of a copy (Mora-1755379572) is replaced only by a code that sources show — never «cleaned»
      // into what is left of it («Mora» is the brand, not a code).
      const cv = new Map();
      const addCode = (raw, src, weak) => { const c = codeOf(raw, p.type === 'variable'); if (!c) return; const k = U.normSku(c); const e = cv.get(k) || { code: c, srcs: [], weak: false }; if (!e.srcs.some((x) => x.label === src.label)) e.srcs.push(src); if (weak) e.weak = true; cv.set(k, e); };
      if (twin && twin.sku && !junkSku(twin.sku)) addCode(twin.sku, { kind: 'twin', label: 'Από το ' + s.sites[other].name, url: twin.url }, false);
      if (found && found.data && found.data.code) addCode(found.data.code, found.src, found.src.level !== 'high');
      for (const w of wit) { if (!w.code || !safeWitness(p, w)) continue; addCode(w.code, { kind: 'competitor', label: `${w.shop} (${w.proof})`, url: w.url }, w.byWords || !w.exact); }
      // …and the shops of the internet that show the same product (searched for the products without a code)
      // (the maker's code of their page when it gives one; a shop's own code alone is weaker: it may be theirs only)
      for (const h of webHits(C, site, p)) { const raw = h.mpn || h.code; if (!raw || !sameColours(p.name, h.name) || h.match === 'code') continue; addCode(raw, { kind: 'web', label: `${h.host} (ίδιο προϊόν στο internet${h.mpn ? ', κωδικός κατασκευαστή' : ''})`, url: h.url }, true); }
      const ranked = [...cv.values()].sort((a1, b1) => b1.srcs.length - a1.srcs.length);
      const top = ranked[0];
      // two different codes with the same support: nothing (a wrong code is worse than none)
      // replacing a code that is there (the date of a copy): two independent sources at least
      let added = false;
      const warnCopy = (found0) => {
        added = true;
        // what the sources say (the supplier first, then the shops): when it is a code another product of ours has, both are said
        const holder = found0 && C.skuOwner[site].get(U.normSku(found0.code));
        const srcTxt = found0 ? ` Οι πηγές (${found0.srcs.map((x) => x.label).slice(0, 3).join(' · ')}) δείχνουν «${found0.code}»` + (holder && holder.id !== p.id ? `, όμως αυτόν τον έχει ήδη το «${holder.name}»: ένα από τα δύο προϊόντα έχει λάθος κωδικό — έλεγξέ τα μαζί.` : '.') : '';
        // (a copied code: nothing replaces it without proof, but it is said — its sizes must never get it as «the product's code»)
        const mk = require('./market');
        const inTitle = U.collapse(p.name).split(' ').filter((w) => /\d/.test(w) && /[A-Z]/i.test(w) && mk.codeBase(w) && U.normSku(w) !== U.normSku(p.sku)).slice(0, 2);
        add(Object.assign({}, base, { field: 'sku', from: p.sku, to: 'ο πραγματικός κωδικός (χειροκίνητα)', exportable: false, why: `Ο κωδικός «${p.sku}» είναι ο κωδικός άλλου προϊόντος (${copy.sku} — ${copy.name}) με «-${String(p.sku).split('-').pop()}»: το προϊόν αντιγράφηκε από εκείνο και κράτησε τον κωδικό του. Δεν μπαίνει ούτε στα μεγέθη/χρώματα.` + (inTitle.length ? ` Ο τίτλος γράφει «${inTitle.join(' ')}»: αν είναι ο κωδικός του κατασκευαστή, γράψ' τον στο προϊόν (και βγάλ' τον από τον τίτλο).` : '') + (srcTxt || ' Δεν βρέθηκε ακόμα πηγή (αντιπρόσωπος ή ≥2 καταστήματα) για τον σωστό.'), source: { kind: 'site', label: 'Από τα δεδομένα του site (αντιγραμμένος κωδικός)' }, level: 'medium' }));
      };
      if (top && junk && top.srcs.filter((x) => x.kind !== 'twin').length < 2 && !top.srcs.some((x) => x.kind === 'twin' || x.kind === 'supplier')) { if (copy) warnCopy(top); /* else: an uncertain finding, shown in the product's quality report */ }
      else if (top && !(ranked[1] && ranked[1].srcs.length >= top.srcs.length) && !C.skus[site].has(U.normSku(top.code))) {
        const fromUs = top.srcs.some((x) => x.kind === 'twin' || x.kind === 'supplier');
        // sure: our own other site, a sure supplier source, or two shops that give the same code on their own
        let sure = top.srcs.some((x) => x.kind === 'twin') || (fromUs && !top.weak) || top.srcs.length >= 2;
        // the title names another code of the same shape (… MK II 7664 / code 7265): one of the two is wrong
        const mk = require('./market');
        const cb = mk.codeBase(top.code);
        const clash = cb && U.collapse(p.name).split(' ').map((x) => mk.codeBase(x)).find((x) => x && x.shape === cb.shape && x.base !== cb.base && !(x.run && cb.run && x.run === cb.run));
        if (clash) sure = false;
        const ev = p.type === 'variable' ? variationCodes(C, site, p, top.code) : [];
        const vars = p.type === 'variable' ? ev.concat(unifyCodes(C, site, p, top.code, ev)) : [];
        added = true;
        add(Object.assign({}, base, { field: 'sku', from: junk ? p.sku : '', to: top.code, vars, why: (copy ? `Ο κωδικός «${p.sku}» είναι ο κωδικός άλλου προϊόντος (${copy.sku} — ${copy.name}) με «-${String(p.sku).split('-').pop()}»: αντιγράφηκε από εκεί. ` : junk ? `Ο κωδικός «${p.sku}» δεν είναι κωδικός (έχει στο τέλος την ώρα αντιγραφής του προϊόντος). ` : 'Χωρίς κωδικό: χωρίς αυτόν δεν γίνεται αντιστοίχιση με τιμοκαταλόγους, ανταγωνιστές και Google.') + (top.srcs.length > 1 ? ` Τον ίδιο κωδικό δίνουν ${top.srcs.length} πηγές.` : '') + (clash ? ` Ο τίτλος γράφει άλλον κωδικό (${clash.base}): ποιος είναι ο σωστός;` : sure ? '' : ' Αβέβαιο εύρημα — μία μόνο πηγή (ίσως κωδικός του καταστήματος, όχι του κατασκευαστή): χρειάζεται χειροκίνητη επιβεβαίωση.') + (vars.length ? ` Μαζί παίρνουν κωδικό και ${vars.length} μεγέθη/χρώματα.` : ''), source: top.srcs[0], sources: top.srcs.slice(1), level: sure ? 'high' : 'medium' }));
      }
      if (copy && !added) warnCopy(top);
    } else if (p.type === 'variable') {
      // the product has a code, some of its sizes / colours do not (or have a date of a copy, or the same code twice)
      const vars = variationCodes(C, site, p, String(p.sku).trim());
      // only codes other shops show for that very size / colour (two sites at least): never made from ours
      const hostsOf = (v) => v.srcs.map((x) => x.host);
      // the rest: one code for the whole product (no code made of ours — the size / colour shows the product's code)
      const unify = unifyCodes(C, site, p, String(p.sku).trim(), vars);
      if (unify.length && !vars.length) add(Object.assign({}, base, { field: 'varsku', from: unify.map((v) => ({ label: v.label, sku: v.was })), to: unify.map((v) => ({ label: v.label, sku: '' })), vars: unify,
        why: `Ένας ενιαίος κωδικός για όλο το προϊόν (${p.sku}): ${unify.length === 1 ? 'ένα μέγεθος/χρώμα έχει' : unify.length + ' μεγέθη/χρώματα έχουν'} κωδικό που δεν είναι πραγματικός (${unify.slice(0, 2).map((v) => v.was).join(', ')}${unify.length > 2 ? '…' : ''}: αυτόματος αριθμός αντιγραφής, διπλός, ή ο κωδικός του προϊόντος με το μέγεθος στο τέλος). Μένουν χωρίς δικό τους κωδικό και δείχνουν τον κωδικό του προϊόντος. Δικός τους κωδικός μόνο όταν τον δείχνουν ≥2 άλλα καταστήματα για ακριβώς αυτό το μέγεθος/χρώμα.`,
        source: { kind: 'rule', label: 'Κανόνας του καταστήματος: ένας κωδικός ανά προϊόν' }, level: 'high' }));
      if (vars.length) add(Object.assign({}, base, { field: 'varsku', from: vars.filter((v) => v.was).map((v) => ({ label: v.label, sku: v.was })).concat(unify.map((v) => ({ label: v.label, sku: v.was }))), to: vars.map((v) => ({ label: v.label, sku: v.sku })).concat(unify.map((v) => ({ label: v.label, sku: '' }))), vars: vars.concat(unify), why: `${vars.length === 1 ? 'Ένα μέγεθος/χρώμα' : vars.length + ' μεγέθη/χρώματα'} χωρίς σωστό κωδικό: τον ίδιο κωδικό για ακριβώς αυτό το μέγεθος/χρώμα δείχνουν ${[...new Set(vars.flatMap(hostsOf))].length} ανεξάρτητα καταστήματα (${[...new Set(vars.flatMap(hostsOf))].slice(0, 3).join(', ')}).` + (vars.some((v) => v.was) ? ` (Οι τωρινοί «${vars.find((v) => v.was).was}…» είναι αυτόματοι αριθμοί ή διπλοί.)` : ''), source: { kind: 'web', label: vars[0].srcs[0].host + ' (ίδιο μέγεθος/χρώμα)', url: vars[0].srcs[0].url }, sources: vars[0].srcs.slice(1).map((x) => ({ kind: 'web', label: x.host + ' (ίδιο μέγεθος/χρώμα)', url: x.url })), level: 'high' }));
    }
    if (p.type === 'simple' && !p.ean) {
      // EAN: from the supplier (sure source) and from the shops with the same product; different EANs → nothing
      const gv = new Map();
      if (found && found.data && found.src.level === 'high') { const g = validGtin(found.data.ean); if (g) gv.set(g, [found.src]); }
      let weak = false;
      for (const w of wit) { const safe = !w.byWords && safeWitness(p, w); if (!safe) continue; const g = validGtin(w.ean); if (!g) continue; if (!gv.has(g)) gv.set(g, []); if (!gv.get(g).some((x) => x.label.startsWith(w.shop))) { gv.get(g).push({ kind: 'competitor', label: `${w.shop} (${w.proof})`, url: w.url }); if (safe === 'maybe') weak = true; } }
      for (const h of webHits(C, site, p)) { const g = validGtin(h.ean); if (!g || !sameColours(p.name, h.name)) continue; if (!gv.has(g)) gv.set(g, []); if (!gv.get(g).some((x) => x.label.startsWith(h.host))) gv.get(g).push({ kind: 'web', label: `${h.host} (ίδιο προϊόν στο internet)`, url: h.url }); }
      if (gv.size === 1) {
        const [g, srcs] = [...gv][0];
        const sure = srcs.some((x) => x.kind === 'supplier') || (srcs.length >= 2 && !weak);
        add(Object.assign({}, base, { field: 'gtin', from: '', to: g, why: 'Το EAN βοηθά το Google Shopping να δείξει το προϊόν (σωστό ψηφίο ελέγχου).' + (srcs.length > 1 ? ` Το ίδιο EAN σε ${srcs.length} πηγές.` : sure ? '' : ' Μία μόνο πηγή: κατάστημα με το ίδιο προϊόν.') + (weak ? ' Ο τίτλος μας δεν λέει χρώμα: αν το προϊόν έχει πολλά χρώματα, κάθε χρώμα έχει δικό του EAN — έλεγξέ το.' : ''), source: srcs[0], sources: srcs.slice(1), level: sure ? 'high' : 'medium' }));
      }
    }
  // prices: the two sites must agree (the reference site wins)
  const it = C.price.get(key);
  if (it && it.fix && Number(it.fix.regular) > 0 && !ignoredIn('x-price')) {
    add({ site: it.site, pid: it.id, name: it.name, img: it.img, url: it.url, sku: it.sku, type: it.type, field: 'price', ign: ['x-price'], from: { price: it.site === 'st' ? it.stPrice : it.sfPrice }, to: { regular: Number(it.fix.regular), sale: Number(it.fix.sale) || 0, srcId: it.srcId }, why: `Διαφορετική τιμή στα δύο sites (${it.why}). Σωστή είναι του ${settings.all().sites[settings.all().master === 'st' ? 'st' : 'sf'].name}.`, source: { kind: 'rule', label: 'Η τιμή του κεντρικού site' }, level: 'high' });
  }
  // The ads site follows the main site: the same product there (if it may be there) gets the approved change by itself
  if (site === 'sf' && list.length) {
    const sid = C.L.sfToSt.get(p.id);
    const sp = sid != null ? oById.get(sid) : null;
    if (sp && sp.type !== 'variation' && sp.status !== 'draft' && sp.status !== 'private' && !C.banned.has(sid)) {
      let any = false;
      for (const c of list) if (MIRROR.includes(c.field)) { c.twin = sid; any = true; }
      if (any) C.tw.set(sid, { name: sp.name, img: sp.thumb || (sp.images || [])[0] || '', url: sp.url, sku: sp.sku, type: sp.type });
    }
  }
  return list;
}

/** How complete a product is, 0..1 for each of: description, photos, brand, short description, title, code. */
function qualityVec(p, s) {
  const n = contentNeeds(p, s);
  const desc = textInfo(p).len;
  const imgs = (p.images || []).length;
  return [
    n.desc ? (desc >= 80 && !n.english ? 0.4 : 0) : 1,
    imgs >= 2 ? 1 : imgs === 1 ? 0.5 : 0,
    p.brand ? 1 : 0, n.short ? 0 : 1,
    /^[Α-Ω]/.test(U.greekUpper(p.name)) && p.name.length <= (s.longTitle || 110) && !/[a-zά-ώ]/.test(p.name) ? 1 : 0,
    p.sku ? 1 : 0,
  ];
}

/** All the proposals, in slices (a generator: run in one go by proposals(), in the background by rebuild()). */
function* proposalsGen() {
  const catalog = require('./catalog');
  const C = buildCtx();
  yield;
  const byProduct = new Map(), qv = new Map(), q = {};
  for (const site of catalog.SITES) {
    const S = C.sites[site];
    if (!S) continue;
    const acc = q[site] = { n: 0, total: 0, parts: [0, 0, 0, 0, 0, 0] };
    for (const p of S.cat.products) {
      if (p.type === 'variation' || p.status === 'draft' || p.status === 'private') continue;
      yield;
      const key = site + ':' + p.id;
      const list = proposalsFor(site, p, C);
      if (list.length) byProduct.set(key, list);
      if (site === 'st' && C.banned.has(p.id)) continue; // not counted in the quality of the ads site
      const v = qualityVec(p, C.s);
      qv.set(key, v);
      acc.n++;
      for (let i = 0; i < 6; i++) { acc.parts[i] += v[i]; acc.total += v[i] * QW[i]; }
    }
  }
  // one EAN belongs to one product: an EAN proposed for two of ours (or for one we sell under another code) is dropped
  const seenG = new Map();
  // (the same product on our two sites is one product)
  const one = (k) => { const [st, id] = k.split(':'); const sfId = st === 'st' ? C.L.stToSf.get(Number(id)) : null; return sfId != null ? 'sf:' + sfId : k; };
  // …and so does a code (SKU): one proposed for two of our products is dropped from both
  for (const [k, list] of byProduct) for (const c of list) if (c.field === 'gtin' || c.field === 'sku') { const id = c.field + ':' + (c.field === 'sku' ? U.normSku(c.to) : c.to); const a = seenG.get(id) || []; a.push(k); seenG.set(id, a); }
  for (const [id, keys] of seenG) if (new Set(keys.map(one)).size > 1) { const field = id.split(':')[0]; for (const k of keys) { const l = (byProduct.get(k) || []).filter((c) => c.field !== field); if (l.length) byProduct.set(k, l); else byProduct.delete(k); } }
  return { at: U.nowIso(), cacheAt: C.ec.at || null, byProduct, tw: C.tw, q, qv, rev: 0, C };
}
function proposals() {
  if (prop && (!dirty || lazy)) return prop;
  dirty = false;
  const P = bg.drainSync(proposalsGen());
  delete P.C; ctx = null; // the working context points into the catalogs: not kept
  prop = P;
  return prop;
}
/** Build again in slices (the program keeps answering); the old result is used until the new one is whole. */
async function rebuild() {
  dirty = false;
  const P = await bg.drain(proposalsGen());
  delete P.C; ctx = null;
  prop = P;
  return P;
}
/** One product again (a new source page, a translation): the rest stays as it is. */
function refreshProduct(site, pid) {
  const catalog = require('./catalog');
  if (!prop || dirty) { if (!lazy) proposals(); return; }
  const C = buildCtx(); // made for this one product and let go (a rare action of a person: a new source page, a translation)
  const p = C.sites[site] && catalog.byId(site).get(Number(pid));
  const key = site + ':' + Number(pid);
  if (!p || p.type === 'variation') return;
  const list = proposalsFor(site, p, C);
  if (list.length) prop.byProduct.set(key, list); else prop.byProduct.delete(key);
  for (const [k, v] of C.tw) prop.tw.set(k, v);
  prop.rev++;
}
/** For keeping the result over a restart (it is only calculated again when the data changes). */
function forSave() {
  if (!prop) return null;
  const items = [];
  for (const l of prop.byProduct.values()) for (const c of l) items.push(c);
  return { v: 2, at: prop.at, cacheAt: prop.cacheAt, items, tw: [...prop.tw], q: prop.q, qv: [...prop.qv].map(([k, v]) => [k].concat(v)) };
}
function setSaved(o) {
  if (!o || o.v !== 2 || !Array.isArray(o.items) || !o.q) return false;
  const byProduct = new Map();
  for (const c of o.items) { const k = c.site + ':' + c.pid; const l = byProduct.get(k); if (l) l.push(c); else byProduct.set(k, [c]); }
  prop = { at: o.at, cacheAt: o.cacheAt || null, byProduct, tw: new Map(o.tw || []), q: o.q, qv: new Map((o.qv || []).map((r) => [r[0], r.slice(1)])), rev: 0 };
  memo = null; ctx = null;
  return true;
}

/**
 * The proposals with the decisions (and the "ignore" marks) laid over them: what every screen and file uses.
 * Light: a pass over the proposals, done again only after a decision.
 */
function compute() {
  const P = proposals();
  const dv = store.ver(KEY), iv = store.ver('ignored');
  if (memo && memo.P === P && memo.rev === P.rev && memo.dv === dv && memo.iv === iv) return memo;
  const dec = decisions();
  const ign = require('./checks').ignored();
  const sets = new Map();
  const ignored = (id, key) => { let st = sets.get(id); if (st === undefined) { st = ign[id] && ign[id].length ? new Set(ign[id]) : null; sets.set(id, st); } return !!st && st.has(key); };
  let out = [];
  const lead = [], leadKey = new Set();
  for (const [key, list] of P.byProduct) {
    for (const c0 of list) {
      if (c0.ign && c0.ign.some((id) => ignored(id, key))) continue;
      const c = Object.assign({}, c0);
      const d = dec[c.id];
      c.status = 'pending';
      if (d && (d.hash === c.hash || d.edited !== undefined)) {
        c.status = d.status; c.at = d.at; c.by = d.by || '';
        if (d.edited !== undefined) { c.edited = true; c.to = d.edited; }
        // in the file, but the site read AFTER it still has the old value: the import did not happen (or did not take) —
        // back to «waiting», said so (seen 24/11: old changes stood as done while nothing changed on the site)
        if (d.status === 'exported' && d.exportedAt && syncedAfter(c.site, d.exportedAt)) { c.status = 'pending'; c.notApplied = d.exportedAt; }
      }
      out.push(c);
      if (c.twin != null && c.status !== 'rejected') { lead.push(c); leadKey.add(c.twin + ':' + c.field); }
    }
  }
  // The ads site follows the main site: what is approved for a product on SpecialForces is made, by itself, on the same
  // product of the ads site (no second approval, no second proposal). Not for what differs between the sites
  // (categories, prices), and never for products that are not allowed there.
  if (leadKey.size) {
    // the ads site's own proposal for the same field is dropped: the main site's change is the only one
    out = out.filter((c) => !(c.site === 'st' && leadKey.has(c.pid + ':' + c.field)));
    const sfName = settings.all().sites.sf.name;
    for (const c of lead) {
      if (c.status !== 'approved' && c.status !== 'exported') continue; // waits for the yes on the main site
      const sp = P.tw.get(c.twin);
      if (!sp) continue;
      const m = { site: 'st', pid: c.twin, name: sp.name, img: sp.img, url: sp.url, sku: sp.sku, type: sp.type, field: c.field, lazyFrom: true, to: c.to,
        why: `Ίδια αλλαγή με το ${sfName}: έγινε δεκτή εκεί, γίνεται αυτόματα και εδώ.`, source: { kind: 'mirror', label: 'Από το ' + sfName + ' (εγκεκριμένο)', url: c.url, level: 'high' }, level: 'high', mirrorOf: c.id };
      finish(m);
      const d = dec[m.id];
      m.status = d && d.hash === m.hash && (d.status === 'exported' || d.status === 'rejected') ? d.status : 'approved';
      if (d && d.hash === m.hash) { m.at = d.at; m.by = d.by || ''; }
      else { m.by = c.by || ''; m.at = c.at; }
      out.push(m);
    }
  }
  memo = { at: P.at, items: out, cacheAt: P.cacheAt, P, rev: P.rev, dv, iv };
  return memo;
}
/** Was this site's catalog read again (15 minutes or more) after that moment? */
function syncedAfter(site, iso) {
  const cat = require('./catalog').load(site);
  const t = new Date(cat.syncedAt || 0).getTime();
  return t > 0 && t - new Date(iso).getTime() > 15 * 60000;
}
/** The value on the site now, for showing "before → after" (looked up only for what is shown). */
function withFrom(c) {
  if (!c.lazyFrom || c.from !== undefined) return c;
  const p = require('./catalog').byId(c.site).get(c.pid);
  const cur = p ? { name: p.name, desc: p.desc || '', short: p.short || '', images: p.images || [], brand: p.brand || '', gtin: '' }[c.field] : '';
  return Object.assign({}, c, { from: cur === undefined ? '' : cur });
}

// ---------- quality score of the catalog (0–100 per product) ----------
// "Now" comes with the proposals (one pass over the catalog); "after" adds what the waiting fixes would complete.
function quality(site) {
  const m = compute();
  if (m.quality && m.quality[site]) return m.quality[site];
  const P = m.P, q = P.q[site] || { n: 0, total: 0, parts: [0, 0, 0, 0, 0, 0] };
  const fields = new Map();
  for (const c of m.items) if (c.site === site && c.status !== 'rejected') { let f = fields.get(c.pid); if (!f) fields.set(c.pid, f = new Set()); f.add(c.field === 'name' ? 'title' : c.field); }
  let gain = 0;
  for (const [pid, f] of fields) {
    const v = P.qv.get(site + ':' + pid);
    if (!v) continue;
    for (let i = 0; i < 5; i++) if (f.has(QK[i])) gain += (1 - v[i]) * QW[i];
  }
  const n = q.n || 1;
  const pct = (i) => Math.round((q.parts[i] / n) * 100);
  const res = {
    site, products: q.n, score: Math.round(q.total / n), after: Math.round((q.total + gain) / n),
    parts: [
      { key: 'desc', label: 'Περιγραφή', pct: pct(0), weight: QW[0] }, { key: 'images', label: 'Φωτογραφίες (2+)', pct: pct(1), weight: QW[1] },
      { key: 'title', label: 'Τίτλος σωστός', pct: pct(4), weight: QW[4] }, { key: 'brand', label: 'Μάρκα', pct: pct(2), weight: QW[2] },
      { key: 'short', label: 'Σύντομη περιγραφή', pct: pct(3), weight: QW[3] }, { key: 'sku', label: 'Κωδικός (SKU)', pct: pct(5), weight: QW[5] },
    ],
  };
  (m.quality = m.quality || {})[site] = res;
  return res;
}

// ---------- the screen ----------
function view(q) {
  q = q || {};
  const all = compute().items;
  const site = q.site === 'st' ? 'st' : q.site === 'sf' ? 'sf' : '';
  const status = ['pending', 'approved', 'exported', 'rejected'].includes(q.status) ? q.status : 'pending';
  const counts = { groups: {}, origins: {}, status: { pending: 0, approved: 0, exported: 0, rejected: 0 }, high: 0, sites: { sf: 0, st: 0 }, notApplied: 0 };
  const origin = ORIGINS[q.origin] ? q.origin : '';
  for (const c of all) {
    if (site && c.site !== site) continue;
    counts.status[c.status]++;
    if (c.status !== status) continue;
    if (c.notApplied) counts.notApplied++;
    counts.origins[c.origin] = (counts.origins[c.origin] || 0) + 1;
    if (origin && c.origin !== origin) continue;
    counts.groups[c.group] = (counts.groups[c.group] || 0) + 1;
    // the sure ones of what is shown (the button «approve all the sure ones» takes the chosen group)
    if (c.level === 'high' && (!q.group || c.group === q.group) && c.exportable !== false) counts.high++;
  }
  for (const c of all) if (c.status === 'approved') counts.sites[c.site]++;
  let list = all.filter((c) => (!site || c.site === site) && c.status === status && (!q.group || c.group === q.group) && (!origin || c.origin === origin) && (q.level !== 'high' || c.level === 'high') && (q.notApplied !== '1' || c.notApplied));
  if (q.q) { const t = U.foldKey(q.q).split(' ').filter(Boolean); list = list.filter((c) => { const h = U.foldKey(c.name + ' ' + (c.sku || '')); return t.every((x) => h.includes(x)); }); }
  // one card per product, the products with the most (and surest) changes first
  const by = new Map();
  for (const c of list) { const k = c.site + ':' + c.pid; if (!by.has(k)) by.set(k, { site: c.site, pid: c.pid, name: c.name, img: c.img, url: c.url, sku: c.sku, changes: [] }); by.get(k).changes.push(c); }
  const order = { desc: 0, images: 1, name: 2, price: 3, published: 4, gla: 5, short: 6, brand: 7, cats: 8, gtin: 9, sku: 10, varsku: 11 };
  const cards = [...by.values()];
  for (const cd of cards) cd.changes.sort((a, b) => order[a.field] - order[b.field]);
  cards.sort((a, b) => b.changes.filter((c) => c.level === 'high').length - a.changes.filter((c) => c.level === 'high').length || b.changes.length - a.changes.length);
  const per = Math.min(100, Number(q.per) || 30), page = Math.max(1, Number(q.page) || 1);
  return {
    at: compute().at, cacheAt: compute().cacheAt, counts, total: cards.length, cards: cards.slice((page - 1) * per, page * per).map((cd) => Object.assign({}, cd, { changes: cd.changes.map(withFrom) })), groups: GROUPS, origins: ORIGINS, fields: FIELD,
    quality: ['sf', 'st'].filter((x) => compute().P.q[x]).map((x) => quality(x)),
    ai: !!(settings.all().localAI || {}).enabled,
  };
}

function decide(ids, status, by, edited) {
  if (!['approved', 'rejected', 'pending'].includes(status)) throw new Error('Λάθος κατάσταση.');
  const items = new Map(compute().items.map((c) => [c.id, c]));
  let n = 0;
  store.update(KEY, {}, (d) => {
    for (const id of [].concat(ids || [])) {
      const c = items.get(id);
      if (!c) continue;
      if (status === 'pending') { delete d[id]; n++; continue; }
      const prev = d[id] || {};
      d[id] = { status, hash: c.hash, at: U.nowIso(), by: by || '' };
      if (edited !== undefined && ids.length === 1) d[id].edited = editedValue(c, edited);
      else if (prev.edited !== undefined) d[id].edited = prev.edited;
      n++;
    }
    return d;
  });
  return { count: n };
}
function editedValue(c, v) {
  if (c.field === 'name') { const t = U.capsTitle(String(v || '')); if (!t) throw new Error('Ο τίτλος δεν μπορεί να είναι κενός.'); return t; }
  if (c.field === 'desc') { const html = require('./extract').cleanHtml(String(v && v.html != null ? v.html : v || '')); if (stripText(html).length < 20) throw new Error('Πολύ μικρή περιγραφή.'); return { html, meta: c.to && c.to.meta ? metaOf(html) : '' }; }
  if (c.field === 'short') return require('./extract').cleanHtml(String(v || ''));
  throw new Error('Αυτή η αλλαγή δεν διορθώνεται με το χέρι εδώ.');
}
/** Approve every sure (high) change that waits, of a site / group. */
function approveSure(site, group, by) {
  const ids = compute().items.filter((c) => c.status === 'pending' && c.level === 'high' && (!site || c.site === site) && (!group || c.group === group) && c.exportable !== false).map((c) => c.id);
  return decide(ids, 'approved', by);
}

// ---------- the WooCommerce update file ----------
function exportFile(site, by) {
  const catalog = require('./catalog');
  const wx = require('./wooexport');
  const s = settings.all();
  const items = compute().items.filter((c) => c.site === site && c.status === 'approved' && c.exportable !== false);
  if (!items.length) throw new Error('Δεν υπάρχουν εγκεκριμένες διορθώσεις για το ' + s.sites[site].name + '.');
  const cat = catalog.load(site);
  const byId = new Map(cat.products.map((p) => [p.id, p]));
  const seo = wx.seoColumns(wx.seoMode(site));
  const rows = new Map();
  const extraRows = [];
  const cols = new Set();
  const row = (pid) => { if (!rows.has(pid)) rows.set(pid, { ID: pid }); return rows.get(pid); };
  const set = (r, k, v) => { r[k] = v; cols.add(k); };
  let xc = null;
  const exportCtx = () => { if (!xc) { xc = { L: catalog.links(), skus: { sf: new Set(), st: new Set() } }; for (const st2 of catalog.SITES) for (const x of catalog.load(st2).products) if (x.sku) xc.skus[st2].add(U.normSku(x.sku)); } return xc; };
  const brandAttr = catalog.detectAttribute(site, 'brand');
  for (const c of items) {
    const p = byId.get(c.pid);
    if (!p) continue;
    const r = row(c.pid);
    if (c.field === 'name') set(r, 'Name', c.to);
    else if (c.field === 'desc') { set(r, 'Description', c.to.html); if (seo && c.to.meta) set(r, seo.desc, c.to.meta); }
    else if (c.field === 'short') set(r, 'Short description', c.to);
    else if (c.field === 'images') set(r, 'Images', wx.imgs(c.to));
    else if (c.field === 'cats') { const idx = catalog.categoryIndex(site); set(r, 'Categories', wx.cats([idx.pathOf(c.to.id)])); }
    else if (c.field === 'published') set(r, 'Published', -1);
    else if (c.field === 'gla') set(r, wx.GLA, 'dont-sync-and-show');
    else if (c.field === 'gtin') set(r, 'GTIN, UPC, EAN, or ISBN', c.to);
    else if (c.field === 'sku' || c.field === 'varsku') {
      if (c.field === 'sku') set(r, 'SKU', c.to);
      cols.add('SKU');
      // the sizes / colours: worked out again from THIS site's catalog (a change approved on SpecialForces and made by
      // itself on the ads site carries the other site's variations)
      const code = c.field === 'sku' ? c.to : p.sku;
      // (the codes the approval saw, for this site's own variations; else worked out again from the same sources)
      const vlist = (c.vars || []).length && c.site === site ? c.vars : p.type === 'variable' && code ? variationCodes(exportCtx(), site, p, code) : [];
      for (const v of vlist) extraRows.push({ ID: v.id, SKU: v.sku });
    }
    else if (c.field === 'brand') { wx.setAttrs(r, [{ name: brandAttr, values: [c.to], visible: true, global: true }]); for (const k of ['Attribute 1 name', 'Attribute 1 value(s)', 'Attribute 1 visible', 'Attribute 1 global']) cols.add(k); }
    else if (c.field === 'price') {
      if (p.type === 'variable') {
        // every size gets the price of the same size on the reference site
        const master = s.master === 'st' ? 'st' : 'sf';
        const src = catalog.load(master);
        const sv = src.products.filter((x) => x.type === 'variation' && x.parent === c.to.srcId);
        for (const v of cat.products.filter((x) => x.type === 'variation' && x.parent === p.id)) {
          const m = sv.find((x) => (x.sku && v.sku && U.normSku(x.sku) === U.normSku(v.sku)) || U.foldKey(x.varLabel) === U.foldKey(v.varLabel));
          if (m && m.regular > 0) extraRows.push({ ID: v.id, 'Regular price': m.regular.toFixed(2), 'Sale price': m.sale ? m.sale.toFixed(2) : '' });
        }
        cols.add('Regular price'); cols.add('Sale price');
      } else { set(r, 'Regular price', Number(c.to.regular).toFixed(2)); set(r, 'Sale price', c.to.sale ? Number(c.to.sale).toFixed(2) : ''); }
    }
  }
  const order = ['SKU', 'Name', 'Published', 'Short description', 'Description', 'Regular price', 'Sale price', 'Categories', 'Images', 'GTIN, UPC, EAN, or ISBN', 'Attribute 1 name', 'Attribute 1 value(s)', 'Attribute 1 visible', 'Attribute 1 global'];
  const columns = order.filter((k) => cols.has(k)).concat([...cols].filter((k) => !order.includes(k)));
  const all = [...rows.values()].filter((r) => Object.keys(r).length > 1).concat(extraRows);
  if (!all.length) throw new Error('Δεν βγήκε καμία γραμμή για το αρχείο.');
  const csv = wx.updateFile(all, columns);
  const at = U.nowIso();
  store.update(KEY, {}, (d) => { for (const c of items) d[c.id] = Object.assign({}, d[c.id] || { hash: c.hash }, { status: 'exported', at, by: by || '', exportedAt: at }); return d; });
  return { csv, count: all.length, products: rows.size, changes: items.length, site, name: `diorthoseis-${site}.csv`, gtin: cols.has('GTIN, UPC, EAN, or ISBN') };
}

// ---------- finding the sources (background job: supplier price lists + supplier pages) ----------
/**
 * For every product that misses content: the same product in the suppliers' price lists (code / EAN / name),
 * then — when the list has no text or photos — the supplier's product page, read politely (one page every
 * 1.5 s per site, at most opts.maxPages per run, each page kept for 30 days).
 * A source counts only if its title really is our product (the same strict check as the price research).
 */
async function findSources(job, opts) {
  opts = opts || {};
  const catalog = require('./catalog');
  const suppliers = require('./suppliers');
  const pricelist = require('./pricelist');
  const extract = require('./extract');
  const market = require('./market');
  const s = settings.all();
  const ec = cache();
  const maxPages = Math.max(0, Number(opts.maxPages == null ? 120 : opts.maxPages));
  const sites = catalog.SITES.filter((x) => catalog.load(x).syncedAt);
  // 1. who needs what (in slices: 17.000 products in one go froze a small cloud machine for half a minute)
  const pace = bg.pacer();
  const needs = [];
  const bannedAds = catalog.bannedOnAds();
  for (const site of sites) {
    for (const p of catalog.load(site).products) {
      if (pace.due()) await pace.rest();
      if (p.type === 'variation' || p.status === 'draft' || p.status === 'private') continue;
      if (site === 'st' && bannedAds.has(p.id)) continue; // not allowed on the ads site: nothing is looked up for it
      const n = contentNeeds(p, s);
      if (n.desc || n.short || n.images || n.brand) needs.push({ site, p, n });
    }
  }
  job && job.progress(0, needs.length, `${needs.length.toLocaleString('el-GR')} προϊόντα θέλουν περιεχόμενο — αντιστοίχιση με τους τιμοκαταλόγους…`);
  // 2. the suppliers' lists, matched to our products (code, EAN, name — the same matching as the price lists)
  const cand = new Map(); // site:id -> [{ sup, item, how, weak }]
  for (const sup of suppliers.list()) {
    if (job && job.cancelled()) return null;
    const items = pricelist.rawItems(sup.id);
    if (!items.length) continue;
    const byKey = new Map(items.map((i) => [i.key, i]));
    for (const site of sites) {
      const cmp = pricelist.compare(sup.id, site);
      if (!cmp) continue;
      for (const r of cmp.rows) {
        if (pace.due()) await pace.rest();
        if (!r.match) continue;
        const k = site + ':' + (r.match.parent || r.match.id);
        if (!cand.has(k)) cand.set(k, []);
        cand.get(k).push({ sup, item: byKey.get(r.key), how: r.match.how, weak: !!r.match.weak });
      }
    }
  }
  // 3. the best source for each product, checked against our title
  let pages = 0, found = 0, done = 0, errors = 0;
  const now = Date.now();
  const gap = 1500;
  for (const { site, p, n } of needs) {
    if (job && job.cancelled()) break;
    if (pace.due()) await pace.rest();
    done++;
    if (done % 50 === 0) job && job.progress(done, needs.length, `${found.toLocaleString('el-GR')} πηγές βρέθηκαν · ${pages} σελίδες αντιπροσώπων διαβάστηκαν`);
    const key = site + ':' + p.id;
    const list = (cand.get(key) || []).filter((x) => x.item).sort((a, b) => Number(a.weak) - Number(b.weak));
    let best = null;
    for (const c of list) {
      const it = c.item;
      const chk = market.score({ name: p.name, brand: p.brand, sku: p.sku, price: 0 }, { name: it.name + (it.brand && !U.foldKey(it.name).includes(U.foldKey(it.brand)) ? ' ' + it.brand : ''), sku: it.code, brand: it.brand, price: 0 });
      const strong = !c.weak && /EAN|κωδικ/i.test(c.how);
      if (chk.match === 'none' && !strong) continue; // the title is another product: never take its text
      best = { c, level: strong && chk.match !== 'none' ? 'high' : 'medium', chk };
      break;
    }
    if (!best) { if (ec.products[key] && ec.products[key].src && ec.products[key].src.kind === 'manual') continue; delete ec.products[key]; continue; }
    const it = best.c.item;
    const data = { name: it.name, brand: it.brand || '', ean: it.ean || '', code: it.code || '', descHtml: it.desc ? (/<[a-z]/i.test(it.desc) ? extract.cleanHtml(it.desc) : extract.textToHtml(it.desc)) : '', images: extract.cleanImages(it.images || [], it.url || 'https://x/'), features: [], specs: [] };
    let url = /^https?:\/\//i.test(it.url || '') ? it.url : '';
    // the page has more (full text, all photos, specs) when the list has little
    const wantPage = url && ((n.desc && stripText(data.descHtml).length < 200) || (n.images && data.images.length < 2) || (n.short && !data.features.length));
    if (wantPage) {
      let pg = ec.pages[url];
      if (!(pg && now - new Date(pg.at).getTime() < PAGE_DAYS * 864e5) && pages < maxPages) {
        pages++;
        try {
          const x = await extract.fromUrl(url, { gap });
          pg = { at: U.nowIso(), data: { name: x.name, brand: x.brand, ean: x.ean, code: x.code, descHtml: String(x.descHtml || '').slice(0, 20000), shortHtml: String(x.shortHtml || '').slice(0, 4000), features: (x.features || []).slice(0, 25), specs: (x.specs || []).slice(0, 20), images: (x.images || []).slice(0, 12) } };
        } catch (e) { errors++; pg = { at: U.nowIso(), error: e.message }; }
        ec.pages[url] = pg;
      }
      if (pg && pg.data) {
        // the page must show the same product (a B2B page may redirect to a login or a category)
        const pchk = market.score({ name: p.name, brand: p.brand, sku: p.sku, price: 0 }, { name: pg.data.name, sku: pg.data.code, brand: pg.data.brand, price: 0 });
        if (pchk.match !== 'none') {
          if (stripText(pg.data.descHtml).length > stripText(data.descHtml).length) data.descHtml = pg.data.descHtml;
          if ((pg.data.images || []).length > data.images.length) data.images = pg.data.images;
          data.features = pg.data.features || []; data.specs = pg.data.specs || [];
          data.brand = data.brand || pg.data.brand || ''; data.ean = data.ean || pg.data.ean || '';
          if (pchk.match === 'similar' && best.level === 'high' && !/EAN|κωδικ/i.test(best.c.how)) best.level = 'medium';
        } else url = '';
      }
    }
    if (!stripText(data.descHtml) && !data.images.length && !data.brand && !data.features.length) { delete ec.products[key]; continue; }
    const prev = ec.products[key];
    data.supplier = best.c.sup.name;
    ec.products[key] = { at: U.nowIso(), src: { kind: 'supplier', label: `${best.c.sup.name} · ${best.c.how}`, url: url || '', supplierId: best.c.sup.id, level: best.level }, data: Object.assign(data, prev && prev.data && prev.data.descHtmlEl && prev.data.descHtml === data.descHtml ? { descHtmlEl: prev.data.descHtmlEl } : {}) };
    found++;
  }
  // 4. photos: nothing (or too little) from a supplier → the research on the internet (lib/codefind): the same plan of
  // searches as for codes, only pages of the SAME variant, only the photos of that variant (never a whole gallery of
  // colours). With computers that help, it is theirs (the queue is fed with these products too); else done here.
  let researched = 0;
  const minImg = (s.webResearch && s.webResearch.minImages) || 3;
  const maxResearch = process.env.SFK_NO_RESEARCH ? 0 : Math.max(0, Number(opts.maxResearch == null ? 40 : opts.maxResearch));
  if (maxResearch) {
    const cf = require('./codefind');
    const L = catalog.links();
    const web = (store.read(cf.KEY, null) || {}).products || {};
    const todo = needs.filter(({ site, p }) => (p.images || []).length < minImg && !(site === 'st' && L.stToSf.has(p.id)) && !(ec.products[site + ':' + p.id] && (ec.products[site + ':' + p.id].data.images || []).length >= minImg) && cf.dueAt(web[site + ':' + p.id]) <= now);
    todo.sort((a, b) => (a.p.images || []).length - (b.p.images || []).length || (b.p.inStock !== false) - (a.p.inStock !== false)); // none first
    job && job.log(`Φωτογραφίες: ${todo.length} προϊόντα με λιγότερες από ${minImg} φωτογραφίες χωρίς πηγή αντιπροσώπου.`);
    if (todo.length && !opts.viaQueue) {
      const items = cf.itemsFor(todo.slice(0, maxResearch).map(({ site, p }) => site + ':' + p.id)).map((it) => Object.assign(it, { needs: [...new Set(['images'].concat(it.needs || []))] }));
      const r = await cf.run(job, { items });
      researched = r.looked;
      found += r.withCode;
    }
  }
  // pages not needed any more are forgotten after 30 days
  for (const [u, pg] of Object.entries(ec.pages)) if (now - new Date(pg.at).getTime() > PAGE_DAYS * 864e5) delete ec.pages[u];
  ec.at = U.nowIso();
  store.write(CACHE, ec);
  invalidate();
  // on the server the engine builds it once, when the job ends (a build here as well = two at once on a small machine)
  if (!lazy) await rebuild();
  // decisions about changes that no longer exist (fixed on the site, product gone) are forgotten after 2 weeks
  const alive = new Set(compute().items.map((c) => c.id));
  store.update(KEY, {}, (d) => { for (const [id, x] of Object.entries(d)) if (!alive.has(id) && now - new Date(x.at).getTime() > 14 * 864e5) delete d[id]; return d; });
  job && job.progress(needs.length, needs.length, `Έτοιμο: πηγές για ${found.toLocaleString('el-GR')} προϊόντα · ${pages} σελίδες αντιπροσώπων διαβάστηκαν`);
  return { needs: needs.length, found, pages, errors, researched };
}

/** A page given by the user (manufacturer / supplier) as the source of one product. */
async function fromPage(site, id, url) {
  const catalog = require('./catalog');
  const extract = require('./extract');
  const market = require('./market');
  const p = catalog.load(site).products.find((x) => x.id === Number(id));
  if (!p) throw new Error('Δεν βρέθηκε το προϊόν.');
  const x = await extract.fromUrl(url);
  const chk = market.score({ name: p.name, brand: p.brand, sku: p.sku, price: 0 }, { name: x.name, sku: x.code, brand: x.brand, price: 0 });
  const ec = cache();
  ec.products[site + ':' + p.id] = { at: U.nowIso(), src: { kind: 'manual', label: 'Σελίδα που έδωσες · ' + U.hostOf(x.url || url), url: x.url || url, level: chk.match === 'none' ? 'medium' : 'high' }, data: { name: x.name, brand: x.brand, ean: x.ean, code: x.code, descHtml: String(x.descHtml || '').slice(0, 20000), shortHtml: x.shortHtml || '', features: (x.features || []).slice(0, 25), specs: (x.specs || []).slice(0, 20), images: (x.images || []).slice(0, 12) } };
  store.write(CACHE, ec);
  refreshProduct(site, p.id);
  return { ok: true, sameProduct: chk.match !== 'none', name: x.name };
}

/** Greek translation of the supplier's English text, with the free local AI (if it is on). */
async function translate(site, id) {
  const localai = require('./localai');
  const ec = cache();
  const e = ec.products[site + ':' + Number(id)];
  if (!e || !e.data || !e.data.descHtml) throw new Error('Δεν υπάρχει κείμενο αντιπροσώπου για μετάφραση.');
  e.data.descHtmlEl = await localai.translate(e.data.descHtml);
  store.write(CACHE, ec);
  refreshProduct(site, Number(id));
  return { ok: true };
}

/** For the "Today" screen and the menu badge. */
function summary() {
  try {
    const m = compute();
    if (m.summary) return m.summary;
    const items = m.items;
    const pending = items.filter((c) => c.status === 'pending');
    return m.summary = { pending: pending.length, sure: pending.filter((c) => c.level === 'high').length, approved: items.filter((c) => c.status === 'approved').length, exported: items.filter((c) => c.status === 'exported').length, products: new Set(pending.map((c) => c.site + ':' + c.pid)).size };
  } catch (e) { return { pending: 0, sure: 0, approved: 0, exported: 0, products: 0, error: e.message }; }
}

module.exports = { ORIGINS, originOf, sizeJunk, copiedFrom, syncedAfter, invalidateSoon, setManual, MANUAL, unifyCodes, junkSku, variationCodes, setLazy, isDirty, proposals, rebuild, refreshProduct, forSave, setSaved, scrub, compute, view, decide, approveSure, exportFile, findSources, fromPage, translate, summary, quality, invalidate, validGtin, greekShare, contentNeeds, buildDesc, CACHE, GROUPS };
