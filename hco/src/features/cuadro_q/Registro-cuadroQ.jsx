import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate, useLocation, useSearchParams } from 'react-router-dom';
import Loading from '../../layouts/Loading';
import './Registro-cuadroQ.css';

import {
  obtenerCatalogosCuadroQ,
  obtenerErroresPorNombreArea,
  obtenerCuadroQPorId,
  crearRegistroCuadroQ,
  actualizarRegistroCuadroQ
} from '../../services/cuadroQService';
import { useLiveQuery } from 'dexie-react-hooks';
import { localDb } from '../../services/localDb';

function getStoredAuthUser() {
  const raw = localStorage.getItem("authUser") || sessionStorage.getItem("authUser");
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

export default function RegistroCuadroQ() {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();

  const registroEditId = searchParams.get('id') || location.state?.registro?.id || null;
  const esModoAnalisis = Boolean(registroEditId);

  const [currentUser] = useState(() => getStoredAuthUser());
  const [loading, setLoading] = useState(false);

  const [todasAreas, setTodasAreas] = useState([]);
  const [areasError, setAreasError] = useState([]);
  const [personalWhite, setPersonalWhite] = useState([]);

  const usuariosDb = useLiveQuery(
    () => (localDb?.usuarios ? localDb.usuarios.toArray() : []),
    [],
    []
  );

  // Estado del formulario (Registro + Análisis)
  const [formData, setFormData] = useState({
    id_cuadro_q: "AUTOMÁTICO",
    fecha_registro: "",
    registrador_id: "",
    nombre_registrador: "",
    area_registrador: "",

    area_error_id: "",
    area_error: "",
    proceso: "",
    error: "",
    descripcion_error: "",
    estado: "PENDIENTE",

    // Fase 2: Análisis
    responsabilidad: "",
    impacto: "",
    pdca: "",
    evaluacion: "",
    motivo_cancelacion: "",
    responsable_id: "",
    responsable: "",
    fecha_planificada: "",
    medida: "",
    causa_raiz: "",
    fecha_cierre: "",
    fecha_hora_actualiza: "",
    usuario_actualiza: ""
  });

  // Modal de aviso flotante (mismo estilo que mhe_evaluar)
  const [avisoFlotante, setAvisoFlotante] = useState({
    visible: false,
    tipo: 'danger',
    titulo: '',
    mensaje: '',
    detalleExtra: '',
    onCloseCallback: null
  });

  const mostrarAviso = (tipo, titulo, mensaje, detalleExtra = '', onCloseCallback = null) => {
    setAvisoFlotante({
      visible: true,
      tipo,
      titulo,
      mensaje,
      detalleExtra,
      onCloseCallback
    });
  };

  const cerrarAviso = () => {
    const callback = avisoFlotante.onCloseCallback;
    setAvisoFlotante((prev) => ({ ...prev, visible: false, onCloseCallback: null }));
    if (typeof callback === 'function') callback();
  };

  // Resolver el área del usuario logueado
  const areaDelUsuarioLogueado = useMemo(() => {
    if (!currentUser) return "SIN ÁREA";

    const directo =
      currentUser?.area_nombre ||
      currentUser?.area?.nombre ||
      currentUser?.areas?.nombre ||
      (typeof currentUser?.area === 'string' ? currentUser.area : '');

    if (directo) return String(directo).toUpperCase().trim();

    if (currentUser?.area_id && todasAreas.length > 0) {
      const encontrada = todasAreas.find((a) => String(a.id) === String(currentUser.area_id));
      if (encontrada?.nombre) return String(encontrada.nombre).toUpperCase().trim();
    }

    const userLocal = usuariosDb.find((u) => String(u.id) === String(currentUser?.id));
    if (userLocal?.area?.nombre) return String(userLocal.area.nombre).toUpperCase().trim();
    if (userLocal?.area_id && todasAreas.length > 0) {
      const encontrada = todasAreas.find((a) => String(a.id) === String(userLocal.area_id));
      if (encontrada?.nombre) return String(encontrada.nombre).toUpperCase().trim();
    }

    return "GENERAL";
  }, [currentUser, todasAreas, usuariosDb]);

  useEffect(() => {
    if (!currentUser) {
      navigate('/');
      return;
    }
    inicializarDatos();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser, navigate, registroEditId]);

  // Actualizar nombre y área del registrador cuando es un registro nuevo
  useEffect(() => {
    if (!esModoAnalisis && currentUser) {
      setFormData((prev) => ({
        ...prev,
        registrador_id: currentUser.id || "",
        nombre_registrador: currentUser.nombre || "Usuario",
        area_registrador: areaDelUsuarioLogueado
      }));
    }
  }, [esModoAnalisis, currentUser, areaDelUsuarioLogueado]);

  const inicializarDatos = async () => {
    setLoading(true);
    try {
      const catalogos = await obtenerCatalogosCuadroQ();
      setTodasAreas(catalogos.todasAreas);
      setAreasError(catalogos.areasError);
      setPersonalWhite(catalogos.personalWhite);

      if (registroEditId) {
        const reg = await obtenerCuadroQPorId(registroEditId);
        setFormData({
          id_cuadro_q: reg.id_cuadro_q || "-",
          fecha_registro: reg.fecha_registro || "",
          registrador_id: reg.registrador_id || "",
          nombre_registrador: reg.nombre_registrador || "",
          area_registrador: reg.area_registrador || "",

          area_error_id: reg.area_error_id ? String(reg.area_error_id) : "",
          area_error: reg.area_error || "",
          proceso: reg.proceso || "",
          error: reg.error || "",
          descripcion_error: reg.descripcion_error || "",
          estado: reg.estado || "PENDIENTE",

          responsabilidad: reg.responsabilidad || "",
          impacto: reg.impacto || "",
          pdca: reg.pdca || "",
          evaluacion: reg.evaluacion || "",
          motivo_cancelacion: reg.motivo_cancelacion || "",
          responsable_id: reg.responsable_id || "",
          responsable: reg.responsable || "",
          fecha_planificada: reg.fecha_planificada || "",
          medida: reg.medida || "",
          causa_raiz: reg.causa_raiz || "",
          fecha_cierre: reg.fecha_cierre || "",
          fecha_hora_actualiza: reg.fecha_hora_actualiza || "",
          usuario_actualiza: reg.usuario_actualiza || ""
        });
      }
    } catch (error) {
      mostrarAviso('danger', 'Error al cargar datos', error.message);
    } finally {
      setLoading(false);
    }
  };

  // Lista de errores dinámica según el AREA_ERROR seleccionada
  const listaErroresDisponibles = useMemo(() => {
    const errores = obtenerErroresPorNombreArea(formData.area_error);
    // Si en modo edición tenía un error personalizado que no está en la lista, lo mantenemos visible
    if (formData.error && !errores.includes(formData.error)) {
      return [formData.error, ...errores];
    }
    return errores;
  }, [formData.area_error, formData.error]);

  const handleAreaErrorChange = (e) => {
    const nombreSeleccionado = e.target.value;
    const areaObj = areasError.find((a) => a.nombre === nombreSeleccionado);

    setFormData((prev) => ({
      ...prev,
      area_error: nombreSeleccionado,
      area_error_id: areaObj ? String(areaObj.id) : "",
      error: "" // Reiniciamos el error al cambiar de área
    }));
  };

  const handleEvaluacionChange = (e) => {
    const nuevaEval = e.target.value;
    setFormData((prev) => {
      let nuevoEstado = prev.estado;
      if (nuevaEval === "CANCELADO") {
        nuevoEstado = "CANCELADO";
      } else if (nuevaEval === "APROBADO" && prev.estado === "CANCELADO") {
        nuevoEstado = "PENDIENTE";
      }

      return {
        ...prev,
        evaluacion: nuevaEval,
        estado: nuevoEstado,
        motivo_cancelacion: nuevaEval === "CANCELADO" ? prev.motivo_cancelacion : ""
      };
    });
  };

  const handleEstadoChange = (e) => {
    const nuevoEstado = e.target.value;
    setFormData((prev) => {
      let nuevaEval = prev.evaluacion;
      let nuevaFechaCierre = prev.fecha_cierre;

      if (nuevoEstado === "CANCELADO") {
        nuevaEval = "CANCELADO";
        if (!nuevaFechaCierre) nuevaFechaCierre = new Date().toISOString();
      } else if (nuevoEstado === "CONCLUIDO") {
        if (!nuevaEval || nuevaEval === "CANCELADO") nuevaEval = "APROBADO";
        if (!nuevaFechaCierre) nuevaFechaCierre = new Date().toISOString();
      } else if (nuevoEstado === "PENDIENTE") {
        nuevaFechaCierre = "";
        if (nuevaEval === "CANCELADO") nuevaEval = "APROBADO";
      }

      return {
        ...prev,
        estado: nuevoEstado,
        evaluacion: nuevaEval,
        fecha_cierre: nuevaFechaCierre
      };
    });
  };

  const handleResponsableChange = (e) => {
    const empId = e.target.value;
    const empObj = personalWhite.find((p) => String(p.id) === String(empId));
    setFormData((prev) => ({
      ...prev,
      responsable_id: empId,
      responsable: empObj ? empObj.nombre : ""
    }));
  };

  const esCancelado =
    formData.evaluacion === "CANCELADO" || formData.estado === "CANCELADO";

  const handleSubmit = async (e) => {
    e.preventDefault();

    // Validaciones Fase 1 (Registro)
    if (!formData.area_error.trim()) {
      return mostrarAviso('warning', 'Área requerida', 'Por favor seleccione el Área del Error.');
    }
    if (!formData.proceso.trim()) {
      return mostrarAviso('warning', 'Proceso requerido', 'Por favor escriba el Proceso donde ocurrió el error.');
    }
    if (!formData.error.trim()) {
      return mostrarAviso('warning', 'Error requerido', 'Por favor seleccione el Tipo de Error de la lista.');
    }
    if (!formData.descripcion_error.trim()) {
      return mostrarAviso('warning', 'Descripción requerida', 'Por favor ingrese la descripción detallada del error.');
    }

    // Validaciones Fase 2 (Modo Análisis)
    if (esModoAnalisis) {
      if (esCancelado && !formData.motivo_cancelacion.trim()) {
        return mostrarAviso(
          'danger',
          'Motivo de Cancelación Obligatorio',
          'Cuando la Evaluación o el Estado se marca como CANCELADO, es obligatorio indicar el motivo de cancelación.'
        );
      }

      if (formData.estado === "CONCLUIDO") {
        if (!formData.responsabilidad || !formData.impacto || !formData.pdca || !formData.responsable) {
          return mostrarAviso(
            'warning',
            'Datos de Análisis Incompletos',
            'Para pasar el registro a CONCLUIDO debe completar Responsabilidad, Impacto, PDCA y Responsable.'
          );
        }
        if (!formData.causa_raiz.trim() || !formData.medida.trim()) {
          return mostrarAviso(
            'warning',
            'Causa Raíz y Medida Requeridas',
            'Para concluir el registro debe detallar la Causa Raíz y la Medida adoptada.'
          );
        }
      }
    }

    setLoading(true);
    try {
      if (!esModoAnalisis) {
        const creado = await crearRegistroCuadroQ({
          registrador_id: currentUser?.id || null,
          nombre_registrador: formData.nombre_registrador || currentUser?.nombre || "Usuario",
          area_registrador: formData.area_registrador || areaDelUsuarioLogueado,
          area_error_id: formData.area_error_id || null,
          area_error: formData.area_error.trim(),
          proceso: formData.proceso.trim(),
          error: formData.error.trim(),
          descripcion_error: formData.descripcion_error.trim()
        });

        mostrarAviso(
          'success',
          'Cuadro Q Registrado',
          'La incidencia se ha registrado correctamente con estado PENDIENTE.',
          `Código asignado: ${creado.id_cuadro_q || 'Generado'}`,
          () => navigate('/cuadro_q/trackingCuadroQ')

        );
      } else {
        const fechaCierreFinal =
          formData.estado === "CONCLUIDO" || formData.estado === "CANCELADO"
            ? formData.fecha_cierre || new Date().toISOString()
            : null;

        const actualizado = await actualizarRegistroCuadroQ(registroEditId, {
          area_error_id: formData.area_error_id ? Number(formData.area_error_id) : null,
          area_error: formData.area_error.trim(),
          proceso: formData.proceso.trim(),
          error: formData.error.trim(),
          descripcion_error: formData.descripcion_error.trim(),
          estado: formData.estado,

          responsabilidad: formData.responsabilidad || null,
          impacto: formData.impacto || null,
          pdca: formData.pdca || null,
          evaluacion: formData.evaluacion || null,
          motivo_cancelacion: esCancelado ? formData.motivo_cancelacion.trim() : null,
          responsable_id: formData.responsable_id || null,
          responsable: formData.responsable || null,
          fecha_planificada: formData.fecha_planificada || null,
          medida: formData.medida.trim() || null,
          causa_raiz: formData.causa_raiz.trim() || null,
          fecha_cierre: fechaCierreFinal,
          usuario_actualiza: currentUser?.nombre || "Usuario"
        });

        mostrarAviso(
          'success',
          'Análisis Guardado',
          'Los datos de seguimiento y análisis del Cuadro Q se actualizaron correctamente.',
          `Código: ${actualizado.id_cuadro_q} | Estado: ${actualizado.estado}`,
          () => navigate('/cuadro_q/trackingCuadroQ')
        );
      }
    } catch (error) {
      mostrarAviso('danger', 'Error al guardar', error.message);
    } finally {
      setLoading(false);
    }
  };

  function formatearFechaHora(iso) {
    if (!iso) return "Automático al guardar";
    return new Date(iso).toLocaleString('es-PE', {
      dateStyle: 'short',
      timeStyle: 'short'
    });
  }

  return (
    <div className="registro-page">
      {loading && <Loading />}

      {/* MODAL DE AVISO FLOTANTE */}
      {avisoFlotante.visible && (
        <div className="tw-modal-backdrop" onClick={cerrarAviso}>
          <div
            className={`tw-modal-card tw-modal-${avisoFlotante.tipo}`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="tw-modal-header">
              <div className={`tw-modal-icon-circle ${avisoFlotante.tipo}`}>
                {avisoFlotante.tipo === 'danger' && (
                  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10"></circle>
                    <line x1="15" y1="9" x2="9" y2="15"></line>
                    <line x1="9" y1="9" x2="15" y2="15"></line>
                  </svg>
                )}
                {avisoFlotante.tipo === 'warning' && (
                  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
                    <line x1="12" y1="9" x2="12" y2="13"></line>
                    <line x1="12" y1="17" x2="12.01" y2="17"></line>
                  </svg>
                )}
                {avisoFlotante.tipo === 'success' && (
                  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
                    <polyline points="22 4 12 14.01 9 11.01"></polyline>
                  </svg>
                )}
              </div>

              <div className="tw-modal-text">
                <h3 className="tw-modal-title">{avisoFlotante.titulo}</h3>
                <p className="tw-modal-desc">{avisoFlotante.mensaje}</p>
                {avisoFlotante.detalleExtra && (
                  <div className="tw-modal-extra-box">{avisoFlotante.detalleExtra}</div>
                )}
              </div>
            </div>

            <div className="tw-modal-footer">
              <button
                type="button"
                className={`tw-modal-btn ${avisoFlotante.tipo}`}
                onClick={cerrarAviso}
              >
                Entendido
              </button>
            </div>
          </div>
        </div>
      )}

      <section className="card mb-4">
        <div className="card-head-modern">
          <div className="card-head-left">
            <h2>{esModoAnalisis ? `Análisis Cuadro Q (${formData.id_cuadro_q})` : 'Registro de Cuadro Q'}</h2>
            <p>
              Usuario activo: <strong>{currentUser?.nombre}</strong>
            </p>
          </div>

          <div className="card-head-right">
            <div className="legend-item">
              <span className="legend-dot auto"></span>
              <span>Automático</span>
            </div>
            <div className="legend-item">
              <span className="legend-dot manual"></span>
              <span>Obligatorio</span>
            </div>
          </div>
        </div>

        <form onSubmit={handleSubmit}>
          {/* =========================================================
              1. DATOS DEL REGISTRADOR (AUTOMÁTICOS)
             ========================================================= */}
          <div className="section-title-row" style={{ marginTop: 0 }}>
            <div className="section-title" style={{ marginBottom: 0 }}>
              1. Datos del Registrador
            </div>
            <div className="status-pill-wrapper">
              <span className="status-pill-label">Estado actual:</span>
              <span className={`cq-badge-estado ${formData.estado}`}>
                {formData.estado}
              </span>
            </div>
          </div>

          <div className="form-grid cols-4" style={{ marginTop: '12px', marginBottom: '22px' }}>
            <div className="field">
              <label>
                ID Cuadro Q <span className="field-badge auto">AUTOMÁTICO</span>
              </label>
              <input
                type="text"
                value={formData.id_cuadro_q}
                readOnly
                className="input-readonly"
              />
            </div>

            <div className="field">
              <label>
                Fecha y Hora Registro <span className="field-badge auto">AUTOMÁTICO</span>
              </label>
              <input
                type="text"
                value={
                  esModoAnalisis
                    ? formatearFechaHora(formData.fecha_registro)
                    : new Date().toLocaleString('es-PE', { dateStyle: 'short', timeStyle: 'short' })
                }
                readOnly
                className="input-readonly"
              />
            </div>

            <div className="field">
              <label>
                Nombre Registrador <span className="field-badge auto">AUTOMÁTICO</span>
              </label>
              <input
                type="text"
                value={formData.nombre_registrador}
                readOnly
                className="input-readonly"
              />
            </div>

            <div className="field">
              <label>
                Área Registrador <span className="field-badge auto">AUTOMÁTICO</span>
              </label>
              <input
                type="text"
                value={formData.area_registrador}
                readOnly
                className="input-readonly"
              />
            </div>
          </div>

          {/* =========================================================
              2. DETALLE DE LA INCIDENCIA / ERROR (REGISTRO)
             ========================================================= */}
          <div className="section-title">2. Detalle del Error Reportado</div>

          <div className="form-grid cols-3" style={{ marginBottom: '16px' }}>
            <div className="field">
              <label>
                Área del Error <span className="field-badge manual">OBLIGATORIO</span>
              </label>
              <select
                value={formData.area_error}
                onChange={handleAreaErrorChange}
                required
              >
                <option value="">Seleccione un área...</option>
                {areasError.map((a) => (
                  <option key={a.id} value={a.nombre}>
                    {a.nombre}
                  </option>
                ))}
              </select>
            </div>

            <div className="field">
              <label>
                Proceso <span className="field-badge manual">OBLIGATORIO</span>
              </label>
              <input
                type="text"
                placeholder="Escriba el proceso (Ej: Picking, Recepción, Almacenamiento...)"
                value={formData.proceso}
                onChange={(e) => setFormData({ ...formData, proceso: e.target.value })}
                required
              />
            </div>

            <div className="field">
              <label>
                Error <span className="field-badge manual">OBLIGATORIO</span>
              </label>
              <select
                value={formData.error}
                onChange={(e) => setFormData({ ...formData, error: e.target.value })}
                disabled={!formData.area_error}
                required
              >
                <option value="">
                  {formData.area_error ? "Seleccione un error..." : "Primero seleccione Área del Error..."}
                </option>
                {listaErroresDisponibles.map((errItem, idx) => (
                  <option key={idx} value={errItem}>
                    {errItem}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="field" style={{ marginBottom: '24px' }}>
            <div className="label-with-counter">
              <label style={{ marginBottom: 0 }}>
                Descripción del Error <span className="field-badge manual">OBLIGATORIO</span>
              </label>
              <small className="char-counter">
                {formData.descripcion_error.length} / 500 caracteres
              </small>
            </div>
            <textarea
              rows="3"
              maxLength={500}
              placeholder="Describa con detalle el hallazgo, código, ubicación o documento involucrado..."
              value={formData.descripcion_error}
              onChange={(e) => setFormData({ ...formData, descripcion_error: e.target.value })}
              required
            />
          </div>

          {/* =========================================================
              3. FASE DE ANÁLISIS Y SEGUIMIENTO (SOLO EN MODO ANÁLISIS/EDICIÓN)
             ========================================================= */}
          {esModoAnalisis && (
            <div className="analisis-section-wrapper">
              <div className="section-title-row" style={{ marginTop: 0, marginBottom: '14px' }}>
                <div className="section-title" style={{ marginBottom: 0 }}>
                  3. Análisis y Seguimiento (PDCA)
                </div>
                {formData.usuario_actualiza && (
                  <span className="audit-last-update">
                    Últ. cambio por <strong>{formData.usuario_actualiza}</strong> ({formatearFechaHora(formData.fecha_hora_actualiza)})
                  </span>
                )}
              </div>

              <div className="form-grid cols-3" style={{ marginBottom: '16px' }}>
                <div className="field">
                  <label>Evaluación</label>
                  <select
                    value={formData.evaluacion}
                    onChange={handleEvaluacionChange}
                  >
                    <option value="">Seleccione evaluación...</option>
                    <option value="APROBADO">APROBADO</option>
                    <option value="CANCELADO">CANCELADO</option>
                  </select>
                </div>

                <div className="field">
                  <label>Estado del Cuadro Q</label>
                  <select
                    value={formData.estado}
                    onChange={handleEstadoChange}
                  >
                    <option value="PENDIENTE">PENDIENTE</option>
                    <option value="CONCLUIDO">CONCLUIDO</option>
                    <option value="CANCELADO">CANCELADO</option>
                  </select>
                </div>

                <div className="field">
                  <label>Responsabilidad</label>
                  <select
                    value={formData.responsabilidad}
                    onChange={(e) => setFormData({ ...formData, responsabilidad: e.target.value })}
                  >
                    <option value="">Seleccione...</option>
                    <option value="CEVA">CEVA</option>
                    <option value="3M">3M</option>
                  </select>
                </div>

                <div className="field">
                  <label>Impacto</label>
                  <select
                    value={formData.impacto}
                    onChange={(e) => setFormData({ ...formData, impacto: e.target.value })}
                  >
                    <option value="">Seleccione impacto...</option>
                    <option value="ALTO">ALTO</option>
                    <option value="MEDIO">MEDIO</option>
                    <option value="BAJO">BAJO</option>
                  </select>
                </div>

                <div className="field">
                  <label>PDCA</label>
                  <select
                    value={formData.pdca}
                    onChange={(e) => setFormData({ ...formData, pdca: e.target.value })}
                  >
                    <option value="">Seleccione...</option>
                    <option value="APLICA">APLICA</option>
                    <option value="NO APLICA">NO APLICA</option>
                  </select>
                </div>

                <div className="field">
                  <label>Responsable (Personal WHITE)</label>
                  <select
                    value={formData.responsable_id}
                    onChange={handleResponsableChange}
                  >
                    <option value="">Seleccione responsable...</option>
                    {personalWhite.map((emp) => (
                      <option key={emp.id} value={emp.id}>
                        {emp.nombre}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="field">
                  <label>Fecha Planificada</label>
                  <input
                    type="date"
                    value={formData.fecha_planificada}
                    onChange={(e) => setFormData({ ...formData, fecha_planificada: e.target.value })}
                  />
                </div>

                <div className="field">
                  <label>
                    Fecha y Hora de Cierre <span className="field-badge auto">AUTO AL CONCLUIR</span>
                  </label>
                  <input
                    type="text"
                    value={
                      formData.fecha_cierre
                        ? formatearFechaHora(formData.fecha_cierre)
                        : "Pendiente de cierre"
                    }
                    readOnly
                    className="input-readonly"
                  />
                </div>
              </div>

              {/* CAMPO OBLIGATORIO SI SE APRIETA CANCELADO */}
              {esCancelado && (
                <div className="field motivo-cancelacion-box" style={{ marginBottom: '16px' }}>
                  <label>
                    Motivo de Cancelación <span className="field-badge manual">OBLIGATORIO POR CANCELACIÓN</span>
                  </label>
                  <textarea
                    rows="2"
                    placeholder="Explique obligatoriamente por qué se cancela o desestima este registro..."
                    value={formData.motivo_cancelacion}
                    onChange={(e) => setFormData({ ...formData, motivo_cancelacion: e.target.value })}
                    className={!formData.motivo_cancelacion.trim() ? 'input-error-border' : ''}
                    required
                  />
                  {!formData.motivo_cancelacion.trim() && (
                    <div className="field-error-msg">
                      ⚠️ Debe especificar el motivo de cancelación para poder guardar.
                    </div>
                  )}
                </div>
              )}

              <div className="form-grid cols-2">
                <div className="field">
                  <label>Causa Raíz</label>
                  <textarea
                    rows="3"
                    placeholder="Describa la causa raíz identificada..."
                    value={formData.causa_raiz}
                    onChange={(e) => setFormData({ ...formData, causa_raiz: e.target.value })}
                  />
                </div>

                <div className="field">
                  <label>Medida / Plan de Acción</label>
                  <textarea
                    rows="3"
                    placeholder="Describa la medida correctiva o preventiva..."
                    value={formData.medida}
                    onChange={(e) => setFormData({ ...formData, medida: e.target.value })}
                  />
                </div>
              </div>
            </div>
          )}

          <div className="submit-row">
            <button
              type="button"
              className="secondary-btn"
              onClick={() => navigate('/cuadro_q/trackingCuadroQ')}
            >
              Cancelar
            </button>
            <button
              type="submit"
              className="primary-btn"
              disabled={loading}
            >
              {esModoAnalisis ? 'Guardar Análisis y Cambios' : 'Registrar Cuadro Q'}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}