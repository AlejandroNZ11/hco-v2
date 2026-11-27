import { useEffect } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { FaArrowLeft, FaUndo, FaChartBar, FaCoins } from 'react-icons/fa';
import { MESES } from './usePrestamosDashboard';

/* =========================================================================
   HEADER: pestañas Operacional / Financiero + filtros
   ========================================================================= */
export function HeaderPrestamos({ titulo, badge, d }) {
  const navigate = useNavigate();

  // Precarga el código de ambas pestañas para que el cambio sea inmediato
  useEffect(() => {
    import('./DashboardPrestamosOperacional');
    import('./DashboardPrestamosFinanciero');
  }, []);
  const { filtros, setAnio, setMes, setCliente, setTipo, limpiarFiltros } = d;
  const hayFiltros = filtros.mes !== 'TODOS' || filtros.cliente !== 'TODOS' || filtros.tipo !== 'TODOS';

  return (
    <header className="dashboard-header-card dp-header">
      <div className="header-titles">
        <span className="badge-kpi-pill">{badge}</span>
        <h1 className="title-text">{titulo}</h1>
        <nav className="dp-tabs">
          <button type="button" className="dp-tab dp-tab-back" onClick={() => navigate('/prestamos/tracking')} title="Volver al tracking">
            <FaArrowLeft /> <span>Tracking</span>
          </button>
          <NavLink end to="/prestamos/dashboard" className={({ isActive }) => `dp-tab ${isActive ? 'is-active' : ''}`}>
            <FaChartBar /> <span>Operacional</span>
          </NavLink>
          <NavLink to="/prestamos/dashboard/financiero" className={({ isActive }) => `dp-tab ${isActive ? 'is-active' : ''}`}>
            <FaCoins /> <span>Financiero</span>
          </NavLink>
        </nav>
      </div>

      <div className="header-filters dp-filters">
        <div className="filter-group">
          <label>AÑO</label>
          <select value={filtros.anio} onChange={(e) => setAnio(Number(e.target.value))}>
            {d.aniosDisponibles.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </div>
        <div className="filter-group">
          <label>MES</label>
          <select
            value={filtros.mes}
            onChange={(e) => setMes(e.target.value === 'TODOS' ? 'TODOS' : Number(e.target.value))}
          >
            <option value="TODOS">Todo el año</option>
            {MESES.map((m, i) => <option key={m} value={i}>{m}</option>)}
          </select>
        </div>
        <div className="filter-group">
          <label>CLIENTE</label>
          <select value={filtros.cliente} onChange={(e) => setCliente(e.target.value)}>
            <option value="TODOS">Todos los clientes</option>
            {d.clientesDisponibles.map((c) => <option key={c.key} value={c.key}>{c.nombre}</option>)}
          </select>
        </div>
        <div className="filter-group">
          <label>TIPO PALETA</label>
          <select value={filtros.tipo} onChange={(e) => setTipo(e.target.value)}>
            <option value="TODOS">Todos</option>
            {d.tiposDisponibles.map((t) => <option key={t.id} value={t.id}>{t.nombre}</option>)}
          </select>
        </div>
        <button
          type="button"
          className="dp-btn-clear"
          onClick={limpiarFiltros}
          disabled={!hayFiltros}
          title="Quitar filtros de mes, cliente y tipo"
        >
          <FaUndo />
        </button>
      </div>
    </header>
  );
}

/* =========================================================================
   KPI
   ========================================================================= */
export function KpiCard({ icon, title, value, sub, tone = 'blue', highlight = false, children }) {
  return (
    <div className={`kpi-card dp-kpi tone-${tone} ${highlight ? 'is-highlight' : ''}`}>
      <div className="kpi-icon-box">{icon}</div>
      <div className="kpi-content">
        <span className="kpi-title">{title}</span>
        <div className="kpi-main-val">{value}</div>
        {sub && <span className="kpi-subtext">{sub}</span>}
        {children}
      </div>
    </div>
  );
}

/* =========================================================================
   TARJETA CON CABECERA BANNER
   ========================================================================= */
export function DashCard({ icon, title, subtitle, className = '', aside, children, note, noteTone = 'red' }) {
  return (
    <div className={`dash-card ${className}`}>
      <div className="banner-header dp-banner">
        {icon}
        <div className="dp-banner-titles">
          <h3>{title}</h3>
          {subtitle && <span>{subtitle}</span>}
        </div>
        {aside && <div className="dp-banner-aside">{aside}</div>}
      </div>
      {children}
      {note && <div className={`dp-card-note tone-${noteTone}`}>{note}</div>}
    </div>
  );
}

/* =========================================================================
   DONUT (mismo comportamiento que el de LUP)
   ========================================================================= */
export function SvgDonut({ slices, totalCenter, subtitleCenter, activeIdx = null, onHoverSlice, onSelectSlice, unidad = '', strokeWidth = 6.8 }) {
  const radius = 15.9155;
  const offsets = slices.reduce((acc, s, i) => {
    acc.push(i === 0 ? 0 : acc[i - 1] + Math.max(0, Math.min(100, Number(slices[i - 1].pct) || 0)));
    return acc;
  }, []);
  const activeSlice = activeIdx !== null ? slices[activeIdx] : null;

  return (
    <div className="donut-chart-container donut-lg">
      {activeSlice && (
        <div className="donut-hover-tooltip">
          <div className="d-tt-head">
            <span className="dot" style={{ backgroundColor: activeSlice.color }} />
            <strong>{activeSlice.label}</strong>
          </div>
          <div className="d-tt-body">
            <span>Cantidad: <b>{activeSlice.count} {unidad}</b></span>
            <span>Participación: <b>{activeSlice.pct}%</b></span>
          </div>
        </div>
      )}
      <svg viewBox="0 0 42 42" className="donut-svg">
        <circle cx="21" cy="21" r={radius} fill="#ffffff" />
        <circle cx="21" cy="21" r={radius} fill="none" stroke="#f1f5f9" strokeWidth={strokeWidth} />
        {slices.map((slice, idx) => {
          const valPct = Math.max(0, Math.min(100, Number(slice.pct) || 0));
          if (valPct === 0) return null;
          const dashOffset = 25 - offsets[idx];
          const isSelected = activeIdx === idx;
          const isDimmed = activeIdx !== null && !isSelected;
          return (
            <circle
              key={slice.key || idx}
              cx="21"
              cy="21"
              r={radius}
              fill="none"
              stroke={slice.color}
              strokeWidth={isSelected ? strokeWidth + 1 : strokeWidth}
              strokeDasharray={`${valPct} ${100 - valPct}`}
              strokeDashoffset={dashOffset}
              className="donut-slice-circle"
              style={{ opacity: isDimmed ? 0.35 : 1, pointerEvents: 'stroke' }}
              onMouseEnter={() => onHoverSlice && onHoverSlice(idx)}
              onMouseLeave={() => onHoverSlice && onHoverSlice(null)}
              onClick={() => onSelectSlice && onSelectSlice(idx)}
            />
          );
        })}
      </svg>
      <div className="donut-center-label">
        <span className="center-num">{activeSlice ? activeSlice.count : totalCenter}</span>
        <span className="center-sub">{activeSlice ? activeSlice.label : subtitleCenter}</span>
        {activeSlice && (
          <span className="center-pct-pill" style={{ color: activeSlice.color }}>{activeSlice.pct}%</span>
        )}
      </div>
    </div>
  );
}

/* =========================================================================
   GRÁFICO DE COLUMNAS (agrupadas) CON LÍNEA OPCIONAL EN SEGUNDO EJE
   data: [{ label, nombre?, [serie.key]: number, ... }]
   series: [{ key, label, color }]
   line: { key, label, color, format }
   ========================================================================= */
export function ColumnChart({
  data,
  series,
  line,
  format = (v) => v,
  selectedIdx = null,
  onSelect,
  labelsInside = false,
  topLabel,
  emptyText = 'Sin datos para el periodo'
}) {
  const maxBar = Math.max(1, ...data.flatMap((d) => series.map((s) => Number(d[s.key]) || 0)));
  const maxLine = line ? Math.max(1, ...data.map((d) => Number(d[line.key]) || 0)) : 1;
  const n = data.length;
  const hayDatos = data.some((d) => series.some((s) => Number(d[s.key]) > 0));

  // la línea ocupa la franja superior para no tapar las barras
  const yLinea = (v) => 0.12 + (1 - (Number(v) || 0) / maxLine) * 0.38;
  const puntos = line
    ? data.map((d, i) => `${((i + 0.5) / n) * 1000},${yLinea(d[line.key]) * 1000}`).join(' ')
    : '';

  return (
    <div className="native-chart-box dp-colchart">
      <div className={`bars-plot-area ${topLabel ? 'has-toplabel' : ''}`}>
        <div className="chart-gridlines" aria-hidden="true">
          <span style={{ bottom: '25%' }} />
          <span style={{ bottom: '50%' }} />
          <span style={{ bottom: '75%' }} />
          <span style={{ bottom: '100%' }} />
        </div>

        {!hayDatos && <div className="dp-empty">{emptyText}</div>}

        {line && n > 1 && hayDatos && (
          <svg className="trend-line-svg" viewBox="0 0 1000 1000" preserveAspectRatio="none" aria-hidden="true">
            <polyline
              fill="none"
              stroke={line.color}
              strokeWidth="2.6"
              strokeLinecap="round"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
              points={puntos}
            />
          </svg>
        )}

        <div className="native-bars-container">
          {data.map((d, i) => {
            const isSel = selectedIdx === i;
            const dim = selectedIdx !== null && !isSel;
            return (
              <div
                key={d.key ?? d.label}
                className={`bar-col dp-col ${isSel ? 'is-selected' : ''} ${onSelect ? '' : 'no-click'}`}
                style={{ opacity: dim ? 0.5 : 1 }}
                onClick={() => onSelect && onSelect(i)}
              >
                <div className="bar-hover-tooltip">
                  <strong>{d.nombre || d.label}</strong>
                  {series.map((s) => (
                    <span key={s.key}>
                      <i className="dp-tt-dot" style={{ background: s.color }} /> {s.label}: <b>{format(d[s.key])}</b>
                    </span>
                  ))}
                  {line && (
                    <span>
                      <i className="dp-tt-dot" style={{ background: line.color }} /> {line.label}: <b>{line.format(d[line.key])}</b>
                    </span>
                  )}
                </div>

                {line && hayDatos && (
                  <>
                    <span className="trend-dot-node dp-line-dot" style={{ bottom: `${(1 - yLinea(d[line.key])) * 100}%`, borderColor: line.color }} />
                    <span className="dp-line-label" style={{ bottom: `calc(${(1 - yLinea(d[line.key])) * 100}% + 9px)`, color: line.color, borderColor: line.color }}>
                      {line.format(d[line.key])}
                    </span>
                  </>
                )}

                <div className="dp-bar-group">
                  {series.map((s, si) => {
                    const v = Number(d[s.key]) || 0;
                    const pct = v / maxBar;
                    const inside = labelsInside && pct > 0.14;
                    const reservado = topLabel ? 44 : 18;
                    return (
                      <div key={s.key} className="dp-bar-slot">
                        {topLabel && si === 0 && hayDatos && <span className="dp-toplabel">{topLabel(d)}</span>}
                        {!inside && v > 0 && <span className="dp-bar-val">{format(v)}</span>}
                        <div
                          className={`dp-bar ${isSel ? 'selected-bar' : ''}`}
                          style={{
                            height: `calc((100% - ${reservado}px) * ${pct})`,
                            minHeight: v > 0 ? 3 : 0,
                            background: s.color
                          }}
                        >
                          {inside && <span className="dp-bar-val-in">{format(v)}</span>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="bars-xaxis-row">
        {data.map((d, i) => (
          <span
            key={d.key ?? d.label}
            className={`bar-label ${selectedIdx === i ? 'active-month' : ''}`}
            onClick={() => onSelect && onSelect(i)}
          >
            {d.label}
          </span>
        ))}
      </div>

      <div className="chart-legend-bottom">
        {series.map((s) => (
          <span key={s.key}>
            <span className="dp-legend-box" style={{ background: s.color }} /> {s.label}
          </span>
        ))}
        {line && (
          <span className="legend-trend-item" style={{ color: line.color }}>
            <svg width="24" height="12" viewBox="0 0 24 12" aria-hidden="true">
              <line x1="1" y1="6" x2="23" y2="6" stroke={line.color} strokeWidth="2.5" strokeLinecap="round" />
              <circle cx="12" cy="6" r="3.8" fill="#ffffff" stroke={line.color} strokeWidth="2.3" />
            </svg>
            {line.label}
          </span>
        )}
      </div>
    </div>
  );
}

/* =========================================================================
   BARRAS HORIZONTALES (ranking) – clic para filtrar
   ========================================================================= */
export function HBarList({ items, valueKey, format, color, selectedKey, onSelect, emptyText = 'Sin saldo pendiente' }) {
  const max = Math.max(1, ...items.map((i) => i[valueKey]));
  if (!items.length) return <div className="dp-empty static">{emptyText}</div>;
  return (
    <div className="horizontal-bars-native dp-hbars">
      {items.map((it) => {
        const isSel = selectedKey === it.key;
        const dim = selectedKey && selectedKey !== 'TODOS' && !isSel;
        return (
          <div
            key={it.key}
            className={`h-bar-item ${isSel ? 'is-selected' : ''}`}
            style={{ opacity: dim ? 0.45 : 1 }}
            onClick={() => onSelect && onSelect(it.key)}
            title={isSel ? 'Clic para ver todos los clientes' : `Clic para filtrar por ${it.nombre}`}
          >
            <span className="h-bar-title" title={it.nombre}>{it.nombre}</span>
            <div className="h-bar-track-inline">
              <div
                className="h-bar-fill"
                style={{ width: `${Math.round((it[valueKey] / max) * 100)}%`, background: color }}
              />
              <span className="h-bar-count">{format(it[valueKey])}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* =========================================================================
   LÍNEA DE VARIACIÓN % (con línea base 0% = presupuesto)
   data: [{ label, nombre, variacion }]
   ========================================================================= */
export function VariationChart({ data, baseLabel, lineLabel, color = '#f97316', baseColor = '#0b2a55', selectedIdx = null, onSelect }) {
  const vals = data.map((d) => Number(d.variacion) || 0);
  const hi = Math.max(10, ...vals) + 10;
  const lo = Math.min(-10, ...vals) - 10;
  const y = (v) => ((hi - v) / (hi - lo)) * 100; // % desde arriba
  const n = data.length;
  const x = (i) => ((i + 0.5) / Math.max(n, 1)) * 100;
  const ticks = [];
  const paso = Math.max(10, Math.ceil((hi - lo) / 5 / 10) * 10);
  for (let t = Math.ceil(lo / paso) * paso; t <= hi; t += paso) ticks.push(t);

  return (
    <div className="native-chart-box dp-varchart">
      <div className="dp-var-plot">
        <div className="dp-var-yaxis">
          {ticks.map((t) => <span key={t} style={{ top: `${y(t)}%` }}>{t}%</span>)}
        </div>
        <div className="dp-var-area">
          {ticks.map((t) => <span key={t} className="dp-var-grid" style={{ top: `${y(t)}%` }} />)}
          <svg className="trend-line-svg" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
            <line x1="0" x2="100" y1={y(0)} y2={y(0)} stroke={baseColor} strokeWidth="2.2" vectorEffect="non-scaling-stroke" />
            {n > 1 && (
              <polyline
                fill="none"
                stroke={color}
                strokeWidth="2.6"
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
                points={data.map((d, i) => `${x(i)},${y(d.variacion)}`).join(' ')}
              />
            )}
          </svg>
          {data.map((d, i) => {
            const v = Number(d.variacion) || 0;
            const isSel = selectedIdx === i;
            return (
              <div
                key={d.label}
                className={`dp-var-col ${isSel ? 'is-selected' : ''}`}
                style={{ left: `${(i / Math.max(n, 1)) * 100}%`, width: `${100 / Math.max(n, 1)}%` }}
                onClick={() => onSelect && onSelect(i)}
              >
                <span className="dp-var-dot base" style={{ top: `${y(0)}%`, borderColor: baseColor }} />
                <span className="dp-var-dot" style={{ top: `${y(v)}%`, borderColor: color }} />
                <span
                  className={`dp-var-badge ${v > 0 ? 'up' : 'down'}`}
                  style={v >= 0 ? { top: `calc(${y(v)}% - 30px)` } : { top: `calc(${y(v)}% + 10px)` }}
                >
                  {v > 0 ? '▲' : '▼'} {v.toFixed(1)}%
                </span>
                <div className="bar-hover-tooltip dp-var-tt">
                  <strong>{d.nombre || d.label}</strong>
                  <span>Consumo: <b>{d.consumoFmt}</b></span>
                  <span>Presupuesto: <b>{d.presupuestoFmt}</b></span>
                  <span>Variación: <b>{v.toFixed(1)}%</b></span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <div className="bars-xaxis-row dp-var-xaxis">
        {data.map((d, i) => (
          <span key={d.label} className={`bar-label ${selectedIdx === i ? 'active-month' : ''}`} onClick={() => onSelect && onSelect(i)}>
            {d.label}
          </span>
        ))}
      </div>
      <div className="chart-legend-bottom">
        <span className="legend-trend-item" style={{ color: baseColor }}>
          <svg width="24" height="12" viewBox="0 0 24 12" aria-hidden="true">
            <line x1="1" y1="6" x2="23" y2="6" stroke={baseColor} strokeWidth="2.5" />
            <circle cx="12" cy="6" r="3.8" fill="#fff" stroke={baseColor} strokeWidth="2.3" />
          </svg>
          {baseLabel}
        </span>
        <span className="legend-trend-item" style={{ color }}>
          <svg width="24" height="12" viewBox="0 0 24 12" aria-hidden="true">
            <line x1="1" y1="6" x2="23" y2="6" stroke={color} strokeWidth="2.5" />
            <circle cx="12" cy="6" r="3.8" fill="#fff" stroke={color} strokeWidth="2.3" />
          </svg>
          {lineLabel}
        </span>
      </div>
    </div>
  );
}

/* =========================================================================
   LECTURAS CLAVE
   ========================================================================= */
export function InsightsCard({ icon, title, items, tone = 'red' }) {
  return (
    <div className={`dash-card dp-insights tone-${tone}`}>
      <div className="banner-header dp-banner">
        {icon}
        <div className="dp-banner-titles"><h3>{title}</h3></div>
      </div>
      {items.length ? (
        <ul className="dp-insights-list">
          {items.map((txt, i) => <li key={i}>{txt}</li>)}
        </ul>
      ) : (
        <div className="dp-empty static">Sin lecturas para el periodo seleccionado</div>
      )}
    </div>
  );
}
