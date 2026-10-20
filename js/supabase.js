// Ein einziger Supabase-Client fuer die ganze App (auch die Turnier-Seiten,
// siehe tournament-app/js/supabase-client.js).
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.118.0/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../tournament-app/js/config.js';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
});
