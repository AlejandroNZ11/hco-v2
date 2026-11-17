import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { obtenerSugerencias, obtenerCatalogosSugerencias } from '../../services/sugerenciasService';
import './DashboardSugerencias.css';
import Loading from '../../layouts/Loading';

const MESES = [
  { id: 1, nombre: 'Enero', corto: 'Ene' },
  { id: 2, nombre: 'Febrero', corto: 'Feb' },
  { id: 3, nombre: 'Marzo', corto: 'Mar' },
  { id: 4, nombre: 'Abril', corto: 'Abr' },
  { id: 5, nombre: 'Mayo', corto: 'May' },
  { id: 6, nombre: 'Junio', corto: 'Jun' },
  { id: 7, nombre: 'Julio', corto: 'Jul' },
  { id: 8, nombre: 'Agosto', corto: 'Ago' },
  { id: 9, nombre: 'Septiembre', corto: 'Sep' },
  { id: 10, nombre: 'Octubre', corto: 'Oct' },
  { id: 11, nombre: 'Noviembre', corto: 'Nov' },
  { id: 12, nombre: 'Diciembre', corto: 'Dic' },
];

const PALETA_CATEGORIAS = ['#0b4f9c', '#2f9bf0', '#7cc4fa', '#f5a623', '#1fb6c9', '#94a3b8'];

/* =========================================
   UTILIDADES GOOGLE DRIVE
   ========================================= */

const extraerIdDrive = (url) => {
  if (!url || typeof url !== "string") return null;
  const cleanUrl = url.trim();
  const match =
    cleanUrl.match(/\/file\/d\/([a-zA-Z0-9_-]+)/) ||
    cleanUrl.match(/\/d\/([a-zA-Z0-9_-]+)/) ||
    cleanUrl.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  return match ? match[1] : null;
};

const convertirDriveUrl = (url) => {
  if (!url || typeof url !== "string") return "";
  const cleanUrl = url.trim();
  if (cleanUrl.startsWith("data:image/")) return cleanUrl;
  const driveId = extraerIdDrive(cleanUrl);
  if (driveId) {
    return `https://lh3.googleusercontent.com/d/${driveId}=w1000`;
  }
  return cleanUrl;
};
// Convierte "APELLIDO APELLIDO, NOMBRE" a "NOMBRE APELLIDO" limpio
function formatearNombrePodio(nombreCompleto) {
  if (!nombreCompleto) return 'Sin nombre';
  const str = String(nombreCompleto).trim();
  if (str.includes(',')) {
    const [apellidos, nombres] = str.split(',').map(s => s.trim());
    const primerNombre = nombres.split(/\s+/)[0] || '';
    const primerApellido = apellidos.split(/\s+/)[0] || '';
    return `${primerNombre} ${primerApellido}`.toUpperCase();
  }
  return str.toUpperCase();
}

function formatearNombreAmigable(nombreCompleto) {
  if (!nombreCompleto) return 'Sin asignar';
  const str = String(nombreCompleto).trim();

  const capitalizar = (txt) =>
    txt.charAt(0).toUpperCase() + txt.slice(1).toLowerCase();

  if (str.includes(',')) {
    const [apellidos, nombres] = str.split(',').map((s) => s.trim());
    const primerNombre = nombres.split(/\s+/)[0] || '';
    const primerApellido = apellidos.split(/\s+/)[0] || '';
    return `${capitalizar(primerNombre)} ${capitalizar(primerApellido)}`;
  }

  const palabras = str.split(/\s+/).filter(Boolean);
  if (palabras.length >= 2) {
    return `${capitalizar(palabras[0])} ${capitalizar(palabras[1])}`;
  }
  return capitalizar(str);
}

function formatearNombreArea(area) {
  if (!area) return 'Sin Área';
  return area
    .toLowerCase()
    .split(' ')
    .map(p => p.charAt(0).toUpperCase() + p.slice(1))
    .join(' ');
}

