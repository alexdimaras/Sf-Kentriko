/* Αντιπρόσωποι — suppliers, price lists, orders */
'use strict';
(function () {
  const { h, clear, btn, icon, fmt, GET, POST, toast, fail, drawer, modal, dlgHead, thumb, select, pageHead, siteName, sitePill, debounce, fileReady, fileToBase64, dropZone, confirmBox, copyText, watchJob } = App;
  const STATUS = { draft: ['Πρόχειρη', ''], sent: ['Στάλθηκε', 'med'], received: ['Παραλήφθηκε', 'ok'], cancelled: ['Ακυρώθηκε', ''] };

  App.views.suppliers = {
    async render(main, p) {
      const tab = p.tab === 'orders' ? 'orders' : p.tab === 'find' ? 'find' : 'list';
      main.appendChild(pageHead('Αντιπρόσωποι', 'Ποιος φέρνει κάθε μάρκα, σε πόσες μέρες, με τι όρους. Τιμοκατάλογοι και παραγγελίες σε ένα σημείο.', [
        btn('Νέα παραγγελία', { icon: 'mail' }, () => orderEditor(null)),
        btn('Νέος αντιπρόσωπος', { cls: 'primary', icon: 'new' }, () => editSupplier(null)),
      ]));
      main.appendChild(h('div', { class: 'tabs', role: 'tablist' },
        h('button', { role: 'tab', 'aria-selected': String(tab === 'list'), onclick: () => App.go('suppliers') }, 'Αντιπρόσωποι'),
        h('button', { role: 'tab', 'aria-selected': String(tab === 'find'), onclick: () => App.go('suppliers', { tab: 'find' }) }, 'Προτάσεις νέων αντιπροσώπων'),
        h('button', { role: 'tab', 'aria-selected': String(tab === 'orders'), onclick: () => App.go('suppliers', { tab: 'orders' }) }, 'Παραγγελίες')));
      if (tab === 'orders') return renderOrders(main);
      if (tab === 'find') return renderFind(main, p);
      const data = await GET('/api/suppliers');
      if (!data.suppliers.length) {
        main.appendChild(h('div', { class: 'panel empty' }, h('h3', null, 'Δεν έχεις περάσει αντιπροσώπους'),
          h('p', null, 'Για κάθε αντιπρόσωπο: όνομα, τηλέφωνο, email, τις μάρκες που φέρνει και σε πόσες μέρες παραδίδει. Από τις μάρκες το πρόγραμμα ξέρει αυτόματα από πού έρχεται κάθε προϊόν.'),
          btn('Πρώτος αντιπρόσωπος', { cls: 'primary', icon: 'new' }, () => editSupplier(null))));
      } else {
        const tb = h('tbody');
        for (const s of data.suppliers) {
          tb.appendChild(h('tr', { class: 'click', onclick: () => openSupplier(s.id) },
            h('td', { class: 'title' }, s.name, s.active === false ? h('span', { class: 'pill', style: { marginLeft: '8px' } }, 'Ανενεργός') : null, s.contact ? h('div', { class: 'faint', style: { fontWeight: 400 } }, s.contact) : null),
            h('td', null, h('div', { class: 'chips' }, (s.brands || []).slice(0, 6).map((b) => h('span', { class: 'pill' }, b)), (s.brands || []).length > 6 ? h('span', { class: 'faint' }, '+' + (s.brands.length - 6)) : null)),
            h('td', null, s.phone || s.mobile || '', s.email ? h('div', { class: 'faint' }, s.email) : null),
            h('td', { class: 'num' }, s.leadDays ? fmt.plural(s.leadDays, 'μέρα', 'μέρες') : '—'),
            h('td', { class: 'num' }, fmt.num(s.products.sf), h('span', { class: 'faint' }, ' / ' + fmt.num(s.products.st))),
            h('td', null, s.pricelist ? h('span', null, fmt.num(s.pricelist.items) + ' κωδικοί', h('div', { class: 'faint' }, fmt.ago(s.pricelist.importedAt))) : h('span', { class: 'faint' }, '—'),
              s.catalogMode === 'b2b' ? h('div', null, h('span', { class: 'badge ok' }, 'B2B αυτόματα')) : s.catalogMode === 'public' ? h('div', null, h('span', { class: 'badge ok' }, 'Κατάλογος αυτόματα')) : s.feedUrl ? h('div', null, h('span', { class: 'badge' }, 'Feed')) : null)));
        }
        main.appendChild(h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl' }, h('thead', null, h('tr', null, h('th', null, 'Αντιπρόσωπος'), h('th', null, 'Μάρκες'), h('th', null, 'Επικοινωνία'), h('th', { class: 'num' }, 'Παράδοση'), h('th', { class: 'num' }, 'Προϊόντα SF / ΣΤ'), h('th', null, 'Τιμοκατάλογος'))), tb)));
        if (data.clashes.length) main.appendChild(h('div', { class: 'note warn', style: { marginTop: '12px' } }, 'Μάρκες σε περισσότερους από έναν αντιπρόσωπους (μετράει ο πρώτος): ' + data.clashes.map((c) => c.brand).join(', ')));
      }
      // Unassigned brands helper
      const assigned = new Set(data.suppliers.flatMap((s) => (s.brands || []).map((b) => b.toUpperCase())));
      const free = data.brands.filter((b) => !assigned.has(b.name.toUpperCase()));
      if (free.length) {
        main.appendChild(h('div', { class: 'section-title' }, h('h2', null, 'Μάρκες χωρίς αντιπρόσωπο'), h('span', { class: 'faint' }, 'πάτα μια μάρκα για να τη δώσεις σε αντιπρόσωπο'),
          btn('Βρες αντιπροσώπους αυτόματα', { cls: 'sm', icon: 'search' }, () => App.go('suppliers', { tab: 'find' }))));
        main.appendChild(h('div', { class: 'panel' }, h('div', { class: 'chips' }, free.slice(0, 120).map((b) => h('button', { type: 'button', class: 'chip', onclick: () => assignBrand(b.name, data.suppliers) }, `${b.name} · ${b.sf + b.st}`)))));
      }
      if (p.id) openSupplier(p.id, p.tab === 'pricelist' ? 'pricelist' : 'info');
    },
  };

  // ---------- suggestions: suppliers found automatically, for approval ----------
  const CONF = { high: ['Σίγουρη', 'ok'], medium: ['Πιθανή', 'med'], low: ['Αδύναμη', ''] };
  const openUrl = (url) => POST('/api/open', { kind: 'url', url }).catch(fail);
  async function renderFind(main, p) {
    const d = await GET('/api/supplierfind');
    const filter = p.f || 'found';
    const runBtn = (label, body, cls) => btn(label, { cls: cls || 'sm', icon: 'search' }, () => POST('/api/supplierfind/run', body || {}).then((job) => {
      toast('Η αναζήτηση ξεκίνησε· συνεχίζει στο παρασκήνιο, μπορείς να δουλεύεις κανονικά.');
      watchJob(job, { done: (r) => { toast(r ? `Αναζήτηση αντιπροσώπων: ${r.searched} μάρκες, βρέθηκαν προτάσεις για ${r.found}.${r.blocked ? ' ' + r.blocked.msg : ''}` : 'Ολοκληρώθηκε.', { ms: 9000 }); if (App.parseHash().view === 'suppliers') App.route(); } });
    }).catch(fail));
    main.appendChild(h('div', { class: 'panel' },
      h('div', { class: 'row', style: { justifyContent: 'space-between', alignItems: 'flex-start' } },
        h('div', { style: { maxWidth: '720px' } },
          h('h2', { style: { marginTop: 0 } }, 'Αυτόματη αναζήτηση αντιπροσώπων'),
          h('p', { class: 'muted' }, 'Το πρόγραμμα ψάχνει στο internet ποιος φέρνει στην Ελλάδα (εισαγωγέας, διανομέας, χονδρική) κάθε μάρκα που πουλάμε χωρίς αντιπρόσωπο, και κάθε μάρκα που έχουν οι ανταγωνιστές και εμείς όχι. Ανοίγει τα καλύτερα sites και ελέγχει αν έχουν πράγματι τη μάρκα. Τίποτα δεν καταχωρείται χωρίς την έγκρισή σου.'),
          h('p', { class: 'faint' }, `Γίνεται μόνο του μία φορά την εβδομάδα (40 μάρκες κάθε φορά, με ήπιο ρυθμό). Τελευταία: ${d.lastRun ? fmt.dateTime(d.lastRun) : 'ποτέ'}.`)),
        h('div', { class: 'stack s' }, runBtn('Αναζήτηση τώρα (40 μάρκες)', { limit: 40 }, 'primary'), runBtn('Όλες οι μάρκες (αργό)', { limit: 400 }))),
      d.blocked ? h('div', { class: 'note warn', style: { marginTop: '10px' } }, d.blocked.msg) : null,
      h('div', { class: 'kpis', style: { marginTop: '12px' } },
        h('div', { class: 'kpi' }, h('b', null, fmt.num(d.counts.unsupplied)), h('span', null, 'μάρκες μας χωρίς αντιπρόσωπο')),
        h('div', { class: 'kpi' }, h('b', null, fmt.num(d.counts.opportunity)), h('span', null, 'μάρκες ανταγωνιστών που δεν έχουμε')),
        h('div', { class: 'kpi' }, h('b', null, fmt.num(d.counts.found)), h('span', null, 'με προτάσεις για έγκριση')),
        h('div', { class: 'kpi' }, h('b', null, fmt.num(d.waiting.length)), h('span', null, 'περιμένουν αναζήτηση')))));
    const groups = [['found', 'Για έγκριση'], ['opportunity', 'Ευκαιρίες (μάρκες ανταγωνιστών)'], ['nothing', 'Χωρίς σίγουρο αποτέλεσμα'], ['approved', 'Εγκρίθηκαν'], ['dismissed', 'Δεν με ενδιαφέρουν'], ['waiting', 'Περιμένουν']];
    const pick = (k) => k === 'waiting' ? d.waiting : k === 'opportunity' ? d.rows.filter((r) => r.reason === 'opportunity' && r.status === 'found') : d.rows.filter((r) => r.status === k);
    main.appendChild(h('div', { class: 'tabs', style: { marginTop: '14px' } }, groups.map(([k, l]) => h('button', { 'aria-selected': String(k === filter), onclick: () => App.go('suppliers', { tab: 'find', f: k }) }, `${l} · ${pick(k).length}`))));
    const list = pick(filter);
    if (filter === 'waiting') {
      main.appendChild(list.length ? h('div', { class: 'panel' }, h('p', { class: 'muted' }, 'Πάτα μια μάρκα για αναζήτηση τώρα.'), h('div', { class: 'chips' }, list.slice(0, 300).map((b) => h('button', { type: 'button', class: 'chip', title: reasonText(b), onclick: () => POST('/api/supplierfind/run', { brands: [b.key] }).then((job) => { toast('Αναζήτηση για ' + b.brand + '…'); watchJob(job, { done: () => App.go('suppliers', { tab: 'find', f: 'found' }) }); }).catch(fail) }, b.brand, h('span', { class: 'faint' }, ' · ' + (b.reason === 'opportunity' ? b.stats.shopCount + ' ανταγ.' : fmt.num(b.stats.unsupplied))))))) : h('div', { class: 'panel empty' }, h('p', null, 'Όλες οι μάρκες έχουν ψαχτεί.')));
      return;
    }
    if (!list.length) {
      main.appendChild(h('div', { class: 'panel empty' }, h('h3', null, filter === 'found' ? 'Καμία πρόταση ακόμα' : 'Τίποτα εδώ'), filter === 'found' ? h('p', null, 'Πάτα «Αναζήτηση τώρα». Σε λίγα λεπτά θα εμφανιστούν εδώ οι πιθανοί αντιπρόσωποι για έγκριση.') : null));
      return;
    }
    for (const b of list.slice(0, 120)) main.appendChild(brandCard(b));
  }
  function reasonText(b) {
    const s = b.stats || {};
    return b.reason === 'opportunity' ? `Δεν το έχουμε· το πουλάνε ${s.shopCount} ανταγωνιστές (${fmt.num(s.compProducts)} προϊόντα${s.shops ? ': ' + s.shops.slice(0, 4).join(', ') : ''})` : `Πουλάμε ${fmt.num(s.ourProducts)} προϊόντα χωρίς αντιπρόσωπο`;
  }
  function brandCard(b) {
    const cands = (b.candidates || []).filter((c) => b.status === 'approved' ? c.host === (b.approved || {}).host : true);
    return h('div', { class: 'panel find-card' },
      h('div', { class: 'row', style: { justifyContent: 'space-between' } },
        h('div', null, h('h3', { style: { margin: 0 } }, b.brand, ' ', h('span', { class: 'badge ' + (b.reason === 'opportunity' ? 'med' : '') }, b.reason === 'opportunity' ? 'Ευκαιρία' : 'Χωρίς αντιπρόσωπο')), h('div', { class: 'faint' }, reasonText(b), b.searchedAt ? ' · ψάχτηκε ' + fmt.ago(b.searchedAt) : '')),
        h('div', { class: 'row' },
          b.status === 'dismissed' ? btn('Επαναφορά', { cls: 'sm' }, () => POST('/api/supplierfind/dismiss', { key: b.key, undo: true }).then(() => App.route()).catch(fail))
            : btn('Δεν με ενδιαφέρει', { cls: 'sm ghost', title: 'Δεν θα ψαχτεί ξανά' }, () => POST('/api/supplierfind/dismiss', { key: b.key }).then(() => { toast(b.brand + ': δεν θα ψαχτεί ξανά.'); App.route(); }).catch(fail)),
          b.status !== 'approved' ? btn('Ξαναψάξε', { cls: 'sm', icon: 'search' }, () => POST('/api/supplierfind/run', { brands: [b.key] }).then((job) => watchJob(job, { done: () => App.route() })).catch(fail)) : null)),
      (() => {
        const top = cands.filter((c) => c.confidence !== 'low');
        const rest = cands.filter((c) => c.confidence === 'low');
        const parts = [];
        if (top.length) parts.push(h('div', { class: 'cands' }, top.map((c) => candRow(b, c))));
        else parts.push(h('p', { class: 'faint' }, 'Δεν βρέθηκε site που να μοιάζει σίγουρα με αντιπρόσωπο.' + (b.maker ? ' Βρέθηκε το site του κατασκευαστή: ρώτα τους ποιος φέρνει τη μάρκα στην Ελλάδα.' : ' Δοκίμασε «Ξαναψάξε» αργότερα.'), b.maker ? h('span', null, ' ', h('button', { type: 'button', class: 'extlink', onclick: () => openUrl(b.maker) }, icon('ext'), ' κατασκευαστής')) : null));
        if (rest.length) parts.push(h('details', { class: 'more-cands' }, h('summary', null, `Άλλα αποτελέσματα (${rest.length})`), h('div', { class: 'cands' }, rest.map((c) => candRow(b, c)))));
        return parts;
      })());
  }
  function candRow(b, c) {
    const i = c.info || {};
    const conf = CONF[c.confidence] || CONF.low;
    const kindNote = c.kind === 'maker' ? h('span', { class: 'badge' }, 'Κατασκευαστής') : c.kind === 'competitor' ? h('span', { class: 'badge' }, 'Ανταγωνιστής') : null;
    return h('div', { class: 'cand' },
      h('div', { class: 'cand-main' },
        h('div', { class: 'row', style: { gap: '8px' } }, h('b', null, i.name || c.title || c.host), h('span', { class: 'badge ' + conf[1] }, conf[0]), kindNote, i.hasBrand ? h('span', { class: 'badge ok' }, 'Έχει τη μάρκα') : null, i.b2b ? h('span', { class: 'badge' }, 'B2B') : null),
        h('button', { type: 'button', class: 'extlink', onclick: () => openUrl(c.url) }, icon('ext'), ' ', c.host),
        c.snippet ? h('div', { class: 'faint snip' }, c.snippet.slice(0, 220)) : null,
        h('ul', { class: 'why' }, c.why.slice(0, 5).map((w) => h('li', null, w))),
        i.email || i.phone ? h('div', { class: 'muted' }, [i.phone, i.email].filter(Boolean).join(' · ')) : null),
      b.status === 'approved' ? h('div', null, h('span', { class: 'badge ok' }, 'Εγκρίθηκε')) : h('div', { class: 'stack s' },
        btn('Έγκριση', { cls: 'primary sm', icon: 'check', title: 'Δημιουργεί τον αντιπρόσωπο με αυτή τη μάρκα· ανοίγει για να ελέγξεις τα στοιχεία' }, () => POST('/api/supplierfind/approve', { key: b.key, host: c.host }).then((r) => {
          toast(r.existing ? `Η μάρκα ${b.brand} προστέθηκε στον αντιπρόσωπο ${r.supplier.name}.` : `Νέος αντιπρόσωπος: ${r.supplier.name}. Έλεγξε τα στοιχεία.`);
          editSupplier(r.supplier, () => App.route());
        }).catch(fail)),
        btn('Όχι αυτός', { cls: 'sm' }, () => POST('/api/supplierfind/reject', { key: b.key, host: c.host }).then(() => App.route()).catch(fail)),
        btn('Ποτέ αυτό το site', { cls: 'sm ghost', title: 'Δεν θα προταθεί ξανά για καμία μάρκα' }, () => POST('/api/supplierfind/reject', { key: b.key, host: c.host, never: true }).then(() => App.route()).catch(fail))));
  }

  function assignBrand(brand, sups) {
    if (!sups.length) { editSupplier({ brands: [brand] }); return; }
    modal.open(h('div', null, dlgHead('Η μάρκα ' + brand + ' έρχεται από…'),
      h('div', { class: 'stack s' }, sups.map((s) => btn(s.name, { cls: 'block' }, () => POST('/api/suppliers', Object.assign({}, s, { brands: (s.brands || []).concat([brand]) })).then(() => { modal.close(); toast(`${brand} → ${s.name}`); App.route(); }).catch(fail))),
        btn('Νέος αντιπρόσωπος', { cls: 'primary block', icon: 'new' }, () => { modal.close(); editSupplier({ brands: [brand] }); }))));
  }

  function editSupplier(s, after) {
    s = Object.assign({ name: '', brands: [], keywords: [], priceMode: 'retail', markup: 80, active: true }, s || {});
    const f = {};
    const inp = (k, label, attrs, hint) => { f[k] = h(attrs && attrs.tag === 'textarea' ? 'textarea' : 'input', Object.assign({ type: 'text', value: Array.isArray(s[k]) ? s[k].join(', ') : (s[k] == null ? '' : String(s[k])) }, attrs || {})); return h('label', { class: 'field' }, label, f[k], hint ? h('small', null, hint) : null); };
    const mode = select([['retail', 'Λιανικές τιμές (προτεινόμενες)'], ['cost', 'Τιμές κόστους (χονδρική)']], s.priceMode, null);
    const active = h('input', { type: 'checkbox', checked: s.active !== false });
    // automatic price list: their public catalog or their B2B with our login
    const catMode = select([['none', 'Όχι — φορτώνω αρχείο ή feed'], ['public', 'Ο δημόσιος κατάλογος του site τους (λιανικές)'], ['b2b', 'Το B2B τους με τους κωδικούς μας (χονδρική)']], s.catalogMode || 'none', () => drawAuto());
    const b2bUser = h('input', { type: 'text', value: s.b2bUser || '', autocomplete: 'off' });
    const b2bPass = h('input', { type: 'password', value: '', autocomplete: 'new-password', placeholder: s.b2bPassSet ? '•••••• (αποθηκευμένος)' : '' });
    const b2bKind = select([['cost-net', 'Κόστος χωρίς ΦΠΑ'], ['cost-vat', 'Κόστος με ΦΠΑ'], ['retail-vat', 'Λιανική με ΦΠΑ']], (s.b2bPriceKind || 'cost') + (s.b2bVatIncluded ? '-vat' : '-net'), null);
    const autoRefresh = h('input', { type: 'checkbox', checked: s.autoRefresh !== false });
    const autoBox = h('div', { class: 'panel', style: { background: 'var(--surface-2)' } });
    const drawAuto = () => {
      clear(autoBox);
      autoBox.appendChild(h('h2', null, 'Αυτόματος τιμοκατάλογος'));
      autoBox.appendChild(h('label', { class: 'field' }, 'Τιμές και νέα προϊόντα από', catMode));
      if (catMode.value === 'b2b') autoBox.appendChild(h('div', { class: 'grid3', style: { marginTop: '10px' } }, h('label', { class: 'field' }, 'Όνομα χρήστη B2B', b2bUser), h('label', { class: 'field' }, 'Κωδικός B2B', b2bPass, h('small', null, 'Φυλάσσεται κρυπτογραφημένος από τα Windows, μόνο σε αυτόν τον υπολογιστή.')), h('label', { class: 'field' }, 'Οι τιμές του B2B είναι', b2bKind)));
      if (catMode.value !== 'none') autoBox.appendChild(h('p', { class: 'hint' }, catMode.value === 'b2b' ? 'Λειτουργεί με B2B φτιαγμένα σε WooCommerce (τα περισσότερα στην Ελλάδα). Το πρόγραμμα συνδέεται όπως εσείς και διαβάζει όλο τον κατάλογο με τις δικές σας τιμές.' : 'Λειτουργεί όταν το site τους είναι WooCommerce ή Shopify. Οι τιμές είναι οι λιανικές τους· το κόστος υπολογίζεται από την έκπτωση που δίνετε παραπάνω.'));
      autoBox.appendChild(h('label', { class: 'check', style: { marginTop: '8px' } }, autoRefresh, 'Ενημέρωση κάθε μέρα αυτόματα (και το feed, αν υπάρχει)'));
    };
    drawAuto();
    const lookupBtn = btn('Συμπλήρωση από το site', { cls: 'sm', icon: 'bolt', title: 'Βρίσκει μόνο του τηλέφωνα, email, διεύθυνση, ΑΦΜ, μάρκες, feeds και B2B' }, () => lookup());
    const body = h('div', null, dlgHead(s.id ? 'Στοιχεία αντιπροσώπου' : 'Νέος αντιπρόσωπος', 'Γράψε το site του και πάτα «Συμπλήρωση από το site»: τα υπόλοιπα τα βρίσκει το πρόγραμμα. Ό,τι είναι λάθος, το διορθώνεις.'),
      h('div', { class: 'stack' },
        h('div', { class: 'grid2' }, inp('name', 'Όνομα εταιρείας *', { autofocus: true }), inp('code', 'Σύντομος κωδικός', { maxlength: 6, placeholder: 'π.χ. PNT' }, 'Για αυτόματα SKU όταν δεν υπάρχει κωδικός')),
        h('div', { class: 'grid3' }, inp('contact', 'Υπεύθυνος'), inp('phone', 'Τηλέφωνο', { type: 'tel' }), inp('mobile', 'Κινητό', { type: 'tel' })),
        h('div', { class: 'grid3' }, inp('website', 'Site', { placeholder: 'π.χ. antiprosopos.gr' }), h('div', { style: { alignSelf: 'end' } }, lookupBtn), inp('b2bUrl', 'Σελίδα B2B')),
        h('div', { class: 'grid3' }, inp('email', 'Email παραγγελιών', { type: 'email' })),
        h('div', { class: 'grid2' }, inp('address', 'Διεύθυνση'), inp('vat', 'ΑΦΜ')),
        inp('brands', 'Μάρκες που φέρνει', { list: 'dl-sup-brands', placeholder: 'Pentagon, Mil-Tec, 5.11 …' }, 'Χωρισμένες με κόμμα. Από αυτές συνδέονται αυτόματα τα προϊόντα.'),
        inp('keywords', 'Λέξεις στον τίτλο (προαιρετικά)', { placeholder: 'π.χ. ΑΡΒΥΛΑ ΣΤΡΑΤΟΥ' }, 'Για προϊόντα χωρίς μάρκα: αν ο τίτλος περιέχει τη λέξη, πάνε σε αυτόν τον αντιπρόσωπο.'),
        h('div', { class: 'grid4' }, inp('leadDays', 'Παράδοση (μέρες)', { type: 'number', min: 0 }), inp('minOrder', 'Ελάχιστη παραγγελία €'), inp('freeShippingFrom', 'Δωρεάν μεταφορικά από €'), inp('orderDay', 'Μέρα παραγγελίας', { placeholder: 'π.χ. Τρίτη' })),
        h('div', { class: 'grid4' }, h('label', { class: 'field' }, 'Ο τιμοκατάλογός του έχει', mode), inp('markup', 'Ανατίμηση % (για κόστος)', { type: 'number', min: 0 }, 'Κόστος × (1+%) × ΦΠΑ'), inp('discount', 'Έκπτωση % (για λιανικές)', { type: 'number', min: 0 }, 'Για υπολογισμό κόστους'), inp('paymentTerms', 'Πληρωμή', { placeholder: 'π.χ. 30 μέρες' })),
        inp('feedUrl', 'Σύνδεσμος αρχείου XML/CSV (αν έχει)', { type: 'url', placeholder: 'https://…/feed.xml' }),
        autoBox,
        inp('notes', 'Σημειώσεις', { tag: 'textarea', rows: 3 }),
        h('label', { class: 'check' }, active, 'Ενεργός')),
      h('datalist', { id: 'dl-sup-brands' }),
      h('div', { class: 'dlg-foot' },
        s.id ? btn('Διαγραφή', { cls: 'danger ghost' }, async () => { modal.close(); if (await confirmBox('Διαγραφή αντιπροσώπου;', s.name, 'Διαγραφή', true)) POST('/api/suppliers/delete', { id: s.id }).then(() => { drawer.close(); App.route(); }).catch(fail); }) : null,
        h('span', { class: 'grow' }),
        btn('Άκυρο', () => modal.close()),
        btn('Αποθήκευση', { cls: 'primary' }, async () => {
          const data = { id: s.id, priceMode: mode.value, active: active.checked, catalogMode: catMode.value, b2bUser: b2bUser.value, b2bPriceKind: b2bKind.value.split('-')[0], b2bVatIncluded: b2bKind.value.endsWith('-vat'), autoRefresh: autoRefresh.checked, info: s.info };
          if (b2bPass.value) data.b2bPassword = b2bPass.value;
          for (const [k, el] of Object.entries(f)) data[k] = el.value;
          try {
            const r = await POST('/api/suppliers', data);
            modal.close(); toast('Αποθηκεύτηκε: ' + r.supplier.name);
            if (r.clashes.length) toast('Προσοχή: ' + r.clashes.map((c) => c.brand).join(', ') + ' υπάρχει και σε άλλον αντιπρόσωπο.', { err: true });
            if (after) after(r.supplier); else App.route();
          } catch (e) { fail(e); }
        })));
    modal.open(body, { wide: true });
    GET('/api/brands').then((b) => { const dl = body.querySelector('#dl-sup-brands'); b.forEach((x) => dl.appendChild(h('option', { value: x.name }))); }).catch(() => {});

    async function lookup() {
      const site = f.website.value.trim();
      if (!site) { toast('Γράψε πρώτα το site του αντιπροσώπου.', { err: true }); f.website.focus(); return; }
      lookupBtn.disabled = true;
      const old = lookupBtn.lastChild.textContent;
      lookupBtn.lastChild.textContent = 'Ψάχνω…';
      try {
        const r = await POST('/api/suppliers/lookup', { website: site });
        showFound(r);
      } catch (e) { fail(e); } finally { lookupBtn.disabled = false; lookupBtn.lastChild.textContent = old; }
    }
    // what was found: tick what to keep, see where it came from
    function showFound(r) {
      const rows = [];
      const fields = [['name', 'Όνομα'], ['phone', 'Τηλέφωνο'], ['mobile', 'Κινητό'], ['email', 'Email'], ['address', 'Διεύθυνση'], ['vat', 'ΑΦΜ']];
      const grid = h('div', { class: 'found' });
      for (const [k, label] of fields) {
        const sug = r.suggestions[k];
        if (!sug) continue;
        const alts = (r.alternatives[k] || []).map((x) => x.value);
        const cur = f[k].value.trim();
        const valIn = alts.length ? select([sug.value].concat(alts), sug.value, null) : h('input', { type: 'text', value: sug.value });
        const cb = h('input', { type: 'checkbox', checked: !cur || cur === sug.value });
        rows.push({ k, cb, valIn });
        grid.appendChild(cb); grid.appendChild(h('b', null, label));
        grid.appendChild(valIn);
        grid.appendChild(h('div', null, cur && cur !== sug.value ? h('div', { class: 'cur' }, cur) : null, h('div', { class: 'src' }, 'από: ' + sug.source)));
      }
      const commonBrands = r.brands.common.map((b) => b.name);
      const curBrands = f.brands.value.split(',').map((x) => x.trim()).filter(Boolean);
      const brandCbs = commonBrands.map((b) => ({ b, cb: h('input', { type: 'checkbox', checked: !curBrands.some((x) => x.toUpperCase() === b.toUpperCase()) }) }));
      const feedSel = r.feeds.length ? select([['', '— όχι —']].concat(r.feeds.map((x) => [x.url, x.url + ' (' + x.kind.toUpperCase() + ')'])), f.feedUrl.value ? '' : r.feeds[0].url, null) : null;
      const b2bSel = r.b2b.length ? select([['', '— όχι —']].concat(r.b2b.map((x) => [x.url, (x.text || x.url).slice(0, 60) + ' · ' + x.url])), f.b2bUrl.value ? '' : r.b2b[0].url, null) : null;
      const catOk = r.platform.kind === 'woo' || r.platform.kind === 'shopify';
      const useCat = catOk ? h('input', { type: 'checkbox', checked: (catMode.value || 'none') === 'none' && !r.feeds.length }) : null;
      const dlg = h('div', null, dlgHead('Βρέθηκαν στο ' + r.website, 'Τσέκαρε ό,τι θέλεις να κρατήσεις. Οι τιμές διορθώνονται πριν την αποθήκευση.'),
        grid.childNodes.length ? grid : h('p', { class: 'muted' }, 'Δεν βρέθηκαν στοιχεία επικοινωνίας στη σελίδα.'),
        commonBrands.length ? h('div', { style: { marginTop: '14px' } }, h('h3', { style: { fontSize: '14px', margin: '0 0 6px' } }, `Μάρκες που φέρνει και πουλάτε (${commonBrands.length})`),
          h('div', { class: 'brand-chips' }, brandCbs.map(({ b, cb }) => h('label', { class: 'check' }, cb, b)))) : null,
        r.brands.other.length ? h('div', { style: { marginTop: '10px' } }, h('div', { class: 'faint', style: { marginBottom: '4px' } }, 'Μάρκες που φέρνει αλλά δεν έχετε (ευκαιρίες για νέα προϊόντα):'), h('div', { class: 'brand-chips' }, r.brands.other.slice(0, 40).map((b) => h('span', null, b.name)))) : null,
        feedSel ? h('label', { class: 'field', style: { marginTop: '14px' } }, 'Βρέθηκε αρχείο προϊόντων (feed)', feedSel) : null,
        b2bSel ? h('label', { class: 'field', style: { marginTop: '10px' } }, 'Σελίδα B2B / σύνδεσης', b2bSel) : null,
        catOk ? h('label', { class: 'check', style: { marginTop: '10px' } }, useCat, `Ο κατάλογός τους διαβάζεται αυτόματα (${r.platform.kind === 'woo' ? 'WooCommerce' : 'Shopify'}${r.platform.products ? ', ' + fmt.num(r.platform.products) + ' προϊόντα' : ''}): να γίνει ο αυτόματος τιμοκατάλογος`) : null,
        r.notes.length ? h('div', { class: 'note', style: { marginTop: '12px' } }, r.notes.join(' ')) : null,
        h('div', { class: 'dlg-foot' }, btn('Άκυρο', () => modal.close()), btn('Συμπλήρωση', { cls: 'primary', icon: 'check' }, () => {
          for (const x of rows) if (x.cb.checked) f[x.k].value = x.valIn.value;
          const add = brandCbs.filter((x) => x.cb.checked).map((x) => x.b);
          if (add.length) f.brands.value = curBrands.concat(add).join(', ');
          if (feedSel && feedSel.value) f.feedUrl.value = feedSel.value;
          if (b2bSel && b2bSel.value) f.b2bUrl.value = b2bSel.value;
          if (useCat && useCat.checked) { catMode.value = 'public'; drawAuto(); }
          s.info = { platform: r.platform.kind, otherBrands: r.brands.other.slice(0, 40).map((b) => b.name), at: new Date().toISOString() };
          modal.close();
          toast('Συμπληρώθηκε. Έλεγξε και πάτα «Αποθήκευση».');
        })));
      // closing this dialog (any way) goes back to the supplier form, with everything typed kept
      modal.open(dlg, { wide: true, onClose: () => setTimeout(() => modal.open(body, { wide: true }), 0) });
    }
  }

  async function openSupplier(id, tab) {
    const data = await GET('/api/suppliers');
    const s = data.suppliers.find((x) => x.id === id);
    if (!s) return toast('Δεν βρέθηκε ο αντιπρόσωπος.', { err: true });
    tab = tab || 'info';
    const content = h('div');
    const tabs = [['info', 'Στοιχεία'], ['products', 'Προϊόντα'], ['pricelist', 'Τιμοκατάλογος'], ['orders', 'Παραγγελίες']];
    const tabBar = h('div', { class: 'tabs', role: 'tablist' });
    const draw = async (t) => {
      tab = t;
      clear(tabBar);
      for (const [k, l] of tabs) tabBar.appendChild(h('button', { role: 'tab', 'aria-selected': String(k === t), onclick: () => draw(k) }, l));
      clear(content);
      try {
        if (t === 'info') drawInfo(content, s);
        else if (t === 'products') await drawProducts(content, s);
        else if (t === 'pricelist') await drawPricelist(content, s);
        else await drawSupplierOrders(content, s);
      } catch (e) { content.appendChild(h('div', { class: 'note crit' }, e.message)); }
    };
    drawer.open(h('div', null,
      h('div', { class: 'dlg-head' }, h('div', null, h('h2', null, s.name), h('p', { class: 'muted', style: { margin: '4px 0 0' } }, [(s.brands || []).join(', '), s.leadDays ? `παράδοση ${s.leadDays} μέρες` : ''].filter(Boolean).join(' — '))),
        h('div', { class: 'row tight' }, btn('Επεξεργασία', { cls: 'sm', icon: 'edit' }, () => editSupplier(s, () => { drawer.close(); App.route(); })), h('button', { class: 'x', 'aria-label': 'Κλείσιμο', onclick: () => drawer.close() }, icon('x')))),
      tabBar, content), { wide: true, onClose: () => { if (App.parseHash().params.id) App.go('suppliers'); } });
    draw(tab);
  }

  function drawInfo(box, s) {
    const tel = (n) => (n ? h('a', { href: 'tel:' + n.replace(/\s/g, '') }, n) : '—');
    box.appendChild(h('div', { class: 'grid2' },
      h('div', { class: 'panel' }, h('h2', null, 'Επικοινωνία'), h('dl', { class: 'kv' },
        h('dt', null, 'Υπεύθυνος'), h('dd', null, s.contact || '—'), h('dt', null, 'Τηλέφωνο'), h('dd', null, tel(s.phone)), h('dt', null, 'Κινητό'), h('dd', null, tel(s.mobile)),
        h('dt', null, 'Email'), h('dd', null, s.email ? h('a', { href: 'mailto:' + s.email }, s.email) : '—'),
        h('dt', null, 'Site'), h('dd', null, s.website ? h('a', { href: '#', onclick: (e) => { e.preventDefault(); App.openUrl(/^https?:/.test(s.website) ? s.website : 'https://' + s.website); } }, s.website) : '—'),
        h('dt', null, 'B2B'), h('dd', null, s.b2bUrl ? h('a', { href: '#', onclick: (e) => { e.preventDefault(); App.openUrl(s.b2bUrl); } }, 'άνοιγμα') : '—'),
        h('dt', null, 'Διεύθυνση'), h('dd', null, s.address || '—'), h('dt', null, 'ΑΦΜ'), h('dd', null, s.vat || '—'))),
      h('div', { class: 'panel' }, h('h2', null, 'Όροι'), h('dl', { class: 'kv' },
        h('dt', null, 'Παράδοση'), h('dd', null, s.leadDays ? fmt.plural(s.leadDays, 'μέρα', 'μέρες') : '—'),
        h('dt', null, 'Μέρα παραγγελίας'), h('dd', null, s.orderDay || '—'),
        h('dt', null, 'Ελάχιστη παραγγελία'), h('dd', null, s.minOrder ? fmt.money(s.minOrder) : '—'),
        h('dt', null, 'Δωρεάν μεταφορικά'), h('dd', null, s.freeShippingFrom ? 'από ' + fmt.money(s.freeShippingFrom) : '—'),
        h('dt', null, 'Πληρωμή'), h('dd', null, s.paymentTerms || '—'),
        h('dt', null, 'Τιμοκατάλογος'), h('dd', null, s.priceMode === 'cost' ? `Κόστος + ${s.markup}% + ΦΠΑ` : 'Λιανικές' + (s.discount ? `, έκπτωση ${s.discount}%` : '')),
        h('dt', null, 'Προϊόντα'), h('dd', null, `${fmt.num(s.products.sf)} στο ${siteName('sf')}, ${fmt.num(s.products.st)} στο ${siteName('st')}`)))),
      s.notes ? h('div', { class: 'panel' }, h('h2', null, 'Σημειώσεις'), h('p', { style: { whiteSpace: 'pre-wrap', margin: 0 } }, s.notes)) : null);
  }

  async function drawProducts(box, s) {
    let site = 'sf';
    const list = h('div');
    const selected = new Map();
    const load = async () => {
      const data = await GET('/api/products', { site, supplier: s.id, per: 500 });
      clear(list);
      if (!data.total) { list.appendChild(h('div', { class: 'panel empty' }, h('h3', null, 'Κανένα προϊόν'), h('p', null, 'Πρόσθεσε μάρκες στον αντιπρόσωπο για να συνδεθούν τα προϊόντα.'))); return; }
      const tb = h('tbody');
      for (const r of data.rows) {
        tb.appendChild(h('tr', null, h('td', { class: 'w-check' }, h('input', { type: 'checkbox', checked: selected.has(r.id), onchange: (e) => { if (e.target.checked) selected.set(r.id, { site, id: r.id, name: r.name, sku: r.sku, qty: 1 }); else selected.delete(r.id); } })),
          h('td', { style: { width: '52px' } }, thumb(r.img)), h('td', { class: 'title' }, h('a', { href: '#', onclick: (e) => { e.preventDefault(); App.openProduct(site, r.id); } }, r.name)), h('td', { class: 'mono' }, r.sku || ''), h('td', { class: 'num' }, fmt.money(r.price)), h('td', null, r.inStock ? '' : h('span', { class: 'pill' }, 'Εξαντλημένο'))));
      }
      list.appendChild(h('p', { class: 'muted' }, fmt.plural(data.total, 'προϊόν', 'προϊόντα') + (data.total > 500 ? ' (εμφανίζονται τα 500)' : '')));
      list.appendChild(h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl' }, h('thead', null, h('tr', null, h('th', null, ''), h('th', null, ''), h('th', null, 'Τίτλος'), h('th', null, 'Κωδικός'), h('th', { class: 'num' }, 'Τιμή'), h('th', null, ''))), tb)));
    };
    box.appendChild(h('div', { class: 'toolbar' }, App.seg([['sf', siteName('sf')], ['st', siteName('st')]], site, (v) => { site = v; load(); }), h('span', { class: 'grow' }),
      btn('Παραγγελία με τα επιλεγμένα', { cls: 'primary', icon: 'mail' }, () => { if (!selected.size) return toast('Διάλεξε προϊόντα.', { err: true }); orderEditor({ supplierId: s.id, items: [...selected.values()] }); })));
    box.appendChild(list);
    await load();
  }

  // ---------- Price lists ----------
  async function drawPricelist(box, s) {
    const info = s.pricelist;
    const loader = h('div', { class: 'stack' });
    const urlIn = h('input', { type: 'url', placeholder: 'https://… σύνδεσμος XML / CSV / Excel', value: s.feedUrl || '' });
    const preview = async (payload) => {
      clear(loader).appendChild(h('p', { class: 'muted' }, 'Ανάγνωση αρχείου…'));
      try { const pv = await POST('/api/pricelist/preview', Object.assign({ supplierId: s.id }, payload)); mapping(loader, s, pv, payload.url); } catch (e) { clear(loader).appendChild(h('div', { class: 'note crit' }, e.message)); }
    };
    const top = h('div', { class: 'panel' }, h('h2', null, info ? 'Νέος τιμοκατάλογος' : 'Φόρτωσε τον τιμοκατάλογο'),
      h('p', { class: 'muted', style: { marginTop: '-4px' } }, 'Excel, CSV, XML ή PDF — από αρχείο ή σύνδεσμο. Τις στήλες τις ορίζεις μία φορά· την επόμενη φορά αρκεί ένα κλικ (ή γίνεται μόνο του κάθε μέρα για feeds).'),
      h('div', { class: 'grid2' }, dropZone('Αρχείο αντιπροσώπου (.xlsx, .xls, .csv, .xml, .pdf)', '.xlsx,.xls,.csv,.xml,.txt,.json,.ods,.pdf', async (file) => preview({ base64: await fileToBase64(file), fileName: file.name })),
        h('div', { class: 'stack s', style: { alignContent: 'start' } }, h('label', { class: 'field' }, 'ή από σύνδεσμο', urlIn), btn('Φόρτωση από σύνδεσμο', { icon: 'download' }, () => { if (!/^https?:\/\//.test(urlIn.value)) return toast('Δώσε σύνδεσμο https://', { err: true }); preview({ url: urlIn.value.trim() }); }))),
      loader);
    const autoSrc = s.catalogMode === 'public' || s.catalogMode === 'b2b';
    if (autoSrc || s.feedUrl) {
      const label = s.catalogMode === 'b2b' ? 'B2B (' + (s.b2bUrl || s.website) + ')' : s.catalogMode === 'public' ? 'κατάλογος του ' + s.website : 'feed ' + s.feedUrl;
      box.appendChild(h('div', { class: 'panel', style: { marginBottom: '12px' } }, h('div', { class: 'row' },
        h('div', { class: 'grow' }, h('b', null, 'Αυτόματη πηγή: '), label, h('div', { class: 'hint' }, s.autoRefresh !== false ? 'Ενημερώνεται κάθε μέρα με το άνοιγμα του προγράμματος.' : 'Η ημερήσια ενημέρωση είναι κλειστή.', s.lastUpdate ? ` Τελευταία: ${fmt.dateTime(s.lastUpdate.at)}${s.lastUpdate.items != null ? ' · ' + fmt.num(s.lastUpdate.items) + ' κωδικοί · ' + fmt.num(s.lastUpdate.changed || 0) + ' αλλαγές τιμής' : ''}` : '')),
        s.catalogMode === 'b2b' ? btn('Δοκιμή σύνδεσης B2B', { cls: 'sm' }, () => POST('/api/suppliers/b2b-test', { id: s.id }).then(() => toast('Η σύνδεση στο B2B πέτυχε.')).catch(fail)) : null,
        btn('Ενημέρωση τώρα', { cls: 'primary sm', icon: 'sync' }, () => POST(autoSrc ? '/api/suppliers/refresh' : '/api/pricelist/refresh', autoSrc ? { id: s.id } : { supplierId: s.id }).then((job) => App.watchJob(job, { done: (r) => { if (r) toast(`Ενημερώθηκε: ${fmt.num(r.items)} κωδικοί, ${fmt.num(r.changed)} αλλαγές τιμής.`); openSupplier(s.id, 'pricelist'); } })).catch(fail)))));
    }
    if (info) {
      box.appendChild(h('div', { class: 'note ok', style: { marginBottom: '12px' } }, `Τελευταίος τιμοκατάλογος: ${info.fileName || ''} · ${fmt.num(info.items)} κωδικοί · ${fmt.dateTime(info.importedAt)} · ${info.priceKind === 'cost' ? 'τιμές κόστους' : 'λιανικές'}${info.vatIncluded ? ' με ΦΠΑ' : ' χωρίς ΦΠΑ'}`));
      const cmpBox = h('div');
      box.appendChild(cmpBox);
      await drawCompare(cmpBox, s, 'sf');
      box.appendChild(h('details', { style: { marginTop: '16px' } }, h('summary', { class: 'btn' }, icon('upload'), 'Φόρτωση νέου τιμοκαταλόγου'), h('div', { style: { marginTop: '12px' } }, top)));
    } else box.appendChild(top);
  }

  function mapping(box, s, pv, url) {
    clear(box);
    const sels = {};
    const sample = (hd) => pv.sample.map((r) => r[hd]).filter(Boolean).slice(0, 3).join(' · ');
    const grid = h('div', { class: 'mapgrid' });
    for (const [k, label] of Object.entries(pv.labels)) {
      const sel = select([['', '— δεν υπάρχει —']].concat(pv.headers.map((x) => [x, x])), pv.mapping[k] || '', () => { ex.textContent = sel.value ? sample(sel.value) : ''; });
      const ex = h('div', { class: 'ex' }, pv.mapping[k] ? sample(pv.mapping[k]) : '');
      sels[k] = sel;
      grid.appendChild(h('div', { style: { fontWeight: ['code', 'name', 'price'].includes(k) ? 650 : 400 } }, label));
      grid.appendChild(sel); grid.appendChild(ex);
    }
    let kind = pv.priceKind + (pv.vatIncluded ? '-vat' : '-net');
    const kindSel = select([['retail-vat', 'Λιανική με ΦΠΑ'], ['retail-net', 'Λιανική χωρίς ΦΠΑ'], ['cost-net', 'Κόστος (χονδρική) χωρίς ΦΠΑ'], ['cost-vat', 'Κόστος με ΦΠΑ']], kind, (v) => { kind = v; });
    box.appendChild(h('div', { class: 'note' }, `${pv.fileName} — ${fmt.num(pv.rows)} γραμμές. Έλεγξε ποια στήλη είναι τι (δεξιά βλέπεις παράδειγμα).`));
    box.appendChild(grid);
    box.appendChild(h('div', { class: 'row', style: { marginTop: '12px' } }, h('label', { class: 'field', style: { minWidth: '280px' } }, 'Η τιμή του αρχείου είναι', kindSel), h('span', { class: 'grow' }),
      btn('Εισαγωγή και σύγκριση', { cls: 'primary' }, async () => {
        const m = {}; for (const [k, sel] of Object.entries(sels)) if (sel.value) m[k] = sel.value;
        try {
          const r = await POST('/api/pricelist/import', { supplierId: s.id, mapping: m, priceKind: kind.split('-')[0], vatIncluded: kind.endsWith('-vat'), url });
          toast(`Φορτώθηκαν ${fmt.num(r.items)} κωδικοί${r.changed ? `, ${r.changed} με αλλαγή τιμής από την προηγούμενη φορά` : ''}.`);
          openSupplier(s.id, 'pricelist');
        } catch (e) { fail(e); }
      })));
  }

  async function drawCompare(box, s, site) {
    const cmp = await GET('/api/pricelist/compare', { supplierId: s.id, site });
    let filter = cmp.counts.changed ? 'changed' : cmp.counts.loss ? 'loss' : 'diff';
    const selected = new Set();
    const tableBox = h('div');
    const bulk = h('div', { class: 'bulkbar hidden' });
    const filters = [['changed', 'Άλλαξε τιμή', cmp.counts.changed], ['loss', 'Κάτω από κόστος', cmp.counts.loss], ['diff', 'Διαφορά τιμής', cmp.counts.diff], ['new', 'Δεν τα έχουμε', cmp.counts.new], ['same', 'Ίδια τιμή', cmp.counts.same], ['all', 'Όλα', cmp.counts.all]];
    const fbar = h('div', { class: 'tabs' });
    const drawF = () => { clear(fbar); for (const [k, l, n] of filters) fbar.appendChild(h('button', { 'aria-selected': String(k === filter), onclick: () => { filter = k; selected.clear(); drawF(); drawT(); } }, l, h('span', { class: 'badge' + (k === 'loss' && n ? ' high' : '') }, n))); };
    const rowsF = () => cmp.rows.filter((r) => filter === 'all' || (filter === 'changed' ? r.changed : r.status === filter));
    const renderBulk = () => {
      clear(bulk); bulk.classList.toggle('hidden', !selected.size);
      if (!selected.size) return;
      const keys = [...selected];
      const rows = cmp.rows.filter((r) => selected.has(r.key));
      bulk.appendChild(h('b', null, fmt.plural(keys.length, 'επιλεγμένο', 'επιλεγμένα')));
      if (rows.some((r) => r.match)) bulk.appendChild(btn('Αρχείο νέων τιμών για ' + siteName(site), { cls: 'primary', icon: 'download' }, () => POST('/api/pricelist/export', { supplierId: s.id, site, keys }).then((r) => fileReady(Object.assign({ site }, r))).catch(fail)));
      if (rows.some((r) => !r.match)) bulk.appendChild(btn('Καταχώρηση ως νέα προϊόντα', { icon: 'new', title: 'Με επίσημη περιγραφή και φωτογραφίες από τη σελίδα τους, όπου υπάρχει' }, () => POST('/api/pricelist/drafts', { supplierId: s.id, keys: rows.filter((r) => !r.match).map((r) => r.key) }).then((r) => {
        const done = (x) => { toast(`Δημιουργήθηκαν ${x.created} προϊόντα προς έλεγχο.` + (x.errors && x.errors.length ? ` ${x.errors.length} σελίδες δεν άνοιξαν (έγιναν από τη λίστα).` : ''), { action: { label: 'Άνοιγμα', fn: () => { drawer.close(); App.go('new'); } } }); App.refreshBadges(); };
        if (r.id) { toast('Διαβάζω τις σελίδες των προϊόντων στο site τους…'); App.watchJob(r, { done }); } else done(r);
      }).catch(fail)));
    };
    const drawT = () => {
      clear(tableBox);
      const rows = rowsF();
      if (!rows.length) { tableBox.appendChild(h('div', { class: 'panel empty' }, h('p', null, 'Τίποτα σε αυτή την ομάδα.'))); renderBulk(); return; }
      const all = h('input', { type: 'checkbox', onchange: (e) => { rows.forEach((r) => (e.target.checked ? selected.add(r.key) : selected.delete(r.key))); drawT(); } });
      all.checked = rows.every((r) => selected.has(r.key));
      const tb = h('tbody');
      for (const r of rows.slice(0, 1500)) {
        const diff = r.match ? r.retail - r.match.price : 0;
        tb.appendChild(h('tr', { class: selected.has(r.key) ? 'sel' : '' },
          h('td', { class: 'w-check' }, h('input', { type: 'checkbox', checked: selected.has(r.key), onchange: (e) => { if (e.target.checked) selected.add(r.key); else selected.delete(r.key); renderBulk(); } })),
          h('td', { class: 'mono' }, r.code || '—'),
          h('td', { class: 'title' }, r.name, [r.size, r.color].filter(Boolean).length ? h('div', { class: 'faint', style: { fontWeight: 400 } }, [r.size, r.color].filter(Boolean).join(' / ')) : null),
          h('td', { class: 'num' }, fmt.money(r.supplierPrice), r.changed ? h('div', { class: 'price-diff ' + (r.supplierPrice > r.prevPrice ? 'up' : 'down') }, 'ήταν ' + fmt.money(r.prevPrice)) : null),
          h('td', { class: 'num' }, h('b', null, fmt.money(r.retail)), r.cost ? h('div', { class: 'faint' }, 'κόστος ' + fmt.money(r.cost)) : null),
          h('td', { class: 'title', style: { fontWeight: 400 } }, r.match ? h('a', { href: '#', onclick: (e) => { e.preventDefault(); App.openProduct(site, r.match.parent || r.match.id); } }, r.match.name) : h('span', { class: 'faint' }, '—'), r.match ? h('div', { class: 'faint', style: { fontSize: '12px' } }, r.match.how + (r.match.weak ? ' (έλεγξε)' : '')) : null),
          h('td', { class: 'num' }, r.match ? fmt.money(r.match.price) : '', r.match && Math.abs(diff) > 0.009 ? h('div', { class: 'price-diff ' + (diff > 0 ? 'up' : 'down') }, (diff > 0 ? '+' : '') + fmt.money(diff)) : null),
          h('td', { class: 'num' }, r.margin != null ? h('span', { class: r.margin < App.state.settings.floorMargin ? 'price-diff up' : '' }, r.margin.toLocaleString('el-GR') + '%') : '—')));
      }
      tableBox.appendChild(h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl' }, h('thead', null, h('tr', null, h('th', { class: 'w-check' }, all), h('th', null, 'Κωδικός'), h('th', null, 'Όνομα αντιπροσώπου'), h('th', { class: 'num' }, 'Τιμή αρχείου'), h('th', { class: 'num' }, 'Προτεινόμενη λιανική'), h('th', null, 'Δικό μας προϊόν'), h('th', { class: 'num' }, 'Δική μας τιμή'), h('th', { class: 'num' }, 'Περιθώριο'))), tb)));
      if (rows.length > 1500) tableBox.appendChild(h('p', { class: 'faint' }, 'Εμφανίζονται οι πρώτοι 1.500.'));
      renderBulk();
    };
    box.appendChild(h('div', { class: 'toolbar' }, App.seg([['sf', siteName('sf')], ['st', siteName('st')]], site, (v) => { clear(box); drawCompare(box, s, v); }), h('span', { class: 'grow' }),

      cmp.priceKind === 'cost' || s.discount ? btn('Αποθήκευση κόστους', { title: 'Χρησιμοποιείται ως κατώτατο όριο στις προτεινόμενες τιμές αγοράς' }, () => POST('/api/pricelist/costs', { supplierId: s.id, site }).then((r) => toast(`Αποθηκεύτηκε κόστος για ${r.count} προϊόντα.`)).catch(fail)) : null,
      App.reportButtons('pricelist', { supplierId: s.id, site }, 'Λίστα')));
    box.appendChild(fbar);
    box.appendChild(tableBox);
    box.appendChild(bulk);
    drawF(); drawT();
  }

  // ---------- Orders ----------
  async function drawSupplierOrders(box, s) {
    const orders = (await GET('/api/orders')).filter((o) => o.supplierId === s.id);
    box.appendChild(h('div', { class: 'toolbar' }, h('span', { class: 'grow' }), btn('Νέα παραγγελία', { cls: 'primary', icon: 'new' }, () => orderEditor({ supplierId: s.id }))));
    box.appendChild(ordersTable(orders, [s]));
  }
  async function renderOrders(main) {
    const [orders, sd] = await Promise.all([GET('/api/orders'), GET('/api/suppliers')]);
    if (!orders.length) { main.appendChild(h('div', { class: 'panel empty' }, h('h3', null, 'Καμία παραγγελία'), h('p', null, 'Φτιάξε παραγγελία προς αντιπρόσωπο: τα είδη, οι ποσότητες, και έτοιμο email. Το πρόγραμμα θυμάται πότε έρχεται.'), btn('Νέα παραγγελία', { cls: 'primary', icon: 'new' }, () => orderEditor(null)))); return; }
    main.appendChild(ordersTable(orders, sd.suppliers));
  }
  function ordersTable(orders, sups) {
    if (!orders.length) return h('div', { class: 'panel empty' }, h('p', null, 'Καμία παραγγελία.'));
    const name = (id) => (sups.find((s) => s.id === id) || {}).name || '—';
    const today = new Date().toISOString().slice(0, 10);
    const tb = h('tbody');
    for (const o of orders) {
      const late = o.status === 'sent' && o.expectedAt && o.expectedAt < today;
      tb.appendChild(h('tr', { class: 'click', onclick: () => orderEditor(o) },
        h('td', null, fmt.date(o.createdAt)), h('td', { class: 'title' }, name(o.supplierId), o.customer ? h('div', { class: 'faint', style: { fontWeight: 400 } }, 'Για πελάτη: ' + o.customer) : null),
        h('td', { class: 'num' }, fmt.num(o.items.reduce((a, i) => a + i.qty, 0))),
        h('td', null, h('span', { class: 'badge ' + STATUS[o.status][1] }, STATUS[o.status][0])),
        h('td', null, o.expectedAt ? h('span', { class: late ? 'price-diff up' : '' }, fmt.date(o.expectedAt) + (late ? ' (καθυστέρηση)' : '')) : '—')));
    }
    return h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl' }, h('thead', null, h('tr', null, h('th', null, 'Ημερομηνία'), h('th', null, 'Αντιπρόσωπος'), h('th', { class: 'num' }, 'Τεμάχια'), h('th', null, 'Κατάσταση'), h('th', null, 'Αναμένεται'))), tb));
  }

  async function orderEditor(o) {
    const sd = await GET('/api/suppliers');
    o = Object.assign({ supplierId: '', items: [], note: '', customer: '', status: 'draft' }, o || {});
    const items = o.items.map((i) => Object.assign({}, i));
    const supSel = select([['', '— διάλεξε αντιπρόσωπο —']].concat(sd.suppliers.map((s) => [s.id, s.name])), o.supplierId, null);
    const cust = h('input', { type: 'text', value: o.customer || '', placeholder: 'Όνομα / τηλέφωνο πελάτη (αν είναι ειδική παραγγελία)' });
    const note = h('textarea', { rows: 2, value: o.note || '', placeholder: 'Σημείωση στο email (προαιρετικά)' });
    const list = h('tbody');
    const drawItems = () => {
      clear(list);
      items.forEach((it, i) => {
        const q = h('input', { type: 'number', min: 1, value: it.qty || 1, style: { width: '70px' } }); q.addEventListener('input', () => { it.qty = Number(q.value) || 1; });
        const n = h('input', { type: 'text', value: it.note || '', placeholder: 'π.χ. μέγεθος XL' }); n.addEventListener('input', () => { it.note = n.value; });
        list.appendChild(h('tr', null, h('td', { class: 'title' }, it.name, it.sku ? h('div', { class: 'faint mono' }, it.sku) : null), h('td', null, q), h('td', null, n), h('td', null, h('button', { class: 'x', onclick: () => { items.splice(i, 1); drawItems(); } }, icon('trash')))));
      });
      if (!items.length) list.appendChild(h('tr', null, h('td', { colspan: 4, class: 'faint' }, 'Πρόσθεσε είδη από την αναζήτηση ή γράψε ελεύθερα.')));
    };
    const search = h('input', { type: 'search', placeholder: 'Αναζήτηση προϊόντος ή ελεύθερο κείμενο + Enter' });
    const results = h('div', { class: 'chips', style: { marginTop: '6px' } });
    search.addEventListener('input', debounce(async () => {
      clear(results);
      if (search.value.trim().length < 2) return;
      const r = await GET('/api/search-other', { site: 'sf', q: search.value });
      for (const x of r.slice(0, 10)) results.appendChild(h('button', { type: 'button', class: 'chip', onclick: () => { items.push({ site: 'sf', id: x.id, name: x.name, sku: x.sku, qty: 1 }); drawItems(); } }, x.name));
    }, 250));
    search.addEventListener('keydown', (e) => { if (e.key === 'Enter' && search.value.trim()) { items.push({ name: search.value.trim(), qty: 1 }); search.value = ''; clear(results); drawItems(); } });
    const collect = () => ({ id: o.id, supplierId: supSel.value, items, note: note.value, customer: cust.value });
    const saveO = async (status) => {
      if (!supSel.value) { toast('Διάλεξε αντιπρόσωπο.', { err: true }); return null; }
      try { const r = await POST('/api/orders', Object.assign(collect(), status ? { status } : {})); o = r; return r; } catch (e) { fail(e); return null; }
    };
    const body = h('div', null, dlgHead(o.id ? 'Παραγγελία' : 'Νέα παραγγελία', o.id ? `${STATUS[o.status][0]} · ${fmt.date(o.createdAt)}${o.expectedAt ? ' · αναμένεται ' + fmt.date(o.expectedAt) : ''}` : 'Αποθηκεύεται εδώ, το email το στέλνεις εσύ.'),
      h('div', { class: 'grid2' }, h('label', { class: 'field' }, 'Αντιπρόσωπος', supSel), h('label', { class: 'field' }, 'Για πελάτη', cust)),
      h('div', { style: { marginTop: '12px' } }, search, results),
      h('div', { class: 'tbl-wrap', style: { marginTop: '10px' } }, h('table', { class: 'tbl' }, h('thead', null, h('tr', null, h('th', null, 'Είδος'), h('th', null, 'Ποσότητα'), h('th', null, 'Σημείωση'), h('th', null, ''))), list)),
      h('label', { class: 'field', style: { marginTop: '12px' } }, 'Σημείωση', note),
      h('div', { class: 'dlg-foot' },
        o.id ? btn('Διαγραφή', { cls: 'ghost danger' }, async () => { await POST('/api/orders/delete', { id: o.id }); modal.close(); App.route(); }) : null,
        h('span', { class: 'grow' }),
        o.status === 'sent' ? btn('Παραλήφθηκε', { icon: 'check' }, async () => { await POST('/api/orders/status', { id: o.id, status: 'received' }); modal.close(); toast('Σημειώθηκε ως παραληφθείσα.'); App.route(); }) : null,
        btn('Αποθήκευση', async () => { if (await saveO()) { modal.close(); toast('Αποθηκεύτηκε.'); App.route(); } }),
        btn('Email προς αντιπρόσωπο', { cls: 'primary', icon: 'mail' }, async () => {
          const r = await saveO(); if (!r) return;
          const em = await GET('/api/orders/email', { id: r.id });
          const ta = h('textarea', { rows: 14, value: em.body });
          modal.open(h('div', null, dlgHead('Email παραγγελίας', em.to ? 'Προς: ' + em.to : 'Ο αντιπρόσωπος δεν έχει email — αντέγραψε το κείμενο.'),
            h('label', { class: 'field' }, 'Θέμα', h('input', { type: 'text', value: em.subject, readOnly: true })), h('label', { class: 'field', style: { marginTop: '10px' } }, 'Κείμενο', ta),
            h('div', { class: 'dlg-foot' }, btn('Αντιγραφή', { icon: 'copy' }, () => copyText(ta.value)),
              h('a', { class: 'btn', href: `mailto:${encodeURIComponent(em.to)}?subject=${encodeURIComponent(em.subject)}&body=${encodeURIComponent(ta.value)}` }, icon('mail'), 'Άνοιγμα στο email'),
              btn('Στάλθηκε', { cls: 'primary', icon: 'check' }, async () => { await POST('/api/orders/status', { id: r.id, status: 'sent' }); modal.close(); toast('Η παραγγελία σημειώθηκε ως σταλμένη. Θα σου θυμίσω όταν πρέπει να έρθει.'); App.route(); }))), { wide: true });
        })));
    modal.open(body, { wide: true });
    drawItems();
  }
  App.orderEditor = orderEditor;
})();
