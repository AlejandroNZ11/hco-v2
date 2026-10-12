import { useState, useEffect, useCallback } from 'react';

function leerCountLocal() {
  return Number(localStorage.getItem("offlineAnomaliasCount") || "0");
}

export function useSync(authUser) {
  const [pendingCount, setPendingCount] = useState(leerCountLocal());
  const [syncLoading, setSyncLoading] = useState(false);

  const actualizarBadgePendientes = useCallback((count) => {
    setPendingCount(Number(count || 0));
  }, []);

  const refrescarPendientesCabecera = useCallback(async () => {
    try {
      if (window.offlineQueue && typeof window.offlineQueue.refreshPendingCount === "function") {
        const count = await window.offlineQueue.refreshPendingCount();
        actualizarBadgePendientes(count);
        return;
      }
    } catch (error) {
      console.error("No se pudo refrescar pendientes:", error);
    }
    actualizarBadgePendientes(leerCountLocal());
  }, [actualizarBadgePendientes]);

  const sincronizarPendientes = useCallback(async (esAutomatico = false) => {
    if (!window.offlineQueue || typeof window.offlineQueue.syncPendingAnomalias !== "function") {
      actualizarBadgePendientes(leerCountLocal());
      return;
    }
    if (!navigator.onLine) {
      if (!esAutomatico) alert("No hay conexión a internet.");
      return;
    }
    setSyncLoading(true);
    try {
      const result = await window.offlineQueue.syncPendingAnomalias("PENDIENTE_DE_MIGRAR_API");
      actualizarBadgePendientes(result.pending);
      if (!esAutomatico) {
        if (result.synced > 0 && result.failed === 0) alert(`Se sincronizaron ${result.synced} registros pendientes.`);
        else if (result.synced > 0 || result.failed > 0) alert(`Sincronizados: ${result.synced} | Pendientes: ${result.pending}`);
        else alert("No hay registros pendientes por sincronizar.");
      }
    } catch (error) {
      console.error("Error sincronizando pendientes:", error);
      if (!esAutomatico) alert("No se pudo sincronizar en este momento.");
    } finally {
      setSyncLoading(false);
    }
  }, [actualizarBadgePendientes]);

  useEffect(() => {
    if (!authUser) return;
    refrescarPendientesCabecera();
    
    function handleQueueCount(event) { actualizarBadgePendientes(Number(event?.detail?.count || 0)); }
    function handleOnline() { sincronizarPendientes(true); }
    
    window.addEventListener("offline-queue-count", handleQueueCount);
    window.addEventListener("online", handleOnline);
    
    return () => {
      window.removeEventListener("offline-queue-count", handleQueueCount);
      window.removeEventListener("online", handleOnline);
    };
  }, [authUser, refrescarPendientesCabecera, actualizarBadgePendientes, sincronizarPendientes]);

  return { pendingCount, syncLoading, sincronizarPendientes };
}