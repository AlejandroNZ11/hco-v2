import { invalidarConsultas } from './cacheConsultas';
import { supabase } from '../config/supabaseClient';

export const obtenerEmpresasTransporte = async () => {
  const { data, error } = await supabase
    .from('empresas_transporte')
    .select('*')
    .order('fecha_registro', { ascending: false });

  if (error) {
    console.error('Error obteniendo empresas de transporte:', error);
    throw error;
  }
  return data;
};

export const crearEmpresaTransporte = async (payload) => {
  invalidarConsultas('catalogos:');
  const { data, error } = await supabase
    .from('empresas_transporte')
    .insert([payload])
    .select();

  if (error) throw error;
  return data;
};

export const actualizarEmpresaTransporte = async (id, payload) => {
  invalidarConsultas('catalogos:');
  const { data, error } = await supabase
    .from('empresas_transporte')
    .update(payload)
    .eq('id', id)
    .select();

  if (error) throw error;
  return data;
};

export const cambiarEstadoEmpresaTransporte = async (id, payload) => {
  invalidarConsultas('catalogos:');
  const { data, error } = await supabase
    .from('empresas_transporte')
    .update(payload)
    .eq('id', id)
    .select();

  if (error) throw error;
  return data;
};