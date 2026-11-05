/* e-Stat「地図で見る統計（統計GIS）」の町丁・字等／地域メッシュ統計を重ねる
 *
 * - 統計データ（CSV の ZIP）と町丁・字等の境界（シェープファイルの ZIP）は e-Stat の
 *   https://www.e-stat.go.jp/gis/statmap-search/data から取る。CORS に対応していないので中継サーバ（/estatgis/data）経由
 * - 町丁・字等は「地図に見えている市区町村」ごと、メッシュは「地図に見えている 1 次メッシュ（約 80 km 四方）」ごとに取る
 * - 取ったファイルは端末のキャッシュ（Cache Storage）に残すので、2 回目からは通信なしで出せる
 * 出典：政府統計の総合窓口（e-Stat）（政府標準利用規約に準拠。CC BY 4.0 互換）
 */
const ESG_UNITS = [
  ["town", "町丁・字"],
  ["m1", "1km メッシュ"],
  ["m500", "500m メッシュ"],
  ["m250", "250m メッシュ"],
];
const ESG_UNIT_NAME = Object.fromEntries(ESG_UNITS);
const ESG_UNIT_SHORT = { town: "町丁・字", m1: "1km", m500: "500m", m250: "250m" };
/** 町丁・字等の境界：国勢調査 小地域境界（一覧に境界の年 bnd があればそれ、なければ統計の年の直近の国勢調査） */
const esgBoundaryId = (lay) => `A00200521${lay.bnd || lay.year - (lay.year % 5)}`;
const ESG_CACHE = "fn-estatgis";

/** よく使う組み合わせ（項目名で探すので統計表が変わっても動く） */
const ESG_PRESETS = [
  { name: "人口", ds: /人口・世帯（|男女別人口.*世帯数|人口及び世帯/, num: /^(男女別人口（総数） \/ )?人口(（総数）|総数)$/, mode: "raw" },
  { name: "人口密度", ds: /人口・世帯（|男女別人口.*世帯数|人口及び世帯/, num: /^(男女別人口（総数） \/ )?人口(（総数）|総数)$/, mode: "density" },
  { name: "高齢化率（65 歳以上）", ds: /年齢|人口・世帯（|人口及び世帯/, num: /(^|\/ )(総数)?65歳以上(人口)?( ?総数)?$/, den: /^(総数、年齢「不詳」含む|(.* \/ )?人口(（総数）|総数))$/, mode: "ratio" },
  { name: "子どもの割合（15 歳未満）", ds: /年齢|人口・世帯（|人口及び世帯/, num: /(^|\/ )(総数15歳未満|0～14歳人口 ?総数)$/, den: /^(総数、年齢「不詳」含む|(.* \/ )?人口(（総数）|総数))$/, mode: "ratio" },
  { name: "単身世帯の割合", ds: /世帯人員/, num: /^世帯人員1人$/, den: /^一般世帯数/, mode: "ratio" },
  { name: "持ち家の割合", ds: /住宅の所有|住居の種類/, num: /持ち家/, den: /^(住宅に住む一般世帯|.*住宅に住む一般世帯.*)$/, mode: "ratio" },
  { name: "従業者数（事業所）", ds: /事業所数.*従業者数/, num: /^従業者数 \/ A～S全産業$/, mode: "raw" },
  { name: "2050 年の人口", ds: /将来推計人口 ?2050/, num: /^人口総数$/, mode: "raw" },
];

/* ---------- 取得（中継サーバ経由・端末キャッシュつき） ---------- */
const ESG_MAX_AGE = 90 * 864e5; // 端末に残したデータは 90 日で取り直す（通信できないときは古いものを使う）
/**
 * 統計GIS のファイルを取る。返り値 { blob, at }（at：中継サーバが e-Stat から取った日時。分からなければ端末が取った日時）
 * fresh：端末と中継サーバのキャッシュを使わずに e-Stat から取り直す
 */
