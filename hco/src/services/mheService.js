import { supabase } from '../config/supabaseClient';
import { localDb } from './localDb';

/**
 * Función interna para mantener sincronizado el estado_operativo en la tabla 'equipos'
 * cuando se registra o edita una inspección, sin alterar el historial.
 */

// Genera fecha y hora local real (YYYY-MM-DD HH:mm:ss) sin desfase UTC
const obtenerFechaHoraLocal = () => {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
};

const actualizarEstadoOperativoEquipo = async (equipoId, estadoMhe) => {
  if (!equipoId) return;

  const nuevoEstadoOp =
    String(estadoMhe || '').toUpperCase().trim() === 'INOPERATIVO'
      ? 'INOPERATIVO'
      : 'OPERATIVO';

  // 1. Actualizamos en Dexie local inmediatamente (funciona Online y Offline)
  try {
    await localDb.equipos.update(equipoId, {
      estado_operativo: nuevoEstadoOp
    });
  } catch (errDexie) {
    console.warn("No se pudo actualizar estado_operativo en Dexie:", errDexie);
  }

  // 2. Si hay internet, actualizamos en Supabase
  if (navigator.onLine) {
    try {
      await supabase
        .from('equipos')
        .update({ estado_operativo: nuevoEstadoOp })
        .eq('id', equipoId);
    } catch (errSupa) {
      console.warn("No se pudo actualizar estado_operativo en Supabase:", errSupa);
    }
  }
};

/**
 * Sincroniza las inspecciones guardadas en la cola offline hacia Supabase
 * respetando la fecha_hora capturada originalmente.
 */
export const sincronizarInspeccionesPendientes = async () => {
  if (!navigator.onLine) return { synced: 0, failed: 0 };

  let synced = 0;
  let failed = 0;

  try {
    const pendientes = await localDb.sync_queue
      .filter(item => item.tabla === 'inspecciones')
      .toArray();

    if (pendientes.length === 0) return { synced: 0, failed: 0 };

    for (const item of pendientes) {
      try {
        if (item.operacion === 'INSERT') {
          const { idLocal, inspeccion, respuestas } = item.payload;

          // Quitamos propiedades locales de Dexie, pero CONSERVAMOS fecha_hora capturada
          const {
            id: _id,
            _sincronizado,
            estado_proceso: _estProc,
            areas,
            area,
            equipos,
            ...datosParaSupabase
          } = inspeccion;

          // 1. Insertar cabecera en Supabase (con su fecha_hora original)
          const { data: inspGuardada, error: errorInsp } = await supabase
            .from('inspecciones')
            .insert([datosParaSupabase])
            .select()
            .single();

          if (errorInsp) throw errorInsp;

          // 2. Insertar respuestas con el ID real generado por Supabase
          const respuestasConId = (respuestas || []).map(({ local_id, _sincronizado: _s, ...r }) => ({
            ...r,
            inspeccion_id: inspGuardada.id
          }));

          const { error: errorResp } = await supabase
            .from('respuestas_inspeccion')
            .insert(respuestasConId);

          if (errorResp) throw errorResp;

          // 3. Actualizar el estado_operativo del equipo en Supabase según esta inspección
          await actualizarEstadoOperativoEquipo(
            datosParaSupabase.equipo_id,
            datosParaSupabase.estado_mhe
          );

          // 4. Reemplazar el registro temporal "local_..." por el oficial ya sincronizado
          if (idLocal) {
            await localDb.inspecciones.delete(idLocal);
            await localDb.respuestas_inspeccion.where('inspeccion_id').equals(idLocal).delete();
          }

          await localDb.inspecciones.put({ ...inspGuardada, _sincronizado: true });
          await localDb.sync_queue.delete(item.id);
          synced++;
        }
      } catch (errItem) {
        console.error("Error sincronizando inspección individual:", errItem);
        failed++;
      }
    }
  } catch (err) {
    console.error("Error general al sincronizar inspecciones MHE:", err);
  }

  return { synced, failed };
};

/**
 * Obtiene las últimas 50 inspecciones combinando las pendientes de envío (Offline) + las de Supabase
 */
