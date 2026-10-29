'use strict';
// "Fill in from the website": give the supplier's site and the program finds by itself
// the company name, phones, email, address, ΑΦΜ, which brands they bring (and which of them we sell),
// product feeds (XML/CSV), B2B / login pages, and whether their catalog can be read automatically.
// Everything is a suggestion with its source; the user keeps or corrects it.
const { parse } = require('node-html-parser');
const http = require('./http');
const U = require('./util');

const PHONE = /(?:\+30[\s.-]?)?(?:2\d{2}[\s.-]?\d{3}[\s.-]?\d{4}|2\d{3}[\s.-]?\d{6}|2\d[\s.-]?\d{4}[\s.-]?\d{4}|69\d[\s.-]?\d{3}[\s.-]?\d{4}|69\d{8}|2\d{9})/g;
const EMAIL = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;
const VAT = /(?:Α\.?\s?Φ\.?\s?Μ\.?|ΑΦΜ|VAT(?:\s*(?:No|Number|ID))?|Tax ID)\s*[:.]?\s*(?:EL|GR)?\s*(\d{9})\b/i;
const FEED_HINT = /\.(xml|csv|xlsx?)(\?|$)|feed|skroutz|bestprice|xml|export|price-?list|τιμοκαταλογ/i;
const B2B_HINT = /b2b|χονδρ|wholesale|dealer|reseller|συνεργατ|partner|eshop-b2b|my-account|login|σύνδεση|συνδεση|eisodos|είσοδος|λογαριασμ/i;
const CONTACT_HINT = /contact|epikoinon|επικοινων|stoixeia|στοιχεια|about|σχετικα|etaireia|εταιρει|who-we-are/i;
const FEED_PATHS = ['/skroutz.xml', '/xml/skroutz.xml', '/feeds/skroutz.xml', '/feed/skroutz', '/?feed=skroutz', '/index.php?route=extension/feed/skroutz', '/bestprice.xml', '/products.xml', '/feed.xml'];

function normPhone(p) {
  const d = p.replace(/\D/g, '').replace(/^30(?=\d{10}$)/, '');
  return d.length === 10 ? d.replace(/^(\d{3})(\d{3})(\d{4})$/, '$1 $2 $3') : '';
}
const isMobile = (p) => /^69/.test(p.replace(/\D/g, ''));

