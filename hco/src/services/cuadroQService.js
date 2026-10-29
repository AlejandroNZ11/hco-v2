import { supabase } from '../config/supabaseClient';
import { localDb } from './localDb';

export const ERRORES_POR_AREA = {
  "INBOUND": [
    "Error de rótulo en almacenamiento",
    "Error de almacenamiento (relocate)",
    "Código sin almacenar",
    "Costo sin validar",
    "Error en toma de lotes (recepción y traspaso)",
    "Costo sin prisma",
    "Traspaso con cantidad diferente (bodegas)",
    "Error de ingreso de lote al WMS",
    "Costo sin ingresar en WMS",
    "Exceso de TAG ID - no priorizado",
    "Error de almacenamiento (ingreso de mercadería)",
    "Nill pick (No se encontró el producto en el almacén)",
    "Repick (Producto encontrado en otra ubicación)",
    "Checklist de equipo No Aprobado"
  ],
  "OUTBOUND": [
    "Faltante de Picking Principal",
    "Faltante de Picking Médico",
    "Faltante de Picking Retail",
    "Sobrante de Picking Principal",
    "Sobrante de Picking Regulados",
    "Sobrante de Picking Retail",
    "Error en líneas rebajadas",
    "Caja sin etiqueta de saldo y/u origen",
    "Error de ruteo",
    "Error en etiquetas provincia",
    "Mercadería dañada/sin etiqueta",
    "Pendiente cierre de procesos en WMS EXPRESS",
    "Pallet con rótulo desactualizado",
    "Código se encontró en otra ubicación",
    "Embalaje de exportación modificado",
    "Repick (Producto encontrado en otra ubicación)",
    "Nill pick (No se encontró el producto en el almacén)",
    "Error de TAG SWAP",
    "Error en envío de información",
    "No se realizó relocate",
    "Error en Picking por cruce de SKUs",
    "Checklist de equipo No Aprobado",
    "Error de embalaje"
  ],
  "INVENTARIO": [
    "Diferencia de Inventario al cliente",
    "Ubicación descuadrada (Sobrante - Faltante)",
    "Checklist de equipo No Aprobado"
  ],
  "LOGISTICS SUPPORT": [
    "Error de conteo en Shipment (recepción)",
    "Shipment sin auditar",
    "Pedido sin auditar",
    "Error en la digitación de la hoja de ruta",
    "Pedidos con líneas duplicadas",
    "Query de pedidos no enviado",
    "Error de planificación (Retail)",
    "Error de planificación (Exportación)",
    "Error de planificación (Principal)",
    "Error en Registro de data logística",
    "Error en Reabastecimiento",
    "Pedido auditado sin cono de identificación de color verde",
    "Shipment sin rotulo de auditado para almacenar",
    "Checklist de equipo No Aprobado"
  ],
  "CALIDAD": [
    "Error de almacenamiento por bodegas",
    "Packing para destrucción incompleto",
    "Duplicidad de rótulos de bodegas no conformes médico/ no médico",
    "Error en picking entre bodegas",
    "Errores al ingresar información al RF",
    "Error en revisión de productos (lotes y vencimientos)",
    "Checklist de equipo No Aprobado"
  ],
  "LABELING": [
    "Error de abastecimiento de etiquetas",
    "Etiquetas sobrantes y/o faltantes",
    "Error de etiquetado",
    "Error de separación de lotes en el acondicionado",
    "Error de encajado de productos (faltantes y/o sobrantes)",
    "Error de impresión de etiquetas (Fecha de vencimiento incorrecto/ lote o cantidad incorrecto)",
    "Trazabilidad y muestreo de productos acondicionados desactualizado",
    "Fotopatrones en uso sin firma de aprobación por parte del cliente 3M",
    "Error en rótulo",
    "Se acondicionó código por otro",
    "Error de cantidades en traspaso",
    "Checklist de equipo No Aprobado"
  ],
  "LABORATORIO": [
    "Cruce de lotes (no revisan la cantidad total)",
    "Producto no Inyectado",
    "Datos incorrectos en la documentación",
    "Faltante de producto reacondicionado",
    "Falta de revisión en el proceso por parte de calidad en Laboratorio",
    "Error de traspaso entre bodegas",
    "Checklist de equipo No Aprobado"
  ],
  "BPE": [
    "Indicadores desactualizados",
    "Checklist de 5s desactualizados o ausencia",
    "Rótulos desactualizados",
    "Resultados 5S desactualizados"
  ],
  "RR.HH.": [
    "Firma de contrato tardia",
    "Programación de citas de taxi tardia",
    "No se apertura el consolidado de almuerzos de día anterior",
    "Registro de usuario incorrecto",
    "No se actualiza los usuarios (puesto, fotos, etc)"
  ],
  "3M": [
    "Error en el costo por parte del cliente",
    "Problemas en el sistema AS400",
    "Pedidos programados fuera de corte"
  ]
};

