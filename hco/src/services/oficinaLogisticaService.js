import { supabase } from '../config/supabaseClient';
import { localDb } from './localDb';

const TABLA = 'oficina_puestos';

const limpiar = (fila) => {
  const copia = { ...fila };
  delete copia._sincronizado;
  return copia;
};

/**
 * Sube los cambios de puestos hechos sin internet.
 * Varios cambios del mismo puesto se colapsan: gana el último.
 */
export const sincronizarPuestosPendientes = async () => {
  if (!navigator.onLine) return { synced: 0, failed: 0 };

  let synced = 0;
  let failed = 0;

  const pendientes = await localDb.sync_queue.filter((i) => i.tabla === TABLA).toArray();
  for (const item of pendientes) {
    try {
      const { data, error } = await supabase
        .from(TABLA)
        .upsert(limpiar(item.payload), { onConflict: 'id' })
        .select()
        .single();
      if (error) throw error;

      await localDb.oficina_puestos.put({ ...data, _sincronizado: true });
      await localDb.sync_queue.delete(item.id);
      synced++;
    } catch (err) {
      console.error('Error sincronizando puesto de oficina:', err);
      failed++;
    }
  }

  return { synced, failed };
};

/**
 * Descarga los puestos de Supabase a Dexie (la pantalla los lee con useLiveQuery).
 * Respeta los puestos con cambios offline sin subir.
 */
export const refrescarPuestos = async () => {
  if (!navigator.onLine) return { ok: false, offline: true };

  await sincronizarPuestosPendientes();

  const { data, error } = await supabase.from(TABLA).select('*');
  if (error) {
    console.warn('No se pudieron descargar los puestos, usando caché local:', error);
    return { ok: false, error };
  }

  const locales = await localDb.oficina_puestos.toArray();
  const sinSubir = new Set(locales.filter((p) => p._sincronizado === false).map((p) => p.id));

  await localDb.oficina_puestos.bulkPut(
    data.filter((p) => !sinSubir.has(p.id)).map((p) => ({ ...p, _sincronizado: true }))
  );
  return { ok: true };
};

/**
 * Empleados para mostrar nombre/foto en cada puesto (online → Supabase, offline → caché Dexie).
 */
const conCargoYArea = (lista, cargos, areas) => {
  const c = {};
  const a = {};
  (cargos || []).forEach((x) => { c[x.id] = x.nombre; });
  (areas || []).forEach((x) => { a[x.id] = x.nombre; });
  return (lista || []).map((e) => ({
    ...e,
    cargo: c[e.cargo_id] || (typeof e.cargo === 'string' ? e.cargo : ''),
    area: a[e.area_id] || (typeof e.area === 'string' ? e.area : ''),
  }));
};

export const obtenerEmpleadosOficina = async () => {
  if (navigator.onLine) {
    try {
      const [emp, cargos, areas] = await Promise.all([
        supabase
          .from('empleados')
          .select('id, nombre, usuario, dni, foto_url, estado, rol, cargo_id, area_id, fch_salida')
          .order('nombre'),
        supabase.from('cargos').select('id, nombre'),
        supabase.from('areas').select('id, nombre'),
      ]);
      if (!emp.error && emp.data?.length) {
        if (!cargos.error && cargos.data) await localDb.cargos.bulkPut(cargos.data);
        if (!areas.error && areas.data) await localDb.areas.bulkPut(areas.data);
        return conCargoYArea(emp.data, cargos.data, areas.data);
      }
    } catch (err) {
      console.warn('Usando empleados en caché local:', err);
    }
  }
  const [lista, cargos, areas] = await Promise.all([
    localDb.usuarios.toArray(),
    localDb.cargos.toArray(),
    localDb.areas.toArray(),
  ]);
  return conCargoYArea(lista, cargos, areas);
};

/**
 * Guarda un puesto (asignar persona, cambiar estado, nota). Online u offline.
 * Si el empleado ya estaba en otro puesto, ese puesto queda libre.
 */
export const guardarPuesto = async (id, cambios, actualizadoPor = null) => {
  const previo = (await localDb.oficina_puestos.get(id)) || { id, estado: 'en_oficina' };
  const fila = {
    ...limpiar(previo),
    ...cambios,
    id,
    actualizado_por: actualizadoPor,
    actualizado_en: new Date().toISOString(),
  };

  const filas = [fila];
  if (cambios.empleado_id) {
    const otros = await localDb.oficina_puestos
      .where('empleado_id')
      .equals(cambios.empleado_id)
      .filter((p) => p.id !== id)
      .toArray();
    otros.forEach((o) =>
      filas.unshift({ ...limpiar(o), empleado_id: null, actualizado_por: actualizadoPor, actualizado_en: fila.actualizado_en })
    );
  }

  if (navigator.onLine) {
    try {
      // Primero se liberan los puestos anteriores (índice único por empleado)
      for (const f of filas) {
        const { data, error } = await supabase.from(TABLA).upsert(f, { onConflict: 'id' }).select().single();
        if (error) throw error;
        await localDb.oficina_puestos.put({ ...data, _sincronizado: true });
      }
      return;
    } catch (err) {
      console.warn('Fallo de red al guardar puesto, guardando offline...', err);
    }
  }

  for (const f of filas) {
    await localDb.oficina_puestos.put({ ...f, _sincronizado: false });
    const enCola = await localDb.sync_queue.filter((i) => i.tabla === TABLA && i.payload?.id === f.id).toArray();
    await localDb.sync_queue.bulkDelete(enCola.map((i) => i.id));
    await localDb.sync_queue.add({ tabla: TABLA, operacion: 'UPSERT', payload: f });
  }
};

/**
 * Aplica en Dexie un evento de tiempo real de 'oficina_puestos'.
 */
export const registrarCambioRemotoPuesto = async (cambio) => {
  try {
    if (cambio.tipo === 'DELETE') {
      if (cambio.anterior?.id === undefined) return false;
      await localDb.oficina_puestos.delete(cambio.anterior.id);
      return true;
    }
    const fila = cambio.nuevo;
    if (!fila?.id) return false;

    const local = await localDb.oficina_puestos.get(fila.id);
    if (local && local._sincronizado === false) return false;

    await localDb.oficina_puestos.put({ ...fila, _sincronizado: true });
    return true;
  } catch (err) {
    console.warn('No se pudo aplicar el cambio remoto de puestos:', err);
    return false;
  }
};
