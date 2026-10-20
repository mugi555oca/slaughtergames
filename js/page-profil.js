import { initShell, $, esc, icon, supabase, loadPeople, toast, busy, resizeImage, openSheet,
         canInstall, promptInstall, isStandalone, loginUrl } from './app.js';
import { pushSupported, pushStatus, enablePush, disablePush, needsInstallForPush } from './push.js';

const m = await initShell({ tab: 'profil', title: 'Profil' });
const main = $('#profilMain');

if(!m.user){
  main.innerHTML = `
    <div class="center" style="padding-top:4vh">
      <img src="/assets/logo-640.webp" alt="" style="width:120px;margin:0 auto">
      <h1 class="page-title" style="margin-top:10px">Mitgliederbereich</h1>
      <p class="muted">Chat, Fotogalerien, Turniere eintragen und dein eigenes Profil.</p>
      <a class="btn block mt-l" href="${esc(loginUrl('/profil.html'))}">Einloggen</a>
    </div>
    <div class="list mt-l">
      <a class="list-item" href="/spieler.html">${icon('users')}<div class="grow title">Alle Spieler</div>${icon('chev', 'chev')}</a>
      <a class="list-item" href="/merch.html">${icon('shirt')}<div class="grow title">Merch</div>${icon('chev', 'chev')}</a>
      <a class="list-item" href="/blog.html">${icon('book')}<div class="grow title">Blog</div>${icon('chev', 'chev')}</a>
    </div>`;
  main.querySelectorAll('.list-item > svg:first-child').forEach(s => { s.style.width = '22px'; s.style.color = 'var(--blood-2)'; });
} else {
  await render();
}

