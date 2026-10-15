import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  FaEdit, 
  FaCheck, 
  FaPlus, 
  FaSearch, 
  FaUndo, 
  FaChevronLeft, 
  FaChevronRight 
} from 'react-icons/fa';
import Loading from '../../layouts/Loading';
import './tracking_mhe.css';
import * as XLSX from 'xlsx';

// Importamos los servicios
import { obtenerUltimasInspecciones, aprobarInspeccionMhe } from '../../services/mheService';
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

  // Validamos si el rol del usuario es superadmin o supervisor
  const rolUsuario = String(
    currentUser?.rol || currentUser?.role || currentUser?.roles?.nombre || ''
  ).toLowerCase().trim();

  const puedeExportar = rolUsuario === 'superadmin' || rolUsuario === 'supervisor';

  const [inspecciones, setInspecciones] = useState([]);
  const [loading, setLoading] = useState(true);

  // 1. Leemos los usuarios desde Dexie
  const usuariosDb = useLiveQuery(() => localDb.usuarios.toArray(), [], []);

  // Si aún no hay usuarios en Dexie, los descargamos en segundo plano
  useEffect(() => {
    if (usuariosDb.length === 0) {
      obtenerTodosLosEmpleados()
        .then((datos) => {
          if (datos && datos.length > 0) localDb.usuarios.bulkPut(datos);
        })
        .catch((err) => console.error("Error al sincronizar usuarios:", err));
    }
  }, [usuariosDb.length]);

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

  // Devuelve el estado personal correcto y mapea antiguos valores de BD si fuera necesario
  const obtenerEstadoPersonal = (estado) => {
    const est = String(estado || 'APTO').toUpperCase().trim();
    if (est === 'APTO' || est === 'OPERATIVO') return 'APTO';
    if (est === 'OBSERVADO') return 'OBSERVADO';
    if (est === 'NO APTO' || est === 'NO_APTO') return 'NO APTO';
    if (est === 'INOPERATIVO') return 'NO APTO';
    return est;
  };


  // Referencia y estados para mover la tabla con la "manito" (drag to scroll)
  const tableContainerRef = useRef(null);
  const [isDragging, setIsDragging] = useState(false);
  const dragData = useRef({ startX: 0, scrollLeft: 0 });

  // Estados de los inputs de filtro
  const [filtrosForm, setFiltrosForm] = useState({
    categoria: 'Todos',
    estado: 'Todos',
    area: 'Todas',
    fechaIni: '',
    fechaFin: '',
    buscar: ''
  });

  // Estado de filtros aplicados
  const [filtrosActivos, setFiltrosActivos] = useState({
    categoria: 'Todos',
    estado: 'Todos',
    area: 'Todas',
    fechaIni: '',
    fechaFin: '',
    buscar: ''
  });

  // Paginación
  const [paginaActual, setPaginaActual] = useState(1);

  useEffect(() => {
    cargarInspecciones();
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

  // Funciones para arrastrar la tabla con el mouse (manito)
  const handleMouseDown = (e) => {
    // Evita arrastrar si el usuario hace clic sobre un botón de acción
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
    const walk = (x - dragData.current.startX) * 1.4; // Velocidad de arrastre
    container.scrollLeft = dragData.current.scrollLeft - walk;
  };

  // Listas dinámicas para los desplegables de Categoría y Área
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

  // Contadores para las tarjetas superiores derechas
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

  // Filtrado de datos de la tabla
  const inspeccionesFiltradas = useMemo(() => {
    return inspecciones.filter((insp) => {
      const nombreCategoria = insp.equipos?.categorias_equipos?.nombre || 'N/A';
      const nombreArea = insp.areas?.nombre || insp.area?.nombre || '-';
      const estadoProceso = (insp.estado_proceso || 'PENDIENTE').toUpperCase();
      const estadoMhe = (insp.estado_mhe || '').toUpperCase();
      const serieEquipo = insp.equipos?.serie || '';
      const operador = insp.registrado_por_nombre || '';

      // 1. Filtro Categoría
      if (filtrosActivos.categoria !== 'Todos' && nombreCategoria !== filtrosActivos.categoria) {
        return false;
      }

      // 2. Filtro Estado
      if (filtrosActivos.estado !== 'Todos') {
        if (!estadoProceso.includes(filtrosActivos.estado) && estadoMhe !== filtrosActivos.estado) {
          return false;
        }
      }

      // 3. Filtro Área
      if (filtrosActivos.area !== 'Todas' && nombreArea !== filtrosActivos.area) {
        return false;
      }

      // 4. Filtro Fecha Inicio
      if (filtrosActivos.fechaIni && insp.fecha_hora) {
        const fechaRegistro = new Date(insp.fecha_hora).toISOString().split('T')[0];
        if (fechaRegistro < filtrosActivos.fechaIni) return false;
      }

      // 5. Filtro Fecha Fin
      if (filtrosActivos.fechaFin && insp.fecha_hora) {
        const fechaRegistro = new Date(insp.fecha_hora).toISOString().split('T')[0];
        if (fechaRegistro > filtrosActivos.fechaFin) return false;
      }

      // 6. Buscador general en toda la tabla
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

  // Cálculo de paginación
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
    if (est === 'OBSERVADO' || est === 'PENDIENTE') return 'observado';
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

// Exportar a archivo Excel (.xlsx) real
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
      "Estado Proceso": insp.estado_proceso || 'PENDIENTE',
      "Categoría Equipo": insp.equipos?.categorias_equipos?.nombre || 'N/A',
      "Equipo (Serie)": insp.equipos?.serie || 'N/A',
      "Estado MHE": insp.estado_mhe || '-',
      "Estado Personal": insp.estado_personal || 'OPERATIVO',
      "Aprobado Por": obtenerNombreAprobador(insp) || '-',
      "Aprobado Por": insp.aprobador?.nombre || insp.aprobado_por_nombre || insp.aprobado_por_id || '-',
      "Revisado El": formatearFecha(insp.revisado_el)
    }));

    // Creamos la hoja de Excel a partir del JSON
    const worksheet = XLSX.utils.json_to_sheet(datosExcel);

    // Ajustamos el ancho de cada columna para que se lea limpio al abrir el Excel
    worksheet['!cols'] = [
      { wch: 6 },  // N°
      { wch: 20 }, // Fecha y Hora
      { wch: 18 }, // Área
      { wch: 22 }, // Estado Proceso
      { wch: 22 }, // Categoría Equipo
      { wch: 18 }, // Equipo (Serie)
      { wch: 15 }, // Estado MHE
      { wch: 16 }, // Estado Personal
      { wch: 28 }, // Registrado Por
      { wch: 28 }, // Aprobado Por
      { wch: 20 }  // Revisado El
    ];

    // Creamos el libro y descargamos el archivo .xlsx
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Tracking MHE");

    const fechaHoy = new Date().toISOString().slice(0, 10);
    XLSX.writeFile(workbook, `Tracking_MHE_${fechaHoy}.xlsx`);
  };

  return (
    <div className="tracking-page">
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
              <option value="PENDIENTE">PENDIENTE</option>
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

        {/* CONTENEDOR CON ARRASTRE DE MANITO Y SIN BARRA DE SCROLL */}
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
                  const numeroFila = indiceInicio + index + 1;

                  return (
                    <tr key={insp.id}>
                      {/* 0. N° Correlativo */}
                      <td style={{ textAlign: 'center', fontWeight: 'bold', color: '#475569' }}>
                        {numeroFila}
                      </td>

                      {/* 1. Fecha y Hora */}
                      <td>{formatearFecha(insp.fecha_hora)}</td>

                      {/* 2. Área */}
                      <td>{insp.areas?.nombre || insp.area?.nombre || '-'}</td>

                      {/* 3. Estado Proceso */}
                      <td>
                        <span className={`badge-estado ${getBadgeClass(insp.estado_proceso || 'PENDIENTE')}`}>
                          {insp.estado_proceso || 'PENDIENTE'}
                        </span>
                      </td>

                      {/* 4. Categoría Equipo */}
                      <td>{insp.equipos?.categorias_equipos?.nombre || 'N/A'}</td>

                      {/* 5. Equipo (Serie) */}
                      <td style={{ fontWeight: '800', color: '#0f172a' }}>
                        {insp.equipos?.serie || 'N/A'}
                      </td>

                      {/* 6. Estado MHE */}
                      <td>
                        <span className={`badge-estado ${getBadgeClass(insp.estado_mhe)}`}>
                          {insp.estado_mhe}
                        </span>
                      </td>

                      {/* 7. Estado Personal */}
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


                      {/* 8. Registrado Por */}
                      <td>{insp.registrado_por_nombre || '-'}</td>

                      {/* 9. Aprobado Por */}
                      <td>{obtenerNombreAprobador(insp)}</td>

                      {/* 10. Revisado El */}
                      <td>{formatearFecha(insp.revisado_el)}</td>

                      {/* 11. Acciones (Solo Iconos) */}
                      <td style={{ textAlign: 'center' }}>
                        <div className="acciones-cell">
                          <button
                            type="button"
                            className="btn-tabla-editar"
                            onClick={() => handleEditar(insp)}
                            title="Editar inspección"
                          >
                            <FaEdit />
                          </button>

                          <button
                            type="button"
                            className={`btn-tabla-aprobar ${yaAprobado ? 'is-approved' : ''}`}
                            onClick={() => handleAprobar(insp)}
                            disabled={yaAprobado}
                            title={yaAprobado ? "Inspección aprobada" : "Aprobar inspección"}
                          >
                            <FaCheck />
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