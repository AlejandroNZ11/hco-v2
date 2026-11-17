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

const MESES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
];

const MESES_ABR = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Set', 'Oct', 'Nov', 'Dic'];

// Extrae { anio, mes } (mes 0-11) sin que new Date("YYYY-MM-DD") reste horas por UTC
const extraerAnioMes = (fechaRaw) => {
  if (!fechaRaw) return null;
  const match = String(fechaRaw).trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match) {
    return {
      anio: Number(match[1]),
      mes: Number(match[2]) - 1 // 0 = Enero ... 11 = Diciembre
    };
  }
  const d = new Date(fechaRaw);
  return isNaN(d.getTime()) ? null : { anio: d.getFullYear(), mes: d.getMonth() };
};

function SvgDonut({ slices, totalCenter, subtitleCenter }) {
  let acumulado = 0;
  const radius = 15.9155;

  return (
    <div className="donut-chart-container">
      <svg viewBox="0 0 42 42" className="donut-svg">
        <circle cx="21" cy="21" r={radius} fill="#ffffff" />
        {slices.map((slice, idx) => {
          const valPct = Math.max(0, Math.min(100, Number(slice.pct) || 0));
          if (valPct === 0) return null;

          const dashArray = `${valPct} ${100 - valPct}`;
          const dashOffset = 25 - acumulado;
          acumulado += valPct;

          return (
            <circle
              key={idx}
              cx="21"
              cy="21"
              r={radius}
              fill="none"
              stroke={slice.color}
              strokeWidth="5"
              strokeDasharray={dashArray}
              strokeDashoffset={dashOffset}
            />
          );
        })}
      </svg>
      <div className="donut-center-label">
        <span className="center-num">{totalCenter}</span>
        <span className="center-sub">{subtitleCenter}</span>
      </div>
    </div>
  );
}

