/* フィールドノート — 地図の印刷・PDF / 画像出力
 * - 用紙・向き・縮尺を決め、地図の上の枠で範囲を合わせる
 * - 印刷するレイヤ（背景・重ねる地図・1m標高・PDF/画像の地図・軌跡・メモ）を選ぶ
 * - 方位記号・スケールバー・凡例（任意）を配置して、1 枚の画像に描く
 * - PDF（外部ライブラリなし。JPEG を 1 ページに貼る）・PNG・ブラウザの印刷で出力
 */
"use strict";

const PR_PAPERS = { A5: [148, 210], A4: [210, 297], B4: [257, 364], A3: [297, 420] };
const PR_SCALES = [0, 1000, 2500, 5000, 10000, 25000, 50000, 100000]; // 0 = 枠の大きさで決める
const PR_DPIS = { 150: "標準（150 dpi）", 200: "高画質（200 dpi）", 300: "最高（300 dpi）" };
const PR_SIZES = { 0.8: "小さめ", 1: "標準", 1.3: "大きめ" };
const PR_CORNERS = { tr: "右上", tl: "左上", br: "右下", bl: "左下", none: "入れない" };
const PR_DEFAULT = {
  paper: "A4", orient: "portrait", scale: 0, dpi: 200, size: 1, title: "",
  north: "tr", scalebar: "bl", legend: true, legendPos: "br", memoLabels: true, off: [],
};
const PR_MAX_AREA = 14e6;     // スマホの canvas 上限より少し小さく
const PR_MAX_TILES = 900;     // 1 レイヤで読み込むタイルの上限
const EARTH_C = 40075016.686; // メルカトルの赤道一周 (m)
const PR_FONT = '"Hiragino Sans", "Hiragino Kaku Gothic ProN", "Noto Sans JP", "Yu Gothic", Meiryo, sans-serif';

const prCfg = () => ({ ...PR_DEFAULT, ...(Settings.data.print || {}) });
function prSave(patch) {
  Settings.data.print = { ...prCfg(), ...patch };
  Settings.save();
}
const prFmt = (n) => Math.round(n).toLocaleString("ja-JP");
const prRound3 = (n) => { const p = 10 ** Math.max(0, Math.floor(Math.log10(n)) - 1); return Math.round(n / p) * p; };

/** 用紙上の配置（mm） */
function prLayout(cfg) {
  let [pw, ph] = PR_PAPERS[cfg.paper] || PR_PAPERS.A4;
  if (cfg.orient === "landscape") [pw, ph] = [ph, pw];
  const m = 10, titleH = cfg.title ? 13 : 0, footH = 10;
  return { pw, ph, map: { x: m, y: m + titleH, w: pw - 2 * m, h: ph - 2 * m - titleH - footH }, m, titleH, footH };
}

/* ====================================================================
 * 印刷できるレイヤ（いま地図に表示しているもの）
 * ==================================================================== */
function prCandidates() {
  const list = [];
  const bdef = BASE_LAYERS.find((b) => b.id === S.baseId);
  if (bdef) {
    const style = bdef.vector ? `（${vtStyleName(vtSettings().style)}）` : "";
    list.push({ key: "base", name: `背景：${bdef.name}${style}`, kind: bdef.vector ? "vector" : "tile", def: bdef, opacity: 1, z: 1 });
  }
  if (demCfg().on) list.push({ key: "dem", name: "1m標高（段彩）", kind: "dem", opacity: demCfg().opacity, z: 9 });
  for (const [id, o] of Object.entries(S.overlays)) {
    const def = OVERLAYS.find((d) => d.id === id);
    if (def) list.push({ key: "ov:" + id, name: def.name, kind: "tile", def, opacity: o.opacity, z: 10 + OVERLAYS.indexOf(def) });
  }
  list.push(...extraPrintCandidates());
  list.sort((a, b) => a.z - b.z);
  // データ（緑・不動産情報ライブラリ・e-Stat）は PDF 地図の下
  list.push(...dataPrintCandidates());
  for (const it of [...PDFL.items.values()].filter((x) => x.rec.visible !== false).sort((a, b) => (a.rec.order || 0) - (b.rec.order || 0))) {
    list.push({ key: "pdf:" + it.rec.id, name: it.rec.title || "重ねた地図", kind: "pdf", it });
  }
  const lines = prTrackLines();
  list.push({ key: "tracks", name: lines.length ? `軌跡（表示中の ${lines.length} 本）` : "軌跡（表示中のものなし）", kind: "tracks", lines });
  list.push({ key: "memos", name: `メモ（${S.memos.size} 件のうち範囲内）`, kind: "memos" });
  return list;
}
function prTrackLines() {
  return [...S.shownTracks.values(), S.trackLine].filter((l) => l && S.map.hasLayer(l));
}
const prIsOn = (cfg, key) => !cfg.off.includes(key);

/* ====================================================================
 * 範囲を決める画面（地図の上に枠を出す）
 * ==================================================================== */
const PR = { active: false, frame: null, bar: null, info: null };

function openPrint() {
  closeSheet(true);
  if (S.measure) endMeasure();
  setFollow(false);
  // 印刷は北が上。範囲の枠を合わせる間は回転を止める
  if (S.map.setBearing) { S.map.setBearing(0); S.map.touchRotate?.disable(); }
  if (!PR.active) {
    PR.active = true;
    document.body.classList.add("print-mode");
    PR.frame = h("div", { class: "pr-frame" }, h("i", { class: "pr-n" }, "北"));
    PR.info = h("div", { class: "pr-info" });
    PR.bar = h("div", { class: "pr-bar glass" }, PR.info,
      h("div", { class: "pr-actions" },
        h("button", { type: "button", class: "btn secondary", onclick: openPrintSettings }, "設定"),
        h("button", { type: "button", class: "btn primary", onclick: prPreview }, "プレビュー・出力"),
        h("button", { type: "button", class: "btn secondary", onclick: closePrint }, "終了")));
    document.body.append(PR.frame, PR.bar);
    S.map.on("move zoom resize", prUpdateFrame);
    window.addEventListener("resize", prUpdateFrame);
  }
  prUpdateFrame();
  if (!Settings.data.print) openPrintSettings();
}
function closePrint() {
  if (!PR.active) return;
  PR.active = false;
  document.body.classList.remove("print-mode");
  PR.frame.remove();
  PR.bar.remove();
  S.map.off("move zoom resize", prUpdateFrame);
  window.removeEventListener("resize", prUpdateFrame);
  S.map.touchRotate?.enable();
}

/** 画面で使える範囲（枠を置ける場所） */
function prAvailRect() {
  if (PR.safeTop == null) {
    // env(safe-area-inset-top) の実際の値を測る（ノッチのある端末の PWA 用）
    const p = h("div", { style: "position:fixed;top:0;height:var(--safe-top);visibility:hidden;pointer-events:none" });
    document.body.append(p);
    PR.safeTop = p.getBoundingClientRect().height || 0;
    p.remove();
  }
  const top = 10 + PR.safeTop;
  const bottom = PR.bar ? PR.bar.getBoundingClientRect().top - 10 : window.innerHeight - 10;
  return { x: 14, y: top, w: window.innerWidth - 28, h: Math.max(80, bottom - top) };
}
const prMercPerCss = () => EARTH_C / (256 * 2 ** S.map.getZoom());

