/* フィールドノート — ベクトルデータを重ねる
 * 1. 東京都「緑のオープンデータ」：あらかじめベクトルタイル（PMTiles 1 ファイル）にしたものを表示。凡例・配色は都の QGIS レイヤ定義（.qlr）どおり
 * 2. 不動産情報ライブラリ API：国土数値情報・都市計画決定 GIS などのベクトルタイル（API キーは中継サーバに置く）
 * 3. e-Stat API：統計表を市区町村・都道府県・地域メッシュで塗り分け（境界は Geoshape の市区町村界）
 * いずれも MapLibre GL（WebGL）1 枚にまとめて描くので、要素数が多くても動きが軽い。
 */
"use strict";

const PMTILES_JS = "https://cdn.jsdelivr.net/npm/pmtiles@4.4.1/dist/pmtiles.js";
const GREEN_URL_DEFAULT = "data/tokyo_green.pmtiles";
const GEOSHAPE = "https://geoshape.ex.nii.ac.jp/city/topojson/20230101";
const ESTAT_API = "https://api.e-stat.go.jp/rest/3.0/app/json";
const MM = 96 / 25.4; // QGIS の mm → 画面 px

/* 東京都 緑のオープンデータ：QGIS のレイヤ定義の配色（上ほど上に描く） */
const GREEN_GROUPS = [
  { id: "park", name: "公園緑地", color: "#c6ea8c" },
  { id: "farm", name: "農地", color: "#4d885d" },
  { id: "tree", name: "街路樹", color: "#4d885d", pt: 1.6, line: 0.6 },
  { id: "cliff", name: "崖線", color: "#becf50" },
  { id: "hill", name: "丘陵地・山地", color: "#47aa40" },
  { id: "private", name: "民間開発等による緑", color: "#82ff75" },
  { id: "water", name: "水系", color: "#cefcff" },
  { id: "plan", name: "都市計画法・都市緑地法等に基づく緑", color: "#b0e6ab" },
  { id: "other", name: "自然公園・条例等・公的賃貸住宅の緑", color: "#dfff99" },
  { id: "forest", name: "樹林地", color: "#298600" },
  { id: "public", name: "公共施設の緑", color: "#82ff75" },
];
const GREEN_ATTR = "東京都都市整備局「緑のオープンデータ」";

/* 色の組（カテゴリ用・浸水深などの段階用・数値用） */
const CAT_COLORS = ["#4e79a7", "#f28e2b", "#e15759", "#76b7b2", "#59a14f", "#edc948", "#b07aa1", "#ff9da7", "#9c755f", "#86bcb6", "#d37295", "#a0cbe8", "#8cd17d", "#f1ce63", "#bab0ac"];
const DEPTH_RAMP = ["#f7f5a9", "#ffd8c0", "#ffb7b7", "#ff9191", "#f285c9", "#dc7adc"];
const NUM_RAMPS = {
  blue: ["#eff3ff", "#bdd7e7", "#6baed6", "#3182bd", "#08519c"],
  green: ["#edf8e9", "#bae4b3", "#74c476", "#31a354", "#006d2c"],
  red: ["#fee5d9", "#fcae91", "#fb6a4a", "#de2d26", "#a50f15"],
  purple: ["#f2f0f7", "#cbc9e2", "#9e9ac8", "#756bb1", "#54278f"],
  spectral: ["#2b83ba", "#abdda4", "#ffffbf", "#fdae61", "#d7191c"],
};
const RAMP_NAMES = { blue: "青", green: "緑", red: "赤", purple: "紫", spectral: "青→赤" };
/* 用途地域の慣用的な配色 */
const YOUTO_COLORS = [
  ["第一種低層", "#00a77a"], ["第二種低層", "#6ccf9b"], ["第一種中高層", "#a3d977"], ["第二種中高層", "#d8ec8f"],
  ["第一種住居", "#fff176"], ["第二種住居", "#ffd54f"], ["準住居", "#ffb74d"], ["田園住居", "#d7b98e"],
  ["近隣商業", "#f8a5c2"], ["商業", "#e8557b"], ["準工業", "#c39bd3"], ["工業専用", "#4a90d9"], ["工業", "#8ecae6"],
];
const DEPTH_KEYS = new Set(["A31a_205", "A49_003", "A40_003", "liquefaction_tendency_level"]);

/* ====================================================================
 * MapLibre の重ね合わせ用の地図（1 枚）
 * ==================================================================== */
const OVL = { layer: null, map: null, ready: null };
let pmtilesPromise = null;
function loadPmtiles() {
  if (window.pmtiles) return Promise.resolve();
  if (!pmtilesPromise) {
    pmtilesPromise = new Promise((res, rej) => {
      const s = document.createElement("script");
      s.src = PMTILES_JS;
      s.onload = res;
      s.onerror = () => { pmtilesPromise = null; rej(new Error("PMTiles ライブラリを読み込めません（オフライン？）")); };
      document.head.append(s);
    });
  }
  return pmtilesPromise;
}
let protocolsAdded = false;
function addProtocols() {
  if (protocolsAdded) return;
  protocolsAdded = true;
  const p = new pmtiles.Protocol();
  maplibregl.addProtocol("pmtiles", p.tile);
  maplibregl.addProtocol("reinfo", reinfoTile);
}
function ovlReady() {
  if (OVL.ready) return OVL.ready;
  OVL.ready = (async () => {
    await vtLoadLibs();
    await loadPmtiles();
    addProtocols();
    mapPaneAt("dataPane", 400, true); // 地図タイル・PDF 地図の上、ピンの下（回転しない面）
    OVL.layer = L.maplibreGL({ style: { version: 8, glyphs: VT_GLYPHS, sources: {}, layers: [] }, interactive: false, attributionControl: false, pane: "dataPane" }).addTo(S.map);
    OVL.map = OVL.layer.getMaplibreMap();
    if (!OVL.map.isStyleLoaded()) await new Promise((r) => OVL.map.once("load", r));
    OVL.map.on("idle", () => scheduleDataRefresh());
    return OVL.map;
  })();
  OVL.ready.catch(() => { OVL.ready = null; });
  return OVL.ready;
}
/** レイヤを決まった順に並べる（下から：e-Stat → 不動産情報ライブラリ → 緑 → 読み込んだファイル） */
function ovlOrder() {
  const m = OVL.map;
  if (!m) return;
  const ids = m.getStyle().layers.map((l) => l.id);
  const rank = (id) => (id.startsWith("es-") ? 0 : id.startsWith("ri-") ? 1 : id.startsWith("im-") ? 3 : 2);
  const sorted = [...ids].sort((a, b) => rank(a) - rank(b) || ids.indexOf(a) - ids.indexOf(b));
  for (const id of sorted) m.moveLayer(id);
}
function ovlRemove(prefix) {
  const m = OVL.map;
  if (!m) return;
  for (const l of m.getStyle().layers.filter((l) => l.id.startsWith(prefix))) m.removeLayer(l.id);
  for (const s of Object.keys(m.getStyle().sources).filter((s) => s.startsWith(prefix))) m.removeSource(s);
}

/* ====================================================================
 * 1. 東京都 緑のオープンデータ
 * ==================================================================== */
