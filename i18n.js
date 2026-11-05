/* 日本語／英語の切り替え
 *
 * 画面の文字は日本語でコードに書いてあるので、英語のときは「表示されている文字」を辞書（i18n-en.js：日本語の断片 → 英語）で
 * 置き換える。データ（メモ・カテゴリ・書き出すファイルの中身）は変えない。
 * - 画面に文字が入るたび（MutationObserver）に、文字・title・placeholder・aria-label・alt を訳す
 * - alert・confirm・prompt と、印刷などで canvas に書く文字も訳す
 * - 訳しきれない（日本語が残る）文字は、混ぜずに日本語のまま出す（地名・統計の項目名・メモの中身など）
 * - 「」で囲んだ名前（メモ名・レイヤ名など）はそのまま残して、まわりだけ訳す
 * 切り替えはページを読み直す（英語 → 日本語も、元の文字に確実に戻すため）
 */
const I18N = (() => {
  let lang = "ja";
  try {
    const st = JSON.parse(localStorage.getItem("fn.settings") || "{}");
    lang = st.lang === "en" || st.lang === "ja" ? st.lang : /^ja\b/i.test(navigator.language || "ja") ? "ja" : "en";
  } catch {}
  return { lang, dict: null, re: null, cache: new Map() };
})();
if (I18N.lang === "en") {
  document.documentElement.lang = "en";
  // 辞書は英語のときだけ読む（パース中に同期で読み込む）
  document.write('<script src="i18n-en.js"><\/script>');
}

const JA_RE = /[\u3040-\u30fa\u30fc-\u30ff\u3400-\u9fff\uff66-\uff9f々〆]/; // 「・」（区切りの記号）は日本語の文字に数えない
/** 数のあとの単位（辞書で訳しきれずに残ったもの） */
const I18N_UNITS = [
  [/(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/g, "$1-$2-$3"], [/(\d{4})\s*年\s*(\d{1,2})\s*月/g, "$1-$2"],
  [/(\d)\s*件/g, "$1"], [/(\d)\s*枚/g, "$1 photos"], [/(\d)\s*本/g, "$1"], [/(\d)\s*点/g, "$1 pts"], [/(\d)\s*個/g, "$1"],
  [/(\d)\s*か所/g, "$1 places"], [/(\d)\s*箇所/g, "$1 places"], [/(\d)\s*時間/g, "$1 h"], [/(\d)\s*分/g, "$1 min"], [/(\d)\s*秒/g, "$1 s"],
  [/(\d)\s*日/g, "$1 d"], [/(\d)\s*か月/g, "$1 mo"], [/(\d)\s*年/g, "$1"], [/(\d)\s*倍/g, "$1×"], [/(\d)\s*回/g, "$1×"], [/(\d)\s*段階/g, "$1 levels"],
];
const I18N_PUNCT = [
  [/（/g, " ("], [/）/g, ") "], [/：/g, ": "], [/、/g, ", "], [/。/g, ". "], [/「|『/g, "“"], [/」|』/g, "”"], [/・/g, " / "],
  [/／/g, " / "], [/　/g, " "], [/～|〜/g, "–"], [/！/g, "! "], [/？/g, "? "], [/＋/g, "+"], [/－/g, "-"], [/％/g, "%"], [/＃/g, "#"],
  [/…/g, "…"], [/→/g, "→"],
];
function i18nBuild() {
  if (I18N.re || !I18N.dict) return;
  // 1 文字の断片（「件」「地」など）は、ほかの文字の一部を置き換えてしまうので、まるごと一致のときだけ使う
  const keys = Object.keys(I18N.dict).filter((k) => I18N.dict[k] != null && JA_RE.test(k) && k.length > 1).sort((a, b) => b.length - a.length);
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  I18N.re = keys.length ? new RegExp(keys.map(esc).join("|"), "g") : null;
}
/** 日本語の文字を英語に（訳しきれなければ null） */
function i18nFull(s) {
  const d = I18N.dict;
  const t = s.trim();
  if (d[t] != null) return d[t];
  i18nBuild();
  let out = I18N.re ? s.replace(I18N.re, (m) => d[m]) : s;
  for (const [re, to] of I18N_UNITS) out = out.replace(re, to);
  return JA_RE.test(out) ? null : out;
}
/** 画面に出す文字を訳す（日本語のときはそのまま） */
function tr(s) {
  if (I18N.lang !== "en" || !I18N.dict || typeof s !== "string" || !JA_RE.test(s)) return s;
  const hit = I18N.cache.get(s);
  if (hit !== undefined) return hit;
  let out;
  if (s.includes("\n")) out = s.split("\n").map((l) => tr(l)).join("\n");
  else {
    // 「」で囲んだ名前は残し、まわりだけ訳す（名前も辞書にあれば訳す）
    const keep = [];
    const masked = s.replace(/「([^「」\n]{1,80})」|『([^『』\n]{1,80})』/g, (m, a, b) => {
      const inner = a ?? b;
      const t = JA_RE.test(inner) ? i18nFull(inner) : inner;
      keep.push(t ?? inner);
      return `${keep.length - 1}`;
    });
    let body = i18nFull(masked);
    if (body == null) out = s;
    else {
      const lead = s.match(/^\s*/)[0], tail = s.match(/\s*$/)[0];
      for (const [re, to] of I18N_PUNCT) body = body.replace(re, to);
      body = body.replace(/(\d+)/g, (_, i) => `“${keep[Number(i)]}”`);
      body = body.replace(/ {2,}/g, " ").replace(/\( /g, "(").replace(/ \)/g, ")").replace(/ ([,.:;!?])/g, "$1").replace(/\) ([,.:)])/g, ")$1").trim();
      out = lead + body + tail;
    }
  }
  if (I18N.cache.size > 20000) I18N.cache.clear();
  I18N.cache.set(s, out);
  return out;
}

