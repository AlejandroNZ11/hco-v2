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

// Racks de peligrosos según el plano (de la pared del almacén hacia afuera):
// zona de ingreso | P1 | pasillo | P2·P3 | pasillo | P4·P5 | pasillo | P6
//   fila          = en qué fila (contando desde el frente) arranca su profundidad "desde".
//                   P1 arranca en la fila 7 (su 001 queda a la altura del 007 de P2).
//   pasilloAntes  = false → va espalda con espalda con el rack anterior.
const PELIGROSOS_INICIAL = {
  activo: true,
  lado: 'izquierda', // izquierda = pegado al rack 01, derecha = después del último rack
  separacion: 0, // metros entre el pasillo del almacén y el muro de peligrosos (0 = pared compartida)
  zonaIngreso: 6.5, // ancho libre entre la pared y P1 (pasillo de ingreso + antesala)
  antesala: 4.8, // zona de puertas: las puertas quedan a la mitad de este fondo (desde el frente)
  anchoPasilloIngreso: 3, // pasillo al aire libre de la puerta del almacén a la puerta de peligrosos
  adelante: 6, // metros que se corre todo peligrosos hacia el frente (lado del stage)
  racks: [
    { codigo: 'P1', desde: 1, hasta: 12, niveles: 5, fila: 7, pasilloAntes: false },
    { codigo: 'P2', desde: 1, hasta: 18, niveles: 5, fila: 1, pasilloAntes: true },
    { codigo: 'P3', desde: 1, hasta: 18, niveles: 5, fila: 1, pasilloAntes: false },
    { codigo: 'P4', desde: 1, hasta: 18, niveles: 5, fila: 1, pasilloAntes: true },
    { codigo: 'P5', desde: 1, hasta: 18, niveles: 5, fila: 1, pasilloAntes: false },
    { codigo: 'P6', desde: 1, hasta: 18, niveles: 5, fila: 1, pasilloAntes: true },
  ],
};

export const pad = (n, largo) => String(n).padStart(largo, '0');

// Racks largos (23 al 32): llegan a la profundidad 054 y tienen un segundo puente por la 044.
const RACKS_LARGOS = Array.from({ length: 10 }, (_, i) => 23 + i);