const greenCfg = () => ({ on: false, opacity: 0.85, off: [], url: "", ...(Settings.data.green || {}) });
function greenSave(patch) {
  Settings.data.green = { ...greenCfg(), ...patch };
  Settings.save();
}
function greenUrl() {
  const u = greenCfg().url || GREEN_URL_DEFAULT;
  return new URL(u, location.href).href;
}
function greenLayers(cfg = greenCfg()) {
  const layers = [];
  const op = cfg.opacity;
  // 下から描く（GREEN_GROUPS は上ほど上なので逆順）
  for (const g of [...GREEN_GROUPS].reverse()) {
    const vis = cfg.off.includes(g.id) ? "none" : "visible";
    layers.push(
      { id: `gr-${g.id}-fill`, type: "fill", source: "green", "source-layer": g.id, filter: ["==", ["geometry-type"], "Polygon"], layout: { visibility: vis }, paint: { "fill-color": g.color, "fill-opacity": op } },
      { id: `gr-${g.id}-line`, type: "line", source: "green", "source-layer": g.id, filter: ["==", ["geometry-type"], "LineString"], layout: { visibility: vis, "line-cap": "round" }, paint: { "line-color": g.color, "line-width": (g.line || 0.26) * MM, "line-opacity": op } },
      { id: `gr-${g.id}-pt`, type: "circle", source: "green", "source-layer": g.id, filter: ["==", ["geometry-type"], "Point"], layout: { visibility: vis }, paint: { "circle-color": g.color, "circle-radius": ((g.pt || 2) * MM) / 2, "circle-opacity": op } },
    );
  }
  return layers;
}
async function greenApply() {
  const cfg = greenCfg();
  if (!cfg.on) { ovlRemove("gr"); ovlRemove("green"); dataLegendUpdate(); return; }
  const m = await ovlReady();
  if (!m.getSource("green")) {
    m.addSource("green", { type: "vector", url: "pmtiles://" + greenUrl(), attribution: GREEN_ATTR });
  }
  for (const l of greenLayers(cfg)) {
    if (m.getLayer(l.id)) {
      m.setLayoutProperty(l.id, "visibility", l.layout.visibility);
      const key = l.type === "fill" ? "fill-opacity" : l.type === "line" ? "line-opacity" : "circle-opacity";
      m.setPaintProperty(l.id, key, cfg.opacity);
    } else m.addLayer(l);
  }
  ovlOrder();
  dataLegendUpdate();
}

/* ====================================================================
 * 2. 不動産情報ライブラリ API
 * ==================================================================== */
const reinfoCfg = () => ({ proxy: "", layers: {}, ...(Settings.data.reinfo || {}) });
function reinfoSave(patch) {
  Settings.data.reinfo = { ...reinfoCfg(), ...patch };
  Settings.save();
}
const reinfoApi = (id) => REINFO_APIS.find((a) => a.id === id);
const reinfoBase = () => (reinfoCfg().proxy || "").replace(/\/+$/, "");
/** 必須パラメータの初期値 */
function reinfoDefaults(api) {
  const y = new Date().getFullYear();
  const d = {};
  for (const p of api.params) {
    if (p.p === "from") d.from = `${y - 2}1`;
    else if (p.p === "to") d.to = `${y - 1}4`;
    else if (p.p === "year") d.year = String(y - 1);
  }
  return d;
}
const RI = { layerName: {}, state: {} }; // id -> pbf のレイヤ名, 色分けの状態

/** pbf（Mapbox Vector Tile）からレイヤ名だけを読む */
function pbfLayerNames(buf) {
  const b = new Uint8Array(buf), names = [];
  const rd = (p) => { let r = 0, sh = 0, c; do { c = b[p.i++]; r += (c & 0x7f) * 2 ** sh; sh += 7; } while (c & 0x80 && p.i < b.length); return r; };
  const skip = (p, wt) => {
    if (wt === 0) rd(p); else if (wt === 1) p.i += 8; else if (wt === 2) { const l = rd(p); p.i += l; } else if (wt === 5) p.i += 4; else throw new Error("pbf");
  };
  const p = { i: 0 };
  try {
    while (p.i < b.length) {
      const key = rd(p), f = key >> 3, wt = key & 7;
      if (f === 3 && wt === 2) {
        const len = rd(p), end = p.i + len, q = { i: p.i };
        while (q.i < end) {
          const k2 = rd(q);
          if (k2 >> 3 === 1 && (k2 & 7) === 2) { const l = rd(q); names.push(new TextDecoder().decode(b.subarray(q.i, q.i + l))); break; }
          skip(q, k2 & 7);
        }
        p.i = end;
      } else skip(p, wt);
    }
  } catch {}
  return names;
}

/** reinfo://XKT002/{z}/{x}/{y}?パラメータ → 中継サーバ経由で pbf を取る */
async function reinfoTile(params, abort) {
  const u = new URL(params.url.replace(/^reinfo:\/\//, "https://reinfo.invalid/"));
  const [, id, z, x, y] = u.pathname.split("/");
  const q = new URLSearchParams(u.search);
  q.set("response_format", "pbf"); q.set("z", z); q.set("x", x); q.set("y", y);
  const base = reinfoBase();
  if (!base) throw new Error("中継サーバの URL が未設定です");
  const res = await fetch(`${base}/reinfolib/${id}?${q}`, { signal: abort && abort.signal });
  if (res.status === 404 || res.status === 204) return { data: new ArrayBuffer(0) };
  if (!res.ok) {
    RI.state[id] = { ...(RI.state[id] || {}), error: `HTTP ${res.status}` };
    scheduleDataRefresh();
    throw new Error(`HTTP ${res.status}`);
  }
  const data = await res.arrayBuffer();
  if (data.byteLength) {
    const names = pbfLayerNames(data);
    if (names.length && !names.includes(RI.layerName[id] || "hits")) {
      RI.layerName[id] = names[0];
      setTimeout(() => reinfoApplyOne(id, true), 0); // 実際のレイヤ名で描き直す
    }
  }
  if (RI.state[id]?.error) { RI.state[id].error = null; scheduleDataRefresh(); }
  return { data };
}

function reinfoColorExpr(id) {
  const api = reinfoApi(id), lc = reinfoCfg().layers[id] || {}, st = RI.state[id] || {};
  const key = lc.key ?? api.key;
  if (!key || !st.legend || !st.legend.length) return CAT_COLORS[REINFO_APIS.indexOf(api) % CAT_COLORS.length];
  if (st.numeric) {
    const stops = [];
    st.legend.forEach((e) => stops.push(e.v, e.color));
    return stops.length >= 4 ? ["interpolate", ["linear"], ["to-number", ["get", key], st.legend[0].v], ...stops] : st.legend[0].color;
  }
  const expr = ["match", ["to-string", ["get", key]]];
  for (const e of st.legend) expr.push(String(e.v), e.color);
  expr.push("#9e9e9e");
  return expr;
}
function reinfoLayersFor(id) {
  const api = reinfoApi(id), lc = { opacity: 0.6, ...(reinfoCfg().layers[id] || {}) };
  const src = `ri-${id}`, sl = RI.layerName[id] || "hits", col = reinfoColorExpr(id), op = lc.opacity;
  return [
    { id: `ri-${id}-fill`, type: "fill", source: src, "source-layer": sl, filter: ["==", ["geometry-type"], "Polygon"], paint: { "fill-color": col, "fill-opacity": op } },
    { id: `ri-${id}-line`, type: "line", source: src, "source-layer": sl, paint: { "line-color": ["case", ["==", ["geometry-type"], "Polygon"], "rgba(60,60,60,0.55)", col], "line-width": ["case", ["==", ["geometry-type"], "Polygon"], 0.6, 2.4], "line-opacity": Math.min(1, op + 0.25) } },
    { id: `ri-${id}-pt`, type: "circle", source: src, "source-layer": sl, filter: ["==", ["geometry-type"], "Point"], paint: { "circle-color": col, "circle-radius": 5, "circle-stroke-color": "#fff", "circle-stroke-width": 1.2, "circle-opacity": Math.min(1, op + 0.3) } },
  ].map((l) => ({ ...l, minzoom: Math.max(0, api.zmin - 0.001) }));
}
async function reinfoApplyOne(id, rebuild = false) {
  const lc = reinfoCfg().layers[id];
  if (!lc || !lc.on) { ovlRemove(`ri-${id}`); dataLegendUpdate(); return; }
  const m = await ovlReady();
  const api = reinfoApi(id);
  const extra = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...reinfoDefaults(api), ...(lc.params || {}) })) if (v !== "" && v != null) extra.set(k, v);
  const tiles = [`reinfo://${id}/{z}/{x}/{y}?${extra}`];
  const src = m.getSource(`ri-${id}`);
  if (src && (rebuild || src.tiles?.[0] !== tiles[0])) { ovlRemove(`ri-${id}`); }
  if (!m.getSource(`ri-${id}`)) {
    m.addSource(`ri-${id}`, { type: "vector", tiles, minzoom: api.zmin, maxzoom: 15, attribution: "不動産情報ライブラリ（国土交通省）" });
  }
  for (const l of reinfoLayersFor(id)) {
    if (m.getLayer(l.id)) {
      for (const [k, v] of Object.entries(l.paint)) m.setPaintProperty(l.id, k, v);
    } else m.addLayer(l);
  }
  ovlOrder();
  dataLegendUpdate();
}
async function reinfoApplyAll() {
  for (const id of Object.keys(reinfoCfg().layers)) await reinfoApplyOne(id);
}
/** 表示中の地物から、色分けの区分（凡例）を作り直す */
function reinfoRefreshLegend(id) {
  const m = OVL.map, api = reinfoApi(id), lc = reinfoCfg().layers[id] || {};
  const key = lc.key ?? api.key;
  const st = (RI.state[id] ||= {});
  if (!m || !m.getSource(`ri-${id}`)) return false;
  let feats = [];
  try { feats = m.querySourceFeatures(`ri-${id}`, { sourceLayer: RI.layerName[id] || "hits" }); } catch {}
  st.count = feats.length;
  st.keys = [...new Set(feats.slice(0, 300).flatMap((f) => Object.keys(f.properties || {})))];
  st.geom = feats.length ? feats[0].geometry.type : st.geom;
  if (!key) { st.legend = null; return false; }
  const vals = new Map();
  for (const f of feats) {
    const v = f.properties?.[key];
    if (v == null || v === "") continue;
    vals.set(String(v), (vals.get(String(v)) || 0) + 1);
  }
  const keysArr = [...vals.keys()];
  if (!keysArr.length) return false;
  const nums = keysArr.map((v) => Number(String(v).replace(/,/g, "")));
  const allNum = nums.every((n) => Number.isFinite(n));
  let legend;
  if (allNum && keysArr.length > 8 && !DEPTH_KEYS.has(key)) {
    const sorted = feats.map((f) => Number(String(f.properties?.[key]).replace(/,/g, ""))).filter(Number.isFinite).sort((a, b) => a - b);
    const ramp = NUM_RAMPS.blue;
    const q = (p) => sorted[Math.min(sorted.length - 1, Math.floor(p * (sorted.length - 1)))];
    legend = ramp.map((c, i) => ({ v: q(i / (ramp.length - 1)), color: c }));
    for (let i = 1; i < legend.length; i++) if (legend[i].v <= legend[i - 1].v) legend[i].v = legend[i - 1].v + 1e-6;
    st.numeric = true;
  } else {
    st.numeric = false;
    const firstNum = (s) => { const m2 = String(s).match(/-?\d+(\.\d+)?/); return m2 ? Number(m2[0]) : Infinity; };
    const ordered = keysArr.sort((a, b) => firstNum(a) - firstNum(b) || (vals.get(b) - vals.get(a)) || a.localeCompare(b, "ja"));
    const fixed = st.colorMap || (st.colorMap = {});
    legend = ordered.slice(0, 40).map((v, i) => {
      let color;
      if (key === "use_area_ja") color = (YOUTO_COLORS.find(([k]) => v.includes(k)) || [])[1];
      else if (DEPTH_KEYS.has(key)) color = DEPTH_RAMP[Math.min(DEPTH_RAMP.length - 1, Math.round((i / Math.max(1, ordered.length - 1)) * (DEPTH_RAMP.length - 1)))];
      color ||= fixed[v] || (fixed[v] = CAT_COLORS[Object.keys(fixed).length % CAT_COLORS.length]);
      return { v, color, n: vals.get(v) };
    });
  }
  const sig = JSON.stringify(legend.map((e) => [e.v, e.color]));
  if (sig === st.sig) return false;
  st.sig = sig;
  st.legend = legend;
  return true;
}

