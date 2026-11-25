/* Ακρίβεια & εκμάθηση — how right the program's matches are (measured from the owner's checks), a random sample to
   check, every match of one product with its reasons, and how the matching works. */
'use strict';
(function () {
  const { h, clear, btn, fmt, GET, POST, toast, fail, pageHead, siteName, debounce, watchJob } = App;
  const FIELD = { name: 'Τίτλος', sku: 'Κωδικός (SKU)', varsku: 'Κωδικοί παραλλαγών', gtin: 'EAN', images: 'Φωτογραφίες', brand: 'Μάρκα', cats: 'Κατηγορία', desc: 'Περιγραφή', short: 'Σύντομη περιγραφή', price: 'Τιμή' };
  const MATCH = { exact: ['Ίδιο προϊόν', 'ok'], confirmed: ['Το επιβεβαίωσες', 'ok'], similar: ['Παρόμοιο: θέλει έλεγχο', 'warn'], family: ['Άλλη παραλλαγή', ''], none: ['Άλλο', ''] };
  const HOW = { ean: 'ίδιο EAN (γραμμωτός κώδικας)', sku: 'ίδιος κωδικός', code: 'ίδιος κωδικός μοντέλου', words: 'ίδια μάρκα, μοντέλο, χρώμα, ποσότητα', confirmed: 'το επιβεβαίωσες εσύ', internet: 'βρέθηκε στο internet', 'άλλο': 'άλλο' };
  const ORIGIN = { rules: 'Κανόνες', site: 'Δεδομένα του site', sources: 'Αντιπρόσωποι & άλλα sites', infer: 'Συμπέρασμα', mine: 'Δικές σου' };
  const pct = (t) => (t && t.p != null ? `${fmt.num(t.p)}%` : '—');
  const range = (t) => (t && t.n ? `περιθώριο ${fmt.num(t.low)}–${fmt.num(t.high)}% · ${fmt.num(t.n)} έλεγχοι` : 'κανένας έλεγχος ακόμα');
  const link = (url, text) => h('a', { href: url, target: '_blank', rel: 'noopener noreferrer' }, text);
  const VERDICT = (c) => (c.verdict === 'yes' ? 'Ίδιο' : c.verdict === 'no' ? (c.reason === 'variant' ? 'Άλλο χρώμα / μέγεθος (ένδειξη)' : c.reason === 'other' ? 'Άλλο προϊόν' : 'Όχι ίδιο') : 'Δεν ξέρω');
  // take an answer back: it no longer counts, and the match is as the program had it (neither «Ίδιο» nor «Όχι ίδιο»)
  const undo = (k, url) => POST('/api/learn/undo', { k, url }).then((x) => { toast('Αναιρέθηκε' + (x.was ? ` («${x.was === 'yes' ? 'Ίδιο' : x.was === 'no' ? 'Όχι' : 'Δεν ξέρω'}»)` : '') + ': δεν μετράει πια.'); return x; }).catch((e) => { fail(e); throw e; });

  App.views.learn = {
    async render(main, p) {
      main.appendChild(pageHead('Ακρίβεια & εκμάθηση', 'Πόσο σωστά βρίσκει το πρόγραμμα «το ίδιο προϊόν» σε άλλα καταστήματα — μετρημένο από τους δικούς σου ελέγχους — και τι μαθαίνει από σένα. Τίποτα εδώ δεν αλλάζει τα sites.'));
      let tab = p.tab || 'score';
      const body = h('div', { class: 'stack' });
      const tabs = h('div', { class: 'tabs' });
      const TABS = [['score', 'Μέτρηση'], ['sample', 'Έλεγχος δείγματος'], ['photos', 'Φωτογραφίες'], ['history', 'Ιστορικό'], ['product', 'Ένα προϊόν'], ['how', 'Πώς δουλεύει']];
      const drawTabs = () => { clear(tabs); for (const [id, label] of TABS) tabs.appendChild(h('button', { 'aria-selected': String(tab === id), onclick: () => { tab = id; App.keep({ tab }); drawTabs(); show(); } }, label)); };
      main.appendChild(tabs); main.appendChild(body);
      const show = () => { clear(body); (tab === 'sample' ? sample : tab === 'photos' ? photos : tab === 'history' ? history : tab === 'product' ? product : tab === 'how' ? how : score)(body, p); };
      drawTabs(); show();
    },
  };

  // ---------- the numbers ----------
  async function score(box) {
    box.appendChild(h('span', { class: 'muted' }, 'Μέτρηση…'));
    let s;
    try { s = await GET('/api/learn'); } catch (e) { clear(box).appendChild(h('div', { class: 'note crit' }, e.message)); return; }
    clear(box);
    const sm = s.sample;
    const enough = sm.n >= 30;
    // first: what to do now (the most useful for the least of your time), then every domain apart
    if (s.actions && s.actions.length) box.appendChild(actionsPanel(s.actions));
    if (s.domains) box.appendChild(domainsPanel(s.domains, s.enough));
    // the answer to «how many of 100 are right»
    box.appendChild(h('div', { class: 'panel lr-answer' },
      h('h2', null, 'Από 100 αντιστοιχίες που κάνει μόνο του, πόσες είναι σωστές;'),
      sm.n ? h('div', { class: 'lr-big' + (enough ? '' : ' few') }, h('b', null, pct(sm)), h('span', null, enough ? range(sm) : `${range(sm)} — λίγοι ακόμα για σίγουρο αριθμό`)) : null,
      h('p', null, enough ? 'Ο αριθμός βγαίνει από τυχαίο δείγμα: ισχύει για όλες τις αντιστοιχίες που μετράνε χωρίς να τις έχεις δει.'
        : `Για έναν αριθμό που να στέκει χρειάζονται τουλάχιστον 30 έλεγχοι τυχαίου δείγματος (έχεις ${fmt.num(sm.n)}). Πήγαινε στο «Έλεγχος δείγματος»: 10 τη φορά, ~2 λεπτά.`),
      h('p', { class: 'faint' }, `Σε δοκιμαστικό κόσμο με γνωστές απαντήσεις (μέτρηση ${fmt.date ? fmt.date(s.bench.at) : s.bench.at}): ${fmt.num(s.bench.precision)} στα 100 σωστά· βρίσκει ~${Math.round(s.bench.recall / 10)} στα 10 καταστήματα που έχουν πραγματικά το προϊόν (η ελαφριά έρευνα του cloud ~${Math.round(s.bench.lightRecall / 10)}). Αυτό δεν είναι το ζωντανό internet: γι' αυτό μετράμε και με τους δικούς σου ελέγχους.`),
      h('div', { class: 'row tight', style: { marginTop: '8px' } }, btn('Έλεγχος δείγματος (10)', { cls: 'primary', icon: 'check' }, () => App.go('learn', { tab: 'sample' })),
        h('span', { class: 'faint' }, `${fmt.num(s.waiting)} αντιστοιχίες μετράνε χωρίς να τις έχεις δει.`))));
    // every answer of a person: matches, the «similar» ones, the proposals of Διορθώσεις
    const kpi = (label, t, extra) => h('div', { class: 'lr-kpi' }, h('span', null, label), h('b', null, pct(t)), h('small', null, extra || range(t)));
    box.appendChild(h('div', { class: 'panel' }, h('h2', null, 'Όλες οι απαντήσεις σου'),
      h('div', { class: 'lr-kpis' },
        kpi('Αντιστοιχίες που έκανε μόνο του: σωστές', s.matches),
        kpi('«Παρόμοια» που ήταν τελικά ίδια', s.confirmations),
        kpi('Προτάσεις «σίγουρες» (≥90%): εγκρίθηκαν', s.proposals.high, `${range(s.proposals.high)}${s.proposals.high.edited ? ` · ${fmt.num(s.proposals.high.edited)} με αλλαγή σου` : ''}`),
        kpi('Προτάσεις «μέτριες»: εγκρίθηκαν', s.proposals.medium, `${range(s.proposals.medium)}${s.proposals.medium.edited ? ` · ${fmt.num(s.proposals.medium.edited)} με αλλαγή σου` : ''}`)),
      h('p', { class: 'faint' }, 'Οι «σίγουρες» προτάσεις πρέπει να εγκρίνονται σχεδόν πάντα· αν όχι, το πρόγραμμα είναι πιο σίγουρο απ\' όσο πρέπει και το βλέπεις εδώ.')));
    // the AI's second opinion: a bigger sample, believed as far as it agrees with you
    const ag = s.ai.agreement;
    box.appendChild(h('div', { class: 'panel' }, h('h2', null, 'Δεύτερη γνώμη: το AI'),
      s.ai.n ? h('div', { class: 'lr-kpis' },
        kpi('Σωστές κατά το AI', s.ai, `${range(s.ai)}${s.ai.last ? ' · τελευταίος έλεγχος ' + fmt.ago(s.ai.last) : ''}`),
        kpi('Το AI συμφωνεί μαζί σου', ag, ag.n ? `${fmt.num(ag.same)} από ${fmt.num(ag.n)} κοινές απαντήσεις${ag.proven ? ' · αξιόπιστο: μετράει στην εκμάθηση' : ' · δεν μετράει ακόμα (θέλει ≥20 και ≥90%)'}` : 'καμία κοινή απάντηση ακόμα')) : null,
      h('p', { class: ag.proven ? 'faint' : 'faint' }, s.ai.n ? 'Το AI του υπολογιστή ελέγχει σιωπηλά, κάθε 3 ώρες, 15 τυχαίες αντιστοιχίες. Ο αριθμός του μετράει μόνο όσο συμφωνεί μαζί σου· τις αποφάσεις τις παίρνεις εσύ.'
        : 'Το AI του υπολογιστή (δωρεάν, Ollama) θα ελέγχει σιωπηλά τυχαίες αντιστοιχίες κάθε 3 ώρες, όταν είναι ενεργό (Ρυθμίσεις → AI) και ο υπολογιστής ανοιχτός.'),
      h('div', { class: 'row tight', style: { flexWrap: 'wrap' } },
        btn('Έλεγχος με AI τώρα (15)', { cls: 'sm', icon: 'bolt' }, () => POST('/api/learn/ai').then((job) => watchJob(job, { done: () => App.route() })).catch(fail)),
        s.ai.doubts ? btn(`Το AI διαφωνεί σε ${fmt.num(s.ai.doubts)}: δες τα`, { cls: 'sm primary' }, () => App.go('learn', { tab: 'sample', ai: '1' })) : null)));
    // every kind of proposal: the certainty it was given against how often it was really approved
    if (s.calibration.length) {
      const cell = (g) => (g ? h('span', null, h('b', null, pct(g)), h('span', { class: 'faint' }, ` (λέγαμε ${fmt.num(g.claimed)}% · ${fmt.num(g.n)})`)) : '—');
      box.appendChild(h('div', { class: 'panel' }, h('h2', null, 'Κάθε είδος πρότασης: λέγαμε → εγκρίθηκε'),
        h('table', { class: 'tbl lr-tbl' }, h('thead', null, h('tr', null, h('th', null, 'Πρόταση'), h('th', null, 'Σίγουρες'), h('th', null, 'Μέτριες'))),
          h('tbody', null, s.calibration.map((x) => h('tr', null, h('td', null, FIELD[x.field] || x.field), h('td', null, cell(x.high)), h('td', null, cell(x.medium)))))),
        h('p', { class: 'faint' }, `Αυτόματη διόρθωση: όταν ένα είδος πρότασης εγκρίνεται λιγότερο από όσο λέμε (από ${s.calMin} απαντήσεις και πάνω), η «Σιγουριά %» γίνεται η μετρημένη, και κάτω από 90% δεν είναι πια «σίγουρη» (δεν μπαίνει στο «Έγκριση όλων των σίγουρων»). Ξαναγίνεται σίγουρη μόνη της όταν οι εγκρίσεις ανέβουν.`)));
    }
    if (s.byHow.length || s.proposals.byOrigin.length) {
      box.appendChild(h('div', { class: 'panel' }, h('h2', null, 'Ανά απόδειξη και ανά προέλευση'),
        s.byHow.length ? h('table', { class: 'tbl lr-tbl' }, h('thead', null, h('tr', null, h('th', null, 'Το «ίδιο» βγήκε από'), h('th', { class: 'num' }, 'Σωστές'), h('th', { class: 'num' }, 'Έλεγχοι'))),
          h('tbody', null, s.byHow.map((x) => h('tr', null, h('td', null, HOW[x.how] || x.how), h('td', { class: 'num' }, pct(x)), h('td', { class: 'num' }, fmt.num(x.n)))))) : null,
        s.proposals.byOrigin.length ? h('table', { class: 'tbl lr-tbl' }, h('thead', null, h('tr', null, h('th', null, 'Προτάσεις Διορθώσεων από'), h('th', { class: 'num' }, 'Εγκρίθηκαν'), h('th', { class: 'num' }, 'Απαντήσεις'))),
          h('tbody', null, s.proposals.byOrigin.map((x) => h('tr', null, h('td', null, ORIGIN[x.origin] || x.origin), h('td', { class: 'num' }, pct(x)), h('td', { class: 'num' }, fmt.num(x.n)))))) : null));
    }
    // what it learned from the owner
    box.appendChild(h('div', { class: 'panel' }, h('h2', null, 'Τι έμαθε από σένα'),
      h('ul', { class: 'todo-list' },
        s.wrongKinds && s.wrongKinds.all ? h('li', null, h('b', null, 'Τα λάθη του: '), `${fmt.num(s.wrongKinds.variant)} από ${fmt.num(s.wrongKinds.all)} ήταν το ίδιο μοντέλο σε άλλο χρώμα / μέγεθος (τα υπόλοιπα άλλο προϊόν).`) : null,
        h('li', null, h('b', null, 'Καταστήματα: '), s.doubtShops.length ? `σε ${fmt.num(s.doubtShops.length)} βρήκες λάθη συχνά (τουλάχιστον 1 στα 3): οι αντιστοιχίες τους δεν μετράνε πια μόνες τους, θέλουν το «ναι» σου — ${s.doubtShops.join(', ')}.` : 'κανένα κατάστημα με συχνά λάθη (χρειάζονται 3 έλεγχοι ενός καταστήματος και 1 στα 3 λάθος).'),
        h('li', null, h('b', null, 'Κάθε σελίδα που απάντησες: '), '«Όχι ίδιο» = η τιμή της δεν μετράει και δεν παίρνεται από αυτήν κωδικός, EAN ή φωτογραφία· «Ίδιο» = μετράει πάντα, ακόμα κι αν αλλάξει ο τίτλος της.'),
        h('li', null, h('b', null, 'Τίτλοι: '), `${fmt.num(s.naming.examples)} εγκεκριμένοι τίτλοι (παραδείγματα για το AI) · ${fmt.num(s.naming.rejections)} λέξεις είδους που απέρριψες (δεν ξαναπροτείνονται). `, h('a', { href: '#/settings?tab=words' }, 'Ρυθμίσεις → Λέξεις'))),
      s.shops.length ? h('details', null, h('summary', null, `Ανά κατάστημα (${s.shops.length})`), h('table', { class: 'tbl lr-tbl' }, h('thead', null, h('tr', null, h('th', null, 'Κατάστημα'), h('th', { class: 'num' }, 'Σωστές'), h('th', { class: 'num' }, 'Έλεγχοι'))),
        h('tbody', null, s.shops.map((x) => h('tr', null, h('td', null, x.host, x.doubt ? h('span', { class: 'pill warn', style: { marginLeft: '6px' } }, 'θέλει «ναι»') : null), h('td', { class: 'num' }, pct(x)), h('td', { class: 'num' }, fmt.num(x.n))))))) : null));
  }

  // ---------- what to do now ----------
  function actionsPanel(list) {
    const GO = { sample: ['Έλεγχος δείγματος', { tab: 'sample' }], photos: ['Έλεγχος φωτογραφιών', { tab: 'photos' }], aidoubts: ['Το AI διαφωνεί', { tab: 'sample', ai: '1' }], product: ['Ένα προϊόν', { tab: 'product' }] };
    return h('div', { class: 'panel lr-actions' }, h('h2', null, 'Τι να κάνεις τώρα'),
      h('ol', { class: 'lr-act' }, list.map((a) => h('li', null, h('b', null, a.text), h('div', { class: 'faint' }, 'Γιατί: ' + a.why),
        a.go === 'fixes' ? h('a', { href: '#/fixes' }, 'Διορθώσεις →') : GO[a.go] ? h('button', { type: 'button', class: 'linkish', onclick: () => App.go('learn', GO[a.go][1]) }, GO[a.go][0] + ' →') : null))));
  }
  // ---------- every domain apart (never one number for everything) ----------
  const TYPE = { sample: 'Τυχαίο δείγμα', human: 'Δικοί σου έλεγχοι', decisions: 'Αποφάσεις σου', ai: 'AI', bench: 'Συνθετικό benchmark', tests: 'Tests', production: 'Παραγωγή' };
  function domainsPanel(ds, enough) {
    const card = (d) => {
      const m = d.main;
      const cls = !m ? '' : !d.enough ? 'few' : m.low >= 95 ? 'good' : m.low >= 85 ? 'ok' : 'bad';
      return h('details', { class: 'lr-dom ' + cls },
        h('summary', null,
          h('span', { class: 'lr-dom-name' }, d.label),
          h('span', { class: 'lr-dom-p' }, m && m.p != null ? fmt.num(m.p) + '%' : '—'),
          h('span', { class: 'lr-dom-sub faint' }, m ? `${m.n} ${m.basis === 'decisions' ? 'αποφάσεις' : 'έλεγχοι'} · ${fmt.num(m.low)}–${fmt.num(m.high)}%${d.enough ? '' : ' · λίγα'}${d.delta != null ? ` · ${d.delta > 0 ? '▲' : '▼'}${Math.abs(d.delta)}` : ''}` : d.id === 'specs' ? 'δεν μετριέται' : 'χωρίς μέτρηση')),
        m ? h('p', { class: 'faint' }, `Βάση του αριθμού: ${m.basisLabel}. Σωστά ${m.yes}${m.partial ? ` · με αλλαγή σου ${m.partial}` : ''} · λάθος ${m.no}${m.unsure ? ` · αβέβαια ${m.unsure}` : ''} · τελευταία μέτρηση ${d.last ? fmt.ago(d.last) : '—'}${d.prev ? ` · πριν (${d.prev.day}): ${fmt.num(d.prev.p)}% σε ${d.prev.n}` : ''}.`) : null,
        h('h4', { class: 'needs-h' }, 'Από πού (κάθε είδος απόδειξης χωριστά)'),
        h('ul', { class: 'todo-list' }, d.evidence.map((e) => h('li', null, h('span', { class: 'pill' }, TYPE[e.type] || e.type), ' ', e.label, ': ',
          e.t ? h('b', null, e.t.p != null ? fmt.num(e.t.p) + '%' : '—') : null, e.t && e.t.n ? ` (${e.t.n}, ${fmt.num(e.t.low)}–${fmt.num(e.t.high)}%)` : '', e.text || '', e.note ? ' · ' + e.note : '',
          e.agreement && e.agreement.n ? ` · συμφωνεί μαζί σου ${fmt.num(e.agreement.p)}% (${e.agreement.n})` : '', e.at ? h('span', { class: 'faint' }, ' · ' + (String(e.at).length <= 10 ? e.at : fmt.ago(e.at))) : null))),
        d.versions && d.versions.length > 1 ? h('div', null, h('h4', { class: 'needs-h' }, 'Βοήθησαν οι αλλαγές; (ανά έκδοση κανόνων)'), h('ul', { class: 'todo-list' }, d.versions.map((v) => h('li', null, h('b', null, v.ver + ': '), `${fmt.num(v.p)}% σε ${v.n} (${fmt.num(v.low)}–${fmt.num(v.high)}%)`)))) : null,
        h('h4', { class: 'needs-h' }, 'Τι χρειάζεται για να αυξηθεί η ακρίβεια'),
        h('ul', { class: 'todo-list' },
          d.problems.length ? h('li', null, h('b', null, 'Συχνότερα λάθη: '), d.problems.map((p) => `${p.what} (${p.n}, ${p.kind})`).join(' · ')) : h('li', null, h('b', null, 'Συχνότερα λάθη: '), 'κανένα γνωστό ακόμα'),
          d.auto.length ? h('li', null, h('b', null, 'Ήδη σε ισχύ (αυτόματα, μόνο προς το πιο προσεκτικό): '), d.auto.join(' · ')) : null,
          h('li', { class: d.next.who === 'human' ? 'warn' : '' }, h('b', null, 'Επόμενο βήμα: '), d.next.text, h('div', { class: 'faint' }, d.next.who === 'human' ? 'Χρειάζεται δική σου κρίση.' : d.next.who === 'system' ? 'Το κάνει το σύστημα με ασφάλεια.' : ''))));
    };
    return h('div', { class: 'panel' }, h('h2', null, 'Ακρίβεια ανά τομέα'),
      h('p', { class: 'faint' }, `Κάθε τομέας με τον δικό του αριθμό, από τη δική του απόδειξη· ο ένας δεν αποδεικνύει τον άλλο. 100% φαίνεται μόνο για όσα ελέγχθηκαν, πάντα με το περιθώριό του· «επαρκές» από ${enough} ελέγχους. Πάτα έναν τομέα για λεπτομέρειες.`),
      h('div', { class: 'lr-doms' }, ds.map(card)));
  }

  // ---------- one match, ours next to theirs ----------
  function matchCard(r, opts) {
    const o = opts || {};
    const m = MATCH[r.prog.confirmed ? 'confirmed' : r.prog.match] || MATCH.none;
    const result = h('div', { class: 'lr-result' });
    const answer = (verdict, reason) => POST('/api/learn/check', { k: r.k, url: r.theirs.url, verdict, reason, sample: !!o.sample }).then(() => {
      clear(result).appendChild(h('span', { class: 'pill ' + (verdict === 'yes' ? 'ok' : verdict === 'no' ? 'crit' : '') }, verdict === 'yes' ? '✓ Ίδιο — το θυμάμαι' : reason === 'variant' ? '◐ Άλλο χρώμα / μέγεθος — η τιμή του αξιολογείται ως ένδειξη' : verdict === 'no' ? '✗ Όχι ίδιο — δεν μετράει πια' : 'Δεν ξέρω — δεν μετράει στη μέτρηση'));
      result.appendChild(btn('Αναίρεση', { cls: 'sm ghost' }, () => undo(r.k, r.theirs.url).then(() => { clear(result); card.classList.remove('done'); })));
      card.classList.add('done'); if (o.onAnswer) o.onAnswer(verdict);
    }).catch(fail);
    const side = (title, x, url) => h('div', { class: 'lr-side' }, h('div', { class: 'faint' }, title),
      x.img ? h('img', { src: x.img, alt: '', loading: 'lazy', class: 'lr-img' }) : null,
      h('b', null, url ? link(url, x.name || '—') : x.name || '—'),
      h('div', { class: 'faint' }, [x.sku ? 'Κωδικός ' + x.sku : '', x.ean ? 'EAN ' + x.ean : '', x.variant ? 'Παραλλαγή ' + x.variant : ''].filter(Boolean).join(' · ') || 'χωρίς κωδικό'),
      x.price ? h('div', null, fmt.money(x.price), x.inStock === false ? h('span', { class: 'faint' }, ' · εξαντλημένο') : null) : null);
    const card = h('div', { class: 'panel lr-card' },
      h('div', { class: 'row', style: { justifyContent: 'space-between', flexWrap: 'wrap', gap: '6px' } },
        h('b', null, r.theirs.shop + (r.theirs.web ? ' · internet' : '')),
        h('span', { class: 'pill ' + m[1] }, 'Το πρόγραμμα: ' + m[0])),
      o.noOurs ? h('div', { class: 'lr-pair one' }, side('Δικό τους', r.theirs, r.theirs.url)) : h('div', { class: 'lr-pair' }, side('Δικό μας', r.ours, r.ours.url), side('Δικό τους', r.theirs, r.theirs.url)),
      h('div', { class: 'faint' }, h('b', null, 'Γιατί: '), [...new Set([HOW[r.prog.how] || '', r.prog.why || ''].concat(r.prog.ev || []).filter(Boolean).map((x) => x.replace(/^ίδιο EAN \(γραμμωτός κώδικας\)$/, 'ίδιο EAN')))].filter((x, i, a) => !(x === 'ίδιο EAN' && a.some((y) => y !== x && y.startsWith('ίδιο EAN')))).join(' · ') || '—'),
      r.note ? h('div', { class: 'faint' }, r.note) : null,
      r.check ? h('div', { class: 'row tight', style: { flexWrap: 'wrap' } }, h('span', { class: 'faint' }, `Απάντησες: ${VERDICT(r.check)} · ${fmt.ago(r.check.at)}${r.check.by ? ' · ' + r.check.by : ''}`), btn('Αναίρεση', { cls: 'sm ghost' }, (e) => undo(r.k, r.theirs.url).then(() => { e.target.closest('.row').remove(); }))) : null,
      h('div', { class: 'row tight', style: { flexWrap: 'wrap', marginTop: '6px' } },
        btn('Ίδιο', { cls: 'sm primary', icon: 'check' }, () => answer('yes')),
        btn('Άλλο χρώμα / μέγεθος', { cls: 'sm', title: 'Ίδιο μοντέλο, αλλά άλλο χρώμα, μέγεθος, ποσότητα ή έκδοση: ΔΕΝ είναι ίδιο' }, () => answer('no', 'variant')),
        btn('Άλλο προϊόν', { cls: 'sm' }, () => answer('no', 'other')),
        o.sample ? btn('Δεν ξέρω', { cls: 'sm ghost' }, () => answer('unsure')) : null),
      h('div', { class: 'faint lr-rule' }, '«Ίδιο» = ίδιο μοντέλο ΚΑΙ ίδιο χρώμα, μέγεθος / ποσότητα, έκδοση (αν γράφει «Παραλλαγή: …» με το δικό μας χρώμα: «Ίδιο»). «Άλλο χρώμα / μέγεθος» = ίδιο μοντέλο: η τιμή του δεν πετιέται, αξιολογείται και μετράει ως ένδειξη όταν λείπουν καταστήματα με το δικό μας χρώμα.'),
      result);
    return card;
  }

  // ---------- the random sample ----------
  async function sample(box, p) {
    if (p.ai) return aiDoubts(box);
    let site = p.site || '';
    let done = 0;
    const list = h('div', { class: 'stack' });
    const head = h('div', { class: 'note' }, 'Τυχαίες αντιστοιχίες που το πρόγραμμα μετράει ως «ίδιο προϊόν» χωρίς να τις έχεις δει. Πες αν είναι πράγματι το ίδιο (ίδιο μοντέλο, χρώμα, μέγεθος / ποσότητα). Τυχαίες επίτηδες: έτσι ο αριθμός της «Μέτρησης» ισχύει για όλες.');
    const bar = h('div', { class: 'toolbar' }, App.seg([['', 'Και τα δύο'], ['sf', siteName('sf')], ['st', siteName('st')]], site, (v) => { site = v; load(); }), btn('Άλλες 10', { cls: 'sm', icon: 'sync' }, () => load()));
    box.appendChild(head); box.appendChild(bar); box.appendChild(list);
    const load = async () => {
      clear(list).appendChild(h('span', { class: 'muted' }, 'Επιλογή…'));
      let r;
      try { r = await GET('/api/learn/sample', { n: 10, site }); } catch (e) { clear(list).appendChild(h('div', { class: 'note crit' }, e.message)); return; }
      clear(list);
      if (!r.rows.length) { list.appendChild(h('div', { class: 'panel empty' }, h('h3', null, 'Τίποτα για έλεγχο'), h('p', null, 'Όλες οι αντιστοιχίες που μετράνε έχουν ελεγχθεί, ή δεν έχει γίνει ακόμα έρευνα τιμών.'))); return; }
      list.appendChild(h('p', { class: 'faint' }, `${fmt.num(r.left)} αντιστοιχίες δεν έχουν ελεγχθεί ακόμα.`));
      for (const x of r.rows) list.appendChild(matchCard(x, { sample: true, onAnswer: () => { done++; if (done >= r.rows.length) toast('Τέλος της δεκάδας: η «Μέτρηση» ενημερώθηκε.'); } }));
    };
    load();
  }

  // ---------- the matches the AI said are not the same (your answer here is not part of the random sample) ----------
  async function aiDoubts(box) {
    box.appendChild(h('div', { class: 'note warn' }, 'Αντιστοιχίες που το πρόγραμμα μετράει ως «ίδιο», αλλά το AI λέει «όχι». Δες τις πρώτες: εδώ κρύβονται τα λάθη. (Δεν μπαίνουν στο τυχαίο δείγμα της μέτρησης, για να μείνει αντικειμενική.)'));
    const list = h('div', { class: 'stack' });
    box.appendChild(h('div', { class: 'toolbar' }, btn('Τυχαίο δείγμα', { cls: 'sm ghost' }, () => App.go('learn', { tab: 'sample' })))); box.appendChild(list);
    let r;
    try { r = await GET('/api/learn/ai-doubts', { n: 10 }); } catch (e) { list.appendChild(h('div', { class: 'note crit' }, e.message)); return; }
    if (!r.rows.length) { list.appendChild(h('div', { class: 'panel empty' }, h('h3', null, 'Καμία διαφωνία'), h('p', null, 'Το AI δεν βρήκε αντιστοιχία που να μη μοιάζει σωστή (ή δεν έχει ελέγξει ακόμα).'))); return; }
    for (const x of r.rows) { const c = matchCard(x); c.insertBefore(h('div', { class: 'note warn', style: { margin: '6px 0' } }, h('b', null, 'AI: όχι ίδιο — '), x.ai.why || ''), c.children[1]); list.appendChild(c); }
  }

  // ---------- the photos: each one on its own, with a category (a random sample of what is proposed now) ----------
  const PCAT = [['right', 'Σωστό', 'primary'], ['other_colour', 'Άλλο χρώμα'], ['other_version', 'Άλλη έκδοση'], ['wrong_product', 'Λάθος προϊόν'], ['accessory', 'Αξεσουάρ / εξάρτημα'], ['packaging', 'Συσκευασία'], ['generic', 'Γενική εικόνα'], ['duplicate', 'Διπλή'], ['poor', 'Κακή ποιότητα'], ['uncertain', 'Δεν ξέρω', 'ghost']];
  async function photos(box) {
    box.appendChild(h('div', { class: 'note' }, 'Τυχαίες φωτογραφίες από όσες προτείνει τώρα το πρόγραμμα (Διορθώσεις → Φωτογραφίες), μία-μία. Διάλεξε τι δείχνει: «Σωστό» μόνο αν είναι το ίδιο προϊόν ΚΑΙ το δικό μας χρώμα / έκδοση. Ό,τι πεις μένει: μια φωτογραφία που δεν είναι σωστή δεν ξαναπροτείνεται (με αναίρεση).'));
    const vis = h('p', { class: 'faint' }, 'Έλεγχος αν το AI βλέπει εικόνες…');
    box.appendChild(vis);
    let vision = null;
    GET('/api/learn/vision').then((v) => { vision = v; vis.textContent = 'Το AI στις φωτογραφίες: ' + v.text + (v.ok ? ' · δεύτερη γνώμη ανά φωτογραφία (ποτέ μόνη της απόδειξη, ποτέ έγκριση).' : ' Για να βλέπει: στον υπολογιστή «ollama pull qwen2.5vl:3b» (~3,2 GB μνήμη) — πρώτα μέτρηση στο PC.'); }).catch(() => { vis.textContent = ''; });
    const list = h('div', { class: 'stack' });
    box.appendChild(h('div', { class: 'toolbar' }, btn('Άλλες 10', { cls: 'sm', icon: 'sync' }, () => load())));
    box.appendChild(list);
    const load = async () => {
      clear(list).appendChild(h('span', { class: 'muted' }, 'Επιλογή…'));
      let r;
      try { r = await GET('/api/learn/photos', { n: 10 }); } catch (e) { clear(list).appendChild(h('div', { class: 'note crit' }, e.message)); return; }
      clear(list);
      if (!r.rows.length) { list.appendChild(h('div', { class: 'panel empty' }, h('h3', null, 'Καμία φωτογραφία για έλεγχο'), h('p', null, 'Δεν υπάρχουν προτάσεις φωτογραφιών αυτή τη στιγμή, ή τις έχεις ελέγξει όλες.'))); return; }
      list.appendChild(h('p', { class: 'faint' }, `${fmt.num(r.left)} φωτογραφίες δεν έχουν ελεγχθεί ακόμα.`));
      for (const x of r.rows) {
        const res = h('div', { class: 'lr-result' });
        const ai = h('div', { class: 'faint' });
        const answer = (cat) => POST('/api/learn/photo', { k: x.k, url: x.url, category: cat, sample: true, prog: x.category, src: x.src }).then(() => {
          clear(res).appendChild(h('span', { class: 'pill ' + (cat === 'right' ? 'ok' : cat === 'uncertain' ? '' : 'crit') }, (PCAT.find((y) => y[0] === cat) || [])[1] || cat));
          res.appendChild(btn('Αναίρεση', { cls: 'sm ghost' }, () => POST('/api/learn/photo-undo', { k: x.k, url: x.url }).then(() => { clear(res); card.classList.remove('done'); toast('Αναιρέθηκε.'); }).catch(fail)));
          card.classList.add('done');
        }).catch(fail);
        const card = h('div', { class: 'panel lr-card' },
          h('div', { class: 'row', style: { justifyContent: 'space-between', flexWrap: 'wrap', gap: '6px' } }, h('b', null, x.name), h('span', { class: 'pill ' + (x.category === 'right' ? 'ok' : 'warn') }, 'Το πρόγραμμα: ' + (PCAT.find((y) => y[0] === x.category) || [0, x.category])[1])),
          h('div', { class: 'lr-pair' },
            h('div', { class: 'lr-side' }, h('div', { class: 'faint' }, 'Δική μας'), x.ours ? h('img', { src: x.ours, alt: '', loading: 'lazy', class: 'lr-photo' }) : h('span', { class: 'faint' }, 'χωρίς φωτογραφία')),
            h('div', { class: 'lr-side' }, h('div', { class: 'faint' }, 'Υποψήφια'), h('a', { href: x.url, target: '_blank', rel: 'noopener noreferrer' }, h('img', { src: x.url, alt: '', loading: 'lazy', class: 'lr-photo' })))),
          h('div', { class: 'faint' }, h('b', null, 'Γιατί: '), x.why || '—', x.src ? ' · πηγή: ' + x.src : ''),
          ai,
          h('div', { class: 'row tight', style: { flexWrap: 'wrap', marginTop: '6px' } }, PCAT.map(([id, label, cls]) => btn(label, { cls: 'sm ' + (cls || '') }, () => answer(id))),
            vision && vision.ok && x.ours ? btn('Ρώτα το AI', { cls: 'sm ghost', icon: 'bolt' }, (ev) => { ev.currentTarget.disabled = true; ai.textContent = 'Το AI κοιτάζει…'; POST('/api/learn/photo-ai', { ours: x.ours, url: x.url, name: x.name }).then((v) => { ai.textContent = `AI (${v.model}): μοντέλο ${v.same_model} · χρώμα ${v.same_colour} · σχήμα ${v.same_shape} · ${v.same_product_or_kind} · άλλη έκδοση ${v.other_version} → ${(PCAT.find((y) => y[0] === v.category) || [0, v.category])[1]}. ${v.why || ''} (δεύτερη γνώμη, όχι απόδειξη)`; }).catch((e) => { ai.textContent = 'AI: ' + e.message; }); }) : null),
          res);
        list.appendChild(card);
      }
    };
    load();
  }

  // ---------- everything you answered, newest first: each one can be taken back ----------
  async function history(box) {
    box.appendChild(h('p', { class: 'faint' }, 'Ό,τι πάτησες, με τη σειρά (το πιο πρόσφατο πρώτο). «Αναίρεση» = σαν να μην το πάτησες ποτέ: δεν μετράει στη μέτρηση ούτε στην εκμάθηση, και η αντιστοιχία γυρίζει όπως την είχε το πρόγραμμα.'));
    const list = h('div', { class: 'stack s' });
    box.appendChild(list);
    let r;
    try { r = await GET('/api/learn/recent', { n: 150 }); } catch (e) { list.appendChild(h('div', { class: 'note crit' }, e.message)); return; }
    if (!r.rows.length) { list.appendChild(h('div', { class: 'panel empty' }, h('h3', null, 'Τίποτα ακόμα'), h('p', null, 'Οι απαντήσεις σου («Ίδιο», «Άλλο χρώμα / μέγεθος», «Άλλο προϊόν», «Δεν ξέρω») εμφανίζονται εδώ.'))); return; }
    for (const x of r.rows) {
      const row = h('div', { class: 'panel lr-hist' },
        x.img ? h('img', { src: x.img, alt: '', class: 'lr-thumb' }) : null,
        h('div', { class: 'lr-hist-main' },
          h('div', null, h('b', null, x.product)),
          h('div', { class: 'faint' }, link(x.url, x.host), ` · ${fmt.ago(x.at)}${x.by ? ' · ' + x.by : ''}${x.sample ? ' · τυχαίο δείγμα' : ''}`)),
        h('span', { class: 'pill ' + (x.verdict === 'yes' ? 'ok' : x.verdict === 'no' ? 'crit' : '') }, VERDICT(x)),
        btn('Αναίρεση', { cls: 'sm ghost' }, () => undo(x.k, x.url).then(() => row.remove())));
      list.appendChild(row);
    }
  }

  // ---------- one product: every match with its reasons ----------
  async function product(box, p) {
    let site = p.site === 'st' ? 'st' : 'sf';
    const out = h('div', { class: 'stack' });
    const found = h('div', { class: 'stack s' });
    const search = h('input', { type: 'search', placeholder: 'Αναζήτηση προϊόντος: όνομα ή κωδικός', value: p.q || '', oninput: debounce(() => find(), 300) });
    box.appendChild(h('div', { class: 'toolbar' }, App.seg([['sf', siteName('sf')], ['st', siteName('st')]], site, (v) => { site = v; find(); }), search));
    box.appendChild(found); box.appendChild(out);
    const find = async () => {
      clear(found);
      const q = search.value.trim();
      if (q.length < 2) return;
      const r = await GET('/api/products', { site, search: q, per: 8 }).catch(() => ({ rows: [] }));
      for (const x of r.rows) found.appendChild(h('button', { type: 'button', class: 'lr-pick', onclick: () => { clear(found); open(site, x.id); } }, x.img ? h('img', { src: x.img, alt: '', class: 'lr-thumb' }) : null, h('span', null, x.name, x.sku ? h('span', { class: 'faint' }, ' · ' + x.sku) : null)));
    };
    const open = async (st, id) => {
      App.keep({ tab: 'product', site: st, id });
      clear(out).appendChild(h('span', { class: 'muted' }, 'Φόρτωση…'));
      let d;
      try { d = await GET('/api/learn/product', { site: st, id }); } catch (e) { clear(out).appendChild(h('div', { class: 'note crit' }, e.message)); return; }
      clear(out);
      out.appendChild(h('div', { class: 'panel' }, h('h2', null, d.ours.name), h('p', { class: 'faint' }, [d.ours.sku ? 'Κωδικός ' + d.ours.sku : 'χωρίς κωδικό', d.ours.ean ? 'EAN ' + d.ours.ean : '', d.at ? 'έρευνα τιμών ' + fmt.ago(d.at) : 'καμία έρευνα τιμών ακόμα'].filter(Boolean).join(' · ')),
        h('div', { class: 'row tight' }, btn('Καρτέλα προϊόντος', { cls: 'sm ghost' }, () => App.openProduct(st, id)))));
      const groups = [['exact', 'Ίδιο προϊόν (η τιμή τους μετράει)'], ['similar', 'Παρόμοια: θέλουν το «ναι» σου'], ['family', 'Άλλη παραλλαγή του μοντέλου (δεν μετράει)']];
      if (!d.rows.length) out.appendChild(h('div', { class: 'note' }, 'Δεν βρέθηκε σε κανέναν ανταγωνιστή ακόμα.'));
      for (const [m, title] of groups) {
        const rows = d.rows.filter((r) => (r.prog.match === m) || (m === 'exact' && r.prog.confirmed));
        if (!rows.length) continue;
        out.appendChild(h('h3', { class: 'needs-h' }, `${title} (${rows.length})`));
        for (const r of rows.slice(0, 30)) out.appendChild(matchCard(r, { noOurs: true }));
      }
      if (d.internet) {
        out.appendChild(h('h3', { class: 'needs-h' }, `Internet: ίδιο προϊόν σε ${d.internet.hits.length} σελίδες`));
        out.appendChild(h('div', { class: 'panel' }, d.internet.hits.length ? h('ul', { class: 'todo-list' }, d.internet.hits.map((x) => h('li', null, link(x.url, x.host), ' — ', x.name || '', h('div', { class: 'faint' }, [HOW[x.how === 'code' ? 'sku' : x.how] || x.how, x.code ? 'κωδικός ' + x.code : '', x.ean ? 'EAN ' + x.ean : '', x.price ? fmt.money(x.price) : '', x.check ? (x.check.verdict === 'no' ? '✗ είπες όχι ίδιο' : x.check.verdict === 'yes' ? '✓ είπες ίδιο' : '') : ''].filter(Boolean).join(' · '))))) : h('p', { class: 'faint' }, 'Καμία σελίδα με το ίδιο προϊόν.'),
          d.internet.family.length ? h('p', { class: 'faint' }, `Άλλες παραλλαγές του μοντέλου που βρέθηκαν (δεν χρησιμοποιούνται): ${d.internet.family.map((x) => x.host).join(', ')}`) : null,
          h('p', { class: 'faint' }, 'Οι σελίδες του internet με τιμή φαίνονται και πιο πάνω (με «internet»): εκεί λες «Όχι ίδιο» και δεν παίρνεται τίποτα από αυτές.')));
      }
    };
    if (p.id) open(site, p.id);
  }

  // ---------- how it works ----------
  function how(box) {
    const step = (t, d) => h('li', null, h('b', null, t + ': '), d);
    box.appendChild(h('div', { class: 'panel' }, h('h2', null, 'Πώς αποφασίζει ότι είναι «το ίδιο προϊόν»'),
      h('ol', { class: 'lr-steps' },
        step('1. Υποψήφια', 'για κάθε δικό μας προϊόν ψάχνει στους καταλόγους των ανταγωνιστών (και στο internet) με τον κωδικό, το EAN και τις δύο πιο σπάνιες λέξεις του μοντέλου.'),
        step('2. Απόδειξη', '«ίδιο» μόνο με απόδειξη: ίδιο EAN, ή ίδιος κωδικός, ή μάρκα + μοντέλο + χρώμα + ποσότητα/μέγεθος. Όλα τα άλλα είναι «παρόμοιο» και περιμένουν εσένα.'),
        step('3. Παγίδες', 'άλλο χρώμα ή camo, έκδοση PRO / MK2, σετ των δύο, άλλο μέγεθος: «άλλη παραλλαγή», όχι «ίδιο». Αν το άλλο κατάστημα έχει πολλά χρώματα, παίρνει την τιμή του ΔΙΚΟΥ μας χρώματος.'),
        step('3β. Τιμή άλλου χρώματος', 'δεν πετιέται: αξιολογείται. ★★ = το κατάστημα έχει ίδια τιμή σε όλα τα χρώματα · ★ = εσύ είπες «Άλλο χρώμα / μέγεθος» (ίδιο μοντέλο). Όταν το δικό μας χρώμα βρίσκεται σε λιγότερα από 2 καταστήματα, οι αξιολογημένες τιμές άλλου χρώματος (διαθέσιμες) μετράνε ως ένδειξη, με σήμα «άλλο χρώμα». Άλλο προϊόν / έκδοση PRO / σετ: ποτέ.'),
        step('4. Σίγουρο', 'κωδικός, EAN ή φωτογραφίες προτείνονται ως «σίγουρα» μόνο όταν τα δίνουν 2 ανεξάρτητα καταστήματα (ή ο αντιπρόσωπος). Μία πηγή = «έλεγξέ το».'),
        step('5. Τιμή', 'μετράνε μόνο: ίδιο προϊόν, διαθέσιμο, ελληνικό κατάστημα, πρόσφατη τιμή, όχι ύποπτη (κάτω από το κόστος μας). Για αλλαγή τιμής χρειάζονται τουλάχιστον 2 καταστήματα.'),
        step('6. Εσύ', 'κάθε «Ίδιο» / «Όχι ίδιο» μένει για πάντα για εκείνη τη σελίδα· κατάστημα με συχνά λάθη χάνει την εμπιστοσύνη· εγκρίσεις και απορρίψεις τίτλων γίνονται παραδείγματα και κανόνες.'),
        step('7. Φωτογραφίες', 'πιο αυστηρά από τον κωδικό: μόνο από σελίδα ΕΝΟΣ χρώματος που γράφει το δικό μας χρώμα (ή με τον ίδιο ακριβώς κωδικό / EAN)· ποτέ η κεντρική φωτογραφία προϊόντος σε πολλά χρώματα, ποτέ αρχείο που λέει άλλο χρώμα (…-olive.jpg για μαύρο), ποτέ από είδος του αντιπροσώπου σε άλλο χρώμα.'),
        step('8. Μέτρηση', 'το τυχαίο δείγμα λέει πόσες από τις 100 αντιστοιχίες είναι σωστές· οι απαντήσεις στις προτάσεις λένε αν το «σίγουρο» είναι πράγματι σίγουρο.'),
        step('9. AI', 'δεύτερη γνώμη σε πολλές περισσότερες αντιστοιχίες, σιωπηλά· μετράει όσο συμφωνεί μαζί σου, και βρίσκει τα πιθανά λάθη για να τα δεις πρώτα.'),
        step('10. Αυτόματη διόρθωση', 'χωρίς να ρωτήσει: κατάστημα με συχνά λάθη χάνει την εμπιστοσύνη, «σίγουρες» προτάσεις που δεν εγκρίνεις συχνά γίνονται «μέτριες». Μόνο προς το πιο προσεκτικό· ποτέ αλλαγή στα sites ή έγκριση χωρίς εσένα.'))));
  }
})();
