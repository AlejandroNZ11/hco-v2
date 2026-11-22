// =====================================================================
// LECTURA DE LOS EXCEL DEL MÓDULO GENERAR RDR
// 1) Excel de datos: FECHA | COSTO | SN | OBSERVACION | HORA | QTY | OBSERVACION | OBD
// 2) Excel de fotos: hojas Transferencia_Imagenes, aereos y Abollados
// =====================================================================
import * as XLSX from 'xlsx';

const pad = (n) => String(n).padStart(2, '0');

const normalizarTexto = (v) =>
  String(v ?? '')
    .toUpperCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

const textoCelda = (v) => {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return String(v);
  return String(v).replace(/\s+/g, ' ').trim(); // \s incluye el espacio duro (NBSP) de Excel
};

// ---------- Fechas y horas ----------

// Número de serie de Excel (días desde 1899-12-30) → fecha
const fechaDesdeSerial = (serial) => {
  if (!Number.isFinite(serial) || serial < 1) return null;
  const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(serial) * 86400000);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + 1;
  const dia = d.getUTCDate();
  return { iso: `${y}-${pad(m)}-${pad(dia)}`, texto: `${pad(dia)}/${pad(m)}/${y}` };
};

export const normalizarFecha = (valor) => {
  if (valor === null || valor === undefined || valor === '') return { iso: '', texto: '' };
  if (typeof valor === 'number') return fechaDesdeSerial(valor) || { iso: '', texto: String(valor) };
  if (valor instanceof Date && !Number.isNaN(valor.getTime())) {
    const y = valor.getFullYear();
    return { iso: `${y}-${pad(valor.getMonth() + 1)}-${pad(valor.getDate())}`, texto: `${pad(valor.getDate())}/${pad(valor.getMonth() + 1)}/${y}` };
  }
  const s = String(valor).trim();
  let m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/); // dd/mm/yyyy
  if (m) return { iso: `${m[3]}-${pad(m[2])}-${pad(m[1])}`, texto: `${pad(m[1])}/${pad(m[2])}/${m[3]}` };
  m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/); // yyyy-mm-dd
  if (m) return { iso: `${m[1]}-${pad(m[2])}-${pad(m[3])}`, texto: `${pad(m[3])}/${pad(m[2])}/${m[1]}` };
  return { iso: '', texto: s };
};

// Hora en formato "05:54:00 p. m." (igual que el Excel de origen)
export const normalizarHora = (valor) => {
  if (valor === null || valor === undefined || valor === '') return '';
  if (typeof valor === 'number') {
    const totalSeg = Math.round((valor % 1) * 86400);
    const h24 = Math.floor(totalSeg / 3600) % 24;
    const min = Math.floor((totalSeg % 3600) / 60);
    const seg = totalSeg % 60;
    const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
    return `${pad(h12)}:${pad(min)}:${pad(seg)} ${h24 < 12 ? 'a. m.' : 'p. m.'}`;
  }
  if (valor instanceof Date) return normalizarHora((valor.getHours() * 3600 + valor.getMinutes() * 60 + valor.getSeconds()) / 86400);
  return String(valor).trim();
};

// Costo: siempre texto, sin ".0" de Excel
const normalizarCosto = (v) => textoCelda(v).replace(/\.0+$/, '');

// ---------- 1) Excel de datos ----------

const leerLibro = async (file) => {
  const buffer = await file.arrayBuffer();
  return XLSX.read(buffer, { type: 'array', cellDates: false });
};

/**
 * Lee el Excel de carga y devuelve las filas normalizadas.
 * @returns {Promise<{ hoja:string, filas:Array, errores:Array<string>, advertencias:Array<string> }>}
 */
