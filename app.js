/* フィールドノート — 現地調査用 Web 地図メモ
 * - 依存: Leaflet 1.9.4（CDN）のみ。ビルド不要の素の JS。
 * - データは端末内（IndexedDB / localStorage）に保存し、JSON / GeoJSON / CSV / GPX に書き出す。
 */
"use strict";

/* ====================================================================
 * 設定
 * ==================================================================== */
const GSI_XYZ = "https://cyberjapandata.gsi.go.jp/xyz";
const HAZ = "https://disaportaldata.gsi.go.jp/raster";
const ATTR_GSI = '<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank" rel="noopener">国土地理院</a>';
const ATTR_HAZ = '<a href="https://disaportal.gsi.go.jp/" target="_blank" rel="noopener">ハザードマップポータルサイト</a>';

const BASE_LAYERS = [
  { id: "std", name: "標準地図", url: `${GSI_XYZ}/std/{z}/{x}/{y}.png`, max: 18, attr: ATTR_GSI },
  { id: "pale", name: "淡色地図", url: `${GSI_XYZ}/pale/{z}/{x}/{y}.png`, max: 18, attr: ATTR_GSI },
  { id: "photo", name: "写真（最新）", url: `${GSI_XYZ}/seamlessphoto/{z}/{x}/{y}.jpg`, max: 18, attr: ATTR_GSI },
  { id: "gazo1", name: "写真 1974-78", url: `${GSI_XYZ}/gazo1/{z}/{x}/{y}.jpg`, min: 10, max: 17, attr: ATTR_GSI },
  { id: "old10", name: "写真 1961-69", url: `${GSI_XYZ}/ort_old10/{z}/{x}/{y}.png`, min: 10, max: 17, attr: ATTR_GSI },
  { id: "usa10", name: "写真 1945-50", url: `${GSI_XYZ}/ort_USA10/{z}/{x}/{y}.png`, min: 10, max: 17, attr: ATTR_GSI },
  { id: "relief", name: "色別標高図", url: `${GSI_XYZ}/relief/{z}/{x}/{y}.png`, max: 15, attr: ATTR_GSI },
  { id: "hillshade", name: "陰影起伏図", url: `${GSI_XYZ}/hillshademap/{z}/{x}/{y}.png`, max: 16, attr: ATTR_GSI },
  { id: "osm", name: "OpenStreetMap", url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png", max: 19,
    attr: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>', noPrefetch: true },
];

const OVERLAYS = [
  { id: "ov_hillshade", name: "陰影起伏", desc: "地形の凹凸を強調", url: `${GSI_XYZ}/hillshademap/{z}/{x}/{y}.png`, max: 16, op: 0.4, attr: ATTR_GSI },
  { id: "ov_slope", name: "傾斜量図", desc: "急な斜面ほど濃い", url: `${GSI_XYZ}/slopemap/{z}/{x}/{y}.png`, max: 15, op: 0.5, attr: ATTR_GSI },
  { id: "ov_relief", name: "色別標高図", desc: "標高の段彩", url: `${GSI_XYZ}/relief/{z}/{x}/{y}.png`, max: 15, op: 0.5, attr: ATTR_GSI },
  { id: "ov_lcmfc", name: "治水地形分類図", desc: "旧河道・自然堤防・後背湿地など", url: `${GSI_XYZ}/lcmfc2/{z}/{x}/{y}.png`, min: 11, max: 16, op: 0.6, attr: ATTR_GSI },
  { id: "ov_lcm25k", name: "土地条件図", desc: "地形分類（主に都市部）", url: `${GSI_XYZ}/lcm25k_2012/{z}/{x}/{y}.png`, min: 10, max: 16, op: 0.6, attr: ATTR_GSI },
  { id: "ov_swale", name: "明治期の低湿地", desc: "明治期の地図から判読した湿地", url: `${GSI_XYZ}/swale/{z}/{x}/{y}.png`, min: 10, max: 16, op: 0.6, attr: ATTR_GSI },
  { id: "ov_flood", name: "洪水浸水想定（最大）", desc: "想定最大規模の浸水深", url: `${HAZ}/01_flood_l2_shinsuishin_data/{z}/{x}/{y}.png`, max: 17, op: 0.6, attr: ATTR_HAZ },
  { id: "ov_tsunami", name: "津波浸水想定", desc: "都道府県の津波浸水想定", url: `${HAZ}/04_tsunami_newlegend_data/{z}/{x}/{y}.png`, max: 17, op: 0.6, attr: ATTR_HAZ },
  { id: "ov_dosekiryu", name: "土石流警戒区域", desc: "土砂災害警戒区域（土石流）", url: `${HAZ}/05_dosekiryukeikaikuiki/{z}/{x}/{y}.png`, max: 17, op: 0.7, attr: ATTR_HAZ },
  { id: "ov_kyukeisha", name: "急傾斜地警戒区域", desc: "土砂災害警戒区域（急傾斜地の崩壊）", url: `${HAZ}/05_kyukeishakeikaikuiki/{z}/{x}/{y}.png`, max: 17, op: 0.7, attr: ATTR_HAZ },
  { id: "ov_jisuberi", name: "地すべり警戒区域", desc: "土砂災害警戒区域（地すべり）", url: `${HAZ}/05_jisuberikeikaikuiki/{z}/{x}/{y}.png`, max: 17, op: 0.7, attr: ATTR_HAZ },
];

const PALETTE = ["#2e7d32", "#6d4c41", "#5e35b1", "#1565c0", "#00838f", "#c62828", "#ef6c00", "#ad1457", "#558b2f", "#616161"];
const DEFAULT_CATEGORIES = ["景観", "建物・構造物", "地形", "石碑・標識", "聞き取り", "要確認", "その他"];
const DEFAULT_VIEW = { lat: 35.681, lon: 139.767, z: 13 };
const PREFETCH_LIMIT = 1500;

/* ====================================================================
 * ユーティリティ
 * ==================================================================== */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : "id-" + Date.now().toString(36) + Math.random().toString(36).slice(2));
const nowIso = () => new Date().toISOString();
const rad = (d) => (d * Math.PI) / 180;
const deg = (r) => (r * 180) / Math.PI;

function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "html") el.innerHTML = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children.flat()) if (c != null && c !== false) el.append(c.nodeType ? c : document.createTextNode(c));
  return el;
}

let toastTimer;
function toast(msg, ms = 2400) {
  const t = $("#toast");
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), ms);
}

