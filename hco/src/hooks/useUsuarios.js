import { useLiveQuery } from 'dexie-react-hooks';
import { localDb } from '../services/localDb';
import { useNetwork } from './useNetwork'; // El hook que detecta si hay internet
import { cambiarEstadoEmpleado } from '../services/empleadosService';

export const useUsuarios = () => {
  const isOnline = useNetwork();
  
  // 1. LECTURA: Dexie alimenta la variable reactiva
  const usuarios = useLiveQuery(() => localDb.usuarios.toArray()) || [];
  const areas = useLiveQuery(() => localDb.areas.toArray()) || [];

  // 2. ESCRITURA: Función centralizada para cambiar estado
  const toggleEstado = async (item) => {
    const nuevoEstado = (item.estado || "").toLowerCase() === "activo" ? "Inactivo" : "Activo";
    
    try {
      // A. Actualiza localmente de inmediato (UI súper rápida)
      await localDb.usuarios.update(item.id, { estado: nuevoEstado });

      // B. Decide si enviar a Supabase o a la cola offline
      if (isOnline) {
        await cambiarEstadoEmpleado(item.id, nuevoEstado);
        return { success: true, message: 'Estado actualizado en el servidor.' };
      } else {
        await localDb.sync_queue.add({
          tabla: 'usuarios',
          operacion: 'UPDATE',
          payload: { id: item.id, estado: nuevoEstado }
        });
        return { success: true, message: 'Modo sin conexión. Guardado localmente.', offline: true };
      }
    } catch (error) {
      console.error("Error cambiando estado:", error);
      return { success: false, message: 'Error al actualizar el estado.' };
    }
  };

  // Puedes agregar aquí más funciones (crearUsuario, eliminarUsuario, etc.)

  return {
    usuarios,
    areas,
    toggleEstado,
    isOnline
  };
};
