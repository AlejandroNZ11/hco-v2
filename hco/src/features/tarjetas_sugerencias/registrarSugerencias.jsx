import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate, useLocation, useSearchParams } from 'react-router-dom';

import Loading from '../../layouts/Loading';
import {
  obtenerCatalogosSugerencias,
  obtenerSugerenciaPorId,
  crearSugerencia,
  actualizarSugerencia,
  obtenerFechaHoraLima,
  obtenerFechaCortaLima
} from '../../services/sugerenciasService';
import './registrarSugerencias.css';

// Opciones fijas exactas
const CATEGORIAS_OPCIONES = [
  'EHS',
  'Productividad',
  'CALIDAD (perdida, cliente)',
  '5S',
  'Material Auxiliar',
  'Estandarización'
];

const FUENTES_OPCIONES = [
  'Cotidiano',
  'Auditoria 5S',
  'Wecare',
  'Gemba',
  'Gemba EHS'
];

const RECONOCIDO_OPCIONES = [
  'LUP',
  'Kaizen',
  'PDCA',
  'Proyecto Lean',
  'Cambio Menor'
];

const IMPACTO_OPCIONES = [
  'Productividad',
  'Seguridad 5S',
  'Medio Ambiente',
  'Calidad',
  'Informativo',
  '5S'
];

