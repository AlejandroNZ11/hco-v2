/**
 * Worker de detección: corre los modelos ONNX (YOLOX) con onnxruntime-web (WASM) fuera del
 * hilo principal, para que la cámara y la pantalla no se traben.
 *
 * Mensajes:
 *  → { tipo: 'cargar', id, modelos: { clave: { url, tamano } } }
 *  ← { tipo: 'cargado', id, disponibles: { clave: bool }, errores: { clave: msg }, hilos }
 *  → { tipo: 'detectar', id, modelo, pixeles (RGBA tamano×tamano), escala, ancho, alto, umbral }
 *  ← { tipo: 'resultado', id, dets: [{ box:[x1,y1,x2,y2] normalizado, score, clase }], ms }
 */
import * as ort from 'onnxruntime-web/wasm';
import wasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.wasm?url';
import mjsUrl from 'onnxruntime-web/ort-wasm-simd-threaded.mjs?url';
import { decodificarYolox } from './yolox';

// Los archivos WASM se sirven desde la propia app (sin CDN externo, funciona offline con el PWA)
ort.env.wasm.wasmPaths = { wasm: wasmUrl, mjs: mjsUrl };
// Varios hilos solo si la página está aislada (COOP/COEP); si no, 1 hilo con SIMD
const hilos = self.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 2) : 1;
ort.env.wasm.numThreads = hilos;
ort.env.wasm.proxy = false;

const sesiones = {}; // clave → { sesion, tamano, entrada }

async function cargar(modelos) {
  const disponibles = {};
  const errores = {};
  for (const [clave, m] of Object.entries(modelos)) {
    if (sesiones[clave]) {
      disponibles[clave] = true;
      continue;
    }
    if (!m?.url) {
      disponibles[clave] = false;
      continue;
    }
    try {
      const res = await fetch(m.url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const tipo = res.headers.get('content-type') || '';
      // Un archivo inexistente en Cloudflare/Vite devuelve el index.html (200) en vez de 404
      if (tipo.includes('text/html')) throw new Error('archivo no encontrado');
      const buffer = await res.arrayBuffer();
      const sesion = await ort.InferenceSession.create(buffer, {
        executionProviders: ['wasm'],
        graphOptimizationLevel: 'all',
      });
      sesiones[clave] = { sesion, tamano: m.tamano || 416, entrada: sesion.inputNames[0] };
      disponibles[clave] = true;
    } catch (err) {
      disponibles[clave] = false;
      errores[clave] = err.message || String(err);
    }
  }
  return { disponibles, errores };
}

async function detectar({ modelo, pixeles, escala, ancho, alto, umbral }) {
  const s = sesiones[modelo];
  if (!s) return [];
  const n = s.tamano * s.tamano;
  // RGBA (canvas) → CHW en orden BGR y 0–255, que es lo que espera el YOLOX oficial
  const datos = new Float32Array(3 * n);
  for (let i = 0, j = 0; i < n; i += 1, j += 4) {
    datos[i] = pixeles[j + 2];
    datos[n + i] = pixeles[j + 1];
    datos[2 * n + i] = pixeles[j];
  }
  const tensor = new ort.Tensor('float32', datos, [1, 3, s.tamano, s.tamano]);
  const salida = await s.sesion.run({ [s.entrada]: tensor });
  const out = salida[s.sesion.outputNames[0]];
  return decodificarYolox(out.data, out.dims, { tamano: s.tamano, escala, ancho, alto, umbral });
}

self.onmessage = async (e) => {
  const msg = e.data;
  try {
    if (msg.tipo === 'cargar') {
      const r = await cargar(msg.modelos);
      self.postMessage({ tipo: 'cargado', id: msg.id, ...r, hilos });
    } else if (msg.tipo === 'detectar') {
      const t0 = performance.now();
      const dets = await detectar(msg);
      self.postMessage({ tipo: 'resultado', id: msg.id, dets, ms: Math.round(performance.now() - t0) });
    }
  } catch (err) {
    self.postMessage({ tipo: 'error', id: msg.id, mensaje: err.message || String(err) });
  }
};
