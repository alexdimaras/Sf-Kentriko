/* Ρυθμίσεις */
'use strict';
(function () {
  const { h, clear, btn, icon, fmt, GET, POST, toast, fail, select, pageHead, siteName, confirmBox } = App;

  App.views.settings = {
    async render(main, p) {
      const tab = p.tab || 'sites';
      const s = await GET('/api/settings');
      main.appendChild(pageHead('Ρυθμίσεις', 'Αλλάζουν μόνο τον τρόπο που δουλεύει το πρόγραμμα. Τίποτα δεν αλλάζει στα sites.'));
      const server = App.MODE === 'server';
      const admin = !server || (App.me && App.me.role === 'admin');
      const tabs = [['sites', 'Sites'], ['prices', 'Τιμές'], ['ads', 'Όπλα και διαφημίσεις'], ['new', 'Νέα προϊόντα'], ['cats', 'Κατηγορίες'], ['ai', 'AI'], ['phone', 'Κινητό'], server ? ['users', 'Χρήστες'] : null, server && admin ? ['workers', 'Σύστημα'] : null, server && admin ? ['audit', 'Ιστορικό ενεργειών'] : null, ['security', 'Ασφάλεια'], ['data', 'Δεδομένα']].filter(Boolean);
      main.appendChild(h('div', { class: 'tabs' }, tabs.map(([k, l]) => h('button', { 'aria-selected': String(k === tab), onclick: () => App.go('settings', { tab: k }) }, l))));
      const box = h('div', { class: 'stack' });
      main.appendChild(box);
      if (!admin && tab !== 'users' && tab !== 'data' && tab !== 'phone') box.appendChild(h('div', { class: 'note' }, 'Τις ρυθμίσεις τις αλλάζει μόνο ο διαχειριστής. Εδώ τις βλέπεις.'));
      const saveBtn = (collect) => h('div', { class: 'row', style: { justifyContent: 'flex-end' } }, btn('Αποθήκευση', { cls: 'primary' }, async () => {
        try { await POST('/api/settings', collect()); await App.refreshState(); toast('Αποθηκεύτηκε.'); } catch (e) { fail(e); }
      }));
      const field = (label, el, hint) => h('label', { class: 'field' }, label, el, hint ? h('small', null, hint) : null);
      const inp = (v, attrs) => h('input', Object.assign({ type: 'text', value: v == null ? '' : String(v) }, attrs || {}));

      if (tab === 'sites') {
        const f = {};
        for (const site of ['sf', 'st']) {
          f[site] = { name: inp(s.sites[site].name), url: inp(s.sites[site].url, { type: 'url' }) };
          const res = h('span', { class: 'hint' });
          box.appendChild(h('div', { class: 'panel' }, h('h2', null, site === 'sf' ? 'Κεντρικό site (όλα τα προϊόντα)' : 'Site διαφημίσεων (χωρίς όπλα)'),
            h('div', { class: 'grid2' }, field('Όνομα', f[site].name), field('Διεύθυνση', f[site].url)),
            h('div', { class: 'row', style: { marginTop: '10px' } }, btn('Δοκιμή σύνδεσης', { cls: 'sm' }, async () => {
              res.textContent = 'Δοκιμή…';
              try { await POST('/api/settings', { sites: { [site]: { name: f[site].name.value, url: f[site].url.value } } }); const r = await POST('/api/probe', { site }); res.textContent = `Εντάξει — ${fmt.num(r.total)} προϊόντα διαθέσιμα για ανάγνωση.`; res.style.color = 'var(--ok)'; } catch (e) { res.textContent = e.message; res.style.color = 'var(--signal)'; }
            }), res)));
        }
        const master = select([['sf', siteName('sf')], ['st', siteName('st')]], s.master, null);
        const auto = inp(s.autoSyncHours, { type: 'number', min: 0, style: { width: '120px' } });
        const vars = h('input', { type: 'checkbox', checked: s.syncVariations });
        box.appendChild(h('div', { class: 'panel' }, h('h2', null, 'Ανάγνωση'),
          h('div', { class: 'grid3' }, field('Σωστή τιμή όταν διαφέρουν', master, 'Το αρχείο διόρθωσης φέρνει το άλλο site σε αυτή την τιμή.'), field('Αυτόματη ανάγνωση στο άνοιγμα, αν πέρασαν ώρες', auto, '0 = ποτέ')),
          h('label', { class: 'check', style: { marginTop: '10px' } }, vars, 'Ανάγνωση και των μεγεθών/χρωμάτων (παραλλαγές) — χρειάζεται για μεταφορά και τιμές ανά μέγεθος')));
        box.appendChild(saveBtn(() => ({ sites: { sf: { name: f.sf.name.value, url: f.sf.url.value }, st: { name: f.st.name.value, url: f.st.url.value } }, master: master.value, autoSyncHours: auto.value, syncVariations: vars.checked })));
      }

      if (tab === 'prices') {
        const strategy = select(Object.entries(App.state.strategies), s.strategy, null);
        const pct = inp(s.percent, { type: 'number', min: 0, step: '0.5' });
        const rounding = select([['90', 'Σε ,90 (π.χ. 24,90)'], ['99', 'Σε ,99'], ['00', 'Σε ακέραιο'], ['none', 'Χωρίς στρογγυλοποίηση']], s.rounding, null);
        const vat = inp(s.vat, { type: 'number', min: 0 });
        const floor = inp(s.floorMargin, { type: 'number', min: 0 });
        const greek = h('input', { type: 'checkbox', checked: s.marketGreekOnly });
        const minShops = select([['1', '1 κατάστημα (όχι συνιστάται)'], ['2', '2 καταστήματα'], ['3', '3 καταστήματα'], ['4', '4 καταστήματα']], String(s.minShops || 2), null);
        const suspect = inp(s.suspectPct, { type: 'number', min: 10, max: 60, step: 5 });
        const gap = inp(s.competitorGap, { type: 'number', min: 200, step: 100 });
        const auto = h('input', { type: 'checkbox', checked: s.marketAuto });
        const hour = select([['0', 'Με το πρώτο άνοιγμα της μέρας']].concat([7, 8, 9, 10, 12, 14, 16, 18, 20, 22].map((x) => [String(x), 'Όχι πριν τις ' + x + ':00'])), String(s.marketHour || 0), null);
        box.appendChild(h('div', { class: 'panel' }, h('h2', null, 'Προτεινόμενη τιμή από την αγορά'),
          h('div', { class: 'grid3' }, field('Στρατηγική', strategy), field('X%', pct), field('Κατάληξη', rounding)),
          h('p', { class: 'hint' }, 'Η κατάληξη μπαίνει μόνο αν δεν περνάει την τιμή αναφοράς· αλλιώς μένει η ακριβής τιμή. Μετράνε μόνο ελληνικά καταστήματα με διαθέσιμο το ίδιο προϊόν.')));
        box.appendChild(h('div', { class: 'panel' }, h('h2', null, 'Πότε αλλάζει η τιμή'),
          h('div', { class: 'grid3' }, field('Αλλαγή τιμής μόνο όταν συμφωνούν', minShops, 'Ένα μόνο φθηνότερο κατάστημα δεν αλλάζει την τιμή: φαίνεται ως «Μόνο ενημέρωση».'),
            field('Ύποπτη τιμή όταν είναι κάτω κατά %', suspect, 'Από τους άλλους ή από τη λιανική του αντιπροσώπου. Και κάτω από το δικό μας κόστος: πάντα ύποπτη.')),
          h('p', { class: 'hint' }, 'Ύποπτες τιμές = μάλλον παλιό απόθεμα που αγόρασαν φθηνότερα, ξεπούλημα ή λάθος. Φαίνονται, αλλά δεν μετράνε στην πρόταση.')));
        box.appendChild(h('div', { class: 'panel' }, h('h2', null, 'Κόστος και ΦΠΑ'),
          h('div', { class: 'grid3' }, field('ΦΠΑ %', vat), field('Ελάχιστο κέρδος πάνω στο κόστος %', floor, 'Η προτεινόμενη τιμή δεν πέφτει ποτέ κάτω από κόστος × (1+%) × ΦΠΑ.'), field('Καθυστέρηση ανά κατάστημα (ms)', gap, 'Για να μη μας μπλοκάρουν. 900 είναι ασφαλές.')),
          h('label', { class: 'check', style: { marginTop: '10px' } }, greek, 'Μόνο ελληνικά καταστήματα στους υπολογισμούς')));
        box.appendChild(h('div', { class: 'panel' }, h('h2', null, 'Ημερήσια ενημέρωση'),
          h('label', { class: 'check' }, auto, 'Κάθε μέρα αυτόματα: τιμοκατάλογοι αντιπροσώπων (feed / κατάλογος / B2B) και τιμές αγοράς για όλα τα προϊόντα'),
          h('div', { class: 'grid3', style: { marginTop: '10px' } }, field('Πότε', hour, 'Τρέχει όσο είναι ανοιχτό το πρόγραμμα, μία φορά τη μέρα.')),
          h('p', { class: 'hint' }, 'Όταν οι τιμές των δύο sites διαφέρουν, σωστή θεωρείται η τιμή του ' + siteName('sf') + '.')));
        box.appendChild(saveBtn(() => ({ strategy: strategy.value, percent: pct.value, rounding: rounding.value, vat: vat.value, floorMargin: floor.value, marketGreekOnly: greek.checked, competitorGap: gap.value, marketAuto: auto.checked, marketHour: hour.value, minShops: minShops.value, suspectPct: suspect.value })));
        // the research on the whole internet: how far it goes, the optional search APIs (keys never come back here)
        const wr = s.webResearch || {};
        const num = (v, min, max) => inp(v, { type: 'number', min, max });
        const mq = num(wr.maxQueries, 2, 30), mp = num(wr.maxPages, 5, 200), ph = num(wr.perHost, 1, 10), ms = num(wr.minShops, 1, 10), fq = num(wr.fullQueries, 2, 40), fp = num(wr.fullPages, 5, 300), mi = num(wr.minImages, 1, 8);
        const appr = h('input', { type: 'checkbox', checked: wr.approveNewShops !== false });
        const apis = wr.apis || {};
        const onX = h('input', { type: 'checkbox', checked: !!apis.searxng }), onB = h('input', { type: 'checkbox', checked: !!apis.brave }), onG = h('input', { type: 'checkbox', checked: !!apis.google });
        const sx = inp('', { placeholder: 'π.χ. http://192.168.1.20:8080' }), bk = inp('', { placeholder: 'κλειδί (δεν εμφανίζεται ξανά)', type: 'password', autocomplete: 'off' }), gk = inp('', { placeholder: 'κλειδί (δεν εμφανίζεται ξανά)', type: 'password', autocomplete: 'off' }), gcx = inp('', { placeholder: 'cx' });
        const keysNote = h('div', { class: 'faint' });
        if (admin) GET('/api/search-keys').then((k) => { sx.value = k.searxng.url || ''; gcx.value = k.google.cx || ''; keysNote.textContent = `Brave: ${k.brave.set ? 'κλειδί αποθηκευμένο' : 'χωρίς κλειδί'} · Google: ${k.google.set ? 'κλειδί αποθηκευμένο' : 'χωρίς κλειδί'}`; }).catch(() => {});
        box.appendChild(h('div', { class: 'panel' }, h('h2', null, 'Έρευνα σε όλο το internet'),
          h('p', { class: 'muted' }, 'Για κάθε προϊόν: πλάνο αναζητήσεων σε όλα τα καταστήματα του internet (όχι μόνο στους ανταγωνιστές). Η αυτόματη σταματά όταν ό,τι λείπει επιβεβαιωθεί από αρκετά καταστήματα· η «Πλήρης έρευνα Internet» τρέχει όλο το πλάνο. Τα όρια προστατεύουν τις μηχανές αναζήτησης και τα καταστήματα.'),
          h('div', { class: 'grid3' }, field('Αναζητήσεις ανά προϊόν', mq), field('Σελίδες ανά προϊόν (σύνολο)', mp), field('Σελίδες ανά site', ph), field('Καταστήματα για «αρκετά»', ms), field('Πλήρης: αναζητήσεις', fq), field('Πλήρης: σελίδες', fp), field('Λιγότερες φωτογραφίες από', mi, 'τότε ψάχνονται κι άλλες')),
          h('label', { class: 'check', style: { marginTop: '10px' } }, appr, 'Τιμή από νέο κατάστημα του internet μετράει μόνο αφού εγκρίνω το κατάστημα'),
          h('h3', { style: { marginTop: '14px' } }, 'Προαιρετικοί πάροχοι αναζήτησης'),
          h('p', { class: 'hint' }, 'Χωρίς αυτούς η έρευνα δουλεύει με DuckDuckGo / Bing / Yahoo. Τα αποτελέσματα της Google δεν διαβάζονται απευθείας (το απαγορεύουν οι όροι της)· για κάθε αναζήτηση υπάρχει σύνδεσμος «Google ↗» για έλεγχο με το μάτι.'),
          h('label', { class: 'check' }, onX, 'SearXNG (δωρεάν, δικός σας διακομιστής — και στο PC)'), field('Διεύθυνση SearXNG', sx),
          h('label', { class: 'check' }, onB, 'Brave Search API (δωρεάν μηνιαίο όριο, θέλει κλειδί)'), field('Κλειδί Brave', bk),
          h('label', { class: 'check' }, onG, 'Google Programmable Search (100/μέρα δωρεάν, κλειδί + cx) — κλειστό για νέους πελάτες, η Google το καταργεί σταδιακά ως 1/1/2027: μόνο αν έχεις ήδη κλειδί, όχι ως βάση'), h('div', { class: 'grid3' }, field('Κλειδί Google', gk), field('cx', gcx)), keysNote));
        box.appendChild(saveBtn(() => {
          if (admin && (sx.value || bk.value || gk.value || gcx.value)) POST('/api/search-keys', { searxng: { url: sx.value }, brave: { key: bk.value }, google: { key: gk.value, cx: gcx.value } }).then(() => { bk.value = ''; gk.value = ''; }).catch(fail);
          return { webResearch: { maxQueries: mq.value, maxPages: mp.value, perHost: ph.value, minShops: ms.value, fullQueries: fq.value, fullPages: fp.value, minImages: mi.value, approveNewShops: appr.checked, apis: { searxng: onX.checked, brave: onB.checked, google: onG.checked } } };
        }));
      }

      if (tab === 'ads') {
        const data = await GET('/api/adrules');
        let rules = data.rules.map((r) => Object.assign({}, r));
        const LV = { banned: 'Απαγορεύεται (Google και Meta)', google: 'Όχι Google · Meta 18+', caution: 'Προσοχή (εξαρτάται)', meta18: 'Επιτρέπεται · Meta 18+', ok: 'Επιτρέπεται' };
        const KIND = { cat: 'Κατηγορία (και υποκατηγορίες)', type: 'Ο τίτλος ξεκινά με', word: 'Λέξη μέσα στον τίτλο' };
        box.appendChild(h('div', { class: 'note' }, 'Το ' + siteName('st') + ' υπάρχει για τις διαφημίσεις. Οι κανόνες βγήκαν από τις επίσημες πολιτικές (28/10/2026): ',
          h('a', { href: '#', onclick: (e) => { e.preventDefault(); App.openUrl('https://support.google.com/merchants/answer/6150004'); } }, 'Google Merchant Center'), ' · ',
          h('a', { href: '#', onclick: (e) => { e.preventDefault(); App.openUrl('https://support.google.com/adspolicy/answer/6014299'); } }, 'Google Ads'), ' · ',
          h('a', { href: '#', onclick: (e) => { e.preventDefault(); App.openUrl('https://transparency.meta.com/policies/ad-standards/restricted-goods-services/weapons-ammunitions-explosives'); } }, 'Meta'),
          '. Ό,τι «απαγορεύεται» δεν μπαίνει ποτέ στα αρχεία για το ' + siteName('st') + '· ό,τι είναι «όχι Google» μπαίνει κρυφό από το Google Shopping.'));
        box.appendChild(h('div', { class: 'grid2' }, ['st', 'sf'].map((site) => h('div', { class: 'panel' }, h('h2', null, siteName(site)),
          h('div', { class: 'row tight' }, ['banned', 'google', 'caution', 'meta18'].map((k) => h('button', { type: 'button', class: 'chip', onclick: () => App.go('products', { site, only: k === 'banned' ? 'noads' : k === 'google' ? 'nogoogle' : '' }) }, h('span', { class: 'ad ' + k }, App.AD[k]), ' ', h('b', null, fmt.num(data.counts[site][k])))))))));
        const tb = h('tbody');
        const draw = () => {
          clear(tb);
          rules.forEach((r, i) => {
            tb.appendChild(h('tr', null,
              h('td', null, select(Object.entries(KIND), r.kind, (v) => { r.kind = v; })),
              h('td', null, h('input', { type: 'text', value: r.match, oninput: (e) => { r.match = e.target.value; } })),
              h('td', null, select(Object.entries(LV), r.level, (v) => { r.level = v; })),
              h('td', null, h('input', { type: 'text', value: r.why || '', placeholder: 'γιατί (φαίνεται στους ελέγχους)', oninput: (e) => { r.why = e.target.value; } })),
              h('td', null, h('button', { class: 'x', title: 'Αφαίρεση', onclick: () => { rules.splice(i, 1); draw(); } }, icon('trash')))));
          });
        };
        draw();
        box.appendChild(h('div', { class: 'panel flush' }, h('div', { class: 'row', style: { padding: '14px 18px 8px', justifyContent: 'space-between' } }, h('h2', { style: { margin: 0 } }, `Κανόνες (${rules.length})${data.custom ? ' · με δικές σας αλλαγές' : ''}`),
          h('div', { class: 'row tight' }, btn('Νέος κανόνας', { cls: 'sm', icon: 'new' }, () => { rules.unshift({ kind: 'type', match: '', level: 'banned', why: '' }); draw(); }),
            data.custom ? btn('Επαναφορά των αρχικών', { cls: 'sm ghost' }, async () => { if (await confirmBox('Επαναφορά των αρχικών κανόνων;', 'Οι δικές σας αλλαγές θα χαθούν.', 'Επαναφορά', true)) POST('/api/settings', { adRules: null }).then(async () => { await App.refreshState(); toast('Επαναφέρθηκαν.'); App.route(); }).catch(fail); }) : null)),
          h('p', { class: 'hint', style: { padding: '0 18px' } }, 'Σειρά προτεραιότητας: η πιο βαθιά κατηγορία μετράει (π.χ. «ΟΠΛΑ › ΧΡΗΜΑΤΟΚΙΒΩΤΙΑ» = επιτρέπεται), ο τίτλος «επιτρέπεται» νικάει γενική κατηγορία, αλλιώς κερδίζει το αυστηρότερο. Μαχαίρια με λέξεις όπως TACTICAL, COMBAT, MILITARY, AUTOMATIC απαγορεύονται πάντα.'),
          h('div', { class: 'tbl-wrap', style: { border: 0 } }, h('table', { class: 'tbl' }, h('thead', null, h('tr', null, h('th', null, 'Τι ελέγχει'), h('th', null, 'Κείμενο'), h('th', null, 'Διαφημίσεις'), h('th', null, 'Σημείωση'), h('th', null, ''))), tb))));
        box.appendChild(saveBtn(() => ({ adRules: rules.filter((r) => r.match.trim()) })));
      }

      if (tab === 'new') {
        const status = select([['draft', 'Ως πρόχειρα (τα δημοσιεύεις εσύ)'], ['publish', 'Δημοσιευμένα αμέσως']], s.newProduct.status, null);
        const tag = select([['h2', 'Επικεφαλίδα (H2) — καλό για Google'], ['h3', 'Μικρότερη επικεφαλίδα (H3)'], ['p', 'Έντονο κείμενο']], s.newProduct.titleTag, null);
        const footer = h('textarea', { rows: 2, value: s.newProduct.footer });
        const vsku = select([['suffix', 'Δικός του κωδικός ανά χρώμα / μέγεθος — μόνο πραγματικός (προμηθευτής ή ίδιος κωδικός σε ≥2 καταστήματα), ποτέ από επίθεμα'], ['same', 'Κανένας κωδικός σε χρώματα / μεγέθη (μόνο ο κωδικός του προϊόντος)']], s.variantSku || 'suffix', null);
        const seo = {}, attrs = {};
        const attrNames = { sf: await GET('/api/attributes', { site: 'sf' }), st: await GET('/api/attributes', { site: 'st' }) };
        const sum = App.state.summary;
        for (const site of ['sf', 'st']) {
          seo[site] = select([['auto', 'Αυτόματα' + (sum[site].info && sum[site].info.seo ? ` (βρέθηκε: ${sum[site].info.seo})` : '')], ['yoast', 'Yoast SEO'], ['rankmath', 'Rank Math'], ['none', 'Κανένα']], s.seo[site], null);
          attrs[site] = {};
          for (const kind of ['brand', 'size', 'color']) {
            const opts = [['', 'Αυτόματα']].concat(attrNames[site].map((a) => [a.name, `${a.name} (${a.count}${a.global ? ', καθολική' : ''})`]));
            attrs[site][kind] = select(opts, s.attributes[site][kind], null);
          }
        }
        box.appendChild(h('div', { class: 'panel' }, h('h2', null, 'Αρχεία νέων προϊόντων'),
          h('div', { class: 'grid2' }, field('Τα νέα προϊόντα μπαίνουν', status), field('Τίτλος στην αρχή της περιγραφής', tag)),
          h('div', { style: { marginTop: '10px' } }, field('Κείμενο στο τέλος της αυτόματης περιγραφής', footer)),
          h('div', { style: { marginTop: '10px' } }, field('Κωδικοί για χρώματα και μεγέθη', vsku, 'Με «ένας κωδικός» κανένα χρώμα ή μέγεθος δεν παίρνει πρόσθετο κωδικό: όλα έχουν τον κωδικό του προϊόντος.'))));
        box.appendChild(h('div', { class: 'grid2' }, ['sf', 'st'].map((site) => h('div', { class: 'panel' }, h('h2', null, siteName(site)),
          h('div', { class: 'stack s' }, field('Πρόσθετο SEO', seo[site], 'Για meta description και λέξη-κλειδί στο αρχείο.'), field('Ιδιότητα μάρκας', attrs[site].brand), field('Ιδιότητα μεγέθους', attrs[site].size), field('Ιδιότητα χρώματος', attrs[site].color))))));
        box.appendChild(saveBtn(() => ({ variantSku: vsku.value, newProduct: { status: status.value, titleTag: tag.value, footer: footer.value }, seo: { sf: seo.sf.value, st: seo.st.value }, attributes: { sf: { brand: attrs.sf.brand.value, size: attrs.sf.size.value, color: attrs.sf.color.value }, st: { brand: attrs.st.brand.value, size: attrs.st.size.value, color: attrs.st.color.value } } })));
      }

      if (tab === 'cats') {
        const data = await GET('/api/catmap', { from: 'sf' });
        if (!data.rows.length) { box.appendChild(h('div', { class: 'panel empty' }, h('p', null, 'Διάβασε πρώτα τα προϊόντα και των δύο sites.'))); return; }
        const changes = {};
        box.appendChild(h('div', { class: 'note' }, `Πού πάει κάθε κατηγορία του ${siteName('sf')} όταν ένα προϊόν μεταφέρεται στο ${siteName('st')}. Όσες έχουν ίδιο όνομα συνδέονται μόνες τους.`));
        const tb = h('tbody');
        for (const r of data.rows) {
          if (r.regulated) continue;
          const sel = select([['', r.how === 'none' ? '— νέα κατηγορία με το ίδιο όνομα —' : '—'], ['0', '— καμία —']].concat(data.targets.map((t) => [String(t.id), t.path])), r.to ? String(r.to) : '', (v) => { changes[r.id] = v === '' ? null : v; });
          tb.appendChild(h('tr', null, h('td', { class: 'title' }, r.path, h('span', { class: 'faint', style: { fontWeight: 400 } }, ` (${r.count})`)), h('td', null, sel), h('td', null, h('span', { class: 'faint' }, { path: 'ίδια διαδρομή', name: 'ίδιο όνομα', manual: 'χειροκίνητα', none: '' }[r.how]))));
        }
        box.appendChild(h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl' }, h('thead', null, h('tr', null, h('th', null, siteName('sf')), h('th', null, siteName('st')), h('th', null, ''))), tb)));
        box.appendChild(h('div', { class: 'row', style: { justifyContent: 'flex-end' } }, btn('Αποθήκευση', { cls: 'primary' }, () => POST('/api/catmap', { from: 'sf', pairs: changes }).then(() => toast('Αποθηκεύτηκε.')).catch(fail))));
      }

      if (tab === 'ai') {
        const en = h('input', { type: 'checkbox', checked: s.localAI.enabled });
        const url = inp(s.localAI.url);
        const model = inp(s.localAI.model, { placeholder: 'π.χ. qwen2.5:7b' });
        const inResearch = h('input', { type: 'checkbox', checked: s.localAI.research !== false });
        const usage = h('div', { class: 'faint', style: { marginTop: '8px' } });
        GET('/api/ai/log').then((l) => { const t = Object.entries(l.totals || {}); if (t.length) usage.textContent = 'Χρήση AI: ' + t.map(([k, v]) => `${{ text: 'κείμενα', suggest: 'προτάσεις', judge: 'κρίσεις σελίδων', queries: 'αναζητήσεις' }[k] || k}: ${v.calls} ερωτήσεις, ${Math.round(v.ms / 1000)}″, ${v.tokens} tokens`).join(' · '); }).catch(() => {});
        const res = h('div');
        box.appendChild(h('div', { class: 'panel' }, h('h2', null, 'Δωρεάν AI (προαιρετικό)'),
          h('p', { class: 'muted' }, 'Για περιγραφές όταν δεν υπάρχει επίσημο κείμενο, ή μετάφραση αγγλικών κειμένων. Χρειάζεται το δωρεάν πρόγραμμα Ollama σε υπολογιστή με τουλάχιστον 16 GB μνήμη. Χωρίς αυτό, όλα τα υπόλοιπα δουλεύουν κανονικά.'),
          server
            ? h('div', { class: 'note', style: { marginBottom: '10px' } }, h('b', null, 'Το Ollama τρέχει στο PC σου, όχι στο cloud. '), 'Το πρόγραμμα του στέλνει τις ερωτήσεις μέσω του υπολογιστή που βοηθά (SF-Kentro-Worker). Χρειάζονται: το Ollama ανοιχτό στο PC, ο worker της νέας έκδοσης σε λειτουργία. Στις Ρυθμίσεις → Υπολογιστές φαίνεται «AI (Ollama): ✓» όταν το βρει.')
            : h('div', { class: 'note', style: { marginBottom: '10px' } }, h('b', null, 'Δεν χρειάζεται σε κάθε υπολογιστή. '), 'Το καλεί το πρόγραμμα, όχι ο browser: αρκεί ΕΝΑΣ δυνατός υπολογιστής με Ollama. Στους άλλους γράψε εδώ τη διεύθυνσή του (π.χ. http://192.168.1.20:11434).'),
          h('ol', { class: 'steps' }, h('li', null, 'Κατέβασε και εγκατάστησε το Ollama από το ollama.com (στο PC που βοηθά).'), h('li', null, 'Άνοιξε τη γραμμή εντολών και γράψε: ollama pull qwen2.5:7b'), server ? h('li', null, 'Ξεκίνα τον worker από τον νέο φάκελο, περίμενε 1 λεπτό, ενεργοποίησε εδώ και πάτα «Δοκιμή».') : h('li', null, 'Ενεργοποίησε εδώ και πάτα «Δοκιμή».')),
          h('div', { class: 'grid3', style: { marginTop: '12px' } }, server ? null : field('Διεύθυνση', url), field('Μοντέλο', model, 'Κενό = το πρώτο εγκατεστημένο')),
          h('label', { class: 'check', style: { marginTop: '10px' } }, en, 'Ενεργό'),
          h('label', { class: 'check' }, inResearch, 'Και στην έρευνα internet: προτείνει αναζητήσεις και κρίνει τις αμφίβολες σελίδες (ποτέ δεν κάνει μόνο του κάτι «ίδιο»)'), usage,
          server ? h('p', { class: 'faint', style: { marginTop: '10px' } }, 'Ο έλεγχος του AI (και όλου του συστήματος) γίνεται σε ένα σημείο: Ρυθμίσεις → Σύστημα → «Έλεγχος όλων».') : h('div', { class: 'row', style: { marginTop: '10px' } }, btn('Δοκιμή', { cls: 'sm' }, async () => {
            clear(res).appendChild(h('span', { class: 'muted' }, 'Δοκιμή…'));
            try {
              await POST('/api/settings', { localAI: { enabled: en.checked, url: url.value, model: model.value } });
              const r = await POST('/api/ai/test', {});
              clear(res).appendChild(h('div', { class: 'note ' + (r.ok ? 'ok' : 'crit') }, h('b', null, r.ok ? 'Το AI δουλεύει' + (r.model ? ' (' + r.model + ')' : '') + '.' : 'Το AI δεν δουλεύει ακόμα:'),
                h('ul', { class: 'todo-list', style: { margin: '6px 0 0' } }, r.steps.map((x) => h('li', { class: x.ok ? '' : 'crit' }, (x.ok ? '✓ ' : '✗ ') + x.text)))));
            } catch (e) { clear(res).appendChild(h('div', { class: 'note crit' }, e.message)); }
          })), res));
        box.appendChild(saveBtn(() => ({ localAI: { enabled: en.checked, url: url.value, model: model.value, research: inResearch.checked } })));
      }

      if (tab === 'phone') await phoneTab(box, server, admin);

      if (tab === 'workers' && server && admin) {
        // the computers of the shops that do the heavy work (lib/coord.js, app/worker.js) — live, every 3 seconds
        const root = h('div', { class: 'stack' });
        // ONE place for the whole system: the program, the data, the computer, the AI, the research — and one check
        const sys = h('div', { class: 'panel' });
        const sysList = h('ul', { class: 'todo-list sys-list' });
        const sysOut = h('div');
        const LIGHT = { ok: 'ok', working: 'ok', stopped: '', disabled: '', none: 'warn', offline: 'warn', updating: 'warn', paused: 'warn', error: 'crit' };
        const drawSys = (r) => {
          clear(sysList);
          for (const x of r.items) sysList.appendChild(h('li', { class: x.ok ? '' : LIGHT[x.state] === 'crit' ? 'crit' : LIGHT[x.state] === 'warn' ? 'warn' : '' },
            h('span', { class: 'pill ' + (LIGHT[x.state] != null ? LIGHT[x.state] : x.ok ? 'ok' : 'warn') }, x.ok ? '✓' : x.state === 'stopped' || x.state === 'disabled' ? '■' : '!'), ' ', h('b', null, x.label + ': '), x.text));
        };
        const installer = () => POST('/api/workers/installer').then((r) => {
          const a = h('a', { href: URL.createObjectURL(new Blob([r.text], { type: 'application/octet-stream' })), download: r.name });
          document.body.appendChild(a); a.click(); a.remove();
          toast(`Κατέβηκε το «${r.name}». Στο PC: διπλό κλικ → κάνει τα πάντα μόνο του (ισχύει ${r.hours} ώρες, μία φορά).`);
        }).catch(fail);
        sys.appendChild(h('div', { class: 'row', style: { justifyContent: 'space-between', flexWrap: 'wrap', gap: '6px' } }, h('h2', { style: { margin: 0 } }, 'Κατάσταση συστήματος'),
          h('div', { class: 'row tight', style: { flexWrap: 'wrap' } },
            btn('Έλεγχος όλων', { cls: 'sm primary', icon: 'check', title: 'Αποθήκευση δεδομένων και πραγματική απάντηση του AI μέσα από τον υπολογιστή' }, () => {
              clear(sysOut).appendChild(h('span', { class: 'muted' }, 'Έλεγχος… (το AI την πρώτη φορά φορτώνει: έως 1–2 λεπτά)'));
              POST('/api/system/check').then((r) => { drawSys(r); clear(sysOut).appendChild(h('div', { class: 'note ' + (r.steps.every((x) => x.ok || x.state === 'disabled') ? 'ok' : 'crit') }, h('b', null, r.steps.every((x) => x.ok || x.state === 'disabled') ? 'Όλα δουλεύουν.' : 'Κάτι θέλει προσοχή:'), h('ul', { class: 'todo-list', style: { margin: '6px 0 0' } }, r.steps.map((x) => h('li', { class: x.ok ? '' : 'crit' }, (x.ok ? '✓ ' : '✗ ') + x.text))))); }).catch((e) => clear(sysOut).appendChild(h('div', { class: 'note crit' }, e.message)));
            }),
            btn('Αρχείο εγκατάστασης υπολογιστή', { cls: 'sm', icon: 'download', title: 'Ένα αρχείο για το PC: διπλό κλικ → κατεβάζει, συνδέεται, ξεκινά με τα Windows (σταματημένο)' }, installer))),
          h('p', { class: 'faint', style: { margin: '6px 0' } }, 'Ο υπολογιστής συνδέεται και ενημερώνεται μόνος του. Ξεκινά σταματημένος (δεν τρώει πόρους): τον ανοίγεις πιο κάτω με «Πάντα» ή «Μόνο με ανοιχτό πρόγραμμα».'),
          sysList, sysOut);
        box.appendChild(sys);
        const sysTick = async () => { if (!document.body.contains(sys)) return; try { drawSys(await GET('/api/system/status')); } catch (_) { /* next time */ } setTimeout(sysTick, 10000); };
        sysTick();
        box.appendChild(root);
        const hist = App.workerHist || (App.workerHist = new Map()); // id → last CPU readings (for the line)
        const nz = (v) => fmt.num(Number(v) || 0);
        const lvl = (pct) => (pct >= 90 ? 'hot' : pct >= 65 ? 'warm' : 'ok');
        const bar = (label, pct, text) => h('div', { class: 'gauge ' + lvl(pct) }, h('div', { class: 'gauge-top' }, h('span', null, label), h('b', null, text)), h('div', { class: 'gauge-bar' }, h('i', { style: { width: Math.max(0, Math.min(100, Number(pct) || 0)) + '%' } })));
        const spark = (vals) => {
          const W = 160, H = 34, n = vals.length;
          if (n < 2) return h('div', { class: 'spark empty' });
          const pts = vals.map((v, k) => `${Math.round((k / (n - 1)) * W)},${Math.round(H - (Math.max(0, Math.min(100, v)) / 100) * (H - 2) - 1)}`).join(' ');
          const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
          svg.setAttribute('viewBox', `0 0 ${W} ${H}`); svg.setAttribute('class', 'spark'); svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('preserveAspectRatio', 'none');
          svg.innerHTML = `<polyline points="0,${H} ${pts} ${W},${H}" class="fill"/><polyline points="${pts}" class="line"/>`;
          return svg;
        };
        const hours = (x) => (x == null ? '—' : x < 1 ? `${Math.max(1, Math.round(x * 60))} λεπτά` : `${String(x).replace('.', ',')} ώρες`);
        const pairBox = h('div');
        const draw = (d) => {
          clear(root);
          const rs = d.research || { looked: 0, found: 0, waiting: 0, perHour: 0, hoursLeft: null };
          const st = d.stats || {};
          const total = (rs.looked || 0) + (rs.waiting || 0);
          const pct = total ? Math.round(((rs.looked || 0) / total) * 100) : 0;
          root.appendChild(h('div', { class: 'panel research-live' },
            h('div', { class: 'row', style: { justifyContent: 'space-between', flexWrap: 'wrap', gap: '6px' } }, h('h2', { style: { margin: 0 } }, 'Έρευνα στο internet'), h('span', { class: 'live-dot' + (rs.perHour ? ' on' : '') }, rs.perHour ? 'σε εξέλιξη' : 'σε αναμονή')),
            h('p', { class: 'muted' }, 'Κωδικοί (SKU), EAN, φωτογραφίες και μάρκα για ό,τι λείπει, από καταστήματα με το ίδιο ακριβώς προϊόν. Τα αποτελέσματα πάνε στις Διορθώσεις, για έγκριση.'),
            h('div', { class: 'kpis wk-kpis four' },
              h('div', { class: 'kpi' }, h('b', null, nz(rs.waiting)), h('span', null, 'προϊόντα μένουν')),
              h('div', { class: 'kpi' }, h('b', null, nz(rs.perHour)), h('span', null, 'προϊόντα / ώρα')),
              h('div', { class: 'kpi' }, h('b', null, hours(rs.hoursLeft)), h('span', null, 'μέχρι να τελειώσουν')),
              h('div', { class: 'kpi' }, h('b', null, nz(rs.found)), h('span', null, 'βρέθηκαν σε άλλα καταστήματα'))),
            h('div', { class: 'gauge ok', style: { marginTop: '12px' } }, h('div', { class: 'gauge-top' }, h('span', null, `Ελέγχθηκαν ${nz(rs.looked)} από ${nz(total)}`), h('b', null, pct + '%')), h('div', { class: 'gauge-bar' }, h('i', { style: { width: pct + '%' } }))),
            d.queue ? h('p', { class: 'faint', style: { margin: '10px 0 0' } }, `Στη σειρά: ${nz(d.queue.waiting)} ομάδες των 20 προϊόντων περιμένουν · ${nz(d.queue.running)} τρέχουν τώρα.`) : null,
            rs.perHour ? null : h('p', { class: 'faint', style: { margin: '10px 0 0' } }, (st.online || 0) ? 'Οι υπολογιστές ξεκινούν· ο ρυθμός φαίνεται μετά από λίγα λεπτά.' : 'Κανένας υπολογιστής ανοιχτός: το πρόγραμμα στο cloud κάνει 25 προϊόντα τη μέρα. Άνοιξε έναν υπολογιστή που βοηθά για συνεχή, γρήγορη έρευνα.')));
          for (const w of d.workers || []) {
            const c = w.caps || {};
            const L = w.load;
            if (L) { const a = hist.get(w.id) || []; a.push(L.cpu); while (a.length > 60) a.shift(); hist.set(w.id, a); }
            const slots = L ? L.slots || c.slots || 1 : c.slots || 1;
            const busy = L ? L.busy || 0 : (w.jobs || []).length;
            root.appendChild(h('div', { class: 'panel worker-card' },
              h('div', { class: 'row', style: { justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px' } },
                h('div', { style: { minWidth: 0 } }, h('h3', { style: { margin: 0 } }, h('span', { class: 'dot ' + (w.online ? '' : 'off'), 'aria-hidden': 'true' }), ' ', w.name || 'Υπολογιστής'),
                  h('div', { class: 'faint' }, (w.online ? (w.active === false || (L && L.dormant) ? (w.mode === 'off' ? 'σταματημένο (χωρίς χρήση πόρων)' : 'σε αναμονή: το πρόγραμμα είναι κλειστό') : 'σε λειτουργία') : 'κλειστό · τελευταία ' + fmt.ago(w.lastSeen)) + ` · ${nz(c.cpus)} πυρήνες · ${nz(Math.round((c.ramMB || 0) / 1024))} GB` + (L && L.battery ? ' · σε μπαταρία (καμία νέα εργασία)' : '')),
                  h('div', { class: 'faint', style: { fontSize: '12.5px' } }, c.ollama && c.ollama.length ? `AI (Ollama${c.ollamaInfo && c.ollamaInfo.version ? ' ' + c.ollamaInfo.version : ''}): ✓ ${c.ollama.slice(0, 3).join(', ')}` : 'AI (Ollama): ' + (c.ollamaInfo && c.ollamaInfo.error ? c.ollamaInfo.error : 'δεν βρέθηκε σε αυτόν τον υπολογιστή')),
                  d.workerRev && c.rev !== d.workerRev ? h('div', { class: 'note', style: { marginTop: '6px', fontSize: '13px' } }, 'Παλιά έκδοση του φακέλου σε αυτόν τον υπολογιστή — δεν του δίνεται έρευνα internet (θα έψαχνε με τον παλιό τρόπο): κατέβασε ξανά τον φάκελο (DIAKOMISTIS-CLOUD.txt ★★ βήμα 5) και ξεκίνα τον worker από τον νέο φάκελο.') : null),
                h('div', { class: 'row tight', style: { flexWrap: 'wrap', gap: '6px' } },
                  App.seg([['always', 'Πάντα (παρασκήνιο)'], ['app', 'Μόνο με ανοιχτό πρόγραμμα'], ['off', 'Σταματημένο']], w.mode || 'always', (v) => POST('/api/workers/mode', { id: w.id, mode: v }).then(() => toast(v === 'off' ? 'Ο υπολογιστής σταματά: δεν θα χρησιμοποιεί κανέναν πόρο (σε 15″).' : v === 'app' ? 'Θα δουλεύει μόνο όσο είναι ανοιχτό το πρόγραμμα σε κάποια οθόνη.' : 'Θα δουλεύει συνέχεια, στο παρασκήνιο.')).catch(fail)),
                  App.seg([['gentle', 'Ήπια'], ['normal', 'Κανονική'], ['boost', 'Ενίσχυση']], w.perf || 'normal', (v) => POST('/api/workers/perf', { id: w.id, profile: v }).then(() => toast(v === 'gentle' ? 'Ήπια: έως 2 εργασίες, 1 σελίδα τη φορά — ο υπολογιστής μένει ελεύθερος για σένα (σε 15″).' : v === 'boost' ? 'Ενίσχυση: όλοι οι πυρήνες· αν γεμίσει η μνήμη κατεβαίνει μόνο του (σε 15″).' : 'Κανονική: οι μισοί πυρήνες, 2 σελίδες τη φορά (σε 15″).')).catch(fail)),
                btn('Αφαίρεση', { cls: 'sm ghost' }, async () => { if (await confirmBox(`Αφαίρεση του «${w.name}»;`, 'Ο υπολογιστής δεν θα μπορεί πια να συνδεθεί. Οι εργασίες του γυρίζουν στη σειρά. Για να ξαναμπεί θέλει νέο κωδικό σύζευξης.', 'Αφαίρεση', true)) POST('/api/workers/revoke', { id: w.id }).then(() => App.route()).catch(fail); }))),
              L ? h('div', { class: 'wk-live' },
                h('div', { class: 'wk-gauges' },
                  bar('Επεξεργαστής', L.cpu, `${nz(L.cpu)}%`),
                  bar('Μνήμη', L.ram, `${nz(L.ram)}% · πρόγραμμα ${nz(L.procMB)} MB`),
                  h('div', { class: 'gauge' }, h('div', { class: 'gauge-top' }, h('span', null, 'Εργάτες'), h('b', null, `${nz(busy)} / ${nz(slots)} δουλεύουν`)), h('div', { class: 'slots' }, Array.from({ length: slots }, (_, k) => h('i', { class: k < busy ? 'on' : '' }))))),
                h('div', { class: 'wk-side' }, spark(hist.get(w.id) || []), h('div', { class: 'faint', style: { fontSize: '12px' } }, 'επεξεργαστής, τελευταία 3 λεπτά'))) : null,
              L ? h('div', { class: 'wk-rates' },
                L.perf ? h('span', { class: 'pill ' + (L.perf.down ? 'warn' : ''), title: 'Οι μηχανές αναζήτησης ρωτιούνται πάντα με τον ίδιο ασφαλή ρυθμό· το προφίλ αλλάζει μόνο πόσα προϊόντα δουλεύονται μαζί.' }, `Προφίλ ${L.perf.label}: ${nz(L.perf.slots)}/${nz(L.perf.max)} εργασίες · ${nz(L.perf.pages)} σελίδες/προϊόν` + (L.perf.down ? ' · κατέβηκε μόνο του (' + L.perf.reason + ')' : '')) : null,
                h('span', null, h('b', null, nz(L.perHour.products)), ' προϊόντα/ώρα'), h('span', null, h('b', null, nz(L.perHour.pages)), ' σελίδες/ώρα'), h('span', null, h('b', null, nz(L.perHour.searches)), ' αναζητήσεις/ώρα'),
                ...Object.entries(L.engines || {}).map(([k, v]) => h('span', { class: 'pill ' + (v === 'ok' ? 'ok' : 'warn'), title: v === 'ok' ? '' : 'Η μηχανή ζήτησε παύση: ξαναδοκιμάζει σε 10 λεπτά, πιο αργά. Οι άλλες συνεχίζουν.' }, ({ ddg: 'DuckDuckGo', bing: 'Bing', yahoo: 'Yahoo' }[k] || k) + (v === 'ok' ? ' ✓' : ' σε παύση'))))
                : h('div', { class: 'faint', style: { marginTop: '6px' } }, w.online ? 'Περιμένει τις πρώτες μετρήσεις… (παλιότερη έκδοση; ξανακατέβασε τον φάκελο)' : 'Κλειστό: ανοίγει μόνο του με τα Windows.'),
              (w.jobs || []).length ? h('ul', { class: 'why' }, w.jobs.map((j) => h('li', null, [j.label || 'Εργασία', j.total ? `${nz(j.done)}/${nz(j.total)}` : '', j.msg || ''].filter(Boolean).join(' · ')))) : null));
          }
          if (!(d.workers || []).length) root.appendChild(h('div', { class: 'panel empty' }, h('h3', null, 'Κανένας υπολογιστής ακόμα'), h('p', null, 'Όλη η δουλειά γίνεται στο cloud, αργά. Πρόσθεσε το PC του μαγαζιού (πιο κάτω) για να δουλεύει στο τέρμα.')));
          root.appendChild(h('div', { class: 'panel' }, h('h2', null, 'Προσθήκη υπολογιστή'),
            h('ol', { class: 'steps' },
              h('li', null, 'Πάτα «Αρχείο εγκατάστασης υπολογιστή» (πάνω) και πήγαινε το αρχείο στο PC (Windows 10/11).'),
              h('li', null, 'Διπλό κλικ στο αρχείο. Κατεβάζει το πρόγραμμα, συνδέεται, ξεκινά με τα Windows — χωρίς τίποτα άλλο. Αν τα Windows ρωτήσουν «Να εκτελεστεί;», πάτα «Περισσότερα» → «Εκτέλεση».'),
              h('li', null, 'Εμφανίζεται εδώ σταματημένος. Διάλεξε «Πάντα» ή «Μόνο με ανοιχτό πρόγραμμα» όταν θέλεις να δουλεύει.')),
            h('details', null, h('summary', null, 'Με το χέρι (φάκελος zip και κωδικός)'),
            d.download ? h('div', { class: 'row', style: { marginBottom: '8px' } }, h('a', { class: 'btn primary', href: d.download, target: '_blank', rel: 'noopener' }, '⬇ Κατέβασε τον φάκελο του υπολογιστή (zip)'), h('span', { class: 'faint mono', style: { wordBreak: 'break-all', fontSize: '12px' } }, d.download)) : null,
            h('div', { class: 'row' }, btn('Νέος κωδικός', { cls: 'primary', icon: 'new' }, () => POST('/api/workers/pair').then((r) => {
              clear(pairBox);
              pairBox.appendChild(h('div', { class: 'pair-code' }, h('div', { class: 'faint' }, 'Διεύθυνση'), h('b', { class: 'mono' }, location.origin), h('div', { class: 'faint' }, `Κωδικός (ισχύει ${nz(r && r.minutes)} λεπτά)`), h('b', { class: 'mono big' }, (r && r.code) || '—')));
            }).catch(fail))), pairBox)));
          root.appendChild(h('p', { class: 'faint', style: { margin: 0 } }, 'Τα δεδομένα φυλάγονται ' + (d.store || '—') + '. Ενημέρωση κάθε 3 δευτερόλεπτα.'));
        };
        let failed = 0;
        const tick = async () => {
          if (!document.body.contains(root)) return; // left the screen: no more updates
          try { draw(await GET('/api/workers')); failed = 0; } catch (e) { if (++failed === 3) toast('Οι υπολογιστές δεν απαντούν προς το παρόν· δοκιμάζει ξανά.', { err: true }); }
          setTimeout(tick, 3000);
        };
        await tick();
        return;
      }
      if (tab === 'audit' && server && admin) {
        const rows = await GET('/api/audit', { n: 300 });
        const list = h('ul', { class: 'audit-list' });
        for (const r of rows) {
          const det = r.detail ? Object.entries(r.detail).map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : v}`).join(' · ') : '';
          list.appendChild(h('li', null, h('div', { class: 'row', style: { justifyContent: 'space-between', gap: '8px', flexWrap: 'wrap' } }, h('b', null, r.action), h('span', { class: 'faint num' }, fmt.dateTime(r.at))),
            h('div', { class: 'muted' }, r.actor || '—', r.target && !/^[a-z0-9]{10,}$/.test(r.target) ? ' · ' + r.target : ''), det ? h('div', { class: 'faint' }, det) : null));
        }
        box.appendChild(h('div', { class: 'panel' }, h('h2', null, 'Ποιος έκανε τι'), h('p', { class: 'muted' }, 'Εγκρίσεις, αρχεία, ρυθμίσεις, χρήστες, υπολογιστές. Χωρίς κωδικούς.'),
          rows.length ? list : h('p', { class: 'faint' }, 'Τίποτα ακόμα.')));
        return;
      }
      if (tab === 'users' && server) {
        const me = App.me || {};
        const cur = h('input', { type: 'password', autocomplete: 'current-password' });
        const n1 = h('input', { type: 'password', autocomplete: 'new-password' }), n2 = h('input', { type: 'password', autocomplete: 'new-password' });
        box.appendChild(h('div', { class: 'panel' }, h('h2', null, 'Ο λογαριασμός μου'),
          h('p', { class: 'muted' }, `${me.name || ''} (${me.user || ''}) · ${me.role === 'admin' ? 'διαχειριστής' : 'χρήστης'}`),
          h('div', { class: 'grid3' }, field('Τωρινός κωδικός', cur), field('Νέος κωδικός', n1, 'Τουλάχιστον 10 χαρακτήρες'), field('Ξανά ο νέος', n2)),
          h('div', { class: 'row', style: { marginTop: '10px' } }, btn('Αλλαγή κωδικού', { cls: 'primary', icon: 'lock' }, async () => {
            if (n1.value !== n2.value) return toast('Οι δύο νέοι κωδικοί δεν είναι ίδιοι.', { err: true });
            try { await POST('/api/me/password', { current: cur.value, password: n1.value }); cur.value = n1.value = n2.value = ''; toast('Ο κωδικός άλλαξε. Οι άλλες συνδέσεις σου έκλεισαν.'); location.reload(); } catch (e) { fail(e); }
          }))));
        if (me.role === 'admin') {
          const data = await GET('/api/users');
          const tb = h('div', { class: 'ulist' });
          for (const u of data.users) {
            tb.appendChild(h('div', { class: 'urow' }, h('div', { class: 'u-main' }, h('b', null, u.name), h('span', { class: 'faint' }, `${u.user} · τελευταία σύνδεση ${u.lastLoginAt ? fmt.ago(u.lastLoginAt) : 'ποτέ'}`)),
              h('div', { class: 'u-side' },
                select([['staff', 'Χρήστης'], ['admin', 'Διαχειριστής']], u.role, (v) => POST('/api/users', { id: u.id, role: v }).then(() => toast('Αποθηκεύτηκε.')).catch((e) => { fail(e); App.route(); }), { 'aria-label': 'Ρόλος' }),
                btn('Νέος κωδικός', { cls: 'sm' }, async () => {
                  const pw = prompt('Νέος κωδικός για ' + u.name + ' (τουλάχιστον 10 χαρακτήρες):');
                  if (pw) POST('/api/users', { id: u.id, password: pw }).then(() => toast('Ο κωδικός άλλαξε· οι συνδέσεις του έκλεισαν.')).catch(fail);
                }),
                u.id !== me.id ? btn('Διαγραφή', { cls: 'sm ghost danger' }, async () => { if (await confirmBox('Διαγραφή του ' + u.name + ';', 'Δεν θα μπορεί να συνδεθεί.', 'Διαγραφή', true)) POST('/api/users/delete', { id: u.id }).then(() => App.route()).catch(fail); }) : null)));
          }
          const nu = { name: h('input', { type: 'text' }), user: h('input', { type: 'text', autocapitalize: 'none', spellcheck: 'false' }), pw: h('input', { type: 'password', autocomplete: 'new-password' }), role: select([['staff', 'Χρήστης'], ['admin', 'Διαχειριστής']], 'staff', null) };
          box.appendChild(h('div', { class: 'panel' }, h('h2', null, 'Χρήστες'),
            h('p', { class: 'muted' }, 'Κάθε άτομο με δικό του όνομα και κωδικό. Ο «Χρήστης» κάνει όλη τη δουλειά· ο «Διαχειριστής» αλλάζει και ρυθμίσεις, ασφάλεια και χρήστες.'),
            tb,
            h('h3', { style: { margin: '16px 0 8px', fontSize: '15px' } }, 'Νέος χρήστης'),
            h('div', { class: 'grid3' }, field('Ονοματεπώνυμο', nu.name), field('Όνομα χρήστη', nu.user, 'Λατινικά, π.χ. maria'), field('Κωδικός', nu.pw, 'Τουλάχιστον 10 χαρακτήρες')),
            h('div', { class: 'row', style: { marginTop: '10px' } }, nu.role, btn('Προσθήκη', { cls: 'primary', icon: 'new' }, () => POST('/api/users', { name: nu.name.value, user: nu.user.value, password: nu.pw.value, role: nu.role.value }).then(() => { toast('Ο χρήστης προστέθηκε.'); App.route(); }).catch(fail)))));
          const sb = h('div', { class: 'ulist' });
          for (const x of data.sessions) {
            sb.appendChild(h('div', { class: 'urow' }, h('div', { class: 'u-main' }, h('b', null, `${x.user} · ${deviceOf(x.ua)}`),
              h('span', { class: 'faint' }, [fmt.ago(x.lastSeen), x.ip, x.remembered ? 'μένει συνδεδεμένη έως 30 μέρες χωρίς χρήση' : ''].filter(Boolean).join(' · '))),
              h('div', { class: 'u-side' }, x.current ? h('span', { class: 'pill' }, 'αυτή η συσκευή') : btn('Αποσύνδεση', { cls: 'sm ghost danger', icon: 'logout' }, async () => {
                if (await confirmBox('Αποσύνδεση αυτής της συσκευής;', `${x.user} · ${deviceOf(x.ua)}. Για να ξαναμπεί θα χρειαστεί τον κωδικό του. Αν χάθηκε το κινητό, άλλαξε και τον κωδικό του χρήστη.`, 'Αποσύνδεση', true)) POST('/api/users/session-end', { id: x.id }).then(() => { toast('Η συσκευή αποσυνδέθηκε.'); App.route(); }).catch(fail);
              }))));
          }
          box.appendChild(h('div', { class: 'panel' }, h('h2', null, 'Ανοιχτές συνδέσεις'),
            h('p', { class: 'muted' }, 'Κάθε υπολογιστής και κινητό που είναι συνδεδεμένο τώρα. Χάθηκε ένα κινητό; «Αποσύνδεση» δίπλα του.'),
            sb,
            h('div', { class: 'row', style: { marginTop: '10px' } }, btn('Αποσύνδεση όλων', { cls: 'danger sm' }, async () => { if (await confirmBox('Αποσύνδεση όλων των υπολογιστών;', 'Όλοι (και εσύ) θα χρειαστεί να συνδεθούν ξανά.', 'Αποσύνδεση', true)) POST('/api/users/logout-all').then(() => location.reload()).catch(fail); }))));
        }
      }

      if (tab === 'security' && server) {
        // which version runs (shown at the end of this tab)
        GET('/api/build').then((b) => {
          if (!b) return;
          box.appendChild(h('div', { class: 'panel' }, h('h2', null, 'Έκδοση που τρέχει'),
            h('div', { class: 'stack s' },
              h('div', null, h('span', { class: 'faint' }, 'Έκδοση: '), h('b', null, b.version || '—')),
              h('div', null, h('span', { class: 'faint' }, 'Ενημέρωση (deploy): '), h('b', null, b.startedAt ? fmt.dateTime(b.startedAt) : '—')),
              b.message ? h('div', null, h('span', { class: 'faint' }, 'Τελευταία αλλαγή: '), h('b', null, b.message), b.committedAt ? h('span', { class: 'faint' }, ' · ' + fmt.dateTime(b.committedAt)) : null) : null,
              b.sha ? h('div', null, h('span', { class: 'faint' }, 'Κωδικός αλλαγής: '), h('a', { href: b.url, target: '_blank', rel: 'noopener', class: 'mono' }, b.sha.slice(0, 7))) : h('div', { class: 'faint' }, 'Τοπική εκτέλεση (χωρίς στοιχεία deploy).'))));
        }).catch(() => {});
        const sec = await GET('/api/security/audit');
        const ok = (b, t) => h('li', { class: b ? 'ok' : 'warn' }, icon(b ? 'check' : 'alert'), ' ', t);
        const https = location.protocol === 'https:';
        box.appendChild(h('div', { class: 'panel' }, h('h2', null, icon('shield'), ' Κατάσταση ασφάλειας (διακομιστής)'),
          h('ul', { class: 'seclist' },
            ok(https, https ? 'Σύνδεση με https: ό,τι στέλνεται είναι κρυπτογραφημένο.' : 'Η σύνδεση ΔΕΝ είναι https. Στο internet βάλε πάντα https (π.χ. Caddy, δες τις οδηγίες εγκατάστασης). Μέσα στο δίκτυο του μαγαζιού είναι αποδεκτό.'),
            ok(true, 'Κάθε άτομο με δικό του όνομα και κωδικό· οι κωδικοί δεν αποθηκεύονται (μόνο «αποτύπωμα» scrypt).'),
            ok(true, `Μετά από 5 λάθος κωδικούς μπαίνει αναμονή που διπλασιάζεται. Η σύνδεση λήγει μετά από ${sec.lockMinutes}′ χωρίς χρήση.`),
            ok(true, 'Κάθε σύνδεση έχει δικό της μυστικό κλειδί· άλλες σελίδες του browser δεν μπορούν να μιλήσουν στο πρόγραμμα.'),
            sec.b2b.total ? ok(sec.b2b.sealed === sec.b2b.total, `Κωδικοί B2B: ${sec.b2b.total}${sec.b2b.sealed ? `, κλειδωμένοι και με PIN (${sec.b2b.sealed}/${sec.b2b.total})` : ' — βάλε PIN για επιπλέον κλείδωμα'}.`) : ok(true, 'Κωδικοί B2B προμηθευτών: κανένας αποθηκευμένος.'),
            ok(true, 'Κωδικοί διαχειριστή (admin) των sites: δεν ζητούνται και δεν αποθηκεύονται πουθενά.'))));
        if (admin) {
          const mins = h('input', { type: 'number', min: 1, max: 480, value: String(sec.lockMinutes), style: { width: '90px' } });
          box.appendChild(h('div', { class: 'panel' }, h('h2', null, 'Λήξη σύνδεσης'),
            h('div', { class: 'row' }, h('span', null, 'Αποσύνδεση μετά από'), mins, h('span', null, 'λεπτά χωρίς χρήση'),
              btn('Αποθήκευση', { cls: 'sm' }, () => POST('/api/security/minutes', { minutes: mins.value }).then(() => toast('Αποθηκεύτηκε.')).catch(fail)))));
          const p1 = h('input', { type: 'password', autocomplete: 'new-password' }), p2 = h('input', { type: 'password', autocomplete: 'new-password' }), cur = h('input', { type: 'password', autocomplete: 'off' }), op = h('input', { type: 'password', autocomplete: 'off' });
          box.appendChild(h('div', { class: 'panel' }, h('h2', null, 'PIN για τους κωδικούς B2B'),
            h('p', { class: 'muted' }, 'Στον διακομιστή το PIN κλειδώνει επιπλέον μόνο τους κωδικούς B2B: χωρίς αυτό, ένα αντίγραφο των δεδομένων δεν τους ανοίγει. Μετά από κάθε επανεκκίνηση του διακομιστή, ένας διαχειριστής βάζει το PIN μία φορά, για να διαβάζονται τα B2B στην ημερήσια ενημέρωση.'),
            sec.pin ? h('div', { class: 'row' }, op, btn(sec.vaultOpen ? 'Ανοιχτοί ✓' : 'Ξεκλείδωμα κωδικών B2B', { cls: sec.vaultOpen ? 'sm' : 'primary sm', icon: 'lock' }, () => POST('/api/unlock', { pin: op.value }).then(() => { op.value = ''; toast('Οι κωδικοί B2B ξεκλείδωσαν μέχρι την επόμενη επανεκκίνηση.'); App.route(); }).catch(fail))) : null,
            h('div', { class: 'grid3', style: { marginTop: '10px' } }, sec.pin ? field('Τρέχον PIN', cur) : null, field(sec.pin ? 'Νέο PIN' : 'PIN', p1, 'Τουλάχιστον 6 χαρακτήρες'), field('Επανάληψη', p2)),
            h('div', { class: 'row', style: { marginTop: '10px' } }, btn(sec.pin ? 'Αλλαγή PIN' : 'Ορισμός PIN', { cls: 'sm' }, () => {
              if (p1.value !== p2.value) return toast('Τα δύο PIN δεν είναι ίδια.', { err: true });
              POST('/api/security/pin', { pin: p1.value, current: cur.value }).then(() => { toast('Το PIN αποθηκεύτηκε.'); App.route(); }).catch(fail);
            }))));
        }
      }

      if (tab === 'security' && !server) {
        const sec = await GET('/api/security/audit');
        const pw = (ph) => h('input', { type: 'password', autocomplete: 'new-password', placeholder: ph || '', inputmode: 'numeric' });
        const cur = pw('τρέχον PIN'), p1 = pw('νέο PIN (τουλάχιστον 6)'), p2 = pw('ξανά το νέο PIN');
        const mins = h('input', { type: 'number', min: 1, max: 480, value: String(sec.lockMinutes), style: { width: '90px' } });
        const ok = (b, t) => h('li', { class: b ? 'ok' : 'warn' }, icon(b ? 'check' : 'alert'), ' ', t);
        box.appendChild(h('div', { class: 'panel' }, h('h2', null, icon('shield'), ' Κατάσταση ασφάλειας'),
          h('ul', { class: 'seclist' },
            ok(sec.pin, sec.pin ? `Κλείδωμα με PIN: ενεργό· κλειδώνει μόνο του μετά από ${sec.lockMinutes}′ χωρίς χρήση.` : 'Χωρίς PIN: όποιος κάθεται στον υπολογιστή ανοίγει το πρόγραμμα. Βάλε PIN παρακάτω.'),
            ok(true, 'Το πρόγραμμα ακούει μόνο σε αυτόν τον υπολογιστή (127.0.0.1)· δεν φαίνεται στο δίκτυο του μαγαζιού.'),
            ok(true, 'Κάθε άνοιγμα παίρνει νέο μυστικό κλειδί· άλλες σελίδες του browser δεν μπορούν να του μιλήσουν.'),
            ok(true, 'Κωδικοί διαχειριστή (admin) των sites: δεν ζητούνται και δεν αποθηκεύονται πουθενά.'),
            sec.b2b.total ? ok(sec.b2b.sealed === sec.b2b.total, `Κωδικοί B2B προμηθευτών: ${sec.b2b.total}, κρυπτογραφημένοι από τα Windows${sec.b2b.sealed ? ` και με το PIN (${sec.b2b.sealed}/${sec.b2b.total})` : ' — χωρίς PIN, ένα αντίγραφο του φακέλου στον ίδιο υπολογιστή μπορεί να τους ανοίξει'}.`) : ok(true, 'Κωδικοί B2B προμηθευτών: κανένας αποθηκευμένος.'),
            ok(true, 'Οι κωδικοί δεν εμφανίζονται ποτέ στην οθόνη, στα αρχεία καταγραφής ή στα Excel· στέλνονται μόνο με https.'),
            sec.failsSinceUnlock ? h('li', { class: 'warn' }, icon('alert'), ` Λάθος PIN: ${sec.failsSinceUnlock} φορές από το τελευταίο ξεκλείδωμα (τελευταία ${fmt.dateTime(sec.lastFailAt)}).`) : null)));
        const setP = async () => {
          if (p1.value !== p2.value) return toast('Τα δύο νέα PIN δεν είναι ίδια.', { err: true });
          try { App.lockInfo = await POST('/api/security/pin', { pin: p1.value, current: cur.value }); cur.value = p1.value = p2.value = ''; toast('Το PIN αποθηκεύτηκε. Οι κωδικοί B2B ξανακρυπτογραφήθηκαν με αυτό.'); await App.refreshState(); App.route(); } catch (e) { fail(e); }
        };
        box.appendChild(h('div', { class: 'panel' }, h('h2', null, sec.pin ? 'Αλλαγή PIN' : 'Ορισμός PIN'),
          h('p', { class: 'muted' }, 'Το PIN δεν αποθηκεύεται· κρατιέται μόνο ένα «αποτύπωμά» του που δεν γυρίζει πίσω. Αν το ξεχάσεις, οι κωδικοί B2B πρέπει να ξαναγραφτούν (όλα τα υπόλοιπα μένουν). Μετά από 5 λάθη μπαίνει αναμονή που διπλασιάζεται.'),
          h('div', { class: 'grid3' }, sec.pin ? field('Τρέχον PIN', cur) : null, field('Νέο PIN', p1, 'Τουλάχιστον 6 ψηφία ή χαρακτήρες· όχι 123456, 111111'), field('Επανάληψη', p2)),
          h('div', { class: 'row', style: { marginTop: '10px' } }, btn(sec.pin ? 'Αλλαγή PIN' : 'Ορισμός PIN', { cls: 'primary', icon: 'lock' }, setP))));
        if (sec.pin) {
          const curR = pw('τρέχον PIN');
          box.appendChild(h('div', { class: 'panel' }, h('h2', null, 'Αυτόματο κλείδωμα'),
            h('div', { class: 'row' }, h('span', null, 'Κλείδωμα μετά από'), mins, h('span', null, 'λεπτά χωρίς χρήση'),
              btn('Αποθήκευση', { cls: 'sm' }, () => POST('/api/security/minutes', { minutes: mins.value }).then((r) => { App.lockInfo = r; toast('Αποθηκεύτηκε.'); }).catch(fail)),
              btn('Κλείδωμα τώρα', { cls: 'sm', icon: 'lock' }, () => POST('/api/lock').finally(() => App.showLock())))));
          box.appendChild(h('div', { class: 'panel' }, h('h2', null, 'Αφαίρεση PIN'),
            h('p', { class: 'muted' }, 'Δεν συνιστάται. Οι κωδικοί B2B μένουν κρυπτογραφημένοι μόνο από τα Windows.'),
            h('div', { class: 'row' }, curR, btn('Αφαίρεση PIN', { cls: 'danger sm' }, async () => {
              if (!(await confirmBox('Αφαίρεση του PIN;', 'Το πρόγραμμα θα ανοίγει χωρίς PIN.', 'Αφαίρεση', true))) return;
              try { App.lockInfo = await POST('/api/security/remove', { current: curR.value }); toast('Το PIN αφαιρέθηκε.'); await App.refreshState(); App.route(); } catch (e) { fail(e); }
            }))));
        }
      }

      if (tab === 'data' && server) {
        const backups = admin ? await GET('/api/backups') : [];
        const theme = select([['', 'Όπως το σύστημα'], ['light', 'Ανοιχτό'], ['dark', 'Σκούρο']], localStorageGet('sfk-theme') || '', (v) => { localStorageSet('sfk-theme', v); applyTheme(); });
        box.appendChild(h('div', { class: 'panel' }, h('h2', null, 'Κοινά δεδομένα'),
          h('p', { class: 'muted' }, 'Το πρόγραμμα τρέχει σε διακομιστή: όλοι οι υπολογιστές βλέπουν και αλλάζουν τα ίδια δεδομένα, την ίδια στιγμή. Οι αυτόματες εργασίες (ανάγνωση sites, τιμοκατάλογοι, έρευνα αγοράς) γίνονται μία φορά, στον διακομιστή, και όχι σε κάθε υπολογιστή.'),
          h('p', { class: 'muted' }, 'Τα αρχεία (CSV για WooCommerce, Excel) κατεβαίνουν στον υπολογιστή που τα ζήτησε.')));
        if (admin) box.appendChild(h('div', { class: 'panel' }, h('h2', null, 'Αντίγραφα ασφαλείας'), h('p', { class: 'muted' }, 'Ένα αντίγραφο κάθε μέρα στον διακομιστή· κρατιούνται 14 μέρες.'),
          backups.length ? h('div', { class: 'chips' }, backups.map((d) => h('button', { type: 'button', class: 'chip', onclick: async () => { if (await confirmBox('Επαναφορά στις ' + d + ';', 'Ισχύει για όλους τους υπολογιστές. Τα τωρινά δεδομένα κρατιούνται σε ξεχωριστό αντίγραφο πριν την επαναφορά.', 'Επαναφορά', true)) POST('/api/backups/restore', { day: d }).then(async () => { toast('Έγινε επαναφορά.'); await App.refreshState(); App.go('today'); }).catch(fail); } }, d))) : h('p', { class: 'faint' }, 'Κανένα ακόμα.')));
        const cl = App.state.cloud;
        const db = cl && cl.where === 'βάση δεδομένων';
        if (cl && cl.enabled) box.appendChild(h('div', { class: 'panel' }, h('h2', null, icon('shield'), db ? ' Φύλαξη στη βάση δεδομένων' : ' Φύλαξη στο GitHub'),
          db ? h('p', { class: 'muted' }, `Τα δεδομένα φυλάγονται στην κοινή βάση PostgreSQL 30″ μετά από κάθε αλλαγή, με αριθμό έκδοσης (δύο αλλαγές την ίδια στιγμή δεν σβήνουν η μία την άλλη). Μέγεθος περίπου ${((cl.size || 0) / 1048576).toFixed(1).replace('.', ',')} MB από τα 500 MB του δωρεάν πακέτου. Αντίγραφο ασφαλείας στο GitHub μία φορά τη μέρα` + (cl.backupAt ? ` (τελευταίο ${fmt.ago(cl.backupAt)}).` : '.'))
            : h('p', { class: 'muted' }, `Ο δωρεάν διακομιστής σβήνει τον δίσκο του σε κάθε επανεκκίνηση: τα δεδομένα φυλάγονται στο ιδιωτικό αποθετήριο ${cl.repo} λίγα λεπτά μετά από κάθε αλλαγή και όταν σταματά.`),
          cl.error ? h('div', { class: 'note crit' }, cl.error) : h('div', { class: 'note ok' }, cl.savedAt ? 'Τελευταία φύλαξη: ' + fmt.ago(cl.savedAt) + (cl.pending ? ' · υπάρχουν νεότερες αλλαγές, φυλάγονται σε λίγο.' : ' · όλα φυλαγμένα.') : (cl.loadedAt ? 'Τα δεδομένα διαβάστηκαν ' + fmt.ago(cl.loadedAt) + '.' : 'Περιμένει την πρώτη αλλαγή.')),
          admin ? h('div', { class: 'row', style: { marginTop: '10px' } }, btn('Φύλαξη τώρα', { cls: 'sm', icon: 'upload' }, () => POST('/api/cloud/save').then(async (r) => { toast(r && r.error ? r.error : r && r.same ? 'Όλα ήταν ήδη φυλαγμένα.' : 'Φυλάχτηκαν.', r && r.error ? { err: true } : null); await App.refreshState(); App.route(); }).catch(fail))) : null));
        if (db && cl.tls === 'encrypted') box.appendChild(h('div', { class: 'note' }, 'Η σύνδεση με τη βάση είναι κρυπτογραφημένη, αλλά η ταυτότητα της βάσης δεν ελέγχεται με πιστοποιητικό. Για πλήρη προστασία: Supabase → Project Settings → Database → SSL Configuration → «Download certificate», και το κείμενό του στη μεταβλητή SFK_DB_CA του Render (DIAKOMISTIS-CLOUD.txt, ★★ βήμα 3).'));
        if (admin) box.appendChild(bundlePanel(true));
        box.appendChild(h('div', { class: 'panel' }, h('h2', null, 'Εμφάνιση'), h('div', { style: { maxWidth: '260px' } }, field('Θέμα', theme))));
        box.appendChild(h('div', { class: 'panel' }, h('h2', null, 'Πρόγραμμα'), h('p', { class: 'muted' }, 'Έκδοση ' + App.state.version + ' · λειτουργία διακομιστή.')));
      }

      if (tab === 'data' && !server) {
        const st = App.state;
        const target = inp('', { placeholder: 'π.χ. C:\\Users\\…\\OneDrive\\SF-Kentro' });
        const backups = await GET('/api/backups');
        const theme = select([['', 'Όπως τα Windows'], ['light', 'Ανοιχτό'], ['dark', 'Σκούρο']], localStorageGet('sfk-theme') || '', (v) => { localStorageSet('sfk-theme', v); applyTheme(); });
        box.appendChild(h('div', { class: 'panel' }, h('h2', null, 'Φάκελος δεδομένων'),
          h('p', null, h('span', { class: 'mono' }, st.dataDir)),
          h('div', { class: 'row' }, btn('Άνοιγμα φακέλου', { icon: 'folder' }, () => POST('/api/open', { kind: 'data' })), btn('Φάκελος αρχείων', { icon: 'folder' }, () => POST('/api/open', { kind: 'exports' }))),
          h('div', { class: 'note warn', style: { marginTop: '14px' } }, h('b', null, 'Κοινά δεδομένα σε πολλούς υπολογιστές και κινητά; '), 'Ένας κοινός φάκελος (OneDrive) δουλεύει μόνο με έναν υπολογιστή ανοιχτό κάθε φορά — αλλιώς χάνονται αλλαγές. Για ταυτόχρονη δουλειά από όλα τα PC, τα δύο μαγαζιά και το κινητό: Ρυθμίσεις → Κινητό (δωρεάν).'),
          h('div', { class: 'stack s', style: { marginTop: '14px' } }, h('div', { class: 'muted' }, 'Μετακίνηση σε άλλο φάκελο — π.χ. στο OneDrive (ένας υπολογιστής κάθε φορά).'),
            h('div', { class: 'row' }, target, btn('Μετακίνηση', {}, async () => { try { const r = await POST('/api/datadir', { path: target.value }); toast(r.usedExisting ? 'Συνδέθηκε με τα δεδομένα που υπήρχαν ήδη εκεί.' : 'Τα δεδομένα αντιγράφηκαν στον νέο φάκελο.'); await App.refreshState(); App.route(); } catch (e) { fail(e); } })))));
        box.appendChild(h('div', { class: 'panel' }, h('h2', null, 'Αντίγραφα ασφαλείας'), h('p', { class: 'muted' }, 'Ένα αντίγραφο κάθε μέρα που ανοίγει το πρόγραμμα· κρατιούνται 14 μέρες.'),
          backups.length ? h('div', { class: 'chips' }, backups.map((d) => h('button', { type: 'button', class: 'chip', onclick: async () => { if (await confirmBox('Επαναφορά στις ' + d + ';', 'Τα τωρινά δεδομένα κρατιούνται σε ξεχωριστό αντίγραφο πριν την επαναφορά.', 'Επαναφορά', true)) POST('/api/backups/restore', { day: d }).then(async () => { toast('Έγινε επαναφορά.'); await App.refreshState(); App.go('today'); }).catch(fail); } }, d))) : h('p', { class: 'faint' }, 'Κανένα ακόμα.')));
        box.appendChild(bundlePanel(false));
        box.appendChild(h('div', { class: 'panel' }, h('h2', null, 'Εμφάνιση'), h('div', { style: { maxWidth: '260px' } }, field('Θέμα', theme))));
        box.appendChild(h('div', { class: 'panel' }, h('h2', null, 'Πρόγραμμα'), h('p', { class: 'muted' }, 'Έκδοση ' + st.version + '. Το πρόγραμμα τρέχει μόνο σε αυτόν τον υπολογιστή και δεν στέλνει δεδομένα πουθενά, εκτός από την ανάγνωση των δημόσιων σελίδων των sites και των ανταγωνιστών.'),
          btn('Κλείσιμο προγράμματος', { cls: 'danger', icon: 'power' }, async () => { if (await confirmBox('Κλείσιμο του προγράμματος;', 'Για να το ξανανοίξεις, τρέξε πάλι το SF-Kentro.exe.', 'Κλείσιμο', true)) { await POST('/api/shutdown').catch(() => {}); document.body.innerHTML = '<div style="padding:60px;font:16px system-ui">Το πρόγραμμα έκλεισε. Μπορείς να κλείσεις αυτό το παράθυρο.</div>'; } })));
      }
    },
  };

  /** "iPhone · Safari", "Windows · Edge": enough to recognise a device in the list. */
  function deviceOf(ua) {
    const u = String(ua || '');
    const os = /iPhone/.test(u) ? 'iPhone' : /iPad/.test(u) ? 'iPad' : /Android/.test(u) ? 'Android' : /Windows/.test(u) ? 'Windows' : /Mac OS X/.test(u) ? 'Mac' : /Linux/.test(u) ? 'Linux' : 'Συσκευή';
    const br = /Edg\//.test(u) ? 'Edge' : /OPR\//.test(u) ? 'Opera' : /Firefox\//.test(u) ? 'Firefox' : /CriOS|Chrome\//.test(u) ? 'Chrome' : /Safari\//.test(u) ? 'Safari' : '';
    return br ? os + ' · ' + br : os;
  }

  /** Settings → Phone: where phones and the other PCs connect, a QR to scan, and the home-screen steps. */
  async function phoneTab(box, server, admin) {
    if (!server) {
      box.appendChild(h('div', { class: 'panel' }, h('h2', null, icon('phone'), ' Από κινητό και από τους άλλους υπολογιστές'),
        h('p', null, 'Τώρα το πρόγραμμα ανοίγει μόνο σε αυτόν τον υπολογιστή (έτσι είναι πιο ασφαλές). Για να μπαίνουν και τα κινητά και τα άλλα PC, με τα ίδια δεδομένα την ίδια στιγμή, το πρόγραμμα τρέχει ως «διακομιστής». Είναι δωρεάν.'),
        h('ol', { class: 'steps' },
          h('li', null, 'Κλείσε το πρόγραμμα (Ρυθμίσεις → Δεδομένα → Κλείσιμο προγράμματος).'),
          h('li', null, 'Άνοιξε το ', h('b', null, 'SF-Kentro-Server.cmd'), ' από τον ίδιο φάκελο. Τα δεδομένα είναι τα ίδια: δεν μεταφέρεις τίποτα.'),
          h('li', null, 'Τα Windows ρωτάνε για το τείχος προστασίας: «Ιδιωτικά δίκτυα» → «Να επιτρέπεται».'),
          h('li', null, 'Την πρώτη φορά φτιάχνεις τον λογαριασμό σου με τον κωδικό που γράφει το μαύρο παράθυρο.'),
          h('li', null, 'Έλα ξανά εδώ (Ρυθμίσεις → Κινητό): θα δεις το QR που σκανάρεις με το κινητό.')),
        h('div', { class: 'note', style: { marginTop: '12px' } }, h('b', null, 'Έτσι δουλεύει μέσα στο Wi-Fi του μαγαζιού και όσο είναι ανοιχτός αυτός ο υπολογιστής. '), 'Για να ανοίγει από το άλλο μαγαζί και από το σπίτι, με όλα τα PC κλειστά, υπάρχει δωρεάν διακομιστής στο cloud: οδηγίες στο αρχείο DIAKOMISTIS-CLOUD.txt.')));
      return;
    }
    const c = await GET('/api/connect');
    const kindOf = (u) => (/^https:/.test(u) ? 'internet' : /^http:\/\/100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(u) ? 'tailscale' : 'lan');
    const KIND = {
      internet: ['Από παντού', 'Από κάθε κινητό και υπολογιστή, μέσα κι έξω από τα μαγαζιά, κρυπτογραφημένα (https).'],
      lan: ['Μέσα στο μαγαζί (Wi-Fi)', 'Από κινητά και PC στο ίδιο δίκτυο με τον υπολογιστή-διακομιστή, όσο αυτός είναι ανοιχτός. Όχι από Wi-Fi επισκεπτών ή από τα δεδομένα του κινητού.'],
      tailscale: ['Μέσω Tailscale', 'Από συσκευές με την εφαρμογή Tailscale ανοιχτή, στον ίδιο λογαριασμό.'],
    };
    const seen = new Set(), list = [];
    const addUrl = (x) => { if (!seen.has(x.url)) { seen.add(x.url); list.push(x); } };
    if (!/^(localhost|127\.\d+\.\d+\.\d+|\[::1\])$/.test(location.hostname)) addUrl({ url: location.origin + '/', kind: kindOf(location.origin), here: true });
    for (const x of c.urls || []) addUrl(x);
    const cards = h('div', { class: 'qr-list' });
    for (const x of list) {
      const qr = h('div', { class: 'qr-box' });
      GET('/api/qr?text=' + encodeURIComponent(x.url)).then((m) => qr.appendChild(App.qrSvg(m, 176))).catch(() => qr.appendChild(h('span', { class: 'faint' }, 'Χωρίς QR')));
      const [title, text] = KIND[x.kind] || KIND.lan;
      cards.appendChild(h('div', { class: 'qr-card' }, qr, h('div', { class: 'qr-info' },
        h('div', { class: 'qr-kind' }, title, x.here ? h('span', { class: 'pill' }, 'αυτή που χρησιμοποιείς τώρα') : null),
        h('div', { class: 'qr-url mono' }, x.url),
        h('p', { class: 'muted' }, text),
        h('div', { class: 'row tight' }, btn('Αντιγραφή', { cls: 'sm', icon: 'copy' }, () => App.copyText(x.url)),
          navigator.share && window.isSecureContext ? btn('Αποστολή', { cls: 'sm', icon: 'mail' }, () => navigator.share({ title: 'SF Κέντρο', url: x.url }).catch(() => {})) : null))));
    }
    const onlyShop = list.length && list.every((x) => x.kind !== 'internet');
    box.appendChild(h('div', { class: 'panel' }, h('h2', null, icon('phone'), ' Σύνδεση από κινητό ή άλλον υπολογιστή'),
      list.length ? cards : h('div', { class: 'note warn' }, 'Δεν βρέθηκε δίκτυο σε αυτόν τον υπολογιστή. Σύνδεσέ τον στο Wi-Fi ή στο καλώδιο του μαγαζιού και άνοιξε ξανά αυτή τη σελίδα.'),
      onlyShop ? h('div', { class: 'note', style: { marginTop: '12px' } }, h('b', null, 'Μόνο μέσα στο μαγαζί και όσο είναι ανοιχτός ο υπολογιστής-διακομιστής. '), 'Για να ανοίγει από παντού (άλλο μαγαζί, σπίτι) με όλα τα PC κλειστά: δωρεάν διακομιστής στο cloud, οδηγίες στο DIAKOMISTIS-CLOUD.txt.') : null));
    box.appendChild(h('div', { class: 'panel' }, h('h2', null, 'Στο κινητό, μία φορά'),
      h('ol', { class: 'steps' },
        h('li', null, h('b', null, 'Σκάναρε το QR'), ' με την κάμερα του κινητού (ή γράψε τη διεύθυνση στον browser).'),
        h('li', null, h('b', null, 'Συνδέσου'), ' με το όνομα και τον κωδικό σου και τσέκαρε «Μείνε συνδεδεμένος σε αυτή τη συσκευή»: μένεις μέσα ως 30 μέρες χωρίς χρήση. Μόνο στο δικό σου κινητό.'),
        h('li', null, h('b', null, 'Βάλ’ το στην αρχική οθόνη'), ' για να ανοίγει σαν εφαρμογή:',
          h('div', { class: 'os-steps' },
            h('div', null, h('b', null, 'iPhone (Safari): '), 'κουμπί Κοινοποίηση (τετράγωνο με βέλος) → «Προσθήκη στην οθόνη Αφετηρίας».'),
            h('div', null, h('b', null, 'Android (Chrome): '), 'μενού ⋮ → «Εγκατάσταση εφαρμογής» ή «Προσθήκη στην αρχική οθόνη».')))),
      App.installPrompt ? h('div', { class: 'row', style: { marginTop: '12px' } }, btn('Εγκατάσταση σε αυτή τη συσκευή', { cls: 'primary', icon: 'download' }, async () => {
        const e = App.installPrompt; App.installPrompt = null;
        try { e.prompt(); await e.userChoice; } catch (_) { /* dismissed */ }
        App.route();
      })) : null,
      App.installed() ? h('div', { class: 'note ok', style: { marginTop: '12px' } }, icon('check'), ' Εδώ το έχεις ήδη ανοιχτό σαν εφαρμογή.') : null,
      h('p', { class: 'muted', style: { marginTop: '12px' } }, 'Όλα είναι συγχρονισμένα: ό,τι αλλάζει από ένα κινητό ή PC φαίνεται αμέσως σε όλα, και όταν ξανανοίγεις την εφαρμογή ενημερώνεται μόνη της.')));
    box.appendChild(h('div', { class: 'panel' }, h('h2', null, icon('shield'), ' Αν χαθεί ένα κινητό'),
      h('p', { class: 'muted' }, admin ? 'Ρυθμίσεις → Χρήστες → «Ανοιχτές συνδέσεις»: «Αποσύνδεση» δίπλα στη συσκευή, και άλλαξε τον κωδικό του χρήστη.' : 'Πες το αμέσως στον διαχειριστή: αποσυνδέει τη συσκευή από τις Ρυθμίσεις → Χρήστες. Και άλλαξε τον κωδικό σου (Ρυθμίσεις → Χρήστες).'),
      admin ? h('div', { class: 'row' }, btn('Ανοιχτές συνδέσεις', { cls: 'sm', icon: 'user' }, () => App.go('settings', { tab: 'users' }))) : null));
  }

  /** All the data in one file: to keep a copy somewhere else, or to move to another PC / to the server. */
  function bundlePanel(server) {
    const res = h('div');
    const file = h('input', { type: 'file', accept: '.gz,application/gzip', style: { display: 'none' }, onchange: async () => {
      const f = file.files[0];
      file.value = '';
      if (!f) return;
      if (!(await confirmBox('Επαναφορά από αρχείο;', `Αρχείο: ${f.name}. ` + (server ? 'Ισχύει για όλους τους υπολογιστές και τα κινητά. ' : '') + 'Τα τωρινά δεδομένα κρατιούνται σε ξεχωριστό αντίγραφο πριν την επαναφορά. Οι κωδικοί B2B από άλλον υπολογιστή δεν ανοίγουν εδώ: ξαναγράφονται στους αντιπροσώπους.', 'Επαναφορά', true))) return;
      try {
        clear(res).appendChild(h('div', { class: 'note' }, 'Ανεβαίνει…'));
        const r = await POST('/api/backup/upload', { base64: await App.fileToBase64(f) });
        clear(res).appendChild(h('div', { class: 'note ok' }, `Έγινε επαναφορά: ${r.files} αρχεία${r.at ? ' (αντίγραφο της ' + fmt.dateTime(r.at) + ')' : ''}.`));
        await App.refreshState();
        toast('Τα δεδομένα επανήλθαν από το αρχείο.');
      } catch (e) { clear(res); fail(e); }
    } });
    return h('div', { class: 'panel' }, h('h2', null, 'Αντίγραφο σε ένα αρχείο'),
      h('p', { class: 'muted' }, server ? 'Όλα τα δεδομένα σε ένα αρχείο, στον υπολογιστή σου. Κατέβαζε ένα κάθε εβδομάδα και κράτα το εκτός διακομιστή (π.χ. σε USB ή OneDrive).' : 'Όλα τα δεδομένα σε ένα αρχείο: για ένα αντίγραφο εκτός υπολογιστή (USB, OneDrive) ή για μεταφορά στον διακομιστή.'),
      h('div', { class: 'row' },
        btn('Λήψη αντιγράφου', { cls: 'primary', icon: 'download' }, async () => {
          try {
            const r = await POST('/api/backup/make');
            const size = r.size > 1048576 ? (r.size / 1048576).toFixed(1).replace('.', ',') + ' MB' : Math.max(1, Math.round(r.size / 1024)) + ' KB';
            await App.openFile(r);
            toast(server ? `Κατεβαίνει: ${r.files} αρχεία, ${size}.` : `Έτοιμο (${r.files} αρχεία, ${size}): είναι στον φάκελο αρχείων που άνοιξε. Αντέγραψέ το σε USB ή OneDrive.`, { ms: 7000 });
          } catch (e) { fail(e); }
        }),
        btn('Επαναφορά από αρχείο…', { icon: 'upload' }, () => file.click()), file),
      res);
  }

  function localStorageGet(k) { try { return localStorage.getItem(k); } catch (_) { return null; } }
  function localStorageSet(k, v) { try { if (v) localStorage.setItem(k, v); else localStorage.removeItem(k); } catch (_) { /* ignore */ } }
  function applyTheme() { const t = localStorageGet('sfk-theme'); if (t) document.documentElement.setAttribute('data-theme', t); else document.documentElement.removeAttribute('data-theme'); }
  App.applyTheme = applyTheme;
})();