export const obtenerUltimasInspecciones = async () => {
  if (navigator.onLine) {
    // Si hay red, primero intentamos subir cualquier pendiente de envío
    await sincronizarInspeccionesPendientes();

    try {
      const [resInsp, resAreas, resEq, resCat] = await Promise.all([
        supabase.from('inspecciones').select('*').order('fecha_hora', { ascending: false }).limit(50),
        supabase.from('areas').select('id, nombre'),
        // Traemos '*' de equipos para incluir estado_operativo, fecha_habilitacion, habilitado_por_id y foto_url
        supabase.from('equipos').select('*'),
        supabase.from('categorias_equipos').select('id, nombre')
      ]);

      if (!resInsp.error) {
        // Conservamos en Dexie cualquier registro local que aún no se haya sincronizado
        const todasLocales = await localDb.inspecciones.toArray();
        const noSincronizadas = todasLocales.filter(
          i => i._sincronizado === false || String(i.id).startsWith('local_')
        );

        await localDb.inspecciones.clear();
        const remotasMarcadas = (resInsp.data || []).map(i => ({ ...i, _sincronizado: true }));
        await localDb.inspecciones.bulkPut([...noSincronizadas, ...remotasMarcadas]);

        if (!resAreas.error && resAreas.data) await localDb.areas.bulkPut(resAreas.data);
        if (!resEq.error && resEq.data) await localDb.equipos.bulkPut(resEq.data);
        if (!resCat.error && resCat.data) await localDb.categorias_equipos.bulkPut(resCat.data);
      }
    } catch (err) {
      console.warn("Sin conexión a Supabase, leyendo inspecciones desde Dexie local...", err);
    }
  }

  // Leemos siempre desde Dexie (tiene tanto las pendientes de envío como las sincronizadas)
  const [todasInspecciones, allEquipos, allCategorias, allAreas] = await Promise.all([
    localDb.inspecciones.toArray(),
    localDb.equipos.toArray(),
    localDb.categorias_equipos.toArray(),
    localDb.areas.toArray()
  ]);

  // Ordenamos por fecha_hora descendente (las más recientes arriba)
  todasInspecciones.sort((a, b) => {
    const fechaA = a.fecha_hora ? new Date(a.fecha_hora).getTime() : 0;
    const fechaB = b.fecha_hora ? new Date(b.fecha_hora).getTime() : 0;
    return fechaB - fechaA;
  });

  const inspLimitadas = todasInspecciones.slice(0, 50);

  const areasMap = Object.fromEntries(allAreas.map(a => [String(a.id), a]));
  const categoriasMap = Object.fromEntries(allCategorias.map(c => [String(c.id), c]));
  const equiposMap = Object.fromEntries(allEquipos.map(eq => [
    String(eq.id),
    { ...eq, categorias_equipos: categoriasMap[String(eq.categoria_id)] || null }
  ]));

  return inspLimitadas.map(insp => {
    const areaObj = areasMap[String(insp.area_id)] || null;
    const esPendienteEnvio = insp._sincronizado === false || String(insp.id).startsWith('local_');

    let estadoProcesoVisual = 'PENDIENTE DE REVISIÓN';
    if (esPendienteEnvio) {
      estadoProcesoVisual = 'PENDIENTE DE ENVÍO';
    } else if (insp.estado_proceso === 'APROBADO') {
      estadoProcesoVisual = 'APROBADO';
    }

    return {
      ...insp,
      estado_proceso: estadoProcesoVisual,
      areas: areaObj,
      area: areaObj,
      equipos: equiposMap[String(insp.equipo_id)] || null
    };
  });
};

/**
 * Aprueba una inspección registrando quién la aprobó y la fecha/hora de revisión
 */
export const aprobarInspeccionMhe = async (inspeccionId, usuarioId) => {
  if (String(inspeccionId).startsWith('local_')) {
    throw new Error("Esta inspección está 'Pendiente de Envío'. Sincronice primero antes de aprobarla.");
  }

  const fechaRev = obtenerFechaHoraLocal();
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

  if (error) throw new Error(`Error al aprobar inspección: ${error.message}`);

  await localDb.inspecciones.update(inspeccionId, {
    estado_proceso: 'APROBADO',
    aprobado_por_id: usuarioId,
    revisado_el: fechaRev,
    _sincronizado: true
  });

  return data;
};

