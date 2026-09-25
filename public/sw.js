// Minimal service worker for FeeZo.
//
// Its only job right now is to exist and be registered, so the app can
// call `registration.showNotification()` instead of `new Notification()`.
// Android Chrome blocks the `new Notification()` constructor outright and
// requires notifications to go through a Service Worker registration —
// this file is that registration. No offline caching, no push handling
// yet (that would be a bigger step — real push notifications that work
// even when the app is fully closed).

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// Tapping a notification focuses an already-open FeeZo tab and routes it
// to the path relevant to that notification (event.notification.data.url,
// set by TopBar.jsx when it calls showNotification). Falls back to '/' if
// no url was attached. Opens a new tab at that path if none is open.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || '/';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientsList) => {
      for (const client of clientsList) {
        if ('focus' in client) {
          client.focus();
          // navigate() moves an already-open tab to the target path
          // instead of leaving it wherever it was when the notification
          // fired. Supported in Chrome/Edge; falls through harmlessly
          // (tab still focuses, just doesn't reroute) where it isn't.
          if ('navigate' in client) {
            return client.navigate(targetUrl).catch(() => {});
          }
          return;
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(targetUrl);
    })
  );
});
