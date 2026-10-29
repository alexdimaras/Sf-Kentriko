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
      const tabs = [['sites', 'Sites'], ['prices', 'Τιμές'], ['ads', 'Όπλα και διαφημίσεις'], ['new', 'Νέα προϊόντα'], ['cats', 'Κατηγορίες'], ['ai', 'AI'], server ? ['users', 'Χρήστες'] : null, ['security', 'Ασφάλεια'], ['data', 'Δεδομένα']].filter(Boolean);
      main.appendChild(h('div', { class: 'tabs' }, tabs.map(([k, l]) => h('button', { 'aria-selected': String(k === tab), onclick: () => App.go('settings', { tab: k }) }, l))));
      const box = h('div', { class: 'stack' });
      main.appendChild(box);
      if (!admin && tab !== 'users' && tab !== 'data') box.appendChild(h('div', { class: 'note' }, 'Τις ρυθμίσεις τις αλλάζει μόνο ο διαχειριστής. Εδώ τις βλέπεις.'));
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
          h('div', { style: { marginTop: '10px' } }, field('Κείμενο στο τέλος της αυτόματης περιγραφής', footer))));
        box.appendChild(h('div', { class: 'grid2' }, ['sf', 'st'].map((site) => h('div', { class: 'panel' }, h('h2', null, siteName(site)),
          h('div', { class: 'stack s' }, field('Πρόσθετο SEO', seo[site], 'Για meta description και λέξη-κλειδί στο αρχείο.'), field('Ιδιότητα μάρκας', attrs[site].brand), field('Ιδιότητα μεγέθους', attrs[site].size), field('Ιδιότητα χρώματος', attrs[site].color))))));
        box.appendChild(saveBtn(() => ({ newProduct: { status: status.value, titleTag: tag.value, footer: footer.value }, seo: { sf: seo.sf.value, st: seo.st.value }, attributes: { sf: { brand: attrs.sf.brand.value, size: attrs.sf.size.value, color: attrs.sf.color.value }, st: { brand: attrs.st.brand.value, size: attrs.st.size.value, color: attrs.st.color.value } } })));
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
        const res = h('div');
        box.appendChild(h('div', { class: 'panel' }, h('h2', null, 'Δωρεάν AI (προαιρετικό)'),
          h('p', { class: 'muted' }, 'Για περιγραφές όταν δεν υπάρχει επίσημο κείμενο, ή μετάφραση αγγλικών κειμένων. Χρειάζεται το δωρεάν πρόγραμμα Ollama και υπολογιστή με τουλάχιστον 16 GB μνήμη. Χωρίς αυτό, όλα τα υπόλοιπα δουλεύουν κανονικά.'),
          h('div', { class: 'note', style: { marginBottom: '10px' } }, h('b', null, 'Δεν χρειάζεται σε κάθε υπολογιστή. '), server
            ? 'Το AI το καλεί ο διακομιστής, όχι ο browser: αρκεί ΕΝΑ Ollama, στον διακομιστή ή σε έναν δυνατό υπολογιστή που ο διακομιστής φτάνει (γράψε εδώ τη διεύθυνσή του).'
            : 'Το καλεί το πρόγραμμα, όχι ο browser: αρκεί ΕΝΑΣ δυνατός υπολογιστής με Ollama. Στους άλλους γράψε εδώ τη διεύθυνσή του (π.χ. http://192.168.1.20:11434) — σε εκείνον το Ollama ξεκινά με OLLAMA_HOST=0.0.0.0. Με τη λειτουργία διακομιστή ρυθμίζεται μία φορά για όλους.'),
          h('ol', { class: 'steps' }, h('li', null, 'Κατέβασε και εγκατάστησε το Ollama από το ollama.com.'), h('li', null, 'Άνοιξε τη γραμμή εντολών και γράψε: ollama pull qwen2.5:7b'), h('li', null, 'Ενεργοποίησε εδώ και πάτα «Δοκιμή».')),
          h('div', { class: 'grid3', style: { marginTop: '12px' } }, field('Διεύθυνση', url), field('Μοντέλο', model, 'Κενό = το πρώτο εγκατεστημένο')),
          h('label', { class: 'check', style: { marginTop: '10px' } }, en, 'Ενεργό'),
          h('div', { class: 'row', style: { marginTop: '10px' } }, btn('Δοκιμή', { cls: 'sm' }, async () => {
            clear(res).appendChild(h('span', { class: 'muted' }, 'Δοκιμή…'));
            try { await POST('/api/settings', { localAI: { enabled: en.checked, url: url.value, model: model.value } }); const r = await GET('/api/ai/status'); clear(res).appendChild(h('div', { class: 'note ok' }, 'Βρέθηκε. Μοντέλα: ' + (r.models.join(', ') || 'κανένα — τρέξε ollama pull'))); } catch (e) { clear(res).appendChild(h('div', { class: 'note crit' }, e.message)); }
          })), res));
        box.appendChild(saveBtn(() => ({ localAI: { enabled: en.checked, url: url.value, model: model.value } })));
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
          const tb = h('tbody');
          for (const u of data.users) {
            tb.appendChild(h('tr', null, h('td', { class: 'title' }, u.name, h('div', { class: 'faint', style: { fontWeight: 400 } }, u.user)),
              h('td', null, select([['staff', 'Χρήστης'], ['admin', 'Διαχειριστής']], u.role, (v) => POST('/api/users', { id: u.id, role: v }).then(() => toast('Αποθηκεύτηκε.')).catch((e) => { fail(e); App.route(); }))),
              h('td', null, u.lastLoginAt ? fmt.ago(u.lastLoginAt) : 'ποτέ'),
              h('td', null, h('div', { class: 'row tight' },
                btn('Νέος κωδικός', { cls: 'sm' }, async () => {
                  const pw = prompt('Νέος κωδικός για ' + u.name + ' (τουλάχιστον 10 χαρακτήρες):');
                  if (pw) POST('/api/users', { id: u.id, password: pw }).then(() => toast('Ο κωδικός άλλαξε· οι συνδέσεις του έκλεισαν.')).catch(fail);
                }),
                u.id !== me.id ? btn('Διαγραφή', { cls: 'sm ghost danger' }, async () => { if (await confirmBox('Διαγραφή του ' + u.name + ';', 'Δεν θα μπορεί να συνδεθεί.', 'Διαγραφή', true)) POST('/api/users/delete', { id: u.id }).then(() => App.route()).catch(fail); }) : null))));
          }
          const nu = { name: h('input', { type: 'text' }), user: h('input', { type: 'text', autocapitalize: 'none', spellcheck: 'false' }), pw: h('input', { type: 'password', autocomplete: 'new-password' }), role: select([['staff', 'Χρήστης'], ['admin', 'Διαχειριστής']], 'staff', null) };
          box.appendChild(h('div', { class: 'panel' }, h('h2', null, 'Χρήστες'),
            h('p', { class: 'muted' }, 'Κάθε άτομο με δικό του όνομα και κωδικό. Ο «Χρήστης» κάνει όλη τη δουλειά· ο «Διαχειριστής» αλλάζει και ρυθμίσεις, ασφάλεια και χρήστες.'),
            h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl' }, h('thead', null, h('tr', null, h('th', null, 'Όνομα'), h('th', null, 'Ρόλος'), h('th', null, 'Τελευταία σύνδεση'), h('th', null, ''))), tb)),
            h('h3', { style: { margin: '16px 0 8px', fontSize: '15px' } }, 'Νέος χρήστης'),
            h('div', { class: 'grid3' }, field('Ονοματεπώνυμο', nu.name), field('Όνομα χρήστη', nu.user, 'Λατινικά, π.χ. maria'), field('Κωδικός', nu.pw, 'Τουλάχιστον 10 χαρακτήρες')),
            h('div', { class: 'row', style: { marginTop: '10px' } }, nu.role, btn('Προσθήκη', { cls: 'primary', icon: 'new' }, () => POST('/api/users', { name: nu.name.value, user: nu.user.value, password: nu.pw.value, role: nu.role.value }).then(() => { toast('Ο χρήστης προστέθηκε.'); App.route(); }).catch(fail)))));
          const sb = h('tbody');
          for (const x of data.sessions) sb.appendChild(h('tr', null, h('td', null, x.user), h('td', null, fmt.ago(x.lastSeen)), h('td', { class: 'mono' }, x.ip), h('td', { class: 'faint', style: { fontSize: '12px' } }, x.ua)));
          box.appendChild(h('div', { class: 'panel' }, h('h2', null, 'Ανοιχτές συνδέσεις'),
            h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl' }, h('thead', null, h('tr', null, h('th', null, 'Χρήστης'), h('th', null, 'Τελευταία κίνηση'), h('th', null, 'Διεύθυνση'), h('th', null, 'Browser'))), sb)),
            h('div', { class: 'row', style: { marginTop: '10px' } }, btn('Αποσύνδεση όλων', { cls: 'danger sm' }, async () => { if (await confirmBox('Αποσύνδεση όλων των υπολογιστών;', 'Όλοι (και εσύ) θα χρειαστεί να συνδεθούν ξανά.', 'Αποσύνδεση', true)) POST('/api/users/logout-all').then(() => location.reload()).catch(fail); }))));
        }
      }

      if (tab === 'security' && server) {
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
        if (admin) box.appendChild(h('div', { class: 'panel' }, h('h2', null, 'Αντίγραφα ασφαλείας'), h('p', { class: 'muted' }, 'Ένα αντίγραφο κάθε μέρα στον διακομιστή· κρατιούνται 14 μέρες. Κράτα και ένα αντίγραφο του φακέλου δεδομένων εκτός διακομιστή.'),
          backups.length ? h('div', { class: 'chips' }, backups.map((d) => h('button', { type: 'button', class: 'chip', onclick: async () => { if (await confirmBox('Επαναφορά στις ' + d + ';', 'Ισχύει για όλους τους υπολογιστές. Τα τωρινά δεδομένα κρατιούνται σε ξεχωριστό αντίγραφο πριν την επαναφορά.', 'Επαναφορά', true)) POST('/api/backups/restore', { day: d }).then(async () => { toast('Έγινε επαναφορά.'); await App.refreshState(); App.go('today'); }).catch(fail); } }, d))) : h('p', { class: 'faint' }, 'Κανένα ακόμα.')));
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
          h('div', { class: 'note warn', style: { marginTop: '14px' } }, h('b', null, 'Κοινά δεδομένα σε πολλούς υπολογιστές; '), 'Ένας κοινός φάκελος (OneDrive) δουλεύει μόνο με έναν υπολογιστή ανοιχτό κάθε φορά — αλλιώς χάνονται αλλαγές. Για ταυτόχρονη δουλειά από όλα τα PC (και τα δύο μαγαζιά) χρησιμοποίησε τη λειτουργία διακομιστή: δες το αρχείο DIAKOMISTIS-CLOUD.txt.'),
          h('div', { class: 'stack s', style: { marginTop: '14px' } }, h('div', { class: 'muted' }, 'Μετακίνηση σε άλλο φάκελο — π.χ. στο OneDrive (ένας υπολογιστής κάθε φορά).'),
            h('div', { class: 'row' }, target, btn('Μετακίνηση', {}, async () => { try { const r = await POST('/api/datadir', { path: target.value }); toast(r.usedExisting ? 'Συνδέθηκε με τα δεδομένα που υπήρχαν ήδη εκεί.' : 'Τα δεδομένα αντιγράφηκαν στον νέο φάκελο.'); await App.refreshState(); App.route(); } catch (e) { fail(e); } })))));
        box.appendChild(h('div', { class: 'panel' }, h('h2', null, 'Αντίγραφα ασφαλείας'), h('p', { class: 'muted' }, 'Ένα αντίγραφο κάθε μέρα που ανοίγει το πρόγραμμα· κρατιούνται 14 μέρες.'),
          backups.length ? h('div', { class: 'chips' }, backups.map((d) => h('button', { type: 'button', class: 'chip', onclick: async () => { if (await confirmBox('Επαναφορά στις ' + d + ';', 'Τα τωρινά δεδομένα κρατιούνται σε ξεχωριστό αντίγραφο πριν την επαναφορά.', 'Επαναφορά', true)) POST('/api/backups/restore', { day: d }).then(async () => { toast('Έγινε επαναφορά.'); await App.refreshState(); App.go('today'); }).catch(fail); } }, d))) : h('p', { class: 'faint' }, 'Κανένα ακόμα.')));
        box.appendChild(h('div', { class: 'panel' }, h('h2', null, 'Εμφάνιση'), h('div', { style: { maxWidth: '260px' } }, field('Θέμα', theme))));
        box.appendChild(h('div', { class: 'panel' }, h('h2', null, 'Πρόγραμμα'), h('p', { class: 'muted' }, 'Έκδοση ' + st.version + '. Το πρόγραμμα τρέχει μόνο σε αυτόν τον υπολογιστή και δεν στέλνει δεδομένα πουθενά, εκτός από την ανάγνωση των δημόσιων σελίδων των sites και των ανταγωνιστών.'),
          btn('Κλείσιμο προγράμματος', { cls: 'danger', icon: 'power' }, async () => { if (await confirmBox('Κλείσιμο του προγράμματος;', 'Για να το ξανανοίξεις, τρέξε πάλι το SF-Kentro.exe.', 'Κλείσιμο', true)) { await POST('/api/shutdown').catch(() => {}); document.body.innerHTML = '<div style="padding:60px;font:16px system-ui">Το πρόγραμμα έκλεισε. Μπορείς να κλείσεις αυτό το παράθυρο.</div>'; } })));
      }
    },
  };

  function localStorageGet(k) { try { return localStorage.getItem(k); } catch (_) { return null; } }
  function localStorageSet(k, v) { try { if (v) localStorage.setItem(k, v); else localStorage.removeItem(k); } catch (_) { /* ignore */ } }
  function applyTheme() { const t = localStorageGet('sfk-theme'); if (t) document.documentElement.setAttribute('data-theme', t); else document.documentElement.removeAttribute('data-theme'); }
  App.applyTheme = applyTheme;
})();
