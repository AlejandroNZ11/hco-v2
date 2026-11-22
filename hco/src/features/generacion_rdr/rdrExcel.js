// =====================================================================
// GENERADOR DE REPORTES RDR (versión web de la macro GenerarReportesDiscrepancias)
// ---------------------------------------------------------------------
// Trabaja directo sobre el XML de plantilla_rdr.xlsx para NO alterar su diseño:
// solo escribe valores, agrega filas de detalle (copias de las filas 74-75) y pega fotos.
// - Una hoja por COSTO.
// - H7 = FECHA, H15 = HORA (del primer registro del costo).
// - Desde la fila 24, de 2 en 2: B = OBSERVACION, J = SN, P = CÓDIGO, Y = QTY.
// - Si hay más de 26 líneas, inserta pares de filas iguales a la 74-75 y baja la leyenda.
// - Fotos al costado del formato, desde la columna AN.
// Este archivo no depende de React: recibe JSZip y la plantilla como parámetros.
// =====================================================================

export const FILA_INICIO_DETALLE = 24;
export const PASO_FILAS = 2;
export const FILAS_DETALLE_PLANTILLA = 26; // pares de filas 24..75
const FILA_MODELO = 74; // par 74-75: modelo para las filas extra
const FILA_FIN_DETALLE = 75;

// Fotos
const COL_FOTOS = 40; // AN
const FILA_TITULO_FOTOS = 2;
const FOTOS_POR_FILA = 2;
const FOTO_ANCHO_MAX = 190; // px
const FOTO_ALTO_MAX = 210; // px
const SEPARACION_PX = 10;
const ALTO_MIN_ETIQUETA_PX = 15; // fila donde va el texto de cada foto
const EMU_POR_PX = 9525;

const NS_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const TIPO_HOJA = `${NS_REL}/worksheet`;
const TIPO_DRAWING = `${NS_REL}/drawing`;
const TIPO_IMAGEN = `${NS_REL}/image`;
const TIPO_PRINTER = `${NS_REL}/printerSettings`;

// ---------- utilidades ----------

const escaparXml = (v) =>
  String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    // Excel no acepta caracteres de control en el XML
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, ''); // eslint-disable-line no-control-regex

export const colANumero = (letras) =>
  letras.split('').reduce((acc, ch) => acc * 26 + (ch.charCodeAt(0) - 64), 0);

export const numeroACol = (n) => {
  let s = '';
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
};

// Excel no permite estos caracteres en el nombre de una hoja (máx. 31 caracteres)
export const nombreHojaSeguro = (texto, usados = new Set()) => {
  const base = String(texto || 'RDR').replace(/[[\]:*?/\\]/g, '_').trim().slice(0, 31) || 'RDR';
  let nombre = base;
  let n = 2;
  while (usados.has(nombre.toUpperCase())) {
    const sufijo = ` (${n++})`;
    nombre = base.slice(0, 31 - sufijo.length) + sufijo;
  }
  usados.add(nombre.toUpperCase());
  return nombre;
};

// ---------- modelo de la hoja (filas y celdas) ----------

const parsearHoja = (xml) => {
  const inicio = xml.indexOf('<sheetData');
  const finTag = xml.indexOf('>', inicio);
  const cierre = xml.indexOf('</sheetData>');
  const autocerrado = xml[finTag - 1] === '/';
  const cuerpo = autocerrado ? '' : xml.slice(finTag + 1, cierre);

  const filas = new Map();
  const reFila = /<row\b([^>]*?)(\/>|>([\s\S]*?)<\/row>)/g;
  let m;
  while ((m = reFila.exec(cuerpo))) {
    const attrs = m[1];
    const r = Number(attrs.match(/\br="(\d+)"/)[1]);
    const resto = attrs.replace(/\s*\br="\d+"/, '').replace(/\s*\bspans="[^"]*"/, '');
    const celdas = new Map();
    const reCelda = /<c\b([^>]*?)(\/>|>([\s\S]*?)<\/c>)/g;
    let c;
    while ((c = reCelda.exec(m[3] || ''))) {
      const ref = c[1].match(/\br="([A-Z]+)\d+"/)[1];
      celdas.set(colANumero(ref), {
        attrs: c[1].replace(/\s*\br="[A-Z]+\d+"/, ''),
        interior: c[3] ?? null,
      });
    }
    filas.set(r, { attrs: resto, celdas });
  }

  const merges = [...xml.matchAll(/<mergeCell ref="([^"]+)"\/>/g)].map((x) => x[1]);
  return {
    antes: xml.slice(0, inicio),
    despues: xml.slice(autocerrado ? finTag + 1 : cierre + '</sheetData>'.length),
    filas,
    merges,
  };
};