/* ====================================================================
 * 3. e-Stat：統計表を塗り分け
 * ==================================================================== */
const estatCfg = () => ({ appId: "", layers: [], ...(Settings.data.estat || {}) });
function estatSave(patch) {
  Settings.data.estat = { ...estatCfg(), ...patch };
  Settings.save();
}
const ES = { data: {}, geo: {} }; // layer id -> { features, legend }
async function estatGet(path, params) {
  const cfg = estatCfg();
  const q = new URLSearchParams(params);
  let url;
  if (cfg.appId) { q.set("appId", cfg.appId); url = `${ESTAT_API}/${path}?${q}`; }
  else if (reinfoBase()) url = `${reinfoBase()}/estat/${path}?${q}`; // 中継サーバが appId を付ける
  else throw new Error("e-Stat のアプリケーション ID（または中継サーバ）を設定してください");
  const r = await fetch(url);
  if (!r.ok) throw new Error(`e-Stat HTTP ${r.status}`);
  const j = await r.json();
  const root = j[Object.keys(j)[0]];
  const st = root?.RESULT?.STATUS;
  if (st != null && Number(st) >= 100) throw new Error(`e-Stat：${root.RESULT.ERROR_MSG || "エラー " + st}`);
  return root;
}
const asArr = (x) => (x == null ? [] : Array.isArray(x) ? x : [x]);
const txt$ = (x) => (x == null ? "" : typeof x === "object" ? x.$ ?? "" : String(x));

/** 地域コードの種類 */
function areaKind(code) {
  if (/^\d{8,10}$/.test(code)) return "mesh";
  if (/^\d{5}$/.test(code)) return code === "00000" ? "nation" : code.endsWith("000") ? "pref" : "city";
  return "other";
}
/** 地域メッシュコード → [西, 南, 東, 北]（度） */
function meshBounds(code) {
  const c = String(code);
  let lat = Number(c.slice(0, 2)) / 1.5, lon = Number(c.slice(2, 4)) + 100, h = 2 / 3, w = 1;
  if (c.length >= 6) { h /= 8; w /= 8; lat += Number(c[4]) * h; lon += Number(c[5]) * w; }
  if (c.length >= 8) { h /= 10; w /= 10; lat += Number(c[6]) * h; lon += Number(c[7]) * w; }
  for (let k = 8; k < c.length; k++) { // 1/2・1/4・1/8 地域メッシュ（1:南西 2:南東 3:北西 4:北東）
    const d = Number(c[k]) - 1;
    h /= 2; w /= 2;
    if (d & 1) lon += w;
    if (d & 2) lat += h;
  }
  return [lon, lat, lon + w, lat + h];
}

/** TopoJSON → GeoJSON（Geoshape の市区町村界用。外部ライブラリなし） */
function topoToGeo(topo, objName) {
  const tr = topo.transform, arcs = topo.arcs.map((arc) => {
    let x = 0, y = 0;
    return arc.map(([dx, dy]) => { x += dx; y += dy; return tr ? [x * tr.scale[0] + tr.translate[0], y * tr.scale[1] + tr.translate[1]] : [dx, dy]; });
  });
  const line = (ids) => {
    const pts = [];
    for (const i of ids) {
      const a = i < 0 ? arcs[~i].slice().reverse() : arcs[i];
      a.forEach((p, k) => { if (k || !pts.length) pts.push(p); });
    }
    return pts;
  };
  const geom = (g) => g.type === "Polygon" ? { type: "Polygon", coordinates: g.arcs.map(line) }
    : g.type === "MultiPolygon" ? { type: "MultiPolygon", coordinates: g.arcs.map((p) => p.map(line)) } : null;
  return topo.objects[objName].geometries.map((g) => ({ type: "Feature", properties: g.properties || {}, geometry: geom(g) })).filter((f) => f.geometry);
}
async function loadCityShapes(pref) {
  const key = pref === "all" ? "jp" : pref;
  if (ES.geo[key]) return ES.geo[key];
  const url = pref === "all" ? `${GEOSHAPE}/jp_city.c.topojson` : `${GEOSHAPE}/${pref}/${pref}_city.i.topojson`;
  const r = await fetch(url);
  if (!r.ok) throw new Error("市区町村の境界を読み込めません");
  const topo = await r.json();
  ES.geo[key] = topoToGeo(topo, Object.keys(topo.objects)[0]);
  return ES.geo[key];
}
async function loadPrefShapes() {
  if (ES.geo.pref) return ES.geo.pref;
  const r = await fetch(`${GEOSHAPE}/jp_pref.c.topojson`);
  if (!r.ok) throw new Error("都道府県の境界を読み込めません");
  const topo = await r.json();
  ES.geo.pref = topoToGeo(topo, Object.keys(topo.objects)[0]);
  return ES.geo.pref;
}

