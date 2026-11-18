'use strict';
// Read a supplier / manufacturer product page and pull out what a listing needs:
// name, brand, code, EAN, price, official description (HTML), features, specs, images, variants.
// the page reader; the program folder downloaded without its packages (a helping computer) uses the bundled copy
const { parse } = (() => { try { return require('node-html-parser'); } catch (_) { return require('../vendor/node-html-parser'); } })();
const http = require('./http');
const U = require('./util');

const DESC_SELECTORS = [
  '#tab-description', '.woocommerce-Tabs-panel--description', '.woocommerce-product-details__description',
  '.product__description', '.product-single__description', '.product-description', '#product-description',
  '.product.attribute.description .value', '#description', '[itemprop=description]', '.description', '.product-details', '.rte',
];
const SHORT_SELECTORS = ['.woocommerce-product-details__short-description', '.product-short-description', '.short-description', '.product-summary'];
const ALLOWED = new Set(['p', 'br', 'ul', 'ol', 'li', 'strong', 'b', 'em', 'i', 'h2', 'h3', 'h4', 'h5', 'table', 'thead', 'tbody', 'tr', 'td', 'th', 'dl', 'dt', 'dd', 'blockquote', 'sup', 'sub']);

// Every product field a shop page can give. availability: 'in' | 'out' | 'unknown' (unknown is never taken for «in
// stock»). code = the maker's code when the page names one (mpn), else the shop's code (sku) — both kept apart too.
// variants: each one with ITS OWN sku / ean / price / availability (never mixed with another size or colour).
function emptyProduct() {
  return { url: '', host: '', platform: '', name: '', brand: '', code: '', sku: '', mpn: '', ean: '', price: 0, regular: 0, currency: '', availability: 'unknown', isProduct: false, descHtml: '', descText: '', shortHtml: '', features: [], specs: [], images: [], variants: [], category: '', notes: [] };
}
const AVAIL_IN = /InStock|LimitedAvailability|OnlineOnly|InStoreOnly|in[ _-]?stock|διαθέσιμο|available/i;
const AVAIL_OUT = /OutOfStock|SoldOut|Discontinued|out[ _-]?of[ _-]?stock|sold[ _-]?out|εξαντλ|μη διαθέσιμο|unavailable|\boos\b/i;
/** A schema.org / Open Graph / shop word for availability → 'in' | 'out' | 'unknown' (PreOrder, BackOrder…: unknown). */
function availOf(v) {
  const t = String(v == null ? '' : v).trim();
  if (!t) return 'unknown';
  if (AVAIL_OUT.test(t)) return 'out';
  if (/PreOrder|BackOrder|PreSale|MadeToOrder|Reserved/i.test(t)) return 'unknown';
  return AVAIL_IN.test(t) ? 'in' : 'unknown';
}
/** Several answers (offers, variants): one in stock → 'in'; all said out → 'out'; else unknown. */
function availAll(list) {
  const a = list.filter((x) => x && x !== 'unknown');
  if (a.includes('in')) return 'in';
  return a.length && a.length === list.length ? 'out' : 'unknown';
}
function validGtin(v) {
  const g = String(v || '').replace(/\D/g, '');
  if (![8, 12, 13, 14].includes(g.length) || /^0+$/.test(g)) return '';
  let sum = 0;
  for (let i = 0; i < g.length - 1; i++) sum += Number(g[g.length - 2 - i]) * (i % 2 === 0 ? 3 : 1);
  return (10 - (sum % 10)) % 10 === Number(g[g.length - 1]) ? g : '';
}

