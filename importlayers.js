/* フィールドノート — ファイルを地図に重ねる
 * 対応：GeoJSON・KML・jSTAT MAP の .gsf・Parquet / GeoParquet・基盤地図情報（基本項目の ZIP / XML）
 * 属性表（CSV・TSV・JSON・Parquet など）をキーで結合してから重ねることもできる。
 * 描画は datalayers.js の MapLibre の重ね合わせ（1 枚の WebGL）に載せる。データは IndexedDB に保存。
 *
 * .gsf・KML・基盤地図情報の読み取りと Parquet の図形の解釈は、Vector Studio v3.4 の取込パーサを移植・簡略化したもの。
 */
"use strict";

const HYPARQUET = "https://cdn.jsdelivr.net/npm/hyparquet@1.31.5/+esm";
const HYPARQUET_COMP = "https://cdn.jsdelivr.net/npm/hyparquet-compressors@1.1.2/+esm";
const IM_LIMITS = { features: 300000, vertices: 3000000, parquetRows: 50000, fileSize: 300 * 1048576 };
const IM_FONT = ["NotoSansJP-Regular"];
const IM_COLORS = ["#e15759", "#4e79a7", "#f28e2b", "#59a14f", "#b07aa1", "#76b7b2", "#edc948", "#ff9da7", "#9c755f"];

/* 基盤地図情報（基本項目）：項目と配色（Vector Studio と同じ） */
const FGD_JA = {
  BldA: "建築物", BldL: "建築物の外周線", RdEdg: "道路縁", RdCompt: "道路構成線", RdArea: "道路域", RdASL: "道路域分割線",
  RailCL: "軌道の中心線", WA: "水域", WL: "水涯線", WStrA: "水部構造物面", WStrL: "水部構造物線", Cstline: "海岸線",
  AdmArea: "行政区画", AdmBdry: "行政区画界線", AdmPt: "行政区画代表点", CommBdry: "町字界線", CommPt: "町字の代表点",
  SBArea: "街区域", SBBdry: "街区界線", SBAPt: "街区の代表点", Cntr: "等高線", ElevPt: "標高点", GCP: "測量の基準点",
};
const FGD_GROUPS = [
  { id: "bld", label: "建築物", keys: ["BldA"], on: true },
  { id: "bldl", label: "建築物の外周線", keys: ["BldL"], on: false },
  { id: "road", label: "道路", keys: ["RdEdg", "RdCompt", "RdArea", "RdASL"], on: true },
  { id: "rail", label: "鉄道", keys: ["RailCL"], on: true },
  { id: "water", label: "水部・海岸線", keys: ["WA", "WL", "WStrA", "WStrL", "Cstline"], on: true },
  { id: "adm", label: "行政区画・町字・街区", keys: ["AdmArea", "AdmBdry", "AdmPt", "CommBdry", "CommPt", "SBArea", "SBBdry", "SBAPt"], on: true },
  { id: "cntr", label: "等高線", keys: ["Cntr"], on: true },
  { id: "elev", label: "標高点", keys: ["ElevPt"], on: true },
  { id: "gcp", label: "測量の基準点", keys: ["GCP"], on: true },
  { id: "other", label: "その他の項目", keys: [], on: true },
];
// [色, 不透明度, 線幅（点は半径 px）]
const FGD_STYLE = {
  BldA: ["#9aa39c", 0.85, 1], BldL: ["#6f7a72", 0.9, 1], RdEdg: ["#c99a3b", 0.9, 1], RdCompt: ["#d9b25f", 0.8, 1], RdArea: ["#f1e3bf", 0.7, 1],
  RdASL: ["#c8b27a", 0.7, 0.8], RailCL: ["#59697a", 0.95, 1.6], WA: ["#9ccbe3", 0.8, 1], WL: ["#4f97c2", 0.9, 1], WStrA: ["#7fb0c9", 0.8, 1],
  WStrL: ["#3e7fa6", 0.9, 1], Cstline: ["#2f6f9f", 0.95, 1.4], AdmArea: ["#f4f1e9", 0.5, 1], AdmBdry: ["#8e6aa8", 0.9, 1.4], AdmPt: ["#8e6aa8", 0.95, 3],
  CommBdry: ["#a98bbd", 0.8, 1], CommPt: ["#a98bbd", 0.9, 2.5], SBArea: ["#ece6f2", 0.45, 1], SBBdry: ["#bfaecd", 0.8, 0.8], SBAPt: ["#bfaecd", 0.9, 2],
  Cntr: ["#9b7b55", 0.8, 0.8], ElevPt: ["#7a4e2d", 0.95, 3], GCP: ["#d0453a", 0.95, 3],
};
const fgdGroupOf = (k) => (FGD_GROUPS.find((g) => g.keys.includes(k)) || FGD_GROUPS[FGD_GROUPS.length - 1]).id;

/* ====================================================================
 * 読み取り：共通の形 { name, kind, features: GeoJSON Feature[], classField?, classes? }
 * ==================================================================== */
const ptFeat = (c, p) => ({ type: "Feature", properties: p, geometry: { type: "Point", coordinates: c } });
const okLonLat = ([x, y]) => Number.isFinite(x) && Number.isFinite(y) && Math.abs(x) <= 180 && Math.abs(y) <= 85.06;

/** 文字コードを推定して読む（UTF-8 → だめなら Shift_JIS） */
function imDecodeText(buf) {
  const u8 = new Uint8Array(buf);
  let t = new TextDecoder("utf-8").decode(u8);
  if (t.includes("�")) { try { t = new TextDecoder("shift_jis").decode(u8); } catch {} }
  return t.charCodeAt(0) === 0xfeff ? t.slice(1) : t;
}

/** GeoJSON（経緯度か確認） */
function imParseGeoJSON(o, name) {
  const crs = o.crs?.properties?.name;
  if (crs && !/CRS84|EPSG:+(4326|6668|4612|4019)$/i.test(String(crs))) throw new Error(`座標系（${crs}）が経緯度ではありません。WGS84・JGD2011 の経緯度で書き出してください`);
  const feats = o.type === "FeatureCollection" ? o.features || [] : o.type === "Feature" ? [o] : o.type && o.coordinates ? [{ type: "Feature", properties: {}, geometry: o }] : null;
  if (!feats) throw new Error("GeoJSON ではありません");
  const out = feats.filter((f) => f && f.geometry).map((f) => ({ type: "Feature", properties: { ...(f.properties || {}) }, geometry: f.geometry }));
  return { name: String(o.name || name).slice(0, 80), kind: "geojson", features: out };
}

/** KML */
function imParseKml(text, name) {
  const doc = new DOMParser().parseFromString(text, "application/xml");
  if (doc.getElementsByTagName("parsererror").length) throw new Error("KML を XML として読めません");
  const coords = (el) => String(el.textContent || "").trim().split(/\s+/).map((t) => t.split(",").map(Number).slice(0, 2)).filter(okLonLat);
  const features = [];
  for (const pm of doc.getElementsByTagName("Placemark")) {
    const props = {};
    const nm = pm.getElementsByTagName("name")[0];
    if (nm) props["名称"] = String(nm.textContent || "").trim().slice(0, 120);
    const desc = pm.getElementsByTagName("description")[0];
    if (desc) props["説明"] = String(desc.textContent || "").replace(/<[^>]+>/g, " ").trim().slice(0, 300);
    for (const sd of pm.getElementsByTagName("SimpleData")) props[sd.getAttribute("name") || "値"] = String(sd.textContent || "").trim();
    for (const d of pm.getElementsByTagName("Data")) { const v = d.getElementsByTagName("value")[0]; props[d.getAttribute("name") || "値"] = v ? String(v.textContent || "").trim() : ""; }
    for (const poly of pm.getElementsByTagName("Polygon")) {
      const rings = [];
      for (const tag of ["outerBoundaryIs", "innerBoundaryIs"]) for (const b of poly.getElementsByTagName(tag)) for (const c of b.getElementsByTagName("coordinates")) rings.push(coords(c));
      if (rings.length && rings[0].length > 2) features.push({ type: "Feature", properties: props, geometry: { type: "Polygon", coordinates: rings } });
    }
    for (const ls of pm.getElementsByTagName("LineString")) for (const c of ls.getElementsByTagName("coordinates")) {
      const r = coords(c);
      if (r.length > 1) features.push({ type: "Feature", properties: props, geometry: { type: "LineString", coordinates: r } });
    }
    for (const pt of pm.getElementsByTagName("Point")) for (const c of pt.getElementsByTagName("coordinates")) {
      const r = coords(c);
      if (r.length) features.push(ptFeat(r[0], props));
    }
  }
  if (!features.length) throw new Error("KML から図形を取り出せませんでした");
  const dn = doc.getElementsByTagName("Document")[0]?.getElementsByTagName("name")[0];
  return { name: (dn ? String(dn.textContent).trim() : name).slice(0, 80), kind: "kml", features };
}

