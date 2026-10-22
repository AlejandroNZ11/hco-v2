import { supabase } from '../config/supabaseClient';
import { localDb } from './localDb';

/**
 * Devuelve la fecha y hora actual exacta en zona horaria de Lima, Perú (YYYY-MM-DD HH:mm:ss)
 */
export const obtenerFechaHoraLima = () => {
  const ahora = new Date();
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Lima',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  }).formatToParts(ahora);

  const p = {};
  partes.forEach(({ type, value }) => { p[type] = value; });
  const hora = p.hour === '24' ? '00' : p.hour;
  return `${p.year}-${p.month}-${p.day} ${hora}:${p.minute}:${p.second}`;
};

/**
 * Devuelve solo la fecha actual de Lima (YYYY-MM-DD)
 */
export const obtenerFechaCortaLima = () => {
  return obtenerFechaHoraLima().slice(0, 10);
};

/**
 * Sincroniza las sugerencias creadas o editadas en modo Offline hacia Supabase
 */
export const sincronizarSugerenciasPendientes = async () => {
  if (!navigator.onLine) return { synced: 0, failed: 0 };

  let synced = 0;
  let failed = 0;

  try {
    const pendientes = await localDb.sync_queue
      .filter(item => item.tabla === 'tarjetas_sugerencias')
      .toArray();

    if (pendientes.length === 0) return { synced: 0, failed: 0 };

    for (const item of pendientes) {
      try {
        if (item.operacion === 'INSERT') {
          const { idLocal, datos } = item.payload;
          const {
            id: _ignoreId,
            id_sugerencia: _ignoreCorrelativo,
            _sincronizado,
            ...datosParaSupabase
          } = datos;

          const { data: guardada, error } = await supabase
            .from('tarjetas_sugerencias')
            .insert([datosParaSupabase])
            .select()
            .single();

          if (error) throw error;

          if (idLocal) {
            await localDb.tarjetas_sugerencias.delete(idLocal);
          }

          await localDb.tarjetas_sugerencias.put({ ...guardada, _sincronizado: true });
          await localDb.sync_queue.delete(item.id);
          synced++;
        } else if (item.operacion === 'UPDATE') {
          const { idRegistro, cambios } = item.payload;
          const { _sincronizado, ...cambiosLimpios } = cambios;

          const { data: actualizada, error } = await supabase
            .from('tarjetas_sugerencias')
            .update(cambiosLimpios)
            .eq('id', idRegistro)
            .select()
            .single();

          if (error) throw error;

          await localDb.tarjetas_sugerencias.put({ ...actualizada, _sincronizado: true });
          await localDb.sync_queue.delete(item.id);
          synced++;
        }
      } catch (errItem) {
        console.error('Error sincronizando sugerencia individual:', errItem);
        failed++;
      }
    }
  } catch (err) {
    console.error('Error general sincronizando sugerencias:', err);
  }

  return { synced, failed };
};

/**
 * Obtiene todas las sugerencias combinando las locales (Offline) y las de Supabase
 */
export const obtenerSugerencias = async () => {
  if (navigator.onLine) {
    await sincronizarSugerenciasPendientes();

    try {
      const { data, error } = await supabase
        .from('tarjetas_sugerencias')
        .select('*')
        .order('fecha_registro', { ascending: false })
        .limit(300);

      if (!error && data) {
        const todasLocales = await localDb.tarjetas_sugerencias.toArray();
        const noSincronizadas = todasLocales.filter(
          s => s._sincronizado === false || String(s.id).startsWith('local_')
        );

        await localDb.tarjetas_sugerencias.clear();
        const remotasMarcadas = data.map(s => ({ ...s, _sincronizado: true }));
        await localDb.tarjetas_sugerencias.bulkPut([...noSincronizadas, ...remotasMarcadas]);
      }
    } catch (err) {
      console.warn('Sin conexión estable, leyendo sugerencias desde Dexie local...', err);
    }
  }

  const lista = await localDb.tarjetas_sugerencias.toArray();

  // Ordenar de más reciente a más antigua
  lista.sort((a, b) => {
    const fA = a.fecha_registro ? new Date(a.fecha_registro).getTime() : 0;
    const fB = b.fecha_registro ? new Date(b.fecha_registro).getTime() : 0;
    return fB - fA;
  });

  return lista;
};

/**
 * Obtiene una sugerencia por su UUID (Online o desde caché Dexie)
 */
export const obtenerSugerenciaPorId = async (id) => {
  if (navigator.onLine && !String(id).startsWith('local_')) {
    try {
      const { data, error } = await supabase
        .from('tarjetas_sugerencias')
        .select('*')
        .eq('id', id)
        .maybeSingle();

      if (!error && data) {
        await localDb.tarjetas_sugerencias.put({ ...data, _sincronizado: true });
        return data;
      }
    } catch (e) {
      console.warn('Leyendo detalle de sugerencia desde Dexie local...', e);
    }
  }

  return await localDb.tarjetas_sugerencias.get(id);
};

