/* フィールドノート — PDF 地図の取り込みとジオリファレンス
 * - PDF（ファイル／URL）→ ページ選択 → 切り出し → 3点以上の対応点で位置合わせ → 地図レイヤとして重ねる
 * - 変換はウェブメルカトル（EPSG:3857）座標で推定するので、地図上ではアフィン／射影変換がそのまま CSS の matrix3d で表せる
 * - app.js より先に読み込む（ここではトップレベルで app.js の値を使わない）
 */
"use strict";

const PDFJS_BASE = "https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/";
const PDFJS_URL = PDFJS_BASE + "build/pdf.min.js";
const PDFJS_WORKER_URL = PDFJS_BASE + "build/pdf.worker.min.js";
const GR_MAX_SIDE = 4000;        // 切り出し画像の長辺の上限 (px)
const GR_MAX_AREA = 14e6;        // iOS の canvas 面積上限より少し小さく
const GR_PREVIEW_SIDE = 1600;    // 切り出し画面のプレビュー解像度

/* ====================================================================
 * 行列・変換の推定
 * ==================================================================== */
const M3 = {
  mul: (a, b) => {
    const r = new Array(9).fill(0);
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) r[i * 3 + j] += a[i * 3 + k] * b[k * 3 + j];
    return r;
  },
  inv: (m) => {
    const [a, b, c, d, e, f, g, h, i] = m;
    const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
    const det = a * A + b * B + c * C;
    if (!det || !isFinite(det)) return null;
    return [A / det, -(b * i - c * h) / det, (b * f - c * e) / det,
      B / det, (a * i - c * g) / det, -(a * f - c * d) / det,
      C / det, -(a * h - b * g) / det, (a * e - b * d) / det];
  },
  apply: (m, x, y) => {
    const w = m[6] * x + m[7] * y + m[8];
    return [(m[0] * x + m[1] * y + m[2]) / w, (m[3] * x + m[4] * y + m[5]) / w];
  },
};

/** 連立一次方程式 A x = b（最小二乗：正規方程式＋部分ピボット付きガウス消去） */
function lstsq(rows, rhs) {
  const n = rows[0].length;
  const N = Array.from({ length: n }, () => new Array(n + 1).fill(0));
  rows.forEach((r, k) => {
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) N[i][j] += r[i] * r[j];
      N[i][n] += r[i] * rhs[k];
    }
  });
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(N[r][c]) > Math.abs(N[p][c])) p = r;
    if (Math.abs(N[p][c]) < 1e-12) return null;
    [N[c], N[p]] = [N[p], N[c]];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = N[r][c] / N[c][c];
      for (let k = c; k <= n; k++) N[r][k] -= f * N[c][k];
    }
  }
  return N.map((r, i) => r[n] / r[i]);
}

/** 点群を重心 0・平均距離 √2 に正規化する行列（数値安定のため） */
function normMatrix(pts) {
  const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length;
  const cy = pts.reduce((s, p) => s + p[1], 0) / pts.length;
  const d = pts.reduce((s, p) => s + Math.hypot(p[0] - cx, p[1] - cy), 0) / pts.length || 1;
  const k = Math.SQRT2 / d;
  return [k, 0, -k * cx, 0, k, -k * cy, 0, 0, 1];
}

/** src[i] → dst[i] の変換行列（3x3, 行優先）を推定。method: "affine" | "projective" */
function fitMatrix(src, dst, method) {
  const Ts = normMatrix(src), Td = normMatrix(dst);
  const s = src.map((p) => M3.apply(Ts, p[0], p[1]));
  const d = dst.map((p) => M3.apply(Td, p[0], p[1]));
  let H;
  if (method === "projective") {
    if (s.length < 4) return null;
    const rows = [], rhs = [];
    s.forEach(([x, y], i) => {
      const [X, Y] = d[i];
      rows.push([x, y, 1, 0, 0, 0, -x * X, -y * X]); rhs.push(X);
      rows.push([0, 0, 0, x, y, 1, -x * Y, -y * Y]); rhs.push(Y);
    });
    const h = lstsq(rows, rhs);
    if (!h) return null;
    H = [...h, 1];
  } else {
    if (s.length < 3) return null;
    const rows = s.map(([x, y]) => [x, y, 1]);
    const a = lstsq(rows, d.map((p) => p[0])), b = lstsq(rows, d.map((p) => p[1]));
    if (!a || !b) return null;
    H = [...a, ...b, 0, 0, 1];
  }
  const TdInv = M3.inv(Td);
  if (!TdInv) return null;
  const M = M3.mul(TdInv, M3.mul(H, Ts));
  return M3.inv(M) ? M : null;
}

const toMerc = (lat, lon) => { const p = L.CRS.EPSG3857.project(L.latLng(lat, lon)); return [p.x, p.y]; };
const fromMerc = (x, y) => L.CRS.EPSG3857.unproject(L.point(x, y));

/**
 * 対応点から 画像 px → メルカトル の変換を求め、誤差も計算する。
 * gcps: [{u, v, lat, lon}]
 */
function georefFit(gcps, method) {
  const pts = gcps.filter((g) => g.u != null && g.lat != null);
  const need = method === "projective" ? 4 : 3;
  if (pts.length < need) return { error: `${method === "projective" ? "射影変換" : "アフィン変換"}には ${need} 点以上必要です` };
  const src = pts.map((g) => [g.u, g.v]);
  const dst = pts.map((g) => toMerc(g.lat, g.lon));
  const M = fitMatrix(src, dst, method);
  if (!M) return { error: "点の配置が一直線に近いなどの理由で計算できません。離れた位置に点を置いてください" };
  // 誤差（地上距離 m）：メルカトルの長さ × cos(緯度)
  const residuals = pts.map((g, i) => {
    const [x, y] = M3.apply(M, g.u, g.v);
    return Math.hypot(x - dst[i][0], y - dst[i][1]) * Math.cos((g.lat * Math.PI) / 180);
  });
  const dof = pts.length - need;
  const rms = dof > 0 ? Math.sqrt(residuals.reduce((s, r) => s + r * r, 0) / pts.length) : null;
  return { M, inv: M3.inv(M), residuals: dof > 0 ? residuals : null, rms, n: pts.length, method };
}

