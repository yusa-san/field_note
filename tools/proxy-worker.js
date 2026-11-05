/* フィールドノート用の中継サーバ（Cloudflare Workers）
 *
 * - /reinfolib/XKT002?response_format=pbf&z=..&x=..&y=..  → 不動産情報ライブラリ API（API キーを付けて中継）
 * - /estat/getStatsList?... など                          → e-Stat API（appId を付けて中継）
 * - /estatgis/data?statsId=..&code=..&downloadType=2       → e-Stat「地図で見る統計」の町丁・字／メッシュ統計と境界（キー不要）
 *
 * API キーはこのサーバの「シークレット」に置くので、ブラウザ（公開されたアプリ）には出ません。
 * 結果は Cloudflare のキャッシュに 1 日（タイル）残すので、2 回目以降は速く、API への問い合わせも減ります。
 *
 * 設定（Cloudflare ダッシュボード → Workers → この Worker → Settings → Variables and Secrets）
 *   REINFOLIB_KEY   （シークレット）不動産情報ライブラリの API キー
 *   ESTAT_APPID     （シークレット・任意）e-Stat のアプリケーション ID
 *   ALLOWED_ORIGINS （テキスト）使ってよいサイト。例：https://yusa-san.github.io,http://localhost:8000
 */
const REINFO = "https://www.reinfolib.mlit.go.jp/ex-api/external/";
const ESTAT = "https://api.e-stat.go.jp/rest/3.0/app/json/";
const ESTAT_GIS = "https://www.e-stat.go.jp/gis/statmap-search/data";
// 統計GIS のダウンロードで使ってよいパラメータ（それ以外は捨てる）
const GIS_PARAMS = { statsId: /^T\d{6}$/, code: /^\d{2,5}$/, downloadType: /^[25]$/, dlserveyId: /^[A-Z]\d{12}$/, coordSys: /^[12]$/, format: /^(shape|gml)$/, datum: /^(2000|2011)$/ };

