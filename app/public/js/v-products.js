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
            h('td', { class: 'title' }, r.name, h('div', { class: 'faint', style: { fontSize: '12.5px', fontWeight: 400 } }, [r.cats.slice(0, 2).join(', '), r.variations ? `${r.variations} παραλλαγές` : ''].filter(Boolean).join(' — '))),
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
    body.appendChild(h('div', { class: 'p-hero' },
      imgs[0] ? h('img', { class: 'img', src: imgs[0], alt: '', referrerpolicy: 'no-referrer' }) : h('div', { class: 'img thumb none', style: { width: '200px', height: '200px' } }, 'Χωρίς φωτογραφία'),
      h('div', { class: 'stack s' },
        h('div', { class: 'muted' }, 'Στην περιγραφή (Title Case): ', h('b', null, d.titleCase)),
        h('div', { class: 'row tight' }, sitePill(site), p.brand ? h('span', { class: 'pill' }, p.brand) : null, p.sku ? h('span', { class: 'pill mono' }, p.sku) : null, d.ads && d.ads.level !== 'ok' ? h('span', { class: 'ad ' + d.ads.level, title: App.AD[d.ads.level] }, App.AD[d.ads.level] + ': ' + d.ads.why) : null),
        h('div', { class: 'compare' },
          h('div', null, h('div', { class: 'muted' }, siteName(site)), h('b', null, fmt.money(p.price)), p.sale ? h('div', { class: 'faint' }, 'Κανονική ' + fmt.money(p.regular)) : null,
            h('div', { class: 'row tight', style: { marginTop: '8px' } }, btn('Στο site', { cls: 'sm', icon: 'ext' }, () => App.openUrl(p.url)), d.adminUrl ? btn('Επεξεργασία', { cls: 'sm', icon: 'edit' }, () => App.openUrl(d.adminUrl)) : null)),
          d.other ? h('div', null, h('div', { class: 'muted' }, siteName(other)), h('b', null, fmt.money(d.other.price)), Math.abs(d.other.price - p.price) > 0.009 ? h('div', { class: 'price-diff up' }, 'Διαφορά ' + fmt.money(d.other.price - p.price)) : h('div', { class: 'faint' }, 'Ίδια τιμή'),
            h('div', { class: 'row tight', style: { marginTop: '8px' } }, btn('Στο site', { cls: 'sm', icon: 'ext' }, () => App.openUrl(d.other.url)), btn('Επεξεργασία', { cls: 'sm', icon: 'edit' }, () => App.openUrl(d.other.adminUrl)), site === 'sf' ? btn('Αποσύνδεση', { cls: 'sm ghost', title: 'Δεν είναι το ίδιο προϊόν' }, () => POST('/api/link', { sfId: p.id, stId: 0 }).then(() => { toast('Αποσυνδέθηκαν.'); openProduct(site, id); })) : null),
            d.other.how ? h('div', { class: 'faint', style: { fontSize: '12px', marginTop: '4px' } }, 'Σύνδεση: ' + ({ sku: 'ίδιος κωδικός', name: 'ίδιος τίτλος', slug: 'ίδιο slug', manual: 'χειροκίνητα' }[d.other.how] || d.other.how)) : null)
            : h('div', null, h('div', { class: 'muted' }, siteName(other)), h('b', { class: 'faint' }, 'Δεν υπάρχει'), site === 'sf' ? h('div', { class: 'row tight', style: { marginTop: '8px' } }, btn('Σύνδεση με υπάρχον', { cls: 'sm', icon: 'link' }, () => linkDialog(p, () => openProduct(site, id))), d.ads && d.ads.level === 'banned' ? null : btn('Αρχείο μεταφοράς', { cls: 'sm', icon: 'file' }, () => POST('/api/transfer', { ids: [p.id] }).then((r) => (r.count ? fileReady(r, { site: 'st', kind: 'new' }) : toast(r.skipped[0].why, { err: true }))).catch(fail))) : null)))));

    if (imgs.length > 1) body.appendChild(h('div', { class: 'gallery', style: { marginBottom: '16px' } }, imgs.map((src) => h('img', { src, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' }))));

    // Market + cost
    const mk = d.market;
    const mkPanel = h('div', { class: 'panel' }, h('div', { class: 'row', style: { justifyContent: 'space-between' } }, h('h2', null, 'Τιμή αγοράς'),
      h('div', { class: 'row tight' }, btn('Νέα έρευνα', { cls: 'sm', icon: 'market' }, () => POST('/api/market/run', { targets: [{ site, id: p.id }] }).then((job) => watchJob(job, { done: () => openProduct(site, id) })).catch(fail)),
        btn('Χειροκίνητη τιμή', { cls: 'sm' }, () => App.manualPrice(site, p.id, () => openProduct(site, id))))));
    if (mk && mk.stats) {
      mkPanel.appendChild(App.marketSummary(mk, p.price, mk.master ? null : { site, id: p.id, refresh: () => openProduct(site, id) }));
    } else mkPanel.appendChild(h('p', { class: 'muted' }, 'Δεν έχει γίνει έρευνα ακόμα για αυτό το προϊόν.'));
    body.appendChild(mkPanel);

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
