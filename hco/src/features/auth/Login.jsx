import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';

import {
  obtenerUsuariosParaCache,
  iniciarSesion,
  obtenerPerfilCompleto,
  cerrarSesion,
  obtenerSesionActiva // <- nueva (ver authService)
} from '../../services/authService';

import './Login.css';

const FOTO_PLACEHOLDER = "data:image/svg+xml;charset=UTF-8," + encodeURIComponent(`
  <svg xmlns="http://www.w3.org/2000/svg" width="120" height="120" viewBox="0 0 120 120">
    <rect width="120" height="120" fill="#e2e8f0"/>
    <circle cx="60" cy="46" r="22" fill="#94a3b8"/>
    <path d="M18 120c6-26 24-38 42-38s36 12 42 38z" fill="#94a3b8"/>
  </svg>
`);

const KEY_RECORDAR = 'hco_recordar';
const KEY_BIO = 'hco_bio';

const PERFIL_VACIO = { estado: 'idle', nombre: 'Bienvenido', rol: 'Ingresa tu usuario', foto: '' };

/* ---------- Iconos ---------- */
const ICONOS = {
  usuario: <><circle cx="12" cy="8" r="4" /><path d="M4 21c0-4 4-7 8-7s8 3 8 7" /></>,
  candado: <><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /><circle cx="12" cy="16" r="1" /></>,
  ojo: <><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></>,
  ojoOff: <><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /><path d="M4 4l16 16" /></>,
  huella: <>
    <path d="M12 10a2 2 0 0 0-2 2c0 1.02-.1 2.51-.26 4" />
    <path d="M14 13.12c0 2.38 0 6.38-1 8.88" />
    <path d="M17.29 21.02c.12-.6.43-2.3.5-3.02" />
    <path d="M2 12a10 10 0 0 1 18-6" />
    <path d="M2 16h.01" />
    <path d="M21.8 16c.2-2 .131-5.354 0-6" />
    <path d="M5 19.5C5.5 18 6 15 6 12a6 6 0 0 1 .34-2" />
    <path d="M8.65 22c.21-.66.45-1.32.57-2" />
    <path d="M9 6.8a6 6 0 0 1 9 5.2v2" />
  </>,
  faceid: <>
    <path d="M4 8V6a2 2 0 0 1 2-2h2" /><path d="M16 4h2a2 2 0 0 1 2 2v2" />
    <path d="M20 16v2a2 2 0 0 1-2 2h-2" /><path d="M8 20H6a2 2 0 0 1-2-2v-2" />
    <path d="M9 10v1" /><path d="M15 10v1" /><path d="M12 10v3h-1" />
    <path d="M9 15c1.5 1.5 4.5 1.5 6 0" />
  </>
};