/** opts.gap: pause (ms) between requests to the same site, when many pages are read one after the other. */
async function fromUrl(url, opts) {
  url = String(url || '').trim();
  const gap = (opts && opts.gap) || 0;
  const signal = (opts && opts.signal) || undefined; // a stopped research stops here too (not after the page is read)
  if (!/^https?:\/\//i.test(url)) throw new Error('Δώσε πλήρη διεύθυνση (https://…).');
  const r = await http.get(url, { timeout: 30000, retries: 1, gap, signal });
  let html = r.text;
  const cs = (html.slice(0, 3000).match(/<meta[^>]+charset=["']?([a-z0-9_-]+)/i) || [])[1];
  if (cs && !/utf-?8/i.test(cs)) {
    try { html = new TextDecoder(cs.toLowerCase()).decode(r.buf); } catch (_) { /* keep utf8 */ }
  }
  const out = fromHtml(html, r.url || url);
  // Platform APIs give cleaner data than the HTML.
  try {
    if (out.platform === 'shopify') await enrichShopify(out, r.url || url, gap, signal);
    else if (out.platform === 'woocommerce') await enrichWoo(out, r.url || url, gap, signal);
  } catch (e) { if (signal && signal.aborted) throw e; out.notes.push('Δεν διαβάστηκαν τα επιπλέον δεδομένα του καταστήματος: ' + e.message); }
  finish(out);
  if (!out.name && !out.descText) throw new Error('Η σελίδα δεν έδωσε στοιχεία προϊόντος (ίσως φορτώνει με JavaScript). Συμπλήρωσε τα πεδία με το χέρι.');
  return out;
}

function fromHtml(html, url) {
  const out = emptyProduct();
  out.url = url; out.host = U.hostOf(url);
  if (/cdn\.shopify\.com|Shopify\.theme|shopify-section/i.test(html)) out.platform = 'shopify';
  else if (/woocommerce|wp-content\/plugins\/woocommerce/i.test(html)) out.platform = 'woocommerce';
  else if (/prestashop/i.test(html)) out.platform = 'prestashop';
  else if (/Magento|mage\//.test(html)) out.platform = 'magento';
  else if (/catalog\/view\/theme|route=product/i.test(html)) out.platform = 'opencart';
  const root = parse(html, { comment: false, blockTextElements: { script: true, style: true, noscript: false, pre: true } });
  const meta = {};
  for (const m of root.querySelectorAll('meta')) {
    const k = (m.getAttribute('property') || m.getAttribute('name') || m.getAttribute('itemprop') || '').toLowerCase();
    const v = m.getAttribute('content');
    if (k && v && !(k in meta)) meta[k] = U.decodeEntities(v).trim();
  }
  // JSON-LD
  const blocks = root.querySelectorAll('script[type="application/ld+json"]').map((s) => s.rawText);
  const ld = productFromJsonLd(blocks, url);
  Object.assign(out, pick(ld, ['name', 'brand', 'code', 'sku', 'mpn', 'ean', 'price', 'regular', 'currency', 'category']));
  if (ld.found) { out.isProduct = true; out.availability = ld.availability; }
  for (const sp of ld.specs) addSpec(out, sp.k, sp.v);
  out.variants.push(...ld.variants);
  // microdata (itemprop="sku" / "gtin13" / "availability"… on any element): many shops have it without JSON-LD
  const md = (prop) => { const el = root.querySelector(`[itemprop="${prop}"]`); if (!el) return ''; return U.collapse(U.decodeEntities(el.getAttribute('content') || el.getAttribute('href') || el.text || '')); };
  if (root.querySelector('[itemtype*="schema.org/Product"]')) out.isProduct = true;
  if (!out.sku) out.sku = md('sku');
  if (!out.mpn) out.mpn = md('mpn');
  if (!out.ean) out.ean = validGtin(md('gtin13') || md('gtin') || md('gtin12') || md('gtin14') || md('gtin8'));
  if (out.availability === 'unknown') out.availability = availOf(md('availability'));
  const imgs = [];
  if (meta['og:image']) imgs.push(meta['og:image']);
  imgs.push(...ld.images);
  // Woo variations JSON
  for (const f of root.querySelectorAll('form[data-product_variations]')) mergeWooVariations(out, f.getAttribute('data-product_variations'), imgs);
  // Product gallery images
  const gallery = root.querySelectorAll('.woocommerce-product-gallery img, .product-gallery img, .product__media img, .product-images img, #product-images img, .product-image img, [data-zoom-image], [data-large_image]');
  for (const img of gallery.length ? gallery : root.querySelectorAll('img')) {
    for (const a of ['data-zoom-image', 'data-large_image', 'data-large', 'data-full', 'data-original', 'data-src', 'data-lazy-src', 'src']) {
      const v = img.getAttribute(a);
      if (v && !v.startsWith('data:')) { imgs.push(v); break; }
    }
    const ss = img.getAttribute('srcset') || img.getAttribute('data-srcset');
    if (ss) { const b = largestFromSrcset(ss); if (b) imgs.push(b); }
  }
  for (const a of root.querySelectorAll('a[href]')) {
    const h = a.getAttribute('href');
    if (/\.(jpe?g|png|webp)(\?|$)/i.test(h) && a.closest('.woocommerce-product-gallery, .product-gallery, .product__media, .product-images, #product-images, .images, .product-image')) imgs.push(h);
  }
  out.images = cleanImages(imgs, url);

  if (!out.name) out.name = U.collapse(meta['og:title'] || (root.querySelector('h1') || {}).text || (root.querySelector('title') || {}).text || '');
  if (!out.price) out.price = U.parseNumber(meta['product:price:amount'] || meta['og:price:amount'] || meta.price || '');
  if (!out.currency) out.currency = meta['product:price:currency'] || meta.pricecurrency || '';
  if (!out.brand) out.brand = meta['product:brand'] || meta.brand || '';
  if (!out.sku) out.sku = meta['product:retailer_item_id'] || meta.sku || '';
  if (!out.mpn) out.mpn = meta.mpn || meta['product:mfr_part_no'] || '';
  if (!out.ean) out.ean = validGtin(meta['product:gtin'] || meta['product:ean'] || meta.gtin13 || meta.gtin || '');
  if (!out.regular) { const r0 = U.parseNumber(meta['product:original_price:amount'] || ''); if (r0 > out.price) out.regular = r0; }
  if (out.availability === 'unknown') out.availability = availOf(meta['product:availability'] || meta['og:availability'] || meta.availability || '');
  if (/^product/i.test(meta['og:type'] || '') || meta['product:price:amount']) out.isProduct = true;
  // WooCommerce writes the code and the stock state into the page itself
  if (!out.sku) { const el = root.querySelector('.sku_wrapper .sku, .product_meta .sku'); if (el) out.sku = U.collapse(el.text).replace(/^(N\/A|—|-)$/i, ''); }
  if (out.availability === 'unknown') {
    const st = root.querySelector('.summary .stock, .product .stock, p.stock');
    if (st) out.availability = /out-of-stock/.test(st.getAttribute('class') || '') ? 'out' : /in-stock|available-on-backorder/.test(st.getAttribute('class') || '') ? (/backorder/.test(st.getAttribute('class') || '') ? 'unknown' : 'in') : availOf(st.text);
    else { const pd = root.querySelector('div.product.type-product, div[id^="product-"].product'); if (pd) { const c = pd.getAttribute('class') || ''; out.availability = /\boutofstock\b/.test(c) ? 'out' : /\binstock\b/.test(c) ? 'in' : 'unknown'; } }
  }
  if (root.querySelector('div.product.type-product, form.cart, .single-product-summary')) out.isProduct = true;
  out.code = out.mpn || out.sku || out.code || '';

  // Official description
  for (const sel of DESC_SELECTORS) {
    const el = root.querySelector(sel);
    if (!el) continue;
    const h = cleanHtml(el.innerHTML);
    if (U.stripTags(h).length >= 40) { out.descHtml = h; break; }
  }
  for (const sel of SHORT_SELECTORS) {
    const el = root.querySelector(sel);
    if (el) { const h = cleanHtml(el.innerHTML); if (U.stripTags(h).length >= 15) { out.shortHtml = h; break; } }
  }
  if (!out.descHtml && ld.description) out.descHtml = textToHtml(ld.description);
  if (!out.descHtml && (meta['og:description'] || meta.description)) out.descHtml = textToHtml(meta['og:description'] || meta.description);

  // Specs: Woo "additional information" table or any th/td table near the product, dt/dd lists
  for (const row of root.querySelectorAll('.woocommerce-product-attributes tr, .product-attributes tr, .data-table tr, table.specs tr, .product-specs tr')) {
    const k = row.querySelector('th, td:first-child'); const v = row.querySelector('td:last-child');
    if (k && v && k !== v) addSpec(out, k.text, v.text);
  }
  out.breadcrumbs = root.querySelectorAll('.woocommerce-breadcrumb a, .breadcrumb a, .breadcrumbs a, nav[aria-label*="read"] a').map((a) => U.collapse(a.text)).filter(Boolean).slice(1);
  return out;
}

function addSpec(out, k, v) {
  k = U.collapse(U.decodeEntities(k)).replace(/:$/, ''); v = U.collapse(U.decodeEntities(v));
  if (!k || !v || k.length > 60 || v.length > 300) return;
  if (out.specs.some((s) => s.k === k)) return;
  out.specs.push({ k, v });
}

async function enrichShopify(out, url, gap, signal) {
  const u = new URL(url);
  const m = u.pathname.match(/\/products\/([^/?#]+)/);
  if (!m) return;
  const r = await http.getJson(`${u.origin}/products/${m[1]}.js`, { retries: 0, timeout: 15000, gap, signal });
  const p = r.json || {};
  if (!p.id && !p.title) return;
  out.isProduct = true;
  if (p.title) out.name = p.title;
  if (p.vendor) out.brand = p.vendor;
  if (p.description) out.descHtml = cleanHtml(p.description);
  if (p.type) out.category = p.type;
  const imgs = (p.images || []).map((x) => (String(x).startsWith('//') ? 'https:' + x : x));
  if (imgs.length) out.images = cleanImages(imgs.concat(out.images), url);
  const opts = p.options || [];
  const vs = p.variants || [];
  // each size / colour with ITS OWN code, EAN (barcode), price and stock
  out.variants = vs.map((v) => {
    const attrs = {};
    opts.forEach((o, i) => { const name = typeof o === 'string' ? o : o.name; const val = v['option' + (i + 1)]; if (name && val && !/^title$/i.test(name)) attrs[name] = val; });
    return { name: v.title, sku: v.sku || '', ean: validGtin(v.barcode), attrs, price: (Number(v.price) || 0) / 100, regular: (Number(v.compare_at_price) || 0) / 100, inStock: v.available === true ? true : v.available === false ? false : null };
  }).filter((v) => Object.keys(v.attrs).length);
  if (p.price) out.price = Number(p.price) / 100;
  if (p.compare_at_price && Number(p.compare_at_price) > Number(p.price)) out.regular = Number(p.compare_at_price) / 100;
  out.availability = p.available === true ? 'in' : p.available === false ? 'out' : out.availability;
  // one code / EAN for the whole product only when every size and colour has the same one (or there is just one):
  // never the code of the first size for all of them
  const skus = [...new Set(vs.map((v) => String(v.sku || '').trim()).filter(Boolean))];
  const eans = [...new Set(vs.map((v) => validGtin(v.barcode)).filter(Boolean))];
  if (!out.sku && skus.length === 1) out.sku = skus[0];
  else if (!out.sku && skus.length > 1) { const base = commonCode(skus); if (base) { out.sku = base; out.notes.push('Ο κωδικός είναι το κοινό μέρος των κωδικών όλων των μεγεθών/χρωμάτων: ' + base); } }
  if (!out.ean && eans.length === 1 && (vs.length === 1 || vs.every((v) => validGtin(v.barcode) === eans[0]))) out.ean = eans[0];
  if (out.ean && eans.length > 1 && vs.length > 1) out.ean = ''; // the EAN of one variant is not the product's
  out.code = out.mpn || out.sku || out.code;
}
/** The part of the codes of all sizes / colours that is the same, cut at a separator: K16110-01-S, K16110-01-M → K16110-01. */
function commonCode(list) {
  let pre = list[0];
  for (const x of list.slice(1)) { let i = 0; while (i < pre.length && i < x.length && pre[i] === x[i]) i++; pre = pre.slice(0, i); }
  const cut = pre.match(/^(.*?)[-_./ ]*$/)[1];
  const atSep = list.every((x) => x.length === cut.length || /[-_./ ]/.test(x[cut.length]));
  return atSep && cut.length >= 4 && /\d/.test(cut) ? cut : '';
}

/** A GTIN the shop gives through the Store API (WooCommerce 9.2+ «GTIN, UPC, EAN…» field, or an «EAN» attribute). */
function wooGtin(p) {
  for (const k of ['global_unique_id', 'gtin', 'ean', 'barcode', 'upc']) { const g = validGtin(p && p[k]); if (g) return g; }
  for (const a of (p && p.attributes) || []) if (/^(ean|gtin|upc|barcode|ean-?13|κωδικός ean|κωδικοσ ean|γραμμωτός κώδικας)$/i.test(U.collapse(U.decodeEntities(a.name || ''))) && a.terms && a.terms.length === 1) { const g = validGtin(a.terms[0].name); if (g) return g; }
  return '';
}
async function enrichWoo(out, url, gap, signal) {
  const u = new URL(url);
  const slug = decodeURIComponent(u.pathname.split('/').filter(Boolean).pop() || '');
  if (!slug) return;
  const r = await http.getJson(`${u.origin}/wp-json/wc/store/v1/products?slug=${encodeURIComponent(slug)}`, { retries: 0, timeout: 15000, gap, signal });
  const p = Array.isArray(r.json) ? r.json[0] : null;
  if (!p) return;
  out.isProduct = true;
  out.name = U.decodeEntities(p.name) || out.name;
  if (p.sku) out.sku = out.sku || U.decodeEntities(p.sku);
  if (!out.ean) out.ean = wooGtin(p);
  if (p.description && U.stripTags(p.description).length >= 40) out.descHtml = cleanHtml(p.description);
  if (p.short_description && U.stripTags(p.short_description).length >= 15) out.shortHtml = cleanHtml(p.short_description);
  const unit = Number((p.prices || {}).currency_minor_unit == null ? 2 : p.prices.currency_minor_unit);
  const money = (v) => (v == null || v === '' ? 0 : Number(v) / Math.pow(10, unit));
  if (p.prices && p.prices.price) out.price = money(p.prices.price);
  if (p.prices && money(p.prices.regular_price) > out.price) out.regular = money(p.prices.regular_price);
  if (p.prices && p.prices.currency_code) out.currency = p.prices.currency_code;
  if (p.is_in_stock === true) out.availability = 'in'; else if (p.is_in_stock === false) out.availability = 'out';
  const imgs = (p.images || []).map((i) => i.src);
  if (imgs.length) out.images = cleanImages(imgs.concat(out.images), url);
  for (const a of p.attributes || []) {
    const name = U.decodeEntities(a.name);
    if (/κατασκευαστ|brand|μάρκ|μαρκ/i.test(name) && a.terms && a.terms[0]) out.brand = out.brand || U.decodeEntities(a.terms[0].name);
    else if (!a.has_variations && a.terms && a.terms.length) addSpec(out, name, a.terms.map((t) => U.decodeEntities(t.name)).join(', '));
  }
  if (p.brands && p.brands[0] && !out.brand) out.brand = U.decodeEntities(p.brands[0].name);
  if (p.categories && p.categories.length) out.category = U.decodeEntities(p.categories[p.categories.length - 1].name);
  if (p.type === 'variable' && (!out.variants.length || out.variants.every((v) => !v.price))) {
    const vr = await http.getJson(`${u.origin}/wp-json/wc/store/v1/products?type=variation&parent=${p.id}&per_page=100`, { retries: 0, timeout: 15000, signal }).catch(() => null);
    if (vr && Array.isArray(vr.json) && vr.json.length) {
      out.variants = vr.json.map((v) => ({
        name: U.decodeEntities(v.variation || ''), sku: v.sku || '', ean: wooGtin(v),
        attrs: parseVarLabel(U.decodeEntities(v.variation || '')),
        price: v.prices ? money(v.prices.price) : 0, regular: v.prices ? money(v.prices.regular_price) : 0, inStock: v.is_in_stock === true ? true : v.is_in_stock === false ? false : null,
      }));
    }
  }
  out.code = out.mpn || out.sku || out.code;
}

function parseVarLabel(s) {
  const attrs = {};
  for (const part of String(s || '').split(/,\s*(?=[^,:]+:)/)) {
    const i = part.indexOf(':');
    if (i > 0) attrs[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return attrs;
}

function finish(out) {
  out.name = U.collapse(U.decodeEntities(out.name)).replace(/\s*[|–-]\s*[^|–-]{2,40}$/, (m) => (out.host && m.toLowerCase().includes(out.host.split('.')[0]) ? '' : m));
  out.brand = U.collapse(U.decodeEntities(out.brand));
  out.descText = U.stripTags(out.descHtml);
  // Features = bullet points of the official description
  const lis = (out.descHtml.match(/<li>([\s\S]*?)<\/li>/g) || []).map((x) => U.stripTags(x)).filter((x) => x.length > 2 && x.length < 220);
  out.features = [...new Set(lis)].slice(0, 25);
  // Variants: normalize attrs into size/colour
  out.variants = out.variants.map((v) => {
    const attrs = v.attrs || {};
    let size = v.size || '', color = v.color || '';
    for (const [k, val] of Object.entries(attrs)) {
      if (!size && /size|μέγεθ|μεγεθ|νούμερ|νουμερ/i.test(k)) size = val;
      else if (!color && /colou?r|χρώμ|χρωμ/i.test(k)) color = val;
    }
    // unknown stays unknown (it used to become «in stock»)
    return { name: v.name || '', sku: v.sku || '', ean: validGtin(v.ean), size: String(size || '').trim(), color: String(color || '').trim(), price: Number(v.price) || 0, regular: Number(v.regular) || 0, inStock: v.inStock === true ? true : v.inStock === false ? false : null };
  }).filter((v) => v.size || v.color).slice(0, 120);
  // the product's availability from its sizes / colours when the page said nothing for the product itself
  if (out.availability === 'unknown' && out.variants.length) out.availability = availAll(out.variants.map((v) => (v.inStock === true ? 'in' : v.inStock === false ? 'out' : 'unknown')));
  out.sku = U.collapse(U.decodeEntities(out.sku)); out.mpn = U.collapse(U.decodeEntities(out.mpn));
  out.ean = validGtin(out.ean);
  if (out.regular && out.regular <= out.price) out.regular = 0;
  if (out.currency && out.currency !== 'EUR') out.notes.push('Η τιμή της σελίδας είναι σε ' + out.currency + ', όχι σε ευρώ.');
}

function productFromJsonLd(blocks, pageUrl) {
  const prod = { found: false, name: '', brand: '', code: '', sku: '', mpn: '', ean: '', price: 0, regular: 0, currency: '', availability: 'unknown', description: '', images: [], variants: [], category: '', specs: [] };
  const nodes = [];
  for (let b of blocks) {
    b = String(b || '').trim();
    let data = null;
    try { data = JSON.parse(b); } catch (_) { try { data = JSON.parse(b.replace(/,\s*([\]}])/g, '$1').replace(/[\u0000-\u001f]+/g, ' ')); } catch (e) { data = null; } }
    if (data) collect(data, nodes, 0);
  }
  if (!nodes.length) return prod;
  prod.found = true;
  // the page's own product: the group of variants, else the one whose address is this page, else the first
  const samePage = (n) => { const u = n && (typeof n.url === 'string' ? n.url : n['@id']); if (!u || !pageUrl) return false; try { const a = new URL(u, pageUrl), b = new URL(pageUrl); return a.host === b.host && a.pathname.replace(/\/$/, '') === b.pathname.replace(/\/$/, ''); } catch (_) { return false; } };
  const main = nodes.find((n) => isType(n, 'ProductGroup')) || nodes.find(samePage) || nodes[0];
  prod.name = str(main.name);
  prod.sku = str(main.sku);
  prod.mpn = str(main.mpn);
  prod.code = prod.mpn || prod.sku || str(main.productGroupID || '');
  prod.ean = gtin(main);
  prod.brand = str(main.brand && typeof main.brand === 'object' ? main.brand.name : main.brand) || str(main.manufacturer && typeof main.manufacturer === 'object' ? main.manufacturer.name : '');
  prod.description = str(typeof main.description === 'string' ? main.description : '');
  prod.category = str(main.category);
  prod.images = imagesFrom(main.image);
  const o = offerInfo(main.offers);
  prod.price = o.price; prod.currency = o.currency; prod.regular = o.regular; prod.availability = o.availability;
  // technical facts the shop gives as data (additionalProperty): kept as specs
  for (const ap of [].concat(main.additionalProperty || []).slice(0, 30)) if (ap && typeof ap === 'object' && ap.name && ap.value != null) prod.specs.push({ k: str(ap.name), v: str(ap.value) + (ap.unitText ? ' ' + str(ap.unitText) : '') });
  // the variants: those the group names, or those that say they belong to it — NOT the other products of the page
  // (related products, «you may also like»: their photos and prices are another product's)
  const gid = str(main.productGroupID || main.sku || '');
  const belongs = (n) => n !== main && (n.isVariantOf || n.inProductGroupWithID) && (!gid || [].concat(n.inProductGroupWithID || []).map(str).includes(gid) || (n.isVariantOf && (str(n.isVariantOf.productGroupID) === gid || str(n.isVariantOf['@id']) === str(main['@id']))));
  const vars = Array.isArray(main.hasVariant) ? main.hasVariant : nodes.filter(belongs);
  const avs = [];
  for (const v of vars.slice(0, 120)) {
    if (!v || typeof v !== 'object') continue;
    const vo = offerInfo(v.offers);
    const attrs = {};
    if (v.size) attrs.size = str(typeof v.size === 'object' ? v.size.name : v.size);
    if (v.color) attrs.color = str(v.color);
    if (v.pattern && !attrs.color) attrs.color = str(v.pattern);
    prod.variants.push({ name: str(v.name), sku: str(v.sku), ean: gtin(v), attrs, price: vo.price, regular: vo.regular, inStock: vo.availability === 'in' ? true : vo.availability === 'out' ? false : null });
    avs.push(vo.availability);
    if (!prod.currency && vo.currency) prod.currency = vo.currency;
    prod.images.push(...imagesFrom(v.image));
  }
  // the product's price: the lowest of the sizes / colours IN STOCK when they say so (a cheaper size that is sold out
  // is no price — an «AggregateOffer» low price often is one); else the product's own, else the lowest variant's
  const told = prod.variants.filter((v) => v.price > 0 && v.inStock !== null);
  const inV = told.filter((v) => v.inStock);
  if (inV.length) prod.price = Math.min(...inV.map((v) => v.price));
  else if (!prod.price) { const any = prod.variants.filter((v) => v.price > 0); if (any.length) prod.price = Math.min(...any.map((v) => v.price)); }
  if (prod.availability === 'unknown' && avs.length) prod.availability = availAll(avs);
  prod.images = [...new Set(prod.images)];
  return prod;
}
function collect(d, out, depth) {
  if (depth > 6 || !d || typeof d !== 'object') return;
  if (isType(d, 'Product') || isType(d, 'ProductGroup')) { out.push(d); return; }
  // a list of products (a category page, «related products»): not this page's product
  if (isType(d, 'ItemList') || isType(d, 'OfferCatalog')) return;
  for (const [k, v] of Array.isArray(d) ? d.map((x, i) => [i, x]) : Object.entries(d)) if (k !== 'itemListElement' && k !== 'isRelatedTo' && k !== 'isSimilarTo' && v && typeof v === 'object') collect(v, out, depth + 1);
}
function isType(n, t) { const x = n && n['@type']; return Array.isArray(x) ? x.includes(t) : x === t; }
function str(v) { if (Array.isArray(v)) v = v[0]; return v == null || typeof v === 'object' ? '' : U.collapse(U.decodeEntities(String(v))); }
function gtin(n) {
  for (const k of ['gtin13', 'gtin', 'gtin12', 'gtin14', 'gtin8', 'ean']) {
    if (n && n[k]) { const g = str(n[k]).replace(/\D/g, ''); if (g.length >= 8) return g; }
  }
  return '';
}
function imagesFrom(img) {
  const out = [];
  for (const i of Array.isArray(img) ? img : img ? [img] : []) {
    if (typeof i === 'string') out.push(i);
    else if (i && typeof i === 'object') { if (typeof i.url === 'string') out.push(i.url); else if (typeof i.contentUrl === 'string') out.push(i.contentUrl); }
  }
  return out;
}
/** The offers of a product → { price, regular, currency, availability }: the lowest price IN STOCK (all of them when
 * none says), the crossed-out price (ListPrice / StrikethroughPrice), and in stock / out / unknown. */
function offerInfo(offers) {
  const none = { price: 0, regular: 0, currency: '', availability: 'unknown' };
  if (!offers || typeof offers !== 'object') return none;
  const list = (Array.isArray(offers) ? offers : (offers.offers && Array.isArray(offers.offers) ? offers.offers.concat([offers]) : [offers])).filter((o) => o && typeof o === 'object');
  if (!list.length) return none;
  const av = list.map((o) => availOf(o.availability));
  const inStock = list.filter((o, i) => av[i] === 'in');
  const pool = inStock.length ? inStock : list.filter((o, i) => av[i] !== 'out').length ? list.filter((o, i) => av[i] !== 'out') : list;
  let best = 0, cur = '', regular = 0;
  for (const o of pool) {
    let p = 0;
    if (o.price != null) p = U.parseNumber(o.price);
    else if (o.lowPrice != null) p = U.parseNumber(o.lowPrice);
    for (const ps of [].concat(o.priceSpecification || [])) {
      if (!ps || typeof ps !== 'object' || ps.price == null) continue;
      const v = U.parseNumber(ps.price);
      if (/ListPrice|StrikethroughPrice|MSRP|SRP/i.test(String(ps.priceType || ''))) regular = Math.max(regular, v);
      else if (!p) p = v;
    }
    if (p > 0 && (!best || p < best)) { best = p; cur = str(o.priceCurrency || (o.priceSpecification && [].concat(o.priceSpecification)[0] && [].concat(o.priceSpecification)[0].priceCurrency)); }
  }
  return { price: best, regular: regular > best ? regular : 0, currency: cur ? cur.toUpperCase() : '', availability: availAll(av) };
}
function offerPrice(offers) { const o = offerInfo(offers); return [o.price, o.currency]; }
function mergeWooVariations(out, json, imgs) {
  let vars;
  try { vars = JSON.parse(U.decodeEntities(json)); } catch (_) { return; }
  if (!Array.isArray(vars)) return;
  for (const v of vars.slice(0, 120)) {
    const attrs = {};
    for (const [k, val] of Object.entries(v.attributes || {})) {
      let dv = val; try { dv = decodeURIComponent(val); } catch (_) { /* keep */ }
      attrs[k.replace(/^attribute_(pa_)?/, '')] = dv;
    }
    out.variants.push({ name: Object.values(attrs).join(' / '), sku: v.sku || '', ean: validGtin(v.global_unique_id || v.gtin || v.ean || v._gtin || ''), attrs, price: Number(v.display_price) || 0, regular: Number(v.display_regular_price) || 0, inStock: v.is_in_stock === true ? true : v.is_in_stock === false ? false : null });
    if (v.image && v.image.full_src) imgs.push(v.image.full_src);
    if (!out.price && v.display_price) out.price = Number(v.display_price);
  }
}
function largestFromSrcset(ss) {
  let best = '', bw = 0;
  for (const part of ss.split(',')) {
    const bits = part.trim().split(/\s+/);
    if (!bits[0]) continue;
    const w = parseInt(bits[1], 10) || 1;
    if (w >= bw) { bw = w; best = bits[0]; }
  }
  return best;
}
function cleanImages(imgs, base) {
  const out = [], seen = new Set();
  for (let u of imgs) {
    u = U.decodeEntities(String(u || '')).trim();
    if (!u || /^(data|blob):/.test(u)) continue;
    if (u.startsWith('//')) u = 'https:' + u;
    else if (!/^https?:\/\//i.test(u)) { try { u = new URL(u, base).href; } catch (_) { continue; } }
    let path = '';
    try { path = new URL(u).pathname; } catch (_) { continue; }
    if (/\.(svg|ico|gif)$/i.test(path)) continue;
    const bn = path.split('/').pop();
    if (/(logo|icon|sprite|placeholder|loader|loading|spinner|banner|flag|payment|visa|mastercard|paypal|avatar|badge|rating|stars?[-_.]|social|facebook|instagram|youtube|tiktok|whatsapp|cart|arrow|pixel|blank\.)/i.test(bn)) continue;
    u = u.replace(/-\d{2,4}x\d{2,4}(\.(jpe?g|png|webp))(\?.*)?$/i, '$1$3');
    u = u.replace(/_(pico|icon|thumb|small|compact|medium|large|grande|\d+x\d*|x\d+)(@2x)?(\.(jpe?g|png|webp))/i, '$3');
    const key = u.replace(/\?.*$/, '').toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key); out.push(u);
    if (out.length >= 20) break;
  }
  return out;
}

/** Keep the text structure, drop everything else (classes, styles, scripts, images, links). */
function cleanHtml(html) {
  const root = parse('<div>' + String(html || '') + '</div>', { comment: false });
  const walk = (node) => {
    let s = '';
    for (const c of node.childNodes) {
      if (c.nodeType === 3) { s += U.escapeHtml(U.decodeEntities(c.rawText)); continue; }
      if (c.nodeType !== 1) continue;
      let tag = c.rawTagName ? c.rawTagName.toLowerCase() : '';
      if (['script', 'style', 'noscript', 'iframe', 'svg', 'form', 'button', 'select', 'input', 'img', 'video', 'picture', 'figure'].includes(tag)) continue;
      if (tag === 'h1') tag = 'h3';
      if (tag === 'h6') tag = 'h5';
      const inner = walk(c);
      if (tag === 'br') { s += '<br>'; continue; }
      if (ALLOWED.has(tag)) {
        if (!U.collapse(inner.replace(/<br>/g, '')) && tag !== 'td' && tag !== 'th') continue;
        s += `<${tag}>${inner.trim()}</${tag}>`;
      } else if (['div', 'section', 'article'].includes(tag)) {
        s += /<(p|ul|ol|table|h\d|div)/.test(inner) ? inner : (U.collapse(inner) ? `<p>${inner.trim()}</p>` : '');
      } else s += inner;
    }
    return s;
  };
  let out = walk(root.firstChild || root);
  out = out.replace(/^\s*<h\d>\s*(Περιγραφή|Description|Product description|Περιγραφή προϊόντος)\s*<\/h\d>/i, '');
  out = out.replace(/(<br>\s*){3,}/g, '<br><br>').replace(/\s{2,}/g, ' ').replace(/>\s+</g, '><').trim();
  return out;
}
function textToHtml(t) {
  return String(t || '').split(/\n{2,}|\r\n\r\n/).map((p) => U.collapse(p)).filter(Boolean).map((p) => `<p>${U.escapeHtml(p)}</p>`).join('');
}
function pick(o, keys) { const r = {}; for (const k of keys) if (o[k]) r[k] = o[k]; return r; }

module.exports = { fromUrl, fromHtml, finish, cleanHtml, cleanImages, textToHtml, parseVarLabel, availOf, offerInfo, offerPrice, commonCode, validGtin };
