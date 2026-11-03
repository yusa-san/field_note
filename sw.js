/* フィールドノート Service Worker
 * - アプリ本体: ネットワーク優先（更新をすぐ反映）、オフライン時はキャッシュ
 * - 地図タイル: キャッシュ優先。表示したタイルは自動で端末に残す（上限あり）
 */
const VERSION = "v3";
const SHELL = `fn-shell-${VERSION}`;
const TILES_RT = "fn-tiles-rt";      // 自動キャッシュ（古いものから削除）
const TILES_SAVED = "fn-tiles-saved"; // 「表示範囲を保存」で明示的に保存したもの
const RT_MAX = 4000;

const SHELL_FILES = [
  "./", "index.html", "style.css", "georef.js", "app.js", "manifest.webmanifest", "icon.svg", "icon-192.png", "icon-512.png",
  "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css",
  "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js",
  "https://maps.gsi.go.jp/js/muni.js",
];
const TILE_HOSTS = ["cyberjapandata.gsi.go.jp", "disaportaldata.gsi.go.jp", "tile.openstreetmap.org"];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(SHELL).then((c) => Promise.all(SHELL_FILES.map((u) => c.add(new Request(u, { mode: u.startsWith("http") && !u.includes("muni.js") ? "cors" : "no-cors" })).catch(() => {}))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith("fn-shell-") && k !== SHELL).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

let trimming = false;
async function trimRuntime() {
  if (trimming) return;
  trimming = true;
  try {
    const c = await caches.open(TILES_RT);
    const keys = await c.keys();
    const over = keys.length - RT_MAX;
    for (let i = 0; i < over; i++) await c.delete(keys[i]);
  } finally {
    trimming = false;
  }
}

async function tileResponse(req) {
  const hit = (await caches.match(req.url, { cacheName: TILES_SAVED })) || (await caches.match(req.url, { cacheName: TILES_RT }));
  if (hit) return hit;
  try {
    const res = await fetch(req);
    if (res.ok && res.type !== "opaque") {
      const c = await caches.open(TILES_RT);
      await c.put(req.url, res.clone());
      if (Math.random() < 0.05) trimRuntime();
    }
    return res;
  } catch {
    return new Response("", { status: 504, statusText: "offline" });
  }
}

async function shellResponse(req) {
  try {
    const res = await fetch(req);
    if (res.ok) (await caches.open(SHELL)).put(req, res.clone());
    return res;
  } catch {
    const hit = await caches.match(req, { ignoreSearch: true });
    if (hit) return hit;
    if (req.mode === "navigate") return caches.match("index.html");
    throw new Error("offline");
  }
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (TILE_HOSTS.includes(url.hostname)) return e.respondWith(tileResponse(req));
  if (url.origin === self.location.origin) return e.respondWith(shellResponse(req));
  if (url.hostname === "unpkg.com" || url.hostname === "cdn.jsdelivr.net" || url.href.endsWith("/js/muni.js")) {
    // CDN の固定バージョン：キャッシュ優先
    e.respondWith(caches.match(req, { ignoreVary: true }).then((hit) => hit || fetch(req).then((res) => {
      if (res.ok || res.type === "opaque") caches.open(SHELL).then((c) => c.put(req, res.clone()));
      return res;
    })));
  }
  // 地理院 API（標高・住所・検索）はキャッシュしない
});
