/* Start-up */
'use strict';
(async function () {
  App.applyTheme();
  try {
    // with a PIN, nothing is shown before it is entered
    App.lockInfo = await App.GET('/api/lock').catch(() => null);
    if (App.lockInfo && App.lockInfo.locked) { App.showLock(); await App.whenUnlocked(); }
    await App.refreshState();
  } catch (e) {
    document.getElementById('main').textContent = e.message;
    return;
  }
  window.addEventListener('hashchange', () => App.route());
  await App.route();
  App.refreshBadges();
  // keep the sidebar times fresh
  setInterval(() => { App.refreshState().catch(() => {}); }, 60000);
})();
