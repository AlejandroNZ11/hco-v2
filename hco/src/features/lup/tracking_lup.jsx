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
  FaClipboardList,
  FaImage,
  FaSearchPlus
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
  try { return JSON.parse(raw); } catch { return null; }
}

const extraerIdDrive = (url) => {
  if (!url) return null;
  const str = String(url).trim();
  const match = str.match(/\/file\/d\/([a-zA-Z0-9_-]+)/) ||
                str.match(/\/d\/([a-zA-Z0-9_-]+)/) ||
                str.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  return match ? match[1] : (str.length > 20 && !str.includes('/') ? str : null);
};

function calcularSemanaDesdeFecha(fechaStr) {
  if (!fechaStr) return '';
  const partes = String(fechaStr).split('-');
  if (partes.length !== 3) return '';
  const fecha = new Date(Date.UTC(Number(partes[0]), Number(partes[1]) - 1, Number(partes[2])));
  if (isNaN(fecha.getTime())) return '';

  const diaSemana = fecha.getUTCDay() || 7;
  fecha.setUTCDate(fecha.getUTCDate() + 4 - diaSemana);
  const inicioAnio = new Date(Date.UTC(fecha.getUTCFullYear(), 0, 1));
  return Math.ceil((((fecha - inicioAnio) / 86400000) + 1) / 7);
}

