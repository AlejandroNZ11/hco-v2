import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '../../supabaseClient';
import Loading from '../../layouts/Loading';
import './registra_usuario.css';

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


const normalize = (text) => String(text || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();

export default function RegistrarUsuario() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const editingId = searchParams.get("id");

  const [loading, setLoading] = useState(false);
  const [loadingText, setLoadingText] = useState("Cargando datos...");
  const [message, setMessage] = useState({ text: '', type: '' });
  const [formErrors, setFormErrors] = useState([]);

  // Listas dinámicas para los selects
  const [listaAreas, setListaAreas] = useState([]);
  const [listaCargos, setListaCargos] = useState([]);
  const [listaJefes, setListaJefes] = useState([]);

  const TIPOS_USUARIO = ["white", "blue"];
  const SEXOS = ['Masculino', 'Femenino', 'Otro'];
  const ROLES = ["USUARIO", "SUPERVISOR", "ADMIN", "SUPERADMIN"];
  const RUTAS = ["RUTA 1", "RUTA 2", "RUTA 3", "RUTA 4", "RUTA 5", "RUTA 6"];

  // Estado del formulario
  const [formData, setFormData] = useState({
    id: "", estado: "Activo", dni: "", nombre: "", sexo: "", tipo: "", cargo: "",
    area: "", jefeDirecto: "", rol: "", usuario: "", clave: "", fechaNacimiento: "", edad: "",
    hijos: "", celular: "", departamento: "", provincia: "", distrito: "", direccion: "",
    urlCasa: "", coordenadas: "", grupoSanguineo: "", contactoEmergencia: "", 
    correo: "", correoCeva: "", correo3m: "", codMainchart: "", // <-- CAMPOS AGREGADOS
    fechaIngreso: "", rutaMovilidad: "", fechaSalida: "", permanencia: "", motivoSalida: "", foto: ""
  });

  const [photoPreview, setPhotoPreview] = useState("");
  const [photoDataUrl, setPhotoDataUrl] = useState("");

  // ================= INICIALIZACIÓN Y CARGA DE DATOS =================
  useEffect(() => {
    cargarCatalogosSupabase();
    if (editingId) {
      cargarUsuarioEditar(editingId);
    } else {
      generarSiguienteId();
    }
  }, [editingId]);

  const cargarCatalogosSupabase = async () => {
    try {
      // 1. Cargar Áreas (Traemos id y nombre)
      const { data: areasData } = await supabase.from('areas').select('id, nombre').order('nombre');
      if (areasData) setListaAreas(areasData);

      // 2. Cargar Cargos
      const { data: cargosData } = await supabase.from('cargos').select('id, nombre').order('nombre');
      if (cargosData) setListaCargos(cargosData);

      // 3. Cargar Jefes Directos (Traemos id y nombre)
      const { data: jefesData } = await supabase
        .from('empleados')
        .select('id, nombre')
        .ilike('tipo', 'white')
        .order('nombre');
      if (jefesData) setListaJefes(jefesData);

    } catch (error) {
      console.error("Error al cargar catálogos:", error);
    }
  };


  const generarSiguienteId = async () => {
    // Al ser UUIDs, simplemente mostramos un texto hasta que se guarde
    setFormData(prev => ({ ...prev, id: "Auto-generado al guardar" }));
  };

  const cargarUsuarioEditar = async (id) => {
    setLoading(true);
    setLoadingText("Cargando usuario...");
    try {
      const { data, error } = await supabase
        .from('empleados')
        .select('*')
        .eq('id', id)
        .single();

      if (error) throw error;

      if (data) {
        // ==========================================
        // CÁLCULO INMEDIATO USANDO fch_nacimiento y fch_salida
        // ==========================================
        let edadCalculada = "";
        if (data.fch_nacimiento) {
          const nacimiento = new Date(data.fch_nacimiento + "T00:00:00");
          const hoy = new Date();
          let edad = hoy.getFullYear() - nacimiento.getFullYear();
          const mes = hoy.getMonth() - nacimiento.getMonth();
          if (mes < 0 || (mes === 0 && hoy.getDate() < nacimiento.getDate())) edad--;
          edadCalculada = String(Math.max(0, edad));
        }

        let permanenciaCalculada = "";
        if (data.fecha_ingreso) {
          const inicio = new Date(data.fecha_ingreso + "T00:00:00");
          const fin = data.fch_salida ? new Date(data.fch_salida + "T00:00:00") : new Date();
          inicio.setHours(0, 0, 0, 0);
          fin.setHours(0, 0, 0, 0);
          const diff = Math.floor((fin.getTime() - inicio.getTime()) / 86400000);
          permanenciaCalculada = String(Math.max(0, diff));
        }

        setFormData({
          id: data.id || "",
          estado: data.estado || "Activo",
          dni: data.dni || "",
          nombre: data.nombre || "",
          sexo: data.sexo || "",
          tipo: data.tipo || "",
          cargo: data.cargo_id || "",
          area: data.area_id || "",
          jefeDirecto: data.jefe_directo_id || "",
          rol: data.rol || "",
          usuario: data.usuario || "",
          clave: data.clave || "", 
          
          // --- AQUÍ ESTÁ LA CORRECCIÓN: fch_nacimiento y fch_salida ---
          fechaNacimiento: data.fch_nacimiento || "", 
          fechaSalida: data.fch_salida || "",
          fechaIngreso: data.fecha_ingreso || "",

          hijos: data.hijos !== null && data.hijos !== undefined ? data.hijos : "", 
          celular: data.celular || "",
          departamento: data.departamento || "",
          provincia: data.provincia || "",
          distrito: data.distrito || "",
          direccion: data.direccion || "",
          urlCasa: data.url_casa || "",
          coordenadas: data.coordenadas || "",
          grupoSanguineo: data.grupo_sanguineo || "",
          contactoEmergencia: data.contacto_emergencia || "",
          correo: data.correo_personal || "", 
          correoCeva: data.correo_ceva || "",
          correo3m: data.correo_3m || "",
          codMainchart: data.cod_mainchart || "",
          rutaMovilidad: data.ruta_movilidad || "",
          motivoSalida: data.motivo_salida || "",
          foto: data.foto_url || "",
          
          edad: edadCalculada, 
          permanencia: permanenciaCalculada
        });

        if (data.foto_url) {
          setPhotoPreview(data.foto_url);
        }
      }
    } catch (err) {
      console.error(err);
      setMessage({ text: "No se pudo cargar el usuario para editar.", type: "error" });
    } finally {
      setLoading(false);
    }
  };



  // ================= CÁLCULOS Y EFECTOS =================
  useEffect(() => {
    if (!editingId || !formData.usuario) {
      const generatedUser = generarUsuarioDesdeNombre(formData.nombre);
      setFormData(prev => ({ ...prev, usuario: generatedUser, clave: prev.dni }));
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
    if (formData.fechaIngreso) {
      const inicio = new Date(formData.fechaIngreso + "T00:00:00");
      const fin = formData.fechaSalida ? new Date(formData.fechaSalida + "T00:00:00") : new Date();
      inicio.setHours(0, 0, 0, 0);
      fin.setHours(0, 0, 0, 0);
      const diff = Math.floor((fin.getTime() - inicio.getTime()) / 86400000);
      setFormData(prev => ({ ...prev, permanencia: String(Math.max(0, diff)) }));
    } else {
      setFormData(prev => ({ ...prev, permanencia: "" }));
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
        
        // Generamos la base limpia (sin tildes, sin eñes, todo minúscula)
        const base = normalize(primerNombre.substring(0, 1) + primerApellido + segundoApellido.substring(0, 1)).replace(/[^a-z0-9]/g, "");
        
        // Retornamos directamente con el dominio hco.com
        return `${base}@hco.com`.toLowerCase();
    };


  // ================= MANEJADORES DE EVENTOS =================
  const handleChange = (e) => {
    const { id, value } = e.target;
    setFormData(prev => {
      const next = { ...prev, [id]: value };
      if (id === 'departamento') { next.provincia = ""; next.distrito = ""; }
      if (id === 'provincia') { next.distrito = ""; }
      return next;
    });

    // Limpia el borde rojo del campo tan pronto como el usuario interactúe con él
    if (formErrors.includes(id)) {
      setFormErrors(prev => prev.filter(field => field !== id));
    }
  };

  const handlePhotoSelected = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const dataUrl = await compressImage(file, 900, 0.72);
      setPhotoDataUrl(dataUrl);
      setPhotoPreview(dataUrl);
    } catch (error) {
      setMessage({ text: "No se pudo procesar la foto.", type: "error" });
    }
    e.target.value = "";
  };

  const clearPhoto = () => {
    setPhotoDataUrl("");
    setPhotoPreview("");
  };

  const compressImage = (file, maxWidth, quality) => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const img = new Image();
        img.onload = () => {
          let { width, height } = img;
          if (width > maxWidth) {
            height = Math.round((height * maxWidth) / width);
            width = maxWidth;
          }
          const canvas = document.createElement("canvas");
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext("2d");
          ctx.drawImage(img, 0, 0, width, height);
          resolve(canvas.toDataURL("image/jpeg", quality));
        };
        img.onerror = reject;
        img.src = reader.result;
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setMessage({ text: '', type: '' });
    setFormErrors([]); 

    const requiredFields = [
      { key: 'dni', label: 'DNI' }, 
      { key: 'nombre', label: 'Nombre' },
      { key: 'sexo', label: 'Sexo' }, 
      { key: 'tipo', label: 'Tipo' },
      { key: 'cargo', label: 'Cargo' }, 
      { key: 'area', label: 'Área' },
      { key: 'jefeDirecto', label: 'Jefe directo' }, 
      { key: 'rol', label: 'Rol' }
    ];

    const erroresEncontrados = [];
    for (let field of requiredFields) {
      if (!formData[field.key]) {
        erroresEncontrados.push(field.key);
      }
    }

    if (erroresEncontrados.length > 0) {
      setFormErrors(erroresEncontrados);
      setMessage({ text: 'Por favor, complete todos los campos resaltados en rojo.', type: 'error' });
      return;
    }

    setLoading(true);
    setLoadingText("Guardando usuario...");

    try {
      let finalUserId = editingId;

      if (!editingId) {
        const emailLogin = formData.usuario.trim();
        const { data: authData, error: authError } = await supabase.auth.signUp({
          email: emailLogin,
          password: formData.clave.trim(),
        });

        if (authError) throw new Error(`Error en Autenticación: ${authError.message}`);
        if (!authData.user) throw new Error("No se pudo obtener el ID del usuario creado.");

        finalUserId = authData.user.id;
      }

      const recordData = {
        id: finalUserId,
        estado: formData.estado,
        dni: formData.dni.trim(),
        nombre: formData.nombre.trim(),
        sexo: formData.sexo,
        tipo: formData.tipo,
        
        cargo_id: formData.cargo ? parseInt(formData.cargo) : null,
        area_id: formData.area ? parseInt(formData.area) : null,
        jefe_directo_id: formData.jefeDirecto || null, 
        rol: formData.rol,
        usuario: formData.usuario.trim(),
        
        // --- AQUÍ ESTÁ LA CORRECCIÓN: fch_nacimiento y fch_salida ---
        fch_nacimiento: formData.fechaNacimiento || null,
        fch_salida: formData.fechaSalida || null,
        fecha_ingreso: formData.fechaIngreso || null,
        
        correo_personal: formData.correo.trim(),
        correo_ceva: formData.correoCeva.trim(),
        correo_3m: formData.correo3m.trim(),
        cod_mainchart: formData.codMainchart.trim(),        
        
        hijos: formData.hijos !== "" ? parseInt(formData.hijos) : 0, 
        
        celular: formData.celular.trim(),
        departamento: formData.departamento,
        provincia: formData.provincia,
        distrito: formData.distrito,
        direccion: formData.direccion.trim(),
        url_casa: formData.urlCasa.trim(),
        coordenadas: formData.coordenadas.trim(),
        grupo_sanguineo: formData.grupoSanguineo.trim(),
        contacto_emergencia: formData.contactoEmergencia.trim(),
        ruta_movilidad: formData.rutaMovilidad || null, 
        motivo_salida: formData.motivoSalida.trim()
      };

      if (photoDataUrl) {
        recordData.foto_url = photoDataUrl;
      } else if (formData.foto) {
        recordData.foto_url = formData.foto;
      }

      let errorInsertUpdate;
      if (editingId) {
        const res = await supabase.from('empleados').update(recordData).eq('id', editingId);
        errorInsertUpdate = res.error;
      } else {
        const res = await supabase.from('empleados').insert([recordData]);
        errorInsertUpdate = res.error;
      }

      if (errorInsertUpdate) throw new Error(`Error al guardar perfil: ${errorInsertUpdate.message}`);

      setMessage({ text: "Usuario guardado correctamente.", type: "success" });
      setTimeout(() => navigate('/usuarios/tracking_usuarios'), 800);

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

  return (
    <div className="registro-page" style={{ position: 'relative' }}>
      
      {loading && <Loading />}

      <section className="page-hero">
        <span className="page-chip">Administración</span>
        <h1>{editingId ? "Editar usuario" : "Nuevo usuario"}</h1>
        <p>Complete los datos principales del usuario. Los campos obligatorios están marcados como * OBLIGATORIO.</p>

      </section>

      <section className="card">
        <div className="card-head">
          <div className="form-legend">
            <div className="legend-item"><span className="legend-dot auto"></span><span>Llenado automático</span></div>
            <div className="legend-item"><span className="legend-dot manual"></span><span>Debe completar</span></div>
          </div>
          <h2>{editingId ? "Actualizar usuario" : "Registrar usuario"}</h2>
          <p>El estado inicial será Activo y la clave inicial será el DNI.</p>
        </div>

        <form className="usuario-form" onSubmit={handleSubmit} noValidate>
          
          <div className="section-title">Datos principales</div>

                   {/* FILA 1 */}
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
              <label>DNI <span className="field-badge manual">* OBLIGATORIO</span></label>
              <input type="text" id="dni" className={formErrors.includes('dni') ? 'input-error' : ''} value={formData.dni} onChange={handleChange} maxLength="20" required />
            </div>
            <div className="field field-manual">
              <label>Área <span className="field-badge manual">* OBLIGATORIO</span></label>
              <select id="area" className={formErrors.includes('area') ? 'input-error' : ''} value={formData.area} onChange={handleChange} required>
                <option value="">Seleccione área</option>
                {listaAreas.map(a => <option key={a.id} value={a.id}>{a.nombre}</option>)}
            </select>

            </div>
          </div>

          {/* FILA 2 */}
          <div className="form-grid cols-4">
            <div className="field field-manual">
              <label>Nombre <span className="field-badge manual">* OBLIGATORIO</span></label>
              <input type="text" id="nombre" className={formErrors.includes('nombre') ? 'input-error' : ''} placeholder="Apellidos, Nombres" value={formData.nombre} onChange={handleChange} required />
            </div>
            <div className="field field-manual">
              <label>Sexo <span className="field-badge manual">* OBLIGATORIO</span></label>
              <select id="sexo" className={formErrors.includes('sexo') ? 'input-error' : ''} value={formData.sexo} onChange={handleChange} required>
                <option value="">Seleccione sexo</option>
                {SEXOS.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div className="field field-manual">
              <label>Tipo <span className="field-badge manual">* OBLIGATORIO</span></label>
              <select id="tipo" className={formErrors.includes('tipo') ? 'input-error' : ''} value={formData.tipo} onChange={handleChange} required>
                <option value="">Seleccione tipo</option>
                {TIPOS_USUARIO.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div className="field field-manual">
              <label>Cargo <span className="field-badge manual">* OBLIGATORIO</span></label>
                <select id="cargo" className={formErrors.includes('cargo') ? 'input-error' : ''} value={formData.cargo} onChange={handleChange} required>
                    <option value="">Seleccione cargo</option>
                    {listaCargos.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
                </select>
            </div>
          </div>

          {/* FILA 3 */}
          <div className="form-grid cols-4">
            <div className="field field-manual">
              <label>Jefe directo <span className="field-badge manual">* OBLIGATORIO</span></label>
                <select id="jefeDirecto" className={formErrors.includes('jefeDirecto') ? 'input-error' : ''} value={formData.jefeDirecto} onChange={handleChange} required>
                    <option value="">Seleccione jefe directo</option>
                    {listaJefes.map(j => <option key={j.id} value={j.id}>{j.nombre}</option>)}
                </select>
            </div>
            <div className="field field-manual">
              <label>Rol <span className="field-badge manual">* OBLIGATORIO</span></label>
              <select id="rol" className={formErrors.includes('rol') ? 'input-error' : ''} value={formData.rol} onChange={handleChange} required>
                <option value="">Seleccione rol</option>
                {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
            <div className="field field-auto">
              <label>Usuario / Email login <span className="field-badge auto">AUTO</span></label>
              <input type="text" id="usuario" value={formData.usuario} readOnly />
            </div>
            <div className="field field-auto">
              <label>Clave <span className="field-badge auto">AUTO</span></label>
              <input type="text" id="clave" value={formData.clave} readOnly />
            </div>
          </div>

          {/* TÍTULOS SUPERIORES */}
          <div className="dual-titles">
            <div className="section-title">FOTO</div>
            <div className="section-title">CORREOS</div>
          </div>
          
          <div className="split-layout">
            
            {/* MITAD IZQUIERDA: FOTO */}
            <div className="split-panel">
              <div className="photo-content-split">
                
                {/* Inputs de foto apilados */}
                <div className="photo-inputs-split">
                  <div className="field">
                    <label>URL de la foto</label>
                    <input type="url" id="foto" placeholder="Ej: https://..." value={formData.foto} onChange={handleChange} />
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

                {/* Miniatura cuadrada a la derecha */}
                <div className="photo-preview-split">
                  {photoPreview ? (
                    <div className="preview-card-split">
                      <img src={photoPreview} alt="Vista previa" />
                      <button type="button" onClick={clearPhoto} className="btn-quitar-foto-force">
                        Quitar
                      </button>
                    </div>
                  ) : (
                    <div className="placeholder-split">Sin foto</div>
                  )}
                </div>

              </div>
            </div>

            {/* MITAD DERECHA: CORREOS Y CODIGO */}
            <div className="split-panel">
              <div className="form-grid cols-2">
                <div className="field">
                  <label>Correo Personal</label>
                  <input type="email" id="correo" value={formData.correo} onChange={handleChange} />
                </div>
                <div className="field">
                  <label>Código MYHR</label>
                  <input type="text" id="codMainchart" value={formData.codMainchart} onChange={handleChange} />
                </div>
                <div className="field">
                  <label>Correo CEVA</label>
                  <input type="email" id="correoCeva" value={formData.correoCeva} onChange={handleChange} />
                </div>
                <div className="field">
                  <label>Correo 3M</label>
                  <input type="email" id="correo3m" value={formData.correo3m} onChange={handleChange} />
                </div>
              </div>
            </div>

          </div>


          <div className="section-title">Datos personales</div>
          <div className="form-grid cols-4">
            <div className="field field-manual">
              <label>Fch. Nacimiento</label>
              <input type="date" id="fechaNacimiento" value={formData.fechaNacimiento} onChange={handleChange} />
            </div>
            <div className="field field-auto">
              <label>Edad <span className="field-badge auto">AUTO</span></label>
              <input type="text" value={formData.edad} readOnly />
            </div>
            <div className="field field-manual">
              <label>Hijos</label>
              <input type="number" id="hijos" min="0" max="99" value={formData.hijos} onChange={handleChange} />
            </div>
            <div className="field field-manual">
              <label>Celular</label>
              <input type="tel" id="celular" value={formData.celular} onChange={handleChange} />
            </div>
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
    </div>
  );
}
