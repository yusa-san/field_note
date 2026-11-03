/* フィールドノート — メモ入力の道具
 * - カテゴリの管理（追加・名前変更・色・削除）
 * - 聞き取り用のボイスレコーダー（録音＋リアルタイム書き起こし）
 * app.js より先に読み込む（ここではトップレベルで app.js の値を使わない）
 */
"use strict";

/* ====================================================================
 * カテゴリ
 * ==================================================================== */
function catNextColor() {
  const used = new Set(Object.values(Settings.data.catColors || {}));
  return PALETTE.find((c) => !used.has(c)) || PALETTE[Settings.data.categories.length % PALETTE.length];
}
function catCount(name) {
  let n = 0;
  for (const m of S.memos.values()) if (m.category === name) n++;
  return n;
}
/** 指定カテゴリのメモをまとめて書き換えて保存 */
async function catRewriteMemos(from, to) {
  const now = nowIso();
  for (const m of S.memos.values()) {
    if (m.category !== from) continue;
    m.category = to;
    m.updatedAt = now;
    await DB.put("memos", m);
    renderMarker(m);
  }
  updateCounts();
}
function catAdd(name) {
  name = (name || "").trim();
  if (!name) return null;
  if (!Settings.data.categories.includes(name)) {
    Settings.data.categories.push(name);
    Settings.data.catColors[name] = Settings.data.catColors[name] || catNextColor();
    Settings.save();
  }
  return name;
}
async function catRename(from, to) {
  to = (to || "").trim();
  const cats = Settings.data.categories;
  if (!to || to === from) return from;
  if (cats.includes(to)) {
    if (!confirm(`「${to}」は既にあります。「${from}」のメモを「${to}」にまとめますか？`)) return from;
    cats.splice(cats.indexOf(from), 1);
  } else {
    cats[cats.indexOf(from)] = to;
    Settings.data.catColors[to] = Settings.data.catColors[from];
  }
  delete Settings.data.catColors[from];
  Settings.save();
  await catRewriteMemos(from, to);
  return to;
}
/** 削除。使っているメモがあれば移し先を確認して移す。移し先（なければ null）を返す */
async function catDelete(name) {
  const cats = Settings.data.categories;
  if (cats.length <= 1) { toast("カテゴリは 1 つ以上必要です"); return undefined; }
  const n = catCount(name);
  const others = cats.filter((c) => c !== name);
  const target = others.includes("その他") ? "その他" : others[others.length - 1];
  if (n && !confirm(`「${name}」のメモ ${n} 件を「${target}」に移して、カテゴリを削除しますか？`)) return undefined;
  if (!n && !confirm(`カテゴリ「${name}」を削除しますか？`)) return undefined;
  cats.splice(cats.indexOf(name), 1);
  delete Settings.data.catColors[name];
  Settings.save();
  if (n) await catRewriteMemos(name, target);
  return n ? target : null;
}
function catSetColor(name, color) {
  Settings.data.catColors[name] = color;
  Settings.save();
  for (const m of S.memos.values()) if (m.category === name) renderMarker(m);
}
function catMove(name, dir) {
  const cats = Settings.data.categories, i = cats.indexOf(name), j = i + dir;
  if (i < 0 || j < 0 || j >= cats.length) return;
  [cats[i], cats[j]] = [cats[j], cats[i]];
  Settings.save();
}

/**
 * カテゴリ編集パネル（メモ画面・一覧・設定で共用）
 * onChange({ type: "add"|"rename"|"delete"|"color"|"move", from, to })
 */
function categoryManager(onChange = () => {}, { focusAdd = false } = {}) {
  const box = h("div", { class: "cat-mgr" });
  const render = () => {
    box.replaceChildren();
    for (const c of Settings.data.categories) {
      const color = catColor(c);
      const dot = h("button", { type: "button", class: "cat-dot", style: `background:${color}`, title: "色を変える", "aria-label": "色を変える" });
      dot.onclick = () => {
        const i = PALETTE.indexOf(color);
        catSetColor(c, PALETTE[(i + 1) % PALETTE.length]);
        render();
        onChange({ type: "color", from: c, to: c });
      };
      const name = h("input", { type: "text", value: c, "aria-label": "カテゴリ名" });
      const commit = async () => {
        const to = name.value.trim();
        if (!to || to === c) { name.value = c; return; }
        const r = await catRename(c, to);
        render();
        onChange({ type: "rename", from: c, to: r });
      };
      name.onchange = commit;
      name.onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); name.blur(); } };
      const n = catCount(c);
      const up = h("button", { type: "button", class: "icon-mini", "aria-label": "上へ", onclick: () => { catMove(c, -1); render(); onChange({ type: "move" }); } }, "↑");
      const del = h("button", { type: "button", class: "icon-mini danger", "aria-label": "削除" }, "削除");
      del.onclick = async () => {
        const r = await catDelete(c);
        if (r === undefined) return;
        render();
        onChange({ type: "delete", from: c, to: r });
      };
      box.append(h("div", { class: "cat-row" }, dot, name, h("span", { class: "cat-n" }, n ? `${n}件` : ""), up, del));
    }
    const add = h("input", { type: "text", placeholder: "新しいカテゴリ名" });
    const form = h("form", { class: "cat-add" }, add, h("button", { type: "submit", class: "chip on" }, "追加"));
    form.onsubmit = (e) => {
      e.preventDefault();
      const name = catAdd(add.value);
      if (!name) return;
      render();
      onChange({ type: "add", to: name });
      setTimeout(() => box.querySelector(".cat-add input")?.focus(), 0);
    };
    box.append(form, h("div", { class: "note" }, "名前を書き換えると、そのカテゴリのメモもまとめて変わります。色の丸をタップで色を変更、↑で並び替え。"));
    if (focusAdd) setTimeout(() => add.focus(), 50);
    focusAdd = false;
  };
  render();
  return box;
}

