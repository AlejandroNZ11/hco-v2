/**
 * Dibujo del overlay (recuadros, línea y zona) sobre el <video>.
 * Todas las coordenadas que manda el backend están normalizadas (0 a 1) respecto al frame.
 * El video usa object-fit: contain, así que se calcula el rectángulo real donde se pinta.
 */

export const COLORES = {
  ok: '#16a34a',
  aviso: '#f59e0b',
  alerta: '#dc2626',
  item: '#2563eb',
  item_neg: '#dc2626',
  contado: '#7c3aed',
  ingreso: '#16a34a',
  salida: '#ea580c',
};

/** Rectángulo (en px CSS del contenedor) que ocupa el video con object-fit: contain. */
export function rectVideo(anchoCont, altoCont, anchoVideo, altoVideo) {
  if (!anchoVideo || !altoVideo) return { x: 0, y: 0, w: anchoCont, h: altoCont };
  const esc = Math.min(anchoCont / anchoVideo, altoCont / altoVideo);
  const w = anchoVideo * esc;
  const h = altoVideo * esc;
  return { x: (anchoCont - w) / 2, y: (altoCont - h) / 2, w, h };
}

/**
 * Dirección "entrada" de una línea en pantalla.
 * Comprobado con supervision.LineZone: para una línea de izquierda a derecha, cruzar
 * hacia ARRIBA cuenta como "in". En coordenadas de pantalla (y hacia abajo) la normal
 * "in" es (dy, -dx). `invertir` la da vuelta (igual que en el backend).
 */
export function normalEntrada(p1, p2, invertir) {
  const dx = p2[0] - p1[0];
  const dy = p2[1] - p1[1];
  const largo = Math.hypot(dx, dy) || 1;
  const s = invertir ? -1 : 1;
  return [(s * dy) / largo, (s * -dx) / largo];
}

function flecha(ctx, x1, y1, x2, y2, color) {
  const ang = Math.atan2(y2 - y1, x2 - x1);
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x2, y2);
  ctx.lineTo(x2 - 12 * Math.cos(ang - 0.45), y2 - 12 * Math.sin(ang - 0.45));
  ctx.lineTo(x2 - 12 * Math.cos(ang + 0.45), y2 - 12 * Math.sin(ang + 0.45));
  ctx.closePath();
  ctx.fill();
}

function etiqueta(ctx, texto, x, y, color) {
  ctx.font = '600 12px system-ui, sans-serif';
  const w = ctx.measureText(texto).width + 8;
  const yy = Math.max(16, y);
  ctx.fillStyle = color;
  ctx.fillRect(x, yy - 16, w, 16);
  ctx.fillStyle = '#fff';
  ctx.fillText(texto, x + 4, yy - 4);
}

/**
 * @param {HTMLCanvasElement} canvas
 * @param {HTMLVideoElement} video
 * @param {object} escena { cajas, linea, zona, invertir, mostrarZona, etiquetas, puntosTemp, tipoTemp }
 */
export function dibujarOverlay(canvas, video, escena) {
  if (!canvas) return;
  const dpr = window.devicePixelRatio || 1;
  const cw = canvas.clientWidth;
  const ch = canvas.clientHeight;
  if (canvas.width !== Math.round(cw * dpr) || canvas.height !== Math.round(ch * dpr)) {
    canvas.width = Math.round(cw * dpr);
    canvas.height = Math.round(ch * dpr);
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cw, ch);

  const r = rectVideo(cw, ch, video?.videoWidth, video?.videoHeight);
  const px = ([x, y]) => [r.x + x * r.w, r.y + y * r.h];

  // Recuadros de detección
  (escena.cajas || []).forEach((c) => {
    const [x1, y1] = px([c.box[0], c.box[1]]);
    const [x2, y2] = px([c.box[2], c.box[3]]);
    const color = COLORES[c.estado] || COLORES.item;
    const esItem = c.estado === 'item' || c.estado === 'item_neg';
    ctx.lineWidth = esItem ? 1.5 : 2.5;
    ctx.strokeStyle = color;
    ctx.setLineDash(c.estado === 'item_neg' ? [5, 4] : []);
    ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);
    ctx.setLineDash([]);
    if (c.label) etiqueta(ctx, c.label, x1, y1, color);
  });

  // Zona de conteo
  if (escena.mostrarZona && escena.zona?.length >= 3) {
    ctx.beginPath();
    escena.zona.forEach((p, i) => {
      const [x, y] = px(p);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.closePath();
    ctx.fillStyle = 'rgba(124, 58, 237, 0.15)';
    ctx.fill();
    ctx.strokeStyle = '#7c3aed';
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  // Línea virtual con la flecha de "entrada"
  if (!escena.mostrarZona && escena.linea?.length >= 2) {
    const [a, b] = escena.linea;
    const [ax, ay] = px(a);
    const [bx, by] = px(b);
    ctx.strokeStyle = '#facc15';
    ctx.lineWidth = 3;
    ctx.setLineDash([10, 6]);
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(bx, by);
    ctx.stroke();
    ctx.setLineDash([]);
    const [nx, ny] = normalEntrada([ax, ay], [bx, by], escena.invertir);
    const mx = (ax + bx) / 2;
    const my = (ay + by) / 2;
    flecha(ctx, mx - nx * 22, my - ny * 22, mx + nx * 30, my + ny * 30, COLORES.ingreso);
    const [eIn, eOut] = escena.etiquetas || ['ENTRADA', 'SALIDA'];
    etiqueta(ctx, eIn, mx + nx * 36 - 30, my + ny * 36 + 8, COLORES.ingreso);
    etiqueta(ctx, eOut, mx - nx * 40 - 30, my - ny * 40 + 8, COLORES.salida);
  }

  // Puntos que el usuario está marcando
  if (escena.puntosTemp?.length) {
    ctx.fillStyle = '#facc15';
    ctx.strokeStyle = '#facc15';
    ctx.lineWidth = 2;
    ctx.beginPath();
    escena.puntosTemp.forEach((p, i) => {
      const [x, y] = px(p);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
    escena.puntosTemp.forEach((p) => {
      const [x, y] = px(p);
      ctx.beginPath();
      ctx.arc(x, y, 6, 0, Math.PI * 2);
      ctx.fill();
    });
  }
}

/** Convierte un click/tap sobre el canvas a coordenadas normalizadas del frame (o null si cae fuera). */
export function puntoNormalizado(evento, canvas, video) {
  const caja = canvas.getBoundingClientRect();
  const r = rectVideo(caja.width, caja.height, video?.videoWidth, video?.videoHeight);
  const x = (evento.clientX - caja.left - r.x) / r.w;
  const y = (evento.clientY - caja.top - r.y) / r.h;
  if (x < 0 || x > 1 || y < 0 || y > 1) return null;
  return [Math.round(x * 1000) / 1000, Math.round(y * 1000) / 1000];
}
