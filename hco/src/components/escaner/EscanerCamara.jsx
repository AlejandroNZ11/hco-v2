// Cámara híbrida a pantalla completa: códigos de barras automáticos + lectura de texto (OCR).
// Reutilizable: <EscanerCamara onCapture={(captura) => ...} onClose={() => ...} />
// captura = { valor, metodo, motor, modo, raw, confianza, tiempoMs, intentos, previewUrl, candidatos }
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { PSM } from 'tesseract.js';
import {
  boxToVideoRect,
  brightness,
  drawRegion,
  isWeakFormat,
  makeCanvas,
  normalizeFormat,
  cropLine,
  looksLikeBarcodeNoise,
  parseLoteCandidates,
  pickWordAtCross,
  elegirLectura,
  preprocessForOcr,
  sharpness,
} from './scanUtils';
import { nativeDecode, obtenerOcrWorker, useMotoresEscaner, zxingDecode } from './motoresEscaner';
import { sonarEscaneo } from './sonidoEscaneo';
import './escaner.css';

const SCAN_INTERVAL_MS = 110;
const LOCK_MS = 600; // tiempo que hay que mantener el código en el láser
const OCR_VOTOS = 2; // lecturas iguales seguidas bajo la mira para aceptar el texto
const OCR_CONF_MIN = 50; // confianza mínima de la palabra para contarla
const OCR_MARGEN_X = 1.5; // se lee 50% más ancho que el recuadro visible (palabras largas)
const OCR_MARGEN_Y = 1.25;
const MODO_KEY = 'tl-modo-escaner';
const leerModoGuardado = () => {
  try {
    return localStorage.getItem(MODO_KEY) === 'texto' ? 'texto' : 'barras';
  } catch {
    return 'barras';
  }
};
// iPhone/iPad (iPadOS se presenta como Mac con pantalla táctil)
const IS_IOS =
  typeof navigator !== 'undefined' &&
  (/iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export default function EscanerCamara({ onCapture, onClose }) {
  const { ocrReady, ocrError } = useMotoresEscaner();
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingLabel, setProcessingLabel] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [liveHint, setLiveHint] = useState('');
  const [lockInfo, setLockInfo] = useState(null); // { text, progress } código en fijación
  // Modo del escáner: 'barras' (automático) o 'texto' (mira central tipo DataWedge)
  const [scanMode, setScanMode] = useState(leerModoGuardado);
  const [ocrLive, setOcrLive] = useState(null); // palabra bajo la mira { text, conf, votos, box }

  // Capacidades de la cámara (dependen del celular)
  const [caps, setCaps] = useState({ torch: false, zoom: null, exposure: null, focus: false });
  const [torchOn, setTorchOn] = useState(false);
  const [zoomLevel, setZoomLevel] = useState(1);
  const [digitalZoom, setDigitalZoom] = useState(false); // zoom por software (iPhone no expone el zoom de la cámara)
  const [exposure, setExposure] = useState(0);
  const [focusPoint, setFocusPoint] = useState(null);

  const videoRef = useRef(null);
  const scanBoxRef = useRef(null);
  const trackRef = useRef(null);
  const isProcessingRef = useRef(false);
  const photoInputRef = useRef(null);
  const openedAtRef = useRef(0);
  const scanModeRef = useRef(scanMode);
  const ocrLiveRef = useRef(null);
  const doneRef = useRef(false);
  const onCaptureRef = useRef(onCapture);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCaptureRef.current = onCapture;
    onCloseRef.current = onClose;
  });

  // Borra el mensaje de error solo
  useEffect(() => {
    if (!errorMsg) return;
    const t = setTimeout(() => setErrorMsg(''), 4000);
    return () => clearTimeout(t);
  }, [errorMsg]);

  // Bloquea el scroll de la página mientras la cámara está abierta
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  const closeScanner = useCallback(() => {
    isProcessingRef.current = false;
    onCloseRef.current?.();
  }, []);

  // Entrega la lectura y cierra (una sola vez)
  const acceptValue = useCallback((capture) => {
    if (doneRef.current) return;
    doneRef.current = true;
    sonarEscaneo(capture.metodo.startsWith('OCR') ? 'texto' : 'ok');
    if (navigator.vibrate) navigator.vibrate(capture.metodo.startsWith('OCR') ? [70, 40, 70] : 100);
    onCaptureRef.current?.(capture);
    onCloseRef.current?.();
  }, []);

  // ---------------------------------------------------------------------------
  // 1. Cámara + bucle automático de códigos de barras
  // ---------------------------------------------------------------------------
  useEffect(() => {
    let active = true;
    let stream = null;
    let tick = 0;
    let attempts = 0;
    // "Fijación": el mismo código debe verse dentro del láser durante LOCK_MS antes de aceptarse.
    // Así, al pasar la cámara por una etiqueta con varios códigos, no se dispara con el primero que aparece.
    let lock = null; // { text, format, engine, first, last, count }
    const cropCanvas = makeCanvas();
    openedAtRef.current = performance.now();

    // Entre varios códigos en el recorte, elegimos el más cercano al láser (centro del recuadro)
    const pickCentered = (hits, w, h) => {
      if (hits.length <= 1) return hits[0];
      const dist = (c) => (c ? Math.abs(c.y - h / 2) * 2 + Math.abs(c.x - w / 2) : Infinity);
      return [...hits].sort((a, b) => dist(a.center) - dist(b.center))[0];
    };

    const onHit = (hit, engine, modo) => {
      const now = performance.now();
      const text = String(hit?.text || '').trim();
      if (!text) return false;

      if (!lock || lock.text !== text || now - lock.last > 450) {
        lock = { text, format: hit.format, engine, first: now, last: now, count: 1 };
      } else {
        lock.last = now;
        lock.count++;
      }

      const needCount = isWeakFormat(hit.format) ? 3 : 2;
      const progress = Math.min(1, (now - lock.first) / LOCK_MS);
      setLockInfo({ text, progress });

      if (now - lock.first < LOCK_MS || lock.count < needCount) return false;

      acceptValue({
        metodo: `BARRAS · ${normalizeFormat(hit.format).toUpperCase()}`,
        motor: engine,
        modo: `${modo} · fijado ${Math.round(now - lock.first)} ms`,
        valor: text,
        raw: text,
        tiempoMs: Math.round(now - openedAtRef.current),
        intentos: attempts,
        previewUrl: null,
        candidatos: [],
      });
      return true;
    };

    const scanLoop = async () => {
      while (active) {
        const started = performance.now();
        const video = videoRef.current;
        const box = scanBoxRef.current;

        if (
          video && box && video.readyState >= 2 && video.videoWidth &&
          !isProcessingRef.current && scanModeRef.current === 'barras'
        ) {
          attempts++;
          const mode = tick++ % 2;
          try {
            // SOLO lo que está dentro del recuadro (un poco de margen vertical para códigos altos)
            const rect = boxToVideoRect(video, box, 1.04, 1.6);
            const imageData = drawRegion(video, rect, cropCanvas, 1400, 2);
            const { width: w, height: h } = imageData;

            if (tick % 18 === 0 && brightness(imageData) < 55) {
              setLiveHint(trackRef.current?.getCapabilities?.().torch
                ? 'Poca luz: activa la linterna 🔦'
                : 'Poca luz: acerca a una fuente de luz');
            }

            let hit = null;
            let engine = '';
            // a) Nativo (Android) sobre el recorte
            const nativos = await nativeDecode(cropCanvas);
            if (nativos.length) {
              hit = pickCentered(nativos, w, h);
              engine = 'Nativo';
            }
            // b) ZXing sobre el recorte, alternando normal / con limpieza de ruido
            if (!hit) {
              const opts = mode === 1 ? { denoise: true, binarizer: 'GlobalHistogram' } : {};
              hit = pickCentered(await zxingDecode(imageData, opts), w, h);
              engine = 'ZXing';
            }
            if (!active) return;

            if (hit) {
              if (onHit(hit, engine, mode === 1 ? 'recorte+denoise' : 'recorte')) return;
            } else if (lock && performance.now() - lock.last > 450) {
              lock = null;
              setLockInfo(null);
            }
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
            // En iPhone pedimos 4K: Safari no deja enfocar de cerca ni ajustar exposición,
            // así que compensamos con más píxeles (se aleja el celular y se usa zoom digital).
            width: { ideal: IS_IOS ? 3840 : 1920 },
            height: { ideal: IS_IOS ? 2160 : 1080 },
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
    };
  }, [acceptValue]);

  // ---------------------------------------------------------------------------
  // 2. Modo TEXTO (tipo DataWedge): lectura continua de la franja con mira central.
  //    Se lee solo la franja, se toma la palabra que está bajo la cruz y se acepta
  //    cuando sale igual en OCR_VOTOS lecturas seguidas (evita letras mal leídas).
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (scanMode !== 'texto' || !ocrReady) return;

    let active = true;
    let iter = 0;
    let fallos = 0;
    const historial = [];
    const t0 = performance.now();

    const loop = async () => {
      while (active) {
        const started = performance.now();
        const video = videoRef.current;
        const box = scanBoxRef.current;
        const worker = obtenerOcrWorker();

        if (worker && video && box && video.readyState >= 2 && video.videoWidth && !isProcessingRef.current) {
          try {
            // Se lee una franja MÁS ANCHA que la visible: así una palabra que se sale del
            // recuadro igual se lee completa. La cruz sigue siendo el centro del recuadro.
            const visible = boxToVideoRect(video, box, 1, 1);
            const rect = boxToVideoRect(video, box, OCR_MARGEN_X, OCR_MARGEN_Y);

            // 3 frames y nos quedamos con el más nítido (pulso / desenfoque momentáneo)
            let mejor = null;
            for (let i = 0; i < 3; i++) {
              const canvas = makeCanvas();
              const img = drawRegion(video, rect, canvas, 1600, 1);
              const s = sharpness(img);
              if (!mejor || s > mejor.s) mejor = { canvas, s };
              if (i < 2) await sleep(30);
            }

            const pre = preprocessForOcr(mejor.canvas, { targetWidth: 1300, maxScale: 2.5 });
            // Alterna gris / binarizada: una aguanta borroso, la otra sombras y reflejos
            const src = iter++ % 3 === 2 ? pre.binary : pre.gray;
            await worker.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT });
            const { data } = await worker.recognize(src, {}, { blocks: true });
            if (!active) return;

            // Píxeles de la imagen leída ↔ video ↔ recuadro visible
            const kx = rect.sw / src.width;
            const ky = rect.sh / src.height;
            const cx = (visible.sx + visible.sw / 2 - rect.sx) / kx;
            const cy = (visible.sy + visible.sh / 2 - rect.sy) / ky;
            const pick = pickWordAtCross(data.blocks, cx, cy);

            if (pick && pick.text.length >= 3 && pick.conf >= OCR_CONF_MIN) {
              fallos = 0;
              const lh = pick.bbox.y1 - pick.bbox.y0;
              // ¿La palabra toca el borde de lo leído? Entonces sigue afuera: no se acepta cortada
              const cortada = pick.bbox.x0 <= lh * 0.15 || pick.bbox.x1 >= src.width - lh * 0.15;

              // Segunda opinión: se recorta SOLO esa palabra, se amplía y se relee sola
              // (en gris y en blanco/negro). Recupera letras que la lectura general pierde.
              const lecturas = [{ text: pick.text, conf: pick.conf }];
              await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_WORD });
              for (const lienzo of [pre.gray, pre.binary]) {
                const r = await worker.recognize(cropLine(lienzo, pick.bbox, 64));
                lecturas.push({ text: r.data.text || '', conf: r.data.confidence || 0 });
              }
              if (!active) return;
              const lectura = elegirLectura(lecturas) || { text: pick.text, conf: pick.conf };

              if (!cortada) {
                // Si la cruz pasó a otra palabra, se empieza a contar de nuevo
                const previa = historial[historial.length - 1]?.text;
                const relacionadas = (a, b) => a.startsWith(b) || b.startsWith(a) || a.endsWith(b) || b.endsWith(a);
                if (previa && !relacionadas(previa, lectura.text)) historial.length = 0;
                historial.push({ text: lectura.text, conf: lectura.conf });
                if (historial.length > 5) historial.shift();
              }
              // Consenso de las últimas lecturas (también une OPERACIONE con OPERACIONES)
              const consenso = elegirLectura(historial);
              const mismaPalabra =
                consenso &&
                (consenso.text === lectura.text ||
                  consenso.text.startsWith(lectura.text) ||
                  consenso.text.endsWith(lectura.text));
              const texto = mismaPalabra && !cortada ? consenso.text : lectura.text;
              const votos = cortada ? 0 : mismaPalabra ? consenso.votos : 1;
              // Nítido y seguro → 2 lecturas; borroso o dudoso → 3
              const necesarios = lectura.conf >= 80 && mejor.s >= 60 ? OCR_VOTOS : OCR_VOTOS + 1;

              const aPct = (x, y) => ({
                x: ((rect.sx + x * kx - visible.sx) / visible.sw) * 100,
                y: ((rect.sy + y * ky - visible.sy) / visible.sh) * 100,
              });
              const p0 = aPct(pick.bbox.x0, pick.bbox.y0);
              const p1 = aPct(pick.bbox.x1, pick.bbox.y1);
              const live = {
                ...pick,
                text: texto,
                conf: lectura.conf,
                votos,
                necesarios,
                cortada,
                nitidez: Math.round(mejor.s),
                box: { left: p0.x, top: p0.y, width: p1.x - p0.x, height: p1.y - p0.y },
                previewUrl: () => src.toDataURL('image/jpeg', 0.8),
                tiempoMs: Math.round(performance.now() - t0),
                intentos: iter,
              };
              ocrLiveRef.current = live;
              setOcrLive(live);
              setLiveHint(cortada ? 'La palabra se sale: aleja un poco el equipo' : '');

              if (!cortada && votos >= necesarios) {
                aceptarLecturaMira(live, `${votos} lecturas coinciden`);
                return;
              }
            } else {
              // Sin nada bajo la mira: la lectura más antigua deja de contar
              historial.shift();
              // Dos lecturas sin nada bajo la mira: se borra el resaltado
              if (++fallos >= 2 && ocrLiveRef.current) {
                ocrLiveRef.current = null;
                setOcrLive(null);
              }
              if (fallos % 8 === 0 && mejor.s < 40) {
                setLiveHint(IS_IOS ? 'Borroso: aleja un poco y usa 2x' : 'Borroso: toca la pantalla para enfocar');
              }
            }
          } catch {
            // lectura fallida: seguimos
          }
        }

        await sleep(Math.max(0, 60 - (performance.now() - started)));
      }
    };

    loop();
    return () => {
      active = false;
      ocrLiveRef.current = null;
      setOcrLive(null);
      setLiveHint('');
    };
    // aceptarLecturaMira solo usa refs y callbacks estables
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scanMode, ocrReady]);

  function aceptarLecturaMira(live, motivo) {
    acceptValue({
      metodo: 'OCR · MIRA',
      motor: 'Tesseract',
      modo: `${motivo} · nitidez ${live.nitidez}`,
      valor: live.text,
      raw: live.lineText,
      confianza: live.conf,
      tiempoMs: live.tiempoMs,
      intentos: live.intentos,
      previewUrl: live.previewUrl(),
      candidatos: [live.text, ...(live.alternativas || [])].filter((v, i, a) => a.indexOf(v) === i).slice(0, 6),
    });
  }

  const cambiarModo = (modo) => {
    scanModeRef.current = modo;
    setScanMode(modo);
    setLockInfo(null);
    setLiveHint('');
    try {
      localStorage.setItem(MODO_KEY, modo);
    } catch {
      /* sin almacenamiento */
    }
  };

  // Gatillo (botón rojo): en modo texto toma al instante lo que está bajo la mira
  const handleGatillo = () => {
    if (scanMode === 'texto' && ocrLiveRef.current) {
      aceptarLecturaMira(ocrLiveRef.current, 'gatillo');
      return;
    }
    handleCaptureOcr();
  };

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

  // Zoom real de la cámara si existe (Android); si no, zoom digital (iPhone).
  const cycleZoom = async () => {
    if (caps.zoom && !digitalZoom) {
      const steps = [1, 2, 3].filter((z) => z <= caps.zoom.max && z >= caps.zoom.min);
      const idx = steps.indexOf(zoomLevel);
      const next = steps[(idx + 1) % steps.length] ?? 1;
      if (await applyAdvanced({ zoom: next })) {
        setZoomLevel(next);
        return;
      }
    }
    const steps = [1, 1.5, 2, 2.5];
    const next = steps[(steps.indexOf(zoomLevel) + 1) % steps.length] ?? 1;
    setDigitalZoom(next > 1);
    setZoomLevel(next);
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
  // 4. OCR por captura (botón rojo en modo barras)
  //  1) Lectura de todo el recorte para ubicar las líneas de texto (y sus cajas).
  //  2) Cada línea útil se recorta, se agranda y se vuelve a leer sola (modo "una línea").
  //  3) Se juntan todas las lecturas y se puntúan los candidatos (LOTE: xxx primero).
  // ---------------------------------------------------------------------------
  const readLote = async (pre, firstPsm) => {
    const worker = obtenerOcrWorker();
    const readings = [];

    await worker.setParameters({ tessedit_pageseg_mode: firstPsm });
    const { data } = await worker.recognize(pre.gray, {}, { text: true, blocks: true });
    readings.push({ text: data.text || '', conf: data.confidence || 0 });

    const lines = (data.blocks || [])
      .flatMap((b) => b.paragraphs || [])
      .flatMap((p) => p.lines || [])
      .filter((l) => l.bbox.y1 - l.bbox.y0 >= 8 && !looksLikeBarcodeNoise(l.text))
      .map((l) => ({ ...l, kw: /[O0]T[E3]|L[O0]T|BATCH/i.test(l.text) }))
      .sort((x, y) => Number(y.kw) - Number(x.kw) || y.confidence - x.confidence)
      .slice(0, 4);

    await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_LINE });
    for (const line of lines) {
      const g = await worker.recognize(cropLine(pre.gray, line.bbox));
      readings.push({ text: g.data.text || '', conf: g.data.confidence || 0 });
      // Si la línea salió dudosa, segunda opinión con la versión binarizada
      if ((g.data.confidence || 0) < 80) {
        const b = await worker.recognize(cropLine(pre.binary, line.bbox));
        readings.push({ text: b.data.text || '', conf: b.data.confidence || 0 });
      }
    }

    // Sin líneas detectadas: plan B con la imagen binarizada completa
    if (!lines.length) {
      await worker.setParameters({ tessedit_pageseg_mode: firstPsm });
      const b = await worker.recognize(pre.binary);
      readings.push({ text: b.data.text || '', conf: b.data.confidence || 0 });
    }

    const cands = parseLoteCandidates(readings);
    const bestReading = [...readings].sort((x, y) => y.conf - x.conf)[0];
    return {
      cands,
      text: readings.map((r) => r.text.trim()).filter(Boolean).join(' | '),
      conf: Math.round(bestReading?.conf || 0),
      label: `${lines.length} líneas releídas`,
      canvas: pre.gray,
    };
  };

  const handleCaptureOcr = async () => {
    const video = videoRef.current;
    const box = scanBoxRef.current;
    if (!video || !box || isProcessingRef.current || !video.videoWidth) return;
    if (!obtenerOcrWorker()) {
      setErrorMsg('El motor OCR aún está cargando, intenta en unos segundos.');
      return;
    }

    isProcessingRef.current = true;
    setIsProcessing(true);
    const t0 = performance.now();

    try {
      // a) Tomar varios frames y quedarse con el más nítido (evita el borroso por pulso)
      setProcessingLabel('Mantén firme…');
      let bestFrame = null;
      const frames = IS_IOS ? 8 : 5;
      for (let i = 0; i < frames; i++) {
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
        return;
      }

      // c) Preprocesar y leer texto con varias estrategias
      setProcessingLabel('Leyendo texto…');
      const pre = preprocessForOcr(bestFrame.canvas);
      const best = await readLote(pre, PSM.SINGLE_BLOCK);

      if (best?.cands.length) {
        acceptValue({
          metodo: 'OCR TEXTO',
          motor: `Tesseract (${best.label})`,
          modo: `nitidez ${Math.round(bestFrame.s)} · cámara ${video.videoWidth}x${video.videoHeight}`,
          valor: best.cands[0],
          raw: best.text,
          confianza: best.conf,
          tiempoMs: Math.round(performance.now() - t0),
          previewUrl: best.canvas.toDataURL('image/jpeg', 0.85),
          candidatos: best.cands,
        });
      } else {
        setErrorMsg(
          bestFrame.s < 40
            ? IS_IOS
              ? 'Imagen borrosa. Aleja el celular (~25 cm), usa zoom 2x o el botón 📷.'
              : 'Imagen borrosa. Toca la pantalla para enfocar y vuelve a intentar.'
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
        return;
      }

      if (!obtenerOcrWorker()) {
        setErrorMsg('El motor OCR aún está cargando.');
        return;
      }
      setProcessingLabel('Leyendo texto de la foto…');
      const base = makeCanvas();
      drawRegion(bmp, rect, base, 2000);
      const pre = preprocessForOcr(base, { targetWidth: 2000, maxScale: 1.5 });
      const best = await readLote(pre, PSM.SPARSE_TEXT);
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

  const statusText = isProcessing
    ? processingLabel
    : scanMode === 'texto'
    ? !ocrReady
      ? ocrError
        ? 'OCR no disponible (sin internet)'
        : 'Cargando OCR…'
      : ocrLive
      ? ocrLive.cortada
        ? `Se sale del recuadro: ${ocrLive.text}…`
        : `Leyendo: ${ocrLive.text} (${ocrLive.votos}/${ocrLive.necesarios})`
      : liveHint || 'Texto: apunta la cruz al lote'
    : lockInfo
    ? `Mantén… ${lockInfo.text}`
    : liveHint ||
      (ocrError
        ? 'Barras: auto · OCR no disponible (sin internet)'
        : ocrReady
        ? 'Barras: automático · Texto: botón rojo'
        : 'Barras: automático · Cargando OCR…');

  // Portal al <body>: queda encima de cualquier modal de la página
  return createPortal(
    <div className="tl-modal">
      <video
        ref={videoRef}
        className="tl-video"
        playsInline
        muted
        autoPlay
        onClick={handleTapFocus}
        style={digitalZoom ? { transform: `scale(${zoomLevel})` } : undefined}
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

        <div
          ref={scanBoxRef}
          className={`tl-scan-box ${scanMode === 'texto' ? 'modo-texto' : ''} ${isProcessing ? 'busy' : ''} ${
            lockInfo ? 'locking' : ''
          } ${ocrLive ? 'leyendo' : ''}`}
        >
          <span className="tl-corner tl-tl" />
          <span className="tl-corner tl-tr" />
          <span className="tl-corner tl-bl" />
          <span className="tl-corner tl-br" />
          {scanMode === 'texto' ? (
            <>
              <span className="tl-mira" aria-hidden="true" />
              {ocrLive && (
                <span
                  className={`tl-palabra ${ocrLive.cortada ? 'cortada' : ocrLive.votos >= ocrLive.necesarios ? 'ok' : ''}`}
                  style={{
                    left: `${ocrLive.box.left}%`,
                    top: `${ocrLive.box.top}%`,
                    width: `${ocrLive.box.width}%`,
                    height: `${ocrLive.box.height}%`,
                  }}
                />
              )}
              {ocrLive && <span className="tl-palabra-texto">{ocrLive.text}</span>}
            </>
          ) : (
            !isProcessing && <span className="tl-scan-line" />
          )}
          {lockInfo && (
            <span className="tl-lock-bar">
              <span style={{ width: `${Math.round(lockInfo.progress * 100)}%` }} />
            </span>
          )}
        </div>
        <p className="tl-hint">
          {scanMode === 'texto' ? (
            <>
              Pon la cruz sobre el lote: se captura solo cuando varias lecturas coinciden.
              <br />
              El botón rojo lo toma al instante.
            </>
          ) : (
            <>
              Códigos de barras / QR se leen solos.
              <br />
              Para texto usa el modo «Texto».
            </>
          )}
          <br />
          {IS_IOS ? 'iPhone: no acerques demasiado (desenfoca). Aleja ~25 cm y usa 2x.' : 'Toca la imagen para enfocar.'}
        </p>
      </div>

      <div className="tl-modal-bottom-wrap">
        <div className="tl-modo" role="tablist" aria-label="Modo de lectura">
          <button
            type="button"
            role="tab"
            aria-selected={scanMode === 'barras'}
            className={scanMode === 'barras' ? 'active' : ''}
            onClick={() => cambiarModo('barras')}
          >
            ▥ Barras
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={scanMode === 'texto'}
            className={scanMode === 'texto' ? 'active' : ''}
            onClick={() => cambiarModo('texto')}
            disabled={ocrError}
          >
            Aa Texto
          </button>
        </div>
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
            onClick={handleGatillo}
            disabled={isProcessing || !ocrReady}
            title={scanMode === 'texto' ? 'Tomar el texto bajo la mira' : 'Capturar texto (OCR)'}
            aria-label="Capturar texto"
          >
            {isProcessing && <span className="tl-spinner" />}
          </button>

          <button
            type="button"
            className={`tl-tool-btn ${zoomLevel > 1 ? 'active' : ''}`}
            onClick={cycleZoom}
            title="Zoom"
          >
            {zoomLevel}x
          </button>
        </div>
      </div>

      <input ref={photoInputRef} type="file" accept="image/*" capture="environment" hidden onChange={handlePhoto} />
    </div>,
    document.body,
  );
}