function DashboardLupContenido() {
  const currentYear = new Date().getFullYear();
  const currentMonth = new Date().getMonth();

  const [anioSeleccionado, setAnioSeleccionado] = useState(currentYear);
  const [mesSeleccionado, setMesSeleccionado] = useState(currentMonth);
  const [areaSeleccionada, setAreaSeleccionada] = useState('TODAS');

  const [lups, setLups] = useState([]);
  const [empleadosMap, setEmpleadosMap] = useState({});

  useEffect(() => {
    cargarDatos();
  }, []);

  const cargarDatos = async () => {
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
    }
  };

  // 1. Años disponibles desde fecha_lup
  const aniosDisponibles = useMemo(() => {
    const aniosSet = new Set([currentYear]);
    lups.forEach(l => {
      if (String(l.operatividad || '').toUpperCase() === 'INACTIVO') return;
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

  // 3. Filtrado por Operatividad, Año y Área
  const lupsFiltradasAnioYArea = useMemo(() => {
    return lups.filter(l => {
      if (String(l.operatividad || '').toUpperCase() === 'INACTIVO') return false;

      const ym = extraerAnioMes(l.fecha_lup || l.fecha_registro);
      if (!ym || ym.anio !== Number(anioSeleccionado)) return false;

      if (areaSeleccionada !== 'TODAS') {
        const areaLup = (l.area || '').trim();
        if (areaLup.toLowerCase() !== areaSeleccionada.toLowerCase()) return false;
      }

      return true;
    });
  }, [lups, anioSeleccionado, areaSeleccionada]);

  // 4. Filtrado del Mes (coincide 100% con la barra del gráfico)
  const lupsDelMes = useMemo(() => {
    return lupsFiltradasAnioYArea.filter(l => {
      const ym = extraerAnioMes(l.fecha_lup || l.fecha_registro);
      return ym && ym.mes === Number(mesSeleccionado);
    });
  }, [lupsFiltradasAnioYArea, mesSeleccionado]);

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

  const totalCO2 = useMemo(() => {
    return lupsFiltradasAnioYArea.reduce((acc, curr) => {
      const num = parseFloat(curr.impacto_co2);
      return acc + (isNaN(num) ? 0 : num);
    }, 0);
  }, [lupsFiltradasAnioYArea]);

  // Tendencia mensual
  const mesesHasta = anioSeleccionado === currentYear ? currentMonth + 1 : 12;
  const tendenciaData = useMemo(() => {
    const counts = Array(12).fill(0);
    lupsFiltradasAnioYArea.forEach(l => {
      const ym = extraerAnioMes(l.fecha_lup || l.fecha_registro);
      if (ym) counts[ym.mes]++;
    });
    return counts.slice(0, mesesHasta);
  }, [lupsFiltradasAnioYArea, mesesHasta]);

  const maxValTendencia = Math.max(...tendenciaData, 5);

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

  // LUP por Área (Muestra distribución de áreas del año)
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
      {/* HEADER */}
      <header className="dashboard-header-card">
        <div className="header-titles">
          <span className="badge-kpi-pill">INDICADORES OPERATIVOS</span>
          <h1 className="title-text">Tablero de LUP's</h1>
        </div>

        <div className="header-filters">
          {/* Filtro Área */}
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

          {/* Filtro Año */}
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

          {/* Filtro Mes */}
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
            <div className="kpi-main-val">{totalLupAnio}</div>
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
        {/* Tendencia */}
        <div className="dash-card tendencia-card">
          <div className="card-header-line">
            <TrendingUp className="icon-sec" />
            <div>
              <h3>Tendencia de LUP</h3>
              <p>Evolución mensual de registros</p>
            </div>
          </div>
          <div className="native-chart-box">
            <div className="native-bars-container">
              {tendenciaData.map((val, i) => {
                const heightPct = Math.round((val / maxValTendencia) * 100);
                return (
                  <div key={i} className="bar-col">
                    <span className="bar-val-top">{val}</span>
                    <div className="bar-track">
                      <div
                        className="bar-fill"
                        style={{
                          height: `${heightPct}%`,
                          backgroundColor: i === Number(mesSeleccionado) ? '#0369a1' : undefined
                        }}
                      />
                    </div>
                    <span className="bar-label">{MESES_ABR[i]}</span>
                  </div>
                );
              })}
            </div>
            <div className="chart-legend-bottom">
              <span><span className="legend-box-bar"></span> N° de LUP</span>
              <span><span className="legend-line-dot"></span> Tendencia</span>
            </div>
          </div>
        </div>

        {/* LUP por Tipo */}
        <div className="dash-card donut-card">
          <div className="card-header-line">
            <Tag className="icon-sec" />
            <h3>LUP por Tipo</h3>
          </div>
          <div className="donut-content-layout">
            <SvgDonut
              slices={[
                { pct: pctMejora, color: '#0369a1' },
                { pct: pctProblema, color: '#0ea5e9' },
                { pct: pctBasica, color: '#38bdf8' }
              ]}
              totalCenter={totalLupAnio}
              subtitleCenter="LUP"
            />
            <div className="custom-legend">
              <div className="legend-row">
                <span className="dot" style={{ backgroundColor: '#0369a1' }}></span>
                <span>Mejora ({pctMejora}%)</span>
              </div>
              <div className="legend-row">
                <span className="dot" style={{ backgroundColor: '#0ea5e9' }}></span>
                <span>Problema ({pctProblema}%)</span>
              </div>
              <div className="legend-row">
                <span className="dot" style={{ backgroundColor: '#38bdf8' }}></span>
                <span>Condición Básica ({pctBasica}%)</span>
              </div>
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
                    {idx < 3 ? medallas[idx] : idx + 1}
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
          <div className="donut-content-layout">
            <SvgDonut
              slices={[
                { pct: pctEntrenados, color: '#0284c7' },
                { pct: pctNoEntrenados, color: '#bae6fd' }
              ]}
              totalCenter={totalLupAnio}
              subtitleCenter="LUP"
            />
            <div className="custom-legend metrics-legend">
              <div className="legend-metric">
                <div className="legend-row">
                  <span className="dot" style={{ backgroundColor: '#0284c7' }}></span>
                  <span>Entrenado ({pctEntrenados}%)</span>
                </div>
                <strong className="metric-val">{entrenados}</strong>
              </div>
              <div className="legend-metric">
                <div className="legend-row">
                  <span className="dot" style={{ backgroundColor: '#bae6fd' }}></span>
                  <span>No Entrenado ({pctNoEntrenados}%)</span>
                </div>
                <strong className="metric-val">{noEntrenados}</strong>
              </div>
            </div>
          </div>
        </div>

        {/* Conversión Kaizen */}
        <div className="dash-card donut-card">
          <div className="banner-header">
            <Cog className="icon-sec" />
            <h3>Conversión a Kaizen</h3>
          </div>
          <div className="donut-content-layout">
            <SvgDonut
              slices={[
                { pct: pctKaizen, color: '#0284c7' },
                { pct: 100 - pctKaizen, color: '#bae6fd' }
              ]}
              totalCenter={totalLupAnio}
              subtitleCenter="LUP"
            />
            <div className="custom-legend metrics-legend">
              <div className="legend-metric">
                <div className="legend-row">
                  <span className="dot" style={{ backgroundColor: '#0284c7' }}></span>
                  <span>Convirtió a Kaizen</span>
                </div>
                <strong className="metric-val">{kaizenSi} LUP</strong>
              </div>
              <div className="legend-metric">
                <div className="legend-row">
                  <span className="dot" style={{ backgroundColor: '#bae6fd' }}></span>
                  <span>Sin conversión</span>
                </div>
                <strong className="metric-val">{kaizenNo} LUP</strong>
              </div>
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
              return (
                <div key={idx} className="h-bar-item">
                  <span className="h-bar-title" title={nombre}>{nombre}</span>
                  <div className="h-bar-track">
                    <div
                      className="h-bar-fill"
                      style={{
                        width: `${ancho}%`,
                        backgroundColor: idx === 0 ? '#0369a1' : idx === 1 ? '#0284c7' : '#38bdf8'
                      }}
                    />
                  </div>
                  <span className="h-bar-count">{cant}</span>
                </div>
              );
            })}
          </div>
        </div>
      </section>
    </div>
  );
}

// Envoltorio: los estilos de este módulo solo aplican dentro de este div
export default function DashboardLup(props) {
  return (
    <div className="hco-scope hco-dashboard-lup">
      <DashboardLupContenido {...props} />
    </div>
  );
}