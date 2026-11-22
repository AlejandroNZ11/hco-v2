/**
 * Lógica de los 3 módulos corriendo en el celular. Es el mismo comportamiento que
 * vision-backend/vision_engine.py, para poder pasar a un servidor en el futuro sin cambiar reglas.
 *
 * Cada procesador recibe las detecciones del frame (por modelo) y devuelve:
 *   { cajas, resumen, eventos }  — cajas para dibujar, resumen para la pantalla, eventos para guardar.
 */
import { Tracker } from './tracker';
import { CruceLinea, ancla, puntoEnPoligono } from './geometria';

export const COCO = [
  'person', 'bicycle', 'car', 'motorcycle', 'airplane', 'bus', 'train', 'truck', 'boat', 'traffic light',
  'fire hydrant', 'stop sign', 'parking meter', 'bench', 'bird', 'cat', 'dog', 'horse', 'sheep', 'cow',
  'elephant', 'bear', 'zebra', 'giraffe', 'backpack', 'umbrella', 'handbag', 'tie', 'suitcase', 'frisbee',
  'skis', 'snowboard', 'sports ball', 'kite', 'baseball bat', 'baseball glove', 'skateboard', 'surfboard',
  'tennis racket', 'bottle', 'wine glass', 'cup', 'fork', 'knife', 'spoon', 'bowl', 'banana', 'apple',
  'sandwich', 'orange', 'broccoli', 'carrot', 'hot dog', 'pizza', 'donut', 'cake', 'chair', 'couch',
  'potted plant', 'bed', 'dining table', 'toilet', 'tv', 'laptop', 'mouse', 'remote', 'keyboard',
  'cell phone', 'microwave', 'oven', 'toaster', 'sink', 'refrigerator', 'book', 'clock', 'vase', 'scissors',
  'teddy bear', 'hair drier', 'toothbrush',
];

// Nombres en español (para mostrar y para que el usuario escriba "botella" y no "bottle")
export const ES = {
  person: 'persona', bottle: 'botella', cup: 'vaso', suitcase: 'maleta', backpack: 'mochila',
  handbag: 'bolso', chair: 'silla', 'cell phone': 'celular', laptop: 'laptop', book: 'libro',
  car: 'auto', truck: 'camión', bus: 'bus', motorcycle: 'moto', bicycle: 'bicicleta', box: 'caja',
};
const INVERSO = Object.fromEntries(Object.entries(ES).map(([k, v]) => [v, k]));
export const es = (n) => ES[n] || n;

export const EPP_CLAVES = {
  casco: ['helmet', 'hardhat', 'hard-hat', 'hard_hat', 'hard hat', 'casco'],
  chaleco: ['vest', 'chaleco'],
  gafas: ['goggle', 'glasses', 'gafas', 'lentes', 'eyewear'],
  guantes: ['glove', 'guante'],
};
const PERSONA_CLAVES = ['person', 'persona', 'worker', 'trabajador', 'human'];
// Zona vertical (fracción del alto de la persona) donde debe estar el centro de cada EPP
const ZONA_Y = { casco: [-0.15, 0.35], gafas: [-0.05, 0.35], chaleco: [0.12, 0.8], guantes: [0, 1.05] };

export const REGLAS = {
  eppSegundos: 2, // sin EPP más de 2 s seguidos
  eppCooldownTrackMs: 5 * 60 * 1000, // una alerta cada 5 min por persona
  eppCooldownCamaraMs: 20 * 1000, // y como máximo una foto cada 20 s por cámara
};

export const etiquetasDe = (valor) => (valor === 'coco' ? COCO : Array.isArray(valor) ? valor : []);

const caja = (box, extra) => ({ box, ...extra });

function crearTracker(cfg) {
  const fps = Math.max(1, Math.min(15, Number(cfg.fps) || 4));
  // A más FPS, se exige más confirmación antes de dar un ID
  return new Tracker({ maxPerdidoMs: 3000, minHits: fps >= 4 ? 2 : 1 });
}

