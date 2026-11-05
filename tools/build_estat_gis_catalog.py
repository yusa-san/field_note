"""e-Stat「地図で見る統計（統計GIS）」の統計一覧 estat-gis-catalog.js を作る

使い方：
  python3 tools/build_estat_gis_catalog.py                       # 一覧（tools/estat_gis_tables.json）から作り直す
  python3 tools/build_estat_gis_catalog.py --discover --report r.md
      # e-Stat に新しい統計表が出ていないか調べ、町丁・字等／地域メッシュの表があれば一覧に足してから作り直す
      # （GitHub Actions の .github/workflows/estat-catalog.yml が毎月実行）

  - 統計表ごとに e-Stat の定義書（PDF）
    https://www.e-stat.go.jp/help/data-definition-information/shuroku/T??????.pdf を取り、
    pdftotext（poppler-utils）で読んで、項目名・単位・調査名・年・集計単位を取り出す
  - 新しい表は、統計データ（statmap-search/data?statsId=..&code=13&downloadType=2）が実際に取れるかと、
    町丁・字等なら境界データ（国勢調査 小地域）が公開されているかを確かめてから足す。
    境界がまだのものは pending に残し、次回また確かめる
  - estat-gis-catalog.js は、中身が変わったときだけ書き換える（日付も変わったときだけ）
"""
import re, json, sys, os, subprocess, urllib.request, urllib.error, datetime, argparse, time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TABLES = os.path.join(ROOT, "tools", "estat_gis_tables.json")
OUT = os.path.join(ROOT, "estat-gis-catalog.js")
PDF_URL = "https://www.e-stat.go.jp/help/data-definition-information/shuroku/{}.pdf"
GIS_URL = "https://www.e-stat.go.jp/gis/statmap-search/data?"
UA = {"User-Agent": "fieldnote-catalog/1.0 (+https://github.com/yusa-san/field_note)"}

ap = argparse.ArgumentParser()
ap.add_argument("--workdir", default="/tmp/estat_gis_pdf")
ap.add_argument("--discover", action="store_true")
ap.add_argument("--report", default=None)
ap.add_argument("--max-miss", type=int, default=40, help="この数だけ続けて表がなければ調べるのをやめる")
args = ap.parse_args()
D = args.workdir.rstrip("/") + "/"
os.makedirs(D, exist_ok=True)

FW = {c: c - 0xFEE0 for r in [(0xFF10, 0xFF19), (0xFF21, 0xFF3A), (0xFF41, 0xFF5A)] for c in range(r[0], r[1] + 1)}
item_re = re.compile(r"^\s*(T\d{6})(\d{3})\s+(\d+)\s+(.*?)\s*$")


def get(url, tries=3):
    for k in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=90) as r:
                return r.status, dict(r.headers), r.read()
        except urllib.error.HTTPError as e:
            return e.code, dict(e.headers or {}), b""
        except Exception:
            if k == tries - 1:
                raise
            time.sleep(3 * (k + 1))


def pdf_text(sid):
    """定義書の文字（なければ None）"""
    txt = f"{D}{sid}.txt"
    if os.path.exists(txt):
        return open(txt, encoding="utf-8", errors="replace").read()
    st, _, body = get(PDF_URL.format(sid))
    if st != 200 or not body.startswith(b"%PDF"):  # ない表は HTML の案内ページが返る
        return None
    pdf = f"{D}{sid}.pdf"
    open(pdf, "wb").write(body)
    subprocess.run(["pdftotext", "-layout", pdf, txt], check=True, stderr=subprocess.DEVNULL)
    return open(txt, encoding="utf-8", errors="replace").read()


def header(text):
    """定義書の先頭：政府統計名・調査年次・集計単位・集計表名・統計表名"""
    h = {}
    for l in text.split("\n")[:12]:
        parts = re.split(r"\s{2,}", l.strip())
        if len(parts) >= 2:
            h[parts[0]] = parts[1:]
    g = lambda k: h.get(k, [""])
    year = re.match(r"\d{4}", g("調査年次")[0] or "")
    return {
        "code": g("政府統計コード")[0], "statName": (g("政府統計コード") + [""])[1],
        "year": int(year.group()) if year else None,
        "unit": (g("集計単位")[0] or "").translate(FW),
        "sheet": " ".join(g("集計表名")).translate(FW),
        "table": " ".join(g("統計表名")[1:] if re.match(r"^\d{3}-\d{2}$", g("統計表名")[0]) else g("統計表名")).translate(FW),
    }


