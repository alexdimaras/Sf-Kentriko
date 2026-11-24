'use strict';
// The AI (Ollama) as a helper of the research, never as a source: it proposes searches, gives a second look at doubtful
// pages and suggests better texts — every answer structured (JSON Schema → Ollama «format»), checked against the real
// data, cached per product and page, and asked only where the plain rules cannot decide.
//
//   queries(it)            → a few more searches (Greek / English names, other spellings): no code that is not ours
//   judge(our, page, det)  → exact | family | similar | different, with the reason: it can take a «same» away or
//                            propose one for a person's yes; it never makes a page «the same» by itself
//   suggest(product, facts)→ title / features / category proposals from the facts only (shown, never applied)
//
// On a shop's computer it asks that computer's Ollama directly (one question at a time for the whole computer); in the
// program (cloud or local) through lib/localai.js. Without an AI the research goes on as before.
const crypto = require('crypto');
const U = require('./util');

const QUERY_SCHEMA = { type: 'object', properties: { queries: { type: 'array', items: { type: 'string' }, maxItems: 6 } }, required: ['queries'] };
const JUDGE_SCHEMA = { type: 'object', properties: {
  verdict: { type: 'string', enum: ['exact', 'family', 'similar', 'different'] }, model: { type: 'string' }, colour: { type: 'string' }, size: { type: 'string' },
  reason: { type: 'string' }, confidence: { type: 'number' } }, required: ['verdict', 'reason'] };
const SUGGEST_SCHEMA = { type: 'object', properties: { title: { type: 'string' }, features: { type: 'array', items: { type: 'string' }, maxItems: 10 }, category: { type: 'string' }, notes: { type: 'string' } }, required: ['title', 'features'] };

function queryPrompt(it) {
  return `Είσαι βοηθός αναζήτησης προϊόντων για κατάστημα στρατιωτικών / τακτικών / κυνηγετικών ειδών.
Προϊόν: ${it.name}
Μάρκα: ${it.brand || '(άγνωστη)'}
Κωδικός: ${it.sku || '(κανένας)'}
Πρότεινε έως 6 διαφορετικές αναζητήσεις για να βρεθεί ΑΚΡΙΒΩΣ αυτό το προϊόν σε ηλεκτρονικά καταστήματα: ελληνικά και αγγλικά ονόματα του είδους, άλλες γραφές της μάρκας και του μοντέλου, το χρώμα στα αγγλικά. Μην επινοήσεις κωδικούς ή αριθμούς που δεν υπάρχουν παραπάνω. Απάντησε μόνο σε JSON.`;
}
/** The searches the AI proposes, checked: about this product (its brand or a model word), no number that is not ours. */
function cleanQueries(obj, it) {
  if (!obj || !Array.isArray(obj.queries)) return null;
  const market = require('./market');
  const ours = U.foldKey([it.name, it.brand, it.sku, it.ean].join(' '));
  const keys = market.keyTokens(it.name, it.brand).concat(market.features({ name: it.name, brand: it.brand }).bt);
  const nums = (s) => (U.foldKey(s).match(/\d{2,}/g) || []);
  const out = [];
  for (const q0 of obj.queries) {
    const q = U.collapse(String(q0 || '').replace(/[<>{}]/g, '')).slice(0, 120);
    if (q.length < 4) continue;
    const fq = U.foldKey(q);
    if (!keys.some((k) => k.length >= 2 && fq.includes(k))) continue; // about another product
    if (nums(q).some((n) => !ours.includes(n))) continue; // a number we never gave: invented
    if (!out.some((x) => U.foldKey(x) === fq)) out.push(q);
  }
  return out.length ? out.slice(0, 6) : [];
}

function judgePrompt(our, page, det) {
  return `Σύγκρινε δύο προϊόντα. Το δικό μας και μια σελίδα καταστήματος. Απάντησε αν η σελίδα είναι:
- "exact": ακριβώς το ίδιο προϊόν και η ίδια παραλλαγή (ίδιο μοντέλο, ίδιο χρώμα/μέγεθος/συσκευασία)
- "family": το ίδιο μοντέλο αλλά άλλη παραλλαγή (άλλο χρώμα ή μέγεθος)
- "similar": μοιάζει αλλά δεν υπάρχει επαρκής απόδειξη ότι είναι το ίδιο μοντέλο
- "different": άλλο προϊόν / άλλο μοντέλο / άλλη έκδοση (π.χ. PRO, MK2, σετ)
Βασίσου ΜΟΝΟ στα στοιχεία. Αν δεν είσαι σίγουρος, απάντησε "similar".

ΔΙΚΟ ΜΑΣ: ${our.name} · μάρκα: ${our.brand || '-'} · κωδικός: ${our.sku || '-'}
ΣΕΛΙΔΑ: ${page.name} · μάρκα: ${page.brand || '-'} · κωδικός: ${page.sku || '-'} · EAN: ${page.ean || '-'}${(page.variants || []).length ? ' · παραλλαγές: ' + page.variants.join(' | ') : ''}
Ο αυτόματος έλεγχος είπε: ${det.match}${det.why ? ' (' + det.why + ')' : ''}`;
}
function cleanJudge(obj) {
  if (!obj || !['exact', 'family', 'similar', 'different'].includes(obj.verdict)) return null;
  const c = Number(obj.confidence);
  return { verdict: obj.verdict, model: String(obj.model || '').slice(0, 80), colour: String(obj.colour || '').slice(0, 40), size: String(obj.size || '').slice(0, 20), reason: U.collapse(String(obj.reason || '')).slice(0, 200), confidence: isFinite(c) ? Math.max(0, Math.min(1, c > 1 ? c / 100 : c)) : 0 };
}

