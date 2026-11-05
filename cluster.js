/* 地図のピンをまとめる（メモが多いときに引きの地図を軽くする）
 *
 * - ズーム 17 未満で、画面上で重なるピンを 1 つの「まとまり」（件数の丸。写真表示中なら代表の写真＋件数）にする。
 *   地図に置く DOM の数が減るので、拡大縮小・移動が軽くなる。まとまりを押すと、その範囲へ拡大する
 * - 大きく表示する写真（お気に入り）は、写真どうしが重なる所では 1 枚だけ（大きいもの・番号の小さいもの）を出し、
 *   ほかは近くのまとまりの件数に入れる
 * - ピンを動かす・まとめてずらす間は、すべてのピンを出す（まとめない）
 * - 設定：自動（メモ 60 件以上でまとめる）／いつもまとめる／まとめない
 * - 「地図にピンを表示」で出さないメモは、まとまりにも入れない（一覧から選んだもの・ポップアップを開いたものは一時的に出す）
 */
const CL = { on: false, visible: new Set(), forced: new Set(), clusters: [], raf: 0, batch: false };
const CL_MAX_ZOOM = 17; // これ以上の拡大ではまとめない
const CL_AUTO_MIN = 60;
const clMode = () => (["auto", "on", "off"].includes(Settings.data.clusterMode) ? Settings.data.clusterMode : "auto");
function clActive() {
  if (!S.map || PIN.on || SH.on) return false;
  const mode = clMode();
  if (mode === "off") return false;
  if (mode === "auto" && clShownCount() < CL_AUTO_MIN) return false;
  return S.map.getZoom() < CL_MAX_ZOOM;
}
function clShownCount() {
  if (pinsMode() === "all") return S.memos.size;
  let n = 0;
  for (const m of S.memos.values()) if (pinShown(m)) n++;
  return n;
}
/** renderMarker から：このメモのピンを今地図に置くか */
const clShows = (id) => CL.forced.has(id) || (pinShown(S.memos.get(id)) && (!CL.on || CL.visible.has(id)));
/** 地図に置くピンを入れ替える（差分だけ） */
function clSync() {
  for (const [id, mk] of S.markers) {
    const show = clShows(id);
    if (show && !mk._map) mk.addTo(S.map);
    else if (!show && mk._map && !mk.isPopupOpen?.()) S.map.removeLayer(mk);
  }
}
function clSchedule() {
  if (CL.batch || CL.raf) return;
  CL.raf = requestAnimationFrame(() => { CL.raf = 0; clUpdate(); });
}
function clUpdate() {
  if (!S.map) return;
  CL.on = clActive();
  for (const c of CL.clusters) c.remove();
  CL.clusters = [];
  if (!CL.on) {
    CL.visible.clear();
    clSync();
    return;
  }
  const z = S.map.getZoom();
  const b = S.map.getBounds().pad(0.35); // 少し外側まで（動かしたとき端が欠けないように）
  const thumbs = S.thumbMode;
  const memos = [...S.memos.values()].filter((m) => pinShown(m) && b.contains([m.lat, m.lon]));
  const px = (m) => S.map.project([m.lat, m.lon], z);
  const vis = new Set();
  const rest = [];
  // 1) 大きく表示する写真：大きいもの・番号の小さいものから順に置き、すでに置いた写真と大きく重なるものは置かない
  //    （置かなかったものは、ほかのピンと一緒にまとめる）
  const feats = [];
  for (const m of memos) {
    if (featIconSize(m)) feats.push(m); else rest.push(m); // 引いた縮尺ではお気に入りもふつうにまとめる
  }
  feats.sort((a, c) => Number(c.featured) - Number(a.featured) || (a.no || 0) - (c.no || 0));
  const placed = [], demoted = new Set();
  for (const m of feats) {
    const { w, h: hh } = featIconSize(m);
    const p = px(m), r = { x0: p.x - w / 2, x1: p.x + w / 2, y0: p.y - 10 - hh, y1: p.y - 10 };
    // 小さい方の面積の 15% を超えて重なるなら置かない
    const clash = placed.some((q) => {
      const ox = Math.min(r.x1, q.x1) - Math.max(r.x0, q.x0), oy = Math.min(r.y1, q.y1) - Math.max(r.y0, q.y0);
      return ox > 0 && oy > 0 && ox * oy > 0.15 * Math.min((r.x1 - r.x0) * (r.y1 - r.y0), (q.x1 - q.x0) * (q.y1 - q.y0));
    });
    if (clash) { rest.push(m); demoted.add(m.id); } // 大きいまま置くと重なるもの
    else { placed.push(r); vis.add(m.id); }
  }
  // 2) ほかのピン：画面のマス目ごとにまとめる（写真のサムネイルを出す縮尺ではマスを少し大きく）
  const cell = thumbs ? 58 : 40;
  const cells = new Map();
  for (const m of rest) {
    const p = px(m), key = `${Math.floor(p.x / cell)}:${Math.floor(p.y / cell)}`;
    if (!cells.has(key)) cells.set(key, []);
    cells.get(key).push(m);
  }
  for (const list of cells.values()) {
    // 1 件だけならそのピンを出す。ただし大きく出すと重なるお気に入りは、ふつうの大きさの写真で（押すと拡大）
    if (list.length === 1 && !demoted.has(list[0].id)) { vis.add(list[0].id); continue; }
    list.sort((a, c) => (a.no || 0) - (c.no || 0));
    const lat = list.reduce((s, m) => s + m.lat, 0) / list.length, lon = list.reduce((s, m) => s + m.lon, 0) / list.length;
    // 代表：写真を出す縮尺なら写真のあるもの（お気に入りを先に）
    const rep = thumbs || list.length === 1 ? list.find((m) => S.memoThumb.has(m.id) && m.featured) || list.find((m) => S.memoThumb.has(m.id)) : null;
    CL.clusters.push(clMarker(lat, lon, list, rep));
  }
  CL.visible = vis;
  clSync();
  for (const c of CL.clusters) c.addTo(S.map);
}
/** まとまりのマーカー */
function clMarker(lat, lon, list, rep) {
  const n = list.length;
  // 色：いちばん多い色
  const cnt = new Map();
  for (const m of list) { const c = memoColor(m); cnt.set(c, (cnt.get(c) || 0) + 1); }
  const color = [...cnt].sort((a, c) => c[1] - a[1])[0][0];
  let icon;
  if (rep) {
    const ph = S.memoThumb.get(rep.id);
    icon = L.divIcon({
      className: "photo-pin cl-photo", iconSize: [48, 48], iconAnchor: [24, 58],
      html: n > 1
        ? `<div class="pp cl-stack" style="border-color:${color}"><img src="${thumbUrl(ph)}" alt=""><b class="cl-n" style="background:${color}">${n}</b></div>`
        : `<div class="pp" style="border-color:${color}"><img src="${thumbUrl(ph)}" alt=""><b style="background:${color}">${rep.no ?? ""}</b></div>`,
    });
  } else {
    const d = n < 10 ? 30 : n < 100 ? 36 : 44;
    icon = L.divIcon({ className: "cl-pin", iconSize: [d, d], iconAnchor: [d / 2, d / 2], html: `<div style="background:${color};width:${d}px;height:${d}px"><span>${n}</span></div>` });
  }
  const mk = L.marker([lat, lon], { icon, zIndexOffset: 50, keyboard: false, title: n > 1 ? `${n} 件のメモ（押すと拡大）` : `#${list[0].no ?? ""} ${list[0].title || ""}（押すと拡大）` });
  mk.on("click", () => {
    const bounds = L.latLngBounds(list.map((m) => [m.lat, m.lon]));
    const z = S.map.getZoom();
    setFollow(false);
    if (bounds.getNorthEast().distanceTo(bounds.getSouthWest()) < 3) S.map.setView(bounds.getCenter(), CL_MAX_ZOOM);
    else S.map.fitBounds(bounds, { padding: [70, 70], maxZoom: Math.max(z + 2, Math.min(CL_MAX_ZOOM, z + 4)) });
  });
  return mk;
}
/** 指定のメモを一時的にまとめずに出す（一覧から地図へ・ポップアップを開くときなど） */
function clForce(ids, ms = 0) {
  for (const id of ids) CL.forced.add(id);
  clUpdate();
  if (ms) setTimeout(() => { for (const id of ids) CL.forced.delete(id); clSchedule(); }, ms);
}
function setupCluster() {
  S.map.on("zoomend moveend", clSchedule);
  // まとめて隠れているピンのポップアップを開こうとしたら、そのピンを出してから開く
  const op = L.Marker.prototype.openPopup;
  L.Marker.prototype.openPopup = function (...a) {
    if (this._fnMemoId && !this._map && S.map) { CL.forced.add(this._fnMemoId); this.addTo(S.map); }
    return op.apply(this, a);
  };
  S.map.on("popupclose", (e) => {
    const id = e.popup?._source?._fnMemoId;
    if (id && CL.forced.delete(id)) clSchedule();
  });
  clUpdate();
}
function clusterSeg() {
  return optSeg("重なるピン", [["auto", "自動"], ["on", "まとめる"], ["off", "まとめない"]], clMode, (k) => { Settings.data.clusterMode = k; Settings.save(); clUpdate(); });
}
