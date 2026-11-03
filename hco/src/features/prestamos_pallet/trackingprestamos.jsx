import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  FaPlus, FaSearch, FaUndo, FaChevronLeft, FaChevronRight, FaIdCard, FaTruck, FaUserTie,
  FaEdit, FaEye, FaCheck, FaDolly, FaPenNib, FaEraser, FaSave, FaBuilding
} from 'react-icons/fa';
import Loading from '../../layouts/Loading';
import './trackingprestamos.css';

import {
  obtenerTrackingPrestamos,
  registrarDevolucionPrestamo,
  obtenerDatosMaestrosPrestamos,
  completarDespachoAuxiliar
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

  const [filtrosForm, setFiltrosForm] = useState({ estado: 'Todos', fechaEntrega: '', buscar: '' });
  const [filtrosActivos, setFiltrosActivos] = useState({ estado: 'Todos', fechaEntrega: '', buscar: '' });
  const [paginaActual, setPaginaActual] = useState(1);

  // Modal Devolución
  const [modalDevVisible, setModalDevVisible] = useState(false);
  const [modoLectura, setModoLectura] = useState(false);
  const [prestamoSeleccionado, setPrestamoSeleccionado] = useState(null);

  const [devData, setDevData] = useState({
    tipo_accion: 'devolucion',
    cantidad_devuelta: '',
    recibido_por: '',
    conductor_regreso: '',
    dni_conductor_retorno: '',
    observacion_regreso: '',
    placa_editada: '',
    conductor_editado: '',
    firma_retorno_base64: ''
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

  // Canvas Firma (Compartido para Devolución y Despacho)
  const [modalFirmaVisible, setModalFirmaVisible] = useState(false);
  const [firmaTarget, setFirmaTarget] = useState('devolucion'); // 'devolucion' | 'auxiliar'
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

  const handleAplicarFiltros = () => { setFiltrosActivos({ ...filtrosForm }); setPaginaActual(1); };
  const handleLimpiarFiltros = () => {
    const inicial = { estado: 'Todos', fechaEntrega: '', buscar: '' };
    setFiltrosForm(inicial); setFiltrosActivos(inicial); setPaginaActual(1);
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

      if (filtrosActivos.fechaEntrega) {
        const fEntregaRow = row.fecha_entrega ? row.fecha_entrega.slice(0, 10) : '';
        if (fEntregaRow !== filtrosActivos.fechaEntrega) return false;
      }

      if (texto) {
        const searchable = `${row.id_prestamo} ${row.conductor_nombre} ${row.nro_placa} ${row.empresa_transporte_nombre} ${row.dni_conductor || ''}`
          .toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
        if (!searchable.includes(texto)) return false;
      }
      return true;
    });
  }, [prestamos, filtrosActivos]);

  const totalPaginas = Math.max(1, Math.ceil(prestamosFiltrados.length / ITEMS_POR_PAGINA));
  const indiceInicio = (paginaActual - 1) * ITEMS_POR_PAGINA;
  const prestamosPaginados = prestamosFiltrados.slice(indiceInicio, indiceInicio + ITEMS_POR_PAGINA);

  // Abrir Modal Auxiliar
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

  const handleGuardarDespachoAuxiliar = async (e) => {
    e.preventDefault();
    if (!prestamoSeleccionado) return;

    const cant = Number(auxData.nr_paletas);
    if (isNaN(cant) || cant < 0) {
      return mostrarAviso('warning', 'Cantidad requerida', 'Ingrese una cantidad válida de paletas.');
    }

    // Obligatorio en Outbound Principal
    if (prestamoSeleccionado.area_proceso === 'OUTBOUND PRINCIPAL' && !auxData.foto_salida_base64) {
      return mostrarAviso('warning', 'Foto obligatoria', 'En OUTBOUND PRINCIPAL la foto de salida es obligatoria.');
    }

    if (!auxData.firma_conductor_base64) {
      return mostrarAviso('warning', 'Firma obligatoria', 'Debe registrar la firma de salida del conductor.');
    }

    setLoading(true);
    try {
      await completarDespachoAuxiliar(prestamoSeleccionado, {
        ...auxData,
        retorno: prestamoSeleccionado.area_proceso === 'CLIENTE RECOGE' ? 'NO' : auxData.retorno,
        usuario_actualiza: currentUser?.nombre || currentUser?.usuario || 'Auxiliar'
      });
      setModalAuxVisible(false);
      mostrarAviso('success', 'Despacho Completado', 'El registro se actualizó y ahora está activo en tracking.');
      await cargarDatos();
    } catch (err) {
      mostrarAviso('danger', 'Error al despachar', err.message);
    } finally {
      setLoading(false);
    }
  };

  // Modal Devolución
  const abrirModalDevolucion = (item, soloLectura = false) => {
    setPrestamoSeleccionado(item);
    setModoLectura(soloLectura);
    const estaCerrado = ['Devuelto', 'NO RETORNO', 'Cerrado mixto'].includes(item.estado);

    let tipoInicial = 'devolucion';
    if (item.estado === 'NO RETORNO') tipoInicial = 'no_retorno';
    if (item.estado === 'Cerrado mixto') tipoInicial = 'cerrado_mixto';

    setDevData({
      tipo_accion: tipoInicial,
      cantidad_devuelta: estaCerrado ? (item.nr_paletas_devueltas || 0) : '',
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

  const handleGuardarDevolucion = async (e) => {
    e.preventDefault();
    if (!prestamoSeleccionado) return;
    const cantDev = Number(devData.cantidad_devuelta);

    if (devData.tipo_accion !== 'no_retorno' && (isNaN(cantDev) || cantDev <= 0)) {
      return mostrarAviso('warning', 'Cantidad requerida', 'Ingrese una cantidad válida mayor a 0.');
    }
    if ((devData.tipo_accion === 'no_retorno' || devData.tipo_accion === 'cerrado_mixto') && !devData.observacion_regreso.trim()) {
      return mostrarAviso('warning', 'Observación obligatoria', 'La observación es obligatoria para este tipo de cierre.');
    }

    setLoading(true);
    try {
      await registrarDevolucionPrestamo(prestamoSeleccionado, {
        cantidad_devuelta: cantDev,
        tipo_accion: devData.tipo_accion,
        recibido_por: devData.recibido_por,
        observacion_regreso: devData.observacion_regreso,
        dni_conductor_retorno: devData.dni_conductor_retorno,
        firma_retorno_base64: devData.firma_retorno_base64,
        usuario_actualiza: currentUser?.nombre || currentUser?.usuario || 'Usuario',
        placa_editada: esAdmin ? devData.placa_editada : undefined
      });
      setModalDevVisible(false);
      mostrarAviso('success', 'Devolución Registrada', 'El préstamo se actualizó correctamente.');
      await cargarDatos();
    } catch (err) {
      mostrarAviso('danger', 'Error', err.message);
    } finally {
      setLoading(false);
    }
  };

    // En el useEffect de la firma (ajusta canvas.height a 210)
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
  const confirmarFirma = () => {
    if (!tieneTrazoRef.current) return mostrarAviso('warning', 'Firma vacía', 'Debe firmar antes de guardar.');
    const dataUrl = canvasRef.current.toDataURL('image/png');
    if (firmaTarget === 'auxiliar') {
      setAuxData(prev => ({ ...prev, firma_conductor_base64: dataUrl }));
    } else {
      setDevData(prev => ({ ...prev, firma_retorno_base64: dataUrl }));
    }
    setModalFirmaVisible(false);
  };

  // Función exacta de compresión idéntica a la que funcionaba en modal-prestamo
const comprimirFotoSalida = (file, maxWidth = 1280) => {
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

        {/* AVISO FLOTANTE MODERNO COMPACTO */}
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

      {/* TOP SUMMARY */}
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

      {/* FILTROS */}
      <section className="filters-card">
        <div className="filters-grid" style={{ gridTemplateColumns: '2.5fr 1fr 1fr' }}>
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

          <div className="filter-group">
            <label>Estado</label>
            <select value={filtrosForm.estado} onChange={e => setFiltrosForm({ ...filtrosForm, estado: e.target.value })}>
              <option value="Todos">Todos</option>
              <option value="Por despachar">Por despachar</option>
              <option value="Pendiente">Pendiente</option>
              <option value="Devolución Parcial">Devolución Parcial</option>
              <option value="Devuelto">Devuelto</option>
              <option value="NO RETORNO">NO RETORNO</option>
              <option value="Atrasado">Atrasado</option>
            </select>
          </div>

          <div className="filter-group">
            <label>Fecha entrega</label>
            <input
              type="date"
              value={filtrosForm.fechaEntrega}
              onChange={e => setFiltrosForm({ ...filtrosForm, fechaEntrega: e.target.value })}
            />
          </div>
        </div>

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
              <button type="button" className="btn-action-primary" onClick={() => navigate('/conductores/tracking')}>
                <FaIdCard /> <span>Conductores</span>
              </button>
              <button type="button" className="btn-action-primary" onClick={() => navigate('/placas/tracking')}>
                <FaTruck /> <span>Placas</span>
              </button>
              <button type="button" className="btn-action-primary" onClick={() => navigate('/clientes/tracking')}>
                <FaUserTie /> <span>Clientes</span>
              </button>
              <button type="button" className="btn-action-primary" onClick={() => navigate('/empresas-transporte/tracking')}>
                <FaBuilding /> <span>Empresa</span>
             </button>
            </>
          )}
        </div>
      </section>

      {/* TABLA */}
      <section className="table-section-card">
        <div className="table-topbar">
          <div className="pagination-bar">
            <span className="records-counter">
              Mostrando <strong>{prestamosPaginados.length}</strong> registros de <strong>{prestamosFiltrados.length}</strong>
            </span>
            <div className="pagination-controls">
              <button type="button" className="page-nav-btn" disabled={paginaActual <= 1} onClick={() => setPaginaActual(p => Math.max(1, p - 1))}>
                <FaChevronLeft className="nav-chevron" /> <span>Anterior</span>
              </button>
              <button type="button" className="page-nav-btn" disabled={paginaActual >= totalPaginas} onClick={() => setPaginaActual(p => Math.min(totalPaginas, p + 1))}>
                <span>Siguiente</span> <FaChevronRight className="nav-chevron" />
              </button>
            </div>
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
                <th style={{ textAlign: 'center' }}>Acciones</th>
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
                          background: r.area_proceso === 'CLIENTE RECOGE' ? '#f3e8ff' : '#e0f2fe',
                          color: r.area_proceso === 'CLIENTE RECOGE' ? '#6b21a8' : '#0369a1'
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
                          {/* BOTÓN FASE 2: DESPACHAR AUXILIAR */}
                          {esPorDespachar ? (
                            <button
                              type="button"
                              className="btn-tabla-aprobar"
                              style={{ background: '#f59e0b', color: '#fff' }}
                              onClick={() => abrirModalAuxiliar(r)}
                              title="Completar Despacho (Auxiliar)"
                            >
                              <FaDolly />
                            </button>
                          ) : estaCerrado && !esAdmin ? (
                            <button type="button" className="btn-tabla-editar" onClick={() => abrirModalDevolucion(r, true)} title="Ver detalle (Solo lectura)">
                              <FaEye />
                            </button>
                          ) : (
                            <button 
                              type="button" 
                              className={`btn-tabla-aprobar ${estaCerrado ? 'is-approved' : ''}`} 
                              onClick={() => abrirModalDevolucion(r, false)} 
                              title={estaCerrado ? 'Modificar Registro (Admin)' : 'Registrar Devolución'}
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

        {/* MODAL FASE 2: AUXILIAR DE SALIDA ESTILIZADO */}
        {modalAuxVisible && prestamoSeleccionado && (
        <div className="tw-modal-backdrop" onClick={() => setModalAuxVisible(false)}>
            <div className="tw-modal-card" style={{ maxWidth: '480px', padding: '22px' }} onClick={e => e.stopPropagation()}>
            <div className="card-head-modern" style={{ padding: 0, marginBottom: '16px' }}>
                <div>
                <span className="module-pill">DESPACHO AUXILIAR</span>
                <h3 style={{ margin: '4px 0 0', fontSize: '18px', fontWeight: 800 }}>
                    Completar Salida ({prestamoSeleccionado.id_prestamo})
                </h3>
                <small style={{ color: '#64748b' }}>
                    Placa: <strong>{prestamoSeleccionado.nro_placa}</strong> | Chofer: <strong>{prestamoSeleccionado.conductor_nombre}</strong>
                </small>
                </div>
                <button type="button" className="btn-action-secondary" onClick={() => setModalAuxVisible(false)}>✕</button>
            </div>

            <form onSubmit={handleGuardarDespachoAuxiliar}>
                {/* N° Paletas */}
                <div className="field-aux">
                <div className="label-head-aux">
                    <label>N° paletas prestadas</label>
                    <span className="tag-pill-aux obligatorio">OBLIGATORIO</span>
                </div>
                <input
                    type="text"
                    inputMode="numeric"
                    value={auxData.nr_paletas}
                    onChange={e => setAuxData({ ...auxData, nr_paletas: e.target.value.replace(/\D/g, '').slice(0, 3) })}
                    placeholder="Ej: 15"
                    required
                    autoFocus
                />
                </div>

                {/* ¿Retorna? */}
                <div className="field-aux">
                <div className="label-head-aux">
                    <label>¿Retorna?</label>
                    <span className="tag-pill-aux obligatorio">OBLIGATORIO</span>
                </div>
                <select
                    value={prestamoSeleccionado.area_proceso === 'CLIENTE RECOGE' ? 'NO' : auxData.retorno}
                    onChange={e => setAuxData({ ...auxData, retorno: e.target.value })}
                    disabled={prestamoSeleccionado.area_proceso === 'CLIENTE RECOGE'}
                >
                    <option value="SI">SÍ</option>
                    <option value="NO">NO</option>
                </select>
                </div>

            
                {/* Foto de Salida */}
                <div className="field-aux">
                <div className="label-head-aux">
                    <label>Foto de salida</label>
                    <span className={`tag-pill-aux ${prestamoSeleccionado.area_proceso === 'OUTBOUND PRINCIPAL' ? 'obligatorio' : 'opcional'}`}>
                    {prestamoSeleccionado.area_proceso === 'OUTBOUND PRINCIPAL' ? 'OBLIGATORIO' : 'OPCIONAL'}
                    </span>
                </div>
                <input
                    type="file"
                    accept="image/*"
                    capture="environment"
                    className="file-input-aux"
                    onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    try {
                        const base64 = await comprimirFotoSalida(file, 1280);
                        setAuxData(prev => ({ ...prev, foto_salida_base64: base64 }));
                    } catch (err) {
                        console.error("Error al comprimir foto auxiliar:", err);
                        mostrarAviso('danger', 'Error de imagen', 'No se pudo procesar la fotografía.');
                    }
                    }}
                />
                <div style={{ marginTop: '6px' }}>
                    <span className={`badge-status-aux ${auxData.foto_salida_base64 ? 'activa' : 'inactiva'}`}>
                    {auxData.foto_salida_base64 ? 'Foto cargada' : 'Sin foto'}
                    </span>
                </div>
                </div>

                {/* Observación */}
                <div className="field-aux" style={{ marginBottom: '18px' }}>
                <div className="label-head-aux">
                    <label>Observación de salida</label>
                    <span className="tag-pill-aux opcional">OPCIONAL</span>
                </div>
                <textarea
                    value={auxData.observacion_salida}
                    onChange={e => setAuxData({ ...auxData, observacion_salida: e.target.value })}
                    rows={2}
                    placeholder="Detalles del despacho físico..."
                />
                </div>

                {/* Firma Conductor */}
                <div className="field-aux">
                <div className="label-head-aux">
                    <label>Firma del conductor</label>
                    <span className="tag-pill-aux obligatorio">OBLIGATORIO</span>
                </div>
                <div className="firma-group-aux">
                    <button
                    type="button"
                    className="btn-firma-aux"
                    onClick={() => { setFirmaTarget('auxiliar'); setModalFirmaVisible(true); }}
                    >
                    <FaPenNib /> Firmar Salida
                    </button>
                    <span className={`badge-status-aux ${auxData.firma_conductor_base64 ? 'activa' : 'inactiva'}`}>
                    {auxData.firma_conductor_base64 ? 'Firma lista' : 'Sin firma'}
                    </span>
                </div>
                </div>

                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
                <button type="button" className="btn-action-secondary" onClick={() => setModalAuxVisible(false)}>
                    Cancelar
                </button>
                <button type="submit" className="btn-action-primary" disabled={loading}>
                    <FaSave /> Finalizar Despacho
                </button>
                </div>
            </form>
            </div>
        </div>
        )}

      {/* MODAL DEVOLUCIÓN */}
      {modalDevVisible && prestamoSeleccionado && (
        <div className="tw-modal-backdrop" onClick={() => setModalDevVisible(false)}>
          <div className="tw-modal-card" style={{ maxWidth: '960px', padding: '24px' }} onClick={e => e.stopPropagation()}>
            <div className="card-head-modern" style={{ padding: 0, marginBottom: '16px' }}>
              <div className="card-head-left">
                <span className="module-pill">ID: {prestamoSeleccionado.id_prestamo}</span>
                <h3 style={{ margin: '4px 0 0', fontSize: '18px', fontWeight: 800 }}>
                  {modoLectura ? 'Detalle de Devolución' : 'Registrar Devolución de Paletas'}
                </h3>
              </div>
              <button type="button" className="btn-action-secondary" onClick={() => setModalDevVisible(false)}>✕</button>
            </div>

            <form onSubmit={handleGuardarDevolucion}>
              <div className="split-layout" style={{ gap: '20px', display: 'flex' }}>
                <div style={{ flex: 1, background: '#f8fafc', padding: '16px', borderRadius: '12px' }}>
                  <div className="section-title" style={{ marginTop: 0, marginBottom: '12px', fontSize: '12px', fontWeight: 800, color: '#0f4c81', textTransform: 'uppercase' }}>Datos de Salida</div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginTop: '10px' }}>
                        {/* FIRMA DE SALIDA */}
                        {prestamoSeleccionado.firma_conductor && (
                            <div style={{ textAlign: 'center', background: '#fff', padding: '6px', borderRadius: '8px', border: '1px solid #cbd5e1' }}>
                            <span style={{ fontSize: '10px', fontWeight: 800, color: '#64748b', display: 'block', marginBottom: '4px' }}>
                                Firma Salida
                            </span>
                            <img 
                                src={`https://lh3.googleusercontent.com/d/${extraerIdDrive(prestamoSeleccionado.firma_conductor)}`} 
                                alt="Firma" 
                                style={{ maxHeight: '60px', maxWidth: '100%', objectFit: 'contain' }} 
                                onError={e => { e.target.style.display = 'none'; }} 
                            />
                            </div>
                        )}

                        {/* FOTO DE SALIDA */}
                        {prestamoSeleccionado.foto_salida && (
                            <div style={{ textAlign: 'center', background: '#fff', padding: '6px', borderRadius: '8px', border: '1px solid #cbd5e1' }}>
                            <span style={{ fontSize: '10px', fontWeight: 800, color: '#64748b', display: 'block', marginBottom: '4px' }}>
                                Foto Salida
                            </span>
                            <img 
                                src={`https://lh3.googleusercontent.com/d/${extraerIdDrive(prestamoSeleccionado.foto_salida)}`} 
                                alt="Foto" 
                                style={{ maxHeight: '60px', maxWidth: '100%', objectFit: 'contain' }} 
                                onError={e => { e.target.style.display = 'none'; }} 
                            />
                            </div>
                        )}
                        </div>
                 
                    </div>

                <div style={{ flex: 1, padding: '4px' }}>
                  <div className="section-title" style={{ marginTop: 0, marginBottom: '12px', fontSize: '12px', fontWeight: 800, color: '#0f4c81', textTransform: 'uppercase' }}>Datos para la Devolución</div>

                  <div className="filter-group" style={{ marginBottom: '12px' }}>
                    <label>Tipo de Acción</label>
                    <select value={devData.tipo_accion} onChange={e => setDevData({ ...devData, tipo_accion: e.target.value, cantidad_devuelta: e.target.value === 'no_retorno' ? 0 : '' })} disabled={modoLectura}>
                      <option value="devolucion">Registrar Devolución Normal</option>
                      {esAdmin && <option value="cerrado_mixto" style={{color: '#dc2626', fontWeight: 'bold'}}>Cierre Forzado (Cerrado mixto)</option>}
                      <option value="no_retorno">NO RETORNO</option>
                    </select>
                  </div>

                  <div className="filter-group" style={{ marginBottom: '12px' }}>
                    <label>Cantidad devuelta ahora</label>
                    <input type="number" min="0" value={devData.cantidad_devuelta} onChange={e => setDevData({ ...devData, cantidad_devuelta: e.target.value })} disabled={modoLectura || devData.tipo_accion === 'no_retorno'} />
                  </div>

                  <div className="filter-group" style={{ marginBottom: '12px' }}>
                    <label>Conductor (Regreso)</label>
                    <input list="listaCondReg" value={devData.conductor_regreso} onChange={e => {
                      const val = e.target.value;
                      const condObj = conductores.find(c => c.nombre_conductor.toLowerCase() === val.trim().toLowerCase());
                      setDevData({ ...devData, conductor_regreso: val, dni_conductor_retorno: condObj?.dni_conductor || '' });
                    }} disabled={modoLectura} placeholder="Conductor..." />
                    <datalist id="listaCondReg">{conductores.map(c => <option key={c.dni_conductor} value={c.nombre_conductor} />)}</datalist>
                  </div>

                  <div className="filter-group" style={{ marginBottom: '12px' }}>
                    <label>Firma de regreso</label>
                    {!modoLectura && (
                      <button type="button" className="btn-action-secondary" style={{ width: '100%', marginBottom: '6px', justifyContent: 'center' }} onClick={() => { setFirmaTarget('devolucion'); setModalFirmaVisible(true); }}>
                        <FaEdit /> Firmar Regreso
                      </button>
                    )}
                    <span className={`badge-estado ${devData.firma_retorno_base64 || prestamoSeleccionado.firma_retorno ? 'operativo' : 'observado'}`}>
                      {devData.firma_retorno_base64 || prestamoSeleccionado.firma_retorno ? 'Firma Lista' : 'Pendiente de firma'}
                    </span>
                  </div>

                  <div className="filter-group" style={{ marginBottom: '16px' }}>
                    <label>Observación de regreso</label>
                    <textarea value={devData.observacion_regreso} onChange={e => setDevData({ ...devData, observacion_regreso: e.target.value })} rows={3} disabled={modoLectura} />
                  </div>

                  {!modoLectura && (
                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
                      <button type="button" className="btn-action-secondary" onClick={() => setModalDevVisible(false)}>Cancelar</button>
                      <button type="submit" className="btn-action-primary" disabled={loading}><FaCheck /> Guardar Devolución</button>
                    </div>
                  )}
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

                {/* MODAL CANVAS FIRMA (DISEÑO EXACTO IMAGEN 2) */}
        {modalFirmaVisible && (
        <div className="tw-modal-backdrop" onClick={() => setModalFirmaVisible(false)}>
            <div className="firma-modal-card" onClick={e => e.stopPropagation()}>
            
            {/* Cabecera limpia centrada */}
            <div className="firma-modal-header">
                <h3>Firma del conductor</h3>
            </div>

            {/* Recuadro de firma amplio */}
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

            {/* Botones apilados con ícono y texto en una sola línea */}
            <div className="firma-modal-footer">
                <button 
                type="button" 
                className="btn-firma-full btn-firma-outline" 
                onClick={limpiarCanvasFirma}
                >
                <FaEraser /> Limpiar
                </button>

                <button 
                type="button" 
                className="btn-firma-full btn-firma-outline" 
                onClick={() => setModalFirmaVisible(false)}
                >
                Cancelar
                </button>

                <button 
                type="button" 
                className="btn-firma-full btn-firma-primary" 
                onClick={confirmarFirma}
                >
                <FaSave /> Guardar firma
                </button>
            </div>

            </div>
        </div>
        )}
    </div>
  );
}