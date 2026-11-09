// sw.js —— 离线缓存。首次联网打开后，页面和汇率接口会被缓存，之后离线也能用。
const CACHE = "fx-v1";
const ASSETS = [
  "./",
  "./index.html",
  "./change-core.js",
  "./manifest.json",
  "./icon-192.png",
  "./icon-512.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  const url = new URL(e.request.url);

  // 汇率接口：网络优先，成功则更新缓存；失败则用缓存兜底（离线也能用旧汇率）
  if (url.hostname === "open.er-api.com") {
    e.respondWith(
      fetch(e.request)
        .then((r) => {
          const cl = r.clone();
          caches.open(CACHE).then((c) => c.put(e.request, cl));
          return r;
        })
        .catch(() => caches.match(e.request))
    );
    return;
  }

  // 静态资源：缓存优先，命中直接给；未命中走网络并回填缓存
  e.respondWith(
    caches.match(e.request).then((hit) => {
      return (
        hit ||
        fetch(e.request).then((r) => {
          const cl = r.clone();
          caches.open(CACHE).then((c) => c.put(e.request, cl));
          return r;
        })
      );
    })
  );
});
