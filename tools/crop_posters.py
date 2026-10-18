"""Recorta los 35 pósters de las capturas de la lista de Letterboxd.

Uso: python3 -I tools/crop_posters.py <carpeta_capturas> <carpeta_salida>
"""
import sys
from pathlib import Path
import cv2
import numpy as np
from PIL import Image, ImageFilter

SRC, OUT = Path(sys.argv[1]), Path(sys.argv[2])
OUT.mkdir(parents=True, exist_ok=True)

SHOTS = ["9f73e2e9", "3f5f2ef4", "f0cc7b87", "982d3d4f", "31a6ed49", "cde528f0"]
X0, X1, H = 31, 114, 124  # caja del póster (sin el borde) y alto
# (captura, borde inferior del póster) en el orden de la lista 1..35
BOTTOMS = [
    (0, 356), (0, 549), (0, 738), (0, 935), (0, 1126), (0, 1317),
    (1, 322), (1, 510), (1, 709), (1, 903), (1, 1092), (1, 1285),
    None,  # 13: solo aparece cortado, se arma aparte
    (2, 360), (2, 552), (2, 744), (2, 936), (2, 1128), (2, 1319),
    (3, 377), (3, 563), (3, 761), (3, 954), (3, 1146), (3, 1338),
    (4, 328), (4, 521), (4, 713), (4, 905), (4, 1098), (4, 1290),
    (5, 705), (5, 898), (5, 1090), (5, 1279),
]

shots = [Image.open(SRC / f"{s}-image.jpg").convert("RGB") for s in SHOTS]


def badge_y(shot, top):
    """Centro vertical del circulito: se mide a la izquierda del póster, donde no hay imagen."""
    px = shot.load()
    ys = [y for y in range(top - 25, top + 35) if 70 < px[22, y][0] < 160 and abs(px[22, y][0] - px[22, y][2]) < 14]
    return (min(ys) + max(ys)) // 2 if ys else top + 8


def clean_badge(im, cy):
    """Borra el circulito con el número que Letterboxd pone sobre la esquina."""
    arr = cv2.cvtColor(np.array(im), cv2.COLOR_RGB2BGR)
    mask = np.zeros(arr.shape[:2], np.uint8)
    cv2.circle(mask, (37 - X0, cy), 24, 255, -1)
    arr = cv2.inpaint(arr, mask, 7, cv2.INPAINT_TELEA)
    return Image.fromarray(cv2.cvtColor(arr, cv2.COLOR_BGR2RGB))


for i, spec in enumerate(BOTTOMS, start=1):
    if spec is None:
        top = shots[1].crop((X0, 1352, X1, 1451))
        poster = Image.new("RGB", (X1 - X0, H))
        poster.paste(top, (0, 0))
        tail = top.crop((0, top.height - 4, top.width, top.height)).resize((top.width, H - top.height))
        poster.paste(tail.filter(ImageFilter.GaussianBlur(2)), (0, top.height))
        cy = badge_y(shots[1], 1352) - 1352
    else:
        s, b = spec
        poster = shots[s].crop((X0, b - H, X1, b))
        cy = badge_y(shots[s], b - H) - (b - H)
    poster = clean_badge(poster, cy)
    big = poster.resize((poster.width * 3, poster.height * 3), Image.LANCZOS)
    big = big.filter(ImageFilter.UnsharpMask(radius=2, percent=60, threshold=2))
    big.save(OUT / f"{i:02d}.jpg", quality=86)
print("ok", len(BOTTOMS))
