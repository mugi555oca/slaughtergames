# Handover – slaughtergames.at

Für alle, die an der Seite oder der Turnier-App mitarbeiten. Gedacht zum
Mitlesen für einen KI-Assistenten (Claude Code o. ä.), deshalb eher ausführlich.

---

## 1. Zugang – bitte so, nicht anders

**Es werden keine Tokens, Passwörter oder Keys weitergegeben.** Jede Person
meldet sich mit dem eigenen Account an. Das hat drei Gründe: man sieht in der
Historie wer was gemacht hat, Zugang lässt sich einzeln entziehen, und ein
geleakter Token legt nicht alles gleichzeitig offen.

Der Betreiber lädt ein:

| Dienst | Einladung | Rolle |
|---|---|---|
| GitHub | `mugi555oca/slaughtergames` → Settings → Collaborators | Write |
| Supabase | Dashboard → Organization → Team → Invite | Developer |
| Netlify | *nur falls nötig* – Deploys laufen automatisch über GitHub | – |

Danach meldet sich der Mitarbeitende lokal selbst an:

```bash
gh auth login
supabase login
```

Beide legen ihren Token in der eigenen Keychain ab. Er landet **nicht** im Repo
und **nicht** im Chat.

### Was niemals geteilt oder committet wird

- Supabase **service_role key** (umgeht sämtliche RLS)
- Datenbank-Passwort, Personal Access Tokens, Netlify-Tokens
- Passwörter der Spieler-Accounts

### Was öffentlich ist und sein darf

`tournament-app/js/config.js` enthält die Supabase-URL und den **anon key**.
Das ist so vorgesehen: der anon key ist ein öffentlicher Client-Key, der
Schutz kommt ausschließlich aus Row Level Security. Wer an den Policies
schraubt, ändert damit die Sicherheitsgrenze der ganzen App.

---

## 2. Das Setup in einem Absatz

Statische Seite im Repo-Root, Deploy über **Netlify** (verbunden mit dem
GitHub-Repo, `main` → live), Daten in **Supabase** (Postgres + Auth + Storage).
Kein Build-Schritt, kein Framework, kein npm im Frontend: reines HTML, CSS und
ES-Module direkt im Browser. Supabase wird als UMD-Script von unpkg geladen.

**Push auf `main` = live in ~20–30 Sekunden.** Es gibt keine Staging-Umgebung.

---

## 3. Verzeichnisse

```
/                       öffentliche Seite
  index.html            Startseite: Eternal Ranking, Turniere, Merch, SG7
  turnier.html          Turnier-Unterseite (?sg=1..6)
  spieler.html          Übersicht aller Spielerprofile
  player-profile.html   einzelnes Spielerprofil (?slug=…)
  blog.html, blog_posts/
  styles.css            gesamte Seite (Cache-Buster: ?v=… in allen <link>)
  badges.svg            Sprite mit den Abzeichen-Icons
  tournaments.json      generiert – siehe tests/prep_games.py
  assets/games/sgN/     Turnierfotos
  assets/sg6_fotos/     handverlesene Blogfotos – NICHT überschreiben

/tournament-app         die App (Login nötig)
  login, dashboard, round, bracket, spectator, profile, admin
  js/                   ES-Module, ein File pro Seite
    tournament.js       Kernlogik: Pairing, Standings, Tiebreaker, Korrektur
    supabase-client.js  Client aus config.js
    auth.js             Login, Redirect-Handling
  migrations/           SQL, chronologisch benannt
  tests/                siehe unten
  player_profiles.json  Turnierfakten je Spieler (Teilnahmen, Äxte)
```

---

## 4. Datenbank

Tabellen in `public`: `tournaments`, `players`, `rounds`, `matches`,
`player_round_stats`, `player_opponents`, `profiles`, `badges`,
`player_badges`, `roster`, `app_admins`, `user_login_map`.

