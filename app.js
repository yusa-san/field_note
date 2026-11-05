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
  { id: "gsivt", name: "地理院 Vector", vector: true, url: VT_TILES, max: 16, attr: ATTR_GSI },
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
  { id: "ov_flood", name: "洪水浸水想定（最大）", desc: "想定最大規模の浸水深", url: `${HAZ}/01_flood_l2_shinsuishin_data/{z}/{x}/{y}.png`, max: 17, op: 0.6, attr: ATTR_HAZ, legend: "shinsui_legend3.png" },
  { id: "ov_flood_l1", name: "洪水浸水想定（計画規模）", desc: "計画規模（数十〜百年に一度）の浸水深", url: `${HAZ}/01_flood_l1_shinsuishin_newlegend_data/{z}/{x}/{y}.png`, max: 17, op: 0.6, attr: ATTR_HAZ, legend: "shinsui_legend3.png" },
  { id: "ov_flood_keizoku", name: "浸水継続時間", desc: "想定最大規模で浸水が続く時間", url: `${HAZ}/01_flood_l2_keizoku_data/{z}/{x}/{y}.png`, max: 17, op: 0.6, attr: ATTR_HAZ, legend: "shinsui_legend_l2_keizoku.png" },
  { id: "ov_kaoku_hanran", name: "家屋倒壊等氾濫想定区域（氾濫流）", desc: "氾濫の流れで家屋が倒壊するおそれ", url: `${HAZ}/01_flood_l2_kaokutoukai_hanran_data/{z}/{x}/{y}.png`, min: 4, max: 17, op: 0.6, attr: ATTR_HAZ, legend: "kaokutoukai_hanran.png" },
  { id: "ov_kaoku_kagan", name: "家屋倒壊等氾濫想定区域（河岸侵食）", desc: "河岸が削られて家屋が倒壊するおそれ", url: `${HAZ}/01_flood_l2_kaokutoukai_kagan_data/{z}/{x}/{y}.png`, min: 4, max: 17, op: 0.6, attr: ATTR_HAZ, legend: "kaokutoukai_kagan.png" },
  { id: "ov_naisui", name: "内水浸水想定", desc: "下水道などからあふれる浸水", url: `${HAZ}/02_naisui_data/{z}/{x}/{y}.png`, max: 17, op: 0.6, attr: ATTR_HAZ, legend: "naisui_legend.png" },
  { id: "ov_hightide", name: "高潮浸水想定", desc: "想定最大規模の高潮の浸水深", url: `${HAZ}/03_hightide_l2_shinsuishin_data/{z}/{x}/{y}.png`, max: 17, op: 0.6, attr: ATTR_HAZ, legend: "shinsui_legend3.png" },
  { id: "ov_tsunami", name: "津波浸水想定", desc: "都道府県の津波浸水想定", url: `${HAZ}/04_tsunami_newlegend_data/{z}/{x}/{y}.png`, max: 17, op: 0.6, attr: ATTR_HAZ, legend: "shinsui_legend3.png" },
  { id: "ov_dosekiryu", name: "土石流警戒区域", desc: "土砂災害警戒区域（土石流）", url: `${HAZ}/05_dosekiryukeikaikuiki/{z}/{x}/{y}.png`, max: 17, op: 0.7, attr: ATTR_HAZ, legend: "keikai_dosekiryu.png" },
  { id: "ov_kyukeisha", name: "急傾斜地警戒区域", desc: "土砂災害警戒区域（急傾斜地の崩壊）", url: `${HAZ}/05_kyukeishakeikaikuiki/{z}/{x}/{y}.png`, max: 17, op: 0.7, attr: ATTR_HAZ, legend: "keikai_kyukeisya.png" },
  { id: "ov_jisuberi", name: "地すべり警戒区域", desc: "土砂災害警戒区域（地すべり）", url: `${HAZ}/05_jisuberikeikaikuiki/{z}/{x}/{y}.png`, max: 17, op: 0.7, attr: ATTR_HAZ, legend: "keikai_jisuberi.png" },
  { id: "ov_nadare", name: "雪崩危険箇所", desc: "雪崩のおそれがある箇所", url: `${HAZ}/05_nadarekikenkasyo/{z}/{x}/{y}.png`, max: 17, op: 0.7, attr: ATTR_HAZ },
];

const PALETTE = ["#2e7d32", "#6d4c41", "#5e35b1", "#1565c0", "#00838f", "#c62828", "#ef6c00", "#ad1457", "#558b2f", "#616161"];
const DEFAULT_CATEGORIES = ["景観", "建物・構造物", "地形", "石碑・標識", "聞き取り", "要確認", "写真", "その他"];
const PHOTO_CATEGORY = "写真";
const PHOTO_SIZES = { original: "元のまま（画質・EXIF を保持）", 2560: "長辺 2560px に縮小", 1600: "長辺 1600px に縮小（容量節約）" };
const THUMB_ZOOM = 15; // これ以上のズームで写真付きメモをサムネイル表示
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
      const rq = indexedDB.open("fieldnote", 4);
      rq.onupgradeneeded = () => {
        const db = rq.result;
        const has = (n) => db.objectStoreNames.contains(n);
        if (!has("memos")) db.createObjectStore("memos", { keyPath: "id" });
        if (!has("photos")) db.createObjectStore("photos", { keyPath: "id" }).createIndex("memoId", "memoId");
        if (!has("tracks")) db.createObjectStore("tracks", { keyPath: "id" });
        // v2: PDF から作った地図レイヤ（設定と画像を分けて保存し、透明度変更などで画像を書き直さない）
        if (!has("overlays")) db.createObjectStore("overlays", { keyPath: "id" });
        if (!has("overlayImages")) db.createObjectStore("overlayImages", { keyPath: "id" });
        // v3: 聞き取りの録音
        if (!has("audios")) db.createObjectStore("audios", { keyPath: "id" }).createIndex("memoId", "memoId");
        // v4: 地図に重ねるファイル（設定と中身を分ける）
        if (!has("layers")) db.createObjectStore("layers", { keyPath: "id" });
        if (!has("layerData")) db.createObjectStore("layerData", { keyPath: "id" });
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
  data: { project: "", observer: "", categories: DEFAULT_CATEGORIES.slice(), lastExportAt: null, photoSize: "original", cameraOpenForm: false, corsProxy: "", catColors: {}, voiceMode: "both" },
  load() {
    try {
      Object.assign(this.data, JSON.parse(localStorage.getItem("fn.settings") || "{}"));
    } catch {}
    if (!Array.isArray(this.data.categories) || !this.data.categories.length) this.data.categories = DEFAULT_CATEGORIES.slice();
    // 色はカテゴリごとに固定で持つ（以前は並び順で決めていたので、その色を引き継ぐ）
    if (!this.data.catColors || typeof this.data.catColors !== "object") this.data.catColors = {};
    this.data.categories.forEach((c, i) => { if (!this.data.catColors[c]) this.data.catColors[c] = PALETTE[i % PALETTE.length]; });
  },
  save() {
    try { localStorage.setItem("fn.settings", JSON.stringify(this.data)); } catch {}
  },
};
const catColor = (name) => Settings.data.catColors?.[name] || "#616161";

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
  memoThumb: new Map(), // memoId -> 先頭の写真レコード（地図のサムネイル用）
  thumbMode: false,
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
    localStorage.setItem("fn.view", JSON.stringify({ lat: c.lat, lon: c.lng, z: S.map.getZoom(), bearing: S.map.getBearing ? Math.round(S.map.getBearing() * 10) / 10 : 0, base: S.baseId, overlays: ov, crosshair: S.crosshair }));
  } catch {}
}

let baseToken = 0;
async function setBase(id) {
  const def = BASE_LAYERS.find((b) => b.id === id) || BASE_LAYERS[0];
  const token = ++baseToken;
  S.baseId = def.id;
  saveView();
  let layer;
  if (def.vector) {
    // 地理院地図Vector：ライブラリとスタイルを読み込んでから差し替える（それまでは今の地図を表示）
    toast("地理院 Vector を読み込み中…", 8000);
    try {
      layer = await makeVectorBase();
    } catch (e) {
      if (token !== baseToken) return;
      toast("地理院 Vector を表示できません：" + e.message, 5000);
      return setBase("std");
    }
    if (token !== baseToken) return;
    $("#toast").hidden = true;
  } else {
    layer = makeTile(def, 1, 1);
    VT.layer = null;
  }
  if (S.base) S.map.removeLayer(S.base);
  S.base = layer.addTo(S.map);
  if (def.min && S.map.getZoom() < def.min) toast(`この地図はズーム${def.min}以上で表示されます`);
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
  // 2 本指で回転（leaflet-rotate）。真北に戻すのは方位磁石ボタン
  S.map = L.map("map", { zoomControl: false, attributionControl: true, maxZoom: 20, tapTolerance: 20,
    rotate: true, touchRotate: true, rotateControl: false, bearing: v.bearing || 0, shiftKeyRotate: true })
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
  // 回転：方位磁石ボタン（回したときだけ出す）・撮影方向の矢印を地図に合わせる
  const north = $("#btn-north");
  const onRotate = () => {
    const b = S.map.getBearing ? S.map.getBearing() : 0;
    north.hidden = Math.abs(((b + 180) % 360) - 180) < 0.5;
    north.querySelector("svg").style.transform = `rotate(${b}deg)`;
    for (const i of document.querySelectorAll(".pp .hd")) i.style.transform = `rotate(${Number(i.dataset.h) + b}deg)`;
    if (S.heading != null) drawHeading(S.heading);
  };
  S.map.on("rotate", onRotate);
  S.map.on("rotate", () => { clearTimeout(S._rotSave); S._rotSave = setTimeout(saveView, 600); });
  north.onclick = () => { S.map.setBearing(0); onRotate(); saveView(); };
  onRotate();
  S.thumbMode = S.map.getZoom() >= THUMB_ZOOM;
  S.featScale = featScale();
  S.map.on("zoomend", () => {
    // 写真のサムネイルを出す縮尺の切り替わり・お気に入りの写真の大きさの段階が変わったら描き直す
    const tm = S.map.getZoom() >= THUMB_ZOOM, fs = featScale();
    const tmChanged = tm !== S.thumbMode, fsChanged = fs !== S.featScale;
    S.thumbMode = tm;
    S.featScale = fs;
    if (!tmChanged && !fsChanged) return;
    for (const id of S.memoThumb.keys()) { const m = S.memos.get(id); if (m && (tmChanged || m.featured)) renderMarker(m); }
  });
  S.map.on("click", (e) => (S.measure ? addMeasurePoint(e.latlng) : pdfLayerClick(e.latlng) || dataLayerClick(e.latlng) || extraLayerClick(e.latlng)));
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
  startWatch();
  // 設定画面などで許可に変わったら、すぐ測位を再開
  try {
    navigator.permissions.query({ name: "geolocation" }).then((st) => {
      st.onchange = () => { if (st.state === "granted") { startWatch(); closeGeoHelp(); } };
    }, () => {});
  } catch {}
}
let watchId = null;
const GEO_OPTS = { enableHighAccuracy: true, maximumAge: 2000, timeout: 30000 };
function startWatch() {
  if (watchId != null) navigator.geolocation.clearWatch(watchId);
  watchId = navigator.geolocation.watchPosition(onPosition, onPositionError, GEO_OPTS);
}

/**
 * 現在地ボタンなどから：位置情報が使えなければ、そのたびに許可を求める。
 * ブラウザの仕様で、一度「ブロック」した後はアプリから許可の画面を出せないため、その場合は手順を案内する。
 */
async function requestLocation() {
  if (!("geolocation" in navigator) || !window.isSecureContext) return startGPS();
  let state = null;
  try { state = (await navigator.permissions.query({ name: "geolocation" })).state; } catch {}
  if (state === "denied") return showGeoHelp();
  toast("現在地を取得中…（許可を求められたら「許可」を選んでください）", 4000);
  const t0 = Date.now();
  navigator.geolocation.getCurrentPosition((p) => {
    closeGeoHelp();
    moveToFirstFix = false;
    onPosition(p);
    startWatch();
    S.map.setView([S.pos.lat, S.pos.lon], Math.max(S.map.getZoom(), 16));
  }, (err) => {
    if (err.code === 1) {
      setStatusError("位置情報の利用が許可されていません（現在地ボタンで再度許可できます）");
      // 画面が出ずにすぐ拒否された＝ブロック中（または何度も閉じたため一時的に止められている）
      if (Date.now() - t0 < 1500 || state === "denied") showGeoHelp();
      else toast("位置情報の利用が許可されませんでした。もう一度現在地ボタンを押すと、再度確認します", 4000);
    } else onPositionError(err);
  }, { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 });
}

let geoHelpOpen = false;
function closeGeoHelp() {
  if (geoHelpOpen) closeSheet(true);
}
function showGeoHelp() {
  $("#toast").hidden = true;
  const ua = navigator.userAgent;
  const ios = /iPhone|iPad|iPod/i.test(ua), android = /Android/i.test(ua);
  const standalone = window.matchMedia?.("(display-mode: standalone)").matches || navigator.standalone;
  const steps = ios
    ? [h("li", {}, "iPhone の「設定」→「プライバシーとセキュリティ」→「位置情報サービス」をオンにし、一覧の「Safari の Web サイト」を「使用中のみ」に"),
      h("li", {}, standalone ? "それでも使えないときは、Safari でこのページを開き、アドレスバーの「ぁあ」→「Web サイトの設定」→「位置情報」を「許可」に（ホーム画面のアプリにも反映されます）" : "Safari のアドレスバーの「ぁあ」→「Web サイトの設定」→「位置情報」を「許可」に")]
    : android
      ? [h("li", {}, standalone
          ? "ホーム画面のアプリのアイコンを長押し →「アプリ情報」（i のマーク）→「権限」→「位置情報」→「アプリの使用中のみ許可」"
          : "アドレスバー左のアイコン（調整マーク）→「権限」→「位置情報」をオン"),
        h("li", {}, "上で見つからないときは、Chrome を開いて「︙」→「設定」→「サイトの設定」→「位置情報」→「ブロック中」の一覧からこのサイトを選び「許可」に"),
        h("li", {}, "スマホ本体の位置情報（クイック設定の「位置情報」）がオフになっていないかも確認")]
      : [h("li", {}, "アドレスバー左のアイコン →「サイトの設定」→「位置情報」を「許可」に")];
  const retry = h("button", { class: "btn primary block", type: "button", onclick: () => { closeGeoHelp(); requestLocation(); } }, "許可したので、もう一度試す");
  const body = h("div", {},
    h("p", { class: "note", style: "margin-top:0" }, "このアプリは位置情報の利用が「ブロック」になっています。ブラウザの仕組み上、一度ブロックすると、アプリから許可の確認画面を出し直すことができません。次の手順で許可してから「もう一度試す」を押してください。"),
    h("ol", { class: "geo-steps" }, ...steps),
    retry,
    h("p", { class: "note" }, "許可すると、この画面は自動で閉じ、現在地の表示が始まります。"));
  openSheet("位置情報の利用を許可してください", body, { onClose: () => (geoHelpOpen = false) });
  geoHelpOpen = true;
}

let firstFix = true, moveToFirstFix = false;
function onPosition(p) {
  const c = p.coords;
  const raw = { lat: c.latitude, lon: c.longitude, acc: c.accuracy, alt: c.altitude, altAcc: c.altitudeAccuracy, heading: c.heading, speed: c.speed, t: p.timestamp };
  // 任意の補正（ずれの修正・精度の悪い測位を除く）
  const fixed = gpsCorrect(raw);
  if (!fixed) { $("#gps-dot").className = "dot weak"; return; }
  S.posRaw = raw;
  S.pos = fixed;
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
  const msg = { 1: "位置情報の利用が許可されていません（現在地ボタンで許可できます）", 2: "現在地を取得できません", 3: "現在地の取得がタイムアウトしました" }[err.code] || err.message;
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
  $("#st-coord").textContent = "中心 " + fmtLatLon(c.lat, c.lng, 6);
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
    S.heading = (hd + screenAngle() + compassOffset() + 720) % 360;
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
  cone.style.transform = `rotate(${hd + (S.map.getBearing ? S.map.getBearing() : 0)}deg)`; // 地図を回したぶんも足す
}

/* ====================================================================
 * 地理院 API（標高・逆ジオコーディング・地名検索）
 * ==================================================================== */
