import { supabase } from '../config/supabaseClient';

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
    .single();

  if (error) throw new Error(`Error al obtener empleado: ${error.message}`);
  return data;
};

export const crearEmpleado = async (empleadoData) => {
  const { data, error } = await supabase
    .from('empleados')
    .insert([empleadoData]);

  if (error) throw new Error(`Error al crear empleado: ${error.message}`);
  return data;
};

export const actualizarEmpleado = async (id, empleadoData) => {
  const { data, error } = await supabase
    .from('empleados')
    .update(empleadoData)
    .eq('id', id);

  if (error) throw new Error(`Error al actualizar empleado: ${error.message}`);
  return data;
};

export const cambiarEstadoEmpleado = async (id, nuevoEstado) => {
  const { error } = await supabase
    .from('empleados')
    .update({ estado: nuevoEstado })
    .eq('id', id);

  if (error) throw new Error(`Error al cambiar estado: ${error.message}`);
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
