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
  FaIdCard
} from 'react-icons/fa';
import Loading from '../../layouts/Loading';
import './tracking_conductores.css';
import * as XLSX from 'xlsx';

import {
  obtenerConductores,
  obtenerEmpresasCatalogo,
  crearConductor,
  actualizarConductor,
  cambiarEstadoConductor
} from '../../services/conductoresService';

const ITEMS_POR_PAGINA = 50;

function getStoredAuthUser() {
  const raw = localStorage.getItem("authUser") || sessionStorage.getItem("authUser");
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

function TrackingConductoresContenido() {
  const [currentUser] = useState(() => getStoredAuthUser());

  const [conductores, setConductores] = useState([]);
  const [empresas, setEmpresas] = useState([]);
  const [loading, setLoading] = useState(true);

  // Nombre o identificador del usuario en sesión para auditoría
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
    empresaId: 'Todas',
    estado: 'Todos',
    fechaIni: '',
    fechaFin: ''
  });

  const [filtrosActivos, setFiltrosActivos] = useState({
    buscar: '',
    empresaId: 'Todas',
    estado: 'Todos',
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

  const [formData, setFormData] = useState({
    dni_conductor: '',
    nombre_conductor: '',
    empresa_id: ''
  });

  useEffect(() => {
    cargarDatos();
  }, []);

  const cargarDatos = async () => {
    setLoading(true);
    try {
      const [dataConductores, dataEmpresas] = await Promise.all([
        obtenerConductores(),
        obtenerEmpresasCatalogo ? obtenerEmpresasCatalogo() : Promise.resolve([])
      ]);
      setConductores(dataConductores || []);
      setEmpresas(dataEmpresas || []);
    } catch (error) {
      console.error("Error al cargar conductores:", error);
    } finally {
      setLoading(false);
    }
  };

  // Mapa rápido de empresa_id -> nombre de empresa (si existe catálogo)
  const mapaEmpresas = useMemo(() => {
    const mapa = {};
    empresas.forEach((emp) => {
      const id = emp.id ?? emp.empresa_id;
      if (id !== undefined) {
        // CAMBIADO: emp.nombre_empresa
        mapa[String(id)] = emp.nombre_empresa || `Empresa #${id}`;
      }
    });
    return mapa;
  }, [empresas]);


  const obtenerNombreEmpresa = (reg) => {
    if (reg.nombre_empresa) return reg.nombre_empresa;
    if (reg.empresa?.nombre) return reg.empresa.nombre;
    if (reg.empresa_id !== undefined && reg.empresa_id !== null) {
      return mapaEmpresas[String(reg.empresa_id)] || `ID: ${reg.empresa_id}`;
    }
    return '-';
  };

  // Normaliza el estado del conductor (soporta booleano 'activo' o string 'estado')
  const esConductorActivo = (reg) => {
    if (typeof reg.activo === 'boolean') return reg.activo;
    if (reg.estado) return String(reg.estado).toUpperCase().trim() === 'ACTIVO';
    return true; // Por defecto activo si aún no viene la columna
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

  // Lista única de empresas para el filtro
  const listaEmpresasFiltro = useMemo(() => {
    if (empresas.length > 0) {
      return empresas.map((e) => ({
        id: String(e.id ?? e.empresa_id),
        // CAMBIADO: e.nombre_empresa
        nombre: e.nombre_empresa || `Empresa #${e.id ?? e.empresa_id}`
      }));
    }
    const idsUnicos = [...new Set(conductores.map((c) => c.empresa_id).filter((v) => v !== null && v !== undefined))];
    return idsUnicos.sort((a, b) => a - b).map((id) => ({
      id: String(id),
      nombre: `Empresa ID: ${id}`
    }));
  }, [empresas, conductores]);


  // Contadores KPI
  const totalConductoresCount = conductores.length;

  const activosCount = useMemo(() => {
    return conductores.filter((c) => esConductorActivo(c)).length;
  }, [conductores]);

  const inactivosCount = useMemo(() => {
    return conductores.filter((c) => !esConductorActivo(c)).length;
  }, [conductores]);

  function formatearFecha(fecha) {
    if (!fecha) return '-';
    return new Date(fecha)
      .toLocaleString('es-PE', {
        dateStyle: 'short',
        timeStyle: 'short'
      })
      .replace(',', '');
  }

  // Filtrado de registros
  const registrosFiltrados = useMemo(() => {
    return conductores.filter((reg) => {
      const activo = esConductorActivo(reg);
      const estadoTexto = activo ? 'ACTIVO' : 'INACTIVO';

      if (filtrosActivos.empresaId !== 'Todas' && String(reg.empresa_id) !== String(filtrosActivos.empresaId)) {
        return false;
      }

      if (filtrosActivos.estado !== 'Todos' && estadoTexto !== filtrosActivos.estado) {
        return false;
      }

      if (filtrosActivos.fechaIni && reg.fecha_registro) {
        const fechaIso = String(reg.fecha_registro).slice(0, 10);
        if (fechaIso < filtrosActivos.fechaIni) return false;
      }

      if (filtrosActivos.fechaFin && reg.fecha_registro) {
        const fechaIso = String(reg.fecha_registro).slice(0, 10);
        if (fechaIso > filtrosActivos.fechaFin) return false;
      }

      if (filtrosActivos.buscar.trim() !== '') {
        const q = filtrosActivos.buscar.toLowerCase().trim();
        const textoFila = [
          reg.dni_conductor,
          reg.nombre_conductor,
          reg.empresa_id,
          obtenerNombreEmpresa(reg),
          reg.usuario_registra,
          reg.usuario_actualiza,
          estadoTexto,
          formatearFecha(reg.fecha_registro)
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();

        if (!textoFila.includes(q)) return false;
      }

      return true;
    });
  }, [conductores, filtrosActivos, mapaEmpresas]);

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
      empresaId: 'Todas',
      estado: 'Todos',
      fechaIni: '',
      fechaFin: ''
    };
    setFiltrosForm(inicial);
    setFiltrosActivos(inicial);
    setPaginaActual(1);
  };

  // =========================================
  // LÓGICA DEL MODAL (CREAR Y EDITAR)
  // =========================================
  const handleAbrirModalCrear = () => {
    setModoEdicion(false);
    setRegistroSeleccionado(null);
    setErrorModal('');
    setFormData({
      dni_conductor: '',
      nombre_conductor: '',
      empresa_id: empresas.length > 0 ? String(empresas[0].id ?? empresas[0].empresa_id) : ''
    });
    setModalOpen(true);
  };

  const handleAbrirModalEditar = (reg) => {
    setModoEdicion(true);
    setRegistroSeleccionado(reg);
    setErrorModal('');
    setFormData({
      dni_conductor: reg.dni_conductor || '',
      nombre_conductor: reg.nombre_conductor || '',
      empresa_id: reg.empresa_id !== undefined && reg.empresa_id !== null ? String(reg.empresa_id) : ''
    });
    setModalOpen(true);
  };

  const handleCerrarModal = () => {
    if (guardando) return;
    setModalOpen(false);
    setRegistroSeleccionado(null);
    setErrorModal('');
  };

  const handleGuardarConductor = async (e) => {
    e.preventDefault();
    setErrorModal('');

    const dniLimpio = String(formData.dni_conductor || '').trim();
    const nombreLimpio = String(formData.nombre_conductor || '').trim().toUpperCase();
    const empresaIdNum = parseInt(formData.empresa_id, 10);

    if (!dniLimpio) {
      return setErrorModal('El DNI del conductor es obligatorio.');
    }
    if (!nombreLimpio) {
      return setErrorModal('El nombre del conductor es obligatorio.');
    }
    if (isNaN(empresaIdNum)) {
      return setErrorModal('Debe indicar un ID de empresa válido.');
    }

    setGuardando(true);
    const ahoraIso = new Date().toISOString();

    try {
      if (modoEdicion && registroSeleccionado) {
        // ACTUALIZAR CONDUCTOR EXISTENTE
        const payloadActualizar = {
          dni_conductor: dniLimpio,
          nombre_conductor: nombreLimpio,
          empresa_id: empresaIdNum,
          usuario_actualiza: nombreUsuarioSesion,
          fecha_actualiza: ahoraIso
        };

        const idReferencia = registroSeleccionado.id ?? registroSeleccionado.dni_conductor;
        await actualizarConductor(idReferencia, payloadActualizar);
      } else {
        // CREAR NUEVO CONDUCTOR
        const payloadCrear = {
          dni_conductor: dniLimpio,
          nombre_conductor: nombreLimpio,
          empresa_id: empresaIdNum,
          usuario_registra: nombreUsuarioSesion,
          fecha_registro: ahoraIso,
          usuario_actualiza: null,
          fecha_actualiza: null,
          estado: 'ACTIVO',
          activo: true
        };

        await crearConductor(payloadCrear);
      }

      await cargarDatos();
      setModalOpen(false);
    } catch (error) {
      console.error("Error al guardar conductor:", error);
      setErrorModal(error?.message || 'Ocurrió un error al guardar el conductor.');
    } finally {
      setGuardando(false);
    }
  };

  // =========================================
  // ACTIVAR / DESACTIVAR CONDUCTOR
  // =========================================
  const handleToggleEstado = async (reg) => {
    if (!puedeGestionar) {
      return alert("No tienes permisos para activar o desactivar conductores.");
    }

    const actualmenteActivo = esConductorActivo(reg);
    const nuevoEstadoBool = !actualmenteActivo;
    const nuevoEstadoTexto = nuevoEstadoBool ? 'ACTIVO' : 'INACTIVO';
    const accionTexto = nuevoEstadoBool ? 'activar' : 'desactivar';

    const confirmar = window.confirm(
      `¿Está seguro que desea ${accionTexto} al conductor "${reg.nombre_conductor}" (DNI: ${reg.dni_conductor})?`
    );
    if (!confirmar) return;

    const ahoraIso = new Date().toISOString();
    const idReferencia = reg.id ?? reg.dni_conductor;

    try {
      setLoading(true);
      await cambiarEstadoConductor(idReferencia, {
        activo: nuevoEstadoBool,
        estado: nuevoEstadoTexto,
        usuario_actualiza: nombreUsuarioSesion,
        fecha_actualiza: ahoraIso
      });
      await cargarDatos();
    } catch (error) {
      console.error("Error al cambiar estado del conductor:", error);
      alert("No se pudo actualizar el estado del conductor.");
    } finally {
      setLoading(false);
    }
  };

  // =========================================
  // EXPORTAR A EXCEL
  // =========================================
  const handleExportarExcel = () => {
    if (!puedeExportar) {
      return alert("No tienes permisos para exportar.");
    }

    if (registrosFiltrados.length === 0) {
      return alert("No hay registros para exportar.");
    }

    const datosExcel = registrosFiltrados.map((reg, idx) => ({
      "N°": idx + 1,
      "DNI Conductor": reg.dni_conductor || '-',
      "Nombre Conductor": reg.nombre_conductor || '-',
      "Empresa ID": reg.empresa_id ?? '-',
      "Empresa": obtenerNombreEmpresa(reg),
      "Estado": esConductorActivo(reg) ? 'ACTIVO' : 'INACTIVO',
      "Usuario Registra": reg.usuario_registra || '-',
      "Fecha Registro": formatearFecha(reg.fecha_registro),
      "Usuario Actualiza": reg.usuario_actualiza || '-',
      "Fecha Actualiza": formatearFecha(reg.fecha_actualiza)
    }));

    const worksheet = XLSX.utils.json_to_sheet(datosExcel);
    worksheet['!cols'] = [
      { wch: 6 },
      { wch: 15 },
      { wch: 34 },
      { wch: 12 },
      { wch: 24 },
      { wch: 14 },
      { wch: 22 },
      { wch: 18 },
      { wch: 22 },
      { wch: 18 }
    ];

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Conductores");

    const fechaHoy = new Date().toISOString().slice(0, 10);
    XLSX.writeFile(workbook, `Tracking_Conductores_${fechaHoy}.xlsx`);
  };

  return (
    <div className="tracking-conductores-page">
      {loading && <Loading />}

      {/* 1. SECCIÓN SUPERIOR: TÍTULO + TARJETAS KPI */}
      <div className="top-summary-grid">
        <section className="hero-card">
          <span className="module-pill">GESTIÓN OPERATIVA</span>
          <h1>Tracking de Conductores</h1>
          <p>Administre el padrón de conductores, empresas asociadas, estados y trazabilidad de registros.</p>
        </section>

        <section className="kpi-container-card">
          <div className="kpi-blue-box">
            <span className="kpi-box-title">TOTAL</span>
            <strong className="kpi-box-value">{totalConductoresCount}</strong>
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
              placeholder="Buscar por DNI, nombre de conductor, empresa o usuario..."
              value={filtrosForm.buscar}
              onChange={(e) => setFiltrosForm({ ...filtrosForm, buscar: e.target.value })}
              onKeyDown={(e) => e.key === 'Enter' && handleAplicarFiltros()}
            />
          </div>

          <div className="filter-group">
            <label>Empresa</label>
            <select
              value={filtrosForm.empresaId}
              onChange={(e) => setFiltrosForm({ ...filtrosForm, empresaId: e.target.value })}
            >
              <option value="Todas">Todas</option>
              {listaEmpresasFiltro.map((emp) => (
                <option key={emp.id} value={emp.id}>
                  {emp.nombre}
                </option>
              ))}
            </select>
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
            <input
              type="date"
              value={filtrosForm.fechaIni}
              onChange={(e) => setFiltrosForm({ ...filtrosForm, fechaIni: e.target.value })}
            />
          </div>

          <div className="filter-group mobile-hidden-filter">
            <label>Fecha Reg. Fin</label>
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
            <span>Registrar</span>
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
            title={puedeExportar ? "Exportar a Excel (.xlsx)" : "Sin permisos para exportar"}
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
                <th style={{ width: '40px' }}>N°</th>
                <th>DNI Conductor</th>
                <th>Nombre Conductor</th>
                <th>Empresa</th>
                <th>Estado</th>
                <th>Usuario Registra</th>
                <th>Fecha Registro</th>
                <th>Usuario Actualiza</th>
                <th>Fecha Actualiza</th>
                <th style={{ textAlign: 'center' }}>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {registrosPaginados.length === 0 ? (
                <tr>
                  <td colSpan="10" style={{ textAlign: 'center', padding: '28px', color: '#64748b' }}>
                    No se encontraron conductores con los filtros seleccionados.
                  </td>
                </tr>
              ) : (
                registrosPaginados.map((reg, index) => {
                  const numeroFila = indiceInicio + index + 1;
                  const activo = esConductorActivo(reg);

                  return (
                    <tr key={reg.id || reg.dni_conductor || index}>
                      <td style={{ fontWeight: 'bold', color: '#475569' }}>{numeroFila}</td>
                      <td style={{ fontWeight: '800', color: '#0f4c81' }}>{reg.dni_conductor || '-'}</td>
                      <td style={{ fontWeight: '700', textAlign: 'left' }}>{reg.nombre_conductor || '-'}</td>
                      <td>
                        <span className="empresa-tag">
                          {obtenerNombreEmpresa(reg)}
                        </span>
                      </td>
                      <td>
                        <span className={`badge-estado ${activo ? 'tc-estado-activo' : 'tc-estado-inactivo'}`}>
                          {activo ? 'ACTIVO' : 'INACTIVO'}
                        </span>
                      </td>
                      <td>{reg.usuario_registra || '-'}</td>
                      <td>{formatearFecha(reg.fecha_registro)}</td>
                      <td>{reg.usuario_actualiza || '-'}</td>
                      <td>{formatearFecha(reg.fecha_actualiza)}</td>
                      <td style={{ textAlign: 'center' }}>
                        <div className="acciones-cell">
                          {/* Botón Editar */}
                          <button
                            type="button"
                            className={`btn-tabla-editar ${!puedeGestionar ? 'disabled-by-role' : ''}`}
                            onClick={() => {
                              if (!puedeGestionar) {
                                return alert("No tienes permisos para editar conductores.");
                              }
                              handleAbrirModalEditar(reg);
                            }}
                            title="Editar conductor"
                          >
                            <FaEdit />
                          </button>

                          {/* Botón Activar / Desactivar */}
                          <button
                            type="button"
                            className={`btn-tabla-toggle ${activo ? 'is-active' : 'is-inactive'} ${!puedeGestionar ? 'disabled-by-role' : ''}`}
                            onClick={() => handleToggleEstado(reg)}
                            title={activo ? "Desactivar conductor" : "Activar conductor"}
                          >
                            {activo ? <FaPowerOff /> : <FaCheck />}
                            <span className="btn-toggle-label">
                              {activo ? 'Desactivar' : 'Activar'}
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

      {/* 4. MODAL DE REGISTRO Y EDICIÓN */}
      {modalOpen && (
        <div className="tc-modal-overlay" onClick={handleCerrarModal}>
          <div className="tc-modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="tc-modal-header">
              <div className="tc-modal-title-group">
                <span className="tc-modal-icon">
                  <FaIdCard />
                </span>
                <div>
                  <h2>{modoEdicion ? 'Editar Conductor' : 'Registrar Nuevo Conductor'}</h2>
                  <p>
                    {modoEdicion
                      ? `Actualizando datos del DNI ${registroSeleccionado?.dni_conductor || ''}`
                      : 'Complete los datos para dar de alta a un conductor en el sistema.'}
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

            <form onSubmit={handleGuardarConductor} className="tc-modal-form">
              <div className="tc-modal-body">
                {errorModal && (
                  <div className="tc-modal-error">
                    {errorModal}
                  </div>
                )}

                <div className="tc-form-group">
                  <label>DNI Conductor <span className="req">*</span></label>
                  <input
                    type="text"
                    maxLength={15}
                    placeholder="Ej: 45892310"
                    value={formData.dni_conductor}
                    onChange={(e) =>
                      setFormData({ ...formData, dni_conductor: e.target.value.replace(/[^0-9a-zA-Z]/g, '') })
                    }
                    required
                    autoFocus
                  />
                </div>

                <div className="tc-form-group">
                  <label>Nombre Completo del Conductor <span className="req">*</span></label>
                  <input
                    type="text"
                    placeholder="Ej: JUAN PEREZ GOMEZ"
                    value={formData.nombre_conductor}
                    onChange={(e) =>
                      setFormData({ ...formData, nombre_conductor: e.target.value.toUpperCase() })
                    }
                    required
                  />
                </div>

                <div className="tc-form-group">
                  <label>Empresa (empresa_id) <span className="req">*</span></label>
                  {empresas.length > 0 ? (
                    <select
                      value={formData.empresa_id}
                      onChange={(e) => setFormData({ ...formData, empresa_id: e.target.value })}
                      required
                    >
                      <option value="">-- Seleccione una empresa --</option>
                      {empresas.map((emp) => {
                        const id = emp.id ?? emp.empresa_id;
                        return (
                          <option key={id} value={id}>
                            {/* CAMBIADO: emp.nombre_empresa */}
                            {emp.nombre_empresa} (ID: {id})
                          </option>
                        );
                      })}
                    </select>
                  ) : (
                    <input
                      type="number"
                      min="1"
                      placeholder="Ingrese el ID de la empresa (Ej: 1)"
                      value={formData.empresa_id}
                      onChange={(e) => setFormData({ ...formData, empresa_id: e.target.value })}
                      required
                    />
                  )}
                </div>


                {/* Resumen de Auditoría Automática */}
                <div className="tc-audit-info">
                  {modoEdicion ? (
                    <>
                      <div>
                        <span>Registrado por:</span>{' '}
                        <strong>{registroSeleccionado?.usuario_registra || '-'}</strong> ({formatearFecha(registroSeleccionado?.fecha_registro)})
                      </div>
                      <div>
                        <span>Se actualizará por:</span>{' '}
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
                  <span>{guardando ? 'Guardando...' : modoEdicion ? 'Guardar Cambios' : 'Registrar Conductor'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

// Envoltorio: los estilos de este módulo solo aplican dentro de este div
export default function TrackingConductores(props) {
  return (
    <div className="hco-scope hco-tracking-conductores">
      <TrackingConductoresContenido {...props} />
    </div>
  );
}
