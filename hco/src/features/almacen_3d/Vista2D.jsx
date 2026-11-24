import { useMemo } from 'react';
import {
  alturaMaxima, codProf, codRack, codigoUbicacion, colorCliente, colorOcupacion, distribucion,
  esProfundidadDePuente, infoProfundidad, maxProfundidades, ocupacionProfundidad, profundidadesDeRack,
} from './almacenModelo';

// =========================================================================
// PLANTA (vista desde arriba): un rectángulo por profundidad de cada rack.
// =========================================================================
const PX = 20; // píxeles por metro en el ancho (racks y pasillos)
const FILA = 16; // alto de cada profundidad en px
const MARGEN = { izq: 44, arr: 30 };

const colorNiveles = (n, min, max) => {
  // más niveles = azul más oscuro
  const t = max === min ? 0.5 : (n - min) / (max - min);
  const l = 82 - t * 40;
  return `hsl(215 70% ${l}%)`;
};

export function Planta({ cfg, ocupacion, seleccionProf, onSeleccionarProf, onHover }) {
  const dist = useMemo(() => distribucion(cfg), [cfg]);
  const hayOcupacion = Object.keys(ocupacion).length > 0;
  const maxP = maxProfundidades(cfg);
  const nivelesUsados = [cfg.nivelesBase, ...Object.values(cfg.racksDetalle).map((d) => d.niveles), ...Object.values(cfg.posiciones).map((d) => d.niveles)].filter(Boolean);
  const maxN = Math.max(...nivelesUsados);
  const minN = Math.min(...nivelesUsados);
  const ancho = MARGEN.izq + dist.ancho * PX + 10;
  const alto = MARGEN.arr + maxP * FILA + 30;

  const celdas = [];
  dist.racks.forEach(({ rack: r, x0 }) => {
    const x = MARGEN.izq + x0 * PX;
    const w = cfg.medidas.fondoRack * PX;
    const profs = profundidadesDeRack(cfg, r);
    for (let p = 1; p <= profs; p++) {
      const info = infoProfundidad(cfg, r, p);
      const y = MARGEN.arr + (p - 1) * FILA;
      const clave = `${codRack(r)}-${codProf(p)}`;
      let fill;
      let titulo = `${clave} · ${info.niveles} niveles`;
      if (info.inactiva) fill = '#f1f5f9';
      else if (hayOcupacion) {
        const o = ocupacionProfundidad(cfg, ocupacion, r, p);
        fill = colorOcupacion(o.total ? o.ocupadas / o.total : null);
        titulo += ` · ocupadas ${o.ocupadas}/${o.total}`;
      } else fill = colorNiveles(info.niveles, minN, maxN);
      if (info.puente) titulo += ` · puente (desde nivel ${info.desde})`;
      if (info.inactiva) titulo += ' · inactiva';
      const sel = seleccionProf === clave;
      celdas.push(
        <g key={clave} onClick={() => onSeleccionarProf(r, p)} onMouseMove={(e) => onHover?.(titulo, e.clientX, e.clientY)} onMouseLeave={() => onHover?.(null)} className="alm-celda">
          <rect x={x} y={y + 1} width={w} height={FILA - 2} rx={2} fill={fill}
            stroke={sel ? '#db2777' : info.inactiva ? '#cbd5e1' : '#64748b'}
            strokeWidth={sel ? 2.5 : 0.6} strokeDasharray={info.inactiva ? '3 2' : undefined} />
          {info.puente && !info.inactiva && <rect x={x} y={y + 1} width={w} height={FILA - 2} fill="url(#alm-rayas)" pointerEvents="none" />}
          {info.cambiada && !info.inactiva && <circle cx={x + w - 4} cy={y + 5} r={2.2} fill="#db2777" pointerEvents="none" />}
          {!hayOcupacion && !info.inactiva && (
            <text x={x + w / 2} y={y + FILA / 2 + 3.5} textAnchor="middle" className="alm-txt-n">{info.niveles}</text>
          )}
        </g>,
      );
    }
  });

  return (
    <div className="alm-scroll">
      <svg width={ancho} height={alto} className="alm-svg">
        <defs>
          <pattern id="alm-rayas" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line x1="0" y1="0" x2="0" y2="6" stroke="#0f172a" strokeWidth="1.6" opacity="0.45" />
          </pattern>
        </defs>
        {dist.pasillos.map((p, i) => (
          <rect key={i} x={MARGEN.izq + p.x0 * PX} y={MARGEN.arr - 6} width={(p.x1 - p.x0) * PX} height={maxP * FILA + 12} fill="#e2e8f0" />
        ))}
        {/* Filas de profundidad */}
        {Array.from({ length: maxP }, (_, i) => i + 1).map((p) => (
          <text key={p} x={MARGEN.izq - 6} y={MARGEN.arr + (p - 1) * FILA + FILA / 2 + 4} textAnchor="end"
            className={`alm-txt-eje ${esProfundidadDePuente(cfg, p) ? 'alm-txt-puente' : ''}`}>{codProf(p)}</text>
        ))}
        {dist.racks.map(({ rack, x0 }) => (
          <text key={rack} x={MARGEN.izq + (x0 + cfg.medidas.fondoRack / 2) * PX} y={MARGEN.arr - 12} textAnchor="middle" className="alm-txt-rack">{codRack(rack)}</text>
        ))}
        {celdas}
      </svg>
    </div>
  );
}

