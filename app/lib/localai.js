'use strict';
// Optional free AI that runs on the shop's own PC (Ollama, https://ollama.com). No subscription, no data leaves the PC.
//
// One path, the same everywhere:
//   • the address of Ollama: resolveUrl() — the address written in the settings (of this program, or of the worker
//     with «node worker.js ollama <address>»), else SFK_OLLAMA_URL, else http://127.0.0.1:11434;
//   • the model: pickModel() — the one chosen in the settings when it is installed (also «qwen2.5» = «qwen2.5:7b»),
//     else the first installed model that writes text (never an embedding model); a chosen model that is not
//     installed is said plainly, never swapped silently;
//   • the program in the cloud has no Ollama: setRemote() sends the question to a shop's computer that has it and
//     the chosen model (server.js · jobtypes «ai.call» · worker.js).
// test() checks every step for real: Ollama answers, models, the chosen model, and a real answer to a short question.
const settings = require('./settings');
const U = require('./util');

const DEFAULT_URL = 'http://127.0.0.1:11434';
const GEN_TIMEOUT = Number(process.env.SFK_AI_TIMEOUT_MS) || 300000; // a 7B model on a processor: up to a few minutes
// enough room for the facts and the answer (Ollama's default of 2048 tokens cut long Greek texts without a word)
const NUM_CTX = 8192;

function cfg() { return settings.all().localAI || {}; }

/** The address of Ollama: an address that was set (settings / worker.json) → SFK_OLLAMA_URL → the usual one. */
function resolveUrl(setting) {
  const clean = (u) => String(u || '').trim().replace(/\/+$/, '');
  const s = clean(setting);
  const env = clean(process.env.SFK_OLLAMA_URL);
  const pick = s && s !== DEFAULT_URL ? s : env || s || DEFAULT_URL;
  if (!/^https?:\/\/[^\s/]+/i.test(pick)) throw aiError('bad_url', `Η διεύθυνση του Ollama «${pick}» δεν είναι σωστή (π.χ. http://127.0.0.1:11434).`);
  return pick;
}
function aiError(code, msg, extra) { return Object.assign(new Error(msg), { code, ai: true }, extra || {}); }

/** Ollama's own words for what went wrong → a plain answer. */
function explain(status, body) {
  const m = String((body && body.error) || '').slice(0, 300);
  if (status === 404 && /model/i.test(m)) return aiError('model_missing', `Το μοντέλο δεν είναι εγκατεστημένο στο Ollama (${m}). Στο PC γράψε: ollama pull <μοντέλο>.`);
  if (/memory|out of memory|insufficient/i.test(m)) return aiError('memory', `Δεν φτάνει η μνήμη του υπολογιστή για αυτό το μοντέλο (${m}). Κλείσε προγράμματα ή διάλεξε μικρότερο μοντέλο (π.χ. qwen2.5:3b).`);
  return aiError('http', `Το Ollama απάντησε με σφάλμα ${status}${m ? ': ' + m : ''}.`);
}

/** One request to an Ollama (this computer's or the one at `base`). */
async function ollamaFetch(base, path, body, opts) {
  const o = opts || {};
  const sigs = [AbortSignal.timeout(o.timeout || GEN_TIMEOUT)];
  if (o.signal) sigs.push(o.signal);
  let r;
  try {
    r = await fetch(base + path, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.any(sigs) });
  } catch (e) {
    if (o.signal && o.signal.aborted) throw aiError('cancelled', 'Σταμάτησε.', { cancelled: true });
    if (e.name === 'TimeoutError' || e.name === 'AbortError') throw aiError('timeout', 'Το Ollama άργησε πολύ να απαντήσει (το μοντέλο φορτώνει ή είναι μεγάλο για αυτόν τον υπολογιστή). Δοκίμασε ξανά ή διάλεξε μικρότερο μοντέλο.');
    const c = String((e.cause && (e.cause.code || e.cause.message)) || e.message);
    if (/ECONNREFUSED|ENOTFOUND|EHOSTUNREACH|ECONNRESET|fetch failed/i.test(c + e.message)) throw aiError('unreachable', `Δεν απαντά το Ollama στη διεύθυνση ${base}. Άνοιξε το Ollama (εικονίδιο κάτω δεξιά) ή εγκατάστησέ το από το ollama.com.`);
    throw aiError('unreachable', 'Το Ollama δεν απάντησε: ' + e.message);
  }
  const text = await r.text().catch(() => '');
  let j = null;
  try { j = text ? JSON.parse(text) : null; } catch (_) { j = null; }
  if (!r.ok) throw explain(r.status, j);
  if (!j || typeof j !== 'object') throw aiError('bad_response', `Στη διεύθυνση ${base} απαντά κάτι άλλο, όχι το Ollama.`);
  return j;
}

