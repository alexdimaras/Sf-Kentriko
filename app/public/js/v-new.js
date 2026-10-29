/* Νέα προϊόντα — from a supplier link, a price list or by hand; check, approve, export */
'use strict';
(function () {
  const { h, clear, btn, icon, fmt, GET, POST, toast, fail, drawer, modal, dlgHead, thumb, select, pageHead, siteName, sitePill, sandboxPreview, debounce, fileReady, watchJob, confirmBox } = App;

  App.views.new = {
    async render(main, p) {
      const tab = p.tab || 'draft';
      const sups = (await GET('/api/suppliers')).suppliers;
      main.appendChild(pageHead('Νέα προϊόντα', 'Επικόλλησε τον σύνδεσμο του προϊόντος από τον αντιπρόσωπο ή τον κατασκευαστή. Το πρόγραμμα γεμίζει τίτλο, περιγραφή, φωτογραφίες, μεγέθη και τιμή — εσύ ελέγχεις και εγκρίνεις.'));
      const urls = h('textarea', { rows: 1, placeholder: 'https://… (ένας ή περισσότεροι σύνδεσμοι, ένας ανά γραμμή)', style: { height: '40px', fontSize: '15px' } });
      urls.addEventListener('input', () => { urls.style.height = 'auto'; urls.style.height = Math.min(200, Math.max(40, urls.scrollHeight + 2)) + 'px'; });
      const supSel = select([['', 'Αντιπρόσωπος: αυτόματα']].concat(sups.map((s) => [s.id, s.name])), '', null);
      const go1 = btn('Ανάγνωση', { cls: 'primary', icon: 'arrow' }, async () => {
        const list = urls.value.split(/\s+/).map((x) => x.trim()).filter((x) => /^https?:\/\//i.test(x));
        if (!list.length) return toast('Επικόλλησε σύνδεσμο που ξεκινά με https://', { err: true });
        go1.disabled = true;
        let ok = 0, last = null;
        for (let i = 0; i < list.length; i++) {
          go1.textContent = `Ανάγνωση ${i + 1}/${list.length}…`;
          try { last = await POST('/api/drafts/new', { url: list[i], supplierId: supSel.value || undefined }); ok++; } catch (e) { toast(list[i].slice(0, 60) + '… : ' + e.message, { err: true }); }
        }
        go1.disabled = false; go1.textContent = 'Ανάγνωση';
        urls.value = '';
        if (ok) { toast(`Δημιουργήθηκαν ${ok} προϊόντα προς έλεγχο.`); await App.refreshBadges(); App.route(); if (ok === 1 && last) openEditor(last.id); }
      });
      main.appendChild(h('div', { class: 'url-bar' }, urls, supSel, go1));
      main.appendChild(h('div', { class: 'row', style: { marginTop: '-8px', marginBottom: '18px' } },
        btn('Κενό προϊόν', { icon: 'new' }, () => POST('/api/drafts/new', {}).then((d) => { App.route(); openEditor(d.id); }).catch(fail)),
        h('span', { class: 'faint' }, 'ή από τιμοκατάλογο αντιπροσώπου: Αντιπρόσωποι → Τιμοκατάλογος → «Νέα προϊόντα».')));

      const all = await GET('/api/drafts');
      const counts = { draft: all.filter((d) => d.status === 'draft').length, approved: all.filter((d) => d.status === 'approved').length, all: all.length };
      const tabs = h('div', { class: 'tabs', role: 'tablist' }, [['draft', 'Προς έλεγχο'], ['approved', 'Εγκεκριμένα'], ['all', 'Όλα']].map(([k, l]) => h('button', { role: 'tab', 'aria-selected': String(tab === k), onclick: () => App.go('new', { tab: k }) }, l, h('span', { class: 'badge' }, counts[k]))));
      main.appendChild(tabs);
      const rows = all.filter((d) => tab === 'all' || d.status === tab);
      if (!rows.length) {
        main.appendChild(h('div', { class: 'panel empty' }, h('h3', null, tab === 'draft' ? 'Δεν περιμένει κάτι για έλεγχο' : 'Κανένα προϊόν εδώ'), h('p', null, 'Επικόλλησε έναν σύνδεσμο προϊόντος παραπάνω για να ξεκινήσεις.')));
        return;
      }
      const selected = new Set();
      const bulk = h('div', { class: 'bulkbar hidden' });
      const renderBulk = () => {
        clear(bulk); bulk.classList.toggle('hidden', !selected.size);
        if (!selected.size) return;
        const ids = [...selected];
        bulk.appendChild(h('b', null, fmt.plural(ids.length, 'επιλεγμένο', 'επιλεγμένα')));
        if (tab !== 'approved') bulk.appendChild(btn('Έγκριση', { icon: 'check' }, async () => { for (const id of ids) await POST('/api/draft/update', { id, patch: { status: 'approved' } }).catch(fail); toast('Εγκρίθηκαν.'); App.refreshBadges(); App.route(); }));
        bulk.appendChild(btn('Αρχείο για ' + siteName('sf'), { cls: 'primary', icon: 'download' }, () => exportDrafts(ids, 'sf')));
        bulk.appendChild(btn('Αρχείο για ' + siteName('st'), { cls: 'primary', icon: 'download' }, () => exportDrafts(ids, 'st')));
        bulk.appendChild(h('span', { class: 'grow' }));
        bulk.appendChild(btn('Διαγραφή', { cls: 'ghost' }, async () => { if (await confirmBox('Διαγραφή ' + ids.length + ' προϊόντων;', 'Διαγράφονται μόνο από αυτό το πρόγραμμα, όχι από τα sites.', 'Διαγραφή', true)) POST('/api/drafts/delete', { ids }).then(() => { App.refreshBadges(); App.route(); }).catch(fail); }));
      };
      const listBox = h('div');
      const allBox = h('input', { type: 'checkbox', 'aria-label': 'Επιλογή όλων', onchange: (e) => { rows.forEach((d) => (e.target.checked ? selected.add(d.id) : selected.delete(d.id))); listBox.querySelectorAll('input[type=checkbox]').forEach((c) => { c.checked = e.target.checked; }); renderBulk(); } });
      main.appendChild(h('div', { class: 'row', style: { margin: '0 0 10px 14px' } }, h('label', { class: 'check' }, allBox, 'Όλα')));
      const supName = (id) => (sups.find((s) => s.id === id) || {}).name || '';
      for (const d of rows) {
        const errs = (d.checks || []).filter((c) => c.level === 'error').length;
        const warns = (d.checks || []).filter((c) => c.level !== 'error').length;
        listBox.appendChild(h('div', { class: 'draft-row' },
          h('input', { type: 'checkbox', 'aria-label': 'Επιλογή', onchange: (e) => { if (e.target.checked) selected.add(d.id); else selected.delete(d.id); renderBulk(); } }),
          thumb(d.img),
          h('div', null, h('h3', { onclick: () => openEditor(d.id), tabindex: 0, onkeydown: (e) => { if (e.key === 'Enter') openEditor(d.id); } }, d.title || 'Χωρίς τίτλο'),
            h('div', { class: 'row tight', style: { marginTop: '4px' } },
              errs ? h('span', { class: 'pill crit' }, fmt.plural(errs, 'λάθος', 'λάθη')) : null,
              warns ? h('span', { class: 'pill warn' }, fmt.plural(warns, 'παρατήρηση', 'παρατηρήσεις')) : null,
              !errs && !warns ? h('span', { class: 'pill st' }, 'Έτοιμο') : null,
              d.variations ? h('span', { class: 'pill' }, d.variations + ' παραλλαγές') : null,
              d.regulated === 'critical' ? h('span', { class: 'pill crit' }, 'Μόνο ' + siteName('sf')) : App.adPill(d.ads, d.adsWhy),
              supName(d.supplierId) ? h('span', { class: 'faint' }, supName(d.supplierId)) : null,
              d.exported && d.exported.sf ? h('span', { class: 'pill sf' }, '✓ ' + siteName('sf')) : null,
              d.exported && d.exported.st ? h('span', { class: 'pill st' }, '✓ ' + siteName('st')) : null)),
          h('div', { class: 'num', style: { fontWeight: 650 } }, d.price ? fmt.money(d.price) : h('span', { class: 'faint' }, 'χωρίς τιμή')),
          btn('Άνοιγμα', { cls: 'sm' }, () => openEditor(d.id))));
      }
      main.appendChild(listBox);
      main.appendChild(bulk);
      if (p.id) openEditor(p.id);
    },
  };

  function exportDrafts(ids, site) {
    POST('/api/drafts/export', { ids, site }).then((r) => { fileReady(Object.assign({ site }, r), { kind: 'new', title: 'Αρχείο νέων προϊόντων έτοιμο' }); App.refreshBadges(); }).catch(fail);
  }

  // ---------- Editor ----------
  let typeList = null, brandList = null, catsCache = {}, supsCache = null, aiOn = false;
  async function openEditor(id) {
    let d;
    try {
      d = await GET('/api/draft', { id });
      if (!typeList) typeList = await GET('/api/typesuggest');
      if (!brandList) brandList = await GET('/api/brands');
      for (const s of ['sf', 'st']) if (!catsCache[s]) catsCache[s] = await GET('/api/categories', { site: s });
      if (!supsCache) supsCache = (await GET('/api/suppliers')).suppliers;
      aiOn = !!(App.state.settings.localAI && App.state.settings.localAI.enabled);
    } catch (e) { return fail(e); }

    const saved = h('span', { class: 'saved-ind' }, 'Αποθηκεύεται αυτόματα');
    let pending = {};
    const flush = debounce(async () => {
      const patch = pending; pending = {};
      try { d = await POST('/api/draft/update', { id: d.id, patch }); saved.textContent = 'Αποθηκεύτηκε ' + new Date().toLocaleTimeString('el-GR', { hour: '2-digit', minute: '2-digit' }); refreshDerived(); } catch (e) { fail(e); }
    }, 450);
    const save = (patch) => { Object.assign(pending, patch); if (patch.fields) pending.fields = Object.assign({}, pending.fields || {}, patch.fields); saved.textContent = 'Αποθήκευση…'; flush(); };

    const dl = (idn, list) => h('datalist', { id: idn }, list.map((x) => h('option', { value: x })));
    const field = (label, input, hint) => h('label', { class: 'field' }, label, input, hint ? h('small', null, hint) : null);
    const fIn = (key, ph, listId) => { const i = h('input', { type: 'text', value: d.fields[key] || '', placeholder: ph, list: listId }); i.addEventListener('input', () => save({ fields: { [key]: i.value } })); return i; };

    // title preview
    const tCaps = h('div', { class: 'caps' });
    const tTc = h('div', { class: 'tc' });
    const titleBox = h('div', { class: 'title-preview' }, h('small', null, 'Τίτλος στο site'), tCaps, h('small', { style: { marginTop: '6px' } }, 'Πρώτη γραμμή περιγραφής'), tTc);
    const manualTitle = h('input', { type: 'text', value: d.titleManual || '', placeholder: 'Αφήνεται κενό = αυτόματα από τα πεδία' });
    manualTitle.addEventListener('input', () => save({ titleManual: manualTitle.value }));
    const manualTc = h('input', { type: 'text', value: d.displayManual || '', placeholder: 'Αφήνεται κενό = αυτόματα' });
    manualTc.addEventListener('input', () => save({ displayManual: manualTc.value }));
    const skuIn = h('input', { type: 'text', value: d.sku || '' }); skuIn.addEventListener('input', () => save({ sku: skuIn.value }));
    const codeIn = h('input', { type: 'text', value: d.code || '' }); codeIn.addEventListener('input', () => save({ code: codeIn.value }));
    const eanIn = h('input', { type: 'text', value: d.ean || '' }); eanIn.addEventListener('input', () => save({ ean: eanIn.value }));

    // description
    const preview = h('div');
    const descArea = h('div', { class: 'stack s' });
    const modes = [['official', 'Επίσημη περιγραφή'], ['template', 'Αυτόματη από στοιχεία'], ['custom', 'Δική μου']].concat(aiOn ? [['ai', 'Τοπικό AI']] : []);
    const modeSeg = App.seg(modes, d.descMode, (v) => { d.descMode = v; save({ descMode: v }); drawDesc(); });
    const drawDesc = () => {
      clear(descArea);
      if (d.descMode === 'official') {
        const ta = h('textarea', { rows: 8, value: d.descOfficial || '', placeholder: 'Δεν βρέθηκε επίσημη περιγραφή στη σελίδα. Επικόλλησε εδώ το κείμενο του κατασκευαστή ή διάλεξε «Αυτόματη».' });
        ta.addEventListener('input', () => save({ descOfficial: ta.value }));
        descArea.appendChild(field('Κείμενο κατασκευαστή (αυτούσιο)', ta, 'Μπαίνει ακριβώς όπως είναι, κάτω από τον τίτλο. Επιτρέπεται απλό HTML (<p>, <ul>, <li>, <strong>).'));
        if (aiOn && d.descOfficial) descArea.appendChild(h('div', null, btn('Μετάφραση στα ελληνικά (τοπικό AI)', { cls: 'sm', icon: 'bolt' }, (e) => runAI('translate', e.target))));
      } else if (d.descMode === 'template') {
        const kp = h('textarea', { rows: 4, value: d.keyPoints || '', placeholder: 'Π.χ.\nΑδιάβροχο ύφασμα\n6 τσέπες\nΕνισχυμένα γόνατα' });
        kp.addEventListener('input', () => save({ keyPoints: kp.value }));
        descArea.appendChild(field('Βασικά σημεία (ένα ανά γραμμή)', kp, 'Μαζί με μάρκα, μοντέλο, χρώματα, μεγέθη και χαρακτηριστικά της σελίδας φτιάχνουν λίστα με κουκκίδες.'));
      } else if (d.descMode === 'custom') {
        const ta = h('textarea', { rows: 10, value: d.descCustom || d.descOfficial || '', placeholder: 'Γράψε την περιγραφή.' });
        ta.addEventListener('input', () => save({ descCustom: ta.value }));
        if (!d.descCustom && d.descOfficial) save({ descCustom: d.descOfficial });
        descArea.appendChild(field('Περιγραφή', ta));
      } else if (d.descMode === 'ai') {
        descArea.appendChild(h('div', { class: 'row' }, btn(d.descAI ? 'Ξαναγράψε' : 'Γράψε περιγραφή', { cls: 'sm primary', icon: 'bolt' }, (e) => runAI('describe', e.target)), h('span', { class: 'hint' }, 'Τρέχει στον υπολογιστή σου, χωρίς χρέωση. Μπορεί να πάρει 1–2 λεπτά.')));
      }
    };
    const runAI = async (kind, b) => {
      b.disabled = true; const old = b.textContent; b.textContent = 'Γράφει…';
      try { d = await POST('/api/draft/ai', { id: d.id, kind }); d.descMode = 'ai'; App.$$('button', modeSeg).forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.v === 'ai'))); drawDesc(); refreshDerived(); } catch (e) { fail(e); }
      b.disabled = false; b.textContent = old;
    };
    const autoShort = h('input', { type: 'checkbox', checked: d.autoShort !== false, onchange: (e) => save({ autoShort: e.target.checked }) });

    // variations
    const varBox = h('div');
    const drawVars = () => {
      clear(varBox);
      const rows = d.variations || [];
      const tb = h('tbody');
      rows.forEach((v, i) => {
        const inp = (k, ph, w) => { const x = h('input', { type: 'text', value: v[k] || '', placeholder: ph, style: w ? { width: w } : null }); x.addEventListener('input', () => { v[k] = x.value; save({ variations: d.variations }); }); return x; };
        tb.appendChild(h('tr', null, h('td', null, inp('size', 'π.χ. XL', '90px')), h('td', null, inp('color', 'π.χ. ΜΑΥΡΟ')), h('td', null, inp('sku', 'κωδικός')), h('td', null, inp('price', 'ίδια', '90px')),
          h('td', null, h('button', { class: 'x', title: 'Αφαίρεση', onclick: () => { d.variations.splice(i, 1); save({ variations: d.variations }); drawVars(); } }, icon('trash')))));
      });
      const quick = h('input', { type: 'text', placeholder: 'Γρήγορα: S M L XL XXL' });
      varBox.appendChild(h('div', { class: 'tbl-wrap vars' }, h('table', { class: 'tbl' }, h('thead', null, h('tr', null, h('th', null, 'Μέγεθος'), h('th', null, 'Χρώμα'), h('th', null, 'Κωδικός'), h('th', null, 'Τιμή'), h('th', null, ''))), tb)));
      varBox.appendChild(h('div', { class: 'row tight', style: { marginTop: '8px' } },
        btn('Προσθήκη γραμμής', { cls: 'sm' }, () => { d.variations = (d.variations || []).concat([{ size: '', color: '', sku: '', price: 0 }]); save({ variations: d.variations }); drawVars(); }),
        quick, btn('Πρόσθεσε μεγέθη', { cls: 'sm' }, () => {
          const add = quick.value.split(/[\s,;/]+/).map((x) => x.trim().toUpperCase()).filter(Boolean);
          if (!add.length) return;
          d.variations = (d.variations || []).concat(add.map((s) => ({ size: s, color: '', sku: '', price: 0 })));
          save({ variations: d.variations }); drawVars();
        }),
        rows.length ? btn('Χωρίς μεγέθη', { cls: 'sm ghost' }, () => { d.variations = []; save({ variations: [] }); drawVars(); }) : null));
    };

    // images
    const imgBox = h('div');
    const drawImgs = () => {
      clear(imgBox);
      const grid = h('div', { class: 'imgs' });
      (d.images || []).forEach((src, i) => {
        grid.appendChild(h('figure', { class: i === 0 ? 'main' : '' }, h('img', { src, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' }),
          h('div', { class: 'tools' },
            i > 0 ? h('button', { type: 'button', onclick: () => { d.images.unshift(d.images.splice(i, 1)[0]); save({ images: d.images }); drawImgs(); } }, 'Κύρια') : null,
            h('button', { type: 'button', onclick: () => { d.images.splice(i, 1); save({ images: d.images }); drawImgs(); } }, 'Αφαίρεση'))));
      });
      if (!(d.images || []).length) grid.appendChild(h('div', { class: 'faint' }, 'Καμία φωτογραφία.'));
      const add = h('input', { type: 'url', placeholder: 'Σύνδεσμος φωτογραφίας https://…' });
      imgBox.appendChild(grid);
      imgBox.appendChild(h('div', { class: 'row tight', style: { marginTop: '8px' } }, add, btn('Προσθήκη', { cls: 'sm' }, () => { if (/^https?:\/\//.test(add.value)) { d.images = (d.images || []).concat([add.value.trim()]); save({ images: d.images }); drawImgs(); } })));
    };

    // categories
    const catBox = h('div', { class: 'stack' });
    const drawCats = async () => {
      clear(catBox);
      for (const site of ['sf', 'st']) {
        const cur = (d.cats && d.cats[site]) || [];
        const list = catsCache[site];
        const sel = select([['', '— διάλεξε κατηγορία —']].concat(list.map((c) => [String(c.id), c.path + (c.ads && c.ads !== 'ok' ? '  (' + App.AD[c.ads] + ')' : '')])), cur[0] ? String(cur[0]) : '', (v) => { d.cats = Object.assign({}, d.cats, { [site]: v ? [Number(v)] : [] }); save({ cats: d.cats }); drawCats(); });
        const sug = h('div', { class: 'chips' });
        const box = h('div', { class: 'stack s' }, h('div', { class: 'row tight' }, sitePill(site), h('label', { class: 'check', style: { marginLeft: 'auto' } }, h('input', { type: 'checkbox', checked: d.sites[site] !== false, disabled: site === 'st' && d.regulated === 'critical', onchange: (e) => { d.sites = Object.assign({}, d.sites, { [site]: e.target.checked }); save({ sites: d.sites }); } }), 'Να μπει σε αυτό το site')), sel, sug);
        if (!list.length) box.appendChild(h('div', { class: 'hint' }, 'Διάβασε πρώτα τα προϊόντα του site για να φανούν οι κατηγορίες.'));
        catBox.appendChild(box);
        GET('/api/draft/categories', { id: d.id, site }).then((s) => {
          for (const c of s) sug.appendChild(h('button', { type: 'button', class: 'chip' + (cur.includes(c.id) ? ' on' : ''), onclick: () => { d.cats = Object.assign({}, d.cats, { [site]: [c.id] }); save({ cats: d.cats }); drawCats(); } }, c.path));
          if (s.length) sug.prepend(h('span', { class: 'hint', style: { alignSelf: 'center' } }, 'Από παρόμοια προϊόντα σας:'));
        }).catch(() => {});
      }
    };

    // price & market
    const money2 = (n) => (n ? Number(n).toFixed(2).replace('.', ',') : '');
    const priceIn = h('input', { type: 'text', value: money2(d.price) });
    priceIn.addEventListener('input', () => save({ price: priceIn.value }));
    const saleIn = h('input', { type: 'text', value: money2(d.sale), placeholder: 'προαιρετικά' });
    saleIn.addEventListener('input', () => save({ sale: saleIn.value }));
    const costIn = h('input', { type: 'text', value: money2(d.cost), placeholder: 'χωρίς ΦΠΑ' });
    costIn.addEventListener('input', () => save({ cost: costIn.value }));
    const mkBox = h('div');
    const drawMarket = () => {
      clear(mkBox);
      if (d.priceNote) mkBox.appendChild(h('div', { class: 'hint' }, d.priceNote));
      const m = d.market;
      if (m && m.stats) {
        mkBox.appendChild(App.marketSummary(m, d.price));
        if (m.suggested > 0) mkBox.appendChild(h('div', { class: 'row', style: { marginTop: '8px' } }, btn('Χρήση ' + fmt.money(m.suggested), { cls: 'sm primary' }, () => { priceIn.value = money2(m.suggested); save({ price: m.suggested, priceNote: `Από έρευνα αγοράς (${m.stats.count} καταστήματα, ${fmt.dateTime(m.at)})` }); })));
      }
    };
    const mkBtn = btn('Έρευνα τιμής στην αγορά', { cls: 'sm', icon: 'market' }, () => {
      mkBtn.disabled = true;
      POST('/api/draft/market', { id: d.id }).then((job) => watchJob(job, {
        done: (r) => { d.market = r; drawMarket(); toast(r.stats.count ? `Βρέθηκε σε ${r.stats.count} καταστήματα.` : 'Δεν βρέθηκε το ίδιο προϊόν σε άλλα καταστήματα.'); },
        always: () => { mkBtn.disabled = false; },
      })).catch((e) => { fail(e); mkBtn.disabled = false; });
    });

    const checksBox = h('div', { class: 'checklist' });
    const statusBox = h('div', { class: 'row' });
    const refreshDerived = () => {
      tCaps.textContent = d.title || '—';
      tTc.textContent = d.displayTitle || '—';
      skuIn.placeholder = d.sku || 'αυτόματα';
      clear(preview).appendChild(sandboxPreview((d.short ? d.short + '<hr>' : '') + d.description));
      clear(checksBox);
      if (!(d.checks || []).length) checksBox.appendChild(h('div', { class: 'note ok' }, 'Όλα σωστά — έτοιμο για έγκριση.'));
      for (const c of d.checks || []) checksBox.appendChild(h('div', { class: c.level }, h('span', { class: 'dot' }), h('span', null, c.text, c.link ? [' ', h('a', { href: '#', onclick: (e) => { e.preventDefault(); App.openProduct(c.link.site, c.link.id); } }, 'άνοιγμα')] : null)));
      clear(statusBox);
      statusBox.appendChild(d.status === 'approved' ? h('span', { class: 'pill st' }, 'Εγκεκριμένο') : h('span', { class: 'pill' }, 'Πρόχειρο'));
      statusBox.appendChild(d.status === 'approved' ? btn('Πίσω σε πρόχειρο', { cls: 'sm' }, () => { save({ status: 'draft' }); d.status = 'draft'; refreshDerived(); }) : btn('Έγκριση', { cls: 'sm primary', icon: 'check' }, () => { save({ status: 'approved' }); d.status = 'approved'; refreshDerived(); toast('Εγκρίθηκε. Φτιάξε το αρχείο από τη λίστα ή από εδώ.'); }));
    };

    const supSel = select([['', '—']].concat(supsCache.map((s) => [s.id, s.name])), d.supplierId || '', (v) => save({ supplierId: v }));
    const left = h('div', { class: 'stack' },
      d.source && d.source.url ? h('div', { class: 'faint' }, 'Πηγή: ', h('a', { href: '#', onclick: (e) => { e.preventDefault(); App.openUrl(d.source.url); } }, d.source.url.slice(0, 90))) : null,
      (d.notes || []).map((n) => h('div', { class: 'note warn' }, n)),
      h('div', { class: 'panel' }, h('h2', null, 'Τίτλος'),
        h('div', { class: 'grid2' }, field('Είδος', fIn('type', 'π.χ. ΠΑΝΤΕΛΟΝΙ', 'dl-types')), field('Μάρκα', fIn('brand', 'π.χ. Pentagon', 'dl-brands')), field('Μοντέλο', fIn('model', 'π.χ. Ranger 2.0')), field('Χρώμα ή ιδιαιτερότητα', fIn('extra', 'π.χ. ΜΑΥΡΟ'))),
        dl('dl-types', typeList), dl('dl-brands', brandList.map((b) => b.name)),
        h('div', { style: { marginTop: '12px' } }, titleBox),
        h('details', { style: { marginTop: '10px' } }, h('summary', { class: 'muted', style: { cursor: 'pointer' } }, 'Αλλαγή τίτλου με το χέρι'), h('div', { class: 'grid2', style: { marginTop: '8px' } }, field('Τίτλος site', manualTitle), field('Πρώτη γραμμή περιγραφής', manualTc)))),
      h('div', { class: 'panel' }, h('h2', null, 'Περιγραφή'), modeSeg, h('div', { style: { marginTop: '12px' } }, descArea),
        h('label', { class: 'check', style: { marginTop: '12px' } }, autoShort, 'Αυτόματη σύντομη περιγραφή (μάρκα, κωδικός, μεγέθη)'),
        h('div', { style: { marginTop: '12px' } }, preview)),
      h('div', { class: 'panel' }, h('h2', null, 'Μεγέθη και χρώματα'), h('p', { class: 'hint', style: { marginTop: '-4px' } }, 'Κενή τιμή = ίδια με την κύρια. Χωρίς γραμμές = απλό προϊόν.'), varBox));
    const right = h('div', { class: 'stack' },
      h('div', { class: 'panel' }, h('div', { class: 'row', style: { justifyContent: 'space-between' } }, h('h2', null, 'Έλεγχος'), statusBox), checksBox),
      h('div', { class: 'panel' }, h('h2', null, 'Τιμή'), h('div', { class: 'grid3' }, field('Τιμή (με ΦΠΑ)', priceIn), field('Προσφορά', saleIn), field('Κόστος', costIn)), h('div', { style: { marginTop: '10px' } }, mkBtn), h('div', { style: { marginTop: '10px' } }, mkBox)),
      h('div', { class: 'panel' }, h('h2', null, 'Κατηγορίες και sites'), catBox),
      h('div', { class: 'panel' }, h('h2', null, 'Φωτογραφίες'), imgBox),
      h('div', { class: 'panel' }, h('h2', null, 'Κωδικοί'), h('div', { class: 'grid3' }, field('Κωδικός κατασκευαστή', codeIn), field('EAN', eanIn), field('SKU στο site', skuIn)), h('div', { style: { marginTop: '10px' } }, field('Αντιπρόσωπος', supSel))));

    const head = h('div', { class: 'dlg-head' }, h('div', null, h('h2', null, 'Έλεγχος νέου προϊόντος'), saved),
      h('div', { class: 'row tight' },
        btn('Αρχείο για ' + siteName('sf'), { cls: 'sm', icon: 'download' }, () => { flushNow().then(() => exportDrafts([d.id], 'sf')); }),
        d.regulated === 'critical' ? null : btn('Αρχείο για ' + siteName('st'), { cls: 'sm', icon: 'download' }, () => { flushNow().then(() => exportDrafts([d.id], 'st')); }),
        btn('Διαγραφή', { cls: 'sm ghost danger', icon: 'trash' }, async () => { if (await confirmBox('Διαγραφή προϊόντος;', 'Μόνο από αυτό το πρόγραμμα.', 'Διαγραφή', true)) { await POST('/api/drafts/delete', { ids: [d.id] }); drawer.close(); App.route(); } }),
        h('button', { class: 'x', 'aria-label': 'Κλείσιμο', onclick: () => drawer.close() }, icon('x'))));
    const flushNow = async () => { if (Object.keys(pending).length) { const patch = pending; pending = {}; d = await POST('/api/draft/update', { id: d.id, patch }); } };
    drawer.open(h('div', null, head, h('div', { class: 'editor' }, left, right)), { wide: true, onClose: () => { flushNow().finally(() => { const ph = App.parseHash(); if (ph.view !== 'new') return; if (ph.params.id) App.go('new', { tab: ph.params.tab }); else App.route(); }); } });
    drawDesc(); drawVars(); drawImgs(); drawCats(); drawMarket(); refreshDerived();
  }
  App.openDraft = openEditor;
})();