const serializarFilas = (filas) => {
  let out = '<sheetData>';
  [...filas.keys()].sort((a, b) => a - b).forEach((r) => {
    const fila = filas.get(r);
    const celdas = [...fila.celdas.keys()].sort((a, b) => a - b);
    if (celdas.length === 0) {
      out += `<row r="${r}"${fila.attrs}/>`;
      return;
    }
    out += `<row r="${r}"${fila.attrs}>`;
    celdas.forEach((col) => {
      const c = fila.celdas.get(col);
      const ref = `${numeroACol(col)}${r}`;
      out += c.interior === null
        ? `<c r="${ref}"${c.attrs}/>`
        : `<c r="${ref}"${c.attrs}>${c.interior}</c>`;
    });
    out += '</row>';
  });
  return `${out}</sheetData>`;
};

const desplazarRango = (ref, desdeFila, delta) =>
  ref.replace(/([A-Z]+)(\d+)/g, (_, col, fila) => {
    const n = Number(fila);
    return `${col}${n >= desdeFila ? n + delta : n}`;
  });

const clonarFila = (fila) => ({
  attrs: fila.attrs,
  celdas: new Map([...fila.celdas].map(([k, v]) => [k, { ...v }])),
});

const obtenerFila = (hoja, r) => {
  if (!hoja.filas.has(r)) hoja.filas.set(r, { attrs: '', celdas: new Map() });
  return hoja.filas.get(r);
};

const estiloDe = (attrs) => (attrs.match(/\bs="(\d+)"/) || [])[1];

// Escribe texto en la celda conservando su estilo (s="...") de la plantilla
const escribirTexto = (hoja, r, col, valor, estilo) => {
  const fila = obtenerFila(hoja, r);
  const actual = fila.celdas.get(col);
  const s = estilo ?? (actual ? estiloDe(actual.attrs) : undefined);
  fila.celdas.set(col, {
    attrs: `${s ? ` s="${s}"` : ''} t="inlineStr"`,
    interior: `<is><t xml:space="preserve">${escaparXml(valor)}</t></is>`,
  });
};

const escribirHipervinculo = (hoja, r, col, url, texto, estilo) => {
  const fila = obtenerFila(hoja, r);
  const f = `HYPERLINK("${String(url).replace(/"/g, '""')}","${String(texto).replace(/"/g, '""')}")`;
  fila.celdas.set(col, {
    attrs: `${estilo ? ` s="${estilo}"` : ''} t="str"`,
    interior: `<f>${escaparXml(f)}</f><v>${escaparXml(texto)}</v>`,
  });
};

// ---------- filas extra del detalle ----------

const agregarFilasDetalle = (hoja, paresExtra) => {
  if (paresExtra <= 0) return;
  const delta = paresExtra * PASO_FILAS;
  const desde = FILA_FIN_DETALLE + 1;

  // 1. Bajar todo lo que está debajo del detalle (leyenda)
  const nuevas = new Map();
  hoja.filas.forEach((fila, r) => nuevas.set(r >= desde ? r + delta : r, fila));
  hoja.filas = nuevas;
  hoja.merges = hoja.merges.map((ref) => desplazarRango(ref, desde, delta));

  // 2. Copiar el par 74-75 en los huecos y combinar sus celdas igual que el modelo
  const modeloA = hoja.filas.get(FILA_MODELO);
  const modeloB = hoja.filas.get(FILA_MODELO + 1);
  const mergesModelo = hoja.merges.filter((ref) => {
    const m = ref.match(/^[A-Z]+(\d+):[A-Z]+(\d+)$/);
    return m && Number(m[1]) === FILA_MODELO && Number(m[2]) === FILA_MODELO + 1;
  });

  for (let i = 0; i < paresExtra; i++) {
    const r = desde + i * PASO_FILAS;
    if (modeloA) hoja.filas.set(r, clonarFila(modeloA));
    if (modeloB) hoja.filas.set(r + 1, clonarFila(modeloB));
    mergesModelo.forEach((ref) => {
      hoja.merges.push(
        ref.replace(/([A-Z]+)(\d+)/g, (_, col, fila) => `${col}${Number(fila) - FILA_MODELO + r}`)
      );
    });
  }
};

