/* フィールドノート用の中継サーバ（Cloudflare Workers）
 *
 * - /reinfolib/XKT002?response_format=pbf&z=..&x=..&y=..  → 不動産情報ライブラリ API（API キーを付けて中継）
 * - /estat/getStatsList?... など                          → e-Stat API（appId を付けて中継）
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
    let target, headers = {}, ttl;
    let m;
    if ((m = url.pathname.match(/^\/reinfolib\/(X[A-Z]{2}\d{3})$/))) {
      if (!env.REINFOLIB_KEY) return new Response("REINFOLIB_KEY is not set", { status: 500, headers: cors });
      target = REINFO + m[1] + url.search;
      headers["Ocp-Apim-Subscription-Key"] = env.REINFOLIB_KEY;
      ttl = 86400;
    } else if ((m = url.pathname.match(/^\/estat\/(get[A-Za-z]+)$/))) {
      const q = new URLSearchParams(url.search);
      if (!q.get("appId")) {
        if (!env.ESTAT_APPID) return new Response("ESTAT_APPID is not set", { status: 500, headers: cors });
        q.set("appId", env.ESTAT_APPID);
      }
      target = ESTAT + m[1] + "?" + q;
      ttl = 3600;
    } else {
      return new Response("not found", { status: 404, headers: cors });
    }

    // Cloudflare のキャッシュ（キーは API キーを含まない元の URL）
    const cache = caches.default;
    const cacheKey = new Request(url.toString(), { method: "GET" });
    let res = await cache.match(cacheKey);
    if (!res) {
      const up = await fetch(target, { headers, cf: { cacheTtl: ttl, cacheEverything: true } });
      res = new Response(up.body, up);
      res.headers.set("Cache-Control", up.ok ? `public, max-age=${ttl}` : "no-store");
      if (up.ok) ctx.waitUntil(cache.put(cacheKey, res.clone()));
    }
    const out = new Response(res.body, res);
    for (const [k, v] of Object.entries(cors)) out.headers.set(k, v);
    return out;
  },
};
