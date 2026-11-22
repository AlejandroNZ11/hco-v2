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

// "LOTE" tolerante a errores típicos del OCR: OTE, L0TE, 1OTE, LOT, LT, BATCH...
const KEYWORD_RE = /(?:^|[^A-Z0-9])(?:[LI1|]?[O0]T[E3]|L[O0]T|BATCH|LT)\s*[:.;,]?\s*([A-Z0-9][A-Z0-9\-/.]{2,})/gi;
const STOPWORDS = new Set([
  'LOTE', 'LOT', 'BATCH', 'FECHA', 'VENCIMIENTO', 'VENC', 'VCTO', 'FAB', 'SKU', 'UM', 'CANT', 'PEDIDO',
  'CLIENTE', 'TIPO', 'PRINCIPAL', 'PASILLO', 'FACTOR', 'AUXILIAR', 'AUDITOR', 'PALET', 'UBI', 'DE',
]);

function cleanToken(s) {
  return String(s || '')
    .toUpperCase()
    .replace(/[^A-Z0-9\-/.]/g, '')
    .replace(/^[-/.]+|[-/.]+$/g, '');
}

/** Puntaje "parece lote": letras+números > solo números > fechas / EAN largos > palabras. */
function shapeScore(t) {
  if (t.length < 3 || STOPWORDS.has(t)) return -100;
  const hasD = /\d/.test(t);
  const hasA = /[A-Z]/.test(t);
  let s = hasD && hasA ? 30 : hasD ? 20 : -40;
  if (/^\d{1,2}[/.-]\d{2,4}$/.test(t) || /^\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}$/.test(t)) s -= 35; // fecha
  if (/^\d{12,}$/.test(t)) s -= 15; // número de EAN/GTIN impreso bajo un código
  if (t.length > 16) s -= 20; // probablemente basura pegada
  if (t.length >= 4 && t.length <= 14) s += 5;
  return s;
}

/** ¿Línea de barras leída como texto? (IIII||l11) */
export function looksLikeBarcodeNoise(text) {
  const t = String(text || '').replace(/\s/g, '');
  if (t.length < 3) return true;
  const noise = (t.match(/[IL1|!]/gi) || []).length;
  return noise / t.length > 0.6;
}

/**
 * Recibe varias lecturas OCR ({ text, conf }) del mismo recorte (página completa + cada línea
 * releída) y devuelve candidatos ordenados por probabilidad de ser el lote.
 */
export function parseLoteCandidates(readings) {
  const list = Array.isArray(readings) ? readings : [{ text: readings, conf: 50 }];
  const scores = new Map();
  const add = (tok, pts) => {
    const t = cleanToken(tok);
    if (t.length < 3) return;
    scores.set(t, (scores.get(t) || 0) + pts);
  };

  for (const { text, conf = 50 } of list) {
    const c = Math.max(0, conf) / 10; // 0-10
    const lines = String(text || '').split(/\n+/).map((l) => l.trim()).filter(Boolean);
    for (const line of lines) {
      if (looksLikeBarcodeNoise(line)) continue;

      // 1) Lo que viene después de LOTE / LOT / OTE…
      for (const m of line.matchAll(KEYWORD_RE)) {
        const v = cleanToken(m[1]);
        if (!STOPWORDS.has(v)) add(v, 100 + c + Math.max(0, shapeScore(v)));
      }

      // 2) Cada palabra según su forma
      const noKw = line.replace(/(?:^|[^A-Z0-9])(?:[LI1|]?[O0]T[E3]|L[O0]T|BATCH)\s*[:.;,]?/gi, ' ');
      for (const w of noKw.split(/\s+/)) {
        const t = cleanToken(w);
        const sc = shapeScore(t);
        if (sc > -50) add(t, sc + c);
      }
    }
  }

  return [...scores.entries()]
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([k]) => k)
    .slice(0, 6);
}

/**
 * Recorta una línea (bbox de Tesseract) de un canvas, la escala a una altura cómoda y le agrega
 * margen blanco (Tesseract lee mucho mejor con texto grande y aire alrededor).
 */
