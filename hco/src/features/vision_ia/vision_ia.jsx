import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  FaBoxOpen,
  FaChartBar,
  FaCog,
  FaDrawPolygon,
  FaExchangeAlt,
  FaHardHat,
  FaPen,
  FaStop,
  FaTimes,
  FaUsers,
  FaVideo,
} from 'react-icons/fa';
import { obtenerTokenSesion } from '../../services/visionService';
import { useVisionSocket } from './useVisionSocket';
import { useMotorLocal } from './motor/useMotorLocal';
import { dibujarOverlay, puntoNormalizado } from './overlay';
import PanelVision from './PanelVision';
import './vision_ia.css';

// Motor "servidor" (opcional, a futuro): wss://<host>/ws del backend vision-backend/.
// Sin esta variable la IA corre siempre en el celular (gratis).
const WS_URL = (import.meta.env.VITE_VISION_WS_URL || '').trim();
const WAKE_LOCK_SOPORTADO = typeof navigator !== 'undefined' && 'wakeLock' in navigator;
const CONFIG_KEY = 'vision-ia-config-v1';

// Los mismos 3 módulos de la sección "Inteligencia Artificial" del Menú
const MODULOS = [
  { key: 'epp', titulo: 'EPP', desc: 'Detección de EPPs: casco, chaleco, gafas y guantes', Icon: FaHardHat },
  { key: 'conteo', titulo: 'Objetos', desc: 'Detección de objetos industriales: conteo por tipo', Icon: FaBoxOpen },
  { key: 'aforo', titulo: 'Personal', desc: 'Conteo de personal: ingresos, salidas y aforo', Icon: FaUsers },
];
const EPP_OPCIONES = ['casco', 'chaleco', 'gafas', 'guantes'];

const ESTADO_WS = {
  inactivo: 'Detenido',
  despertando: 'Despertando servidor…',
  conectando: 'Conectando…',
  en_vivo: 'IA en vivo',
  reconectando: 'Reconectando…',
  error: 'Error',
};

const ESTADO_LOCAL = {
  inactivo: 'Detenido',
  cargando: 'Cargando IA…',
  listo: 'IA en el celular',
  error: 'Error',
};

const CONFIG_INICIAL = {
  // motor: 'local' (IA en el celular, gratis) | 'servidor' (requiere VITE_VISION_WS_URL)
  comun: { camaraId: 'camara-1', area: '', fpsMax: 4, motor: 'local' },
  epp: { eppRequeridos: ['casco', 'chaleco'] },
  conteo: { linea: [[0.5, 0.1], [0.5, 0.9]], zona: [], modoConteo: 'linea', sentido: 'in', clases: 'botella', invertir: false },
  aforo: { linea: [[0.05, 0.6], [0.95, 0.6]], invertir: false },
};

const leerConfig = () => {
  try {
    const guardada = JSON.parse(localStorage.getItem(CONFIG_KEY) || '{}');
    const cfg = {};
    Object.keys(CONFIG_INICIAL).forEach((k) => {
      cfg[k] = { ...CONFIG_INICIAL[k], ...(guardada[k] || {}) };
    });
    return cfg;
  } catch {
    return CONFIG_INICIAL;
  }
};

/** Configuración que se manda al backend (formato del protocolo en main.py). */
function configServidor(modulo, cfg) {
  const m = cfg[modulo];
  return {
    modulo,
    camara_id: cfg.comun.camaraId.trim() || 'camara-1',
    area: cfg.comun.area.trim() || null,
    fps: Number(cfg.comun.fpsMax) || 4,
    linea: m.linea || null,
    invertir: Boolean(m.invertir),
    ...(modulo === 'epp' ? { epp_requeridos: m.eppRequeridos } : {}),
    ...(modulo === 'conteo'
      ? {
          zona: m.modoConteo === 'zona' ? m.zona : [],
          modo_conteo: m.modoConteo,
          sentido: m.sentido,
          clases_conteo: m.clases.split(',').map((c) => c.trim().toLowerCase()).filter(Boolean),
        }
      : {}),
  };
}

