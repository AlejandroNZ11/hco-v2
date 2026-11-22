import { useEffect, useRef, useState } from 'react';
import { crearProcesador, etiquetasDe } from './procesadores';
import { Persistencia } from './persistencia';

const CONTEO_FLUSH_MS = 15000;
const LADO_CUADRO = 1280; // resolución de la foto de evidencia
const UMBRAL = 0.35;

function sello(fecha) {
  const p = (n) => String(n).padStart(2, '0');
  return `${fecha.getFullYear()}${p(fecha.getMonth() + 1)}${p(fecha.getDate())}_${p(fecha.getHours())}${p(fecha.getMinutes())}${p(fecha.getSeconds())}`;
}

/** Foto de evidencia: el frame exacto analizado + recuadros + franja con cámara, área y hora. */
export function fotoEvidencia(cuadro, cajas, infractores, cfg) {
  const c = document.createElement('canvas');
  c.width = cuadro.width;
  c.height = cuadro.height;
  const ctx = c.getContext('2d');
  ctx.drawImage(cuadro, 0, 0);
  const W = c.width;
  const H = c.height;
  const ids = new Map(infractores.map((i) => [i.track_id, i]));
  const fuente = Math.max(14, Math.round(W / 60));
  ctx.font = `600 ${fuente}px system-ui, sans-serif`;
  cajas.forEach((k) => {
    const [x1, y1, x2, y2] = [k.box[0] * W, k.box[1] * H, k.box[2] * W, k.box[3] * H];
    const inf = ids.get(k.track_id);
    ctx.strokeStyle = inf ? '#dc2626' : '#16a34a';
    ctx.lineWidth = Math.max(2, W / 400);
    ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);
    if (inf) {
      const texto = `ID ${k.track_id}: sin ${inf.faltantes.join(', ')}`;
      const tw = ctx.measureText(texto).width + 10;
      ctx.fillStyle = '#dc2626';
      ctx.fillRect(x1, Math.max(0, y1 - fuente - 8), tw, fuente + 8);
      ctx.fillStyle = '#fff';
      ctx.fillText(texto, x1 + 5, Math.max(fuente, y1 - 6));
    }
  });
  const banda = fuente + 12;
  ctx.fillStyle = 'rgba(0,0,0,0.75)';
  ctx.fillRect(0, H - banda, W, banda);
  ctx.fillStyle = '#fff';
  ctx.fillText(
    `${cfg.camara_id} | ${cfg.area || '-'} | ${new Date().toLocaleString('es-PE')} | NO CONFORME`,
    8,
    H - 8,
  );
  return c.toDataURL('image/jpeg', 0.85);
}

/**
 * Corre la IA en el propio celular: onnxruntime-web en un Web Worker + tracker + reglas,
 * y guarda los eventos en Supabase/Drive. No necesita servidor.
 *
 * Devuelve { estado: 'inactivo'|'cargando'|'listo'|'error', error, pendientes, hilos }.
 */
