import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  FaEdit,
  FaPlus,
  FaSearch,
  FaUndo,
  FaChevronLeft,
  FaChevronRight,
  FaChartBar, FaBullseye
} from 'react-icons/fa';
import Loading from '../../layouts/Loading';
import './trackingCuadroQ.css';
import * as XLSX from 'xlsx';

import {
  obtenerRegistrosCuadroQ,
  obtenerCatalogosCuadroQ
} from '../../services/cuadroQService';

const ITEMS_POR_PAGINA = 50;

function getStoredAuthUser() {
  const raw = localStorage.getItem("authUser") || sessionStorage.getItem("authUser");
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

export default function TrackingCuadroQ() {
  const navigate = useNavigate();
  const [currentUser] = useState(() => getStoredAuthUser());

  const [registros, setRegistros] = useState([]);
  const [areasActivas, setAreasActivas] = useState([]);
  const [loading, setLoading] = useState(true);

  const rolUsuario = String(
    currentUser?.rol || currentUser?.role || currentUser?.roles?.nombre || ''
  ).toLowerCase().trim();

  const puedeExportar =
    rolUsuario === 'superadmin' || rolUsuario === 'supervisor' || rolUsuario === 'admin';

  // Permiso para entrar al modo Análisis / Edición
  const puedeAnalizar =
    rolUsuario === 'superadmin' || rolUsuario === 'supervisor' || rolUsuario === 'admin';

  const tableContainerRef = useRef(null);
  const [isDragging, setIsDragging] = useState(false);
  const dragData = useRef({ startX: 0, scrollLeft: 0 });

  const [filtrosForm, setFiltrosForm] = useState({
    areaError: 'Todas',
    estado: 'Todos',
    impacto: 'Todos',
     fechaIni: '',
    fechaFin: '',
    buscar: ''
  });

  const [filtrosActivos, setFiltrosActivos] = useState({
    areaError: 'Todas',
    estado: 'Todos',
    impacto: 'Todos',
    fechaIni: '',
    fechaFin: '',
    buscar: ''
  });

  const [paginaActual, setPaginaActual] = useState(1);

  useEffect(() => {
    cargarDatos();
  }, []);

  const cargarDatos = async () => {
    setLoading(true);
    try {
      const [dataReg, catalogos] = await Promise.all([
        obtenerRegistrosCuadroQ(),
        obtenerCatalogosCuadroQ()
      ]);
      setRegistros(dataReg || []);
      setAreasActivas(catalogos.areasError || []);
    } catch (error) {
      console.error("Error al cargar Cuadro Q:", error);
    } finally {
      setLoading(false);
    }
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

  const listaAreasFiltro = useMemo(() => {
    const deCatalogo = areasActivas.map((a) => a.nombre);
    const deRegistros = registros.map((r) => r.area_error).filter(Boolean);
    return [...new Set([...deCatalogo, ...deRegistros])].sort();
  }, [areasActivas, registros]);

  // Contadores KPI
  const misRegistrosCount = useMemo(() => {
    if (!currentUser) return 0;
    return registros.filter(
      (r) =>
        (currentUser.id && r.registrador_id === currentUser.id) ||
        (currentUser.nombre && r.nombre_registrador === currentUser.nombre)
    ).length;
  }, [registros, currentUser]);

  const pendientesCount = useMemo(() => {
    return registros.filter((r) => (r.estado || 'PENDIENTE') === 'PENDIENTE').length;
  }, [registros]);

  const concluidosCount = useMemo(() => {
    return registros.filter((r) => r.estado === 'CONCLUIDO').length;
  }, [registros]);


function formatearFecha(fecha) {
    if (!fecha) return '-';
    return new Date(fecha)
    .toLocaleString('es-PE', {
        dateStyle: 'short',
        timeStyle: 'short'
    })
    .replace(',', '');
}

function formatearSoloFecha(fechaStr) {
    if (!fechaStr) return "-";
    const soloFecha = String(fechaStr).slice(0, 10);
    const partes = soloFecha.split('-');
    if (partes.length !== 3) return fechaStr;
    const [anio, mes, dia] = partes;
    return `${dia}/${mes}/${anio}`;
}

const registrosFiltrados = useMemo(() => {
    return registros.filter((reg) => {
      const estadoReg = (reg.estado || 'PENDIENTE').toUpperCase();
      const areaErr = reg.area_error || '';
      const impactoReg = (reg.impacto || '').toUpperCase();

      if (filtrosActivos.areaError !== 'Todas' && areaErr !== filtrosActivos.areaError) {
        return false;
      }

      if (filtrosActivos.estado !== 'Todos' && estadoReg !== filtrosActivos.estado) {
        return false;
      }

      if (filtrosActivos.impacto !== 'Todos' && impactoReg !== filtrosActivos.impacto) {
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
          reg.id_cuadro_q,
          reg.nombre_registrador,
          reg.area_registrador,
          reg.area_error,
          reg.proceso,
          reg.error,
          reg.descripcion_error,
          reg.estado,
          reg.responsabilidad,
          reg.impacto,
          reg.pdca,
          reg.evaluacion,
          reg.responsable,
          reg.causa_raiz,
          reg.medida,
          formatearFecha(reg.fecha_registro)
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();

        if (!textoFila.includes(q)) return false;
      }

      return true;
    });
  }, [registros, filtrosActivos]);

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
      areaError: 'Todas',
      estado: 'Todos',
      impacto: 'Todos',
      fechaIni: '',
      fechaFin: '',
      buscar: ''
    };
    setFiltrosForm(inicial);
    setFiltrosActivos(inicial);
    setPaginaActual(1);
  };

  // Nuevos colores para la columna Estado
  const getEstadoBadgeClass = (estado) => {
    const est = String(estado || 'PENDIENTE').toUpperCase().trim();
    
    if (est === 'CONCLUIDO') return 'cq-estado-concluido';
    if (est === 'PENDIENTE') return 'cq-estado-pendiente';
    if (est === 'CANCELADO') return 'cq-estado-cancelado';
    if (est === 'EN PROCESO') return 'cq-estado-proceso';
    if (est === 'ATRAZADO' || est === 'ATRASADO') return 'cq-estado-atrasado';
    
    return 'cq-estado-default';
  };


  const getImpactoPillClass = (impacto) => {
    const imp = String(impacto || '').toUpperCase();
    if (imp === 'ALTO') return 'no-apto';
    if (imp === 'MEDIO') return 'observado';
    if (imp === 'BAJO') return 'apto';
    return '';
  };

  const handleEditarAnalisis = (reg) => {
    navigate(`/cuadro_q/Registro-cuadroQ?id=${reg.id}`, { state: { registro: reg } });

  };

  const handleExportarExcel = () => {
    if (!puedeExportar) {
      return alert("No tienes permisos para exportar.");
    }

    if (registrosFiltrados.length === 0) {
      return alert("No hay registros para exportar.");
    }

    const datosExcel = registrosFiltrados.map((reg, idx) => ({
      "N°": idx + 1,
      "ID Cuadro Q": reg.id_cuadro_q || '-',
      "Fecha Registro": formatearFecha(reg.fecha_registro),
      "Nombre Registrador": reg.nombre_registrador || '-',
      "Área Registrador": reg.area_registrador || '-',
      "Área Error": reg.area_error || '-',
      "Proceso": reg.proceso || '-',
      "Error": reg.error || '-',
      "Descripción Error": reg.descripcion_error || '-',
      "Estado": reg.estado || 'PENDIENTE',
      "Responsabilidad": reg.responsabilidad || '-',
      "Impacto": reg.impacto || '-',
      "PDCA": reg.pdca || '-',
      "Evaluación": reg.evaluacion || '-',
      "Motivo Cancelación": reg.motivo_cancelacion || '-',
      "Responsable (White)": reg.responsable || '-',
      "Fecha Planificada": formatearSoloFecha(reg.fecha_planificada),
      "Causa Raíz": reg.causa_raiz || '-',
      "Medida": reg.medida || '-',
      "Fecha Cierre": formatearFecha(reg.fecha_cierre),
      "Última Actualización": formatearFecha(reg.fecha_hora_actualiza),
      "Actualizado Por": reg.usuario_actualiza || '-'
    }));

    const worksheet = XLSX.utils.json_to_sheet(datosExcel);
    worksheet['!cols'] = [
      { wch: 5 },
      { wch: 14 },
      { wch: 18 },
      { wch: 26 },
      { wch: 18 },
      { wch: 18 },
      { wch: 22 },
      { wch: 34 },
      { wch: 40 },
      { wch: 14 },
      { wch: 15 },
      { wch: 12 },
      { wch: 12 },
      { wch: 14 },
      { wch: 30 },
      { wch: 26 },
      { wch: 16 },
      { wch: 35 },
      { wch: 35 },
      { wch: 18 },
      { wch: 18 },
      { wch: 24 }
    ];

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Cuadro Q");

    const fechaHoy = new Date().toISOString().slice(0, 10);
    XLSX.writeFile(workbook, `Tracking_Cuadro_Q_${fechaHoy}.xlsx`);
  };

  return (
    <div className="tracking-page">
      {loading && <Loading />}

      {/* 1. SECCIÓN SUPERIOR: TÍTULO + TARJETAS KPI */}
      <div className="top-summary-grid">
        <section className="hero-card">
          <span className="module-pill">EXCELENCIA OPERATIVA</span>
          <h1>Tracking Cuadro Q</h1>
          <p>Registre, analice causas raíz y dé seguimiento a las incidencias operativas por área.</p>
        </section>

        <section className="kpi-container-card">
          <div className="kpi-blue-box">
            <span className="kpi-box-title">MIS REGISTROS</span>
            <strong className="kpi-box-value">{misRegistrosCount}</strong>
          </div>
          <div className="kpi-blue-box">
            <span className="kpi-box-title">PENDIENTES</span>
            <strong className="kpi-box-value">{pendientesCount}</strong>
          </div>
          <div className="kpi-blue-box">
            <span className="kpi-box-title">CONCLUIDOS</span>
            <strong className="kpi-box-value">{concluidosCount}</strong>
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
              placeholder="Buscar E-1, registrador, proceso, error, responsable..."
              value={filtrosForm.buscar}
              onChange={(e) => setFiltrosForm({ ...filtrosForm, buscar: e.target.value })}
              onKeyDown={(e) => e.key === 'Enter' && handleAplicarFiltros()}
            />
          </div>

          <div className="filter-group">
            <label>Área Error</label>
            <select
              value={filtrosForm.areaError}
              onChange={(e) => setFiltrosForm({ ...filtrosForm, areaError: e.target.value })}
            >
              <option value="Todas">Todas</option>
              {listaAreasFiltro.map((ar) => (
                <option key={ar} value={ar}>{ar}</option>
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
              <option value="PENDIENTE">PENDIENTE</option>
              <option value="CONCLUIDO">CONCLUIDO</option>
              <option value="CANCELADO">CANCELADO</option>
            </select>
          </div>

          {/* Le agregamos la clase mobile-hidden-filter al div */}
          <div className="filter-group mobile-hidden-filter">
            <label>Impacto</label>
            <select
              value={filtrosForm.impacto}
              onChange={(e) => setFiltrosForm({ ...filtrosForm, impacto: e.target.value })}
            >
              <option value="Todos">Todos</option>
              <option value="ALTO">ALTO</option>
              <option value="MEDIO">MEDIO</option>
              <option value="BAJO">BAJO</option>
            </select>
          </div>


          <div className="filter-group mobile-hidden-filter">
            <label>Fecha ini</label>
            <input
              type="date"
              value={filtrosForm.fechaIni}
              onChange={(e) => setFiltrosForm({ ...filtrosForm, fechaIni: e.target.value })}
            />
          </div>

          <div className="filter-group mobile-hidden-filter">
            <label>Fecha fin</label>
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
            onClick={() => navigate('/cuadro_q/Registro-cuadroQ')}
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

        <button
            type="button"
            className="btn-action-primary btn-graficos"
            onClick={() => navigate('/cuadro_q/pizarraCuadroQ')}
        >
            <FaChartBar />
            <span>Ver Gráficos</span>
        </button>

        <button
            type="button"
            className="btn-action-primary btn-radar"
            onClick={() => navigate('/cuadro_q/radarCuadroQ')}
        >
            <FaBullseye />
            <span>Radar</span>
        </button>
        </div>



      </section>

      {/* 3. SECCIÓN INFERIOR: TABLA Y PAGINACIÓN */}
      <section className="table-section-card">
        <div className="table-topbar">
          <div className="pagination-bar">
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
                <th>ID Cuadro Q</th>
                <th>Fecha Registro</th>
                <th>Estado</th>
                <th>Registrado Por</th>
                <th>Área Reg.</th>
                <th>Área Error</th>
                <th>Proceso</th>
                <th>Error</th>
                <th>Descripción</th>                
                <th>F. Planificada</th>
             
                <th style={{ textAlign: 'center' }}>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {registrosPaginados.length === 0 ? (
                <tr>
                  <td colSpan="21" style={{ textAlign: 'center', padding: '28px', color: '#64748b' }}>
                    No se encontraron registros en Cuadro Q con los filtros seleccionados.
                  </td>
                </tr>
              ) : (
                registrosPaginados.map((reg, index) => {
                  const numeroFila = indiceInicio + index + 1;
                  return (
                    <tr key={reg.id}>
                      <td style={{ fontWeight: 'bold', color: '#475569' }}>{numeroFila}</td>
                      <td style={{ fontWeight: '800', color: '#0f4c81' }}>{reg.id_cuadro_q || '-'}</td>
                      <td>{formatearFecha(reg.fecha_registro)}</td>
                      <td>
                        <span className={`badge-estado ${getEstadoBadgeClass(reg.estado)}`}>
                          {reg.estado || 'PENDIENTE'}
                        </span>
                      </td>
                      <td>{reg.nombre_registrador || '-'}</td>
                      <td>{reg.area_registrador || '-'}</td>
                      <td style={{ fontWeight: '700' }}>{reg.area_error || '-'}</td>
                      <td>{reg.proceso || '-'}</td>
                      <td className="td-truncate" title={reg.error}>{reg.error || '-'}</td>
                      <td className="td-truncate" title={reg.descripcion_error}>{reg.descripcion_error || '-'}</td>
                      <td>{formatearSoloFecha(reg.fecha_planificada)}</td>
                      <td style={{ textAlign: 'center' }}>
                        <div className="acciones-cell">
                          <button
                            type="button"
                            className={`btn-tabla-editar ${!puedeAnalizar ? 'disabled-by-role' : ''}`}
                            onClick={() => {
                              if (!puedeAnalizar) {
                                return alert("No tienes permisos para realizar el análisis/edición.");
                              }
                              handleEditarAnalisis(reg);
                            }}
                            title={
                              puedeAnalizar
                                ? "Analizar / Editar Cuadro Q"
                                : "Sin permisos de edición"
                            }
                          >
                            <FaEdit />
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
    </div>
  );
}

