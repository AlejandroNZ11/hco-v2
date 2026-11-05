import { supabase } from '../config/supabaseClient';

const BOOT_CACHE_KEY = 'PRESTAMOS_SUPABASE_BOOT_V2';

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

let tokenGoogleCache = { token: null, expira: 0 };

const obtenerAccessTokenGoogleDrive = async () => {
  const ahora = Date.now();
  if (tokenGoogleCache.token && ahora < tokenGoogleCache.expira) {
    return tokenGoogleCache.token;
  }

  const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;
  const clientSecret = import.meta.env.VITE_GOOGLE_CLIENT_SECRET;
  const refreshToken = import.meta.env.VITE_GOOGLE_REFRESH_TOKEN;

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error('Faltan credenciales VITE_GOOGLE_* en .env');
  }

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token'
    })
  });

  const data = await res.json();
  if (!res.ok || !data.access_token) {
    throw new Error(data.error_description || 'Error obteniendo token Drive');
  }

  tokenGoogleCache = {
    token: data.access_token,
    expira: Date.now() + 50 * 60 * 1000
  };

  return data.access_token;
};

const base64ABlob = (dataUrl) => {
  const partes = dataUrl.split(',');
  const byteString = atob(partes[1]);
  const arrayBuffer = new ArrayBuffer(byteString.length);
  const intArray = new Uint8Array(arrayBuffer);
  for (let i = 0; i < byteString.length; i++) {
    intArray[i] = byteString.charCodeAt(i);
  }
  return new Blob([intArray], { type: 'image/png' });
};

export const subirImagenADrive = async (dataUrlBase64, nombreArchivo, tokenPreviamenteObtenido = null) => {
  if (!dataUrlBase64 || !String(dataUrlBase64).startsWith('data:image')) return '';

  const folderId = import.meta.env.VITE_GOOGLE_DRIVE_FOLDER_ID;
  const accessToken = tokenPreviamenteObtenido || await obtenerAccessTokenGoogleDrive();
  const blobImagen = base64ABlob(dataUrlBase64);

  const metadata = {
    name: nombreArchivo,
    mimeType: 'image/png',
    ...(folderId ? { parents: [folderId] } : {})
  };

  const form = new FormData();
  form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
  form.append('file', blobImagen);

  const res = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink',
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}` },
      body: form
    }
  );

  const fileData = await res.json();
  if (!res.ok || !fileData.id) {
    throw new Error(fileData?.error?.message || 'Error al subir imagen a Google Drive.');
  }

  // Esperar a que el archivo sea público antes de devolver la URL
  try {
    await fetch(`https://www.googleapis.com/drive/v3/files/${fileData.id}/permissions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ role: 'reader', type: 'anyone' })
    });
  } catch (e) {
    console.warn("Error asignando permiso:", e);
  }

  return `https://drive.google.com/file/d/${fileData.id}/view`;
};

const esRegistroActivo = (item) => {
  if (typeof item.activo === 'boolean') return item.activo;
  if (item.estado) return String(item.estado).toUpperCase().trim() === 'ACTIVO';
  return true;
};