async function render(){
  const people = await loadPeople();
  const mine = people.byId.get(m.user.id);
  let profile = m.profile || { id: m.user.id };
  const fallback = mine?.static?.profileImage ? '/' + mine.static.profileImage.replace(/\.png$/, '.webp') : mine?.avatar;

  main.innerHTML = `
    <div class="profile-head">
      <button type="button" id="avatarBtn" style="position:relative;border:0;background:none;padding:0;cursor:pointer" aria-label="Profilbild ändern">
        <img class="avatar xl" id="avatarImg" src="${esc(profile.avatar_url || fallback)}" alt="">
        <span style="position:absolute;right:2px;bottom:2px;width:36px;height:36px;border-radius:50%;background:var(--blood);display:grid;place-items:center;border:3px solid var(--bg)">${icon('camera')}</span>
      </button>
      <h1>${esc(mine?.name || profile.display_name || 'Mitglied')}</h1>
      <div class="muted small">${esc(m.user.email)}</div>
      ${profile.slug ? `<a class="btn sm ghost" href="/player-profile.html?slug=${encodeURIComponent(profile.slug)}">${icon('eye')} Öffentliches Profil</a>` : ''}
    </div>

    ${isStandalone() ? '' : `<div class="install mt-l" id="installBox">
      <img src="/icons/icon-192.png" alt="">
      <div class="grow"><div style="font-weight:700">App installieren</div>
      <div class="small muted" id="installHint"></div></div>
      <button class="btn sm" id="installBtn" hidden>Installieren</button></div>`}

    <section class="section">
      <div class="section-head"><h2>Über dich</h2></div>
      <form class="card" id="profileForm">
        <div class="field"><label for="displayName">Anzeigename</label>
          <input id="displayName" maxlength="60" required value="${esc(profile.display_name || '')}"></div>
        <div class="field"><label for="description">Beschreibung</label>
          <textarea id="description" maxlength="500" placeholder="Ein Satz über dich.">${esc(profile.description || '')}</textarea></div>
        <div class="field"><label for="favouriteCard">Lieblingskarte</label>
          <input id="favouriteCard" maxlength="120" placeholder="z. B. Lightning Bolt" value="${esc(profile.favourite_card || '')}">
          <span class="hint">Wird auf deinem Profil mit Kartenbild angezeigt.</span></div>
        <button class="btn block" type="submit">Speichern</button>
      </form>
    </section>

    <section class="section" id="myLocSec" hidden>
      <div class="section-head"><h2>Deine Spiellocation</h2></div>
      <form class="card" id="locForm">
        <div class="field"><label for="locAddr">Adresse</label><input id="locAddr" required></div>
        <div class="field"><label for="locBell">Anläuten / Tür</label><input id="locBell" placeholder="z. B. Top 36"></div>
        <button class="btn block" type="submit">Location speichern</button>
        <p class="hint mt">Nur für eingeloggte Mitglieder sichtbar.</p>
      </form>
    </section>

    <section class="section" id="push">
      <div class="section-head"><h2>Benachrichtigungen</h2></div>
      <div class="card" id="pushDevice"></div>
      <div class="list mt" id="prefs"></div>
    </section>

    <section class="section">
      <div class="section-head"><h2>Konto</h2></div>
      <div class="list">
        ${m.isAdmin ? `<a class="list-item" href="/admin/">${icon('shield')}<div class="grow"><div class="title">Admin-Backend</div><div class="sub">Profile, Abzeichen, Turniere, Fotos – am besten am Desktop</div></div>${icon('chev', 'chev')}</a>` : ''}
        <button class="list-item" id="pwBtn">${icon('lock')}<div class="grow"><div class="title">Passwort ändern</div><div class="sub">Standard ist „timewalk“</div></div>${icon('chev', 'chev')}</button>
        <a class="list-item" href="/spieler.html">${icon('users')}<div class="grow title">Alle Spieler</div>${icon('chev', 'chev')}</a>
        <a class="list-item" href="/merch.html">${icon('shirt')}<div class="grow title">Merch</div>${icon('chev', 'chev')}</a>
        <button class="list-item" id="logoutBtn" style="color:var(--danger)">${icon('logout')}<div class="grow title">Abmelden</div></button>
      </div>
    </section>`;
  main.querySelectorAll('.list-item > svg:first-child').forEach(s => { s.style.width = '22px'; s.style.flex = '0 0 auto'; });

  // ---------- Install ----------
  const paintInstall = () => {
    if(!$('#installBox')) return;
    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
    $('#installBtn').hidden = !canInstall();
    $('#installHint').textContent = ios ? 'Safari: Teilen-Symbol → „Zum Home-Bildschirm“'
      : canInstall() ? 'Immer aktuell, mit Push-Nachrichten.' : 'Im Browser-Menü „App installieren“ wählen.';
  };
  paintInstall();
  document.addEventListener('sg:installable', paintInstall);
  $('#installBtn')?.addEventListener('click', async () => { await promptInstall(); paintInstall(); });

  // ---------- Profil speichern ----------
  async function save(patch){
    const { data, error } = await supabase.from('profiles').upsert({ id: m.user.id, ...patch }, { onConflict: 'id' }).select('*').single();
    if(error) throw error;
    profile = data;
  }
  $('#profileForm').addEventListener('submit', async e => {
    e.preventDefault();
    busy(e.submitter, true, 'Speichere…');
    try{
      await save({
        display_name: $('#displayName').value.trim(),
        description: $('#description').value.trim() || null,
        favourite_card: $('#favouriteCard').value.trim() || null,
      });
      toast('Profil gespeichert.', 'ok');
    }catch(err){ toast(err.message, 'err'); }
    finally{ busy(e.submitter, false); }
  });

  // ---------- Profilbild ----------
  $('#avatarBtn').addEventListener('click', () => {
    const s = openSheet(`<h3>Profilbild</h3><div class="stack">
      <button class="btn block" data-pick>${icon('image')} Neues Bild wählen</button>
      ${profile.avatar_url ? `<button class="btn block ghost" data-reset>Standardbild verwenden</button>` : ''}
      <button class="btn block ghost" data-close>Abbrechen</button></div>`);
    s.el.querySelector('[data-pick]').onclick = () => { s.close(); $('#avatarFile').click(); };
    s.el.querySelector('[data-reset]')?.addEventListener('click', async () => {
      s.close();
      const old = profile.avatar_url;
      try{ await save({ avatar_url: null }); await removeAvatar(old); $('#avatarImg').src = fallback; toast('Standardbild gesetzt.', 'ok'); }
      catch(err){ toast(err.message, 'err'); }
    });
  });
  $('#avatarFile').addEventListener('change', async e => {
    const file = e.target.files?.[0]; e.target.value = '';
    if(!file) return;
    try{
      toast('Lade hoch…');
      const { blob } = await resizeImage(file, 512, 0.88, true);
      const path = `${m.user.id}/avatar_${Date.now()}.jpg`;
      const { error } = await supabase.storage.from('avatars').upload(path, blob, { contentType: 'image/jpeg', upsert: true });
      if(error) throw error;
      const url = supabase.storage.from('avatars').getPublicUrl(path).data.publicUrl;
      const old = profile.avatar_url;
      await save({ avatar_url: url });
      await removeAvatar(old);
      $('#avatarImg').src = url;
      const tabImg = document.querySelector('.tab-avatar'); if(tabImg) tabImg.src = url;
      toast('Profilbild aktualisiert.', 'ok');
    }catch(err){ toast(err.message, 'err'); }
  });
  async function removeAvatar(url){
    const i = url ? url.indexOf('/avatars/') : -1;
    if(i >= 0) await supabase.storage.from('avatars').remove([url.slice(i + 9)]);
  }

  // ---------- Push ----------
  async function paintDevice(){
    const host = $('#pushDevice');
    if(!pushSupported() || needsInstallForPush()){
      host.innerHTML = `<div class="row">${icon('phone')}<div class="grow small muted">${needsInstallForPush()
        ? 'Auf dem iPhone gibt es Push nur in der installierten App: Safari → Teilen → „Zum Home-Bildschirm“, dann hier aktivieren.'
        : 'Dieser Browser kann keine Push-Nachrichten empfangen.'}</div></div>`;
      host.querySelector('svg').style.cssText = 'width:26px;flex:0 0 auto;color:var(--gold)';
      return;
    }
    const st = await pushStatus();
    host.innerHTML = `<label class="switch" style="padding:0;border:0">
      <span><b>Push auf diesem Gerät</b><br><span class="small muted">${st === 'denied' ? 'Im Browser blockiert – in den Website-Einstellungen erlauben.' : 'Paarungen, Ergebnisse und Chat aufs Handy.'}</span></span>
      <input type="checkbox" id="pushToggle" ${st === 'on' ? 'checked' : ''} ${st === 'denied' ? 'disabled' : ''}></label>
      ${st === 'on' ? '<button class="btn sm ghost mt" id="testPush">🪓 Test-Push schicken</button>' : ''}`;
    $('#testPush')?.addEventListener('click', async e => {
      busy(e.currentTarget, true, 'Schicke…');
      const { error } = await supabase.rpc('send_test_push');
      busy(e.currentTarget, false);
      toast(error ? error.message : 'Unterwegs – sollte in ein paar Sekunden aufpoppen.', error ? 'err' : 'ok');
    });
    $('#pushToggle').addEventListener('change', async e => {
      e.target.disabled = true;
      try{
        if(e.target.checked){ await enablePush(m.user.id); toast('Push ist an.', 'ok'); }
        else { await disablePush(); toast('Push ist aus.'); }
      }catch(err){ toast(err.message, 'err'); }
      await paintDevice();
    });
  }
  await paintDevice();

  const { data: prefRow } = await supabase.from('notification_prefs').select('*').eq('user_id', m.user.id).maybeSingle();
  const PREFS = [
    ['Weekly-Termine', [
      ['meetups', '📅 Neuer Termin', 'Wenn wer ein Weekly vorschlägt'],
      ['meetup_updates', '🪑 Der Tisch füllt sich', 'Wer zu- oder absagt und wie viele noch fehlen (bei Terminen, wo du dabei/maybe bist)'],
      ['reminders', '⏰ Erinnerung am Spieltag', 'Mittags: heute Weekly, wo und wie viele'],
    ]],
    ['Weekly-Turniere', [
      ['rounds', '🃏 Paarungen', 'Turnierstart, deine Gegner und Tische, Byes'],
      ['results', '💀 Deine Ergebnisse', 'Sieg, Niederlage, Remis, dein Endplatz'],
      ['results_all', '📣 Alle Ergebnisse im Weekly', 'Wer wen verschiert – nur Push, wird pro Weekly zusammengefasst'],
    ]],
    ['Sonstiges', [
      ['chat', '💬 Chat-Nachrichten', 'Einzelne Gruppen unten stummschalten'],
      ['expenses', '💸 Ausgaben', 'Neue Ausgaben mit deinem Anteil, erhaltene Überweisungen'],
      ['pool', '🎴 Boosterpool', 'Einzahlung angekommen, Draft abgebucht, Guthaben fast leer'],
      ['gallery', '📸 Neue Fotos', 'Wenn wer Fotos in eine Galerie lädt'],
      ['blog', '📰 Neue Blogartikel', ''],
      ['badges', '🏅 Abzeichen', 'Wenn du ein Abzeichen bekommst'],
    ]],
  ];
  const keys = PREFS.flatMap(g => g[1].map(x => x[0]));
  const prefs = Object.assign(Object.fromEntries(keys.map(k => [k, true])), { muted_rooms: [] }, prefRow || {});
  const { data: rooms } = await supabase.from('chat_rooms').select('slug,name').order('sort_order');
  $('#prefs').innerHTML = PREFS.map(([group, items]) => `<div class="switch" style="cursor:default;background:var(--bg-2)"><span class="tiny" style="font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--muted)">${group}</span></div>`
    + items.map(([k, t, d]) => `<label class="switch"><span><span class="title">${t}</span>${d ? `<br><span class="small muted">${d}</span>` : ''}</span>
      <input type="checkbox" data-pref="${k}" ${prefs[k] ? 'checked' : ''}></label>`).join('')
    + (group === 'Sonstiges' ? (rooms || []).map(r => `<label class="switch" style="padding-left:28px"><span class="small">${esc(r.name)}</span>
      <input type="checkbox" data-room="${esc(r.slug)}" ${prefs.muted_rooms?.includes(r.slug) ? '' : 'checked'}></label>`).join('') : '')).join('');
  $('#prefs').addEventListener('change', async e => {
    const el = e.target;
    if(el.dataset.pref) prefs[el.dataset.pref] = el.checked;
    if(el.dataset.room){
      const set = new Set(prefs.muted_rooms || []);
      el.checked ? set.delete(el.dataset.room) : set.add(el.dataset.room);
      prefs.muted_rooms = [...set];
    }
    const row = { user_id: m.user.id, muted_rooms: prefs.muted_rooms || [], updated_at: new Date().toISOString() };
    for(const k of keys) row[k] = prefs[k];
    const { error } = await supabase.from('notification_prefs').upsert(row);
    if(error) toast(error.message, 'err');
  });
  // ---------- Eigene Spiellocation ----------
  if(profile.slug){
    const { data: myLoc } = await supabase.from('play_locations').select('*').eq('owner_slug', profile.slug).maybeSingle();
    if(myLoc){
      $('#myLocSec').hidden = false;
      $('#locAddr').value = myLoc.address;
      $('#locBell').value = myLoc.bell || '';
      $('#locForm').addEventListener('submit', async e => {
        e.preventDefault();
        const address = $('#locAddr').value.trim();
        const { error } = await supabase.from('play_locations').update({ address, bell: $('#locBell').value.trim() || null,
          maps_url: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}` }).eq('id', myLoc.id);
        toast(error ? error.message : 'Location gespeichert.', error ? 'err' : 'ok');
      });
    }
  }
  if(location.hash === '#push') $('#push').scrollIntoView();

  // ---------- Konto ----------
  $('#pwBtn')?.addEventListener('click', () => {
    const s = openSheet(`<h3>Passwort ändern</h3><form id="pwForm">
      <div class="field"><label for="pw1">Neues Passwort</label><input id="pw1" type="password" minlength="6" autocomplete="new-password" required></div>
      <div class="field"><label for="pw2">Wiederholen</label><input id="pw2" type="password" minlength="6" autocomplete="new-password" required></div>
      <div class="btn-row"><button type="button" class="btn ghost" data-close>Abbrechen</button><button class="btn" type="submit">Ändern</button></div></form>`);
    s.el.querySelector('#pwForm').addEventListener('submit', async e => {
      e.preventDefault();
      if(s.el.querySelector('#pw1').value !== s.el.querySelector('#pw2').value){ toast('Passwörter stimmen nicht überein.', 'err'); return; }
      const { error } = await supabase.auth.updateUser({ password: s.el.querySelector('#pw1').value });
      if(!error) await supabase.from('account_flags').upsert({ user_id: m.user.id, pw_state: 'own', pw_changed_at: new Date().toISOString() });
      if(error){ toast(error.message, 'err'); return; }
      s.close(); toast('Passwort geändert.', 'ok');
    });
  });
  $('#logoutBtn').addEventListener('click', async () => {
    await disablePush(false).catch(() => {});
    await supabase.auth.signOut();
    location.href = '/';
  });
}
