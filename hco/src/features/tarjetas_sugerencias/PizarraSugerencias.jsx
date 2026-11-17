import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import Loading from '../../layouts/Loading';
import { localDb } from '../../services/localDb';
import {
  obtenerSugerencias,
  obtenerCatalogosSugerencias,
  obtenerFechaCortaLima,
  obtenerFechaHoraLima
} from '../../services/sugerenciasService';
import './PizarraSugerencias.css';

const PIZARRA_ESTADOS = [
  { key: 'porValidar', label: 'POR VALIDAR' },
  { key: 'priorizado', label: 'PRIORIZADO' },
  { key: 'concluido', label: 'CONCLUIDO' },
  { key: 'atrasado', label: 'ATRASADO' },
  { key: 'cancelado', label: 'CANCELADO' },
  { key: 'futuro', label: 'FUTURO' },
  { key: 'reconocido', label: 'RECONOCIDO' }
];

const PIZARRA_AREAS_BASE = [
  'ALMACEN',
  'DISTRIBUCIÓN',
  'VAS',
  'OUTBOUND',
  'INBOUND',
  'LABELING',
  'WMS',
  'INVENTARIO',
  'CALIDAD',
  'LABORATORIO',
  'QHSE',
  'BPE',
  'OFICINA LOGISTICA',
  'RRHH'
];

const MESES_CONFIG = [
  { value: '01', label: 'Enero' },
  { value: '02', label: 'Febrero' },
  { value: '03', label: 'Marzo' },
  { value: '04', label: 'Abril' },
  { value: '05', label: 'Mayo' },
  { value: '06', label: 'Junio' },
  { value: '07', label: 'Julio' },
  { value: '08', label: 'Agosto' },
  { value: '09', label: 'Setiembre' },
  { value: '10', label: 'Octubre' },
  { value: '11', label: 'Noviembre' },
  { value: '12', label: 'Diciembre' }
];

const normalizeText = (text) =>
  String(text || '')
    .toLowerCase()
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

const parseFechaSoloDia = (fechaTexto) => {
  const t = String(fechaTexto || '').trim();
  if (!t) return null;

  const mIso = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (mIso) {
    return new Date(Number(mIso[1]), Number(mIso[2]) - 1, Number(mIso[3]));
  }

  const mLatam = t.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (mLatam) {
    return new Date(Number(mLatam[3]), Number(mLatam[2]) - 1, Number(mLatam[1]));
  }

  return null;
};

const extraerAnioMes = (fechaTexto) => {
  const t = String(fechaTexto || '').trim();
  if (!t) return { year: '', month: '' };

  const mIso = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (mIso) return { year: mIso[1], month: mIso[2] };

  const mLatam = t.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (mLatam) return { year: mLatam[3], month: mLatam[2] };

  return { year: '', month: '' };
};

const calcularEstadoKey = (item, hoyLimaDate) => {
  const e = normalizeText(item.estado);

  if (e === 'cancelado' || Boolean(item.fecha_cancelacion)) return 'cancelado';
  if (e === 'concluido' || e === 'cerrado' || Boolean(item.fecha_cierre)) return 'concluido';
  if (e === 'atrasado') return 'atrasado';
  if (e === 'futuro' || e === 'a futuro') return 'futuro';
  if (e === 'reconocido') return 'reconocido';
  if (e === 'por validar' || !e) return 'porValidar';

  if (e === 'priorizado') {
    const planDate = parseFechaSoloDia(item.fecha_plan);
    if (planDate && hoyLimaDate) {
      planDate.setHours(0, 0, 0, 0);

      if (planDate.getTime() < hoyLimaDate.getTime()) {
        return 'atrasado';
      }

      const diffMs = planDate.getTime() - hoyLimaDate.getTime();
      const noventaDiasMs = 90 * 24 * 60 * 60 * 1000;

      if (diffMs >= noventaDiasMs) {
        return 'futuro';
      }
    }
    return 'priorizado';
  }

  return 'porValidar';
};