async function getHtml(url) {
  const r = await http.get(url, { timeout: 25000, retries: 1 });
  let html = r.text;
  const cs = (html.slice(0, 3000).match(/<meta[^>]+charset=["']?([a-z0-9_-]+)/i) || [])[1];
  if (cs && !/utf-?8/i.test(cs)) { try { html = new TextDecoder(cs.toLowerCase()).decode(r.buf); } catch (_) { /* keep */ } }
  return { html, url: r.url || url };
}

function ldBlocks(root) {
  const out = [];
  for (const s of root.querySelectorAll('script[type="application/ld+json"]')) {
    try { const j = JSON.parse(s.rawText); const walk = (x) => { if (!x || typeof x !== 'object') return; if (Array.isArray(x)) return x.forEach(walk); out.push(x); if (x['@graph']) walk(x['@graph']); }; walk(j); } catch (_) { /* broken JSON-LD */ }
  }
  return out;
}
const ORG_TYPES = /Organization|LocalBusiness|Store|Corporation|OnlineStore|WholesaleStore|SportingGoodsStore|ClothingStore/;

/** What one page says about the company. */
function scan(html, url, found) {
  const root = parse(html, { comment: false, blockTextElements: { script: true, style: false, noscript: false } });
  const add = (field, value, source) => {
    if (!value) return;
    const v = U.collapse(String(value));
    if (!v) return;
    const list = found[field] || (found[field] = []);
    const k = U.foldKey(v);
    const e = list.find((x) => U.foldKey(x.value) === k);
    if (e) e.hits++; else list.push({ value: v, source, hits: 1 });
  };
  const page = U.hostOf(url) + new URL(url).pathname;
  for (const o of ldBlocks(root)) {
    const t = [].concat(o['@type'] || []).join(' ');
    if (!ORG_TYPES.test(t)) continue;
    add('name', o.legalName || o.name, 'JSON-LD');
    for (const tel of [].concat(o.telephone || [])) { const n = normPhone(String(tel)); if (n) add(isMobile(n) ? 'mobile' : 'phone', n, 'JSON-LD'); }
    for (const em of [].concat(o.email || [])) add('email', String(em).replace(/^mailto:/i, ''), 'JSON-LD');
    if (o.vatID || o.taxID) add('vat', String(o.vatID || o.taxID).replace(/\D/g, '').slice(-9), 'JSON-LD');
    const a = o.address && (Array.isArray(o.address) ? o.address[0] : o.address);
    if (a && typeof a === 'object') add('address', [a.streetAddress, a.postalCode, a.addressLocality].filter(Boolean).join(', '), 'JSON-LD');
    else if (typeof a === 'string') add('address', a, 'JSON-LD');
  }
  const meta = (n) => { const m = root.querySelector(`meta[property="${n}"]`) || root.querySelector(`meta[name="${n}"]`); return m ? U.decodeEntities(m.getAttribute('content') || '') : ''; };
  add('name', meta('og:site_name'), 'og:site_name');
  for (const a of root.querySelectorAll('a[href^="tel:"]')) { const n = normPhone(a.getAttribute('href').slice(4)); if (n) add(isMobile(n) ? 'mobile' : 'phone', n, 'σύνδεσμος τηλεφώνου · ' + page); }
  for (const a of root.querySelectorAll('a[href^="mailto:"]')) add('email', decodeURIComponent(a.getAttribute('href').slice(7).split('?')[0]), 'σύνδεσμος email · ' + page);
  const text = U.collapse(root.querySelector('body') ? root.querySelector('body').text : root.text);
  for (const m of text.match(PHONE) || []) { const n = normPhone(m); if (n) add(isMobile(n) ? 'mobile' : 'phone', n, 'κείμενο · ' + page); }
  for (const m of text.match(EMAIL) || []) if (!/\.(png|jpe?g|webp|gif|svg)$/i.test(m) && !/sentry|example|wixpress|domain\.com/i.test(m)) add('email', m.toLowerCase(), 'κείμενο · ' + page);
  const vat = text.match(VAT);
  if (vat) add('vat', vat[1], 'κείμενο · ' + page);
  const addr = text.match(/(?:Διεύθυνση|Διευθυνση|Address|Έδρα|Εδρα)\s*[:.]?\s*([^|•\n]{8,90}?\d{3}\s?\d{2}[^|•\n]{0,30})/i);
  if (addr) add('address', addr[1].replace(/\s*(Τηλ|Tel|Email|E-mail|ΑΦΜ).*$/i, ''), 'κείμενο · ' + page);
  // links worth following / reporting
  const links = [];
  for (const a of root.querySelectorAll('a[href]')) {
    const href = a.getAttribute('href');
    if (!href || /^(#|javascript:|tel:|mailto:)/i.test(href)) continue;
    let abs; try { abs = new URL(href, url).toString(); } catch (_) { continue; }
    links.push({ url: abs, text: U.collapse(a.text).slice(0, 80) });
  }
  const brandLinks = links.filter((l) => /\/(brand|brands|marka|markes|manufacturer|kataskevast|κατασκευαστ|μαρκ)[a-z-]*\//i.test(decodeURIComponent(l.url)) && l.text && l.text.length <= 40);
  for (const b of brandLinks) add('brandsFromLinks', b.text, 'σύνδεσμοι μάρκας');
  const generator = meta('generator');
  return { links, generator, html };
}

async function probeFeed(url) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 12000);
  try {
    const res = await fetch(url, { headers: { 'User-Agent': http.UA, Accept: '*/*' }, redirect: 'follow', signal: ctl.signal });
    if (res.status !== 200) return null;
    const reader = res.body.getReader();
    const { value } = await reader.read();
    try { await reader.cancel(); } catch (_) { /* ignore */ }
    const head = Buffer.from(value || []).toString('utf8', 0, 1500).trimStart();
    const type = res.headers.get('content-type') || '';
    if (/^<\?xml|^<(products|mywebstore|store|rss|feed|catalog|items)/i.test(head) && /product|item|offer/i.test(head)) return { url: res.url || url, kind: 'xml' };
    if (/csv/.test(type) || (/[;,\t]/.test(head.split('\n')[0] || '') && /sku|code|κωδ|price|τιμ/i.test(head.split('\n')[0] || ''))) return { url: res.url || url, kind: 'csv' };
    return null;
  } catch (_) { return null; } finally { clearTimeout(t); }
}

async function platformOf(base, generator, html) {
  try {
    const r = await http.getJson(base + '/wp-json/wc/store/v1/products?per_page=1', { retries: 0, timeout: 15000 });
    if (Array.isArray(r.json)) return { kind: 'woo', products: parseInt(r.headers.get('x-wp-total') || '0', 10) || null };
  } catch (_) { /* not woo or closed */ }
  try {
    const r = await http.getJson(base + '/products.json?limit=1', { retries: 0, timeout: 15000 });
    if (r.json && Array.isArray(r.json.products)) return { kind: 'shopify', products: null };
  } catch (_) { /* not shopify */ }
  const g = (generator || '') + ' ' + html.slice(0, 20000);
  if (/prestashop/i.test(g)) return { kind: 'prestashop' };
  if (/magento|mage\//i.test(g)) return { kind: 'magento' };
  if (/opencart|route=common|catalog\/view\/theme/i.test(g)) return { kind: 'opencart' };
  if (/wordpress|wp-content/i.test(g)) return { kind: 'wordpress' };
  return { kind: 'other' };
}

async function brandsOf(base, platform) {
  const out = new Map();
  if (platform.kind === 'woo') {
    try {
      const r = await http.getJson(base + '/wp-json/wc/store/v1/products/brands?per_page=100', { retries: 0, timeout: 20000 });
      for (const b of Array.isArray(r.json) ? r.json : []) out.set(U.foldKey(b.name), { name: U.decodeEntities(b.name), count: b.count || 0 });
    } catch (_) { /* older WooCommerce: no brands endpoint */ }
    if (!out.size) {
      try {
        const r = await http.getJson(base + '/wp-json/wc/store/v1/products?per_page=100&_fields=attributes,brands', { retries: 0, timeout: 30000 });
        for (const p of Array.isArray(r.json) ? r.json : []) {
          const names = (p.brands || []).map((b) => b.name).concat(((p.attributes || []).find((a) => /κατασκευαστ|brand|μάρκ|μαρκ/i.test(a.name)) || { terms: [] }).terms.map((t) => t.name));
          for (const n of names) { const k = U.foldKey(n); const e = out.get(k) || { name: U.decodeEntities(n), count: 0 }; e.count++; out.set(k, e); }
        }
      } catch (_) { /* ignore */ }
    }
  } else if (platform.kind === 'shopify') {
    try {
      const r = await http.getJson(base + '/products.json?limit=250', { retries: 0, timeout: 30000 });
      for (const p of (r.json && r.json.products) || []) if (p.vendor) { const k = U.foldKey(p.vendor); const e = out.get(k) || { name: p.vendor, count: 0 }; e.count++; out.set(k, e); }
    } catch (_) { /* ignore */ }
  }
  return out;
}

/** Look at the supplier's website and suggest everything we can find. */
async function lookup(website) {
  const catalog = require('./catalog');
  const url = U.normUrl(website);
  if (!url) throw new Error('Δώσε τη διεύθυνση του site του αντιπροσώπου.');
  const base = new URL(url).origin;
  const found = {};
  const notes = [];
  const home = await getHtml(url);
  const first = scan(home.html, home.url, found);
  // the contact / about pages usually hold phone, address and ΑΦΜ
  const extra = first.links.filter((l) => U.hostOf(l.url) === U.hostOf(base) && CONTACT_HINT.test(decodeURIComponent(l.url) + ' ' + l.text)).map((l) => l.url.split('#')[0]);
  for (const u of [...new Set(extra)].slice(0, 3)) {
    try { const p = await getHtml(u); scan(p.html, p.url, found); } catch (e) { notes.push('Δεν άνοιξε η σελίδα ' + u + ': ' + e.message); }
  }
  const title = (home.html.match(/<title[^>]*>([^<]{2,120})<\/title>/i) || [])[1];
  if (title && !(found.name || []).length) found.name = [{ value: U.collapse(U.decodeEntities(title).split(/[|–—-]/)[0]), source: 'τίτλος σελίδας', hits: 1 }];
  const platform = await platformOf(base, first.generator, home.html);
  // feeds: links on the page + the usual places of Skroutz/BestPrice feeds
  const feedCands = new Set(first.links.filter((l) => U.hostOf(l.url) === U.hostOf(base) && FEED_HINT.test(l.url)).map((l) => l.url));
  for (const p of FEED_PATHS) feedCands.add(base + p);
  const feeds = [];
  await http.pool([...feedCands].slice(0, 14), 3, async (u) => { const f = await probeFeed(u); if (f && !feeds.some((x) => x.url === f.url)) feeds.push(f); });
  const b2b = [...new Map(first.links.filter((l) => B2B_HINT.test(decodeURIComponent(l.url) + ' ' + l.text)).map((l) => [l.url.split('?')[0], { url: l.url.split('#')[0], text: l.text }])).values()].slice(0, 6);
  // brands: theirs vs ours
  const theirs = await brandsOf(base, platform);
  for (const b of found.brandsFromLinks || []) if (!theirs.has(U.foldKey(b.value))) theirs.set(U.foldKey(b.value), { name: b.value, count: 0 });
  const ours = new Map(catalog.brandsList().map((b) => [U.foldKey(b.name || b), b]));
  const common = [], other = [];
  for (const [k, b] of theirs) (ours.has(k) ? common : other).push({ name: b.name, count: b.count, ours: ours.has(k) ? (ours.get(k).sf || 0) + (ours.get(k).st || 0) : 0 });
  common.sort((a, b) => b.ours - a.ours);
  other.sort((a, b) => b.count - a.count);
  const best = (f) => { const l = (found[f] || []).slice().sort((a, b) => b.hits - a.hits || (a.source === 'JSON-LD' ? -1 : 1)); return l; };
  const pick = (f) => (best(f)[0] || null);
  const ownHost = U.hostOf(base).replace(/^www\./, '');
  const emails = best('email').sort((a, b) => (b.value.endsWith(ownHost) ? 1 : 0) - (a.value.endsWith(ownHost) ? 1 : 0));
  if (platform.kind === 'woo' || platform.kind === 'shopify') notes.push('Ο κατάλογός τους διαβάζεται αυτόματα: μπορεί να χρησιμοποιηθεί σαν τιμοκατάλογος (λιανικές τους) και για νέα προϊόντα.');
  else notes.push('Ο κατάλογός τους δεν διαβάζεται αυτόματα (' + ({ prestashop: 'PrestaShop', magento: 'Magento', opencart: 'OpenCart', wordpress: 'WordPress χωρίς δημόσιο κατάλογο' }[platform.kind] || 'άλλη πλατφόρμα') + ')' + (feeds.length ? ': χρησιμοποιήστε το feed που βρέθηκε.' : '. Χρησιμοποιήστε feed, Excel ή PDF.'));
  return {
    website: base,
    suggestions: {
      name: pick('name'), phone: pick('phone'), mobile: pick('mobile'), email: emails[0] || null, address: pick('address'), vat: pick('vat'),
    },
    alternatives: { phone: best('phone').slice(1, 4), mobile: best('mobile').slice(1, 4), email: emails.slice(1, 4), address: best('address').slice(1, 3) },
    platform, feeds, b2b, brands: { common, other: other.slice(0, 60) }, notes,
  };
}

module.exports = { lookup, normPhone };