function fmtLatLon(lat, lon, d = 6) {
  return `${lat.toFixed(d)}, ${lon.toFixed(d)}`;
}
function toDMS(v, pos, neg) {
  const s = v >= 0 ? pos : neg;
  v = Math.abs(v);
  const d = Math.floor(v), m = Math.floor((v - d) * 60), sec = ((v - d) * 60 - m) * 60;
  return `${s}${d}°${String(m).padStart(2, "0")}′${sec.toFixed(1).padStart(4, "0")}″`;
}
function fmtDate(iso) {
  const d = new Date(iso);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
function stamp() {
  const d = new Date(), p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}
function fmtDist(m) {
  if (m == null || !isFinite(m)) return "";
  return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(m < 10000 ? 2 : 1)} km`;
}
function fmtArea(a) {
  if (a < 10000) return `${Math.round(a).toLocaleString()} m²`;
  if (a < 1e6) return `${(a / 10000).toFixed(2)} ha`;
  return `${(a / 1e6).toFixed(2)} km²`;
}
const DIRS = ["北", "北北東", "北東", "東北東", "東", "東南東", "南東", "南南東", "南", "南南西", "南西", "西南西", "西", "西北西", "北西", "北北西"];
const dirName = (b) => DIRS[Math.round(((b % 360) + 360) % 360 / 22.5) % 16];

/** 2点間の距離 (m)：球面三角法（Haversine） */
function distance(a, b) {
  const R = 6371008.8;
  const dLat = rad(b.lat - a.lat), dLon = rad(b.lon - a.lon);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}
/** a から b への方位角 (度, 北=0 時計回り) */
function bearing(a, b) {
  const y = Math.sin(rad(b.lon - a.lon)) * Math.cos(rad(b.lat));
  const x = Math.cos(rad(a.lat)) * Math.sin(rad(b.lat)) - Math.sin(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.cos(rad(b.lon - a.lon));
  return (deg(Math.atan2(y, x)) + 360) % 360;
}
/** 多角形の面積 (m²)：球面近似 */
function polygonArea(pts) {
  if (pts.length < 3) return 0;
  const R = 6378137;
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const p1 = pts[i], p2 = pts[(i + 1) % pts.length];
    s += rad(p2.lon - p1.lon) * (2 + Math.sin(rad(p1.lat)) + Math.sin(rad(p2.lat)));
  }
  return Math.abs((s * R * R) / 2);
}
/** 標準地域メッシュコード（3次メッシュ, 約1km） */
function meshCode(lat, lon) {
  if (lat < 20 || lat > 46 || lon < 122 || lon > 154) return "";
  const a = lat * 1.5, b = lon - 100;
  const p = Math.floor(a), u = Math.floor(b);
  const q = Math.floor((a - p) * 8), v = Math.floor((b - u) * 8);
  const r = Math.floor(((a - p) * 8 - q) * 10), w = Math.floor(((b - u) * 8 - v) * 10);
  return `${p}${u}-${q}${v}-${r}${w}`;
}

async function copyText(s) {
  try {
    await navigator.clipboard.writeText(s);
    toast("コピーしました");
  } catch {
    prompt("コピーしてください", s);
  }
}

/* ====================================================================
 * 保存領域：IndexedDB（メモ・写真・軌跡） + localStorage（設定）
 * ==================================================================== */
const DB = {
  db: null,
  open() {
    if (this.db) return Promise.resolve(this.db);
    return new Promise((res, rej) => {
      const rq = indexedDB.open("fieldnote", 1);
      rq.onupgradeneeded = () => {
        const db = rq.result;
        db.createObjectStore("memos", { keyPath: "id" });
        const ph = db.createObjectStore("photos", { keyPath: "id" });
        ph.createIndex("memoId", "memoId");
        db.createObjectStore("tracks", { keyPath: "id" });
      };
      rq.onsuccess = () => res((this.db = rq.result));
      rq.onerror = () => rej(rq.error);
    });
  },
  async run(store, mode, fn) {
    const db = await this.open();
    return new Promise((res, rej) => {
      const tx = db.transaction(store, mode);
      const os = tx.objectStore(store);
      let out;
      const r = fn(os);
      if (r) r.onsuccess = () => (out = r.result);
      tx.oncomplete = () => res(out);
      tx.onerror = () => rej(tx.error);
      tx.onabort = () => rej(tx.error || new Error("transaction aborted"));
    });
  },
  get: (s, k) => DB.run(s, "readonly", (os) => os.get(k)),
  all: (s) => DB.run(s, "readonly", (os) => os.getAll()),
  put: (s, v) => DB.run(s, "readwrite", (os) => os.put(v)),
  del: (s, k) => DB.run(s, "readwrite", (os) => os.delete(k)),
  clear: (s) => DB.run(s, "readwrite", (os) => os.clear()),
  byIndex: (s, idx, k) => DB.run(s, "readonly", (os) => os.index(idx).getAll(k)),
};

const Settings = {
  data: { project: "", observer: "", categories: DEFAULT_CATEGORIES.slice(), lastExportAt: null },
  load() {
    try {
      Object.assign(this.data, JSON.parse(localStorage.getItem("fn.settings") || "{}"));
    } catch {}
    if (!Array.isArray(this.data.categories) || !this.data.categories.length) this.data.categories = DEFAULT_CATEGORIES.slice();
  },
  save() {
    try { localStorage.setItem("fn.settings", JSON.stringify(this.data)); } catch {}
  },
};
const catColor = (name) => {
  const i = Settings.data.categories.indexOf(name);
  return i >= 0 ? PALETTE[i % PALETTE.length] : "#616161";
};

/* ====================================================================
 * 状態
 * ==================================================================== */
const S = {
  map: null,
  base: null, baseId: "std",
  overlays: {}, // id -> { layer, opacity }
  pos: null, // 直近の GPS 位置 {lat, lon, acc, alt, altAcc, heading, speed, t}
  heading: null, // 端末の向き（度）
  follow: false,
  meMarker: null, accCircle: null,
  memos: new Map(), markers: new Map(),
  thumbUrls: new Map(),
  track: null, trackLine: null, wakeLock: null,
  shownTracks: new Map(),
  measure: null,
  crosshair: false,
  posInfo: { elev: null, addr: null, at: null },
};

/* ====================================================================
 * 地図
 * ==================================================================== */
function makeTile(def, opacity = 1, z = 200) {
  return L.tileLayer(def.url, {
    maxNativeZoom: def.max, maxZoom: 20, minZoom: def.min || 0,
    attribution: def.attr, opacity, crossOrigin: true, zIndex: z,
    errorTileUrl: "data:image/gif;base64,R0lGODlhAQABAAAAACw=",
  });
}

function loadView() {
  try {
    return JSON.parse(localStorage.getItem("fn.view")) || null;
  } catch { return null; }
}
function saveView() {
  const c = S.map.getCenter();
  const ov = {};
  for (const [id, o] of Object.entries(S.overlays)) ov[id] = o.opacity;
  try {
    localStorage.setItem("fn.view", JSON.stringify({ lat: c.lat, lon: c.lng, z: S.map.getZoom(), base: S.baseId, overlays: ov, crosshair: S.crosshair }));
  } catch {}
}

function setBase(id) {
  const def = BASE_LAYERS.find((b) => b.id === id) || BASE_LAYERS[0];
  if (S.base) S.map.removeLayer(S.base);
  S.base = makeTile(def, 1, 1).addTo(S.map);
  S.baseId = def.id;
  if (def.min && S.map.getZoom() < def.min) toast(`この地図はズーム${def.min}以上で表示されます`);
  saveView();
}
function setOverlay(id, opacity) {
  const def = OVERLAYS.find((o) => o.id === id);
  if (!def) return;
  const cur = S.overlays[id];
  if (opacity == null || opacity <= 0) {
    if (cur) S.map.removeLayer(cur.layer);
    delete S.overlays[id];
  } else if (cur) {
    cur.layer.setOpacity(opacity);
    cur.opacity = opacity;
  } else {
    const z = 10 + OVERLAYS.indexOf(def);
    S.overlays[id] = { layer: makeTile(def, opacity, z).addTo(S.map), opacity };
    if (def.min && S.map.getZoom() < def.min) toast(`「${def.name}」はズーム${def.min}以上で表示されます`);
  }
  saveView();
}

function initMap() {
  const saved = loadView();
  const v = saved || DEFAULT_VIEW;
  S.map = L.map("map", { zoomControl: false, attributionControl: true, maxZoom: 20, tapTolerance: 20 })
    .setView([v.lat, v.lon], v.z);
  S.map.attributionControl.setPrefix(false);
  L.control.scale({ imperial: false, position: "bottomleft" }).addTo(S.map);
  setBase(v.base || "std");
  for (const [id, op] of Object.entries(v.overlays || {})) setOverlay(id, op);
  if (v.crosshair) toggleCrosshair(true);

  S.map.on("moveend", () => {
    saveView();
    if (S.crosshair) updateStatus();
  });
  S.map.on("move", () => S.crosshair && updateStatusCoordOnly());
  S.map.on("dragstart", () => setFollow(false));
  S.map.on("click", (e) => S.measure && addMeasurePoint(e.latlng));
  S.map.on("contextmenu", (e) => onLongPress(e.latlng));
  setupLongPress();
  return !saved; // 初回起動なら最初の測位位置へ移動する
}

/** iOS Safari は長押しで contextmenu を出さないので自前で検出する */
function setupLongPress() {
  const el = S.map.getContainer();
  let timer = null, start = null;
  const cancel = () => { clearTimeout(timer); timer = null; };
  el.addEventListener("touchstart", (e) => {
    if (e.touches.length !== 1) return cancel();
    const t = e.touches[0];
    start = { x: t.clientX, y: t.clientY };
    timer = setTimeout(() => {
      timer = null;
      const rect = el.getBoundingClientRect();
      const ll = S.map.containerPointToLatLng([start.x - rect.left, start.y - rect.top]);
      onLongPress(ll, true);
    }, 650);
  }, { passive: true });
  el.addEventListener("touchmove", (e) => {
    if (!timer || !start) return;
    const t = e.touches[0];
    if (Math.hypot(t.clientX - start.x, t.clientY - start.y) > 12) cancel();
  }, { passive: true });
  el.addEventListener("touchend", cancel, { passive: true });
  el.addEventListener("touchcancel", cancel, { passive: true });
}
let lastLongPress = 0;
function onLongPress(latlng, fromTouch) {
  if (S.measure) return;
  if (Date.now() - lastLongPress < 900) return; // Android では touch と contextmenu が両方来る
  lastLongPress = Date.now();
  if (fromTouch && navigator.vibrate) navigator.vibrate(30);
  openMemoForm(null, { lat: latlng.lat, lon: latlng.lng, source: "map" });
}

/* ====================================================================
 * 現在地（GPS）・方位
 * ==================================================================== */
function meIcon() {
  return L.divIcon({ className: "me-icon", iconSize: [60, 60], iconAnchor: [30, 30], html: '<div class="me-wrap"><div class="me-cone" hidden></div><div class="me-dot"></div></div>' });
}

function startGPS() {
  if (!("geolocation" in navigator)) {
    setStatusError("この端末では位置情報が使えません");
    return;
  }
  if (!window.isSecureContext) {
    setStatusError("位置情報には HTTPS での配信が必要です");
    return;
  }
  navigator.geolocation.watchPosition(onPosition, onPositionError, { enableHighAccuracy: true, maximumAge: 2000, timeout: 30000 });
}

let firstFix = true, moveToFirstFix = false;
function onPosition(p) {
  const c = p.coords;
  S.pos = { lat: c.latitude, lon: c.longitude, acc: c.accuracy, alt: c.altitude, altAcc: c.altitudeAccuracy, heading: c.heading, speed: c.speed, t: p.timestamp };
  const ll = [S.pos.lat, S.pos.lon];
  if (!S.meMarker) {
    S.accCircle = L.circle(ll, { radius: S.pos.acc, color: "#1a73e8", weight: 1, fillOpacity: 0.1, interactive: false }).addTo(S.map);
    S.meMarker = L.marker(ll, { icon: meIcon(), interactive: false, keyboard: false, zIndexOffset: 1000 }).addTo(S.map);
  } else {
    S.meMarker.setLatLng(ll);
    S.accCircle.setLatLng(ll).setRadius(S.pos.acc);
  }
  if (firstFix) {
    firstFix = false;
    if (moveToFirstFix) S.map.setView(ll, Math.max(S.map.getZoom(), 16));
  } else if (S.follow) {
    S.map.panTo(ll, { animate: true });
  }
  if (S.heading == null && c.heading != null && !isNaN(c.heading) && (c.speed || 0) > 0.8) drawHeading(c.heading);
  if (S.track) addTrackPoint(S.pos);
  updateStatus();
  maybeLookupPosInfo();
  refreshListDistancesSoon();
}
function onPositionError(err) {
  const msg = { 1: "位置情報の利用が許可されていません（ブラウザ設定を確認）", 2: "現在地を取得できません", 3: "現在地の取得がタイムアウトしました" }[err.code] || err.message;
  if (err.code === 1 || !S.pos) setStatusError(msg);
  else $("#gps-dot").className = "dot weak";
}
function setStatusError(msg) {
  $("#gps-dot").className = "dot off";
  $("#st-coord").textContent = msg;
}

/** 現在地の標高・住所は動いたときだけ問い合わせる（API 負荷を抑える） */
let lookupBusy = false;
async function maybeLookupPosInfo() {
  if (!S.pos || lookupBusy || S.crosshair) return;
  const last = S.posInfo.at;
  if (last && distance(last, S.pos) < 40) return;
  lookupBusy = true;
  const at = { lat: S.pos.lat, lon: S.pos.lon };
  try {
    const [elev, addr] = await Promise.all([fetchElevation(at.lat, at.lon), reverseGeocode(at.lat, at.lon)]);
    S.posInfo = { elev, addr, at };
    updateStatus();
  } finally {
    lookupBusy = false;
  }
}

function updateStatusCoordOnly() {
  const c = S.map.getCenter();
  $("#st-coord").textContent = "✚ " + fmtLatLon(c.lat, c.lng, 6);
}
let centerLookupTimer;
function updateStatus() {
  const dot = $("#gps-dot");
  if (S.pos) dot.className = "dot " + (S.pos.acc <= 30 ? "ok" : "weak");
  if (S.crosshair) {
    // 十字線モード：地図中心の情報を表示
    const c = S.map.getCenter();
    updateStatusCoordOnly();
    const parts = [];
    if (S.pos) parts.push(`現在地から ${fmtDist(distance(S.pos, { lat: c.lat, lon: c.lng }))} ${dirName(bearing(S.pos, { lat: c.lat, lon: c.lng }))}`);
    $("#st-acc").textContent = parts.join(" ");
    $("#st-mesh").textContent = meshCode(c.lat, c.lng) ? "メッシュ " + meshCode(c.lat, c.lng) : "";
    clearTimeout(centerLookupTimer);
    centerLookupTimer = setTimeout(async () => {
      const [elev, addr] = await Promise.all([fetchElevation(c.lat, c.lng), reverseGeocode(c.lat, c.lng)]);
      if (!S.crosshair) return;
      $("#st-elev").textContent = elev ? `標高 ${elev.value} m` : "";
      $("#st-addr").textContent = addr || "";
    }, 500);
    return;
  }
  if (!S.pos) return;
  $("#st-coord").textContent = fmtLatLon(S.pos.lat, S.pos.lon, 6);
  $("#st-acc").textContent = `±${Math.round(S.pos.acc)} m`;
  const e = S.posInfo.elev;
  $("#st-elev").textContent = e ? `標高 ${e.value} m` : S.pos.alt != null ? `GPS高度 ${Math.round(S.pos.alt)} m` : "";
  const m = meshCode(S.pos.lat, S.pos.lon);
  $("#st-mesh").textContent = m ? `メッシュ ${m}` : "";
  $("#st-addr").textContent = S.posInfo.addr || "";
}

function setFollow(on) {
  S.follow = on;
  $("#btn-locate").classList.toggle("follow", on);
}

let orientationStarted = false;
async function startOrientation() {
  if (orientationStarted) return true;
  try {
    if (typeof DeviceOrientationEvent !== "undefined" && typeof DeviceOrientationEvent.requestPermission === "function") {
      const r = await DeviceOrientationEvent.requestPermission(); // iOS はユーザー操作中に許可が必要
      if (r !== "granted") return false;
    }
  } catch { return false; }
  orientationStarted = true;
  const screenAngle = () => (screen.orientation && screen.orientation.angle) || window.orientation || 0;
  const handler = (e) => {
    let hd = null;
    if (typeof e.webkitCompassHeading === "number") hd = e.webkitCompassHeading;
    else if (e.absolute && e.alpha != null) hd = 360 - e.alpha;
    if (hd == null) return;
    S.heading = (hd + screenAngle() + 360) % 360;
    scheduleHeadingDraw();
  };
  if ("ondeviceorientationabsolute" in window) window.addEventListener("deviceorientationabsolute", handler);
  else window.addEventListener("deviceorientation", handler);
  return true;
}
let headingRaf = 0;
function scheduleHeadingDraw() {
  if (headingRaf) return;
  headingRaf = requestAnimationFrame(() => {
    headingRaf = 0;
    drawHeading(S.heading);
    const hv = $(".heading-val");
    if (hv) hv.textContent = `${Math.round(S.heading)}°（${dirName(S.heading)}）`;
  });
}
function drawHeading(hd) {
  const el = S.meMarker && S.meMarker.getElement();
  const cone = el && el.querySelector(".me-cone");
  if (!cone) return;
  cone.hidden = false;
  cone.style.transform = `rotate(${hd}deg)`;
}

/* ====================================================================
 * 地理院 API（標高・逆ジオコーディング・地名検索）
 * ==================================================================== */
const elevCache = new Map();
async function fetchElevation(lat, lon) {
  const key = `${lat.toFixed(5)},${lon.toFixed(5)}`;
  if (elevCache.has(key)) return elevCache.get(key);
  try {
    const r = await fetch(`https://cyberjapandata2.gsi.go.jp/general/dem/scripts/getelevation.php?lon=${lon}&lat=${lat}&outtype=JSON`);
    const j = await r.json();
    const v = typeof j.elevation === "number" ? { value: j.elevation, src: j.hsrc } : null;
    elevCache.set(key, v);
    return v;
  } catch { return null; }
}