export const CONFIG_INICIAL = {
  version: 5,
  racks: 35,
  // Pasillo entre el stage y el frente de los racks (m). Sigue por las puertas hasta peligrosos.
  pasilloFrente: 1.5,
  profundidades: 44,
  nivelesBase: 6,
  // Pallets que entran en cada ubicación (1 o 2; en puentes puede ser 2, 3 o 4).
  palletsPorUbicacion: 1,
  // Racks después de los cuales hay pasillo. El resto va espalda con espalda (por defecto 01·02 | 03·04 … 35 solo).
  // Antes del rack 01 y después del último siempre hay pasillo.
  pasillosDespuesDe: null, // null = pasillosPares()
  // Cambios por rack: { "07": { profundidades: 35, niveles: 7, pallets: 2 } }  (niveles = altura del rack)
  racksDetalle: Object.fromEntries(RACKS_LARGOS.map((r) => [pad(r, 2), { profundidades: 54 }])),
  // Cambios por profundidad: { "07-007": { niveles: 4, alturas: [1,1,2,2], pallets: 2 }, "10-012": { inactiva: true } }
  posiciones: {},
  // Puentes: paso por debajo del rack, de la profundidad `desde` a `hasta`.
  // nivelesLibres = alto del paso medido en niveles base.
  // racks vacío = todos los racks del almacén principal; para peligrosos se nombran (["P2","P3"]).
  // nivelesArriba = cuántas ubicaciones hay sobre el paso (2, 3 o 4; null = las que salgan de la altura).
  // pallets = pallets por ubicación en el puente (null = los del rack).
  puentes: [
    { desde: 20, hasta: 20, nivelesLibres: 2, racks: [], nivelesArriba: null, pallets: null },
    { desde: 44, hasta: 44, nivelesLibres: 2, racks: RACKS_LARGOS, nivelesArriba: null, pallets: null },
    { desde: 3, hasta: 4, nivelesLibres: 2, racks: ['P2', 'P3', 'P4', 'P5'], nivelesArriba: null, pallets: null },
  ],
  // Columnas del edificio: ocupan `ocupa` posiciones del rack desde la posición física `desde`.
  // El rack no se alarga: pierde esas profundidades (la numeración sigue sin saltarse y termina antes)
  // y los puentes se quedan en su sitio. racks vacío = todos los del almacén principal.
  columnas: [],
  // Rótulo colgado en la punta de cada rack (número con flecha hacia su pasillo).
  rotulos: { activo: true, altura: 4.5, atras: true },
  // ¿Pasillo después del último rack? (el 35 va pegado al muro)
  pasilloAlFinal: false,
  // Apiladores (montacargas retráctiles): cuántos en cada pasillo. antesDe = rack que está después del pasillo.
  apiladores: [
    { antesDe: 3, cantidad: 1 },
    { antesDe: 23, cantidad: 2 },
  ],
  // Ubicaciones con enrejado (jaula), por rack y rango de profundidades.
  enrejados: [{ rack: 'P6', desde: 1, hasta: 12 }],
  medidas: {
    anchoPosicion: 1.2,
    altoNivel: 1.5, // alto de un nivel base
    fondoRack: 1.1,
    pasillo: 3.2,
    espalda: 0.25,
  },
  // Zona de stage al frente (lado de la profundidad 001) con rampas (andenes) en el borde.
  stage: { activo: true, fondo: 15, rampas: 6, anchoRampa: 3.5 },
  // Almacén de peligrosos al costado. Códigos como P2-007-1 (rack P2, profundidad 007, nivel 1).
  peligrosos: PELIGROSOS_INICIAL,
};

// Pasillo después de cada rack impar: 01 | 02·03 | 04·05 | …
export const pasillosImpares = (racks) => Array.from({ length: racks - 1 }, (_, i) => i + 1).filter((r) => r % 2 === 1);
// Pasillo después de cada rack par: 01·02 | 03·04 | … (el último impar queda solo, ej. 35)
export const pasillosPares = (racks) => Array.from({ length: racks - 1 }, (_, i) => i + 1).filter((r) => r % 2 === 0);

// ---------------------------------------------------------------------------
// Códigos
// ---------------------------------------------------------------------------
// Racks del almacén principal son números (1..35); los de peligrosos son textos ("P2").
export const esRackPeligrosos = (r) => typeof r === 'string';
export const codRack = (r) => (esRackPeligrosos(r) ? r : pad(r, 2));
export const leerRack = (t) => (/^\d+$/.test(String(t)) ? +t : String(t).toUpperCase());
export const codProf = (p) => pad(p, 3);
export const codigoUbicacion = (r, p, n) => `${codRack(r)}-${codProf(p)}-${n}`;
export const claveProf = (r, p) => `${codRack(r)}-${codProf(p)}`;

/** Acepta "07-007-3", "7-7-3", "070073", "P2-007-1", "P20071" y devuelve el código normalizado (o null). */
export const normalizarUbicacion = (valor) => {
  const t = String(valor ?? '').trim().toUpperCase();
  if (!t) return null;
  let m = t.match(/^(\d{1,2}|[A-Z][A-Z0-9]{0,3})[^A-Z0-9]+(\d{1,3})[^A-Z0-9]+(\d{1,2})$/);
  if (!m) m = t.match(/^(\d{2}|[A-Z]\d)(\d{3})(\d{1,2})$/);
  if (!m) return null;
  return codigoUbicacion(leerRack(m[1]), +m[2], +m[3]);
};