export const obtenerDatosMaestrosPrestamos = async () => {
  try {
    const [resEmp, resCond, resPlac, resCli, resTip] = await Promise.all([
      supabase.from('empresas_transporte').select('*'),
      supabase.from('conductores').select('*'),
      supabase.from('placas').select('*'),
      supabase.from('clientes').select('*'),
      supabase.from('tipos_paleta').select('*')
    ]);

    if (resEmp.error && resCond.error && resPlac.error) {
      throw new Error(resEmp.error.message);
    }

    const empresasActivas = (resEmp.data || []).filter(esRegistroActivo);
    const conductoresActivos = (resCond.data || []).filter(esRegistroActivo);
    const placasActivas = (resPlac.data || []).filter(esRegistroActivo);
    const clientesActivos = (resCli.data || []).filter(esRegistroActivo);
    const tiposPaleta = resTip.data || [];

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

    const dataMaestra = { empresas, conductores, placas, clientes, tipos_paleta };

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

// =========================================
// 2. CREAR PRÉSTAMO PALLET
// =========================================
export const crearPrestamoPallet = async (payload) => {
  const ahoraISO = obtenerFechaHoraPeruISO();
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

  let empresaIdFinal = payload.empresa_transporte_id ? Number(payload.empresa_transporte_id) : null;
  let dniConductorFinal = payload.dni_conductor || null;
  let nroPlacaFinal = String(payload.nro_placa || '').trim().toUpperCase();
  let observacionFinal = payload.observacion_salida || '';

  // CASO ESPECIAL: CLIENTE RECOGE (No crea ni placa ni conductor en tablas maestras)
  if (esClienteRecoge) {
    if (!empresaIdFinal) {
      empresaIdFinal = await obtenerOcrearEmpresaOther(payload.usuario_registra);
    }

    dniConductorFinal = null;

    // Guardar placa y chofer dentro de observación de salida para evitar foreign keys
    const metaRecoge = [];
    if (payload.conductor_nombre) metaRecoge.push(`[CONDUCTOR RECOGE: ${payload.conductor_nombre.trim().toUpperCase()}]`);
    if (nroPlacaFinal) metaRecoge.push(`[PLACA RECOGE: ${nroPlacaFinal}]`);
    
    // nro_placa se manda null para no violar prestamos_nro_placa_fkey
    nroPlacaFinal = null; 

    const prefixRecoge = metaRecoge.join(' ');
    observacionFinal = observacionFinal 
      ? `${prefixRecoge} - ${observacionFinal}`
      : prefixRecoge;
  }

  if (Array.isArray(payload.clientes_multiples) && payload.clientes_multiples.length > 0) {
    const listadoTexto = payload.clientes_multiples.join(', ');
    observacionFinal = observacionFinal
      ? `[CLIENTES: ${listadoTexto}] - ${observacionFinal}`
      : `[CLIENTES: ${listadoTexto}]`;
  }

  const datosInsertar = {
    fecha_entrega: ahoraISO,
    fecha_retorno: fechaRetornoISO,
    empresa_transporte_id: empresaIdFinal,
    dni_conductor: dniConductorFinal,
    nr_ruta: String(payload.nr_ruta || '').trim(),
    nro_placa: nroPlacaFinal,
    despachador: payload.despachador,
    nr_paletas: Number(payload.nr_paletas || 0),
    estado: estadoInicial,
    nr_paletas_devueltas: 0,
    fecha_devolucion: (!esRegistroParcial && !retornaBool) ? ahoraISO : null,
    observacion_salida: observacionFinal,
    cliente_id: payload.cliente_id || null,
    tipo_paleta_id: payload.tipo_paleta_id ? Number(payload.tipo_paleta_id) : null,
    area_registrador: payload.area_registrador || '',
    area_proceso: payload.area_proceso,
    retorno: retornaBool,
    usuario_registra: payload.usuario_registra,
    usuario_actualiza: null
  };

  const { data: prestamoCreado, error: errorInsert } = await supabase
    .from('prestamos')
    .insert([datosInsertar])
    .select()
    .single();

  if (errorInsert) {
    throw new Error(`Error en Supabase: ${errorInsert.message}`);
  }

  const idPrestamo = prestamoCreado.id_prestamo;

  if (payload.firma_conductor_base64 || payload.foto_salida_base64) {
    const token = await obtenerAccessTokenGoogleDrive();

    const [urlFirmaSalida, urlFotoSalida] = await Promise.all([
      payload.firma_conductor_base64 
        ? subirImagenADrive(payload.firma_conductor_base64, `firma_${idPrestamo}_salida_${Date.now()}.png`, token)
        : Promise.resolve(''),
      payload.foto_salida_base64 
        ? subirImagenADrive(payload.foto_salida_base64, `foto_${idPrestamo}_salida_${Date.now()}.png`, token)
        : Promise.resolve('')
    ]);

    if (urlFirmaSalida || urlFotoSalida) {
      const { data: prestamoActualizado } = await supabase
        .from('prestamos')
        .update({
          firma_conductor: urlFirmaSalida || null,
          foto_salida: urlFotoSalida || null
        })
        .eq('uuid', prestamoCreado.uuid)
        .select()
        .single();

      return prestamoActualizado || prestamoCreado;
    }
  }

  return prestamoCreado;
};

// =========================================================================
// 3. OBTENER TRACKING (EXTRAE CONDUCTOR Y PLACA DE CLIENTE RECOGE)
// =========================================================================
export const obtenerTrackingPrestamos = async (maestrosPreCargados = null) => {
  const [resPrest, maestros] = await Promise.all([
    supabase.from('prestamos').select('*').order('fecha_entrega', { ascending: false }),
    maestrosPreCargados ? Promise.resolve(maestrosPreCargados) : obtenerDatosMaestrosPrestamos()
  ]);

  if (resPrest.error) throw new Error(`Error al cargar tracking: ${resPrest.error.message}`);

  const empMap = Object.fromEntries((maestros.empresas || []).map(e => [String(e.id), e.nombre_empresa]));
  const condMap = Object.fromEntries((maestros.conductores || []).map(c => [String(c.dni_conductor), c.nombre_conductor]));
  const cliMap = Object.fromEntries((maestros.clientes || []).map(c => [String(c.id), c.nombre_cliente]));
  const tipMap = Object.fromEntries((maestros.tipos_paleta || []).map(t => [String(t.id), t.nombre_tipo]));

  const hoy = new Date();

  const listaFormateada = (resPrest.data || []).map(row => {
    const noRetornoAcumulado = Number(row.nr_paletas_noretorno || 0);
    const devueltasAcumuladas = Number(row.nr_paletas_devueltas || 0);
    const prestadas = Number(row.nr_paletas || 0);
    const fRetorno = row.fecha_retorno ? new Date(row.fecha_retorno) : calcularFechaRetornoPeru(row.fecha_entrega, 7);
    const fechaRetornoDate = fRetorno ? new Date(fRetorno) : null;
    const estaCerrado = ['Devuelto', 'NO RETORNO', 'Cerrado mixto', 'Por despachar'].includes(row.estado);
    const atrasado = !estaCerrado && fechaRetornoDate && hoy > fechaRetornoDate;
    //const paletasPendientesCalc = row.paletas_pendientes ?? Math.max(0, Number(row.nr_paletas || 0) - Number(row.nr_paletas_devueltas || 0));
    const paletasPendientesCalc = Math.max(0, prestadas - devueltasAcumuladas - noRetornoAcumulado);
    // Extracción de Conductor si es CLIENTE RECOGE
    let conductorFinal = condMap[String(row.dni_conductor)] || row.dni_conductor || '';
    if (!conductorFinal && row.observacion_salida) {
      const matchConductor = row.observacion_salida.match(/\[CONDUCTOR RECOGE:\s*([^\]]+)\]/i);
      if (matchConductor) conductorFinal = matchConductor[1].trim();
    }

    // Extracción de Placa si es CLIENTE RECOGE
    let placaFinal = row.nro_placa || '';
    if (!placaFinal && row.observacion_salida) {
      const matchPlaca = row.observacion_salida.match(/\[PLACA RECOGE:\s*([^\]]+)\]/i);
      if (matchPlaca) placaFinal = matchPlaca[1].trim();
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
      fecha_retorno_calculada: fechaRetornoDate ? fechaRetornoDate.toISOString() : null,
      atrasado
    };
  });

  return listaFormateada;
};

