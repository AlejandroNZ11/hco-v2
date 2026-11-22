/**
 * Decodificación de la salida de YOLOX (export ONNX oficial, sin decode_in_inference) y NMS.
 * Es la misma lógica que vision-backend/vision_engine.py (OnnxDetector._detect_yolox).
 */

const gridsCache = new Map();

function grillas(tamano) {
  if (gridsCache.has(tamano)) return gridsCache.get(tamano);
  const gx = [];
  const gy = [];
  const st = [];
  [8, 16, 32].forEach((stride) => {
    const n = Math.floor(tamano / stride);
    for (let y = 0; y < n; y += 1) {
      for (let x = 0; x < n; x += 1) {
        gx.push(x);
        gy.push(y);
        st.push(stride);
      }
    }
  });
  const g = { gx, gy, st };
  gridsCache.set(tamano, g);
  return g;
}

export function iou(a, b) {
  const x1 = Math.max(a[0], b[0]);
  const y1 = Math.max(a[1], b[1]);
  const x2 = Math.min(a[2], b[2]);
  const y2 = Math.min(a[3], b[3]);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const ua = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter;
  return ua > 0 ? inter / ua : 0;
}

/** NMS por clase (no suprime una persona por una caja de otra clase). */
export function nms(dets, umbral = 0.5) {
  const orden = [...dets].sort((a, b) => b.score - a.score);
  const quedan = [];
  orden.forEach((d) => {
    if (!quedan.some((q) => q.clase === d.clase && iou(q.box, d.box) > umbral)) quedan.push(d);
  });
  return quedan;
}

/**
 * @param {Float32Array} data salida (1, N, 5 + C)
 * @param {number[]} dims
 * @param {object} p { tamano, escala (r del letterbox), ancho, alto (frame original), umbral }
 * @returns {{ box: number[], score: number, clase: number }[]} cajas normalizadas 0–1
 */
export function decodificarYolox(data, dims, { tamano, escala, ancho, alto, umbral = 0.35, nmsUmbral = 0.5 }) {
  const N = dims[1];
  const C = dims[2];
  const g = grillas(tamano);
  const decodificar = N === g.gx.length && Math.abs(data[2]) < 20 && Math.abs(data[3]) < 20;
  const dets = [];
  for (let i = 0; i < N; i += 1) {
    const o = i * C;
    const obj = data[o + 4];
    if (obj < umbral * 0.5) continue; // descarte rápido
    let mejor = 0;
    let clase = 0;
    for (let c = 5; c < C; c += 1) {
      if (data[o + c] > mejor) {
        mejor = data[o + c];
        clase = c - 5;
      }
    }
    const score = obj * mejor;
    if (score < umbral) continue;
    let cx = data[o];
    let cy = data[o + 1];
    let w = data[o + 2];
    let h = data[o + 3];
    if (decodificar) {
      cx = (cx + g.gx[i]) * g.st[i];
      cy = (cy + g.gy[i]) * g.st[i];
      w = Math.exp(w) * g.st[i];
      h = Math.exp(h) * g.st[i];
    }
    const x1 = Math.max(0, (cx - w / 2) / escala / ancho);
    const y1 = Math.max(0, (cy - h / 2) / escala / alto);
    const x2 = Math.min(1, (cx + w / 2) / escala / ancho);
    const y2 = Math.min(1, (cy + h / 2) / escala / alto);
    if (x2 > x1 && y2 > y1) dets.push({ box: [x1, y1, x2, y2], score, clase });
  }
  return nms(dets, nmsUmbral);
}