def items(sid):
    text = pdf_text(sid)
    if text is None:
        raise SystemExit(f"{sid} の定義書がありません")
    out, stack = [], {}
    for l in text.split("\n"):
        m = item_re.match(l)
        if not m:
            continue
        idx, lv, rest = int(m.group(2)), int(m.group(3)), m.group(4)
        mm = re.match(r"(.*?)\s{2,}(\S+)\s+\d{3}(?:\s+\d{2})?$", rest)
        label, unit = (mm.group(1), mm.group(2)) if mm else (rest, None)
        label = re.sub(r"\s+", " ", label.replace("　", " ")).strip().translate(FW)
        for k in [k for k in stack if k >= lv]:
            del stack[k]
        if unit is None:  # 見出し
            stack[lv] = label
            continue
        prefix = " / ".join(stack[k] for k in sorted(stack))
        out.append([idx, (prefix + " / " if prefix else "") + label, unit])
    return out


UNIT_OF = {"町丁・字等": "town", "1kmメッシュ": "m1", "500mメッシュ": "m500", "250mメッシュ": "m250"}


def unit_key(u):
    return UNIT_OF.get(re.sub(r"\s", "", u.replace("ｋ", "k").replace("ｍ", "m")))


def gis_ok(params):
    """統計GIS から実際に ZIP が取れるか"""
    try:
        st, hd, body = get(GIS_URL + urllib.parse.urlencode(params))
    except Exception:
        return False
    return st == 200 and body[:2] == b"PK"


def theme_of(title):
    for k, pat in [("将来推計", r"将来"), ("事業所", r"事業所"), ("住まい", r"住宅|住居"), ("仕事", r"産業|職業|就業|従業|通学|経済構成|労働|移動"), ("人口・世帯", r"人口|年齢|世帯|外国人")]:
        if re.search(pat, title):
            return k
    return "そのほか"


def survey_of(h):
    s = re.sub(r"^(令和|平成|昭和)\s*\d+\s*年\s*", "", h["sheet"])
    s = re.split(r"－|\s|（", s)[0]
    return s or h["statName"]


def clean_title(t):
    t = re.sub(r"\s*[－-]\s*(町丁・字等|市区町村、町丁・大字|町丁・字)\s*$", "", t)
    return re.sub(r"\s+", " ", t).strip()


import urllib.parse

data = json.load(open(TABLES, encoding="utf-8"))
report = []

