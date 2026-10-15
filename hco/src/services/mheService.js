import { supabase } from '../config/supabaseClient';
import { localDb } from './localDb';

/**
 * Obtiene las últimas 50 inspecciones (Online con Supabase / Offline con Dexie)
 */
export const obtenerUltimasInspecciones = async () => {
  const online = navigator.onLine;

  if (online) {
    try {
      const [resInsp, resAreas, resEq, resCat] = await Promise.all([
        supabase.from('inspecciones').select('*').order('fecha_hora', { ascending: false }).limit(50),
        supabase.from('areas').select('id, nombre'),
        supabase.from('equipos').select('id, serie, categoria_id'),
        supabase.from('categorias_equipos').select('id, nombre')
      ]);

      if (!resInsp.error) {
        // Almacenamos caché local en Dexie
        await localDb.inspecciones.clear();
        await localDb.inspecciones.bulkPut((resInsp.data || []).map(i => ({ ...i, _sincronizado: true })));

        if (!resAreas.error) await localDb.areas.bulkPut(resAreas.data || []);
        if (!resEq.error) await localDb.equipos.bulkPut(resEq.data || []);
        if (!resCat.error) await localDb.categorias_equipos.bulkPut(resCat.data || []);

        const areasMap = Object.fromEntries((resAreas.data || []).map(a => [String(a.id), a]));
        const categoriasMap = Object.fromEntries((resCat.data || []).map(c => [String(c.id), c]));
        const equiposMap = Object.fromEntries((resEq.data || []).map(eq => [
          String(eq.id),
          { ...eq, categorias_equipos: categoriasMap[String(eq.categoria_id)] || null }
        ]));

        return (resInsp.data || []).map(insp => {
          const areaObj = areasMap[String(insp.area_id)] || null;
          return {
            ...insp,
            areas: areaObj,
            area: areaObj,
            equipos: equiposMap[String(insp.equipo_id)] || null
          };
        });
      }
    } catch (err) {
      console.warn("Sin conexión con Supabase, cargando inspecciones desde Dexie local...", err);
    }
  }

  // MODO OFFLINE: Cargamos desde Dexie
  const inspLocales = await localDb.inspecciones.orderBy('fecha_hora').reverse().limit(50).toArray();
  const allEquipos = await localDb.equipos.toArray();
  const allCategorias = await localDb.categorias_equipos.toArray();
  const allAreas = await localDb.areas.toArray();

  const areasMap = Object.fromEntries(allAreas.map(a => [String(a.id), a]));
  const categoriasMap = Object.fromEntries(allCategorias.map(c => [String(c.id), c]));
  const equiposMap = Object.fromEntries(allEquipos.map(eq => [
    String(eq.id),
    { ...eq, categorias_equipos: categoriasMap[String(eq.categoria_id)] || null }
  ]));

  return inspLocales.map(insp => {
    const areaObj = areasMap[String(insp.area_id)] || null;
    return {
      ...insp,
      areas: areaObj,
      area: areaObj,
      equipos: equiposMap[String(insp.equipo_id)] || null
    };
  });
};

/**
 * Aprueba una inspección (Online y Offline)
 */
export const aprobarInspeccionMhe = async (inspeccionId, usuarioId) => {
  const online = navigator.onLine;
  const fechaRev = new Date().toISOString();

  if (online && !String(inspeccionId).startsWith('local_')) {
    try {
      const { data, error } = await supabase
        .from('inspecciones')
        .update({
          estado_proceso: 'APROBADO',
          aprobado_por_id: usuarioId,
          revisado_el: fechaRev
        })
        .eq('id', inspeccionId)
        .select()
        .single();

      if (!error) {
        await localDb.inspecciones.update(inspeccionId, {
          estado_proceso: 'APROBADO',
          aprobado_por_id: usuarioId,
          revisado_el: fechaRev,
          _sincronizado: true
        });
        return data;
      }
    } catch (e) {
      console.warn("Fallo de red al aprobar, aplicando localmente...", e);
    }
  }

  // Modo offline local
  await localDb.inspecciones.update(inspeccionId, {
    estado_proceso: 'APROBADO',
    aprobado_por_id: usuarioId,
    revisado_el: fechaRev,
    _sincronizado: false
  });
  return { id: inspeccionId, estado_proceso: 'APROBADO', aprobado_por_id: usuarioId, revisado_el: fechaRev };
};

