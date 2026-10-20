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

// Obtener fecha local actual en formato YYYY-MM-DD
function obtenerFechaHoyLocal() {
  const hoy = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${hoy.getFullYear()}-${pad(hoy.getMonth() + 1)}-${pad(hoy.getDate())}`;
}

// Convertir ISO a formato YYYY-MM-DDTHH:mm para input datetime-local
function isoADatetimeLocal(isoStr) {
  if (!isoStr) return "";
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(isoStr)) return isoStr;
  const d = new Date(isoStr);
  if (isNaN(d.getTime())) return "";
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// Cálculo automático del Estado del Cuadro Q
function calcularEstadoAutomatico({ evaluacion, fecha_planificada, fecha_cierre }) {
  if (evaluacion === "CANCELADO") {
    return "CANCELADO";
  }

  if (fecha_cierre && String(fecha_cierre).trim() !== "") {
    return "CONCLUIDO";
  }

  const hoyStr = obtenerFechaHoyLocal();
  const planStr = fecha_planificada ? String(fecha_planificada).slice(0, 10) : "";

  if (planStr && hoyStr > planStr) {
    return "ATRAZADO";
  }

  if (evaluacion === "APROBADO") {
    return "EN PROCESO";
  }

  return "PENDIENTE";
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

  // Controla si el registro ya vino CONCLUIDO desde la BD o si el usuario confirmó la Fecha de Cierre
  const [yaEstabaConcluidoEnBD, setYaEstabaConcluidoEnBD] = useState(false);
  const [cierreConfirmadoUI, setCierreConfirmadoUI] = useState(false);

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

  // Modal de aviso flotante
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

  // Resolver el rol del usuario logueado
  const rolDelUsuarioLogueado = useMemo(() => {
    if (!currentUser) return "";

    const userLocal = usuariosDb.find((u) => String(u.id) === String(currentUser?.id));

    const rawRol =
      currentUser?.rol_nombre ||
      currentUser?.rol?.nombre ||
      currentUser?.roles?.nombre ||
      (typeof currentUser?.rol === 'string' ? currentUser.rol : '') ||
      (typeof currentUser?.role === 'string' ? currentUser.role : '') ||
      currentUser?.tipo_usuario ||
      currentUser?.perfil ||
      userLocal?.rol_nombre ||
      userLocal?.rol?.nombre ||
      userLocal?.roles?.nombre ||
      (typeof userLocal?.rol === 'string' ? userLocal.rol : '') ||
      (typeof userLocal?.role === 'string' ? userLocal.role : '') ||
      "";

    return String(rawRol).toUpperCase().trim();
  }, [currentUser, usuariosDb]);

  // Verificar si pertenece al área BPE o tiene rol SUPERADMIN
  const esBpeOSuperAdmin = useMemo(() => {
    const areaNorm = areaDelUsuarioLogueado.toUpperCase().trim();
    const rolNorm = rolDelUsuarioLogueado.replace(/[\s_-]+/g, '');

    const esBPE = areaNorm === "BPE" || areaNorm.includes("BPE");
    const esSuperAdmin = rolNorm === "SUPERADMIN";

    return esBPE || esSuperAdmin;
  }, [areaDelUsuarioLogueado, rolDelUsuarioLogueado]);

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
        const fechaPlan = reg.fecha_planificada ? String(reg.fecha_planificada).slice(0, 10) : "";
        const fechaCierreLocal = isoADatetimeLocal(reg.fecha_cierre);

        const evalInicial =
          reg.evaluacion || (reg.estado === "CANCELADO" ? "CANCELADO" : "");

        const estadoCalculado = calcularEstadoAutomatico({
          evaluacion: evalInicial,
          fecha_planificada: fechaPlan,
          fecha_cierre: fechaCierreLocal
        });

        const estabaConcluido =
          estadoCalculado === "CONCLUIDO" || reg.estado === "CONCLUIDO";

        setYaEstabaConcluidoEnBD(estabaConcluido);
        setCierreConfirmadoUI(estabaConcluido);

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
          estado: estabaConcluido ? "CONCLUIDO" : estadoCalculado,

          responsabilidad: reg.responsabilidad || "",
          impacto: reg.impacto || "",
          pdca: reg.pdca || "",
          evaluacion: evalInicial,
          motivo_cancelacion: reg.motivo_cancelacion || "",
          responsable_id: reg.responsable_id || "",
          responsable: reg.responsable || "",
          fecha_planificada: fechaPlan,
          medida: reg.medida || "",
          causa_raiz: reg.causa_raiz || "",
          fecha_cierre: fechaCierreLocal,
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
    if (formData.error && !errores.includes(formData.error)) {
      return [formData.error, ...errores];
    }
    return errores;
  }, [formData.area_error, formData.error]);

  // Flags de bloqueo según las reglas de negocio
  const esCancelado =
    formData.evaluacion === "CANCELADO" || formData.estado === "CANCELADO";
  const esAprobado = formData.evaluacion === "APROBADO";
  const tieneFechaCierre = Boolean(formData.fecha_cierre && formData.fecha_cierre.trim());
  const esConcluido = formData.estado === "CONCLUIDO" || tieneFechaCierre;

  // Bloqueo de Sección 1 y 2 en modo análisis para todos menos BPE y SUPERADMIN
  const bloquearDatosBase = esModoAnalisis && !esBpeOSuperAdmin;

  // Bloqueo del Análisis cuando se coloca Fecha y Hora de Cierre (CONCLUIDO) para todos menos BPE y SUPERADMIN
  const bloquearAnalisisPorConcluido = esModoAnalisis && esConcluido && !esBpeOSuperAdmin;

  // Bloqueo del input de Fecha de Cierre una vez confirmado o cargado como CONCLUIDO para no-BPE/SUPERADMIN
  const bloquearInputFechaCierre =
    esCancelado || (esModoAnalisis && (yaEstabaConcluidoEnBD || cierreConfirmadoUI) && !esBpeOSuperAdmin);

  // Bloqueo del resto de campos PDCA cuando es CANCELADO o cuando está bloqueado por CONCLUIDO
  const bloquearRestoCamposPDCA = esCancelado || bloquearAnalisisPorConcluido;

  const handleAreaErrorChange = (e) => {
    if (bloquearDatosBase) return;
    const nombreSeleccionado = e.target.value;
    const areaObj = areasError.find((a) => a.nombre === nombreSeleccionado);

    setFormData((prev) => ({
      ...prev,
      area_error: nombreSeleccionado,
      area_error_id: areaObj ? String(areaObj.id) : "",
      error: ""
    }));
  };

  const handleEvaluacionChange = (e) => {
    if (bloquearAnalisisPorConcluido) return;
    const nuevaEval = e.target.value;

    setFormData((prev) => {
      const nuevaFechaCierre = nuevaEval === "CANCELADO" ? "" : prev.fecha_cierre;
      if (nuevaEval === "CANCELADO") {
        setCierreConfirmadoUI(false);
      }

      const nuevoEstado = calcularEstadoAutomatico({
        evaluacion: nuevaEval,
        fecha_planificada: prev.fecha_planificada,
        fecha_cierre: nuevaFechaCierre
      });

      return {
        ...prev,
        evaluacion: nuevaEval,
        fecha_cierre: nuevaFechaCierre,
        estado: nuevoEstado,
        motivo_cancelacion: nuevaEval === "CANCELADO" ? prev.motivo_cancelacion : ""
      };
    });
  };

  const handleFechaPlanificadaChange = (e) => {
    if (bloquearRestoCamposPDCA) return;
    const nuevaFechaPlan = e.target.value;

    setFormData((prev) => {
      const nuevoEstado = calcularEstadoAutomatico({
        evaluacion: prev.evaluacion,
        fecha_planificada: nuevaFechaPlan,
        fecha_cierre: prev.fecha_cierre
      });

      return {
        ...prev,
        fecha_planificada: nuevaFechaPlan,
        estado: nuevoEstado
      };
    });
  };

  const handleFechaCierreChange = (e) => {
    if (bloquearInputFechaCierre) return;
    const nuevaFechaCierre = e.target.value;

    setFormData((prev) => {
      const evalEfectiva =
        nuevaFechaCierre && (!prev.evaluacion || prev.evaluacion === "CANCELADO")
          ? "APROBADO"
          : prev.evaluacion;

      const nuevoEstado = calcularEstadoAutomatico({
        evaluacion: evalEfectiva,
        fecha_planificada: prev.fecha_planificada,
        fecha_cierre: nuevaFechaCierre
      });

      if (!nuevaFechaCierre) {
        setCierreConfirmadoUI(false);
      }

      return {
        ...prev,
        evaluacion: evalEfectiva,
        fecha_cierre: nuevaFechaCierre,
        estado: nuevoEstado
      };
    });
  };

  const handleFechaCierreBlur = () => {
    if (formData.fecha_cierre && formData.fecha_cierre.trim() !== "") {
      setCierreConfirmadoUI(true);
    }
  };

  const handleResponsableChange = (e) => {
    if (bloquearRestoCamposPDCA) return;
    const empId = e.target.value;
    const empObj = personalWhite.find((p) => String(p.id) === String(empId));
    setFormData((prev) => ({
      ...prev,
      responsable_id: empId,
      responsable: empObj ? empObj.nombre : ""
    }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (esModoAnalisis && yaEstabaConcluidoEnBD && !esBpeOSuperAdmin) {
      return mostrarAviso(
        'warning',
        'Registro Concluido (Solo Lectura)',
        'Este análisis ya fue concluido. Únicamente el personal del área de BPE y el rol SUPERADMIN pueden modificarlo.'
      );
    }

    // Validaciones Fase 1 (Registro y Análisis)
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
      if (!formData.evaluacion) {
        return mostrarAviso(
          'warning',
          'Evaluación Requerida',
          'Por favor seleccione la Evaluación del Cuadro Q (APROBADO o CANCELADO).'
        );
      }

      if (esCancelado) {
        if (!formData.motivo_cancelacion.trim()) {
          return mostrarAviso(
            'danger',
            'Motivo de Cancelación Obligatorio',
            'Cuando la Evaluación es CANCELADO, es obligatorio especificar el motivo de cancelación.'
          );
        }
      }

      if (formData.evaluacion === "APROBADO") {
        const faltantes = [];
        if (!formData.responsabilidad) faltantes.push("Responsabilidad");
        if (!formData.impacto) faltantes.push("Impacto");
        if (!formData.pdca) faltantes.push("PDCA");
        if (!formData.responsable_id && !formData.responsable) faltantes.push("Responsable (Personal WHITE)");
        if (!formData.fecha_planificada) faltantes.push("Fecha Planificada");
        if (!formData.causa_raiz.trim()) faltantes.push("Causa Raíz");
        if (!formData.medida.trim()) faltantes.push("Medida / Plan de Acción");

        if (faltantes.length > 0) {
          return mostrarAviso(
            'warning',
            'Campos Obligatorios en Aprobado',
            'Al seleccionar APROBADO debe completar todos los campos obligatorios del análisis.',
            `Campos pendientes: ${faltantes.join(', ')}`
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
        const estadoFinal = calcularEstadoAutomatico({
          evaluacion: formData.evaluacion,
          fecha_planificada: formData.fecha_planificada,
          fecha_cierre: esCancelado ? "" : formData.fecha_cierre
        });

        //  AHORA (Mantiene la hora exacta seleccionada en el formulario):
        const fechaCierreFormateada =
        !esCancelado && formData.fecha_cierre
            ? formData.fecha_cierre.replace('T', ' ') + (formData.fecha_cierre.length === 16 ? ':00' : '')
            : null;

        const actualizado = await actualizarRegistroCuadroQ(registroEditId, {
          nombre_registrador: formData.nombre_registrador.trim(),
          area_registrador: formData.area_registrador.trim(),
          area_error_id: formData.area_error_id ? Number(formData.area_error_id) : null,
          area_error: formData.area_error.trim(),
          proceso: formData.proceso.trim(),
          error: formData.error.trim(),
          descripcion_error: formData.descripcion_error.trim(),
          estado: estadoFinal,

          responsabilidad: esCancelado ? null : (formData.responsabilidad || null),
          impacto: esCancelado ? null : (formData.impacto || null),
          pdca: esCancelado ? null : (formData.pdca || null),
          evaluacion: formData.evaluacion || null,
          motivo_cancelacion: esCancelado ? formData.motivo_cancelacion.trim() : null,
          responsable_id: esCancelado ? null : (formData.responsable_id || null),
          responsable: esCancelado ? null : (formData.responsable || null),
          fecha_planificada: esCancelado ? null : (formData.fecha_planificada || null),
          medida: esCancelado ? null : (formData.medida.trim() || null),
          causa_raiz: esCancelado ? null : (formData.causa_raiz.trim() || null),
          fecha_cierre: fechaCierreFormateada,
          usuario_actualiza: currentUser?.nombre || "Usuario"
        });

        mostrarAviso(
          'success',
          'Análisis Guardado',
          'Los datos de seguimiento y análisis del Cuadro Q se actualizaron correctamente.',
          `Código: ${actualizado.id_cuadro_q || formData.id_cuadro_q} | Estado: ${actualizado.estado || estadoFinal}`,
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

  const claseEstadoBadge = formData.estado ? formData.estado.replace(/\s+/g, '_') : 'PENDIENTE';

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
              Usuario activo: <strong>{currentUser?.nombre}</strong> ({areaDelUsuarioLogueado})
            </p>
          </div>

          <div className="card-head-right">
            <div className="status-pill-wrapper">
              <span className="status-pill-label">Estado actual:</span>
              <span className={`cq-badge-estado ${claseEstadoBadge}`}>
                {formData.estado}
              </span>
            </div>
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

        {bloquearAnalisisPorConcluido && (
          <div className="lock-banner-alert">
            🔒 <strong>Registro Concluido:</strong> El análisis se encuentra bloqueado en modo de solo visualización. Únicamente el personal del área de <strong>BPE</strong> o el rol <strong>SUPERADMIN</strong> pueden realizar modificaciones.
          </div>
        )}

        <form onSubmit={handleSubmit}>
          {/* =========================================================
              1. DATOS DEL REGISTRADOR (SOLO VISIBLE EN MODO ANÁLISIS)
             ========================================================= */}
          {esModoAnalisis && (
            <>
              <div className="section-title-row" style={{ marginTop: 0 }}>
                <div className="section-title" style={{ marginBottom: 0 }}>
                  1. Datos del Registrador
                </div>
                {bloquearDatosBase && (
                  <span className="lock-tag-info">
                    Bloqueado (Editable solo por BPE / SUPERADMIN)
                  </span>
                )}
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
                    disabled
                    className="input-readonly"
                  />
                </div>

                <div className="field">
                  <label>
                    Fecha y Hora Registro <span className="field-badge auto">AUTOMÁTICO</span>
                  </label>
                  <input
                    type="text"
                    value={formatearFechaHora(formData.fecha_registro)}
                    readOnly
                    disabled
                    className="input-readonly"
                  />
                </div>

                <div className="field">
                  <label>
                    Nombre Registrador <span className="field-badge auto">{esBpeOSuperAdmin ? 'BPE / ADMIN' : 'BLOQUEADO'}</span>
                  </label>
                  <input
                    type="text"
                    value={formData.nombre_registrador}
                    onChange={(e) => setFormData({ ...formData, nombre_registrador: e.target.value })}
                    readOnly={bloquearDatosBase}
                    disabled={bloquearDatosBase}
                    className={bloquearDatosBase ? "input-readonly" : ""}
                  />
                </div>

                <div className="field">
                  <label>
                    Área Registrador <span className="field-badge auto">{esBpeOSuperAdmin ? 'BPE / ADMIN' : 'BLOQUEADO'}</span>
                  </label>
                  <input
                    type="text"
                    value={formData.area_registrador}
                    onChange={(e) => setFormData({ ...formData, area_registrador: e.target.value })}
                    readOnly={bloquearDatosBase}
                    disabled={bloquearDatosBase}
                    className={bloquearDatosBase ? "input-readonly" : ""}
                  />
                </div>
              </div>
            </>
          )}

          {/* =========================================================
              2. DETALLE DE LA INCIDENCIA / ERROR
             ========================================================= */}
          <div className="section-title-row" style={{ marginTop: esModoAnalisis ? '16px' : 0, marginBottom: '12px' }}>
            <div className="section-title" style={{ marginBottom: 0 }}>
              {esModoAnalisis ? '2. Detalle del Error Reportado' : '1. Detalle del Error Reportado'}
            </div>
            {bloquearDatosBase && (
              <span className="lock-tag-info">
                Bloqueado (Editable solo por BPE / SUPERADMIN)
              </span>
            )}
          </div>

          <div className="form-grid cols-3" style={{ marginBottom: '16px' }}>
            <div className="field">
              <label>
                Área del Error <span className="field-badge manual">OBLIGATORIO</span>
              </label>
              <select
                value={formData.area_error}
                onChange={handleAreaErrorChange}
                disabled={bloquearDatosBase}
                className={bloquearDatosBase ? "input-readonly" : ""}
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
                readOnly={bloquearDatosBase}
                disabled={bloquearDatosBase}
                className={bloquearDatosBase ? "input-readonly" : ""}
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
                disabled={!formData.area_error || bloquearDatosBase}
                className={bloquearDatosBase ? "input-readonly" : ""}
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

          <div className="field">
            <div className="label-with-counter">
              <label style={{ marginBottom: 0 }}>
                Descripción del Error <span className="field-badge manual">OBLIGATORIO</span>
              </label>
            </div>
            <textarea
              rows="3"
              maxLength={500}
              placeholder="Detalles del error: SKU, picker, QTY, número de pedido, entre otros"
              value={formData.descripcion_error}
              onChange={(e) => setFormData({ ...formData, descripcion_error: e.target.value })}
              readOnly={bloquearDatosBase}
              disabled={bloquearDatosBase}
              className={bloquearDatosBase ? "input-readonly" : ""}
              required
            />
          </div>

          {/* =========================================================
              3. FASE DE ANÁLISIS Y SEGUIMIENTO (SOLO EN MODO ANÁLISIS)
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
                  <label>
                    Evaluación <span className="field-badge manual">OBLIGATORIO</span>
                  </label>
                  <select
                    value={formData.evaluacion}
                    onChange={handleEvaluacionChange}
                    disabled={bloquearAnalisisPorConcluido}
                    className={bloquearAnalisisPorConcluido ? "input-readonly" : ""}
                    required
                  >
                    <option value="">Seleccione evaluación...</option>
                    <option value="APROBADO">APROBADO</option>
                    <option value="CANCELADO">CANCELADO</option>
                  </select>
                </div>

                <div className="field">
                  <label>
                    Estado del Cuadro Q <span className="field-badge auto">AUTOMÁTICO</span>
                  </label>
                  <input
                    type="text"
                    value={formData.estado}
                    readOnly
                    disabled
                    className={`input-readonly input-estado-pill ${claseEstadoBadge}`}
                  />
                </div>

                <div className="field">
                  <label>
                    Responsabilidad {esAprobado && <span className="field-badge manual">OBLIGATORIO</span>}
                  </label>
                  <select
                    value={formData.responsabilidad}
                    onChange={(e) => setFormData({ ...formData, responsabilidad: e.target.value })}
                    disabled={bloquearRestoCamposPDCA}
                    className={bloquearRestoCamposPDCA ? "input-readonly" : ""}
                    required={esAprobado}
                  >
                    <option value="">Seleccione...</option>
                    <option value="CEVA">CEVA</option>
                    <option value="3M">3M</option>
                  </select>
                </div>

                <div className="field">
                  <label>
                    Impacto {esAprobado && <span className="field-badge manual">OBLIGATORIO</span>}
                  </label>
                  <select
                    value={formData.impacto}
                    onChange={(e) => setFormData({ ...formData, impacto: e.target.value })}
                    disabled={bloquearRestoCamposPDCA}
                    className={bloquearRestoCamposPDCA ? "input-readonly" : ""}
                    required={esAprobado}
                  >
                    <option value="">Seleccione impacto...</option>
                    <option value="ALTO">ALTO</option>
                    <option value="MEDIO">MEDIO</option>
                    <option value="BAJO">BAJO</option>
                  </select>
                </div>

                <div className="field">
                  <label>
                    PDCA {esAprobado && <span className="field-badge manual">OBLIGATORIO</span>}
                  </label>
                  <select
                    value={formData.pdca}
                    onChange={(e) => setFormData({ ...formData, pdca: e.target.value })}
                    disabled={bloquearRestoCamposPDCA}
                    className={bloquearRestoCamposPDCA ? "input-readonly" : ""}
                    required={esAprobado}
                  >
                    <option value="">Seleccione...</option>
                    <option value="APLICA">APLICA</option>
                    <option value="NO APLICA">NO APLICA</option>
                  </select>
                </div>

                <div className="field">
                  <label>
                    Responsable (Personal WHITE) {esAprobado && <span className="field-badge manual">OBLIGATORIO</span>}
                  </label>
                  <select
                    value={formData.responsable_id}
                    onChange={handleResponsableChange}
                    disabled={bloquearRestoCamposPDCA}
                    className={bloquearRestoCamposPDCA ? "input-readonly" : ""}
                    required={esAprobado}
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
                  <label>
                    Fecha Planificada {esAprobado && <span className="field-badge manual">OBLIGATORIO</span>}
                  </label>
                  <input
                    type="date"
                    value={formData.fecha_planificada}
                    onChange={handleFechaPlanificadaChange}
                    disabled={bloquearRestoCamposPDCA}
                    className={bloquearRestoCamposPDCA ? "input-readonly" : ""}
                    required={esAprobado}
                  />
                </div>

                <div className="field">
                  <label>
                    Fecha y Hora de Cierre <span className="field-badge auto">CIERRA A CONCLUIDO</span>
                  </label>
                  <input
                    type="datetime-local"
                    value={formData.fecha_cierre}
                    onChange={handleFechaCierreChange}
                    onBlur={handleFechaCierreBlur}
                    disabled={bloquearInputFechaCierre}
                    className={bloquearInputFechaCierre ? "input-readonly" : ""}
                  />
                </div>
              </div>

              {/* CAMPO OBLIGATORIO SI SE SELECCIONA CANCELADO */}
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
                    disabled={bloquearAnalisisPorConcluido}
                    className={`${!formData.motivo_cancelacion.trim() ? 'input-error-border' : ''} ${bloquearAnalisisPorConcluido ? 'input-readonly' : ''}`}
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
                  <label>
                    Causa Raíz {esAprobado && <span className="field-badge manual">OBLIGATORIO</span>}
                  </label>
                  <textarea
                    rows="3"
                    placeholder="Describa la causa raíz identificada..."
                    value={formData.causa_raiz}
                    onChange={(e) => setFormData({ ...formData, causa_raiz: e.target.value })}
                    disabled={bloquearRestoCamposPDCA}
                    className={bloquearRestoCamposPDCA ? "input-readonly" : ""}
                    required={esAprobado}
                  />
                </div>

                <div className="field">
                  <label>
                    Medida / Plan de Acción {esAprobado && <span className="field-badge manual">OBLIGATORIO</span>}
                  </label>
                  <textarea
                    rows="3"
                    placeholder="Describa la medida correctiva o preventiva..."
                    value={formData.medida}
                    onChange={(e) => setFormData({ ...formData, medida: e.target.value })}
                    disabled={bloquearRestoCamposPDCA}
                    className={bloquearRestoCamposPDCA ? "input-readonly" : ""}
                    required={esAprobado}
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
              {esModoAnalisis && yaEstabaConcluidoEnBD && !esBpeOSuperAdmin ? 'Volver' : 'Cancelar'}
            </button>

            {!(esModoAnalisis && yaEstabaConcluidoEnBD && !esBpeOSuperAdmin) && (
              <button
                type="submit"
                className="primary-btn"
                disabled={loading}
              >
                {esModoAnalisis ? 'Guardar Análisis y Cambios' : 'Registrar Cuadro Q'}
              </button>
            )}
          </div>
        </form>
      </section>
    </div>
  );
}