/** 印刷範囲（メルカトル座標）を計算。枠の中心が範囲の中心 */
function prExtent(cfg = prCfg()) {
  const L0 = prLayout(cfg), aspect = L0.map.w / L0.map.h;
  const a = prAvailRect();
  const cRect = S.map.getContainer().getBoundingClientRect();
  const center = S.map.containerPointToLatLng([a.x + a.w / 2 - cRect.left, a.y + a.h / 2 - cRect.top]);
  const [cx, cy] = toMerc(center.lat, center.lng);
  const cos = Math.cos(rad(center.lat));
  let w;
  if (cfg.scale) w = ((L0.map.w / 1000) * cfg.scale) / cos;
  else {
    const fw = Math.min(a.w, a.h * aspect);
    w = fw * prMercPerCss();
  }
  const hgt = w / aspect;
  const scale = cfg.scale || (w * cos) / (L0.map.w / 1000);
  return { cx, cy, w, h: hgt, minX: cx - w / 2, maxX: cx + w / 2, minY: cy - hgt / 2, maxY: cy + hgt / 2, lat: center.lat, scale, layout: L0 };
}

function prUpdateFrame() {
  if (!PR.active) return;
  const cfg = prCfg(), ext = prExtent(cfg), a = prAvailRect();
  const fw = ext.w / prMercPerCss(), fh = ext.h / prMercPerCss();
  Object.assign(PR.frame.style, { left: a.x + a.w / 2 - fw / 2 + "px", top: a.y + a.h / 2 - fh / 2 + "px", width: fw + "px", height: fh + "px" });
  const over = fw > a.w + 1 || fh > a.h + 1;
  const tiny = fw < 60 || fh < 60;
  PR.info.replaceChildren(
    h("b", {}, `${cfg.paper} ${cfg.orient === "landscape" ? "横" : "縦"}・縮尺 ${cfg.scale ? "" : "約"}1:${prFmt(cfg.scale || prRound3(ext.scale))}`),
    h("span", {}, over ? "　枠が画面からはみ出しています。縮小（ピンチイン）すると全体が見えます"
      : tiny ? "　枠が小さいので拡大すると確認しやすくなります"
        : cfg.scale ? "　地図を動かして、枠に印刷範囲を合わせてください" : "　地図を動かす・拡大縮小して、枠に印刷範囲を合わせてください"));
}

/* ====================================================================
 * 範囲ファイル（Vector Studio の vector-studio-range 形式と相互にやり取り）
 *  rect_world：Web メルカトルの正規化座標 [x0, y0, x1, y1]（0〜1・y は下向き）、bbox_wgs84：[西, 南, 東, 北]
 * ==================================================================== */
const prR7 = (v) => Math.round(v * 1e7) / 1e7;
const prNormX = (mx) => (mx + EARTH_C / 2) / EARTH_C, prNormY = (my) => (EARTH_C / 2 - my) / EARTH_C;
const prLonOf = (x) => x * 360 - 180, prLatOf = (y) => (Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) * 180) / Math.PI;
function prSaveRange() {
  const cfg = prCfg(), ext = prExtent(cfg);
  const r = [prNormX(ext.minX), prNormY(ext.maxY), prNormX(ext.maxX), prNormY(ext.minY)];
  const g = [prLonOf(r[0]), prLatOf(r[3]), prLonOf(r[2]), prLatOf(r[1])].map(prR7);
  const cos = Math.cos(rad(ext.lat));
  const size = { width: Math.round(ext.w * cos * 10) / 10, height: Math.round(ext.h * cos * 10) / 10 };
  const name = cfg.title || Settings.data.project || "印刷範囲";
  const doc = {
    type: "FeatureCollection", name: "vector-studio-range", bbox: g,
    vectorStudioRange: {
      format: "vector-studio-range", version: "1.0.0", app: "フィールドノート", createdAt: new Date().toISOString(), name, from: "rect",
      rect_world: r, bbox_wgs84: g, center_wgs84: [prR7((g[0] + g[2]) / 2), prR7(prLatOf((r[1] + r[3]) / 2))], size_m: size,
      crs: { geometry: "OGC:CRS84（経度, 緯度・WGS84）", rect_world: "Webメルカトル正規化座標 [x0, y0, x1, y1]（0〜1・y は下向き。x=(経度+180)/360）" },
      fieldnote: { paper: cfg.paper, orient: cfg.orient, scale: cfg.scale || prRound3(ext.scale) },
    },
    features: [{ type: "Feature", properties: { name, kind: "output-range", west: g[0], south: g[1], east: g[2], north: g[3], width_m: size.width, height_m: size.height },
      geometry: { type: "Polygon", coordinates: [[[g[0], g[1]], [g[2], g[1]], [g[2], g[3]], [g[0], g[3]], [g[0], g[1]]]] } }],
  };
  deliverBlob(new Blob([JSON.stringify(doc, null, 1)], { type: "application/geo+json" }), `vector-studio-range_${(safeName(name) || "").replace(/[^\x21-\x7e]/g, "") || "fieldnote"}_${stamp()}.geojson`, "application/geo+json", "download");
  toast(`範囲（${fmtDist(size.width)} × ${fmtDist(size.height)}）を保存しました`);
}
/** 範囲ファイル・GeoJSON・KML・.gsf から [西, 南, 東, 北] を得る */
async function prRangeFromFile(f) {
  const ext = (f.name.split(".").pop() || "").toLowerCase();
  if (ext === "gsf") return { box: imGsfBox(await f.arrayBuffer()), label: "jSTAT MAP の全地域" };
  if (ext === "kml") return { box: imBbox(imParseKml(imDecodeText(await f.arrayBuffer()), f.name).features), label: "KML の全図形" };
  const o = JSON.parse(imDecodeText(await f.arrayBuffer()));
  const vr = o.vectorStudioRange || (o.format === "vector-studio-range" ? o : null);
  if (vr) {
    if (Array.isArray(vr.bbox_wgs84)) return { box: vr.bbox_wgs84, label: `範囲ファイル「${vr.name || ""}」`, fieldnote: vr.fieldnote };
    if (Array.isArray(vr.rect_world)) { const r = vr.rect_world; return { box: [prLonOf(r[0]), prLatOf(r[3]), prLonOf(r[2]), prLatOf(r[1])], label: "範囲ファイル" }; }
  }
  if (Array.isArray(o.bounds) && o.bounds.length === 4) return { box: o.bounds, label: "manifest の範囲" };
  return { box: imBbox(imParseGeoJSON(o, f.name).features), label: "GeoJSON の全図形" };
}
async function prLoadRange(f) {
  const { box, label, fieldnote } = await prRangeFromFile(f);
  if (!box || !(box[2] > box[0] && box[3] > box[1])) throw new Error("範囲の幅または高さが 0 です");
  if (box.some((v) => !Number.isFinite(v)) || Math.abs(box[0]) > 180 || Math.abs(box[3]) > 85.06) throw new Error("経緯度の範囲ではありません");
  const [x0, y0] = toMerc(box[1], box[0]), [x1, y1] = toMerc(box[3], box[2]);
  const latC = (box[1] + box[3]) / 2, cos = Math.cos(rad(latC));
  const gw = (x1 - x0) * cos, gh = (y1 - y0) * cos;
  const cur = prCfg();
  // 範囲の形に近い向きを選び、範囲全体が入る縮尺（上 2 桁で切り上げ）にする
  const orient = fieldnote?.orient || (gw >= gh ? "landscape" : "portrait");
  const L0 = prLayout({ ...cur, orient });
  let scale = fieldnote?.scale || Math.max(gw / (L0.map.w / 1000), gh / (L0.map.h / 1000));
  if (!fieldnote?.scale) { const p = 10 ** Math.max(0, Math.floor(Math.log10(scale)) - 1); scale = Math.ceil(scale / p) * p; }
  prSave({ orient, scale: Math.round(scale), ...(fieldnote?.paper ? { paper: fieldnote.paper } : {}) });
  const c = fromMerc((x0 + x1) / 2, (y0 + y1) / 2);
  closeSheet(true);
  if (!PR.active) openPrint();
  const a = prAvailRect(), mpcNeeded = Math.max((x1 - x0) / (a.w * 0.92), (y1 - y0) / (a.h * 0.92));
  const z = Math.max(3, Math.min(19, Math.floor(Math.log2(EARTH_C / (256 * mpcNeeded)))));
  setFollow(false);
  S.map.setView(c, z, { animate: false });
  prUpdateFrame();
  toast(`${label}を読み込みました（${fmtDist(gw)} × ${fmtDist(gh)}・縮尺 1:${prFmt(scale)}）`, 4000);
}

