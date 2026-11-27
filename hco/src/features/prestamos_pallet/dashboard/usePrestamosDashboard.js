import { useEffect, useMemo, useState } from 'react';
import { obtenerFilasPrestamos, obtenerDatosMaestrosPrestamos } from '../../../services/prestamosService';

export const MESES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
];
export const MESES_ABR = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Set', 'Oct', 'Nov', 'Dic'];

export const COLORES = {
  devuelto: '#16a34a',
  pendiente: '#0b2a55',
  noRetorno: '#dc2626',
  parcial: '#38bdf8',
  porDespachar: '#94a3b8',
  mixto: '#f59e0b',
  presupuesto: '#0b2a55',
  consumo: '#dc2626'
};

// Estados que guarda prestamosService (se comparan sin tildes ni mayúsculas)
export const ESTADOS = [
  { key: 'NO_RETORNO', label: 'No retorno', color: COLORES.noRetorno },
  { key: 'DEVUELTO', label: 'Devuelto', color: COLORES.devuelto },
  { key: 'PENDIENTE', label: 'Pendiente', color: COLORES.pendiente },
  { key: 'PARCIAL', label: 'Devolución parcial', color: COLORES.parcial },
  { key: 'POR_DESPACHAR', label: 'Por despachar', color: COLORES.porDespachar },
  { key: 'MIXTO', label: 'Cerrado mixto', color: COLORES.mixto }
];

export const TRAMOS_ANTIGUEDAD = [
  { key: 't0', label: '0–15 días', min: 0, max: 15 },
  { key: 't1', label: '16–30 días', min: 16, max: 30 },
  { key: 't2', label: '31–60 días', min: 31, max: 60 },
  { key: 't3', label: '61+ días', min: 61, max: Infinity }
];

const PRESUPUESTO_KEY = 'PRESTAMOS_PRESUPUESTO_MENSUAL';
const PRESUPUESTO_DEFAULT = 30000;
const FILTROS_KEY = 'PRESTAMOS_DASHBOARD_FILTROS';

// Datos compartidos en memoria por las pestañas Operacional y Financiero.
// Al cambiar de pestaña se reutilizan; si tienen más de REFRESCO_MS se refrescan en segundo plano.
const REFRESCO_MS = 60 * 1000;
let cacheDashboard = null; // { ts, filas, maestros }
let cargaEnCurso = null;

const cargarDatosDashboard = () => {
  if (!cargaEnCurso) {
    cargaEnCurso = Promise.all([
      obtenerFilasPrestamos(),
      obtenerDatosMaestrosPrestamos().catch(() => ({}))
    ])
      .then(([filas, maestros]) => {
        cacheDashboard = { ts: Date.now(), filas: filas || [], maestros: maestros || {} };
        return [cacheDashboard.filas, cacheDashboard.maestros];
      })
      .finally(() => { cargaEnCurso = null; });
  }
  return cargaEnCurso;
};

const leerFiltrosSesion = () => {
  try {
    return JSON.parse(sessionStorage.getItem(FILTROS_KEY) || '{}') || {};
  } catch {
    return {};
  }
};
const DIA_MS = 86400000;

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

export const fmtNum = (v) => Math.round(num(v)).toLocaleString('en-US');
export const fmtSoles = (v) => `S/ ${fmtNum(v)}`;
export const fmtPct = (v, dec = 1) => `${num(v).toFixed(dec)}%`;

const sinTildes = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().trim();

const normalizarEstado = (estado) => {
  const e = sinTildes(estado);
  if (e.includes('NO RETORNO')) return 'NO_RETORNO';
  if (e.includes('PARCIAL')) return 'PARCIAL';
  if (e.includes('MIXTO')) return 'MIXTO';
  if (e.includes('DESPACHAR')) return 'POR_DESPACHAR';
  if (e.includes('DEVUELTO')) return 'DEVUELTO';
  return 'PENDIENTE';
};

// Fecha local (YYYY-MM-DD) sin que la zona horaria la mueva de día
const leerFecha = (raw) => {
  if (!raw) return null;
  const m = String(raw).trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const d = new Date(raw);
  return isNaN(d.getTime()) ? null : new Date(d.getFullYear(), d.getMonth(), d.getDate());
};