// ---------- models ----------
const isEmbedding = (m) => /embed|bge-|minilm|e5-|nomic-bert/i.test(m.name) || (m.families || []).some((f) => /bert/i.test(f));
/** The models of an /api/tags answer: [{ name, size, family, families, params, embedding }]. */
function modelsOf(tags) {
  return ((tags && tags.models) || []).filter((m) => m && m.name).map((m) => {
    const d = m.details || {};
    const x = { name: String(m.name), size: Number(m.size) || 0, family: String(d.family || ''), families: Array.isArray(d.families) ? d.families.map(String) : [], params: String(d.parameter_size || '') };
    x.embedding = isEmbedding(x);
    return x;
  });
}
const PREFERRED = /qwen|llama|gemma|mistral|aya|phi|granite|deepseek/i;
/**
 * The model to use. → { model, how, error } — how: 'chosen' (exactly the one in the settings), 'alias' (qwen2.5 =
 * qwen2.5:latest / qwen2.5:7b), 'auto' (nothing chosen: the first text model). error: the chosen one is not installed.
 */
function pickModel(models, wanted) {
  const list = (models || []).map((m) => (typeof m === 'string' ? { name: m, embedding: isEmbedding({ name: m }) } : m));
  const text = list.filter((m) => !m.embedding);
  const w = String(wanted || '').trim();
  if (w) {
    const lw = w.toLowerCase();
    const exact = list.find((m) => m.name === w) || list.find((m) => m.name.toLowerCase() === lw);
    if (exact) return { model: exact.name, how: 'chosen' };
    const alias = list.find((m) => m.name.toLowerCase() === lw + ':latest') || list.find((m) => !m.embedding && m.name.toLowerCase().startsWith(lw + (lw.includes(':') ? '' : ':'))) || list.find((m) => !m.embedding && lw.includes(':') && m.name.toLowerCase().startsWith(lw));
    if (alias) return { model: alias.name, how: 'alias' };
    return { model: '', how: 'missing', error: aiError('model_missing', `Το μοντέλο «${w}» δεν είναι εγκατεστημένο. ${text.length ? 'Εγκατεστημένα: ' + text.map((m) => m.name).join(', ') + '. Γράψε ένα από αυτά στις Ρυθμίσεις ή' : 'Στο PC'} τρέξε: ollama pull ${w}`) };
  }
  if (!text.length) return { model: '', how: 'none', error: aiError('no_model', list.length ? 'Στο Ollama υπάρχουν μόνο μοντέλα αναζήτησης (embedding), όχι μοντέλο που γράφει κείμενο. Στο PC τρέξε: ollama pull qwen2.5:7b' : 'Δεν υπάρχει εγκατεστημένο μοντέλο στο Ollama. Στο PC τρέξε: ollama pull qwen2.5:7b') };
  const best = text.find((m) => PREFERRED.test(m.name)) || text[0];
  return { model: best.name, how: 'auto' };
}

