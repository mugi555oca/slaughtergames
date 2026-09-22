# Eternal Ranking – Formel

Rekonstruiert aus `SlaughterGames 6 Ranking_V2026.xlsm` (Blätter *Eternal Daten* und
*Eternal Ranking*). Die Zellen enthalten nur noch Werte, keine Formeln mehr – die
Rechenvorschrift wurde deshalb aus den Daten zurückgerechnet und geprüft.

## 1. Punkte pro Turnier

Platz 1 bekommt so viele Punkte, wie Spieler am Start waren. Jeder weitere Platz
einen weniger, der Letzte bekommt 1.

```
P = (Teilnehmerzahl + 1) − Platzierung
```

| SG | Jahr | Spieler | Punkte 1. Platz | Sieger |
|----|------|---------|-----------------|--------|
| 1 | 2021 | 8 | 8 | Vinc |
| 2 | 2022 | 12 | 12 | Berni |
| 3 | 2023 | 16 | 16 | Berni |
| 4 | 2024 | 16 | 16 | Vinc |
| 5 | 2025 | 18 | 18 | Felix S |
| 6 | 2026 | 20 | 20 | David |

## 2. Eternal-Punkte

```
              ΣP
   E = ─────────────────
        √( 2·n·N / (n+N) )
```

- `ΣP` – Summe aller Turnierpunkte des Spielers
- `n`  – Anzahl der Turniere, bei denen er dabei war
- `N`  – Anzahl aller bisher gespielten Turniere (aktuell 6)

Der Nenner ist die **Wurzel aus dem harmonischen Mittel von `n` und `N`**
(`H = 2nN/(n+N)`).

### Wirkung

Das harmonische Mittel zieht zum kleineren Wert. Wer alle Turniere gespielt hat
(`n = N`), wird durch `√N` geteilt. Wer seltener dabei war, wird durch eine
kleinere Zahl geteilt und dafür teilweise kompensiert – aber eben nur teilweise.

Das Ergebnis liegt damit zwischen zwei Extremen:

- **Gesamtpunkte** – würde Dauergäste belohnen, nur weil sie öfter punkten konnten
- **Schnitt pro Turnier** – würde Teilnahme komplett ignorieren

### Beispiel David (Stand SG6)

```
Punkte:  14 (SG3) + 14 (SG4) + 16 (SG5) + 20 (SG6) = 64
n = 4, N = 6

E = 64 / √(2·4·6 / (4+6))
  = 64 / √4,8
  = 64 / 2,19089
  = 29,2119
```

## Verifikation

Nachgerechnet gegen die im xlsm hinterlegten Werte:

- **Eternal Ranking 2026** (N = 6): 21 / 21 Spieler exakt
- **Eternal Ranking 2025** (N = 5): 20 / 20 Spieler exakt

Alle 41 Werte stimmen auf < 1e-6 genau. Die Formel gilt damit als bestätigt.

## Nach einem neuen Turnier

1. In *Eternal Daten* die Zeilen `Spieler | Jahr | Punkte` für das neue Turnier ergänzen.
2. `N` erhöht sich automatisch um 1 – dadurch ändern sich **alle** Eternal-Punkte,
   auch die von Spielern, die nicht dabei waren (ihr `n` bleibt gleich, `N` steigt,
   der Nenner wächst, ihre Punkte sinken).
3. Auf der Website: `index.html` (Eternal Ranking + neues Turnier), `rankings.txt`,
   `axtverteilung.csv` / `.txt`, `User_Profiles.csv` und
   `tournament-app/player_profiles.json` nachziehen.
4. Im Tooltip in `index.html` (`.formula-tooltip`) das `N = Turniere insgesamt (6)`
   und das Rechenbeispiel aktualisieren.
