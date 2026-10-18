"""Elige en la galería de TMDB el póster que más se parece al de la captura
de Letterboxd y lo baja en resolución original.

Uso: python3 -I tools/match_posters.py <recortes_viejos> <carpeta_salida> <matches.json>
"""
import json
import re
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor
from io import BytesIO
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

OLD, OUT, MATCHES = Path(sys.argv[1]), Path(sys.argv[2]), json.loads(Path(sys.argv[3]).read_text())
OUT.mkdir(parents=True, exist_ok=True)


def get(url):
    return subprocess.run(
        ["curl", "-sSfL", "--max-time", "60", "--retry", "4", "--retry-all-errors", "--retry-delay", "2", "-A", "Mozilla/5.0", url],
        check=True, capture_output=True,
    ).stdout


def vec(img):
    # comparación gruesa: color y estructura a 24x36, sin la esquina retocada
    im = img.convert("RGB").resize((24, 36), Image.BILINEAR).filter(ImageFilter.GaussianBlur(0.6))
    a = np.asarray(im, dtype=np.float32) / 255
    a[:6, :6] = np.nan
    return a


def dist(a, b):
    d = (a - b) ** 2
    return float(np.nanmean(d))


def gallery(tmdb_id):
    paths = []
    for lang in ("en", "xx"):  # en inglés y sin texto
        html = get(f"https://www.themoviedb.org/movie/{tmdb_id}/images/posters?image_language={lang}").decode("utf-8", "replace")
        for p in re.findall(r"/t/p/[a-z0-9_]+/([A-Za-z0-9]+\.(?:jpg|png))", html):
            if p not in paths:
                paths.append(p)
    return paths


def thumb(path):
    try:
        return path, vec(Image.open(BytesIO(get(f"https://image.tmdb.org/t/p/w185/{path}"))))
    except Exception:
        return path, None


report = {}
for n in sorted(MATCHES, key=int):
    i = int(n)
    target = vec(Image.open(OLD / f"{i:02d}.jpg"))
    default = MATCHES[n]["poster"]
    paths = gallery(MATCHES[n]["id"])
    if default not in paths:
        paths.insert(0, default)
    with ThreadPoolExecutor(8) as ex:
        scored = [(dist(target, v), p) for p, v in ex.map(thumb, paths[:60]) if v is not None]
    scored.sort()
    best_d, best = scored[0]
    report[n] = {"poster": best, "dist": round(best_d, 4), "default": default, "candidates": len(scored)}
    img = get(f"https://image.tmdb.org/t/p/original/{best}")
    (OUT / f"{i:02d}.jpg").write_bytes(img)
    w, h = Image.open(BytesIO(img)).size
    flag = "" if best_d < 0.02 else "  ← revisar"
    print(f"{i:02d} {MATCHES[n]['title']}: {len(scored)} pósters, dist {best_d:.4f}, {w}x{h}{' (cambió)' if best != default else ''}{flag}")
Path(OUT / "report.json").write_text(json.dumps(report, indent=1))