export default function PizarraSugerencias() {
  const sugerencias = useLiveQuery(() => localDb.tarjetas_sugerencias.toArray(), [], []);
  const usuariosLocal = useLiveQuery(() => localDb.usuarios.toArray(), [], []);

  const [selectedYear, setSelectedYear] = useState('');
  const [selectedMonth, setSelectedMonth] = useState('');
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState('');
  const [ultimaActualizacion, setUltimaActualizacion] = useState(() => obtenerFechaHoraLima());

  const cargarDatos = useCallback(async (mostrarLoader = true) => {
    if (mostrarLoader && sugerencias.length === 0) {
      setLoading(true);
    }
    setErrorMsg('');

    try {
      await Promise.all([
        obtenerSugerencias(),
        obtenerCatalogosSugerencias()
      ]);
      setUltimaActualizacion(obtenerFechaHoraLima());
    } catch (err) {
      console.error('Error cargando pizarra de sugerencias:', err);
      setErrorMsg(err?.message || 'No se pudo actualizar la pizarra.');
    } finally {
      setLoading(false);
    }
  }, [sugerencias.length]);

  useEffect(() => {
    cargarDatos(true);

    const handleOnlineSync = () => cargarDatos(false);
    window.addEventListener('online', handleOnlineSync);
    window.addEventListener('hco-sync-completed', handleOnlineSync);
    return () => {
      window.removeEventListener('online', handleOnlineSync);
      window.removeEventListener('hco-sync-completed', handleOnlineSync);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const empleadosMap = useMemo(() => {
    const mapa = {};
    (usuariosLocal || []).forEach((emp) => {
      if (emp.id) mapa[String(emp.id)] = emp;
      if (emp.usuario) mapa[normalizeText(emp.usuario)] = emp;
      if (emp.nombre) mapa[normalizeText(emp.nombre)] = emp;
    });
    return mapa;
  }, [usuariosLocal]);

  const { yearsDisponibles, monthsDisponibles } = useMemo(() => {
    const yearsSet = new Set();
    const monthsSet = new Set();

    sugerencias.forEach((item) => {
      const { year, month } = extraerAnioMes(item.fecha_registro);
      if (year) yearsSet.add(year);
      if (month && (!selectedYear || selectedYear === year)) {
        monthsSet.add(month);
      }
    });

    const years = Array.from(yearsSet).sort((a, b) => Number(b) - Number(a));
    const filtrados = MESES_CONFIG.filter((m) => monthsSet.has(m.value));

    return {
      yearsDisponibles: years,
      monthsDisponibles: filtrados.length > 0 ? filtrados : MESES_CONFIG
    };
  }, [sugerencias, selectedYear]);

  const { areasOrdenadas, matrix, totalsByStatus, totalGeneral } = useMemo(() => {
    const hoyLimaDate = parseFechaSoloDia(obtenerFechaCortaLima());
    if (hoyLimaDate) hoyLimaDate.setHours(0, 0, 0, 0);

    const areasSet = new Set(PIZARRA_AREAS_BASE);
    const matrizTemp = {};
    const totalesEstado = {};

    PIZARRA_ESTADOS.forEach((st) => {
      totalesEstado[st.key] = 0;
    });

    const asegurarArea = (areaNombre) => {
      if (!matrizTemp[areaNombre]) {
        matrizTemp[areaNombre] = {};
        PIZARRA_ESTADOS.forEach((st) => {
          matrizTemp[areaNombre][st.key] = 0;
        });
      }
    };

    PIZARRA_AREAS_BASE.forEach(asegurarArea);

    let total = 0;

    sugerencias.forEach((item) => {
      const { year, month } = extraerAnioMes(item.fecha_registro);

      if (selectedYear && year !== selectedYear) return;
      if (selectedMonth && month !== selectedMonth) return;

      let area = String(item.area_registro || '').trim().toUpperCase();
      if (!area) {
        const emp =
          empleadosMap[String(item.usuario_registro_id || '')] ||
          empleadosMap[normalizeText(item.usuario_registro)];
        if (emp?.area) {
          area = String(emp.area).trim().toUpperCase();
        }
      }
      if (!area) area = 'SIN AREA';

      areasSet.add(area);
      asegurarArea(area);

      const estadoKey = calcularEstadoKey(item, hoyLimaDate);
      matrizTemp[area][estadoKey] += 1;
      totalesEstado[estadoKey] += 1;

      const reconocido = String(item.reconocido || '').trim();
      if (reconocido && estadoKey !== 'reconocido') {
        matrizTemp[area].reconocido += 1;
        totalesEstado.reconocido += 1;
      }

      total += 1;
    });

    const ordenBase = {};
    PIZARRA_AREAS_BASE.forEach((a, idx) => {
      ordenBase[normalizeText(a)] = idx;
    });

    const areasFinal = Array.from(areasSet).sort((a, b) => {
      const na = normalizeText(a);
      const nb = normalizeText(b);
      const ia = Object.prototype.hasOwnProperty.call(ordenBase, na) ? ordenBase[na] : 9999;
      const ib = Object.prototype.hasOwnProperty.call(ordenBase, nb) ? ordenBase[nb] : 9999;
      if (ia !== ib) return ia - ib;
      return a.localeCompare(b);
    });

    return {
      areasOrdenadas: areasFinal,
      matrix: matrizTemp,
      totalsByStatus: totalesEstado,
      totalGeneral: total
    };
  }, [sugerencias, empleadosMap, selectedYear, selectedMonth]);

  const handleYearChange = (e) => {
    setSelectedYear(e.target.value);
    setSelectedMonth('');
  };

  return (
    <div className="pizarra-sugerencias-wrapper">
      {loading && <Loading />}

      <main className="pizarra-page">
        <section className="pizarra-banner">
          <div className="banner-small">3M Lean Management System</div>
          <h1>PIZARRA DE SUGERENCIAS DE MEJORAS</h1>
        </section>

        {/* BARRA ÚNICA: INFO + KPIS + FILTROS EN UNA SOLA FILA */}
        <section className="pizarra-control-row">
          <div className="toolbar-info">
            <span className="page-chip">Dashboard operativo</span>
            <p id="pizarraStatus">
              {errorMsg ? errorMsg : `Pizarra operativa: ${totalGeneral} sugerencias.`}
            </p>
          </div>

          <div className="inline-kpis">
            <div className="inline-kpi-box">
              <small>Total sugerencias</small>
              <strong>{totalGeneral}</strong>
            </div>

            <div className="inline-kpi-box">
              <small>Última actualización</small>
              <strong>{ultimaActualizacion}</strong>
            </div>
          </div>

          <div className="toolbar-actions">
            <label htmlFor="filterYear">
              Año
              <select
                id="filterYear"
                value={selectedYear}
                onChange={handleYearChange}
              >
                <option value="">Todos</option>
                {yearsDisponibles.map((yr) => (
                  <option key={yr} value={yr}>
                    {yr}
                  </option>
                ))}
              </select>
            </label>

            <label htmlFor="filterMonth">
              Mes
              <select
                id="filterMonth"
                value={selectedMonth}
                onChange={(e) => setSelectedMonth(e.target.value)}
              >
                <option value="">Todos</option>
                {monthsDisponibles.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </select>
            </label>

            <button
              type="button"
              className="primary-btn"
              onClick={() => {
                setLoading(true);
                cargarDatos(false);
              }}
            >
              Actualizar
            </button>
          </div>
        </section>

        <section className="board-card">
          <div className="board-wrap">
            <table className="board-table">
              <colgroup>
                <col className="col-year" />
                <col className="col-area" />
                {PIZARRA_ESTADOS.map((st) => (
                  <React.Fragment key={st.key}>
                    <col className="col-card" />
                    <col className="col-count" />
                  </React.Fragment>
                ))}
              </colgroup>

              <thead>
                <tr>
                  <th className="th-year">AÑO</th>
                  <th className="th-area">AREA</th>
                  {PIZARRA_ESTADOS.map((st) => (
                    <th
                      key={st.key}
                      className={`status-head status-${st.key}`}
                      colSpan={2}
                    >
                      {st.label}
                    </th>
                  ))}
                </tr>
              </thead>

              <tbody>
                {areasOrdenadas.length === 0 ? (
                  <tr>
                    <td colSpan={2 + PIZARRA_ESTADOS.length * 2}>
                      Sin datos para mostrar.
                    </td>
                  </tr>
                ) : (
                  areasOrdenadas.map((area, areaIdx) => (
                    <tr key={area}>
                      {areaIdx === 0 && (
                        <td className="type-cell" rowSpan={areasOrdenadas.length}>
                          <span>SUGERENCIA</span>
                          <strong>{totalGeneral}</strong>
                        </td>
                      )}

                      <td className="area-cell">{area}</td>

                      {PIZARRA_ESTADOS.map((st) => {
                        const count = matrix[area]?.[st.key] ?? 0;
                        const totalEstado = totalsByStatus[st.key] ?? 0;

                        return (
                          <React.Fragment key={`${area}-${st.key}`}>
                            {areaIdx === 0 && (
                              <td
                                className="card-cell"
                                rowSpan={areasOrdenadas.length}
                              >
                                <div className={`mini-card mini-card-${st.key}`}>
                                  <div className="mini-clip" />
                                  <div className="mini-brand">
                                    <b>3M</b>
                                  </div>
                                  <div className="mini-title">
                                    SUGERENCIA
                                    <br />
                                    DE MEJORA
                                  </div>
                                  <div className="mini-state">{st.label}</div>
                                  <div className="mini-total">{totalEstado}</div>
                                  <div className="mini-caption">CANTIDAD</div>
                                  <div className="mini-lines">
                                    <span />
                                    <span />
                                  </div>
                                  <div className="mini-footer" />
                                </div>
                              </td>
                            )}

                            <td className={`count-cell count-${st.key}`}>
                              {count}
                            </td>
                          </React.Fragment>
                        );
                      })}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      </main>
    </div>
  );
}