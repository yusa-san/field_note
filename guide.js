/* 使い方の案内（チュートリアル）
 * 初めて開いたときに 1 回だけ、地図の画面から、メモ一覧・見返す画面・保存/設定の中まで実際に開きながら、
 * 各部分を明るく抜き出して説明する。「保存/設定」→「設定」の「使い方」からもう一度見られる。
 * - 各段階に scene（開く画面）と target（明るくする部分）を持つ。画面は案内が開き、終わると閉じて地図に戻す
 * - 目印は data-guide / data-sec / id（英語表示でも変わらないもの）で探す
 * - メモがまだないときは、見返す画面は開かずに説明だけ出す
 */
const GUIDE_KEY = "fn.guideDone";
const gq = (sel) => document.querySelector(sel);
const gsec = (name) => gq(`#sheet-body [data-sec="${name}"]`);
const GUIDE_STEPS = [
  // ---- 地図
  { scene: "map", title: "フィールドノートへようこそ",
    body: "地図の上に、写真・メモ・聞き取り・軌跡を記録するアプリです。これから、記録のしかた、メモ一覧、見返す画面、保存/設定の中を、実際の画面で順に案内します。" },
  { scene: "map", target: () => ["#btn-add-here", "#btn-camera", "#btn-add-center"].map(gq), title: "記録する",
    body: "「現在地にメモ」はいる場所に、「中心にメモ」は地図の中心に、「撮影」は写真を撮ってその場所にメモを作ります。地図を長押ししても、その地点にメモを作れます。" },
  { scene: "map", target: () => gq("#fabs-right"), title: "右のボタン",
    body: "上から、日本語と英語の切り替え、地図の切替（背景の地図と重ねるデータ）、地名検索、距離と面積の計測、軌跡の記録、中心十字線、現在地（押すと追従・長押しで GPS の補正）、読み込み・書き出しです。" },
  // ---- メモ一覧
  { scene: "list", target: () => gq('[data-guide="list-tabs"]'), title: "メモ一覧",
    body: "下の「一覧」で開きます。「リスト」と「写真」で、メモの一覧と写真の並びを切り替えます。「写真」で写真を押すと、その写真から見返せます。" },
  { scene: "list", target: () => [gq('[data-guide="list-q"]'), gq('[data-guide="list-filter"]')], title: "探す・並べる",
    body: "キーワード（タイトル・メモ・タグ）とカテゴリで絞り込み、新しい順・番号順・近い順などで並べ替えます。「カテゴリ編集」で、カテゴリの名前・色・並び順を変えられます。" },
  { scene: "list", target: () => gq('[data-guide="list-opt"]'), title: "地図の見え方",
    body: "「色分け」は、ピンの色をカテゴリ別か記録者別にします。「地図にピンを表示」は、ピンを全部出すか、お気に入りだけか、出さないかを選びます。地図が見にくいときに使います。" },
  { scene: "list", target: () => gq("#sheet-body .memo-item"), title: "メモ",
    body: "メモを押すと、地図のその場所へ移動してポップアップを開きます。番号・カテゴリ・日時・写真の枚数と、今いる場所からの距離・方角が出ます。" },
  { scene: "list", target: () => gq("#sheet-body .sel-toggle"), title: "選択して整理",
    body: "押すと選ぶ状態になり、複数のメモをまとめて、カテゴリを変える・書き出す・削除することができます。" },
  { scene: "list", target: () => gq('[data-guide="list-play"]'), title: "見返す",
    body: "表示中のメモを番号順に、全画面で見返します。前回見ていたところから続きます。地図のピンを押して開くポップアップで、写真を押しても入れます。" },
  // ---- 見返す
  { scene: "pb", target: () => gq("#v-stage"), title: "見返す画面",
    body: "左右にスワイプ（または「‹」「›」）して前後のメモへ移ります。写真は 2 本指で拡大できます。写真のないメモは、文字のカードで出ます。" },
  { scene: "pb", target: () => [gq("#v-fav"), gq("#v-fav-size")], title: "お気に入り",
    body: "押すとお気に入りになり、地図でその写真をほかより大きく（初めは 3 倍）出します。横の数字で 2〜4 倍を選べます。もう一度押すと外れます。" },
  { scene: "pb", target: () => gq("#v-pb .v-mode"), title: "再生モード",
    body: "左から「最初から」「お気に入りだけ」「自動再生」と、自動再生の間隔です。間隔は押すたびに 2〜12 秒で変わります。自動再生中は、再生のボタンを押すと止まります。" },
  { scene: "pb", target: () => [gq("#v-pb .pb-cat"), gq("#v-count")], title: "カテゴリと番号",
    body: "カテゴリのボタンで、その場でカテゴリを変えられます。下の「3 / 21」のような数字を押すと、順番やメモの番号を指定して飛べます。" },
  { scene: "pb", target: () => [gq("#v-copy"), gq("#v-save")], title: "コピー・保存",
    body: "右上のボタンで、表示中の写真をコピー（元の画素数のまま。ほかのアプリに貼り付けられます）・保存（撮ったときのファイルのまま）できます。" },
  { scene: "pb", target: () => [gq("#v-map"), gq("#v-edit")], title: "地図・メモ",
    body: "「地図」でその場所の地図へ、「メモ」でメモの編集へ移ります。右上の × で閉じると、開いた画面に戻ります。" },
  // ---- 保存/設定
  { scene: "menu:save", target: () => gq("#sheet-body .menu-tabs"), title: "保存/設定",
    body: "下の「保存/設定」で開きます。「保存・印刷」「読み込み」「設定」の 3 つに分かれています。" },
  { scene: "menu:save", target: () => gsec("バックアップ"), title: "バックアップ",
    body: "ZIP（写真も入る）で全データを保存します。このアプリで読み戻せます。写真の画質を下げると、ファイルを小さくできます。端末内のデータはブラウザのデータ消去で消えるので、調査の区切りごとに書き出してください。" },
  { scene: "menu:save", target: () => gsec("ほかのアプリ向け"), title: "ほかのアプリ向け",
    body: "GeoJSON（QGIS などの GIS）、CSV（Excel などの表計算）、GPX（登山・GPS アプリ）で書き出します。" },
  { scene: "menu:save", target: () => [gsec("印刷・PDF・画像"), gsec("オフライン")], title: "印刷とオフライン",
    body: "用紙と縮尺を選んで、地図を印刷・PDF・画像にします。「オフライン」で、表示している範囲の地図を端末に保存しておくと、電波のない場所でも表示できます。" },
  { scene: "menu:load", target: () => gsec("メモ・軌跡を読み込む"), title: "読み込む",
    body: "書き出した ZIP・JSON などや、GPS ロガーの GPX を読み込みます。ほかの人のデータを記録者別に追加することも、自分のバックアップから戻すこともできます。" },
  { scene: "menu:load", target: () => [gsec("地点をまとめて入力"), gsec("写真をまとめて読み込む")], title: "まとめてメモを作る",
    body: "緯度・経度の一覧を貼り付けたり、位置情報付きの写真を選んだりして、まとめてメモを作れます。" },
  { scene: "menu:load", target: () => gsec("地図に重ねる"), title: "地図に重ねる",
    body: "GeoJSON・KML などのファイル、PDF や画像の地図、不動産情報ライブラリ、e-Stat の統計などを、メモにせず地図に重ねて表示します。" },
  { scene: "menu:settings", target: () => gsec("調査"), title: "調査",
    body: "調査名と記録者名は、書き出すファイルの名前とメモに記録されます。複数人で調査するときは、記録者名を入れておきます。" },
  { scene: "menu:settings", target: () => [gsec("カテゴリ"), gsec("地図のピン")], title: "カテゴリと地図のピン",
    body: "カテゴリの名前・色・並び順を変えられます。「地図のピン」では、色分け、ピンを出す範囲、重なるピンのまとめ方を選びます。" },
  { scene: "menu:settings", target: () => [gsec("GPS・方位の補正"), gsec("写真・聞き取り")], title: "GPS・写真・聞き取り",
    body: "GPS や方位がずれるときは「GPS・方位の補正」で直せます。「写真・聞き取り」では、端末に残す写真の大きさや、録音を文字にする方法を選びます。" },
  // ---- 地図に戻る
  { scene: "map", target: () => gq("#btn-data"), title: "読み込み・書き出し",
    body: "ZIP でのバックアップ（写真の画質も選べます）と、ファイルの読み込みは、このボタンからすぐにできます。" },
  { scene: "map", title: "案内はここまでです",
    body: "あとから「保存/設定」→「設定」の「使い方」で、もう一度見られます。" },
];

