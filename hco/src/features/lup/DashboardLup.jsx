import React, { useState, useEffect, useMemo } from 'react';
import {
  FaFileAlt as FileText,
  FaCalendarAlt as Calendar,
  FaGraduationCap as GraduationCap,
  FaLightbulb as Lightbulb,
  FaLeaf as Leaf,
  FaChartLine as TrendingUp,
  FaTag as Tag,
  FaAward as Award,
  FaCheckSquare as CheckSquare,
  FaCog as Cog,
  FaBuilding as Building2
} from 'react-icons/fa';
import { supabase } from '../../config/supabaseClient';
import './DashboardLup.css';
import Loading from '../../layouts/Loading';

const MESES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
];

const MESES_ABR = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Set', 'Oct', 'Nov', 'Dic'];

const COLORES_AREA = [
  'linear-gradient(90deg, #0055a5 0%, #0277bd 100%)', // 1° Azul profundo
  'linear-gradient(90deg, #0284c7 0%, #0ea5e9 100%)', // 2° Azul intenso
  'linear-gradient(90deg, #0ea5e9 0%, #38bdf8 100%)', // 3° Celeste medio
  'linear-gradient(90deg, #38bdf8 0%, #7dd3fc 100%)', // 4° Celeste suave
  'linear-gradient(90deg, #7dd3fc 0%, #bae6fd 100%)', // 5° Celeste claro
  'linear-gradient(90deg, #bae6fd 0%, #d8f0fe 100%)'  // 6° Celeste tenue
];

// Extrae { anio, mes } (mes 0-11) sin que new Date("YYYY-MM-DD") reste horas por UTC
const extraerAnioMes = (fechaRaw) => {
  if (!fechaRaw) return null;
  const match = String(fechaRaw).trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match) {
    return {
      anio: Number(match[1]),
      mes: Number(match[2]) - 1
    };
  }
  const d = new Date(fechaRaw);
  return isNaN(d.getTime()) ? null : { anio: d.getFullYear(), mes: d.getMonth() };
};

function SvgDonut({
  slices,
  totalCenter,
  subtitleCenter,
  activeIdx = null,
  onHoverSlice,
  onSelectSlice,
  sizeClass = '',
  strokeWidth = 6.8
}) {
  let acumulado = 0;
  const radius = 15.9155;
  const activeSlice = activeIdx !== null ? slices[activeIdx] : null;
  const activeStroke = Number(strokeWidth) + 1;

  return (
    <div className={`donut-chart-container ${sizeClass}`}>
      {activeSlice && (
        <div className="donut-hover-tooltip">
          <div className="d-tt-head">
            <span className="dot" style={{ backgroundColor: activeSlice.color }} />
            <strong>{activeSlice.label}</strong>
          </div>
          <div className="d-tt-body">
            <span>Cantidad: <b>{activeSlice.count ?? 0} LUP</b></span>
            <span>Participación: <b>{activeSlice.pct}%</b></span>
          </div>
        </div>
      )}

      <svg viewBox="0 0 42 42" className="donut-svg">
        <circle cx="21" cy="21" r={radius} fill="#ffffff" />
        <circle
          cx="21"
          cy="21"
          r={radius}
          fill="none"
          stroke="#f1f5f9"
          strokeWidth={strokeWidth}
        />

        {slices.map((slice, idx) => {
          const valPct = Math.max(0, Math.min(100, Number(slice.pct) || 0));
          if (valPct === 0) return null;

          const dashArray = `${valPct} ${100 - valPct}`;
          const dashOffset = 25 - acumulado;
          acumulado += valPct;

          const isSelected = activeIdx === idx;
          const isDimmed = activeIdx !== null && !isSelected;

          return (
            <circle
              key={idx}
              cx="21"
              cy="21"
              r={radius}
              fill="none"
              stroke={slice.color}
              strokeWidth={isSelected ? activeStroke : strokeWidth}
              strokeDasharray={dashArray}
              strokeDashoffset={dashOffset}
              className="donut-slice-circle"
              style={{
                opacity: isDimmed ? 0.35 : 1,
                pointerEvents: 'stroke'
              }}
              onMouseEnter={() => onHoverSlice && onHoverSlice(idx)}
              onMouseLeave={() => onHoverSlice && onHoverSlice(null)}
              onClick={() => onSelectSlice && onSelectSlice(idx)}
            />
          );
        })}
      </svg>

      <div className="donut-center-label">
        <span className="center-num">
          {activeSlice ? activeSlice.count : totalCenter}
        </span>
        <span className="center-sub">
          {activeSlice ? activeSlice.shortLabel || activeSlice.label : subtitleCenter}
        </span>
        {activeSlice && (
          <span className="center-pct-pill" style={{ color: activeSlice.color }}>
            {activeSlice.pct}%
          </span>
        )}
      </div>
    </div>
  );
}

