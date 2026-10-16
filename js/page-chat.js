// Chat: Raumliste (chat.html) und Unterhaltung (chat.html?room=slug).
// Live ueber Supabase Realtime; Push kommt per DB-Trigger -> Edge Function.
import { initShell, $, esc, icon, supabase, loadPeople, lockHtml, openSheet, toast, timeAgo, fmtTime, fmtDay, confirmSheet } from './app.js';

const roomSlug = new URLSearchParams(location.search).get('room');
const main = $('#chatMain');

if(roomSlug){
  document.body.classList.add('chat-page');
  const m = await initShell({ tab: 'chat', title: 'Chat', back: '/chat.html', hideTabs: true });
  if(!m.user) main.innerHTML = lockHtml('Chat nur für Mitglieder', 'Einloggen, um mitzureden.');
  else if(!m.isMember) main.innerHTML = '<div class="card muted">Dein Account ist noch keinem Spieler zugeordnet.</div>';
  else await room(m);
} else {
  const m = await initShell({ tab: 'chat', title: 'Chat' });
  if(!m.user) main.innerHTML = `<h1 class="page-title">Chat</h1>` + lockHtml('Chat nur für Mitglieder', 'Hot Grannies, Slaughter Games und die SG-Teams – einloggen, um mitzureden.');
  else if(!m.isMember) main.innerHTML = '<div class="card muted">Dein Account ist noch keinem Spieler zugeordnet.</div>';
  else await rooms(m);
}

// ---------------------------------------------------------------
// Raumliste
// ---------------------------------------------------------------
async function rooms(m){
  const people = await loadPeople();
  main.innerHTML = `<h1 class="page-title">Chat</h1><div class="list" id="rooms"><div class="skel" style="height:460px"></div></div>`;

  async function paint(){
    const { data, error } = await supabase.rpc('chat_overview');
    if(error){ $('#rooms').innerHTML = `<div class="empty">${esc(error.message)}</div>`; return; }
    $('#rooms').innerHTML = data.map(r => {
      const who = r.last_user ? (r.last_user === m.user.id ? 'Du' : people.byId.get(r.last_user)?.real || 'Jemand') : '';
      const unread = Number(r.unread || 0);
      return `<a class="list-item" href="/chat.html?room=${encodeURIComponent(r.slug)}">
        <img class="avatar sq" src="/${esc(r.icon)}" alt="" style="width:50px;height:50px;border-radius:14px">
        <div class="grow"><div class="title ellipsis">${esc(r.name)}</div>
          <div class="sub ellipsis" style="${unread ? 'color:var(--text)' : ''}">${r.last_body ? `${esc(who)}: ${esc(r.last_body)}` : '<i>Noch keine Nachrichten</i>'}</div></div>
        <div class="trail" style="flex-direction:column;align-items:flex-end;gap:5px">
          <span class="tiny">${r.last_at ? esc(timeAgo(r.last_at)) : ''}</span>
          ${unread ? `<span class="unread">${unread > 99 ? '99+' : unread}</span>` : ''}
        </div></a>`;
    }).join('');
  }
  await paint();
  supabase.channel('chat-list')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_messages' }, () => paint())
    .subscribe();
  document.addEventListener('visibilitychange', () => { if(!document.hidden) paint(); });
}

// ---------------------------------------------------------------
// Unterhaltung
// ---------------------------------------------------------------
function linkify(text){
  return esc(text).replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>');
}

