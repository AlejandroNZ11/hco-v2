import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import Loading from '../../layouts/Loading';
import './pizarra-cuadro-Q.css';
import { useCuadroQEnVivo } from './useCuadroQEnVivo';
import IndicadorEnVivo from '../../components/IndicadorEnVivo';

import {
  obtenerRegistrosCuadroQ,
  ERRORES_POR_AREA
} from '../../services/cuadroQService';

function getStoredAuthUser() {
  const raw = localStorage.getItem("authUser") || sessionStorage.getItem("authUser");
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

function PizarraCuadroQContenido() {
  const navigate = useNavigate();
  const [currentUser] = useState(() => getStoredAuthUser());
  const [loading, setLoading] = useState(true);

  const [registros, setRegistros] = useState([]);

  // Estados de Filtros para Gráficos por Área
  const [filtrosArea, setFiltrosArea] = useState({
    anio: '',
    mes: '',
    estado: ''
  });

  // Estados de Filtros para Cantidad de Errores (Ranking)
  const [filtrosRanking, setFiltrosRanking] = useState({
    anio: '',
    mes: '',
    estado: ''
  });

  useEffect(() => {
    if (!currentUser) {
      navigate('/');
      return;
    }
    cargarDatos();
  }, [currentUser, navigate]);

  // Tiempo real: los gráficos se recalculan solos cuando alguien registra o cierra un Q
  const estadoRealtime = useCuadroQEnVivo(setRegistros, {
    enabled: !!currentUser,
    onReconectar: () => cargarDatos({ silencioso: true })
  });

  const cargarDatos = async ({ silencioso = false } = {}) => {
    if (!silencioso) setLoading(true);
    try {
      const dataReg = await obtenerRegistrosCuadroQ();
      setRegistros(dataReg || []);
    } catch (error) {
      console.error("Error al cargar registros para la pizarra:", error);
    } finally {
      if (!silencioso) setLoading(false);
    }
  };

  // Obtener años únicos de los registros para los selects
  const listaAnios = useMemo(() => {
    const aniosSet = new Set();
    registros.forEach((reg) => {
      const fecha = reg.fecha_registro || reg.fecha_hora_actualiza;
      if (fecha) {
        const match = fecha.match(/^(\d{4})-(\d{2})-(\d{2})/) || fecha.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
        if (match) {
          const anio = match[1].length === 4 ? match[1] : match[3];
          aniosSet.add(anio);
        }
      }
    });
    return Array.from(aniosSet).sort((a, b) => Number(b) - Number(a));
  }, [registros]);

  // Filtrado de registros para las tarjetas por área
  const registrosAreaFiltrados = useMemo(() => {
    return registros.filter((reg) => {
      const fecha = reg.fecha_registro || reg.fecha_hora_actualiza || '';
      const estadoReg = String(reg.estado || '').toUpperCase().trim();

      if (filtrosArea.anio) {
        if (!fecha.includes(filtrosArea.anio)) return false;
      }
      if (filtrosArea.mes) {
        // Formato YYYY-MM o DD/MM
        const mesMatch = fecha.includes('-') ? fecha.split('-')[1] : fecha.split('/')[1];
        if (mesMatch !== filtrosArea.mes) return false;
      }
      if (filtrosArea.estado) {
        if (estadoReg !== filtrosArea.estado.toUpperCase()) return false;
      }
      return true;
    });
  }, [registros, filtrosArea]);

  // Filtrado de registros para el ranking general
  const registrosRankingFiltrados = useMemo(() => {
    return registros.filter((reg) => {
      const fecha = reg.fecha_registro || reg.fecha_hora_actualiza || '';
      const estadoReg = String(reg.estado || '').toUpperCase().trim();

      if (filtrosRanking.anio) {
        if (!fecha.includes(filtrosRanking.anio)) return false;
      }
      if (filtrosRanking.mes) {
        const mesMatch = fecha.includes('-') ? fecha.split('-')[1] : fecha.split('/')[1];
        if (mesMatch !== filtrosRanking.mes) return false;
      }
      if (filtrosRanking.estado) {
        if (estadoReg !== filtrosRanking.estado.toUpperCase()) return false;
      }
      return true;
    });
  }, [registros, filtrosRanking]);

  // Generar matriz de conteo por Área y Error (para las tarjetas del Top 5)
  const matrizAreaErrores = useMemo(() => {
    const matrix = {};
    const areasOficiales = Object.keys(ERRORES_POR_AREA);

    areasOficiales.forEach((area) => {
      matrix[area] = {};
    });

    registrosAreaFiltrados.forEach((reg) => {
      const areaErr = String(reg.area_error || 'SIN AREA').trim();
      const errNom = String(reg.error || 'SIN ERROR').trim();

      // Encontrar área exacta o flexible
      let areaKey = areasOficiales.find((a) => a.toUpperCase() === areaErr.toUpperCase()) || 'INBOUND';

      if (!matrix[areaKey]) matrix[areaKey] = {};
      if (!matrix[areaKey][errNom]) matrix[areaKey][errNom] = 0;
      matrix[areaKey][errNom]++;
    });

    return matrix;
  }, [registrosAreaFiltrados]);

  // Obtener Top 5 de errores por área (incluyendo base del diccionario para mantener orden fijo)
  const obtenerTop5PorArea = (areaNombre) => {
    const erroresBase = ERRORES_POR_AREA[areaNombre] || [];
    const areaData = matrizAreaErrores[areaNombre] || {};

    const mapaConteo = {};
    erroresBase.forEach((err, idx) => {
      mapaConteo[err] = {
        error: err,
        cantidad: areaData[err] || 0,
        ordenOriginal: idx
      };
    });

    // Añadir errores personalizados si existen en la data filtrada y no están en la base
    Object.keys(areaData).forEach((err) => {
      if (!mapaConteo[err]) {
        mapaConteo[err] = {
          error: err,
          cantidad: areaData[err],
          ordenOriginal: 999
        };
      }
    });

    const lista = Object.values(mapaConteo);
    lista.sort((a, b) => {
      if (b.cantidad !== a.cantidad) return b.cantidad - a.cantidad;
      return a.ordenOriginal - b.ordenOriginal;
    });

    return lista.slice(0, 5);
  };

  // Calcular ranking general para la sección inferior
  const rankingGeneral = useMemo(() => {
    const mapaRanking = {};

    registrosRankingFiltrados.forEach((reg) => {
      const area = String(reg.area_error || 'SIN AREA').trim();
      const error = String(reg.error || 'SIN ERROR').trim();
      const key = `${error}|||${area}`;

      if (!mapaRanking[key]) {
        mapaRanking[key] = { area, error, cantidad: 0 };
      }
      mapaRanking[key].cantidad++;
    });

    const arr = Object.values(mapaRanking);
    arr.sort((a, b) => {
      if (b.cantidad !== a.cantidad) return b.cantidad - a.cantidad;
      return a.error.localeCompare(b.error);
    });

    return arr;
  }, [registrosRankingFiltrados]);

  const maxRankingCantidad = useMemo(() => {
    if (rankingGeneral.length === 0) return 1;
    return Math.max(...rankingGeneral.map((r) => r.cantidad), 1);
  }, [rankingGeneral]);

  const areasList = Object.keys(ERRORES_POR_AREA);
  const fechaActualStr = new Date().toLocaleString('es-PE', { dateStyle: 'short', timeStyle: 'medium' });

  return (
    <div className="q-dashboard-page">
      {loading && <Loading />}

      {/* CABECERA */}
      <section className="q-header">
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 6 }}>
            <span className="page-chip" style={{ marginBottom: 0 }}>CUADRO Q</span>
            <IndicadorEnVivo estado={estadoRealtime} />
          </div>
          <h1>Gráficos de Q</h1>
          <p id="pizarraStatus">
            Actualizado: {fechaActualStr} | Total errores: {registrosAreaFiltrados.length}
          </p>
        </div>

      </section>

      {/* FILTROS PARA GRÁFICOS POR ÁREA */}
      <section className="filter-card">
        <div className="filter-title">Filtros para gráficos por área</div>
        <div className="q-filters">
          <label>
            Año
            <select
              value={filtrosArea.anio}
              onChange={(e) => setFiltrosArea({ ...filtrosArea, anio: e.target.value })}
            >
              <option value="">Todos</option>
              {listaAnios.map((anio) => (
                <option key={anio} value={anio}>{anio}</option>
              ))}
            </select>
          </label>

          <label>
            Mes
            <select
              value={filtrosArea.mes}
              onChange={(e) => setFiltrosArea({ ...filtrosArea, mes: e.target.value })}
            >
              <option value="">Todos</option>
              <option value="01">Enero</option>
              <option value="02">Febrero</option>
              <option value="03">Marzo</option>
              <option value="04">Abril</option>
              <option value="05">Mayo</option>
              <option value="06">Junio</option>
              <option value="07">Julio</option>
              <option value="08">Agosto</option>
              <option value="09">Septiembre</option>
              <option value="10">Octubre</option>
              <option value="11">Noviembre</option>
              <option value="12">Diciembre</option>
            </select>
          </label>

          <label>
            Estado
            <select
              value={filtrosArea.estado}
              onChange={(e) => setFiltrosArea({ ...filtrosArea, estado: e.target.value })}
            >
              <option value="">Todos</option>
              <option value="PENDIENTE">PENDIENTE</option>
              <option value="EN PROCESO">EN PROCESO</option>
              <option value="ATRAZADO">ATRAZADO</option>
              <option value="CONCLUIDO">CONCLUIDO</option>
              <option value="CANCELADO">CANCELADO</option>
            </select>
          </label>
        </div>
      </section>

      {/* GRILLA DE TARJETAS POR ÁREA (TOP 5) */}
      <section className="areas-grid" id="areasGrid">
        {areasList.map((area) => {
          const top5 = obtenerTop5PorArea(area);
          const maxVal = Math.max(...top5.map((i) => i.cantidad), 1);

          return (
            <div className="area-chart-card" key={area}>
              <div className="area-title">{area}</div>
              <div className="mini-chart">
                <div className="mini-chart-plot">
                  <div className="mini-chart-grid" aria-hidden="true">
                    <span></span><span></span><span></span><span></span>
                  </div>
                  {top5.map((item, idx) => {
                    const val = item.cantidad;
                    // Altura estrictamente proporcional al valor máximo del área
                    const heightPct = (val / maxVal) * 100;
                    return (
                      <div
                        key={idx}
                        className={`bar-wrap${val === 0 ? ' is-zero' : ''}${idx === 0 && val > 0 ? ' is-top' : ''}`}
                        title={`${item.error}: ${val}`}
                      >
                        <div className="bar" style={{ height: `${heightPct}%` }}>
                          <span className="bar-value">{val}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div className="mini-chart-labels">
                  {top5.map((_, idx) => (
                    <div key={idx} className="bar-label">{idx + 1}</div>
                  ))}
                </div>
              </div>

              <div className="legend-mini no-scroll">
                {top5.map((item, idx) => (
                  <div key={idx}>
                    <strong>{idx + 1}.</strong> {item.error}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </section>

      {/* SECCIÓN DE RANKING GENERAL (CANTIDAD DE ERRORES) */}
      <section className="ranking-section">
        <div className="ranking-title">CANTIDAD DE ERRORES</div>

        <div className="filter-card ranking-filter-card">
          <div className="filter-title">Filtros para cantidad de errores</div>
          <div className="q-filters">
            <label>
              Año
              <select
                value={filtrosRanking.anio}
                onChange={(e) => setFiltrosRanking({ ...filtrosRanking, anio: e.target.value })}
              >
                <option value="">Todos</option>
                {listaAnios.map((anio) => (
                  <option key={anio} value={anio}>{anio}</option>
                ))}
              </select>
            </label>

            <label>
              Mes
              <select
                value={filtrosRanking.mes}
                onChange={(e) => setFiltrosRanking({ ...filtrosRanking, mes: e.target.value })}
              >
                <option value="">Todos</option>
                <option value="01">Enero</option>
                <option value="02">Febrero</option>
                <option value="03">Marzo</option>
                <option value="04">Abril</option>
                <option value="05">Mayo</option>
                <option value="06">Junio</option>
                <option value="07">Julio</option>
                <option value="08">Agosto</option>
                <option value="09">Septiembre</option>
                <option value="10">Octubre</option>
                <option value="11">Noviembre</option>
                <option value="12">Diciembre</option>
              </select>
            </label>

            <label>
              Estado
              <select
                value={filtrosRanking.estado}
                onChange={(e) => setFiltrosRanking({ ...filtrosRanking, estado: e.target.value })}
              >
                <option value="">Todos</option>
                <option value="PENDIENTE">PENDIENTE</option>
                <option value="EN PROCESO">EN PROCESO</option>
                <option value="ATRAZADO">ATRAZADO</option>
                <option value="CONCLUIDO">CONCLUIDO</option>
                <option value="CANCELADO">CANCELADO</option>
              </select>
            </label>
          </div>
        </div>

        <div className="ranking-card" id="rankingCard">
          {rankingGeneral.length === 0 ? (
            <div className="empty">Sin errores registrados.</div>
          ) : (
            rankingGeneral.map((item, idx) => {
              // Ancho estrictamente proporcional (sin mínimos que igualen barras pequeñas)
              const pct = (item.cantidad / maxRankingCantidad) * 100;
              return (
                <div className="ranking-row" key={idx}>
                  <div className="ranking-error">
                    <span className="ranking-pos">{idx + 1}</span>
                    {item.error}
                  </div>
                  <div className="ranking-area">{item.area}</div>
                  <div className="ranking-bar-cell">
                    <div className="ranking-bar-track">
                      <div className="ranking-bar" style={{ width: `${pct}%` }}></div>
                    </div>
                    <span className="ranking-count">{item.cantidad}</span>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </section>
    </div>
  );
}

// Envoltorio: los estilos de este módulo solo aplican dentro de este div
export default function PizarraCuadroQ(props) {
  return (
    <div className="hco-scope hco-pizarra-cuadroq">
      <PizarraCuadroQContenido {...props} />
    </div>
  );
}
