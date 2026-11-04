/* フィールドノート — 1m 標高タイル（地理院 標高タイル DEM1A）の段彩表示
 * - 標高タイル（PNG の色に標高値が入っている）を読み、端末で色を付けて表示する
 * - 1m がない所（水面・未整備の地域）は 5m → 10m で埋める
 * - 色の範囲は「表示中の範囲に自動で合わせる」か手動。段彩の間隔・陰影も選べる
 * app.js より先に読み込む（ここではトップレベルで app.js の値を使わない）
 */
"use strict";

const DEM_BASE = "https://cyberjapandata.gsi.go.jp/xyz";
const DEM_SOURCES = [
  { id: "dem1a", url: `${DEM_BASE}/dem1a_png/{z}/{x}/{y}.png`, max: 17 },
  { id: "dem5a", url: `${DEM_BASE}/dem5a_png/{z}/{x}/{y}.png`, max: 15 },
  { id: "dem5b", url: `${DEM_BASE}/dem5b_png/{z}/{x}/{y}.png`, max: 15 },
  { id: "dem10", url: `${DEM_BASE}/dem_png/{z}/{x}/{y}.png`, max: 14 },
];
const DEM_PALETTES = {
  spectral: { name: "スペクトル", colors: ["#2b5fa8", "#7cb7d6", "#e6f2c4", "#fdd38a", "#e8743b", "#a3271f"] },
  terrain: { name: "地形", colors: ["#2f6b4f", "#7fae6a", "#d9d8a0", "#c9a26b", "#8a5d3b", "#efe9df"] },
  editorial: { name: "エディトリアル", colors: ["#2F4A3E", "#8FA99A", "#F3F0E8", "#E0B87A", "#C9452F", "#7A2A2E"] },
  gray: { name: "モノクロ", colors: ["#1d1d1d", "#f4f2ec"] },
};
const DEM_STEPS = [0, 0.5, 1, 2, 5, 10];
const DEM_DEFAULT = { on: false, opacity: 0.75, palette: "spectral", auto: true, min: 0, max: 100, step: 0, shade: 0.5 };
const demCfg = () => ({ ...DEM_DEFAULT, ...(Settings.data.dem || {}) });
function demSave(patch) {
  Settings.data.dem = { ...demCfg(), ...patch };
  Settings.save();
}

/* ---------- 標高タイルの取得と復号 ---------- */
const demCache = new Map(); // url -> Promise<Float32Array|null>
function demFetch(url) {
  if (demCache.has(url)) {
    const v = demCache.get(url);
    demCache.delete(url);
    demCache.set(url, v); // 最近使ったものを後ろへ
    return v;
  }
  const p = (async () => {
    try {
      const r = await fetch(url, { mode: "cors" });
      if (!r.ok) return null;
      // 色の補正をかけると標高値が変わるので、補正なしで画素を読む
      const bmp = await createImageBitmap(await r.blob(), { colorSpaceConversion: "none", premultiplyAlpha: "none" });
      const c = document.createElement("canvas");
      c.width = c.height = 256;
      const ctx = c.getContext("2d", { willReadFrequently: true });
      ctx.drawImage(bmp, 0, 0);
      bmp.close();
      const d = ctx.getImageData(0, 0, 256, 256).data;
      const hgt = new Float32Array(256 * 256);
      for (let i = 0, j = 0; i < hgt.length; i++, j += 4) {
        if (d[j + 3] === 0) { hgt[i] = NaN; continue; }
        let v = (d[j] << 16) | (d[j + 1] << 8) | d[j + 2];
        if (v === 8388608) { hgt[i] = NaN; continue; } // 2^23 は「データなし」
        if (v > 8388608) v -= 16777216;
        hgt[i] = v * 0.01;
      }
      return hgt;
    } catch {
      return null;
    }
  })();
  demCache.set(url, p);
  while (demCache.size > 400) demCache.delete(demCache.keys().next().value);
  return p;
}
const demUrl = (src, z, x, y) => src.url.replace("{z}", z).replace("{x}", x).replace("{y}", y);