`roster` ist der SG-weite Spielerstamm. Daraus kommt die Spielerauswahl beim
Turnier-Anlegen; neue Spieler legt der Admin im Admin-Cockpit an. Die Namen
müssen exakt denen aus früheren Turnieren entsprechen, weil das globale Ranking
nach `players.name` summiert.

**RLS ist überall aktiv.** Grobe Regel:

- **Lesen**: öffentlich (auch ohne Login) für alles rund ums Turnier, damit die
  Spectator-Ansicht per Link teilbar ist
- **Schreiben**: Owner des Turniers oder App-Admin (`public.is_app_admin()`,
  prüft die E-Mail aus dem JWT gegen `app_admins`)
- `profiles`: jeder darf sein **eigenes** Profil ändern; der `slug` ist per
  Trigger festgenagelt, sonst könnte man ein fremdes Profil kapern
- Storage-Bucket `avatars`: öffentlich lesbar, schreiben nur in den eigenen
  Ordner `<user-id>/…`

### Wichtig zu verstehen: Snapshots

Standings werden **immer** aus `matches` neu gerechnet. `player_round_stats`
ist nur ein Snapshot, den `finalizeCurrentRound()` schreibt. Wer ein Ergebnis
nachträglich ändert, **muss** die Snapshots nachziehen — sonst stimmen die
Live-Standings, aber das globale Ranking bleibt falsch. Genau das war mal ein
Bug. Dafür gibt es `correctMatchResult()` in `tournament.js`; benutze das statt
eines direkten Updates auf `matches`.

### Migrationen

Neue Datei unter `tournament-app/migrations/JJJJ-MM-TT_zweck.sql`, dann:

```bash
supabase link --project-ref shzyksgqawknysbvhlwn
supabase db query --linked -f tournament-app/migrations/DEINE_DATEI.sql
```

Schreib sie idempotent (`drop policy if exists …`, `on conflict do update`),
damit ein zweiter Lauf nichts kaputtmacht. Am Ende `notify pgrst, 'reload schema';`
nicht vergessen, sonst kennt die REST-API neue Spalten nicht.

⚠️ Es gibt **keine** getrennte Test-Datenbank. Jedes SQL trifft die
Produktivdaten. Zum Ausprobieren eine Transaktion mit `rollback` nutzen.

---

## 5. Tests

```bash
node tournament-app/tests/correction.test.mjs   # 15 Fälle, Ergebnis-Korrektur
node tournament-app/tests/pairing.test.mjs      # 9 Fälle, Swiss-Paarung ohne Rematches
python tournament-app/tests/audit_data.py       # Daten gegen die Excel prüfen
```

`correction.test.mjs` läuft gegen einen In-Memory-Stub, braucht also kein
Supabase, und liest zur Laufzeit die echte `tournament.js` — kann damit nicht
veralten. **Vor jedem Push auf `tournament.js` laufen lassen**, die Funktionen
dort löschen Runden.

`audit_data.py` vergleicht Turnierlisten, Teilnahmen, Äxte und das Eternal
Ranking gegen die Rohpunkte im xlsm. Muss „KEINE ABWEICHUNGEN" melden.

---

## 6. Das Eternal Ranking

Die Formel ist nicht offensichtlich und steht ausführlich in
[ETERNAL_RANKING_FORMEL.md](ETERNAL_RANKING_FORMEL.md). Kurz:

```
Punkte pro Turnier: P = (Teilnehmerzahl + 1) − Platz

                ΣP
   E  =  ───────────────────
          √( 2·n·N / (n+N) )        n = Teilnahmen, N = Turniere gesamt
```

Der Nenner ist die Wurzel aus dem **harmonischen Mittel** von n und N. Verifiziert
gegen alle 41 gespeicherten Werte aus 2025 und 2026. Wenn ein Turnier dazukommt,
steigt N und damit ändern sich **alle** Werte, auch bei Spielern, die nicht
dabei waren.

---

## 7. Fallstricke, die schon mal Zeit gekostet haben

- **`assets/sg6_fotos/` nicht anfassen.** Das sind 22 handverlesene Bilder mit
  Bildunterschriften im Blogeintrag. Turnierfotos gehören nach `assets/games/sgN/`.
