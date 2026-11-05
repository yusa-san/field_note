/* フィールドノート Service Worker
 * - アプリ本体: ネットワーク優先（更新をすぐ反映）、オフライン時はキャッシュ。
 *   GitHub Pages はファイルを 10 分間ブラウザに残させる（Cache-Control: max-age=600）ので、
 *   ふつうに取るとリロードしても古い app.js が出る。必ずサーバーに確かめる（no-cache：変わっていなければ 304 で軽い）
 * - 地図タイル: キャッシュ優先。表示したタイルは自動で端末に残す（上限あり）
 */
const VERSION = "v29";
const SHELL = `fn-shell-${VERSION}`;
const TILES_RT = "fn-tiles-rt";      // 自動キャッシュ（古いものから削除）
const TILES_SAVED = "fn-tiles-saved"; // 「表示範囲を保存」で明示的に保存したもの
const RT_MAX = 4000;

const SHELL_FILES = [
  "./", "index.html", "style.css", "vector.js", "dem.js", "reinfo-catalog.js", "datalayers.js", "estat-gis-catalog.js", "estatgis.js", "boundary.js", "importlayers.js", "georef.js", "print.js", "fieldtools.js", "extra-data.js", "extralayers.js", "survey.js", "memo-tools.js", "cluster.js", "asr-worker.js", "app.js", "manifest.webmanifest", "icon.svg", "icon-192.png", "icon-512.png",
  "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css",
  "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js",
  "https://cdn.jsdelivr.net/npm/leaflet-rotate@0.2.8/dist/leaflet-rotate.js",
  "https://maps.gsi.go.jp/js/muni.js",
];
const TILE_HOSTS = ["cyberjapandata.gsi.go.jp", "disaportaldata.gsi.go.jp", "tile.openstreetmap.org", "ktgis.net", "habs.rad.naro.go.jp"];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(SHELL).then((c) => Promise.all(SHELL_FILES.map((u) => c.add(new Request(u, { mode: u.startsWith("http") && !u.includes("muni.js") ? "cors" : "no-cors", cache: u.startsWith("http") ? "default" : "no-cache" })).catch(() => {}))))
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
    // 画面の読み込み（navigate）の Request には設定を足せないので、URL から作り直す
    const res = await fetch(req.mode === "navigate" ? new Request(req.url, { cache: "no-cache", credentials: "same-origin" }) : new Request(req, { cache: "no-cache" }));
    if (res.ok) (await caches.open(SHELL)).put(req, res.clone());
    return res;
  } catch {
    const hit = await caches.match(req, { ignoreSearch: true });
    if (hit) return hit;
    if (req.mode === "navigate") return caches.match("index.html");
    throw new Error("offline");
  }
}

/** PMTiles の範囲読み込み：範囲ごとに端末に残す（2 回目以降とオフラインで速い） */
async function rangeResponse(req) {
  const range = req.headers.get("range");
  const key = `${req.url}${req.url.includes("?") ? "&" : "?"}__range=${encodeURIComponent(range)}`;
  const hit = (await caches.match(key, { cacheName: TILES_SAVED })) || (await caches.match(key, { cacheName: TILES_RT }));
  if (hit) return hit;
  try {
    const res = await fetch(req);
    if (res.status === 206) {
      const c = await caches.open(TILES_RT);
      // Cache API は 206 を保存できないので、同じ中身・ヘッダの 200 として保存し、返すときに 206 に戻す
      const body = await res.clone().arrayBuffer();
      const headers = new Headers(res.headers);
      headers.set("x-fn-status", "206");
      await c.put(key, new Response(body, { status: 200, headers }));
      if (Math.random() < 0.05) trimRuntime();
    }
    return res;
  } catch {
    return new Response("", { status: 504, statusText: "offline" });
  }
}
async function rangeFromCache(req) {
  const res = await rangeResponse(req);
  if (res.headers.get("x-fn-status") === "206") {
    const headers = new Headers(res.headers);
    headers.delete("x-fn-status");
    return new Response(await res.arrayBuffer(), { status: 206, statusText: "Partial Content", headers });
  }
  return res;
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (req.headers.has("range")) {
    if (/\.pmtiles$/i.test(url.pathname)) return e.respondWith(rangeFromCache(req));
    return; // その他の範囲読み込みはブラウザに任せる
  }
  // 不動産情報ライブラリ（中継サーバ経由のタイル）・市区町村界：一度読んだものは端末に残す
  if (url.pathname.includes("/reinfolib/") || url.hostname === "geoshape.ex.nii.ac.jp") return e.respondWith(tileResponse(req));
  if (TILE_HOSTS.includes(url.hostname)) return e.respondWith(tileResponse(req));
  if (url.origin === self.location.origin) return e.respondWith(shellResponse(req));
  if (url.hostname === "unpkg.com" || url.hostname === "cdn.jsdelivr.net" || url.hostname === "gsi-cyberjapan.github.io" || url.href.endsWith("/js/muni.js")) {
    // CDN の固定バージョン：キャッシュ優先
    e.respondWith(caches.match(req, { ignoreVary: true }).then((hit) => hit || fetch(req).then((res) => {
      if (res.ok || res.type === "opaque") caches.open(SHELL).then((c) => c.put(req, res.clone()));
      return res;
    })));
  }
  // 地理院 API（標高・住所・検索）はキャッシュしない
});
