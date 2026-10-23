import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import Loading from '../../layouts/Loading';
import './registra_usuario.css';

// Integración de Red y Modo Offline
import { useNetwork } from '../../hooks/useNetwork';
import { localDb } from '../../services/localDb';
import { useLiveQuery } from 'dexie-react-hooks';

// Importamos supabase para Auth y RPC
import { supabase } from '../../config/supabaseClient';
// Importamos todas las funciones necesarias de empleadosService
import {
  crearEmpleado,
  actualizarEmpleado,
  obtenerEmpleadoPorId,
  verificarDniExistente,
  verificarUsuarioExistente,
  obtenerAreas,
  obtenerCargos,
  obtenerJefes,
  obtenerRoles
} from '../../services/empleadosService';

function getStoredAuthUser() {
  const raw = localStorage.getItem("authUser") || sessionStorage.getItem("authUser");
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

const UBIGEO = {
  "LIMA": {
    "BARRANCA": ["BARRANCA", "PARAMONGA", "PATIVILCA", "SUPE", "SUPE PUERTO"],
    "CAJATAMBO": ["CAJATAMBO", "COPA", "GORGOR", "HUANCAPÓN", "MANÁS"],
    "CANTA": ["CANTA", "ARAHUAY", "HUAMANTANGA", "HUAROS", "LACHAQUI", "SAN BUENAVENTURA", "SANTA ROSA DE QUIVES"],
    "CAÑETE": ["SAN VICENTE DE CAÑETE", "ASIA", "CALANGO", "CERRO AZUL", "CHILCA", "COAYLLO", "IMPERIAL", "LUNAHUANÁ", "MALA", "NUEVO IMPERIAL", "PACARÁN", "QUILMANÁ", "SAN ANTONIO", "SAN LUIS", "SANTA CRUZ DE FLORES", "ZÚÑIGA"],
    "HUARAL": ["HUARAL", "ATAVILLOS ALTO", "ATAVILLOS BAJO", "AUCALLAMA", "CHANCAY", "IHUARÍ", "LAMPIÁN", "PACARAOS", "SAN MIGUEL DE ACOS", "SANTA CRUZ DE ANDAMARCA", "SUMBILCA", "VEINTISIETE DE NOVIEMBRE"],
    "HUAROCHIRÍ": ["MATUCANA", "ANTIOQUÍA", "CALLAHUANCA", "CARAMPOMA", "CHICLA", "CUENCA", "HUACHUPAMPA", "HUANZA", "HUAROCHIRÍ", "LAHUAYTAMBO", "LANGA", "LARAOS", "MARIATANA", "RICARDO PALMA", "SAN ANDRÉS DE TUPICOCHA", "SAN ANTONIO", "SAN BARTOLOMÉ", "SAN DAMIÁN", "SAN JUAN DE IRIS", "SAN JUAN DE TANTARANCHE", "SAN LORENZO DE QUINTI", "SAN MATEO", "SAN MATEO DE OTAO", "SAN PEDRO DE CASTA", "SAN PEDRO DE HUANCAYRE", "SANGALLAYA", "SANTA CRUZ DE COCACHACRA", "SANTA EULALIA", "SANTIAGO DE ANCHUCAYA", "SANTIAGO DE TUNA", "SANTO DOMINGO DE LOS OLLEROS", "SAN JERÓNIMO DE SURCO"],
    "HUAURA": ["HUACHO", "ÁMBAR", "CALETA DE CARQUÍN", "CHECRAS", "HUALMAY", "HUAURA", "LEONCIO PRADO", "PACCHO", "SANTA LEONOR", "SANTA MARÍA", "SAYÁN", "VÉGUETA"],
    "LIMA": ["LIMA", "ANCÓN", "ATE", "BARRANCO", "BREÑA", "CARABAYLLO", "CHACLACAYO", "CHORRILLOS", "CIENEGUILLA", "COMAS", "EL AGUSTINO", "INDEPENDENCIA", "JESÚS MARÍA", "LA MOLINA", "LA VICTORIA", "LINCE", "LOS OLIVOS", "LURIGANCHO", "LURÍN", "MAGDALENA DEL MAR", "MIRAFLORES", "PACHACÁMAC", "PUCUSANA", "PUEBLO LIBRE", "PUENTE PIEDRA", "PUNTA HERMOSA", "PUNTA NEGRA", "RÍMAC", "SAN BARTOLO", "SAN BORJA", "SAN ISIDRO", "SAN JUAN DE LURIGANCHO", "SAN JUAN DE MIRAFLORES", "SAN LUIS", "SAN MARTÍN DE PORRES", "SAN MIGUEL", "SANTA ANITA", "SANTA MARÍA DEL MAR", "SANTA ROSA", "SANTIAGO DE SURCO", "SURQUILLO", "VILLA EL SALVADOR", "VILLA MARÍA DEL TRIUNFO"],
    "OYÓN": ["OYÓN", "ANDAJES", "CAUJUL", "COCHAMARCA", "NAVÁN", "PACHANGARA"],
    "YAUYOS": ["YAUYOS", "ALIS", "AYAUCA", "AYAVIRI", "AZÁNGARO", "CACRA", "CARANIA", "CATAHUASI", "CHOCOS", "COCHAS", "COLONIA", "HONGOS", "HUAMPARÁ", "HUANCAYA", "HUANGÁSCAR", "HUANTÁN", "HUAÑEC", "LARAOS", "LINCHA", "MADEÁN", "MIRAFLORES", "OMAS", "PUTINZA", "QUINCHES", "QUINOCAY", "SAN JOAQUÍN", "SAN PEDRO DE PILAS", "TANTA", "TAURIPAMPA", "TOMAS", "TUPE", "VIÑAC", "VITIS"]
  },
  "CALLAO": {
    "CALLAO": ["CALLAO", "BELLAVISTA", "CARMEN DE LA LEGUA REYNOSO", "LA PERLA", "LA PUNTA", "VENTANILLA", "MI PERÚ"]
  }
};

const formatearNombre = (text) => {
  if (!text) return "";
  return text.toLowerCase().split(',').map(parte =>
    parte.trim().split(/\s+/).map(palabra => palabra.charAt(0).toUpperCase() + palabra.slice(1)).join(" ")
  ).join(", ");
};

const extraerIdDrive = (url) => {
  if (!url || typeof url !== "string") return null;
  const cleanUrl = url.trim();
  const match =
    cleanUrl.match(/\/file\/d\/([a-zA-Z0-9_-]+)/) ||
    cleanUrl.match(/\/d\/([a-zA-Z0-9_-]+)/) ||
    cleanUrl.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  return match ? match[1] : null;
};

const convertirDriveUrl = (url) => {
  if (!url || typeof url !== "string") return "";
  const cleanUrl = url.trim();
  if (cleanUrl.startsWith("data:image/")) return cleanUrl;
  const driveId = extraerIdDrive(cleanUrl);
  if (driveId) {
    // Usa directamente el CDN de imágenes de Google en lugar de drive.google.com
    return `https://lh3.googleusercontent.com/d/${driveId}=w1000`;
  }
  return cleanUrl;
};

const parseId = (val) => {
  if (val === "" || val === null || val === undefined) return null;
  return /^\d+\$/.test(String(val)) ? parseInt(val, 10) : val;
};

export default function RegistrarUsuario() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const editingId = searchParams.get("id");
  const [currentUser] = useState(() => getStoredAuthUser());
  const isSuperAdmin = String(currentUser?.rol || "").toUpperCase() === "SUPERADMIN";
  const isOnline = useNetwork();

  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState({ text: '', type: '' });
  const [formErrors, setFormErrors] = useState([]);
  const normalize = (text) => String(text || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();

  // Sincronización de Catálogos
  useEffect(() => {
    const sincronizarCatalogos = async () => {
      if (isOnline) {
        try {
          const areas = await obtenerAreas();
          if (areas) await localDb.areas.bulkPut(areas);
        } catch (e) { console.error("Error áreas", e); }

        try {
          const cargos = await obtenerCargos();
          if (cargos) await localDb.cargos.bulkPut(cargos);
        } catch (e) { console.error("Error cargos", e); }

        try {
          const jefes = await obtenerJefes();
          if (jefes) await localDb.jefes.bulkPut(jefes);
        } catch (e) { console.error("Error jefes", e); }

        try {
          const roles = await obtenerRoles();
          if (roles) await localDb.roles.bulkPut(roles);
        } catch (e) { console.error("Error roles", e); }
      }
    };
    sincronizarCatalogos();
  }, [isOnline]);

  // Catálogos desde Dexie
  const listaAreas = useLiveQuery(() => localDb.areas.toArray()) || [];
  const listaCargos = useLiveQuery(() => localDb.cargos.toArray()) || [];
  const listaJefes = useLiveQuery(() => localDb.jefes.toArray()) || [];
  const listaRoles = useLiveQuery(() => localDb.roles.toArray()) || [];

  const TIPOS_USUARIO = ["white", "blue"];
  const SEXOS = ['Masculino', 'Femenino', 'Otro'];
  const RUTAS = ["RUTA 1", "RUTA 2", "RUTA 3", "RUTA 4", "RUTA 5", "RUTA 6"];

  const [formData, setFormData] = useState({
    id: "", estado: "Activo", dni: "", nombre: "", sexo: "", tipo: "", cargo: "",
    area: "", jefeDirecto: "", rol: "", usuario: "", clave: "", fechaNacimiento: "", edad: "",
    hijos: "", celular: "", departamento: "", provincia: "", distrito: "", direccion: "",
    urlCasa: "", coordenadas: "", grupoSanguineo: "", contactoEmergencia: "", rubrica: "",
    correo: "", correoCeva: "", correo3m: "", codMainchart: "",
    fechaIngreso: "", rutaMovilidad: "", fechaSalida: "", permanencia: "", motivoSalida: "", foto: ""
  });

  const [photoPreview, setPhotoPreview] = useState("");
  const [photoDataUrl, setPhotoDataUrl] = useState("");
  const [isZoomOpen, setIsZoomOpen] = useState(false);

  useEffect(() => {
    if (editingId) cargarUsuarioEditar(editingId);
    else setFormData(prev => ({ ...prev, id: "Auto-generado al guardar" }));
  }, [editingId]);

  const cargarUsuarioEditar = async (id) => {
    setLoading(true);
    try {
      let data = null;

      // 1. Si estamos online, traemos la versión real de Supabase para no leer datos desactualizados
      if (isOnline) {
        try {
          data = await obtenerEmpleadoPorId(id);
          if (data) await localDb.usuarios.put(data);
        } catch (errOnline) {
          console.warn("No se pudo leer de Supabase, usando caché local:", errOnline);
        }
      }

      // 2. Respaldo desde localDb si está offline o falló la red
      if (!data) {
        data = await localDb.usuarios.get(id);
      }

      if (data) {
        let edadCalculada = "", permanenciaCalculada = "";
        if (data.fch_nacimiento) {
          const nacimiento = new Date(data.fch_nacimiento + "T00:00:00");
          const hoy = new Date();
          let edad = hoy.getFullYear() - nacimiento.getFullYear();
          const mes = hoy.getMonth() - nacimiento.getMonth();
          if (mes < 0 || (mes === 0 && hoy.getDate() < nacimiento.getDate())) edad--;
          edadCalculada = String(Math.max(0, edad));
        }
        if (data.fecha_ingreso) {
          const inicio = new Date(data.fecha_ingreso + "T00:00:00");
          const fin = data.fch_salida ? new Date(data.fch_salida + "T00:00:00") : new Date();
          inicio.setHours(0, 0, 0, 0);
          fin.setHours(0, 0, 0, 0);
          permanenciaCalculada = String(Math.max(0, Math.floor((fin.getTime() - inicio.getTime()) / 86400000)));
        }

        const esFotoBase64 = String(data.foto_url || "").startsWith("data:image/");

        setFormData({
          id: data.id || "",
          estado: data.fch_salida ? "Inactivo" : (data.estado || "Activo"),
          dni: data.dni || "",
          nombre: data.nombre || "",
          sexo: data.sexo || "",
          tipo: data.tipo || "",
          cargo: data.cargo_id !== null && data.cargo_id !== undefined ? String(data.cargo_id) : "",
          area: data.area_id !== null && data.area_id !== undefined ? String(data.area_id) : "",
          jefeDirecto: data.jefe_directo_id !== null && data.jefe_directo_id !== undefined ? String(data.jefe_directo_id) : "",
          rol: data.rol || "",
          usuario: data.usuario || "",
          clave: data.cl || "",
          fechaNacimiento: data.fch_nacimiento || "",
          fechaSalida: data.fch_salida || "",
          fechaIngreso: data.fecha_ingreso || "",
          hijos: data.hijos !== null && data.hijos !== undefined ? String(data.hijos) : "",
          celular: data.celular || "",
          departamento: data.departamento || "",
          provincia: data.provincia || "",
          distrito: data.distrito || "",
          direccion: data.direccion || "",
          urlCasa: data.url_casa || "",
          coordenadas: data.coordenadas || "",
          grupoSanguineo: data.grupo_sanguineo || "",
          contactoEmergencia: data.contacto_emergencia || "",
          rubrica: data.rubrica || "",
          correo: data.correo_personal || "",
          correoCeva: data.correo_ceva || "",
          correo3m: data.correo_3m || "",
          codMainchart: data.cod_mainchart || "",
          rutaMovilidad: data.ruta_movilidad || "",
          motivoSalida: data.motivo_salida || "",
          foto: esFotoBase64 ? "" : (data.foto_url || ""),
          edad: edadCalculada,
          permanencia: permanenciaCalculada
        });

        if (data.foto_url) {
          if (esFotoBase64) setPhotoDataUrl(data.foto_url);
          setPhotoPreview(convertirDriveUrl(data.foto_url));
        }
      } else {
        setMessage({ text: "No se encontró el usuario solicitado.", type: "error" });
      }
    } catch (err) {
      console.error(err);
      setMessage({ text: "No se pudo cargar el usuario para editar.", type: "error" });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!editingId) {
      const generatedUser = generarUsuarioDesdeNombre(formData.nombre);
      setFormData(prev => {
        if (prev.usuario === generatedUser && prev.clave === prev.dni) return prev;
        return { ...prev, usuario: generatedUser, clave: prev.dni };
      });
    }
  }, [formData.nombre, formData.dni, editingId]);

  useEffect(() => {
    if (formData.fechaNacimiento) {
      const nacimiento = new Date(formData.fechaNacimiento + "T00:00:00");
      const hoy = new Date();
      let edad = hoy.getFullYear() - nacimiento.getFullYear();
      const mes = hoy.getMonth() - nacimiento.getMonth();
      if (mes < 0 || (mes === 0 && hoy.getDate() < nacimiento.getDate())) edad--;
      setFormData(prev => ({ ...prev, edad: String(Math.max(0, edad)) }));
    } else {
      setFormData(prev => ({ ...prev, edad: "" }));
    }
  }, [formData.fechaNacimiento]);

  useEffect(() => {
    const nuevoEstado = formData.fechaSalida ? "Inactivo" : "Activo";
    if (formData.fechaIngreso) {
      const inicio = new Date(formData.fechaIngreso + "T00:00:00");
      const fin = formData.fechaSalida ? new Date(formData.fechaSalida + "T00:00:00") : new Date();
      inicio.setHours(0, 0, 0, 0);
      fin.setHours(0, 0, 0, 0);
      const diff = Math.floor((fin.getTime() - inicio.getTime()) / 86400000);
      setFormData(prev => ({ ...prev, permanencia: String(Math.max(0, diff)), estado: nuevoEstado }));
    } else {
      setFormData(prev => ({ ...prev, permanencia: "", estado: nuevoEstado }));
    }
  }, [formData.fechaIngreso, formData.fechaSalida]);

  const generarUsuarioDesdeNombre = (nombreCompleto) => {
    const text = String(nombreCompleto || "").trim();
    if (!text) return "";
    const parts = text.split(",");
    let apellidos = [], nombres = [];
    if (parts.length >= 2) {
      apellidos = parts[0].trim().split(/\s+/).filter(Boolean);
      nombres = parts.slice(1).join(" ").trim().split(/\s+/).filter(Boolean);
    } else {
      const tokens = text.split(/\s+/).filter(Boolean);
      apellidos = tokens.slice(0, 2);
      nombres = tokens.slice(2);
    }
    const primerNombre = nombres[0] || "";
    const primerApellido = apellidos[0] || "";
    const segundoApellido = apellidos[1] || "";
    const base = normalize(primerNombre.substring(0, 1) + primerApellido + segundoApellido.substring(0, 1)).replace(/[^a-z0-9]/g, "");
    return `${base}@hco.com`.toLowerCase();
  };

  const handleChange = (e) => {
    const { id, value } = e.target;
    setFormData(prev => {
      const next = { ...prev, [id]: value };
      if (id === 'departamento') { next.provincia = ""; next.distrito = ""; }
      if (id === 'provincia') { next.distrito = ""; }
      return next;
    });
    if (id === "foto") { setPhotoDataUrl(""); setPhotoPreview(convertirDriveUrl(value)); }
    if (formErrors.includes(id)) setFormErrors(prev => prev.filter(field => field !== id));
  };

  const handleNombreBlur = () => setFormData(prev => ({ ...prev, nombre: formatearNombre(prev.nombre) }));

  const handlePhotoSelected = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const dataUrl = await compressImage(file, 900, 0.72);
      setPhotoDataUrl(dataUrl); setPhotoPreview(dataUrl); setFormData(prev => ({ ...prev, foto: "" }));
    } catch (error) { setMessage({ text: "No se pudo procesar la foto.", type: "error" }); }
    e.target.value = "";
  };

  const clearPhoto = () => { setPhotoDataUrl(""); setPhotoPreview(""); setFormData(prev => ({ ...prev, foto: "" })); };

  const compressImage = (file, maxWidth, quality) => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const img = new Image();
        img.onload = () => {
          let { width, height } = img;
          if (width > maxWidth) { height = Math.round((height * maxWidth) / width); width = maxWidth; }
          const canvas = document.createElement("canvas");
          canvas.width = width; canvas.height = height;
          const ctx = canvas.getContext("2d"); ctx.drawImage(img, 0, 0, width, height);
          resolve(canvas.toDataURL("image/jpeg", quality));
        };
        img.onerror = reject; img.src = reader.result;
      };
      reader.onerror = reject; reader.readAsDataURL(file);
    });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setMessage({ text: '', type: '' });
    setFormErrors([]);

    const requiredFields = [
      { key: 'dni', label: 'DNI' }, { key: 'nombre', label: 'Nombre' }, { key: 'sexo', label: 'Sexo' },
      { key: 'tipo', label: 'Tipo' }, { key: 'cargo', label: 'Cargo' }, { key: 'area', label: 'Área' },
      { key: 'jefeDirecto', label: 'Jefe directo' }, { key: 'rol', label: 'Rol' }
    ];

    const erroresEncontrados = requiredFields.filter(f => !formData[f.key]).map(f => f.key);
    if (erroresEncontrados.length > 0) {
      setFormErrors(erroresEncontrados);
      setMessage({ text: 'Por favor, complete todos los campos resaltados en rojo.', type: 'error' });
      return;
    }

    setLoading(true);

    try {
      const dniLimpio = String(formData.dni || "").trim();
      const usuarioLimpio = String(formData.usuario || "").trim();

      // 1. Validación de duplicados en localDb y en Supabase (si está online)
      const duplicadoDniLocal = await localDb.usuarios.where('dni').equals(dniLimpio).first();
      const existeDniRemoto = isOnline ? await verificarDniExistente(dniLimpio, editingId) : false;
      if ((duplicadoDniLocal && String(duplicadoDniLocal.id) !== String(editingId)) || existeDniRemoto) {
        setFormErrors(prev => [...prev, 'dni']);
        throw new Error('⚠️ ERROR: El DNI ingresado ya está registrado.');
      }

      const duplicadoUsuarioLocal = await localDb.usuarios.where('usuario').equals(usuarioLimpio).first();
      const existeUsuarioRemoto = isOnline ? await verificarUsuarioExistente(usuarioLimpio, editingId) : false;
      if ((duplicadoUsuarioLocal && String(duplicadoUsuarioLocal.id) !== String(editingId)) || existeUsuarioRemoto) {
        setFormErrors(prev => [...prev, 'nombre']);
        throw new Error(`⚠️ ERROR: El Usuario/Email (${usuarioLimpio}) ya está ocupado.`);
      }

      let finalUserId = editingId;
      let needsAuthCreation = false;

      if (!editingId) {
        if (isOnline) {
          const { data: authData, error: authError } = await supabase.auth.signUp({
            email: usuarioLimpio,
            password: String(formData.clave || "").trim(),
          });
          if (authError) throw new Error(`Error Auth: ${authError.message}`);
          finalUserId = authData?.user?.id || crypto.randomUUID();
        } else {
          finalUserId = crypto.randomUUID();
          needsAuthCreation = true;
        }
      }

      const recordData = {
        id: finalUserId,
        estado: formData.fechaSalida ? "Inactivo" : (formData.estado || "Activo"),
        dni: dniLimpio,
        nombre: String(formData.nombre || "").trim(),
        sexo: formData.sexo,
        tipo: formData.tipo,
        cargo_id: parseId(formData.cargo),
        area_id: parseId(formData.area),
        jefe_directo_id: parseId(formData.jefeDirecto),
        rol: formData.rol,
        usuario: usuarioLimpio,
        cl: String(formData.clave || "").trim(),
        fch_nacimiento: formData.fechaNacimiento || null,
        fch_salida: formData.fechaSalida || null,
        fecha_ingreso: formData.fechaIngreso || null,
        correo_personal: String(formData.correo || "").trim() || null,
        correo_ceva: String(formData.correoCeva || "").trim() || null,
        correo_3m: String(formData.correo3m || "").trim() || null,
        cod_mainchart: String(formData.codMainchart || "").trim() || null,
        hijos: formData.hijos !== "" && formData.hijos !== null ? parseInt(formData.hijos, 10) : 0,
        celular: String(formData.celular || "").trim() || null,
        departamento: formData.departamento || null,
        provincia: formData.provincia || null,
        distrito: formData.distrito || null,
        direccion: String(formData.direccion || "").trim() || null,
        url_casa: String(formData.urlCasa || "").trim() || null,
        coordenadas: String(formData.coordenadas || "").trim() || null,
        grupo_sanguineo: String(formData.grupoSanguineo || "").trim() || null,
        contacto_emergencia: String(formData.contactoEmergencia || "").trim() || null,
        rubrica: String(formData.rubrica || "").trim() || null,
        ruta_movilidad: formData.rutaMovilidad || null,
        motivo_salida: String(formData.motivoSalida || "").trim() || null,
        foto_url: photoDataUrl ? photoDataUrl : (formData.foto ? convertirDriveUrl(formData.foto) : null)
      };

      // 2. Guardamos PRIMERO en Supabase cuando estamos Online y luego actualizamos localDb
      if (isOnline) {
        let savedRecord;
        if (editingId) {
          savedRecord = await actualizarEmpleado(editingId, recordData);
        } else {
          savedRecord = await crearEmpleado(recordData);
        }

        // Guardamos en localDb exactamente lo que confirmó Supabase
        await localDb.usuarios.put(savedRecord || recordData);
        setMessage({ text: "Usuario guardado correctamente en el servidor.", type: "success" });
      } else {
        await localDb.usuarios.put(recordData);
        await localDb.sync_queue.add({
          tabla: 'empleados',
          operacion: editingId ? 'UPDATE' : 'INSERT',
          needsAuth: needsAuthCreation,
          payload: recordData
        });
        setMessage({ text: "Modo Offline: Guardado localmente, se sincronizará luego.", type: "warning" });
      }

      setTimeout(() => navigate('/usuarios/tracking_usuarios'), 1200);

    } catch (error) {
      console.error(error);
      setMessage({ text: error.message || "Error al guardar usuario.", type: "error" });
    } finally {
      setLoading(false);
    }
  };

  const departamentos = Object.keys(UBIGEO).sort();
  const provincias = formData.departamento ? Object.keys(UBIGEO[formData.departamento] || {}).sort() : [];
  const distritos = formData.departamento && formData.provincia ? (UBIGEO[formData.departamento][formData.provincia] || []) : [];

  const handleRestablecerClave = async () => {
    if (!isOnline) {
      setMessage({ text: "Esta acción requiere conexión a internet.", type: "error" });
      return;
    }
    if (!formData.dni) return setMessage({ text: "Falta DNI.", type: "error" });
    if (!window.confirm(`¿Estás seguro de restablecer la contraseña a su DNI (${formData.dni})?`)) return;

    setLoading(true);
    try {
      const { error: authError } = await supabase.rpc('restablecer_clave_admin', { user_id: editingId, nueva_clave: formData.dni });
      if (authError) throw authError;

      await actualizarEmpleado(editingId, { cl: formData.dni });
      await localDb.usuarios.update(editingId, { cl: formData.dni });

      setFormData(prev => ({ ...prev, clave: formData.dni }));
      setMessage({ text: "Contraseña restablecida exitosamente.", type: "success" });
    } catch (error) {
      setMessage({ text: error.message || "Error al restablecer.", type: "error" });
    } finally { setLoading(false); }
  };

  return (
    <div className="registro-usuario-page" style={{ position: 'relative' }}>
      {loading && <Loading />}
      <section className="page-hero">
        <span className="page-chip">Administración</span>
        <h1>{editingId ? "Editar usuario" : "Nuevo usuario"} {isOnline ? '🟢' : '🔴 (Offline)'}</h1>
        <p>Complete los datos principales del usuario. Los campos obligatorios están marcados como * OBLIGATORIO.</p>
      </section>

      <section className="card">
        <div className="card-head-modern">
          <div className="card-head-left">
            <h2>{editingId ? "Actualizar usuario" : "Registrar usuario"}</h2>
            <p>El estado inicial será Activo y la clave inicial será el DNI.</p>
          </div>
          <div className="card-head-right">
            {editingId && isSuperAdmin && isOnline && (
              <button type="button" className="btn-restablecer-mini" onClick={handleRestablecerClave} title="Restablecer clave al DNI">
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"></path><path d="M3 3v5h5"></path></svg>
                Restablecer Clave
              </button>
            )}
            <div className="legend-item"><span className="legend-dot auto"></span><span>Llenado automático</span></div>
            <div className="legend-item"><span className="legend-dot manual"></span><span>Debe completar</span></div>
          </div>
        </div>

        <form className="usuario-form" onSubmit={handleSubmit} noValidate>
          <div className="section-title">Datos principales</div>

          <div className="form-grid cols-4">
            <div className="field field-auto">
              <label>ID <span className="field-badge auto">AUTO</span></label>
              <input type="text" value={formData.id} readOnly />
            </div>
            <div className="field field-auto">
              <label>Estado <span className="field-badge auto">AUTO</span></label>
              <input type="text" value={formData.estado} readOnly />
            </div>
            <div className="field field-manual">
              <label>DNI <span className="field-badge manual">OBLIGATORIO</span></label>
              <input type="text" id="dni" className={formErrors.includes('dni') ? 'input-error' : ''} value={formData.dni} onChange={handleChange} maxLength="20" required />
            </div>
            <div className="field field-manual">
              <label>Área <span className="field-badge manual">OBLIGATORIO</span></label>
              <select id="area" className={formErrors.includes('area') ? 'input-error' : ''} value={formData.area} onChange={handleChange} required>
                <option value="">Seleccione área</option>
                {listaAreas.map(a => <option key={a.id} value={a.id}>{a.nombre}</option>)}
              </select>
            </div>
          </div>

          <div className="form-grid cols-4">
            <div className="field field-manual">
              <label>Nombre <span className="field-badge manual">OBLIGATORIO</span></label>
              <input type="text" id="nombre" className={formErrors.includes('nombre') ? 'input-error' : ''} placeholder="Apellido Apellido, Nombre Nombre" value={formData.nombre} onChange={handleChange} onBlur={handleNombreBlur} required />
            </div>
            <div className="field field-manual">
              <label>Sexo <span className="field-badge manual">OBLIGATORIO</span></label>
              <select id="sexo" className={formErrors.includes('sexo') ? 'input-error' : ''} value={formData.sexo} onChange={handleChange} required>
                <option value="">Seleccione sexo</option>
                {SEXOS.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div className="field field-manual">
              <label>Tipo <span className="field-badge manual">OBLIGATORIO</span></label>
              <select id="tipo" className={formErrors.includes('tipo') ? 'input-error' : ''} value={formData.tipo} onChange={handleChange} required>
                <option value="">Seleccione tipo</option>
                {TIPOS_USUARIO.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div className="field field-manual">
              <label>Cargo <span className="field-badge manual">OBLIGATORIO</span></label>
              <select id="cargo" className={formErrors.includes('cargo') ? 'input-error' : ''} value={formData.cargo} onChange={handleChange} required>
                <option value="">Seleccione cargo</option>
                {listaCargos.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
              </select>
            </div>
          </div>

          <div className="form-grid cols-4">
            <div className="field field-manual">
              <label>Jefe directo <span className="field-badge manual">OBLIGATORIO</span></label>
              <select id="jefeDirecto" className={formErrors.includes('jefeDirecto') ? 'input-error' : ''} value={formData.jefeDirecto} onChange={handleChange} required>
                <option value="">Seleccione jefe directo</option>
                {listaJefes.map(j => <option key={j.id} value={j.id}>{j.nombre}</option>)}
              </select>
            </div>
            <div className="field field-manual">
              <label>Rol <span className="field-badge manual">OBLIGATORIO</span></label>
              <select id="rol" className={formErrors.includes('rol') ? 'input-error' : ''} value={formData.rol} onChange={handleChange} required>
                <option value="">Seleccione rol</option>
                {listaRoles.map(r => (
                  <option key={r.id} value={r.nombre || r.rol}>
                    {r.nombre || r.rol}
                  </option>
                ))}
              </select>
            </div>

            <div className="field field-auto">
              <label>Usuario / Email login <span className="field-badge auto">AUTO</span></label>
              <input type="text" id="usuario" className={formErrors.includes('nombre') ? 'input-error' : ''} value={formData.usuario} readOnly />
            </div>
            <div className="field field-auto">
              <label>Clave {isSuperAdmin ? <span className="field-badge" style={{ backgroundColor: '#dcfce7', color: '#166534', border: '1px solid #bbf7d0' }}>VISIBLE</span> : <span className="field-badge auto">OCULTO</span>}</label>
              <input type="text" id="clave" value={isSuperAdmin ? (formData.clave || "Sin clave") : "••••••••••••"} readOnly style={!isSuperAdmin ? { letterSpacing: '3px', color: '#94a3b8', fontWeight: 'bold' } : {}} />
            </div>
          </div>

          <div className="dual-titles">
            <div className="section-title">FOTO</div>
            <div className="section-title">CORREOS</div>
          </div>

          <div className="split-layout">
            <div className="split-panel">
              <div className="photo-content-split">
                <div className="photo-inputs-split">
                  <div className="field">
                    <label>URL de la foto (Drive o Web)</label>
                    <input type="url" id="foto" placeholder="Pegar enlace aquí" value={formData.foto} onChange={handleChange} />
                  </div>
                  <div className="field">
                    <label>O Cargar foto</label>
                    <div className="custom-file-upload">
                      <input type="file" id="file-upload" accept="image/*" onChange={handlePhotoSelected} />
                      <label htmlFor="file-upload" className="file-btn-centered">
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line></svg>
                        <span>Seleccionar foto</span>
                      </label>
                    </div>
                  </div>
                </div>

                <div className="photo-preview-split">
                  {photoPreview ? (
                    <div className="preview-card-split">
                      <img
                        key={photoPreview}
                        src={photoPreview}
                        alt="Vista previa"
                        title="Clic para ampliar foto"
                        style={{ cursor: 'zoom-in' }}
                        onClick={() => setIsZoomOpen(true)}
                        referrerPolicy="no-referrer"
                        crossOrigin="anonymous"
                        onError={(e) => {
                          const driveId = extraerIdDrive(formData.foto || photoPreview);
                          if (!driveId) return;

                          const step = Number(e.target.dataset.fallbackStep || 0);
                          if (step === 0) {
                            e.target.dataset.fallbackStep = "1";
                            e.target.src = `https://lh3.googleusercontent.com/d/${driveId}=w1000`;
                          } else if (step === 1) {
                            e.target.dataset.fallbackStep = "2";
                            e.target.src = `https://drive.google.com/uc?export=view&id=${driveId}`;
                          }
                        }}
                      />
                      <button type="button" onClick={clearPhoto} className="btn-quitar-foto-force">Quitar</button>
                    </div>
                  ) : (
                    <div className="placeholder-split">Sin foto</div>
                  )}
                </div>
              </div>
            </div>

            <div className="split-panel">
              <div className="form-grid cols-2">
                <div className="field"><label>Correo Personal</label><input type="email" id="correo" value={formData.correo} onChange={handleChange} /></div>
                <div className="field"><label>Código MYHR</label><input type="text" id="codMainchart" value={formData.codMainchart} onChange={handleChange} /></div>
                <div className="field"><label>Correo CEVA</label><input type="email" id="correoCeva" value={formData.correoCeva} onChange={handleChange} /></div>
                <div className="field"><label>Correo 3M</label><input type="email" id="correo3m" value={formData.correo3m} onChange={handleChange} /></div>
              </div>
            </div>
          </div>

          <div className="section-title">Datos personales</div>
          <div className="form-grid cols-4">
            <div className="field field-manual"><label>Fch. Nacimiento</label><input type="date" id="fechaNacimiento" value={formData.fechaNacimiento} onChange={handleChange} /></div>
            <div className="field field-auto"><label>Edad <span className="field-badge auto">AUTO</span></label><input type="text" value={formData.edad} readOnly /></div>
            <div className="field field-manual"><label>Hijos</label><input type="number" id="hijos" min="0" max="99" value={formData.hijos} onChange={handleChange} /></div>
            <div className="field field-manual"><label>Celular</label><input type="tel" id="celular" value={formData.celular} onChange={handleChange} /></div>
          </div>

          <div className="form-grid cols-3">
            <div className="field field-manual">
              <label>Departamento</label>
              <select id="departamento" value={formData.departamento} onChange={handleChange}>
                <option value="">Seleccione...</option>
                {departamentos.map(d => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>
            <div className="field field-manual">
              <label>Provincia</label>
              <select id="provincia" value={formData.provincia} onChange={handleChange}>
                <option value="">Seleccione...</option>
                {provincias.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
            <div className="field field-manual">
              <label>Distrito</label>
              <select id="distrito" value={formData.distrito} onChange={handleChange}>
                <option value="">Seleccione...</option>
                {distritos.map(d => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>
          </div>

          <div className="form-grid cols-3">
            <div className="field field-manual"><label>Dirección</label><input type="text" id="direccion" value={formData.direccion} onChange={handleChange} /></div>
            <div className="field field-manual"><label>URL casa</label><input type="url" id="urlCasa" value={formData.urlCasa} onChange={handleChange} /></div>
            <div className="field field-manual"><label>Coordenadas</label><input type="text" id="coordenadas" placeholder="-12.000000, -77.000000" value={formData.coordenadas} onChange={handleChange} /></div>
          </div>

          <div className="form-grid cols-3">
            <div className="field field-manual"><label>Grupo sanguíneo</label><input type="text" id="grupoSanguineo" value={formData.grupoSanguineo} onChange={handleChange} /></div>
            <div className="field field-manual"><label>Contacto emergencia</label><input type="tel" id="contactoEmergencia" value={formData.contactoEmergencia} onChange={handleChange} /></div>
            <div className="field field-manual"><label>Rúbrica</label><input type="text" id="rubrica" value={formData.rubrica} onChange={handleChange} /></div>
          </div>

          <div className="section-title">Datos laborales</div>
          <div className="form-grid cols-4">
            <div className="field field-manual"><label>Fecha de ingreso</label><input type="date" id="fechaIngreso" value={formData.fechaIngreso} onChange={handleChange} /></div>
            <div className="field field-manual">
              <label>Ruta de movilidad</label>
              <select id="rutaMovilidad" value={formData.rutaMovilidad} onChange={handleChange}>
                <option value="">Seleccione ruta</option>
                {RUTAS.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
            <div className="field field-manual"><label>Fch. Salida</label><input type="date" id="fechaSalida" value={formData.fechaSalida} onChange={handleChange} /></div>
            <div className="field field-auto"><label>Permanencia (días) <span className="field-badge auto">AUTO</span></label><input type="text" value={formData.permanencia} readOnly /></div>
          </div>

          <div className="form-grid cols-1">
            <div className="field field-manual field-full">
              <label>Motivo de salida</label>
              <textarea id="motivoSalida" rows="3" value={formData.motivoSalida} onChange={handleChange}></textarea>
            </div>
          </div>

          {message.text && (
            <div className={`form-message ${message.type}`}>
              {message.text}
            </div>
          )}

          <div className="submit-row">
            <button type="button" onClick={() => navigate('/usuarios/tracking_usuarios')} className="secondary-btn">Volver</button>
            <button type="submit" disabled={loading} className="primary-btn">
              {editingId ? "Actualizar usuario" : "Guardar usuario"}
            </button>
          </div>
        </form>
      </section>
      {isZoomOpen && photoPreview && (
        <div className="photo-zoom-overlay" onClick={() => setIsZoomOpen(false)}>
          <div className="photo-zoom-container" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              className="photo-zoom-close"
              onClick={() => setIsZoomOpen(false)}
              title="Cerrar (Esc)"
            >
              ✕
            </button>
            <img
              src={photoPreview}
              alt="Vista ampliada"
              className="photo-zoom-img"
              referrerPolicy="no-referrer"
            />
          </div>
        </div>
      )}
    </div>
  );
}