function DashboardLupContenido() {
  const [loading, setLoading] = useState(true);
  const currentYear = new Date().getFullYear();
  const currentMonth = new Date().getMonth();

  const [anioSeleccionado, setAnioSeleccionado] = useState(currentYear);
  const [mesSeleccionado, setMesSeleccionado] = useState(currentMonth);
  const [areaSeleccionada, setAreaSeleccionada] = useState('TODAS');

  const [lups, setLups] = useState([]);
  const [empleadosMap, setEmpleadosMap] = useState({});

  const [hoveredTipoIdx, setHoveredTipoIdx] = useState(null);
  const [selectedTipoIdx, setSelectedTipoIdx] = useState(null);
  const activeTipoIdx = hoveredTipoIdx !== null ? hoveredTipoIdx : selectedTipoIdx;

  const [hoveredEstadoIdx, setHoveredEstadoIdx] = useState(null);
  const [selectedEstadoIdx, setSelectedEstadoIdx] = useState(null);
  const activeEstadoIdx = hoveredEstadoIdx !== null ? hoveredEstadoIdx : selectedEstadoIdx;

  const [hoveredKaizenIdx, setHoveredKaizenIdx] = useState(null);
  const [selectedKaizenIdx, setSelectedKaizenIdx] = useState(null);
  const activeKaizenIdx = hoveredKaizenIdx !== null ? hoveredKaizenIdx : selectedKaizenIdx;

  const toggleSelectTipo = (idx) => {
    setSelectedTipoIdx((prev) => (prev === idx ? null : idx));
  };

  useEffect(() => {
    cargarDatos();
  }, []);

  const cargarDatos = async () => {
    setLoading(true);
    try {
      const [resLup, resEmp] = await Promise.all([
        supabase.from('lup').select('*'),
        supabase.from('empleados').select('id, nombre, foto_url, area_id')
      ]);

      const empMap = {};
      (resEmp.data || []).forEach(emp => {
        if (emp.id) empMap[emp.id] = emp;
        if (emp.nombre) empMap[emp.nombre.toLowerCase().trim()] = emp;
      });

      setLups(resLup.data || []);
      setEmpleadosMap(empMap);
    } catch (err) {
      console.error('Error cargando datos del dashboard:', err);
    } finally {
      setLoading(false);
    }
  };

  // 1. Años disponibles desde fecha_lup
  const aniosDisponibles = useMemo(() => {
    const aniosSet = new Set([currentYear]);
    lups.forEach(l => {
      const ym = extraerAnioMes(l.fecha_lup || l.fecha_registro);
      if (ym) aniosSet.add(ym.anio);
    });
    return Array.from(aniosSet).sort((a, b) => b - a);
  }, [lups, currentYear]);

  // 2. Áreas disponibles desde la columna 'area'
  const areasDisponibles = useMemo(() => {
    const areasSet = new Set();
    lups.forEach(l => {
      if (String(l.operatividad || '').toUpperCase() === 'INACTIVO') return;
      const a = (l.area || '').trim();
      if (a) areasSet.add(a);
    });
    return Array.from(areasSet).sort((a, b) => a.localeCompare(b));
  }, [lups]);

  // 3A. Filtrado por Año y Área incluyendo ACTIVOS e INACTIVOS (para el gráfico de Tendencia)
  const lupsAnioYAreaTodos = useMemo(() => {
    return lups.filter(l => {
      const ym = extraerAnioMes(l.fecha_lup || l.fecha_registro);
      if (!ym || ym.anio !== Number(anioSeleccionado)) return false;

      if (areaSeleccionada !== 'TODAS') {
        const areaLup = (l.area || '').trim();
        if (areaLup.toLowerCase() !== areaSeleccionada.toLowerCase()) return false;
      }

      return true;
    });
  }, [lups, anioSeleccionado, areaSeleccionada]);

  // 3B. Filtrado por Operatividad ACTIVO, Año y Área (para KPIs operativos)
  const lupsFiltradasAnioYArea = useMemo(() => {
    return lupsAnioYAreaTodos.filter(
      l => String(l.operatividad || '').toUpperCase().trim() !== 'INACTIVO'
    );
  }, [lupsAnioYAreaTodos]);

  // 4. Filtrado del Mes (Activos)
  const lupsDelMes = useMemo(() => {
    return lupsFiltradasAnioYArea.filter(l => {
      const ym = extraerAnioMes(l.fecha_lup || l.fecha_registro);
      return ym && ym.mes === Number(mesSeleccionado);
    });
  }, [lupsFiltradasAnioYArea, mesSeleccionado]);

  const totalGeneralAnio = lupsAnioYAreaTodos.length;
  const totalActivosAnio = lupsFiltradasAnioYArea.length;
  const totalInactivosAnio = totalGeneralAnio - totalActivosAnio;

  // KPIs
  const totalLupAnio = lupsFiltradasAnioYArea.length;
  const totalLupMes = lupsDelMes.length;

  const entrenados = lupsFiltradasAnioYArea.filter(
    l => String(l.entrenamiento).toUpperCase() === 'ENTRENADO'
  ).length;
  const noEntrenados = totalLupAnio - entrenados;
  const pctEntrenados = totalLupAnio > 0 ? Math.round((entrenados / totalLupAnio) * 100) : 0;
  const pctNoEntrenados = 100 - pctEntrenados;

  const kaizenSi = lupsFiltradasAnioYArea.filter(
    l => String(l.realizo_kaizen).toUpperCase() === 'SI'
  ).length;
  const kaizenNo = totalLupAnio - kaizenSi;
  const pctKaizen = totalLupAnio > 0 ? Math.round((kaizenSi / totalLupAnio) * 100) : 0;

  const estadoSlices = [
    {
      label: 'Entrenado',
      shortLabel: 'Entrenado',
      count: entrenados,
      pct: pctEntrenados,
      color: '#0284c7'
    },
    {
      label: 'No Entrenado',
      shortLabel: 'Sin entrenar',
      count: noEntrenados,
      pct: pctNoEntrenados,
      color: '#bae6fd'
    }
  ];

  const kaizenSlices = [
    {
      label: 'Convirtió a Kaizen',
      shortLabel: 'Con Kaizen',
      count: kaizenSi,
      pct: pctKaizen,
      color: '#0284c7'
    },
    {
      label: 'Sin conversión',
      shortLabel: 'Sin Kaizen',
      count: kaizenNo,
      pct: 100 - pctKaizen,
      color: '#bae6fd'
    }
  ];

  const totalCO2 = useMemo(() => {
    return lupsFiltradasAnioYArea.reduce((acc, curr) => {
      const num = parseFloat(curr.impacto_co2);
      return acc + (isNaN(num) ? 0 : num);
    }, 0);
  }, [lupsFiltradasAnioYArea]);

  // Tendencia mensual (Activos + Inactivos + Total)
  const mesesHasta = anioSeleccionado === currentYear ? currentMonth + 1 : 12;
  const tendenciaData = useMemo(() => {
    const items = Array.from({ length: 12 }, (_, idx) => ({
      mesIdx: idx,
      mesCorto: MESES_ABR[idx],
      mesNombre: MESES[idx],
      activos: 0,
      inactivos: 0,
      total: 0
    }));

    lupsAnioYAreaTodos.forEach(l => {
      const ym = extraerAnioMes(l.fecha_lup || l.fecha_registro);
      if (!ym) return;
      const esInactivo = String(l.operatividad || '').toUpperCase().trim() === 'INACTIVO';
      if (esInactivo) {
        items[ym.mes].inactivos += 1;
      } else {
        items[ym.mes].activos += 1;
      }
      items[ym.mes].total += 1;
    });

    return items.slice(0, mesesHasta);
  }, [lupsAnioYAreaTodos, mesesHasta]);

  const resumenTendencia = useMemo(() => {
    return tendenciaData.reduce(
      (acc, d) => ({
        activos: acc.activos + d.activos,
        inactivos: acc.inactivos + d.inactivos,
        total: acc.total + d.total
      }),
      { activos: 0, inactivos: 0, total: 0 }
    );
  }, [tendenciaData]);

  const maxValTendencia = Math.max(...tendenciaData.map(d => d.total), 5);

  // Puntos SVG normalizados (0..1000) para la línea de tendencia sobre las barras
  const trendPolylinePoints = useMemo(() => {
    const n = tendenciaData.length;
    if (n === 0) return '';
    return tendenciaData
      .map((d, i) => {
        const x = ((i + 0.5) / n) * 1000;
        const y = (1 - d.total / maxValTendencia) * 1000;
        return `${x},${y}`;
      })
      .join(' ');
  }, [tendenciaData, maxValTendencia]);

  // LUP por Tipo
  const tiposCount = useMemo(() => {
    let mejora = 0;
    let problema = 0;
    let basica = 0;
    lupsFiltradasAnioYArea.forEach(l => {
      const t = (l.tipo_lup || '').toUpperCase();
      if (t.includes('MEJORA') || t.includes('SEGURIDAD')) mejora++;
      else if (t.includes('PROBLEMA')) problema++;
      else if (t.includes('BASICA') || t.includes('BÁSICA') || t.includes('CONDICION')) basica++;
    });
    return { mejora, problema, basica };
  }, [lupsFiltradasAnioYArea]);

  const pctMejora = totalLupAnio ? Math.round((tiposCount.mejora / totalLupAnio) * 100) : 0;
  const pctProblema = totalLupAnio ? Math.round((tiposCount.problema / totalLupAnio) * 100) : 0;
  const pctBasica = totalLupAnio ? 100 - pctMejora - pctProblema : 0;

  const tiposSlices = [
    {
      label: 'Mejora',
      shortLabel: 'Mejora',
      count: tiposCount.mejora,
      pct: pctMejora,
      color: '#0369a1'
    },
    {
      label: 'Problema',
      shortLabel: 'Problema',
      count: tiposCount.problema,
      pct: pctProblema,
      color: '#0ea5e9'
    },
    {
      label: 'Condición Básica',
      shortLabel: 'Cond. Básica',
      count: tiposCount.basica,
      pct: pctBasica,
      color: '#38bdf8'
    }
  ];

  // Top 5 Colaboradores
  const topColaboradores = useMemo(() => {
    const mapa = {};
    lupsFiltradasAnioYArea.forEach(l => {
      const colab = (l.colaborador || 'Desconocido').trim();
      if (!mapa[colab]) {
        mapa[colab] = {
          nombre: colab,
          empleado_id: l.empleado_id,
          area: l.area || 'Operaciones',
          total: 0
        };
      }
      mapa[colab].total++;
    });

    return Object.values(mapa)
      .sort((a, b) => b.total - a.total)
      .slice(0, 5)
      .map(c => {
        const emp = empleadosMap[c.empleado_id] || empleadosMap[c.nombre.toLowerCase()];
        return {
          ...c,
          foto_url: emp?.foto_url || null,
          area: c.area || emp?.area || 'Operaciones'
        };
      });
  }, [lupsFiltradasAnioYArea, empleadosMap]);

  // LUP por Área
  const lupPorArea = useMemo(() => {
    const mapa = {};
    const baseLups = areaSeleccionada === 'TODAS'
      ? lupsFiltradasAnioYArea
      : lups.filter(l => {
          if (String(l.operatividad || '').toUpperCase() === 'INACTIVO') return false;
          const ym = extraerAnioMes(l.fecha_lup || l.fecha_registro);
          return ym && ym.anio === Number(anioSeleccionado);
        });

    baseLups.forEach(l => {
      const area = (l.area || 'Sin Área').trim();
      mapa[area] = (mapa[area] || 0) + 1;
    });

    return Object.entries(mapa)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6);
  }, [lupsFiltradasAnioYArea, lups, areaSeleccionada, anioSeleccionado]);

  const maxValArea = lupPorArea.length > 0 ? lupPorArea[0][1] : 1;

  return (
    <div className="dashboard-lup-container">
      {loading && <Loading />}

      {/* HEADER */}
      <header className="dashboard-header-card">
        <div className="header-titles">
          <span className="badge-kpi-pill">INDICADORES OPERATIVOS</span>
          <h1 className="title-text">Tablero de LUP's</h1>
        </div>

        <div className="header-filters">
          <div className="filter-group">
            <label>ÁREA</label>
            <select
              value={areaSeleccionada}
              onChange={(e) => setAreaSeleccionada(e.target.value)}
            >
              <option value="TODAS">Todas las áreas</option>
              {areasDisponibles.map(ar => (
                <option key={ar} value={ar}>{ar}</option>
              ))}
            </select>
          </div>

          <div className="filter-group">
            <label>AÑO</label>
            <select
              value={anioSeleccionado}
              onChange={(e) => setAnioSeleccionado(Number(e.target.value))}
            >
              {aniosDisponibles.map(a => (
                <option key={a} value={a}>{a}</option>
              ))}
            </select>
          </div>

          <div className="filter-group">
            <label>MES</label>
            <select
              value={mesSeleccionado}
              onChange={(e) => setMesSeleccionado(Number(e.target.value))}
            >
              {MESES.map((m, idx) => (
                <option key={idx} value={idx}>{m}</option>
              ))}
            </select>
          </div>
        </div>
      </header>

      {/* KPIS SUPERIORES */}
      <section className="kpis-grid">
        <div className="kpi-card">
          <div className="kpi-icon-box"><FileText /></div>
          <div className="kpi-content">
            <span className="kpi-title">Total de LUP</span>
            <div className="kpi-main-val">{totalGeneralAnio}</div>
            <div className="kpi-desglose-pills">
              <span className="kpi-mini-pill activo">
                Activos: <strong>{totalActivosAnio}</strong>
              </span>
              <span className="kpi-mini-pill inactivo">
                Inactivos: <strong>{totalInactivosAnio}</strong>
              </span>
            </div>
          </div>
        </div>

        <div className="kpi-card">
          <div className="kpi-icon-box"><Calendar /></div>
          <div className="kpi-content">
            <span className="kpi-title">LUP del mes</span>
            <div className="kpi-main-val">{totalLupMes}</div>
          </div>
        </div>

        <div className="kpi-card">
          <div className="kpi-icon-box"><GraduationCap /></div>
          <div className="kpi-content">
            <span className="kpi-title">% Entrenamientos</span>
            <div className="kpi-main-val">{pctEntrenados}%</div>
            <span className="kpi-subtext">({entrenados} / {totalLupAnio} LUP)</span>
          </div>
        </div>

        <div className="kpi-card">
          <div className="kpi-icon-box"><Lightbulb /></div>
          <div className="kpi-content">
            <span className="kpi-title">% Conversión a Kaizen</span>
            <div className="kpi-main-val">{pctKaizen}%</div>
            <span className="kpi-subtext">({kaizenSi} LUP)</span>
          </div>
        </div>

        <div className="kpi-card">
          <div className="kpi-icon-box"><Leaf /></div>
          <div className="kpi-content">
            <span className="kpi-title">Impacto CO₂</span>
            <div className="kpi-main-val">{totalCO2 || 0} kg CO₂e</div>
            <span className="kpi-subtext">Ahorro acumulado</span>
          </div>
        </div>
      </section>

      {/* FILA MEDIA */}
      <section className="dashboard-grid-row middle-row">
        {/* Tendencia de LUP (Activos + Inactivos + Total + Línea Tendencia) */}
        <div className="dash-card tendencia-card">
          <div className="tendencia-header-top">
            <div className="card-header-line" style={{ marginBottom: 0 }}>
              <TrendingUp className="icon-sec" />
              <div>
                <h3>Tendencia de LUP</h3>
                <p>Evolución mensual: Activos, Inactivos y Total</p>
              </div>
            </div>

            <div className="tendencia-resumen-pills">
              <span className="t-pill total">
                Total: <strong>{resumenTendencia.total}</strong>
              </span>
              <span className="t-pill activo">
                Activos: <strong>{resumenTendencia.activos}</strong>
              </span>
              <span className="t-pill inactivo">
                Inactivos: <strong>{resumenTendencia.inactivos}</strong>
              </span>
            </div>
          </div>

          <div className="native-chart-box">
            <div className="bars-plot-area">
              {/* Líneas guía horizontales */}
              <div className="chart-gridlines" aria-hidden="true">
                <span style={{ bottom: '25%' }} />
                <span style={{ bottom: '50%' }} />
                <span style={{ bottom: '75%' }} />
                <span style={{ bottom: '100%' }} />
              </div>

              {/* Línea SVG de tendencia que une los totales mensuales */}
              {tendenciaData.length > 1 && (
                <svg
                  className="trend-line-svg"
                  viewBox="0 0 1000 1000"
                  preserveAspectRatio="none"
                  aria-hidden="true"
                >
                  <polyline
                    fill="none"
                    stroke="#0369a1"
                    strokeWidth="2.6"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    vectorEffect="non-scaling-stroke"
                    points={trendPolylinePoints}
                  />
                </svg>
              )}

              {/* Columnas mensuales */}
              <div className="native-bars-container">
                {tendenciaData.map((item, i) => {
                  const totalPct = (item.total / maxValTendencia) * 100;
                  const esMesActual = i === Number(mesSeleccionado);

                  return (
                    <div
                      key={item.mesIdx}
                      className={`bar-col ${esMesActual ? 'is-selected' : ''}`}
                      onClick={() => setMesSeleccionado(item.mesIdx)}
                      title={`${item.mesNombre}: Total ${item.total} (Activos: ${item.activos} | Inactivos: ${item.inactivos})`}
                    >
                      {/* Tooltip flotante al pasar el mouse */}
                      <div className="bar-hover-tooltip">
                        <strong>{item.mesNombre}</strong>
                        <span>Total: <b>{item.total}</b></span>
                        <span className="tt-act">Activos: <b>{item.activos}</b></span>
                        <span className="tt-ina">Inactivos: <b>{item.inactivos}</b></span>
                      </div>

                      {/* Valor Total sobre el nodo de tendencia */}
                      <span
                        className="bar-val-top"
                        style={{ bottom: `calc(${totalPct}% + 10px)` }}
                      >
                        {item.total}
                      </span>

                      {/* Nodo circular de la línea de tendencia */}
                      <span
                        className="trend-dot-node"
                        style={{ bottom: `${totalPct}%` }}
                      />

                      {/* Barra apilada (Inactivos arriba, Activos abajo) */}
                      <div
                        className={`bar-stack-wrapper ${esMesActual ? 'selected-bar' : ''}`}
                        style={{
                          height: `${totalPct}%`,
                          minHeight: item.total > 0 ? '8px' : '0px'
                        }}
                      >
                        {item.inactivos > 0 && (
                          <div
                            className="bar-seg-inactivo"
                            style={{
                              height: `${(item.inactivos / item.total) * 100}%`
                            }}
                          >
                            <span>{item.inactivos}</span>
                          </div>
                        )}

                        {item.activos > 0 && (
                          <div className="bar-seg-activo">
                            {totalPct >= 14 && <span>{item.activos}</span>}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Eje X de meses */}
            <div className="bars-xaxis-row">
              {tendenciaData.map((item, i) => (
                <span
                  key={item.mesIdx}
                  className={`bar-label ${i === Number(mesSeleccionado) ? 'active-month' : ''}`}
                  onClick={() => setMesSeleccionado(item.mesIdx)}
                >
                  {item.mesCorto}
                </span>
              ))}
            </div>

            {/* Leyenda inferior */}
            <div className="chart-legend-bottom">
              <span>
                <span className="legend-box-activo"></span> Activos ({resumenTendencia.activos})
              </span>
              <span>
                <span className="legend-box-inactivo"></span> Inactivos ({resumenTendencia.inactivos})
              </span>
              <span className="legend-trend-item">
                <svg width="24" height="12" viewBox="0 0 24 12" aria-hidden="true">
                  <line x1="1" y1="6" x2="23" y2="6" stroke="#0369a1" strokeWidth="2.5" strokeLinecap="round" />
                  <circle cx="12" cy="6" r="3.8" fill="#ffffff" stroke="#0369a1" strokeWidth="2.3" />
                </svg>
                Tendencia Total ({resumenTendencia.total})
              </span>
            </div>
          </div>
        </div>

        {/* LUP por Tipo */}
        <div className="dash-card donut-card tipo-donut-card">
          <div className="card-header-line">
            <Tag className="icon-sec" />
            <div>
              <h3>LUP por Tipo</h3>
              <p>Distribución por clasificación (clic para fijar)</p>
            </div>
          </div>

          <div className="donut-content-layout tipo-layout">
            <SvgDonut
              sizeClass="donut-lg"
              slices={tiposSlices}
              totalCenter={totalLupAnio}
              subtitleCenter="TOTAL LUP"
              activeIdx={activeTipoIdx}
              onHoverSlice={setHoveredTipoIdx}
              onSelectSlice={toggleSelectTipo}
            />

            <div className="custom-legend tipo-legend-cards">
              {tiposSlices.map((item, idx) => {
                const isSelected = activeTipoIdx === idx;
                return (
                  <button
                    key={item.label}
                    type="button"
                    className={`tipo-legend-item ${isSelected ? 'is-selected' : ''}`}
                    onMouseEnter={() => setHoveredTipoIdx(idx)}
                    onMouseLeave={() => setHoveredTipoIdx(null)}
                    onClick={() => toggleSelectTipo(idx)}
                  >
                    <div className="tipo-leg-top">
                      <div className="legend-row">
                        <span className="dot" style={{ backgroundColor: item.color }} />
                        <span className="tipo-leg-name">{item.label}</span>
                      </div>
                      <div className="tipo-leg-nums">
                        <strong>{item.count}</strong>
                        <span className="tipo-pct-badge">{item.pct}%</span>
                      </div>
                    </div>

                    <div className="tipo-mini-track">
                      <div
                        className="tipo-mini-fill"
                        style={{
                          width: `${item.pct}%`,
                          backgroundColor: item.color
                        }}
                      />
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Top 5 Colaboradores */}
        <div className="dash-card top5-card">
          <div className="top5-header">
            <Award className="icon-sec" />
            <h3>Top 5 Colaboradores</h3>
          </div>
          <div className="top5-list">
            {topColaboradores.map((colab, idx) => {
              const medallas = ['🥇', '🥈', '🥉'];
              return (
                <div key={idx} className="top-item-row">
                  <div className="top-rank">
                    {idx < 3 ? medallas[idx] : <span className="top-rank-num">{idx + 1}</span>}
                  </div>
                  <div className="top-avatar">
                    {colab.foto_url ? (
                      <img src={colab.foto_url} alt={colab.nombre} />
                    ) : (
                      <div className="avatar-placeholder">{colab.nombre.charAt(0)}</div>
                    )}
                  </div>
                  <div className="top-info">
                    <span className="top-nombre">{colab.nombre}</span>
                    <span className="top-area">{colab.area}</span>
                  </div>
                  <div className="top-badge-count">{colab.total}</div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* FILA INFERIOR */}
      <section className="dashboard-grid-row bottom-row">
        {/* Estado LUP */}
        <div className="dash-card donut-card">
          <div className="banner-header">
            <CheckSquare className="icon-sec" />
            <h3>Estado de LUP</h3>
          </div>
          <div className="donut-content-layout bottom-donut-layout">
            <SvgDonut
              sizeClass="donut-lg"
              strokeWidth={6.8}
              slices={estadoSlices}
              totalCenter={totalLupAnio}
              subtitleCenter="LUP"
              activeIdx={activeEstadoIdx}
              onHoverSlice={setHoveredEstadoIdx}
              onSelectSlice={(idx) => setSelectedEstadoIdx(prev => (prev === idx ? null : idx))}
            />

            <div className="custom-legend metrics-legend-cards">
              {estadoSlices.map((item, idx) => {
                const isSelected = activeEstadoIdx === idx;
                return (
                  <button
                    key={item.label}
                    type="button"
                    className={`estado-metric-card ${isSelected ? 'is-selected' : ''}`}
                    onMouseEnter={() => setHoveredEstadoIdx(idx)}
                    onMouseLeave={() => setHoveredEstadoIdx(null)}
                    onClick={() => setSelectedEstadoIdx(prev => (prev === idx ? null : idx))}
                  >
                    <div className="em-card-top">
                      <div className="legend-row">
                        <span
                          className="dot"
                          style={{
                            backgroundColor: item.color,
                            border: idx === 1 ? '1px solid #7dd3fc' : 'none'
                          }}
                        />
                        <span className="em-card-label">{item.label}</span>
                      </div>
                      <span className="em-pct-pill">{item.pct}%</span>
                    </div>

                    <div className="em-card-bottom">
                      <strong className="em-card-val">{item.count}</strong>
                      <span className="em-card-unit">LUP</span>
                    </div>

                    <div className="tipo-mini-track">
                      <div
                        className="tipo-mini-fill"
                        style={{
                          width: `${item.pct}%`,
                          backgroundColor: idx === 0 ? '#0284c7' : '#7dd3fc'
                        }}
                      />
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Conversión Kaizen */}
        <div className="dash-card donut-card">
          <div className="banner-header">
            <Cog className="icon-sec" />
            <h3>Conversión a Kaizen</h3>
          </div>
          <div className="donut-content-layout bottom-donut-layout">
            <SvgDonut
              sizeClass="donut-lg"
              strokeWidth={6.8}
              slices={kaizenSlices}
              totalCenter={totalLupAnio}
              subtitleCenter="LUP"
              activeIdx={activeKaizenIdx}
              onHoverSlice={setHoveredKaizenIdx}
              onSelectSlice={(idx) => setSelectedKaizenIdx(prev => (prev === idx ? null : idx))}
            />

            <div className="custom-legend metrics-legend-cards">
              {kaizenSlices.map((item, idx) => {
                const isSelected = activeKaizenIdx === idx;
                return (
                  <button
                    key={item.label}
                    type="button"
                    className={`estado-metric-card ${isSelected ? 'is-selected' : ''}`}
                    onMouseEnter={() => setHoveredKaizenIdx(idx)}
                    onMouseLeave={() => setHoveredKaizenIdx(null)}
                    onClick={() => setSelectedKaizenIdx(prev => (prev === idx ? null : idx))}
                  >
                    <div className="em-card-top">
                      <div className="legend-row">
                        <span
                          className="dot"
                          style={{
                            backgroundColor: item.color,
                            border: idx === 1 ? '1px solid #7dd3fc' : 'none'
                          }}
                        />
                        <span className="em-card-label">{item.label}</span>
                      </div>
                      <span className="em-pct-pill">{item.pct}%</span>
                    </div>

                    <div className="em-card-bottom">
                      <strong className="em-card-val">{item.count}</strong>
                      <span className="em-card-unit">LUP</span>
                    </div>

                    <div className="tipo-mini-track">
                      <div
                        className="tipo-mini-fill"
                        style={{
                          width: `${item.pct}%`,
                          backgroundColor: idx === 0 ? '#0284c7' : '#7dd3fc'
                        }}
                      />
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* LUP por Área */}
        <div className="dash-card area-card">
          <div className="banner-header">
            <Building2 className="icon-sec" />
            <h3>LUP por Área</h3>
          </div>
          <div className="horizontal-bars-native">
            {lupPorArea.map(([nombre, cant], idx) => {
              const ancho = Math.round((cant / maxValArea) * 100);
              const esSeleccionada =
                areaSeleccionada !== 'TODAS' &&
                areaSeleccionada.toLowerCase() === nombre.toLowerCase();
              const opaca = areaSeleccionada !== 'TODAS' && !esSeleccionada;

              return (
                <div
                  key={nombre}
                  className={`h-bar-item ${esSeleccionada ? 'is-selected' : ''}`}
                  style={{ opacity: opaca ? 0.45 : 1 }}
                  onClick={() =>
                    setAreaSeleccionada((prev) => (prev === nombre ? 'TODAS' : nombre))
                  }
                  title={`Clic para ${esSeleccionada ? 'ver todas las áreas' : `filtrar por ${nombre}`}`}
                >
                  <span className="h-bar-title" title={nombre}>
                    {nombre}
                  </span>

                  <div className="h-bar-track-inline">
                    <div
                      className="h-bar-fill"
                      style={{
                        width: `${ancho}%`,
                        background: COLORES_AREA[idx] || COLORES_AREA[COLORES_AREA.length - 1]
                      }}
                    />
                    <span className="h-bar-count">{cant}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

      </section>
    </div>
  );
}

export default function DashboardLup(props) {
  return (
    <div className="hco-scope hco-dashboard-lup">
      <DashboardLupContenido {...props} />
    </div>
  );
}