// ---------- here or on a shop's computer ----------
// In the cloud (server.js): { call(path, body, timeout, { model }), models() → [{ worker, name, models }], why() }
let remote = null;
function setRemote(r) { remote = typeof r === 'function' ? { call: r } : r; }
function where() { return remote ? 'computer' : 'local'; }
async function call(path, body, timeout, meta) {
  if (remote) return remote.call(path, body, timeout, meta || {});
  return ollamaFetch(resolveUrl(cfg().url), path, body, { timeout });
}

async function status() {
  const r = await call('/api/tags', null, 15000);
  const models = modelsOf(r);
  return { ok: true, where: where(), url: remote ? '' : resolveUrl(cfg().url), models: models.map((m) => m.name), details: models };
}

/** The model this program uses now: from the computers' lists in the cloud (no round trip), else from Ollama. */
async function chooseModel() {
  const c = cfg();
  let names;
  if (remote && remote.models) names = [...new Set((await remote.models()).flatMap((w) => w.models || []))];
  if (!names || !names.length) names = (await status()).details;
  const p = pickModel(names, c.model);
  if (p.error) throw p.error;
  return p;
}

/** Strip a «thinking» model's reasoning (<think>…</think>) and the polite openings: only the text. */
function cleanAnswer(s) {
  return String(s || '').replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/^<think>[\s\S]*$/i, '').replace(/^\s*(Φυσικά|Βεβαίως|Ορίστε|Εδώ είναι)[^\n]{0,80}:\s*\n/i, '').trim();
}

/** One answer. opts: { maxTokens, temperature, model, force (also when switched off: the test) } → { text, model, ms, tokens, cut } */
async function ask(prompt, opts) {
  const o = opts || {};
  const c = cfg();
  if (!c.enabled && !o.force) throw aiError('disabled', 'Το τοπικό AI είναι κλειστό (Ρυθμίσεις → AI: «Ενεργό»).');
  const model = o.model || (await chooseModel()).model;
  const t0 = Date.now();
  const body = Object.assign({ model, prompt, stream: false, keep_alive: '15m', options: { temperature: o.temperature == null ? 0.3 : o.temperature, num_ctx: NUM_CTX, num_predict: o.maxTokens || 1200 } }, o.format ? { format: o.format } : {}, o.system ? { system: o.system } : {});
  const r = await call('/api/generate', body, o.timeout || GEN_TIMEOUT, { model });
  const text = cleanAnswer(r.response);
  if (!text) throw aiError('empty', `Το μοντέλο ${model} δεν έδωσε απάντηση. Δοκίμασε ξανά ή άλλο μοντέλο.`);
  const out = { text, model, ms: Date.now() - t0, tokens: Number(r.eval_count) || 0, promptTokens: Number(r.prompt_eval_count) || 0, cut: r.done_reason === 'length' };
  logUse(o.task || 'text', out);
  return out;
}
/** Every question to the AI written down (task, model, time, tokens): the screen shows what the AI costs. */
function logUse(task, a) {
  try {
    require('./store').update('ai-log', {}, (d) => {
      d.items = (d.items || []).concat([{ at: new Date().toISOString(), task: String(task).slice(0, 20), model: a.model, ms: a.ms, tokens: a.tokens, promptTokens: a.promptTokens || 0, ok: a.ok !== false }]).slice(-300);
      const t = (d.totals = d.totals || {})[task] || { calls: 0, ms: 0, tokens: 0 };
      t.calls++; t.ms += a.ms || 0; t.tokens += (a.tokens || 0) + (a.promptTokens || 0); d.totals[task] = t;
      return d;
    });
  } catch (_) { /* never in the way */ }
}

/**
 * A structured answer (Ollama structured outputs: the JSON Schema goes as «format»). The answer is parsed and checked
 * with validate(obj) → the clean object or null; one more try only when the answer is not valid JSON / not valid.
 * Older Ollama without schemas: asked again with format 'json'. → { data, model, ms, tokens, tries }
 */
