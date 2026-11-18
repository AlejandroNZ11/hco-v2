import { useEffect, useRef, useState } from 'react';
import { supabase } from '../config/supabaseClient';
import { emitir, EVENTOS } from '../services/eventBus';

let contadorCanales = 0;

/**
 * Se suscribe a los cambios (INSERT / UPDATE / DELETE) de una tabla de Supabase en tiempo real.
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

  useEffect(() => {
    if (!enabled || !tabla) return undefined;

    let huboCaida = false;
    // Nombre único: dos pantallas abiertas sobre la misma tabla no comparten (ni rompen) el canal
    const nombreCanal = `rt-${tabla}-${++contadorCanales}`;

    const canal = supabase
      .channel(nombreCanal)
      .on('postgres_changes', { event: '*', schema: 'public', table: tabla }, (payload) => {
        const cambio = {
          tabla,
          tipo: payload.eventType, // 'INSERT' | 'UPDATE' | 'DELETE'
          nuevo: payload.new && Object.keys(payload.new).length ? payload.new : null,
          anterior: payload.old && Object.keys(payload.old).length ? payload.old : null,
        };
        try {
          onCambioRef.current?.(cambio);
        } catch (err) {
          // Un error procesando un evento nunca debe tumbar la pantalla
          console.error(`[realtime:${tabla}] Error procesando evento`, err);
        }
        emitir(EVENTOS.CAMBIO_REMOTO, cambio);
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          setEstado('en_vivo');
          if (huboCaida) {
            huboCaida = false;
            onReconectarRef.current?.();
          }
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          huboCaida = true;
          setEstado('desconectado');
        }
      });

    return () => {
      supabase.removeChannel(canal);
    };
  }, [tabla, enabled]);

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
