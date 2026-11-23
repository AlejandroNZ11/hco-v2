import { useEffect, useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  FaCheck,
  FaExclamation,
  FaFileDownload,
  FaSearch,
  FaUndo,
  FaChevronLeft,
  FaChevronRight,
  FaBarcode,
  FaCloudUploadAlt,
} from 'react-icons/fa';
import { localDb } from '../../services/localDb';
import {
  analizarExcelTomaLotes,
  importarExcelTomaLotes,
  descargarPlantillaTomaLotes,
  detalleDeFila,
  guardarLotesSku,
  refrescarTomaLotes,
  registrarCambioRemotoTomaLotes,
} from '../../services/tomaLotesService';
import { useSupabaseRealtime } from '../../hooks/useSupabaseRealtime';
import { escuchar, EVENTOS } from '../../services/eventBus';
import IndicadorEnVivo from '../../components/IndicadorEnVivo';
import ModalLotes from './ModalLotes';
import ModalResumenExcel from './ModalResumenExcel';
import './toma_lotes.css';

const ITEMS_POR_PAGINA = 50;
const FILTROS_INICIALES = { buscar: '', ruta: 'Todas', estado: 'Todos', fechaIni: '', fechaFin: '' };

function getStoredAuthUser() {
  const raw = localStorage.getItem('authUser') || sessionStorage.getItem('authUser');
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

const formatearFecha = (fecha) =>
  fecha
    ? new Date(fecha).toLocaleString('es-PE', { dateStyle: 'short', timeStyle: 'short' }).replace(',', '')
    : '-';

const fechaISO = (fecha) => {
  const d = new Date(fecha);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

function TomaLotesContenido() {
  const [currentUser] = useState(() => getStoredAuthUser());
  const usuario = useMemo(
    () => ({ id: currentUser?.id || null, nombre: currentUser?.nombre || currentUser?.usuario || null }),
    [currentUser],
  );

  // Dexie es la fuente de la pantalla: abre al instante, con o sin internet
  const registros = useLiveQuery(() => localDb.toma_lotes.toArray(), [], null);
  const [actualizando, setActualizando] = useState(false);

  const [filtrosForm, setFiltrosForm] = useState(FILTROS_INICIALES);
  const [filtros, setFiltros] = useState(FILTROS_INICIALES);
  const [pagina, setPagina] = useState(1);

  const [seleccionado, setSeleccionado] = useState(null); // fila abierta en el modal
  const [resumenExcel, setResumenExcel] = useState(null); // análisis del Excel antes de cargar
  const [cargandoExcel, setCargandoExcel] = useState(false);
  const [aviso, setAviso] = useState(null); // { tipo, texto }
  const inputExcelRef = useRef(null);

  // ----- Carga inicial + al volver internet / sincronizar -----
  const refrescar = async () => {
    if (!navigator.onLine) return;
    setActualizando(true);
    try {
      await refrescarTomaLotes();
    } finally {
      setActualizando(false);
    }
  };

  useEffect(() => {
    const t = setTimeout(refrescar, 0); // no bloquea el primer pintado (se ve lo de Dexie al instante)
    const quitar = escuchar(EVENTOS.SYNC_COMPLETADO, () => refrescar());
    return () => {
      clearTimeout(t);
      quitar();
    };
  }, []);

  const estadoRealtime = useSupabaseRealtime('toma_lotes', (cambio) => registrarCambioRemotoTomaLotes(cambio), {
    onReconectar: () => refrescar(),
  });

  useEffect(() => {
    if (!aviso) return;
    const t = setTimeout(() => setAviso(null), 4500);
    return () => clearTimeout(t);
  }, [aviso]);

  // ----- Datos derivados -----
  const ordenados = useMemo(
    () =>
      [...(registros || [])].sort(
        (a, b) =>
          String(b.fecha_registro || '').localeCompare(String(a.fecha_registro || '')) ||
          String(a.pedido).localeCompare(String(b.pedido), 'es', { numeric: true }) ||
          String(a.sku).localeCompare(String(b.sku)),
      ),
    [registros],
  );

  const listaRutas = useMemo(
    () => [...new Set(ordenados.map((r) => r.ruta).filter(Boolean))].sort(),
    [ordenados],
  );

  const kpis = useMemo(() => {
    const conLotes = ordenados.filter((r) => (r.lotes || []).length > 0).length;
    return { total: ordenados.length, conLotes, sinLotes: ordenados.length - conLotes };
  }, [ordenados]);

  const filtrados = useMemo(() => {
    const q = filtros.buscar.trim().toLowerCase();
    return ordenados.filter((r) => {
      const n = (r.lotes || []).length;
      if (filtros.ruta !== 'Todas' && r.ruta !== filtros.ruta) return false;
      if (filtros.estado === 'CON' && n === 0) return false;
      if (filtros.estado === 'SIN' && n > 0) return false;
      if (filtros.estado === 'PENDIENTE' && r._sincronizado !== false) return false;
      if (filtros.fechaIni && r.fecha_registro && fechaISO(r.fecha_registro) < filtros.fechaIni) return false;
      if (filtros.fechaFin && r.fecha_registro && fechaISO(r.fecha_registro) > filtros.fechaFin) return false;
      if (q) {
        const fila = [r.ruta, r.cliente, r.pedido, r.sku, r.registrado_por_nombre, ...(r.lotes || [])]
          .join(' ')
          .toLowerCase();
        if (!fila.includes(q)) return false;
      }
      return true;
    });
  }, [ordenados, filtros]);

  const totalPaginas = Math.max(1, Math.ceil(filtrados.length / ITEMS_POR_PAGINA));
  const paginaActual = Math.min(pagina, totalPaginas);
  const inicio = (paginaActual - 1) * ITEMS_POR_PAGINA;
  const visibles = filtrados.slice(inicio, inicio + ITEMS_POR_PAGINA);

  const aplicarFiltros = (nuevos = filtrosForm) => {
    setFiltros({ ...nuevos });
    setPagina(1);
  };

  const limpiarFiltros = () => {
    setFiltrosForm(FILTROS_INICIALES);
    aplicarFiltros(FILTROS_INICIALES);
  };

  // ----- Excel -----
  const elegirExcel = async (e) => {
    const archivo = e.target.files?.[0];
    e.target.value = '';
    if (!archivo) return;
    setCargandoExcel(true);
    try {
      const analisis = await analizarExcelTomaLotes(archivo);
      setResumenExcel({ ...analisis, nombre: archivo.name });
    } catch (err) {
      alert(err.message || 'No se pudo leer el archivo.');
    } finally {
      setCargandoExcel(false);
    }
  };

  const confirmarExcel = async () => {
    if (!resumenExcel) return;
    setCargandoExcel(true);
    try {
      const res = await importarExcelTomaLotes(resumenExcel, usuario);
      setResumenExcel(null);
      limpiarFiltros();
      const partes = [
        res.nuevas && `${res.nuevas} SKU nuevos`,
        res.actualizadas && `${res.actualizadas} SKU con lotes adicionados`,
        res.lotes && `${res.lotes} lote(s) registrados`,
      ].filter(Boolean);
      setAviso({
        tipo: res.offline ? 'warn' : 'ok',
        texto: res.offline
          ? `${partes.join(' · ')}. Guardado sin internet: se enviará al recuperar la conexión.`
          : `${partes.join(' · ')}. Cargado correctamente.`,
      });
    } catch (err) {
      alert('Error al cargar: ' + (err.message || err));
    } finally {
      setCargandoExcel(false);
    }
  };

  // ----- Lotes -----
  const abrirDesdeFila = (r) => {
    const n = (r.lotes || []).length;
    const msg = n
      ? `Pedido ${r.pedido} · SKU ${r.sku}\nYa tiene ${n} lote(s). ¿Deseas adicionar o editar lotes?`
      : `Pedido ${r.pedido} · SKU ${r.sku}\n¿Deseas ingresar lotes?`;
    if (window.confirm(msg)) setSeleccionado(r);
  };

  const guardarLotes = async (lotes) => {
    try {
      const res = await guardarLotesSku(seleccionado.id, lotes, usuario);
      setAviso({
        tipo: res.offline ? 'warn' : 'ok',
        texto: res.offline
          ? `Lotes de ${seleccionado.sku} guardados sin internet (pendiente de envío).`
          : `Lotes de ${seleccionado.sku} guardados (${lotes.length}).`,
      });
      setSeleccionado(null);
    } catch (err) {
      alert('Error al guardar lotes: ' + (err.message || err));
    }
  };

  // ----- Exportar -----
  const exportar = async () => {
    if (!filtrados.length) return alert('No hay registros para exportar.');
    const XLSX = await import('xlsx');
    const datos = filtrados.map((r, i) => ({
      'N°': i + 1,
      'F. Registro': formatearFecha(r.fecha_registro),
      Ruta: r.ruta || '',
      Cliente: r.cliente || '',
      Pedido: r.pedido,
      SKU: r.sku,
      'Registrado por': r.registrado_por_nombre || '',
      'Cant. Lotes': (r.lotes || []).length,
      Lotes: (r.lotes || []).join(', '),
      'Lotes (fecha/hora)': detalleDeFila(r)
        .map((d) => `${d.lote} (${formatearFecha(d.fecha)}${d.origen ? ' · ' + d.origen : ''})`)
        .join(', '),
      'Lotes por': r.lotes_por_nombre || '',
      'Lotes el': formatearFecha(r.lotes_actualizado_en),
    }));
    const hoja = XLSX.utils.json_to_sheet(datos);
    hoja['!cols'] = [6, 16, 8, 34, 12, 16, 24, 10, 40, 60, 24, 16].map((wch) => ({ wch }));
    const libro = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(libro, hoja, 'Toma de Lotes');
    XLSX.writeFile(libro, `Toma_Lotes_${fechaISO(new Date())}.xlsx`);
  };

  const cargandoInicial = registros === null;

  return (
    <div className="tl-page">
      {/* 1. TÍTULO + KPI */}
      <div className="top-summary-grid">
        <section className="hero-card">
          <div className="hero-pills">
            <span className="module-pill">MÓDULO OPERATIVO</span>
            <IndicadorEnVivo estado={estadoRealtime} />
            {actualizando && <span className="tl-sync-pill">Actualizando…</span>}
          </div>
          <h1>Toma de Lotes</h1>
          <p>Cargue pedidos desde Excel y registre los lotes de cada SKU escaneando el código o el texto.</p>
        </section>

        <section className="kpi-container-card">
          <div className="kpi-blue-box">
            <span className="kpi-box-title">SKU CARGADOS</span>
            <strong className="kpi-box-value">{kpis.total}</strong>
          </div>
          <div className="kpi-blue-box">
            <span className="kpi-box-title">CON LOTES</span>
            <strong className="kpi-box-value">{kpis.conLotes}</strong>
          </div>
          <div className="kpi-blue-box">
            <span className="kpi-box-title">SIN LOTES</span>
            <strong className="kpi-box-value">{kpis.sinLotes}</strong>
          </div>
        </section>
      </div>

      {/* 2. FILTROS Y ACCIONES */}
      <section className="filters-card">
        <div className="filters-grid">
          <div className="filter-group filter-buscar">
            <label>Buscar</label>
            <input
              type="text"
              placeholder="Pedido, SKU, cliente, lote..."
              value={filtrosForm.buscar}
              onChange={(e) => setFiltrosForm({ ...filtrosForm, buscar: e.target.value })}
              onKeyDown={(e) => e.key === 'Enter' && aplicarFiltros()}
            />
          </div>
          <div className="filter-group">
            <label>Ruta</label>
            <select value={filtrosForm.ruta} onChange={(e) => setFiltrosForm({ ...filtrosForm, ruta: e.target.value })}>
              <option value="Todas">Todas</option>
              {listaRutas.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          </div>
          <div className="filter-group">
            <label>Lotes</label>
            <select value={filtrosForm.estado} onChange={(e) => setFiltrosForm({ ...filtrosForm, estado: e.target.value })}>
              <option value="Todos">Todos</option>
              <option value="SIN">Sin lotes</option>
              <option value="CON">Con lotes</option>
              <option value="PENDIENTE">Pendiente de envío</option>
            </select>
          </div>
          <div className="filter-group mobile-hidden-filter">
            <label>Fecha ini</label>
            <input type="date" value={filtrosForm.fechaIni} onChange={(e) => setFiltrosForm({ ...filtrosForm, fechaIni: e.target.value })} />
          </div>
          <div className="filter-group mobile-hidden-filter">
            <label>Fecha fin</label>
            <input type="date" value={filtrosForm.fechaFin} onChange={(e) => setFiltrosForm({ ...filtrosForm, fechaFin: e.target.value })} />
          </div>
        </div>

        <div className="filters-actions-row">
          <button
            type="button"
            className="btn-action-excel"
            onClick={() => inputExcelRef.current?.click()}
            disabled={cargandoExcel}
          >
            <FaCloudUploadAlt />
            <span>{cargandoExcel ? 'Leyendo…' : 'Cargar Excel'}</span>
          </button>
          <button type="button" className="btn-action-primary" onClick={() => aplicarFiltros()}>
            <FaSearch />
            <span>Buscar</span>
          </button>
          <button
            type="button"
            className="btn-action-secondary btn-plantilla"
            onClick={descargarPlantillaTomaLotes}
            title="Descargar plantilla de Excel (Ruta, Cliente, Pedido, SKU, Lote)"
          >
            <FaFileDownload />
            <span>Plantilla</span>
          </button>
          <button type="button" className="btn-action-secondary" onClick={limpiarFiltros}>
            <FaUndo />
            <span>Limpiar</span>
          </button>
        </div>
        <input
          ref={inputExcelRef}
          type="file"
          accept=".xlsx,.xls,.csv"
          hidden
          onChange={elegirExcel}
        />
      </section>

      {aviso && <div className={`tl-aviso ${aviso.tipo}`}>{aviso.texto}</div>}

      {/* 3. TABLA */}
      <section className="table-section-card">
        <div className="table-topbar">
          <span className="records-counter">
            Mostrando <strong>{visibles.length}</strong> registros de <strong>{filtrados.length}</strong>
          </span>
          <div className="pagination-controls">
            <button type="button" className="page-nav-btn" disabled={paginaActual <= 1} onClick={() => setPagina(paginaActual - 1)}>
              <FaChevronLeft className="nav-chevron" />
              <span>Anterior</span>
            </button>
            <span className="page-indicator">
              Página {paginaActual} de {totalPaginas}
            </span>
            <button
              type="button"
              className="page-nav-btn"
              disabled={paginaActual >= totalPaginas}
              onClick={() => setPagina(paginaActual + 1)}
            >
              <span>Siguiente</span>
              <FaChevronRight className="nav-chevron" />
            </button>
          </div>
          <button type="button" className="btn-exportar-excel" onClick={exportar} title="Exportar a Excel (.xlsx)">
            <span className="excel-icon-box">X</span>
            <span>Exportar</span>
          </button>
        </div>

        <div className="table-container">
          <table>
            <thead>
              <tr>
                <th style={{ width: 40 }}>N°</th>
                <th>F. Registro</th>
                <th>Ruta</th>
                <th>Cliente</th>
                <th>Pedido</th>
                <th>SKU</th>
                <th>Registrado por</th>
                <th>Lotes</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {cargandoInicial ? (
                <tr>
                  <td colSpan="9" className="tl-vacio">Cargando…</td>
                </tr>
              ) : visibles.length === 0 ? (
                <tr>
                  <td colSpan="9" className="tl-vacio">
                    {ordenados.length ? 'No hay registros con los filtros seleccionados.' : 'Aún no hay pedidos. Usa «Cargar Excel» para empezar.'}
                  </td>
                </tr>
              ) : (
                visibles.map((r, i) => {
                  const n = (r.lotes || []).length;
                  const pendiente = r._sincronizado === false;
                  return (
                    <tr key={r.id} className="tl-fila" onClick={() => abrirDesdeFila(r)} title="Click para ingresar lotes">
                      <td className="tl-num">{inicio + i + 1}</td>
                      <td>
                        {formatearFecha(r.fecha_registro)}
                        {pendiente && <span className="tl-dot-pendiente" title="Pendiente de envío" />}
                      </td>
                      <td>{r.ruta || '-'}</td>
                      <td className="tl-cliente" title={r.cliente}>{r.cliente || '-'}</td>
                      <td className="tl-fuerte">{r.pedido}</td>
                      <td className="tl-fuerte">{r.sku}</td>
                      <td>{r.registrado_por_nombre || '-'}</td>
                      <td>
                        <span
                          className={`tl-lotes-badge ${n ? 'con' : 'sin'}`}
                          title={n ? (r.lotes || []).join(', ') : 'Sin lotes'}
                        >
                          {n ? <FaCheck /> : <FaExclamation />}
                          <strong>{n}</strong>
                        </span>
                      </td>
                      <td>
                        <button
                          type="button"
                          className="btn-ingresar"
                          onClick={(e) => {
                            e.stopPropagation();
                            setSeleccionado(r);
                          }}
                        >
                          <FaBarcode />
                          <span>{n ? 'Adicionar' : 'Ingresar'}</span>
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Resumen + vista previa del Excel antes de cargar */}
      {resumenExcel && (
        <ModalResumenExcel
          resumen={resumenExcel}
          cargando={cargandoExcel}
          onCancelar={() => setResumenExcel(null)}
          onConfirmar={confirmarExcel}
        />
      )}

      {seleccionado && (
        <ModalLotes registro={seleccionado} usuario={usuario} onCerrar={() => setSeleccionado(null)} onGuardar={guardarLotes} />
      )}
    </div>
  );
}

// Envoltorio: los estilos de este módulo solo aplican dentro de este div
export default function TomaLotes(props) {
  return (
    <div className="hco-scope hco-toma-lotes">
      <TomaLotesContenido {...props} />
    </div>
  );
}
