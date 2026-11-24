// =========================================================================
// MODELO DEL ALMACÉN
// =========================================================================
// Código de ubicación:  RR-PPP-N
//   RR  = rack (2 dígitos)          ej. 07
//   PPP = profundidad (3 dígitos)   ej. 007  (módulo a lo largo del rack)
//   N   = nivel (altura)            ej. 3    (1 = piso)
//
// ALTURA FIJA: cada rack tiene una altura medida en "niveles base"
// (por defecto 6). Si una profundidad tiene otra cantidad de niveles
// (2, 3, 4, 5, 7…), esos niveles se reparten DENTRO de la misma altura,
// no se apilan encima. Ej. 4 niveles en un rack de 6 → alturas 1.5 c/u,
// o personalizadas de abajo hacia arriba "1,1,2,2".
//
// Prioridad de reglas para una profundidad:
//   1. posiciones["07-007"]   (cambio puntual: niveles, alturas, inactiva)
//   2. racksDetalle["07"]     (todo el rack: altura en niveles base, profundidades)
//   3. valores generales
// Luego los puentes quitan la parte de abajo en su rango de profundidades.
// =========================================================================

export const CONFIG_INICIAL = {
  version: 2,
  racks: 35,
  profundidades: 43,
  nivelesBase: 6,
  // Racks después de los cuales hay pasillo. El resto va espalda con espalda.
  // Antes del rack 01 y después del último siempre hay pasillo.
  pasillosDespuesDe: null, // null = se calcula con aisladosPorDefecto()
  // Cambios por rack: { "07": { profundidades: 43, niveles: 7 } }  (niveles = altura del rack)
  racksDetalle: {},
  // Cambios por profundidad: { "07-007": { niveles: 4, alturas: [1,1,2,2] }, "10-012": { inactiva: true } }
  posiciones: {},
  // Puentes: paso por debajo del rack, de la profundidad `desde` a `hasta`.
  // nivelesLibres = alto del paso medido en niveles base. racks vacío = todos.
  puentes: [{ desde: 20, hasta: 20, nivelesLibres: 2, racks: [] }],
  medidas: {
    anchoPosicion: 1.2,
    altoNivel: 1.5, // alto de un nivel base
    fondoRack: 1.1,
    pasillo: 3.2,
    espalda: 0.25,
  },
};

// Pasillo después de cada rack impar: 01 | 02·03 | 04·05 | …
export const pasillosImpares = (racks) => Array.from({ length: racks - 1 }, (_, i) => i + 1).filter((r) => r % 2 === 1);

// ---------------------------------------------------------------------------
// Códigos
// ---------------------------------------------------------------------------
export const pad = (n, largo) => String(n).padStart(largo, '0');
export const codRack = (r) => pad(r, 2);
export const codProf = (p) => pad(p, 3);
export const codigoUbicacion = (r, p, n) => `${codRack(r)}-${codProf(p)}-${n}`;
export const claveProf = (r, p) => `${codRack(r)}-${codProf(p)}`;

/** Acepta "07-007-3", "7-7-3", "07 007 3", "070073" y devuelve "07-007-3" (o null). */
export const normalizarUbicacion = (valor) => {
  const t = String(valor ?? '').trim().toUpperCase();
  if (!t) return null;
  let m = t.match(/^(\d{1,2})\D+(\d{1,3})\D+(\d{1,2})$/);
  if (!m) m = t.match(/^(\d{2})(\d{3})(\d{1,2})$/);
  if (!m) return null;
  return codigoUbicacion(+m[1], +m[2], +m[3]);
};

export const separarCodigo = (codigo) => {
  const [r, p, n] = codigo.split('-').map(Number);
  return { rack: r, prof: p, nivel: n };
};

/** "1,1,2,2" → [1,1,2,2]  (o null si no es válido) */
export const leerAlturas = (texto) => {
  const v = String(texto ?? '').split(/[,;\s]+/).filter(Boolean).map((x) => parseFloat(x.replace(',', '.')));
  return v.length && v.every((x) => Number.isFinite(x) && x > 0) ? v : null;
};

const redondear = (x) => Math.round(x * 1000) / 1000;

// ---------------------------------------------------------------------------
// Configuración
// ---------------------------------------------------------------------------
/** Completa una config guardada con los valores por defecto (y migra versiones viejas). */
export const completarConfig = (c) => {
  const base = { ...CONFIG_INICIAL, ...(c || {}) };
  let pasillos = base.pasillosDespuesDe;
  if (!Array.isArray(pasillos)) {
    // versión 1 usaba "disposicion"
    if (base.disposicion === 'B') pasillos = Array.from({ length: base.racks - 1 }, (_, i) => i + 1).filter((r) => r % 2 === 0);
    else if (base.disposicion === 'C') pasillos = Array.from({ length: base.racks - 1 }, (_, i) => i + 1);
    else pasillos = pasillosImpares(base.racks);
  }
  const puentes = (Array.isArray(c?.puentes) ? c.puentes : CONFIG_INICIAL.puentes).map((b) => {
    const desde = +(b.desde ?? b.profundidad ?? 1);
    return { desde, hasta: Math.max(desde, +(b.hasta ?? desde)), nivelesLibres: +(b.nivelesLibres ?? 0), racks: b.racks || [] };
  });
  const out = {
    ...base,
    version: 2,
    pasillosDespuesDe: pasillos,
    medidas: { ...CONFIG_INICIAL.medidas, ...(c?.medidas || {}) },
    racksDetalle: { ...(c?.racksDetalle || {}) },
    posiciones: { ...(c?.posiciones || {}) },
    puentes,
  };
  delete out.disposicion;
  return out;
};