/* ---------- jSTAT MAP の .gsf（中身は「JSON・SQLite・JSON」の 3 区画。形状の形式は非公式の解析による） ---------- */
function imSqliteRead(bytes) {
  if (new TextDecoder().decode(bytes.subarray(0, 15)) !== "SQLite format 3") throw new Error(".gsf 内の統計データ（SQLite）を認識できません");
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let pageSize = dv.getUint16(16);
  if (pageSize === 1) pageSize = 65536;
  const usable = pageSize - bytes[20];
  const page = (no) => bytes.subarray((no - 1) * pageSize, no * pageSize);
  const varint = (buf, off) => {
    let v = 0n, i = 0;
    for (; i < 8; i++) { const b = buf[off + i]; v = (v << 7n) | BigInt(b & 0x7f); if (!(b & 0x80)) return [v, i + 1]; }
    return [(v << 8n) | BigInt(buf[off + 8]), 9];
  };
  const payload = (buf, cellOff) => {
    let off = cellOff;
    const [sz, n1] = varint(buf, off); off += n1;
    const [r, n2] = varint(buf, off); off += n2;
    const total = Number(sz), X = usable - 35;
    let local = total;
    if (total > X) { const M = Math.floor(((usable - 12) * 32) / 255) - 23, K = M + ((total - M) % (usable - 4)); local = K <= X ? K : M; }
    const out = new Uint8Array(total);
    out.set(buf.subarray(off, off + local), 0);
    let filled = local;
    if (total > local) {
      let next = new DataView(buf.buffer, buf.byteOffset, buf.byteLength).getUint32(off + local, false);
      while (next && filled < total) {
        const p = page(next), take = Math.min(usable - 4, total - filled);
        out.set(p.subarray(4, 4 + take), filled);
        filled += take;
        next = new DataView(p.buffer, p.byteOffset, p.byteLength).getUint32(0, false);
      }
    }
    return { rowid: Number(r), record: out };
  };
  const decodeRecord = (rec) => {
    const dvr = new DataView(rec.buffer, rec.byteOffset, rec.byteLength);
    const [hdr, n] = varint(rec, 0);
    const hdrSize = Number(hdr);
    let off = n;
    const types = [], vals = [];
    while (off < hdrSize) { const [t, k] = varint(rec, off); off += k; types.push(Number(t)); }
    let p = hdrSize;
    for (const t of types) {
      if (t === 0) vals.push(null);
      else if (t >= 1 && t <= 6) {
        const len = [0, 1, 2, 3, 4, 6, 8][t];
        let v = 0n;
        for (let i = 0; i < len; i++) v = (v << 8n) | BigInt(rec[p + i]);
        const bits = BigInt(len * 8);
        if (v >= 1n << (bits - 1n)) v -= 1n << bits;
        vals.push(Number(v)); p += len;
      } else if (t === 7) { vals.push(dvr.getFloat64(p, false)); p += 8; }
      else if (t === 8) vals.push(0);
      else if (t === 9) vals.push(1);
      else if (t >= 12 && t % 2 === 0) { const len = (t - 12) / 2; vals.push(rec.subarray(p, p + len)); p += len; }
      else { const len = (t - 13) / 2; vals.push(new TextDecoder().decode(rec.subarray(p, p + len))); p += len; }
    }
    return vals;
  };
  const walk = (pageNo, rows, depth) => {
    if (depth > 24 || pageNo < 1) return;
    const p = page(pageNo);
    if (!p.length) return;
    const hd = pageNo === 1 ? 100 : 0, type = p[hd];
    const pdv = new DataView(p.buffer, p.byteOffset, p.byteLength);
    const nCells = pdv.getUint16(hd + 3, false);
    if (type === 0x0d) {
      for (let i = 0; i < nCells; i++) { const { rowid, record } = payload(p, pdv.getUint16(hd + 8 + 2 * i, false)); rows.push({ rowid, values: decodeRecord(record) }); }
    } else if (type === 0x05) {
      for (let i = 0; i < nCells; i++) walk(pdv.getUint32(pdv.getUint16(hd + 12 + 2 * i, false), false), rows, depth + 1);
      walk(pdv.getUint32(hd + 8, false), rows, depth + 1);
    }
  };
  const master = [];
  walk(1, master, 0);
  const tables = {};
  for (const r of master) {
    const [type, name, , root, sql] = r.values;
    if (type !== "table" || typeof sql !== "string") continue;
    const m = sql.match(/\(([\s\S]*)\)\s*$/);
    let cols = [];
    if (m) {
      let depth = 0, cur = "";
      const parts = [];
      for (const ch of m[1]) {
        if (ch === "(") depth++;
        if (ch === ")") depth--;
        if (ch === "," && depth === 0) { parts.push(cur); cur = ""; } else cur += ch;
      }
      parts.push(cur);
      cols = parts.map((s) => s.trim()).filter((s) => s && !/^(primary|unique|check|foreign|constraint)\b/i.test(s)).map((s) => (s.match(/^["`[]?([^"`\]\s]+)/) || [])[1]);
    }
    tables[name] = { root: Number(root), columns: cols };
  }
  return {
    rows(name) {
      const t = tables[name];
      if (!t) throw new Error("テーブル " + name + " が見つかりません");
      const out = [];
      walk(t.root, out, 0);
      return out.map((r) => Object.fromEntries(t.columns.map((c, i) => [c, r.values[i] === undefined ? null : r.values[i]])));
    },
  };
}
function imGsfShape(u8) {
  if (!u8 || u8.length < 21) return [];
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const tryParse = (headerLen) => {
    let off = headerLen, guard = 0;
    const rings = [];
    while (off + 5 <= u8.length && guard++ < 4096) {
      const n = dv.getUint32(off + 1, false);
      if (n < 2 || n > 2000000 || off + 5 + n * 16 > u8.length) break;
      let p = off + 5;
      const ring = [];
      for (let i = 0; i < n; i++) { ring.push([dv.getFloat64(p, false) / 3600, dv.getFloat64(p + 8, false) / 3600]); p += 16; }
      rings.push(ring);
      off = p;
    }
    return rings;
  };
  const ok = (rings) => rings.length && rings.every((r) => r.every(okLonLat));
  let rings = tryParse(5);
  if (!ok(rings)) for (const hl of [0, 4, 6, 8, 9]) { const r = tryParse(hl); if (ok(r)) { rings = r; break; } }
  return ok(rings) ? rings : [];
}
const imRgb = (v) => {
  if (typeof v !== "string") return null;
  const m = v.split(",").map((s) => parseInt(s.trim(), 10));
  if (m.length < 3 || m.some((n) => !Number.isFinite(n))) return null;
  return "#" + m.slice(0, 3).map((n) => Math.max(0, Math.min(255, n)).toString(16).padStart(2, "0")).join("");
};
function imGsfSections(buffer) {
  const dv = new DataView(buffer), u8 = new Uint8Array(buffer), secs = [];
  let off = 0;
  while (off + 4 <= buffer.byteLength) {
    const n = dv.getUint32(off, true);
    off += 4;
    if (n <= 0 || off + n > buffer.byteLength) break;
    secs.push(u8.subarray(off, off + n));
    off += n;
  }
  if (secs.length < 2) throw new Error(".gsf の構造（3 区画）を認識できません");
  return secs;
}
function imParseGsf(buffer, name) {
  const secs = imGsfSections(buffer), td = new TextDecoder();
  let meta = {}, style = null;
  try { meta = JSON.parse(td.decode(secs[0])); } catch {}
  if (secs[2]) try { style = JSON.parse(td.decode(secs[2])); } catch {}
  const rows = imSqliteRead(secs[1]).rows("GRAPH_DATA");
  const attrs = {};
  for (const a of meta.dataAttrs || []) attrs["A" + String(a.id).padStart(4, "0")] = a.name || "A" + a.id;
  const features = [];
  for (const r of rows) {
    const rings = imGsfShape(r.Shape);
    const props = {};
    if (r.Name != null && r.Name !== "") props["名称"] = r.Name;
    if (r.Code != null) props["コード"] = String(r.Code);
    for (const k in r) if (/^A\d{4}$/.test(k) && r[k] != null && !(r[k] instanceof Uint8Array)) props[attrs[k] || k] = r[k];
    if (!rings.length) {
      const lat = r.CenterLat, lon = r.CenterLon;
      if (Number.isFinite(lat) && Number.isFinite(lon) && lat !== 0) features.push(ptFeat([lon / 3600000, lat / 3600000], props));
      continue;
    }
    // 複数のリングは飛び地として扱う（穴の区別は .gsf からは分からない）
    features.push({ type: "Feature", properties: props, geometry: rings.length === 1 ? { type: "Polygon", coordinates: rings } : { type: "MultiPolygon", coordinates: rings.map((r) => [r]) } });
  }
  if (!features.length) throw new Error(".gsf から図形を取り出せませんでした");
  // jSTAT MAP の階級区分（RankHatchColor）があれば、その色分けを使う
  let classes = null, classField = null;
  const visit = (o) => {
    if (!o || typeof o !== "object") return;
    if (Array.isArray(o)) return o.forEach(visit);
    if (o.kind === "RankHatchColor" && Array.isArray(o.conditions) && o.conditions.length) {
      classField = o.rankAttrName || o.conditions[0].attrName || null;
      const cs = o.conditions.map((c) => ({ min: Number(String(c.compValue).trim()), color: imRgb(c.value) })).filter((c) => Number.isFinite(c.min) && c.color);
      if (cs.length) classes = cs.sort((a, b) => a.min - b.min);
    }
    for (const k in o) visit(o[k]);
  };
  visit(style);
  return { name: String(meta.name || name).slice(0, 80), kind: "gsf", features, classField, classes };
}
/** .gsf の全地域を囲む範囲（範囲ファイルの読み込み用） */
function imGsfBox(buffer) {
  const f = imParseGsf(buffer, "gsf").features;
  return imBbox(f);
}

/* ---------- Parquet / GeoParquet（hyparquet を必要な時だけ読み込む） ---------- */
let pqLib = null;
async function imLoadParquetLib() {
  if (pqLib) return pqLib;
  const lib = await import(HYPARQUET).catch(() => { throw new Error("Parquet 解析ライブラリを読み込めません（オフライン？）"); });
  let comp = null;
  try { comp = (await import(HYPARQUET_COMP)).compressors; } catch {}
  return (pqLib = { lib, comp });
}
function imWkb(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  let off = 0;
  const out = [];
  const one = (depth) => {
    if (depth > 10) throw new Error("WKB の入れ子が深すぎます");
    const le = dv.getUint8(off) === 1;
    off += 1;
    const raw = dv.getUint32(off, le);
    off += 4;
    let hasZ = (raw & 0x80000000) !== 0, hasM = (raw & 0x40000000) !== 0, t = raw & 0x0fffffff;
    if (raw & 0x20000000) off += 4;
    if (t >= 3000) { hasZ = hasM = true; t -= 3000; } else if (t >= 2000) { hasM = true; t -= 2000; } else if (t >= 1000) { hasZ = true; t -= 1000; }
    const dims = 2 + (hasZ ? 1 : 0) + (hasM ? 1 : 0);
    const pt = () => { const p = [dv.getFloat64(off, le), dv.getFloat64(off + 8, le)]; off += 8 * dims; return p; };
    const cnt = () => { const n = dv.getUint32(off, le); off += 4; return n; };
    const ring = () => { const n = cnt(), r = []; for (let i = 0; i < n; i++) r.push(pt()); return r; };
    if (t === 1) out.push({ type: "Point", coordinates: pt() });
    else if (t === 2) out.push({ type: "LineString", coordinates: ring() });
    else if (t === 3) { const n = cnt(), rs = []; for (let i = 0; i < n; i++) rs.push(ring()); out.push({ type: "Polygon", coordinates: rs }); }
    else if (t >= 4 && t <= 7) { const n = cnt(); for (let i = 0; i < n; i++) one(depth + 1); }
    else throw new Error("未対応の WKB 形状：" + t);
  };
  one(0);
  return out;
}
function imWkt(s) {
  const m = s.trim().match(/^(\w+)\s*(?:Z|M|ZM)?\s*\(([\s\S]*)\)$/i);
  if (!m) throw new Error("WKT を解釈できません");
  const type = m[1].toUpperCase();
  const nums = (t) => t.trim().split(/\s*,\s*/).map((p) => p.trim().split(/\s+/).slice(0, 2).map(Number));
  const groups = (t) => { const out = []; let d = 0, st = -1; for (let i = 0; i < t.length; i++) { if (t[i] === "(") { if (d++ === 0) st = i + 1; } else if (t[i] === ")") { if (--d === 0) out.push(t.slice(st, i)); } } return out; };
  if (type === "POINT") return [{ type: "Point", coordinates: nums(m[2])[0] }];
  if (type === "LINESTRING") return [{ type: "LineString", coordinates: nums(m[2]) }];
  if (type === "POLYGON") return [{ type: "Polygon", coordinates: groups(m[2]).map(nums) }];
  if (type === "MULTIPOINT") return nums(m[2].replace(/[()]/g, "")).map((c) => ({ type: "Point", coordinates: c }));
  if (type === "MULTILINESTRING") return groups(m[2]).map((g) => ({ type: "LineString", coordinates: nums(g) }));
  if (type === "MULTIPOLYGON") return groups(m[2]).map((p) => ({ type: "Polygon", coordinates: groups(p).map(nums) }));
  throw new Error("未対応の WKT：" + type);
}
function imGeoArrow(v, enc) {
  const P = (p) => (Array.isArray(p) ? p.slice(0, 2).map(Number) : p && typeof p === "object" ? [Number(p.x ?? p.lon), Number(p.y ?? p.lat)] : null);
  const L = (a) => (Array.isArray(a) ? a.map(P).filter(Boolean) : []);
  switch (enc) {
    case "point": return [{ type: "Point", coordinates: P(v) }];
    case "multipoint": return L(v).map((c) => ({ type: "Point", coordinates: c }));
    case "linestring": return [{ type: "LineString", coordinates: L(v) }];
    case "multilinestring": return v.map((r) => ({ type: "LineString", coordinates: L(r) }));
    case "polygon": return [{ type: "Polygon", coordinates: v.map(L) }];
    case "multipolygon": return v.map((p) => ({ type: "Polygon", coordinates: p.map(L) }));
    default: throw new Error("未対応の GeoArrow：" + enc);
  }
}
function imScalar(v) {
  if (v == null) return null;
  if (typeof v === "bigint") { const n = Number(v); return Number.isSafeInteger(n) ? n : String(v); }
  if (v instanceof Date) return isNaN(v) ? null : v.toISOString();
  if (ArrayBuffer.isView(v) || v instanceof ArrayBuffer) return null;
  if (typeof v === "object") { try { return JSON.stringify(v).slice(0, 2000); } catch { return null; } }
  return typeof v === "string" ? v.slice(0, 2000) : v;
}
async function imReadParquetRows(file) {
  const { lib, comp } = await imLoadParquetLib();
  const size = file.size;
  const buf = { byteLength: size, slice: async (s, e) => file.slice(s, e ?? size).arrayBuffer() };
  const meta = await lib.parquetMetadataAsync(buf);
  const total = Number(meta.num_rows ?? 0);
  const rowEnd = Math.min(total || IM_LIMITS.parquetRows, IM_LIMITS.parquetRows);
  const opts = { file: buf, rowStart: 0, rowEnd, utf8: true, ...(comp ? { compressors: comp } : {}) };
  const rows = lib.parquetReadObjects ? await lib.parquetReadObjects(opts)
    : await new Promise((res, rej) => { const p = lib.parquetRead({ ...opts, rowFormat: "object", onComplete: res }); if (p?.catch) p.catch(rej); });
  let geo = null;
  for (const e of meta.key_value_metadata || []) if (e?.key === "geo") { try { geo = JSON.parse(e.value); } catch {} }
  return { rows, geo, total, truncated: total > rowEnd };
}
async function imParseParquet(file) {
  const { rows, geo, total, truncated } = await imReadParquetRows(file);
  if (!rows.length) throw new Error("Parquet に行がありません");
  const keys = Object.keys(rows[0]);
  let col = null, enc = "wkb", latCol = null, lonCol = null;
  if (geo?.columns) {
    col = geo.columns[geo.primary_column] ? geo.primary_column : Object.keys(geo.columns)[0];
    enc = String(geo.columns[col]?.encoding || "WKB").toLowerCase();
  } else {
    col = keys.find((k) => ["geometry", "geom", "the_geom", "wkb_geometry", "wkb", "wkt", "shape", "geo", "図形"].includes(String(k).toLowerCase())) || null;
    if (!col) {
      latCol = keys.find((k) => ["lat", "latitude", "y", "緯度"].includes(String(k).toLowerCase()));
      lonCol = keys.find((k) => ["lon", "lng", "long", "longitude", "x", "経度"].includes(String(k).toLowerCase()));
      if (!latCol || !lonCol) throw new Error("図形の列が見つかりません（GeoParquet の geo メタデータ、geometry 列、または lat・lon 列が必要）");
    }
  }
  const features = [];
  let bad = 0;
  for (const row of rows) {
    let geoms;
    try {
      if (latCol) geoms = [{ type: "Point", coordinates: [Number(row[lonCol]), Number(row[latCol])] }];
      else {
        const v = row[col];
        if (v == null) continue;
        if (enc !== "wkb" && enc !== "wkt") geoms = imGeoArrow(v, enc);
        else if (ArrayBuffer.isView(v) || v instanceof ArrayBuffer) geoms = imWkb(v);
        else if (typeof v === "string") geoms = v.trim().startsWith("{") ? [JSON.parse(v)] : /^[0-9a-f]+$/i.test(v.trim()) ? imWkb(Uint8Array.from(v.trim().match(/../g), (x) => parseInt(x, 16))) : imWkt(v);
        else geoms = [v];
      }
    } catch { bad++; continue; }
    const props = {};
    for (const k in row) if (k !== col) { const s = imScalar(row[k]); if (s !== null) props[String(k).slice(0, 80)] = s; }
    for (const g of geoms) features.push({ type: "Feature", properties: props, geometry: g });
  }
  const sample = features.find((f) => f.geometry?.coordinates);
  if (!features.length) throw new Error(`図形を読めませんでした（解釈できない行 ${bad}）`);
  const first = JSON.stringify(sample.geometry.coordinates).match(/-?\d+(\.\d+)?/g)?.slice(0, 2).map(Number) || [0, 0];
  if (!okLonLat(first)) throw new Error("座標が経緯度ではないようです（平面直角座標など）。EPSG:4326 に変換してから読み込んでください");
  return { name: file.name.replace(/\.(geo)?parquet$|\.pq$|\.parq$/i, ""), kind: "parquet", features, note: truncated ? `先頭 ${IM_LIMITS.parquetRows.toLocaleString()} 行のみ（全 ${total.toLocaleString()} 行）` : "" };
}

/* ---------- 基盤地図情報（JPGIS GML） ---------- */
function fgdPts(el) {
  const n = (el.textContent || "").trim().split(/\s+/).filter(Boolean).map(Number);
  const dim = Math.max(2, Number(el.getAttribute("srsDimension") || el.getAttribute("dimension")) || 2), out = [];
  for (let i = 0; i + 1 < n.length; i += dim) {
    const lat = n[i], lon = n[i + 1]; // 基盤地図情報は「緯度 経度」の順
    if (!okLonLat([lon, lat])) return null;
    out.push([lon, lat]);
  }
  return out;
}
function fgdLine(el) {
  let lists = [...el.getElementsByTagNameNS("*", "posList")];
  if (!lists.length) lists = [...el.getElementsByTagNameNS("*", "pos")];
  if (!lists.length && /^(posList|pos)$/.test(el.localName)) lists = [el];
  const pts = [];
  for (const p of lists) {
    const a = fgdPts(p);
    if (!a) return null;
    for (const q of a) { const l = pts[pts.length - 1]; if (!l || l[0] !== q[0] || l[1] !== q[1]) pts.push(q); }
  }
  return pts;
}
function fgdGeom(el) {
  const s = ["Surface", "Polygon"].map((n) => el.getElementsByTagNameNS("*", n)[0]).find(Boolean);
  if (s) {
    const patches = [...s.getElementsByTagNameNS("*", "PolygonPatch")];
    const polys = [];
    for (const pa of patches.length ? patches : [s]) {
      const rings = [];
      for (const c of pa.children) {
        if (!/^(exterior|interior|outerBoundaryIs|innerBoundaryIs)$/.test(c.localName)) continue;
        const r = fgdLine(c);
        if (!r) return null;
        if (r.length >= 3) { if (r[0][0] !== r.at(-1)[0] || r[0][1] !== r.at(-1)[1]) r.push(r[0].slice()); rings.push(r); }
      }
      if (rings.length) polys.push(rings);
    }
    return polys.length === 1 ? { type: "Polygon", coordinates: polys[0] } : polys.length ? { type: "MultiPolygon", coordinates: polys } : null;
  }
  const curves = [...el.getElementsByTagNameNS("*", "Curve"), ...el.getElementsByTagNameNS("*", "LineString")];
  if (curves.length) {
    const parts = curves.map(fgdLine);
    if (parts.some((p) => p === null)) return null;
    const ok = parts.filter((p) => p.length >= 2);
    return ok.length === 1 ? { type: "LineString", coordinates: ok[0] } : ok.length ? { type: "MultiLineString", coordinates: ok } : null;
  }
  const pt = el.getElementsByTagNameNS("*", "Point")[0];
  if (pt) { const q = fgdLine(pt); return q && q.length ? { type: "Point", coordinates: q[0] } : null; }
  return undefined;
}
function fgdProps(el) {
  const o = {};
  for (const c of el.children) {
    const k = c.localName;
    if (!k || /^(area|loc|pos|geometry|surface|curve|point|position)$/.test(k) || c.getElementsByTagNameNS("*", "pos").length || c.getElementsByTagNameNS("*", "posList").length) continue;
    let v = (c.textContent || "").trim();
    if (!v) continue;
    if (v.length > 200) v = v.slice(0, 200);
    o[k] = (k === "alti" || k === "altiAcc") && Number.isFinite(Number(v)) ? Number(v) : v;
  }
  return o;
}
function fgdParseGML(text, fileName, groups, out) {
  const doc = new DOMParser().parseFromString(text, "application/xml");
  if (doc.getElementsByTagName("parsererror").length) throw new Error(fileName + "：XML を解析できません");
  const root = doc.documentElement;
  if (/^DEM/.test(root.localName) || [...root.children].some((c) => c.localName === "DEM")) { out.dem++; return; }
  for (const el of root.children) {
    const k = el.localName;
    if (/^(description|metadata|boundedBy)$/.test(k)) continue;
    if (!groups.has(fgdGroupOf(k))) continue;
    const g = fgdGeom(el);
    if (g === undefined) continue;
    if (!g) { out.invalid++; continue; }
    const props = fgdProps(el);
    props.fgdFeature = k;
    props["項目"] = FGD_JA[k] || k;
    out.features.push({ type: "Feature", properties: props, geometry: g });
    if (out.features.length > IM_LIMITS.features) throw new Error("地物が多すぎます（30 万件まで）。範囲や項目を絞ってください");
  }
}
async function imParseFgd(files, groups, onProgress) {
  const texts = [];
  const nameKind = (n) => {
    const b = String(n).split("/").pop();
    if (/-DEM/i.test(b)) return "dem";
    const m = b.match(/FG-GML-[\d-]+-([A-Za-z]+)-/);
    if (!m || m[1] === "ALL") return "ok";
    return groups.has(fgdGroupOf(m[1])) ? "ok" : "skip";
  };
  const out = { features: [], dem: 0, invalid: 0, skipped: 0 };
  const pushZip = async (blob, depth) => {
    if (depth > 4) return;
    const z = await readZip(blob);
    for (const n of z.names) {
      if (/\/$/.test(n)) continue;
      if (/\.zip$/i.test(n)) { await pushZip(await z.get(n), depth + 1); continue; }
      if (!/\.(xml|gml)$/i.test(n)) continue;
      const k = nameKind(n);
      if (k === "dem") out.dem++; else if (k === "skip") out.skipped++; else texts.push({ name: n, get: () => z.get(n) });
    }
  };
  for (const f of files) {
    if (/\.zip$/i.test(f.name)) await pushZip(f, 0);
    else if (/\.(xml|gml)$/i.test(f.name)) { const k = nameKind(f.name); if (k === "ok") texts.push({ name: f.name, get: async () => f }); else if (k === "dem") out.dem++; }
  }
  if (!texts.length) throw new Error(out.dem ? "数値標高モデル（DEM）の XML は対象外です（標高は「1m標高」で表示できます）" : "基盤地図情報（基本項目）の XML が見つかりません");
  let i = 0;
  for (const t of texts) {
    const blob = await t.get();
    fgdParseGML(imDecodeText(await blob.arrayBuffer()), t.name.split("/").pop(), groups, out);
    onProgress?.(++i, texts.length, out.features.length);
    if (i % 4 === 0) await new Promise((r) => setTimeout(r));
  }
  if (!out.features.length) throw new Error("選んだ項目の地物が見つかりませんでした");
  return { name: "基盤地図情報" + (files.length === 1 ? `（${files[0].name.replace(/\.(zip|xml|gml)$/i, "")}）` : ""), kind: "fgd", features: out.features, note: out.invalid ? `座標の読めない地物 ${out.invalid} 件を除外` : "" };
}

/** ファイル 1 つ（または基盤地図情報の複数ファイル）を読む */
async function imReadFiles(files, fgdGroups, onProgress) {
  for (const f of files) if (f.size > IM_LIMITS.fileSize) throw new Error(`${f.name}：ファイルが大きすぎます（300MB まで）`);
  const f = files[0], ext = (f.name.split(".").pop() || "").toLowerCase();
  if (files.length > 1 || ext === "zip" || (["xml", "gml"].includes(ext))) return imParseFgd(files, fgdGroups, onProgress);
  if (ext === "kml") return imParseKml(imDecodeText(await f.arrayBuffer()), f.name.replace(/\.kml$/i, ""));
  if (ext === "gsf") return imParseGsf(await f.arrayBuffer(), f.name.replace(/\.gsf$/i, ""));
  if (["parquet", "geoparquet", "pq", "parq"].includes(ext)) return imParseParquet(f);
  if (["geojson", "json"].includes(ext)) return imParseGeoJSON(JSON.parse(imDecodeText(await f.arrayBuffer())), f.name.replace(/\.(geo)?json$/i, ""));
  throw new Error("対応形式：GeoJSON・KML・.gsf・Parquet / GeoParquet・基盤地図情報（ZIP / XML）");
}

/* ---------- 属性表（結合用） ---------- */
function imParseCsv(text) {
  const delim = (text.split("\n")[0].match(/\t/g) || []).length > (text.split("\n")[0].match(/,/g) || []).length ? "\t" : ",";
  const rows = [];
  let row = [], cur = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else if (c === '"') q = true;
    else if (c === delim) { row.push(cur); cur = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && text[i + 1] === "\n") i++; row.push(cur); cur = ""; if (row.some((x) => x !== "")) rows.push(row); row = []; }
    else cur += c;
  }
  row.push(cur);
  if (row.some((x) => x !== "")) rows.push(row);
  if (rows.length < 2) throw new Error("表に行がありません");
  const head = rows[0].map((h, i) => h.trim() || `列${i + 1}`);
  return rows.slice(1).map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ""])));
}
async function imReadTable(file) {
  const ext = (file.name.split(".").pop() || "").toLowerCase();
  if (["csv", "tsv", "txt"].includes(ext)) return imParseCsv(imDecodeText(await file.arrayBuffer()));
  if (["parquet", "geoparquet", "pq", "parq"].includes(ext)) return (await imReadParquetRows(file)).rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, imScalar(v)])));
  if (["json", "geojson"].includes(ext)) {
    const j = JSON.parse(imDecodeText(await file.arrayBuffer()));
    if (Array.isArray(j)) return j;
    if (j.type === "FeatureCollection") return j.features.map((f) => f.properties || {});
    throw new Error("JSON は「オブジェクトの配列」か GeoJSON にしてください");
  }
  if (["gsf", "kml"].includes(ext)) return (await imReadFiles([file])).features.map((f) => f.properties);
  throw new Error("属性表の対応形式：CSV・TSV・TXT・JSON・GeoJSON・Parquet・.gsf・KML");
}
/** 照合用にキーをそろえる（前後の空白・大文字小文字・数値の 0 埋めの違いを吸収） */
const imKey = (v, strict) => {
  if (v == null) return "";
  let s = String(v).trim();
  if (strict) return s;
  s = s.normalize("NFKC").toLowerCase();
  return /^-?\d+(\.\d+)?$/.test(s) ? String(Number(s)) : s;
};
/** 図形側を基準にした左結合。テーブル側の重複キーは最初の 1 行だけ */
function imJoin(features, geoKey, rows, tableKey, strict) {
  const map = new Map();
  let dup = 0;
  for (const r of rows) { const k = imKey(r[tableKey], strict); if (!k) continue; if (map.has(k)) dup++; else map.set(k, r); }
  const geoCols = new Set(features.flatMap((f) => Object.keys(f.properties || {})));
  let matched = 0;
  const renamed = new Set();
  for (const f of features) {
    const r = map.get(imKey(f.properties?.[geoKey], strict));
    if (!r) continue;
    matched++;
    for (const [k, v] of Object.entries(r)) {
      if (k === tableKey) continue;
      let name = k;
      if (geoCols.has(k)) { name = k + "（表）"; renamed.add(k); }
      f.properties[name] = typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v.trim().replace(/,/g, "")) ? Number(v.trim().replace(/,/g, "")) : v;
    }
  }
  return { matched, unmatched: features.length - matched, dupKeys: dup, renamed: [...renamed], tableRows: rows.length };
}
/** 2 つの列の値がどれだけ一致するか（キー列の推定用） */
function imGuessKeys(features, rows) {
  const gcols = [...new Set(features.slice(0, 500).flatMap((f) => Object.keys(f.properties || {})))];
  const tcols = Object.keys(rows[0] || {});
  let best = null;
  for (const g of gcols) {
    const gv = new Set(features.slice(0, 2000).map((f) => imKey(f.properties[g])).filter(Boolean));
    if (gv.size < 2) continue;
    for (const t of tcols) {
      let hit = 0;
      for (const r of rows.slice(0, 2000)) if (gv.has(imKey(r[t]))) hit++;
      if (!best || hit > best.hit) best = { g, t, hit };
    }
  }
  return { gcols, tcols, best };
}

/* ====================================================================
 * 保存・描画
 * ==================================================================== */
function imBbox(features) {
  const b = [Infinity, Infinity, -Infinity, -Infinity];
  const walk = (c) => { if (typeof c[0] === "number") { if (c[0] < b[0]) b[0] = c[0]; if (c[1] < b[1]) b[1] = c[1]; if (c[0] > b[2]) b[2] = c[0]; if (c[1] > b[3]) b[3] = c[1]; } else for (const x of c) walk(x); };
  for (const f of features) if (f.geometry?.coordinates) walk(f.geometry.coordinates);
  return Number.isFinite(b[0]) ? b : null;
}
const IMP = { list: [], data: new Map() }; // 保存済みレイヤの設定, id -> FeatureCollection
async function imLoadAll() {
  try { IMP.list = (await DB.all("layers")).sort((a, b) => (a.order || 0) - (b.order || 0)); } catch { IMP.list = []; }
}
async function imData(id) {
  if (!IMP.data.has(id)) { const d = await DB.get("layerData", id); IMP.data.set(id, d ? d.fc : { type: "FeatureCollection", features: [] }); }
  return IMP.data.get(id);
}
async function imSave(rec) {
  await DB.put("layers", rec);
  const i = IMP.list.findIndex((x) => x.id === rec.id);
  if (i >= 0) IMP.list[i] = rec; else IMP.list.push(rec);
}
/** 読み込んだ結果を保存して表示 */
async function imAdd(parsed, extra = {}) {
  let verts = 0;
  const count = (c) => { if (typeof c[0] === "number") verts++; else for (const x of c) count(x); };
  for (const f of parsed.features) if (f.geometry?.coordinates) count(f.geometry.coordinates);
  if (parsed.features.length > IM_LIMITS.features || verts > IM_LIMITS.vertices) throw new Error(`大きすぎます（地物 ${parsed.features.length.toLocaleString()}・頂点 ${verts.toLocaleString()}）。地物 30 万・頂点 300 万までにしてください`);
  const id = uuid().slice(0, 8);
  const fields = [...new Set(parsed.features.slice(0, 1000).flatMap((f) => Object.keys(f.properties || {})))].filter((k) => k !== "fgdFeature");
  const types = [...new Set(parsed.features.map((f) => f.geometry.type.replace("Multi", "")))];
  const rec = {
    id, name: parsed.name, kind: parsed.kind, on: true, opacity: 0.8, color: IM_COLORS[IMP.list.length % IM_COLORS.length],
    field: parsed.classes && fields.includes(parsed.classField) ? parsed.classField : "", classes: parsed.classes || null, classField: parsed.classField || null,
    label: "", fields, types, count: parsed.features.length, bbox: imBbox(parsed.features), note: parsed.note || "",
    fgdOff: parsed.kind === "fgd" ? [] : undefined, order: Date.now(), createdAt: nowIso(), ...extra,
  };
  const fc = { type: "FeatureCollection", features: parsed.features };
  await DB.put("layerData", { id, fc });
  IMP.data.set(id, fc);
  await imSave(rec);
  await imApplyOne(rec);
  return rec;
}
async function imDelete(id) {
  ovlRemove(`im-${id}`);
  await DB.del("layers", id);
  await DB.del("layerData", id);
  IMP.list = IMP.list.filter((x) => x.id !== id);
  IMP.data.delete(id);
  dataLegendUpdate();
}

/** 色分けの区分（凡例と描画で共通）
 *  数値：{ numeric, base, stops:[{v, color}], min }（step 式：base は最初の境界より小さい値の色）
 *  文字：{ cats:[{v, n, color}], more } */
function imClasses(rec) {
  if (rec.kind === "fgd" || !rec.field) return null;
  if (rec.classes && rec.field === rec.classField) {
    // jSTAT MAP の階級区分（下限以上）。最初の下限より小さい値は塗らない
    return { numeric: true, base: "rgba(0,0,0,0)", stops: rec.classes.map((c) => ({ v: c.min, color: c.color })), min: rec.classes[0].min };
  }
  const fc = IMP.data.get(rec.id);
  if (!fc) return null;
  const vals = fc.features.map((f) => f.properties?.[rec.field]).filter((v) => v != null && v !== "");
  const nums = vals.map((v) => (typeof v === "number" ? v : Number(String(v).replace(/,/g, ""))));
  const distinct = new Set(vals.map(String));
  if (vals.length && nums.every(Number.isFinite) && distinct.size > 8) {
    const sorted = nums.slice().sort((a, b) => a - b), ramp = NUM_RAMPS[rec.ramp || "blue"] || NUM_RAMPS.blue;
    const br = [...new Set([1, 2, 3, 4].map((i) => sorted[Math.floor((i * sorted.length) / 5)]))];
    return { numeric: true, base: ramp[0], stops: br.map((v, i) => ({ v, color: ramp[Math.min(ramp.length - 1, Math.round(((i + 1) * (ramp.length - 1)) / br.length))] })), min: sorted[0], max: sorted.at(-1) };
  }
  const counts = new Map();
  for (const v of vals.map(String)) counts.set(v, (counts.get(v) || 0) + 1);
  const cats = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 24).map(([v, n], i) => ({ v, n, color: CAT_COLORS[i % CAT_COLORS.length] }));
  return { numeric: false, cats, more: counts.size > 24 };
}
function imColorExpr(rec) {
  if (rec.kind === "fgd") {
    const e = ["match", ["get", "fgdFeature"]];
    for (const [k, st] of Object.entries(FGD_STYLE)) e.push(k, st[0]);
    e.push("#888888");
    return e;
  }
  const c = imClasses(rec);
  if (!c) return rec.color;
  if (c.numeric) {
    const e = ["step", ["to-number", ["get", rec.field], -1e30], c.base];
    for (const b of c.stops) e.push(b.v, b.color);
    return e;
  }
  const e = ["match", ["to-string", ["get", rec.field]]];
  for (const x of c.cats) e.push(x.v, x.color);
  e.push(c.more ? "#9e9e9e" : rec.color);
  return e;
}
function imLayersFor(rec) {
  const src = `im-${rec.id}`, col = imColorExpr(rec), op = rec.opacity ?? 0.8;
  const fgd = rec.kind === "fgd";
  const vis = fgd ? ["!", ["in", ["get", "fgdFeature"], ["literal", Object.keys(FGD_STYLE).filter((k) => (rec.fgdOff || []).includes(fgdGroupOf(k)))]]] : true;
  const fgdOp = () => (fgd ? ["*", op, ["match", ["get", "fgdFeature"], ...Object.entries(FGD_STYLE).flatMap(([k, s]) => [k, s[1]]), 0.85]] : op);
  const fgdW = (base) => (fgd ? ["match", ["get", "fgdFeature"], ...Object.entries(FGD_STYLE).flatMap(([k, s]) => [k, s[2] * base]), base] : base);
  const geom = (t) => ["==", ["geometry-type"], t];
  const layers = [
    { id: `${src}-fill`, type: "fill", source: src, filter: ["all", geom("Polygon"), vis], paint: { "fill-color": col, "fill-opacity": fgdOp() } },
    { id: `${src}-line`, type: "line", source: src, filter: ["all", vis], layout: { "line-join": "round", "line-cap": "round" },
      paint: { "line-color": fgd ? col : ["case", geom("Polygon"), "rgba(40,40,40,0.55)", col], "line-width": fgd ? fgdW(1.2) : ["case", geom("Polygon"), 0.7, 2.2], "line-opacity": fgd ? fgdOp() : Math.min(1, op + 0.2) } },
    { id: `${src}-pt`, type: "circle", source: src, filter: ["all", geom("Point"), vis], paint: { "circle-color": col, "circle-radius": fgd ? fgdW(1.3) : 5, "circle-stroke-color": "#fff", "circle-stroke-width": fgd ? 0.5 : 1.2, "circle-opacity": Math.min(1, op + 0.2) } },
  ];
  const label = fgd ? (rec.fgdOff || []).includes("elev") ? "" : "alti" : rec.label;
  if (label) {
    layers.push({ id: `${src}-label`, type: "symbol", source: src, minzoom: fgd ? 15 : 0, filter: fgd ? ["==", ["get", "fgdFeature"], "ElevPt"] : true,
      layout: { "text-field": ["to-string", ["get", label]], "text-font": IM_FONT, "text-size": 11, "text-offset": [0, 0.9], "text-anchor": "top", "text-optional": true },
      paint: { "text-color": "#222", "text-halo-color": "rgba(255,255,255,0.9)", "text-halo-width": 1.3 } });
  }
  return layers;
}
async function imApplyOne(rec) {
  const src = `im-${rec.id}`;
  if (!rec.on) { ovlRemove(src); dataLegendUpdate(); return; }
  const m = await ovlReady();
  if (!m.getSource(src)) m.addSource(src, { type: "geojson", data: await imData(rec.id), attribution: rec.kind === "fgd" ? "基盤地図情報（国土地理院）" : "" });
  for (const l of m.getStyle().layers.filter((l) => l.id.startsWith(src + "-"))) m.removeLayer(l.id);
  for (const l of imLayersFor(rec)) m.addLayer(l);
  ovlOrder();
  dataLegendUpdate();
}
async function imApplyAll() {
  await imLoadAll();
  for (const rec of IMP.list) if (rec.on) { await imData(rec.id); await imApplyOne(rec); }
}
/** 凡例（地図の右下・印刷） */
function imLegendGroups(filterKeys) {
  const out = [];
  for (const rec of IMP.list) {
    if (!rec.on || (filterKeys && !filterKeys.includes("data:im:" + rec.id))) continue;
    const pt = rec.types?.length === 1 && rec.types[0] === "Point", ln = rec.types?.length === 1 && rec.types[0] === "LineString";
    const kind = pt ? "dot" : ln ? "line" : "box";
    let items;
    if (rec.kind === "fgd") {
      const fc = IMP.data.get(rec.id);
      const present = new Set(fc ? fc.features.map((f) => f.properties.fgdFeature) : []);
      items = Object.keys(FGD_STYLE).filter((k) => present.has(k) && !(rec.fgdOff || []).includes(fgdGroupOf(k)))
        .map((k) => ({ color: FGD_STYLE[k][0], text: FGD_JA[k], kind: /Pt$|GCP/.test(k) ? "dot" : /A$|Area$/.test(k) ? "box" : "line" }));
    } else {
      const c = imClasses(rec);
      if (!c) items = [{ color: rec.color, text: rec.name, kind }];
      else if (c.numeric) {
        const st = c.stops;
        items = [];
        if (!c.base.startsWith("rgba(0,0,0,0)")) items.push({ color: c.base, kind, text: `${fmtNum(c.min)} 〜 ${fmtNum(st[0]?.v)}` });
        st.forEach((x, i) => items.push({ color: x.color, kind, text: i < st.length - 1 ? `${fmtNum(x.v)} 〜 ${fmtNum(st[i + 1].v)}` : `${fmtNum(x.v)} 以上` }));
      } else items = [...c.cats.map((x) => ({ color: x.color, text: x.v, kind })), ...(c.more ? [{ color: "#9e9e9e", text: "その他", kind }] : [])];
    }
    out.push({ key: "data:im:" + rec.id, title: rec.field && rec.kind !== "fgd" ? `${rec.name}（${rec.field}）` : rec.name, items });
  }
  return out;
}

/* ====================================================================
 * 画面：ファイルを重ねる
 * ==================================================================== */
function imPanel() {
  const box = h("div");
  const render = () => {
    box.replaceChildren();
    for (const rec of IMP.list) {
      const cb = h("input", { type: "checkbox", checked: !!rec.on });
      cb.onchange = async () => { rec.on = cb.checked; await imSave(rec); await imApplyOne(rec); };
      const rg = h("input", { type: "range", min: "0.1", max: "1", step: "0.05", value: rec.opacity ?? 0.8 });
      rg.oninput = async () => { rec.opacity = Number(rg.value); if (!rec.on) { rec.on = cb.checked = true; } await imSave(rec); imApplyOne(rec); };
      const kindName = { geojson: "GeoJSON", kml: "KML", gsf: "jSTAT MAP", parquet: "Parquet", fgd: "基盤地図情報" }[rec.kind] || rec.kind;
      box.append(h("div", { class: "ri-row" },
        h("div", { class: "ov-row" }, cb, h("div", {}, rec.name, h("small", {}, [kindName, `${rec.count.toLocaleString()} 件`, rec.join ? `結合 ${rec.join.matched}/${rec.count}` : "", rec.note].filter(Boolean).join("・"))), rg),
        h("div", { class: "chips" },
          h("button", { type: "button", class: "chip", onclick: () => { if (!rec.bbox) return; closeSheet(true); setFollow(false); if (!rec.on) { rec.on = true; imSave(rec); imApplyOne(rec); } S.map.fitBounds([[rec.bbox[1], rec.bbox[0]], [rec.bbox[3], rec.bbox[2]]], { padding: [30, 30], maxZoom: 17 }); } }, "範囲へ"),
          h("button", { type: "button", class: "chip", onclick: () => openImStyle(rec.id) }, rec.kind === "fgd" ? "項目・表示" : "色分け・ラベル"),
          h("button", { type: "button", class: "chip", onclick: async () => { if (!confirm(`「${rec.name}」を削除しますか？`)) return; await imDelete(rec.id); render(); } }, "削除"))));
    }
    if (!IMP.list.length) box.append(h("p", { class: "note", style: "margin-top:0" }, "GeoJSON・KML・jSTAT MAP の .gsf・GeoParquet・基盤地図情報を地図に重ねられます。"));
    box.append(h("button", { type: "button", class: "btn secondary block", onclick: openImImport }, "＋ ファイルを重ねる"));
  };
  render();
  return box;
}

function openImImport() {
  const fileIn = h("input", { type: "file", multiple: true, hidden: true, accept: ".geojson,.json,.kml,.gsf,.parquet,.geoparquet,.pq,.parq,.zip,.xml,.gml" });
  const status = h("div", { class: "note" });
  const fgdBox = h("div", { class: "fgd-groups" }, ...FGD_GROUPS.map((g) => h("label", { class: "inline" }, h("input", { type: "checkbox", "data-g": g.id, checked: g.on }), g.label)));
  const joinCb = h("input", { type: "checkbox" });
  const step2 = h("div");
  fileIn.onchange = async () => {
    const files = [...fileIn.files];
    fileIn.value = "";
    if (!files.length) return;
    status.textContent = "読み込み中…";
    step2.replaceChildren();
    try {
      const groups = new Set([...fgdBox.querySelectorAll("input")].filter((i) => i.checked).map((i) => i.dataset.g));
      const parsed = await imReadFiles(files, groups, (d, n, k) => (status.textContent = `基盤地図情報を読み込み中… ${d}/${n} ファイル・${k.toLocaleString()} 件`));
      status.textContent = `${parsed.name}：${parsed.features.length.toLocaleString()} 件${parsed.note ? `（${parsed.note}）` : ""}`;
      if (joinCb.checked && parsed.kind !== "fgd") return openImJoin(parsed, step2, status);
      const rec = await imAdd(parsed, { source: files.map((f) => f.name).join(", ").slice(0, 200) });
      closeSheet(true);
      toast(`「${rec.name}」を重ねました（${rec.count.toLocaleString()} 件）`);
      if (rec.bbox) { setFollow(false); S.map.fitBounds([[rec.bbox[1], rec.bbox[0]], [rec.bbox[3], rec.bbox[2]]], { padding: [30, 30], maxZoom: 17 }); }
    } catch (e) {
      status.textContent = "読み込めませんでした：" + e.message;
    }
  };
  openSheet("ファイルを重ねる", h("div", {},
    h("button", { type: "button", class: "chip vt-back", onclick: openDataSheet }, "← データを重ねるに戻る"),
    h("button", { type: "button", class: "btn primary block", onclick: () => fileIn.click() }, "ファイルを選ぶ"), fileIn,
    h("label", { class: "inline", style: "margin:10px 0 4px" }, joinCb, "属性表（CSV など）を結合してから重ねる"),
    status, step2,
    h("p", { class: "note" }, "対応形式：GeoJSON（.geojson・.json）、KML、jSTAT MAP の .gsf、Parquet / GeoParquet（先頭 5 万行まで）、基盤地図情報「基本項目」の ZIP / XML（複数まとめて選択可）。座標は経緯度（WGS84・JGD2011）のデータに対応します。読み込んだデータはこの端末だけに保存され、外部には送信しません（Parquet の解析ライブラリの読み込みだけ通信します）。"),
    h("details", {}, h("summary", {}, "基盤地図情報で読み込む項目"), fgdBox,
      h("p", { class: "note" }, "数値標高モデル（DEM）は対象外です（標高は「1m 標高」で表示できます）。スマホでは市町村の一部程度の範囲にしてください。"))), { backdrop: false, height: "70vh" });
}

/** 属性表の結合：表を選ぶ → キーの列を選ぶ → 結合して追加 */
function openImJoin(parsed, box, status) {
  const tIn = h("input", { type: "file", hidden: true, accept: ".csv,.tsv,.txt,.json,.geojson,.parquet,.geoparquet,.pq,.parq,.gsf,.kml" });
  box.replaceChildren(h("button", { type: "button", class: "btn secondary block", onclick: () => tIn.click() }, "結合する属性表を選ぶ"), tIn);
  tIn.onchange = async () => {
    const f = tIn.files[0];
    tIn.value = "";
    if (!f) return;
    let rows;
    try { rows = await imReadTable(f); } catch (e) { status.textContent = "表を読めませんでした：" + e.message; return; }
    const { gcols, tcols, best } = imGuessKeys(parsed.features, rows);
    const gSel = h("select", {}, ...gcols.map((c) => h("option", { value: c, selected: best?.g === c }, c)));
    const tSel = h("select", {}, ...tcols.map((c) => h("option", { value: c, selected: best?.t === c }, c)));
    const strict = h("input", { type: "checkbox" });
    const go = h("button", { type: "button", class: "btn primary block" }, "結合して重ねる");
    go.onclick = async () => {
      go.disabled = true;
      const feats = parsed.features.map((x) => ({ ...x, properties: { ...x.properties } }));
      const r = imJoin(feats, gSel.value, rows, tSel.value, strict.checked);
      if (!r.matched && !confirm("一致する行がありませんでした。キーの列を確認してください。このまま（結合なしで）重ねますか？")) { go.disabled = false; return; }
      const rec = await imAdd({ ...parsed, features: feats }, { join: { table: f.name, geoKey: gSel.value, tableKey: tSel.value, strict: strict.checked, ...r } });
      closeSheet(true);
      toast(`結合：一致 ${r.matched}・不一致 ${r.unmatched}${r.dupKeys ? `・表の重複キー ${r.dupKeys}（最初の行を使用）` : ""}`, 5000);
      if (rec.bbox) { setFollow(false); S.map.fitBounds([[rec.bbox[1], rec.bbox[0]], [rec.bbox[3], rec.bbox[2]]], { padding: [30, 30], maxZoom: 17 }); }
      openImStyle(rec.id);
    };
    box.replaceChildren(
      h("div", { class: "note" }, `属性表：${f.name}（${rows.length.toLocaleString()} 行・${tcols.length} 列）${best?.hit ? `　推定：「${best.g}」と「${best.t}」で ${best.hit} 件一致` : ""}`),
      h("div", { class: "pr-grid" }, h("label", {}, "図形側のキー", gSel), h("label", {}, "表側のキー", tSel)),
      h("label", { class: "inline" }, strict, "文字列として厳密に照合する（既定：空白・大文字小文字・0 埋めの違いを無視）"),
      go,
      h("p", { class: "note" }, "図形側を基準にした左結合です。表側に同じキーが複数ある場合は最初の 1 行だけを使います（集計・按分はしません）。同じ名前の列は「（表）」を付けて追加します。"));
  };
}

function openImStyle(id) {
  const rec = IMP.list.find((x) => x.id === id);
  if (!rec) return;
  const save = async () => { await imSave(rec); await imApplyOne(rec); };
  const body = h("div", {}, h("button", { type: "button", class: "chip vt-back", onclick: openDataSheet }, "← データを重ねるに戻る"));
  const name = h("input", { type: "text", value: rec.name });
  name.onchange = () => { rec.name = name.value.trim() || rec.name; save(); };
  body.append(h("label", {}, "名前", name));
  if (rec.kind === "fgd") {
    const present = new Set((IMP.data.get(rec.id)?.features || []).map((f) => fgdGroupOf(f.properties.fgdFeature)));
    for (const g of FGD_GROUPS.filter((g) => present.has(g.id))) {
      const cb = h("input", { type: "checkbox", checked: !(rec.fgdOff || []).includes(g.id) });
      cb.onchange = () => { const s = new Set(rec.fgdOff || []); cb.checked ? s.delete(g.id) : s.add(g.id); rec.fgdOff = [...s]; save(); };
      const sw = g.keys.map((k) => FGD_STYLE[k]?.[0]).filter(Boolean)[0] || "#888";
      body.append(h("label", { class: "inline green-item" }, cb, h("i", { class: "gl-sw", style: `background:${sw}` }), g.label));
    }
    body.append(h("p", { class: "note" }, "標高点はズーム 15 以上で標高値を表示します。配色は Vector Studio の基盤地図情報の既定に合わせています。"));
  } else {
    const color = h("input", { type: "color", value: rec.color });
    color.oninput = () => { rec.color = color.value; save(); };
    const fieldSel = h("select", {}, h("option", { value: "" }, "色分けしない（単色）"), ...rec.fields.map((f) => h("option", { value: f, selected: rec.field === f }, f)));
    fieldSel.onchange = () => { rec.field = fieldSel.value; save(); };
    const ramp = h("select", {}, ...Object.entries(RAMP_NAMES).map(([k, v]) => h("option", { value: k, selected: (rec.ramp || "blue") === k }, v)));
    ramp.onchange = () => { rec.ramp = ramp.value; save(); };
    const labelSel = h("select", {}, h("option", { value: "" }, "ラベルなし"), ...rec.fields.map((f) => h("option", { value: f, selected: rec.label === f }, f)));
    labelSel.onchange = () => { rec.label = labelSel.value; save(); };
    body.append(
      h("div", { class: "pr-grid" }, h("label", {}, "基本の色", color), h("label", {}, "数値の色", ramp)),
      h("label", {}, "色分けする属性（文字はカテゴリ、数値は 5 段階）", fieldSel),
      h("label", {}, "ラベルにする属性", labelSel));
    if (rec.classes) body.append(h("p", { class: "note" }, `この .gsf には jSTAT MAP の階級区分（${rec.classField}）が入っています。その属性を選ぶと、jSTAT MAP と同じ階級と色で塗り分けます。`));
    if (rec.join) body.append(h("p", { class: "note" }, `結合：${rec.join.table}（図形「${rec.join.geoKey}」＝表「${rec.join.tableKey}」）一致 ${rec.join.matched}・不一致 ${rec.join.unmatched}${rec.join.dupKeys ? `・表の重複キー ${rec.join.dupKeys}` : ""}${rec.join.renamed?.length ? `・名前を変えた列 ${rec.join.renamed.join("、")}` : ""}`));
  }
  openSheet(`${rec.name} の表示`, body, { backdrop: false, height: "62vh" });
}
