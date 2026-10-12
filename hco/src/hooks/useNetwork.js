import { useState, useEffect } from 'react';
import { localDb } from '../services/localDb';
import { supabase } from '../config/supabaseClient';

export const useNetwork = () => {
  const [isOnline, setIsOnline] = useState(navigator.onLine);

  useEffect(() => {
    const handleOnline = async () => {
      setIsOnline(true);
      
      // Cuando regresa el internet, leemos la cola de Dexie
      try {
        const pendingSyncs = await localDb.sync_queue.toArray();
        
        if (pendingSyncs.length > 0) {
          for (const item of pendingSyncs) {
            
            // Ejecutamos la operación pendiente en Supabase
            if (item.operacion === 'INSERT') {
              await supabase.from(item.tabla).insert(item.payload);
            } else if (item.operacion === 'UPDATE') {
              await supabase.from(item.tabla).update(item.payload).eq('id', item.payload.id);
            }
            
            // Eliminamos el registro de la cola local una vez subido con éxito
            await localDb.sync_queue.delete(item.id);
          }
          console.log("Datos sincronizados con Supabase exitosamente");
        }
      } catch (error) {
        console.error("Error al sincronizar datos pendientes:", error);
      }
    };

    const handleOffline = () => setIsOnline(false);

    // Escuchamos los eventos nativos del navegador
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  return isOnline;
};