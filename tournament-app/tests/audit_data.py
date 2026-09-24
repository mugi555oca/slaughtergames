# -*- coding: utf-8 -*-
"""Audit: Website-Daten gegen die Excel-Rohdaten (Eternal Daten) pruefen."""
import openpyxl, json, io, os, re, math
from collections import defaultdict

XLSM = r"C:\Users\Mugi\Downloads\SlaughterGames 6 Ranking_V2026.xlsm"
REPO = r"C:\Users\Mugi\AppData\Local\Temp\claude\G--Meine-Ablage-Dropbox-Migration-Vienn-Magicrunde-Slaughter-Games\d7fa9ca9-cfed-4838-b8cd-b7e366006dca\scratchpad\slaughtergames"

# xlsm-Kurzname -> Slug (ueber die Eternal-Ranking-2025-Positionen verifiziert)
SHORT2SLUG = {
    'Vinc':'vinc', 'Berni':'burni', 'David':'david', 'Silvio':'silvio', 'Felix S':'felix',
    'Simon':'simon', 'Heber':'heber', 'Osti':'osti', 'Paul R':'raul', 'Frido':'frido',
    'Niki':'niki', 'Wenzel':'wenzl', 'Fabian':'fabi', 'Ivo':'ivo', 'Mugi':'maugi555-gmail',
    'Mutsch':'luki', 'Marc':'marc', 'Soyka':'paul', 'Hansi':'hansi', 'Sascha':'sasha', 'Leo':'leo',
}
YEAR2SG = {2021:'SG1', 2022:'SG2', 2023:'SG3', 2024:'SG4', 2025:'SG5', 2026:'SG6'}
RARITY = ['M', 'R', 'U', 'C']

# ---------- 1. Wahrheit aus dem xlsm ----------
wb = openpyxl.load_workbook(XLSM, data_only=True)
ws = wb['Eternal Daten']
pts = defaultdict(dict)                      # slug -> {year: points}
for row in ws.iter_rows(min_row=2, values_only=True):
    name, year, p = row[1], row[2], row[3]
    if not isinstance(name, str) or not isinstance(year, (int, float)) or not isinstance(p, (int, float)):
        continue
    short = name.strip()
    assert short in SHORT2SLUG, 'unbekannter Name im xlsm: %r' % short
    pts[SHORT2SLUG[short]][int(year)] = int(p)

years = sorted({y for d in pts.values() for y in d})
truth = {}                                   # SG -> [slug in Platzierungsreihenfolge]
for y in years:
    field = sorted(((s, d[y]) for s, d in pts.items() if y in d), key=lambda t: -t[1])
    n = len(field)
    # Punkte = (Teilnehmer + 1) - Platz  =>  Platz = n + 1 - Punkte
    places = {}
    for slug, p in field:
        place = n + 1 - p
        assert 1 <= place <= n, 'Punkte %d passen nicht zu %d Spielern (%s %d)' % (p, n, slug, y)
        assert place not in places, 'doppelter Platz %d in %d' % (place, y)
        places[place] = slug
    assert sorted(places) == list(range(1, n + 1)), 'Luecke in den Plaetzen %d' % y
    truth[YEAR2SG[y]] = [places[i] for i in range(1, n + 1)]

# ---------- 2. Website-Daten ----------
html = io.open(os.path.join(REPO, 'index.html'), encoding='utf-8').read()
site = {}
for m in re.finditer(r'SLAUGHTER GAMES (\d) \((\d{4})\)(.*?)</div>\s*</div>', html, re.S):
    sg = 'SG' + m.group(1)
    slugs = re.findall(r'<span class="rank">(\d+)</span>\s*<span class="name"><a href="player-profile\.html\?slug=([a-z0-9-]+)"', m.group(3))
    site[sg] = [s for _, s in sorted(slugs, key=lambda t: int(t[0]))]

