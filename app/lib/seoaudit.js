'use strict';
// SF Κέντρο — the page of a product as Google reads it (Google Search Central: product structured data, product
// variants, canonical addresses, images). It reads what the site ALREADY produces (WooCommerce + Yoast / Rank Math) and
// says what is missing and how to fix it through the product's data (brand, EAN, colour as an attribute, photos, alt
// text) — it never adds a second structured-data block of its own (two blocks that disagree are worse than one).
const U = require('./util');

const LD = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;

function nodesOf(html) {
  const blocks = [];
  let m;
  LD.lastIndex = 0;
  while ((m = LD.exec(html))) {
    let j = null;
    try { j = JSON.parse(m[1].trim()); } catch (_) { try { j = JSON.parse(m[1].trim().replace(/[\u0000-\u001f]+/g, ' ')); } catch (e) { blocks.push({ bad: true }); continue; } }
    const nodes = [];
    const walk = (x, d) => { if (!x || d > 6) return; if (Array.isArray(x)) { for (const y of x) walk(y, d + 1); return; } if (typeof x !== 'object') return; const t = [].concat(x['@type'] || []); if (t.some((v) => /^(Product|ProductGroup)$/.test(v))) nodes.push(x); for (const [k, v] of Object.entries(x)) if (k !== 'hasVariant' && v && typeof v === 'object') walk(v, d + 1); };
    walk(j, 0);
    blocks.push({ nodes, plugin: /yoast/i.test(m[0] + m[1].slice(0, 300)) ? 'yoast' : /rank-?math/i.test(m[0]) ? 'rankmath' : '' });
  }
  return blocks;
}
const isT = (n, t) => [].concat(n['@type'] || []).includes(t);
const offersOf = (n) => [].concat(n.offers || []).flatMap((o) => (o && o.offers ? [].concat(o.offers) : [o])).filter(Boolean);
const priceOf = (o) => (o.price != null ? o.price : o.lowPrice != null ? o.lowPrice : [].concat(o.priceSpecification || []).map((p) => p && p.price).find((x) => x != null));
const gtinOf = (n) => ['gtin13', 'gtin', 'gtin12', 'gtin14', 'gtin8'].map((k) => n[k]).find(Boolean) || '';

/**
 * → { url, findings: [{ level: 'crit'|'warn'|'ok', area, text, fix }], summary: { productNodes, groups, variants, plugin } }
 */