function MedallaRosetaAzul() {
  return (
    <svg
      viewBox="0 0 64 74"
      className="badge-roseta-svg"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      {/* Cintas inferiores con corte en V */}
      <path
        d="M20 42L12 68L22 62L28 66L26 44"
        fill="#084282"
      />
      <path
        d="M44 42L52 68L42 62L36 66L38 44"
        fill="#084282"
      />

      {/* Rosetón exterior festoneado */}
      <path
        d="M32 4C35 4 36.5 6.5 39 7C41.5 7.5 44 6 46.5 7.5C49 9 49.5 11.5 51.5 13.5C53.5 15.5 56 16 57.5 18.5C59 21 57.5 23.5 58 26C58.5 28.5 61 30 61 33C61 36 58.5 37.5 58 40C57.5 42.5 59 45 57.5 47.5C56 50 53.5 50.5 51.5 52.5C49.5 54.5 49 57 46.5 58.5C44 60 41.5 58.5 39 59C36.5 59.5 35 62 32 62C29 62 27.5 59.5 25 59C22.5 58.5 20 60 17.5 58.5C15 57 14.5 54.5 12.5 52.5C10.5 50.5 8 50 6.5 47.5C5 45 6.5 42.5 6 40C5.5 37.5 3 36 3 33C3 30 5.5 28.5 6 26C6.5 23.5 5 21 6.5 18.5C8 16 10.5 15.5 12.5 13.5C14.5 11.5 15 9 17.5 7.5C20 6 22.5 7.5 25 7C27.5 6.5 29 4 32 4Z"
        fill="url(#gradienteRoseta)"
      />

      {/* Círculo central blanco */}
      <circle cx="32" cy="33" r="14" fill="#ffffff" />

      {/* Gradiente azul corporativo */}
      <defs>
        <linearGradient id="gradienteRoseta" x1="12" y1="6" x2="52" y2="60" gradientUnits="userSpaceOnUse">
          <stop stopColor="#1a7fc9" />
          <stop offset="0.6" stopColor="#0b4f9c" />
          <stop offset="1" stopColor="#063266" />
        </linearGradient>
      </defs>
    </svg>
  );
}

/* =========================================
   SUBCOMPONENTE FOTO PODIO (CON FALLBACK DRIVE)
   ========================================= */

function FotoPodio({ fotoUrl, nombre }) {
  const [errorCarga, setErrorCarga] = useState(false);
  const iniciales = (nombre || '??').substring(0, 2).toUpperCase();

  if (!fotoUrl || errorCarga) {
    return <span className="podio-iniciales">{iniciales}</span>;
  }

  const urlFinal = convertirDriveUrl(fotoUrl);

  return (
    <img
      src={urlFinal}
      alt={nombre}
      className="podio-img"
      referrerPolicy="no-referrer"
      crossOrigin="anonymous"
      onError={(e) => {
        const driveId = extraerIdDrive(fotoUrl);
        if (!driveId) {
          setErrorCarga(true);
          return;
        }

        const step = Number(e.target.dataset.fallbackStep || 0);
        if (step === 0) {
          e.target.dataset.fallbackStep = "1";
          e.target.src = `https://lh3.googleusercontent.com/d/${driveId}=w1000`;
        } else if (step === 1) {
          e.target.dataset.fallbackStep = "2";
          e.target.src = `https://drive.google.com/uc?export=view&id=${driveId}`;
        } else {
          setErrorCarga(true);
        }
      }}
    />
  );
}

/* =========================================
   UTILIDADES MATEMÁTICAS Y FECHAS
   ========================================= */

function parsearFecha(valor) {
  if (!valor) return null;
  if (typeof valor === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(valor)) {
    const [y, m, d] = valor.split('-').map(Number);
    return new Date(y, m - 1, d);
  }
  const f = new Date(valor);
  return isNaN(f.getTime()) ? null : f;
}

function escalaEje(max, maxTicks = 5) {
  const pasos = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 5000];
  const paso = pasos.find(p => max / p <= maxTicks) || 10000;
  const tope = Math.max(paso, Math.ceil((max * 1.08) / paso) * paso);
  const ticks = [];
  for (let v = 0; v <= tope; v += paso) ticks.push(v);
  return { tope, ticks };
}

/* =========================================
   ICONOS SVG
   ========================================= */