let muniPromise = null;
function loadMuni() {
  // 市区町村コード表（地理院地図の muni.js）を読み込む
  if (!muniPromise) {
    muniPromise = new Promise((res) => {
      window.GSI = window.GSI || {};
      const s = document.createElement("script");
      s.src = "https://maps.gsi.go.jp/js/muni.js";
      s.onload = () => res(window.GSI.MUNI_ARRAY || {});
      s.onerror = () => { muniPromise = null; res({}); };
      document.head.append(s);
    });
  }
  return muniPromise;
}
async function reverseGeocode(lat, lon) {
  try {
    const [r, muni] = await Promise.all([
      fetch(`https://mreversegeocoder.gsi.go.jp/reverse-geocoder/LonLatToAddress?lat=${lat}&lon=${lon}`).then((r) => r.json()),
      loadMuni(),
    ]);
    if (!r || !r.results) return null;
    const code = String(parseInt(r.results.muniCd, 10));
    const m = muni[code];
    const parts = m ? m.split(",") : [];
    return (parts[1] || "") + (parts[3] || "").replace(/\s|　/g, "") + (r.results.lv01Nm === "－" ? "" : r.results.lv01Nm || "");
  } catch { return null; }
}
async function searchPlace(q) {
  const r = await fetch(`https://msearch.gsi.go.jp/address-search/AddressSearch?q=${encodeURIComponent(q)}`);
  const j = await r.json();
  return (j || []).slice(0, 50).map((f) => ({ title: f.properties.title, lon: f.geometry.coordinates[0], lat: f.geometry.coordinates[1] }));
}

/* ====================================================================
 * ボトムシート
 * ==================================================================== */
let sheetOnClose = null, sheetGuard = null;
function openSheet(title, body, { onClose, guard, backdrop = true, height } = {}) {
  closeSheet(true);
  $("#sheet-title").textContent = title;
  const b = $("#sheet-body");
  b.replaceChildren(body);
  b.scrollTop = 0;
  $("#sheet").style.maxHeight = height || "";
  $("#sheet").hidden = false;
  $("#sheet-backdrop").hidden = !backdrop;
  sheetOnClose = onClose || null;
  sheetGuard = guard || null;
}
function closeSheet(force) {
  if ($("#sheet").hidden) return true;
  if (!force && sheetGuard && !sheetGuard()) return false;
  $("#sheet").hidden = true;
  $("#sheet-backdrop").hidden = true;
  const f = sheetOnClose;
  sheetOnClose = sheetGuard = null;
  if (f) f();
  return true;
}

/* ====================================================================
 * レイヤーパネル
 * ==================================================================== */
function tileThumbUrl(def) {
  const c = S.map.getCenter();
  const z = Math.min(def.max, Math.max(def.min || 0, Math.min(S.map.getZoom(), 15)));
  const n = 2 ** z;
  const x = Math.floor(((c.lng + 180) / 360) * n);
  const y = Math.floor(((1 - Math.asinh(Math.tan(rad(c.lat))) / Math.PI) / 2) * n);
  return def.url.replace("{z}", z).replace("{x}", x).replace("{y}", y);
}
function openLayers() {
  const grid = h("div", { class: "layer-grid" });
  for (const def of BASE_LAYERS) {
    const card = h("button", { class: "layer-card" + (def.id === S.baseId ? " on" : ""), type: "button" },
      h("img", { src: tileThumbUrl(def), alt: "", loading: "lazy", crossorigin: "anonymous" }), h("span", {}, def.name));
    card.onclick = () => {
      setBase(def.id);
      $$(".layer-card", grid).forEach((c) => c.classList.remove("on"));
      card.classList.add("on");
    };
    grid.append(card);
  }
  const ovs = h("div");
  for (const def of OVERLAYS) {
    const cur = S.overlays[def.id];
    const cb = h("input", { type: "checkbox", checked: !!cur });
    const rg = h("input", { type: "range", min: "0.1", max: "1", step: "0.05", value: cur ? cur.opacity : def.op });
    cb.onchange = () => setOverlay(def.id, cb.checked ? Number(rg.value) : 0);
    rg.oninput = () => {
      if (!cb.checked) cb.checked = true;
      setOverlay(def.id, Number(rg.value));
    };
    ovs.append(h("div", { class: "ov-row" }, cb, h("div", {}, def.name, h("small", {}, def.desc + (def.min ? `（ズーム${def.min}〜）` : ""))), rg));
  }
  const body = h("div", {},
    h("div", { class: "sect-title" }, "ベース地図"), grid,
    h("div", { class: "sect-title" }, "重ねる地図（透過度）"), ovs,
    h("p", { class: "note" }, "出典：国土地理院（地理院タイル）、ハザードマップポータルサイト、OpenStreetMap。ハザード情報は自治体の公表資料もあわせて確認してください。"),
  );
  openSheet("地図の切替", body, { backdrop: false, height: "62vh" });
}

