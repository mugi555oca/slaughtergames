// Rundentimer: Countdown anzeigen, bei 0 klingeln + vibrieren (einmal pro
// Runde und Geraet). Die Endzeit kommt vom Server (rounds.timer_ends_at).

export function fmtLeft(ms){
  const neg = ms < 0;
  const s = Math.abs(Math.round(ms / 1000));
  const m = Math.floor(s / 60), r = s % 60;
  return `${neg ? '+' : ''}${m}:${String(r).padStart(2, '0')}`;
}

let audio = null;
export function ring(){
  try{
    audio = audio || new (window.AudioContext || window.webkitAudioContext)();
    const t0 = audio.currentTime;
    // drei Doppel-Pieps
    for(let k = 0; k < 3; k++){
      for(const [off, f] of [[0, 880], [0.18, 1175]]){
        const o = audio.createOscillator(), g = audio.createGain();
        o.type = 'square'; o.frequency.value = f;
        g.gain.setValueAtTime(0.0001, t0 + k * 0.7 + off);
        g.gain.exponentialRampToValueAtTime(0.25, t0 + k * 0.7 + off + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + k * 0.7 + off + 0.16);
        o.connect(g).connect(audio.destination);
        o.start(t0 + k * 0.7 + off); o.stop(t0 + k * 0.7 + off + 0.18);
      }
    }
  }catch{}
  if(navigator.vibrate) navigator.vibrate([300, 150, 300, 150, 600]);
}

// Browser spielen Ton erst nach einer Beruehrung - beim ersten Tipp freischalten
export function unlockAudio(){
  const go = () => { try{ audio = audio || new (window.AudioContext || window.webkitAudioContext)(); audio.resume(); }catch{} };
  document.addEventListener('pointerdown', go, { once: true });
}

// Laufender Countdown in ein Element. Liefert stop().
export function countdown(el, endsAt, roundKey, onEnd){
  let id = null;
  const end = new Date(endsAt).getTime();
  const tick = () => {
    const left = end - Date.now();
    el.textContent = fmtLeft(left);
    el.classList.toggle('over', left <= 0);
    el.classList.toggle('soon', left > 0 && left < 5 * 60000);
    if(left <= 0){
      const k = 'sg-rang-' + roundKey + '-' + end;
      let done = false; try{ done = localStorage.getItem(k); localStorage.setItem(k, '1'); }catch{}
      if(!done){ ring(); onEnd?.(); }
    }
  };
  tick();
  id = setInterval(tick, 1000);
  return () => clearInterval(id);
}