/** Suma pallets y montos de un conjunto de préstamos normalizados. */
export const totalizar = (filas) => {
  const t = {
    prestamos: filas.length,
    prestadas: 0,
    devueltas: 0,
    pendientes: 0,
    noRetorno: 0,
    atrasadas: 0,
    valorPrestado: 0,
    valorPendiente: 0,
    valorNoRetorno: 0,
    valorDevuelto: 0
  };
  for (const f of filas) {
    t.prestadas += f.prestadas;
    t.devueltas += f.devueltas;
    t.pendientes += f.pendientes;
    t.noRetorno += f.noRetorno;
    if (f.atrasado) t.atrasadas += f.pendientes;
    t.valorPrestado += f.prestadas * f.precio;
    t.valorPendiente += f.pendientes * f.precio;
    t.valorNoRetorno += f.noRetorno * f.precio;
    t.valorDevuelto += f.devueltas * f.precio;
  }
  return t;
};

/** Mes de referencia para comparar: el filtrado, o el último con datos (y su mes anterior). */
export const mesReferencia = (mensual, mes) => {
  if (!mensual.length) return { actual: null, anterior: null };
  const idx = mes === 'TODOS'
    ? mensual.length - 1
    : mensual.findIndex((m) => m.mesIdx === Number(mes));
  return { actual: mensual[idx] || null, anterior: idx > 0 ? mensual[idx - 1] : null };
};

const leerPresupuesto = () => {
  try {
    const v = Number(localStorage.getItem(PRESUPUESTO_KEY));
    return v > 0 ? v : PRESUPUESTO_DEFAULT;
  } catch {
    return PRESUPUESTO_DEFAULT;
  }
};

/**
 * Datos y filtros compartidos por los dashboards Operacional y Financiero de préstamos de pallet.
 */
