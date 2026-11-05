/* フィールドノート — その他のレイヤ（地図の切替の子画面）
 * - 今昔マップ on the web（旧版地形図）・迅速測図（明治初期の関東）
 * - 地形分類（自然地形・人工地形）・活断層図（都市圏活断層図）
 * - Wikipedia / Wikidata の周辺の記事・項目
 * - 気象庁のアメダス（最新の観測値）・降水ナウキャスト（雨雲）
 * - ジャパンサーチ（この付近の資料・古写真など）
 * 出典の表記は各レイヤの attribution（地図右下）に出す。
 */
"use strict";

const ATTR_KJ = '<a href="https://ktgis.net/kjmapw/" target="_blank" rel="noopener">今昔マップ on the web（谷謙二）</a>';
const ATTR_HABS = '<a href="https://habs.rad.naro.go.jp/" target="_blank" rel="noopener">迅速測図：農研機構農業環境研究部門</a>';
const ATTR_JMA = '<a href="https://www.jma.go.jp/" target="_blank" rel="noopener">出典：気象庁ホームページ</a>';
const ATTR_WIKI = '<a href="https://ja.wikipedia.org/" target="_blank" rel="noopener">Wikipedia</a>（CC BY-SA）';
const LF_BASE = "https://cyberjapandata.gsi.go.jp/xyz/experimental_landformclassification";

const EXTRA_DEFAULT = {
  kj: { on: false, ds: "tokyo50", era: "00", opacity: 0.85 },
  habs: { on: false, opacity: 0.85 },
  lf: { on: false, kind: "1", opacity: 0.6 },
  afm: { on: false, opacity: 0.85 },
  wiki: { on: false, wd: false },
  amedas: { on: false, elem: "temp" },
  nowc: { on: false, opacity: 0.7, t: 0 },
};
const extraCfg = () => { const s = Settings.data.extra || {}; return Object.fromEntries(Object.entries(EXTRA_DEFAULT).map(([k, v]) => [k, { ...v, ...(s[k] || {}) }])); };
function extraSave(key, patch) {
  const all = extraCfg();
  all[key] = { ...all[key], ...patch };
  Settings.data.extra = all;
  Settings.save();
  return all[key];
}
const EX = { layers: {} }; // key -> Leaflet レイヤ

/* ---------- 今昔マップ・迅速測図・活断層図（画像タイル） ---------- */
const kjDataset = (id) => KJ_DATASETS.find((d) => d[0] === id) || KJ_DATASETS[0];
function kjDef(ds, era) {
  const d = kjDataset(ds), e = d[2].find((x) => x[1] === era) || d[2][0];
  const max = ds === "kanto" || ds === "tohoku_pacific_coast" ? 15 : 16;
  return { url: `https://ktgis.net/kjmapw/kjtilemap/${d[0]}/${e[1]}/{z}/{x}/{y}.png`, tms: true, min: 8, max, attr: ATTR_KJ, name: `今昔マップ ${d[1]} ${e[0]}年` };
}
const HABS_DEF = { url: "https://habs.rad.naro.go.jp/rapid16/{z}/{x}/{y}.png", tms: true, min: 8, max: 16, attr: ATTR_HABS, name: "迅速測図（明治初期の関東）" };
const AFM_DEF = { url: "https://cyberjapandata.gsi.go.jp/xyz/afm/{z}/{x}/{y}.png", min: 11, max: 16, attr: '<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank" rel="noopener">国土地理院（都市圏活断層図）</a>', name: "活断層図（都市圏活断層図）" };
function extraTile(def, opacity, z, pane) {
  return L.tileLayer(def.url, {
    tms: !!def.tms, maxNativeZoom: def.max, minNativeZoom: def.min, minZoom: Math.max(0, (def.min || 0) - 3), maxZoom: 20, opacity, zIndex: z, crossOrigin: true,
    attribution: def.attr, errorTileUrl: "data:image/gif;base64,R0lGODlhAQABAAAAACw=", ...(pane ? { pane } : {}),
  });
}