/* ====================================================================
 * 設定
 * ==================================================================== */
function openPrintSettings() {
  const cfg = prCfg();
  const sel = (opts, cur, onch) => {
    const s = h("select", {}, ...Object.entries(opts).map(([v, t]) => h("option", { value: v, selected: String(cur) === String(v) }, t)));
    s.onchange = () => onch(s.value);
    return s;
  };
  const set = (patch) => { prSave(patch); prUpdateFrame(); };
  const title = h("input", { type: "text", value: cfg.title, placeholder: Settings.data.project ? `例：${Settings.data.project}` : "例：犬山城下町 調査範囲図" });
  title.oninput = () => set({ title: title.value });
  const paper = sel(Object.fromEntries(Object.keys(PR_PAPERS).map((k) => [k, k])), cfg.paper, (v) => set({ paper: v }));
  const orient = sel({ portrait: "縦", landscape: "横" }, cfg.orient, (v) => set({ orient: v }));
  const scaleOpts = Object.fromEntries(PR_SCALES.map((s) => [s, s ? `1:${prFmt(s)}` : "枠の大きさで決める（拡大縮小で調整）"]));
  if (cfg.scale && !PR_SCALES.includes(cfg.scale)) scaleOpts[cfg.scale] = `1:${prFmt(cfg.scale)}（読み込んだ範囲から）`;
  const scale = sel(scaleOpts, cfg.scale, (v) => set({ scale: Number(v) }));
  const dpi = sel(PR_DPIS, cfg.dpi, (v) => set({ dpi: Number(v) }));
  const size = sel(PR_SIZES, cfg.size, (v) => set({ size: Number(v) }));
  const north = sel(PR_CORNERS, cfg.north, (v) => set({ north: v }));
  const sbar = sel(PR_CORNERS, cfg.scalebar, (v) => set({ scalebar: v }));
  const legendCb = h("input", { type: "checkbox", checked: cfg.legend });
  const legendPos = sel(Object.fromEntries(Object.entries(PR_CORNERS).filter(([k]) => k !== "none")), cfg.legendPos, (v) => set({ legendPos: v }));
  legendCb.onchange = () => { set({ legend: legendCb.checked }); legendPos.disabled = !legendCb.checked; };
  legendPos.disabled = !cfg.legend;
  const labelsCb = h("input", { type: "checkbox", checked: cfg.memoLabels });
  labelsCb.onchange = () => set({ memoLabels: labelsCb.checked });

  const layers = h("div", { class: "pr-layers" });
  for (const c of prCandidates()) {
    const cb = h("input", { type: "checkbox", checked: prIsOn(cfg, c.key), disabled: c.kind === "tracks" && !c.lines.length });
    cb.onchange = () => {
      const off = new Set(prCfg().off);
      if (cb.checked) off.delete(c.key); else off.add(c.key);
      set({ off: [...off] });
    };
    layers.append(h("label", { class: "inline" }, cb, c.name));
    if (c.kind === "memos") layers.append(h("label", { class: "inline pr-sub" }, labelsCb, "メモのタイトルも入れる"));
  }

  const rangeIn = h("input", { type: "file", hidden: true, accept: ".geojson,.json,.kml,.gsf" });
  rangeIn.onchange = async () => { const f = rangeIn.files[0]; rangeIn.value = ""; if (f) { try { await prLoadRange(f); } catch (e) { alert("範囲を読み込めませんでした：" + e.message); } } };
  const body = h("div", { class: "pr-settings" },
    h("label", {}, "タイトル（空欄なら入れない）", title),
    h("div", { class: "pr-grid" }, h("label", {}, "用紙", paper), h("label", {}, "向き", orient)),
    h("label", {}, "縮尺", scale),
    h("div", { class: "pr-grid" }, h("label", {}, "画質", dpi), h("label", {}, "文字・記号の大きさ", size)),
    h("div", { class: "sect-title" }, "印刷するもの"),
    h("p", { class: "note", style: "margin-top:0" }, "いま地図に表示しているレイヤから選べます。ほかのレイヤは「地図の切替」で表示してから選んでください。"),
    layers,
    h("div", { class: "sect-title" }, "範囲ファイル（Vector Studio と共通）"),
    h("div", { class: "menu-grid" },
      h("button", { type: "button", class: "btn secondary", onclick: prSaveRange }, "範囲を保存"),
      h("button", { type: "button", class: "btn secondary", onclick: () => rangeIn.click() }, "範囲を読み込む")), rangeIn,
    h("p", { class: "note" }, "今の印刷範囲を範囲ファイル（GeoJSON・vector-studio-range 形式）に保存します。Vector Studio の範囲ファイルのほか、GeoJSON・KML・.gsf を読み込むと、その全体が収まる縮尺と範囲にします。"),
    h("div", { class: "sect-title" }, "配置"),
    h("div", { class: "pr-grid" }, h("label", {}, "方位記号", north), h("label", {}, "スケールバー", sbar)),
    h("label", { class: "inline" }, legendCb, "凡例を入れる"),
    h("label", {}, "凡例の位置", legendPos),
    h("div", { class: "menu-grid", style: "margin-top:12px" },
      h("button", { type: "button", class: "btn secondary", onclick: () => closeSheet(true) }, "範囲を合わせる"),
      h("button", { type: "button", class: "btn primary", onclick: () => { closeSheet(true); prPreview(); } }, "プレビュー・出力")));
  openSheet("印刷・画像出力の設定", body, { backdrop: false, height: "70vh", onClose: prUpdateFrame });
}

/* ====================================================================
 * 描画
 * ==================================================================== */
function prLoadImage(url) {
  return new Promise((res) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.decoding = "async";
    img.onload = () => res(img);
    img.onerror = () => res(null);
    img.src = url;
  });
}
async function prPool(items, n, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const k = i++; await fn(items[k], k); }
  }));
}
/** 範囲にかかるタイルの番号 */
function prTileRange(ext, z) {
  const n = 2 ** z, ts = EARTH_C / n, x0w = -EARTH_C / 2;
  const tx0 = Math.max(0, Math.floor((ext.minX - x0w) / ts)), tx1 = Math.min(n - 1, Math.floor((ext.maxX - x0w) / ts));
  const ty0 = Math.max(0, Math.floor((EARTH_C / 2 - ext.maxY) / ts)), ty1 = Math.min(n - 1, Math.floor((EARTH_C / 2 - ext.minY) / ts));
  return { tx0, tx1, ty0, ty1, count: (tx1 - tx0 + 1) * (ty1 - ty0 + 1), ts };
}
/** 描く解像度に合うズームを選ぶ（タイルの数が多すぎるときは下げる） */
function prPickZoom(ext, r, k, zmin, zmax) {
  let z = Math.round(Math.log2(EARTH_C / (256 * k * r)));
  z = Math.max(zmin, Math.min(zmax, z));
  while (z > 0 && prTileRange(ext, z).count > PR_MAX_TILES) z--;
  return z;
}
/** タイル 1 枚の描画先（出力 px、継ぎ目が出ないよう整数に丸める） */
function prTileRect(ext, r, z, tx, ty) {
  const ts = EARTH_C / 2 ** z;
  const X = (x) => Math.round((x - ext.minX) / r), Y = (y) => Math.round((ext.maxY - y) / r);
  const mx0 = -EARTH_C / 2 + tx * ts, my0 = EARTH_C / 2 - ty * ts;
  const x = X(mx0), y = Y(my0);
  return [x, y, X(mx0 + ts) - x, Y(my0 - ts) - y];
}

