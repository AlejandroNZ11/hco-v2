import { useEffect, useRef, useState } from 'react';
import { supabase } from '../config/supabaseClient';
import { emitir, EVENTOS } from '../services/eventBus';
import { avisarCanal } from '../services/cacheConsultas';

let contadorCanales = 0;

// ------------------------------------------------------------------------------------------
// Registro de canales COMPARTIDOS: una sola suscripción (y un solo canal en el WebSocket) por
// conjunto de tablas, aunque varios componentes la usen a la vez o React la monte dos veces
// (StrictMode). Cada componente se registra como "oyente"; el canal se cierra con
// supabase.removeChannel cuando se va el último (con una pequeña espera para no cerrar y
// reabrir el canal en remontajes inmediatos).
// ------------------------------------------------------------------------------------------
const canales = new Map(); // claveTablas → entrada
const ESPERA_CIERRE_MS = 1500;

// setAuth una sola vez para todo el cliente (supabase-js lo mantiene al día al renovar token)
let authListo = null;
const prepararAuth = () => {
  authListo ??= (async () => {
    try {
      await supabase.auth.getSession(); // refresca si el token venció
      await supabase.realtime.setAuth();
    } catch (err) {
      authListo = null; // se reintenta en la próxima suscripción
      console.warn('[realtime] No se pudo preparar el token', err);
    }
  })();
  return authListo;
};

// Recarga tras reconectar. Si la app está en segundo plano (iOS/Android suspenden el WebSocket
// cada vez que cambias de app), se espera a que vuelva a estar visible y se hace UNA sola
// recarga, en vez de una por cada micro-reconexión mientras nadie mira la pantalla.
function avisarReconexion(entrada) {
  if (typeof document === 'undefined' || document.visibilityState !== 'hidden') {
    entrada.oyentes.forEach((o) => o.onReconectar());
    return;
  }
  if (entrada.esperandoVisible) return;
  entrada.esperandoVisible = () => {
    if (document.visibilityState === 'hidden') return;
    document.removeEventListener('visibilitychange', entrada.esperandoVisible);
    entrada.esperandoVisible = null;
    if (!entrada.cerrado) entrada.oyentes.forEach((o) => o.onReconectar());
  };
  document.addEventListener('visibilitychange', entrada.esperandoVisible);
}

function abrirCanal(entrada) {
  const { clave, tablas } = entrada;
  prepararAuth().then(() => {
    if (entrada.cerrado) return; // se liberó mientras esperábamos el token
    const canal = supabase.channel(`rt-${tablas.join('-')}-${++contadorCanales}`);
    entrada.canal = canal;

    tablas.forEach((nombreTabla) => {
      canal.on('postgres_changes', { event: '*', schema: 'public', table: nombreTabla }, (payload) => {
        const cambio = {
          tabla: nombreTabla,
          tipo: payload.eventType, // 'INSERT' | 'UPDATE' | 'DELETE'
          nuevo: payload.new && Object.keys(payload.new).length ? payload.new : null,
          anterior: payload.old && Object.keys(payload.old).length ? payload.old : null,
        };
        entrada.oyentes.forEach((o) => {
          // Un error procesando un evento nunca debe tumbar la pantalla (incluye errores async)
          Promise.resolve()
            .then(() => o.onCambio(cambio))
            .catch((err) => console.error(`[realtime:${nombreTabla}] Error procesando evento`, err));
        });
        emitir(EVENTOS.CAMBIO_REMOTO, cambio); // una vez por evento, no una por componente
      });
    });

    canal.subscribe((status, err) => {
      if (entrada.cerrado) return;
      if (status === 'SUBSCRIBED') {
        entrada.estado = 'en_vivo';
        avisarCanal(tablas, true);
        entrada.oyentes.forEach((o) => o.onEstado('en_vivo'));
        if (entrada.huboCaida) {
          entrada.huboCaida = false;
          avisarReconexion(entrada);
        }
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        avisarCanal(tablas, false);
        entrada.huboCaida = true;
        entrada.estado = 'desconectado';
        entrada.oyentes.forEach((o) => o.onEstado('desconectado'));
        console.warn(`[realtime:${clave}] ${status}`, err?.message || err || '');
      }
    });
  });
}