const Icono = ({ nombre, className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {ICONOS[nombre]}
  </svg>
);

/* ---------- Helpers ---------- */
// Decide qué icono/nombre de biometría mostrar según el dispositivo
function detectarDispositivo() {
  const ua = navigator.userAgent;
  const esIOS = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (esIOS) return { icono: 'faceid', nombre: 'Face ID' };
  if (/Android/.test(ua)) return { icono: 'huella', nombre: 'tu huella digital' };
  if (/Mac/.test(ua)) return { icono: 'huella', nombre: 'Touch ID' };
  if (/Windows/.test(ua)) return { icono: 'huella', nombre: 'Windows Hello' };
  return { icono: 'huella', nombre: 'la biometría del equipo' };
}

const aB64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const deB64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const aleatorio = () => crypto.getRandomValues(new Uint8Array(32));
const esInactivo = (p) => p?.estado && p.estado.toLowerCase() === 'inactivo';

const buscar = (valor, lista) => {
  const v = valor.trim().toLowerCase();
  return lista.find((e) => (e.usuario && e.usuario.toLowerCase() === v) || e.dni === v);
};

/* ---------- Componente ---------- */
export default function Login() {
  const navigate = useNavigate();
  const dispositivo = useMemo(detectarDispositivo, []);

  const [usuario, setUsuario] = useState('');
  const [password, setPassword] = useState('');
  const [verPassword, setVerPassword] = useState(false);
  const [recordar, setRecordar] = useState(false);
  const [usuariosCache, setUsuariosCache] = useState([]);
  const [perfil, setPerfil] = useState(PERFIL_VACIO);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [alert, setAlert] = useState({ visible: false, title: '', message: '' });
  const [bioSoportado, setBioSoportado] = useState(false);
  const [bioActivo, setBioActivo] = useState(!!localStorage.getItem(KEY_BIO));

  const mostrarAlerta = (title, message) => setAlert({ visible: true, title, message });

  // Muestra la tarjeta del usuario (foto, nombre, rol) buscando en memoria
  const validar = (valor, lista = usuariosCache) => {
    if (valor.trim().length < 2) return setPerfil(PERFIL_VACIO);
    const emp = buscar(valor, lista);
    setPerfil(emp
      ? { estado: 'valid', nombre: emp.nombre, rol: emp.rol, foto: emp.foto_url || FOTO_PLACEHOLDER }
      : { estado: 'error', nombre: 'Usuario no disponible', rol: 'Verifique el usuario', foto: '' });
  };

  useEffect(() => {
    (async () => {
      try {
        const data = await obtenerUsuariosParaCache();
        setUsuariosCache(data);
        const guardado = localStorage.getItem(KEY_RECORDAR);
        if (guardado) {
          setUsuario(guardado);
          setRecordar(true);
          validar(guardado, data);
        }
      } catch (error) {
        console.error('Error al cargar caché visual:', error);
      }
    })();

    // ¿Este dispositivo tiene huella / Face ID / Windows Hello?
    if (window.PublicKeyCredential?.isUserVerifyingPlatformAuthenticatorAvailable) {
      PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()
        .then(setBioSoportado)
        .catch(() => setBioSoportado(false));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const rechazarInactivo = async () => {
    await cerrarSesion();
    localStorage.removeItem(KEY_BIO);
    setBioActivo(false);
    mostrarAlerta('Acceso denegado', 'Tu cuenta ha sido desactivada. Comunícate con el administrador.');
  };

  const entrar = (perfilData) => {
    if (perfilData?.cargos) perfilData.cargo = perfilData.cargos.nombre;
    localStorage.setItem('authUser', JSON.stringify(perfilData));
    navigate('/menu');
  };

  // Registra la biometría del dispositivo (se llama tras un login correcto con "Recordar cuenta")
  const activarBiometria = async (codigo, nombre, userId) => {
    try {
      const cred = await navigator.credentials.create({
        publicKey: {
          challenge: aleatorio(),
          rp: { name: 'HCO' },
          user: { id: new TextEncoder().encode(userId), name: codigo, displayName: nombre || codigo },
          pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
          authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'discouraged' },
          timeout: 60000
        }
      });
      localStorage.setItem(KEY_BIO, JSON.stringify({ usuario: codigo, credId: aB64(cred.rawId) }));
      setBioActivo(true);
    } catch (err) {
      console.warn('Biometría no activada:', err);
    }
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    if (!usuario || !password) return;
    setIsSubmitting(true);

    try {
      const userTrim = usuario.trim();
      const emp = buscar(userTrim, usuariosCache);
      const codigo = emp?.usuario || userTrim;
      const emailToLogin = codigo.includes('@') ? codigo : `${codigo}@hco.com`;

      const authData = await iniciarSesion(emailToLogin, password);
      const perfilData = await obtenerPerfilCompleto(authData.user.id);

      if (esInactivo(perfilData)) {
        await rechazarInactivo();
        setIsSubmitting(false);
        return;
      }

      if (recordar) {
        localStorage.setItem(KEY_RECORDAR, codigo);
        if (bioSoportado && !bioActivo) await activarBiometria(codigo, emp?.nombre, authData.user.id);
      } else {
        localStorage.removeItem(KEY_RECORDAR);
        localStorage.removeItem(KEY_BIO);
        setBioActivo(false);
      }

      entrar(perfilData);
    } catch (error) {
      console.error(error);
      mostrarAlerta('Error de Acceso', error.message || 'Error de red al intentar conectar.');
      setIsSubmitting(false);
    }
  };

  const handleBiometria = async () => {
    const guardado = JSON.parse(localStorage.getItem(KEY_BIO) || 'null');
    if (!guardado) {
      mostrarAlerta(
        `Activa ${dispositivo.nombre}`,
        `Inicia sesión con tu contraseña y marca “Recordar cuenta” para usar ${dispositivo.nombre} en este dispositivo.`
      );
      return;
    }

    setUsuario(guardado.usuario);
    validar(guardado.usuario);
    setIsSubmitting(true);

    try {
      await navigator.credentials.get({
        publicKey: {
          challenge: aleatorio(),
          allowCredentials: [{ type: 'public-key', id: deB64(guardado.credId), transports: ['internal'] }],
          userVerification: 'required',
          timeout: 60000
        }
      });

      const sesion = await obtenerSesionActiva();
      if (!sesion) {
        mostrarAlerta('Sesión vencida', 'Ingresa con tu contraseña para continuar.');
        setIsSubmitting(false);
        return;
      }

      const perfilData = await obtenerPerfilCompleto(sesion.user.id);
      if (esInactivo(perfilData)) {
        await rechazarInactivo();
        setIsSubmitting(false);
        return;
      }
      entrar(perfilData);
    } catch (err) {
      // NotAllowedError = el usuario canceló o no coincidió la huella/rostro
      if (err.name !== 'NotAllowedError') {
        mostrarAlerta('No se pudo verificar', 'Intenta de nuevo o ingresa con tu contraseña.');
      }
      setIsSubmitting(false);
    }
  };

  return (
    <div className="login-container-global">
      <div className="fondo" aria-hidden="true"><span className="fondo-blanco" /></div>

      <main className="login-layout">
        <section className="marca">
          <img className="logo" src="../img/logo_w.png" alt="HCO" />
          <h1>Herramientas de Control Operacional</h1>
        </section>

        <section className="tarjeta-login">
          <div className={`vista-usuario ${perfil.estado === 'error' ? 'error-usuario' : ''}`}>
            <div className="foto-box">
              <img
                src={perfil.foto || FOTO_PLACEHOLDER}
                onError={(e) => { e.currentTarget.src = FOTO_PLACEHOLDER; }}
                alt=""
              />
            </div>
            <div className="nombre-usuario">{perfil.nombre}</div>
            <div className="rol-usuario">{perfil.rol}</div>
          </div>

          <form onSubmit={handleLogin} autoComplete="on">
            <div className="campo">
              <Icono nombre="usuario" className="icono" />
              <input
                type="text"
                name="username"
                autoComplete="username"
                placeholder="Usuario"
                aria-label="Usuario o DNI"
                value={usuario}
                onChange={(e) => {
                  setUsuario(e.target.value);
                  buscar(e.target.value, usuariosCache) ? validar(e.target.value) : setPerfil(PERFIL_VACIO);
                }}
                onBlur={() => validar(usuario)}
                required
                disabled={isSubmitting}
              />
            </div>

            <div className="campo">
              <Icono nombre="candado" className="icono" />
              <input
                type={verPassword ? 'text' : 'password'}
                name="password"
                autoComplete="current-password"
                placeholder="Contraseña"
                aria-label="Contraseña"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                disabled={isSubmitting}
              />
              <button
                type="button"
                className="ojo"
                onClick={() => setVerPassword((v) => !v)}
                aria-label={verPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
              >
                <Icono nombre={verPassword ? 'ojoOff' : 'ojo'} />
              </button>
            </div>

            <label className="recordar">
              <input
                type="checkbox"
                checked={recordar}
                onChange={(e) => setRecordar(e.target.checked)}
                disabled={isSubmitting}
              />
              <span>Recordar cuenta</span>
            </label>
            {bioSoportado && !bioActivo && (
              <p className="ayuda-bio">Se activará {dispositivo.nombre} en este dispositivo.</p>
            )}

            <div className="acciones">
              <button
                type="submit"
                className={`btn-ingresar ${isSubmitting ? 'btn-cargando' : ''}`}
                disabled={isSubmitting}
              >
                {isSubmitting ? 'Ingresando' : 'Iniciar sesión'}
              </button>

              {bioSoportado && (
                <button
                  type="button"
                  className={`btn-bio ${bioActivo ? 'activo' : ''}`}
                  onClick={handleBiometria}
                  disabled={isSubmitting}
                  aria-label={`Ingresar con ${dispositivo.nombre}`}
                  title={`Ingresar con ${dispositivo.nombre}`}
                >
                  <Icono nombre={dispositivo.icono} />
                </button>
              )}
            </div>
          </form>
        </section>
      </main>

      {alert.visible && (
        <div className="custom-alert" onClick={() => setAlert({ ...alert, visible: false })}>
          <div className="custom-alert-box" role="alertdialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <div className="custom-alert-icon">!</div>
            <h3>{alert.title}</h3>
            <p>{alert.message}</p>
            <button type="button" className="alert-btn" autoFocus onClick={() => setAlert({ ...alert, visible: false })}>
              Aceptar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