export const leerExcelDatosRdr = async (file) => {
  const wb = await leerLibro(file);

  // Preferir la hoja REPORTE; si no existe, la primera que tenga las cabeceras
  const ordenHojas = [
    ...wb.SheetNames.filter((n) => normalizarTexto(n) === 'REPORTE'),
    ...wb.SheetNames.filter((n) => normalizarTexto(n) !== 'REPORTE'),
  ];

  for (const nombreHoja of ordenHojas) {
    const hoja = wb.Sheets[nombreHoja];
    if (!hoja['!ref']) continue;
    const filaInicial = XLSX.utils.decode_range(hoja['!ref']).s.r; // para reportar el n° de fila real
    const filasHoja = XLSX.utils.sheet_to_json(hoja, { header: 1, raw: true, defval: '', blankrows: true });

    const idxCabecera = filasHoja.findIndex((fila) => {
      const t = fila.map(normalizarTexto);
      return t.includes('FECHA') && t.includes('COSTO') && t.includes('SN');
    });
    if (idxCabecera === -1) continue;

    const cab = filasHoja[idxCabecera].map(normalizarTexto);
    const col = (nombre, ocurrencia = 0) => {
      let encontradas = -1;
      for (let i = 0; i < cab.length; i++) {
        if (cab[i] === nombre && ++encontradas === ocurrencia) return i;
      }
      return -1;
    };
    const c = {
      fecha: col('FECHA'),
      costo: col('COSTO'),
      sn: col('SN'),
      observacion: col('OBSERVACION'),
      hora: col('HORA'),
      qty: col('QTY'),
      codigo: col('OBSERVACION', 1),
      obd: col('OBD'),
    };
    const val = (fila, k) => (c[k] >= 0 ? fila[c[k]] : '');

    const filas = [];
    const errores = [];
    const advertencias = [];

    for (let i = idxCabecera + 1; i < filasHoja.length; i++) {
      const fila = filasHoja[i];
      const numFila = filaInicial + i + 1;
      const costo = normalizarCosto(val(fila, 'costo'));
      const sn = textoCelda(val(fila, 'sn'));
      const vacia = fila.every((v) => textoCelda(v) === '');
      if (vacia) continue;

      if (!costo) {
        errores.push(`Fila ${numFila}: sin COSTO (SN ${sn || '-'}).`);
        continue;
      }

      const fecha = normalizarFecha(val(fila, 'fecha'));
      if (!fecha.iso) advertencias.push(`Fila ${numFila}: FECHA vacía o no reconocida (costo ${costo}).`);
      if (!sn) advertencias.push(`Fila ${numFila}: SN vacío (costo ${costo}).`);

      filas.push({
        numFila,
        fecha: fecha.iso,
        fecha_texto: fecha.texto,
        costo,
        sn,
        observacion: textoCelda(val(fila, 'observacion')),
        hora: normalizarHora(val(fila, 'hora')),
        qty: textoCelda(val(fila, 'qty')),
        codigo: textoCelda(val(fila, 'codigo')),
        obd: textoCelda(val(fila, 'obd')),
      });
    }

    return { hoja: nombreHoja, filas, errores, advertencias };
  }

  throw new Error('No se encontró una hoja con las cabeceras FECHA, COSTO y SN.');
};