// ----------------------------------------------------------------------------------- EPP
export class ProcesadorEpp {
  constructor(cfg, modelos) {
    this.cfg = cfg;
    this.tracker = crearTracker(cfg);
    this.advertencias = [];
    this.primerFaltante = new Map();
    this.ultimaAlerta = new Map();
    this.ultimaAlertaCamara = -1e12;
    this.mapa = new Map(); // clase → { epp, negativa }
    this.clasesPersona = new Set();
    this.requeridos = (cfg.epp_requeridos || ['casco', 'chaleco']).filter((e) => EPP_CLAVES[e]);

    const etiquetas = modelos.epp?.etiquetas;
    if (!etiquetas) {
      this.advertencias.push('Aún no hay modelo de EPP cargado: solo se detectan personas y no se toman fotos.');
      this.requeridos = [];
      this.modelos = ['general'];
      return;
    }
    etiquetas.forEach((nombre, i) => {
      const n = String(nombre).toLowerCase();
      if (PERSONA_CLAVES.some((k) => n === k || n.startsWith(k))) {
        this.clasesPersona.add(i);
        return;
      }
      const negativa = /^(no|sin|without)[\s_-]/.test(n);
      Object.entries(EPP_CLAVES).forEach(([epp, claves]) => {
        if (claves.some((k) => n.includes(k))) this.mapa.set(i, { epp, negativa });
      });
    });
    const detectables = new Set([...this.mapa.values()].map((v) => v.epp));
    const noEval = this.requeridos.filter((e) => !detectables.has(e));
    if (noEval.length) this.advertencias.push(`El modelo de EPP no detecta: ${noEval.join(', ')} (no se evaluará).`);
    this.requeridos = this.requeridos.filter((e) => detectables.has(e));
    // Si el modelo de EPP no trae "persona", las personas salen del modelo general
    this.modelos = this.clasesPersona.size ? ['epp'] : ['epp', 'general'];
  }

  _evaluar(p, items) {
    const [x1, y1, x2, y2] = p;
    const pw = x2 - x1;
    const ph = y2 - y1;
    const presentes = new Set();
    const negativos = new Set();
    items.forEach((it) => {
      const info = this.mapa.get(it.clase);
      if (!info) return;
      const cx = (it.box[0] + it.box[2]) / 2;
      const cy = (it.box[1] + it.box[3]) / 2;
      if (cx < x1 - pw * 0.15 || cx > x2 + pw * 0.15) return;
      const [z0, z1] = ZONA_Y[info.epp];
      if (cy < y1 + ph * z0 || cy > y1 + ph * z1) return;
      (info.negativa ? negativos : presentes).add(info.epp);
    });
    return this.requeridos.filter((e) => negativos.has(e) || !presentes.has(e));
  }

