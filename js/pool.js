// Boosterpool: Daten laden und rechnen (gleiche Logik wie Fridos Sheet).
//   Guthaben  = Einzahlungen - Drafts            (je Konto)
//   Konto     = Einzahlungen - Einkaeufe + Verkaeufe
//   Lager     = Booster - gedraftet - verkauft + Korrekturen (je Los)
import { supabase } from './supabase.js';

export const eur = c => ((c || 0) / 100).toLocaleString('de-AT', { style: 'currency', currency: 'EUR' });
export const parseCents = v => {
  const n = Number(String(v).replace(/\s|€/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.'));
  return Number.isFinite(n) ? Math.round(n * 100) : NaN;
};

export async function loadPool(){
  const [s, a, l, dep, dr, sa, adj, adm] = await Promise.all([
    supabase.from('pool_settings').select('*').maybeSingle(),
    supabase.from('pool_accounts').select('*').order('name'),
    supabase.from('pool_lots').select('*').order('purchased_on', { ascending: false }),
    supabase.from('pool_deposits').select('*').order('date', { ascending: false }),
    supabase.from('pool_drafts').select('*').order('date', { ascending: false }),
    supabase.from('pool_sales').select('*').order('date', { ascending: false }),
    supabase.from('pool_adjustments').select('*').order('date', { ascending: false }),
    supabase.rpc('is_pool_admin'),
  ]);
  const err = [s, a, l, dep, dr, sa, adj].find(x => x.error);
  if(err) throw err.error;
  return compute({ settings: s.data || {}, accounts: a.data || [], lots: l.data || [], deposits: dep.data || [],
    drafts: dr.data || [], sales: sa.data || [], adjustments: adj.data || [], isPoolAdmin: Boolean(adm.data) });
}

export function compute(P){
  const sum = (arr, f) => arr.reduce((s, x) => s + (f(x) || 0), 0);
  for(const a of P.accounts){
    a.in = sum(P.deposits.filter(d => d.account_id === a.id), d => d.amount_cents);
    a.out = sum(P.drafts.filter(d => d.account_id === a.id), d => d.amount_cents);
    a.balance = a.in - a.out;
    a.draftCount = new Set(P.drafts.filter(d => d.account_id === a.id).map(d => d.batch_id)).size;
  }
  for(const l of P.lots){
    l.perBooster = l.boosters ? l.cost_cents / l.boosters : null;
    l.perDraft = l.perBooster ? Math.round(l.perBooster * 3) : null;
    l.used = sum(P.drafts.filter(d => d.lot_id === l.id), d => d.boosters);
    l.sold = sum(P.sales.filter(d => d.lot_id === l.id), d => d.boosters);
    l.adjusted = sum(P.adjustments.filter(d => d.lot_id === l.id), d => d.boosters);
    l.stock = l.boosters == null ? null : l.boosters - l.used - l.sold + l.adjusted;
    l.value = l.stock && l.perBooster ? Math.round(l.stock * l.perBooster) : 0;
  }
  P.totals = {
    deposits: sum(P.deposits, d => d.amount_cents),
    purchases: sum(P.lots, l => l.cost_cents),
    sales: sum(P.sales, s => s.amount_cents),
    credit: sum(P.accounts, a => a.balance),
    stockValue: sum(P.lots, l => l.value),
  };
  P.totals.account = P.totals.deposits - P.totals.purchases + P.totals.sales;
  P.totals.delta = P.totals.account + P.totals.stockValue - P.totals.credit;
  P.inStock = P.lots.filter(l => l.stock > 0).sort((a, b) => b.stock - a.stock);
  return P;
}

// Buchungen eines Kontos chronologisch mit laufendem Saldo
export function ledger(P, accountId){
  const rows = [
    ...P.deposits.filter(d => d.account_id === accountId).map(d => ({ date: d.date, cents: d.amount_cents, label: d.amount_cents < 0 ? 'Auszahlung' : 'Einzahlung', note: d.note, status: d.status, at: d.created_at })),
    ...P.drafts.filter(d => d.account_id === accountId).map(d => ({ date: d.date, cents: -d.amount_cents, label: `Draft ${d.set_name || ''}`.trim(), note: `${d.boosters} Booster${d.holder ? ' · Lager ' + d.holder : ''}`, at: d.created_at })),
  ].sort((a, b) => a.date.localeCompare(b.date) || String(a.at).localeCompare(String(b.at)));
  let run = 0;
  for(const r of rows){ run += r.cents; r.balance = run; }
  return rows.reverse();
}
