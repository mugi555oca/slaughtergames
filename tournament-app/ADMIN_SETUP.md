# Admin Setup (2-3 Minuten)

## 1) SQL Migrationen ausführen (in dieser Reihenfolge)
1. `migrations/2026-03-16_admin_rls_and_visibility.sql`
2. `migrations/2026-03-16_seed_user_profiles.sql`

## 2) Auth-User für Spieler anlegen (einmalig)
In Supabase Dashboard → Authentication → Users → Add user

Pattern:
- Email: `<login_name>@slaughtergames.local`
- Password: temporär (z. B. SG-Start-2026)
- Email confirm: true

Login Names stehen in `user_profiles.json` / `user_login_map`.

## 3) Deine Admin-Mail verifizieren
In Tabelle `public.app_admins` müssen deine Login-Mails stehen.
Wenn dein echter Login anders ist, ergänzen:

```sql
insert into public.app_admins(email) values ('DEINE_EMAIL')
on conflict (email) do nothing;
```

## Ergebnis nach Setup
- Alle eingeloggten User sehen alle Turniere/Events.
- Nur Admin darf löschen.
- Spieler können über Login-Name + Passwort einsteigen.
- Dashboard nutzt volle Namen aus Profile/Mapping.

## Neue User später
Schick dem Assistenten Name + Login-Name, dann ergänzt er:
- `user_profiles.json`
- `user_login_map` Migrationseintrag
- optional Auth-Anlage-Checkliste