  procesar(dets, ahora) {
    let personas;
    let items = [];
    if (this.modelos[0] === 'epp') {
      const d = dets.epp || [];
      items = d.filter((x) => !this.clasesPersona.has(x.clase));
      personas = this.clasesPersona.size ? d.filter((x) => this.clasesPersona.has(x.clase)) : [];
      if (!this.clasesPersona.size) personas = (dets.general || []).filter((x) => x.clase === 0);
    } else {
      personas = (dets.general || []).filter((x) => x.clase === 0);
    }
    // El tracker trabaja con una sola clase "persona"
    const seguidas = this.tracker.actualizar(personas.map((p) => ({ ...p, clase: 0 })), ahora);
    const camaraLibre = ahora - this.ultimaAlertaCamara >= REGLAS.eppCooldownCamaraMs;
    const cajas = [];
    const infractores = [];

    seguidas.forEach((p) => {
      const tid = p.track_id;
      const faltan = this.requeridos.length ? this._evaluar(p.box, items) : [];
      let seg = 0;
      if (faltan.length) {
        if (!this.primerFaltante.has(tid)) this.primerFaltante.set(tid, ahora);
        seg = (ahora - this.primerFaltante.get(tid)) / 1000;
      } else {
        this.primerFaltante.delete(tid);
      }
      if (
        faltan.length &&
        seg >= REGLAS.eppSegundos &&
        ahora - (this.ultimaAlerta.get(tid) ?? -1e12) >= REGLAS.eppCooldownTrackMs &&
        camaraLibre
      ) {
        this.ultimaAlerta.set(tid, ahora);
        infractores.push({ track_id: tid, faltantes: faltan, segundos: Math.round(seg * 10) / 10, box: p.box });
      }
      cajas.push(caja(p.box, {
        track_id: tid,
        label: `#${tid} ${faltan.length ? `sin ${faltan.join(', ')}` : 'OK'}`,
        estado: !faltan.length ? 'ok' : seg >= REGLAS.eppSegundos ? 'alerta' : 'aviso',
        faltantes: faltan,
      }));
    });
    items.forEach((it) => {
      const info = this.mapa.get(it.clase);
      if (info) cajas.push(caja(it.box, { label: `${info.negativa ? 'sin ' : ''}${info.epp}`, estado: info.negativa ? 'item_neg' : 'item' }));
    });

    if (infractores.length) this.ultimaAlertaCamara = ahora;
    const vivos = this.tracker.idsVivos();
    [...this.ultimaAlerta.keys()].forEach((t) => {
      if (!vivos.has(t) && ahora - this.ultimaAlerta.get(t) > REGLAS.eppCooldownTrackMs) this.ultimaAlerta.delete(t);
    });
    [...this.primerFaltante.keys()].forEach((t) => !vivos.has(t) && this.primerFaltante.delete(t));

    const eventos = infractores.length
      ? [{ evento: 'epp_infraccion', infractores, cajasEvidencia: cajas.filter((c) => c.track_id !== undefined) }]
      : [];
    return {
      cajas,
      resumen: { personas: seguidas.length, no_conformes: cajas.filter((c) => c.faltantes?.length).length },
      eventos,
    };
  }
}

// -------------------------------------------------------------------------------- Conteo
export class ProcesadorConteo {
  constructor(cfg, modelos) {
    this.cfg = cfg;
    this.tracker = crearTracker(cfg);
    this.advertencias = [];
    const propio = modelos.conteo?.etiquetas;
    this.modelo = propio ? 'conteo' : 'general';
    this.modelos = [this.modelo];
    this.etiquetas = propio || modelos.general?.etiquetas || COCO;
    if (!propio) {
      this.advertencias.push('Sin modelo propio de conteo: se usa el general (botella, vaso, maleta, mochila…). Para cajas y pallets hay que entrenar uno.');
    }
    const pedidas = (cfg.clases_conteo || []).map((c) => INVERSO[c] || c);
    let ids = pedidas.map((c) => this.etiquetas.indexOf(c)).filter((i) => i >= 0);
    if (!ids.length) {
      const bottle = this.etiquetas.indexOf('bottle');
      ids = bottle >= 0 ? [bottle] : this.etiquetas.map((_, i) => i);
      if (pedidas.length) this.advertencias.push(`El modelo no conoce: ${pedidas.map(es).join(', ')}. Se cuenta: ${ids.map((i) => es(this.etiquetas[i])).join(', ')}.`);
    }
    this.clases = new Set(ids);
    this.modo = cfg.modo_conteo === 'zona' && (cfg.zona || []).length >= 3 ? 'zona' : 'linea';
    this.sentido = cfg.sentido || 'in';
    this.cruce = new CruceLinea(cfg.linea || [[0.5, 0.05], [0.5, 0.95]], { invertir: Boolean(cfg.invertir) });
    this.zona = cfg.zona || [];
    this.contados = new Set();
    this.dentro = new Set();
    this.totales = {};
    this.pendiente = {};
  }

