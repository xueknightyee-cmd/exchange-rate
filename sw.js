// sw.js —— 离线缓存 + 版本更新。
// 页面（HTML）走「网络优先带超时回退」，改版后能拿到新版；网络慢或断网时立刻用缓存。
// 改动网页后，把下面的 CACHE 版本号加一（fx-v2 → fx-v3），手机才会换新缓存。

const CACHE = "fx-v2";
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

// 网络优先 + 超时回退缓存：打开快，又能拿到新版本
function networkFirstPage(req, fallbackKey, timeoutMs) {
  return new Promise((resolve) => {
    let settled = false;
    const fromCache = async () => {
      if (settled) return;
      settled = true;
      const hit = (await caches.match(req)) || (await caches.match(fallbackKey));
      resolve(
        hit ||
          new Response("离线且无缓存，请联网打开一次。", {
            status: 503,
            headers: { "Content-Type": "text/plain; charset=utf-8" },
          })
      );
    };
    const timer = setTimeout(fromCache, timeoutMs || 1200);
    fetch(req)
      .then((r) => {
        if (r && r.ok) {
          const cl = r.clone();
          caches.open(CACHE).then((c) => c.put(req, cl));
        }
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(r);
      })
      .catch(() => {
        clearTimeout(timer);
        fromCache();
      });
  });
}

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

  // 页面：网络优先（带超时回退），既保证更新到位，又不拖慢打开
  const isPage =
    e.request.mode === "navigate" || /\.html?$/i.test(url.pathname) || /\/$/.test(url.pathname);
  if (isPage) {
    e.respondWith(networkFirstPage(e.request, "./index.html", 1200));
    return;
  }

  // 其他静态资源（js/图标）：缓存优先，命中直接给；未命中走网络并回填缓存
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
