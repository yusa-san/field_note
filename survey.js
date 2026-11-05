/* フィールドノート — 複数人の調査・位置の補正
 * - 記録者（ユーザー）ごとの色分け：カテゴリ別とユーザー別を切り替え
 * - ほかの人が書き出したデータを「追加」として取り込む（自分のデータは上書きしない）
 * - ピンを動かすモード：ずれたピンをドラッグで直す（元の位置は記録に残す）
 * - GPS・方位の補正（任意）：ずれの修正・測位の平均化・精度の悪い測位を使わない・コンパスの補正
 * - 軌跡の表示を覚えておき、途中で電源が切れても次に開いたときに戻す
 */
"use strict";

/* ====================================================================
 * 記録者ごとの色
 * ==================================================================== */
const OWNER_PALETTE = ["#1565c0", "#d81b60", "#2e7d32", "#ef6c00", "#6a1b9a", "#00838f", "#6d4c41", "#c0ca33", "#455a64", "#e53935"];
const selfName = () => Settings.data.observer || "自分";
const ownerOf = (m) => m.owner || selfName();
const colorBy = () => (Settings.data.colorBy === "owner" ? "owner" : "category");
function ownerColor(name) {
  const map = (Settings.data.ownerColors ||= {});
  if (!map[name]) { map[name] = OWNER_PALETTE[Object.keys(map).length % OWNER_PALETTE.length]; Settings.save(); }
  return map[name];
}
const memoColor = (m) => (colorBy() === "owner" ? ownerColor(ownerOf(m)) : catColor(m.category));
const trackColor = (t) => (colorBy() === "owner" ? ownerColor(t.owner || selfName()) : "#7b1fa2");
function setColorBy(mode) {
  Settings.data.colorBy = mode;
  Settings.save();
  for (const m of S.memos.values()) renderMarker(m);
  DB.all("tracks").then((ts) => { for (const t of ts) { const l = S.shownTracks.get(t.id); if (l && l !== S.trackLine) l.setStyle({ color: trackColor(t) }); } });
  if (typeof dataLegendUpdate === "function") dataLegendUpdate();
}
/** 凡例（地図の右下）に出す記録者の一覧（ユーザー別のときだけ） */
function ownerLegendGroup() {
  if (colorBy() !== "owner") return null;
  const counts = new Map();
  for (const m of S.memos.values()) counts.set(ownerOf(m), (counts.get(ownerOf(m)) || 0) + 1);
  if (!counts.size) return null;
  return { key: "owners", title: "記録者", items: [...counts].map(([n, c]) => ({ color: ownerColor(n), text: `${n}（${c}）`, kind: "dot" })) };
}
/** 色分けの切り替えボタン（一覧・設定で使う） */
function colorBySeg(onChange) {
  const seg = h("div", { class: "seg seg-sm" }, ...[["category", "カテゴリで色分け"], ["owner", "記録者で色分け"]].map(([k, t]) => {
    const b = h("button", { type: "button", class: colorBy() === k ? "on" : "" }, t);
    b.onclick = () => { setColorBy(k); seg.querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b)); onChange && onChange(); };
    return b;
  }));
  return seg;
}

/* ====================================================================
 * 取り込み方を選ぶ：自分のデータとして統合／ほかの人のデータとして追加
 * ==================================================================== */