async function esgFetch(params, { fresh = false } = {}) {
  const base = reinfoBase();
  if (!base) throw new Error("中継サーバの URL が未設定です（e-Stat の地図用データはブラウザから直接取れないため）。下の「中継サーバ」に設定してください");
  const url = `${base}/estatgis/data?${new URLSearchParams(params)}`;
  let cache = null, hit = null;
  try { cache = await caches.open(ESG_CACHE); hit = await cache.match(url); } catch {}
  const fromHit = async () => ({ blob: await hit.blob(), at: hit.headers.get("x-upstream-date") || hit.headers.get("x-fn-fetched") || null, cached: true });
  if (hit && !fresh) {
    const t = Date.parse(hit.headers.get("x-fn-fetched") || "");
    if ((Number.isFinite(t) && Date.now() - t < ESG_MAX_AGE) || !navigator.onLine) return fromHit();
  }
  let r;
  try { r = await fetch(fresh ? `${url}&fresh=1` : url, { cache: fresh ? "reload" : "default" }); }
  catch { if (hit) return fromHit(); throw new Error("中継サーバに接続できません（通信状態を確認してください）"); }
  if (r.status === 404) {
    const nodata = /estatgis/.test(await r.text().catch(() => ""));
    if (!nodata && hit) return fromHit();
    throw new Error(nodata ? "この地域のデータはありません" : "中継サーバが古いようです（/estatgis に未対応）。README の手順で Worker のコードを貼り直してください");
  }
  if (!r.ok) { if (hit) return fromHit(); throw new Error(`e-Stat から取得できませんでした（HTTP ${r.status}）`); }
  const blob = await r.blob();
  if (blob.size < 100 || !/zip|octet/.test(r.headers.get("Content-Type") || "zip")) throw new Error("この地域のデータはありません");
  const now = new Date().toISOString(), up = r.headers.get("X-Upstream-Date");
  const headers = { "Content-Type": "application/zip", "x-fn-fetched": now };
  if (up) headers["x-upstream-date"] = up;
  try { await cache?.put(url, new Response(blob, { headers })); } catch {}
  return { blob, at: up || now, cached: false };
}

/** 表示中のレイヤの鮮度の表示：「2020 年 国勢調査・2026-11-05 取得」 */
function esgFreshText(lay) {
  const at = lay.fetchedAt ? new Date(lay.fetchedAt) : null;
  const ds = at ? `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, "0")}-${String(at.getDate()).padStart(2, "0")}` : "";
  const newer = esgNewerSurvey(lay);
  return [`${lay.year} 年${lay.survey ? " " + lay.survey : ""}`, ds ? `${ds} に e-Stat から取得` : "", esgStale(lay) ? "取得から 90 日以上たっています" : "", newer ? `新しい調査（${newer} 年）があります` : ""].filter(Boolean).join("・");
}
const esgStale = (lay) => !!lay.fetchedAt && Date.now() - Date.parse(lay.fetchedAt) > ESG_MAX_AGE;
/** 同じ統計（同じ題名・同じ単位）で、より新しい年の表が一覧にあればその年 */
function esgNewerSurvey(lay) {
  const cur = ESTAT_GIS.find((d) => d.units[lay.area] === lay.statsId);
  if (!cur || /将来/.test(cur.title)) return null;
  // 題名が同じか、項目の並び（先頭 5 つ）が同じなら「同じ統計の新しい年」とみなす（自動で足した表は題名が e-Stat のままのため）
  const sig = (sid) => (ESTAT_GIS_ITEMS[sid] || []).slice(0, 5).map((x) => x[1].replace(/\s/g, "")).join("|");
  const mine = sig(lay.statsId);
  const ys = ESTAT_GIS.filter((d) => d.units[lay.area] && d.year > cur.year && d.survey === cur.survey && (d.title === cur.title || (mine && sig(d.units[lay.area]) === mine))).map((d) => d.year);
  return ys.length ? Math.max(...ys) : null;
}