function getStoredAuthUser() {
  const raw = localStorage.getItem('authUser') || sessionStorage.getItem('authUser');
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

const normalizar = (txt) =>
  String(txt || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();

/**
 * Normaliza valores que antes eran ARRAY y ahora son TEXT en Supabase
 */
const aTextoPlano = (val) => {
  if (val === null || val === undefined) return '';
  if (Array.isArray(val)) return val[0] ? String(val[0]).trim() : '';
  if (typeof val === 'string') {
    const limpio = val.trim();
    if (!limpio) return '';
    // Si viene serializado como JSON array: '["Cotidiano"]'
    if (limpio.startsWith('[') && limpio.endsWith(']')) {
      try {
        const parsed = JSON.parse(limpio);
        return Array.isArray(parsed) ? String(parsed[0] || '').trim() : limpio;
      } catch {
        return limpio;
      }
    }
    // Si viene como literal de arreglo Postgres: '{"Cotidiano"}'
    if (limpio.startsWith('{') && limpio.endsWith('}')) {
      const interno = limpio.slice(1, -1).split(',')[0] || '';
      return interno.replace(/^"|"$/g, '').trim();
    }
    return limpio;
  }
  return String(val);
};

/**
 * Suma días a una fecha YYYY-MM-DD y devuelve YYYY-MM-DD
 */
const sumarDiasFecha = (fechaStr, dias) => {
  if (!fechaStr) return '';
  const partes = String(fechaStr).slice(0, 10).split('-').map(Number);
  if (partes.length !== 3 || partes.some(isNaN)) return '';
  const d = new Date(Date.UTC(partes[0], partes[1] - 1, partes[2]));
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
};

/**
 * Suma meses a una fecha YYYY-MM-DD y devuelve YYYY-MM-DD
 */
const sumarMesesFecha = (fechaStr, meses) => {
  if (!fechaStr) return '';
  const partes = String(fechaStr).slice(0, 10).split('-').map(Number);
  if (partes.length !== 3 || partes.some(isNaN)) return '';
  const d = new Date(Date.UTC(partes[0], partes[1] - 1, partes[2]));
  d.setUTCMonth(d.getUTCMonth() + meses);
  return d.toISOString().slice(0, 10);
};

function RegistrarSugerenciasContenido() {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();

  const sugerenciaEditId = searchParams.get('id') || location.state?.sugerencia?.id || null;
  const esModoEdicion = Boolean(sugerenciaEditId);

  const [currentUser] = useState(() => getStoredAuthUser());
  const [loading, setLoading] = useState(false);
  const [relojLima, setRelojLima] = useState(() => obtenerFechaHoraLima());

  // Estado guardado en BD al abrir la tarjeta (para saber si ya estaba Concluido)
  const [estadoInicialDB, setEstadoInicialDB] = useState('Por Validar');

  // Catálogos desde Supabase / Dexie
  const [empleados, setEmpleados] = useState([]);
  const [areas, setAreas] = useState([]);
  const [cargos, setCargos] = useState([]);

  // Buscador de empleados para el campo "Equipo"
  const [busquedaEquipo, setBusquedaEquipo] = useState('');
  const [mostrarDropdownEquipo, setMostrarDropdownEquipo] = useState(false);

  // Estado principal del formulario (fuentes, reconocido e impacto son TEXT)
  const [formData, setFormData] = useState({
    id_sugerencia: '',
    estado: 'Por Validar',
    fecha_registro: '',
    proceso: '',
    fecha_plan: '',
    area_registro_id: null,
    area_registro: '',
    usuario_registro_id: null,
    usuario_registro: '',
    cargo_registro: '',
    jefe_registro: '',
    categorias: [],
    fuentes: '',
    equipo_ids: [],
    equipo_nombres: [],
    descripcion_sugerencia: '',
    beneficios_sugerencia: '',

    // Campos de Análisis y Cierre
    area_responsable_id: '',
    area_responsable: '',
    responsable_id: '',
    nombre_responsable: '',
    responsable_apoyo_id: '',
    responsable_apoyo: '',
    reconocido: '',
    impacto: '',
    plan_accion: '',
    fecha_cierre: '',
    comentario_adicional: '',
    fecha_cancelacion: '',
    comentario_cancelacion: '',
    fechahora_actualiza: '',
    usuario_actualiza: ''
  });

  // Modal de Aviso Flotante
  const [avisoFlotante, setAvisoFlotante] = useState({
    visible: false,
    tipo: 'warning',
    titulo: '',
    mensaje: '',
    detalleExtra: '',
    onCloseCallback: null
  });

  const mostrarAviso = (tipo, titulo, mensaje, detalleExtra = '', onCloseCallback = null) => {
    setAvisoFlotante({
      visible: true,
      tipo,
      titulo,
      mensaje,
      detalleExtra,
      onCloseCallback
    });
  };

  const cerrarAviso = () => {
    const cb = avisoFlotante.onCloseCallback;
    setAvisoFlotante(prev => ({ ...prev, visible: false, onCloseCallback: null }));
    if (typeof cb === 'function') cb();
  };

  // =========================================================
  // PERMISOS POR ROL
  // - usuario: solo ve en edición (crea en nuevo registro)
  // - admin: solo ve en edición
  // - supervisor: edita solo Análisis (Sección 3); Sección 2 bloqueada; si está Concluido pasa a solo ver
  // - superadmin: todo ve y todo edita siempre
  // =========================================================
  const rolUsuario = normalizar(
    currentUser?.rol || currentUser?.role || currentUser?.roles?.nombre || ''
  );

  const esSuperAdmin =
    rolUsuario === 'superadmin' ||
    rolUsuario === 'super_admin' ||
    rolUsuario === 'super administrador';

  const esSupervisor =
    rolUsuario === 'supervisor' ||
    rolUsuario === 'supervisores';

  const tarjetaYaConcluida =
    esModoEdicion && normalizar(estadoInicialDB) === 'concluido';

  // Sección 2 (Clasificación y Detalle):
  // En creación nueva todos pueden llenar; en edición solo Superadmin puede modificarla.
  const puedeEditarDetalleInicial = !esModoEdicion || esSuperAdmin;

  // Sección 3 (Análisis y Seguimiento):
  // Solo en modo edición: Superadmin siempre, o Supervisor si la tarjeta NO está Concluida.
  const puedeAnalizar =
    esModoEdicion && (esSuperAdmin || (esSupervisor && !tarjetaYaConcluida));

  // Reloj en vivo de Lima cuando es un Nuevo Registro
  useEffect(() => {
    if (esModoEdicion) return;
    const timer = setInterval(() => {
      setRelojLima(obtenerFechaHoraLima());
    }, 1000);
    return () => clearInterval(timer);
  }, [esModoEdicion]);

  useEffect(() => {
    if (!currentUser) {
      navigate('/');
      return;
    }
    inicializarPantalla();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser, sugerenciaEditId]);

  const inicializarPantalla = async () => {
    setLoading(true);
    try {
      const { empleados: empList, areas: areaList, cargos: cargoList } = await obtenerCatalogosSugerencias();
      setEmpleados(empList || []);
      setAreas(areaList || []);
      setCargos(cargoList || []);

      const miFicha = (empList || []).find(
        e => (currentUser?.id && String(e.id) === String(currentUser.id)) ||
             (currentUser?.dni && String(e.dni) === String(currentUser.dni))
      );

      const areaObjUsuario = (areaList || []).find(
        a => String(a.id) === String(miFicha?.area_id || currentUser?.area_id)
      );
      const cargoObjUsuario = (cargoList || []).find(
        c => String(c.id) === String(miFicha?.cargo_id || currentUser?.cargo_id)
      );
      const jefeObjUsuario = (empList || []).find(
        j => String(j.id) === String(miFicha?.jefe_directo_id || currentUser?.jefe_directo_id)
      );

      const nombreAreaLogueado =
        areaObjUsuario?.nombre ||
        currentUser?.area_nombre ||
        currentUser?.area?.nombre ||
        (typeof currentUser?.area === 'string' ? currentUser.area : '');

      const nombreCargoLogueado =
        cargoObjUsuario?.nombre ||
        currentUser?.cargo_nombre ||
        currentUser?.cargo?.nombre ||
        currentUser?.rol || '';

      const nombreJefeLogueado =
        jefeObjUsuario?.nombre ||
        currentUser?.jefe_directo || '';

      if (esModoEdicion) {
        const reg = await obtenerSugerenciaPorId(sugerenciaEditId);
        if (!reg) {
          mostrarAviso('danger', 'No encontrado', 'No se encontró la sugerencia seleccionada.', '', () => navigate('/sugerencias/tracking'));
          return;
        }

        const creadorFicha = (empList || []).find(e => String(e.id) === String(reg.usuario_registro_id));
        const cargoCreador = (cargoList || []).find(c => String(c.id) === String(creadorFicha?.cargo_id))?.nombre || '';
        const jefeCreador = (empList || []).find(j => String(j.id) === String(creadorFicha?.jefe_directo_id))?.nombre || '';

        const estadoGuardado = reg.estado || 'Por Validar';
        setEstadoInicialDB(estadoGuardado);

        setFormData({
          id_sugerencia: reg.id_sugerencia || 'PENDIENTE',
          estado: estadoGuardado,
          fecha_registro: reg.fecha_registro || '',
          proceso: reg.proceso || '',
          fecha_plan: reg.fecha_plan ? String(reg.fecha_plan).slice(0, 10) : '',
          area_registro_id: reg.area_registro_id || null,
          area_registro: reg.area_registro || '',
          usuario_registro_id: reg.usuario_registro_id || null,
          usuario_registro: reg.usuario_registro || '',
          cargo_registro: cargoCreador || 'Operador / Analista',
          jefe_registro: jefeCreador || '-',
          categorias: Array.isArray(reg.categorias) ? reg.categorias : [],
          fuentes: aTextoPlano(reg.fuentes),
          equipo_ids: Array.isArray(reg.equipo_ids) ? reg.equipo_ids : [],
          equipo_nombres: Array.isArray(reg.equipo_nombres) ? reg.equipo_nombres : [],
          descripcion_sugerencia: reg.descripcion_sugerencia || '',
          beneficios_sugerencia: reg.beneficios_sugerencia || '',

          area_responsable_id: reg.area_responsable_id || '',
          area_responsable: reg.area_responsable || '',
          responsable_id: reg.responsable_id || '',
          nombre_responsable: reg.nombre_responsable || '',
          responsable_apoyo_id: reg.responsable_apoyo_id || '',
          responsable_apoyo: reg.responsable_apoyo || '',
          reconocido: aTextoPlano(reg.reconocido),
          impacto: aTextoPlano(reg.impacto),
          plan_accion: reg.plan_accion || '',
          fecha_cierre: reg.fecha_cierre ? String(reg.fecha_cierre).slice(0, 10) : '',
          comentario_adicional: reg.comentario_adicional || '',
          fecha_cancelacion: reg.fecha_cancelacion ? String(reg.fecha_cancelacion).slice(0, 10) : '',
          comentario_cancelacion: reg.comentario_cancelacion || '',
          fechahora_actualiza: reg.fechahora_actualiza || '',
          usuario_actualiza: reg.usuario_actualiza || ''
        });
      } else {
        setEstadoInicialDB('Por Validar');
        setFormData(prev => ({
          ...prev,
          estado: 'Por Validar',
          area_registro_id: areaObjUsuario?.id || miFicha?.area_id || currentUser?.area_id || null,
          area_registro: nombreAreaLogueado,
          usuario_registro_id: miFicha?.id || currentUser?.id || null,
          usuario_registro: miFicha?.nombre || currentUser?.nombre || 'Usuario',
          cargo_registro: nombreCargoLogueado,
          jefe_registro: nombreJefeLogueado
        }));
      }
    } catch (err) {
      console.error(err);
      mostrarAviso('danger', 'Error al cargar', err.message);
    } finally {
      setLoading(false);
    }
  };

  // Empleados activos para selectores
  const empleadosActivos = useMemo(() => {
    return empleados.filter(e => !normalizar(e.estado).includes('inactivo'));
  }, [empleados]);

  // Empleados filtrados según el "Área Responsable" seleccionada
  const empleadosPorAreaResponsable = useMemo(() => {
    if (!formData.area_responsable_id && !formData.area_responsable) return [];
    return empleadosActivos.filter(emp => {
      const coincideId =
        formData.area_responsable_id &&
        emp.area_id !== undefined &&
        emp.area_id !== null &&
        String(emp.area_id) === String(formData.area_responsable_id);

      const coincideNombre =
        formData.area_responsable &&
        normalizar(emp.area_nombre || emp.area?.nombre || emp.area) === normalizar(formData.area_responsable);

      return coincideId || coincideNombre;
    });
  }, [empleadosActivos, formData.area_responsable_id, formData.area_responsable]);

  // Sugerencias de autocompletado para agregar integrantes a "Equipo"
  const sugerenciasEquipo = useMemo(() => {
    const q = normalizar(busquedaEquipo);
    if (!q) return [];
    return empleadosActivos
      .filter(e =>
        !formData.equipo_ids.includes(e.id) &&
        (normalizar(e.nombre).includes(q) || normalizar(e.dni).includes(q))
      )
      .slice(0, 8);
  }, [busquedaEquipo, empleadosActivos, formData.equipo_ids]);

  // Alternar casillas de arrays múltiples (Categorías)
  const toggleItemArray = (campo, valor) => {
    setFormData(prev => {
      const actual = Array.isArray(prev[campo]) ? prev[campo] : [];
      const existe = actual.includes(valor);
      const nuevo = existe ? actual.filter(item => item !== valor) : [...actual, valor];
      return { ...prev, [campo]: nuevo };
    });
  };

  // Agregar y quitar empleado en "Equipo"
  const agregarIntegranteEquipo = (emp) => {
    setFormData(prev => ({
      ...prev,
      equipo_ids: [...prev.equipo_ids, emp.id],
      equipo_nombres: [...prev.equipo_nombres, emp.nombre]
    }));
    setBusquedaEquipo('');
    setMostrarDropdownEquipo(false);
  };

  const quitarIntegranteEquipo = (indexToRemove) => {
    setFormData(prev => ({
      ...prev,
      equipo_ids: prev.equipo_ids.filter((_, idx) => idx !== indexToRemove),
      equipo_nombres: prev.equipo_nombres.filter((_, idx) => idx !== indexToRemove)
    }));
  };

  // Cambio de Área Responsable (filtra y limpia responsable si no pertenece a la nueva área)
  const handleAreaResponsableChange = (e) => {
    const idSel = e.target.value;
    const areaObj = areas.find(a => String(a.id) === String(idSel));

    setFormData(prev => {
      const empActual = empleadosActivos.find(emp => String(emp.id) === String(prev.responsable_id));
      const perteneceNuevaArea =
        areaObj &&
        empActual &&
        (String(empActual.area_id) === String(areaObj.id) ||
         normalizar(empActual.area_nombre || empActual.area) === normalizar(areaObj.nombre));

      return {
        ...prev,
        area_responsable_id: areaObj ? areaObj.id : '',
        area_responsable: areaObj ? areaObj.nombre : '',
        responsable_id: perteneceNuevaArea ? prev.responsable_id : '',
        nombre_responsable: perteneceNuevaArea ? prev.nombre_responsable : ''
      };
    });
  };

  // Cambio de Responsable Principal
  const handleResponsableChange = (e) => {
    const idSel = e.target.value;
    const empObj = empleadosActivos.find(emp => String(emp.id) === String(idSel));
    setFormData(prev => ({
      ...prev,
      responsable_id: empObj ? empObj.id : '',
      nombre_responsable: empObj ? empObj.nombre : ''
    }));
  };

  // Cambio de Responsable de Apoyo
  const handleApoyoChange = (e) => {
    const idSel = e.target.value;
    const empObj = empleadosActivos.find(emp => String(emp.id) === String(idSel));
    setFormData(prev => ({
      ...prev,
      responsable_apoyo_id: empObj ? empObj.id : '',
      responsable_apoyo: empObj ? empObj.nombre : ''
    }));
  };

  // Cambio de Fecha Planificada (valida que Fecha de Cierre siga siendo mayor)
  const handleFechaPlanChange = (e) => {
    const nuevaFechaPlan = e.target.value;
    setFormData(prev => {
      const cierreValido =
        nuevaFechaPlan && prev.fecha_cierre && prev.fecha_cierre > nuevaFechaPlan;
      return {
        ...prev,
        fecha_plan: nuevaFechaPlan,
        fecha_cierre: cierreValido ? prev.fecha_cierre : ''
      };
    });
  };

  // Cambio de Fecha de Cancelación (habilita o limpia Motivo de Cancelación)
  const handleFechaCancelacionChange = (e) => {
    const nuevaFechaCancel = e.target.value;
    setFormData(prev => ({
      ...prev,
      fecha_cancelacion: nuevaFechaCancel,
      comentario_cancelacion: nuevaFechaCancel ? prev.comentario_cancelacion : ''
    }));
  };

  // Fecha mínima permitida para Fecha de Cierre (estrictamente mayor a Fecha Planificada: +1 día)
  const minFechaCierre = useMemo(() => {
    return formData.fecha_plan ? sumarDiasFecha(formData.fecha_plan, 1) : '';
  }, [formData.fecha_plan]);

  // =========================================================
  // CÁLCULO AUTOMÁTICO DEL ESTADO
  // 1. Si tiene Fecha de Cancelación -> 'Cancelado'
  // 2. Si tiene Fecha de Cierre -> 'Concluido'
  // 3. Si tiene Fecha Planificada:
  //    - Mayor a 3 meses -> 'Futuro'
  //    - Menor o igual a 3 meses -> 'Priorizado'
  // 4. Por defecto -> 'Por Validar'
  // =========================================================
  const calcularEstadoAutomatico = (datos) => {
    if (datos.fecha_cancelacion) {
      return 'Cancelado';
    }
    if (datos.fecha_cierre) {
      return 'Concluido';
    }
    if (datos.fecha_plan) {
      const fechaBase = datos.fecha_registro
        ? String(datos.fecha_registro).slice(0, 10)
        : obtenerFechaCortaLima();
      const fechaLimiteTresMeses = sumarMesesFecha(fechaBase, 3);

      if ( fechaLimiteTresMeses && datos.fecha_plan > fechaLimiteTresMeses ) {
        return 'Futuro';
      }
      return 'Priorizado';
    }
    return 'Por Validar';
  };

  const estadoCalculado = calcularEstadoAutomatico(formData);

  const handleSubmit = async (e) => {
    e.preventDefault();

    // 1. Validaciones de Registro de Sugerencia (Sección 2)
    if (!formData.proceso.trim()) {
      return mostrarAviso('warning', 'Proceso requerido', 'Por favor escriba el proceso al que pertenece la sugerencia.');
    }
    if (!formData.fuentes.trim()) {
      return mostrarAviso('warning', 'Fuente requerida', 'Seleccione una Fuente de la lista desplegable.');
    }
    if (formData.descripcion_sugerencia.trim().length < 10) {
      return mostrarAviso('warning', 'Descripción muy corta', 'La descripción de la sugerencia debe tener al menos 10 caracteres.');
    }
    if (formData.categorias.length === 0) {
      return mostrarAviso('warning', 'Categoría requerida', 'Seleccione al menos una Categoría para la sugerencia.');
    }

    // 2. Validaciones de Análisis (si está en Modo Edición y tiene permisos para analizar)
    if (esModoEdicion && puedeAnalizar) {
      // Validación de Fecha de Cierre vs Fecha Planificada
      if (formData.fecha_cierre) {
        if (!formData.fecha_plan) {
          return mostrarAviso(
            'warning',
            'Fecha Planificada requerida',
            'No puede registrar una Fecha de Cierre sin haber definido primero la Fecha Planificada.'
          );
        }
        if (formData.fecha_cierre <= formData.fecha_plan) {
          return mostrarAviso(
            'warning',
            'Fecha de Cierre inválida',
            'La Fecha de Cierre debe ser mayor a la Fecha Planificada.'
          );
        }
      }

      // Caso A: Cancelación
      if (formData.fecha_cancelacion) {
        if (!formData.area_responsable_id || !formData.area_responsable) {
          return mostrarAviso(
            'warning',
            'Área Responsable requerida',
            'Para cancelar la sugerencia debe seleccionar el Área Responsable.'
          );
        }
        if (!formData.responsable_id || !formData.nombre_responsable) {
          return mostrarAviso(
            'warning',
            'Nombre del Responsable requerido',
            'Para cancelar la sugerencia debe seleccionar el Nombre del Responsable.'
          );
        }
        if (!formData.comentario_cancelacion.trim() || formData.comentario_cancelacion.trim().length < 5) {
          return mostrarAviso(
            'warning',
            'Motivo de Cancelación obligatorio',
            'Al ingresar una Fecha de Cancelación, debe escribir el Motivo de Cancelación (mínimo 5 caracteres).'
          );
        }
      } else {
        // Caso B: Planificación / Análisis / Cierre
        const hayDatosAnalisis = Boolean(
          formData.fecha_plan ||
          formData.fecha_cierre ||
          formData.area_responsable_id ||
          formData.responsable_id ||
          formData.reconocido ||
          formData.impacto ||
          formData.plan_accion.trim()
        );

        if (hayDatosAnalisis) {
          if (!formData.area_responsable_id || !formData.area_responsable) {
            return mostrarAviso('warning', 'Área Responsable requerida', 'Seleccione el Área Responsable del análisis.');
          }
          if (!formData.responsable_id || !formData.nombre_responsable) {
            return mostrarAviso('warning', 'Responsable requerido', 'Seleccione el Nombre del Responsable de la sugerencia.');
          }
          if (!formData.fecha_plan) {
            return mostrarAviso('warning', 'Fecha Planificada requerida', 'Seleccione la Fecha Planificada para la implementación.');
          }
          if (!formData.impacto.trim()) {
            return mostrarAviso('warning', 'Impacto requerido', 'Seleccione el tipo de Impacto.');
          }
          if (!formData.plan_accion.trim()) {
            return mostrarAviso('warning', 'Plan de Acción requerido', 'Describa las actividades en el campo Plan de Acción.');
          }
        }
      }
    }

    setLoading(true);
    try {
      const payload = {
        estado: estadoCalculado,
        proceso: formData.proceso.trim(),
        fecha_plan: formData.fecha_plan || null,
        area_registro_id: formData.area_registro_id ? Number(formData.area_registro_id) : null,
        area_registro: formData.area_registro || '',
        usuario_registro_id: formData.usuario_registro_id || null,
        usuario_registro: formData.usuario_registro || '',
        categorias: formData.categorias,
        fuentes: formData.fuentes.trim() || null,
        reconocido: formData.reconocido.trim() || null,
        impacto: formData.impacto.trim() || null,
        area_responsable_id: formData.area_responsable_id ? Number(formData.area_responsable_id) : null,
        area_responsable: formData.area_responsable || null,
        equipo_ids: formData.equipo_ids,
        equipo_nombres: formData.equipo_nombres,
        responsable_apoyo_id: formData.responsable_apoyo_id || null,
        responsable_apoyo: formData.responsable_apoyo || null,
        responsable_id: formData.responsable_id || null,
        nombre_responsable: formData.nombre_responsable || null,
        descripcion_sugerencia: formData.descripcion_sugerencia.trim(),
        beneficios_sugerencia: formData.beneficios_sugerencia.trim() || null,
        plan_accion: formData.plan_accion.trim() || null,
        fecha_cierre: formData.fecha_cierre || null,
        comentario_adicional: formData.comentario_adicional.trim() || null,
        fecha_cancelacion: formData.fecha_cancelacion || null,
        comentario_cancelacion: formData.fecha_cancelacion
          ? (formData.comentario_cancelacion.trim() || null)
          : null,
        usuario_actualiza: currentUser?.nombre || 'Usuario'
      };

      if (esModoEdicion) {
        const res = await actualizarSugerencia(sugerenciaEditId, payload);
        mostrarAviso(
          'success',
          'Sugerencia Actualizada',
          `Los cambios de la tarjeta ${res.id_sugerencia || ''} se guardaron correctamente.`,
          `Estado actual: ${res.estado}`,
          () => navigate('/sugerencias/tracking')
        );
      } else {
        const res = await crearSugerencia(payload);
        mostrarAviso(
          'success',
          'Sugerencia Registrada',
          res._sincronizado === false
            ? 'Guardada en el dispositivo (Modo Offline). Se enviará automáticamente al recuperar señal.'
            : `La tarjeta ${res.id_sugerencia} fue registrada con éxito.`,
          `Estado inicial: ${res.estado}`,
          () => navigate('/sugerencias/tracking')
        );
      }
    } catch (err) {
      console.error(err);
      mostrarAviso('danger', 'Error al guardar', err.message || 'Ocurrió un error inesperado.');
    } finally {
      setLoading(false);
    }
  };

  const mostrarBotonGuardar = !esModoEdicion || puedeAnalizar || puedeEditarDetalleInicial;

  return (
    <div className="sugerencia-form-page">
      {loading && <Loading />}

      {/* AVISO FLOTANTE MODERNO */}
      {avisoFlotante.visible && (
        <div className="tw-modal-backdrop" onClick={cerrarAviso}>
          <div
            className={`tw-modal-card tw-modal-${avisoFlotante.tipo}`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="tw-modal-header">
              <div className={`tw-modal-icon-circle ${avisoFlotante.tipo}`}>
                {avisoFlotante.tipo === 'danger' && '✕'}
                {avisoFlotante.tipo === 'warning' && '⚠️'}
                {avisoFlotante.tipo === 'success' && '✓'}
              </div>
              <div className="tw-modal-text">
                <h3 className="tw-modal-title">{avisoFlotante.titulo}</h3>
                <p className="tw-modal-desc">{avisoFlotante.mensaje}</p>
                {avisoFlotante.detalleExtra && (
                  <div className="tw-modal-extra-box">{avisoFlotante.detalleExtra}</div>
                )}
              </div>
            </div>
            <div className="tw-modal-footer">
              <button
                type="button"
                className={`tw-modal-btn ${avisoFlotante.tipo}`}
                onClick={cerrarAviso}
              >
                Entendido
              </button>
            </div>
          </div>
        </div>
      )}

      <section className="sugerencia-card">
        <div className="card-head-modern">
          <div className="card-head-left">
            <h2>
              {esModoEdicion
                ? `Detalle y Análisis de Sugerencia ${formData.id_sugerencia ? `(${formData.id_sugerencia})` : ''}`
                : 'Nueva Tarjeta de Sugerencia'}
            </h2>
            <p>
              Usuario activo: <strong>{currentUser?.nombre}</strong>
            </p>
          </div>

          <div className="card-head-right">
            {esModoEdicion && (
              <div className="legend-item">
                <span className="legend-dot auto"></span>
                <span>Automático / Lectura</span>
              </div>
            )}
            <div className="legend-item">
              <span className="legend-dot manual"></span>
              <span>Debe completar</span>
            </div>
          </div>
        </div>

        <form onSubmit={handleSubmit} noValidate>
          {/* =========================================================
              1. DATOS AUTOMÁTICOS DEL REGISTRO
              ========================================================= */}
          {esModoEdicion && (
            <>
              <div className="section-title-row" style={{ marginTop: 0, borderTop: 'none', paddingTop: 0 }}>
                <div className="section-title">1. Datos del Solicitante y Registro</div>
              </div>

              <div className="grid-4-cols">
                <div className="field field-auto">
                  <label>
                    Estado Actual <span className="field-badge auto">AUTO</span>
                  </label>
                  <input type="text" value={estadoCalculado} readOnly />
                </div>

                <div className="field field-auto">
                  <label>
                    Fecha y Hora (Lima) <span className="field-badge auto">AUTO</span>
                  </label>
                  <input
                    type="text"
                    value={esModoEdicion ? String(formData.fecha_registro).replace('T', ' ').slice(0, 19) : relojLima}
                    readOnly
                  />
                </div>

                <div className="field field-auto">
                  <label>
                    Registrado por <span className="field-badge auto">AUTO</span>
                  </label>
                  <input type="text" value={formData.usuario_registro} readOnly />
                </div>

                <div className="field field-auto">
                  <label>
                    Área de Registro <span className="field-badge auto">AUTO</span>
                  </label>
                  <input type="text" value={formData.area_registro || 'Sin área asignada'} readOnly />
                </div>
              </div>
            </>
          )}

          {/* =========================================================
              2. CLASIFICACIÓN Y DETALLE DE LA SUGERENCIA
              ========================================================= */}
          <div
            className="section-title-row"
            style={!esModoEdicion ? { marginTop: 0, borderTop: 'none', paddingTop: 0 } : undefined}
          >
            <div className="section-title">
              {esModoEdicion ? '2. Clasificación y Detalle de la Sugerencia' : 'Clasificación y Detalle de la Sugerencia'}
            </div>
            {esModoEdicion && (
              <span style={{ fontSize: '11.5px', color: '#64748b', fontWeight: 600 }}>
                {puedeEditarDetalleInicial ? 'Modo Edición Habilitado' : 'Modo Solo Lectura'}
              </span>
            )}
          </div>

          {/* PRIMERA FILA: PROCESO | FUENTE */}
          <div className="grid-2-cols">
            <div className={`field ${puedeEditarDetalleInicial ? 'field-manual' : 'field-auto'}`}>
              <label>
                Proceso <span className={`field-badge ${puedeEditarDetalleInicial ? 'manual' : 'auto'}`}>
                  {puedeEditarDetalleInicial ? 'OBLIGATORIO' : 'LECTURA'}
                </span>
              </label>
              <input
                type="text"
                placeholder="Ej: Recepción, Picking, Despacho, Inventario..."
                value={formData.proceso}
                onChange={(e) => setFormData({ ...formData, proceso: e.target.value })}
                disabled={!puedeEditarDetalleInicial}
                required
              />
            </div>

            <div className={`field ${puedeEditarDetalleInicial ? 'field-manual' : 'field-auto'}`}>
              <label>
                Fuente <span className={`field-badge ${puedeEditarDetalleInicial ? 'manual' : 'auto'}`}>
                  {puedeEditarDetalleInicial ? 'OBLIGATORIO' : 'LECTURA'}
                </span>
              </label>
              <select
                value={formData.fuentes || ''}
                onChange={(e) => setFormData({ ...formData, fuentes: e.target.value })}
                disabled={!puedeEditarDetalleInicial}
                required
              >
                <option value="">Seleccione una fuente...</option>
                {FUENTES_OPCIONES.map((item) => (
                  <option key={item} value={item}>{item}</option>
                ))}
              </select>
            </div>
          </div>

          {/* SEGUNDA FILA: EQUIPO INVOLUCRADO */}
          <div style={{ marginTop: '12px' }}>
            <div className={`field ${puedeEditarDetalleInicial ? 'field-manual' : 'field-auto'} equipo-autocomplete-wrapper`}>
              <label>
                Equipo Involucrado (Personal) <span className="field-badge optional">OPCIONAL</span>
              </label>
              {puedeEditarDetalleInicial && (
                <input
                  type="text"
                  placeholder="Buscar colaborador por nombre o DNI para agregar al equipo..."
                  value={busquedaEquipo}
                  onChange={(e) => {
                    setBusquedaEquipo(e.target.value);
                    setMostrarDropdownEquipo(true);
                  }}
                  onFocus={() => setMostrarDropdownEquipo(true)}
                  onBlur={() => setTimeout(() => setMostrarDropdownEquipo(false), 180)}
                />
              )}

              {mostrarDropdownEquipo && sugerenciasEquipo.length > 0 && (
                <div className="equipo-dropdown-list">
                  {sugerenciasEquipo.map((emp) => (
                    <div
                      key={emp.id}
                      className="equipo-dropdown-item"
                      onMouseDown={() => agregarIntegranteEquipo(emp)}
                    >
                      <span>{emp.nombre}</span>
                      <small style={{ color: '#64748b' }}>{emp.dni}</small>
                    </div>
                  ))}
                </div>
              )}

              <div className="equipo-selected-tags">
                {formData.equipo_nombres.length === 0 ? (
                  <span style={{ fontSize: '11.5px', color: '#94a3b8' }}>
                    Ningún integrante adicional seleccionado.
                  </span>
                ) : (
                  formData.equipo_nombres.map((nom, idx) => (
                    <span key={idx} className="equipo-tag-pill">
                      {nom}
                      {puedeEditarDetalleInicial && (
                        <button
                          type="button"
                          className="equipo-tag-remove"
                          onClick={() => quitarIntegranteEquipo(idx)}
                          title="Quitar del equipo"
                        >
                          ×
                        </button>
                      )}
                    </span>
                  ))
                )}
              </div>
            </div>
          </div>

          {/* TERCERA FILA: DESCRIPCIÓN Y BENEFICIOS DE LA SUGERENCIA */}
          <div className="grid-2-cols" style={{ marginTop: '12px' }}>
            <div className={`field ${puedeEditarDetalleInicial ? 'field-manual' : 'field-auto'}`}>
              <label>
                Descripción de la Sugerencia <span className={`field-badge ${puedeEditarDetalleInicial ? 'manual' : 'auto'}`}>
                  {puedeEditarDetalleInicial ? 'OBLIGATORIO' : 'LECTURA'}
                </span>
              </label>
              <textarea
                rows="3"
                placeholder="Describa detalladamente la idea o mejora propuesta..."
                value={formData.descripcion_sugerencia}
                onChange={(e) => setFormData({ ...formData, descripcion_sugerencia: e.target.value })}
                disabled={!puedeEditarDetalleInicial}
                required
              />
              <div className="counter">{formData.descripcion_sugerencia.length} caracteres</div>
            </div>

            <div className={`field ${puedeEditarDetalleInicial ? 'field-manual' : 'field-auto'}`}>
              <label>
                Beneficios de la Sugerencia <span className="field-badge optional">RECOMENDADO</span>
              </label>
              <textarea
                rows="3"
                placeholder="¿Qué beneficio o ahorro traerá esta mejora?..."
                value={formData.beneficios_sugerencia}
                onChange={(e) => setFormData({ ...formData, beneficios_sugerencia: e.target.value })}
                disabled={!puedeEditarDetalleInicial}
              />
              <div className="counter">{formData.beneficios_sugerencia.length} caracteres</div>
            </div>
          </div>

          {/* CUARTA FILA: CATEGORÍAS */}
          <div style={{ marginTop: '12px' }}>
            <div className={`field ${puedeEditarDetalleInicial ? 'field-manual' : 'field-auto'}`}>
              <label>
                Categorías (Marque una o más) <span className={`field-badge ${puedeEditarDetalleInicial ? 'manual' : 'auto'}`}>
                  {puedeEditarDetalleInicial ? 'OBLIGATORIO' : 'LECTURA'}
                </span>
              </label>
              <div className="chips-selector-grid">
                {CATEGORIAS_OPCIONES.map((item) => {
                  const marcado = formData.categorias.includes(item);
                  return (
                    <button
                      type="button"
                      key={item}
                      disabled={!puedeEditarDetalleInicial}
                      className={`chip-check-btn ${marcado ? 'selected' : ''}`}
                      onClick={() => toggleItemArray('categorias', item)}
                    >
                      <span className="chip-check-box">✓</span>
                      <span>{item}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* =========================================================
              3. ANÁLISIS, RESPONSABLES Y SEGUIMIENTO
              ========================================================= */}
          {esModoEdicion && (
            <>
              <div className="section-title-row">
                <div className="section-title">3. Análisis, Asignación y Seguimiento</div>
                <span style={{ fontSize: '11.5px', color: '#64748b', fontWeight: 600 }}>
                  {puedeAnalizar
                    ? 'Modo Edición Habilitado'
                    : tarjetaYaConcluida
                      ? 'Tarjeta Concluida (Solo Lectura)'
                      : 'Modo Solo Lectura'}
                </span>
              </div>

              {/* PRIMERA FILA: Área responsable - Nombre del responsable - Responsable de apoyo - Fecha planificada */}
              <div className="grid-4-cols">
                <div className={`field ${puedeAnalizar ? 'field-manual' : 'field-auto'}`}>
                  <label>
                    Área Responsable{' '}
                    <span className={`field-badge ${(formData.fecha_plan || formData.fecha_cancelacion) ? 'manual' : 'optional'}`}>
                      {(formData.fecha_plan || formData.fecha_cancelacion) ? 'OBLIGATORIO' : 'EDITAR'}
                    </span>
                  </label>
                  <select
                    value={formData.area_responsable_id || ''}
                    onChange={handleAreaResponsableChange}
                    disabled={!puedeAnalizar}
                  >
                    <option value="">Seleccione un área...</option>
                    {areas.map((a) => (
                      <option key={a.id} value={a.id}>{a.nombre}</option>
                    ))}
                  </select>
                </div>

                <div className={`field ${puedeAnalizar && formData.area_responsable_id ? 'field-manual' : 'field-auto'}`}>
                  <label>
                    Nombre del Responsable{' '}
                    <span className={`field-badge ${(formData.fecha_plan || formData.fecha_cancelacion) ? 'manual' : 'optional'}`}>
                      {(formData.fecha_plan || formData.fecha_cancelacion) ? 'OBLIGATORIO' : 'EDITAR'}
                    </span>
                  </label>
                  <select
                    value={formData.responsable_id || ''}
                    onChange={handleResponsableChange}
                    disabled={!puedeAnalizar || !formData.area_responsable_id}
                  >
                    <option value="">
                      {!formData.area_responsable_id
                        ? 'Primero seleccione un área...'
                        : 'Seleccione responsable...'}
                    </option>
                    {/* Si ya tenía un responsable guardado que no aparece en el filtro, se conserva visible */}
                    {formData.responsable_id &&
                      formData.nombre_responsable &&
                      !empleadosPorAreaResponsable.some(e => String(e.id) === String(formData.responsable_id)) && (
                        <option value={formData.responsable_id}>{formData.nombre_responsable}</option>
                      )}
                    {empleadosPorAreaResponsable.map((emp) => (
                      <option key={emp.id} value={emp.id}>{emp.nombre}</option>
                    ))}
                  </select>
                </div>

                <div className={`field ${puedeAnalizar ? 'field-manual' : 'field-auto'}`}>
                  <label>
                    Responsable de Apoyo <span className="field-badge optional">OPCIONAL</span>
                  </label>
                  <select
                    value={formData.responsable_apoyo_id || ''}
                    onChange={handleApoyoChange}
                    disabled={!puedeAnalizar}
                  >
                    <option value="">Seleccione apoyo (opcional)...</option>
                    {empleadosActivos.map((emp) => (
                      <option key={emp.id} value={emp.id}>{emp.nombre}</option>
                    ))}
                  </select>
                </div>

                <div className={`field ${puedeAnalizar ? 'field-manual' : 'field-auto'}`}>
                  <label>
                    Fecha Planificada <span className="field-badge manual">EDITAR</span>
                  </label>
                  <input
                    type="date"
                    value={formData.fecha_plan}
                    onChange={handleFechaPlanChange}
                    disabled={!puedeAnalizar}
                  />
                </div>
              </div>

              {/* SEGUNDA FILA: Fecha de Cierre - Fecha de Cancelación - Reconocido como - Impacto */}
              <div className="grid-4-cols" style={{ marginTop: '12px' }}>
                <div className={`field ${puedeAnalizar && formData.fecha_plan ? 'field-manual' : 'field-auto'}`}>
                  <label>
                    Fecha de Cierre{' '}
                    <span className={`field-badge ${formData.fecha_plan ? 'optional' : 'auto'}`}>
                      {formData.fecha_plan ? 'CIERRE' : 'BLOQUEADO'}
                    </span>
                  </label>
                  <input
                    type="date"
                    min={minFechaCierre || undefined}
                    value={formData.fecha_cierre}
                    onChange={(e) => setFormData({ ...formData, fecha_cierre: e.target.value })}
                    disabled={!puedeAnalizar || !formData.fecha_plan}
                    title={!formData.fecha_plan ? 'Primero debe ingresar la Fecha Planificada' : 'Debe ser mayor a la Fecha Planificada'}
                  />
                </div>

                <div className={`field ${puedeAnalizar ? 'field-manual' : 'field-auto'}`}>
                  <label>
                    Fecha de Cancelación <span className="field-badge optional">CANCELAR</span>
                  </label>
                  <input
                    type="date"
                    value={formData.fecha_cancelacion}
                    onChange={handleFechaCancelacionChange}
                    disabled={!puedeAnalizar}
                  />
                </div>

                <div className={`field ${puedeAnalizar ? 'field-manual' : 'field-auto'}`}>
                  <label>
                    Reconocido como <span className="field-badge optional">OPCIONAL</span>
                  </label>
                  <select
                    value={formData.reconocido || ''}
                    onChange={(e) => setFormData({ ...formData, reconocido: e.target.value })}
                    disabled={!puedeAnalizar}
                  >
                    <option value="">Seleccione opción (opcional)...</option>
                    {RECONOCIDO_OPCIONES.map((item) => (
                      <option key={item} value={item}>{item}</option>
                    ))}
                  </select>
                </div>

                <div className={`field ${puedeAnalizar ? 'field-manual' : 'field-auto'}`}>
                  <label>
                    Impacto{' '}
                    <span className={`field-badge ${formData.fecha_plan ? 'manual' : 'optional'}`}>
                      {formData.fecha_plan ? 'OBLIGATORIO' : 'EDITAR'}
                    </span>
                  </label>
                  <select
                    value={formData.impacto || ''}
                    onChange={(e) => setFormData({ ...formData, impacto: e.target.value })}
                    disabled={!puedeAnalizar}
                  >
                    <option value="">Seleccione impacto...</option>
                    {IMPACTO_OPCIONES.map((item) => (
                      <option key={item} value={item}>{item}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* TERCERA FILA: Comentario Adicional - Motivo de Cancelación */}
              <div className="grid-2-cols" style={{ marginTop: '12px' }}>
                <div className={`field ${puedeAnalizar ? 'field-manual' : 'field-auto'}`}>
                  <label>
                    Comentario Adicional <span className="field-badge optional">OPCIONAL</span>
                  </label>
                  <input
                    type="text"
                    maxLength={120}
                    placeholder="Comentario de seguimiento o cierre (opcional)..."
                    value={formData.comentario_adicional}
                    onChange={(e) => setFormData({ ...formData, comentario_adicional: e.target.value })}
                    disabled={!puedeAnalizar}
                  />
                </div>

                <div className={`field ${puedeAnalizar && formData.fecha_cancelacion ? 'field-manual' : 'field-auto'}`}>
                  <label>
                    Motivo de Cancelación{' '}
                    <span className={`field-badge ${formData.fecha_cancelacion ? 'manual' : 'auto'}`}>
                      {formData.fecha_cancelacion ? 'OBLIGATORIO' : 'BLOQUEADO'}
                    </span>
                  </label>
                  <input
                    type="text"
                    maxLength={120}
                    placeholder={
                      formData.fecha_cancelacion
                        ? 'Escriba el motivo por el cual se cancela...'
                        : 'Seleccione primero una Fecha de Cancelación...'
                    }
                    value={formData.comentario_cancelacion}
                    onChange={(e) => setFormData({ ...formData, comentario_cancelacion: e.target.value })}
                    disabled={!puedeAnalizar || !formData.fecha_cancelacion}
                  />
                </div>
              </div>

              {/* CUARTA FILA: Plan de Acción */}
              <div style={{ marginTop: '12px' }}>
                <div className={`field ${puedeAnalizar ? 'field-manual' : 'field-auto'}`}>
                  <label>
                    Plan de Acción{' '}
                    <span className={`field-badge ${formData.fecha_plan ? 'manual' : 'optional'}`}>
                      {formData.fecha_plan ? 'OBLIGATORIO' : 'EDITAR'}
                    </span>
                  </label>
                  <textarea
                    rows="2"
                    placeholder="Describa las actividades del plan de acción..."
                    value={formData.plan_accion}
                    onChange={(e) => setFormData({ ...formData, plan_accion: e.target.value })}
                    disabled={!puedeAnalizar}
                  />
                </div>
              </div>

              {/* FILA DE CONTROL Y AUDITORÍA: Estado Calculado - Fecha/Hora Actualiza - Usuario Actualiza */}
              <div className="grid-3-cols" style={{ marginTop: '12px' }}>
                <div className="field field-auto">
                  <label>
                    Estado Calculado <span className="field-badge auto">AUTO</span>
                  </label>
                  <input
                    type="text"
                    value={estadoCalculado}
                    readOnly
                  />
                </div>

                <div className="field field-auto">
                  <label>
                    Última Actualización <span className="field-badge auto">AUTO</span>
                  </label>
                  <input
                    type="text"
                    value={
                      formData.fechahora_actualiza
                        ? String(formData.fechahora_actualiza).replace('T', ' ').slice(0, 19)
                        : '-'
                    }
                    readOnly
                  />
                </div>

                <div className="field field-auto">
                  <label>
                    Actualizado por <span className="field-badge auto">AUTO</span>
                  </label>
                  <input type="text" value={formData.usuario_actualiza || '-'} readOnly />
                </div>
              </div>
            </>
          )}

          <div className="submit-row">
            <button
              type="button"
              className="secondary-btn"
              onClick={() => navigate('/sugerencias/tracking')}
            >
              Volver al Tracking
            </button>

            {mostrarBotonGuardar && (
              <button type="submit" className="primary-btn" disabled={loading}>
                {esModoEdicion ? 'Actualizar Sugerencia' : 'Registrar Sugerencia'}
              </button>
            )}
          </div>
        </form>
      </section>
    </div>
  );
}

// Envoltorio: los estilos de este módulo solo aplican dentro de este div
export default function RegistrarSugerencias(props) {
  return (
    <div className="hco-scope hco-registrar-sugerencias">
      <RegistrarSugerenciasContenido {...props} />
    </div>
  );
}