export function cropLine(canvas, bbox, targetH = 72) {
  const lh = bbox.y1 - bbox.y0;
  const padY = Math.round(lh * 0.35);
  const padX = Math.round(lh * 0.5);
  const sx = Math.max(0, bbox.x0 - padX);
  const sy = Math.max(0, bbox.y0 - padY);
  const sw = Math.min(canvas.width - sx, bbox.x1 - bbox.x0 + padX * 2);
  const sh = Math.min(canvas.height - sy, lh + padY * 2);
  const scale = clamp(targetH / Math.max(1, lh), 0.5, 4);
  const border = 16;
  const out = makeCanvas(sw * scale + border * 2, sh * scale + border * 2);
  const ctx = out.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(canvas, sx, sy, sw, sh, border, border, sw * scale, sh * scale);
  return out;
}

// Formatos sin dígito verificador fuerte: pedimos 2 lecturas iguales antes de aceptar.
const WEAK_FORMATS = new Set(['code39', 'codabar', 'itf', 'itf14', 'code93', 'unknown']);

export function normalizeFormat(f) {
  return String(f || 'unknown').toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function isWeakFormat(f) {
  return WEAK_FORMATS.has(normalizeFormat(f));
}

// ---------------------------------------------------------------------------
// Modo "mira" (como DataWedge): se lee la palabra que está bajo la cruz central
// ---------------------------------------------------------------------------
const LABEL_RE = /^(?:[LI1|]?[O0]T[E3]|L[O0]T|BATCH|LT)$/;
const isLabelToken = (t) => t.length < 2 || STOPWORDS.has(t) || LABEL_RE.test(t);

/**
 * Recibe los bloques de Tesseract (blocks → paragraphs → lines → words) y el punto de la cruz
 * (en píxeles de la imagen leída). Devuelve la palabra bajo la cruz:
 *  - la línea que pasa por la cruz (o la más cercana en vertical),
 *  - dentro de ella, la palabra que contiene la cruz (o la más cercana),
 *  - si la cruz cae sobre una etiqueta ("LOTE", "SKU", ":"), se toma la palabra siguiente.
 */
export function pickWordAtCross(blocks, cx, cy) {
  const lines = (blocks || [])
    .flatMap((b) => b.paragraphs || [])
    .flatMap((p) => p.lines || [])
    .map((l) => ({
      bbox: l.bbox,
      words: (l.words || [])
        .map((w) => {
          // "LOTE:0220503" pegado → "0220503"
          let text = cleanToken(w.text);
          const sinEtiqueta = text.replace(/^(?:[LI1]?[O0]T[E3]|L[O0]T|BATCH)(?=[0-9])/, '');
          if (sinEtiqueta.length >= 3) text = sinEtiqueta;
          return { text, conf: w.confidence || 0, bbox: w.bbox };
        })
        .filter((w) => w.text && !looksLikeBarcodeNoise(w.text))
        .sort((a, b) => a.bbox.x0 - b.bbox.x0),
    }))
    .filter((l) => l.words.length && l.bbox.y1 - l.bbox.y0 >= 6);
  if (!lines.length) return null;

  const vdist = (b) => (cy < b.y0 ? b.y0 - cy : cy > b.y1 ? cy - b.y1 : 0);
  const hdist = (b) => (cx < b.x0 ? b.x0 - cx : cx > b.x1 ? cx - b.x1 : 0);
  const centroY = (b) => Math.abs((b.y0 + b.y1) / 2 - cy);

  const line = [...lines].sort((a, b) => vdist(a.bbox) - vdist(b.bbox) || centroY(a.bbox) - centroY(b.bbox))[0];
  const lh = line.bbox.y1 - line.bbox.y0;
  if (vdist(line.bbox) > lh * 1.2) return null; // la cruz no está sobre ninguna línea

  const { words } = line;
  let idx = 0;
  words.forEach((w, i) => {
    if (hdist(w.bbox) < hdist(words[idx].bbox)) idx = i;
  });
  if (hdist(words[idx].bbox) > lh * 3) return null;
  if (isLabelToken(words[idx].text)) {
    const sig = words.findIndex((w, i) => i > idx && !isLabelToken(w.text));
    if (sig === -1) return null;
    idx = sig;
  }

  const w = words[idx];
  return {
    text: w.text,
    conf: Math.round(w.conf),
    bbox: w.bbox,
    lineText: words.map((x) => x.text).join(' '),
    // Otras palabras de la línea, por si el usuario quiere elegir otra
    alternativas: words.map((x) => x.text).filter((t) => t !== w.text && !isLabelToken(t) && t.length >= 3),
  };
}
