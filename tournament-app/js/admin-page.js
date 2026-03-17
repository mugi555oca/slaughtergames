import { requireAuthOrRedirect } from './auth.js';
import { listTournaments, getTournamentBundle } from './tournament.js';
import { supabase } from './supabase-client.js';

function $(id){ return document.getElementById(id); }

function fmtDate(iso){
  try{ return new Date(iso).toLocaleString('de-AT'); }
  catch{ return iso || '-'; }
}

async function renderOverview(){
  const tournaments = await listTournaments();
  const host = $('adminTable');
  host.innerHTML = '';

  for(const t of tournaments){
    const bundle = await getTournamentBundle(t.id);
    const total = bundle.players.length;
    const active = bundle.players.filter(p => !p.dropped).length;

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${t.name}</td>
      <td>${t.status}</td>
      <td>${t.current_round}/${t.rounds_total}</td>
      <td>${active}/${total}</td>
      <td>${fmtDate(t.created_at)}</td>
      <td>
        <button data-archive="${t.id}" class="warn">Archivieren</button>
        <button data-delete="${t.id}" class="danger">Löschen</button>
        <a href="./round.html?tournament=${t.id}"><button>Öffnen</button></a>
      </td>
    `;
    host.appendChild(tr);
  }

  host.querySelectorAll('button[data-archive]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.getAttribute('data-archive');
      const ok = confirm('Turnier wirklich als finished markieren?');
      if(!ok) return;
      const { error } = await supabase.from('tournaments').update({ status: 'finished' }).eq('id', id);
      $('adminMsg').textContent = error ? error.message : 'Turnier archiviert.';
      await renderOverview();
    });
  });

  host.querySelectorAll('button[data-delete]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.getAttribute('data-delete');
      const ok = confirm('Turnier wirklich endgültig löschen? Dieser Vorgang ist irreversibel.');
      if(!ok) return;

      const { error } = await supabase.from('tournaments').delete().eq('id', id);
      $('adminMsg').textContent = error ? error.message : 'Turnier gelöscht.';
      await renderOverview();
    });
  });
}

async function init(){
  const user = await requireAuthOrRedirect();
  if(!user) return;

  await renderOverview();
}

init();
