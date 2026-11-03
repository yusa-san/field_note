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

/* ====================================================================
 * 部分ごとの位置合わせ（ゆがんだ地図向け）
 * 画像を細かい格子に分け、格子点ごとに「近い対応点ほど重く」した最小二乗のアフィン変換を当てはめる
 * （Moving Least Squares）。隣り合う部分はなめらかにつながり、対応点の上ではほぼぴったり合う。
 * ==================================================================== */
const LOCAL_MIN_POINTS = 4;
const MESH_CELLS = 24; // 長辺方向の分割数

/** 画像上の点 (u,v) の行き先（メルカトル）を、対応点の重み付き最小二乗アフィンで求める。skip 番目の点は使わない */
function mlsMap(pts, u, v, scale, skip = -1) {
  let sw = 0, px = 0, py = 0, qx = 0, qy = 0;
  const w = new Array(pts.length);
  for (let i = 0; i < pts.length; i++) {
    if (i === skip) continue;
    const dx = (pts[i].u - u) * scale, dy = (pts[i].v - v) * scale;
    const d2 = dx * dx + dy * dy;
    w[i] = 1 / (d2 * d2 + 1e-14); // 距離の4乗に反比例：近い点ほど強く効く（部分ごとの性格を強める）
    sw += w[i];
    px += w[i] * pts[i].u; py += w[i] * pts[i].v;
    qx += w[i] * pts[i].x; qy += w[i] * pts[i].y;
  }
  px /= sw; py /= sw; qx /= sw; qy /= sw;
  // A = (Σ w p̂ᵀp̂)⁻¹ Σ w p̂ᵀq̂（p̂ = p - p*, q̂ = q - q*。行ベクトル表記）
  let a = 0, b = 0, d = 0, e11 = 0, e12 = 0, e21 = 0, e22 = 0;
  for (let i = 0; i < pts.length; i++) {
    if (i === skip) continue;
    const hx = pts[i].u - px, hy = pts[i].v - py, gx = pts[i].x - qx, gy = pts[i].y - qy;
    a += w[i] * hx * hx; b += w[i] * hx * hy; d += w[i] * hy * hy;
    e11 += w[i] * hx * gx; e12 += w[i] * hx * gy; e21 += w[i] * hy * gx; e22 += w[i] * hy * gy;
  }
  const det = a * d - b * b;
  if (!det || !isFinite(det)) return null;
  const i11 = d / det, i12 = -b / det, i22 = a / det;
  const A11 = i11 * e11 + i12 * e21, A12 = i11 * e12 + i12 * e22, A21 = i12 * e11 + i22 * e21, A22 = i12 * e12 + i22 * e22;
  const ux = u - px, vy = v - py;
  return [ux * A11 + vy * A21 + qx, ux * A12 + vy * A22 + qy];
}
/** 正方行列の連立一次方程式（部分ピボット付きガウス消去） */
function solveSquare(A, B) {
  const n = A.length, m = B[0].length;
  const M = A.map((r, i) => [...r, ...B[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-12) return null;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = c + 1; r < n; r++) {
      const f = M[r][c] / M[c][c];
      if (f) for (let k = c; k < n + m; k++) M[r][k] -= f * M[c][k];
    }
  }
  const X = Array.from({ length: n }, () => new Array(m).fill(0));
  for (let r = n - 1; r >= 0; r--) for (let j = 0; j < m; j++) {
    let v = M[r][n + j];
    for (let k = r + 1; k < n; k++) v -= M[r][k] * X[k][j];
    X[r][j] = v / M[r][r];
  }
  return X;
}
/** 薄板スプライン（TPS）：すべての対応点をなめらかに通る面で補間する */
function tpsModel(pts, scale) {
  const n = pts.length;
  const qx0 = pts.reduce((a, p) => a + p.x, 0) / n, qy0 = pts.reduce((a, p) => a + p.y, 0) / n;
  const P = pts.map((p) => [p.u * scale, p.v * scale]);
  const U = (r2) => (r2 > 0 ? r2 * Math.log(r2) : 0);
  const L = Array.from({ length: n + 3 }, () => new Array(n + 3).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) L[i][j] = U((P[i][0] - P[j][0]) ** 2 + (P[i][1] - P[j][1]) ** 2);
    L[i][n] = L[n][i] = 1; L[i][n + 1] = L[n + 1][i] = P[i][0]; L[i][n + 2] = L[n + 2][i] = P[i][1];
  }
  const B = [...pts.map((p) => [p.x - qx0, p.y - qy0]), [0, 0], [0, 0], [0, 0]];
  const X = solveSquare(L, B);
  if (!X) return null;
  return (u, v) => {
    const x = u * scale, y = v * scale;
    let rx = X[n][0] + X[n + 1][0] * x + X[n + 2][0] * y, ry = X[n][1] + X[n + 1][1] * x + X[n + 2][1] * y;
    for (let i = 0; i < n; i++) {
      const k = U((x - P[i][0]) ** 2 + (y - P[i][1]) ** 2);
      rx += k * X[i][0]; ry += k * X[i][1];
    }
    return [rx + qx0, ry + qy0];
  };
}
/** 部分ごとの変換関数 (u,v)→メルカトル。kind: "tps"（なめらか）| "mls"（近くの点を重視） */
function localModel(pts, W, H, kind, skip = -1) {
  const scale = 1 / Math.hypot(W, H);
  const use = skip >= 0 ? pts.filter((_, i) => i !== skip) : pts;
  if (kind === "mls") return (u, v) => mlsMap(use, u, v, scale);
  return tpsModel(use, scale);
}
function localPoints(gcps) {
  return gcps.map((g) => { const [x, y] = toMerc(g.lat, g.lon); return { u: g.u, v: g.v, x, y, lat: g.lat }; });
}
/** 格子点ごとの行き先を計算（保存して描画・判定に使う） */
function buildMesh(gcps, W, H, kind) {
  const f = localModel(localPoints(gcps), W, H, kind);
  if (!f) return null;
  const nx = W >= H ? MESH_CELLS : Math.max(4, Math.round((MESH_CELLS * W) / H));
  const ny = H >= W ? MESH_CELLS : Math.max(4, Math.round((MESH_CELLS * H) / W));
  const out = [];
  for (let j = 0; j <= ny; j++) for (let i = 0; i <= nx; i++) {
    const r = f((i * W) / nx, (j * H) / ny);
    if (!r || !isFinite(r[0]) || !isFinite(r[1])) return null;
    out.push(+r[0].toFixed(3), +r[1].toFixed(3));
  }
  return { nx, ny, pts: out };
}
/** 1点抜き検証：各点を、他の点だけで予測したときのずれ（m）。大きい点は置き間違いの可能性 */
function looErrors(gcps, W, H, kind) {
  const pts = localPoints(gcps);
  return pts.map((p, i) => {
    const f = localModel(pts, W, H, kind, i);
    const r = f && f(p.u, p.v);
    return r ? Math.hypot(r[0] - p.x, r[1] - p.y) * Math.cos((p.lat * Math.PI) / 180) : NaN;
  });
}
function georefFitLocal(gcps, W, H, kind = "tps") {
  const pts = gcps.filter((g) => g.u != null && g.lat != null);
  if (pts.length < LOCAL_MIN_POINTS) return { error: `部分ごとの位置合わせには ${LOCAL_MIN_POINTS} 点以上必要です（地図全体に散らばるよう 8 点以上がおすすめ）` };
  const g = georefFit(pts, "affine"); // 全体の目安（書き出しや予備用）
  if (g.error) return g;
  const mesh = buildMesh(pts, W, H, kind);
  if (!mesh) return { error: "計算できませんでした。点の配置を見直してください" };
  const residuals = looErrors(pts, W, H, kind);
  const ok = residuals.filter((r) => isFinite(r));
  const rms = ok.length ? Math.sqrt(ok.reduce((s, r) => s + r * r, 0) / ok.length) : null;
  return { M: g.M, mesh, residuals, rms, n: pts.length, method: "affine", local: true, kind };
}
/** レイヤの格子の外周（メルカトル） */
function meshOutline(mesh) {
  const { nx, ny, pts } = mesh, P = (i, j) => [pts[2 * (j * (nx + 1) + i)], pts[2 * (j * (nx + 1) + i) + 1]];
  const o = [];
  for (let i = 0; i <= nx; i++) o.push(P(i, 0));
  for (let j = 1; j <= ny; j++) o.push(P(nx, j));
  for (let i = nx - 1; i >= 0; i--) o.push(P(i, ny));
  for (let j = ny - 1; j > 0; j--) o.push(P(0, j));
  return o;
}
function pointInPolygon(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
const isLocal = (rec) => rec.warp === "local" && rec.mesh;

/* ====================================================================
 * 地図レイヤの描画
 * 画面サイズの canvas に、パン・ズームが止まったときだけ描き直す（Leaflet の Canvas レンダラと同じ方式）。
 * 巨大な画像要素を 3D 変形して重ねる方式は、スマホの GPU メモリを使い切ってちらつき・操作不能の原因になるため使わない。
 * ==================================================================== */
const PdfCanvas = L.Renderer.extend({
  options: { padding: 0.3 },
  initialize(options) {
    L.Renderer.prototype.initialize.call(this, options);
    this._items = [];
  },
  _initContainer() {
    const c = (this._container = document.createElement("canvas"));
    c.className = "pdf-canvas";
    this._ctx = c.getContext("2d");
  },
  _destroyContainer() {
    L.DomUtil.remove(this._container);
    delete this._ctx;
  },
  _updatePaths() {},
  _update() {
    if (this._map._animatingZoom && this._bounds) return;
    L.Renderer.prototype._update.call(this);
    const b = this._bounds, size = b.getSize();
    const m = (this._dpr = Math.min(window.devicePixelRatio || 1, 2));
    L.DomUtil.setPosition(this._container, b.min);
    this._container.width = Math.round(m * size.x);
    this._container.height = Math.round(m * size.y);
    this._container.style.width = size.x + "px";
    this._container.style.height = size.y + "px";
    this.redraw();
  },
  add(item) {
    if (!this._items.includes(item)) this._items.push(item);
    item.renderer = this;
    this.redrawSoon();
  },
  remove(item) {
    this._items = this._items.filter((x) => x !== item);
    this.redrawSoon();
  },
  redrawSoon() {
    if (this._raf) return;
    this._raf = requestAnimationFrame(() => { this._raf = 0; this.redraw(); });
  },
  redraw() {
    const ctx = this._ctx;
    if (!ctx || !this._map || !this._bounds) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this._container.width, this._container.height);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    for (const it of [...this._items].sort((a, b) => (a.rec.order || 0) - (b.rec.order || 0))) {
      if (!it.bmp || !it.rec.M) continue;
      ctx.globalAlpha = it.rec.opacity ?? 0.8;
      drawWarped(ctx, it, this._map, this._dpr, this._bounds.min);
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
  },
});

/** 部分ごとの位置合わせ：格子の各マスを2つの三角形に分け、三角形ごとにアフィンで描く */
function drawMesh(ctx, it, map, m, origin) {
  const { width: W, height: H, mesh } = it.rec;
  const { nx, ny, pts } = mesh;
  const g = new Array((nx + 1) * (ny + 1));
  for (let k = 0; k < g.length; k++) {
    const p = map.latLngToLayerPoint(fromMerc(pts[2 * k], pts[2 * k + 1]));
    g[k] = [p.x - origin.x, p.y - origin.y];
  }
  const cw = W / nx, ch = H / ny, kx = it.bmp.width / W, ky = it.bmp.height / H;
  const cvw = ctx.canvas.width / m, cvh = ctx.canvas.height / m;
  const tri = (A, B, C, a, b, O, x0, y0) => {
    // 画面外の三角形は描かない
    const minx = Math.min(A[0], B[0], C[0]), maxx = Math.max(A[0], B[0], C[0]), miny = Math.min(A[1], B[1], C[1]), maxy = Math.max(A[1], B[1], C[1]);
    if (maxx < 0 || maxy < 0 || minx > cvw || miny > cvh) return;
    // 継ぎ目に髪の毛のような隙間が出ないよう、三角形を重心から少しだけ広げて切り抜く
    const cx = (A[0] + B[0] + C[0]) / 3, cy = (A[1] + B[1] + C[1]) / 3;
    const ex = (P) => { const dx = P[0] - cx, dy = P[1] - cy, d = Math.hypot(dx, dy) || 1; return [P[0] + (dx / d) * 0.7, P[1] + (dy / d) * 0.7]; };
    const [a1, b1, c1] = [ex(A), ex(B), ex(C)];
    ctx.save();
    ctx.setTransform(m, 0, 0, m, 0, 0);
    ctx.beginPath(); ctx.moveTo(a1[0], a1[1]); ctx.lineTo(b1[0], b1[1]); ctx.lineTo(c1[0], c1[1]); ctx.closePath();
    ctx.clip();
    ctx.setTransform(m * a[0], m * a[1], m * b[0], m * b[1], m * O[0], m * O[1]);
    const l = Math.max(0, x0 - 2), t = Math.max(0, y0 - 2), r = Math.min(W, x0 + cw + 2), bt = Math.min(H, y0 + ch + 2);
    ctx.drawImage(it.bmp, l * kx, t * ky, (r - l) * kx, (bt - t) * ky, l - x0, t - y0, r - l, bt - t);
    ctx.restore();
  };
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const A = g[j * (nx + 1) + i], B = g[j * (nx + 1) + i + 1], C = g[(j + 1) * (nx + 1) + i], D = g[(j + 1) * (nx + 1) + i + 1];
    const x0 = i * cw, y0 = j * ch;
    // 三角形 ABC：A を原点に、横方向 (B-A)/cw・縦方向 (C-A)/ch
    tri(A, B, C, [(B[0] - A[0]) / cw, (B[1] - A[1]) / cw], [(C[0] - A[0]) / ch, (C[1] - A[1]) / ch], A, x0, y0);
    // 三角形 DCB：D が (x0+cw, y0+ch) に対応
    const a2 = [(D[0] - C[0]) / cw, (D[1] - C[1]) / cw], b2 = [(D[0] - B[0]) / ch, (D[1] - B[1]) / ch];
    tri(D, C, B, a2, b2, [D[0] - a2[0] * cw - b2[0] * ch, D[1] - a2[1] * cw - b2[1] * ch], x0, y0);
  }
}