// ---------- fotos ----------

const anchosColumnas = (xmlAntes) => {
  const anchos = new Map();
  const def = Number((xmlAntes.match(/defaultColWidth="([\d.]+)"/) || [])[1] || 8.43);
  for (const m of xmlAntes.matchAll(/<col\b([^>]*)\/>/g)) {
    const a = m[1];
    const min = Number(a.match(/min="(\d+)"/)[1]);
    const max = Number(a.match(/max="(\d+)"/)[1]);
    const w = a.includes('hidden="1"') ? 0 : Number((a.match(/width="([\d.]+)"/) || [])[1] || def);
    for (let c = min; c <= Math.min(max, 400); c++) anchos.set(c, w);
  }
  return (col) => {
    const w = anchos.has(col) ? anchos.get(col) : def;
    return w === 0 ? 0 : Math.trunc(w * 7 + 5);
  };
};

const altoFilaPx = (hoja, defPt) => (r) => {
  const fila = hoja.filas.get(r);
  const ht = fila ? Number((fila.attrs.match(/\bht="([\d.]+)"/) || [])[1] || defPt) : defPt;
  return Math.round((ht * 96) / 72);
};

// Convierte un desplazamiento en px desde una columna inicial a { col (0-based), off (EMU) }
const posicionX = (anchoCol, colInicio, xPx) => {
  let col = colInicio;
  let x = xPx;
  while (x >= anchoCol(col) && anchoCol(col) > 0) {
    x -= anchoCol(col);
    col++;
  }
  return { col: col - 1, off: Math.round(x * EMU_POR_PX) };
};

const xmlAnclaImagen = (idx, relId, { col, colOff, fila, ancho, alto, nombre }) =>
  `<xdr:oneCellAnchor><xdr:from><xdr:col>${col}</xdr:col><xdr:colOff>${colOff}</xdr:colOff>` +
  `<xdr:row>${fila}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from>` +
  `<xdr:ext cx="${ancho * EMU_POR_PX}" cy="${alto * EMU_POR_PX}"/>` +
  `<xdr:pic><xdr:nvPicPr><xdr:cNvPr id="${idx + 2}" name="${escaparXml(nombre)}"/>` +
  `<xdr:cNvPicPr><a:picLocks noChangeAspect="1"/></xdr:cNvPicPr></xdr:nvPicPr>` +
  `<xdr:blipFill><a:blip xmlns:r="${NS_REL}" r:embed="${relId}"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill>` +
  `<xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${ancho * EMU_POR_PX}" cy="${alto * EMU_POR_PX}"/></a:xfrm>` +
  `<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:ln w="9525"><a:solidFill><a:srgbClr val="D9D9D9"/></a:solidFill></a:ln></xdr:spPr>` +
  `</xdr:pic><xdr:clientData/></xdr:oneCellAnchor>`;

/**
 * Ubica las fotos al costado del formato (desde AN), 2 por fila y juntas.
 * Devuelve las anclas para el drawing; las etiquetas se escriben como celdas.
 */
