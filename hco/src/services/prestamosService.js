import { supabase } from '../config/supabaseClient';
import { consultaCacheada, estaFresco, invalidarConsultas, marcarFresco, MIN } from './cacheConsultas';
import { subirImagenDrive } from './driveService';
import { localDb } from './localDb';

const BOOT_CACHE_KEY = 'PRESTAMOS_SUPABASE_BOOT_V2';
const TABLA_COLA = 'prestamos';

/**
 * true si el error se debe a falta de internet / red caída (y no a una validación o permiso).
 * Solo en esos casos se guarda la operación en la cola offline.
 */
export const esErrorDeRed = (err) => {
  if (typeof navigator !== 'undefined' && !navigator.onLine) return true;
  const msg = String(err?.message || err || '').toLowerCase();
  return (
    msg.includes('failed to fetch') ||
    msg.includes('networkerror') ||
    msg.includes('network request failed') ||
    msg.includes('load failed') ||
    msg.includes('fetch failed') ||
    msg.includes('failed to send a request')
  );
};

const esPrestamoLocal = (p) => String(p?.uuid || '').startsWith('local_');

// Guarda filas crudas de 'prestamos' en Dexie sin romper el flujo si IndexedDB falla
const guardarPrestamosLocal = async (filas) => {
  try {
    if (filas.length) await localDb.prestamos.bulkPut(filas);
  } catch (err) {
    console.warn('No se pudo actualizar la caché local de préstamos:', err);
  }
};

export const obtenerFechaHoraPeruISO = () => {
  const ahora = new Date();
  const opciones = {
    timeZone: 'America/Lima',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  };
  const partes = new Intl.DateTimeFormat('en-CA', opciones).formatToParts(ahora);
  const map = {};
  partes.forEach(p => { map[p.type] = p.value; });
  return `${map.year}-${map.month}-${map.day}T${map.hour}:${map.minute}:${map.second}-05:00`;
};

export const calcularFechaRetornoPeru = (fechaInicioInput, diasHabiles = 7) => {
  if (!fechaInicioInput) return null;
  const f = new Date(fechaInicioInput);
  if (isNaN(f.getTime())) return null;

  const feriadosPeru = [
    "01-01", "05-01", "06-07", "06-29", "07-23", "07-28", "07-29",
    "08-06", "08-30", "10-08", "11-01", "12-08", "12-09", "12-25",
    "04-02", "04-03"
  ];

  let agregados = 0;
  while (agregados < diasHabiles) {
    f.setDate(f.getDate() + 1);
    const diaSemana = f.getDay();
    const mesDia = `${String(f.getMonth() + 1).padStart(2, '0')}-${String(f.getDate()).padStart(2, '0')}`;
    if (diaSemana !== 0 && diaSemana !== 6 && !feriadosPeru.includes(mesDia)) {
      agregados++;
    }
  }
  return f.toISOString();
};

// Subida a Google Drive vía Edge Function `subir-drive` (los secretos viven en Supabase)
export const subirImagenADrive = (dataUrlBase64, nombreArchivo) =>
  subirImagenDrive(dataUrlBase64, nombreArchivo, { destino: 'prestamos' });

const esRegistroActivo = (item) => {
  if (typeof item.activo === 'boolean') return item.activo;
  if (item.estado) return String(item.estado).toUpperCase().trim() === 'ACTIVO';
  return true;
};

// =========================================================================
// 1. OBTENER DATOS MAESTROS (INCLUYE EMPLEADOS Y ÁREAS)
// =========================================================================
const descargarMaestrosPrestamos = async () => {
  // Sin internet: ir directo a la caché, sin esperar a que fallen 7 peticiones
  if (!navigator.onLine) {
    try {
      const cache = localStorage.getItem(BOOT_CACHE_KEY);
      if (cache) return JSON.parse(cache);
    } catch {
      // caché corrupta: se intenta online abajo
    }
  }

  try {
    const [resEmp, resCond, resPlac, resCli, resTip, resEmpleados, resAreas] = await Promise.all([
      supabase.from('empresas_transporte').select('*'),
      supabase.from('conductores').select('*'),
      supabase.from('placas').select('*'),
      supabase.from('clientes').select('*'),
      supabase.from('tipos_paleta').select('*'),
      supabase.from('empleados').select('nombre, usuario, dni, area_id'),
      supabase.from('areas').select('*')
    ]);

    if (resEmp.error && resCond.error && resPlac.error) {
      throw new Error(resEmp.error.message);
    }

    const empresasActivas = (resEmp.data || []).filter(esRegistroActivo);
    const conductoresActivos = (resCond.data || []).filter(esRegistroActivo);
    const placasActivas = (resPlac.data || []).filter(esRegistroActivo);
    const clientesActivos = (resCli.data || []).filter(esRegistroActivo);
    const tiposPaleta = resTip.data || [];
    const empleados = resEmpleados.data || [];
    const areas = resAreas.data || [];

    const empresas = empresasActivas.sort((a, b) =>
      String(a.nombre_empresa || '').localeCompare(String(b.nombre_empresa || ''), 'es', { sensitivity: 'base' })
    );

    const empresasMap = {};
    for (let i = 0; i < empresas.length; i++) {
      empresasMap[empresas[i].id] = empresas[i].nombre_empresa;
    }

    const conductores = conductoresActivos
      .map(c => ({
        dni_conductor: String(c.dni_conductor || '').trim(),
        nombre_conductor: String(c.nombre_conductor || '').trim(),
        empresa_id: c.empresa_id,
        empresa_nombre: empresasMap[c.empresa_id] || ''
      }))
      .sort((a, b) => a.nombre_conductor.localeCompare(b.nombre_conductor, 'es', { sensitivity: 'base' }));

    const placas = placasActivas
      .map(p => ({
        nro_placa: String(p.nro_placa || '').trim().toUpperCase(),
        empresa_id: p.empresa_id,
        volumen_m3: p.volumen_m3,
        empresa_nombre: empresasMap[p.empresa_id] || ''
      }))
      .sort((a, b) => a.nro_placa.localeCompare(b.nro_placa, 'es', { sensitivity: 'base' }));

    const clientes = clientesActivos.sort((a, b) =>
      String(a.nombre_cliente || '').localeCompare(String(b.nombre_cliente || ''), 'es', { sensitivity: 'base' })
    );

    const tipos_paleta = tiposPaleta.sort((a, b) =>
      String(a.nombre_tipo || '').localeCompare(String(b.nombre_tipo || ''), 'es', { sensitivity: 'base' })
    );

    const dataMaestra = { empresas, conductores, placas, clientes, tipos_paleta, empleados, areas };

    try {
      localStorage.setItem(BOOT_CACHE_KEY, JSON.stringify(dataMaestra));
    } catch {}

    return dataMaestra;
  } catch (error) {
    console.warn('Cargando catálogos desde caché local...', error);
    try {
      const cache = localStorage.getItem(BOOT_CACHE_KEY);
      if (cache) return JSON.parse(cache);
    } catch {}
    throw error;
  }
};