function chooseImportMode(data, fileName) {
  const memos = Array.isArray(data.memos) ? data.memos : [];
  const counts = new Map();
  for (const m of memos) if (m.observer) counts.set(m.observer, (counts.get(m.observer) || 0) + 1);
  const guess = data.project?.observer || [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] || "";
  const sameIds = memos.filter((m) => m.id && S.memos.has(m.id)).length;
  const looksOther = guess && guess !== Settings.data.observer;
  return new Promise((resolve) => {
    const name = h("input", { type: "text", value: guess || String(fileName || "").replace(/\.(zip|json|geojson)$/i, "").replace(/^fieldnote_/, "").slice(0, 30), placeholder: "例：佐藤" });
    const done = (v) => { resolve(v); closeSheet(true); };
    const add = h("button", { type: "button", class: "btn primary block" }, "ほかの人のデータとして追加する");
    add.onclick = () => { const n = name.value.trim(); if (!n) return name.focus(); done({ mode: "add", owner: n }); };
    const merge = h("button", { type: "button", class: "btn secondary block", style: "margin-top:8px" }, "自分のデータとして統合する（バックアップから戻す）");
    merge.onclick = () => done({ mode: "merge" });
    openSheet("取り込み方を選ぶ", h("div", {},
      h("p", { class: "note", style: "margin-top:0" }, `メモ ${memos.length} 件${data.tracks?.length ? `・軌跡 ${data.tracks.length} 本` : ""}${guess ? `（記録者：${guess}）` : ""}${sameIds ? `。うち ${sameIds} 件は今のデータと同じメモです` : ""}`),
      h("section", { class: "msec" + (looksOther || !sameIds ? " pick" : "") }, h("div", { class: "msec-h" }, h("h3", {}, "ほかの人のデータとして追加"), h("p", {}, "今のメモは変えずに、すべて新しいメモとして追加します。番号は続きから振り直し、記録者の名前を付けます（記録者ごとに色分けできます）。同じファイルをもう一度取り込んでも二重にはなりません。")),
        h("label", {}, "記録者の名前", name), add),
      h("section", { class: "msec" }, h("div", { class: "msec-h" }, h("h3", {}, "自分のデータとして統合"), h("p", {}, "自分の書き出し（別の端末・バックアップ）を戻すとき用。同じメモは更新日時が新しい方を残します。")), merge)), { onClose: () => resolve(null) });
  });
}

/* ====================================================================
 * ピンを動かすモード
 * ==================================================================== */
const PIN = { on: false, bar: null, undo: [] };
function startPinEdit(focusId) {
  if (PIN.on) return;
  S.map.closePopup();
  PIN.on = true;
  PIN.undo = [];
  clUpdate(); // まとめていたピンを全部出す
  document.body.classList.add("pin-edit");
  for (const [id, mk] of S.markers) enablePinDrag(id, mk);
  const undoBtn = h("button", { type: "button", class: "chip", disabled: true }, "元に戻す");
  undoBtn.onclick = async () => {
    const u = PIN.undo.pop();
    if (!u) return;
    for (const x of u.group || [u]) await movePin(x.id, x.lat, x.lon, true);
    if (u.group) toast(`${u.group.length} 件を元の位置に戻しました`);
    undoBtn.disabled = !PIN.undo.length;
  };
  PIN.undoBtn = undoBtn;
  PIN.bar = h("div", { class: "pin-bar glass" },
    h("div", { class: "pin-msg" }, h("b", {}, "ピンを動かす"), "ピンを長押しせずにそのままドラッグすると位置を直せます。GPS が同じようにずれていたメモは「まとめてずらす」で一度に直せます"),
    h("div", { class: "pin-act" }, h("button", { type: "button", class: "chip", onclick: () => startShift() }, "まとめてずらす"), undoBtn, h("button", { type: "button", class: "btn primary", onclick: stopPinEdit }, "完了")));
  document.body.append(PIN.bar);
  if (focusId) { const m = S.memos.get(focusId); if (m) S.map.setView([m.lat, m.lon], Math.max(S.map.getZoom(), 18)); }
}
function enablePinDrag(id, mk) {
  if (!PIN.on || !mk.dragging) return;
  mk.dragging.enable();
  // leaflet-rotate は「作ったときからドラッグ可」のマーカーにしか回転を考えた位置計算を入れない。
  // 後からドラッグ可にすると、地図を回した状態で数十〜数百 m ずれて置かれるので、ここで入れ直す
  if (S.map._rotate && !mk._fnRotDrag) { mk._initInteraction(); mk._fnRotDrag = true; }
  mk.off("dragend").on("dragend", async () => {
    const m = S.memos.get(id);
    if (!m) return;
    PIN.undo.push({ id, lat: m.lat, lon: m.lon });
    if (PIN.undoBtn) PIN.undoBtn.disabled = false;
    const ll = mk.getLatLng();
    await movePin(id, ll.lat, ll.lng);
  });
}
async function movePin(id, lat, lon, isUndo = false) {
  const m = S.memos.get(id);
  if (!m) return;
  // 最初の位置（GPS で取った位置など）は残しておく
  if (m.origLat == null) { m.origLat = m.lat; m.origLon = m.lon; m.origSource = m.source || null; }
  m.lat = +lat.toFixed(7);
  m.lon = +lon.toFixed(7);
  m.posEdited = Math.abs(m.lat - m.origLat) > 2e-7 || Math.abs(m.lon - m.origLon) > 2e-7;
  m.mesh = meshCode(m.lat, m.lon);
  m.updatedAt = nowIso();
  await DB.put("memos", m);
  renderMarker(m);
  updateCounts();
  fillPlaceInfo(m.id);
  if (!isUndo) toast(`#${m.no} の位置を直しました（${fmtDist(distance({ lat: m.origLat, lon: m.origLon }, m))} 移動）`);
}
function stopPinEdit() {
  if (!PIN.on) return;
  if (SH.on) stopShift();
  PIN.on = false;
  document.body.classList.remove("pin-edit");
  for (const mk of S.markers.values()) if (mk.dragging) { mk.dragging.disable(); mk.off("dragend"); }
  PIN.bar?.remove();
  PIN.bar = null;
  clUpdate();
}

