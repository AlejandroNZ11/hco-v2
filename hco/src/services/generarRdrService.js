import { supabase } from '../config/supabaseClient';

const TABLA = 'generar_rdr';
const TAM_LOTE_INSERT = 500;
const TAM_PAGINA_LECTURA = 1000;

/**
 * Lee los registros de generar_rdr (paginando de 1000 en 1000, límite de Supabase).
 * @param {Object} filtros
 * @param {string} [filtros.desde] - fecha_registro desde (YYYY-MM-DD)
 * @param {string} [filtros.hasta] - fecha_registro hasta (YYYY-MM-DD)
 */
export const obtenerRegistrosRdr = async ({ desde, hasta } = {}) => {
  await supabase.auth.getSession();
  const todos = [];
  let inicio = 0;

  for (;;) {
    let query = supabase
      .from(TABLA)
      .select('*')
      .order('fecha_registro', { ascending: false })
      .order('costo', { ascending: true })
      .range(inicio, inicio + TAM_PAGINA_LECTURA - 1);

    if (desde) query = query.gte('fecha_registro', `${desde}T00:00:00`);
    if (hasta) query = query.lte('fecha_registro', `${hasta}T23:59:59.999`);

    const { data, error } = await query;
    if (error) throw new Error(`Error al cargar registros RDR: ${error.message}`);
    todos.push(...(data || []));
    if (!data || data.length < TAM_PAGINA_LECTURA) break;
    inicio += TAM_PAGINA_LECTURA;
  }

  return todos;
};

const claveRegistro = (r) =>
  [r.fecha || '', r.costo || '', r.sn || '', r.qty || '', r.observacion || '']
    .map((v) => String(v).trim().toUpperCase())
    .join('|');

/**
 * Devuelve las claves (fecha|costo|sn|qty|observacion) que ya existen en la BD para los costos dados.
 */
export const buscarRegistrosExistentes = async (filas) => {
  const costos = [...new Set(filas.map((f) => f.costo).filter(Boolean))];
  const existentes = new Set();

  for (let i = 0; i < costos.length; i += 200) {
    const { data, error } = await supabase
      .from(TABLA)
      .select('fecha, costo, sn, qty, observacion')
      .in('costo', costos.slice(i, i + 200));
    if (error) throw new Error(`Error al validar duplicados: ${error.message}`);
    (data || []).forEach((r) => existentes.add(claveRegistro(r)));
  }

  return { existentes, claveRegistro };
};

/**
 * Inserta las filas del Excel en generar_rdr. Todas comparten un mismo lote_carga.
 * @returns {Promise<{ lote: string, insertados: number }>}
 */
export const insertarRegistrosRdr = async (filas, usuario) => {
  const lote = crypto.randomUUID();
  const payload = filas.map((f) => ({
    fecha: f.fecha || null,
    costo: f.costo,
    sn: f.sn || null,
    observacion: f.observacion || null,
    hora: f.hora || null,
    qty: f.qty || null,
    codigo: f.codigo || null,
    obd: f.obd || null,
    orden: f.numFila || null,
    lote_carga: lote,
    registrado_por: usuario?.id || null,
    nombre_registrador: usuario?.nombre || null,
  }));

  let insertados = 0;
  for (let i = 0; i < payload.length; i += TAM_LOTE_INSERT) {
    const { error } = await supabase.from(TABLA).insert(payload.slice(i, i + TAM_LOTE_INSERT));
    if (error) {
      throw new Error(
        `Se guardaron ${insertados} de ${payload.length} registros. Error: ${error.message}`
      );
    }
    insertados += Math.min(TAM_LOTE_INSERT, payload.length - i);
  }

  return { lote, insertados };
};

export const eliminarRegistroRdr = async (id) => {
  const { error } = await supabase.from(TABLA).delete().eq('id', id);
  if (error) throw new Error(`No se pudo eliminar el registro: ${error.message}`);
};

// =====================================================================
// FOTOS EN BD (tabla rdr_fotos): solo se guardan las URL
// =====================================================================

/**
 * Guarda las URL de fotos de cada costo. Si una URL ya estaba guardada para ese costo, no se duplica.
 * @param {Array<{rdr_id,costo,url,origen,hoja,sku,fila}>} fotos
 * @returns {Promise<Array>} filas guardadas/existentes con su id
 */