/** The shop's own words, in a few lines (never the whole catalog): its preferred kind words and foreign words. */
function shopWords() {
  try {
    const K = require('./knowledge').terms();
    const pref = [...K.preferred].map(([f, v]) => `${v.to} (όχι ${f})`);
    const fw = [...K.foreign].map(([f, v]) => `${f} = ${v.to}`);
    return (pref.length || fw.length) ? `\nΛέξεις του καταστήματος για το είδος: ${pref.concat(fw).slice(0, 30).join(' · ')}.` : '';
  } catch (_) { return ''; }
}
function suggestPrompt(p, facts) {
  return `Πρότεινε βελτιώσεις για προϊόν ηλεκτρονικού καταστήματος στρατιωτικών / τακτικών ειδών, ΜΟΝΟ από τα στοιχεία που δίνονται.
Κανόνες τίτλου: μόνο κεφαλαία, μορφή ΕΙΔΟΣ ΜΑΡΚΑ ΜΟΝΤΕΛΟ [ΧΡΩΜΑ], χωρίς κωδικό και χωρίς μέγεθος. Το ΕΙΔΟΣ στα ελληνικά, με τη λέξη του καταστήματος· αν δεν είναι σαφές από τα στοιχεία, κράτα το είδος του τίτλου.${shopWords()}
Χαρακτηριστικά: σύντομες γραμμές, μόνο ό,τι αναφέρεται στα στοιχεία. Μην επινοήσεις αριθμούς, υλικά ή πιστοποιήσεις.
Απάντησε μόνο σε JSON.

Τίτλος σήμερα: ${p.name}
Μάρκα: ${p.brand || '-'}
Κατηγορία σήμερα: ${(p.catNames || []).join(', ') || '-'}
Στοιχεία από πηγές:
${facts}`;
}
/** A suggestion, checked: the title in capitals, without a code, no number that is not in the facts. */
function cleanSuggest(obj, p, facts) {
  if (!obj || typeof obj.title !== 'string' || !Array.isArray(obj.features)) return null;
  const localai = require('./localai');
  const known = U.foldKey(facts + ' ' + p.name);
  let title = U.greekUpper(U.collapse(obj.title)).slice(0, 120);
  // (the shop's word for the kind, whatever the model wrote: ΣΗΜΑ → ΔΙΑΚΡΙΤΙΚΟ)
  try { const K = require('./knowledge').terms(); const f = title.split(' ')[0]; const pr = K.preferred.get(f); if (pr) title = pr.to + title.slice(f.length); } catch (_) { /* fine */ }
  if (p.sku && U.normSku(title).includes(U.normSku(p.sku)) && U.normSku(p.sku).length >= 4) title = '';
  if ((title.match(/\d+/g) || []).some((n) => !known.includes(n))) title = '';
  const g = localai.guardFacts(obj.features.map((x) => '- ' + String(x).slice(0, 160)).join('\n'), facts + ' ' + p.name);
  return { title, features: g.text.split('\n').map((l) => l.replace(/^-\s*/, '').trim()).filter(Boolean).slice(0, 10), category: String(obj.category || '').slice(0, 80), notes: String(obj.notes || '').slice(0, 200), removed: g.removed };
}

// ---------- a cache of answers, per question ----------
const memo = new Map();
function cacheKey(task, text) { return task + ':' + crypto.createHash('sha1').update(text).digest('hex').slice(0, 20); }
function cached(task, text, days) {
  const k = cacheKey(task, text);
  if (memo.has(k)) return memo.get(k);
  try { const c = (require('./store').read('ai-cache', null) || {})[k]; if (c && Date.now() - new Date(c.at).getTime() < (days || 30) * 864e5) { memo.set(k, c.v); return c.v; } } catch (_) { /* none */ }
  return undefined;
}
function remember(task, text, v) {
  const k = cacheKey(task, text);
  memo.set(k, v);
  if (memo.size > 2000) memo.delete(memo.keys().next().value);
  try {
    require('./store').update('ai-cache', {}, (c) => {
      c[k] = { at: new Date().toISOString(), v };
      const keys = Object.keys(c);
      if (keys.length > 3000) for (const x of keys.sort((a, b) => String(c[a].at).localeCompare(String(c[b].at))).slice(0, keys.length - 3000)) delete c[x];
      return c;
    });
  } catch (_) { /* in memory then */ }
}

