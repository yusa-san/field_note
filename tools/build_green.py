#!/usr/bin/env python3
"""東京都「緑のオープンデータ（GISデータ）」を 1 つの PMTiles（ベクトルタイル）にまとめる。

使い方（GDAL の ogr2ogr と tippecanoe 2.x が必要）:
    python3 tools/build_green.py --work /tmp/green --out data/tokyo_green.pmtiles

- 東京都オープンデータカタログのシェープファイル（ZIP）をダウンロード
- tools/green_layers.tsv の分類（凡例のグループ）ごとに、EPSG:4326 の GeoJSONSeq に変換
- tippecanoe で、グループごとのレイヤを持つ PMTiles を作る

出典：東京都都市整備局「緑のオープンデータ（GISデータ）」（CC BY 4.0）
https://catalog.data.metro.tokyo.lg.jp/dataset/t000008d2000000024
"""
import argparse
import json
import os
import subprocess
import sys
import urllib.request
import zipfile

BASE = "https://data.storage.data.metro.tokyo.lg.jp/toshiseibi/"
HERE = os.path.dirname(os.path.abspath(__file__))


def read_manifest():
    rows = []
    with open(os.path.join(HERE, "green_layers.tsv"), encoding="utf-8") as f:
        for line in f:
            if not line.strip() or line.startswith("#"):
                continue
            g, label, z, path = line.rstrip("\n").split("\t")
            rows.append((g, label, z, path))
    return rows


def download(zipname, work):
    dst = os.path.join(work, zipname + ".zip")
    if os.path.exists(dst) and os.path.getsize(dst) > 0:
        return dst
    print("download", zipname, flush=True)
    req = urllib.request.Request(BASE + zipname + ".zip", headers={"User-Agent": "fieldnote-build"})
    with urllib.request.urlopen(req) as r, open(dst + ".part", "wb") as out:
        while True:
            b = r.read(1 << 20)
            if not b:
                break
            out.write(b)
    os.replace(dst + ".part", dst)
    return dst


def extract(zpath, outdir):
    """ZIP 内の日本語ファイル名（CP932）を正しく復元して展開する"""
    if os.path.exists(outdir + "/.done"):
        return
    z = zipfile.ZipFile(zpath)
    for i in z.infolist():
        name = i.filename
        if not (i.flag_bits & 0x800):
            try:
                name = name.encode("cp437").decode("cp932")
            except UnicodeError:
                pass
        if name.endswith("/"):
            continue
        out = os.path.join(outdir, name)
        os.makedirs(os.path.dirname(out), exist_ok=True)
        with z.open(i) as src, open(out, "wb") as dst:
            while True:
                b = src.read(1 << 20)
                if not b:
                    break
                dst.write(b)
    open(outdir + "/.done", "w").close()


def to_geojsonseq(shp, label, group, out):
    """1 つのシェープファイルを GeoJSONSeq に。_g（グループ）・_k（種類）を付ける"""
    layer = os.path.splitext(os.path.basename(shp))[0]
    # .cpg がない DBF は Shift_JIS（CP932）
    enc = [] if os.path.exists(os.path.splitext(shp)[0] + ".cpg") else ["-oo", "ENCODING=CP932"]
    tmp = out + ".tmp"
    if os.path.exists(tmp):
        os.remove(tmp)
    subprocess.run(["ogr2ogr", "-f", "GeoJSONSeq", "-t_srs", "EPSG:4326", "-lco", "COORDINATE_PRECISION=7",
                    "-dim", "XY", "-skipfailures", "-makevalid", *enc, tmp, shp], check=True)
    with open(tmp, encoding="utf-8") as fi, open(out, "a", encoding="utf-8") as fo:
        for line in fi:
            line = line.strip().lstrip("\x1e")
            if not line:
                continue
            ft = json.loads(line)
            if not ft.get("geometry"):
                continue
            props = {k: v for k, v in (ft.get("properties") or {}).items() if v not in (None, "", " ")}
            props["_g"] = group
            props["_k"] = label
            ft["properties"] = props
            fo.write(json.dumps(ft, ensure_ascii=False, separators=(",", ":")) + "\n")
    os.remove(tmp)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--work", default="/tmp/green")
    ap.add_argument("--out", default="tokyo_green.pmtiles")
    ap.add_argument("--maxzoom", default="15")
    a = ap.parse_args()
    os.makedirs(a.work, exist_ok=True)
    rows = read_manifest()
    seqdir = os.path.join(a.work, "seq")
    os.makedirs(seqdir, exist_ok=True)
    for f in os.listdir(seqdir):
        os.remove(os.path.join(seqdir, f))
    for zipname in sorted({r[2] for r in rows}):
        extract(download(zipname, a.work), os.path.join(a.work, "x", zipname))
    for g, label, zipname, path in rows:
        shp = os.path.join(a.work, "x", zipname, path + ".shp")
        if not os.path.exists(shp):
            sys.exit("not found: " + shp)
        print("convert", g, label, flush=True)
        to_geojsonseq(shp, label, g, os.path.join(seqdir, g + ".geojsonl"))
    args = ["tippecanoe", "-o", a.out, "--force", "-Z", "8", "-z", a.maxzoom,
            "--drop-densest-as-needed", "--extend-zooms-if-still-dropping", "--simplify-only-low-zooms",
            "--detect-shared-borders", "--maximum-tile-bytes=1000000",
            "--attribution", "東京都都市整備局「緑のオープンデータ」（CC BY 4.0）",
            "--name", "東京都 緑のオープンデータ", "-P"]
    for f in sorted(os.listdir(seqdir)):
        args += ["-L", f"{f[:-9]}:{os.path.join(seqdir, f)}"]
    print(" ".join(args), flush=True)
    subprocess.run(args, check=True)
    print("size", os.path.getsize(a.out) / 1048576, "MB")


if __name__ == "__main__":
    main()
