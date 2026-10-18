"""Pasa los pósters originales de TMDB al tamaño que usa la app (2:3, 600x900).

Uso: python3 -I tools/resize_posters.py <originales> app/posters
"""
import sys
from pathlib import Path
from PIL import Image

SRC, OUT = Path(sys.argv[1]), Path(sys.argv[2])
W, H = 600, 900
for f in sorted(SRC.glob("[0-9][0-9].jpg")):
    im = Image.open(f).convert("RGB")
    # recorte centrado a 2:3 por si algún original viene con otra proporción
    r = im.width / im.height
    if r > W / H:
        nw = round(im.height * W / H)
        im = im.crop(((im.width - nw) // 2, 0, (im.width + nw) // 2, im.height))
    elif r < W / H:
        nh = round(im.width * H / W)
        im = im.crop((0, (im.height - nh) // 2, im.width, (im.height + nh) // 2))
    im.resize((W, H), Image.LANCZOS).save(OUT / f.name, quality=84, optimize=True, progressive=True)
print("ok")