const elevCache = new Map();
async function fetchElevation(lat, lon) {
  const key = `${lat.toFixed(5)},${lon.toFixed(5)}`;
  if (elevCache.has(key)) return elevCache.get(key);
  // まず標高タイル（1m 標高があればその値。オフラインでも一度読んだ範囲は使える）
  try {
    const t = await demElevationAt(lat, lon);
    if (t) { elevCache.set(key, t); return t; }
  } catch {}
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
/** 重ねる地図の凡例（ハザードマップポータルサイトの凡例画像） */
function showLegendImage(def) {
  const url = /^https?:/.test(def.legend) ? def.legend : `https://disaportal.gsi.go.jp/hazardmapportal/hazardmap/copyright/img/${def.legend}`;
  openSheet(`凡例：${def.name}`, h("div", {}, h("button", { type: "button", class: "chip vt-back", onclick: () => openLayers() }, "← 地図の切替に戻る"),
    h("img", { src: url, alt: `${def.name}の凡例`, style: "max-width:100%;background:#fff;border-radius:8px;padding:6px" }),
    h("p", { class: "note" }, "出典：ハザードマップポータルサイト")), { backdrop: false, height: "60vh" });
}
function openLayers() {
  const grid = h("div", { class: "layer-grid" });
  const cards = [];
  const select = (def, card) => {
    setBase(def.id);
    cards.forEach((c) => c.classList.remove("on"));
    card.classList.add("on");
  };
  // 地理院 Vector：カードの横に「表示する項目」「スタイル」（子画面）を置く
  const vtDef = BASE_LAYERS.find((b) => b.vector);
  const vtCard = h("button", { class: "layer-card" + (S.baseId === vtDef.id ? " on" : ""), type: "button" },
    vtSwatch(Settings.data.vtStyle || "std"), h("span", {}, vtDef.name, h("small", {}, vtStyleName(Settings.data.vtStyle))));
  vtCard.onclick = () => select(vtDef, vtCard);
  cards.push(vtCard);
  const openVt = (fn) => () => { if (S.baseId !== vtDef.id) select(vtDef, vtCard); fn(); };
  const vtRow = h("div", { class: "vt-row-top" }, vtCard,
    h("div", { class: "vt-tools" },
      h("button", { type: "button", class: "btn secondary", onclick: openVt(openVectorLayersSheet) }, "表示する項目"),
      h("button", { type: "button", class: "btn secondary", onclick: openVt(openVectorStyleSheet) }, "スタイル"),
      h("div", { class: "note" }, "線や文字がくっきりした地図。配色と表示する項目を選べます")));
  for (const def of BASE_LAYERS.filter((b) => !b.vector)) {
    const card = h("button", { class: "layer-card" + (def.id === S.baseId ? " on" : ""), type: "button" },
      h("img", { src: tileThumbUrl(def), alt: "", loading: "lazy", crossorigin: "anonymous" }), h("span", {}, def.name));
    card.onclick = () => select(def, card);
    cards.push(card);
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
    const lg = def.legend ? h("button", { type: "button", class: "chip lg-btn", onclick: () => showLegendImage(def) }, "凡例") : null;
    ovs.append(h("div", { class: "ov-row" }, cb, h("div", {}, def.name, h("small", {}, def.desc + (def.min ? `（ズーム${def.min}〜）` : "")), lg), rg));
  }
  const body = h("div", {},
    h("div", { class: "menu-grid", style: "margin:4px 0 2px" },
      h("button", { type: "button", class: "btn secondary", onclick: openCompareSheet }, CMP.on ? "比較を変える" : "2 つの地図を比べる"),
      h("button", { type: "button", class: "btn secondary", onclick: () => openExtraLayers() }, "その他のレイヤ")),
    h("div", { class: "sect-title" }, "ベース地図：地理院 Vector"), vtRow,
    h("div", { class: "sect-title" }, "ベース地図：画像タイル"), grid,
    h("div", { class: "sect-title" }, "重ねる地図（透過度）"), ovs,
    h("div", { class: "sect-title" }, "標高（1m 標高タイル）"), demPanelRow(),
    h("div", { class: "sect-title" }, "データを重ねる（緑・不動産情報ライブラリ・e-Stat）"), dataPanelRow(),
    h("div", { class: "sect-title" }, "PDF・画像から追加した地図"), pdfLayersSection(),
    h("button", { type: "button", class: "btn secondary block", style: "margin-top:14px", onclick: openPrint }, "この地図を印刷・PDF・画像に出力"),
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
  S.memoThumb.clear();
  for (const ph of await DB.all("photos")) {
    const cur = S.memoThumb.get(ph.memoId);
    if (!cur || (ph.order ?? 0) < (cur.order ?? 0)) S.memoThumb.set(ph.memoId, ph);
  }
  for (const mk of S.markers.values()) S.map.removeLayer(mk);
  S.markers.clear();
  // ピンをまとめるときは、先に全部を地図に置かない（置いてから外すと、数百件で重くなる）
  CL.batch = true;
  CL.on = clActive();
  CL.visible = new Set();
  for (const m of S.memos.values()) renderMarker(m);
  CL.batch = false;
  clUpdate();
  updateCounts();
}
async function refreshMemoThumb(id) {
  const ph = (await DB.byIndex("photos", "memoId", id)).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  if (ph.length) S.memoThumb.set(id, ph[0]);
  else S.memoThumb.delete(id);
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

/** 「地図に写真を表示」：none 表示しない／fav お気に入り／all 全て表示 */
function photoPinsMode() {
  const v = Settings.data.photoPins;
  if (v === "none" || v === "fav" || v === "all") return v;
  return Settings.data.photoPinsFavOnly ? "fav" : "all"; // 前の設定（お気に入りだけ）から
}
/** お気に入りの写真の大きさの倍率：ズーム 16 以上でそのまま、15 で 3/4、14 で半分、13 以下は 0（ふつうのピンにしてまとめる） */
const featScale = (z = S.map ? S.map.getZoom() : 16) => (z >= 16 ? 1 : z >= 15 ? 0.75 : z >= 14 ? 0.5 : 0);
/** お気に入りの写真のアイコンの大きさ（大きく出さないときは null）。地図のピンとまとめる処理で共通 */
function featIconSize(m, ph = S.memoThumb.get(m.id)) {
  if (!ph || !m.featured || photoPinsMode() === "none") return null;
  const sc = featScale();
  if (!sc) return null;
  const k = Math.min(4, Math.max(2, Number(m.featured) || 3));
  const ar = Math.min(2, Math.max(0.5, (ph.width || 4) / (ph.height || 3)));
  const base = Math.max(44, 48 * k * sc);
  return { k, w: Math.round(base * (ar >= 1 ? 1 : ar)), h: Math.round(base * (ar >= 1 ? 1 / ar : 1)) };
}
function renderMarker(m) {
  const old = S.markers.get(m.id);
  if (old) S.map.removeLayer(old);
  const color = memoColor(m);
  const ph = S.memoThumb.get(m.id);
  // 大きく表示する写真（パース・キービジュアル）：ふつうの写真の 2〜4 倍。引くと小さくし、ズーム 13 以下ではふつうのピン（まとめる）
  const fsz = featIconSize(m, ph);
  const feat = fsz ? fsz.k : 0;
  const fw = fsz ? fsz.w : 48, fh = fsz ? fsz.h : 48;
  const hd = m.heading != null ? `<i class="hd" data-h="${m.heading}" style="transform:rotate(${m.heading + (S.map.getBearing ? S.map.getBearing() : 0)}deg)">▲</i>` : "";
  const icon = feat
    ? L.divIcon({
      className: "photo-pin feat", iconSize: [fw, fh], iconAnchor: [fw / 2, fh + 10], popupAnchor: [0, -fh - 8],
      html: `<div class="pp" style="border-color:${color};width:${fw}px;height:${fh}px"><img src="${thumbUrl(ph)}" alt=""><b style="background:${color}">${m.no ?? ""}</b>${hd}</div>`,
    })
    : ph && S.thumbMode && photoPinsMode() === "all" // 「地図に写真を表示」が「全て表示」のときだけ（ほかは小さいピン）
    ? L.divIcon({
      className: "photo-pin", iconSize: [48, 48], iconAnchor: [24, 58], popupAnchor: [0, -56],
      html: `<div class="pp" style="border-color:${color}"><img src="${thumbUrl(ph)}" alt=""><b style="background:${color}">${m.no ?? ""}</b>${hd}</div>`,
    })
    : L.divIcon({
      className: "memo-pin", iconSize: [26, 26], iconAnchor: [13, 30], popupAnchor: [0, -28],
      html: `<div style="background:${color}"><span>${m.no ?? ""}</span></div>`,
    });
  const mk = L.marker([m.lat, m.lon], { icon, riseOnHover: true, zIndexOffset: feat ? 500 + feat * 100 : ph ? 100 : 0 });
  mk._fnMemoId = m.id;
  if (clShows(m.id)) mk.addTo(S.map); // まとめて隠しているピンは置かない
  mk.bindPopup("", { maxWidth: 260, autoPanPaddingTopLeft: [10, 110], autoPanPaddingBottomRight: [60, 90] });
  mk.on("popupopen", (e) => {
    const cur = S.memos.get(m.id) || m;
    const el = h("div", { html: popupHtml(cur) });
    el.querySelector('[data-pact="edit"]').onclick = () => {
      S.map.closePopup();
      openMemoForm(S.memos.get(m.id));
    };
    el.querySelector('[data-pact="copy"]').onclick = () => copyText(`${cur.lat.toFixed(6)}, ${cur.lon.toFixed(6)}`);
    el.querySelector('[data-pact="move"]').onclick = () => startPinEdit(m.id);
    e.popup.setContent(el);
    loadPopupThumb(cur, el, e.popup);
    loadPopupAudio(cur, el, e.popup);
  });
  S.markers.set(m.id, mk);
  clSchedule();
  if (PIN.on) enablePinDrag(m.id, mk);
  if (SH.on) shiftHookMarker(m.id, mk);
}
function popupHtml(m) {
  const d = S.pos ? `${fmtDist(distance(S.pos, m))} ${dirName(bearing(S.pos, m))}` : "";
  return `<div class="pt">#${m.no ?? ""} ${esc(m.title || "（無題）")}</div>
    <div class="ps">${esc(m.category || "")}${m.owner ? `　記録：${esc(m.owner)}` : ""}　${fmtDate(m.createdAt)}${d ? "　" + d : ""}${m.posEdited ? "　位置を手直し済み" : ""}</div>
    ${m.note ? `<div>${esc(m.note.slice(0, 240)).replace(/\n/g, "<br>")}</div>` : ""}
    <div class="pthumb"></div>
    <div class="pa">
      <button data-pact="edit">編集</button>
      <button data-pact="move">位置を直す</button>
      <button data-pact="copy">座標コピー</button>
      <a href="https://www.google.com/maps/dir/?api=1&destination=${m.lat},${m.lon}" target="_blank" rel="noopener">経路</a>
    </div>`;
}
async function loadPopupThumb(m, el, popup) {
  const photos = await DB.byIndex("photos", "memoId", m.id);
  const box = el.querySelector(".pthumb");
  if (!box || !photos.length) return;
  photos.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const img = h("img", { src: thumbUrl(photos[0]), alt: "写真（タップで拡大）" });
  img.onload = () => popup.isOpen() && popup.update();
  // ポップアップのサムネイルを押すと見返す画面に（全メモを番号順に、このメモの写真から）
  img.onclick = () => { S.map.closePopup(); openPlayback(undefined, { startMemoId: m.id }); };
  box.replaceChildren(img);
  if (photos.length > 1) box.append(h("small", {}, `他 ${photos.length - 1} 枚（タップで表示）`));
}
/** ポップアップに録音の再生ボタン */
async function loadPopupAudio(m, el, popup) {
  if (!m.audioCount) return;
  const au = (await DB.byIndex("audios", "memoId", m.id)).sort((a, b) => (a.createdAt > b.createdAt ? 1 : -1));
  if (!au.length) return;
  const url = URL.createObjectURL(au[0].blob);
  const box = h("div", { class: "paudio" }, h("audio", { controls: true, preload: "none", src: url }), au.length > 1 ? h("small", {}, `録音 ${au.length} 件（メモを開くと全部聞けます）`) : null);
  el.querySelector(".pa").before(box);
  popup.once("remove", () => URL.revokeObjectURL(url));
  popup.update();
}
function thumbUrl(p) {
  if (!S.thumbUrls.has(p.id)) S.thumbUrls.set(p.id, URL.createObjectURL(p.thumb || p.blob));
  return S.thumbUrls.get(p.id);
}

/** 画像を読み込む（EXIF の向きはブラウザが補正する） */
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
const extOf = (mime) => ({ "image/png": "png", "image/webp": "webp" }[mime] || "jpg");
/**
 * 写真を端末内保存用に整える。
 * size = "original" なら元ファイルをそのまま（EXIF 付き）保存、数値なら長辺をその px に縮小した JPEG。
 * どちらも一覧・地図用の小さなサムネイルを別に作る。
 */
async function processPhoto(file, size = Settings.data.photoSize) {
  const { img, url } = await loadImage(file);
  try {
    const th = await drawScaled(img, 360, 0.72);
    let full;
    if (String(size) === "original" && /^image\/(jpeg|png|webp)$/.test(file.type)) {
      // カメラの一時ファイルが消えても困らないよう、中身をコピーして保持する
      full = { blob: new Blob([await file.arrayBuffer()], { type: file.type }), w: img.naturalWidth, h: img.naturalHeight };
    } else {
      full = await drawScaled(img, Number(size) || 2560, 0.85);
    }
    return {
      blob: full.blob, mime: full.blob.type || "image/jpeg", thumb: th.blob, width: full.w, height: full.h, bytes: full.blob.size,
      takenAt: new Date(file.lastModified || Date.now()).toISOString(), origName: file.name || null,
    };
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
  const memo = existing ? { ...existing } : newMemo(loc);
  let saved = !isNew;
  let dirty = false;
  return memoForm(memo, isNew, saved, dirty);
}
function newMemo(loc) {
  return {
    id: uuid(), no: nextNo(), createdAt: nowIso(), updatedAt: nowIso(),
    lat: loc.lat, lon: loc.lon, source: loc.source,
    accuracy: loc.source === "gps" && S.pos ? Math.round((loc.acc ?? S.pos.acc) * 10) / 10 : null,
    ...(loc.averaged ? { gpsAveraged: loc.averaged } : {}), ...(loc.corrected ? { gpsCorrected: true } : {}),
    gpsAltitude: loc.source === "gps" && S.pos && S.pos.alt != null ? Math.round(S.pos.alt * 10) / 10 : null,
    elevation: null, elevationSrc: null, address: null, mesh: meshCode(loc.lat, loc.lon),
    title: "", note: "", category: Settings.data.categories[0], tags: [], heading: null,
    baseMap: S.baseId, project: Settings.data.project || null, observer: Settings.data.observer || null,
  };
}
async function memoForm(memo, isNew, saved, dirty) {

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

  // カテゴリ（この画面で追加・編集・削除もできる）
  const chips = form.querySelector(".cat-chips");
  const mgrBox = form.querySelector(".cat-mgr-box");
  const renderChips = () => {
    chips.replaceChildren();
    const cats = Settings.data.categories.slice();
    if (memo.category && !cats.includes(memo.category)) cats.push(memo.category);
    for (const c of cats) {
      const chip = h("button", { type: "button", class: "chip" + (c === memo.category ? " on" : "") }, h("i", { style: `background:${catColor(c)}` }), c);
      chip.onclick = () => {
        memo.category = c;
        dirty = true;
        renderChips();
      };
      chips.append(chip);
    }
    const editing = !mgrBox.hidden;
    chips.append(
      h("button", { type: "button", class: "chip ghost", onclick: () => openMgr(true) }, "＋ 追加"),
      h("button", { type: "button", class: "chip ghost" + (editing ? " on" : ""), onclick: () => (mgrBox.hidden ? openMgr(false) : closeMgr()) }, editing ? "編集を閉じる" : "編集"));
  };
  const onCatChange = (ev) => {
    if (ev.type === "rename" && memo.category === ev.from) memo.category = ev.to;
    if (ev.type === "delete" && memo.category === ev.from) memo.category = ev.to || Settings.data.categories[0];
    if (ev.type === "add") { memo.category = ev.to; dirty = true; }
    renderChips();
  };
  const openMgr = (focusAdd) => { mgrBox.replaceChildren(categoryManager(onCatChange, { focusAdd })); mgrBox.hidden = false; renderChips(); };
  const closeMgr = () => { mgrBox.hidden = true; mgrBox.replaceChildren(); renderChips(); };
  renderChips();

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
      const im = h("img", { src: thumbUrl(p), alt: "" });
      im.onclick = () => {
        const all = existingPhotos.filter((x) => !removed.has(x.id)).concat(newPhotos);
        openViewer(all.map((photo) => ({ photo, memo })), all.indexOf(p), { readonly: true });
      };
      thumbs.append(h("div", { class: "thumb" }, im, del));
    }
  };
  renderThumbs();
  // 地図で大きく表示（パース・キービジュアルなど）
  let featSize = memo.featured || 0;
  const featCb = h("input", { type: "checkbox", checked: !!featSize });
  const featSeg = h("div", { class: "seg seg-sm feat-seg" });
  const renderFeat = () => {
    featSeg.hidden = !featCb.checked;
    featSeg.replaceChildren(...[2, 3, 4].map((k) => {
      const b = h("button", { type: "button", class: (featSize || 3) === k ? "on" : "" }, `${k} 倍`);
      b.onclick = () => { featSize = k; dirty = true; renderFeat(); };
      return b;
    }));
  };
  featCb.onchange = () => { if (featCb.checked && !featSize) featSize = 3; dirty = true; renderFeat(); };
  renderFeat();
  form.querySelector(".photo-row").after(h("div", { class: "feat-box" },
    h("label", { class: "inline" }, featCb, "お気に入り：地図で大きく表示する（パース・キービジュアルなど）"),
    featSeg,
    h("div", { class: "note feat-note" }, "先頭の写真を、ほかの写真の 2〜4 倍の大きさで、どの縮尺でも地図に出します。見返す画面の「お気に入り」と同じです。")));
  const addPhotos = async (input) => {
    const files = Array.from(input.files || []);
    input.value = "";
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
  f.photoCam.onchange = () => addPhotos(f.photoCam);
  f.photoPick.onchange = () => addPhotos(f.photoPick);

  // 聞き取り（録音・書き起こし）
  const existingAudios = isNew ? [] : await DB.byIndex("audios", "memoId", memo.id);
  const newAudios = [];
  const removedAudios = new Set();
  const voice = voicePanel({
    memo,
    textarea: f.note,
    markDirty: () => (dirty = true),
    audios: () => existingAudios.filter((a) => !removedAudios.has(a.id)).concat(newAudios).sort((a, b) => (a.createdAt > b.createdAt ? 1 : -1)),
    onRecorded: (a) => { newAudios.push(a); dirty = true; },
    onRemove: (id) => {
      const i = newAudios.findIndex((a) => a.id === id);
      if (i >= 0) newAudios.splice(i, 1);
      else removedAudios.add(id);
      dirty = true;
    },
  });
  form.querySelector(".voice-box").append(voice.el);

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
    if (voice.isActive()) await voice.stop(); // 録音中なら止めて一緒に保存
    memo.title = f.title.value.trim();
    memo.note = f.note.value.trim();
    memo.tags = f.tags.value.split(/[,、，]/).map((s) => s.trim()).filter(Boolean);
    if (f.useHeading.checked && S.heading != null) memo.heading = Math.round(S.heading);
    else if (!f.useHeading.checked) memo.heading = null;
    memo.updatedAt = nowIso();
    memo.photoCount = existingPhotos.filter((p) => !removed.has(p.id)).length + newPhotos.length;
    if (featCb.checked) memo.featured = featSize || 3;
    else delete memo.featured;
    memo.audioCount = existingAudios.filter((a) => !removedAudios.has(a.id)).length + newAudios.length;
    try {
      await DB.put("memos", memo);
      let order = existingPhotos.length;
      for (const p of newPhotos) await DB.put("photos", { ...p, order: order++ });
      for (const id of removed) await DB.del("photos", id);
      for (const a of newAudios) await DB.put("audios", a);
      for (const id of removedAudios) await DB.del("audios", id);
    } catch (err) {
      alert("保存に失敗しました：" + err.message);
      return;
    }
    saved = true;
    S.memos.set(memo.id, memo);
    await refreshMemoThumb(memo.id);
    renderMarker(memo);
    updateCounts();
    closeSheet(true);
    toast(isNew ? `#${memo.no} を保存しました` : "更新しました");
  };

  openSheet(isNew ? "新しいメモ" : `メモ #${memo.no}`, form, {
    guard: () => !dirty || saved || confirm(voice.isActive() ? "録音中です。録音と入力内容を破棄しますか？" : "入力内容を破棄しますか？"),
    onClose: () => voice.dispose(),
  });
  if (isNew) setTimeout(() => f.title.focus({ preventScroll: true }), 250);
}

async function deleteMemo(id) {
  const photos = await DB.byIndex("photos", "memoId", id);
  for (const p of photos) await DB.del("photos", p.id);
  for (const a of await DB.byIndex("audios", "memoId", id)) await DB.del("audios", a.id);
  await DB.del("memos", id);
  S.memos.delete(id);
  S.memoThumb.delete(id);
  const mk = S.markers.get(id);
  if (mk) S.map.removeLayer(mk);
  S.markers.delete(id);
  clSchedule();
  updateCounts();
}

function addMemoHere() {
  if (!S.pos) {
    toast("現在地がまだ取得できていません。地図中心に作成します");
    return addMemoCenter();
  }
  if (S.pos.acc > 100) toast(`GPS の精度が低めです（±${Math.round(S.pos.acc)} m）`);
  waitAveragedPosition().then((p) => openMemoForm(null, { lat: p.lat, lon: p.lon, source: "gps", acc: p.acc, averaged: p.averaged, corrected: p.corrected }));
}
function addMemoCenter() {
  if (!S.crosshair) toggleCrosshair(true);
  const c = S.map.getCenter();
  openMemoForm(null, { lat: c.lat, lon: c.lng, source: "map" });
}

/* ---------- メモ一覧 ---------- */
let listState = { q: "", cat: "", sort: "new", view: "list" };
let listRefresh = null;
/** 軌跡の一覧（メモ一覧の下に置く）：表示・非表示と削除 */
function trackListBox() {
  const box = h("div", { class: "track-list" });
  let tracks = [];
  const render = () => {
    box.replaceChildren(h("div", { class: "track-head" }, `軌跡${tracks.length ? `（${tracks.length}本）` : ""}`));
    if (!tracks.length) { box.append(h("div", { class: "note", style: "margin-top:2px" }, "記録した軌跡はありません。地図の右の軌跡ボタンで記録を開始できます（GPS ロガーアプリの GPX も「保存・設定」→「読み込み」から取り込めます）。")); return; }
    for (const t of tracks) {
      const rec = S.track && S.track.id === t.id;
      const shown = S.shownTracks.has(t.id) || rec;
      const showBtn = h("button", { class: "chip" + (shown ? " on" : ""), type: "button" }, shown ? "表示中" : "表示");
      showBtn.onclick = () => {
        if (rec) return;
        if (S.shownTracks.has(t.id)) {
          S.map.removeLayer(S.shownTracks.get(t.id));
          S.shownTracks.delete(t.id);
          rememberShownTracks();
        } else {
          const line = L.polyline(trackLatLngs(t), { color: trackColor(t), weight: 4, opacity: 0.8 }).addTo(S.map);
          S.shownTracks.set(t.id, line);
          rememberShownTracks();
          // メモをタップしたときと同じく、一覧を閉じて軌跡の範囲を見せる
          if (t.points.length) { closeSheet(true); setFollow(false); S.map.fitBounds(line.getBounds(), { padding: [40, 40] }); return; }
        }
        render();
      };
      const delBtn = h("button", { class: "chip", type: "button" }, "削除");
      delBtn.onclick = async () => {
        if (rec) return toast("記録中の軌跡は削除できません");
        if (!confirm(`「${t.name}」を削除しますか？`)) return;
        await DB.del("tracks", t.id);
        if (S.shownTracks.has(t.id)) S.map.removeLayer(S.shownTracks.get(t.id));
        S.shownTracks.delete(t.id);
        rememberShownTracks();
        tracks = tracks.filter((x) => x !== t);
        render();
      };
      box.append(h("div", { class: "memo-item", style: "grid-template-columns:1fr auto auto auto;cursor:default" },
        h("div", {}, h("div", { class: "t" }, t.name + (t.endedAt ? "" : "（記録中）")), h("div", { class: "s" }, [t.source === "gpx" ? "GPX" : "", fmtDate(t.startedAt), fmtDist(t.distance), `${t.points.length}点`].filter(Boolean).join("・"))),
        h("button", { class: "chip", type: "button", onclick: () => { closeSheet(true); elevationProfile(trackLatLngs(t).flat(), t.name); } }, "断面"), showBtn, delBtn));
    }
  };
  DB.all("tracks").then((ts) => { tracks = ts.sort((a, b) => (b.startedAt > a.startedAt ? 1 : -1)); render(); });
  render();
  return box;
}

function openList() {
  const q = h("input", { type: "search", placeholder: "キーワードで絞り込み", value: listState.q });
  const cat = h("select", {});
  const fillCats = () => {
    if (listState.cat && !Settings.data.categories.includes(listState.cat)) listState.cat = "";
    cat.replaceChildren(h("option", { value: "" }, "全カテゴリ"), ...Settings.data.categories.map((c) => h("option", { value: c, selected: c === listState.cat }, c)));
  };
  fillCats();
  // 一覧からもカテゴリを編集できる
  const catMgrBox = h("div", { class: "list-cat-mgr", hidden: true });
  const catEditBtn = h("button", { type: "button", class: "chip" }, "カテゴリ編集");
  catEditBtn.onclick = () => {
    if (catMgrBox.hidden) {
      catMgrBox.replaceChildren(categoryManager((ev) => {
        if (ev.type === "rename" && listState.cat === ev.from) listState.cat = ev.to;
        fillCats();
        render();
      }));
      catMgrBox.hidden = false;
      catEditBtn.classList.add("on");
    } else {
      catMgrBox.hidden = true;
      catMgrBox.replaceChildren();
      catEditBtn.classList.remove("on");
    }
  };
  const sort = h("select", {},
    h("option", { value: "new", selected: listState.sort === "new" }, "新しい順"),
    h("option", { value: "no", selected: listState.sort === "no" }, "番号順"),
    h("option", { value: "near", selected: listState.sort === "near" }, "近い順"));
  const list = h("div");
  const tabList = h("button", { type: "button", class: "chip" }, "リスト");
  const tabPhotos = h("button", { type: "button", class: "chip" }, "写真");
  const selBtn = h("button", { type: "button", class: "chip sel-toggle" }, "選択して整理");
  let allPhotos = null;
  DB.all("photos").then((ps) => {
    allPhotos = ps;
    tabPhotos.textContent = `写真（${ps.length}）`;
    if (listState.view === "photos") render();
  });
  // ---- 選択モード
  let selecting = false;
  const sel = new Set();
  let shown = []; // 今の絞り込みで表示中のメモ
  const bar = h("div", { class: "sel-bar", hidden: true });
  const panel = h("div", { class: "sel-panel" });
  const selCount = h("b");
  const allBtn = h("button", { type: "button", class: "chip" }, "全選択");
  const act = (label, fn, cls = "") => h("button", { type: "button", class: "chip " + cls, onclick: () => (sel.size ? fn() : toast("メモを選んでください")) }, label);
  bar.append(
    h("div", { class: "sel-head" }, selCount, allBtn, h("button", { type: "button", class: "chip", onclick: () => setSelecting(false) }, "完了")),
    h("div", { class: "chips" },
      act("カテゴリ変更", () => showPanel("cat")),
      act("タグを付ける", () => showPanel("tag+")),
      act("タグを外す", () => showPanel("tag-")),
      act("地図で表示", showOnMap),
      act("書き出し", () => showPanel("export")),
      act("削除", bulkDelete, "danger")),
    panel);
  allBtn.onclick = () => {
    const allOn = shown.length && shown.every((m) => sel.has(m.id));
    for (const m of shown) allOn ? sel.delete(m.id) : sel.add(m.id);
    render();
  };
  const setSelecting = (on) => {
    selecting = on;
    if (!on) sel.clear();
    if (on) listState.view = "list";
    panel.replaceChildren();
    render();
  };
  selBtn.onclick = () => setSelecting(!selecting);
  const selected = () => [...sel].map((id) => S.memos.get(id)).filter(Boolean);
  /** 選んだメモをまとめて更新して保存 */
  const applyAll = async (fn, msg) => {
    const ms = selected();
    const now = nowIso();
    for (const m of ms) { fn(m); m.updatedAt = now; await DB.put("memos", m); renderMarker(m); }
    updateCounts();
    panel.replaceChildren();
    render();
    toast(`${ms.length} 件の${msg}`);
  };
  const showPanel = (kind) => {
    panel.replaceChildren();
    if (kind === "cat") {
      const cats = [...new Set([...Settings.data.categories, ...selected().map((m) => m.category).filter(Boolean)])];
      panel.append(h("div", { class: "note" }, `選んだ ${sel.size} 件のカテゴリを変更：`),
        h("div", { class: "chips" }, ...cats.map((c) => h("button", { type: "button", class: "chip", onclick: () => applyAll((m) => (m.category = c), `カテゴリを「${c}」にしました`) }, h("i", { class: "dot-i", style: `background:${catColor(c)}` }), c))));
    } else if (kind === "tag+") {
      const inp = h("input", { type: "text", placeholder: "付けるタグ（カンマ区切りで複数可）" });
      const known = [...new Set([...S.memos.values()].flatMap((m) => m.tags || []))].slice(0, 30);
      const add = (tags) => {
        tags = tags.map((t) => t.trim()).filter(Boolean);
        if (!tags.length) return;
        applyAll((m) => (m.tags = [...new Set([...(m.tags || []), ...tags])]), `メモにタグ「${tags.join("・")}」を付けました`);
      };
      panel.append(h("form", { class: "sel-form", onsubmit: (e) => { e.preventDefault(); add(inp.value.split(/[,、，]/)); } }, inp, h("button", { type: "submit", class: "chip on" }, "付ける")),
        known.length ? h("div", { class: "chips" }, ...known.map((t) => h("button", { type: "button", class: "chip", onclick: () => add([t]) }, "#" + t))) : null);
      setTimeout(() => inp.focus(), 50);
    } else if (kind === "tag-") {
      const cnt = new Map();
      for (const m of selected()) for (const t of m.tags || []) cnt.set(t, (cnt.get(t) || 0) + 1);
      panel.append(cnt.size
        ? h("div", {}, h("div", { class: "note" }, "外すタグを選ぶ（数字は付いている件数）："),
          h("div", { class: "chips" }, ...[...cnt].map(([t, n]) => h("button", { type: "button", class: "chip", onclick: () => applyAll((m) => (m.tags = (m.tags || []).filter((x) => x !== t)), `メモからタグ「${t}」を外しました`) }, `#${t} (${n})`))))
        : h("div", { class: "note" }, "選んだメモにはタグがありません"));
    } else if (kind === "export") {
      const canShare = !!(navigator.canShare && navigator.canShare({ files: [new File(["x"], "x.txt", { type: "text/plain" })] }));
      const ex = (k, mode) => async () => {
        EXPORT_SEL = new Set(sel);
        try { await doExport(k, mode, false); } finally { EXPORT_SEL = null; }
      };
      const row = (label, k) => h("div", { class: "menu-grid" },
        h("button", { type: "button", class: "btn secondary", onclick: ex(k, "download") }, `${label} を保存`),
        canShare ? h("button", { type: "button", class: "btn secondary", onclick: ex(k, "share") }, `${label} を共有…`) : h("span"));
      panel.append(h("div", { class: "note" }, `選んだ ${sel.size} 件だけを書き出します（写真を含む。軌跡と 重ねた地図は含みません）`),
        photoQualityPicker(new Set(sel)),
        row("ZIP（写真つき）", "zip"), h("div", { style: "height:6px" }), row("GeoJSON", "geojson"), h("div", { style: "height:6px" }), row("CSV", "csv"));
    }
  };
  function showOnMap() {
    const ms = selected();
    closeSheet(true);
    setFollow(false);
    if (ms.length === 1) S.map.setView([ms[0].lat, ms[0].lon], Math.max(S.map.getZoom(), 17));
    else S.map.fitBounds(L.latLngBounds(ms.map((m) => [m.lat, m.lon])), { padding: [60, 60], maxZoom: 18 });
    // 選んだメモを数秒だけ目立たせる
    setTimeout(() => {
      clForce(ms.map((m) => m.id), 5200); // まとめていても、選んだメモは出す
      for (const m of ms) S.markers.get(m.id)?.getElement()?.classList.add("hl");
      setTimeout(() => { for (const m of ms) S.markers.get(m.id)?.getElement()?.classList.remove("hl"); }, 5000);
    }, 400);
  }
  async function bulkDelete() {
    const ms = selected();
    const photos = ms.reduce((n, m) => n + (m.photoCount || 0), 0);
    if (!confirm(`選んだ ${ms.length} 件のメモ${photos ? `（写真 ${photos} 枚を含む）` : ""}を削除しますか？`)) return;
    if (ms.length >= 5 && !confirm(`本当に ${ms.length} 件を削除しますか？元に戻せません。必要なら先に「書き出し」で保存してください。`)) return;
    for (const m of ms) await deleteMemo(m.id);
    sel.clear();
    panel.replaceChildren();
    render();
    toast(`${ms.length} 件を削除しました`);
  }

  tabList.onclick = () => { listState.view = "list"; render(); };
  tabPhotos.onclick = () => { if (selecting) setSelecting(false); listState.view = "photos"; render(); };
  let render = () => {
    listState = { q: q.value.trim(), cat: cat.value, sort: sort.value, view: listState.view };
    tabList.classList.toggle("on", listState.view === "list");
    tabPhotos.classList.toggle("on", listState.view === "photos");
    selBtn.classList.toggle("on", selecting);
    selBtn.textContent = selecting ? "選択をやめる" : "選択して整理";
    bar.hidden = !selecting;
    $("#sheet-title").textContent = `メモ一覧（${S.memos.size}件）`;
    for (const id of [...sel]) if (!S.memos.has(id)) sel.delete(id);
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
    shown = arr;
    const hiddenSel = [...sel].filter((id) => !arr.some((m) => m.id === id)).length;
    selCount.textContent = `${sel.size} 件選択${hiddenSel ? `（うち ${hiddenSel} 件は絞り込みの外）` : ""}`;
    allBtn.textContent = arr.length && arr.every((m) => sel.has(m.id)) ? "全解除" : `表示中を全選択（${arr.length}）`;
    list.replaceChildren();
    if (listState.view === "photos") return renderGallery(list, arr, allPhotos);
    if (!arr.length) {
      list.append(h("div", { class: "empty" }, S.memos.size ? "該当するメモがありません" : "まだメモがありません。下の「現在地にメモ」「撮影」から記録できます。"));
      return;
    }
    for (const m of arr) {
      let dcell = "";
      if (ref && !selecting) {
        const b = bearing(ref, m);
        dcell = h("div", { class: "d" }, fmtDist(distance(ref, m)), h("br"),
          h("span", { class: "arrow", style: `transform:rotate(${b - (S.heading ?? 0)}deg)` }, "↑"), " ", dirName(b));
      }
      const lead = selecting
        ? h("input", { type: "checkbox", class: "sel-cb", checked: sel.has(m.id), tabindex: "-1" })
        : h("i", { style: `background:${memoColor(m)}` });
      const item = h("div", { class: "memo-item" + (selecting ? " selecting" : "") + (sel.has(m.id) ? " picked" : "") },
        lead,
        h("div", {},
          h("div", { class: "t" }, selecting ? h("i", { class: "dot-i", style: `background:${memoColor(m)}` }) : null, `#${m.no ?? ""} ${m.title || "（無題）"}`),
          h("div", { class: "s" }, [m.featured ? `お気に入り（${m.featured}倍）` : "", m.category, m.owner ? `記録：${m.owner}` : "", fmtDate(m.createdAt), m.photoCount ? `写真${m.photoCount}` : "", m.audioCount ? `録音${m.audioCount}` : "", (m.tags || []).map((t) => "#" + t).join(" ")].filter(Boolean).join("　")),
          m.note ? h("div", { class: "n" }, m.note) : null),
        dcell);
      item.onclick = (e) => {
        if (selecting) {
          e.preventDefault();
          sel.has(m.id) ? sel.delete(m.id) : sel.add(m.id);
          render();
          return;
        }
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
  listRefresh = () => { if (!selecting) render(); };
  // 軌跡はメモの一覧の下に（リスト表示で、選択モードでないときだけ）
  const tracksBox = trackListBox();
  const syncTracks = () => (tracksBox.hidden = listState.view === "photos" || selecting);
  const render0 = render;
  render = () => { render0(); syncTracks(); };
  // 見返す：一覧を番号順にしてから、今の表示（リスト＝メモ全部／写真＝写真だけ・絞り込みどおり）をその順で
  const playBtn = h("button", { type: "button", class: "chip", onclick: () => {
    if (sort.value !== "no") { sort.value = "no"; render(); }
    if (!shown.length) return toast("見返すメモがありません");
    openPlayback(shown, { photosOnly: listState.view === "photos", resume: true });
  } }, "見返す");
  openSheet(`メモ一覧（${S.memos.size}件）`, h("div", {}, h("div", { class: "list-tools" }, tabList, tabPhotos, playBtn, h("span", { style: "flex:1" }), selBtn), h("div", { class: "list-tools" }, q), h("div", { class: "list-tools" }, cat, sort, catEditBtn), catMgrBox, h("div", { class: "opt-rows list-opt" }, colorBySeg(() => render()), photoPinsSeg()), list, tracksBox, bar), {
    onClose: () => (listRefresh = null),
  });
  render();
}
/** 地図の写真（サムネイル）を、すべてのメモに出すか、お気に入りだけにするか */
/** 地図に写真を表示：表示しない／お気に入り／全て表示 */
function photoPinsSeg() {
  return optSeg("地図に写真を表示", [["none", "表示しない"], ["fav", "お気に入り"], ["all", "全て表示"]], photoPinsMode, (v) => {
    Settings.data.photoPins = v;
    delete Settings.data.photoPinsFavOnly;
    Settings.save();
    for (const m of S.memos.values()) if (S.memoThumb.has(m.id)) renderMarker(m);
    clUpdate();
    const n = [...S.memos.values()].filter((m) => m.featured && m.photoCount).length;
    toast(v === "none" ? "地図に写真を出しません（ピンだけ）" : v === "fav" ? (n ? `お気に入り（${n} 件）の写真だけを地図に出します` : "お気に入りはまだありません。見返す画面やメモの画面で付けられます") : "地図に写真をすべて出します（ズーム 15 以上）", 2600);
  });
}
function renderGallery(box, memos, allPhotos) {
  if (!allPhotos) return box.append(h("div", { class: "empty" }, "読み込み中…"));
  const byMemo = new Map();
  for (const p of allPhotos) {
    if (!byMemo.has(p.memoId)) byMemo.set(p.memoId, []);
    byMemo.get(p.memoId).push(p);
  }
  const items = [];
  for (const m of memos) for (const photo of (byMemo.get(m.id) || []).sort((a, b) => (a.order ?? 0) - (b.order ?? 0))) items.push({ photo, memo: m });
  if (!items.length) return box.append(h("div", { class: "empty" }, "写真はまだありません。下の「撮影」ボタンで撮影できます。"));
  const grid = h("div", { class: "gal" });
  items.forEach((it, i) => {
    const tile = h("button", { type: "button", class: "gal-tile" }, h("img", { src: thumbUrl(it.photo), alt: "", loading: "lazy" }), h("b", { style: `background:${memoColor(it.memo)}` }, `#${it.memo.no ?? ""}`));
    tile.onclick = () => openPlayback(memos, { photosOnly: true, startPhotoId: it.photo.id }); // 一覧と同じ順・同じ画面
    grid.append(tile);
  });
  box.append(grid);
}
let listRefreshTimer;
function refreshListDistancesSoon() {
  if (!listRefresh || listRefreshTimer || listState.view === "photos") return;
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
    S.trackLine.setStyle({ color: trackColor(t) });
    S.trackLine = null;
    rememberShownTracks();
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
  // 記録を再開したあとは線を分ける（止まっていた間はつながない）
  const segs = t.segStarts && t.segStarts.length > 1;
  if (segs) {
    const lls = S.trackLine.getLatLngs(), arr = Array.isArray(lls[0]) ? lls : [lls];
    if (t.segStarts[t.segStarts.length - 1] === t.points.length - 1 || !arr.length) arr.push([]);
    arr[arr.length - 1].push(L.latLng(p.lat, p.lon));
    S.trackLine.setLatLngs(arr);
  } else S.trackLine.addLatLng([p.lat, p.lon]);
  // 電源が急に切れても失われないよう、こまめに保存（5 秒に 1 回まで）
  if (Date.now() - trackSaveCount > 5000) { trackSaveCount = Date.now(); DB.put("tracks", t).catch(() => {}); }
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

/* ---------- 書き出す写真の画質（ZIP・JSON に入れる写真だけを縮める。端末の写真はそのまま） ---------- */
const PHOTO_EXPORT_Q = {
  orig: { name: "元のまま", desc: "撮ったままの画質（位置などの EXIF も残る）" },
  hi: { name: "高画質", max: 2560, q: 0.85, bpp: 0.3, desc: "長辺 2560px・JPEG 85%（A4 印刷にも十分）" },
  mid: { name: "標準", max: 1920, q: 0.8, bpp: 0.22, desc: "長辺 1920px・JPEG 80%（画面で見る・資料に貼る）" },
  low: { name: "軽量", max: 1280, q: 0.72, bpp: 0.16, desc: "長辺 1280px・JPEG 72%（共有・メール向け）" },
};
const exportPhotoQ = () => (PHOTO_EXPORT_Q[Settings.data.exportPhotoQ] ? Settings.data.exportPhotoQ : "orig");
/** 書き出し用の写真。縮めても小さくならないとき・読めない形式のときは元のまま */
async function exportPhotoBlob(p, qk = exportPhotoQ()) {
  const orig = { blob: p.blob, mime: p.mime || p.blob.type || "image/jpeg", width: p.width, height: p.height, compressed: false };
  const q = PHOTO_EXPORT_Q[qk];
  if (!q?.max) return orig;
  let bmp = null;
  try {
    bmp = await createImageBitmap(p.blob, { imageOrientation: "from-image" });
    const sc = Math.min(1, q.max / Math.max(bmp.width, bmp.height));
    const w = Math.max(1, Math.round(bmp.width * sc)), hh = Math.max(1, Math.round(bmp.height * sc));
    const c = document.createElement("canvas");
    c.width = w; c.height = hh;
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#fff"; // 透明な PNG は白地に
    ctx.fillRect(0, 0, w, hh);
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bmp, 0, 0, w, hh);
    const blob = await new Promise((res) => c.toBlob(res, "image/jpeg", q.q));
    c.width = c.height = 0;
    if (!blob || blob.size >= p.blob.size) return orig;
    return { blob, mime: "image/jpeg", width: w, height: hh, compressed: true };
  } catch {
    return orig;
  } finally {
    bmp?.close?.();
  }
}
/** 画質を選ぶ欄（設定は共通）。memoIds を渡すとそのメモの写真だけで大きさを見積もる */
function photoQualityPicker(memoIds = null) {
  const sel = h("select", {}, ...Object.entries(PHOTO_EXPORT_Q).map(([k, q]) => h("option", { value: k, selected: k === exportPhotoQ() }, q.name)));
  const desc = h("div", { class: "msec-meta pq-desc" });
  let est = null;
  const show = () => {
    const q = PHOTO_EXPORT_Q[sel.value];
    desc.textContent = q.desc + (est ? `　写真 ${est.n} 枚：元のまま ${fmtMB(est.orig)}${q.max ? ` → 約 ${fmtMB(est[sel.value])}` : ""}` : "");
  };
  sel.onchange = () => { Settings.data.exportPhotoQ = sel.value; Settings.save(); show(); };
  show();
  (async () => {
    // 写真の画素数と大きさから、縮めた後の大きさを見積もる（実際は写真の内容で上下する）
    const photos = (await DB.all("photos")).filter((p) => !memoIds || memoIds.has(p.memoId));
    const e = { n: photos.length, orig: 0, hi: 0, mid: 0, low: 0 };
    for (const p of photos) {
      const bytes = p.blob?.size || p.bytes || 0, long = Math.max(p.width || 0, p.height || 0) || 4000, px = (p.width || 4000) * (p.height || 3000);
      e.orig += bytes;
      for (const k of ["hi", "mid", "low"]) {
        const q = PHOTO_EXPORT_Q[k], sc = Math.min(1, q.max / long);
        e[k] += Math.min(bytes, px * sc * sc * q.bpp);
      }
    }
    est = e;
    for (const o of sel.options) {
      const q = PHOTO_EXPORT_Q[o.value];
      o.textContent = q.max ? `${q.name}（約 ${fmtMB(e[o.value])}）` : `${q.name}（${fmtMB(e.orig)}）`;
    }
    show();
  })();
  return h("div", { class: "pq-row" }, h("label", { class: "pq-lab" }, "写真の画質（ZIP・JSON に入れる写真）", sel), desc);
}
const fmtMB = (b) => (b >= 1073741824 ? `${(b / 1073741824).toFixed(2)} GB` : `${Math.max(0.1, b / 1048576).toFixed(1)} MB`);

/**
 * 全データの JSON を作る。
 * photoMode: "none" = 写真はファイル名のみ / "dataUrl" = base64 で埋め込む / "file" = ZIP 用（files に実体を返す）
 */
/** 書き出し対象のメモ（一覧で選んだメモだけを書き出すときは EXPORT_SEL に ID を入れる） */
let EXPORT_SEL = null;
const exportMemos = () => Array.from(S.memos.values()).filter((m) => !EXPORT_SEL || EXPORT_SEL.has(m.id)).sort((a, b) => (a.no || 0) - (b.no || 0));
const exportTracks = async () => (EXPORT_SEL ? [] : DB.all("tracks"));

async function buildJSON(photoMode = "none") {
  const memos = exportMemos();
  const out = [];
  const files = [];
  // 写真を縮めて書き出すとき（ZIP・写真を埋め込む JSON）
  const qk = photoMode === "none" ? "orig" : exportPhotoQ();
  const total = qk === "orig" ? 0 : memos.reduce((n, m) => n + (m.photoCount || 0), 0);
  let done = 0, saved = 0;
  for (const m of memos) {
    const ph = (await DB.byIndex("photos", "memoId", m.id)).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    const photos = [];
    for (const [i, p] of ph.entries()) {
      const ex = qk === "orig" ? { blob: p.blob, mime: p.mime || p.blob.type || "image/jpeg", width: p.width, height: p.height } : await exportPhotoBlob(p, qk);
      if (total) { done++; saved += p.blob.size - ex.blob.size; if (done % 3 === 0 || done === total) toast(`写真を縮めています… ${done}/${total}`, 60000); }
      const mime = ex.mime;
      const filename = `memo${String(m.no).padStart(3, "0")}_${i + 1}.${extOf(mime)}`;
      const o = { id: p.id, filename, file: `photos/${filename}`, mime, width: ex.width, height: ex.height, bytes: ex.blob.size, takenAt: p.takenAt, origName: p.origName || null };
      if (ex.compressed) o.reduced = { quality: qk, origBytes: p.blob.size, origWidth: p.width, origHeight: p.height };
      if (photoMode === "dataUrl") o.dataUrl = await blobToDataURL(ex.blob);
      if (photoMode === "file") files.push({ path: o.file, blob: ex.blob, date: new Date(p.takenAt || m.createdAt) });
      photos.push(o);
    }
    const audios = [];
    for (const [i, a] of (await DB.byIndex("audios", "memoId", m.id)).sort((x, y) => (x.createdAt > y.createdAt ? 1 : -1)).entries()) {
      const filename = `memo${String(m.no).padStart(3, "0")}_rec${i + 1}.${audioExt(a.mime)}`;
      const o = { id: a.id, filename, file: `audio/${filename}`, mime: a.mime, duration: a.duration, createdAt: a.createdAt, bytes: a.blob.size };
      if (photoMode === "dataUrl") o.dataUrl = await blobToDataURL(a.blob);
      if (photoMode === "file") files.push({ path: o.file, blob: a.blob, date: new Date(a.createdAt) });
      audios.push(o);
    }
    out.push({ ...memoOut(m), photos, audios });
  }
  if (total) toast(`写真 ${total} 枚を${PHOTO_EXPORT_Q[qk].name}に縮めました（${fmtMB(Math.max(0, saved))} 小さく）`, 3000);
  const tracks = (await exportTracks()).map((t) => ({ ...t, pointFields: ["lat", "lon", "time_ms", "accuracy_m", "altitude_m"] }));
  return {
    format: "fieldnote", version: 1, exportedAt: nowIso(),
    photoQuality: qk,
    project: { name: Settings.data.project || null, observer: Settings.data.observer || null, categories: Settings.data.categories },
    crs: "EPSG:4326 (WGS84 / JGD2011 相当)",
    memos: out, tracks,
    overlays: EXPORT_SEL ? [] : await pdfLayersForExport(photoMode, files),
    files, // 呼び出し側で取り除く（JSON には書かない）
  };
}
async function buildJSONText(photoMode) {
  const { files, ...data } = await buildJSON(photoMode);
  return JSON.stringify(data, null, 1);
}
function buildGeoJSON(tracks, photoFiles) {
  const features = exportMemos().map((m) => {
    const { lat, lon, ...props } = memoOut(m);
    const extra = photoFiles ? { photos: (photoFiles.get(m.id) || []).join(";") } : {};
    return { type: "Feature", geometry: { type: "Point", coordinates: [lon, lat] }, properties: { ...props, tags: (m.tags || []).join(","), photoCount: m.photoCount || 0, ...extra } };
  });
  for (const t of tracks) {
    if (t.points.length < 2) continue;
    features.push({
      type: "Feature",
      geometry: (() => {
        const segs = trackSegments(t).map((seg) => seg.map((p) => (p[4] != null ? [p[1], p[0], p[4]] : [p[1], p[0]])));
        return segs.length > 1 ? { type: "MultiLineString", coordinates: segs } : { type: "LineString", coordinates: segs[0] };
      })(),
      properties: { kind: "track", id: t.id, name: t.name, startedAt: t.startedAt, endedAt: t.endedAt, distance_m: Math.round(t.distance) },
    });
  }
  return { type: "FeatureCollection", name: Settings.data.project || "fieldnote", features };
}
function buildCSV(photoFiles) {
  const cols = ["no", "title", "category", "note", "tags", "lat", "lon", "accuracy", "elevation", "address", "mesh", "heading", "source", "photoCount", "audioCount", "createdAt", "updatedAt", "id"];
  if (photoFiles) cols.splice(cols.indexOf("photoCount") + 1, 0, "photos");
  const q = (v) => {
    v = Array.isArray(v) ? v.join(";") : v ?? "";
    v = String(v);
    return /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
  };
  const rows = exportMemos()
    .map((m) => cols.map((c) => q(c === "photos" ? photoFiles.get(m.id) || [] : m[c])).join(","));
  return "﻿" + [cols.join(","), ...rows].join("\r\n"); // BOM 付き（Excel で文字化けしないように）
}
function buildGPX(tracks) {
  const x = (s) => esc(s);
  const wpts = exportMemos().map((m) =>
    `<wpt lat="${m.lat}" lon="${m.lon}">${m.elevation != null ? `<ele>${m.elevation}</ele>` : ""}<time>${m.createdAt}</time><name>${x(`#${m.no} ${m.title || ""}`)}</name><desc>${x(m.note || "")}</desc><type>${x(m.category || "")}</type></wpt>`);
  const pt = (p) => `<trkpt lat="${p[0]}" lon="${p[1]}">${p[4] != null ? `<ele>${p[4]}</ele>` : ""}${p[2] != null ? `<time>${new Date(p[2]).toISOString()}</time>` : ""}</trkpt>`;
  const trks = tracks.filter((t) => t.points.length).map((t) =>
    `<trk><name>${x(t.name)}</name>${trackSegments(t).map((seg) => `<trkseg>${seg.map(pt).join("")}</trkseg>`).join("")}</trk>`);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="FieldNote" xmlns="http://www.topografix.com/GPX/1/1">\n${wpts.join("\n")}\n${trks.join("\n")}\n</gpx>\n`;
}

function safeName(s) {
  return (s || "").replace(/[\\/:*?"<>|\s]+/g, "_").slice(0, 40);
}
const exportBaseName = () => `fieldnote_${safeName(Settings.data.project) ? safeName(Settings.data.project) + "_" : ""}${stamp()}${EXPORT_SEL ? `_selected${EXPORT_SEL.size}` : ""}`;
function deliverFile(text, ext, mime, mode) {
  return deliverBlob(new Blob([text], { type: mime }), `${exportBaseName()}.${ext}`, mime, mode);
}
/** ファイルを端末に渡す。mode = "download"（保存）/ "share"（OS の共有シート） */
async function deliverBlob(blob, name, mime, mode) {
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
    const tracks = await exportTracks();
    let ok;
    if (kind === "zip") ok = await exportZip(mode);
    else if (kind === "json") ok = await deliverFile(await buildJSONText(includePhotos ? "dataUrl" : "none"), "json", "application/json", mode);
    else if (kind === "geojson") ok = await deliverFile(JSON.stringify(buildGeoJSON(tracks)), "geojson", "application/geo+json", mode);
    else if (kind === "csv") ok = await deliverFile(buildCSV(), "csv", "text/csv", mode);
    else if (kind === "gpx") ok = await deliverFile(buildGPX(tracks), "gpx", "application/gpx+xml", mode);
    if (ok && !EXPORT_SEL && (kind === "json" || kind === "zip")) {
      Settings.data.lastExportAt = nowIso();
      Settings.save();
      updateCounts();
    }
  } catch (e) {
    alert("書き出しに失敗しました：" + e.message);
  }
}

/** JSON / GeoJSON / ZIP（このアプリの書き出し）を読み込んで統合する */
let importFileName = "";
async function importFile(file) {
  importFileName = file.name || "";
  const head = new Uint8Array(await file.slice(0, 4).arrayBuffer());
  if (head[0] === 0x50 && head[1] === 0x4b) return importZip(file);
  const text = await file.text();
  if (/^\s*(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*<gpx[\s>]/i.test(text.slice(0, 4096)) || /\.gpx$/i.test(file.name)) {
    const r = await importGPX(text, file.name);
    alert(r.error ? `${file.name}：${r.error}` : `GPX 読み込み完了（${file.name}）\n軌跡 ${r.tracks} 本（${r.points.toLocaleString()} 点・${fmtDist(r.distance)}）／地点 ${r.wpts} 件${r.skipped ? `\n重複のためスキップ ${r.skipped} 件` : ""}`);
    return;
  }
  return importJSONText(text);
}
async function importJSONText(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return alert("読み込めませんでした（ZIP・JSON・GeoJSON・GPX に対応）");
  }
  return importData(data, async () => null);
}
/* ---------- GPX 取り込み（GPSLogger など外部の GPS ロガーの記録を軌跡として読み込む） ---------- */
/** 軌跡の点をセグメント（途切れ）ごとに分ける */
function trackSegments(t) {
  const starts = (t.segStarts && t.segStarts.length ? t.segStarts : [0]).filter((i) => i < t.points.length);
  return starts.map((st, k) => t.points.slice(st, starts[k + 1] ?? t.points.length)).filter((seg) => seg.length);
}
function trackLatLngs(t) {
  return trackSegments(t).map((seg) => seg.map((p) => [p[0], p[1]]));
}
const trackSig = (t) => t.points.length ? `${t.points.length}|${t.points[0][2]}|${t.points[t.points.length - 1][2]}|${t.points[0][0]},${t.points[0][1]}` : "";

async function importGPX(text, filename = "") {
  const doc = new DOMParser().parseFromString(text, "application/xml");
  if (doc.getElementsByTagName("parsererror").length) return { error: "GPX（XML）として読み込めませんでした" };
  const kids = (el, name) => Array.from(el.children).filter((c) => c.localName === name);
  const txt = (el, name) => kids(el, name)[0]?.textContent.trim() || "";
  const num = (v) => (v === "" || v == null || isNaN(Number(v)) ? null : Number(v));
  const parsePt = (el) => {
    const lat = num(el.getAttribute("lat")), lon = num(el.getAttribute("lon"));
    if (lat == null || lon == null) return null;
    const t = Date.parse(txt(el, "time"));
    // 精度：拡張要素 <accuracy>（GPSLogger 等）があれば使い、なければ hdop×5m を目安に
    const accEl = el.getElementsByTagNameNS("*", "accuracy")[0];
    const hdop = num(txt(el, "hdop"));
    const acc = accEl ? num(accEl.textContent.trim()) : hdop != null ? hdop * 5 : null;
    const ele = num(txt(el, "ele"));
    return [+lat.toFixed(7), +lon.toFixed(7), isNaN(t) ? null : t, acc != null ? Math.round(acc) : null, ele != null ? Math.round(ele * 10) / 10 : null];
  };
  const base = filename.replace(/\.[^.]*$/, "") || "GPX";
  const existing = await DB.all("tracks");
  const sigs = new Set(existing.map(trackSig));
  const r = { tracks: 0, points: 0, distance: 0, wpts: 0, skipped: 0, ids: [] };

  // 軌跡（trk）と経路（rte）
  const groups = [];
  for (const trk of doc.getElementsByTagNameNS("*", "trk")) {
    groups.push({ name: txt(trk, "name"), segs: kids(trk, "trkseg").map((sg) => kids(sg, "trkpt").map(parsePt).filter(Boolean)) });
  }
  for (const rte of doc.getElementsByTagNameNS("*", "rte")) {
    groups.push({ name: txt(rte, "name"), segs: [kids(rte, "rtept").map(parsePt).filter(Boolean)] });
  }
  for (const [gi, g] of groups.entries()) {
    const segs = g.segs.filter((sg) => sg.length);
    if (!segs.length) continue;
    const points = [], segStarts = [];
    let dist = 0;
    for (const sg of segs) {
      segStarts.push(points.length);
      for (let i = 0; i < sg.length; i++) {
        if (i) dist += distance({ lat: sg[i - 1][0], lon: sg[i - 1][1] }, { lat: sg[i][0], lon: sg[i][1] });
        points.push(sg[i]);
      }
    }
    const t = {
      id: uuid(), name: g.name || (groups.length > 1 ? `${base} (${gi + 1})` : base),
      startedAt: points[0][2] != null ? new Date(points[0][2]).toISOString() : nowIso(),
      endedAt: points[points.length - 1][2] != null ? new Date(points[points.length - 1][2]).toISOString() : nowIso(),
      points, segStarts, distance: dist, source: "gpx", importedFrom: filename || null, project: Settings.data.project || null,
    };
    if (sigs.has(trackSig(t))) { r.skipped++; continue; }
    sigs.add(trackSig(t));
    await DB.put("tracks", t);
    r.tracks++; r.points += points.length; r.distance += dist; r.ids.push(t.id);
  }

  // 地点（wpt）はメモとして取り込む。このアプリが書き出した GPX を戻した場合は重複させない
  let no = nextNo();
  for (const w of doc.getElementsByTagNameNS("*", "wpt")) {
    const p = parsePt(w);
    if (!p) continue;
    const createdAt = p[2] != null ? new Date(p[2]).toISOString() : nowIso();
    const dup = [...S.memos.values()].some((m) => Math.abs(m.lat - p[0]) < 1e-6 && Math.abs(m.lon - p[1]) < 1e-6 && (p[2] == null || m.createdAt === createdAt));
    if (dup) { r.skipped++; continue; }
    const m = newMemo({ lat: p[0], lon: p[1], source: "gpx" });
    Object.assign(m, {
      no: no++, createdAt, updatedAt: nowIso(), accuracy: p[3], gpsAltitude: p[4],
      title: txt(w, "name"), note: [txt(w, "desc"), txt(w, "cmt")].filter(Boolean).join("\n"),
      category: Settings.data.categories.includes(txt(w, "type")) ? txt(w, "type") : Settings.data.categories[Settings.data.categories.length - 1],
      importedFrom: filename || null, photoCount: 0,
    });
    await DB.put("memos", m);
    S.memos.set(m.id, m);
    renderMarker(m);
    fillPlaceInfo(m.id);
    r.wpts++;
  }
  updateCounts();
  if (!r.tracks && !r.wpts && !r.skipped) return { error: "軌跡も地点も見つかりませんでした" };

  // 取り込んだ軌跡を地図に表示
  let bounds = null;
  for (const id of r.ids) {
    const t = await DB.get("tracks", id);
    const line = L.polyline(trackLatLngs(t), { color: trackColor(t), weight: 4, opacity: 0.8 }).addTo(S.map);
    S.shownTracks.set(id, line);
    rememberShownTracks();
    bounds = bounds ? bounds.extend(line.getBounds()) : L.latLngBounds(line.getBounds().getSouthWest(), line.getBounds().getNorthEast());
  }
  if (bounds) {
    setFollow(false);
    S.map.fitBounds(bounds, { padding: [40, 40] });
  }
  return r;
}

async function importZip(file) {
  let z, data, base;
  try {
    z = await readZip(file);
    const names = z.names.filter((n) => !n.startsWith("__MACOSX/"));
    const jsonName = names.find((n) => /(^|\/)data\.json$/.test(n)) || names.find((n) => n.endsWith(".json"));
    if (!jsonName) return alert("ZIP の中に data.json が見つかりません");
    base = jsonName.slice(0, jsonName.lastIndexOf("/") + 1);
    data = JSON.parse(await (await z.get(jsonName)).text());
  } catch (e) {
    return alert("ZIP を読み込めませんでした：" + e.message);
  }
  toast("ZIP を読み込み中…", 60000);
  return importData(data, async (p) => {
    const path = p.file || (p.filename ? `photos/${p.filename}` : null);
    if (!path) return null;
    const b = await z.get(base + path);
    return b ? new Blob([b], { type: p.mime || (/\.png$/i.test(path) ? "image/png" : /\.webp$/i.test(path) ? "image/webp" : "image/jpeg") }) : null;
  });
}
async function importData(data, getPhotoBlob) {
  let memos = data.memos;
  // GeoJSON（このアプリが書き出したもの）も受け付ける
  if (!memos && data.type === "FeatureCollection") {
    memos = data.features.filter((f) => f.geometry?.type === "Point").map((f) => ({
      ...f.properties, lat: f.geometry.coordinates[1], lon: f.geometry.coordinates[0],
      tags: typeof f.properties.tags === "string" ? f.properties.tags.split(",").filter(Boolean) : f.properties.tags || [],
    }));
  }
  if (!Array.isArray(memos)) return alert("フィールドノートのデータではないようです");
  // ほかの人のデータとして追加するか、自分のデータとして統合するか
  const choice = await chooseImportMode({ ...data, memos }, importFileName);
  if (!choice) return;
  const asOther = choice.mode === "add", owner = choice.owner;
  let added = 0, updated = 0, skipped = 0, photos = 0;
  let no = nextNo();
  const already = new Set([...S.memos.values()].filter((x) => x.owner === owner && x.srcId).map((x) => x.srcId));
  for (const raw of memos) {
    if (typeof raw.lat !== "number" || typeof raw.lon !== "number") { skipped++; continue; }
    const { photos: ph, audios: au, ...m } = raw;
    if (asOther) {
      // 新しいメモとして追加（元の ID は srcId に残し、同じファイルの二重取り込みを防ぐ）
      const src = m.srcId || m.id || null;
      if (src && already.has(src)) { skipped++; continue; }
      m.srcId = src;
      m.id = uuid();
      m.owner = m.owner || owner;
      m.no = no++;
    }
    m.id = m.id || uuid();
    m.createdAt = m.createdAt || nowIso();
    m.updatedAt = m.updatedAt || m.createdAt;
    const cur = asOther ? null : S.memos.get(m.id);
    if (cur && (cur.updatedAt || "") >= m.updatedAt) { skipped++; continue; }
    if (!cur && [...S.memos.values()].some((x) => x.no === m.no)) m.no = no++;
    if (m.no == null) m.no = no++;
    let cnt = cur ? cur.photoCount || 0 : 0;
    if (Array.isArray(ph)) {
      for (const [i, p] of ph.entries()) {
        try {
          const blob = (await getPhotoBlob(p)) || (p.dataUrl ? await (await fetch(p.dataUrl)).blob() : null);
          if (!blob) continue;
          // 書き出し済みの写真はそのまま保存（再圧縮しない）。サムネイルだけ作り直す
          const pr = await processPhoto(new File([blob], p.filename || "photo.jpg", { type: blob.type || p.mime || "image/jpeg" }), "original");
          await DB.put("photos", { id: (!asOther && p.id) || uuid(), memoId: m.id, order: i, ...pr, takenAt: p.takenAt || pr.takenAt, origName: p.origName || pr.origName });
          photos++;
        } catch {}
      }
      cnt = (await DB.byIndex("photos", "memoId", m.id)).length;
    }
    m.photoCount = cnt;
    if (Array.isArray(au)) {
      for (const a of au) {
        try {
          const blob = (await getPhotoBlob({ file: a.file, mime: a.mime })) || (a.dataUrl ? await (await fetch(a.dataUrl)).blob() : null);
          if (!blob) continue;
          await DB.put("audios", { id: (!asOther && a.id) || uuid(), memoId: m.id, blob: new Blob([blob], { type: a.mime || blob.type }), mime: a.mime || blob.type, duration: a.duration || 0, createdAt: a.createdAt || m.createdAt });
        } catch {}
      }
      m.audioCount = (await DB.byIndex("audios", "memoId", m.id)).length;
    }
    await DB.put("memos", m);
    cur ? updated++ : added++;
  }
  let tAdded = 0;
  if (Array.isArray(data.tracks)) {
    for (const t of data.tracks) {
      if (!t.id || !Array.isArray(t.points)) continue;
      const { pointFields, ...rest } = t;
      if (asOther) {
        const src = rest.srcId || rest.id;
        if ((await DB.all("tracks")).some((x) => x.owner === owner && x.srcId === src)) continue;
        Object.assign(rest, { srcId: src, id: uuid(), owner: rest.owner || owner, name: `${rest.name}（${owner}）` });
      } else if (await DB.get("tracks", t.id)) continue;
      await DB.put("tracks", rest);
      tAdded++;
      if (asOther) { const line = L.polyline(trackLatLngs(rest), { color: trackColor(rest), weight: 4, opacity: 0.8 }).addTo(S.map); S.shownTracks.set(rest.id, line); }
    }
  }
  if (asOther) {
    rememberShownTracks();
    // ほかの人のデータを入れたら、記録者別の色にする（一覧・設定で戻せる）
    if (added && colorBy() !== "owner") { Settings.data.colorBy = "owner"; Settings.save(); }
    ownerColor(selfName());
    ownerColor(owner);
  }
  if (data.project && !Settings.data.project && data.project.name) {
    Settings.data.project = data.project.name;
    Settings.save();
  }
  const oAdded = Array.isArray(data.overlays) ? await importPdfLayers(data.overlays, getPhotoBlob) : 0;
  await loadMemos();
  if (typeof dataLegendUpdate === "function") dataLegendUpdate();
  alert(`読み込み完了${asOther ? `（${owner} さんのデータとして追加）` : ""}\n追加 ${added} 件 / 更新 ${updated} 件 / スキップ ${skipped}${asOther ? "（取り込み済み）" : ""} 件\n写真 ${photos} 枚 / 軌跡 ${tAdded} 本${oAdded ? ` / 重ねた地図 ${oAdded} 枚` : ""}`);
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
  // 地理院 Vector の最新データ（PMTiles）は 1 つの大きなファイルなので、タイルごとの範囲を読んで端末に残す
  const vtPm = S.baseId === "gsivt" && vtSourceKind() === "pmtiles";
  const defs = [vtPm ? null : BASE_LAYERS.find((b) => b.id === S.baseId), ...Object.keys(S.overlays).map((id) => OVERLAYS.find((o) => o.id === id)),
    demCfg().on ? { url: DEM_SOURCES[0].url, max: 17 } : null].filter(Boolean);
  if (vtPm) {
    const z0v = Math.floor(S.map.getZoom()), tiles = [];
    for (const u of tilesInView({ url: "{z}/{x}/{y}" }, Math.min(16, Math.max(4, z0v)), Math.min(16, z0v + 2))) tiles.push(u.split("/").map(Number));
    if (tiles.length > PREFETCH_LIMIT) return alert(`タイル数が多すぎます（${tiles.length}枚）。もう少しズームインしてください`);
    if (!confirm(`地理院 Vector（最新データ）の表示範囲 ${tiles.length} 枚を端末に残します（自動キャッシュに入るため、容量が増えると古いものから消えます）。`)) return;
    try {
      await vtPrepareSource();
      const pm = new pmtiles.PMTiles(VT_PMTILES);
      let i = 0;
      for (const [z, x, y] of tiles) { try { await pm.getZxy(z, x, y); } catch {} statusEl.textContent = `地理院 Vector を保存中… ${++i}/${tiles.length}`; }
    } catch (e) { statusEl.textContent = "保存できませんでした：" + e.message; return; }
    if (!defs.length) { statusEl.textContent = `保存しました（地理院 Vector ${tiles.length} 枚）`; return; }
  }
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

/** 地点をまとめて入力：1 行 1 地点「緯度, 経度, 名称」→ メモを作る */
function parsePointLines(text) {
  const out = [], bad = [];
  text.split(/\r?\n/).forEach((line, i) => {
    const t = line.trim();
    if (!t || t.startsWith("#")) return;
    const m = t.normalize("NFKC").match(/^(-?\d+(?:\.\d+)?)\s*[,\t、\s]\s*(-?\d+(?:\.\d+)?)\s*(?:[,\t、\s]\s*(.*))?$/);
    if (!m) { bad.push(i + 1); return; }
    let a = Number(m[1]), b = Number(m[2]);
    const parts = [m[1], m[2], m[3] || ""];
    if (Math.abs(a) > 90 && Math.abs(b) <= 90) [a, b] = [b, a]; // 経度, 緯度 の順でも受け付ける
    if (Math.abs(a) > 90 || Math.abs(b) > 180) { bad.push(i + 1); return; }
    out.push({ lat: a, lon: b, name: parts.slice(2).join(", ").trim() });
  });
  return { points: out, bad };
}
function bulkPointsBox() {
  const ta = h("textarea", { rows: 5, placeholder: "35.4478, 139.6425, 横浜開港資料館\n35.4437, 139.6380, 山下公園\n（1 行 1 地点：緯度, 経度, 名称）" });
  const cat = h("select", {}, ...Settings.data.categories.map((c) => h("option", { value: c, selected: c === "要確認" }, c)));
  const status = h("div", { class: "note" });
  const go = async () => {
    const { points, bad } = parsePointLines(ta.value);
    if (!points.length) return (status.textContent = "読み取れる行がありません（緯度, 経度, 名称 の順）");
    if (!confirm(`${points.length} 地点をメモとして追加します${bad.length ? `（読めない行 ${bad.length}：${bad.slice(0, 8).join(", ")} 行目）` : ""}。`)) return;
    for (const p of points) {
      const m = newMemo({ lat: p.lat, lon: p.lon, source: "list" });
      m.title = p.name;
      m.category = cat.value;
      S.memos.set(m.id, m);
      await DB.put("memos", m);
      renderMarker(m);
      fillPlaceInfo(m.id);
    }
    updateCounts();
    ta.value = "";
    status.textContent = `${points.length} 地点を追加しました`;
    const b = L.latLngBounds(points.map((p) => [p.lat, p.lon]));
    setFollow(false);
    S.map.fitBounds(b.pad(0.2), { maxZoom: 16 });
  };
  return h("div", {}, ta, h("label", {}, "カテゴリ", cat), h("button", { type: "button", class: "btn secondary block", onclick: go }, "メモとして追加"), status,
    h("p", { class: "note" }, "区切りはカンマ・タブ・空白。経度, 緯度 の順でも自動で判定します。"));
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

  const inclPhotos = h("input", { type: "checkbox" });

  // GPX は端末によって種類（MIME）が認識されず選べないことがあるので、拡張子での絞り込みはしない
  const fileIn = h("input", { type: "file", multiple: true, hidden: true });
  fileIn.onchange = async () => {
    const files = Array.from(fileIn.files || []);
    fileIn.value = "";
    if (!files.length) return;
    closeSheet(true);
    for (const f of files) await importFile(f);
  };

  const proj = h("input", { type: "text", value: Settings.data.project, placeholder: "例：犬山城下町 2026秋" });
  const obs = h("input", { type: "text", value: Settings.data.observer, placeholder: "例：山田" });
  const cats = categoryManager(() => {});
  const psize = h("select", {}, ...Object.entries(PHOTO_SIZES).map(([v, t]) => h("option", { value: v, selected: String(Settings.data.photoSize) === v }, t)));
  const openForm = h("input", { type: "checkbox", checked: !!Settings.data.cameraOpenForm });
  const asrSel = h("select", {}, h("option", { value: "auto", selected: !Settings.data.asrModel || Settings.data.asrModel === "auto" }, "自動（GPU が使える端末は高精度）"),
    ...Object.entries(ASR_MODELS).map(([k, v]) => h("option", { value: k, selected: Settings.data.asrModel === k }, v.label)));
  const autoTr = h("input", { type: "checkbox", checked: Settings.data.autoTranscribe !== false });
  const proxyIn = h("input", { type: "text", value: Settings.data.corsProxy || "", placeholder: "例：https://example.workers.dev/?url={url}", inputmode: "url" });
  const saveSettings = () => {
    Settings.data.photoSize = psize.value;
    Settings.data.cameraOpenForm = openForm.checked;
    Settings.data.corsProxy = proxyIn.value.trim();
    Settings.data.asrModel = asrSel.value;
    Settings.data.autoTranscribe = autoTr.checked;
    Settings.data.project = proj.value.trim();
    Settings.data.observer = obs.value.trim();
    Settings.save();
    for (const m of S.memos.values()) renderMarker(m);
    toast("設定を保存しました");
  };

  const prefStatus = h("div", { class: "note" });

  const last = Settings.data.lastExportAt;
  const TABS = [["save", "保存・印刷"], ["load", "読み込み"], ["settings", "設定"]];
  // 見出し付きのまとまり（カード）・長い説明は畳む
  const sec = (title, sub, ...kids) => h("section", { class: "msec" }, h("div", { class: "msec-h" }, h("h3", {}, title), sub ? h("p", {}, sub) : null), ...kids);
  const sub = (t) => h("div", { class: "msec-sub" }, t);
  const hint = (t) => h("details", { class: "hint" }, h("summary", {}, "くわしく"), h("p", {}, t));
  const xrow = (label, desc, kind) => h("div", { class: "xrow" },
    h("div", { class: "xlab" }, h("b", {}, label), h("small", {}, desc)),
    h("div", { class: "xbtn" },
      h("button", { class: "btn secondary", type: "button", onclick: () => doExport(kind, "download", inclPhotos.checked) }, "保存"),
      canShare ? h("button", { class: "btn secondary", type: "button", onclick: () => doExport(kind, "share", inclPhotos.checked) }, "共有") : null));
  const stat = (n, unit, label) => h("div", { class: "stat" }, h("b", {}, String(n)), h("small", {}, `${unit}・${label}`));
  const dirty = !$("#unsaved-badge").hidden;
  const panes = {
    save: h("div", {},
      sec("データの概要", null,
        h("div", { class: "stats" }, stat(S.memos.size, "件", "メモ"), stat(photoCount, "枚", "写真"), stat(tracks.length, "本", "軌跡")),
        h("div", { class: "msec-meta" + (dirty ? " warn-text" : "") }, `最終書き出し：${last ? fmtDate(last) : "なし"}${dirty ? "（その後に追加・変更あり）" : ""}　端末内の容量：${usage || "—"}`)),
      sec("バックアップ", "このアプリで読み戻せる、すべてのデータの保存",
        xrow("ZIP（JSON＋写真）", "おすすめ。写真・録音もファイルのまま入る", "zip"),
        xrow("JSON（全データ）", "1 つのテキストファイル", "json"),
        h("label", { class: "inline", style: "margin:8px 0 0;font-size:13.5px" }, inclPhotos, "JSON に写真を埋め込む（ファイルが大きくなります）"),
        photoQualityPicker(),
        hint("ZIP の中身：data.json（全データ）・memos.geojson・memos.csv・tracks.gpx・photos/（写真ファイル）。写真の画質を「元のまま」以外にすると、書き出す写真だけを縮めます（端末の写真はそのまま。縮めた写真は位置などの EXIF が消えますが、位置はメモに残っています）。写真が多くて ZIP が大きくなりすぎるときに。JSON は写真を埋め込んだ場合だけ写真も復元できます。端末内のデータはブラウザのデータ消去で失われるため、調査の区切りごとに書き出してください。iPhone では「共有」→「ファイルに保存」が確実です。")),
      sec("ほかのアプリ向け", "メモと軌跡を、よく使う形式で書き出す",
        xrow("GeoJSON", "QGIS などの GIS", "geojson"),
        xrow("CSV", "Excel などの表計算", "csv"),
        xrow("GPX", "登山・GPS アプリ", "gpx")),
      sec("印刷・PDF・画像", "用紙と縮尺を選び、地図の上の枠で範囲を合わせる",
        h("button", { class: "btn primary block", type: "button", onclick: openPrint }, "範囲を決めて印刷・PDF・画像に出力"),
        hint("方位記号・スケールバー・凡例を入れられ、印刷するレイヤやメモ・軌跡も選べます。範囲は Vector Studio の範囲ファイルで保存・読み込みできます。")),
      sec("オフライン", "電波のない場所に行く前に、地図を端末に保存",
        h("div", { class: "menu-grid" },
          h("button", { class: "btn secondary", type: "button", onclick: () => prefetchTiles(prefStatus) }, "表示範囲を保存"),
          h("button", { class: "btn secondary", type: "button", onclick: async () => {
            if (!confirm("保存した地図タイル（自動キャッシュ含む）を削除しますか？メモは消えません。")) return;
            await caches.delete("fn-tiles-saved");
            await caches.delete("fn-tiles-rt");
            toast("地図キャッシュを削除しました");
          } }, "保存した地図を削除")),
        prefStatus,
        hint("一度表示した地図は自動で端末に残り、電波が弱い場所でも表示できます。山間部などに行く前に、Wi-Fi 環境で対象範囲を表示して「表示範囲を保存」しておくと安心です（今のズームから 2 段階拡大した分まで）。"))),
    load: h("div", {},
      sec("メモ・軌跡を読み込む", "ZIP・JSON・GeoJSON・GPX",
        h("button", { class: "btn secondary block", type: "button", onclick: () => fileIn.click() }, "ファイルを選ぶ"), fileIn,
        hint("同じ ID のメモは更新日時が新しい方を採用します。別の端末で記録したデータの統合にも使えます。GPX（GPSLogger など GPS ロガーアプリの記録）は軌跡として、GPX 内の地点はメモとして取り込みます。複数ファイルをまとめて選べます。")),
      sec("地点をまとめて入力", "「緯度, 経度, 名称」を 1 行ずつ貼り付けてメモにする", bulkPointsBox()),
      sec("写真をまとめて読み込む", "撮影位置（位置情報）付きの写真から、その場所に写真メモを作る", exifImportBox()),
      sec("地図に重ねる", "メモにはせず、地図の上に表示だけする",
        sub("ファイルから"),
        h("button", { class: "btn secondary block", type: "button", onclick: openImImport }, "GeoJSON・KML・.gsf・GeoParquet・基盤地図情報"),
        sub("API・オープンデータから"),
        h("div", { class: "menu-grid" },
          h("button", { class: "btn secondary", type: "button", onclick: openReinfoSheet }, "不動産情報ライブラリ"),
          h("button", { class: "btn secondary", type: "button", onclick: openEstatSheet }, "e-Stat 統計")),
        h("button", { class: "btn secondary block", type: "button", style: "margin-top:8px", onclick: openGreenSheet }, "東京都 緑のオープンデータ"),
        h("button", { class: "btn link block", type: "button", style: "margin-top:6px", onclick: openDataSheet }, "重ねたデータを管理する（表示・透明度・削除）"))),
    settings: h("div", {},
      sec("調査", "書き出すファイル名とメモに記録されます",
        h("label", {}, "調査名", proj),
        h("label", {}, "記録者", obs)),
      sec("カテゴリ", "名前・色・並び順を変えられます（すぐ反映）", cats),
      sec("地図のピン", null,
        h("div", { class: "opt-rows" }, colorBySeg(), photoPinsSeg(), clusterSeg()),
        hint(`色分け：カテゴリ別か、記録者（ほかの人から取り込んだデータ）別か。地図に写真を表示：写真はズーム 15 以上で出ます。お気に入りの写真は引くと小さくなり、ズーム 13 以下ではほかと同じピンになります。重なるピン：引きの地図（ズーム ${CL_MAX_ZOOM} 未満）で、重なるピンを件数の丸にまとめて地図を軽くします（自動はメモ ${CL_AUTO_MIN} 件以上のとき）。丸を押すとその範囲へ拡大します。`)),
      sec("GPS・方位の補正", "必要なときだけ。現在地ボタンの長押しでも開けます", h("button", { class: "btn secondary block", type: "button", onclick: openGpsCalib }, "補正の設定を開く"),
        h("div", { class: "msec-meta" }, (() => { const g = gpsCfg(); return [g.offset ? `位置の補正：北 ${g.offset.n} m・東 ${g.offset.e} m` : "", g.avgSec ? `平均化 ${g.avgSec} 秒` : "", g.maxAcc ? `±${g.maxAcc} m より悪い測位は使わない` : "", g.compass ? `方位 ${g.compass > 0 ? "+" : ""}${g.compass}°` : ""].filter(Boolean).join("・") || "補正なし"; })())),
      sec("写真・聞き取り", null,
        h("label", {}, "写真の保存サイズ（端末内）", psize),
        h("label", { class: "inline", style: "margin-top:10px" }, openForm, "撮影後にメモ入力を開く"),
        h("label", {}, "録音から書き起こすモデル（端末内で処理）", asrSel),
        h("label", { class: "inline", style: "margin-top:10px" }, autoTr, "その場で文字にできなかった録音は、録音後に自動で書き起こす")),
      sec("詳細設定", null,
        h("label", {}, "PDF を URL で読み込むときの CORS プロキシ（任意・{url} が元の URL に置き換わる）", proxyIn)),
      h("div", { class: "msave" }, h("button", { class: "btn primary block", type: "button", onclick: saveSettings }, "設定を保存")),
      sec("使い方", null,
        h("p", { class: "note", style: "margin:0" },
          "画面の長押しでその地点にメモ／十字線ボタンで中心十字線を表示し、十字線の位置にメモ／「撮影」で写真を撮るとその場所に写真メモができ、地図上にサムネイルが出ます（ズーム15以上）。座標は WGS84（世界測地系）の緯度経度。標高は国土地理院の標高タイル（1m があればその値、なければ 5m・10m）または標高 API による値で、GPS高度とは別に記録されます。")),
      h("section", { class: "msec danger-zone" }, h("div", { class: "msec-h" }, h("h3", {}, "データの消去"), h("p", {}, "メモ・写真・録音・軌跡を端末から消します（元に戻せません）")),
        h("button", { class: "btn danger block", type: "button", onclick: async () => {
          if (!confirm("全てのメモ・写真・軌跡を端末から削除します。書き出し済みか確認してください。")) return;
          if (!confirm("本当に削除しますか？元に戻せません。")) return;
          await DB.clear("memos"); await DB.clear("photos"); await DB.clear("tracks"); await DB.clear("audios");
          for (const l of S.shownTracks.values()) S.map.removeLayer(l);
          S.shownTracks.clear();
          await loadMemos();
          closeSheet(true);
          toast("全データを削除しました");
        } }, "全データを削除"))),
  };
  let cur = "save";
  try { const t = localStorage.getItem("fn.menuTab"); if (panes[t]) cur = t; } catch {}
  const tabBar = h("div", { class: "menu-tabs", role: "tablist" });
  const paneBox = h("div", { class: "menu-pane" });
  const show = (k) => {
    cur = k;
    try { localStorage.setItem("fn.menuTab", k); } catch {}
    tabBar.querySelectorAll("button").forEach((b) => { b.classList.toggle("on", b.dataset.k === k); b.setAttribute("aria-selected", b.dataset.k === k); });
    paneBox.replaceChildren(panes[k]);
    $("#sheet-body").scrollTop = 0;
  };
  for (const [k, t] of TABS) tabBar.append(h("button", { type: "button", role: "tab", "data-k": k, onclick: () => show(k) }, t));
  const body = h("div", {}, tabBar, paneBox);
  show(cur);
  openSheet("保存・設定", body, { height: "86vh" });
}

/* ====================================================================
 * カメラ：撮影するとその場所に写真メモを作り、写真は端末内（IndexedDB）に保存
 * ==================================================================== */
let camCtx = null;
function startCamera() {
  // ボタンを押した時点の状況も控えておく（撮影から戻ったときに GPS が無い場合の予備）
  camCtx = { pos: S.pos ? { ...S.pos } : null, heading: S.heading, center: S.map.getCenter(), t: Date.now() };
  $("#camera-input").click(); // ユーザー操作の中で同期的に呼ぶ必要がある
  const DOE = window.DeviceOrientationEvent;
  if (!orientationStarted && !(DOE && typeof DOE.requestPermission === "function")) startOrientation();
}

async function onCameraPhotos() {
  const input = $("#camera-input");
  const files = Array.from(input.files || []);
  input.value = "";
  if (!files.length) return;
  const ctx = camCtx || { center: S.map.getCenter() };
  const fresh = S.pos && Date.now() - S.pos.t < 60000 ? S.pos : null;
  const p = fresh || ctx.pos;
  const loc = p ? { lat: p.lat, lon: p.lon, source: "gps" } : { lat: ctx.center.lat, lon: ctx.center.lng, source: "map" };
  if (!p) toast("現在地が取れていないため、地図の中心に記録します");

  toast("写真を保存中…", 20000);
  const memo = newMemo(loc);
  if (p) {
    memo.accuracy = Math.round(p.acc * 10) / 10;
    memo.gpsAltitude = p.alt != null ? Math.round(p.alt * 10) / 10 : null;
  }
  memo.kind = "photo";
  memo.category = PHOTO_CATEGORY;
  const hd = S.heading ?? ctx.heading;
  memo.heading = hd != null ? Math.round(hd) : null;
  const photos = [];
  try {
    for (const [i, f] of files.entries()) photos.push({ id: uuid(), memoId: memo.id, order: i, ...(await processPhoto(f)) });
    memo.photoCount = photos.length;
    for (const ph of photos) await DB.put("photos", ph);
    await DB.put("memos", memo);
  } catch (e) {
    alert("写真を保存できませんでした：" + e.message + "\n（端末の空き容量を確認してください）");
    return;
  }
  S.memos.set(memo.id, memo);
  S.memoThumb.set(memo.id, photos[0]);
  updateCounts();
  // 写真が地図上に見えるようにする
  if (S.map.getZoom() < THUMB_ZOOM || !S.map.getBounds().contains([memo.lat, memo.lon])) {
    S.map.setView([memo.lat, memo.lon], Math.max(S.map.getZoom(), THUMB_ZOOM));
  }
  S.thumbMode = S.map.getZoom() >= THUMB_ZOOM;
  renderMarker(memo);
  toast(`写真メモ #${memo.no} を保存しました${photos.length > 1 ? `（${photos.length}枚）` : ""}`);
  if (Settings.data.cameraOpenForm) openMemoForm(memo);
  else setTimeout(() => S.markers.get(memo.id)?.openPopup(), 300);
  fillPlaceInfo(memo.id);
}

/** 標高・住所を後から取得してメモに書き足す */
async function fillPlaceInfo(id) {
  const m = S.memos.get(id);
  if (!m) return;
  const [e, a] = await Promise.all([fetchElevation(m.lat, m.lon), reverseGeocode(m.lat, m.lon)]);
  const cur = S.memos.get(id);
  if (!cur || cur.lat !== m.lat || cur.lon !== m.lon) return;
  Object.assign(cur, { elevation: e ? e.value : null, elevationSrc: e ? e.src : null, address: a });
  await DB.put("memos", cur);
}

/* ====================================================================
 * 写真ビューア（全画面）
 * ==================================================================== */
const V = { items: [], idx: 0, url: null, opts: {} };
function openViewer(items, idx = 0, opts = {}) {
  if (!items.length) return;
  V.items = items;
  V.opts = opts;
  if (!opts.playback) { $("#viewer").classList.remove("playback"); $("#v-pb").hidden = true; }
  $("#viewer").hidden = false;
  showViewer(idx);
}
function showViewer(idx) {
  V.idx = (idx + V.items.length) % V.items.length;
  const { photo, memo } = V.items[V.idx];
  if (V.url) URL.revokeObjectURL(V.url);
  V.url = null;
  const img = $("#v-img"), card = $("#v-card");
  vzReset();
  if (photo) {
    V.url = URL.createObjectURL(photo.blob);
    img.src = V.url;
    img.hidden = false;
    card.hidden = true;
  } else {
    // 写真のないメモ（プレイバック）：文字のカード
    img.removeAttribute("src");
    img.hidden = true;
    card.hidden = false;
    card.replaceChildren(
      h("div", { class: "vc-cat" }, h("i", { style: `background:${memoColor(memo)}` }), memo.category || ""),
      h("div", { class: "vc-title" }, `#${memo.no ?? ""} ${memo.title || "（無題）"}`),
      memo.note ? h("div", { class: "vc-note" }, memo.note) : null,
      h("div", { class: "vc-meta" }, [fmtDate(memo.createdAt), memo.address || "", (memo.tags || []).map((t) => "#" + t).join(" ")].filter(Boolean).join("　")));
  }
  $("#v-title").textContent = `#${memo.no ?? ""} ${memo.title || (memo.kind === "photo" ? "写真" : "（無題）")}`;
  $("#v-meta").textContent = photo
    ? [fmtDate(photo.takenAt || memo.createdAt), V.opts.playback ? memo.category || "" : `${photo.width}×${photo.height}`, V.opts.playback ? "" : `${(photo.blob.size / 1048576).toFixed(1)} MB`,
      memo.heading != null ? `撮影方向 ${memo.heading}°（${dirName(memo.heading)}）` : ""].filter(Boolean).join("　")
    : "写真のないメモ";
  $("#v-count").textContent = V.items.length > 1 ? `${V.idx + 1} / ${V.items.length}` : "";
  $("#v-count").hidden = V.items.length < 2;
  $("#v-jump")?.remove();
  $("#v-prev").hidden = $("#v-next").hidden = V.items.length < 2;
  $("#v-map").hidden = $("#v-edit").hidden = !!V.opts.readonly;
  $("#v-save").hidden = !photo;
  if (V.opts.playback) {
    // 次に「見返す」で入ったとき、ここから続けられるように
    Settings.data.pbLast = { memoId: memo.id, photoId: photo ? photo.id : null };
    Settings.save();
    pbRender();
  }
}
function closeViewer() {
  $("#viewer").hidden = true;
  $("#v-img").removeAttribute("src");
  if (V.url) URL.revokeObjectURL(V.url);
  V.url = null;
  if (V.opts.playback) {
    pbStop();
    // 一覧から開いたときは一覧に戻る。地図から開いたときは、最後に見ていたメモの場所へ地図を寄せる
    const memo = V.items[V.idx]?.memo;
    if ($("#sheet").hidden && memo && S.memos.has(memo.id)) { setFollow(false); S.map.setView([memo.lat, memo.lon], Math.max(S.map.getZoom(), 16)); }
  }
  $("#viewer").classList.remove("playback", "bare");
  $("#v-catpick")?.remove();
  $("#v-jump")?.remove();
  $("#v-pb").hidden = true;
  $("#v-img").hidden = false;
  $("#v-card").hidden = true;
}

/* ====================================================================
 * プレイバック：メモと写真を番号順に、スライドショーのように見返す（左右スワイプ・自動再生）。
 * 「お気に入り」を付けると、そのメモの「地図で大きく表示」をオンにする（初めは 3 倍）
 * ==================================================================== */
const PB = { memos: [], favOnly: false, timer: 0, sec: 4 };
/**
 * 見返す画面を開く。memos の順のまま（一覧の並び順。「見返す」ボタンは番号順にしてから呼ぶ。省略時は全メモを番号順）。
 * photosOnly：写真だけ（写真の一覧から）。startPhotoId：この写真から。startMemoId：このメモ（の先頭の写真）から。
 * resume：前回の見返す画面で最後に見ていた写真・メモから（なければ先頭）
 */
async function openPlayback(memos = [...S.memos.values()].sort((a, b) => (a.no || 0) - (b.no || 0)), { photosOnly = false, startPhotoId = null, startMemoId = null, resume = false } = {}) {
  PB.memos = memos.slice();
  PB.photosOnly = photosOnly;
  PB.favOnly = false;
  const items = await pbItems();
  if (!items.length) return toast(photosOnly ? "写真がありません" : "見返すメモがありません");
  let start = 0;
  const last = Settings.data.pbLast;
  if (startPhotoId) start = items.findIndex((it) => it.photo?.id === startPhotoId);
  else if (startMemoId) start = items.findIndex((it) => it.memo.id === startMemoId);
  else if (resume && last) {
    start = items.findIndex((it) => (last.photoId ? it.photo?.id === last.photoId : !it.photo && it.memo.id === last.memoId));
    if (start < 0) start = items.findIndex((it) => it.memo.id === last.memoId); // 写真が消えたなど
    if (start > 0) toast(`前回の続き（#${items[start].memo.no ?? ""}）から。再生モードの「最初から」で先頭へ`, 2500);
  }
  start = Math.max(0, start);
  $("#viewer").classList.add("playback");
  $("#v-pb").hidden = false;
  openViewer(items, start, { playback: true });
}
async function pbItems() {
  const items = [];
  for (const m of PB.memos) {
    const cur = S.memos.get(m.id) || m;
    if (PB.favOnly && !cur.featured) continue;
    const ph = (await DB.byIndex("photos", "memoId", m.id)).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    if (ph.length) ph.forEach((photo, i) => items.push({ photo, memo: cur, pi: i, pn: ph.length }));
    else if (!PB.favOnly && !PB.photosOnly) items.push({ photo: null, memo: cur });
  }
  return items;
}
function pbRender() {
  const it = V.items[V.idx];
  const m = S.memos.get(it.memo.id) || it.memo;
  const note = (m.note || "").replace(/\s+/g, " ");
  const catBtn = h("button", { type: "button", class: "pb-cat", "aria-label": "カテゴリを変える" }, h("i", { style: `background:${catColor(m.category)}` }), m.category || "カテゴリなし", h("span", { class: "pb-caret" }, "変える"));
  catBtn.onclick = (e) => { e.stopPropagation(); pbCatPicker(m); };
  $("#v-pb-text").replaceChildren(
    h("div", { class: "pb-line" }, h("b", {}, `#${m.no ?? ""} ${m.title || "（無題）"}`),
      it.pn > 1 ? h("span", { class: "pb-sub" }, `写真 ${it.pi + 1}/${it.pn}`) : null),
    h("div", { class: "pb-line2" }, catBtn),
    it.photo && note ? h("div", { class: "pb-note" }, note) : "");
  $("#v-first").disabled = V.idx === 0;
  const fav = $("#v-fav"), size = $("#v-fav-size");
  // お気に入り（＝地図で大きく表示）は写真のあるメモだけ
  fav.hidden = !it.photo;
  fav.classList.toggle("on", !!m.featured);
  fav.textContent = m.featured ? "お気に入り済み" : "お気に入り";
  fav.setAttribute("aria-pressed", m.featured ? "true" : "false");
  size.replaceChildren(...(it.photo && m.featured ? [2, 3, 4].map((k) => {
    const b = h("button", { type: "button", class: "v-btn sz" + (Number(m.featured) === k ? " on" : "") }, `${k}倍`);
    b.onclick = (e) => { e.stopPropagation(); pbSetFav(m, k); };
    return b;
  }) : []));
  // 再生モード（アイコン）：使えないときは押せなくする（並びは変えない）
  $("#v-favonly").disabled = PB.memos.length < 2;
  $("#v-play").disabled = V.items.length < 2;
  $(".v-mode").hidden = V.items.length < 2 && PB.memos.length < 2;
  $("#v-favonly").classList.toggle("on", PB.favOnly);
  $("#v-favonly").setAttribute("aria-pressed", PB.favOnly ? "true" : "false");
  $("#v-play").classList.toggle("on", !!PB.timer);
  $("#v-play").setAttribute("aria-pressed", PB.timer ? "true" : "false");
  const playLab = PB.timer ? "自動再生を止める" : "自動再生";
  $("#v-play").title = playLab;
  $("#v-play").setAttribute("aria-label", playLab);
}
/** 見返す画面からカテゴリを変える */
function pbCatPicker(memo) {
  pbStop();
  $("#v-catpick")?.remove();
  const close = () => box.remove();
  const choose = async (c) => {
    const m = S.memos.get(memo.id);
    if (!m) return close();
    if (m.category !== c) {
      m.category = c;
      m.updatedAt = nowIso();
      await DB.put("memos", m);
      for (const it of V.items) if (it.memo.id === m.id) it.memo = m;
      renderMarker(m);
      updateCounts();
      listRefresh?.();
      toast(`#${m.no} のカテゴリを「${c}」にしました`, 1600);
    }
    close();
    pbRender();
    vRefreshMeta();
  };
  const cats = Settings.data.categories.slice();
  if (memo.category && !cats.includes(memo.category)) cats.push(memo.category);
  const box = h("div", { id: "v-catpick", role: "dialog", "aria-label": "カテゴリを選ぶ" },
    h("div", { class: "vcp-panel" },
      h("div", { class: "vcp-head" }, h("b", {}, `#${memo.no ?? ""} のカテゴリ`), h("button", { type: "button", class: "v-btn", "aria-label": "閉じる", onclick: close }, "✕")),
      h("div", { class: "vcp-list" }, ...cats.map((c) => h("button", { type: "button", class: "vcp-item" + (c === memo.category ? " on" : ""), onclick: () => choose(c) }, h("i", { style: `background:${catColor(c)}` }), c))),
      h("button", { type: "button", class: "vcp-add", onclick: () => { const n = prompt("新しいカテゴリの名前"); const c = catAdd(n); if (c) choose(c); } }, "＋ 新しいカテゴリ")));
  box.onclick = (e) => { if (e.target === box) close(); };
  $("#viewer").append(box);
}
/** 番号を指定して移動：順番（何枚目）・メモの番号（#）・つまみで */
function vJumpPanel() {
  if (V.items.length < 2) return;
  if ($("#v-jump")) return $("#v-jump").remove();
  pbStop();
  const N = V.items.length;
  const label = (i) => {
    const it = V.items[i], m = S.memos.get(it.memo.id) || it.memo;
    return `${i + 1} / ${N}　#${m.no ?? ""} ${m.title || "（無題）"}${it.pn > 1 ? `（写真 ${it.pi + 1}/${it.pn}）` : it.photo ? "" : "（写真なし）"}`;
  };
  const prev = h("div", { class: "vj-label" }, label(V.idx));
  const slider = h("input", { type: "range", min: "1", max: String(N), step: "1", value: String(V.idx + 1), "aria-label": "順番" });
  const pos = h("input", { type: "number", min: "1", max: String(N), value: String(V.idx + 1), inputmode: "numeric", enterkeyhint: "go" });
  const cur = S.memos.get(V.items[V.idx].memo.id) || V.items[V.idx].memo;
  const nos = [...new Set(V.items.map((it) => it.memo.no).filter((x) => x != null))];
  const no = h("input", { type: "number", min: String(Math.min(...nos)), max: String(Math.max(...nos)), value: cur.no ?? "", inputmode: "numeric", enterkeyhint: "go" });
  const close = () => box.remove();
  const go = (i) => { close(); if (i !== V.idx) showViewer(i); };
  slider.oninput = () => { prev.textContent = label(Number(slider.value) - 1); pos.value = slider.value; };
  slider.onchange = () => go(Number(slider.value) - 1);
  const goPos = () => {
    const n = Math.round(Number(pos.value));
    if (!(n >= 1 && n <= N)) return toast(`1〜${N} の数字を入れてください`);
    go(n - 1);
  };
  const goNo = () => {
    const n = Math.round(Number(no.value));
    const i = V.items.findIndex((it) => it.memo.no === n);
    if (i < 0) return toast(`#${no.value} は今見ている中にありません（絞り込みや「写真だけ」で外れているかもしれません）`, 3000);
    go(i);
  };
  pos.onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); goPos(); } };
  no.onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); goNo(); } };
  pos.oninput = () => { const n = Math.round(Number(pos.value)); if (n >= 1 && n <= N) { slider.value = String(n); prev.textContent = label(n - 1); } };
  no.oninput = () => { const i = V.items.findIndex((it) => it.memo.no === Math.round(Number(no.value))); if (i >= 0) prev.textContent = label(i); };
  const box = h("div", { id: "v-jump", role: "dialog", "aria-label": "番号を指定して移動" },
    h("div", { class: "vcp-panel" },
      h("div", { class: "vcp-head" }, h("b", {}, "番号を指定して移動"), h("button", { type: "button", class: "v-btn", "aria-label": "閉じる", onclick: close }, "✕")),
      prev, slider,
      h("div", { class: "vj-rows" },
        h("label", { class: "vj-row" }, h("span", {}, "順番"), pos, h("span", { class: "vj-unit" }, `/ ${N}`), h("button", { type: "button", class: "v-btn wide", onclick: goPos }, "移動")),
        h("label", { class: "vj-row" }, h("span", {}, "メモ番号 #"), no, h("span", { class: "vj-unit" }), h("button", { type: "button", class: "v-btn wide", onclick: goNo }, "移動")))));
  box.onclick = (e) => { if (e.target === box) close(); };
  $("#viewer").append(box);
}
/** 上の帯の説明（日時・カテゴリなど）だけを書き直す（拡大はそのまま） */
function vRefreshMeta() {
  const { photo, memo } = V.items[V.idx];
  const m = S.memos.get(memo.id) || memo;
  if (photo) $("#v-meta").textContent = [fmtDate(photo.takenAt || m.createdAt), m.category || "", m.heading != null ? `撮影方向 ${m.heading}°（${dirName(m.heading)}）` : ""].filter(Boolean).join("　");
  else {
    const cat = $("#v-card .vc-cat");
    if (cat) cat.replaceChildren(h("i", { style: `background:${memoColor(m)}` }), m.category || "");
  }
}
/** お気に入りにする／外す。k：大きさ（2〜4 倍）。null で外す */
async function pbSetFav(memo, k) {
  const m = S.memos.get(memo.id);
  if (!m) return;
  if (k) m.featured = k;
  else delete m.featured;
  m.updatedAt = nowIso();
  await DB.put("memos", m);
  for (const it of V.items) if (it.memo.id === m.id) it.memo = m;
  renderMarker(m);
  pbRender();
  listRefresh?.();
  toast(k ? `#${m.no} をお気に入りにしました（地図で ${k} 倍に表示）` : `#${m.no} をお気に入りから外しました`, 1800);
}
function pbStop() { clearInterval(PB.timer); PB.timer = 0; if (V.opts.playback && !$("#viewer").hidden) pbRender(); }
function pbToggleAuto() {
  if (PB.timer) return pbStop();
  if (V.idx >= V.items.length - 1) showViewer(0); // 最後で押したら最初から
  PB.timer = setInterval(() => {
    if (VZ.s > 1.01) return; // 拡大して見ている間は進めない
    if (V.idx >= V.items.length - 1) return pbStop();
    showViewer(V.idx + 1);
  }, PB.sec * 1000);
  pbRender();
}
async function pbToggleFavOnly() {
  const curId = V.items[V.idx]?.memo.id;
  PB.favOnly = !PB.favOnly;
  const items = await pbItems();
  if (!items.length) { PB.favOnly = false; pbRender(); return toast("お気に入りのメモはまだありません"); }
  V.items = items;
  const i = items.findIndex((it) => it.memo.id === curId);
  showViewer(i >= 0 ? i : 0);
}
function bindViewer() {
  $("#v-close").onclick = closeViewer;
  $("#v-fav").onclick = () => { const m = S.memos.get(V.items[V.idx].memo.id); if (m) pbSetFav(m, m.featured ? null : 3); };
  $("#v-play").onclick = pbToggleAuto;
  $("#v-favonly").onclick = pbToggleFavOnly;
  $("#v-first").onclick = () => showViewer(0);
  $("#v-count").onclick = vJumpPanel;
  $("#v-prev").onclick = () => showViewer(V.idx - 1);
  $("#v-next").onclick = () => showViewer(V.idx + 1);
  bindViewerZoom();
  $("#v-zin").onclick = () => vzZoomAt(0, 0, VZ.s * 1.6);
  $("#v-zout").onclick = () => vzZoomAt(0, 0, VZ.s / 1.6);
  $("#v-map").onclick = () => {
    const { memo } = V.items[V.idx];
    closeViewer();
    closeSheet(true);
    setFollow(false);
    S.map.setView([memo.lat, memo.lon], Math.max(S.map.getZoom(), 17));
    setTimeout(() => S.markers.get(memo.id)?.openPopup(), 300);
  };
  $("#v-edit").onclick = () => {
    const { memo } = V.items[V.idx];
    closeViewer();
    const m = S.memos.get(memo.id);
    if (m) openMemoForm(m);
  };
  $("#v-save").onclick = () => {
    // iPhone は共有シートの「画像を保存」で写真アプリへ、Android は共有またはダウンロード
    const { photo, memo } = V.items[V.idx];
    const mime = photo.mime || photo.blob.type || "image/jpeg";
    const name = `fieldnote_memo${String(memo.no).padStart(3, "0")}_${V.idx + 1}.${extOf(mime)}`;
    const canShare = navigator.canShare && navigator.canShare({ files: [new File([photo.blob], name, { type: mime })] });
    deliverBlob(photo.blob, name, mime, canShare ? "share" : "download");
  };
  document.addEventListener("keydown", (e) => {
    if ($("#viewer").hidden) return;
    if (e.target.closest?.("#v-jump, #v-catpick")) { if (e.key === "Escape") e.target.closest("#v-jump, #v-catpick").remove(); return; }
    if (e.key === "Escape") closeViewer();
    else if (e.key === "+" || e.key === "=") vzZoomAt(0, 0, VZ.s * 1.6);
    else if (e.key === "-") vzZoomAt(0, 0, VZ.s / 1.6);
    else if (e.key === "0") vzReset();
    else if (V.opts.playback && e.key === " ") { e.preventDefault(); pbToggleAuto(); }
    else if (V.opts.playback && (e.key === "f" || e.key === "F")) $("#v-fav").click();
    else if (e.key === "ArrowLeft") showViewer(V.idx - 1);
    else if (e.key === "ArrowRight") showViewer(V.idx + 1);
  });
}