/** 統計データ（値）を取る。cd: { cdTab, cdCat01, ..., cdTime } */
async function estatFetchValues(lay) {
  const params = { statsDataId: lay.statsDataId, metaGetFlg: "N", cntGetFlg: "N", sectionHeaderFlg: "2", limit: "100000" };
  for (const [k, v] of Object.entries(lay.sel || {})) if (v) params["cd" + k[0].toUpperCase() + k.slice(1)] = v;
  const out = [];
  let start = 1;
  for (let page = 0; page < 10; page++) {
    const root = await estatGet("getStatsData", { ...params, startPosition: String(start) });
    const di = root.STATISTICAL_DATA?.DATA_INF;
    for (const v of asArr(di?.VALUE)) out.push({ area: v["@area"], value: v.$, unit: v["@unit"] });
    const next = root.STATISTICAL_DATA?.RESULT_INF?.NEXT_KEY;
    if (!next) break;
    start = next;
  }
  return out;
}
const toNum = (s) => { const n = Number(String(s).replace(/,/g, "")); return Number.isFinite(n) ? n : null; };

function estatClasses(values, n = 5) {
  const v = values.filter((x) => x != null).sort((a, b) => a - b);
  if (!v.length) return [];
  const br = [];
  for (let i = 1; i < n; i++) br.push(v[Math.min(v.length - 1, Math.floor((i * v.length) / n))]);
  return [...new Set(br)];
}
function estatColorExpr(lay) {
  const ramp = NUM_RAMPS[lay.ramp || "blue"] || NUM_RAMPS.blue;
  const br = ES.data[lay.id]?.breaks || [];
  if (!br.length) return ramp[ramp.length - 1];
  const expr = ["step", ["coalesce", ["get", "v"], -1e30], ramp[0]];
  br.forEach((b, i) => expr.push(b, ramp[Math.min(ramp.length - 1, Math.round(((i + 1) * (ramp.length - 1)) / br.length))]));
  return ["case", ["==", ["get", "v"], null], "rgba(0,0,0,0)", expr];
}
/** 1 つの e-Stat レイヤの地物を作る（値＋形） */
async function estatBuild(lay) {
  if (lay.src === "gis") return esgBuild(lay); // 町丁・字／地域メッシュ（estatgis.js）
  const values = lay.values || (await estatFetchValues(lay));
  const byArea = new Map();
  for (const v of values) byArea.set(v.area, v);
  const kinds = new Map();
  for (const a of byArea.keys()) kinds.set(areaKind(a), (kinds.get(areaKind(a)) || 0) + 1);
  const kind = lay.level || (kinds.get("mesh") ? "mesh" : kinds.get("city") ? "city" : kinds.get("pref") ? "pref" : null);
  if (!kind) throw new Error("地図に描ける地域（市区町村・都道府県・地域メッシュ）がこの表にありません");
  let feats = [];
  if (kind === "mesh") {
    for (const [code, v] of byArea) {
      if (areaKind(code) !== "mesh") continue;
      const [w, s, e, n] = meshBounds(code);
      feats.push({ type: "Feature", properties: { code, name: code, v: toNum(v.value), raw: v.value, unit: v.unit || lay.unit || "" }, geometry: { type: "Polygon", coordinates: [[[w, s], [e, s], [e, n], [w, n], [w, s]]] } });
    }
  } else if (kind === "pref") {
    for (const f of await loadPrefShapes()) {
      const pc = String(f.properties.N03_007 || f.properties.code || "").slice(0, 2) || null;
      const code = pc ? pc + "000" : null;
      const v = code && byArea.get(code);
      feats.push({ type: "Feature", properties: { code, name: f.properties.N03_001, v: v ? toNum(v.value) : null, raw: v ? v.value : "", unit: v?.unit || lay.unit || "" }, geometry: f.geometry });
    }
  } else {
    const shapes = await loadCityShapes(lay.pref || "all");
    for (const f of shapes) {
      const code = f.properties.N03_007;
      if (!code) continue;
      const v = byArea.get(code);
      const name = [f.properties.N03_003, f.properties.N03_004].filter(Boolean).join("");
      feats.push({ type: "Feature", properties: { code, name: name || code, v: v ? toNum(v.value) : null, raw: v ? v.value : "", unit: v?.unit || lay.unit || "" }, geometry: f.geometry });
    }
  }
  const nums = feats.map((f) => f.properties.v);
  ES.data[lay.id] = { features: feats, breaks: estatClasses(nums), kind, matched: nums.filter((x) => x != null).length };
  return ES.data[lay.id];
}
async function estatApplyOne(lay) {
  const m = await ovlReady();
  const sid = `es-${lay.id}`;
  if (!lay.on) { ovlRemove(sid); dataLegendUpdate(); return; }
  if (!ES.data[lay.id]) await estatBuild(lay);
  const fc = { type: "FeatureCollection", features: ES.data[lay.id].features };
  if (m.getSource(sid)) m.getSource(sid).setData(fc);
  else m.addSource(sid, { type: "geojson", data: fc, attribution: "政府統計の総合窓口（e-Stat）" });
  const op = lay.opacity ?? 0.7;
  const layers = [
    { id: `${sid}-fill`, type: "fill", source: sid, paint: { "fill-color": estatColorExpr(lay), "fill-opacity": op } },
    { id: `${sid}-line`, type: "line", source: sid, paint: { "line-color": "rgba(255,255,255,0.9)", "line-width": ES.data[lay.id].kind === "mesh" ? 0.3 : 0.8 } },
  ];
  for (const l of layers) {
    if (m.getLayer(l.id)) for (const [k, v] of Object.entries(l.paint)) m.setPaintProperty(l.id, k, v);
    else m.addLayer(l);
  }
  ovlOrder();
  dataLegendUpdate();
}
async function estatApplyAll() {
  for (const lay of estatCfg().layers) {
    try { await estatApplyOne(lay); } catch (e) { toast(`e-Stat「${lay.title}」：${e.message}`, 4000); }
  }
}

/* ====================================================================
 * 共通：起動時の復元・凡例・タップ・印刷用
 * ==================================================================== */
async function dataRestore() {
  await imLoadAll();
  const any = greenCfg().on || Object.values(reinfoCfg().layers).some((l) => l.on) || estatCfg().layers.some((l) => l.on) || IMP.list.some((l) => l.on);
  if (!any) return;
  try {
    await greenApply();
    await reinfoApplyAll();
    await estatApplyAll();
    await imApplyAll();
  } catch (e) {
    console.warn("データの重ね合わせを復元できません", e);
  }
}
let dataRefreshT = 0;
function scheduleDataRefresh() {
  clearTimeout(dataRefreshT);
  dataRefreshT = setTimeout(() => {
    const m = OVL.map;
    if (!m) return;
    for (const [id, lc] of Object.entries(reinfoCfg().layers)) {
      if (!lc.on || !m.getLayer(`ri-${id}-fill`)) continue;
      if (reinfoRefreshLegend(id)) {
        const col = reinfoColorExpr(id);
        m.setPaintProperty(`ri-${id}-fill`, "fill-color", col);
        m.setPaintProperty(`ri-${id}-pt`, "circle-color", col);
        m.setPaintProperty(`ri-${id}-line`, "line-color", ["case", ["==", ["geometry-type"], "Polygon"], "rgba(60,60,60,0.55)", col]);
      }
    }
    dataLegendUpdate();
  }, 300);
}

