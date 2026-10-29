'use strict';
// Free competitor price research for EVERY product.
//  1. The whole public catalog of each competitor shop is kept on this PC (lib/compcat.js), refreshed daily.
//  2. Each of our products is matched locally against those catalogs: brand + model words + codes,
//     with guards against look-alikes (PRO/MAX/II versions, shirt vs pants, women's, very different price).
//  3. Only "same product" matches set the suggested price; "similar" ones wait for a yes/no from the user,
//     and every answer is remembered for the next run.
const store = require('./store');
const settings = require('./settings');
const http = require('./http');
const compcat = require('./compcat');
const U = require('./util');

// Greek shops that sell the same kind of products (military/tactical gear, hunting, airguns), found by web search.
// Each one is checked by the program: the ones with a public catalog (WooCommerce/Shopify) are read automatically.
const SEED = [
  'tactical-corner.gr', 'army-market.gr', 'oyk-shop.gr', 'allaboutarmy.gr', 'amerikaniki-agora.gr', 'tacticalshop.gr', 'tacticalextreme.gr',
  'kopelakis.gr', 'no80511.gr', 'hellenic-arms.gr', 'sergeant.gr', 'hardgearhellas.gr', 'armyland.gr', 'armyaction.gr', 'polimprizo.gr', 'ergo-rocket.gr', 'espithas.gr',
  'diamanco.gr', 'gkioulekas.com.gr', 'airguncenter.gr', 'airgunshop.gr', 'kkeses.com', 'vasadis.shop', 'all4hobby.gr',
];
const SEED_VERSION = 2;

// ---------- Competitors ----------
function competitors() {
  let c = store.read('competitors', null);
  const meta = store.read('competitors-meta', { seed: c ? 1 : 0 });
  if (!c || (meta.seed || 0) < SEED_VERSION) {
    c = c || [];
    const have = new Set(c.map((x) => U.hostOf(x.url).replace(/^www\./, '')));
    for (const d of SEED) if (!have.has(d)) c.push({ id: U.uid('c'), name: d.replace(/\.(gr|com|shop)$/, '').replace(/\.com$/, ''), url: 'https://' + d, kind: 'auto', enabled: true, searchUrl: '', status: '', checkedAt: null });
    store.write('competitors', c);
    store.write('competitors-meta', { seed: SEED_VERSION });
  }
  return c;
}
function competitorsView() {
  return competitors().map((c) => Object.assign({}, c, { catalog: compcat.info(c.id) }));
}
function saveCompetitor(input) {
  const all = competitors();
  const url = U.normUrl(input.url);
  if (!url) throw new Error('Δώσε τη διεύθυνση του καταστήματος.');
  const own = ['sf', 'st'].map((s) => U.hostOf(settings.all().sites[s].url));
  if (own.includes(U.hostOf(url))) throw new Error('Αυτό είναι δικό σας site.');
  let c = input.id ? all.find((x) => x.id === input.id) : null;
  if (!c && all.some((x) => U.hostOf(x.url) === U.hostOf(url))) throw new Error('Υπάρχει ήδη στη λίστα.');
  if (!c) { c = { id: U.uid('c'), kind: 'auto', status: '', checkedAt: null }; all.push(c); }
  const hostChanged = c.url && U.hostOf(url) !== U.hostOf(c.url);
  Object.assign(c, { name: U.collapse(input.name || U.hostOf(url)), url, enabled: input.enabled !== false, searchUrl: String(input.searchUrl || '').trim() });
  if (hostChanged) { c.kind = 'auto'; compcat.remove(c.id); }
  if (input.kind) c.kind = input.kind;
  store.write('competitors', all);
  return c;
}
function removeCompetitor(id) { store.write('competitors', competitors().filter((c) => c.id !== id)); compcat.remove(id); }

/** Find out how we can read a competitor: WooCommerce Store API, Shopify, or only manual. */
async function detect(c) {
  try {
    const r = await http.getJson(`${c.url}/wp-json/wc/store/v1/products?per_page=1`, { retries: 0, timeout: 15000 });
    if (Array.isArray(r.json)) return { kind: 'woo', status: 'Αυτόματα (WooCommerce) · ' + (parseInt(r.headers.get('x-wp-total') || '0', 10) || '?') + ' προϊόντα' };
  } catch (e) { if (/Cloudflare/.test(e.message)) return { kind: 'manual', status: 'Μπλοκάρει την αυτόματη ανάγνωση (Cloudflare) — μόνο χειροκίνητα' }; }
  try {
    const r = await http.getJson(`${c.url}/products.json?limit=1`, { retries: 0, timeout: 15000 });
    if (r.json && Array.isArray(r.json.products)) return { kind: 'shopify', status: 'Αυτόματα (Shopify)' };
  } catch (_) { /* not shopify */ }
  return { kind: 'manual', status: 'Δεν έχει δημόσιο κατάλογο — μόνο χειροκίνητα (άνοιγμα αναζήτησης)' };
}
async function detectAll(job, only) {
  const all = competitors();
  const list = only ? all.filter(only) : all;
  let i = 0;
  await http.pool(list, 4, async (c) => {
    const d = await detect(c);
    Object.assign(c, d, { checkedAt: U.nowIso() });
    job && job.progress(++i, list.length, c.name + ': ' + d.status);
  });
  store.write('competitors', all);
  return all;
}
function searchUrlFor(c, q) {
  const tpl = c.searchUrl || (c.kind === 'shopify' ? '{url}/search?q={q}' : '{url}/?s={q}&post_type=product');
  return tpl.replace('{url}', c.url).replace('{q}', encodeURIComponent(q));
}

