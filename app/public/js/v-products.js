/* Προϊόντα — both shops side by side */
'use strict';
(function () {
  const { h, clear, btn, icon, fmt, GET, POST, toast, fail, drawer, modal, dlgHead, thumb, select, seg, pageHead, go, siteName, sitePill, sandboxPreview, debounce, fileReady, watchJob, fileToBase64, dropZone } = App;
  let cats = { sf: null, st: null };
  let brands = null;
  let suppliersList = null;

  async function loadLookups(site) {
    if (!cats[site]) cats[site] = await GET('/api/categories', { site });
    if (!brands) brands = await GET('/api/brands');
    if (!suppliersList) suppliersList = (await GET('/api/suppliers')).suppliers;
  }

  App.views.products = {
    async render(main, p) {
      cats = { sf: null, st: null }; brands = null; suppliersList = null;
      const st = App.state.summary;
      const q = Object.assign({ site: 'sf', page: 1, per: 50, sort: 'name', dir: 'asc' }, p);
      main.appendChild(pageHead('Προϊόντα', 'Όλα τα προϊόντα των δύο sites, όπως τα βλέπει ο πελάτης. Πάτα σε ένα προϊόν για λεπτομέρειες.', [
        App.reportButtons('products', q, 'Λίστα'),
        btn('Οικογένειες', { icon: 'link', title: 'Το ίδιο μοντέλο σε ξεχωριστά προϊόντα, ένα ανά χρώμα: προτάσεις για μία σελίδα με επιλογή χρώματος' }, () => familiesDrawer(q.site === 'st' ? 'st' : 'sf')),
        btn('Εισαγωγή CSV', { icon: 'upload' }, () => App.csvImport(q.site)),
        btn('Ανάγνωση από τα sites', { cls: 'primary', icon: 'sync' }, () => App.startSync()),
      ]));
      if (!st.sf.syncedAt && !st.st.syncedAt) {
        main.appendChild(h('div', { class: 'panel empty' }, h('h3', null, 'Δεν έχουν διαβαστεί προϊόντα ακόμα'),
          h('p', null, 'Πάτα «Ανάγνωση από τα sites». Αν κάποιο site δεν επιτρέπει την ανάγνωση, κάνε εξαγωγή από το WooCommerce (Προϊόντα → Εξαγωγή) και φόρτωσέ τη με «Εισαγωγή CSV».'),
          btn('Ανάγνωση τώρα', { cls: 'primary', icon: 'sync' }, () => App.startSync())));
        return;
      }
      await loadLookups(q.site);
      const selected = new Set();
      const tableBox = h('div');
      const bulk = h('div', { class: 'bulkbar hidden' });
      const search = h('input', { type: 'search', placeholder: 'Αναζήτηση: τίτλος, κωδικός, μάρκα', value: q.search || '' });
      const reload = (patch) => { Object.assign(q, patch || {}); if (!('page' in (patch || {}))) q.page = 1; go('products', q); };
      search.addEventListener('input', debounce(() => { q.search = search.value; q.page = 1; load(); }, 300));
      const catSel = select([['', 'Όλες οι κατηγορίες']].concat(cats[q.site].map((c) => [c.id, c.path + ` (${c.count})`])), q.cat || '', (v) => reload({ cat: v }));
      const brandSel = select([['', 'Όλες οι μάρκες']].concat(brands.filter((b) => b[q.site]).map((b) => [b.name, `${b.name} (${b[q.site]})`])), q.brand || '', (v) => reload({ brand: v }));
      const onlySel = select([['', 'Όλα'], ['missing', q.site === 'sf' ? 'Λείπουν από ' + siteName('st') : 'Λείπουν από ' + siteName('sf')], ['both', 'Υπάρχουν και στα δύο'], ['sale', 'Σε προσφορά'], ['noimg', 'Χωρίς φωτογραφία'], ['out', 'Εξαντλημένα'], ['nosku', 'Χωρίς κωδικό'], ['noads', 'Απαγορεύονται σε διαφημίσεις'], ['nogoogle', 'Όχι στο Google']], q.only || '', (v) => reload({ only: v }));
      const supSel = select([['', 'Όλοι οι αντιπρόσωποι']].concat(suppliersList.map((s) => [s.id, s.name])), q.supplier || '', (v) => reload({ supplier: v }));
      main.appendChild(h('div', { class: 'toolbar' },
        seg([['sf', siteName('sf')], ['st', siteName('st')]], q.site, (v) => reload({ site: v, cat: '', brand: '' })),
        search, catSel, brandSel, onlySel, suppliersList.length ? supSel : null));
      main.appendChild(tableBox);
      main.appendChild(bulk);

      function renderBulk() {
        clear(bulk);
        bulk.classList.toggle('hidden', !selected.size);
        if (!selected.size) return;
        bulk.appendChild(h('b', null, fmt.plural(selected.size, 'επιλεγμένο', 'επιλεγμένα')));
        bulk.appendChild(btn('Έρευνα τιμών αγοράς', { icon: 'market' }, () => {
          POST('/api/market/run', { targets: [...selected].map((id) => ({ site: q.site, id })) }).then((job) => {
            toast('Ξεκίνησε η έρευνα τιμών για ' + selected.size + ' προϊόντα.');
            watchJob(job, { done: (r) => r && toast(`Έρευνα τιμών: σίγουρη τιμή αγοράς για ${r.withData} από ${r.done}.`, { action: { label: 'Δες τα', fn: () => go('market', { site: q.site }) } }) });
          }).catch(fail);
        }));
        if (q.site === 'sf') bulk.appendChild(btn('Αρχείο μεταφοράς στο ' + siteName('st'), { icon: 'file' }, () => {
          POST('/api/transfer', { ids: [...selected] }).then((r) => { if (!r.count) { toast('Κανένα από τα επιλεγμένα δεν μπορεί να μεταφερθεί: ' + (r.skipped[0] ? r.skipped[0].why : ''), { err: true }); return; } fileReady(r, { site: 'st', kind: 'new', title: 'Αρχείο μεταφοράς έτοιμο' }); }).catch(fail);
        }));
        bulk.appendChild(h('span', { class: 'grow' }));
        bulk.appendChild(btn('Καθαρισμός', { cls: 'ghost' }, () => { selected.clear(); load(); }));
      }

      async function load() {
        const data = await GET('/api/products', q);
        clear(tableBox);
        if (!data.total) {
          tableBox.appendChild(h('div', { class: 'panel empty' }, h('h3', null, 'Κανένα προϊόν'), h('p', null, q.search ? 'Δοκίμασε λιγότερες λέξεις ή έλεγξε την ορθογραφία.' : 'Δεν υπάρχουν προϊόντα με αυτά τα φίλτρα.')));
          renderBulk();
          return;
        }
        const other = q.site === 'sf' ? 'st' : 'sf';
        const allBox = h('input', { type: 'checkbox', 'aria-label': 'Επιλογή όλων', onchange: (e) => { for (const r of data.rows) { if (e.target.checked) selected.add(r.id); else selected.delete(r.id); } load(); } });
        allBox.checked = data.rows.every((r) => selected.has(r.id));
        const sortTh = (label, key, cls) => h('th', { class: 'sortable ' + (cls || ''), onclick: () => reload({ sort: key, dir: q.sort === key && q.dir === 'asc' ? 'desc' : 'asc', page: q.page }) }, label, q.sort === key ? (q.dir === 'asc' ? ' ↑' : ' ↓') : '');
        const tbody = h('tbody');
        for (const r of data.rows) {
          const cb = h('input', { type: 'checkbox', 'aria-label': 'Επιλογή', checked: selected.has(r.id), onclick: (e) => e.stopPropagation(), onchange: (e) => { if (e.target.checked) selected.add(r.id); else selected.delete(r.id); tr.classList.toggle('sel', e.target.checked); renderBulk(); } });
          const diff = r.other ? Math.round((r.other.price - r.price) * 100) / 100 : 0;
          const tr = h('tr', { class: 'click' + (selected.has(r.id) ? ' sel' : ''), onclick: () => openProduct(q.site, r.id) },
            h('td', { class: 'w-check' }, cb),
            h('td', { style: { width: '52px' } }, thumb(r.img)),
            h('td', { class: 'title' }, r.name, ' ', App.backendBtn(q.site, r.id), h('div', { class: 'faint', style: { fontSize: '12.5px', fontWeight: 400 } }, [r.cats.slice(0, 2).join(', '), r.variations ? `${r.variations} παραλλαγές` : ''].filter(Boolean).join(' — '))),
            h('td', { class: 'mono' }, r.sku || h('span', { class: 'faint' }, '—')),
            h('td', null, r.brand || h('span', { class: 'faint' }, '—')),
            h('td', { class: 'num' }, r.sale ? h('span', null, h('s', { class: 'faint' }, fmt.money(r.regular)), ' ', h('b', null, fmt.money(r.sale))) : fmt.money(r.price), r.priceMax > r.price ? h('div', { class: 'faint' }, 'έως ' + fmt.money(r.priceMax)) : null),
            h('td', { class: 'num' }, r.other ? h('span', { class: 'price-diff ' + (diff > 0 ? 'up' : diff < 0 ? 'down' : '') }, fmt.money(r.other.price)) : h('span', { class: 'faint' }, 'όχι')),
            h('td', null, App.adPill(r.ads, r.adsWhy), !r.inStock ? h('span', { class: 'pill' }, 'Εξαντλημένο') : null, !r.imgCount ? h('span', { class: 'pill warn' }, 'Χωρίς φωτό') : null, r.status !== 'publish' ? h('span', { class: 'pill' }, r.status === 'draft' ? 'Πρόχειρο' : 'Ιδιωτικό') : null),
            h('td', null, r.supplier || h('span', { class: 'faint' }, '—')));
          tbody.appendChild(tr);
        }
        tableBox.appendChild(h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl' },
          h('thead', null, h('tr', null, h('th', { class: 'w-check' }, allBox), h('th', null, ''), sortTh('Τίτλος', 'name'), h('th', null, 'Κωδικός'), sortTh('Μάρκα', 'brand'), sortTh('Τιμή', 'price', 'num'), h('th', { class: 'num' }, siteName(other)), h('th', null, 'Σημάδια'), h('th', null, 'Αντιπρόσωπος'))),
          tbody)));
        const pages = Math.ceil(data.total / data.per);
        tableBox.appendChild(h('div', { class: 'pager' },
          h('span', null, `${fmt.num(data.total)} προϊόντα · σελίδα ${data.page} από ${pages}`),
          h('div', { class: 'row tight' },
            select([['25', '25 ανά σελίδα'], ['50', '50 ανά σελίδα'], ['100', '100 ανά σελίδα'], ['250', '250 ανά σελίδα']], String(data.per), (v) => reload({ per: v })),
            btn('Προηγούμενη', { cls: 'sm', disabled: data.page <= 1 }, () => { q.page = data.page - 1; load(); }),
            btn('Επόμενη', { cls: 'sm', disabled: data.page >= pages }, () => { q.page = data.page + 1; load(); }))));
        renderBulk();
      }
      await load();
    },
  };

  async function openProduct(site, id) {
    let d;
    try { d = await GET('/api/product', { site, id }); } catch (e) { return fail(e); }
    const p = d.product;
    const other = site === 'sf' ? 'st' : 'sf';
    const body = h('div');
    const imgs = p.images || [];
    body.appendChild(dlgHead(p.name, null, drawer));
    // ONE box: what this product needs — the flow, the internet research, the SEO; every ready change with before /
    // after, approvable or written by hand right here (nothing goes to the site by itself: Διορθώσεις → file)
    body.appendChild(needsPanel(site, p.id, () => openProduct(site, id)));
    body.appendChild(h('div', { class: 'p-hero' },
      imgs[0] ? h('img', { class: 'img', src: imgs[0], alt: '', referrerpolicy: 'no-referrer' }) : h('div', { class: 'img thumb none', style: { width: '200px', height: '200px' } }, 'Χωρίς φωτογραφία'),
      h('div', { class: 'stack s' },
        h('div', { class: 'muted' }, 'Στην περιγραφή (Title Case): ', h('b', null, d.titleCase)),
        h('div', { class: 'row tight' }, sitePill(site), p.brand ? h('span', { class: 'pill' }, p.brand) : null, p.sku ? h('span', { class: 'pill mono' }, p.sku) : null, d.ads && d.ads.level !== 'ok' ? h('span', { class: 'ad ' + d.ads.level, title: App.AD[d.ads.level] }, App.AD[d.ads.level] + ': ' + d.ads.why) : null),
        h('div', { class: 'compare' },
          h('div', null, h('div', { class: 'muted' }, siteName(site)), h('b', null, fmt.money(p.price)), p.sale ? h('div', { class: 'faint' }, 'Κανονική ' + fmt.money(p.regular)) : null,
            h('div', { class: 'row tight', style: { marginTop: '8px' } }, btn('Στο site', { cls: 'sm', icon: 'ext' }, () => App.openUrl(p.url)), d.adminUrl ? btn('Άνοιγμα στο WordPress', { cls: 'sm primary', icon: 'edit' }, () => App.openUrl(d.adminUrl)) : null)),
          d.other ? h('div', null, h('div', { class: 'muted' }, siteName(other)), h('b', null, fmt.money(d.other.price)), Math.abs(d.other.price - p.price) > 0.009 ? h('div', { class: 'price-diff up' }, 'Διαφορά ' + fmt.money(d.other.price - p.price)) : h('div', { class: 'faint' }, 'Ίδια τιμή'),
            h('div', { class: 'row tight', style: { marginTop: '8px' } }, btn('Στο site', { cls: 'sm', icon: 'ext' }, () => App.openUrl(d.other.url)), btn('Άνοιγμα στο WordPress', { cls: 'sm', icon: 'edit' }, () => App.openUrl(d.other.adminUrl)), site === 'sf' ? btn('Αποσύνδεση', { cls: 'sm ghost', title: 'Δεν είναι το ίδιο προϊόν' }, () => POST('/api/link', { sfId: p.id, stId: 0 }).then(() => { toast('Αποσυνδέθηκαν.'); openProduct(site, id); })) : null),
            d.other.how ? h('div', { class: 'faint', style: { fontSize: '12px', marginTop: '4px' } }, 'Σύνδεση: ' + ({ sku: 'ίδιος κωδικός', name: 'ίδιος τίτλος', slug: 'ίδιο slug', manual: 'χειροκίνητα' }[d.other.how] || d.other.how)) : null)
            : h('div', null, h('div', { class: 'muted' }, siteName(other)), h('b', { class: 'faint' }, 'Δεν υπάρχει'), site === 'sf' ? h('div', { class: 'row tight', style: { marginTop: '8px' } }, btn('Σύνδεση με υπάρχον', { cls: 'sm', icon: 'link' }, () => linkDialog(p, () => openProduct(site, id))), d.ads && d.ads.level === 'banned' ? null : btn('Αρχείο μεταφοράς', { cls: 'sm', icon: 'file' }, () => POST('/api/transfer', { ids: [p.id] }).then((r) => (r.count ? fileReady(r, { site: 'st', kind: 'new' }) : toast(r.skipped[0].why, { err: true }))).catch(fail))) : null)))));

    if (imgs.length > 1) body.appendChild(h('div', { class: 'gallery', style: { marginBottom: '16px' } }, imgs.map((src) => h('img', { src, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' }))));

    // 1. the price comparison with the competitors on our list (their catalogs) — apart from the internet research
    const mk = d.market;
    const mkPanel = h('div', { class: 'panel' }, h('div', { class: 'row', style: { justifyContent: 'space-between', flexWrap: 'wrap', gap: '6px' } }, h('h2', null, 'Σύγκριση τιμών ανταγωνιστών'),
      h('div', { class: 'row tight', style: { flexWrap: 'wrap' } }, btn('Νέα έρευνα τιμών ανταγωνιστών', { cls: 'sm', icon: 'market', title: 'Οι κατάλογοι των καταστημάτων της λίστας ανταγωνιστών' }, () => POST('/api/market/run', { targets: [{ site, id: p.id }] }).then((job) => watchJob(job, { done: () => openProduct(site, id) })).catch(fail)),
        btn('Χειροκίνητη τιμή', { cls: 'sm' }, () => App.manualPrice(site, p.id, () => openProduct(site, id))))));
    if (mk && mk.stats) {
      mkPanel.appendChild(App.marketSummary(mk, p.price, mk.master ? null : { site, id: p.id, refresh: () => openProduct(site, id) }));
    } else mkPanel.appendChild(h('p', { class: 'muted' }, 'Δεν έχει γίνει ακόμα σύγκριση με τους καταχωρισμένους ανταγωνιστές για αυτό το προϊόν (η έρευνα στο internet είναι πιο κάτω).'));
    body.appendChild(mkPanel);
    // 2. the research on the whole internet (any shop, maker, supplier) — always possible, also with code and EAN
    body.appendChild(researchPanel(site, p.id, () => openProduct(site, id)));
    // 3. the family: the same model as separate products, one per colour
    body.appendChild(familyPanel(site, p.id));
    // 4. the page as Google reads it · 5. the AI's proposal (title, features), from the real facts only
    body.appendChild(seoPanel(site, p.id));
    body.appendChild(aiPanel(site, p.id));

    // Supplier, categories, attributes
    body.appendChild(h('div', { class: 'panel' }, h('h2', null, 'Στοιχεία'),
      h('dl', { class: 'kv' },
        h('dt', null, 'Κατηγορίες'), h('dd', null, p.catNames.join(', ') || '—'),
        h('dt', null, 'Αντιπρόσωπος'), h('dd', null, d.supplier ? h('a', { href: '#/suppliers?id=' + d.supplier.id }, d.supplier.name) : h('span', { class: 'faint' }, p.brand ? `Καμία αντιστοίχιση για τη μάρκα ${p.brand}` : 'Χωρίς μάρκα')),
        h('dt', null, 'Ιδιότητες'), h('dd', null, p.attrs.length ? p.attrs.map((a) => `${a.name}: ${a.terms.join(', ')}`).join(' — ') : '—'),
        h('dt', null, 'Κατάσταση'), h('dd', null, p.inStock ? 'Διαθέσιμο στο site' : 'Εξαντλημένο στο site'),
        h('dt', null, 'Τιμή κόστους'), h('dd', null, costField(site, Object.assign({ cost: d.cost }, p))))));

    if (d.variations.length) {
      body.appendChild(h('div', { class: 'panel flush' }, h('div', { style: { padding: '14px 18px 4px' } }, h('h2', null, `Παραλλαγές (${d.variations.length})`)),
        h('table', { class: 'tbl' }, h('thead', null, h('tr', null, h('th', null, 'Παραλλαγή'), h('th', null, 'Κωδικός'), h('th', { class: 'num' }, 'Τιμή'), h('th', null, 'Διαθέσιμο'))),
          h('tbody', null, d.variations.map((v) => h('tr', null, h('td', null, v.varLabel || v.name), h('td', { class: 'mono' }, v.sku || '—'), h('td', { class: 'num' }, fmt.money(v.price)), h('td', null, v.inStock ? 'Ναι' : 'Όχι')))))));
    }
    body.appendChild(h('div', { class: 'section-title' }, h('h2', null, 'Περιγραφή'), h('span', { class: 'faint' }, `${p.descLen + p.shortLen} χαρακτήρες`)));
    body.appendChild(sandboxPreview((p.short ? p.short + '<hr>' : '') + p.desc));
    drawer.open(body, { wide: false });
  }
  App.openProduct = openProduct;

  /** The research on the internet for a product: its state, every search, every result and page (all kept, page by page), the sources of each value. */
  const RS = { complete: ['Ολοκληρώθηκε με αποτελέσματα', 'ok'], partial: ['Ολοκληρώθηκε με ελλείψεις', 'warn'], family_only: ['Βρέθηκε μόνο άλλη παραλλαγή του μοντέλου', 'warn'], not_found: ['Ολοκληρώθηκε: δεν βρέθηκε ακριβές προϊόν', ''],
    no_results: ['Ολοκληρώθηκε: καμία σελίδα καταστήματος', ''], pages_failed: ['Δεν διαβάστηκαν οι σελίδες', 'crit'], search_failed: ['Απέτυχαν οι μηχανές αναζήτησης', 'crit'], blocked: ['Μπλοκαρίστηκε προσωρινά (συνεχίζει)', 'warn'],
    coverage_limited: ['Περιορισμένη κάλυψη — λίγες μηχανές απάντησαν, όχι «δεν υπάρχει» (ξαναδοκιμάζει σύντομα)', 'warn'],
    cancelled: ['Διακόπηκε', 'warn'], error: ['Σφάλμα', 'crit'], due: ['Χρειάζεται επανάληψη', 'warn'], stale: ['Παρωχημένη έρευνα', 'warn'], never: ['Δεν έχει ξεκινήσει', ''], queued: ['Σε αναμονή', 'warn'], running: ['Σε εξέλιξη', 'warn'] };
  const PO = { same: 'ίδιο προϊόν', family: 'άλλη παραλλαγή', similar: 'παρόμοιο', other: 'άλλο προϊόν', duplicate: 'ίδιο (2η σελίδα)', error: 'δεν άνοιξε', no_data: 'χωρίς στοιχεία', not_product: 'όχι προϊόν', skipped: 'παραλείφθηκε' };
  const CLS = { competitor: 'ανταγωνιστής', shop: 'νέο κατάστημα', maker: 'κατασκευαστής', supplier: 'προμηθευτής', marketplace: 'marketplace', irrelevant: 'άσχετο', own: 'δικό μας' };
  const NEED = { sku: 'κωδικός', ean: 'EAN', images: 'φωτογραφίες', brand: 'μάρκα', price: 'τιμή' };
  const WHY = { 'exact-model': 'ακριβές μοντέλο σε εισαγωγικά', 'model-words': 'μοντέλο χωρίς κωδικό', 'exact-title': 'ακριβής λατινικός τίτλος', greek: 'ελληνικό είδος+μοντέλο', 'brand-alt': 'άλλη γραφή μάρκας', code: 'κωδικός', ean: 'EAN', exact: 'ακριβές μοντέλο+χρώμα', title: 'τίτλος', model: 'μάρκα+μοντέλο', family: 'οικογένεια (χωρίς χρώμα)', 'code-alone': 'κωδικός μόνος', 'code-flat': 'κωδικός χωρίς παύλες', mpn: 'κωδικός κατασκευαστή', english: 'αγγλικά', latin: 'λατινικοί όροι', nobrand: 'χωρίς μάρκα', codes: 'κωδικός τίτλου', ai: 'πρόταση AI', catalog: 'κατάλογοι ανταγωνιστών' };
  const link = (url, text) => h('a', { href: url, target: '_blank', rel: 'noopener noreferrer' }, text || url);
  const google = (q) => link('https://www.google.com/search?q=' + encodeURIComponent(q), 'Google ↗');
  function researchPanel(site, id, refresh) {
    const box = h('div', { style: { marginTop: '8px' } }, h('span', { class: 'muted' }, 'Φόρτωση…'));
    const panel = h('div', { class: 'panel' }, h('div', { class: 'row', style: { justifyContent: 'space-between', flexWrap: 'wrap', gap: '6px' } }, h('h2', null, 'Εκτενής έρευνα Internet'),
      h('div', { class: 'row tight', style: { flexWrap: 'wrap' } },
        btn('Πλήρης έρευνα Internet', { cls: 'sm primary', icon: 'search', title: 'Όλο το πλάνο αναζητήσεων, σε κάθε κατάστημα του internet (και όταν έχει ήδη κωδικό / EAN)' }, () => POST('/api/codes/find', { site, id, mode: 'full' }).then((job) => watchJob(job, { done: () => { toast('Ό,τι βρέθηκε είναι στις Διορθώσεις και στις Τιμές, για έγκριση.'); refresh(); } })).catch(fail)))), box);
    const pageOf = { pages: 1, results: 1 };
    const load = async () => {
      try {
        const t = await GET('/api/codes/trace', { site, id, page: Math.max(pageOf.pages, pageOf.results), per: 40 });
        clear(box);
        const st = RS[t.status] || [t.status, ''];
        box.appendChild(h('div', { class: 'row tight', style: { flexWrap: 'wrap', gap: '6px' } }, h('span', { class: 'pill ' + st[1] }, st[0]), t.mode === 'full' ? h('span', { class: 'pill' }, 'πλήρης') : null,
          t.at ? h('span', { class: 'faint' }, 'Τελευταία: ' + fmt.ago(t.at)) : null, t.okAt ? h('span', { class: 'faint' }, '· επιτυχής: ' + fmt.ago(t.okAt)) : null,
          (t.needsLeft || []).length ? h('span', { class: 'faint' }, '· λείπουν ακόμα: ' + t.needsLeft.map((x) => NEED[x] || x).join(', ')) : null));
        if (t.status === 'never') { box.appendChild(h('p', { class: 'faint' }, 'Πάτα «Πλήρης έρευνα Internet»: αναζητήσεις σε όλο το internet (όχι μόνο στους ανταγωνιστές), με κάθε πηγή εδώ.')); return; }
        const s = t.sum;
        if (s) box.appendChild(h('p', { class: 'faint', style: { margin: '6px 0' } }, `${s.queries} αναζητήσεις · ${s.results} αποτελέσματα · ${s.domains || 0} sites (${s.newShops || 0} νέα) · άνοιξαν ${s.opened} σελίδες, διαβάστηκαν ${s.read} · ίδιο προϊόν σε ${s.exact} · άλλη παραλλαγή σε ${s.family || 0} · απορρίφθηκαν ${s.rejected} · σφάλματα ${s.errors}` + (s.engines ? ' · μηχανές: ' + Object.entries(s.engines).map(([k, e]) => `${k} ${e.ok}✓${e.failed ? ' ' + e.failed + '✗' : ''}${e.blocked ? ' ' + e.blocked + '⏸' : ''}`).join(', ') : '')));
        const cv = t.coverage;
        if (t.stopWord || cv) box.appendChild(h('p', { class: 'faint', style: { margin: '4px 0' } }, [t.stopWord ? 'Σταμάτησε: ' + t.stopWord : '',
          cv ? `κάλυψη ${cv.level === 'adequate' ? 'επαρκής' : cv.level === 'limited' ? 'ΠΕΡΙΟΡΙΣΜΕΝΗ' : 'άγνωστη'} (απάντησαν: ${(cv.ok || []).join(', ') || 'καμία μηχανή'}${(cv.failed || []).length ? ' · απέτυχαν: ' + cv.failed.join(', ') : ''} · ${cv.queries}/${cv.planned} αναζητήσεις του πλάνου)` : '',
          t.ms ? 'χρόνος ' + Math.round(t.ms / 1000) + '″' : ''].filter(Boolean).join(' · ')));
        if ((t.quality || []).length) box.appendChild(h('div', { class: 'note', style: { margin: '6px 0' } }, h('b', null, 'Να το δεις: '), t.quality.join(' · ')));
        // the sources of each value: only «the same variant»
        if ((t.hits || []).length) box.appendChild(h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl' }, h('thead', null, h('tr', null, h('th', null, 'Πηγή'), h('th', null, 'Κωδικός / EAN'), h('th', { class: 'num' }, 'Τιμή'), h('th', null, 'Απόθεμα'), h('th', null, 'Φωτο'), h('th', null, 'Απόδειξη'))),
          h('tbody', null, t.hits.map((x) => h('tr', null, h('td', null, link(x.url, x.host), h('div', { class: 'faint', style: { fontSize: '12px' } }, (CLS[x.cls] || '') + ' · ' + fmt.ago(x.at))), h('td', { class: 'mono' }, [x.code, x.ean].filter(Boolean).join(' · ') || '—'),
            h('td', { class: 'num' }, x.price ? fmt.money(x.price) : '—'), h('td', null, x.avail === 'in' ? 'διαθέσιμο' : x.avail === 'out' ? 'εξαντλημένο' : 'άγνωστο'), h('td', null, (x.images || []).length ? `${x.images.length} (${{ variant: 'της παραλλαγής', page: 'σελίδα ενός χρώματος', filename: 'όνομα αρχείου' }[x.imgHow] || '-'})` : '—'), h('td', { class: 'faint' }, x.proof)))))));
        if ((t.family || []).length) box.appendChild(h('details', null, h('summary', null, `Άλλες παραλλαγές του ίδιου μοντέλου (${t.family.length}) — δεν δίνουν κωδικό, EAN, φωτογραφία ή τιμή για αυτό το προϊόν`),
          h('ul', { class: 'todo-list' }, t.family.map((x) => h('li', null, link(x.url, x.host), ' — ', x.name, x.colour ? h('span', { class: 'pill' }, x.colour) : null, x.price ? ' · ' + fmt.money(x.price) : '', (x.variants || []).length ? h('div', { class: 'faint' }, 'Παραλλαγές της σελίδας: ' + x.variants.map((v) => [v.colour, v.size].filter(Boolean).join(' ')).join(', ')) : null)))));
        if ((t.queries || []).length) box.appendChild(h('details', null, h('summary', null, `Αναζητήσεις (${t.queries.length})`), h('ul', { class: 'todo-list' }, t.queries.map((q) => h('li', null, h('span', { class: 'mono' }, q.q), ' ', h('span', { class: 'pill' }, WHY[q.why] || q.why || ''), ` → ${q.n} αποτελέσματα `, q.why !== 'catalog' ? google(q.q.replace(/"/g, '')) : null, q.error ? h('span', { class: 'crit' }, ' · ' + q.error) : null,
          (q.engines || []).length ? h('div', { class: 'faint' }, q.engines.map((e) => e.id + ': ' + (e.state === 'ok' ? e.n + ' αποτελέσματα' : e.state === 'blocked' || e.state === 'paused' ? 'παύση' : e.state === 'quota' ? 'όριο ημέρας' : 'σφάλμα' + (e.error ? ' (' + e.error + ')' : ''))).join(' · ')) : null)))));
        if (t.totals && t.totals.results) box.appendChild(h('details', null, h('summary', null, `Αποτελέσματα αναζήτησης (${t.totals.results})`), h('ul', { class: 'todo-list' }, (t.results || []).map((x) => h('li', null, link(x.url, x.host), ' ', h('span', { class: 'pill' }, CLS[x.cls] || x.cls), x.title ? ' — ' + x.title : '', x.snippet ? h('div', { class: 'faint', style: { fontSize: '12px' } }, x.snippet) : null, h('span', { class: 'faint' }, ` · ${x.engine}${x.rank != null ? ' #' + (x.rank + 1) : ''} · ${x.open === 'ναι' ? 'άνοιξε' : 'δεν άνοιξε: ' + x.open}`)))),
          t.totals.results > t.page * t.per ? btn('Περισσότερα', { cls: 'sm' }, () => { pageOf.results++; load(); }) : null));
        if (t.totals && t.totals.pages) box.appendChild(h('details', { open: true }, h('summary', null, `Σελίδες που διαβάστηκαν (${t.totals.pages})`), h('ul', { class: 'todo-list' }, (t.pages || []).map((x) => h('li', { class: x.outcome === 'error' ? 'crit' : x.outcome === 'family' || x.outcome === 'similar' ? 'warn' : '' }, h('b', null, (PO[x.outcome] || x.outcome) + ': '), link(x.url, x.host), x.cls ? h('span', { class: 'faint' }, ' (' + (CLS[x.cls] || x.cls) + ')') : null,
          x.title ? h('div', null, x.title) : null, x.why ? h('div', { class: 'faint' }, x.why) : null,
          x.facts && (x.facts.sku || x.facts.ean || x.facts.price) ? h('div', { class: 'faint' }, [x.facts.sku && 'κωδ. ' + x.facts.sku, x.facts.ean && 'EAN ' + x.facts.ean, x.facts.price && fmt.money(x.facts.price), x.facts.colour && 'χρώμα ' + x.facts.colour].filter(Boolean).join(' · ')) : null,
          x.ai ? h('div', { class: 'faint' }, `AI: ${x.ai.verdict} — ${x.ai.reason}`) : null))),
          t.totals.pages > t.page * t.per ? btn('Περισσότερα', { cls: 'sm' }, () => { pageOf.pages++; load(); }) : null));
        if (t.nextAt) box.appendChild(h('p', { class: 'faint', style: { margin: '6px 0 0' } }, 'Επόμενη αναζήτηση για ό,τι λείπει: ' + new Date(t.nextAt).toLocaleDateString('el-GR')));
      } catch (e) { clear(box).appendChild(h('div', { class: 'note crit' }, e.message)); }
    };
    load();
    return panel;
  }

  /** The same model as separate products, one per colour: the family, a yes, the files of one page with the colours. */
  function familyPanel(site, id) {
    const box = h('div');
    (async () => {
      try {
        const f = await GET('/api/families/of', { site, id });
        if (!f || f.none) return;
        const sure = f.proof === 'confirmed';
        const st = !sure && f.status !== 'rejected' ? ['Πιθανή οικογένεια', ''] : ({ pending: ['Πρόταση', 'warn'], approved: ['Εγκρίθηκε', 'ok'], rejected: ['Απορρίφθηκε', ''] }[f.status] || ['', '']);
        const decide = (answer) => POST('/api/families/decide', { site, key: f.key, answer }).then(() => { toast(answer === 'approved' ? 'Εγκρίθηκε η οικογένεια.' : answer === 'rejected' ? 'Απορρίφθηκε.' : 'Επαναφορά.'); clear(box); box.appendChild(familyPanel(site, id)); }).catch(fail);
        box.appendChild(h('div', { class: 'panel' }, h('div', { class: 'row', style: { justifyContent: 'space-between', flexWrap: 'wrap', gap: '6px' } }, h('h2', null, 'Οικογένεια προϊόντος'), h('span', { class: 'pill ' + st[1] }, st[0] + ' · σιγουριά ' + f.confidence + '%')),
          h('p', null, h('b', null, f.title), ` — το ίδιο μοντέλο σε ${f.members.length} χρώματα, σήμερα ως ξεχωριστά προϊόντα.`),
          h('ul', { class: 'todo-list' }, f.members.map((m) => h('li', null, h('span', { class: 'pill' }, m.colour), ' ', link(m.url, m.name), h('div', { class: 'faint' }, [m.sku && 'κωδ. ' + m.sku, m.ean && 'EAN ' + m.ean, fmt.money(m.price), m.inStock ? 'διαθέσιμο' : 'εξαντλημένο', `${m.images.length} φωτο`].filter(Boolean).join(' · '))))),
          h('div', { class: 'faint' }, 'Απόδειξη: ' + f.evidence.join(' · ') + (f.webColours.length ? ` · στο internet υπάρχει και σε: ${f.webColours.join(', ')}` : '')),
          (f.proofSources || []).length ? h('div', { class: 'faint' }, 'Καταστήματα που το δείχνουν σε χρώματα: ', (f.proofSources || []).map((x, i) => h('span', null, i ? ' · ' : '', x.urls[0] ? link(x.urls[0], x.site) : x.site, ' (' + x.colours.join(', ') + ')'))) : null,
          !sure ? h('p', { class: 'faint' }, 'Μοιάζει με ένα μοντέλο σε χρώματα, αλλά δεν το επιβεβαιώνουν ακόμα 2 ανεξάρτητα καταστήματα — γι\'αυτό δεν προτείνεται μετατροπή. Τρέξε «Έρευνα internet» στα μέλη της.') : null,
          h('div', { class: 'row tight', style: { marginTop: '8px', flexWrap: 'wrap' } },
            sure && f.status !== 'approved' ? btn('Έγκριση: είναι το ίδιο μοντέλο', { cls: 'sm primary', icon: 'check' }, () => decide('approved')) : null,
            f.status !== 'rejected' ? btn('Όχι, άλλα προϊόντα', { cls: 'sm ghost' }, () => decide('rejected')) : null,
            f.status !== 'pending' ? btn('Επαναφορά', { cls: 'sm ghost' }, () => decide('')) : null,
            sure && f.status === 'approved' ? btn('Αρχεία μετατροπής σε ένα προϊόν με χρώματα', { cls: 'sm', icon: 'download' }, () => familyExport(site, f)) : null)));
      } catch (_) { /* nothing to show */ }
    })();
    return box;
  }
  async function familiesDrawer(site) {
    const body = h('div', { class: 'stack' }, h('h2', null, 'Οικογένειες προϊόντων · ' + siteName(site)), h('span', { class: 'muted' }, 'Φόρτωση…'));
    drawer.open(body, { wide: true });
    try {
      const list = await GET('/api/families', { site });
      body.lastChild.remove();
      body.appendChild(h('p', { class: 'muted' }, `${list.filter((f) => f.proof === 'confirmed').length} επιβεβαιωμένες (το δείχνουν ≥2 ανεξάρτητα καταστήματα σε χρώματα) · ${list.filter((f) => f.proof !== 'confirmed').length} πιθανές (μόνο μοιάζουν: ίδιο είδος, μάρκα, λέξεις μοντέλου, άλλο χρώμα — χωρίς πρόταση μετατροπής). Τίποτα δεν ενώνεται μόνο του: έγκριση → αρχεία για το WooCommerce.`));
      for (const f of list) body.appendChild(h('div', { class: 'panel' }, h('div', { class: 'row', style: { justifyContent: 'space-between', flexWrap: 'wrap', gap: '6px' } }, h('b', null, f.title), h('span', { class: 'pill ' + (f.proof !== 'confirmed' && f.status !== 'rejected' ? '' : f.status === 'approved' ? 'ok' : f.status === 'rejected' ? '' : 'warn') }, (f.proof !== 'confirmed' && f.status !== 'rejected' ? 'πιθανή οικογένεια' : ({ pending: 'πρόταση', approved: 'εγκρίθηκε', rejected: 'απορρίφθηκε' })[f.status]) + ' · ' + f.confidence + '%')),
        h('div', { class: 'row tight', style: { flexWrap: 'wrap', marginTop: '6px' } }, f.members.map((m) => h('button', { class: 'btn sm ghost', onclick: () => openProduct(site, m.id) }, m.colour + (m.sku ? ' · ' + m.sku : '') + ' · ' + fmt.money(m.price))))));
      if (!list.length) body.appendChild(h('p', { class: 'faint' }, 'Καμία.'));
    } catch (e) { fail(e); }
  }
  function familyExport(site, f) {
    const sku = h('input', { type: 'text', placeholder: 'κωδικός του νέου προϊόντος' });
    const mode = select([['own', 'Κάθε χρώμα κρατά τον κωδικό του — όπως ζητά η Google'], ['same', 'Ένας κωδικός για όλα τα χρώματα']], App.state.settings && App.state.settings.variantSku === 'same' ? 'same' : 'own', () => {});
    const out = h('div');
    modal.open(h('div', { class: 'stack s' }, dlgHead('Αρχεία μετατροπής: ' + f.title),
      h('p', { class: 'faint' }, 'Τίποτα δεν αλλάζει στο site μέχρι να ανεβάσεις τα αρχεία, με τη σειρά. Τα παλιά προϊόντα γίνονται «Πρόχειρο» (δεν σβήνονται) και οι παλιές διευθύνσεις οδηγούν με 301 στο νέο προϊόν, με το σωστό χρώμα επιλεγμένο.'),
      h('label', { class: 'field' }, 'Κωδικός του νέου προϊόντος (κενό = το κοινό μέρος των κωδικών, αν υπάρχει)', sku), h('label', { class: 'field' }, 'Κωδικοί παραλλαγών', mode),
      btn('Φτιάξε τα αρχεία', { cls: 'primary', icon: 'download' }, () => POST('/api/families/export', { site, key: f.key, parentSku: sku.value, variantSkus: mode.value }).then((r) => {
        clear(out).appendChild(h('div', { class: 'stack s' }, h('ol', { class: 'steps' }, r.files.map((x) => h('li', null, x.what, ' — ', h('a', { href: x.url, download: x.name }, x.name)))), (r.notes || []).map((n) => h('div', { class: 'note' }, n))));
      }).catch(fail)), out));
  }

  /** The live page as Google reads it. */
  /** «Τι θέλει αυτό το προϊόν»: the three states side by side (never mixed), the ready changes (before / after, why,
   *  source, how sure) with «Έγκριση» / «Όχι» / «Αλλαγή» right here, then what still needs a look. Nothing is searched
   *  on opening, except the normal research of a product without a real code (once, in the queue). */
  function needsPanel(site, id, refresh) {
    const box = h('div', { class: 'panel needs' }, h('h2', null, 'Τι θέλει αυτό το προϊόν'), h('span', { class: 'muted' }, 'Έλεγχος…'));
    const LV = { crit: 'Πρέπει', warn: 'Καλό να γίνει', info: 'Για ενημέρωση', ok: 'Εντάξει' };
    const RW = { complete: 'ok', partial: 'warn', family_only: 'warn', coverage_limited: 'warn', not_found: '', no_results: '', never: '', stale: 'warn', due: 'warn', search_failed: 'crit', pages_failed: 'crit', blocked: 'warn', error: 'crit', cancelled: 'warn', running: 'warn', queued: 'warn' };
    const SW = { never: ['SEO: δεν έχει ελεγχθεί', ''], stale: ['SEO: παλιός έλεγχος', 'warn'], crit: ['SEO: σοβαρά θέματα', 'crit'], warn: ['SEO: θέλει βελτίωση', 'warn'], ok: ['SEO: εντάξει', 'ok'] };
    const decide = (ids, status) => POST('/api/fixes/decide', { ids, status }).then(() => { toast(status === 'approved' ? 'Εγκρίθηκε — μπαίνει στο αρχείο των Διορθώσεων.' : 'Απορρίφθηκε.'); refresh(); }).catch(fail);
    // write it by hand: the person's text counts as the approval
    const editor = (field, value, html) => {
      const inp = field === 'name' ? h('input', { type: 'text', value: value || '', style: { width: '100%' } }) : h('textarea', { rows: field === 'desc' ? 8 : 3, style: { width: '100%' } }, html || value || '');
      const wrap = h('div', { class: 'stack s', style: { marginTop: '6px' } }, inp,
        h('div', { class: 'row tight' }, btn('Αποθήκευση (εγκρίνεται)', { cls: 'sm primary', icon: 'check' }, () => POST('/api/fixes/manual', { site, id, field, value: inp.value }).then((r) => { toast('Αποθηκεύτηκε και εγκρίθηκε: ' + (typeof r.to === 'string' ? r.to.slice(0, 80) : 'νέο κείμενο') + '. Πάει στο αρχείο των Διορθώσεων.'); refresh(); }).catch(fail)),
          btn('Άκυρο', { cls: 'sm ghost' }, () => wrap.remove())),
        field === 'name' ? h('div', { class: 'faint' }, 'Μόνο κεφαλαία, ΕΙΔΟΣ ΜΑΡΚΑ ΜΟΝΤΕΛΟ [ΧΡΩΜΑ], χωρίς κωδικό (γίνεται μόνο του).') : null);
      return wrap;
    };
    (async () => {
      let r;
      try { r = await GET('/api/quality', { site, id }); } catch (e) { box.lastChild.replaceWith(h('div', { class: 'faint' }, e.message)); return; }
      box.lastChild.remove();
      const st = r.statuses, rs = st.research, ss = SW[st.seo.state] || SW.never;
      const done = st.flow.stage >= 5 && !r.proposals.length && !r.counts.crit;
      box.firstChild.textContent = done ? '✓ Το προϊόν είναι έτοιμο' : 'Τι θέλει αυτό το προϊόν';
      box.appendChild(h('div', { class: 'row tight', style: { flexWrap: 'wrap', gap: '6px' } },
        h('span', { class: 'pill' + (st.flow.stage >= 5 ? ' ok' : ''), title: 'Η ροή εργασίας του καταστήματος' }, 'Ροή: ' + st.flow.label),
        h('span', { class: 'pill ' + (RW[rs.state] || '') }, 'Internet: ' + rs.label + (rs.at ? ' · ' + fmt.ago(rs.okAt || rs.at) : '')),
        h('span', { class: 'pill ' + ss[1] }, ss[0] + (st.seo.at ? ' · ' + fmt.ago(st.seo.at) : ''))));
      if (rs.autoQueued) box.appendChild(h('div', { class: 'note', style: { margin: '8px 0' } }, 'Δεν έχει πραγματικό κωδικό: η έρευνα στο internet ξεκίνησε μόνη της (κωδικός, EAN, φωτογραφίες, τιμή). Ό,τι βρεθεί εμφανίζεται εδώ για έγκριση.'));
      else if (r.needsResearch) box.appendChild(h('div', { class: 'note', style: { margin: '8px 0' } }, rs.state === 'never' ? 'Δεν έχει γίνει έρευνα στο internet. ' : rs.stale ? 'Η έρευνα στο internet είναι παλιά. ' : 'Λείπουν σημαντικά στοιχεία. ',
        btn('Πλήρης έρευνα Internet', { cls: 'sm primary', icon: 'search' }, () => POST('/api/codes/find', { site, id, mode: 'full' }).then((job) => watchJob(job, { done: () => { toast('Ό,τι βρέθηκε είναι εδώ για έγκριση.'); refresh(); } })).catch(fail))));
      // 1. the ready changes, approvable or written by hand here
      if (r.proposals.length) {
        box.appendChild(h('h3', { class: 'needs-h' }, `Έτοιμες αλλαγές (${r.proposals.length})`));
        for (const c of r.proposals) {
          const card = h('div', { class: 'fx-mini' },
            h('div', { class: 'row', style: { justifyContent: 'space-between', gap: '6px', flexWrap: 'wrap' } }, h('b', null, c.label), h('span', { class: 'pill ' + (c.level === 'high' ? 'ok' : 'warn') }, 'Σιγουριά ' + (c.confidence || '') + '%')),
            c.from || c.to ? h('div', { class: 'ba' }, c.from ? h('div', null, h('span', { class: 'faint' }, 'Πριν: '), h('span', { class: 'strike' }, c.from)) : null, h('div', null, h('span', { class: 'faint' }, 'Μετά: '), h('b', null, c.to || '—'))) : null,
            c.why ? h('div', { class: 'faint' }, c.why) : null,
            c.source ? h('div', { class: 'faint' }, 'Πηγή: ', c.source.url ? link(c.source.url, c.source.label) : c.source.label) : null);
          const row = h('div', { class: 'row tight', style: { marginTop: '6px', flexWrap: 'wrap' } },
            btn('Έγκριση', { cls: 'sm primary', icon: 'check' }, () => decide([c.id], 'approved')),
            btn('Όχι', { cls: 'sm ghost' }, () => decide([c.id], 'rejected')),
            c.editable ? btn('Αλλαγή', { cls: 'sm', icon: 'edit' }, () => { if (!card.querySelector('.stack')) card.appendChild(editor(c.field, c.field === 'name' ? (c.to || r.current.name) : '', c.html || (c.field === 'short' ? r.current.short : ''))); }) : null);
          card.appendChild(row);
          box.appendChild(card);
        }
        if (r.proposals.length > 1) box.appendChild(h('div', { class: 'row tight', style: { marginTop: '6px' } }, btn('Έγκριση όλων', { cls: 'sm', icon: 'check' }, () => decide(r.proposals.map((c) => c.id), 'approved'))));
      }
      // 2. by hand, also without a proposal: the title, the short text
      const manual = h('div', { class: 'row tight', style: { marginTop: '10px', flexWrap: 'wrap' } });
      const slot = h('div');
      if (!r.proposals.some((c) => c.field === 'name')) manual.appendChild(btn('Αλλαγή τίτλου', { cls: 'sm ghost', icon: 'edit' }, () => { clear(slot).appendChild(editor('name', r.current.name)); }));
      if (!r.proposals.some((c) => c.field === 'short')) manual.appendChild(btn('Αλλαγή σύντομης περιγραφής', { cls: 'sm ghost', icon: 'edit' }, () => { clear(slot).appendChild(editor('short', '', r.current.short)); }));
      box.appendChild(manual); box.appendChild(slot);
      if (r.approved.length) box.appendChild(h('p', { class: 'faint', style: { margin: '8px 0 0' } }, `Εγκεκριμένες, περιμένουν το αρχείο για το site (Διορθώσεις → Αρχείο): ${r.approved.map((a) => a.label + (a.to ? ' → ' + a.to.slice(0, 60) : '')).join(' · ')}`));
      // 3. what still needs a look (the findings that are not already a ready change above)
      const shown = new Set(r.proposals.map((c) => c.id));
      const areas = r.areas.filter((a) => !(a.fixes || []).some((x) => shown.has(x)));
      for (const lv of ['crit', 'warn', 'info']) {
        const list = areas.filter((a) => a.level === lv);
        if (!list.length) continue;
        const ul = h('ul', { class: 'todo-list' }, list.map((a) => h('li', { class: lv === 'crit' ? 'crit' : lv === 'warn' ? 'warn' : '' }, h('b', null, a.area + ': '), a.text, a.fix ? h('div', { class: 'faint' }, a.fix) : null)));
        box.appendChild(lv === 'info' ? h('details', { open: list.length <= 3 }, h('summary', null, `${LV[lv]} (${list.length})`), ul) : h('div', null, h('h3', { class: 'needs-h' }, `${LV[lv]} (${list.length})`), ul));
      }
      if (done) box.classList.add('done');
    })();
    return box;
  }
  function seoPanel(site, id) {
    const out = h('div');
    return h('div', { class: 'panel' }, h('div', { class: 'row', style: { justifyContent: 'space-between', flexWrap: 'wrap', gap: '6px' } }, h('h2', null, 'SEO της σελίδας'),
      btn('Έλεγχος SEO', { cls: 'sm', icon: 'search', title: 'Διαβάζει τη σελίδα του site όπως το Google: canonical, δομημένα δεδομένα, παραλλαγές, φωτογραφίες' }, () => { clear(out).appendChild(h('span', { class: 'muted' }, 'Ανάγνωση της σελίδας…')); GET('/api/seo/audit', { site, id }).then((r) => {
        clear(out).appendChild(h('ul', { class: 'todo-list' }, r.findings.map((x) => h('li', { class: x.level === 'crit' ? 'crit' : x.level === 'warn' ? 'warn' : '' }, h('b', null, x.area + ': '), x.text, x.fix ? h('div', { class: 'faint' }, x.fix) : null))));
      }).catch((e) => { clear(out).appendChild(h('div', { class: 'note crit' }, e.message)); }); })), out);
  }

  /** The AI's proposal for the title, features and category (from the real facts; shown, never applied by itself). */
  function aiPanel(site, id) {
    const out = h('div');
    if (!(App.state.settings && App.state.settings.localAI && App.state.settings.localAI.enabled)) return h('div');
    return h('div', { class: 'panel' }, h('div', { class: 'row', style: { justifyContent: 'space-between', flexWrap: 'wrap', gap: '6px' } }, h('h2', null, 'Πρόταση AI'),
      btn('Πρότεινε τίτλο και χαρακτηριστικά', { cls: 'sm', icon: 'bolt', title: 'Από τα πραγματικά στοιχεία του προϊόντος και των πηγών του· τίποτα δεν αλλάζει μόνο του' }, () => { clear(out).appendChild(h('span', { class: 'muted' }, 'Το AI του υπολογιστή γράφει…')); POST('/api/ai/suggest', { site, id }).then((r) => {
        clear(out).appendChild(h('div', { class: 'stack s' }, r.title ? h('div', null, h('b', null, 'Τίτλος: '), r.title) : h('div', { class: 'faint' }, 'Κανένας τίτλος που να τηρεί τους κανόνες.'), (r.features || []).length ? h('ul', null, r.features.map((x) => h('li', null, x))) : null,
          r.category ? h('div', null, h('b', null, 'Κατηγορία: '), r.category) : null, (r.removed || []).length ? h('div', { class: 'note' }, `Αφαιρέθηκαν ${r.removed.length} γραμμές με αριθμούς που δεν υπάρχουν στα στοιχεία.`) : null,
          h('div', { class: 'faint' }, `${r.model || ''}${r.ms ? ' · ' + Math.round(r.ms / 1000) + '″' : ''}${r.cached ? ' · από την προσωρινή μνήμη' : ''}`)));
      }).catch((e) => { clear(out).appendChild(h('div', { class: 'note crit' }, e.message)); }); })), out);
  }

  function costField(site, p) {
    const inp = h('input', { type: 'text', placeholder: 'χωρίς ΦΠΑ', style: { width: '120px' }, value: p.cost ? String(p.cost.cost).replace('.', ',') : '' });
    const save = btn('Αποθήκευση', { cls: 'sm' }, () => POST('/api/cost', { site, id: p.id, cost: inp.value }).then(() => toast('Αποθηκεύτηκε. Χρησιμοποιείται ως κατώτατο όριο στις προτεινόμενες τιμές.')).catch(fail));
    return h('div', { class: 'row tight' }, inp, save, h('span', { class: 'hint' }, 'Προαιρετικό — μπαίνει αυτόματα από τιμοκατάλογο αντιπροσώπου.'));
  }

  function linkDialog(p, after) {
    const results = h('div', { class: 'stack s', style: { marginTop: '10px' } });
    const inp = h('input', { type: 'search', placeholder: 'Ψάξε στο ' + siteName('st'), value: p.name.split(' ').slice(0, 4).join(' ') });
    const run = debounce(async () => {
      const r = await GET('/api/search-other', { site: 'st', q: inp.value });
      clear(results);
      if (!r.length) results.appendChild(h('p', { class: 'muted' }, 'Δεν βρέθηκε.'));
      for (const x of r) results.appendChild(h('div', { class: 'row', style: { justifyContent: 'space-between', borderBottom: '1px solid var(--line-2)', paddingBottom: '6px' } }, h('div', null, h('b', null, x.name), h('div', { class: 'faint mono' }, x.sku || '')), h('div', { class: 'row tight' }, fmt.money(x.price), btn('Είναι το ίδιο', { cls: 'sm primary' }, () => POST('/api/link', { sfId: p.id, stId: x.id }).then(() => { modal.close(); toast('Συνδέθηκαν.'); after(); }).catch(fail)))));
    }, 250);
    inp.addEventListener('input', run);
    modal.open(h('div', null, dlgHead('Σύνδεση με προϊόν του ' + siteName('st'), 'Όταν το ίδιο προϊόν έχει διαφορετικό τίτλο ή κωδικό στα δύο sites.'), inp, results));
    run();
  }

  // ---------- CSV import fallback ----------
  App.csvImport = function (site) {
    let chosenSite = site || 'sf';
    const out = h('div');
    const body = h('div', null, dlgHead('Εισαγωγή από αρχείο CSV του WooCommerce', 'Όταν ένα site δεν επιτρέπει την αυτόματη ανάγνωση.'),
      h('ol', { class: 'steps' },
        h('li', null, 'Στο διαχειριστικό: Προϊόντα → Εξαγωγή → «Δημιουργία CSV» (όλες οι στήλες, όλα τα προϊόντα).'),
        h('li', null, 'Διάλεξε για ποιο site είναι και φόρτωσε το αρχείο εδώ.')),
      h('div', { style: { margin: '14px 0' } }, seg([['sf', siteName('sf')], ['st', siteName('st')]], chosenSite, (v) => { chosenSite = v; })),
      dropZone('Αρχείο εξαγωγής προϊόντων (.csv)', '.csv,text/csv', async (file) => {
        clear(out).appendChild(h('p', { class: 'muted' }, 'Ανάγνωση…'));
        try {
          const b64 = await fileToBase64(file);
          const det = await POST('/api/csv/detect', { base64: b64 });
          clear(out);
          if (det.missing.length) { out.appendChild(h('div', { class: 'note crit' }, 'Δεν βρέθηκαν οι στήλες: ' + det.missing.join(', ') + '. Βεβαιώσου ότι είναι εξαγωγή του WooCommerce.')); return; }
          const found = Object.entries(det.mapping).filter(([k, v]) => k !== 'attrs' && v != null).map(([k, v]) => `${k} → «${det.headers[v]}»`);
          out.appendChild(h('div', { class: 'note ok', style: { marginTop: '12px' } }, `${fmt.num(det.rows)} γραμμές. Αναγνωρίστηκαν: ${found.length} στήλες και ${det.mapping.attrs.length} ιδιότητες.`));
          out.appendChild(h('div', { class: 'dlg-foot' }, btn('Εισαγωγή στο ' + siteName(chosenSite), { cls: 'primary' }, async (e) => {
            e.target.disabled = true;
            try { const r = await POST('/api/csv/import', { site: chosenSite, base64: b64 }); modal.close(); toast(`Φορτώθηκαν ${fmt.num(r.count)} προϊόντα και ${fmt.num(r.variations)} παραλλαγές στο ${siteName(chosenSite)}.`); await App.refreshState(); App.route(); } catch (err) { fail(err); e.target.disabled = false; }
          })));
        } catch (e) { clear(out).appendChild(h('div', { class: 'note crit' }, e.message)); }
      }), out);
    modal.open(body);
  };
})();