/**
 * Catálogos de préstamos (7 tablas). Se comparten 3 min entre pantallas y recargas silenciosas
 * (antes se pedían las 7 tablas en cada montaje, reconexión y sincronización).
 * Se invalidan al crear/editar conductores, placas, clientes o empresas.
 */
export const obtenerDatosMaestrosPrestamos = () => consultaCacheada('catalogos:prestamos', descargarMaestrosPrestamos, 3 * MIN);

// =========================================
// 2. CREAR PRÉSTAMO PALLET
// =========================================
const AREAS_INVALIDAS = ['OUTBOUND PRINCIPAL', 'OUTBOUND RETAIL', 'CLIENTE RECOGE', 'OPERACIONES', 'OUTBOUND', 'EMPTY', ''];

/**
 * Arma la fila a insertar en 'prestamos' (parte síncrona, sin consultas a la BD).
 * La usan tanto el registro online como el registro offline (fila provisional en Dexie).
 */
const construirDatosPrestamo = (payload, ahoraISO, { empresaId, areaFinal }) => {
  const esClienteRecoge = payload.area_proceso === 'CLIENTE RECOGE';
  const esOutboundPrincipal = payload.area_proceso === 'OUTBOUND PRINCIPAL';
  const esRegistroParcial = esClienteRecoge || esOutboundPrincipal;

  const retornaBool = payload.retorno === 'SI' || payload.retorno === true;
  const estadoInicial = esRegistroParcial
    ? 'Por despachar'
    : (retornaBool ? 'Pendiente' : 'NO RETORNO');

  const fechaRetornoISO = (!esRegistroParcial && retornaBool)
    ? calcularFechaRetornoPeru(ahoraISO, 7)
    : null;

  let dniConductorFinal = payload.dni_conductor || null;
  let nroPlacaFinal = String(payload.nro_placa || '').trim().toUpperCase();
  let observacionFinal = payload.observacion_salida || '';

  if (esClienteRecoge) {
    dniConductorFinal = null;
    const metaRecoge = [];
    if (payload.conductor_nombre) metaRecoge.push(`[CONDUCTOR RECOGE: ${payload.conductor_nombre.trim().toUpperCase()}]`);
    if (nroPlacaFinal) metaRecoge.push(`[PLACA RECOGE: ${nroPlacaFinal}]`);
    nroPlacaFinal = null; 

    const prefixRecoge = metaRecoge.join(' ');
    observacionFinal = observacionFinal ? `${prefixRecoge} - ${observacionFinal}` : prefixRecoge;
  }

  if (Array.isArray(payload.clientes_multiples) && payload.clientes_multiples.length > 0) {
    const listadoTexto = payload.clientes_multiples.join(', ');
    observacionFinal = observacionFinal
      ? `[CLIENTES: ${listadoTexto}] - ${observacionFinal}`
      : `[CLIENTES: ${listadoTexto}]`;
  }

  return {
    fecha_entrega: ahoraISO,
    fecha_retorno: fechaRetornoISO,
    empresa_transporte_id: empresaId,
    dni_conductor: dniConductorFinal,
    nr_ruta: String(payload.nr_ruta || '').trim(),
    nro_placa: nroPlacaFinal,
    despachador: payload.despachador || (esRegistroParcial ? 'Por despachar' : payload.usuario_registra),
    nr_paletas: Number(payload.nr_paletas || 0),
    estado: estadoInicial,
    nr_paletas_devueltas: 0,
    fecha_devolucion: (!esRegistroParcial && !retornaBool) ? ahoraISO : null,
    observacion_salida: observacionFinal,
    cliente_id: payload.cliente_id || null,
    tipo_paleta_id: payload.tipo_paleta_id ? Number(payload.tipo_paleta_id) : null,
    area_registrador: areaFinal, // <-- GUARDA EL NOMBRE EXACTO DE LA TABLA 'areas'
    area_proceso: payload.area_proceso,
    retorno: retornaBool,
    usuario_registra: payload.usuario_registra,
    usuario_actualiza: null
  };
};

/**
 * Sube firma/foto de salida a Drive y las guarda en el préstamo ya creado.
 * Si falla por red, encola la subida para más tarde: el préstamo YA existe y no se duplica.
 */
const subirImagenesSalida = async (prestamo, { firma_conductor_base64, foto_salida_base64 }) => {
  if (!firma_conductor_base64 && !foto_salida_base64) return prestamo;
  try {
    return await subirImagenesSalidaEstricto(prestamo, { firma_conductor_base64, foto_salida_base64 });
  } catch (err) {
    // El préstamo ya está guardado: NO lanzamos el error (el usuario reintentaría y se duplicaría).
    // La subida queda en cola y se reintenta en la próxima sincronización.
    console.warn('No se pudieron subir las imágenes de salida; quedan en cola.', err);
    await localDb.sync_queue.add({
      tabla: TABLA_COLA,
      operacion: 'ACCION',
      payload: { tipo: 'imagenes_salida', uuid: prestamo.uuid, datos: { firma_conductor_base64, foto_salida_base64 } }
    });
    return prestamo;
  }
};

