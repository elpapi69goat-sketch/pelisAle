"""Busca cada película en TMDB y baja el póster original.

Uso: python3 -I tools/fetch_posters.py <carpeta_originales> [--only 3,7]
Escribe <carpeta>/matches.json con lo elegido para revisarlo a mano.
"""
import html
import json
import re
import subprocess
import sys
import time
import unicodedata
import urllib.parse
from pathlib import Path

MOVIES = [
    ("Ron's Gone Wrong", 2021), ("GOAT", 2026), ("Spider-Man: Brand New Day", 2026),
    ("Robots", 2005), ("Project Hail Mary", 2026), ("Coherence", 2013),
    ("Fermat's Room", 2007), ("Ladies First", 2026), ("Rez Ball", 2024),
    ("KPop Demon Hunters", 2025), ("The Housemaid", 2025), ("People We Meet on Vacation", 2026),
    ("The Devil Wears Prada 2", 2026), ("Anastasia", 1997), ("Michael", 2026),
    ("Hoppers", 2026), ("Rounders", 1998), ("The Super Mario Bros. Movie", 2023),
    ("Forgotten Island", 2026), ("Set It Up", 2018), ("Swapped", 2026),
    ("Toy Story 5", 2026), ("Digger", 2026), ("The Odyssey", 2026),
    ("The Drama", 2026), ("Swiped", 2025), ("Marty Supreme", 2025),
    ("Scream 7", 2026), ("What a Girl Wants", 2003), ("Wolf Beach", 2025),
    ("Regretting You", 2025), ("Sweet Home Alabama", 2002), ("Minions & Monsters", 2026),
    ("Wuthering Heights", 2026), ("Girl in the Basement", 2021),
]
UA = {"User-Agent": "Mozilla/5.0", "Accept-Language": "en-US"}
CARD = re.compile(
    r'href="/movie/(\d+)[^"]*"><div class="image[^>]*><img alt="([^"]*)"[^>]*?src="[^"]*/t/p/[^/]+/([A-Za-z0-9]+\.(?:jpg|png))"'
    r'.*?release_date[^>]*>([^<]*)<',
    re.S,
)


def get(url):
    # con urllib TMDB devuelve 403 (anti-bots); con curl responde bien
    return subprocess.run(
        ["curl", "-sSf", "--max-time", "60", "--retry", "4", "--retry-all-errors", "--retry-delay", "2", "-A", UA["User-Agent"], "-H", "Accept-Language: en-US", url],
        check=True, capture_output=True,
    ).stdout


def norm(t):
    t = unicodedata.normalize("NFKD", html.unescape(t)).encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", " ", t).strip()


def search(title, year):
    q = urllib.parse.urlencode({"query": title})
    page = get(f"https://www.themoviedb.org/search/movie?{q}").decode("utf-8", "replace")
    out = []
    for mid, alt, poster, date in CARD.findall(page):
        y = re.search(r"\d{4}", date)
        out.append({"id": int(mid), "title": html.unescape(alt), "poster": poster, "year": int(y.group()) if y else None})
    return out


def pick(title, year, results):
    def score(r):
        s = 0
        if norm(r["title"]) == norm(title):
            s += 10
        if r["year"] == year:
            s += 6
        elif r["year"] and abs(r["year"] - year) == 1:
            s += 3
        return s
    ranked = sorted(results, key=score, reverse=True)
    return ranked[0] if ranked and score(ranked[0]) >= 9 else None


def main():
    out = Path(sys.argv[1])
    out.mkdir(parents=True, exist_ok=True)
    only = set()
    if "--only" in sys.argv:
        only = {int(n) for n in sys.argv[sys.argv.index("--only") + 1].split(",")}
    log = out / "matches.json"
    matches = json.loads(log.read_text()) if log.exists() else {}
    for i, (title, year) in enumerate(MOVIES, start=1):
        if only and i not in only:
            continue
        if not only and str(i) in matches and (out / f"{i:02d}.jpg").exists():
            continue
        results = search(title, year)
        best = pick(title, year, results)
        alts = ", ".join(f'{r["title"]} ({r["year"]})' for r in results[:4])
        if not best:
            print(f"{i:02d} {title} ({year}): SIN MATCH · resultados: {alts}")
            continue
        img = get(f"https://image.tmdb.org/t/p/original/{best['poster']}")
        (out / f"{i:02d}.jpg").write_bytes(img)
        matches[str(i)] = best
        print(f"{i:02d} {title} ({year}) → {best['title']} ({best['year']}) tmdb:{best['id']} · {len(img)//1024} KB")
        log.write_text(json.dumps(matches, indent=1, ensure_ascii=False))
        time.sleep(0.4)
    log.write_text(json.dumps(matches, indent=1, ensure_ascii=False))


main()
