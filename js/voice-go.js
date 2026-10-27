// "Go"-Erkennung direkt am Geraet, lautlos.
//
// Statt der Spracherkennung des Browsers (piept bei jedem Neustart, schickt
// Audio an Google, versteht "Go" im Deutschen schlecht) laeuft ein kleines
// Schluesselwort-Modell (TensorFlow.js Speech Commands, kennt "go") im Browser.
// Zusaetzlich ein Lautstaerke-Filter: nur wer nah am Handy spricht, zaehlt -
// der Nebentisch loest nicht aus.
const TF = 'https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@3.21.0/dist/tf.min.js';
const SC = 'https://cdn.jsdelivr.net/npm/@tensorflow-models/speech-commands@0.5.4/dist/speech-commands.min.js';

// p = Mindest-Sicherheit des Modells, db = Mindest-Lautstaerke (dBFS)
export const LEVELS = {
  nah:    { p: 0.95, db: -30, label: 'Nah – nur wer direkt am Handy spricht' },
  normal: { p: 0.92, db: -38, label: 'Normal – am Tisch' },
  weit:   { p: 0.88, db: -46, label: 'Weit – auch leiser' },
};

let recognizer = null, stream = null, ctx = null, timer = null;
const levels = [];                     // [{t, db}] der letzten ~1,5 s

function loadScript(src){
  return new Promise((ok, fail) => {
    if(document.querySelector(`script[src="${src}"]`)) return ok();
    const s = document.createElement('script');
    s.src = src; s.onload = ok; s.onerror = () => fail(new Error('Sprachmodell konnte nicht geladen werden.'));
    document.head.appendChild(s);
  });
}

function loudestRecent(ms = 1200){
  const since = performance.now() - ms;
  return levels.reduce((mx, l) => l.t >= since && l.db > mx ? l.db : mx, -120);
}

export async function startGo(onGo, levelKey = 'normal'){
  const cfg = LEVELS[levelKey] || LEVELS.normal;
  if(!navigator.mediaDevices?.getUserMedia) throw new Error('Kein Mikrofon-Zugriff in diesem Browser.');

  // Lautstaerke-Messung (ohne automatische Verstaerkung, sonst waere alles gleich laut)
  stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: false } });
  ctx = new (window.AudioContext || window.webkitAudioContext)();
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 1024;
  ctx.createMediaStreamSource(stream).connect(analyser);
  const buf = new Float32Array(analyser.fftSize);
  timer = setInterval(() => {
    analyser.getFloatTimeDomainData(buf);
    let sum = 0; for(const v of buf) sum += v * v;
    const db = 20 * Math.log10(Math.sqrt(sum / buf.length) || 1e-9);
    const t = performance.now();
    levels.push({ t, db });
    while(levels.length && levels[0].t < t - 1500) levels.shift();
  }, 40);

  await loadScript(TF);
  await loadScript(SC);
  recognizer = window.speechCommands.create('BROWSER_FFT');
  await recognizer.ensureModelLoaded();
  const words = recognizer.wordLabels();
  const goIdx = words.indexOf('go');

  await recognizer.listen(async result => {
    const scores = result.scores;
    let best = 0; for(let i = 1; i < scores.length; i++) if(scores[i] > scores[best]) best = i;
    if(best !== goIdx || scores[goIdx] < cfg.p) return;
    if(loudestRecent() < cfg.db) return;           // zu leise -> wohl der Nebentisch
    onGo();
  }, { probabilityThreshold: cfg.p, overlapFactor: 0.6, invokeCallbackOnNoiseAndUnknown: false, suppressionTimeMillis: 1500 });
}

export async function stopGo(){
  try{ if(recognizer?.isListening()) await recognizer.stopListening(); }catch{}
  clearInterval(timer); timer = null;
  stream?.getTracks().forEach(t => t.stop()); stream = null;
  try{ await ctx?.close(); }catch{}
  ctx = null; levels.length = 0;
}