const json = (o, status, cors) => new Response(JSON.stringify(o, null, 1), { status, headers: { ...cors, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });

export default {
  async fetch(request, env, ctx) {
    const origin = request.headers.get("Origin") || "";
    const allowed = (env.ALLOWED_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean);
    const okOrigin = !allowed.length || allowed.includes(origin);
    const cors = {
      "Access-Control-Allow-Origin": okOrigin && origin ? origin : allowed[0] || "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "*",
      "Access-Control-Max-Age": "86400",
      Vary: "Origin",
    };
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (request.method !== "GET") return new Response("method not allowed", { status: 405, headers: cors });
    // ほかのサイトから API キーを使われないよう、許可したサイトからの呼び出しだけ受ける
    if (!okOrigin) return new Response("forbidden origin", { status: 403, headers: cors });

    const url = new URL(request.url);
    // 動作確認：設定の有無と、各 API に届くかを返す（API キーそのものは返さない）
    if (url.pathname === "/health") {
      const probe = async (u, h = {}) => {
        const t0 = Date.now();
        try {
          const r = await fetch(u, { headers: { ...h, "User-Agent": "fieldnote-proxy/1.0" }, signal: AbortSignal.timeout(20000) });
          const text = (await r.text()).slice(0, 300);
          return { status: r.status, ms: Date.now() - t0, body: text };
        } catch (e) {
          return { error: String(e && e.message || e), ms: Date.now() - t0 };
        }
      };
      return json({
        secrets: { REINFOLIB_KEY: !!env.REINFOLIB_KEY, ESTAT_APPID: !!env.ESTAT_APPID, ALLOWED_ORIGINS: env.ALLOWED_ORIGINS || "(未設定)" },
        reinfolib: env.REINFOLIB_KEY ? await probe(REINFO + "XKT002?response_format=geojson&z=14&x=14549&y=6452", { "Ocp-Apim-Subscription-Key": env.REINFOLIB_KEY }) : "REINFOLIB_KEY 未設定",
        estat: env.ESTAT_APPID ? await probe(ESTAT + "getStatsList?limit=1&appId=" + encodeURIComponent(env.ESTAT_APPID)) : "ESTAT_APPID 未設定",
        estatgis: await probe(ESTAT_GIS + "?statsId=T001081&code=13101&downloadType=2").then((r) => ({ ...r, body: undefined, zip: r.body ? r.body.startsWith("PK") : false })),
      }, 200, cors);
    }
    let target, headers = {}, ttl, api;
    let m;
    if ((m = url.pathname.match(/^\/reinfolib\/(X[A-Z]{2}\d{3})$/))) {
      if (!env.REINFOLIB_KEY) return new Response("REINFOLIB_KEY is not set", { status: 500, headers: cors });
      target = REINFO + m[1] + url.search;
      api = m[1];
      headers["Ocp-Apim-Subscription-Key"] = env.REINFOLIB_KEY;
      ttl = 86400;
    } else if ((m = url.pathname.match(/^\/estat\/(get[A-Za-z]+)$/))) {
      const q = new URLSearchParams(url.search);
      if (!q.get("appId")) {
        if (!env.ESTAT_APPID) return new Response("ESTAT_APPID is not set", { status: 500, headers: cors });
        q.set("appId", env.ESTAT_APPID);
      }
      target = ESTAT + m[1] + "?" + q;
      api = m[1];
      ttl = 3600;
    } else if (url.pathname === "/estatgis/data") {
      const q = new URLSearchParams();
      for (const [k, re] of Object.entries(GIS_PARAMS)) {
        const v = url.searchParams.get(k);
        if (v && re.test(v)) q.set(k, v);
      }
      if (!q.get("downloadType") || !(q.get("statsId") || q.get("dlserveyId")) || !q.get("code")) return new Response("bad request", { status: 400, headers: cors });
      target = ESTAT_GIS + "?" + q;
      api = "estatgis";
      ttl = 30 * 86400; // 統計は確定値なので長めに残す
    } else {
      return new Response("not found", { status: 404, headers: cors });
    }

    // Cloudflare のキャッシュ（キーは API キーを含まない元の URL）
    const cache = caches.default;
    const cacheKey = new Request(url.toString(), { method: "GET" });
    let res = await cache.match(cacheKey);
    if (!res) {
      let up;
      try {
        // 応答がないまま待ち続けないよう打ち切る（タイル 25 秒。e-Stat は Cloudflare からだと 1 件でも数秒かかり、
        // 大きな統計表の取得はさらに時間がかかるので 100 秒）。User-Agent は明示する（付けないと拒否するサーバがある）
        up = await fetch(target, {
          headers: { ...headers, "User-Agent": "fieldnote-proxy/1.0 (+https://github.com/yusa-san/field_note)", Accept: "application/json, */*" },
          signal: AbortSignal.timeout(url.pathname.startsWith("/estat") ? 100000 : 25000),
          cf: { cacheTtl: ttl, cacheEverything: true },
        });
      } catch (e) {
        return json({ error: "upstream fetch failed", api, message: String(e && e.message || e) }, 502, cors);
      }
      // e-Stat はエラーでも HTTP 200 で返すので、中身を見てエラーはキャッシュしない
      let ok = up.ok, body = up.body;
      // 統計GIS は、データがない地域だと HTML の 404 を返す
      if (api === "estatgis" && (!up.ok || !/octet-stream|zip/.test(up.headers.get("Content-Type") || ""))) {
        return new Response("no data (estatgis)", { status: 404, headers: { ...cors, "Cache-Control": "no-store" } });
      }
      if (url.pathname.startsWith("/estat/")) {
        const text = await up.text();
        const st = Number((text.match(/"STATUS"\s*:\s*"?(\d+)/) || [])[1] ?? 0);
        if (st >= 100) ok = false;
        body = text;
      }
      res = new Response(body, up);
      res.headers.set("Cache-Control", ok ? `public, max-age=${ttl}` : "no-store");
      if (ok) ctx.waitUntil(cache.put(cacheKey, res.clone()).catch(() => {}));
    }
    const out = new Response(res.body, res);
    for (const [k, v] of Object.entries(cors)) out.headers.set(k, v);
    return out;
  },
};
