// Service worker mínimo: cachea el shell para que la app arranque sin red.
// Las llamadas /api van siempre a red (la cola offline vive en api.js).
const CACHE = "entreno-v15"; // súbelo junto con APP_VERSION en js/app.js
const SHELL = [
  "/",
  "/index.html",
  "/styles.css",
  "/js/app.js",
  "/js/api.js",
  "/js/timer.js",
  "/js/fx.js",
  "/js/stats.js",
  "/js/dash.js",
  "/js/plates.js",
  "/manifest.webmanifest",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Network-first para el shell: si hay red, siempre lo último; la caché es
// sólo el plan B sin conexión. Así un despliegue nuevo no queda tapado.
self.addEventListener("fetch", (e) => {
  const { request } = e;
  if (request.method !== "GET" || new URL(request.url).pathname.startsWith("/api/")) return;
  e.respondWith(
    // cache: "no-cache" → siempre revalida con el servidor (no la caché HTTP
    // del navegador), para no mezclar módulos de versiones distintas.
    fetch(request, { cache: "no-cache" })
      .then((res) => {
        if (res.ok) {
          // Solo respuestas buenas: un 404/5xx no debe pisar la copia offline.
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(request, copy));
        }
        return res;
      })
      .catch(() => caches.match(request).then((hit) => hit || caches.match("/index.html")))
  );
});