async function askJson(prompt, schema, validate, opts) {
  const o = Object.assign({ temperature: 0, maxTokens: 500 }, opts || {});
  let last = null, tries = 0;
  for (const fmt of [schema, schema, 'json']) {
    tries++;
    let a;
    try { a = await ask(prompt, Object.assign({}, o, { format: fmt })); } catch (e) {
      if (/format|schema|invalid/i.test(e.message) && fmt !== 'json') { last = e; continue; }
      throw e;
    }
    let obj = null;
    try { obj = JSON.parse(a.text.replace(/^```(?:json)?\s*|\s*```$/g, '')); } catch (_) { obj = null; }
    const clean = obj && validate ? validate(obj) : obj;
    if (clean) return Object.assign({ data: clean, tries }, a);
    last = aiError('bad_json', 'Το AI δεν έδωσε έγκυρη δομημένη απάντηση.');
  }
  throw last || aiError('bad_json', 'Το AI δεν έδωσε έγκυρη δομημένη απάντηση.');
}
async function generate(prompt, opts) { return (await ask(prompt, opts)).text; }

/**
 * The real test, step by step (what the «Δοκιμή» button shows): → { ok, where, url, steps: [{ id, ok, text }],
 * models, model, answer, ms }. It never throws: a failed step says what is missing.
 */
async function test() {
  const steps = [];
  const out = { ok: false, where: where(), url: '', steps, models: [], model: '', answer: '', ms: 0, enabled: !!cfg().enabled };
  const step = (id, ok, text) => { steps.push({ id, ok, text }); return ok; };
  try {
    if (remote && remote.why) {
      const w = await remote.why();
      if (!step('computer', w.ok, w.text)) return out;
    } else if (!remote) {
      out.url = resolveUrl(cfg().url);
    }
    let tags;
    try { tags = await call('/api/tags', null, 15000); } catch (e) { step('reach', false, e.message); return out; }
    const models = modelsOf(tags);
    out.models = models.map((m) => m.name);
    step('reach', true, remote ? 'Ο υπολογιστής που βοηθά βλέπει το Ollama.' : `Το Ollama απαντά (${out.url}).`);
    const p = pickModel(models, cfg().model);
    if (!step('models', models.some((m) => !m.embedding), models.length ? 'Εγκατεστημένα μοντέλα: ' + models.map((m) => m.name + (m.params ? ` (${m.params})` : '') + (m.embedding ? ' [μόνο αναζήτηση]' : '')).join(', ') : 'Κανένα μοντέλο. Στο PC τρέξε: ollama pull qwen2.5:7b')) return out;
    if (!step('model', !p.error, p.error ? p.error.message : p.how === 'auto' ? `Κανένα μοντέλο δεν επιλέχθηκε: χρησιμοποιείται το ${p.model}.` : p.how === 'alias' ? `Το «${cfg().model}» είναι το εγκατεστημένο ${p.model}.` : `Το μοντέλο ${p.model} είναι εγκατεστημένο.`)) return out;
    out.model = p.model;
    // a real answer, short: the model is loaded and writes (the first time it loads, it may take a minute)
    let a;
    try { a = await ask('Απάντησε στα ελληνικά με μία μόνο λέξη: ποιο είναι το χρώμα του ουρανού μια καθαρή μέρα;', { model: p.model, maxTokens: 24, temperature: 0, force: true, timeout: 180000 }); } catch (e) { step('generate', false, 'Το μοντέλο δεν απάντησε: ' + e.message); return out; }
    out.answer = a.text.slice(0, 200); out.ms = a.ms;
    step('generate', true, `Πραγματική απάντηση σε ${(a.ms / 1000).toFixed(1)}″: «${out.answer}»`);
    step('greek', /[Ͱ-Ͽ]/.test(a.text), /[Ͱ-Ͽ]/.test(a.text) ? 'Γράφει ελληνικά.' : 'Η απάντηση δεν ήταν στα ελληνικά: για ελληνικά κείμενα προτίμησε qwen2.5:7b ή aya-expanse.');
    if (!out.enabled) step('enabled', false, 'Όλα δουλεύουν, αλλά το AI είναι κλειστό: τσέκαρε «Ενεργό» και Αποθήκευση.');
    out.ok = steps.every((s) => s.ok || s.id === 'greek');
    return out;
  } catch (e) {
    step('error', false, e.message);
    return out;
  }
}