  popPendiente() {
    const p = this.pendiente;
    this.pendiente = {};
    return p;
  }

  procesar(dets, ahora) {
    const propias = (dets[this.modelo] || []).filter((d) => this.clases.has(d.clase));
    const seguidas = this.tracker.actualizar(propias, ahora);
    const cajas = seguidas.map((d) => {
      const tid = d.track_id;
      const nombre = es(this.etiquetas[d.clase] || String(d.clase));
      let nuevo;
      if (this.modo === 'zona') {
        const adentro = puntoEnPoligono(ancla.centro(d.box), this.zona);
        nuevo = adentro && !this.dentro.has(tid);
        if (adentro) this.dentro.add(tid);
      } else {
        const r = this.cruce.evaluar(tid, ancla.centro(d.box), ahora);
        nuevo = r !== null && (this.sentido === 'ambos' || r === this.sentido);
      }
      if (nuevo && !this.contados.has(tid)) {
        // Cada objeto se cuenta una sola vez aunque vuelva a cruzar
        this.contados.add(tid);
        this.totales[nombre] = (this.totales[nombre] || 0) + 1;
        this.pendiente[nombre] = (this.pendiente[nombre] || 0) + 1;
      }
      return caja(d.box, { track_id: tid, label: `${nombre} #${tid}`, estado: this.contados.has(tid) ? 'contado' : 'item' });
    });
    const vivos = this.tracker.idsVivos();
    this.cruce.olvidar(vivos);
    [...this.contados].forEach((t) => !vivos.has(t) && this.contados.delete(t));
    [...this.dentro].forEach((t) => !vivos.has(t) && this.dentro.delete(t));
    return { cajas, resumen: { totales: { ...this.totales } }, eventos: [] };
  }
}

// --------------------------------------------------------------------- Conteo de personal
export class ProcesadorAforo {
  constructor(cfg) {
    this.cfg = cfg;
    this.tracker = crearTracker(cfg);
    this.advertencias = [];
    this.modelos = ['general'];
    // Para personas se usan los pies: es el punto más estable al cruzar una puerta
    this.cruce = new CruceLinea(cfg.linea || [[0.05, 0.6], [0.95, 0.6]], { invertir: Boolean(cfg.invertir) });
    this.ingresos = 0;
    this.salidas = 0;
  }

  procesar(dets, ahora) {
    const personas = (dets.general || []).filter((d) => d.clase === 0);
    const seguidas = this.tracker.actualizar(personas, ahora);
    const eventos = [];
    const cajas = seguidas.map((d) => {
      const r = this.cruce.evaluar(d.track_id, ancla.pies(d.box), ahora);
      if (r) {
        const tipo = r === 'in' ? 'INGRESO' : 'SALIDA';
        if (r === 'in') this.ingresos += 1;
        else this.salidas += 1;
        eventos.push({ evento: 'aforo', tipo, delta: r === 'in' ? 1 : -1, track_id: d.track_id });
      }
      return caja(d.box, { track_id: d.track_id, label: `#${d.track_id}`, estado: r === 'in' ? 'ingreso' : r === 'out' ? 'salida' : 'item' });
    });
    this.cruce.olvidar(this.tracker.idsVivos());
    return { cajas, resumen: { ingresos: this.ingresos, salidas: this.salidas, en_cuadro: seguidas.length }, eventos };
  }
}

export function crearProcesador(cfg, modelos) {
  if (cfg.modulo === 'epp') return new ProcesadorEpp(cfg, modelos);
  if (cfg.modulo === 'conteo') return new ProcesadorConteo(cfg, modelos);
  if (cfg.modulo === 'aforo') return new ProcesadorAforo(cfg, modelos);
  throw new Error(`Módulo desconocido: ${cfg.modulo}`);
}
