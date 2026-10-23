import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  FaEdit, 
  FaCheck, 
  FaWrench,
  FaPlus, 
  FaSearch, 
  FaUndo, 
  FaChevronLeft, 
  FaChevronRight 
} from 'react-icons/fa';
import Loading from '../../layouts/Loading';
import './tracking_mhe.css';
import * as XLSX from 'xlsx';

// Importamos los servicios (agregamos habilitarEquipoMhe)
import { 
  obtenerUltimasInspecciones, 
  aprobarInspeccionMhe,
  habilitarEquipoMhe 
} from '../../services/mheService';
import { useLiveQuery } from 'dexie-react-hooks';
import { localDb } from '../../services/localDb';
import { obtenerTodosLosEmpleados } from '../../services/empleadosService';

const ITEMS_POR_PAGINA = 50;

function getStoredAuthUser() {
  const raw = localStorage.getItem("authUser") || sessionStorage.getItem("authUser");
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

export default function TrackingMHE() {
  const navigate = useNavigate();
  const [currentUser] = useState(() => getStoredAuthUser());

  const [inspecciones, setInspecciones] = useState([]);
  const [loading, setLoading] = useState(true);

  // 1. Leemos los usuarios desde Dexie
  const usuariosDb = useLiveQuery(() => localDb.usuarios.toArray(), [], []);

  useEffect(() => {
    if (usuariosDb.length === 0) {
      obtenerTodosLosEmpleados()
        .then((datos) => {
          if (datos && datos.length > 0) localDb.usuarios.bulkPut(datos);
        })
        .catch((err) => console.error("Error al sincronizar usuarios:", err));
    }
  }, [usuariosDb.length]);

  // Validamos rol del usuario
  const rolUsuario = String(
    currentUser?.rol || currentUser?.role || currentUser?.roles?.nombre || ''
  ).toLowerCase().trim();

  // Validamos el área del usuario (soporta objeto directo en authUser, Dexie o relación con áreas)
  const areaUsuario = useMemo(() => {
    const directo =
      currentUser?.area_nombre ||
      currentUser?.area?.nombre ||
      currentUser?.areas?.nombre ||
      (typeof currentUser?.area === 'string' ? currentUser.area : '');

    if (directo) return String(directo).toUpperCase().trim();

    // Respaldo buscando al usuario en Dexie
    const userLocal = usuariosDb.find((u) => String(u.id) === String(currentUser?.id));
    const desdeDexie =
      userLocal?.area_nombre ||
      userLocal?.area?.nombre ||
      userLocal?.areas?.nombre ||
      (typeof userLocal?.area === 'string' ? userLocal.area : '');

    if (desdeDexie) return String(desdeDexie).toUpperCase().trim();

    // Respaldo buscando el area_id en las inspecciones cargadas
    if (currentUser?.area_id && inspecciones.length > 0) {
      const inspConMismaArea = inspecciones.find(
        (i) => String(i.area_id) === String(currentUser.area_id)
      );
      const nombreAreaInsp = inspConMismaArea?.areas?.nombre || inspConMismaArea?.area?.nombre;
      if (nombreAreaInsp) return String(nombreAreaInsp).toUpperCase().trim();
    }

    return '';
  }, [currentUser, usuariosDb, inspecciones]);

  const puedeExportar = rolUsuario === 'superadmin' || rolUsuario === 'supervisor';

  // Roles permitidos para cada acción
  const esSuperAdminOSupervisor = rolUsuario === 'superadmin' || rolUsuario === 'supervisor';
  const esAdminSupervisorSuperAdmin = esSuperAdminOSupervisor || rolUsuario === 'admin';
  
  // Permiso exclusivo para habilitar equipos inoperativos: Área QHSE o Rol SUPERADMIN
  const puedeHabilitarEquipo = rolUsuario === 'superadmin' || areaUsuario.includes('QHSE');

  // 2. Diccionario rápido que relaciona UUID -> Nombre
  const mapaUsuarios = useMemo(() => {
    const mapa = {};
    usuariosDb.forEach((u) => {
      if (u.id) mapa[u.id] = u.nombre;
    });
    return mapa;
  }, [usuariosDb]);

  // 3. Función que devuelve el nombre del aprobador en vez del UUID
  const obtenerNombreAprobador = (insp) => {
    if (insp.aprobador?.nombre) return insp.aprobador.nombre;
    if (insp.aprobado_por_nombre) return insp.aprobado_por_nombre;
    const id = insp.aprobado_por_id || insp.aprobado_por;
    if (!id || id === '-') return '-';
    return mapaUsuarios[id] || id;
  };

  const obtenerEstadoPersonal = (estado) => {
    const est = String(estado || 'APTO').toUpperCase().trim();
    if (est === 'APTO' || est === 'OPERATIVO') return 'APTO';
    if (est === 'OBSERVADO') return 'OBSERVADO';
    if (est === 'NO APTO' || est === 'NO_APTO') return 'NO APTO';
    if (est === 'INOPERATIVO') return 'NO APTO';
    return est;
  };

  // Verifica si una inspección INOPERATIVA ya tuvo su equipo rehabilitado posteriormente
  const verificarEquipoYaHabilitado = (insp) => {
    const estMhe = String(insp.estado_mhe || '').toUpperCase().trim();
    if (estMhe !== 'INOPERATIVO') return false;

    const eq = insp.equipos;
    if (!eq) return false;

    const estadoOpActual = String(eq.estado_operativo || '').toUpperCase().trim();
    if (estadoOpActual === 'INOPERATIVO') return false;

    if (eq.fecha_habilitacion && insp.fecha_hora) {
      return new Date(eq.fecha_habilitacion).getTime() > new Date(insp.fecha_hora).getTime();
    }

    return false;
  };

  // Referencia y estados para mover la tabla con la "manito"
  const tableContainerRef = useRef(null);
  const [isDragging, setIsDragging] = useState(false);
  const dragData = useRef({ startX: 0, scrollLeft: 0 });

  const [filtrosForm, setFiltrosForm] = useState({
    categoria: 'Todos',
    estado: 'Todos',
    area: 'Todas',
    fechaIni: '',
    fechaFin: '',
    buscar: ''
  });

  const [filtrosActivos, setFiltrosActivos] = useState({
    categoria: 'Todos',
    estado: 'Todos',
    area: 'Todas',
    fechaIni: '',
    fechaFin: '',
    buscar: ''
  });

  const [paginaActual, setPaginaActual] = useState(1);

  useEffect(() => {
    cargarInspecciones();

    const handleSyncCompleted = () => {
      cargarInspecciones();
    };

    window.addEventListener('hco-sync-completed', handleSyncCompleted);
    return () => {
      window.removeEventListener('hco-sync-completed', handleSyncCompleted);
    };
  }, []);

  const cargarInspecciones = async () => {
    setLoading(true);
    try {
      const data = await obtenerUltimasInspecciones();
      setInspecciones(data || []);
    } catch (error) {
      console.error("Error al cargar PIV:", error);
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

  const listaCategorias = useMemo(() => {
    const nombres = inspecciones
      .map(i => i.equipos?.categorias_equipos?.nombre)
      .filter(Boolean);
    return [...new Set(nombres)].sort();
  }, [inspecciones]);

  const listaAreas = useMemo(() => {
    const nombres = inspecciones
      .map(i => i.areas?.nombre || i.area?.nombre)
      .filter(Boolean);
    return [...new Set(nombres)].sort();
  }, [inspecciones]);

  const misRegistrosCount = useMemo(() => {
    if (!currentUser) return 0;
    return inspecciones.filter(i => 
      (currentUser.id && i.usuario_id === currentUser.id) ||
      (currentUser.nombre && i.registrado_por_nombre === currentUser.nombre)
    ).length;
  }, [inspecciones, currentUser]);

  const porValidarCount = useMemo(() => {
    return inspecciones.filter(i => (i.estado_proceso || 'PENDIENTE') !== 'APROBADO').length;
  }, [inspecciones]);

  const inspeccionesFiltradas = useMemo(() => {
    return inspecciones.filter((insp) => {
      const nombreCategoria = insp.equipos?.categorias_equipos?.nombre || 'N/A';
      const nombreArea = insp.areas?.nombre || insp.area?.nombre || '-';
      const estadoProceso = (insp.estado_proceso || 'PENDIENTE').toUpperCase();
      const estadoMhe = (insp.estado_mhe || '').toUpperCase();
      const serieEquipo = insp.equipos?.serie || '';
      const operador = insp.registrado_por_nombre || '';

      if (filtrosActivos.categoria !== 'Todos' && nombreCategoria !== filtrosActivos.categoria) {
        return false;
      }

      if (filtrosActivos.estado !== 'Todos') {
        if (!estadoProceso.includes(filtrosActivos.estado) && estadoMhe !== filtrosActivos.estado) {
          return false;
        }
      }

      if (filtrosActivos.area !== 'Todas' && nombreArea !== filtrosActivos.area) {
        return false;
      }

      if (filtrosActivos.fechaIni && insp.fecha_hora) {
        const fechaRegistro = new Date(insp.fecha_hora).toISOString().split('T')[0];
        if (fechaRegistro < filtrosActivos.fechaIni) return false;
      }

      if (filtrosActivos.fechaFin && insp.fecha_hora) {
        const fechaRegistro = new Date(insp.fecha_hora).toISOString().split('T')[0];
        if (fechaRegistro > filtrosActivos.fechaFin) return false;
      }

      if (filtrosActivos.buscar.trim() !== '') {
        const q = filtrosActivos.buscar.toLowerCase().trim();
        const textoFila = [
          serieEquipo,
          operador,
          nombreArea,
          nombreCategoria,
          estadoProceso,
          estadoMhe,
          insp.estado_personal || 'OPERATIVO',
          formatearFecha(insp.fecha_hora)
        ].join(' ').toLowerCase();

        if (!textoFila.includes(q)) return false;
      }

      return true;
    });
  }, [inspecciones, filtrosActivos]);

  const totalPaginas = Math.max(1, Math.ceil(inspeccionesFiltradas.length / ITEMS_POR_PAGINA));
  const indiceInicio = (paginaActual - 1) * ITEMS_POR_PAGINA;
  const inspeccionesPaginadas = inspeccionesFiltradas.slice(indiceInicio, indiceInicio + ITEMS_POR_PAGINA);

  const handleAplicarFiltros = () => {
    setFiltrosActivos({ ...filtrosForm });
    setPaginaActual(1);
  };

  const handleLimpiarFiltros = () => {
    const inicial = {
      categoria: 'Todos',
      estado: 'Todos',
      area: 'Todas',
      fechaIni: '',
      fechaFin: '',
      buscar: ''
    };
    setFiltrosForm(inicial);
    setFiltrosActivos(inicial);
    setPaginaActual(1);
  };

  const getBadgeClass = (estado) => {
    if (!estado) return '';
    const est = estado.toUpperCase();
    if (est === 'OPERATIVO' || est === 'APROBADO') return 'operativo';
    if (est.includes('ENVÍO') || est.includes('ENVIO')) return 'pendiente-envio';
    if (est === 'OBSERVADO' || est.includes('PENDIENTE')) return 'observado';
    return 'inoperativo';
  };

  function formatearFecha(fecha) {
    if (!fecha) return '-';
    return new Date(fecha)
      .toLocaleString('es-PE', {
        dateStyle: 'short',
        timeStyle: 'short'
      })
      .replace(',', '');
  }

  const handleEditar = (insp) => {
    navigate(`/mhe/mhe_evaluar?id=${insp.id}`, { state: { inspeccion: insp } });
  };

  const handleAprobar = async (insp) => {
    if (insp.estado_proceso === 'APROBADO') {
      return alert("Esta inspección ya se encuentra aprobada.");
    }
    const confirmar = window.confirm(`¿Desea aprobar la inspección del equipo ${insp.equipos?.serie || ''}?`);
    if (!confirmar) return;

    try {
      setLoading(true);
      await aprobarInspeccionMhe(insp.id, currentUser?.id || null);
      await cargarInspecciones();
    } catch (error) {
      alert("Error al aprobar: " + error.message);
    } finally {
      setLoading(false);
    }
  };

  // NUEVA ACCIÓN: Habilitar equipo que salió INOPERATIVO sin modificar la tabla inspecciones
  const handleHabilitarEquipo = async (insp) => {
    const equipoId = insp.equipo_id || insp.equipos?.id;
    const serie = insp.equipos?.serie || 'seleccionado';

    if (!equipoId) {
      return alert("No se encontró el ID del equipo para habilitar.");
    }

    const confirmar = window.confirm(
      `¿Confirma que el equipo ${serie} ya se encuentra OPERATIVO?\n\nEsto no modificará este registro histórico, pero permitirá que los operadores puedan realizar nuevas inspecciones al equipo.`
    );
    if (!confirmar) return;

    try {
      setLoading(true);
      await habilitarEquipoMhe(equipoId, currentUser?.id || null);
      alert(`El equipo ${serie} ha sido habilitado como OPERATIVO para nuevas inspecciones.`);
      await cargarInspecciones();
    } catch (error) {
      alert("Error al habilitar el equipo: " + error.message);
    } finally {
      setLoading(false);
    }
  };

  const handleExportarExcel = () => {
    if (!puedeExportar) {
      return alert("No tienes permisos para exportar. Solo Superadmin y Supervisor pueden realizar esta acción.");
    }

    if (inspeccionesFiltradas.length === 0) {
      return alert("No hay registros para exportar.");
    }

    const datosExcel = inspeccionesFiltradas.map((insp, idx) => ({
      "N°": idx + 1,
      "Fecha y Hora": formatearFecha(insp.fecha_hora),
      "Área": insp.areas?.nombre || insp.area?.nombre || '-',
      "Estado Proceso": insp.estado_proceso || 'PENDIENTE DE REVISIÓN',
      "Categoría Equipo": insp.equipos?.categorias_equipos?.nombre || 'N/A',
      "Equipo (Serie)": insp.equipos?.serie || 'N/A',
      "Estado MHE": insp.estado_mhe || '-',
      "Estado Personal": obtenerEstadoPersonal(insp.estado_personal),
      "Registrado Por": insp.registrado_por_nombre || '-',
      "Aprobado Por": obtenerNombreAprobador(insp) || '-',
      "Revisado El": formatearFecha(insp.revisado_el)
    }));

    const worksheet = XLSX.utils.json_to_sheet(datosExcel);

    worksheet['!cols'] = [
      { wch: 6 },
      { wch: 20 },
      { wch: 18 },
      { wch: 22 },
      { wch: 22 },
      { wch: 18 },
      { wch: 15 },
      { wch: 16 },
      { wch: 28 },
      { wch: 28 },
      { wch: 20 }
    ];

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Tracking MHE");

    const fechaHoy = new Date().toISOString().slice(0, 10);
    XLSX.writeFile(workbook, `Tracking_MHE_${fechaHoy}.xlsx`);
  };

  return (
    <div className="tracking-mhe-page">
      {loading && <Loading />}

      {/* 1. SECCIÓN SUPERIOR: TÍTULO + TARJETAS KPI */}
      <div className="top-summary-grid">
        <section className="hero-card">
          <span className="module-pill">MÓDULO OPERATIVO</span>
          <h1>Tracking MHE</h1>
          <p>Consulte, filtre, exporte y gestione las inspecciones diarias de equipos de manipulación.</p>
        </section>

        <section className="kpi-container-card">
          <div className="kpi-blue-box">
            <span className="kpi-box-title">MIS INSPECCIONES</span>
            <strong className="kpi-box-value">{misRegistrosCount}</strong>
          </div>
          <div className="kpi-blue-box">
            <span className="kpi-box-title">POR VALIDAR (MHE)</span>
            <strong className="kpi-box-value">{porValidarCount}</strong>
          </div>
        </section>
      </div>

      {/* 2. SECCIÓN MEDIA: FILTROS Y BOTONES DE ACCIÓN */}
      <section className="filters-card">
        <div className="filters-grid">
          <div className="filter-group filter-buscar">
            <label>Buscar</label>
            <input
              type="text"
              placeholder="Buscar serie, operador, área, categoría, estado..."
              value={filtrosForm.buscar}
              onChange={(e) => setFiltrosForm({ ...filtrosForm, buscar: e.target.value })}
              onKeyDown={(e) => e.key === 'Enter' && handleAplicarFiltros()}
            />
          </div>

          <div className="filter-group">
            <label>Categoría</label>
            <select
              value={filtrosForm.categoria}
              onChange={(e) => setFiltrosForm({ ...filtrosForm, categoria: e.target.value })}
            >
              <option value="Todos">Todos</option>
              {listaCategorias.map((cat) => (
                <option key={cat} value={cat}>{cat}</option>
              ))}
            </select>
          </div>

          <div className="filter-group">
            <label>Estado MHE</label>
            <select
              value={filtrosForm.estado}
              onChange={(e) => setFiltrosForm({ ...filtrosForm, estado: e.target.value })}
            >
              <option value="Todos">Todos</option>
              <option value="PENDIENTE DE ENVÍO">PENDIENTE DE ENVÍO</option>
              <option value="PENDIENTE DE REVISIÓN">PENDIENTE DE REVISIÓN</option>
              <option value="APROBADO">APROBADO</option>
              <option value="OPERATIVO">OPERATIVO</option>
              <option value="OBSERVADO">OBSERVADO</option>
              <option value="INOPERATIVO">INOPERATIVO</option>
            </select>
          </div>

          <div className="filter-group">
            <label>Área</label>
            <select
              value={filtrosForm.area}
              onChange={(e) => setFiltrosForm({ ...filtrosForm, area: e.target.value })}
            >
              <option value="Todas">Todas</option>
              {listaAreas.map((ar) => (
                <option key={ar} value={ar}>{ar}</option>
              ))}
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
            onClick={() => navigate('/mhe/mhe_evaluar')}
          >
            <FaPlus />
            <span>Evaluar</span>
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

      {/* 3. SECCIÓN INFERIOR: PAGINACIÓN, EXPORTAR Y TABLA */}
      <section className="table-section-card">
        <div className="table-topbar">
          <div className="pagination-bar">
            <span className="records-counter">
              Mostrando <strong>{inspeccionesPaginadas.length}</strong> registros de <strong>{inspeccionesFiltradas.length}</strong>
            </span>

            <div className="pagination-controls">
              <button
                type="button"
                className="page-nav-btn"
                disabled={paginaActual <= 1}
                onClick={() => setPaginaActual((prev) => Math.max(1, prev - 1))}
              >
                <span>Anterior</span>
                <FaChevronLeft className="nav-chevron" />
              </button>

              <button
                type="button"
                className="page-nav-btn"
                disabled={paginaActual >= totalPaginas}
                onClick={() => setPaginaActual((prev) => Math.min(totalPaginas, prev + 1))}
              >
                <FaChevronRight className="nav-chevron" />
                <span>Siguiente</span>
              </button>
            </div>
          </div>

          <button
            type="button"
            className="btn-exportar-excel"
            onClick={handleExportarExcel}
            disabled={!puedeExportar}
            title={
              puedeExportar
                ? "Exportar a Excel (.xlsx)"
                : "Solo habilitado para Superadmin y Supervisor"
            }
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
                <th style={{ textAlign: 'center', width: '40px' }}>N°</th>
                <th>Fecha y Hora</th>
                <th>Área</th>
                <th>Estado Proceso</th>
                <th>Categoría Equipo</th>
                <th>Equipo (Serie)</th>
                <th>Estado MHE</th>
                <th>Estado Personal</th>
                <th>Registrado Por</th>
                <th>Aprobado Por</th>
                <th>Revisado El</th>
                <th style={{ textAlign: 'center' }}>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {inspeccionesPaginadas.length === 0 ? (
                <tr>
                  <td colSpan="12" style={{ textAlign: 'center', padding: '28px', color: '#64748b' }}>
                    No se encontraron inspecciones con los filtros seleccionados.
                  </td>
                </tr>
              ) : (
                inspeccionesPaginadas.map((insp, index) => {
                  const yaAprobado = insp.estado_proceso === 'APROBADO';
                  const esFilaInoperativa = String(insp.estado_mhe || '').toUpperCase().trim() === 'INOPERATIVO';
                  const equipoYaFueHabilitado = verificarEquipoYaHabilitado(insp);
                  const numeroFila = indiceInicio + index + 1;

                  return (
                    <tr key={insp.id}>
                      <td style={{ textAlign: 'center', fontWeight: 'bold', color: '#475569' }}>
                        {numeroFila}
                      </td>

                      <td>{formatearFecha(insp.fecha_hora)}</td>

                      <td>{insp.areas?.nombre || insp.area?.nombre || '-'}</td>

                      <td>
                        <span className={`badge-estado ${getBadgeClass(insp.estado_proceso || 'PENDIENTE')}`}>
                          {insp.estado_proceso || 'PENDIENTE'}
                        </span>
                      </td>

                      <td>{insp.equipos?.categorias_equipos?.nombre || 'N/A'}</td>

                      <td style={{ fontWeight: '800', color: '#0f172a' }}>
                        {insp.equipos?.serie || 'N/A'}
                      </td>

                      <td>
                        <span className={`badge-estado ${getBadgeClass(insp.estado_mhe)}`}>
                          {insp.estado_mhe}
                        </span>
                      </td>

                      <td>
                        {(() => {
                          const estadoTexto = obtenerEstadoPersonal(insp.estado_personal);
                          const esApto = estadoTexto === 'APTO';
                          const esObservado = estadoTexto === 'OBSERVADO';
                          
                          let clasePill = 'no-apto';
                          if (esApto) clasePill = 'apto';
                          else if (esObservado) clasePill = 'observado';

                          return (
                            <span className={`estado-personal-pill ${clasePill}`}>
                              {estadoTexto}
                            </span>
                          );
                        })()}
                      </td>

                      <td>{insp.registrado_por_nombre || '-'}</td>

                      <td>{obtenerNombreAprobador(insp)}</td>

                      <td>{formatearFecha(insp.revisado_el)}</td>

                      {/* 11. Acciones */}
                      <td style={{ textAlign: 'center' }}>
                        <div className="acciones-cell">
                          {/* Botón Editar */}
                          <button
                            type="button"
                            className={`btn-tabla-editar ${!esSuperAdminOSupervisor ? 'disabled-by-role' : ''}`}
                            onClick={() => {
                              if (!esSuperAdminOSupervisor) {
                                return alert("No tienes permisos para editar. Solo Supervisor y Superadmin.");
                              }
                              handleEditar(insp);
                            }}
                            title={
                              esSuperAdminOSupervisor
                                ? "Editar inspección"
                                : "No autorizado: Solo Supervisor y Superadmin pueden editar"
                            }
                          >
                            <FaEdit />
                          </button>

                          {/* Botón Aprobar */}
                          <button
                            type="button"
                            className={`btn-tabla-aprobar ${yaAprobado ? 'is-approved' : ''} ${!esAdminSupervisorSuperAdmin ? 'disabled-by-role' : ''}`}
                            onClick={() => {
                              if (!esAdminSupervisorSuperAdmin) {
                                return alert("No tienes permisos para aprobar. Solo Admin, Supervisor y Superadmin.");
                              }
                              handleAprobar(insp);
                            }}
                            disabled={yaAprobado}
                            title={
                              yaAprobado
                                ? "Inspección aprobada"
                                : esAdminSupervisorSuperAdmin
                                ? "Aprobar inspección"
                                : "No autorizado: Solo Admin, Supervisor y Superadmin pueden aprobar"
                            }
                          >
                            <FaCheck />
                          </button>

                          {/* SE MUESTRA ÚNICAMENTE SI EL EQUIPO SIGUE INOPERATIVO Y NO HA SIDO HABILITADO */}
                          {esFilaInoperativa && !equipoYaFueHabilitado && (
                            <button
                              type="button"
                              className={`btn-tabla-habilitar ${!puedeHabilitarEquipo ? 'disabled-by-role' : ''}`}
                              onClick={() => {
                                if (!puedeHabilitarEquipo) {
                                  return alert("No tienes permisos para pasar el equipo a Operativo. Acción exclusiva para el área QHSE y rol Superadmin.");
                                }
                                handleHabilitarEquipo(insp);
                              }}
                              title={
                                puedeHabilitarEquipo
                                  ? "Habilitar equipo (Pasar a Operativo)"
                                  : "No autorizado: Exclusivo para área QHSE y Superadmin"
                              }
                            >
                              <FaWrench />
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
    </div>
  );
}