/* ====================================================================
 * メモ
 * ==================================================================== */
async function loadMemos() {
  const list = await DB.all("memos");
  S.memos.clear();
  for (const m of list) S.memos.set(m.id, m);
  for (const mk of S.markers.values()) S.map.removeLayer(mk);
  S.markers.clear();
  for (const m of S.memos.values()) renderMarker(m);
  updateCounts();
}
function nextNo() {
  let mx = 0;
  for (const m of S.memos.values()) mx = Math.max(mx, m.no || 0);
  return mx + 1;
}
function updateCounts() {
  const n = S.memos.size;
  $("#memo-count").textContent = n ? n : "";
  const last = Settings.data.lastExportAt;
  let dirty = false;
  for (const m of S.memos.values()) if (!last || (m.updatedAt || m.createdAt) > last) { dirty = true; break; }
  $("#unsaved-badge").hidden = !dirty;
}

function renderMarker(m) {
  const old = S.markers.get(m.id);
  if (old) S.map.removeLayer(old);
  const icon = L.divIcon({
    className: "memo-pin", iconSize: [26, 26], iconAnchor: [13, 30], popupAnchor: [0, -28],
    html: `<div style="background:${catColor(m.category)}"><span>${m.no ?? ""}</span></div>`,
  });
  const mk = L.marker([m.lat, m.lon], { icon, riseOnHover: true }).addTo(S.map);
  mk.bindPopup("", { maxWidth: 260, autoPanPaddingTopLeft: [10, 110], autoPanPaddingBottomRight: [60, 90] });
  mk.on("popupopen", (e) => {
    const cur = S.memos.get(m.id) || m;
    const el = h("div", { html: popupHtml(cur) });
    el.querySelector('[data-pact="edit"]').onclick = () => {
      S.map.closePopup();
      openMemoForm(S.memos.get(m.id));
    };
    el.querySelector('[data-pact="copy"]').onclick = () => copyText(`${cur.lat.toFixed(6)}, ${cur.lon.toFixed(6)}`);
    e.popup.setContent(el);
    loadPopupThumb(cur, el, e.popup);
  });
  S.markers.set(m.id, mk);
}
function popupHtml(m) {
  const d = S.pos ? `${fmtDist(distance(S.pos, m))} ${dirName(bearing(S.pos, m))}` : "";
  return `<div class="pt">#${m.no ?? ""} ${esc(m.title || "（無題）")}</div>
    <div class="ps">${esc(m.category || "")}　${fmtDate(m.createdAt)}${d ? "　" + d : ""}</div>
    ${m.note ? `<div>${esc(m.note.slice(0, 240)).replace(/\n/g, "<br>")}</div>` : ""}
    <div class="pthumb"></div>
    <div class="pa">
      <button data-pact="edit">編集</button>
      <button data-pact="copy">座標コピー</button>
      <a href="https://www.google.com/maps/dir/?api=1&destination=${m.lat},${m.lon}" target="_blank" rel="noopener">経路</a>
    </div>`;
}
async function loadPopupThumb(m, el, popup) {
  const photos = await DB.byIndex("photos", "memoId", m.id);
  const box = el.querySelector(".pthumb");
  if (!box || !photos.length) return;
  photos.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const img = h("img", { src: thumbUrl(photos[0]), alt: "" });
  img.onload = () => popup.isOpen() && popup.update();
  box.replaceChildren(img);
  if (photos.length > 1) box.append(h("small", {}, `他 ${photos.length - 1} 枚`));
}
function thumbUrl(p) {
  if (!S.thumbUrls.has(p.id)) S.thumbUrls.set(p.id, URL.createObjectURL(p.thumb || p.blob));
  return S.thumbUrls.get(p.id);
}