/** 画像の四隅 (0,0)(w,0)(w,h)(0,h) → 画面上の4点 への射影行列（CSS matrix3d 用。単位正方形→四角形の閉形式） */
function quadMatrix(w, hgt, quad) {
  const [[x0, y0], [x1, y1], [x2, y2], [x3, y3]] = quad;
  const dx1 = x1 - x2, dx2 = x3 - x2, dx3 = x0 - x1 + x2 - x3;
  const dy1 = y1 - y2, dy2 = y3 - y2, dy3 = y0 - y1 + y2 - y3;
  let g = 0, hh = 0;
  if (Math.abs(dx3) > 1e-9 || Math.abs(dy3) > 1e-9) {
    const den = dx1 * dy2 - dx2 * dy1;
    if (!den) return null;
    g = (dx3 * dy2 - dx2 * dy3) / den;
    hh = (dx1 * dy3 - dx3 * dy1) / den;
  }
  const sq = [x1 - x0 + g * x1, x3 - x0 + hh * x3, x0, y1 - y0 + g * y1, y3 - y0 + hh * y3, y0, g, hh, 1];
  return M3.mul(sq, [1 / w, 0, 0, 0, 1 / hgt, 0, 0, 0, 1]);
}
const cssMatrix3d = (H) => `matrix3d(${H[0]},${H[3]},0,${H[6]},${H[1]},${H[4]},0,${H[7]},0,0,1,0,${H[2]},${H[5]},0,${H[8]})`;

/* ====================================================================
 * 地図レイヤ（画像を matrix3d で変形して重ねる）
 * ==================================================================== */
const PdfImageLayer = L.Layer.extend({
  initialize(rec, url, opts = {}) {
    this.rec = rec;
    this.url = url;
    this.opts = opts;
  },
  onAdd(map) {
    const paneName = this.opts.pane || `pdf-${this.rec.id}`;
    this._pane = map.getPane(paneName) || map.createPane(paneName);
    const img = (this._img = L.DomUtil.create("img", "pdf-overlay leaflet-zoom-animated"));
    img.src = this.url;
    img.alt = "";
    img.draggable = false;
    img.style.width = this.rec.width + "px";
    img.style.height = this.rec.height + "px";
    this._pane.appendChild(img);
    this.applyStyle();
    this._reset();
  },
  onRemove() {
    this._img.remove();
  },
  getEvents() {
    return { zoom: this._reset, viewreset: this._reset, zoomanim: this._animateZoom };
  },
  setMatrix(M) {
    this.rec.M = M;
    if (this._map) this._reset();
  },
  corners() {
    const { width: w, height: h, M } = this.rec;
    return [[0, 0], [w, 0], [w, h], [0, h]].map(([u, v]) => { const [x, y] = M3.apply(M, u, v); return fromMerc(x, y); });
  },
  bounds() {
    return L.latLngBounds(this.corners());
  },
  _place(pts) {
    const H = quadMatrix(this.rec.width, this.rec.height, pts.map((p) => [p.x, p.y]));
    if (H) this._img.style.transform = cssMatrix3d(H);
  },
  _reset() {
    if (!this._map || !this.rec.M) return;
    this._place(this.corners().map((ll) => this._map.latLngToLayerPoint(ll)));
  },
  _animateZoom(e) {
    if (!this.rec.M) return;
    this._place(this.corners().map((ll) => this._map._latLngToNewLayerPoint(ll, e.zoom, e.center)));
  },
  applyStyle() {
    const r = this.rec;
    if (!this._img) return;
    this._img.style.opacity = r.opacity ?? 0.8;
    this._img.style.filter = r.gray ? "grayscale(1) contrast(1.1)" : "";
    // 白い背景を透かす（乗算）。ペインごと合成しないと下の地図と混ざらない
    this._pane.style.mixBlendMode = r.multiply ? "multiply" : "";
    this._pane.style.zIndex = String(this.opts.zIndex ?? 350 + Math.min(40, r.order || 0));
  },
});

/* ====================================================================
 * 保存済みレイヤの管理（メイン地図）
 * ==================================================================== */
const PDFL = { items: new Map() }; // id -> { rec, layer, url }

async function loadPdfLayers() {
  for (const it of PDFL.items.values()) { if (it.layer) S.map.removeLayer(it.layer); URL.revokeObjectURL(it.url); }
  PDFL.items.clear();
  const recs = (await DB.all("overlays")).sort((a, b) => (a.order || 0) - (b.order || 0));
  for (const rec of recs) {
    const img = await DB.get("overlayImages", rec.id);
    if (!img) continue;
    const url = URL.createObjectURL(img.blob);
    const layer = new PdfImageLayer(rec, url);
    if (rec.visible !== false) layer.addTo(S.map);
    PDFL.items.set(rec.id, { rec, layer, url });
  }
}

const savePdfRecSoon = (() => {
  const timers = new Map();
  return (rec) => {
    clearTimeout(timers.get(rec.id));
    timers.set(rec.id, setTimeout(() => DB.put("overlays", rec).catch(() => {}), 400));
  };
})();

function setPdfVisible(id, on) {
  const it = PDFL.items.get(id);
  if (!it) return;
  it.rec.visible = on;
  if (on) it.layer.addTo(S.map);
  else S.map.removeLayer(it.layer);
  savePdfRecSoon(it.rec);
}

