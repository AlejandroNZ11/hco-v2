import { useMemo, useState } from 'react';
import {
  FaHandshake, FaPallet, FaUndoAlt, FaClipboardCheck, FaExclamationTriangle, FaCoins,
  FaChartBar, FaChartPie, FaDatabase, FaUsers, FaCalendarAlt, FaBullseye
} from 'react-icons/fa';
import Loading from '../../../layouts/Loading';
import {
  usePrestamosDashboard, mesReferencia, COLORES, fmtNum, fmtSoles, fmtPct
} from './usePrestamosDashboard';
import {
  HeaderPrestamos, KpiCard, DashCard, SvgDonut, ColumnChart, HBarList, InsightsCard
} from './componentes';
import '../../lup/DashboardLup.css';
import './DashboardPrestamos.css';

const SERIES_RESULTADO = [
  { key: 'devueltas', label: 'Devueltos', color: COLORES.devuelto },
  { key: 'pendientes', label: 'Pendientes', color: COLORES.pendiente },
  { key: 'noRetorno', label: 'No retorno', color: COLORES.noRetorno }
];

function DashboardOperacionalContenido() {
  const d = usePrestamosDashboard();
  const { totales, mensual, mixEstados, rankingClientes, antiguedad, filtros } = d;

  const [hoverEstado, setHoverEstado] = useState(null);
  const [selEstado, setSelEstado] = useState(null);
  const activeEstado = hoverEstado ?? selEstado;

  const selectedMesIdx = filtros.mes === 'TODOS' ? null : mensual.findIndex((m) => m.mesIdx === filtros.mes);
  const toggleMes = (i) => {
    const m = mensual[i].mesIdx;
    d.setMes((prev) => (prev === m ? 'TODOS' : m));
  };
  const toggleCliente = (key) => d.setCliente((prev) => (prev === key ? 'TODOS' : key));

  const topClientes = useMemo(
    () => [...rankingClientes].sort((a, b) => b.pendientes - a.pendientes).slice(0, 6),
    [rankingClientes]
  );

  const insights = useMemo(() => {
    const out = [];
    const { actual, anterior } = mesReferencia(mensual, filtros.mes);
    let variacion = '';
    if (actual && anterior && anterior.pendientes > 0) {
      const v = ((actual.pendientes - anterior.pendientes) / anterior.pendientes) * 100;
      variacion = `, con ${v >= 0 ? 'incremento' : 'reducción'} de ${fmtPct(Math.abs(v), 0)} en ${actual.nombre.toLowerCase()} vs. ${anterior.nombre.toLowerCase()}`;
    }
    out.push(
      <>El saldo pendiente es de <b>{fmtNum(totales.pendientes)} pallets ({fmtSoles(totales.valorPendiente)})</b>{variacion}.</>
    );

    const totalPend = rankingClientes.reduce((a, c) => a + c.pendientes, 0);
    if (topClientes[0] && totalPend > 0) {
      out.push(
        <><b>{topClientes[0].nombre}</b> concentra ~<b>{fmtPct((topClientes[0].pendientes / totalPend) * 100, 0)}</b> del saldo pendiente.</>
      );
    }

    const t61 = antiguedad[antiguedad.length - 1];
    if (t61 && t61.pendientes > 0 && totales.pendientes > 0) {
      out.push(
        <><b>{fmtNum(t61.pendientes)} pallets ({fmtPct((t61.pendientes / totales.pendientes) * 100, 0)})</b> superan los 61 días y requieren escalamiento.</>
      );
    }
    if (totales.atrasadas > 0) {
      out.push(<><b>{fmtNum(totales.atrasadas)} pallets</b> ya pasaron su fecha de retorno (7 días hábiles).</>);
    }
    if (totales.noRetorno > 0) {
      out.push(<>El estado <b>No retorno</b> ({fmtNum(totales.noRetorno)} pallets) debe gestionarse por separado del pendiente recuperable.</>);
    }
    const porDespachar = mixEstados.find((e) => e.key === 'POR_DESPACHAR');
    if (porDespachar?.count) {
      out.push(<><b>{porDespachar.count}</b> préstamos siguen <b>por despachar</b> (no suman pallets aún).</>);
    }
    if (d.sinPrecio > 0) {
      out.push(<>{d.sinPrecio} préstamos sin tipo de paleta con precio: se valorizan a precio promedio ({fmtSoles(d.precioPromedio)}).</>);
    }
    return out;
  }, [totales, mensual, filtros.mes, rankingClientes, topClientes, antiguedad, mixEstados, d.sinPrecio, d.precioPromedio]);

  const pctPend = totales.prestadas ? (totales.pendientes / totales.prestadas) * 100 : 0;
  const pctDev = totales.prestadas ? (totales.devueltas / totales.prestadas) * 100 : 0;
  const pctNoRet = totales.prestadas ? (totales.noRetorno / totales.prestadas) * 100 : 0;

  return (
    <div className="dashboard-lup-container dp-container">
      {d.loading && <Loading />}

      <HeaderPrestamos titulo="Préstamos de Pallet · Operacional" badge="INDICADORES OPERATIVOS" d={d} />

      {d.error && <div className="dp-error">{d.error}</div>}

      <section className="kpis-grid dp-kpis">
        <KpiCard icon={<FaHandshake />} title="Préstamos" value={fmtNum(totales.prestamos)} tone="navy" />
        <KpiCard icon={<FaPallet />} title="Pallets prestados" value={fmtNum(totales.prestadas)} tone="navy" />
        <KpiCard icon={<FaUndoAlt />} title="Devueltos" value={fmtNum(totales.devueltas)} sub={`${fmtPct(pctDev)} de lo prestado`} tone="green" />
        <KpiCard icon={<FaClipboardCheck />} title="Pendientes" value={fmtNum(totales.pendientes)} sub={`${fmtPct(pctPend)} · ${fmtNum(totales.atrasadas)} vencidos`} tone="navy" />
        <KpiCard icon={<FaExclamationTriangle />} title="No retorno" value={fmtNum(totales.noRetorno)} sub={`${fmtPct(pctNoRet)} de lo prestado`} tone="red" />
        <KpiCard icon={<FaCoins />} title="Saldo pendiente (valorizado)" value={fmtSoles(totales.valorPendiente)} tone="red" highlight />
      </section>

      <section className="dashboard-grid-row dp-row-3">
        <DashCard
          icon={<FaChartBar className="icon-sec" />}
          title="Evolución mensual por tipo de resultado"
          subtitle="Pallets · clic en un mes para filtrar"
        >
          <ColumnChart
            data={mensual}
            series={SERIES_RESULTADO}
            format={fmtNum}
            selectedIdx={selectedMesIdx}
            onSelect={toggleMes}
          />
        </DashCard>

        <DashCard
          icon={<FaChartPie className="icon-sec" />}
          title="Mix de estados por préstamo"
          subtitle="Casos · clic para fijar"
          className="donut-card"
        >
          <div className="donut-content-layout tipo-layout">
            <SvgDonut
              slices={mixEstados}
              totalCenter={fmtNum(totales.prestamos)}
              subtitleCenter="préstamos"
              unidad="préstamos"
              activeIdx={activeEstado}
              onHoverSlice={setHoverEstado}
              onSelectSlice={(i) => setSelEstado((p) => (p === i ? null : i))}
            />
            <div className="custom-legend tipo-legend-cards">
              {mixEstados.map((e, idx) => (
                <button
                  key={e.key}
                  type="button"
                  className={`tipo-legend-item dp-legend-compact ${activeEstado === idx ? 'is-selected' : ''}`}
                  onMouseEnter={() => setHoverEstado(idx)}
                  onMouseLeave={() => setHoverEstado(null)}
                  onClick={() => setSelEstado((p) => (p === idx ? null : idx))}
                >
                  <div className="tipo-leg-top">
                    <div className="legend-row">
                      <span className="dot" style={{ backgroundColor: e.color }} />
                      <span className="tipo-leg-name">{e.label}</span>
                    </div>
                    <div className="tipo-leg-nums">
                      <strong>{e.count}</strong>
                      <span className="tipo-pct-badge">{e.pct}%</span>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </DashCard>

        <DashCard
          icon={<FaDatabase className="icon-sec" />}
          title="Saldo pendiente por mes"
          subtitle="Pallets y S/ · por mes de entrega"
        >
          <ColumnChart
            data={mensual}
            series={[{ key: 'pendientes', label: 'Pallets pendientes', color: COLORES.pendiente }]}
            line={{ key: 'valorPendiente', label: 'Saldo pendiente (S/)', color: COLORES.noRetorno, format: fmtSoles }}
            format={fmtNum}
            labelsInside
            selectedIdx={selectedMesIdx}
            onSelect={toggleMes}
          />
        </DashCard>
      </section>

      <section className="dashboard-grid-row dp-row-3">
        <DashCard
          icon={<FaUsers className="icon-sec" />}
          title="Top clientes deudores por pallets pendientes"
          subtitle="Clic en un cliente para filtrar"
          className="area-card"
          note={topClientes.some((c) => c.key === 'SIN') ? 'Hay préstamos sin cliente asignado: validar registro de cliente_id' : null}
          noteTone="slate"
        >
          <HBarList
            items={topClientes}
            valueKey="pendientes"
            format={fmtNum}
            color={`linear-gradient(90deg, #b91c1c 0%, ${COLORES.noRetorno} 100%)`}
            selectedKey={filtros.cliente}
            onSelect={toggleCliente}
          />
        </DashCard>

        <DashCard
          icon={<FaCalendarAlt className="icon-sec" />}
          title="Antigüedad del saldo pendiente"
          subtitle="Días desde la entrega"
        >
          <ColumnChart
            data={antiguedad}
            series={[{ key: 'pendientes', label: 'Pallets pendientes', color: COLORES.pendiente }]}
            format={fmtNum}
            labelsInside
            topLabel={(t) => fmtSoles(t.valorPendiente)}
            emptyText="Sin saldo pendiente"
          />
        </DashCard>

        <InsightsCard icon={<FaBullseye className="icon-sec" />} title="Lecturas clave" items={insights} />
      </section>
    </div>
  );
}

export default function DashboardPrestamosOperacional() {
  return (
    <div className="hco-scope hco-dashboard-lup hco-dashboard-prestamos">
      <DashboardOperacionalContenido />
    </div>
  );
}
