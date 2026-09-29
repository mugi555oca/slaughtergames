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
`player_badges`, `app_admins`, `user_login_map`.

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
