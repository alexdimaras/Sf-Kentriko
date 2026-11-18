'use strict';
process.env.SFK_ALLOW_PRIVATE = '1';
// SF Κέντρο — the free AI (Ollama), the whole way: the address, the models, the chosen model, a REAL generate call
// (against a little Ollama on this machine that answers exactly like the real one: the same paths, the same fields, the
// same error texts), the guard against invented facts, and the question routed to the computer that has the model.
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const APP = path.join(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sfk-ai-'));
process.env.SFK_DATA = path.join(tmp, 'data');
process.env.APPDATA = path.join(tmp, 'cfg');
fs.mkdirSync(process.env.SFK_DATA, { recursive: true });
delete process.env.SFK_OLLAMA_URL;

let fails = 0, passes = 0;
function ok(cond, name, detail) {
  if (cond) passes++; else fails++;
  console.log((cond ? '  ok   ' : '  FAIL ') + name + (cond || detail === undefined ? '' : ' — ' + detail));
}
const section = (t) => console.log('\n' + t);

/** A little Ollama: GET /api/tags, GET /api/version, POST /api/generate (model check, options recorded). */
function fakeOllama(state) {
  const srv = http.createServer((req, res) => {
    const send = (code, j) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(j)); };
    if (req.method === 'GET' && req.url === '/api/version') return send(200, { version: '0.12.6' });
    if (req.method === 'GET' && req.url === '/api/tags') return send(200, { models: state.models.map((n) => ({ name: n, model: n, size: 4.7e9, details: { family: /embed/.test(n) ? 'nomic-bert' : 'qwen2', families: [/embed/.test(n) ? 'nomic-bert' : 'qwen2'], parameter_size: /embed/.test(n) ? '137M' : '7.6B' } })) });
    if (req.method === 'POST' && req.url === '/api/generate') {
      let b = '';
      req.on('data', (c) => { b += c; });
      return req.on('end', () => {
        const j = JSON.parse(b);
        state.calls.push(j);
        if (!state.models.includes(j.model)) return send(404, { error: `model "${j.model}" not found, try pulling it first` });
        if (state.memory) return send(500, { error: 'model requires more system memory (5.6 GiB) than is available (2.1 GiB)' });
        const delay = state.delay || 0;
        setTimeout(() => {
          const answer = typeof state.answer === 'function' ? state.answer(j) : state.answer;
          send(200, { model: j.model, created_at: new Date().toISOString(), response: answer, done: true, done_reason: 'stop', eval_count: 42 });
        }, delay);
      });
    }
    send(404, { error: 'not found' });
  });
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r({ srv, url: 'http://127.0.0.1:' + srv.address().port })));
}

