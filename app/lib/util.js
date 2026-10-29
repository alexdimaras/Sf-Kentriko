'use strict';
// Greek text, numbers, prices, CSV helpers. No dependencies.

const ACC = { 'ά': 'α', 'έ': 'ε', 'ή': 'η', 'ί': 'ι', 'ό': 'ο', 'ύ': 'υ', 'ώ': 'ω', 'ΐ': 'ϊ', 'ΰ': 'ϋ',
  'Ά': 'Α', 'Έ': 'Ε', 'Ή': 'Η', 'Ί': 'Ι', 'Ό': 'Ο', 'Ύ': 'Υ', 'Ώ': 'Ω' };
const ACC_RE = /[άέήίόύώΐΰΆΈΉΊΌΎΏ]/g;

function stripTonos(s) { return String(s == null ? '' : s).replace(ACC_RE, (c) => ACC[c]); }
function collapse(s) { return String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); }

/** Store title style: capitals without accents, single spaces. */
function greekUpper(s) { return collapse(stripTonos(s).toUpperCase()); }

/** Plain key for comparisons: no accents, no diaeresis, upper, lookalike letters folded to Latin. */
const FOLD = { 'Α': 'A', 'Β': 'B', 'Ε': 'E', 'Ζ': 'Z', 'Η': 'H', 'Ι': 'I', 'Κ': 'K', 'Μ': 'M', 'Ν': 'N', 'Ο': 'O', 'Ρ': 'P', 'Τ': 'T', 'Υ': 'Y', 'Χ': 'X', 'Ϊ': 'I', 'Ϋ': 'Y' };
function foldKey(s) {
  return collapse(stripTonos(decodeEntities(s)).toUpperCase().replace(/[ΑΒΕΖΗΙΚΜΝΟΡΤΥΧΪΫ]/g, (c) => FOLD[c]));
}

/**
 * Title Case: first letter of each word capital, rest lower. Codes stay as they are.
 * Greek words written in capitals have lost their accents; accents.get(KEY) gives the accented
 * lower-case form ('ΠΑΝΤΕΛΟΝΙ' -> 'παντελόνι'), learned from the shop's own texts.
 */