/* ====================================================================
 * まとめてずらす：今の GPS の位置 → 中央の十字（本当の位置）の差を、選んだメモ全部に当てる
 * ==================================================================== */
const SH = { on: false, sel: new Set(), from: null, layer: null, bar: null, cross: null, raf: 0 };
const M_LAT = 111320, mLon = (lat) => 111320 * Math.cos((lat * Math.PI) / 180);
/** 中央の十字と GPS の点の差（北・東へ何 m） */
function shiftDelta() {
  const c = S.map.getCenter();
  return { n: (c.lat - SH.from.lat) * M_LAT, e: (c.lng - SH.from.lon) * mLon(SH.from.lat) };
}
const shifted = (m, d) => ({ lat: m.lat + d.n / M_LAT, lon: m.lon + d.e / mLon(m.lat) });
function startShift() {
  if (!S.pos) {
    toast("先に現在地を取得してください（現在地ボタン）。今いる場所の GPS のずれを、選んだメモにも当てます", 4000);
    return;
  }
  if (!PIN.on) startPinEdit();
  if (SH.on) return;
  S.map.closePopup();
  setFollow(false);
  SH.on = true;
  SH.sel = new Set();
  SH.from = { lat: S.pos.lat, lon: S.pos.lon, acc: S.pos.acc };
  document.body.classList.add("pin-shift");
  PIN.bar.style.display = "none";
  SH.layer = L.layerGroup().addTo(S.map);
  for (const [id, mk] of S.markers) shiftHookMarker(id, mk);
  SH.cross = h("div", { class: "calib-cross" });
  const info = h("div", { class: "shift-info" });
  const apply = h("button", { type: "button", class: "btn primary", disabled: true }, "ずらす");
  const toCal = h("input", { type: "checkbox" });
  const pick = (fn) => { for (const m of S.memos.values()) if (fn(m)) SH.sel.add(m.id); shiftRefresh(); };
  const today = new Date().toDateString();
  SH.bar = h("div", { class: "pin-bar glass" },
    h("div", { class: "pin-msg" }, h("b", {}, "まとめてずらす"),
      "十字を今いる本当の場所に合わせ、ずれていたピンを押して選ぶ"),
    info,
    h("div", { class: "seg seg-sm shift-pick" },
      h("button", { type: "button", onclick: () => pick((m) => new Date(m.createdAt).toDateString() === today) }, "今日のメモ"),
      h("button", { type: "button", onclick: () => { const b = S.map.getBounds(); pick((m) => b.contains([m.lat, m.lon])); } }, "画面内すべて"),
      h("button", { type: "button", onclick: () => { SH.sel.clear(); shiftRefresh(); } }, "選択を解除")),
    h("label", { class: "inline shift-cal" }, toCal, "この差を以後の GPS の補正にも使う"),
    h("div", { class: "pin-act" },
      h("button", { type: "button", class: "chip", onclick: stopShift }, "やめる"), apply));
  apply.onclick = async () => {
    const d = shiftDelta(), ids = [...SH.sel].filter((id) => S.memos.has(id));
    if (!ids.length) return;
    const group = ids.map((id) => { const m = S.memos.get(id); return { id, lat: m.lat, lon: m.lon }; });
    for (const id of ids) { const m = S.memos.get(id), q = shifted(m, d); await movePin(id, q.lat, q.lon, true); }
    PIN.undo.push({ group });
    if (PIN.undoBtn) PIN.undoBtn.disabled = false;
    if (toCal.checked) {
      // 今の現在地はすでに補正済みのことがあるので、これまでの補正に足す
      const o = gpsCfg().offset || { n: 0, e: 0 };
      gpsSave({ offset: { n: Math.round((o.n + d.n) * 10) / 10, e: Math.round((o.e + d.e) * 10) / 10, at: nowIso() } });
    }
    stopShift();
    toast(`${ids.length} 件を${fmtShift(d)}動かしました${toCal.checked ? "。GPS の補正にも設定しました" : ""}（「元に戻す」で戻せます）`, 4500);
  };
  SH.info = info; SH.apply = apply;
  document.body.append(SH.cross, SH.bar);
  S.map.setView([SH.from.lat, SH.from.lon], Math.max(S.map.getZoom(), 18), { animate: false });
  S.map.on("move", shiftSchedule);
  shiftRefresh();
}
function fmtShift(d) {
  const ns = d.n >= 0 ? `北へ ${d.n.toFixed(1)} m` : `南へ ${(-d.n).toFixed(1)} m`;
  const es = d.e >= 0 ? `東へ ${d.e.toFixed(1)} m` : `西へ ${(-d.e).toFixed(1)} m`;
  return `${ns}・${es}（計 ${fmtDist(Math.hypot(d.n, d.e))}）`;
}
/** シフト中はピンを押すと選択（ポップアップは開かない） */
function shiftHookMarker(id, mk) {
  if (!SH.on) return;
  if (mk.dragging) mk.dragging.disable();
  mk.off("click", mk._openPopup, mk);
  mk.off("click.shift");
  const onTap = (e) => { L.DomEvent.stop(e); SH.sel.has(id) ? SH.sel.delete(id) : SH.sel.add(id); shiftRefresh(); };
  mk._fnShiftTap = onTap;
  mk.on("click", onTap);
  mk._icon?.classList.toggle("shift-sel", SH.sel.has(id));
}
function shiftSchedule() { if (!SH.raf) SH.raf = requestAnimationFrame(() => { SH.raf = 0; shiftRefresh(); }); }
function shiftRefresh() {
  if (!SH.on) return;
  const d = shiftDelta(), c = S.map.getCenter();
  SH.layer.clearLayers();
  // GPS の点（ずれの起点）と十字までの線
  L.circleMarker([SH.from.lat, SH.from.lon], { radius: 7, color: "#fff", weight: 2, fillColor: "#1a73e8", fillOpacity: 1, interactive: false }).addTo(SH.layer);
  L.polyline([[SH.from.lat, SH.from.lon], c], { color: "#1a73e8", weight: 3, dashArray: "6 6", interactive: false }).addTo(SH.layer);
  // 選んだメモの移動先の下見
  for (const id of SH.sel) {
    const m = S.memos.get(id);
    if (!m) continue;
    const q = shifted(m, d);
    L.polyline([[m.lat, m.lon], [q.lat, q.lon]], { color: "#ff6d00", weight: 2, dashArray: "4 5", interactive: false }).addTo(SH.layer);
    L.circleMarker([q.lat, q.lon], { radius: 6, color: "#ff6d00", weight: 2, fillColor: "#fff", fillOpacity: 0.9, interactive: false }).addTo(SH.layer);
  }
  for (const [id, mk] of S.markers) mk._icon?.classList.toggle("shift-sel", SH.sel.has(id));
  SH.info.textContent = `GPS の点（青）→ 十字：${fmtShift(d)}`;
  SH.apply.disabled = !SH.sel.size;
  SH.apply.textContent = SH.sel.size ? `${SH.sel.size} 件をずらす` : "ずらす";
}
function stopShift() {
  if (!SH.on) return;
  SH.on = false;
  S.map.off("move", shiftSchedule);
  document.body.classList.remove("pin-shift");
  SH.layer?.remove(); SH.cross?.remove(); SH.bar?.remove();
  for (const [id, mk] of S.markers) {
    if (mk._fnShiftTap) { mk.off("click", mk._fnShiftTap); mk._fnShiftTap = null; }
    mk.off("click", mk._openPopup, mk).on("click", mk._openPopup, mk);
    mk._icon?.classList.remove("shift-sel");
    if (PIN.on && mk.dragging) mk.dragging.enable();
  }
  if (PIN.bar) PIN.bar.style.display = "";
}

