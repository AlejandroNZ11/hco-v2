import { useEffect } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { localDb } from '../services/localDb';
import { supabase } from '../config/supabaseClient'; // Tu cliente de Supabase
import { useNetwork } from './useNetwork'; // El hook de conexión creado anteriormente

export const useUsuariosDb = () => {
  const isOnline = useNetwork();
  
  // useLiveQuery escucha cambios en Dexie y actualiza React automáticamente
  const usuariosLocales = useLiveQuery(() => localDb.usuarios.toArray());

  useEffect(() => {
    // Si hay internet, descargamos los datos de Supabase y actualizamos Dexie
    const syncFromSupabase = async () => {
      if (isOnline) {
        try {
          const { data, error } = await supabase.from('usuarios').select('*');
          if (!error && data) {
            // bulkPut actualiza los existentes o inserta los nuevos
            await localDb.usuarios.bulkPut(data);
          }
        } catch (error) {
          console.error("Error sincronizando desde Supabase:", error);
        }
      }
    };

    syncFromSupabase();
  }, [isOnline]);

  return usuariosLocales;
};