import { useEffect, useRef, useState } from 'react';
import { supabase } from '../config/supabaseClient';
import { emitir, EVENTOS } from '../services/eventBus';

let contadorCanales = 0;

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

    let activo = true; // evita que avisos de un canal ya cerrado (p. ej. StrictMode) pisen el estado
    let huboCaida = false;
    let canal = null;
    const tablas = claveTablas.split(',');

    const iniciar = async () => {
      // Asegura que el canal se una con el token vigente del usuario (refresca si venció).
      // Con un token vencido Supabase rechaza la suscripción y quedaría "Sin tiempo real".
      try {
        await supabase.auth.getSession();
        // Sin argumento: toma el token de la sesión y lo sigue renovando solo
        await supabase.realtime.setAuth();
      } catch (err) {
        console.warn('[realtime] No se pudo preparar el token', err);
      }
      if (!activo) return;

      // Nombre único: dos pantallas abiertas sobre la misma tabla no comparten (ni rompen) el canal
      canal = supabase.channel(`rt-${tablas.join('-')}-${++contadorCanales}`);

      tablas.forEach((nombreTabla) => {
        canal.on('postgres_changes', { event: '*', schema: 'public', table: nombreTabla }, (payload) => {
          if (!activo) return;
          const cambio = {
            tabla: nombreTabla,
            tipo: payload.eventType, // 'INSERT' | 'UPDATE' | 'DELETE'
            nuevo: payload.new && Object.keys(payload.new).length ? payload.new : null,
            anterior: payload.old && Object.keys(payload.old).length ? payload.old : null,
          };
          // Un error procesando un evento nunca debe tumbar la pantalla (incluye errores async)
          Promise.resolve()
            .then(() => onCambioRef.current?.(cambio))
            .catch((err) => console.error(`[realtime:${nombreTabla}] Error procesando evento`, err));
          emitir(EVENTOS.CAMBIO_REMOTO, cambio);
        });
      });

      canal.subscribe((status, err) => {
        if (!activo) return;
        if (status === 'SUBSCRIBED') {
          setEstado('en_vivo');
          if (huboCaida) {
            huboCaida = false;
            onReconectarRef.current?.();
          }
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          huboCaida = true;
          setEstado('desconectado');
          console.warn(`[realtime:${claveTablas}] ${status}`, err?.message || err || '');
        }
      });
    };

    iniciar();

    return () => {
      activo = false;
      if (canal) supabase.removeChannel(canal);
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