/** 凡例の項目（地図左下の凡例と印刷で共通）。{ title, items: [{ color, text, kind }] , ramp? } */
function dataLegendGroups(filterKeys) {
  const out = [];
  const ow = !filterKeys && typeof ownerLegendGroup === "function" ? ownerLegendGroup() : null;
  if (ow) out.push(ow);
  const g = greenCfg();
  if (g.on && (!filterKeys || filterKeys.includes("data:green"))) {
    out.push({ key: "data:green", title: "東京都 緑のオープンデータ", items: GREEN_GROUPS.filter((x) => !g.off.includes(x.id)).map((x) => ({ color: x.color, text: x.name, kind: x.id === "tree" ? "line" : "box" })) });
  }
  for (const [id, lc] of Object.entries(reinfoCfg().layers)) {
    if (!lc.on || (filterKeys && !filterKeys.includes("data:ri:" + id))) continue;
    const api = reinfoApi(id), st = RI.state[id] || {};
    const z = S.map.getZoom();
    let items;
    if (st.error) items = [{ text: `読み込めません（${st.error}）`, kind: "text" }];
    else if (z < api.zmin - 0.5) items = [{ text: `ズーム ${api.zmin} 以上で表示`, kind: "text" }];
    else if (st.legend && st.numeric) items = [{ ramp: st.legend.map((e) => e.color), lo: fmtNum(st.legend[0].v), hi: fmtNum(st.legend[st.legend.length - 1].v), kind: "ramp", text: api.props[lc.key ?? api.key] || "" }];
    else if (st.legend) items = st.legend.map((e) => ({ color: e.color, text: e.v, kind: st.geom?.includes("Point") ? "dot" : "box" }));
    else items = [{ color: CAT_COLORS[REINFO_APIS.indexOf(api) % CAT_COLORS.length], text: st.count === 0 ? "（この範囲にデータなし）" : api.name, kind: "box" }];
    out.push({ key: "data:ri:" + id, title: api.name, items });
  }
  for (const lay of estatCfg().layers) {
    if (!lay.on || (filterKeys && !filterKeys.includes("data:es:" + lay.id))) continue;
    const d = ES.data[lay.id];
    const ramp = NUM_RAMPS[lay.ramp || "blue"] || NUM_RAMPS.blue;
    const br = d?.breaks || [];
    const items = [];
    if (d) {
      const nums = d.features.map((f) => f.properties.v).filter((x) => x != null);
      const lo = Math.min(...nums), hi = Math.max(...nums);
      const edges = [lo, ...br, hi];
      for (let i = 0; i < edges.length - 1; i++) {
        items.push({ color: ramp[Math.min(ramp.length - 1, Math.round((i * (ramp.length - 1)) / Math.max(1, br.length)))], text: `${fmtNum(edges[i])} 〜 ${fmtNum(edges[i + 1])}`, kind: "box" });
      }
      if (d.matched < d.features.length) items.push({ color: "rgba(0,0,0,0)", text: "データなし", kind: "box" });
    }
    out.push({ key: "data:es:" + lay.id, title: `${lay.title}${lay.unit ? `（${lay.unit}）` : ""}`, items });
  }
  return out.concat(imLegendGroups(filterKeys));
}
const fmtNum = (v) => (v == null || !Number.isFinite(v) ? "—" : Math.abs(v) >= 1000 ? Math.round(v).toLocaleString("ja-JP") : String(+v.toPrecision(3)));

let dataLegendEl = null;
function dataLegendUpdate() {
  const groups = dataLegendGroups();
  if (!dataLegendEl) {
    dataLegendEl = h("div", { class: "data-legend", hidden: true });
    dataLegendEl.onclick = (e) => {
      if (e.target.closest(".dl-toggle")) { dataLegendEl.classList.toggle("min"); try { localStorage.setItem("fn.dlmin", dataLegendEl.classList.contains("min") ? "1" : ""); } catch {} return; }
      openDataSheet();
    };
    try { if (localStorage.getItem("fn.dlmin")) dataLegendEl.classList.add("min"); } catch {}
    document.body.append(dataLegendEl);
  }
  dataLegendEl.hidden = !groups.length;
  if (!groups.length) return;
  const sw = (it) => it.kind === "ramp" ? h("i", { class: "dl-ramp", style: `background:linear-gradient(90deg,${it.ramp.join(",")})` })
    : h("i", { class: "dl-sw " + (it.kind || "box"), style: `background:${it.color || "transparent"}` });
  dataLegendEl.replaceChildren(
    h("button", { type: "button", class: "dl-toggle", "aria-label": "凡例をたたむ" }, "凡例"),
    h("div", { class: "dl-body" }, ...groups.map((g) => h("div", { class: "dl-group" }, h("b", {}, g.title),
      ...g.items.slice(0, 14).map((it) => h("div", { class: "dl-item" }, it.kind === "text" ? null : sw(it), it.kind === "ramp" ? h("span", {}, `${it.lo} 〜 ${it.hi}`) : h("span", {}, it.text))),
      g.items.length > 14 ? h("div", { class: "dl-item" }, h("span", {}, `ほか ${g.items.length - 14} 区分`)) : null))));
}

/** 地図タップ：データの地物の属性をポップアップ */
function dataLayerClick(latlng) {
  const m = OVL.map;
  if (!m) return false;
  const p = m.project([latlng.lng, latlng.lat]);
  const ids = m.getStyle().layers.map((l) => l.id).filter((id) => /^(gr|ri|es|im)-/.test(id));
  if (!ids.length) return false;
  let feats = [];
  try { feats = m.queryRenderedFeatures([[p.x - 7, p.y - 7], [p.x + 7, p.y + 7]], { layers: ids }); } catch { return false; }
  if (!feats.length) return false;
  const seen = new Set(), blocks = [];
  for (const f of feats) {
    const sig = f.layer.id.replace(/-(fill|line|pt)$/, "") + JSON.stringify(f.properties);
    if (seen.has(sig)) continue;
    seen.add(sig);
    if (blocks.length >= 4) break;
    const pr = f.properties || {};
    let title, rows;
    if (f.layer.id.startsWith("gr-")) {
      const g = GREEN_GROUPS.find((x) => f.layer.id.startsWith(`gr-${x.id}-`));
      title = `${pr._k || ""}`;
      rows = Object.entries(pr).filter(([k]) => !k.startsWith("_")).map(([k, v]) => [k, v]);
      rows.unshift(["分類", g ? g.name : ""]);
    } else if (f.layer.id.startsWith("ri-")) {
      const id = f.layer.id.split("-")[1], api = reinfoApi(id);
      title = (api.title && pr[api.title]) || api.name;
      rows = Object.entries(pr).map(([k, v]) => [api.props[k] || k, v]);
      rows.unshift(["データ", api.name]);
    } else if (f.layer.id.startsWith("im-")) {
      const rec = IMP.list.find((x) => f.layer.id.startsWith(`im-${x.id}-`));
      title = (rec?.label && pr[rec.label]) || pr["名称"] || pr.name || pr.NAME || pr["項目"] || rec?.name || "";
      rows = Object.entries(pr).filter(([k]) => k !== "fgdFeature").map(([k, v]) => [k, v]);
      rows.unshift(["データ", rec?.name || ""]);
    } else {
      const lay = estatCfg().layers.find((l) => f.layer.id.startsWith(`es-${l.id}-`));
      title = pr.name;
      rows = [["統計", lay?.title || ""], ["値", `${pr.raw === "" || pr.raw == null ? "データなし" : pr.raw}${pr.unit ? " " + pr.unit : ""}`], ["地域コード", pr.code]];
    }
    blocks.push(h("div", { class: "dp-block" }, h("div", { class: "pt" }, String(title || "")),
      h("table", { class: "dp-table" }, ...rows.filter(([, v]) => v !== "" && v != null).slice(0, 18).map(([k, v]) => h("tr", {}, h("th", {}, k), h("td", {}, String(v)))))));
  }
  L.popup({ maxWidth: 300, maxHeight: 320, className: "data-popup" }).setLatLng(latlng).setContent(h("div", {}, ...blocks)).openOn(S.map);
  return true;
}

/** 印刷：表示中のデータレイヤ（印刷用のキー一覧） */
function dataPrintCandidates() {
  const out = [];
  if (greenCfg().on && OVL.map?.getSource("green")) out.push({ key: "data:green", name: "東京都 緑のオープンデータ", kind: "data" });
  for (const [id, lc] of Object.entries(reinfoCfg().layers)) if (lc.on && OVL.map?.getSource(`ri-${id}`)) out.push({ key: "data:ri:" + id, name: reinfoApi(id).name, kind: "data" });
  for (const lay of estatCfg().layers) if (lay.on && OVL.map?.getSource(`es-${lay.id}`)) out.push({ key: "data:es:" + lay.id, name: `e-Stat：${lay.title}`, kind: "data" });
  for (const rec of IMP.list) if (rec.on && OVL.map?.getSource(`im-${rec.id}`)) out.push({ key: "data:im:" + rec.id, name: `ファイル：${rec.name}`, kind: "data" });
  return out;
}
/** 印刷用：選んだキーのレイヤだけを含むスタイル */
function dataPrintStyle(keys) {
  const st = OVL.map.getStyle();
  const keep = (id) => (id.startsWith("gr-") && keys.includes("data:green"))
    || (id.startsWith("ri-") && keys.includes("data:ri:" + id.split("-")[1]))
    || (id.startsWith("es-") && keys.includes("data:es:" + id.split("-")[1]))
    || (id.startsWith("im-") && keys.includes("data:im:" + id.split("-")[1]));
  const layers = st.layers.filter((l) => keep(l.id));
  const used = new Set(layers.map((l) => l.source));
  const sources = Object.fromEntries(Object.entries(st.sources).filter(([k]) => used.has(k)));
  return { version: 8, glyphs: st.glyphs, sources, layers };
}
function dataCredits(keys) {
  const c = [];
  if (keys.includes("data:green")) c.push(GREEN_ATTR + "（CC BY 4.0）");
  if (keys.some((k) => k.startsWith("data:ri:"))) c.push("不動産情報ライブラリ（国土交通省）");
  if (keys.some((k) => k.startsWith("data:es:"))) c.push("政府統計の総合窓口（e-Stat）・Geoshape 市区町村界（CODH, 国土数値情報 行政区域を加工）");
  const im = IMP.list.filter((r) => keys.includes("data:im:" + r.id));
  if (im.some((r) => r.kind === "fgd")) c.push("基盤地図情報（国土地理院）");
  const other = im.filter((r) => r.kind !== "fgd");
  if (other.length) c.push("読み込んだデータ：" + other.map((r) => r.name).join("、"));
  return c;
}