export function usePrestamosDashboard() {
  const hoy = useMemo(() => new Date(), []);
  const currentYear = hoy.getFullYear();
  const currentMonth = hoy.getMonth();

  // Si otra pestaña del dashboard ya cargó los datos, se muestran al instante (sin "Cargando")
  const [loading, setLoading] = useState(!cacheDashboard);
  const [error, setError] = useState('');
  const [filasRaw, setFilasRaw] = useState(() => cacheDashboard?.filas || []);
  const [maestros, setMaestros] = useState(() => cacheDashboard?.maestros || {});

  // Los filtros se conservan al cambiar entre Operacional y Financiero (misma sesión del navegador)
  const [filtrosGuardados] = useState(leerFiltrosSesion);
  const [anio, setAnio] = useState(filtrosGuardados.anio ?? currentYear);
  const [mes, setMes] = useState(filtrosGuardados.mes ?? 'TODOS'); // 'TODOS' | 0..11
  const [cliente, setCliente] = useState(filtrosGuardados.cliente ?? 'TODOS'); // 'TODOS' | clave de cliente
  const [tipo, setTipo] = useState(filtrosGuardados.tipo ?? 'TODOS'); // 'TODOS' | id de tipo de paleta
  const [presupuesto, setPresupuestoState] = useState(leerPresupuesto);

  useEffect(() => {
    try {
      sessionStorage.setItem(FILTROS_KEY, JSON.stringify({ anio, mes, cliente, tipo }));
    } catch {
      // sin sessionStorage
    }
  }, [anio, mes, cliente, tipo]);

  const setPresupuesto = (valor) => {
    const v = Math.max(0, Number(valor) || 0);
    setPresupuestoState(v);
    try {
      localStorage.setItem(PRESUPUESTO_KEY, String(v));
    } catch {
      // sin localStorage
    }
  };

  useEffect(() => {
    let vivo = true;
    const conCache = !!cacheDashboard;
    const recienCargado = conCache && Date.now() - cacheDashboard.ts < REFRESCO_MS;
    if (recienCargado) return undefined; // datos de hace segundos: no hace falta volver a pedirlos

    (async () => {
      if (!conCache) setLoading(true);
      try {
        const [filas, mae] = await cargarDatosDashboard();
        if (!vivo) return;
        setFilasRaw(filas);
        setMaestros(mae);
        setError('');
      } catch (err) {
        console.error('Error cargando dashboard de préstamos:', err);
        // con datos en memoria se siguen mostrando; solo se avisa si no hay nada que mostrar
        if (vivo && !conCache) setError(err.message || 'No se pudieron cargar los préstamos');
      } finally {
        if (vivo) setLoading(false);
      }
    })();
    return () => { vivo = false; };
  }, []);

  // Catálogos: precio por tipo de paleta y nombres de clientes
  const catalogo = useMemo(() => {
    const tipos = maestros.tipos_paleta || [];
    const precioTipo = {};
    const nombreTipo = {};
    tipos.forEach((t) => {
      nombreTipo[String(t.id)] = t.nombre_tipo || `Tipo ${t.id}`;
      const p = Number(t.precio);
      if (p > 0) precioTipo[String(t.id)] = p;
    });
    const precios = Object.values(precioTipo);
    const precioPromedio = precios.length ? precios.reduce((a, b) => a + b, 0) / precios.length : 0;
    const nombreCliente = Object.fromEntries((maestros.clientes || []).map((c) => [String(c.id), c.nombre_cliente]));
    return { tipos, precioTipo, nombreTipo, precioPromedio, nombreCliente };
  }, [maestros]);

  // Normaliza cada préstamo una sola vez
  const filas = useMemo(() => {
    const hoyMs = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate()).getTime();
    return filasRaw
      .map((row) => {
        const fecha = leerFecha(row.fecha_entrega);
        if (!fecha) return null;
        const estado = normalizarEstado(row.estado);
        const porDespachar = estado === 'POR_DESPACHAR';
        const prestadas = porDespachar ? 0 : num(row.nr_paletas);
        const devueltas = num(row.nr_paletas_devueltas);
        let noRetorno = num(row.nr_paletas_noretorno);
        if (estado === 'NO_RETORNO') noRetorno = Math.max(noRetorno, prestadas - devueltas);
        const pendientes = porDespachar || estado === 'NO_RETORNO'
          ? 0
          : Math.max(0, prestadas - devueltas - noRetorno);

        const tipoId = row.tipo_paleta_id != null ? String(row.tipo_paleta_id) : '';
        const precioTipo = catalogo.precioTipo[tipoId];
        const cliId = row.cliente_id != null && row.cliente_id !== '' ? String(row.cliente_id) : 'SIN';
        const fRetorno = leerFecha(row.fecha_retorno);

        return {
          uuid: row.uuid,
          id_prestamo: row.id_prestamo,
          fecha,
          anio: fecha.getFullYear(),
          mes: fecha.getMonth(),
          dias: Math.max(0, Math.floor((hoyMs - fecha.getTime()) / DIA_MS)),
          estado,
          prestadas,
          devueltas,
          noRetorno,
          pendientes,
          atrasado: pendientes > 0 && fRetorno && fRetorno.getTime() < hoyMs,
          tipoId,
          precio: precioTipo ?? catalogo.precioPromedio,
          sinPrecio: precioTipo == null,
          clienteKey: cliId,
          clienteNombre: cliId === 'SIN'
            ? 'Sin cliente'
            : (catalogo.nombreCliente[cliId] || `Cliente ID ${cliId}`)
        };
      })
      .filter(Boolean);
  }, [filasRaw, catalogo, hoy]);

  const aniosDisponibles = useMemo(() => {
    const s = new Set([currentYear]);
    filas.forEach((f) => s.add(f.anio));
    return Array.from(s).sort((a, b) => b - a);
  }, [filas, currentYear]);

  const clientesDisponibles = useMemo(() => {
    const m = new Map();
    filas.forEach((f) => { if (f.anio === Number(anio)) m.set(f.clienteKey, f.clienteNombre); });
    return Array.from(m, ([key, nombre]) => ({ key, nombre })).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  }, [filas, anio]);

  const tiposDisponibles = useMemo(() => {
    const ids = new Set(filas.filter((f) => f.anio === Number(anio) && f.tipoId).map((f) => f.tipoId));
    return Array.from(ids)
      .map((id) => ({ id, nombre: catalogo.nombreTipo[id] || `Tipo ${id}` }))
      .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  }, [filas, anio, catalogo]);

  // Año + tipo (sin cliente): base del ranking de clientes
  const filasAnioSinCliente = useMemo(
    () => filas.filter((f) => f.anio === Number(anio) && (tipo === 'TODOS' || f.tipoId === tipo)),
    [filas, anio, tipo]
  );
  // Año + tipo + cliente: base de los gráficos mensuales
  const filasAnio = useMemo(
    () => filasAnioSinCliente.filter((f) => cliente === 'TODOS' || f.clienteKey === cliente),
    [filasAnioSinCliente, cliente]
  );
  const enMes = (f) => mes === 'TODOS' || f.mes === Number(mes);
  const filasPeriodo = useMemo(() => filasAnio.filter(enMes), [filasAnio, mes]); // eslint-disable-line react-hooks/exhaustive-deps
  const filasPeriodoSinCliente = useMemo(() => filasAnioSinCliente.filter(enMes), [filasAnioSinCliente, mes]); // eslint-disable-line react-hooks/exhaustive-deps

  const totales = useMemo(() => totalizar(filasPeriodo), [filasPeriodo]);
  const totalesAnio = useMemo(() => totalizar(filasAnio), [filasAnio]);

  // Serie mensual del año (desde el primer mes con datos hasta el mes actual)
  const mensual = useMemo(() => {
    const hasta = Number(anio) === currentYear ? currentMonth : 11;
    const porMes = Array.from({ length: 12 }, () => []);
    filasAnio.forEach((f) => porMes[f.mes].push(f));
    let desde = porMes.findIndex((l) => l.length > 0);
    if (desde === -1 || desde > hasta) desde = hasta;
    const out = [];
    for (let m = desde; m <= hasta; m++) {
      out.push({ mesIdx: m, label: MESES_ABR[m], nombre: MESES[m], ...totalizar(porMes[m]) });
    }
    return out;
  }, [filasAnio, anio, currentYear, currentMonth]);

  const mixEstados = useMemo(() => {
    const total = filasPeriodo.length;
    return ESTADOS.map((e) => {
      const count = filasPeriodo.filter((f) => f.estado === e.key).length;
      return { ...e, count, pct: total ? Math.round((count / total) * 1000) / 10 : 0 };
    });
  }, [filasPeriodo]);

  // Ranking de clientes con saldo pendiente (ignora el filtro de cliente para poder comparar)
  const rankingClientes = useMemo(() => {
    const m = {};
    filasPeriodoSinCliente.forEach((f) => {
      if (!m[f.clienteKey]) m[f.clienteKey] = { key: f.clienteKey, nombre: f.clienteNombre, pendientes: 0, valorPendiente: 0, noRetorno: 0, valorNoRetorno: 0 };
      m[f.clienteKey].pendientes += f.pendientes;
      m[f.clienteKey].valorPendiente += f.pendientes * f.precio;
      m[f.clienteKey].noRetorno += f.noRetorno;
      m[f.clienteKey].valorNoRetorno += f.noRetorno * f.precio;
    });
    return Object.values(m).filter((c) => c.pendientes > 0);
  }, [filasPeriodoSinCliente]);

  const antiguedad = useMemo(() => {
    return TRAMOS_ANTIGUEDAD.map((t) => {
      const delTramo = filasPeriodo.filter((f) => f.pendientes > 0 && f.dias >= t.min && f.dias <= t.max);
      const tot = totalizar(delTramo);
      return { ...t, pendientes: tot.pendientes, valorPendiente: tot.valorPendiente, prestamos: delTramo.length };
    });
  }, [filasPeriodo]);

  const sinPrecio = useMemo(() => filasPeriodo.filter((f) => f.sinPrecio && f.prestadas > 0).length, [filasPeriodo]);
  const capacidadRef = catalogo.precioPromedio > 0 ? Math.floor(presupuesto / catalogo.precioPromedio) : 0;

  const limpiarFiltros = () => {
    setMes('TODOS');
    setCliente('TODOS');
    setTipo('TODOS');
  };

  return {
    loading,
    error,
    hoy,
    filtros: { anio, mes, cliente, tipo },
    setAnio,
    setMes,
    setCliente,
    setTipo,
    limpiarFiltros,
    aniosDisponibles,
    clientesDisponibles,
    tiposDisponibles,
    filasPeriodo,
    totales,
    totalesAnio,
    mensual,
    mixEstados,
    rankingClientes,
    antiguedad,
    sinPrecio,
    precioPromedio: catalogo.precioPromedio,
    presupuesto,
    setPresupuesto,
    capacidadRef
  };
}