const GUIDE = { el: null, i: 0, scene: null, busy: false, saved: null };
function guideDone() {
  try { return !!localStorage.getItem(GUIDE_KEY); } catch { return true; }
}
const guideWait = (ms) => new Promise((r) => setTimeout(r, ms));
/** 案内が開いた画面を閉じ、地図・見返しの続き・設定のタブを元に戻す */
function guideClose() {
  GUIDE.el?.remove();
  GUIDE.el = null;
  GUIDE.ro?.disconnect();
  GUIDE.card = null;
  window.removeEventListener("resize", guideRender);
  try { localStorage.setItem(GUIDE_KEY, new Date().toISOString()); } catch {}
  if (GUIDE.scene && GUIDE.scene !== "map") guideLeave();
  const sv = GUIDE.saved;
  if (sv) {
    if (sv.pbLast === undefined) delete Settings.data.pbLast; else Settings.data.pbLast = sv.pbLast;
    Settings.save();
    try { if (sv.menuTab == null) localStorage.removeItem("fn.menuTab"); else localStorage.setItem("fn.menuTab", sv.menuTab); } catch {}
    if (sv.view) S.map.setView(sv.view.c, sv.view.z, { animate: false });
  }
  GUIDE.scene = null;
  GUIDE.saved = null;
}
function guideLeave() {
  if (!$("#viewer").hidden) { V.opts.playback = false; closeViewer(); } // 見返しを閉じても地図を動かさない
  if (!$("#sheet").hidden) closeSheet(true);
}
/** 段階に合わせて画面を開く */
async function guideScene(scene) {
  if (GUIDE.scene === scene) return;
  const [kind, tab] = scene.split(":");
  const prevKind = (GUIDE.scene || "").split(":")[0];
  if (!(kind === "menu" && prevKind === "menu")) guideLeave();
  GUIDE.scene = scene;
  if (kind === "list") { openList(); await guideWait(250); }
  else if (kind === "pb") {
    if (S.memos.size) { openPlayback(undefined, { startMemoId: [...S.memos.values()].sort((a, b) => (a.no || 0) - (b.no || 0)).find((m) => S.memoThumb.has(m.id))?.id }); await guideWait(350); }
  } else if (kind === "menu") {
    if (prevKind !== "menu") { await openMenu(); await guideWait(250); }
    gq(`#sheet-body .menu-tabs [data-k="${tab}"]`)?.click();
    await guideWait(150);
  }
}
function openGuide(start = 0) {
  if (GUIDE.el) guideClose();
  GUIDE.saved = {
    pbLast: Settings.data.pbLast,
    menuTab: (() => { try { return localStorage.getItem("fn.menuTab"); } catch { return null; } })(),
    view: S.map ? { c: S.map.getCenter(), z: S.map.getZoom() } : null,
  };
  GUIDE.scene = "map";
  GUIDE.el = h("div", { id: "guide", role: "dialog", "aria-modal": "true" });
  document.body.append(GUIDE.el);
  window.addEventListener("resize", guideRender);
  guideGo(start);
}
async function guideGo(i) {
  if (!GUIDE.el || GUIDE.busy) return;
  GUIDE.busy = true;
  try {
    GUIDE.i = Math.max(0, Math.min(GUIDE_STEPS.length - 1, i));
    const st = GUIDE_STEPS[GUIDE.i];
    await guideScene(st.scene);
    // 明るくする部分が画面の外なら、見えるところまで送る
    const els = guideTargets(st);
    if (els.length) {
      els[0].scrollIntoView({ block: window.innerHeight < 700 ? "start" : "center", behavior: "instant" }); // 低い画面では上に寄せて、説明を下に置く場所を空ける
      await guideWait(60);
    }
    guideRender();
  } finally {
    GUIDE.busy = false;
  }
}
function guideTargets(st) {
  if (!st.target) return [];
  if (st.scene === "pb" && !S.memos.size) return [];
  const t = st.target();
  return (Array.isArray(t) ? t : [t]).filter((el) => el && !el.closest("[hidden]") && el.getClientRects().length);
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
  // 明るくする範囲（画面に入る部分だけ）
  let box = null;
  const vw = window.innerWidth, vh = window.innerHeight;
  for (const el of guideTargets(st)) {
    const r = el.getBoundingClientRect();
    const b = { l: Math.max(0, r.left), t: Math.max(0, r.top), r: Math.min(vw, r.right), b: Math.min(vh, r.bottom) };
    if (b.r <= b.l || b.b <= b.t) continue;
    box = box ? { l: Math.min(box.l, b.l), t: Math.min(box.t, b.t), r: Math.max(box.r, b.r), b: Math.max(box.b, b.b) } : b;
  }
  const pad = 6;
  const hole = box ? h("div", { class: "guide-hole", style: `left:${box.l - pad}px;top:${box.t - pad}px;width:${box.r - box.l + pad * 2}px;height:${box.b - box.t + pad * 2}px` }) : h("div", { class: "guide-dim" });
  const noMemo = st.scene === "pb" && !S.memos.size;
  const back = h("button", { type: "button", class: "btn secondary", disabled: GUIDE.i === 0 }, "戻る");
  back.onclick = () => guideGo(GUIDE.i - 1);
  const next = h("button", { type: "button", class: "btn primary" }, GUIDE.i === n - 1 ? "はじめる" : "次へ");
  next.onclick = () => (GUIDE.i === n - 1 ? guideClose() : guideGo(GUIDE.i + 1));
  const skip = h("button", { type: "button", class: "guide-skip" }, "案内を終える");
  skip.onclick = guideClose;
  const bar = h("div", { class: "guide-prog" }, h("i", { style: `width:${((GUIDE.i + 1) / n) * 100}%` }));
  const card = h("div", { class: "guide-card" },
    h("div", { class: "guide-top" }, h("span", { class: "guide-step" }, `${GUIDE.i + 1} / ${n}`), skip),
    bar,
    h("h3", {}, st.title),
    h("p", {}, st.body),
    noMemo ? h("p", { class: "guide-note" }, "メモを記録すると、この画面を実際に開いて案内します。") : null,
    h("div", { class: "guide-foot" }, back, next));
  root.replaceChildren(hole, card);
  GUIDE.box = box ? { ...box, pad } : null;
  GUIDE.card = card;
  guidePlace();
  // フォントの読み込みなどで高さが変わったら置き直す
  GUIDE.ro?.disconnect();
  if (window.ResizeObserver) { GUIDE.ro = new ResizeObserver(() => guidePlace()); GUIDE.ro.observe(card); }
  next.focus({ preventScroll: true });
}
/** 説明の位置：明るくした部分と重ならない側（上下で入る方）。どちらにも入りきらなければ広い方に入る高さにし、
 *  説明はカードの中で送る。対象が画面のほとんどを占めるときは重ねる */