const ICONOS = {
  trofeo: (
    <>
      <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6" />
      <path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18" />
      <path d="M4 22h16" />
      <path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22" />
      <path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22" />
      <path d="M18 2H6v7a6 6 0 0 0 12 0V2Z" />
    </>
  ),
  barras: (
    <>
      <path d="M3 3v18h18" />
      <path d="M18 17V9" />
      <path d="M13 17V5" />
      <path d="M8 17v-3" />
    </>
  ),
  usuarios: (
    <>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </>
  ),
  medidor: (
    <>
      <path d="m12 14 4-4" />
      <path d="M3.34 19a10 10 0 1 1 17.32 0" />
    </>
  ),
  tendencia: (
    <>
      <polyline points="22 7 13.5 15.5 8.5 10.5 2 17" />
      <polyline points="16 7 22 7 22 13" />
    </>
  ),
  pastel: (
    <>
      <path d="M21.21 15.89A10 10 0 1 1 8 2.83" />
      <path d="M22 12A10 10 0 0 0 12 2v10z" />
    </>
  ),
  premio: (
    <>
      <circle cx="12" cy="8" r="6" />
      <path d="M15.477 12.89 17 22l-5-3-5 3 1.523-9.11" />
    </>
  ),
};

function Icono({ nombre, size = 22 }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {ICONOS[nombre]}
    </svg>
  );
}

/* =========================================
   MEDALLA (ORO / PLATA / BRONCE)
   ========================================= */

const COLORES_MEDALLA = {
  1: ['#f8c13a', '#d98a0b'],
  2: ['#cfd6e0', '#8b97a8'],
  3: ['#f0a766', '#c96a1f'],
};

function Medalla({ puesto }) {
  const [claro, oscuro] = COLORES_MEDALLA[puesto] || COLORES_MEDALLA[3];
  return (
    <svg viewBox="0 0 40 48" className="medalla-svg" aria-hidden="true">
      <polygon points="11,26 5,46 15,40 21,31" fill={oscuro} />
      <polygon points="29,26 35,46 25,40 19,31" fill={oscuro} />
      <circle cx="20" cy="18" r="16" fill={claro} stroke={oscuro} strokeWidth="2.5" />
      <circle cx="20" cy="18" r="11.5" fill="none" stroke="#fff" strokeOpacity="0.55" strokeWidth="1.2" />
      <text x="20" y="18" textAnchor="middle" dominantBaseline="central" className="medalla-num">
        {puesto}
      </text>
    </svg>
  );
}

/* =========================================
   BARRAS HORIZONTALES CON EJE
   ========================================= */

function BarrasHorizontales({ items, conExtra = false }) {
  const max = Math.max(...items.map(i => i.valor), 1);
  const { tope, ticks } = escalaEje(max);
  const pos = v => `${(v / tope) * 100}%`;

  return (
    <div className={`hchart ${conExtra ? 'con-extra' : ''}`}>
      <div className="hchart-body">
        <div className="hchart-cols hchart-lines" aria-hidden="true">
          <span />
          <div className="hchart-lines-area">
            {ticks.map(t => (
              <i key={t} className={t === 0 ? 'eje' : ''} style={{ left: pos(t) }} />
            ))}
          </div>
          {conExtra && <span />}
        </div>

        <div className="hchart-rows">
          {items.map(it => {
            const pct = (it.valor / tope) * 100;
            const dentro = pct > 88;
            return (
              <div key={it.clave} className="hchart-cols hchart-row">
                <span className="hchart-label" title={it.etiqueta}>{it.etiqueta}</span>
                <div className="hchart-track">
                  <div className={`hchart-bar ${it.claseColor}`} style={{ width: `${pct}%` }} />
                  <span
                    className={`hchart-val ${dentro ? 'dentro' : ''}`}
                    style={dentro ? undefined : { left: `calc(${pct}% + 8px)` }}
                  >
                    {it.valor}
                  </span>
                </div>
                {conExtra && <span className="hchart-extra">{it.extra}</span>}
              </div>
            );
          })}
        </div>
      </div>

      <div className="hchart-cols hchart-axis" aria-hidden="true">
        <span />
        <div className="hchart-axis-area">
          {ticks.map(t => (
            <em key={t} style={{ left: pos(t) }}>{t}</em>
          ))}
        </div>
        {conExtra && <span />}
      </div>
    </div>
  );
}