function suscribir(clave, oyente) {
  let entrada = canales.get(clave);
  if (entrada) {
    clearTimeout(entrada.timerCierre);
    entrada.timerCierre = null;
  } else {
    entrada = { clave, tablas: clave.split(','), oyentes: new Set(), estado: 'conectando', huboCaida: false, canal: null, cerrado: false, timerCierre: null };
    canales.set(clave, entrada);
    abrirCanal(entrada);
  }
  entrada.oyentes.add(oyente);
  oyente.onEstado(entrada.estado);

  return () => {
    entrada.oyentes.delete(oyente);
    if (entrada.oyentes.size) return;
    entrada.timerCierre = setTimeout(() => {
      if (entrada.oyentes.size) return;
      entrada.cerrado = true;
      canales.delete(clave);
      avisarCanal(entrada.tablas, false);
      if (entrada.esperandoVisible) document.removeEventListener('visibilitychange', entrada.esperandoVisible);
      if (entrada.canal) supabase.removeChannel(entrada.canal);
    }, ESPERA_CIERRE_MS);
  };
}

/**
 * Se suscribe a los cambios (INSERT / UPDATE / DELETE) de una o varias tablas de Supabase en tiempo real.
 * `tabla` puede ser un string ('prestamos') o un arreglo (['inspecciones', 'equipos']);
 * cada evento trae `cambio.tabla` para saber de cuál vino.
 *
 * - `onCambio({ tipo, nuevo, anterior })` se llama por cada evento. Se guarda en un ref,
 *   así que puedes pasar una función inline sin provocar re-suscripciones.
 * - `onReconectar()` se llama cuando el canal se recupera tras una caída de red
 *   (ahí conviene recargar la lista para no perder eventos ocurridos mientras estaba caído).
 * - Cada evento también se publica en el bus interno como EVENTOS.CAMBIO_REMOTO.
 * - Componentes que escuchan las mismas tablas COMPARTEN un único canal.
 *
 * Devuelve el estado de la conexión: 'conectando' | 'en_vivo' | 'desconectado'.
 */
export function useSupabaseRealtime(tabla, onCambio, { enabled = true, onReconectar } = {}) {
  const [estado, setEstado] = useState('conectando');
  const onCambioRef = useRef(onCambio);
  const onReconectarRef = useRef(onReconectar);

  useEffect(() => {
    onCambioRef.current = onCambio;
    onReconectarRef.current = onReconectar;
  });

  const claveTablas = Array.isArray(tabla) ? tabla.join(',') : (tabla || '');

  useEffect(() => {
    if (!enabled || !claveTablas) return undefined;
    let activo = true; // evita que avisos tardíos pisen el estado tras desmontar
    const quitar = suscribir(claveTablas, {
      onCambio: (cambio) => activo && onCambioRef.current?.(cambio),
      onEstado: (e) => activo && setEstado(e),
      onReconectar: () => activo && onReconectarRef.current?.(),
    });
    return () => {
      activo = false;
      quitar();
    };
  }, [claveTablas, enabled]);

  return estado;
}

/**
 * Aplica un evento de tiempo real a una lista en memoria (estado de React).
 * - INSERT / UPDATE: reemplaza el elemento con la misma clave o lo agrega al inicio.
 * - DELETE: lo quita.
 * `transformar(fila)` permite normalizar/formatear la fila igual que lo hace el servicio.
 */
export function aplicarCambioEnLista(lista, cambio, { clave = 'id', transformar = (f) => f } = {}) {
  const actual = Array.isArray(lista) ? lista : [];

  if (cambio.tipo === 'DELETE') {
    const valor = cambio.anterior?.[clave];
    if (valor === undefined || valor === null) return actual;
    return actual.filter((item) => String(item[clave]) !== String(valor));
  }

  if (!cambio.nuevo) return actual;
  const fila = transformar(cambio.nuevo);
  const valor = fila[clave];
  const indice = actual.findIndex((item) => String(item[clave]) === String(valor));

  if (indice === -1) return [fila, ...actual];
  const copia = actual.slice();
  copia[indice] = fila;
  return copia;
}