/* ---------- 地形分類（GeoJSON のタイルを canvas に描く） ---------- */
const lfCache = new Map();
function lfFetch(kind, z, x, y) {
  const url = `${LF_BASE}${kind}/${z}/${x}/${y}.geojson`;
  if (lfCache.has(url)) return lfCache.get(url);
  const p = fetch(url).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  lfCache.set(url, p);
  while (lfCache.size > 300) lfCache.delete(lfCache.keys().next().value);
  return p;
}
const lfInfo = (code) => LF_CODES[code] || LF_CODES[String(Number(code))] || ["（分類不明）", "#cccccc"];
const lfDataZoom = (z, kind) => Math.max(kind === "2" ? 14 : 5, Math.min(16, z));
/** 経緯度 → タイル z の中の画素（tx,ty 起点・256 px） */
function lfDraw(ctx, fc, z, tx, ty, scale = 1, ox = 0, oy = 0) {
  const n = 2 ** z;
  const P = ([lon, lat]) => [(((lon + 180) / 360) * n - tx) * 256 * scale + ox, (((1 - Math.asinh(Math.tan((lat * Math.PI) / 180)) / Math.PI) / 2) * n - ty) * 256 * scale + oy];
  for (const f of fc.features || []) {
    const g = f.geometry;
    if (!g) continue;
    const polys = g.type === "Polygon" ? [g.coordinates] : g.type === "MultiPolygon" ? g.coordinates : [];
    ctx.fillStyle = lfInfo(f.properties?.code)[1];
    ctx.beginPath();
    for (const poly of polys) for (const ring of poly) ring.forEach((c, i) => { const [x, y] = P(c); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
    ctx.fill("evenodd");
  }
}
const LandformLayer = L.GridLayer.extend({
  options: { tileSize: 256, maxZoom: 20, minZoom: 5, attribution: '<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank" rel="noopener">地理院タイル（地形分類）</a>' },
  createTile(c, done) {
    const cv = document.createElement("canvas");
    cv.width = cv.height = 256;
    const kind = this.options.kind || "1";
    const dz = lfDataZoom(c.z, kind);
    const f = 2 ** (c.z - dz); // 表示ズーム ÷ データのズーム
    const px = Math.floor(c.x / f), py = Math.floor(c.y / f);
    if (c.z < (kind === "2" ? 12 : 5)) { done(null, cv); return cv; }
    // データのズームが表示より細かいときは、表示タイルに含まれる複数のタイルを描く
    const tiles = [];
    if (dz > c.z) { const k = 2 ** (dz - c.z); for (let j = 0; j < k; j++) for (let i = 0; i < k; i++) tiles.push([c.x * k + i, c.y * k + j]); } else tiles.push([px, py]);
    Promise.all(tiles.map(([x, y]) => lfFetch(kind, dz, x, y).then((fc) => ({ fc, x, y })))).then((list) => {
      const ctx = cv.getContext("2d");
      for (const { fc, x, y } of list) if (fc) lfDraw(ctx, fc, c.z, c.x, c.y);
      done(null, cv);
    });
    return cv;
  },
});
function lfQuery(latlng) {
  const c = extraCfg().lf;
  if (!c.on || !EX.layers.lf) return null;
  const z = lfDataZoom(Math.floor(S.map.getZoom()), c.kind), n = 2 ** z;
  const x = Math.floor(((latlng.lng + 180) / 360) * n), y = Math.floor(((1 - Math.asinh(Math.tan((latlng.lat * Math.PI) / 180)) / Math.PI) / 2) * n);
  const p = lfCache.get(`${LF_BASE}${c.kind}/${z}/${x}/${y}.geojson`);
  return p ? p.then((fc) => {
    if (!fc) return null;
    const inRing = (r) => { let ins = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const [xi, yi] = r[i], [xj, yj] = r[j]; if (yi > latlng.lat !== yj > latlng.lat && latlng.lng < ((xj - xi) * (latlng.lat - yi)) / (yj - yi) + xi) ins = !ins; } return ins; };
    for (const f of fc.features) {
      const polys = f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates;
      if (polys.some((poly) => inRing(poly[0]) && !poly.slice(1).some(inRing))) return f.properties.code;
    }
    return null;
  }) : null;
}

/* ---------- アメダス・降水ナウキャスト（気象庁） ---------- */
const JMA = "https://www.jma.go.jp/bosai";
const AM = { table: null, data: null, time: null, timer: 0, group: null };
async function amedasLoad() {
  if (!AM.table) AM.table = await (await fetch(`${JMA}/amedas/const/amedastable.json`)).json();
  const t = (await (await fetch(`${JMA}/amedas/data/latest_time.txt`)).text()).trim(); // 例：2026-11-05T07:20:00+09:00（日本時間）
  if (t !== AM.time) {
    const key = t.replace(/[^\d]/g, "").slice(0, 12) + "00";
    AM.data = await (await fetch(`${JMA}/amedas/data/map/${key}.json`)).json();
    AM.time = t;
  }
}
const AM_ELEMS = { temp: ["気温", "℃"], precipitation1h: ["1時間降水量", "mm"], wind: ["風速", "m/s"], humidity: ["湿度", "%"], snow: ["積雪深", "cm"] };
const WIND_DIR = ["静穏", "北北東", "北東", "東北東", "東", "東南東", "南東", "南南東", "南", "南南西", "南西", "西南西", "西", "西北西", "北西", "北北西", "北"];
function amedasRender() {
  const c = extraCfg().amedas;
  if (!AM.group || !AM.table || !AM.data) return;
  AM.group.clearLayers();
  const b = S.map.getBounds().pad(0.1), z = S.map.getZoom();
  if (z < 8) return;
  const elem = c.elem;
  for (const [code, st] of Object.entries(AM.table)) {
    const lat = st.lat[0] + st.lat[1] / 60, lon = st.lon[0] + st.lon[1] / 60;
    if (!b.contains([lat, lon])) continue;
    const d = AM.data[code];
    const v = d?.[elem]?.[0];
    if (v == null) continue;
    const txt = elem === "wind" ? `${v}` : elem === "temp" ? `${v.toFixed(1)}°` : `${v}`;
    const cls = elem === "temp" ? (v >= 30 ? "hot" : v >= 25 ? "warm" : v <= 0 ? "cold" : "") : elem === "precipitation1h" ? (v >= 10 ? "rain2" : v > 0 ? "rain1" : "") : "";
    const m = L.marker([lat, lon], { icon: L.divIcon({ className: "amd-pin " + cls, html: `<span>${txt}</span>`, iconSize: null }), keyboard: false });
    const t = new Date(AM.time);
    const row = (k, u, f = (x) => x) => (d?.[k]?.[0] != null ? `<div>${AM_ELEMS[k]?.[0] || k}：${f(d[k][0])} ${u}</div>` : "");
    m.bindPopup(`<div class="pt">${esc(st.kjName)}（アメダス）</div><div class="ps">${t.getMonth() + 1}/${t.getDate()} ${hm(t)} 現在</div>`
      + row("temp", "℃") + row("precipitation1h", "mm") + row("precipitation24h", "mm") + (d?.wind?.[0] != null ? `<div>風：${WIND_DIR[d.windDirection?.[0] ?? 0] || ""} ${d.wind[0]} m/s</div>` : "") + row("humidity", "%") + row("snow", "cm")
      + `<div class="ps" style="margin-top:4px">${ATTR_JMA}</div>`);
    AM.group.addLayer(m);
  }
}
async function amedasOn(on) {
  clearInterval(AM.timer);
  if (AM.group) { S.map.removeLayer(AM.group); S.map.off("moveend", amedasRender); }
  AM.group = null;
  if (!on) return;
  AM.group = L.layerGroup([], { attribution: ATTR_JMA }).addTo(S.map);
  S.map.on("moveend", amedasRender);
  try { await amedasLoad(); amedasRender(); } catch (e) { toast("アメダスを読み込めません：" + e.message, 4000); }
  AM.timer = setInterval(async () => { try { await amedasLoad(); amedasRender(); } catch {} }, 10 * 60000);
}
/* 降水ナウキャスト：過去 1 時間（5 分ごと）と 1 時間先までの予測 */
const NC = { times: null, at: 0 };
async function nowcTimes() {
  if (NC.times && Date.now() - NC.at < 4 * 60000) return NC.times;
  const [n1, n2] = await Promise.all(["N1", "N2"].map((k) => fetch(`${JMA}/jmatile/data/nowc/targetTimes_${k}.json`).then((r) => r.json())));
  const past = n1.filter((t) => t.elements?.includes("hrpns")).sort((a, b) => (a.validtime < b.validtime ? -1 : 1));
  const fut = n2.filter((t) => t.elements?.includes("hrpns")).sort((a, b) => (a.validtime < b.validtime ? -1 : 1));
  const base = past.at(-1);
  NC.times = [...past.slice(-13).map((t) => ({ ...t, min: Math.round((utcOf(t.validtime) - utcOf(base.validtime)) / 60000) })), ...fut.map((t) => ({ ...t, min: Math.round((utcOf(t.validtime) - utcOf(base.validtime)) / 60000) }))];
  NC.at = Date.now();
  return NC.times;
}
const utcOf = (s) => Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8), +s.slice(8, 10), +s.slice(10, 12), +s.slice(12, 14));
async function nowcDef(offsetMin) {
  const times = await nowcTimes();
  const t = times.reduce((a, b) => (Math.abs(b.min - offsetMin) < Math.abs(a.min - offsetMin) ? b : a));
  const local = new Date(utcOf(t.validtime));
  return { url: `${JMA}/jmatile/data/nowc/${t.basetime}/none/${t.validtime}/surf/hrpns/{z}/{x}/{y}.png`, min: 4, max: 10, attr: ATTR_JMA, name: `降水ナウキャスト ${hm(local)}${t.min > 0 ? `（${t.min}分後の予測）` : t.min < 0 ? `（${-t.min}分前）` : "（最新）"}`, t };
}