async function prDrawTiles(lctx, ext, r, k, def, progress) {
  const z = prPickZoom(ext, r, k, def.min || 0, def.max);
  const t = prTileRange(ext, z);
  const jobs = [];
  for (let ty = t.ty0; ty <= t.ty1; ty++) for (let tx = t.tx0; tx <= t.tx1; tx++) jobs.push([tx, ty]);
  let done = 0;
  await prPool(jobs, 8, async ([tx, ty]) => {
    const img = await prLoadImage(def.url.replace("{z}", z).replace("{x}", tx).replace("{y}", def.tms ? 2 ** z - 1 - ty : ty));
    if (img) lctx.drawImage(img, ...prTileRect(ext, r, z, tx, ty));
    progress(++done, jobs.length);
  });
}

async function prDrawVector(lctx, ext, r, k, mw, mh, styleObj) {
  await vtLoadLibs();
  if (!styleObj) {
    await vtLoadBaseStyle();
    await vtPrepareSource();
    const { style, hidden } = vtSettings();
    styleObj = vtBuildStyle(style, hidden);
  }
  const cssW = Math.max(1, Math.round(mw / k)), cssH = Math.max(1, Math.round(mh / k));
  const div = h("div", { style: `position:fixed;left:-${cssW + 1000}px;top:0;width:${cssW}px;height:${cssH}px;pointer-events:none` });
  document.body.append(div);
  const c = fromMerc(ext.cx, ext.cy);
  const map = new maplibregl.Map({
    container: div, style: styleObj, center: [c.lng, c.lat], zoom: Math.log2(EARTH_C / (512 * r * k)),
    interactive: false, attributionControl: false, fadeDuration: 0, pixelRatio: k, maxZoom: 24,
    preserveDrawingBuffer: true, canvasContextAttributes: { preserveDrawingBuffer: true, antialias: true }, maxCanvasSize: [8192, 8192],
  });
  try {
    await new Promise((res) => {
      const t = setTimeout(res, 45000);
      map.once("idle", () => { clearTimeout(t); res(); });
    });
    lctx.drawImage(map.getCanvas(), 0, 0, mw, mh);
  } finally {
    map.remove();
    div.remove();
  }
}

/** 1m標高：範囲のタイルを読み、色の範囲を求めてから描く */
async function prDrawDem(lctx, ext, r, k, progress) {
  const cfg = demCfg();
  const z = prPickZoom(ext, r, k, 5, 17);
  const t = prTileRange(ext, z);
  const jobs = [];
  for (let ty = t.ty0; ty <= t.ty1; ty++) for (let tx = t.tx0; tx <= t.tx1; tx++) jobs.push([tx, ty]);
  const tiles = [];
  let done = 0;
  await prPool(jobs, 6, async ([tx, ty]) => {
    const { hgt } = await demForTile(z, tx, ty);
    if (hgt) tiles.push({ tx, ty, hgt });
    progress(++done, jobs.length);
  });
  let range;
  if (cfg.auto) {
    const vals = [];
    for (const tl of tiles) {
      const [x, y, w, hh] = prTileRect(ext, r, z, tl.tx, tl.ty);
      for (let j = 0; j < 256; j += 4) for (let i = 0; i < 256; i += 4) {
        const px = x + (i / 256) * w, py = y + (j / 256) * hh;
        if (px < 0 || py < 0 || px > lctx.canvas.width || py > lctx.canvas.height) continue;
        const v = tl.hgt[j * 256 + i];
        if (!Number.isNaN(v)) vals.push(v);
      }
    }
    vals.sort((a, b) => a - b);
    range = vals.length > 20 ? [vals[Math.floor(vals.length * 0.02)], vals[Math.ceil(vals.length * 0.98) - 1]] : [0, 100];
    if (range[1] < range[0] + 0.5) range[1] = range[0] + 0.5;
  } else range = [Math.min(cfg.min, cfg.max), Math.max(cfg.min, cfg.max)];
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  for (const tl of tiles) {
    demPaint(c, tl.hgt, z, tl.ty, cfg, range);
    lctx.drawImage(c, ...prTileRect(ext, r, z, tl.tx, tl.ty));
  }
  return { range, palette: cfg.palette, step: cfg.step, auto: cfg.auto };
}

async function prDrawPdf(lctx, ext, r, it) {
  const wasShown = !!it.bmp;
  await ensurePdfBitmap(it);
  if (!it.bmp) return;
  const fake = { latLngToLayerPoint: (ll) => { const [x, y] = toMerc(ll.lat, ll.lng); return { x: (x - ext.minX) / r, y: (ext.maxY - y) / r }; } };
  lctx.save();
  lctx.globalAlpha = it.rec.opacity ?? 0.8;
  lctx.imageSmoothingEnabled = true;
  lctx.imageSmoothingQuality = "high";
  drawWarped(lctx, it, fake, 1, { x: 0, y: 0 });
  lctx.restore();
  lctx.setTransform(1, 0, 0, 1, 0, 0);
  if (!wasShown && it.rec.visible === false) releasePdfBitmap(it);
}

