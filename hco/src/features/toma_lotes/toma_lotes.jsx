import { useCallback, useEffect, useRef, useState } from 'react';
import { createWorker, PSM } from 'tesseract.js';
import {
  boxToVideoRect,
  brightness,
  drawRegion,
  isWeakFormat,
  makeCanvas,
  normalizeFormat,
  parseLoteCandidates,
  preprocessForOcr,
  sharpness,
} from './scanUtils';
import './toma_lotes.css';

const OCR_WHITELIST = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-/.: ';
const SCAN_INTERVAL_MS = 110;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export default function TomaLotes() {
  const [lote, setLote] = useState('');
  const [isScannerOpen, setIsScannerOpen] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingLabel, setProcessingLabel] = useState('');
  const [ocrReady, setOcrReady] = useState(false);
  const [ocrError, setOcrError] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [liveHint, setLiveHint] = useState('');

  // Capacidades de la cámara (dependen del celular)
  const [caps, setCaps] = useState({ torch: false, zoom: null, exposure: null, focus: false });
  const [torchOn, setTorchOn] = useState(false);
  const [zoomLevel, setZoomLevel] = useState(1);
  const [exposure, setExposure] = useState(0);
  const [focusPoint, setFocusPoint] = useState(null);

  // Diagnóstico
  const [lastCapture, setLastCapture] = useState(null);
  const [registros, setRegistros] = useState([]);

  const videoRef = useRef(null);
  const scanBoxRef = useRef(null);
  const trackRef = useRef(null);
  const ocrWorkerRef = useRef(null);
  const barcodeWorkerRef = useRef(null);
  const barcodePendingRef = useRef(new Map());
  const nativeDetectorRef = useRef(null);
  const isProcessingRef = useRef(false);
  const photoInputRef = useRef(null);
  const openedAtRef = useRef(0);

  // ---------------------------------------------------------------------------
  // 1. Motores: OCR (Tesseract) + Barras (ZXing en worker + nativo si existe)
  // ---------------------------------------------------------------------------
  useEffect(() => {
    let active = true;

    (async () => {
      try {
        const worker = await createWorker('eng');
        await worker.setParameters({
          tessedit_char_whitelist: OCR_WHITELIST,
          preserve_interword_spaces: '1',
        });
        if (!active) return worker.terminate();
        ocrWorkerRef.current = worker;
        setOcrReady(true);
      } catch (err) {
        console.error('Error iniciando OCR:', err);
        if (active) setOcrError(true);
      }
    })();

    // Worker de barras (ZXing). Se maneja con promesas por id.
    const bw = new Worker(new URL('./barcode.worker.js', import.meta.url), { type: 'module' });
    bw.onmessage = (e) => {
      const { id, results } = e.data;
      const resolve = barcodePendingRef.current.get(id);
      if (resolve) {
        barcodePendingRef.current.delete(id);
        resolve(results || []);
      }
    };
    barcodeWorkerRef.current = bw;

    // Detector nativo (Android Chrome usa ML Kit de Google: muy rápido). iOS no lo tiene.
    (async () => {
      try {
        if ('BarcodeDetector' in window) {
          const formats = await window.BarcodeDetector.getSupportedFormats();
          if (formats?.length) nativeDetectorRef.current = new window.BarcodeDetector({ formats });
        }
      } catch {
        nativeDetectorRef.current = null;
      }
    })();

    const pending = barcodePendingRef.current;
    return () => {
      active = false;
      ocrWorkerRef.current?.terminate();
      ocrWorkerRef.current = null;
      bw.terminate();
      barcodeWorkerRef.current = null;
      pending.forEach((resolve) => resolve([]));
      pending.clear();
    };
  }, []);

  // Borra el mensaje de error solo
  useEffect(() => {
    if (!errorMsg) return;
    const t = setTimeout(() => setErrorMsg(''), 4000);
    return () => clearTimeout(t);
  }, [errorMsg]);

  const zxingDecode = useCallback((imageData, opts = {}) => {
    const bw = barcodeWorkerRef.current;
    if (!bw) return Promise.resolve([]);
    const id = Math.random().toString(36).slice(2);
    return new Promise((resolve) => {
      barcodePendingRef.current.set(id, resolve);
      bw.postMessage({ id, imageData, ...opts }, [imageData.data.buffer]);
      // Seguridad: si el worker no responde, no bloquear el bucle
      setTimeout(() => {
        if (barcodePendingRef.current.has(id)) {
          barcodePendingRef.current.delete(id);
          resolve([]);
        }
      }, 2500);
    });
  }, []);

  const nativeDecode = useCallback(async (source) => {
    if (!nativeDetectorRef.current) return [];
    try {
      const res = await nativeDetectorRef.current.detect(source);
      return res.map((r) => ({ text: r.rawValue, format: r.format }));
    } catch {
      return [];
    }
  }, []);

  const closeScanner = useCallback(() => {
    setIsScannerOpen(false);
    setIsProcessing(false);
    isProcessingRef.current = false;
    setLiveHint('');
  }, []);

  const acceptValue = useCallback((capture) => {
    if (navigator.vibrate) navigator.vibrate(capture.metodo.startsWith('OCR') ? [70, 40, 70] : 100);
    setLote(capture.valor);
    setLastCapture(capture);
  }, []);

  // ---------------------------------------------------------------------------
  // 2. Cámara + bucle automático de códigos de barras
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!isScannerOpen) return;

    let active = true;
    let stream = null;
    let tick = 0;
    let attempts = 0;
    let candidate = null; // { text, format, at } para formatos que requieren confirmación
    const cropCanvas = makeCanvas();
    const fullCanvas = makeCanvas();
    openedAtRef.current = performance.now();

    const tryAccept = (hit, engine, modo) => {
      const now = performance.now();
      const text = String(hit.text || '').trim();
      if (!text) return false;
      if (isWeakFormat(hit.format)) {
        if (!candidate || candidate.text !== text || now - candidate.at > 1500) {
          candidate = { text, format: hit.format, at: now };
          setLiveHint('Código detectado, confirmando…');
          return false;
        }
      }
      acceptValue({
        metodo: `BARRAS · ${normalizeFormat(hit.format).toUpperCase()}`,
        motor: engine,
        modo,
        valor: text,
        raw: text,
        tiempoMs: Math.round(now - openedAtRef.current),
        intentos: attempts,
        previewUrl: null,
        candidatos: [],
      });
      closeScanner();
      return true;
    };

    const scanLoop = async () => {
      while (active) {
        const started = performance.now();
        const video = videoRef.current;
        const box = scanBoxRef.current;

        if (video && box && video.readyState >= 2 && video.videoWidth && !isProcessingRef.current) {
          attempts++;
          const mode = tick++ % 3;
          try {
            // a) Nativo sobre el frame completo (Android)
            if (nativeDetectorRef.current) {
              const hits = await nativeDecode(video);
              if (!active) return;
              if (hits.length && tryAccept(hits[0], 'Nativo', 'completo')) return;
            }

            // b) ZXing alternando: recorte ampliado / frame completo / recorte con limpieza de ruido
            let imageData;
            let opts = {};
            let modo;
            if (mode === 1) {
              const rect = { sx: 0, sy: 0, sw: video.videoWidth, sh: video.videoHeight };
              imageData = drawRegion(video, rect, fullCanvas, 1280);
              modo = 'completo';
            } else {
              const rect = boxToVideoRect(video, box, 1.25, 3.2);
              imageData = drawRegion(video, rect, cropCanvas, 1400, 2);
              modo = mode === 0 ? 'recorte' : 'recorte+denoise';
              if (mode === 2) opts = { denoise: true, binarizer: 'GlobalHistogram' };

              // Aviso de poca luz (cada ~2 s)
              if (tick % 18 === 0) {
                const b = brightness(imageData);
                if (b < 55) setLiveHint(caps.torch ? 'Poca luz: activa la linterna 🔦' : 'Poca luz: acerca a una fuente de luz');
              }
            }
            const hits = await zxingDecode(imageData, opts);
            if (!active) return;
            if (hits.length && tryAccept(hits[0], 'ZXing', modo)) return;
          } catch {
            // frame fallido: seguimos
          }
        }

        const elapsed = performance.now() - started;
        await sleep(Math.max(0, SCAN_INTERVAL_MS - elapsed));
      }
    };

    const startCamera = async () => {
      setErrorMsg('');
      if (!navigator.mediaDevices?.getUserMedia) {
        setErrorMsg('Este navegador no permite usar la cámara aquí. Abre la app con HTTPS o usa "Foto".');
        return;
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 1920 },
            height: { ideal: 1080 },
          },
          audio: false,
        });
        if (!active) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }

        const track = stream.getVideoTracks()[0];
        trackRef.current = track;

        const c = track.getCapabilities ? track.getCapabilities() : {};
        const advanced = {};
        if (c.focusMode?.includes('continuous')) advanced.focusMode = 'continuous';
        if (c.exposureMode?.includes('continuous')) advanced.exposureMode = 'continuous';
        if (c.whiteBalanceMode?.includes('continuous')) advanced.whiteBalanceMode = 'continuous';
        if (Object.keys(advanced).length) {
          try {
            await track.applyConstraints({ advanced: [advanced] });
          } catch {
            /* no soportado */
          }
        }

        setCaps({
          torch: Boolean(c.torch),
          zoom: c.zoom && c.zoom.max > 1 ? { min: c.zoom.min || 1, max: c.zoom.max } : null,
          exposure:
            c.exposureCompensation && c.exposureCompensation.max > c.exposureCompensation.min
              ? c.exposureCompensation
              : null,
          focus: Boolean(c.focusMode?.includes('single-shot') || c.pointsOfInterest),
        });

        const video = videoRef.current;
        if (video) {
          video.srcObject = stream;
          await video.play().catch(() => {});
        }
        scanLoop();
      } catch (err) {
        console.error(err);
        const msg =
          err?.name === 'NotAllowedError'
            ? 'Permiso de cámara denegado. Actívalo en el candado de la barra de direcciones.'
            : err?.name === 'NotFoundError'
            ? 'No se encontró cámara en este dispositivo.'
            : 'No se pudo acceder a la cámara. Verifica permisos o usa HTTPS.';
        setErrorMsg(msg);
      }
    };

    startCamera();

    return () => {
      active = false;
      if (stream) stream.getTracks().forEach((t) => t.stop());
      trackRef.current = null;
      setTorchOn(false);
      setZoomLevel(1);
      setExposure(0);
      setCaps({ torch: false, zoom: null, exposure: null, focus: false });
    };
    // caps.torch solo se usa para el texto del aviso; no reiniciar la cámara por eso
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isScannerOpen, acceptValue, closeScanner, nativeDecode, zxingDecode]);

  // ---------------------------------------------------------------------------
  // 3. Controles de cámara
  // ---------------------------------------------------------------------------
  const applyAdvanced = async (constraints) => {
    if (!trackRef.current) return false;
    try {
      await trackRef.current.applyConstraints({ advanced: [constraints] });
      return true;
    } catch (err) {
      console.warn('Constraint no soportado:', constraints, err);
      return false;
    }
  };

  const toggleTorch = async () => {
    if (!caps.torch) return;
    const next = !torchOn;
    if (await applyAdvanced({ torch: next })) setTorchOn(next);
  };

  const cycleZoom = async () => {
    if (!caps.zoom) return;
    const steps = [1, 2, 3].filter((z) => z <= caps.zoom.max && z >= caps.zoom.min);
    const idx = steps.indexOf(zoomLevel);
    const next = steps[(idx + 1) % steps.length] ?? 1;
    if (await applyAdvanced({ zoom: next })) setZoomLevel(next);
  };

  const changeExposure = async (value) => {
    const v = Number(value);
    setExposure(v);
    await applyAdvanced({ exposureCompensation: v });
  };

  // Toca para enfocar (Android Chrome soporta pointsOfInterest / single-shot)
  const handleTapFocus = async (e) => {
    const video = videoRef.current;
    if (!video || !trackRef.current) return;
    const r = video.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width;
    const y = (e.clientY - r.top) / r.height;
    setFocusPoint({ x: e.clientX - r.left, y: e.clientY - r.top, id: Date.now() });
    const c = trackRef.current.getCapabilities?.() || {};
    const cons = {};
    if (c.pointsOfInterest) cons.pointsOfInterest = [{ x, y }];
    if (c.focusMode?.includes('single-shot')) cons.focusMode = 'single-shot';
    if (!Object.keys(cons).length) return;
    await applyAdvanced(cons);
    setTimeout(() => {
      if (c.focusMode?.includes('continuous')) applyAdvanced({ focusMode: 'continuous' });
    }, 1500);
  };

  // ---------------------------------------------------------------------------
  // 4. OCR (tipo Photomath)
  // ---------------------------------------------------------------------------
  const runOcr = async (canvases) => {
    const worker = ocrWorkerRef.current;
    let best = null;
    for (const { canvas, psm, label } of canvases) {
      await worker.setParameters({ tessedit_pageseg_mode: psm });
      const { data } = await worker.recognize(canvas);
      const text = (data.text || '').trim();
      const cands = parseLoteCandidates(text);
      const score = (data.confidence || 0) + (cands.length ? 10 : 0);
      if (!best || score > best.score) best = { text, conf: Math.round(data.confidence || 0), cands, label, canvas, score };
      if (best.conf >= 85 && best.cands.length) break; // suficientemente bueno, no gastar más tiempo
    }
    return best;
  };

  const handleCaptureOcr = async () => {
    const video = videoRef.current;
    const box = scanBoxRef.current;
    if (!video || !box || isProcessingRef.current || !video.videoWidth) return;
    if (!ocrWorkerRef.current) {
      setErrorMsg('El motor OCR aún está cargando, intenta en unos segundos.');
      return;
    }

    isProcessingRef.current = true;
    setIsProcessing(true);
    const t0 = performance.now();

    try {
      // a) Tomar 5 frames y quedarse con el más nítido (evita el borroso por pulso)
      setProcessingLabel('Mantén firme…');
      let bestFrame = null;
      for (let i = 0; i < 5; i++) {
        const rect = boxToVideoRect(video, box, 1.08, 1.15);
        const canvas = makeCanvas();
        const img = drawRegion(video, rect, canvas, 2000, 1);
        const s = sharpness(img);
        if (!bestFrame || s > bestFrame.s) bestFrame = { canvas, s, img };
        await sleep(70);
      }

      // b) Por si acaso: ¿el recorte tiene un código de barras?
      const barHits = await zxingDecode(
        new ImageData(new Uint8ClampedArray(bestFrame.img.data), bestFrame.img.width, bestFrame.img.height),
      );
      if (barHits.length) {
        acceptValue({
          metodo: `BARRAS · ${normalizeFormat(barHits[0].format).toUpperCase()}`,
          motor: 'ZXing',
          modo: 'captura',
          valor: barHits[0].text.trim(),
          raw: barHits[0].text,
          tiempoMs: Math.round(performance.now() - t0),
          previewUrl: bestFrame.canvas.toDataURL('image/jpeg', 0.8),
          candidatos: [],
        });
        closeScanner();
        return;
      }

      // c) Preprocesar y leer texto con varias estrategias
      setProcessingLabel('Leyendo texto…');
      const pre = preprocessForOcr(bestFrame.canvas);
      const best = await runOcr([
        { canvas: pre.gray, psm: PSM.SINGLE_BLOCK, label: 'gris+contraste' },
        { canvas: pre.binary, psm: PSM.SINGLE_BLOCK, label: 'adaptativo' },
        { canvas: pre.gray, psm: PSM.SINGLE_LINE, label: 'gris línea' },
      ]);

      const ms = Math.round(performance.now() - t0);
      if (best?.cands.length) {
        acceptValue({
          metodo: 'OCR TEXTO',
          motor: `Tesseract (${best.label})`,
          modo: `nitidez ${Math.round(bestFrame.s)}`,
          valor: best.cands[0],
          raw: best.text,
          confianza: best.conf,
          tiempoMs: ms,
          previewUrl: best.canvas.toDataURL('image/jpeg', 0.85),
          candidatos: best.cands,
        });
        closeScanner();
      } else {
        setErrorMsg(
          bestFrame.s < 40
            ? 'Imagen borrosa. Toca la pantalla para enfocar y vuelve a intentar.'
            : 'No se detectó texto legible. Acerca un poco más o usa la linterna.',
        );
      }
    } catch (err) {
      console.error('Error en OCR:', err);
      setErrorMsg('Error al leer el texto. Intenta nuevamente.');
    } finally {
      isProcessingRef.current = false;
      setIsProcessing(false);
      setProcessingLabel('');
    }
  };

  // ---------------------------------------------------------------------------
  // 5. Foto con la cámara nativa del celular (mejor enfoque/HDR en condiciones difíciles)
  // ---------------------------------------------------------------------------
  const handlePhoto = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    isProcessingRef.current = true;
    setIsProcessing(true);
    setProcessingLabel('Analizando foto…');
    const t0 = performance.now();
    try {
      const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
      const rect = { sx: 0, sy: 0, sw: bmp.width, sh: bmp.height };

      // Barras: nativo + ZXing sobre la foto completa
      const native = await nativeDecode(bmp);
      let hit = native[0];
      let motor = 'Nativo';
      if (!hit) {
        const img = drawRegion(bmp, rect, makeCanvas(), 2000);
        hit = (await zxingDecode(img, { denoise: true }))[0];
        motor = 'ZXing';
      }
      if (hit) {
        acceptValue({
          metodo: `BARRAS · ${normalizeFormat(hit.format).toUpperCase()}`,
          motor,
          modo: 'foto',
          valor: hit.text.trim(),
          raw: hit.text,
          tiempoMs: Math.round(performance.now() - t0),
          previewUrl: null,
          candidatos: [],
        });
        closeScanner();
        return;
      }

      if (!ocrWorkerRef.current) {
        setErrorMsg('El motor OCR aún está cargando.');
        return;
      }
      setProcessingLabel('Leyendo texto de la foto…');
      const base = makeCanvas();
      drawRegion(bmp, rect, base, 2000);
      const pre = preprocessForOcr(base, { targetWidth: 2000, maxScale: 1.5 });
      const best = await runOcr([
        { canvas: pre.gray, psm: PSM.SPARSE_TEXT, label: 'foto gris' },
        { canvas: pre.binary, psm: PSM.SPARSE_TEXT, label: 'foto adaptativo' },
      ]);
      if (best?.cands.length) {
        acceptValue({
          metodo: 'OCR FOTO',
          motor: `Tesseract (${best.label})`,
          modo: 'foto',
          valor: best.cands[0],
          raw: best.text,
          confianza: best.conf,
          tiempoMs: Math.round(performance.now() - t0),
          previewUrl: best.canvas.toDataURL('image/jpeg', 0.7),
          candidatos: best.cands,
        });
        closeScanner();
      } else {
        setErrorMsg('No se encontró código ni texto legible en la foto.');
      }
    } catch (err) {
      console.error('Error procesando foto:', err);
      setErrorMsg('No se pudo procesar la foto.');
    } finally {
      isProcessingRef.current = false;
      setIsProcessing(false);
      setProcessingLabel('');
    }
  };

  // ---------------------------------------------------------------------------
  // 6. Guardado de prueba (aquí luego va el insert de Supabase / Dexie offline)
  // ---------------------------------------------------------------------------
  const handleGuardarPrueba = (e) => {
    e.preventDefault();
    if (!lote.trim()) return;
    setRegistros((prev) => [
      {
        id: Date.now(),
        lote: lote.trim(),
        metodo: lastCapture?.valor === lote.trim() ? lastCapture.metodo : 'MANUAL',
        hora: new Date().toLocaleTimeString(),
      },
      ...prev,
    ]);
    setLote('');
  };

  const statusText = isProcessing
    ? processingLabel
    : liveHint ||
      (ocrError
        ? 'Barras: auto · OCR no disponible (sin internet)'
        : ocrReady
        ? 'Barras: automático · Texto: botón rojo'
        : 'Barras: automático · Cargando OCR…');

  return (
    <div className="tl-container">
      <h2 className="tl-title">Toma de Lotes (Híbrido)</h2>

      <form onSubmit={handleGuardarPrueba} className="tl-card">
        <label htmlFor="lote-input" className="tl-label">
          Lote / SKU
        </label>

        <div className="tl-input-group">
          <input
            id="lote-input"
            type="text"
            className="tl-input"
            value={lote}
            onChange={(e) => setLote(e.target.value.toUpperCase())}
            placeholder="Escanea código o captura texto..."
            autoComplete="off"
          />
          <button
            type="button"
            className="tl-scan-btn"
            onClick={() => setIsScannerOpen(true)}
            title="Abrir cámara híbrida"
            aria-label="Abrir cámara híbrida"
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M3 7V5a2 2 0 0 1 2-2h2" />
              <path d="M17 3h2a2 2 0 0 1 2 2v2" />
              <path d="M21 17v2a2 2 0 0 1-2 2h-2" />
              <path d="M7 21H5a2 2 0 0 1-2-2v-2" />
              <line x1="7" y1="12" x2="17" y2="12" />
            </svg>
          </button>
        </div>

        {lastCapture?.candidatos?.length > 1 && (
          <div className="tl-chips">
            <span className="tl-chips-label">¿No es correcto? Elige:</span>
            {lastCapture.candidatos.map((c) => (
              <button
                type="button"
                key={c}
                className={`tl-chip ${c === lote ? 'active' : ''}`}
                onClick={() => setLote(c)}
              >
                {c}
              </button>
            ))}
          </div>
        )}

        <button
          type="button"
          className="tl-photo-btn"
          onClick={() => photoInputRef.current?.click()}
          disabled={isProcessing}
        >
          {isProcessing && !isScannerOpen ? processingLabel : '📷 Usar foto (cámara del celular)'}
        </button>

        <button type="submit" className="tl-save-btn">
          Guardar Lote (Prueba Local)
        </button>
      </form>

      <input
        ref={photoInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        onChange={handlePhoto}
      />

      {!isScannerOpen && errorMsg && <div className="tl-error-inline">{errorMsg}</div>}

      {/* Diagnóstico de la última captura */}
      {lastCapture && (
        <div className="tl-debug-card">
          <div className="tl-debug-header">
            <span className="tl-badge">{lastCapture.metodo}</span>
            <span className="tl-time">{lastCapture.tiempoMs} ms</span>
          </div>
          <p className="tl-debug-text">
            <strong>Detectado:</strong> {lastCapture.valor}
          </p>
          <p className="tl-debug-raw">
            Motor: {lastCapture.motor}
            {lastCapture.modo ? ` · ${lastCapture.modo}` : ''}
            {lastCapture.intentos ? ` · ${lastCapture.intentos} frames` : ''}
            {lastCapture.confianza != null ? ` · confianza ${lastCapture.confianza}%` : ''}
          </p>
          {lastCapture.raw !== lastCapture.valor && (
            <p className="tl-debug-raw">Texto crudo: "{lastCapture.raw}"</p>
          )}
          {lastCapture.previewUrl && (
            <div className="tl-preview-box">
              <span>Lo que vio el OCR:</span>
              <img src={lastCapture.previewUrl} alt="Recorte OCR" />
            </div>
          )}
        </div>
      )}

      {/* Lista de prueba */}
      {registros.length > 0 && (
        <div className="tl-list">
          <h3>Capturados ({registros.length})</h3>
          {registros.map((r) => (
            <div key={r.id} className="tl-list-item">
              <strong>{r.lote}</strong>
              <span>
                {r.metodo} · {r.hora}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Modal de Cámara Híbrida */}
      {isScannerOpen && (
        <div className="tl-modal">
          <video
            ref={videoRef}
            className="tl-video"
            playsInline
            muted
            autoPlay
            onClick={handleTapFocus}
          />
          {focusPoint && (
            <span key={focusPoint.id} className="tl-focus-ring" style={{ left: focusPoint.x, top: focusPoint.y }} />
          )}

          <div className="tl-modal-top">
            <span className="tl-status-pill">{statusText}</span>
            <button type="button" className="tl-close-btn" onClick={closeScanner} aria-label="Cerrar">
              ✕
            </button>
          </div>

          <div className="tl-overlay-center">
            {errorMsg && <div className="tl-error-toast">{errorMsg}</div>}

            <div ref={scanBoxRef} className={`tl-scan-box ${isProcessing ? 'busy' : ''}`}>
              <span className="tl-corner tl-tl" />
              <span className="tl-corner tl-tr" />
              <span className="tl-corner tl-bl" />
              <span className="tl-corner tl-br" />
              {!isProcessing && <span className="tl-scan-line" />}
            </div>
            <p className="tl-hint">
              Códigos de barras / QR se leen solos.
              <br />
              Para texto: encuadra el lote y toca el botón rojo. Toca la imagen para enfocar.
            </p>
          </div>

          <div className="tl-modal-bottom-wrap">
            {caps.exposure && (
              <label className="tl-exposure">
                <span>☀</span>
                <input
                  type="range"
                  min={caps.exposure.min}
                  max={caps.exposure.max}
                  step={caps.exposure.step || 0.1}
                  value={exposure}
                  onChange={(e) => changeExposure(e.target.value)}
                />
              </label>
            )}
            <div className="tl-modal-bottom">
              <button
                type="button"
                className={`tl-tool-btn ${torchOn ? 'active' : ''}`}
                onClick={toggleTorch}
                disabled={!caps.torch}
                title="Linterna"
              >
                🔦
              </button>

              <button
                type="button"
                className="tl-tool-btn"
                onClick={() => photoInputRef.current?.click()}
                disabled={isProcessing}
                title="Tomar foto con la cámara del celular"
              >
                📷
              </button>

              <button
                type="button"
                className={`tl-shutter-btn ${isProcessing ? 'loading' : ''}`}
                onClick={handleCaptureOcr}
                disabled={isProcessing || !ocrReady}
                title="Capturar texto (OCR)"
                aria-label="Capturar texto"
              >
                {isProcessing && <span className="tl-spinner" />}
              </button>

              <button
                type="button"
                className={`tl-tool-btn ${zoomLevel > 1 ? 'active' : ''}`}
                onClick={cycleZoom}
                disabled={!caps.zoom}
                title="Zoom"
              >
                {zoomLevel}x
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
