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
  FaTruck
} from 'react-icons/fa';
import Loading from '../../layouts/Loading';
import './tracking_empresas_transporte.css';
import * as XLSX from 'xlsx';

import {
  obtenerEmpresasTransporte,
  crearEmpresaTransporte,
  actualizarEmpresaTransporte,
  cambiarEstadoEmpresaTransporte
} from '../../services/empresasTransporteService';

const ITEMS_POR_PAGINA = 50;

function getStoredAuthUser() {
  const raw = localStorage.getItem("authUser") || sessionStorage.getItem("authUser");
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

export default function TrackingEmpresasTransporte() {
  const [currentUser] = useState(() => getStoredAuthUser());
  const [empresas, setEmpresas] = useState([]);
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

  const puedeExportar = ['superadmin', 'supervisor', 'admin', ''].includes(rolUsuario);
  const puedeGestionar = ['superadmin', 'supervisor', 'admin', ''].includes(rolUsuario);

  const tableContainerRef = useRef(null);
  const [isDragging, setIsDragging] = useState(false);
  const dragData = useRef({ startX: 0, scrollLeft: 0 });

  const [filtrosForm, setFiltrosForm] = useState({
    buscar: '',
    estado: 'Todos',
    fechaIni: '',
    fechaFin: ''
  });

  const [filtrosActivos, setFiltrosActivos] = useState({
    buscar: '',
    estado: 'Todos',
    fechaIni: '',
    fechaFin: ''
  });

  const [paginaActual, setPaginaActual] = useState(1);
  const [modalOpen, setModalOpen] = useState(false);
  const [modoEdicion, setModoEdicion] = useState(false);
  const [registroSeleccionado, setRegistroSeleccionado] = useState(null);
  const [guardando, setGuardando] = useState(false);
  const [errorModal, setErrorModal] = useState('');

  const [formData, setFormData] = useState({
    nombre_empresa: ''
  });

  useEffect(() => {
    cargarDatos();
  }, []);

  const cargarDatos = async () => {
    setLoading(true);
    try {
      const data = await obtenerEmpresasTransporte();
      setEmpresas(data || []);
    } catch (error) {
      console.error("Error al cargar empresas de transporte:", error);
    } finally {
      setLoading(false);
    }
  };

  const esEmpresaActiva = (reg) => {
    if (typeof reg.activo === 'boolean') return reg.activo;
    if (reg.estado) return String(reg.estado).toUpperCase().trim() === 'ACTIVO';
    return true; 
  };

  // Arrastre con mouse en tabla
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

  const totalEmpresasCount = empresas.length;
  const activosCount = useMemo(() => empresas.filter(e => esEmpresaActiva(e)).length, [empresas]);
  const inactivosCount = useMemo(() => empresas.filter(e => !esEmpresaActiva(e)).length, [empresas]);

  function formatearFecha(fecha) {
    if (!fecha) return '-';
    return new Date(fecha).toLocaleString('es-PE', { dateStyle: 'short', timeStyle: 'short' }).replace(',', '');
  }

  const registrosFiltrados = useMemo(() => {
    return empresas.filter((reg) => {
      const activo = esEmpresaActiva(reg);
      const estadoTexto = activo ? 'ACTIVO' : 'INACTIVO';

      if (filtrosActivos.estado !== 'Todos' && estadoTexto !== filtrosActivos.estado) return false;
      
      if (filtrosActivos.fechaIni && reg.fecha_registro) {
        if (String(reg.fecha_registro).slice(0, 10) < filtrosActivos.fechaIni) return false;
      }
      if (filtrosActivos.fechaFin && reg.fecha_registro) {
        if (String(reg.fecha_registro).slice(0, 10) > filtrosActivos.fechaFin) return false;
      }
      if (filtrosActivos.buscar.trim() !== '') {
        const q = filtrosActivos.buscar.toLowerCase().trim();
        const textoFila = [
          reg.id, reg.nombre_empresa, reg.usuario_registra, estadoTexto, formatearFecha(reg.fecha_registro)
        ].filter(Boolean).join(' ').toLowerCase();
        if (!textoFila.includes(q)) return false;
      }
      return true;
    });
  }, [empresas, filtrosActivos]);

  const totalPaginas = Math.max(1, Math.ceil(registrosFiltrados.length / ITEMS_POR_PAGINA));
  const indiceInicio = (paginaActual - 1) * ITEMS_POR_PAGINA;
  const registrosPaginados = registrosFiltrados.slice(indiceInicio, indiceInicio + ITEMS_POR_PAGINA);

  const handleAplicarFiltros = () => { setFiltrosActivos({ ...filtrosForm }); setPaginaActual(1); };
  const handleLimpiarFiltros = () => {
    const inicial = { buscar: '', estado: 'Todos', fechaIni: '', fechaFin: '' };
    setFiltrosForm(inicial); setFiltrosActivos(inicial); setPaginaActual(1);
  };

  const handleAbrirModalCrear = () => {
    setModoEdicion(false);
    setRegistroSeleccionado(null);
    setErrorModal('');
    setFormData({ nombre_empresa: '' });
    setModalOpen(true);
  };

  const handleAbrirModalEditar = (reg) => {
    setModoEdicion(true);
    setRegistroSeleccionado(reg);
    setErrorModal('');
    setFormData({
      nombre_empresa: reg.nombre_empresa || ''
    });
    setModalOpen(true);
  };

  const handleCerrarModal = () => {
    if (guardando) return;
    setModalOpen(false);
    setRegistroSeleccionado(null);
    setErrorModal('');
  };

  const handleGuardarEmpresa = async (e) => {
    e.preventDefault();
    setErrorModal('');

    const nombreLimpio = String(formData.nombre_empresa || '').trim().toUpperCase();
    if (!nombreLimpio) return setErrorModal('El nombre de la empresa es obligatorio.');

    setGuardando(true);
    const ahoraIso = new Date().toISOString();

    try {
      if (modoEdicion && registroSeleccionado) {
        await actualizarEmpresaTransporte(registroSeleccionado.id, {
          nombre_empresa: nombreLimpio,
          usuario_actualiza: nombreUsuarioSesion,
          fecha_actualiza: ahoraIso
        });
      } else {
        await crearEmpresaTransporte({
          nombre_empresa: nombreLimpio,
          usuario_registra: nombreUsuarioSesion,
          fecha_registro: ahoraIso,
          estado: 'ACTIVO',
          activo: true
        });
      }
      await cargarDatos();
      setModalOpen(false);
    } catch (error) {
      console.error("Error al guardar empresa:", error);
      setErrorModal(error?.message || 'Ocurrió un error al guardar la empresa.');
    } finally {
      setGuardando(false);
    }
  };

  const handleToggleEstado = async (reg) => {
    if (!puedeGestionar) return alert("No tienes permisos para cambiar el estado de las empresas.");
    const actualmenteActivo = esEmpresaActiva(reg);
    const nuevoEstadoBool = !actualmenteActivo;
    const nuevoEstadoTexto = nuevoEstadoBool ? 'ACTIVO' : 'INACTIVO';
    
    if (!window.confirm(`¿Está seguro que desea ${nuevoEstadoBool ? 'activar' : 'desactivar'} la empresa "${reg.nombre_empresa}"?`)) return;

    try {
      setLoading(true);
      await cambiarEstadoEmpresaTransporte(reg.id, {
        activo: nuevoEstadoBool,
        estado: nuevoEstadoTexto,
        usuario_actualiza: nombreUsuarioSesion,
        fecha_actualiza: new Date().toISOString()
      });
      await cargarDatos();
    } catch (error) {
      console.error("Error al cambiar estado:", error);
      alert("No se pudo actualizar el estado de la empresa.");
    } finally {
      setLoading(false);
    }
  };

  const handleExportarExcel = () => {
    if (!puedeExportar) return alert("No tienes permisos.");
    if (registrosFiltrados.length === 0) return alert("No hay registros.");

    const datosExcel = registrosFiltrados.map((reg, idx) => ({
      "N°": idx + 1,
      "ID Empresa": reg.id,
      "Empresa de Transporte": reg.nombre_empresa || '-',
      "Estado": esEmpresaActiva(reg) ? 'ACTIVO' : 'INACTIVO',
      "Usuario Registra": reg.usuario_registra || '-',
      "Fecha Registro": formatearFecha(reg.fecha_registro),
      "Usuario Actualiza": reg.usuario_actualiza || '-',
      "Fecha Actualiza": formatearFecha(reg.fecha_actualiza)
    }));

    const worksheet = XLSX.utils.json_to_sheet(datosExcel);
    worksheet['!cols'] = [
      { wch: 6 }, { wch: 12 }, { wch: 45 }, { wch: 14 },
      { wch: 22 }, { wch: 18 }, { wch: 22 }, { wch: 18 }
    ];

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Empresas_Transporte");
    XLSX.writeFile(workbook, `Tracking_Empresas_Transporte_${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  return (
    <div className="tracking-empresas-page">
      {loading && <Loading />}

      {/* 1. TOP SUMMARY */}
      <div className="top-summary-grid">
        <section className="hero-card">
          <span className="module-pill">LOGÍSTICA Y TRANSPORTE</span>
          <h1>Tracking de Empresas de Transporte</h1>
          <p>Gestión del padrón de empresas de transporte de carga y auditoría operativa.</p>
        </section>

        <section className="kpi-container-card">
          <div className="kpi-blue-box">
            <span className="kpi-box-title">TOTAL</span>
            <strong className="kpi-box-value">{totalEmpresasCount}</strong>
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

      {/* 2. FILTROS */}
      <section className="filters-card">
        <div className="filters-grid">
          <div className="filter-group filter-buscar">
            <label>Buscar</label>
            <input
              type="text"
              placeholder="Buscar por ID, empresa o usuario..."
              value={filtrosForm.buscar}
              onChange={(e) => setFiltrosForm({ ...filtrosForm, buscar: e.target.value })}
              onKeyDown={(e) => e.key === 'Enter' && handleAplicarFiltros()}
            />
          </div>

          <div className="filter-group">
            <label>Estado</label>
            <select
              value={filtrosForm.estado}
              onChange={(e) => setFiltrosForm({ ...filtrosForm, estado: e.target.value })}
            >
              <option value="Todos">Todos</option>
              <option value="ACTIVO">ACTIVO</option>
              <option value="INACTIVO">INACTIVO</option>
            </select>
          </div>

          <div className="filter-group mobile-hidden-filter">
            <label>Fecha Reg. Ini</label>
            <input type="date" value={filtrosForm.fechaIni} onChange={(e) => setFiltrosForm({ ...filtrosForm, fechaIni: e.target.value })} />
          </div>
          <div className="filter-group mobile-hidden-filter">
            <label>Fecha Reg. Fin</label>
            <input type="date" value={filtrosForm.fechaFin} onChange={(e) => setFiltrosForm({ ...filtrosForm, fechaFin: e.target.value })} />
          </div>
        </div>

        <div className="filters-actions-row">
          <button type="button" className="btn-action-primary" onClick={handleAbrirModalCrear}>
            <FaPlus /> <span>Registrar Empresa</span>
          </button>
          <button type="button" className="btn-action-primary" onClick={handleAplicarFiltros}>
            <FaSearch /> <span>Buscar</span>
          </button>
          <button type="button" className="btn-action-secondary" onClick={handleLimpiarFiltros}>
            <FaUndo /> <span>Limpiar</span>
          </button>
        </div>
      </section>

      {/* 3. TABLA */}
      <section className="table-section-card">
        <div className="table-topbar">
          <span className="records-counter">
            Mostrando <strong>{registrosPaginados.length}</strong> de <strong>{registrosFiltrados.length}</strong>
          </span>
          <div className="pagination-controls">
            <button type="button" className="page-nav-btn" disabled={paginaActual <= 1} onClick={() => setPaginaActual(p => p - 1)}><FaChevronLeft className="nav-chevron" /> <span>Anterior</span></button>
            <span className="pagination-text-indicator">Página {paginaActual} de {totalPaginas}</span>
            <button type="button" className="page-nav-btn" disabled={paginaActual >= totalPaginas} onClick={() => setPaginaActual(p => p + 1)}><span>Siguiente</span> <FaChevronRight className="nav-chevron" /></button>
          </div>
          <button type="button" className="btn-exportar-excel" onClick={handleExportarExcel} disabled={!puedeExportar}>
            <span className="excel-icon-box">X</span> <span>Exportar</span>
          </button>
        </div>

        <div ref={tableContainerRef} className={`table-container ${isDragging ? 'dragging' : ''}`} onMouseDown={handleMouseDown} onMouseLeave={handleMouseUpOrLeave} onMouseUp={handleMouseUpOrLeave} onMouseMove={handleMouseMove}>
          <table>
            <thead>
              <tr>
                <th style={{ width: '40px' }}>N°</th>
                <th>ID</th>
                <th style={{ textAlign: 'left' }}>Nombre Empresa</th>
                <th>Estado</th>
                <th>Usuario Reg.</th>
                <th>Fecha Reg.</th>
                <th>Usuario Act.</th>
                <th>Fecha Act.</th>
                <th style={{ textAlign: 'center' }}>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {registrosPaginados.length === 0 ? (
                <tr><td colSpan="9" style={{ textAlign: 'center', padding: '28px', color: '#64748b' }}>No se encontraron empresas de transporte.</td></tr>
              ) : (
                registrosPaginados.map((reg, index) => {
                  const numeroFila = indiceInicio + index + 1;
                  const activo = esEmpresaActiva(reg);
                  return (
                    <tr key={reg.id}>
                      <td style={{ fontWeight: 'bold', color: '#475569' }}>{numeroFila}</td>
                      <td style={{ fontWeight: '800', color: '#0f4c81' }}>{reg.id}</td>
                      <td style={{ fontWeight: '700', textAlign: 'left' }}>{reg.nombre_empresa || '-'}</td>
                      <td>
                        <span className={`badge-estado ${activo ? 'tep-estado-activo' : 'tep-estado-inactivo'}`}>
                          {activo ? 'ACTIVO' : 'INACTIVO'}
                        </span>
                      </td>
                      <td>{reg.usuario_registra || '-'}</td>
                      <td>{formatearFecha(reg.fecha_registro)}</td>
                      <td>{reg.usuario_actualiza || '-'}</td>
                      <td>{formatearFecha(reg.fecha_actualiza)}</td>
                      <td style={{ textAlign: 'center' }}>
                        <div className="acciones-cell">
                          <button type="button" className={`btn-tabla-editar ${!puedeGestionar ? 'disabled-by-role' : ''}`} onClick={() => puedeGestionar ? handleAbrirModalEditar(reg) : alert("Sin permisos")}><FaEdit /></button>
                          <button type="button" className={`btn-tabla-toggle ${activo ? 'is-active' : 'is-inactive'} ${!puedeGestionar ? 'disabled-by-role' : ''}`} onClick={() => handleToggleEstado(reg)}>
                            {activo ? <FaPowerOff /> : <FaCheck />}<span className="btn-toggle-label">{activo ? 'Desactivar' : 'Activar'}</span>
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

      {/* 4. MODAL */}
      {modalOpen && (
        <div className="tep-modal-overlay" onClick={handleCerrarModal}>
          <div className="tep-modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="tep-modal-header">
              <div className="tep-modal-title-group">
                <span className="tep-modal-icon"><FaTruck /></span>
                <div>
                  <h2>{modoEdicion ? 'Editar Empresa' : 'Registrar Empresa de Transporte'}</h2>
                  <p>{modoEdicion ? `Actualizando ID ${registroSeleccionado?.id}` : 'Complete los datos de la empresa de transporte.'}</p>
                </div>
              </div>
              <button type="button" className="tep-modal-close" onClick={handleCerrarModal}><FaTimes /></button>
            </div>

            <form onSubmit={handleGuardarEmpresa} className="tep-modal-form">
              <div className="tep-modal-body">
                {errorModal && <div className="tep-modal-error">{errorModal}</div>}
                <div className="tep-form-group">
                  <label>Nombre de la Empresa <span className="req">*</span></label>
                  <input
                    type="text"
                    placeholder="Ej: RANSA COMERCIAL S.A."
                    value={formData.nombre_empresa}
                    onChange={(e) => setFormData({ ...formData, nombre_empresa: e.target.value.toUpperCase() })}
                    required
                    autoFocus
                  />
                </div>
                <div className="tep-audit-info">
                  {modoEdicion ? (
                    <>
                      <div><span>Registrado por:</span> <strong>{registroSeleccionado?.usuario_registra || '-'}</strong></div>
                      <div><span>Se actualizará por:</span> <strong>{nombreUsuarioSesion}</strong></div>
                    </>
                  ) : (
                    <div><span>Usuario que registra:</span> <strong>{nombreUsuarioSesion}</strong></div>
                  )}
                </div>
              </div>
              <div className="tep-modal-footer">
                <button type="button" className="btn-modal-cancel" onClick={handleCerrarModal} disabled={guardando}>Cancelar</button>
                <button type="submit" className="btn-modal-save" disabled={guardando}><FaSave /><span>{guardando ? 'Guardando...' : modoEdicion ? 'Guardar Cambios' : 'Registrar Empresa'}</span></button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}