function prDrawTracks(ctx, ext, r, k, lines) {
  const P = (ll) => { const [x, y] = toMerc(ll.lat, ll.lng); return [(x - ext.minX) / r, (ext.maxY - y) / r]; };
  ctx.lineJoin = ctx.lineCap = "round";
  for (const line of lines) {
    let segs = line.getLatLngs();
    if (!segs.length) continue;
    if (!Array.isArray(segs[0])) segs = [segs];
    const o = line.options;
    ctx.strokeStyle = o.color || "#d0021b";
    ctx.globalAlpha = o.opacity ?? 0.85;
    ctx.lineWidth = (o.weight || 4) * k;
    for (const seg of segs) {
      if (seg.length < 2) continue;
      ctx.beginPath();
      seg.forEach((ll, i) => { const [x, y] = P(ll); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
      ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;
}

function prMemosIn(ext) {
  const pad = Math.max(ext.w, ext.h) * 0.02;
  return [...S.memos.values()].filter((m) => {
    const [x, y] = toMerc(m.lat, m.lon);
    return x >= ext.minX - pad && x <= ext.maxX + pad && y >= ext.minY - pad && y <= ext.maxY + pad;
  }).sort((a, b) => (a.no || 0) - (b.no || 0));
}
/** 地図で大きく表示する写真（パース・キービジュアル）を印刷用に読み込む：memoId → { img, w, h }（画面と同じ大きさ×k） */
async function prFeaturedImages(memos, k) {
  const out = new Map();
  for (const m of memos) {
    const ph = S.memoThumb.get(m.id);
    if (!ph || !m.featured || photoPinsMode() === "none") continue;
    const feat = Math.min(4, Math.max(2, Number(m.featured) || 3));
    const ar = Math.min(2, Math.max(0.5, (ph.width || 4) / (ph.height || 3)));
    const w = 48 * feat * (ar >= 1 ? 1 : ar) * k, hh = 48 * feat * (ar >= 1 ? 1 / ar : 1) * k;
    try {
      const img = await createImageBitmap(ph.blob || ph.thumb, { imageOrientation: "from-image", resizeWidth: Math.round(w * 1.5), resizeQuality: "high" });
      out.set(m.id, { img, w, h: hh });
    } catch {}
  }
  return out;
}
function prDrawFeatured(ctx, x, y, k, f, color) {
  const bw = 4 * k, w = f.w, hh = f.h, x0 = x - w / 2, y0 = y - 10 * k - hh;
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,.45)"; ctx.shadowBlur = 8 * k; ctx.shadowOffsetY = 2 * k;
  ctx.fillStyle = color;
  ctx.beginPath(); ctx.moveTo(x - 7 * k, y0 + hh); ctx.lineTo(x, y); ctx.lineTo(x + 7 * k, y0 + hh); ctx.closePath(); ctx.fill();
  ctx.fillRect(x0 - bw, y0 - bw, w + bw * 2, hh + bw * 2);
  ctx.restore();
  // 写真は枠いっぱいに切り抜いて貼る（画面の object-fit: cover と同じ）
  const ir = f.img.width / f.img.height, br = w / hh;
  let sw = f.img.width, sh = f.img.height, sx = 0, sy = 0;
  if (ir > br) { sw = sh * br; sx = (f.img.width - sw) / 2; } else { sh = sw / br; sy = (f.img.height - sh) / 2; }
  ctx.drawImage(f.img, sx, sy, sw, sh, x0, y0, w, hh);
  return { x0, y0 };
}
function prDrawMemos(ctx, ext, r, k, memos, labels, feats = new Map()) {
  const rr = 9 * k;
  // 大きく表示する写真は小さい印より後（上）に描く
  memos = [...memos].sort((a, b) => (feats.has(a.id) ? 1 : 0) - (feats.has(b.id) ? 1 : 0));
  for (const m of memos) {
    const [mx, my] = toMerc(m.lat, m.lon);
    const x = (mx - ext.minX) / r, y = (ext.maxY - my) / r;
    const fe = feats.get(m.id);
    if (fe) {
      const { x0, y0 } = prDrawFeatured(ctx, x, y, k, fe, memoColor(m));
      const no = String(m.no ?? "");
      ctx.beginPath(); ctx.arc(x0, y0, 10 * k, 0, Math.PI * 2); ctx.fillStyle = memoColor(m); ctx.fill();
      ctx.lineWidth = 2 * k; ctx.strokeStyle = "#fff"; ctx.stroke();
      ctx.fillStyle = "#fff"; ctx.font = `700 ${(no.length > 2 ? 8 : 10) * k}px ${PR_FONT}`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(no, x0, y0 + 0.5 * k);
      if (labels && m.title) {
        ctx.font = `600 ${11 * k}px ${PR_FONT}`; ctx.textAlign = "left"; ctx.lineWidth = 3.5 * k; ctx.strokeStyle = "rgba(255,255,255,.95)"; ctx.lineJoin = "round";
        const t = m.title.length > 24 ? m.title.slice(0, 23) + "…" : m.title;
        ctx.strokeText(t, x0 + fe.w + 8 * k, y0 + 8 * k); ctx.fillStyle = "#222"; ctx.fillText(t, x0 + fe.w + 8 * k, y0 + 8 * k);
      }
      continue;
    }
    // 撮影方向
    if (m.heading != null) {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(rad(m.heading));
      ctx.fillStyle = memoColor(m);
      ctx.beginPath(); ctx.moveTo(0, -rr * 2); ctx.lineTo(rr * 0.6, -rr * 0.8); ctx.lineTo(-rr * 0.6, -rr * 0.8); ctx.closePath(); ctx.fill();
      ctx.restore();
    }
    ctx.beginPath();
    ctx.arc(x, y, rr, 0, Math.PI * 2);
    ctx.fillStyle = memoColor(m);
    ctx.fill();
    ctx.lineWidth = 2 * k;
    ctx.strokeStyle = "#fff";
    ctx.stroke();
    const no = String(m.no ?? "");
    ctx.fillStyle = "#fff";
    ctx.font = `700 ${(no.length > 2 ? 8 : 10) * k}px ${PR_FONT}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(no, x, y + 0.5 * k);
    if (labels && m.title) {
      ctx.font = `600 ${11 * k}px ${PR_FONT}`;
      ctx.textAlign = "left";
      ctx.lineWidth = 3.5 * k;
      ctx.strokeStyle = "rgba(255,255,255,.95)";
      ctx.lineJoin = "round";
      const t = m.title.length > 24 ? m.title.slice(0, 23) + "…" : m.title;
      ctx.strokeText(t, x + rr + 3 * k, y);
      ctx.fillStyle = "#1b1b1b";
      ctx.fillText(t, x + rr + 3 * k, y);
    }
  }
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
}

/* ---------- 方位記号・スケールバー・凡例 ---------- */
function prNiceLength(maxM) {
  const p = 10 ** Math.floor(Math.log10(maxM));
  for (const f of [5, 2, 1]) if (f * p <= maxM) return f * p;
  return p;
}
const prLenLabel = (m) => (m >= 1000 ? `${+(m / 1000).toFixed(2)} km` : `${+m.toFixed(1)} m`);

function prNorthBox(mm) {
  const w = 10 * mm, hh = 16 * mm;
  return { w, hh, draw(ctx, x, y) {
    const cx = x + w / 2, top = y + 6 * mm, bot = y + hh - 1 * mm;
    ctx.fillStyle = "#111";
    ctx.font = `700 ${4.2 * mm}px ${PR_FONT}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.lineWidth = 0.8 * mm;
    ctx.strokeStyle = "rgba(255,255,255,.9)";
    ctx.strokeText("N", cx, y);
    ctx.fillText("N", cx, y);
    ctx.lineWidth = 0.25 * mm;
    ctx.strokeStyle = "#111";
    const hw = 3.2 * mm, mid = bot - 3 * mm;
    // 左半分は黒、右半分は白
    ctx.beginPath(); ctx.moveTo(cx, top); ctx.lineTo(cx - hw, bot); ctx.lineTo(cx, mid); ctx.closePath(); ctx.fillStyle = "#111"; ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx, top); ctx.lineTo(cx + hw, bot); ctx.lineTo(cx, mid); ctx.closePath(); ctx.fillStyle = "#fff"; ctx.fill(); ctx.stroke();
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
  } };
}

function prScaleBox(mm, mapWpx, groundPerPx, scale) {
  const len = prNiceLength(mapWpx * 0.25 * groundPerPx);
  const barW = len / groundPerPx, pad = 2.2 * mm, fs = 2.6 * mm;
  const w = barW + pad * 2 + 6 * mm, hh = 10.5 * mm;
  return { w, hh, draw(ctx, x, y) {
    ctx.fillStyle = "rgba(255,255,255,.88)";
    prRoundRect(ctx, x, y, w, hh, 1.2 * mm);
    ctx.fill();
    const bx = x + pad + 1 * mm, by = y + 5.2 * mm, bh = 1.6 * mm;
    for (let i = 0; i < 4; i++) {
      ctx.fillStyle = i % 2 ? "#fff" : "#111";
      ctx.fillRect(bx + (barW / 4) * i, by, barW / 4, bh);
    }
    ctx.lineWidth = 0.2 * mm;
    ctx.strokeStyle = "#111";
    ctx.strokeRect(bx, by, barW, bh);
    ctx.fillStyle = "#111";
    ctx.font = `500 ${fs}px ${PR_FONT}`;
    ctx.textBaseline = "alphabetic";
    ctx.textAlign = "center";
    ctx.fillText("0", bx, by - 0.8 * mm);
    ctx.fillText(prLenLabel(len / 2).replace(/ (k?m)$/, ""), bx + barW / 2, by - 0.8 * mm);
    ctx.fillText(prLenLabel(len), bx + barW, by - 0.8 * mm);
    ctx.font = `500 ${2.3 * mm}px ${PR_FONT}`;
    ctx.fillText(`縮尺 1:${prFmt(scale)}`, bx + barW / 2, by + bh + 2.9 * mm);
    ctx.textAlign = "left";
  } };
}

function prRoundRect(ctx, x, y, w, hh, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + hh, r);
  ctx.arcTo(x + w, y + hh, x, y + hh, r);
  ctx.arcTo(x, y + hh, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** 凡例の項目：{ type: "memo"|"line"|"ramp"|"text"|"head", ... } */
function prLegendBox(ctx, mm, items, maxH) {
  const fs = 2.7 * mm, lh = 4.4 * mm, pad = 2.4 * mm, sw = 5 * mm;
  ctx.font = `500 ${fs}px ${PR_FONT}`;
  const textW = (t) => ctx.measureText(t).width;
  let w = textW("凡例") + 2 * pad;
  let hh = pad * 2 + lh;
  const rows = [];
  for (const it of items) {
    const rh = it.type === "ramp" ? lh * 1.9 : lh;
    if (hh + rh > maxH) { rows.push({ type: "text", text: "…", h: lh }); hh += lh; break; }
    const tw = it.type === "ramp" ? Math.max(30 * mm, textW(it.text)) : sw + 1.5 * mm + textW(it.text);
    w = Math.max(w, tw + 2 * pad);
    rows.push({ ...it, h: rh });
    hh += rh;
  }
  w = Math.min(w, 80 * mm);
  return { w, hh, draw(ctx, x, y) {
    ctx.fillStyle = "rgba(255,255,255,.92)";
    prRoundRect(ctx, x, y, w, hh, 1.2 * mm);
    ctx.fill();
    ctx.lineWidth = 0.2 * mm;
    ctx.strokeStyle = "rgba(0,0,0,.35)";
    ctx.stroke();
    ctx.save();
    ctx.beginPath(); ctx.rect(x, y, w, hh); ctx.clip();
    let cy = y + pad;
    ctx.fillStyle = "#111";
    ctx.font = `700 ${fs}px ${PR_FONT}`;
    ctx.textBaseline = "middle";
    ctx.fillText("凡例", x + pad, cy + lh / 2);
    cy += lh;
    ctx.font = `500 ${fs}px ${PR_FONT}`;
    for (const it of rows) {
      const my = cy + lh / 2, tx = x + pad + sw + 1.5 * mm;
      if (it.type === "memo") {
        ctx.beginPath(); ctx.arc(x + pad + sw / 2, my, 1.5 * mm, 0, Math.PI * 2);
        ctx.fillStyle = it.color; ctx.fill();
        ctx.lineWidth = 0.35 * mm; ctx.strokeStyle = "#fff"; ctx.stroke();
      } else if (it.type === "line") {
        ctx.strokeStyle = it.color; ctx.lineWidth = 0.9 * mm; ctx.lineCap = "round";
        ctx.beginPath(); ctx.moveTo(x + pad + 0.5 * mm, my); ctx.lineTo(x + pad + sw - 0.5 * mm, my); ctx.stroke();
      } else if (it.type === "box") {
        ctx.fillStyle = it.color || "#bbb";
        ctx.globalAlpha = it.alpha ?? 1;
        ctx.fillRect(x + pad, my - 1.4 * mm, sw, 2.8 * mm);
        ctx.globalAlpha = 1;
        ctx.lineWidth = 0.15 * mm; ctx.strokeStyle = "rgba(0,0,0,.4)"; ctx.strokeRect(x + pad, my - 1.4 * mm, sw, 2.8 * mm);
      }
      if (it.type === "ramp") {
        ctx.fillStyle = "#111";
        ctx.fillText(it.text, x + pad, my);
        const gx = x + pad, gy = cy + lh * 0.95, gw = w - pad * 2, gh = 1.8 * mm;
        const g = ctx.createLinearGradient(gx, 0, gx + gw, 0);
        it.colors.forEach((c, i) => g.addColorStop(i / (it.colors.length - 1), c));
        ctx.fillStyle = g;
        ctx.fillRect(gx, gy, gw, gh);
        ctx.fillStyle = "#333";
        ctx.font = `500 ${2.3 * mm}px ${PR_FONT}`;
        ctx.textBaseline = "top";
        ctx.fillText(it.lo, gx, gy + gh + 0.4 * mm);
        ctx.textAlign = "right";
        ctx.fillText(it.hi, gx + gw, gy + gh + 0.4 * mm);
        ctx.textAlign = "left";
        ctx.textBaseline = "middle";
        ctx.font = `500 ${fs}px ${PR_FONT}`;
      } else if (it.type === "head") {
        ctx.fillStyle = "#111";
        ctx.font = `700 ${fs}px ${PR_FONT}`;
        ctx.fillText(prFit(ctx, it.text, w - pad * 2), x + pad, my);
        ctx.font = `500 ${fs}px ${PR_FONT}`;
      } else {
        ctx.fillStyle = "#111";
        ctx.fillText(prFit(ctx, String(it.text), w - (it.type === "text" ? pad * 2 : pad * 2 + sw + 1.5 * mm)), it.type === "text" ? x + pad : tx, my);
      }
      cy += it.h;
    }
    ctx.restore();
    ctx.textBaseline = "alphabetic";
  } };
}

/** 文字列を幅に収まるよう切る */
function prFit(ctx, text, maxW) {
  if (ctx.measureText(text).width <= maxW) return text;
  let lo = 0, hi = text.length;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (ctx.measureText(text.slice(0, mid) + "…").width <= maxW) lo = mid; else hi = mid - 1; }
  return text.slice(0, lo) + "…";
}
/** 文字列を幅で折り返す（最大 n 行） */
function prWrap(ctx, text, maxW, n) {
  const lines = [];
  let cur = "";
  for (const ch of text) {
    if (ctx.measureText(cur + ch).width > maxW) { lines.push(cur); cur = ch; if (lines.length === n) break; } else cur += ch;
  }
  if (lines.length < n && cur) lines.push(cur);
  if (lines.length === n && lines.join("").length < text.length) lines[n - 1] = prFit(ctx, lines[n - 1] + "……", maxW);
  return lines;
}

/** 1 ページ分の画像を作る */
async function prRender(cfg, ext, onProgress = () => {}) {
  const L0 = ext.layout;
  let dpi = cfg.dpi;
  const maxDpi = Math.sqrt(PR_MAX_AREA / (L0.pw * L0.ph)) * 25.4;
  if (dpi > maxDpi) dpi = Math.floor(maxDpi);
  const mm = dpi / 25.4;
  const PW = Math.round(L0.pw * mm), PH = Math.round(L0.ph * mm);
  const mx = Math.round(L0.map.x * mm), my = Math.round(L0.map.y * mm), mw = Math.round(L0.map.w * mm), mh = Math.round(L0.map.h * mm);
  const r = ext.w / mw;                // 出力 1px あたりのメルカトル m
  const k = (dpi / 96) * cfg.size;     // 画面の 1px を出力で何 px にするか（文字・線・記号の大きさ）
  const page = document.createElement("canvas");
  page.width = PW; page.height = PH;
  const ctx = page.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, PW, PH);

  // 地図部分は別の canvas に描いてから貼る
  const mapC = document.createElement("canvas");
  mapC.width = mw; mapC.height = mh;
  const mctx = mapC.getContext("2d");
  mctx.fillStyle = "#fff";
  mctx.fillRect(0, 0, mw, mh);
  const layerC = document.createElement("canvas");
  layerC.width = mw; layerC.height = mh;
  const lctx = layerC.getContext("2d");
  lctx.imageSmoothingQuality = "high";

  const cands = prCandidates().filter((c) => prIsOn(cfg, c.key));
  const legend = [];
  const credits = new Set();
  const pdfCredits = [];
  let demInfo = null;
  // データのレイヤは 1 回でまとめて描く
  const dataKeys = cands.filter((c) => c.kind === "data").map((c) => c.key);
  const tileSteps = cands.filter((c, i) => ["tile", "vector", "dem", "pdf", "canvas"].includes(c.kind) || (c.kind === "data" && cands.findIndex((x) => x.kind === "data") === i));
  let stepNo = 0;
  for (const c of tileSteps) {
    stepNo++;
    const label = `（${stepNo}/${tileSteps.length}）${c.name}`;
    const progress = (d, n) => onProgress(`${label} ${d}/${n}`);
    lctx.setTransform(1, 0, 0, 1, 0, 0);
    lctx.clearRect(0, 0, mw, mh);
    onProgress(label);
    try {
      if (c.kind === "tile") {
        await prDrawTiles(lctx, ext, r, k, c.def, progress);
        const at = String(c.def.attr || "");
        credits.add(/ハザード/.test(at) ? "ハザードマップポータルサイト" : /openstreetmap/i.test(at) ? "© OpenStreetMap contributors"
          : /今昔/.test(at) ? "今昔マップ on the web（谷謙二）" : /迅速測図/.test(at) ? "迅速測図：農研機構農業環境研究部門" : /気象庁/.test(at) ? "気象庁ホームページ"
          : /活断層/.test(at) ? "国土地理院（都市圏活断層図）" : "国土地理院（地理院タイル）");
        if (c.key !== "base") legend.push({ type: "text", text: `重ねた地図：${c.def.name}` });
      } else if (c.kind === "canvas") {
        const items = (await c.draw(lctx, ext, r, k, progress)) || [];
        if (c.credit) credits.add(c.credit);
        if (items.length) { legend.push({ type: "head", text: c.name }); legend.push(...items.slice(0, 12)); }
      } else if (c.kind === "vector") {
        await prDrawVector(lctx, ext, r, k, mw, mh);
        credits.add("国土地理院（地理院地図Vector）");
      } else if (c.kind === "data") {
        await prDrawVector(lctx, ext, r, k, mw, mh, dataPrintStyle(dataKeys));
        for (const cr of dataCredits(dataKeys)) credits.add(cr);
        for (const g of dataLegendGroups(dataKeys)) {
          legend.push({ type: "head", text: g.title });
          for (const it of g.items) {
            if (it.kind === "ramp") legend.push({ type: "ramp", text: it.text || "", colors: it.ramp, lo: it.lo, hi: it.hi });
            else if (it.kind === "text") legend.push({ type: "text", text: it.text });
            else legend.push({ type: it.kind === "dot" ? "memo" : it.kind === "line" ? "line" : "box", color: it.color, text: it.text });
          }
        }
      } else if (c.kind === "dem") {
        demInfo = await prDrawDem(lctx, ext, r, k, progress);
        credits.add("国土地理院（標高タイル）");
        legend.push({ type: "ramp", text: `標高${demInfo.step ? `（${demInfo.step} m 間隔）` : ""}`, colors: (DEM_PALETTES[demInfo.palette] || DEM_PALETTES.spectral).colors, lo: fmtM(demInfo.range[0]), hi: fmtM(demInfo.range[1]) });
      } else if (c.kind === "pdf") {
        await prDrawPdf(lctx, ext, r, c.it);
        legend.push({ type: "text", text: `重ねた地図：${c.name}` });
        pdfCredits.push(`${c.name}${c.it.rec.sourceUrl ? `（${c.it.rec.sourceUrl}）` : c.it.rec.sourceName ? `（${c.it.rec.sourceName}）` : ""}`);
      }
    } catch (e) {
      console.warn("印刷：描けないレイヤ", c.name, e);
      toast(`「${c.name}」を描けませんでした：${e.message}`, 4000);
    }
    mctx.globalAlpha = c.kind === "tile" || c.kind === "dem" || c.kind === "canvas" ? c.opacity : 1; // データは色の透明度をスタイルに含む
    mctx.drawImage(layerC, 0, 0);
    mctx.globalAlpha = 1;
  }
  layerC.width = layerC.height = 0;

  const trk = cands.find((c) => c.kind === "tracks");
  if (trk && trk.lines.length) {
    prDrawTracks(mctx, ext, r, k, trk.lines);
    const seen = new Set();
    for (const l of trk.lines) {
      const col = l.options.color || "#d0021b";
      if (seen.has(col)) continue;
      seen.add(col);
      legend.push({ type: "line", color: col, text: l === S.trackLine ? "軌跡（記録中）" : "軌跡" });
    }
  }
  if (cands.some((c) => c.kind === "memos")) {
    const memos = prMemosIn(ext);
    const feats = await prFeaturedImages(memos, k);
    prDrawMemos(mctx, ext, r, k, memos, cfg.memoLabels, feats);
    for (const f of feats.values()) f.img.close?.();
    const cats = new Map();
    if (colorBy() === "owner") {
      const own = new Map();
      for (const m of memos) own.set(ownerOf(m), (own.get(ownerOf(m)) || 0) + 1);
      for (const [n, c] of [...own].reverse()) legend.unshift({ type: "memo", color: ownerColor(n), text: `${n}（${c}）` });
    } else for (const m of memos) cats.set(m.category || "", (cats.get(m.category || "") || 0) + 1);
    for (const [cat, n] of [...cats].sort((a, b) => Settings.data.categories.indexOf(a[0]) - Settings.data.categories.indexOf(b[0]))) {
      legend.unshift({ type: "memo", color: catColor(cat), text: `${cat || "未分類"}（${n}）` });
    }
  }
  ctx.drawImage(mapC, mx, my);
  mapC.width = mapC.height = 0;

  // 地図の上の記号（同じ隅に置いたものは縦に並べる）
  const inset = 3.5 * mm, gap = 2 * mm;
  const used = { tl: 0, tr: 0, bl: 0, br: 0 };
  const place = (corner, box) => {
    if (!corner || corner === "none") return;
    const x = corner.endsWith("l") ? mx + inset : mx + mw - inset - box.w;
    const off = used[corner];
    const y = corner.startsWith("t") ? my + inset + off : my + mh - inset - box.hh - off;
    used[corner] += box.hh + gap;
    box.draw(ctx, x, y);
  };
  ctx.save();
  ctx.beginPath(); ctx.rect(mx, my, mw, mh); ctx.clip();
  const groundPerPx = r * Math.cos(rad(ext.lat));
  const scaleNum = cfg.scale || prRound3(ext.scale);
  if (cfg.north !== "none") place(cfg.north, prNorthBox(mm));
  if (cfg.scalebar !== "none") place(cfg.scalebar, prScaleBox(mm, mw, groundPerPx, scaleNum));
  if (cfg.legend && legend.length) place(cfg.legendPos, prLegendBox(ctx, mm, legend, mh * 0.6));
  ctx.restore();

  // 枠線
  ctx.lineWidth = Math.max(1, 0.3 * mm);
  ctx.strokeStyle = "#111";
  ctx.strokeRect(mx, my, mw, mh);

  // タイトル
  const date = new Date();
  const dateStr = `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
  if (cfg.title) {
    ctx.fillStyle = "#111";
    ctx.textBaseline = "alphabetic";
    ctx.font = `700 ${6 * mm}px ${PR_FONT}`;
    const sub = [Settings.data.observer ? `作成：${Settings.data.observer}` : "", dateStr].filter(Boolean).join("　");
    ctx.font = `500 ${2.8 * mm}px ${PR_FONT}`;
    const subW = ctx.measureText(sub).width;
    ctx.textAlign = "right";
    ctx.fillText(sub, mx + mw, my - 2.5 * mm);
    ctx.textAlign = "left";
    ctx.font = `700 ${6 * mm}px ${PR_FONT}`;
    ctx.fillText(prFit(ctx, cfg.title, mw - subW - 6 * mm), mx, my - 2.5 * mm);
  }
  // 下の注記：縮尺・作成日・出典
  ctx.fillStyle = "#333";
  ctx.font = `500 ${2.4 * mm}px ${PR_FONT}`;
  ctx.textBaseline = "top";
  const line1 = `縮尺 ${cfg.scale ? "" : "約"}1:${prFmt(scaleNum)}（${cfg.paper} ${cfg.orient === "landscape" ? "横" : "縦"}で印刷した場合）　${cfg.title ? "" : dateStr + "　"}中心 ${fromMerc(ext.cx, ext.cy).lat.toFixed(5)}, ${fromMerc(ext.cx, ext.cy).lng.toFixed(5)}`;
  ctx.fillText(prFit(ctx, line1, mw), mx, my + mh + 1.6 * mm);
  const credit = `出典：${[...credits].join("、") || "—"}${pdfCredits.length ? `／重ねた地図：${pdfCredits.join("、")}` : ""}`;
  prWrap(ctx, credit, mw, 2).forEach((t, i) => ctx.fillText(t, mx, my + mh + (4.6 + i * 3) * mm));
  ctx.textBaseline = "alphabetic";
  return { canvas: page, dpi, PW, PH };
}

/* ====================================================================
 * 出力（PDF・PNG・印刷）
 * ==================================================================== */
/** JPEG 1 枚を貼った 1 ページの PDF（外部ライブラリなし） */
function prMakePdf(jpeg, imgW, imgH, pwMm, phMm, title) {
  const enc = new TextEncoder();
  const W = ((pwMm * 72) / 25.4).toFixed(2), H = ((phMm * 72) / 25.4).toFixed(2);
  const utf16 = (s) => { let hx = "FEFF"; for (const ch of s) { const c = ch.codePointAt(0); if (c > 0xffff) { const v = c - 0x10000; hx += (0xd800 + (v >> 10)).toString(16).padStart(4, "0") + (0xdc00 + (v & 0x3ff)).toString(16).padStart(4, "0"); } else hx += c.toString(16).padStart(4, "0"); } return `<${hx.toUpperCase()}>`; };
  const content = `q ${W} 0 0 ${H} 0 0 cm /Im0 Do Q`;
  const d = new Date(), p2 = (n) => String(n).padStart(2, "0");
  const pdfDate = `(D:${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())})`;
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`,
    null, // 画像
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    `<< /Title ${utf16(title || "地図")} /Producer (FieldNote) /CreationDate ${pdfDate} >>`,
  ];
  const parts = [enc.encode("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n")];
  let pos = parts[0].length;
  const offsets = [];
  objs.forEach((o, i) => {
    offsets.push(pos);
    let chunk;
    if (o === null) {
      const head = enc.encode(`${i + 1} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${imgW} /Height ${imgH} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`);
      const tail = enc.encode("\nendstream\nendobj\n");
      parts.push(head, jpeg, tail);
      pos += head.length + jpeg.length + tail.length;
      return;
    }
    chunk = enc.encode(`${i + 1} 0 obj\n${o}\nendobj\n`);
    parts.push(chunk);
    pos += chunk.length;
  });
  const xref = `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => String(o).padStart(10, "0") + " 00000 n \n").join("")}trailer\n<< /Size ${objs.length + 1} /Root 1 0 R /Info ${objs.length} 0 R >>\nstartxref\n${pos}\n%%EOF\n`;
  parts.push(enc.encode(xref));
  return new Blob(parts, { type: "application/pdf" });
}

