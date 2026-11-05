/* 画面に出る日本語の断片を、JS の構文木（acorn）から取り出す（英語の辞書 tools/i18n_en.json の訳し漏れを探す）
 *   npm i --no-save acorn acorn-walk
 *   node tools/i18n_extract.js . /tmp/frags.json
 *   python3 tools/build_i18n.py --missing /tmp/frags.json   # 訳がない断片を書き出す
 *   python3 tools/build_i18n.py                             # tools/i18n_en.json → i18n-en.js
 */
const acorn = require("acorn"), walk = require("acorn-walk"), fs = require("fs"), path = require("path");
const [ROOT, OUT] = process.argv.slice(2);
const JP = /[぀-ヿ㐀-鿿ｦ-ﾟ々〆]/;
const SKIP = new Set(["estat-gis-catalog.js", "reinfo-catalog.js", "extra-data.js", "sw.js", "asr-worker.js", "i18n.js", "i18n-en.js"]);
const frags = new Map();
function add(fr, ctx, file, pre, post) {
  fr = fr.trim();
  if (!fr || !JP.test(fr)) return;
  if (!frags.has(fr)) frags.set(fr, { ctx: ctx.slice(0, 240), file, pre, post });
}
function pieces(str) { return str.split(/<[^>]*>|\n/); }
for (const f of fs.readdirSync(ROOT).filter((x) => x.endsWith(".js") && !SKIP.has(x)).sort()) {
  const src = fs.readFileSync(path.join(ROOT, f), "utf8");
  const ast = acorn.parse(src, { ecmaVersion: "latest", sourceType: "script", allowHashBang: true });
  const line = (n) => { const a = src.lastIndexOf("\n", n.start) + 1, b = src.indexOf("\n", n.end); return src.slice(a, b < 0 ? undefined : b).trim(); };
  walk.fullAncestor(ast, (node, _st, anc) => {
    const parent = anc[anc.length - 2];
    if (node.type === "Literal" && typeof node.value === "string" && JP.test(node.value)) {
      if (parent && parent.type === "Property" && parent.key === node && !parent.computed) return; // オブジェクトのキー
      if (parent && parent.type === "NewExpression" && parent.callee.name === "RegExp") return;
      const ps = pieces(node.value);
      ps.forEach((p) => add(p, line(node), f, false, false));
    } else if (node.type === "TemplateLiteral") {
      if (parent && parent.type === "TaggedTemplateExpression") return;
      const qs = node.quasis.map((q) => q.value.cooked ?? q.value.raw);
      if (!qs.some((q) => JP.test(q))) return;
      const ctx = src.slice(node.start, node.end).replace(/\$\{[^`]*?\}/g, "${…}");
      qs.forEach((q, qi) => {
        const ps = pieces(q);
        ps.forEach((p, k) => add(p, ctx, f, qi > 0 && k === 0, qi < qs.length - 1 && k === ps.length - 1));
      });
    }
  });
}
// index.html
let html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8").replace(/<script[\s\S]*?<\/script>/g, "").replace(/<!--[\s\S]*?-->/g, "");
for (const m of html.matchAll(/>([^<]+)</g)) add(m[1], m[1], "index.html", false, false);
for (const m of html.matchAll(/(?:title|aria-label|placeholder|alt)="([^"]+)"/g)) add(m[1], m[1], "index.html", false, false);
const items = [...frags].map(([ja, v]) => ({ ja, ...v }));
fs.writeFileSync(OUT, JSON.stringify(items, null, 0));
console.log(items.length, items.reduce((s, i) => s + i.ja.length, 0));
