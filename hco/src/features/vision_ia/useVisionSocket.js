import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Conexión WebSocket con el backend de IA (Hugging Face Space), con:
 *  - "despertar" previo: GET /health (un Space dormido tarda 1–3 min en arrancar);
 *  - reconexión con backoff exponencial + jitter (1 s → 30 s);
 *  - reintento inmediato al volver la red (`online`) o la pestaña (`visibilitychange`);
 *  - hello con la sesión de Supabase y la configuración de la cámara en cada (re)conexión.
 *
 * Estados: 'inactivo' | 'despertando' | 'conectando' | 'en_vivo' | 'reconectando' | 'error'
 */
export function useVisionSocket({ url, activo, crearHello, onMensaje }) {
  const [estado, setEstado] = useState('inactivo');
  const [error, setError] = useState('');
  const wsRef = useRef(null);
  const crearHelloRef = useRef(crearHello);
  const onMensajeRef = useRef(onMensaje);

  useEffect(() => {
    crearHelloRef.current = crearHello;
    onMensajeRef.current = onMensaje;
  });

  useEffect(() => {
    if (!activo || !url) return undefined;

    let cerrado = false;
    let intento = 0;
    let timer = null;
    let ws = null;
    let fatal = false;
    const healthUrl = url.replace(/^ws(s?):/, 'http$1:').replace(/\/ws\/?$/, '/health');

    const programar = (nuevoEstado) => {
      if (cerrado) return;
      const espera = Math.min(30000, 1000 * 2 ** intento) * (0.7 + Math.random() * 0.6);
      intento += 1;
      setEstado(nuevoEstado);
      clearTimeout(timer);
      timer = setTimeout(conectar, espera);
    };

    const conectar = async () => {
      if (cerrado) return;
      timer = null;
      setEstado(intento === 0 ? 'conectando' : 'reconectando');

      // 1) Despertar / verificar el servidor. Un Space dormido responde una página HTML, no JSON.
      try {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 10000);
        const res = await fetch(healthUrl, { signal: ctrl.signal, cache: 'no-store' });
        clearTimeout(t);
        const salud = await res.json();
        if (!salud.ok) throw new Error('cargando modelos');
      } catch {
        programar('despertando');
        return;
      }
      if (cerrado) return;

      // 2) Abrir el WebSocket y presentarse
      let hello;
      try {
        hello = await crearHelloRef.current();
      } catch (err) {
        setError(err.message || 'No se pudo preparar la conexión');
        programar('reconectando');
        return;
      }
      if (cerrado) return;

      ws = new WebSocket(url);
      ws.binaryType = 'arraybuffer';
      wsRef.current = ws;

      ws.onopen = () => ws.send(JSON.stringify(hello));
      ws.onmessage = (ev) => {
        if (typeof ev.data !== 'string') return;
        let msg;
        try {
          msg = JSON.parse(ev.data);
        } catch {
          return;
        }
        if (msg.type === 'ready') {
          intento = 0;
          setEstado('en_vivo');
          setError('');
        } else if (msg.type === 'error') {
          setError(msg.mensaje || 'Error del servidor');
          // Una configuración inválida no se arregla reintentando; la sesión vencida sí (se renueva)
          if (msg.codigo === 'config') fatal = true;
        }
        onMensajeRef.current?.(msg);
      };
      ws.onclose = () => {
        if (wsRef.current === ws) wsRef.current = null;
        if (cerrado) return;
        if (fatal) {
          setEstado('error');
          return;
        }
        programar('reconectando');
      };
      ws.onerror = () => {
        // onclose se dispara después; ahí se reprograma
      };
    };

    const alVolver = () => {
      if (cerrado || document.visibilityState !== 'visible' || wsRef.current || !timer) return;
      clearTimeout(timer);
      intento = 0;
      conectar();
    };

    window.addEventListener('online', alVolver);
    document.addEventListener('visibilitychange', alVolver);
    timer = setTimeout(conectar, 0);

    return () => {
      cerrado = true;
      clearTimeout(timer);
      window.removeEventListener('online', alVolver);
      document.removeEventListener('visibilitychange', alVolver);
      if (ws) ws.close(1000, 'fin');
      wsRef.current = null;
      setEstado('inactivo');
    };
  }, [url, activo]);

  /** Envía un frame binario. Devuelve false si no hay conexión o la red está saturada. */
  const enviarBinario = useCallback((buffer) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN || ws.bufferedAmount > 512 * 1024) return false;
    ws.send(buffer);
    return true;
  }, []);

  const enviarJSON = useCallback((obj) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    ws.send(JSON.stringify(obj));
    return true;
  }, []);

  return { estado, error, enviarBinario, enviarJSON };
}