// ---------- texts ----------
function toHtml(text) {
  const lines = String(text || '').replace(/\r/g, '').split('\n').map((l) => l.trim());
  let html = '', inList = false;
  for (const l of lines) {
    if (!l) { if (inList) { html += '</ul>'; inList = false; } continue; }
    const li = l.match(/^(?:[-*•]|\d{1,2}[.)])\s+(.*)$/);
    if (li) { if (!inList) { html += '<ul>'; inList = true; } html += `<li>${U.escapeHtml(li[1].replace(/\*\*/g, ''))}</li>`; continue; }
    if (inList) { html += '</ul>'; inList = false; }
    html += `<p>${U.escapeHtml(l.replace(/\*\*/g, '').replace(/^#+\s*/, ''))}</p>`;
  }
  if (inList) html += '</ul>';
  return html;
}

// numbers are where a model invents most (weights, sizes, lumens, years): every number of the answer must be in the facts
const NUM = /\d+(?:[.,]\d+)?/g;
const numsOf = (s) => new Set((String(s || '').match(NUM) || []).map((n) => n.replace(',', '.').replace(/\.0+$/, '')));
/**
 * Keep only what the facts support: a list line or sentence with a number that is not in the facts is taken out.
 * → { text, removed: [lines] }
 */
function guardFacts(text, facts) {
  const known = numsOf(facts);
  const removed = [];
  const ORD = /^\s*\d{1,2}[.)]\s+/; // «1. …» a numbered list: the number is not a fact
  const bad = (s) => [...numsOf(String(s).replace(ORD, ''))].filter((n) => !known.has(n));
  const lines = String(text || '').split('\n').map((line) => {
    if (!bad(line).length) return line;
    if (/^\s*[-*•]/.test(line) || ORD.test(line)) { removed.push(line.trim()); return null; }
    const keep = line.split(/(?<=[.;!;])\s+/).filter((s) => { if (bad(s).length) { removed.push(s.trim()); return false; } return true; });
    return keep.join(' ');
  }).filter((l) => l !== null);
  return { text: lines.join('\n'), removed };
}

function factsOf(d) {
  const f = d.fields || {};
  return [
    'Προϊόν: ' + (d.displayTitle || d.title || ''),
    f.brand ? 'Μάρκα: ' + f.brand : '',
    f.model ? 'Μοντέλο: ' + f.model : '',
    (d.variations || []).length ? 'Μεγέθη/χρώματα: ' + [...new Set(d.variations.map((v) => [v.size, v.color].filter(Boolean).join(' ')).filter(Boolean))].join(', ') : '',
    ...(d.specs || []).slice(0, 25).map((s) => s.k + ': ' + s.v),
    ...(d.features || []).slice(0, 20).map((x) => '- ' + x),
    d.keyPoints ? 'Σημειώσεις καταστήματος: ' + d.keyPoints : '',
    d.descOfficial ? 'Επίσημο κείμενο του κατασκευαστή: ' + U.stripTags(d.descOfficial).slice(0, 3500) : '',
  ].filter(Boolean).join('\n');
}

