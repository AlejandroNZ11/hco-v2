import { supabase } from '../config/supabaseClient';

const BOOT_CACHE_KEY = 'PRESTAMOS_SUPABASE_BOOT_V2';

// Hora actual en formato ISO con zona horaria de Perú (-05:00)
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

// Calcula +7 días hábiles excluyendo sábados, domingos y feriados de Perú
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
    const diaSemana = f.getDay(); // 0 = Dom, 6 = Sáb
    const mesDia = `${String(f.getMonth() + 1).padStart(2, '0')}-${String(f.getDate()).padStart(2, '0')}`;
    if (diaSemana !== 0 && diaSemana !== 6 && !feriadosPeru.includes(mesDia)) {
      agregados++;
    }
  }
  return f.toISOString();
};

// =========================================================================
// SUBIDA DIRECTA DESDE REACT A GOOGLE DRIVE API V3
// =========================================================================

const obtenerAccessTokenGoogleDrive = async () => {
  const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;
  const clientSecret = import.meta.env.VITE_GOOGLE_CLIENT_SECRET;
  const refreshToken = import.meta.env.VITE_GOOGLE_REFRESH_TOKEN;

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error('Faltan las credenciales VITE_GOOGLE_* en el archivo .env para conectar con Google Drive.');
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
    throw new Error(data.error_description || 'No se pudo obtener el token de acceso de Google Drive.');
  }
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

export const subirImagenADrive = async (dataUrlBase64, nombreArchivo) => {
  if (!dataUrlBase64 || !String(dataUrlBase64).startsWith('data:image')) return '';

  const folderId = import.meta.env.VITE_GOOGLE_DRIVE_FOLDER_ID;
  const accessToken = await obtenerAccessTokenGoogleDrive();
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
    throw new Error(fileData?.error?.message || 'Error al subir la imagen a Google Drive.');
  }

  return `https://drive.google.com/file/d/${fileData.id}/view`;
};

// =========================================================================
// 1. OBTENER CATÁLOGOS MAESTROS (CONSULTA DIRECTA Y ORDEN ALFABÉTICO)
// =========================================================================

export const obtenerDatosMaestrosPrestamos = async () => {
  try {
    const [resEmp, resCond, resPlac, resCli, resTip] = await Promise.all([
      supabase.from('empresas_transporte').select('*'),
      supabase.from('conductores').select('*'),
      supabase.from('placas').select('*'),
      supabase.from('clientes').select('*'),
      supabase.from('tipos_paleta').select('*')
    ]);

    if (resEmp.error) console.error('Error empresas_transporte:', resEmp.error.message);
    if (resCond.error) console.error('Error conductores:', resCond.error.message);
    if (resPlac.error) console.error('Error placas:', resPlac.error.message);
    if (resCli.error) console.error('Error clientes:', resCli.error.message);
    if (resTip.error) console.error('Error tipos_paleta:', resTip.error.message);

    // Ordenamos alfabéticamente Empresas
    const empresas = (resEmp.data || []).sort((a, b) =>
      String(a.nombre_empresa || '').localeCompare(String(b.nombre_empresa || ''), 'es', { sensitivity: 'base' })
    );

    const empresasMap = Object.fromEntries(
      empresas.map(e => [String(e.id), e.nombre_empresa])
    );

    // Ordenamos alfabéticamente Conductores y asociamos su empresa
    const conductores = (resCond.data || [])
      .map(c => ({
        ...c,
        dni_conductor: String(c.dni_conductor || '').trim(),
        nombre_conductor: String(c.nombre_conductor || '').trim(),
        empresa_id: c.empresa_id,
        empresa_nombre: empresasMap[String(c.empresa_id)] || ''
      }))
      .sort((a, b) =>
        a.nombre_conductor.localeCompare(b.nombre_conductor, 'es', { sensitivity: 'base' })
      );

    // Ordenamos alfabéticamente Placas y asociamos su empresa
    const placas = (resPlac.data || [])
      .map(p => ({
        ...p,
        nro_placa: String(p.nro_placa || '').trim().toUpperCase(),
        empresa_id: p.empresa_id,
        empresa_nombre: empresasMap[String(p.empresa_id)] || ''
      }))
      .sort((a, b) =>
        a.nro_placa.localeCompare(b.nro_placa, 'es', { sensitivity: 'base' })
      );

    // Ordenamos alfabéticamente Clientes
    const clientes = (resCli.data || []).sort((a, b) =>
      String(a.nombre_cliente || '').localeCompare(String(b.nombre_cliente || ''), 'es', { sensitivity: 'base' })
    );

    // Ordenamos alfabéticamente Tipos de Paleta
    const tipos_paleta = (resTip.data || []).sort((a, b) =>
      String(a.nombre_tipo || '').localeCompare(String(b.nombre_tipo || ''), 'es', { sensitivity: 'base' })
    );

    const dataMaestra = {
      empresas,
      conductores,
      placas,
      clientes,
      tipos_paleta
    };

    localStorage.setItem(BOOT_CACHE_KEY, JSON.stringify(dataMaestra));
    return dataMaestra;
  } catch (error) {
    console.warn('Cargando catálogos de préstamos desde caché local...', error);
    const cache = localStorage.getItem(BOOT_CACHE_KEY);
    if (cache) return JSON.parse(cache);
    throw error;
  }
};

