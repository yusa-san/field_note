# フィールドノート（現地調査用 Web 地図メモ）

スマホのブラウザで開いて使う、現地調査（フィールドワーク）用の地図アプリです。
現在地を見ながら地図タイルを切り替え、地点ごとにメモ・写真を記録し、端末のファイル（JSON など）に書き出せます。
ビルド不要の静的ファイル（HTML/CSS/JS）だけで動きます。対象は日本国内。

## 主な機能

| 機能 | 内容 |
|---|---|
| 現在地 | GPS の現在地・精度円・端末の向き（コーン表示）。◎ボタンで現在地へ移動、もう一度押すと追従モード |
| ステータス表示 | 緯度経度・精度・標高（地理院 DEM）・地域メッシュコード（3次）・住所（地理院 逆ジオコーダ）。タップで座標コピー |
| 地図切替 | ベース：地理院 標準／淡色／写真（最新・1974-78・1961-69・1945-50）／色別標高図／陰影起伏図／OSM |
| 重ね合わせ | 陰影起伏・傾斜量図・色別標高図・治水地形分類図・土地条件図・明治期の低湿地・洪水浸水想定・津波浸水想定・土砂災害警戒区域（3種）。透過度スライダー付き |
| メモ | 「現在地にメモ」「中心にメモ」（十字線位置）・地図の長押し で作成。タイトル／カテゴリ（色分け）／本文／タグ／写真（複数・自動縮小）／撮影方向（コンパス） |
| 自動付与 | 通し番号・日時・座標・GPS 精度・GPS 高度・DEM 標高・住所・メッシュコード・表示中の地図・調査名・記録者 |
| 一覧 | キーワード・カテゴリで絞り込み、新しい順／番号順／近い順。現在地からの距離と方向（矢印は端末の向き基準） |
| 軌跡 | 歩いたルートを記録（記録中は画面消灯を防止）。GPX / GeoJSON / JSON に含めて書き出し |
| 計測 | タップした点の距離・面積・区間方位 |
| 地名検索 | 地理院の地名検索 API。`35.68, 139.76` のような座標入力にも対応 |
| 書き出し | JSON（全データ・写真込み可）／GeoJSON（QGIS 等）／CSV（Excel 用 BOM 付き）／GPX。「保存」＝ダウンロード、「共有…」＝OS の共有シート（iPhone は「ファイルに保存」） |
| 読み込み | 書き出した JSON / GeoJSON を統合（同じ ID は更新日時が新しい方を採用）。複数端末・複数人のデータをまとめるのにも |
| オフライン | アプリ本体と表示した地図タイルを自動キャッシュ。「表示範囲の地図を端末に保存」で事前ダウンロードも可能（上限 1500 枚） |
| ホーム画面に追加 | PWA 対応。全画面のアプリとして起動できる |

データはすべて端末内（IndexedDB）に保存され、外部サーバーには送信しません
（標高・住所・地名検索のために座標を国土地理院の API に問い合わせる通信のみ発生します）。

## スマホで使うには（HTTPS が必須）

ブラウザの位置情報・方位センサーは **HTTPS** でないと使えません。

### GitHub Pages で公開（おすすめ）

1. GitHub のリポジトリ **Settings → Pages → Build and deployment → Source** を **GitHub Actions** にする
2. `main` に push される（または Actions タブから「Deploy to GitHub Pages」を手動実行する）と
   `https://yusa-san.github.io/field_note/` で公開される
3. スマホで開き、共有メニューから「ホーム画面に追加」

※ 非公開リポジトリで Pages を使うには有料プランが必要です。Netlify / Cloudflare Pages などにこのリポジトリのファイルをそのまま置いても動きます。

### PC で動作確認

```bash
python3 -m http.server 8000
```

`http://localhost:8000/` を開く（localhost は HTTPS でなくても位置情報が使えます。同じ Wi-Fi のスマホから IP アドレスで開いた場合は HTTP なので位置情報は使えません）。

## 現地での使い方のコツ

