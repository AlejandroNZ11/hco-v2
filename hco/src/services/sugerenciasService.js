import { supabase } from '../config/supabaseClient';
import { localDb } from './localDb';
import { consultaCacheada, estaFresco, marcarFresco, MIN } from './cacheConsultas';

/**
 * Convierte cualquier valor (array antiguo o string) en texto plano o null para columnas TEXT
 */
const aTextoColumna = (val) => {
  if (val === null || val === undefined) return null;
  if (Array.isArray(val)) return val[0] ? String(val[0]).trim() : null;
  const txt = String(val).trim();
  return txt !== '' ? txt : null;
};

const normalizarCamposTextoSugerencia = (obj) => {
  if (!obj || typeof obj !== 'object') return obj;
  const copia = { ...obj };
  if ('fuentes' in copia) copia.fuentes = aTextoColumna(copia.fuentes);
  if ('reconocido' in copia) copia.reconocido = aTextoColumna(copia.reconocido);
  if ('impacto' in copia) copia.impacto = aTextoColumna(copia.impacto);
  return copia;
};

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
          } = normalizarCamposTextoSugerencia(datos);

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
          const { _sincronizado, ...cambiosLimpios } = normalizarCamposTextoSugerencia(cambios);

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
  // Tracking, Pizarra y Dashboard la piden al montar: si el canal en vivo no se cayó desde la
  // última descarga, Dexie ya está al día y no se vuelven a bajar hasta 3000 filas.
  if (navigator.onLine && !estaFresco('tarjetas_sugerencias')) {
    await sincronizarSugerenciasPendientes();

    try {
      const { data, error } = await supabase
        .from('tarjetas_sugerencias')
        .select('*')
        .order('fecha_registro', { ascending: false })
        .limit(3000);

      if (!error && data) {
        const todasLocales = await localDb.tarjetas_sugerencias.toArray();
        const noSincronizadas = todasLocales.filter(
          s => s._sincronizado === false || String(s.id).startsWith('local_')
        );

        await localDb.tarjetas_sugerencias.clear();
        const remotasMarcadas = data.map(s => ({ ...s, _sincronizado: true }));
        await localDb.tarjetas_sugerencias.bulkPut([...noSincronizadas, ...remotasMarcadas]);
        marcarFresco('tarjetas_sugerencias');
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
  const datosNuevos = normalizarCamposTextoSugerencia({
    ...payload,
    estado: payload.estado || 'Por Validar',
    fecha_registro: payload.fecha_registro || fechaHoraLima,
    fechahora_actualiza: fechaHoraLima
  });

  if (navigator.onLine) {
    try {
      const { data, error } = await supabase
        .from('tarjetas_sugerencias')
        .insert([datosNuevos])
        .select()
        .single();

      if (error) throw error;

      if (data) {
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
  const payloadActualizado = normalizarCamposTextoSugerencia({
    ...cambios,
    fechahora_actualiza: fechaHoraLima
  });

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
// Solo las columnas que usan las pantallas de sugerencias (antes select('*'), que traía TODO el
// perfil de cada empleado, incluida la contraseña `cl`).
const COLUMNAS_EMPLEADO_SUG = 'id, dni, usuario, nombre, tipo, rol, estado, area_id, cargo_id, foto_url';

/** Mezcla filas parciales en Dexie sin borrar campos que otras pantallas guardaron (area, cargo…). */
const fusionarUsuariosLocales = async (filas) => {
  const existentes = await localDb.usuarios.bulkGet(filas.map((f) => f.id));
  const fusionadas = filas.map((f, i) => ({ ...(existentes[i] || {}), ...f }));
  await localDb.usuarios.bulkPut(fusionadas);
  return fusionadas;
};

const descargarCatalogosSugerencias = async () => {
  const [resEmp, resAreas, resCargos] = await Promise.all([
    supabase.from('empleados').select(COLUMNAS_EMPLEADO_SUG).order('nombre'),
    supabase.from('areas').select('id, nombre').order('nombre'),
    supabase.from('cargos').select('id, nombre').order('nombre')
  ]);
  if (resEmp.error && resAreas.error && resCargos.error) throw resEmp.error;

  const empleados = !resEmp.error && resEmp.data ? await fusionarUsuariosLocales(resEmp.data) : await localDb.usuarios.toArray();
  if (!resAreas.error && resAreas.data) await localDb.areas.bulkPut(resAreas.data);
  if (!resCargos.error && resCargos.data) await localDb.cargos.bulkPut(resCargos.data);

  return {
    empleados,
    areas: !resAreas.error && resAreas.data ? resAreas.data : await localDb.areas.toArray(),
    cargos: !resCargos.error && resCargos.data ? resCargos.data : await localDb.cargos.toArray(),
  };
};

/**
 * Catálogos de Empleados, Áreas y Cargos. Online se comparten 10 min entre las pantallas
 * de sugerencias; offline (o si falla la red) salen de Dexie.
 */
export const obtenerCatalogosSugerencias = async () => {
  if (navigator.onLine) {
    try {
      return await consultaCacheada('catalogos:sugerencias', descargarCatalogosSugerencias, 10 * MIN);
    } catch (e) {
      console.warn('Usando catálogos en caché local Dexie:', e);
    }
  }

  const [empleados, areas, cargos] = await Promise.all([
    localDb.usuarios.toArray(),
    localDb.areas.toArray(),
    localDb.cargos.toArray()
  ]);
  return { empleados, areas, cargos };
};

// =========================================================================
// TIEMPO REAL: procesa un evento de 'tarjetas_sugerencias' (actualiza Dexie)
// =========================================================================
// Tracking y Pizarra leen la lista con useLiveQuery sobre Dexie, así que basta con
// escribir aquí para que se actualicen solas. Devuelve false si no se aplicó
// (la tarjeta tiene cambios offline sin subir en este dispositivo).
export const registrarCambioRemotoSugerencia = async (cambio) => {
  try {
    if (cambio.tipo === 'DELETE') {
      if (cambio.anterior?.id === undefined) return false;
      await localDb.tarjetas_sugerencias.delete(cambio.anterior.id);
      return true;
    }

    const fila = cambio.nuevo;
    if (!fila || fila.id === undefined) return false;

    const local = await localDb.tarjetas_sugerencias.get(fila.id);
    if (local && local._sincronizado === false) return false;

    await localDb.tarjetas_sugerencias.put({ ...fila, _sincronizado: true });
    return true;
  } catch (err) {
    console.warn('No se pudo aplicar el cambio remoto de sugerencias en Dexie:', err);
    return false;
  }
};