// =========================================================================
// 2. CREAR PRÉSTAMO (GENERA ID P-XX -> SUBE IMÁGENES -> GUARDA URLs)
// =========================================================================

export const crearPrestamoPallet = async (payload) => {
  const ahoraISO = obtenerFechaHoraPeruISO();
  const retornaBool = payload.retorno === 'SI' || payload.retorno === true;
  const estadoInicial = retornaBool ? 'Pendiente' : 'NO RETORNO';
  const fechaRetornoISO = retornaBool ? calcularFechaRetornoPeru(ahoraISO, 7) : null;

  // 1. Si el cliente escrito no existe en la tabla maestra 'clientes', lo creamos o buscamos su ID
  let clienteIdFinal = payload.cliente_id || null;
  if (!clienteIdFinal && payload.cliente_nombre) {
    const nombreCli = payload.cliente_nombre.trim().toUpperCase();
    const { data: cliExistente } = await supabase
      .from('clientes')
      .select('id')
      .eq('nombre_cliente', nombreCli)
      .maybeSingle();

    if (cliExistente) {
      clienteIdFinal = cliExistente.id;
    } else {
      const { data: nuevoCli } = await supabase
        .from('clientes')
        .insert([{
          nombre_cliente: nombreCli,
          usuario_registra: payload.usuario_registra,
          fecha_registro: ahoraISO
        }])
        .select('id')
        .single();
      clienteIdFinal = nuevoCli?.id || null;
    }
  }

  // 2. Insertamos la fila en 'prestamos'
  const datosInsertar = {
    fecha_entrega: ahoraISO,
    fecha_retorno: fechaRetornoISO,
    empresa_transporte_id: Number(payload.empresa_transporte_id) || null,
    dni_conductor: payload.dni_conductor,
    nr_ruta: String(payload.nr_ruta || '').trim(),
    nro_placa: String(payload.nro_placa || '').trim().toUpperCase(),
    despachador: payload.despachador,
    nr_paletas: Number(payload.nr_paletas || 0),
    estado: estadoInicial,
    nr_paletas_devueltas: 0,
    fecha_devolucion: retornaBool ? null : ahoraISO,
    observacion_salida: payload.observacion_salida || '',
    cliente_id: clienteIdFinal,
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
    throw new Error(`Error al generar el préstamo en Supabase: ${errorInsert.message}`);
  }

  const idPrestamo = prestamoCreado.id_prestamo;

  // 3. Subimos firma y foto a Google Drive
  let urlFirmaSalida = '';
  let urlFotoSalida = '';

  if (payload.firma_conductor_base64) {
    const nombreFirma = `firma_${idPrestamo}_salida_${Date.now()}.png`;
    urlFirmaSalida = await subirImagenADrive(payload.firma_conductor_base64, nombreFirma);
  }

  if (payload.foto_salida_base64) {
    const nombreFoto = `foto_${idPrestamo}_salida_${Date.now()}.png`;
    urlFotoSalida = await subirImagenADrive(payload.foto_salida_base64, nombreFoto);
  }

  // 4. Actualizamos las URLs generadas
  if (urlFirmaSalida || urlFotoSalida) {
    const { data: prestamoActualizado, error: errorUpdateUrl } = await supabase
      .from('prestamos')
      .update({
        firma_conductor: urlFirmaSalida || null,
        foto_salida: urlFotoSalida || null
      })
      .eq('uuid', prestamoCreado.uuid)
      .select()
      .single();

    if (errorUpdateUrl) {
      throw new Error(`El préstamo ${idPrestamo} se creó, pero hubo un error al guardar los links de Drive: ${errorUpdateUrl.message}`);
    }
    return prestamoActualizado;
  }

  return prestamoCreado;
};

