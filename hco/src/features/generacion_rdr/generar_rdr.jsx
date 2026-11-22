import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  FaFileUpload,
  FaFileExcel,
  FaImages,
  FaDownload,
  FaSearch,
  FaUndo,
  FaTrash,
  FaEye,
  FaCogs,
  FaCheckCircle,
  FaExclamationTriangle,
  FaTimesCircle,
  FaInfoCircle,
  FaTimes,
  FaChevronLeft,
  FaChevronRight,
  FaLayerGroup,
} from 'react-icons/fa';
import Loading from '../../layouts/Loading';
import './generar_rdr.css';
import plantillaUrl from './plantilla_rdr.xlsx?url';

import {
  obtenerRegistrosRdr,
  buscarRegistrosExistentes,
  insertarRegistrosRdr,
  eliminarRegistroRdr,
  descargarImagenParaExcel,
  guardarFotosRdr,
  obtenerFotosRdr,
  eliminarFotoRdr,
  urlMiniatura,
} from '../../services/generarRdrService';
import { leerExcelDatosRdr, leerExcelFotosRdr, descargarFormatoCarga } from './rdrParser';
import { construirLibroRdr, FILAS_DETALLE_PLANTILLA } from './rdrExcel';

const REGISTROS_POR_PAGINA = 50;
const DESCARGAS_PARALELAS = 4;

