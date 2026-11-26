import { supabase } from '../config/supabaseClient';
import { localDb } from './localDb';
import { estaFresco, marcarFresco } from './cacheConsultas';

/**
 * SINCRONIZACIÓN INCREMENTAL (Fase 2: bajar el Egress)
 * ------------------------------------------------------------------------------------------
 * - Primera vez en el dispositivo (o si la marca es muy vieja): descarga la tabla COMPLETA,
 *   paginada de 1000 en 1000 (sin el tope silencioso de 1000 filas de Supabase), y reemplaza
 *   la caché de Dexie (quita lo que ya no existe en el servidor).
 * - Las siguientes veces: solo pide las filas con `updated_at` posterior a la última
 *   sincronización. Normalmente son unas pocas filas, no la tabla entera.
 * - Si el canal en tiempo real sigue EN VIVO desde la última sincronización, no va a la red.
 * - Nunca pisa filas locales con cambios offline sin subir (`esPendiente`).
 * - Si la tabla todavía no tiene `updated_at` (SQL de Fase 2 sin correr), cae a la descarga
 *   completa de siempre: la app sigue funcionando.
 *
 * La marca se guarda en Dexie (`sync_meta`), así sobrevive a recargas y a cerrar la PWA.
 */

const PAGINA = 1000;
// Si la última fila recibida era muy reciente al momento de leer, se piden también las de los
// minutos anteriores: cubre transacciones que terminaron justo después de la lectura.
const MARGEN_MS = 2 * 60 * 1000;
// Con la marca más vieja que esto se hace una descarga completa (la bitácora de eliminados se
// puede limpiar a los 90 días).
const VIDA_MAX_MARCA_MS = 45 * 24 * 60 * 60 * 1000;

const esFaltaUpdatedAt = (error) =>
  error && (error.code === '42703' || /updated_at/i.test(String(error.message || '')));

const quitarUpdatedAt = (columnas) =>
  columnas.split(',').map((c) => c.trim()).filter((c) => c && c !== 'updated_at').join(', ');

/** Descarga paginada. Con `desde` solo trae lo cambiado después de esa fecha. */
async function descargarPaginado({ tabla, columnas, clave, desde }) {
  const filas = [];
  for (let inicio = 0; ; inicio += PAGINA) {
    let q = supabase.from(tabla).select(columnas);
    if (desde) q = q.gt('updated_at', desde).order('updated_at', { ascending: true });
    q = q.order(clave, { ascending: true }).range(inicio, inicio + PAGINA - 1);
    const { data, error } = await q;
    if (error) throw error;
    filas.push(...(data || []));
    if (!data || data.length < PAGINA) break;
  }
  return filas;
}

/** IDs eliminados en el servidor desde `desde` (bitácora `registros_eliminados`). */
async function descargarEliminados(tabla, desde) {
  const ids = [];
  for (let inicio = 0; ; inicio += PAGINA) {
    const { data, error } = await supabase
      .from('registros_eliminados')
      .select('registro_id')
      .eq('tabla', tabla)
      .gt('eliminado_en', desde)
      .order('id', { ascending: true })
      .range(inicio, inicio + PAGINA - 1);
    if (error) {
      console.warn(`[sync:${tabla}] No se pudo leer la bitácora de eliminados:`, error.message);
      return ids;
    }
    ids.push(...(data || []).map((r) => r.registro_id));
    if (!data || data.length < PAGINA) break;
  }
  return ids;
}

const maxUpdatedAt = (filas, previo = null) =>
  filas.reduce((max, f) => (f.updated_at && (!max || f.updated_at > max) ? f.updated_at : max), previo);

/** Olvida la marca de una tabla: la próxima carga será una descarga completa. */
export const reiniciarSincronizacion = (tabla) => localDb.sync_meta.delete(tabla);