/* ---------- Wikipedia / Wikidata の周辺 ---------- */
const WK = { group: null, seq: 0, timer: 0 };
async function wikiRender() {
  const c = extraCfg().wiki;
  if (!WK.group) return;
  if (S.map.getZoom() < 12) { WK.group.clearLayers(); return; }
  const seq = ++WK.seq, ctr = S.map.getCenter(), b = S.map.getBounds();
  const r = Math.min(10000, Math.max(500, Math.round(ctr.distanceTo(b.getNorthEast()))));
  const items = [];
  try {
    const u = `https://ja.wikipedia.org/w/api.php?action=query&format=json&formatversion=2&origin=*&generator=geosearch&ggscoord=${ctr.lat}%7C${ctr.lng}&ggsradius=${r}&ggslimit=50&prop=coordinates%7Cpageimages%7Cdescription%7Cinfo&inprop=url&piprop=thumbnail&pithumbsize=160`;
    const j = await (await fetch(u)).json();
    for (const p of j.query?.pages || []) if (p.coordinates?.[0]) items.push({ kind: "wp", title: p.title, lat: p.coordinates[0].lat, lon: p.coordinates[0].lon, desc: p.description || "", thumb: p.thumbnail?.source, url: p.fullurl });
  } catch {}
  if (c.wd) {
    try {
      const q = `SELECT ?item ?itemLabel ?itemDescription ?coord ?typeLabel WHERE { SERVICE wikibase:around { ?item wdt:P625 ?coord . bd:serviceParam wikibase:center "Point(${ctr.lng} ${ctr.lat})"^^geo:wktLiteral . bd:serviceParam wikibase:radius "${(r / 1000).toFixed(2)}" . } FILTER NOT EXISTS { ?a schema:about ?item ; schema:isPartOf <https://ja.wikipedia.org/> . } OPTIONAL { ?item wdt:P31 ?type . } SERVICE wikibase:label { bd:serviceParam wikibase:language "ja,en". } } LIMIT 150`;
      const j = await (await fetch(`https://query.wikidata.org/sparql?format=json&query=${encodeURIComponent(q)}`)).json();
      const seen = new Set();
      for (const row of j.results.bindings) {
        const id = row.item.value.split("/").pop();
        if (seen.has(id)) continue;
        seen.add(id);
        const m = row.coord.value.match(/Point\(([-\d.]+) ([-\d.]+)\)/);
        if (!m || /^Q\d+$/.test(row.itemLabel?.value || "")) continue;
        items.push({ kind: "wd", title: row.itemLabel.value, lat: +m[2], lon: +m[1], desc: [row.typeLabel?.value, row.itemDescription?.value].filter(Boolean).join("・"), url: row.item.value });
      }
    } catch {}
  }
  if (seq !== WK.seq || !WK.group) return;
  WK.group.clearLayers();
  for (const it of items) {
    const m = L.marker([it.lat, it.lon], { icon: L.divIcon({ className: "wk-pin " + it.kind, html: `<span>${it.kind === "wp" ? "W" : "D"}</span>`, iconSize: [20, 20], iconAnchor: [10, 10] }) });
    m.bindPopup(() => h("div", { class: "wk-pop" },
      it.thumb ? h("img", { src: it.thumb, alt: "", loading: "lazy" }) : null,
      h("div", { class: "pt" }, it.title), it.desc ? h("div", { class: "ps" }, it.desc) : null,
      h("div", { style: "margin-top:4px" }, h("a", { href: it.url, target: "_blank", rel: "noopener" }, it.kind === "wp" ? "Wikipedia で読む" : "Wikidata で見る")),
      h("div", { class: "pa" }, h("button", { type: "button", onclick: () => { S.map.closePopup(); openMemoForm(null, { lat: it.lat, lon: it.lon, source: "map" }); setTimeout(() => { const f = $("#memo-form"); if (f) { f.title.value = it.title; f.note.value = `${it.desc ? it.desc + "\n" : ""}${it.url}`; } }, 300); } }, "メモにする")),
      h("div", { class: "ps" }, it.kind === "wp" ? "出典：Wikipedia（CC BY-SA 4.0）" : "出典：Wikidata（CC0）")), { maxWidth: 240 });
    WK.group.addLayer(m);
  }
}
function wikiOn(on) {
  if (WK.group) { S.map.removeLayer(WK.group); S.map.off("moveend", wikiSoon); }
  WK.group = null;
  if (!on) return;
  WK.group = L.layerGroup([], { attribution: ATTR_WIKI }).addTo(S.map);
  S.map.on("moveend", wikiSoon);
  wikiRender();
  if (S.map.getZoom() < 12) toast("ズーム 12 以上で周辺の記事を表示します");
}
function wikiSoon() { clearTimeout(WK.timer); WK.timer = setTimeout(wikiRender, 800); }

