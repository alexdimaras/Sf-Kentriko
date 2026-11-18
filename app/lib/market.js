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
const SEED_VERSION = 3; // 3: shops that could not be read are checked once more (they may be readable through their site map)

// ---------- Competitors ----------
function competitors() {
  let c = store.read('competitors', null);
  const meta = store.read('competitors-meta', { seed: c ? 1 : 0 });
  if (!c || (meta.seed || 0) < SEED_VERSION) {
    c = c || [];
    const have = new Set(c.map((x) => U.hostOf(x.url).replace(/^www\./, '')));
    // shops marked «only by hand» before the site-map reader existed are looked at again at the next research
    if ((meta.seed || 0) < 3) for (const x of c) if (x.kind === 'manual' && !/Cloudflare/.test(x.status || '')) { x.kind = 'auto'; x.status = 'Θα ελεγχθεί ξανά στην επόμενη έρευνα'; }
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
  // neither: most shops still publish a site map and the standard product data on each page (see lib/sitemapcat.js)
  try {
    const r = await require('./sitemapcat').probe(c, {});
    if (r.ok) return { kind: 'sitemap', sitemaps: r.sitemaps, status: 'Αυτόματα, σταδιακά (χάρτης του site): διαβάζονται οι σελίδες που μοιάζουν με δικά μας προϊόντα' };
  } catch (e) { if (/Cloudflare/.test(e.message)) return { kind: 'manual', status: 'Μπλοκάρει την αυτόματη ανάγνωση (Cloudflare) — μόνο χειροκίνητα' }; }
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
    let t = toks[i];
    // pieces, written in any of the ways shops write them, are one word: 400PCS = 400 PCS = 400 ΤΕΜ. = 400 ΤΜΧ
    const pcs = t.match(/^(\d+)(PCS|PC|ΤΕΜ|ΤΜΧ|ΤΕΜΑΧΙΑ)\.?$/);
    if (pcs) t = pcs[1] + 'PCS';
    if (/^(PCS|PC|ΤΕΜ|ΤΜΧ|ΤΕΜΑΧΙΑ)\.?$/.test(t) && i > 0 && /^\d+$/.test(toks[i - 1])) {
      const prev = ntok(toks[i - 1]);
      const at = out.indexOf(prev);
      if (at >= 0) out[at] = prev + 'PCS'; else out.push(prev + 'PCS');
      continue;
    }
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
  // pieces, however written: 400PCS = 400 PCS = 400 ΤΕΜ. = 400ΤΜΧ
  for (let i = 0; i < toks.length; i++) {
    const m = toks[i].match(/^(\d+)(PCS|PC|ΤΕΜ|ΤΜΧ|ΤΕΜΑΧΙΑ)$/);
    if (m) set.add(m[1] + 'PCS');
    if (i > 0 && /^(PCS|PC|ΤΕΜ|ΤΜΧ|ΤΕΜΑΧΙΑ)$/.test(toks[i]) && /^\d+$/.test(toks[i - 1])) set.add(toks[i - 1] + 'PCS');
  }
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
const AMMO_GROUP = TYPE_GROUPS.findIndex((g) => g[0] === 'ΦΥΣΙΓΓ');
function typeGroupsOf(toks) {
  const groups = new Set();
  if (toks.some((t) => /^\d{1,2}-?ΒΟΛ[ΑΟ]$|^ΜΟΝΟΒΟΛ[ΑΟ]$|^ΔΡΑΜΙΑ?$/.test(t))) groups.add(AMMO_GROUP);
  for (const t of toks) {
    const n = ntok(t);
    TYPE_GROUPS.forEach((g, i) => { if (g.some((w) => (/[Ͱ-Ͽ]/.test(w) ? n.startsWith(w) : n === w))) groups.add(i); });
  }
  return groups;
}
const PATTERNS = new Set(['MULTICAM', 'KRYPTEK', 'ATACS', 'PENCOTT', 'CAMO', 'WOODLAND', 'FLECKTARN', 'MARPAT', 'DIGITAL', 'URBAN', 'ACU', 'UCP', 'TROPIC', 'ARID', 'ALPINE', 'SNOW', 'TIGER', 'REALTREE', 'MOSSYOAK']);
const COLOR_ALIAS = { GRAY: 'GREY', OD: 'OLIVE', BLK: 'BLACK', GRN: 'GREEN', WHT: 'WHITE', NAVYBLUE: 'NAVY', DARKBLUE: 'NAVY', MC: 'MULTICAM',
  // the German shops and makers (Mil-Tec, Brandit…): their colour words
  OLIV: 'OLIVE', OLIVGRUN: 'OLIVE', SCHWARZ: 'BLACK', GRAU: 'GREY', ROT: 'RED', BLAU: 'BLUE', WEISS: 'WHITE', BRAUN: 'BROWN', STEINGRAU: 'GREY', OLIVEDRAB: 'OLIVE' };
for (const k of Object.keys(COLOR_ALIAS)) COLORS.add(k);
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

// ---------- proof beyond the words of a title ----------
// A product code as shops write it has a base (the model) and often a tail (colour, size, a stray number):
//   K01014-1755507139 → K01014 · MORA-12210 → MORA12210 · SE - 40233 → SE40233 · CWKMG-58-008 → CWKMG58 ·
//   «8020860 Katadyn BeFree Gravity 10L» → 8020860 · ΤΤ 7951-331 → TT7951
// Same base = the same model (proof). Two bases of the same shape that differ (K15038 / K15037) = another model.
function codeBase(sku) {
  const toks = U.foldKey(String(sku || '')).replace(/[–—]/g, '-').split(/\s+/).filter((t) => t && !/^[-.]+$/.test(t));
  if (!toks.length) return null;
  let chunk = toks[0];
  if (!/\d/.test(chunk) && toks[1] && /\d/.test(toks[1]) && /^[A-Z]{1,6}$/.test(chunk)) chunk += '-' + toks[1];
  let base = '';
  const tails = [];
  for (const seg0 of chunk.split(/[-_./]+/)) {
    const seg = seg0.replace(/[^A-Z0-9]/g, '');
    if (!seg) continue;
    if (base && /\d/.test(base)) { if (/^[A-Z]{2,6}$/.test(seg) || /^\d[A-Z]$/.test(seg)) tails.push(seg); continue; } // -SH, -ACR, -3T: a print or version of the model
    base += seg;
  }
  if (!/\d/.test(base)) return null;
  const digits = /^\d+$/.test(base);
  if (base.length < 4 || (digits && base.length > 9)) return null; // too short to prove anything / a date-like number
  return { base, digits, shape: base.replace(/\d/g, '9').replace(/[A-Z]/g, 'A'), run: (base.match(/\d{4,}/) || [''])[0], tail: tails.sort().join('-') };
}
function codeSame(a, b) {
  if (!a || !b) return false;
  if (a.base === b.base) return a.base.length >= 5 || !a.digits;
  return (a.digits && a.base === b.run && !b.digits) || (b.digits && b.base === a.run && !a.digits);
}
function titleCodeClash(code, titleCodes) {
  if (!code) return false;
  for (const t of titleCodes) { const b = codeBase(t); if (b && b.shape === code.shape && b.base !== code.base) return true; }
  return false;
}
const FOR_RE = new RegExp(' (' + U.foldKey('ΓΙΑ') + '|FOR) ');
/** Do the two titles start with different kinds of thing? (never when a model code is in both, or the kinds are known to be one) */
function kindClash(f, cf) {
  if (!f.kind || !cf.kind || require('./kinds').sameStem(f.kind, cf.kind)) return false;
  const g1 = typeGroupsOf([f.kind]), g2 = typeGroupsOf([cf.kind]);
  for (const g of g1) if (g2.has(g)) return false; // ΑΡΒΥΛΑ / ΜΠΟΤΑΚΙΑ: two names of one kind
  const st = (w) => ' ' + U.foldKey(w).slice(0, Math.max(4, w.length - 2));
  if (cf.nameKey.includes(st(f.kind))) return false; // they name our kind too
  const at = f.nameKey.indexOf(st(cf.kind));
  if (at >= 0) { const forAt = f.nameKey.search(FOR_RE); return forAt >= 0 && forAt < at; } // «… ΓΙΑ ΩΤΟΑΣΠΙΔΕΣ»: ours is a part FOR their kind
  return true;
}
function codeClash(a, b) { return !!a && !!b && a.shape === b.shape && a.base !== b.base && a.base.length >= 5; }
/** GTIN / EAN with a correct check digit ('' otherwise): the one identity of a product that every shop shares. */
function gtinOf(v) {
  const g = String(v || '').replace(/\D/g, '');
  if (![8, 12, 13, 14].includes(g.length) || /^0+$/.test(g)) return '';
  let sum = 0;
  for (let i = 0; i < g.length - 1; i++) sum += Number(g[g.length - 2 - i]) * (i % 2 === 0 ? 3 : 1);
  return (10 - (sum % 10)) % 10 === Number(g[g.length - 1]) ? g.replace(/^0+/, '') : '';
}
// a set or a pack is not the single product (ΠΑΝΤΕΛΟΝΙ BDU ≠ BDU SET)
const BUNDLE = /^(SET|ΣΕΤ|KIT|ΚΙΤ|ΠΑΚΕΤΟ|COMBO|BUNDLE|PACK|2PACK|3PACK|ΣΥΣΚΕΥΑΣΙΑ)$/;
const EMPTY = Object.freeze([]);
/** What a title says comes WITH the product (ΜΕ ΣΠΙΝΘΗΡΙΣΤΗ, WITH SURVIVAL KIT, + ΘΗΚΗ): the stems of those words. */
function partsOf(toks) {
  let out = null;
  for (let i = 0; i < toks.length - 1; i++) {
    if (!/^(ΜΕ|WITH|\+|W\/)$/.test(toks[i])) continue;
    for (let j = i + 1; j < Math.min(toks.length, i + 3); j++) {
      const w = ntok(toks[j]);
      if (w.length < 4 || /\d/.test(w) || COLORS.has(w) || FILLER.has(w) && !BUNDLE.test(w)) continue;
      (out = out || []).push(U.foldKey(w).slice(0, Math.max(4, w.length - 2)));
    }
  }
  return out || EMPTY;
}
/** The file name of a photo without size endings: shops often keep the maker's own file (56053-019.jpg). */
function imageKey(u) {
  const f = String(u || '').split('?')[0].split('/').pop().toLowerCase().replace(/\.(jpe?g|png|webp|gif|avif)$/, '').replace(/-\d{2,4}x\d{2,4}$/, '').replace(/[-_](scaled|large|medium|thumb|thumbnail|home_default|\d{3,4})$/, '');
  return f.length >= 8 && /\d/.test(f) && /[a-z]/.test(f) ? f : '';
}

/** Everything about one of OUR products that the matching needs. extra: { ean } known from a supplier. */
function features(p, extra) {
  const toks = tokensOf(p.name);
  const up = toks.join(' ');
  const keys = keyTokens(p.name, p.brand);
  const sku = U.normSku(p.sku || '');
  let colors = colorsOf(toks);
  // a colour kept as an attribute of the product counts like a colour in its title (not for products sold in many colours)
  if (!colors.size && Array.isArray(p.attrs)) {
    const a = p.attrs.find((x) => /χρωμ|χρώμ|colou?r/i.test(x.name || '') && !x.variation && (x.terms || []).length === 1);
    if (a) colors = colorsOf(tokensOf(a.terms[0]));
  }
  const first = toks[0] || '';
  return {
    name: p.name, price: p.price || 0, brand: p.brand || '', bt: brandTokens(p.brand), brandKey: U.foldKey(p.brand || ''),
    keys, alpha: keys.filter((k) => /[A-Z]/.test(k)), digits: keys.filter((k) => /\d/.test(k)), codes: codeTokens(p.name, ''),
    sku: sku.length >= 6 || (/\d/.test(sku) && /[A-Z]/.test(sku) && sku.length >= 4) ? sku : '',
    code: codeBase(p.sku), gtin: gtinOf((extra && extra.ean) || p.ean || p.gtin), nameKey: ' ' + U.foldKey(p.name) + ' ',
    kind: /^[Α-Ω]{4,}$/.test(first) ? first : '', bundle: toks.some((t) => BUNDLE.test(ntok(t))), parts: partsOf(toks), img: imageKey((p.images || [])[0] || p.thumb),
    group: (() => { const g = typeGroupsOf(toks.slice(0, 1)); return g.size ? [...g][0] : -1; })(),
    groups: typeGroupsOf(toks), colors, used: USED.test(up), flags: flagsOf(up),
    women: WOMEN.test(up), kids: KIDS.test(up),
    src: p, extra: extra || null, tokSet: new Set(toks.map(ntok).filter(Boolean)),
  };
}
/**
 * Our product has no brand, but their brand is written in our title as well (RIO, XTAR, LAMBRO…): then that IS our
 * brand — the two titles agree on it — and the matching goes on as for a product with a brand (memoized per brand).
 */
function withTheirBrand(f, brand) {
  if (f.bt.length || !brand || !f.src) return null;
  const bt = brandTokens(brand);
  if (!bt.length || bt.join('').length < 3 || !bt.every((t) => f.tokSet.has(t))) return null;
  f._wb = f._wb || new Map();
  const k = U.foldKey(brand);
  if (!f._wb.has(k)) { const g = features(Object.assign({}, f.src, { brand }), f.extra); g.brandFromTitle = brand; f._wb.set(k, g); }
  return f._wb.get(k);
}
/** The same for a competitor product (computed once per catalog). */
function candFeatures(c) {
  const toks = tokensOf(c.n);
  const up = toks.join(' ');
  const first = toks[0] || '';
  return {
    set: tokenSet(c.n, c.s), keys: keyTokens(c.n, c.b), groups: typeGroupsOf(toks), brandKey: U.foldKey(c.b || ''), nameKey: ' ' + U.foldKey(c.n) + ' ',
    sku: U.normSku(c.s || ''), women: WOMEN.test(up), kids: KIDS.test(up), colors: colorsOf(toks), used: USED.test(up),
    codes: codeTokens(c.n, ''), flags: flagsOf(up),
    // proof beyond the words: the code (and the maker's part number), the EAN, what kind it says it is, sets, what comes with it
    code: codeBase(c.s), mpn: c.m ? codeBase(c.m) : null, gtin: gtinOf(c.g), gtins: c.gs && c.gs.length ? new Set(c.gs.map(gtinOf).filter(Boolean)) : null, kind: /^[Α-Ω]{4,}$/.test(first) ? first : '',
    bundle: toks.some((t) => BUNDLE.test(ntok(t))), parts: partsOf(toks), img: imageKey(c.i),
  };
}

/**
 * Is a competitor product the same as ours?  → { match: exact|similar|none, score 0..1, why }
 * exact = same brand and every model word/code of ours is there, no extra version word, same type, same gender,
 * a believable price. similar = probably, but something is missing → the user decides.
 */
function compare(f, cand, cf) {
  // no brand on our side: theirs, if our title says it too
  if (!f.bt.length && cand && cand.b) {
    const g = withTheirBrand(f, cand.b);
    if (g) { const r = compare(g, cand, cf); if (r && r.ev && r.match !== 'none') r.ev = r.ev.concat(['μάρκα στον τίτλο μας: ' + g.brandFromTitle]); return r; }
  }
  const brandOk = f.bt.length ? (f.bt.some((b) => cf.set.has(b)) || (f.brandKey && (cf.brandKey === f.brandKey || cf.nameKey.includes(' ' + f.brandKey + ' ')))) : false;
  if (f.bt.length && cf.brandKey && !brandOk) return { match: 'none', score: 0 }; // another brand
  // the same EAN is the same product, whatever the titles say
  if (f.gtin && cf.gtin && f.gtin === cf.gtin) return { match: 'exact', score: 1, why: '', how: 'ean', ev: ['ίδιο EAN ' + f.gtin] };
  // … also the EAN of one of their sizes / colours (a product of theirs with an EAN per variant)
  if (f.gtin && cf.gtins && cf.gtins.has(f.gtin) && (!f.bt.length || brandOk || !cf.brandKey)) return { match: 'exact', score: 1, why: '', how: 'ean', ev: ['ίδιο EAN ' + f.gtin + ' (ενός μεγέθους/χρώματος)'] };
  // the same code: whole, or the same base with the brand agreeing (K01014-1755507139 = K01014)
  // (not when a title names another code of the same shape than its own code field: «… BDU ARCTIC PANTS K05068» filed
  // under K05001 — one of the two is wrong, so the code proves nothing)
  const skuFull = !!(f.sku && cf.sku && f.sku === cf.sku);
  // (nor when the tails name different prints / versions of one base: K09012-SH «ΣΠΑΡΤΙΑΤΗΣ» is not K09012-01 «BLANK»)
  const theirCode = codeSame(f.code, cf.code) ? cf.code : codeSame(f.code, cf.mpn) ? cf.mpn : null;
  let baseHit = brandOk && !!theirCode && f.code.tail === theirCode.tail && !titleCodeClash(f.code, f.codes) && !titleCodeClash(cf.code, cf.codes);
  const hit = f.keys.filter((k, i) => cf.set.has(k) || (i + 1 < f.keys.length && cf.set.has(k + f.keys[i + 1])) || (i > 0 && cf.set.has(f.keys[i - 1] + k))); // BODY SHOCK = BODYSHOCK
  // the same base code under two different model names (CREST TRUCKER / TRIAD): one of the shops filed it wrong — the person decides
  const named = (ks) => ks.some((k) => /^[A-Z]{4,}$/.test(k) && !MODIFIERS.has(k) && !WEAK.has(k));
  const nameClash = baseHit && !skuFull && !hit.length && named(f.keys) && named(cf.keys.filter((k) => !f.bt.includes(k)));
  // … or one base with another print / edition on each side (FEARLESS WARRIOR / BLANK)
  const isNamed = (k) => /^[A-Z]{4,}$/.test(k) && !MODIFIERS.has(k) && !WEAK.has(k);
  const missN = f.keys.filter((k) => !hit.includes(k) && isNamed(k));
  const extraN = cf.keys.filter((k) => isNamed(k) && !f.keys.includes(k) && !f.bt.includes(k) && !f.keys.some((o, i) => k === o + (f.keys[i + 1] || '')));
  const editionClash = baseHit && !skuFull && !nameClash && missN.length > 0 && extraN.length > 0;
  if (nameClash || editionClash) baseHit = false;
  // the same model code but two different EANs (both real): another size, pack or edition of the model — the person decides
  const eanClash = baseHit && !skuFull && f.gtin && cf.gtin && f.gtin !== cf.gtin && !(cf.gtins && cf.gtins.has(f.gtin));
  if (eanClash) return { match: 'similar', score: 0.7, why: `Ίδιος κωδικός μοντέλου (${f.code.base}) αλλά άλλο EAN: ίσως άλλο μέγεθος / συσκευασία`, how: 'sku', ev: ['ίδιος κωδικός μοντέλου', 'ίδια μάρκα'] };
  const skuHit = skuFull || baseHit;
  const ratio = f.keys.length ? hit.length / f.keys.length : 0;
  if (nameClash) return { match: 'similar', score: 0.6, why: `Ίδιος κωδικός μοντέλου (${f.code.base}) αλλά άλλο όνομα: έλεγξέ το`, how: 'sku', ev: ['ίδιος κωδικός μοντέλου', 'ίδια μάρκα'] };
  if (editionClash) return { match: 'similar', score: 0.7, why: `Ίδιος κωδικός μοντέλου (${f.code.base}) αλλά άλλο σχέδιο / έκδοση: εμείς «${missN.slice(0, 2).join(' ')}», εκείνοι «${extraN.slice(0, 2).join(' ')}»`, how: 'sku', ev: ['ίδιος κωδικός μοντέλου', 'ίδια μάρκα'] };
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
    const realHit = hit.some((k) => !MODIFIERS.has(k) && !WEAK.has(k) && /[A-Z]/.test(k) && !SPEC.test(k) && !/^\d+[A-Z]{1,2}$/.test(k)); // a size or capacity (100L, 20MM) names no model
    if (mod) { match = 'similar'; why = `Έχει επιπλέον «${mod}» (άλλη έκδοση;)`; }
    else if (lost) { match = 'similar'; why = `Δεν έχει το «${lost}» (άλλη έκδοση;)`; }
    else if (code) { match = 'similar'; why = `Έχει άλλο κωδικό μοντέλου «${code}»`; }
    // only general words (ASSAULT MOLLE SMALL): together they still name one model when ALL of them are there, three
    // or more, with the same brand, the same colour named on both sides and nothing more in their title
    else if (!realHit && !codeHit && ratio === 1 && f.keys.length >= 3 && brandOk && !extra.length && f.colors.size && cf.colors.size) {
      const same = [...f.colors].every((c) => cf.colors.has(c)) && [...cf.colors].every((c) => f.colors.has(c));
      if (!same) { match = 'family'; why = `Ίδιο μοντέλο, άλλη παραλλαγή: εκείνοι ${[...cf.colors].join(' ')}, εμείς ${[...f.colors].join(' ')}`; }
    }
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
  // ---- proof against: things that make two products with the same words different products ----
  if (match === 'exact' && !skuHit) {
    const partMissing = f.parts.find((st) => !cf.nameKey.includes(' ' + st));
    const partExtra = cf.parts.find((st) => !f.nameKey.includes(' ' + st));
    const colourOnly = f.colors.size && cf.colors.size && [...f.colors].some((c) => !cf.colors.has(c)) && [...cf.colors].some((c) => !f.colors.has(c));
    // two codes of one model that differ where the colour differs (PL-RCN-CD-11 coyote / -02 olive): the same family
    if (codeClash(f.code, cf.code) && colourOnly) { match = 'family'; why = `Ίδιο μοντέλο, άλλη παραλλαγή: εκείνοι ${[...cf.colors].join(' ')} (${cf.code.base}), εμείς ${[...f.colors].join(' ')} (${f.code.base})`; }
    else if (codeClash(f.code, cf.code)) { match = 'similar'; why = `Άλλος κωδικός: εμείς ${f.code.base}, εκείνοι ${cf.code.base}`; }
    else if (f.gtin && cf.gtin && f.gtin !== cf.gtin) { match = 'similar'; why = 'Άλλο EAN'; }
    else if (f.bundle !== cf.bundle) { match = 'similar'; why = cf.bundle ? 'Εκείνοι πουλάνε σετ / πακέτο' : 'Εμείς πουλάμε σετ / πακέτο'; }
    else if (partMissing) { match = 'similar'; why = 'Το δικό μας έχει και κάτι ακόμα («με …») που δεν φαίνεται στο δικό τους'; }
    else if (partExtra) { match = 'similar'; why = 'Το δικό τους έχει και κάτι ακόμα («με …») που δεν έχει το δικό μας'; }
    else if (!codeHit && kindClash(f, cf)) { match = 'similar'; why = `Άλλο είδος; Εμείς «${f.kind}», εκείνοι «${cf.kind}»`; }
  }
  if (f.used || cf.used) { if (f.used !== cf.used) { match = 'similar'; why = 'Μεταχειρισμένο / καινούργιο'; } }
  if (match === 'exact' && (f.women !== cf.women || f.kids !== cf.kids)) { match = 'similar'; why = f.women !== cf.women ? 'Γυναικείο / ανδρικό;' : 'Παιδικό;'; }
  // colours: the MODEL may be the same, the VARIANT is not. Each title names a colour the other does not (URBAN of
  // «URBAN LINE» on both sides proves nothing) → «the same family, another variant»: shown, never counted as the same
  // product (its price, code, EAN and photos are the other colour's) — unless the whole code or the EAN is the same
  let colour = 0;
  if (f.colors.size && cf.colors.size) {
    const onlyOurs = [...f.colors].filter((c) => !cf.colors.has(c)), onlyTheirs = [...cf.colors].filter((c) => !f.colors.has(c));
    const clash = onlyOurs.length > 0 && onlyTheirs.length > 0;
    colour = clash ? -1 : [...f.colors].some((c) => cf.colors.has(c)) ? 1 : 0;
    if (clash && match === 'exact' && !skuFull) { match = 'family'; why = `Ίδιο μοντέλο, άλλη παραλλαγή: εκείνοι ${onlyTheirs.join(' ')}, εμείς ${onlyOurs.join(' ')}`; }
  }
  if (match === 'exact' && !skuFull && f.price > 0 && cand.p > 0) {
    const r = cand.p / f.price;
    if (r < 0.45 || r > 2.2) { match = 'similar'; why = 'Πολύ διαφορετική τιμή (ίσως άλλο προϊόν ή συσκευασία)'; }
  }
  // what speaks for the match, in words (shown next to every offer)
  const ev = [];
  if (skuHit) ev.push(baseHit && !(f.sku && f.sku === cf.sku) ? `ίδιος κωδικός μοντέλου (${f.code.base})` : 'ίδιος κωδικός');
  if (brandOk) ev.push('ίδια μάρκα');
  if (hit.length) ev.push('λέξεις μοντέλου: ' + hit.slice(0, 4).join(' '));
  if (colour === 1) ev.push('ίδιο χρώμα');
  const imgHit = !!(f.img && cf.img && f.img === cf.img);
  if (imgHit) ev.push('ίδια φωτογραφία (αρχείο κατασκευαστή)');
  return { match, score: Math.round((skuHit || codeHit ? 1 : ratio) * Math.max(0.5, back) * 100) / 100 + colour * 0.05 + (imgHit ? 0.05 : 0), why, how: skuHit ? 'sku' : codeHit ? 'code' : 'words', ev };
}


// Backwards compatible single comparison (used for products found by search).
function score(our, cand) {
  const c = { n: cand.name, s: cand.sku, b: cand.brand, p: cand.price, g: cand.ean || '', m: cand.mpn || '', i: cand.img || '' };
  return compare(features(our), c, candFeatures(c));
}

// ---------- Index of a competitor catalog ----------
const idxCache = new Map();
function indexFor(compId) { return require('./bg').drainSync(indexGen(compId)); }
/** The same in slices (the research builds one index per shop: in one go it froze a small machine for seconds). */
function* indexGen(compId) {
  const cat = compcat.load(compId);
  yield;
  const hit = idxCache.get(compId);
  if (hit && hit.cat === cat) return hit;
  const items = cat.products || [];
  const feats = new Array(items.length);
  const post = new Map();
  const put = (k, i) => { let a = post.get(k); if (!a) post.set(k, (a = [])); a.push(i); };
  for (let i = 0; i < items.length; i++) {
    if (i % 50 === 0) yield;
    const cf = candFeatures(items[i]);
    feats[i] = cf;
    for (const t of cf.set) put(t, i);
    if (cf.sku) put('#' + cf.sku, i);
    for (const cb of [cf.code, cf.mpn]) if (cb) { put('~' + cb.base, i); if (cb.run && cb.run !== cb.base) put('~' + cb.run, i); }
    if (cf.gtin) put('=' + cf.gtin, i);
    if (cf.gtins) for (const g of cf.gtins) put('=' + g, i);
  }
  const res = { cat, items, feats, post };
  idxCache.set(compId, res);
  return res;
}

const FEW = 30;
const FRESH_FOR_FEW_MS = 24 * 36e5;
/**
 * A small index of a shop for a few of our products: only the items whose text holds one of their model words or
 * codes (the same candidates bestIn would find in the whole index, at a fraction of the work).
 */
function* quickIndexGen(compId, work) {
  const cat = compcat.load(compId);
  const items0 = cat.products || [];
  const words = new Set(), codes = new Set();
  for (const w of work) {
    const f = w.f;
    for (const k of f.keys) if (k.length >= 2) words.add(k);
    for (const c of [f.sku, f.gtin, f.code && f.code.base, f.code && f.code.run].concat(f.codes || [])) { const k = String(c || '').replace(/[^A-Z0-9Α-Ω]/g, ''); if (k.length >= 3) codes.add(k); }
  }
  const ws = [...words], cs = [...codes];
  const items = [], feats = [], post = new Map();
  const put = (k, i) => { let a = post.get(k); if (!a) post.set(k, (a = [])); a.push(i); };
  for (let j = 0; j < items0.length; j++) {
    if (j % 200 === 0) yield;
    const it = items0[j];
    const hay = ' ' + tokensOf([it.n, it.s, it.b].filter(Boolean).join(' ')).join(' ') + ' ';
    const flat = hay.replace(/[^A-Z0-9Α-Ω]/g, '');
    if (!ws.some((k) => hay.includes(' ' + k + ' ')) && !cs.some((k) => flat.includes(k))) continue;
    const i = items.length;
    const cf = candFeatures(it);
    items.push(it); feats.push(cf);
    for (const t of cf.set) put(t, i);
    if (cf.sku) put('#' + cf.sku, i);
    for (const cb of [cf.code, cf.mpn]) if (cb) { put('~' + cb.base, i); if (cb.run && cb.run !== cb.base) put('~' + cb.run, i); }
    if (cf.gtin) put('=' + cf.gtin, i);
    if (cf.gtins) for (const g of cf.gtins) put('=' + g, i);
  }
  return { cat, items, feats, post };
}

/** Best offer of one competitor for one of our products. */
function bestIn(f, ix, comp, confirmed, ignored) {
  const cand = new Set();
  const add = (k) => { const a = ix.post.get(k); if (a && a.length <= 600) for (const i of a) cand.add(i); };
  if (f.sku) add('#' + f.sku);
  if (f.code) { add('~' + f.code.base); if (f.code.run) add('~' + f.code.run); }
  if (f.gtin) add('=' + f.gtin);
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
    const rank = (s.match === 'exact' ? 3 : s.match === 'family' ? 2 : 1) + (c.st ? 0.5 : 0) + s.score / 10;
    if (!best || rank > best.rank || (rank === best.rank && c.p < best.c.p)) best = { rank, c, s };
  }
  if (!best) return null;
  const c = best.c;
  return { shop: comp.name, competitorId: comp.id, name: c.n, sku: c.s, mpn: c.m || '', brand: c.b, url: c.u, price: c.p, priceMax: c.pm > c.p ? c.pm : 0, regular: c.r > c.p ? c.r : 0, inStock: c.st, img: c.i, match: best.s.match, score: best.s.score, why: best.s.why || '', how: best.s.how || '', ev: best.s.ev || [], ean: c.g || '', country: comp.foreign ? 'other' : 'GR', seenAt: c.t || (ix.cat && ix.cat.at) || U.nowIso() };
}

// ---------- Stats & decision ----------
// The rule of thumb: a price changes only when the market agrees, never because of one shop.
//  - Only offers that are really comparable count: the same product ("Ίδιο"), in stock, from a Greek shop
//    (setting), seen in the last week.
//  - A "suspect" price does not count either: below OUR cost (they may sell old stock bought cheaper, or it is
//    a mistake), far below the supplier's retail price, or far below the other shops.
//  - To lower (or raise) our price, at least `minShops` shops (default 2) must be cheaper (or dearer) than us.
//    One cheaper shop is shown for information only: "watch", no suggested price.
// Every offer gets a flag (used / suspect / out / stale / high / foreign / similar / ignored) and, when it does
// not count, a reason in plain words (c.note), so the screen can show exactly why.
const money = (n) => (Number(n) || 0).toLocaleString('el-GR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
const pctOf = (a, b) => Math.round((1 - a / b) * 100);

/** What we know about our own cost for a product: cost (without VAT), the same with VAT, the price floor, the supplier's retail price. */
function costInfo(site, p) {
  const c = store.read('costs', {})[site + ':' + p.id];
  const s = settings.all();
  const vat = 1 + s.vat / 100;
  const cost = c && c.cost > 0 ? c.cost : 0;
  return {
    cost, costVat: cost ? U.r2(cost * vat) : 0,
    floor: cost ? U.roundPrice(cost * (1 + s.floorMargin / 100) * vat, s.rounding) : 0,
    rrp: c && c.rrp > 0 ? c.rrp : 0,
  };
}

function stats(list, ctx) {
  ctx = ctx || {};
  const s = settings.all();
  const weekAgo = Date.now() - 7 * 864e5;
  const lim = 1 - (Number(s.suspectPct) || 30) / 100;
  for (const c of list) {
    c.used = false; c.note = ''; c.flag = '';
    if (c.ignored) { c.flag = 'ignored'; continue; }
    // another colour / size of the same model: its price is that variant's (counted only after a person's yes)
    if (c.web && c.pendingShop && !c.confirmed) { c.flag = 'newshop'; c.note = 'νέο κατάστημα του internet: μετράει όταν εγκρίνεις το κατάστημα'; continue; }
    if (c.match === 'family') { c.flag = 'family'; c.note = c.note || 'άλλη παραλλαγή του ίδιου μοντέλου: η τιμή της δεν μετράει'; continue; }
    if (c.match !== 'exact') { c.flag = 'similar'; continue; }
    if (s.marketGreekOnly && c.country === 'other') { c.flag = 'foreign'; c.note = 'κατάστημα εξωτερικού'; continue; }
    if (c.inStock === false) { c.flag = 'out'; c.note = 'εξαντλημένο: δεν μετράει'; continue; }
    // not known whether it is in stock (a page that does not say; an internet price found before this was kept): it
    // is shown, but never counts for a change of price (only prices a buyer can pay today do)
    if (!c.manual && (c.inStock == null || (c.web && !c.avail))) { c.flag = 'unknown'; c.note = 'άγνωστη διαθεσιμότητα: δεν μετράει'; continue; }
    if (!c.manual && c.seenAt && new Date(c.seenAt).getTime() < (c.web ? Date.now() - WEB_DAYS * 864e5 : weekAgo)) { c.flag = 'stale'; c.note = 'παλιά τιμή (το κατάστημα δεν διαβάστηκε)'; continue; }
    c.used = true; c.flag = 'used';
  }
  const suspect = (c, why) => { c.used = false; c.flag = 'suspect'; c.note = why; };
  // against what we know: our cost and the supplier's retail price
  for (const c of list) {
    if (!c.used) continue;
    if (ctx.costVat > 0 && c.price < ctx.costVat) suspect(c, `κάτω από το δικό μας κόστος αγοράς (${money(ctx.costVat)} με ΦΠΑ): μάλλον παλιό απόθεμα, ξεπούλημα ή λάθος`);
    else if (ctx.rrp > 0 && c.price < ctx.rrp * lim) suspect(c, `${pctOf(c.price, ctx.rrp)}% κάτω από τη λιανική του αντιπροσώπου (${money(ctx.rrp)}): μάλλον παλιό απόθεμα ή λάθος`);
  }
  // against the other shops
  let use = list.filter((c) => c.used);
  if (use.length >= 3) {
    const marks = [];
    for (const c of use) {
      const mid = U.median(use.filter((x) => x !== c).map((x) => x.price));
      if (c.price < mid * lim) marks.push([c, 'low', mid]);
      else if (c.price > mid * 2) marks.push([c, 'high', mid]);
    }
    for (const [c, kind, mid] of marks) {
      if (kind === 'low') suspect(c, `${pctOf(c.price, mid)}% φθηνότερο από τα άλλα καταστήματα (μέση ${money(mid)}): μάλλον παλιό απόθεμα ή λάθος`);
      else { c.used = false; c.flag = 'high'; c.note = 'πολύ ακριβότερο από τα άλλα καταστήματα: δεν μετράει'; }
    }
  } else if (use.length === 2) {
    // two shops far apart: the cheap one is the odd one out when our price (or the supplier's) sides with the other
    const [a, b] = use.slice().sort((x, y) => x.price - y.price);
    const ref = ctx.rrp || ctx.ours;
    if (a.price < b.price * lim && ref && Math.abs(ref - b.price) < Math.abs(ref - a.price)) suspect(a, `${pctOf(a.price, b.price)}% φθηνότερο από το ${b.shop}: μάλλον παλιό απόθεμα ή λάθος`);
  }
  use = list.filter((c) => c.used);
  const prices = use.map((c) => c.price).sort((a, b) => a - b);
  const cheapest = use.reduce((m, c) => (!m || c.price < m.price ? c : m), null);
  const dearest = use.reduce((m, c) => (!m || c.price > m.price ? c : m), null);
  return {
    count: prices.length, min: prices[0] || 0, max: prices[prices.length - 1] || 0, median: U.median(prices),
    minShop: cheapest ? cheapest.shop : '', maxShop: dearest ? dearest.shop : '',
    similar: list.filter((c) => c.flag === 'similar').length,
    family: list.filter((c) => c.flag === 'family').length,
    newShops: list.filter((c) => c.flag === 'newshop').length,
    outOfStock: list.filter((c) => c.flag === 'out').length,
    unknownStock: list.filter((c) => c.flag === 'unknown').length,
    suspect: list.filter((c) => c.flag === 'suspect').length,
    // how much to trust the market price: 3+ shops high, 2 medium, 1 low
    confidence: prices.length >= 3 ? 'high' : prices.length === 2 ? 'medium' : prices.length === 1 ? 'low' : '',
  };
}

/** Target price from the chosen strategy (never under the cost floor). */
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

const ACTIONS = { lower: 'Μείωσε', raise: 'Μπορείς να ανεβάσεις', hold: 'Σωστή τιμή', watch: 'Μόνο ενημέρωση', nodata: 'Χωρίς στοιχεία' };

/**
 * What to do with our price → { action, suggested, raised, reason }.
 *  lower  — at least minShops shops (in stock, not suspect) are cheaper and we are over the market → suggested price
 *  raise  — at least minShops shops are dearer and we are far under the market → suggested price
 *  hold   — we are inside the market (or already at the cost floor)
 *  watch  — something looks cheaper/dearer, but the proof is too weak (one shop, suspect prices): no change
 *  nodata — no comparable offer
 */
function decision(ours, st, list, floor, costVat) {
  const s = settings.all();
  const minShops = Math.max(1, Math.round(Number(s.minShops) || 2));
  const used = list.filter((c) => c.used);
  const sus = list.filter((c) => c.flag === 'suspect').sort((a, b) => a.price - b.price);
  const susText = sus.length ? ` ${sus[0].shop} (${money(sus[0].price)}) δεν μετράει: ${sus[0].note.split(':')[0]}.` : '';
  const none = { suggested: 0, raised: false };
  // first of all: never sell at a loss, whatever the others do (they may have old stock bought cheaper)
  if (costVat > 0 && ours > 0 && ours < costVat - 0.009 && floor > ours) {
    const mkt = st.count ? ` Η αγορά: μέση ${money(st.median)}, από ${money(st.min)} έως ${money(st.max)}.` : '';
    return { action: 'raise', suggested: floor, raised: true, loss: true, reason: `Πουλάς με ζημιά: η τιμή σου είναι κάτω από το κόστος αγοράς με ΦΠΑ (${money(costVat)}). Πρόταση: το κατώτατο όριο (κόστος + ${s.floorMargin}% + ΦΠΑ).${mkt}${susText}` };
  }
  if (!st.count || !ours) {
    let reason = 'Δεν βρέθηκε το ίδιο προϊόν διαθέσιμο σε άλλο κατάστημα.';
    if (st.outOfStock && !st.unknownStock) reason = 'Κανείς άλλος δεν το έχει διαθέσιμο: δεν χρειάζεται μείωση τιμής.';
    else if (st.unknownStock) reason = `Βρέθηκε σε ${st.unknownStock} ${st.unknownStock === 1 ? 'κατάστημα' : 'καταστήματα'} χωρίς επιβεβαιωμένη διαθεσιμότητα: δεν μετράει για αλλαγή τιμής.`;
    else if (sus.length) reason = 'Οι μόνες τιμές που βρέθηκαν είναι ύποπτες.' + susText;
    else if (st.newShops) reason = `Βρέθηκε σε ${st.newShops} ${st.newShops === 1 ? 'νέο κατάστημα' : 'νέα καταστήματα'} του internet: μετράει μόλις εγκρίνεις το κατάστημα.`;
    else if (st.family) reason = `Βρέθηκε το ίδιο μοντέλο σε άλλο χρώμα/παραλλαγή (${st.family}): η τιμή του δεν μετράει για το δικό σου, εκτός αν επιβεβαιώσεις ότι ισχύει και γι' αυτό.`;
    else if (st.similar) reason = 'Υπάρχουν μόνο παρόμοια προϊόντα: επιβεβαίωσε αν είναι ίδια.';
    return Object.assign({ action: 'nodata', reason }, none);
  }
  const cheaper = used.filter((c) => c.price < ours * 0.98);
  const dearer = used.filter((c) => c.price > ours * 1.02);
  const band = `μέση αγοράς ${money(st.median)}, από ${money(st.min)} έως ${money(st.max)}`;
  if (ours > st.median * 1.05) {
    if (cheaper.length < minShops) {
      const c = cheaper.slice().sort((a, b) => a.price - b.price)[0] || used[0];
      const who = cheaper.length > 1 ? `Μόνο ${cheaper.length} καταστήματα είναι φθηνότερα (φθηνότερο: ${c.shop}, ${money(c.price)}).` : `Μόνο 1 κατάστημα (${c.shop}, ${money(c.price)}) είναι φθηνότερο από εσένα.`;
      return Object.assign({ action: 'watch', reason: `${who} Για αλλαγή τιμής χρειάζονται τουλάχιστον ${minShops}: ίσως έχει παλιό απόθεμα, προσφορά ή λάθος.${susText}` }, none);
    }
    const sug = suggest(st, floor);
    if (!(sug.price < ours * 0.99)) return Object.assign({ action: 'hold', reason: `${cheaper.length} καταστήματα είναι φθηνότερα (${band}), αλλά είσαι ήδη στο κατώτατο όριο κόστους.${susText}` }, none);
    return { action: 'lower', suggested: sug.price, raised: sug.raised, reason: `${cheaper.length} καταστήματα είναι φθηνότερα από εσένα (${band}).${sug.raised ? ' Η πρόταση σταματάει στο κατώτατο όριο κόστους.' : ''}${susText}` };
  }
  if (ours < st.median * 0.85) {
    if (dearer.length < minShops) return Object.assign({ action: 'watch', reason: `Είσαι πολύ φθηνότερος από ${dearer.length > 1 ? dearer.length + ' καταστήματα' : 'το ' + (dearer[0] || used[0]).shop + ' (' + money((dearer[0] || used[0]).price) + ')'}, αλλά για αύξηση χρειάζονται τουλάχιστον ${minShops}.${susText}` }, none);
    const sug = suggest(st, floor);
    if (!(sug.price > ours * 1.01)) return Object.assign({ action: 'hold', reason: `Η τιμή σου είναι μέσα στην αγορά (${band}).` }, none);
    return { action: 'raise', suggested: sug.price, raised: sug.raised, reason: `${dearer.length} καταστήματα το πουλάνε ακριβότερα (${band}): χάνεις κέρδος χωρίς λόγο.${susText}` };
  }
  return Object.assign({ action: 'hold', reason: `Η τιμή σου είναι μέσα στην αγορά (${band}).${susText}` }, none);
}

/** Old name, kept for callers that only need the label of the result. */
function verdict(entry) { return (entry && entry.action) || 'nodata'; }

function floorFor(site, p) { return costInfo(site, p).floor; }

function compute(site, p, entry) {
  const ci = costInfo(site, p);
  const st = stats(entry.competitors, { ours: p.price, costVat: ci.costVat, rrp: ci.rrp });
  const d = decision(p.price, st, entry.competitors, ci.floor, ci.costVat);
  // a big drop (over 20%) with fewer than 3 shops is shown as "check before changing" and needs a yes on export
  const bigDrop = !!(d.suggested && p.price && d.suggested < p.price * 0.8);
  const used = entry.competitors.filter((c) => c.used);
  return Object.assign(entry, {
    stats: st, suggested: d.suggested, floor: ci.floor, raised: d.raised, cost: ci.cost, rrp: ci.rrp, ourPrice: p.price,
    action: d.action, verdict: d.action, reason: d.reason, loss: !!d.loss, bigDrop, careful: bigDrop && st.count < 3,
    // where we stand: 1 = the cheapest, among the shops that count and us
    rank: st.count ? used.filter((c) => c.price < p.price - 0.009).length + 1 : 0, of: st.count ? st.count + 1 : 0,
    vsMedian: st.median && p.price ? U.r2((p.price - st.median) / st.median) : null,
  });
}

/** The products waiting in the queue of the internet research (server.js keeps it up to date). */
let queuedWeb = new Set();
function setQueuedWeb(keys) { queuedWeb = new Set(keys); }
const WEB_DAYS = 21; // a price found on a shop page of the internet counts for three weeks (it is looked up again before)
/**
 * Prices found on the internet (lib/codefind.js: shop pages that show the SAME product) into the price research:
 * one offer per shop, beside the competitors' (never over them: a shop that is a competitor is read from its catalog).
 * byKey: { 'site:id': [hits] } → how many products changed.
 */
function mergeWeb(byKey) {
  const catalog = require('./catalog');
  const all = results();
  const dec = decisions();
  const byId = { sf: catalog.byId('sf'), st: catalog.byId('st') };
  const compHosts = new Set(competitors().map((c) => U.hostOf(c.url)).filter(Boolean));
  const at = U.nowIso();
  // a shop of the internet that is not on our list: its price is shown, and counts only after a person's yes for that
  // shop (Τιμές → «Έγκριση καταστήματος», or adding it to the competitors); a rejected shop is not shown at all
  const needOk = (settings.all().webResearch || {}).approveNewShops !== false;
  const shopDec = require('./codefind').shopDecisions();
  const approved = new Set(shopDec.approved), rejected = new Set(shopDec.rejected);
  let n = 0;
  for (const [key, hits] of Object.entries(byKey || {})) {
    const [site, id] = key.split(':');
    const p = byId[site] && byId[site].get(Number(id));
    if (!p) continue;
    // (only prices in euro; a page that showed another currency gave none) · in stock only when the page said so
    // (unknown stays unknown) · the date is the day the PAGE was read, not the day of this merge
    const offers = (hits || []).filter((h) => Number(h.price) > 0 && h.host && !compHosts.has(h.host) && !rejected.has(h.host) && (!h.currency || h.currency === 'EUR')).map((h) => ({
      pendingShop: needOk && !approved.has(h.host) && h.cls !== 'supplier' && h.cls !== 'maker',
      shop: h.host, competitorId: 'web:' + h.host, name: h.name || '', sku: h.code || '', brand: h.brand || '', url: h.url, price: U.r2(Number(h.price)), priceMax: 0, regular: Number(h.regular) > h.price ? U.r2(Number(h.regular)) : 0,
      inStock: h.avail === 'in' ? true : h.avail === 'out' ? false : null, avail: h.avail || 'unknown', img: h.img || '',
      // the same code with titles that differ: shown as «similar» until a person says yes (never counted by itself)
      match: h.match === 'code' ? 'similar' : 'exact', why: h.match === 'code' ? 'Ίδιος κωδικός, αλλά οι τίτλοι διαφέρουν: επιβεβαίωσέ το' : '', score: h.how === 'code' || h.how === 'ean' ? 1 : 0.9, how: h.how === 'ean' ? 'ean' : h.how === 'code' ? 'sku' : 'words',
      ev: [h.how === 'ean' ? 'ίδιο EAN' : h.how === 'code' ? 'ίδιος κωδικός' : 'ίδια μάρκα και μοντέλο', 'βρέθηκε στο internet'].concat(h.priceKind === 'from' ? ['τιμή «από» (τα μεγέθη έχουν άλλες τιμές)'] : []), country: /\.(gr|cy)$/.test(h.host) || /[\u0370-\u03ff]{3,}/.test(h.name || '') ? 'GR' : 'other', /* a Greek shop: .gr / .cy, or its title in Greek */ seenAt: h.at || at, web: true,
    }));
    const prev = all[key] || null;
    if (!offers.length && !(prev && prev.competitors.some((c) => c.web))) continue;
    const list = (prev ? prev.competitors.filter((c) => !c.web) : []).concat(offers);
    const d = dec[key] || {};
    const yes = new Set(d.yes || []), no = new Set(d.no || []);
    for (const x of list) { x.ignored = no.has(x.url); if (yes.has(x.url)) { x.match = 'exact'; x.confirmed = true; } }
    all[key] = compute(site, p, { at: prev ? prev.at : at, name: p.name, competitors: list, prevStats: prev ? prev.prevStats || null : null });
    n++;
  }
  if (n) store.write('market', all);
  return n;
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
  const banned = catalog.bannedOnAds();
  for (const p of catalog.load('st').products) if (p.type !== 'variation' && !L.stToSf.has(p.id) && !banned.has(p.id)) t.push({ site: 'st', id: p.id });
  return t;
}

function readable() { return competitors().filter((c) => c.enabled !== false && (c.kind === 'woo' || c.kind === 'shopify' || c.kind === 'sitemap')); }

/**
 * Which pages of a shop's site map are worth opening: those whose address names one of OUR products — a brand of
 * ours together with a model word of a product of that brand, or one of our codes. Returns want(tokens of an address).
 */
async function wantedPages(list, byId) {
  const pace = require('./bg').pacer();
  const byBrand = new Map(), codes = new Set(), pairs = new Map();
  for (const t of list) {
    if (pace.due()) await pace.rest();
    const p = byId[t.site] && byId[t.site].get(Number(t.id));
    if (!p) continue;
    const f = features(p);
    const keys = f.alpha.filter((k) => k.length >= 3 && !WEAK.has(k) && !MODIFIERS.has(k));
    for (const b of f.bt) { if (b.length < 3) continue; let set = byBrand.get(b); if (!set) byBrand.set(b, (set = new Set())); for (const k of keys) set.add(k); }
    // no brand (and no code): two of its model words in the address (RACCOON + MK2) — a product without a brand is
    // looked for too (it used to be left out of every site map)
    if (!f.bt.length && keys.length >= 2) for (const k of keys) { let set = pairs.get(k); if (!set) pairs.set(k, (set = new Set())); for (const o of keys) if (o !== k) set.add(o); }
    for (const c of f.codes) codes.add(c);
    if (f.code && f.code.base.length >= 5) codes.add(f.code.base);
  }
  return (tokens) => {
    for (const t of tokens) {
      if (codes.has(t)) return true;
      const ks = byBrand.get(t);
      if (ks) for (const k of tokens) if (ks.has(k)) return true;
      const ps = pairs.get(t);
      if (ps) for (const k of tokens) if (ps.has(k)) return true;
    }
    return false;
  };
}

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
    // shops read through their site map open only the pages that look like our products, a limited number per run
    let extra = null;
    if (comps.some((c) => c.kind === 'sitemap')) {
      const tl = targets && targets.length ? targets : targetsAll();
      extra = { want: await wantedPages(tl, { sf: catalog.byId('sf'), st: catalog.byId('st') }), budget: Math.max(20, Number(settings.all().sitemapPages) || 200) };
    }
    // a few products (a research from a product's page): the shops read in the last day are not read again — the
    // daily research keeps them fresh; only an old or missing catalog is read now
    const fresh = (c) => { const at = compcat.load(c.id).at; store.forget('comp-' + c.id); return at && Date.now() - new Date(at).getTime() < FRESH_FOR_FEW_MS; };
    const toRead = targets && targets.length ? comps.filter((c) => !fresh(c)) : comps;
    if (toRead.length < comps.length) job && job.log(`${comps.length - toRead.length} από ${comps.length} καταστήματα διαβάστηκαν πρόσφατα: χρησιμοποιείται ο κατάλογός τους.`);
    if (toRead.length) dl = await compcat.syncAll(toRead, job, catalog.makeProgress(job), extra);
    if (job && job.cancelled()) { const m = store.read('market-meta', {}); m.pausedUntil = new Date(Date.now() + 2 * 36e5).toISOString(); store.write('market-meta', m); return { stopped: true, done: 0, withData: 0, similar: 0, changes: 0, errors: dl.errors }; }
  }
  const withCatalog = comps.filter((c) => (compcat.load(c.id).products || []).length);
  if (!withCatalog.length) throw new Error('Δεν κατέβηκε κανένας κατάλογος ανταγωνιστή: ' + dl.errors.map((e) => e.name + ' — ' + e.error).join(' · '));

  const whole = !(targets && targets.length);
  const list = whole ? targetsAll() : targets;
  const byId = { sf: catalog.byId('sf'), st: catalog.byId('st') };
  // 17.000 products against every shop: in slices, so the screens keep answering (a small cloud machine would
  // otherwise freeze for half a minute per competitor)
  const bg = require('./bg');
  const pace = bg.pacer();
  const all = results();
  const dec = decisions();
  const changes = [];
  const at = U.nowIso();
  // EANs we know for our own products (found at the suppliers): the surest proof of "the same product"
  const found = (store.read('enrich-cache', null) || {}).products || {};
  const eanOf = (key) => { const e = found[key]; return e && e.data && e.data.ean ? e.data.ean : ''; };
  const readableIds = new Set(comps.map((c) => c.id));
  // our products once; then one competitor catalog in memory at a time (the indexes are the big part)
  const work = [];
  for (const t of list) {
    if (pace.due()) await pace.rest();
    const p = byId[t.site] && byId[t.site].get(Number(t.id));
    if (!p) continue;
    const key = t.site + ':' + p.id;
    const d = dec[key] || {};
    const f = features(p, { ean: eanOf(key) });
    const prev = all[key] || null;
    // what each shop offered at the last run: replaced shop by shop as each one is compared again (a shop whose
    // catalog could not be read today keeps its last offer; a shop taken off the list loses it)
    const cur = new Map(), manual = [];
    let dropped = false;
    // (the prices found on the internet stay beside them, like the ones written by hand)
    if (prev) for (const c of prev.competitors) { if (c.manual || c.web) manual.push(c); else if (readableIds.has(c.competitorId)) cur.set(c.competitorId, c); else dropped = true; }
    work.push({ t, p, key, f, prev, cur, manual, touched: !prev || dropped, yes: new Set(d.yes || []), no: new Set(d.no || []), searchable: !!(f.keys.length || f.sku || f.codes.length || f.gtin || f.code) });
  }
  // ---- progress that is never lost ----
  // A whole run is done shop by shop, and after each shop what was found is written down together with a note
  // «this shop is done, with this reading of its catalog». If the run is stopped (by a person, a restart of the free
  // cloud machine, a crash) the next run goes on with the shops that are left: nothing is compared twice, nothing
  // that was found is thrown away.
  const cm = store.read('catalog-meta', null) || {};
  const sig = [localDay(new Date(at)), LOGIC_VERSION, MATCH_VERSION, (cm.sf || {}).syncedAt || '', (cm.st || {}).syncedAt || ''].join('|');
  let prog = whole ? store.read(PROGRESS, null) : null;
  if (!prog || prog.sig !== sig || opts.fresh) prog = { sig, startedAt: at, done: {}, changes: 0 };
  const resumed = whole ? withCatalog.filter((c) => prog.done[c.id] && prog.done[c.id] === (compcat.load(c.id).at || '')).length : 0;
  if (resumed) job && job.log(`Συνέχεια από εκεί που είχε μείνει: ${resumed} από ${withCatalog.length} καταστήματα είχαν ήδη συγκριθεί.`);
  job && job.progress(0, list.length, 'Σύγκριση με ' + withCatalog.length + ' καταστήματα…');
  const commit = (w) => {
    const offers = [...w.cur.values()].concat(w.manual);
    for (const o of offers) { o.ignored = w.no.has(o.url); if (w.yes.has(o.url)) { o.match = 'exact'; o.confirmed = true; } }
    const prev = w.prev;
    const entry = compute(w.t.site, w.p, { at, name: w.p.name, competitors: offers, prevStats: prev && prev.stats && prev.stats.count && prev.at !== at ? { min: prev.stats.min, median: prev.stats.median, at: prev.at } : (prev && prev.prevStats) || null });
    if (!offers.length && !prev && !entry.loss) { delete all[w.key]; return; } // nothing to keep (a sale at a loss is always kept)
    all[w.key] = entry;
  };
  let lastSave = Date.now(), unsaved = [], step = 0, compared = 0;
  const save = async (force) => {
    if (!(unsaved.length || (force && work.some((w) => w.touched))) || (!force && Date.now() - lastSave < 45000)) return;
    for (const w of work) { if (w.touched) { commit(w); w.touched = false; } if (pace.due()) await pace.rest(); }
    await store.writeAsync('market', all, bg.breathe);
    if (whole) { for (const [id, catAt] of unsaved) prog.done[id] = catAt; prog.at = U.nowIso(); prog.changes += changes.length; store.write(PROGRESS, prog); }
    if (changes.length) { const log = store.read('market-changes', []); store.write('market-changes', changes.splice(0).concat(log).slice(0, 400)); }
    unsaved = []; lastSave = Date.now();
  };
  for (const c of withCatalog) {
    if (job && job.cancelled()) break;
    step++;
    const catAt = compcat.load(c.id).at || '';
    if (whole && !opts.fresh && prog.done[c.id] && prog.done[c.id] === catAt) { store.forget('comp-' + c.id); continue; } // already compared with this reading of its catalog
    // a few products: only the shop's items that share a word or a code with them are indexed (a whole index per shop
    // is the slow part of a research, and pointless for one product)
    const ix = !whole && work.length <= FEW ? await bg.drain(quickIndexGen(c.id, work)) : await bg.drain(indexGen(c.id));
    for (const w of work) {
      if (pace.due()) { await pace.rest(); if (job && job.cancelled()) break; }
      const o = w.searchable ? bestIn(w.f, ix, c, w.yes, w.no) : null;
      const before = w.cur.get(c.id);
      if (!o && !before) continue;
      if (o) {
        // price changes since the last run (only for products they can actually sell)
        if (before && before.url === o.url && before.price > 0 && Math.abs(before.price - o.price) >= 0.01 && o.match === 'exact' && o.inStock !== false) {
          o.prevPrice = before.price;
          changes.push({ at, site: w.t.site, id: w.p.id, name: w.p.name, shop: o.shop, url: o.url, from: before.price, to: o.price, ours: w.p.price });
        }
        w.cur.set(c.id, o);
      } else w.cur.delete(c.id);
      w.touched = true;
    }
    idxCache.delete(c.id);
    store.forget('comp-' + c.id);
    if (job && job.cancelled()) break; // a shop compared only in part is not marked as done
    compared++;
    unsaved.push([c.id, catAt]);
    job && job.progress(Math.round((step / withCatalog.length) * list.length * 0.95), list.length, `Σύγκριση… ${step}/${withCatalog.length} καταστήματα`);
    await save(false);
  }
  const stopped = !!(job && job.cancelled());
  // products without any offer and without an earlier result still get their entry looked at once (sale at a loss)
  if (!stopped) for (const w of work) if (!w.prev && !w.cur.size && !w.manual.length) w.touched = true;
  await save(true);
  let done = 0, withData = 0, similar = 0;
  for (const w of work) { done++; const e = all[w.key]; if (!e) continue; if (e.stats && e.stats.count) withData++; if (e.stats && e.stats.similar) similar++; }
  const complete = !stopped && (!whole || withCatalog.every((c) => prog.done[c.id]));
  const meta = Object.assign(store.read('market-meta', {}), {
    seconds: Math.round((Date.now() - t0) / 1000), compared: done, withData, similar, competitors: withCatalog.length,
    errors: dl.errors.map((e) => ({ name: e.name, error: e.error })),
    // where a whole run stands: how many shops are done, whether it is finished
    progress: whole ? { at: U.nowIso(), done: withCatalog.filter((c) => prog.done[c.id]).length, of: withCatalog.length, complete, stopped } : store.read('market-meta', {}).progress || null,
  });
  if (whole && complete) Object.assign(meta, { lastRun: at, lastRunDay: localDay(new Date(at)), auto: !!opts.auto, changes: prog.changes, pausedUntil: null });
  // stopped by a person: the automatic run does not start again at once (it goes on later, from where it was)
  if (whole && stopped) meta.pausedUntil = new Date(Date.now() + 2 * 36e5).toISOString();
  store.write('market-meta', meta);
  // the competitor catalogs are big: free the memory until the next run
  idxCache.clear();
  // the fixes take brands, EANs and photos from the shops with the same product: built again (in the background)
  try { require('./fixes').invalidate(); } catch (_) { /* not loaded */ }
  if (stopped) { job && job.log(`Σταμάτησε: ${meta.progress ? meta.progress.done : compared} από ${withCatalog.length} καταστήματα είναι φυλαγμένα· η επόμενη έρευνα συνεχίζει από εκεί.`); return { done, withData, similar, changes: prog.changes, errors: dl.errors, stopped: true, shops: meta.progress }; }
  job && job.progress(list.length, list.length, `Έτοιμο: ${withData.toLocaleString('el-GR')} από ${done.toLocaleString('el-GR')} προϊόντα έχουν τιμές αγοράς.`);
  return { done, withData, similar, changes: prog.changes, errors: dl.errors, shops: meta.progress, resumed };
}
const PROGRESS = 'market-progress';
// bump when the rules of «the same product» change: every shop is then compared again once
const MATCH_VERSION = 6; // 6: another colour = the same family, another variant (not counted) // 5: 5: EANs of their variants count; same model code + another EAN = similar // 4: 4: a product without a brand takes theirs when our title names it // 3: pieces written as PCS / ΤΕΜ / ΤΜΧ are the same word

