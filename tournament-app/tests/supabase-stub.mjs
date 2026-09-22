// Minimal in-memory stand-in for the Supabase JS client, just enough for the
// query shapes tournament.js actually uses.
export const db = {
  tournaments: [],
  players: [],
  rounds: [],
  matches: [],
  player_round_stats: [],
  player_opponents: [],
};

export function resetDb(seed) {
  for (const k of Object.keys(db)) db[k] = [];
  for (const [k, rows] of Object.entries(seed || {})) db[k] = rows.map(r => ({ ...r }));
}

let idSeq = 0;
const newId = () => `id-${++idSeq}`;

class Query {
  constructor(table) {
    this.table = table;
    this.filters = [];
    this.op = 'select';
    this.payload = null;
    this.wantSingle = false;
    this.onConflict = null;
  }
  select(_cols) { if (this.op === 'select') this.op = 'select'; this.returning = true; return this; }
  insert(rows) { this.op = 'insert'; this.payload = Array.isArray(rows) ? rows : [rows]; return this; }
  update(patch) { this.op = 'update'; this.payload = patch; return this; }
  upsert(rows, opts) { this.op = 'upsert'; this.payload = rows; this.onConflict = opts?.onConflict || null; return this; }
  delete() { this.op = 'delete'; return this; }
  eq(col, val) { this.filters.push(r => r[col] === val); return this; }
  neq(col, val) { this.filters.push(r => r[col] !== val); return this; }
  gt(col, val) { this.filters.push(r => Number(r[col]) > Number(val)); return this; }
  order(col, opts) { this.sort = { col, asc: opts?.ascending !== false }; return this; }
  single() { this.wantSingle = true; return this; }

  match(rows) { return rows.filter(r => this.filters.every(f => f(r))); }

  run() {
    const table = db[this.table];
    if (!table) return { data: null, error: { message: `unknown table ${this.table}` } };

    if (this.op === 'insert') {
      const rows = this.payload.map(r => ({ id: r.id || newId(), ...r }));
      table.push(...rows);
      return { data: rows, error: null };
    }

    if (this.op === 'upsert') {
      const keys = (this.onConflict || '').split(',').map(s => s.trim()).filter(Boolean);
      const out = [];
      for (const r of this.payload) {
        const hit = keys.length ? table.find(x => keys.every(k => x[k] === r[k])) : null;
        if (hit) { Object.assign(hit, r); out.push(hit); }
        else { const row = { id: newId(), ...r }; table.push(row); out.push(row); }
      }
      return { data: out, error: null };
    }

    if (this.op === 'update') {
      const hits = this.match(table);
      hits.forEach(r => Object.assign(r, this.payload));
      return { data: hits, error: null };
    }

    if (this.op === 'delete') {
      const keep = table.filter(r => !this.filters.every(f => f(r)));
      const removed = table.length - keep.length;
      db[this.table] = keep;
      return { data: { removed }, error: null };
    }

    let rows = this.match(table);
    if (this.sort) {
      const { col, asc } = this.sort;
      rows = [...rows].sort((a, b) => (a[col] > b[col] ? 1 : a[col] < b[col] ? -1 : 0) * (asc ? 1 : -1));
    }
    if (this.wantSingle) {
      if (rows.length !== 1) return { data: null, error: { message: `single() matched ${rows.length} rows in ${this.table}` } };
      return { data: rows[0], error: null };
    }
    return { data: rows, error: null };
  }

  then(resolve, reject) { return Promise.resolve(this.run()).then(resolve, reject); }
}

export const supabase = { from: (table) => new Query(table) };
