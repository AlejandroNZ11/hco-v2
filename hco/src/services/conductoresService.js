// Asegúrate de importar tu cliente de Supabase desde donde lo tengas configurado.
// Cambia esta ruta según la estructura de tu proyecto (ej: '../config/supabase', '../supabaseClient', etc.)
import { supabase } from '../config/supabaseClient';
import { localDb } from './localDb';

/**
 * Obtiene la lista de todos los conductores
 */
export const obtenerConductores = async () => {
  const { data, error } = await supabase
    .from('conductores')
    .select('*')
    .order('fecha_registro', { ascending: false }); // Ordena por los más recientes

  if (error) {
    console.error('Error obteniendo conductores:', error);
    throw error;
  }
  return data;
};

/**
 * Obtiene el catálogo de empresas para el select del Modal
 * (Ajusta el nombre de la tabla 'empresas' si en tu base de datos se llama diferente)
 */

export const obtenerEmpresasCatalogo = async () => {
  const { data, error } = await supabase
    .from('empresas_transporte') // <-- Nombre de tu tabla actualizado
    .select('id, nombre_empresa') // <-- Nombre de tu columna actualizado
    .order('nombre_empresa', { ascending: true });

  if (error) {
    console.error('Error obteniendo empresas:', error);
    return []; 
  }
  return data;
};

/**
 * Crea un nuevo conductor
 */
export const crearConductor = async (payload) => {
  const { data, error } = await supabase
    .from('conductores')
    .insert([payload])
    .select();

  if (error) {
    console.error('Error creando conductor:', error);
    throw error;
  }
  return data;
};

/**
 * Actualiza los datos de un conductor existente
 */
export const actualizarConductor = async (id, payload) => {
  const { data, error } = await supabase
    .from('conductores')
    .update(payload)
    .eq('dni_conductor', id) // Utilizamos el DNI o ID como referencia
    .select();

  if (error) {
    console.error('Error actualizando conductor:', error);
    throw error;
  }
  return data;
};

/**
 * Cambia el estado (Activar / Desactivar) de un conductor
 */
export const cambiarEstadoConductor = async (id, payload) => {
  const { data, error } = await supabase
    .from('conductores')
    .update(payload)
    .eq('dni_conductor', id) // Utilizamos el DNI o ID como referencia
    .select();

  if (error) {
    console.error('Error cambiando estado del conductor:', error);
    throw error;
  }
  return data;
};
