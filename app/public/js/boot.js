/* Start-up */
'use strict';
(async function () {
  App.applyTheme();
  App.shell();
  let started = false;
  const start = async () => {
    if (started) return;
    started = true;
    window.addEventListener('hashchange', () => App.route());
    await App.route();
  };
  try {
    if (App.MODE === 'server') {
      // shared program: the sign-in is checked first (the very first time: create the administrator).
      // The program may be waking up (free cloud plan) or restarting: it is asked again for up to ~3 minutes.
      const session = (async () => {
        for (let i = 0; i < 45; i++) {
          const s = await fetch('/api/session', { credentials: 'same-origin', headers: { 'X-Client': 'boot' } }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
          if (s) return s;
          App.waking.n++;
          App.waking.show(started ? 'Το πρόγραμμα ξυπνάει… βλέπεις ό,τι είχε την τελευταία φορά, τα νέα έρχονται μόνα τους.' : 'Το πρόγραμμα ξυπνάει ή ξεκινάει (μπορεί να θέλει 1-2 λεπτά)… περίμενε, ανοίγει μόνο του.');
          await new Promise((r) => setTimeout(r, 4000));
          App.waking.n--;
        }
        return null;
      })();
      // every request waits for this check: it brings the token they need
      let release;
      App.setGate(new Promise((r) => { release = r; }));
      // signed in on this device before: the screens open at once with what it saw last; the fresh data follows
      const last = App.kept.load();
      if (last && last.user) { App.state = last; App.me = last.user; start().then(() => App.renderSyncBox()); }
      const s = await session;
      App.waking.hide();
      if (!s) { release(); throw new Error('Το πρόγραμμα δεν απαντά. Ξαναδοκίμασε σε λίγο.'); }
      App.setToken(s.csrf);
      if (!s.user) {
        // not signed in (any more): nothing of the shop stays on the screen or on the device
        App.kept.wipe();
        App.clear(document.getElementById('main'));
        App.showLogin(!!s.setup);
        await App.whenUnlocked();
      } else if (last && last.user && s.user.id !== last.user.id) App.kept.wipe();
      release();
      App.newVersion(s.version);
    } else {
      // with a PIN, nothing is shown before it is entered
      App.lockInfo = await App.GET('/api/lock').catch(() => null);
      if (App.lockInfo && App.lockInfo.locked) { App.showLock(); await App.whenUnlocked(); }
    }
    await App.refreshState();
  } catch (e) {
    if (!started) document.getElementById('main').textContent = e.message; else App.toast(e.message, { err: true });
    return;
  }
  await start(); // (already open when this device had the last screens kept: their fresh data is on its way)
  App.refreshBadges();
  App.live.start();
  // keep the sidebar times fresh
  setInterval(() => { App.refreshState().catch(() => {}); }, 60000);
})();