/* ---------- 写真の拡大：2 本指でつまむ・2 回タップ・ホイール・ボタン。拡大中は 1 本指で動かす ---------- */
const VZ = { s: 1, x: 0, y: 0, ptrs: new Map(), g: null, tap: null, lastTap: null, tapT: 0 };
/** 等倍（写真の 1 ピクセル＝画面の 1 ピクセル）の 3 倍まで。小さい写真でも 4 倍までは拡大できる */
function vzMax() {
  const img = $("#v-img");
  const fit = img.clientWidth ? img.naturalWidth / img.clientWidth : 1;
  return Math.max(4, Math.min(12, fit * 3));
}
function vzApply(anim = false) {
  const img = $("#v-img"), st = $("#v-stage");
  // 写真が画面からはみ出さないように（拡大しているときは端まで動かせる）
  const mx = Math.max(0, (img.clientWidth * VZ.s - st.clientWidth) / 2), my = Math.max(0, (img.clientHeight * VZ.s - st.clientHeight) / 2);
  VZ.x = Math.max(-mx, Math.min(mx, VZ.x));
  VZ.y = Math.max(-my, Math.min(my, VZ.y));
  img.style.transition = anim ? "transform .18s ease-out" : "none";
  img.style.transform = `translate(${VZ.x}px, ${VZ.y}px) scale(${VZ.s})`;
  st.classList.toggle("zoomed", VZ.s > 1.01);
  $("#v-zoom").textContent = VZ.s > 1.01 ? `${Math.round(VZ.s * 100)}%` : "";
}
function vzReset(anim = false) { VZ.s = 1; VZ.x = 0; VZ.y = 0; vzApply(anim); }
/** 画面の中心からの位置 (cx, cy) を動かさずに倍率を ns に */
function vzZoomAt(cx, cy, ns, anim = true) {
  if ($("#v-img").hidden) return; // 文字のカードは拡大しない
  ns = Math.max(1, Math.min(vzMax(), ns));
  VZ.x = cx - ((cx - VZ.x) * ns) / VZ.s;
  VZ.y = cy - ((cy - VZ.y) * ns) / VZ.s;
  VZ.s = ns;
  if (ns <= 1.001) { VZ.x = 0; VZ.y = 0; }
  vzApply(anim);
}
function bindViewerZoom() {
  const st = $("#v-stage");
  const rel = (e) => { const r = st.getBoundingClientRect(); return [e.clientX - r.left - r.width / 2, e.clientY - r.top - r.height / 2]; };
  st.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    st.setPointerCapture(e.pointerId);
    VZ.ptrs.set(e.pointerId, rel(e));
    if (VZ.ptrs.size === 2) {
      const [a, b] = [...VZ.ptrs.values()];
      VZ.g = { d: Math.hypot(a[0] - b[0], a[1] - b[1]) || 1, m: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], s: VZ.s, x: VZ.x, y: VZ.y };
      VZ.tap = null;
    } else if (VZ.ptrs.size === 1) {
      const p = rel(e);
      VZ.g = { p, x: VZ.x, y: VZ.y };
      VZ.tap = { p, t: Date.now(), moved: false };
    }
  });
  st.addEventListener("pointermove", (e) => {
    if (!VZ.ptrs.has(e.pointerId)) return;
    const p = rel(e);
    VZ.ptrs.set(e.pointerId, p);
    if (VZ.ptrs.size === 2 && VZ.g?.d && !$("#v-img").hidden) {
      const [a, b] = [...VZ.ptrs.values()];
      const d = Math.hypot(a[0] - b[0], a[1] - b[1]), m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      const ns = Math.max(1, Math.min(vzMax(), (VZ.g.s * d) / VZ.g.d));
      // つまんだ点の下の写真の位置を指に合わせて動かす
      VZ.x = m[0] - ((VZ.g.m[0] - VZ.g.x) * ns) / VZ.g.s;
      VZ.y = m[1] - ((VZ.g.m[1] - VZ.g.y) * ns) / VZ.g.s;
      VZ.s = ns;
      vzApply();
    } else if (VZ.ptrs.size === 1 && VZ.g?.p) {
      const dx = p[0] - VZ.g.p[0], dy = p[1] - VZ.g.p[1];
      if (VZ.tap && Math.hypot(dx, dy) > 8) VZ.tap.moved = true;
      if (VZ.s > 1.01) { VZ.x = VZ.g.x + dx; VZ.y = VZ.g.y + dy; vzApply(); }
    }
  });
  const end = (e) => {
    if (!VZ.ptrs.has(e.pointerId)) return;
    const p = rel(e);
    VZ.ptrs.delete(e.pointerId);
    if (VZ.ptrs.size === 1) { // 2 本指のあと 1 本残ったら、そこから動かす
      const [q] = VZ.ptrs.values();
      VZ.g = { p: q, x: VZ.x, y: VZ.y };
      return;
    }
    if (VZ.ptrs.size) return;
    if (VZ.s < 1.02) vzReset(true);
    const tap = VZ.tap;
    VZ.tap = null;
    if (!tap) return;
    const dx = p[0] - tap.p[0], dy = p[1] - tap.p[1];
    // 拡大していないときの横スワイプで前後の写真
    if (VZ.s <= 1.01 && Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5 && V.items.length > 1) { showViewer(V.idx + (dx < 0 ? 1 : -1)); return; }
    if (tap.moved || Date.now() - tap.t > 400) return;
    // 2 回タップ：その場所を 2.5 倍／元に戻す。1 回タップ：上下の帯を隠す・出す
    if (VZ.lastTap && Date.now() - VZ.lastTap.t < 320 && Math.hypot(p[0] - VZ.lastTap.p[0], p[1] - VZ.lastTap.p[1]) < 40) {
      clearTimeout(VZ.tapT);
      VZ.lastTap = null;
      if (VZ.s > 1.01) vzReset(true); else vzZoomAt(p[0], p[1], 2.5);
      return;
    }
    VZ.lastTap = { p, t: Date.now() };
    clearTimeout(VZ.tapT);
    VZ.tapT = setTimeout(() => { VZ.lastTap = null; $("#viewer").classList.toggle("bare"); }, 330);
  };
  st.addEventListener("pointerup", end);
  st.addEventListener("pointercancel", end);
  st.addEventListener("wheel", (e) => {
    e.preventDefault();
    const [cx, cy] = rel(e);
    vzZoomAt(cx, cy, VZ.s * Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0025)), false);
  }, { passive: false });
  $("#v-img").addEventListener("load", () => vzApply());
  window.addEventListener("resize", () => { if (!$("#viewer").hidden) vzApply(); });
}

