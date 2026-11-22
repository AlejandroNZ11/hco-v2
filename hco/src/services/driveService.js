import { supabase } from '../config/supabaseClient';

/**
 * Sube una imagen (data URL base64) a Google Drive a través de la Edge Function `subir-drive`.
 * Los secretos de Google viven solo en Supabase; aquí solo viaja la imagen y la sesión del usuario.
 *
 * @param {string} dataUrlBase64 - Imagen en formato "data:image/...;base64,..."
 * @param {string} nombreArchivo - Nombre del archivo en Drive
 * @param {Object} opciones
 * @param {'lup'|'prestamos'|'personal'|'vision'} opciones.destino - Carpeta destino (la traduce el servidor)
 * @param {'renombrar'|'borrar'} [opciones.anterior] - Qué hacer si ya existe un archivo con ese nombre
 * @param {boolean} [opciones.publico=true] - Dar permiso de lectura pública al archivo
 * @returns {Promise<string>} URL de visualización en Drive, o '' si no hay imagen
 */
export const subirImagenDrive = async (dataUrlBase64, nombreArchivo, { destino, anterior, publico = true } = {}) => {
  if (!dataUrlBase64 || !String(dataUrlBase64).startsWith('data:image')) return '';

  const { data, error } = await supabase.functions.invoke('subir-drive', {
    body: { imagenBase64: dataUrlBase64, nombreArchivo, destino, anterior, publico },
  });

  if (error) {
    // Intentar leer el mensaje que devolvió la función
    let mensaje = error.message;
    try {
      const cuerpo = await error.context?.json?.();
      if (cuerpo?.error) mensaje = cuerpo.error;
    } catch {
      // sin cuerpo legible
    }
    throw new Error(mensaje || 'No se pudo subir la imagen a Google Drive.');
  }

  if (!data?.url) throw new Error(data?.error || 'Respuesta inválida al subir a Google Drive.');
  return data.url;
};