/* ====================================================================
 * 画面：データを重ねる（地図の切替の子画面）
 * ==================================================================== */
const dataBack = () => h("button", { type: "button", class: "chip vt-back", onclick: () => openLayers() }, "← 地図の切替に戻る");
const dataBack2 = () => h("button", { type: "button", class: "chip vt-back", onclick: openDataSheet }, "← データを重ねるに戻る");

function dataPanelRow() {
  const g = greenCfg();
  const nRi = Object.values(reinfoCfg().layers).filter((l) => l.on).length;
  const nEs = estatCfg().layers.filter((l) => l.on).length;
  const gcb = h("input", { type: "checkbox", checked: g.on });
  gcb.onchange = async () => {
    greenSave({ on: gcb.checked });
    try { await greenApply(); } catch (e) { toast("表示できません：" + e.message, 4000); gcb.checked = false; greenSave({ on: false }); }
  };
  const grg = h("input", { type: "range", min: "0.1", max: "1", step: "0.05", value: g.opacity });
  grg.oninput = () => { greenSave({ opacity: Number(grg.value) }); if (!gcb.checked) { gcb.checked = true; greenSave({ on: true }); } greenApply(); };
  return h("div", {},
    h("div", { class: "ov-row" }, gcb, h("div", {}, "東京都 緑のオープンデータ", h("small", {}, "公園・樹林地・農地・街路樹・水系など（都内本土部）")), grg),
    h("div", { class: "dem-tools" }, h("button", { type: "button", class: "btn secondary", onclick: openGreenSheet }, "表示する分類・凡例")),
    h("div", { class: "menu-grid", style: "margin-top:6px" },
      h("button", { type: "button", class: "btn secondary", onclick: openReinfoSheet }, `不動産情報ライブラリ${nRi ? `（${nRi}）` : ""}`),
      h("button", { type: "button", class: "btn secondary", onclick: openEstatSheet }, `e-Stat 統計${nEs ? `（${nEs}）` : ""}`)),
    h("div", { class: "lbl-plain", style: "margin-top:12px;font-weight:700" }, "ファイルから（GeoJSON・KML・.gsf・GeoParquet・基盤地図情報）"),
    imPanel());
}
function openDataSheet() {
  openSheet("データを重ねる", h("div", {}, dataBack(), dataPanelRow()), { backdrop: false, height: "62vh" });
}

function openGreenSheet() {
  const cfg = greenCfg();
  const list = h("div", { class: "green-list" });
  for (const g of GREEN_GROUPS) {
    const cb = h("input", { type: "checkbox", checked: !cfg.off.includes(g.id) });
    cb.onchange = () => {
      const off = new Set(greenCfg().off);
      if (cb.checked) off.delete(g.id); else off.add(g.id);
      greenSave({ off: [...off], on: true });
      greenApply();
    };
    const sw = g.id === "tree" ? h("i", { class: "gl-sw tree", style: `--c:${g.color}` }) : h("i", { class: "gl-sw", style: `background:${g.color}` });
    list.append(h("label", { class: "inline green-item" }, cb, sw, g.name));
  }
  const url = h("input", { type: "text", value: cfg.url, placeholder: GREEN_URL_DEFAULT, inputmode: "url" });
  url.onchange = () => { greenSave({ url: url.value.trim() }); ovlRemove("gr"); if (OVL.map?.getSource("green")) OVL.map.removeSource("green"); greenApply(); };
  openSheet("東京都 緑のオープンデータ", h("div", {},
    dataBack2(),
    h("div", { class: "menu-grid" },
      h("button", { type: "button", class: "btn secondary", onclick: () => { greenSave({ off: [], on: true }); greenApply(); openGreenSheet(); } }, "すべて表示"),
      h("button", { type: "button", class: "btn secondary", onclick: () => { greenSave({ off: GREEN_GROUPS.map((g) => g.id), on: true }); greenApply(); openGreenSheet(); } }, "すべて隠す")),
    h("div", { class: "sect-title" }, "分類（凡例）"), list,
    h("p", { class: "note" }, "配色と重なり順は東京都が配布している QGIS のレイヤ定義（tokyo_green_open_data.qlr）に合わせています。地物をタップすると属性（公園名・面積・樹種など）が見られます。"),
    h("details", {}, h("summary", {}, "データの場所（上級者向け）"),
      h("label", {}, "PMTiles の URL（空欄なら同じサイトの data/tokyo_green.pmtiles）", url),
      h("p", { class: "note" }, "tools/build_green.py で東京都のシェープファイルから作れます。")),
    h("p", { class: "note" }, "出典：東京都都市整備局「緑のオープンデータ（GISデータ）」（CC BY 4.0）を加工して作成")), { backdrop: false, height: "62vh" });
}

function openReinfoSheet() {
  const cfg = reinfoCfg();
  const proxy = h("input", { type: "text", value: cfg.proxy, placeholder: "https://xxxx.workers.dev", inputmode: "url" });
  proxy.onchange = () => { reinfoSave({ proxy: proxy.value.trim() }); for (const id of Object.keys(reinfoCfg().layers)) reinfoApplyOne(id, true); };
  const listBox = h("div");
  const render = () => {
    listBox.replaceChildren();
    let grp = "";
    for (const api of REINFO_APIS) {
      if (api.group !== grp) { grp = api.group; listBox.append(h("div", { class: "sect-title" }, grp)); }
      const lc = { opacity: 0.6, ...(reinfoCfg().layers[api.id] || {}) };
      const cb = h("input", { type: "checkbox", checked: !!lc.on });
      const set = (patch) => {
        const layers = { ...reinfoCfg().layers };
        layers[api.id] = { opacity: 0.6, ...(layers[api.id] || {}), ...patch };
        reinfoSave({ layers });
      };
      cb.onchange = async () => {
        if (cb.checked && !reinfoBase()) { cb.checked = false; return toast("先に中継サーバの URL を設定してください", 3000); }
        set({ on: cb.checked });
        try { await reinfoApplyOne(api.id); } catch (e) { toast(e.message, 4000); }
        if (cb.checked && S.map.getZoom() < api.zmin) toast(`ズーム ${api.zmin} 以上で表示されます`);
        render();
      };
      const rg = h("input", { type: "range", min: "0.1", max: "1", step: "0.05", value: lc.opacity });
      rg.oninput = () => { set({ opacity: Number(rg.value) }); if (lc.on) reinfoApplyOne(api.id); };
      const row = h("div", { class: "ri-row" }, h("div", { class: "ov-row" }, cb, h("div", {}, api.name, h("small", {}, `${api.id}・ズーム ${api.zmin}〜`)), rg));
      if (lc.on) {
        // 色分けの項目と、必須・任意の条件
        const st = RI.state[api.id] || {};
        const keys = [...new Set([...(st.keys || []), ...Object.keys(api.props)])];
        const keySel = h("select", {}, h("option", { value: "" }, "色分けしない"), ...keys.map((k) => h("option", { value: k, selected: (lc.key ?? api.key) === k }, api.props[k] ? `${api.props[k]}（${k}）` : k)));
        keySel.onchange = () => { set({ key: keySel.value || "" }); RI.state[api.id] = { ...st, sig: null, colorMap: {} }; scheduleDataRefresh(); reinfoApplyOne(api.id); };
        const params = api.params.map((p) => {
          const cur = { ...reinfoDefaults(api), ...(lc.params || {}) }[p.p] ?? "";
          const inp = h("input", { type: "text", value: cur, placeholder: p.req ? "必須" : "任意" });
          inp.onchange = () => { set({ params: { ...(reinfoCfg().layers[api.id].params || {}), [p.p]: inp.value.trim() } }); reinfoApplyOne(api.id); };
          return h("label", {}, `${p.label}（${p.p}）${p.req ? "・必須" : ""}`, inp, h("small", { class: "note" }, p.note));
        });
        row.append(h("div", { class: "ri-opts" }, h("label", {}, "色分けする項目", keySel), ...params));
      }
      listBox.append(row);
    }
  };
  render();
  openSheet("不動産情報ライブラリ", h("div", {},
    dataBack2(),
    h("label", {}, "中継サーバの URL（API キーを持つ Cloudflare Worker など）", proxy),
    h("p", { class: "note" }, "不動産情報ライブラリの API はブラウザから直接呼べない（CORS 非対応・API キーを公開しないため）ので、API キーを預けた中継サーバ経由で読み込みます。作り方は README の「不動産情報ライブラリ・e-Stat の中継サーバ」を参照してください。中継サーバは結果を 1 日キャッシュするので、2 回目以降は速く表示されます。"),
    listBox,
    h("p", { class: "note" }, "出典：不動産情報ライブラリ（国土交通省）。各データの原典（国土数値情報・都市計画決定 GIS データ等）の利用条件に従ってください。")), { backdrop: false, height: "70vh" });
}

