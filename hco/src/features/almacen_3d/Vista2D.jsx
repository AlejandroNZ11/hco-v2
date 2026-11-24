import { useMemo, useState } from 'react';
import {
  alturaMaxima, codProf, codRack, codigoUbicacion, colorCliente, colorOcupacion, distribucion,
  esProfundidadDePuente, esRackPeligrosos, filaDe, infoProfundidad, maxProfundidades, ocupacionProfundidad, rangoProfundidades,
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
  // "Como el plano": 001 abajo y el almacén girado 180° (igual que el plano en papel)
  const [comoPlano, setComoPlano] = useState(() => localStorage.getItem('almacen3d.comoPlano') !== '0');
  const cambiarOrientacion = () => {
    const v = !comoPlano;
    setComoPlano(v);
    try {
      localStorage.setItem('almacen3d.comoPlano', v ? '1' : '0');
    } catch { /* ignorar */ }
  };
  const hayOcupacion = Object.keys(ocupacion).length > 0;
  const A = cfg.medidas.anchoPosicion;
  const F = cfg.medidas.fondoRack;
  const escZ = FILA / A; // px por metro a lo largo de la profundidad
  const maxP = maxProfundidades(cfg);
  const nivelesUsados = [cfg.nivelesBase, ...Object.values(cfg.racksDetalle).map((d) => d.niveles), ...Object.values(cfg.posiciones).map((d) => d.niveles)].filter(Boolean);
  const maxN = Math.max(...nivelesUsados);
  const minN = Math.min(...nivelesUsados);
  const zMin = Math.min(dist.stage ? dist.stage.z0 - 1.6 : -1, dist.peligrosos ? dist.peligrosos.z0 - 1 : 0) - 1.5;
  const zMax = Math.max(dist.largo, dist.peligrosos?.z1 ?? 0) + 1.5;
  const xMin = dist.xMin - 0.5;
  const xMax = dist.xMax + 0.5;
  // metros → px (con o sin giro)
  const X = (x) => MARGEN.izq + (comoPlano ? xMax - x : x - xMin) * PX;
  const Y = (z) => MARGEN.arr + (comoPlano ? zMax - z : z - zMin) * escZ;
  // rectángulo de [x0,x1] × [z0,z1] en px
  const R = (x0, x1, z0, z1) => {
    const [a, b] = [X(x0), X(x1)];
    const [c, d] = [Y(z0), Y(z1)];
    return { x: Math.min(a, b), y: Math.min(c, d), width: Math.abs(b - a), height: Math.abs(d - c) };
  };
  const ancho = MARGEN.izq + (xMax - xMin) * PX + 10;
  const alto = MARGEN.arr + (zMax - zMin) * escZ + 10;

  const celdas = [];
  dist.racks.forEach(({ rack: r, x0 }) => {
    const pel = esRackPeligrosos(r);
    const [pD, pH] = rangoProfundidades(cfg, r);
    for (let p = pD; p <= pH; p++) {
      const info = infoProfundidad(cfg, r, p);
      const zb = (filaDe(cfg, r, p) - 1) * A;
      const rc = R(x0, x0 + F, zb, zb + A);
      const clave = `${codRack(r)}-${codProf(p)}`;
      let fill;
      let titulo = `${clave} · ${info.niveles} nivel${info.niveles === 1 ? '' : 'es'}`;
      if (info.inactiva) fill = '#f1f5f9';
      else if (hayOcupacion) {
        const o = ocupacionProfundidad(cfg, ocupacion, r, p);
        fill = colorOcupacion(o.total ? o.ocupadas / o.total : null);
        titulo += ` · ocupadas ${o.ocupadas}/${o.total}`;
      } else fill = pel ? '#fecaca' : colorNiveles(info.niveles, minN, maxN);
      if (info.puente) titulo += ` · puente (desde nivel ${info.desde})`;
      if (info.enrejado) titulo += ' · enrejado';
      if (info.inactiva) titulo += ' · inactiva';
      const sel = seleccionProf === clave;
      celdas.push(
        <g key={clave} onClick={() => onSeleccionarProf(r, p)} onMouseMove={(e) => onHover?.(titulo, e.clientX, e.clientY)} onMouseLeave={() => onHover?.(null)} className="alm-celda">
          <rect x={rc.x} y={rc.y + 1} width={rc.width} height={rc.height - 2} rx={2} fill={fill}
            stroke={sel ? '#db2777' : info.inactiva ? '#cbd5e1' : '#64748b'}
            strokeWidth={sel ? 2.5 : 0.6} strokeDasharray={info.inactiva ? '3 2' : undefined} />
          {info.puente && !info.inactiva && <rect x={rc.x} y={rc.y + 1} width={rc.width} height={rc.height - 2} fill="url(#alm-rayas)" pointerEvents="none" />}
          {info.enrejado && !info.inactiva && <rect x={rc.x} y={rc.y + 1} width={rc.width} height={rc.height - 2} fill="url(#alm-reja)" pointerEvents="none" />}
          {info.cambiada && !info.inactiva && <circle cx={rc.x + rc.width - 4} cy={rc.y + 5} r={2.2} fill="#db2777" pointerEvents="none" />}
          {!hayOcupacion && !info.inactiva && (
            <text x={rc.x + rc.width / 2} y={rc.y + rc.height / 2 + 3.5} textAnchor="middle" className="alm-txt-n">{pel ? codProf(p) : info.niveles}</text>
          )}
        </g>,
      );
    }
  });

  const s = dist.stage;
  const pel = dist.peligrosos;
  const PUERTA = 2.4;
  const topeRack = (r) => {
    // etiqueta del rack en el extremo de arriba de la pantalla
    const [pD, pH] = rangoProfundidades(cfg, r);
    const z0 = (filaDe(cfg, r, pD) - 1) * A;
    const z1 = filaDe(cfg, r, pH) * A;
    return Math.min(Y(z0), Y(z1)) - 6;
  };

  return (
    <div className="alm-planta">
      <div className="alm-planta-barra">
        <label className="alm-check-linea">
          <input type="checkbox" checked={comoPlano} onChange={cambiarOrientacion} /> Ver como el plano (001 abajo)
        </label>
      </div>
      <div className="alm-scroll">
        <svg width={ancho} height={alto} className="alm-svg">
          <defs>
            <pattern id="alm-rayas" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <line x1="0" y1="0" x2="0" y2="6" stroke="#0f172a" strokeWidth="1.6" opacity="0.45" />
            </pattern>
            <pattern id="alm-reja" width="4" height="4" patternUnits="userSpaceOnUse">
              <circle cx="2" cy="2" r="0.9" fill="#0f172a" opacity="0.55" />
            </pattern>
          </defs>

          {/* Stage y rampas */}
          {s && (
            <g>
              <rect {...R(s.x0, s.x1, s.z0, s.z1)} fill="#d1fae5" stroke="#059669" />
              <text x={X((s.x0 + s.x1) / 2)} y={Y((s.z0 + s.z1) / 2) + 6} textAnchor="middle" className="alm-txt-zona" fill="#047857">STAGE</text>
              {s.rampas.map((r) => {
                const puerta = R(r.xc - r.ancho / 2, r.xc + r.ancho / 2, s.z0 - 1.2, s.z0);
                return (
                  <g key={r.numero}>
                    <rect {...R(r.xc - r.ancho / 2, r.xc + r.ancho / 2, s.z0, s.z0 + Math.min(8, s.z1 - s.z0 - 1))} fill="#a7f3d0" />
                    <rect {...puerta} rx={2} fill="#334155" />
                    <text x={puerta.x + puerta.width / 2} y={puerta.y + puerta.height / 2 + 3.5} textAnchor="middle" className="alm-txt-rampa">R{r.numero}</text>
                  </g>
                );
              })}
            </g>
          )}

          {/* Peligrosos: recinto, pasillos y puertas */}
          {pel && (
            <g>
              {/* entre el almacén y peligrosos: aire libre, sin techo */}
              <text x={X((pel.ingreso.x0 + pel.ingreso.x1) / 2)} y={Y((pel.z0 + pel.z1) / 2)} textAnchor="middle" className="alm-txt-eje alm-txt-aire">Aire libre</text>
              {pel.pasilloIngreso && (() => {
                const pi = pel.pasilloIngreso;
                const rc = R(pi.x0, pi.x1, pi.z0, pi.z1);
                return (
                  <g>
                    <rect {...rc} fill="#cbd5e1" />
                    <line x1={rc.x} x2={rc.x + rc.width} y1={rc.y + 1} y2={rc.y + 1} stroke="#facc15" strokeWidth="2" />
                    <line x1={rc.x} x2={rc.x + rc.width} y1={rc.y + rc.height - 1} y2={rc.y + rc.height - 1} stroke="#facc15" strokeWidth="2" />
                    <text x={rc.x + rc.width / 2} y={rc.y + rc.height / 2 + 3.5} textAnchor="middle" className="alm-txt-eje alm-txt-mini">{X(pel.lineaIngreso) > X(pel.pared) ? 'Pasillo →' : '← Pasillo'}</text>
                  </g>
                );
              })()}
              <rect {...R(pel.rojo.x0, pel.rojo.x1, pel.z0, pel.z1)} fill="#fef2f2" stroke="#dc2626" strokeWidth="2" />
              {pel.pasillos.map((p, i) => (
                <rect key={i} {...R(p.x0, p.x1, pel.z0 + 0.2, pel.z1 - 0.2)} fill="#fee2e2" />
              ))}
              {(() => {
                const zc = (pel.antesala.z0 + pel.antesala.z1) / 2;
                return [[pel.pared, 'Salida'], [pel.lineaIngreso, 'Ingreso']].map(([xp, t]) => {
                  const rc = R(xp - 0.25, xp + 0.25, zc - PUERTA / 2, zc + PUERTA / 2);
                  return (
                    <g key={t}>
                      <rect {...rc} fill="#facc15" stroke="#854d0e" />
                      <text x={rc.x + rc.width / 2} y={rc.y - 3} textAnchor="middle" className="alm-txt-mini alm-txt-eje">{t}</text>
                    </g>
                  );
                });
              })()}
              <text x={X((pel.rojo.x0 + pel.rojo.x1) / 2)} y={Math.min(Y(pel.z0), Y(pel.z1)) - 8} textAnchor="middle" className="alm-txt-zona" fill="#b91c1c">PELIGROSOS</text>
            </g>
          )}

          {dist.pasillos.map((p, i) => (
            <rect key={i} {...R(p.x0, p.x1, -0.3, maxP * A + 0.3)} fill="#e2e8f0" />
          ))}
          {/* Profundidades del almacén principal */}
          {Array.from({ length: maxP }, (_, i) => i + 1).map((p) => (
            <text key={p} x={MARGEN.izq - 6} y={Y((p - 0.5) * A) + 4} textAnchor="end"
              className={`alm-txt-eje ${esProfundidadDePuente(cfg, p) ? 'alm-txt-puente' : ''}`}>{codProf(p)}</text>
          ))}
          {dist.racks.map(({ rack, x0 }) => (
            <text key={rack} x={X(x0 + F / 2)} y={topeRack(rack)} textAnchor="middle"
              className="alm-txt-rack" fill={esRackPeligrosos(rack) ? '#b91c1c' : undefined}>{codRack(rack)}</text>
          ))}
          {celdas}
        </svg>
      </div>
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
  const [pD, pH] = rangoProfundidades(cfg, rack);
  const profs = Math.max(0, pH - pD + 1);
  const altoMax = esRackPeligrosos(rack) ? Math.max(infoProfundidad(cfg, rack, pD).altura, 1) : alturaMaxima(cfg);
  const hayOcupacion = Object.keys(ocupacion).length > 0;
  const izq = 40;
  const arr = 10;
  const piso = arr + altoMax * UH;
  const ancho = izq + profs * CW + 10;
  const alto = piso + 30;

  const cols = [];
  for (let p = pD; p <= pH; p++) {
    const info = infoProfundidad(cfg, rack, p);
    const x = izq + (p - pD) * CW;
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
    if (info.enrejado) {
      cols.push(<rect key={`rj${p}`} x={x + 1} y={piso - info.altura * UH} width={CW - 2} height={info.altura * UH} fill="url(#alm-reja2)" stroke="#334155" strokeWidth="1.2" pointerEvents="none" />);
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
          <pattern id="alm-reja2" width="6" height="6" patternUnits="userSpaceOnUse">
            <path d="M0 0H6M0 0V6" stroke="#334155" strokeWidth="0.7" opacity="0.7" fill="none" />
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
          {Array.from({ length: profs }, (_, i) => i + pD).map((p) => (
            <text key={p} x={izq + (p - pD + 0.5) * CW} y={piso + 16} textAnchor="middle"
              className={`alm-txt-eje alm-txt-mini ${esProfundidadDePuente(cfg, p, rack) ? 'alm-txt-puente' : ''}`}>{codProf(p)}</text>
          ))}
          {cols}
        </g>
      </svg>
    </div>
  );
}
