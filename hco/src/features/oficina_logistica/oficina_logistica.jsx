import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  FaBuilding, FaUserPlus, FaUserMinus, FaSearchPlus, FaSearchMinus, FaExpand,
  FaTimes, FaCloudUploadAlt, FaChair, FaUndoAlt, FaRedoAlt, FaHandPaper,
} from 'react-icons/fa';

import { localDb } from '../../services/localDb';
import { escuchar, EVENTOS } from '../../services/eventBus';
import { useSupabaseRealtime } from '../../hooks/useSupabaseRealtime';
import IndicadorEnVivo from '../../components/IndicadorEnVivo';
import {
  guardarPuesto,
  obtenerEmpleadosOficina,
  refrescarPuestos,
  registrarCambioRemotoPuesto,
} from '../../services/oficinaLogisticaService';
import './oficina_logistica.css';

// =========================================================================
// ESTADOS DE UN PUESTO
// =========================================================================
const ESTADOS = {
  en_oficina: { label: 'En oficina', color: '#22c55e' },
  almuerzo: { label: 'Almuerzo', color: '#0ea5e9' },
  en_campo: { label: 'En campo', color: '#f59e0b' },
  reunion: { label: 'En reunión', color: '#8b5cf6' },
  ausente: { label: 'Ausente', color: '#94a3b8' },
  salida: { label: 'Salió', color: '#475569' },
};
const ORDEN_ESTADOS = ['en_oficina', 'almuerzo', 'en_campo', 'reunion', 'ausente', 'salida'];

// Horario de la oficina: fuera de este horario nadie aparece en su puesto
const HORA_ENTRADA = 8;
const HORA_SALIDA = 18;
// Estado que se muestra según la hora:
//  · Fuera de horario, si no actualizó después de la salida → "Salió"
//  · Al día siguiente (ya en horario), un "Salió" o "Almuerzo" de ayer vuelve a "En oficina"
const estadoEfectivo = (estado, actualizadoEn, ahora) => {
  const guardado = ESTADOS[estado] ? estado : 'en_oficina';
  const t = actualizadoEn ? new Date(actualizadoEn).getTime() : 0;
  const hoy = new Date(ahora);
  const entradaHoy = new Date(hoy).setHours(HORA_ENTRADA, 0, 0, 0);
  const salidaHoy = new Date(hoy).setHours(HORA_SALIDA, 0, 0, 0);
  if (ahora >= salidaHoy) return t >= salidaHoy ? guardado : 'salida';
  if (ahora < entradaHoy) return t >= salidaHoy - 86400000 ? guardado : 'salida';
  if (t < entradaHoy && (guardado === 'salida' || guardado === 'almuerzo')) return 'en_oficina';
  return guardado;
};

// Cada sitio de una línea puede ser puesto, impresora, botiquín o vacío.
// El tipo se cambia desde la app (columna `tipo` en oficina_puestos).
const TIPOS_SITIO = {
  puesto: 'Puesto',
  impresora: 'Impresora',
  botiquin: 'Botiquín',
  vacio: 'Vacío',
};

// =========================================================================
// PLANO — sale directo del dibujo visto desde arriba (2000 x 1200 px):
//   izquierda = fondo (Glass Wall, Oficina 1, Oficina 2, cafeta)   derecha = zona de cascos (entrada)
//   arriba    = Comunicación Interna                                 abajo   = módulos y puerta de salida
// En el mundo: x va de Com. Interna (0) a los módulos; y va de la entrada (0) al fondo.
// =========================================================================
const K = 90; // px del dibujo por metro
const WX = (py) => (py - 5) / K;
const WY = (px) => (1995 - px) / K;
const S = 30; // px de pantalla por metro
const ANCHO = WX(1197);
const FONDO = WY(5);
const ALTO_MURO = 3.2;
// Rectángulo del dibujo (x1, x2, y1, y2 en px) → rectángulo del mundo
const R = (px1, px2, py1, py2) => ({ x1: WX(py1), x2: WX(py2), y1: WY(px2), y2: WY(px1) });

// ---- 3 líneas de 4 tramos; cada tramo tiene un sitio hacia la entrada (N) y otro hacia el fondo (S)
const X0_LINEAS = WX(125);
const SEGX = (WX(838) - WX(125)) / 4; // ancho de cada sitio
const PROF_ESC = 1.0; // fondo de un escritorio
const LINEAS = [
  { fila: 'A', cy: WY((1434 + 1649) / 2) },
  { fila: 'B', cy: WY((1037 + 1252) / 2) },
  { fila: 'C', cy: WY((665 + 882) / 2) },
];
// Valor inicial mientras la BD no diga otra cosa
const TIPO_INICIAL = { A7: 'impresora', B8: 'vacio', C8: 'botiquin' };

// Sitios A1..A8: impares lado norte (entrada), pares lado sur (fondo), de izquierda a derecha del dibujo
const SITIOS = LINEAS.flatMap((l) =>
  [0, 1, 2, 3].flatMap((i) =>
    ['N', 'S'].map((lado) => {
      const id = `${l.fila}${i * 2 + (lado === 'N' ? 1 : 2)}`;
      return { id, fila: l.fila, lado, cx: X0_LINEAS + SEGX * (i + 0.5), cy: l.cy, tipo: TIPO_INICIAL[id] || 'puesto' };
    })
  )
);

// ---- Oficinas cerradas (esquinas del fondo)
const OF1 = { x1: WX(965), x2: ANCHO, y1: WY(482), y2: FONDO, puerta: [WX(1060), WX(1140)] };
const OF2 = { x1: 0, x2: WX(300), y1: WY(285), y2: FONDO, puerta: [WX(200), WX(270)] };

// Escritorios dentro de las oficinas (se asignan igual que cualquier puesto)
const PRIVADOS = [
  { id: 'OF1', fila: 'OF', lado: 'N', cx: (OF1.x1 + OF1.x2) / 2, cy: FONDO - 0.12, tipo: 'puesto', privado: 'Oficina 1' },
  { id: 'OF2', fila: 'OF', lado: 'N', cx: OF2.x2 / 2, cy: FONDO - 0.12, tipo: 'puesto', privado: 'Oficina 2' },
];
const TODOS_SITIOS = [...PRIVADOS, ...SITIOS];

// ---- Resto del mobiliario (rectángulos del dibujo)
const MODULO = R(1670, 1927, 50, 117);
const MODULOS = { ...R(500, 1410, 1085, 1178), x2: ANCHO - 0.05, n: 6 };
const PUERTA_SALIDA = [WY(1897), WY(1497)];
const PERCHERO = [WX(991), WY(542)];
const INSUMO_CAFE = { ...R(262, 405, 890, 965), x2: OF1.x1 - 0.02 };
const CAFETA = { ...R(35, 262, 865, 965), x2: OF1.x1 - 0.02, y2: FONDO - 0.04 };
const EXTINTOR = [CAFETA.x1 - 0.45, FONDO - 0.3];
const PANEL_CASCOS = { x1: WX(425), x2: WX(803), y: WY(1897) };
const GLASS_WALL = { x1: WX(300) + 0.2, x2: WX(790) };
const COM_INTERNA = { x: WX(53), y1: WY(600), y2: WY(310) };

// Cafetería: mesa alta y lugares alrededor para quienes están en almuerzo
const MESA_CAFE = [CAFETA.x1 - 1.6, (CAFETA.y1 + FONDO) / 2 - 0.6];
const LUGARES_ALMUERZO = [
  [0.75, 0], [-0.75, 0], [0, -0.75], [0, 0.75], [0.6, -0.6], [-0.6, 0.6], [-0.6, -0.6], [0.6, 0.6],
].map(([dx, dy]) => [MESA_CAFE[0] + dx, MESA_CAFE[1] + dy]);

// Geometría de un sitio (escritorio, silla, monitor y zona de color)
const geo = (s) => {
  const n = s.lado === 'N';
  const x0 = s.cx - SEGX / 2;
  const y0 = n ? s.cy - PROF_ESC : s.cy;
  return {
    n,
    fy: n ? 1 : -1, // la persona mira hacia el vidrio central
    x0,
    y0,
    sillaY: n ? s.cy - PROF_ESC - 0.55 : s.cy + PROF_ESC + 0.55,
    monY: n ? s.cy - 0.34 : s.cy + 0.26,
    tecladoY: n ? y0 + 0.12 : y0 + PROF_ESC - 0.37,
    zona: {
      x1: x0 + 0.06,
      x2: x0 + SEGX - 0.06,
      y1: n ? s.cy - PROF_ESC - 0.95 : s.cy,
      y2: n ? s.cy : s.cy + PROF_ESC + 0.95,
    },
  };
};

// =========================================================================
// CÁMARA: proyección ortográfica que gira 360° (arrastrando) y se inclina
//   az = giro alrededor de la sala (0 = desde el fondo, 90 = desde los módulos, 180 = desde la entrada)
//   el = inclinación (cuánto se ve desde arriba)
// =========================================================================
// Se fijan al inicio de cada render; todo el dibujo ocurre en esa misma pasada.
let SA = 1;
let CA = 0;
let SE = 0.64;
let CE = 0.77;
const fijarCamara = (az, el) => {
  const a = (az * Math.PI) / 180;
  const e = (el * Math.PI) / 180;
  SA = Math.sin(a);
  CA = Math.cos(a);
  SE = Math.sin(e);
  CE = Math.cos(e);
};
// Isométrica clásica: la sala se ve como un rectángulo recto (lados a 30°)
const CAM_INICIAL = { az: 135, el: 35.26 };
// Al soltar, el giro se acomoda a la diagonal más cercana para que quede recto
const diagonalCercana = (az) => Math.round((az - 45) / 90) * 90 + 45;
const EL_MIN = 18;
const EL_MAX = 80;
const VISTAS = ['Desde el fondo', 'Desde los módulos', 'Desde la entrada', 'Desde Com. Interna'];
const normalizarAz = (az) => ((az % 360) + 360) % 360;
const nombreVista = (az) => VISTAS[Math.floor(normalizarAz(az) / 90) % 4];
// Cara interior de cada pared (se ve solo la que queda detrás)
const NORMAL_MURO = { norte: [0, 1], sur: [0, -1], oeste: [1, 0], este: [-1, 0] };