// =========================================================================
// 2.1 COMPLETAR DESPACHO AUXILIAR (FASE 2)
// =========================================================================
export const completarDespachoAuxiliar = async (prestamoActual, payload) => {
  const ahoraISO = obtenerFechaHoraPeruISO();
  const idPrestamo = prestamoActual.id_prestamo;
  const retornaBool = payload.retorno === 'SI' || payload.retorno === true;
  const estadoFinal = retornaBool ? 'Pendiente' : 'NO RETORNO';
  const fechaRetornoISO = retornaBool ? calcularFechaRetornoPeru(ahoraISO, 7) : null;

  const token = await obtenerAccessTokenGoogleDrive();

  const [urlFirmaSalida, urlFotoSalida] = await Promise.all([
    payload.firma_conductor_base64 
      ? subirImagenADrive(payload.firma_conductor_base64, `firma_${idPrestamo}_salida_${Date.now()}.png`, token)
      : Promise.resolve(prestamoActual.firma_conductor || ''),
    payload.foto_salida_base64 
      ? subirImagenADrive(payload.foto_salida_base64, `foto_${idPrestamo}_salida_${Date.now()}.png`, token)
      : Promise.resolve(prestamoActual.foto_salida || '')
  ]);

  const obsPrevia = String(prestamoActual.observacion_salida || '').trim();
  const obsNueva = String(payload.observacion_salida || '').trim();
  const obsFinal = obsPrevia && obsNueva && !obsPrevia.includes(obsNueva)
    ? `${obsPrevia} | ${obsNueva}`
    : (obsNueva || obsPrevia);

  const camposActualizar = {
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

  const { data, error } = await supabase
    .from('prestamos')
    .update(camposActualizar)
    .eq('uuid', prestamoActual.uuid)
    .select()
    .single();

  if (error) throw new Error(`Error al completar despacho: ${error.message}`);
  return data;
};

export const registrarDevolucionPrestamo = async (prestamoActual, payload) => {
  const ahoraISO = obtenerFechaHoraPeruISO();
  const idPrestamo = prestamoActual.id_prestamo;

  const nrPaletasPrestadas = Number(prestamoActual.nr_paletas || 0);
  const devueltasAnteriores = Number(prestamoActual.nr_paletas_devueltas || 0);
  const noRetornoAnteriores = Number(prestamoActual.nr_paletas_noretorno || 0);

  const devuelveAhora = Number(payload.cantidad_devuelta || 0);
  const noRetornoAhora = Number(payload.cantidad_noretorno || 0);
  const tipoAccion = payload.tipo_accion || 'devolucion';

  let nuevoEstado = prestamoActual.estado;
  let totalDevueltas = devueltasAnteriores + devuelveAhora;
  let totalNoRetorno = noRetornoAnteriores + noRetornoAhora;
  let fechaDevolucion = prestamoActual.fecha_devolucion;

  if (tipoAccion === 'no_retorno') {
    nuevoEstado = 'NO RETORNO';
    totalNoRetorno = nrPaletasPrestadas - devueltasAnteriores;
    fechaDevolucion = ahoraISO;
  } else if (tipoAccion === 'cerrado_mixto') {
    nuevoEstado = 'Cerrado mixto';
    fechaDevolucion = ahoraISO;
  } else {
    // Devolución normal
    const pendientesRestantes = nrPaletasPrestadas - totalDevueltas - totalNoRetorno;
    if (pendientesRestantes <= 0) {
      nuevoEstado = 'Devuelto';
      fechaDevolucion = ahoraISO;
    } else {
      nuevoEstado = 'Devolución Parcial';
    }
  }

  let urlFirmaRetorno = prestamoActual.firma_retorno || null;
  if (payload.firma_retorno_base64) {
    const nombreFirmaRegreso = `firma_${idPrestamo}_regreso_${Date.now()}.png`;
    urlFirmaRetorno = await subirImagenADrive(payload.firma_retorno_base64, nombreFirmaRegreso);
  }

  const camposActualizar = {
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
export const actualizarRegistroPorDespachar = async (prestamoActual, payload) => {
  const ahoraISO = obtenerFechaHoraPeruISO();
  const esClienteRecoge = prestamoActual.area_proceso === 'CLIENTE RECOGE';

  let empresaIdFinal = payload.empresa_transporte_id ? Number(payload.empresa_transporte_id) : null;
  let dniConductorFinal = payload.dni_conductor || null;
  let nroPlacaFinal = String(payload.nro_placa || '').trim().toUpperCase();
  let observacionFinal = payload.observacion_salida || '';

  if (esClienteRecoge) {
    if (!empresaIdFinal) {
      empresaIdFinal = await obtenerOcrearEmpresaOther(payload.usuario_actualiza);
    }
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
    // OUTBOUND PRINCIPAL: asegurar placa en catálogo
    if (nroPlacaFinal && empresaIdFinal) {
      await asegurarPlacaExiste(nroPlacaFinal, empresaIdFinal, payload.usuario_actualiza);
    }

    if (Array.isArray(payload.clientes_multiples) && payload.clientes_multiples.length > 0) {
      let obsSinClientes = (observacionFinal || '').replace(/\[CLIENTES:\s*[^\]]+\]\s*-?\s*/gi, '').trim();
      const listadoTexto = payload.clientes_multiples.join(', ');
      observacionFinal = obsSinClientes ? `[CLIENTES: ${listadoTexto}] - ${obsSinClientes}` : `[CLIENTES: ${listadoTexto}]`;
    }
  }

  const camposActualizar = {
    empresa_transporte_id: empresaIdFinal,
    dni_conductor: dniConductorFinal,
    nr_ruta: esClienteRecoge ? prestamoActual.nr_ruta : String(payload.nr_ruta || '').trim(),
    nro_placa: nroPlacaFinal,
    observacion_salida: observacionFinal,
    usuario_actualiza: payload.usuario_actualiza,
    fecha_actualiza: ahoraISO
  };

  const { data, error } = await supabase
    .from('prestamos')
    .update(camposActualizar)
    .eq('uuid', prestamoActual.uuid)
    .select()
    .single();

  if (error) throw new Error(`Error al actualizar préstamo por despachar: ${error.message}`);
  return data;
};