async function deletePdfLayer(id) {
  const it = PDFL.items.get(id);
  if (!it) return;
  S.map.removeLayer(it.layer);
  URL.revokeObjectURL(it.url);
  PDFL.items.delete(id);
  await DB.del("overlays", id);
  await DB.del("overlayImages", id);
}

/** 地図タップ：PDF 地図の上ならポップアップ（上に重なっているものを優先） */
function pdfLayerClick(latlng) {
  const items = [...PDFL.items.values()].filter((it) => it.rec.visible !== false).sort((a, b) => (b.rec.order || 0) - (a.rec.order || 0));
  const [x, y] = toMerc(latlng.lat, latlng.lng);
  for (const it of items) {
    const inv = M3.inv(it.rec.M);
    if (!inv) continue;
    const [u, v] = M3.apply(inv, x, y);
    if (u < 0 || v < 0 || u > it.rec.width || v > it.rec.height) continue;
    const r = it.rec;
    const link = r.sourceUrl ? `${r.sourceUrl}${/\.pdf($|\?)/i.test(r.sourceUrl) && !r.sourceUrl.includes("#") ? `#page=${r.page}` : ""}` : null;
    const el = h("div", {},
      h("div", { class: "pt" }, r.title || "PDF 地図"),
      h("div", { class: "ps" }, [`p.${r.page}`, r.sourceName, r.fit?.rms != null ? `誤差 約${r.fit.rms.toFixed(1)} m` : ""].filter(Boolean).join("　")),
      link ? h("div", { style: "margin-top:4px;word-break:break-all" }, h("a", { href: link, target: "_blank", rel: "noopener" }, "元の PDF を開く ↗")) : h("div", { class: "ps" }, "（出典 URL 未登録）"),
      h("div", { class: "pa" },
        h("button", { type: "button", onclick: () => { S.map.closePopup(); setPdfVisible(r.id, false); toast("非表示にしました（地図の切替から戻せます）"); } }, "非表示"),
        h("button", { type: "button", onclick: () => { S.map.closePopup(); openPdfLayerEdit(r.id); } }, "名前・出典"),
        h("button", { type: "button", onclick: () => { S.map.closePopup(); openGeoref({ existing: r.id }); } }, "位置合わせ")));
    L.popup({ maxWidth: 280 }).setLatLng(latlng).setContent(el).openOn(S.map);
    return true;
  }
  return false;
}

/** 地図の切替パネルに入れる「PDF から追加した地図」セクション */
function pdfLayersSection() {
  const box = h("div");
  const render = () => {
    box.replaceChildren();
    const items = [...PDFL.items.values()].sort((a, b) => (b.rec.order || 0) - (a.rec.order || 0));
    for (const it of items) {
      const r = it.rec;
      const cb = h("input", { type: "checkbox", checked: r.visible !== false });
      cb.onchange = () => setPdfVisible(r.id, cb.checked);
      const rg = h("input", { type: "range", min: "0.1", max: "1", step: "0.05", value: r.opacity ?? 0.8 });
      rg.oninput = () => {
        r.opacity = Number(rg.value);
        if (r.visible === false) { cb.checked = true; setPdfVisible(r.id, true); }
        it.layer.applyStyle();
        savePdfRecSoon(r);
      };
      const toggle = (key, label) => {
        const c = h("button", { type: "button", class: "chip" + (r[key] ? " on" : "") }, label);
        c.onclick = () => { r[key] = !r[key]; c.classList.toggle("on", !!r[key]); it.layer.applyStyle(); savePdfRecSoon(r); };
        return c;
      };
      const act = (label, fn) => h("button", { type: "button", class: "chip", onclick: fn }, label);
      box.append(h("div", { class: "pdf-row" },
        h("div", { class: "ov-row", style: "border:0;padding-bottom:2px" }, cb,
          h("div", {}, r.title || "PDF 地図", h("small", {}, [`p.${r.page}`, r.sourceName, r.fit?.rms != null ? `誤差 約${r.fit.rms.toFixed(1)} m` : ""].filter(Boolean).join("・"))), rg),
        h("div", { class: "chips" },
          toggle("gray", "モノクロ"), toggle("multiply", "白を透過"),
          act("範囲へ", () => { closeSheet(true); setFollow(false); if (r.visible === false) setPdfVisible(r.id, true); S.map.fitBounds(it.layer.bounds(), { padding: [20, 20] }); }),
          act("位置合わせ", () => { closeSheet(true); openGeoref({ existing: r.id }); }),
          act("名前・出典", () => openPdfLayerEdit(r.id)),
          act("削除", async () => { if (!confirm(`「${r.title}」を削除しますか？`)) return; await deletePdfLayer(r.id); render(); }))));
    }
    if (!items.length) box.append(h("p", { class: "note" }, "河川整備計画などの PDF の地図を、位置を合わせて重ねられます。"));
    box.append(h("button", { type: "button", class: "btn secondary block", onclick: () => { closeSheet(true); openPdfSource(); } }, "＋ PDF から地図を追加"));
  };
  render();
  return box;
}

function openPdfLayerEdit(id) {
  const it = PDFL.items.get(id);
  if (!it) return;
  const r = it.rec;
  const title = h("input", { type: "text", value: r.title || "" });
  const url = h("input", { type: "text", value: r.sourceUrl || "", placeholder: "https://…/xxx.pdf", inputmode: "url" });
  const form = h("form", {}, h("label", {}, "名前", title), h("label", {}, "出典 URL（ポップアップのリンク先）", url),
    h("p", { class: "note" }, `元ファイル：${r.sourceName || "—"}　ページ：${r.page}　画像：${r.width}×${r.height}px　変換：${r.fit?.method === "projective" ? "射影" : "アフィン"}（${r.gcps.length}点）`),
    h("button", { class: "btn primary block", type: "submit" }, "保存"));
  form.onsubmit = async (e) => {
    e.preventDefault();
    r.title = title.value.trim() || r.title;
    r.sourceUrl = url.value.trim() || null;
    await DB.put("overlays", r);
    closeSheet(true);
    toast("保存しました");
  };
  openSheet("PDF 地図の情報", form);
}