// ---------- one question at a time for the whole computer (its runners share one Ollama) ----------
let lockSeq = 0;
const waiting = new Map();
let localBusy = Promise.resolve();
function withLock(fn) {
  if (process.env.SFK_RUNNER && process.send) {
    const id = ++lockSeq;
    if (!withLock.on) { withLock.on = true; process.on('message', (m) => { if (m && m.t === 'ailock' && waiting.has(m.id)) { const f = waiting.get(m.id); waiting.delete(m.id); f(); } }); }
    return new Promise((ok) => { waiting.set(id, ok); process.send({ t: 'ailock', id }); }).then(async () => { try { return await fn(); } finally { try { process.send({ t: 'aiunlock' }); } catch (_) { /* gone */ } } });
  }
  const run = localBusy.then(fn, fn);
  localBusy = run.catch(() => {});
  return run;
}

/**
 * The AI of a shop's computer for its research jobs: that computer's Ollama, asked directly (no trip to the cloud).
 * → { queries(it), judge(our, page, det) } or null when this computer has no Ollama / no model that writes.
 */
function forWorker(api, wanted) {
  const localai = require('./localai');
  let model = null, base = null, off = false;
  const stats = { calls: 0, ms: 0, tokens: 0, failed: 0 };
  const ready = async () => {
    if (off) return false;
    if (model) return true;
    try {
      base = localai.resolveUrl(process.env.SFK_WORKER_OLLAMA_URL || '');
      const tags = await localai.ollamaFetch(base, '/api/tags', null, { timeout: 4000 });
      // the model chosen in the settings when this computer has it, else its first model that writes
      let p = localai.pickModel(localai.modelsOf(tags), wanted || '');
      if (p.error && wanted) p = localai.pickModel(localai.modelsOf(tags), '');
      if (p.error) { off = true; return false; }
      model = p.model; return true;
    } catch (_) { off = true; return false; }
  };
  const askJson = async (task, prompt, schema, validate, maxTokens) => {
    if (!(await ready())) return null;
    const hit = cached(task, model + '|' + prompt);
    if (hit !== undefined) return hit;
    return withLock(async () => {
      for (const fmt of [schema, 'json']) {
        const t0 = Date.now();
        let j;
        try { j = await localai.ollamaFetch(base, '/api/generate', { model, prompt, stream: false, keep_alive: '15m', format: fmt, options: { temperature: 0, num_ctx: 4096, num_predict: maxTokens || 300 } }, { timeout: 90000, signal: api && api.signal }); } catch (e) {
          stats.failed++;
          if (fmt !== 'json' && /format|schema/i.test(e.message)) continue;
          return null;
        }
        stats.calls++; stats.ms += Date.now() - t0; stats.tokens += (Number(j.eval_count) || 0) + (Number(j.prompt_eval_count) || 0);
        let obj = null;
        try { obj = JSON.parse(localai.cleanAnswer(j.response)); } catch (_) { obj = null; }
        const v = obj ? validate(obj) : null;
        if (v) { remember(task, model + '|' + prompt, v); return v; }
      }
      return null;
    });
  };
  return {
    stats,
    async queries(it) { const list = await askJson('queries', queryPrompt(it), QUERY_SCHEMA, (o) => cleanQueries(o, it), 200); return list && list.length ? { at: new Date().toISOString(), list, model } : null; },
    async judge(our, page, det) { return askJson('judge', judgePrompt(our, page, det), JUDGE_SCHEMA, cleanJudge, 220); },
  };
}

/** In the program (a person asked, from the product's card): through lib/localai (a computer's Ollama in the cloud). */
async function suggestFor(p, facts) {
  const localai = require('./localai');
  const key = 'suggest|' + p.name + '|' + facts;
  const hit = cached('suggest', key, 14);
  if (hit !== undefined) return Object.assign({ cached: true }, hit);
  const a = await localai.askJson(suggestPrompt(p, facts), SUGGEST_SCHEMA, (o) => cleanSuggest(o, p, facts), { maxTokens: 600, task: 'suggest' });
  const v = Object.assign({ model: a.model, ms: a.ms, tokens: a.tokens }, a.data);
  remember('suggest', key, v);
  return v;
}
async function judgeFor(our, page, det) {
  const localai = require('./localai');
  const a = await localai.askJson(judgePrompt(our, page, det), JUDGE_SCHEMA, cleanJudge, { maxTokens: 220, task: 'judge' });
  return Object.assign({ model: a.model, ms: a.ms }, a.data);
}

module.exports = { forWorker, suggestFor, judgeFor, cleanQueries, cleanJudge, cleanSuggest, queryPrompt, judgePrompt, QUERY_SCHEMA, JUDGE_SCHEMA, SUGGEST_SCHEMA, withLock };