const CXM = ANCHO / 2;
const CYM = FONDO / 2;
const rotar = (x, y) => {
  const dx = x - CXM;
  const dy = y - CYM;
  return [dx * CA - dy * SA, dx * SA + dy * CA];
};
const P = (x, y, z = 0) => {
  const [u, v] = rotar(x, y);
  return [u * S, (v * SE - z * CE) * S];
};
// Más grande = más cerca de la cámara (se dibuja después)
const profundidad = (x, y) => rotar(x, y)[1];
const fmt = ([a, b]) => `${a.toFixed(1)},${b.toFixed(1)}`;
const pts = (lista) => lista.map(([x, y, z]) => fmt(P(x, y, z))).join(' ');

// ¿Una dirección del mundo (dx, dy) apunta hacia la cámara?
const haciaCamara = (dx, dy) => dx * SA + dy * CA > 1e-6;

const sombra = (hex, f) => {
  const n = parseInt(hex.slice(1), 16);
  const c = (v) => Math.max(0, Math.min(255, Math.round(v * f)));
  return `rgb(${c((n >> 16) & 255)},${c((n >> 8) & 255)},${c(n & 255)})`;
};

// Luz fija en la sala: las caras cambian de tono al girar
const LUZ = [-0.45, 0.89];
function Caja({ x, y, z = 0, w, d, h, color, opacity, borde = 'rgba(0,0,0,.08)' }) {
  const x2 = x + w;
  const y2 = y + d;
  const zt = z + h;
  const lados = [
    [0, -1, x, y, x2, y],
    [1, 0, x2, y, x2, y2],
    [0, 1, x2, y2, x, y2],
    [-1, 0, x, y2, x, y],
  ].filter(([nx, ny]) => haciaCamara(nx, ny));
  return (
    <g opacity={opacity}>
      {lados.map(([nx, ny, ax, ay, bx, by]) => (
        <polygon
          key={`${nx}${ny}`}
          points={pts([[ax, ay, z], [bx, by, z], [bx, by, zt], [ax, ay, zt]])}
          fill={sombra(color, 0.8 + 0.1 * (nx * LUZ[0] + ny * LUZ[1]))}
          stroke={borde}
          strokeWidth="0.6"
        />
      ))}
      <polygon points={pts([[x, y, zt], [x2, y, zt], [x2, y2, zt], [x, y2, zt]])} fill={color} stroke={borde} strokeWidth="0.6" />
    </g>
  );
}

const PisoRect = ({ x1, y1, x2, y2, ...props }) => (
  <polygon points={pts([[x1, y1, 0], [x2, y1, 0], [x2, y2, 0], [x1, y2, 0]])} {...props} />
);

// ---- Superficies verticales (paredes y caras de paneles). `a` recorre la superficie.
const PLANO_MURO = {
  norte: (a, z) => [a, 0.02, z],
  sur: (a, z) => [a, FONDO - 0.02, z],
  oeste: (a, z) => [0.02, a, z],
  este: (a, z) => [ANCHO - 0.02, a, z],
};
const LARGO_MURO = { norte: ANCHO, sur: ANCHO, oeste: FONDO, este: FONDO };

const RectPlano = ({ plano, a1, a2, z1, z2, ...props }) => (
  <polygon points={pts([plano(a1, z1), plano(a2, z1), plano(a2, z2), plano(a1, z2)])} {...props} />
);

// Texto centrado sobre una superficie vertical, siempre legible de izquierda a derecha
function TextoPlano({ plano, a, z, children, ...props }) {
  const [px, py] = P(...plano(a, z));
  const [qx, qy] = P(...plano(a + 1, z));
  let ux = qx - px;
  let uy = qy - py;
  const largo = Math.hypot(ux, uy) || 1;
  ux /= largo;
  uy /= largo;
  if (ux < 0) { ux = -ux; uy = -uy; }
  return (
    <text transform={`matrix(${ux},${uy},0,1,${px},${py})`} textAnchor="middle" {...props}>{children}</text>
  );
}

// Texto centrado sobre el piso, orientado hacia el lado más legible
function TextoPiso({ x, y, children, ...props }) {
  const [ox, oy] = P(x, y, 0);
  const dirs = [[1, 0], [0, 1], [-1, 0], [0, -1]].map(([dx, dy]) => {
    const [qx, qy] = P(x + dx, y + dy, 0);
    return [(qx - ox) / S, (qy - oy) / S];
  });
  const iu = dirs.reduce((m, d, i) => (d[0] > dirs[m][0] ? i : m), 0);
  const v = [dirs[(iu + 1) % 4], dirs[(iu + 3) % 4]].find((d) => d[1] > 0) || [0, 1];
  const largo = Math.hypot(...dirs[iu]) || 1;
  const u = [dirs[iu][0] / largo, dirs[iu][1] / largo];
  return (
    <text transform={`matrix(${u[0]},${u[1]},${v[0]},${v[1]},${ox},${oy})`} textAnchor="middle" dominantBaseline="middle" {...props}>
      {children}
    </text>
  );
}

// ---------- personas ----------
const hash = (txt) => {
  let h = 0;
  for (const ch of String(txt)) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return Math.abs(h);
};
const CAMISAS = ['#1e3a5f', '#0f4c81', '#334155', '#1f2937', '#0e7490', '#475569', '#7c2d12', '#3730a3'];
const PIELES = ['#f1c7a5', '#e0ac85', '#c68b5e', '#a8714a', '#8d5a3b'];
const CABELLOS = ['#1f1a17', '#3b2a20', '#5a3d2b', '#111827', '#6b4f3a'];

// `fy` = hacia dónde mira la persona en el eje y del mundo (1 ó -1)
function Persona({ x, y, z = 0.5, semilla, fy, dePie }) {
  const [px, py] = P(x, y, dePie ? 0.95 : z);
  const [sx, sy] = P(x, y, 0);
  const h = hash(semilla);
  const camisa = CAMISAS[h % CAMISAS.length];
  const piel = PIELES[(h >> 3) % PIELES.length];
  const pelo = CABELLOS[(h >> 6) % CABELLOS.length];
  const chaleco = h % 3 === 0;
  const deFrente = haciaCamara(0, fy);
  const lado = P(x, y + fy, z)[0] >= px ? 1 : -1;
  return (
    <g className="ofi-persona">
      {dePie ? (
        <>
          <ellipse cx={sx} cy={sy} rx="9" ry="3.5" fill="rgba(0,0,0,.15)" />
          <rect x={px - 6} y={py} width="5" height={Math.max(4, sy - py)} rx="2" fill="#1f2937" />
          <rect x={px + 1} y={py} width="5" height={Math.max(4, sy - py)} rx="2" fill="#1f2937" />
        </>
      ) : (
        <ellipse cx={px} cy={py + 2} rx="9" ry="4" fill="rgba(0,0,0,.12)" />
      )}
      <rect x={px - 8} y={py - 21} width="16" height="22" rx="7" fill={camisa} />
      {chaleco && (
        <>
          <path d={`M${px - 8} ${py - 14} q0 -7 5 -7 v22 h-5z M${px + 8} ${py - 14} q0 -7 -5 -7 v22 h5z`} fill="#facc15" />
          <rect x={px - 8} y={py - 7} width="16" height="2.4" fill="#d1d5db" />
        </>
      )}
      <circle cx={px} cy={py - 28} r="7.2" fill={piel} />
      {deFrente ? (
        <>
          <path d={`M${px - 7.4} ${py - 28} a7.4 7.4 0 0 1 14.8 0 q-4 -3.5 -7.4 -2.6 q-4 0.6 -7.4 2.6z`} fill={pelo} />
          <circle cx={px + lado * 1.2 - 2} cy={py - 26.5} r="0.9" fill="#1f2937" />
          <circle cx={px + lado * 1.2 + 2} cy={py - 26.5} r="0.9" fill="#1f2937" />
        </>
      ) : (
        <path d={`M${px - 7.4} ${py - 27} a7.4 7.4 0 0 1 14.8 0 v1.5 q-7.4 3 -14.8 0z`} fill={pelo} />
      )}
    </g>
  );
}