/* ====================================================================
 * ボイスレコーダー（聞き取り）
 * 録音は MediaRecorder で端末内に保存。書き起こしはブラウザの音声認識（Web Speech API）を使う。
 * ※ Android の Chrome などでは音声認識の音声はサーバー（Google）に送られて処理される。録音データ自体は送らない。
 * ==================================================================== */
const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
const VOICE_MODES = { both: "録音＋書き起こし", rec: "録音のみ", asr: "書き起こしのみ" };
const audioExt = (mime) => (/mp4|m4a|aac/.test(mime) ? "m4a" : /ogg/.test(mime) ? "ogg" : /mpeg/.test(mime) ? "mp3" : /wav/.test(mime) ? "wav" : "webm");
function pickAudioMime() {
  if (typeof MediaRecorder === "undefined") return null;
  for (const t of ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"]) if (MediaRecorder.isTypeSupported?.(t)) return t;
  return "";
}
const fmtDur = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

class VoiceSession {
  /** cb: { onFinal(text), onInterim(text), onState(msg, level) } */
  constructor(mode, cb) {
    this.mode = mode;
    this.cb = cb;
    this.active = false;
    this.asrOk = mode !== "rec";
  }
  async start() {
    const wantRec = this.mode !== "asr", wantAsr = this.mode !== "rec";
    if (wantAsr && !SpeechRec) {
      if (this.mode === "asr") throw new Error("このブラウザは音声の書き起こしに対応していません（Android の Chrome、iPhone の Safari などで使えます）");
      this.asrOk = false;
      this.cb.onState("このブラウザは書き起こしに対応していないため、録音のみ行います", "warn");
    }
    if (wantRec) {
      if (pickAudioMime() === null) throw new Error("このブラウザは録音に対応していません");
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      const mime = pickAudioMime();
      this.rec = new MediaRecorder(this.stream, mime ? { mimeType: mime } : undefined);
      this.chunks = [];
      this.rec.ondataavailable = (e) => e.data && e.data.size && this.chunks.push(e.data);
      this.rec.start(1000);
    }
    this.active = true;
    this.t0 = Date.now();
    try { if ("wakeLock" in navigator) this.wake = await navigator.wakeLock.request("screen"); } catch {}
    if (this.asrOk) this._startAsr();
  }
  _startAsr() {
    if (!this.active || !this.asrOk) return;
    const r = (this.asr = new SpeechRec());
    r.lang = "ja-JP";
    r.continuous = true;
    r.interimResults = true;
    r.onresult = (e) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        if (res.isFinal) this.cb.onFinal(res[0].transcript.trim());
        else interim += res[0].transcript;
      }
      this.cb.onInterim(interim);
    };
    r.onerror = (e) => {
      if (e.error === "no-speech" || e.error === "aborted") return;
      if (e.error === "network") { this.cb.onState("書き起こしには通信が必要です（録音は続けています）", "warn"); return; }
      // マイクを録音と同時に使えない端末など
      this.asrOk = false;
      this.cb.onState(this.mode === "asr"
        ? `書き起こしを開始できません（${e.error}）`
        : `この端末では録音と同時に書き起こせないため、録音のみ続けています（${e.error}）。書き起こしは「書き起こしのみ」で使えます`, "warn");
    };
    // 無音が続くと自動で止まるので、録音中は再開し続ける
    r.onend = () => { this.cb.onInterim(""); if (this.active && this.asrOk) setTimeout(() => this._startAsr(), 250); };
    try { r.start(); } catch {}
  }
  /** 止めて、録音があれば { blob, mime, duration } を返す */
  async stop() {
    this.active = false;
    try { this.asr && this.asr.stop(); } catch {}
    try { this.wake && (await this.wake.release()); } catch {}
    const duration = (Date.now() - this.t0) / 1000;
    if (!this.rec) return null;
    const done = new Promise((res) => (this.rec.onstop = res));
    try { this.rec.stop(); } catch {}
    await done;
    this.stream.getTracks().forEach((t) => t.stop());
    const mime = (this.rec.mimeType || "audio/webm").split(";")[0];
    const blob = new Blob(this.chunks, { type: mime });
    return blob.size ? { blob, mime, duration } : null;
  }
  elapsed() { return (Date.now() - this.t0) / 1000; }
}

