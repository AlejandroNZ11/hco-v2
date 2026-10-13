import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import Loading from '../../layouts/Loading';
import './mhe_evaluar.css';
import '../usuarios/registra_usuario.css';

// Importamos los servicios de MHE
import { 
  obtenerDatosMaestrosMhe, 
  obtenerUltimaInspeccionEquipo, 
  guardarInspeccionCompleta 
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

export default function MheEvaluar() {
  const navigate = useNavigate();
  const [currentUser] = useState(() => getStoredAuthUser());

  const [loading, setLoading] = useState(false);
  
  // Variables maestras que guardan toda la BD al inicio
  const [categorias, setCategorias] = useState([]);
  const [todosEquipos, setTodosEquipos] = useState([]);
  const [todasPreguntas, setTodasPreguntas] = useState([]);
  
  // Variables que se muestran en pantalla (filtradas)
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

  // 1. Cargar TODOS los datos maestros de golpe al abrir la pantalla
  useEffect(() => {
    if (!currentUser) {
      alert("Inicie sesión para continuar.");
      navigate('/');
      return;
    }
    cargarDatosMaestros();
  }, [currentUser, navigate]);

  const cargarDatosMaestros = async () => {
    setLoading(true);
    try {
      // USANDO EL SERVICIO
      const data = await obtenerDatosMaestrosMhe();
      setCategorias(data.categorias);
      setTodosEquipos(data.equipos);
      setTodasPreguntas(data.preguntas);
    } catch (error) {
      alert("Error al conectar con la base de datos: " + error.message);
    } finally {
      setLoading(false);
    }
  };

  // 2. Al cambiar categoría, se filtra localmente (¡INSTANTÁNEO!)
  const handleCategoriaChange = (e) => {
    const catId = e.target.value;
    
    // Limpiamos los datos de la pantalla
    setFormData({ ...formData, categoria_id: catId, equipo_id: "" });
    setEquipoSeleccionado(null);
    setChecklistAnterior(null);

    if (!catId) {
      setEquipos([]);
      setPreguntas([]);
      setRespuestas({});
      return;
    }

    // Filtramos directamente de la memoria (sin usar internet)
    const eqFiltrados = todosEquipos.filter(eq => eq.categoria_id === catId);
    setEquipos(eqFiltrados);

    const pregFiltradas = todasPreguntas.filter(p => p.categoria_id === catId);
    setPreguntas(pregFiltradas);

    // Inicializamos las respuestas vacías
    const initResp = {};
    pregFiltradas.forEach(p => {
      initResp[p.id] = { valor_estado: "", respuesta_texto: "" };
    });
    setRespuestas(initResp);
  };

  // 3. Al seleccionar un equipo, cargar su foto y su último checklist
  const handleEquipoChange = async (e) => {
    const eqId = e.target.value;
    setFormData({ ...formData, equipo_id: eqId });
    
    // Buscar la foto del equipo seleccionado
    const eq = equipos.find(x => x.id === eqId);
    setEquipoSeleccionado(eq || null);

    setChecklistAnterior(null);
    if (!eqId) return;

    // USANDO EL SERVICIO PARA BUSCAR HISTORIAL ANTERIOR
    try {
      const data = await obtenerUltimaInspeccionEquipo(eqId);
      if (data) setChecklistAnterior(data);
    } catch (error) {
      console.error(error.message);
    }
  };

  // Manejo de respuestas de Botones
  const handleRespuesta = (itemId, valor) => {
    setRespuestas(prev => ({
      ...prev,
      [itemId]: { ...prev[itemId], valor_estado: valor }
    }));
  };

  // Manejo de respuestas de Texto/Número (Batería, Contador, Detalles)
  const handleTextoExtra = (itemId, texto) => {
    setRespuestas(prev => ({
      ...prev,
      [itemId]: { ...prev[itemId], respuesta_texto: texto }
    }));
  };

  const calcularEstadoMaquina = () => {
    const valores = Object.values(respuestas).map(r => r.valor_estado);
    if (valores.includes("INOPERATIVO")) return "INOPERATIVO";
    if (valores.includes("OBSERVADO")) return "OBSERVADO";
    return "OPERATIVO";
  };

  // Función auxiliar para detectar si la pregunta es el cuadro de texto de observaciones
  const esPreguntaObservacion = (p) => {
    const texto = (p?.descripcion || "").toLowerCase();
    return p?.seccion === 'RESUMEN' && (texto.includes('describa') || texto.includes('observacion'));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!formData.equipo_id) return alert("Seleccione un equipo.");
    
    // Validación inteligente solo de las secciones visibles
    const seccionesVisibles = ['BATERIA', 'CONTADOR', 'VISUAL', 'FUNCIONES', 'RESUMEN', 'SALUD'];
    
    const preguntaFaltante = preguntas.find(p => {
      // Si la pregunta no pertenece a ninguna sección en pantalla, no bloquea
      if (!seccionesVisibles.includes(p.seccion)) return false;

      const resp = respuestas[p.id];
      if (!resp) return true;

      // 1. Si es la caja de texto de Observaciones en Resumen, no exige botón (es opcional)
      if (esPreguntaObservacion(p)) {
        return false;
      }

      // 2. Si es Batería o Contador, exigir que haya escrito un valor
      if (p.seccion === 'BATERIA' || p.seccion === 'CONTADOR') {
        return !String(resp.respuesta_texto || "").trim();
      }

      // 3. Para el resto de preguntas con botones, exigir que haya marcado un botón
      return !resp.valor_estado;
    });

    if (preguntaFaltante) {
      return alert(`Por favor responda todas las preguntas del checklist.\n\nFalta responder: "${preguntaFaltante.descripcion}"`);
    }

    if (!formData.vb_operador) {
      return alert("Debe marcar la conformidad (declaración jurada) al final del formulario.");
    }

    setLoading(true);

    try {
      const estadoCalculado = calcularEstadoMaquina();
      const fotoEquipoHistorial = equipoSeleccionado?.foto_url || null;

      // Extraemos el texto de la pregunta de observación para guardarlo en la cabecera de Supabase
      const pregObs = preguntas.find(p => esPreguntaObservacion(p));
      const textoObservacionGeneral = pregObs 
        ? (respuestas[pregObs.id]?.respuesta_texto?.trim() || formData.observaciones || null)
        : (formData.observaciones || null);

      // Extraemos detalles de salud si escribió algo en la sección 7 (para entrevista_somnolencia)
      const textosSalud = pregSalud
        .map(p => respuestas[p.id]?.respuesta_texto?.trim())
        .filter(Boolean)
        .join(" | ");

      // Armamos el objeto de cabecera para Supabase
      const datosInspeccion = {
        area_id: currentUser.area_id, 
        usuario_id: currentUser.id,   
        registrado_por_dni: currentUser.dni,
        registrado_por_nombre: currentUser.nombre,
        equipo_id: formData.equipo_id,
        foto_equipo: fotoEquipoHistorial, 
        observaciones_generales: textoObservacionGeneral,
        entrevista_somnolencia: textosSalud || null,
        vb_operador: formData.vb_operador,
        estado_mhe: estadoCalculado,
        estado_personal: 'OPERATIVO',
        chk_ant_estado: checklistAnterior?.estado_mhe || null,
        chk_ant_obs: checklistAnterior?.observaciones_generales || null,
        chk_ant_fecha: checklistAnterior?.fecha_hora || null,
        chk_ant_usuario: checklistAnterior?.registrado_por_nombre || null
      };

      // Armamos el array de respuestas individuales para el detalle
      const respuestasArray = Object.keys(respuestas).map(itemId => {
        const preg = preguntas.find(p => p.id === itemId);
        const pregSeccion = preg?.seccion;
        let finalValorEstado = respuestas[itemId].valor_estado;

        // Si es un campo de texto (Batería, Contador u Observación), su estado pasa como NO_APLICA
        if (pregSeccion === 'BATERIA' || pregSeccion === 'CONTADOR' || esPreguntaObservacion(preg)) {
          finalValorEstado = 'NO_APLICA'; 
        }

        return {
          item_id: itemId,
          valor_estado: finalValorEstado,
          respuesta_texto: respuestas[itemId].respuesta_texto
        };
      });

      // USANDO EL SERVICIO PARA GUARDAR TODO
      await guardarInspeccionCompleta(datosInspeccion, respuestasArray);

      alert(`Inspección guardada exitosamente. Estado Final: ${estadoCalculado}`);
      navigate('/mhe/tracking_mhe');

    } catch (error) {
      console.error(error);
      alert("Hubo un error al guardar: " + error.message);
    } finally {
      setLoading(false);
    }
  };

  // Agrupación de preguntas
  const pregBateria = preguntas.filter(p => p.seccion === 'BATERIA');
  const pregContador = preguntas.filter(p => p.seccion === 'CONTADOR');
  const pregVisual = preguntas.filter(p => p.seccion === 'VISUAL');
  const pregFunciones = preguntas.filter(p => p.seccion === 'FUNCIONES');
  const pregResumen = preguntas.filter(p => p.seccion === 'RESUMEN');
  const pregSalud = preguntas.filter(p => p.seccion === 'SALUD');

  // EL RETURN SE MANTIENE EXACTAMENTE IGUAL A PARTIR DE AQUÍ
  return (
    <div className="registro-page">
      {loading && <Loading />}

      <section className="card mb-4">
        <div className="card-head-modern">
          <div className="card-head-left">
            <h2>Inspección MHE</h2>
            <p>Operador: <strong>{currentUser?.nombre}</strong></p>
          </div>
          <div className="card-head-right">
             <div className="legend-item"><span className="legend-dot auto"></span><span>Área Automática</span></div>
          </div>
        </div>

        <form onSubmit={handleSubmit}>
          
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
                        const valorTxt = respuestas[p.id].respuesta_texto;
                        const numero = parseInt(valorTxt, 10);
                        let colorClase = 'bat-default';
                        let anchoBarra = 0;

                        if (valorTxt !== '' && !isNaN(numero)) {
                          colorClase = numero <= 30 ? 'bat-rojo' : 'bat-verde';
                          const porcentajeReal = Math.min(Math.max(numero, 0), 100); 
                          anchoBarra = (15 * porcentajeReal) / 100;
                        }

                        return (
                          <div className="field" key={p.id}>
                            <label>{p.descripcion}</label>
                            <div className="input-icon-wrapper">
                              <input 
                                type="number" 
                                placeholder="Ej: 80" 
                                min="0" 
                                max="100"
                                value={valorTxt} 
                                onChange={(e) => handleTextoExtra(p.id, e.target.value)} 
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
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {pregContador.length > 0 && (
                    <div>
                      <div className="section-title" style={{marginTop: 0}}>3. Contador</div>
                      {pregContador.map(p => (
                        <div className="field" key={p.id}>
                          <label>{p.descripcion}</label>
                          <input type="number" placeholder="Ej: 12500" value={respuestas[p.id].respuesta_texto} onChange={(e) => handleTextoExtra(p.id, e.target.value)} required />
                        </div>
                      ))}
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
                          <button type="button" className={`icon-btn ${respuestas[p.id].valor_estado === 'OPERATIVO' ? 'selected OPERATIVO' : ''}`} onClick={() => handleRespuesta(p.id, 'OPERATIVO')} title="Operativo">
                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"></path></svg>
                          </button>
                          <button type="button" className={`icon-btn ${respuestas[p.id].valor_estado === 'INOPERATIVO' ? 'selected INOPERATIVO' : ''}`} onClick={() => handleRespuesta(p.id, 'INOPERATIVO')} title="Inoperativo">
                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3zm7-13h2a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-2"></path></svg>
                          </button>
                          <button type="button" className={`icon-btn ${respuestas[p.id].valor_estado === 'OBSERVADO' ? 'selected OBSERVADO' : ''}`} onClick={() => handleRespuesta(p.id, 'OBSERVADO')} title="Observado">
                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>
                          </button>
                          <button type="button" className={`icon-btn ${respuestas[p.id].valor_estado === 'NO_APLICA' ? 'selected NO_APLICA' : ''}`} onClick={() => handleRespuesta(p.id, 'NO_APLICA')} title="No Aplica">
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
                          <button type="button" className={`icon-btn ${respuestas[p.id].valor_estado === 'OPERATIVO' ? 'selected OPERATIVO' : ''}`} onClick={() => handleRespuesta(p.id, 'OPERATIVO')} title="Operativo">
                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"></path></svg>
                          </button>
                          <button type="button" className={`icon-btn ${respuestas[p.id].valor_estado === 'INOPERATIVO' ? 'selected INOPERATIVO' : ''}`} onClick={() => handleRespuesta(p.id, 'INOPERATIVO')} title="Inoperativo">
                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3zm7-13h2a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-2"></path></svg>
                          </button>
                          <button type="button" className={`icon-btn ${respuestas[p.id].valor_estado === 'OBSERVADO' ? 'selected OBSERVADO' : ''}`} onClick={() => handleRespuesta(p.id, 'OBSERVADO')} title="Observado">
                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>
                          </button>
                          <button type="button" className={`icon-btn ${respuestas[p.id].valor_estado === 'NO_APLICA' ? 'selected NO_APLICA' : ''}`} onClick={() => handleRespuesta(p.id, 'NO_APLICA')} title="No Aplica">
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
                  <div className="section-title">6. Resumen de la evaluación del equipo</div>
                  <div className="form-grid cols-2" style={{marginBottom: '24px'}}>
                    {pregResumen.map(p => {
                      const textoMinuscula = p.descripcion.toLowerCase();
                      const esObservacion = textoMinuscula.includes('describa') || textoMinuscula.includes('observacion');
                      const esVB = textoMinuscula.includes('vb operador');

                      return (
                        <div className="checklist-card-2col" key={p.id} style={esObservacion ? {flexDirection: 'column', alignItems: 'stretch', gap: '10px'} : {}}>
                          {esObservacion ? (
                            <>
                              <div className="checklist-question-2col" style={{padding: 0}}>{p.descripcion}</div>
                              <input 
                                type="text" 
                                placeholder="Escriba aquí sus observaciones..." 
                                value={respuestas[p.id].respuesta_texto} 
                                onChange={(e) => handleTextoExtra(p.id, e.target.value)} 
                                style={{padding: '8px 12px', borderRadius: '6px', border: '1px solid #cbd5e1', width: '100%', fontSize: '13px', background: '#f8fafc'}}
                              />
                            </>
                          ) : (
                            <>
                              <div className="checklist-question-2col">{p.descripcion}</div>
                              <div className="checklist-options-2col">
                                <button type="button" className={`icon-btn ${respuestas[p.id].valor_estado === 'OPERATIVO' ? 'selected OPERATIVO' : ''}`} onClick={() => handleRespuesta(p.id, 'OPERATIVO')} title="Bueno">
                                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"></path></svg>
                                </button>
                                <button type="button" className={`icon-btn ${respuestas[p.id].valor_estado === 'INOPERATIVO' ? 'selected INOPERATIVO' : ''}`} onClick={() => handleRespuesta(p.id, 'INOPERATIVO')} title="Malo">
                                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3zm7-13h2a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-2"></path></svg>
                                </button>
                                {!esVB && (
                                  <button type="button" className={`icon-btn ${respuestas[p.id].valor_estado === 'OBSERVADO' ? 'selected OBSERVADO' : ''}`} onClick={() => handleRespuesta(p.id, 'OBSERVADO')} title="Observado">
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
                  <div className="section-title">7. Estado de Salud</div>
                  <div className="form-grid cols-2" style={{marginBottom: '24px'}}>
                    {pregSalud.map(p => (
                      <div className="checklist-card-2col" key={p.id} style={{flexDirection: 'column', alignItems: 'stretch'}}>
                        <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%'}}>
                          <div className="checklist-question-2col">{p.descripcion}</div>
                          <div className="checklist-options-2col">
                            <button type="button" className={`icon-btn ${respuestas[p.id].valor_estado === 'OPERATIVO' ? 'selected OPERATIVO' : ''}`} onClick={() => handleRespuesta(p.id, 'OPERATIVO')} style={{width: 'auto', padding: '0 12px', fontSize: '12px', fontWeight: 'bold'}}>
                              SÍ
                            </button>
                            <button type="button" className={`icon-btn ${respuestas[p.id].valor_estado === 'INOPERATIVO' ? 'selected INOPERATIVO' : ''}`} onClick={() => handleRespuesta(p.id, 'INOPERATIVO')} style={{width: 'auto', padding: '0 12px', fontSize: '12px', fontWeight: 'bold'}}>
                              NO
                            </button>
                          </div>
                        </div>
                        {respuestas[p.id].valor_estado !== '' && (
                          <input type="text" placeholder="Detalles adicionales (Opcional)" value={respuestas[p.id].respuesta_texto} onChange={(e) => handleTextoExtra(p.id, e.target.value)} style={{marginTop: '12px', padding: '8px', borderRadius: '6px', border: '1px solid #cbd5e1', width: '100%', fontSize: '13px'}}/>
                        )}
                      </div>
                    ))}
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
                        {new Date(checklistAnterior.fecha_hora).toLocaleString('es-PE', { dateStyle: 'short', timeStyle: 'short' })}
                      </span>
                    </div>
                    <div className="hist-item">
                      <span className="hist-label">Operador:</span>
                      <span className="hist-value">{checklistAnterior.registrado_por_nombre}</span>
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
              <div style={{marginTop: '20px', background: '#f8fafc', padding: '16px', borderRadius: '8px', border: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', gap: '12px'}}>
                <input type="checkbox" id="vb_operador" checked={formData.vb_operador} onChange={(e) => setFormData({...formData, vb_operador: e.target.checked})} style={{width: '20px', height: '20px', cursor: 'pointer'}} />
                <label htmlFor="vb_operador" style={{fontWeight: '700', color: '#0f172a', cursor: 'pointer', margin: 0}}>Declaro que el equipo se encuentra en las condiciones indicadas en este checklist.</label>
              </div>

              <div className="submit-row">
                <button type="button" className="secondary-btn" onClick={() => navigate('/mhe/tracking_mhe')}>Cancelar</button>
                <button type="submit" className="primary-btn" disabled={loading}>Guardar Inspección</button>
              </div>
            </>
          )}
        </form>
      </section>
    </div>
  );
}