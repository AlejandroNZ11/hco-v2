import { supabase } from '../config/supabaseClient';

// =========================================================================
// LÓGICA DE SUBIDA A GOOGLE DRIVE API V3 (COMPARTIDA CON PRÉSTAMOS)
// =========================================================================
let tokenGoogleCache = { token: null, expira: 0 };

const obtenerAccessTokenGoogleDrive = async () => {
  const ahora = Date.now();
  if (tokenGoogleCache.token && ahora < tokenGoogleCache.expira) {
    return tokenGoogleCache.token;
  }

  const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;
  const clientSecret = import.meta.env.VITE_GOOGLE_CLIENT_SECRET;
  const refreshToken = import.meta.env.VITE_GOOGLE_REFRESH_TOKEN;

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error('Faltan credenciales VITE_GOOGLE_* en el archivo .env');
  }

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token'
    })
  });

  const data = await res.json();
  if (!res.ok || !data.access_token) {
    throw new Error(data.error_description || 'Error obteniendo token de Google Drive.');
  }

  tokenGoogleCache = {
    token: data.access_token,
    expira: Date.now() + 50 * 60 * 1000
  };

  return data.access_token;
};

const base64ABlob = (dataUrl) => {
  const partes = dataUrl.split(',');
  const byteString = atob(partes[1]);
  const arrayBuffer = new ArrayBuffer(byteString.length);
  const intArray = new Uint8Array(arrayBuffer);
  for (let i = 0; i < byteString.length; i++) {
    intArray[i] = byteString.charCodeAt(i);
  }
  return new Blob([intArray], { type: 'image/png' });
};

export const subirImagenADrive = async (dataUrlBase64, nombreArchivo) => {
  if (!dataUrlBase64 || !String(dataUrlBase64).startsWith('data:image')) return '';

  const folderId = import.meta.env.VITE_GOOGLE_DRIVE_FOLDER_LUP;
  const accessToken = await obtenerAccessTokenGoogleDrive();
  const blobImagen = base64ABlob(dataUrlBase64);

  const metadata = {
    name: nombreArchivo,
    mimeType: 'image/png',
    ...(folderId ? { parents: [folderId] } : {})
  };

  const form = new FormData();
  form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
  form.append('file', blobImagen);

  const res = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink',
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}` },
      body: form
    }
  );

  const fileData = await res.json();
  if (!res.ok || !fileData.id) {
    throw new Error(fileData?.error?.message || 'Error al subir imagen a Google Drive.');
  }

  // Asignar permiso público inmediato para que lh3 la cargue directo
  try {
    await fetch(`https://www.googleapis.com/drive/v3/files/${fileData.id}/permissions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ role: 'reader', type: 'anyone' })
    });
  } catch (e) {
    console.warn("Aviso permiso público:", e);
  }

  return `https://drive.google.com/file/d/${fileData.id}/view`;
};

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