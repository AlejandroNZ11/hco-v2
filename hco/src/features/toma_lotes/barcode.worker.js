// Worker de códigos de barras (ZXing-C++ en WebAssembly).
// Corre fuera del hilo principal para que la cámara no se trabe.
// El .wasm se sirve desde nuestro propio dominio (no CDN) => funciona offline en la PWA.
import { readBarcodes, prepareZXingModule } from 'zxing-wasm/reader';
import wasmUrl from 'zxing-wasm/reader/zxing_reader.wasm?url';

prepareZXingModule({
  overrides: { locateFile: (path, prefix) => (path.endsWith('.wasm') ? wasmUrl : prefix + path) },
  fireImmediately: true,
}).catch((err) => self.postMessage({ type: 'error', message: String(err) }));

// Opciones "agresivas": tolera borroso, rotado, invertido (blanco sobre negro) y poca luz.
const BASE_OPTIONS = {
  formats: [], // vacío = TODOS los formatos (1D y 2D)
  tryHarder: true,
  tryRotate: true,
  tryInvert: true,
  tryDownscale: true,
  maxNumberOfSymbols: 4, // si hay varios en el recorte, devolvemos todos y elegimos el más centrado
};

const center = (p) => {
  if (!p?.topLeft) return null;
  const pts = [p.topLeft, p.topRight, p.bottomRight, p.bottomLeft].filter(Boolean);
  return {
    x: pts.reduce((s, q) => s + q.x, 0) / pts.length,
    y: pts.reduce((s, q) => s + q.y, 0) / pts.length,
  };
};

self.onmessage = async (e) => {
  const { id, imageData, denoise, binarizer } = e.data;
  try {
    const results = await readBarcodes(imageData, {
      ...BASE_OPTIONS,
      tryDenoise: Boolean(denoise),
      binarizer: binarizer || 'LocalAverage',
    });
    const valid = results.filter((r) => r.isValid && r.text);
    self.postMessage({
      id,
      type: 'result',
      width: imageData.width,
      height: imageData.height,
      results: valid.map((r) => ({ text: r.text, format: r.format, center: center(r.position) })),
    });
  } catch (err) {
    self.postMessage({ id, type: 'result', results: [], error: String(err) });
  }
};
