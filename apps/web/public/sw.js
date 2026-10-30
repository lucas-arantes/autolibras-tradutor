// Service worker mínimo: guarda os arquivos do próprio app para abrir rápido e
// permitir instalação. Reconhecimento de fala e VLibras dependem de rede.
const CACHE = "autolibras-v2";
// Caminhos relativos ao service worker, para funcionar na raiz ou num subcaminho.
const ROOT = new URL("./", self.location).href;
const ICON = new URL("icon.svg", self.location).href;
const ASSETS = new URL("assets/", self.location).href;

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll([ROOT, ICON])));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))),
      ),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    // Estúdio, overlay e player vêm sempre da rede; só a página principal funciona offline.
    if (url.href !== ROOT && url.href !== `${ROOT}index.html`) return;
    // Rede primeiro para a página, para pegar versões novas.
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(ROOT, copy));
          return response;
        })
        .catch(() => caches.match(ROOT)),
    );
    return;
  }

  // Arquivos com hash no nome: cache primeiro. O resto (a API do servidor de
  // transcrição, quando ele serve o app) passa direto pela rede.
  if (!url.href.startsWith(ASSETS) && url.href !== ICON) return;
  event.respondWith(
    caches.match(request).then(
      (cached) =>
        cached ??
        fetch(request).then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        }),
    ),
  );
});
