import { useSupabaseRealtime, aplicarCambioEnLista } from '../../hooks/useSupabaseRealtime';
import { normalizarCuadroQ, registrarCambioRemotoCuadroQ } from '../../services/cuadroQService';

/**
 * Mantiene la lista de Cuadro Q de una pantalla al día en tiempo real.
 * Lo comparten Tracking, Gráficos (pizarra) y Radar.
 *
 * @param {Function} setRegistros - setter de React de la lista de registros
 * @param {Object}   opciones
 * @param {boolean}  opciones.enabled      - activar o no la suscripción
 * @param {Function} opciones.onReconectar - recarga silenciosa tras una caída de red
 * @returns {'conectando'|'en_vivo'|'desconectado'}
 */
export function useCuadroQEnVivo(setRegistros, { enabled = true, onReconectar } = {}) {
  return useSupabaseRealtime(
    'cuadro_q',
    (cambio) => {
      registrarCambioRemotoCuadroQ(cambio);
      setRegistros((prev) => aplicarCambioEnLista(prev, cambio, { clave: 'id', transformar: normalizarCuadroQ }));
    },
    { enabled, onReconectar }
  );
}
