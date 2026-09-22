const CACHE_NAME = "my-cache-v1";
const urlsToCache = [
    "/",
    "/index.html",
    "/css/styles.css",
    "/js/app.js",
    "/assets/logo.png",
    "/assets/logos"
  ];
  


self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(urlsToCache))
  );
});

self.addEventListener("fetch", (event) => {
  event.respondWith(
    caches.match(event.request).then((response) => {
      return response || fetch(event.request);
    })
  );
});