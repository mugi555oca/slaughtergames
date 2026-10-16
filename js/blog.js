// Alle Blogartikel: alte (statische Dateien in blog_posts/) + neue aus der DB.
import { supabase } from './supabase.js';
import { POSTS } from './data.js';

export async function loadAllPosts(){
  const { data } = await supabase.from('blog_posts')
    .select('id,title,teaser,cover_url,author_id,created_at').eq('published', true).order('created_at', { ascending: false });
  const db = (data || []).map(p => ({ href: `/post.html?id=${p.id}`, date: p.created_at, img: p.cover_url,
    title: p.title, teaser: p.teaser || '', author: p.author_id }));
  return [...db, ...POSTS].sort((a, b) => new Date(b.date) - new Date(a.date));
}
