// On phones, web pages can only show notifications through a service worker.
// On-Track uses this one for meal reminders; tapping a reminder opens the app.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) =>
      windows.length ? windows[0].focus() : clients.openWindow("./"))
  );
});
