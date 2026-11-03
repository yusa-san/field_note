/* フィールドノート — 地理院地図Vector（地理院 最適化ベクトルタイル）
 * - MapLibre GL を Leaflet の上で動かして表示（必要になった時だけ読み込む）
 * - 表示する項目（道路・鉄道・建物…）を選べる
 * - スタイルは地理院の標準のほか、配色を変えたプリセットを用意
 *   （エディトリアル系の配色は ZzzLc0405/photo-abstract-editorial の「アイボリーの余白・彩度を落とした少数の色・細い線」
 *     という考え方を参考に、地図用に独自に作ったもの）
 * app.js より先に読み込む（ここではトップレベルで app.js の値を使わない）
 */
"use strict";

const VT_TILES = "https://cyberjapandata.gsi.go.jp/xyz/optimal_bvmap-v1/{z}/{x}/{y}.pbf";
const VT_STYLE_URL = "https://gsi-cyberjapan.github.io/optimal_bvmap/style/std.json";
const MAPLIBRE_JS = "https://cdn.jsdelivr.net/npm/maplibre-gl@5.24.0/dist/maplibre-gl.js";
const MAPLIBRE_CSS = "https://cdn.jsdelivr.net/npm/maplibre-gl@5.24.0/dist/maplibre-gl.css";
const MAPLIBRE_LEAFLET_JS = "https://cdn.jsdelivr.net/npm/@maplibre/maplibre-gl-leaflet@0.1.4/leaflet-maplibre-gl.js";

/* ---------- 表示する項目（元のスタイルのレイヤを、元データの種類ごとにまとめる） ---------- */
const VT_GROUPS = [
  { key: "label_text", name: "注記（地名・施設名など）", layers: ["Anno"], mode: "text" },
  { key: "label_icon", name: "記号（アイコン）", layers: ["Anno"], mode: "icon" },
  { key: "road", name: "道路", layers: ["RdCL", "RdEdg", "RdCompt"] },
  { key: "rail", name: "鉄道", layers: ["RailCL", "RailTrCL"] },
  { key: "building", name: "建物", layers: ["BldA"] },
  { key: "water", name: "水部（海・川・湖・海岸線）", layers: ["WA", "RvrCL", "WL", "Cstline", "WRltLine", "WStrA", "WStrL"] },
  { key: "contour", name: "等高線・等深線", layers: ["Cntr", "Isbt"] },
  { key: "terrain", name: "地形の表記（崖・岩など）", layers: ["TpgphLine", "TpgphArea"] },
  { key: "boundary", name: "行政界", layers: ["AdmBdry"] },
  { key: "structure", name: "構造物・特定地区", layers: ["StrctArea", "StrctLine", "SpcfArea"] },
  { key: "power", name: "送電線", layers: ["PwrTrnsmL"] },
];
const VT_QUICK = {
  all: { name: "すべて", hidden: [] },
  simple: { name: "シンプル", hidden: ["label_icon", "contour", "terrain", "structure", "power", "boundary"] },
  terrain: { name: "地形を見る", hidden: ["label_icon", "building", "structure", "power"] },
  town: { name: "まち歩き", hidden: ["contour", "terrain", "power", "boundary"] },
};

