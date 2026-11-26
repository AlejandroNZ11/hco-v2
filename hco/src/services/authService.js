import { supabase } from '../config/supabaseClient';
import { COLUMNAS_EMPLEADO } from './empleadosService';

// Caché de la lista visual del Login (foto/nombre/rol). Antes se descargaba la tabla
// `empleados` entera cada vez que se abría el Login.
const KEY_CACHE_USUARIOS = 'hco_usuarios_login_v1';
const TTL_USUARIOS_MS = 12 * 60 * 60 * 1000; // 12 h

const leerCacheUsuarios = () => {
  try {
    const c = JSON.parse(localStorage.getItem(KEY_CACHE_USUARIOS) || 'null');
    return c && Array.isArray(c.data) ? c : null;
  } catch {
    return null;
  }
};

let descargaUsuarios = null; // evita dos descargas simultáneas (StrictMode, doble montaje)

const descargarUsuarios = () => {
  descargaUsuarios ??= (async () => {
    const { data, error } = await supabase
      .from('empleados')
      .select('dni, usuario, nombre, rol, foto_url, estado');
    if (error) throw new Error(`Error al cargar caché de usuarios: ${error.message}`);
    try {
      localStorage.setItem(KEY_CACHE_USUARIOS, JSON.stringify({ ts: Date.now(), data: data || [] }));
    } catch {
      // cuota llena / modo privado: solo se pierde la caché
    }
    return data || [];
  })().finally(() => {
    descargaUsuarios = null;
  });
  return descargaUsuarios;
};

/**
 * Lista básica de usuarios para la validación visual en el Login.
 * Devuelve la caché local al instante si existe; solo consulta Supabase si no hay caché o venció
 * (y en ese caso la refresca en segundo plano vía `onActualizado`).
 */
export const obtenerUsuariosParaCache = async ({ onActualizado } = {}) => {
  const c = leerCacheUsuarios();
  if (!c) return descargarUsuarios();
  if (Date.now() - c.ts > TTL_USUARIOS_MS && navigator.onLine !== false) {
    descargarUsuarios().then((d) => onActualizado?.(d)).catch(() => {});
  }
  return c.data;
};

let loginEnCurso = null; // un solo signInWithPassword a la vez (doble clic / Enter + clic / huella)

/**
 * Inicia sesión con Supabase Auth
 */
export const iniciarSesion = (email, password) => {
  loginEnCurso ??= (async () => {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw new Error('Contraseña o usuario incorrecto');
    return data;
  })().finally(() => {
    loginEnCurso = null;
  });
  return loginEnCurso;
};

/**
 * Obtiene el perfil completo del usuario con el nombre de su cargo
 */
export const obtenerPerfilCompleto = async (userId) => {
  const { data, error } = await supabase
    .from('empleados')
    .select(`${COLUMNAS_EMPLEADO}, cargos (nombre)`) // sin `cl`: la contraseña nunca viaja al navegador
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