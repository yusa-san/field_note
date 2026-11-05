/* 境界を重ねる
 *
 * - 市区町村界：国土地理院 最適化ベクトルタイルの行政界（AdmBdry。vt_code 1211 都府県界・1212 市区町村界）を線で引く。
 *   どの背景地図の上にも出せる。タップで市区町村名を出すために、Geoshape の市区町村界（国土数値情報 行政区域を加工・2023-01-01）を
 *   見えない面として下に敷く（地図の範囲の都道府県の分だけ）
 * - 町丁・字界：e-Stat の国勢調査 小地域境界（estatgis.js と同じ取り方・端末キャッシュ）。拡大したとき（ズーム 13 以上）に、
 *   地図の範囲の市区町村の分を自動で取り、町丁・字の名前を出す
 */
const bdCfg = () => ({ city: false, town: false, labels: true, ...(Settings.data.bnd || {}) });
function bdSave(patch) { Settings.data.bnd = { ...bdCfg(), ...patch }; Settings.save(); }
const BD = { towns: new Map(), prefs: new Map(), t: 0, busy: false, again: false, watching: false, msg: "" };
const BD_TOWN_MINZOOM = 13;
const BD_TOWN_MAX = 24; // 端末のメモリに置いておく市区町村の数（古いものから捨てる。ファイルは端末キャッシュに残る）
const BD_CITY_COLOR = "#6a3d9a", BD_TOWN_COLOR = "#c2410c";

/** 町丁・字界に使う国勢調査の年（一覧にある町丁・字の統計の境界のうち新しいもの） */
function bdTownYear() {
  const ys = (typeof ESTAT_GIS !== "undefined" ? ESTAT_GIS : []).filter((d) => d.units.town).map((d) => d.bnd || d.year - (d.year % 5));
  return ys.length ? Math.max(...ys) : 2020;
}

