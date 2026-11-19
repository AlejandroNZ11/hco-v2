// Utilidades de imagen para el escáner híbrido (barras + OCR).
// Todo es JS puro sobre <canvas>, funciona igual en Android e iOS.

const clamp = (v, min, max) => Math.min(max, Math.max(min, v));

export function makeCanvas(w = 1, h = 1) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

/**
 * Convierte el rectángulo del marco rojo (coordenadas de pantalla) a coordenadas
 * del video real, compensando `object-fit: cover`.
 * padX / padY agrandan el recorte (1 = exacto) para dar margen al usuario.
 */
export function boxToVideoRect(video, box, padX = 1, padY = 1) {
  const vRect = video.getBoundingClientRect();
  const bRect = box.getBoundingClientRect();
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  const scale = Math.max(vRect.width / vw, vRect.height / vh);
  const offsetX = (vw * scale - vRect.width) / 2;
  const offsetY = (vh * scale - vRect.height) / 2;

  const cx = (bRect.left + bRect.width / 2 - vRect.left + offsetX) / scale;
  const cy = (bRect.top + bRect.height / 2 - vRect.top + offsetY) / scale;
  const w = (bRect.width * padX) / scale;
  const h = (bRect.height * padY) / scale;

  const sx = clamp(cx - w / 2, 0, vw - 1);
  const sy = clamp(cy - h / 2, 0, vh - 1);
  return {
    sx,
    sy,
    sw: clamp(w, 1, vw - sx),
    sh: clamp(h, 1, vh - sy),
  };
}

/** Dibuja una región de una fuente (video/imagen/canvas) en un canvas, limitando el lado mayor. */
export function drawRegion(source, rect, canvas, maxSide = 1280, minScale = 1) {
  const scale = Math.min(maxSide / Math.max(rect.sw, rect.sh), Math.max(minScale, 1));
  canvas.width = Math.max(1, Math.round(rect.sw * scale));
  canvas.height = Math.max(1, Math.round(rect.sh * scale));
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, rect.sx, rect.sy, rect.sw, rect.sh, 0, 0, canvas.width, canvas.height);
  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

/** Nitidez = varianza del Laplaciano (más alto = más enfocado). Sirve para elegir el mejor frame. */
export function sharpness(imageData) {
  const { data, width, height } = imageData;
  const step = width * height > 400000 ? 2 : 1;
  const gray = (x, y) => {
    const i = (y * width + x) * 4;
    return 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
  };
  let sum = 0;
  let sumSq = 0;
  let n = 0;
  for (let y = 1; y < height - 1; y += step) {
    for (let x = 1; x < width - 1; x += step) {
      const lap = 4 * gray(x, y) - gray(x - 1, y) - gray(x + 1, y) - gray(x, y - 1) - gray(x, y + 1);
      sum += lap;
      sumSq += lap * lap;
      n++;
    }
  }
  if (!n) return 0;
  const mean = sum / n;
  return sumSq / n - mean * mean;
}

/** Brillo medio (0-255) para avisar "poca luz". */
export function brightness(imageData) {
  const { data } = imageData;
  let s = 0;
  let n = 0;
  for (let i = 0; i < data.length; i += 16) {
    s += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    n++;
  }
  return n ? s / n : 0;
}

/**
 * Preprocesa un recorte para OCR. Devuelve 2 variantes:
 *  - gray:   escala de grises + estiramiento de contraste + enfoque (para borroso / poca luz)
 *  - binary: umbral adaptativo Sauvola (para sombras, reflejos y luz desigual)
 * Ambas se escalan para que el texto tenga un tamaño cómodo para Tesseract.
 */
