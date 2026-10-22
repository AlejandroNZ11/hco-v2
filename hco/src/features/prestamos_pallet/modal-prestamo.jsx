import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { FaPenNib, FaSave, FaEraser, FaUserPlus, FaTruck, FaChartLine } from 'react-icons/fa';
import Loading from '../../layouts/Loading';
import './modal-prestamo.css';

import {
  obtenerDatosMaestrosPrestamos,
  crearPrestamoPallet,
  buscarConductorPorDni,
  guardarConductorMaestro,
  buscarPlacaPorNro,
  guardarPlacaMaestra
} from '../../services/prestamosService';

function getStoredAuthUser() {
  const raw = localStorage.getItem("authUser") || sessionStorage.getItem("authUser");
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

const ROLES_GESTION = ['ADMIN', 'SUPERVISOR', 'SUPERADMIN', 'SUPER_ADMIN'];

export default function ModalPrestamo() {
  const navigate = useNavigate();
  const [currentUser] = useState(() => getStoredAuthUser());
  const [loading, setLoading] = useState(false);
  const [reloj, setReloj] = useState('');

  // Listas de Tablas Maestras
  const [empresas, setEmpresas] = useState([]);
  const [conductores, setConductores] = useState([]);
  const [placas, setPlacas] = useState([]);
  const [clientes, setClientes] = useState([]);
  const [tiposPaleta, setTiposPaleta] = useState([]);

  const nombreUsuarioActual = currentUser?.nombre || currentUser?.usuario || 'Usuario';

  const [formData, setFormData] = useState({
    area_proceso: '',
    empresa_transporte_id: '',
    conductor_nombre: '',
    dni_conductor: '',
    cliente_nombre: '',
    nr_ruta: '',
    nro_placa: '',
    despachador: nombreUsuarioActual,
    nr_paletas: '',
    tipo_paleta_id: '',
    retorno: 'NO',
    observacion_salida: '',
    firma_conductor_base64: '',
    foto_salida_base64: ''
  });

  const [mostrarModalFirma, setMostrarModalFirma] = useState(false);
  const [mostrarModalConductor, setMostrarModalConductor] = useState(false);
  const [mostrarModalPlaca, setMostrarModalPlaca] = useState(false);

  const canvasRef = useRef(null);
  const dibujandoRef = useRef(false);
  const tieneTrazoRef = useRef(false);

  // Estado para Buscador / Creador / Editor de Conductor
  const [nuevoCond, setNuevoCond] = useState({
    dni: '',
    nombre: '',
    empresa_id: '',
    estadoBusqueda: 'Ingrese 8 dígitos para buscar o crear el conductor.',
    colorEstado: '#64748b',
    existe: false,
    infoAuditoria: ''
  });

  // Estado para Buscador / Creador / Editor de Placa
  const [nuevaPlaca, setNuevaPlaca] = useState({
    nro_placa: '',
    empresa_id: '',
    estadoBusqueda: 'Ingrese 6 caracteres para buscar o crear la placa.',
    colorEstado: '#64748b',
    existe: false,
    infoAuditoria: ''
  });

  const [avisoFlotante, setAvisoFlotante] = useState({
    visible: false, tipo: 'danger', titulo: '', mensaje: '', detalleExtra: '', onCloseCallback: null
  });

  const mostrarAviso = (tipo, titulo, mensaje, detalleExtra = '', onCloseCallback = null) => {
    setAvisoFlotante({ visible: true, tipo, titulo, mensaje, detalleExtra, onCloseCallback });
  };

  const cerrarAviso = () => {
    const cb = avisoFlotante.onCloseCallback;
    setAvisoFlotante(prev => ({ ...prev, visible: false, onCloseCallback: null }));
    if (typeof cb === 'function') cb();
  };

  const rolUsuario = String(currentUser?.rol || currentUser?.role || '').trim().toUpperCase();
  const puedeGestionarMaestros = ROLES_GESTION.includes(rolUsuario);

  useEffect(() => {
    const actualizarHora = () => {
      const ahora = new Date();
      setReloj(ahora.toLocaleString('es-PE', {
        timeZone: 'America/Lima',
        day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
      }));
    };
    actualizarHora();
    const timer = setInterval(actualizarHora, 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!currentUser) { navigate('/'); return; }
    cargarMaestros();
  }, [currentUser, navigate]);

  const cargarMaestros = async () => {
    setLoading(true);
    try {
      const data = await obtenerDatosMaestrosPrestamos();
      setEmpresas(data.empresas || []);
      setConductores(data.conductores || []);
      setPlacas(data.placas || []);
      setClientes(data.clientes || []);
      setTiposPaleta(data.tipos_paleta || []);
    } catch (err) {
      mostrarAviso('danger', 'Error al cargar catálogos', err.message);
    } finally {
      setLoading(false);
    }
  };

  const esInbound = formData.area_proceso === 'INBOUND';
  const cantPaletasNum = formData.nr_paletas === '' ? 0 : Number(formData.nr_paletas);
  const sinSalidaPallet = formData.nr_paletas === '' || cantPaletasNum === 0;

  const handleAreaChange = (e) => {
    const nuevaArea = e.target.value;
    setFormData(prev => ({
      ...prev,
      area_proceso: nuevaArea,
      cliente_nombre: nuevaArea === 'INBOUND' ? '' : prev.cliente_nombre,
      tipo_paleta_id: nuevaArea === 'INBOUND' ? '' : prev.tipo_paleta_id
    }));
  };

  const handlePaletasChange = (e) => {
    const val = e.target.value.replace(/\D/g, '').slice(0, 3);
    const num = val === '' ? 0 : Number(val);
    const esCero = val === '' || num === 0;

    setFormData(prev => ({
      ...prev,
      nr_paletas: val,
      tipo_paleta_id: esCero ? '' : prev.tipo_paleta_id,
      retorno: esCero ? 'NO' : 'SI'
    }));
  };

  // Buscador de conductor en el formulario principal -> Autocompleta DNI y Empresa
  const handleConductorChange = (e) => {
    const valorEscrito = e.target.value;
    const normalizar = (str) => String(str || '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const buscado = normalizar(valorEscrito);

    const encontrado = conductores.find(
      c => normalizar(c.nombre_conductor) === buscado
    );

    setFormData(prev => ({
      ...prev,
      conductor_nombre: valorEscrito,
      dni_conductor: encontrado ? encontrado.dni_conductor : '',
      empresa_transporte_id: encontrado?.empresa_id ? String(encontrado.empresa_id) : prev.empresa_transporte_id
    }));
  };

  // Buscador de placa en el formulario principal -> Si tiene empresa asociada y no hay empresa elegida, la selecciona
  const handlePlacaInputForm = (e) => {
    const placaVal = e.target.value.replace(/[^a-zA-Z0-9]/g, '').slice(0, 6).toUpperCase();
    const placaObj = placas.find(p => p.nro_placa === placaVal);

    setFormData(prev => ({
      ...prev,
      nro_placa: placaVal,
      empresa_transporte_id: (!prev.empresa_transporte_id && placaObj?.empresa_id)
        ? String(placaObj.empresa_id)
        : prev.empresa_transporte_id
    }));
  };

  const handleFotoSalidaChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      return mostrarAviso('warning', 'Archivo inválido', 'Seleccione una imagen válida.');
    }
    try {
      setLoading(true);
      const dataUrlPng = await comprimirImagenAPng(file, 1280);
      setFormData(prev => ({ ...prev, foto_salida_base64: dataUrlPng }));
    } catch {
      mostrarAviso('danger', 'Error de imagen', 'No se pudo procesar la fotografía.');
    } finally {
      setLoading(false);
    }
  };

  const comprimirImagenAPng = (file, maxWidth = 1280) => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const img = new Image();
        img.onload = () => {
          const scale = Math.min(1, maxWidth / img.width);
          const canvas = document.createElement('canvas');
          canvas.width = Math.round(img.width * scale);
          canvas.height = Math.round(img.height * scale);
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          resolve(canvas.toDataURL('image/png'));
        };
        img.onerror = reject;
        img.src = reader.result;
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  };

  // =========================================================================
  // CANVAS DE FIRMA
  // =========================================================================
  useEffect(() => {
    if (mostrarModalFirma && canvasRef.current) {
      const canvas = canvasRef.current;
      const rect = canvas.parentElement.getBoundingClientRect();
      canvas.width = Math.floor(rect.width) - 48;
      canvas.height = 300;
      const ctx = canvas.getContext('2d');
      ctx.lineWidth = 2.5; ctx.lineCap = 'round'; ctx.strokeStyle = '#102033';
      tieneTrazoRef.current = false;
    }
  }, [mostrarModalFirma]);

  const iniciarTrazo = (e) => {
    if (!canvasRef.current) return;
    dibujandoRef.current = true;
    tieneTrazoRef.current = true;
    const rect = canvasRef.current.getBoundingClientRect();
    const ctx = canvasRef.current.getContext('2d');
    ctx.beginPath();
    ctx.moveTo(e.clientX - rect.left, e.clientY - rect.top);
  };

  const moverTrazo = (e) => {
    if (!dibujandoRef.current || !canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const ctx = canvasRef.current.getContext('2d');
    ctx.lineTo(e.clientX - rect.left, e.clientY - rect.top);
    ctx.stroke();
  };

  const finalizarTrazo = () => { dibujandoRef.current = false; };

  const limpiarCanvas = () => {
    if (!canvasRef.current) return;
    const ctx = canvasRef.current.getContext('2d');
    ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
    tieneTrazoRef.current = false;
  };

  const confirmarFirmaCanvas = () => {
    if (!tieneTrazoRef.current) {
      return mostrarAviso('warning', 'Firma vacía', 'Por favor dibuje la firma antes de guardar.');
    }
    setFormData(prev => ({ ...prev, firma_conductor_base64: canvasRef.current.toDataURL('image/png') }));
    setMostrarModalFirma(false);
  };

  // =========================================================================
  // LÓGICA MODAL CONDUCTOR (BUSCADOR + CREADOR + EDITOR)
  // =========================================================================
  const handleBuscarDniModal = async (dniInput) => {
    const limpio = dniInput.replace(/\D/g, '').slice(0, 8);
    setNuevoCond(prev => ({ ...prev, dni: limpio }));

    if (limpio.length < 8) {
      setNuevoCond(prev => ({
        ...prev,
        dni: limpio,
        existe: false,
        estadoBusqueda: 'Ingrese 8 dígitos para buscar si el conductor ya existe.',
        colorEstado: '#64748b',
        infoAuditoria: ''
      }));
      return;
    }

    // 1. Buscar en lista local cargada
    const local = conductores.find(c => String(c.dni_conductor) === limpio);
    if (local) {
      setNuevoCond({
        dni: limpio,
        nombre: local.nombre_conductor || '',
        empresa_id: String(local.empresa_id || ''),
        existe: true,
        estadoBusqueda: '✓ DNI encontrado. Puede editar el nombre o la empresa.',
        colorEstado: '#16a34a',
        infoAuditoria: local.usuario_actualiza
          ? `Última edición por: ${local.usuario_actualiza}`
          : (local.usuario_registra ? `Registrado por: ${local.usuario_registra}` : '')
      });
      return;
    }

    // 2. Buscar en Supabase directamente
    try {
      const remoto = await buscarConductorPorDni(limpio);
      if (remoto) {
        setNuevoCond({
          dni: limpio,
          nombre: remoto.nombre_conductor || '',
          empresa_id: String(remoto.empresa_id || ''),
          existe: true,
          estadoBusqueda: '✓ DNI encontrado en base de datos. Puede editar sus datos.',
          colorEstado: '#16a34a',
          infoAuditoria: remoto.usuario_actualiza
            ? `Última edición por: ${remoto.usuario_actualiza}`
            : (remoto.usuario_registra ? `Registrado por: ${remoto.usuario_registra}` : '')
        });
      } else {
        setNuevoCond(prev => ({
          ...prev,
          dni: limpio,
          nombre: '',
          empresa_id: formData.empresa_transporte_id || '',
          existe: false,
          estadoBusqueda: 'DNI no registrado. Complete nombre y empresa para crearlo.',
          colorEstado: '#0f4c81',
          infoAuditoria: ''
        }));
      }
    } catch {
      setNuevoCond(prev => ({
        ...prev,
        estadoBusqueda: 'Complete los datos para guardar el conductor.',
        colorEstado: '#d97706'
      }));
    }
  };

  const handleGuardarConductorModal = async (e) => {
    e.preventDefault();
    if (nuevoCond.dni.length !== 8 || !nuevoCond.nombre.trim() || !nuevoCond.empresa_id) {
      return mostrarAviso('warning', 'Campos obligatorios', 'Debe ingresar el DNI de 8 dígitos, el nombre en mayúsculas y seleccionar la empresa.');
    }
    setLoading(true);
    try {
      const res = await guardarConductorMaestro({
        dni: nuevoCond.dni,
        nombre: nuevoCond.nombre.trim().toUpperCase(),
        empresa_id: nuevoCond.empresa_id,
        usuario: nombreUsuarioActual
      });
      await cargarMaestros();
      setFormData(prev => ({
        ...prev,
        conductor_nombre: res.conductor.nombre_conductor,
        dni_conductor: res.conductor.dni_conductor,
        empresa_transporte_id: String(res.conductor.empresa_id)
      }));
      setMostrarModalConductor(false);
      mostrarAviso(
        'success',
        res.accion === 'actualizado' ? 'Conductor Actualizado' : 'Conductor Creado',
        `El conductor ${res.conductor.nombre_conductor} (${res.conductor.dni_conductor}) fue ${res.accion} correctamente.`
      );
    } catch (err) {
      mostrarAviso('danger', 'Error al guardar conductor', err.message);
    } finally {
      setLoading(false);
    }
  };

  // =========================================================================
  // LÓGICA MODAL PLACA (BUSCADOR + CREADOR + EDITOR)
  // =========================================================================
  const handleBuscarPlacaModal = async (inputPlaca) => {
    const limpia = inputPlaca.replace(/[^a-zA-Z0-9]/g, '').slice(0, 6).toUpperCase();
    setNuevaPlaca(prev => ({ ...prev, nro_placa: limpia }));

    if (limpia.length < 6) {
      setNuevaPlaca(prev => ({
        ...prev,
        nro_placa: limpia,
        existe: false,
        estadoBusqueda: 'Ingrese los 6 caracteres de la placa para buscar si ya existe.',
        colorEstado: '#64748b',
        infoAuditoria: ''
      }));
      return;
    }

    // 1. Buscar en lista local
    const local = placas.find(p => p.nro_placa === limpia);
    if (local) {
      setNuevaPlaca({
        nro_placa: limpia,
        empresa_id: String(local.empresa_id || ''),
        existe: true,
        estadoBusqueda: '✓ La placa ya existe. Puede modificar la empresa a la que pertenece.',
        colorEstado: '#16a34a',
        infoAuditoria: local.usuario_actualiza
          ? `Última edición por: ${local.usuario_actualiza}`
          : (local.usuario_registra ? `Registrada por: ${local.usuario_registra}` : '')
      });
      return;
    }

    // 2. Buscar en Supabase
    try {
      const remota = await buscarPlacaPorNro(limpia);
      if (remota) {
        setNuevaPlaca({
          nro_placa: limpia,
          empresa_id: String(remota.empresa_id || ''),
          existe: true,
          estadoBusqueda: '✓ La placa ya existe en el sistema. Puede actualizar su empresa.',
          colorEstado: '#16a34a',
          infoAuditoria: remota.usuario_actualiza
            ? `Última edición por: ${remota.usuario_actualiza}`
            : (remota.usuario_registra ? `Registrada por: ${remota.usuario_registra}` : '')
        });
      } else {
        setNuevaPlaca(prev => ({
          ...prev,
          nro_placa: limpia,
          empresa_id: formData.empresa_transporte_id || '',
          existe: false,
          estadoBusqueda: 'Placa no registrada. Seleccione su empresa de transporte para crearla.',
          colorEstado: '#0f4c81',
          infoAuditoria: ''
        }));
      }
    } catch {
      setNuevaPlaca(prev => ({
        ...prev,
        estadoBusqueda: 'Seleccione la empresa para guardar la placa.',
        colorEstado: '#d97706'
      }));
    }
  };

  const handleGuardarPlacaModal = async (e) => {
    e.preventDefault();
    const placaLimpia = nuevaPlaca.nro_placa.replace(/[^A-Z0-9]/g, '').slice(0, 6);
    if (placaLimpia.length !== 6 || !nuevaPlaca.empresa_id) {
      return mostrarAviso('warning', 'Campos obligatorios', 'La placa debe tener 6 caracteres y debe seleccionar a qué empresa pertenece.');
    }
    setLoading(true);
    try {
      const res = await guardarPlacaMaestra({
        nro_placa: placaLimpia,
        empresa_id: nuevaPlaca.empresa_id,
        usuario: nombreUsuarioActual
      });
      await cargarMaestros();
      setFormData(prev => ({
        ...prev,
        nro_placa: res.placa.nro_placa,
        empresa_transporte_id: String(res.placa.empresa_id || prev.empresa_transporte_id)
      }));
      setMostrarModalPlaca(false);
      mostrarAviso(
        'success',
        res.accion === 'actualizada' ? 'Placa Actualizada' : 'Placa Creada',
        `La placa ${res.placa.nro_placa} fue ${res.accion} exitosamente.`
      );
    } catch (err) {
      mostrarAviso('danger', 'Error al guardar placa', err.message);
    } finally {
      setLoading(false);
    }
  };

  // =========================================================================
  // GUARDAR PRÉSTAMO
  // =========================================================================
  const handleSubmitPrestamo = async (e) => {
    e.preventDefault();
    if (!formData.area_proceso) return mostrarAviso('warning', 'Falta área', 'Seleccione el Área del proceso.');
    if (!formData.empresa_transporte_id) return mostrarAviso('warning', 'Falta empresa', 'Seleccione la Empresa de transporte.');
    if (!formData.dni_conductor) return mostrarAviso('warning', 'Falta conductor', 'Seleccione un conductor válido de la lista para que se cargue su DNI.');
    if (!esInbound && !formData.cliente_nombre.trim()) return mostrarAviso('warning', 'Falta cliente', 'Indique el Cliente.');
    if (!/^\d{1,2}$/.test(formData.nr_ruta.trim())) return mostrarAviso('warning', 'Ruta inválida', 'El N° de ruta debe tener 1 o 2 dígitos.');
    if (formData.nro_placa.length !== 6) return mostrarAviso('warning', 'Placa inválida', 'La placa debe tener 6 caracteres.');
    if (!placas.some(p => p.nro_placa === formData.nro_placa)) return mostrarAviso('danger', 'Placa no registrada', 'La placa ingresada no existe en la tabla placas. Seleccione una de la lista o regístrela en "+ Nueva Placa".');
    if (!esInbound && !sinSalidaPallet && !formData.tipo_paleta_id) return mostrarAviso('warning', 'Falta tipo de paleta', 'Seleccione el tipo de paleta.');
    if (sinSalidaPallet && !formData.observacion_salida.trim()) return mostrarAviso('warning', 'Falta observación', 'La observación de salida es obligatoria cuando no hay salida de pallet.');
    if (!formData.firma_conductor_base64) return mostrarAviso('warning', 'Falta firma', 'Debe registrar la firma del conductor.');

    setLoading(true);
    try {
      const creado = await crearPrestamoPallet({
        ...formData,
        usuario_registra: nombreUsuarioActual,
        area_registrador: currentUser?.area || ''
      });
      mostrarAviso(
        'success',
        'Préstamo Registrado',
        `El préstamo ${creado.id_prestamo} se guardó correctamente.`,
        `Placa: ${creado.nro_placa} | Paletas: ${creado.nr_paletas}`,
        () => navigate('/prestamos/tracking')
      );
    } catch (err) {
      mostrarAviso('danger', 'Error', err.message);
    } finally {
      setLoading(false);
    }
  };

  const limpiarFormulario = () => {
    setFormData({
      area_proceso: '',
      empresa_transporte_id: '',
      conductor_nombre: '',
      dni_conductor: '',
      cliente_nombre: '',
      nr_ruta: '',
      nro_placa: '',
      despachador: nombreUsuarioActual,
      nr_paletas: '',
      tipo_paleta_id: '',
      retorno: 'NO',
      observacion_salida: '',
      firma_conductor_base64: '',
      foto_salida_base64: ''
    });
  };

  return (
    <div className="registro-page-p">
      {loading && <Loading />}

      {/* AVISO FLOTANTE MODERNO */}
      {avisoFlotante.visible && (
        <div className="tw-modal-backdrop" onClick={cerrarAviso}>
          <div className={`tw-modal-card tw-modal-${avisoFlotante.tipo}`} onClick={e => e.stopPropagation()}>
            <div className="tw-modal-header">
              <div className={`tw-modal-icon-circle ${avisoFlotante.tipo}`}>
                {avisoFlotante.tipo === 'danger' && <span>✖</span>}
                {avisoFlotante.tipo === 'warning' && <span>⚠️</span>}
                {avisoFlotante.tipo === 'success' && <span>✔</span>}
              </div>
              <div className="tw-modal-text">
                <h3 className="tw-modal-title">{avisoFlotante.titulo}</h3>
                <p className="tw-modal-desc">{avisoFlotante.mensaje}</p>
                {avisoFlotante.detalleExtra && <div className="tw-modal-extra-box">{avisoFlotante.detalleExtra}</div>}
              </div>
            </div>
            <div className="tw-modal-footer">
              <button type="button" className={`tw-modal-btn ${avisoFlotante.tipo}`} onClick={cerrarAviso}>Entendido</button>
            </div>
          </div>
        </div>
      )}

      {/* TARJETA PRINCIPAL */}
      <section className="card-p mb-4" style={{ maxWidth: '1200px', margin: '0 auto', borderRadius: '16px', padding: '30px' }}>
        <div className="card-head-modern-p" style={{ marginBottom: '18px' }}>
          <div className="card-head-left-p">
            <h2><FaChartLine style={{ color: '#0f4c81', marginRight: '8px' }} /> Nuevo préstamo</h2>
          </div>
          
        </div>

        <form onSubmit={handleSubmitPrestamo} className="form-container-p">
          <div className="section-title-p">DATOS DE SALIDA</div>

          {/* GRID FLUIDO DINÁMICO DE 4 COLUMNAS */}
          <div className="form-grid-p cols-4" style={{ marginBottom: '16px' }}>
            {/* 1. Fecha entrega */}
            <div className="field-p field-auto-p">
              <label>Fecha entrega</label>
              <input value={reloj} readOnly />
            </div>

            {/* 2. Área del proceso */}
            <div className="field-p field-manual-p">
              <label>Área del proceso</label>
              <select value={formData.area_proceso} onChange={handleAreaChange} required>
                <option value="">Seleccione...</option>
                <option value="OUTBOUND RETAIL">OUTBOUND RETAIL</option>
                <option value="OUTBOUND PRINCIPAL">OUTBOUND PRINCIPAL</option>
                <option value="INBOUND">INBOUND</option>
              </select>
            </div>

            {/* 3. Empresa transporte (Alfabético desde empresas_transporte) */}
            <div className="field-p field-manual-p">
              <label>Empresa transporte</label>
              <select
                value={formData.empresa_transporte_id}
                onChange={e => setFormData({ ...formData, empresa_transporte_id: e.target.value })}
                required
              >
                <option value="">Seleccione...</option>
                {empresas.map(emp => (
                  <option key={emp.id} value={emp.id}>{emp.nombre_empresa}</option>
                ))}
              </select>
            </div>

            {/* 4. Conductor (Buscador desde conductores) */}
            <div className="field-p field-manual-p">
              <div className="label-with-link-p">
                <label>Conductor</label>
                {puedeGestionarMaestros && (
                  <span
                    className="link-action-p"
                    onClick={() => {
                      setNuevoCond({
                        dni: '',
                        nombre: '',
                        empresa_id: formData.empresa_transporte_id || '',
                        estadoBusqueda: 'Ingrese 8 dígitos para buscar o crear el conductor.',
                        colorEstado: '#64748b',
                        existe: false,
                        infoAuditoria: ''
                      });
                      setMostrarModalConductor(true);
                    }}
                  >
                    <FaUserPlus style={{ marginRight: '4px' }} /> Nuevo Conductor
                  </span>
                )}
              </div>
              <input
                list="listaCond"
                value={formData.conductor_nombre}
                onChange={handleConductorChange}
                placeholder="Buscar conductor..."
                autoComplete="off"
                required
              />
                <datalist id="listaCond">
                    {conductores.map((c, index) => <option key={`${c.dni_conductor}-${index}`} value={c.nombre_conductor} />)}
                </datalist>
            </div>

            {/* 5. DNI conductor (Se llena en automático) */}
            <div className="field-p field-auto-p">
              <label>DNI conductor</label>
              <input value={formData.dni_conductor} placeholder="Automático" readOnly />
            </div>

            {/* 6. Cliente (Se oculta en INBOUND y fluye la grilla) */}
            {!esInbound && (
              <div className="field-p field-manual-p">
                <label>Cliente</label>
                <input
                  list="listaCli"
                  value={formData.cliente_nombre}
                  onChange={e => setFormData({ ...formData, cliente_nombre: e.target.value.toUpperCase() })}
                  placeholder="Buscar o escribir cliente..."
                  autoComplete="off"
                  required={!esInbound}
                />
                <datalist id="listaCli">
                  {clientes.map(cli => (
                    <option key={cli.id} value={cli.nombre_cliente} />
                  ))}
                </datalist>
              </div>
            )}

            {/* 7. N° ruta */}
            <div className="field-p field-manual-p">
              <label>N° ruta</label>
              <input
                value={formData.nr_ruta}
                onChange={e => setFormData({ ...formData, nr_ruta: e.target.value.replace(/\D/g, '').slice(0, 2) })}
                maxLength={2}
                inputMode="numeric"
                required
              />
            </div>

            {/* 8. Placa (Buscador desde placas) */}
            <div className="field-p field-manual-p">
              <div className="label-with-link-p">
                <label>Placa</label>
                {puedeGestionarMaestros && (
                  <span
                    className="link-action-p"
                    onClick={() => {
                      setNuevaPlaca({
                        nro_placa: '',
                        empresa_id: formData.empresa_transporte_id || '',
                        estadoBusqueda: 'Ingrese 6 caracteres para buscar o crear la placa.',
                        colorEstado: '#64748b',
                        existe: false,
                        infoAuditoria: ''
                      });
                      setMostrarModalPlaca(true);
                    }}
                  >
                    <FaTruck style={{ marginRight: '4px' }} /> Nueva Placa
                  </span>
                )}
              </div>
              <input
                list="listaPlac"
                value={formData.nro_placa}
                onChange={handlePlacaInputForm}
                placeholder="Ej: ABC123"
                maxLength={6}
                autoComplete="off"
                required
              />
            <datalist id="listaPlac">
                {placas.map((p, index) => <option key={`${p.nro_placa}-${index}`} value={p.nro_placa} />)}
            </datalist>
            </div>

            {/* 9. Despachador */}
            <div className="field-p field-auto-p">
              <label>Despachador</label>
              <input value={formData.despachador} readOnly />
            </div>

            {/* 10. N° paletas */}
            <div className="field-p field-manual-p">
              <label>N° paletas</label>
              <input
                type="text"
                inputMode="numeric"
                value={formData.nr_paletas}
                onChange={handlePaletasChange}
                placeholder="0 o vacío = sin salida de pallet"
              />
            </div>

            {/* 11. Tipo de paleta (Visible siempre salvo en INBOUND; deshabilitado si nr_paletas es 0 o vacío) */}
            {!esInbound && (
              <div className={`field-p ${sinSalidaPallet ? 'field-auto-p' : 'field-manual-p'}`}>
                <label>Tipo de paleta</label>
                <select
                  value={formData.tipo_paleta_id}
                  onChange={e => setFormData({ ...formData, tipo_paleta_id: e.target.value })}
                  disabled={sinSalidaPallet}
                  required={!esInbound && !sinSalidaPallet}
                  style={sinSalidaPallet ? { background: '#f1f5f9', borderColor: '#cbd5e1', color: '#64748b' } : {}}
                >
                  <option value="">Seleccione...</option>
                  {tiposPaleta.map(tp => (
                    <option key={tp.id} value={tp.id}>{tp.nombre_tipo}</option>
                  ))}
                </select>
              </div>
            )}

            {/* 12. Firma conductor */}
            <div className="field-p field-manual-p">
              <label>Firma conductor</label>
              <div className="firma-input-group-p">
                <button type="button" className="btn-firma-p" onClick={() => setMostrarModalFirma(true)}>
                  <FaPenNib /> Firmar
                </button>
                <span className={`badge-firma-p ${formData.firma_conductor_base64 ? 'activa' : 'inactiva'}`}>
                  {formData.firma_conductor_base64 ? 'Firma lista' : 'Sin firma'}
                </span>
              </div>
            </div>
          </div>

          {/* FILA FOTO DE SALIDA */}
          <div className="form-grid-p cols-1">
            <div className="field-p field-manual-p" style={{ maxWidth: '480px' }}>
              <label>Foto de salida</label>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', height: '44px', background: '#fff', border: '1.5px solid #c8d8e8', borderRadius: '12px', padding: '0 10px' }}>
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  onChange={handleFotoSalidaChange}
                  style={{ border: 'none', background: 'transparent', padding: 0, height: 'auto', outline: 'none', width: '100%' }}
                />
              </div>
              <div style={{ marginTop: '6px', display: 'flex', gap: '8px', alignItems: 'center' }}>
                <span className={`badge-firma-p ${formData.foto_salida_base64 ? 'activa' : 'inactiva'}`}>
                  {formData.foto_salida_base64 ? 'Foto cargada' : 'Sin foto'}
                </span>
                {formData.foto_salida_base64 && (
                  <button
                    type="button"
                    className="btn-quitar-foto-p"
                    onClick={() => setFormData(prev => ({ ...prev, foto_salida_base64: '' }))}
                  >
                    Quitar foto
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* FILA RETORNA + OBSERVACIÓN DE SALIDA */}
          <div className="grid-retorna-obs">
            <div className={`field-p ${sinSalidaPallet ? 'field-auto-p' : 'field-manual-p'}`}>
              <label>¿Retorna?</label>
              <select
                value={formData.retorno}
                onChange={e => setFormData({ ...formData, retorno: e.target.value })}
                disabled={sinSalidaPallet}
                style={sinSalidaPallet ? { background: '#f1f5f9', borderColor: '#cbd5e1', color: '#64748b' } : {}}
              >
                <option value="NO">NO</option>
                <option value="SI">SÍ</option>
              </select>
            </div>

            <div className="field-p field-manual-p">
              <label>Observación de salida</label>
              <textarea
                value={formData.observacion_salida}
                onChange={e => setFormData({ ...formData, observacion_salida: e.target.value })}
                maxLength={500}
                rows={2}
                placeholder={sinSalidaPallet ? 'Obligatorio cuando no hay salida de pallet' : ''}
                required={sinSalidaPallet}
              />
              <div className="counter-p">{formData.observacion_salida.length}/500</div>
            </div>
          </div>

          {/* FOOTER */}
          <div className="footer-form-p">
            <div className="footer-text-p">
              F-3MP-150 Rev. 01<br />07/05/2024
            </div>
            <div className="footer-actions-p">
              <button type="button" className="btn-limpiar-p" onClick={limpiarFormulario}>Limpiar</button>
              <button type="submit" className="btn-guardar-p" disabled={loading}>
                <FaSave style={{ marginRight: '6px' }} /> Guardar
              </button>
            </div>
          </div>
        </form>
      </section>

      {/* MODAL FIRMA */}
      {mostrarModalFirma && (
        <div className="tw-modal-backdrop" onClick={() => setMostrarModalFirma(false)}>
          <div className="firma-box-p" onClick={e => e.stopPropagation()}>
            <h3>Firma del conductor</h3>
            <canvas
              ref={canvasRef}
              id="firmaCanvas"
              onPointerDown={iniciarTrazo}
              onPointerMove={moverTrazo}
              onPointerUp={finalizarTrazo}
            />
            <div className="firma-actions-p">
              <button type="button" className="btn-limpiar-p" onClick={limpiarCanvas}>
                <FaEraser style={{ marginRight: '6px' }} /> Limpiar
              </button>
              <button type="button" className="btn-limpiar-p" onClick={() => setMostrarModalFirma(false)}>
                Cancelar
              </button>
              <button type="button" className="btn-guardar-p" onClick={confirmarFirmaCanvas}>
                <FaSave style={{ marginRight: '6px' }} /> Guardar firma
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL BUSCADOR / CREADOR / EDITOR DE CONDUCTOR */}
      {mostrarModalConductor && (
        <div className="tw-modal-backdrop" onClick={() => setMostrarModalConductor(false)}>
          <div className="tw-modal-card" style={{ maxWidth: '460px', padding: '24px' }} onClick={e => e.stopPropagation()}>
            <h3 className="tw-modal-title" style={{ marginBottom: '14px' }}>
              {nuevoCond.existe ? 'Editar Conductor Existente' : 'Buscar / Crear Nuevo Conductor'}
            </h3>
            <form onSubmit={handleGuardarConductorModal}>
              <div className="field-p field-manual-p" style={{ marginBottom: '12px' }}>
                <label>DNI del Conductor (8 dígitos) *</label>
                <input
                  value={nuevoCond.dni}
                  onChange={e => handleBuscarDniModal(e.target.value)}
                  maxLength={8}
                  inputMode="numeric"
                  placeholder="Ingrese 8 dígitos para buscar..."
                  required
                />
                <small style={{ color: nuevoCond.colorEstado, fontWeight: 700, display: 'block', marginTop: '4px', fontSize: '11.5px' }}>
                  {nuevoCond.estadoBusqueda}
                </small>
                {nuevoCond.infoAuditoria && (
                  <small style={{ color: '#64748b', display: 'block', marginTop: '2px', fontSize: '11px' }}>
                    {nuevoCond.infoAuditoria}
                  </small>
                )}
              </div>

              <div className="field-p field-manual-p" style={{ marginBottom: '12px' }}>
                <label>Nombre Completo (Mayúsculas) *</label>
                <input
                  value={nuevoCond.nombre}
                  onChange={e => setNuevoCond({ ...nuevoCond, nombre: e.target.value.toUpperCase() })}
                  placeholder="APELLIDOS Y NOMBRES"
                  required
                />
              </div>

              <div className="field-p field-manual-p" style={{ marginBottom: '12px' }}>
                <label>Empresa de Transporte *</label>
                <select
                  value={nuevoCond.empresa_id}
                  onChange={e => setNuevoCond({ ...nuevoCond, empresa_id: e.target.value })}
                  required
                >
                  <option value="">Seleccione empresa...</option>
                  {empresas.map(emp => (
                    <option key={emp.id} value={emp.id}>{emp.nombre_empresa}</option>
                  ))}
                </select>
              </div>

              <div className="field-p field-auto-p" style={{ marginBottom: '18px' }}>
                <label>{nuevoCond.existe ? 'Usuario que actualiza' : 'Usuario que registra'}</label>
                <input value={nombreUsuarioActual} readOnly />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
                <button
                  type="button"
                  className="btn-limpiar-p"
                  onClick={() => setMostrarModalConductor(false)}
                  style={{ height: '38px', padding: '0 16px' }}
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="btn-guardar-p"
                  style={{ height: '38px', padding: '0 20px' }}
                >
                  {nuevoCond.existe ? 'Actualizar Conductor' : 'Crear Conductor'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL BUSCADOR / CREADOR / EDITOR DE PLACA */}
      {mostrarModalPlaca && (
        <div className="tw-modal-backdrop" onClick={() => setMostrarModalPlaca(false)}>
          <div className="tw-modal-card" style={{ maxWidth: '440px', padding: '24px' }} onClick={e => e.stopPropagation()}>
            <h3 className="tw-modal-title" style={{ marginBottom: '14px' }}>
              {nuevaPlaca.existe ? 'Editar Placa Existente' : 'Buscar / Crear Nueva Placa'}
            </h3>
            <form onSubmit={handleGuardarPlacaModal}>
              <div className="field-p field-manual-p" style={{ marginBottom: '12px' }}>
                <label>N° de Placa (6 caracteres) *</label>
                <input
                  value={nuevaPlaca.nro_placa}
                  onChange={e => handleBuscarPlacaModal(e.target.value)}
                  placeholder="Ej: ABC123"
                  maxLength={6}
                  required
                />
                <small style={{ color: nuevaPlaca.colorEstado, fontWeight: 700, display: 'block', marginTop: '4px', fontSize: '11.5px' }}>
                  {nuevaPlaca.estadoBusqueda}
                </small>
                {nuevaPlaca.infoAuditoria && (
                  <small style={{ color: '#64748b', display: 'block', marginTop: '2px', fontSize: '11px' }}>
                    {nuevaPlaca.infoAuditoria}
                  </small>
                )}
              </div>

              <div className="field-p field-manual-p" style={{ marginBottom: '12px' }}>
                <label>Empresa de Transporte *</label>
                <select
                  value={nuevaPlaca.empresa_id}
                  onChange={e => setNuevaPlaca({ ...nuevaPlaca, empresa_id: e.target.value })}
                  required
                >
                  <option value="">Seleccione empresa...</option>
                  {empresas.map(emp => (
                    <option key={emp.id} value={emp.id}>{emp.nombre_empresa}</option>
                  ))}
                </select>
              </div>

              <div className="field-p field-auto-p" style={{ marginBottom: '18px' }}>
                <label>{nuevaPlaca.existe ? 'Usuario que actualiza' : 'Usuario que registra'}</label>
                <input value={nombreUsuarioActual} readOnly />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
                <button
                  type="button"
                  className="btn-limpiar-p"
                  onClick={() => setMostrarModalPlaca(false)}
                  style={{ height: '38px', padding: '0 16px' }}
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="btn-guardar-p"
                  style={{ height: '38px', padding: '0 20px' }}
                >
                  {nuevaPlaca.existe ? 'Actualizar Placa' : 'Crear Placa'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
