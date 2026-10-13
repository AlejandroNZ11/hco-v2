import { supabase } from '../config/supabaseClient';

/**
 * Obtiene las últimas 50 inspecciones con los datos completos de equipo, categoría y área
 */
export const obtenerUltimasInspecciones = async () => {
  const { data, error } = await supabase
    .from('inspecciones')
    .select(`
      id,
      fecha_hora,
      area_id,
      equipo_id,
      usuario_id,
      estado_proceso,
      estado_mhe,
      estado_personal,
      registrado_por_nombre,
      aprobado_por_id,
      revisado_el,
      area ( nombre ),
      equipos (
        serie,
        categoria_id,
        categorias_equipos ( nombre )
      )
    `)
    .order('fecha_hora', { ascending: false })
    .limit(50);

  if (error) throw new Error(`Error al cargar inspecciones: ${error.message}`);
  return data || [];
};

/**
 * Aprueba una inspección registrando quién la aprobó y la fecha/hora de revisión
 */
export const aprobarInspeccionMhe = async (inspeccionId, usuarioId) => {
  const { data, error } = await supabase
    .from('inspecciones')
    .update({
      estado_proceso: 'APROBADO',
      aprobado_por_id: usuarioId,
      revisado_el: new Date().toISOString()
    })
    .eq('id', inspeccionId)
    .select()
    .single();

  if (error) throw new Error(`Error al aprobar inspección: ${error.message}`);
  return data;
};

/**
 * Carga los catálogos base: Categorías, Equipos y Preguntas (Items del Checklist)
 */
export const obtenerDatosMaestrosMhe = async () => {
  const [resCat, resEq, resPreg] = await Promise.all([
    supabase.from('categorias_equipos').select('*').order('nombre'),
    supabase.from('equipos').select('*'),
    supabase.from('items_checklist').select('*')
  ]);

  if (resCat.error) throw resCat.error;
  if (resEq.error) throw resEq.error;
  if (resPreg.error) throw resPreg.error;

  return {
    categorias: resCat.data || [],
    equipos: resEq.data || [],
    preguntas: resPreg.data || []
  };
};

/**
 * Obtiene la última inspección realizada a un equipo específico
 */
export const obtenerUltimaInspeccionEquipo = async (equipoId) => {
  const { data, error } = await supabase
    .from('inspecciones')
    .select('estado_mhe, observaciones_generales, fecha_hora, registrado_por_nombre')
    .eq('equipo_id', equipoId)
    .order('fecha_hora', { ascending: false })
    .limit(1)
    .single();

  // Si da error es porque no hay datos, devolvemos null en vez de lanzar excepción
  if (error && error.code !== 'PGRST116') {
    throw new Error(`Error al buscar historial del equipo: ${error.message}`);
  }
  
  return data || null;
};

/**
 * Guarda una nueva inspección y sus respuestas detalladas
 */
export const guardarInspeccionCompleta = async (datosInspeccion, respuestasArray) => {
  // 1. Guardar la cabecera (Inspección)
  const { data: inspGuardada, error: errorInsp } = await supabase
    .from('inspecciones')
    .insert([datosInspeccion])
    .select()
    .single();

  if (errorInsp) throw new Error(`Error al guardar inspección: ${errorInsp.message}`);

  // 2. Asociar el ID a las respuestas
  const respuestasConId = respuestasArray.map(resp => ({
    ...resp,
    inspeccion_id: inspGuardada.id
  }));

  // 3. Guardar las respuestas del checklist
  const { error: errorResp } = await supabase
    .from('respuestas_inspeccion')
    .insert(respuestasConId);

  if (errorResp) throw new Error(`Error al guardar respuestas: ${errorResp.message}`);

  return inspGuardada;
};