/** 写真を縮小して JPEG Blob に（大きな原画像はそのまま保存しない） */
function loadImage(file) {
  return new Promise((res, rej) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => res({ img, url });
    img.onerror = () => { URL.revokeObjectURL(url); rej(new Error("画像を読み込めません")); };
    img.src = url;
  });
}
function drawScaled(img, maxPx, q) {
  const s = Math.min(1, maxPx / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.round(img.naturalWidth * s), hh = Math.round(img.naturalHeight * s);
  const c = document.createElement("canvas");
  c.width = w; c.height = hh;
  c.getContext("2d").drawImage(img, 0, 0, w, hh);
  return new Promise((res) => c.toBlob((b) => res({ blob: b, w, h: hh }), "image/jpeg", q));
}
async function processPhoto(file) {
  const { img, url } = await loadImage(file);
  try {
    const full = await drawScaled(img, 1600, 0.82);
    const th = await drawScaled(img, 320, 0.7);
    return { blob: full.blob, thumb: th.blob, width: full.w, height: full.h, takenAt: new Date(file.lastModified || Date.now()).toISOString(), origName: file.name };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * メモ入力フォーム
 * @param existing 既存メモ（編集時）
 * @param loc 新規時の位置 {lat, lon, source}
 */
async function openMemoForm(existing, loc) {
  const isNew = !existing;
  const memo = existing ? { ...existing } : {
    id: uuid(), no: nextNo(), createdAt: nowIso(), updatedAt: nowIso(),
    lat: loc.lat, lon: loc.lon, source: loc.source,
    accuracy: loc.source === "gps" && S.pos ? Math.round(S.pos.acc * 10) / 10 : null,
    gpsAltitude: loc.source === "gps" && S.pos && S.pos.alt != null ? Math.round(S.pos.alt * 10) / 10 : null,
    elevation: null, elevationSrc: null, address: null, mesh: meshCode(loc.lat, loc.lon),
    title: "", note: "", category: Settings.data.categories[0], tags: [], heading: null,
    baseMap: S.baseId, project: Settings.data.project || null, observer: Settings.data.observer || null,
  };
  let saved = !isNew;
  let dirty = false;

  const frag = $("#tpl-memo-form").content.cloneNode(true);
  const form = frag.querySelector("form");
  const f = form.elements;
  f.title.value = memo.title || "";
  f.note.value = memo.note || "";
  f.tags.value = (memo.tags || []).join(", ");
  form.addEventListener("input", () => (dirty = true));

  const locBox = form.querySelector(".loc-box");
  const renderLoc = () => {
    locBox.querySelector(".loc-coord").textContent = `#${memo.no}　${fmtLatLon(memo.lat, memo.lon)}`;
    const meta = [];
    meta.push(memo.source === "gps" ? `GPS ±${memo.accuracy ?? "?"} m` : "地図上で指定");
    if (memo.elevation != null) meta.push(`標高 ${memo.elevation} m`);
    if (memo.mesh) meta.push(`メッシュ ${memo.mesh}`);
    if (memo.address) meta.push(memo.address);
    if (!isNew) meta.push(`作成 ${fmtDate(memo.createdAt)}`);
    locBox.querySelector(".loc-meta").textContent = meta.join("　");
  };
  renderLoc();
  locBox.onclick = () => copyText(`${memo.lat.toFixed(6)}, ${memo.lon.toFixed(6)}`);

  // 位置に付随する情報（標高・住所）を非同期で取得
  const lookup = async () => {
    const at = { lat: memo.lat, lon: memo.lon };
    const [e, a] = await Promise.all([fetchElevation(at.lat, at.lon), reverseGeocode(at.lat, at.lon)]);
    if (memo.lat !== at.lat || memo.lon !== at.lon) return;
    memo.elevation = e ? e.value : null;
    memo.elevationSrc = e ? e.src : null;
    memo.address = a;
    renderLoc();
    if (saved) {
      const cur = S.memos.get(memo.id);
      if (cur) {
        Object.assign(cur, { elevation: memo.elevation, elevationSrc: memo.elevationSrc, address: memo.address });
        await DB.put("memos", cur);
      }
    }
  };
  if (isNew || memo.elevation == null || !memo.address) lookup();

  // カテゴリ
  const chips = form.querySelector(".cat-chips");
  const cats = Settings.data.categories.slice();
  if (memo.category && !cats.includes(memo.category)) cats.push(memo.category);
  for (const c of cats) {
    const chip = h("button", { type: "button", class: "chip" + (c === memo.category ? " on" : "") }, h("i", { style: `background:${catColor(c)}` }), c);
    chip.onclick = () => {
      memo.category = c;
      dirty = true;
      $$(".chip", chips).forEach((x) => x.classList.remove("on"));
      chip.classList.add("on");
    };
    chips.append(chip);
  }

  // 撮影方向
  if (memo.heading != null) {
    f.useHeading.checked = true;
    form.querySelector(".heading-val").textContent = `${Math.round(memo.heading)}°（${dirName(memo.heading)}）`;
  }
  f.useHeading.onchange = async () => {
    if (f.useHeading.checked) {
      const ok = await startOrientation();
      if (!ok) {
        f.useHeading.checked = false;
        toast("方位センサーを使えません");
        return;
      }
      if (S.heading != null) scheduleHeadingDraw();
      else form.querySelector(".heading-val").textContent = "（取得中…）";
    }
  };

  // 写真
  const existingPhotos = isNew ? [] : await DB.byIndex("photos", "memoId", memo.id);
  existingPhotos.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const newPhotos = [];
  const removed = new Set();
  const thumbs = form.querySelector(".photo-thumbs");
  const renderThumbs = () => {
    thumbs.replaceChildren();
    for (const p of existingPhotos.filter((p) => !removed.has(p.id)).concat(newPhotos)) {
      const del = h("button", { type: "button", "aria-label": "写真を削除" }, "✕");
      del.onclick = () => {
        if (!confirm("この写真を削除しますか？")) return;
        if (newPhotos.includes(p)) newPhotos.splice(newPhotos.indexOf(p), 1);
        else removed.add(p.id);
        dirty = true;
        renderThumbs();
      };
      thumbs.append(h("div", { class: "thumb" }, h("img", { src: thumbUrl(p), alt: "" }), del));
    }
  };
  renderThumbs();
  f.photo.onchange = async () => {
    const files = Array.from(f.photo.files || []);
    f.photo.value = "";
    for (const file of files) {
      try {
        const p = await processPhoto(file);
        newPhotos.push({ id: uuid(), memoId: memo.id, ...p });
        dirty = true;
        renderThumbs();
      } catch (e) {
        toast(e.message);
      }
    }
  };

  // ボタン
  const delBtn = form.querySelector('[data-act="delete"]');
  const moveBtn = form.querySelector('[data-act="move"]');
  if (!isNew) {
    delBtn.hidden = false;
    moveBtn.hidden = false;
  }
  delBtn.onclick = async () => {
    if (!confirm(`#${memo.no}「${memo.title || "無題"}」を削除しますか？`)) return;
    await deleteMemo(memo.id);
    closeSheet(true);
    toast("削除しました");
  };
  moveBtn.onclick = () => {
    const c = S.map.getCenter();
    if (!confirm("このメモの位置を、現在の地図中心（十字線の位置）に移動しますか？")) return;
    Object.assign(memo, { lat: c.lat, lon: c.lng, source: "map", accuracy: null, gpsAltitude: null, mesh: meshCode(c.lat, c.lng), elevation: null, address: null });
    dirty = true;
    renderLoc();
    lookup();
  };

  form.onsubmit = async (e) => {
    e.preventDefault();
    memo.title = f.title.value.trim();
    memo.note = f.note.value.trim();
    memo.tags = f.tags.value.split(/[,、，]/).map((s) => s.trim()).filter(Boolean);
    if (f.useHeading.checked && S.heading != null) memo.heading = Math.round(S.heading);
    else if (!f.useHeading.checked) memo.heading = null;
    memo.updatedAt = nowIso();
    memo.photoCount = existingPhotos.filter((p) => !removed.has(p.id)).length + newPhotos.length;
    try {
      await DB.put("memos", memo);
      let order = existingPhotos.length;
      for (const p of newPhotos) await DB.put("photos", { ...p, order: order++ });
      for (const id of removed) await DB.del("photos", id);
    } catch (err) {
      alert("保存に失敗しました：" + err.message);
      return;
    }
    saved = true;
    S.memos.set(memo.id, memo);
    renderMarker(memo);
    updateCounts();
    closeSheet(true);
    toast(isNew ? `#${memo.no} を保存しました` : "更新しました");
  };

  openSheet(isNew ? "新しいメモ" : `メモ #${memo.no}`, form, {
    guard: () => !dirty || saved || confirm("入力内容を破棄しますか？"),
  });
  if (isNew) setTimeout(() => f.title.focus({ preventScroll: true }), 250);
}

async function deleteMemo(id) {
  const photos = await DB.byIndex("photos", "memoId", id);
  for (const p of photos) await DB.del("photos", p.id);
  await DB.del("memos", id);
  S.memos.delete(id);
  const mk = S.markers.get(id);
  if (mk) S.map.removeLayer(mk);
  S.markers.delete(id);
  updateCounts();
}

function addMemoHere() {
  if (!S.pos) {
    toast("現在地がまだ取得できていません。地図中心に作成します");
    return addMemoCenter();
  }
  if (S.pos.acc > 100) toast(`GPS の精度が低めです（±${Math.round(S.pos.acc)} m）`);
  openMemoForm(null, { lat: S.pos.lat, lon: S.pos.lon, source: "gps" });
}
function addMemoCenter() {
  if (!S.crosshair) toggleCrosshair(true);
  const c = S.map.getCenter();
  openMemoForm(null, { lat: c.lat, lon: c.lng, source: "map" });
}

/* ---------- メモ一覧 ---------- */
let listState = { q: "", cat: "", sort: "new" };
let listRefresh = null;
function openList() {
  const q = h("input", { type: "search", placeholder: "キーワードで絞り込み", value: listState.q });
  const cat = h("select", {}, h("option", { value: "" }, "全カテゴリ"), ...Settings.data.categories.map((c) => h("option", { value: c, selected: c === listState.cat }, c)));
  const sort = h("select", {},
    h("option", { value: "new", selected: listState.sort === "new" }, "新しい順"),
    h("option", { value: "no", selected: listState.sort === "no" }, "番号順"),
    h("option", { value: "near", selected: listState.sort === "near" }, "近い順"));
  const list = h("div");
  const render = () => {
    listState = { q: q.value.trim(), cat: cat.value, sort: sort.value };
    let arr = Array.from(S.memos.values());
    if (listState.cat) arr = arr.filter((m) => m.category === listState.cat);
    if (listState.q) {
      const kw = listState.q.toLowerCase();
      arr = arr.filter((m) => [m.title, m.note, m.address, (m.tags || []).join(" "), m.category, "#" + m.no].join(" ").toLowerCase().includes(kw));
    }
    const ref = S.pos;
    if (listState.sort === "near" && ref) arr.sort((a, b) => distance(ref, a) - distance(ref, b));
    else if (listState.sort === "no") arr.sort((a, b) => (a.no || 0) - (b.no || 0));
    else arr.sort((a, b) => (b.createdAt > a.createdAt ? 1 : -1));
    list.replaceChildren();
    if (!arr.length) {
      list.append(h("div", { class: "empty" }, S.memos.size ? "該当するメモがありません" : "まだメモがありません。下の「現在地にメモ」から記録できます。"));
      return;
    }
    for (const m of arr) {
      let dcell = "";
      if (ref) {
        const b = bearing(ref, m);
        dcell = h("div", { class: "d" }, fmtDist(distance(ref, m)), h("br"),
          h("span", { class: "arrow", style: `transform:rotate(${b - (S.heading ?? 0)}deg)` }, "↑"), " ", dirName(b));
      }
      const item = h("div", { class: "memo-item" },
        h("i", { style: `background:${catColor(m.category)}` }),
        h("div", {},
          h("div", { class: "t" }, `#${m.no ?? ""} ${m.title || "（無題）"}`),
          h("div", { class: "s" }, [m.category, fmtDate(m.createdAt), m.photoCount ? `📷${m.photoCount}` : "", (m.tags || []).map((t) => "#" + t).join(" ")].filter(Boolean).join("　")),
          m.note ? h("div", { class: "n" }, m.note) : null),
        dcell);
      item.onclick = () => {
        closeSheet(true);
        setFollow(false);
        S.map.setView([m.lat, m.lon], Math.max(S.map.getZoom(), 17));
        S.markers.get(m.id)?.openPopup();
      };
      list.append(item);
    }
  };
  q.oninput = render;
  cat.onchange = render;
  sort.onchange = render;
  render();
  listRefresh = render;
  openSheet(`メモ一覧（${S.memos.size}件）`, h("div", {}, h("div", { class: "list-tools" }, q), h("div", { class: "list-tools" }, cat, sort), list), {
    onClose: () => (listRefresh = null),
  });
}
let listRefreshTimer;
function refreshListDistancesSoon() {
  if (!listRefresh || listRefreshTimer) return;
  listRefreshTimer = setTimeout(() => {
    listRefreshTimer = null;
    listRefresh && listRefresh();
  }, 5000);
}

/* ====================================================================
 * 十字線
 * ==================================================================== */
function toggleCrosshair(on = !S.crosshair) {
  S.crosshair = on;
  $("#crosshair").hidden = !on;
  $("#btn-crosshair").classList.toggle("active", on);
  if (!on) {
    $("#st-elev").textContent = "";
    $("#st-addr").textContent = "";
    S.posInfo.at = null;
    if (S.pos) {
      updateStatus();
      maybeLookupPosInfo();
    } else $("#st-coord").textContent = "位置情報を待機中…";
  } else updateStatus();
  if (S.map) saveView();
}

/* ====================================================================
 * 軌跡（トラック）
 * ==================================================================== */
async function requestWakeLock() {
  try {
    if ("wakeLock" in navigator) S.wakeLock = await navigator.wakeLock.request("screen");
  } catch {}
}
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && S.track) requestWakeLock();
});

