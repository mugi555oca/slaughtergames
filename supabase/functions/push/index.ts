// Edge Function "push": verschickt Web-Push an alle Geraete der angegebenen
// Nutzer. Aufgerufen von der Datenbank (dispatch_push via pg_net), geschuetzt
// ueber den Header x-hook-secret. Tote Subscriptions (404/410) werden geloescht.
//
// Secrets:  PUSH_HOOK_SECRET, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT
// Deploy:   supabase functions deploy push --no-verify-jwt
import webpush from 'npm:web-push@3.6.7';
import { createClient } from 'npm:@supabase/supabase-js@2';

const secret = Deno.env.get('PUSH_HOOK_SECRET');
webpush.setVapidDetails(
  Deno.env.get('VAPID_SUBJECT') || 'mailto:admin@slaughtergames.at',
  Deno.env.get('VAPID_PUBLIC_KEY')!,
  Deno.env.get('VAPID_PRIVATE_KEY')!,
);
const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false },
});

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('method', { status: 405 });
  if (!secret || req.headers.get('x-hook-secret') !== secret) return new Response('forbidden', { status: 403 });

  const { user_ids, title, body, url, tag } = await req.json();
  if (!Array.isArray(user_ids) || !user_ids.length) return Response.json({ sent: 0 });

  const { data: subs, error } = await db.from('push_subscriptions')
    .select('id,endpoint,p256dh,auth').in('user_id', user_ids);
  if (error) return Response.json({ error: error.message }, { status: 500 });

  const payload = JSON.stringify({ title, body, url, tag });
  let sent = 0;
  const dead: string[] = [];
  await Promise.all((subs || []).map(async (s) => {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        payload,
        { TTL: 60 * 60 * 12, urgency: 'high' },
      );
      sent++;
    } catch (err) {
      const code = (err as { statusCode?: number }).statusCode;
      if (code === 404 || code === 410) dead.push(s.id);
      else console.error('push failed', code, (err as Error).message);
    }
  }));
  if (dead.length) await db.from('push_subscriptions').delete().in('id', dead);
  return Response.json({ sent, removed: dead.length });
});