// Silla con persona opcional. El respaldo se dibuja antes o después según la cámara.
function SillaConPersona({ x, y, fy, persona }) {
  const respaldoY = fy > 0 ? y - 0.45 : y + 0.35;
  const [bx, by] = P(x, y, 0.42);
  const [fx2, fy2] = P(x, y, 0.02);
  const respaldo = <Caja x={x - 0.33} y={respaldoY} z={0.5} w={0.66} d={0.1} h={0.62} color="#2b2f36" />;
  const respaldoAtras = profundidad(x, respaldoY + 0.05) < profundidad(x, y);
  return (
    <>
      <ellipse cx={fx2} cy={fy2} rx="9" ry="3.5" fill="rgba(0,0,0,.12)" />
      <line x1={bx} y1={by} x2={fx2} y2={fy2} stroke="#4b5058" strokeWidth="2.5" />
      {respaldoAtras && respaldo}
      <Caja x={x - 0.35} y={y - 0.35} z={0.42} w={0.7} d={0.7} h={0.08} color="#3a3f47" />
      {persona && <Persona x={x} y={y} semilla={persona} fy={fy} />}
      {!respaldoAtras && respaldo}
    </>
  );
}

// Escritorio blanco con cajonera y cinta azul (como en las fotos)
function EscritorioBase({ x0, y0, w = SEGX, d = PROF_ESC }) {
  return (
    <>
      <Caja x={x0 + 0.03} y={y0} z={0} w={0.06} d={d} h={0.66} color="#cbd0d6" />
      <Caja x={x0 + w - 0.09} y={y0} z={0} w={0.06} d={d} h={0.66} color="#cbd0d6" />
      <Caja x={x0 + w - 0.8} y={y0 + 0.15} z={0} w={0.6} d={0.62} h={0.62} color="#eef0ec" />
      <Caja x={x0} y={y0} z={0.66} w={w} d={d} h={0.06} color="#f6f7f4" />
      <polygon
        points={pts([[x0 + 0.1, y0 + 0.08, 0.725], [x0 + w - 0.1, y0 + 0.08, 0.725], [x0 + w - 0.1, y0 + d - 0.08, 0.725], [x0 + 0.1, y0 + d - 0.08, 0.725]])}
        fill="none" stroke="#60a5fa" strokeWidth="1.2"
      />
    </>
  );
}

// Monitor; la pantalla mira a la persona (dirección -fy)
function Monitor({ cx, y, fy, encendido }) {
  const caraY = fy > 0 ? y - 0.001 : y + 0.081;
  return (
    <>
      <Caja x={cx - 0.36} y={y} z={0.74} w={0.72} d={0.08} h={0.46} color="#2b2f36" />
      {haciaCamara(0, -fy) && (
        <polygon
          points={pts([[cx - 0.31, caraY, 0.79], [cx + 0.31, caraY, 0.79], [cx + 0.31, caraY, 1.15], [cx - 0.31, caraY, 1.15]])}
          fill={encendido ? '#7dd3fc' : '#1f2937'}
        />
      )}
    </>
  );
}

// Panel de pie (pizarras): caja delgada y, si su cara mira a la cámara, el contenido
function PanelPie({ x, y, w, d, normal, z1 = 0.9, z2 = 2.45, color = '#3f444b', children }) {
  const [nx, ny] = normal;
  const plano = nx !== 0
    ? (a, z) => [nx > 0 ? x + w + 0.003 : x - 0.003, a, z]
    : (a, z) => [a, ny > 0 ? y + d + 0.003 : y - 0.003, z];
  const [a1, a2] = nx !== 0 ? [y, y + d] : [x, x + w];
  const visible = haciaCamara(nx, ny);
  const patas = nx !== 0 ? [[x, y + 0.1], [x, y + d - 0.15]] : [[x + 0.1, y], [x + w - 0.15, y]];
  // De espaldas a la cámara queda semitransparente para no tapar las líneas
  return (
    <g opacity={visible ? 1 : 0.28}>
      {patas.map(([px, py], i) => (
        <Caja key={i} x={px} y={py} z={0} w={nx !== 0 ? w : 0.05} d={nx !== 0 ? 0.05 : d} h={z1} color="#9ca3af" />
      ))}
      <Caja x={x} y={y} z={z1} w={w} d={d} h={z2 - z1} color={color} />
      {visible && children({ plano, a1, a2, z1, z2 })}
    </g>
  );
}

// Caja de cada pared (por fuera del piso)
const CAJA_MURO = {
  norte: { x: -0.3, y: -0.3, w: ANCHO + 0.6, d: 0.3 },
  sur: { x: -0.3, y: FONDO, w: ANCHO + 0.6, d: 0.3 },
  oeste: { x: -0.3, y: -0.3, w: 0.3, d: FONDO + 0.6 },
  este: { x: ANCHO, y: -0.3, w: 0.3, d: FONDO + 0.6 },
};

// Decoración pegada a las paredes
const DECOR_MUROS = [
  // Norte: ventana
  { pared: 'norte', a1: 9.4, a2: 12.4, z1: 1.0, z2: 2.45, fill: '#e5e7eb' },
  { pared: 'norte', a1: 9.5, a2: 12.3, z1: 1.08, z2: 2.37, fill: 'url(#ofi-cielo)' },
  // Este: puerta de salida
  { pared: 'este', a1: PUERTA_SALIDA[0], a2: PUERTA_SALIDA[1], z1: 0, z2: 2.3, fill: '#9a6b43' },
  { pared: 'este', a1: PUERTA_SALIDA[0] + 1.3, a2: PUERTA_SALIDA[0] + 1.4, z1: 1.0, z2: 1.2, fill: '#d6d3d1' },
  { pared: 'este', a1: (PUERTA_SALIDA[0] + PUERTA_SALIDA[1]) / 2 - 0.6, a2: (PUERTA_SALIDA[0] + PUERTA_SALIDA[1]) / 2 + 0.6, z1: 2.42, z2: 2.7, fill: '#15803d' },
  { pared: 'este', texto: 'SALIDA', a: (PUERTA_SALIDA[0] + PUERTA_SALIDA[1]) / 2, z: 2.5, clase: 'ofi-txt-muro ofi-txt-mini', fill: '#f8fafc' },
  // Sur (fondo): letrero de cafetería y del extintor
  { pared: 'sur', a1: CAFETA.x1 + 0.05, a2: CAFETA.x2 - 0.05, z1: 1.8, z2: 2.1, fill: '#1e293b' },
  { pared: 'sur', texto: 'CAFETERÍA', a: (CAFETA.x1 + CAFETA.x2) / 2, z: 1.91, clase: 'ofi-txt-muro ofi-txt-mini', fill: '#f8fafc' },
  { pared: 'sur', a1: EXTINTOR[0] - 0.2, a2: EXTINTOR[0] + 0.2, z1: 1.3, z2: 1.6, fill: '#dc2626' },
  // Oeste: ventanas
  { pared: 'oeste', a1: 4.5, a2: 8.0, z1: 1.0, z2: 2.45, fill: '#e5e7eb' },
  { pared: 'oeste', a1: 4.6, a2: 7.9, z1: 1.08, z2: 2.37, fill: 'url(#ofi-cielo)' },
  { pared: 'oeste', a1: 9.0, a2: 12.5, z1: 1.0, z2: 2.45, fill: '#e5e7eb' },
  { pared: 'oeste', a1: 9.1, a2: 12.4, z1: 1.08, z2: 2.37, fill: 'url(#ofi-cielo)' },
];

// Nombre corto: "PEREZ GOMEZ, JUAN CARLOS" → "Juan Perez"
const tc = (t) => String(t || '').toLowerCase().replace(/(^|\s)\S/g, (m) => m.toUpperCase());
const nombreCorto = (nombre) => {
  const txt = String(nombre || '').trim();
  if (!txt) return '';
  if (txt.includes(',')) {
    const [ap, no] = txt.split(',');
    return tc(`${no.trim().split(/\s+/)[0] || ''} ${ap.trim().split(/\s+/)[0] || ''}`.trim());
  }
  const t = txt.split(/\s+/);
  return tc(t.length > 1 ? `${t[0]} ${t[1]}` : t[0]);
};
const primerNombre = (nombre) => nombreCorto(nombre).split(' ')[0];
const iniciales = (nombre) => nombreCorto(nombre).split(' ').map((p) => p[0]).join('').slice(0, 2);

const leerAuthUser = () => {
  try {
    return JSON.parse(localStorage.getItem('authUser') || sessionStorage.getItem('authUser') || 'null');
  } catch {
    return null;
  }
};

const CLAVE_CAMARA = 'ofi_camara_v3';
const leerCamara = () => {
  try {
    const v = JSON.parse(localStorage.getItem(CLAVE_CAMARA) || 'null');
    if (v && Number.isFinite(v.az) && Number.isFinite(v.el)) {
      return { az: normalizarAz(v.az), el: Math.min(EL_MAX, Math.max(EL_MIN, v.el)) };
    }
  } catch { /* sin almacenamiento */ }
  return CAM_INICIAL;
};
const guardarCamara = (v) => {
  try { localStorage.setItem(CLAVE_CAMARA, JSON.stringify(v)); } catch { /* sin almacenamiento */ }
};

const ambienteVentana = () => {
  const h = new Date().getHours();
  if (h >= 6 && h < 17) return ['#bfe3f7', '#e8f6fd'];
  if (h >= 17 && h < 19) return ['#f9b97a', '#fde4c4'];
  return ['#1e293b', '#334155'];
};

const MSG_SIN_TABLA = 'No se encontró la tabla de puestos. Ejecuta supabase/sql/oficina_logistica.sql en Supabase.';

