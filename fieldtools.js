/* フィールドノート — 現地で使う道具
 * - 日の出・日の入り（端末で計算。ステータス欄にさりげなく常時表示）
 * - 位置情報（EXIF）付きの写真をまとめて読み込んでメモにする
 * - 標高断面図（計測した線・軌跡に沿って、標高タイルから）
 * - 2 つの地図を左右に並べて比べる（スワイプ）
 */
"use strict";

/* ====================================================================
 * 日の出・日の入り（NOAA の簡易式。誤差は 1〜2 分程度）
 * ==================================================================== */
function sunTimes(date, lat, lon) {
  const rad = Math.PI / 180;
  const d0 = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate(), 12));
  const n = Math.round((d0 - Date.UTC(2000, 0, 1, 12)) / 864e5) - lon / 360; // 2000-01-01 12:00 UTC からの日数（経度で補正）
  const M = (357.5291 + 0.98560028 * n) % 360;
  const C = 1.9148 * Math.sin(M * rad) + 0.02 * Math.sin(2 * M * rad) + 0.0003 * Math.sin(3 * M * rad);
  const lam = (M + C + 180 + 102.9372) % 360;
  const Jtransit = 2451545 + n + 0.0053 * Math.sin(M * rad) - 0.0069 * Math.sin(2 * lam * rad);
  const dec = Math.asin(Math.sin(lam * rad) * Math.sin(23.4397 * rad));
  const cosH = (Math.sin(-0.833 * rad) - Math.sin(lat * rad) * Math.sin(dec)) / (Math.cos(lat * rad) * Math.cos(dec));
  if (cosH > 1 || cosH < -1) return null; // 白夜・極夜
  const H = Math.acos(cosH) / rad;
  const toDate = (J) => new Date((J - 2440587.5) * 864e5);
  return { rise: toDate(Jtransit - H / 360), set: toDate(Jtransit + H / 360), noon: toDate(Jtransit) };
}
const hm = (d) => `${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`;
const dur = (ms) => { const m = Math.round(ms / 60000); return m >= 60 ? `${Math.floor(m / 60)}時間${m % 60 ? `${m % 60}分` : ""}` : `${m}分`; };
function updateSun() {
  const el = $("#st-sun");
  if (!el) return;
  const usePos = !!(S.pos && !S.crosshair);
  const c = usePos ? { lat: S.pos.lat, lon: S.pos.lon } : (() => { const x = S.map.getCenter(); return { lat: x.lat, lon: x.lng }; })();
  const now = new Date(), t = sunTimes(now, c.lat, c.lon);
  if (!t) { el.textContent = ""; return; }
  let extra = "";
  if (now < t.rise) extra = `（日の出まで${dur(t.rise - now)}）`;
  else if (now < t.set && t.set - now <= 3 * 3600e3) extra = `（日没まで${dur(t.set - now)}）`;
  el.textContent = `日の出 ${hm(t.rise)}・日の入 ${hm(t.set)}${extra}`;
  el.title = `南中 ${hm(t.noon)}（${usePos ? "現在地" : "地図の中心"}で計算）`;
}
function startSun() {
  updateSun();
  setInterval(updateSun, 60000);
  let t = 0;
  S.map.on("moveend", () => { clearTimeout(t); t = setTimeout(updateSun, 400); });
}

/* ====================================================================
 * EXIF（JPEG）：撮影位置・時刻・方向
 * ==================================================================== */