function getStoredAuthUser() {
  const raw = localStorage.getItem('authUser') || sessionStorage.getItem('authUser');
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

const pad = (n) => String(n).padStart(2, '0');
const hoyLocal = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

const formatearFecha = (iso) => {
  if (!iso) return '-';
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
};

const formatearFechaHora = (valor) => {
  if (!valor) return '-';
  const d = new Date(valor);
  if (Number.isNaN(d.getTime())) return valor;
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

const descargarBlob = (buffer, nombre) => {
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nombre;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
};

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

const ICONO_ALERTA = {
  success: <FaCheckCircle />,
  error: <FaTimesCircle />,
  warning: <FaExclamationTriangle />,
  info: <FaInfoCircle />,
};

function GenerarRdrContenido() {
  const navigate = useNavigate();
  const [currentUser] = useState(() => getStoredAuthUser());
  const [loading, setLoading] = useState(false);

  // Datos y filtros
  const [registros, setRegistros] = useState([]);
  const filtrosIniciales = { buscar: '', costo: '', desde: hoyLocal(), hasta: hoyLocal() };
  const [filtrosForm, setFiltrosForm] = useState(filtrosIniciales);
  const [filtros, setFiltros] = useState(filtrosIniciales);
  const [loteFiltro, setLoteFiltro] = useState(null);
  const [pagina, setPagina] = useState(1);

  // Alertas y modales
  const [alertas, setAlertas] = useState([]);
  const [confirmacion, setConfirmacion] = useState(null);
  const [previewCarga, setPreviewCarga] = useState(null);
  const [detalleCosto, setDetalleCosto] = useState(null);
  const [progreso, setProgreso] = useState(null);

  // RDR generados por costo
  const [rdrs, setRdrs] = useState([]);
  const [seleccion, setSeleccion] = useState(new Set());
  const [resumenFotos, setResumenFotos] = useState(null);

  const inputDatosRef = useRef(null);
  const inputFotosRef = useRef(null);
  // Fotos ya descargadas para el Excel (url → { buffer, width, height } | { error })
  const imagenesRef = useRef(new Map());
  const [urlsFallidas, setUrlsFallidas] = useState(() => new Set());

  // ---------- Alertas ----------
  const mostrarAlerta = useCallback((tipo, titulo, mensaje, duracion = 6000) => {
    const id = `${Date.now()}-${Math.random()}`;
    setAlertas((prev) => [...prev, { id, tipo, titulo, mensaje }]);
    if (duracion) setTimeout(() => setAlertas((prev) => prev.filter((a) => a.id !== id)), duracion);
  }, []);
  const cerrarAlerta = (id) => setAlertas((prev) => prev.filter((a) => a.id !== id));

  // ---------- Carga de registros ----------
  // La tabla está "cargando" mientras la consulta vigente (fechas + recarga) no haya respondido
  const [recarga, setRecarga] = useState(0);
  const [consultaCargada, setConsultaCargada] = useState('');
  const consultaActual = `${filtros.desde}|${filtros.hasta}|${recarga}`;
  const cargandoTabla = Boolean(currentUser) && consultaCargada !== consultaActual;

  useEffect(() => {
    if (!currentUser) {
      navigate('/');
      return undefined;
    }
    let vigente = true;
    obtenerRegistrosRdr({ desde: filtros.desde, hasta: filtros.hasta })
      .then((data) => vigente && setRegistros(data))
      .catch((err) => vigente && mostrarAlerta('error', 'Error al cargar', err.message))
      .finally(() => vigente && setConsultaCargada(`${filtros.desde}|${filtros.hasta}|${recarga}`));
    return () => { vigente = false; };
  }, [currentUser, navigate, filtros.desde, filtros.hasta, recarga, mostrarAlerta]);


  const registrosFiltrados = useMemo(() => {
    const texto = filtros.buscar.trim().toUpperCase();
    const costo = filtros.costo.trim();
    return registros.filter((r) => {
      if (loteFiltro && r.lote_carga !== loteFiltro) return false;
      if (costo && !String(r.costo || '').includes(costo)) return false;
      if (texto) {
        const campos = [r.costo, r.sn, r.observacion, r.qty, r.codigo, r.obd, r.nombre_registrador]
          .map((v) => String(v || '').toUpperCase());
        if (!campos.some((c) => c.includes(texto))) return false;
      }
      return true;
    });
  }, [registros, filtros, loteFiltro]);

  const totalPaginas = Math.max(1, Math.ceil(registrosFiltrados.length / REGISTROS_POR_PAGINA));
  const paginaSegura = Math.min(pagina, totalPaginas);
  const registrosPaginados = registrosFiltrados.slice(
    (paginaSegura - 1) * REGISTROS_POR_PAGINA,
    paginaSegura * REGISTROS_POR_PAGINA
  );

  const costosFiltrados = useMemo(
    () => new Set(registrosFiltrados.map((r) => r.costo)).size,
    [registrosFiltrados]
  );

  const handleBuscar = () => {
    setFiltros({ ...filtrosForm });
    setLoteFiltro(null);
    setPagina(1);
  };

  const handleLimpiar = () => {
    setFiltrosForm(filtrosIniciales);
    setFiltros(filtrosIniciales);
    setLoteFiltro(null);
    setPagina(1);
  };

  // ---------- 1. Subir Excel de datos ----------
  const handleArchivoDatos = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    if (!/\.(xlsx|xlsm|xls|csv)$/i.test(file.name)) {
      mostrarAlerta('error', 'Archivo no válido', 'Selecciona un archivo Excel (.xlsx, .xls o .csv).');
      return;
    }

    setLoading(true);
    try {
      const { hoja, filas, errores, advertencias } = await leerExcelDatosRdr(file);
      if (filas.length === 0) {
        mostrarAlerta('warning', 'Excel sin datos', 'No se encontraron filas con COSTO para registrar.');
        return;
      }

      const { existentes, claveRegistro } = await buscarRegistrosExistentes(filas);
      const duplicados = new Set(filas.filter((f) => existentes.has(claveRegistro(f))).map((f) => f.numFila));

      setPreviewCarga({ nombreArchivo: file.name, hoja, filas, errores, advertencias, duplicados, omitirDuplicados: true });
      mostrarAlerta(
        'info',
        'Excel leído',
        `${filas.length} fila(s) en la hoja "${hoja}". Revisa la vista previa antes de guardar.`
      );
    } catch (err) {
      mostrarAlerta('error', 'No se pudo leer el Excel', err.message);
    } finally {
      setLoading(false);
    }
  };

  const filasAGuardar = useMemo(() => {
    if (!previewCarga) return [];
    return previewCarga.omitirDuplicados
      ? previewCarga.filas.filter((f) => !previewCarga.duplicados.has(f.numFila))
      : previewCarga.filas;
  }, [previewCarga]);

  const handleGuardarCarga = async () => {
    if (filasAGuardar.length === 0) {
      mostrarAlerta('warning', 'Nada que guardar', 'Todas las filas ya estaban registradas.');
      return;
    }
    setLoading(true);
    try {
      const { lote, insertados } = await insertarRegistrosRdr(filasAGuardar, currentUser);
      setPreviewCarga(null);
      mostrarAlerta('success', 'Carga registrada', `Se guardaron ${insertados} registro(s) correctamente.`);

      // Mostrar solo lo que se acaba de subir
      const hoy = hoyLocal();
      const nuevos = { ...filtrosIniciales, desde: hoy, hasta: hoy };
      setFiltrosForm(nuevos);
      setFiltros(nuevos);
      setLoteFiltro(lote);
      setPagina(1);
      setRecarga((n) => n + 1);
    } catch (err) {
      mostrarAlerta('error', 'Error al guardar', err.message, 10000);
    } finally {
      setLoading(false);
    }
  };

  const handleEliminar = (reg) => {
    setConfirmacion({
      titulo: 'Eliminar registro',
      mensaje: `¿Eliminar el SN ${reg.sn || '-'} del costo ${reg.costo}? Esta acción no se puede deshacer.`,
      textoBoton: 'Eliminar',
      peligro: true,
      onConfirm: async () => {
        setLoading(true);
        try {
          await eliminarRegistroRdr(reg.id);
          setRegistros((prev) => prev.filter((r) => r.id !== reg.id));
          mostrarAlerta('success', 'Registro eliminado', `SN ${reg.sn || '-'} eliminado.`);
        } catch (err) {
          mostrarAlerta('error', 'Error al eliminar', err.message);
        } finally {
          setLoading(false);
        }
      },
    });
  };
  // ---------- 2. Generar RDR por costo ----------
  // Cada costo queda vinculado al id (uuid) de su primer registro en generar_rdr: rdr_id
  const generarRdrs = async () => {
    // Orden de la carga original: fecha de registro y n° de fila del Excel
    const ordenados = [...registrosFiltrados].sort((a, b) => {
      const fa = String(a.fecha_registro || '');
      const fb = String(b.fecha_registro || '');
      if (fa !== fb) return fa < fb ? -1 : 1;
      return (a.orden || 0) - (b.orden || 0);
    });

    const mapa = new Map();
    ordenados.forEach((r) => {
      if (!mapa.has(r.costo)) mapa.set(r.costo, { costo: r.costo, rdr_id: r.id, ids: [], filas: [], fotos: [] });
      const g = mapa.get(r.costo);
      g.ids.push(r.id);
      g.filas.push({
        fecha_texto: formatearFecha(r.fecha),
        hora: r.hora || '',
        sn: r.sn || '',
        observacion: r.observacion || '',
        qty: r.qty || '',
        codigo: r.codigo || '',
        obd: r.obd || '',
      });
    });
    const grupos = [...mapa.values()];

    // Traer las fotos ya guardadas de estos costos
    setLoading(true);
    let guardadas = [];
    try {
      guardadas = await obtenerFotosRdr(grupos.flatMap((g) => g.ids));
    } catch (err) {
      mostrarAlerta('warning', 'Fotos no cargadas', err.message);
    } finally {
      setLoading(false);
    }
    const costoPorId = new Map();
    grupos.forEach((g) => g.ids.forEach((id) => costoPorId.set(id, g)));
    guardadas.forEach((f) => {
      const g = costoPorId.get(f.rdr_id);
      if (g && !g.fotos.some((x) => x.url === f.url)) g.fotos.push(f);
    });

    setRdrs(grupos);
    setSeleccion(new Set(grupos.map((g) => g.costo)));
    setResumenFotos(null);

    const conFotos = grupos.filter((g) => g.fotos.length > 0).length;
    mostrarAlerta('success', 'RDR generados', `Se generaron ${grupos.length} hoja(s), una por cada costo.`);
    if (conFotos > 0) {
      mostrarAlerta('info', 'Fotos guardadas', `${conFotos} costo(s) ya tenían fotos registradas y se cargaron.`);
    }
    const excedidos = grupos.filter((g) => g.filas.length > FILAS_DETALLE_PLANTILLA).length;
    if (excedidos > 0) {
      mostrarAlerta(
        'info',
        'Costos con muchas líneas',
        `${excedidos} costo(s) tienen más de ${FILAS_DETALLE_PLANTILLA} líneas: se agregarán filas iguales a las del formato y la leyenda bajará.`,
        8000
      );
    }
  };

  const handleGenerarRdr = () => {
    if (registrosFiltrados.length === 0) {
      mostrarAlerta('warning', 'Sin registros', 'No hay registros en el filtro actual para generar RDR.');
      return;
    }
    if (rdrs.length > 0) {
      setConfirmacion({
        titulo: 'Volver a generar',
        mensaje: 'Ya hay RDR generados. Se volverán a armar con el filtro actual (las fotos guardadas se mantienen). ¿Continuar?',
        textoBoton: 'Generar',
        onConfirm: generarRdrs,
      });
      return;
    }
    generarRdrs();
  };

  // ---------- 3. Capturar Excel de fotos: guarda las URL en rdr_fotos ----------
  const handleArchivoFotos = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    if (rdrs.length === 0) {
      mostrarAlerta('warning', 'Primero genera los RDR', 'Genera los RDR por costo antes de capturar las fotos.');
      return;
    }
    if (!/\.(xlsx|xlsm|xls)$/i.test(file.name)) {
      mostrarAlerta('error', 'Archivo no válido', 'Selecciona el Excel de fotos (.xlsx).');
      return;
    }

    setLoading(true);
    try {
      const { porCosto, hojasLeidas, hojasFaltantes, filasSinCosto, totalFotos } =
        await leerExcelFotosRdr(file, new Set(rdrs.map((g) => g.costo)));

      if (hojasLeidas.length === 0) {
        mostrarAlerta('error', 'Hojas no encontradas', 'El Excel debe tener las hojas Transferencia_Imagenes, aereos y/o Abollados.');
        return;
      }
      if (hojasFaltantes.length > 0) {
        mostrarAlerta('warning', 'Hojas faltantes', `No se encontró: ${hojasFaltantes.join(', ')}.`);
      }
      if (totalFotos === 0) {
        mostrarAlerta('warning', 'Sin coincidencias', 'Ninguna foto del Excel coincide con los costos generados.');
        return;
      }

      // Armar las filas para rdr_fotos: cada foto apunta al rdr_id de su costo
      const payload = [];
      rdrs.forEach((g) => {
        (porCosto.get(g.costo) || []).forEach((f) => payload.push({ ...f, rdr_id: g.rdr_id, costo: g.costo }));
      });

      const antes = rdrs.reduce((acc, g) => acc + g.fotos.length, 0);
      const guardadas = await guardarFotosRdr(payload, currentUser);

      const porRdr = new Map();
      guardadas.forEach((f) => {
        if (!porRdr.has(f.rdr_id)) porRdr.set(f.rdr_id, []);
        porRdr.get(f.rdr_id).push(f);
      });
      const nuevosGrupos = rdrs.map((g) => {
        const fotos = [...g.fotos];
        (porRdr.get(g.rdr_id) || []).forEach((f) => {
          const i = fotos.findIndex((x) => x.url === f.url);
          if (i >= 0) fotos[i] = f;
          else fotos.push(f);
        });
        return { ...g, fotos };
      });
      setRdrs(nuevosGrupos);

      const despues = nuevosGrupos.reduce((acc, g) => acc + g.fotos.length, 0);
      const sinFotos = nuevosGrupos.filter((g) => g.fotos.length === 0).length;
      setResumenFotos({ archivo: file.name, guardadas: guardadas.length, nuevas: despues - antes, sinFotos, filasSinCosto });

      mostrarAlerta(
        'success',
        'Fotos guardadas',
        `${guardadas.length} URL de fotos registradas para ${porRdr.size} costo(s)` +
          (despues - antes < guardadas.length ? ` (${guardadas.length - (despues - antes)} ya existían).` : '.')
      );
      if (sinFotos > 0) mostrarAlerta('info', 'Costos sin fotos', `${sinFotos} costo(s) no tienen fotos en el Excel.`);
      if (filasSinCosto > 0) {
        mostrarAlerta('info', 'Filas sin coincidencia', `${filasSinCosto} fila(s) del Excel de fotos no corresponden a ningún costo generado.`);
      }
    } catch (err) {
      mostrarAlerta('error', 'No se pudieron capturar las fotos', err.message, 10000);
    } finally {
      setLoading(false);
    }
  };

  const handleEliminarFoto = (grupo, foto) => {
    setConfirmacion({
      titulo: 'Quitar foto',
      mensaje: `¿Quitar esta foto (${foto.origen || 'foto'}) del costo ${grupo.costo}? Se eliminará de la base de datos.`,
      textoBoton: 'Quitar',
      peligro: true,
      onConfirm: async () => {
        setLoading(true);
        try {
          if (foto.id) await eliminarFotoRdr(foto.id);
          setRdrs((prev) => prev.map((g) => (g.costo === grupo.costo ? { ...g, fotos: g.fotos.filter((f) => f.url !== foto.url) } : g)));
          mostrarAlerta('success', 'Foto quitada', `Costo ${grupo.costo}.`);
        } catch (err) {
          mostrarAlerta('error', 'Error al quitar la foto', err.message);
        } finally {
          setLoading(false);
        }
      },
    });
  };

  // ---------- 4. Descargar ----------
  // Descarga (una sola vez) las fotos que faltan para los grupos indicados
  const asegurarImagenes = async (grupos) => {
    const cache = imagenesRef.current;
    const pendientes = [...new Set(grupos.flatMap((g) => g.fotos.map((f) => f.url)))].filter((u) => !cache.has(u));
    if (pendientes.length === 0) return;

    let hechas = 0;
    let indice = 0;
    setProgreso({ texto: 'Descargando fotos', actual: 0, total: pendientes.length });
    const trabajador = async () => {
      while (indice < pendientes.length) {
        const url = pendientes[indice++];
        try {
          cache.set(url, await descargarImagenParaExcel(url));
        } catch (err) {
          cache.set(url, { error: err.message });
        }
        hechas++;
        setProgreso({ texto: 'Descargando fotos', actual: hechas, total: pendientes.length });
      }
    };
    await Promise.all(Array.from({ length: Math.min(DESCARGAS_PARALELAS, pendientes.length) }, trabajador));
    const nuevasFallidas = pendientes.filter((u) => cache.get(u)?.error);
    setUrlsFallidas((prev) => new Set([...prev, ...nuevasFallidas]));

    const fallidas = nuevasFallidas.length;
    if (fallidas > 0) {
      mostrarAlerta(
        'warning',
        'Fotos no descargadas',
        `${fallidas} foto(s) no se pudieron descargar (revisa que estén compartidas con "cualquier persona con el enlace"). En el Excel quedará el enlace.`,
        10000
      );
    }
  };

  const prepararGrupo = (g) => ({
    costo: g.costo,
    filas: g.filas,
    fotos: g.fotos.map((f) => {
      const etiqueta = f.sku ? `${f.origen} - SKU ${f.sku}` : f.origen;
      const img = imagenesRef.current.get(f.url);
      return img && !img.error
        ? { etiqueta, buffer: new Uint8Array(img.buffer), width: img.width, height: img.height }
        : { etiqueta, url: f.url };
    }),
  });

  const construirArchivo = async (grupos, texto) => {
    await asegurarImagenes(grupos);
    setProgreso({ texto, actual: 0, total: 1 });
    const [modulo, plantillaBuffer] = await Promise.all([
      import('jszip'),
      fetch(plantillaUrl).then((r) => {
        if (!r.ok) throw new Error('No se pudo cargar plantilla_rdr.xlsx');
        return r.arrayBuffer();
      }),
    ]);
    const JSZip = modulo.default || modulo;
    return construirLibroRdr({ JSZip, plantillaBuffer, grupos: grupos.map(prepararGrupo) });
  };

  const descargarUno = async (g) => {
    try {
      const buffer = await construirArchivo([g], `Generando RDR ${g.costo}`);
      descargarBlob(buffer, `RDR_${g.costo}.xlsx`);
      mostrarAlerta('success', 'Excel descargado', `RDR_${g.costo}.xlsx`);
    } catch (err) {
      mostrarAlerta('error', 'Error al generar Excel', err.message);
    } finally {
      setProgreso(null);
    }
  };

  const gruposSeleccionados = rdrs.filter((g) => seleccion.has(g.costo));

  const descargarSeparados = async () => {
    if (gruposSeleccionados.length === 0) {
      mostrarAlerta('warning', 'Sin selección', 'Marca al menos un costo para descargar.');
      return;
    }
    try {
      await asegurarImagenes(gruposSeleccionados);
      for (let i = 0; i < gruposSeleccionados.length; i++) {
        const g = gruposSeleccionados[i];
        const buffer = await construirArchivo([g], `Generando RDR ${g.costo} (${i + 1} de ${gruposSeleccionados.length})`);
        descargarBlob(buffer, `RDR_${g.costo}.xlsx`);
        await esperar(400); // evita que el navegador bloquee descargas seguidas
      }
      mostrarAlerta('success', 'Descarga completa', `${gruposSeleccionados.length} archivo(s) descargados.`);
    } catch (err) {
      mostrarAlerta('error', 'Error al generar Excel', err.message);
    } finally {
      setProgreso(null);
    }
  };

  const descargarEnUnLibro = async () => {
    if (gruposSeleccionados.length === 0) {
      mostrarAlerta('warning', 'Sin selección', 'Marca al menos un costo para descargar.');
      return;
    }
    try {
      const buffer = await construirArchivo(gruposSeleccionados, 'Generando libro RDR');
      const nombre = `RDR_${hoyLocal()}_${gruposSeleccionados.length}_costos.xlsx`;
      descargarBlob(buffer, nombre);
      mostrarAlerta('success', 'Excel descargado', `${nombre} (${gruposSeleccionados.length} hoja(s)).`);
    } catch (err) {
      mostrarAlerta('error', 'Error al generar Excel', err.message);
    } finally {
      setProgreso(null);
    }
  };

  const toggleSeleccion = (costo) => {
    setSeleccion((prev) => {
      const s = new Set(prev);
      if (s.has(costo)) s.delete(costo);
      else s.add(costo);
      return s;
    });
  };
  const todosSeleccionados = rdrs.length > 0 && seleccion.size === rdrs.length;
  const toggleTodos = () => setSeleccion(todosSeleccionados ? new Set() : new Set(rdrs.map((g) => g.costo)));

  const conteoOrigen = (fotos) =>
    fotos.reduce((acc, f) => {
      acc[f.origen] = (acc[f.origen] || 0) + 1;
      return acc;
    }, {});

  const fotoFallida = (url) => urlsFallidas.has(url);

  const totalFotos = rdrs.reduce((acc, g) => acc + g.fotos.length, 0);
  const pasoActual = rdrs.length === 0 ? 1 : totalFotos > 0 ? 4 : 3;
  const grupoDetalle = detalleCosto ? rdrs.find((g) => g.costo === detalleCosto) : null;

  return (
    <div className="rdr-page">
      {(loading || cargandoTabla) && <Loading />}

      {/* ALERTAS */}
      <div className="rdr-alertas" aria-live="polite">
        {alertas.map((a) => (
          <div key={a.id} className={`rdr-alerta rdr-alerta-${a.tipo}`} role="status">
            <span className="rdr-alerta-icono">{ICONO_ALERTA[a.tipo]}</span>
            <div className="rdr-alerta-texto">
              <strong>{a.titulo}</strong>
              {a.mensaje && <span>{a.mensaje}</span>}
            </div>
            <button type="button" className="rdr-alerta-cerrar" onClick={() => cerrarAlerta(a.id)} aria-label="Cerrar">
              <FaTimes />
            </button>
          </div>
        ))}
      </div>

      {/* 1. CABECERA + KPI */}
      <div className="top-summary-grid">
        <section className="hero-card">
          <span className="module-pill">INBOUND / RDR</span>
          <h1>Generar RDR (Reportes de Discrepancia)</h1>
          <p>Sube el Excel de discrepancias, genera un reporte por costo con la plantilla oficial, agrega las fotos y descarga los Excel.</p>
        </section>

        <section className="kpi-container-card">
          <div className="kpi-blue-box">
            <span className="kpi-box-title">REGISTROS</span>
            <strong className="kpi-box-value">{registrosFiltrados.length}</strong>
          </div>
          <div className="kpi-blue-box">
            <span className="kpi-box-title">COSTOS</span>
            <strong className="kpi-box-value">{costosFiltrados}</strong>
          </div>
          <div className="kpi-blue-box">
            <span className="kpi-box-title">RDR GENERADOS</span>
            <strong className="kpi-box-value">{rdrs.length}</strong>
          </div>
          <div className="kpi-blue-box">
            <span className="kpi-box-title">FOTOS</span>
            <strong className="kpi-box-value">{totalFotos}</strong>
          </div>
        </section>
      </div>

      {/* PASOS */}
      <div className="rdr-pasos">
        {['Subir datos', 'Generar RDR', 'Capturar fotos', 'Descargar'].map((t, i) => (
          <div key={t} className={`rdr-paso ${pasoActual > i + 1 ? 'hecho' : ''} ${pasoActual === i + 1 ? 'activo' : ''}`}>
            <span className="rdr-paso-num">{pasoActual > i + 1 ? <FaCheckCircle /> : i + 1}</span>
            <span className="rdr-paso-texto">{t}</span>
          </div>
        ))}
      </div>

      {/* 2. FILTROS Y CARGA */}
      <section className="filters-card">
        <div className="filters-grid">
          <div className="filter-group filter-buscar">
            <label>Buscar</label>
            <input
              type="text"
              placeholder="SN, costo, observación, QTY, OBD, registrador..."
              value={filtrosForm.buscar}
              onChange={(e) => setFiltrosForm({ ...filtrosForm, buscar: e.target.value })}
              onKeyDown={(e) => e.key === 'Enter' && handleBuscar()}
            />
          </div>
          <div className="filter-group">
            <label>Costo</label>
            <input
              type="text"
              inputMode="numeric"
              placeholder="Ej. 9243"
              value={filtrosForm.costo}
              onChange={(e) => setFiltrosForm({ ...filtrosForm, costo: e.target.value })}
              onKeyDown={(e) => e.key === 'Enter' && handleBuscar()}
            />
          </div>
          <div className="filter-group">
            <label>F. registro desde</label>
            <input
              type="date"
              value={filtrosForm.desde}
              onChange={(e) => setFiltrosForm({ ...filtrosForm, desde: e.target.value })}
            />
          </div>
          <div className="filter-group">
            <label>F. registro hasta</label>
            <input
              type="date"
              value={filtrosForm.hasta}
              onChange={(e) => setFiltrosForm({ ...filtrosForm, hasta: e.target.value })}
            />
          </div>
        </div>

        <div className="filters-actions-row">
          <input ref={inputDatosRef} type="file" accept=".xlsx,.xls,.xlsm,.csv" hidden onChange={handleArchivoDatos} />
          <button type="button" className="btn-action-primary" onClick={() => inputDatosRef.current?.click()}>
            <FaFileUpload /> <span>Subir Excel</span>
          </button>
          <button type="button" className="btn-action-primary" onClick={handleBuscar}>
            <FaSearch /> <span>Buscar</span>
          </button>
          <button type="button" className="btn-action-secondary" onClick={handleLimpiar}>
            <FaUndo /> <span>Limpiar</span>
          </button>
          <button type="button" className="btn-action-secondary" onClick={descargarFormatoCarga}>
            <FaFileExcel /> <span>Formato de carga</span>
          </button>
          {loteFiltro && (
            <span className="rdr-chip-lote">
              Mostrando solo la última carga
              <button type="button" onClick={() => setLoteFiltro(null)} aria-label="Quitar filtro de carga">
                <FaTimes />
              </button>
            </span>
          )}
        </div>
      </section>

      {/* 3. TABLA (TRACKING) */}
      <section className="table-section-card">
        <div className="table-topbar">
          <span className="records-counter">
            Mostrando <strong>{registrosPaginados.length}</strong> registros de <strong>{registrosFiltrados.length}</strong>
          </span>

          <div className="pagination-controls">
            <button
              type="button"
              className="page-nav-btn"
              disabled={paginaSegura <= 1}
              onClick={() => setPagina(paginaSegura - 1)}
            >
              <FaChevronLeft className="nav-chevron" /> <span>Anterior</span>
            </button>
            <span className="pagination-text-indicator">Página {paginaSegura} de {totalPaginas}</span>
            <button
              type="button"
              className="page-nav-btn"
              disabled={paginaSegura >= totalPaginas}
              onClick={() => setPagina(paginaSegura + 1)}
            >
              <span>Siguiente</span> <FaChevronRight className="nav-chevron" />
            </button>
          </div>

          <button type="button" className="btn-generar-rdr" onClick={handleGenerarRdr} disabled={registrosFiltrados.length === 0}>
            <FaCogs /> <span>Generar RDR por costo</span>
          </button>
        </div>

        <div className="table-container">
          <table>
            <thead>
              <tr>
                <th>F. Registro</th>
                <th>Fecha</th>
                <th>Costo</th>
                <th>SN</th>
                <th>Observación</th>
                <th>Hora</th>
                <th>QTY</th>
                <th>Código</th>
                <th>OBD</th>
                <th>Registrado por</th>
                <th style={{ width: '70px' }}>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {registrosPaginados.length === 0 ? (
                <tr>
                  <td colSpan="11" className="rdr-tabla-vacia">
                    No hay registros con los filtros seleccionados. Sube un Excel o cambia las fechas de registro.
                  </td>
                </tr>
              ) : (
                registrosPaginados.map((r) => (
                  <tr key={r.id}>
                    <td>{formatearFechaHora(r.fecha_registro)}</td>
                    <td style={{ fontWeight: 700 }}>{formatearFecha(r.fecha)}</td>
                    <td><span className="costo-pill">{r.costo}</span></td>
                    <td style={{ fontWeight: 700, color: '#0f4c81' }}>{r.sn || '-'}</td>
                    <td><span className="empresa-tag">{r.observacion || '-'}</span></td>
                    <td>{r.hora || '-'}</td>
                    <td style={{ fontWeight: 700 }}>{r.qty || '-'}</td>
                    <td>{r.codigo || '-'}</td>
                    <td>{r.obd || '-'}</td>
                    <td style={{ textAlign: 'left' }}>{r.nombre_registrador || '-'}</td>
                    <td>
                      <button type="button" className="btn-tabla-eliminar" title="Eliminar" onClick={() => handleEliminar(r)}>
                        <FaTrash />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* 4. RDR GENERADOS */}
      {rdrs.length > 0 && (
        <section className="table-section-card rdr-generados-card">
          <div className="rdr-generados-header">
            <div>
              <h2>RDR generados por costo</h2>
              <p>
                {rdrs.length} hoja(s) · {gruposSeleccionados.length} seleccionada(s)
                {resumenFotos && ` · Fotos de "${resumenFotos.archivo}"`}
              </p>
            </div>
            <div className="rdr-generados-acciones">
              <label className="rdr-check-todos">
                <input type="checkbox" checked={todosSeleccionados} onChange={toggleTodos} />
                <span>Todos</span>
              </label>
              <input ref={inputFotosRef} type="file" accept=".xlsx,.xls,.xlsm" hidden onChange={handleArchivoFotos} />
              <button type="button" className="btn-action-primary" onClick={() => inputFotosRef.current?.click()}>
                <FaImages /> <span>Capturar Excel de fotos</span>
              </button>
              <button
                type="button"
                className="btn-exportar-excel"
                onClick={descargarSeparados}
                disabled={gruposSeleccionados.length === 0}
              >
                <FaDownload /> <span>Descargar seleccionados</span>
              </button>
              <button
                type="button"
                className="btn-exportar-excel btn-libro"
                onClick={descargarEnUnLibro}
                disabled={gruposSeleccionados.length === 0}
              >
                <FaLayerGroup /> <span>Todo en un libro</span>
              </button>
            </div>
          </div>

          {resumenFotos && (
            <div className="rdr-resumen-fotos">
              <span className="ok"><FaCheckCircle /> {resumenFotos.guardadas} URL guardadas en BD</span>
              {resumenFotos.guardadas > resumenFotos.nuevas && (
                <span className="warn"><FaInfoCircle /> {resumenFotos.guardadas - resumenFotos.nuevas} ya existían</span>
              )}
              {resumenFotos.sinFotos > 0 && <span className="info"><FaInfoCircle /> {resumenFotos.sinFotos} costos sin fotos</span>}
              {resumenFotos.filasSinCosto > 0 && (
                <span className="info"><FaInfoCircle /> {resumenFotos.filasSinCosto} filas del Excel no coinciden con ningún costo</span>
              )}
            </div>
          )}

          <div className="rdr-grid">
            {rdrs.map((g) => {
              const origenes = conteoOrigen(g.fotos);
              const fallidas = g.fotos.filter((f) => fotoFallida(f.url)).length;
              const miniaturas = g.fotos.slice(0, 4);
              const seleccionado = seleccion.has(g.costo);
              return (
                <article key={g.costo} className={`rdr-card ${seleccionado ? 'seleccionado' : ''}`}>
                  <header className="rdr-card-header">
                    <label className="rdr-card-check">
                      <input type="checkbox" checked={seleccionado} onChange={() => toggleSeleccion(g.costo)} />
                      <span>COSTO {g.costo}</span>
                    </label>
                    <span className="rdr-card-lineas">{g.filas.length} línea(s)</span>
                  </header>

                  <div className="rdr-card-body">
                    <div className="rdr-card-dato">
                      <span>Fecha</span>
                      <strong>{g.filas[0]?.fecha_texto || '-'}</strong>
                    </div>
                    <div className="rdr-card-dato">
                      <span>Hora</span>
                      <strong>{g.filas[0]?.hora || '-'}</strong>
                    </div>

                    {g.filas.length > FILAS_DETALLE_PLANTILLA && (
                      <div className="rdr-card-aviso">
                        <FaExclamationTriangle /> Más de {FILAS_DETALLE_PLANTILLA} líneas
                      </div>
                    )}

                    <div className="rdr-card-fotos">
                      {miniaturas.length > 0 ? (
                        miniaturas.map((f) => (
                          <img key={f.url} src={urlMiniatura(f.url, 200)} alt={`Foto ${f.origen}`} loading="lazy" referrerPolicy="no-referrer" />
                        ))
                      ) : (
                        <span className="rdr-sin-fotos">Sin fotos registradas</span>
                      )}
                      {g.fotos.length > 4 && <span className="rdr-mas-fotos">+{g.fotos.length - 4}</span>}
                    </div>

                    <div className="rdr-card-badges">
                      {Object.entries(origenes).map(([origen, n]) => (
                        <span key={origen} className={`badge-origen origen-${String(origen).toLowerCase().normalize('NFD').replace(/[^a-z]/g, '')}`}>
                          {origen}: {n}
                        </span>
                      ))}
                      {fallidas > 0 && <span className="badge-origen origen-error">Fallidas: {fallidas}</span>}
                    </div>
                  </div>

                  <footer className="rdr-card-footer">
                    <button type="button" className="btn-action-secondary" onClick={() => setDetalleCosto(g.costo)}>
                      <FaEye /> <span>Ver</span>
                    </button>
                    <button type="button" className="btn-exportar-excel" onClick={() => descargarUno(g)}>
                      <FaDownload /> <span>Descargar</span>
                    </button>
                  </footer>
                </article>
              );
            })}
          </div>
        </section>
      )}

      {/* MODAL: VISTA PREVIA DE CARGA */}
      {previewCarga && (
        <div className="tc-modal-overlay" onClick={() => setPreviewCarga(null)}>
          <div className="tc-modal-card" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
            <div className="tc-modal-header">
              <div>
                <h3>Vista previa de carga</h3>
                <p>{previewCarga.nombreArchivo} · hoja "{previewCarga.hoja}"</p>
              </div>
              <button type="button" className="tc-modal-close" onClick={() => setPreviewCarga(null)} aria-label="Cerrar">
                <FaTimes />
              </button>
            </div>

            <div className="tc-modal-body">
              <div className="rdr-preview-kpis">
                <div><span>Filas leídas</span><strong>{previewCarga.filas.length}</strong></div>
                <div><span>Costos</span><strong>{new Set(previewCarga.filas.map((f) => f.costo)).size}</strong></div>
                <div className={previewCarga.duplicados.size ? 'warn' : ''}><span>Ya registradas</span><strong>{previewCarga.duplicados.size}</strong></div>
                <div className={previewCarga.errores.length ? 'error' : ''}><span>Con error</span><strong>{previewCarga.errores.length}</strong></div>
              </div>

              {previewCarga.errores.length > 0 && (
                <div className="rdr-mensajes error">
                  <strong><FaTimesCircle /> Filas que no se guardarán</strong>
                  <ul>{previewCarga.errores.slice(0, 8).map((m) => <li key={m}>{m}</li>)}</ul>
                  {previewCarga.errores.length > 8 && <small>y {previewCarga.errores.length - 8} más…</small>}
                </div>
              )}
              {previewCarga.advertencias.length > 0 && (
                <div className="rdr-mensajes warn">
                  <strong><FaExclamationTriangle /> Advertencias</strong>
                  <ul>{previewCarga.advertencias.slice(0, 8).map((m) => <li key={m}>{m}</li>)}</ul>
                  {previewCarga.advertencias.length > 8 && <small>y {previewCarga.advertencias.length - 8} más…</small>}
                </div>
              )}
              {previewCarga.duplicados.size > 0 && (
                <label className="rdr-check-duplicados">
                  <input
                    type="checkbox"
                    checked={previewCarga.omitirDuplicados}
                    onChange={(e) => setPreviewCarga({ ...previewCarga, omitirDuplicados: e.target.checked })}
                  />
                  <span>Omitir las {previewCarga.duplicados.size} fila(s) que ya están registradas</span>
                </label>
              )}

              <div className="table-container rdr-preview-tabla">
                <table>
                  <thead>
                    <tr>
                      <th>Fila</th><th>Fecha</th><th>Costo</th><th>SN</th><th>Observación</th>
                      <th>Hora</th><th>QTY</th><th>Código</th><th>OBD</th>
                    </tr>
                  </thead>
                  <tbody>
                    {previewCarga.filas.slice(0, 100).map((f) => (
                      <tr key={f.numFila} className={previewCarga.duplicados.has(f.numFila) ? 'fila-duplicada' : ''}>
                        <td>{f.numFila}</td>
                        <td>{f.fecha_texto || '-'}</td>
                        <td><span className="costo-pill">{f.costo}</span></td>
                        <td>{f.sn || '-'}</td>
                        <td>{f.observacion || '-'}</td>
                        <td>{f.hora || '-'}</td>
                        <td>{f.qty || '-'}</td>
                        <td>{f.codigo || '-'}</td>
                        <td>{f.obd || '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {previewCarga.filas.length > 100 && (
                <small className="rdr-nota">Se muestran las primeras 100 filas de {previewCarga.filas.length}.</small>
              )}
            </div>

            <div className="tc-modal-footer">
              <button type="button" className="btn-modal-cancel" onClick={() => setPreviewCarga(null)}>Cancelar</button>
              <button type="button" className="btn-modal-save" onClick={handleGuardarCarga} disabled={filasAGuardar.length === 0}>
                Guardar {filasAGuardar.length} registro(s)
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: DETALLE DE UN COSTO */}
      {grupoDetalle && (
        <div className="tc-modal-overlay" onClick={() => setDetalleCosto(null)}>
          <div className="tc-modal-card" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
            <div className="tc-modal-header">
              <div>
                <h3>RDR costo {grupoDetalle.costo}</h3>
                <p>{grupoDetalle.filas.length} línea(s) · {grupoDetalle.fotos.length} foto(s)</p>
              </div>
              <button type="button" className="tc-modal-close" onClick={() => setDetalleCosto(null)} aria-label="Cerrar">
                <FaTimes />
              </button>
            </div>
            <div className="tc-modal-body">
              <div className="table-container">
                <table>
                  <thead>
                    <tr><th>#</th><th>Observación</th><th>SN</th><th>Código</th><th>QTY</th></tr>
                  </thead>
                  <tbody>
                    {grupoDetalle.filas.map((f, i) => (
                      <tr key={`${f.sn}-${i}`}>
                        <td>{i + 1}</td><td>{f.observacion || '-'}</td>
                        <td style={{ fontWeight: 700, color: '#0f4c81' }}>{f.sn || '-'}</td>
                        <td>{f.codigo || '-'}</td><td>{f.qty || '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {grupoDetalle.fotos.length > 0 && (
                <div className="rdr-detalle-fotos">
                  {grupoDetalle.fotos.map((f) => (
                    <figure key={f.url} className={fotoFallida(f.url) ? 'con-error' : ''}>
                      <a href={f.url} target="_blank" rel="noopener noreferrer" title="Abrir foto original">
                        <img src={urlMiniatura(f.url, 400)} alt={`Foto ${f.origen}`} loading="lazy" referrerPolicy="no-referrer" />
                      </a>
                      <figcaption>
                        <span>
                          {f.origen}{f.sku ? ` · SKU ${f.sku}` : ''}
                          {fotoFallida(f.url) && <em className="rdr-foto-error"> · no se pudo descargar</em>}
                        </span>
                        <button type="button" className="btn-quitar-foto" title="Quitar foto" onClick={() => handleEliminarFoto(grupoDetalle, f)}>
                          <FaTrash />
                        </button>
                      </figcaption>
                    </figure>
                  ))}
                </div>
              )}
            </div>
            <div className="tc-modal-footer">
              <button type="button" className="btn-modal-cancel" onClick={() => setDetalleCosto(null)}>Cerrar</button>
              <button type="button" className="btn-modal-save" onClick={() => descargarUno(grupoDetalle)}>
                <FaDownload /> Descargar Excel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: CONFIRMACIÓN */}
      {confirmacion && (
        <div className="tc-modal-overlay" onClick={() => setConfirmacion(null)}>
          <div className="tc-modal-card rdr-confirm" onClick={(e) => e.stopPropagation()} role="alertdialog" aria-modal="true">
            <div className="rdr-confirm-body">
              <span className={`rdr-confirm-icono ${confirmacion.peligro ? 'peligro' : ''}`}>
                <FaExclamationTriangle />
              </span>
              <h3>{confirmacion.titulo}</h3>
              <p>{confirmacion.mensaje}</p>
            </div>
            <div className="tc-modal-footer">
              <button type="button" className="btn-modal-cancel" onClick={() => setConfirmacion(null)}>Cancelar</button>
              <button
                type="button"
                className={`btn-modal-save ${confirmacion.peligro ? 'peligro' : ''}`}
                onClick={() => {
                  const accion = confirmacion.onConfirm;
                  setConfirmacion(null);
                  accion();
                }}
              >
                {confirmacion.textoBoton || 'Aceptar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* PROGRESO */}
      {progreso && (
        <div className="rdr-progreso-overlay">
          <div className="rdr-progreso-card">
            <div className="rdr-spinner" />
            <strong>{progreso.texto}</strong>
            {progreso.total > 1 && (
              <>
                <div className="rdr-progreso-barra">
                  <div style={{ width: `${(progreso.actual / progreso.total) * 100}%` }} />
                </div>
                <span>{progreso.actual} de {progreso.total}</span>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// Envoltorio: los estilos de este módulo solo aplican dentro de este div
export default function GenerarRdr(props) {
  return (
    <div className="hco-scope hco-generar-rdr">
      <GenerarRdrContenido {...props} />
    </div>
  );
}