async function bdApply() {
  const c = bdCfg();
  if (!c.city && !c.town) {
    if (OVL.map) { ovlRemove("bd-"); }
    bdWatch(false);
    return;
  }
  const m = await ovlReady();
  // ---- 市区町村界
  if (c.city) {
    if (!m.getSource("bd-gsi")) {
      await vtPrepareSource();
      m.addSource("bd-gsi", { ...vtSourceSpec(), attribution: "国土地理院（行政界）" });
    }
    if (!m.getSource("bd-city-area")) m.addSource("bd-city-area", { type: "geojson", data: { type: "FeatureCollection", features: [] }, attribution: "Geoshape 市区町村界（CODH・国土数値情報 行政区域を加工）" });
    const add = (l) => { if (!m.getLayer(l.id)) m.addLayer(l); };
    add({ id: "bd-city-area", type: "fill", source: "bd-city-area", paint: { "fill-color": "rgba(0,0,0,0.01)" } });
    // 地理院のタイルは市区町村界をズーム 12 以上（MapLibre 側で 11 以上）にしか持たないので、それより引いたときは Geoshape の輪郭で引く
    add({ id: "bd-city-outline", type: "line", source: "bd-city-area", maxzoom: 11, layout: { "line-join": "round" },
      paint: { "line-color": BD_CITY_COLOR, "line-width": ["interpolate", ["linear"], ["zoom"], 7, 0.8, 10, 1.4], "line-dasharray": ["literal", [4, 2]], "line-opacity": 0.9 } });
    add({ id: "bd-city-halo", type: "line", source: "bd-gsi", "source-layer": "AdmBdry", filter: ["in", ["get", "vt_code"], ["literal", [1211, 1212]]],
      layout: { "line-join": "round" }, paint: { "line-color": "rgba(255,255,255,0.85)", "line-width": ["interpolate", ["linear"], ["zoom"], 6, 2.5, 14, 5] } });
    add({ id: "bd-city-line", type: "line", source: "bd-gsi", "source-layer": "AdmBdry", filter: ["in", ["get", "vt_code"], ["literal", [1211, 1212]]],
      layout: { "line-join": "round" },
      paint: { "line-color": BD_CITY_COLOR, "line-width": ["interpolate", ["linear"], ["zoom"], 6, ["match", ["get", "vt_code"], 1211, 1.8, 1], 11, ["match", ["get", "vt_code"], 1211, 2.6, 1.6], 15, ["match", ["get", "vt_code"], 1211, 3.4, 2.4]],
        "line-dasharray": ["literal", [4, 2]] } });
  } else {
    ovlRemove("bd-city");
    if (m.getSource("bd-gsi")) m.removeSource("bd-gsi");
  }
  // ---- 町丁・字界
  if (c.town) {
    if (!m.getSource("bd-town")) m.addSource("bd-town", { type: "geojson", data: { type: "FeatureCollection", features: [] }, attribution: "e-Stat 国勢調査 小地域境界" });
    if (!m.getSource("bd-town-pt")) m.addSource("bd-town-pt", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
    const add = (l) => { if (!m.getLayer(l.id)) m.addLayer(l); };
    add({ id: "bd-town-area", type: "fill", source: "bd-town", minzoom: BD_TOWN_MINZOOM - 1, paint: { "fill-color": "rgba(0,0,0,0.01)" } });
    add({ id: "bd-town-line", type: "line", source: "bd-town", minzoom: BD_TOWN_MINZOOM - 1, layout: { "line-join": "round" },
      paint: { "line-color": BD_TOWN_COLOR, "line-width": ["interpolate", ["linear"], ["zoom"], 12, 0.8, 17, 2], "line-opacity": 0.9 } });
    if (c.labels) {
      add({ id: "bd-town-label", type: "symbol", source: "bd-town-pt", minzoom: BD_TOWN_MINZOOM + 1,
        layout: { "text-field": ["get", "name"], "text-font": ["NotoSansJP-Regular"], "text-size": ["interpolate", ["linear"], ["zoom"], 14, 10.5, 17, 13], "text-max-width": 7, "text-padding": 4 },
        paint: { "text-color": "#7c2d12", "text-halo-color": "rgba(255,255,255,0.95)", "text-halo-width": 1.6 } });
    } else if (m.getLayer("bd-town-label")) m.removeLayer("bd-town-label");
  } else {
    ovlRemove("bd-town");
  }
  ovlOrder();
  bdWatch(true);
  bdRefresh();
}

/** 地図を動かしたら、範囲の都道府県（市区町村名用）・市区町村（町丁・字界）を取り足す */
function bdWatch(on) {
  if (on === BD.watching) return;
  BD.watching = on;
  if (on) S.map.on("moveend", bdSchedule);
  else S.map.off("moveend", bdSchedule);
}
function bdSchedule() { clearTimeout(BD.t); BD.t = setTimeout(bdRefresh, 700); }
async function bdRefresh() {
  if (BD.busy) { BD.again = true; return; }
  BD.busy = true;
  try {
    const c = bdCfg(), m = OVL.map;
    if (!m || (!c.city && !c.town)) return;
    const z = S.map.getZoom();
    const needTown = c.town && z >= BD_TOWN_MINZOOM;
    const needCity = c.city && z >= 8;
    if (!needTown && !needCity) { bdStatus(c.town && z < BD_TOWN_MINZOOM ? `町丁・字界はズーム ${BD_TOWN_MINZOOM} 以上で出ます` : ""); return; }
    const codes = await esgCitiesInView();
    // 市区町村名（タップ用の見えない面）
    if (needCity) {
      const prefs = [...new Set(codes.map((x) => x.slice(0, 2)))];
      let changed = false;
      for (const p of prefs) {
        if (BD.prefs.has(p)) continue;
        try { BD.prefs.set(p, await loadCityShapes(p)); changed = true; } catch {}
      }
      if (changed) {
        const feats = [];
        for (const [, list] of BD.prefs) for (const f of list) {
          const pr = f.properties;
          feats.push({ type: "Feature", properties: { k: "city", code: pr.N03_007 || "", pref: pr.N03_001 || "", name: [pr.N03_003, pr.N03_004].filter(Boolean).join(" ") || pr.N03_001 || "" }, geometry: f.geometry });
        }
        m.getSource("bd-city-area")?.setData({ type: "FeatureCollection", features: feats });
      }
    }
    // 町丁・字界
    if (needTown) {
      const year = bdTownYear();
      const todo = codes.filter((x) => !BD.towns.has(`${year}:${x}`));
      let n = 0, failed = 0;
      for (const code of todo) {
        bdStatus(`町丁・字界を取得中…（${++n}/${todo.length}）`);
        try {
          const { blob } = await esgFetch({ dlserveyId: `A00200521${year}`, code, coordSys: "1", format: "shape", downloadType: "5", datum: "2000" });
          const shapes = await esgReadBoundary(blob);
          const polys = [], pts = [], seen = new Set();
          for (const s of shapes) {
            const p = s.props, name = p.S_NAME || "";
            polys.push({ type: "Feature", properties: { k: "town", code: p.KEY_CODE, name, city: p.CITY_NAME || "", pref: p.PREF_NAME || "", area: p.AREA }, geometry: s.geometry });
            // 名前は 1 地域に 1 つ（代表点 X_CODE/Y_CODE があればそこ）
            if (name && !seen.has(p.KEY_CODE) && Number.isFinite(p.X_CODE) && Number.isFinite(p.Y_CODE)) {
              seen.add(p.KEY_CODE);
              pts.push({ type: "Feature", properties: { name }, geometry: { type: "Point", coordinates: [p.X_CODE, p.Y_CODE] } });
            }
          }
          BD.towns.set(`${year}:${code}`, { polys, pts });
          while (BD.towns.size > BD_TOWN_MAX) BD.towns.delete(BD.towns.keys().next().value);
        } catch (e) {
          failed++;
          if (!/ありません/.test(e.message)) { bdStatus(e.message); toast(`町丁・字界：${e.message}`, 4000); }
        }
      }
      if (todo.length) {
        const all = [...BD.towns.values()];
        m.getSource("bd-town")?.setData({ type: "FeatureCollection", features: all.flatMap((x) => x.polys) });
        m.getSource("bd-town-pt")?.setData({ type: "FeatureCollection", features: all.flatMap((x) => x.pts) });
      }
      if (!failed) bdStatus(`町丁・字界：${year} 年国勢調査の境界（${[...BD.towns.keys()].filter((k) => k.startsWith(year + ":")).length} 市区町村分）`);
    } else bdStatus(c.town ? `町丁・字界はズーム ${BD_TOWN_MINZOOM} 以上で出ます` : "");
  } finally {
    BD.busy = false;
    if (BD.again) { BD.again = false; bdSchedule(); }
  }
}
function bdStatus(t) {
  BD.msg = t;
  const el = document.querySelector(".bd-status");
  if (el) el.textContent = t;
}

/** タップ：境界の名前とコード（dataLayerClick から呼ぶ。表示したら行を返す） */
function bdClickRows(f) {
  const pr = f.properties || {};
  if (pr.k === "town") return { title: pr.name || "（名前なし）", rows: [["市区町村", `${pr.pref || ""}${pr.city || ""}`], ["地域コード", pr.code], ["面積", pr.area ? `${(pr.area / 1e6).toFixed(pr.area < 1e5 ? 3 : 2)} km²` : ""], ["出典", `e-Stat 国勢調査 小地域境界（${bdTownYear()} 年）`]] };
  return { title: pr.name || "", rows: [["都道府県", pr.pref], ["市区町村コード", pr.code], ["出典", "Geoshape 市区町村界（2023-01-01）"]] };
}

/** 画面：データを重ねる → 境界 */
function bdPanel() {
  const c = bdCfg();
  const row = (key, title, sub) => {
    const cb = h("input", { type: "checkbox", checked: !!c[key] });
    cb.onchange = async () => {
      bdSave({ [key]: cb.checked });
      try { await bdApply(); } catch (e) { toast("表示できません：" + e.message, 4000); }
    };
    return h("label", { class: "ov-row bd-row" }, cb, h("div", {}, title, h("small", {}, sub)));
  };
  const lab = h("input", { type: "checkbox", checked: c.labels });
  lab.onchange = () => { bdSave({ labels: lab.checked }); bdApply(); };
  return h("div", { class: "bd-panel" },
    row("city", h("span", {}, h("i", { class: "bd-sw city" }), "市区町村界"), "国土地理院の行政界（いつも最新）。タップで市区町村名"),
    row("town", h("span", {}, h("i", { class: "bd-sw town" }), "町丁・字界"), `e-Stat の国勢調査 小地域境界（${bdTownYear()} 年）。ズーム ${BD_TOWN_MINZOOM} 以上で、地図の範囲の分を自動で取得`),
    h("label", { class: "inline bd-lab" }, lab, "町丁・字の名前を出す"),
    h("div", { class: "note bd-status" }, BD.msg));
}