/** A Greek description from the real facts of a product only. → { html, model, removed, notes } */
async function describeFull(d) {
  const facts = factsOf(d);
  if (facts.split('\n').length < 3 && !d.descOfficial) throw aiError('few_facts', 'Πολύ λίγα στοιχεία για περιγραφή: πρόσθεσε χαρακτηριστικά (ή διεύθυνση σελίδας του κατασκευαστή) και ξαναδοκίμασε. Το AI δεν γράφει τίποτα που δεν του δίνεται.');
  const prompt = `Γράψε περιγραφή προϊόντος στα ελληνικά για ηλεκτρονικό κατάστημα στρατιωτικών, τακτικών και κυνηγετικών ειδών.
Κανόνες:
- Χρησιμοποίησε ΜΟΝΟ τα στοιχεία που δίνονται παρακάτω. Μην προσθέσεις αριθμούς, υλικά, διαστάσεις, βάρη, πιστοποιήσεις ή χρήσεις που δεν αναφέρονται.
- Αν κάποιο στοιχείο είναι στα αγγλικά, μετάφρασέ το· κράτα όπως είναι μάρκες, μοντέλα, κωδικούς και μονάδες.
- Ύφος απλό, ξεκάθαρο, χωρίς υπερβολές και χωρίς τιμές.
Μορφή: 2 σύντομες παράγραφοι και μετά λίστα με παύλες (-) για τα χαρακτηριστικά. Χωρίς τίτλο.

ΣΤΟΙΧΕΙΑ:
${facts}`;
  const a = await ask(prompt, { maxTokens: 900 });
  const g = guardFacts(a.text, facts);
  const notes = [];
  if (g.removed.length) notes.push(`Αφαιρέθηκαν ${g.removed.length} φράσεις με αριθμούς που δεν υπάρχουν στα στοιχεία (το AI τα επινόησε).`);
  if (a.cut) notes.push('Η απάντηση κόπηκε στο όριο μήκους: διάβασέ τη πριν την έγκριση.');
  return { html: toHtml(g.text), model: a.model, removed: g.removed, notes };
}
async function describe(d) { return (await describeFull(d)).html; }

/** A translation into Greek, in pieces (a long text in one go used to be cut short). → { html, model, notes } */
async function translateFull(html) {
  const blocks = String(html || '').replace(/<\/(p|li|h\d|tr|div)>/gi, '\n').replace(/<li[^>]*>/gi, '- ').replace(/<br\s*\/?>/gi, '\n');
  // line by line (stripTags joins everything into one line: a list lost its lines and a long text could not be split)
  const text = U.decodeEntities(blocks.replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ')).split('\n').map((l) => U.collapse(l)).filter(Boolean).join('\n').slice(0, 9000);
  if (!text) throw aiError('empty_source', 'Δεν υπάρχει κείμενο για μετάφραση.');
  const parts = [];
  let cur = '';
  for (const line of text.split('\n')) { if (cur && cur.length + line.length > 1800) { parts.push(cur); cur = ''; } cur += (cur ? '\n' : '') + line; }
  if (cur) parts.push(cur);
  const out = [], notes = [];
  let model = '';
  for (const p of parts) {
    const a = await ask(`Μετάφρασε στα ελληνικά το παρακάτω κείμενο προϊόντος. Κράτα ονόματα μάρκας, μοντέλα, κωδικούς, αριθμούς και μονάδες όπως είναι. Κράτα τις γραμμές που ξεκινούν με παύλα. Μην προσθέσεις τίποτα. Επέστρεψε μόνο τη μετάφραση.\n\n${p}`, { maxTokens: 1800, temperature: 0.2 });
    model = a.model;
    const g = guardFacts(a.text, p);
    if (g.removed.length) notes.push(`Αφαιρέθηκαν ${g.removed.length} φράσεις με αριθμούς που δεν υπάρχουν στο πρωτότυπο.`);
    if (a.cut) notes.push('Ένα κομμάτι κόπηκε στο όριο μήκους.');
    out.push(g.text);
  }
  return { html: toHtml(out.join('\n\n')), model, notes };
}
async function translate(html) { return (await translateFull(html)).html; }

module.exports = { askJson, logUse, setRemote, status, generate, ask, test, describe, describeFull, translate, translateFull, pickModel, modelsOf, resolveUrl, ollamaFetch, guardFacts, cleanAnswer, toHtml, DEFAULT_URL, where };