export function preprocessForOcr(srcCanvas, { targetWidth = 1600, maxScale = 3 } = {}) {
  const scale = clamp(targetWidth / srcCanvas.width, 1, maxScale);
  const w = Math.round(srcCanvas.width * scale);
  const h = Math.round(srcCanvas.height * scale);

  const base = makeCanvas(w, h);
  const bctx = base.getContext('2d', { willReadFrequently: true });
  bctx.imageSmoothingEnabled = true;
  bctx.imageSmoothingQuality = 'high';
  bctx.drawImage(srcCanvas, 0, 0, w, h);
  const img = bctx.getImageData(0, 0, w, h);
  const px = img.data;
  const N = w * h;

  // 1) Gris
  const g = new Float32Array(N);
  for (let i = 0, j = 0; j < N; i += 4, j++) {
    g[j] = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
  }

  // 2) Estiramiento de contraste por percentiles (1% - 99%)
  const hist = new Uint32Array(256);
  for (let j = 0; j < N; j++) hist[g[j] | 0]++;
  let lo = 0;
  let hi = 255;
  let acc = 0;
  for (let v = 0; v < 256; v++) {
    acc += hist[v];
    if (acc >= N * 0.01) { lo = v; break; }
  }
  acc = 0;
  for (let v = 255; v >= 0; v--) {
    acc += hist[v];
    if (acc >= N * 0.01) { hi = v; break; }
  }
  const range = Math.max(1, hi - lo);
  for (let j = 0; j < N; j++) g[j] = clamp(((g[j] - lo) * 255) / range, 0, 255);

  // 3) Enfoque (unsharp mask con blur de caja 3x3) para recuperar bordes de texto borroso
  const blur = new Float32Array(N);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const k = y * w + x;
      blur[k] =
        (g[k - w - 1] + g[k - w] + g[k - w + 1] + g[k - 1] + g[k] + g[k + 1] + g[k + w - 1] + g[k + w] + g[k + w + 1]) / 9;
    }
  }
  const sharp = new Float32Array(N);
  for (let j = 0; j < N; j++) sharp[j] = blur[j] ? clamp(g[j] + 1.2 * (g[j] - blur[j]), 0, 255) : g[j];

  // Polaridad: Tesseract quiere texto oscuro sobre fondo claro.
  let mean = 0;
  for (let j = 0; j < N; j++) mean += sharp[j];
  mean /= N;
  const invert = mean < 110; // fondo mayormente oscuro => texto claro (etiquetas negras, láser, etc.)

  const grayCanvas = makeCanvas(w, h);
  const gctx = grayCanvas.getContext('2d');
  const gImg = gctx.createImageData(w, h);
  for (let i = 0, j = 0; j < N; i += 4, j++) {
    const v = invert ? 255 - sharp[j] : sharp[j];
    gImg.data[i] = gImg.data[i + 1] = gImg.data[i + 2] = v;
    gImg.data[i + 3] = 255;
  }
  gctx.putImageData(gImg, 0, 0);

  // 4) Sauvola con imágenes integrales (umbral local => aguanta sombras y reflejos)
  const W1 = w + 1;
  const integ = new Float64Array(W1 * (h + 1));
  const integSq = new Float64Array(W1 * (h + 1));
  for (let y = 0; y < h; y++) {
    let rs = 0;
    let rsq = 0;
    for (let x = 0; x < w; x++) {
      const v = invert ? 255 - sharp[y * w + x] : sharp[y * w + x];
      rs += v;
      rsq += v * v;
      integ[(y + 1) * W1 + x + 1] = integ[y * W1 + x + 1] + rs;
      integSq[(y + 1) * W1 + x + 1] = integSq[y * W1 + x + 1] + rsq;
    }
  }
  const r = Math.max(8, Math.round(Math.min(w, h) / 10));
  const kS = 0.2;
  const R = 128;
  const binCanvas = makeCanvas(w, h);
  const bctx2 = binCanvas.getContext('2d');
  const bImg = bctx2.createImageData(w, h);
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - r);
    const y1 = Math.min(h - 1, y + r);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - r);
      const x1 = Math.min(w - 1, x + r);
      const cnt = (x1 - x0 + 1) * (y1 - y0 + 1);
      const A = y0 * W1 + x0;
      const B = y0 * W1 + x1 + 1;
      const C = (y1 + 1) * W1 + x0;
      const D = (y1 + 1) * W1 + x1 + 1;
      const s = integ[D] - integ[B] - integ[C] + integ[A];
      const sq = integSq[D] - integSq[B] - integSq[C] + integSq[A];
      const m = s / cnt;
      const sd = Math.sqrt(Math.max(0, sq / cnt - m * m));
      const t = m * (1 + kS * (sd / R - 1));
      const v = invert ? 255 - sharp[y * w + x] : sharp[y * w + x];
      const o = (y * w + x) * 4;
      const out = v > t ? 255 : 0;
      bImg.data[o] = bImg.data[o + 1] = bImg.data[o + 2] = out;
      bImg.data[o + 3] = 255;
    }
  }
  bctx2.putImageData(bImg, 0, 0);

  return { gray: grayCanvas, binary: binCanvas, inverted: invert };
}

const KEYWORD_RE = /(?:\b(?:LOTE|LOT|BATCH)\b\s*[:.#Nº°-]*|\b(?:LT|L)\s*[:.#])\s*([A-Z0-9][A-Z0-9\-/.]{2,})/i;

function cleanToken(s) {
  return s
    .toUpperCase()
    .replace(/[^A-Z0-9\-/.]/g, '')
    .replace(/^[-/.]+|[-/.]+$/g, '');
}

/**
 * A partir del texto OCR devuelve candidatos de lote ordenados por probabilidad:
 *  1. Lo que venga después de "LOTE", "LOT", "BATCH"...
 *  2. Líneas completas limpias
 *  3. Tokens con letras+números (típico de lote)
 */
export function parseLoteCandidates(text) {
  const out = [];
  const push = (v) => {
    const c = cleanToken(v || '');
    if (c.length >= 3 && !out.includes(c)) out.push(c);
  };
  const lines = String(text || '')
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean);

  for (const line of lines) {
    const m = line.match(KEYWORD_RE);
    if (m) push(m[1]);
  }

  const tokens = [];
  for (const line of lines) {
    const noKw = line.replace(/\b(?:LOTE|LOT|BATCH)\b\s*[:.#Nº°-]*/gi, ' ');
    push(noKw.replace(/\s+/g, ''));
    noKw.split(/\s+/).forEach((t) => tokens.push(cleanToken(t)));
  }

  tokens
    .filter((t) => t.length >= 3)
    .sort((a, b) => {
      const score = (t) => (/[A-Z]/.test(t) && /\d/.test(t) ? 2 : /\d/.test(t) ? 1 : 0) * 100 + t.length;
      return score(b) - score(a);
    })
    .forEach(push);

  return out.slice(0, 6);
}

// Formatos sin dígito verificador fuerte: pedimos 2 lecturas iguales antes de aceptar.
const WEAK_FORMATS = new Set(['code39', 'codabar', 'itf', 'itf14', 'code93', 'unknown']);

export function normalizeFormat(f) {
  return String(f || 'unknown').toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function isWeakFormat(f) {
  return WEAK_FORMATS.has(normalizeFormat(f));
}