- **Cache-Buster.** `styles.css` und `badges.svg` werden versioniert geladen
  (`?v=…`). Wer CSS ändert und die Version vergisst, sieht die Änderung — die
  anderen nicht.
- **Dateinamen von Fotos lügen.** Viele sind Signal-Exporte, deren Name das
  Versand- und nicht das Aufnahmedatum trägt. Der **Ordner** bestimmt die
  Zuordnung, nicht der Name.
- **`upsert` braucht eine INSERT-Policy**, auch wenn die Zeile existiert.
  Fehlt sie, schlägt das Speichern stillschweigend fehl.
- **`[hidden]` wird von `display:` überschrieben.** Wer einer Klasse
  `display:inline-block` gibt, muss `[hidden]{display:none}` nachziehen.
- **Netlify-Edge-Cache.** Direkt nach dem Deploy kann eine Abfrage noch die
  alte Version liefern. Zweimal prüfen, bevor man an einen Fehler glaubt.

---

## 8. Arbeitsweise

Da `main` direkt deployt: für alles außer Tippfehlern einen Branch und einen
Pull Request. Netlify baut Deploy-Previews pro PR, damit lässt sich schauen,
bevor es live geht.

```bash
git switch -c feature/xyz
# … arbeiten, Tests laufen lassen …
git push -u origin feature/xyz
gh pr create
```

Für Änderungen an RLS-Policies, an `tournament.js` oder an irgendetwas, das
Daten löscht: vorher mit dem Betreiber abstimmen.

---

## 9. Kontakt / Eigentümer

Betreiber: Stephan „Mugi" Mauracher — GitHub `mugi555oca`, Supabase-Org und
Netlify-Team „Mugi Cooporation". Supabase-Projekt-Ref: `shzyksgqawknysbvhlwn`.

---

## 10. Die App (seit Oktober 2026)

Die ganze Seite ist eine **PWA**: `manifest.webmanifest` + `sw.js` im Root.
Installierbar über „Zum Startbildschirm“, aktualisiert sich bei jedem Deploy
selbst (HTML/CSS/JS kommen immer zuerst aus dem Netz, der Cache ist nur
Offline-Rückfall). **Kein Cache-Buster mehr nötig.** `VERSION` in `sw.js` nur
ändern, wenn sich der Service Worker selbst ändert.

```
app.css               Design-System für alle Seiten
js/app.js             Shell (obere Leiste, Tab-Leiste, Glocke), me(), loadPeople(), Helfer
js/supabase.js        der eine Supabase-Client (ESM von jsdelivr)
js/data.js            statische Inhalte: SG7, Sieger, Blog, Merch, Cubes, Eternal-Formel
js/gallery.js         private Galerie (signierte URLs, Upload, Lightbox)
js/push.js            Web-Push an/abmelden
js/page-*.js          ein Modul pro Seite
tournament-app/       round.html (Runde/Tabelle/Verlauf), dashboard.html, new.html
admin/                Admin-Backend (Desktop): Mitglieder, Abzeichen, Turniere, Galerie, Chat
supabase/functions/   Edge Functions: push, admin-users
```

### Rechte (Migration `2026-10-16_app.sql`)

- **Mitglied** = eingeloggt **und** Profil mit `slug` (`public.is_member()`).
  Accounts legt der Admin im Backend an (Edge Function `admin-users`).
- **Turniere**: Mitglieder dürfen alles, solange `status = 'active'`.
  Abgeschlossene Turniere ändert nur der Admin (`can_edit_tournament()`).
- **Galerie**: Bucket `gallery` ist privat. Lesen/Hochladen Mitglieder,
  Löschen nur Admin. Die alten Fotos aus `assets/games/` liegen jetzt dort
  (`tournament-app/tests/upload_gallery.py`).
- **Chat**: 7 Räume in `chat_rooms`, Mitglieder schreiben überall, löschen
  eigene; Admin löscht alles.

### Turnierspieler ↔ Profil