// ---------- Words of a product name ----------
const COLORS = new Set(['BLACK', 'WHITE', 'GREY', 'GRAY', 'NAVY', 'BLUE', 'RED', 'BROWN', 'GREEN', 'OLIVE', 'KHAKI', 'BEIGE', 'SAND', 'TAN', 'COYOTE', 'ORANGE', 'YELLOW', 'MULTICAM', 'WOODLAND', 'CAMO', 'FLECKTARN', 'ATACS', 'ACU', 'UCP', 'MARPAT', 'OD', 'FOLIAGE', 'MOSS', 'RAL', 'CLEAR', 'SMOKE', 'ROSE', 'BRONZE', 'CHAMPAGNE', 'COPPER', 'TITANIUMGREY', 'PINK', 'PURPLE', 'SILVER', 'GOLD', 'CHARCOAL', 'STONE', 'DESERT', 'URBAN', 'DIGITAL', 'NIGHT', 'ARID', 'TROPIC', 'ALPINE', 'MC', 'BLK', 'GRN', 'WHT', 'NAVYBLUE', 'DARKBLUE', 'LIGHTBLUE', 'DARKGREY', 'LIGHTGREY']);
const SIZES = new Set(['XS', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL', '2XL', '3XL', '4XL', '5XL', 'XXS', 'ONE', 'SIZE', 'ONESIZE']);
// Materials and general words: they exist in many products, so they never prove "same model" on their own.
const WEAK = new Set(['CORDURA', 'NYLON', 'LEATHER', 'COTTON', 'POLYESTER', 'RIPSTOP', 'MOLLE', 'VELCRO', 'CANVAS', 'NEOPRENE', 'KEVLAR', 'TPU', 'ABS', 'ALUMINUM', 'ALUMINIUM', 'STEEL', 'RUBBER', 'SILICONE', 'PVC', 'EVA', 'G10', 'UNIVERSAL', 'UTILITY', 'MULTI', 'ADJUSTABLE', 'BASIC', 'CLASSIC', 'STANDARD', 'QUICK', 'DRY', 'QUICKDRY', 'FIELD', 'DUTY', 'HEAVY', 'LIGHT', 'LIGHTWEIGHT', 'SPORT', 'PREMIUM', 'HD', 'TACTICAL', 'COMBAT', 'SHOOTING', 'HUNTING', 'OPERATOR', 'ASSAULT', 'PATROL', 'RANGER', 'SPECIAL', 'FORCES', 'SECURITY', 'TRAINING']);
// Words that say what the product is or describe it: they must not decide the "same model" question.
const FILLER = new Set(['TACTICAL', 'NEW', 'ORIGINAL', 'MEN', 'MENS', 'UNISEX', 'WITH', 'AND', 'FOR', 'THE', 'OF', 'IN', 'SET', 'KIT', 'LUMENS', 'LUMEN', 'EDITION', 'SERIES', 'STYLE', 'TYPE', 'MODEL', 'MOD', 'ARMY', 'MILITARY', 'POLICE', 'OUTDOOR', 'OUTDOORS', 'GEAR', 'COLOR', 'COLOUR', 'BY', 'TO', 'A', 'W', 'WATERPROOF', 'LED', 'PCS', 'PC',
  'PANTS', 'PANT', 'TROUSERS', 'TROUSER', 'SHORTS', 'SHIRT', 'TSHIRT', 'TEE', 'POLO', 'JACKET', 'PARKA', 'SOFTSHELL', 'FLEECE', 'HOODIE', 'SWEATSHIRT', 'VEST', 'BOOT', 'BOOTS', 'SHOES', 'SHOE', 'CAP', 'HAT', 'BERET', 'BEANIE', 'GLOVES', 'GLOVE', 'POUCH', 'HOLSTER', 'CASE', 'BELT', 'BACKPACK', 'RUCKSACK', 'BAG', 'FLASHLIGHT', 'TORCH', 'HEADLAMP', 'KNIFE', 'SOCKS', 'SCOPE', 'RIFLESCOPE', 'BINOCULAR', 'BINOCULARS', 'WATCH', 'SUNGLASSES', 'GLASSES', 'PATCH']);
// A competitor title with one of these extra words is another version of the model.
const MODIFIERS = new Set(['PRO', 'PLUS', 'MAX', 'MINI', 'MICRO', 'NANO', 'LITE', 'II', 'III', 'IV', 'V2', 'V3', 'V4', 'MK2', 'MKII', 'MK3', 'GEN', 'GEN2', 'GEN3', 'GEN4', 'GEN5', 'ULTRA', 'ELITE', 'COMPACT', 'CARRY', 'SUBCOMPACT', 'SLIM', 'XL', 'XXL', 'LONG', 'SHORT', 'LOW', 'MID', 'HIGH', 'WOMEN', 'WOMENS', 'LADY', 'LADIES', 'KIDS', 'KID', 'JUNIOR', 'JR', 'YOUTH', 'GTX', 'GORETEX', 'WP', 'WIDE', 'SE', 'EVO', 'RS', 'LE', 'SPECIAL', 'LIMITED', 'TI', 'TITANIUM', 'CARBON', 'SIDEZIP', 'SZ', 'ZIP', 'INSULATED', 'COMPOSITE', 'SAFETY', 'XP', 'XT', 'XR', 'R', 'RT', 'T', 'X',
  'SMALL', 'MEDIUM', 'LARGE', 'REGULAR', 'PORTED', 'HOLLOW', 'THREADED', 'LASER', 'WOOD', 'WALNUT', 'SYNTHETIC', 'POLYMER', 'STAINLESS', 'INOX', 'BLUED', 'CERAKOTE', 'TARGET', 'COMP', 'COMPETITION', 'MATCH', 'OR', 'NEXTGEN', 'ADVANCED', 'MITT', 'MITTS', 'MITTEN', 'LEFT', 'RIGHT', 'LH', 'RH']);
const ntok = (t) => t.replace(/[-./]/g, '');
const SPEC = /^\d+(?:[.,]\d+)?(?:MM|CM|M|ML|LT|L|LTR|G|GR|KG|LM|MAH|W|V|OZ|IN|INCH|ΕΚ|ΜΜ|ΓΡ)$/;

function tokensOf(name) {
  return U.greekUpper(U.untexturize(U.decodeEntities(name))).replace(/["'«»()[\],;:!?+*&|]/g, ' ').split(/\s+/).filter(Boolean).map((t) => U.fixMixedScript(t).text);
}
const GENERIC_BRAND = new Set(['TACTICAL', 'GEAR', 'OUTDOOR', 'OUTDOORS', 'ARMS', 'INC', 'CO', 'GMBH', 'LTD', 'USA', 'INTERNATIONAL', 'GROUP', 'THE', 'EQUIPMENT', 'APPAREL', 'TEX', 'DEFENSE', 'DEFENCE', 'INDUSTRIES', 'KNIVES', 'OPTICS']);
function brandTokens(brand) { return tokensOf(brand || '').map(ntok).filter((t) => t && !GENERIC_BRAND.has(t)); }

/** Latin/number words that identify the model (brand, colours, sizes, type words left out). */
function keyTokens(name, brand) {
  const bt = new Set(tokensOf(brand || '').map(ntok));
  const out = [];
  const toks = tokensOf(name);
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    // a unit after a number is one word: 9 MM = 9MM, 100 ML = 100ML
    if (/^(MM|CM|ML|LT|LTR|G|GR|KG|MAH|W|V|OZ|LB|LBS|IN|INCH|LM|M|ΕΚ|ΓΡ|ΜΜ|ΛΙΤΡΑ)\.?$/.test(t) && i > 0 && /^\d+(?:[.,]\d+)?$/.test(toks[i - 1])) {
      const prev = ntok(toks[i - 1]);
      const at = out.indexOf(prev);
      const merged = prev + t.replace('.', '');
      if (at >= 0) out[at] = merged; else out.push(merged);
      continue;
    }
    // a single letter right after a model number belongs to it: P-10 S, P-10 C, GLOCK 19 X
    if (/^[A-Z]$/.test(t) && i > 0 && /\d/.test(toks[i - 1]) && !/[\u0370-\u03ff]/.test(toks[i - 1])) {
      const prev = ntok(toks[i - 1]);
      const at = out.indexOf(prev);
      if (at >= 0) out[at] = prev + t; else out.push(prev + t);
      continue;
    }
    // Greek words describe the type, not the model — but numbers count (9ΒΟΛΑ, 12ΓΡ, 70ΕΚ)
    if (/[Ͱ-Ͽ]/.test(t) && !/\d/.test(t)) continue;
    const n = ntok(t);
    if (!n || bt.has(n) || COLORS.has(n) || SIZES.has(n) || FILLER.has(n)) continue;
    out.push(n);
  }
  return [...new Set(out)];
}
function codeTokens(name, sku) {
  const set = new Set();
  for (const t of tokensOf(name + ' ' + (sku || ''))) {
    const n = ntok(t);
    if (SPEC.test(n) || /^\d+X\d+(MM)?$/.test(n) || /^\d+(GA|CAL|MAG)$/.test(n)) continue; // sizes, calibres, units
    if (n.length >= 4 && /\d/.test(n) && /[A-Z]/.test(n)) set.add(n);
    else if (/^\d{5,}$/.test(n)) set.add(n);
  }
  return [...set];
}
function tokenSet(name, sku) {
  const toks = tokensOf(name + ' ' + (sku || '')).map(ntok).filter(Boolean);
  const set = new Set(toks);
  for (let i = 0; i < toks.length - 1; i++) set.add(toks[i] + toks[i + 1]); // "MH 40" = "MH40", "MAX S" = "MAXS"
  return set;
}

// Product type groups, so a BDU shirt never counts as the same product as BDU pants.
const TYPE_GROUPS = [
  ['ΠΑΝΤΕΛ', 'PANTS', 'PANT', 'TROUSERS', 'TROUSER', 'CARGO'], ['ΒΕΡΜΟΥΔ', 'ΣΟΡΤΣ', 'SHORTS'], ['ΠΟΥΚΑΜ', 'ΧΙΤΩΝ', 'SHIRT'], ['ΜΠΛΟΥΖ', 'ΦΑΝΕΛ', 'ΠΟΛΟ', 'TSHIRT', 'TEE', 'POLO'],
  ['ΜΠΟΥΦΑΝ', 'JACKET', 'PARKA', 'ΑΝΤΙΑΝΕΜ', 'SOFTSHELL'], ['ΖΑΚΕΤ', 'FLEECE', 'ΦΟΥΤΕΡ', 'HOODIE', 'SWEATSHIRT'], ['ΓΙΛΕΚ', 'ΑΜΑΝΙΚ', 'ΦΟΡΕΑ', 'VEST', 'CARRIER', 'RIG'],
  ['ΑΡΒΥΛ', 'ΜΠΟΤ', 'BOOT', 'BOOTS', 'ΠΑΠΟΥΤΣ', 'SHOES', 'SHOE'], ['ΚΑΠΕΛ', 'CAP', 'HAT', 'ΤΖΟΚΕ', 'ΜΠΕΡΕ', 'BERET', 'ΣΚΟΥΦ', 'BEANIE'],
  ['ΓΑΝΤ', 'GLOVES', 'GLOVE'], ['ΘΗΚ', 'POUCH', 'HOLSTER', 'CASE'], ['ΖΩΝ', 'BELT'], ['ΣΑΚΙΔ', 'BACKPACK', 'RUCKSACK'], ['ΤΣΑΝΤ', 'BAG', 'ΣΑΚΟΣ'],
  ['ΦΑΚΟ', 'FLASHLIGHT', 'TORCH', 'HEADLAMP'], ['ΜΑΧΑΙΡ', 'KNIFE', 'ΣΟΥΓΙΑ'], ['ΚΑΛΤΣ', 'SOCKS'], ['ΔΙΟΠΤΡ', 'SCOPE', 'RIFLESCOPE'], ['ΚΙΑΛ', 'BINOCULAR', 'BINOCULARS'],
  ['ΓΥΑΛ', 'SUNGLASSES', 'GLASSES', 'GOGGLES'], ['ΡΟΛΟ', 'WATCH'], ['ΣΗΜΑ', 'PATCH'],
  ['ΠΙΣΤΟΛ', 'ΠΕΡΙΣΤΡΟΦ', 'PISTOL', 'HANDGUN', 'REVOLVER'], ['ΚΑΡΑΜΠΙΝ', 'SHOTGUN'], ['ΤΥΦΕΚ', 'ΤΟΥΦΕΚ', 'RIFLE'], ['ΓΕΜΙΣΤΗΡ', 'MAGAZINE'],
  ['ΦΥΣΙΓΓ', 'AMMO', 'AMMUNITION', 'CARTRIDGES', 'SHELLS'], ['ΒΛΗΜΑΤ', 'ΒΟΛΙΔ', 'ΣΚΑΓΙ', 'PELLETS', 'BBS'], ['ΣΚΟΠΕΥΤ', 'SIGHT', 'REDDOT'],
  ['ΦΙΛΤΡ', 'FILTER'], ['ΜΕΓΕΘΥΝΤ', 'MAGNIFIER'], ['ΜΠΑΤΑΡ', 'BATTERY', 'BATTERIES'], ['ΦΟΡΤΙΣΤ', 'CHARGER'], ['ΣΚΗΝ', 'TENT'], ['ΥΠΝΟΣΑΚ', 'SLEEPING'],
];
function typeGroupsOf(toks) {
  const groups = new Set();
  for (const t of toks) {
    const n = ntok(t);
    TYPE_GROUPS.forEach((g, i) => { if (g.some((w) => (/[Ͱ-Ͽ]/.test(w) ? n.startsWith(w) : n === w))) groups.add(i); });
  }
  return groups;
}
const PATTERNS = new Set(['MULTICAM', 'KRYPTEK', 'ATACS', 'PENCOTT', 'CAMO', 'WOODLAND', 'FLECKTARN', 'MARPAT', 'DIGITAL', 'URBAN', 'ACU', 'UCP', 'TROPIC', 'ARID', 'ALPINE', 'SNOW', 'TIGER', 'REALTREE', 'MOSSYOAK']);
const COLOR_ALIAS = { GRAY: 'GREY', OD: 'OLIVE', BLK: 'BLACK', GRN: 'GREEN', WHT: 'WHITE', NAVYBLUE: 'NAVY', DARKBLUE: 'NAVY', MC: 'MULTICAM' };
const GREEK_COLORS = [[/^ΜΑΥΡ/, 'BLACK'], [/^(ΛΕΥΚ|ΑΣΠΡ)/, 'WHITE'], [/^ΓΚΡΙ/, 'GREY'], [/^ΜΠΛΕ/, 'BLUE'], [/^ΚΟΚΚΙΝ/, 'RED'], [/^ΚΑΦΕ/, 'BROWN'], [/^ΠΡΑΣΙΝ/, 'GREEN'],
  [/^ΛΑΔΙ/, 'OLIVE'], [/^ΧΑΚΙ/, 'KHAKI'], [/^ΜΠΕΖ/, 'BEIGE'], [/^ΠΟΡΤΟΚΑΛ/, 'ORANGE'], [/^ΚΙΤΡΙΝ/, 'YELLOW'], [/^ΡΟΖ$/, 'PINK'], [/^ΜΩΒ$/, 'PURPLE'], [/^ΑΣΗΜ/, 'SILVER'],
  [/^ΧΡΥΣ/, 'GOLD'], [/^ΠΑΡΑΛΛΑΓ/, 'CAMO'], [/^ΕΡΗΜΟΥ$/, 'DESERT'], [/^ΑΜΜΟΥ$/, 'SAND'], [/^ΜΠΟΡΝΤΟ/, 'RED'], [/^ΔΙΑΦΑΝ/, 'CLEAR'], [/^ΦΙΜΕ$/, 'SMOKE']];
function colorsOf(toks) {
  const out = new Set();
  for (const t of toks) {
    const n = ntok(t);
    if (COLORS.has(n) || PATTERNS.has(n)) out.add(COLOR_ALIAS[n] || n);
    else if (/^[Α-Ω]+$/.test(n)) { const g = GREEK_COLORS.find(([re]) => re.test(n)); if (g) out.add(g[1]); }
  }
  return out;
}
const USED = /ΜΕΤΑΧΕΙΡΙΣΜΕΝ|\bUSED\b|\bΜΤΧ\b|ΣΕ (ΚΑΛΗ|ΑΡΙΣΤΗ|ΠΟΛΥ ΚΑΛΗ) ΚΑΤΑΣΤΑΣΗ|\bREFURBISHED\b|\bΕΚΘΕΣΙΑΚΟ\b/;
const FLAGS = [
  [/ΑΝΤΑΛΛΑΚΤΙΚ|\bREPLACEMENT\b|\bSPARE\b|\bREFILL\b/, 'ανταλλακτικό'],
  [/ΜΕΓΑΛ|\bLARGE\b|\bBIG\b/, 'μέγεθος', /ΜΙΚΡ|\bSMALL\b/],
  [/ΑΡΙΣΤΕΡ|\bLEFT\b|\bLH\b|\bLEFTY\b/, 'αριστερόχειρο'],
  [/ΗΛΕΚΤΡΟΝΙΚ|\bELECTRONIC\b|\bDIGITAL LOCK\b/, 'ηλεκτρονική κλειδαριά', /ΚΛΕΙΔΙΟΥ|\bKEY LOCK\b/],
  [/ΚΟΝΤΟΜΑΝΙΚ|\bSHORT SLEEVE|\bS\/S\b|\bSS\b/, 'κοντομάνικο', /ΜΑΚΡΥΜΑΝΙΚ|\bLONG SLEEVE|\bL\/S\b|\bLS\b/],
];
function flagsOf(up) { return FLAGS.map(([a, , b]) => (a.test(up) ? 1 : b && b.test(up) ? -1 : 0)); }
const WOMEN = /ΓΥΝΑΙΚ|\bWOMEN|\bWOMAN|\bLADY|\bLADIES|\bWMNS\b|\bW'S\b/;
const KIDS = /ΠΑΙΔΙΚ|\bKIDS?\b|\bJUNIOR\b|\bYOUTH\b|\bJR\b/;

/** Everything about one of OUR products that the matching needs. */
function features(p) {
  const toks = tokensOf(p.name);
  const up = toks.join(' ');
  const keys = keyTokens(p.name, p.brand);
  const sku = U.normSku(p.sku || '');
  return {
    name: p.name, price: p.price || 0, brand: p.brand || '', bt: brandTokens(p.brand), brandKey: U.foldKey(p.brand || ''),
    keys, alpha: keys.filter((k) => /[A-Z]/.test(k)), digits: keys.filter((k) => /\d/.test(k)), codes: codeTokens(p.name, ''),
    sku: sku.length >= 6 || (/\d/.test(sku) && /[A-Z]/.test(sku) && sku.length >= 4) ? sku : '',
    group: (() => { const g = typeGroupsOf(toks.slice(0, 1)); return g.size ? [...g][0] : -1; })(),
    groups: typeGroupsOf(toks), colors: colorsOf(toks), used: USED.test(up), flags: flagsOf(up),
    women: WOMEN.test(up), kids: KIDS.test(up),
  };
}
/** The same for a competitor product (computed once per catalog). */
function candFeatures(c) {
  const toks = tokensOf(c.n);
  const up = toks.join(' ');
  return {
    set: tokenSet(c.n, c.s), keys: keyTokens(c.n, c.b), groups: typeGroupsOf(toks), brandKey: U.foldKey(c.b || ''), nameKey: ' ' + U.foldKey(c.n) + ' ',
    sku: U.normSku(c.s || ''), women: WOMEN.test(up), kids: KIDS.test(up), colors: colorsOf(toks), used: USED.test(up),
    codes: codeTokens(c.n, ''), flags: flagsOf(up),
  };
}

/**
 * Is a competitor product the same as ours?  → { match: exact|similar|none, score 0..1, why }
 * exact = same brand and every model word/code of ours is there, no extra version word, same type, same gender,
 * a believable price. similar = probably, but something is missing → the user decides.
 */
function compare(f, cand, cf) {
  const brandOk = f.bt.length ? (f.bt.some((b) => cf.set.has(b)) || (f.brandKey && (cf.brandKey === f.brandKey || cf.nameKey.includes(' ' + f.brandKey + ' ')))) : false;
  if (f.bt.length && cf.brandKey && !brandOk) return { match: 'none', score: 0 }; // another brand
  const skuHit = !!(f.sku && cf.sku && f.sku === cf.sku);
  const hit = f.keys.filter((k) => cf.set.has(k));
  const ratio = f.keys.length ? hit.length / f.keys.length : 0;
  if (!brandOk && !skuHit) {
    // our product has no brand: at most "similar", and only when every model word is there
    if (!f.bt.length && ratio === 1 && f.keys.length >= 2 && (f.group < 0 || !cf.groups.size || cf.groups.has(f.group))) return { match: 'similar', score: 0.5, why: 'Το δικό μας προϊόν δεν έχει μάρκα', how: 'words' };
    return { match: 'none', score: 0 };
  }
  const codeHit = f.codes.some((c) => cf.set.has(c));
  const digitsOk = f.digits.every((k) => cf.set.has(k));
  const alphaOk = !f.alpha.length || f.alpha.some((k) => cf.set.has(k));
  if (!skuHit && !codeHit && (!alphaOk || !hit.length)) return { match: 'none', score: Math.round(ratio * 100) / 100 };
  // their model words that we do not have
  const ourSet = new Set(f.keys);
  const brandSet = new Set(f.bt);
  const extra = cf.keys.filter((k) => !ourSet.has(k) && !brandSet.has(k) && ![...ourSet].some((o) => o.length >= 3 && k.length >= 3 && (o.includes(k) || k.includes(o))));
  const theirKeys = cf.keys.filter((k) => !brandSet.has(k));
  const back = theirKeys.length ? (theirKeys.length - extra.length) / theirKeys.length : 1;
  // different kind of product (shirt vs pants, pouch vs bag): not the same, whatever the model words say
  if (f.groups.size && cf.groups.size && ![...f.groups].some((g) => cf.groups.has(g))) return { match: 'none', score: 0 };
  const groupsDiffer = f.groups.size && cf.groups.size && ([...f.groups].some((g) => !cf.groups.has(g)) || [...cf.groups].some((g) => !f.groups.has(g)));
  let match = 'none', why = '';
  if (skuHit) match = 'exact';
  else if (codeHit && digitsOk && ratio >= 0.75) match = 'exact';
  else if (ratio === 1 && f.keys.length >= 1) match = 'exact';
  else if (ratio >= 0.6 || codeHit) { match = 'similar'; why = 'Λείπει από τον τίτλο τους: ' + f.keys.filter((k) => !cf.set.has(k)).slice(0, 3).join(' '); }
  if (match === 'none') return { match, score: Math.round(ratio * 100) / 100 };
  const missing = f.keys.filter((k) => !cf.set.has(k));
  if (match === 'exact' && !skuHit) {
    const mod = extra.find((k) => MODIFIERS.has(k));
    const lost = missing.find((k) => MODIFIERS.has(k));
    const code = extra.find((k) => cf.codes.includes(k) || /^[A-Z]{1,3}\d{1,3}[A-Z]?$/.test(k));
    const realHit = hit.some((k) => !MODIFIERS.has(k) && !WEAK.has(k) && /[A-Z]/.test(k));
    if (mod) { match = 'similar'; why = `Έχει επιπλέον «${mod}» (άλλη έκδοση;)`; }
    else if (lost) { match = 'similar'; why = `Δεν έχει το «${lost}» (άλλη έκδοση;)`; }
    else if (code) { match = 'similar'; why = `Έχει άλλο κωδικό μοντέλου «${code}»`; }
    else if (!realHit && !codeHit) { match = 'similar'; why = 'Ταιριάζουν μόνο γενικές λέξεις/νούμερα (' + hit.join(' ') + ')'; }
    else if (missing.some((k) => /\d/.test(k) || (k.length <= 4 && /^[A-Z]+$/.test(k)))) { match = 'similar'; why = 'Δεν έχει το «' + missing.find((k) => /\d/.test(k) || k.length <= 4) + '» (άλλη έκδοση;)'; }
    else if (missing.length && extra.length) { match = 'similar'; why = `Εμείς «${missing.slice(0, 2).join(' ')}», εκείνοι «${extra.slice(0, 2).join(' ')}»`; }
    else if (extra.length && back < 0.75) { match = 'similar'; why = 'Ο τίτλος τους έχει κι άλλες λέξεις: ' + extra.slice(0, 3).join(' '); }
    else if (groupsDiffer) { match = 'similar'; why = 'Άλλο είδος;'; }
    else if (back < 0.5 && extra.length >= 2) { match = 'similar'; why = 'Ο τίτλος τους έχει κι άλλες λέξεις μοντέλου: ' + extra.slice(0, 3).join(' '); }
  }
  if (match === 'exact' && !skuHit) {
    const fi = f.flags.findIndex((v, i) => (FLAGS[i][2] ? v * cf.flags[i] === -1 : v !== cf.flags[i]));
    if (fi >= 0) { match = 'similar'; why = 'Διαφέρει: ' + FLAGS[fi][1]; }
  }
  if (f.used || cf.used) { if (f.used !== cf.used) { match = 'similar'; why = 'Μεταχειρισμένο / καινούργιο'; } }
  if (match === 'exact' && (f.women !== cf.women || f.kids !== cf.kids)) { match = 'similar'; why = f.women !== cf.women ? 'Γυναικείο / ανδρικό;' : 'Παιδικό;'; }
  // colours: same model in another solid colour costs the same; another camo pattern often does not
  let colour = 0;
  if (f.colors.size && cf.colors.size) {
    const common = [...f.colors].some((c) => cf.colors.has(c));
    colour = common ? 1 : -1;
    if (!common && match === 'exact' && !skuHit) {
      const pat = [...f.colors, ...cf.colors].some((c) => PATTERNS.has(c));
      if (pat) { match = 'similar'; why = 'Άλλο χρώμα/παραλλαγή: ' + [...cf.colors].join(' '); } else why = 'Άλλο χρώμα (' + [...cf.colors].join(' ') + ')';
    }
  }
  if (match === 'exact' && !skuHit && f.price > 0 && cand.p > 0) {
    const r = cand.p / f.price;
    if (r < 0.45 || r > 2.2) { match = 'similar'; why = 'Πολύ διαφορετική τιμή (ίσως άλλο προϊόν ή συσκευασία)'; }
  }
  return { match, score: Math.round((skuHit || codeHit ? 1 : ratio) * Math.max(0.5, back) * 100) / 100 + colour * 0.05, why, how: skuHit ? 'sku' : codeHit ? 'code' : 'words' };
}

// Backwards compatible single comparison (used for products found by search).
function score(our, cand) {
  const c = { n: cand.name, s: cand.sku, b: cand.brand, p: cand.price };
  return compare(features(our), c, candFeatures(c));
}

// ---------- Index of a competitor catalog ----------
const idxCache = new Map();
function indexFor(compId) {
  const cat = compcat.load(compId);
  const hit = idxCache.get(compId);
  if (hit && hit.cat === cat) return hit;
  const items = cat.products || [];
  const feats = new Array(items.length);
  const post = new Map();
  items.forEach((c, i) => {
    const cf = candFeatures(c);
    feats[i] = cf;
    for (const t of cf.set) { let a = post.get(t); if (!a) post.set(t, (a = [])); a.push(i); }
    if (cf.sku) { const k = '#' + cf.sku; let a = post.get(k); if (!a) post.set(k, (a = [])); a.push(i); }
  });
  const res = { cat, items, feats, post };
  idxCache.set(compId, res);
  return res;
}

/** Best offer of one competitor for one of our products. */
function bestIn(f, ix, comp, confirmed, ignored) {
  const cand = new Set();
  const add = (k) => { const a = ix.post.get(k); if (a && a.length <= 600) for (const i of a) cand.add(i); };
  if (f.sku) add('#' + f.sku);
  for (const c of f.codes) add(c);
  // the two rarest model words are enough to find every candidate
  const ks = f.keys.map((k) => [k, (ix.post.get(k) || []).length]).filter((x) => x[1] > 0).sort((a, b) => a[1] - b[1]).slice(0, 2);
  for (const [k] of ks) add(k);
  let best = null;
  for (const i of cand) {
    const c = ix.items[i];
    if (ignored && ignored.has(c.u)) continue;
    let s = compare(f, c, ix.feats[i]);
    if (confirmed && confirmed.has(c.u)) s = { match: 'exact', score: 1, why: '', how: 'confirmed' };
    if (s.match === 'none') continue;
    // the same product wins over a similar one; an in-stock listing wins over an out-of-stock one
    const rank = (s.match === 'exact' ? 2 : 1) + (c.st ? 0.5 : 0) + s.score / 10;
    if (!best || rank > best.rank || (rank === best.rank && c.p < best.c.p)) best = { rank, c, s };
  }
  if (!best) return null;
  const c = best.c;
  return { shop: comp.name, competitorId: comp.id, name: c.n, sku: c.s, brand: c.b, url: c.u, price: c.p, priceMax: c.pm > c.p ? c.pm : 0, regular: c.r > c.p ? c.r : 0, inStock: c.st, img: c.i, match: best.s.match, score: best.s.score, why: best.s.why || '', how: best.s.how || '', country: comp.foreign ? 'other' : 'GR', seenAt: (ix.cat && ix.cat.at) || U.nowIso() };
}

// ---------- Stats & suggestion ----------
/**
 * Market prices of one product. Only offers that are really comparable count:
 *  - the same product ("Ίδιο"), not ignored, from a Greek shop (setting),
 *  - IN STOCK: a low price of something they cannot sell is not a market price,
 *  - seen recently (an offer kept from a shop that could not be read for over a week no longer counts),
 *  - not an outlier: with 3+ shops, a price below half or above double the middle price is set aside
 *    (clearance, wrong product, different pack).
 * Every offer gets a reason (c.note) when it does not count, so the screen can show why.
 */
function stats(list) {
  const s = settings.all();
  const weekAgo = Date.now() - 7 * 864e5;
  for (const c of list) {
    c.used = false; c.note = '';
    if (c.match !== 'exact' || c.ignored) continue;
    if (s.marketGreekOnly && c.country === 'other') { c.note = 'κατάστημα εξωτερικού'; continue; }
    if (c.inStock === false) { c.note = 'εξαντλημένο: δεν μετράει'; continue; }
    if (!c.manual && c.seenAt && new Date(c.seenAt).getTime() < weekAgo) { c.note = 'παλιά τιμή (το κατάστημα δεν διαβάστηκε)'; continue; }
    c.used = true;
  }
  let use = list.filter((c) => c.used);
  if (use.length >= 3) {
    const mid = U.median(use.map((c) => c.price));
    for (const c of use) if (c.price < mid * 0.5 || c.price > mid * 2) { c.used = false; c.note = c.price < mid ? 'πολύ χαμηλή σε σχέση με τους άλλους: δεν μετράει' : 'πολύ υψηλή σε σχέση με τους άλλους: δεν μετράει'; }
    use = use.filter((c) => c.used);
  }
  const prices = use.map((c) => c.price).sort((a, b) => a - b);
  const out = list.filter((c) => c.match === 'exact' && !c.ignored && c.inStock === false).length;
  return {
    count: prices.length, min: prices[0] || 0, max: prices[prices.length - 1] || 0, median: U.median(prices),
    similar: list.filter((c) => c.match === 'similar' && !c.ignored).length, outOfStock: out,
    // how much to trust the suggestion: 3+ shops high, 2 medium, 1 low
    confidence: prices.length >= 3 ? 'high' : prices.length === 2 ? 'medium' : prices.length === 1 ? 'low' : '',
  };
}

function suggest(st, floor) {
  const s = settings.all();
  if (!st.count) return { price: 0, floor: floor || 0, raised: false };
  const pct = Math.max(0, Number(s.percent) || 0);
  let t, cap;
  switch (s.strategy) {
    case 'min': t = st.min; cap = st.min; break;
    case 'min_minus': t = st.min * (1 - pct / 100); cap = st.min - 0.01; break;
    case 'median': t = st.median; cap = st.median; break;
    default: t = st.median * (1 - pct / 100); cap = st.median;
  }
  // Nice ending (,90) when it stays at or below the reference price; a few cents down is fine too;
  // otherwise keep the exact target so we never drop a whole euro.
  const up = U.roundPrice(t, s.rounding);
  const down = U.roundDown(t, s.rounding);
  let price = up <= cap + 0.0001 ? up : (t - down <= 0.5 && down > 0 ? down : U.r2(t));
  let raised = false;
  if (floor && price < floor) { price = floor; raised = true; }
  return { price, floor: floor || 0, raised };
}

function verdict(our, st) {
  if (!st || !st.count || !our) return 'nodata';
  if (our < st.median * 0.85) return 'cheap';
  if (our > st.median * 1.05) return 'expensive';
  return 'ok';
}

function floorFor(site, p) {
  const costs = store.read('costs', {});
  const c = costs[site + ':' + p.id];
  if (!c || !(c.cost > 0)) return 0;
  const s = settings.all();
  return U.roundPrice(c.cost * (1 + s.floorMargin / 100) * (1 + s.vat / 100), s.rounding);
}

function compute(site, p, entry) {
  const st = stats(entry.competitors);
  const floor = floorFor(site, p);
  const sug = suggest(st, floor);
  // a big drop (over 20%) based on a single shop is shown as "check before changing"
  const bigDrop = !!(sug.price && p.price && sug.price < p.price * 0.8);
  return Object.assign(entry, { stats: st, suggested: sug.price, floor: sug.floor, raised: sug.raised, ourPrice: p.price, verdict: verdict(p.price, st), bigDrop, careful: bigDrop && st.count < 2 });
}

function results() { return store.read('market', {}); }
function decisions() { return store.read('market-decisions', {}); } // 'site:id' -> { yes: [url], no: [url] }
function resultFor(site, id) {
  const r = results()[site + ':' + id];
  if (r || site !== 'st') return r || null;
  const catalog = require('./catalog');
  const sfId = catalog.links().stToSf.get(Number(id));
  return sfId ? Object.assign({ master: true }, results()['sf:' + sfId] || {}) : null;
}

// ---------- The research run ----------
function targetsAll() {
  const catalog = require('./catalog');
  const L = catalog.links();
  const t = [];
  for (const p of catalog.load('sf').products) if (p.type !== 'variation') t.push({ site: 'sf', id: p.id });
  // products of the ads site that are not also on SpecialForces (the rest follow the SpecialForces price)
  for (const p of catalog.load('st').products) if (p.type !== 'variation' && !L.stToSf.has(p.id)) t.push({ site: 'st', id: p.id });
  return t;
}

function readable() { return competitors().filter((c) => c.enabled !== false && (c.kind === 'woo' || c.kind === 'shopify')); }

/**
 * Full research: refresh the competitor catalogs, then compare every product (or only `targets`).
 * opts: { targets, skipDownload, auto }
 */
async function run(targets, job, opts) {
  opts = opts || {};
  const catalog = require('./catalog');
  const t0 = Date.now();
  const comps0 = competitors().filter((c) => c.enabled !== false);
  const undetected = comps0.filter((c) => c.kind === 'auto' || !c.kind);
  if (undetected.length) {
    job && job.progress(0, 0, 'Έλεγχος ανταγωνιστών…');
    await detectAll(null, (c) => undetected.some((u) => u.id === c.id));
  }
  const comps = readable();
  if (!comps.length) throw new Error('Κανένας ανταγωνιστής δεν διαβάζεται αυτόματα. Πρόσθεσε καταστήματα WooCommerce ή Shopify στη λίστα.');
  let dl = { done: [], errors: [] };
  if (!opts.skipDownload) {
    job && job.log(`Ενημέρωση καταλόγων ${comps.length} ανταγωνιστών…`);
    dl = await compcat.syncAll(comps, job, catalog.makeProgress(job));
    if (job && job.cancelled()) return null;
  }
  const withCatalog = comps.filter((c) => (compcat.load(c.id).products || []).length);
  if (!withCatalog.length) throw new Error('Δεν κατέβηκε κανένας κατάλογος ανταγωνιστή: ' + dl.errors.map((e) => e.name + ' — ' + e.error).join(' · '));

  const list = targets && targets.length ? targets : targetsAll();
  job && job.progress(0, list.length, 'Σύγκριση με ' + withCatalog.length + ' καταστήματα…');
  const indexes = withCatalog.map((c) => ({ c, ix: indexFor(c.id) }));
  const cats = { sf: catalog.load('sf'), st: catalog.load('st') };
  const byId = { sf: new Map(cats.sf.products.map((p) => [p.id, p])), st: new Map(cats.st.products.map((p) => [p.id, p])) };
  const all = results();
  const dec = decisions();
  const changes = [];
  const at = U.nowIso();
  let done = 0, withData = 0, similar = 0;
  for (const t of list) {
    if (job && job.cancelled()) break;
    const p = byId[t.site] && byId[t.site].get(Number(t.id));
    done++;
    if (!p) continue;
    const key = t.site + ':' + p.id;
    const prev = all[key];
    const d = dec[key] || {};
    const yes = new Set(d.yes || []), no = new Set(d.no || []);
    const f = features(p);
    const found = [];
    if (f.keys.length || f.sku || f.codes.length) for (const { c, ix } of indexes) { const o = bestIn(f, ix, c, yes, no); if (o) found.push(o); }
    // offers from competitors we could not refresh today stay as they were
    const failed = new Set(dl.errors.map((e) => e.id));
    const kept = prev ? prev.competitors.filter((c) => c.manual || (failed.has(c.competitorId) && !found.some((x) => x.competitorId === c.competitorId))) : [];
    const offers = found.concat(kept);
    for (const o of offers) { o.ignored = no.has(o.url); if (yes.has(o.url)) { o.match = 'exact'; o.confirmed = true; } }
    // price changes since the last run
    if (prev) {
      const before = new Map(prev.competitors.map((c) => [c.url, c]));
      for (const o of found) {
        const b = before.get(o.url);
        if (b && b.price > 0 && Math.abs(b.price - o.price) >= 0.01 && o.match === 'exact') {
          o.prevPrice = b.price;
          changes.push({ at, site: t.site, id: p.id, name: p.name, shop: o.shop, url: o.url, from: b.price, to: o.price, ours: p.price });
        }
      }
    }
    const entry = compute(t.site, p, { at, name: p.name, competitors: offers, prevStats: prev && prev.stats && prev.stats.count ? { min: prev.stats.min, median: prev.stats.median, at: prev.at } : (prev && prev.prevStats) || null });
    if (entry.stats.count) withData++;
    if (entry.stats.similar) similar++;
    if (!offers.length && !prev) continue; // nothing to keep
    all[key] = entry;
    if (done % 500 === 0) job && job.progress(done, list.length, `Σύγκριση… ${withData.toLocaleString('el-GR')} προϊόντα με τιμές αγοράς`);
  }
  store.write('market', all);
  const log = store.read('market-changes', []);
  store.write('market-changes', changes.concat(log).slice(0, 400));
  const meta = Object.assign(store.read('market-meta', {}), {
    lastRun: at, lastRunDay: at.slice(0, 10), auto: !!opts.auto, seconds: Math.round((Date.now() - t0) / 1000),
    compared: done, withData, similar, changes: changes.length, competitors: withCatalog.length,
    errors: dl.errors.map((e) => ({ name: e.name, error: e.error })),
  });
  store.write('market-meta', meta);
  // the competitor catalogs are big: free the memory until the next run
  idxCache.clear();
  for (const c of withCatalog) store.forget('comp-' + c.id);
  job && job.progress(list.length, list.length, `Έτοιμο: ${withData.toLocaleString('el-GR')} από ${done.toLocaleString('el-GR')} προϊόντα έχουν τιμές αγοράς.`);
  return { done, withData, similar, changes: changes.length, errors: dl.errors };
}

/** Is today's automatic research due? (once a day, after the chosen hour, while the app is open) */
function dailyDue(now) {
  const s = settings.all();
  if (!s.marketAuto) return false;
  if (!readable().length) return false;
  const meta = store.read('market-meta', {});
  const d = now || new Date();
  const today = d.toISOString().slice(0, 10);
  if (meta.lastRunDay === today) return false;
  return d.getHours() >= (Number(s.marketHour) || 0);
}

// ---------- Search (fallback for new products when no catalog is there yet) ----------
function queriesFor(p) {
  const brandAll = tokensOf(p.brand || '');
  const brand = (brandAll.find((t) => !GENERIC_BRAND.has(ntok(t))) || '').toLowerCase();
  const keys = tokensOf(p.name).filter((t) => !/[Ͱ-Ͽ]/.test(t) && !COLORS.has(ntok(t)) && !SIZES.has(ntok(t)) && !FILLER.has(ntok(t)) && !brandAll.includes(t));
  const codes = codeTokens(p.name, '');
  const q = [];
  if (keys.length) q.push((brand ? brand + ' ' : '') + keys.slice(0, 4).join(' '));
  for (const c of codes.slice(0, 1)) q.push(c);
  if (keys.length >= 2) q.push(keys.slice(0, 3).join(' '));
  if (!q.length) q.push(U.collapse(p.name).split(' ').slice(0, 5).join(' '));
  const sku = String(p.sku || '').trim();
  if (sku.length >= 5 && /\d/.test(sku) && /[A-Za-z]/.test(sku)) q.push(sku);
  return [...new Set(q.map((x) => x.toLowerCase()))];
}
async function searchWoo(c, q, gap) {
  const r = await http.getJson(`${c.url}/wp-json/wc/store/v1/products?search=${encodeURIComponent(q)}&per_page=20`, { gap, retries: 1, timeout: 20000 });
  return (Array.isArray(r.json) ? r.json : []).map(compcat.fromWoo);
}
async function searchShopify(c, q, gap) {
  const r = await http.getJson(`${c.url}/search/suggest.json?q=${encodeURIComponent(q)}&resources[type]=product&resources[limit]=10`, { gap, retries: 1, timeout: 20000 });
  const items = (((r.json || {}).resources || {}).results || {}).products || [];
  return items.map((p) => ({ id: p.id, n: p.title, s: '', b: p.vendor || '', u: p.url && p.url.startsWith('/') ? c.url + p.url.split('?')[0] : p.url, p: U.parseNumber(p.price), pm: 0, r: 0, st: p.available !== false, i: p.image || '', c: 'EUR' }));
}

/**
 * Research one product (e.g. a new product before it is in the shop): the downloaded catalogs first,
 * a live search on the shops that have no catalog yet.
 */
async function researchOne(p, comps, gap) {
  const f = features(p);
  const found = [];
  const errors = [];
  const qs = queriesFor(p);
  await Promise.all(comps.map(async (c) => {
    const cat = compcat.load(c.id);
    if ((cat.products || []).length) { const o = bestIn(f, indexFor(c.id), c); if (o) found.push(o); return; }
    const items = [];
    for (const q of qs) {
      try { items.push(...(c.kind === 'shopify' ? await searchShopify(c, q, gap) : await searchWoo(c, q, gap))); } catch (e) { errors.push(c.name + ': ' + e.message); if (/Cloudflare|404|403/.test(e.message)) break; }
    }
    const ix = { items, feats: items.map(candFeatures), post: new Map() };
    items.forEach((x, i) => { for (const t of ix.feats[i].set) { let a = ix.post.get(t); if (!a) ix.post.set(t, (a = [])); a.push(i); } if (ix.feats[i].sku) { const k = '#' + ix.feats[i].sku; let a = ix.post.get(k); if (!a) ix.post.set(k, (a = [])); a.push(i); } });
    const o = bestIn(f, ix, c);
    if (o) found.push(o);
  }));
  return { competitors: found, queries: qs, errors };
}

// ---------- The user's corrections ----------
function decide(site, id, url, answer) {
  const key = site + ':' + Number(id);
  store.update('market-decisions', {}, (all) => {
    const d = all[key] || { yes: [], no: [] };
    d.yes = d.yes.filter((u) => u !== url); d.no = d.no.filter((u) => u !== url);
    if (answer === 'yes') d.yes.push(url); else if (answer === 'no') d.no.push(url);
    if (d.yes.length || d.no.length) all[key] = d; else delete all[key];
    return all;
  });
  const catalog = require('./catalog');
  const p = catalog.load(site).products.find((x) => x.id === Number(id));
  const all = results();
  const e = all[key];
  if (!e || !p) throw new Error('Δεν βρέθηκε.');
  for (const c of e.competitors) if (c.url === url) {
    c.ignored = answer === 'no';
    if (answer === 'yes') { c.match = 'exact'; c.confirmed = true; } else if (c.confirmed) { delete c.confirmed; }
  }
  e.competitors = e.competitors.filter((c) => !(c.manual && c.ignored));
  all[key] = compute(site, p, e);
  store.write('market', all);
  return all[key];
}
function toggleIgnore(site, id, url) {
  const e = results()[site + ':' + id];
  const c = e && e.competitors.find((x) => x.url === url);
  return decide(site, id, url, c && c.ignored ? '' : 'no');
}

function addManual(site, id, input) {
  const catalog = require('./catalog');
  const p = catalog.load(site).products.find((x) => x.id === Number(id));
  if (!p) throw new Error('Δεν βρέθηκε το προϊόν.');
  const price = U.parseNumber(input.price);
  if (!(price > 0)) throw new Error('Δώσε τιμή.');
  const all = results();
  const key = site + ':' + p.id;
  const e = all[key] || { at: U.nowIso(), name: p.name, competitors: [] };
  const shop = U.collapse(input.shop || 'Κατάστημα');
  e.competitors = e.competitors.filter((c) => !(c.manual && c.shop === shop));
  e.competitors.push({ shop, url: String(input.url || ''), name: p.name, price, inStock: input.inStock !== false, match: 'exact', score: 1, manual: true, country: 'GR', at: U.nowIso() });
  all[key] = compute(site, p, e);
  store.write('market', all);
  return all[key];
}

/** Recalculate suggestions after settings or our prices change. */
const LOGIC_VERSION = 2; // bump when the rules of stats()/suggest() change
function recompute() {
  const catalog = require('./catalog');
  const all = results();
  const byId = { sf: new Map(catalog.load('sf').products.map((p) => [p.id, p])), st: new Map(catalog.load('st').products.map((p) => [p.id, p])) };
  for (const key of Object.keys(all)) {
    const [site, id] = key.split(':');
    const p = byId[site] && byId[site].get(Number(id));
    if (p) compute(site, p, all[key]); else delete all[key];
  }
  store.write('market', all);
}

/**
 * Rows for the screen / reports. q: { verdict, q (text), page, per, similar: '1' }
 * On the ads site, products that are also on SpecialForces show the SpecialForces research.
 */
function overview(site, q) {
  q = q || {};
  const catalog = require('./catalog');
  const all = results();
  const cat = catalog.load(site);
  const rows = [];
  const L = site === 'st' ? catalog.links() : null;
  const sfById = site === 'st' ? new Map(catalog.load('sf').products.map((p) => [p.id, p])) : null;
  for (const p of cat.products) {
    if (p.type === 'variation') continue;
    let e = all[site + ':' + p.id], master = false;
    if (!e && L && L.stToSf.has(p.id)) { e = all['sf:' + L.stToSf.get(p.id)]; master = !!e; }
    if (!e) continue;
    const st = e.stats || { count: 0 };
    let sug = e.suggested;
    if (master) { const sp = sfById.get(L.stToSf.get(p.id)); sug = sp && sp.price ? sp.price : e.suggested; }
    rows.push({
      id: p.id, name: p.name, brand: p.brand, sku: p.sku, img: p.thumb || p.images[0] || '', url: p.url, ourPrice: p.price, at: e.at, stats: st, suggested: master ? e.suggested : sug,
      floor: e.floor, raised: e.raised, verdict: verdict(p.price, st), competitors: e.competitors, diff: e.suggested && p.price ? U.r2(e.suggested - p.price) : 0, type: p.type, master,
      prevStats: e.prevStats || null, bigDrop: !!e.bigDrop, careful: !!e.careful,
    });
  }
  const counts = { expensive: 0, cheap: 0, ok: 0, nodata: 0, similar: 0, all: rows.length, products: cat.products.filter((p) => p.type !== 'variation').length };
  for (const r of rows) { counts[r.verdict]++; if (r.stats.similar) counts.similar++; }
  const order = { expensive: 0, cheap: 1, ok: 2, nodata: 3 };
  let list = rows;
  if (q.verdict && order[q.verdict] !== undefined) list = list.filter((r) => r.verdict === q.verdict);
  if (q.similar === '1') list = list.filter((r) => r.stats.similar > 0);
  if (q.q) { const t = U.foldKey(q.q).split(' ').filter(Boolean); list = list.filter((r) => { const h = U.foldKey(r.name + ' ' + (r.sku || '') + ' ' + (r.brand || '')); return t.every((x) => h.includes(x)); }); }
  list.sort((a, b) => order[a.verdict] - order[b.verdict] || Math.abs(b.diff) - Math.abs(a.diff));
  const total = list.length;
  if (q.per) { const per = Math.min(500, Number(q.per) || 100), page = Math.max(1, Number(q.page) || 1); list = list.slice((page - 1) * per, page * per); }
  return { rows: list, counts, total, meta: store.read('market-meta', {}), changes: store.read('market-changes', []).filter((c) => c.site === site || (site === 'st' && c.site === 'sf')).slice(0, 50) };
}

/** Verdict counts without building the rows (for the dashboard). */
function quickCounts(site) {
  const catalog = require('./catalog');
  const all = results();
  const byId = new Map(catalog.load(site).products.map((p) => [p.id, p]));
  const c = { expensive: 0, cheap: 0, ok: 0, nodata: 0, similar: 0 };
  for (const [key, e] of Object.entries(all)) {
    if (!key.startsWith(site + ':')) continue;
    const p = byId.get(Number(key.slice(site.length + 1)));
    if (!p) continue;
    c[verdict(p.price, e.stats)]++;
    if (e.stats && e.stats.similar) c.similar++;
  }
  return c;
}

function setCost(site, id, cost, source) {
  store.update('costs', {}, (c) => {
    const n = U.parseNumber(cost);
    if (n > 0) c[site + ':' + id] = { cost: U.r2(n), source: source || 'manual', at: U.nowIso() }; else delete c[site + ':' + id];
    return c;
  });
}

module.exports = { LOGIC_VERSION,
  quickCounts, competitors, competitorsView, saveCompetitor, removeCompetitor, detect, detectAll, searchUrlFor, run, dailyDue, addManual, decide, toggleIgnore, recompute, overview,
  resultFor, results, suggest, stats, score, compare, features, candFeatures, queriesFor, keyTokens, setCost, floorFor, researchOne, targetsAll, readable,
};