// Registro directo en Supabase (lo usa el flujo online y la sincronización de la cola)
const crearPrestamoPalletOnline = async (payload, { fechaEntregaISO } = {}) => {
  const ahoraISO = fechaEntregaISO || obtenerFechaHoraPeruISO();

  let empresaIdFinal = payload.empresa_transporte_id ? Number(payload.empresa_transporte_id) : null;
  if (payload.area_proceso === 'CLIENTE RECOGE' && !empresaIdFinal) {
    empresaIdFinal = await obtenerOcrearEmpresaOther(payload.usuario_registra);
  }

  // RESOLVER EL ÁREA REAL DESDE LA TABLA 'areas' (NUNCA USAR AREA_PROCESO)
  let areaFinal = String(payload.area_registrador || '').trim();
  if (AREAS_INVALIDAS.includes(areaFinal.toUpperCase())) {
    const areaDetectada = await obtenerAreaEmpleadoPorIdentificador(payload.usuario_registra);
    areaFinal = areaDetectada || '';
  }

  const datosInsertar = construirDatosPrestamo(payload, ahoraISO, { empresaId: empresaIdFinal, areaFinal });

  const { data: prestamoCreado, error: errorInsert } = await supabase
    .from('prestamos')
    .insert([datosInsertar])
    .select()
    .single();

  if (errorInsert) {
    throw new Error(`Error en Supabase: ${errorInsert.message}`);
  }

  const final = await subirImagenesSalida(prestamoCreado, payload);
  await guardarPrestamosLocal([{ ...final, _sincronizado: true }]);
  return final;
};

/**
 * Crea un préstamo. Con internet va directo a Supabase; si no hay red (o se cae a mitad),
 * lo guarda en Dexie + sync_queue y se sube solo al volver la conexión.
 * El objeto devuelto trae `_sincronizado: false` cuando quedó pendiente.
 */
