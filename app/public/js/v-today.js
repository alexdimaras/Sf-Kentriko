/* Σήμερα — today's task list */
'use strict';
(function () {
  const { h, btn, fmt, GET, go, startSync, siteName, sitePill } = App;

  function runAction(a, t) {
    if (!a) return;
    if (a.kind === 'sync') return startSync();
    if (a.kind === 'check') return go('checks', { open: a.id });
    if (a.kind === 'view') return go(a.view, Object.assign({}, a.tab ? { tab: a.tab } : {}, a.id ? { id: a.id } : {}));
    void t;
  }

  App.views.today = {
    async render(main) {
      const d = await App.refreshBadges() || await GET('/api/dashboard');
      const now = new Date();
      const day = now.toLocaleDateString('el-GR', { weekday: 'long' });
      const date = now.toLocaleDateString('el-GR', { day: 'numeric', month: 'long' });
      const k = d.kpi;
      main.appendChild(h('div', { class: 'today-head' },
        h('div', null,
          h('div', { class: 'today-date' }, day.charAt(0).toUpperCase() + day.slice(1) + ' ' + date),
          h('div', { class: 'today-sub' }, d.tasks.length ? `${fmt.plural(d.tasks.length, 'εκκρεμότητα', 'εκκρεμότητες')} για σήμερα, η πιο σημαντική πρώτη.` : 'Δεν υπάρχει τίποτα επείγον. Καλή δουλειά.')),
        h('div', { class: 'ledger', role: 'list' },
          h('div', { role: 'listitem' }, h('b', null, fmt.num(k.sf)), h('span', null, siteName('sf'))),
          h('div', { role: 'listitem' }, h('b', null, fmt.num(k.st)), h('span', null, siteName('st'))),
          h('div', { role: 'listitem' }, h('b', null, fmt.num(k.both)), h('span', null, 'Και στα δύο')),
          h('div', { role: 'listitem', class: k.critical ? 'crit' : '' }, h('b', null, fmt.num(k.critical + k.high)), h('span', null, 'Σοβαρά θέματα')))));

      const list = h('div', { class: 'tasks' });
      for (const t of d.tasks) {
        list.appendChild(h('div', { class: 'task ' + t.level },
          h('div', { class: 'bar' }),
          h('div', null, h('h3', null, t.title, t.site ? h('span', { class: 'site-tag' }, sitePill(t.site)) : null), t.text ? h('p', null, t.text) : null),
          t.action ? btn(t.action.label, { cls: t.level === 'start' || t.level === 'critical' ? 'primary' : '' }, () => runAction(t.action, t)) : null));
      }
      if (!d.tasks.length) list.appendChild(h('div', { class: 'panel empty' }, h('h3', null, 'Όλα εντάξει'), h('p', null, 'Πάτα «Ανάγνωση από τα sites» αριστερά όταν αλλάξουν προϊόντα, για να ξαναγίνουν οι έλεγχοι.')));
      main.appendChild(list);

      if (d.history && d.history.length) {
        main.appendChild(h('div', { class: 'section-title' }, h('h2', null, 'Τι άλλαξε στα sites'), h('span', { class: 'faint' }, 'σε σχέση με την προηγούμενη ανάγνωση')));
        const hist = h('div', { class: 'history' });
        for (const e of d.history) {
          const c = e.counts || {};
          const parts = [];
          if (c.added) parts.push(fmt.plural(c.added, 'νέο', 'νέα'));
          if (c.removed) parts.push(fmt.plural(c.removed, 'αφαιρέθηκε', 'αφαιρέθηκαν'));
          if (c.priceChanged) parts.push(fmt.plural(c.priceChanged, 'αλλαγή τιμής', 'αλλαγές τιμής'));
          if (c.renamed) parts.push(fmt.plural(c.renamed, 'αλλαγή τίτλου', 'αλλαγές τίτλου'));
          hist.appendChild(h('details', null,
            h('summary', null, sitePill(e.site), ' ', fmt.dateTime(e.at), ' — ', parts.length ? parts.join(', ') : 'καμία αλλαγή'),
            parts.length ? h('ul', null,
              (e.added || []).slice(0, 40).map((x) => h('li', null, 'Νέο: ' + x.name)),
              (e.removed || []).slice(0, 40).map((x) => h('li', null, 'Αφαιρέθηκε: ' + x.name)),
              (e.priceChanged || []).slice(0, 60).map((x) => h('li', null, `${x.name}: ${fmt.money(x.from)} → ${fmt.money(x.to)}`)),
              (e.renamed || []).slice(0, 40).map((x) => h('li', null, `«${x.from}» → «${x.to}»`))) : null));
        }
        main.appendChild(hist);
      }
    },
  };
})();
