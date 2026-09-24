# -*- coding: utf-8 -*-
"""Turnierfotos fuer die Unterseiten aufbereiten + tournaments.json bauen."""
from PIL import Image, ImageOps
import openpyxl, os, re, io, json, datetime
from collections import defaultdict

BASE = r"G:\Meine Ablage\Dropbox_Migration\Vienn_Magicrunde\Slaughter Games\Fotos"
XLSM = r"C:\Users\Mugi\Downloads\SlaughterGames 6 Ranking_V2026.xlsm"
REPO = r"C:\Users\Mugi\AppData\Local\Temp\claude\G--Meine-Ablage-Dropbox-Migration-Vienn-Magicrunde-Slaughter-Games\d7fa9ca9-cfed-4838-b8cd-b7e366006dca\scratchpad\slaughtergames"
EXT = ('.jpg', '.jpeg', '.png', '.webp')
MAX_PX, QUALITY = 1400, 78

# Turnierfenster (aus den Aufnahmedaten abgeleitet; 2021 ohne EXIF -> Pfingsten)
WINDOW = {
    2021: (datetime.date(2021, 5, 20), datetime.date(2021, 5, 24)),
    2022: (datetime.date(2022, 5, 12), datetime.date(2022, 5, 16)),
    2023: (datetime.date(2023, 5, 26), datetime.date(2023, 5, 29)),
    2024: (datetime.date(2024, 5, 16), datetime.date(2024, 5, 20)),
    2025: (datetime.date(2025, 6, 5),  datetime.date(2025, 6, 9)),
    2026: (datetime.date(2026, 5, 21), datetime.date(2026, 5, 25)),
}
YEAR2SG = {2021:1, 2022:2, 2023:3, 2024:4, 2025:5, 2026:6}
SHORT2SLUG = {
    'Vinc':'vinc','Berni':'burni','David':'david','Silvio':'silvio','Felix S':'felix','Simon':'simon',
    'Heber':'heber','Osti':'osti','Paul R':'raul','Frido':'frido','Niki':'niki','Wenzel':'wenzl',
    'Fabian':'fabi','Ivo':'ivo','Mugi':'maugi555-gmail','Mutsch':'luki','Marc':'marc','Soyka':'paul',
    'Hansi':'hansi','Sascha':'sasha','Leo':'leo',
}
RARITY = ['M', 'R', 'U', 'C']


def exif_date(path):
    """Nur echtes EXIF-Aufnahmedatum - Dateinamen sind hier nicht verlaesslich."""
    try:
        ex = Image.open(path).getexif()
        for tag in (36867, 36868, 306):
            v = ex.get(tag)
            if v:
                return datetime.datetime.strptime(str(v)[:19], '%Y:%m:%d %H:%M:%S').date()
    except Exception:
        pass
    return None


# ---------- Ranking aus dem xlsm ----------
ws = openpyxl.load_workbook(XLSM, data_only=True)['Eternal Daten']
pts = defaultdict(dict)
for row in ws.iter_rows(min_row=2, values_only=True):
    n, y, p = row[1], row[2], row[3]
    if isinstance(n, str) and isinstance(y, (int, float)) and isinstance(p, (int, float)):
        pts[SHORT2SLUG[n.strip()]][int(y)] = int(p)

profiles = json.load(io.open(os.path.join(REPO, 'tournament-app', 'player_profiles.json'), encoding='utf-8'))
NAME = {p['slug']: p['name'] for p in profiles}

games = []
for year in sorted(WINDOW):
    sg = YEAR2SG[year]
    field = sorted(((s, d[year]) for s, d in pts.items() if year in d), key=lambda t: -t[1])
    n = len(field)
    ranking = [{'place': n + 1 - p, 'slug': s, 'name': NAME[s],
                'axe': RARITY[n - p] if (n + 1 - p) <= 4 else None}
               for s, p in field]
    ranking.sort(key=lambda r: r['place'])

    # ---------- Fotos ----------
    src = os.path.join(BASE, str(year))
    dst = os.path.join(REPO, 'assets', 'games', 'sg%d' % sg)
    os.makedirs(dst, exist_ok=True)
    for old in os.listdir(dst):
        os.remove(os.path.join(dst, old))

    lo, hi = WINDOW[year]
    pad = datetime.timedelta(days=2)
    # Der Ordner bestimmt die Zuordnung, nicht der Dateiname: viele Bilder sind
    # Signal-Exporte, deren Name das Versand- und nicht das Aufnahmedatum traegt
    # (im 2021er-Ordner stehen Namen aus 2022/2023). Nur echte EXIF-Aufnahmedaten
    # ausserhalb des Turnierfensters fliegen raus.
    keep, ausgefiltert = [], 0
    for f in sorted(os.listdir(src)):
        if not f.lower().endswith(EXT):
            continue
        d = exif_date(os.path.join(src, f))
        if d is not None and not ((lo - pad) <= d <= (hi + pad)):
            ausgefiltert += 1
            continue
        keep.append((f, d))
    keep.sort(key=lambda t: (t[1] or datetime.date(year, 1, 1), t[0]))

    photos, tin, tout = [], 0, 0
    for i, (f, d) in enumerate(keep, 1):
        sp = os.path.join(src, f)
        try:
            im = ImageOps.exif_transpose(Image.open(sp)).convert('RGB')
        except Exception as e:
            print('  uebersprungen:', f, e)
            continue
        im.thumbnail((MAX_PX, MAX_PX), Image.LANCZOS)
        name = 'sg%d_%03d.jpg' % (sg, i)
        dp = os.path.join(dst, name)
        im.save(dp, 'JPEG', quality=QUALITY, optimize=True, progressive=True)
        tin += os.path.getsize(sp); tout += os.path.getsize(dp)
        photos.append('assets/games/sg%d/%s' % (sg, name))

    dated = [d for _, d in keep if d]
    games.append({
        'sg': sg, 'year': year,
        'title': 'Slaughter Games %d' % sg,
        'dateFrom': lo.isoformat(), 'dateTo': hi.isoformat(),
        'dateGuessed': year == 2021,          # 2021 hat keine EXIF-Daten
        'location': '',                        # trägt der Betreiber nach
        'players': n,
        'ranking': ranking,
        'photos': photos,
    })
    print('SG%d (%d): %3d Fotos (%d wegen EXIF ausserhalb des Turniers verworfen), %.0f -> %.0f MB'
          % (sg, year, len(photos), ausgefiltert, tin/1e6, tout/1e6))

io.open(os.path.join(REPO, 'tournaments.json'), 'w', encoding='utf-8').write(
    json.dumps(games, ensure_ascii=False, indent=1) + '\n')
print('\ntournaments.json: %d Turniere, %d Fotos gesamt'
      % (len(games), sum(len(g['photos']) for g in games)))