export const guardarFotosRdr = async (fotos, usuario) => {
  if (fotos.length === 0) return [];
  const payload = fotos.map((f) => ({
    rdr_id: f.rdr_id,
    costo: f.costo,
    url: f.url,
    origen: f.origen || null,
    hoja: f.hoja || null,
    sku: f.sku || null,
    fila: f.fila || null,
    registrado_por: usuario?.id || null,
    nombre_registrador: usuario?.nombre || null,
  }));

  const guardadas = [];
  for (let i = 0; i < payload.length; i += TAM_LOTE_INSERT) {
    const { data, error } = await supabase
      .from('rdr_fotos')
      .upsert(payload.slice(i, i + TAM_LOTE_INSERT), { onConflict: 'rdr_id,url' })
      .select();
    if (error) throw new Error(`No se pudieron guardar las fotos: ${error.message}`);
    guardadas.push(...(data || []));
  }
  return guardadas;
};

/** Fotos guardadas de los costos indicados (por su rdr_id) */
export const obtenerFotosRdr = async (rdrIds) => {
  const ids = [...new Set(rdrIds.filter(Boolean))];
  const fotos = [];
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await supabase
      .from('rdr_fotos')
      .select('*')
      .in('rdr_id', ids.slice(i, i + 200))
      .order('fecha_registro', { ascending: true })
      .order('fila', { ascending: true });
    if (error) throw new Error(`Error al cargar las fotos: ${error.message}`);
    fotos.push(...(data || []));
  }
  return fotos;
};

export const eliminarFotoRdr = async (id) => {
  const { error } = await supabase.from('rdr_fotos').delete().eq('id', id);
  if (error) throw new Error(`No se pudo eliminar la foto: ${error.message}`);
};

// =====================================================================
// FOTOS: descarga una imagen desde su URL y la deja lista para el Excel
// =====================================================================

export const extraerIdDrive = (url) => {
  const str = String(url || '').trim();
  if (!/drive\.google\.com|docs\.google\.com|googleusercontent\.com/.test(str)) return null;
  const match = str.match(/\/file\/d\/([a-zA-Z0-9_-]+)/) ||
                str.match(/\/d\/([a-zA-Z0-9_-]+)/) ||
                str.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  return match ? match[1] : null;
};

// Intenta leer la foto directo desde el navegador (funciona si el servidor permite CORS)
const descargarDirecto = async (url) => {
  const idDrive = extraerIdDrive(url);
  const destino = idDrive ? `https://lh3.googleusercontent.com/d/${idDrive}=w1600` : url;
  const res = await fetch(destino, { mode: 'cors', credentials: 'omit' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const blob = await res.blob();
  if (!blob.type.startsWith('image/')) throw new Error('No es imagen');
  return blob;
};

// Respaldo: la Edge Function rdr-imagen descarga la foto desde el servidor
const descargarPorServidor = async (url) => {
  const { data, error } = await supabase.functions.invoke('rdr-imagen', { body: { url } });
  if (error || !data?.base64) {
    let mensaje = error?.message || data?.error || 'Sin respuesta';
    try {
      const cuerpo = await error?.context?.json?.();
      if (cuerpo?.error) mensaje = cuerpo.error;
    } catch {
      // sin cuerpo legible
    }
    throw new Error(mensaje);
  }
  const binario = atob(data.base64);
  const bytes = new Uint8Array(binario.length);
  for (let i = 0; i < binario.length; i++) bytes[i] = binario.charCodeAt(i);
  return new Blob([bytes], { type: data.contentType || 'image/jpeg' });
};

// Re-codifica a JPEG (máx. 800 px): en el Excel la foto mide ~170 px, así el archivo no pesa de más
const normalizarImagen = async (blob) => {
  const bitmap = await createImageBitmap(blob);
  const escala = Math.min(1, 800 / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * escala));
  const height = Math.max(1, Math.round(bitmap.height * escala));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close?.();

  const jpeg = await new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('No se pudo convertir la imagen'))), 'image/jpeg', 0.85)
  );
  return { buffer: await jpeg.arrayBuffer(), width, height };
};

/** URL liviana para mostrar la foto en pantalla (Drive → miniatura lh3) */
export const urlMiniatura = (url, ancho = 400) => {
  const id = extraerIdDrive(url);
  return id ? `https://lh3.googleusercontent.com/d/${id}=w${ancho}` : url;
};

/**
 * Descarga una foto y la deja en JPEG.
 * @returns {Promise<{buffer:ArrayBuffer,width:number,height:number}>}
 */
export const descargarImagenParaExcel = async (url) => {
  let blob;
  try {
    blob = await descargarDirecto(url);
  } catch {
    blob = await descargarPorServidor(url);
  }
  return normalizarImagen(blob);
};
