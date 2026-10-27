import { useState, useEffect, useCallback } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { localDb } from '../services/localDb';
import { supabase } from '../config/supabaseClient';
import { sincronizarInspeccionesPendientes } from '../services/mheService';
import { sincronizarSugerenciasPendientes } from '../services/sugerenciasService';

export function useSync(authUser) {
  const [syncLoading, setSyncLoading] = useState(false);

  // Lee en tiempo real cuántos registros hay en localDb.sync_queue
  const dexiePendingCount = useLiveQuery(
    async () => {
      // Si se está limpiando la caché, no intentamos abrir ni leer Dexie
      if (window.__IS_CLEARING_CACHE__) return 0;
      try {
        return await localDb.sync_queue.count();
      } catch {
        return 0;
      }
    },
    [],
    0
  );

  const sincronizarPendientes = useCallback(async (esAutomatico = false) => {
    // Bloqueo inmediato si el usuario presionó "Limpiar Caché y Actualizar"
    if (window.__IS_CLEARING_CACHE__) return;

    if (!navigator.onLine) {
      if (!esAutomatico) alert("No hay conexión a internet en este momento.");
      return;
    }

    setSyncLoading(true);
    let totalSynced = 0;
    let totalFailed = 0;

    try {
      // 1. Sincronizar inspecciones MHE (Cabecera + Respuestas)
      const resMhe = await sincronizarInspeccionesPendientes();
      totalSynced += resMhe?.synced || 0;
      totalFailed += resMhe?.failed || 0;

      if (window.__IS_CLEARING_CACHE__) return;

      // 2. Sincronizar tarjetas de sugerencias
      const resSug = await sincronizarSugerenciasPendientes();
      totalSynced += resSug?.synced || 0;
      totalFailed += resSug?.failed || 0;

      if (window.__IS_CLEARING_CACHE__) return;

      // 3. Sincronizar cualquier otra tabla en sync_queue (ej. usuarios / empleados)
      const otrosPendientes = await localDb.sync_queue
        .filter(
          item =>
            item.tabla !== 'inspecciones' &&
            item.tabla !== 'tarjetas_sugerencias'
        )
        .toArray();

      for (const item of otrosPendientes) {
        if (window.__IS_CLEARING_CACHE__) return;

        try {
          if (item.operacion === 'INSERT') {
            const { error } = await supabase.from(item.tabla).insert(item.payload);
            if (error) throw error;
          } else if (item.operacion === 'UPDATE') {
            const { error } = await supabase
              .from(item.tabla)
              .update(item.payload)
              .eq('id', item.payload.id);
            if (error) throw error;
          }
          await localDb.sync_queue.delete(item.id);
          totalSynced++;
        } catch (err) {
          if (window.__IS_CLEARING_CACHE__ || err?.name === 'DatabaseClosedError') return;
          console.error(`Error sincronizando tabla ${item.tabla}:`, err);
          totalFailed++;
        }
      }

      // Avisamos a las pantallas abiertas que ya se sincronizó
      window.dispatchEvent(new CustomEvent('hco-sync-completed'));

      if (!esAutomatico) {
        if (totalSynced > 0 && totalFailed === 0) {
          alert(`¡Sincronización exitosa! Se subieron ${totalSynced} registro(s) pendientes.`);
        } else if (totalSynced > 0 || totalFailed > 0) {
          alert(`Sincronizados: ${totalSynced} | Con error: ${totalFailed}`);
        } else {
          alert("No hay registros pendientes por sincronizar.");
        }
      }
    } catch (error) {
      // Ignorar silenciosamente si la base se cerró por limpieza de caché
      if (window.__IS_CLEARING_CACHE__ || error?.name === 'DatabaseClosedError') {
        return;
      }
      console.error("Error sincronizando pendientes:", error);
      if (!esAutomatico) alert("No se pudo completar la sincronización.");
    } finally {
      if (!window.__IS_CLEARING_CACHE__) {
        setSyncLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    if (!authUser || window.__IS_CLEARING_CACHE__) return;

    // Si inicia la app con internet y hay pendientes en cola, sincroniza en segundo plano
    if (navigator.onLine) {
      sincronizarPendientes(true);
    }

    const handleOnline = () => {
      if (window.__IS_CLEARING_CACHE__) return;
      console.log("Conexión recuperada: sincronizando cola pendiente...");
      sincronizarPendientes(true);
    };

    window.addEventListener("online", handleOnline);
    return () => {
      window.removeEventListener("online", handleOnline);
    };
  }, [authUser, sincronizarPendientes]);

  return {
    pendingCount: dexiePendingCount || 0,
    syncLoading,
    sincronizarPendientes
  };
}
