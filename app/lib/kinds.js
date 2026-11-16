'use strict';
// What a product IS — its kind, the word a title must start with (ΦΥΣΙΓΓΙΑ, ΦΑΚΟΣ, ΣΑΚΙΔΙΟ…).
// It is worked out from proof, in this order, and every answer says where it came from:
//   1. title    — a kind word of the shop inside the title, wherever it stands (5.11 ΣΑΚΙΔΙΟ RUSH → ΣΑΚΙΔΙΟ)
//   2. compound — a trade name that only one kind has (12ΒΟΛΑ, 9ΒΟΛΟ, ΜΟΝΟΒΟΛΑ, ΔΡΑΜΙΑ → ΦΥΣΙΓΓΙΑ)
//   3. category — the product's own categories, from the nearest one up
//                 (ΦΥΣΙΓΓΙΑ ΚΥΝΗΓΙΟΥ-ΣΚΟΠΟΒΟΛΗΣ › FEDERAL → ΦΥΣΙΓΓΙΑ)
// Nothing here is guessed from titles that merely look alike: when there is no proof the answer is empty, and
// the caller may fall back to "similar products" — clearly marked as a suggestion to check.
const U = require('./util');

// Trade names that say the kind without naming it. [pattern on one word (capitals, no accents), kind]
// «12ΒΟΛΑ» = a shotgun cartridge with 12 pellets; «ΜΟΝΟΒΟΛΑ» = slugs; «ΔΡΑΜΙΑ» = buckshot.
const COMPOUNDS = [
  [/^\d{1,2}-?ΒΟΛ[ΑΟ]$/, 'ΦΥΣΙΓΓΙΑ'],
  [/^ΜΟΝΟΒΟΛ[ΑΟ]$/, 'ΦΥΣΙΓΓΙΑ'],
  [/^ΔΡΑΜΙΑ?$/, 'ΦΥΣΙΓΓΙΑ'],
  [/^ΦΥΣ+ΙΓ+Ι(Α|Ο|ΩΝ)$/, 'ΦΥΣΙΓΓΙΑ'], // also the common slips ΦΥΣΣΙΓΙΑ / ΦΥΣΙΓΙΑ
];
// the same written in two words: «12 ΒΟΛΑ», «27 ΒΟΛΟ»
const COMPOUND_2 = /(?:^|[\s(])\d{1,2}\s?-?\s?ΒΟΛ[ΑΟ](?=$|[\s),])/;