/** 統計データの ZIP → { cols: [{code, idx, label}], rows: Map(key → {name, city, hyosyo, htk, htksaki, vals: [文字列]}) } */
async function esgReadTable(blob) {
  const z = await readZip(blob);
  const name = z.names.find((n) => /\.(txt|csv)$/i.test(n));
  if (!name) throw new Error("統計データの形式が読めません");
  const text = new TextDecoder("shift_jis").decode(await (await z.get(name)).arrayBuffer());
  const lines = text.split(/\r?\n/);
  const split = (l) => {
    if (!l.includes('"')) return l.split(",");
    const out = []; let cur = "", q = false;
    for (let i = 0; i < l.length; i++) {
      const c = l[i];
      if (q) { if (c === '"') { if (l[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
      else if (c === '"') q = true;
      else if (c === ",") { out.push(cur); cur = ""; }
      else cur += c;
    }
    out.push(cur);
    return out;
  };
  const head = split(lines[0]), labels = split(lines[1] || "");
  const at = (k) => head.indexOf(k);
  const iKey = at("KEY_CODE"), iH = at("HYOSYO"), iName = at("NAME") >= 0 ? at("NAME") : at("AZA_NAME"), iCity = at("CITYNAME") >= 0 ? at("CITYNAME") : at("CITY_NAME");
  const iHtk = at("HTKSYORI"), iSaki = at("HTKSAKI");
  const cols = [];
  head.forEach((c, i) => { const m = c.match(/^T\d{6}(\d{3})$/); if (m) cols.push({ code: c, idx: Number(m[1]), at: i, label: (labels[i] || "").replace(/　/g, " ").trim() }); });
  const rows = new Map();
  for (let k = 2; k < lines.length; k++) {
    if (!lines[k]) continue;
    const r = split(lines[k]);
    const key = r[iKey];
    if (!key) continue;
    rows.set(key, { name: iName >= 0 ? r[iName] : "", city: iCity >= 0 ? r[iCity] : "", hyosyo: iH >= 0 ? Number(r[iH]) : null, htk: iHtk >= 0 ? r[iHtk] : "", htksaki: iSaki >= 0 ? r[iSaki] : "", vals: cols.map((c) => r[c.at]) });
  }
  return { cols, rows };
}

/* ---------- シェープファイル（ポリゴン）→ GeoJSON。境界データ用の小さな読み手 ---------- */
function shpPolygons(buf) {
  const dv = new DataView(buf);
  const out = [];
  let p = 100;
  while (p + 8 <= dv.byteLength) {
    const len = dv.getInt32(p + 4) * 2; // ビッグエンディアン・16 ビット語
    const s = p + 8;
    p = s + len;
    if (len < 4) { out.push(null); continue; }
    const type = dv.getInt32(s, true);
    if (type !== 5 && type !== 15 && type !== 25) { out.push(null); continue; }
    const nParts = dv.getInt32(s + 36, true), nPts = dv.getInt32(s + 40, true);
    const parts = [];
    for (let i = 0; i < nParts; i++) parts.push(dv.getInt32(s + 44 + i * 4, true));
    const pts = s + 44 + nParts * 4;
    const rings = parts.map((st, i) => {
      const en = i + 1 < nParts ? parts[i + 1] : nPts, ring = [];
      for (let k = st; k < en; k++) ring.push([+dv.getFloat64(pts + k * 16, true).toFixed(7), +dv.getFloat64(pts + k * 16 + 8, true).toFixed(7)]);
      return ring;
    });
    // シェープファイルは外周が時計回り、穴が反時計回り。GeoJSON（外周が反時計回り）に向きを直して組む
    const area = (r) => { let a = 0; for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += (r[j][0] - r[i][0]) * (r[j][1] + r[i][1]); return a / 2; };
    const polys = [];
    for (const r of rings) {
      if (r.length < 4) continue;
      if (area(r) >= 0) polys.push([r.slice().reverse()]); // 時計回り＝外周
      else if (polys.length) polys[polys.length - 1].push(r.slice().reverse());
      else polys.push([r]);
    }
    out.push(polys.length === 1 ? { type: "Polygon", coordinates: polys[0] } : polys.length ? { type: "MultiPolygon", coordinates: polys } : null);
  }
  return out;
}
function dbfRecords(buf, enc = "shift_jis") {
  const dv = new DataView(buf), u8 = new Uint8Array(buf);
  const n = dv.getUint32(4, true), hl = dv.getUint16(8, true), rl = dv.getUint16(10, true);
  const dec = new TextDecoder(enc), fields = [];
  for (let o = 32; u8[o] !== 0x0d && o < hl; o += 32) {
    fields.push({ name: new TextDecoder().decode(u8.subarray(o, o + 11)).replace(/\0.*$/, ""), type: String.fromCharCode(u8[o + 11]), len: u8[o + 16] });
  }
  const out = [];
  for (let i = 0; i < n; i++) {
    let p = hl + i * rl + 1;
    const rec = {};
    for (const f of fields) {
      const s = dec.decode(u8.subarray(p, p + f.len)).trim();
      rec[f.name] = f.type === "N" || f.type === "F" ? (s === "" ? null : Number(s)) : s;
      p += f.len;
    }
    out.push(rec);
  }
  return out;
}
async function esgReadBoundary(blob) {
  const z = await readZip(blob);
  const shp = z.names.find((n) => /\.shp$/i.test(n)), dbf = z.names.find((n) => /\.dbf$/i.test(n));
  if (!shp || !dbf) throw new Error("境界データの形式が読めません");
  const cpg = z.names.find((n) => /\.cpg$/i.test(n));
  const enc = cpg && /utf-?8/i.test(await (await z.get(cpg)).text()) ? "utf-8" : "shift_jis";
  const geoms = shpPolygons(await (await z.get(shp)).arrayBuffer());
  const recs = dbfRecords(await (await z.get(dbf)).arrayBuffer(), enc);
  return recs.map((r, i) => ({ props: r, geometry: geoms[i] })).filter((f) => f.geometry);
}

/* ---------- 地図の範囲 → 取る単位（市区町村・1 次メッシュ） ---------- */
function esgViewSamples(nx = 3) {
  const b = S.map.getBounds(), out = [S.map.getCenter()];
  const s = b.getSouth(), n = b.getNorth(), w = b.getWest(), e = b.getEast();
  for (let i = 0; i < nx; i++) for (let j = 0; j < nx; j++) out.push(L.latLng(s + ((n - s) * (i + 0.5)) / nx, w + ((e - w) * (j + 0.5)) / nx));
  return out;
}
const ESG_MUNI = new Map(); // "lat,lon" → 市区町村コード
async function esgCitiesInView() {
  const codes = [];
  await Promise.all(esgViewSamples().map(async (ll, k) => {
    const key = `${ll.lat.toFixed(3)},${ll.lng.toFixed(3)}`;
    let code = ESG_MUNI.get(key);
    if (!code) {
      try {
        const r = await (await fetch(`https://mreversegeocoder.gsi.go.jp/reverse-geocoder/LonLatToAddress?lat=${ll.lat}&lon=${ll.lng}`)).json();
        code = r?.results?.muniCd ? String(r.results.muniCd).padStart(5, "0") : null;
        if (code) ESG_MUNI.set(key, code);
      } catch {}
    }
    if (code) codes[k] = code;
  }));
  return [...new Set(codes.filter(Boolean))].slice(0, 8); // 中心の市区町村が先頭
}
function esgMeshesInView() {
  const b = S.map.getBounds(), c = S.map.getCenter();
  const out = [];
  for (let la = Math.floor(b.getSouth() * 1.5); la <= Math.floor(b.getNorth() * 1.5); la++)
    for (let lo = Math.floor(b.getWest() - 100); lo <= Math.floor(b.getEast() - 100); lo++) out.push(`${la}${lo}`);
  const cc = `${Math.floor(c.lat * 1.5)}${Math.floor(c.lng - 100)}`;
  return out.sort((a, b2) => (a === cc ? -1 : b2 === cc ? 1 : 0));
}
const ESG_MAX_MESH = { m1: 9, m500: 4, m250: 2 };

/* ---------- 値の計算 ---------- */
/** "-" は 0、"*"・"X" などは秘匿（null） */
function esgNum(s) {
  if (s == null) return null;
  const t = String(s).trim();
  if (t === "-") return 0;
  const n = Number(t.replace(/,/g, ""));
  return t !== "" && Number.isFinite(n) ? n : null;
}
function esgValue(lay, row, areaKm2) {
  if (!row) return { v: null, raw: "" };
  if (row.htk === "1") return { v: null, raw: `秘匿（${row.htksaki || "近くの地域"} に合算）` };
  const a = esgNum(row.vals[lay.colAt]);
  if (a == null) return { v: null, raw: "秘匿" };
  if (lay.mode === "density") {
    if (!areaKm2) return { v: null, raw: "" };
    const v = a / areaKm2;
    return { v, raw: `${fmtNum(v)} ${lay.unit}（${a.toLocaleString("ja-JP")} ${lay.itemUnit} ÷ ${areaKm2 < 0.1 ? areaKm2.toFixed(3) : areaKm2.toFixed(2)} km²）` };
  }
  if (lay.mode === "ratio") {
    const b = esgNum(row.vals[lay.denAt]);
    if (!b) return { v: null, raw: b === 0 ? "分母が 0" : "秘匿" };
    const v = (a / b) * 100;
    return { v, raw: `${v.toFixed(1)} %（${a.toLocaleString("ja-JP")} ÷ ${b.toLocaleString("ja-JP")}）` };
  }
  return { v: a, raw: `${a.toLocaleString("ja-JP")} ${lay.itemUnit || ""}`.trim() };
}
const esgUnitLabel = (lay) => (lay.mode === "density" ? `${lay.itemUnit || ""}/km²` : lay.mode === "ratio" ? "%" : lay.itemUnit || "");

/** e-Stat 統計GIS レイヤの地物を作る（estatBuild から呼ばれる） */
async function esgBuild(lay, { fresh = false } = {}) {
  const feats = [];
  let matched = 0;
  const names = [], dates = [];
  const get = async (params) => { const r = await esgFetch(params, { fresh }); if (r.at) dates.push(r.at); return r.blob; };
  for (const code of lay.codes) {
    let tbl;
    try { tbl = await esgReadTable(await get({ statsId: lay.statsId, code, downloadType: "2" })); }
    catch (e) { if (/ありません/.test(e.message)) continue; throw e; }
    const ci = tbl.cols.findIndex((c) => c.idx === lay.col);
    if (ci < 0) throw new Error("選んだ項目がデータにありません");
    const L2 = { ...lay, colAt: ci, denAt: lay.den != null ? tbl.cols.findIndex((c) => c.idx === lay.den) : -1 };
    if (lay.area === "town") {
      const shapes = await esgReadBoundary(await get({ dlserveyId: esgBoundaryId(lay), code, coordSys: "1", format: "shape", downloadType: "5", datum: "2000" }));
      // 同じ地域が複数の形（飛び地など）に分かれていることがあるので、面積は地域ごとに合計
      const areaBy = new Map();
      for (const s of shapes) areaBy.set(s.props.KEY_CODE, (areaBy.get(s.props.KEY_CODE) || 0) + (s.props.AREA || 0));
      const city = tbl.rows.get(code)?.name || tbl.rows.get(code)?.city || shapes[0]?.props.CITY_NAME || code;
      names.push(city);
      for (const s of shapes) {
        const key = s.props.KEY_CODE, row = tbl.rows.get(key);
        const { v, raw } = esgValue(L2, row, (areaBy.get(key) || 0) / 1e6);
        if (v != null) matched++;
        feats.push({ type: "Feature", properties: { code: key, name: `${s.props.CITY_NAME || ""} ${s.props.S_NAME || row?.name || ""}`.trim(), v, raw, unit: "" }, geometry: s.geometry });
      }
    } else {
      names.push(code);
      for (const [key, row] of tbl.rows) {
        if (!/^\d{8,10}$/.test(key)) continue;
        const [w, s, e, n] = meshBounds(key);
        const areaKm2 = (n - s) * 111.32 * (e - w) * 111.32 * Math.cos((((s + n) / 2) * Math.PI) / 180);
        const { v, raw } = esgValue(L2, row, areaKm2);
        if (v != null) matched++;
        feats.push({ type: "Feature", properties: { code: key, name: `${ESG_UNIT_NAME[lay.area]} ${key}`, v, raw, unit: "" }, geometry: { type: "Polygon", coordinates: [[[w, s], [e, s], [e, n], [w, n], [w, s]]] } });
      }
    }
  }
  if (!feats.length) throw new Error("この範囲にはデータがありません");
  const nums = feats.map((f) => f.properties.v);
  // いちばん古いファイルの取得日を、このレイヤの「取得日」とする
  const fetchedAt = dates.sort()[0] || null;
  ES.data[lay.id] = { features: feats, breaks: estatClasses(nums), kind: lay.area === "town" ? "town" : "mesh", matched, names, fetchedAt };
  if (fetchedAt && estatCfg().layers.some((l) => l.id === lay.id && l.fetchedAt !== fetchedAt)) {
    estatSave({ layers: estatCfg().layers.map((l) => (l.id === lay.id ? { ...l, fetchedAt } : l)) });
  }
  return ES.data[lay.id];
}

/* ---------- 画面 ---------- */
function esgDatasets(unit) {
  return ESTAT_GIS.map((d, i) => ({ ...d, key: i })).filter((d) => d.units[unit]).sort((a, b) => b.year - a.year);
}
function esgItems(statsId) {
  return (ESTAT_GIS_ITEMS[statsId] || []).map(([idx, label, unit]) => ({ idx, label, unit }));
}
/** 統計を選ぶ：単位 → 統計表（テーマ別）→ 項目 */
function esgChooser() {
  const box = h("div");
  let unit = Settings.data.esgUnit || "town";
  const seg = h("div", { class: "seg seg-sm" });
  const list = h("div");
  const render = () => {
    seg.replaceChildren(...ESG_UNITS.map(([k, n]) => {
      const b = h("button", { type: "button", class: k === unit ? "on" : "" }, ESG_UNIT_SHORT[k]);
      b.onclick = () => { unit = k; Settings.data.esgUnit = k; Settings.save(); render(); };
      return b;
    }));
    const ds = esgDatasets(unit);
    // すぐ重ねる（よく使う組み合わせ）
    // 新しい年の統計表から順に、項目がそろうものを探す
    const presets = ESG_PRESETS.map((p) => {
      const latest = Math.max(...ds.filter((x) => !/将来/.test(x.title) && p.ds.test(x.title)).map((x) => x.year));
      for (const d of ds.filter((x) => p.ds.test(x.title) && (x.year === latest || /将来/.test(x.title)))) {
        const items = esgItems(d.units[unit]);
        const num = items.find((it) => p.num.test(it.label)), den = p.den ? items.find((it) => p.den.test(it.label)) : null;
        if (num && (!p.den || den)) return h("button", { type: "button", class: "chip", onclick: () => esgAdd({ d, unit, num, den, mode: p.mode, title: p.name }) }, p.name);
      }
      return null;
    }).filter(Boolean);
    // 新しい調査をテーマ別に。古い調査（2015 年など）はたたんでおく
    const latest = Math.max(...ds.filter((x) => !/将来/.test(x.title)).map((x) => x.year));
    const groupList = (arr) => {
      const groups = new Map();
      for (const d of arr) { if (!groups.has(d.theme)) groups.set(d.theme, []); groups.get(d.theme).push(d); }
      return [...groups].map(([theme, items]) => h("div", { class: "esg-group" }, h("div", { class: "msec-meta", style: "margin:10px 0 4px" }, theme),
        ...items.map((d) => {
          const b = h("button", { type: "button", class: "esg-ds" },
            h("span", { class: "t" }, d.title), h("span", { class: "s" }, `${d.survey}・${d.year} 年・${esgItems(d.units[unit]).length} 項目`));
          b.onclick = () => esgOpenTable(d, unit);
          return b;
        })));
    };
    const cur = ds.filter((d) => d.year >= latest || /将来/.test(d.title)), old = ds.filter((d) => !cur.includes(d));
    list.replaceChildren(
      presets.length ? h("div", { class: "esg-quick" }, h("div", { class: "msec-meta", style: "margin:8px 0 4px" }, `すぐ重ねる（${d0(ds)}・今見ている範囲）`), h("div", { class: "chips" }, ...presets)) : "",
      ...groupList(cur),
      old.length ? h("details", { class: "esg-old" }, h("summary", {}, `前の調査（${[...new Set(old.map((d) => d.year))].join("・")} 年）の統計`), ...groupList(old)) : "");
  };
  const d0 = (ds) => { const y = Math.max(...ds.filter((x) => !/将来/.test(x.title)).map((x) => x.year)); return Number.isFinite(y) ? `${y} 年` : ""; };
  render();
  box.append(h("div", { class: "esg-unit" }, h("span", {}, "単位"), seg, h("span", { class: "esg-mesh-note" }, "右の 3 つはメッシュ（正方形の区画）")), list);
  return box;
}

/** 統計表を選んだ後：項目・表し方を選んで重ねる */
function esgOpenTable(d, unit) {
  const statsId = d.units[unit];
  const items = esgItems(statsId);
  const groups = new Map();
  for (const it of items) {
    const g = it.label.includes(" / ") ? it.label.split(" / ").slice(0, -1).join(" / ") : "";
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(it);
  }
  const mkSel = (sel) => h("select", {}, ...[...groups].map(([g, arr]) => {
    const opts = arr.map((it) => h("option", { value: it.idx, selected: it.idx === sel }, `${it.label.split(" / ").pop()}（${it.unit}）`));
    return g ? h("optgroup", { label: g }, ...opts) : opts;
  }).flat());
  const numSel = mkSel(items[0]?.idx);
  const denSel = mkSel(items[0]?.idx);
  let mode = "raw";
  const modeSeg = h("div", { class: "seg seg-sm" });
  const denRow = h("label", { hidden: true }, "分母（割合のもとにする項目）", denSel);
  const renderMode = () => {
    modeSeg.replaceChildren(...[["raw", "数"], ["density", "面積あたり（/km²）"], ["ratio", "割合（%）"]].map(([k, n]) => {
      const b = h("button", { type: "button", class: k === mode ? "on" : "" }, n);
      b.onclick = () => { mode = k; denRow.hidden = mode !== "ratio"; renderMode(); };
      return b;
    }));
  };
  renderMode();
  const status = h("div", { class: "note" });
  const addBtn = h("button", { type: "button", class: "btn primary block" }, "今見ている範囲に重ねる");
  addBtn.onclick = async () => {
    const num = items.find((it) => it.idx === Number(numSel.value)), den = items.find((it) => it.idx === Number(denSel.value));
    addBtn.disabled = true;
    const ok = await esgAdd({ d, unit, num, den: mode === "ratio" ? den : null, mode, status });
    if (!ok) addBtn.disabled = false;
  };
  openSheet("統計の項目を選ぶ", h("div", {},
    h("button", { type: "button", class: "chip vt-back", onclick: openEstatSheet }, "← 統計の一覧に戻る"),
    h("div", { class: "pt", style: "font-weight:700;margin:4px 0 2px" }, d.title),
    h("div", { class: "note", style: "margin-top:0" }, `${d.survey}・${d.year} 年・${ESG_UNIT_NAME[unit]}単位（${statsId}）`),
    h("label", {}, "塗り分ける項目", numSel),
    h("div", { class: "msec-meta", style: "margin:10px 0 4px" }, "表し方"), modeSeg, denRow,
    h("p", { class: "note" }, unit === "town" ? "今見ている地図の範囲にかかる市区町村（最大 8）の町丁・字ごとに塗り分けます。" : `今見ている地図の範囲にかかる 1 次メッシュ（約 80 km 四方。最大 ${ESG_MAX_MESH[unit]} 枚）の${ESG_UNIT_NAME[unit]}を塗り分けます。`),
    addBtn, status), { backdrop: false, height: "75vh" });
}

const esgSelText = (base, names) => `${base}・${names.slice(0, 3).join("・")}${names.length > 3 ? ` ほか ${names.length - 3}` : ""}`;
/** レイヤを作って重ねる */
async function esgAdd({ d, unit, num, den, mode, title, status }) {
  const say = (t) => (status ? (status.textContent = t) : toast(t, 30000));
  try {
    if (!reinfoBase()) throw new Error("中継サーバの URL を先に設定してください（e-Stat 統計の画面の「中継サーバ」）");
    say(unit === "town" ? "地図の範囲の市区町村を調べています…" : "データを取得中…");
    let codes;
    if (unit === "town") {
      if (S.map.getZoom() < 9) throw new Error("地図を市区町村が分かるくらいまで拡大してください（ズーム 9 以上）");
      codes = await esgCitiesInView();
      if (!codes.length) throw new Error("地図の範囲の市区町村が分かりませんでした（海の上など）");
    } else {
      codes = esgMeshesInView();
      if (codes.length > ESG_MAX_MESH[unit]) throw new Error(`範囲が広すぎます。もう少し拡大してください（${ESG_UNIT_NAME[unit]}は 1 次メッシュ ${ESG_MAX_MESH[unit]} 枚まで）`);
    }
    say(`データを取得中…（${unit === "town" ? `${codes.length} 市区町村` : `${codes.length} 区画`}）`);
    const parts = [num.label.split(" / ").pop()];
    if (mode === "density") parts.push("面積あたり");
    if (mode === "ratio") parts.push(`÷ ${den.label.split(" / ").pop()}`);
    const lay = {
      id: uuid().slice(0, 8), src: "gis", statsId: d.units[unit], area: unit, year: d.year, bnd: d.bnd || null, survey: d.survey, codes,
      col: num.idx, den: den ? den.idx : null, mode, itemUnit: num.unit,
      title: title ? `${title}（${d.year}）` : `${d.title}（${d.year}）`,
      selBase: `${parts.join(" ")}・${ESG_UNIT_NAME[unit]}`,
      on: true, opacity: 0.7, ramp: mode === "ratio" ? "red" : mode === "density" ? "purple" : "blue",
    };
    lay.unit = esgUnitLabel(lay); // 凡例に出す値の単位
    const built = await esgBuild(lay);
    if (!built.matched) throw new Error("この範囲には値のある地域がありませんでした");
    lay.selText = esgSelText(lay.selBase, built.names);
    lay.fetchedAt = built.fetchedAt;
    estatSave({ layers: [...estatCfg().layers, lay] });
    await estatApplyOne(lay);
    closeSheet(true);
    toast(`${built.matched.toLocaleString("ja-JP")} 地域を塗り分けました`);
    return true;
  } catch (e) {
    if (status) status.textContent = e.message; else toast(e.message, 5000);
    return false;
  }
}
