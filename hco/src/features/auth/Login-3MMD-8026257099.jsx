import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../supabaseClient';
import './Login.css';

const FOTO_PLACEHOLDER = "data:image/svg+xml;charset=UTF-8," + encodeURIComponent(`
  <svg xmlns="http://www.w3.org/2000/svg" width="120" height="120" viewBox="0 0 120 120">
    <rect width="120" height="120" rx="16" fill="#e2e8f0"/>
    <circle cx="60" cy="42" r="22" fill="#94a3b8"/>
    <path d="M22 101c7-18 22-28 38-28s31 10 38 28" fill="#94a3b8"/>
  </svg>
`);

export default function Login() {
  const navigate = useNavigate();
  const [usuario, setUsuario] = useState('');
  const [password, setPassword] = useState('');
  
  // Aquí guardaremos todos los usuarios en memoria al cargar la página
  const [usuariosCache, setUsuariosCache] = useState([]);

  const [uiState, setUiState] = useState({
    status: 'idle', 
    message: '',
    showPassword: false
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [userData, setUserData] = useState({ nombre: 'Usuario detectado', rol: '', foto: '' });
  const [alert, setAlert] = useState({ visible: false, title: '', message: '' });

  // Descarga la lista en 2do plano apenas se abre la web
  useEffect(() => {
    const cargarUsuarios = async () => {
      // También traemos el estado por si acaso lo necesitamos luego
      const { data } = await supabase.from('empleados').select('dni, usuario, nombre, rol, foto_url, estado');
      if (data) setUsuariosCache(data);
    };
    cargarUsuarios();
  }, []);

  // OPTIMIZADO: Busca en la memoria local (0 milisegundos de latencia)
  const handleValidacion = () => {
    const userTrim = usuario.trim().toLowerCase();
    if (userTrim.length < 2) return;

    // Buscamos en la lista descargada en lugar de ir a internet
    const encontrado = usuariosCache.find(
      emp => (emp.usuario && emp.usuario.toLowerCase() === userTrim) || emp.dni === userTrim
    );

    if (encontrado) {
      setUserData({
        nombre: encontrado.nombre,
        rol: encontrado.rol,
        foto: encontrado.foto_url || FOTO_PLACEHOLDER
      });
      setUiState({ status: 'valid', message: '', showPassword: true });
    } else {
      setUserData({ nombre: 'Usuario no disponible', rol: 'Verifique el usuario', foto: '' });
      setUiState({ status: 'error', message: '', showPassword: false });
    }
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    if (!usuario || !password) return;
    setIsSubmitting(true);

    try {
      const userTrim = usuario.trim();
      // Buscamos cuál es su usuario de letras oficial para hacer login
      const emp = usuariosCache.find(u => u.dni === userTrim || (u.usuario && u.usuario.toLowerCase() === userTrim.toLowerCase()));
      
      const codigoLogin = emp && emp.usuario ? emp.usuario : userTrim;
      const emailToLogin = codigoLogin.includes('@') ? codigoLogin : `${codigoLogin}@hco.com`;

      const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
        email: emailToLogin,
        password: password
      });

      if (authError) {
        setAlert({ visible: true, title: 'Acceso denegado', message: 'Contraseña incorrecta' });
        setIsSubmitting(false);
        return;
      }

      // Traemos el perfil completo para el LocalStorage
      const { data: perfilData, error: perfilError } = await supabase
        .from('empleados')
        .select('*')
        .eq('id', authData.user.id)
        .single();

      if (perfilError) throw perfilError;

      // ==========================================
      // LÓGICA DE BLOQUEO DE USUARIOS INACTIVOS
      // ==========================================
      if (perfilData.estado && perfilData.estado.toLowerCase() === 'inactivo') {
        await supabase.auth.signOut(); // Cerramos su sesión en la bóveda
        setAlert({ 
          visible: true, 
          title: 'Acceso denegado', 
          message: 'Tu cuenta ha sido desactivada. Comunícate con el administrador.' 
        });
        setIsSubmitting(false); // Volvemos a habilitar el botón
        return; // Detenemos el proceso aquí, NO entra al sistema
      }
      // ==========================================

      // Si pasa la validación y está Activo, lo dejamos entrar
      localStorage.setItem("authUser", JSON.stringify(perfilData));
      navigate('/menu'); 

    } catch (error) {
      console.error(error);
      setAlert({ visible: true, title: 'Error', message: 'Error de red al intentar conectar.' });
      setIsSubmitting(false);
    }
  };

  return (
    <div className="login-container-global">
      <div className="contenedor-login">
        <div className="tarjeta-login">
          <div className="cabecera-login">
            <div className="linea-superior"></div>
            <h1>Iniciar sesión</h1>
          </div>

          <form onSubmit={handleLogin}>
            <label>Usuario</label>
            <input
              type="text"
              placeholder="Ingrese usuario o DNI"
              value={usuario}
              onChange={(e) => {
                setUsuario(e.target.value);
                setUiState({ status: 'idle', message: '', showPassword: false });
              }}
              onBlur={handleValidacion}
              required
              disabled={isSubmitting}
            />

            {uiState.status === 'loadingUser' && (
              <div className="estado-validacion">
                <span className="spinner"></span>
                <span>{uiState.message}</span>
              </div>
            )}

            {(uiState.status === 'valid' || uiState.status === 'error') && (
              <div className={`vista-usuario ${uiState.status === 'error' ? 'error-usuario' : ''}`}>
                <div className="foto-box">
                  <img 
                    src={userData.foto || FOTO_PLACEHOLDER} 
                    onError={(e) => { e.target.src = FOTO_PLACEHOLDER }} 
                    alt="Foto" 
                  />
                </div>
                <div className="datos-usuario">
                  <div className="nombre-usuario">{userData.nombre}</div>
                  <div className="rol-usuario">{userData.rol}</div>
                </div>
              </div>
            )}

            {uiState.showPassword && (
              <div id="seccionPassword">
                <label>Contraseña</label>
                <input
                  type="password"
                  placeholder="Ingrese su contraseña"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoFocus
                  required
                  disabled={isSubmitting}
                />
                <button 
                  type="submit" 
                  className={isSubmitting ? "btn-cargando" : ""} 
                  disabled={isSubmitting}
                >
                  {isSubmitting ? 'Ingresando...' : 'Ingresar'}
                </button>
              </div>
            )}
          </form>
        </div>
      </div>

      {alert.visible && (
        <div className="custom-alert" onClick={() => setAlert({ ...alert, visible: false })}>
          <div className="custom-alert-box" onClick={(e) => e.stopPropagation()}>
            <div className="custom-alert-icon">!</div>
            <h3>{alert.title}</h3>
            <p>{alert.message}</p>
            <button type="button" id="customAlertBtn" onClick={() => setAlert({ ...alert, visible: false })}>Aceptar</button>
          </div>
        </div>
      )}
    </div>
  );
}