const prToBlob = (canvas, type, q) => new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error("画像を作れませんでした（メモリ不足の可能性）"))), type, q));
const prFileBase = (cfg) => `${safeName(cfg.title || Settings.data.project) || "fieldnote_map"}_${stamp()}`;

/** ブラウザの印刷（用紙サイズを指定して、画像 1 枚を印刷） */
function prBrowserPrint(blob, L0) {
  const url = URL.createObjectURL(blob);
  const root = h("div", { id: "print-root" }, h("img", { src: url, alt: "" }));
  const st = h("style", {}, `@page { size: ${L0.pw}mm ${L0.ph}mm; margin: 0; } #print-root img { width: ${L0.pw}mm; height: ${L0.ph}mm; }`);
  document.body.append(root);
  document.head.append(st);
  document.body.classList.add("printing");
  const done = () => {
    document.body.classList.remove("printing");
    root.remove();
    st.remove();
    URL.revokeObjectURL(url);
    window.removeEventListener("afterprint", done);
  };
  window.addEventListener("afterprint", done);
  root.querySelector("img").decode().catch(() => {}).then(() => {
    window.print();
    setTimeout(() => { if (document.body.classList.contains("printing") && !matchMedia("print").matches) done(); }, 60000);
  });
}

let prBusy = false;
async function prPreview() {
  if (prBusy) return;
  prBusy = true;
  const cfg = prCfg(), ext = prExtent(cfg);
  const status = h("div", { class: "note" }, "地図を作成中…");
  const body = h("div", { class: "pr-preview" }, status);
  openSheet("プレビュー・出力", body, { height: "86vh" });
  let res;
  try {
    res = await prRender(cfg, ext, (t) => (status.textContent = `地図を作成中… ${t}`));
  } catch (e) {
    status.textContent = "作成できませんでした：" + e.message;
    prBusy = false;
    return;
  }
  prBusy = false;
  const { canvas, dpi, PW, PH } = res;
  let jpeg = null, png = null;
  const getJpeg = async () => (jpeg ||= await prToBlob(canvas, "image/jpeg", 0.92));
  const getPng = async () => (png ||= await prToBlob(canvas, "image/png"));
  let previewUrl;
  try {
    previewUrl = URL.createObjectURL(await getJpeg());
  } catch (e) {
    status.textContent = e.message;
    return;
  }
  const L0 = ext.layout;
  const run = (fn) => async (e) => {
    const b = e.currentTarget;
    b.disabled = true;
    try { await fn(); } catch (er) { alert("出力できませんでした：" + er.message); }
    b.disabled = false;
  };
  const canShare = !!(navigator.canShare && navigator.canShare({ files: [new File(["x"], "x.pdf", { type: "application/pdf" })] }));
  const pdfBlob = async () => prMakePdf(new Uint8Array(await (await getJpeg()).arrayBuffer()), PW, PH, L0.pw, L0.ph, cfg.title || Settings.data.project || "地図");
  body.replaceChildren(
    h("div", { class: "pr-paper", style: `aspect-ratio:${L0.pw}/${L0.ph}` }, h("img", { src: previewUrl, alt: "印刷プレビュー" })),
    h("p", { class: "note" }, `${cfg.paper} ${cfg.orient === "landscape" ? "横" : "縦"}・縮尺 ${cfg.scale ? "" : "約"}1:${prFmt(cfg.scale || prRound3(ext.scale))}・${dpi} dpi（${PW}×${PH} px）${dpi < cfg.dpi ? "　※端末のメモリの上限に合わせて画質を下げました" : ""}`),
    h("div", { class: "menu-grid" },
      h("button", { type: "button", class: "btn primary", onclick: run(async () => deliverBlob(await pdfBlob(), prFileBase(cfg) + ".pdf", "application/pdf", "download")) }, "PDF を保存"),
      h("button", { type: "button", class: "btn primary", onclick: run(async () => deliverBlob(await getPng(), prFileBase(cfg) + ".png", "image/png", "download")) }, "画像（PNG）を保存"),
      h("button", { type: "button", class: "btn secondary", onclick: run(async () => { closeSheet(true); prBrowserPrint(await getJpeg(), L0); }) }, "印刷する"),
      canShare
        ? h("button", { type: "button", class: "btn secondary", onclick: run(async () => deliverBlob(await pdfBlob(), prFileBase(cfg) + ".pdf", "application/pdf", "share")) }, "PDF を共有…")
        : h("button", { type: "button", class: "btn secondary", onclick: run(async () => deliverBlob(await getJpeg(), prFileBase(cfg) + ".jpg", "image/jpeg", "download")) }, "画像（JPEG）を保存")),
    h("div", { class: "menu-grid", style: "margin-top:8px" },
      h("button", { type: "button", class: "btn secondary", onclick: () => closeSheet(true) }, "範囲を直す"),
      h("button", { type: "button", class: "btn secondary", onclick: openPrintSettings }, "設定を変える")),
    h("p", { class: "note" }, "「印刷する」はブラウザの印刷画面を開きます（プリンタを選ぶほか、「PDF に保存」も選べます）。印刷するときは倍率を 100%（実際のサイズ）にすると、縮尺どおりになります。"));
  sheetOnClose = () => { URL.revokeObjectURL(previewUrl); canvas.width = canvas.height = 0; };
}