/**
 * Crea una nueva tarjeta de sugerencia (Online o en Cola Offline)
 */
export const crearSugerencia = async (payload) => {
  const fechaHoraLima = obtenerFechaHoraLima();
  const datosNuevos = {
    ...payload,
    estado: payload.estado || 'Por Validar',
    fecha_registro: payload.fecha_registro || fechaHoraLima,
    fechahora_actualiza: fechaHoraLima
  };

  if (navigator.onLine) {
    try {
      const { data, error } = await supabase
        .from('tarjetas_sugerencias')
        .insert([datosNuevos])
        .select()
        .single();

      if (!error && data) {
        await localDb.tarjetas_sugerencias.put({ ...data, _sincronizado: true });
        return { ...data, _sincronizado: true };
      }
    } catch (err) {
      console.warn('Fallo de red al crear sugerencia, guardando en modo Offline...', err);
    }
  }

  // Fallback Offline instantáneo para almacén
  const idLocal = 'local_' + Date.now();
  const registroOffline = {
    ...datosNuevos,
    id: idLocal,
    id_sugerencia: 'PENDIENTE',
    _sincronizado: false
  };

  await localDb.tarjetas_sugerencias.put(registroOffline);
  await localDb.sync_queue.add({
    tabla: 'tarjetas_sugerencias',
    operacion: 'INSERT',
    payload: { idLocal, datos: datosNuevos }
  });

  return registroOffline;
};

/**
 * Actualiza / Analiza una tarjeta de sugerencia existente (Online o Offline)
 */
export const actualizarSugerencia = async (id, cambios) => {
  const fechaHoraLima = obtenerFechaHoraLima();
  const payloadActualizado = {
    ...cambios,
    fechahora_actualiza: fechaHoraLima
  };

  // Si aún es un registro local no sincronizado
  if (String(id).startsWith('local_')) {
    const actual = await localDb.tarjetas_sugerencias.get(id);
    const fusionado = {
      ...(actual || {}),
      ...payloadActualizado,
      id,
      _sincronizado: false
    };

    await localDb.tarjetas_sugerencias.put(fusionado);

    const enCola = await localDb.sync_queue
      .filter(i => i.tabla === 'tarjetas_sugerencias' && i.payload?.idLocal === id)
      .toArray();

    for (const item of enCola) {
      await localDb.sync_queue.update(item.id, {
        payload: { idLocal: id, datos: fusionado }
      });
    }

    return fusionado;
  }

  if (navigator.onLine) {
    try {
      const { data, error } = await supabase
        .from('tarjetas_sugerencias')
        .update(payloadActualizado)
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;

      await localDb.tarjetas_sugerencias.put({ ...data, _sincronizado: true });
      return { ...data, _sincronizado: true };
    } catch (err) {
      console.warn('Fallo de red al actualizar sugerencia, encolando actualización Offline...', err);
    }
  }

  // Fallback Offline para actualización
  const previo = await localDb.tarjetas_sugerencias.get(id);
  const actualizadoLocal = {
    ...(previo || {}),
    ...payloadActualizado,
    _sincronizado: false
  };

  await localDb.tarjetas_sugerencias.put(actualizadoLocal);
  await localDb.sync_queue.add({
    tabla: 'tarjetas_sugerencias',
    operacion: 'UPDATE',
    payload: { idRegistro: id, cambios: payloadActualizado }
  });

  return actualizadoLocal;
};

/**
 * Carga rápida de Áreas y Empleados usando caché en Dexie para velocidad instantánea
 */
export const obtenerCatalogosSugerencias = async () => {
  const [localesUsuarios, localesAreas, localesCargos] = await Promise.all([
    localDb.usuarios.toArray(),
    localDb.areas.toArray(),
    localDb.cargos.toArray()
  ]);

  if (navigator.onLine) {
    try {
      const [resEmp, resAreas, resCargos] = await Promise.all([
        supabase.from('empleados').select('*').order('nombre'),
        supabase.from('areas').select('id, nombre').order('nombre'),
        supabase.from('cargos').select('id, nombre').order('nombre')
      ]);

      const empleados = !resEmp.error && resEmp.data ? resEmp.data : localesUsuarios;
      const areas = !resAreas.error && resAreas.data ? resAreas.data : localesAreas;
      const cargos = !resCargos.error && resCargos.data ? resCargos.data : localesCargos;

      if (!resEmp.error && resEmp.data) await localDb.usuarios.bulkPut(resEmp.data);
      if (!resAreas.error && resAreas.data) await localDb.areas.bulkPut(resAreas.data);
      if (!resCargos.error && resCargos.data) await localDb.cargos.bulkPut(resCargos.data);

      return { empleados, areas, cargos };
    } catch (e) {
      console.warn('Usando catálogos en caché local Dexie:', e);
    }
  }

  return {
    empleados: localesUsuarios,
    areas: localesAreas,
    cargos: localesCargos
  };
};