/** Descarga un Excel vacío con las cabeceras de carga */
export const descargarFormatoCarga = () => {
  const ws = XLSX.utils.aoa_to_sheet([
    ['FECHA', 'COSTO', 'SN', 'OBSERVACION', 'HORA', 'QTY', 'OBSERVACION', 'OBD'],
    ['11/11/2026', '9356', '7007040578', 'ABOLLADO', '05:54:00 p. m.', '40 EACH', '200', ''],
  ]);
  ws['!cols'] = [12, 8, 14, 14, 14, 12, 14, 12].map((wch) => ({ wch }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'REPORTE');
  XLSX.writeFile(wb, 'Formato_Carga_RDR.xlsx');
};

// ---------- 2) Excel de fotos ----------

const col = (letra) => XLSX.utils.decode_col(letra);

export const HOJAS_FOTOS = [
  { nombre: 'Transferencia_Imagenes', etiqueta: 'Transferencia', costo: col('D'), desde: col('F'), hasta: col('S') },
  { nombre: 'aereos', etiqueta: 'Aéreos', costo: col('C'), desde: col('F'), hasta: col('P') },
  { nombre: 'Abollados', etiqueta: 'Abollados', costo: col('C'), desde: col('E'), hasta: col('J'), sku: col('D') },
];

/**
 * Busca en un texto el costo de 4 dígitos, si existe en los RDR generados.
 * Ej: "8804_Qty: 24" → 8804 | "8795, QTY 3 RLS" → 8795 | "2026-11-05T:9397" → 9397
 */
export const extraerCostos = (texto, costosValidos) => {
  const limpio = String(texto ?? '')
    .replace(/\d{4}-\d{1,2}-\d{1,2}T?/g, ' ') // quita fechas tipo 2026-11-05T
    .replace(/\d{1,2}\/\d{1,2}\/\d{4}/g, ' ')
    .replace(/(?<!\d)\d{1,2}:\d{2}(:\d{2})?(?!\d)/g, ' '); // quita horas 10:01:00
  // El costo siempre va primero ("8817 QTY 1152 EACH" → 8817, no 1152)
  const primero = (limpio.match(/(?<!\d)\d{4}(?!\d)/) || [])[0];
  return primero && costosValidos.has(primero) ? [primero] : [];
};

const urlDeCelda = (celda) => {
  if (!celda) return '';
  const enlace = celda.l?.Target;
  if (enlace && /^https?:\/\//i.test(enlace)) return enlace.trim();
  const v = textoCelda(celda.v);
  const m = v.match(/https?:\/\/\S+/i);
  return m ? m[0] : '';
};

// ---------- SKU de Abollados ----------

// Ej: "MN90010437 = 114" → MN90010437 | "7000614983=3" → 7000614983
const RE_SKU_CON_CANTIDAD = /^\s*([A-Za-z0-9]{6,15})\s*[=:]\s*[\d.,]+/;

const limpiarSku = (texto) => {
  const t = textoCelda(texto);
  if (!t || /^https?:\/\//i.test(t)) return '';
  const conCantidad = t.match(RE_SKU_CON_CANTIDAD);
  if (conCantidad) return conCantidad[1].slice(0, 10).toUpperCase();
  return t.replace(/\s+/g, '').slice(0, 10).toUpperCase(); // los primeros 10 caracteres
};

// Columna con título "SKU" en las primeras filas (si la hoja tiene cabecera)
const buscarColumnaSku = (ws, rango) => {
  for (let r = rango.s.r; r <= Math.min(rango.s.r + 4, rango.e.r); r++) {
    for (let c = rango.s.c; c <= rango.e.c; c++) {
      const v = normalizarTexto(ws[XLSX.utils.encode_cell({ r, c })]?.v);
      if (v === 'SKU' || v.startsWith('SKU ')) return c;
    }
  }
  return -1;
};

/**
 * SKU de una fila de Abollados. Orden:
 * 1) columna con título SKU, 2) columna D, 3) cualquier celda de la fila con forma "SKU = cantidad".
 */
const obtenerSku = (ws, r, conf, colCabecera, rango) => {
  const celda = (c) => ws[XLSX.utils.encode_cell({ r, c })]?.v;

  if (colCabecera >= 0) {
    const s = limpiarSku(celda(colCabecera));
    if (s && normalizarTexto(s) !== 'SKU') return s;
  }
  const deS = limpiarSku(celda(conf.sku));
  if (deS) return deS;

  for (let c = rango.s.c; c <= rango.e.c; c++) {
    if (c === conf.costo || (c >= conf.desde && c <= conf.hasta)) continue;
    const m = textoCelda(celda(c)).match(RE_SKU_CON_CANTIDAD);
    if (m) return m[1].slice(0, 10).toUpperCase();
  }
  return '';
};

/**
 * Lee el Excel de fotos y agrupa las URL por costo.
 * @param {File} file
 * @param {Set<string>} costosValidos - costos de los RDR generados
 * @returns {Promise<{ porCosto: Map<string, Array<{url,origen,sku,fila}>>, hojasLeidas:string[], hojasFaltantes:string[], filasSinCosto:number, totalFotos:number }>}
 */
export const leerExcelFotosRdr = async (file, costosValidos) => {
  const wb = await leerLibro(file);
  const porCosto = new Map();
  const hojasLeidas = [];
  const hojasFaltantes = [];
  let filasSinCosto = 0;
  let totalFotos = 0;
  let fotosSinSku = 0;

  for (const conf of HOJAS_FOTOS) {
    const nombreReal = wb.SheetNames.find((n) => normalizarTexto(n) === normalizarTexto(conf.nombre));
    if (!nombreReal) {
      hojasFaltantes.push(conf.nombre);
      continue;
    }
    hojasLeidas.push(nombreReal);

    const ws = wb.Sheets[nombreReal];
    if (!ws['!ref']) continue;
    const rango = XLSX.utils.decode_range(ws['!ref']);
    const colSkuCabecera = conf.sku !== undefined ? buscarColumnaSku(ws, rango) : -1;

    for (let r = rango.s.r; r <= rango.e.r; r++) {
      const celdaCosto = ws[XLSX.utils.encode_cell({ r, c: conf.costo })];
      const costos = extraerCostos(celdaCosto ? textoCelda(celdaCosto.v) : '', costosValidos);

      const urls = [];
      for (let c = conf.desde; c <= conf.hasta; c++) {
        const url = urlDeCelda(ws[XLSX.utils.encode_cell({ r, c })]);
        if (url) urls.push(url);
      }
      if (urls.length === 0) continue;
      if (costos.length === 0) {
        filasSinCosto++;
        continue;
      }

      const sku = conf.sku !== undefined ? obtenerSku(ws, r, conf, colSkuCabecera, rango) : '';
      if (conf.sku !== undefined && !sku) fotosSinSku += urls.length;

      costos.forEach((costo) => {
        if (!porCosto.has(costo)) porCosto.set(costo, []);
        const lista = porCosto.get(costo);
        urls.forEach((url) => {
          if (lista.some((f) => f.url === url)) return;
          lista.push({ url, origen: conf.etiqueta, hoja: nombreReal, sku, fila: r + 1 });
          totalFotos++;
        });
      });
    }
  }

  return { porCosto, hojasLeidas, hojasFaltantes, filasSinCosto, totalFotos, fotosSinSku };
};
