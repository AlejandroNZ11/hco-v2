import { supabase } from '../config/supabaseClient';
import { subirImagenDrive } from './driveService';
import { consultaCacheada, MIN } from './cacheConsultas';

// =========================================================================
// SUBIDA A GOOGLE DRIVE (vía Edge Function `subir-drive`)
// =========================================================================
export const subirImagenADrive = (dataUrlBase64, nombreArchivo) =>
  subirImagenDrive(dataUrlBase64, nombreArchivo, { destino: 'lup' });

// =========================================================================
// CONSULTAS A SUPABASE (TABLA 'lup')
// =========================================================================

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
export const obtenerEmpleadosCatalogo = () =>
  consultaCacheada('catalogos:lup-empleados', descargarEmpleadosCatalogo, 10 * MIN).catch(() => []);

const descargarEmpleadosCatalogo = async () => {
  const { data, error } = await supabase
    .from('empleados')
    .select('id, dni, nombre, tipo, rol, area_id, jefe_directo_id, estado')
    .order('nombre', { ascending: true });

  if (error) {
    console.error('Error obteniendo catálogo de empleados:', error);
    throw error; // no se guarda en caché: se reintenta la próxima vez
  }
  return data || [];
};

/**
 * Obtiene el catálogo de áreas (id, nombre)
 */
export const obtenerAreasCatalogo = () =>
  consultaCacheada('catalogos:areas-cuadroq', descargarAreasCatalogo, 10 * MIN).catch(() => []);

const descargarAreasCatalogo = async () => {
  const { data, error } = await supabase
    .from('areas')
    .select('id, nombre, cuadro_q')
    .order('nombre', { ascending: true });

  if (error) {
    console.error('Error obteniendo catálogo de áreas:', error);
    throw error;
  }
  return data || [];
};

/**
 * Crea un nuevo registro de LUP (procesando foto si existe)
 */
export const crearLup = async (payload) => {
  let fotoUrl = null;
  if (payload.foto_lup_base64) {
    const nombreArchivo = `lup_${payload.numero_lup || 'new'}_${Date.now()}.png`;
    fotoUrl = await subirImagenADrive(payload.foto_lup_base64, nombreArchivo);
  }

  const { foto_lup_base64, ...datosInsertar } = payload;
  datosInsertar.foto_lup = fotoUrl;

  const { data, error } = await supabase
    .from('lup')
    .insert([datosInsertar])
    .select();

  if (error) {
    console.error('Error creando LUP:', error);
    throw error;
  }
  return data;
};

/**
 * Actualiza los datos de una LUP existente (actualiza foto si viene nueva)
 */
export const actualizarLup = async (id, payload) => {
  let fotoUrl = payload.foto_lup || null;
  if (payload.foto_lup_base64) {
    const nombreArchivo = `lup_${payload.numero_lup || id}_${Date.now()}.png`;
    fotoUrl = await subirImagenADrive(payload.foto_lup_base64, nombreArchivo);
  }

  const { foto_lup_base64, ...datosActualizar } = payload;
  datosActualizar.foto_lup = fotoUrl;

  const { data, error } = await supabase
    .from('lup')
    .update(datosActualizar)
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