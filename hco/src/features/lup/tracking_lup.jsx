import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  FaEdit,
  FaPlus,
  FaSearch,
  FaUndo,
  FaChevronLeft,
  FaChevronRight,
  FaPowerOff,
  FaCheck,
  FaTimes,
  FaSave,
  FaClipboardList
} from 'react-icons/fa';
import Loading from '../../layouts/Loading';
import './tracking_lup.css';
import * as XLSX from 'xlsx';

import {
  obtenerLups,
  obtenerEmpleadosCatalogo,
  obtenerAreasCatalogo,
  crearLup,
  actualizarLup,
  cambiarOperatividadLup
} from '../../services/lupService';

const ITEMS_POR_PAGINA = 50;

const TIPOS_LUP = ['MEJORA', 'PROBLEMA', 'CONDICION BASICA'];

const IMPACTOS_LUP = [
  'CALIDAD',
  'PRODUCTIVIDAD',
  'INFORMATIVO',
  'MEDIO AMBIENTE',
  'SEGURIDAD',
  'BPE',
  '5S',
  'COMPRAS'
];

function getStoredAuthUser() {
  const raw = localStorage.getItem('authUser') || sessionStorage.getItem('authUser');
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Calcula el número de semana ISO (1 - 53) a partir de una fecha YYYY-MM-DD
 */
function calcularSemanaDesdeFecha(fechaStr) {
  if (!fechaStr) return '';
  const partes = String(fechaStr).split('-');
  if (partes.length !== 3) return '';
  const fecha = new Date(Date.UTC(Number(partes[0]), Number(partes[1]) - 1, Number(partes[2])));
  if (isNaN(fecha.getTime())) return '';

  const diaSemana = fecha.getUTCDay() || 7;
  fecha.setUTCDate(fecha.getUTCDate() + 4 - diaSemana);
  const inicioAnio = new Date(Date.UTC(fecha.getUTCFullYear(), 0, 1));
  const numeroSemana = Math.ceil((((fecha - inicioAnio) / 86400000) + 1) / 7);
  return numeroSemana;
}

/**
 * Obtiene la fecha actual en zona horaria de Lima en formato YYYY-MM-DD
 */
function obtenerFechaHoyLima() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Lima',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date());
}

/**
 * Formatea un timestamp ISO mostrando siempre la fecha y hora de Lima (UTC-5)
 */
function formatearFechaHoraLima(fechaIso) {
  if (!fechaIso) return '-';
  try {
    return new Date(fechaIso)
      .toLocaleString('es-PE', {
        timeZone: 'America/Lima',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
      })
      .replace(',', '');
  } catch {
    return String(fechaIso);
  }
}

function formatearSoloFecha(fechaStr) {
  if (!fechaStr) return '-';
  const limpia = String(fechaStr).slice(0, 10);
  const [anio, mes, dia] = limpia.split('-');
  if (!anio || !mes || !dia) return fechaStr;
  return `${dia}/${mes}/${anio}`;
}