/**
 * Habilita un equipo que había quedado INOPERATIVO (Exclusivo QHSE y SUPERADMIN).
 * Se guarda en la tabla 'equipos' para NO alterar el registro histórico de 'inspecciones'.
 */
export const habilitarEquipoMhe = async (equipoId, usuarioId = null) => {
  if (!navigator.onLine) {
    throw new Error("Necesita conexión a internet para habilitar un equipo inoperativo.");
  }

  const fechaHab = obtenerFechaHoraLocal();

  const { data, error } = await supabase
    .from('equipos')
    .update({
      estado_operativo: 'OPERATIVO',
      fecha_habilitacion: fechaHab,
      habilitado_por_id: usuarioId
    })
    .eq('id', equipoId)
    .select()
    .single();

  if (error) throw new Error(`Error al habilitar el equipo: ${error.message}`);

  // Actualizamos también en Dexie local
  await localDb.equipos.update(equipoId, {
    estado_operativo: 'OPERATIVO',
    fecha_habilitacion: fechaHab,
    habilitado_por_id: usuarioId
  });

  return data;
};

/**
 * Carga los catálogos base: Categorías, Equipos, Preguntas y Áreas (con caché en Dexie)
 */
export const obtenerDatosMaestrosMhe = async () => {
  if (navigator.onLine) {
    try {
      const [resCat, resEq, resPreg, resAreas] = await Promise.all([
        supabase.from('categorias_equipos').select('*').order('nombre'),
        supabase.from('equipos').select('*'),
        supabase.from('items_checklist').select('*'),
        supabase.from('areas').select('id, nombre')
      ]);

      if (!resCat.error && !resEq.error && !resPreg.error) {
        await localDb.categorias_equipos.bulkPut(resCat.data || []);
        await localDb.equipos.bulkPut(resEq.data || []);
        await localDb.items_checklist.bulkPut(resPreg.data || []);
        if (!resAreas.error && resAreas.data) await localDb.areas.bulkPut(resAreas.data);

        return {
          categorias: resCat.data || [],
          equipos: resEq.data || [],
          preguntas: resPreg.data || []
        };
      }
    } catch (e) {
      console.warn("Modo offline: cargando catálogos MHE desde Dexie...", e);
    }
  }

  const [categorias, equipos, preguntas] = await Promise.all([
    localDb.categorias_equipos.toArray(),
    localDb.equipos.toArray(),
    localDb.items_checklist.toArray()
  ]);

  return { categorias, equipos, preguntas };
};

/**
 * Obtiene la última inspección realizada a un equipo específico (Online + Offline)
 * e incluye los datos actualizados del equipo (estado_operativo y fecha_habilitacion).
 */
