import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import './Login.css';

const APP_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbw4EHmCBr5HKvZ1S2ugMD_FFNj5g5PGmF8Y8iZVEZQz9YmQZug85CjKzA8Wc8uEquBz/exec";

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
  
  // Separamos el estado de validación y el de envío para que la foto no se borre
  const [uiState, setUiState] = useState({
    status: 'idle', 
    message: '',
    showPassword: false
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  
  const [userData, setUserData] = useState({ nombre: 'Usuario detectado', rol: '', foto: '' });
  const [alert, setAlert] = useState({ visible: false, title: '', message: '' });

  const handleValidacion = async () => {
    const userTrim = usuario.trim();
    if (userTrim.length < 2) return;

    setUiState({ status: 'loadingUser', message: 'Cargando...', showPassword: false });

    try {
      const url = `${APP_SCRIPT_URL}?action=previewUser&usuario=${encodeURIComponent(userTrim)}&_=${Date.now()}`;
      const response = await fetch(url, { method: "GET" });
      const data = await response.json();

      if (data.ok && data.found && data.user) {
        setUserData({
          nombre: data.user.nombre,
          rol: data.user.rol,
          foto: data.user.fotoDataUrl || data.user.fotoWeb || data.user.foto || FOTO_PLACEHOLDER
        });
        setUiState({ status: 'valid', message: '', showPassword: true });
      } else {
        setUserData({ nombre: 'Usuario no disponible', rol: 'Verifique el usuario', foto: '' });
        setUiState({ status: 'error', message: '', showPassword: false });
      }
    } catch (error) {
      setUserData({ nombre: 'Error de validación', rol: 'Intente nuevamente', foto: '' });
      setUiState({ status: 'error', message: '', showPassword: false });
    }
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    if (!usuario || !password) {
      setAlert({ visible: true, title: 'Campos requeridos', message: 'Ingrese usuario y contraseña.' });
      return;
    }

    setIsSubmitting(true);

    try {
      const response = await fetch(APP_SCRIPT_URL, {
        method: "POST",
        body: JSON.stringify({ action: "login", usuario, password })
      });
      const data = await response.json();

      if (data.ok && data.authenticated) {
        localStorage.setItem("authUser", JSON.stringify(data.user));
        navigate('/menu'); 
      } else {
        setAlert({ visible: true, title: 'Acceso denegado', message: data.message || 'Usuario o contraseña incorrectos' });
        setIsSubmitting(false);
      }
    } catch (error) {
      setAlert({ visible: true, title: 'Error', message: 'No se pudo iniciar sesión. Intente nuevamente.' });
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
              placeholder="Ingrese usuario"
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
                  {isSubmitting ? 'Ingresando' : 'Ingresar'}
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