async function readExif(file) {
  const head = new DataView(await file.slice(0, Math.min(file.size, 256 * 1024)).arrayBuffer());
  if (head.byteLength < 4 || head.getUint16(0) !== 0xffd8) return null;
  let off = 2;
  while (off + 4 < head.byteLength) {
    const marker = head.getUint16(off), len = head.getUint16(off + 2);
    if (marker === 0xffe1 && head.getUint32(off + 4) === 0x45786966) return parseTiff(new DataView(head.buffer, off + 10, Math.min(len - 8, head.byteLength - off - 10)));
    if ((marker & 0xff00) !== 0xff00 || marker === 0xffda) break;
    off += 2 + len;
  }
  return null;
}
function parseTiff(dv) {
  const le = dv.getUint16(0) === 0x4949;
  const u16 = (o) => dv.getUint16(o, le), u32 = (o) => dv.getUint32(o, le);
  const ifd = (o) => {
    const out = {}, n = u16(o);
    for (let i = 0; i < n; i++) {
      const e = o + 2 + i * 12, tag = u16(e), type = u16(e + 2), cnt = u32(e + 4);
      const size = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8 }[type] || 1;
      const vo = size * cnt > 4 ? u32(e + 8) : e + 8;
      if (vo + size * cnt > dv.byteLength) continue;
      if (type === 2) out[tag] = String.fromCharCode(...new Uint8Array(dv.buffer, dv.byteOffset + vo, Math.max(0, cnt - 1)));
      else if (type === 5 || type === 10) out[tag] = Array.from({ length: cnt }, (_, k) => { const a = u32(vo + 8 * k), b = u32(vo + 8 * k + 4); return b ? (type === 10 ? (a | 0) / (b | 0) : a / b) : 0; });
      else if (type === 3) out[tag] = Array.from({ length: cnt }, (_, k) => u16(vo + 2 * k));
      else if (type === 4) out[tag] = Array.from({ length: cnt }, (_, k) => u32(vo + 4 * k));
      else if (type === 1 || type === 7) out[tag] = Array.from(new Uint8Array(dv.buffer, dv.byteOffset + vo, cnt));
    }
    return out;
  };
  try {
    const i0 = ifd(u32(4));
    const ex = i0[0x8769] ? ifd(i0[0x8769][0]) : {};
    const gps = i0[0x8825] ? ifd(i0[0x8825][0]) : {};
    const dms = (v) => (v && v.length >= 3 ? v[0] + v[1] / 60 + v[2] / 3600 : null);
    let lat = dms(gps[2]), lon = dms(gps[4]);
    if (lat != null && gps[1] === "S") lat = -lat;
    if (lon != null && gps[3] === "W") lon = -lon;
    const dt = ex[0x9003] || i0[0x0132];
    let taken = null;
    if (dt) { const m = dt.match(/(\d{4}):(\d\d):(\d\d) (\d\d):(\d\d):(\d\d)/); if (m) taken = new Date(+m[1], m[2] - 1, +m[3], +m[4], +m[5], +m[6]); }
    const ok = lat != null && lon != null && !(lat === 0 && lon === 0) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;
    return {
      lat: ok ? lat : null, lon: ok ? lon : null, taken,
      heading: gps[0x11] ? Math.round(gps[0x11][0]) % 360 : null,
      alt: gps[6] ? (gps[5]?.[0] === 1 ? -1 : 1) * gps[6][0] : null,
      camera: [i0[0x010f], i0[0x0110]].filter(Boolean).join(" ").trim() || null,
    };
  } catch { return null; }
}

