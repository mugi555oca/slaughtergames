// Admin-Backend (Desktop). Alles hier ist zusaetzlich per RLS bzw. in der
// Edge Function "admin-users" auf App-Admins beschraenkt.
import { me, $, $$, esc, supabase, loadPeople, toast, busy, confirmSheet, resizeImage, timeAgo, loginUrl, initialsAvatar, openSheet } from '/js/app.js';
import { SUPABASE_URL } from '/tournament-app/js/config.js';
import { listPhotos, signUrls, deletePhoto, uploadPhotos } from '/js/gallery.js';
import { loadTournaments, NEXT_EVENT } from '/js/data.js';

const main = $('#adminMain');
const m = await me();
if(!m.user){ location.replace(loginUrl('/admin/')); }
else if(!m.isAdmin){
  main.innerHTML = '<h1>Kein Zugriff</h1><p class="lead">Dieser Bereich ist nur für Admins.</p><a class="btn" href="/">Zur App</a>';
} else {
  $('#whoami').textContent = m.user.email;
  window.addEventListener('hashchange', route);
  route();
}

async function fn(body){
  const { data: { session } } = await supabase.auth.getSession();
  const res = await fetch(`${SUPABASE_URL}/functions/v1/admin-users`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${session.access_token}` },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if(!res.ok) throw new Error(json.error || `Fehler ${res.status}`);
  return json;
}

function route(){
  const sec = (location.hash || '#uebersicht').slice(1);
  $$('#sideNav a').forEach(a => a.classList.toggle('on', a.dataset.sec === sec));
  main.innerHTML = '<div class="spinner"></div>';
  ({ uebersicht, mitglieder, abzeichen, turniere, locations, galerie, chat }[sec] || uebersicht)().catch(err => {
    main.innerHTML = `<h1>Fehler</h1><p class="lead">${esc(err.message)}</p>`;
  });
}

// ---------------------------------------------------------------
async function uebersicht(){
  const since = new Date(Date.now() - 7 * 86400000).toISOString();
  const [mem, tAll, tLive, photos, msgs] = await Promise.all([
    supabase.from('profiles').select('id', { count: 'exact', head: true }).not('slug', 'is', null),
    supabase.from('tournaments').select('id', { count: 'exact', head: true }),
    supabase.from('tournaments').select('id', { count: 'exact', head: true }).eq('status', 'active'),
    supabase.from('gallery_photos').select('id', { count: 'exact', head: true }),
    supabase.from('chat_messages').select('id', { count: 'exact', head: true }).gte('created_at', since),
  ]);
  main.innerHTML = `<h1>Übersicht</h1><p class="lead">Hallo ${esc(m.profile?.display_name || '')} – hier verwaltest du Profile, Abzeichen, Turniere, Fotos und den Chat.</p>
    <div class="kpis">
      <a class="kpi" href="#mitglieder"><b>${mem.count ?? '–'}</b><span>Mitglieder mit Account</span></a>
      <a class="kpi" href="#turniere"><b>${tLive.count ?? 0} / ${tAll.count ?? 0}</b><span>Weeklys live / gesamt</span></a>
      <a class="kpi" href="#galerie"><b>${photos.count ?? 0}</b><span>Fotos in den Galerien</span></a>
      <a class="kpi" href="#chat"><b>${msgs.count ?? 0}</b><span>Chat-Nachrichten (7 Tage)</span></a>
    </div>
    <h3 class="mt-l" style="margin-bottom:10px">Was du hier darfst – und die anderen nicht</h3>
    <table class="atable"><tbody>
      <tr><td>Profile aller Mitglieder bearbeiten, Accounts anlegen, Passwörter setzen</td><td class="muted">Mitglieder: nur das eigene Profil</td></tr>
      <tr><td>Abzeichen anlegen und vergeben</td><td class="muted">Mitglieder: nur ansehen</td></tr>
      <tr><td>Abgeschlossene Weeklys ändern, wieder öffnen, löschen</td><td class="muted">Mitglieder: nur laufende Weeklys</td></tr>
      <tr><td>Fotos löschen</td><td class="muted">Mitglieder: ansehen und hochladen</td></tr>
      <tr><td>Fremde Chat-Nachrichten löschen</td><td class="muted">Mitglieder: nur eigene</td></tr>
    </tbody></table>`;
}

// ---------------------------------------------------------------
// Mitglieder & Profile
// ---------------------------------------------------------------
async function mitglieder(){
  const [{ data: roster }, { data: profiles }, users] = await Promise.all([
    supabase.from('roster').select('*').order('name'),
    supabase.from('profiles').select('*'),
    fn({ action: 'list' }).catch(() => ({ users: [] })),
  ]);
  const people = await loadPeople();
  const userById = new Map((users.users || []).map(u => [u.id, u]));
  const profBySlug = new Map((profiles || []).filter(p => p.slug).map(p => [p.slug, p]));
  const rows = (roster || []).map(r => {
    const pr = profBySlug.get(r.slug);
    const u = pr ? userById.get(pr.id) : null;
    return { r, pr, u, avatar: people.bySlug.get(r.slug)?.avatar || initialsAvatar(r.real_name || r.name) };
  }).sort((a, b) => (a.r.real_name || a.r.name).localeCompare(b.r.real_name || b.r.name, 'de'));

  main.innerHTML = `<h1>Mitglieder &amp; Profile</h1>
    <p class="lead">Tippen zum Bearbeiten. Login = Rufname, Passwort für alle Mitglieder: <b>timewalk</b>.</p>
    <div class="split mobile-sheet">
      <div>
        <div class="toolbar"><input class="input" id="q" type="search" placeholder="Suchen…">
          <button class="btn sm" id="newBtn">+ Neues Mitglied</button></div>
        <table class="atable"><thead><tr><th></th><th>Rufname</th><th>SG-Name</th><th>Passwort</th><th>Zuletzt da</th></tr></thead>
        <tbody id="mBody"></tbody></table>
      </div>
      <div class="panel" id="panel"><p class="muted">Wähle links ein Mitglied – oder lege ein neues an.</p></div>
    </div>`;

  const paint = (q = '') => {
    const n = q.toLowerCase();
    $('#mBody').innerHTML = rows.filter(x => !n || `${x.r.name} ${x.r.real_name} ${x.u?.email}`.toLowerCase().includes(n)).map(x => `
      <tr class="click ${x.r.active ? '' : 'off'}" data-slug="${esc(x.r.slug)}">
        <td style="width:52px"><img class="avatar sm" src="${esc(x.avatar)}" alt=""></td>
        <td><b>${esc(x.r.real_name || '–')}</b></td>
        <td class="muted small full">${esc(x.r.name)}</td>
        <td>${!x.u ? '<span class="chip gold">kein Account</span>'
          : x.u.pw_state === 'own' ? '<span class="chip">eigenes PW</span>'
          : x.u.pw_state === 'admin' ? '<span class="chip">PW von dir</span>' : '<span class="chip ok">timewalk</span>'}</td>
        <td class="muted small end">${x.u?.last_sign_in_at ? esc(timeAgo(x.u.last_sign_in_at)) : ''}</td>
      </tr>`).join('');
  };
  paint();
  $('#q').addEventListener('input', e => paint(e.target.value));
  $('#mBody').addEventListener('click', e => {
    const tr = e.target.closest('tr[data-slug]');
    if(!tr) return;
    $$('#mBody tr').forEach(x => x.style.outline = '');
    tr.style.outline = '2px solid var(--blood)';
    edit(rows.find(x => x.r.slug === tr.dataset.slug));
  });
  $('#newBtn').addEventListener('click', () => create());

  // Desktop: Panel rechts. Handy: Bottom-Sheet.
  let sheet = null;
  function showPanel(html){
    if(matchMedia('(max-width:900px)').matches){ sheet?.close(); sheet = openSheet(html); }
    else $('#panel').innerHTML = html;
  }
  const closePanel = () => { sheet?.close(); sheet = null; };

  const loginOf = name => String(name || '').toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');

  function create(prefill = null){
    showPanel(`<h3>${prefill ? 'Account anlegen' : 'Neues Mitglied'}</h3>
      <form id="cForm">
        <div class="field"><label>SG-Name</label><input id="cSg" required value="${esc(prefill?.name || '')}" ${prefill ? 'readonly' : ''} placeholder="z. B. Klaus, the Waiting One"></div>
        <div class="field"><label>Rufname</label><input id="cReal" required value="${esc(prefill?.real_name || '')}" placeholder="z. B. Klaus">
          <span class="hint" id="cHint"></span></div>
        <button class="btn block" type="submit">Anlegen</button>
      </form>`);
    const hint = () => { $('#cHint').innerHTML = `Login: <b>${esc($('#cReal').value.trim() || '…')}</b> · Passwort: <b>timewalk</b>`; };
    hint(); $('#cReal').addEventListener('input', hint);
    $('#cForm').addEventListener('submit', async e => {
      e.preventDefault();
      if(loginOf($('#cReal').value).length < 2){ toast('Rufname fehlt.', 'err'); return; }
      busy(e.submitter, true, 'Lege an…');
      try{
        const res = await fn({ action: 'create', sgName: $('#cSg').value.trim(), realName: $('#cReal').value.trim(), slug: prefill?.slug });
        await navigator.clipboard?.writeText(`Slaughter Games App: https://slaughtergames.at
Name: ${res.login}
Passwort: timewalk`).catch(() => {});
        closePanel();
        toast(`${res.login} angelegt – Login ${res.login} / timewalk (kopiert).`, 'ok');
        route();
      }catch(err){ toast(err.message, 'err'); busy(e.submitter, false); }
    });
  }

  function edit(x){
    const { r, pr, u } = x;
    if(!pr){
      showPanel(`<h3>${esc(r.real_name || r.name)}</h3><p class="muted mb">${esc(r.name)} hat noch keinen Login.</p>
        <button class="btn block" id="mkAcc">Account anlegen</button>
        <label class="switch mt" style="padding:12px 0 0"><span>In Spielerauswahl aktiv</span><input type="checkbox" id="eActive" ${r.active ? 'checked' : ''}></label>`);
      $('#mkAcc').onclick = () => create(r);
      $('#eActive').onchange = async e => { await supabase.from('roster').update({ active: e.target.checked }).eq('slug', r.slug); toast('Gespeichert.', 'ok'); };
      return;
    }
    showPanel(`<div class="row" style="gap:14px;margin-bottom:14px">
        <label style="cursor:pointer;position:relative"><img class="avatar lg" id="eImg" src="${esc(x.avatar)}" alt="">
          <input type="file" id="eFile" accept="image/*" hidden><span class="tiny muted" style="display:block;text-align:center">ändern</span></label>
        <div class="grow"><h3 style="margin:0">${esc(r.real_name || r.name)}</h3>
          <div class="small muted">Login: ${esc((u?.email || '').replace('@slaughtergames.local', ''))}</div>
          <a class="small" style="color:var(--blood-2)" href="/player-profile.html?slug=${encodeURIComponent(r.slug)}" target="_blank">Profil ansehen ↗</a></div>
      </div>
      <form id="eForm">
        <div class="field"><label>SG-Name</label><input id="eSg" value="${esc(r.name)}" required>
          <span class="hint">Alte Turnierergebnisse behalten den bisherigen Namen.</span></div>
        <div class="field"><label>Rufname</label><input id="eReal" value="${esc(r.real_name || '')}"></div>
        <div class="field"><label>Anzeigename (Chat)</label><input id="eDisp" value="${esc(pr.display_name || '')}"></div>
        <div class="field"><label>Beschreibung</label><textarea id="eDesc" maxlength="500">${esc(pr.description || '')}</textarea></div>
        <div class="field"><label>Lieblingskarte</label><input id="eFav" value="${esc(pr.favourite_card || '')}"></div>
        <label class="switch" style="padding:4px 0 14px;border:0"><span>In Spielerauswahl aktiv</span><input type="checkbox" id="eActive" ${r.active ? 'checked' : ''}></label>
        <div class="btn-row"><button class="btn" type="submit">Speichern</button></div>
        <div class="card mt" style="padding:12px">
          <div class="label mb">Passwort · ${u?.pw_state === 'own' ? 'selbst geändert' : u?.pw_state === 'admin' ? 'von dir gesetzt' : 'Standard (timewalk)'}${u?.pw_changed_at ? ' · ' + esc(timeAgo(u.pw_changed_at)) : ''}</div>
          <div class="row" style="gap:8px"><input class="input grow" id="ePwNew" placeholder="Neues Passwort" autocomplete="off" style="min-height:42px;padding:9px 12px">
            <button class="btn sm" type="button" id="ePwSet">Setzen</button></div>
          <button class="btn link small mt" type="button" id="ePw">Auf timewalk zurücksetzen</button>
        </div>
        ${pr.avatar_url ? '<button class="btn link small mt" type="button" id="eAvReset">Profilbild auf Standard zurücksetzen</button>' : ''}
      </form>`);

    $('#eForm').addEventListener('submit', async e => {
      e.preventDefault();
      busy(e.submitter, true, 'Speichere…');
      const [a, b] = await Promise.all([
        supabase.from('roster').update({ name: $('#eSg').value.trim(), real_name: $('#eReal').value.trim() || null, active: $('#eActive').checked }).eq('slug', r.slug),
        supabase.from('profiles').update({ display_name: $('#eDisp').value.trim() || null, description: $('#eDesc').value.trim() || null, favourite_card: $('#eFav').value.trim() || null }).eq('id', pr.id),
      ]);
      busy(e.submitter, false);
      const err = a.error || b.error;
      if(err){ toast(err.message, 'err'); return; }
      toast('Gespeichert.', 'ok');
      closePanel();
      Object.assign(r, { name: $('#eSg').value.trim(), real_name: $('#eReal').value.trim(), active: $('#eActive').checked });
      paint($('#q').value);
    });
    $('#ePw').addEventListener('click', async () => {
      if(!await confirmSheet('Passwort zurücksetzen?', `${r.real_name || r.name} bekommt wieder das Passwort „timewalk“.`, 'Zurücksetzen')) return;
      try{ await fn({ action: 'password', userId: pr.id }); toast('Passwort ist wieder timewalk.', 'ok'); route(); }
      catch(err){ toast(err.message, 'err'); }
    });
    $('#ePwSet').addEventListener('click', async () => {
      const pw = $('#ePwNew').value.trim();
      if(pw.length < 6){ toast('Mindestens 6 Zeichen.', 'err'); return; }
      try{ await fn({ action: 'password', userId: pr.id, password: pw }); toast(`Passwort für ${r.real_name || r.name}: ${pw}`, 'ok'); $('#ePwNew').value = ''; }
      catch(err){ toast(err.message, 'err'); }
    });
    $('#eFile').addEventListener('change', async e => {
      const file = e.target.files?.[0]; if(!file) return;
      try{
        const { blob } = await resizeImage(file, 512, 0.88, true);
        const path = `${pr.id}/avatar_${Date.now()}.jpg`;
        const up = await supabase.storage.from('avatars').upload(path, blob, { contentType: 'image/jpeg' });
        if(up.error) throw up.error;
        const url = supabase.storage.from('avatars').getPublicUrl(path).data.publicUrl;
        const { error } = await supabase.from('profiles').update({ avatar_url: url }).eq('id', pr.id);
        if(error) throw error;
        $('#eImg').src = url; pr.avatar_url = url; x.avatar = url; paint($('#q').value);
        toast('Profilbild gesetzt.', 'ok');
      }catch(err){ toast(err.message, 'err'); }
    });
    $('#eAvReset')?.addEventListener('click', async () => {
      const { error } = await supabase.from('profiles').update({ avatar_url: null }).eq('id', pr.id);
      if(error){ toast(error.message, 'err'); return; }
      toast('Zurückgesetzt.', 'ok'); route();
    });
  }
}

// ---------------------------------------------------------------
// Abzeichen
// ---------------------------------------------------------------
const ICON_KEYS = [['', '– kein Icon –'], ['crown', 'Krone'], ['mic', 'Mikrofon'], ['quill', 'Federkiel'], ['chefhat', 'Kochmütze'],
  ['flame', 'Flamme'], ['cocktail', 'Cocktail'], ['quiz', 'Sprechblase ?'], ['table', 'Tabelle'], ['moon', 'Mond'],
  ['brokensword', 'Zerbrochenes Schwert'], ['hourglass', 'Sanduhr'], ['sock', 'Socke'], ['candle', 'Kerze'], ['lantern', 'Laterne'],
  ['sneeze', 'Stinkwolke'], ['punt', 'Fuß + Ball'], ['spikeball', 'Spikeball-Netz']];

async function abzeichen(){
  if(!document.getElementById('badgeSprite')){
    const s = document.createElement('div'); s.id = 'badgeSprite'; s.hidden = true;
    s.innerHTML = await (await fetch('/badges.svg?v=17')).text(); document.body.appendChild(s);
  }
  const [{ data: badges }, { data: awards }, { data: roster }] = await Promise.all([
    supabase.from('badges').select('*').order('sort_order'),
    supabase.from('player_badges').select('*'),
    supabase.from('roster').select('slug,name,real_name').order('real_name'),
  ]);
  const nameOf = slug => { const r = roster.find(x => x.slug === slug); return r ? (r.real_name || r.name) : slug; };
  const ic = k => k ? `<svg class="badge-icon"><use href="#badge-${esc(k)}"/></svg>` : '<span class="faint">–</span>';
  const evs = ['', ...Array.from({ length: NEXT_EVENT.sg }, (_, i) => `SG${i + 1}`)];
  const count = c => awards.filter(a => a.badge_code === c).length;

  main.innerHTML = `<div id="abz"><h1>Abzeichen</h1><p class="lead">Abzeichen anlegen und Spielern zuordnen – wahlweise pro Event.</p>
    <div class="split">
      <div>
        <h3 style="margin-bottom:10px">Vergeben</h3>
        <form class="toolbar" id="aForm">
          <select class="input" id="aPlayer">${roster.map(r => `<option value="${esc(r.slug)}">${esc(r.real_name || r.name)}</option>`).join('')}</select>
          <select class="input" id="aBadge">${badges.map(b => `<option value="${esc(b.code)}">${esc(b.name)}</option>`).join('')}</select>
          <select class="input" id="aEvent" style="max-width:130px">${evs.map(e => `<option value="${e}">${e || 'ohne Event'}</option>`).join('')}</select>
          <button class="btn sm" type="submit">Zuordnen</button>
        </form>
        <table class="atable"><thead><tr><th>Spieler</th><th>Abzeichen</th><th>Event</th><th></th></tr></thead><tbody>
        ${[...awards].sort((a, b) => nameOf(a.slug).localeCompare(nameOf(b.slug), 'de') || String(a.sg || '').localeCompare(String(b.sg || ''))).map(a => {
          const b = badges.find(x => x.code === a.badge_code);
          return `<tr><td><b>${esc(nameOf(a.slug))}</b></td><td>${ic(b?.icon_key)} ${esc(b?.name || a.badge_code)}</td><td class="muted">${esc(a.sg || '–')}</td>
            <td class="end" style="text-align:right"><button class="btn xs danger" data-del-award="${a.id}">Entfernen</button></td></tr>`;
        }).join('') || '<tr><td colspan="4" class="muted">Noch nichts vergeben.</td></tr>'}</tbody></table>
      </div>
      <div class="panel">
        <h3>Alle Abzeichen</h3>
        <table class="atable" style="font-size:13px"><tbody>${badges.map(b => `<tr title="${esc(b.description || '')}">
          <td style="width:30px">${ic(b.icon_key)}</td><td><b>${esc(b.name)}</b><div class="tiny muted">${esc(b.code)} · ${count(b.code)}× vergeben</div></td>
          <td style="text-align:right"><button class="btn xs danger" data-del-badge="${esc(b.code)}">×</button></td></tr>`).join('')}</tbody></table>
        <h3 class="mt-l">Neues Abzeichen</h3>
        <form id="bForm">
          <div class="row" style="gap:8px"><div class="field" style="width:90px"><label>Kürzel</label><input id="bCode" maxlength="4" required></div>
          <div class="field grow"><label>Name</label><input id="bName" maxlength="60" required></div></div>
          <div class="field"><label>Icon</label><select id="bIcon">${ICON_KEYS.map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select></div>
          <div class="field"><label>Beschreibung</label><input id="bDesc" maxlength="200"></div>
          <button class="btn block" type="submit">Anlegen</button>
        </form>
      </div>
    </div></div>`;

  $('#aForm').addEventListener('submit', async e => {
    e.preventDefault();
    const { error } = await supabase.from('player_badges').insert({ slug: $('#aPlayer').value, badge_code: $('#aBadge').value, sg: $('#aEvent').value || null });
    if(error) toast(error.message, 'err'); else { toast('Vergeben.', 'ok'); abzeichen(); }
  });
  $('#bForm').addEventListener('submit', async e => {
    e.preventDefault();
    const { error } = await supabase.from('badges').insert({ code: $('#bCode').value.trim(), name: $('#bName').value.trim(),
      description: $('#bDesc').value.trim() || null, icon_key: $('#bIcon').value || null, sort_order: 200 + badges.length });
    if(error) toast(error.message, 'err'); else { toast('Abzeichen angelegt.', 'ok'); abzeichen(); }
  });
  $('#abz').addEventListener('click', async e => {
    const aid = e.target.dataset?.delAward, code = e.target.dataset?.delBadge;
    if(aid){
      const { error } = await supabase.from('player_badges').delete().eq('id', aid);
      if(error) toast(error.message, 'err'); else abzeichen();
    }
    if(code){
      if(!await confirmSheet(`„${code}“ löschen?`, `Alle ${count(code)} Zuordnungen werden mitgelöscht.`, 'Löschen', true)) return;
      const { error } = await supabase.from('badges').delete().eq('code', code);
      if(error) toast(error.message, 'err'); else abzeichen();
    }
  });
}

// ---------------------------------------------------------------
// Turniere
// ---------------------------------------------------------------
async function turniere(){
  const [{ data: ts }, people] = await Promise.all([
    supabase.from('tournaments').select('*').order('created_at', { ascending: false }),
    loadPeople(),
  ]);
  main.innerHTML = `<h1>Weekly Turniere</h1>
    <p class="lead">Öffnen führt zur Turnierseite. Dort kannst du als Admin auch bei abgeschlossenen Turnieren Ergebnisse ändern (Standings und Ranking werden neu gerechnet), das Turnier wieder öffnen oder ab einer Runde neu auslosen.</p>
    <table class="atable"><thead><tr><th>Datum</th><th>Name</th><th>Status</th><th>Runde</th><th>Angelegt von</th><th></th></tr></thead><tbody>
    ${ts.map(t => `<tr>
      <td class="muted">${new Date(t.created_at).toLocaleDateString('de-AT')}</td>
      <td class="full"><b>${esc(t.name)}</b></td>
      <td>${t.status === 'active' ? '<span class="chip live">live</span>' : '<span class="chip">beendet</span>'}</td>
      <td>${t.current_round}/${t.rounds_total}</td>
      <td class="muted">${esc(people.byId.get(t.owner_id)?.real || '–')}</td>
      <td class="end" style="text-align:right;white-space:nowrap">
        <a class="btn xs ghost" href="/tournament-app/round.html?tournament=${t.id}">Öffnen / bearbeiten</a>
        <button class="btn xs danger" data-del="${t.id}" data-name="${esc(t.name)}">Löschen</button></td>
    </tr>`).join('')}</tbody></table>`;
  main.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', async () => {
    if(!await confirmSheet('Turnier löschen?', `„${b.dataset.name}“ samt allen Runden und Ergebnissen endgültig löschen?`, 'Löschen', true)) return;
    const { error } = await supabase.from('tournaments').delete().eq('id', b.dataset.del);
    if(error) toast(error.message, 'err'); else { toast('Gelöscht.', 'ok'); turniere(); }
  }));
}

// ---------------------------------------------------------------
// Galerie
// ---------------------------------------------------------------
async function galerie(){
  const tournaments = await loadTournaments();
  const albums = [...tournaments.map(t => `sg${t.sg}`), `sg${NEXT_EVENT.sg}`].reverse();
  const album = sessionStorage.getItem('adm-album') || albums[1] || albums[0];
  const rows = await listPhotos(album);
  const urls = await signUrls(rows.map(r => r.thumb_path || r.path));
  const people = await loadPeople();
  main.innerHTML = `<h1>Galerie</h1><p class="lead">Fotos auswählen und löschen, oder selbst hochladen. Mitglieder können nur hochladen.</p>
    <div class="toolbar">
      <select class="input" id="album" style="max-width:200px">${albums.map(a => `<option value="${a}" ${a === album ? 'selected' : ''}>${a.toUpperCase()}</option>`).join('')}</select>
      <span class="muted small">${rows.length} Fotos</span>
      <span class="grow"></span>
      <button class="btn sm ghost" id="selAll">Alle wählen</button>
      <button class="btn sm danger" id="delSel" disabled>Ausgewählte löschen</button>
      <label class="btn sm">Hochladen<input type="file" id="up" accept="image/*" multiple hidden></label>
    </div>
    <div class="photo-admin" id="grid">${rows.map(r => `<label title="${esc(people.byId.get(r.uploaded_by)?.real || 'Altbestand')} · ${new Date(r.created_at).toLocaleDateString('de-AT')}">
      <img src="${esc(urls[r.thumb_path || r.path] || '')}" alt="" loading="lazy"><input type="checkbox" value="${r.id}"></label>`).join('') || '<p class="muted">Leer.</p>'}</div>`;
  const sel = () => $$('#grid input:checked').map(i => rows.find(r => r.id === i.value));
  $('#grid').addEventListener('change', () => { const n = sel().length; $('#delSel').disabled = !n; $('#delSel').textContent = n ? `${n} löschen` : 'Ausgewählte löschen'; });
  $('#selAll').onclick = () => { $$('#grid input').forEach(i => i.checked = true); $('#grid').dispatchEvent(new Event('change')); };
  $('#album').onchange = e => { sessionStorage.setItem('adm-album', e.target.value); galerie(); };
  $('#delSel').onclick = async () => {
    const list = sel();
    if(!await confirmSheet(`${list.length} Fotos löschen?`, 'Sie verschwinden für alle endgültig.', 'Löschen', true)) return;
    busy($('#delSel'), true, 'Lösche…');
    for(const r of list){ try{ await deletePhoto(r); }catch(err){ toast(err.message, 'err'); } }
    toast('Gelöscht.', 'ok'); galerie();
  };
  $('#up').onchange = async e => {
    const files = [...e.target.files]; if(!files.length) return;
    toast(`Lade ${files.length} Fotos hoch…`);
    try{ await uploadPhotos(files, album); toast('Hochgeladen.', 'ok'); }catch(err){ toast(err.message, 'err'); }
    galerie();
  };
}

// ---------------------------------------------------------------
// Chat
// ---------------------------------------------------------------
async function chat(){
  const [{ data: rooms }, people] = await Promise.all([supabase.from('chat_rooms').select('*').order('sort_order'), loadPeople()]);
  const room = sessionStorage.getItem('adm-room') || rooms[0]?.id;
  const { data: msgs } = await supabase.from('chat_messages').select('*').eq('room_id', room).order('created_at', { ascending: false }).limit(150);
  main.innerHTML = `<h1>Chat</h1><p class="lead">Nachrichten moderieren. Mitglieder können nur ihre eigenen löschen.</p>
    <div class="toolbar"><select class="input" id="room">${rooms.map(r => `<option value="${r.id}" ${r.id === room ? 'selected' : ''}>${esc(r.name)}</option>`).join('')}</select>
    <a class="btn sm ghost" href="/chat.html?room=${esc(rooms.find(r => r.id === room)?.slug || '')}">Im Chat öffnen</a></div>
    <table class="atable"><thead><tr><th>Wann</th><th>Wer</th><th>Nachricht</th><th></th></tr></thead><tbody>
    ${(msgs || []).map(x => `<tr><td class="muted small" style="white-space:nowrap">${new Date(x.created_at).toLocaleString('de-AT', { dateStyle: 'short', timeStyle: 'short' })}</td>
      <td><b>${esc(people.byId.get(x.user_id)?.display || '?')}</b></td><td class="full" style="white-space:pre-wrap">${esc(x.body || '📷 Foto')}</td>
      <td class="end" style="text-align:right"><button class="btn xs danger" data-del="${x.id}">Löschen</button></td></tr>`).join('') || '<tr><td colspan="4" class="muted">Noch keine Nachrichten.</td></tr>'}
    </tbody></table>`;
  $('#room').onchange = e => { sessionStorage.setItem('adm-room', e.target.value); chat(); };
  main.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', async () => {
    const { error } = await supabase.from('chat_messages').delete().eq('id', b.dataset.del);
    if(error) toast(error.message, 'err'); else b.closest('tr').remove();
  }));
}

// ---------------------------------------------------------------
// Spiellocations
// ---------------------------------------------------------------
async function locations(){
  const [{ data: locs }, { data: roster }] = await Promise.all([
    supabase.from('play_locations').select('*').order('sort_order'),
    supabase.from('roster').select('slug,real_name,name').order('real_name'),
  ]);
  const form = (l = {}) => `<form id="lForm" data-id="${l.id || ''}">
      <div class="field"><label>Name</label><input id="lName" required value="${esc(l.name || '')}" placeholder="z. B. Niki"></div>
      <div class="field"><label>Adresse</label><input id="lAddr" required value="${esc(l.address || '')}" placeholder="Straße Nr, PLZ Wien"></div>
      <div class="field"><label>Anläuten / Tür</label><input id="lBell" value="${esc(l.bell || '')}" placeholder="z. B. Top 36"></div>
      <div class="field"><label>Gastgeber (Profil)</label><select id="lOwner"><option value="">– keiner –</option>${roster.map(r => `<option value="${esc(r.slug)}" ${l.owner_slug === r.slug ? 'selected' : ''}>${esc(r.real_name || r.name)}</option>`).join('')}</select></div>
      <div class="field"><label>Google-Maps-Link (leer = aus Adresse)</label><input id="lMaps" value="${esc(l.maps_url || '')}"></div>
      <label class="switch" style="padding:4px 0 14px;border:0"><span>Aktiv</span><input type="checkbox" id="lActive" ${l.active === false ? '' : 'checked'}></label>
      <button class="btn block" type="submit">${l.id ? 'Speichern' : 'Anlegen'}</button>
    </form>`;
  main.innerHTML = `<h1>Spiellocations</h1><p class="lead">Nur für eingeloggte Mitglieder sichtbar. Gastgeber sehen ihre Location im Profil und können sie selbst anpassen.</p>
    <div class="split mobile-sheet"><div>
      <div class="toolbar"><button class="btn sm" id="lNew">+ Neue Location</button></div>
      <table class="atable"><thead><tr><th>Name</th><th>Adresse</th><th>Anläuten</th><th></th></tr></thead><tbody>
      ${locs.map(l => `<tr class="click ${l.active ? '' : 'off'}" data-id="${l.id}"><td><b>${esc(l.name)}</b></td><td class="muted full">${esc(l.address)}</td><td>${esc(l.bell || '')}</td>
        <td class="end"><a class="btn xs ghost" href="${esc(l.maps_url)}" target="_blank" rel="noopener">Maps</a></td></tr>`).join('')}</tbody></table>
    </div><div class="panel" id="panel"><p class="muted">Location wählen oder neu anlegen.</p></div></div>`;
  let sheet = null;
  const show = html => {
    if(matchMedia('(max-width:900px)').matches){ sheet?.close(); sheet = openSheet(html); } else $('#panel').innerHTML = html;
    $('#lForm').addEventListener('submit', async e => {
      e.preventDefault();
      const id = e.target.dataset.id;
      const addr = $('#lAddr').value.trim();
      const row = { name: $('#lName').value.trim(), address: addr, bell: $('#lBell').value.trim() || null,
        owner_slug: $('#lOwner').value || null, active: $('#lActive').checked,
        maps_url: $('#lMaps').value.trim() || `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(addr)}` };
      const { error } = id ? await supabase.from('play_locations').update(row).eq('id', id) : await supabase.from('play_locations').insert(row);
      if(error){ toast(error.message, 'err'); return; }
      sheet?.close(); toast('Gespeichert.', 'ok'); locations();
    });
  };
  $('#lNew').onclick = () => show('<h3>Neue Location</h3>' + form());
  main.querySelectorAll('tr[data-id]').forEach(tr => tr.addEventListener('click', e => {
    if(e.target.closest('a')) return;
    const l = locs.find(x => x.id === tr.dataset.id);
    show(`<h3>${esc(l.name)}</h3>` + form(l));
  }));
}