/* ====================================================================
 * GPS・方位の補正（すべて任意。通知は出さない）
 * ==================================================================== */
const GPS_DEFAULT = { offset: null, avgSec: 0, maxAcc: 0, compass: 0 };
const gpsCfg = () => ({ ...GPS_DEFAULT, ...(Settings.data.gps || {}) });
function gpsSave(patch) { Settings.data.gps = { ...gpsCfg(), ...patch }; Settings.save(); }
const FIX = { buf: [] }; // 直近の測位（平均化用、補正後の値）
/** 測位値に補正を当てる。使わない測位（精度が悪い）は null */
function gpsCorrect(raw) {
  const c = gpsCfg();
  if (c.maxAcc && raw.acc > c.maxAcc && S.pos) return null; // 最初の 1 回は精度が悪くても使う
  let { lat, lon } = raw;
  if (c.offset) {
    const mPerDegLat = 111320, mPerDegLon = 111320 * Math.cos((lat * Math.PI) / 180);
    lat += c.offset.n / mPerDegLat;
    lon += c.offset.e / mPerDegLon;
  }
  const p = { ...raw, lat, lon, corrected: !!c.offset };
  FIX.buf.push(p);
  const cut = Date.now() - 60000;
  while (FIX.buf.length && FIX.buf[0].t < cut) FIX.buf.shift();
  return p;
}
const compassOffset = () => gpsCfg().compass || 0;
/** 直近 sec 秒の測位の重み付き平均（精度の 2 乗の逆数で重み付け） */
function averagedFix(sec) {
  const since = Date.now() - sec * 1000, list = FIX.buf.filter((p) => p.t >= since);
  if (!list.length) return null;
  let w = 0, lat = 0, lon = 0, alt = 0, wa = 0;
  for (const p of list) { const k = 1 / Math.max(1, p.acc) ** 2; w += k; lat += p.lat * k; lon += p.lon * k; if (p.alt != null) { alt += p.alt * k; wa += k; } }
  const acc = Math.min(...list.map((p) => p.acc)) / Math.sqrt(list.length);
  return { lat: lat / w, lon: lon / w, alt: wa ? alt / wa : null, acc, n: list.length, t: Date.now() };
}
/** 平均化してから現在地を返す（設定が 0 秒なら今の値） */
async function waitAveragedPosition() {
  const sec = gpsCfg().avgSec;
  if (!sec || !S.pos) return S.pos;
  const start = Date.now();
  await new Promise((res) => {
    const tick = () => {
      const left = Math.ceil(sec - (Date.now() - start) / 1000);
      if (left <= 0) return res();
      toast(`現在地を平均しています… あと ${left} 秒（${FIX.buf.filter((p) => p.t >= start).length} 回測位）`, 1500);
      setTimeout(tick, 500);
    };
    tick();
  });
  const avg = averagedFix(sec);
  if (!avg) return S.pos;
  return { ...S.pos, lat: avg.lat, lon: avg.lon, acc: Math.round(avg.acc * 10) / 10, averaged: avg.n };
}
/** ずれの修正：今の GPS の点と、地図で指定した正しい位置の差を覚える */
function startOffsetCalib() {
  if (!S.pos) return toast("先に現在地を取得してください（現在地ボタン）");
  closeSheet(true);
  setFollow(false);
  const raw = S.posRaw || S.pos;
  S.map.setView([S.pos.lat, S.pos.lon], Math.max(S.map.getZoom(), 19));
  const cross = h("div", { class: "calib-cross" });
  const bar = h("div", { class: "pin-bar glass" },
    h("div", { class: "pin-msg" }, h("b", {}, "位置のずれを直す"), "地図を動かして、中央の十字を本当に立っている場所に合わせてください（建物の角・道路の交差点などが目印になります）"),
    h("div", { class: "pin-act" },
      h("button", { type: "button", class: "chip", onclick: () => { cross.remove(); bar.remove(); } }, "やめる"),
      h("button", { type: "button", class: "btn primary", onclick: () => {
        const c = S.map.getCenter(), lat0 = raw.lat;
        const n = (c.lat - raw.lat) * 111320, e = (c.lng - raw.lon) * 111320 * Math.cos((lat0 * Math.PI) / 180);
        gpsSave({ offset: { n: Math.round(n * 10) / 10, e: Math.round(e * 10) / 10, at: nowIso() } });
        cross.remove(); bar.remove();
        toast(`補正を設定しました（北へ ${n.toFixed(1)} m・東へ ${e.toFixed(1)} m）。次の測位から反映します`, 4000);
      } }, "この位置に合わせる")));
  document.body.append(cross, bar);
}
function openGpsCalib() {
  const c = gpsCfg();
  const sel = (opts, cur, key) => {
    const s = h("select", {}, ...opts.map(([v, t]) => h("option", { value: v, selected: String(v) === String(cur) }, t)));
    s.onchange = () => gpsSave({ [key]: Number(s.value) });
    return s;
  };
  const offTxt = c.offset ? `補正中：北へ ${c.offset.n} m・東へ ${c.offset.e} m（${fmtDate(c.offset.at)} に設定）` : "補正なし";
  const comp = h("input", { type: "range", min: "-45", max: "45", step: "1", value: c.compass });
  const compVal = h("span", {}, `${c.compass > 0 ? "+" : ""}${c.compass}°`);
  comp.oninput = () => { gpsSave({ compass: Number(comp.value) }); compVal.textContent = `${comp.value > 0 ? "+" : ""}${comp.value}°`; if (S.heading != null) scheduleHeadingDraw(); };
  openSheet("GPS・方位の補正", h("div", {},
    h("p", { class: "note", style: "margin-top:0" }, "必要なものだけ選んでください。どれも使わなくて構いません（補正を促す通知は出しません）。"),
    h("section", { class: "msec" }, h("div", { class: "msec-h" }, h("h3", {}, "位置のずれを直す"), h("p", {}, "GPS がいつも同じ向きにずれる場所で。地図で本当の位置を指定すると、その差を以後の測位に当てます。")),
      h("div", { class: "msec-meta", style: "margin-top:0" }, offTxt),
      h("div", { class: "menu-grid", style: "margin-top:8px" },
        h("button", { type: "button", class: "btn secondary", onclick: startOffsetCalib }, "地図で正しい位置を指定"),
        h("button", { type: "button", class: "btn secondary", disabled: !c.offset, onclick: () => { gpsSave({ offset: null }); toast("位置の補正を解除しました"); openGpsCalib(); } }, "補正を解除"))),
    h("section", { class: "msec" }, h("div", { class: "msec-h" }, h("h3", {}, "測位を平均してメモを作る"), h("p", {}, "「現在地にメモ」のとき、数秒間の測位を平均して位置を決めます（立ち止まって使うと精度が上がります）。")),
      sel([[0, "平均しない（すぐ作る）"], [5, "5 秒"], [10, "10 秒"], [20, "20 秒"], [30, "30 秒"]], c.avgSec, "avgSec")),
    h("section", { class: "msec" }, h("div", { class: "msec-h" }, h("h3", {}, "精度の悪い測位を使わない"), h("p", {}, "ビルの谷間などで大きく飛ぶ測位を、現在地と軌跡に使いません。")),
      sel([[0, "すべて使う"], [100, "±100 m より悪いものは使わない"], [50, "±50 m より悪いものは使わない"], [30, "±30 m より悪いものは使わない"], [15, "±15 m より悪いものは使わない"]], c.maxAcc, "maxAcc")),
    h("section", { class: "msec" }, h("div", { class: "msec-h" }, h("h3", {}, "方位（コンパス）の補正"), h("p", {}, "向きの扇形が実際の向きとずれるときに。端末を 8 の字に数回振ると、端末側のコンパスが整うこともあります。")),
      h("label", { class: "inline" }, comp, compVal)),
    h("p", { class: "note" }, "補正した位置でメモを作ると、メモに「補正あり」と記録します。")), { height: "80vh" });
}