/** 写真をまとめて読み込む：位置ごとにメモを作る（近い写真はまとめられる） */
function exifImportBox() {
  const input = h("input", { type: "file", accept: "image/jpeg,image/*", multiple: true, hidden: true });
  const group = h("input", { type: "checkbox", checked: true });
  const noGps = h("select", {}, h("option", { value: "skip" }, "読み込まない"), h("option", { value: "center" }, "地図の中心にまとめて置く"));
  const cat = h("select", {}, ...Settings.data.categories.map((c) => h("option", { value: c, selected: c === PHOTO_CATEGORY }, c)));
  const status = h("div", { class: "note" });
  input.onchange = async () => {
    const files = [...input.files];
    input.value = "";
    if (!files.length) return;
    status.textContent = "位置情報を読み取り中…";
    const items = [];
    for (const f of files) items.push({ f, ex: await readExif(f).catch(() => null) });
    const withGps = items.filter((x) => x.ex?.lat != null), without = items.filter((x) => x.ex?.lat == null);
    if (!withGps.length && noGps.value === "skip") {
      status.textContent = `位置情報のある写真がありません（${files.length} 枚）。iPhone では写真を選ぶ画面の「オプション」で「位置情報」をオンにすると位置が残ります。`;
      return;
    }
    if (!confirm(`位置情報あり ${withGps.length} 枚・なし ${without.length} 枚。${without.length ? (noGps.value === "skip" ? "位置のない写真は読み込みません。" : "位置のない写真は地図の中心に置きます。") : ""}メモを作りますか？`)) { status.textContent = ""; return; }
    // 撮影時刻の順に並べ、20m 以内・5 分以内に続けて撮ったものは 1 つのメモにまとめる
    withGps.sort((a, b) => (a.ex.taken || 0) - (b.ex.taken || 0));
    const groups = [];
    for (const it of withGps) {
      const g = groups[groups.length - 1];
      const near = g && group.checked && distance(g.items[0].ex, it.ex) <= 20 && Math.abs((it.ex.taken || 0) - (g.items[g.items.length - 1].ex.taken || 0)) <= 5 * 60000;
      if (near) g.items.push(it); else groups.push({ items: [it], loc: { lat: it.ex.lat, lon: it.ex.lon } });
    }
    if (without.length && noGps.value === "center") { const c = S.map.getCenter(); groups.push({ items: without, loc: { lat: c.lat, lon: c.lng }, noGps: true }); }
    let done = 0, made = 0;
    const bounds = [];
    for (const g of groups) {
      const memo = newMemo({ ...g.loc, source: g.noGps ? "map" : "exif" });
      const first = g.items[0].ex || {};
      memo.kind = "photo";
      memo.category = cat.value;
      memo.heading = first.heading ?? null;
      memo.gpsAltitude = first.alt != null ? Math.round(first.alt * 10) / 10 : null;
      if (first.taken) memo.createdAt = memo.updatedAt = first.taken.toISOString();
      memo.title = g.noGps ? "位置情報のない写真" : "";
      memo.note = first.camera ? `撮影：${first.camera}` : "";
      const photos = [];
      try {
        for (const [i, it] of g.items.entries()) {
          const ph = { id: uuid(), memoId: memo.id, order: i, ...(await processPhoto(it.f)) };
          if (it.ex?.taken) ph.takenAt = it.ex.taken.toISOString();
          photos.push(ph);
          status.textContent = `保存中… ${++done}/${withGps.length + (noGps.value === "center" ? without.length : 0)} 枚`;
        }
        memo.photoCount = photos.length;
        for (const ph of photos) await DB.put("photos", ph);
        await DB.put("memos", memo);
      } catch (e) { alert("写真を保存できませんでした：" + e.message); break; }
      S.memos.set(memo.id, memo);
      S.memoThumb.set(memo.id, photos[0]);
      renderMarker(memo);
      if (!g.noGps) fillPlaceInfo(memo.id);
      bounds.push([memo.lat, memo.lon]);
      made++;
    }
    updateCounts();
    status.textContent = `${made} 件の写真メモを作りました（写真 ${done} 枚）`;
    if (bounds.length) { closeSheet(true); setFollow(false); S.map.fitBounds(L.latLngBounds(bounds).pad(0.15), { maxZoom: 17 }); toast(`${made} 件の写真メモを作りました`); }
  };
  return h("div", {},
    h("button", { type: "button", class: "btn secondary block", onclick: () => input.click() }, "写真を選ぶ（複数可）"), input,
    h("label", { class: "inline", style: "margin-top:8px" }, group, "近い場所で続けて撮った写真は 1 つのメモにまとめる（20 m・5 分以内）"),
    h("div", { class: "pr-grid" }, h("label", {}, "カテゴリ", cat), h("label", {}, "位置情報のない写真", noGps)),
    status);
}

/* ====================================================================
 * 標高断面図
 * ==================================================================== */