/** 画像を変換行列どおりに描く。射影変換は格子に分けて各マスをアフィンで近似 */
function drawWarped(ctx, it, map, m, origin) {
  if (isLocal(it.rec)) return drawMesh(ctx, it, map, m, origin);
  const { width: W, height: H, M } = it.rec;
  const n = it.rec.method === "projective" ? 12 : 1;
  const P = (u, v) => {
    const [x, y] = M3.apply(M, u, v);
    const p = map.latLngToLayerPoint(fromMerc(x, y));
    return [p.x - origin.x, p.y - origin.y];
  };
  const g = [];
  for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) g.push(P((i * W) / n, (j * H) / n));
  const kx = it.bmp.width / W, ky = it.bmp.height / H;
  const cw = W / n, ch = H / n, ov = n > 1 ? 1 : 0; // 格子の継ぎ目に隙間が出ないよう 1px 重ねる
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const p00 = g[j * (n + 1) + i], p10 = g[j * (n + 1) + i + 1], p01 = g[(j + 1) * (n + 1) + i];
    const x0 = i * cw, y0 = j * ch;
    const ax = (p10[0] - p00[0]) / cw, ay = (p10[1] - p00[1]) / cw, bx = (p01[0] - p00[0]) / ch, by = (p01[1] - p00[1]) / ch;
    ctx.setTransform(m * ax, m * ay, m * bx, m * by, m * p00[0], m * p00[1]);
    const l = Math.max(0, x0 - ov), t = Math.max(0, y0 - ov), r = Math.min(W, x0 + cw + ov), bt = Math.min(H, y0 + ch + ov);
    ctx.drawImage(it.bmp, l * kx, t * ky, (r - l) * kx, (bt - t) * ky, l - x0, t - y0, r - l, bt - t);
  }
}