/* =========================================
   GRÁFICO DE LÍNEA EXPANDIDO (MAXIMIZA ÁREA)
   ========================================= */

function GraficoLinea({ datos, ultimoMes }) {
  // Dimensiones ampliadas para abarcar todo el contenedor
  const W = 620;
  const H = 280;
  // Márgenes perimetrales reducidos para aprovechar todo el espacio
  const m = { izq: 34, der: 14, sup: 22, inf: 26 };
  const padInterno = 8;

  const visibles = datos.slice(0, ultimoMes + 1);
  const maxVal = Math.max(...visibles.map(d => d.total), 5);
  const { tope, ticks } = escalaEje(maxVal);

  const altoPlot = H - m.sup - m.inf;
  const paso = (W - m.izq - m.der - padInterno * 2) / (datos.length - 1);
  const xDe = (i) => m.izq + padInterno + i * paso;
  const yDe = (v) => m.sup + altoPlot - (v / tope) * altoPlot;

  const puntos = visibles.map((d, i) => ({ ...d, x: xDe(i), y: yDe(d.total) }));
  const linea = puntos.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x} ${p.y}`).join(' ');
  const base = yDe(0);
  const area =
    puntos.length > 1
      ? `${linea} L${puntos[puntos.length - 1].x} ${base} L${puntos[0].x} ${base} Z`
      : '';

  return (
    <div className="line-chart-wrapper">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="chart-svg-full"
        preserveAspectRatio="none"
        role="img"
        aria-label="Tendencia mensual de sugerencias"
      >
        <defs>
          <linearGradient id="grad-area-sug" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#1b9be8" stopOpacity="0.32" />
            <stop offset="100%" stopColor="#1b9be8" stopOpacity="0.04" />
          </linearGradient>
        </defs>

        {/* Líneas guía horizontales y valores del eje Y */}
        {ticks.map((t) => (
          <g key={t}>
            <line
              x1={m.izq}
              x2={W - m.der}
              y1={yDe(t)}
              y2={yDe(t)}
              stroke={t === 0 ? '#94a3b8' : '#e3ebf5'}
              strokeWidth={t === 0 ? 1.4 : 1}
            />
            <text
              x={m.izq - 6}
              y={yDe(t)}
              textAnchor="end"
              dominantBaseline="central"
              className="svg-eje"
            >
              {t}
            </text>
          </g>
        ))}

        {/* Área rellena bajo la curva */}
        {area && <path d={area} fill="url(#grad-area-sug)" />}

        {/* Línea principal */}
        {linea && (
          <path
            d={linea}
            fill="none"
            stroke="#1584d6"
            strokeWidth="3.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )}

        {/* Puntos y etiquetas numéricas */}
        {puntos.map((p) => (
          <g key={p.mes}>
            <circle cx={p.x} cy={p.y} r="5" fill="#1584d6" stroke="#ffffff" strokeWidth="2.5" />
            <text x={p.x} y={p.y - 10} textAnchor="middle" className="svg-num">
              {p.total}
            </text>
          </g>
        ))}

        {/* Meses en el eje X */}
        {datos.map((d, i) => (
          <text
            key={d.mes}
            x={xDe(i)}
            y={H - 8}
            textAnchor="middle"
            className="svg-mes"
          >
            {d.mes}
          </text>
        ))}
      </svg>
    </div>
  );
}

/* =========================================
   DONA SVG
   ========================================= */

function arcoDona(cx, cy, rExt, rInt, a0, a1) {
  const p = (r, a) => [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  const [x0, y0] = p(rExt, a0);
  const [x1, y1] = p(rExt, a1);
  const [x2, y2] = p(rInt, a1);
  const [x3, y3] = p(rInt, a0);
  const grande = a1 - a0 > Math.PI ? 1 : 0;
  return `M${x0} ${y0} A${rExt} ${rExt} 0 ${grande} 1 ${x1} ${y1} L${x2} ${y2} A${rInt} ${rInt} 0 ${grande} 0 ${x3} ${y3} Z`;
}

function Dona({ segmentos, total }) {
  const cx = 100;
  const cy = 100;
  const rExt = 92;
  const rInt = 52;
  const suma = segmentos.reduce((acc, s) => acc + s.valor, 0);

  let angulo = -Math.PI / 2;
  const trozos =
    suma > 0
      ? segmentos
          .filter((s) => s.valor > 0)
          .map((s) => {
            const frac = s.valor / suma;
            const a0 = angulo;
            const a1 = angulo + frac * 2 * Math.PI;
            angulo = a1;
            const aMedio = (a0 + a1) / 2;
            const rTexto = (rExt + rInt) / 2;
            return {
              ...s,
              frac,
              a0,
              a1,
              tx: cx + rTexto * Math.cos(aMedio),
              ty: cy + rTexto * Math.sin(aMedio),
            };
          })
      : [];

  return (
    <svg viewBox="0 0 200 200" className="dona-svg" role="img" aria-label="Gráfico de dona">
      {trozos.length === 0 && (
        <circle cx={cx} cy={cy} r={(rExt + rInt) / 2} fill="none" stroke="#e2e8f0" strokeWidth={rExt - rInt} />
      )}

      {trozos.map((t) =>
        t.frac >= 0.9999 ? (
          <circle
            key={t.clave}
            cx={cx}
            cy={cy}
            r={(rExt + rInt) / 2}
            fill="none"
            stroke={t.color}
            strokeWidth={rExt - rInt}
          />
        ) : (
          <path
            key={t.clave}
            d={arcoDona(cx, cy, rExt, rInt, t.a0, t.a1)}
            fill={t.color}
            stroke="#ffffff"
            strokeWidth="2.5"
          />
        )
      )}

      {trozos.map(
        (t) =>
          t.frac >= 0.09 && (
            <text
              key={`l-${t.clave}`}
              x={t.tx}
              y={t.ty}
              textAnchor="middle"
              dominantBaseline="central"
              className="dona-pct"
            >
              {Math.round(t.frac * 100)}%
            </text>
          )
      )}

      <text x={cx} y={cy - 4} textAnchor="middle" dominantBaseline="central" className="dona-num">
        {total}
      </text>
      <text x={cx} y={cy + 20} textAnchor="middle" dominantBaseline="central" className="dona-sub">
        sugerencias
      </text>
    </svg>
  );
}

/* =========================================
   COMPONENTE PRINCIPAL
   ========================================= */

function DashboardSugerenciasContenido() {
  const [sugerencias, setSugerencias] = useState([]);
  const [empleados, setEmpleados] = useState([]);
  const [cargando, setCargando] = useState(true);

  const hoy = useMemo(() => new Date(), []);
  const [anioFiltro, setAnioFiltro] = useState(hoy.getFullYear());
  const [mesFiltro, setMesFiltro] = useState(hoy.getMonth() + 1);

  useEffect(() => {
    async function cargarDatos() {
      try {
        setCargando(true);
        const [listaSugerencias, catalogos] = await Promise.all([
          obtenerSugerencias(),
          obtenerCatalogosSugerencias(),
        ]);
        setSugerencias(listaSugerencias || []);
        setEmpleados(catalogos.empleados || []);
      } catch (err) {
        console.error('Error al cargar datos del dashboard:', err);
      } finally {
        setCargando(false);
      }
    }
    cargarDatos();
  }, []);

  const sugerenciasConFecha = useMemo(
    () =>
      sugerencias
        .map(s => ({ ...s, _fecha: parsearFecha(s.fecha_registro) }))
        .filter(s => s._fecha),
    [sugerencias]
  );

  const mapaEmpleados = useMemo(() => {
    const porId = {};
    const porNombre = {};
    empleados.forEach(emp => {
      if (emp.id) porId[emp.id] = emp;
      if (emp.nombre) porNombre[emp.nombre.trim().toLowerCase()] = emp;
    });
    return { porId, porNombre };
  }, [empleados]);

  const resolverEmpleado = useCallback(
    s => {
      if (s.usuario_registro_id && mapaEmpleados.porId[s.usuario_registro_id]) {
        return mapaEmpleados.porId[s.usuario_registro_id];
      }
      const nombre = (s.usuario_registro || '').trim().toLowerCase();
      return mapaEmpleados.porNombre[nombre] || null;
    },
    [mapaEmpleados]
  );

  const aniosDisponibles = useMemo(() => {
    const set = new Set([hoy.getFullYear()]);
    sugerenciasConFecha.forEach(s => set.add(s._fecha.getFullYear()));
    return Array.from(set).sort((a, b) => b - a);
  }, [sugerenciasConFecha, hoy]);

  const sugerenciasAnio = useMemo(
    () => sugerenciasConFecha.filter(s => s._fecha.getFullYear() === Number(anioFiltro)),
    [sugerenciasConFecha, anioFiltro]
  );

  const sugerenciasMes = useMemo(
    () => sugerenciasAnio.filter(s => s._fecha.getMonth() + 1 === Number(mesFiltro)),
    [sugerenciasAnio, mesFiltro]
  );

  // 1. TOP 3 PERSONAS MES
  const topPersonasMes = useMemo(() => {
    const conteo = {};
    sugerenciasMes.forEach(s => {
      const nombre = (s.usuario_registro || 'Sin Asignar').trim();
      if (!conteo[nombre]) {
        conteo[nombre] = { nombre, total: 0, foto_url: resolverEmpleado(s)?.foto_url || null };
      }
      conteo[nombre].total += 1;
    });
    return Object.values(conteo).sort((a, b) => b.total - a.total).slice(0, 3);
  }, [sugerenciasMes, resolverEmpleado]);

  // 2. TOP ÁREAS MES
  const topAreasMes = useMemo(() => {
    const conteo = {};
    sugerenciasMes.forEach(s => {
      const area = (s.area_registro || 'Sin Área').trim();
      conteo[area] = (conteo[area] || 0) + 1;
    });
    return Object.entries(conteo)
      .map(([area, total]) => ({ area, total }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 5);
  }, [sugerenciasMes]);

  // 3. TOP 5 PERSONAS ACUMULADO AÑO
  const topPersonasAcumulado = useMemo(() => {
    const conteo = {};
    sugerenciasAnio.forEach(s => {
      const nombre = (s.usuario_registro || 'Sin Asignar').trim();
      conteo[nombre] = (conteo[nombre] || 0) + 1;
    });
    return Object.entries(conteo)
      .map(([nombre, total]) => ({ nombre, total }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 5);
  }, [sugerenciasAnio]);

  // 4. TENDENCIA MENSUAL
  const tendenciaMensual = useMemo(() => {
    const totales = Array(12).fill(0);
    sugerenciasAnio.forEach(s => {
      totales[s._fecha.getMonth()] += 1;
    });
    return totales.map((total, idx) => ({ mes: MESES[idx].corto, total }));
  }, [sugerenciasAnio]);

  const ultimoMes = Number(anioFiltro) === hoy.getFullYear() ? hoy.getMonth() : 11;

// 5. ORIGEN (MAPEO: white = Operativo, blue = Administrativo)
  const origen = useMemo(() => {
    let operativo = 0;
    let administrativo = 0;

    sugerenciasAnio.forEach((s) => {
      const emp = resolverEmpleado(s);
      const tipo = (emp?.tipo || '').toLowerCase().trim();

      // Mapeo exacto de tu base de datos
      if (tipo === 'white' || tipo === 'operativo') {
        operativo++;
      } else if (tipo === 'blue' || tipo === 'administrativo') {
        administrativo++;
      }
    });

    const totalConTipo = operativo + administrativo;
    const pctOperativo = totalConTipo > 0 ? Math.round((operativo / totalConTipo) * 100) : 0;
    const pctAdministrativo = totalConTipo > 0 ? 100 - pctOperativo : 0;

    return {
      operativo,
      administrativo,
      totalConTipo,
      pctOperativo,
      pctAdministrativo,
    };
  }, [sugerenciasAnio, resolverEmpleado]);

  // 6. CATEGORÍAS
  const porCategoria = useMemo(() => {
    const conteo = {};
    let totalItems = 0;
    sugerenciasAnio.forEach(s => {
      if (Array.isArray(s.categorias)) {
        s.categorias.forEach(cat => {
          if (cat) {
            const c = String(cat).trim();
            conteo[c] = (conteo[c] || 0) + 1;
            totalItems++;
          }
        });
      }
    });
    return Object.entries(conteo)
      .sort((a, b) => b[1] - a[1])
      .map(([categoria, cantidad], idx) => ({
        categoria,
        cantidad,
        color: PALETA_CATEGORIAS[idx % PALETA_CATEGORIAS.length],
        porcentaje: totalItems ? Math.round((cantidad / totalItems) * 100) : 0,
      }));
  }, [sugerenciasAnio]);

  const nombreMes = MESES.find(m => m.id === Number(mesFiltro))?.nombre || '';



    const itemsAreas = topAreasMes.map((a, idx) => ({
    clave: a.area,
    etiqueta: formatearNombreArea(a.area), // <--- Nombre en formato Title Case
    valor: a.total,
    claseColor: idx < 3 ? `bar-c${idx}` : 'bar-gris',
    extra: idx < 3 ? <span className={`medalla-circulo ranking-${idx + 1}`}>{idx + 1}</span> : null,
    }));

    const itemsTop5 = topPersonasAcumulado.map((p, idx) => ({
    clave: p.nombre,
    etiqueta: formatearNombreAmigable(p.nombre), // <--- Nombre limpio en Title Case
    valor: p.total,
    claseColor: `bar-c${idx}`,
    }));

  return (
    <div className="dashboard-sugerencias-wrapper">
      {cargando && <Loading />}
      {/* FILTROS */}
      <header className="dash-header-filter">
        <div className="dash-header-titles">
          <span className="dash-pill">Indicadores operativos</span>
          <h2>Tablero de sugerencias</h2>
        </div>

        <div className="dash-selectors">
          <div className="dash-select-group">
            <label htmlFor="dash-anio">Año</label>
            <select id="dash-anio" value={anioFiltro} onChange={e => setAnioFiltro(Number(e.target.value))}>
              {aniosDisponibles.map(a => (
                <option key={a} value={a}>{a}</option>
              ))}
            </select>
          </div>

          <div className="dash-select-group">
            <label htmlFor="dash-mes">Mes</label>
            <select id="dash-mes" value={mesFiltro} onChange={e => setMesFiltro(Number(e.target.value))}>
              {MESES.map(m => (
                <option key={m.id} value={m.id}>{m.nombre}</option>
              ))}
            </select>
          </div>
        </div>
      </header>

      {/* FILA SUPERIOR */}
      <section className="dash-row top-row">
        {/* CARD 1: TOP 3 PERSONAS */}
        <article className="dash-card">
          <header className="dash-card-header">
            <Icono nombre="trofeo" size={28} />
            <h3>Top 3 de personas que más reportan ({nombreMes})</h3>
          </header>
          <div className="dash-card-body podio-container">
            {topPersonasMes.map((persona, index) => (
                <div key={persona.nombre} className="podio-item">
                    {/* Contenedor cuadrado para la foto */}
                    <div className="podio-foto">
                    <FotoPodio fotoUrl={persona.foto_url} nombre={persona.nombre} />
                    </div>

                    {/* Fila inferior: Medalla grande a la izquierda + Nombre y conteo */}
                    <div className="podio-info">
                    <Medalla puesto={index + 1} />
                    <div className="podio-texto">
                        <strong className="podio-nombre" title={persona.nombre}>
                        {formatearNombrePodio(persona.nombre)}
                        </strong>
                        <div className="podio-conteo">
                        <span className="podio-num">{persona.total}</span>
                        <span className="podio-unit">sug.</span>
                        </div>
                    </div>
                    </div>
                </div>
                ))}
          </div>
        </article>

        {/* CARD 2: TOP ÁREAS */}
        <article className="dash-card">
          <header className="dash-card-header">
            <Icono nombre="barras" size={28} />
            <h3>Top 3 de áreas que más reportan ({nombreMes})</h3>
          </header>
          <div className="dash-card-body">
            {itemsAreas.length === 0 ? (
              <p className="no-data">Sin registros de áreas en este mes</p>
            ) : (
              <BarrasHorizontales items={itemsAreas} conExtra />
            )}
          </div>
        </article>

        {/* CARD 3: TOP 5 ACUMULADO */}
        <article className="dash-card">
        <header className="dash-card-header">
            <Icono nombre="usuarios" size={28} />
            <h3>Top 5 de personas que más reportan (acumulado {anioFiltro})</h3>
        </header>
        <div className="dash-card-body top5-body">
            {itemsTop5.length === 0 ? (
            <p className="no-data">Sin datos acumulados</p>
            ) : (
            <BarrasHorizontales items={itemsTop5} />
            )}

            {/* Recuadro de Total Acumulado con la Medalla/Cucarda azul */}
            <div className="top5-badge-resumen">
            <div className="badge-icono">
                <MedallaRosetaAzul />
            </div>
            <div className="badge-text-wrap">
                <span className="badge-sub">Total acumulado:</span>
                <span className="badge-total">{sugerenciasAnio.length}</span>
                <span className="badge-sug">sugerencias</span>
            </div>
            </div>
        </div>
        </article>
      </section>

      {/* DIVISOR */}
      <div className="dash-section-divider">
        <Icono nombre="medidor" size={26} />
        <span>Otros indicadores clave</span>
      </div>

      {/* FILA INFERIOR */}
      <section className="dash-row bottom-row">
        {/* CARD 4: TENDENCIA */}
        <article className="dash-card">
          <header className="dash-card-header claro">
            <Icono nombre="tendencia" size={24} />
            <h3>Tendencia mensual de sugerencias ({anioFiltro})</h3>
          </header>
          <div className="dash-card-body">
            <GraficoLinea datos={tendenciaMensual} ultimoMes={ultimoMes} />
          </div>
        </article>

        {/* CARD 5: ORIGEN */}
        <article className="dash-card">
          <header className="dash-card-header claro">
            <Icono nombre="pastel" size={26} />
            <h3>Sugerencias por origen ({anioFiltro})</h3>
          </header>
          <div className="dash-card-body donut-card-body">
            <div className="dona-wrap">
              <Dona
                total={sugerenciasAnio.length}
                segmentos={[
                  { clave: 'operativo', valor: origen.operativo, color: '#0b4f9c' },
                  { clave: 'administrativo', valor: origen.administrativo, color: '#5bb8f5' },
                ]}
              />
            </div>
            <div className="donut-legend">
              <div className="legend-row">
                <span className="dot" style={{ backgroundColor: '#0b4f9c' }} />
                <span className="leg-label">Operativo</span>
                <span className="leg-pct">{origen.pctOperativo}%</span>
              </div>
              <div className="legend-row">
                <span className="dot" style={{ backgroundColor: '#5bb8f5' }} />
                <span className="leg-label">Administrativo</span>
                <span className="leg-pct">{origen.pctAdministrativo}%</span>
              </div>
            </div>
          </div>
        </article>

        {/* CARD 6: CATEGORÍA / ENFOQUE */}
        <article className="dash-card">
        <header className="dash-card-header claro">
            <Icono nombre="pastel" size={26} />
            <h3>Sugerencias por enfoque / reason code ({anioFiltro})</h3>
        </header>
        <div className="dash-card-body donut-card-body">
            <div className="dona-wrap">
            <Dona
                total={sugerenciasAnio.length}
                segmentos={porCategoria.map(c => ({ clave: c.categoria, valor: c.cantidad, color: c.color }))}
            />
            </div>
            
            {/* Asegurar la clase cat-legend aquí */}
            <div className="donut-legend cat-legend">
            {porCategoria.length === 0 && <p className="no-data">Sin categorías registradas</p>}
            {porCategoria.map(cat => (
                <div key={cat.categoria} className="legend-row">
                <span className="dot" style={{ backgroundColor: cat.color }} />
                <span className="leg-label" title={cat.categoria}>{cat.categoria}</span>
                <span className="leg-pct">{cat.porcentaje}%</span>
                </div>
            ))}
            </div>
        </div>
        </article>
      </section>
    </div>
  );
}

// Envoltorio: los estilos de este módulo solo aplican dentro de este div
export default function DashboardSugerencias(props) {
  return (
    <div className="hco-scope hco-dashboard-sugerencias">
      <DashboardSugerenciasContenido {...props} />
    </div>
  );
}
