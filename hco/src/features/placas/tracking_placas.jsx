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
import Loading from '../../layouts/Loading'; // Ajusta la ruta a tu Loading
import './tracking_placas.css';
import * as XLSX from 'xlsx';

import {
  obtenerPlacas,
  obtenerEmpresasCatalogo,
  crearPlaca,
  actualizarPlaca,
  cambiarEstadoPlaca
} from '../../services/placasService'; // Asegúrate de la ruta correcta

const ITEMS_POR_PAGINA = 50;

function getStoredAuthUser() {
  const raw = localStorage.getItem("authUser") || sessionStorage.getItem("authUser");
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

export default function TrackingPlacas() {
  const [currentUser] = useState(() => getStoredAuthUser());

  const [placas, setPlacas] = useState([]);
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

  const puedeExportar =
    rolUsuario === 'superadmin' || rolUsuario === 'supervisor' || rolUsuario === 'admin' || !rolUsuario;

  const puedeGestionar =
    rolUsuario === 'superadmin' || rolUsuario === 'supervisor' || rolUsuario === 'admin' || !rolUsuario;

  const tableContainerRef = useRef(null);
  const [isDragging, setIsDragging] = useState(false);
  const dragData = useRef({ startX: 0, scrollLeft: 0 });

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

  const [modalOpen, setModalOpen] = useState(false);
  const [modoEdicion, setModoEdicion] = useState(false);
  const [registroSeleccionado, setRegistroSeleccionado] = useState(null);
  const [guardando, setGuardando] = useState(false);
  const [errorModal, setErrorModal] = useState('');

  const [formData, setFormData] = useState({
    nro_placa: '',
    empresa_id: '',
    volumen_m3: ''
  });

  useEffect(() => {
    cargarDatos();
  }, []);

  const cargarDatos = async () => {
    setLoading(true);
    try {
      const [dataPlacas, dataEmpresas] = await Promise.all([
        obtenerPlacas(),
        obtenerEmpresasCatalogo ? obtenerEmpresasCatalogo() : Promise.resolve([])
      ]);
      setPlacas(dataPlacas || []);
      setEmpresas(dataEmpresas || []);
    } catch (error) {
      console.error("Error al cargar placas:", error);
    } finally {
      setLoading(false);
    }
  };

  const mapaEmpresas = useMemo(() => {
    const mapa = {};
    empresas.forEach((emp) => {
      const id = emp.id ?? emp.empresa_id;
      if (id !== undefined) {
        mapa[String(id)] = emp.nombre_empresa || `Empresa #${id}`;
      }
    });
    return mapa;
  }, [empresas]);

  const obtenerNombreEmpresa = (reg) => {
    if (reg.nombre_empresa) return reg.nombre_empresa;
    if (reg.empresa?.nombre_empresa) return reg.empresa.nombre_empresa;
    if (reg.empresa_id !== undefined && reg.empresa_id !== null) {
      return mapaEmpresas[String(reg.empresa_id)] || `ID: ${reg.empresa_id}`;
    }
    return '-';
  };

  const esPlacaActiva = (reg) => {
    if (typeof reg.activo === 'boolean') return reg.activo;
    if (reg.estado) return String(reg.estado).toUpperCase().trim() === 'ACTIVO';
    return true; 
  };

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

  const listaEmpresasFiltro = useMemo(() => {
    if (empresas.length > 0) {
      return empresas.map((e) => ({
        id: String(e.id ?? e.empresa_id),
        nombre: e.nombre_empresa || `Empresa #${e.id ?? e.empresa_id}`
      }));
    }
    const idsUnicos = [...new Set(placas.map((c) => c.empresa_id).filter((v) => v !== null && v !== undefined))];
    return idsUnicos.sort((a, b) => a - b).map((id) => ({
      id: String(id),
      nombre: `Empresa ID: ${id}`
    }));
  }, [empresas, placas]);

  const totalPlacasCount = placas.length;

  const activasCount = useMemo(() => {
    return placas.filter((c) => esPlacaActiva(c)).length;
  }, [placas]);

  const inactivasCount = useMemo(() => {
    return placas.filter((c) => !esPlacaActiva(c)).length;
  }, [placas]);

  function formatearFecha(fecha) {
    if (!fecha) return '-';
    return new Date(fecha)
      .toLocaleString('es-PE', {
        dateStyle: 'short',
        timeStyle: 'short'
      })
      .replace(',', '');
  }

  const registrosFiltrados = useMemo(() => {
    return placas.filter((reg) => {
      const activo = esPlacaActiva(reg);
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
          reg.nro_placa,
          reg.volumen_m3,
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
  }, [placas, filtrosActivos, mapaEmpresas]);

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

  const handleAbrirModalCrear = () => {
    setModoEdicion(false);
    setRegistroSeleccionado(null);
    setErrorModal('');
    setFormData({
      nro_placa: '',
      volumen_m3: '',
      empresa_id: empresas.length > 0 ? String(empresas[0].id ?? empresas[0].empresa_id) : ''
    });
    setModalOpen(true);
  };

  const handleAbrirModalEditar = (reg) => {
    setModoEdicion(true);
    setRegistroSeleccionado(reg);
    setErrorModal('');
    setFormData({
      nro_placa: reg.nro_placa || '',
      volumen_m3: reg.volumen_m3 || '',
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

  const handleGuardarPlaca = async (e) => {
    e.preventDefault();
    setErrorModal('');

    const placaLimpia = String(formData.nro_placa || '').trim().toUpperCase().replace(/[^A-Z0-9-]/g, '');
    const volumenNum = parseFloat(formData.volumen_m3);
    const empresaIdNum = parseInt(formData.empresa_id, 10);

    if (!placaLimpia) return setErrorModal('El número de placa es obligatorio.');
    if (isNaN(volumenNum) || volumenNum <= 0) return setErrorModal('Debe indicar un volumen m³ válido mayor a 0.');
    if (isNaN(empresaIdNum)) return setErrorModal('Debe indicar un ID de empresa válido.');

    setGuardando(true);
    const ahoraIso = new Date().toISOString();

    try {
      if (modoEdicion && registroSeleccionado) {
        const payloadActualizar = {
          nro_placa: placaLimpia,
          volumen_m3: volumenNum,
          empresa_id: empresaIdNum,
          usuario_actualiza: nombreUsuarioSesion,
          fecha_actualiza: ahoraIso
        };

        const idReferencia = registroSeleccionado.id ?? registroSeleccionado.nro_placa;
        await actualizarPlaca(idReferencia, payloadActualizar);
      } else {
        const payloadCrear = {
          nro_placa: placaLimpia,
          volumen_m3: volumenNum,
          empresa_id: empresaIdNum,
          usuario_registra: nombreUsuarioSesion,
          fecha_registro: ahoraIso,
          usuario_actualiza: null,
          fecha_actualiza: null,
          estado: 'ACTIVO',
          activo: true
        };

        await crearPlaca(payloadCrear);
      }

      await cargarDatos();
      setModalOpen(false);
    } catch (error) {
      console.error("Error al guardar placa:", error);
      setErrorModal(error?.message || 'Ocurrió un error al guardar la placa.');
    } finally {
      setGuardando(false);
    }
  };

  const handleToggleEstado = async (reg) => {
    if (!puedeGestionar) return alert("No tienes permisos para activar o desactivar placas.");

    const actualmenteActivo = esPlacaActiva(reg);
    const nuevoEstadoBool = !actualmenteActivo;
    const nuevoEstadoTexto = nuevoEstadoBool ? 'ACTIVO' : 'INACTIVO';
    const accionTexto = nuevoEstadoBool ? 'activar' : 'desactivar';

    const confirmar = window.confirm(
      `¿Está seguro que desea ${accionTexto} la placa "${reg.nro_placa}"?`
    );
    if (!confirmar) return;

    const ahoraIso = new Date().toISOString();
    const idReferencia = reg.id ?? reg.nro_placa;

    try {
      setLoading(true);
      await cambiarEstadoPlaca(idReferencia, {
        activo: nuevoEstadoBool,
        estado: nuevoEstadoTexto,
        usuario_actualiza: nombreUsuarioSesion,
        fecha_actualiza: ahoraIso
      });
      await cargarDatos();
    } catch (error) {
      console.error("Error al cambiar estado de la placa:", error);
      alert("No se pudo actualizar el estado de la placa.");
    } finally {
      setLoading(false);
    }
  };

  const handleExportarExcel = () => {
    if (!puedeExportar) return alert("No tienes permisos para exportar.");
    if (registrosFiltrados.length === 0) return alert("No hay registros para exportar.");

    const datosExcel = registrosFiltrados.map((reg, idx) => ({
      "N°": idx + 1,
      "Nro Placa": reg.nro_placa || '-',
      "Volumen m³": reg.volumen_m3 ?? 0,
      "Empresa ID": reg.empresa_id ?? '-',
      "Empresa": obtenerNombreEmpresa(reg),
      "Estado": esPlacaActiva(reg) ? 'ACTIVO' : 'INACTIVO',
      "Usuario Registra": reg.usuario_registra || '-',
      "Fecha Registro": formatearFecha(reg.fecha_registro),
      "Usuario Actualiza": reg.usuario_actualiza || '-',
      "Fecha Actualiza": formatearFecha(reg.fecha_actualiza)
    }));

    const worksheet = XLSX.utils.json_to_sheet(datosExcel);
    worksheet['!cols'] = [
      { wch: 6 }, { wch: 14 }, { wch: 14 }, { wch: 12 }, { wch: 24 },
      { wch: 14 }, { wch: 22 }, { wch: 18 }, { wch: 22 }, { wch: 18 }
    ];

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Placas");

    const fechaHoy = new Date().toISOString().slice(0, 10);
    XLSX.writeFile(workbook, `Tracking_Placas_${fechaHoy}.xlsx`);
  };

  return (
    <div className="tracking-placas-page">
      {loading && <Loading />}

      {/* 1. SECCIÓN SUPERIOR: TÍTULO + TARJETAS KPI */}
      <div className="top-summary-grid">
        <section className="hero-card">
          <span className="module-pill">GESTIÓN OPERATIVA</span>
          <h1>Tracking de Placas (Vehículos)</h1>
          <p>Administre el padrón de vehículos, volúmenes de carga y trazabilidad de registros.</p>
        </section>

        <section className="kpi-container-card">
          <div className="kpi-blue-box">
            <span className="kpi-box-title">TOTAL PLACAS</span>
            <strong className="kpi-box-value">{totalPlacasCount}</strong>
          </div>
          <div className="kpi-blue-box">
            <span className="kpi-box-title">ACTIVAS</span>
            <strong className="kpi-box-value">{activasCount}</strong>
          </div>
          <div className="kpi-blue-box">
            <span className="kpi-box-title">INACTIVAS</span>
            <strong className="kpi-box-value">{inactivasCount}</strong>
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
              placeholder="Buscar por nro placa, volumen, empresa..."
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
          <button type="button" className="btn-action-primary" onClick={handleAbrirModalCrear}>
            <FaPlus /> <span>Registrar Placa</span>
          </button>
          <button type="button" className="btn-action-primary" onClick={handleAplicarFiltros}>
            <FaSearch /> <span>Buscar</span>
          </button>
          <button type="button" className="btn-action-secondary" onClick={handleLimpiarFiltros}>
            <FaUndo /> <span>Limpiar</span>
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
              <FaChevronLeft className="nav-chevron" /> <span>Anterior</span>
            </button>
            <span className="pagination-text-indicator">Página {paginaActual} de {totalPaginas}</span>
            <button
              type="button"
              className="page-nav-btn"
              disabled={paginaActual >= totalPaginas}
              onClick={() => setPaginaActual((prev) => Math.min(totalPaginas, prev + 1))}
            >
              <span>Siguiente</span> <FaChevronRight className="nav-chevron" />
            </button>
          </div>

          <button
            type="button"
            className="btn-exportar-excel"
            onClick={handleExportarExcel}
            disabled={!puedeExportar}
          >
            <span className="excel-icon-box">X</span> <span>Exportar</span>
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
                <th>Nro Placa</th>
                <th>Volumen (m³)</th>
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
                    No se encontraron placas vehiculares con los filtros seleccionados.
                  </td>
                </tr>
              ) : (
                registrosPaginados.map((reg, index) => {
                  const numeroFila = indiceInicio + index + 1;
                  const activo = esPlacaActiva(reg);

                  return (
                    <tr key={reg.id || reg.nro_placa || index}>
                      <td style={{ fontWeight: 'bold', color: '#475569' }}>{numeroFila}</td>
                      <td style={{ fontWeight: '800', color: '#0f4c81' }}>{reg.nro_placa || '-'}</td>
                      <td style={{ fontWeight: '700' }}>
                        {reg.volumen_m3 ? `${Number(reg.volumen_m3).toFixed(2)} m³` : '-'}
                      </td>
                      <td><span className="empresa-tag">{obtenerNombreEmpresa(reg)}</span></td>
                      <td>
                        <span className={`badge-estado ${activo ? 'tp-estado-activo' : 'tp-estado-inactivo'}`}>
                          {activo ? 'ACTIVO' : 'INACTIVO'}
                        </span>
                      </td>
                      <td>{reg.usuario_registra || '-'}</td>
                      <td>{formatearFecha(reg.fecha_registro)}</td>
                      <td>{reg.usuario_actualiza || '-'}</td>
                      <td>{formatearFecha(reg.fecha_actualiza)}</td>
                      <td style={{ textAlign: 'center' }}>
                        <div className="acciones-cell">
                          <button
                            type="button"
                            className={`btn-tabla-editar ${!puedeGestionar ? 'disabled-by-role' : ''}`}
                            onClick={() => puedeGestionar ? handleAbrirModalEditar(reg) : alert("No tienes permisos")}
                            title="Editar placa"
                          >
                            <FaEdit />
                          </button>
                          <button
                            type="button"
                            className={`btn-tabla-toggle ${activo ? 'is-active' : 'is-inactive'} ${!puedeGestionar ? 'disabled-by-role' : ''}`}
                            onClick={() => handleToggleEstado(reg)}
                            title={activo ? "Desactivar placa" : "Activar placa"}
                          >
                            {activo ? <FaPowerOff /> : <FaCheck />}
                            <span className="btn-toggle-label">{activo ? 'Desactivar' : 'Activar'}</span>
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
        <div className="tp-modal-overlay" onClick={handleCerrarModal}>
          <div className="tp-modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="tp-modal-header">
              <div className="tp-modal-title-group">
                <span className="tp-modal-icon"><FaTruck /></span>
                <div>
                  <h2>{modoEdicion ? 'Editar Placa' : 'Registrar Nueva Placa'}</h2>
                  <p>{modoEdicion ? `Actualizando datos de la placa ${registroSeleccionado?.nro_placa || ''}` : 'Complete los datos del vehículo.'}</p>
                </div>
              </div>
              <button type="button" className="tp-modal-close" onClick={handleCerrarModal}><FaTimes /></button>
            </div>

            <form onSubmit={handleGuardarPlaca} className="tp-modal-form">
              <div className="tp-modal-body">
                {errorModal && <div className="tp-modal-error">{errorModal}</div>}

                <div className="tp-form-group">
                  <label>Número de Placa <span className="req">*</span></label>
                  <input
                    type="text"
                    maxLength={10}
                    placeholder="Ej: A1B-234"
                    value={formData.nro_placa}
                    onChange={(e) => setFormData({ ...formData, nro_placa: e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, '') })}
                    required
                    autoFocus
                  />
                </div>

                <div className="tp-form-group">
                  <label>Volumen (m³) <span className="req">*</span></label>
                  <input
                    type="number"
                    step="0.01"
                    min="0.1"
                    placeholder="Ej: 45.5"
                    value={formData.volumen_m3}
                    onChange={(e) => setFormData({ ...formData, volumen_m3: e.target.value })}
                    required
                  />
                </div>

                <div className="tp-form-group">
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
                            {emp.nombre_empresa} (ID: {id})
                          </option>
                        );
                      })}
                    </select>
                  ) : (
                    <input
                      type="number"
                      min="1"
                      placeholder="Ingrese el ID de la empresa"
                      value={formData.empresa_id}
                      onChange={(e) => setFormData({ ...formData, empresa_id: e.target.value })}
                      required
                    />
                  )}
                </div>

                <div className="tp-audit-info">
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

              <div className="tp-modal-footer">
                <button type="button" className="btn-modal-cancel" onClick={handleCerrarModal} disabled={guardando}>Cancelar</button>
                <button type="submit" className="btn-modal-save" disabled={guardando}>
                  <FaSave /><span>{guardando ? 'Guardando...' : modoEdicion ? 'Guardar Cambios' : 'Registrar Placa'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
