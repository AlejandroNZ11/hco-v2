import { supabase } from '../config/supabaseClient';
import { localDb } from './localDb';
import { estaFresco, marcarFresco } from './cacheConsultas';

const TABLA = 'toma_lotes';
const BLOQUE = 500; // filas por petición al subir
const BLOQUE_IDS = 200; // ids por consulta .in()
const BLOQUE_LECTURA = 1000; // Supabase devuelve máx. 1000 filas por petición

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------
const texto = (v) => String(v ?? '').trim();
export const normalizarPedido = (v) => texto(v).replace(/\.0+$/, ''); // 315669.0 → 315669
export const normalizarSku = (v) => texto(v).toUpperCase();
export const normalizarLote = (v) => texto(v).toUpperCase();
export const claveTomaLote = (pedido, sku) => `${normalizarPedido(pedido)}|${normalizarSku(sku)}`;

const limpiar = (fila) => {
  const copia = { ...fila };
  delete copia._sincronizado;
  return copia;
};

const sinTildes = (s) => texto(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

// Una celda puede traer varios lotes: "L1, L2; L3 | L4" o uno por línea
const separarLotes = (celda) =>
  texto(celda)
    .split(/[,;|\n\r]+/)
    .map(normalizarLote)
    .filter(Boolean);

/**
 * Detalle de lotes de una fila: [{ lote, fecha, por_id, por_nombre, origen }].
 * Filas antiguas (solo con `lotes`) se completan con la fecha de la última actualización.
 */
export const detalleDeFila = (fila) => {
  const det = Array.isArray(fila?.lotes_detalle) ? fila.lotes_detalle : [];
  const porLote = new Map(det.map((d) => [d.lote, d]));
  return (fila?.lotes || []).map(
    (lote) =>
      porLote.get(lote) || {
        lote,
        fecha: fila.lotes_actualizado_en || fila.fecha_registro || null,
        por_id: fila.lotes_por_id || null,
        por_nombre: fila.lotes_por_nombre || null,
        origen: null,
      },
  );
};

// Agrega a una fila solo los lotes que aún no tiene. Devuelve null si no hay nada nuevo.
const fusionarLotes = (fila, nuevos) => {
  const actuales = detalleDeFila(fila);
  const ya = new Set(actuales.map((d) => d.lote));
  const agregar = nuevos.filter((d) => !ya.has(d.lote) && ya.add(d.lote));
  if (!agregar.length) return null;
  const ultimo = agregar[agregar.length - 1];
  const detalle = [...actuales, ...agregar];
  return {
    ...fila,
    lotes: detalle.map((d) => d.lote),
    lotes_detalle: detalle,
    lotes_por_id: ultimo.por_id,
    lotes_por_nombre: ultimo.por_nombre,
    lotes_actualizado_en: ultimo.fecha,
  };
};

// ---------------------------------------------------------------------------
// Lectura del Excel: Ruta | Cliente | Pedido | SKU | Lote (opcional)
// ---------------------------------------------------------------------------
/**
 * Lee el Excel y lo compara con lo ya cargado.
 *  - Regla: un pedido no puede tener 2 veces el mismo SKU.
 *  - Columna "Lote" opcional: varios lotes en una celda (L1, L2) o una fila por lote
 *    (mismo pedido + SKU repetido con distinto lote → se juntan, no es "repetido").
 *  - Si el pedido + SKU ya existe, solo se adicionan los lotes que le faltan.
 *
 * Devuelve { nuevas, aActualizar, repetidasArchivo, yaExistentes, invalidas, conLote }.
 */
export const analizarExcelTomaLotes = async (archivo) => {
  const XLSX = await import('xlsx'); // se descarga solo al cargar un Excel
  const buffer = await archivo.arrayBuffer();
  const libro = XLSX.read(buffer, { type: 'array' });
  const hoja = libro.Sheets[libro.SheetNames[0]];
  if (!hoja) throw new Error('El archivo no tiene hojas.');

  const matriz = XLSX.utils.sheet_to_json(hoja, { header: 1, defval: '', raw: true, blankrows: false });

  // Busca la fila de encabezados en las primeras 15 filas
  let filaEnc = -1;
  let col = {};
  for (let i = 0; i < Math.min(15, matriz.length); i++) {
    const enc = matriz[i].map(sinTildes);
    const idx = (...nombres) => enc.findIndex((h) => nombres.includes(h));
    const c = {
      ruta: idx('ruta'),
      cliente: idx('cliente', 'razon social'),
      pedido: idx('pedido', 'nro pedido', 'n° pedido', 'numero pedido'),
      sku: idx('sku', 'codigo', 'codigo sku', 'material'),
      lote: idx('lote', 'lotes', 'lote(s)', 'nro lote', 'batch'),
    };
    if (c.pedido >= 0 && c.sku >= 0) {
      filaEnc = i;
      col = c;
      break;
    }
  }
  if (filaEnc < 0) {
    throw new Error('No se encontraron las columnas "Pedido" y "SKU". Encabezados esperados: Ruta, Cliente, Pedido, SKU, Lote.');
  }
  const conLote = col.lote >= 0;

  // 1. Agrupar por pedido + SKU
  const grupos = new Map();
  const repetidasArchivo = [];
  const invalidas = [];

  for (let i = filaEnc + 1; i < matriz.length; i++) {
    const f = matriz[i];
    const filaExcel = i + 1;
    const pedido = normalizarPedido(f[col.pedido]);
    const sku = normalizarSku(f[col.sku]);
    const ruta = col.ruta >= 0 ? texto(f[col.ruta]).toUpperCase() : '';
    const cliente = col.cliente >= 0 ? texto(f[col.cliente]) : '';
    const lotes = conLote ? separarLotes(f[col.lote]) : [];

    if (!pedido && !sku && !ruta && !cliente && !lotes.length) continue; // fila vacía
    const item = { filaExcel, ruta, cliente, pedido, sku, lotes };

    if (!pedido || !sku) {
      invalidas.push({ ...item, motivo: !pedido ? 'Sin pedido' : 'Sin SKU' });
      continue;
    }
    const id = claveTomaLote(pedido, sku);
    const g = grupos.get(id);
    if (!g) {
      grupos.set(id, { ...item, id, lotes: [...new Set(lotes)] });
      continue;
    }
    // Mismo pedido + SKU otra vez: solo vale si trae lotes nuevos (una fila por lote)
    const aporta = lotes.filter((l) => !g.lotes.includes(l));
    if (aporta.length) g.lotes.push(...new Set(aporta));
    else repetidasArchivo.push({ ...item, motivo: 'Repetido en el archivo' });
    if (!g.ruta && ruta) g.ruta = ruta;
    if (!g.cliente && cliente) g.cliente = cliente;
  }

  // 2. Comparar con lo ya cargado (Dexie tiene todo: se refresca al abrir el módulo)
  const ids = [...grupos.keys()];
  const previas = await localDb.toma_lotes.bulkGet(ids);
  const nuevas = [];
  const aActualizar = [];
  const yaExistentes = [];

  ids.forEach((id, k) => {
    const g = grupos.get(id);
    const previa = previas[k];
    if (!previa) {
      nuevas.push(g);
      return;
    }
    const tiene = new Set(previa.lotes || []);
    const faltan = g.lotes.filter((l) => !tiene.has(l));
    if (faltan.length) aActualizar.push({ ...g, lotesNuevos: faltan, lotesPrevios: (previa.lotes || []).length });
    else yaExistentes.push({ ...g, motivo: g.lotes.length ? 'Ya tiene esos lotes' : 'Ya existe' });
  });

  return { nuevas, aActualizar, repetidasArchivo, yaExistentes, invalidas, conLote };
};

/** Descarga una plantilla de ejemplo para la carga. */
export const descargarPlantillaTomaLotes = async () => {
  const XLSX = await import('xlsx');
  const hoja = XLSX.utils.aoa_to_sheet([
    ['Ruta', 'Cliente', 'Pedido', 'SKU', 'Lote'],
    ['R08', 'CLIENTE EJEMPLO S.A.C.', 311366, 'UU01263377', ''],
    ['R07', 'CLIENTE EJEMPLO S.A.C.', 315669, '7010040059', 'B26234'],
    ['R07', 'CLIENTE EJEMPLO S.A.C.', 315669, '7007070947', 'L9981, L9982'],
    ['R07', 'CLIENTE EJEMPLO S.A.C.', 315676, '7007031321', 'C55120'],
    ['R07', 'CLIENTE EJEMPLO S.A.C.', 315676, '7007031321', 'C55121'],
  ]);
  hoja['!cols'] = [8, 34, 12, 16, 24].map((wch) => ({ wch }));
  const libro = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(libro, hoja, 'Toma de Lotes');
  XLSX.writeFile(libro, 'Plantilla_Toma_Lotes.xlsx');
};

// ---------------------------------------------------------------------------
// Supabase
// ---------------------------------------------------------------------------
const subirFilasNuevas = async (filas) => {
  for (let i = 0; i < filas.length; i += BLOQUE) {
    const { error } = await supabase
      .from(TABLA)
      .upsert(filas.slice(i, i + BLOQUE).map(limpiar), { onConflict: 'id', ignoreDuplicates: true });
    if (error) throw error;
  }
};

/**
 * Adiciona lotes en el servidor SIN pisar los que otro ya registró:
 * lee la versión actual de cada fila, agrega solo los que faltan y guarda.
 * adiciones = [{ id, detalle: [{ lote, fecha, ... }] }]. Devuelve las filas resultantes.
 */
const agregarLotesRemoto = async (adiciones) => {
  const resultado = [];
  for (let i = 0; i < adiciones.length; i += BLOQUE_IDS) {
    const tramo = adiciones.slice(i, i + BLOQUE_IDS);
    const { data, error } = await supabase.from(TABLA).select('*').in('id', tramo.map((a) => a.id));
    if (error) throw error;
    const actuales = new Map((data || []).map((f) => [f.id, f]));
    const cambiadas = [];
    tramo.forEach((a) => {
      const actual = actuales.get(a.id);
      if (!actual) return;
      const fusion = fusionarLotes(actual, a.detalle);
      if (fusion) cambiadas.push(fusion);
      resultado.push(fusion || actual);
    });
    if (cambiadas.length) {
      const { error: e2 } = await supabase.from(TABLA).upsert(cambiadas, { onConflict: 'id' });
      if (e2) throw e2;
    }
  }
  return resultado;
};

/**
 * Sube lo hecho sin internet, en el orden en que se hizo:
 *   INSERT  → filas nuevas del Excel (si otro ya cargó el mismo pedido+SKU, se respeta el de él)
 *   AGREGAR → lotes adicionados desde Excel (solo los que faltan)
 *   UPSERT  → lotes registrados en el modal (gana el último)
 */
export const sincronizarTomaLotesPendientes = async () => {
  if (!navigator.onLine) return { synced: 0, failed: 0 };

  let synced = 0;
  let failed = 0;
  const pendientes = await localDb.sync_queue.filter((i) => i.tabla === TABLA).sortBy('id');

  for (const item of pendientes) {
    try {
      if (item.operacion === 'INSERT') {
        await subirFilasNuevas(item.payload?.filas || []);
      } else if (item.operacion === 'AGREGAR') {
        await agregarLotesRemoto(item.payload?.adiciones || []);
      } else {
        const { error } = await supabase.from(TABLA).upsert(limpiar(item.payload), { onConflict: 'id' });
        if (error) throw error;
      }
      await localDb.sync_queue.delete(item.id);
      synced++;
    } catch (err) {
      console.error('Error sincronizando toma de lotes:', err);
      failed++;
      break; // se respeta el orden: lo demás espera al próximo intento
    }
  }

  await marcarSincronizadas();
  return { synced, failed };
};

// Las filas locales sin nada pendiente en la cola ya están en Supabase
const marcarSincronizadas = async () => {
  const cola = await localDb.sync_queue.filter((i) => i.tabla === TABLA).toArray();
  const enCola = new Set();
  cola.forEach((i) => {
    if (i.operacion === 'INSERT') (i.payload?.filas || []).forEach((f) => enCola.add(f.id));
    else if (i.operacion === 'AGREGAR') (i.payload?.adiciones || []).forEach((a) => enCola.add(a.id));
    else if (i.payload?.id) enCola.add(i.payload.id);
  });
  const sinSubir = await localDb.toma_lotes.filter((f) => f._sincronizado === false).toArray();
  const listas = sinSubir.filter((f) => !enCola.has(f.id)).map((f) => ({ ...f, _sincronizado: true }));
  if (listas.length) await localDb.toma_lotes.bulkPut(listas);
};

/**
 * Descarga TODO de Supabase a Dexie (la pantalla lee de Dexie con useLiveQuery → instantáneo).
 * Respeta lo que aún no se sube y quita lo que ya no existe en el servidor.
 */
export const refrescarTomaLotes = async () => {
  if (!navigator.onLine) return { ok: false, offline: true };
  // Canal en vivo sin caídas desde la última descarga → Dexie ya está al día
  if (estaFresco(TABLA)) return { ok: true, cache: true };

  await sincronizarTomaLotesPendientes();

  const remotas = [];
  for (let desde = 0; ; desde += BLOQUE_LECTURA) {
    const { data, error } = await supabase
      .from(TABLA)
      .select('*')
      .order('fecha_registro', { ascending: false })
      .range(desde, desde + BLOQUE_LECTURA - 1);
    if (error) {
      console.warn('No se pudo descargar la toma de lotes, usando caché local:', error);
      return { ok: false, error };
    }
    remotas.push(...(data || []));
    if (!data || data.length < BLOQUE_LECTURA) break;
  }

  const locales = await localDb.toma_lotes.toArray();
  const sinSubir = new Set(locales.filter((f) => f._sincronizado === false).map((f) => f.id));
  const idsRemotos = new Set(remotas.map((f) => f.id));
  const borrar = locales.filter((f) => !sinSubir.has(f.id) && !idsRemotos.has(f.id)).map((f) => f.id);

  await localDb.transaction('rw', localDb.toma_lotes, async () => {
    if (borrar.length) await localDb.toma_lotes.bulkDelete(borrar);
    await localDb.toma_lotes.bulkPut(
      remotas.filter((f) => !sinSubir.has(f.id)).map((f) => ({ ...f, _sincronizado: true })),
    );
  });
  marcarFresco(TABLA);
  return { ok: true };
};

// ---------------------------------------------------------------------------
// Escrituras (online u offline)
// ---------------------------------------------------------------------------
/**
 * Aplica el análisis del Excel: crea los pedido+SKU nuevos y adiciona los lotes que faltan
 * a los que ya existían. Primero en Dexie (se ve al instante) y luego sube.
 */
export const importarExcelTomaLotes = async ({ nuevas, aActualizar }, usuario) => {
  const ahora = new Date().toISOString();
  const det = (lote) => ({
    lote,
    fecha: ahora,
    por_id: usuario?.id || null,
    por_nombre: usuario?.nombre || null,
    origen: 'EXCEL',
  });

  const filas = nuevas.map(({ id, ruta, cliente, pedido, sku, lotes }) => {
    const detalle = lotes.map(det);
    return {
      id,
      ruta,
      cliente,
      pedido,
      sku,
      lotes: detalle.map((d) => d.lote),
      lotes_detalle: detalle,
      registrado_por_id: usuario?.id || null,
      registrado_por_nombre: usuario?.nombre || null,
      fecha_registro: ahora,
      lotes_por_id: detalle.length ? usuario?.id || null : null,
      lotes_por_nombre: detalle.length ? usuario?.nombre || null : null,
      lotes_actualizado_en: detalle.length ? ahora : null,
    };
  });

  // Lotes a adicionar a filas existentes (y a las nuevas, por si otro las creó antes en el servidor)
  const adiciones = [
    ...aActualizar.map((a) => ({ id: a.id, detalle: a.lotesNuevos.map(det) })),
    ...filas.filter((f) => f.lotes_detalle.length).map((f) => ({ id: f.id, detalle: f.lotes_detalle })),
  ];

  // Vista local inmediata
  const previas = await localDb.toma_lotes.bulkGet(aActualizar.map((a) => a.id));
  const actualizadasLocal = aActualizar
    .map((a, k) => previas[k] && fusionarLotes(previas[k], a.lotesNuevos.map(det)))
    .filter(Boolean);
  await localDb.toma_lotes.bulkPut([
    ...filas.map((f) => ({ ...f, _sincronizado: false })),
    ...actualizadasLocal.map((f) => ({ ...f, _sincronizado: false })),
  ]);

  const resumen = {
    nuevas: filas.length,
    actualizadas: actualizadasLocal.length,
    lotes: adiciones.reduce((s, a) => s + a.detalle.length, 0),
    offline: false,
  };

  // Si hay algo pendiente en la cola, esto va detrás (el orden importa: primero se crean las filas)
  const hayPendientes = (await localDb.sync_queue.filter((i) => i.tabla === TABLA).count()) > 0;

  if (navigator.onLine && !hayPendientes) {
    try {
      if (filas.length) await subirFilasNuevas(filas);
      const finales = adiciones.length ? await agregarLotesRemoto(adiciones) : [];
      const porId = new Map(finales.map((f) => [f.id, f]));
      await localDb.toma_lotes.bulkPut([
        ...filas.map((f) => ({ ...(porId.get(f.id) || f), _sincronizado: true })),
        ...actualizadasLocal.map((f) => ({ ...(porId.get(f.id) || f), _sincronizado: true })),
      ]);
      return resumen;
    } catch (err) {
      console.warn('Fallo de red al cargar el Excel, queda pendiente de envío...', err);
    }
  }

  if (filas.length) await localDb.sync_queue.add({ tabla: TABLA, operacion: 'INSERT', payload: { filas } });
  if (adiciones.length) await localDb.sync_queue.add({ tabla: TABLA, operacion: 'AGREGAR', payload: { adiciones } });
  return { ...resumen, offline: true };
};

/**
 * Registra los lotes de un SKU desde el modal (reemplaza la lista completa).
 * detalle = [{ lote, fecha, por_id, por_nombre, origen }] con la fecha/hora de cada lote.
 */
export const guardarLotesSku = async (id, detalle, usuario) => {
  const previo = await localDb.toma_lotes.get(id);
  if (!previo) throw new Error('No se encontró el pedido/SKU.');

  const fila = {
    ...limpiar(previo),
    lotes: detalle.map((d) => d.lote),
    lotes_detalle: detalle,
    lotes_por_id: usuario?.id || null,
    lotes_por_nombre: usuario?.nombre || null,
    lotes_actualizado_en: new Date().toISOString(),
  };

  // Si la fila aún no llegó al servidor (o tiene algo en cola), todo va por la cola (respeta el orden)
  const insertPendiente =
    previo._sincronizado === false ||
    (await localDb.sync_queue.filter((i) => i.tabla === TABLA && i.operacion !== 'UPSERT').count()) > 0;

  await localDb.toma_lotes.put({ ...fila, _sincronizado: false });

  if (navigator.onLine && !insertPendiente) {
    try {
      const { error } = await supabase.from(TABLA).upsert(fila, { onConflict: 'id' });
      if (error) throw error;
      await localDb.toma_lotes.put({ ...fila, _sincronizado: true });
      return { offline: false };
    } catch (err) {
      console.warn('Fallo de red al guardar lotes, queda pendiente de envío...', err);
    }
  }

  // Solo se guarda la última versión de los lotes de este SKU
  const enCola = await localDb.sync_queue
    .filter((i) => i.tabla === TABLA && i.operacion === 'UPSERT' && i.payload?.id === id)
    .toArray();
  await localDb.sync_queue.bulkDelete(enCola.map((i) => i.id));
  await localDb.sync_queue.add({ tabla: TABLA, operacion: 'UPSERT', payload: fila });
  return { offline: true };
};

/** Aplica en Dexie un evento de tiempo real de 'toma_lotes'. */
export const registrarCambioRemotoTomaLotes = async (cambio) => {
  try {
    if (cambio.tipo === 'DELETE') {
      if (!cambio.anterior?.id) return false;
      await localDb.toma_lotes.delete(cambio.anterior.id);
      return true;
    }
    const fila = cambio.nuevo;
    if (!fila?.id) return false;
    const local = await localDb.toma_lotes.get(fila.id);
    if (local && local._sincronizado === false) return false; // gana lo local hasta que se suba
    await localDb.toma_lotes.put({ ...fila, _sincronizado: true });
    return true;
  } catch (err) {
    console.warn('No se pudo aplicar el cambio remoto de toma de lotes:', err);
    return false;
  }
};
