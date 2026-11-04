/* フィールドノート — その他のレイヤ（旧版地図・地形分類・周辺の資料・気象など）
 * 地図の切替の「その他のレイヤ」から開く子画面にまとめる。
 */
"use strict";

/** 比較（スワイプ）で選べる、その他のレイヤ */
function extraCompareDefs() {
  return [];
}
function openExtraLayers() {
  openSheet("その他のレイヤ", h("div", {}, h("button", { type: "button", class: "chip vt-back", onclick: () => openLayers() }, "← 地図の切替に戻る")), { backdrop: false, height: "62vh" });
}
