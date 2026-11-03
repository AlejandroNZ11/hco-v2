import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { FaPenNib, FaSave, FaEraser, FaUserPlus, FaTruck, FaFileSignature, FaTimes } from 'react-icons/fa';
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

  const [empresas, setEmpresas] = useState([]);
  const [conductores, setConductores] = useState([]);
  const [placas, setPlacas] = useState([]);
  const [clientes, setClientes] = useState([]);
  const [tiposPaleta, setTiposPaleta] = useState([]);

  const [empresaBloqueadaPorPlaca, setEmpresaBloqueadaPorPlaca] = useState(false);
  const [clientesSeleccionados, setClientesSeleccionados] = useState([]);
  const [clienteInputTemporal, setClienteInputTemporal] = useState('');

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

  const [mostrarModalConductor, setMostrarModalConductor] = useState(false);
  const [mostrarModalPlaca, setMostrarModalPlaca] = useState(false);
  const [mostrarModalFirma, setMostrarModalFirma] = useState(false);

  // Canvas para firma (Retail)
  const canvasRef = useRef(null);
  const dibujandoRef = useRef(false);
  const tieneTrazoRef = useRef(false);

  const [nuevoCond, setNuevoCond] = useState({
    dni: '',
    nombre: '',
    empresa_id: '',
    estadoBusqueda: 'Ingrese 8 dígitos para buscar o crear el conductor.',
    colorEstado: '#64748b',
    existe: false
  });

  const [nuevaPlaca, setNuevaPlaca] = useState({
    nro_placa: '',
    empresa_id: '',
    volumen_m3: '',
    estadoBusqueda: 'Ingrese 6 caracteres para buscar o crear la placa.',
    colorEstado: '#64748b',
    existe: false
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

  const esClienteRecoge = formData.area_proceso === 'CLIENTE RECOGE';
  const esOutboundPrincipal = formData.area_proceso === 'OUTBOUND PRINCIPAL';
  const esOutboundRetail = formData.area_proceso === 'OUTBOUND RETAIL';

  const cantPaletasNum = formData.nr_paletas === '' ? 0 : Number(formData.nr_paletas);
  const sinSalidaPallet = formData.nr_paletas === '' || cantPaletasNum === 0;

  const conductoresFiltradosPorEmpresa = useMemo(() => {
    if (!formData.empresa_transporte_id) return conductores;
    return conductores.filter(c => String(c.empresa_id) === String(formData.empresa_transporte_id));
  }, [conductores, formData.empresa_transporte_id]);

    // Manejo de cambio de Área de Proceso: Resetea todos los campos al cambiar de área
    const handleAreaChange = (e) => {
    const nuevaArea = e.target.value;

    // Si no selecciona un área válida
    if (!nuevaArea) {
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
        setClientesSeleccionados([]);
        setClienteInputTemporal('');
        setEmpresaBloqueadaPorPlaca(false);
        return;
    }

    if (nuevaArea === 'CLIENTE RECOGE') {
        const empresaOther = empresas.find(
        emp => emp.nombre_empresa.toUpperCase().includes('OTHER') || emp.nombre_empresa.toUpperCase().includes('OTRO')
        );

        // Reseteo total para CLIENTE RECOGE (fijando empresa en OTHER y retorno en NO)
        setFormData({
        area_proceso: nuevaArea,
        empresa_transporte_id: empresaOther ? String(empresaOther.id) : '',
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
        setEmpresaBloqueadaPorPlaca(true);
    } else {
        // Reseteo total para OUTBOUND RETAIL y OUTBOUND PRINCIPAL (todo en blanco)
        setFormData({
        area_proceso: nuevaArea,
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
        setEmpresaBloqueadaPorPlaca(false);
    }

    // Limpieza de estados de chips de clientes
    setClientesSeleccionados([]);
    setClienteInputTemporal('');
    };

  const handlePlacaInputForm = (e) => {
    const placaVal = e.target.value.replace(/[^a-zA-Z0-9]/g, '').slice(0, 6).toUpperCase();
    const placaObj = placas.find(p => p.nro_placa === placaVal);

    if (placaObj && placaObj.empresa_id) {
      setFormData(prev => ({
        ...prev,
        nro_placa: placaVal,
        empresa_transporte_id: String(placaObj.empresa_id),
        conductor_nombre: '',
        dni_conductor: ''
      }));
      setEmpresaBloqueadaPorPlaca(true);
    } else {
      setFormData(prev => ({ ...prev, nro_placa: placaVal }));
      if (!esClienteRecoge) setEmpresaBloqueadaPorPlaca(false);
    }
  };

  const handleConductorChange = (e) => {
    const valorEscrito = e.target.value;
    if (esClienteRecoge) {
      setFormData(prev => ({ ...prev, conductor_nombre: valorEscrito, dni_conductor: '' }));
      return;
    }

    const normalizar = (str) => String(str || '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const buscado = normalizar(valorEscrito);
    const encontrado = conductoresFiltradosPorEmpresa.find(c => normalizar(c.nombre_conductor) === buscado);

    setFormData(prev => ({
      ...prev,
      conductor_nombre: valorEscrito,
      dni_conductor: encontrado ? encontrado.dni_conductor : '',
      empresa_transporte_id: (!prev.empresa_transporte_id && encontrado?.empresa_id)
        ? String(encontrado.empresa_id)
        : prev.empresa_transporte_id
    }));
  };

  const handleAgregarClienteChip = (cliNombre) => {
    const limpio = cliNombre.trim().toUpperCase();
    if (limpio && !clientesSeleccionados.includes(limpio)) {
      setClientesSeleccionados([...clientesSeleccionados, limpio]);
    }
    setClienteInputTemporal('');
  };

  const handleRemoverClienteChip = (indexRemover) => {
    setClientesSeleccionados(clientesSeleccionados.filter((_, idx) => idx !== indexRemover));
  };

  // Manejo y compresión de imagen de salida (Retail)
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

  // Control Canvas Firma (Retail)
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

  const limpiarCanvasFirma = () => {
    if (!canvasRef.current) return;
    const ctx = canvasRef.current.getContext('2d');
    ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
    tieneTrazoRef.current = false;
  };

  const confirmarFirmaSalida = () => {
    if (!tieneTrazoRef.current) {
      return mostrarAviso('warning', 'Firma vacía', 'Por favor dibuje la firma antes de guardar.');
    }
    setFormData(prev => ({ ...prev, firma_conductor_base64: canvasRef.current.toDataURL('image/png') }));
    setMostrarModalFirma(false);
  };

  const handleSubmitPrestamo = async (e) => {
    e.preventDefault();

    if (!formData.area_proceso) {
      return mostrarAviso('warning', 'Falta área', 'Seleccione el Área del proceso.');
    }

    // Validación de placa
    if (formData.nro_placa.length !== 6) {
    return mostrarAviso('warning', 'Placa inválida', 'La placa debe tener exactamente 6 caracteres.');
    }

    if (!esClienteRecoge) {
    const existeEnCatalogo = placas.some(p => p.nro_placa === formData.nro_placa);
    if (!existeEnCatalogo) {
        return mostrarAviso('warning', 'Placa no registrada', 'La placa ingresada no existe en el catálogo. Regístrela primero con "+ Placa".');
    }
    if (!formData.empresa_transporte_id) {
        return mostrarAviso('warning', 'Falta empresa', 'Seleccione la Empresa de transporte.');
    }
    if (!formData.dni_conductor) {
        return mostrarAviso('warning', 'Falta conductor', 'Seleccione un conductor válido de la lista.');
    }
    if (!/^\d{1,2}$/.test(formData.nr_ruta.trim())) {
        return mostrarAviso('warning', 'Ruta inválida', 'El N° de ruta debe tener 1 o 2 dígitos.');
    }
    } else {
    // CLIENTE RECOGE: no valida que la placa exista en BD
    if (!formData.conductor_nombre.trim()) {
        return mostrarAviso('warning', 'Falta nombre', 'Ingrese el nombre de quien recoge.');
    }
    }

    if (esOutboundRetail && !formData.cliente_nombre.trim()) {
      return mostrarAviso('warning', 'Falta cliente', 'Indique el Cliente.');
    }
    if (esOutboundPrincipal && clientesSeleccionados.length === 0) {
      return mostrarAviso('warning', 'Falta cliente', 'Seleccione al menos un Cliente.');
    }

    if (esOutboundRetail) {
      if (!sinSalidaPallet && !formData.tipo_paleta_id) {
        return mostrarAviso('warning', 'Falta tipo de paleta', 'Seleccione el tipo de paleta.');
      }
      if (sinSalidaPallet && !formData.observacion_salida.trim()) {
        return mostrarAviso('warning', 'Falta observación', 'La observación es obligatoria cuando no hay salida de pallet.');
      }
      if (!formData.firma_conductor_base64) {
        return mostrarAviso('warning', 'Falta firma', 'Debe registrar la firma de salida del conductor.');
      }
    }

    setLoading(true);
    try {
      const payloadEnvio = {
        ...formData,
        tipo_paleta_id: esOutboundRetail ? (formData.tipo_paleta_id || null) : null,
        retorno: esClienteRecoge ? 'NO' : formData.retorno,
        clientes_multiples: esOutboundPrincipal ? clientesSeleccionados : null,
        usuario_registra: nombreUsuarioActual,
        area_registrador: currentUser?.area || ''
      };

      const creado = await crearPrestamoPallet(payloadEnvio);
      mostrarAviso(
        'success',
        esOutboundRetail ? 'Préstamo Registrado' : 'Pre-Registro Creado',
        esOutboundRetail 
          ? `El préstamo ${creado.id_prestamo} se registró completamente.`
          : `El pre-registro ${creado.id_prestamo} está listo para ser despachado por el auxiliar.`,
        `Placa: ${creado.nro_placa}`,
        () => navigate('/prestamos/tracking')
      );
    } catch (err) {
      mostrarAviso('danger', 'Error al registrar', err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="registro-page-p">
      {loading && <Loading />}

      {avisoFlotante.visible && (
        <div className="tw-modal-backdrop" onClick={cerrarAviso}>
          <div className="tw-modal-card-alert" onClick={e => e.stopPropagation()}>
            <div className="tw-modal-header-alert">
              <div className={`tw-modal-icon-circle ${avisoFlotante.tipo}`}>
                {avisoFlotante.tipo === 'danger' && <span>✖</span>}
                {avisoFlotante.tipo === 'warning' && <span>⚠️</span>}
                {avisoFlotante.tipo === 'success' && <span>✔</span>}
              </div>
              <h3 className="tw-modal-title">{avisoFlotante.titulo}</h3>
              <p className="tw-modal-desc">{avisoFlotante.mensaje}</p>
              {avisoFlotante.detalleExtra && <div className="tw-modal-extra-box">{avisoFlotante.detalleExtra}</div>}
            </div>
            <div className="tw-modal-footer-alert">
              <button type="button" className={`tw-modal-btn ${avisoFlotante.tipo}`} onClick={cerrarAviso}>Entendido</button>
            </div>
          </div>
        </div>
      )}

      <section className="card-p mb-4">
        <div className="card-head-modern-p">
          <div className="card-head-left-p">
            <h2>
              <FaFileSignature style={{ color: '#2563eb', marginRight: '8px' }} /> Nuevo préstamo
            </h2>
            <div className="despachador-subtext-p">
              Despachador activo: <strong>{nombreUsuarioActual}</strong>
            </div>
          </div>
        </div>

        <form onSubmit={handleSubmitPrestamo} className="form-container-p">
          <div className="section-title-p">DATOS DE SALIDA (ADMINISTRATIVO)</div>

          <div className="form-grid-p cols-4">
            {/* Fecha entrega */}
            <div className="field-p field-auto-p">
              <div className="label-head-p">
                <label>Fecha entrega</label>
                <span className="tag-pill opcional">AUTOMÁTICO</span>
              </div>
              <input value={reloj} readOnly />
            </div>

            {/* Área del Proceso */}
            <div className="field-p field-manual-p">
              <div className="label-head-p">
                <label>Área del proceso</label>
                <span className="tag-pill obligatorio">OBLIGATORIO</span>
              </div>
              <select value={formData.area_proceso} onChange={handleAreaChange} required>
                <option value="">Seleccione...</option>
                <option value="OUTBOUND RETAIL">OUTBOUND RETAIL</option>
                <option value="OUTBOUND PRINCIPAL">OUTBOUND PRINCIPAL</option>
                <option value="CLIENTE RECOGE">CLIENTE RECOGE</option>
              </select>
            </div>

            {/* 3. Placa */}
            <div className="field-p field-manual-p">
            <div className="label-head-p">
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <label>Placa</label>
                {/* Oculta '+ Placa' cuando es CLIENTE RECOGE */}
                {!esClienteRecoge && puedeGestionarMaestros && (
                    <span
                    className="link-action-p"
                    onClick={() => {
                        setNuevaPlaca({
                        nro_placa: '',
                        empresa_id: formData.empresa_transporte_id || '',
                        volumen_m3: '',
                        estadoBusqueda: 'Ingrese 6 caracteres...',
                        colorEstado: '#64748b',
                        existe: false
                        });
                        setMostrarModalPlaca(true);
                    }}
                    >
                    <FaTruck style={{ marginRight: '3px' }} /> + Placa
                    </span>
                )}
                </div>
                <span className="tag-pill obligatorio">OBLIGATORIO</span>
            </div>
            <input
                /* Si es CLIENTE RECOGE, desactiva el datalist por completo */
                list={esClienteRecoge ? undefined : "listaPlac"}
                value={formData.nro_placa}
                onChange={handlePlacaInputForm}
                placeholder={esClienteRecoge ? "Placa externa (6 carac.)..." : "Ej: ABC123"}
                maxLength={6}
                autoComplete="off"
                required
            />
            {!esClienteRecoge && (
                <datalist id="listaPlac">
                {placas.map((p, index) => <option key={`${p.nro_placa}-${index}`} value={p.nro_placa} />)}
                </datalist>
            )}
            </div>

            {/* 4. Empresa Transporte */}
            <div className={`field-p ${empresaBloqueadaPorPlaca || esClienteRecoge ? 'field-auto-p' : 'field-manual-p'}`}>
            <div className="label-head-p">
                <label>Empresa transporte</label>
                <span className={`tag-pill ${esClienteRecoge ? 'opcional' : 'obligatorio'}`}>
                {esClienteRecoge ? 'OTHER' : 'OBLIGATORIO'}
                </span>
            </div>
            <select
                value={formData.empresa_transporte_id}
                onChange={e => setFormData({ ...formData, empresa_transporte_id: e.target.value, conductor_nombre: '', dni_conductor: '' })}
                disabled={empresaBloqueadaPorPlaca || esClienteRecoge}
                required={!esClienteRecoge}
            >
                <option value="">{esClienteRecoge ? 'OTHER / EXTERNO' : 'Seleccione...'}</option>
                {empresas.map(emp => (
                <option key={emp.id} value={emp.id}>{emp.nombre_empresa}</option>
                ))}
            </select>
            </div>

            {/* Conductor */}
            <div className="field-p field-manual-p">
              <div className="label-head-p">
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <label>Conductor</label>
                  {!esClienteRecoge && puedeGestionarMaestros && (
                    <span
                      className="link-action-p"
                      onClick={() => {
                        setNuevoCond({
                          dni: '',
                          nombre: '',
                          empresa_id: formData.empresa_transporte_id || '',
                          estadoBusqueda: 'Ingrese 8 dígitos...',
                          colorEstado: '#64748b',
                          existe: false
                        });
                        setMostrarModalConductor(true);
                      }}
                    >
                      <FaUserPlus style={{ marginRight: '3px' }} /> + Conductor
                    </span>
                  )}
                </div>
                <span className="tag-pill obligatorio">OBLIGATORIO</span>
              </div>
              <input
                list={esClienteRecoge ? undefined : "listaCond"}
                value={formData.conductor_nombre}
                onChange={handleConductorChange}
                placeholder={esClienteRecoge ? "Nombre de quien recoge..." : "Buscar conductor..."}
                autoComplete="off"
                required
              />
              {!esClienteRecoge && (
                <datalist id="listaCond">
                  {conductoresFiltradosPorEmpresa.map((c, index) => (
                    <option key={`${c.dni_conductor}-${index}`} value={c.nombre_conductor} />
                  ))}
                </datalist>
              )}
            </div>

            {/* DNI Conductor */}
            {!esClienteRecoge && (
              <div className="field-p field-auto-p">
                <div className="label-head-p">
                  <label>DNI conductor</label>
                  <span className="tag-pill opcional">AUTOMÁTICO</span>
                </div>
                <input value={formData.dni_conductor} placeholder="Automático" readOnly />
              </div>
            )}

            {/* N° Ruta */}
            {!esClienteRecoge && (
              <div className="field-p field-manual-p">
                <div className="label-head-p">
                  <label>N° ruta</label>
                  <span className="tag-pill obligatorio">OBLIGATORIO</span>
                </div>
                <input
                  value={formData.nr_ruta}
                  onChange={e => setFormData({ ...formData, nr_ruta: e.target.value.replace(/\D/g, '').slice(0, 2) })}
                  maxLength={2}
                  inputMode="numeric"
                  placeholder="Ej: 01"
                  required
                />
              </div>
            )}

            {/* Clientes OUTBOUND RETAIL */}
            {esOutboundRetail && (
              <div className="field-p field-manual-p">
                <div className="label-head-p">
                  <label>Cliente</label>
                  <span className="tag-pill obligatorio">OBLIGATORIO</span>
                </div>
                <input
                  list="listaCli"
                  value={formData.cliente_nombre}
                  onChange={e => setFormData({ ...formData, cliente_nombre: e.target.value.toUpperCase() })}
                  placeholder="Buscar o escribir cliente..."
                  autoComplete="off"
                  required
                />
                <datalist id="listaCli">
                  {clientes.map(cli => (
                    <option key={cli.id} value={cli.nombre_cliente} />
                  ))}
                </datalist>
              </div>
            )}

            {/* Clientes Múltiples OUTBOUND PRINCIPAL */}
            {esOutboundPrincipal && (
              <div className="field-p field-manual-p multicliente-box">
                <div className="label-head-p">
                  <label>Clientes (Múltiples)</label>
                  <span className="tag-pill obligatorio">OBLIGATORIO</span>
                </div>
                <div className="clientes-input-row">
                  <input
                    list="listaCli"
                    value={clienteInputTemporal}
                    onChange={e => setClienteInputTemporal(e.target.value.toUpperCase())}
                    onKeyDown={e => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleAgregarClienteChip(clienteInputTemporal);
                      }
                    }}
                    placeholder="Escriba o seleccione..."
                  />
                  <button
                    type="button"
                    className="btn-limpiar-p"
                    style={{ height: '44px' }}
                    onClick={() => handleAgregarClienteChip(clienteInputTemporal)}
                  >
                    Añadir
                  </button>
                </div>
                <datalist id="listaCli">
                  {clientes.map(cli => <option key={cli.id} value={cli.nombre_cliente} />)}
                </datalist>

                <div className="clientes-chips-box">
                  {clientesSeleccionados.map((cli, idx) => (
                    <span key={idx} className="cliente-chip">
                      {cli}
                      <FaTimes className="chip-close" onClick={() => handleRemoverClienteChip(idx)} />
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* CAMPOS AUXILIARES: VISIBLES SOLO SI ES OUTBOUND RETAIL */}
            {esOutboundRetail && (
              <>
                {/* N° Paletas */}
                <div className="field-p field-manual-p">
                  <div className="label-head-p">
                    <label>N° paletas</label>
                    <span className="tag-pill obligatorio">OBLIGATORIO</span>
                  </div>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={formData.nr_paletas}
                    onChange={e => {
                      const val = e.target.value.replace(/\D/g, '').slice(0, 3);
                      setFormData(prev => ({
                        ...prev,
                        nr_paletas: val,
                        retorno: (val === '' || Number(val) === 0) ? 'NO' : 'SI'
                      }));
                    }}
                    placeholder="0 = sin pallet"
                  />
                </div>

                {/* Tipo de Paleta */}
                <div className={`field-p ${sinSalidaPallet ? 'field-auto-p' : 'field-manual-p'}`}>
                  <div className="label-head-p">
                    <label>Tipo de paleta</label>
                    <span className={`tag-pill ${sinSalidaPallet ? 'opcional' : 'obligatorio'}`}>
                      {sinSalidaPallet ? 'NO APLICA' : 'OBLIGATORIO'}
                    </span>
                  </div>
                  <select
                    value={formData.tipo_paleta_id}
                    onChange={e => setFormData({ ...formData, tipo_paleta_id: e.target.value })}
                    disabled={sinSalidaPallet}
                    required={!sinSalidaPallet}
                  >
                    <option value="">Seleccione...</option>
                    {tiposPaleta.map(tp => (
                      <option key={tp.id} value={tp.id}>{tp.nombre_tipo}</option>
                    ))}
                  </select>
                </div>

                {/* Firma Conductor en Retail */}
                <div className="field-p field-manual-p">
                  <div className="label-head-p">
                    <label>Firma conductor</label>
                    <span className="tag-pill obligatorio">OBLIGATORIO</span>
                  </div>
                  <div className="firma-input-group-p">
                    <button type="button" className="btn-firma-p" onClick={() => setMostrarModalFirma(true)}>
                      <FaPenNib /> Firmar Salida
                    </button>
                    <span className={`badge-firma-p ${formData.firma_conductor_base64 ? 'activa' : 'inactiva'}`}>
                      {formData.firma_conductor_base64 ? 'Firma lista' : 'Sin firma'}
                    </span>
                  </div>
                </div>

                {/* Foto de Salida en Retail: OPCIONAL */}
                <div className="field-p field-manual-p">
                  <div className="label-head-p">
                    <label>Foto de salida</label>
                    <span className="tag-pill opcional">OPCIONAL</span>
                  </div>
                  <input
                    type="file"
                    accept="image/*"
                    capture="environment"
                    onChange={handleFotoSalidaChange}
                    className="file-input-p"
                  />
                  <div style={{ marginTop: '4px', display: 'flex', gap: '8px', alignItems: 'center' }}>
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
              </>
            )}
          </div>

          {/* PARTE AUXILIAR EN RETAIL: RETORNO Y OBSERVACIÓN */}
          {esOutboundRetail && (
            <div className="grid-retorna-obs">
              <div className={`field-p ${sinSalidaPallet ? 'field-auto-p' : 'field-manual-p'}`}>
                <div className="label-head-p">
                  <label>¿Retorna?</label>
                  <span className="tag-pill obligatorio">OBLIGATORIO</span>
                </div>
                <select
                  value={formData.retorno}
                  onChange={e => setFormData({ ...formData, retorno: e.target.value })}
                  disabled={sinSalidaPallet}
                >
                  <option value="NO">NO</option>
                  <option value="SI">SÍ</option>
                </select>
              </div>

              <div className="field-p field-manual-p">
                <div className="label-head-p">
                  <label>Observación de salida</label>
                  <span className={`tag-pill ${sinSalidaPallet ? 'obligatorio' : 'recomendado'}`}>
                    {sinSalidaPallet ? 'OBLIGATORIO' : 'RECOMENDADO'}
                  </span>
                </div>
                <textarea
                  value={formData.observacion_salida}
                  onChange={e => setFormData({ ...formData, observacion_salida: e.target.value })}
                  maxLength={500}
                  rows={2}
                  placeholder={sinSalidaPallet ? 'Obligatorio cuando no hay pallet' : 'Detalles adicionales...'}
                  required={sinSalidaPallet}
                />
              </div>
            </div>
          )}

          <div className="footer-form-p">
            <div className="footer-text-p">
              F-3MP-150 Rev. 01<br />07/05/2024
            </div>
            <div className="footer-actions-p">
              <button type="submit" className="btn-guardar-p" disabled={loading}>
                <FaSave style={{ marginRight: '6px' }} />
                {esOutboundRetail ? 'Guardar Préstamo' : 'Guardar Pre-Registro'}
              </button>
            </div>
          </div>
        </form>
      </section>

      {/* MODAL DE FIRMA (Retail) */}
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
              <button type="button" className="btn-limpiar-p" onClick={limpiarCanvasFirma}>
                <FaEraser style={{ marginRight: '6px' }} /> Limpiar
              </button>
              <button type="button" className="btn-limpiar-p" onClick={() => setMostrarModalFirma(false)}>
                Cancelar
              </button>
              <button type="button" className="btn-guardar-p" onClick={confirmarFirmaSalida}>
                <FaSave style={{ marginRight: '6px' }} /> Guardar firma
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL CONDUCTOR */}
      {mostrarModalConductor && (
        <div className="tw-modal-backdrop" onClick={() => setMostrarModalConductor(false)}>
          <div className="tw-modal-card" style={{ maxWidth: '460px', padding: '24px' }} onClick={e => e.stopPropagation()}>
            <h3 className="tw-modal-title" style={{ marginBottom: '14px' }}>
              {nuevoCond.existe ? 'Editar Conductor' : 'Nuevo Conductor'}
            </h3>
            <form onSubmit={async (e) => {
              e.preventDefault();
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
              } catch (err) {
                mostrarAviso('danger', 'Error', err.message);
              } finally {
                setLoading(false);
              }
            }}>
              <div className="field-p field-manual-p" style={{ marginBottom: '12px' }}>
                <label>DNI del Conductor (8 dígitos) *</label>
                <input
                  value={nuevoCond.dni}
                  onChange={async (e) => {
                    const limpio = e.target.value.replace(/\D/g, '').slice(0, 8);
                    setNuevoCond(prev => ({ ...prev, dni: limpio }));
                    if (limpio.length === 8) {
                      const remoto = await buscarConductorPorDni(limpio);
                      if (remoto) {
                        setNuevoCond({
                          dni: limpio,
                          nombre: remoto.nombre_conductor || '',
                          empresa_id: String(remoto.empresa_id || ''),
                          existe: true,
                          colorEstado: '#16a34a',
                          estadoBusqueda: '✓ Conductor encontrado.'
                        });
                      }
                    }
                  }}
                  maxLength={8}
                  inputMode="numeric"
                  required
                />
              </div>
              <div className="field-p field-manual-p" style={{ marginBottom: '12px' }}>
                <label>Nombre Completo (Mayúsculas) *</label>
                <input
                  value={nuevoCond.nombre}
                  onChange={e => setNuevoCond({ ...nuevoCond, nombre: e.target.value.toUpperCase() })}
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
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
                <button type="button" className="btn-limpiar-p" onClick={() => setMostrarModalConductor(false)}>Cancelar</button>
                <button type="submit" className="btn-guardar-p">{nuevoCond.existe ? 'Actualizar' : 'Crear'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL PLACA */}
      {mostrarModalPlaca && (
        <div className="tw-modal-backdrop" onClick={() => setMostrarModalPlaca(false)}>
          <div className="tw-modal-card" style={{ maxWidth: '440px', padding: '24px' }} onClick={e => e.stopPropagation()}>
            <h3 className="tw-modal-title" style={{ marginBottom: '14px' }}>
              {nuevaPlaca.existe ? 'Editar Placa' : 'Nueva Placa'}
            </h3>
            <form onSubmit={async (e) => {
              e.preventDefault();
              setLoading(true);
              try {
                const res = await guardarPlacaMaestra({
                  nro_placa: nuevaPlaca.nro_placa,
                  empresa_id: nuevaPlaca.empresa_id,
                  volumen_m3: nuevaPlaca.volumen_m3,
                  usuario: nombreUsuarioActual
                });
                await cargarMaestros();
                setFormData(prev => ({
                  ...prev,
                  nro_placa: res.placa.nro_placa,
                  empresa_transporte_id: String(res.placa.empresa_id)
                }));
                setEmpresaBloqueadaPorPlaca(true);
                setMostrarModalPlaca(false);
              } catch (err) {
                mostrarAviso('danger', 'Error', err.message);
              } finally {
                setLoading(false);
              }
            }}>
              <div className="field-p field-manual-p" style={{ marginBottom: '12px' }}>
                <label>N° de Placa (6 caracteres) *</label>
                <input
                  value={nuevaPlaca.nro_placa}
                  onChange={e => setNuevaPlaca({ ...nuevaPlaca, nro_placa: e.target.value.replace(/[^A-Za-z0-9]/g, '').slice(0, 6).toUpperCase() })}
                  maxLength={6}
                  required
                />
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
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
                <button type="button" className="btn-limpiar-p" onClick={() => setMostrarModalPlaca(false)}>Cancelar</button>
                <button type="submit" className="btn-guardar-p">{nuevaPlaca.existe ? 'Actualizar' : 'Crear'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}