/* ---------- スタイルのプリセット ---------- */
// 色の役割：bg 背景, land 陸, water 水面, waterLine 水涯線, waterText 水部の文字, green 緑地, building 建物, buildingLine 建物の線,
// road 道路, roadCasing 道路のふち, roadMajor 主要道路, rail 鉄道, railLight 鉄道の白い部分, contour 等高線, boundary 行政界,
// structure 構造物, structureLine 構造物の線, text 文字, halo 文字のふち
const VT_PRESETS = {
  std: { name: "標準", sub: "地理院地図の標準の配色" },
  pale: { name: "淡色", sub: "色を薄くして、重ねたメモや PDF 地図を見やすく", pale: true },
  ivory: {
    name: "Ivory", sub: "アイボリーの余白と細い線。主要道路だけテラコッタ", serif: true, icon: 0.55,
    c: { bg: "#F3F0E8", land: "#F3F0E8", water: "#CBD7DA", waterLine: "#93ACB5", waterText: "#5E7E8A", green: "#DFE4D2", building: "#E4DDCF", buildingLine: "#CDC4B2",
      road: "#FBF9F4", roadCasing: "#BDB4A5", roadMajor: "#D9765A", rail: "#4A4F55", railLight: "#F3F0E8", contour: "#D9CDB8", boundary: "#9C8F7A",
      structure: "#E8E2D5", structureLine: "#B9B0A0", text: "#3B3A36", halo: "#F3F0E8" },
  },
  ember: {
    name: "Emberline", sub: "夕映えの赤とアンバー。暖かい紙の色", serif: true, icon: 0.5,
    c: { bg: "#F2ECE3", land: "#F2ECE3", water: "#E5D6CC", waterLine: "#C9907E", waterText: "#9A5A4C", green: "#EADFC6", building: "#ECD9CC", buildingLine: "#D8BBAA",
      road: "#FBF7F1", roadCasing: "#C2AC9C", roadMajor: "#C9452F", rail: "#7A2A2E", railLight: "#F2ECE3", contour: "#E6C9A2", boundary: "#B07A55",
      structure: "#EDE1D4", structureLine: "#C2A893", text: "#5A2A27", halo: "#F2ECE3" },
  },
  interlude: {
    name: "Bright Interlude", sub: "くすんだ青とコーラル、からし色のアクセント", serif: true, icon: 0.6,
    c: { bg: "#F4F1EA", land: "#F4F1EA", water: "#AECBD7", waterLine: "#7FA7B9", waterText: "#4F7486", green: "#E9DDB0", building: "#E8E1D5", buildingLine: "#CFC6B6",
      road: "#FFFFFF", roadCasing: "#B9BBB6", roadMajor: "#E07A5F", rail: "#5D6B73", railLight: "#F4F1EA", contour: "#E1D3B4", boundary: "#8D99A0",
      structure: "#EAE5DC", structureLine: "#B8B2A7", text: "#3E4A52", halo: "#F4F1EA" },
  },
  dialogue: {
    name: "Vertical Dialogue", sub: "深い緑とスレート。落ち着いた寺社・庭園の色", serif: true, icon: 0.55,
    c: { bg: "#F1EEE6", land: "#F1EEE6", water: "#C5D2CF", waterLine: "#6F8C87", waterText: "#4D6A65", green: "#D6DDCA", building: "#DDD9CD", buildingLine: "#C3BFB2",
      road: "#FAF8F2", roadCasing: "#A9A99D", roadMajor: "#2F4A3E", rail: "#2F3B3A", railLight: "#F1EEE6", contour: "#CFD4C2", boundary: "#8A6F5E",
      structure: "#E4E1D7", structureLine: "#A9A69B", text: "#2F3B3A", halo: "#F1EEE6" },
  },
  sumi: {
    name: "墨", sub: "モノクロ。印刷や書き込み用に", serif: true, icon: 0.5,
    c: { bg: "#F4F2EC", land: "#F4F2EC", water: "#DEDCD5", waterLine: "#8B8A85", waterText: "#5E5D59", green: "#E8E6DF", building: "#E3DFD6", buildingLine: "#B9B4AA",
      road: "#FCFBF7", roadCasing: "#9E9A92", roadMajor: "#3A3A3A", rail: "#2B2B2B", railLight: "#F4F2EC", contour: "#CFC9BD", boundary: "#77736C",
      structure: "#E9E6DF", structureLine: "#A8A39A", text: "#2B2B2B", halo: "#F4F2EC" },
  },
  night: {
    name: "Night", sub: "暗い背景にアンバーの道路。夜間や屋外の照り返しに", serif: false, icon: 0.7,
    c: { bg: "#1E2124", land: "#1E2124", water: "#26343D", waterLine: "#4E6A7A", waterText: "#8FB0C2", green: "#232A26", building: "#2C3034", buildingLine: "#3A3F44",
      road: "#3A3F44", roadCasing: "#15181A", roadMajor: "#E0A458", rail: "#9AA0A6", railLight: "#1E2124", contour: "#343A3E", boundary: "#6B6F74",
      structure: "#2A2E31", structureLine: "#474C51", text: "#DCD6CB", halo: "#1E2124" },
  },
};