export const obtenerUltimaInspeccionEquipo = async (equipoId) => {
  // Buscamos primero en Dexie por si el operador acaba de registrar este equipo en modo offline
  const todasLocales = (await localDb.inspecciones.toArray())
    .filter(i => String(i.equipo_id) === String(equipoId))
    .sort((a, b) => new Date(b.fecha_hora || 0).getTime() - new Date(a.fecha_hora || 0).getTime());

  let equipoActual = await localDb.equipos.get(equipoId);

  if (navigator.onLine) {
    try {
      // Consultamos en paralelo la última inspección y el estado actual del equipo en Supabase
      const [resUltimaInsp, resEquipo] = await Promise.all([
        supabase
          .from('inspecciones')
          .select('id, estado_mhe, observaciones_generales, fecha_hora, registrado_por_nombre')
          .eq('equipo_id', equipoId)
          .order('fecha_hora', { ascending: false })
          .limit(1)
          .maybeSingle(),
        supabase
          .from('equipos')
          .select('*')
          .eq('id', equipoId)
          .maybeSingle()
      ]);

      if (!resEquipo.error && resEquipo.data) {
        equipoActual = resEquipo.data;
        await localDb.equipos.put(resEquipo.data);
      }

      const data = resUltimaInsp.data;
      if (!resUltimaInsp.error && data) {
        const localMasReciente = todasLocales[0];
        if (
          localMasReciente &&
          new Date(localMasReciente.fecha_hora || 0) > new Date(data.fecha_hora || 0)
        ) {
          const respLocal = await localDb.respuestas_inspeccion
            .where('inspeccion_id')
            .equals(localMasReciente.id)
            .toArray();
          return {
            ...localMasReciente,
            equipos: equipoActual || null,
            respuestas: respLocal
          };
        }

        const { data: respData } = await supabase
          .from('respuestas_inspeccion')
          .select('*')
          .eq('inspeccion_id', data.id);

        return {
          ...data,
          equipos: equipoActual || null,
          respuestas: respData || []
        };
      }
    } catch (e) {
      console.warn("Leyendo última inspección del equipo desde Dexie...", e);
    }
  }

  const ultima = todasLocales[0] || null;
  if (!ultima) return null;

  const respLocal = await localDb.respuestas_inspeccion
    .where('inspeccion_id')
    .equals(ultima.id)
    .toArray();

  return {
    ...ultima,
    equipos: equipoActual || null,
    respuestas: respLocal
  };
};

/**
 * Guarda una nueva inspección y sus respuestas (Online o en Cola Offline con hora capturada)
 */
export const guardarInspeccionCompleta = async (datosInspeccion, respuestasArray) => {
  // Capturamos la fecha y hora exacta en que se llenó el checklist
  const fechaCapturada = datosInspeccion.fecha_hora || obtenerFechaHoraLocal();
  const datosConFecha = {
    ...datosInspeccion,
    fecha_hora: fechaCapturada
  };

  if (navigator.onLine) {
    try {
      const { data: inspGuardada, error: errorInsp } = await supabase
        .from('inspecciones')
        .insert([datosConFecha])
        .select()
        .single();

      if (!errorInsp && inspGuardada) {
        const respuestasConId = respuestasArray.map(resp => ({
          ...resp,
          inspeccion_id: inspGuardada.id
        }));

        const { error: errorResp } = await supabase
          .from('respuestas_inspeccion')
          .insert(respuestasConId);

        if (!errorResp) {
          // Actualizamos estado_operativo del equipo en Supabase y Dexie
          await actualizarEstadoOperativoEquipo(
            datosConFecha.equipo_id,
            datosConFecha.estado_mhe
          );

          await localDb.inspecciones.put({ ...inspGuardada, _sincronizado: true });
          const respLocales = respuestasConId.map(r => ({ ...r, _sincronizado: true }));
          await localDb.respuestas_inspeccion.bulkPut(respLocales);
          return { ...inspGuardada, _sincronizado: true };
        }
      }
    } catch (error) {
      console.warn("Sin conexión estable con Supabase, guardando en cola offline...", error);
    }
  }

  // MODO OFFLINE: Guardamos localmente con estado 'PENDIENTE DE ENVÍO' y hora capturada
  const idLocal = 'local_' + Date.now();
  const inspeccionOffline = {
    ...datosConFecha,
    id: idLocal,
    estado_proceso: 'PENDIENTE DE ENVÍO',
    _sincronizado: false
  };

  await localDb.inspecciones.put(inspeccionOffline);

  // Actualizamos también el equipo en Dexie local para que refleje si quedó INOPERATIVO
  await actualizarEstadoOperativoEquipo(
    datosConFecha.equipo_id,
    datosConFecha.estado_mhe
  );

  const respLocales = respuestasArray.map(resp => ({
    ...resp,
    inspeccion_id: idLocal,
    _sincronizado: false
  }));
  await localDb.respuestas_inspeccion.bulkPut(respLocales);

  await localDb.sync_queue.add({
    tabla: 'inspecciones',
    operacion: 'INSERT',
    payload: {
      idLocal,
      inspeccion: datosConFecha,
      respuestas: respuestasArray
    }
  });

  return inspeccionOffline;
};

