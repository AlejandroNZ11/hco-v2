// Pitido de lectura correcta (como una pistola de códigos). Se genera con Web Audio:
// no descarga ningún archivo y funciona sin internet.
let ctx = null;

// iOS/Android solo dejan sonar audio si el contexto se crea/reanuda en un toque del usuario.
// Llamar al abrir el escáner (botón) para que el pitido posterior sí suene.
export function prepararSonido() {
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    if (!ctx) ctx = new AC();
    if (ctx.state === 'suspended') ctx.resume();
  } catch {
    /* sin audio: no pasa nada */
  }
}

function tono(frecuencia, inicio, duracion, volumen = 0.25) {
  const osc = ctx.createOscillator();
  const gan = ctx.createGain();
  osc.type = 'square';
  osc.frequency.value = frecuencia;
  const t0 = ctx.currentTime + inicio;
  gan.gain.setValueAtTime(0.0001, t0);
  gan.gain.exponentialRampToValueAtTime(volumen, t0 + 0.005);
  gan.gain.exponentialRampToValueAtTime(0.0001, t0 + duracion);
  osc.connect(gan).connect(ctx.destination);
  osc.start(t0);
  osc.stop(t0 + duracion + 0.02);
}

// tipo 'ok' = un pitido corto (código de barras); 'texto' = doble pitido (lectura por OCR)
export function sonarEscaneo(tipo = 'ok') {
  try {
    prepararSonido();
    if (!ctx) return;
    if (tipo === 'texto') {
      tono(1800, 0, 0.07);
      tono(1800, 0.11, 0.07);
    } else {
      tono(2200, 0, 0.12);
    }
  } catch {
    /* sin audio: no pasa nada */
  }
}
