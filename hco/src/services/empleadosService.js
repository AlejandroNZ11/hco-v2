import { supabase } from '../config/supabaseClient';
import { subirImagenDrive } from './driveService';
import { invalidarConsultas } from './cacheConsultas';

// =========================================================================
// SUBIDA A GOOGLE DRIVE (FOTOS DE PERSONAL) vía Edge Function `subir-drive`
// =========================================================================
// Si ya existe <dni>.png, el servidor renombra la anterior a <dni>_2.png (igual que antes).
export const subirFotoEmpleadoADrive = (dataUrlBase64, dniEmpleado = 'sin_dni') => {
  const dniLimpio = String(dniEmpleado || 'sin_dni').trim().replace(/[^a-zA-Z0-9_-]/g, '');
  return subirImagenDrive(dataUrlBase64, `${dniLimpio}.png`, {
    destino: 'personal',
    anterior: 'renombrar',
    publico: false,
  });
};


// =========================================================================
// FUNCIONES CRUD DE EMPLEADOS Y CATÁLOGOS
// =========================================================================

// Columnas de `empleados` que se leen en las pantallas. NUNCA usar select('*') ni select() vacío
// en esta tabla: traería la columna `cl` (contraseña) a todos los navegadores. La clave solo se
// lee con obtenerClaveEmpleado() (pantalla de edición, solo SUPERADMIN). Si agregas una columna
// nueva a la tabla y alguna pantalla la necesita, agrégala aquí.
export const COLUMNAS_EMPLEADO =
  'id, estado, dni, nombre, sexo, tipo, cargo_id, area_id, jefe_directo_id, rol, usuario, ' +
  'fch_nacimiento, fch_salida, fecha_ingreso, correo_personal, correo_ceva, correo_3m, cod_mainchart, ' +
  'hijos, celular, departamento, provincia, distrito, direccion, url_casa, coordenadas, ' +
  'grupo_sanguineo, contacto_emergencia, rubrica, ruta_movilidad, motivo_salida, foto_url';

/** Quita la contraseña de un objeto empleado (para no guardarla en Dexie ni en authUser). */
export const sinClave = (emp) => {
  if (!emp || typeof emp !== 'object' || !('cl' in emp)) return emp;
  const copia = { ...emp };
  delete copia.cl;
  return copia;
};

export const obtenerTodosLosEmpleados = async () => {
  const { data, error } = await supabase
    .from('empleados')
    .select(`
      ${COLUMNAS_EMPLEADO},
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
    .select(COLUMNAS_EMPLEADO)
    .eq('id', id)
    .maybeSingle();

  if (error) throw new Error(`Error al obtener empleado: ${error.message}`);
  return data;
};

/**
 * Clave guardada de UN empleado (para que el SUPERADMIN se la recuerde a quien la olvidó).
 * Pasa por la función SQL `obtener_clave_empleado`, que verifica en el servidor que quien la pide
 * es SUPERADMIN (ver supabase/sql/seguridad_clave_empleados.sql).
 */
export const obtenerClaveEmpleado = async (id) => {
  const { data, error } = await supabase.rpc('obtener_clave_empleado', { p_empleado_id: id });
  if (error) throw new Error(`Error al obtener la clave: ${error.message}`);
  return data || '';
};

/** Copia la clave a `empleados.cl` (al cambiarla o restablecerla). */
export const guardarClaveEmpleado = async (id, clave) => {
  const { error } = await supabase.from('empleados').update({ cl: clave }).eq('id', id);
  if (error) throw new Error(`No se pudo guardar la clave en empleados: ${error.message}`);
};

export const crearEmpleado = async (empleadoData) => {
  invalidarConsultas('catalogos:');
  const { data, error } = await supabase
    .from('empleados')
    .insert([empleadoData])
    .select(COLUMNAS_EMPLEADO)
    .single();

  if (error) throw new Error(`Error al crear empleado en BD: ${error.message}`);
  if (!data) throw new Error('No se pudo crear el empleado en la base de datos (verifica permisos RLS).');
  return data;
};

export const actualizarEmpleado = async (id, empleadoData) => {
  invalidarConsultas('catalogos:');
  // Extraemos 'id' para no intentar sobreescribir la Primary Key en el UPDATE
  const { id: _ignoreId, ...datosActualizar } = sinClave(empleadoData);

  const { data, error } = await supabase
    .from('empleados')
    .update(datosActualizar)
    .eq('id', id)
    .select(COLUMNAS_EMPLEADO)
    .maybeSingle();

  if (error) throw new Error(`Error al actualizar empleado en BD: ${error.message}`);
  if (!data) {
    throw new Error('Supabase no actualizó ningún registro. Verifica las políticas RLS (FOR UPDATE) de la tabla "empleados" o que el ID exista en el servidor.');
  }
  return data;
};

export const cambiarEstadoEmpleado = async (id, nuevoEstado) => {
  invalidarConsultas('catalogos:');
  const { data, error } = await supabase
    .from('empleados')
    .update({ estado: nuevoEstado })
    .eq('id', id)
    .select('id')
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