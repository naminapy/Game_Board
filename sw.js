// オフラインでも開けるようにするための「サービスワーカー」
// 通信できるときは最新のファイルを取って保存し、通信できないときは保存しておいたものを出す
const CACHE = "game-board-v3";

// 最初にインストールされるとき：基本のファイルを保存しておく
self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(["./", "./index.html", "./manifest.webmanifest", "./icon-192.png"])));
  self.skipWaiting();
});

// 古い保存データを掃除する
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

// ファイルを取りに行くとき：まず通信を試して、だめなら保存してあるものを使う
self.addEventListener("fetch", e => {
  if (e.request.method !== "GET") return;
  // 他のサイト（GitHubのAPIなど）への通信は、データを保存しないようにそのまま通す
  if (new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(
    fetch(e.request, {cache: "no-cache"}) // ブラウザの一時保存を使わず、毎回サーバーに最新か確認する
      .then(r => { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)).catch(() => {}); return r; })
      .catch(() => caches.match(e.request))
  );
});
