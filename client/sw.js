const BADGE_DB = 'lesserpay-badge';
const BADGE_STORE = 'kv';
const BADGE_KEY = 'count';
const NOTIFICATION_OPTIONS_BASE = {
  icon: '/icons/icon-192.png',
  badge: '/icons/favicon-32x32.png',
  tag: 'lesserpay-update',
  renotify: true
};

function consumeIgnoredError(_error) {
  if (_error === undefined) return;
}

function openBadgeDb() {
  return new Promise(function (resolve, reject) {
    const req = indexedDB.open(BADGE_DB, 1);
    req.onupgradeneeded = function () {
      req.result.createObjectStore(BADGE_STORE);
    };
    req.onsuccess = function () { resolve(req.result); };
    req.onerror = function () { reject(req.error); };
  });
}

function withBadgeDb(work) {
  return openBadgeDb().then(function (db) {
    return work(db);
  });
}

function getBadgeCount() {
  return withBadgeDb(function (db) {
    return new Promise(function (resolve, reject) {
      const tx = db.transaction(BADGE_STORE, 'readonly');
      const req = tx.objectStore(BADGE_STORE).get(BADGE_KEY);
      req.onsuccess = function () { resolve(Number(req.result) || 0); };
      req.onerror = function () { reject(req.error); };
    });
  });
}

function setBadgeCount(n) {
  return withBadgeDb(function (db) {
    return new Promise(function (resolve, reject) {
      const tx = db.transaction(BADGE_STORE, 'readwrite');
      tx.objectStore(BADGE_STORE).put(n, BADGE_KEY);
      tx.oncomplete = function () { resolve(); };
      tx.onerror = function () { reject(tx.error); };
    });
  });
}

function runNavigatorBadgeAction(name, value) {
  if (self.navigator === undefined || !(name in self.navigator)) {
    return Promise.resolve();
  }
  if (name === 'setAppBadge') {
    return self.navigator.setAppBadge(value).catch(consumeIgnoredError);
  }
  return self.navigator.clearAppBadge().catch(consumeIgnoredError);
}

function applyBadge(n) {
  return runNavigatorBadgeAction('setAppBadge', n);
}

function clearBadge() {
  return runNavigatorBadgeAction('clearAppBadge');
}

async function notifyOpenClients() {
  const list = await clients.matchAll({ type: 'window', includeUncontrolled: true });
  let hasVisibleClient = false;
  list.forEach(function (c) {
    try { c.postMessage({ type: 'reload-data' }); } catch (err) { consumeIgnoredError(err); }
    if (c.visibilityState === 'visible') hasVisibleClient = true;
  });
  return hasVisibleClient;
}

function updateBadgeForBackgroundPush() {
  return notifyOpenClients().then(function (hasVisibleClient) {
    // If a tab is already on-screen, just trigger a reload there. Skip the
    // badge increment so the count doesn't grow while the user is actively
    // looking at the app.
    if (hasVisibleClient) return;
    return getBadgeCount().then(function (current) {
      const next = current + 1;
      return setBadgeCount(next).then(function () { return applyBadge(next); });
    });
  }).catch(consumeIgnoredError);
}

function focusExistingClientOrOpenRoot() {
  return clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (clientList) {
    for (const c of clientList) {
      if ('focus' in c) return c.focus();
    }
    return clients.openWindow('/');
  });
}

function parsePushPayload(event) {
  if (!event.data) return null;
  try {
    return event.data.json();
  } catch (err) {
    consumeIgnoredError(err);
    return { body: event.data.text() };
  }
}

function buildNotificationContent(payload) {
  return {
    title: payload?.title ? String(payload.title) : 'LesserPay',
    body: payload?.body ? String(payload.body) : 'You have a new LesserPay update.'
  };
}

self.addEventListener('push', function (event) {
  const payload = parsePushPayload(event);
  const content = buildNotificationContent(payload);

  const work = updateBadgeForBackgroundPush();

  event.waitUntil(Promise.all([
    self.registration.showNotification(content.title, {
      ...NOTIFICATION_OPTIONS_BASE,
      body: content.body
    }),
    work
  ]));
});

self.addEventListener('message', function (event) {
  if (event.origin && event.origin !== self.location.origin) return;
  if (event.data?.type !== 'clearBadge') return;
  event.waitUntil(setBadgeCount(0).then(clearBadge));
});

self.addEventListener('notificationclick', function (event) {
  event.notification.close();
  event.waitUntil(
    setBadgeCount(0)
      .then(clearBadge)
      .then(focusExistingClientOrOpenRoot)
  );
});