export const separarCodigo = (codigo) => {
  const [r, p, n] = codigo.split('-');
  return { rack: leerRack(r), prof: +p, nivel: +n };
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
    else pasillos = pasillosPares(base.racks);
  }
  // Antes de la versión 3 peligrosos era un ejemplo: se reemplaza por el del plano.
  const viejo = !c || (c.version ?? 1) < 3;
  const antesV4 = !!c && (c.version ?? 1) < 4;
  const antesV5 = !!c && (c.version ?? 1) < 5;
  let puentesGuardados = Array.isArray(c?.puentes) ? c.puentes : CONFIG_INICIAL.puentes;
  if (viejo && c) puentesGuardados = [...puentesGuardados, ...CONFIG_INICIAL.puentes.filter((b) => b.racks.some(esRackPeligrosos))];
  // v4: base 044; racks 23–32 hasta 054 con un segundo puente en la 044
  let racksDetalle = c ? { ...(c.racksDetalle || {}) } : structuredClone(CONFIG_INICIAL.racksDetalle);
  if (antesV4) {
    if (base.profundidades === 43) base.profundidades = 44;
    RACKS_LARGOS.forEach((r) => {
      const k = pad(r, 2);
      if (!racksDetalle[k]?.profundidades) racksDetalle[k] = { ...racksDetalle[k], profundidades: 54 };
    });
    if (!puentesGuardados.some((b) => +b.desde === 44)) puentesGuardados = [...puentesGuardados, CONFIG_INICIAL.puentes[1]];
    // la foto muestra 23·24 espalda con espalda: 01·02 | 03·04 … 35 solo
    if (JSON.stringify(pasillos) === JSON.stringify(pasillosImpares(base.racks))) pasillos = pasillosPares(base.racks);
  }
  const numOpc = (v, min, max) => (v == null || v === '' || !Number.isFinite(+v) ? null : Math.min(max, Math.max(min, Math.round(+v))));
  const puentes = puentesGuardados.map((b) => {
    const desde = +(b.desde ?? b.profundidad ?? 1);
    return {
      desde,
      hasta: Math.max(desde, +(b.hasta ?? desde)),
      nivelesLibres: +(b.nivelesLibres ?? 0),
      racks: (b.racks || []).map(leerRack),
      nivelesArriba: numOpc(b.nivelesArriba, 1, 10),
      pallets: numOpc(b.pallets, 1, 4),
    };
  });
  const columnas = (Array.isArray(c?.columnas) ? c.columnas : CONFIG_INICIAL.columnas).map((k) => ({
    racks: (k.racks || []).map(leerRack),
    // formato anterior: { despuesDe, ancho }
    desde: Math.max(1, Math.round(+(k.desde ?? (+k.despuesDe || 0) + 1) || 1)),
    ocupa: Math.max(1, Math.round(+(k.ocupa ?? k.ancho) || 1)),
  }));
  const pel = { ...PELIGROSOS_INICIAL, ...(viejo ? {} : c?.peligrosos || {}) };
  if (antesV5 && (pel.adelante == null || +pel.adelante === 3)) pel.adelante = PELIGROSOS_INICIAL.adelante; // v5: más abajo
  pel.racks = (pel.racks || []).map((x) => {
    const desde = Math.max(1, +x.desde || 1);
    return {
      codigo: String(x.codigo || 'P1').toUpperCase(),
      desde,
      hasta: Math.max(desde, +x.hasta || 1),
      niveles: Math.max(1, +x.niveles || 1),
      fila: Math.max(1, +(x.fila ?? desde) || 1),
      pasilloAntes: x.pasilloAntes !== false,
      pallets: x.pallets ? Math.min(4, Math.max(1, +x.pallets)) : null,
    };
  });
  const enrejados = (viejo || !Array.isArray(c?.enrejados) ? CONFIG_INICIAL.enrejados : c.enrejados).map((e) => {
    const desde = Math.max(1, +e.desde || 1);
    return { rack: leerRack(e.rack), desde, hasta: Math.max(desde, +e.hasta || desde) };
  });
  const out = {
    ...base,
    version: 5,
    pasilloFrente: Math.max(0, +(base.pasilloFrente ?? 1.5) || 0),
    enrejados,
    columnas,
    palletsPorUbicacion: Math.min(4, Math.max(1, Math.round(+base.palletsPorUbicacion || 1))),
    rotulos: { ...CONFIG_INICIAL.rotulos, ...(c?.rotulos || {}) },
    pasilloAlFinal: !!base.pasilloAlFinal,
    apiladores: (Array.isArray(c?.apiladores) ? c.apiladores : CONFIG_INICIAL.apiladores).map((a) => ({
      antesDe: Math.max(1, Math.round(+a.antesDe || 1)),
      cantidad: Math.max(0, Math.round(+a.cantidad || 0)),
    })),
    pasillosDespuesDe: pasillos,
    stage: { ...CONFIG_INICIAL.stage, ...(c?.stage || {}) },
    peligrosos: pel,
    medidas: { ...CONFIG_INICIAL.medidas, ...(c?.medidas || {}) },
    racksDetalle,
    posiciones: { ...(c?.posiciones || {}) },
    puentes,
  };
  delete out.disposicion;
  return out;
};