function titleCase(s, accents) {
  return collapse(s).split(' ').map((w) => {
    if (!w) return w;
    if (/\d/.test(w)) return w; // 3-9X40, 5.11, M65
    if (w.length <= 3 && /^[A-Z.\-/&]+$/.test(w)) return w; // BDU, LED, US
    return w.split('-').map((part) => {
      const m = part.match(/^([^\p{L}]*)(\p{L}[\p{L}\p{M}']*)([^\p{L}]*)$/u);
      if (!m) return part;
      let core = m[2];
      let lower = core.toLocaleLowerCase('el-GR');
      if (accents && /[\u0370-\u03ff]/.test(core)) {
        const known = accents.get(greekUpper(core));
        if (known) lower = known;
      }
      lower = lower.replace(/σ$/, 'ς');
      core = lower.charAt(0).toUpperCase() + lower.slice(1);
      return m[1] + core + m[3];
    }).join('-');
  }).join(' ');
}

/** Build/extend an accent map from free text: KEY (caps, no accents) -> most frequent accented lower form. */
function learnAccents(text, counts) {
  counts = counts || new Map();
  const words = String(text || '').match(/[\u0370-\u03ff\u1f00-\u1fff]{3,}/g) || [];
  for (const raw of words) {
    if (!/[άέήίόύώΐΰ]/.test(raw)) continue;
    const w = raw.toLocaleLowerCase('el-GR');
    const key = greekUpper(w);
    let m = counts.get(key);
    if (!m) { m = new Map(); counts.set(key, m); }
    m.set(w, (m.get(w) || 0) + 1);
  }
  return counts;
}
function accentMapFrom(counts, base) {
  const out = new Map();
  for (const w of base || []) out.set(greekUpper(w), w);
  for (const [key, forms] of counts) {
    if (out.has(key)) continue;
    let best = null, bn = 0;
    for (const [f, n] of forms) if (n > bn) { best = f; bn = n; }
    if (best) out.set(key, best);
  }
  return out;
}

const GREEKLISH_2 = [['ου', 'ou'], ['αι', 'ai'], ['ει', 'ei'], ['οι', 'oi'], ['μπ', 'mp'], ['ντ', 'nt'], ['γκ', 'gk'], ['γγ', 'ng'], ['αυ', 'av'], ['ευ', 'ev']];
const GREEKLISH_1 = { 'θ': 'th', 'χ': 'ch', 'ψ': 'ps', 'φ': 'f', 'ξ': 'x', 'α': 'a', 'β': 'v', 'γ': 'g', 'δ': 'd', 'ε': 'e', 'ζ': 'z', 'η': 'i', 'ι': 'i', 'κ': 'k', 'λ': 'l', 'μ': 'm', 'ν': 'n', 'ο': 'o', 'π': 'p', 'ρ': 'r', 'σ': 's', 'ς': 's', 'τ': 't', 'υ': 'y', 'ω': 'o', 'ϊ': 'i', 'ϋ': 'y' };
function greeklish(s) {
  let t = stripTonos(String(s || '')).toLocaleLowerCase('el-GR').replace(/ΐ/g, 'ι').replace(/ΰ/g, 'υ');
  for (const [a, b] of GREEKLISH_2) t = t.split(a).join(b);
  return t.replace(/[α-ωϊϋς]/g, (c) => GREEKLISH_1[c] || c);
}
function slugify(s) {
  return greeklish(s).normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 90);
}

// ---- Mixed Greek / Latin letters inside words ----
const LAT2GR = { 'A': 'Α', 'B': 'Β', 'E': 'Ε', 'Z': 'Ζ', 'H': 'Η', 'I': 'Ι', 'K': 'Κ', 'M': 'Μ', 'N': 'Ν', 'O': 'Ο', 'P': 'Ρ', 'T': 'Τ', 'Y': 'Υ', 'X': 'Χ' };
const GR2LAT = {}; for (const k of Object.keys(LAT2GR)) GR2LAT[LAT2GR[k]] = k;
const GREEK_ONLY = /[ΓΔΘΛΞΠΣΦΨΩγδθλξπσςφψωάέήίόύώϊϋΐΰ]/;
const GREEK_ANY = /[Ͱ-Ͽ]/;
const LATIN_ONLY = /[CDFGJLQRSUVWcdfgjlqrsuvw]/;
const LATIN_ANY = /[A-Za-z]/;

/**
 * Fix lookalike letters typed in the wrong alphabet (ΔΙXΤΥA, BEREΤTA, ΗΜΙΑΥTOΜΑΤΟ, ΛΑΔl).
 * dict (optional): Set of Greek words in capitals without accents; used to flag Latin-typed Greek words (KONTAKIA).
 * Returns { text, changed, suspects:[{word, fix}] }.
 */
const LAT2GR_LOWER = { l: 'Ι', i: 'Ι', o: 'Ο' };
function scriptOf(ch) { return /[Ͱ-Ͽ]/.test(ch) ? 'G' : /[A-Za-z]/.test(ch) ? 'L' : ''; }
function fixWord(w, ctxGreek, near) {
  if (!(GREEK_ANY.test(w) && LATIN_ANY.test(w))) return null;
  // lower-case Latin l / i / o inside an upper-case Greek word (ΛΑΔl → ΛΑΔΙ)
  if (/[Ͱ-Ͽ]/.test(w) && /[lio]/.test(w) && !/[a-hjkmnp-z]/.test(w)) {
    const n = w.replace(/[lio]/g, (c) => LAT2GR_LOWER[c]);
    if (!LATIN_ANY.test(n)) return n;
    w = n;
  }
  const up = w.toUpperCase();
  const grOnly = GREEK_ONLY.test(up), latOnly = LATIN_ONLY.test(up);
  const toGr = (x) => x.replace(/[ABEZHIKMNOPTYX]/g, (c) => LAT2GR[c]);
  const toLat = (x) => x.replace(/[ΑΒΕΖΗΙΚΜΝΟΡΤΥΧ]/g, (c) => GR2LAT[c]);
  if (grOnly && !latOnly) { const n = toGr(w); return LATIN_ANY.test(n) ? null : n; }
  if (latOnly && !grOnly) { const n = toLat(w); return GREEK_ANY.test(n) ? null : n; }
  if (!grOnly && !latOnly) {
    let g = 0, l = 0;
    for (const ch of w) { const sc = scriptOf(ch); if (sc === 'G') g++; else if (sc === 'L') l++; }
    // every letter exists in both alphabets (PΟΙΝΤ): the words around it decide (DROP PΟΙΝΤ RH-21 → POINT),
    // then the majority of its letters, then the title
    const greek = near ? near === 'G' : (g === l ? ctxGreek : g > l);
    const n = greek ? toGr(w) : toLat(w);
    return (greek ? LATIN_ANY : GREEK_ANY).test(n) ? null : n;
  }
  // Both alphabets have letters of their own: two words glued together (ΠΥΡΟΜΑΧΙΚΩΝMFH → ΠΥΡΟΜΑΧΙΚΩΝ MFH)
  for (let i = 1; i < w.length; i++) {
    const a = w.slice(0, i), b = w.slice(i);
    const aG = GREEK_ONLY.test(a) && !LATIN_ONLY.test(a.toUpperCase()), bL = LATIN_ONLY.test(b.toUpperCase()) && !GREEK_ONLY.test(b);
    const aL = LATIN_ONLY.test(a.toUpperCase()) && !GREEK_ONLY.test(a), bG = GREEK_ONLY.test(b) && !LATIN_ONLY.test(b.toUpperCase());
    if (aG && bL && scriptOf(w[i]) === 'L' && scriptOf(w[i - 1]) === 'G') return toGr(a) + ' ' + toLat(b);
    if (aL && bG && scriptOf(w[i]) === 'G' && scriptOf(w[i - 1]) === 'L') return toLat(a) + ' ' + toGr(b);
  }
  return null;
}
function fixMixedScript(title, knownLatinWords, dict, greekTitleWords) {
  const known = knownLatinWords || new Set();
  const words = collapse(title).split(' ');
  const greekWords = words.filter((w) => GREEK_ANY.test(w)).length;
  const latinWords = words.filter((w) => LATIN_ANY.test(w) && !GREEK_ANY.test(w)).length;
  const ctxGreek = greekWords >= latinWords;
  const suspects = [];
  let changed = false;
  const GREEK_SMALL = { ME: 'ΜΕ', KAI: 'ΚΑΙ', TO: 'ΤΟ', TA: 'ΤΑ', TH: 'ΤΗ', THN: 'ΤΗΝ', TON: 'ΤΟΝ', TOY: 'ΤΟΥ', TOYS: '', MIA: 'ΜΙΑ', ENA: 'ΕΝΑ' };
  const out = words.map((w, wi) => {
    // short Greek words typed in Latin between Greek words (… ΤΥΠΟΥ GORETEX ME ΕΠΕΝΔΥΣΗ …)
    if (ctxGreek && GREEK_SMALL[w] && (GREEK_ANY.test(words[wi + 1] || '') || GREEK_ANY.test(words[wi - 1] || ''))) { changed = true; return GREEK_SMALL[w]; }
    // fix each part of tokens like K25,ΤΑΝ or ΘΗΚΗ/POUCH separately
    const parts = w.split(/([,/()+&]+)/);
    const pure = (x) => { if (!x) return null; const gr = GREEK_ANY.test(x), la = LATIN_ANY.test(x); return gr && !la ? 'G' : la && !gr ? 'L' : null; };
    const a = pure(words[wi - 1]), b = pure(words[wi + 1]);
    const near = a && b ? (a === b ? a : null) : (a || b);
    let f = null;
    if (parts.length > 1) {
      const fixed = parts.map((x) => (/[,/()+&]/.test(x) ? x : fixWord(x, ctxGreek, near) || x));
      f = fixed.join('');
    } else f = fixWord(w, ctxGreek, near);
    if (f && f !== w) { changed = true; return f; }
    // A whole word in Latin lookalike letters that is really a Greek word (KONTAKIA → ΚΟΝΤΑΚΙΑ)
    if (greekWords >= 1 && /^[ABEZHIKMNOPTYX]{4,}$/.test(w) && !known.has(w)) {
      const g = w.replace(/[ABEZHIKMNOPTYX]/g, (c) => LAT2GR[c]);
      // Greek spelling in Latin letters (OY for ΟΥ, H before a consonant: TITANIOY, KENTHMA) or a Greek
      // word the shop writes in its own titles (KONTAKIA). Names such as MONTANA, NEON, KAZAN stay.
      const greekish = /OY|H(?=[BKMNPTXZ])/.test(w);
      const shopWord = greekTitleWords && (greekTitleWords.get(g) || 0) >= 2;
      if ((!dict || dict.has(g)) && (greekish || (shopWord && near !== 'L') || !greekTitleWords)) suspects.push({ word: w, fix: g });
    }
    // …and the opposite: a Latin word typed in Greek lookalike letters (SHIRT SHORT ΚΗΑΚΙ → KHAKI)
    if (/^[ΑΒΕΖΗΙΚΜΝΟΡΤΥΧ]{3,}$/.test(w) && (near === 'L' || (!near && !ctxGreek))) {
      const l = w.replace(/[ΑΒΕΖΗΙΚΜΝΟΡΤΥΧ]/g, (c) => GR2LAT[c]);
      if (known.has(l) && !(dict && dict.has(w))) suspects.push({ word: w, fix: l });
    }
    return w;
  });
  return { text: out.join(' '), changed, suspects };
}

/** Capitals for the store's title style, leaving codes/units with digits as written (9x19, 400g, 1800Lm). */
function capsTitle(name) {
  return collapse(name).split(' ').map((w) => (/\d/.test(w) ? stripTonos(w) : greekUpper(w))).join(' ');
}
/** Does a title break the capitals rule (ignoring tokens that contain digits)? */
function hasLowercase(name) {
  return collapse(name).split(' ').some((w) => !/\d/.test(w) && /\p{Ll}/u.test(w));
}

/**
 * Spelling suggestions for Greek words in capitals (ΠΙΙΣΤΟΛΙ → ΠΙΣΤΟΛΙ, ΗΜΙΑΥΟΤΜΑΤΟ → ΗΜΙΑΥΤΟΜΑΤΟ).
 * freq: Map WORD -> count of titles using it; dict: Set of valid words. Only edits away from the last two
 * letters count, so normal Greek endings (ΜΑΥΡΟ/ΜΑΥΡΗ) are never "corrected".
 */
const GR_UP = 'ΑΒΓΔΕΖΗΘΙΚΛΜΝΞΟΠΡΣΤΥΦΧΨΩ';
function spellSuggest(word, freq, dict) {
  if (word.length < 5 || !/^[Α-Ω]+$/.test(word) || dict.has(word) || (freq.get(word) || 0) >= 3) return '';
  const cands = new Map();
  const consider = (c, pos) => {
    if (pos >= word.length - 2) return;
    const f = freq.get(c) || 0;
    if (f >= 5 || (dict.has(c) && f >= 2)) cands.set(c, Math.max(cands.get(c) || 0, f));
  };
  for (let i = 0; i < word.length; i++) {
    consider(word.slice(0, i) + word.slice(i + 1), i); // extra letter
    if (i < word.length - 1) consider(word.slice(0, i) + word[i + 1] + word[i] + word.slice(i + 2), i); // swapped
    for (const ch of GR_UP) {
      if (ch !== word[i]) consider(word.slice(0, i) + ch + word.slice(i + 1), i); // wrong letter
      consider(word.slice(0, i) + ch + word.slice(i), i); // missing letter
    }
  }
  let best = '', bf = 0;
  for (const [c, f] of cands) if (f > bf) { bf = f; best = c; }
  return best;
}

function toGreekLetters(word) { return word.replace(/[ABEZHIKMNOPTYX]/g, (c) => LAT2GR[c]); }

// ---- Entities / HTML ----
const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', laquo: '«', raquo: '»', euro: '€', hellip: '…', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', deg: '°', times: '×', copy: '©', reg: '®', trade: '™', middot: '·', bull: '•', frac12: '½', frac14: '¼', frac34: '¾', prime: '′', Prime: '″' };
function decodeEntities(s) {
  return String(s == null ? '' : s).replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (m, e) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      try { return String.fromCodePoint(code); } catch (_) { return m; }
    }
    return Object.prototype.hasOwnProperty.call(NAMED, e) ? NAMED[e] : m;
  });
}
/** Undo WordPress "smart" punctuation that the public API adds to titles (″ for ", × for x, – for -). */
function untexturize(s) {
  return String(s == null ? '' : s)
    .replace(/[″“”„]/g, '"').replace(/[′‘’‚]/g, "'")
    .replace(/(\d)\s?×\s?(\d)/g, '$1x$2').replace(/ – /g, ' - ').replace(/…/g, '...');
}
function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function stripTags(html) {
  return collapse(decodeEntities(String(html || '')
    .replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|li|h\d|div|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')));
}

// ---- Numbers / money ----
function parseNumber(v) {
  if (typeof v === 'number') return isFinite(v) ? v : 0;
  let s = String(v == null ? '' : v).replace(/[^0-9,.\-]/g, '');
  if (!s || s === '-') return 0;
  const lc = s.lastIndexOf(','), ld = s.lastIndexOf('.');
  if (lc > -1 && ld > -1) {
    if (lc > ld) s = s.replace(/\./g, '').replace(',', '.'); else s = s.replace(/,/g, '');
  } else if (lc > -1) {
    const dec = s.length - lc - 1;
    s = (dec === 3 && s.split(',').length > 1 && !/^0,/.test(s) && s.indexOf(',') === lc && s.length > 4) ? s.replace(',', '') : s.replace(/,/g, '.');
    const parts = s.split('.'); if (parts.length > 2) s = parts.slice(0, -1).join('') + '.' + parts.at(-1);
  } else if (ld > -1) {
    const parts = s.split('.');
    if (parts.length > 2) s = parts.slice(0, -1).join('') + '.' + parts.at(-1);
  }
  const n = parseFloat(s);
  return isFinite(n) ? n : 0;
}
const r2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
function money(n) {
  return r2(n).toLocaleString('el-GR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
}
/** Round up to a nice ending. mode: '90' | '99' | '00' | 'none' */
function roundPrice(p, mode) {
  p = r2(p);
  if (p <= 0) return 0;
  if (mode === '90' || mode === '99') {
    const end = mode === '90' ? 0.9 : 0.99;
    let r = Math.floor(p) + end;
    if (r + 0.0001 < p) r += 1;
    return r2(r);
  }
  if (mode === '00') return Math.ceil(p - 0.0001);
  return p;
}
/** Largest nice ending not above p. */
function roundDown(p, mode) {
  p = r2(p);
  if (p <= 0) return 0;
  if (mode === '90' || mode === '99') {
    const end = mode === '90' ? 0.9 : 0.99;
    let r = Math.floor(p) + end;
    if (r > p + 0.0001) r -= 1;
    return r > 0 ? r2(r) : p;
  }
  if (mode === '00') return Math.max(1, Math.floor(p + 0.0001));
  return p;
}
function median(arr) {
  const a = arr.filter((x) => x > 0).sort((x, y) => x - y);
  if (!a.length) return 0;
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : r2((a[m - 1] + a[m]) / 2);
}

// ---- CSV ----
function csvCell(v, sep) {
  if (v == null) return '';
  const s = Array.isArray(v) ? v.join(', ') : String(v);
  return /["\r\n]/.test(s) || s.indexOf(sep) > -1 || /^\s|\s$/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
/** Excel (Greek locale): semicolon + BOM. WooCommerce importer: comma, UTF-8. */
function toCSV(rows, columns, opts) {
  const o = Object.assign({ sep: ',', bom: true }, opts || {});
  const head = columns.map((c) => csvCell(c.label || c.key, o.sep)).join(o.sep);
  const body = rows.map((r) => columns.map((c) => {
    let v = typeof c.get === 'function' ? c.get(r) : r[c.key];
    if (typeof v === 'number' && o.excel) v = String(v).replace('.', ',');
    return csvCell(v, o.sep);
  }).join(o.sep));
  return (o.bom ? '﻿' : '') + [head].concat(body).join('\r\n') + '\r\n';
}
/** Robust CSV parser: autodetects ; , or tab, handles quotes and newlines in cells. */
function parseCSV(text, forcedSep) {
  text = String(text || '').replace(/^﻿/, '');
  const firstLine = text.slice(0, text.indexOf('\n') > -1 ? text.indexOf('\n') : text.length);
  let sep = forcedSep;
  if (!sep) {
    const counts = { ',': 0, ';': 0, '\t': 0, '|': 0 };
    let q = false;
    for (const ch of firstLine) { if (ch === '"') q = !q; else if (!q && ch in counts) counts[ch]++; }
    sep = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0];
    if (!counts[sep]) sep = ',';
  }
  const rows = []; let row = []; let cell = ''; let q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch;
    } else if (ch === '"' && cell === '') q = true;
    else if (ch === sep) { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else cell += ch;
  }
  if (cell !== '' || row.length) { row.push(cell); if (row.length > 1 || row[0] !== '') rows.push(row); }
  return { sep, rows };
}
/** Decode bytes: UTF-8 if valid, otherwise Windows-1253 (Greek Excel). */
const CP1253 = (() => {
  const m = {};
  const hi = '€\u0081‚ƒ„…†‡\u0088‰\u008a‹\u008c\u008d\u008e\u008f\u0090‘’“”•–—\u0098™\u009a›\u009c\u009d\u009e\u009f ΅Ά£¤¥¦§¨©ª«¬­®―°±²³΄µ¶·ΈΉΊ»Ό½ΎΏΐΑΒΓΔΕΖΗΘΙΚΛΜΝΞΟΠΡÒΣΤΥΦΧΨΩΪΫάέήίΰαβγδεζηθικλμνξοπρςστυφχψωϊϋόύώÿ';
  for (let i = 0; i < hi.length; i++) m[0x80 + i] = hi[i];
  return m;
})();
function decodeText(buf) {
  if (!Buffer.isBuffer(buf)) return String(buf);
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buf).replace(/^﻿/, ''); } catch (_) { /* not utf-8 */ }
  if (buf[0] === 0xff && buf[1] === 0xfe) return buf.slice(2).toString('utf16le');
  let s = '';
  for (const b of buf) s += b < 0x80 ? String.fromCharCode(b) : (CP1253[b] || '?');
  return s;
}

// ---- misc ----
function uid(prefix) { return (prefix || '') + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
function hostOf(u) { try { return new URL(u).hostname.replace(/^www\./, '').toLowerCase(); } catch (_) { return ''; } }
function normUrl(u) {
  u = String(u || '').trim();
  if (!u) return '';
  if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
  try { const x = new URL(u); return x.origin + x.pathname.replace(/\/+$/, ''); } catch (_) { return ''; }
}
function normSku(s) { return String(s || '').toUpperCase().replace(/[\s\-_./]+/g, ''); }
function nowIso() { return new Date().toISOString(); }
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

module.exports = {
  stripTonos, collapse, greekUpper, foldKey, capsTitle, hasLowercase, spellSuggest, titleCase, learnAccents, accentMapFrom, greeklish, slugify, fixMixedScript, toGreekLetters,
  decodeEntities, untexturize, escapeHtml, stripTags, parseNumber, r2, money, roundPrice, roundDown, median,
  toCSV, parseCSV, decodeText, uid, hostOf, normUrl, normSku, nowIso, sleep, GREEK_ONLY, LATIN_ONLY,
};
