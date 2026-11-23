// Motores del escáner compartidos por TODA la app (se crean una sola vez y quedan listos).
// Así, aunque haya varios campos escaneables en pantalla, no se carga un OCR por campo:
// el primero que se monta los prepara y los demás los reutilizan al instante.
import { useEffect, useState } from 'react';
import { createWorker } from 'tesseract.js';

const OCR_WHITELIST = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-/.: ';

const estado = {
  iniciado: false,
  ocrWorker: null,
  ocrReady: false,
  ocrError: false,
  barcodeWorker: null,
  pendientes: new Map(),
  nativo: null,
};
const oyentes = new Set();
const avisar = () => oyentes.forEach((fn) => fn());

/** Prepara OCR (Tesseract), barras (ZXing en worker) y el detector nativo si existe. Idempotente. */
export function precargarMotores() {
  if (estado.iniciado || typeof window === 'undefined') return;
  estado.iniciado = true;

  (async () => {
    try {
      const worker = await createWorker('eng');
      await worker.setParameters({
        tessedit_char_whitelist: OCR_WHITELIST,
        preserve_interword_spaces: '1',
      });
      estado.ocrWorker = worker;
      estado.ocrReady = true;
    } catch (err) {
      console.error('Error iniciando OCR:', err);
      estado.ocrError = true;
      // Se permite reintentar más tarde (p. ej. cuando vuelva el internet)
      estado.iniciado = Boolean(estado.barcodeWorker);
    }
    avisar();
  })();

  if (!estado.barcodeWorker) {
    const bw = new Worker(new URL('./barcode.worker.js', import.meta.url), { type: 'module' });
    bw.onmessage = (e) => {
      const { id, results } = e.data || {};
      const resolve = estado.pendientes.get(id);
      if (resolve) {
        estado.pendientes.delete(id);
        resolve(results || []);
      }
    };
    estado.barcodeWorker = bw;
  }

  // Detector nativo (Android Chrome usa ML Kit de Google: muy rápido). iOS no lo tiene.
  (async () => {
    try {
      if ('BarcodeDetector' in window) {
        const formats = await window.BarcodeDetector.getSupportedFormats();
        if (formats?.length) estado.nativo = new window.BarcodeDetector({ formats });
      }
    } catch {
      estado.nativo = null;
    }
  })();
}

export const obtenerOcrWorker = () => estado.ocrWorker;

/** Decodifica barras con ZXing en el worker. Nunca bloquea más de 2.5 s. */
export function zxingDecode(imageData, opts = {}) {
  const bw = estado.barcodeWorker;
  if (!bw) return Promise.resolve([]);
  const id = Math.random().toString(36).slice(2);
  return new Promise((resolve) => {
    estado.pendientes.set(id, resolve);
    bw.postMessage({ id, imageData, ...opts }, [imageData.data.buffer]);
    setTimeout(() => {
      if (estado.pendientes.has(id)) {
        estado.pendientes.delete(id);
        resolve([]);
      }
    }, 2500);
  });
}

/** Detector nativo del navegador (si existe). */
export async function nativeDecode(source) {
  if (!estado.nativo) return [];
  try {
    const res = await estado.nativo.detect(source);
    return res.map((r) => ({
      text: r.rawValue,
      format: r.format,
      center: r.boundingBox
        ? { x: r.boundingBox.x + r.boundingBox.width / 2, y: r.boundingBox.y + r.boundingBox.height / 2 }
        : null,
    }));
  } catch {
    return [];
  }
}

/** Estado del OCR para la UI: { ocrReady, ocrError }. También dispara la precarga. */
export function useMotoresEscaner() {
  const [, forzar] = useState(0);
  useEffect(() => {
    precargarMotores();
    const fn = () => forzar((n) => n + 1);
    oyentes.add(fn);
    return () => oyentes.delete(fn);
  }, []);
  return { ocrReady: estado.ocrReady, ocrError: estado.ocrError };
}