/* ---------- 色の変換 ---------- */
function parseColor(s) {
  if (typeof s !== "string") return null;
  let m = s.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/i);
  if (m) return [+m[1], +m[2], +m[3], m[4] == null ? 1 : +m[4]];
  m = s.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (m) {
    const x = m[1].length === 3 ? m[1].replace(/./g, (c) => c + c) : m[1];
    return [parseInt(x.slice(0, 2), 16), parseInt(x.slice(2, 4), 16), parseInt(x.slice(4, 6), 16), 1];
  }
  return null;
}
const rgbaStr = ([r, g, b, a]) => `rgba(${Math.round(r)},${Math.round(g)},${Math.round(b)},${+a.toFixed(3)})`;
function colorInfo([r, g, b]) {
  const mx = Math.max(r, g, b) / 255, mn = Math.min(r, g, b) / 255;
  return { L: (mx + mn) / 2, S: mx === mn ? 0 : (mx - mn) / (1 - Math.abs(mx + mn - 1)), blue: b > r + 25 && b >= g, green: g > r + 15 && g > b };
}
const VT_CATEGORY = {
  AdmArea: "land", WA: "water", TpgphArea: "topoArea", Cstline: "waterLine", RvrCL: "waterLine", WL: "waterLine", WRltLine: "waterRel",
  AdmBdry: "boundary", Cntr: "contour", Isbt: "contour", TpgphLine: "contour", WStrA: "structure", WStrL: "structure",
  StrctArea: "structure", StrctLine: "structure", SpcfArea: "structure", PwrTrnsmL: "structure",
  RdCL: "road", RdEdg: "road", RdCompt: "road", RailCL: "rail", RailTrCL: "rail", BldA: "building", Anno: "label",
};
/** 1 つの色を、プリセットの役割の色に置き換える */
function mapColor(cat, prop, rgba, P) {
  const i = colorInfo(rgba);
  const pick = (hex) => { const c = parseColor(hex); c[3] = rgba[3]; return c; };
  if (prop === "text-halo-color") return pick(P.halo);
  if (prop === "text-color") return pick(cat === "label" && i.blue ? P.waterText : cat === "contour" ? P.boundary : P.text);
  if (prop === "icon-color" || prop === "icon-halo-color") return rgba;
  switch (cat) {
    case "bg": return pick(i.blue ? P.water : P.bg);
    case "land": return pick(P.land);
    case "water": return pick(P.water);
    case "waterLine": return pick(i.S < 0.15 ? P.structureLine : P.waterLine);
    case "waterRel": return pick(prop.startsWith("fill") && i.L > 0.9 ? P.land : i.S < 0.15 ? P.structureLine : P.waterLine);
    case "topoArea": return pick(i.green ? P.green : P.structure);
    case "boundary": return pick(P.boundary);
    case "contour": return pick(P.contour);
    case "structure": return pick(prop.startsWith("fill") && !prop.includes("outline") ? P.structure : P.structureLine);
    case "road": return pick(i.S > 0.25 && i.L < 0.92 ? P.roadMajor : i.L < 0.5 ? P.roadCasing : P.road);
    case "rail": return pick(i.L > 0.8 && i.S < 0.3 ? P.railLight : P.rail);
    case "building": return pick(prop.startsWith("fill") && !prop.includes("outline") ? P.building : P.buildingLine);
    default: return rgba;
  }
}
/** 淡色：白に寄せて彩度を落とす */
function paleColor(prop, rgba) {
  if (prop === "text-halo-color") return rgba;
  const [r, g, b, a] = rgba;
  const y = 0.299 * r + 0.587 * g + 0.114 * b;
  const k = prop === "text-color" ? 0.25 : 0.55; // 文字は読めるよう控えめに
  const ds = (c) => c + (y - c) * 0.55;
  return [ds(r) + (255 - ds(r)) * k, ds(g) + (255 - ds(g)) * k, ds(b) + (255 - ds(b)) * k, a];
}
/** 式（step / match / interpolate…）の中の色だけを置き換える */
function recolor(v, fn) {
  if (typeof v === "string") { const c = parseColor(v); return c ? rgbaStr(fn(c)) : v; }
  if (Array.isArray(v)) return v.map((x) => recolor(x, fn));
  return v;
}

