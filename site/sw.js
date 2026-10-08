/* Gurugram Vision Forum service worker.
   Shell files are cached on install; navigations go network-first and fall back to the cached
   index.html; other same-origin static files are served stale-while-revalidate.
   Nothing under /api/ and nothing cross-origin is ever cached: the API carries reporter data and
   must always be live. Bump CACHE when the shell changes so old copies are dropped. */
var CACHE = "gvf-shell-v13";
var SHELL = ["/", "/index.html", "/styles.css", "/app.js", "/data.js", "/favicon.svg"];

self.addEventListener("install", function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(SHELL); }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener("activate", function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

function isStatic(url) {
  return /\.(css|js|svg|png|webmanifest|woff2?)$/.test(url.pathname);
}

self.addEventListener("fetch", function (e) {
  var req = e.request;
  if (req.method !== "GET") return;
  var url;
  try { url = new URL(req.url); } catch (err) { return; }
  if (url.origin !== self.location.origin) return;           // never touch cross-origin requests
  if (url.pathname.indexOf("/api/") === 0) return;           // never cache the API

  if (req.mode === "navigate") {
    e.respondWith(fetch(req).then(function (r) {
      if (r && r.ok) { var copy = r.clone(); caches.open(CACHE).then(function (c) { c.put("/index.html", copy); }); }
      return r;
    }).catch(function () {
      return caches.match("/index.html").then(function (m) { return m || Response.error(); });
    }));
    return;
  }

  if (isStatic(url)) {
    e.respondWith(caches.open(CACHE).then(function (c) {
      return c.match(req).then(function (cached) {
        var net = fetch(req).then(function (r) { if (r && r.ok) c.put(req, r.clone()); return r; }).catch(function () { return cached; });
        return cached || net;
      });
    }));
  }
});
