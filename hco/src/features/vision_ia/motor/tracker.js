import { iou } from './yolox';

/**
 * Tracker liviano inspirado en ByteTrack, pensado para 3–10 FPS en el celular:
 *  - predicción de posición con velocidad constante (los objetos se mueven entre frames);
 *  - asociación en dos etapas: primero detecciones con score alto, luego las de score bajo
 *    (recupera objetos parcialmente tapados sin crear IDs nuevos);
 *  - si el IoU no alcanza (movimiento rápido a pocos FPS), se acepta por cercanía del centro;
 *  - un track recién nacido necesita `minHits` apariciones para recibir ID (evita IDs fantasma);
 *  - un track perdido se conserva `maxPerdidoMs` antes de olvidarlo.
 *
 * Todas las cajas en coordenadas normalizadas [x1, y1, x2, y2].
 */
export class Tracker {
  constructor({ maxPerdidoMs = 3000, iouMin = 0.2, scoreAlto = 0.5, minHits = 2 } = {}) {
    this.maxPerdidoMs = maxPerdidoMs;
    this.iouMin = iouMin;
    this.scoreAlto = scoreAlto;
    this.minHits = minHits;
    this.tracks = [];
    this.siguienteId = 1;
  }

  static centro(b) {
    return [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2];
  }

  _prediccion(t, ahora) {
    const dt = Math.min(1000, ahora - t.visto);
    const [vx, vy] = t.vel;
    return [t.box[0] + vx * dt, t.box[1] + vy * dt, t.box[2] + vx * dt, t.box[3] + vy * dt];
  }

  _afinidad(pred, box) {
    const v = iou(pred, box);
    if (v >= this.iouMin) return 1 + v;
    const [cx1, cy1] = Tracker.centro(pred);
    const [cx2, cy2] = Tracker.centro(box);
    const diag = Math.hypot(pred[2] - pred[0], pred[3] - pred[1]) || 1e-6;
    const dist = Math.hypot(cx1 - cx2, cy1 - cy2) / diag;
    return dist < 0.6 ? 1 - dist : 0; // (0, 1): peor que cualquier match por IoU
  }

  _asociar(tracksLibres, dets, preds) {
    const pares = [];
    tracksLibres.forEach((ti) => {
      dets.forEach((d, di) => {
        if (this.tracks[ti].clase !== d.clase) return;
        // Se compara con la posición predicha y con la última real: si el objeto frena o
        // cambia de sentido de golpe, la predicción falla pero la última posición no
        const a = Math.max(this._afinidad(preds[ti], d.box), this._afinidad(this.tracks[ti].box, d.box));
        if (a > 0) pares.push([a, ti, di]);
      });
    });
    pares.sort((p, q) => q[0] - p[0]);
    const usadosT = new Set();
    const usadosD = new Set();
    const matches = [];
    pares.forEach(([, ti, di]) => {
      if (usadosT.has(ti) || usadosD.has(di)) return;
      usadosT.add(ti);
      usadosD.add(di);
      matches.push([ti, di]);
    });
    return { matches, usadosT, usadosD };
  }

  _actualizarTrack(t, d, ahora) {
    const dt = Math.max(1, ahora - t.visto);
    const [cx0, cy0] = Tracker.centro(t.box);
    const [cx1, cy1] = Tracker.centro(d.box);
    // Velocidad suavizada (px normalizados por ms)
    t.vel = [t.vel[0] * 0.5 + ((cx1 - cx0) / dt) * 0.5, t.vel[1] * 0.5 + ((cy1 - cy0) / dt) * 0.5];
    t.box = d.box;
    t.score = d.score;
    t.visto = ahora;
    t.hits += 1;
    t.det = d;
    if (!t.id && t.hits >= this.minHits) t.id = this.siguienteId++;
  }

  /**
   * @param {{box:number[], score:number, clase:number}[]} dets
   * @param {number} ahora ms
   * @returns {object[]} detecciones de este frame con `track_id` (solo tracks confirmados)
   */
  actualizar(dets, ahora) {
    const preds = this.tracks.map((t) => this._prediccion(t, ahora));
    const altos = dets.filter((d) => d.score >= this.scoreAlto);
    const bajos = dets.filter((d) => d.score < this.scoreAlto);
    const todos = this.tracks.map((_, i) => i);

    const e1 = this._asociar(todos, altos, preds);
    e1.matches.forEach(([ti, di]) => this._actualizarTrack(this.tracks[ti], altos[di], ahora));

    const restantes = todos.filter((ti) => !e1.usadosT.has(ti) && this.tracks[ti].id);
    const e2 = this._asociar(restantes, bajos, preds);
    e2.matches.forEach(([ti, di]) => this._actualizarTrack(this.tracks[ti], bajos[di], ahora));

    const actualizados = new Set([...e1.usadosT, ...e2.usadosT]);
    // Tracks sin confirmar que no aparecieron: se descartan; los confirmados esperan maxPerdidoMs
    this.tracks = this.tracks.filter(
      (t, i) => actualizados.has(i) || (t.id && ahora - t.visto <= this.maxPerdidoMs),
    );

    altos.forEach((d, di) => {
      if (e1.usadosD.has(di)) return;
      const t = { id: 0, box: d.box, clase: d.clase, score: d.score, vel: [0, 0], visto: ahora, hits: 1, det: d };
      if (this.minHits <= 1) t.id = this.siguienteId++;
      this.tracks.push(t);
    });

    return this.tracks
      .filter((t) => t.id && t.visto === ahora)
      .map((t) => ({ ...t.det, box: t.box, track_id: t.id }));
  }

  /** IDs de tracks que siguen vivos (vistos o esperando). */
  idsVivos() {
    return new Set(this.tracks.filter((t) => t.id).map((t) => t.id));
  }
}