function obtenerFechaHoyLima() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Lima',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date());
}

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

  const tableContainerRef = useRef(null);
  const [isDragging, setIsDragging] = useState(false);
  const dragData = useRef({ startX: 0, scrollLeft: 0 });

  // Filtros
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

  // Estados del Modal Principal
  const [modalOpen, setModalOpen] = useState(false);
  const [modoEdicion, setModoEdicion] = useState(false);
  const [registroSeleccionado, setRegistroSeleccionado] = useState(null);
  const [guardando, setGuardando] = useState(false);
  const [errorModal, setErrorModal] = useState('');

  // Estado para el Zoom de la Foto
  const [zoomFotoUrl, setZoomFotoUrl] = useState(null);

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
    impacto_co2: '',
    foto_lup: '',
    foto_lup_base64: ''
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

  const esLupActiva = (reg) => {
    if (!reg.operatividad) return true;
    return String(reg.operatividad).toUpperCase().trim() === 'ACTIVO';
  };

  const handleMouseDown = (e) => {
    if (e.target.closest('button')) return;
    const container = tableContainerRef.current;
    if (!container) return;
    setIsDragging(true);
    dragData.current.startX = e.pageX - container.offsetLeft;
    dragData.current.scrollLeft = container.scrollLeft;
  };

  const handleMouseUpOrLeave = () => { setIsDragging(false); };

  const handleMouseMove = (e) => {
    if (!isDragging) return;
    e.preventDefault();
    const container = tableContainerRef.current;
    if (!container) return;
    const x = e.pageX - container.offsetLeft;
    const walk = (x - dragData.current.startX) * 1.4;
    container.scrollLeft = dragData.current.scrollLeft - walk;
  };

  const totalLupCount = lups.length;
  const entrenadosCount = useMemo(() => lups.filter((l) => String(l.entrenamiento).toUpperCase() === 'ENTRENADO').length, [lups]);
  const activosCount = useMemo(() => lups.filter((l) => esLupActiva(l)).length, [lups]);
  const inactivosCount = useMemo(() => lups.filter((l) => !esLupActiva(l)).length, [lups]);

  const registrosFiltrados = useMemo(() => {
    return lups.filter((reg) => {
      const operatividadTexto = esLupActiva(reg) ? 'ACTIVO' : 'INACTIVO';

      if (filtrosActivos.tipoLup !== 'Todos' && reg.tipo_lup !== filtrosActivos.tipoLup) return false;
      if (filtrosActivos.impacto !== 'Todos' && reg.impacto !== filtrosActivos.impacto) return false;
      if (filtrosActivos.entrenamiento !== 'Todos' && reg.entrenamiento !== filtrosActivos.entrenamiento) return false;
      if (filtrosActivos.operatividad !== 'Todos' && operatividadTexto !== filtrosActivos.operatividad) return false;

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
          reg.tipo_lup,
          reg.impacto,
          reg.area_impacto,
          reg.titulo,
          reg.cod_kaizen,
          reg.impacto_co2
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();

        if (!textoFila.includes(q)) return false;
      }

      return true;
    });
  }, [lups, filtrosActivos]);

  const totalPaginas = Math.max(1, Math.ceil(registrosFiltrados.length / ITEMS_POR_PAGINA));
  const indiceInicio = (paginaActual - 1) * ITEMS_POR_PAGINA;
  const registrosPaginados = registrosFiltrados.slice(indiceInicio, indiceInicio + ITEMS_POR_PAGINA);

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

  const comprimirImagenAPng = (file, maxWidth = 1280) => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const img = new Image();
        img.onload = () => {
          const scale = Math.min(1, maxWidth / img.width);
          const canvas = document.createElement('canvas');
          canvas.width = Math.round(img.width * scale);
          canvas.height = Math.round(img.height * scale);
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          resolve(canvas.toDataURL('image/png'));
        };
        img.onerror = reject;
        img.src = reader.result;
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  };

  const handleFotoLupChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      return setErrorModal('Seleccione un archivo de imagen válido.');
    }
    try {
      const dataUrlPng = await comprimirImagenAPng(file, 1280);
      setFormData((prev) => ({ ...prev, foto_lup_base64: dataUrlPng }));
    } catch {
      setErrorModal('No se pudo procesar la imagen.');
    }
  };

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
      impacto_co2: reg.impacto_co2 || '',
      foto_lup: reg.foto_lup || '',
      foto_lup_base64: ''
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

    if (!numLupLimpio) return setErrorModal('El N° de LUP es obligatorio.');
    if (!formData.fecha_lup) return setErrorModal('Debe seleccionar la fecha de la LUP.');
    if (!formData.colaborador) return setErrorModal('Debe seleccionar un colaborador.');
    if (!formData.area_impacto) return setErrorModal('Debe seleccionar el área de impacto.');
    if (!tituloLimpio) return setErrorModal('El título de la LUP es obligatorio.');
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
      impacto_co2: impactoCo2Limpio || null,
      foto_lup: formData.foto_lup,
      foto_lup_base64: formData.foto_lup_base64
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

  const handleToggleOperatividad = async (reg) => {
    if (!puedeGestionar) return alert('No tienes permisos para cambiar la operatividad de la LUP.');

    const actualmenteActivo = esLupActiva(reg);
    const nuevaOperatividad = actualmenteActivo ? 'INACTIVO' : 'ACTIVO';
    const accionTexto = actualmenteActivo ? 'inactivar' : 'activar';

    const confirmar = window.confirm(`¿Está seguro que desea ${accionTexto} la LUP "${reg.numero_lup}" (${reg.titulo})?`);
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

  const handleExportarExcel = () => {
    if (!puedeExportar) return alert('No tienes permisos para exportar.');
    if (registrosFiltrados.length === 0) return alert('No hay registros para exportar.');

    const datosExcel = registrosFiltrados.map((reg, idx) => ({
      'Item': idx + 1,
      'N° LUP': reg.numero_lup || '-',
      'Fecha LUP': formatearSoloFecha(reg.fecha_lup),
      'Semana': reg.semana ?? '-',
      'Colaborador': reg.colaborador || '-',
      'Área Colaborador': reg.area || '-',
      'Jefe Directo': reg.jefe || '-',
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
      'Impacto CO2': reg.impacto_co2 || '-'
    }));

    const worksheet = XLSX.utils.json_to_sheet(datosExcel);
    worksheet['!cols'] = [
      { wch: 6 },
      { wch: 14 },
      { wch: 12 },
      { wch: 9 },
      { wch: 32 },
      { wch: 20 },
      { wch: 30 },
      { wch: 18 },
      { wch: 18 },
      { wch: 20 },
      { wch: 42 },
      { wch: 14 },
      { wch: 16 },
      { wch: 16 },
      { wch: 14 },
      { wch: 16 },
      { wch: 14 },
      { wch: 22 }
    ];

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Tracking_LUP');
    XLSX.writeFile(workbook, `Tracking_LUP_${obtenerFechaHoyLima()}.xlsx`);
  };

  // URL resuelta para renderizar en el contenedor del modal
  const urlFotoRender = useMemo(() => {
    if (formData.foto_lup_base64) return formData.foto_lup_base64;
    const driveId = extraerIdDrive(formData.foto_lup);
    return driveId ? `https://lh3.googleusercontent.com/d/${driveId}` : null;
  }, [formData.foto_lup, formData.foto_lup_base64]);

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

      {/* 2. FILTROS Y BOTONES */}
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

      {/* 3. TABLA (COLUMNA FOTO RETIRADA) */}
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
                <th>Fecha LUP</th>
                <th>Sem.</th>
                <th>Colaborador</th>
                <th>Área</th>
                <th>Jefe</th>
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
                <th style={{ textAlign: 'center' }}>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {registrosPaginados.length === 0 ? (
                <tr>
                  <td colSpan="18" style={{ textAlign: 'center', padding: '28px', color: '#64748b' }}>
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
                      <td style={{ fontWeight: '700' }}>{formatearSoloFecha(reg.fecha_lup)}</td>
                      <td>
                        <span className="semana-pill">S{reg.semana ?? '-'}</span>
                      </td>
                      <td style={{ fontWeight: '700', textAlign: 'left' }}>{reg.colaborador || '-'}</td>
                      <td>
                        <span className="empresa-tag">{reg.area || '-'}</span>
                      </td>
                      <td style={{ textAlign: 'left' }}>{reg.jefe || '-'}</td>
                      <td>
                        <span className={`badge-tipo-lup tipo-${String(reg.tipo_lup || '').toLowerCase().replace(/\s+/g, '-')}`}>
                          {reg.tipo_lup || '-'}
                        </span>
                      </td>
                      <td>
                        <span className="empresa-tag">{reg.impacto || '-'}</span>
                      </td>
                      <td>{reg.area_impacto || '-'}</td>
                      <td style={{ textAlign: 'left', maxWidth: '240px', overflow: 'hidden', textOverflow: 'ellipsis' }} title={reg.titulo}>
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
                      <td style={{ textAlign: 'center' }}>
                        <div className="acciones-cell">
                          <button
                            type="button"
                            className={`btn-tabla-editar ${!puedeGestionar ? 'disabled-by-role' : ''}`}
                            onClick={() => {
                              if (!puedeGestionar) return alert('No tienes permisos para editar.');
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

      {/* 4. MODAL ORGANIZADO EN 4 COLUMNAS */}
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
                      : 'Complete los datos de la Lección de Un Punto en el formulario.'}
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

                <div className="lup-form-grid-4cols">
                  {/* FILA 1: N° LUP - Fecha LUP - Semana - Rol */}
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

                  <div className="tc-form-group">
                    <label>Fecha LUP <span className="req">*</span></label>
                    <input
                      type="date"
                      value={formData.fecha_lup}
                      onChange={(e) => handleChangeFechaLup(e.target.value)}
                      required
                    />
                  </div>

                  <div className="tc-form-group">
                    <label>Semana (Automático)</label>
                    <input
                      type="text"
                      value={formData.semana ? `Semana ${formData.semana}` : ''}
                      readOnly
                      className="input-readonly"
                    />
                  </div>

                  <div className="tc-form-group">
                    <label>Rol (empleados.tipo)</label>
                    <input
                      type="text"
                      value={formData.rol}
                      placeholder="Automático"
                      readOnly
                      className="input-readonly"
                    />
                  </div>

                  {/* FILA 2: Colaborador - Jefe Directo */}
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

                  <div className="tc-form-group span-2">
                    <label>Jefe Directo</label>
                    <input
                      type="text"
                      value={formData.jefe}
                      placeholder="Automático según colaborador"
                      readOnly
                      className="input-readonly"
                    />
                  </div>

                  {/* FILA 3: Área Colaborador - Tipo LUP - Impacto - Área de Impacto */}
                  <div className="tc-form-group">
                    <label>Área del Colaborador</label>
                    <input
                      type="text"
                      value={formData.area}
                      placeholder="Automático"
                      readOnly
                      className="input-readonly"
                    />
                  </div>

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

                  <div className="tc-form-group">
                    <label>Área de Impacto <span className="req">*</span></label>
                    <select
                      value={formData.area_impacto}
                      onChange={(e) => handleChangeAreaImpacto(e.target.value)}
                      required
                    >
                      <option value="">-- Seleccione área --</option>
                      {areas.map((ar) => (
                        <option key={ar.id} value={ar.nombre}>{ar.nombre}</option>
                      ))}
                    </select>
                  </div>

                  {/* FILA 4: Título de la LUP */}
                  <div className="tc-form-group span-4">
                    <label>Título de la LUP <span className="req">*</span></label>
                    <input
                      type="text"
                      placeholder="Ej: ESTANDARIZACIÓN DE ETIQUETADO EN RECEPCIÓN"
                      value={formData.titulo}
                      onChange={(e) => setFormData({ ...formData, titulo: e.target.value.toUpperCase() })}
                      required
                    />
                  </div>

                  {/* FILA 5: Estado - Entrenamiento - Fecha Entrenamiento */}
                  <div className="tc-form-group">
                    <label>Estado (Automático)</label>
                    <input
                      type="text"
                      value="CONCLUIDO"
                      readOnly
                      className="input-readonly"
                    />
                  </div>

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

                  {/* FOTO LUP (ROWSPAN 2: FILA 5 Y 6, COLUMNA 4) */}
                  <div className="tc-form-group foto-box-rowspan">
                    <label><FaImage style={{ marginRight: '4px' }} /> Foto LUP (Opcional)</label>
                    <div className="foto-lup-container">
                      {urlFotoRender ? (
                        <div className="foto-preview-wrapper">
                          <img
                            src={urlFotoRender}
                            alt="Foto LUP"
                            className="foto-preview-img"
                          />
                          <div className="foto-actions-overlay">
                            {/* Botón de Zoom con Lupa */}
                            <button
                              type="button"
                              className="btn-zoom-foto"
                              onClick={() => setZoomFotoUrl(urlFotoRender)}
                              title="Ampliar foto"
                            >
                              <FaSearchPlus />
                            </button>
                            <button
                              type="button"
                              className="btn-quitar-foto"
                              onClick={() => setFormData({ ...formData, foto_lup: '', foto_lup_base64: '' })}
                            >
                              Quitar foto
                            </button>
                          </div>
                        </div>
                      ) : (
                        <>
                          <input
                            type="file"
                            accept="image/*"
                            capture="environment"
                            onChange={handleFotoLupChange}
                            className="file-input-lup"
                          />
                          <small style={{ color: '#94a3b8', fontSize: '9.5px', marginTop: '4px' }}>
                            Subir foto PNG o JPG
                          </small>
                        </>
                      )}
                    </div>
                  </div>

                  {/* FILA 6: ¿Realizó Kaizen? - Código Kaizen - Operatividad */}
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

                  {/* FILA 7: Impacto CO2 */}
                  <div className="tc-form-group span-4">
                    <label>Impacto CO2</label>
                    <input
                      type="text"
                      placeholder="Detalle el impacto CO2 o escriba N/A..."
                      value={formData.impacto_co2}
                      onChange={(e) => setFormData({ ...formData, impacto_co2: e.target.value })}
                    />
                  </div>
                </div>

                {/* AUDITORÍA COMPLETA (Fecha Registro, Usuario Actualiza y Fecha Actualiza) */}
                <div className="tc-audit-info">
                  {modoEdicion ? (
                    <>
                      <div>
                        <span>Fecha Registro:</span>{' '}
                        <strong>{formatearFechaHoraLima(registroSeleccionado?.fecha_registro)}</strong>
                      </div>
                      <div>
                        <span>Última Actualización:</span>{' '}
                        <strong>{formatearFechaHoraLima(registroSeleccionado?.fecha_actualiza)}</strong>
                      </div>
                      <div>
                        <span>Actualizado por:</span>{' '}
                        <strong>{registroSeleccionado?.usuario_actualiza || '-'}</strong>
                      </div>
                      <div>
                        <span>Se modificará por:</span>{' '}
                        <strong>{nombreUsuarioSesion}</strong>
                      </div>
                    </>
                  ) : (
                    <div>
                      <span>Usuario que registra:</span>{' '}
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

      {/* MODAL LIGHTBOX PARA ZOOM DE FOTO CASI AL TAMAÑO DE LA PANTALLA */}
      {zoomFotoUrl && (
        <div className="tc-modal-overlay tc-zoom-overlay" onClick={() => setZoomFotoUrl(null)}>
          <div className="tc-zoom-card" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              className="tc-zoom-close-btn"
              onClick={() => setZoomFotoUrl(null)}
              title="Cerrar vista ampliada"
            >
              <FaTimes />
            </button>
            <img src={zoomFotoUrl} alt="Vista Ampliada LUP" className="tc-zoom-image" />
          </div>
        </div>
      )}
    </div>
  );
}