/* ---------- ジャパンサーチ（この付近の資料） ---------- */
const JPS = { group: null };
async function openJapanSearch(radius = "1km") {
  const c = S.map.getCenter();
  const body = h("div", {}, h("button", { type: "button", class: "chip vt-back", onclick: openExtraLayers }, "← その他のレイヤに戻る"), h("div", { class: "note" }, "検索中…"));
  openSheet("この付近の資料（ジャパンサーチ）", body, { backdrop: false, height: "70vh" });
  let j;
  try {
    j = await (await fetch(`https://jpsearch.go.jp/api/item/search/jps-cross?g-coordinates=${c.lat.toFixed(5)},${c.lng.toFixed(5)},${radius}&size=40&from=0`)).json();
  } catch (e) { body.lastChild.textContent = "検索できませんでした：" + e.message; return; }
  const list = (j.list || []).map((x) => x.common || {}).filter((x) => x.title);
  if (JPS.group) S.map.removeLayer(JPS.group);
  JPS.group = L.layerGroup([], { attribution: '<a href="https://jpsearch.go.jp/" target="_blank" rel="noopener">ジャパンサーチ</a>' }).addTo(S.map);
  const RIGHTS = { ccby: "CC BY", cc0: "CC0", pdm: "パブリックドメイン", ccbysa: "CC BY-SA", ccbync: "CC BY-NC", ccbyncsa: "CC BY-NC-SA", incr: "著作権あり（要確認）", ccbynd: "CC BY-ND" };
  const rows = list.map((it) => {
    const ll = it.coordinates && Number.isFinite(+it.coordinates.lat) ? [+it.coordinates.lat, +it.coordinates.lon] : null;
    if (ll) JPS.group.addLayer(L.circleMarker(ll, { radius: 6, color: "#fff", weight: 1.5, fillColor: "#7b3fa0", fillOpacity: 0.9 }).bindPopup(esc(it.title)));
    return h("a", { class: "jps-item", href: it.linkUrl || "#", target: "_blank", rel: "noopener" },
      it.thumbnailUrl?.[0] ? h("img", { src: it.thumbnailUrl[0], alt: "", loading: "lazy" }) : h("span", { class: "jps-noimg" }),
      h("div", {}, h("b", {}, it.title), h("small", {}, [it.provider || it.ownerOrg, it.temporal, it.location, RIGHTS[it.contentsRightsType] || it.contentsRightsType].filter(Boolean).flat().join("・"))));
  });
  const rsel = h("select", {}, ...["500m", "1km", "3km", "10km"].map((v) => h("option", { value: v, selected: v === radius }, `半径 ${v}`)));
  rsel.onchange = () => openJapanSearch(rsel.value);
  body.replaceChildren(body.firstChild,
    h("div", { class: "pr-grid" }, rsel, h("button", { type: "button", class: "btn secondary", onclick: () => openJapanSearch(rsel.value) }, "地図の中心で検索")),
    h("div", { class: "note" }, `${(j.hit ?? list.length).toLocaleString()} 件中 ${list.length} 件を表示。位置は地名から付けられたものが多く、市区町村の中心などにまとまることがあります。`),
    ...rows,
    h("p", { class: "note" }, "資料の利用条件は資料ごとに異なります。リンク先で所蔵機関の条件を確認してください。出典：ジャパンサーチ・各所蔵機関"));
}