/**
 * Carga los catálogos base: Categorías, Equipos y Preguntas
 */
export const obtenerDatosMaestrosMhe = async () => {
  const online = navigator.onLine;

  if (online) {
    try {
      const [resCat, resEq, resPreg] = await Promise.all([
        supabase.from('categorias_equipos').select('*').order('nombre'),
        supabase.from('equipos').select('*'),
        supabase.from('items_checklist').select('*')
      ]);

      if (!resCat.error && !resEq.error && !resPreg.error) {
        await localDb.categorias_equipos.bulkPut(resCat.data || []);
        await localDb.equipos.bulkPut(resEq.data || []);
        await localDb.items_checklist.bulkPut(resPreg.data || []);

        return {
          categorias: resCat.data || [],
          equipos: resEq.data || [],
          preguntas: resPreg.data || []
        };
      }
    } catch (e) {
      console.warn("Cargando maestros desde Dexie local (offline)...", e);
    }
  }

  // Fallback offline Dexie
  const categorias = await localDb.categorias_equipos.toArray();
  const equipos = await localDb.equipos.toArray();
  const preguntas = await localDb.items_checklist.toArray();

  return { categorias, equipos, preguntas };
};

/**
 * Obtiene la última inspección realizada a un equipo específico junto con su ID y respuestas
 */
export const obtenerUltimaInspeccionEquipo = async (equipoId) => {
  const online = navigator.onLine;

  if (online) {
    try {
      const { data, error } = await supabase
        .from('inspecciones')
        .select('id, estado_mhe, observaciones_generales, fecha_hora, registrado_por_nombre')
        .eq('equipo_id', equipoId)
        .order('fecha_hora', { ascending: false })
        .limit(1)
        .single();

      if (!error && data) {
        const { data: respData } = await supabase
          .from('respuestas_inspeccion')
          .select('*')
          .eq('inspeccion_id', data.id);

        return { ...data, respuestas: respData || [] };
      }
    } catch (e) {
      console.warn("Buscando última inspección en Dexie...", e);
    }
  }

  // Fallback offline Dexie
  const localInsps = await localDb.inspecciones
    .where('equipo_id')
    .equals(String(equipoId))
    .reverse()
    .sortBy('fecha_hora');

  const ultima = localInsps[0] || null;
  if (!ultima) return null;

  const respLocal = await localDb.respuestas_inspeccion
    .where('inspeccion_id')
    .equals(ultima.id)
    .toArray();

  return { ...ultima, respuestas: respLocal };
};

/**
 * Guarda una nueva inspección y sus respuestas detalladas (Soporta Offline)
 */
export const guardarInspeccionCompleta = async (datosInspeccion, respuestasArray) => {
  const online = navigator.onLine;
  const idLocal = 'local_' + Date.now();
  const inspeccionConId = { ...datosInspeccion, id: idLocal, _sincronizado: false };

  if (online) {
    try {
      const { data: inspGuardada, error: errorInsp } = await supabase
        .from('inspecciones')
        .insert([datosInspeccion])
        .select()
        .single();

      if (!errorInsp) {
        const respuestasConId = respuestasArray.map(resp => ({
          ...resp,
          inspeccion_id: inspGuardada.id
        }));

        const { error: errorResp } = await supabase
          .from('respuestas_inspeccion')
          .insert(respuestasConId);

        if (!errorResp) {
          // Guardar copia local sincronizada
          await localDb.inspecciones.put({ ...inspGuardada, _sincronizado: true });
          const respLocales = respuestasConId.map(r => ({ ...r, _sincronizado: true }));
          await localDb.respuestas_inspeccion.bulkPut(respLocales);
          return inspGuardada;
        }
      }
    } catch (error) {
      console.warn("Error de red al guardar en Supabase, guardando localmente en Dexie...", error);
    }
  }

  // MODO OFFLINE: Guardar en Dexie y registrar en cola de sincronización
  await localDb.inspecciones.put(inspeccionConId);
  const respLocales = respuestasArray.map(resp => ({
    ...resp,
    inspeccion_id: idLocal,
    _sincronizado: false
  }));
  await localDb.respuestas_inspeccion.bulkPut(respLocales);

  // Registrar en sync_queue para subir a la nube cuando regrese el internet
  await localDb.sync_queue.add({
    tabla: 'inspecciones',
    operacion: 'INSERT',
    payload: { inspeccion: datosInspeccion, respuestas: respuestasArray }
  });

  return inspeccionConId;
};