function auditHtml(html, url, ctx) {
  const c = ctx || {};
  const f = [];
  const add = (level, area, text, fix) => f.push({ level, area, text, fix: fix || '' });
  const h = String(html || '');
  // canonical
  const can = (h.match(/<link[^>]+rel=["']canonical["'][^>]*href=["']([^"']+)["']/i) || h.match(/<link[^>]+href=["']([^"']+)["'][^>]*rel=["']canonical["']/i) || [])[1] || '';
  if (!can) add('crit', 'canonical', 'Η σελίδα δεν δηλώνει canonical διεύθυνση.', 'Ρύθμιση του Yoast / Rank Math (ενεργό by default).');
  else {
    try { const a = new URL(can, url), b = new URL(url); if (a.pathname.replace(/\/$/, '') !== b.pathname.replace(/\/$/, '')) add('warn', 'canonical', `Η canonical δείχνει άλλη σελίδα (${a.pathname}).`, 'Έλεγξε αν πρέπει (π.χ. διπλότυπο) — αλλιώς το Google δεν θα δείχνει αυτή τη σελίδα.'); else add('ok', 'canonical', 'Canonical: η ίδια η σελίδα, χωρίς παραμέτρους.'); } catch (_) { add('warn', 'canonical', 'Μη έγκυρη canonical διεύθυνση.'); }
  }
  // title / h1
  const title = U.collapse(U.decodeEntities((h.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || ''));
  if (!title) add('crit', 'τίτλος', 'Χωρίς <title>.');
  else if (title.length > 65) add('warn', 'τίτλος', `Ο τίτλος σελίδας είναι μεγάλος (${title.length} χαρ.): το Google κόβει μετά τους ~60.`, 'Πιο σύντομος SEO τίτλος στο Yoast.');
  if (!/<h1[\s>]/i.test(h)) add('warn', 'τίτλος', 'Χωρίς επικεφαλίδα H1 στη σελίδα.');
  // structured data
  const blocks = nodesOf(h);
  if (blocks.some((b) => b.bad)) add('crit', 'schema', 'Ένα JSON-LD της σελίδας δεν διαβάζεται (λάθος JSON).', 'Συνήθως από πρόσθετο ή χειροκίνητο κώδικα στο θέμα.');
  const tops = blocks.flatMap((b) => b.nodes.map((n) => Object.assign({ _plugin: b.plugin }, n)));
  const groups = tops.filter((n) => isT(n, 'ProductGroup'));
  const products = tops.filter((n) => isT(n, 'Product') && !groups.some((g) => (g.hasVariant || []).includes(n)));
  const mains = groups.length ? groups : products;
  if (!mains.length) { add('crit', 'schema', 'Η σελίδα δεν έχει δομημένα δεδομένα προϊόντος (Product).', 'WooCommerce + Yoast τα βγάζουν μόνα τους: έλεγξε ότι δεν τα έκλεισε κάποιο πρόσθετο.'); return { url, findings: f, summary: { productNodes: 0, groups: 0, variants: 0 } }; }
  // two blocks that both describe the product (e.g. the theme and Yoast): Google may read the wrong one
  const sources = new Set(blocks.filter((b) => b.nodes.length).map((b, i) => b.plugin || 'block' + i));
  if (mains.length > 1 || sources.size > 1) add('crit', 'schema', `Δύο ή περισσότερα δομημένα δεδομένα προϊόντος στην ίδια σελίδα (${mains.length}).`, 'Κράτα ένα (π.χ. του Yoast WooCommerce SEO) και κλείσε τα άλλα — ΜΗΝ προσθέσεις κι άλλο.');
  else add('ok', 'schema', `Ένα σύνολο δομημένων δεδομένων προϊόντος (${groups.length ? 'ProductGroup με ' + (groups[0].hasVariant || []).length + ' παραλλαγές' : 'Product'}).`);
  const m = mains[0];
  const brand = m.brand && (typeof m.brand === 'object' ? m.brand.name : m.brand);
  if (!brand) add('warn', 'schema', 'Χωρίς μάρκα (brand) στα δομημένα δεδομένα.', 'Βάλε μάρκα στο προϊόν (ιδιότητα «Κατασκευαστής» / Brands): το Yoast τη δείχνει μόνο του.');
  if (!m.image) add('warn', 'schema', 'Χωρίς φωτογραφία στα δομημένα δεδομένα.');
  const variants = groups.length ? [].concat(m.hasVariant || []) : [];
  if (groups.length) {
    if (!m.productGroupID) add('warn', 'παραλλαγές', 'Χωρίς productGroupID στο ProductGroup.');
    if (!m.variesBy) add('warn', 'παραλλαγές', 'Χωρίς variesBy (με τι διαφέρουν οι παραλλαγές: χρώμα / μέγεθος).', 'Το Yoast WooCommerce SEO δεν το βγάζει: το προτείνει η Google — χρειάζεται ρύθμιση του προσθέτου ή μικρό snippet που ΣΥΜΠΛΗΡΩΝΕΙ το ίδιο ProductGroup (όχι νέο block).');
    const skus = variants.map((v) => v.sku).filter(Boolean);
    if (skus.length < variants.length) add('warn', 'παραλλαγές', `${variants.length - skus.length} από ${variants.length} παραλλαγές χωρίς SKU.`);
    if (new Set(skus).size < skus.length) add('crit', 'παραλλαγές', 'Παραλλαγές με τον ίδιο SKU.');
    const weird = skus.filter((x) => /-\d{9,}$/.test(x));
    if (weird.length) add('warn', 'παραλλαγές', `SKU παραλλαγών με αυτόματο αριθμό (${weird.slice(0, 2).join(', ')}…).`, 'Δώσε σωστούς κωδικούς παραλλαγών (κωδικός κατασκευαστή ανά χρώμα/μέγεθος) ή κενό.');
    const g = variants.filter((v) => gtinOf(v)).length;
    if (g < variants.length) add('warn', 'παραλλαγές', `${variants.length - g} από ${variants.length} παραλλαγές χωρίς GTIN/EAN.`, 'Πεδίο «GTIN, UPC, EAN…» της παραλλαγής (WooCommerce 9.2+).');
    const noUrl = variants.filter((v) => !v.url || !/[?&]attribute_/.test(String(v.url))).length;
    if (noUrl) add('warn', 'παραλλαγές', `${noUrl} παραλλαγές χωρίς δική τους διεύθυνση (…?attribute_…=…).`); else if (variants.length) add('ok', 'παραλλαγές', 'Κάθε παραλλαγή έχει διεύθυνση που την προεπιλέγει (crawlable).');
    const imgs = new Set(variants.map((v) => JSON.stringify(v.image || '')));
    if (variants.length > 1 && imgs.size === 1) add('warn', 'φωτογραφίες', 'Όλες οι παραλλαγές έχουν την ίδια φωτογραφία.', 'Φωτογραφία ανά χρώμα στην παραλλαγή (το WooCommerce αλλάζει την κύρια φωτογραφία με την επιλογή).');
  } else {
    if (!m.sku) add('warn', 'schema', 'Χωρίς SKU.');
    if (!gtinOf(m)) add('warn', 'schema', 'Χωρίς GTIN/EAN.', 'Πεδίο «GTIN, UPC, EAN…» του προϊόντος (WooCommerce 9.2+) — από τον αντιπρόσωπο ή από ≥2 καταστήματα (Διορθώσεις → Κωδικοί).');
  }
  const items = groups.length ? variants : [m];
  const noOffer = items.filter((n) => !offersOf(n).length).length;
  const noPrice = items.filter((n) => offersOf(n).some((o) => priceOf(o) == null)).length;
  const noAvail = items.filter((n) => offersOf(n).some((o) => !o.availability)).length;
  if (noOffer) add('crit', 'προσφορά', `${noOffer} ${groups.length ? 'παραλλαγές' : 'προϊόν'} χωρίς Offer.`);
  if (noPrice) add('crit', 'προσφορά', `${noPrice} Offer χωρίς τιμή.`);
  if (noAvail) add('warn', 'προσφορά', `${noAvail} από ${items.length} Offer χωρίς διαθεσιμότητα (availability)${groups.length ? ' — στις παραλλαγές' : ''}.`, groups.length ? 'Το Yoast WooCommerce SEO δεν τη βάζει στις παραλλαγές: ρύθμιση/ενημέρωση του προσθέτου ή snippet που συμπληρώνει το ίδιο block.' : '');
  else if (items.length) add('ok', 'προσφορά', 'Τιμή και διαθεσιμότητα σε κάθε Offer.');
  // images: alt text of the product's own gallery (not the thumbnails of the rest of the page)
  const imgs = (h.match(/<div[^>]+woocommerce-product-gallery__image[^>]*>[\s\S]*?<img[^>]*>/gi) || []).map((x) => x.match(/<img[^>]*>/i)[0]);
  const noAlt = imgs.filter((t) => !/\balt=["'][^"']+["']/i.test(t)).length;
  if (imgs.length && noAlt) add('warn', 'φωτογραφίες', `${noAlt} από ${imgs.length} φωτογραφίες της γκαλερί χωρίς κείμενο alt.`, 'Κείμενο alt στη Βιβλιοθήκη πολυμέσων: «ΕΙΔΟΣ ΜΑΡΚΑ ΜΟΝΤΕΛΟ ΧΡΩΜΑ — όψη» (π.χ. «Σακίδιο Mil-Tec Assault Molle Small λαδί — μπροστά»).');
  else if (imgs.length) add('ok', 'φωτογραφίες', 'Όλες οι φωτογραφίες της γκαλερί έχουν alt.');
  // breadcrumbs, open graph
  if (!/BreadcrumbList/.test(h)) add('warn', 'πλοήγηση', 'Χωρίς breadcrumb στα δομημένα δεδομένα.');
  if (!/property=["']og:type["'][^>]*content=["']product/i.test(h)) add('warn', 'κοινωνικά', 'Το og:type δεν είναι «product».');
  // the family: separate products of one model (the family kit makes one page with the colours)
  if (c.family && c.family.proof === 'possible') add('info', 'οικογένεια', `Πιθανή οικογένεια: μοιάζει με ${c.family.members.length} ξεχωριστά προϊόντα ενός μοντέλου (${c.family.colours.join(', ')}), αλλά δεν το επιβεβαιώνουν ακόμα 2 ανεξάρτητα καταστήματα.`, 'Καμία μετατροπή ακόμα — πρώτα «Έρευνα internet» στα μέλη της.');
  else if (c.family) add('warn', 'οικογένεια', `Το προϊόν είναι ένα από ${c.family.members.length} ξεχωριστά προϊόντα του ίδιου μοντέλου (${c.family.colours.join(', ')}).`, 'Μία σελίδα με επιλογή χρώματος (ProductGroup + hasVariant) — Προϊόντα → Οικογένειες: έγκριση και αρχεία μετατροπής με ανακατευθύνσεις 301.');
  return { url, findings: f, summary: { productNodes: mains.length, groups: groups.length, variants: variants.length, plugin: [...sources].join(', '), title } };
}

/** Read the live page of one of our products and audit it. */
async function audit(site, id) {
  const catalog = require('./catalog');
  const p = catalog.byId(site).get(Number(id));
  if (!p || !p.url) throw new Error('Δεν βρέθηκε το προϊόν ή η διεύθυνσή του.');
  const r = await require('./http').get(p.url, { timeout: 30000, retries: 1 });
  let fam = null;
  try { fam = require('./families').ofProduct(site, p.id); } catch (_) { fam = null; }
  return Object.assign(auditHtml(r.text, r.url || p.url, { family: fam }), { checkedAt: U.nowIso() });
}

module.exports = { auditHtml, audit, nodesOf };
