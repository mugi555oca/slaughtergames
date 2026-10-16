// Gemeinsames fuer die Turnier-Seiten der App.
export const FORMATS = [
  ['aktuelle-edi', 'Aktuelle Edi'], ['vintage-cube', 'Vintage Cube'], ['legacy-cube', 'Legacy Cube'],
  ['pauper-cube', 'Pauper Cube'], ['uncommon-cube', 'Uncommon Cube'], ['oldboarder-cube', 'Oldboarder Cube'],
  ['blube', 'Blube'], ['shube', 'Shube'], ['multicolor-cube', 'Multicolor Cube'], ['other-cube', 'Other Cube'],
];
export const formatLabel = key => (FORMATS.find(f => f[0] === key) || [key, key || 'Draft'])[1];

export const FLIP = { '2:0': '0:2', '0:2': '2:0', '2:1': '1:2', '1:2': '2:1', '1:0': '0:1', '0:1': '1:0' };
export const flip = r => FLIP[r] || r;

// Ergebnis aus Sicht von Spieler A
export function outcome(result){
  if(!result || result === 'pending') return null;
  if(result === 'BYE') return 'A';
  if(['2:0', '2:1', '1:0'].includes(result)) return 'A';
  if(['0:2', '1:2', '0:1'].includes(result)) return 'B';
  return 'D';
}

// Welche Turnierspieler-IDs gehoeren mir? (players.slug == profiles.slug)
export function myPlayerIds(players, mySlug){
  if(!mySlug) return new Set();
  return new Set(players.filter(p => p.slug === mySlug).map(p => p.id));
}
