/**
 * Guardado de eventos cuando la IA corre en el celular:
 *  - Conteo de personal → insert en vision_aforo_eventos (1 fila por cruce).
 *  - Conteo de objetos  → rpc vision_sumar_conteo (suma por hora; se envía cada 15 s).
 *  - EPP → foto a Google Drive por la Edge Function `subir-drive` (destino "vision", igual que las
 *          fotos de LUP) y luego insert en vision_epp_infracciones con el enlace lh3.
 *
 * Si no hay señal, los eventos quedan en una cola y se reintentan cada 20 s. La cola de filas
 * (sin fotos) se guarda en localStorage para no perder conteos si se recarga la página; las fotos
 * pendientes solo viven en memoria (si se recarga, la infracción se guarda sin foto).
 */
import { supabase } from '../../../config/supabaseClient';
import { subirImagenDrive } from '../../../services/driveService';

const COLA_KEY = 'vision-ia-cola-v1';
const MAX_COLA = 3000;

const leerCola = () => {
  try {
    return JSON.parse(localStorage.getItem(COLA_KEY) || '[]');
  } catch {
    return [];
  }
};

const guardarCola = (cola) => {
  try {
    localStorage.setItem(COLA_KEY, JSON.stringify(cola.slice(-MAX_COLA)));
  } catch {
    // almacenamiento lleno o bloqueado: la cola queda solo en memoria
  }
};

/** Convierte el enlace que devuelve subir-drive (…/file/d/ID/view) al formato lh3 que usa el panel. */
export const enlaceLh3 = (url) => {
  const id = String(url || '').match(/\/d\/([a-zA-Z0-9_-]+)/)?.[1];
  return id ? { id, url: `https://lh3.googleusercontent.com/d/${id}` } : { id: null, url: url || null };
};

async function usuarioId() {
  const { data } = await supabase.auth.getSession();
  return data?.session?.user?.id || null;
}

async function ejecutar(op) {
  if (op.tipo === 'insert') {
    // Evento capturado sin sesión: se firma con el usuario actual al reenviarlo
    if (op.fila && !op.fila.registrado_por) {
      const uid = await usuarioId();
      if (!uid) throw Object.assign(new Error('Sesión vencida: vuelve a iniciar sesión'), { code: '42501' });
      op.fila.registrado_por = uid;
    }
    const { error } = await supabase.from(op.tabla).insert(op.fila);
    if (error) throw error;
  } else if (op.tipo === 'rpc') {
    const { error } = await supabase.rpc(op.fn, op.params);
    if (error) throw error;
  }
}

// Errores de datos (columna/valor inválido) no se arreglan reintentando. Un rechazo de RLS
// (42501) sí puede arreglarse: sesión vencida o SQL aún no actualizado → se deja en cola.
const esPermanente = (err) =>
  Boolean(err?.code && String(err.code) !== '42501' && /^(22|23|42|PGRST)/.test(String(err.code)));

export class Persistencia {
  constructor({ onEstado } = {}) {
    this.cola = leerCola(); // operaciones sin imagen
    this.fotos = []; // { fila, imagen, nombre, intentos }
    this.onEstado = onEstado;
    this.timer = setInterval(() => this.reintentar(), 20000);
    this.ocupado = false;
    this.ultimoError = '';
  }

  get pendientes() {
    return this.cola.length + this.fotos.length;
  }

  _avisar() {
    this.onEstado?.({ pendientes: this.pendientes, error: this.ultimoError });
  }

  async _enviar(op) {
    try {
      await ejecutar(op);
      this.ultimoError = '';
      return true;
    } catch (err) {
      this.ultimoError = err.message || String(err);
      if (esPermanente(err)) {
        console.error('[vision] evento rechazado por Supabase', err, op);
        return true; // se descarta para no trabar la cola
      }
      return false;
    }
  }

  async _encolar(op) {
    if (!(await this._enviar(op))) {
      this.cola.push(op);
      guardarCola(this.cola);
    }
    this._avisar();
  }

  async guardarAforo({ camaraId, area, tipo, delta, trackId }) {
    const uid = await usuarioId();
    await this._encolar({
      tipo: 'insert',
      tabla: 'vision_aforo_eventos',
      fila: { hora: new Date().toISOString(), camara_id: camaraId, area, tipo, delta, track_id: trackId, registrado_por: uid },
    });
  }

  async sumarConteos({ camaraId, area, conteos }) {
    const hora = new Date().toISOString();
    for (const [clase, cantidad] of Object.entries(conteos)) {
      if (cantidad > 0) {
        await this._encolar({
          tipo: 'rpc',
          fn: 'vision_sumar_conteo',
          params: { p_camara_id: camaraId, p_area: area, p_clase: clase, p_hora: hora, p_cantidad: cantidad },
        });
      }
    }
  }

  /** @param {{ fila: object, imagen: string (dataURL JPEG), nombre: string }} p */
  async guardarEpp({ fila, imagen, nombre }) {
    const uid = await usuarioId();
    const item = { fila: { ...fila, registrado_por: uid }, imagen, nombre, intentos: 0 };
    if (!(await this._subirEpp(item))) this.fotos.push(item);
    this._avisar();
  }

  async _subirEpp(item) {
    item.intentos += 1;
    let fila = item.fila;
    if (item.imagen) {
      try {
        const url = await subirImagenDrive(item.imagen, item.nombre, { destino: 'vision' });
        const { id, url: lh3 } = enlaceLh3(url);
        fila = { ...fila, foto_url: lh3, drive_file_id: id };
        item.imagen = null; // ya subida: si falla el insert, no se vuelve a subir
        item.fila = fila;
      } catch (err) {
        this.ultimoError = `Foto no subida: ${err.message}`;
        // Tras 3 intentos se guarda la infracción sin foto (mejor que perderla)
        if (item.intentos < 3) return false;
      }
    }
    return this._enviar({ tipo: 'insert', tabla: 'vision_epp_infracciones', fila });
  }

  async reintentar() {
    if (this.ocupado || !this.pendientes || (typeof navigator !== 'undefined' && navigator.onLine === false)) return;
    this.ocupado = true;
    try {
      const fotos = this.fotos;
      this.fotos = [];
      for (const item of fotos) {
        if (!(await this._subirEpp(item))) this.fotos.push(item);
      }
      while (this.cola.length) {
        if (!(await this._enviar(this.cola[0]))) break;
        this.cola.shift();
        guardarCola(this.cola);
      }
    } finally {
      this.ocupado = false;
      this._avisar();
    }
  }

  cerrar() {
    clearInterval(this.timer);
  }
}