// =========================================================================
// COMPONENTE
// =========================================================================
export default function OficinaLogistica() {
  const [authUser] = useState(leerAuthUser);
  const rol = String(authUser?.rol || '').toUpperCase();
  const esAdmin = ['SUPERADMIN', 'SUPERVISOR', 'ADMIN'].includes(rol);

  const puestosDb = useLiveQuery(() => localDb.oficina_puestos.toArray(), [], []);
  const [empleados, setEmpleados] = useState([]);
  const [aviso, setAviso] = useState('');
  const [seleccion, setSeleccion] = useState(null);
  const [hover, setHover] = useState(null);
  const [filtro, setFiltro] = useState(null);
  const [camara, setCamara] = useState(leerCamara);
  const [zoom, setZoom] = useState(() =>
    Math.min(2.4, Math.max(1, 780 / Math.max(320, Math.min(window.innerWidth - 24, 1400))))
  );
  const [guardando, setGuardando] = useState(false);
  // Reloj: cada minuto revisa el horario (salida automática)
  const [ahora, setAhora] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setAhora(Date.now()), 60000);
    return () => clearInterval(t);
  }, []);

  fijarCamara(camara.az, camara.el);

  const recargar = useCallback(
    () =>
      refrescarPuestos().then((res) => {
        if (res?.error) setAviso(MSG_SIN_TABLA);
        else if (res?.ok) setAviso('');
      }),
    []
  );

  useEffect(() => {
    refrescarPuestos().then((res) => {
      if (res?.error) setAviso(MSG_SIN_TABLA);
    });
    obtenerEmpleadosOficina().then(setEmpleados).catch(() => {});
    const quitarSync = escuchar(EVENTOS.SYNC_COMPLETADO, recargar);
    window.addEventListener('online', recargar);
    return () => {
      quitarSync();
      window.removeEventListener('online', recargar);
    };
  }, [recargar]);

  const estadoRealtime = useSupabaseRealtime('oficina_puestos', registrarCambioRemotoPuesto, {
    onReconectar: recargar,
  });

  const empleadosPorId = useMemo(() => {
    const m = {};
    empleados.forEach((e) => { m[String(e.id)] = e; });
    return m;
  }, [empleados]);

  // Sitios del plano + datos de BD (el tipo de cada sitio viene de la BD)
  const sitios = useMemo(() => {
    const porId = {};
    (puestosDb || []).forEach((p) => { porId[p.id] = p; });
    return TODOS_SITIOS.map((base) => {
      const db = porId[base.id] || {};
      const tipo = base.privado ? 'puesto' : TIPOS_SITIO[db.tipo] ? db.tipo : base.tipo;
      const empleado = tipo === 'puesto' && db.empleado_id
        ? empleadosPorId[String(db.empleado_id)] || { id: db.empleado_id, nombre: 'Colaborador' }
        : null;
      return {
        ...base,
        tipo,
        empleado,
        estado: empleado ? estadoEfectivo(db.estado, db.actualizado_en, ahora) : null,
        nota: db.nota || '',
        actualizado_en: db.actualizado_en,
        actualizado_por: db.actualizado_por,
        pendiente: db._sincronizado === false,
      };
    });
  }, [puestosDb, empleadosPorId, ahora]);

  const puestos = useMemo(() => sitios.filter((s) => s.tipo === 'puesto'), [sitios]);
  // Quienes están en almuerzo aparecen de pie en la cafetería
  const lugarAlmuerzo = useMemo(() => {
    const m = {};
    puestos.filter((p) => p.estado === 'almuerzo').forEach((p, i) => {
      m[p.id] = LUGARES_ALMUERZO[i % LUGARES_ALMUERZO.length];
    });
    return m;
  }, [puestos]);

  const conteo = useMemo(() => {
    const c = { libres: 0 };
    ORDEN_ESTADOS.forEach((k) => { c[k] = 0; });
    puestos.forEach((p) => { if (p.estado) c[p.estado]++; else c.libres++; });
    return c;
  }, [puestos]);

  const miPuesto = puestos.find((p) => p.empleado && String(p.empleado.id) === String(authUser?.id));
  const puestoSel = sitios.find((p) => p.id === seleccion) || null;

  // ---------- acciones ----------
  const guardar = async (id, cambios) => {
    setGuardando(true);
    try {
      await guardarPuesto(id, cambios, authUser?.id || null);
    } catch (err) {
      alert(`No se pudo guardar el puesto: ${err.message || err}`);
    } finally {
      setGuardando(false);
    }
  };

  // Giro animado (botones y "vista inicial")
  const animacion = useRef(0);
  const animarCamara = (destino, desde = camara) => {
    cancelAnimationFrame(animacion.current);
    const inicio = performance.now();
    const paso = (t) => {
      const k = Math.min(1, (t - inicio) / 420);
      const e = 1 - (1 - k) ** 3;
      const actual = {
        az: desde.az + (destino.az - desde.az) * e,
        el: desde.el + (destino.el - desde.el) * e,
      };
      setCamara(actual);
      if (k < 1) animacion.current = requestAnimationFrame(paso);
      else guardarCamara({ az: normalizarAz(destino.az), el: destino.el });
    };
    animacion.current = requestAnimationFrame(paso);
  };
  const girar = (sentido) => animarCamara({ az: diagonalCercana(camara.az) + sentido * 90, el: camara.el });
  const vistaInicial = () => animarCamara({
    az: CAM_INICIAL.az + 360 * Math.round((camara.az - CAM_INICIAL.az) / 360),
    el: CAM_INICIAL.el,
  });

  // ---------- zoom y arrastre ----------
  const mapaRef = useRef(null);
  const arrastre = useRef({ activo: false, movio: false });

  useEffect(() => {
    const el = mapaRef.current;
    if (!el) return;
    requestAnimationFrame(() => {
      el.scrollLeft = (el.scrollWidth - el.clientWidth) / 2;
    });
  }, []);

  const cambiarZoom = (nuevo) => {
    const el = mapaRef.current;
    const z = Math.min(3, Math.max(1, nuevo));
    if (!el) return setZoom(z);
    const cx = (el.scrollLeft + el.clientWidth / 2) / el.scrollWidth;
    const cy = (el.scrollTop + el.clientHeight / 2) / el.scrollHeight;
    setZoom(z);
    requestAnimationFrame(() => {
      el.scrollLeft = cx * el.scrollWidth - el.clientWidth / 2;
      el.scrollTop = cy * el.scrollHeight - el.clientHeight / 2;
    });
  };

  // Arrastrar = girar la oficina 360° (de arriba a abajo inclina). Shift + arrastrar = mover el plano.
  const onPointerDown = (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    cancelAnimationFrame(animacion.current);
    const el = mapaRef.current;
    arrastre.current = {
      activo: true,
      movio: false,
      mover: e.shiftKey,
      tactil: e.pointerType === 'touch',
      x: e.clientX,
      y: e.clientY,
      sl: el.scrollLeft,
      st: el.scrollTop,
      az: camara.az,
      el: camara.el,
      ultimo: null,
    };
  };
  const onPointerMove = (e) => {
    const a = arrastre.current;
    if (!a.activo) return;
    const dx = e.clientX - a.x;
    const dy = e.clientY - a.y;
    if (!a.movio && Math.abs(dx) + Math.abs(dy) > 6) {
      a.movio = true;
      try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* sin captura */ }
    }
    if (!a.movio) return;
    if (a.mover) {
      mapaRef.current.scrollLeft = a.sl - dx;
      mapaRef.current.scrollTop = a.st - dy;
      return;
    }
    a.ultimo = {
      az: a.az - dx * 0.45,
      el: a.tactil ? a.el : Math.min(EL_MAX, Math.max(EL_MIN, a.el + dy * 0.3)),
    };
    setCamara(a.ultimo);
  };
  const onPointerUp = () => {
    const a = arrastre.current;
    if (a.activo && a.ultimo) animarCamara({ az: diagonalCercana(a.ultimo.az), el: a.ultimo.el }, a.ultimo);
    a.activo = false;
  };

  const elegir = (id) => {
    if (arrastre.current.movio) return;
    setSeleccion((s) => (s === id ? null : id));
  };

  // ---------- escena (objetos ordenados por profundidad) ----------
  const escena = useMemo(() => {
    fijarCamara(camara.az, camara.el);
    const items = [];
    const add = (x, y, el, extra = 0) => items.push({ k: profundidad(x, y) + extra, el });
    const atenuado = (p) => filtro && (filtro === 'libres' ? !!p.estado : p.estado !== filtro);

    // Líneas: vidrio central por tramo y una columna metálica
    LINEAS.forEach((l) => {
      for (let i = 0; i < 4; i++) {
        const xa = X0_LINEAS + SEGX * i;
        add(xa + SEGX / 2, l.cy, (
          <Caja key={`vid-${l.fila}-${i}`} x={xa} y={l.cy - 0.04} z={0.72} w={SEGX} d={0.08} h={0.55} color="#cfe6ee" opacity={0.55} borde="rgba(255,255,255,.7)" />
        ));
      }
      const xCol = X0_LINEAS + SEGX * 2 - 0.1;
      add(xCol + 0.1, l.cy, (
        <Caja key={`col-${l.fila}`} x={xCol} y={l.cy - 0.1} z={0} w={0.2} d={0.2} h={ALTO_MURO - 0.2} color="#c9ced4" />
      ), 0.05);
    });

    // Sitios que no son puesto: impresora, botiquín o vacío
    sitios.filter((s) => s.tipo !== 'puesto').forEach((s) => {
      const g = geo(s);
      const cxo = s.cx - 0.45;
      add(s.cx, g.y0 + PROF_ESC / 2, (
        <g
          key={`sitio-${s.id}`}
          className={esAdmin ? 'ofi-clic' : undefined}
          opacity={filtro ? 0.45 : 1}
          onClick={esAdmin ? () => elegir(s.id) : undefined}
        >
          <title>{`${s.id} · ${TIPOS_SITIO[s.tipo]}`}</title>
          <EscritorioBase x0={g.x0} y0={g.y0} />
          {s.tipo === 'impresora' && (
            <>
              <Caja x={cxo - 0.5} y={g.y0 + 0.1} z={0.72} w={0.85} d={0.75} h={0.55} color="#e5e7eb" />
              <Caja x={cxo - 0.45} y={g.y0 + 0.15} z={1.27} w={0.75} d={0.6} h={0.06} color="#9ca3af" />
              <Caja x={cxo + 0.6} y={g.y0 + 0.2} z={0.72} w={0.7} d={0.55} h={0.28} color="#2b2f36" />
            </>
          )}
          {s.tipo === 'botiquin' && (
            <>
              <Caja x={cxo} y={g.y0 + 0.12} z={0.72} w={0.85} d={0.7} h={0.36} color="#dc2626" />
              <Caja x={cxo + 0.35} y={g.y0 + 0.12} z={1.08} w={0.12} d={0.7} h={0.01} color="#f8fafc" />
            </>
          )}
        </g>
      ));
    });

    // Puestos: escritorio, monitor, silla y persona
    puestos.forEach((p) => {
      const g = geo(p);
      const handlers = {
        onClick: () => elegir(p.id),
        onMouseEnter: () => setHover(p.id),
        onMouseLeave: () => setHover(null),
        className: 'ofi-clic',
        opacity: atenuado(p) ? 0.35 : 1,
      };
      add(p.cx, g.y0 + PROF_ESC / 2, (
        <g key={`esc-${p.id}`} {...handlers}>
          <EscritorioBase x0={g.x0} y0={g.y0} />
          <Caja x={p.cx - 0.3} y={g.tecladoY} z={0.72} w={0.6} d={0.22} h={0.02} color="#374151" />
        </g>
      ));
      add(p.cx, g.monY, (
        <g key={`mon-${p.id}`} {...handlers}>
          <Monitor cx={p.cx} y={g.monY} fy={g.fy} encendido={p.estado === 'en_oficina'} />
        </g>
      ), 0.02);
      add(p.cx, g.sillaY, (
        <g key={`silla-${p.id}`} {...handlers}>
          <SillaConPersona x={p.cx} y={g.sillaY} fy={g.fy} persona={p.estado === 'en_oficina' ? p.empleado?.id || p.id : null} />
        </g>
      ));
    });

    // Tabique gris de oficina (parte alta translúcida para ver adentro)
    const tabique = (key, x, y, w, d) => add(x + w / 2, y + d / 2, (
      <g key={key}>
        <Caja x={x} y={y} z={0} w={w} d={d} h={1.0} color="#8e959c" />
        <Caja x={x} y={y} z={1.0} w={w} d={d} h={0.8} color="#9aa1a8" opacity={0.42} borde="rgba(255,255,255,.5)" />
        <Caja x={x} y={y} z={1.8} w={w} d={d} h={0.06} color="#c3c8cd" />
      </g>
    ));
    const tramo = (pref, desde, hasta, paso, hueco, fn) => {
      for (let a = desde; a < hasta - 0.001; a += paso) {
        const b = Math.min(hasta, a + paso);
        if (hueco && a + 0.001 >= hueco[0] && b - 0.001 <= hueco[1]) continue;
        fn(`${pref}-${a.toFixed(2)}`, a, b - a);
      }
    };
    // Oficina 1 (esquina derecha del dibujo): pared norte con puerta y pared oeste
    tramo('o1n', OF1.x1, OF1.x2, 0.35, OF1.puerta, (k, a, l) => tabique(k, a, OF1.y1, l, 0.1));
    tramo('o1o', OF1.y1, OF1.y2, 0.5, null, (k, a, l) => tabique(k, OF1.x1, a, 0.1, l));
    add(OF1.puerta[0], OF1.y1 - 0.4, (
      <Caja key="puerta-o1" x={OF1.puerta[0]} y={OF1.y1 - 0.85} z={0} w={0.06} d={0.85} h={1.9} color="#9a6b43" />
    ));
    // Oficina 2 (esquina izquierda del dibujo): pared norte con puerta y pared este
    tramo('o2n', OF2.x1, OF2.x2, 0.35, OF2.puerta, (k, a, l) => tabique(k, a, OF2.y1, l, 0.1));
    tramo('o2e', OF2.y1, OF2.y2, 0.5, null, (k, a, l) => tabique(k, OF2.x2 - 0.1, a, 0.1, l));
    add(OF2.puerta[1], OF2.y1 - 0.4, (
      <Caja key="puerta-o2" x={OF2.puerta[1] - 0.06} y={OF2.y1 - 0.85} z={0} w={0.06} d={0.85} h={1.9} color="#9a6b43" />
    ));

    // Cafeta e insumos
    add((CAFETA.x1 + CAFETA.x2) / 2, (CAFETA.y1 + CAFETA.y2) / 2, (
      <g key="cafeta">
        <Caja x={CAFETA.x1} y={CAFETA.y1} z={0} w={CAFETA.x2 - CAFETA.x1} d={CAFETA.y2 - CAFETA.y1} h={0.95} color="#5b3a26" />
        <Caja x={CAFETA.x1 + 0.1} y={CAFETA.y2 - 0.75} z={0.95} w={0.55} d={0.5} h={0.62} color="#1f2937" />
        <Caja x={CAFETA.x1 + 0.1} y={CAFETA.y1 + 0.3} z={0.95} w={0.4} d={0.35} h={0.1} color="#facc15" />
      </g>
    ));
    add((INSUMO_CAFE.x1 + INSUMO_CAFE.x2) / 2, (INSUMO_CAFE.y1 + INSUMO_CAFE.y2) / 2, (
      <g key="insumo">
        <title>Insumos de cafeta</title>
        <Caja x={INSUMO_CAFE.x1} y={INSUMO_CAFE.y1} z={0} w={INSUMO_CAFE.x2 - INSUMO_CAFE.x1} d={INSUMO_CAFE.y2 - INSUMO_CAFE.y1} h={1.1} color="#e5e7eb" />
        <Caja x={INSUMO_CAFE.x1 + 0.2} y={INSUMO_CAFE.y1 + 0.2} z={1.1} w={0.7} d={0.5} h={0.08} color="#facc15" />
      </g>
    ));
    add(EXTINTOR[0], EXTINTOR[1], (
      <g key="extintor">
        <Caja x={EXTINTOR[0] - 0.2} y={EXTINTOR[1] - 0.2} z={0} w={0.4} d={0.4} h={0.12} color="#dc2626" />
        <Caja x={EXTINTOR[0] - 0.1} y={EXTINTOR[1] - 0.1} z={0.12} w={0.2} d={0.2} h={0.6} color="#dc2626" />
      </g>
    ));

    // Módulo (arriba a la izquierda) y módulos blancos junto a la pared este
    add((MODULO.x1 + MODULO.x2) / 2, (MODULO.y1 + MODULO.y2) / 2, (
      <Caja key="modulo" x={MODULO.x1} y={MODULO.y1} z={0} w={MODULO.x2 - MODULO.x1} d={MODULO.y2 - MODULO.y1} h={2.1} color="#f3f3f0" />
    ));
    const altoMod = (MODULOS.y2 - MODULOS.y1) / MODULOS.n;
    for (let i = 0; i < MODULOS.n; i++) {
      const y = MODULOS.y1 + altoMod * i;
      add((MODULOS.x1 + MODULOS.x2) / 2, y + altoMod / 2, (
        <Caja key={`mod-${i}`} x={MODULOS.x1} y={y + 0.02} z={0} w={MODULOS.x2 - MODULOS.x1} d={altoMod - 0.04} h={2.3} color="#f3f3f0" />
      ));
    }

    // Pizarra "Zona de cascos" (junto a la pared norte, mirando a la sala)
    add((PANEL_CASCOS.x1 + PANEL_CASCOS.x2) / 2, PANEL_CASCOS.y + 0.06, (
      <PanelPie key="panel-cascos" x={PANEL_CASCOS.x1} y={PANEL_CASCOS.y} w={PANEL_CASCOS.x2 - PANEL_CASCOS.x1} d={0.12} normal={[0, 1]} z1={0.8} z2={2.5} color="#1e2a44">
        {({ plano, a1, a2, z2 }) => (
          <>
            <TextoPlano plano={plano} a={(a1 + a2) / 2} z={z2 - 0.18} className="ofi-txt-muro" fill="#f8fafc">ZONA DE CASCOS</TextoPlano>
            {[0, 1, 2].flatMap((fila) => Array.from({ length: 9 }, (_, i) => {
              const [cx, cy] = P(...plano(a1 + 0.55 + i * ((a2 - a1 - 1.1) / 8), 2.05 - fila * 0.45));
              return <ellipse key={`${fila}-${i}`} cx={cx} cy={cy} rx="5.5" ry="5" fill={(fila * 9 + i) % 5 === 1 ? '#cbd5e1' : '#ffffff'} />;
            }))}
          </>
        )}
      </PanelPie>
    ));

    // Pizarra Glass Wall 5S (junto a la pared del fondo, mirando a la sala)
    add((GLASS_WALL.x1 + GLASS_WALL.x2) / 2, FONDO - 0.2, (
      <PanelPie key="glass-wall" x={GLASS_WALL.x1} y={FONDO - 0.24} w={GLASS_WALL.x2 - GLASS_WALL.x1} d={0.12} normal={[0, -1]} z1={0.75} z2={2.5} color="#e5e7eb">
        {({ plano, a1, a2, z1, z2 }) => (
          <>
            <RectPlano plano={plano} a1={a1 + 0.08} a2={a2 - 0.08} z1={z1 + 0.08} z2={z2 - 0.08} fill="#fbfbf8" />
            <RectPlano plano={plano} a1={a1 + 0.08} a2={a2 - 0.08} z1={z2 - 0.32} z2={z2 - 0.08} fill="#0f766e" />
            <TextoPlano plano={plano} a={(a1 + a2) / 2} z={z2 - 0.15} className="ofi-txt-muro" fill="#f8fafc">GLASS WALL 5S · OFICINA LOGÍSTICA</TextoPlano>
            {Array.from({ length: 8 }, (_, i) => {
              const paso = (a2 - a1 - 0.6) / 8;
              const b1 = a1 + 0.3 + i * paso;
              return (
                <g key={i}>
                  <RectPlano plano={plano} a1={b1} a2={b1 + paso - 0.12} z1={z1 + 0.2} z2={z2 - 0.45} fill="#ffffff" stroke="#cbd5e1" />
                  <RectPlano plano={plano} a1={b1} a2={b1 + paso - 0.12} z1={z2 - 0.6} z2={z2 - 0.45} fill={['#facc15', '#ef4444', '#22c55e', '#f97316', '#3b82f6', '#a855f7', '#14b8a6', '#e11d48'][i]} />
                </g>
              );
            })}
          </>
        )}
      </PanelPie>
    ));

    // Comunicación Interna (junto a la pared oeste, mirando a la sala)
    add(COM_INTERNA.x + 0.06, (COM_INTERNA.y1 + COM_INTERNA.y2) / 2, (
      <PanelPie key="com-interna" x={COM_INTERNA.x} y={COM_INTERNA.y1} w={0.12} d={COM_INTERNA.y2 - COM_INTERNA.y1} normal={[1, 0]} z1={0.8} z2={2.6} color="#3f444b">
        {({ plano, a1, a2, z1, z2 }) => (
          <>
            <RectPlano plano={plano} a1={a1 + 0.1} a2={a2 - 0.1} z1={z1 + 0.1} z2={z2 - 0.35} fill="#f8fafc" />
            <TextoPlano plano={plano} a={(a1 + a2) / 2} z={z2 - 0.2} className="ofi-txt-muro ofi-txt-chico" fill="#f8fafc">COMUNICACIÓN INTERNA</TextoPlano>
            {[0, 1, 2].flatMap((i) => [0, 1].map((j) => {
              const paso = (a2 - a1 - 0.4) / 3;
              return (
                <RectPlano key={`${i}-${j}`} plano={plano} a1={a1 + 0.2 + i * paso} a2={a1 + 0.1 + (i + 1) * paso} z1={z1 + 0.25 + j * 0.6} z2={z1 + 0.7 + j * 0.6} fill={j ? '#cbd5e1' : '#1e3a5f'} />
              );
            }))}
          </>
        )}
      </PanelPie>
    ));

    // Perchero de cascos (al costado de la Oficina 1)
    const [hx] = P(PERCHERO[0], PERCHERO[1], 0);
    const cascos = [[-9, 1.95, '#fafafa'], [9, 1.85, '#fafafa'], [-10, 1.55, '#f97316'], [10, 1.45, '#fafafa'], [-9, 1.15, '#fafafa'], [9, 1.05, '#fafafa']];
    add(PERCHERO[0], PERCHERO[1], (
      <g key="perchero">
        <Caja x={PERCHERO[0] - 0.2} y={PERCHERO[1] - 0.2} z={0} w={0.4} d={0.4} h={0.04} color="#8b5a2b" />
        <Caja x={PERCHERO[0] - 0.04} y={PERCHERO[1] - 0.04} z={0} w={0.08} d={0.08} h={2.1} color="#8b5a2b" />
        {cascos.map(([ox, z, col], i) => {
          const cy = P(PERCHERO[0], PERCHERO[1], z)[1];
          return (
            <g key={i}>
              <ellipse cx={hx + ox} cy={cy + 3} rx="9" ry="2.6" fill={sombra(col, 0.85)} />
              <path d={`M${hx + ox - 7.5} ${cy + 3} a7.5 7 0 0 1 15 0z`} fill={col} stroke="rgba(0,0,0,.12)" />
            </g>
          );
        })}
      </g>
    ));

    // Cafetería: mesa alta y quienes están en almuerzo
    add(MESA_CAFE[0], MESA_CAFE[1], (
      <g key="mesa-cafe">
        <Caja x={MESA_CAFE[0] - 0.06} y={MESA_CAFE[1] - 0.06} z={0} w={0.12} d={0.12} h={1.05} color="#6b7280" />
        <Caja x={MESA_CAFE[0] - 0.4} y={MESA_CAFE[1] - 0.4} z={1.05} w={0.8} d={0.8} h={0.05} color="#f5f5f4" />
        <Caja x={MESA_CAFE[0] - 0.1} y={MESA_CAFE[1] - 0.15} z={1.1} w={0.12} d={0.12} h={0.14} color="#fafafa" />
      </g>
    ));
    puestos.filter((p) => lugarAlmuerzo[p.id]).forEach((p) => {
      const [x, y] = lugarAlmuerzo[p.id];
      const fy = y < MESA_CAFE[1] - 0.1 ? 1 : y > MESA_CAFE[1] + 0.1 ? -1 : (haciaCamara(0, 1) ? 1 : -1);
      add(x, y, (
        <g key={`alm-${p.id}`} className="ofi-clic" opacity={atenuado(p) ? 0.35 : 1} onClick={() => elegir(p.id)}>
          <title>{`${nombreCorto(p.empleado?.nombre)} — Almuerzo`}</title>
          <Persona x={x} y={y} semilla={p.empleado?.id || p.id} fy={fy} dePie />
        </g>
      ), 0.03);
    });

    // Plantas
    [[2.4, 0.7], [10.4, 0.7], [0.75, 14.2]].forEach(([x, y], i) => {
      const [px, py] = P(x, y, 0.55);
      add(x, y, (
        <g key={`planta-${i}`}>
          <Caja x={x - 0.3} y={y - 0.3} z={0} w={0.6} d={0.6} h={0.55} color="#c2a27c" />
          <circle cx={px} cy={py - 14} r="15" fill="#4d7c4a" />
          <circle cx={px - 8} cy={py - 22} r="10" fill="#5f9658" />
          <circle cx={px + 8} cy={py - 24} r="9" fill="#6aa462" />
        </g>
      ));
    });

    items.sort((a, b) => a.k - b.k);
    return items.map((i) => i.el);
  }, [sitios, puestos, filtro, esAdmin, camara, lugarAlmuerzo]);

  // Etiquetas (capa superior)
  const etiquetas = useMemo(() => {
    fijarCamara(camara.az, camara.el);
    return puestos
      .map((p) => {
        const lugar = lugarAlmuerzo[p.id];
        // En la cafetería las etiquetas se apilan para no taparse
        const pila = lugar ? Object.keys(lugarAlmuerzo).indexOf(p.id) : 0;
        const [x, y] = lugar ? P(MESA_CAFE[0], MESA_CAFE[1], 2.0) : P(p.cx, geo(p).sillaY, 1.75);
        if (lugar) return { p, x, y: y - pila * 24 };
        return { p, x, y };
      })
      .sort((a, b) => a.y - b.y);
  }, [puestos, camara, lugarAlmuerzo]);

  const [vent1, vent2] = ambienteVentana();
  // Encuadre: círculo que contiene la sala, así no cambia de tamaño al girar
  const radio = Math.hypot(ANCHO, FONDO) / 2 + 0.4;
  const vbW = radio * 2 * S + 40;
  const vbH = (radio * 2 * SE + ALTO_MURO * CE) * S + 70;
  const vbX = -vbW / 2;
  const vbY = (-radio * SE - ALTO_MURO * CE) * S - 50;
  const murosVisibles = Object.keys(NORMAL_MURO).filter((m) => haciaCamara(...NORMAL_MURO[m]));

  const listaEquipo = puestos
    .filter((p) => p.empleado)
    .sort((a, b) => ORDEN_ESTADOS.indexOf(a.estado) - ORDEN_ESTADOS.indexOf(b.estado) || nombreCorto(a.empleado.nombre).localeCompare(nombreCorto(b.empleado.nombre)));

  const zonasPiso = puestoSel && puestoSel.tipo !== 'puesto' ? [...puestos, puestoSel] : puestos;

  return (
    <div className="ofi-wrapper">
      <header className="ofi-header">
        <div className="ofi-titulo">
          <span className="ofi-icono"><FaBuilding /></span>
          <div>
            <h1>Oficina Logística</h1>
            <p>Quién está en su puesto, en campo o en reunión — en vivo.</p>
          </div>
          <IndicadorEnVivo estado={estadoRealtime} style={{ marginLeft: 'auto' }} />
        </div>

        <div className="ofi-chips">
          {ORDEN_ESTADOS.map((k) => (
            <button
              key={k}
              type="button"
              className={`ofi-chip ${filtro === k ? 'activo' : ''}`}
              onClick={() => setFiltro((f) => (f === k ? null : k))}
            >
              <span className="ofi-punto" style={{ background: ESTADOS[k].color }} />
              {ESTADOS[k].label}
              <strong>{conteo[k]}</strong>
            </button>
          ))}
          <button
            type="button"
            className={`ofi-chip ${filtro === 'libres' ? 'activo' : ''}`}
            onClick={() => setFiltro((f) => (f === 'libres' ? null : 'libres'))}
          >
            <span className="ofi-punto libre" />
            Libres
            <strong>{conteo.libres}</strong>
          </button>
        </div>

        {miPuesto && (
          <div className="ofi-mi-puesto">
            <span><FaChair /> Tu puesto <strong>{miPuesto.id}</strong>:</span>
            <div className="ofi-estados-rapidos">
              {ORDEN_ESTADOS.map((k) => (
                <button
                  key={k}
                  type="button"
                  disabled={guardando}
                  className={miPuesto.estado === k ? 'activo' : ''}
                  style={{ '--c': ESTADOS[k].color }}
                  onClick={() => guardar(miPuesto.id, { estado: k })}
                >
                  {ESTADOS[k].label}
                </button>
              ))}
            </div>
          </div>
        )}

        {aviso && <div className="ofi-aviso">{aviso}</div>}
      </header>

      <div className="ofi-cuerpo">
        <section className="ofi-mapa-marco">
          <div className="ofi-vista">
            <button type="button" onClick={() => girar(-1)} title="Girar a la izquierda" aria-label="Girar a la izquierda"><FaUndoAlt /></button>
            <span>{nombreVista(camara.az)}</span>
            <button type="button" onClick={() => girar(1)} title="Girar a la derecha" aria-label="Girar a la derecha"><FaRedoAlt /></button>
            <div className="ofi-modo">
              <button type="button" onClick={vistaInicial} title="Volver a la vista inicial">Inicio</button>
            </div>
            <small className="ofi-vista-ayuda"><FaHandPaper /> Arrastra para girar 360°</small>
          </div>

          <div className="ofi-zoom">
            <button type="button" onClick={() => cambiarZoom(zoom + 0.3)} title="Acercar"><FaSearchPlus /></button>
            <button type="button" onClick={() => cambiarZoom(zoom - 0.3)} title="Alejar"><FaSearchMinus /></button>
            <button type="button" onClick={() => cambiarZoom(1)} title="Ver todo"><FaExpand /></button>
          </div>

          <div
            ref={mapaRef}
            className="ofi-mapa"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
          >
            <svg
              className="ofi-svg"
              viewBox={`${vbX} ${vbY} ${vbW} ${vbH}`}
              style={{ width: `calc(${zoom} * min(100%, var(--ofi-fit-h) * ${(vbW / vbH).toFixed(3)}))` }}
              role="img"
              aria-label="Plano 3D de la oficina logística"
            >
              <defs>
                <linearGradient id="ofi-cielo" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0" stopColor={vent1} />
                  <stop offset="1" stopColor={vent2} />
                </linearGradient>
                <linearGradient id="ofi-brillo" x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0" stopColor="#fff" stopOpacity="0" />
                  <stop offset=".5" stopColor="#fff" stopOpacity=".3" />
                  <stop offset="1" stopColor="#fff" stopOpacity="0" />
                </linearGradient>
              </defs>

              {/* Paredes de atrás en esta vista (las cercanas se ocultan para ver adentro) */}
              {murosVisibles.map((m) => (
                <g key={`muro-${m}`}>
                  <Caja {...CAJA_MURO[m]} z={0} h={ALTO_MURO} color="#ece6d8" />
                  <RectPlano plano={PLANO_MURO[m]} a1={0} a2={LARGO_MURO[m]} z1={0} z2={0.14} fill="#b08155" />
                  {DECOR_MUROS.filter((d) => d.pared === m).map((d, i) => (d.texto ? (
                    <TextoPlano key={i} plano={PLANO_MURO[m]} a={d.a} z={d.z} className={d.clase} fill={d.fill}>{d.texto}</TextoPlano>
                  ) : (
                    <RectPlano key={i} plano={PLANO_MURO[m]} a1={d.a1} a2={d.a2} z1={d.z1} z2={d.z2} fill={d.fill} stroke={d.stroke} />
                  )))}
                </g>
              ))}

              {/* Piso de concreto pulido */}
              <Caja x={0} y={0} z={-0.35} w={ANCHO} d={FONDO} h={0.35} color="#b9bdbc" />
              {Array.from({ length: Math.floor(ANCHO / 2) }, (_, i) => (
                <polygon key={`gx-${i}`} points={pts([[(i + 1) * 2, 0, 0], [(i + 1) * 2, FONDO, 0]])} stroke="rgba(255,255,255,.2)" />
              ))}
              {Array.from({ length: Math.floor(FONDO / 2) }, (_, i) => (
                <polygon key={`gy-${i}`} points={pts([[0, (i + 1) * 2, 0], [ANCHO, (i + 1) * 2, 0]])} stroke="rgba(255,255,255,.2)" />
              ))}
              <PisoRect x1={1.5} y1={10.5} x2={4.5} y2={14} fill="url(#ofi-brillo)" />
              <PisoRect x1={9.5} y1={1.5} x2={12.5} y2={4} fill="url(#ofi-brillo)" />

              {/* Piso de las oficinas cerradas */}
              <PisoRect x1={OF1.x1} y1={OF1.y1} x2={OF1.x2} y2={OF1.y2} fill="#d8d1c3" />
              <PisoRect x1={OF2.x1} y1={OF2.y1} x2={OF2.x2} y2={OF2.y2} fill="#d8d1c3" />
              <TextoPiso x={(OF1.x1 + OF1.x2) / 2} y={OF1.y1 + 0.7} className="ofi-txt-piso ofi-txt-piso-chico">OFICINA 1</TextoPiso>
              <TextoPiso x={(OF2.x1 + OF2.x2) / 2} y={OF2.y1 + 0.5} className="ofi-txt-piso ofi-txt-piso-chico">OFICINA 2</TextoPiso>

              {/* Cintas amarillas en el piso: cascos y cafeta */}
              <PisoRect x1={PERCHERO[0] - 0.55} y1={PERCHERO[1] - 0.55} x2={PERCHERO[0] + 0.55} y2={PERCHERO[1] + 0.55} fill="none" stroke="#facc15" strokeWidth="3" strokeDasharray="6 4" />
              <PisoRect x1={CAFETA.x1 - 0.12} y1={INSUMO_CAFE.y1 - 0.12} x2={CAFETA.x2} y2={FONDO - 0.02} fill="none" stroke="#facc15" strokeWidth="3" />

              {/* Zona de color de cada puesto (estado) */}
              {zonasPiso.map((p) => {
                const z = geo(p).zona;
                const sel = seleccion === p.id;
                return (
                  <PisoRect
                    key={`zona-${p.id}`}
                    x1={z.x1} y1={z.y1} x2={z.x2} y2={z.y2}
                    className={`ofi-clic ${sel ? 'ofi-zona-sel' : ''}`}
                    fill={p.estado ? ESTADOS[p.estado].color : 'rgba(255,255,255,.35)'}
                    fillOpacity={p.estado ? 0.38 : 1}
                    stroke={sel ? '#0f4c81' : p.estado ? 'none' : '#94a3b8'}
                    strokeWidth={sel ? 2.5 : 1.2}
                    strokeDasharray={p.estado || sel ? undefined : '5 4'}
                    opacity={filtro && (filtro === 'libres' ? !!p.estado : p.estado !== filtro) ? 0.3 : 1}
                    onClick={() => elegir(p.id)}
                  />
                );
              })}

              {escena}

              {/* Etiquetas */}
              {etiquetas.map(({ p, x, y }) => {
                const sel = seleccion === p.id;
                const hov = hover === p.id;
                const op = filtro && (filtro === 'libres' ? !!p.estado : p.estado !== filtro) ? 0.3 : 1;
                if (!p.empleado && !hov && !sel && filtro !== 'libres') {
                  return (
                    <g key={`et-${p.id}`} className="ofi-clic" opacity={op} onClick={() => elegir(p.id)}>
                      <text x={x} y={y - 4} textAnchor="middle" className="ofi-et-libre">{p.id}</text>
                    </g>
                  );
                }
                const texto = p.empleado
                  ? hov || sel
                    ? `${primerNombre(p.empleado.nombre)} · ${p.nota || ESTADOS[p.estado].label}`
                    : primerNombre(p.empleado.nombre)
                  : `${p.id} · Libre`;
                const ancho = Math.min(220, 24 + texto.length * 6.1);
                const color = p.estado ? ESTADOS[p.estado].color : '#94a3b8';
                return (
                  <g
                    key={`et-${p.id}`}
                    transform={`translate(${x},${y})`}
                    className={`ofi-clic ofi-etiqueta ${sel ? 'sel' : ''}`}
                    opacity={op}
                    onClick={() => elegir(p.id)}
                    onMouseEnter={() => setHover(p.id)}
                    onMouseLeave={() => setHover(null)}
                  >
                    <title>{p.empleado ? `${nombreCorto(p.empleado.nombre)} — ${ESTADOS[p.estado].label}` : `Puesto ${p.id} libre`}</title>
                    <path d="M-5 -2 L0 4 L5 -2z" className="ofi-et-fondo" />
                    <rect x={-ancho / 2} y={-22} width={ancho} height={20} rx={10} className="ofi-et-fondo" />
                    <circle cx={-ancho / 2 + 11} cy={-12} r={4} fill={color} />
                    {p.pendiente && <circle cx={ancho / 2 - 4} cy={-20} r={3.5} fill="#f97316" />}
                    <text x={-ancho / 2 + 19} y={-8} className="ofi-et-texto">{texto}</text>
                  </g>
                );
              })}
            </svg>
          </div>
        </section>

        {puestoSel && (
          <PanelPuesto
            key={`${puestoSel.id}|${puestoSel.nota}|${puestoSel.empleado?.id || ''}`}
            puesto={puestoSel}
            empleados={empleados}
            puestos={puestos}
            onCambiarTipo={(tipo) => guardar(puestoSel.id, { tipo, empleado_id: null, estado: 'en_oficina', nota: null })}
            authUser={authUser}
            esAdmin={esAdmin}
            guardando={guardando}
            onGuardar={guardar}
            onCerrar={() => setSeleccion(null)}
          />
        )}
      </div>

      <section className="ofi-equipo">
        <h2>Equipo ({listaEquipo.length})</h2>
        {listaEquipo.length === 0 ? (
          <p className="ofi-vacio">Aún no hay personas asignadas. Toca un puesto del plano para asignarlo.</p>
        ) : (
          <div className="ofi-equipo-grid">
            {listaEquipo.map((p) => (
              <button
                key={p.id}
                type="button"
                title={[p.empleado.cargo, p.empleado.area].filter(Boolean).join(' · ')}
                className={`ofi-persona-card ${seleccion === p.id ? 'sel' : ''}`}
                onClick={() => setSeleccion(p.id)}
              >
                <Avatar empleado={p.empleado} color={ESTADOS[p.estado].color} />
                <span className="ofi-pc-info">
                  <strong>{nombreCorto(p.empleado.nombre)}</strong>
                  <small>{p.nota || ESTADOS[p.estado].label}</small>
                </span>
                <span className="ofi-pc-puesto">{p.id}</span>
              </button>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function Avatar({ empleado, color, grande }) {
  const [error, setError] = useState(false);
  return (
    <span className={`ofi-avatar ${grande ? 'grande' : ''}`} style={{ '--c': color }}>
      {empleado?.foto_url && !error ? (
        <img src={empleado.foto_url} alt="" onError={() => setError(true)} />
      ) : (
        iniciales(empleado?.nombre) || '?'
      )}
    </span>
  );
}

// =========================================================================
// PANEL LATERAL DEL PUESTO
// =========================================================================
function PanelPuesto({ puesto, empleados, puestos, authUser, esAdmin, guardando, onGuardar, onCambiarTipo, onCerrar }) {
  const [busqueda, setBusqueda] = useState('');
  const [nota, setNota] = useState(puesto.nota);

  const esMio = puesto.empleado && String(puesto.empleado.id) === String(authUser?.id);
  const puedeEditar = esAdmin || esMio;
  const yaTengoPuesto = puestos.some((p) => p.empleado && String(p.empleado.id) === String(authUser?.id));

  const ocupados = useMemo(() => {
    const m = {};
    puestos.forEach((p) => { if (p.empleado) m[String(p.empleado.id)] = p.id; });
    return m;
  }, [puestos]);

  const candidatos = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    if (q.length < 2) return [];
    return empleados
      .filter((e) => !e.fch_salida && !['INACTIVO', 'CESADO', 'BAJA'].includes(String(e.estado || '').toUpperCase()))
      .filter((e) => `${e.nombre} ${e.usuario || ''} ${e.dni || ''} ${e.cargo || ''} ${e.area || ''}`.toLowerCase().includes(q))
      .slice(0, 8);
  }, [busqueda, empleados]);

  const fecha = puesto.actualizado_en
    ? new Date(puesto.actualizado_en).toLocaleString('es-PE', { dateStyle: 'short', timeStyle: 'short' })
    : null;
  const quienActualizo = puesto.actualizado_por ? empleados.find((e) => String(e.id) === String(puesto.actualizado_por)) : null;

  return (
    <aside className="ofi-panel">
      <div className="ofi-panel-cab">
        <div>
          <small>
            {puesto.privado
              ? puesto.privado
              : `Línea ${puesto.fila} · lado ${puesto.lado === 'N' ? 'entrada' : 'fondo'}`}
          </small>
          <h3>{puesto.tipo === 'puesto' ? 'Puesto' : 'Sitio'} {puesto.id}</h3>
        </div>
        <button type="button" className="ofi-cerrar" onClick={onCerrar} aria-label="Cerrar"><FaTimes /></button>
      </div>

      {esAdmin && !puesto.privado && (
        <>
          <label className="ofi-label">Este sitio es</label>
          <div className="ofi-tipos">
            {Object.entries(TIPOS_SITIO).map(([k, label]) => (
              <button
                key={k}
                type="button"
                disabled={guardando}
                className={puesto.tipo === k ? 'activo' : ''}
                onClick={() => {
                  if (k === puesto.tipo) return;
                  if (puesto.empleado && !window.confirm(`${nombreCorto(puesto.empleado.nombre)} dejará este puesto. ¿Continuar?`)) return;
                  onCambiarTipo(k);
                }}
              >
                {label}
              </button>
            ))}
          </div>
        </>
      )}

      {puesto.tipo !== 'puesto' ? (
        <p className="ofi-libre-txt">
          Este sitio está marcado como <strong>{TIPOS_SITIO[puesto.tipo].toLowerCase()}</strong>, no tiene a nadie asignado.
        </p>
      ) : puesto.empleado ? (
        <>
          <div className="ofi-panel-persona">
            <Avatar empleado={puesto.empleado} color={ESTADOS[puesto.estado].color} grande />
            <div>
              <strong>{nombreCorto(puesto.empleado.nombre)}</strong>
              {(puesto.empleado.cargo || puesto.empleado.area) && (
                <small className="ofi-cargo">{[puesto.empleado.cargo, puesto.empleado.area].filter(Boolean).join(' · ')}</small>
              )}
              <span style={{ color: ESTADOS[puesto.estado].color }}>● {ESTADOS[puesto.estado].label}</span>
            </div>
          </div>

          {puesto.pendiente && (
            <p className="ofi-pendiente"><FaCloudUploadAlt /> Cambio guardado sin internet, se subirá al reconectar.</p>
          )}

          <label className="ofi-label">Estado</label>
          <div className="ofi-estados-grid">
            {ORDEN_ESTADOS.map((k) => (
              <button
                key={k}
                type="button"
                disabled={!puedeEditar || guardando}
                className={puesto.estado === k ? 'activo' : ''}
                style={{ '--c': ESTADOS[k].color }}
                onClick={() => onGuardar(puesto.id, { estado: k })}
              >
                {ESTADOS[k].label}
              </button>
            ))}
          </div>

          <label className="ofi-label" htmlFor="ofi-nota">Nota (opcional)</label>
          <div className="ofi-nota">
            <input
              id="ofi-nota"
              value={nota}
              maxLength={60}
              disabled={!puedeEditar}
              placeholder="Ej. Vuelvo 3:00 pm · Almacén 2"
              onChange={(e) => setNota(e.target.value)}
            />
            <button
              type="button"
              disabled={!puedeEditar || guardando || nota === puesto.nota}
              onClick={() => onGuardar(puesto.id, { nota: nota.trim() || null })}
            >
              Guardar
            </button>
          </div>

          {(esAdmin || esMio) && (
            <button
              type="button"
              className="ofi-btn-liberar"
              disabled={guardando}
              onClick={() => onGuardar(puesto.id, { empleado_id: null, estado: 'en_oficina', nota: null })}
            >
              <FaUserMinus /> {esMio ? 'Dejar este puesto' : 'Liberar puesto'}
            </button>
          )}
        </>
      ) : (
        <>
          <p className="ofi-libre-txt">Este puesto está libre.</p>
          {!esAdmin && !yaTengoPuesto && authUser?.id && (
            <button
              type="button"
              className="ofi-btn-primario"
              disabled={guardando}
              onClick={() => onGuardar(puesto.id, { empleado_id: authUser.id, estado: 'en_oficina', nota: null })}
            >
              <FaChair /> Sentarme aquí
            </button>
          )}
        </>
      )}

      {esAdmin && puesto.tipo === 'puesto' && (
        <div className="ofi-asignar">
          <label className="ofi-label" htmlFor="ofi-buscar"><FaUserPlus /> {puesto.empleado ? 'Reasignar a' : 'Asignar a'}</label>
          <input
            id="ofi-buscar"
            value={busqueda}
            placeholder="Buscar por nombre o usuario…"
            onChange={(e) => setBusqueda(e.target.value)}
          />
          {candidatos.length > 0 && (
            <ul className="ofi-candidatos">
              {candidatos.map((e) => (
                <li key={e.id}>
                  <button
                    type="button"
                    disabled={guardando}
                    onClick={() => {
                      onGuardar(puesto.id, { empleado_id: e.id, estado: 'en_oficina', nota: null });
                      setBusqueda('');
                    }}
                  >
                    <Avatar empleado={e} color="#cbd5e1" />
                    <span className="ofi-cand-info">
                      {nombreCorto(e.nombre)}
                      {e.cargo && <em>{e.cargo}</em>}
                    </span>
                    {ocupados[String(e.id)] && <small>ahora en {ocupados[String(e.id)]}</small>}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {fecha && (
        <p className="ofi-actualizado">
          Actualizado {fecha}{quienActualizo ? ` por ${nombreCorto(quienActualizo.nombre)}` : ''}
        </p>
      )}
    </aside>
  );
}