/* ---------- スタイルの組み立て ---------- */
let vtBaseStyle = null;
async function vtLoadBaseStyle() {
  if (!vtBaseStyle) {
    const r = await fetch(VT_STYLE_URL);
    if (!r.ok) throw new Error(`スタイルを取得できません（HTTP ${r.status}）`);
    const s = await r.json();
    // 公式スタイルは 1 つの大きな PMTiles を参照しているので、同じデータの XYZ タイルに差し替える（オフライン保存もできる）
    s.sources = { v: { type: "vector", tiles: [VT_TILES], minzoom: 4, maxzoom: 16, attribution: "国土地理院 最適化ベクトルタイル" } };
    vtBaseStyle = s;
  }
  return vtBaseStyle;
}
function vtBuildStyle(presetKey, hidden = []) {
  const preset = VT_PRESETS[presetKey] || VT_PRESETS.std;
  const s = JSON.parse(JSON.stringify(vtBaseStyle));
  const hide = new Set(hidden);
  const hiddenLayers = new Set(VT_GROUPS.filter((g) => hide.has(g.key) && !g.mode).flatMap((g) => g.layers));
  const textOff = hide.has("label_text"), iconOff = hide.has("label_icon");
  for (const l of s.layers) {
    const src = l["source-layer"];
    const cat = l.type === "background" ? "bg" : VT_CATEGORY[src];
    if (preset.c || preset.pale) {
      for (const [k, v] of Object.entries(l.paint || {})) {
        if (!/color$/.test(k)) continue;
        l.paint[k] = recolor(v, (c) => (preset.pale ? paleColor(k, c) : mapColor(cat, k, c, preset.c)));
      }
    }
    if (l.type === "symbol") {
      l.paint = l.paint || {};
      l.layout = l.layout || {};
      if (preset.serif && l.layout["text-font"]) l.layout["text-font"] = ["literal", ["NotoSerifJP-SemiBold"]];
      if (preset.icon != null && l.layout["icon-image"]) l.paint["icon-opacity"] = preset.icon;
      if (src === "Anno") {
        if (textOff) l.paint["text-opacity"] = 0;
        if (iconOff) l.paint["icon-opacity"] = 0;
        if (textOff && iconOff) l.layout.visibility = "none";
      }
    }
    if (hiddenLayers.has(src)) { l.layout = l.layout || {}; l.layout.visibility = "none"; }
  }
  return s;
}

/* ---------- 地図への表示 ---------- */
let vtLibPromise = null;
function vtLoadLibs() {
  if (!vtLibPromise) {
    const css = document.createElement("link");
    css.rel = "stylesheet";
    css.href = MAPLIBRE_CSS;
    document.head.append(css);
    const load = (src) => new Promise((res, rej) => {
      const s = document.createElement("script");
      s.src = src;
      s.onload = res;
      s.onerror = () => rej(new Error("地図ライブラリを読み込めません（オフライン？）"));
      document.head.append(s);
    });
    vtLibPromise = load(MAPLIBRE_JS).then(() => load(MAPLIBRE_LEAFLET_JS)).catch((e) => { vtLibPromise = null; throw e; });
  }
  return vtLibPromise;
}
const VT = { layer: null };
const vtSettings = () => ({ style: Settings.data.vtStyle || "std", hidden: Settings.data.vtHidden || [] });

/** ベース地図として地理院地図Vectorを作る（Leaflet のレイヤを返す） */
async function makeVectorBase() {
  await vtLoadLibs();
  await vtLoadBaseStyle();
  const { style, hidden } = vtSettings();
  const layer = L.maplibreGL({ style: vtBuildStyle(style, hidden), interactive: false, attributionControl: false, pane: "tilePane" });
  layer.on("add", () => { const c = layer.getContainer?.() || layer._container; if (c) c.style.zIndex = 1; });
  VT.layer = layer;
  return layer;
}
/** スタイルや表示項目の変更をすぐ反映 */
function vtApply() {
  if (!VT.layer || !vtBaseStyle) return;
  const m = VT.layer.getMaplibreMap?.();
  if (!m) return;
  const { style, hidden } = vtSettings();
  m.setStyle(vtBuildStyle(style, hidden), { diff: true });
}

