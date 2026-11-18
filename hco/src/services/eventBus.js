/**
 * Bus de eventos interno de la app (arquitectura basada en eventos en el frontend).
 *
 * Permite que los módulos se avisen entre sí SIN importarse unos a otros:
 *   emitir(EVENTOS.SYNC_COMPLETADO, { synced: 3 })
 *   const quitar = escuchar(EVENTOS.SYNC_COMPLETADO, (datos) => { ... });
 *   quitar(); // al desmontar
 *
 * Los nombres se mantienen compatibles con los CustomEvent que ya existían
 * (ej. 'hco-sync-completed'), así que los listeners antiguos siguen funcionando.
 */

export const EVENTOS = {
  // La cola offline (sync_queue) terminó de subir pendientes
  SYNC_COMPLETADO: 'hco-sync-completed',
  // Llegó un cambio en tiempo real desde Supabase: detalle = { tabla, tipo, nuevo, anterior }
  CAMBIO_REMOTO: 'hco-cambio-remoto',
};

export const emitir = (evento, datos = null) => {
  window.dispatchEvent(new CustomEvent(evento, { detail: datos }));
};

export const escuchar = (evento, manejador) => {
  const envoltorio = (e) => manejador(e.detail);
  window.addEventListener(evento, envoltorio);
  return () => window.removeEventListener(evento, envoltorio);
};