/* ====================================================================
 * ZIP（外部ライブラリなし・無圧縮）。写真は JPEG なので圧縮してもほぼ縮まない
 * ==================================================================== */
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(u8) {
  let c = 0xffffffff;
  for (let i = 0; i < u8.length; i++) c = CRC_TABLE[(c ^ u8[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function dosDateTime(d) {
  if (!(d instanceof Date) || isNaN(d) || d.getFullYear() < 1980) d = new Date();
  return { time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1), date: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate() };
}
/** entries: [{ name, data: string|Blob, date? }] → ZIP の Blob */
async function makeZip(entries, onProgress) {
  const enc = new TextEncoder();
  const parts = [], central = [];
  let offset = 0;
  for (const [i, e] of entries.entries()) {
    const name = enc.encode(e.name);
    const data = typeof e.data === "string" ? new Blob([e.data]) : e.data;
    const crc = crc32(new Uint8Array(await data.arrayBuffer()));
    const size = data.size;
    const { time, date } = dosDateTime(e.date);
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true); // UTF-8 ファイル名
    lh.setUint16(8, 0, true); lh.setUint16(10, time, true); lh.setUint16(12, date, true);
    lh.setUint32(14, crc, true); lh.setUint32(18, size, true); lh.setUint32(22, size, true);
    lh.setUint16(26, name.length, true); lh.setUint16(28, 0, true);
    parts.push(lh.buffer, name, data);
    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true);
    ch.setUint16(10, 0, true); ch.setUint16(12, time, true); ch.setUint16(14, date, true);
    ch.setUint32(16, crc, true); ch.setUint32(20, size, true); ch.setUint32(24, size, true);
    ch.setUint16(28, name.length, true); ch.setUint32(42, offset, true);
    central.push(ch.buffer, name);
    offset += 30 + name.length + size;
    if (offset > 0xfffffff0) throw new Error("ZIP が 4GB を超えるため作成できません");
    if (onProgress) onProgress(i + 1, entries.length);
  }
  let cdSize = 0;
  for (const c of central) cdSize += c.byteLength;
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, entries.length, true); end.setUint16(10, entries.length, true);
  end.setUint32(12, cdSize, true); end.setUint32(16, offset, true);
  return new Blob([...parts, ...central, end.buffer], { type: "application/zip" });
}
/** ZIP を読む（無圧縮と deflate に対応）。{ names, get(name) => Blob } */
async function readZip(blob) {
  const tailLen = Math.min(blob.size, 65557);
  const tail = new DataView(await blob.slice(blob.size - tailLen).arrayBuffer());
  let eocd = -1;
  for (let i = tail.byteLength - 22; i >= 0; i--) if (tail.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error("ZIP ファイルではありません");
  const count = tail.getUint16(eocd + 10, true), cdSize = tail.getUint32(eocd + 12, true), cdOff = tail.getUint32(eocd + 16, true);
  const cdBuf = await blob.slice(cdOff, cdOff + cdSize).arrayBuffer();
  const cd = new DataView(cdBuf);
  const dec = new TextDecoder();
  const files = new Map();
  let p = 0;
  for (let i = 0; i < count && p + 46 <= cd.byteLength; i++) {
    if (cd.getUint32(p, true) !== 0x02014b50) break;
    const method = cd.getUint16(p + 10, true), csize = cd.getUint32(p + 20, true);
    const nlen = cd.getUint16(p + 28, true), elen = cd.getUint16(p + 30, true), clen = cd.getUint16(p + 32, true), lho = cd.getUint32(p + 42, true);
    const name = dec.decode(new Uint8Array(cdBuf, p + 46, nlen));
    files.set(name, { method, csize, lho });
    p += 46 + nlen + elen + clen;
  }
  const get = async (name) => {
    const f = files.get(name);
    if (!f) return null;
    const lh = new DataView(await blob.slice(f.lho, f.lho + 30).arrayBuffer());
    const start = f.lho + 30 + lh.getUint16(26, true) + lh.getUint16(28, true);
    const raw = blob.slice(start, start + f.csize);
    if (f.method === 0) return raw;
    if (f.method === 8 && "DecompressionStream" in window) return new Response(raw.stream().pipeThrough(new DecompressionStream("deflate-raw"))).blob();
    throw new Error(`未対応の圧縮形式です（${name}）`);
  };
  return { names: [...files.keys()], get };
}

async function exportZip(mode) {
  toast("ZIP を作成中…", 60000);
  const base = exportBaseName();
  const { files, ...data } = await buildJSON("file");
  const photoFiles = new Map(data.memos.map((m) => [m.id, m.photos.map((p) => p.file)]));
  const tracks = await exportTracks();
  const entries = [
    { name: `${base}/data.json`, data: JSON.stringify(data, null, 1) },
    { name: `${base}/memos.geojson`, data: JSON.stringify(buildGeoJSON(tracks, photoFiles)) },
    { name: `${base}/memos.csv`, data: buildCSV(photoFiles) },
    { name: `${base}/tracks.gpx`, data: buildGPX(tracks) },
    ...files.map((f) => ({ name: `${base}/${f.path}`, data: f.blob, date: f.date })),
  ];
  const zip = await makeZip(entries, (i, n) => { if (i % 5 === 0 || i === n) toast(`ZIP を作成中… ${i}/${n}`, 60000); });
  toast(`ZIP を作成しました（${(zip.size / 1048576).toFixed(1)} MB）`);
  return deliverBlob(zip, `${base}.zip`, "application/zip", mode);
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
  $("#measure-prof").onclick = () => { if (!S.measure || S.measure.pts.length < 2) return toast("2 点以上を置くと断面図を描けます"); elevationProfile(S.measure.pts, "計測した線"); };
  $("#btn-crosshair").onclick = () => toggleCrosshair();
  $("#btn-locate").onclick = () => {
    startOrientation();
    if (!S.pos) {
      // 位置が取れていなければ、押すたびに許可を求める（ブロック中なら手順を案内）
      moveToFirstFix = true;
      firstFix = true;
      return requestLocation();
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
  $("#btn-camera").onclick = startCamera;
  $("#camera-input").onchange = onCameraPhotos;
  bindViewer();
  $("#btn-list").onclick = openList;
  $("#btn-menu").onclick = openMenu;
  $("#status").onclick = () => {
    const c = S.crosshair ? { lat: S.map.getCenter().lat, lon: S.map.getCenter().lng } : S.pos;
    if (!c) return requestLocation();
    copyText(`${c.lat.toFixed(6)}, ${c.lon.toFixed(6)}`);
  };
  $("#status").title = "タップで座標をコピー";
  // 画面が隠れる・閉じられるときに記録中の軌跡を保存（電池切れ・アプリの切り替え対策）
  const flushTrack = () => { if (S.track) DB.put("tracks", S.track).catch(() => {}); };
  document.addEventListener("visibilitychange", () => { if (document.hidden) flushTrack(); });
  window.addEventListener("pagehide", flushTrack);
  // 現在地ボタンの長押しで GPS・方位の補正
  let lp = 0;
  $("#btn-locate").addEventListener("pointerdown", () => { lp = setTimeout(() => { lp = -1; openGpsCalib(); }, 650); });
  $("#btn-locate").addEventListener("pointerup", () => clearTimeout(lp));
  $("#btn-locate").addEventListener("pointerleave", () => clearTimeout(lp));
  $("#btn-locate").addEventListener("click", (e) => { if (lp === -1) { e.stopImmediatePropagation(); lp = 0; } }, true);
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
  setupCluster(); // メモが多いとき、引きの地図で重なるピンをまとめる
  demRestore();
  dataRestore();
  extraRestore();
  startSun();
  try {
    await restoreTracksOnStart();
    await loadMemos();
    await loadPdfLayers();
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