async function toggleTrack() {
  if (S.track) {
    if (!confirm("軌跡の記録を終了しますか？")) return;
    const t = S.track;
    t.endedAt = nowIso();
    await DB.put("tracks", t);
    S.track = null;
    try { S.wakeLock && (await S.wakeLock.release()); } catch {}
    S.wakeLock = null;
    $("#btn-track").classList.remove("recording");
    toast(`記録終了：${fmtDist(t.distance)}・${t.points.length}点`);
    S.shownTracks.set(t.id, S.trackLine);
    S.trackLine = null;
    return;
  }
  const t = { id: uuid(), name: `軌跡 ${fmtDate(nowIso())}`, startedAt: nowIso(), endedAt: null, points: [], distance: 0, project: Settings.data.project || null };
  S.track = t;
  S.trackLine = L.polyline([], { color: "#d0021b", weight: 4, opacity: 0.85 }).addTo(S.map);
  $("#btn-track").classList.add("recording");
  await requestWakeLock();
  await DB.put("tracks", t);
  toast("軌跡の記録を開始しました。画面を開いたままにしてください");
  if (S.pos) addTrackPoint(S.pos);
}
let trackSaveCount = 0;
function addTrackPoint(p) {
  const t = S.track;
  if (!t || p.acc > 60) return;
  const last = t.points[t.points.length - 1];
  if (last) {
    const d = distance({ lat: last[0], lon: last[1] }, p);
    if (d < Math.max(4, p.acc / 2) && p.t - last[2] < 30000) return;
    t.distance += d;
  }
  t.points.push([+p.lat.toFixed(7), +p.lon.toFixed(7), p.t, Math.round(p.acc), p.alt != null ? Math.round(p.alt * 10) / 10 : null]);
  S.trackLine.addLatLng([p.lat, p.lon]);
  if (++trackSaveCount % 5 === 0) DB.put("tracks", t).catch(() => {});
}
async function resumeTrackIfAny() {
  // 記録中にページが閉じられた軌跡は「終了扱い」にして残す
  const tracks = await DB.all("tracks");
  for (const t of tracks) if (!t.endedAt) {
    t.endedAt = t.points.length ? new Date(t.points[t.points.length - 1][2]).toISOString() : t.startedAt;
    await DB.put("tracks", t);
  }
}

/* ====================================================================
 * 計測
 * ==================================================================== */
function toggleMeasure() {
  if (S.measure) return endMeasure();
  S.measure = { pts: [], line: L.polyline([], { color: "#ff6d00", weight: 3, dashArray: "6 6" }).addTo(S.map), poly: null, marks: [] };
  $("#btn-measure").classList.add("active");
  $("#measure-bar").hidden = false;
  $("#btn-add-center span").textContent = "中心を計測点に";
  if (!S.crosshair) toast("地図をタップして点を追加。十字線を出すと中心で追加も可");
  updateMeasure();
}
function addMeasurePoint(ll) {
  const m = S.measure;
  m.pts.push({ lat: ll.lat, lon: ll.lng });
  m.marks.push(L.circleMarker(ll, { radius: 5, color: "#ff6d00", fillColor: "#fff", fillOpacity: 1, weight: 2 }).addTo(S.map));
  updateMeasure();
}
function updateMeasure() {
  const m = S.measure;
  m.line.setLatLngs(m.pts.map((p) => [p.lat, p.lon]));
  let d = 0;
  for (let i = 1; i < m.pts.length; i++) d += distance(m.pts[i - 1], m.pts[i]);
  if (m.poly) { S.map.removeLayer(m.poly); m.poly = null; }
  let txt = m.pts.length ? `距離 ${fmtDist(d)}` : "地図をタップして点を追加";
  if (m.pts.length >= 3) {
    m.poly = L.polygon(m.pts.map((p) => [p.lat, p.lon]), { color: "#ff6d00", weight: 0, fillOpacity: 0.15, interactive: false }).addTo(S.map);
    txt += `　面積 ${fmtArea(polygonArea(m.pts))}`;
  }
  if (m.pts.length >= 2) {
    const a = m.pts[m.pts.length - 2], b = m.pts[m.pts.length - 1];
    txt += `　最終区間 ${fmtDist(distance(a, b))} ${Math.round(bearing(a, b))}°`;
  }
  $("#measure-text").textContent = txt;
}
function endMeasure() {
  const m = S.measure;
  if (!m) return;
  S.map.removeLayer(m.line);
  if (m.poly) S.map.removeLayer(m.poly);
  m.marks.forEach((x) => S.map.removeLayer(x));
  S.measure = null;
  $("#btn-measure").classList.remove("active");
  $("#measure-bar").hidden = true;
  $("#btn-add-center span").textContent = "中心にメモ";
}

/* ====================================================================
 * 検索
 * ==================================================================== */
function openSearch() {
  const input = h("input", { type: "search", placeholder: "地名・住所・施設名、または 緯度,経度", enterkeyhint: "search" });
  const results = h("div");
  const form = h("form", {}, input, h("button", { class: "btn primary block", type: "submit" }, "検索"));
  let pin = null;
  const go = (lat, lon, title) => {
    closeSheet(true);
    setFollow(false);
    S.map.setView([lat, lon], Math.max(S.map.getZoom(), 16));
    if (pin) S.map.removeLayer(pin);
    pin = L.circleMarker([lat, lon], { radius: 9, color: "#d0021b", weight: 3, fillOpacity: 0.2 }).addTo(S.map)
      .bindPopup(`${esc(title)}<div class="pa"><button data-sact="memo">ここにメモ</button></div>`).openPopup();
    pin.on("popupclose", () => setTimeout(() => pin && S.map.removeLayer(pin), 0));
    pin.getPopup().getElement()?.querySelector('[data-sact="memo"]')?.addEventListener("click", () => {
      S.map.closePopup();
      openMemoForm(null, { lat, lon, source: "map" });
    });
  };
  form.onsubmit = async (e) => {
    e.preventDefault();
    const q = input.value.trim();
    if (!q) return;
    const mm = q.match(/^\s*(-?\d+(?:\.\d+)?)\s*[, 、\s]\s*(-?\d+(?:\.\d+)?)\s*$/);
    if (mm) {
      let a = Number(mm[1]), b = Number(mm[2]);
      if (Math.abs(a) > 90) [a, b] = [b, a]; // 経度,緯度 の順でも受け付ける
      return go(a, b, fmtLatLon(a, b));
    }
    results.replaceChildren(h("div", { class: "empty" }, "検索中…"));
    try {
      const r = await searchPlace(q);
      results.replaceChildren();
      if (!r.length) results.append(h("div", { class: "empty" }, "見つかりませんでした"));
      const c = S.pos || { lat: S.map.getCenter().lat, lon: S.map.getCenter().lng };
      r.sort((a, b) => distance(c, a) - distance(c, b));
      for (const x of r) {
        const el = h("div", { class: "result" }, x.title, h("br"), h("small", {}, `${fmtDist(distance(c, x))}　${fmtLatLon(x.lat, x.lon, 5)}`));
        el.onclick = () => go(x.lat, x.lon, x.title);
        results.append(el);
      }
    } catch {
      results.replaceChildren(h("div", { class: "empty" }, "検索できませんでした（オフライン？）"));
    }
  };
  openSheet("地名検索", h("div", {}, form, results, h("p", { class: "note" }, "国土地理院の地名検索 API を利用。結果は現在地（または地図中心）から近い順。")));
  setTimeout(() => input.focus(), 200);
}

/* ====================================================================
 * 書き出し・読み込み
 * ==================================================================== */
function blobToDataURL(b) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = () => rej(r.error);
    r.readAsDataURL(b);
  });
}
const memoOut = (m) => {
  const { photoCount, ...rest } = m;
  return rest;
};