const ubicarFotos = (hoja, grupo, { anchoCol, altoFila, estiloTitulo }) => {
  const fotos = grupo.fotos || [];
  if (fotos.length === 0) return [];

  escribirTexto(hoja, FILA_TITULO_FOTOS, COL_FOTOS, `REGISTRO FOTOGRÁFICO - COSTO ${grupo.costo}`, estiloTitulo);

  // Ancho de casillero: lo que ocupan las columnas enteras más cercanas a FOTO_ANCHO_MAX
  const xCasillero = [0];
  let x = 0;
  let col = COL_FOTOS;
  for (let j = 1; j < FOTOS_POR_FILA; j++) {
    let usado = 0;
    while (usado < FOTO_ANCHO_MAX + SEPARACION_PX) usado += anchoCol(col++);
    x += usado;
    xCasillero.push(x);
  }

  const anclas = [];
  let filaEtiqueta = FILA_TITULO_FOTOS + 2;

  for (let i = 0; i < fotos.length; i += FOTOS_POR_FILA) {
    const lote = fotos.slice(i, i + FOTOS_POR_FILA);
    let altoLote = 0;

    lote.forEach((foto, j) => {
      const pos = posicionX(anchoCol, COL_FOTOS, xCasillero[j]);
      const colEtiqueta = pos.col + 1;
      if (foto.buffer) {
        escribirTexto(hoja, filaEtiqueta, colEtiqueta, foto.etiqueta || '', estiloTitulo);
        const escala = Math.min(FOTO_ANCHO_MAX / foto.width, FOTO_ALTO_MAX / foto.height, 1);
        const ancho = Math.max(1, Math.round(foto.width * escala));
        const alto = Math.max(1, Math.round(foto.height * escala));
        altoLote = Math.max(altoLote, alto);
        anclas.push({ foto, col: pos.col, colOff: pos.off, fila: filaEtiqueta, ancho, alto });
      } else {
        escribirTexto(hoja, filaEtiqueta, colEtiqueta, foto.etiqueta || '', estiloTitulo);
        escribirHipervinculo(hoja, filaEtiqueta + 1, colEtiqueta, foto.url, 'Abrir foto (no se pudo descargar)');
        altoLote = Math.max(altoLote, 34);
      }
    });

    // Siguiente fila de fotos: debajo de la foto más alta del lote, en una fila con
    // altura suficiente para que la etiqueta se lea (la plantilla tiene filas muy bajas)
    let r = filaEtiqueta + 1;
    let acumulado = 0;
    while (acumulado < altoLote) acumulado += altoFila(r++);
    r++;
    while (altoFila(r) < ALTO_MIN_ETIQUETA_PX) r++;
    filaEtiqueta = r;
  }

  return anclas;
};

// ---------- libro ----------

const reemplazarSheetsWorkbook = (xml, hojas) => {
  const sheets = hojas
    .map((h, i) => `<sheet name="${escaparXml(h.nombre)}" sheetId="${i + 1}" r:id="${h.relId}"/>`)
    .join('');
  return xml
    .replace(/<sheets>[\s\S]*?<\/sheets>/, `<sheets>${sheets}</sheets>`)
    .replace(/<definedNames>[\s\S]*?<\/definedNames>/, '')
    .replace(/(<workbookView\b[^>]*?)\s+activeTab="\d+"/, '$1');
};

/**
 * Construye un libro con una hoja por cada grupo (costo) a partir de la plantilla.
 * @param {Object} p
 * @param {any} p.JSZip - módulo jszip
 * @param {ArrayBuffer} p.plantillaBuffer - contenido de plantilla_rdr.xlsx
 * @param {Array} p.grupos - [{ costo, filas:[{fecha_texto,hora,sn,observacion,qty,codigo}], fotos:[{etiqueta,buffer,width,height,url}] }]
 * @returns {Promise<ArrayBuffer>} archivo .xlsx
 */