/**
 * Trae a Dexie lo que cambió en `tabla` desde la última vez.
 *
 * @param {object}   o
 * @param {string}   o.tabla        Tabla de Supabase.
 * @param {string}   o.columnas     Columnas a pedir (incluir `updated_at`).
 * @param {string}   o.clave        Clave primaria (la misma que usa la tabla de Dexie).
 * @param {object}   o.tablaLocal   Tabla de Dexie (ej. localDb.prestamos).
 * @param {Function} o.esPendiente  (filaLocal) => true si tiene cambios offline sin subir.
 * @param {boolean}  [o.conEliminados] Leer la bitácora `registros_eliminados` (tablas con DELETE).
 * @returns {Promise<{ modo: 'cache'|'completa'|'cambios', filas: number }>}
 */
export async function sincronizarTabla({ tabla, columnas, clave, tablaLocal, esPendiente, conEliminados = false }) {
  const marca = await localDb.sync_meta.get(tabla);
  const marcaVigente = marca?.desde && Date.now() - (marca.completaEn || 0) < VIDA_MAX_MARCA_MS;

  // Realtime en vivo desde la última sincronización: Dexie ya está al día
  if (marcaVigente && estaFresco(tabla)) return { modo: 'cache', filas: 0 };

  let desde = null;
  if (marcaVigente) {
    const marcaMs = new Date(marca.desde).getTime();
    // El margen solo hace falta si la marca estaba cerca del momento de la lectura anterior
    desde = marcaMs >= (marca.leidoEn || 0) - MARGEN_MS
      ? new Date(marcaMs - MARGEN_MS).toISOString()
      : marca.desde;
  }
  const leidoEn = Date.now();

  let filas;
  let sinUpdatedAt = false;
  try {
    filas = await descargarPaginado({ tabla, columnas, clave, desde });
  } catch (error) {
    if (!esFaltaUpdatedAt(error)) throw error;
    // La tabla aún no tiene `updated_at`: descarga completa como antes
    sinUpdatedAt = true;
    filas = await descargarPaginado({ tabla, columnas: quitarUpdatedAt(columnas), clave, desde: null });
  }

  const completa = !desde || sinUpdatedAt;
  const eliminados = !completa && conEliminados ? await descargarEliminados(tabla, desde) : [];

  await localDb.transaction('rw', tablaLocal, localDb.sync_meta, async () => {
    if (completa) {
      // Reemplazo total: quita de Dexie lo que ya no está en el servidor (salvo pendientes)
      const locales = await tablaLocal.toArray();
      const pendientes = new Set(locales.filter(esPendiente).map((f) => String(f[clave])));
      const remotas = new Set(filas.map((f) => String(f[clave])));
      const sobran = locales
        .filter((f) => !pendientes.has(String(f[clave])) && !remotas.has(String(f[clave])))
        .map((f) => f[clave]);
      if (sobran.length) await tablaLocal.bulkDelete(sobran);
      await tablaLocal.bulkPut(
        filas.filter((f) => !pendientes.has(String(f[clave]))).map((f) => ({ ...f, _sincronizado: true })),
      );
    } else {
      // Solo cambios: no pisar filas con cambios offline sin subir
      const actuales = await tablaLocal.bulkGet(filas.map((f) => f[clave]));
      const aplicar = filas
        .filter((f, i) => !(actuales[i] && esPendiente(actuales[i])))
        .map((f) => ({ ...f, _sincronizado: true }));
      if (aplicar.length) await tablaLocal.bulkPut(aplicar);

      if (eliminados.length) {
        const candidatos = await tablaLocal.bulkGet(eliminados);
        const borrar = eliminados.filter((id, i) => candidatos[i] && !esPendiente(candidatos[i]));
        if (borrar.length) await tablaLocal.bulkDelete(borrar);
      }
    }

    if (sinUpdatedAt) {
      await localDb.sync_meta.delete(tabla);
    } else {
      await localDb.sync_meta.put({
        tabla,
        // Fecha del SERVIDOR (la mayor updated_at recibida), no la del celular: evita desfases de reloj.
        // Tabla vacía → null → la próxima vez se vuelve a pedir completa (es barato).
        desde: maxUpdatedAt(filas, marcaVigente ? marca.desde : null),
        leidoEn,
        completaEn: completa ? Date.now() : marca.completaEn,
      });
    }
  });

  marcarFresco(tabla);
  return { modo: completa ? 'completa' : 'cambios', filas: filas.length };
}