export const rackPeligrosos = (cfg, r) => cfg.peligrosos.racks.find((x) => x.codigo === r) || null;

/** Racks de peligrosos que se dibujan (si la zona está activa). */
export const racksPeligrosos = (cfg) => (cfg.peligrosos.activo ? cfg.peligrosos.racks.map((x) => x.codigo) : []);

/** Todos los racks: 1..N del almacén principal + los de peligrosos. */
export const listaRacks = (cfg) => [...Array.from({ length: cfg.racks }, (_, i) => i + 1), ...racksPeligrosos(cfg)];

/** Largo del rack en posiciones físicas (sin descontar columnas): 44, 54… */
export const largoRack = (cfg, r) => cfg.racksDetalle[codRack(r)]?.profundidades ?? cfg.profundidades;

/** Columnas del edificio que cortan el rack r (solo almacén principal), ordenadas de adelante hacia el fondo. */
export const columnasDeRack = (cfg, r) =>
  esRackPeligrosos(r)
    ? []
    : (cfg.columnas || []).filter((k) => !k.racks?.length || k.racks.some((x) => String(x) === String(r))).sort((a, b) => a.desde - b.desde);

/** Posiciones físicas del rack que ocupan columnas (dentro de su largo). */
const posicionesColumna = (cfg, r) => {
  const largo = largoRack(cfg, r);
  const ocupadas = new Set();
  columnasDeRack(cfg, r).forEach((k) => {
    for (let f = k.desde; f < k.desde + k.ocupa; f++) if (f <= largo) ocupadas.add(f);
  });
  return ocupadas;
};

/** Última profundidad del rack: el largo menos lo que ocupan las columnas (44 sin columnas → 43 con una). */
export const profundidadesDeRack = (cfg, r) =>
  esRackPeligrosos(r) ? rackPeligrosos(cfg, r)?.hasta ?? 0 : largoRack(cfg, r) - posicionesColumna(cfg, r).size;

/** [primera, última] profundidad del rack. */
export const rangoProfundidades = (cfg, r) =>
  esRackPeligrosos(r) ? [rackPeligrosos(cfg, r)?.desde ?? 1, profundidadesDeRack(cfg, r)] : [1, profundidadesDeRack(cfg, r)];

/** Altura del rack medida en niveles base. */
export const alturaRack = (cfg, r) =>
  esRackPeligrosos(r) ? rackPeligrosos(cfg, r)?.niveles ?? 1 : cfg.racksDetalle[codRack(r)]?.niveles ?? cfg.nivelesBase;