/** Words of a title as the checks see them: capitals, no accents, letters of the wrong alphabet put right. */
function words(name) {
  return U.greekUpper(U.repairEntities(name) || name).replace(/[\u200b()[\],;:!?«»"']/g, ' ').split(/\s+/).filter(Boolean)
    .map((w) => (/[Ͱ-Ͽ]/.test(w) && /[A-Z]/.test(w) ? U.fixMixedScript(w).text : w));
}
// «of something»: ΚΥΝΗΓΙΟΥ, ΣΚΟΠΟΒΟΛΗΣ, ΟΠΛΩΝ, ΑΣΦΑΛΕΙΑΣ — words that describe a kind, never a second kind
const GENITIVE = /(ΟΥ|ΗΣ|ΩΝ|ΑΣ|ΕΩΣ)$/;
/** Is this word a kind by itself (no digits, Greek letters, at least 3)? */
const plainGreek = (w) => /^[Α-Ω]{3,}$/.test(w);

/** The kind said by a trade name inside the title → { kind, word } or null. */
function compound(name) {
  const ws = words(name);
  for (const w of ws) for (const [re, kind] of COMPOUNDS) if (re.test(w)) return { kind, word: w };
  const m = ws.join(' ').match(COMPOUND_2);
  return m ? { kind: 'ΦΥΣΙΓΓΙΑ', word: U.collapse(m[0].replace(/[()]/g, '')) } : null;
}

/** Two forms of the same word (ΣΑΚΙΔΙΑ / ΣΑΚΙΔΙΟ, ΦΑΚΟΙ / ΦΑΚΟΣ, ΖΩΝΕΣ / ΖΩΝΗ)? */
function sameStem(a, b) {
  if (a === b) return true;
  const short = Math.min(a.length, b.length);
  if (Math.abs(a.length - b.length) > 3) return false;
  let i = 0;
  while (i < short && a[i] === b[i]) i++;
  return i >= Math.max(3, short - 1);
}

/**
 * A recogniser for one site. nouns: the shop's own kind words (learned from its titles: words that are almost
 * always the first word), most common first. idx: catalog.categoryIndex(site). brandWords: the words of the
 * known brands (capitals), so a brand in a category name is told apart from another kind of product.
 */
function recogniser(nouns, idx, brandWords) {
  const list = (nouns || []).filter(plainGreek);
  // Latin words in a category name: a brand (FEDERAL, UMAREX) says nothing about the kind; any other word (T-SHIRT,
  // FIBER OPTICS, RAIL SYSTEMS) is a second kind of thing in the same category
  const isBrandish = (w) => !brandWords || brandWords.has(w);
  const set = new Set(list);
  const catMemo = new Map();
  /**
   * The kind a category is named after — only when it names exactly one and nothing else: «ΦΥΣΙΓΓΙΑ ΚΥΝΗΓΙΟΥ-ΣΚΟΠΟΒΟΛΗΣ»
   * (the other words say "of what": genitives) is ΦΥΣΙΓΓΙΑ; «ΜΠΟΥΦΑΝ/ΑΔΙΑΒΡΟΧΑ», «ΛΙΠΑΝΤΙΚΑ - ΚΑΘΑΡΙΣΤΙΚΑ ΟΠΛΩΝ» or
   * «ΕΞΟΠΛΙΣΜΟΣ - ΘΗΚΕΣ - ΑΞΕΣΟΥΑΡ» hold several kinds of things and prove nothing.
   */
  function ofCategory(cat) {
    if (catMemo.has(cat.id)) return catMemo.get(cat.id);
    const hits = new Set();
    let other = false;
    for (const w of words(cat.name).join(' ').split(/[\s\-–/,&.]+/)) {
      if (!plainGreek(w)) { if (/[A-Z]/.test(w) && !/[Α-Ω]/.test(w) && w.length > 2) other = other || !isBrandish(w); continue; }
      if (w.length < 4 || GENITIVE.test(w)) continue;
      const c = COMPOUNDS.find(([re]) => re.test(w));
      const n = c ? c[1] : list.find((x) => sameStem(x, w));
      if (n) hits.add(n); else other = true;
    }
    const res = hits.size === 1 && !other ? [...hits][0] : '';
    catMemo.set(cat.id, res);
    return res;
  }
  /**
   * The kind of a product → { kind, how: 'title'|'compound'|'category', sure, proof, at } — kind '' when unknown.
   * `at` is the place of the kind word in the title (0 = the title already starts with it), -1 when it is not there.
   */
  function kindOf(p) {
    const ws = words(p.name);
    const at = ws.findIndex((w) => set.has(w));
    const comp = compound(p.name);
    // a kind word leads the title: nothing to work out (ΜΟΝΟΒΟΛΑ, ΔΡΑΜΙΑ are words customers look for, too)
    if (at === 0) return { kind: ws[0], how: 'title', sure: true, proof: '', at: 0 };
    if (comp && comp.kind !== comp.word) {
      const kAt = ws.indexOf(comp.kind);
      return { kind: comp.kind, how: kAt >= 0 ? 'title' : 'compound', sure: true, proof: `«${comp.word}» λέγεται μόνο για ${comp.kind}`, at: kAt };
    }
    if (at > 0) return { kind: ws[at], how: 'title', sure: true, proof: '', at };
    if (comp) return { kind: comp.kind, how: 'title', sure: true, proof: '', at: ws.indexOf(comp.word) };
    // The product's own categories, the nearest first — only for a title with no Greek word of its own (GLOCK 34 GEN 5,
    // OPINEL CARBON #07): a Greek word in the title (ΑΚΟΝΙΣΤΗΣ, ΛΑΔΙ, ΒΟΥΡΤΣΑ) may be the real kind of an accessory
    // that simply sits in the same category.
    if (idx && !ws.some((w) => /^[Α-Ω]{2,}$/.test(w))) {
      let best = null;
      for (const id of p.cats || []) {
        const chain = idx.ancestors(id);
        for (let d = 0; d < chain.length; d++) {
          const k = ofCategory(chain[d]);
          if (!k) { if (plainName(chain[d].name)) break; continue; } // a Greek-named category that proves nothing ends the climb
          if (!best || d < best.d) best = { d, k, path: idx.pathOf(id).join(' › '), clash: false };
          else if (d === best.d && k !== best.k) best.clash = true;
          break;
        }
      }
      if (best && !best.clash) return { kind: best.k, how: 'category', sure: true, proof: `είναι στην κατηγορία «${best.path}»`, at: -1 };
    }
    return { kind: '', how: '', sure: false, proof: '', at: -1 };
  }
  return { kindOf, ofCategory, isKind: (w) => set.has(w) };
}

// little words that tie a noun to what follows: the noun after them is not the kind (ΦΑΚΟΣ … ΜΕ ΒΑΣΗ)
const PREP = new Set(['ΜΕ', 'ΓΙΑ', 'ΚΑΙ', 'ΣΕ', 'ΑΠΟ', 'ΤΟ', 'ΤΗΝ', 'ΤΟΝ', 'ΤΟΥ', 'ΤΗΣ', 'ΤΩΝ', 'ΧΩΡΙΣ', 'Η']);
const COLOUR = /^(ΜΑΥΡ|ΛΕΥΚ|ΑΣΠΡ|ΓΚΡΙ|ΜΠΛΕ|ΚΟΚΚΙΝ|ΚΑΦΕ|ΠΡΑΣΙΝ|ΛΑΔΙ|ΧΑΚΙ|ΜΠΕΖ|ΠΟΡΤΟΚΑΛ|ΚΙΤΡΙΝ|ΡΟΖ|ΜΩΒ|ΑΣΗΜ|ΧΡΥΣ|ΛΑΧΑΝΙ|ΑΜΜΟΥ|ΕΡΗΜΟΥ|ΜΠΟΡΝΤΟ|ΣΚΟΥΡ|ΑΝΟΙΧΤ|ΓΑΛΑΖΙ|ΤΙΡΚΟΥΑΖ)/;
/**
 * A title that carries its kind in the middle, put in the shop's order (ΕΙΔΟΣ ΜΑΡΚΑ ΜΟΝΤΕΛΟ): the kind goes first
 * together with the Greek words that belong to it — what stands right before it (ΓΥΝΑΙΚΕΙΟ ΑΡΒΥΛΟ, ΗΜΙΑΥΤΟΜΑΤΗ
 * ΚΑΡΑΜΠΙΝΑ) and what describes it right after (ΣΑΚΙΔΙΟ ΠΛΑΤΗΣ, ΣΗΜΑ ΡΑΦΤΟ), never a colour or what follows «ΜΕ / ΓΙΑ».
 * isKind(word) says which words are kinds. Returns { fix, phrase } or null.
 */
function kindFirst(name, isKind) {
  const toks = U.collapse(String(name || '').replace(/\u200b/g, '')).split(' ');
  const keys = toks.map((t) => (words(t)[0] || ''));
  const greek = (k) => /^[Α-Ω]{2,}$/.test(k) && !PREP.has(k);
  const at = keys.findIndex((k, i) => i > 0 && isKind(k) && !PREP.has(keys[i - 1]));
  if (at < 1) return null;
  let from = at, to = at;
  while (from > 0 && greek(keys[from - 1]) && !COLOUR.test(keys[from - 1])) from--;
  if (from === 0) return null; // the title already starts with these words
  while (to + 1 < toks.length && greek(keys[to + 1]) && !COLOUR.test(keys[to + 1])) to++;
  const phrase = toks.slice(from, to + 1);
  return { fix: phrase.concat(toks.slice(0, from), toks.slice(to + 1)).join(' '), phrase: phrase.join(' ') };
}
/** Does a title start with something that is not a kind word (a brand, a code, «12ΒΟΛΑ»)? */
function startsWithoutKind(name) {
  const first = words(name)[0] || '';
  if (!first) return false;
  if (!/[Ͱ-Ͽ]/.test(first)) return true;
  if (!/\d/.test(first)) return false;
  const c = compound(first);
  return !!c && c.kind !== first;
}

/** Does a category name have Greek words (a real category, not a brand folder like «FEDERAL»)? */
function plainName(name) { return words(name).some((w) => /^[Α-Ω]{4,}$/.test(w)); }

module.exports = { recogniser, compound, sameStem, words, kindFirst, startsWithoutKind, COMPOUNDS };
