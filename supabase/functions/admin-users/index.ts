// Edge Function "admin-users": Accounts anlegen und Passwoerter setzen.
// Nur fuer App-Admins (E-Mail in public.app_admins). Braucht die Service-Role,
// deshalb hier und nicht im Browser.
//
// Login-Name ist immer der Rufname, Passwort fuer Mitglieder immer DEFAULT_PW.
// POST { action: 'create', sgName, realName, slug? }
// POST { action: 'password', userId }      -> zurueck auf DEFAULT_PW
import { createClient } from 'npm:@supabase/supabase-js@2';

const url = Deno.env.get('SUPABASE_URL')!;
const db = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const DEFAULT_PW = 'timewalk';
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: cors });

function slugify(s: string){
  return s.toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'method' }, 405);

  const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  const { data: caller } = await db.auth.getUser(token);
  const email = caller?.user?.email?.toLowerCase();
  if (!email) return json({ error: 'Nicht eingeloggt.' }, 401);
  const { data: admin } = await db.from('app_admins').select('email').ilike('email', email).maybeSingle();
  if (!admin) return json({ error: 'Nur für Admins.' }, 403);

  const body = await req.json().catch(() => ({}));

  if (body.action === 'password') {
    if (!body.userId) return json({ error: 'userId fehlt.' }, 400);
    const { error } = await db.auth.admin.updateUserById(body.userId, { password: DEFAULT_PW });
    return error ? json({ error: error.message }, 400) : json({ ok: true });
  }

  if (body.action === 'create') {
    const sgName = String(body.sgName || '').trim();
    const realName = String(body.realName || '').trim();
    const login = slugify(realName).replace(/-/g, '');
    if (!sgName) return json({ error: 'SG-Name fehlt.' }, 400);
    if (login.length < 2) return json({ error: 'Rufname fehlt (wird zum Login-Namen).' }, 400);
    const mail = `${login}@slaughtergames.local`;

    // Slug: vorhandenen Stammeintrag verknuepfen oder neuen anlegen
    let slug = body.slug ? String(body.slug) : '';
    if (!slug) {
      const { data: existing } = await db.from('roster').select('slug').ilike('name', sgName).maybeSingle();
      slug = existing?.slug || '';
    }
    if (!slug) {
      const base = slugify(realName || sgName) || 'spieler';
      const { data: taken } = await db.from('roster').select('slug').like('slug', `${base}%`);
      const set = new Set((taken || []).map((r: { slug: string }) => r.slug));
      slug = base; let n = 2;
      while (set.has(slug)) slug = `${base}-${n++}`;
    }
    const { data: linked } = await db.from('profiles').select('id').eq('slug', slug).maybeSingle();
    if (linked) return json({ error: 'Dieser Spieler hat schon einen Account.' }, 400);

    const { data: created, error: cErr } = await db.auth.admin.createUser({
      email: mail, password: DEFAULT_PW, email_confirm: true, user_metadata: { display_name: realName || sgName },
    });
    if (cErr) return json({ error: cErr.message }, 400);
    const uid = created.user!.id;

    const { error: rErr } = await db.from('roster').upsert({ slug, name: sgName, real_name: realName || null, active: true, created_by: caller.user!.id }, { onConflict: 'slug' });
    if (rErr) return json({ error: rErr.message }, 400);
    const { error: pErr } = await db.from('profiles').upsert({ id: uid, slug, display_name: realName || sgName }, { onConflict: 'id' });
    if (pErr) return json({ error: pErr.message }, 400);
    return json({ ok: true, userId: uid, slug, login: realName, email: mail });
  }

  if (body.action === 'list') {
    // E-Mail/Login + letzter Login fuer die Mitgliederliste
    const { data, error } = await db.auth.admin.listUsers({ perPage: 1000 });
    if (error) return json({ error: error.message }, 400);
    return json({ users: data.users.map(u => ({ id: u.id, email: u.email, last_sign_in_at: u.last_sign_in_at, created_at: u.created_at })) });
  }

  return json({ error: 'Unbekannte Aktion.' }, 400);
});