async function buildJSON(includePhotos) {
  const memos = Array.from(S.memos.values()).sort((a, b) => (a.no || 0) - (b.no || 0));
  const out = [];
  for (const m of memos) {
    const ph = (await DB.byIndex("photos", "memoId", m.id)).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    const photos = [];
    for (const [i, p] of ph.entries()) {
      const o = { id: p.id, filename: `memo${String(m.no).padStart(3, "0")}_${i + 1}.jpg`, mime: "image/jpeg", width: p.width, height: p.height, takenAt: p.takenAt };
      if (includePhotos) o.dataUrl = await blobToDataURL(p.blob);
      photos.push(o);
    }
    out.push({ ...memoOut(m), photos });
  }
  const tracks = (await DB.all("tracks")).map((t) => ({ ...t, pointFields: ["lat", "lon", "time_ms", "accuracy_m", "altitude_m"] }));
  return {
    format: "fieldnote", version: 1, exportedAt: nowIso(),
    project: { name: Settings.data.project || null, observer: Settings.data.observer || null, categories: Settings.data.categories },
    crs: "EPSG:4326 (WGS84 / JGD2011 相当)",
    memos: out, tracks,
  };
}
function buildGeoJSON(tracks) {
  const features = Array.from(S.memos.values()).sort((a, b) => (a.no || 0) - (b.no || 0)).map((m) => {
    const { lat, lon, ...props } = memoOut(m);
    return { type: "Feature", geometry: { type: "Point", coordinates: [lon, lat] }, properties: { ...props, tags: (m.tags || []).join(","), photoCount: m.photoCount || 0 } };
  });
  for (const t of tracks) {
    if (t.points.length < 2) continue;
    features.push({
      type: "Feature",
      geometry: { type: "LineString", coordinates: t.points.map((p) => (p[4] != null ? [p[1], p[0], p[4]] : [p[1], p[0]])) },
      properties: { kind: "track", id: t.id, name: t.name, startedAt: t.startedAt, endedAt: t.endedAt, distance_m: Math.round(t.distance) },
    });
  }
  return { type: "FeatureCollection", name: Settings.data.project || "fieldnote", features };
}
function buildCSV() {
  const cols = ["no", "title", "category", "note", "tags", "lat", "lon", "accuracy", "elevation", "address", "mesh", "heading", "source", "photoCount", "createdAt", "updatedAt", "id"];
  const q = (v) => {
    v = Array.isArray(v) ? v.join(";") : v ?? "";
    v = String(v);
    return /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
  };
  const rows = Array.from(S.memos.values()).sort((a, b) => (a.no || 0) - (b.no || 0)).map((m) => cols.map((c) => q(m[c])).join(","));
  return "﻿" + [cols.join(","), ...rows].join("\r\n"); // BOM 付き（Excel で文字化けしないように）
}
function buildGPX(tracks) {
  const x = (s) => esc(s);
  const wpts = Array.from(S.memos.values()).map((m) =>
    `<wpt lat="${m.lat}" lon="${m.lon}">${m.elevation != null ? `<ele>${m.elevation}</ele>` : ""}<time>${m.createdAt}</time><name>${x(`#${m.no} ${m.title || ""}`)}</name><desc>${x(m.note || "")}</desc><type>${x(m.category || "")}</type></wpt>`);
  const trks = tracks.filter((t) => t.points.length).map((t) =>
    `<trk><name>${x(t.name)}</name><trkseg>${t.points.map((p) => `<trkpt lat="${p[0]}" lon="${p[1]}">${p[4] != null ? `<ele>${p[4]}</ele>` : ""}<time>${new Date(p[2]).toISOString()}</time></trkpt>`).join("")}</trkseg></trk>`);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="FieldNote" xmlns="http://www.topografix.com/GPX/1/1">\n${wpts.join("\n")}\n${trks.join("\n")}\n</gpx>\n`;
}

function safeName(s) {
  return (s || "").replace(/[\\/:*?"<>|\s]+/g, "_").slice(0, 40);
}
async function deliverFile(text, ext, mime, mode) {
  const name = `fieldnote_${safeName(Settings.data.project) ? safeName(Settings.data.project) + "_" : ""}${stamp()}.${ext}`;
  const blob = new Blob([text], { type: mime });
  if (mode === "share") {
    // 一部ブラウザは JSON 等の共有を拒否するので text/plain でも試す（拡張子は保つ）
    const file = [mime, "text/plain"].map((t) => new File([blob], name, { type: t })).find((f) => navigator.canShare && navigator.canShare({ files: [f] }));
    if (file) {
      try {
        await navigator.share({ files: [file], title: name });
        return true;
      } catch (e) {
        if (e.name === "AbortError") return false;
        if (e.name === "NotAllowedError") {
          // 準備に時間がかかりタップ操作の有効期限が切れた場合：もう一度タップしてもらう
          return new Promise((res) => {
            const btn = h("button", { class: "btn primary block", type: "button" }, `「${name}」を共有`);
            btn.onclick = () => navigator.share({ files: [file], title: name }).then(() => { closeSheet(true); res(true); }, (er) => { if (er.name === "AbortError") return; toast("共有できませんでした"); });
            openSheet("共有の準備ができました", h("div", {}, btn), { onClose: () => res(false) });
          });
        }
      }
    } else toast("この端末はファイル共有に対応していません。ダウンロードします");
  }
  const url = URL.createObjectURL(blob);
  const a = h("a", { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
  return true;
}

async function doExport(kind, mode, includePhotos) {
  try {
    const tracks = await DB.all("tracks");
    let ok;
    if (kind === "json") ok = await deliverFile(JSON.stringify(await buildJSON(includePhotos), null, 1), "json", "application/json", mode);
    else if (kind === "geojson") ok = await deliverFile(JSON.stringify(buildGeoJSON(tracks)), "geojson", "application/geo+json", mode);
    else if (kind === "csv") ok = await deliverFile(buildCSV(), "csv", "text/csv", mode);
    else if (kind === "gpx") ok = await deliverFile(buildGPX(tracks), "gpx", "application/gpx+xml", mode);
    if (ok && kind === "json") {
      Settings.data.lastExportAt = nowIso();
      Settings.save();
      updateCounts();
    }
  } catch (e) {
    alert("書き出しに失敗しました：" + e.message);
  }
}

async function importJSON(file) {
  let data;
  try {
    data = JSON.parse(await file.text());
  } catch {
    return alert("JSON として読み込めませんでした");
  }
  let memos = data.memos;
  // GeoJSON（このアプリが書き出したもの）も受け付ける
  if (!memos && data.type === "FeatureCollection") {
    memos = data.features.filter((f) => f.geometry?.type === "Point").map((f) => ({
      ...f.properties, lat: f.geometry.coordinates[1], lon: f.geometry.coordinates[0],
      tags: typeof f.properties.tags === "string" ? f.properties.tags.split(",").filter(Boolean) : f.properties.tags || [],
    }));
  }
  if (!Array.isArray(memos)) return alert("フィールドノートのデータではないようです");
  let added = 0, updated = 0, skipped = 0, photos = 0;
  let no = nextNo();
  for (const raw of memos) {
    if (typeof raw.lat !== "number" || typeof raw.lon !== "number") { skipped++; continue; }
    const { photos: ph, ...m } = raw;
    m.id = m.id || uuid();
    m.createdAt = m.createdAt || nowIso();
    m.updatedAt = m.updatedAt || m.createdAt;
    const cur = S.memos.get(m.id);
    if (cur && (cur.updatedAt || "") >= m.updatedAt) { skipped++; continue; }
    if (!cur && [...S.memos.values()].some((x) => x.no === m.no)) m.no = no++;
    if (m.no == null) m.no = no++;
    let cnt = cur ? cur.photoCount || 0 : 0;
    if (Array.isArray(ph)) {
      for (const [i, p] of ph.entries()) {
        if (!p.dataUrl) continue;
        try {
          const blob = await (await fetch(p.dataUrl)).blob();
          const pr = await processPhoto(new File([blob], p.filename || "photo.jpg", { type: blob.type }));
          await DB.put("photos", { id: p.id || uuid(), memoId: m.id, order: i, ...pr, blob, takenAt: p.takenAt || pr.takenAt });
          photos++;
        } catch {}
      }
      cnt = (await DB.byIndex("photos", "memoId", m.id)).length;
    }
    m.photoCount = cnt;
    await DB.put("memos", m);
    cur ? updated++ : added++;
  }
  let tAdded = 0;
  if (Array.isArray(data.tracks)) {
    for (const t of data.tracks) {
      if (!t.id || !Array.isArray(t.points)) continue;
      if (await DB.get("tracks", t.id)) continue;
      const { pointFields, ...rest } = t;
      await DB.put("tracks", rest);
      tAdded++;
    }
  }
  if (data.project && !Settings.data.project && data.project.name) {
    Settings.data.project = data.project.name;
    Settings.save();
  }
  await loadMemos();
  alert(`読み込み完了\n追加 ${added} 件 / 更新 ${updated} 件 / スキップ ${skipped} 件\n写真 ${photos} 枚 / 軌跡 ${tAdded} 本`);
}

/* ====================================================================
 * オフライン用：表示範囲のタイルを保存
 * ==================================================================== */
function tilesInView(def, zFrom, zTo) {
  const b = S.map.getBounds();
  const list = [];
  for (let z = zFrom; z <= zTo; z++) {
    const n = 2 ** z;
    const tx = (lon) => Math.floor(((lon + 180) / 360) * n);
    const ty = (lat) => Math.floor(((1 - Math.asinh(Math.tan(rad(lat))) / Math.PI) / 2) * n);
    for (let x = tx(b.getWest()); x <= tx(b.getEast()); x++)
      for (let y = ty(b.getNorth()); y <= ty(b.getSouth()); y++) list.push(def.url.replace("{z}", z).replace("{x}", x).replace("{y}", y));
  }
  return list;
}
async function prefetchTiles(statusEl) {
  if (!("caches" in window)) return alert("この端末ではオフライン保存に対応していません");
  const defs = [BASE_LAYERS.find((b) => b.id === S.baseId), ...Object.keys(S.overlays).map((id) => OVERLAYS.find((o) => o.id === id))].filter(Boolean);
  if (defs.some((d) => d.noPrefetch)) return alert("OpenStreetMap は利用規約により一括保存できません。地理院の地図に切り替えてください");
  const z0 = Math.floor(S.map.getZoom());
  let urls = [];
  for (const d of defs) {
    const from = Math.max(z0, d.min || 0), to = Math.min(d.max, z0 + 2);
    if (from <= to) urls = urls.concat(tilesInView(d, from, to));
  }
  if (!urls.length) return alert("保存対象のタイルがありません");
  if (urls.length > PREFETCH_LIMIT) return alert(`タイル数が多すぎます（${urls.length}枚）。もう少しズームインしてください（上限 ${PREFETCH_LIMIT}枚）`);
  if (!confirm(`表示範囲のタイル ${urls.length} 枚（ズーム${z0}〜${z0 + 2}、表示中の地図）を端末に保存します。通信量にご注意ください。`)) return;
  const cache = await caches.open("fn-tiles-saved");
  let done = 0, fail = 0;
  const worker = async () => {
    while (urls.length) {
      const u = urls.shift();
      try {
        if (!(await cache.match(u))) {
          const r = await fetch(u, { mode: "cors" });
          if (r.ok) await cache.put(u, r);
          else if (r.status !== 404) fail++;
        }
      } catch { fail++; }
      done++;
      statusEl.textContent = `保存中… ${done} 枚`;
    }
  };
  await Promise.all(Array.from({ length: 4 }, worker));
  statusEl.textContent = `保存しました（${done} 枚${fail ? `、失敗 ${fail}` : ""}）`;
}

/* ====================================================================
 * メニュー（保存・設定）
 * ==================================================================== */
async function openMenu() {
  const tracks = (await DB.all("tracks")).sort((a, b) => (b.startedAt > a.startedAt ? 1 : -1));
  let photoCount = 0;
  for (const m of S.memos.values()) photoCount += m.photoCount || 0;
  let usage = "";
  try {
    const est = await navigator.storage.estimate();
    usage = `${(est.usage / 1048576).toFixed(1)} MB 使用`;
  } catch {}
  const canShare = !!(navigator.canShare && navigator.canShare({ files: [new File(["x"], "x.txt", { type: "text/plain" })] }));

  const inclPhotos = h("input", { type: "checkbox", checked: true });
  const exportRow = (label, kind) => h("div", { class: "menu-grid" },
    h("button", { class: "btn secondary", type: "button", onclick: () => doExport(kind, "download", inclPhotos.checked) }, `${label} を保存`),
    canShare ? h("button", { class: "btn secondary", type: "button", onclick: () => doExport(kind, "share", inclPhotos.checked) }, `${label} を共有…`) : h("span"));

  const fileIn = h("input", { type: "file", accept: ".json,.geojson,application/json", hidden: true });
  fileIn.onchange = async () => {
    const f = fileIn.files[0];
    fileIn.value = "";
    if (f) {
      await importJSON(f);
      closeSheet(true);
    }
  };

  const proj = h("input", { type: "text", value: Settings.data.project, placeholder: "例：犬山城下町 2026秋" });
  const obs = h("input", { type: "text", value: Settings.data.observer, placeholder: "例：山田" });
  const cats = h("input", { type: "text", value: Settings.data.categories.join(", ") });
  const saveSettings = () => {
    Settings.data.project = proj.value.trim();
    Settings.data.observer = obs.value.trim();
    const c = cats.value.split(/[,、，]/).map((s) => s.trim()).filter(Boolean);
    Settings.data.categories = c.length ? [...new Set(c)] : DEFAULT_CATEGORIES.slice();
    Settings.save();
    for (const m of S.memos.values()) renderMarker(m);
    toast("設定を保存しました");
  };

  const prefStatus = h("div", { class: "note" });
  const trackList = h("div");
  const renderTracks = () => {
    trackList.replaceChildren();
    if (!tracks.length) trackList.append(h("div", { class: "note" }, "記録した軌跡はありません。右の 〰 ボタンで記録を開始できます。"));
    for (const t of tracks) {
      const shown = S.shownTracks.has(t.id) || (S.track && S.track.id === t.id);
      const showBtn = h("button", { class: "chip" + (shown ? " on" : ""), type: "button" }, shown ? "表示中" : "表示");
      showBtn.onclick = () => {
        if (S.track && S.track.id === t.id) return;
        if (S.shownTracks.has(t.id)) {
          S.map.removeLayer(S.shownTracks.get(t.id));
          S.shownTracks.delete(t.id);
        } else {
          const line = L.polyline(t.points.map((p) => [p[0], p[1]]), { color: "#7b1fa2", weight: 4, opacity: 0.8 }).addTo(S.map);
          S.shownTracks.set(t.id, line);
          if (t.points.length) S.map.fitBounds(line.getBounds(), { padding: [40, 40] });
        }
        renderTracks();
      };
      const delBtn = h("button", { class: "chip", type: "button" }, "削除");
      delBtn.onclick = async () => {
        if (S.track && S.track.id === t.id) return toast("記録中の軌跡は削除できません");
        if (!confirm(`「${t.name}」を削除しますか？`)) return;
        await DB.del("tracks", t.id);
        if (S.shownTracks.has(t.id)) S.map.removeLayer(S.shownTracks.get(t.id));
        S.shownTracks.delete(t.id);
        tracks.splice(tracks.indexOf(t), 1);
        renderTracks();
      };
      trackList.append(h("div", { class: "memo-item", style: "grid-template-columns:1fr auto auto;cursor:default" },
        h("div", {}, h("div", { class: "t" }, t.name + (t.endedAt ? "" : "（記録中）")), h("div", { class: "s" }, `${fmtDist(t.distance)}・${t.points.length}点`)),
        showBtn, delBtn));
    }
  };
  renderTracks();

  const last = Settings.data.lastExportAt;
  const body = h("div", {},
    h("dl", { class: "kv" },
      h("dt", {}, "メモ"), h("dd", {}, `${S.memos.size} 件（写真 ${photoCount} 枚）`),
      h("dt", {}, "軌跡"), h("dd", {}, `${tracks.length} 本`),
      h("dt", {}, "最終書き出し"), h("dd", {}, last ? fmtDate(last) : "なし"),
      h("dt", {}, "端末内の容量"), h("dd", {}, usage || "—")),

    h("div", { class: "sect-title" }, "書き出し（端末のファイルへ）"),
    h("label", { class: "inline", style: "margin:4px 0 8px;font-size:14px" }, inclPhotos, "JSON に写真を含める（ファイルが大きくなります）"),
    exportRow("JSON（全データ）", "json"),
    h("div", { style: "height:6px" }),
    exportRow("GeoJSON", "geojson"),
    h("div", { style: "height:6px" }),
    exportRow("CSV", "csv"),
    h("div", { style: "height:6px" }),
    exportRow("GPX", "gpx"),
    h("p", { class: "note" }, "JSON はこのアプリで再読み込みできる完全なバックアップです。GeoJSON は QGIS 等の GIS、CSV は Excel、GPX は登山・GPS アプリ向け。iPhone では「共有…」→「ファイルに保存」が確実です。端末内のデータはブラウザのデータ消去で失われるため、調査の区切りごとに書き出してください。"),

    h("div", { class: "sect-title" }, "読み込み"),
    h("button", { class: "btn secondary block", type: "button", onclick: () => fileIn.click() }, "JSON / GeoJSON を読み込む（統合）"), fileIn,
    h("p", { class: "note" }, "同じ ID のメモは更新日時が新しい方を採用します。別の端末で記録したデータの統合にも使えます。"),

    h("div", { class: "sect-title" }, "軌跡"),
    trackList,

    h("div", { class: "sect-title" }, "調査の設定"),
    h("label", {}, "調査名（ファイル名とメモに記録）", proj),
    h("label", {}, "記録者", obs),
    h("label", {}, "カテゴリ（カンマ区切り・順に色が決まります）", cats),
    h("button", { class: "btn primary block", type: "button", onclick: saveSettings }, "設定を保存"),

    h("div", { class: "sect-title" }, "オフライン"),
    h("button", { class: "btn secondary block", type: "button", onclick: () => prefetchTiles(prefStatus) }, "表示範囲の地図を端末に保存"),
    prefStatus,
    h("button", { class: "btn secondary block", type: "button", onclick: async () => {
      if (!confirm("保存した地図タイル（自動キャッシュ含む）を削除しますか？メモは消えません。")) return;
      await caches.delete("fn-tiles-saved");
      await caches.delete("fn-tiles-rt");
      toast("地図キャッシュを削除しました");
    } }, "保存した地図を削除"),
    h("p", { class: "note" }, "一度表示した地図は自動で端末に残り、電波が弱い場所でも表示できます。山間部などに行く前に、Wi-Fi 環境で対象範囲を保存しておくと安心です。"),

    h("div", { class: "sect-title" }, "データの消去"),
    h("button", { class: "btn danger block", type: "button", onclick: async () => {
      if (!confirm("全てのメモ・写真・軌跡を端末から削除します。書き出し済みか確認してください。")) return;
      if (!confirm("本当に削除しますか？元に戻せません。")) return;
      await DB.clear("memos"); await DB.clear("photos"); await DB.clear("tracks");
      for (const l of S.shownTracks.values()) S.map.removeLayer(l);
      S.shownTracks.clear();
      await loadMemos();
      closeSheet(true);
      toast("全データを削除しました");
    } }, "全データを削除"),

    h("p", { class: "note", style: "margin-top:16px" },
      "使い方：画面の長押しでその地点にメモ／✚ ボタンで中心十字線を表示し、十字線の位置にメモ。座標は WGS84（世界測地系）の緯度経度。標高は地理院の標高 API（DEM）による値で、GPS高度とは別に記録されます。"),
  );
  openSheet("保存・設定", body);
}

/* ====================================================================
 * 起動
 * ==================================================================== */
function bindUI() {
  $("#sheet-close").onclick = () => closeSheet();
  $("#sheet-backdrop").onclick = () => closeSheet();
  $("#btn-layers").onclick = openLayers;
  $("#btn-search").onclick = openSearch;
  $("#btn-measure").onclick = toggleMeasure;
  $("#measure-close").onclick = endMeasure;
  $("#measure-undo").onclick = () => {
    const m = S.measure;
    if (!m || !m.pts.length) return;
    m.pts.pop();
    S.map.removeLayer(m.marks.pop());
    updateMeasure();
  };
  $("#btn-track").onclick = toggleTrack;
  $("#btn-crosshair").onclick = () => toggleCrosshair();
  $("#btn-locate").onclick = () => {
    startOrientation();
    if (!S.pos) {
      moveToFirstFix = true;
      firstFix = true;
      return toast("現在地を取得中…");
    }
    if (S.follow) return setFollow(false);
    setFollow(true);
    S.map.setView([S.pos.lat, S.pos.lon], Math.max(S.map.getZoom(), 16));
  };
  $("#btn-add-here").onclick = () => {
    startOrientation();
    addMemoHere();
  };
  $("#btn-add-center").onclick = () => {
    if (S.measure) return addMeasurePoint(S.map.getCenter());
    addMemoCenter();
  };
  $("#btn-list").onclick = openList;
  $("#btn-menu").onclick = openMenu;
  $("#status").onclick = () => {
    const c = S.crosshair ? { lat: S.map.getCenter().lat, lon: S.map.getCenter().lng } : S.pos;
    if (!c) return;
    copyText(`${c.lat.toFixed(6)}, ${c.lon.toFixed(6)}`);
  };
  $("#status").title = "タップで座標をコピー";
  window.addEventListener("beforeunload", (e) => {
    if (S.track) {
      DB.put("tracks", S.track);
      e.preventDefault();
      e.returnValue = "";
    }
  });
}

async function main() {
  Settings.load();
  bindUI();
  moveToFirstFix = initMap();
  try {
    await resumeTrackIfAny();
    await loadMemos();
  } catch (e) {
    alert("端末内の保存領域を開けませんでした（プライベートブラウズでは使えない場合があります）：" + e.message);
  }
  startGPS();
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  if ("serviceWorker" in navigator && window.isSecureContext) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
}
main();