/**
 * メモ画面の「聞き取り」欄：録音ボタン・書き起こし・録音一覧
 * ctx: { memo, textarea, markDirty, existing: [audio], onRecorded(audio) , onRemove(id) }
 */
function voicePanel(ctx) {
  const modeSel = h("select", { class: "voice-mode" }, ...Object.entries(VOICE_MODES).map(([v, t]) => h("option", { value: v, selected: (Settings.data.voiceMode || "both") === v }, t)));
  modeSel.onchange = () => { Settings.data.voiceMode = modeSel.value; Settings.save(); };
  const btn = h("button", { type: "button", class: "btn secondary voice-btn" }, "聞き取りを開始");
  const status = h("div", { class: "voice-status" });
  const live = h("div", { class: "voice-live", hidden: true });
  const list = h("div", { class: "audio-list" });
  let sess = null, timer = null;

  const append = (text) => {
    if (!text) return;
    const ta = ctx.textarea;
    const end = /[。．.!?！？、\n]$/.test(text) ? "" : "。";
    ta.value += text + end;
    ta.scrollTop = ta.scrollHeight;
    ctx.markDirty();
  };
  const header = () => {
    const ta = ctx.textarea, d = new Date();
    ta.value += `${ta.value && !ta.value.endsWith("\n") ? "\n" : ""}【聞き取り ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}】\n`;
    ctx.markDirty();
  };
  const setIdle = () => {
    btn.textContent = "聞き取りを開始";
    btn.classList.remove("recording");
    modeSel.disabled = false;
    live.hidden = true;
    clearInterval(timer);
  };
  const start = async () => {
    status.textContent = "";
    status.className = "voice-status";
    const mode = modeSel.value;
    sess = new VoiceSession(mode, {
      onFinal: append,
      onInterim: (t) => { live.hidden = !t; live.textContent = t; },
      onState: (msg, level) => { status.textContent = msg; status.className = "voice-status " + (level || ""); },
    });
    try {
      await sess.start();
    } catch (e) {
      sess = null;
      status.textContent = e.name === "NotAllowedError" ? "マイクの使用が許可されていません（ブラウザの設定を確認）" : e.message;
      status.className = "voice-status warn";
      return;
    }
    if (mode !== "rec") header();
    btn.classList.add("recording");
    modeSel.disabled = true;
    const tick = () => (btn.textContent = `停止（${fmtDur(sess.elapsed())}${mode === "asr" ? " 書き起こし中" : " 録音中"}）`);
    tick();
    timer = setInterval(tick, 500);
  };
  const stop = async () => {
    const s = sess;
    sess = null;
    setIdle();
    const r = await s.stop();
    if (r) {
      const a = { id: uuid(), memoId: ctx.memo.id, blob: r.blob, mime: r.mime, duration: Math.round(r.duration), createdAt: nowIso() };
      ctx.onRecorded(a);
      renderList();
      toast(`録音を追加しました（${fmtDur(a.duration)}）。メモの保存で確定します`);
    }
  };
  btn.onclick = () => (sess ? stop() : start());

  const urls = [];
  const renderList = () => {
    list.replaceChildren();
    for (const a of ctx.audios()) {
      const url = URL.createObjectURL(a.blob);
      urls.push(url);
      const del = h("button", { type: "button", class: "icon-mini danger", "aria-label": "録音を削除" }, "削除");
      del.onclick = () => { if (confirm("この録音を削除しますか？")) { ctx.onRemove(a.id); renderList(); } };
      list.append(h("div", { class: "audio-row" },
        h("audio", { controls: true, preload: "metadata", src: url }),
        h("span", { class: "audio-meta" }, `${fmtDate(a.createdAt)}・${fmtDur(a.duration || 0)}`), del));
    }
  };
  renderList();

  const el = h("div", { class: "voice" },
    h("div", { class: "voice-row" }, btn, modeSel),
    live, status, list,
    h("div", { class: "note" }, "書き起こした文字は上のメモ欄に追記されます。録音は端末内に保存され、ZIP 書き出しに含まれます。書き起こしはブラウザの音声認識を使うため通信が必要で、音声は認識のためにブラウザの提供元（Android の Chrome なら Google）に送られます。"));
  return {
    el,
    isActive: () => !!sess,
    stop: () => (sess ? stop() : Promise.resolve()),
    dispose: () => { if (sess) { sess.stop(); sess = null; } clearInterval(timer); urls.forEach((u) => URL.revokeObjectURL(u)); },
  };
}