/** プリセットの色見本（カード用） */
function vtSwatch(key) {
  const p = VT_PRESETS[key];
  const c = p.c || (p.pale
    ? { bg: "#FFFFFF", water: "#DDE7FA", road: "#F4F4F4", roadMajor: "#F2C9A5", building: "#EEEEEE", text: "#555555", rail: "#9A9A9A" }
    : { bg: "#FFFFFF", water: "#BED2FF", road: "#FFFFFF", roadMajor: "#F47B5C", building: "#E8DEC8", text: "#333333", rail: "#666666" });
  return h("div", { class: "vt-swatch", style: `background:${c.bg}` },
    h("i", { style: `background:${c.water};left:0;top:0;width:38%;height:100%` }),
    h("i", { style: `background:${c.building};left:46%;top:18%;width:22%;height:26%` }),
    h("i", { style: `background:${c.building};left:72%;top:52%;width:18%;height:22%` }),
    h("i", { style: `background:${c.roadMajor};left:0;top:62%;width:100%;height:7%` }),
    h("i", { style: `background:${c.rail};left:56%;top:0;width:3%;height:100%` }),
    h("b", { style: `color:${c.text}` }, "Aa"));
}

/* ---------- 地図の切替パネルの子画面 ---------- */
function vtBackButton() {
  return h("button", { type: "button", class: "chip vt-back", onclick: () => openLayers() }, "← 地図の切替に戻る");
}
function openVectorStyleSheet() {
  const grid = h("div", { class: "vt-grid" });
  const render = () => {
    grid.replaceChildren();
    const cur = vtSettings().style;
    for (const [key, p] of Object.entries(VT_PRESETS)) {
      const card = h("button", { type: "button", class: "vt-card" + (key === cur ? " on" : "") }, vtSwatch(key), h("span", { class: "vt-name" }, p.name), h("span", { class: "vt-sub" }, p.sub));
      card.onclick = () => { Settings.data.vtStyle = key; Settings.save(); vtApply(); render(); };
      grid.append(card);
    }
  };
  render();
  openSheet("地理院 Vector のスタイル", h("div", {}, vtBackButton(), grid,
    h("p", { class: "note" }, "「標準」は地理院地図の配色。Ivory・Emberline などは、ZzzLc0405/photo-abstract-editorial の「アイボリーの余白・彩度を落とした少数の色・細い線」という考え方を参考に、地図用に作った配色です。")),
  { backdrop: false, height: "60vh" });
}
function openVectorLayersSheet() {
  const box = h("div");
  const render = () => {
    box.replaceChildren();
    const hidden = new Set(vtSettings().hidden);
    const quick = h("div", { class: "chips", style: "margin-bottom:8px" }, ...Object.values(VT_QUICK).map((q) =>
      h("button", { type: "button", class: "chip" + (q.hidden.length === hidden.size && q.hidden.every((k) => hidden.has(k)) ? " on" : ""),
        onclick: () => { Settings.data.vtHidden = q.hidden.slice(); Settings.save(); vtApply(); render(); } }, q.name)));
    box.append(quick);
    for (const g of VT_GROUPS) {
      const cb = h("input", { type: "checkbox", checked: !hidden.has(g.key) });
      cb.onchange = () => {
        const s = new Set(vtSettings().hidden);
        cb.checked ? s.delete(g.key) : s.add(g.key);
        Settings.data.vtHidden = [...s];
        Settings.save();
        vtApply();
        render();
      };
      box.append(h("label", { class: "inline vt-row" }, cb, g.name));
    }
  };
  render();
  openSheet("地理院 Vector の表示する項目", h("div", {}, vtBackButton(), box), { backdrop: false, height: "60vh" });
}