/** 表示用の画像（モノクロ・白を透過を画素に焼き込んだもの）を用意する。設定が変わったときだけ作り直す */
async function ensurePdfBitmap(it) {
  const key = (it.rec.gray ? "g" : "") + (it.rec.multiply ? "w" : "");
  if (it.bmp && it.bmpKey === key) return;
  const token = (it._token = (it._token || 0) + 1);
  let bmp;
  try {
    const base = await createImageBitmap(it.blob);
    if (!key) bmp = base;
    else {
      const c = document.createElement("canvas");
      c.width = base.width;
      c.height = base.height;
      const ctx = c.getContext("2d", { willReadFrequently: true });
      ctx.drawImage(base, 0, 0);
      base.close();
      const STRIP = 200;
      for (let y = 0; y < c.height; y += STRIP) {
        const hh = Math.min(STRIP, c.height - y);
        const id = ctx.getImageData(0, y, c.width, hh);
        bakePixels(id.data, it.rec.gray, it.rec.multiply);
        ctx.putImageData(id, 0, y);
        if (token !== it._token) { c.width = c.height = 0; return; }
        if ((y / STRIP) % 4 === 3) await new Promise((r) => setTimeout(r)); // 画面が固まらないよう少しずつ
      }
      bmp = await createImageBitmap(c);
      c.width = c.height = 0;
    }
  } catch (e) {
    console.warn("PDF 地図の画像を用意できません", e);
    return;
  }
  if (token !== it._token) { bmp.close(); return; }
  if (it.bmp) it.bmp.close();
  it.bmp = bmp;
  it.bmpKey = key;
  if (it.renderer) it.renderer.redrawSoon();
}
function bakePixels(d, gray, white) {
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i], g = d[i + 1], b = d[i + 2];
    if (white) {
      // 白に近いほど透明に（紙の白い背景を消して下の地図を見せる）
      const mn = r < g ? (r < b ? r : b) : (g < b ? g : b);
      d[i + 3] = mn >= 245 ? 0 : mn <= 200 ? d[i + 3] : ((245 - mn) * 255) / 45;
    }
    if (gray) {
      let y = 0.299 * r + 0.587 * g + 0.114 * b;
      y = (y - 128) * 1.1 + 128;
      d[i] = d[i + 1] = d[i + 2] = y < 0 ? 0 : y > 255 ? 255 : y;
    }
  }
}
function releasePdfBitmap(it) {
  it._token = (it._token || 0) + 1;
  if (it.bmp) it.bmp.close();
  it.bmp = null;
  it.bmpKey = null;
}