/* ---------- e-Stat ---------- */
const PREFS = ["北海道", "青森県", "岩手県", "宮城県", "秋田県", "山形県", "福島県", "茨城県", "栃木県", "群馬県", "埼玉県", "千葉県", "東京都", "神奈川県", "新潟県", "富山県", "石川県", "福井県", "山梨県", "長野県", "岐阜県", "静岡県", "愛知県", "三重県", "滋賀県", "京都府", "大阪府", "兵庫県", "奈良県", "和歌山県", "鳥取県", "島根県", "岡山県", "広島県", "山口県", "徳島県", "香川県", "愛媛県", "高知県", "福岡県", "佐賀県", "長崎県", "熊本県", "大分県", "宮崎県", "鹿児島県", "沖縄県"];
async function centerPrefCode() {
  try {
    const c = S.map.getCenter();
    const r = await (await fetch(`https://mreversegeocoder.gsi.go.jp/reverse-geocoder/LonLatToAddress?lat=${c.lat}&lon=${c.lng}`)).json();
    const code = r?.results?.muniCd;
    if (code) return String(code).padStart(5, "0").slice(0, 2);
  } catch {}
  return "13";
}

function openEstatSheet() {
  const cfg = estatCfg();
  const appId = h("input", { type: "text", value: cfg.appId, placeholder: "e-Stat のアプリケーション ID", autocomplete: "off" });
  appId.onchange = () => estatSave({ appId: appId.value.trim() });
  const layersBox = h("div");
  const renderLayers = () => {
    layersBox.replaceChildren();
    for (const lay of estatCfg().layers) {
      const cb = h("input", { type: "checkbox", checked: !!lay.on });
      const upd = (patch) => { estatSave({ layers: estatCfg().layers.map((l) => (l.id === lay.id ? { ...l, ...patch } : l)) }); return estatCfg().layers.find((l) => l.id === lay.id); };
      cb.onchange = async () => { const l = upd({ on: cb.checked }); try { await estatApplyOne(l); } catch (e) { toast(e.message, 4000); } };
      const rg = h("input", { type: "range", min: "0.1", max: "1", step: "0.05", value: lay.opacity ?? 0.7 });
      rg.oninput = () => { const l = upd({ opacity: Number(rg.value) }); if (l.on) estatApplyOne(l); };
      const ramp = h("select", {}, ...Object.entries(RAMP_NAMES).map(([k, v]) => h("option", { value: k, selected: (lay.ramp || "blue") === k }, v)));
      ramp.onchange = () => { const l = upd({ ramp: ramp.value }); if (l.on) estatApplyOne(l); };
      const d = ES.data[lay.id];
      layersBox.append(h("div", { class: "ri-row" },
        h("div", { class: "ov-row" }, cb, h("div", {}, lay.title, h("small", {}, [lay.selText, d ? `${d.matched} 地域` : ""].filter(Boolean).join("・")),
          lay.src === "gis" ? h("small", { class: "esg-fresh" + (esgStale(lay) ? " old" : "") }, esgFreshText(lay)) : ""), rg),
        h("div", { class: "chips" }, h("label", { class: "inline", style: "margin:0" }, "色 ", ramp),
          lay.src === "gis"
            ? h("button", { type: "button", class: "chip", onclick: async () => {
              // 今見ている範囲の市区町村・メッシュで作り直す
              try {
                const codes = lay.area === "town" ? await esgCitiesInView() : esgMeshesInView();
                if (!codes.length) throw new Error("地図の範囲の市区町村が分かりませんでした");
                if (lay.area !== "town" && codes.length > ESG_MAX_MESH[lay.area]) throw new Error("範囲が広すぎます。もう少し拡大してください");
                toast("取得中…", 30000);
                ES.data[lay.id] = null;
                const l = upd({ codes, on: true });
                await estatApplyOne(l);
                const names = ES.data[l.id]?.names || [];
                upd({ selText: esgSelText(l.selBase || "", names) });
                toast("今の範囲で塗り直しました"); renderLayers();
              } catch (e) { toast(e.message, 4000); }
            } }, "今の範囲にする")
            : h("button", { type: "button", class: "chip", onclick: async () => { ES.data[lay.id] = null; const l = upd({ values: null }); try { await estatApplyOne(l); toast("取り直しました"); } catch (e) { toast(e.message, 4000); } } }, "取り直す"),
          lay.src === "gis"
            ? h("button", { type: "button", class: "chip", onclick: async () => {
              // 端末と中継サーバのキャッシュを使わずに e-Stat から取り直す
              try {
                toast("e-Stat から取り直しています…", 60000);
                const l = upd({ on: true });
                await esgBuild(l, { fresh: true });
                await estatApplyOne(estatCfg().layers.find((x) => x.id === l.id));
                toast("最新のデータで塗り直しました"); renderLayers();
              } catch (e) { toast(e.message, 4000); }
            } }, "最新を取り直す")
            : "",
          h("button", { type: "button", class: "chip", onclick: () => { if (!confirm(`「${lay.title}」を削除しますか？`)) return; ovlRemove(`es-${lay.id}`); estatSave({ layers: estatCfg().layers.filter((l) => l.id !== lay.id) }); delete ES.data[lay.id]; dataLegendUpdate(); renderLayers(); } }, "削除"))));
    }
    if (!estatCfg().layers.length) layersBox.append(h("p", { class: "note" }, "まだありません。下で統計を選んでください。"));
  };
  renderLayers();

  const q = h("input", { type: "search", placeholder: "例：国勢調査 人口 市区町村／statsDataId（0003445078 など）", enterkeyhint: "search" });
  const results = h("div");
  const search = async (e) => {
    e && e.preventDefault();
    const word = q.value.trim();
    if (!word) return;
    results.replaceChildren(h("div", { class: "note" }, "検索中…"));
    try {
      if (/^\d{10}$|^[A-Z0-9]{10,}$/.test(word)) return openEstatTable(word, "");
      const root = await estatGet("getStatsList", { searchWord: word, limit: "40" });
      const tables = asArr(root.DATALIST_INF?.TABLE_INF);
      results.replaceChildren(...(tables.length ? tables.map((t) => {
        const title = txt$(t.TITLE) || txt$(t.STATISTICS_NAME);
        const b = h("button", { type: "button", class: "memo-item", style: "grid-template-columns:1fr;text-align:left" },
          h("div", {}, h("div", { class: "t" }, title), h("div", { class: "s" }, [txt$(t.STAT_NAME), txt$(t.SURVEY_DATE), txt$(t.COLLECT_AREA), t["@id"]].filter(Boolean).join("・"))));
        b.onclick = () => openEstatTable(t["@id"], title);
        return b;
      }) : [h("div", { class: "note" }, "見つかりませんでした。言葉を変えるか、「市区町村」「メッシュ」などを加えてください。")]));
    } catch (er) {
      results.replaceChildren(h("div", { class: "warn" }, er.message));
    }
  };
  const form = h("form", { class: "gr-search" }, q, h("button", { type: "submit", class: "chip" }, "検索"));
  form.onsubmit = search;
  const proxy = h("input", { type: "text", value: reinfoCfg().proxy || "", placeholder: "https://xxxx.workers.dev", inputmode: "url" });
  proxy.onchange = () => reinfoSave({ proxy: proxy.value.trim() });
  openSheet("e-Stat 統計を重ねる", h("div", {},
    dataBack2(),
    h("div", { class: "sect-title" }, "表示中の統計"), layersBox,
    h("div", { class: "sect-title" }, "町丁・字やメッシュの統計を選ぶ"),
    h("p", { class: "note", style: "margin-top:0" }, "国勢調査・経済センサス・将来推計人口を、今見ている地図の範囲について町丁・字ごと、またはメッシュごとに塗り分けます。単位を選んでから統計を選んでください。"),
    h("p", { class: "note esg-catalog-date" }, `統計の一覧：${typeof ESTAT_GIS_UPDATED === "string" ? ESTAT_GIS_UPDATED : "—"} 更新（e-Stat に新しい統計が出ていないか毎月自動で確かめています）。取ったデータは 90 日たつと取り直します。`),
    esgChooser(),
    h("details", { open: !reinfoBase() }, h("summary", {}, "中継サーバ（必須）"),
      h("label", {}, "中継サーバの URL（不動産情報ライブラリと共通）", proxy),
      h("p", { class: "note" }, "e-Stat の町丁・字やメッシュのデータはブラウザから直接取れないため、中継サーバ（Cloudflare Worker）を通します。README の「不動産情報ライブラリ・e-Stat の中継サーバ」の最新のコードを Worker に貼ってください（/estatgis に対応したもの）。一度取ったデータは端末に残るので、2 回目からは電波がなくても表示できます。")),
    h("details", {}, h("summary", {}, "市区町村・都道府県単位の統計表を API で探す"),
      h("p", { class: "note" }, "e-Stat の全統計表から言葉で探します。市区町村・都道府県単位の表が中心です。"),
      form, results,
      h("label", {}, "アプリケーション ID（e-Stat でユーザー登録すると無料で発行。中継サーバに預けている場合は空欄）", appId),
      h("p", { class: "note" }, "市区町村の境界は Geoshape の市区町村界（2023 年）を使うため、それ以前の合併前の市町村は表示されません。")),
    h("p", { class: "note" }, "出典：政府統計の総合窓口（e-Stat）。町丁・字の境界は国勢調査の小地域境界、メッシュの将来推計人口は国土交通省の推計（2015 年国勢調査基準）です。秘匿された地域（人が少ない地域など）は値を出しません。"),
    h("p", { class: "note" }, "このサービスは、政府統計総合窓口(e-Stat)の API 機能を使用していますが、サービスの内容は国によって保証されたものではありません。")), { backdrop: false, height: "80vh" });
}

