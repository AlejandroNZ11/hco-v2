import { invalidarConsultas } from './cacheConsultas';

import { supabase } from '../config/supabaseClient';

export const obtenerClientes = async () => {
  const { data, error } = await supabase
    .from('clientes')
    .select('*')
    .order('fecha_registro', { ascending: false });

  if (error) {
    console.error('Error obteniendo clientes:', error);
    throw error;
  }
  return data;
};

export const crearCliente = async (payload) => {
  invalidarConsultas('catalogos:');
  const { data, error } = await supabase
    .from('clientes')
    .insert([payload])
    .select();

  if (error) throw error;
  return data;
};

export const actualizarCliente = async (id, payload) => {
  invalidarConsultas('catalogos:');
  const { data, error } = await supabase
    .from('clientes')
    .update(payload)
    .eq('id', id) // PK de clientes
    .select();

  if (error) throw error;
  return data;
};

export const cambiarEstadoCliente = async (id, payload) => {
  invalidarConsultas('catalogos:');
  const { data, error } = await supabase
    .from('clientes')
    .update(payload)
    .eq('id', id)
    .select();

  if (error) throw error;
  return data;
};
