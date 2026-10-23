import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate, useLocation, useSearchParams } from 'react-router-dom';

import Loading from '../../layouts/Loading';
import {
  obtenerCatalogosSugerencias,
  obtenerSugerenciaPorId,
  crearSugerencia,
  actualizarSugerencia,
  obtenerFechaHoraLima,
  obtenerFechaCortaLima
} from '../../services/sugerenciasService';
import './registrarSugerencias.css';

// Opciones fijas exactas
const CATEGORIAS_OPCIONES = [
  'EHS',
  'Productividad',
  'CALIDAD (perdida, cliente)',
  '5S',
  'Material Auxiliar',
  'Estandarización'
];

const FUENTES_OPCIONES = [
  'Cotidiano',
  'Auditoria 5S',
  'Wecare',
  'Gemba',
  'Gemba EHS'
];

const RECONOCIDO_OPCIONES = [
  'LUP',
  'Kaizen',
  'PDCA',
  'Proyecto Lean'
];

const IMPACTO_OPCIONES = [
  'Productividad',
  'Seguridad 5S',
  'Medio Ambiente',
  'Calidad',
  'Informativo',
  '5S'
];

function getStoredAuthUser() {
  const raw = localStorage.getItem('authUser') || sessionStorage.getItem('authUser');
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

const normalizar = (txt) =>
  String(txt || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();

export default function RegistrarSugerencias() {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();

  const sugerenciaEditId = searchParams.get('id') || location.state?.sugerencia?.id || null;
  const esModoEdicion = Boolean(sugerenciaEditId);

  const [currentUser] = useState(() => getStoredAuthUser());
  const [loading, setLoading] = useState(false);
  const [relojLima, setRelojLima] = useState(() => obtenerFechaHoraLima());

  // Catálogos desde Supabase / Dexie
  const [empleados, setEmpleados] = useState([]);
  const [areas, setAreas] = useState([]);
  const [cargos, setCargos] = useState([]);

  // Buscador de empleados para el campo "Equipo"
  const [busquedaEquipo, setBusquedaEquipo] = useState('');
  const [mostrarDropdownEquipo, setMostrarDropdownEquipo] = useState(false);

  // Estado principal del formulario (unifica Registro y Análisis)
  const [formData, setFormData] = useState({
    id_sugerencia: '',
    estado: 'Por Validar',
    fecha_registro: '',
    proceso: '',
    fecha_plan: '',
    area_registro_id: null,
    area_registro: '',
    usuario_registro_id: null,
    usuario_registro: '',
    cargo_registro: '',
    jefe_registro: '',
    categorias: [],
    fuentes: [],
    equipo_ids: [],
    equipo_nombres: [],
    descripcion_sugerencia: '',
    beneficios_sugerencia: '',

    // Campos de Análisis y Cierre
    area_responsable_id: '',
    area_responsable: '',
    responsable_id: '',
    nombre_responsable: '',
    responsable_apoyo_id: '',
    responsable_apoyo: '',
    reconocido: [],
    impacto: [],
    plan_accion: '',
    fecha_cierre: '',
    comentario_adicional: '',
    fecha_cancelacion: '',
    comentario_cancelacion: '',
    fechahora_actualiza: '',
    usuario_actualiza: ''
  });

  // Modal de Aviso Flotante
  const [avisoFlotante, setAvisoFlotante] = useState({
    visible: false,
    tipo: 'warning',
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
    const cb = avisoFlotante.onCloseCallback;
    setAvisoFlotante(prev => ({ ...prev, visible: false, onCloseCallback: null }));
    if (typeof cb === 'function') cb();
  };

  // Permisos del usuario logueado
  const rolUsuario = normalizar(
    currentUser?.rol || currentUser?.role || currentUser?.roles?.nombre || ''
  );
  const puedeAnalizar =
    rolUsuario === 'superadmin' ||
    rolUsuario === 'supervisor' ||
    rolUsuario === 'admin';

  // En modo creación cualquiera puede llenar los datos de la sugerencia;
  // en modo edición, el creador (si sigue Por Validar) o los supervisores/admins pueden editar.
  const puedeEditarDetalleInicial = !esModoEdicion || puedeAnalizar || (
    currentUser?.id && formData.usuario_registro_id === currentUser.id && formData.estado === 'Por Validar'
  );

  // Reloj en vivo de Lima cuando es un Nuevo Registro
  useEffect(() => {
    if (esModoEdicion) return;
    const timer = setInterval(() => {
      setRelojLima(obtenerFechaHoraLima());
    }, 1000);
    return () => clearInterval(timer);
  }, [esModoEdicion]);

  useEffect(() => {
    if (!currentUser) {
      navigate('/');
      return;
    }
    inicializarPantalla();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser, sugerenciaEditId]);

  const inicializarPantalla = async () => {
    setLoading(true);
    try {
      const { empleados: empList, areas: areaList, cargos: cargoList } = await obtenerCatalogosSugerencias();
      setEmpleados(empList || []);
      setAreas(areaList || []);
      setCargos(cargoList || []);

      // Encontrar datos completos del usuario logueado en la tabla empleados
      const miFicha = (empList || []).find(
        e => (currentUser?.id && String(e.id) === String(currentUser.id)) ||
             (currentUser?.dni && String(e.dni) === String(currentUser.dni))
      );

      const areaObjUsuario = (areaList || []).find(
        a => String(a.id) === String(miFicha?.area_id || currentUser?.area_id)
      );
      const cargoObjUsuario = (cargoList || []).find(
        c => String(c.id) === String(miFicha?.cargo_id || currentUser?.cargo_id)
      );
      const jefeObjUsuario = (empList || []).find(
        j => String(j.id) === String(miFicha?.jefe_directo_id || currentUser?.jefe_directo_id)
      );

      const nombreAreaLogueado =
        areaObjUsuario?.nombre ||
        currentUser?.area_nombre ||
        currentUser?.area?.nombre ||
        (typeof currentUser?.area === 'string' ? currentUser.area : '');

      const nombreCargoLogueado =
        cargoObjUsuario?.nombre ||
        currentUser?.cargo_nombre ||
        currentUser?.cargo?.nombre ||
        currentUser?.rol || '';

      const nombreJefeLogueado =
        jefeObjUsuario?.nombre ||
        currentUser?.jefe_directo || '';

      if (esModoEdicion) {
        const reg = await obtenerSugerenciaPorId(sugerenciaEditId);
        if (!reg) {
          mostrarAviso('danger', 'No encontrado', 'No se encontró la sugerencia seleccionada.', '', () => navigate('/sugerencias/tracking'));
          return;
        }

        const creadorFicha = (empList || []).find(e => String(e.id) === String(reg.usuario_registro_id));
        const cargoCreador = (cargoList || []).find(c => String(c.id) === String(creadorFicha?.cargo_id))?.nombre || '';
        const jefeCreador = (empList || []).find(j => String(j.id) === String(creadorFicha?.jefe_directo_id))?.nombre || '';

        setFormData({
          id_sugerencia: reg.id_sugerencia || 'PENDIENTE',
          estado: reg.estado || 'Por Validar',
          fecha_registro: reg.fecha_registro || '',
          proceso: reg.proceso || '',
          fecha_plan: reg.fecha_plan ? String(reg.fecha_plan).slice(0, 10) : '',
          area_registro_id: reg.area_registro_id || null,
          area_registro: reg.area_registro || '',
          usuario_registro_id: reg.usuario_registro_id || null,
          usuario_registro: reg.usuario_registro || '',
          cargo_registro: cargoCreador || 'Operador / Analista',
          jefe_registro: jefeCreador || '-',
          categorias: Array.isArray(reg.categorias) ? reg.categorias : [],
          fuentes: Array.isArray(reg.fuentes) ? reg.fuentes : (reg.fuentes ? [reg.fuentes] : []),
          equipo_ids: Array.isArray(reg.equipo_ids) ? reg.equipo_ids : [],
          equipo_nombres: Array.isArray(reg.equipo_nombres) ? reg.equipo_nombres : [],
          descripcion_sugerencia: reg.descripcion_sugerencia || '',
          beneficios_sugerencia: reg.beneficios_sugerencia || '',

          area_responsable_id: reg.area_responsable_id || '',
          area_responsable: reg.area_responsable || '',
          responsable_id: reg.responsable_id || '',
          nombre_responsable: reg.nombre_responsable || '',
          responsable_apoyo_id: reg.responsable_apoyo_id || '',
          responsable_apoyo: reg.responsable_apoyo || '',
          reconocido: Array.isArray(reg.reconocido) ? reg.reconocido : (reg.reconocido ? [reg.reconocido] : []),
          impacto: Array.isArray(reg.impacto) ? reg.impacto : (reg.impacto ? [reg.impacto] : []),
          plan_accion: reg.plan_accion || '',
          fecha_cierre: reg.fecha_cierre ? String(reg.fecha_cierre).slice(0, 10) : '',
          comentario_adicional: reg.comentario_adicional || '',
          fecha_cancelacion: reg.fecha_cancelacion ? String(reg.fecha_cancelacion).slice(0, 10) : '',
          comentario_cancelacion: reg.comentario_cancelacion || '',
          fechahora_actualiza: reg.fechahora_actualiza || '',
          usuario_actualiza: reg.usuario_actualiza || ''
        });
      } else {
        setFormData(prev => ({
          ...prev,
          estado: 'Por Validar',
          area_registro_id: areaObjUsuario?.id || miFicha?.area_id || currentUser?.area_id || null,
          area_registro: nombreAreaLogueado,
          usuario_registro_id: miFicha?.id || currentUser?.id || null,
          usuario_registro: miFicha?.nombre || currentUser?.nombre || 'Usuario',
          cargo_registro: nombreCargoLogueado,
          jefe_registro: nombreJefeLogueado
        }));
      }
    } catch (err) {
      console.error(err);
      mostrarAviso('danger', 'Error al cargar', err.message);
    } finally {
      setLoading(false);
    }
  };

  // Empleados activos para selectores
  const empleadosActivos = useMemo(() => {
    return empleados.filter(e => !normalizar(e.estado).includes('inactivo'));
  }, [empleados]);

  // Sugerencias de autocompletado para agregar integrantes a "Equipo"
  const sugerenciasEquipo = useMemo(() => {
    const q = normalizar(busquedaEquipo);
    if (!q) return [];
    return empleadosActivos
      .filter(e =>
        !formData.equipo_ids.includes(e.id) &&
        (normalizar(e.nombre).includes(q) || normalizar(e.dni).includes(q))
      )
      .slice(0, 8);
  }, [busquedaEquipo, empleadosActivos, formData.equipo_ids]);

  // Alternar casillas de arrays múltiples (Categorías)
  const toggleItemArray = (campo, valor) => {
    setFormData(prev => {
      const actual = Array.isArray(prev[campo]) ? prev[campo] : [];
      const existe = actual.includes(valor);
      const nuevo = existe ? actual.filter(item => item !== valor) : [...actual, valor];
      return { ...prev, [campo]: nuevo };
    });
  };

  // Selección única guardada como array de 1 elemento (Fuentes, Impacto, Reconocido)
  const handleSelectUnicoEnArray = (campo, valor) => {
    setFormData(prev => ({
      ...prev,
      [campo]: valor ? [valor] : []
    }));
  };

  // Agregar y quitar empleado en "Equipo"
  const agregarIntegranteEquipo = (emp) => {
    setFormData(prev => ({
      ...prev,
      equipo_ids: [...prev.equipo_ids, emp.id],
      equipo_nombres: [...prev.equipo_nombres, emp.nombre]
    }));
    setBusquedaEquipo('');
    setMostrarDropdownEquipo(false);
  };

  const quitarIntegranteEquipo = (indexToRemove) => {
    setFormData(prev => ({
      ...prev,
      equipo_ids: prev.equipo_ids.filter((_, idx) => idx !== indexToRemove),
      equipo_nombres: prev.equipo_nombres.filter((_, idx) => idx !== indexToRemove)
    }));
  };

  // Cambio de Área Responsable
  const handleAreaResponsableChange = (e) => {
    const idSel = e.target.value;
    const areaObj = areas.find(a => String(a.id) === String(idSel));
    setFormData(prev => ({
      ...prev,
      area_responsable_id: areaObj ? areaObj.id : null,
      area_responsable: areaObj ? areaObj.nombre : ''
    }));
  };

  // Cambio de Responsable Principal
  const handleResponsableChange = (e) => {
    const idSel = e.target.value;
    const empObj = empleadosActivos.find(emp => String(emp.id) === String(idSel));
    setFormData(prev => ({
      ...prev,
      responsable_id: empObj ? empObj.id : null,
      nombre_responsable: empObj ? empObj.nombre : ''
    }));
  };

  // Cambio de Responsable de Apoyo
  const handleApoyoChange = (e) => {
    const idSel = e.target.value;
    const empObj = empleadosActivos.find(emp => String(emp.id) === String(idSel));
    setFormData(prev => ({
      ...prev,
      responsable_apoyo_id: empObj ? empObj.id : null,
      responsable_apoyo: empObj ? empObj.nombre : ''
    }));
  };

  // Cálculo automático inteligente del estado según lo llenado en el Análisis
  const calcularEstadoAutomatico = (datos) => {
    if (datos.fecha_cancelacion || (datos.comentario_cancelacion && datos.comentario_cancelacion.trim() !== '')) {
      return 'Cancelado';
    }
    if (datos.fecha_cierre) {
      return 'Concluido';
    }
    if (datos.estado === 'Futuro') {
      return 'Futuro';
    }
    if (datos.area_responsable && datos.nombre_responsable && datos.fecha_plan) {
      return 'Priorizado';
    }
    return datos.estado || 'Por Validar';
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    // 1. Validaciones de Registro de Sugerencia
    if (!formData.proceso.trim()) {
      return mostrarAviso('warning', 'Proceso requerido', 'Por favor escriba el proceso al que pertenece la sugerencia.');
    }
    if (formData.fuentes.length === 0) {
      return mostrarAviso('warning', 'Fuente requerida', 'Seleccione una Fuente de la lista desplegable.');
    }
    if (formData.descripcion_sugerencia.trim().length < 10) {
      return mostrarAviso('warning', 'Descripción muy corta', 'La descripción de la sugerencia debe tener al menos 10 caracteres.');
    }
    if (formData.categorias.length === 0) {
      return mostrarAviso('warning', 'Categoría requerida', 'Seleccione al menos una Categoría para la sugerencia.');
    }

    // 2. Validaciones de Análisis (si está en Modo Edición y tiene permisos)
    const estadoFinal = calcularEstadoAutomatico(formData);

    if (esModoEdicion && puedeAnalizar) {
      const intentaCancelar = Boolean(
        estadoFinal === 'Cancelado' ||
        formData.fecha_cancelacion ||
        formData.comentario_cancelacion.trim()
      );

      if (intentaCancelar) {
        if (!formData.fecha_cancelacion || formData.comentario_cancelacion.trim().length < 5) {
          return mostrarAviso(
            'warning',
            'Datos de Cancelación Incompletos',
            'Para cancelar una sugerencia debe indicar la Fecha de cancelación y el Motivo de cancelación (mínimo 5 caracteres).'
          );
        }
      } else {
        const inicioAnalisis = Boolean(
          formData.area_responsable ||
          formData.nombre_responsable ||
          formData.fecha_plan ||
          formData.impacto.length > 0 ||
          estadoFinal === 'Priorizado' ||
          estadoFinal === 'Concluido'
        );

        if (inicioAnalisis) {
          if (!formData.area_responsable) {
            return mostrarAviso('warning', 'Área responsable requerida', 'Seleccione el Área responsable del análisis.');
          }
          if (!formData.nombre_responsable) {
            return mostrarAviso('warning', 'Responsable requerido', 'Seleccione el Nombre del responsable de la sugerencia.');
          }
          if (!formData.fecha_plan) {
            return mostrarAviso('warning', 'Fecha planificada requerida', 'Seleccione la Fecha planificada para la implementación.');
          }
          if (formData.impacto.length === 0) {
            return mostrarAviso('warning', 'Impacto requerido', 'Seleccione el tipo de Impacto.');
          }
        }
      }
    }

    setLoading(true);
    try {
      const payload = {
        estado: estadoFinal,
        proceso: formData.proceso.trim(),
        fecha_plan: formData.fecha_plan || null,
        area_registro_id: formData.area_registro_id || null,
        area_registro: formData.area_registro || '',
        usuario_registro_id: formData.usuario_registro_id || null,
        usuario_registro: formData.usuario_registro || '',
        categorias: formData.categorias,
        fuentes: formData.fuentes,
        reconocido: formData.reconocido,
        impacto: formData.impacto,
        area_responsable_id: formData.area_responsable_id ? Number(formData.area_responsable_id) : null,
        area_responsable: formData.area_responsable || null,
        equipo_ids: formData.equipo_ids,
        equipo_nombres: formData.equipo_nombres,
        responsable_apoyo_id: formData.responsable_apoyo_id || null,
        responsable_apoyo: formData.responsable_apoyo || null,
        responsable_id: formData.responsable_id || null,
        nombre_responsable: formData.nombre_responsable || null,
        descripcion_sugerencia: formData.descripcion_sugerencia.trim(),
        beneficios_sugerencia: formData.beneficios_sugerencia.trim() || null,
        plan_accion: formData.plan_accion.trim() || null,
        fecha_cierre: formData.fecha_cierre || (estadoFinal === 'Concluido' ? obtenerFechaCortaLima() : null),
        comentario_adicional: formData.comentario_adicional.trim() || null,
        fecha_cancelacion: formData.fecha_cancelacion || (estadoFinal === 'Cancelado' ? obtenerFechaCortaLima() : null),
        comentario_cancelacion: formData.comentario_cancelacion.trim() || null,
        usuario_actualiza: currentUser?.nombre || 'Usuario'
      };

      if (esModoEdicion) {
        const res = await actualizarSugerencia(sugerenciaEditId, payload);
        mostrarAviso(
          'success',
          'Sugerencia Actualizada',
          `Los cambios de la tarjeta ${res.id_sugerencia || ''} se guardaron correctamente.`,
          `Estado actual: ${res.estado}`,
          () => navigate('/sugerencias/tracking')
        );
      } else {
        const res = await crearSugerencia(payload);
        mostrarAviso(
          'success',
          'Sugerencia Registrada',
          res._sincronizado === false
            ? 'Guardada en el dispositivo (Modo Offline). Se enviará automáticamente al recuperar señal.'
            : `La tarjeta ${res.id_sugerencia} fue registrada con éxito.`,
          `Estado inicial: ${res.estado}`,
          () => navigate('/sugerencias/tracking')
        );
      }
    } catch (err) {
      console.error(err);
      mostrarAviso('danger', 'Error al guardar', err.message || 'Ocurrió un error inesperado.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="sugerencia-form-page">
      {loading && <Loading />}

      {/* AVISO FLOTANTE MODERNO */}
      {avisoFlotante.visible && (
        <div className="tw-modal-backdrop" onClick={cerrarAviso}>
          <div
            className={`tw-modal-card tw-modal-${avisoFlotante.tipo}`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="tw-modal-header">
              <div className={`tw-modal-icon-circle ${avisoFlotante.tipo}`}>
                {avisoFlotante.tipo === 'danger' && '✕'}
                {avisoFlotante.tipo === 'warning' && '⚠️'}
                {avisoFlotante.tipo === 'success' && '✓'}
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

      <section className="sugerencia-card">
        <div className="card-head-modern">
          <div className="card-head-left">
            <h2>
              {esModoEdicion
                ? `Detalle y Análisis de Sugerencia ${formData.id_sugerencia ? `(${formData.id_sugerencia})` : ''}`
                : 'Nueva Tarjeta de Sugerencia'}
            </h2>
            <p>
              Usuario activo: <strong>{currentUser?.nombre}</strong>
            </p>
          </div>

          <div className="card-head-right">
            {esModoEdicion && (
              <div className="legend-item">
                <span className="legend-dot auto"></span>
                <span>Automático / Lectura</span>
              </div>
            )}
            <div className="legend-item">
              <span className="legend-dot manual"></span>
              <span>Debe completar</span>
            </div>
          </div>
        </div>

        <form onSubmit={handleSubmit} noValidate>
          {/* =========================================================
              1. DATOS AUTOMÁTICOS DEL REGISTRO
              (Oculto en Registro nuevo, visible únicamente en Análisis / Edición)
             ========================================================= */}
          {esModoEdicion && (
            <>
              <div className="section-title-row" style={{ marginTop: 0, borderTop: 'none', paddingTop: 0 }}>
                <div className="section-title">1. Datos del Solicitante y Registro</div>
              </div>

              <div className="grid-4-cols">
                <div className="field field-auto">
                  <label>
                    Estado Actual <span className="field-badge auto">AUTO</span>
                  </label>
                  <input type="text" value={calcularEstadoAutomatico(formData)} readOnly />
                </div>

                <div className="field field-auto">
                  <label>
                    Fecha y Hora (Lima) <span className="field-badge auto">AUTO</span>
                  </label>
                  <input
                    type="text"
                    value={esModoEdicion ? String(formData.fecha_registro).replace('T', ' ').slice(0, 19) : relojLima}
                    readOnly
                  />
                </div>

                <div className="field field-auto">
                  <label>
                    Registrado por <span className="field-badge auto">AUTO</span>
                  </label>
                  <input type="text" value={formData.usuario_registro} readOnly />
                </div>

                <div className="field field-auto">
                  <label>
                    Área de Registro <span className="field-badge auto">AUTO</span>
                  </label>
                  <input type="text" value={formData.area_registro || 'Sin área asignada'} readOnly />
                </div>
              </div>
            </>
          )}

          {/* =========================================================
              2. CLASIFICACIÓN Y DETALLE DE LA SUGERENCIA
             ========================================================= */}
          <div
            className="section-title-row"
            style={!esModoEdicion ? { marginTop: 0, borderTop: 'none', paddingTop: 0 } : undefined}
          >
            <div className="section-title">
              {esModoEdicion ? '2. Clasificación y Detalle de la Sugerencia' : 'Clasificación y Detalle de la Sugerencia'}
            </div>
          </div>

          {/* PRIMERA FILA: PROCESO | FUENTE (Desplegable de 1 opción) */}
          <div className="grid-2-cols">
            <div className={`field ${puedeEditarDetalleInicial ? 'field-manual' : 'field-auto'}`}>
              <label>
                Proceso <span className="field-badge manual">OBLIGATORIO</span>
              </label>
              <input
                type="text"
                placeholder="Ej: Recepción, Picking, Despacho, Inventario..."
                value={formData.proceso}
                onChange={(e) => setFormData({ ...formData, proceso: e.target.value })}
                disabled={!puedeEditarDetalleInicial}
                required
              />
            </div>

            <div className={`field ${puedeEditarDetalleInicial ? 'field-manual' : 'field-auto'}`}>
              <label>
                Fuente <span className="field-badge manual">OBLIGATORIO</span>
              </label>
              <select
                value={formData.fuentes[0] || ''}
                onChange={(e) => handleSelectUnicoEnArray('fuentes', e.target.value)}
                disabled={!puedeEditarDetalleInicial}
                required
              >
                <option value="">Seleccione una fuente...</option>
                {FUENTES_OPCIONES.map((item) => (
                  <option key={item} value={item}>{item}</option>
                ))}
              </select>
            </div>
          </div>

          {/* SEGUNDA FILA: SOLO EQUIPO INVOLUCRADO */}
          <div style={{ marginTop: '12px' }}>
            <div className={`field ${puedeEditarDetalleInicial ? 'field-manual' : 'field-auto'} equipo-autocomplete-wrapper`}>
              <label>
                Equipo Involucrado (Personal) <span className="field-badge optional">OPCIONAL</span>
              </label>
              {puedeEditarDetalleInicial && (
                <input
                  type="text"
                  placeholder="Buscar colaborador por nombre o DNI para agregar al equipo..."
                  value={busquedaEquipo}
                  onChange={(e) => {
                    setBusquedaEquipo(e.target.value);
                    setMostrarDropdownEquipo(true);
                  }}
                  onFocus={() => setMostrarDropdownEquipo(true)}
                  onBlur={() => setTimeout(() => setMostrarDropdownEquipo(false), 180)}
                />
              )}

              {mostrarDropdownEquipo && sugerenciasEquipo.length > 0 && (
                <div className="equipo-dropdown-list">
                  {sugerenciasEquipo.map((emp) => (
                    <div
                      key={emp.id}
                      className="equipo-dropdown-item"
                      onMouseDown={() => agregarIntegranteEquipo(emp)}
                    >
                      <span>{emp.nombre}</span>
                      <small style={{ color: '#64748b' }}>{emp.dni}</small>
                    </div>
                  ))}
                </div>
              )}

              <div className="equipo-selected-tags">
                {formData.equipo_nombres.length === 0 ? (
                  <span style={{ fontSize: '11.5px', color: '#94a3b8' }}>
                    Ningún integrante adicional seleccionado.
                  </span>
                ) : (
                  formData.equipo_nombres.map((nom, idx) => (
                    <span key={idx} className="equipo-tag-pill">
                      {nom}
                      {puedeEditarDetalleInicial && (
                        <button
                          type="button"
                          className="equipo-tag-remove"
                          onClick={() => quitarIntegranteEquipo(idx)}
                          title="Quitar del equipo"
                        >
                          ×
                        </button>
                      )}
                    </span>
                  ))
                )}
              </div>
            </div>
          </div>

          {/* TERCERA FILA: DESCRIPCIÓN Y BENEFICIOS DE LA SUGERENCIA */}
          <div className="grid-2-cols" style={{ marginTop: '12px' }}>
            <div className={`field ${puedeEditarDetalleInicial ? 'field-manual' : 'field-auto'}`}>
              <label>
                Descripción de la Sugerencia <span className="field-badge manual">OBLIGATORIO</span>
              </label>
              <textarea
                rows="3"
                placeholder="Describa detalladamente la idea o mejora propuesta..."
                value={formData.descripcion_sugerencia}
                onChange={(e) => setFormData({ ...formData, descripcion_sugerencia: e.target.value })}
                disabled={!puedeEditarDetalleInicial}
                required
              />
              <div className="counter">{formData.descripcion_sugerencia.length} caracteres</div>
            </div>

            <div className={`field ${puedeEditarDetalleInicial ? 'field-manual' : 'field-auto'}`}>
              <label>
                Beneficios de la Sugerencia <span className="field-badge optional">RECOMENDADO</span>
              </label>
              <textarea
                rows="3"
                placeholder="¿Qué beneficio o ahorro traerá esta mejora?..."
                value={formData.beneficios_sugerencia}
                onChange={(e) => setFormData({ ...formData, beneficios_sugerencia: e.target.value })}
                disabled={!puedeEditarDetalleInicial}
              />
              <div className="counter">{formData.beneficios_sugerencia.length} caracteres</div>
            </div>
          </div>

          {/* CUARTA FILA: CATEGORÍAS (Selección múltiple) */}
          <div style={{ marginTop: '12px' }}>
            <div className={`field ${puedeEditarDetalleInicial ? 'field-manual' : 'field-auto'}`}>
              <label>
                Categorías (Marque una o más) <span className="field-badge manual">OBLIGATORIO</span>
              </label>
              <div className="chips-selector-grid">
                {CATEGORIAS_OPCIONES.map((item) => {
                  const marcado = formData.categorias.includes(item);
                  return (
                    <button
                      type="button"
                      key={item}
                      disabled={!puedeEditarDetalleInicial}
                      className={`chip-check-btn ${marcado ? 'selected' : ''}`}
                      onClick={() => toggleItemArray('categorias', item)}
                    >
                      <span className="chip-check-box">✓</span>
                      <span>{item}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* =========================================================
              3. ANÁLISIS, RESPONSABLES Y SEGUIMIENTO
              (Visible únicamente al entrar a Analizar / Editar desde la tabla)
             ========================================================= */}
          {esModoEdicion && (
            <>
              <div className="section-title-row">
                <div className="section-title">3. Análisis, Asignación y Seguimiento</div>
                <span style={{ fontSize: '11.5px', color: '#64748b', fontWeight: 600 }}>
                  {puedeAnalizar ? 'Modo Edición Habilitado' : 'Modo Solo Lectura'}
                </span>
              </div>

              {/* PRIMERA FILA: Área responsable - Nombre del responsable - Responsable de apoyo - Fecha planificada */}
              <div className="grid-4-cols">
                <div className="field field-manual">
                  <label>
                    Área Responsable <span className="field-badge manual">EDITAR</span>
                  </label>
                  <select
                    value={formData.area_responsable_id || ''}
                    onChange={handleAreaResponsableChange}
                    disabled={!puedeAnalizar}
                  >
                    <option value="">Seleccione un área...</option>
                    {areas.map((a) => (
                      <option key={a.id} value={a.id}>{a.nombre}</option>
                    ))}
                  </select>
                </div>

                <div className="field field-manual">
                  <label>
                    Nombre del Responsable <span className="field-badge manual">EDITAR</span>
                  </label>
                  <select
                    value={formData.responsable_id || ''}
                    onChange={handleResponsableChange}
                    disabled={!puedeAnalizar}
                  >
                    <option value="">Seleccione responsable...</option>
                    {empleadosActivos.map((emp) => (
                      <option key={emp.id} value={emp.id}>{emp.nombre}</option>
                    ))}
                  </select>
                </div>

                <div className="field field-manual">
                  <label>
                    Responsable de Apoyo <span className="field-badge optional">OPCIONAL</span>
                  </label>
                  <select
                    value={formData.responsable_apoyo_id || ''}
                    onChange={handleApoyoChange}
                    disabled={!puedeAnalizar}
                  >
                    <option value="">Seleccione apoyo (opcional)...</option>
                    {empleadosActivos.map((emp) => (
                      <option key={emp.id} value={emp.id}>{emp.nombre}</option>
                    ))}
                  </select>
                </div>

                <div className="field field-manual">
                  <label>
                    Fecha Planificada <span className="field-badge manual">EDITAR</span>
                  </label>
                  <input
                    type="date"
                    value={formData.fecha_plan}
                    onChange={(e) => setFormData({ ...formData, fecha_plan: e.target.value })}
                    disabled={!puedeAnalizar}
                  />
                </div>
              </div>

              {/* SEGUNDA FILA: Fecha de Cierre - Fecha de Cancelación - Reconocido como - Impacto */}
              <div className="grid-4-cols" style={{ marginTop: '12px' }}>
                <div className="field field-manual">
                  <label>
                    Fecha de Cierre <span className="field-badge optional">CIERRE</span>
                  </label>
                  <input
                    type="date"
                    value={formData.fecha_cierre}
                    onChange={(e) => setFormData({ ...formData, fecha_cierre: e.target.value })}
                    disabled={!puedeAnalizar}
                  />
                </div>

                <div className="field field-manual">
                  <label>
                    Fecha de Cancelación <span className="field-badge optional">CANCELAR</span>
                  </label>
                  <input
                    type="date"
                    value={formData.fecha_cancelacion}
                    onChange={(e) => setFormData({ ...formData, fecha_cancelacion: e.target.value })}
                    disabled={!puedeAnalizar}
                  />
                </div>

                <div className="field field-manual">
                  <label>
                    Reconocido como <span className="field-badge optional">OPCIONAL</span>
                  </label>
                  <select
                    value={formData.reconocido[0] || ''}
                    onChange={(e) => handleSelectUnicoEnArray('reconocido', e.target.value)}
                    disabled={!puedeAnalizar}
                  >
                    <option value="">Seleccione opción...</option>
                    {RECONOCIDO_OPCIONES.map((item) => (
                      <option key={item} value={item}>{item}</option>
                    ))}
                  </select>
                </div>

                <div className="field field-manual">
                  <label>
                    Impacto <span className="field-badge manual">EDITAR</span>
                  </label>
                  <select
                    value={formData.impacto[0] || ''}
                    onChange={(e) => handleSelectUnicoEnArray('impacto', e.target.value)}
                    disabled={!puedeAnalizar}
                  >
                    <option value="">Seleccione impacto...</option>
                    {IMPACTO_OPCIONES.map((item) => (
                      <option key={item} value={item}>{item}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* TERCERA FILA: Comentario Adicional - Motivo de Cancelación */}
              <div className="grid-2-cols" style={{ marginTop: '12px' }}>
                <div className="field field-manual">
                  <label>
                    Comentario Adicional <span className="field-badge optional">CIERRE</span>
                  </label>
                  <input
                    type="text"
                    maxLength={120}
                    placeholder="Comentario de seguimiento o cierre..."
                    value={formData.comentario_adicional}
                    onChange={(e) => setFormData({ ...formData, comentario_adicional: e.target.value })}
                    disabled={!puedeAnalizar}
                  />
                </div>

                <div className="field field-manual">
                  <label>
                    Motivo de Cancelación <span className="field-badge optional">CANCELAR</span>
                  </label>
                  <input
                    type="text"
                    maxLength={120}
                    placeholder="Motivo por el cual se cancela..."
                    value={formData.comentario_cancelacion}
                    onChange={(e) => setFormData({ ...formData, comentario_cancelacion: e.target.value })}
                    disabled={!puedeAnalizar}
                  />
                </div>
              </div>

              {/* CUARTA FILA: Plan de Acción */}
              <div style={{ marginTop: '12px' }}>
                <div className="field field-manual">
                  <label>
                    Plan de Acción <span className="field-badge manual">EDITAR</span>
                  </label>
                  <textarea
                    rows="2"
                    placeholder="Describa las actividades del plan de acción..."
                    value={formData.plan_accion}
                    onChange={(e) => setFormData({ ...formData, plan_accion: e.target.value })}
                    disabled={!puedeAnalizar}
                  />
                </div>
              </div>

              {/* FILA DE CONTROL Y AUDITORÍA: Estado Manual - Fecha/Hora Actualiza - Usuario Actualiza */}
              <div className="grid-3-cols" style={{ marginTop: '12px' }}>
                <div className="field field-manual">
                  <label>
                    Estado Manual <span className="field-badge optional">ESTADO</span>
                  </label>
                  <select
                    value={formData.estado}
                    onChange={(e) => setFormData({ ...formData, estado: e.target.value })}
                    disabled={!puedeAnalizar}
                  >
                    <option value="Por Validar">Por Validar</option>
                    <option value="Priorizado">Priorizado</option>
                    <option value="Futuro">Futuro</option>
                    <option value="Concluido">Concluido</option>
                    <option value="Cancelado">Cancelado</option>
                  </select>
                </div>

                <div className="field field-auto">
                  <label>
                    Última Actualización <span className="field-badge auto">AUTO</span>
                  </label>
                  <input
                    type="text"
                    value={
                      formData.fechahora_actualiza
                        ? String(formData.fechahora_actualiza).replace('T', ' ').slice(0, 19)
                        : '-'
                    }
                    readOnly
                  />
                </div>

                <div className="field field-auto">
                  <label>
                    Actualizado por <span className="field-badge auto">AUTO</span>
                  </label>
                  <input type="text" value={formData.usuario_actualiza || '-'} readOnly />
                </div>
              </div>
            </>
          )}

          <div className="submit-row">
            <button
              type="button"
              className="secondary-btn"
              onClick={() => navigate('/sugerencias/tracking')}
            >
              Volver al Tracking
            </button>

            {(!esModoEdicion || puedeAnalizar || puedeEditarDetalleInicial) && (
              <button type="submit" className="primary-btn" disabled={loading}>
                {esModoEdicion ? 'Actualizar Sugerencia' : 'Registrar Sugerencia'}
              </button>
            )}
          </div>
        </form>
      </section>
    </div>
  );
}