/**
 * Obtiene una inspección por su ID junto con todas sus respuestas marcadas
 */
export const obtenerInspeccionPorId = async (inspeccionId) => {
  if (navigator.onLine && !String(inspeccionId).startsWith('local_')) {
    try {
      const [resInsp, resResp] = await Promise.all([
        supabase.from('inspecciones').select('*').eq('id', inspeccionId).single(),
        supabase.from('respuestas_inspeccion').select('*').eq('inspeccion_id', inspeccionId)
      ]);

      if (!resInsp.error) {
        return {
          inspeccion: resInsp.data,
          respuestas: resResp.data || []
        };
      }
    } catch (e) {
      console.warn("Cargando inspección por ID desde Dexie...", e);
    }
  }

  const inspeccion = await localDb.inspecciones.get(inspeccionId);
  const respuestas = await localDb.respuestas_inspeccion
    .where('inspeccion_id')
    .equals(inspeccionId)
    .toArray();

  return {
    inspeccion: inspeccion || {},
    respuestas: respuestas || []
  };
};

/**
 * Actualiza una inspección existente (Online o local pendiente de envío)
 */
export const actualizarInspeccionCompleta = async (inspeccionId, datosInspeccion, respuestasArray) => {
  // Si es una inspección local que aún no se ha enviado a Supabase
  if (String(inspeccionId).startsWith('local_')) {
    const existente = await localDb.inspecciones.get(inspeccionId);
    const actualizadaLocal = {
      ...(existente || {}),
      ...datosInspeccion,
      id: inspeccionId,
      estado_proceso: 'PENDIENTE DE ENVÍO',
      _sincronizado: false
    };

    await localDb.inspecciones.put(actualizadaLocal);
    await localDb.respuestas_inspeccion.where('inspeccion_id').equals(inspeccionId).delete();
    await localDb.respuestas_inspeccion.bulkPut(
      respuestasArray.map(r => ({ ...r, inspeccion_id: inspeccionId, _sincronizado: false }))
    );

    // Actualizamos el estado_operativo del equipo localmente
    await actualizarEstadoOperativoEquipo(
      datosInspeccion.equipo_id,
      datosInspeccion.estado_mhe
    );

    // Actualizamos también el item en sync_queue
    const itemsCola = await localDb.sync_queue
      .filter(i => i.tabla === 'inspecciones' && i.payload?.idLocal === inspeccionId)
      .toArray();

    for (const item of itemsCola) {
      await localDb.sync_queue.update(item.id, {
        payload: {
          idLocal: inspeccionId,
          inspeccion: { ...datosInspeccion, fecha_hora: existente?.fecha_hora || obtenerFechaHoraLocal() },
          respuestas: respuestasArray
        }
      });
    }

    return actualizadaLocal;
  }

  // Si ya está en Supabase
  const { data: inspActualizada, error: errorInsp } = await supabase
    .from('inspecciones')
    .update(datosInspeccion)
    .eq('id', inspeccionId)
    .select()
    .single();

  if (errorInsp) throw new Error(`Error al actualizar inspección: ${errorInsp.message}`);

  const { error: errorDel } = await supabase
    .from('respuestas_inspeccion')
    .delete()
    .eq('inspeccion_id', inspeccionId);

  if (errorDel) throw new Error(`Error al limpiar respuestas previas: ${errorDel.message}`);

  const respuestasConId = respuestasArray.map(resp => ({
    ...resp,
    inspeccion_id: inspeccionId
  }));

  const { error: errorResp } = await supabase
    .from('respuestas_inspeccion')
    .insert(respuestasConId);

  if (errorResp) throw new Error(`Error al guardar respuestas actualizadas: ${errorResp.message}`);

  // Actualizamos también el estado_operativo en la tabla equipos
  await actualizarEstadoOperativoEquipo(
    datosInspeccion.equipo_id,
    datosInspeccion.estado_mhe
  );

  await localDb.inspecciones.put({ ...inspActualizada, _sincronizado: true });
  return inspActualizada;
};