async function elevationProfile(latlngs, title) {
  const pts = latlngs.map((p) => ({ lat: p.lat ?? p[0], lon: p.lon ?? p.lng ?? p[1] }));
  if (pts.length < 2) return toast("2 点以上の線が必要です");
  const segs = [];
  let total = 0;
  for (let i = 1; i < pts.length; i++) { const d = distance(pts[i - 1], pts[i]); segs.push(d); total += d; }
  if (total < 1) return toast("線が短すぎます");
  const N = Math.max(40, Math.min(300, Math.round(total / 2)));
  const coarse = total > 4000; // 長い線は 5m・10m 標高で（1m のタイルを大量に読まない）
  const samples = [];
  for (let k = 0; k <= N; k++) {
    let target = (total * k) / N, i = 0;
    while (i < segs.length - 1 && target > segs[i]) { target -= segs[i]; i++; }
    const t = segs[i] ? Math.min(1, target / segs[i]) : 0;
    samples.push({ d: (total * k) / N, lat: pts[i].lat + (pts[i + 1].lat - pts[i].lat) * t, lon: pts[i].lon + (pts[i + 1].lon - pts[i].lon) * t });
  }
  const body = h("div", { class: "prof" }, h("div", { class: "note" }, "標高を読み込み中…"));
  const marker = L.circleMarker([0, 0], { radius: 6, color: "#fff", weight: 2, fillColor: "#d0021b", fillOpacity: 1, interactive: false });
  openSheet(`標高断面図${title ? `：${title}` : ""}`, body, { backdrop: false, height: "46vh", onClose: () => S.map.removeLayer(marker) });
  const srcs = new Set();
  for (let i = 0; i < samples.length; i += 8) {
    await Promise.all(samples.slice(i, i + 8).map(async (s) => { const e = await demElevationAt(s.lat, s.lon, coarse).catch(() => null); s.z = e ? e.value : null; if (e) srcs.add(e.src.replace(/・標高タイル/, "")); }));
    if (body.isConnected) body.firstChild.textContent = `標高を読み込み中… ${Math.min(samples.length, i + 8)}/${samples.length}`;
  }
  const valid = samples.filter((s) => s.z != null);
  if (valid.length < 2) { body.replaceChildren(h("div", { class: "note" }, "この線の標高を読めませんでした（オフライン、または標高データのない場所）")); return; }
  const zmin = Math.min(...valid.map((s) => s.z)), zmax = Math.max(...valid.map((s) => s.z));
  // 登り下り・傾斜は、細かい凹凸（建物の縁・測定の揺れ）を均してから求める
  const sm = valid.map((s0, i) => { const w = valid.slice(Math.max(0, i - 2), i + 3); return { d: s0.d, z: w.reduce((a, b) => a + b.z, 0) / w.length }; });
  let up = 0, down = 0, maxSlope = 0;
  for (let i = 1; i < sm.length; i++) { const dz = sm[i].z - sm[i - 1].z; if (dz > 0) up += dz; else down -= dz; }
  const win = Math.max(10, total / 100); // 傾斜は 10 m 以上の区間で
  for (let i = 0, j = 0; i < sm.length; i++) {
    while (j < sm.length && sm[j].d - sm[i].d < win) j++;
    if (j < sm.length) maxSlope = Math.max(maxSlope, Math.abs(sm[j].z - sm[i].z) / (sm[j].d - sm[i].d));
  }
  const W = 640, H = 220, P = { l: 44, r: 10, t: 12, b: 26 };
  const pad = Math.max(1, (zmax - zmin) * 0.08);
  const y0 = zmin - pad, y1 = zmax + pad;
  const X = (d) => P.l + ((W - P.l - P.r) * d) / total, Y = (z) => P.t + ((H - P.t - P.b) * (y1 - z)) / (y1 - y0);
  let path = "", area = "";
  let pen = false;
  for (const s of samples) {
    if (s.z == null) { pen = false; continue; }
    path += `${pen ? "L" : "M"}${X(s.d).toFixed(1)},${Y(s.z).toFixed(1)}`;
    pen = true;
  }
  area = `M${X(valid[0].d)},${H - P.b}` + valid.map((s) => `L${X(s.d).toFixed(1)},${Y(s.z).toFixed(1)}`).join("") + `L${X(valid.at(-1).d)},${H - P.b}Z`;
  const ticks = (a, b, n) => { const st = 10 ** Math.floor(Math.log10((b - a) / n)); const step = [1, 2, 5, 10].map((m) => m * st).find((s) => (b - a) / s <= n) || st * 10; const out = []; for (let v = Math.ceil(a / step) * step; v <= b; v += step) out.push(+v.toFixed(6)); return out; };
  const svgNS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(svgNS, "svg");
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.setAttribute("class", "prof-svg");
  const fmtZ = (z) => (Math.abs(y1 - y0) < 20 ? z.toFixed(1) : Math.round(z));
  let inner = `<path d="${area}" class="prof-area"/><path d="${path}" class="prof-line"/>`;
  for (const v of ticks(y0, y1, 4)) inner += `<line x1="${P.l}" x2="${W - P.r}" y1="${Y(v)}" y2="${Y(v)}" class="prof-grid"/><text x="${P.l - 4}" y="${Y(v) + 4}" class="prof-ax" text-anchor="end">${fmtZ(v)}</text>`;
  for (const v of ticks(0, total, 5)) inner += `<text x="${X(v)}" y="${H - 8}" class="prof-ax" text-anchor="middle">${v >= 1000 ? +(v / 1000).toFixed(2) + "km" : Math.round(v) + "m"}</text>`;
  inner += `<line class="prof-cur" x1="0" x2="0" y1="${P.t}" y2="${H - P.b}" visibility="hidden"/><circle class="prof-dot" r="4" visibility="hidden"/>`;
  svg.innerHTML = inner;
  const readout = h("div", { class: "prof-read" }, "グラフをなぞると、地図上の位置と標高が分かります");
  const show = (clientX) => {
    const r = svg.getBoundingClientRect();
    const d = Math.max(0, Math.min(total, (((clientX - r.left) / r.width) * W - P.l) / (W - P.l - P.r) * total));
    let best = valid[0];
    for (const s of valid) if (Math.abs(s.d - d) < Math.abs(best.d - d)) best = s;
    const cur = svg.querySelector(".prof-cur"), dot = svg.querySelector(".prof-dot");
    cur.setAttribute("x1", X(best.d)); cur.setAttribute("x2", X(best.d)); cur.setAttribute("visibility", "visible");
    dot.setAttribute("cx", X(best.d)); dot.setAttribute("cy", Y(best.z)); dot.setAttribute("visibility", "visible");
    readout.textContent = `始点から ${fmtDist(best.d)}・標高 ${best.z.toFixed(1)} m`;
    marker.setLatLng([best.lat, best.lon]);
    if (!S.map.hasLayer(marker)) marker.addTo(S.map);
  };
  svg.addEventListener("pointerdown", (e) => { svg.setPointerCapture(e.pointerId); show(e.clientX); });
  svg.addEventListener("pointermove", (e) => { if (e.buttons || e.pointerType === "mouse") show(e.clientX); });
  body.replaceChildren(
    h("div", { class: "prof-stats" },
      h("span", {}, `距離 ${fmtDist(total)}`), h("span", {}, `最高 ${zmax.toFixed(1)} m`), h("span", {}, `最低 ${zmin.toFixed(1)} m`),
      h("span", {}, `高低差 ${(zmax - zmin).toFixed(1)} m`), h("span", {}, `登り ${Math.round(up)} m・下り ${Math.round(down)} m`), h("span", {}, `最大傾斜 ${(Math.atan(maxSlope) * 180 / Math.PI).toFixed(1)}°（${Math.round(win)} m 区間）`)),
    svg, readout,
    h("p", { class: "note" }, `国土地理院 標高タイル（${[...srcs].join("・") || "1m・5m・10m"}）から ${samples.length} 点を読み取り。${coarse ? "線が長いので 5m・10m 標高で計算しています。" : ""}縦方向は強調して表示しています。`));
}