(() => {
  if (I18N.lang !== "en") return;
  const ATTRS = ["title", "placeholder", "aria-label", "alt"];
  const SKIP = 'textarea, script, style, [translate="no"], [contenteditable="true"]';
  const ready = () => !!I18N.dict;
  const doText = (n) => {
    const v = n.nodeValue;
    if (!v || !JA_RE.test(v)) return;
    const p = n.parentElement;
    if (p && p.closest(SKIP)) return;
    const t = tr(v);
    if (t !== v) n.nodeValue = t;
  };
  const doAttrs = (el) => {
    if (el.closest?.('[translate="no"]')) return;
    for (const a of ATTRS) {
      const v = el.getAttribute?.(a);
      if (v && JA_RE.test(v)) { const t = tr(v); if (t !== v) el.setAttribute(a, t); }
    }
  };
  const walk = (root) => {
    if (root.nodeType === 3) return doText(root);
    if (root.nodeType !== 1 && root.nodeType !== 11) return;
    if (root.nodeType === 1) { if (root.matches(SKIP)) return; doAttrs(root); }
    const tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
    let n;
    while ((n = tw.nextNode())) n.nodeType === 3 ? doText(n) : doAttrs(n);
  };
  const mo = new MutationObserver((recs) => {
    if (!ready()) return;
    for (const r of recs) {
      if (r.type === "characterData") doText(r.target);
      else if (r.type === "attributes") doAttrs(r.target);
      else for (const n of r.addedNodes) walk(n);
    }
  });
  mo.observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS });
  // <template> の中身（複製されたときに上の監視で訳す）・タイトル
  const start = () => { if (ready()) { walk(document.body); document.title = tr(document.title); } };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
  // ダイアログ
  for (const k of ["alert", "confirm", "prompt"]) {
    const f = window[k].bind(window);
    window[k] = (msg, ...rest) => f(typeof msg === "string" ? tr(msg) : msg, ...rest);
  }
  // canvas に書く文字（印刷の凡例・計測の文字など）
  for (const C of [window.CanvasRenderingContext2D, window.OffscreenCanvasRenderingContext2D]) {
    if (!C) continue;
    for (const k of ["fillText", "strokeText", "measureText"]) {
      const f = C.prototype[k];
      C.prototype[k] = function (text, ...rest) { return f.call(this, typeof text === "string" ? tr(text) : text, ...rest); };
    }
  }
})();

/** 言語の切り替えボタン（レイヤボタンの上） */
document.addEventListener("DOMContentLoaded", () => {
  const b = document.getElementById("btn-lang");
  if (!b) return;
  const en = I18N.lang === "en";
  b.textContent = en ? "日本語" : "EN";
  b.title = en ? "日本語に切り替え" : "Switch to English";
  b.setAttribute("aria-label", b.title);
  b.classList.toggle("ja", en);
  b.onclick = () => {
    const next = en ? "ja" : "en";
    try {
      if (window.Settings?.data) { Settings.data.lang = next; Settings.save(); }
      else {
        const st = JSON.parse(localStorage.getItem("fn.settings") || "{}");
        st.lang = next;
        localStorage.setItem("fn.settings", JSON.stringify(st));
      }
    } catch {}
    location.reload();
  };
});
