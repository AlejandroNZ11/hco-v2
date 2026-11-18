import { useSupabaseRealtime } from '../../hooks/useSupabaseRealtime';
import { registrarCambioRemotoSugerencia } from '../../services/sugerenciasService';

/**
 * Tiempo real para Tarjetas de Sugerencias. Cada evento se guarda en Dexie:
 * Tracking y Pizarra (que leen con useLiveQuery) se actualizan solas.
 * Las pantallas con estado propio (Dashboard) pueden pasar `onCambio` para aplicarlo.
 *
 * @returns {'conectando'|'en_vivo'|'desconectado'}
 */
export function useSugerenciasEnVivo({ enabled = true, onReconectar, onCambio } = {}) {
  return useSupabaseRealtime(
    'tarjetas_sugerencias',
    async (cambio) => {
      const aplicado = await registrarCambioRemotoSugerencia(cambio);
      if (aplicado) onCambio?.(cambio);
    },
    { enabled, onReconectar }
  );
}