if args.discover:
    known = {sid for d in data["datasets"] for sid in d["units"].values()}
    start = data["checkedTo"] + 1
    # pending：定義書はあるがデータや境界がまだ取れなかった表（1 年たっても取れなければあきらめる）
    today = datetime.date.today()
    pend_since = {p["id"]: p["since"] for p in data.get("pending", [])}
    pend_since = {k: v for k, v in pend_since.items() if (today - datetime.date.fromisoformat(v)).days < 365}
    todo = sorted({int(k[1:]) for k in pend_since} | set(range(start, start + 1000)))
    misses, last, found, pending, other = 0, data["checkedTo"], [], [], []
    for n in todo:
        if n >= start and misses >= args.max_miss:
            break
        sid = f"T{n:06d}"
        if sid in known:
            continue
        text = pdf_text(sid)
        if text is None:
            if n >= start:
                misses += 1
            continue
        if n >= start:
            misses, last = 0, max(last, n)
        h = header(text)
        u = unit_key(h["unit"])
        if not u:
            other.append(f"{sid} {h['year'] or ''} {h['unit']} {h['table']}")
            continue
        # 東京都・大阪府・北海道のどれかで取れれば使える表とみなす
        if not any(gis_ok({"statsId": sid, "code": c, "downloadType": "2"}) for c in ("13", "27", "01")):
            pending.append(n)
            report.append(f"- {sid}（{h['unit']}）：定義書はあるが、データがまだ取れない（次回また確かめる）")
            continue
        bnd = None
        if u == "town":
            y = h["year"] or 0
            bnd = y - y % 5
            if not gis_ok({"dlserveyId": f"A00200521{bnd}", "code": "13101", "coordSys": "1", "format": "shape", "downloadType": "5", "datum": "2000"}):
                pending.append(n)
                report.append(f"- {sid}（{h['year']} 年・町丁・字等）：{bnd} 年の境界データがまだ公開されていない（次回また確かめる）")
                continue
        found.append((sid, u, h, bnd))
    # 同じ調査・年・題名の表（メッシュの大きさ違いなど）は 1 つの統計にまとめる
    added = []
    for sid, u, h, bnd in found:
        title, survey, year = clean_title(h["table"]), survey_of(h), h["year"]
        if year is None:
            m = re.search(r"(\d{4})年", h["table"])
            year = int(m.group(1)) if m else datetime.date.today().year
        ds = next((d for d in data["datasets"] if d["title"] == title and d["year"] == year and d["survey"] == survey), None)
        if not ds:
            ds = {"theme": theme_of(title), "title": title, "year": year, "survey": survey, "units": {}, "auto": True}
            if bnd:
                ds["bnd"] = bnd
            data["datasets"].append(ds)
            added.append(ds)
        if u in ds["units"]:
            report.append(f"- {sid}：「{title}」（{year}）の {u} は {ds['units'][u]} があるので使わない")
            continue
        ds["units"][u] = sid
        report.append(f"- 追加：{sid}「{title}」（{survey}・{year} 年・{u}）")
    data["checkedTo"] = last
    data["pending"] = [{"id": f"T{n:06d}", "since": pend_since.get(f"T{n:06d}", today.isoformat())} for n in sorted(set(pending))]
    if other:
        report.append(f"\n町丁・字等／メッシュ以外の新しい表（地図には足していない）：{len(other)} 件")
        report += [f"  - {o}" for o in other[:30]]
    print(f"checked up to T{last:06d}; added {len(found)} tables; pending {len(pending)}", file=sys.stderr)

# 一覧 → estat-gis-catalog.js
cat, ITEMS = [], {}
for d in data["datasets"]:
    for u, sid in d["units"].items():
        it = items(sid)
        if not it:
            print("NO ITEMS", sid, file=sys.stderr)
        ITEMS[sid] = it
    e = {k: d[k] for k in ("theme", "title", "year", "survey", "units")}
    if d.get("bnd"):
        e["bnd"] = d["bnd"]
    cat.append(e)
body = "const ESTAT_GIS = " + json.dumps(cat, ensure_ascii=False, separators=(",", ":")) + ";\nconst ESTAT_GIS_ITEMS = " + json.dumps(ITEMS, ensure_ascii=False, separators=(",", ":")) + ";\n"
old = open(OUT, encoding="utf-8").read() if os.path.exists(OUT) else ""
changed = body not in old or "ESTAT_GIS_UPDATED" not in old
if changed:
    today = datetime.date.today().isoformat()
    js = f"/* e-Stat 統計GIS（地図で見る統計）の統計データ一覧。項目名は e-Stat の定義書（PDF）から生成（tools/build_estat_gis_catalog.py） */\nconst ESTAT_GIS_UPDATED = \"{today}\";\n" + body
    open(OUT, "w", encoding="utf-8").write(js)
json.dump(data, open(TABLES, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
open(TABLES, "a").write("\n")
print(("estat-gis-catalog.js を更新しました" if changed else "estat-gis-catalog.js は変わりません") + f"（{len(cat)} 統計・{len(ITEMS)} 表）", file=sys.stderr)
if args.report:
    head = f"e-Stat 統計GIS の新しい表を確かめました（T{data['checkedTo']:06d} まで）。\n\n"
    open(args.report, "w", encoding="utf-8").write(head + ("\n".join(report) if report else "新しい町丁・字等／メッシュの表はありませんでした。") + "\n")