/** ¿El puente aplica a este rack? Vacío = todos los del almacén principal; peligrosos solo si se nombra. */
const puenteAplica = (b, r) => (b.racks?.length ? b.racks.some((x) => String(x) === String(r)) : !esRackPeligrosos(r));

/**
 * Puente en la profundidad p del rack r. En el almacén principal el puente está en una posición
 * física (no se mueve aunque una columna corra la numeración); en peligrosos, por número.
 */
export const puenteEn = (cfg, r, p) => {
  const pos = esRackPeligrosos(r) ? p : filaDe(cfg, r, p);
  return cfg.puentes.find((b) => pos >= b.desde && pos <= b.hasta && puenteAplica(b, r)) || null;
};

/** ¿Hay puente en esta profundidad? (para resaltar el eje). Sin rack = posición del almacén principal. */
export const esProfundidadDePuente = (cfg, p, r = null) =>
  r != null
    ? !!puenteEn(cfg, r, p)
    : cfg.puentes.some((b) => p >= b.desde && p <= b.hasta && (!b.racks?.length || b.racks.some((x) => !esRackPeligrosos(x))));

export const enrejadoEn = (cfg, r, p) => cfg.enrejados.some((e) => String(e.rack) === String(r) && p >= e.desde && p <= e.hasta);

/**
 * Posición física (contando desde el frente, 1 = la de adelante) de la profundidad p del rack r.
 * La profundidad ocupa de (fila - 1) a fila, en posiciones. Las columnas se saltan.
 */
export const filaDe = (cfg, r, p) => {
  if (esRackPeligrosos(r)) {
    const d = rackPeligrosos(cfg, r);
    const adelante = (+cfg.peligrosos.adelante || 0) / cfg.medidas.anchoPosicion;
    return (d ? d.fila + (p - d.desde) : p) - adelante;
  }
  let f = p;
  for (const k of columnasDeRack(cfg, r)) if (k.desde <= f) f += k.ocupa;
  return f;
};

/** Pallets por ubicación de una profundidad: puntual > puente > rack > general. */
export const palletsDe = (cfg, r, p) => {
  const ov = cfg.posiciones[claveProf(r, p)];
  if (ov?.pallets) return ov.pallets;
  const b = puenteEn(cfg, r, p);
  if (b?.pallets) return b.pallets;
  const det = esRackPeligrosos(r) ? rackPeligrosos(cfg, r) : cfg.racksDetalle[codRack(r)];
  if (det?.pallets) return det.pallets;
  return cfg.palletsPorUbicacion || 1;
};

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
  const puente = puenteEn(cfg, r, p);
  const libres = puente ? Math.min(+puente.nivelesLibres || 0, altura) : 0;
  let niveles = ov.niveles ?? altura;
  let alturas;
  const suma = (a) => a.reduce((s, x) => s + x, 0);
  if (Array.isArray(ov.alturas) && ov.alturas.length === niveles && Math.abs(suma(ov.alturas) - altura) < 0.01) alturas = ov.alturas;
  else if (ov.niveles == null && puente?.nivelesArriba && libres < altura) {
    // Puente con N ubicaciones arriba: abajo quedan niveles de 1 (el paso), arriba N iguales.
    const abajo = libres > 0 ? Math.max(Math.round(libres), 1) : 0;
    const k = puente.nivelesArriba;
    alturas = [
      ...Array.from({ length: abajo }, () => redondear(libres / abajo)),
      ...Array.from({ length: k }, () => redondear((altura - libres) / k)),
    ];
    niveles = alturas.length;
  } else alturas = Array.from({ length: niveles }, () => redondear(altura / niveles));
  const bases = [];
  alturas.reduce((acc, h) => (bases.push(acc), acc + h), 0);

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
    enrejado: enrejadoEn(cfg, r, p),
    pallets: palletsDe(cfg, r, p),
    inactiva: !!ov.inactiva || p > profundidadesDeRack(cfg, r) || p < rangoProfundidades(cfg, r)[0],
    cambiada: ov.niveles != null || !!ov.inactiva || !!ov.alturas || !!ov.pallets,
    alturasPersonalizadas: alturas === ov.alturas,
  };
};