/**
 * Obtiene una inspección por su ID
 */
export const obtenerInspeccionPorId = async (inspeccionId) => {
  const online = navigator.onLine;

  if (online && !String(inspeccionId).startsWith('local_')) {
    try {
      const [resInsp, resResp] = await Promise.all([
        supabase.from('inspecciones').select('*').eq('id', inspeccionId).single(),
        supabase.from('respuestas_inspeccion').select('*').eq('inspeccion_id', inspeccionId)
      ]);

      if (!resInsp.error) {
        return { inspeccion: resInsp.data, respuestas: resResp.data || [] };
      }
    } catch (e) {
      console.warn("Cargando inspección por ID desde Dexie...", e);
    }
  }

  // Fallback offline Dexie
  const inspeccion = await localDb.inspecciones.get(inspeccionId);
  const respuestas = await localDb.respuestas_inspeccion.where('inspeccion_id').equals(inspeccionId).toArray();
  return { inspeccion: inspeccion || {}, respuestas: respuestas || [] };
};

/**
 * Actualiza una inspección existente (Soporta Offline)
 */
export const actualizarInspeccionCompleta = async (inspeccionId, datosInspeccion, respuestasArray) => {
  const online = navigator.onLine;

  if (online && !String(inspeccionId).startsWith('local_')) {
    try {
      const { data: inspActualizada, error: errorInsp } = await supabase
        .from('inspecciones')
        .update(datosInspeccion)
        .eq('id', inspeccionId)
        .select()
        .single();

      if (!errorInsp) {
        await supabase.from('respuestas_inspeccion').delete().eq('inspeccion_id', inspeccionId);
        const respuestasConId = respuestasArray.map(resp => ({ ...resp, inspeccion_id: inspeccionId }));
        await supabase.from('respuestas_inspeccion').insert(respuestasConId);

        await localDb.inspecciones.put({ ...inspActualizada, _sincronizado: true });
        return inspActualizada;
      }
    } catch (e) {
      console.warn("Fallo de red al actualizar en Supabase, actualizando localmente...", e);
    }
  }

  // Modo offline local
  await localDb.inspecciones.update(inspeccionId, { ...datosInspeccion, _sincronizado: false });
  await localDb.respuestas_inspeccion.where('inspeccion_id').equals(inspeccionId).delete();
  const respLocales = respuestasArray.map(resp => ({ ...resp, inspeccion_id: inspeccionId, _sincronizado: false }));
  await localDb.respuestas_inspeccion.bulkPut(respLocales);

  return { id: inspeccionId, ...datosInspeccion };
};

/**
 * Sincroniza la cola local con Supabase cuando regresa el internet
 */
export const sincronizarInspeccionesPendientes = async () => {
  if (!navigator.onLine) return;
  
  try {
    const pendientes = await localDb.sync_queue.toArray();
    if (pendientes.length === 0) return;

    for (const item of pendientes) {
      if (item.tabla === 'inspecciones' && item.operacion === 'INSERT') {
        const { inspeccion, respuestas } = item.payload;
        
        // Insertamos en Supabase sin el ID temporal local
        const { id: _, ...datosSupabase } = inspeccion;
        const { data: inspGuardada, error } = await supabase
          .from('inspecciones')
          .insert([datosSupabase])
          .select()
          .single();

        if (!error && inspGuardada) {
          const respuestasConId = respuestas.map(r => ({
            ...r,
            inspeccion_id: inspGuardada.id
          }));
          await supabase.from('respuestas_inspeccion').insert(respuestasConId);

          // Borramos de la cola de pendientes local porque ya se subió con éxito
          await localDb.sync_queue.delete(item.id);
        }
      }
    }
  } catch (err) {
    console.error("Error durante la sincronización automática:", err);
  }
};

// Escucha automática de eventos de red del navegador
window.addEventListener('online', () => {
  console.log("¡Conexión restablecida! Sincronizando inspecciones pendientes...");
  sincronizarInspeccionesPendientes();
});