export const construirLibroRdr = async ({ JSZip, plantillaBuffer, grupos }) => {
  const zip = await JSZip.loadAsync(plantillaBuffer);

  // Ubicar la hoja de la plantilla
  const wbRels = await zip.file('xl/_rels/workbook.xml.rels').async('string');
  const relHoja = [...wbRels.matchAll(/<Relationship\b[^>]*\/>/g)].map((m) => m[0]).find((r) => r.includes(TIPO_HOJA));
  const rutaHoja = `xl/${relHoja.match(/Target="([^"]+)"/)[1].replace(/^\/?xl\//, '')}`;
  const nombreArchivoHoja = rutaHoja.split('/').pop();
  const rutaRelsHoja = rutaHoja.replace(nombreArchivoHoja, `_rels/${nombreArchivoHoja}.rels`);

  const xmlHojaBase = await zip.file(rutaHoja).async('string');
  const relsHojaBase = zip.file(rutaRelsHoja) ? await zip.file(rutaRelsHoja).async('string') : '';
  const printerTarget = (relsHojaBase.match(new RegExp(`Type="${TIPO_PRINTER}"[^>]*Target="([^"]+)"`)) ||
    relsHojaBase.match(new RegExp(`Target="([^"]+)"[^>]*Type="${TIPO_PRINTER}"`)) || [])[1];
  const printerRuta = printerTarget ? `xl/${printerTarget.replace(/^\.\.\//, '')}` : null;
  const printerBin = printerRuta && zip.file(printerRuta) ? await zip.file(printerRuta).async('uint8array') : null;

  // Estilo para títulos de fotos: el de "RDR Header Information" de la plantilla
  const base = parsearHoja(xmlHojaBase);
  let estiloTitulo;
  const sharedStrings = zip.file('xl/sharedStrings.xml') ? await zip.file('xl/sharedStrings.xml').async('string') : '';
  const indiceTitulo = [...sharedStrings.matchAll(/<si>([\s\S]*?)<\/si>/g)]
    .findIndex((m) => m[1].replace(/<[^>]+>/g, '').trim() === 'RDR Header Information');
  if (indiceTitulo >= 0) {
    base.filas.forEach((fila) => fila.celdas.forEach((c) => {
      if (!estiloTitulo && / t="s"/.test(c.attrs) && c.interior === `<v>${indiceTitulo}</v>`) estiloTitulo = estiloDe(c.attrs);
    }));
  }
  const defPt = Number((xmlHojaBase.match(/defaultRowHeight="([\d.]+)"/) || [])[1] || 12.75);

  // Quitar la hoja original: se crea una por costo
  zip.remove(rutaHoja);
  if (zip.file(rutaRelsHoja)) zip.remove(rutaRelsHoja);
  if (printerRuta) zip.remove(printerRuta);

  let ctypes = await zip.file('[Content_Types].xml').async('string');
  ctypes = ctypes.replace(/<Override PartName="\/xl\/worksheets\/[^"]+"[^>]*\/>/g, '');
  if (!/Extension="jpeg"/i.test(ctypes)) {
    ctypes = ctypes.replace('<Default ', '<Default Extension="jpeg" ContentType="image/jpeg"/><Default ');
  }

  let relsLibro = wbRels.replace(/<Relationship\b[^>]*\/>/g, (r) => (r.includes(TIPO_HOJA) ? '' : r));
  const usados = new Set();
  const hojas = [];
  let numImagen = 0;

  grupos.forEach((grupo, idx) => {
    const n = idx + 1;
    const nombre = nombreHojaSeguro(grupo.costo, usados);
    const hoja = parsearHoja(xmlHojaBase);
    const anchoCol = anchosColumnas(hoja.antes);

    // Datos (igual que la macro)
    const primero = grupo.filas[0] || {};
    escribirTexto(hoja, 7, colANumero('H'), primero.fecha_texto || '');
    escribirTexto(hoja, 15, colANumero('H'), primero.hora || '');

    agregarFilasDetalle(hoja, grupo.filas.length - FILAS_DETALLE_PLANTILLA);
    grupo.filas.forEach((fila, i) => {
      const r = FILA_INICIO_DETALLE + i * PASO_FILAS;
      escribirTexto(hoja, r, colANumero('B'), fila.observacion || '');
      escribirTexto(hoja, r, colANumero('J'), fila.sn || '');
      escribirTexto(hoja, r, colANumero('P'), fila.codigo || '');
      escribirTexto(hoja, r, colANumero('Y'), fila.qty || '');
    });

    const anclas = ubicarFotos(hoja, grupo, { anchoCol, altoFila: altoFilaPx(hoja, defPt), estiloTitulo });

    // Armar el XML de la hoja
    const maxFila = Math.max(...hoja.filas.keys());
    let antes = hoja.antes
      .replace(/<dimension ref="[^"]*"\/>/, `<dimension ref="A1:${numeroACol(Math.max(50, COL_FOTOS + 12))}${maxFila}"/>`)
      .replace(/<selection\b[^>]*\/>/, '<selection activeCell="A1" sqref="A1"/>');
    if (idx > 0) antes = antes.replace(/\s+tabSelected="1"/, '');

    const mergesXml = `<mergeCells count="${hoja.merges.length}">${hoja.merges.map((m) => `<mergeCell ref="${m}"/>`).join('')}</mergeCells>`;
    let despues = hoja.despues.replace(/<mergeCells\b[\s\S]*?<\/mergeCells>/, mergesXml);

    const relsHoja = [];
    if (printerBin) {
      zip.file(`xl/printerSettings/printerSettings${n}.bin`, printerBin);
      relsHoja.push(`<Relationship Id="rId1" Type="${TIPO_PRINTER}" Target="../printerSettings/printerSettings${n}.bin"/>`);
    } else {
      despues = despues.replace(/\s+r:id="rId1"/, '');
    }

    if (anclas.length > 0) {
      const relsDrawing = [];
      const anclasXml = anclas.map((a, k) => {
        numImagen++;
        zip.file(`xl/media/rdr_imagen${numImagen}.jpeg`, a.foto.buffer);
        relsDrawing.push(`<Relationship Id="rId${k + 1}" Type="${TIPO_IMAGEN}" Target="../media/rdr_imagen${numImagen}.jpeg"/>`);
        return xmlAnclaImagen(k, `rId${k + 1}`, { ...a, nombre: `Foto ${k + 1}` });
      }).join('');

      zip.file(
        `xl/drawings/drawing${n}.xml`,
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" ' +
        'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">' + anclasXml + '</xdr:wsDr>'
      );
      zip.file(
        `xl/drawings/_rels/drawing${n}.xml.rels`,
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${relsDrawing.join('')}</Relationships>`
      );
      relsHoja.push(`<Relationship Id="rIdDr1" Type="${TIPO_DRAWING}" Target="../drawings/drawing${n}.xml"/>`);
      despues = despues.replace('</worksheet>', '<drawing r:id="rIdDr1"/></worksheet>');
      ctypes = ctypes.replace(
        '</Types>',
        `<Override PartName="/xl/drawings/drawing${n}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/></Types>`
      );
    }

    zip.file(`xl/worksheets/sheet${n}.xml`, antes + serializarFilas(hoja.filas) + despues);
    if (relsHoja.length > 0) {
      zip.file(
        `xl/worksheets/_rels/sheet${n}.xml.rels`,
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${relsHoja.join('')}</Relationships>`
      );
    }

    const relId = `rIdHoja${n}`;
    relsLibro = relsLibro.replace('</Relationships>', `<Relationship Id="${relId}" Type="${TIPO_HOJA}" Target="worksheets/sheet${n}.xml"/></Relationships>`);
    ctypes = ctypes.replace(
      '</Types>',
      `<Override PartName="/xl/worksheets/sheet${n}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`
    );
    hojas.push({ nombre, relId });
  });

  zip.file('xl/_rels/workbook.xml.rels', relsLibro);
  zip.file('[Content_Types].xml', ctypes);
  const wbXml = await zip.file('xl/workbook.xml').async('string');
  zip.file('xl/workbook.xml', reemplazarSheetsWorkbook(wbXml, hojas));

  // docProps/app.xml lista los nombres de hojas: se quita esa parte para que no quede desfasada
  if (zip.file('docProps/app.xml')) {
    const app = await zip.file('docProps/app.xml').async('string');
    zip.file('docProps/app.xml', app.replace(/<HeadingPairs>[\s\S]*?<\/HeadingPairs>/, '').replace(/<TitlesOfParts>[\s\S]*?<\/TitlesOfParts>/, ''));
  }

  return zip.generateAsync({ type: 'arraybuffer', compression: 'DEFLATE' });
};