// =========================================================================
// 3. OBTENER TRACKING DE PRÉSTAMOS (CRUCE SEGURO EN MEMORIA)
// =========================================================================

export const obtenerTrackingPrestamos = async () => {
  const [resPrest, maestros] = await Promise.all([
    supabase.from('prestamos').select('*').order('fecha_entrega', { ascending: false }),
    obtenerDatosMaestrosPrestamos()
  ]);

  if (resPrest.error) throw new Error(`Error al cargar el tracking: ${resPrest.error.message}`);

  const empMap = Object.fromEntries((maestros.empresas || []).map(e => [String(e.id), e.nombre_empresa]));
  const condMap = Object.fromEntries((maestros.conductores || []).map(c => [String(c.dni_conductor), c.nombre_conductor]));
  const cliMap = Object.fromEntries((maestros.clientes || []).map(c => [String(c.id), c.nombre_cliente]));
  const tipMap = Object.fromEntries((maestros.tipos_paleta || []).map(t => [String(t.id), t.nombre_tipo]));

  const hoy = new Date();

  const listaFormateada = (resPrest.data || []).map(row => {
    const fRetorno = row.fecha_retorno ? new Date(row.fecha_retorno) : calcularFechaRetornoPeru(row.fecha_entrega, 7);
    const fechaRetornoDate = fRetorno ? new Date(fRetorno) : null;
    const estaCerrado = ['Devuelto', 'NO RETORNO', 'Cerrado mixto'].includes(row.estado);
    const atrasado = !estaCerrado && fechaRetornoDate && hoy > fechaRetornoDate;

    return {
      ...row,
      empresa_transporte_nombre: empMap[String(row.empresa_transporte_id)] || '',
      conductor_nombre: condMap[String(row.dni_conductor)] || row.dni_conductor || '',
      conductor_retorno_nombre: condMap[String(row.conductor_retorno)] || row.conductor_retorno || '',
      cliente_nombre: cliMap[String(row.cliente_id)] || '',
      tipo_paleta_nombre: tipMap[String(row.tipo_paleta_id)] || '',
      fecha_retorno_calculada: fechaRetornoDate ? fechaRetornoDate.toISOString() : null,
      atrasado
    };
  });

  listaFormateada.sort((a, b) => {
    if (a.estado === 'Devuelto' && b.estado !== 'Devuelto') return 1;
    if (b.estado === 'Devuelto' && a.estado !== 'Devuelto') return -1;
    return new Date(b.fecha_entrega).getTime() - new Date(a.fecha_entrega).getTime();
  });

  return listaFormateada;
};

// =========================================================================
// 4. REGISTRAR DEVOLUCIÓN / EDICIÓN ADMIN
// =========================================================================