async function room(m){
  const people = await loadPeople();
  const { data: r } = await supabase.from('chat_rooms').select('*').eq('slug', roomSlug).maybeSingle();
  if(!r){ main.innerHTML = '<div class="empty">Diesen Chat gibt es nicht.</div>'; return; }
  document.title = `${r.name} – Chat`;
  const titleEl = document.querySelector('.app-bar .title');
  titleEl.innerHTML = `<span class="row" style="gap:10px"><img src="/${esc(r.icon)}" alt="" style="width:30px;height:30px;border-radius:9px">${esc(r.name)}</span>`;

  main.innerHTML = `<button class="btn xs ghost" id="olderBtn" style="margin:0 auto 8px;display:none">Ältere laden</button><div class="chat-log" id="log"></div>`;
  const composer = document.createElement('div');
  composer.className = 'composer';
  composer.innerHTML = `<div class="reply-bar" id="replyBar" hidden><span class="grow ellipsis" id="replyText"></span>
      <button class="icon-btn" id="replyX" style="width:28px;height:28px" aria-label="Antwort abbrechen">${icon('x')}</button></div>
    <form class="composer-inner" id="sendForm">
      <textarea id="msgInput" rows="1" placeholder="Nachricht an ${esc(r.name)}" maxlength="4000" aria-label="Nachricht"></textarea>
      <button class="send" type="submit" aria-label="Senden">${icon('send')}</button>
    </form>`;
  document.body.appendChild(composer);

  const log = $('#log');
  const byId = new Map();
  let msgs = [];
  let replyTo = null;
  const PAGE = 60;

  const person = uid => people.byId.get(uid) || { real: 'Mitglied', display: 'Mitglied', avatar: '/icons/icon-192.png' };

  function bubble(msg, prev){
    const mine = msg.user_id === m.user.id;
    const cont = prev && prev.user_id === msg.user_id && (new Date(msg.created_at) - new Date(prev.created_at)) < 5 * 60000
      && fmtDay(prev.created_at) === fmtDay(msg.created_at);
    const p = person(msg.user_id);
    const q = msg.reply_to ? byId.get(msg.reply_to) : null;
    return `<div class="msg-row ${mine ? 'me' : ''} ${cont ? 'cont' : ''}" data-id="${msg.id}">
      ${mine ? '' : `<a href="${p.slug ? '/player-profile.html?slug=' + encodeURIComponent(p.slug) : '#'}"><img class="avatar" src="${esc(p.avatar)}" alt="${esc(p.real)}" loading="lazy"></a>`}
      <div class="bubble">${!mine && !cont ? `<span class="from">${esc(p.display)}</span>` : ''}${q
        ? `<span class="quote"><b>${esc(person(q.user_id).display)}</b>: ${esc(q.body.slice(0, 120))}</span>` : ''}${linkify(msg.body)}<span class="time">${fmtTime(msg.created_at)}</span></div>
    </div>`;
  }

  function paint(){
    let html = '', prev = null, day = null;
    for(const msg of msgs){
      const d = fmtDay(msg.created_at);
      if(d !== day){ html += `<div class="day-sep">${esc(d)}</div>`; day = d; prev = null; }
      html += bubble(msg, prev);
      prev = msg;
    }
    log.innerHTML = html || `<div class="empty">${icon('chat')}<h3>Noch ruhig hier</h3><p>Schreib die erste Nachricht.</p></div>`;
  }

  const scrollBottom = (smooth = false) => main.scrollTo({ top: main.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
  const nearBottom = () => main.scrollHeight - main.scrollTop - main.clientHeight < 140;

  async function load(before = null){
    let q = supabase.from('chat_messages').select('*').eq('room_id', r.id).order('created_at', { ascending: false }).limit(PAGE);
    if(before) q = q.lt('created_at', before);
    const { data, error } = await q;
    if(error) throw error;
    const rows = (data || []).reverse();
    rows.forEach(x => byId.set(x.id, x));
    $('#olderBtn').style.display = (data || []).length === PAGE ? 'flex' : 'none';
    return rows;
  }

  async function markRead(){
    if(document.hidden) return;
    await supabase.from('chat_reads').upsert({ user_id: m.user.id, room_id: r.id, last_read_at: new Date().toISOString() });
  }

  msgs = await load();
  paint();
  scrollBottom();
  markRead();

  $('#olderBtn').addEventListener('click', async () => {
    const h = main.scrollHeight;
    const older = await load(msgs[0]?.created_at);
    msgs = older.concat(msgs);
    paint();
    main.scrollTop = main.scrollHeight - h;
  });

  supabase.channel('room-' + r.id)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_messages', filter: `room_id=eq.${r.id}` }, payload => {
      const msg = payload.new;
      if(byId.has(msg.id)) return;
      byId.set(msg.id, msg);
      const stick = nearBottom() || msg.user_id === m.user.id;
      msgs.push(msg);
      paint();
      if(stick) scrollBottom(true);
      markRead();
    })
    .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'chat_messages' }, payload => {
      const id = payload.old?.id;
      if(!id || !byId.has(id)) return;
      byId.delete(id);
      msgs = msgs.filter(x => x.id !== id);
      paint();
    })
    .subscribe();
  document.addEventListener('visibilitychange', () => { if(!document.hidden) markRead(); });

  // ---------- Senden ----------
  const input = $('#msgInput');
  const grow = () => { input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, 140) + 'px'; };
  input.addEventListener('input', grow);
  const touch = matchMedia('(pointer: coarse)').matches;
  input.addEventListener('keydown', e => {
    if(e.key === 'Enter' && !e.shiftKey && !touch){ e.preventDefault(); $('#sendForm').requestSubmit(); }
  });

  function setReply(msg){
    replyTo = msg;
    $('#replyBar').hidden = !msg;
    if(msg) $('#replyText').innerHTML = `<b>${esc(person(msg.user_id).display)}</b>: ${esc(msg.body.slice(0, 80))}`;
  }
  $('#replyX').addEventListener('click', () => setReply(null));

  $('#sendForm').addEventListener('submit', async e => {
    e.preventDefault();
    const body = input.value.trim();
    if(!body) return;
    input.value = ''; grow();
    const reply = replyTo; setReply(null);
    const { data, error } = await supabase.from('chat_messages')
      .insert({ room_id: r.id, user_id: m.user.id, body, reply_to: reply?.id || null }).select('*').single();
    if(error){ toast(error.message, 'err'); input.value = body; return; }
    if(!byId.has(data.id)){ byId.set(data.id, data); msgs.push(data); paint(); }
    scrollBottom(true);
  });

  // ---------- Aktionen auf Nachrichten ----------
  log.addEventListener('click', e => {
    const bubbleEl = e.target.closest('.bubble');
    if(!bubbleEl || e.target.closest('a')) return;
    const msg = byId.get(bubbleEl.closest('.msg-row').dataset.id);
    if(!msg) return;
    const canDelete = msg.user_id === m.user.id || m.isAdmin;
    const s = openSheet(`<div class="stack">
      <button class="btn block ghost" data-reply>${icon('reply')} Antworten</button>
      <button class="btn block ghost" data-copy>Text kopieren</button>
      ${canDelete ? `<button class="btn block danger" data-del>${icon('trash')} Löschen</button>` : ''}
      <button class="btn block ghost" data-close>Abbrechen</button></div>`);
    s.el.querySelector('[data-reply]').onclick = () => { s.close(); setReply(msg); input.focus(); };
    s.el.querySelector('[data-copy]').onclick = async () => { s.close(); await navigator.clipboard?.writeText(msg.body); toast('Kopiert.'); };
    s.el.querySelector('[data-del]')?.addEventListener('click', async () => {
      s.close();
      if(!await confirmSheet('Nachricht löschen?', 'Sie verschwindet für alle.', 'Löschen', true)) return;
      const { error } = await supabase.from('chat_messages').delete().eq('id', msg.id);
      if(error){ toast(error.message, 'err'); return; }
      byId.delete(msg.id); msgs = msgs.filter(x => x.id !== msg.id); paint();
    });
  });
}