// Genera fecha local actual (YYYY-MM-DD)
export const obtenerFechaHoyLocal = () => {
  const hoy = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${hoy.getFullYear()}-${pad(hoy.getMonth() + 1)}-${pad(hoy.getDate())}`;
};

// Genera fecha y hora local (YYYY-MM-DD HH:mm:ss) sin adelanto UTC
const obtenerFechaHoraLocal = () => {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
};

/**
 * Calcula el estado del Cuadro Q según las reglas de negocio:
 * 1. Si evaluación es CANCELADO -> CANCELADO
 * 2. Si tiene fecha_cierre -> CONCLUIDO
 * 3. Si tiene fecha_planificada:
 *    - Si hoy > fecha_planificada -> ATRAZADO
 *    - Si hoy <= fecha_planificada -> EN PROCESO
 * 4. Si no tiene fecha_planificada -> PENDIENTE
 */
export const calcularEstadoAutomaticoCuadroQ = ({ evaluacion, fecha_planificada, fecha_cierre }) => {
  if (evaluacion === "CANCELADO") {
    return "CANCELADO";
  }

  if (fecha_cierre && String(fecha_cierre).trim() !== "") {
    return "CONCLUIDO";
  }

  const hoyStr = obtenerFechaHoyLocal();
  const planStr = fecha_planificada ? String(fecha_planificada).slice(0, 10) : "";

  if (planStr) {
    if (hoyStr > planStr) {
      return "ATRAZADO";
    }
    return "EN PROCESO";
  }

  return "PENDIENTE";
};

/**
 * Normaliza un registro proveniente de BD:
 * - Limpia fecha_cierre si el registro sigue PENDIENTE sin evaluación (evita falsos cierres por DEFAULT now() en BD)
 * - Recalcula el estado dinámico (ej. pasa de EN PROCESO a ATRAZADO si ya venció la fecha_planificada)
 */
const normalizarRegistroCuadroQ = (reg) => {
  if (!reg) return reg;

  const estadoBD = String(reg.estado || 'PENDIENTE').toUpperCase().trim();
  const sinAnalisisPrevio = estadoBD === 'PENDIENTE' && !reg.evaluacion && !reg.fecha_planificada;

  const fechaCierreLimpia = sinAnalisisPrevio ? null : (reg.fecha_cierre || null);
  const evalEfectiva = reg.evaluacion || (estadoBD === 'CANCELADO' ? 'CANCELADO' : '');

  const estadoCalculado = calcularEstadoAutomaticoCuadroQ({
    evaluacion: evalEfectiva,
    fecha_planificada: reg.fecha_planificada,
    fecha_cierre: fechaCierreLimpia
  });

  return {
    ...reg,
    fecha_cierre: fechaCierreLimpia,
    estado: estadoCalculado
  };
};

/**
 * Devuelve la lista de errores correspondiente al nombre del área
 */
export const obtenerErroresPorNombreArea = (nombreArea) => {
  if (!nombreArea) return [];
  const limpio = String(nombreArea)
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();

  if (ERRORES_POR_AREA[limpio]) return ERRORES_POR_AREA[limpio];

  if (limpio.includes("CALIDAD")) return ERRORES_POR_AREA["CALIDAD"];
  if (limpio.includes("RECURSOS HUMANOS") || limpio.includes("RRHH")) return ERRORES_POR_AREA["RR.HH."];
  if (limpio.includes("LOGISTICS") || limpio.includes("SOPORTE")) return ERRORES_POR_AREA["LOGISTICS SUPPORT"];
  if (limpio.includes("EXCELENCIA") || limpio.includes("BPE")) return ERRORES_POR_AREA["BPE"];

  const keyEncontrada = Object.keys(ERRORES_POR_AREA).find(
    (k) => limpio.includes(k) || k.includes(limpio)
  );

  return keyEncontrada ? ERRORES_POR_AREA[keyEncontrada] : [];
};

/**
 * Obtiene catálogos para el formulario
 */
export const obtenerCatalogosCuadroQ = async () => {
  try {
    await supabase.auth.getSession();

    const [resAreas, resWhite] = await Promise.all([
      supabase.from('areas').select('id, nombre, cuadro_q').order('nombre'),
      supabase.from('empleados').select('id, dni, nombre, tipo, estado, area_id').ilike('tipo', 'WHITE').ilike('estado', 'Activo').order('nombre')
    ]);

    const todasAreas = resAreas.data || [];
    if (todasAreas.length > 0 && localDb?.areas) {
      await localDb.areas.bulkPut(todasAreas);
    }

    const areasErrorActivas = todasAreas.filter(a => String(a.cuadro_q || '').trim().toUpperCase() === 'ACTIVO');

    return { todasAreas, areasError: areasErrorActivas, personalWhite: resWhite.data || [] };
  } catch (err) {
    console.warn("Error cargando catálogos de Cuadro Q desde Supabase, usando respaldo local:", err);
    const todasAreas = localDb?.areas ? await localDb.areas.toArray() : [];
    const todosUsuarios = localDb?.usuarios ? await localDb.usuarios.toArray() : [];

    const areasError = todasAreas.filter(
      (a) => String(a.cuadro_q || '').trim().toUpperCase() === 'ACTIVO'
    );
    const personalWhite = todosUsuarios.filter(
      (u) =>
        String(u.tipo || '').trim().toUpperCase() === 'WHITE' &&
        String(u.estado || 'Activo').trim().toUpperCase() === 'ACTIVO'
    );

    return { todasAreas, areasError, personalWhite };
  }
};

/**
 * Obtiene todos los registros de la tabla cuadro_q
 */
export const obtenerRegistrosCuadroQ = async () => {
  try {
    await supabase.auth.getSession();

    const { data, error } = await supabase
      .from('cuadro_q')
      .select('*')
      .order('fecha_registro', { ascending: false });

    if (error) throw new Error(error.message);

    const normalizados = (data || []).map(normalizarRegistroCuadroQ);

    if (normalizados.length > 0 && localDb.cuadro_q) {
      await localDb.cuadro_q.bulkPut(normalizados);
    }

    return normalizados;
  } catch (err) {
    console.warn(`Modo Offline o error de red: ${err.message}. Leyendo caché...`);
    if (localDb.cuadro_q) {
      const registrosLocales = await localDb.cuadro_q.toArray();
      return registrosLocales
        .map(normalizarRegistroCuadroQ)
        .sort((a, b) => new Date(b.fecha_registro) - new Date(a.fecha_registro));
    }
    return [];
  }
};

/**
 * Obtiene un registro específico de cuadro_q por su UUID
 */
export const obtenerCuadroQPorId = async (id) => {
  const { data, error } = await supabase
    .from('cuadro_q')
    .select('*')
    .eq('id', id)
    .single();

  if (error) throw new Error(`Error al cargar el registro: ${error.message}`);
  return normalizarRegistroCuadroQ(data);
};

/**
 * Crea un nuevo registro en cuadro_q (Fase 1: Registro)
 * Estado inicial siempre es 'PENDIENTE' y fecha_cierre es explícitamente null
 */
export const crearRegistroCuadroQ = async (datosRegistro) => {
  const payload = {
    registrador_id: datosRegistro.registrador_id || null,
    nombre_registrador: datosRegistro.nombre_registrador,
    area_registrador: datosRegistro.area_registrador,
    area_error_id: datosRegistro.area_error_id ? Number(datosRegistro.area_error_id) : null,
    area_error: datosRegistro.area_error,
    proceso: datosRegistro.proceso,
    error: datosRegistro.error,
    descripcion_error: datosRegistro.descripcion_error,
    estado: 'PENDIENTE',
    fecha_planificada: null,
    fecha_cierre: null
  };

  const { data, error } = await supabase
    .from('cuadro_q')
    .insert([payload])
    .select()
    .single();

  if (error) throw new Error(`Error al registrar Cuadro Q: ${error.message}`);
  return normalizarRegistroCuadroQ(data);
};

/**
 * Actualiza un registro de cuadro_q (Fase 2: Análisis y Seguimiento)
 */
export const actualizarRegistroCuadroQ = async (id, datosAnalisis) => {
  const { id: _ignoreId, id_cuadro_q: _ignoreCodigo, ...camposActualizar } = datosAnalisis;

  const { data, error } = await supabase
    .from('cuadro_q')
    .update({
      ...camposActualizar,
      fecha_cierre: camposActualizar.fecha_cierre || null,
      fecha_hora_actualiza: obtenerFechaHoraLocal()
    })
    .eq('id', id)
    .select()
    .maybeSingle();

  if (error) {
    throw new Error(`Error al actualizar Cuadro Q: ${error.message}`);
  }

  return normalizarRegistroCuadroQ(data);
};
