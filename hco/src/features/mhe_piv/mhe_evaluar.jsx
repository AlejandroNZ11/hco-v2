import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation, useSearchParams } from 'react-router-dom';
import Loading from '../../layouts/Loading';
import './mhe_evaluar.css';
import '../usuarios/registra_usuario.css';

// Importamos los servicios de MHE
import { 
  obtenerDatosMaestrosMhe, 
  obtenerUltimaInspeccionEquipo, 
  guardarInspeccionCompleta,
  obtenerInspeccionPorId,
  actualizarInspeccionCompleta
} from '../../services/mheService';

// Leer sesión
function getStoredAuthUser() {
  const raw = localStorage.getItem("authUser") || sessionStorage.getItem("authUser");
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

const extraerIdDrive = (url) => {
  if (!url) return null;
  const match = url.match(/\/d\/([a-zA-Z0-9_-]+)/) || url.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  return match ? match[1] : null;
};

const convertirDriveUrl = (url) => {
  if (!url) return "";
  if (url.startsWith("data:image/")) return url;
  const driveId = extraerIdDrive(url);
  if (driveId) return `https://drive.google.com/uc?export=view&id=${driveId}`;
  return url;
};

const normalizarTexto = (txt) =>
  (txt || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

export default function MheEvaluar() {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();

  const inspeccionEditId = searchParams.get('id') || location.state?.inspeccion?.id || null;
  const esModoEdicion = Boolean(inspeccionEditId);

  const [currentUser] = useState(() => getStoredAuthUser());
  const [loading, setLoading] = useState(false);
  
  const [categorias, setCategorias] = useState([]);
  const [todosEquipos, setTodosEquipos] = useState([]);
  const [todasPreguntas, setTodasPreguntas] = useState([]);
  
  const [equipos, setEquipos] = useState([]);
  const [preguntas, setPreguntas] = useState([]);
  
  const [formData, setFormData] = useState({
    categoria_id: "",
    equipo_id: "",
    observaciones: "",
    vb_operador: false
  });

  const [respuestas, setRespuestas] = useState({});
  const [equipoSeleccionado, setEquipoSeleccionado] = useState(null);
  const [checklistAnterior, setChecklistAnterior] = useState(null);
  const [horometroAnterior, setHorometroAnterior] = useState(null);

  const esPreguntaObservacion = (p) => {
    const texto = normalizarTexto(p?.descripcion);
    return p?.seccion === 'RESUMEN' && (texto.includes('describa') || texto.includes('observacion'));
  };

  const esPreguntaVB = (p) => {
    const texto = normalizarTexto(p?.descripcion);
    return p?.seccion === 'RESUMEN' && texto.includes('vb operador');
  };

  const esPreguntaMedicamentosDetalle = (p) => {
    if (p?.seccion !== 'SALUD') return false;
    const texto = normalizarTexto(p?.descripcion);
    return (
      texto.includes('en caso tu respuesta') ||
      texto.includes('que medicamentos') ||
      texto.includes('por cuanto tiempo')
    );
  };

  const esPreguntaTratamiento = (p) => {
    if (p?.seccion !== 'SALUD' || esPreguntaMedicamentosDetalle(p)) return false;
    const texto = normalizarTexto(p?.descripcion);
    return (
      texto.includes('tratamiento') ||
      texto.includes('medicacion') ||
      texto.includes('somnolencia')
    );
  };

  // Extracción optimizada del horómetro anterior desde la última inspección
  const extraerHorometroDeInspeccion = async (ultimaInsp, listaPreguntas, eqObj = null) => {
    if (!ultimaInsp) {
      const valEq = eqObj?.horometro ?? eqObj?.ultimo_horometro ?? eqObj?.contador;
      return valEq !== undefined && valEq !== null && !isNaN(parseFloat(valEq)) ? parseFloat(valEq) : null;
    }

    // 1. Identificamos los IDs de las preguntas de tipo CONTADOR para esta categoría
    const idsContador = (listaPreguntas || [])
      .filter(p => p.seccion === 'CONTADOR')
      .map(p => String(p.id));

    // 2. Buscamos en las respuestas que ya vienen adjuntas en la última inspección
    const arrResp = ultimaInsp.respuestas || [];
    if (Array.isArray(arrResp) && arrResp.length > 0) {
      const itemCont = arrResp.find(r => idsContador.includes(String(r.item_id || r.pregunta_id || r.id)));
      const textoResp = itemCont?.respuesta_texto ?? itemCont?.valor ?? itemCont?.respuesta;
      if (textoResp !== undefined && textoResp !== null && String(textoResp).trim() !== "") {
        const val = parseFloat(textoResp);
        if (!isNaN(val)) return val;
      }
    }

    // 3. Respaldo por si estuviera guardado directo en columnas de la cabecera
    const camposPosibles = ['horometro', 'horometro_inicio', 'contador', 'valor_contador'];
    for (const campo of camposPosibles) {
      if (ultimaInsp[campo] !== undefined && ultimaInsp[campo] !== null && String(ultimaInsp[campo]).trim() !== "") {
        const val = parseFloat(ultimaInsp[campo]);
        if (!isNaN(val)) return val;
      }
    }

    const valEqFallback = eqObj?.horometro ?? eqObj?.ultimo_horometro ?? eqObj?.contador;
    return valEqFallback !== undefined && valEqFallback !== null && !isNaN(parseFloat(valEqFallback)) ? parseFloat(valEqFallback) : null;
  };


  const asyncResponseToDetails = (res) => {
    if (!res) return { respuestas: [] };
    if (res.respuestas) return res;
    return { respuestas: res.detalles || res.mhe_respuestas || [] };
  };

  useEffect(() => {
    if (!currentUser) {
      alert("Inicie sesión para continuar.");
      navigate('/');
      return;
    }
    inicializarFormulario();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser, navigate, inspeccionEditId]);

  const inicializarFormulario = async () => {
    setLoading(true);
    try {
      const data = await obtenerDatosMaestrosMhe();
      setCategorias(data.categorias);
      setTodosEquipos(data.equipos);
      setTodasPreguntas(data.preguntas);

      if (inspeccionEditId) {
        const resultadoInsp = await obtenerInspeccionPorId(inspeccionEditId);
        const inspeccion = resultadoInsp.inspeccion || resultadoInsp;
        const respGuardadas = resultadoInsp.respuestas || resultadoInsp.detalles || [];

        const eqEncontrado = data.equipos.find(eq => String(eq.id) === String(inspeccion.equipo_id));
        const catId = eqEncontrado ? String(eqEncontrado.categoria_id) : "";

        const eqFiltrados = data.equipos.filter(eq => String(eq.categoria_id) === catId);
        const pregFiltradas = data.preguntas.filter(p => String(p.categoria_id) === catId);

        setEquipos(eqFiltrados);
        setPreguntas(pregFiltradas);
        setEquipoSeleccionado(eqEncontrado || null);

        setFormData({
          categoria_id: catId,
          equipo_id: String(inspeccion.equipo_id || ""),
          observaciones: inspeccion.observaciones_generales || "",
          vb_operador: Boolean(inspeccion.vb_operador)
        });

        if (inspeccion.chk_ant_estado || inspeccion.chk_ant_fecha) {
          setChecklistAnterior({
            estado_mhe: inspeccion.chk_ant_estado,
            observaciones_generales: inspeccion.chk_ant_obs,
            fecha_hora: inspeccion.chk_ant_fecha,
            registrado_por_nombre: inspeccion.chk_ant_usuario
          });
        }

        if (inspeccion.equipo_id) {
          try {
            const dataUltima = await obtenerUltimaInspeccionEquipo(inspeccion.equipo_id);
            if (dataUltima) {
              const horoPrevio = await extraerHorometroDeInspeccion(dataUltima, data.preguntas, eqEncontrado);
              setHorometroAnterior(horoPrevio);
            }
          } catch (e) {
            console.error(e);
          }
        }

        const mapaRespuestas = {};
        pregFiltradas.forEach(p => {
          mapaRespuestas[p.id] = {
            valor_estado: "",
            respuesta_texto: esPreguntaObservacion(p) ? (inspeccion.observaciones_generales || "") : ""
          };
        });

        respGuardadas.forEach(r => {
          mapaRespuestas[r.item_id || r.pregunta_id] = {
            valor_estado: r.valor_estado || "",
            respuesta_texto: r.respuesta_texto || r.valor || ""
          };
        });

        setRespuestas(mapaRespuestas);
      }
    } catch (error) {
      alert("Error al cargar datos: " + error.message);
    } finally {
      setLoading(false);
    }
  };

  const handleCategoriaChange = (e) => {
    const catId = e.target.value;
    
    setFormData({ ...formData, categoria_id: catId, equipo_id: "" });
    setEquipoSeleccionado(null);
    setChecklistAnterior(null);
    setHorometroAnterior(null);

    if (!catId) {
      setEquipos([]);
      setPreguntas([]);
      setRespuestas({});
      return;
    }

    const eqFiltrados = todosEquipos.filter(eq => String(eq.categoria_id) === String(catId));
    setEquipos(eqFiltrados);

    const pregFiltradas = todasPreguntas.filter(p => String(p.categoria_id) === String(catId));
    setPreguntas(pregFiltradas);

    const initResp = {};
    pregFiltradas.forEach(p => {
      initResp[p.id] = { valor_estado: "", respuesta_texto: "" };
    });
    setRespuestas(initResp);
  };

  const handleEquipoChange = async (e) => {
    const eqId = e.target.value;
    setFormData({ ...formData, equipo_id: eqId });
    
    const eq = equipos.find(x => String(x.id) === String(eqId));
    setEquipoSeleccionado(eq || null);

    setChecklistAnterior(null);
    setHorometroAnterior(null);
    if (!eqId) return;

    try {
      const data = await obtenerUltimaInspeccionEquipo(eqId);
      if (data) {
        setChecklistAnterior(data);
        const horoPrevio = await extraerHorometroDeInspeccion(data, todasPreguntas, eq);
        setHorometroAnterior(horoPrevio);
      } else {
        const horoPrevio = await extraerHorometroDeInspeccion(null, todasPreguntas, eq);
        setHorometroAnterior(horoPrevio);
      }
    } catch (error) {
      console.error(error.message);
    }
  };

  const pregBateria = preguntas.filter(p => p.seccion === 'BATERIA');
  const pregContador = preguntas.filter(p => p.seccion === 'CONTADOR');
  const pregVisual = preguntas.filter(p => p.seccion === 'VISUAL');
  const pregFunciones = preguntas.filter(p => p.seccion === 'FUNCIONES');
  const pregResumen = preguntas.filter(p => p.seccion === 'RESUMEN');
  const pregSalud = preguntas.filter(p => p.seccion === 'SALUD');

  const preguntasVisualYFunciones = [...pregVisual, ...pregFunciones];
  const hayInoperativoOObservado = preguntasVisualYFunciones.some(
    p => respuestas[p.id]?.valor_estado === 'INOPERATIVO' || respuestas[p.id]?.valor_estado === 'OBSERVADO'
  );
  const todasVisualYFuncionesRespondidas =
    preguntasVisualYFunciones.length > 0 &&
    preguntasVisualYFunciones.every(p => Boolean(respuestas[p.id]?.valor_estado));
  const todosVisualYFuncionesOperativo = todasVisualYFuncionesRespondidas && !hayInoperativoOObservado;

  useEffect(() => {
    if (preguntas.length === 0) return;
    const pregObs = preguntas.find(p => esPreguntaObservacion(p));
    if (!pregObs) return;

    const textoActual = respuestas[pregObs.id]?.respuesta_texto || "";

    if (todosVisualYFuncionesOperativo) {
      if (textoActual === "") {
        setRespuestas(prev => ({
          ...prev,
          [pregObs.id]: { ...(prev[pregObs.id] || { valor_estado: "" }), respuesta_texto: "OPERATIVO" }
        }));
      }
    } else if (hayInoperativoOObservado) {
      if (textoActual === "OPERATIVO") {
        setRespuestas(prev => ({
          ...prev,
          [pregObs.id]: { ...(prev[pregObs.id] || { valor_estado: "" }), respuesta_texto: "" }
        }));
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [todosVisualYFuncionesOperativo, hayInoperativoOObservado]);

  const handleRespuesta = (itemId, valor) => {
    setRespuestas(prev => ({
      ...prev,
      [itemId]: { ...(prev[itemId] || { respuesta_texto: "" }), valor_estado: valor }
    }));
  };

  const handleTextoExtra = (itemId, texto) => {
    setRespuestas(prev => ({
      ...prev,
      [itemId]: { ...(prev[itemId] || { valor_estado: "" }), respuesta_texto: texto }
    }));
  };

  const handleBateriaKeyDown = (e) => {
    if (['-', '+', 'e', 'E', '.', ','].includes(e.key)) {
      e.preventDefault();
    }
  };

  const handleBateriaChange = (itemId, rawValue) => {
    if (rawValue === "") {
      handleTextoExtra(itemId, "");
      return;
    }
    const soloDigitos = rawValue.replace(/\D/g, "");
    if (soloDigitos === "") {
      handleTextoExtra(itemId, "");
      return;
    }
    const numero = parseInt(soloDigitos, 10);
    if (isNaN(numero) || numero < 0 || numero > 100) {
      return;
    }
    handleTextoExtra(itemId, String(numero));
  };

  const handleBateriaBlur = (valorTxt) => {
    if (valorTxt !== "" && !isNaN(Number(valorTxt)) && Number(valorTxt) < 30) {
      alert("Cambiar batería");
    }
  };

  const obtenerRespuestaSiNoSalud = (p) => {
    if (!p) return "";
    const resp = respuestas[p.id];
    if (!resp) return "";

    const txt = (resp.respuesta_texto || "").toUpperCase().trim();
    if (txt === "SI" || txt === "NO") return txt;

    if (esPreguntaTratamiento(p)) {
      if (resp.valor_estado === "INOPERATIVO") return "SI";
      if (resp.valor_estado === "OPERATIVO") return "NO";
    } else {
      if (resp.valor_estado === "OPERATIVO") return "SI";
      if (resp.valor_estado === "INOPERATIVO") return "NO";
    }
    return "";
  };

  const handleRespuestaSalud = (pregunta, opcionSiNo) => {
    const esTratamiento = esPreguntaTratamiento(pregunta);
    const valorEstadoColor = esTratamiento
      ? (opcionSiNo === "SI" ? "INOPERATIVO" : "OPERATIVO")
      : (opcionSiNo === "SI" ? "OPERATIVO" : "INOPERATIVO");

    setRespuestas(prev => {
      const nuevoMapa = {
        ...prev,
        [pregunta.id]: {
          valor_estado: valorEstadoColor,
          respuesta_texto: opcionSiNo
        }
      };

      if (esTratamiento && opcionSiNo === "NO") {
        const pregMed = pregSalud.find(item => esPreguntaMedicamentosDetalle(item));
        if (pregMed) {
          nuevoMapa[pregMed.id] = { valor_estado: "NO_APLICA", respuesta_texto: "" };
        }
      }

      return nuevoMapa;
    });
  };

  const calcularEstadoMaquina = () => {
    const pregVbObj = pregResumen.find(p => esPreguntaVB(p));
    if (pregVbObj && respuestas[pregVbObj.id]?.valor_estado === "INOPERATIVO") {
      return "INOPERATIVO";
    }

    const preguntasMhe = [
      ...pregVisual,
      ...pregFunciones,
      ...pregResumen.filter(p => !esPreguntaObservacion(p))
    ];
    const valoresMhe = preguntasMhe.map(p => respuestas[p.id]?.valor_estado).filter(Boolean);

    if (valoresMhe.includes("INOPERATIVO")) return "INOPERATIVO";
    if (valoresMhe.includes("OBSERVADO")) return "OBSERVADO";
    return "OPERATIVO";
  };

  const preguntasSaludSiNo = pregSalud.filter(p => !esPreguntaMedicamentosDetalle(p));
  const pregTratamientoObj = pregSalud.find(p => esPreguntaTratamiento(p));
  const respuestaTratamiento = obtenerRespuestaSiNoSalud(pregTratamientoObj);

  const calcularEstadoPersonal = () => {
    if (preguntasSaludSiNo.length < 3) return "APTO";

    const r1 = obtenerRespuestaSiNoSalud(preguntasSaludSiNo[0]);
    const r2 = obtenerRespuestaSiNoSalud(preguntasSaludSiNo[1]);
    const r3 = obtenerRespuestaSiNoSalud(preguntasSaludSiNo[2]);

    if (!r1 || !r2 || !r3) return "PENDIENTE";

    // - SÍ SÍ NO = APTO
    if (r1 === "SI" && r2 === "SI" && r3 === "NO") return "APTO";

    // - NO NO SÍ medicamentos = NO APTO
    if (r1 === "NO" && r2 === "NO" && r3 === "SI") return "NO APTO";

    // - NO SÍ NO = OBSERVADO
    if (r1 === "NO" && r2 === "SI" && r3 === "NO") return "NO APTO";

    // - SÍ NO NO = OBSERVADO
    if (r1 === "SI" && r2 === "NO" && r3 === "NO") return "NO APTO";

    // - SÍ SÍ SÍ medicamentos = OBSERVADO
    if (r1 === "SI" && r2 === "SI" && r3 === "SI") return "NO APTO";

    // - NO NO NO = OBSERVADO
    if (r1 === "NO" && r2 === "NO" && r3 === "NO") return "NO APTO";

    // Cualquier otra combinación no listada por defecto como OBSERVADO
    return "NO APTO";
  };


  const estadoMheActual = calcularEstadoMaquina();
  const estadoPersonalActual = calcularEstadoPersonal();

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!formData.equipo_id) return alert("Seleccione un equipo.");

    for (const pBat of pregBateria) {
      const valTxt = String(respuestas[pBat.id]?.respuesta_texto || "").trim();
      if (!valTxt) {
        return alert(`Por favor ingrese el valor de: "${pBat.descripcion}"`);
      }
      const numBat = Number(valTxt);
      if (isNaN(numBat) || numBat < 0 || numBat > 100) {
        return alert("El nivel de batería debe estar entre 0 y 100.");
      }
      if (numBat < 30) {
        return alert("Cambiar batería. No se puede guardar la inspección porque tiene menos de 30% de carga.");
      }
    }

        for (const pCont of pregContador) {
      const valTxt = String(respuestas[pCont.id]?.respuesta_texto || "").trim();
      if (!valTxt) {
        return alert(`Por favor ingrese el valor de: "${pCont.descripcion}"`);
      }
      const numHoro = parseFloat(valTxt);
      if (isNaN(numHoro)) {
        return alert("Ingrese un horómetro válido.");
      }

      // SI ESTAMOS EDITANDO: No castigamos si el horómetro es el mismo o mayor al que ya tenía guardado esta inspección.
      // Si estamos en creación nueva: Validamos estrictamente que sea mayor al anterior.
      if (!esModoEdicion && horometroAnterior !== null && !isNaN(parseFloat(horometroAnterior))) {
        const numAnt = parseFloat(horometroAnterior);
        if (numHoro <= numAnt) {
          return alert(
            `El Horómetro inicio (${numHoro}) debe ser mayor al Horómetro anterior registrado (${numAnt}). Debe colocar un valor mayor a ${numAnt}. No se puede guardar la inspección.`
          );
        }
      }
    }


    const pregBotonesMhe = [
      ...pregVisual,
      ...pregFunciones,
      ...pregResumen.filter(p => !esPreguntaObservacion(p))
    ];
    const pregMheFaltante = pregBotonesMhe.find(p => !respuestas[p.id]?.valor_estado);
    if (pregMheFaltante) {
      return alert(
        `Por favor responda todas las preguntas del checklist.\n\nFalta responder: "${pregMheFaltante.descripcion}"`
      );
    }

    const pregObs = preguntas.find(p => esPreguntaObservacion(p));
    const textoObs = String(
      pregObs ? respuestas[pregObs.id]?.respuesta_texto || "" : formData.observaciones || ""
    ).trim();

    if (hayInoperativoOObservado && (!textoObs || textoObs.toUpperCase() === "OPERATIVO")) {
      return alert(
        'El campo "Describa las observaciones" es obligatorio porque marcó uno o más puntos en Visual o Funciones como Inoperativo (👎) u Observado (👁️).'
      );
    }

    const pregSaludFaltante = preguntasSaludSiNo.find(p => !obtenerRespuestaSiNoSalud(p));
    if (pregSaludFaltante) {
      return alert(
        `Por favor responda todas las preguntas de Estado de Salud.\n\nFalta responder: "${pregSaludFaltante.descripcion}"`
      );
    }

    const pregMedDetalle = pregSalud.find(p => esPreguntaMedicamentosDetalle(p));
    if (respuestaTratamiento === "SI" && pregMedDetalle) {
      const txtMed = String(respuestas[pregMedDetalle.id]?.respuesta_texto || "").trim();
      if (!txtMed) {
        return alert(
          `El comentario es obligatorio: "${pregMedDetalle.descripcion}"`
        );
      }
    }

    if (!formData.vb_operador) {
      return alert("Debe marcar la conformidad (declaración jurada) al final del formulario.");
    }

    setLoading(true);

    try {
      const estadoCalculado = calcularEstadoMaquina();
      const estadoPersonalFinal = calcularEstadoPersonal();
      const fotoEquipoHistorial = equipoSeleccionado?.foto_url || null;

      const textoObservacionGeneral = hayInoperativoOObservado
        ? textoObs
        : (textoObs || "OPERATIVO");

      const detalleMedicamentos =
        respuestaTratamiento === "SI" && pregMedDetalle
          ? String(respuestas[pregMedDetalle.id]?.respuesta_texto || "").trim()
          : null;

      const mapaEstadoPersonalBD = {
        "APTO": "OPERATIVO",
        "OBSERVADO": "OBSERVADO",
        "NO APTO": "INOPERATIVO"
      };
      const estadoPersonalParaBD = mapaEstadoPersonalBD[estadoPersonalFinal] || "OPERATIVO";

      const datosInspeccion = {
        area_id: currentUser.area_id, 
        usuario_id: currentUser.id,   
        registrado_por_dni: currentUser.dni,
        registrado_por_nombre: currentUser.nombre,
        equipo_id: formData.equipo_id,
        foto_equipo: fotoEquipoHistorial, 
        observaciones_generales: textoObservacionGeneral,
        entrevista_somnolencia: detalleMedicamentos,
        vb_operador: formData.vb_operador,
        estado_mhe: estadoCalculado,
        estado_personal: estadoPersonalParaBD,
        chk_ant_estado: checklistAnterior?.estado_mhe || null,
        chk_ant_obs: checklistAnterior?.observaciones_generales || null,
        chk_ant_fecha: checklistAnterior?.fecha_hora || null,
        chk_ant_usuario: checklistAnterior?.registrado_por_nombre || null
      };

      const respuestasArray = Object.keys(respuestas).map(itemId => {
        const preg = preguntas.find(p => String(p.id) === String(itemId));
        const pregSeccion = preg?.seccion;
        let finalValorEstado = respuestas[itemId]?.valor_estado || "";
        let finalRespuestaTexto = respuestas[itemId]?.respuesta_texto || "";

        if (
          pregSeccion === 'BATERIA' ||
          pregSeccion === 'CONTADOR' ||
          esPreguntaObservacion(preg) ||
          esPreguntaMedicamentosDetalle(preg)
        ) {
          finalValorEstado = 'NO_APLICA';
        }

        if (esPreguntaObservacion(preg) && !hayInoperativoOObservado && !finalRespuestaTexto.trim()) {
          finalRespuestaTexto = "OPERATIVO";
        }

        if (esPreguntaMedicamentosDetalle(preg) && respuestaTratamiento !== "SI") {
          finalRespuestaTexto = "";
        }

        return {
          item_id: itemId,
          valor_estado: finalValorEstado,
          respuesta_texto: finalRespuestaTexto
        };
      });

      if (esModoEdicion) {
        await actualizarInspeccionCompleta(inspeccionEditId, datosInspeccion, respuestasArray);
        alert(
          `Inspección actualizada exitosamente.\nEstado MHE: ${estadoCalculado}\nEstado Personal: ${estadoPersonalFinal}`
        );
      } else {
        await guardarInspeccionCompleta(datosInspeccion, respuestasArray);
        alert(
          `Inspección guardada exitosamente.\nEstado MHE: ${estadoCalculado}\nEstado Personal: ${estadoPersonalFinal}`
        );
      }

      navigate('/mhe/tracking_mhe');

    } catch (error) {
      console.error(error);
      alert("Hubo un error al guardar: " + error.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="registro-page">
      {loading && <Loading />}

      <section className="card mb-4">
        <div className="card-head-modern">
          <div className="card-head-left">
            <h2>{esModoEdicion ? 'Editar Inspección MHE' : 'Inspección MHE'}</h2>
            <p>Operador: <strong>{currentUser?.nombre}</strong></p>
          </div>
          <div className="card-head-right">
            <div className="legend-item"><span className="legend-dot auto"></span><span>Área Automática</span></div>
          </div>
        </div>

        <form onSubmit={handleSubmit}>

          {/* LEYENDA AL INICIO */}
          <div className="leyenda-mhe-box">
            <div className="leyenda-mhe-title">Leyenda:</div>
            <div className="leyenda-mhe-grid">
              <div className="leyenda-mhe-item">
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"></path>
                </svg>
                <span>Operativo</span>
              </div>

              <div className="leyenda-mhe-item">
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3zm7-13h2a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-2"></path>
                </svg>
                <span>Inoperativo</span>
              </div>

              <div className="leyenda-mhe-item">
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                  <circle cx="12" cy="12" r="3" fill="currentColor"></circle>
                </svg>
                <span>Observado</span>
              </div>

              <div className="leyenda-mhe-item">
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10"></circle>
                  <line x1="4.93" y1="4.93" x2="19.07" y2="19.07"></line>
                </svg>
                <span>No/Aplica</span>
              </div>
            </div>
          </div>
          
          {/* 1. DATOS DEL EQUIPO */}
          <div className="section-title">Datos del Equipo</div>
          <div className="split-layout datos-equipo-compact">
            <div className="split-panel panel-inputs">
              <div className="field">
                <label>Tipo de Equipo <span className="field-badge manual">OBLIGATORIO</span></label>
                <select value={formData.categoria_id} onChange={handleCategoriaChange} required>
                  <option value="">Seleccione tipo...</option>
                  {categorias.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
                </select>
              </div>
              <div className="field">
                <label>Serie / Código <span className="field-badge manual">OBLIGATORIO</span></label>
                <select value={formData.equipo_id} onChange={handleEquipoChange} required disabled={!formData.categoria_id}>
                  <option value="">Seleccione equipo...</option>
                  {equipos.map(eq => <option key={eq.id} value={eq.id}>{eq.serie}</option>)}
                </select>
              </div>
            </div>

            <div className="split-panel panel-foto">
              {equipoSeleccionado?.foto_url ? (
                <img src={convertirDriveUrl(equipoSeleccionado.foto_url)} alt="Equipo" />
              ) : (
                <span style={{fontSize: '13px', color: '#64748b', fontWeight: '600', textAlign: 'center'}}>
                  {formData.equipo_id ? "Sin foto registrada" : "Seleccione un equipo"}
                </span>
              )}
            </div>
          </div>

          {preguntas.length > 0 && (
            <>
              {/* 2 Y 3. BATERÍA Y CONTADOR */}
              {(pregBateria.length > 0 || pregContador.length > 0) && (
                <div className="form-grid cols-2" style={{marginTop: '24px'}}>
                  
                  {pregBateria.length > 0 && (
                    <div>
                      <div className="section-title" style={{marginTop: 0}}>2. Carga de Batería</div>
                      {pregBateria.map(p => {
                        const valorTxt = respuestas[p.id]?.respuesta_texto || "";
                        const numero = parseInt(valorTxt, 10);
                        const esBateriaBaja = valorTxt !== '' && !isNaN(numero) && numero < 30;
                        let colorClase = 'bat-default';
                        let anchoBarra = 0;

                        if (valorTxt !== '' && !isNaN(numero)) {
                          colorClase = numero < 30 ? 'bat-rojo' : 'bat-verde';
                          const porcentajeReal = Math.min(Math.max(numero, 0), 100); 
                          anchoBarra = (15 * porcentajeReal) / 100;
                        }

                        return (
                          <div className="field" key={p.id}>
                            <label>{p.descripcion} <span className="field-hint">(Rango permitido: 30% - 100%)</span></label>
                            <div className="input-icon-wrapper">
                              <input 
                                type="number" 
                                placeholder="Ej: 80" 
                                min="0" 
                                max="100"
                                value={valorTxt} 
                                onKeyDown={handleBateriaKeyDown}
                                onChange={(e) => handleBateriaChange(p.id, e.target.value)} 
                                onBlur={() => handleBateriaBlur(valorTxt)}
                                className={esBateriaBaja ? 'input-error-border' : ''}
                                required 
                              />
                              <span className={`icon-suffix ${colorClase}`}>
                                <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                  <rect x="2" y="7" width="16" height="10" rx="2" ry="2"></rect>
                                  <line x1="22" y1="11" x2="22" y2="13"></line>
                                  {valorTxt !== '' && !isNaN(numero) && (
                                    <rect x="4" y="9" width={anchoBarra} height="6" fill="currentColor" stroke="none"></rect>
                                  )}
                                </svg>
                              </span>
                            </div>
                            {esBateriaBaja && (
                              <div className="field-error-msg">
                                ⚠️ <strong>Cambiar batería:</strong> La carga es menor a 30%. No se puede usar el equipo ni guardar la inspección.
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {pregContador.length > 0 && (
                    <div>
                      <div className="section-title" style={{marginTop: 0}}>3. Contador / Horómetro</div>
                      {pregContador.map(p => {
                        const valorHoro = respuestas[p.id]?.respuesta_texto || "";
                        
                        // Si estamos editando, no marcamos error visual estricto por el historial anterior
                        const horoInvalido =
                          !esModoEdicion &&
                          valorHoro !== "" &&
                          horometroAnterior !== null &&
                          !isNaN(parseFloat(valorHoro)) &&
                          !isNaN(parseFloat(horometroAnterior)) &&
                          parseFloat(valorHoro) <= parseFloat(horometroAnterior);

                        return (
                          <div className="field" key={p.id}>
                            <label>
                              {p.descripcion}
                              {horometroAnterior !== null && (
                                <span className="horometro-prev-badge">
                                  Anterior: {horometroAnterior}
                                </span>
                              )}
                            </label>
                            <input
                              type="number"
                              step="any"
                              placeholder={horometroAnterior !== null ? `Mayor a ${horometroAnterior}` : "Ej: 12500"}
                              value={valorHoro}
                              onChange={(e) => handleTextoExtra(p.id, e.target.value)}
                              className={horoInvalido ? 'input-error-border' : ''}
                              required
                            />
                            {horoInvalido && (
                              <div className="field-error-msg">
                                ⚠️ El horómetro ({valorHoro}) es menor o igual al anterior ({horometroAnterior}). Debe colocar un valor <strong>mayor a {horometroAnterior}</strong>.
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* 4. INSPECCIÓN VISUAL */}
              {pregVisual.length > 0 && (
                <>
                  <div className="section-title">4. Inspección Visual</div>
                  <div className="form-grid cols-2" style={{marginBottom: '24px'}}>
                    {pregVisual.map(p => (
                      <div className="checklist-card-2col" key={p.id}>
                        <div className="checklist-question-2col">{p.descripcion}</div>
                        <div className="checklist-options-2col">
                          <button type="button" className={`icon-btn ${respuestas[p.id]?.valor_estado === 'OPERATIVO' ? 'selected OPERATIVO' : ''}`} onClick={() => handleRespuesta(p.id, 'OPERATIVO')} title="Operativo">
                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"></path></svg>
                          </button>
                          <button type="button" className={`icon-btn ${respuestas[p.id]?.valor_estado === 'INOPERATIVO' ? 'selected INOPERATIVO' : ''}`} onClick={() => handleRespuesta(p.id, 'INOPERATIVO')} title="Inoperativo">
                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3zm7-13h2a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-2"></path></svg>
                          </button>
                          <button type="button" className={`icon-btn ${respuestas[p.id]?.valor_estado === 'OBSERVADO' ? 'selected OBSERVADO' : ''}`} onClick={() => handleRespuesta(p.id, 'OBSERVADO')} title="Observado">
                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>
                          </button>
                          <button type="button" className={`icon-btn ${respuestas[p.id]?.valor_estado === 'NO_APLICA' ? 'selected NO_APLICA' : ''}`} onClick={() => handleRespuesta(p.id, 'NO_APLICA')} title="No Aplica">
                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"></line></svg>
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}

              {/* 5. INSPECCIÓN DE FUNCIONES */}
              {pregFunciones.length > 0 && (
                <>
                  <div className="section-title">5. Inspección de Funciones</div>
                  <div className="form-grid cols-2" style={{marginBottom: '24px'}}>
                    {pregFunciones.map(p => (
                      <div className="checklist-card-2col" key={p.id}>
                        <div className="checklist-question-2col">{p.descripcion}</div>
                        <div className="checklist-options-2col">
                          <button type="button" className={`icon-btn ${respuestas[p.id]?.valor_estado === 'OPERATIVO' ? 'selected OPERATIVO' : ''}`} onClick={() => handleRespuesta(p.id, 'OPERATIVO')} title="Operativo">
                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"></path></svg>
                          </button>
                          <button type="button" className={`icon-btn ${respuestas[p.id]?.valor_estado === 'INOPERATIVO' ? 'selected INOPERATIVO' : ''}`} onClick={() => handleRespuesta(p.id, 'INOPERATIVO')} title="Inoperativo">
                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3zm7-13h2a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-2"></path></svg>
                          </button>
                          <button type="button" className={`icon-btn ${respuestas[p.id]?.valor_estado === 'OBSERVADO' ? 'selected OBSERVADO' : ''}`} onClick={() => handleRespuesta(p.id, 'OBSERVADO')} title="Observado">
                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>
                          </button>
                          <button type="button" className={`icon-btn ${respuestas[p.id]?.valor_estado === 'NO_APLICA' ? 'selected NO_APLICA' : ''}`} onClick={() => handleRespuesta(p.id, 'NO_APLICA')} title="No Aplica">
                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"></line></svg>
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}

              {/* 6. RESUMEN DE LA EVALUACIÓN */}
              {pregResumen.length > 0 && (
                <>
                  <div className="section-title-row">
                    <div className="section-title" style={{marginBottom: 0}}>6. Resumen de la evaluación del equipo</div>
                    <div className="status-pill-wrapper">
                      <span className="status-pill-label">Estado MHE:</span>
                      <span className={`hist-badge ${estadoMheActual}`}>{estadoMheActual}</span>
                    </div>
                  </div>

                  <div className="form-grid cols-2" style={{marginBottom: '24px', marginTop: '12px'}}>
                    {pregResumen.map(p => {
                      const esObservacion = esPreguntaObservacion(p);
                      const esVB = esPreguntaVB(p);
                      const textoObsActual = respuestas[p.id]?.respuesta_texto || "";
                      const faltaObsObligatoria =
                        esObservacion &&
                        hayInoperativoOObservado &&
                        (!textoObsActual.trim() || textoObsActual.trim().toUpperCase() === "OPERATIVO");

                      return (
                        <div className="checklist-card-2col" key={p.id} style={esObservacion ? {flexDirection: 'column', alignItems: 'stretch', gap: '10px'} : {}}>
                          {esObservacion ? (
                            <>
                              <div className="checklist-question-2col" style={{padding: 0, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px'}}>
                                <span>{p.descripcion}</span>
                                {hayInoperativoOObservado ? (
                                  <span className="field-badge manual">OBLIGATORIO</span>
                                ) : (
                                  <span className="field-badge optional-ok">OPCIONAL (OPERATIVO)</span>
                                )}
                              </div>
                              <input 
                                type="text" 
                                placeholder={
                                  hayInoperativoOObservado
                                    ? "Obligatorio: Describa el motivo de Inoperativo u Observado..."
                                    : "OPERATIVO"
                                }
                                value={textoObsActual} 
                                onChange={(e) => handleTextoExtra(p.id, e.target.value)} 
                                className={faltaObsObligatoria ? 'input-error-border' : ''}
                                style={{padding: '8px 12px', borderRadius: '6px', border: '1px solid #cbd5e1', width: '100%', fontSize: '13px', background: '#f8fafc'}}
                              />
                              {faltaObsObligatoria && (
                                <div className="field-error-msg">
                                  ⚠️ Debe describir las observaciones porque marcó ítems con 👎 o 👁️.
                                </div>
                              )}
                            </>
                          ) : (
                            <>
                              <div className="checklist-question-2col">{p.descripcion}</div>
                              <div className="checklist-options-2col">
                                <button type="button" className={`icon-btn ${respuestas[p.id]?.valor_estado === 'OPERATIVO' ? 'selected OPERATIVO' : ''}`} onClick={() => handleRespuesta(p.id, 'OPERATIVO')} title="Operativo">
                                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"></path></svg>
                                </button>
                                <button type="button" className={`icon-btn ${respuestas[p.id]?.valor_estado === 'INOPERATIVO' ? 'selected INOPERATIVO' : ''}`} onClick={() => handleRespuesta(p.id, 'INOPERATIVO')} title="Inoperativo">
                                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3zm7-13h2a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-2"></path></svg>
                                </button>
                                {!esVB && (
                                  <button type="button" className={`icon-btn ${respuestas[p.id]?.valor_estado === 'OBSERVADO' ? 'selected OBSERVADO' : ''}`} onClick={() => handleRespuesta(p.id, 'OBSERVADO')} title="Observado">
                                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>
                                  </button>
                                )}
                              </div>
                            </>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </>
              )}

              {/* 7. ESTADO DE SALUD */}
              {pregSalud.length > 0 && (
                <>
                  <div className="section-title-row">
                    <div className="section-title" style={{marginBottom: 0}}>7. Estado de Salud</div>
                    <div className="status-pill-wrapper">
                      <span className="status-pill-label">Condición:</span>
                      <span className={`salud-badge ${estadoPersonalActual.replace(/\s+/g, '_')}`}>
                        {estadoPersonalActual}
                      </span>
                    </div>
                  </div>

                  <div className="form-grid cols-2" style={{marginBottom: '24px', marginTop: '12px'}}>
                    {pregSalud.map(p => {
                      const esDetalleMed = esPreguntaMedicamentosDetalle(p);
                      const esTratamiento = esPreguntaTratamiento(p);

                      if (esDetalleMed) {
                        if (respuestaTratamiento !== "SI") {
                          return null;
                        }
                        const valorMed = respuestas[p.id]?.respuesta_texto || "";
                        return (
                          <div
                            className="checklist-card-2col salud-med-card"
                            key={p.id}
                            style={{flexDirection: 'column', alignItems: 'stretch', gap: '8px'}}
                          >
                            <div className="checklist-question-2col" style={{padding: 0, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px'}}>
                              <span>{p.descripcion}</span>
                              <span className="field-badge manual">OBLIGATORIO</span>
                            </div>
                            <input
                              type="text"
                              placeholder="Indique qué medicamentos y por cuánto tiempo..."
                              value={valorMed}
                              onChange={(e) => handleTextoExtra(p.id, e.target.value)}
                              className={!valorMed.trim() ? 'input-error-border' : ''}
                              style={{padding: '8px 12px', borderRadius: '6px', border: '1px solid #cbd5e1', width: '100%', fontSize: '13px', background: '#f8fafc'}}
                              required
                            />
                          </div>
                        );
                      }

                      const respSiNo = obtenerRespuestaSiNoSalud(p);

                      const claseBotonSi =
                        respSiNo === "SI"
                          ? `selected ${esTratamiento ? 'INOPERATIVO' : 'OPERATIVO'}`
                          : '';
                      const claseBotonNo =
                        respSiNo === "NO"
                          ? `selected ${esTratamiento ? 'OPERATIVO' : 'INOPERATIVO'}`
                          : '';

                      return (
                        <div className="checklist-card-2col" key={p.id} style={{flexDirection: 'column', alignItems: 'stretch', justifyContent: 'center'}}>
                          <div className="salud-row">
                            <div className="checklist-question-2col">{p.descripcion}</div>
                            <div className="checklist-options-2col">
                              <button
                                type="button"
                                className={`icon-btn ${claseBotonSi}`}
                                onClick={() => handleRespuestaSalud(p, 'SI')}
                                style={{width: 'auto', padding: '0 12px', fontSize: '12px', fontWeight: 'bold'}}
                              >
                                SÍ
                              </button>
                              <button
                                type="button"
                                className={`icon-btn ${claseBotonNo}`}
                                onClick={() => handleRespuestaSalud(p, 'NO')}
                                style={{width: 'auto', padding: '0 12px', fontSize: '12px', fontWeight: 'bold'}}
                              >
                                NO
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </>
              )}

              {/* 8. DATOS DEL CHECKLIST ANTERIOR */}
              <div className="section-title">8. Datos del Check List Anterior</div>
              
              {checklistAnterior ? (
                <div className="historial-compact-card">
                  <div className="historial-grid">
                    <div className="hist-item">
                      <span className="hist-label">Estado:</span>
                      <span className={`hist-badge ${checklistAnterior.estado_mhe}`}>
                        {checklistAnterior.estado_mhe === 'OPERATIVO' ? '👍' : checklistAnterior.estado_mhe === 'OBSERVADO' ? '👁️' : '👎'} 
                        {checklistAnterior.estado_mhe}
                      </span>
                    </div>
                    <div className="hist-item">
                      <span className="hist-label">Registrado el:</span>
                      <span className="hist-value">
                        {checklistAnterior.fecha_hora ? new Date(checklistAnterior.fecha_hora).toLocaleString('es-PE', { dateStyle: 'short', timeStyle: 'short' }) : '-'}
                      </span>
                    </div>
                    <div className="hist-item">
                      <span className="hist-label">Operador:</span>
                      <span className="hist-value">{checklistAnterior.registrado_por_nombre || '-'}</span>
                    </div>
                    
                  </div>
                  
                  <div className="hist-item hist-obs">
                    <span className="hist-label">Observación:</span>
                    <span className="hist-value" style={{fontWeight: '500'}}>
                      {checklistAnterior.observaciones_generales || 'Ninguna observación registrada.'}
                    </span>
                  </div>
                </div>
              ) : (
                <div className="historial-compact-card empty">
                  No hay inspecciones previas para este equipo.
                </div>
              )}

              {/* DECLARAR */}
              <label 
                htmlFor="vb_operador" 
                className={`declaracion-card ${formData.vb_operador ? 'is-checked' : ''}`}
              >
                <input 
                  type="checkbox" 
                  id="vb_operador" 
                  checked={formData.vb_operador} 
                  onChange={(e) => setFormData({...formData, vb_operador: e.target.checked})} 
                />
                
                <div className="custom-chk">
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12"></polyline>
                  </svg>
                </div>

                <div className="declaracion-texto">
                  <span className="declaracion-tag">Conformidad del Operador</span>
                  <p>Declaro que el equipo se encuentra en las condiciones indicadas en este checklist.</p>
                </div>
              </label>

              <div className="submit-row">
                <button type="button" className="secondary-btn" onClick={() => navigate('/mhe/tracking_mhe')}>Cancelar</button>
                <button type="submit" className="primary-btn" disabled={loading}>
                  {esModoEdicion ? 'Actualizar Inspección' : 'Guardar Inspección'}
                </button>
              </div>
            </>
          )}
        </form>
      </section>
    </div>
  );
}