/** Lista de todas las ubicaciones válidas (el "catálogo"). */
export const generarCatalogo = (cfg) => {
  const lista = [];
  for (const r of listaRacks(cfg)) {
    const [pD, pH] = rangoProfundidades(cfg, r);
    for (let p = pD; p <= pH; p++) {
      const info = infoProfundidad(cfg, r, p);
      if (info.inactiva) continue;
      for (let n = info.desde; n <= info.niveles; n++) lista.push({ codigo: codigoUbicacion(r, p, n), rack: r, prof: p, nivel: n, pallets: info.pallets });
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

/** ¿Hay pasillo antes del rack r? (si no, va espalda con espalda con el anterior). */
export const pasilloAntesDe = (cfg, r) =>
  esRackPeligrosos(r) ? rackPeligrosos(cfg, r)?.pasilloAntes !== false : r === 1 || cfg.pasillosDespuesDe.includes(r - 1);

/** Nombre de un pasillo del almacén principal por los racks que lo rodean. */
export const nombrePasillo = (cfg, antesDe) => {
  if (antesDe <= 1) return 'Antes del 01';
  if (antesDe > cfg.racks) return `Después del ${codRack(cfg.racks)}`;
  return `Entre ${codRack(antesDe - 1)} y ${codRack(antesDe)}`;
};

/** Apiladores repartidos a lo largo de su pasillo: [{ numero, x, z, antesDe, pasillo }]. */
const ubicarApiladores = (cfg, pasillos, largo) => {
  const lista = [];
  (cfg.apiladores || []).forEach((a) => {
    const p = pasillos.find((x) => x.antesDe === a.antesDe);
    if (!p) return;
    for (let i = 0; i < a.cantidad; i++) {
      lista.push({
        numero: lista.length + 1,
        x: (p.x0 + p.x1) / 2,
        z: (largo * (i + 1)) / (a.cantidad + 1),
        antesDe: a.antesDe,
        pasillo: nombrePasillo(cfg, a.antesDe),
        mira: i % 2 ? -1 : 1, // hacia el fondo o hacia el frente
      });
    }
  });
  return lista;
};

/**
 * Posición (metros) de todo: racks, pasillos, stage, rampas y peligrosos.
 * X = racks uno al lado del otro, Z = profundidad (001 al frente), el stage queda en Z negativo.
 */
export const distribucion = (cfg) => {
  const { fondoRack, pasillo, espalda, anchoPosicion: A } = cfg.medidas;
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
  if (cfg.pasilloAlFinal) {
    pasillos.push({ x0: x, x1: x + pasillo, antesDe: cfg.racks + 1 });
    x += pasillo;
  } else x += 0.3; // el último rack va pegado al muro
  const anchoPrincipal = x;
  let filasMax = 0;
  for (let r = 1; r <= cfg.racks; r++) filasMax = Math.max(filasMax, filaDe(cfg, r, profundidadesDeRack(cfg, r)));
  const largo = filasMax * A;

  // Pasillo al frente de los racks (entre el stage y la profundidad 001)
  const pf = Math.max(+cfg.pasilloFrente || 0, 0);

  // Peligrosos (según el plano), de la pared hacia afuera:
  // zona de ingreso (con antesala al frente) | P1 | pasillo | P2·P3 | pasillo | P4·P5 | pasillo | P6 | muro
  let peligrosos = null;
  const pel = racksPeligrosos(cfg);
  if (pel.length) {
    const P = cfg.peligrosos;
    const izquierda = P.lado === 'izquierda';
    const s = izquierda ? -1 : 1; // hacia dónde crece (afuera del almacén principal)
    const pared = izquierda ? -P.separacion : anchoPrincipal + P.separacion; // muro compartido
    let d = P.zonaIngreso; // distancia desde la pared
    const tramo = (d0, d1) => (izquierda ? { x0: pared - d1, x1: pared - d0 } : { x0: pared + d0, x1: pared + d1 });
    const pelRacks = [];
    const pelPasillos = [];
    pel.forEach((cod, i) => {
      const def = rackPeligrosos(cfg, cod);
      if (i > 0) {
        if (def.pasilloAntes) {
          pelPasillos.push(tramo(d, d + pasillo));
          d += pasillo;
        } else d += espalda;
      }
      pelRacks.push({ rack: cod, ...tramo(d, d + fondoRack) });
      d += fondoRack;
    });
    d += 0.3; // aire hasta el muro exterior
    const filaMax = Math.max(...pel.map((cod) => filaDe(cfg, cod, rangoProfundidades(cfg, cod)[1])));
    const exterior = pared + s * d;
    const z0 = -0.3 - (+P.adelante || 0);
    const z1 = filaMax * A + 0.3;
    peligrosos = {
      x0: Math.min(pared, exterior), x1: Math.max(pared, exterior), pared, exterior, z0, z1, s,
      // zona de ingreso (gris, no es peligrosos) y zona de peligrosos (roja) desde la puerta de ingreso
      lineaIngreso: pared + s * P.zonaIngreso,
      ingreso: tramo(0, P.zonaIngreso),
      rojo: tramo(P.zonaIngreso, d),
      antesala: { ...tramo(0, P.zonaIngreso), z0, z1: z0 + P.antesala },
      // altura (Z) de las dos puertas: en línea con el pasillo del frente, o a la mitad de la zona de puertas
      zPuerta: pf ? -pf / 2 : z0 + P.antesala / 2,
      // pasillo de puerta a puerta (aire libre), centrado en la altura de las puertas
      pasilloIngreso: (() => {
        const zc = pf ? -pf / 2 : z0 + P.antesala / 2;
        const w = Math.max(+P.anchoPasilloIngreso || 0, 0);
        return w ? { ...tramo(0, P.zonaIngreso), z0: zc - w / 2, z1: zc + w / 2 } : null;
      })(),
      racks: pelRacks, pasillos: pelPasillos,
    };
    racks.push(...pelRacks);
  }

  // Stage al frente con rampas repartidas a lo ancho del almacén principal
  let stage = null;
  if (cfg.stage.activo) {
    const { fondo, rampas, anchoRampa } = cfg.stage;
    const z1 = pf ? -pf : -1;
    const z0 = z1 - fondo;
    const n = Math.max(0, rampas | 0);
    const paso = n ? anchoPrincipal / n : 0;
    stage = {
      x0: 0, x1: anchoPrincipal, z0, z1,
      rampas: Array.from({ length: n }, (_, i) => ({ numero: i + 1, xc: paso * (i + 0.5), ancho: Math.min(anchoRampa, paso * 0.9) })),
    };
  }

  // el pasillo del frente llega hasta la puerta de salida a peligrosos
  const frente = pf
    ? {
      x0: peligrosos ? Math.min(0, peligrosos.pared) : 0,
      x1: peligrosos ? Math.max(anchoPrincipal, peligrosos.pared) : anchoPrincipal,
      z0: -pf, z1: 0,
    }
    : null;

  const xMin = Math.min(0, peligrosos?.x0 ?? 0);
  const xMax = Math.max(anchoPrincipal, peligrosos?.x1 ?? 0);
  return {
    racks, pasillos, peligrosos, stage, frente,
    apiladores: ubicarApiladores(cfg, pasillos, largo),
    ancho: anchoPrincipal, largo,
    xMin, xMax, zMin: stage ? stage.z0 - 4 : -2, zMax: Math.max(largo, peligrosos?.z1 ?? 0) + 2,
  };
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
