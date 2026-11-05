"""英語の辞書 tools/i18n_en.json（日本語の断片 → 英語）から i18n-en.js を作る

  python3 tools/build_i18n.py                         # i18n-en.js を作り直す
  python3 tools/build_i18n.py --missing frags.json    # tools/i18n_extract.js の結果のうち、辞書にない断片を表示する
"""
import json, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "tools", "i18n_en.json")
OUT = os.path.join(ROOT, "i18n-en.js")
JA = re.compile(r"[぀-ヺー-ヿ㐀-鿿＀-￯]")

d = json.load(open(SRC, encoding="utf-8"))
bad = [k for k, v in d.items() if v is not None and JA.search(v)]
if bad:
    sys.exit("英語に日本語・全角文字が残っています：" + ", ".join(bad[:10]))
if len(sys.argv) > 2 and sys.argv[1] == "--missing":
    frags = json.load(open(sys.argv[2], encoding="utf-8"))
    miss = [f for f in frags if f["ja"] not in d]
    print(json.dumps(miss, ensure_ascii=False, indent=0))
    print(f"辞書にない断片：{len(miss)} 件", file=sys.stderr)
    sys.exit(0)
body = json.dumps({k: v for k, v in sorted(d.items()) if v is not None}, ensure_ascii=False, separators=(",", ":"))
open(OUT, "w", encoding="utf-8").write("/* 英語の辞書（日本語の断片 → 英語）。tools/i18n_en.json から tools/build_i18n.py で作る */\nI18N.dict = " + body + ";\n")
print(f"i18n-en.js：{sum(v is not None for v in d.values())} 件", file=sys.stderr)