- 調査前に「保存/設定」で **調査名・記録者** を入れておくと、メモとファイル名に記録されます。
- 電波の弱い場所に行く前に、Wi-Fi 下で対象範囲を表示 → 「表示範囲の地図を端末に保存」。
- GPS の位置がずれているときは、✚（十字線）を出して地図を動かし「中心にメモ」。既存メモも編集画面の「位置を地図中心へ」で修正できます。
- 軌跡記録中は画面を開いたままにしてください（ブラウザの制約で、画面オフやアプリ切替中は位置を取れません）。
- 調査の区切りごとに **JSON を書き出す**（「保存/設定」ボタンの赤い ! は未書き出しのメモがある印）。ブラウザのデータ削除や「ホーム画面に追加」したアプリの削除で端末内のデータは消えます。
- iPhone では書き出しは「共有…」→「ファイルに保存」が確実です。

## 書き出し JSON の形式

```jsonc
{
  "format": "fieldnote",
  "version": 1,
  "exportedAt": "2026-11-03T05:25:30.000Z",
  "project": { "name": "犬山城下町 2026秋", "observer": "山田", "categories": ["景観", "..."] },
  "crs": "EPSG:4326 (WGS84 / JGD2011 相当)",
  "memos": [
    {
      "id": "uuid", "no": 1,
      "createdAt": "ISO8601", "updatedAt": "ISO8601",
      "lat": 35.3883, "lon": 136.9393,
      "source": "gps",            // gps = 現在地 / map = 地図上で指定
      "accuracy": 8,              // GPS 精度 (m)
      "gpsAltitude": null,        // GPS 高度 (m, 端末が返す場合)
      "elevation": 84.5,          // 地理院 DEM による標高 (m)
      "elevationSrc": "1m（レーザ）",
      "address": "愛知県犬山市大字犬山",
      "mesh": "5336-07-65",       // 3次メッシュ（1km）
      "title": "...", "note": "...", "category": "景観", "tags": ["城", "石垣"],
      "heading": 215,             // 撮影方向（度, 北=0 時計回り）。未記録は null
      "baseMap": "std", "project": "...", "observer": "...",
      "photos": [
        { "id": "uuid", "filename": "memo001_1.jpg", "mime": "image/jpeg",
          "width": 1600, "height": 1200, "takenAt": "ISO8601",
          "dataUrl": "data:image/jpeg;base64,..." }   // 「写真を含める」をオフにすると省略
      ]
    }
  ],
  "tracks": [
    { "id": "uuid", "name": "軌跡 2026/11/03 10:00", "startedAt": "...", "endedAt": "...",
      "distance": 1234.5,
      "pointFields": ["lat", "lon", "time_ms", "accuracy_m", "altitude_m"],
      "points": [[35.3885, 136.9394, 1793683537189, 5, null], "..."] }
  ]
}
```

Python で読む例：

```python
import json, geopandas as gpd
d = json.load(open("fieldnote_xxx.json", encoding="utf-8"))
gdf = gpd.GeoDataFrame(
    [{k: v for k, v in m.items() if k != "photos"} for m in d["memos"]],
    geometry=gpd.points_from_xy([m["lon"] for m in d["memos"]], [m["lat"] for m in d["memos"]]),
    crs="EPSG:4326",
)
```

## 出典・利用上の注意

- 地図：[国土地理院（地理院タイル）](https://maps.gsi.go.jp/development/ichiran.html)、[ハザードマップポータルサイト](https://disaportal.gsi.go.jp/)、© OpenStreetMap contributors
- 標高 API・逆ジオコーダ・地名検索：国土地理院
- OpenStreetMap のタイルは利用規約により一括ダウンロード（オフライン保存）の対象外にしています。
- ハザード情報は概略です。詳細は各自治体の公表資料を確認してください。

## ファイル構成

```
.
├── index.html            画面
├── style.css             スタイル（ダークモード対応）
├── app.js                アプリ本体（Leaflet 1.9.4 のみ使用）
├── sw.js                 Service Worker（オフライン・タイルキャッシュ）
├── manifest.webmanifest  PWA 設定
├── icon.svg / icon-192.png / icon-512.png
└── .github/workflows/pages.yml  GitHub Pages への公開
```