export const crearPrestamoPallet = async (payload) => {
  if (navigator.onLine) {
    try {
      return await crearPrestamoPalletOnline(payload);
    } catch (err) {
      if (!esErrorDeRed(err)) throw err;
      console.warn('Fallo de red al crear préstamo, guardando en modo offline...', err);
    }
  }

  const ahoraISO = obtenerFechaHoraPeruISO();
  const idLocal = `local_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const filaLocal = {
    ...construirDatosPrestamo(payload, ahoraISO, {
      empresaId: payload.empresa_transporte_id ? Number(payload.empresa_transporte_id) : null,
      areaFinal: String(payload.area_registrador || '').trim()
    }),
    uuid: idLocal,
    id_prestamo: 'PENDIENTE',
    _sincronizado: false
  };

  await localDb.prestamos.put(filaLocal);
  await localDb.sync_queue.add({
    tabla: TABLA_COLA,
    operacion: 'INSERT',
    payload: { idLocal, fechaEntregaISO: ahoraISO, datos: payload }
  });

  return filaLocal;
};

// =========================================================================
// 3. OBTENER TRACKING (EXTRAE CONDUCTOR Y PLACA DE CLIENTE RECOGE)
// =========================================================================
const ordenarPorFechaEntrega = (filas) =>
  filas.sort((a, b) => new Date(b.fecha_entrega || 0) - new Date(a.fecha_entrega || 0));

/**
 * Filas crudas de 'prestamos'. Online: Supabase + caché en Dexie.
 * Offline o red caída: lo último guardado en Dexie (incluye los pendientes de subir).
 */
export const obtenerFilasPrestamos = async () => {
  // Si el canal en vivo de 'prestamos' no se ha caído desde la última descarga, Dexie ya está al día
  if (navigator.onLine && !estaFresco('prestamos')) {
    try {
      const { data, error } = await supabase
        .from('prestamos')
        .select('*')
        .order('fecha_entrega', { ascending: false });

      if (error) throw new Error(`Error al cargar tracking: ${error.message}`);

      let pendientes = [];
      try {
        pendientes = await localDb.prestamos.filter(p => p._sincronizado === false).toArray();
      } catch {
        // Dexie no disponible: se muestran solo los datos del servidor
      }
      const uuidsPendientes = new Set(pendientes.map(p => p.uuid));

      const remotas = (data || [])
        .filter(r => !uuidsPendientes.has(r.uuid))
        .map(r => ({ ...r, _sincronizado: true }));

      try {
        await localDb.transaction('rw', localDb.prestamos, async () => {
          await localDb.prestamos.clear();
          await localDb.prestamos.bulkPut([...remotas, ...pendientes]);
        });
      } catch (err) {
        console.warn('No se pudo refrescar la caché local de préstamos:', err);
      }

      marcarFresco('prestamos');
      return ordenarPorFechaEntrega([...pendientes, ...remotas]);
    } catch (err) {
      if (!esErrorDeRed(err)) throw err;
      console.warn('Sin conexión estable, leyendo préstamos desde Dexie local...', err);
    }
  }

  return ordenarPorFechaEntrega(await localDb.prestamos.toArray());
};

/**
 * Prepara los mapas de catálogos una sola vez para formatear muchas filas
 * (o una sola fila que llega por tiempo real).
 */
export const crearFormateadorPrestamos = (maestros = {}) => {
  const empMap = Object.fromEntries((maestros.empresas || []).map(e => [String(e.id), e.nombre_empresa]));
  const condMap = Object.fromEntries((maestros.conductores || []).map(c => [String(c.dni_conductor), c.nombre_conductor]));
  const cliMap = Object.fromEntries((maestros.clientes || []).map(c => [String(c.id), c.nombre_cliente]));
  const tipMap = Object.fromEntries((maestros.tipos_paleta || []).map(t => [String(t.id), t.nombre_tipo]));

  // Mapa id -> nombre de la tabla areas
  const areasMap = Object.fromEntries(
    (maestros.areas || []).map(a => [String(a.id), a.nombre || ''])
  );

  // Mapa empleado (dni, usuario, nombre) -> nombre del área
  const empAreaMap = {};
  (maestros.empleados || []).forEach(emp => {
    const areaNombre = areasMap[String(emp.area_id)] || '';
    if (emp.dni) empAreaMap[String(emp.dni).trim()] = areaNombre;
    if (emp.usuario) empAreaMap[String(emp.usuario).toLowerCase().trim()] = areaNombre;
    if (emp.nombre) empAreaMap[String(emp.nombre).toLowerCase().trim()] = areaNombre;
  });

  return (row) => {
    const hoy = new Date();
    const noRetornoAcumulado = Number(row.nr_paletas_noretorno || 0);
    const devueltasAcumuladas = Number(row.nr_paletas_devueltas || 0);
    const prestadas = Number(row.nr_paletas || 0);
    const fRetorno = row.fecha_retorno ? new Date(row.fecha_retorno) : calcularFechaRetornoPeru(row.fecha_entrega, 7);
    const fechaRetornoDate = fRetorno ? new Date(fRetorno) : null;
    const estaCerrado = ['Devuelto', 'NO RETORNO', 'Cerrado mixto', 'Por despachar'].includes(row.estado);
    const atrasado = !estaCerrado && fechaRetornoDate && hoy > fechaRetornoDate;

    const paletasPendientesCalc = (row.estado === 'NO RETORNO') 
      ? 0 
      : Math.max(0, prestadas - devueltasAcumuladas - noRetornoAcumulado);

    let conductorFinal = condMap[String(row.dni_conductor)] || row.dni_conductor || '';
    if (!conductorFinal && row.observacion_salida) {
      const matchConductor = row.observacion_salida.match(/\[CONDUCTOR RECOGE:\s*([^\]]+)\]/i);
      if (matchConductor) conductorFinal = matchConductor[1].trim();
    }

    let placaFinal = row.nro_placa || '';
    if (!placaFinal && row.observacion_salida) {
      const matchPlaca = row.observacion_salida.match(/\[PLACA RECOGE:\s*([^\]]+)\]/i);
      if (matchPlaca) placaFinal = matchPlaca[1].trim();
    }

    // Corregir valores guardados incorrectamente (CLIENTE RECOGE, OUTBOUND RETAIL, EMPTY, etc.)
    let areaRegistradorFinal = String(row.area_registrador || '').trim();
    const esInvalido = ['OUTBOUND PRINCIPAL', 'OUTBOUND RETAIL', 'CLIENTE RECOGE', 'OPERACIONES', 'OUTBOUND', 'EMPTY', ''].includes(areaRegistradorFinal.toUpperCase());

    if (esInvalido && row.usuario_registra) {
      const areaRecuperada = empAreaMap[String(row.usuario_registra).toLowerCase().trim()] || '';
      if (areaRecuperada) areaRegistradorFinal = areaRecuperada;
    }

    return {
      ...row,
      nro_placa: placaFinal || '-',
      paletas_pendientes: paletasPendientesCalc,
      empresa_transporte_nombre: empMap[String(row.empresa_transporte_id)] || (row.empresa_transporte_id === 0 ? 'OTHER' : ''),
      conductor_nombre: conductorFinal || '-',
      conductor_retorno_nombre: condMap[String(row.conductor_retorno)] || row.conductor_retorno || '',
      cliente_nombre: cliMap[String(row.cliente_id)] || '',
      tipo_paleta_nombre: tipMap[String(row.tipo_paleta_id)] || '',
      area_registrador: areaRegistradorFinal || '-',
      fecha_retorno_calculada: fechaRetornoDate ? fechaRetornoDate.toISOString() : null,
      atrasado
    };
  };
};

export const obtenerTrackingPrestamos = async (maestrosPreCargados = null) => {
  const [filas, maestros] = await Promise.all([
    obtenerFilasPrestamos(),
    maestrosPreCargados ? Promise.resolve(maestrosPreCargados) : obtenerDatosMaestrosPrestamos()
  ]);

  return filas.map(crearFormateadorPrestamos(maestros));
};

/**
 * Procesa un evento de tiempo real de la tabla 'prestamos': actualiza la caché de Dexie.
 * Devuelve false si el préstamo tiene cambios offline sin subir (la pantalla debe
 * conservar la versión local hasta que se sincronice).
 */
export const registrarCambioRemotoPrestamo = async (cambio) => {
  try {
    if (cambio.tipo === 'DELETE') {
      if (cambio.anterior?.uuid) await localDb.prestamos.delete(cambio.anterior.uuid);
      return true;
    }
    if (!cambio.nuevo?.uuid) return true;

    const local = await localDb.prestamos.get(cambio.nuevo.uuid);
    if (local && local._sincronizado === false) return false;

    await localDb.prestamos.put({ ...cambio.nuevo, _sincronizado: true });
  } catch (err) {
    console.warn('No se pudo aplicar el cambio remoto en Dexie:', err);
  }
  return true;
};



// =========================================================================
// 2.1 COMPLETAR DESPACHO AUXILIAR (FASE 2)
// =========================================================================
const calcularDespachoAuxiliar = (prestamoActual, payload, ahoraISO, { urlFirmaSalida, urlFotoSalida }) => {
  const nrPaletasNum = Number(payload.nr_paletas || 0);
  const retornaBool = nrPaletasNum === 0 ? false : (payload.retorno === 'SI' || payload.retorno === true);
  const estadoFinal = retornaBool ? 'Pendiente' : 'NO RETORNO';
  const fechaRetornoISO = retornaBool ? calcularFechaRetornoPeru(ahoraISO, 7) : null;

  const obsPrevia = String(prestamoActual.observacion_salida || '').trim();
  const obsNueva = String(payload.observacion_salida || '').trim();
  const obsFinal = obsPrevia && obsNueva && !obsPrevia.includes(obsNueva)
    ? `${obsPrevia} | ${obsNueva}`
    : (obsNueva || obsPrevia);

  return {
    despachador: payload.usuario_actualiza || prestamoActual.despachador, // <-- AHORA SE ACTUALIZA EL DESPACHADOR CON EL AUXILIAR
    nr_paletas: Number(payload.nr_paletas || 0),
    retorno: retornaBool,
    estado: estadoFinal,
    fecha_retorno: fechaRetornoISO,
    fecha_devolucion: retornaBool ? null : ahoraISO,
    observacion_salida: obsFinal,
    firma_conductor: urlFirmaSalida || null,
    foto_salida: urlFotoSalida || null,
    usuario_actualiza: payload.usuario_actualiza,
    fecha_actualiza: ahoraISO
  };
};

const completarDespachoAuxiliarOnline = async (prestamoActual, payload) => {
  const ahoraISO = obtenerFechaHoraPeruISO();
  const idPrestamo = prestamoActual.id_prestamo;

  const [urlFirmaSalida, urlFotoSalida] = await Promise.all([
    payload.firma_conductor_base64
      ? subirImagenADrive(payload.firma_conductor_base64, `firma_${idPrestamo}_salida_${Date.now()}.png`)
      : Promise.resolve(prestamoActual.firma_conductor || ''),
    payload.foto_salida_base64
      ? subirImagenADrive(payload.foto_salida_base64, `foto_${idPrestamo}_salida_${Date.now()}.png`)
      : Promise.resolve(prestamoActual.foto_salida || '')
  ]);

  const camposActualizar = calcularDespachoAuxiliar(prestamoActual, payload, ahoraISO, { urlFirmaSalida, urlFotoSalida });

  const { data, error } = await supabase
    .from('prestamos')
    .update(camposActualizar)
    .eq('uuid', prestamoActual.uuid)
    .select()
    .single();

  if (error) throw new Error(`Error al completar despacho: ${error.message}`);
  return data;
};

const calcularDevolucion = (prestamoActual, payload, ahoraISO, { urlFirmaRetorno }) => {
  const nrPaletasPrestadas = Number(prestamoActual.nr_paletas || 0);
  const devueltasAnteriores = Number(prestamoActual.nr_paletas_devueltas || 0);
  const noRetornoAnteriores = Number(prestamoActual.nr_paletas_noretorno || 0);

  const devuelveAhora = Number(payload.cantidad_devuelta || 0);
  const noRetornoAhora = Number(payload.cantidad_noretorno || 0);
  const tipoAccion = payload.tipo_accion || 'devolucion';

  let totalDevueltas = devueltasAnteriores + devuelveAhora;
  let totalNoRetorno = noRetornoAnteriores + noRetornoAhora;
  let nuevoEstado = prestamoActual.estado;
  let fechaDevolucion = prestamoActual.fecha_devolucion;

  // Si se selecciona explícitamente "NO RETORNO", todo el saldo pendiente restante pasa a No Retorno
  if (tipoAccion === 'no_retorno') {
    totalNoRetorno = Math.max(0, nrPaletasPrestadas - totalDevueltas);
  }

  // MISMA LÓGICA UNIVERSAL PARA RETAIL Y PRINCIPAL:
  const totalLiquidado = totalDevueltas + totalNoRetorno;
  const pendientesRestantes = nrPaletasPrestadas - totalLiquidado;

  if (pendientesRestantes <= 0) {
    // Liquidado al 100% (pendientes = 0)
    if (totalDevueltas > 0 && totalNoRetorno > 0) {
      nuevoEstado = 'Cerrado mixto'; // DEVUELTAS + NO RETORNO = PRESTADAS
    } else if (totalDevueltas === 0 && totalNoRetorno > 0) {
      nuevoEstado = 'NO RETORNO';    // 100% no retorno
    } else {
      nuevoEstado = 'Devuelto';      // 100% devuelto
    }
    fechaDevolucion = ahoraISO;
  } else {
    // Aún quedan paletas pendientes por regularizar
    nuevoEstado = 'Devolución Parcial';
    fechaDevolucion = null;
  }

  return {
    estado: nuevoEstado,
    nr_paletas_devueltas: totalDevueltas,
    nr_paletas_noretorno: totalNoRetorno,
    fecha_devolucion: fechaDevolucion,
    recibido_por: payload.recibido_por,
    observacion_regreso: payload.observacion_regreso || prestamoActual.observacion_regreso,
    conductor_retorno: payload.dni_conductor_retorno || prestamoActual.conductor_retorno || null,
    firma_retorno: urlFirmaRetorno,
    usuario_actualiza: payload.usuario_actualiza,
    fecha_actualiza: ahoraISO
  };
};

const registrarDevolucionOnline = async (prestamoActual, payload) => {
  const ahoraISO = obtenerFechaHoraPeruISO();
  const idPrestamo = prestamoActual.id_prestamo;

  let urlFirmaRetorno = prestamoActual.firma_retorno || null;
  if (payload.firma_retorno_base64) {
    const nombreFirmaRegreso = `firma_${idPrestamo}_regreso_${Date.now()}.png`;
    urlFirmaRetorno = await subirImagenADrive(payload.firma_retorno_base64, nombreFirmaRegreso);
  }

  const camposActualizar = calcularDevolucion(prestamoActual, payload, ahoraISO, { urlFirmaRetorno });

  const { data, error } = await supabase
    .from('prestamos')
    .update(camposActualizar)
    .eq('uuid', prestamoActual.uuid)
    .select()
    .single();

  if (error) throw new Error(`Error al actualizar préstamo: ${error.message}`);
  return data;
};

export const buscarConductorPorDni = async (dni) => {
  const dniLimpio = String(dni || '').trim();
  const { data, error } = await supabase
    .from('conductores')
    .select('*')
    .eq('dni_conductor', dniLimpio)
    .maybeSingle();

  if (error) throw error;
  return data;
};

export const guardarConductorMaestro = async ({ dni, nombre, empresa_id, usuario }) => {
  invalidarConsultas('catalogos:prestamos');
  const ahoraISO = obtenerFechaHoraPeruISO();
  const dniLimpio = String(dni || '').trim();
  const nombreMayus = String(nombre || '').trim().toUpperCase();
  const empIdNum = Number(empresa_id);

  const existente = await buscarConductorPorDni(dniLimpio);

  if (existente) {
    const { data, error } = await supabase
      .from('conductores')
      .update({
        nombre_conductor: nombreMayus,
        empresa_id: empIdNum,
        usuario_actualiza: usuario,
        fecha_actualiza: ahoraISO,
        activo: true,
        estado: 'ACTIVO'
      })
      .eq('dni_conductor', dniLimpio)
      .select()
      .single();

    if (error) throw new Error(error.message);
    return { accion: 'actualizado', conductor: data };
  } else {
    const { data, error } = await supabase
      .from('conductores')
      .insert([{
        dni_conductor: dniLimpio,
        nombre_conductor: nombreMayus,
        empresa_id: empIdNum,
        usuario_registra: usuario,
        fecha_registro: ahoraISO,
        activo: true,
        estado: 'ACTIVO'
      }])
      .select()
      .single();

    if (error) throw new Error(error.message);
    return { accion: 'creado', conductor: data };
  }
};

export const buscarPlacaPorNro = async (nroPlaca) => {
  const placaLimpia = String(nroPlaca || '').replace(/[^A-Z0-9]/gi, '').toUpperCase();
  const { data, error } = await supabase
    .from('placas')
    .select('*')
    .eq('nro_placa', placaLimpia)
    .maybeSingle();

  if (error) throw error;
  return data;
};

export const guardarPlacaMaestra = async ({ nro_placa, empresa_id, volumen_m3, usuario }) => {
  invalidarConsultas('catalogos:prestamos');
  const ahoraISO = obtenerFechaHoraPeruISO();
  const placaLimpia = String(nro_placa || '').replace(/[^A-Z0-9]/gi, '').toUpperCase();
  const empIdNum = Number(empresa_id);

  const existente = await buscarPlacaPorNro(placaLimpia);

  if (existente) {
    const camposUpdate = {
      empresa_id: empIdNum,
      usuario_actualiza: usuario,
      fecha_actualiza: ahoraISO,
      activo: true,
      estado: 'ACTIVO'
    };
    if (volumen_m3 !== undefined && volumen_m3 !== '') camposUpdate.volumen_m3 = Number(volumen_m3);

    const { data, error } = await supabase
      .from('placas')
      .update(camposUpdate)
      .eq('nro_placa', placaLimpia)
      .select()
      .single();

    if (error) throw new Error(error.message);
    return { accion: 'actualizada', placa: data };
  } else {
    const nuevoRegistro = {
      nro_placa: placaLimpia,
      empresa_id: empIdNum,
      usuario_registra: usuario,
      fecha_registro: ahoraISO,
      activo: true,
      estado: 'ACTIVO'
    };
    if (volumen_m3 !== undefined && volumen_m3 !== '') nuevoRegistro.volumen_m3 = Number(volumen_m3);

    const { data, error } = await supabase
      .from('placas')
      .insert([nuevoRegistro])
      .select()
      .single();

    if (error) throw new Error(error.message);
    return { accion: 'creada', placa: data };
  }
};

export const obtenerOcrearEmpresaOther = async (usuario) => {
  invalidarConsultas('catalogos:prestamos');
  const ahoraISO = obtenerFechaHoraPeruISO();
  const { data: existente } = await supabase
    .from('empresas_transporte')
    .select('id')
    .or('nombre_empresa.ilike.%OTHER%,nombre_empresa.ilike.%OTRO%')
    .maybeSingle();

  if (existente) return existente.id;

  const { data: nueva, error } = await supabase
    .from('empresas_transporte')
    .insert([{
      nombre_empresa: 'OTHER',
      usuario_registra: usuario,
      fecha_registro: ahoraISO,
      activo: true,
      estado: 'ACTIVO'
    }])
    .select('id')
    .single();

  if (error) throw new Error(error.message);
  return nueva.id;
};

export const asegurarPlacaExiste = async (nroPlaca, empresaId, usuario) => {
  const placaLimpia = String(nroPlaca || '').replace(/[^A-Z0-9]/gi, '').toUpperCase();
  const ahoraISO = obtenerFechaHoraPeruISO();

  const { data: existe } = await supabase
    .from('placas')
    .select('nro_placa')
    .eq('nro_placa', placaLimpia)
    .maybeSingle();

  if (!existe) {
    const { error } = await supabase
      .from('placas')
      .insert([{
        nro_placa: placaLimpia,
        empresa_id: empresaId,
        usuario_registra: usuario,
        fecha_registro: ahoraISO,
        activo: true,
        estado: 'ACTIVO'
      }]);

    if (error) throw new Error(error.message);
  }
};


// =========================================================================
// ACTUALIZAR REGISTRO CUANDO ESTÁ 'Por despachar' (ADMIN / SUPERVISOR / SUPERADMIN)
// =========================================================================
const calcularPorDespachar = (prestamoActual, payload, ahoraISO, { empresaId }) => {
  const esClienteRecoge = prestamoActual.area_proceso === 'CLIENTE RECOGE';

  const empresaIdFinal = empresaId;
  let dniConductorFinal = payload.dni_conductor || null;
  let nroPlacaFinal = String(payload.nro_placa || '').trim().toUpperCase();
  let observacionFinal = payload.observacion_salida || '';

  if (esClienteRecoge) {
    dniConductorFinal = null;

    const metaRecoge = [];
    if (payload.conductor_nombre) metaRecoge.push(`[CONDUCTOR RECOGE: ${payload.conductor_nombre.trim().toUpperCase()}]`);
    if (nroPlacaFinal) metaRecoge.push(`[PLACA RECOGE: ${nroPlacaFinal}]`);
    nroPlacaFinal = null;

    // Quitar marcas anteriores de conductor/placa si existían
    let obsLimpia = (prestamoActual.observacion_salida || '')
      .replace(/\[CONDUCTOR RECOGE:\s*[^\]]+\]/gi, '')
      .replace(/\[PLACA RECOGE:\s*[^\]]+\]/gi, '')
      .trim();

    const prefixRecoge = metaRecoge.join(' ');
    observacionFinal = obsLimpia ? `${prefixRecoge} - ${obsLimpia}` : prefixRecoge;
  } else {
    if (Array.isArray(payload.clientes_multiples) && payload.clientes_multiples.length > 0) {
      let obsSinClientes = (observacionFinal || '').replace(/\[CLIENTES:\s*[^\]]+\]\s*-?\s*/gi, '').trim();
      const listadoTexto = payload.clientes_multiples.join(', ');
      observacionFinal = obsSinClientes ? `[CLIENTES: ${listadoTexto}] - ${obsSinClientes}` : `[CLIENTES: ${listadoTexto}]`;
    }
  }

  return {
    empresa_transporte_id: empresaIdFinal,
    dni_conductor: dniConductorFinal,
    nr_ruta: esClienteRecoge ? prestamoActual.nr_ruta : String(payload.nr_ruta || '').trim(),
    nro_placa: nroPlacaFinal,
    observacion_salida: observacionFinal,
    usuario_actualiza: payload.usuario_actualiza,
    fecha_actualiza: ahoraISO
  };
};

const actualizarPorDespacharOnline = async (prestamoActual, payload) => {
  const ahoraISO = obtenerFechaHoraPeruISO();
  const esClienteRecoge = prestamoActual.area_proceso === 'CLIENTE RECOGE';
  let empresaId = payload.empresa_transporte_id ? Number(payload.empresa_transporte_id) : null;
  const nroPlaca = String(payload.nro_placa || '').trim().toUpperCase();

  if (esClienteRecoge) {
    if (!empresaId) empresaId = await obtenerOcrearEmpresaOther(payload.usuario_actualiza);
  } else if (nroPlaca && empresaId) {
    // OUTBOUND PRINCIPAL: asegurar placa en catálogo
    await asegurarPlacaExiste(nroPlaca, empresaId, payload.usuario_actualiza);
  }

  const camposActualizar = calcularPorDespachar(prestamoActual, payload, ahoraISO, { empresaId });

  const { data, error } = await supabase
    .from('prestamos')
    .update(camposActualizar)
    .eq('uuid', prestamoActual.uuid)
    .select()
    .single();

  if (error) throw new Error(`Error al actualizar préstamo por despachar: ${error.message}`);
  return data;
};


// Obtener el nombre del área del usuario a partir de su sesión o de la tabla empleados
export const obtenerNombreAreaUsuario = async (currentUser, areaProcesoFallback = '') => {
  try {
    // 1. Si ya viene el texto directamente en el usuario
    if (currentUser?.area_nombre) return currentUser.area_nombre;
    if (currentUser?.area && isNaN(currentUser.area)) return currentUser.area;

    // 2. Si viene el area_id en el usuario en sesión
    const areaId = currentUser?.area_id;
    if (areaId) {
      const { data: areaData } = await supabase
        .from('areas')
        .select('nombre, nombre_area')
        .eq('id', areaId)
        .maybeSingle();

      if (areaData) {
        return areaData.nombre || areaData.nombre_area || areaProcesoFallback;
      }
    }

    // 3. Si en authUser solo tenemos el dni o usuario, buscamos su área en la tabla empleados
    const identificador = currentUser?.dni || currentUser?.usuario || currentUser?.id;
    if (identificador) {
      const { data: emp } = await supabase
        .from('empleados')
        .select('area_id')
        .or(`dni.eq.${identificador},usuario.eq.${identificador}`)
        .maybeSingle();

      if (emp?.area_id) {
        const { data: areaData } = await supabase
          .from('areas')
          .select('nombre, nombre_area')
          .eq('id', emp.area_id)
          .maybeSingle();

        if (areaData) return areaData.nombre || areaData.nombre_area || areaProcesoFallback;
      }
    }
  } catch (err) {
    console.warn('No se pudo resolver el nombre del área:', err);
  }

  // Fallback seguro: el área del proceso seleccionado
  return areaProcesoFallback || 'OUTBOUND';
};


// =========================================================================
// BUSCAR EL ÁREA REAL DEL EMPLEADO (EMPLEADOS.AREA_ID -> AREAS.NOMBRE)
// =========================================================================
export const obtenerAreaEmpleadoPorIdentificador = async (identificador) => {
  if (!identificador || String(identificador).trim() === '' || identificador === 'Por despachar') {
    return '';
  }
  const term = String(identificador).trim();

  try {
    let emp = null;

    // 1. Buscar en empleados por DNI
    const resDni = await supabase
      .from('empleados')
      .select('area_id')
      .eq('dni', term)
      .maybeSingle();
    emp = resDni.data;

    // 2. Si no encuentra por DNI, buscar por usuario
    if (!emp) {
      const resUser = await supabase
        .from('empleados')
        .select('area_id')
        .eq('usuario', term)
        .maybeSingle();
      emp = resUser.data;
    }

    // 3. Si no, buscar por nombre exacto o parcial
    if (!emp) {
      const resNom = await supabase
        .from('empleados')
        .select('area_id')
        .ilike('nombre', `%${term}%`)
        .maybeSingle();
      emp = resNom.data;
    }

    // 4. Con el area_id, obtener el nombre real de la tabla 'areas'
    if (emp?.area_id) {
      const { data: areaData } = await supabase
        .from('areas')
        .select('nombre')
        .eq('id', emp.area_id)
        .maybeSingle();

      if (areaData?.nombre) {
        return String(areaData.nombre).trim().toUpperCase();
      }
    }
  } catch (err) {
    console.error('Error al resolver área en Supabase:', err);
  }
  return '';
};


// =========================================================================
// REGISTRAR CHECK DE SALIDA EN GARITA (CONCATENA HISTORIAL DE EVIDENCIA)
// =========================================================================
const calcularGarita = (ahoraISO, { estado_garita, comentario_garita, comentario_anterior, usuario_actualiza }) => {
  const fechaPeruLegible = new Date().toLocaleString('es-PE', { timeZone: 'America/Lima' });

  let comentarioFinal = '';
  const obsPrevia = String(comentario_anterior || '').trim();
  const obsNueva = String(comentario_garita || '').trim();

  if (obsPrevia) {
    if (obsNueva && obsNueva !== obsPrevia) {
      // Si ya había observación previa (ej. No Conforme) y agrega una nueva al dar Conforme
      comentarioFinal = `${obsPrevia} | [${fechaPeruLegible} - ${usuario_actualiza}]: ${obsNueva}`;
    } else if (estado_garita === 'Conforme' && obsPrevia.includes('[OBSERVACIÓN PREVIA') === false) {
      // Si pasa a Conforme sin escribir nuevo texto, se sella el antecedente
      comentarioFinal = `[OBSERVACIÓN PREVIA]: ${obsPrevia} | [REGULARIZADO CONFORME el ${fechaPeruLegible} por ${usuario_actualiza}]`;
    } else {
      comentarioFinal = obsPrevia;
    }
  } else {
    comentarioFinal = obsNueva ? `[${fechaPeruLegible} - ${usuario_actualiza}]: ${obsNueva}` : '';
  }

  return {
    estado_garita,
    comentario_garita: comentarioFinal || null,
    usuario_actualiza,
    fecha_actualiza: ahoraISO
  };
};

const registrarGaritaOnline = async (prestamoActual, payload) => {
  const ahoraISO = obtenerFechaHoraPeruISO();
  const { data, error } = await supabase
    .from('prestamos')
    .update(calcularGarita(ahoraISO, payload))
    .eq('uuid', prestamoActual.uuid)
    .select()
    .single();

  if (error) throw new Error(`Error en control de garita: ${error.message}`);
  return data;
};

// =========================================================================
// CAPA OFFLINE + EVENTOS: cada acción sobre un préstamo existente pasa por aquí
// =========================================================================
// - online:  escribe en Supabase usando la versión MÁS RECIENTE del préstamo (evita pisar
//            cambios que otro usuario hizo mientras tenías el modal abierto).
// - local:   calcula el cambio sin red para mostrarlo al instante (optimista) y lo encola.
// Las acciones guardan "deltas" (ej. paletas devueltas AHORA), así que al sincronizar
// se recalculan sobre los datos frescos del servidor y nada se suma dos veces.
const ACCIONES_PRESTAMO = {
  despacho_auxiliar: {
    online: completarDespachoAuxiliarOnline,
    local: (p, datos, ahora) => calcularDespachoAuxiliar(p, datos, ahora, {
      urlFirmaSalida: p.firma_conductor || '',
      urlFotoSalida: p.foto_salida || ''
    })
  },
  devolucion: {
    online: registrarDevolucionOnline,
    local: (p, datos, ahora) => calcularDevolucion(p, datos, ahora, { urlFirmaRetorno: p.firma_retorno || null })
  },
  por_despachar: {
    online: actualizarPorDespacharOnline,
    local: (p, datos, ahora) => calcularPorDespachar(p, datos, ahora, {
      empresaId: datos.empresa_transporte_id ? Number(datos.empresa_transporte_id) : (p.empresa_transporte_id ?? null)
    })
  },
  garita: {
    // El historial de garita se concatena sobre el comentario vigente en el servidor
    online: (p, datos) => registrarGaritaOnline(p, { ...datos, comentario_anterior: p.comentario_garita }),
    local: (p, datos, ahora) => calcularGarita(ahora, { ...datos, comentario_anterior: p.comentario_garita })
  },
  imagenes_salida: {
    online: (p, datos) => subirImagenesSalidaEstricto(p, datos),
    local: null
  }
};

// Variante que SÍ lanza el error (para que la cola sepa que falló y lo reintente)
const subirImagenesSalidaEstricto = async (prestamo, { firma_conductor_base64, foto_salida_base64 }) => {
  const idPrestamo = prestamo.id_prestamo;
  const [urlFirmaSalida, urlFotoSalida] = await Promise.all([
    firma_conductor_base64
      ? subirImagenADrive(firma_conductor_base64, `firma_${idPrestamo}_salida_${Date.now()}.png`)
      : Promise.resolve(''),
    foto_salida_base64
      ? subirImagenADrive(foto_salida_base64, `foto_${idPrestamo}_salida_${Date.now()}.png`)
      : Promise.resolve('')
  ]);

  const { data, error } = await supabase
    .from('prestamos')
    .update({
      firma_conductor: urlFirmaSalida || prestamo.firma_conductor || null,
      foto_salida: urlFotoSalida || prestamo.foto_salida || null
    })
    .eq('uuid', prestamo.uuid)
    .select()
    .single();

  if (error) throw new Error(error.message);
  return data;
};

const obtenerPrestamoRemoto = async (uuid) => {
  const { data, error } = await supabase.from('prestamos').select('*').eq('uuid', uuid).single();
  if (error) throw new Error(`No se pudo leer el préstamo actualizado: ${error.message}`);
  return data;
};

const ejecutarAccionPrestamo = async (tipo, prestamoActual, datos) => {
  const accion = ACCIONES_PRESTAMO[tipo];
  const uuid = prestamoActual?.uuid;
  if (!uuid) throw new Error('Préstamo sin identificador.');

  if (esPrestamoLocal(prestamoActual)) {
    throw new Error('Este préstamo se registró sin internet y aún no se sincroniza. Sincroniza los pendientes y vuelve a intentarlo.');
  }

  if (navigator.onLine) {
    try {
      const fresco = await obtenerPrestamoRemoto(uuid);
      const resultado = await accion.online(fresco, datos);
      await guardarPrestamosLocal([{ ...resultado, _sincronizado: true }]);
      return resultado;
    } catch (err) {
      if (!esErrorDeRed(err)) throw err;
      console.warn(`Fallo de red en acción "${tipo}", guardando en modo offline...`, err);
    }
  }

  // ---- Modo offline: cambio optimista en Dexie + cola ----
  let base = null;
  try {
    base = await localDb.prestamos.get(uuid);
  } catch {
    // sin Dexie: se usa la copia que tiene la pantalla
  }
  base = base || prestamoActual;

  const ahoraISO = obtenerFechaHoraPeruISO();
  const actualizado = { ...base, ...accion.local(base, datos, ahoraISO), _sincronizado: false };

  await localDb.prestamos.put(actualizado);
  await localDb.sync_queue.add({
    tabla: TABLA_COLA,
    operacion: 'ACCION',
    payload: { tipo, uuid, datos }
  });

  return actualizado;
};

// API pública (misma firma que antes: las pantallas no cambian)
export const completarDespachoAuxiliar = (prestamoActual, payload) =>
  ejecutarAccionPrestamo('despacho_auxiliar', prestamoActual, payload);

export const registrarDevolucionPrestamo = (prestamoActual, payload) =>
  ejecutarAccionPrestamo('devolucion', prestamoActual, payload);

export const actualizarRegistroPorDespachar = (prestamoActual, payload) =>
  ejecutarAccionPrestamo('por_despachar', prestamoActual, payload);

export const registrarControlGarita = (uuidPrestamo, payload) =>
  ejecutarAccionPrestamo('garita', { uuid: uuidPrestamo }, payload);

// =========================================================================
// SINCRONIZACIÓN DE LA COLA OFFLINE DE PRÉSTAMOS (la llama useSync)
// =========================================================================
export const sincronizarPrestamosPendientes = async () => {
  if (!navigator.onLine) return { synced: 0, failed: 0 };

  let synced = 0;
  let failed = 0;
  const uuidsConError = new Set();

  let pendientes;
  try {
    // Orden de llegada (++id): primero el registro, luego sus acciones
    pendientes = await localDb.sync_queue.where('tabla').equals(TABLA_COLA).sortBy('id');
  } catch (err) {
    console.error('No se pudo leer la cola de préstamos:', err);
    return { synced, failed };
  }

  for (const item of pendientes) {
    const { payload } = item;
    try {
      if (item.operacion === 'INSERT') {
        const creado = await crearPrestamoPalletOnline(payload.datos, { fechaEntregaISO: payload.fechaEntregaISO });
        await localDb.prestamos.delete(payload.idLocal);
        await localDb.prestamos.put({ ...creado, _sincronizado: true });
      } else if (item.operacion === 'ACCION') {
        // Si una acción anterior del mismo préstamo falló, esperamos para respetar el orden
        if (uuidsConError.has(payload.uuid)) { failed++; continue; }

        const accion = ACCIONES_PRESTAMO[payload.tipo];
        if (!accion) throw new Error(`Acción desconocida: ${payload.tipo}`);

        const fresco = await obtenerPrestamoRemoto(payload.uuid);
        const resultado = await accion.online(fresco, payload.datos);

        const quedanOtras = pendientes.some(
          (p) => p.id > item.id && p.payload?.uuid === payload.uuid
        );
        await localDb.prestamos.put({ ...resultado, _sincronizado: !quedanOtras });
      }

      await localDb.sync_queue.delete(item.id);
      synced++;
    } catch (err) {
      console.error('Error sincronizando préstamo pendiente:', err);
      failed++;
      if (payload?.uuid) uuidsConError.add(payload.uuid);
      if (payload?.idLocal) uuidsConError.add(payload.idLocal);
      // Se cayó la red a mitad: no tiene sentido seguir intentando el resto
      if (esErrorDeRed(err)) break;
    }
  }

  return { synced, failed };
};