/* ====================================================================
 * 表示の切り替え・復元・ほかの機能との連携
 * ==================================================================== */
async function extraApply(key) {
  const c = extraCfg()[key];
  if (EX.layers[key]) { S.map.removeLayer(EX.layers[key]); EX.layers[key] = null; }
  if (key === "wiki") return wikiOn(c.on);
  if (key === "amedas") return amedasOn(c.on);
  if (!c.on) return;
  let layer;
  if (key === "kj") layer = extraTile(kjDef(c.ds, c.era), c.opacity, 30);
  else if (key === "habs") layer = extraTile(HABS_DEF, c.opacity, 31);
  else if (key === "afm") layer = extraTile(AFM_DEF, c.opacity, 33);
  else if (key === "lf") layer = new LandformLayer({ kind: c.kind, opacity: c.opacity, zIndex: 32 });
  else if (key === "nowc") { try { layer = extraTile(await nowcDef(c.t), c.opacity, 40); } catch (e) { toast("ナウキャストを読み込めません：" + e.message, 4000); return; } }
  if (layer) EX.layers[key] = layer.addTo(S.map);
}
function extraRestore() {
  const c = extraCfg();
  for (const k of Object.keys(c)) if (c[k].on) extraApply(k);
}
/** 地図タップ：地形分類の説明 */
function extraLayerClick(latlng) {
  const p = lfQuery(latlng);
  if (!p) return false;
  p.then((code) => {
    if (!code) return;
    const [name, color] = lfInfo(code), [desc, risk] = LF_TEXTS[name] || ["", ""];
    L.popup({ maxWidth: 280 }).setLatLng(latlng).setContent(h("div", {},
      h("div", { class: "pt" }, h("i", { class: "dl-sw", style: `background:${color};display:inline-block;margin-right:6px;vertical-align:-1px` }), name),
      desc ? h("div", { style: "margin-top:4px;font-size:12.5px" }, desc) : null,
      risk ? h("div", { class: "ps", style: "margin-top:4px" }, "災害リスク：" + risk) : null,
      h("div", { class: "ps", style: "margin-top:4px" }, `地形分類（${extraCfg().lf.kind === "2" ? "人工地形" : "自然地形"}）・国土地理院`))).openOn(S.map);
  });
  return false; // ほかのポップアップの判定も続ける（地形は面全体なので）
}
/** 比較（スワイプ）で選べる、その他のレイヤ */
function extraCompareDefs() {
  const c = extraCfg(), d = kjDataset(c.kj.ds), out = [];
  for (const [label, era] of d[2]) out.push({ key: `kj:${d[0]}:${era}`, name: `今昔 ${d[1]} ${label}`, group: "今昔マップ（選んでいる地域）", def: kjDef(d[0], era) });
  out.push({ key: "habs", name: HABS_DEF.name, group: "その他のレイヤ", def: HABS_DEF });
  out.push({ key: "afm", name: AFM_DEF.name, group: "その他のレイヤ", def: AFM_DEF });
  out.push({ key: "lf1", name: "地形分類（自然地形）", group: "その他のレイヤ", def: { make: (pane) => new LandformLayer({ kind: "1", pane }) } });
  out.push({ key: "lf2", name: "地形分類（人工地形）", group: "その他のレイヤ", def: { make: (pane) => new LandformLayer({ kind: "2", pane }) } });
  return out;
}
/** 印刷：表示中の画像タイル（地形分類は図形を描く） */
function extraPrintCandidates() {
  const c = extraCfg(), out = [];
  if (c.kj.on) { const d = kjDef(c.kj.ds, c.kj.era); out.push({ key: "ex:kj", name: d.name, kind: "tile", def: { ...d, attr: "今昔マップ on the web（谷謙二）" }, opacity: c.kj.opacity, z: 30 }); }
  if (c.habs.on) out.push({ key: "ex:habs", name: HABS_DEF.name, kind: "tile", def: { ...HABS_DEF, attr: "迅速測図：農研機構農業環境研究部門" }, opacity: c.habs.opacity, z: 31 });
  if (c.afm.on) out.push({ key: "ex:afm", name: AFM_DEF.name, kind: "tile", def: AFM_DEF, opacity: c.afm.opacity, z: 33 });
  if (c.nowc.on && EX.layers.nowc) out.push({ key: "ex:nowc", name: "降水ナウキャスト", kind: "tile", def: { url: EX.layers.nowc._url, min: 4, max: 10, attr: "出典：気象庁ホームページ" }, opacity: c.nowc.opacity, z: 40 });
  if (c.lf.on) out.push({ key: "ex:lf", name: `地形分類（${c.lf.kind === "2" ? "人工地形" : "自然地形"}）`, kind: "canvas", opacity: c.lf.opacity, z: 32, credit: "国土地理院（地形分類）",
    async draw(lctx, ext, r, k, progress) {
      const kind = c.lf.kind, z = prPickZoom(ext, r, k, kind === "2" ? 14 : 5, 16), t = prTileRange(ext, z), jobs = [];
      for (let ty = t.ty0; ty <= t.ty1; ty++) for (let tx = t.tx0; tx <= t.tx1; tx++) jobs.push([tx, ty]);
      let done = 0;
      const codes = new Set();
      await prPool(jobs, 6, async ([tx, ty]) => {
        const fc = await lfFetch(kind, z, tx, ty);
        if (fc) {
          const [x, y, w] = prTileRect(ext, r, z, tx, ty);
          lfDraw(lctx, fc, z, tx, ty, w / 256, x, y);
          for (const f of fc.features) codes.add(lfInfo(f.properties?.code)[0]);
        }
        progress(++done, jobs.length);
      });
      return [...codes].filter(Boolean).map((n) => ({ type: "box", color: Object.values(LF_CODES).find((v) => v[0] === n)?.[1] || "#ccc", text: n }));
    } });
  return out;
}