export function useMotorLocal({ activo, config, videoRef, fpsMax, onResultado, onInfo }) {
  const [fase, setFase] = useState(null); // null (cargando) | 'listo' | 'error'
  const [error, setError] = useState('');
  const [pendientes, setPendientes] = useState(0);
  const [hilos, setHilos] = useState(1);
  const configRef = useRef(config);
  const fpsRef = useRef(fpsMax);
  const onResultadoRef = useRef(onResultado);
  const onInfoRef = useRef(onInfo);

  useEffect(() => {
    configRef.current = config;
    fpsRef.current = Number(fpsMax) || 4;
    onResultadoRef.current = onResultado;
    onInfoRef.current = onInfo;
  });

  useEffect(() => {
    if (!activo) return undefined;
    let vivo = true;
    let timer = null;
    let idMsg = 0;
    const pendientesMsg = new Map();
    const worker = new Worker(new URL('./detector.worker.js', import.meta.url), { type: 'module' });
    const persistencia = new Persistencia({ onEstado: (e) => vivo && setPendientes(e.pendientes) });
    const cuadro = document.createElement('canvas');
    const lienzos = new Map(); // tamaño → canvas del letterbox
    let catalogo = null; // contenido de /models/modelos.json
    const cargados = {}; // clave → { etiquetas, tamano } | null
    let proc = null;
    let claveProc = '';
    let ultimoFrame = 0;
    let ultimoFlush = performance.now();

    worker.onmessage = (e) => {
      const r = pendientesMsg.get(e.data.id);
      if (!r) return;
      pendientesMsg.delete(e.data.id);
      if (e.data.tipo === 'error') r.reject(new Error(e.data.mensaje));
      else r.resolve(e.data);
    };
    worker.onerror = (e) => {
      if (!vivo) return;
      setFase('error');
      setError(`No se pudo iniciar la IA en este navegador: ${e.message || 'error del worker'}`);
    };
    const pedir = (msg, transfer = []) =>
      new Promise((resolve, reject) => {
        const id = ++idMsg;
        pendientesMsg.set(id, { resolve, reject });
        worker.postMessage({ ...msg, id }, transfer);
      });

    const asegurarModelos = async (claves) => {
      const faltan = claves.filter((k) => !(k in cargados));
      if (!faltan.length) return;
      const modelos = {};
      faltan.forEach((k) => {
        modelos[k] = catalogo?.[k]?.url ? { url: catalogo[k].url, tamano: catalogo[k].tamano || 416 } : null;
      });
      const r = await pedir({ tipo: 'cargar', modelos });
      setHilos(r.hilos || 1);
      faltan.forEach((k) => {
        cargados[k] = r.disponibles[k]
          ? { etiquetas: etiquetasDe(catalogo[k].etiquetas), tamano: catalogo[k].tamano || 416 }
          : null;
        if (r.errores?.[k]) console.warn(`[vision] modelo "${k}" no disponible:`, r.errores[k]);
      });
      if (!cargados.general) throw new Error(`No se pudo cargar el modelo general (${r.errores?.general || 'sin URL'})`);
    };

    const enviarConteos = (p) => {
      if (!p?.popPendiente) return;
      const conteos = p.popPendiente();
      if (Object.keys(conteos).length) {
        const c = p.cfg;
        persistencia.sumarConteos({ camaraId: c.camara_id, area: c.area, conteos });
      }
    };

    const prepararProcesador = async () => {
      const cfg = configRef.current;
      const clave = JSON.stringify(cfg);
      if (proc && clave === claveProc) return;
      enviarConteos(proc);
      // general siempre; el del módulo (epp / conteo) si existe
      await asegurarModelos(cfg.modulo === 'aforo' ? ['general'] : ['general', cfg.modulo]);
      proc = crearProcesador(cfg, cargados);
      claveProc = clave;
      onInfoRef.current?.({ advertencias: proc.advertencias });
    };

    const letterbox = (tamano) => {
      if (!lienzos.has(tamano)) {
        const c = document.createElement('canvas');
        c.width = tamano;
        c.height = tamano;
        lienzos.set(tamano, c);
      }
      const c = lienzos.get(tamano);
      const ctx = c.getContext('2d', { willReadFrequently: true });
      const r = Math.min(tamano / cuadro.width, tamano / cuadro.height);
      ctx.fillStyle = 'rgb(114,114,114)';
      ctx.fillRect(0, 0, tamano, tamano);
      ctx.drawImage(cuadro, 0, 0, Math.round(cuadro.width * r), Math.round(cuadro.height * r));
      return { pixeles: ctx.getImageData(0, 0, tamano, tamano).data, escala: r };
    };

    const ciclo = async () => {
      if (!vivo) return;
      const video = videoRef.current;
      const ahora = performance.now();
      const intervalo = 1000 / fpsRef.current;
      const listo = video && video.readyState >= 2 && video.videoWidth && document.visibilityState === 'visible';
      if (listo && ahora - ultimoFrame >= intervalo) {
        ultimoFrame = ahora;
        try {
          await prepararProcesador();
          // 1) Capturar el frame una sola vez (es también la foto de evidencia)
          const esc = Math.min(1, LADO_CUADRO / Math.max(video.videoWidth, video.videoHeight));
          cuadro.width = Math.round(video.videoWidth * esc);
          cuadro.height = Math.round(video.videoHeight * esc);
          cuadro.getContext('2d').drawImage(video, 0, 0, cuadro.width, cuadro.height);
          // 2) Detectar con cada modelo que necesita el módulo
          const dets = {};
          let ms = 0;
          for (const clave of proc.modelos) {
            const m = cargados[clave];
            if (!m) continue;
            const { pixeles, escala } = letterbox(m.tamano);
            const r = await pedir(
              { tipo: 'detectar', modelo: clave, pixeles, escala, ancho: cuadro.width, alto: cuadro.height, umbral: UMBRAL },
              [pixeles.buffer],
            );
            dets[clave] = r.dets;
            ms += r.ms;
          }
          if (!vivo) return;
          // 3) Reglas del módulo
          const t = performance.now();
          const res = proc.procesar(dets, t);
          setFase('listo');
          // 4) Guardar eventos
          const cfg = proc.cfg;
          res.eventos.forEach((ev) => {
            if (ev.evento === 'aforo') {
              persistencia.guardarAforo({ camaraId: cfg.camara_id, area: cfg.area, tipo: ev.tipo, delta: ev.delta, trackId: ev.track_id });
            } else if (ev.evento === 'epp_infraccion') {
              const imagen = fotoEvidencia(cuadro, ev.cajasEvidencia, ev.infractores, cfg);
              const fecha = sello(new Date());
              ev.infractores.forEach((inf) => {
                persistencia.guardarEpp({
                  imagen,
                  nombre: `epp_${cfg.camara_id}_${fecha}_t${inf.track_id}.jpg`,
                  fila: {
                    hora: new Date().toISOString(), camara_id: cfg.camara_id, area: cfg.area, track_id: inf.track_id,
                    estado: 'No Conforme', epp_faltantes: inf.faltantes, segundos_sin_epp: inf.segundos,
                  },
                });
              });
            }
          });
          if (t - ultimoFlush >= CONTEO_FLUSH_MS) {
            ultimoFlush = t;
            enviarConteos(proc);
          }
          // Para la pantalla: los eventos con el mismo formato que manda el servidor
          const eventosUi = res.eventos.flatMap((ev) =>
            ev.evento === 'epp_infraccion'
              ? ev.infractores.map((i) => ({ evento: ev.evento, track_id: i.track_id, epp_faltantes: i.faltantes }))
              : [ev],
          );
          onResultadoRef.current?.({ cajas: res.cajas, resumen: res.resumen, eventos: eventosUi, ms });
        } catch (err) {
          if (!vivo) return;
          setFase('error');
          setError(err.message || String(err));
          return; // detiene el ciclo; se reintenta al volver a iniciar la cámara
        }
      }
      if (vivo) timer = setTimeout(ciclo, 15);
    };

    fetch('/models/modelos.json', { cache: 'no-cache' })
      .then((r) => r.json())
      .then((json) => {
        catalogo = json;
        if (vivo) ciclo();
      })
      .catch((err) => {
        if (!vivo) return;
        setFase('error');
        setError(`No se encontró /models/modelos.json (${err.message})`);
      });

    return () => {
      vivo = false;
      clearTimeout(timer);
      enviarConteos(proc); // lo contado hasta ahora no se pierde al detener
      worker.terminate();
      pendientesMsg.forEach((r) => r.reject(new Error('detenido')));
      // La cola de filas queda en localStorage; las fotos en vuelo terminan solas
      setTimeout(() => persistencia.reintentar().finally(() => persistencia.cerrar()), 0);
      setFase(null);
      setError('');
    };
  }, [activo, videoRef]);

  return {
    estado: !activo ? 'inactivo' : fase === 'listo' ? 'listo' : fase === 'error' ? 'error' : 'cargando',
    error,
    pendientes,
    hilos,
  };
}
