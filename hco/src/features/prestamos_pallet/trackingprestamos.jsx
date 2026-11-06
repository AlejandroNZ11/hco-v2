import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  FaPlus, FaSearch, FaUndo, FaChevronLeft, FaChevronRight, FaIdCard, FaTruck, FaUserTie,
  FaEdit, FaEye, FaCheck, FaDolly, FaPenNib, FaEraser, FaSave, FaBuilding, FaWrench, FaFileExcel
} from 'react-icons/fa';
import Loading from '../../layouts/Loading';
import './trackingprestamos.css';
import * as XLSX from 'xlsx';

import {
  obtenerTrackingPrestamos,
  registrarDevolucionPrestamo,
  obtenerDatosMaestrosPrestamos,
  completarDespachoAuxiliar,
  actualizarRegistroPorDespachar
} from '../../services/prestamosService';

function getStoredAuthUser() {
  const raw = localStorage.getItem("authUser") || sessionStorage.getItem("authUser");
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

const ROLES_ADMIN = ['ADMIN', 'SUPERVISOR', 'SUPERADMIN', 'SUPER_ADMIN'];
const ITEMS_POR_PAGINA = 50;

const extraerIdDrive = (url) => {
  if (!url) return null;
  const str = String(url).trim();
  const match = str.match(/\/file\/d\/([a-zA-Z0-9_-]+)/) ||
                str.match(/\/d\/([a-zA-Z0-9_-]+)/) ||
                str.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  return match ? match[1] : (str.length > 20 && !str.includes('/') ? str : null);
};

export default function TrackingPrestamos() {
  const navigate = useNavigate();
  const [currentUser] = useState(() => getStoredAuthUser());
  const [loading, setLoading] = useState(false);

  const [prestamos, setPrestamos] = useState([]);
  const [conductores, setConductores] = useState([]);
  const [placas, setPlacas] = useState([]);
  const [empresas, setEmpresas] = useState([]);
  const [clientes, setClientes] = useState([]);

  const estadoFiltrosInicial = { 
    estado: 'Todos', 
    areaProceso: 'Todas',
    empresaId: 'Todas',
    fechaDesde: '', 
    fechaHasta: '', 
    buscar: '' 
  };

  const [filtrosForm, setFiltrosForm] = useState(estadoFiltrosInicial);
  const [filtrosActivos, setFiltrosActivos] = useState(estadoFiltrosInicial);
  const [paginaActual, setPaginaActual] = useState(1);

  // Modal Devolución
  const [modalDevVisible, setModalDevVisible] = useState(false);
  const [modoLectura, setModoLectura] = useState(false);
  const [prestamoSeleccionado, setPrestamoSeleccionado] = useState(null);

  const [devData, setDevData] = useState({
    tipo_accion: 'devolucion',
    cantidad_devuelta: '',
    cantidad_noretorno: '',
    recibido_por: '',
    conductor_regreso: '',
    dni_conductor_retorno: '',
    observacion_regreso: '',
    placa_editada: '',
    conductor_editado: '',
    firma_retorno_base64: ''
  });

  // Modal Edición "Por Despachar"
  const [modalEditarDespachoVisible, setModalEditarDespachoVisible] = useState(false);
  const [editDespachoData, setEditDespachoData] = useState({
    nro_placa: '',
    empresa_transporte_id: '',
    dni_conductor: '',
    conductor_nombre: '',
    nr_ruta: '',
    clientes_multiples: [],
    cliente_input: '',
    observacion_salida: ''
  });

  // Modal Auxiliar (Completar Despacho FASE 2)
  const [modalAuxVisible, setModalAuxVisible] = useState(false);
  const [auxData, setAuxData] = useState({
    nr_paletas: '',
    retorno: 'SI',
    observacion_salida: '',
    firma_conductor_base64: '',
    foto_salida_base64: ''
  });

  // Canvas Firma
  const [modalFirmaVisible, setModalFirmaVisible] = useState(false);
  const [firmaTarget, setFirmaTarget] = useState('devolucion');
  const canvasRef = useRef(null);
  const dibujandoRef = useRef(false);
  const tieneTrazoRef = useRef(false);

  const tableContainerRef = useRef(null);
  const [isDragging, setIsDragging] = useState(false);
  const dragData = useRef({ startX: 0, scrollLeft: 0 });

  const [avisoFlotante, setAvisoFlotante] = useState({
    visible: false, tipo: 'danger', titulo: '', mensaje: '', detalleExtra: '', onCloseCallback: null
  });

  const mostrarAviso = (tipo, titulo, mensaje, detalleExtra = '', onCloseCallback = null) => {
    setAvisoFlotante({ visible: true, tipo, titulo, mensaje, detalleExtra, onCloseCallback });
  };

  const cerrarAviso = () => {
    const cb = avisoFlotante.onCloseCallback;
    setAvisoFlotante(prev => ({ ...prev, visible: false, onCloseCallback: null }));
    if (typeof cb === 'function') cb();
  };

  const rolUsuario = String(currentUser?.rol || currentUser?.role || '').trim().toUpperCase();
  const esAdmin = ROLES_ADMIN.includes(rolUsuario);
  const esExterno = rolUsuario === 'EXTERNO';

  useEffect(() => {
    if (!currentUser) { navigate('/'); return; }
    cargarDatos();
  }, [currentUser, navigate]);

  const cargarDatos = async () => {
    setLoading(true);
    try {
      const maestros = await obtenerDatosMaestrosPrestamos();
      const listaPrestamos = await obtenerTrackingPrestamos(maestros);
      setPrestamos(listaPrestamos);
      setConductores(maestros.conductores || []);
      setPlacas(maestros.placas || []);
      setEmpresas(maestros.empresas || []);
      setClientes(maestros.clientes || []);
    } catch (err) {
      mostrarAviso('danger', 'Error al sincronizar datos', err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleMouseDown = (e) => {
    if (e.target.closest('button')) return;
    const container = tableContainerRef.current;
    if (!container) return;
    setIsDragging(true);
    dragData.current.startX = e.pageX - container.offsetLeft;
    dragData.current.scrollLeft = container.scrollLeft;
  };
  const handleMouseUpOrLeave = () => setIsDragging(false);
  const handleMouseMove = (e) => {
    if (!isDragging) return;
    e.preventDefault();
    const container = tableContainerRef.current;
    if (!container) return;
    const x = e.pageX - container.offsetLeft;
    const walk = (x - dragData.current.startX) * 1.4;
    container.scrollLeft = dragData.current.scrollLeft - walk;
  };

  const handleAplicarFiltros = () => { 
    setFiltrosActivos({ ...filtrosForm }); 
    setPaginaActual(1); 
  };
  
  const handleLimpiarFiltros = () => {
    setFiltrosForm(estadoFiltrosInicial); 
    setFiltrosActivos(estadoFiltrosInicial); 
    setPaginaActual(1);
  };


 const handleExportarExcel = () => {
    if (prestamosFiltrados.length === 0) {
      return mostrarAviso('warning', 'Sin registros', 'No hay datos que coincidan con los filtros aplicados.');
    }

    // 1. Mapeo de columnas con nombres limpios y datos formateados
    const dataAExportar = prestamosFiltrados.map((r, i) => ({
      'N°': i + 1,
      'ID Préstamo': r.id_prestamo || '',
      'Área Proceso': r.area_proceso || '',
      'Fecha Entrega': r.fecha_entrega ? new Date(r.fecha_entrega).toLocaleString('es-PE') : '',
      'Fecha Retorno': r.fecha_retorno_calculada ? new Date(r.fecha_retorno_calculada).toLocaleDateString('es-PE') : '',
      'Empresa Transporte': r.empresa_transporte_nombre || '',
      'Conductor Salida': r.conductor_nombre || '',
      'DNI Conductor': r.dni_conductor || '',
      'Ruta': r.nr_ruta || '',
      'Placa': r.nro_placa || '',
      'Paletas Prestadas': Number(r.nr_paletas || 0),
      'Paletas Devueltas': Number(r.nr_paletas_devueltas || 0),
      'Paletas No Retorno': Number(r.nr_paletas_noretorno || 0),
      'Paletas Pendientes': Number(r.paletas_pendientes || 0),
      'Estado': r.estado || '',
      'Fecha Devolución': r.fecha_devolucion ? new Date(r.fecha_devolucion).toLocaleString('es-PE') : '',
      'Conductor Retorno': r.conductor_retorno_nombre || '',
      'Observación Salida': r.observacion_salida || '',
      'Observación Regreso': r.observacion_regreso || ''
    }));

    // 2. Crear hoja de cálculo a partir del JSON
    const worksheet = XLSX.utils.json_to_sheet(dataAExportar);

    // 3. Ajustar el ancho automático de las columnas para que no salgan comprimidas
    const anchosColumnas = Object.keys(dataAExportar[0] || {}).map(key => ({
      wch: Math.max(key.length, 14)
    }));
    worksheet['!cols'] = anchosColumnas;

    // 4. Crear el libro de trabajo y adjuntar la hoja
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Tracking Préstamos');

    // 5. Descargar archivo con extensión .xlsx nativa
    const nombreArchivo = `Tracking_Prestamos_${new Date().toISOString().slice(0, 10)}.xlsx`;
    XLSX.writeFile(workbook, nombreArchivo);
  };

  const resumen = useMemo(() => {
    let pendientes = 0, parciales = 0, devueltos = 0, paletasPendientes = 0;
    prestamos.forEach(r => {
      if (r.estado === 'Pendiente') pendientes++;
      if (r.estado === 'Devolución Parcial') parciales++;
      if (r.estado === 'Devuelto') devueltos++;
      paletasPendientes += Number(r.paletas_pendientes || 0);
    });
    return { pendientes, parciales, devueltos, paletasPendientes };
  }, [prestamos]);

  const prestamosFiltrados = useMemo(() => {
    const texto = filtrosActivos.buscar.toLowerCase().trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    
    return prestamos.filter(row => {
      if (filtrosActivos.estado === 'Atrasado') {
        const cerrado = ['Devuelto', 'NO RETORNO', 'Cerrado mixto', 'Por despachar'].includes(row.estado);
        if (cerrado || !row.atrasado) return false;
      } else if (filtrosActivos.estado !== 'Todos' && filtrosActivos.estado !== '') {
        if (row.estado !== filtrosActivos.estado) return false;
      }

      if (filtrosActivos.areaProceso !== 'Todas') {
        if (row.area_proceso !== filtrosActivos.areaProceso) return false;
      }

      if (filtrosActivos.empresaId !== 'Todas') {
        if (String(row.empresa_transporte_id) !== String(filtrosActivos.empresaId)) return false;
      }

      if (filtrosActivos.fechaDesde || filtrosActivos.fechaHasta) {
        const fEntregaRow = row.fecha_entrega ? row.fecha_entrega.slice(0, 10) : '';
        if (filtrosActivos.fechaDesde && fEntregaRow < filtrosActivos.fechaDesde) return false;
        if (filtrosActivos.fechaHasta && fEntregaRow > filtrosActivos.fechaHasta) return false;
      }

      if (texto) {
        const searchable = `${row.id_prestamo} ${row.conductor_nombre} ${row.nro_placa} ${row.empresa_transporte_nombre} ${row.dni_conductor || ''}`
          .toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
        if (!searchable.includes(texto)) return false;
      }
      return true;
    });
  }, [prestamos, filtrosActivos]);

    // Extrae dinámicamente todas las áreas únicas que existan en la BD (OUTBOUND PRINCIPAL, OUTBOUND RETAIL, CLIENTE RECOGE, etc.)
  const areasProcesoDisponibles = useMemo(() => {
    const setAreas = new Set();
    prestamos.forEach(r => {
      if (r.area_proceso && String(r.area_proceso).trim() !== '') {
        setAreas.add(String(r.area_proceso).trim());
      }
    });
    // Si la lista estuviera vacía, dejamos las estándar por defecto
    if (setAreas.size === 0) {
      return ['OUTBOUND PRINCIPAL', 'OUTBOUND RETAIL', 'CLIENTE RECOGE'];
    }
    return Array.from(setAreas).sort();
  }, [prestamos]);

  const totalPaginas = Math.max(1, Math.ceil(prestamosFiltrados.length / ITEMS_POR_PAGINA));
  const indiceInicio = (paginaActual - 1) * ITEMS_POR_PAGINA;
  const prestamosPaginados = prestamosFiltrados.slice(indiceInicio, indiceInicio + ITEMS_POR_PAGINA);

  const placasFiltradasEmpresa = useMemo(() => {
    if (!editDespachoData.empresa_transporte_id) return [];
    const empIdNum = Number(editDespachoData.empresa_transporte_id);
    return placas.filter(p => Number(p.empresa_id) === empIdNum);
  }, [placas, editDespachoData.empresa_transporte_id]);

  const conductoresFiltradosEmpresa = useMemo(() => {
    if (!editDespachoData.empresa_transporte_id) return [];
    const empIdNum = Number(editDespachoData.empresa_transporte_id);
    return conductores.filter(c => Number(c.empresa_id) === empIdNum);
  }, [conductores, editDespachoData.empresa_transporte_id]);

  const abrirModalEditarDespacho = (item) => {
    setPrestamoSeleccionado(item);
    let clientesArray = [];
    const matchClientes = (item.observacion_salida || '').match(/\[CLIENTES:\s*([^\]]+)\]/i);
    if (matchClientes) {
      clientesArray = matchClientes[1].split(',').map(s => s.trim()).filter(Boolean);
    }

    setEditDespachoData({
      nro_placa: item.nro_placa === '-' ? '' : (item.nro_placa || ''),
      empresa_transporte_id: item.empresa_transporte_id ? String(item.empresa_transporte_id) : '',
      dni_conductor: item.dni_conductor || '',
      conductor_nombre: item.conductor_nombre === '-' ? '' : (item.conductor_nombre || ''),
      nr_ruta: item.nr_ruta || '',
      clientes_multiples: clientesArray,
      cliente_input: '',
      observacion_salida: item.observacion_salida || ''
    });
    setModalEditarDespachoVisible(true);
  };

  const handleCambioEmpresaEdicion = (empId) => {
    setEditDespachoData(prev => ({
      ...prev,
      empresa_transporte_id: empId,
      nro_placa: '',
      dni_conductor: '',
      conductor_nombre: ''
    }));
  };

    const handleGuardarEdicionDespacho = async (e) => {
    e.preventDefault();
    if (!prestamoSeleccionado) return;

    // Validación estricta para CLIENTE RECOGE: exactamente 6 dígitos alfanuméricos sin guiones
    if (prestamoSeleccionado.area_proceso === 'CLIENTE RECOGE') {
      const placaLimpia = (editDespachoData.nro_placa || '').replace(/[^A-Za-z0-9]/g, '').trim();
      if (placaLimpia.length !== 6) {
        return mostrarAviso(
          'warning',
          'Placa inválida',
          'La placa debe tener exactamente 6 caracteres alfanuméricos sin guiones (Ej: OUI564).'
        );
      }
    }

    setLoading(true);
    try {
      await actualizarRegistroPorDespachar(prestamoSeleccionado, {
        ...editDespachoData,
        usuario_actualiza: currentUser?.nombre || currentUser?.usuario || 'Admin'
      });
      setModalEditarDespachoVisible(false);
      mostrarAviso('success', 'Registro Actualizado', 'Los datos del despacho han sido modificados.');
      await cargarDatos();
    } catch (err) {
      mostrarAviso('danger', 'Error al editar', err.message);
    } finally {
      setLoading(false);
    }
  };

  const abrirModalAuxiliar = (item) => {
    setPrestamoSeleccionado(item);
    setAuxData({
      nr_paletas: '',
      retorno: item.area_proceso === 'CLIENTE RECOGE' ? 'NO' : 'SI',
      observacion_salida: '',
      firma_conductor_base64: '',
      foto_salida_base64: ''
    });
    setModalAuxVisible(true);
  };

  const handleAbrirFirmaSalida = () => {
    const cant = Number(auxData.nr_paletas);
    if (!auxData.nr_paletas.trim() || isNaN(cant) || cant <= 0) {
      return mostrarAviso('warning', 'Cantidad obligatoria', 'Ingrese el número de paletas antes de firmar.');
    }
    if (prestamoSeleccionado?.area_proceso === 'OUTBOUND PRINCIPAL' && !auxData.foto_salida_base64) {
      return mostrarAviso('warning', 'Foto obligatoria', 'En OUTBOUND PRINCIPAL debe adjuntar la foto antes de firmar.');
    }
    setModalAuxVisible(false);
    setFirmaTarget('auxiliar');
    setModalFirmaVisible(true);
  };

  const abrirModalDevolucion = (item, soloLectura = false) => {
    setPrestamoSeleccionado(item);
    setModoLectura(soloLectura);

    let tipoInicial = 'devolucion';
    if (item.estado === 'NO RETORNO') tipoInicial = 'no_retorno';
    if (item.estado === 'Cerrado mixto') tipoInicial = 'cerrado_mixto';

    setDevData({
      tipo_accion: tipoInicial,
      cantidad_devuelta: '',
      cantidad_noretorno: '',
      recibido_por: item.recibido_por || currentUser?.nombre || currentUser?.usuario || 'Usuario',
      conductor_regreso: item.conductor_retorno_nombre || '',
      dni_conductor_retorno: item.conductor_retorno || '',
      observacion_regreso: item.observacion_regreso || '',
      placa_editada: item.nro_placa || '',
      conductor_editado: item.conductor_nombre || '',
      firma_retorno_base64: ''
    });
    setModalDevVisible(true);
  };

  const handleCambioNoRetorno = (valor) => {
    const noRetornoNum = Number(valor);
    const pendientesActuales = Number(prestamoSeleccionado?.paletas_pendientes || 0);

    let nuevoTipoAccion = devData.tipo_accion;
    if (!isNaN(noRetornoNum) && noRetornoNum > 0) {
      if (noRetornoNum >= pendientesActuales) {
        nuevoTipoAccion = 'no_retorno';
      } else {
        nuevoTipoAccion = 'cerrado_mixto';
      }
    } else {
      if (devData.tipo_accion === 'cerrado_mixto' || devData.tipo_accion === 'no_retorno') {
        nuevoTipoAccion = esAdmin ? 'cerrado_mixto' : 'devolucion';
      }
    }

    setDevData(prev => ({
      ...prev,
      cantidad_noretorno: valor,
      tipo_accion: nuevoTipoAccion
    }));
  };

  const handleGuardarDevolucion = async (e) => {
    e.preventDefault();
    if (!prestamoSeleccionado) return;
    const cantDev = Number(devData.cantidad_devuelta || 0);
    const cantNoRet = Number(devData.cantidad_noretorno || 0);
    const pendientes = Number(prestamoSeleccionado.paletas_pendientes || 0);

    if (devData.tipo_accion === 'devolucion') {
      if (isNaN(cantDev) || cantDev <= 0) {
        return mostrarAviso('warning', 'Cantidad requerida', 'Ingrese una cantidad devuelta válida mayor a 0.');
      }
      if (cantDev > pendientes) {
        return mostrarAviso('warning', 'Excede pendientes', `No puede devolver más de las ${pendientes} paletas pendientes.`);
      }
    }

    if (devData.tipo_accion === 'cerrado_mixto') {
      if (cantDev <= 0 && cantNoRet <= 0) {
        return mostrarAviso('warning', 'Datos requeridos', 'Ingrese cantidad devuelta o cantidad no retorno.');
      }
      if (cantDev + cantNoRet > pendientes) {
        return mostrarAviso('warning', 'Excede pendientes', `La suma de devueltas (${cantDev}) y no retorno (${cantNoRet}) excede las ${pendientes} pendientes.`);
      }
      if (!devData.observacion_regreso.trim()) {
        return mostrarAviso('warning', 'Observación obligatoria', 'La observación es obligatoria para un cierre mixto.');
      }
    }

    if (devData.tipo_accion === 'no_retorno' && !devData.observacion_regreso.trim()) {
      return mostrarAviso('warning', 'Observación obligatoria', 'La observación es obligatoria para declarar NO RETORNO.');
    }

    setLoading(true);
    try {
      await registrarDevolucionPrestamo(prestamoSeleccionado, {
        cantidad_devuelta: cantDev,
        cantidad_noretorno: cantNoRet,
        tipo_accion: devData.tipo_accion,
        recibido_por: devData.recibido_por,
        observacion_regreso: devData.observacion_regreso,
        dni_conductor_retorno: devData.dni_conductor_retorno,
        firma_retorno_base64: devData.firma_retorno_base64,
        usuario_actualiza: currentUser?.nombre || currentUser?.usuario || 'Usuario'
      });
      setModalDevVisible(false);
      mostrarAviso('success', 'Devolución Procesada', 'El estado del préstamo ha sido actualizado.');
      await cargarDatos();
    } catch (err) {
      mostrarAviso('danger', 'Error al procesar devolución', err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (modalFirmaVisible && canvasRef.current) {
      const canvas = canvasRef.current;
      const contenedor = canvas.parentElement;
      canvas.width = contenedor.clientWidth;
      canvas.height = contenedor.clientHeight || 380;
      const ctx = canvas.getContext('2d');
      ctx.lineWidth = 2.5;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = '#0f172a';
      tieneTrazoRef.current = false;
    }
  }, [modalFirmaVisible]);

  const iniciarTrazo = (e) => {
    if (!canvasRef.current) return;
    dibujandoRef.current = true;
    tieneTrazoRef.current = true;
    const rect = canvasRef.current.getBoundingClientRect();
    const ctx = canvasRef.current.getContext('2d');
    ctx.beginPath();
    ctx.moveTo(e.clientX - rect.left, e.clientY - rect.top);
  };
  const moverTrazo = (e) => {
    if (!dibujandoRef.current || !canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const ctx = canvasRef.current.getContext('2d');
    ctx.lineTo(e.clientX - rect.left, e.clientY - rect.top);
    ctx.stroke();
  };
  const finalizarTrazo = () => { dibujandoRef.current = false; };
  const limpiarCanvasFirma = () => {
    if (!canvasRef.current) return;
    const ctx = canvasRef.current.getContext('2d');
    ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
    tieneTrazoRef.current = false;
  };

  const confirmarFirma = async () => {
    if (!tieneTrazoRef.current) return mostrarAviso('warning', 'Firma vacía', 'Debe firmar antes de guardar.');
    const dataUrl = canvasRef.current.toDataURL('image/png');

    if (firmaTarget === 'auxiliar') {
      setModalFirmaVisible(false);
      setLoading(true);
      try {
        await completarDespachoAuxiliar(prestamoSeleccionado, {
          ...auxData,
          firma_conductor_base64: dataUrl,
          retorno: prestamoSeleccionado.area_proceso === 'CLIENTE RECOGE' ? 'NO' : auxData.retorno,
          usuario_actualiza: currentUser?.nombre || currentUser?.usuario || 'Auxiliar'
        });
        mostrarAviso('success', 'Despacho Completado', 'El registro se actualizó y ahora está activo en tracking.');
        await cargarDatos();
      } catch (err) {
        mostrarAviso('danger', 'Error al despachar', err.message);
      } finally {
        setLoading(false);
      }
    } else {
      setDevData(prev => ({ ...prev, firma_retorno_base64: dataUrl }));
      setModalFirmaVisible(false);
    }
  };

  const renderBadgeEstado = (estado) => {
    const e = String(estado || '').trim();
    if (e === 'Por despachar') return <span className="badge-estado por-despachar">Por despachar</span>;
    if (e === 'Devuelto') return <span className="badge-estado devuelto">Devuelto</span>;
    if (e === 'Devolución Parcial') return <span className="badge-estado parcial">Parcial</span>;
    if (e === 'NO RETORNO') return <span className="badge-estado no-retorno">NO RETORNO</span>;
    if (e === 'Cerrado mixto') return <span className="badge-estado cerrado-mixto">Cerrado mixto</span>;
    return <span className="badge-estado pendiente">Pendiente</span>;
  };

  return (
    <div className="tracking-prestamos-page">
      {loading && <Loading />}

      {/* AVISO FLOTANTE */}
      {avisoFlotante.visible && (
        <div className="tw-modal-backdrop" onClick={cerrarAviso}>
          <div className="tw-modal-card-alert" onClick={e => e.stopPropagation()}>
            <div className="tw-modal-header">
              <div className={`tw-modal-icon-circle ${avisoFlotante.tipo}`}>
                {avisoFlotante.tipo === 'danger' && <span>✖</span>}
                {avisoFlotante.tipo === 'warning' && <span>⚠️</span>}
                {avisoFlotante.tipo === 'success' && <span>✔</span>}
              </div>
              <div className="tw-modal-text">
                <h3 className="tw-modal-title">{avisoFlotante.titulo}</h3>
                <p className="tw-modal-desc">{avisoFlotante.mensaje}</p>
                {avisoFlotante.detalleExtra && (
                  <div className="tw-modal-extra-box" style={{ marginTop: '8px' }}>
                    {avisoFlotante.detalleExtra}
                  </div>
                )}
              </div>
            </div>
            <div className="tw-modal-footer">
              <button type="button" className={`tw-modal-btn ${avisoFlotante.tipo}`} onClick={cerrarAviso}>
                Entendido
              </button>
            </div>
          </div>
        </div>
      )}

      {/* TOP HEADER & RESUMEN: AL COSTADO EN LAPTOP, ABAJO EN MÓVIL */}
      <div className="top-summary-grid">
        <section className="hero-card">
          <span className="module-pill">MÓDULO LOGÍSTICA</span>
          <h1>Tracking Préstamos de Pallet</h1>
          <p>Consulte, filtre y gestione el control y devolución de paletas a transportistas.</p>
        </section>

        {!esExterno && (
          <section className="summary-section">
            <div className="summary-grid">
              <div className="summary-card card-pendientes">
                <span>Pendientes</span>
                <strong>{resumen.pendientes}</strong>
              </div>
              <div className="summary-card card-parciales">
                <span>Parciales</span>
                <strong>{resumen.parciales}</strong>
              </div>
              <div className="summary-card card-devueltos">
                <span>Devueltos</span>
                <strong>{resumen.devueltos}</strong>
              </div>
              <div className="summary-card card-paletas">
                <span>Paletas pendientes</span>
                <strong>{resumen.paletasPendientes}</strong>
              </div>
            </div>
          </section>
        )}
      </div>

      {/* FILTROS (1 FILA EN LAPTOP, 2 COLUMNAS EN MÓVIL) */}
      <section className="filters-card">
        <div className="filters-grid">
          {/* Buscar */}
          <div className="filter-group filter-buscar">
            <label>Buscar</label>
            <input
              type="text"
              placeholder="ID, conductor, placa, empresa..."
              value={filtrosForm.buscar}
              onChange={e => setFiltrosForm({ ...filtrosForm, buscar: e.target.value })}
              onKeyDown={e => e.key === 'Enter' && handleAplicarFiltros()}
            />
          </div>

          {/* Área Proceso Dinámico */}
          <div className="filter-group filter-area">
            <label>Área Proceso</label>
            <select 
              value={filtrosForm.areaProceso} 
              onChange={e => setFiltrosForm({ ...filtrosForm, areaProceso: e.target.value })}
            >
              <option value="Todas">Todas</option>
              {areasProcesoDisponibles.map(area => (
                <option key={area} value={area}>{area}</option>
              ))}
            </select>
          </div>

          {/* Estado */}
          <div className="filter-group filter-estado">
            <label>Estado</label>
            <select value={filtrosForm.estado} onChange={e => setFiltrosForm({ ...filtrosForm, estado: e.target.value })}>
              <option value="Todos">Todos</option>
              <option value="Por despachar">Por despachar</option>
              <option value="Pendiente">Pendiente</option>
              <option value="Devolución Parcial">Devolución Parcial</option>
              <option value="Devuelto">Devuelto</option>
              <option value="NO RETORNO">NO RETORNO</option>
              <option value="Cerrado mixto">Cerrado mixto</option>
              <option value="Atrasado">Atrasado</option>
            </select>
          </div>

          {/* Empresa Transporte */}
          <div className="filter-group filter-empresa">
            <label>Empresa</label>
            <select 
              value={filtrosForm.empresaId} 
              onChange={e => setFiltrosForm({ ...filtrosForm, empresaId: e.target.value })}
            >
              <option value="Todas">Todas</option>
              {empresas.map(emp => (
                <option key={emp.id} value={emp.id}>{emp.nombre_empresa}</option>
              ))}
            </select>
          </div>

          {/* Rango de Fechas Entrega: Desde y Hasta */}
          <div className="filter-group filter-fechas date-range-group">
            <div className="date-sub-input">
              <label>Fecha Desde</label>
              <input
                type="date"
                value={filtrosForm.fechaDesde}
                onChange={e => setFiltrosForm({ ...filtrosForm, fechaDesde: e.target.value })}
              />
            </div>
            <div className="date-sub-input">
              <label>Fecha Hasta</label>
              <input
                type="date"
                value={filtrosForm.fechaHasta}
                onChange={e => setFiltrosForm({ ...filtrosForm, fechaHasta: e.target.value })}
              />
            </div>
          </div>
        </div>

        {/* Acciones de los filtros */}
        <div className="filters-actions-row">
          {!esExterno && (
            <button type="button" className="btn-action-primary" onClick={() => navigate('/prestamos/nuevo')}>
              <FaPlus /> <span>Registrar</span>
            </button>
          )}
          <button type="button" className="btn-action-primary" onClick={handleAplicarFiltros}>
            <FaSearch /> <span>Buscar</span>
          </button>
          <button type="button" className="btn-action-secondary" onClick={handleLimpiarFiltros}>
            <FaUndo /> <span>Limpiar</span>
          </button>
          {!esExterno && (
            <>
              <button type="button" className="btn-action-primary btn-extra-nav" onClick={() => navigate('/conductores/tracking')}>
                <FaIdCard /> <span>Conductores</span>
              </button>
              <button type="button" className="btn-action-primary btn-extra-nav" onClick={() => navigate('/placas/tracking')}>
                <FaTruck /> <span>Placas</span>
              </button>
              <button type="button" className="btn-action-primary btn-extra-nav" onClick={() => navigate('/clientes/tracking')}>
                <FaUserTie /> <span>Clientes</span>
              </button>
              <button type="button" className="btn-action-primary btn-extra-nav" onClick={() => navigate('/empresas-transporte/tracking')}>
                <FaBuilding /> <span>Empresa</span>
              </button>
            </>
          )}
        </div>
      </section>

{/* TABLA CON PAGINACIÓN Y EXPORTAR EXCEL */}
      <section className="table-section-card">
        <div className="table-topbar">
          {/* Fila 1: Contador a la izquierda y Botón Exportar a la derecha */}
          <div className="table-topbar-row-header">
            <span className="records-counter">
              Mostrando <strong>{prestamosPaginados.length}</strong> registros de <strong>{prestamosFiltrados.length}</strong>
            </span>
            <button type="button" className="btn-export-excel" onClick={handleExportarExcel} title="Exportar reporte a Excel">
              <span className="excel-badge-icon">X</span>
              <span>Exportar</span>
            </button>
          </div>

          {/* Fila 2: Botón Anterior, Página X de Y, Botón Siguiente */}
          <div className="table-topbar-row-pagination">
            <button 
              type="button" 
              className="page-nav-btn" 
              disabled={paginaActual <= 1} 
              onClick={() => setPaginaActual(p => Math.max(1, p - 1))}
            >
              <FaChevronLeft className="nav-chevron" /> <span>Anterior</span>
            </button>
            <span className="page-current-indicator">
              Página {paginaActual} de {totalPaginas}
            </span>
            <button 
              type="button" 
              className="page-nav-btn" 
              disabled={paginaActual >= totalPaginas} 
              onClick={() => setPaginaActual(p => Math.min(totalPaginas, p + 1))}
            >
              <span>Siguiente</span> <FaChevronRight className="nav-chevron" />
            </button>
          </div>
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
                <th style={{ textAlign: 'center', width: '40px' }}>N°</th>
                <th>ID Préstamo</th>
                <th style={{ textAlign: 'left' }}>Área proceso</th>
                <th>Fecha entrega</th>
                <th>Fecha retorno</th>
                <th>Empresa</th>
                <th style={{ textAlign: 'left' }}>Conductor</th>
                <th>Ruta</th>
                <th>Placa</th>
                <th>Paletas</th>
                <th>Devueltas</th>
                <th>Pendientes</th>
                <th>Estado</th>
                <th>Fecha devolución</th>
                <th style={{ textAlign: 'center', width: '80px' }}>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {prestamosPaginados.length === 0 ? (
                <tr>
                  <td colSpan="15" style={{ textAlign: 'center', padding: '28px', color: '#64748b' }}>
                    No se encontraron registros de préstamos.
                  </td>
                </tr>
              ) : (
                prestamosPaginados.map((r, index) => {
                  const estaCerrado = ['Devuelto', 'NO RETORNO', 'Cerrado mixto'].includes(r.estado);
                  const esPorDespachar = r.estado === 'Por despachar';
                  const numFila = indiceInicio + index + 1;
                  const fEntrega = r.fecha_entrega ? new Date(r.fecha_entrega).toLocaleString('es-PE', { dateStyle: 'short', timeStyle: 'short' }) : '-';
                  const fRetorno = r.fecha_retorno_calculada ? new Date(r.fecha_retorno_calculada).toLocaleDateString('es-PE') : '-';
                  const fDev = r.fecha_devolucion ? new Date(r.fecha_devolucion).toLocaleString('es-PE', { dateStyle: 'short', timeStyle: 'short' }) : '-';
                  const puedeEditarDespacho = esPorDespachar && esAdmin;

                  return (
                    <tr key={r.uuid} className={r.atrasado ? 'table-danger' : ''}>
                      <td style={{ textAlign: 'center', fontWeight: 'bold', color: '#475569' }}>{numFila}</td>
                      <td style={{ fontWeight: '800', color: '#0f4c81' }}>{r.id_prestamo}</td>
                      <td style={{ textAlign: 'left' }}>
                        <span style={{
                          fontSize: '10px',
                          fontWeight: '700',
                          padding: '2px 6px',
                          borderRadius: '4px',
                          background: 
                            r.area_proceso === 'CLIENTE RECOGE' ? '#f3e8ff' :
                            r.area_proceso === 'OUTBOUND RETAIL' ? '#fef3c7' : '#e0f2fe',
                          color: 
                            r.area_proceso === 'CLIENTE RECOGE' ? '#6b21a8' :
                            r.area_proceso === 'OUTBOUND RETAIL' ? '#b45309' : '#0369a1'
                        }}>
                          {r.area_proceso || '-'}
                        </span>
                      </td>
                      <td>{fEntrega}</td>
                      <td style={{ fontWeight: 700, color: r.atrasado ? '#dc2626' : '#16a34a' }}>{fRetorno}</td>
                      <td style={{ fontWeight: 600 }}>{r.empresa_transporte_nombre}</td>
                      <td style={{ textAlign: 'left', fontWeight: 'normal', color: '#1e293b' }}>{r.conductor_nombre}</td>
                      <td>{r.nr_ruta || '-'}</td>
                      <td style={{ fontWeight: 800 }}>{r.nro_placa}</td>
                      <td>{r.nr_paletas}</td>
                      <td style={{ fontWeight: 700, color: '#0f4c81' }}>{r.nr_paletas_devueltas}</td>
                      <td style={{ fontWeight: 700, color: Number(r.paletas_pendientes) > 0 ? '#dc2626' : '#16a34a' }}>{r.paletas_pendientes}</td>
                      <td>{renderBadgeEstado(r.estado)}</td>
                      <td>{fDev}</td>
                      <td style={{ textAlign: 'center' }}>
                        <div className="acciones-cell">
                          <button
                            type="button"
                            className={`btn-tabla-accion btn-accion-wrench ${puedeEditarDespacho ? 'activo' : 'inactivo'}`}
                            onClick={() => puedeEditarDespacho && abrirModalEditarDespacho(r)}
                            disabled={!puedeEditarDespacho}
                            title={puedeEditarDespacho ? 'Modificar datos de salida' : 'Disponible solo en estado "Por despachar"'}
                          >
                            <FaWrench />
                          </button>

                          {esPorDespachar ? (
                            <button
                              type="button"
                              className="btn-tabla-accion btn-accion-despacho"
                              onClick={() => abrirModalAuxiliar(r)}
                              title="Completar Despacho (Auxiliar)"
                            >
                              <FaDolly />
                            </button>
                          ) : estaCerrado && !esAdmin ? (
                            <button
                              type="button"
                              className="btn-tabla-accion btn-accion-eye"
                              onClick={() => abrirModalDevolucion(r, true)}
                              title="Ver detalle (Solo lectura)"
                            >
                              <FaEye />
                            </button>
                          ) : (
                            <button 
                              type="button" 
                              className={`btn-tabla-accion btn-accion-edit ${estaCerrado ? 'cerrado' : ''}`}
                              onClick={() => abrirModalDevolucion(r, false)} 
                              title={estaCerrado ? 'Modificar Devolución (Admin)' : 'Registrar Devolución'}
                            >
                              <FaEdit />
                            </button>
                          )}
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


      {/* ================= MODAL EDITAR DESPACHO ================= */}
      {modalEditarDespachoVisible && prestamoSeleccionado && (
        <div className="tp-modal-backdrop" onClick={() => setModalEditarDespachoVisible(false)}>
          <div className="tp-modal-card tp-modal-editar-despacho" onClick={e => e.stopPropagation()}>
            <div className="tp-modal-header">
              <div className="tp-modal-header-titles">
                <span className="tp-badge-pill">EDICIÓN ADMINISTRATIVA</span>
                <h3 className="tp-modal-title">Modificar Registro ({prestamoSeleccionado.id_prestamo})</h3>
                <small className="tp-modal-subinfo" style={{ color: '#0284c7', fontWeight: '700' }}>
                  Área: {prestamoSeleccionado.area_proceso}
                </small>
              </div>
              <button 
                type="button" 
                className="tp-btn-close" 
                onClick={() => setModalEditarDespachoVisible(false)}
                title="Cerrar modal"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleGuardarEdicionDespacho} className="tp-modal-body">
              {prestamoSeleccionado.area_proceso === 'CLIENTE RECOGE' ? (
                <>
                  {/* Placa de Vehículo: Obligatorio, exactamente 6 caracteres alfanuméricos sin guion */}
                  <div className="tp-form-group">
                    <label className="tp-label-small">
                      Placa de Vehículo <span style={{ color: '#dc2626' }}>* (6 caracteres)</span>
                    </label>
                    <input
                      type="text"
                      className="tp-input-clean"
                      value={editDespachoData.nro_placa}
                      onChange={e => {
                        // Elimina guiones, espacios y caracteres especiales; solo letras y números, máx 6
                        const limpia = e.target.value.replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 6);
                        setEditDespachoData({ ...editDespachoData, nro_placa: limpia });
                      }}
                      placeholder="Ej: ABC123"
                      maxLength={6}
                      pattern="[A-Za-z0-9]{6}"
                      title="Debe contener exactamente 6 caracteres alfanuméricos sin guiones ni espacios"
                      required
                    />
                  </div>

                  <div className="tp-form-group">
                    <label className="tp-label-small">Nombre Conductor</label>
                    <input
                      type="text"
                      className="tp-input-clean"
                      value={editDespachoData.conductor_nombre}
                      onChange={e => setEditDespachoData({ ...editDespachoData, conductor_nombre: e.target.value.toUpperCase() })}
                      placeholder="Nombre del conductor que recoge..."
                      required
                    />
                  </div>
                </>
              ) : (
                <>
                  <div className="tp-form-group">
                    <label className="tp-label-small">Empresa de Transporte</label>
                    <select
                      className="tp-select-clean"
                      value={editDespachoData.empresa_transporte_id}
                      onChange={e => handleCambioEmpresaEdicion(e.target.value)}
                      required
                    >
                      <option value="">-- Seleccione Empresa --</option>
                      {empresas.map(emp => (
                        <option key={emp.id} value={emp.id}>{emp.nombre_empresa}</option>
                      ))}
                    </select>
                  </div>

                  <div className="tp-form-group">
                    <div className="tp-label-row">
                      <label className="tp-label-small">Placa</label>
                      {editDespachoData.empresa_transporte_id && (
                        <span className="tp-subinfo-text">({placasFiltradasEmpresa.length} asociadas)</span>
                      )}
                    </div>
                    <select
                      className="tp-select-clean"
                      value={editDespachoData.nro_placa}
                      onChange={e => setEditDespachoData({ ...editDespachoData, nro_placa: e.target.value })}
                      disabled={!editDespachoData.empresa_transporte_id}
                      required
                    >
                      <option value="">
                        {!editDespachoData.empresa_transporte_id 
                          ? '-- Primero seleccione Empresa --' 
                          : placasFiltradasEmpresa.length === 0 
                            ? '-- No hay placas para esta empresa --' 
                            : '-- Seleccione Placa --'}
                      </option>
                      {placasFiltradasEmpresa.map(p => (
                        <option key={p.nro_placa} value={p.nro_placa}>{p.nro_placa}</option>
                      ))}
                    </select>
                  </div>

                  <div className="tp-form-group">
                    <div className="tp-label-row">
                      <label className="tp-label-small">Conductor</label>
                      {editDespachoData.empresa_transporte_id && (
                        <span className="tp-subinfo-text">({conductoresFiltradosEmpresa.length} asociados)</span>
                      )}
                    </div>
                    <select
                      className="tp-select-clean"
                      value={editDespachoData.dni_conductor}
                      onChange={e => {
                        const dni = e.target.value;
                        const cond = conductores.find(c => String(c.dni_conductor) === String(dni));
                        setEditDespachoData({
                          ...editDespachoData,
                          dni_conductor: dni,
                          conductor_nombre: cond?.nombre_conductor || ''
                        });
                      }}
                      disabled={!editDespachoData.empresa_transporte_id}
                      required
                    >
                      <option value="">
                        {!editDespachoData.empresa_transporte_id 
                          ? '-- Primero seleccione Empresa --' 
                          : conductoresFiltradosEmpresa.length === 0 
                            ? '-- No hay conductores para esta empresa --' 
                            : '-- Seleccione Conductor --'}
                      </option>
                      {conductoresFiltradosEmpresa.map(c => (
                        <option key={c.dni_conductor} value={c.dni_conductor}>
                          {c.nombre_conductor} {c.dni_conductor ? `(${c.dni_conductor})` : ''}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="tp-form-group">
                    <label className="tp-label-small">N° Ruta</label>
                    <input
                      type="text"
                      className="tp-input-clean"
                      value={editDespachoData.nr_ruta}
                      onChange={e => setEditDespachoData({ ...editDespachoData, nr_ruta: e.target.value })}
                      placeholder="Ej: 5 o R-01"
                    />
                  </div>

                  <div className="tp-form-group">
                    <label className="tp-label-small">Clientes (Múltiples)</label>
                    <div className="tp-client-input-wrapper">
                      <input
                        list="clientesEdicionList"
                        className="tp-input-clean"
                        value={editDespachoData.cliente_input}
                        onChange={e => setEditDespachoData({ ...editDespachoData, cliente_input: e.target.value })}
                        placeholder="Añadir cliente..."
                      />
                      <datalist id="clientesEdicionList">
                        {clientes.map(cli => <option key={cli.id} value={cli.nombre_cliente} />)}
                      </datalist>
                      <button
                        type="button"
                        className="tp-btn-add-tag"
                        onClick={() => {
                          const c = editDespachoData.cliente_input.trim();
                          if (c && !editDespachoData.clientes_multiples.includes(c)) {
                            setEditDespachoData({
                              ...editDespachoData,
                              clientes_multiples: [...editDespachoData.clientes_multiples, c],
                              cliente_input: ''
                            });
                          }
                        }}
                      >
                        +
                      </button>
                    </div>

                    {editDespachoData.clientes_multiples.length > 0 && (
                      <div className="tp-chips-container">
                        {editDespachoData.clientes_multiples.map((cli, i) => (
                          <span key={i} className="tp-chip-item">
                            {cli}
                            <button
                              type="button"
                              onClick={() => setEditDespachoData({
                                ...editDespachoData,
                                clientes_multiples: editDespachoData.clientes_multiples.filter((_, idx) => idx !== i)
                              })}
                            >
                              ×
                            </button>
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </>
              )}

              <div className="tp-actions-row-end" style={{ marginTop: '8px' }}>
                <button 
                  type="button" 
                  className="tp-btn-secondary" 
                  onClick={() => setModalEditarDespachoVisible(false)}
                >
                  Cancelar
                </button>
                <button 
                  type="submit" 
                  className="tp-btn-primary" 
                  disabled={loading}
                >
                  <FaSave /> <span>Guardar Modificación</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ================= MODAL AUXILIAR ================= */}
      {modalAuxVisible && prestamoSeleccionado && (
        <div className="tp-modal-backdrop" onClick={() => setModalAuxVisible(false)}>
          <div className="tp-modal-card tp-modal-aux" onClick={e => e.stopPropagation()}>
            <div className="tp-modal-header">
              <div className="tp-modal-header-titles">
                <span className="tp-badge-pill">DESPACHO AUXILIAR</span>
                <h3 className="tp-modal-title">Completar Salida ({prestamoSeleccionado.id_prestamo})</h3>
                <small className="tp-modal-subinfo">
                  Placa: <strong>{prestamoSeleccionado.nro_placa}</strong> &nbsp;|&nbsp; Chofer: <strong>{prestamoSeleccionado.conductor_nombre}</strong>
                </small>
              </div>
              <button 
                type="button" 
                className="tp-btn-close" 
                onClick={() => setModalAuxVisible(false)}
                title="Cerrar modal"
              >
                ✕
              </button>
            </div>

            <div className="tp-modal-body">
              <div className="tp-form-group">
                <div className="tp-label-row">
                  <label>N° paletas prestadas</label>
                  <span className="tp-tag-pill obligatorio">OBLIGATORIO</span>
                </div>
                <input
                  type="text"
                  inputMode="numeric"
                  className="tp-input-clean"
                  value={auxData.nr_paletas}
                  onChange={e => setAuxData({ ...auxData, nr_paletas: e.target.value.replace(/\D/g, '').slice(0, 3) })}
                  placeholder="Ej: 15"
                  required
                  autoFocus
                />
              </div>

              <div className="tp-form-group">
                <div className="tp-label-row">
                  <label>¿Retorna?</label>
                  <span className="tp-tag-pill obligatorio">OBLIGATORIO</span>
                </div>
                <select
                  className="tp-select-clean"
                  value={prestamoSeleccionado.area_proceso === 'CLIENTE RECOGE' ? 'NO' : auxData.retorno}
                  onChange={e => setAuxData({ ...auxData, retorno: e.target.value })}
                  disabled={prestamoSeleccionado.area_proceso === 'CLIENTE RECOGE'}
                >
                  <option value="SI">SÍ</option>
                  <option value="NO">NO</option>
                </select>
              </div>

              <div className="tp-form-group">
                <div className="tp-label-row">
                  <label>Foto de salida</label>
                  <span className={`tp-tag-pill ${prestamoSeleccionado.area_proceso === 'OUTBOUND PRINCIPAL' ? 'obligatorio' : 'opcional'}`}>
                    {prestamoSeleccionado.area_proceso === 'OUTBOUND PRINCIPAL' ? 'OBLIGATORIO' : 'OPCIONAL'}
                  </span>
                </div>
                
                <div className="tp-file-custom-box">
                  <input
                    id="tpFotoSalidaInput"
                    type="file"
                    accept="image/*"
                    capture="environment"
                    className="tp-hidden-input-file"
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      try {
                        const reader = new FileReader();
                        reader.onload = () => {
                          const img = new Image();
                          img.onload = () => {
                            const scale = Math.min(1, 1280 / img.width);
                            const canvas = document.createElement('canvas');
                            canvas.width = Math.round(img.width * scale);
                            canvas.height = Math.round(img.height * scale);
                            const ctx = canvas.getContext('2d');
                            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                            setAuxData(prev => ({ ...prev, foto_salida_base64: canvas.toDataURL('image/png') }));
                          };
                          img.src = reader.result;
                        };
                        reader.readAsDataURL(file);
                      } catch (err) {
                        mostrarAviso('danger', 'Error de imagen', 'No se pudo procesar la fotografía.');
                      }
                    }}
                  />
                  <label htmlFor="tpFotoSalidaInput" className="tp-file-label">
                    <span className="tp-file-btn">Elegir archivo</span>
                    <span className="tp-file-name">
                      {auxData.foto_salida_base64 ? 'Foto cargada (PNG)' : 'No se ha seleccionado ningún archivo'}
                    </span>
                  </label>
                </div>

                <div className="tp-file-extra-info">
                  <span className={`tp-badge-file-status ${auxData.foto_salida_base64 ? 'cargado' : 'sin-foto'}`}>
                    {auxData.foto_salida_base64 ? 'Foto lista' : 'Sin foto'}
                  </span>
                  {auxData.foto_salida_base64 && (
                    <button
                      type="button"
                      className="tp-btn-quitar-foto"
                      onClick={() => setAuxData(prev => ({ ...prev, foto_salida_base64: '' }))}
                    >
                      Quitar foto
                    </button>
                  )}
                </div>
              </div>

              <div className="tp-form-group">
                <div className="tp-label-row">
                  <label>Observación de salida</label>
                  <span className="tp-tag-pill opcional">OPCIONAL</span>
                </div>
                <textarea
                  className="tp-textarea-clean"
                  value={auxData.observacion_salida}
                  onChange={e => setAuxData({ ...auxData, observacion_salida: e.target.value })}
                  rows={2}
                  placeholder="Detalles del despacho físico..."
                />
              </div>

              <div style={{ marginTop: '10px' }}>
                <button
                  type="button"
                  className="tp-btn-submit-main"
                  onClick={handleAbrirFirmaSalida}
                >
                  <FaPenNib /> <span>Firmar y Finalizar Despacho</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ================= MODAL DEVOLUCIÓN ================= */}
      {modalDevVisible && prestamoSeleccionado && (
        <div className="tp-modal-backdrop" onClick={() => setModalDevVisible(false)}>
          <div className="tp-modal-card tp-modal-devolucion" onClick={e => e.stopPropagation()}>
            <div className="tp-modal-header">
              <div className="tp-modal-header-titles">
                <span className="tp-badge-pill">ID: {prestamoSeleccionado.id_prestamo}</span>
                <h3 className="tp-modal-title">
                  {modoLectura ? 'Detalle de Devolución' : 'Registrar Devolución de Paletas'}
                </h3>
              </div>
              <button 
                type="button" 
                className="tp-btn-close" 
                onClick={() => setModalDevVisible(false)}
                title="Cerrar modal"
              >
                ✕
              </button>
            </div>

<form onSubmit={handleGuardarDevolucion} className="tp-modal-body">
              <div className="tp-split-layout">
                {/* =========================================================
                    LADO IZQUIERDO: DATOS DE SALIDA
                    ========================================================= */}
                <div className="tp-split-col left-panel">
                  <div className="tp-panel-title">Datos de Salida</div>

                  <div className="tp-kpis-mini-grid">
                    <div className="tp-mini-kpi">
                      <strong>{prestamoSeleccionado.nr_paletas}</strong>
                      <span>PRESTADAS</span>
                    </div>
                    <div className="tp-mini-kpi blue">
                      <strong>{prestamoSeleccionado.nr_paletas_devueltas}</strong>
                      <span>DEVUELTAS</span>
                    </div>
                    <div className="tp-mini-kpi amber">
                      <strong>{prestamoSeleccionado.nr_paletas_noretorno || 0}</strong>
                      <span>NO RETORNO</span>
                    </div>
                    <div className={`tp-mini-kpi ${Number(prestamoSeleccionado.paletas_pendientes) > 0 ? 'red' : 'green'}`}>
                      <strong>{prestamoSeleccionado.paletas_pendientes}</strong>
                      <span>PENDIENTES</span>
                    </div>
                  </div>

                  {/* Placa (Salida) al costado de Conductor (Salida) */}
                  <div className="tp-grid-2cols">
                    <div className="tp-form-group">
                      <label className="tp-label-small">Placa (Salida)</label>
                      <input 
                        className="tp-input-readonly" 
                        value={prestamoSeleccionado.nro_placa} 
                        readOnly 
                      />
                    </div>
                    <div className="tp-form-group">
                      <label className="tp-label-small">Conductor (Salida)</label>
                      <input 
                        className="tp-input-readonly" 
                        value={prestamoSeleccionado.conductor_nombre || '-'} 
                        readOnly 
                      />
                    </div>
                  </div>

                  {/* 3. Cliente y Tipo Paleta (Solo OUTBOUND RETAIL) */}
                  {prestamoSeleccionado.area_proceso === 'OUTBOUND RETAIL' && (
                    <div className="tp-grid-2cols">
                      <div className="tp-form-group">
                        <label className="tp-label-small">Cliente</label>
                        <input className="tp-input-readonly" value={prestamoSeleccionado.cliente_nombre || '-'} readOnly />
                      </div>
                      <div className="tp-form-group">
                        <label className="tp-label-small">Tipo Paleta</label>
                        <input className="tp-input-readonly" value={prestamoSeleccionado.tipo_paleta_nombre || '-'} readOnly />
                      </div>
                    </div>
                  )}

                  {/* 4. Despachador */}
                  <div className="tp-form-group">
                    <label className="tp-label-small">Despachador</label>
                    <input className="tp-input-readonly" value={prestamoSeleccionado.despachador} readOnly />
                  </div>

                  {/* 5. Observación de salida */}
                  <div className="tp-form-group">
                    <label className="tp-label-small">Observación de salida</label>
                    <textarea className="tp-textarea-readonly" value={prestamoSeleccionado.observacion_salida || 'Sin observaciones'} rows={2} readOnly />
                  </div>

                  {/* Evidencias de salida */}
                  <div className="tp-evidence-grid">
                    <div className="tp-evidence-box">
                      <span className="tp-evidence-title">Firma Salida</span>
                      {prestamoSeleccionado.firma_conductor ? (
                        <a href={prestamoSeleccionado.firma_conductor} target="_blank" rel="noopener noreferrer">
                          <img 
                            src={`https://lh3.googleusercontent.com/d/${extraerIdDrive(prestamoSeleccionado.firma_conductor)}`} 
                            alt="Firma" 
                            className="tp-evidence-img"
                            crossOrigin="anonymous"
                            referrerPolicy="no-referrer"
                          />
                        </a>
                      ) : (
                        <span className="tp-no-evidence">Sin firma</span>
                      )}
                    </div>

                    <div className="tp-evidence-box">
                      <span className="tp-evidence-title">Foto Salida</span>
                      {prestamoSeleccionado.foto_salida ? (
                        <a href={prestamoSeleccionado.foto_salida} target="_blank" rel="noopener noreferrer">
                          <img 
                            src={`https://lh3.googleusercontent.com/d/${extraerIdDrive(prestamoSeleccionado.foto_salida)}`} 
                            alt="Foto" 
                            className="tp-evidence-img"
                            crossOrigin="anonymous"
                            referrerPolicy="no-referrer"
                          />
                        </a>
                      ) : (
                        <span className="tp-no-evidence">Sin foto</span>
                      )}
                    </div>
                  </div>
                </div>

                {/* =========================================================
                    LADO DERECHO: DATOS PARA LA DEVOLUCIÓN (6 FILAS ORDENADAS)
                    ========================================================= */}
                <div className="tp-split-col right-panel">
                  <div className="tp-panel-title">Datos para la Devolución</div>

                  {/* FILA 1: Tipo de Acción */}
                  <div className="tp-form-group">
                    <label className="tp-label-small">Tipo de Acción</label>
                    <select
                      className="tp-select-clean"
                      value={devData.tipo_accion}
                      onChange={e => setDevData({ ...devData, tipo_accion: e.target.value })}
                      disabled={modoLectura}
                    >
                      <option value="devolucion">Registrar Devolución Normal</option>
                      {esAdmin && (
                        <>
                          <option value="cerrado_mixto" style={{ color: '#d97706', fontWeight: 'bold' }}>
                            Cierre Forzado (Cerrado mixto)
                          </option>
                          <option value="no_retorno" style={{ color: '#dc2626', fontWeight: 'bold' }}>
                            NO RETORNO
                          </option>
                        </>
                      )}
                    </select>
                  </div>

                  {/* FILA 2: Cantidad devuelta ahora - Cantidad no retorno (en la misma fila) */}
                  <div className={`tp-grid-${esAdmin ? '2cols' : '1col'}`}>
                    <div className="tp-form-group">
                      <label className="tp-label-small">Cantidad devuelta ahora</label>
                      <input
                        type="number"
                        min="0"
                        className="tp-input-clean"
                        value={devData.cantidad_devuelta}
                        onChange={e => setDevData({ ...devData, cantidad_devuelta: e.target.value })}
                        disabled={modoLectura || devData.tipo_accion === 'no_retorno'}
                        placeholder="Paletas que ingresan..."
                      />
                    </div>

                    {esAdmin && (
                      <div className="tp-form-group">
                        <label className="tp-label-small">Cantidad no retorno</label>
                        <input
                          type="number"
                          min="0"
                          className="tp-input-clean"
                          value={devData.cantidad_noretorno}
                          onChange={e => handleCambioNoRetorno(e.target.value)}
                          disabled={modoLectura || devData.tipo_accion === 'no_retorno'}
                          placeholder="No volverán..."
                        />
                      </div>
                    )}
                  </div>

                  {/* FILA 3: Conductor (Regreso) */}
                  <div className="tp-form-group">
                    <label className="tp-label-small">Conductor (Regreso)</label>
                    <input
                      list="listaCondReg"
                      className="tp-input-clean"
                      value={devData.conductor_regreso}
                      onChange={e => {
                        const val = e.target.value;
                        const condObj = conductores.find(c => c.nombre_conductor.toLowerCase() === val.trim().toLowerCase());
                        setDevData({ ...devData, conductor_regreso: val, dni_conductor_retorno: condObj?.dni_conductor || '' });
                      }}
                      disabled={modoLectura}
                      placeholder="Buscar o ingresar conductor..."
                    />
                    <datalist id="listaCondReg">
                      {conductores.map(c => (
                        <option key={c.dni_conductor} value={c.nombre_conductor} />
                      ))}
                    </datalist>
                  </div>

                  {/* FILA 4: Recibido por */}
                  <div className="tp-form-group">
                    <label className="tp-label-small">Recibido por</label>
                    <input
                      type="text"
                      className="tp-input-clean"
                      value={devData.recibido_por}
                      onChange={e => setDevData({ ...devData, recibido_por: e.target.value })}
                      disabled={modoLectura}
                      placeholder="Nombre de quien recibe las paletas..."
                      required
                    />
                  </div>

                  {/* FILA 5: Firma de regreso (Botón + Badge en la misma fila) */}
                  <div className="tp-form-group">
                    <label className="tp-label-small">Firma de regreso</label>
                    <div className="tp-firma-row-wrapper">
                      {!modoLectura && (
                        <button 
                          type="button" 
                          className="tp-btn-secondary tp-btn-firma-action" 
                          onClick={() => { setFirmaTarget('devolucion'); setModalFirmaVisible(true); }}
                        >
                          <FaEdit /> <span>Firmar Regreso</span>
                        </button>
                      )}
                      <span className={`tp-badge-status-pill ${devData.firma_retorno_base64 || prestamoSeleccionado.firma_retorno ? 'operativo' : 'observado'}`}>
                        {devData.firma_retorno_base64 || prestamoSeleccionado.firma_retorno ? '✓ Firma Lista' : 'Pendiente de firma'}
                      </span>
                    </div>
                  </div>

                  {/* FILA 6: Observación de regreso */}
                  <div className="tp-form-group">
                    <label className="tp-label-small">Observación de regreso</label>
                    <textarea
                      className="tp-textarea-clean"
                      value={devData.observacion_regreso}
                      onChange={e => setDevData({ ...devData, observacion_regreso: e.target.value })}
                      rows={2}
                      disabled={modoLectura}
                      placeholder="Motivo del cierre, diferencias o comentarios..."
                    />
                  </div>

                  {/* Acciones finales */}
                  {!modoLectura && (
                    <div className="tp-actions-row-end" style={{ marginTop: '4px' }}>
                      <button type="button" className="tp-btn-secondary" onClick={() => setModalDevVisible(false)}>
                        Cancelar
                      </button>
                      <button type="submit" className="tp-btn-primary" disabled={loading}>
                        <FaCheck /> <span>Guardar Devolución</span>
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </form>

          </div>
        </div>
      )}

      {/* ================= MODAL FIRMA ================= */}
      {modalFirmaVisible && (
        <div className="tw-modal-backdrop" onClick={() => {
          setModalFirmaVisible(false);
          if (firmaTarget === 'auxiliar') setModalAuxVisible(true);
        }}>
          <div className="firma-modal-card" onClick={e => e.stopPropagation()}>
            <div className="firma-modal-header">
              <h3>Firma del conductor</h3>
            </div>

            <div className="firma-modal-body">
              <div className="canvas-container-firma">
                {!tieneTrazoRef.current && (
                  <span className="canvas-hint-text">Dibuje su firma aquí</span>
                )}
                <canvas
                  ref={canvasRef}
                  id="firmaCanvas"
                  onPointerDown={iniciarTrazo}
                  onPointerMove={moverTrazo}
                  onPointerUp={finalizarTrazo}
                />
              </div>
            </div>

            <div className="firma-modal-footer">
              <button 
                type="button" 
                className="btn-firma-full btn-firma-outline" 
                onClick={limpiarCanvasFirma}
              >
                <FaEraser /> <span>Limpiar</span>
              </button>

              <button 
                type="button" 
                className="btn-firma-full btn-firma-outline" 
                onClick={() => {
                  setModalFirmaVisible(false);
                  if (firmaTarget === 'auxiliar') setModalAuxVisible(true);
                }}
              >
                <span>Cancelar</span>
              </button>

              <button 
                type="button" 
                className="btn-firma-full btn-firma-primary" 
                onClick={confirmarFirma}
              >
                <FaSave /> <span>Guardar firma</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}