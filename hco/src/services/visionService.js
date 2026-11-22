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

/** Filas de hoy del módulo indicado (las más recientes primero). */
export const listarHoy = async (modulo, limite = 200) => {
  const tabla = TABLAS_VISION[modulo];
  if (!tabla) return [];
  const { data, error } = await supabase
    .from(tabla)
    .select('*')
    .gte('hora', inicioDeHoyISO())
    .order('hora', { ascending: false })
    .limit(limite);
  lanzar(error, 'No se pudo cargar el panel');
  return data || [];
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