/* ====================================================================
 * 軌跡の表示を覚える・記録中に終わった軌跡を戻す
 * ==================================================================== */
function rememberShownTracks() {
  Settings.data.shownTracks = [...S.shownTracks.keys()].filter((id) => !S.track || id !== S.track.id);
  Settings.save();
}
async function restoreTracksOnStart() {
  const tracks = await DB.all("tracks");
  // 記録中のまま止まった軌跡（電池切れ・アプリが閉じられたなど）
  const open = tracks.filter((t) => !t.endedAt).sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1));
  const recent = open[0];
  const last = recent && recent.points.length ? recent.points[recent.points.length - 1][2] : 0;
  for (const t of open) if (t !== recent || Date.now() - last > 12 * 3600e3) {
    t.endedAt = t.points.length ? new Date(t.points[t.points.length - 1][2]).toISOString() : t.startedAt;
    await DB.put("tracks", t);
  }
  const ids = new Set(Settings.data.shownTracks || []);
  if (recent && !recent.endedAt) ids.add(recent.id);
  for (const t of tracks) if (ids.has(t.id) && !S.shownTracks.has(t.id) && t.points.length) {
    const line = L.polyline(trackLatLngs(t), { color: trackColor(t), weight: 4, opacity: 0.8 }).addTo(S.map);
    S.shownTracks.set(t.id, line);
  }
  if (recent && !recent.endedAt) {
    // 地図に出したうえで、続けて記録するか聞く（続けない場合は終了扱い）
    setTimeout(async () => {
      if (confirm(`記録中だった軌跡「${recent.name}」（${recent.points.length} 点・${fmtDist(recent.distance || 0)}）が途中で止まっていました。続けて記録しますか？\n（「キャンセル」で記録を終了して保存）`)) {
        const line = S.shownTracks.get(recent.id);
        if (line) { S.map.removeLayer(line); S.shownTracks.delete(recent.id); }
        recent.segStarts = [...(recent.segStarts && recent.segStarts.length ? recent.segStarts : [0]), recent.points.length];
        S.track = recent;
        S.trackLine = L.polyline(trackLatLngs(recent), { color: "#d0021b", weight: 4, opacity: 0.85 }).addTo(S.map);
        $("#btn-track").classList.add("recording");
        await requestWakeLock();
        await DB.put("tracks", recent);
        toast("軌跡の記録を再開しました（止まっていた間は線をつなぎません）");
        if (S.pos) addTrackPoint(S.pos);
      } else {
        recent.endedAt = last ? new Date(last).toISOString() : recent.startedAt;
        await DB.put("tracks", recent);
        rememberShownTracks();
      }
    }, 1200);
  }
  rememberShownTracks();
}
