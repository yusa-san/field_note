/* 使い方の案内（チュートリアル）
 * 初めて開いたときに 1 回だけ、主な画面（記録・メモ一覧・見返す・保存/設定・読み込み/書き出し・言語）を順に紹介する。
 * 案内する画面のボタンを明るく抜き出し、その近くに説明を出す。「保存/設定」→「設定」の「使い方」からもう一度見られる。
 */
const GUIDE_KEY = "fn.guideDone";
const GUIDE_STEPS = [
  {
    title: "フィールドノートへようこそ",
    body: "地図の上に、写真・メモ・聞き取り・軌跡を記録するアプリです。主な使い方を順に紹介します。あとから「保存/設定」→「設定」の「使い方」でもう一度見られます。",
  },
  {
    sel: ["#btn-add-here", "#btn-camera", "#btn-add-center"],
    title: "記録する",
    body: "「現在地にメモ」「撮影」「中心にメモ」で、その場所にメモを作ります。メモには写真・録音・カテゴリ・タグを付けられます。",
  },
  {
    sel: ["#btn-list"],
    title: "メモ一覧",
    body: "記録したメモの一覧です。「リスト」と「写真」で表示を切り替え、キーワードやカテゴリで絞り込めます。メモを選ぶと、地図のその場所へ移動します。「選択して整理」でまとめて分類・削除でき、「色分け」「地図にピンを表示」もここで切り替えられます。",
  },
  {
    sel: ["#btn-list"],
    title: "見返す",
    body: "メモ一覧の「見返す」か、地図のピンを押して開く小窓の写真を押すと、写真やメモを番号順に全画面で見返せます。左右にスワイプして切り替え、「お気に入り」を付けると地図で大きく表示されます。右下の再生モードで、最初から・お気に入りだけ・自動再生を選べます。",
  },
  {
    sel: ["#btn-menu"],
    title: "保存/設定",
    body: "データの書き出し（バックアップ）と読み込み、地図に重ねる統計などのデータ、印刷、カテゴリや記録者名の設定はここにあります。「!」は、前回の書き出しのあとに追加・変更があるしるしです。",
  },
  {
    sel: ["#btn-data"],
    title: "読み込み・書き出し",
    body: "ZIP でのバックアップ（写真の画質も選べます）と、ファイルの読み込みは、このボタンからすぐにできます。端末内のデータはブラウザのデータ消去で消えるので、調査の区切りごとに書き出してください。",
  },
  {
    sel: ["#btn-lang", "#btn-layers"],
    title: "言語と地図",
    body: "いちばん上のボタンで日本語と英語を切り替えられます。その下のボタンで、背景の地図（地理院地図・航空写真など）を選べます。",
  },
];

const GUIDE = { el: null, i: 0 };
function guideDone() {
  try { return !!localStorage.getItem(GUIDE_KEY); } catch { return true; }
}
function guideClose() {
  GUIDE.el?.remove();
  GUIDE.el = null;
  window.removeEventListener("resize", guideRender);
  try { localStorage.setItem(GUIDE_KEY, new Date().toISOString()); } catch {}
}
function openGuide(start = 0) {
  if (GUIDE.el) guideClose();
  GUIDE.i = start;
  GUIDE.el = h("div", { id: "guide", role: "dialog", "aria-modal": "true" });
  document.body.append(GUIDE.el);
  window.addEventListener("resize", guideRender);
  guideRender();
}
/** 初めて開いたときだけ（ほかの画面が開いていなければ） */
function maybeOpenGuide() {
  if (guideDone()) return;
  const tryOpen = (n = 0) => {
    const busy = !$("#sheet").hidden || !$("#viewer").hidden || document.querySelector("#busy");
    if (busy && n < 20) return setTimeout(() => tryOpen(n + 1), 1500);
    if (!busy) openGuide(0);
  };
  setTimeout(tryOpen, 900);
}
function guideRender() {
  const root = GUIDE.el;
  if (!root) return;
  const st = GUIDE_STEPS[GUIDE.i];
  const n = GUIDE_STEPS.length;
  // 案内するボタンを囲む範囲
  let box = null;
  for (const sel of st.sel || []) {
    const el = document.querySelector(sel);
    if (!el || el.hidden) continue;
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    box = box ? { l: Math.min(box.l, r.left), t: Math.min(box.t, r.top), r: Math.max(box.r, r.right), b: Math.max(box.b, r.bottom) } : { l: r.left, t: r.top, r: r.right, b: r.bottom };
  }
  const pad = 6;
  const hole = box ? h("div", { class: "guide-hole", style: `left:${box.l - pad}px;top:${box.t - pad}px;width:${box.r - box.l + pad * 2}px;height:${box.b - box.t + pad * 2}px` }) : h("div", { class: "guide-dim" });
  const dots = h("div", { class: "guide-dots" }, ...GUIDE_STEPS.map((_, k) => h("i", { class: k === GUIDE.i ? "on" : "" })));
  const back = h("button", { type: "button", class: "btn secondary", disabled: GUIDE.i === 0 }, "戻る");
  back.onclick = () => { GUIDE.i = Math.max(0, GUIDE.i - 1); guideRender(); };
  const next = h("button", { type: "button", class: "btn primary" }, GUIDE.i === n - 1 ? "はじめる" : "次へ");
  next.onclick = () => { if (GUIDE.i === n - 1) guideClose(); else { GUIDE.i++; guideRender(); } };
  const skip = h("button", { type: "button", class: "guide-skip" }, "スキップ");
  skip.onclick = guideClose;
  const card = h("div", { class: "guide-card" },
    h("div", { class: "guide-top" }, h("span", { class: "guide-step" }, `${GUIDE.i + 1} / ${n}`), skip),
    h("h3", {}, st.title),
    h("p", {}, st.body),
    h("div", { class: "guide-foot" }, dots, h("span", { style: "flex:1" }), back, next));
  root.replaceChildren(hole, card);
  // 説明の位置：案内するボタンが下半分なら上に、上半分なら下に
  const vh = window.innerHeight, m = 12;
  if (box) {
    const ch = card.offsetHeight;
    const below = box.b + pad + m, above = box.t - pad - m - ch;
    const top = (box.t + box.b) / 2 > vh / 2 ? Math.max(m, above) : Math.min(vh - ch - m, below);
    card.style.top = `${top}px`;
  } else {
    card.style.top = `${Math.max(m, (vh - card.offsetHeight) / 2)}px`;
  }
  next.focus({ preventScroll: true });
}
document.addEventListener("keydown", (e) => {
  if (!GUIDE.el) return;
  if (e.key === "Escape") guideClose();
  else if (e.key === "ArrowRight" || e.key === "Enter") { e.preventDefault(); GUIDE.el.querySelector(".guide-foot .btn.primary")?.click(); }
  else if (e.key === "ArrowLeft") { GUIDE.i = Math.max(0, GUIDE.i - 1); guideRender(); }
});
