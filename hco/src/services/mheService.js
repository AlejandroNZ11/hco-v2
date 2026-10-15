import { supabase } from '../config/supabaseClient';

/**
 * Obtiene las últimas 50 inspecciones cruzando con las tablas 'areas', 'equipos' y 'categorias_equipos'
 */
export const obtenerUltimasInspecciones = async () => {
  const [resInsp, resAreas, resEq, resCat] = await Promise.all([
    supabase
      .from('inspecciones')
      .select('*')
      .order('fecha_hora', { ascending: false })
      .limit(50),
    supabase.from('areas').select('id, nombre'),
    supabase.from('equipos').select('id, serie, categoria_id'),
    supabase.from('categorias_equipos').select('id, nombre')
  ]);

  if (resInsp.error) {
    throw new Error(`Error al cargar inspecciones: ${resInsp.error.message}`);
  }
  if (resAreas.error) {
    console.error("Error al leer tabla areas:", resAreas.error.message);
  }
  if (resCat.error) {
    console.error("Error al leer tabla categorias_equipos:", resCat.error.message);
  }

  // Diccionario de áreas (tabla: areas -> columna: nombre)
  const areasMap = Object.fromEntries(
    (resAreas.data || []).map(a => [String(a.id), a])
  );

  // Diccionario de categorías (tabla: categorias_equipos -> columna: nombre)
  const categoriasMap = Object.fromEntries(
    (resCat.data || []).map(c => [String(c.id), c])
  );

  // Diccionario de equipos unidos con su categoría
  const equiposMap = Object.fromEntries(
    (resEq.data || []).map(eq => [
      String(eq.id),
      {
        ...eq,
        categorias_equipos: categoriasMap[String(eq.categoria_id)] || null
      }
    ])
  );

  // Retornamos cada inspección con sus objetos listos para la tabla
  return (resInsp.data || []).map(insp => {
    const areaObj = areasMap[String(insp.area_id)] || null;
    return {
      ...insp,
      areas: areaObj,
      area: areaObj, // Guardamos ambos por compatibilidad
      equipos: equiposMap[String(insp.equipo_id)] || null
    };
  });
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
 * Obtiene la última inspección realizada a un equipo específico junto con su ID y respuestas
 */
export const obtenerUltimaInspeccionEquipo = async (equipoId) => {
  const { data, error } = await supabase
    .from('inspecciones')
    .select('id, estado_mhe, observaciones_generales, fecha_hora, registrado_por_nombre')
    .eq('equipo_id', equipoId)
    .order('fecha_hora', { ascending: false })
    .limit(1)
    .single();

  if (error && error.code !== 'PGRST116') {
    throw new Error(`Error al buscar historial del equipo: ${error.message}`);
  }
  
  if (!data) return null;

  // Consultamos también las respuestas de esta última inspección para extraer el horómetro
  const { data: respData } = await supabase
    .from('respuestas_inspeccion')
    .select('*')
    .eq('inspeccion_id', data.id);

  return {
    ...data,
    respuestas: respData || []
  };
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

/**
 * Obtiene una inspección por su ID junto con todas sus respuestas marcadas
 */
export const obtenerInspeccionPorId = async (inspeccionId) => {
  const [resInsp, resResp] = await Promise.all([
    supabase
      .from('inspecciones')
      .select('*')
      .eq('id', inspeccionId)
      .single(),
    supabase
      .from('respuestas_inspeccion')
      .select('*')
      .eq('inspeccion_id', inspeccionId)
  ]);

  if (resInsp.error) {
    throw new Error(`Error al cargar la inspección: ${resInsp.error.message}`);
  }
  if (resResp.error) {
    throw new Error(`Error al cargar las respuestas: ${resResp.error.message}`);
  }

  return {
    inspeccion: resInsp.data,
    respuestas: resResp.data || []
  };
};

/**
 * Actualiza una inspección existente y reemplaza el detalle de sus respuestas
 */
export const actualizarInspeccionCompleta = async (inspeccionId, datosInspeccion, respuestasArray) => {
  // 1. Actualizar cabecera en 'inspecciones'
  const { data: inspActualizada, error: errorInsp } = await supabase
    .from('inspecciones')
    .update(datosInspeccion)
    .eq('id', inspeccionId)
    .select()
    .single();

  if (errorInsp) {
    throw new Error(`Error al actualizar inspección: ${errorInsp.message}`);
  }

  // 2. Borrar respuestas anteriores de esta inspección para insertar las actualizadas
  const { error: errorDel } = await supabase
    .from('respuestas_inspeccion')
    .delete()
    .eq('inspeccion_id', inspeccionId);

  if (errorDel) {
    throw new Error(`Error al limpiar respuestas previas: ${errorDel.message}`);
  }

  // 3. Insertar las respuestas nuevas
  const respuestasConId = respuestasArray.map(resp => ({
    ...resp,
    inspeccion_id: inspeccionId
  }));

  const { error: errorResp } = await supabase
    .from('respuestas_inspeccion')
    .insert(respuestasConId);

  if (errorResp) {
    throw new Error(`Error al guardar respuestas actualizadas: ${errorResp.message}`);
  }

  return inspActualizada;
};