/** ある地点の標高を標高タイルから読む（1m → 5m → 10m の順。一度読んだタイルは端末に残るのでオフラインでも使える） */
const DEM_LABEL = { dem1a: "1m（DEM1A・標高タイル）", dem5a: "5m（DEM5A・標高タイル）", dem5b: "5m（DEM5B・標高タイル）", dem10: "10m（DEM10B・標高タイル）" };
async function demElevationAt(lat, lon) {
  for (const src of DEM_SOURCES) {
    const z = src.max, n = 2 ** z;
    const fx = ((lon + 180) / 360) * n, fy = ((1 - Math.asinh(Math.tan((lat * Math.PI) / 180)) / Math.PI) / 2) * n;
    const x = Math.floor(fx), y = Math.floor(fy);
    const hgt = await demFetch(demUrl(src, z, x, y));
    if (!hgt) continue;
    const i = Math.min(255, Math.floor((fx - x) * 256)), j = Math.min(255, Math.floor((fy - y) * 256));
    const v = hgt[j * 256 + i];
    if (!Number.isNaN(v)) return { value: Math.round(v * 100) / 100, src: DEM_LABEL[src.id] || src.id };
  }
  return null;
}

/** ある元データから、表示タイル (z,x,y) の範囲の標高を取り出す（元の解像度が粗ければ拡大して補間） */
async function demFromSource(src, z, x, y) {
  const nz = Math.min(z, src.max);
  if (nz === z) return demFetch(demUrl(src, z, x, y));
  const k = 2 ** (z - nz), px = Math.floor(x / k), py = Math.floor(y / k);
  const par = await demFetch(demUrl(src, nz, px, py));
  if (!par) return null;
  const ox = ((x - px * k) * 256) / k, oy = ((y - py * k) * 256) / k, s = 1 / k;
  const out = new Float32Array(256 * 256);
  for (let j = 0; j < 256; j++) {
    const fy = Math.min(255, oy + (j + 0.5) * s - 0.5), y0 = Math.max(0, Math.floor(fy)), y1 = Math.min(255, y0 + 1), ty = fy - y0;
    for (let i = 0; i < 256; i++) {
      const fx = Math.min(255, ox + (i + 0.5) * s - 0.5), x0 = Math.max(0, Math.floor(fx)), x1 = Math.min(255, x0 + 1), tx = fx - x0;
      const a = par[y0 * 256 + x0], b = par[y0 * 256 + x1], c = par[y1 * 256 + x0], d = par[y1 * 256 + x1];
      out[j * 256 + i] = (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
    }
  }
  return out;
}
/** 表示タイルの標高：1m を基本に、欠けている画素を 5m → 10m で埋める。どれを使ったかも返す */
async function demForTile(z, x, y) {
  let hgt = null, used = [];
  for (const src of DEM_SOURCES) {
    if (hgt && !hgt.some(Number.isNaN)) break;
    const part = await demFromSource(src, z, x, y);
    if (!part) continue;
    if (!hgt) { hgt = part.slice(); used.push(src.id); continue; }
    let filled = false;
    for (let i = 0; i < hgt.length; i++) if (Number.isNaN(hgt[i]) && !Number.isNaN(part[i])) { hgt[i] = part[i]; filled = true; }
    if (filled) used.push(src.id);
  }
  return { hgt, used };
}

/* ---------- 色付け ---------- */
function hexRgb(hx) { return [1, 3, 5].map((i) => parseInt(hx.slice(i, i + 2), 16)); }
function demLut(paletteKey) {
  const cols = (DEM_PALETTES[paletteKey] || DEM_PALETTES.spectral).colors.map(hexRgb);
  const lut = new Uint8ClampedArray(256 * 3);
  for (let i = 0; i < 256; i++) {
    const f = (i / 255) * (cols.length - 1), k = Math.min(cols.length - 2, Math.floor(f)), t = f - k;
    for (let c = 0; c < 3; c++) lut[i * 3 + c] = cols[k][c] * (1 - t) + cols[k + 1][c] * t;
  }
  return lut;
}
/** 標高の配列をタイルの canvas に描く（段彩＋陰影） */
function demPaint(canvas, hgt, z, y, cfg, range) {
  const ctx = canvas.getContext("2d");
  const img = ctx.createImageData(256, 256), d = img.data;
  const lut = demLut(cfg.palette);
  const [lo, hi] = range, span = Math.max(0.01, hi - lo), step = cfg.step;
  // 1 画素の地上距離（m）：陰影の傾きの計算に使う
  const lat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + 0.5)) / 2 ** z))) * 180) / Math.PI;
  const px = (40075016.686 * Math.cos((lat * Math.PI) / 180)) / (256 * 2 ** z);
  const at = (i, j) => { const v = hgt[Math.min(255, Math.max(0, j)) * 256 + Math.min(255, Math.max(0, i))]; return Number.isNaN(v) ? null : v; };
  // 光は北西・高さ 45°
  const az = (315 * Math.PI) / 180, alt = Math.PI / 4, lx = Math.sin(az) * Math.cos(alt), ly = -Math.cos(az) * Math.cos(alt), lz = Math.sin(alt);
  for (let j = 0; j < 256; j++) for (let i = 0; i < 256; i++) {
    const k = j * 256 + i, o = k * 4;
    let h = hgt[k];
    if (Number.isNaN(h)) { d[o + 3] = 0; continue; }
    if (step > 0) h = Math.floor(h / step) * step + step / 2;
    const t = Math.round(Math.max(0, Math.min(1, (h - lo) / span)) * 255) * 3;
    let r = lut[t], g = lut[t + 1], b = lut[t + 2];
    if (cfg.shade > 0) {
      // タイルの端では片側だけの差になるので、距離もそれに合わせる（端に線が出ないように）
      const c = hgt[k];
      const xr = i < 255 ? at(i + 1, j) : null, xl = i > 0 ? at(i - 1, j) : null, yd = j < 255 ? at(i, j + 1) : null, yu = j > 0 ? at(i, j - 1) : null;
      const dx = ((xr ?? c) - (xl ?? c)) / (((xr != null) + (xl != null) || 1) * px), dy = ((yd ?? c) - (yu ?? c)) / (((yd != null) + (yu != null) || 1) * px);
      const n = Math.hypot(dx, dy, 1);
      const sh = Math.max(0, (-dx * lx - dy * ly + lz) / n) / lz; // 平らな所が 1
      const m = 1 + (sh - 1) * cfg.shade;
      r *= m; g *= m; b *= m;
    }
    d[o] = r; d[o + 1] = g; d[o + 2] = b; d[o + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
}

/* ---------- 地図レイヤ ---------- */
const DemLayer = L.GridLayer.extend({
  options: { tileSize: 256, maxNativeZoom: 17, maxZoom: 20, minZoom: 5, zIndex: 9, attribution: '<a href="https://maps.gsi.go.jp/development/ichiran.html#dem" target="_blank" rel="noopener">国土地理院 標高タイル</a>' },
  initialize(opts) {
    L.setOptions(this, opts);
    this.range = null;
  },
  createTile(coords, done) {
    const c = document.createElement("canvas");
    c.width = c.height = 256;
    demForTile(coords.z, coords.x, coords.y).then(({ hgt, used }) => {
      c._dem = { hgt, z: coords.z, x: coords.x, y: coords.y, used };
      if (hgt) this._paint(c);
      done(null, c);
      this._scheduleAuto();
    });
    return c;
  },
  _cfgRange(cfg) {
    if (!cfg.auto) return [Math.min(cfg.min, cfg.max), Math.max(cfg.min, cfg.max)];
    return this.range || [0, 100];
  },
  _paint(c) {
    const cfg = demCfg();
    if (c._dem && c._dem.hgt) demPaint(c, c._dem.hgt, c._dem.z, c._dem.y, cfg, this._cfgRange(cfg));
  },
  repaint() {
    for (const t of Object.values(this._tiles || {})) this._paint(t.el);
    demLegendUpdate();
  },
  /** 自動：表示中のタイルの標高の 2〜98% を色の範囲にする */
  _scheduleAuto() {
    clearTimeout(this._autoT);
    this._autoT = setTimeout(() => this._updateAuto(), 250);
  },
  _updateAuto() {
    if (!this._map || !demCfg().auto) return demLegendUpdate();
    const b = this._map.getPixelBounds(), z = Math.round(this._map.getZoom()), ts = 256;
    const vals = [];
    for (const t of Object.values(this._tiles || {})) {
      const m = t.el._dem;
      if (!m || !m.hgt || m.z !== Math.min(z, 17)) continue;
      const k = 2 ** (z - m.z) * ts / 256; // 表示ズームと取得ズームの差を考慮
      const x0 = m.x * 256 * k, y0 = m.y * 256 * k;
      for (let j = 0; j < 256; j += 4) for (let i = 0; i < 256; i += 4) {
        const sx = x0 + i * k, sy = y0 + j * k;
        if (sx < b.min.x || sx > b.max.x || sy < b.min.y || sy > b.max.y) continue;
        const v = m.hgt[j * 256 + i];
        if (!Number.isNaN(v)) vals.push(v);
      }
    }
    if (vals.length < 50) return;
    vals.sort((a, c) => a - c);
    const lo = vals[Math.floor(vals.length * 0.02)], hi = vals[Math.ceil(vals.length * 0.98) - 1];
    const old = this.range;
    const span = Math.max(0.5, hi - lo);
    if (old && Math.abs(old[0] - lo) < span * 0.03 && Math.abs(old[1] - hi) < span * 0.03) return demLegendUpdate();
    this.range = [lo, hi < lo + 0.5 ? lo + 0.5 : hi];
    this.repaint();
  },
  onAdd(map) {
    L.GridLayer.prototype.onAdd.call(this, map);
    map.on("moveend", this._scheduleAuto, this);
    demLegendShow(true);
  },
  onRemove(map) {
    map.off("moveend", this._scheduleAuto, this);
    L.GridLayer.prototype.onRemove.call(this, map);
    demLegendShow(false);
  },
});

const DEM = { layer: null, legend: null };
function demSetOn(on) {
  demSave({ on });
  if (on) {
    if (!DEM.layer) DEM.layer = new DemLayer();
    DEM.layer.setOpacity(demCfg().opacity);
    if (!S.map.hasLayer(DEM.layer)) DEM.layer.addTo(S.map);
  } else if (DEM.layer) {
    S.map.removeLayer(DEM.layer);
  }
  if (typeof saveView === "function") saveView();
}
function demSetOpacity(op) {
  demSave({ opacity: op });
  if (DEM.layer) DEM.layer.setOpacity(op);
}
function demRestore() {
  if (demCfg().on) demSetOn(true);
}

/* ---------- 凡例（地図の左下） ---------- */
function demLegendShow(on) {
  if (!DEM.legend) {
    DEM.legend = h("div", { class: "dem-legend", hidden: true });
    DEM.legend.onclick = () => openDemSheet(false);
    document.body.append(DEM.legend);
  }
  DEM.legend.hidden = !on;
  if (on) demLegendUpdate();
}
const fmtM = (v) => (Math.abs(v) >= 100 ? v.toFixed(0) : Math.abs(v) >= 10 ? v.toFixed(1) : v.toFixed(2)).replace(/\.?0+$/, "") + " m";
function demLegendUpdate() {
  if (!DEM.legend || DEM.legend.hidden) return;
  const cfg = demCfg();
  const r = DEM.layer ? DEM.layer._cfgRange(cfg) : [cfg.min, cfg.max];
  const cols = (DEM_PALETTES[cfg.palette] || DEM_PALETTES.spectral).colors;
  DEM.legend.replaceChildren(
    h("div", { class: "dem-bar", style: `background:linear-gradient(90deg,${cols.join(",")})` }),
    h("div", { class: "dem-lab" }, h("span", {}, fmtM(r[0])), h("span", {}, `標高${cfg.auto ? "（自動）" : ""}${cfg.step ? `・${cfg.step}m 間隔` : ""}`), h("span", {}, fmtM(r[1]))));
}

/* ---------- 地図の切替パネル：行と子画面 ---------- */
function demPanelRow() {
  const cfg = demCfg();
  const cb = h("input", { type: "checkbox", checked: cfg.on });
  const rg = h("input", { type: "range", min: "0.1", max: "1", step: "0.05", value: cfg.opacity });
  cb.onchange = () => demSetOn(cb.checked);
  rg.oninput = () => { if (!cb.checked) { cb.checked = true; demSetOn(true); } demSetOpacity(Number(rg.value)); };
  return h("div", {},
    h("div", { class: "ov-row", style: "border-bottom:0" }, cb, h("div", {}, "1m標高（段彩）", h("small", {}, "1m 標高タイルを表示範囲に合わせて色分け。水面や未整備の所は 5m・10m で補完")), rg),
    h("div", { class: "dem-tools" }, h("button", { type: "button", class: "btn secondary", onclick: () => openDemSheet(true) }, "色・範囲・陰影の設定")));
}
function openDemSheet(fromPanel) {
  if (!demCfg().on) demSetOn(true);
  const body = h("div");
  const render = () => {
    const cfg = demCfg();
    const back = fromPanel ? h("button", { type: "button", class: "chip vt-back", onclick: () => openLayers() }, "← 地図の切替に戻る") : null;
    const pal = h("div", { class: "dem-pals" }, ...Object.entries(DEM_PALETTES).map(([k, p]) =>
      h("button", { type: "button", class: "dem-pal" + (cfg.palette === k ? " on" : ""), onclick: () => { demSave({ palette: k }); DEM.layer?.repaint(); render(); } },
        h("i", { style: `background:linear-gradient(90deg,${p.colors.join(",")})` }), p.name)));
    const autoCb = h("input", { type: "checkbox", checked: cfg.auto });
    const r = DEM.layer ? DEM.layer._cfgRange(cfg) : [cfg.min, cfg.max];
    const minIn = h("input", { type: "number", step: "0.1", value: +r[0].toFixed(1), disabled: cfg.auto, inputmode: "decimal" });
    const maxIn = h("input", { type: "number", step: "0.1", value: +r[1].toFixed(1), disabled: cfg.auto, inputmode: "decimal" });
    autoCb.onchange = () => {
      // 手動に切り替えるときは、今の自動の範囲から始める
      const cur = DEM.layer ? DEM.layer._cfgRange(demCfg()) : [cfg.min, cfg.max];
      demSave({ auto: autoCb.checked, min: +cur[0].toFixed(1), max: +cur[1].toFixed(1) });
      if (autoCb.checked && DEM.layer) { DEM.layer.range = null; DEM.layer._updateAuto(); }
      DEM.layer?.repaint();
      render();
    };
    const applyMan = () => { demSave({ min: Number(minIn.value), max: Number(maxIn.value) }); DEM.layer?.repaint(); };
    minIn.onchange = applyMan;
    maxIn.onchange = applyMan;
    const steps = h("div", { class: "chips" }, ...DEM_STEPS.map((s) =>
      h("button", { type: "button", class: "chip" + (cfg.step === s ? " on" : ""), onclick: () => { demSave({ step: s }); DEM.layer?.repaint(); render(); } }, s ? `${s} m` : "なめらか")));
    const shade = h("input", { type: "range", min: "0", max: "1", step: "0.05", value: cfg.shade });
    shade.onchange = () => { demSave({ shade: Number(shade.value) }); DEM.layer?.repaint(); };
    body.replaceChildren(back || "",
      h("div", { class: "sect-title" }, "色"), pal,
      h("div", { class: "sect-title" }, "色を付ける標高の範囲"),
      h("label", { class: "inline" }, autoCb, "表示中の範囲に自動で合わせる（わずかな起伏も見える）"),
      h("div", { class: "dem-range" }, h("label", {}, "下限 (m)", minIn), h("label", {}, "上限 (m)", maxIn)),
      h("div", { class: "sect-title" }, "段彩の間隔"), steps,
      h("div", { class: "sect-title" }, "陰影の強さ"), shade,
      h("p", { class: "note" }, "国土地理院の標高タイル（1m：DEM1A）を使い、端末で色を付けています。ズーム 17 を超えると 1m の格子を拡大して表示します。1m のデータがない所（水面、未整備の地域）は 5m・10m の標高で補っています。地図の左下の凡例をタップしてもこの画面を開けます。"));
  };
  render();
  openSheet("1m標高の設定", body, { backdrop: false, height: "62vh" });
}
