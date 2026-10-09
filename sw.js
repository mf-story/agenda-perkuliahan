/* Service Worker — Agenda Perkuliahan
   Shell di-cache agar cepat & bisa dibuka saat offline.
   API (/api/*) TIDAK pernah di-cache (selalu ambil data terbaru). */
const VERSION = "agenda-v6";
const SHELL = ["./", "./index.html", "./style.css", "./app.js", "./logo-unismuh.png", "./icon-192.png", "./icon-512.png", "./icon.svg", "./manifest.webmanifest"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.includes("/api/")) return; // biarkan API langsung ke jaringan

  // Halaman (navigasi): network-first agar pembaruan cepat tampil, fallback cache saat offline.
  if (req.mode === "navigate") {
    e.respondWith(
      fetch(req).then((r) => { const copy = r.clone(); caches.open(VERSION).then((c) => c.put("./index.html", copy)); return r; })
        .catch(() => caches.match("./index.html"))
    );
    return;
  }

  // Aset statis: network-first agar pembaruan selalu tampil; cache hanya fallback saat offline.
  e.respondWith(
    fetch(req).then((r) => {
      if (r.ok) { const copy = r.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); }
      return r;
    }).catch(() => caches.match(req))
  );
});

// Klik notifikasi: fokuskan / buka aplikasi.
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  e.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const c of list) { if ("focus" in c) return c.focus(); }
      if (clients.openWindow) return clients.openWindow("./");
    })
  );
});

// Dukungan Web Push (jika nanti diaktifkan di server).
self.addEventListener("push", (e) => {
  let data = {};
  try { data = e.data ? e.data.json() : {}; } catch { data = { title: "Agenda", body: e.data ? e.data.text() : "" }; }
  const title = data.title || "Agenda Perkuliahan";
  e.waitUntil(self.registration.showNotification(title, { body: data.body || "", icon: "./logo-unismuh.png", badge: "./icon.svg", tag: data.tag || "agenda", renotify: true }));
});