export default function TrackingLup() {
  const [currentUser] = useState(() => getStoredAuthUser());

  const [lups, setLups] = useState([]);
  const [empleados, setEmpleados] = useState([]);
  const [areas, setAreas] = useState([]);
  const [loading, setLoading] = useState(true);

  const nombreUsuarioSesion = useMemo(() => {
    return (
      currentUser?.nombre ||
      currentUser?.username ||
      currentUser?.usuario ||
      currentUser?.email ||
      'SISTEMA'
    );
  }, [currentUser]);

  const rolUsuario = String(
    currentUser?.rol || currentUser?.role || currentUser?.roles?.nombre || ''
  ).toLowerCase().trim();

  const puedeExportar =
    rolUsuario === 'superadmin' || rolUsuario === 'supervisor' || rolUsuario === 'admin' || !rolUsuario;

  const puedeGestionar =
    rolUsuario === 'superadmin' || rolUsuario === 'supervisor' || rolUsuario === 'admin' || !rolUsuario;

  // Referencias para arrastrar tabla con el mouse
  const tableContainerRef = useRef(null);
  const [isDragging, setIsDragging] = useState(false);
  const dragData = useRef({ startX: 0, scrollLeft: 0 });

  // Estados de Filtros
  const [filtrosForm, setFiltrosForm] = useState({
    buscar: '',
    tipoLup: 'Todos',
    impacto: 'Todos',
    entrenamiento: 'Todos',
    operatividad: 'Todos',
    fechaIni: '',
    fechaFin: ''
  });

  const [filtrosActivos, setFiltrosActivos] = useState({
    buscar: '',
    tipoLup: 'Todos',
    impacto: 'Todos',
    entrenamiento: 'Todos',
    operatividad: 'Todos',
    fechaIni: '',
    fechaFin: ''
  });

  const [paginaActual, setPaginaActual] = useState(1);

  // Estados del Modal (Crear / Editar)
  const [modalOpen, setModalOpen] = useState(false);
  const [modoEdicion, setModoEdicion] = useState(false);
  const [registroSeleccionado, setRegistroSeleccionado] = useState(null);
  const [guardando, setGuardando] = useState(false);
  const [errorModal, setErrorModal] = useState('');

  const estadoInicialFormulario = {
    numero_lup: '',
    fecha_lup: obtenerFechaHoyLima(),
    semana: calcularSemanaDesdeFecha(obtenerFechaHoyLima()),
    empleado_id: '',
    colaborador: '',
    area_id: '',
    area: '',
    jefe_directo_id: '',
    jefe: '',
    rol: '',
    tipo_lup: 'MEJORA',
    impacto: 'BPE',
    area_impacto_id: '',
    area_impacto: '',
    titulo: '',
    estado: 'CONCLUIDO',
    entrenamiento: 'SIN ENTRENAR',
    fecha_entrenamiento: '',
    realizo_kaizen: 'NO',
    cod_kaizen: '',
    operatividad: 'ACTIVO',
    impacto_co2: ''
  };

  const [formData, setFormData] = useState(estadoInicialFormulario);

  useEffect(() => {
    cargarDatos();
  }, []);

  const cargarDatos = async () => {
    setLoading(true);
    try {
      const [dataLups, dataEmpleados, dataAreas] = await Promise.all([
        obtenerLups(),
        obtenerEmpleadosCatalogo(),
        obtenerAreasCatalogo()
      ]);
      setLups(dataLups || []);
      setEmpleados(dataEmpleados || []);
      setAreas(dataAreas || []);
    } catch (error) {
      console.error('Error al cargar módulo LUP:', error);
    } finally {
      setLoading(false);
    }
  };

  // Mapas rápidos para cruce de Empleados, Jefes y Áreas
  const mapaEmpleadosPorId = useMemo(() => {
    const mapa = {};
    empleados.forEach((emp) => {
      if (emp.id) mapa[String(emp.id)] = emp;
    });
    return mapa;
  }, [empleados]);

  const mapaAreasPorId = useMemo(() => {
    const mapa = {};
    areas.forEach((ar) => {
      if (ar.id !== undefined && ar.id !== null) {
        mapa[String(ar.id)] = ar.nombre;
      }
    });
    return mapa;
  }, [areas]);

  // Sugeridor de correlativo N° LUP (Ej: LUP-0001)
  const generarSiguienteNumeroLup = () => {
    if (lups.length === 0) return 'LUP-0001';
    const numeros = lups
      .map((l) => {
        const match = String(l.numero_lup || '').match(/(\d+)/g);
        return match ? parseInt(match[match.length - 1], 10) : 0;
      })
      .filter((n) => !isNaN(n));
    const maxNum = numeros.length > 0 ? Math.max(...numeros) : lups.length;
    return `LUP-${String(maxNum + 1).padStart(4, '0')}`;
  };

  // Normaliza operatividad
  const esLupActiva = (reg) => {
    if (!reg.operatividad) return true;
    return String(reg.operatividad).toUpperCase().trim() === 'ACTIVO';
  };

  // Arrastre de tabla con el mouse
  const handleMouseDown = (e) => {
    if (e.target.closest('button')) return;
    const container = tableContainerRef.current;
    if (!container) return;

    setIsDragging(true);
    dragData.current.startX = e.pageX - container.offsetLeft;
    dragData.current.scrollLeft = container.scrollLeft;
  };

  const handleMouseUpOrLeave = () => {
    setIsDragging(false);
  };

  const handleMouseMove = (e) => {
    if (!isDragging) return;
    e.preventDefault();
    const container = tableContainerRef.current;
    if (!container) return;

    const x = e.pageX - container.offsetLeft;
    const walk = (x - dragData.current.startX) * 1.4;
    container.scrollLeft = dragData.current.scrollLeft - walk;
  };

  // Contadores KPI
  const totalLupCount = lups.length;

  const entrenadosCount = useMemo(() => {
    return lups.filter((l) => String(l.entrenamiento).toUpperCase() === 'ENTRENADO').length;
  }, [lups]);

  const activosCount = useMemo(() => {
    return lups.filter((l) => esLupActiva(l)).length;
  }, [lups]);

  const inactivosCount = useMemo(() => {
    return lups.filter((l) => !esLupActiva(l)).length;
  }, [lups]);

  // Filtrado de registros
  const registrosFiltrados = useMemo(() => {
    return lups.filter((reg) => {
      const operatividadTexto = esLupActiva(reg) ? 'ACTIVO' : 'INACTIVO';

      if (filtrosActivos.tipoLup !== 'Todos' && reg.tipo_lup !== filtrosActivos.tipoLup) {
        return false;
      }

      if (filtrosActivos.impacto !== 'Todos' && reg.impacto !== filtrosActivos.impacto) {
        return false;
      }

      if (filtrosActivos.entrenamiento !== 'Todos' && reg.entrenamiento !== filtrosActivos.entrenamiento) {
        return false;
      }

      if (filtrosActivos.operatividad !== 'Todos' && operatividadTexto !== filtrosActivos.operatividad) {
        return false;
      }

      if (filtrosActivos.fechaIni && reg.fecha_lup) {
        const fechaIso = String(reg.fecha_lup).slice(0, 10);
        if (fechaIso < filtrosActivos.fechaIni) return false;
      }

      if (filtrosActivos.fechaFin && reg.fecha_lup) {
        const fechaIso = String(reg.fecha_lup).slice(0, 10);
        if (fechaIso > filtrosActivos.fechaFin) return false;
      }

      if (filtrosActivos.buscar.trim() !== '') {
        const q = filtrosActivos.buscar.toLowerCase().trim();
        const textoFila = [
          reg.numero_lup,
          reg.colaborador,
          reg.area,
          reg.jefe,
          reg.rol,
          reg.tipo_lup,
          reg.impacto,
          reg.area_impacto,
          reg.titulo,
          reg.cod_kaizen,
          reg.impacto_co2,
          reg.usuario_registra,
          reg.usuario_actualiza
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();

        if (!textoFila.includes(q)) return false;
      }

      return true;
    });
  }, [lups, filtrosActivos]);

  // Paginación
  const totalPaginas = Math.max(1, Math.ceil(registrosFiltrados.length / ITEMS_POR_PAGINA));
  const indiceInicio = (paginaActual - 1) * ITEMS_POR_PAGINA;
  const registrosPaginados = registrosFiltrados.slice(
    indiceInicio,
    indiceInicio + ITEMS_POR_PAGINA
  );

  const handleAplicarFiltros = () => {
    setFiltrosActivos({ ...filtrosForm });
    setPaginaActual(1);
  };

  const handleLimpiarFiltros = () => {
    const inicial = {
      buscar: '',
      tipoLup: 'Todos',
      impacto: 'Todos',
      entrenamiento: 'Todos',
      operatividad: 'Todos',
      fechaIni: '',
      fechaFin: ''
    };
    setFiltrosForm(inicial);
    setFiltrosActivos(inicial);
    setPaginaActual(1);
  };

  // =========================================
  // HANDLERS DE AUTOCOMPLETADO EN EL MODAL
  // =========================================
  const handleChangeFechaLup = (nuevaFecha) => {
    const semanaCalculada = calcularSemanaDesdeFecha(nuevaFecha);
    setFormData((prev) => ({
      ...prev,
      fecha_lup: nuevaFecha,
      semana: semanaCalculada
    }));
  };

  const handleChangeColaborador = (empleadoId) => {
    const emp = mapaEmpleadosPorId[String(empleadoId)];
    if (!emp) {
      setFormData((prev) => ({
        ...prev,
        empleado_id: '',
        colaborador: '',
        area_id: '',
        area: '',
        jefe_directo_id: '',
        jefe: '',
        rol: ''
      }));
      return;
    }

    const nombreArea = emp.area_id ? (mapaAreasPorId[String(emp.area_id)] || '') : '';
    const empJefe = emp.jefe_directo_id ? mapaEmpleadosPorId[String(emp.jefe_directo_id)] : null;
    const nombreJefe = empJefe?.nombre || 'SIN JEFE ASIGNADO';
    const rolColaborador = emp.tipo || emp.rol || '';

    setFormData((prev) => ({
      ...prev,
      empleado_id: emp.id,
      colaborador: emp.nombre || '',
      area_id: emp.area_id ?? '',
      area: nombreArea,
      jefe_directo_id: emp.jefe_directo_id || '',
      jefe: nombreJefe,
      rol: rolColaborador
    }));
  };

  const handleChangeAreaImpacto = (areaNombre) => {
    const areaObj = areas.find((a) => a.nombre === areaNombre);
    setFormData((prev) => ({
      ...prev,
      area_impacto: areaNombre,
      area_impacto_id: areaObj ? areaObj.id : null
    }));
  };

  // =========================================
  // LÓGICA DEL MODAL (CREAR Y EDITAR)
  // =========================================
  const handleAbrirModalCrear = () => {
    const hoyLima = obtenerFechaHoyLima();
    setModoEdicion(false);
    setRegistroSeleccionado(null);
    setErrorModal('');
    setFormData({
      ...estadoInicialFormulario,
      numero_lup: generarSiguienteNumeroLup(),
      fecha_lup: hoyLima,
      semana: calcularSemanaDesdeFecha(hoyLima),
      area_impacto: areas.length > 0 ? areas[0].nombre : '',
      area_impacto_id: areas.length > 0 ? areas[0].id : null
    });
    setModalOpen(true);
  };

  const handleAbrirModalEditar = (reg) => {
    setModoEdicion(true);
    setRegistroSeleccionado(reg);
    setErrorModal('');
    setFormData({
      numero_lup: reg.numero_lup || '',
      fecha_lup: reg.fecha_lup ? String(reg.fecha_lup).slice(0, 10) : obtenerFechaHoyLima(),
      semana: reg.semana || calcularSemanaDesdeFecha(reg.fecha_lup),
      empleado_id: reg.empleado_id || '',
      colaborador: reg.colaborador || '',
      area_id: reg.area_id ?? '',
      area: reg.area || '',
      jefe_directo_id: reg.jefe_directo_id || '',
      jefe: reg.jefe || '',
      rol: reg.rol || '',
      tipo_lup: reg.tipo_lup || 'MEJORA',
      impacto: reg.impacto || 'BPE',
      area_impacto_id: reg.area_impacto_id ?? '',
      area_impacto: reg.area_impacto || '',
      titulo: reg.titulo || '',
      estado: 'CONCLUIDO',
      entrenamiento: reg.entrenamiento || 'SIN ENTRENAR',
      fecha_entrenamiento: reg.fecha_entrenamiento ? String(reg.fecha_entrenamiento).slice(0, 10) : '',
      realizo_kaizen: reg.realizo_kaizen || 'NO',
      cod_kaizen: reg.cod_kaizen || '',
      operatividad: reg.operatividad || 'ACTIVO',
      impacto_co2: reg.impacto_co2 || ''
    });
    setModalOpen(true);
  };

  const handleCerrarModal = () => {
    if (guardando) return;
    setModalOpen(false);
    setRegistroSeleccionado(null);
    setErrorModal('');
  };

  const handleGuardarLup = async (e) => {
    e.preventDefault();
    setErrorModal('');

    const numLupLimpio = String(formData.numero_lup || '').trim().toUpperCase();
    const tituloLimpio = String(formData.titulo || '').trim().toUpperCase();
    const codKaizenLimpio = String(formData.cod_kaizen || '').trim().toUpperCase();
    const impactoCo2Limpio = String(formData.impacto_co2 || '').trim();

    if (!numLupLimpio) {
      return setErrorModal('El N° de LUP es obligatorio.');
    }
    if (!formData.fecha_lup) {
      return setErrorModal('Debe seleccionar la fecha de la LUP.');
    }
    if (!formData.colaborador) {
      return setErrorModal('Debe seleccionar un colaborador.');
    }
    if (!formData.area_impacto) {
      return setErrorModal('Debe seleccionar el área de impacto.');
    }
    if (!tituloLimpio) {
      return setErrorModal('El título de la LUP es obligatorio.');
    }
    if (formData.entrenamiento === 'ENTRENADO' && !formData.fecha_entrenamiento) {
      return setErrorModal('La fecha de entrenamiento es obligatoria cuando el estado es ENTRENADO.');
    }
    if (formData.realizo_kaizen === 'SI' && !codKaizenLimpio) {
      return setErrorModal('El código de Kaizen es obligatorio cuando indicó que SÍ realizó Kaizen.');
    }

    setGuardando(true);
    const ahoraIso = new Date().toISOString();

    const payloadBase = {
      numero_lup: numLupLimpio,
      fecha_lup: formData.fecha_lup,
      semana: Number(formData.semana) || calcularSemanaDesdeFecha(formData.fecha_lup),
      empleado_id: formData.empleado_id || null,
      colaborador: formData.colaborador,
      area_id: formData.area_id ? Number(formData.area_id) : null,
      area: formData.area || 'SIN ÁREA',
      jefe_directo_id: formData.jefe_directo_id || null,
      jefe: formData.jefe || null,
      rol: formData.rol || null,
      tipo_lup: formData.tipo_lup,
      impacto: formData.impacto,
      area_impacto_id: formData.area_impacto_id ? Number(formData.area_impacto_id) : null,
      area_impacto: formData.area_impacto,
      titulo: tituloLimpio,
      estado: 'CONCLUIDO',
      entrenamiento: formData.entrenamiento,
      fecha_entrenamiento:
        formData.entrenamiento === 'ENTRENADO' ? formData.fecha_entrenamiento : null,
      realizo_kaizen: formData.realizo_kaizen,
      cod_kaizen: formData.realizo_kaizen === 'SI' ? codKaizenLimpio : null,
      operatividad: formData.operatividad || 'ACTIVO',
      impacto_co2: impactoCo2Limpio || null
    };

    try {
      if (modoEdicion && registroSeleccionado) {
        const payloadActualizar = {
          ...payloadBase,
          usuario_actualiza: nombreUsuarioSesion,
          fecha_actualiza: ahoraIso
        };
        await actualizarLup(registroSeleccionado.id, payloadActualizar);
      } else {
        const payloadCrear = {
          ...payloadBase,
          fecha_registro: ahoraIso,
          usuario_registra: nombreUsuarioSesion,
          usuario_actualiza: null,
          fecha_actualiza: null
        };
        await crearLup(payloadCrear);
      }

      await cargarDatos();
      setModalOpen(false);
    } catch (error) {
      console.error('Error al guardar LUP:', error);
      setErrorModal(error?.message || 'Ocurrió un error al guardar el registro de LUP.');
    } finally {
      setGuardando(false);
    }
  };

  // =========================================
  // ACTIVAR / DESACTIVAR OPERATIVIDAD LUP
  // =========================================
  const handleToggleOperatividad = async (reg) => {
    if (!puedeGestionar) {
      return alert('No tienes permisos para cambiar la operatividad de la LUP.');
    }

    const actualmenteActivo = esLupActiva(reg);
    const nuevaOperatividad = actualmenteActivo ? 'INACTIVO' : 'ACTIVO';
    const accionTexto = actualmenteActivo ? 'inactivar' : 'activar';

    const confirmar = window.confirm(
      `¿Está seguro que desea ${accionTexto} la LUP "${reg.numero_lup}" (${reg.titulo})?`
    );
    if (!confirmar) return;

    const ahoraIso = new Date().toISOString();

    try {
      setLoading(true);
      await cambiarOperatividadLup(reg.id, {
        operatividad: nuevaOperatividad,
        usuario_actualiza: nombreUsuarioSesion,
        fecha_actualiza: ahoraIso
      });
      await cargarDatos();
    } catch (error) {
      console.error('Error al cambiar operatividad de LUP:', error);
      alert('No se pudo actualizar la operatividad de la LUP.');
    } finally {
      setLoading(false);
    }
  };

  // =========================================
  // EXPORTAR A EXCEL
  // =========================================
  const handleExportarExcel = () => {
    if (!puedeExportar) {
      return alert('No tienes permisos para exportar.');
    }

    if (registrosFiltrados.length === 0) {
      return alert('No hay registros para exportar.');
    }

    const datosExcel = registrosFiltrados.map((reg, idx) => ({
      'Item': idx + 1,
      'N° LUP': reg.numero_lup || '-',
      'Fecha Registro (Lima)': formatearFechaHoraLima(reg.fecha_registro),
      'Fecha LUP': formatearSoloFecha(reg.fecha_lup),
      'Semana': reg.semana ?? '-',
      'Colaborador': reg.colaborador || '-',
      'Área Colaborador': reg.area || '-',
      'Jefe Directo': reg.jefe || '-',
      'Rol': reg.rol || '-',
      'Tipo LUP': reg.tipo_lup || '-',
      'Impacto': reg.impacto || '-',
      'Área Impacto': reg.area_impacto || '-',
      'Título': reg.titulo || '-',
      'Estado': reg.estado || 'CONCLUIDO',
      'Entrenamiento': reg.entrenamiento || '-',
      'Fecha Entrenamiento': formatearSoloFecha(reg.fecha_entrenamiento),
      'Realizó Kaizen': reg.realizo_kaizen || 'NO',
      'Cód. Kaizen': reg.cod_kaizen || '-',
      'Operatividad': reg.operatividad || 'ACTIVO',
      'Impacto CO2': reg.impacto_co2 || '-',
      'Usuario Actualiza': reg.usuario_actualiza || '-',
      'Fecha Actualiza': formatearFechaHoraLima(reg.fecha_actualiza)
    }));

    const worksheet = XLSX.utils.json_to_sheet(datosExcel);
    worksheet['!cols'] = [
      { wch: 6 },  // Item
      { wch: 14 }, // N° LUP
      { wch: 18 }, // Fecha Registro
      { wch: 12 }, // Fecha LUP
      { wch: 9 },  // Semana
      { wch: 32 }, // Colaborador
      { wch: 20 }, // Área
      { wch: 30 }, // Jefe
      { wch: 16 }, // Rol
      { wch: 18 }, // Tipo LUP
      { wch: 18 }, // Impacto
      { wch: 20 }, // Área Impacto
      { wch: 42 }, // Título
      { wch: 14 }, // Estado
      { wch: 16 }, // Entrenamiento
      { wch: 16 }, // Fecha Entrenamiento
      { wch: 14 }, // Realizó Kaizen
      { wch: 16 }, // Cód. Kaizen
      { wch: 14 }, // Operatividad
      { wch: 22 }, // Impacto CO2
      { wch: 22 }, // Usuario Actualiza
      { wch: 18 }  // Fecha Actualiza
    ];

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Tracking_LUP');

    const fechaHoy = obtenerFechaHoyLima();
    XLSX.writeFile(workbook, `Tracking_LUP_${fechaHoy}.xlsx`);
  };

  return (
    <div className="tracking-lup-page">
      {loading && <Loading />}

      {/* 1. SECCIÓN SUPERIOR: TÍTULO + TARJETAS KPI */}
      <div className="top-summary-grid">
        <section className="hero-card">
          <span className="module-pill">MEJORA CONTINUA / BPE</span>
          <h1>Tracking de LUP (Lección de Un Punto)</h1>
          <p>
            Gestione el registro de LUPs, entrenamientos, vinculación con Kaizen, impacto de CO2 y trazabilidad por área.
          </p>
        </section>

        <section className="kpi-container-card">
          <div className="kpi-blue-box">
            <span className="kpi-box-title">TOTAL LUP</span>
            <strong className="kpi-box-value">{totalLupCount}</strong>
          </div>
          <div className="kpi-blue-box">
            <span className="kpi-box-title">ENTRENADOS</span>
            <strong className="kpi-box-value">{entrenadosCount}</strong>
          </div>
          <div className="kpi-blue-box">
            <span className="kpi-box-title">ACTIVOS</span>
            <strong className="kpi-box-value">{activosCount}</strong>
          </div>
          <div className="kpi-blue-box">
            <span className="kpi-box-title">INACTIVOS</span>
            <strong className="kpi-box-value">{inactivosCount}</strong>
          </div>
        </section>
      </div>

      {/* 2. SECCIÓN MEDIA: FILTROS Y BOTONES */}
      <section className="filters-card">
        <div className="filters-grid">
          <div className="filter-group filter-buscar">
            <label>Buscar</label>
            <input
              type="text"
              placeholder="Buscar por N° LUP, colaborador, título, jefe, código Kaizen..."
              value={filtrosForm.buscar}
              onChange={(e) => setFiltrosForm({ ...filtrosForm, buscar: e.target.value })}
              onKeyDown={(e) => e.key === 'Enter' && handleAplicarFiltros()}
            />
          </div>

          <div className="filter-group">
            <label>Tipo LUP</label>
            <select
              value={filtrosForm.tipoLup}
              onChange={(e) => setFiltrosForm({ ...filtrosForm, tipoLup: e.target.value })}
            >
              <option value="Todos">Todos</option>
              {TIPOS_LUP.map((tipo) => (
                <option key={tipo} value={tipo}>{tipo}</option>
              ))}
            </select>
          </div>

          <div className="filter-group">
            <label>Impacto</label>
            <select
              value={filtrosForm.impacto}
              onChange={(e) => setFiltrosForm({ ...filtrosForm, impacto: e.target.value })}
            >
              <option value="Todos">Todos</option>
              {IMPACTOS_LUP.map((imp) => (
                <option key={imp} value={imp}>{imp}</option>
              ))}
            </select>
          </div>

          <div className="filter-group">
            <label>Entrenamiento</label>
            <select
              value={filtrosForm.entrenamiento}
              onChange={(e) => setFiltrosForm({ ...filtrosForm, entrenamiento: e.target.value })}
            >
              <option value="Todos">Todos</option>
              <option value="ENTRENADO">ENTRENADO</option>
              <option value="SIN ENTRENAR">SIN ENTRENAR</option>
            </select>
          </div>

          <div className="filter-group">
            <label>Operatividad</label>
            <select
              value={filtrosForm.operatividad}
              onChange={(e) => setFiltrosForm({ ...filtrosForm, operatividad: e.target.value })}
            >
              <option value="Todos">Todos</option>
              <option value="ACTIVO">ACTIVO</option>
              <option value="INACTIVO">INACTIVO</option>
            </select>
          </div>

          <div className="filter-group mobile-hidden-filter">
            <label>Fecha LUP Ini</label>
            <input
              type="date"
              value={filtrosForm.fechaIni}
              onChange={(e) => setFiltrosForm({ ...filtrosForm, fechaIni: e.target.value })}
            />
          </div>

          <div className="filter-group mobile-hidden-filter">
            <label>Fecha LUP Fin</label>
            <input
              type="date"
              value={filtrosForm.fechaFin}
              onChange={(e) => setFiltrosForm({ ...filtrosForm, fechaFin: e.target.value })}
            />
          </div>
        </div>

        <div className="filters-actions-row">
          <button
            type="button"
            className="btn-action-primary"
            onClick={handleAbrirModalCrear}
          >
            <FaPlus />
            <span>Registrar LUP</span>
          </button>

          <button
            type="button"
            className="btn-action-primary"
            onClick={handleAplicarFiltros}
          >
            <FaSearch />
            <span>Buscar</span>
          </button>

          <button
            type="button"
            className="btn-action-secondary"
            onClick={handleLimpiarFiltros}
          >
            <FaUndo />
            <span>Limpiar</span>
          </button>
        </div>
      </section>

      {/* 3. SECCIÓN INFERIOR: TABLA Y PAGINACIÓN */}
      <section className="table-section-card">
        <div className="table-topbar">
          <span className="records-counter">
            Mostrando <strong>{registrosPaginados.length}</strong> registros de <strong>{registrosFiltrados.length}</strong>
          </span>

          <div className="pagination-controls">
            <button
              type="button"
              className="page-nav-btn"
              disabled={paginaActual <= 1}
              onClick={() => setPaginaActual((prev) => Math.max(1, prev - 1))}
            >
              <FaChevronLeft className="nav-chevron" />
              <span>Anterior</span>
            </button>

            <span className="pagination-text-indicator">
              Página {paginaActual} de {totalPaginas}
            </span>

            <button
              type="button"
              className="page-nav-btn"
              disabled={paginaActual >= totalPaginas}
              onClick={() => setPaginaActual((prev) => Math.min(totalPaginas, prev + 1))}
            >
              <span>Siguiente</span>
              <FaChevronRight className="nav-chevron" />
            </button>
          </div>

          <button
            type="button"
            className="btn-exportar-excel"
            onClick={handleExportarExcel}
            disabled={!puedeExportar}
            title={puedeExportar ? 'Exportar a Excel (.xlsx)' : 'Sin permisos para exportar'}
          >
            <span className="excel-icon-box">X</span>
            <span>Exportar</span>
          </button>
        </div>

        <div
          ref={tableContainerRef}
          className={`table-container ${isDragging ? 'dragging' : ''}`}
          onMouseDown={handleMouseDown}
          onMouseLeave={handleMouseUpOrLeave}
          onMouseUp={handleMouseUpOrLeave}
          onMouseMove={handleMouseMove}
        >
          <table>
            <thead>
              <tr>
                <th>N° LUP</th>
                <th>Fecha Registro</th>
                <th>Fecha LUP</th>
                <th>Sem.</th>
                <th>Colaborador</th>
                <th>Área</th>
                <th>Jefe</th>
                <th>Rol</th>
                <th>Tipo LUP</th>
                <th>Impacto</th>
                <th>Área Impacto</th>
                <th>Título</th>
                <th>Estado</th>
                <th>Entrenamiento</th>
                <th>F. Entrenamiento</th>
                <th>¿Kaizen?</th>
                <th>Cód. Kaizen</th>
                <th>Operatividad</th>
                <th>Impacto CO2</th>
                <th>Usuario Actualiza</th>
                <th>Fecha Actualiza</th>
                <th style={{ textAlign: 'center' }}>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {registrosPaginados.length === 0 ? (
                <tr>
                  <td colSpan="22" style={{ textAlign: 'center', padding: '28px', color: '#64748b' }}>
                    No se encontraron registros de LUP con los filtros seleccionados.
                  </td>
                </tr>
              ) : (
                registrosPaginados.map((reg, index) => {
                  const activa = esLupActiva(reg);
                  const entrenado = String(reg.entrenamiento).toUpperCase() === 'ENTRENADO';

                  return (
                    <tr key={reg.id || reg.numero_lup || index}>
                      <td style={{ fontWeight: '800', color: '#0f4c81' }}>{reg.numero_lup || '-'}</td>
                      <td>{formatearFechaHoraLima(reg.fecha_registro)}</td>
                      <td style={{ fontWeight: '700' }}>{formatearSoloFecha(reg.fecha_lup)}</td>
                      <td>
                        <span className="semana-pill">S{reg.semana ?? '-'}</span>
                      </td>
                      <td style={{ fontWeight: '700', textAlign: 'left' }}>{reg.colaborador || '-'}</td>
                      <td>
                        <span className="empresa-tag">{reg.area || '-'}</span>
                      </td>
                      <td style={{ textAlign: 'left' }}>{reg.jefe || '-'}</td>
                      <td>{reg.rol || '-'}</td>
                      <td>
                        <span className={`badge-tipo-lup tipo-${String(reg.tipo_lup || '').toLowerCase().replace(/\s+/g, '-')}`}>
                          {reg.tipo_lup || '-'}
                        </span>
                      </td>
                      <td>
                        <span className="empresa-tag">{reg.impacto || '-'}</span>
                      </td>
                      <td>{reg.area_impacto || '-'}</td>
                      <td style={{ textAlign: 'left', maxWidth: '260px', overflow: 'hidden', textOverflow: 'ellipsis' }} title={reg.titulo}>
                        <strong>{reg.titulo || '-'}</strong>
                      </td>
                      <td>
                        <span className="badge-concluido">{reg.estado || 'CONCLUIDO'}</span>
                      </td>
                      <td>
                        <span className={`badge-entrenamiento ${entrenado ? 'es-entrenado' : 'sin-entrenar'}`}>
                          {reg.entrenamiento || 'SIN ENTRENAR'}
                        </span>
                      </td>
                      <td>{formatearSoloFecha(reg.fecha_entrenamiento)}</td>
                      <td style={{ fontWeight: '700' }}>{reg.realizo_kaizen || 'NO'}</td>
                      <td style={{ fontWeight: '700', color: '#0f4c81' }}>{reg.cod_kaizen || '-'}</td>
                      <td>
                        <span className={`badge-estado ${activa ? 'tc-estado-activo' : 'tc-estado-inactivo'}`}>
                          {activa ? 'ACTIVO' : 'INACTIVO'}
                        </span>
                      </td>
                      <td>{reg.impacto_co2 || '-'}</td>
                      <td>{reg.usuario_actualiza || '-'}</td>
                      <td>{formatearFechaHoraLima(reg.fecha_actualiza)}</td>
                      <td style={{ textAlign: 'center' }}>
                        <div className="acciones-cell">
                          <button
                            type="button"
                            className={`btn-tabla-editar ${!puedeGestionar ? 'disabled-by-role' : ''}`}
                            onClick={() => {
                              if (!puedeGestionar) {
                                return alert('No tienes permisos para editar LUPs.');
                              }
                              handleAbrirModalEditar(reg);
                            }}
                            title="Editar LUP"
                          >
                            <FaEdit />
                          </button>

                          <button
                            type="button"
                            className={`btn-tabla-toggle ${activa ? 'is-active' : 'is-inactive'} ${!puedeGestionar ? 'disabled-by-role' : ''}`}
                            onClick={() => handleToggleOperatividad(reg)}
                            title={activa ? 'Cambiar a Inactivo' : 'Cambiar a Activo'}
                          >
                            {activa ? <FaPowerOff /> : <FaCheck />}
                            <span className="btn-toggle-label">
                              {activa ? 'Inactivar' : 'Activar'}
                            </span>
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* 4. MODAL DE REGISTRO Y EDICIÓN DE LUP */}
      {modalOpen && (
        <div className="tc-modal-overlay" onClick={handleCerrarModal}>
          <div className="tc-modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="tc-modal-header">
              <div className="tc-modal-title-group">
                <span className="tc-modal-icon">
                  <FaClipboardList />
                </span>
                <div>
                  <h2>{modoEdicion ? 'Editar Registro LUP' : 'Registrar Nueva LUP'}</h2>
                  <p>
                    {modoEdicion
                      ? `Actualizando datos de la ${registroSeleccionado?.numero_lup || ''}`
                      : 'Complete los datos de la Lección de Un Punto. Los campos del colaborador se autocompletan.'}
                  </p>
                </div>
              </div>
              <button
                type="button"
                className="tc-modal-close"
                onClick={handleCerrarModal}
                title="Cerrar"
              >
                <FaTimes />
              </button>
            </div>

            <form onSubmit={handleGuardarLup} className="tc-modal-form">
              <div className="tc-modal-body">
                {errorModal && (
                  <div className="tc-modal-error">
                    {errorModal}
                  </div>
                )}

                <div className="lup-form-grid">
                  {/* N° LUP */}
                  <div className="tc-form-group">
                    <label>N° LUP <span className="req">*</span></label>
                    <input
                      type="text"
                      placeholder="Ej: LUP-0001"
                      value={formData.numero_lup}
                      onChange={(e) => setFormData({ ...formData, numero_lup: e.target.value.toUpperCase() })}
                      required
                    />
                  </div>

                  {/* Fecha LUP */}
                  <div className="tc-form-group">
                    <label>Fecha LUP <span className="req">*</span></label>
                    <input
                      type="date"
                      value={formData.fecha_lup}
                      onChange={(e) => handleChangeFechaLup(e.target.value)}
                      required
                    />
                  </div>

                  {/* Semana (Automático desde fecha_lup) */}
                  <div className="tc-form-group">
                    <label>Semana (Automático)</label>
                    <input
                      type="text"
                      value={formData.semana ? `Semana ${formData.semana}` : ''}
                      readOnly
                      className="input-readonly"
                    />
                  </div>

                  {/* Colaborador (Select desde tabla empleados) */}
                  <div className="tc-form-group span-2">
                    <label>Colaborador <span className="req">*</span></label>
                    <select
                      value={formData.empleado_id}
                      onChange={(e) => handleChangeColaborador(e.target.value)}
                      required
                    >
                      <option value="">-- Seleccione un colaborador --</option>
                      {empleados.map((emp) => (
                        <option key={emp.id} value={emp.id}>
                          {emp.nombre} {emp.dni ? `(${emp.dni})` : ''}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Rol del Colaborador (Automático desde empleados.tipo) */}
                  <div className="tc-form-group">
                    <label>Rol (empleados.tipo)</label>
                    <input
                      type="text"
                      value={formData.rol}
                      placeholder="Se jala del colaborador"
                      readOnly
                      className="input-readonly"
                    />
                  </div>

                  {/* Área del Colaborador (Automático desde areas.nombre) */}
                  <div className="tc-form-group">
                    <label>Área del Colaborador</label>
                    <input
                      type="text"
                      value={formData.area}
                      placeholder="Se jala del colaborador"
                      readOnly
                      className="input-readonly"
                    />
                  </div>

                  {/* Jefe Directo (Automático desde empleados.jefe_directo_id) */}
                  <div className="tc-form-group span-2">
                    <label>Jefe Directo</label>
                    <input
                      type="text"
                      value={formData.jefe}
                      placeholder="Se jala automáticamente según el colaborador"
                      readOnly
                      className="input-readonly"
                    />
                  </div>

                  {/* Tipo de LUP */}
                  <div className="tc-form-group">
                    <label>Tipo LUP <span className="req">*</span></label>
                    <select
                      value={formData.tipo_lup}
                      onChange={(e) => setFormData({ ...formData, tipo_lup: e.target.value })}
                      required
                    >
                      {TIPOS_LUP.map((t) => (
                        <option key={t} value={t}>{t}</option>
                      ))}
                    </select>
                  </div>

                  {/* Impacto */}
                  <div className="tc-form-group">
                    <label>Impacto <span className="req">*</span></label>
                    <select
                      value={formData.impacto}
                      onChange={(e) => setFormData({ ...formData, impacto: e.target.value })}
                      required
                    >
                      {IMPACTOS_LUP.map((imp) => (
                        <option key={imp} value={imp}>{imp}</option>
                      ))}
                    </select>
                  </div>

                  {/* Área de Impacto */}
                  <div className="tc-form-group">
                    <label>Área de Impacto <span className="req">*</span></label>
                    <select
                      value={formData.area_impacto}
                      onChange={(e) => handleChangeAreaImpacto(e.target.value)}
                      required
                    >
                      <option value="">-- Seleccione área --</option>
                      {areas.map((ar) => (
                        <option key={ar.id} value={ar.nombre}>
                          {ar.nombre}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Título de la LUP */}
                  <div className="tc-form-group span-3">
                    <label>Título de la LUP <span className="req">*</span></label>
                    <input
                      type="text"
                      placeholder="Ej: ESTANDARIZACIÓN DE ETIQUETADO EN RECEPCIÓN"
                      value={formData.titulo}
                      onChange={(e) => setFormData({ ...formData, titulo: e.target.value.toUpperCase() })}
                      required
                    />
                  </div>

                  {/* Estado (Automático CONCLUIDO) */}
                  <div className="tc-form-group">
                    <label>Estado (Automático)</label>
                    <input
                      type="text"
                      value="CONCLUIDO"
                      readOnly
                      className="input-readonly"
                    />
                  </div>

                  {/* Entrenamiento */}
                  <div className="tc-form-group">
                    <label>Entrenamiento <span className="req">*</span></label>
                    <select
                      value={formData.entrenamiento}
                      onChange={(e) => {
                        const val = e.target.value;
                        setFormData((prev) => ({
                          ...prev,
                          entrenamiento: val,
                          fecha_entrenamiento: val === 'ENTRENADO' ? (prev.fecha_entrenamiento || obtenerFechaHoyLima()) : ''
                        }));
                      }}
                    >
                      <option value="SIN ENTRENAR">SIN ENTRENAR</option>
                      <option value="ENTRENADO">ENTRENADO</option>
                    </select>
                  </div>

                  {/* Fecha Entrenamiento (Obligatoria si es ENTRENADO) */}
                  <div className="tc-form-group">
                    <label>
                      Fecha Entrenamiento{' '}
                      {formData.entrenamiento === 'ENTRENADO' && <span className="req">*</span>}
                    </label>
                    <input
                      type="date"
                      value={formData.fecha_entrenamiento}
                      onChange={(e) => setFormData({ ...formData, fecha_entrenamiento: e.target.value })}
                      disabled={formData.entrenamiento !== 'ENTRENADO'}
                      required={formData.entrenamiento === 'ENTRENADO'}
                    />
                  </div>

                  {/* ¿Realizó Kaizen? */}
                  <div className="tc-form-group">
                    <label>¿Realizó Kaizen? <span className="req">*</span></label>
                    <select
                      value={formData.realizo_kaizen}
                      onChange={(e) => {
                        const val = e.target.value;
                        setFormData((prev) => ({
                          ...prev,
                          realizo_kaizen: val,
                          cod_kaizen: val === 'SI' ? prev.cod_kaizen : ''
                        }));
                      }}
                    >
                      <option value="NO">NO</option>
                      <option value="SI">SI</option>
                    </select>
                  </div>

                  {/* Código Kaizen (Obligatorio si realizó Kaizen = SI) */}
                  <div className="tc-form-group">
                    <label>
                      Código Kaizen{' '}
                      {formData.realizo_kaizen === 'SI' && <span className="req">*</span>}
                    </label>
                    <input
                      type="text"
                      placeholder={formData.realizo_kaizen === 'SI' ? 'Ej: KZ-2026-014' : 'No aplica'}
                      value={formData.cod_kaizen}
                      onChange={(e) => setFormData({ ...formData, cod_kaizen: e.target.value.toUpperCase() })}
                      disabled={formData.realizo_kaizen !== 'SI'}
                      required={formData.realizo_kaizen === 'SI'}
                    />
                  </div>

                  {/* Operatividad */}
                  <div className="tc-form-group">
                    <label>Operatividad <span className="req">*</span></label>
                    <select
                      value={formData.operatividad}
                      onChange={(e) => setFormData({ ...formData, operatividad: e.target.value })}
                    >
                      <option value="ACTIVO">ACTIVO</option>
                      <option value="INACTIVO">INACTIVO</option>
                    </select>
                  </div>

                  {/* Impacto CO2 */}
                  <div className="tc-form-group span-3">
                    <label>Impacto CO2</label>
                    <input
                      type="text"
                      placeholder="Detalle el impacto CO2 o escriba N/A..."
                      value={formData.impacto_co2}
                      onChange={(e) => setFormData({ ...formData, impacto_co2: e.target.value })}
                    />
                  </div>
                </div>

                {/* Resumen de Auditoría Automática (Hora Lima) */}
                <div className="tc-audit-info">
                  {modoEdicion ? (
                    <>
                      <div>
                        <span>Fecha Registro (Hora Lima):</span>{' '}
                        <strong>{formatearFechaHoraLima(registroSeleccionado?.fecha_registro)}</strong>
                      </div>
                      <div>
                        <span>Se actualizará por:</span>{' '}
                        <strong>{nombreUsuarioSesion}</strong>
                      </div>
                    </>
                  ) : (
                    <div>
                      <span>Usuario que registra (Hora Lima):</span>{' '}
                      <strong>{nombreUsuarioSesion}</strong>
                    </div>
                  )}
                </div>
              </div>

              <div className="tc-modal-footer">
                <button
                  type="button"
                  className="btn-modal-cancel"
                  onClick={handleCerrarModal}
                  disabled={guardando}
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="btn-modal-save"
                  disabled={guardando}
                >
                  <FaSave />
                  <span>{guardando ? 'Guardando...' : modoEdicion ? 'Guardar Cambios' : 'Registrar LUP'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
