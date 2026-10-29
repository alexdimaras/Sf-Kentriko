/* Start-up */
'use strict';
(async function () {
  App.applyTheme();
  try {
    if (App.MODE === 'server') {
      // shared program: log in first (the very first time: create the administrator)
      const s = await fetch('/api/session', { credentials: 'same-origin', headers: { 'X-Client': 'boot' } }).then((r) => r.json()).catch(() => null);
      if (!s) throw new Error('Ο διακομιστής δεν απαντά.');
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
