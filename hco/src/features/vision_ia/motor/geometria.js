/**
 * Línea virtual bidireccional y zona poligonal, en coordenadas normalizadas (0–1).
 *
 * Convención (la misma del backend con supervision.LineZone y de la flecha del overlay):
 * la dirección "entrada" es la normal n = (dy, -dx) del segmento A→B en pantalla.
 * Ej.: línea de izquierda a derecha → cruzar hacia ARRIBA es "in". `invertir` lo da vuelta.
 */
export class CruceLinea {
  constructor(linea, { invertir = false, margen = 0.012, rebote = 800 } = {}) {
    const [a, b] = linea;
    this.a = a;
    this.d = [b[0] - a[0], b[1] - a[1]];
    this.largo2 = this.d[0] ** 2 + this.d[1] ** 2 || 1e-9;
    const largo = Math.sqrt(this.largo2);
    this.n = [this.d[1] / largo, -this.d[0] / largo];
    this.invertir = invertir;
    this.margen = margen; // histéresis: no decide lado si el punto está casi sobre la línea
    this.rebote = rebote; // ms mínimos entre dos cruces del mismo track
    this.lados = new Map(); // track_id → +1 | -1
    this.ultimoCruce = new Map();
  }

  /**
   * @returns {'in' | 'out' | null}
   */
  evaluar(trackId, punto, ahora) {
    const rx = punto[0] - this.a[0];
    const ry = punto[1] - this.a[1];
    const s = rx * this.n[0] + ry * this.n[1];
    const t = (rx * this.d[0] + ry * this.d[1]) / this.largo2;
    if (Math.abs(s) < this.margen) return null;
    const lado = s > 0 ? 1 : -1;
    const previo = this.lados.get(trackId);
    this.lados.set(trackId, lado);
    if (previo === undefined || previo === lado) return null;
    // Solo cuenta si cruzó por el tramo dibujado (no por la prolongación de la línea)
    if (t < -0.05 || t > 1.05) return null;
    if (ahora - (this.ultimoCruce.get(trackId) ?? -1e9) < this.rebote) return null;
    this.ultimoCruce.set(trackId, ahora);
    const entra = previo === -1 && lado === 1;
    return entra !== this.invertir ? 'in' : 'out';
  }

  olvidar(vivos) {
    [...this.lados.keys()].forEach((id) => {
      if (!vivos.has(id)) {
        this.lados.delete(id);
        this.ultimoCruce.delete(id);
      }
    });
  }
}

export function puntoEnPoligono([x, y], poligono) {
  let dentro = false;
  for (let i = 0, j = poligono.length - 1; i < poligono.length; j = i, i += 1) {
    const [xi, yi] = poligono[i];
    const [xj, yj] = poligono[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) dentro = !dentro;
  }
  return dentro;
}

export const ancla = {
  centro: (b) => [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2],
  pies: (b) => [(b[0] + b[2]) / 2, b[3]],
};
