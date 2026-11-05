"""e-Stat「地図で見る統計（統計GIS）」の統計一覧 estat-gis-catalog.js を作る

使い方：python3 tools/build_estat_gis_catalog.py [作業フォルダ]
  - DS に並べた統計表 ID ごとに、e-Stat の定義書（PDF）
    https://www.e-stat.go.jp/help/data-definition-information/shuroku/T??????.pdf を取り、
    pdftotext（poppler-utils）で読んで項目名と単位を取り出す
  - 統計表 ID は、統計GIS のダウンロード（statmap-search/data?statsId=...&code=13&downloadType=2）で確かめたもの
"""
import re, json, sys, os, subprocess, urllib.request
D = (sys.argv[1] if len(sys.argv) > 1 else "/tmp/estat_gis_pdf").rstrip("/") + "/"
os.makedirs(D, exist_ok=True)
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
# theme, title, year, survey label, units {town|m1|m500|m250: id}, boundary survey for town
DS = [
 ("人口・世帯", "男女別人口・世帯数", 2020, "国勢調査", {"town": 1081}),
 ("人口・世帯", "人口・世帯（年齢 3 区分・外国人・世帯の種類など）", 2020, "国勢調査", {"m1": 1100, "m500": 1101, "m250": 1102}),
 ("人口・世帯", "年齢（5 歳階級）別人口", 2020, "国勢調査", {"town": 1082, "m1": 1171, "m500": 1173, "m250": 1175}),
 ("人口・世帯", "世帯人員別の一般世帯数", 2020, "国勢調査", {"town": 1083}),
 ("人口・世帯", "世帯の家族類型別の一般世帯数", 2020, "国勢調査", {"town": 1084}),
 ("住まい", "住宅の所有の関係別の一般世帯数", 2020, "国勢調査", {"town": 1085}),
 ("住まい", "住宅の建て方別の世帯数", 2020, "国勢調査", {"town": 1086}),
 ("仕事", "産業（大分類）別の就業者数", 2020, "国勢調査", {"town": 1103}),
 ("仕事", "職業（大分類）別の就業者数", 2020, "国勢調査", {"town": 1104}),
 ("仕事", "世帯の経済構成別の一般世帯数", 2020, "国勢調査", {"town": 1106}),
 ("仕事", "人口移動・就業状態・従業地／通学地", 2020, "国勢調査", {"m1": 1107, "m500": 1108, "m250": 1109}),
 ("事業所", "産業（大分類）別の事業所数・従業者数", 2021, "経済センサス‐活動調査", {"m1": 1146, "m500": 1147}),
 ("人口・世帯", "男女別人口・世帯数", 2015, "国勢調査", {"town": 848}),
 ("人口・世帯", "人口・世帯（人口等基本集計）", 2015, "国勢調査", {"m1": 846, "m500": 847, "m250": 876}),
 ("人口・世帯", "年齢（5 歳階級）別人口", 2015, "国勢調査", {"town": 849, "m1": 1176, "m500": 1177, "m250": 1178}),
 ("人口・世帯", "世帯人員別の一般世帯数", 2015, "国勢調査", {"town": 850}),
 ("人口・世帯", "世帯の家族類型別の一般世帯数", 2015, "国勢調査", {"town": 851}),
 ("住まい", "住居の種類・住宅の所有の関係別の一般世帯数", 2015, "国勢調査", {"town": 852}),
 ("住まい", "住宅の建て方別の世帯数", 2015, "国勢調査", {"town": 853}),
 ("仕事", "産業（大分類）別の就業者数", 2015, "国勢調査", {"town": 865}),
 ("仕事", "職業（大分類）別の就業者数", 2015, "国勢調査", {"town": 866}),
 ("仕事", "人口移動・就業状態など", 2015, "国勢調査", {"m1": 877, "m500": 879, "m250": 881}),
] + [("将来推計", f"将来推計人口 {y} 年", y, "メッシュ別将来人口推計（2015 年国勢調査基準）", {"m1": 1110 + i, "m500": 1117 + i}) for i, y in enumerate(range(2020, 2051, 5))]

FW = {c: c - 0xFEE0 for r in [(0xFF10, 0xFF19), (0xFF21, 0xFF3A), (0xFF41, 0xFF5A)] for c in range(r[0], r[1] + 1)}
item_re = re.compile(r"^\s*(T\d{6})(\d{3})\s+(\d+)\s+(.*?)\s*$")
def items(n):
    txt = f"{D}T{n:06d}.txt"
    if not os.path.exists(txt):
        pdf = f"{D}T{n:06d}.pdf"
        urllib.request.urlretrieve(f"https://www.e-stat.go.jp/help/data-definition-information/shuroku/T{n:06d}.pdf", pdf)
        subprocess.run(["pdftotext", "-layout", pdf, txt], check=True)
    t = open(txt).read().split("\n")
    out, stack = [], {}
    for l in t:
        m = item_re.match(l)
        if not m: continue
        idx, lv, rest = int(m.group(2)), int(m.group(3)), m.group(4)
        mm = re.match(r"(.*?)\s{2,}(\S+)\s+\d{3}(?:\s+\d{2})?$", rest)
        if mm: label, unit = mm.group(1), mm.group(2)
        else: label, unit = rest, None
        label = re.sub(r"\s+", " ", label.replace("　", " ")).strip()
        label = label.translate(FW)
        for k in [k for k in stack if k >= lv]: del stack[k]
        if unit is None:  # 見出し
            stack[lv] = label; continue
        prefix = " / ".join(stack[k] for k in sorted(stack))
        out.append([idx, (prefix + " / " if prefix else "") + label, unit])
    return out

cat, ITEMS = [], {}
for theme, title, year, survey, units in DS:
    for u, n in units.items():
        it = items(n)
        if not it: print("NO ITEMS", n, file=sys.stderr)
        ITEMS[f"T{n:06d}"] = it
    cat.append({"theme": theme, "title": title, "year": year, "survey": survey, "units": {u: f"T{n:06d}" for u, n in units.items()}})
    print(year, title, [(n, len(ITEMS[f"T{n:06d}"])) for n in units.values()], file=sys.stderr)
js = "/* e-Stat 統計GIS（地図で見る統計）の統計データ一覧。項目名は e-Stat の定義書（PDF）から生成 */\nconst ESTAT_GIS = " + json.dumps(cat, ensure_ascii=False, separators=(",", ":")) + ";\nconst ESTAT_GIS_ITEMS = " + json.dumps(ITEMS, ensure_ascii=False, separators=(",", ":")) + ";\n"
open(os.path.join(ROOT, "estat-gis-catalog.js"), "w").write(js)
print(len(js), file=sys.stderr)