/** 1 枚の PDF 地図（表示用データ） */
function makePdfItem(rec, blob) {
  return {
    rec, blob, bmp: null, bmpKey: null, renderer: null,
    corners() {
      if (isLocal(this.rec)) return meshOutline(this.rec.mesh).map(([x, y]) => fromMerc(x, y));
      const { width: w, height: h, M } = this.rec;
      return [[0, 0], [w, 0], [w, h], [0, h]].map(([u, v]) => { const [x, y] = M3.apply(M, u, v); return fromMerc(x, y); });
    },
    bounds() { return L.latLngBounds(this.corners()); },
  };
}

/* ====================================================================
 * 保存済みレイヤの管理（メイン地図）
 * ==================================================================== */
const PDFL = { items: new Map(), renderer: null }; // id -> item

function pdfRenderer() {
  if (!PDFL.renderer) {
    const pane = S.map.createPane("pdfPane");
    pane.style.zIndex = 350;
    pane.style.pointerEvents = "none"; // 地図やボタンの操作を邪魔しない
    PDFL.renderer = new PdfCanvas({ pane: "pdfPane" }).addTo(S.map);
  }
  return PDFL.renderer;
}
function showPdfItem(it) {
  pdfRenderer().add(it);
  ensurePdfBitmap(it);
}
function hidePdfItem(it) {
  if (PDFL.renderer) PDFL.renderer.remove(it);
  releasePdfBitmap(it); // 非表示の地図はメモリを解放
}
/** 表示設定（透明度・モノクロ・白を透過）を反映 */
function refreshPdfItem(it) {
  if (it.rec.visible === false) return;
  ensurePdfBitmap(it);
  if (PDFL.renderer) PDFL.renderer.redrawSoon();
}