const mensajeCamara = (err) => {
  if (err?.name === 'NotAllowedError') return 'Permiso de cámara denegado. Actívalo en los ajustes del navegador.';
  if (err?.name === 'NotFoundError') return 'No se encontró una cámara en este dispositivo.';
  if (err?.name === 'NotReadableError') return 'La cámara está siendo usada por otra aplicación.';
  return `No se pudo abrir la cámara: ${err?.message || err}`;
};

const textoEvento = (ev) => {
  if (ev.evento === 'epp_infraccion') return { tipo: 'rojo', texto: `No Conforme #${ev.track_id}: sin ${(ev.epp_faltantes || []).join(', ')}` };
  if (ev.evento === 'aforo') return { tipo: ev.tipo === 'INGRESO' ? 'verde' : 'naranja', texto: `${ev.tipo} #${ev.track_id}` };
  return { tipo: 'azul', texto: ev.evento };
};

export default function VisionIA() {
  const [params, setParams] = useSearchParams();
  const modulo = MODULOS.some((m) => m.key === params.get('modulo')) ? params.get('modulo') : 'epp';

  const [cfg, setCfg] = useState(leerConfig);
  const [vista, setVista] = useState('camara'); // en celular: 'camara' | 'panel'
  const [verAjustes, setVerAjustes] = useState(false);
  const [camaraActiva, setCamaraActiva] = useState(false);
  const [camError, setCamError] = useState('');
  const [wakeActivo, setWakeActivo] = useState(false);
  const [stats, setStats] = useState({ fps: 0, rtt: 0, ms: 0, degradado: false });
  const [resumen, setResumen] = useState(null);
  const [avisos, setAvisos] = useState([]);
  const [toasts, setToasts] = useState([]);
  const [dibujo, setDibujo] = useState(null); // { tipo: 'linea' | 'zona', puntos: [] }

  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const resultadoRef = useRef(null);
  const escenaRef = useRef({});
  const envioRef = useRef({ enVuelo: false, enviadoEn: 0, ultimoEnvio: 0, frameId: 0, idEnVuelo: -1, rttEma: 0, degradado: false, marcas: [], ultimoStats: 0 });

  const cfgModulo = cfg[modulo];
  const usarServidor = Boolean(WS_URL) && cfg.comun.motor === 'servidor';
  const servidorCfg = useMemo(() => configServidor(modulo, cfg), [modulo, cfg]);
  const servidorCfgRef = useRef(servidorCfg);
  const fpsMaxRef = useRef(cfg.comun.fpsMax);

  useEffect(() => {
    servidorCfgRef.current = servidorCfg;
    fpsMaxRef.current = Number(cfg.comun.fpsMax) || 4;
    try {
      localStorage.setItem(CONFIG_KEY, JSON.stringify(cfg));
    } catch {
      // almacenamiento no disponible (modo privado): la configuración dura solo esta sesión
    }
  }, [servidorCfg, cfg]);

  const actualizar = (seccion, cambios) => setCfg((prev) => ({ ...prev, [seccion]: { ...prev[seccion], ...cambios } }));

  // ------------------------------------------------------------------ overlay
  const redibujar = useCallback(() => {
    dibujarOverlay(canvasRef.current, videoRef.current, {
      ...escenaRef.current,
      cajas: resultadoRef.current?.cajas || [],
    });
  }, []);

  useEffect(() => {
    escenaRef.current = {
      linea: cfgModulo.linea,
      zona: cfgModulo.zona,
      invertir: cfgModulo.invertir,
      mostrarZona: modulo === 'conteo' && cfgModulo.modoConteo === 'zona',
      etiquetas: modulo === 'aforo' ? ['INGRESO', 'SALIDA'] : ['ENTRA', 'SALE'],
      puntosTemp: dibujo?.puntos || [],
    };
    redibujar();
  }, [cfgModulo, modulo, dibujo, redibujar]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(() => redibujar());
    ro.observe(canvas);
    return () => ro.disconnect();
  }, [redibujar]);

  // ------------------------------------------------------------------ WebSocket
  const crearHello = useCallback(async () => {
    const token = await obtenerTokenSesion();
    if (!token) throw new Error('Tu sesión venció. Vuelve a iniciar sesión.');
    return { type: 'hello', token, config: servidorCfgRef.current };
  }, []);

  const agregarToasts = useCallback((eventos) => {
    const nuevos = eventos.map((ev) => ({ id: `${Date.now()}-${Math.random()}`, ...textoEvento(ev) }));
    setToasts((prev) => [...nuevos, ...prev].slice(0, 4));
    nuevos.forEach((t) => setTimeout(() => setToasts((prev) => prev.filter((x) => x.id !== t.id)), 6000));
  }, []);

  // Muestra un resultado (venga del celular o del servidor): overlay, estadísticas y avisos
  const mostrarResultado = useCallback((res) => {
    const st = envioRef.current;
    const ahora = performance.now();
    st.marcas = [...st.marcas.filter((t) => ahora - t < 3000), ahora];
    resultadoRef.current = res;
    redibujar();
    if (ahora - st.ultimoStats > 500) {
      st.ultimoStats = ahora;
      setStats({ fps: st.marcas.length / 3, rtt: Math.round(st.rttEma), ms: res.ms || 0, degradado: st.degradado });
      setResumen(res.resumen || null);
    }
    if (res.eventos?.length) agregarToasts(res.eventos);
  }, [redibujar, agregarToasts]);

  const onMensaje = useCallback((msg) => {
    if (msg.type === 'ready') {
      setAvisos(msg.info?.advertencias || []);
      return;
    }
    if (msg.type !== 'result') return;
    const st = envioRef.current;
    const ahora = performance.now();
    if (msg.frame_id === st.idEnVuelo) {
      st.enVuelo = false;
      const rtt = ahora - st.enviadoEn;
      st.rttEma = st.rttEma ? st.rttEma * 0.8 + rtt * 0.2 : rtt;
      // FPS/calidad adaptativos: con red lenta se baja a 480 px y calidad 0,5
      if (st.rttEma > 1500) st.degradado = true;
      else if (st.rttEma < 600) st.degradado = false;
    }
    mostrarResultado(msg);
  }, [mostrarResultado]);

  const { estado: wsEstado, error: wsError, enviarBinario, enviarJSON } = useVisionSocket({
    url: WS_URL,
    activo: camaraActiva && usarServidor,
    crearHello,
    onMensaje,
  });

  const onInfoLocal = useCallback((info) => setAvisos(info.advertencias || []), []);
  const motorLocal = useMotorLocal({
    activo: camaraActiva && !usarServidor,
    config: servidorCfg,
    videoRef,
    fpsMax: cfg.comun.fpsMax,
    onResultado: mostrarResultado,
    onInfo: onInfoLocal,
  });
  const estadoMotor = usarServidor ? wsEstado : motorLocal.estado;
  const textoEstado = usarServidor ? ESTADO_WS[wsEstado] : ESTADO_LOCAL[motorLocal.estado];
  const errorMotor = usarServidor ? wsError : motorLocal.error;

  // Cambios de configuración en caliente (el hello ya llevó la configuración inicial)
  const cfgEnviadaRef = useRef('');
  useEffect(() => {
    if (wsEstado !== 'en_vivo') {
      cfgEnviadaRef.current = '';
      return;
    }
    const texto = JSON.stringify(servidorCfg);
    if (!cfgEnviadaRef.current) {
      cfgEnviadaRef.current = texto;
      return;
    }
    if (texto !== cfgEnviadaRef.current) {
      cfgEnviadaRef.current = texto;
      resultadoRef.current = null;
      enviarJSON({ type: 'config', config: servidorCfg });
    }
  }, [wsEstado, servidorCfg, enviarJSON]);

  // ------------------------------------------------------------------ envío de frames
  useEffect(() => {
    if (!camaraActiva || wsEstado !== 'en_vivo') return undefined;
    let vivo = true;
    let timer = null;
    const lienzo = document.createElement('canvas');
    const st = envioRef.current;
    st.enVuelo = false;

    const ciclo = async () => {
      if (!vivo) return;
      const video = videoRef.current;
      const ahora = performance.now();
      if (st.enVuelo && ahora - st.enviadoEn > 6000) st.enVuelo = false; // respuesta perdida
      const listo = video && video.readyState >= 2 && video.videoWidth && document.visibilityState === 'visible';
      if (listo && !st.enVuelo && ahora - st.ultimoEnvio >= 1000 / fpsMaxRef.current) {
        const lado = st.degradado ? 480 : 640;
        const calidad = st.degradado ? 0.5 : 0.6;
        const esc = Math.min(1, lado / Math.max(video.videoWidth, video.videoHeight));
        lienzo.width = Math.round(video.videoWidth * esc);
        lienzo.height = Math.round(video.videoHeight * esc);
        lienzo.getContext('2d').drawImage(video, 0, 0, lienzo.width, lienzo.height);
        st.enVuelo = true;
        st.ultimoEnvio = ahora;
        const blob = await new Promise((r) => lienzo.toBlob(r, 'image/jpeg', calidad));
        if (vivo && blob) {
          const jpg = new Uint8Array(await blob.arrayBuffer());
          const buf = new Uint8Array(4 + jpg.byteLength);
          st.frameId = (st.frameId + 1) >>> 0;
          new DataView(buf.buffer).setUint32(0, st.frameId); // 4 bytes big-endian = frame_id
          buf.set(jpg, 4);
          st.idEnVuelo = st.frameId;
          st.enviadoEn = performance.now();
          if (!enviarBinario(buf.buffer)) st.enVuelo = false;
        } else {
          st.enVuelo = false;
        }
      }
      if (vivo) timer = setTimeout(ciclo, 40);
    };
    timer = setTimeout(ciclo, 0);
    return () => {
      vivo = false;
      clearTimeout(timer);
    };
  }, [camaraActiva, wsEstado, enviarBinario]);

  // ------------------------------------------------------------------ Wake Lock
  useEffect(() => {
    if (!camaraActiva || !WAKE_LOCK_SOPORTADO) return undefined;
    let vivo = true;
    let lock = null;
    const pedir = async () => {
      if (document.visibilityState !== 'visible') return;
      try {
        const nuevo = await navigator.wakeLock.request('screen');
        if (!vivo) {
          nuevo.release().catch(() => {});
          return;
        }
        lock = nuevo;
        setWakeActivo(true);
        // El sistema lo libera al cambiar de pestaña o con batería baja
        nuevo.addEventListener('release', () => vivo && setWakeActivo(false));
      } catch {
        if (vivo) setWakeActivo(false);
      }
    };
    const alCambiarVisibilidad = () => {
      if (document.visibilityState === 'visible') pedir();
    };
    pedir();
    document.addEventListener('visibilitychange', alCambiarVisibilidad);
    return () => {
      vivo = false;
      document.removeEventListener('visibilitychange', alCambiarVisibilidad);
      lock?.release().catch(() => {});
    };
  }, [camaraActiva]);

  // ------------------------------------------------------------------ cámara
  const detenerCamara = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    resultadoRef.current = null;
    setCamaraActiva(false);
    setWakeActivo(false);
    setResumen(null);
    redibujar();
  }, [redibujar]);

  useEffect(() => () => streamRef.current?.getTracks().forEach((t) => t.stop()), []);

  const iniciarCamara = async () => {
    setCamError('');
    if (!navigator.mediaDevices?.getUserMedia) {
      setCamError('Este navegador no permite usar la cámara (se necesita HTTPS).');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 15, max: 30 } },
      });
      streamRef.current = stream;
      const video = videoRef.current;
      video.srcObject = stream;
      await video.play().catch(() => {});
      setCamaraActiva(true);
    } catch (err) {
      setCamError(mensajeCamara(err));
    }
  };

  // ------------------------------------------------------------------ dibujo de línea / zona
  const alTocarCanvas = (e) => {
    if (!dibujo) return;
    const p = puntoNormalizado(e, canvasRef.current, videoRef.current);
    if (!p) return;
    const puntos = [...dibujo.puntos, p];
    const necesarios = dibujo.tipo === 'linea' ? 2 : 4;
    if (puntos.length < necesarios) {
      setDibujo({ ...dibujo, puntos });
      return;
    }
    if (dibujo.tipo === 'linea') actualizar(modulo, { linea: puntos, ...(modulo === 'conteo' ? { modoConteo: 'linea' } : {}) });
    else actualizar('conteo', { zona: puntos, modoConteo: 'zona' });
    setDibujo(null);
  };

  const cambiarModulo = (key) => {
    setDibujo(null);
    setResumen(null);
    resultadoRef.current = null;
    setParams({ modulo: key }, { replace: true });
  };

  const usaLinea = modulo === 'aforo' || modulo === 'conteo';
  const infoModulo = MODULOS.find((m) => m.key === modulo);

  return (
    <div className="via">
      <header className="via-header">
        <div>
          <h1 className="via-title">Visión Artificial</h1>
          <p className="via-sub">{infoModulo.desc}</p>
        </div>
        <div className="via-estados">
          <span className={`via-chip via-ws-${estadoMotor}`}>{textoEstado}</span>
          {camaraActiva && (
            <span className={`via-chip ${wakeActivo ? 'via-chip-ok' : 'via-chip-warn'}`} title="Screen Wake Lock">
              {WAKE_LOCK_SOPORTADO ? (wakeActivo ? 'Pantalla activa' : 'Pantalla puede apagarse') : 'Wake Lock no soportado'}
            </span>
          )}
        </div>
      </header>

      {/* Selector de los 4 módulos */}
      <nav className="via-modulos" aria-label="Módulos">
        {MODULOS.map(({ key, titulo, Icon }) => (
          <button
            key={key}
            type="button"
            className={`via-modulo ${modulo === key ? 'activo' : ''}`}
            onClick={() => cambiarModulo(key)}
            aria-pressed={modulo === key}
          >
            <Icon />
            <span>{titulo}</span>
          </button>
        ))}
      </nav>

      <div className="via-tabs">
        <button type="button" className={vista === 'camara' ? 'activo' : ''} onClick={() => setVista('camara')}><FaVideo /> Cámara</button>
        <button type="button" className={vista === 'panel' ? 'activo' : ''} onClick={() => setVista('panel')}><FaChartBar /> Panel en vivo</button>
      </div>

      <div className="via-layout">
        {/* ---------------------------------------------------------------- Cámara */}
        <section className={`via-col via-col-camara ${vista === 'camara' ? '' : 'via-oculto-movil'}`}>
          <div className={`via-visor ${dibujo ? 'dibujando' : ''}`}>
            <video ref={videoRef} className="via-video" playsInline muted />
            <canvas ref={canvasRef} className="via-canvas" onClick={alTocarCanvas} />
            {!camaraActiva && (
              <div className="via-visor-vacio">
                <FaVideo />
                <span>Cámara detenida</span>
              </div>
            )}
            {dibujo && (
              <div className="via-visor-aviso">
                {dibujo.tipo === 'linea' ? 'Toca 2 puntos para la línea' : 'Toca 4 esquinas de la zona'} ({dibujo.puntos.length})
                <button type="button" onClick={() => setDibujo(null)} aria-label="Cancelar"><FaTimes /></button>
              </div>
            )}
            <div className="via-toasts">
              {toasts.map((t) => <div key={t.id} className={`via-toast via-toast-${t.tipo}`}>{t.texto}</div>)}
            </div>
          </div>

          <div className="via-controles">
            {!camaraActiva ? (
              <button type="button" className="via-btn via-btn-primario" onClick={iniciarCamara}><FaVideo /> Iniciar cámara</button>
            ) : (
              <button type="button" className="via-btn via-btn-peligro" onClick={detenerCamara}><FaStop /> Detener</button>
            )}
            {usaLinea && (
              <button type="button" className="via-btn via-btn-ghost" onClick={() => setDibujo({ tipo: 'linea', puntos: [] })}>
                <FaPen /> Línea
              </button>
            )}
            {modulo === 'conteo' && (
              <button type="button" className="via-btn via-btn-ghost" onClick={() => setDibujo({ tipo: 'zona', puntos: [] })}>
                <FaDrawPolygon /> Zona
              </button>
            )}
            {usaLinea && cfgModulo.linea && (
              <button type="button" className="via-btn via-btn-ghost" onClick={() => actualizar(modulo, { invertir: !cfgModulo.invertir })} title="Intercambiar entrada y salida">
                <FaExchangeAlt /> Invertir
              </button>
            )}
            <button type="button" className={`via-btn via-btn-ghost ${verAjustes ? 'activo' : ''}`} onClick={() => setVerAjustes((v) => !v)}>
              <FaCog /> Ajustes
            </button>
          </div>

          {camError && <div className="via-alerta">{camError}</div>}
          {errorMotor && camaraActiva && <div className="via-alerta">{errorMotor}</div>}
          {!usarServidor && motorLocal.estado === 'cargando' && (
            <div className="via-info">Cargando el modelo de IA (la primera vez descarga ~5 MB; luego queda guardado).</div>
          )}
          {!usarServidor && motorLocal.pendientes > 0 && (
            <div className="via-aviso">
              {motorLocal.pausado
                ? `${motorLocal.pendientes} evento(s) en espera: Supabase rechazó el guardado por permisos. Vuelve a iniciar sesión; se enviarán solos.`
                : `${motorLocal.pendientes} evento(s) esperando señal para guardarse.`}
            </div>
          )}
          {usarServidor && wsEstado === 'despertando' && (
            <div className="via-info">El servidor de IA estaba dormido; puede tardar 1–3 minutos en despertar.</div>
          )}
          {avisos.map((a) => <div key={a} className="via-aviso">{a}</div>)}

          {camaraActiva && (
            <div className="via-stats">
              <span>{stats.fps.toFixed(1)} FPS</span>
              {usarServidor ? <span>Ida y vuelta {stats.rtt} ms</span> : <span>En el celular · {motorLocal.hilos} hilo(s)</span>}
              <span>IA {stats.ms} ms</span>
              {stats.degradado && <span className="via-warn">Red lenta: calidad reducida</span>}
            </div>
          )}

          {resumen && <Resumen modulo={modulo} resumen={resumen} />}

          {verAjustes && (
            <div className="via-ajustes">
              <label className="via-campo">
                <span>Cámara (ID)</span>
                <input className="via-input" value={cfg.comun.camaraId} maxLength={60} onChange={(e) => actualizar('comun', { camaraId: e.target.value })} />
              </label>
              <label className="via-campo">
                <span>Área</span>
                <input className="via-input" value={cfg.comun.area} maxLength={60} placeholder="Ej. Almacén 1" onChange={(e) => actualizar('comun', { area: e.target.value })} />
              </label>
              <label className="via-campo">
                <span>FPS máximo</span>
                <select className="via-input" value={cfg.comun.fpsMax} onChange={(e) => actualizar('comun', { fpsMax: Number(e.target.value) })}>
                  {[1, 2, 3, 4, 5, 8].map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              </label>
              {WS_URL && (
                <label className="via-campo">
                  <span>Dónde corre la IA</span>
                  <select className="via-input" value={cfg.comun.motor} disabled={camaraActiva} onChange={(e) => actualizar('comun', { motor: e.target.value })}>
                    <option value="local">En el celular (gratis)</option>
                    <option value="servidor">En el servidor</option>
                  </select>
                </label>
              )}

              {modulo === 'epp' && (
                <fieldset className="via-campo">
                  <span>EPP obligatorio</span>
                  <div className="via-checks">
                    {EPP_OPCIONES.map((e) => (
                      <label key={e}>
                        <input
                          type="checkbox"
                          checked={cfgModulo.eppRequeridos.includes(e)}
                          onChange={(ev) =>
                            actualizar('epp', {
                              eppRequeridos: ev.target.checked
                                ? [...cfgModulo.eppRequeridos, e]
                                : cfgModulo.eppRequeridos.filter((x) => x !== e),
                            })
                          }
                        />
                        {e}
                      </label>
                    ))}
                  </div>
                </fieldset>
              )}

              {modulo === 'conteo' && (
                <>
                  <label className="via-campo">
                    <span>Clases a contar (separadas por coma)</span>
                    <input className="via-input" value={cfgModulo.clases} onChange={(e) => actualizar('conteo', { clases: e.target.value })} />
                  </label>
                  <label className="via-campo">
                    <span>Contar al cruzar la línea</span>
                    <select className="via-input" value={cfgModulo.sentido} onChange={(e) => actualizar('conteo', { sentido: e.target.value })}>
                      <option value="in">Solo en el sentido de la flecha</option>
                      <option value="out">Solo en sentido contrario</option>
                      <option value="ambos">En ambos sentidos</option>
                    </select>
                  </label>
                  <label className="via-campo">
                    <span>Modo</span>
                    <select className="via-input" value={cfgModulo.modoConteo} onChange={(e) => actualizar('conteo', { modoConteo: e.target.value })}>
                      <option value="linea">Línea de conteo</option>
                      <option value="zona" disabled={(cfgModulo.zona || []).length < 3}>Zona (dibuja primero la zona)</option>
                    </select>
                  </label>
                </>
              )}
            </div>
          )}
        </section>

        {/* ---------------------------------------------------------------- Panel */}
        <section className={`via-col via-col-panel ${vista === 'panel' ? '' : 'via-oculto-movil'}`}>
          <h2 className="via-h2">Panel en vivo · {infoModulo.titulo}</h2>
          <PanelVision key={modulo} modulo={modulo} area={cfg.comun.area.trim()} camaraId={cfg.comun.camaraId.trim()} />
        </section>
      </div>
    </div>
  );
}

function Resumen({ modulo, resumen }) {
  if (modulo === 'epp') {
    return (
      <div className="via-resumen">
        <div><b>{resumen.personas ?? 0}</b><span>Personas</span></div>
        <div className="via-rojo"><b>{resumen.no_conformes ?? 0}</b><span>Sin EPP</span></div>
      </div>
    );
  }
  if (modulo === 'conteo') {
    const totales = Object.entries(resumen.totales || {});
    return (
      <div className="via-resumen">
        {totales.length ? totales.map(([c, n]) => <div key={c}><b>{n}</b><span>{c} (sesión)</span></div>) : <div><b>0</b><span>Contados</span></div>}
      </div>
    );
  }
  return (
    <div className="via-resumen">
      <div className="via-verde"><b>{resumen.ingresos ?? 0}</b><span>Ingresos (sesión)</span></div>
      <div className="via-naranja"><b>{resumen.salidas ?? 0}</b><span>Salidas (sesión)</span></div>
      <div><b>{resumen.en_cuadro ?? 0}</b><span>En cuadro</span></div>
    </div>
  );
}
