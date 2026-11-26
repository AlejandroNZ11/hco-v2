/**
 * Caché en memoria para consultas a Supabase que cambian poco (catálogos: áreas, cargos,
 * empleados, equipos, conductores…). Vive mientras la pestaña/PWA esté abierta:
 *  - Varias pantallas que piden lo mismo en pocos minutos comparten UNA sola petición.
 *  - Dos llamadas simultáneas (doble montaje, StrictMode) se unen en la misma promesa.
 *  - Un error no se guarda: la próxima llamada vuelve a intentar.
 *
 * Funciona igual en Chrome, Safari (iOS/macOS), Edge y la PWA instalada porque no depende
 * de localStorage ni IndexedDB (que Safari puede vaciar o bloquear).
 */
const valores = new Map(); // clave → { ts, valor }
const enVuelo = new Map(); // clave → Promise

export const MIN = 60 * 1000;

export function consultaCacheada(clave, fn, ttlMs = 5 * MIN) {
  const guardado = valores.get(clave);
  if (guardado && Date.now() - guardado.ts < ttlMs) return Promise.resolve(guardado.valor);
  if (enVuelo.has(clave)) return enVuelo.get(clave);

  const p = Promise.resolve()
    .then(fn)
    .then((valor) => {
      valores.set(clave, { ts: Date.now(), valor });
      return valor;
    })
    .finally(() => enVuelo.delete(clave));
  enVuelo.set(clave, p);
  return p;
}

// Cachés guardadas fuera de memoria (localStorage) que también deben borrarse al invalidar
const limpiezas = []; // { clave, fn }

/** Registra `fn` para que se ejecute cuando se invalide `clave` (o un prefijo de ella). */
export function alInvalidar(clave, fn) {
  limpiezas.push({ clave, fn });
}

/** Borra las entradas cuya clave empieza con `prefijo` (llamar después de crear/editar). */
export function invalidarConsultas(prefijo = '') {
  [...valores.keys()].forEach((k) => {
    if (k.startsWith(prefijo)) valores.delete(k);
  });
  limpiezas.forEach(({ clave, fn }) => {
    if (!clave.startsWith(prefijo)) return;
    try {
      fn();
    } catch {
      // una limpieza que falla no debe romper la escritura que la pidió
    }
  });
}

// ------------------------------------------------------------------------------------------
// "Frescura" de listas grandes que ya se guardan en Dexie (inspecciones, préstamos, sugerencias).
// Si se descargaron hace muy poco (p. ej. al pasar de Tracking a Pizarra), se lee Dexie en vez de
// volver a bajar todo el historial. Realtime mantiene Dexie al día mientras la pantalla esté abierta.
// ------------------------------------------------------------------------------------------
// Regla segura: una tabla solo cuenta como "al día" si (1) se descargó completa hace < 30 min y
// (2) su canal Realtime está EN VIVO y no se cayó ni cerró desde entonces. Cualquier caída,
// cierre del canal o sincronización de pendientes la marca vieja → la próxima carga va a la red.
const descargas = new Map(); // tabla → ts de la última descarga completa
const tablasEnVivo = new Set();
const VIDA_MAX_MS = 30 * MIN;

export const estaFresco = (tabla) =>
  tablasEnVivo.has(tabla) && Date.now() - (descargas.get(tabla) || 0) < VIDA_MAX_MS;
export const marcarFresco = (tabla) => descargas.set(tabla, Date.now());
export const marcarViejo = (tabla) => descargas.delete(tabla);
export const marcarTodoViejo = () => descargas.clear();

/** Lo llama useSupabaseRealtime según el estado del canal. */
export const avisarCanal = (tablas, enVivo) => {
  tablas.forEach((t) => {
    if (enVivo) {
      tablasEnVivo.add(t);
    } else {
      tablasEnVivo.delete(t);
      descargas.delete(t); // pudo perderse algún evento: la próxima carga debe ir a la red
    }
  });
};