async function loadPdfLayers() {
  for (const it of PDFL.items.values()) hidePdfItem(it);
  PDFL.items.clear();
  const recs = (await DB.all("overlays")).sort((a, b) => (a.order || 0) - (b.order || 0));
  for (const rec of recs) {
    const img = await DB.get("overlayImages", rec.id);
    if (!img) continue;
    const it = makePdfItem(rec, img.blob);
    PDFL.items.set(rec.id, it);
    if (rec.visible !== false) showPdfItem(it);
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
  if (on) showPdfItem(it);
  else hidePdfItem(it);
  savePdfRecSoon(it.rec);
}

async function deletePdfLayer(id) {
  const it = PDFL.items.get(id);
  if (!it) return;
  hidePdfItem(it);
  PDFL.items.delete(id);
  await DB.del("overlays", id);
  await DB.del("overlayImages", id);
}

/** 地図タップ：PDF 地図の上ならポップアップ（上に重なっているものを優先） */
function pdfLayerClick(latlng) {
  const items = [...PDFL.items.values()].filter((it) => it.rec.visible !== false).sort((a, b) => (b.rec.order || 0) - (a.rec.order || 0));
  const [x, y] = toMerc(latlng.lat, latlng.lng);
  for (const it of items) {
    if (isLocal(it.rec)) {
      if (!pointInPolygon(x, y, meshOutline(it.rec.mesh))) continue;
    } else {
      const inv = M3.inv(it.rec.M);
      if (!inv) continue;
      const [u, v] = M3.apply(inv, x, y);
      if (u < 0 || v < 0 || u > it.rec.width || v > it.rec.height) continue;
    }
    const r = it.rec;
    const link = r.sourceUrl ? `${r.sourceUrl}${/\.pdf($|\?)/i.test(r.sourceUrl) && !r.sourceUrl.includes("#") ? `#page=${r.page}` : ""}` : null;
    const el = h("div", {},
      h("div", { class: "pt" }, r.title || "PDF 地図"),
      h("div", { class: "ps" }, [`p.${r.page}`, r.sourceName, isLocal(r) ? "部分ごと" : "", r.fit?.rms != null ? `${isLocal(r) ? "検証誤差" : "誤差"} 約${r.fit.rms.toFixed(1)} m` : ""].filter(Boolean).join("　")),
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
        refreshPdfItem(it);
        savePdfRecSoon(r);
      };
      const toggle = (key, label) => {
        const c = h("button", { type: "button", class: "chip" + (r[key] ? " on" : "") }, label);
        c.onclick = () => { r[key] = !r[key]; c.classList.toggle("on", !!r[key]); refreshPdfItem(it); savePdfRecSoon(r); };
        return c;
      };
      const act = (label, fn) => h("button", { type: "button", class: "chip", onclick: fn }, label);
      box.append(h("div", { class: "pdf-row" },
        h("div", { class: "ov-row", style: "border:0;padding-bottom:2px" }, cb,
          h("div", {}, r.title || "PDF 地図", h("small", {}, [`p.${r.page}`, r.sourceName, isLocal(r) ? "部分ごと" : "", r.fit?.rms != null ? `${isLocal(r) ? "検証誤差" : "誤差"} 約${r.fit.rms.toFixed(1)} m` : ""].filter(Boolean).join("・"))), rg),
        h("div", { class: "chips" },
          toggle("gray", "モノクロ"), toggle("multiply", "白を透過"),
          act("範囲へ", () => { closeSheet(true); setFollow(false); if (r.visible === false) setPdfVisible(r.id, true); S.map.fitBounds(it.bounds(), { padding: [20, 20] }); }),
          act("位置合わせ", () => { closeSheet(true); openGeoref({ existing: r.id }); }),
          act("名前・出典", () => openPdfLayerEdit(r.id)),
          act("GeoTIFF 保存", () => exportPdfLayerGeoTiff(r.id)),
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
    h("p", { class: "note" }, `元ファイル：${r.sourceName || "—"}　ページ：${r.page}　画像：${r.width}×${r.height}px　変換：${isLocal(r) ? "部分ごとに合わせる" : r.fit?.method === "projective" ? "射影" : "アフィン"}（${r.gcps.length}点）`),
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
    if (localCb.checked) fit = pts.length >= 3 ? georefFitLocal(pts, W, Hh, kindSel.value) : null;
    else fit = pts.length >= 3 ? georefFit(pts, method) : null;
    if (fit && fit.error) fit = { error: fit.error };
  };
  /** 画像上の点の地図上の予測位置 */
  const predict = (u, v) => {
    if (!fit || !fit.M) return null;
    if (fit.local) {
      const f = localModel(localPoints(usable()), W, Hh, fit.kind);
      const r = f && f(u, v);
      if (r) return fromMerc(r[0], r[1]);
    }
    const [x, y] = M3.apply(fit.M, u, v);
    return fromMerc(x, y);
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
  // 部分ごとに合わせるモード（ゆがんだ地図向け）
  const localCb = h("input", { type: "checkbox", checked: rec.warp === "local" });
  localCb.onchange = () => update();
  const kindSel = h("select", { class: "gr-method" },
    h("option", { value: "tps", selected: rec.warpKind !== "mls" }, "なめらか（推奨）"),
    h("option", { value: "mls", selected: rec.warpKind === "mls" }, "近くの点を重視"));
  kindSel.onchange = () => update();
  const localLabel = h("div", { class: "gr-actions" }, h("label", { class: "inline gr-local" }, localCb, "部分ごとに合わせる（ゆがんだ地図向け）"), kindSel);
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
    else if (fit && fit.local) t += fit.rms != null ? `　｜部分ごと：検証誤差 RMS ${fit.rms.toFixed(1)} m（${fit.n}点。各点を他の点だけで予測したずれ。大きい点は置き間違いの可能性）` : `　｜部分ごと（${fit.n}点）`;
    else if (fit) t += fit.rms != null ? `　｜誤差 RMS ${fit.rms.toFixed(1)} m（${fit.n}点）` : `　｜${fit.n}点（誤差の確認には${methodSel.value === "projective" ? 5 : 4}点以上）`;
    if (localCb.checked && !fit) t += `　｜部分ごとの位置合わせは ${LOCAL_MIN_POINTS} 点以上・地図全体に散らばるよう 8 点以上がおすすめ`;
    methodSel.disabled = localCb.checked;
    kindSel.hidden = !localCb.checked;
    msg.textContent = t;
    saveBtn.disabled = !(fit && fit.M);
    // 重ねて確認
    if (prevBtn.classList.contains("on") && fit && fit.M) {
      const r2 = { ...rec, M: fit.M, method: fit.method, warp: fit.local ? "local" : null, mesh: fit.local ? fit.mesh : null, opacity: 0.6, multiply: true };
      if (!preview) {
        const pane = gmap.getPane("grPreview") || gmap.createPane("grPreview");
        pane.style.zIndex = 350;
        pane.style.pointerEvents = "none";
        preview = { renderer: new PdfCanvas({ pane: "grPreview" }).addTo(gmap), item: makePdfItem(r2, blob) };
        preview.renderer.add(preview.item);
        ensurePdfBitmap(preview.item);
      } else {
        preview.item.rec = r2;
        preview.renderer.redrawSoon();
      }
    } else if (preview) {
      releasePdfBitmap(preview.item);
      gmap.removeLayer(preview.renderer);
      preview = null;
    }
  };

  // タップで点を置く
  imap.on("click", (e) => {
    const u = clampU(e.latlng.lng), v = clampV(-e.latlng.lat);
    let g = gcps.find((x) => x.u == null);
    if (g) { g.u = u; g.v = v; }
    else {
      g = { u, v, lat: null, lon: null };
      // 3点以上あれば地図上の位置を予測して置く（ドラッグで合わせる）
      const ll = predict(u, v);
      if (ll) {
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
      warp: fit.local ? "local" : null, mesh: fit.local ? fit.mesh : null, warpKind: fit.local ? fit.kind : null,
      fit: { method: fit.method, local: !!fit.local, kind: fit.kind || null, rms: fit.rms, residuals: fit.residuals, n: fit.n },
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
    if (it) { setFollow(false); S.map.fitBounds(it.bounds(), { padding: [20, 20] }); }
    toast(isNew ? "PDF 地図を追加しました（地図の切替で表示を調整できます）" : "位置合わせを更新しました");
    if (src && src.pdf && isNew && confirm("同じ PDF の別のページも追加しますか？")) openPdfPages(src);
    else if (src && src.pdf) src.pdf.destroy();
  };

  ui.foot.append(msg, list, searchForm,
    localLabel,
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
    const o = { ...r, file: `${base}.jpg`, mime: "image/jpeg", crs: "EPSG:3857", matrixNote: "M は画像 px (列,行) → EPSG:3857 (m) の 3x3 行列（行優先）。warp=local のときは mesh（格子点ごとの EPSG:3857 座標、(nx+1)×(ny+1) 点を行ごと）で表示し、M は全体の目安" };
    if (photoMode === "file") {
      const img = await DB.get("overlayImages", r.id);
      if (img) {
        files.push({ path: o.file, blob: img.blob, date: new Date(r.updatedAt || r.createdAt) });
        if (r.method !== "projective" && !isLocal(r)) {
          // ワールドファイル（画素中心基準）：QGIS などでそのまま重ねられる
          const M = r.M;
          const [c, f] = M3.apply(M, 0.5, 0.5);
          files.push({ path: `${base}.jgw`, blob: new Blob([[M[0], M[3], M[1], M[4], c, f].map((v) => v.toFixed(10)).join("\r\n") + "\r\n"]) });
          files.push({ path: `${base}.prj`, blob: new Blob([WKT_3857]) });
        }
        // 位置合わせ済みのラスタ（どの変換方式でも作る）
        try {
          toast(`PDF 地図 ${i + 1}/${recs.length} を GeoTIFF に変換中…`, 60000);
          const t = await pdfLayerGeoTiff(r, img.blob);
          files.push({ path: `${base}_georef.tif`, blob: t.blob, date: new Date(r.updatedAt || r.createdAt) });
          o.georefFile = `${base}_georef.tif`;
        } catch (e) {
          console.warn("GeoTIFF を作成できません", e);
        }
      }
    }
    out.push(o);
  }
  return out;
}

/* ====================================================================
 * GeoTIFF（位置合わせ済みのラスタ）として書き出す
 * 変形済みの画像を北が上の EPSG:3857 の格子に描き直し、座標付き TIFF にする（外部ライブラリなし）
 * ==================================================================== */
const RASTER_MAX_AREA = 14e6;  // スマホの canvas 上限より少し小さく
const RASTER_MAX_SIDE = 12000;

/** 元画像 1 画素がメルカトルで何 m に当たるか（細部を落とさない解像度の目安） */
function sourcePixelSize(rec) {
  if (isLocal(rec)) {
    const { nx, ny, pts } = rec.mesh, cw = rec.width / nx, ch = rec.height / ny, v = [];
    const P = (i, j) => [pts[2 * (j * (nx + 1) + i)], pts[2 * (j * (nx + 1) + i) + 1]];
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const a = P(i, j), b = P(i + 1, j), c = P(i, j + 1);
      v.push(Math.hypot(b[0] - a[0], b[1] - a[1]) / cw, Math.hypot(c[0] - a[0], c[1] - a[1]) / ch);
    }
    v.sort((x, y) => x - y);
    return v[Math.floor(v.length / 2)];
  }
  const u = rec.width / 2, w = rec.height / 2;
  const o = M3.apply(rec.M, u, w), a = M3.apply(rec.M, u + 1, w), b = M3.apply(rec.M, u, w + 1);
  return Math.min(Math.hypot(a[0] - o[0], a[1] - o[1]), Math.hypot(b[0] - o[0], b[1] - o[1]));
}

/** 位置合わせ済みの画像を、北が上・EPSG:3857 の画素格子に描き直す */
async function rectifyPdfLayer(rec, blob) {
  const outline = isLocal(rec) ? meshOutline(rec.mesh)
    : [[0, 0], [rec.width, 0], [rec.width, rec.height], [0, rec.height]].map(([u, v]) => M3.apply(rec.M, u, v));
  const xs = outline.map((p) => p[0]), ys = outline.map((p) => p[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  let res = sourcePixelSize(rec);
  let w = Math.ceil((maxX - minX) / res), hh = Math.ceil((maxY - minY) / res);
  const k = Math.max(1, Math.sqrt((w * hh) / RASTER_MAX_AREA), w / RASTER_MAX_SIDE, hh / RASTER_MAX_SIDE);
  if (k > 1) { res *= k; w = Math.ceil((maxX - minX) / res); hh = Math.ceil((maxY - minY) / res); }
  const bmp = await createImageBitmap(blob);
  const c = document.createElement("canvas");
  c.width = w; c.height = hh;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  // 地図の代わりに「メルカトル → 出力画素」の変換を渡して、表示と同じ描画処理を使う
  const raster = { latLngToLayerPoint: (ll) => { const [x, y] = toMerc(ll.lat, ll.lng); return L.point((x - minX) / res, (maxY - y) / res); } };
  drawWarped(ctx, { rec, bmp }, raster, 1, { x: 0, y: 0 });
  bmp.close();
  const data = ctx.getImageData(0, 0, w, hh).data;
  c.width = c.height = 0;
  return { data, w, h: hh, res, minX, maxY };
}

async function deflate(u8) {
  return new Uint8Array(await new Response(new Blob([u8]).stream().pipeThrough(new CompressionStream("deflate"))).arrayBuffer());
}

/** RGBA の画素から GeoTIFF（EPSG:3857・Deflate 圧縮・アルファ付き）を作る */
async function makeGeoTiff({ data, w, h, res, minX, maxY }, onProgress) {
  const compress = typeof CompressionStream === "function";
  const rowsPerStrip = Math.max(1, Math.floor(262144 / (w * 4)));
  const strips = [];
  for (let y = 0; y < h; y += rowsPerStrip) {
    const rows = Math.min(rowsPerStrip, h - y);
    let s = data.slice(y * w * 4, (y + rows) * w * 4);
    if (compress) {
      // 予測子2（横方向の差分）：地図のような画像は圧縮が大きく効く
      for (let r = 0; r < rows; r++) {
        const o = r * w * 4;
        for (let x = w - 1; x > 0; x--) for (let c = 0; c < 4; c++) s[o + x * 4 + c] = (s[o + x * 4 + c] - s[o + (x - 1) * 4 + c]) & 255;
      }
      s = await deflate(s);
    }
    strips.push(s);
    if (onProgress) onProgress(Math.min(1, (y + rows) / h));
  }
  // ファイル構成：ヘッダ(8) → 画素データ → タグの値 → IFD
  let off = 8;
  const stripOffsets = strips.map((s) => { const o = off; off += s.length; return o; });
  const extra = [];
  const put = (bytes) => { if (off % 2) { extra.push(new Uint8Array(1)); off++; } const o = off; extra.push(bytes); off += bytes.length; return o; };
  const u16 = (a) => { const b = new Uint8Array(a.length * 2), v = new DataView(b.buffer); a.forEach((x, i) => v.setUint16(i * 2, x, true)); return b; };
  const u32 = (a) => { const b = new Uint8Array(a.length * 4), v = new DataView(b.buffer); a.forEach((x, i) => v.setUint32(i * 4, x, true)); return b; };
  const f64 = (a) => { const b = new Uint8Array(a.length * 8), v = new DataView(b.buffer); a.forEach((x, i) => v.setFloat64(i * 8, x, true)); return b; };
  const SHORT = 3, LONG = 4, DOUBLE = 12;
  const tags = [];
  const tag = (id, type, values) => {
    const size = { 3: 2, 4: 4, 12: 8 }[type] * values.length;
    const bytes = type === SHORT ? u16(values) : type === LONG ? u32(values) : f64(values);
    tags.push({ id, type, count: values.length, inline: size <= 4 ? bytes : null, offset: size <= 4 ? 0 : put(bytes) });
  };
  tag(256, LONG, [w]);
  tag(257, LONG, [h]);
  tag(258, SHORT, [8, 8, 8, 8]);
  tag(259, SHORT, [compress ? 8 : 1]);           // 8 = Deflate
  tag(262, SHORT, [2]);                          // RGB
  tag(273, LONG, stripOffsets);
  tag(277, SHORT, [4]);
  tag(278, LONG, [rowsPerStrip]);
  tag(279, LONG, strips.map((s) => s.length));
  tag(284, SHORT, [1]);
  if (compress) tag(317, SHORT, [2]);            // 予測子
  tag(338, SHORT, [2]);                          // アルファ（非乗算）
  tag(33550, DOUBLE, [res, res, 0]);             // 画素の大きさ (m)
  tag(33922, DOUBLE, [0, 0, 0, minX, maxY, 0]);  // 左上の座標
  // GeoKey：投影座標系・画素は面・EPSG:3857・単位 m
  tag(34735, SHORT, [1, 1, 0, 4, 1024, 0, 1, 1, 1025, 0, 1, 1, 3072, 0, 1, 3857, 3076, 0, 1, 9001]);
  if (off % 2) { extra.push(new Uint8Array(1)); off++; }
  const ifdOff = off;
  const ifd = new DataView(new ArrayBuffer(2 + tags.length * 12 + 4));
  ifd.setUint16(0, tags.length, true);
  tags.sort((a, b) => a.id - b.id).forEach((t, i) => {
    const o = 2 + i * 12;
    ifd.setUint16(o, t.id, true); ifd.setUint16(o + 2, t.type, true); ifd.setUint32(o + 4, t.count, true);
    if (t.inline) new Uint8Array(ifd.buffer).set(t.inline, o + 8);
    else ifd.setUint32(o + 8, t.offset, true);
  });
  const head = new DataView(new ArrayBuffer(8));
  head.setUint8(0, 0x49); head.setUint8(1, 0x49); head.setUint16(2, 42, true); head.setUint32(4, ifdOff, true);
  return new Blob([head.buffer, ...strips, ...extra, ifd.buffer], { type: "image/tiff" });
}

async function pdfLayerGeoTiff(rec, blob, onProgress) {
  const r = await rectifyPdfLayer(rec, blob);
  return { blob: await makeGeoTiff(r, onProgress), w: r.w, h: r.h, res: r.res };
}

/** 1 枚の PDF 地図を GeoTIFF として端末に保存 */
async function exportPdfLayerGeoTiff(id) {
  const it = PDFL.items.get(id);
  if (!it) return;
  toast("GeoTIFF を作成中…", 60000);
  try {
    const t = await pdfLayerGeoTiff(it.rec, it.blob, (f) => toast(`GeoTIFF を作成中… ${Math.round(f * 100)}%`, 60000));
    const name = `${safeName(it.rec.title) || "pdfmap"}_georef.tif`;
    toast(`GeoTIFF：${t.w}×${t.h}px・1画素 約${(t.res * Math.cos((it.bounds().getCenter().lat * Math.PI) / 180)).toFixed(2)} m・${(t.blob.size / 1048576).toFixed(1)} MB`, 4000);
    await deliverBlob(t.blob, name, "image/tiff", "download");
  } catch (e) {
    alert("GeoTIFF を作成できませんでした：" + e.message);
  }
}

async function importPdfLayers(list, getBlob) {
  let n = 0;
  for (const o of list) {
    if (!o || !o.id || !o.M || (await DB.get("overlays", o.id))) continue;
    const blob = await getBlob({ file: o.file, mime: o.mime || "image/jpeg" });
    if (!blob) continue;
    const { file, mime, crs, matrixNote, georefFile, ...rec } = o;
    await DB.put("overlayImages", { id: rec.id, blob });
    await DB.put("overlays", rec);
    n++;
  }
  if (n) await loadPdfLayers();
  return n;
}