function guidePlace() {
  const card = GUIDE.card, box = GUIDE.box;
  if (!card || !card.isConnected) return;
  const vh = window.innerHeight, m = 12;
  card.style.maxHeight = "";
  let ch = card.offsetHeight, top;
  if (box) {
    const pad = box.pad, above = box.t - pad - m * 2, below = vh - (box.b + pad) - m * 2;
    if (below >= ch) top = box.b + pad + m;
    else if (above >= ch) top = box.t - pad - m - ch;
    else if (Math.max(above, below) >= 200) {
      card.style.maxHeight = `${Math.max(above, below)}px`;
      ch = card.offsetHeight;
      top = below >= above ? box.b + pad + m : box.t - pad - m - ch;
    } else top = (box.t + box.b) / 2 < vh / 2 ? vh - ch - m : m;
  } else top = (vh - ch) / 2;
  const t = `${Math.round(Math.max(m, Math.min(vh - ch - m, top)))}px`;
  if (card.style.top !== t) card.style.top = t;
}
document.addEventListener("keydown", (e) => {
  if (!GUIDE.el) return;
  e.stopPropagation(); // 見返す画面などのキー操作に渡さない
  if (e.key === "Escape") guideClose();
  else if (e.key === "ArrowRight" || e.key === "Enter") { e.preventDefault(); GUIDE.el.querySelector(".guide-foot .btn.primary")?.click(); }
  else if (e.key === "ArrowLeft") guideGo(GUIDE.i - 1);
}, true);
