import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  FaEdit,
  FaEye,
  FaPlus,
  FaSearch,
  FaUndo,
  FaChevronLeft,
  FaChevronRight
} from 'react-icons/fa';
import * as XLSX from 'xlsx';
import { useLiveQuery } from 'dexie-react-hooks';

// Cambia los "../" por "../../"
import Loading from '../../layouts/Loading';
import { localDb } from '../../services/localDb';
import {
  obtenerSugerencias,
  obtenerCatalogosSugerencias,
  obtenerFechaCortaLima
} from '../../services/sugerenciasService';
import './trackingSugerencias.css';


const ITEMS_POR_PAGINA = 40;

function getStoredAuthUser() {
  const raw = localStorage.getItem('authUser') || sessionStorage.getItem('authUser');
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

const normalizar = (txt) =>
  String(txt || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();

export default function TrackingSugerencias() {
  const navigate = useNavigate();
  const [currentUser] = useState(() => getStoredAuthUser());
  const [loading, setLoading] = useState(true);

  // Lectura reactiva instantánea desde Dexie (Offline-first)
  const sugerenciasLocal = useLiveQuery(() => localDb.tarjetas_sugerencias.toArray(), [], []);
  const areasLocal = useLiveQuery(() => localDb.areas.toArray(), [], []);

  // Rol y permisos
  const rolUsuario = normalizar(
    currentUser?.rol || currentUser?.role || currentUser?.roles?.nombre || ''
  );
  const puedeEditarAnalisis =
    rolUsuario === 'superadmin' ||
    rolUsuario === 'supervisor' ||
    rolUsuario === 'admin';
  const puedeExportar =
    rolUsuario === 'superadmin' ||
    rolUsuario === 'supervisor' ||
    rolUsuario === 'admin';

  // Estados de filtros
  const [filtrosForm, setFiltrosForm] = useState({
    buscar: '',
    estado: 'Todos',
    area: 'Todas',
    responsable: 'Todos',
    fechaIni: '',
    fechaFin: ''
  });

  const [filtrosActivos, setFiltrosActivos] = useState({
    buscar: '',
    estado: 'Todos',
    area: 'Todas',
    responsable: 'Todos',
    fechaIni: '',
    fechaFin: ''
  });

  const [paginaActual, setPaginaActual] = useState(1);

  // Drag-to-scroll con el mouse
  const tableContainerRef = useRef(null);
  const [isDragging, setIsDragging] = useState(false);
  const dragData = useRef({ startX: 0, scrollLeft: 0 });

  useEffect(() => {
    if (!currentUser) {
      navigate('/');
      return;
    }
    cargarTodo();

    const handleOnlineSync = () => cargarTodo(false);
    window.addEventListener('online', handleOnlineSync);
    window.addEventListener('hco-sync-completed', handleOnlineSync);
    return () => {
      window.removeEventListener('online', handleOnlineSync);
      window.removeEventListener('hco-sync-completed', handleOnlineSync);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const cargarTodo = async (mostrarLoader = true) => {
    if (mostrarLoader && sugerenciasLocal.length === 0) setLoading(true);
    try {
      await Promise.all([
        obtenerSugerencias(),
        obtenerCatalogosSugerencias()
      ]);
    } catch (err) {
      console.error('Error cargando sugerencias:', err);
    } finally {
      setLoading(false);
    }
  };

  // Determina el estado visual real (detecta si está ATRASADO o PENDIENTE DE ENVÍO)
  const obtenerEstadoVisual = (item) => {
    if (item._sincronizado === false || String(item.id).startsWith('local_')) {
      return 'PENDIENTE DE ENVÍO';
    }
    const estadoBase = item.estado || 'Por Validar';
    const hoyLima = obtenerFechaCortaLima();

    if (
      estadoBase === 'Priorizado' &&
      item.fecha_plan &&
      String(item.fecha_plan).slice(0, 10) < hoyLima
    ) {
      return 'Atrasado';
    }
    return estadoBase;
  };

  const getStatusClass = (estadoVisual) => {
    const s = normalizar(estadoVisual);
    if (s.includes('envio')) return 'pendiente-envio';
    if (s === 'por validar') return 'por-validar';
    if (s === 'priorizado') return 'priorizado';
    if (s === 'concluido') return 'concluido';
    if (s === 'futuro') return 'futuro';
    if (s === 'atrasado') return 'atrasado';
    if (s === 'cancelado') return 'cancelado';
    return 'por-validar';
  };

  // Ordenamos sugerencias de la más reciente a la más antigua
  const sugerenciasOrdenadas = useMemo(() => {
    return [...sugerenciasLocal].sort((a, b) => {
      const fA = a.fecha_registro ? new Date(a.fecha_registro).getTime() : 0;
      const fB = b.fecha_registro ? new Date(b.fecha_registro).getTime() : 0;
      return fB - fA;
    });
  }, [sugerenciasLocal]);

  // Listas dinámicas para los selects de filtros
  const listaAreasFiltro = useMemo(() => {
    const deCatalogo = areasLocal.map(a => a.nombre).filter(Boolean);
    const deRegistros = sugerenciasOrdenadas.map(s => s.area_registro).filter(Boolean);
    return [...new Set([...deCatalogo, ...deRegistros])].sort();
  }, [areasLocal, sugerenciasOrdenadas]);

  const listaResponsablesFiltro = useMemo(() => {
    const nombres = sugerenciasOrdenadas
      .map(s => s.nombre_responsable)
      .filter(Boolean);
    return [...new Set(nombres)].sort();
  }, [sugerenciasOrdenadas]);

  // KPIs superiores
  const asignadasAMiCount = useMemo(() => {
    if (!currentUser) return 0;
    const miNombre = normalizar(currentUser.nombre);
    return sugerenciasOrdenadas.filter(s => {
      const est = normalizar(s.estado);
      if (est === 'concluido' || est === 'cancelado') return false;
      return (
        (currentUser.id && (s.responsable_id === currentUser.id || s.responsable_apoyo_id === currentUser.id)) ||
        (miNombre && (normalizar(s.nombre_responsable) === miNombre || normalizar(s.responsable_apoyo) === miNombre))
      );
    }).length;
  }, [sugerenciasOrdenadas, currentUser]);

  const misSugerenciasCount = useMemo(() => {
    if (!currentUser) return 0;
    const miNombre = normalizar(currentUser.nombre);
    return sugerenciasOrdenadas.filter(s =>
      (currentUser.id && s.usuario_registro_id === currentUser.id) ||
      (miNombre && normalizar(s.usuario_registro) === miNombre)
    ).length;
  }, [sugerenciasOrdenadas, currentUser]);

  const porValidarCount = useMemo(() => {
    return sugerenciasOrdenadas.filter(s => normalizar(s.estado || 'Por Validar') === 'por validar').length;
  }, [sugerenciasOrdenadas]);

  // Filtrado principal
  const sugerenciasFiltradas = useMemo(() => {
    return sugerenciasOrdenadas.filter((item) => {
      const estadoVis = obtenerEstadoVisual(item);

      if (filtrosActivos.estado !== 'Todos') {
        if (
          normalizar(estadoVis) !== normalizar(filtrosActivos.estado) &&
          normalizar(item.estado) !== normalizar(filtrosActivos.estado)
        ) {
          return false;
        }
      }

      if (filtrosActivos.area !== 'Todas') {
        if (normalizar(item.area_registro) !== normalizar(filtrosActivos.area)) {
          return false;
        }
      }

      if (filtrosActivos.responsable !== 'Todos') {
        if (normalizar(item.nombre_responsable) !== normalizar(filtrosActivos.responsable)) {
          return false;
        }
      }

      if (filtrosActivos.fechaIni && item.fecha_registro) {
        const fechaReg = String(item.fecha_registro).slice(0, 10);
        if (fechaReg < filtrosActivos.fechaIni) return false;
      }

      if (filtrosActivos.fechaFin && item.fecha_registro) {
        const fechaReg = String(item.fecha_registro).slice(0, 10);
        if (fechaReg > filtrosActivos.fechaFin) return false;
      }

      if (filtrosActivos.buscar.trim() !== '') {
        const q = normalizar(filtrosActivos.buscar);
        const textoFila = normalizar([
          item.id_sugerencia,
          estadoVis,
          item.usuario_registro,
          item.area_registro,
          item.proceso,
          item.area_responsable,
          item.nombre_responsable,
          item.descripcion_sugerencia,
          ...(Array.isArray(item.categorias) ? item.categorias : []),
          ...(Array.isArray(item.fuentes) ? item.fuentes : [])
        ].join(' '));

        if (!textoFila.includes(q)) return false;
      }

      return true;
    });
  }, [sugerenciasOrdenadas, filtrosActivos]);

  const totalPaginas = Math.max(1, Math.ceil(sugerenciasFiltradas.length / ITEMS_POR_PAGINA));
  const indiceInicio = (paginaActual - 1) * ITEMS_POR_PAGINA;
  const sugerenciasPaginadas = sugerenciasFiltradas.slice(indiceInicio, indiceInicio + ITEMS_POR_PAGINA);

  const handleAplicarFiltros = () => {
    setFiltrosActivos({ ...filtrosForm });
    setPaginaActual(1);
  };

  const handleLimpiarFiltros = () => {
    const limpio = {
      buscar: '',
      estado: 'Todos',
      area: 'Todas',
      responsable: 'Todos',
      fechaIni: '',
      fechaFin: ''
    };
    setFiltrosForm(limpio);
    setFiltrosActivos(limpio);
    setPaginaActual(1);
  };

  const formatearFechaHora = (valor) => {
    if (!valor) return '-';
    const str = String(valor).replace('T', ' ').slice(0, 16);
    const partes = str.split(' ');
    const f = partes[0]?.split('-');
    if (f && f.length === 3) {
      return `${f[2]}/${f[1]}/${f[0]}${partes[1] ? ' ' + partes[1] : ''}`;
    }
    return str;
  };

  const formatearFechaCorta = (valor) => {
    if (!valor) return '-';
    const f = String(valor).slice(0, 10).split('-');
    if (f.length === 3) return `${f[2]}/${f[1]}/${f[0]}`;
    return valor;
  };

  // Eventos de arrastre de tabla
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

  // Exportar a Excel (.xlsx)
  const handleExportarExcel = () => {
    if (!puedeExportar) {
      return alert('No tienes permisos para exportar.');
    }
    if (sugerenciasFiltradas.length === 0) {
      return alert('No hay registros para exportar.');
    }

    const datosExcel = sugerenciasFiltradas.map((item, idx) => ({
      'N°': idx + 1,
      'ID Sugerencia': item.id_sugerencia || 'PENDIENTE',
      'Estado': obtenerEstadoVisual(item),
      'Fecha Registro': formatearFechaHora(item.fecha_registro),
      'Creado Por': item.usuario_registro || '-',
      'Área Solicitante': item.area_registro || '-',
      'Proceso': item.proceso || '-',
      'Categorías': Array.isArray(item.categorias) ? item.categorias.join(', ') : '',
      'Fuentes': Array.isArray(item.fuentes) ? item.fuentes.join(', ') : '',
      'Equipo Involucrado': Array.isArray(item.equipo_nombres) ? item.equipo_nombres.join(', ') : '',
      'Descripción': item.descripcion_sugerencia || '',
      'Beneficios': item.beneficios_sugerencia || '',
      'Área Responsable': item.area_responsable || '-',
      'Responsable Cierre': item.nombre_responsable || '-',
      'Responsable Apoyo': item.responsable_apoyo || '-',
      'Fecha Planificada': formatearFechaCorta(item.fecha_plan),
      'Impacto': Array.isArray(item.impacto) ? item.impacto.join(', ') : '',
      'Reconocido': Array.isArray(item.reconocido) ? item.reconocido.join(', ') : '',
      'Plan de Acción': item.plan_accion || '',
      'Fecha Cierre': formatearFechaCorta(item.fecha_cierre),
      'Comentario Adicional': item.comentario_adicional || '',
      'Fecha Cancelación': formatearFechaCorta(item.fecha_cancelacion),
      'Motivo Cancelación': item.comentario_cancelacion || '',
      'Última Actualización': formatearFechaHora(item.fechahora_actualiza),
      'Actualizado Por': item.usuario_actualiza || '-'
    }));

    const worksheet = XLSX.utils.json_to_sheet(datosExcel);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Sugerencias');

    const fechaHoy = obtenerFechaCortaLima();
    XLSX.writeFile(workbook, `Tracking_Sugerencias_${fechaHoy}.xlsx`);
  };

  return (
    <div className="tracking-sugerencias-page">
      {loading && <Loading />}

      {/* 1. SECCIÓN SUPERIOR: TÍTULO + TARJETAS KPI */}
      <div className="top-summary-grid">
        <section className="hero-card">
          <span className="module-pill">MÓDULO OPERATIVO</span>
          <h1>Tracking de Sugerencias</h1>
          <p>Consulte, filtre, exporte y gestione las tarjetas de sugerencias y mejora continua.</p>
        </section>

        <section className="kpi-container-card">
          <div className="kpi-blue-box">
            <span className="kpi-box-title">ASIGNADAS A MÍ</span>
            <strong className="kpi-box-value">{asignadasAMiCount}</strong>
          </div>
          <div className="kpi-blue-box">
            <span className="kpi-box-title">MIS SUGERENCIAS</span>
            <strong className="kpi-box-value">{misSugerenciasCount}</strong>
          </div>
          <div className="kpi-blue-box">
            <span className="kpi-box-title">POR VALIDAR</span>
            <strong className="kpi-box-value">{porValidarCount}</strong>
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
              placeholder="ID, proceso, creado por, categoría, descripción..."
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
              <option value="Por Validar">Por Validar</option>
              <option value="Priorizado">Priorizado</option>
              <option value="Concluido">Concluido</option>
              <option value="Futuro">Futuro</option>
              <option value="Atrasado">Atrasado</option>
              <option value="Cancelado">Cancelado</option>
              <option value="PENDIENTE DE ENVÍO">Pendiente de Envío</option>
            </select>
          </div>

          <div className="filter-group">
            <label>Área solicitante</label>
            <select
              value={filtrosForm.area}
              onChange={(e) => setFiltrosForm({ ...filtrosForm, area: e.target.value })}
            >
              <option value="Todas">Todas</option>
              {listaAreasFiltro.map((ar) => (
                <option key={ar} value={ar}>{ar}</option>
              ))}
            </select>
          </div>

          <div className="filter-group">
            <label>Responsable cierre</label>
            <select
              value={filtrosForm.responsable}
              onChange={(e) => setFiltrosForm({ ...filtrosForm, responsable: e.target.value })}
            >
              <option value="Todos">Todos</option>
              {listaResponsablesFiltro.map((resp) => (
                <option key={resp} value={resp}>{resp}</option>
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
            onClick={() => navigate('/sugerencias/registrar')}
          >
            <FaPlus />
            <span>Nueva sugerencia</span>
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
          <div className="pagination-bar">
            <span className="records-counter">
              Mostrando <strong>{sugerenciasPaginadas.length}</strong> registros de <strong>{sugerenciasFiltradas.length}</strong>
            </span>

            <div className="pagination-controls">
              <button
                type="button"
                className="page-nav-btn"
                disabled={paginaActual <= 1}
                onClick={() => setPaginaActual((p) => Math.max(1, p - 1))}
              >
                <span>Anterior</span>
                <FaChevronLeft className="nav-chevron" />
              </button>

              <button
                type="button"
                className="page-nav-btn"
                disabled={paginaActual >= totalPaginas}
                onClick={() => setPaginaActual((p) => Math.min(totalPaginas, p + 1))}
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
            title={puedeExportar ? 'Exportar a Excel (.xlsx)' : 'Solo habilitado para Admin / Supervisor / Superadmin'}
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
                <th>ID SUGERENCIA</th>
                <th>ESTADO</th>
                <th>FECHA REGISTRO</th>
                <th>CREADO POR</th>
                <th>ÁREA SOLICITANTE</th>
                <th>PROCESO</th>
                <th>FECHA PLAN</th>
                <th>ÁREA RESP.</th>
                <th>RESPONSABLE DE CIERRE</th>
                <th>CATEGORÍAS</th>
                <th>ACCIONES</th>
              </tr>
            </thead>
            <tbody>
              {sugerenciasPaginadas.length === 0 ? (
                <tr>
                  <td colSpan="12" style={{ textAlign: 'center', padding: '28px', color: '#64748b' }}>
                    No se encontraron tarjetas de sugerencias con los filtros seleccionados.
                  </td>
                </tr>
              ) : (
                sugerenciasPaginadas.map((item, idx) => {
                  const estadoVisual = obtenerEstadoVisual(item);
                  const claseEstado = getStatusClass(estadoVisual);
                  const numeroFila = indiceInicio + idx + 1;
                  const cats = Array.isArray(item.categorias) ? item.categorias : [];

                  return (
                    <tr key={item.id}>
                      <td style={{ fontWeight: 'bold', color: '#475569' }}>{numeroFila}</td>
                      <td style={{ fontWeight: '800', color: '#0f172a' }}>
                        {item.id_sugerencia || 'PENDIENTE'}
                      </td>
                      <td>
                        <span className={`badge-sugerencia ${claseEstado}`}>
                          {estadoVisual}
                        </span>
                      </td>
                      <td>{formatearFechaHora(item.fecha_registro)}</td>
                      <td>{item.usuario_registro || '-'}</td>
                      <td>{item.area_registro || '-'}</td>
                      <td style={{ maxWidth: '180px', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {item.proceso || '-'}
                      </td>
                      <td>{formatearFechaCorta(item.fecha_plan)}</td>
                      <td>{item.area_responsable || '-'}</td>
                      <td>{item.nombre_responsable || '-'}</td>
                      <td>
                        {cats.length > 0
                          ? cats.map((c) => (
                              <span key={c} className="cat-mini-chip">{c}</span>
                            ))
                          : '-'}
                      </td>
                      <td>
                        <div className="acciones-cell">
                          <button
                            type="button"
                            className="btn-tabla-editar"
                            onClick={() => navigate(`/sugerencias/registrar?id=${item.id}`, { state: { sugerencia: item } })}
                            title={puedeEditarAnalisis ? 'Analizar / Editar sugerencia' : 'Ver detalle de sugerencia'}
                          >
                            {puedeEditarAnalisis ? <FaEdit /> : <FaEye />}
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