/* ====================================================================
 * 2 つの地図を左右に比べる（スワイプ）
 * ==================================================================== */
const CMP = { on: false, a: null, b: null, x: 0.5, bar: null, info: null };
/** 比べられる地図の一覧（背景・重ねる地図・その他のレイヤ） */
function compareCandidates() {
  const list = [];
  for (const b of BASE_LAYERS) list.push({ key: "base:" + b.id, name: b.name, group: "背景", def: b });
  for (const o of OVERLAYS) list.push({ key: "ov:" + o.id, name: o.name, group: "重ねる地図", def: o });
  for (const x of typeof extraCompareDefs === "function" ? extraCompareDefs() : []) list.push(x);
  return list;
}
async function makeCompareLayer(c, pane) {
  if (c.def.make) return c.def.make(pane);
  if (c.def.vector) {
    await vtLoadLibs(); await vtLoadBaseStyle(); await vtPrepareSource();
    const { style, hidden } = vtSettings();
    return L.maplibreGL({ style: vtBuildStyle(style, hidden), interactive: false, attributionControl: false, pane });
  }
  return L.tileLayer(c.def.url, { pane, tms: !!c.def.tms, minNativeZoom: c.def.min, maxNativeZoom: c.def.max, maxZoom: 20, minZoom: c.def.min || 0, crossOrigin: true, attribution: c.def.attr, errorTileUrl: "data:image/gif;base64,R0lGODlhAQABAAAAACw=" });
}
function compareClip() {
  if (!CMP.on) return;
  const size = S.map.getSize(), x = Math.round(size.x * CMP.x);
  // 面の座標で画面の左上・右下を求める（回転する面と、回転しない面で計算が違う）
  const corners = (pn) => {
    if (pn.endsWith("gl")) { const o = S.map._getMapPanePos(); return [L.point(-o.x, -o.y), L.point(size.x - o.x, size.y - o.y)]; }
    return [S.map.containerPointToLayerPoint([0, 0]), S.map.containerPointToLayerPoint(size)];
  };
  const [a0, a1] = corners(CMP.pa), [b0, b1] = corners(CMP.pb);
  S.map.getPane(CMP.pa).style.clip = `rect(${a0.y}px, ${a0.x + x}px, ${a1.y}px, ${a0.x}px)`;
  S.map.getPane(CMP.pb).style.clip = `rect(${b0.y}px, ${b1.x}px, ${b1.y}px, ${b0.x + x}px)`;
  CMP.bar.style.left = x + "px";
}
async function startCompare(keyA, keyB) {
  stopCompare();
  const cands = compareCandidates(), A = cands.find((c) => c.key === keyA), B = cands.find((c) => c.key === keyB);
  if (!A || !B) return;
  // 比べている間は北を上に固定（境目は画面の縦線）
  if (S.map.setBearing) { S.map.setBearing(0); S.map.touchRotate?.disable(); }
  // 画像タイルは回転する面、WebGL（地理院 Vector）は回転しない面に入れる
  const paneFor = (c, n) => (c.def.vector ? (mapPaneAt(n + "gl", 400 + (n === "cmpB" ? 1 : 0), true), n + "gl") : (rotPaneAt(n, n === "cmpB" ? 261 : 260), n));
  CMP.pa = paneFor(A, "cmpA"); CMP.pb = paneFor(B, "cmpB");
  try {
    CMP.a = (await makeCompareLayer(A, CMP.pa)).addTo(S.map);
    CMP.b = (await makeCompareLayer(B, CMP.pb)).addTo(S.map);
  } catch (e) { stopCompare(); return toast("表示できません：" + e.message, 4000); }
  CMP.on = true;
  Settings.data.compare = { a: keyA, b: keyB };
  Settings.save();
  const handle = h("div", { class: "cmp-handle" }, h("i"));
  CMP.bar = h("div", { class: "cmp-bar" }, handle);
  CMP.info = h("div", { class: "cmp-info glass" },
    h("span", { class: "cmp-l" }, "← " + A.name), h("button", { type: "button", class: "chip", onclick: stopCompare }, "比較を終了"), h("span", { class: "cmp-r" }, B.name + " →"));
  document.body.append(CMP.bar, CMP.info);
  let drag = false;
  handle.addEventListener("pointerdown", (e) => { drag = true; handle.setPointerCapture(e.pointerId); e.stopPropagation(); });
  handle.addEventListener("pointermove", (e) => {
    if (!drag) return;
    const r = S.map.getContainer().getBoundingClientRect();
    CMP.x = Math.max(0.02, Math.min(0.98, (e.clientX - r.left) / r.width));
    compareClip();
  });
  handle.addEventListener("pointerup", () => (drag = false));
  S.map.on("move zoom resize zoomend", compareClip);
  compareClip();
}
function stopCompare() {
  if (CMP.a) S.map.removeLayer(CMP.a);
  if (CMP.b) S.map.removeLayer(CMP.b);
  CMP.a = CMP.b = null;
  CMP.bar?.remove(); CMP.info?.remove();
  CMP.bar = CMP.info = null;
  if (CMP.on) S.map.off("move zoom resize zoomend", compareClip);
  for (const p of ["cmpA", "cmpB", "cmpAgl", "cmpBgl"]) { const pane = S.map.getPane(p); if (pane) pane.style.clip = ""; }
  if (CMP.on) S.map.touchRotate?.enable();
  CMP.on = false;
}
function openCompareSheet() {
  const cands = compareCandidates(), last = Settings.data.compare || {};
  const mk = (cur) => {
    const s = h("select", {});
    let grp = null, og = null;
    for (const c of cands) {
      if (c.group !== grp) { grp = c.group; og = h("optgroup", { label: grp }); s.append(og); }
      og.append(h("option", { value: c.key, selected: c.key === cur }, c.name));
    }
    return s;
  };
  const a = mk(last.a || "base:std"), b = mk(last.b || "base:usa10");
  openSheet("2 つの地図を比べる", h("div", {},
    h("button", { type: "button", class: "chip vt-back", onclick: () => openLayers() }, "← 地図の切替に戻る"),
    h("div", { class: "pr-grid" }, h("label", {}, "左に表示", a), h("label", {}, "右に表示", b)),
    h("button", { type: "button", class: "btn primary block", style: "margin-top:12px", onclick: () => { closeSheet(true); startCompare(a.value, b.value); } }, "比べる"),
    h("p", { class: "note" }, "地図の上に縦の線が出ます。線の丸をドラッグすると、左右の地図の境目が動きます。今の地図・写真と旧版地図や昔の空中写真などを、同じ場所で見比べられます。")), { backdrop: false, height: "50vh" });
}
