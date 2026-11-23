import { invalidarConsultas } from './cacheConsultas';
import { supabase } from '../config/supabaseClient';

export const obtenerPlacas = async () => {
  const { data, error } = await supabase
    .from('placas')
    .select('*')
    .order('fecha_registro', { ascending: false });

  if (error) {
    console.error('Error obteniendo placas:', error);
    throw error;
  }
  return data;
};

export const obtenerEmpresasCatalogo = async () => {
  const { data, error } = await supabase
    .from('empresas_transporte')
    .select('id, nombre_empresa')
    .order('nombre_empresa', { ascending: true });

  if (error) {
    console.error('Error obteniendo empresas:', error);
    return []; 
  }
  return data;
};

export const crearPlaca = async (payload) => {
  invalidarConsultas('catalogos:');
  const { data, error } = await supabase
    .from('placas')
    .insert([payload])
    .select();

  if (error) throw error;
  return data;
};

export const actualizarPlaca = async (id, payload) => {
  invalidarConsultas('catalogos:');
  const { data, error } = await supabase
    .from('placas')
    .update(payload)
    .eq('nro_placa', id) // PK o campo único de referencia
    .select();

  if (error) throw error;
  return data;
};

export const cambiarEstadoPlaca = async (id, payload) => {
  invalidarConsultas('catalogos:');
  const { data, error } = await supabase
    .from('placas')
    .update(payload)
    .eq('nro_placa', id)
    .select();

  if (error) throw error;
  return data;
};