/* ====================================================================
 * 画面：その他のレイヤ
 * ==================================================================== */
function openExtraLayers() {
  const c = extraCfg();
  const body = h("div", {}, h("button", { type: "button", class: "chip vt-back", onclick: () => openLayers() }, "← 地図の切替に戻る"));
  const row = (key, title, sub, extra) => {
    const cb = h("input", { type: "checkbox", checked: !!c[key].on });
    cb.onchange = async () => { extraSave(key, { on: cb.checked }); await extraApply(key); };
    const kids = [cb, h("div", {}, title, h("small", {}, sub))];
    if (c[key].opacity != null) {
      const rg = h("input", { type: "range", min: "0.1", max: "1", step: "0.05", value: c[key].opacity });
      rg.oninput = () => { extraSave(key, { opacity: Number(rg.value), on: true }); cb.checked = true; if (EX.layers[key]) EX.layers[key].setOpacity(Number(rg.value)); else extraApply(key); };
      kids.push(rg);
    }
    return h("div", { class: "ri-row" }, h("div", { class: "ov-row" }, ...kids), extra ? h("div", { class: "ri-opts" }, extra) : null);
  };
  // 今昔マップ：地域と時期
  const dsSel = h("select", {}, ...KJ_DATASETS.map(([id, name]) => h("option", { value: id, selected: id === c.kj.ds }, name)));
  const eraSel = h("select", {});
  const fillEras = () => { const d = kjDataset(dsSel.value), cur = extraCfg().kj.era; eraSel.replaceChildren(...d[2].map(([label, f]) => h("option", { value: f, selected: f === cur }, `${label}年`))); };
  fillEras();
  dsSel.onchange = () => { fillEras(); extraSave("kj", { ds: dsSel.value, era: eraSel.value, on: true }); extraApply("kj"); openExtraLayers(); };
  eraSel.onchange = () => { extraSave("kj", { era: eraSel.value, on: true }); extraApply("kj"); body.querySelector("input[type=checkbox]").checked = true; };
  const findBtn = h("button", { type: "button", class: "chip" }, "この場所の地域を探す");
  findBtn.onclick = async () => {
    findBtn.disabled = true; findBtn.textContent = "探しています…";
    const ctr = S.map.getCenter(), z = 10, n = 2 ** z;
    const x = Math.floor(((ctr.lng + 180) / 360) * n), y = n - 1 - Math.floor(((1 - Math.asinh(Math.tan((ctr.lat * Math.PI) / 180)) / Math.PI) / 2) * n);
    const hits = [];
    await Promise.all(KJ_DATASETS.map(async ([id, , eras]) => { try { const r = await fetch(`https://ktgis.net/kjmapw/kjtilemap/${id}/${eras.at(-1)[1]}/${z}/${x}/${y}.png`, { method: "GET" }); if (r.ok && (await r.blob()).size > 1000) hits.push(id); } catch {} }));
    findBtn.disabled = false;
    if (!hits.length) { findBtn.textContent = "この場所の地域はありません"; return; }
    findBtn.textContent = `見つかった地域：${hits.map((id) => kjDataset(id)[1]).join("・")}`;
    if (!hits.includes(dsSel.value)) { dsSel.value = hits[0]; dsSel.onchange(); }
  };
  body.append(h("div", { class: "sect-title" }, "旧版地図"),
    row("kj", "今昔マップ on the web", "明治以降の旧版地形図（全国 59 地域・ズーム 8〜16）", h("div", {}, h("div", { class: "pr-grid" }, h("label", {}, "地域", dsSel), h("label", {}, "時期", eraSel)), findBtn)),
    row("habs", "迅速測図", "明治初期（1880 年代）の関東の地図・ズーム 8〜16"));
  // 地形
  const kindSel = h("div", { class: "seg" }, ...[["1", "自然地形"], ["2", "人工地形"]].map(([k, t]) => {
    const b = h("button", { type: "button", class: c.lf.kind === k ? "on" : "" }, t);
    b.onclick = () => { extraSave("lf", { kind: k, on: true }); kindSel.querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b)); extraApply("lf"); };
    return b;
  }));
  body.append(h("div", { class: "sect-title" }, "地形"),
    row("lf", "地形分類", "台地・低地・旧河道・盛土地など。タップで説明と災害リスク", h("div", {}, kindSel, h("small", { class: "note" }, "人工地形はズーム 14 以上で表示します。"))),
    row("afm", "活断層図（都市圏活断層図）", "国土地理院・ズーム 11〜16"));
  // 周辺の情報
  const wdCb = h("input", { type: "checkbox", checked: !!c.wiki.wd });
  wdCb.onchange = () => { extraSave("wiki", { wd: wdCb.checked }); wikiRender(); };
  body.append(h("div", { class: "sect-title" }, "周辺の情報"),
    row("wiki", "Wikipedia の記事", "表示範囲の記事を地図に表示（ズーム 12 以上）。タップで概要とリンク・メモにできる",
      h("label", { class: "inline", style: "margin:2px 0" }, wdCb, "Wikidata の項目も表示（記事のないもの）")),
    h("div", { class: "ri-row" }, h("div", { class: "ov-row" }, h("span"), h("div", {}, "ジャパンサーチ", h("small", {}, "地図の中心付近の資料（古写真・絵図・文書など）を探す"))),
      h("div", { class: "ri-opts" }, h("button", { type: "button", class: "btn secondary", onclick: () => openJapanSearch() }, "この付近の資料を探す"))));
  // 気象
  const elSel = h("select", {}, ...Object.entries(AM_ELEMS).map(([k, [n]]) => h("option", { value: k, selected: c.amedas.elem === k }, n)));
  elSel.onchange = () => { extraSave("amedas", { elem: elSel.value }); amedasRender(); };
  const ncSel = h("select", {}, h("option", { value: "0" }, "読み込み中…"));
  nowcTimes().then((ts) => {
    ncSel.replaceChildren(...ts.map((t) => h("option", { value: t.min, selected: t.min === c.nowc.t }, `${hm(new Date(utcOf(t.validtime)))}${t.min > 0 ? `（${t.min}分後・予測）` : t.min < 0 ? `（${-t.min}分前）` : "（最新）"}`)));
  }).catch(() => (ncSel.firstChild.textContent = "読み込めません"));
  ncSel.onchange = () => { extraSave("nowc", { t: Number(ncSel.value), on: true }); extraApply("nowc"); };
  body.append(h("div", { class: "sect-title" }, "気象（気象庁）"),
    row("amedas", "アメダス", "最新の観測値（10 分ごとに更新）。ズーム 8 以上", h("label", {}, "表示する値", elSel)),
    row("nowc", "降水ナウキャスト（雨雲）", "過去 1 時間と 1 時間先までの予測", h("label", {}, "時刻", ncSel)),
    h("p", { class: "note" }, "出典：今昔マップ on the web（谷謙二）、迅速測図：農研機構農業環境研究部門、国土地理院（地理院タイル）、Wikipedia（CC BY-SA）・Wikidata、気象庁ホームページ、ジャパンサーチ。表示中のレイヤの出典は地図の右下に出ます。"));
  openSheet("その他のレイヤ", body, { backdrop: false, height: "70vh" });
}