`players.slug` wird per Trigger aus `roster.name` gesetzt. Darüber findet die
App „Deine Partie“ und die Benachrichtigungen den richtigen Account.

### Push

Trigger auf `matches`/`tournaments` schreiben in `notifications` (In-App-Glocke);
jede neue Zeile ruft `dispatch_push()` → `pg_net` → Edge Function `push`.
Chat-Nachrichten pushen direkt (ohne `notifications`-Zeile). URL und Secret
des Hooks liegen im **Vault** (`push_hook_url`, `push_hook_secret`), VAPID-Keys
in den Function-Secrets. Fehlt etwas davon, wird still nichts geschickt.

iPhone: Push nur in der installierten App (iOS 16.4+).

### Nachtrag 17.10.2026

- **Begriffe:** „Slaughter Games“ = das Jahres-Event (tournaments.json),
  „Weekly“ = die Turniere unter der Woche (Tabelle `tournaments`).
- **Logins:** Login-Name = Rufname (aus `roster.real_name`, klein, ohne
  Umlaute → `<name>@slaughtergames.local`), Passwort aller Mitglieder
  `timewalk`. Admin-Accounts sind ausgenommen. Neue Accounts nur über
  `/admin/` → Mitglieder (Edge Function `admin-users`).
- **Weekly-Ranking** (`js/weekly.js`): Punkte, Ø/Runde und „Wertung“ nach
  der Eternal-Formel (n = eigene Weeklys, N = alle Weeklys). Rechnet direkt
  aus `matches` über `buildStandings()`.
- **Chat-Bilder:** privater Bucket `chat`, Pfad `<user-id>/<uuid>.jpg`.
- **Ausgaben-Splitter:** `split_events/members/expenses/shares/payments`.
  Nur Teilnehmer (vom Admin gepflegt) sehen und buchen; Ausgaben nur über
  `split_add_expense()` (verteilt Cent-genau). Abrechnung im Client:
  größter Schuldner zahlt an größten Gläubiger.


- **Blog:** neue Artikel in `blog_posts` (öffentlich lesbar, schreiben jedes
  Mitglied, ändern Autor/Admin). Bilder im öffentlichen Bucket `blog`.
  Text ist ein kleines, sicheres Markdown (`js/markdown.js`). Die drei alten
  Artikel bleiben als Dateien in `blog_posts/`; Fotostrecken gehören in die
  Galerie, nicht in den Blog.

### Nachtrag 19.10.2026

- **Terminfinder** (`termine.html`, Tabellen `meetups`, `meetup_votes`): dabei/maybe/raus,
  Ziel 8 Spieler (10/12 auch gut, 4–5 = Highländer). Aus einem Termin startet
  „Weekly starten“ das Turnier mit allen Zusagen vorausgewählt.
- **Spiellocations** (`play_locations`): nur für Mitglieder lesbar, Gastgeber
  pflegt Adresse/Klingel im Profil, Admin alles unter /admin/#locations.
- **Benachrichtigungen**: Texte (österreichisch, mit Zufallsvarianten) entstehen
  in den Trigger-Funktionen der Migration `2026-10-19_termine_notify.sql`.
  Jede Art ist pro Person abschaltbar (`notification_prefs`). Erinnerung am
  Spieltag per pg_cron (`sg-meetup-reminders`, täglich 10:00 UTC).

### Nachtrag 20.10.2026 – Boosterpool

- Ersetzt Fridos Google Sheet „Magic Boosterpool“. Tabellen `pool_*`, Logik in
  `js/pool.js` (Guthaben = Einzahlungen − Drafts; Konto = Einzahlungen − Einkäufe
  + Verkäufe; Lager = Booster − gedraftet − verkauft + Korrekturen).
- Ansicht für alle Mitglieder: `boosterpool.html` (Chat-Tab). Verwaltung:
  `boosterpool-admin.html`, erlaubt für `pool_admins` (Frido, Mugi) + App-Admins.
- Altdaten am 20.10.2026 aus dem Sheet importiert; Guthaben centgenau gleich.
