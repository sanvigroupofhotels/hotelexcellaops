// Hotel Excella — Push Notification Service Worker
// Receives Web Push events from the dispatcher and surfaces native browser
// notifications. The in-app notification table remains the source of truth;
// this SW only mirrors deliveries for users who have granted permission.

self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  let payload = {};
  try { payload = event.data ? event.data.json() : {}; } catch { payload = {}; }
  const title = payload.title || "Hotel Excella";
  const body = payload.body || "";
  const url = payload.url || "/";
  const tag = payload.tag || payload.notification_id || undefined;
  const options = {
    body,
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    tag,
    renotify: !!tag,
    data: { url, notification_id: payload.notification_id || null },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if ("focus" in c) {
          try { c.navigate(target); } catch { /* noop */ }
          return c.focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(target);
    })
  );
});
