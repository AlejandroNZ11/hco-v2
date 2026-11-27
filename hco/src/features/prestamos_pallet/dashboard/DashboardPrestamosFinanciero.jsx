import { useMemo, useState } from 'react';
import {
  FaPallet, FaClipboardList, FaExclamationTriangle, FaCoins, FaWarehouse, FaChartLine,
  FaPen, FaCheck, FaChartBar, FaUsers, FaBalanceScale, FaLightbulb, FaPercentage
} from 'react-icons/fa';
import Loading from '../../../layouts/Loading';
import {
  usePrestamosDashboard, mesReferencia, COLORES, fmtNum, fmtSoles, fmtPct
} from './usePrestamosDashboard';
import {
  HeaderPrestamos, KpiCard, DashCard, ColumnChart, HBarList, InsightsCard, VariationChart
} from './componentes';
import '../../lup/DashboardLup.css';
import './DashboardPrestamos.css';

function PresupuestoEditable({ valor, onGuardar }) {
  const [editando, setEditando] = useState(false);
  const [borrador, setBorrador] = useState(valor);

  if (!editando) {
    return (
      <button type="button" className="dp-edit-btn" onClick={() => { setBorrador(valor); setEditando(true); }} title="Editar presupuesto mensual">
        <FaPen /> Editar
      </button>
    );
  }
  const guardar = () => { onGuardar(borrador); setEditando(false); };
  return (
    <div className="dp-edit-row">
      <input
        type="number"
        min="0"
        step="500"
        value={borrador}
        autoFocus
        onChange={(e) => setBorrador(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') guardar(); if (e.key === 'Escape') setEditando(false); }}
      />
      <button type="button" className="dp-edit-ok" onClick={guardar} title="Guardar"><FaCheck /></button>
    </div>
  );
}

function DashboardFinancieroContenido() {
  const d = usePrestamosDashboard();
  const { totales, mensual, rankingClientes, filtros, presupuesto, capacidadRef } = d;

  const selectedMesIdx = filtros.mes === 'TODOS' ? null : mensual.findIndex((m) => m.mesIdx === filtros.mes);
  const toggleMes = (i) => {
    const m = mensual[i].mesIdx;
    d.setMes((prev) => (prev === m ? 'TODOS' : m));
  };
  const toggleCliente = (key) => d.setCliente((prev) => (prev === key ? 'TODOS' : key));

  // Consumo = valor de los pallets que no retornan (gasto estimado de reposición)
  const serie = useMemo(() => mensual.map((m) => ({
    ...m,
    capacidad: capacidadRef,
    variacion: presupuesto > 0 ? ((m.valorNoRetorno - presupuesto) / presupuesto) * 100 : 0,
    consumoFmt: fmtSoles(m.valorNoRetorno),
    presupuestoFmt: fmtSoles(presupuesto)
  })), [mensual, capacidadRef, presupuesto]);

  const mesesPeriodo = filtros.mes === 'TODOS' ? Math.max(1, mensual.length) : 1;
  const presupuestoPeriodo = presupuesto * mesesPeriodo;
  const ejecucion = presupuestoPeriodo > 0 ? (totales.valorNoRetorno / presupuestoPeriodo) * 100 : 0;

  const rankingMonto = useMemo(
    () => [...rankingClientes].sort((a, b) => b.valorPendiente - a.valorPendiente),
    [rankingClientes]
  );
  const topMonto = rankingMonto.slice(0, 6);
  const totalMontoPend = rankingMonto.reduce((a, c) => a + c.valorPendiente, 0);
  const top3Pct = totalMontoPend > 0
    ? (rankingMonto.slice(0, 3).reduce((a, c) => a + c.valorPendiente, 0) / totalMontoPend) * 100
    : 0;

  const mesMaxPendiente = useMemo(
    () => mensual.reduce((best, m) => (!best || m.valorPendiente > best.valorPendiente ? m : best), null),
    [mensual]
  );
  const mesMaxConsumo = useMemo(
    () => mensual.reduce((best, m) => (!best || m.valorNoRetorno > best.valorNoRetorno ? m : best), null),
    [mensual]
  );

  const insights = useMemo(() => {
    const out = [];
    if (mesMaxConsumo && mesMaxConsumo.valorNoRetorno > 0) {
      out.push(<><b>{mesMaxConsumo.nombre}</b> fue el mes con mayor consumo estimado por no retorno: <b>{fmtSoles(mesMaxConsumo.valorNoRetorno)}</b>.</>);
    }
    if (mesMaxPendiente && mesMaxPendiente.valorPendiente > 0) {
      out.push(<><b>{mesMaxPendiente.nombre}</b> presenta la mayor exposición económica pendiente: <b>{fmtSoles(mesMaxPendiente.valorPendiente)}</b>.</>);
    }
    if (topMonto[0]) {
      out.push(<><b>{topMonto[0].nombre}</b> es la principal concentración de deuda valorizada ({fmtSoles(topMonto[0].valorPendiente)}).</>);
    }
    const { actual, anterior } = mesReferencia(mensual, filtros.mes);
    if (actual) {
      const v = presupuesto > 0 ? ((actual.valorNoRetorno - presupuesto) / presupuesto) * 100 : 0;
      out.push(
        v > 0
          ? <>En <b>{actual.nombre.toLowerCase()}</b> el consumo <b>supera</b> el presupuesto mensual de {fmtSoles(presupuesto)} en <b>{fmtPct(v)}</b>: revisar no retornos acordados.</>
          : <>En <b>{actual.nombre.toLowerCase()}</b> el consumo está <b>{fmtPct(Math.abs(v))} por debajo</b> del presupuesto mensual de {fmtSoles(presupuesto)}.</>
      );
      if (anterior && anterior.valorNoRetorno > 0) {
        const vm = ((actual.valorNoRetorno - anterior.valorNoRetorno) / anterior.valorNoRetorno) * 100;
        out.push(<>El consumo {vm >= 0 ? 'subió' : 'bajó'} <b>{fmtPct(Math.abs(vm), 0)}</b> frente a {anterior.nombre.toLowerCase()}.</>);
      }
    }
    if (totales.valorPendiente > 0) {
      out.push(<>Separar en el seguimiento: pendiente recuperable ({fmtSoles(totales.valorPendiente)}) vs. no retorno acordado con cliente ({fmtSoles(totales.valorNoRetorno)}).</>);
    }
    if (d.sinPrecio > 0) {
      out.push(<>{d.sinPrecio} préstamos sin precio de tipo de paleta: valorizados a precio promedio {fmtSoles(d.precioPromedio)}.</>);
    }
    return out;
  }, [mesMaxConsumo, mesMaxPendiente, topMonto, mensual, filtros.mes, presupuesto, totales, d.sinPrecio, d.precioPromedio]);

  return (
    <div className="dashboard-lup-container dp-container">
      {d.loading && <Loading />}

      <HeaderPrestamos titulo="Préstamos de Pallet · Financiero" badge="INDICADORES FINANCIEROS" d={d} />

      {d.error && <div className="dp-error">{d.error}</div>}

      <section className="kpis-grid dp-kpis">
        <KpiCard icon={<FaPallet />} title="Valor prestado" value={fmtSoles(totales.valorPrestado)} sub={`${fmtNum(totales.prestadas)} pallets`} tone="navy-solid" />
        <KpiCard icon={<FaClipboardList />} title="Saldo pendiente" value={fmtSoles(totales.valorPendiente)} sub={`${fmtNum(totales.pendientes)} pallets por recuperar`} tone="red-solid" />
        <KpiCard icon={<FaExclamationTriangle />} title="No retorno (gasto est.)" value={fmtSoles(totales.valorNoRetorno)} sub={`${fmtNum(totales.noRetorno)} pallets`} tone="navy-solid" />
        <KpiCard icon={<FaCoins />} title="Presupuesto mensual" value={fmtSoles(presupuesto)} tone="red-solid">
          <PresupuestoEditable valor={presupuesto} onGuardar={d.setPresupuesto} />
        </KpiCard>
        <KpiCard
          icon={<FaWarehouse />}
          title="Capacidad ref."
          value={<>{fmtNum(capacidadRef)} <small>pallets/mes</small></>}
          sub={d.precioPromedio > 0 ? `a ${fmtSoles(d.precioPromedio)} por pallet` : 'Sin precios en tipos de paleta'}
          tone="navy-solid"
        />
        <KpiCard
          icon={<FaPercentage />}
          title="Ejecución del presupuesto"
          value={fmtPct(ejecucion)}
          sub={`${fmtSoles(totales.valorNoRetorno)} de ${fmtSoles(presupuestoPeriodo)}`}
          tone={ejecucion > 100 ? 'red-solid' : 'green-solid'}
          highlight={ejecucion > 100}
        />
      </section>

      <section className="dashboard-grid-row dp-row-3">
        <DashCard icon={<FaChartBar className="icon-sec" />} title="Valor de pallets prestados por mes" subtitle="S/ · clic en un mes para filtrar">
          <ColumnChart
            data={serie}
            series={[{ key: 'valorPrestado', label: 'Valor prestado (S/)', color: COLORES.pendiente }]}
            format={fmtSoles}
            selectedIdx={selectedMesIdx}
            onSelect={toggleMes}
          />
        </DashCard>

        <DashCard
          icon={<FaClipboardList className="icon-sec" />}
          title="Saldo pendiente valorizado por mes"
          subtitle="S/ · por mes de entrega"
          note={mesMaxPendiente?.valorPendiente > 0 ? `${mesMaxPendiente.nombre} tiene la mayor exposición económica.` : null}
        >
          <ColumnChart
            data={serie}
            series={[{ key: 'valorPendiente', label: 'Saldo pendiente (S/)', color: COLORES.noRetorno }]}
            format={fmtSoles}
            selectedIdx={selectedMesIdx}
            onSelect={toggleMes}
          />
        </DashCard>

        <DashCard
          icon={<FaUsers className="icon-sec" />}
          title="Ranking de clientes por monto pendiente"
          subtitle="Clic en un cliente para filtrar"
          className="area-card"
          note={rankingMonto.length > 3 ? `Top 3 concentran ~${fmtPct(top3Pct, 0)} del saldo pendiente valorizado.` : null}
        >
          <HBarList
            items={topMonto}
            valueKey="valorPendiente"
            format={fmtSoles}
            color={`linear-gradient(90deg, #0b2a55 0%, #1e40af 100%)`}
            selectedKey={filtros.cliente}
            onSelect={toggleCliente}
          />
        </DashCard>
      </section>

      <section className="dashboard-grid-row dp-row-3">
        <DashCard icon={<FaBalanceScale className="icon-sec" />} title="Presupuesto mensual vs consumo estimado" subtitle="Pallets">
          <ColumnChart
            data={serie}
            series={[
              { key: 'capacidad', label: 'Presupuesto referencial (pallets)', color: COLORES.presupuesto },
              { key: 'noRetorno', label: 'Consumo por no retorno (pallets)', color: COLORES.consumo }
            ]}
            format={fmtNum}
            selectedIdx={selectedMesIdx}
            onSelect={toggleMes}
          />
        </DashCard>

        <DashCard icon={<FaChartLine className="icon-sec" />} title="Variación mensual del consumo vs presupuesto" subtitle="% sobre el presupuesto mensual">
          <VariationChart
            data={serie}
            baseLabel="Presupuesto mensual (0%)"
            lineLabel="Variación del consumo"
            selectedIdx={selectedMesIdx}
            onSelect={toggleMes}
          />
        </DashCard>

        <InsightsCard icon={<FaLightbulb className="icon-sec" />} title="Lecturas y sugerencias" items={insights} tone="navy" />
      </section>
    </div>
  );
}

export default function DashboardPrestamosFinanciero() {
  return (
    <div className="hco-scope hco-dashboard-lup hco-dashboard-prestamos">
      <DashboardFinancieroContenido />
    </div>
  );
}
