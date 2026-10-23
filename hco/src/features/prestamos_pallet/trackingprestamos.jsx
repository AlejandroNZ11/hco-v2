import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  FaPlus, FaSearch, FaUndo, FaChevronLeft, FaChevronRight, 
  FaEdit, FaEye, FaCheck 
} from 'react-icons/fa';
import Loading from '../../layouts/Loading';
import './trackingprestamos.css'; // <-- Tu CSS exclusivo para este módulo

import {
  obtenerTrackingPrestamos,
  registrarDevolucionPrestamo,
  obtenerDatosMaestrosPrestamos
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
  const match = url.match(/\/d\/([a-zA-Z0-9_-]+)/) || url.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  return match ? match[1] : null;
};

export default function TrackingPrestamos() {
  const navigate = useNavigate();
  const [currentUser] = useState(() => getStoredAuthUser());
  const [loading, setLoading] = useState(false);

  // Datos principales
  const [prestamos, setPrestamos] = useState([]);
  const [conductores, setConductores] = useState([]);

  // Filtros
  const [filtrosForm, setFiltrosForm] = useState({
    estado: 'Todos',
    fechaEntrega: '',
    buscar: ''
  });

  const [filtrosActivos, setFiltrosActivos] = useState({
    estado: 'Todos',
    fechaEntrega: '',
    buscar: ''
  });

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

  // Modal Firma
  const [modalFirmaVisible, setModalFirmaVisible] = useState(false);
  const canvasRef = useRef(null);
  const dibujandoRef = useRef(false);
  const tieneTrazoRef = useRef(false);

  // Arrastre de tabla (manito)
  const tableContainerRef = useRef(null);
  const [isDragging, setIsDragging] = useState(false);
  const dragData = useRef({ startX: 0, scrollLeft: 0 });

  // Alerta Flotante (Tailwind modal style)
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
      const [listaPrestamos, maestros] = await Promise.all([
        obtenerTrackingPrestamos(),
        obtenerDatosMaestrosPrestamos()
      ]);
      setPrestamos(listaPrestamos);
      setConductores(maestros.conductores || []);
    } catch (err) {
      mostrarAviso('danger', 'Error al sincronizar datos', err.message);
    } finally {
      setLoading(false);
    }
  };

  // Lógica Arrastre Tabla
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

  const handleAplicarFiltros = () => { setFiltrosActivos({ ...filtrosForm }); setPaginaActual(1); };
  const handleLimpiarFiltros = () => {
    const inicial = { estado: 'Todos', fechaEntrega: '', buscar: '' };
    setFiltrosForm(inicial); setFiltrosActivos(inicial); setPaginaActual(1);
  };

  // KPIs
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
        const cerrado = ['Devuelto', 'NO RETORNO', 'Cerrado mixto'].includes(row.estado);
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

  // Devolución
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
      return mostrarAviso('warning', 'Observación obligatoria', 'La observación de regreso es obligatoria para este tipo de cierre.');
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
      mostrarAviso('success', 'Devolución Registrada', 'El préstamo se actualizó correctamente en Supabase.');
      await cargarDatos();
    } catch (err) {
      mostrarAviso('danger', 'Error', err.message);
    } finally {
      setLoading(false);
    }
  };

  // Canvas Firma
  useEffect(() => {
    if (modalFirmaVisible && canvasRef.current) {
      const canvas = canvasRef.current;
      const rect = canvas.parentElement.getBoundingClientRect();
      canvas.width = Math.floor(rect.width) - 24;
      canvas.height = 260;
      const ctx = canvas.getContext('2d');
      ctx.lineWidth = 2.5; ctx.lineCap = 'round'; ctx.strokeStyle = '#102033';
      tieneTrazoRef.current = false;
    }
  }, [modalFirmaVisible]);

  const iniciarTrazo = (e) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    dibujandoRef.current = true;
    tieneTrazoRef.current = true;
    const rect = canvas.getBoundingClientRect();
    const ctx = canvas.getContext('2d');
    ctx.beginPath();
    ctx.moveTo(e.clientX - rect.left, e.clientY - rect.top);
  };
  const moverTrazo = (e) => {
    if (!dibujandoRef.current || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const ctx = canvas.getContext('2d');
    ctx.lineTo(e.clientX - rect.left, e.clientY - rect.top);
    ctx.stroke();
  };
  const finalizarTrazo = () => { dibujandoRef.current = false; };
  const limpiarCanvasFirma = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    tieneTrazoRef.current = false;
  };
  const confirmarFirmaRegreso = () => {
    if (!tieneTrazoRef.current) return mostrarAviso('warning', 'Firma vacía', 'Debe firmar antes de guardar.');
    const dataUrl = canvasRef.current.toDataURL('image/png');
    setDevData(prev => ({ ...prev, firma_retorno_base64: dataUrl }));
    setModalFirmaVisible(false);
  };

  const renderBadgeEstado = (estado) => {
    const e = String(estado || '').trim();
    if (e === 'Devuelto') return <span className="badge-estado operativo">Devuelto</span>;
    if (e === 'Devolución Parcial') return <span className="badge-estado observado" style={{ background: '#e8f3ff', color: '#0f4c81' }}>Parcial</span>;
    if (e === 'NO RETORNO') return <span className="badge-estado inoperativo" style={{ background: '#0f172a' }}>NO RETORNO</span>;
    if (e === 'Cerrado mixto') return <span className="badge-estado inoperativo">Cerrado mixto</span>;
    return <span className="badge-estado observado">Pendiente</span>;
  };

  return (
    <div className="tracking-prestamos-page">
      {loading && <Loading />}

      {/* AVISO FLOTANTE MODERNO */}
      {avisoFlotante.visible && (
        <div className="tw-modal-backdrop" onClick={cerrarAviso}>
          <div className={`tw-modal-card tw-modal-${avisoFlotante.tipo}`} onClick={e => e.stopPropagation()}>
            <div className="tw-modal-header">
              <div className={`tw-modal-icon-circle ${avisoFlotante.tipo}`}>
                {avisoFlotante.tipo === 'danger' && <span>✖</span>}
                {avisoFlotante.tipo === 'warning' && <span>⚠️</span>}
                {avisoFlotante.tipo === 'success' && <span>✔</span>}
              </div>
              <div className="tw-modal-text">
                <h3 className="tw-modal-title">{avisoFlotante.titulo}</h3>
                <p className="tw-modal-desc">{avisoFlotante.mensaje}</p>
                {avisoFlotante.detalleExtra && <div className="tw-modal-extra-box">{avisoFlotante.detalleExtra}</div>}
              </div>
            </div>
            <div className="tw-modal-footer">
              <button type="button" className={`tw-modal-btn ${avisoFlotante.tipo}`} onClick={cerrarAviso}>Entendido</button>
            </div>
          </div>
        </div>
      )}

      {/* 1. CABECERA + TARJETAS KPI (DISEÑO PASTEL) */}
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


      {/* 2. FILTROS Y BOTONES */}
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
        </div>
      </section>

      {/* 3. TABLA CON PAGINACIÓN */}
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
                <th>Fecha entrega</th>
                <th>Fecha retorno</th>
                <th>Empresa</th>
                <th>Conductor</th>
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
                  <td colSpan="14" style={{ textAlign: 'center', padding: '28px', color: '#64748b' }}>
                    No se encontraron registros de préstamos.
                  </td>
                </tr>
              ) : (
                prestamosPaginados.map((r, index) => {
                  const estaCerrado = ['Devuelto', 'NO RETORNO', 'Cerrado mixto'].includes(r.estado);
                  const numFila = indiceInicio + index + 1;
                  const fEntrega = r.fecha_entrega ? new Date(r.fecha_entrega).toLocaleString('es-PE', { dateStyle: 'short', timeStyle: 'short' }) : '-';
                  const fRetorno = r.fecha_retorno_calculada ? new Date(r.fecha_retorno_calculada).toLocaleDateString('es-PE') : '-';
                  const fDev = r.fecha_devolucion ? new Date(r.fecha_devolucion).toLocaleString('es-PE', { dateStyle: 'short', timeStyle: 'short' }) : '-';

                  return (
                    <tr key={r.uuid} className={r.atrasado ? 'table-danger' : ''}>
                      <td style={{ textAlign: 'center', fontWeight: 'bold', color: '#475569' }}>{numFila}</td>
                      <td style={{ fontWeight: '800', color: '#0f4c81' }}>{r.id_prestamo}</td>
                      <td>{fEntrega}</td>
                      <td style={{ fontWeight: 700, color: r.atrasado ? '#dc2626' : '#16a34a' }}>{fRetorno}</td>
                      <td>{r.empresa_transporte_nombre}</td>
                      <td>{r.conductor_nombre}</td>
                      <td>{r.nr_ruta}</td>
                      <td style={{ fontWeight: 800 }}>{r.nro_placa}</td>
                      <td>{r.nr_paletas}</td>
                      <td style={{ fontWeight: 700, color: '#0f4c81' }}>{r.nr_paletas_devueltas}</td>
                      <td style={{ fontWeight: 700, color: Number(r.paletas_pendientes) > 0 ? '#dc2626' : '#16a34a' }}>{r.paletas_pendientes}</td>
                      <td>{renderBadgeEstado(r.estado)}</td>
                      <td>{fDev}</td>
                      <td style={{ textAlign: 'center' }}>
                        <div className="acciones-cell">
                          {estaCerrado && !esAdmin ? (
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

      {/* MODAL DEVOLUCIÓN (2 COLUMNAS) */}
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
                {/* COLUMNA IZQUIERDA: DATOS DE SALIDA */}
                <div style={{ flex: 1, background: '#f8fafc', padding: '16px', borderRadius: '12px' }}>
                  <div className="section-title" style={{ marginTop: 0, marginBottom: '12px', fontSize: '12px', fontWeight: 800, color: '#0f4c81', textTransform: 'uppercase' }}>Datos de Salida</div>
                  
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px', marginBottom: '14px', textAlign: 'center' }}>
                    <div style={{ background: '#fff', border: '1px solid #cbd5e1', borderRadius: '8px', padding: '8px' }}>
                      <div style={{ fontSize: '18px', fontWeight: 800 }}>{prestamoSeleccionado.nr_paletas}</div>
                      <small style={{ color: '#64748b', fontWeight: 700, fontSize: '10px' }}>PRESTADAS</small>
                    </div>
                    <div style={{ background: '#fff', border: '1px solid #cbd5e1', borderRadius: '8px', padding: '8px' }}>
                      <div style={{ fontSize: '18px', fontWeight: 800, color: '#0f4c81' }}>{prestamoSeleccionado.nr_paletas_devueltas}</div>
                      <small style={{ color: '#64748b', fontWeight: 700, fontSize: '10px' }}>DEVUELTAS</small>
                    </div>
                    <div style={{ background: '#fff', border: '1px solid #cbd5e1', borderRadius: '8px', padding: '8px' }}>
                      <div style={{ fontSize: '18px', fontWeight: 800, color: Number(prestamoSeleccionado.paletas_pendientes) > 0 ? '#dc2626' : '#16a34a' }}>
                        {prestamoSeleccionado.paletas_pendientes}
                      </div>
                      <small style={{ color: '#64748b', fontWeight: 700, fontSize: '10px' }}>PENDIENTES</small>
                    </div>
                  </div>

                  <div className="filter-group" style={{ marginBottom: '10px' }}>
                    <label>Placa (Salida)</label>
                    <input value={devData.placa_editada} onChange={e => setDevData({ ...devData, placa_editada: e.target.value.toUpperCase() })} readOnly={modoLectura || !esAdmin} />
                  </div>
                  <div className="filter-group" style={{ marginBottom: '10px' }}>
                    <label>Despachador</label>
                    <input value={prestamoSeleccionado.despachador} readOnly />
                  </div>
                  <div className="filter-group" style={{ marginBottom: '10px' }}>
                    <label>Observación de salida</label>
                    <textarea value={prestamoSeleccionado.observacion_salida || 'Sin observaciones'} rows={2} readOnly />
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginTop: '10px' }}>
                    {prestamoSeleccionado.firma_conductor && (
                      <div style={{ textAlign: 'center', background: '#fff', padding: '6px', borderRadius: '8px', border: '1px solid #cbd5e1' }}>
                        <span style={{ fontSize: '10px', fontWeight: 800, color: '#64748b', display: 'block', marginBottom: '4px' }}>Firma Salida</span>
                        <img src={`https://lh3.googleusercontent.com/d/${extraerIdDrive(prestamoSeleccionado.firma_conductor)}`} alt="Firma" style={{ maxHeight: '50px', objectFit: 'contain' }} onError={e => { e.target.style.display = 'none'; }} />
                      </div>
                    )}
                    {prestamoSeleccionado.foto_salida && (
                      <div style={{ textAlign: 'center', background: '#fff', padding: '6px', borderRadius: '8px', border: '1px solid #cbd5e1' }}>
                        <span style={{ fontSize: '10px', fontWeight: 800, color: '#64748b', display: 'block', marginBottom: '4px' }}>Foto Salida</span>
                        <img src={`https://lh3.googleusercontent.com/d/${extraerIdDrive(prestamoSeleccionado.foto_salida)}`} alt="Foto" style={{ maxHeight: '50px', objectFit: 'contain' }} onError={e => { e.target.style.display = 'none'; }} />
                      </div>
                    )}
                  </div>
                </div>

                {/* COLUMNA DERECHA: DATOS DE DEVOLUCIÓN */}
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
                      <button type="button" className="btn-action-secondary" style={{ width: '100%', marginBottom: '6px', justifyContent: 'center' }} onClick={() => setModalFirmaVisible(true)}>
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

      {/* MODAL FIRMA */}
      {modalFirmaVisible && (
        <div className="tw-modal-backdrop" onClick={() => setModalFirmaVisible(false)}>
          <div className="firma-box" onClick={e => e.stopPropagation()}>
            <h3>Firma del Conductor (Regreso)</h3>
            <canvas ref={canvasRef} id="firmaCanvas" onPointerDown={iniciarTrazo} onPointerMove={moverTrazo} onPointerUp={finalizarTrazo} />
            <div className="firma-actions">
              <button type="button" className="btn-action-secondary" onClick={limpiarCanvasFirma}>Limpiar</button>
              <button type="button" className="btn-action-secondary" onClick={() => setModalFirmaVisible(false)}>Cancelar</button>
              <button type="button" className="btn-action-primary" onClick={confirmarFirmaRegreso}>Guardar firma</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}