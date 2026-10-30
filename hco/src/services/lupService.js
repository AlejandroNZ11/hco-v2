import { supabase } from '../config/supabaseClient';

/**
 * Obtiene la lista de todas las LUP ordenadas por fecha de registro descendente
 */
export const obtenerLups = async () => {
  const { data, error } = await supabase
    .from('lup')
    .select('*')
    .order('fecha_registro', { ascending: false });

  if (error) {
    console.error('Error obteniendo LUPs:', error);
    throw error;
  }
  return data || [];
};

/**
 * Obtiene el catálogo de empleados (incluyendo su tipo/rol, área y jefe_directo_id)
 */
export const obtenerEmpleadosCatalogo = async () => {
  const { data, error } = await supabase
    .from('empleados')
    .select('id, dni, nombre, tipo, rol, area_id, jefe_directo_id, estado')
    .order('nombre', { ascending: true });

  if (error) {
    console.error('Error obteniendo catálogo de empleados:', error);
    return [];
  }
  return data || [];
};

/**
 * Obtiene el catálogo de áreas (id, nombre)
 */
export const obtenerAreasCatalogo = async () => {
  const { data, error } = await supabase
    .from('areas')
    .select('id, nombre, cuadro_q')
    .order('nombre', { ascending: true });

  if (error) {
    console.error('Error obteniendo catálogo de áreas:', error);
    return [];
  }
  return data || [];
};

/**
 * Crea un nuevo registro de LUP
 */
export const crearLup = async (payload) => {
  const { data, error } = await supabase
    .from('lup')
    .insert([payload])
    .select();

  if (error) {
    console.error('Error creando LUP:', error);
    throw error;
  }
  return data;
};

/**
 * Actualiza los datos de una LUP existente
 */
export const actualizarLup = async (id, payload) => {
  const { data, error } = await supabase
    .from('lup')
    .update(payload)
    .eq('id', id)
    .select();

  if (error) {
    console.error('Error actualizando LUP:', error);
    throw error;
  }
  return data;
};

/**
 * Cambia la operatividad (ACTIVO / INACTIVO) de una LUP
 */
export const cambiarOperatividadLup = async (id, payload) => {
  const { data, error } = await supabase
    .from('lup')
    .update(payload)
    .eq('id', id)
    .select();

  if (error) {
    console.error('Error cambiando operatividad de la LUP:', error);
    throw error;
  }
  return data;
};
