/* Start-up */
'use strict';
(async function () {
  App.applyTheme();
  try {
    if (App.MODE === 'server') {
      // shared program: log in first (the very first time: create the administrator)
      // the program may be waking up (free cloud plan) or restarting: try again for up to ~3 minutes
      let s = null;
      for (let i = 0; i < 45 && !s; i++) {
        s = await fetch('/api/session', { credentials: 'same-origin', headers: { 'X-Client': 'boot' } }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
        if (!s) { App.waking.show('Το πρόγραμμα ξυπνάει ή ξεκινάει (μπορεί να θέλει 1-2 λεπτά)… περίμενε, ανοίγει μόνο του.'); await new Promise((r) => setTimeout(r, 4000)); }
      }
      App.waking.hide();
      if (!s) throw new Error('Το πρόγραμμα δεν απαντά. Ξαναδοκίμασε σε λίγο.');
      if (!s.user) { App.showLogin(!!s.setup); await App.whenUnlocked(); }
    } else {
      // with a PIN, nothing is shown before it is entered
      App.lockInfo = await App.GET('/api/lock').catch(() => null);
      if (App.lockInfo && App.lockInfo.locked) { App.showLock(); await App.whenUnlocked(); }
    }
    await App.refreshState();
  } catch (e) {
    document.getElementById('main').textContent = e.message;
    return;
  }
  window.addEventListener('hashchange', () => App.route());
  await App.route();
  App.refreshBadges();
  App.live.start();
  // keep the sidebar times fresh
  setInterval(() => { App.refreshState().catch(() => {}); }, 60000);
})();
