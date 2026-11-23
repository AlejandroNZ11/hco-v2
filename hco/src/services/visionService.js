import { supabase } from '../config/supabaseClient';

/**
 * Lecturas del módulo de Visión Artificial. El backend de IA es quien inserta los eventos
 * (con la service_role key); la app solo lee, marca revisados y registra ajustes de aforo.
 */

/** Inicio del día local en ISO (los paneles muestran "hoy"). */
export const inicioDeHoyISO = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
};

const lanzar = (error, contexto) => {
  if (error) throw new Error(`${contexto}: ${error.message}`);
};

export const TABLAS_VISION = {
  epp: 'vision_epp_infracciones',
  conteo: 'vision_conteos',
  aforo: 'vision_aforo_eventos',
};

// Solo las columnas que pinta PanelVision (antes era select('*')).
// Aforo: sin registrado_por / nota → ~40 % menos bytes por fila.
const COLUMNAS_VISION = {
  epp: 'id, hora, camara_id, area, track_id, estado, epp_faltantes, foto_url, revisado',
  conteo: 'id, hora, camara_id, area, clase, cantidad',
  aforo: 'id, hora, camara_id, area, tipo, delta, track_id',
};

// Límite de carga inicial por módulo. Aforo necesita todos los eventos del día para sumar bien.
export const LIMITE_VISION = { epp: 100, conteo: 200, aforo: 5000 };

/** Filas de hoy del módulo indicado (las más recientes primero). `desde` permite traer solo lo nuevo. */
export const listarHoy = async (modulo, limite = LIMITE_VISION[modulo] || 200, desde = null) => {
  const tabla = TABLAS_VISION[modulo];
  if (!tabla) return [];
  const { data, error } = await supabase
    .from(tabla)
    .select(COLUMNAS_VISION[modulo])
    .gte('hora', desde || inicioDeHoyISO())
    .order('hora', { ascending: false })
    .limit(limite);
  lanzar(error, 'No se pudo cargar el panel');
  return data || [];
};

// ------------------------------------------------------------------------------------------
// Caché local de AFORO + sincronización incremental.
// Al volver al panel (o recargar la PWA) se muestra lo guardado al instante y solo se piden
// los eventos con hora >= (última hora guardada − SOLAPE). El solape cubre eventos que otro
// celular subió tarde desde su cola offline. "Recargar" siempre hace una carga completa.
// ------------------------------------------------------------------------------------------
const CACHE_AFORO_KEY = 'vision-aforo-cache-v1';
const SOLAPE_MS = 30 * 60 * 1000; // 30 min
const CACHE_VIGENTE_MS = 2 * 60 * 60 * 1000; // si la caché tiene > 2 h, se recarga completa
const memoria = {}; // caché en memoria (sobrevive al cambiar de pestaña sin tocar localStorage)

const leerCacheAforo = () => {
  if (memoria.aforo) return memoria.aforo;
  try {
    const c = JSON.parse(localStorage.getItem(CACHE_AFORO_KEY) || 'null');
    if (c && Array.isArray(c.filas)) memoria.aforo = c;
    return memoria.aforo || null;
  } catch {
    return null;
  }
};

/** Guarda las filas de aforo de hoy (se llama también al recibir eventos en tiempo real). */
export const guardarCacheAforo = (filas) => {
  const c = { dia: inicioDeHoyISO(), ts: Date.now(), filas };
  memoria.aforo = c;
  try {
    localStorage.setItem(CACHE_AFORO_KEY, JSON.stringify(c));
  } catch {
    // Safari privado / cuota llena: queda solo en memoria
  }
};

const unirPorId = (base, nuevas) => {
  const mapa = new Map(base.map((f) => [f.id, f]));
  nuevas.forEach((f) => mapa.set(f.id, f));
  return [...mapa.values()].sort((a, b) => (a.hora < b.hora ? 1 : -1));
};

/** Filas de aforo guardadas de HOY (para pintar al instante), o null. */
export const aforoEnCache = () => {
  const c = leerCacheAforo();
  return c && c.dia === inicioDeHoyISO() ? c.filas : null;
};

/**
 * Aforo de hoy con carga incremental. `completo` fuerza traer todo el día.
 * Devuelve la lista completa (caché + nuevos) ya unida por id.
 */
export const listarAforoIncremental = async ({ completo = false } = {}) => {
  const c = leerCacheAforo();
  const usable = !completo && c && c.dia === inicioDeHoyISO() && Date.now() - c.ts < CACHE_VIGENTE_MS && c.filas.length;
  if (!usable) {
    const filas = await listarHoy('aforo', LIMITE_VISION.aforo);
    guardarCacheAforo(filas);
    return filas;
  }
  const ultima = c.filas.reduce((max, f) => (f.hora > max ? f.hora : max), '');
  const desde = new Date(Math.max(new Date(ultima).getTime() - SOLAPE_MS, new Date(inicioDeHoyISO()).getTime())).toISOString();
  const nuevas = await listarHoy('aforo', LIMITE_VISION.aforo, desde);
  const filas = unirPorId(c.filas, nuevas);
  guardarCacheAforo(filas);
  return filas;
};

/** Marca una infracción de EPP como revisada por el usuario actual. */
export const marcarEppRevisado = async (id, revisado = true) => {
  const { data: sesion } = await supabase.auth.getSession();
  const { error } = await supabase
    .from(TABLAS_VISION.epp)
    .update({
      revisado,
      revisado_por: revisado ? sesion?.session?.user?.id ?? null : null,
      revisado_en: revisado ? new Date().toISOString() : null,
    })
    .eq('id', id);
  lanzar(error, 'No se pudo actualizar');
};

/** Corrige el aforo (p. ej. +1 si alguien entró sin ser detectado). */
export const registrarAjusteAforo = async ({ camaraId, area, delta, nota }) => {
  const { data: sesion } = await supabase.auth.getSession();
  const uid = sesion?.session?.user?.id;
  if (!uid) throw new Error('Tu sesión venció. Vuelve a iniciar sesión.');
  const { error } = await supabase.from(TABLAS_VISION.aforo).insert({
    camara_id: camaraId || 'manual',
    area: area || null,
    tipo: 'AJUSTE',
    delta,
    registrado_por: uid,
    nota: nota || null,
  });
  lanzar(error, 'No se pudo registrar el ajuste');
};

/** Token de la sesión actual, para autenticar el WebSocket del backend de IA. */
export const obtenerTokenSesion = async () => {
  const { data } = await supabase.auth.getSession();
  return data?.session?.access_token || '';
};
