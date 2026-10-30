import { supabase } from '../config/supabaseClient';

// =========================================================================
// SUBIDA DIRECTA DESDE REACT A GOOGLE DRIVE API V3 (FOTOS DE PERSONAL)
// =========================================================================

const obtenerAccessTokenGoogleDrive = async () => {
  const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;
  const clientSecret = import.meta.env.VITE_GOOGLE_CLIENT_SECRET;
  const refreshToken = import.meta.env.VITE_GOOGLE_REFRESH_TOKEN;

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error('Faltan las credenciales VITE_GOOGLE_* en el archivo .env para conectar con Google Drive.');
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
    throw new Error(data.error_description || 'No se pudo obtener el token de acceso de Google Drive.');
  }
  return data.access_token;
};

const base64ABlob = (dataUrl) => {
  const partes = dataUrl.split(',');
  const mimeMatch = partes[0].match(/:(.*?);/);
  const mimeType = mimeMatch ? mimeMatch[1] : 'image/png';
  const byteString = atob(partes[1]);
  const arrayBuffer = new ArrayBuffer(byteString.length);
  const intArray = new Uint8Array(arrayBuffer);
  for (let i = 0; i < byteString.length; i++) {
    intArray[i] = byteString.charCodeAt(i);
  }
  return new Blob([intArray], { type: mimeType });
};

export const subirFotoEmpleadoADrive = async (dataUrlBase64, dniEmpleado = 'sin_dni') => {
  if (!dataUrlBase64 || !String(dataUrlBase64).startsWith('data:image')) return '';

  const folderId =
    import.meta.env.VITE_GOOGLE_DRIVE_FOLDER_PERSONAL_ID ||
    import.meta.env.VITE_GOOGLE_DRIVE_FOLDER_ID;

  const accessToken = await obtenerAccessTokenGoogleDrive();
  const blobImagen = base64ABlob(dataUrlBase64);

  const dniLimpio = String(dniEmpleado || 'sin_dni').trim().replace(/[^a-zA-Z0-9_-]/g, '');
  const nombreDeseado = `${dniLimpio}.png`;

  // 1. Renombrar archivo anterior si existe
  if (folderId) {
    try {
      const query = `'${folderId}' in parents and name = '${nombreDeseado}' and trashed = false`;
      const searchRes = await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}`, {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      const searchData = await searchRes.json();

      if (searchData.files && searchData.files.length > 0) {
        const archivoAnterior = searchData.files[0];
        const nuevoNombreAnterior = `${dniLimpio}_2.png`;
        await fetch(`https://www.googleapis.com/drive/v3/files/${archivoAnterior.id}`, {
          method: 'PATCH',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ name: nuevoNombreAnterior })
        });
      }
    } catch (err) {
      console.warn('No se pudo renombrar el archivo anterior:', err);
    }
  }

  // 2. Subida robusta compatible con entornos de producción (Evita el error HTTP2)
  const metadata = {
    name: nombreDeseado,
    mimeType: 'image/png',
    ...(folderId ? { parents: [folderId] } : {})
  };

  const form = new FormData();
  // Forzamos la creación explícita de un Blob JSON para evitar problemas de compatibilidad en producción
  form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
  form.append('file', blobImagen);

  const res = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart',
    {
      method: 'POST',
      headers: { 
        Authorization: `Bearer ${accessToken}`
        // NOTA: No incluyas 'Content-Type': 'multipart/form-data' manualmente, 
        // el navegador debe generarlo solo con el boundary para evitar el ERR_HTTP2_PROTOCOL_ERROR.
      },
      body: form
    }
  );

  const fileData = await res.json();
  if (!res.ok || !fileData.id) {
    throw new Error(fileData?.error?.message || 'Error al subir la foto a Google Drive.');
  }

  return `https://drive.google.com/file/d/${fileData.id}/view`;
};


// =========================================================================
// FUNCIONES CRUD DE EMPLEADOS Y CATÁLOGOS
// =========================================================================

export const obtenerTodosLosEmpleados = async () => {
  const { data, error } = await supabase
    .from('empleados')
    .select(`
      *,
      cargo:cargos(nombre),
      area:areas(nombre),
      jefe:jefe_directo_id(nombre)
    `)
    .order('nombre', { ascending: true });

  if (error) throw new Error(`Error al obtener empleados: ${error.message}`);
  return data;
};

export const obtenerEmpleadoPorId = async (id) => {
  const { data, error } = await supabase
    .from('empleados')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (error) throw new Error(`Error al obtener empleado: ${error.message}`);
  return data;
};

export const crearEmpleado = async (empleadoData) => {
  const { data, error } = await supabase
    .from('empleados')
    .insert([empleadoData])
    .select()
    .single();

  if (error) throw new Error(`Error al crear empleado en BD: ${error.message}`);
  if (!data) throw new Error('No se pudo crear el empleado en la base de datos (verifica permisos RLS).');
  return data;
};

export const actualizarEmpleado = async (id, empleadoData) => {
  // Extraemos 'id' para no intentar sobreescribir la Primary Key en el UPDATE
  const { id: _ignoreId, ...datosActualizar } = empleadoData;

  const { data, error } = await supabase
    .from('empleados')
    .update(datosActualizar)
    .eq('id', id)
    .select()
    .maybeSingle();

  if (error) throw new Error(`Error al actualizar empleado en BD: ${error.message}`);
  if (!data) {
    throw new Error('Supabase no actualizó ningún registro. Verifica las políticas RLS (FOR UPDATE) de la tabla "empleados" o que el ID exista en el servidor.');
  }
  return data;
};

export const cambiarEstadoEmpleado = async (id, nuevoEstado) => {
  const { data, error } = await supabase
    .from('empleados')
    .update({ estado: nuevoEstado })
    .eq('id', id)
    .select()
    .maybeSingle();

  if (error) throw new Error(`Error al cambiar estado: ${error.message}`);
  if (!data) throw new Error('No se pudo actualizar el estado en el servidor.');
  return true;
};

export const verificarDniExistente = async (dni, excludeId = null) => {
  let query = supabase.from('empleados').select('id').eq('dni', dni.trim());
  if (excludeId) query = query.neq('id', excludeId);

  const { data, error } = await query;
  if (error) throw new Error(`Error al verificar DNI: ${error.message}`);
  return data && data.length > 0;
};

export const verificarUsuarioExistente = async (usuario, excludeId = null) => {
  let query = supabase.from('empleados').select('id').eq('usuario', usuario.trim());
  if (excludeId) query = query.neq('id', excludeId);

  const { data, error } = await query;
  if (error) throw new Error(`Error al verificar Usuario: ${error.message}`);
  return data && data.length > 0;
};

export const obtenerAreas = async () => {
  const { data, error } = await supabase.from('areas').select('id, nombre').order('nombre');
  if (error) throw new Error(`Error al cargar áreas: ${error.message}`);
  return data;
};

export const obtenerCargos = async () => {
  const { data, error } = await supabase.from('cargos').select('id, nombre').order('nombre');
  if (error) throw new Error(`Error al cargar cargos: ${error.message}`);
  return data;
};

export const obtenerJefes = async () => {
  const { data, error } = await supabase.from('empleados').select('id, nombre').ilike('tipo', 'white').order('nombre');
  if (error) throw new Error(`Error al cargar jefes: ${error.message}`);
  return data;
};

export const obtenerRoles = async () => {
  const { data, error } = await supabase
    .from('rol')
    .select('*')
    .order('id');

  if (error) throw new Error(`Error al cargar rol: ${error.message}`);
  return data;
};