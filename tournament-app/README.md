# Slaughter Games Tournament App (Netlify + Supabase + Vanilla JS)

## Enthalten
- `schema.sql` – PostgreSQL/Supabase Schema (Auth, Turniere, Spieler, Runden, Matches, Stats, Opponents, RLS)
- `login.html` – Login/Registrierung
- `dashboard.html` – Turnier erstellen + Liste bestehender Turniere
- `round.html` – Pairings, Ergebniseingabe, Live-Standings, Runde finalisieren, Export
- `bracket.html` – visuelle Runden-/Pairing-Ladder
- `profile.html` – User-Profil (Display Name)
- `admin.html` – Admin-Cockpit (Übersicht, Archivieren)
- `spectator.html` – read-only Live-Standings Ansicht
- `dev-seed.html` – erzeugt automatisch ein Demo-Turnier mit Ergebnissen
- `js/auth.js` – Auth-Flow
- `js/tournament.js` – Swiss-Pairing + Tiebreaker + Persistenz
- `js/dashboard-page.js`, `js/round-page.js`, `js/bracket-page.js`, `js/profile-page.js` – UI State-Handling

## Setup
1. In Supabase SQL Editor `schema.sql` vollständig ausführen.
2. Inhalte dieses Ordners auf Netlify deployen (oder in bestehende Seite einhängen).
3. In Supabase Auth sicherstellen, dass Email/Password Login aktiv ist.
4. `login.html` öffnen.

## Tiebreaker (exakt im Code markiert)
Berechnung in `js/tournament.js`:
- `computeDerived(...)` berechnet MW%/GW%/OMW%/OGW%
- Floor-Regel: MW% und GW% haben min. 33%
- OMW% und OGW% ignorieren Byes

## Swiss-Pairing-Logik (Phase 2 verbessert)
- Runde 1: zufällig
- Ab Runde 2:
  - sortiert nach Match Points, OMW%, GW%, OGW%
  - Paarung nach Score-Groups
  - bei ungerader Group: ein Floater in nächste Group
  - Rematches vermeiden
- **Neu:** Backtracking-Pairing innerhalb Score-Groups (`bestPairing(...)`) zur Minimierung von Rematches statt nur greedy Paarung

## Bracket/Visualisierung
Swiss ist kein klassischer KO-Tree. Deshalb ist die "Bracket"-Seite als **Round Ladder** umgesetzt:
- Runde für Runde alle Tische + Resultate
- funktioniert stabil für Swiss Events

## Export
- CSV Export aus `round.html`
- PDF-Export via Print-View (`window.print`) aus `round.html`

## Admin + QA
- `admin.html`: Alle Turniere, aktiver Spielerstand, schnelle Archivierung
- Rejoin-Support: gedroppte Spieler können wieder aktiviert werden
- `dev-seed.html`: automatischer End-to-End Seed für schnellen Test

## Deploy/Hardening
- `netlify.toml`: Redirect auf `login.html`
- `_headers`: Basis Security Header gesetzt
- Eingabe-Validierung: doppelte Spielernamen + Rundenzahlgrenzen
- Pairing-Transparenz: Hinweis, wenn Rematches in einer Runde unvermeidbar waren
- UX-States: Busy-Buttons bei Erstellen/Finalisieren/Generieren/Abschließen
- Pairing-Engine Guardrail: Backtracking mit hartem Suchlimit gegen UI-Hänger
- Mobile UX: Tabellen mit horizontalem Scroll-Wrapper + KPI/Status Chips
- Spectator View: read-only Standings mit Live-Refresh bei Match-Updates

## Unterschied zu offizieller WER/Comp REL Komplexität
Weiterhin bewusst für lokale Casual Draft Events optimiert:
- Kein globales Constraint-Solving über alle Runden
- Deterministisches Score-Group Pairing mit Backtracking pro Runde

## Testdaten (8 Spieler)
Im Dashboard-Button "8 Testspieler laden" enthalten:
Anna, Benedikt, Clara, David, Elena, Fabian, Greta, Hannes

## Persistenz / Weiterarbeit bei Credit-Limit
Stand ist vollständig auf Disk in:
`slaughtergames/tournament-app/`