// =========================================================================
// ALZADO de un rack (vista de frente): columnas = profundidad.
// La altura del rack es fija; los niveles de cada profundidad se reparten
// dentro de esa altura (ej. 6, 2, 6, 4, 6 niveles con la misma altura).
// =========================================================================
const CW = 34;
const UH = 26; // px por nivel base

export function AlzadoRack({ cfg, rack, ocupacion, clientes, seleccion, seleccionProf, onSeleccionar, onSeleccionarProf, onHover }) {
  const profs = profundidadesDeRack(cfg, rack);
  const altoMax = alturaMaxima(cfg);
  const hayOcupacion = Object.keys(ocupacion).length > 0;
  const izq = 40;
  const arr = 10;
  const piso = arr + altoMax * UH;
  const ancho = izq + profs * CW + 10;
  const alto = piso + 30;

  const cols = [];
  for (let p = 1; p <= profs; p++) {
    const info = infoProfundidad(cfg, rack, p);
    const x = izq + (p - 1) * CW;
    const clave = `${codRack(rack)}-${codProf(p)}`;
    if (info.inactiva) {
      cols.push(<rect key={`in${p}`} x={x + 1} y={piso - info.altura * UH} width={CW - 2} height={info.altura * UH} fill="#f8fafc" stroke="#cbd5e1" strokeDasharray="3 2" />);
      continue;
    }
    if (info.puente && info.libres > 0) {
      cols.push(<rect key={`pu${p}`} x={x + 1} y={piso - info.libres * UH} width={CW - 2} height={info.libres * UH} fill="url(#alm-rayas2)" />);
    }
    for (let n = info.desde; n <= info.niveles; n++) {
      const h = info.alturas[n - 1] * UH;
      const y = piso - (info.bases[n - 1] + info.alturas[n - 1]) * UH;
      const cod = codigoUbicacion(rack, p, n);
      const dato = ocupacion[cod];
      let fill = '#dbeafe';
      if (hayOcupacion) fill = dato ? colorCliente(clientes, dato.cliente) : '#ffffff';
      const sel = seleccion === cod;
      const titulo = dato ? `${cod} · ${dato.cliente || 'Sin cliente'} · ${dato.skus.length} SKU · ${dato.unidades} und` : `${cod}${hayOcupacion ? ' · vacía' : ''}`;
      cols.push(
        <g key={cod} className="alm-celda" onClick={() => onSeleccionar(cod)}
          onMouseMove={(e) => onHover?.(titulo, e.clientX, e.clientY)} onMouseLeave={() => onHover?.(null)}>
          <rect x={x + 1} y={y + 1} width={CW - 2} height={h - 2} rx={2} fill={fill}
            stroke={sel ? '#db2777' : '#64748b'} strokeWidth={sel ? 2.5 : 0.6} />
          {h >= 16 && <text x={x + CW / 2} y={y + h / 2 + 3.5} textAnchor="middle" className="alm-txt-n">{n}</text>}
        </g>,
      );
    }
    // cantidad de niveles arriba de la columna (clic = editar la profundidad)
    cols.push(
      <text key={`c${p}`} x={x + CW / 2} y={piso - info.altura * UH - 3} textAnchor="middle"
        className={`alm-txt-cuenta ${seleccionProf === clave ? 'sel' : ''} ${info.cambiada ? 'cambiada' : ''}`}
        onClick={() => onSeleccionarProf(rack, p)}>{info.niveles}</text>,
    );
  }

  return (
    <div className="alm-scroll">
      <svg width={ancho} height={alto + 14} className="alm-svg">
        <defs>
          <pattern id="alm-rayas2" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line x1="0" y1="0" x2="0" y2="6" stroke="#f59e0b" strokeWidth="2" />
          </pattern>
        </defs>
        <g transform="translate(0 14)">
          {Array.from({ length: altoMax + 1 }, (_, i) => i).map((u) => (
            <g key={u}>
              <line x1={izq - 4} x2={izq} y1={piso - u * UH} y2={piso - u * UH} stroke="#94a3b8" />
              {u > 0 && <text x={izq - 7} y={piso - u * UH + 12} textAnchor="end" className="alm-txt-eje alm-txt-mini">{u}</text>}
            </g>
          ))}
          <line x1={izq} x2={izq + profs * CW} y1={piso} y2={piso} stroke="#334155" strokeWidth="2" />
          {Array.from({ length: profs }, (_, i) => i + 1).map((p) => (
            <text key={p} x={izq + (p - 0.5) * CW} y={piso + 16} textAnchor="middle"
              className={`alm-txt-eje alm-txt-mini ${esProfundidadDePuente(cfg, p) ? 'alm-txt-puente' : ''}`}>{codProf(p)}</text>
          ))}
          {cols}
        </g>
      </svg>
    </div>
  );
}