export const registrarDevolucionPrestamo = async (prestamoActual, payload) => {
  const ahoraISO = obtenerFechaHoraPeruISO();
  const idPrestamo = prestamoActual.id_prestamo;

  const nrPaletasPrestadas = Number(
    payload.nr_paletas_editada !== undefined ? payload.nr_paletas_editada : prestamoActual.nr_paletas
  );
  const devueltasAnteriores = Number(prestamoActual.nr_paletas_devueltas || 0);
  const devuelveAhora = Number(payload.cantidad_devuelta || 0);
  const tipoAccion = payload.tipo_accion || 'devolucion';

  let nuevoEstado = prestamoActual.estado;
  let totalDevueltas = devueltasAnteriores;
  let fechaDevolucion = prestamoActual.fecha_devolucion;

  if (tipoAccion === 'no_retorno') {
    nuevoEstado = 'NO RETORNO';
    fechaDevolucion = ahoraISO;
  } else if (tipoAccion === 'cerrado_mixto') {
    totalDevueltas = devueltasAnteriores + devuelveAhora;
    if (totalDevueltas > nrPaletasPrestadas) {
      throw new Error('La cantidad devuelta superaría el total de paletas prestadas.');
    }
    nuevoEstado = 'Cerrado mixto';
    fechaDevolucion = ahoraISO;
  } else {
    const pendientesActuales = nrPaletasPrestadas - devueltasAnteriores;
    if (devuelveAhora > pendientesActuales) {
      throw new Error(`No puede devolver ${devuelveAhora}. Solo quedan ${pendientesActuales} paletas pendientes.`);
    }
    totalDevueltas = devueltasAnteriores + devuelveAhora;
    const nuevasPendientes = nrPaletasPrestadas - totalDevueltas;

    if (totalDevueltas > 0 && nuevasPendientes > 0) {
      nuevoEstado = 'Devolución Parcial';
    } else if (nuevasPendientes <= 0) {
      nuevoEstado = 'Devuelto';
      fechaDevolucion = ahoraISO;
    }
  }

  let urlFirmaRetorno = prestamoActual.firma_retorno || null;
  if (payload.firma_retorno_base64) {
    const nombreFirmaRegreso = `firma_${idPrestamo}_regreso_${Date.now()}.png`;
    urlFirmaRetorno = await subirImagenADrive(payload.firma_retorno_base64, nombreFirmaRegreso);
  }

  const obsPrevia = String(prestamoActual.observacion_regreso || '').trim();
  const obsNueva = String(payload.observacion_regreso || '').trim();
  const obsFinal = obsPrevia && obsNueva && obsPrevia !== obsNueva
    ? `${obsPrevia} | ${obsNueva}`
    : (obsNueva || obsPrevia);

  const camposActualizar = {
    nr_paletas: nrPaletasPrestadas,
    estado: nuevoEstado,
    nr_paletas_devueltas: totalDevueltas,
    fecha_devolucion: fechaDevolucion,
    recibido_por: payload.recibido_por,
    observacion_regreso: obsFinal,
    conductor_retorno: payload.dni_conductor_retorno || prestamoActual.conductor_retorno || null,
    firma_retorno: urlFirmaRetorno,
    usuario_actualiza: payload.usuario_actualiza,
    fecha_actualiza: ahoraISO
  };

  if (payload.placa_editada) {
    camposActualizar.nro_placa = payload.placa_editada.trim().toUpperCase();
  }
  if (payload.dni_conductor_editado) {
    camposActualizar.dni_conductor = payload.dni_conductor_editado.trim();
  }

  const { data, error } = await supabase
    .from('prestamos')
    .update(camposActualizar)
    .eq('uuid', prestamoActual.uuid)
    .select()
    .single();

  if (error) throw new Error(`Error al actualizar el préstamo: ${error.message}`);
  return data;
};

// =========================================================================
// 5. BUSCADOR, CREADOR Y EDITOR DE CONDUCTORES Y PLACAS (CON AUDITORÍA)
// =========================================================================

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
    // MODO EDICIÓN: Llena usuario_actualiza y fecha_actualiza
    const { data, error } = await supabase
      .from('conductores')
      .update({
        nombre_conductor: nombreMayus,
        empresa_id: empIdNum,
        usuario_actualiza: usuario,
        fecha_actualiza: ahoraISO
      })
      .eq('dni_conductor', dniLimpio)
      .select()
      .single();

    if (error) throw new Error(`Error al actualizar conductor: ${error.message}`);
    return { accion: 'actualizado', conductor: data };
  } else {
    // MODO CREACIÓN: Llena usuario_registra y fecha_registro
    const { data, error } = await supabase
      .from('conductores')
      .insert([{
        dni_conductor: dniLimpio,
        nombre_conductor: nombreMayus,
        empresa_id: empIdNum,
        usuario_registra: usuario,
        fecha_registro: ahoraISO
      }])
      .select()
      .single();

    if (error) throw new Error(`Error al crear conductor: ${error.message}`);
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
    // MODO EDICIÓN: Llena usuario_actualiza y fecha_actualiza
    const camposUpdate = {
      empresa_id: empIdNum,
      usuario_actualiza: usuario,
      fecha_actualiza: ahoraISO
    };
    if (volumen_m3 !== undefined && volumen_m3 !== '') {
      camposUpdate.volumen_m3 = Number(volumen_m3);
    }

    const { data, error } = await supabase
      .from('placas')
      .update(camposUpdate)
      .eq('nro_placa', placaLimpia)
      .select()
      .single();

    if (error) throw new Error(`Error al actualizar placa: ${error.message}`);
    return { accion: 'actualizada', placa: data };
  } else {
    // MODO CREACIÓN: Llena usuario_registra y fecha_registro
    const nuevoRegistro = {
      nro_placa: placaLimpia,
      empresa_id: empIdNum,
      usuario_registra: usuario,
      fecha_registro: ahoraISO
    };
    if (volumen_m3 !== undefined && volumen_m3 !== '') {
      nuevoRegistro.volumen_m3 = Number(volumen_m3);
    }

    const { data, error } = await supabase
      .from('placas')
      .insert([nuevoRegistro])
      .select()
      .single();

    if (error) throw new Error(`Error al registrar placa: ${error.message}`);
    return { accion: 'creada', placa: data };
  }
};