profiles = json.load(io.open(os.path.join(REPO, 'tournament-app', 'player_profiles.json'), encoding='utf-8'))
by_slug = {p['slug']: p for p in profiles}
NAME = {s: p['name'] for s, p in by_slug.items()}

problems = []

# ---------- 3. Turnierlisten vergleichen ----------
print('=== Turnierlisten: Website vs. Excel ===')
for sg in sorted(truth, key=lambda s: int(s[2:])):
    t, w = truth[sg], site.get(sg, [])
    if t == w:
        print('  %s  %2d Spieler  OK' % (sg, len(t)))
        continue
    print('  %s  ABWEICHUNG (Excel %d / Website %d)' % (sg, len(t), len(w)))
    for i in range(max(len(t), len(w))):
        a = t[i] if i < len(t) else None
        b = w[i] if i < len(w) else None
        if a != b:
            print('      Platz %2d: Excel=%-34s Website=%s'
                  % (i + 1, NAME.get(a, a or '-'), NAME.get(b, b or '-')))
            problems.append('%s Platz %d' % (sg, i + 1))

# ---------- 4. Teilnahmen ----------
print('\n=== Teilnahmen in player_profiles.json ===')
for slug in sorted(by_slug):
    should = sorted((sg for sg, order in truth.items() if slug in order), key=lambda s: int(s[2:]))
    have = sorted(by_slug[slug].get('participations', []), key=lambda s: int(s[2:]))
    if should != have:
        print('  %-38s soll %-28s ist %s' % (NAME[slug][:38], ','.join(should), ','.join(have) or '-'))
        problems.append('Teilnahmen %s' % slug)
print('  (keine Ausgabe = alles korrekt)' if not any(p.startswith('Teilnahmen') for p in problems) else '')

# ---------- 5. Aexte (Top 4 je Turnier) ----------
print('\n=== Aexte ===')
for slug in sorted(by_slug):
    should = sorted(('%s%s' % (sg, RARITY[truth[sg].index(slug)])
                     for sg in truth if slug in truth[sg][:4]))
    have = sorted('%s%s' % (a['sg'], a['rarity']) for a in by_slug[slug].get('axes', []))
    if should != have:
        print('  %-38s soll %-22s ist %s' % (NAME[slug][:38], ','.join(should) or '-', ','.join(have) or '-'))
        problems.append('Aexte %s' % slug)
print('  (keine Ausgabe = alles korrekt)' if not any(p.startswith('Aexte') for p in problems) else '')

# ---------- 6. Eternal Ranking nachrechnen ----------
print('\n=== Eternal Ranking (Formel gegen Website) ===')
N = len(truth)
def eternal(slug):
    d = pts[slug]
    total, n = sum(d.values()), len(d)
    return total / math.sqrt(2.0 * n * N / (n + N))

calc = sorted(pts, key=lambda s: (-eternal(s), NAME[s]))
sec = re.search(r'<section class="eternal-ranking">.*?</section>', html, re.S).group(0)
site_eternal = [s for _, s in sorted(
    re.findall(r'<span class="rank">(\d+)</span>\s*<span class="name"><a href="player-profile\.html\?slug=([a-z0-9-]+)"', sec),
    key=lambda t: int(t[0]))]
for i, (a, b) in enumerate(zip(calc, site_eternal), 1):
    if a != b:
        print('  Platz %2d: berechnet=%-34s Website=%s' % (i, NAME[a], NAME[b]))
        problems.append('Eternal Platz %d' % i)
if len(calc) != len(site_eternal):
    print('  Laenge: berechnet=%d Website=%d' % (len(calc), len(site_eternal)))
    problems.append('Eternal Laenge')
if not any(p.startswith('Eternal') for p in problems):
    print('  alle %d Plaetze stimmen' % len(calc))

print('\n' + ('KEINE ABWEICHUNGEN' if not problems else '%d Befund(e)' % len(problems)))