/** 統計表を選んだ後：表示する項目（表章・分類・時点）と地域の範囲を選ぶ */
async function openEstatTable(statsDataId, title) {
  const body = h("div", {}, h("div", { class: "note" }, "統計表の項目を読み込み中…"));
  openSheet("統計表の項目を選ぶ", body, { backdrop: false, height: "75vh" });
  let meta;
  try {
    meta = await estatGet("getMetaInfo", { statsDataId });
  } catch (e) {
    body.replaceChildren(h("div", { class: "warn" }, e.message), h("button", { type: "button", class: "btn secondary block", onclick: openEstatSheet }, "戻る"));
    return;
  }
  const tinf = meta.METADATA_INF?.TABLE_INF || {};
  title ||= txt$(tinf.TITLE) || txt$(tinf.STATISTICS_NAME) || statsDataId;
  const objs = asArr(meta.METADATA_INF?.CLASS_INF?.CLASS_OBJ);
  const area = objs.find((o) => o["@id"] === "area");
  if (!area) {
    body.replaceChildren(h("div", { class: "warn" }, "この統計表には地域の分類がないため、地図に描けません。"), h("button", { type: "button", class: "btn secondary block", onclick: openEstatSheet }, "戻る"));
    return;
  }
  const areaCodes = asArr(area.CLASS).map((c) => c["@code"]);
  const kinds = {};
  for (const c of areaCodes) kinds[areaKind(c)] = (kinds[areaKind(c)] || 0) + 1;
  const levels = [["city", "市区町村"], ["pref", "都道府県"], ["mesh", "地域メッシュ"]].filter(([k]) => kinds[k]);
  if (!levels.length) {
    body.replaceChildren(h("div", { class: "warn" }, "この統計表の地域（小地域など）は、地図の境界を用意できないため描けません。"), h("button", { type: "button", class: "btn secondary block", onclick: openEstatSheet }, "戻る"));
    return;
  }
  const sels = {};
  const selRows = objs.filter((o) => o["@id"] !== "area").map((o) => {
    const classes = asArr(o.CLASS);
    const s = h("select", {}, ...classes.slice(0, 2000).map((c) => h("option", { value: c["@code"] }, `${c["@name"]}${c["@unit"] ? `（${c["@unit"]}）` : ""}`)));
    // 時間軸は最新を初期値に
    if (o["@id"] === "time" && classes.length) s.value = classes.map((c) => c["@code"]).sort().pop();
    sels[o["@id"]] = s;
    return h("label", {}, `${o["@name"]}（${classes.length} 件）`, s);
  });
  const levelSel = h("select", {}, ...levels.map(([k, n]) => h("option", { value: k }, `${n}（${kinds[k]} 地域）`)));
  const prefSel = h("select", {}, h("option", { value: "all" }, "全国（粗い境界）"), ...PREFS.map((n, i) => h("option", { value: String(i + 1).padStart(2, "0") }, n)));
  centerPrefCode().then((pc) => (prefSel.value = pc));
  const prefRow = h("label", {}, "市区町村の範囲（境界の細かさ）", prefSel);
  levelSel.onchange = () => (prefRow.hidden = levelSel.value !== "city");
  const status = h("div", { class: "note" });
  const add = async () => {
    addBtn.disabled = true;
    status.textContent = "データを取得中…";
    const sel = {};
    const parts = [];
    for (const [k, s] of Object.entries(sels)) { sel[k] = s.value; parts.push(s.selectedOptions[0]?.textContent || ""); }
    const unitOpt = Object.values(sels).map((s) => s.selectedOptions[0]?.textContent.match(/（([^）]+)）$/)?.[1]).find(Boolean) || "";
    const lay = { id: uuid().slice(0, 8), statsDataId, title, sel, selText: parts.filter(Boolean).join("・"), level: levelSel.value, pref: levelSel.value === "city" ? prefSel.value : "all", on: true, opacity: 0.7, ramp: "blue", unit: unitOpt };
    try {
      const values = await estatFetchValues(lay);
      if (!values.length) throw new Error("選んだ条件のデータがありません");
      // 小さいものは値を端末に保存（次回は e-Stat に問い合わせずにすぐ表示）。大きいものは次回取り直す
      lay.values = values.length <= 3000 ? values : null;
      await estatBuild({ ...lay, values });
      const d = ES.data[lay.id];
      if (!d.matched) throw new Error("地図の境界と一致する地域がありませんでした（範囲の都道府県を確認してください）");
      estatSave({ layers: [...estatCfg().layers, lay] });
      await estatApplyOne(lay);
      closeSheet(true);
      toast(`${d.matched} 地域を塗り分けました`);
    } catch (e) {
      status.textContent = e.message;
      addBtn.disabled = false;
    }
  };
  const addBtn = h("button", { type: "button", class: "btn primary block", onclick: add }, "地図に重ねる");
  body.replaceChildren(
    h("button", { type: "button", class: "chip vt-back", onclick: openEstatSheet }, "← 検索に戻る"),
    h("div", { class: "pt", style: "font-weight:700;margin:4px 0 8px" }, title),
    h("div", { class: "note", style: "margin-top:0" }, `統計表 ID：${statsDataId}`),
    ...selRows,
    h("label", {}, "塗り分ける地域の単位", levelSel), prefRow,
    addBtn, status);
}