export const profundidadesDeRack = (cfg, r) => cfg.racksDetalle[codRack(r)]?.profundidades ?? cfg.profundidades;

/** Altura del rack medida en niveles base. */
export const alturaRack = (cfg, r) => cfg.racksDetalle[codRack(r)]?.niveles ?? cfg.nivelesBase;

export const puenteEn = (cfg, r, p) =>
  cfg.puentes.find((b) => p >= b.desde && p <= b.hasta && (!b.racks?.length || b.racks.map(Number).includes(r))) || null;

export const esProfundidadDePuente = (cfg, p) => cfg.puentes.some((b) => p >= b.desde && p <= b.hasta);

/**
 * Datos de una profundidad:
 *   niveles   cantidad de niveles (ubicaciones) en la altura del rack
 *   alturas   alto de cada nivel en niveles base, de abajo hacia arriba
 *   bases     dónde empieza cada nivel (en niveles base)
 *   altura    altura total del rack (niveles base)
 *   desde     primer nivel que existe (los de abajo pueden ser puente)
 */
export const infoProfundidad = (cfg, r, p) => {
  const ov = cfg.posiciones[claveProf(r, p)] || {};
  const altura = alturaRack(cfg, r);
  const niveles = ov.niveles ?? altura;
  let alturas;
  const suma = (a) => a.reduce((s, x) => s + x, 0);
  if (Array.isArray(ov.alturas) && ov.alturas.length === niveles && Math.abs(suma(ov.alturas) - altura) < 0.01) alturas = ov.alturas;
  else alturas = Array.from({ length: niveles }, () => redondear(altura / niveles));
  const bases = [];
  alturas.reduce((acc, h) => (bases.push(acc), acc + h), 0);

  const puente = puenteEn(cfg, r, p);
  const libres = puente ? Math.min(+puente.nivelesLibres || 0, altura) : 0;
  let desde = 1;
  while (desde <= niveles && bases[desde - 1] < libres - 0.001) desde++;
  return {
    niveles,
    alturas,
    bases,
    altura,
    libres,
    desde,
    puente: !!puente,
    inactiva: !!ov.inactiva || p > profundidadesDeRack(cfg, r),
    cambiada: ov.niveles != null || !!ov.inactiva || !!ov.alturas,
    alturasPersonalizadas: alturas === ov.alturas,
  };
};

/** Lista de todas las ubicaciones válidas (el "catálogo"). */
export const generarCatalogo = (cfg) => {
  const lista = [];
  for (let r = 1; r <= cfg.racks; r++) {
    const profs = profundidadesDeRack(cfg, r);
    for (let p = 1; p <= profs; p++) {
      const info = infoProfundidad(cfg, r, p);
      if (info.inactiva) continue;
      for (let n = info.desde; n <= info.niveles; n++) lista.push({ codigo: codigoUbicacion(r, p, n), rack: r, prof: p, nivel: n });
    }
  }
  return lista;
};

/** Altura máxima de rack (niveles base) en todo el almacén. */
export const alturaMaxima = (cfg) => {
  let max = cfg.nivelesBase;
  Object.values(cfg.racksDetalle).forEach((d) => d.niveles && (max = Math.max(max, d.niveles)));
  return max;
};

export const maxProfundidades = (cfg) => {
  let max = cfg.profundidades;
  Object.values(cfg.racksDetalle).forEach((d) => d.profundidades && (max = Math.max(max, d.profundidades)));
  return max;
};

/** ¿Hay pasillo antes del rack r? (si no, va espalda con espalda con el anterior) */
export const pasilloAntesDe = (cfg, r) => r === 1 || cfg.pasillosDespuesDe.includes(r - 1);

/** Posición X (metros) de cada rack y pasillo. Los racks van uno al lado del otro; la profundidad corre en Z. */
export const distribucion = (cfg) => {
  const { fondoRack, pasillo, espalda } = cfg.medidas;
  const racks = [];
  const pasillos = [];
  let x = 0;
  for (let r = 1; r <= cfg.racks; r++) {
    if (pasilloAntesDe(cfg, r)) {
      pasillos.push({ x0: x, x1: x + pasillo, antesDe: r });
      x += pasillo;
    } else {
      x += espalda;
    }
    racks.push({ rack: r, x0: x, x1: x + fondoRack });
    x += fondoRack;
  }
  pasillos.push({ x0: x, x1: x + pasillo, antesDe: null });
  x += pasillo;
  return { racks, pasillos, ancho: x, largo: maxProfundidades(cfg) * cfg.medidas.anchoPosicion };
};

// ---------------------------------------------------------------------------
// Ocupación (Excel cargado por el usuario)
// ---------------------------------------------------------------------------
export const ocupacionProfundidad = (cfg, ocupacion, r, p) => {
  const info = infoProfundidad(cfg, r, p);
  let total = 0;
  let ocupadas = 0;
  if (!info.inactiva) {
    for (let n = info.desde; n <= info.niveles; n++) {
      total++;
      if (ocupacion[codigoUbicacion(r, p, n)]) ocupadas++;
    }
  }
  return { total, ocupadas };
};

export const colorOcupacion = (pct) => {
  if (pct == null) return '#cbd5e1';
  if (pct <= 0) return '#e2e8f0';
  if (pct < 0.5) return '#22c55e';
  if (pct < 0.8) return '#eab308';
  return '#ef4444';
};

const PALETA = ['#2563eb', '#16a34a', '#d97706', '#9333ea', '#db2777', '#0891b2', '#65a30d', '#dc2626', '#4f46e5', '#0d9488', '#ca8a04', '#7c3aed'];
export const colorCliente = (clientes, cliente) => {
  const i = clientes.indexOf(cliente);
  return i < 0 ? '#64748b' : PALETA[i % PALETA.length];
};