/** The date on this PC's calendar (not UTC), e.g. 2026-10-29. */
function localDay(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }

/** Is today's automatic research due? (once a day, after the chosen hour, while the app is open) */
function dailyDue(now) {
  const s = settings.all();
  if (!s.marketAuto) return false;
  if (!readable().length) return false;
  const meta = store.read('market-meta', {});
  const d = now || new Date();
  if (meta.lastRunDay === localDay(d)) return false;
  if (meta.pausedUntil && new Date(meta.pausedUntil).getTime() > d.getTime()) return false; // a person stopped it: later, from where it was
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
const LOGIC_VERSION = 5; // 5: a new shop of the internet counts after a yes for it // // bump when the rules of stats()/suggest()/decision() change // 4: unknown stock never counts
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
/** The same in slices: the screens keep answering while thousands of results are recalculated (small cloud machine). */
async function recomputeAsync() {
  const catalog = require('./catalog');
  const pace = require('./bg').pacer();
  const all = results();
  const byId = { sf: catalog.byId('sf'), st: catalog.byId('st') };
  for (const key of Object.keys(all)) {
    const [site, id] = key.split(':');
    const p = byId[site] && byId[site].get(Number(id));
    if (p) compute(site, p, all[key]); else delete all[key];
    if (pace.due()) await pace.rest();
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
  const flow = require('./flow');
  const banned = site === 'st' ? catalog.bannedOnAds() : new Set(); // not allowed on the ads site: no price work for them
  for (const p of cat.products) {
    if (p.type === 'variation' || banned.has(p.id)) continue;
    let e = all[site + ':' + p.id], master = false;
    if (!e && L && L.stToSf.has(p.id)) { e = all['sf:' + L.stToSf.get(p.id)]; master = !!e; }
    // never found at any shop: shown too («Χωρίς στοιχεία»), with where the search on the internet stands
    if (!e) e = { at: null, stats: { count: 0 }, competitors: [], action: 'nodata', reason: 'Δεν βρέθηκε ακόμα σε κανένα κατάστημα (ούτε στους ανταγωνιστές, ούτε στο internet).' };
    const st = e.stats || { count: 0 };
    rows.push({
      id: p.id, name: p.name, brand: p.brand, sku: p.sku, img: p.thumb || p.images[0] || '', url: p.url, ourPrice: p.price, at: e.at, stats: st, suggested: e.suggested,
      floor: e.floor, raised: e.raised, cost: e.cost || 0, rrp: e.rrp || 0, verdict: verdict(e), action: verdict(e), reason: e.reason || '', rank: e.rank || 0, of: e.of || 0, vsMedian: e.vsMedian == null ? null : e.vsMedian,
      competitors: e.competitors, diff: e.suggested && p.price ? U.r2(e.suggested - p.price) : 0, type: p.type, master,
      prevStats: e.prevStats || null, bigDrop: !!e.bigDrop, careful: !!e.careful, stage: flow.stageOf(site, p.id),
      key: (master ? 'sf:' + L.stToSf.get(p.id) : site + ':' + p.id),
    });
  }
  // the search on the internet: waiting in the queue, looked up (with or without a price), not yet
  const ws = require('./codefind').stateOf(rows.map((r) => r.key));
  for (const r of rows) {
    const w = ws[r.key];
    // «no price» is not «not found», and «not found» is not «the search failed»: each said as it is
    const st = !w ? 'never' : w.prices ? 'found' : w.hits ? 'noprice' : ['not_found', 'no_results', 'family_only'].includes(w.status) || !w.status ? 'notfound' : w.status;
    r.web = queuedWeb.has(r.key) ? { state: 'queued' } : w ? { state: st, status: w.status || '', at: w.at, hits: w.hits, prices: w.prices, family: w.family || 0 } : { state: 'never' };
  }
  const counts = { lower: 0, raise: 0, hold: 0, watch: 0, nodata: 0, similar: 0, suspect: 0, all: rows.length, products: cat.products.filter((p) => p.type !== 'variation').length, notReady: rows.filter((r) => r.stage && r.stage < 4).length };
  for (const r of rows) { counts[r.action] = (counts[r.action] || 0) + 1; if (r.stats.similar) counts.similar++; if (r.stats.suspect) counts.suspect++; }
  counts.searching = rows.filter((r) => r.action === 'nodata' && r.web.state !== 'notfound').length;
  counts.notfound = rows.filter((r) => r.action === 'nodata' && r.web.state === 'notfound').length;
  const order = { lower: 0, raise: 1, watch: 2, hold: 3, nodata: 4 };
  let list = rows;
  const want = q.action || q.verdict;
  if (want && order[want] !== undefined) list = list.filter((r) => r.action === want);
  if (q.ready === '1') list = list.filter((r) => !r.stage || r.stage >= 4); // prices only for products whose code, facts and texts are done
  if (q.similar === '1') list = list.filter((r) => r.stats.similar > 0);
  if (q.suspect === '1') list = list.filter((r) => r.stats.suspect > 0);
  // «Χωρίς στοιχεία» in two: still to be looked up on the internet / looked up and not found anywhere
  if (q.web === 'searching') list = list.filter((r) => r.action === 'nodata' && r.web.state !== 'notfound');
  if (q.web === 'notfound') list = list.filter((r) => r.action === 'nodata' && r.web.state === 'notfound');
  if (q.q) { const t = U.foldKey(q.q).split(' ').filter(Boolean); list = list.filter((r) => { const h = U.foldKey(r.name + ' ' + (r.sku || '') + ' ' + (r.brand || '')); return t.every((x) => h.includes(x)); }); }
  // the biggest money first: the largest change, then the farthest from the market
  list.sort((a, b) => order[a.action] - order[b.action] || Math.abs(b.diff) - Math.abs(a.diff) || Math.abs(b.vsMedian || 0) - Math.abs(a.vsMedian || 0));
  const total = list.length;
  if (q.per) { const per = Math.min(500, Number(q.per) || 100), page = Math.max(1, Number(q.page) || 1); list = list.slice((page - 1) * per, page * per); }
  return { rows: list, counts, total, actions: ACTIONS, meta: store.read('market-meta', {}), changes: store.read('market-changes', []).filter((c) => c.site === site || (site === 'st' && c.site === 'sf')).slice(0, 50) };
}

/** Counts per action without building the rows (for the dashboard). */
function quickCounts(site, isReady) {
  const catalog = require('./catalog');
  const all = results();
  const byId = new Map(catalog.load(site).products.map((p) => [p.id, p]));
  const c = { lower: 0, raise: 0, hold: 0, watch: 0, nodata: 0, similar: 0, suspect: 0, loss: 0 };
  const banned = site === 'st' ? catalog.bannedOnAds() : new Set();
  for (const [key, e] of Object.entries(all)) {
    if (!key.startsWith(site + ':')) continue;
    const p = byId.get(Number(key.slice(site.length + 1)));
    if (!p || banned.has(p.id) || (isReady && !isReady(p.id))) continue;
    c[verdict(e)]++;
    if (e.stats && e.stats.similar) c.similar++;
    if (e.stats && e.stats.suspect) c.suspect++;
    if (e.loss && p.price > 0) c.loss++;
  }
  return c;
}

/** Many costs in one write: items [{ site, id, cost, rrp }]; only: keep a cost set by hand or by another list. */
function setCosts(items, source, onlyIf) {
  let n = 0;
  store.update('costs', {}, (c) => {
    for (const it of items) {
      const k = it.site + ':' + it.id;
      if (onlyIf && !onlyIf(c[k])) continue;
      const cost = U.r2(U.parseNumber(it.cost));
      if (!(cost > 0)) continue;
      const rrp = U.parseNumber(it.rrp);
      c[k] = Object.assign({ cost, source, at: U.nowIso() }, rrp > 0 ? { rrp: U.r2(rrp) } : {});
      n++;
    }
    return c;
  });
  return n;
}

/** Our cost (without VAT) for a product; rrp = the supplier's suggested retail price, when the price list has one. */
function setCost(site, id, cost, source, rrp) {
  store.update('costs', {}, (c) => {
    const n = U.parseNumber(cost);
    const r = U.parseNumber(rrp) || (c[site + ':' + id] && c[site + ':' + id].rrp) || 0;
    if (n > 0) c[site + ':' + id] = Object.assign({ cost: U.r2(n), source: source || 'manual', at: U.nowIso() }, r > 0 ? { rrp: U.r2(r) } : {}); else delete c[site + ':' + id];
    return c;
  });
}

module.exports = { MODIFIERS, setQueuedWeb, mergeWeb, WEB_DAYS, LOGIC_VERSION, ACTIONS, costInfo, decision, localDay, setCosts,
  quickCounts, competitors, competitorsView, saveCompetitor, removeCompetitor, detect, detectAll, searchUrlFor, run, dailyDue, addManual, decide, toggleIgnore, recompute, recomputeAsync, overview,
  wantedPages, coloursOf: (name) => colorsOf(tokensOf(name)), bestIn, indexGen, compute, decisions, PROGRESS, MATCH_VERSION, clearIndexes: () => idxCache.clear(),
  resultFor, results, suggest, stats, score, compare, features, candFeatures, codeBase, codeSame, codeClash, gtinOf, imageKey, queriesFor, keyTokens, setCost, floorFor, researchOne, targetsAll, readable,
};
