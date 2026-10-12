import { supabase } from '../config/supabaseClient';

/**
 * Obtiene la lista básica de usuarios para la validación visual en el Login
 */
export const obtenerUsuariosParaCache = async () => {
  const { data, error } = await supabase
    .from('empleados')
    .select('dni, usuario, nombre, rol, foto_url, estado');
    
  if (error) throw new Error(`Error al cargar caché de usuarios: ${error.message}`);
  return data || [];
};

/**
 * Inicia sesión con Supabase Auth
 */
export const iniciarSesion = async (email, password) => {
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password
  });

  if (error) throw new Error('Contraseña o usuario incorrecto');
  return data;
};

/**
 * Obtiene el perfil completo del usuario con el nombre de su cargo
 */
export const obtenerPerfilCompleto = async (userId) => {
  const { data, error } = await supabase
    .from('empleados')
    .select(`
      *,
      cargos (nombre)
    `)
    .eq('id', userId)
    .single();

  if (error) throw new Error(`Error al obtener perfil: ${error.message}`);
  return data;
};

/**
 * Cierra la sesión en Supabase Auth
 */
export const cerrarSesion = async () => {
  const { error } = await supabase.auth.signOut();
  if (error) throw new Error(`Error al cerrar sesión: ${error.message}`);
  return true;
};


/**
 * Obtiene la sesión activa actual en Supabase
 */
export const obtenerSesionActiva = async () => {
  const { data: { session }, error } = await supabase.auth.getSession();
  
  if (error) throw new Error(`Error al verificar la sesión: ${error.message}`);
  
  return session;
};