(async () => {
  const store = require(APP + '/lib/store'); store.init();
  const settings = require(APP + '/lib/settings');
  const localai = require(APP + '/lib/localai');
  const state = { models: ['qwen2.5:7b', 'nomic-embed-text:latest'], calls: [], answer: 'Μπλε.' };
  const ol = await fakeOllama(state);

  section('Η διεύθυνση του Ollama: μία, ίδια παντού');
  ok(localai.resolveUrl('') === 'http://127.0.0.1:11434', 'nothing set → the usual address');
  process.env.SFK_OLLAMA_URL = 'http://10.0.0.5:11434/';
  ok(localai.resolveUrl('') === 'http://10.0.0.5:11434' && localai.resolveUrl('http://127.0.0.1:11434') === 'http://10.0.0.5:11434', 'SFK_OLLAMA_URL is used when the settings keep the usual address');
  ok(localai.resolveUrl('http://192.168.1.20:11434') === 'http://192.168.1.20:11434', 'an address written in the settings wins (another PC of the shop)');
  delete process.env.SFK_OLLAMA_URL;
  let bad = null; try { localai.resolveUrl('ftp://x'); } catch (e) { bad = e; }
  ok(bad && bad.code === 'bad_url', 'a wrong address is said plainly');

  section('Το μοντέλο: υπάρχει πραγματικά;');
  const ms = localai.modelsOf({ models: [{ name: 'qwen2.5:7b', details: { families: ['qwen2'] } }, { name: 'nomic-embed-text:latest', details: { families: ['nomic-bert'] } }, { name: 'llama3.1:latest' }] });
  ok(ms.find((m) => m.name.startsWith('nomic')).embedding && !ms.find((m) => m.name === 'qwen2.5:7b').embedding, 'an embedding model is recognised (it cannot write text)');
  ok(localai.pickModel(ms, 'qwen2.5:7b').how === 'chosen', 'the chosen model, installed → used');
  ok(localai.pickModel(ms, 'qwen2.5').model === 'qwen2.5:7b' && localai.pickModel(ms, 'llama3.1').model === 'llama3.1:latest', '«qwen2.5» finds qwen2.5:7b, «llama3.1» finds llama3.1:latest');
  const miss = localai.pickModel(ms, 'mistral:7b');
  ok(miss.error && miss.error.code === 'model_missing' && /qwen2\.5:7b/.test(miss.error.message) && /ollama pull mistral:7b/.test(miss.error.message), 'a chosen model that is not installed: said, with the installed ones and the command (never swapped silently)', miss.error && miss.error.message);
  ok(localai.pickModel([ms[1], ms[0]], '').model === 'qwen2.5:7b', 'nothing chosen → a model that writes, never the embedding one first in the list');
  ok(localai.pickModel([ms[1]], '').error.code === 'no_model', 'only an embedding model → «no model that writes text»');

  section('Δοκιμή: σύνδεση, μοντέλα, πραγματική απάντηση');
  settings.save({ localAI: { enabled: true, url: ol.url, model: 'qwen2.5:7b' } });
  let t = await localai.test();
  ok(t.ok && t.steps.map((s) => s.id).join(',') === 'reach,models,model,generate,greek', 'every step passes, in order', JSON.stringify(t.steps));
  ok(state.calls.length === 1 && state.calls[0].model === 'qwen2.5:7b' && t.answer === 'Μπλε.', 'the test really asked the model and shows its answer', JSON.stringify(state.calls[0]));
  settings.save({ localAI: { enabled: true, url: ol.url, model: 'llama3:8b' } });
  t = await localai.test();
  ok(!t.ok && t.steps.find((s) => s.id === 'model' && !s.ok) && !t.steps.some((s) => s.id === 'generate'), 'chosen model missing → the test stops at «model», with the reason');
  settings.save({ localAI: { enabled: true, url: 'http://127.0.0.1:1', model: '' } });
  t = await localai.test();
  ok(!t.ok && t.steps[0].id === 'reach' && /Δεν απαντά το Ollama/.test(t.steps[0].text), 'Ollama closed → «does not answer at …», nothing else', JSON.stringify(t.steps));
  settings.save({ localAI: { enabled: true, url: ol.url, model: '' } });
  state.memory = true;
  t = await localai.test();
  ok(!t.ok && /μνήμη/.test((t.steps.find((s) => s.id === 'generate') || {}).text || ''), 'not enough memory for the model → said in plain words', JSON.stringify(t.steps));
  state.memory = false;
  settings.save({ localAI: { enabled: false, url: ol.url, model: '' } });
  t = await localai.test();
  ok(!t.ok && t.steps.some((s) => s.id === 'enabled' && !s.ok) && t.steps.some((s) => s.id === 'generate' && s.ok), 'switched off: the test still checks everything and says «tick Ενεργό»');
  let off = null; try { await localai.generate('x'); } catch (e) { off = e; }
  ok(off && off.code === 'disabled', 'switched off: no question is sent by the program');

  section('Περιγραφή μόνο από τα πραγματικά στοιχεία');
  settings.save({ localAI: { enabled: true, url: ol.url, model: 'qwen2.5' } });
  state.calls.length = 0;
  state.answer = 'Σακίδιο 20 λίτρων από Cordura, για καθημερινή χρήση. Έχει βάρος 950 γραμμάρια και αντέχει 30 κιλά.\n\n- Χωρητικότητα: 20 λίτρα\n- Ύφασμα Cordura 500D\n- Εγγύηση 5 ετών';
  const draft = { displayTitle: 'ΣΑΚΙΔΙΟ HELIKON-TEX RACCOON MK2 20L', fields: { brand: 'HELIKON-TEX', model: 'RACCOON MK2' }, specs: [{ k: 'Χωρητικότητα', v: '20 L' }, { k: 'Υλικό', v: 'Cordura 500D' }], features: ['Θήκη για laptop'], variations: [], descOfficial: '' };
  const d = await localai.describeFull(draft);
  const call = state.calls[0];
  ok(call.model === 'qwen2.5:7b' && call.options.num_ctx >= 8192 && call.stream === false, 'the model of the settings, with room for the facts (num_ctx 8192, not the default 2048 that cut long texts)', JSON.stringify(call.options));
  ok(/Cordura 500D/.test(call.prompt) && /RACCOON MK2/.test(call.prompt) && /ΜΟΝΟ τα στοιχεία/.test(call.prompt), 'the prompt carries the real specs and the rule «only these facts»');
  ok(/20 λίτρων/.test(d.html) && /500D/.test(d.html) && !/950/.test(d.html) && !/30 κιλά/.test(d.html) && !/5 ετών/.test(d.html), 'numbers the model invented (950 g, 30 kg, 5 years) are taken out; the real ones (20 L, 500D) stay', d.html);
  ok(d.removed.length === 2 && d.notes.some((n) => /επινόησε/.test(n)), 'what was taken out is said (note for the person)', JSON.stringify(d.removed));
  let few = null; try { await localai.describeFull({ displayTitle: 'ΚΑΤΙ', fields: {}, specs: [], features: [] }); } catch (e) { few = e; }
  ok(few && few.code === 'few_facts', 'too few facts → no description (the AI writes nothing it was not given)');
  state.answer = '<think>Ο χρήστης θέλει…</think>\nΜαύρο σακίδιο.';
  ok(localai.cleanAnswer('<think>abc</think>\nΚείμενο') === 'Κείμενο', 'the reasoning of «thinking» models (<think>) never reaches the description');

  section('Μετάφραση σε κομμάτια (δεν κόβεται)');
  state.calls.length = 0;
  state.answer = (j) => j.prompt.split('\n\n').pop().split('\n').map((l) => l.startsWith('- ') ? '- ΕΛ ' + l.slice(2) : 'ΕΛ ' + l).join('\n');
  const long = '<p>' + Array.from({ length: 40 }, (_, i) => `Line ${i + 1} of the maker's text about the 1000D fabric and the YKK zips.`).join('</p><p>') + '</p><ul><li>Weight 1.2 kg</li></ul>';
  const tr = await localai.translateFull(long);
  ok(state.calls.length >= 2 && /ΕΛ Line 40/.test(tr.html) && /<li>ΕΛ Weight 1\.2 kg<\/li>/.test(tr.html), 'a long text goes in pieces and comes back whole (lists kept)', state.calls.length + ' κομμάτια');

  section('Η ερώτηση πάει στον υπολογιστή που έχει το μοντέλο');
  const coord = require(APP + '/lib/coord');
  coord.use(require(APP + '/lib/coord-store').fileBackend());
  require(APP + '/lib/jobtypes').register();
  const pa = await coord.newPairing('t'), pb = await coord.newPairing('t');
  const wa = await coord.pair(pa.code, 'PC-A', { cpus: 8, ramMB: 16000, types: ['market.shop', 'ai.call'], ollama: ['llama3.1:8b'], slots: 2 });
  const wb = await coord.pair(pb.code, 'PC-B', { cpus: 8, ramMB: 32000, types: ['market.shop', 'ai.call'], ollama: ['qwen2.5:7b'], slots: 2 });
  await coord.enqueue('ai.call', { path: '/api/generate', body: { model: 'qwen2.5:7b', prompt: 'x' }, model: 'qwen2.5:7b' }, { priority: 50 });
  ok((await coord.claim(wa.id, 1, ['ai.call'])).length === 0, 'the computer WITHOUT the model does not take the question');
  const got = await coord.claim(wb.id, 1, ['ai.call']);
  ok(got.length === 1 && got[0].payload.model === 'qwen2.5:7b', 'the computer with the model takes it');
  // the worker's side: the same address its check uses, a real answer, the reasons kept
  process.env.SFK_WORKER_OLLAMA_URL = ol.url;
  state.answer = 'Εντάξει.';
  const h = coord.handler('ai.call');
  const ctl = new AbortController();
  const api = { signal: ctl.signal, progress() {}, cancelled: () => false };
  const res = await h.run({ path: '/api/generate', body: { model: 'qwen2.5:7b', prompt: 'Γεια', options: { num_ctx: 8192 } } }, api);
  ok(res.response === 'Εντάξει.' && res.model === 'qwen2.5:7b' && res.eval_count === 42, 'on the computer: a real generate through the same address it checks', JSON.stringify(res));
  let me = null; try { await h.run({ path: '/api/generate', body: { model: 'nope:1b', prompt: 'x' } }, api); } catch (e) { me = e; }
  ok(me && /δεν είναι εγκατεστημένο/.test(me.message) && me.fatal, 'a missing model on the computer: the reason travels back (not «error 404»), no second try', me && me.message);
  state.delay = 3000;
  const c2 = new AbortController();
  const t0 = Date.now();
  setTimeout(() => c2.abort(), 200);
  let ce = null; try { await h.run({ path: '/api/generate', body: { model: 'qwen2.5:7b', prompt: 'x' } }, { signal: c2.signal, progress() {}, cancelled: () => true }); } catch (e) { ce = e; }
  ok(ce && Date.now() - t0 < 2000, 'a stopped question stops at once on the computer (the request to Ollama is cut)', ce && ce.message);
  state.delay = 0;
  const tags = await h.run({ path: '/api/tags' }, api);
  const applied = await h.apply({}, tags);
  ok(applied.models.length === 2 && applied.models[1].details.families[0] === 'nomic-bert', 'the list of models reaches the cloud with what tells an embedding model apart');
  let bp = null; try { await h.run({ path: '/api/delete' }, api); } catch (e) { bp = e; }
  ok(!!bp, 'only the two questions of the AI are allowed (no other path of Ollama)');

  section('Στο cloud: ο υπολογιστής που βοηθά (χωρίς δίκτυο προς το cloud)');
  // the cloud's side without a worker: a plain reason
  localai.setRemote({ call: async () => { throw new Error('never'); }, models: async () => [], why: async () => ({ ok: false, text: 'Κανένας υπολογιστής δεν είναι ανοιχτός τώρα (PC-B).' }) });
  t = await localai.test();
  ok(!t.ok && t.where === 'computer' && t.steps[0].id === 'computer' && /PC-B/.test(t.steps[0].text), 'all computers off → the test says which, nothing is queued');
  localai.setRemote({ call: async (p, b) => (p === '/api/tags' ? { models: [{ name: 'qwen2.5:7b' }] } : { response: 'Μπλε', model: b.model, eval_count: 3 }), models: async () => [{ id: 'w', name: 'PC-B', models: ['qwen2.5:7b'] }], why: async () => ({ ok: true, text: 'PC-B' }) });
  settings.save({ localAI: { enabled: true, url: '', model: 'qwen2.5' } });
  t = await localai.test();
  ok(t.ok && t.model === 'qwen2.5:7b' && t.answer === 'Μπλε', 'through a computer: models, the chosen one and a real answer', JSON.stringify(t.steps));
  const gen = await localai.ask('x');
  ok(gen.model === 'qwen2.5:7b', 'the model is chosen from the computers\' own lists (no extra round trip)');

  ol.srv.close();
  console.log(`\n${passes} ok, ${fails} failed`);
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) { /* ignore */ }
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