/* ====================================================================
 * PDF の読み込み
 * ==================================================================== */
let pdfjsPromise = null;
function loadPdfJs() {
  if (!pdfjsPromise) {
    pdfjsPromise = new Promise((res, rej) => {
      const s = document.createElement("script");
      s.src = PDFJS_URL;
      s.onload = () => {
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_URL;
        res(window.pdfjsLib);
      };
      s.onerror = () => { pdfjsPromise = null; rej(new Error("PDF 表示ライブラリを読み込めません（オフライン？）")); };
      document.head.append(s);
    });
  }
  return pdfjsPromise;
}

async function fetchPdfBytes(url) {
  const tryFetch = async (u) => {
    const r = await fetch(u, { mode: "cors", credentials: "omit" });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const buf = new Uint8Array(await r.arrayBuffer());
    if (String.fromCharCode(...buf.slice(0, 5)) !== "%PDF-") throw new Error("PDF ではありません");
    return buf;
  };
  try {
    return await tryFetch(url);
  } catch (e) {
    const proxy = Settings.data.corsProxy;
    if (!proxy) throw e;
    const pu = proxy.includes("{url}") ? proxy.replace("{url}", encodeURIComponent(url)) : proxy + url;
    return tryFetch(pu);
  }
}

/** 手順1：PDF を指定（ファイル or URL） */
function openPdfSource(prefillUrl = "") {
  const fileIn = h("input", { type: "file", accept: "application/pdf,.pdf", hidden: true });
  const url = h("input", { type: "text", placeholder: "https://…/seibikeikaku.pdf", value: prefillUrl, inputmode: "url", autocomplete: "off" });
  const status = h("div", { class: "note" });
  const help = h("div");
  const start = async (bytes, name, sourceUrl) => {
    status.textContent = "PDF を開いています…";
    try {
      const lib = await loadPdfJs();
      // 日本語の PDF は CMap（文字コード表）がないと文字が描画されない
      const pdf = await lib.getDocument({ data: bytes, cMapUrl: PDFJS_BASE + "cmaps/", cMapPacked: true, standardFontDataUrl: PDFJS_BASE + "standard_fonts/" }).promise;
      openPdfPages({ pdf, name, sourceUrl });
    } catch (e) {
      status.textContent = e.name === "PasswordException" ? "パスワード付きの PDF は読み込めません" : "PDF を開けませんでした：" + e.message;
    }
  };
  fileIn.onchange = async () => {
    const f = fileIn.files[0];
    fileIn.value = "";
    if (f) start(new Uint8Array(await f.arrayBuffer()), f.name, url.value.trim() || null);
  };
  const loadUrl = async () => {
    const u = url.value.trim();
    if (!/^https?:\/\//i.test(u)) return (status.textContent = "http(s):// で始まる URL を入力してください");
    status.textContent = "ダウンロード中…";
    help.replaceChildren();
    try {
      const bytes = await fetchPdfBytes(u);
      start(bytes, decodeURIComponent(u.split(/[?#]/)[0].split("/").pop() || "document.pdf"), u);
    } catch {
      status.textContent = "";
      // 多くの官公庁サイトは CORS を許可していないため、ブラウザから直接は取得できない
      help.replaceChildren(h("div", { class: "warn" },
        h("b", {}, "このサイトからは直接読み込めませんでした。"),
        h("div", {}, "サイト側が他のページからの読み込みを許可していないためです。次の手順で読み込めます（URL は出典リンクとして保存されます）。"),
        h("ol", {}, h("li", {}, "下のボタンで PDF を開き、端末にダウンロード"), h("li", {}, "「ダウンロードした PDF を選ぶ」でそのファイルを選択")),
        h("div", { class: "menu-grid" },
          h("a", { class: "btn secondary", href: u, target: "_blank", rel: "noopener" }, "PDF を開く ↗"),
          h("button", { class: "btn primary", type: "button", onclick: () => fileIn.click() }, "ダウンロードした PDF を選ぶ"))));
    }
  };
  const body = h("div", {},
    h("button", { class: "btn primary block", type: "button", onclick: () => fileIn.click() }, "PDF ファイルを選ぶ"), fileIn,
    h("div", { class: "sect-title" }, "または URL から"),
    url,
    h("button", { class: "btn secondary block", type: "button", onclick: loadUrl }, "URL から読み込む"),
    status, help,
    h("p", { class: "note" }, "ファイルで選ぶ場合も、上の欄に元の URL を入れておくと、地図のポップアップから元の PDF に飛べます（後から「名前・出典」でも設定可）。"));
  openSheet("PDF から地図を追加", body);
}

/** 手順2：ページを選ぶ */
function openPdfPages(src) {
  const { pdf } = src;
  const grid = h("div", { class: "gal" });
  const queue = [];
  let busy = false;
  const pump = async () => {
    if (busy) return;
    busy = true;
    while (queue.length) {
      const { n, canvas } = queue.shift();
      try {
        const page = await pdf.getPage(n);
        const vp1 = page.getViewport({ scale: 1 });
        const sc = 220 / Math.max(vp1.width, vp1.height);
        const vp = page.getViewport({ scale: sc });
        canvas.width = Math.ceil(vp.width);
        canvas.height = Math.ceil(vp.height);
        const ctx = canvas.getContext("2d");
        ctx.fillStyle = "#fff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        await page.render({ canvasContext: ctx, viewport: vp }).promise;
        page.cleanup();
      } catch {}
    }
    busy = false;
  };
  const io = new IntersectionObserver((ents) => {
    for (const e of ents) if (e.isIntersecting && !e.target._queued) {
      e.target._queued = true;
      queue.push({ n: Number(e.target.dataset.n), canvas: e.target.querySelector("canvas") });
      pump();
    }
  }, { rootMargin: "300px" });
  for (let n = 1; n <= pdf.numPages; n++) {
    const tile = h("button", { type: "button", class: "gal-tile pdf-page", "data-n": n }, h("canvas"), h("b", { style: "background:#333" }, `p.${n}`));
    tile.onclick = () => { closeSheet(true); openGeoref({ src, page: n }); };
    grid.append(tile);
    io.observe(tile);
  }
  openSheet(`ページを選ぶ（全 ${pdf.numPages} ページ）`, h("div", {}, h("p", { class: "note", style: "margin-top:0" }, `${src.name}　地図が載っているページをタップ`), grid), {
    onClose: () => io.disconnect(),
  });
}

/* ====================================================================
 * 全画面エディタ：切り出し → 位置合わせ
 * ==================================================================== */
const GR = { el: null, maps: [] };

function grOpenShell(title) {
  grClose();
  const el = (GR.el = h("div", { id: "gr" },
    h("div", { class: "gr-head" }, h("div", { class: "gr-title" }, title), h("button", { class: "icon-btn", type: "button", "aria-label": "閉じる", onclick: () => { if (confirm("位置合わせを中止しますか？")) grClose(); } }, "✕")),
    h("div", { class: "gr-body" }),
    h("div", { class: "gr-foot" })));
  document.body.append(el);
  return { body: el.querySelector(".gr-body"), foot: el.querySelector(".gr-foot"), title: el.querySelector(".gr-title") };
}
function grClose() {
  for (const m of GR.maps) m.remove();
  GR.maps = [];
  if (GR.el) GR.el.remove();
  GR.el = null;
  if (GR.cleanup) GR.cleanup();
  GR.cleanup = null;
}

/** 入口：新規（src+page）または既存レイヤの再調整（existing） */
async function openGeoref(opts) {
  if (opts.existing) {
    const it = PDFL.items.get(opts.existing);
    if (!it) return;
    const img = await DB.get("overlayImages", it.rec.id);
    return grGeoref({ rec: { ...it.rec, gcps: it.rec.gcps.map((g) => ({ ...g })) }, blob: img.blob, isNew: false });
  }
  grCrop(opts.src, opts.page);
}

/** 手順3：切り出し範囲を決める */
async function grCrop(src, pageNo) {
  const ui = grOpenShell(`切り出し（p.${pageNo}）`);
  ui.body.append(h("div", { class: "empty" }, "ページを描画中…"));
  const page = await src.pdf.getPage(pageNo);
  const vp1 = page.getViewport({ scale: 1 });
  const sc = GR_PREVIEW_SIDE / Math.max(vp1.width, vp1.height);
  const vp = page.getViewport({ scale: sc });
  const canvas = h("canvas", { class: "gr-crop-canvas" });
  canvas.width = Math.ceil(vp.width);
  canvas.height = Math.ceil(vp.height);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport: vp }).promise;
  if (!GR.el) return;

  const crop = { x0: 0.02, y0: 0.02, x1: 0.98, y1: 0.98 }; // ページに対する割合
  const rect = h("div", { class: "gr-crop-rect" }, ...["nw", "ne", "se", "sw"].map((k) => h("i", { class: "gr-h " + k, "data-k": k })));
  const stage = h("div", { class: "gr-crop-stage" }, canvas, rect);
  ui.body.replaceChildren(stage);
  const layout = () => {
    const bw = ui.body.clientWidth - 16, bh = ui.body.clientHeight - 16;
    const s = Math.min(bw / canvas.width, bh / canvas.height);
    canvas.style.width = canvas.width * s + "px";
    canvas.style.height = canvas.height * s + "px";
    stage.style.width = canvas.style.width;
    stage.style.height = canvas.style.height;
    draw();
  };
  const draw = () => {
    const w = canvas.clientWidth, hh = canvas.clientHeight;
    Object.assign(rect.style, { left: crop.x0 * w + "px", top: crop.y0 * hh + "px", width: (crop.x1 - crop.x0) * w + "px", height: (crop.y1 - crop.y0) * hh + "px" });
    info.textContent = `出力 約 ${outSize().slice(0, 2).join("×")} px`;
  };
  const outSize = () => {
    const cw = (crop.x1 - crop.x0) * vp1.width, ch = (crop.y1 - crop.y0) * vp1.height;
    let s = Math.min(GR_MAX_SIDE / Math.max(cw, ch), 12);
    if (cw * ch * s * s > GR_MAX_AREA) s = Math.sqrt(GR_MAX_AREA / (cw * ch));
    return [Math.round(cw * s), Math.round(ch * s), s];
  };
  // ドラッグ：角のハンドルでサイズ変更、枠の中で移動
  let drag = null;
  stage.addEventListener("pointerdown", (e) => {
    const k = e.target.dataset?.k || (e.target === rect ? "move" : null);
    if (!k) return;
    e.preventDefault();
    stage.setPointerCapture(e.pointerId);
    drag = { k, x: e.clientX, y: e.clientY, c: { ...crop } };
  });
  stage.addEventListener("pointermove", (e) => {
    if (!drag) return;
    const dx = (e.clientX - drag.x) / canvas.clientWidth, dy = (e.clientY - drag.y) / canvas.clientHeight;
    const c = drag.c, min = 0.03, cl = (v) => Math.max(0, Math.min(1, v));
    if (drag.k === "move") {
      const w = c.x1 - c.x0, hh = c.y1 - c.y0;
      crop.x0 = Math.max(0, Math.min(1 - w, c.x0 + dx)); crop.x1 = crop.x0 + w;
      crop.y0 = Math.max(0, Math.min(1 - hh, c.y0 + dy)); crop.y1 = crop.y0 + hh;
    } else {
      if (drag.k.includes("w")) crop.x0 = Math.min(cl(c.x0 + dx), crop.x1 - min);
      if (drag.k.includes("e")) crop.x1 = Math.max(cl(c.x1 + dx), crop.x0 + min);
      if (drag.k.includes("n")) crop.y0 = Math.min(cl(c.y0 + dy), crop.y1 - min);
      if (drag.k.includes("s")) crop.y1 = Math.max(cl(c.y1 + dy), crop.y0 + min);
    }
    draw();
  });
  const end = () => (drag = null);
  stage.addEventListener("pointerup", end);
  stage.addEventListener("pointercancel", end);

  const info = h("span", { class: "gr-info" });
  const next = async () => {
    nextBtn.disabled = true;
    info.textContent = "高解像度で描画中…";
    try {
      const [w, hh, s] = outSize();
      const out = h("canvas");
      out.width = w; out.height = hh;
      const octx = out.getContext("2d");
      octx.fillStyle = "#fff";
      octx.fillRect(0, 0, w, hh);
      const v = page.getViewport({ scale: s, offsetX: -crop.x0 * vp1.width * s, offsetY: -crop.y0 * vp1.height * s });
      await page.render({ canvasContext: octx, viewport: v }).promise;
      const blob = await new Promise((r) => out.toBlob(r, "image/jpeg", 0.9));
      out.width = out.height = 0;
      const rec = {
        id: uuid(), title: `${src.name.replace(/\.pdf$/i, "")} p.${pageNo}`, sourceUrl: src.sourceUrl || null, sourceName: src.name,
        page: pageNo, crop: { ...crop }, width: w, height: hh, gcps: [], method: "affine",
        opacity: 0.8, gray: false, multiply: true, visible: true, createdAt: nowIso(),
      };
      grGeoref({ rec, blob, isNew: true, src });
    } catch (e) {
      nextBtn.disabled = false;
      alert("描画できませんでした：" + e.message);
    }
  };
  const nextBtn = h("button", { class: "btn primary", type: "button", onclick: next }, "この範囲で位置合わせへ");
  ui.foot.append(
    h("div", { class: "gr-msg" }, "地図の部分を枠で囲んでください（角をドラッグで大きさ、中をドラッグで移動）。凡例や余白を外すと位置合わせしやすくなります。"),
    h("div", { class: "gr-actions" },
      h("button", { class: "btn secondary", type: "button", onclick: () => { grClose(); openPdfPages(src); } }, "ページ選択へ"),
      h("button", { class: "btn secondary", type: "button", onclick: () => { Object.assign(crop, { x0: 0, y0: 0, x1: 1, y1: 1 }); draw(); } }, "全体"),
      info, nextBtn));
  layout();
  window.addEventListener("resize", layout);
  GR.cleanup = () => { window.removeEventListener("resize", layout); page.cleanup(); };
}

/** 手順4：対応点を置いて位置合わせ */
function grGeoref({ rec, blob, isNew, src }) {
  const ui = grOpenShell(isNew ? "位置合わせ" : `位置合わせ：${rec.title}`);
  const url = URL.createObjectURL(blob);
  const imgDiv = h("div", { class: "gr-map gr-imgmap" });
  const geoDiv = h("div", { class: "gr-map gr-geomap" });
  ui.body.append(h("div", { class: "gr-split" }, imgDiv, geoDiv));
  const W = rec.width, Hh = rec.height;

  // 上：画像（CRS.Simple。画像 px (u,v) ↔ latlng(-v, u)）
  const imap = L.map(imgDiv, { crs: L.CRS.Simple, minZoom: -6, maxZoom: 4, zoomSnap: 0.25, attributionControl: false, zoomControl: false });
  const ib = L.latLngBounds([[-Hh, 0], [0, W]]);
  L.imageOverlay(url, ib).addTo(imap);
  imap.fitBounds(ib);
  // 下：地図
  const gmap = L.map(geoDiv, { zoomControl: false, attributionControl: false, maxZoom: 20 }).setView(S.map.getCenter(), S.map.getZoom());
  let gbase = makeTile(BASE_LAYERS.find((b) => b.id === (S.baseId === "osm" ? "std" : S.baseId)) || BASE_LAYERS[0]).addTo(gmap);
  GR.maps.push(imap, gmap);
  setTimeout(() => { imap.invalidateSize(); gmap.invalidateSize(); imap.fitBounds(ib); }, 50);

  const gcps = rec.gcps; // [{u, v, lat, lon, pred?}]
  let sel = -1;
  let fit = null;
  let preview = null;
  const icon = (n, kind, cls = "") => L.divIcon({ className: `gr-pt ${kind} ${cls}`, iconSize: [26, 26], iconAnchor: [13, 13], html: `<span>${n}</span>` });
  const mk = { img: [], geo: [] };

  const usable = () => gcps.filter((g) => g.u != null && g.lat != null && !g.pred);
  const refit = () => {
    const pts = usable();
    const method = methodSel.value;
    fit = pts.length >= 3 ? georefFit(pts, method) : null;
    if (fit && fit.error) fit = { error: fit.error };
  };
  const redraw = () => {
    for (const m of mk.img) imap.removeLayer(m);
    for (const m of mk.geo) gmap.removeLayer(m);
    mk.img = []; mk.geo = [];
    gcps.forEach((g, i) => {
      const cls = i === sel ? "sel" : "";
      if (g.u != null) {
        const m = L.marker([-g.v, g.u], { icon: icon(i + 1, "img", cls), draggable: true, autoPan: true }).addTo(imap);
        m.on("dragend", () => { const ll = m.getLatLng(); g.u = clampU(ll.lng); g.v = clampV(-ll.lat); update(); });
        m.on("click", () => { sel = i; update(); });
        mk.img.push(m);
      }
      if (g.lat != null) {
        const m = L.marker([g.lat, g.lon], { icon: icon(i + 1, "geo", cls + (g.pred ? " pred" : "")), draggable: true, autoPan: true }).addTo(gmap);
        m.on("dragend", () => { const ll = m.getLatLng(); g.lat = ll.lat; g.lon = ll.lng; g.pred = false; update(); });
        m.on("click", () => { sel = i; update(); });
        mk.geo.push(m);
      }
    });
  };
  const clampU = (u) => Math.max(0, Math.min(W, u));
  const clampV = (v) => Math.max(0, Math.min(Hh, v));

  const msg = h("div", { class: "gr-msg" });
  const list = h("div", { class: "chips gr-list" });
  const methodSel = h("select", { class: "gr-method" },
    h("option", { value: "affine", selected: rec.method !== "projective" }, "アフィン変換（推奨）"),
    h("option", { value: "projective", selected: rec.method === "projective" }, "射影変換（4点以上・写真や斜めの図向け）"));
  methodSel.onchange = () => update();
  const baseSel = h("select", { class: "gr-method" }, ...BASE_LAYERS.map((b) => h("option", { value: b.id, selected: gbase && b.url === gbase._url }, b.name)));
  baseSel.onchange = () => { gmap.removeLayer(gbase); gbase = makeTile(BASE_LAYERS.find((b) => b.id === baseSel.value)).addTo(gmap); };
  // 下の地図を PDF の場所へ移動するための地名検索
  const q = h("input", { type: "search", placeholder: "地名で地図を移動（例：静岡市葵区牛妻）", enterkeyhint: "search" });
  const searchForm = h("form", { class: "gr-search" }, q, h("button", { type: "submit", class: "chip" }, "移動"));
  searchForm.onsubmit = async (e) => {
    e.preventDefault();
    q.blur();
    if (!q.value.trim()) return;
    try {
      const r = await searchPlace(q.value.trim());
      if (!r.length) return toast("見つかりませんでした");
      gmap.setView([r[0].lat, r[0].lon], 14);
      toast(r[0].title);
    } catch { toast("検索できませんでした"); }
  };
  const prevBtn = h("button", { type: "button", class: "chip" }, "重ねて確認");
  prevBtn.onclick = () => { prevBtn.classList.toggle("on"); update(); };
  const delBtn = h("button", { type: "button", class: "chip" }, "選択した点を削除");
  delBtn.onclick = () => { if (sel >= 0) { gcps.splice(sel, 1); sel = -1; update(); } };
  const saveBtn = h("button", { type: "button", class: "btn primary" }, "保存");

  const update = () => {
    refit();
    redraw();
    // 点の一覧
    list.replaceChildren(...gcps.map((g, i) => {
      const st = `${g.u != null ? "画" : "－"}${g.lat != null ? (g.pred ? "予" : "地") : "－"}`;
      const res = fit && fit.residuals ? fit.residuals[usable().indexOf(g)] : null;
      const c = h("button", { type: "button", class: "chip" + (i === sel ? " on" : "") }, `${i + 1}:${st}${res != null && res >= 0 ? ` ${res.toFixed(1)}m` : ""}`);
      c.onclick = () => {
        sel = sel === i ? -1 : i;
        if (sel >= 0) { if (g.u != null) imap.panTo([-g.v, g.u]); if (g.lat != null) gmap.panTo([g.lat, g.lon]); }
        update();
      };
      return c;
    }), delBtn);
    delBtn.hidden = sel < 0;
    // 案内
    const pend = gcps.findIndex((g) => g.u == null || g.lat == null || g.pred);
    const n = usable().length;
    let t;
    if (pend >= 0) {
      const g = gcps[pend];
      t = g.u == null ? `点${pend + 1}：上の画像で、地図と同じ場所をタップ` : g.pred
        ? `点${pend + 1}：下の地図の予測位置（点線）を正しい場所へドラッグ、または地図をタップして指定`
        : `点${pend + 1}：下の地図で、画像と同じ場所をタップ`;
    } else if (n < 3) t = `点${n + 1}：画像と地図で同じ場所（交差点・橋・河川の合流点など）を順にタップ。3点以上必要です`;
    else t = "点を追加するか、点をドラッグして微調整。終わったら「保存」";
    if (fit && fit.error) t = fit.error;
    else if (fit) t += fit.rms != null ? `　｜誤差 RMS ${fit.rms.toFixed(1)} m（${fit.n}点）` : `　｜${fit.n}点（誤差の確認には${methodSel.value === "projective" ? 5 : 4}点以上）`;
    msg.textContent = t;
    saveBtn.disabled = !(fit && fit.M);
    // 重ねて確認
    if (prevBtn.classList.contains("on") && fit && fit.M) {
      const r2 = { ...rec, M: fit.M, opacity: 0.6, multiply: true };
      if (!preview) preview = new PdfImageLayer(r2, url, { pane: "grPreview", zIndex: 350 }).addTo(gmap);
      else { preview.rec = r2; preview.applyStyle(); preview._reset(); }
    } else if (preview) { gmap.removeLayer(preview); preview = null; }
  };

  // タップで点を置く
  imap.on("click", (e) => {
    const u = clampU(e.latlng.lng), v = clampV(-e.latlng.lat);
    let g = gcps.find((x) => x.u == null);
    if (g) { g.u = u; g.v = v; }
    else {
      g = { u, v, lat: null, lon: null };
      // 3点以上あれば地図上の位置を予測して置く（ドラッグで合わせる）
      if (fit && fit.M) {
        const [x, y] = M3.apply(fit.M, u, v);
        const ll = fromMerc(x, y);
        Object.assign(g, { lat: ll.lat, lon: ll.lng, pred: true });
        gmap.panTo(ll);
      }
      gcps.push(g);
    }
    sel = gcps.indexOf(g);
    update();
  });
  gmap.on("click", (e) => {
    let g = gcps.find((x) => x.lat == null || x.pred);
    if (g) { g.lat = e.latlng.lat; g.lon = e.latlng.lng; g.pred = false; }
    else { g = { u: null, v: null, lat: e.latlng.lat, lon: e.latlng.lng }; gcps.push(g); }
    sel = gcps.indexOf(g);
    update();
  });

  saveBtn.onclick = async () => {
    refit();
    if (!fit || !fit.M) return;
    const clean = usable().map(({ u, v, lat, lon }) => ({ u: +u.toFixed(2), v: +v.toFixed(2), lat: +lat.toFixed(7), lon: +lon.toFixed(7) }));
    const out = {
      ...rec, gcps: clean, method: fit.method, M: fit.M, updatedAt: nowIso(),
      fit: { method: fit.method, rms: fit.rms, residuals: fit.residuals, n: fit.n },
    };
    try {
      if (isNew) {
        out.order = Math.max(0, ...[...PDFL.items.values()].map((it) => it.rec.order || 0)) + 1;
        await DB.put("overlayImages", { id: out.id, blob });
      }
      await DB.put("overlays", out);
    } catch (e) {
      return alert("保存できませんでした：" + e.message);
    }
    grClose();
    URL.revokeObjectURL(url);
    await loadPdfLayers();
    const it = PDFL.items.get(out.id);
    if (it) { setFollow(false); S.map.fitBounds(it.layer.bounds(), { padding: [20, 20] }); }
    toast(isNew ? "PDF 地図を追加しました（地図の切替で表示を調整できます）" : "位置合わせを更新しました");
    if (src && src.pdf && isNew && confirm("同じ PDF の別のページも追加しますか？")) openPdfPages(src);
    else if (src && src.pdf) src.pdf.destroy();
  };

  ui.foot.append(msg, list, searchForm,
    h("div", { class: "gr-actions" }, methodSel, baseSel, prevBtn,
      isNew && src ? h("button", { type: "button", class: "btn secondary", onclick: () => { grClose(); URL.revokeObjectURL(url); grCrop(src, rec.page); } }, "切り出しに戻る") : null,
      saveBtn));
  update();
}

/* ====================================================================
 * 書き出し・読み込み（ZIP に画像とワールドファイルを入れる）
 * ==================================================================== */
const WKT_3857 = 'PROJCS["WGS 84 / Pseudo-Mercator",GEOGCS["WGS 84",DATUM["WGS_1984",SPHEROID["WGS 84",6378137,298.257223563]],PRIMEM["Greenwich",0],UNIT["degree",0.0174532925199433]],PROJECTION["Mercator_1SP"],PARAMETER["central_meridian",0],PARAMETER["scale_factor",1],PARAMETER["false_easting",0],PARAMETER["false_northing",0],UNIT["metre",1],AXIS["Easting",EAST],AXIS["Northing",NORTH],EXTENSION["PROJ4","+proj=merc +a=6378137 +b=6378137 +lat_ts=0 +lon_0=0 +x_0=0 +y_0=0 +k=1 +units=m +nadgrids=@null +wktext +no_defs"],AUTHORITY["EPSG","3857"]]';

async function pdfLayersForExport(photoMode, files) {
  const recs = (await DB.all("overlays")).sort((a, b) => (a.order || 0) - (b.order || 0));
  const out = [];
  for (const [i, r] of recs.entries()) {
    const base = `overlays/pdfmap_${String(i + 1).padStart(2, "0")}`;
    const o = { ...r, file: `${base}.jpg`, mime: "image/jpeg", crs: "EPSG:3857", matrixNote: "M は画像 px (列,行) → EPSG:3857 (m) の 3x3 行列（行優先）" };
    if (photoMode === "file") {
      const img = await DB.get("overlayImages", r.id);
      if (img) {
        files.push({ path: o.file, blob: img.blob, date: new Date(r.updatedAt || r.createdAt) });
        if (r.method !== "projective") {
          // ワールドファイル（画素中心基準）：QGIS などでそのまま重ねられる
          const M = r.M;
          const [c, f] = M3.apply(M, 0.5, 0.5);
          files.push({ path: `${base}.jgw`, blob: new Blob([[M[0], M[3], M[1], M[4], c, f].map((v) => v.toFixed(10)).join("\r\n") + "\r\n"]) });
          files.push({ path: `${base}.prj`, blob: new Blob([WKT_3857]) });
        }
      }
    }
    out.push(o);
  }
  return out;
}

async function importPdfLayers(list, getBlob) {
  let n = 0;
  for (const o of list) {
    if (!o || !o.id || !o.M || (await DB.get("overlays", o.id))) continue;
    const blob = await getBlob({ file: o.file, mime: o.mime || "image/jpeg" });
    if (!blob) continue;
    const { file, mime, crs, matrixNote, ...rec } = o;
    await DB.put("overlayImages", { id: rec.id, blob });
    await DB.put("overlays", rec);
    n++;
  }
  if (n) await loadPdfLayers();
  return n;
}
