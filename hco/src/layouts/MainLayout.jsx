import { useMemo, useRef, useState, useEffect } from "react";
import { Link, Outlet, useLocation, useNavigate } from "react-router-dom";
import {
  FaHome, FaSyncAlt, FaCog, FaKey, FaSignOutAlt, FaExchangeAlt, FaArrowLeft, FaBroom
} from "react-icons/fa";

import "./MainLayout.css";

// Importamos nuestros custom hooks y utilidades
import { useAuth } from "../hooks/useAuth";
import { useSync } from "../hooks/useSync";
import { obtenerIniciales, obtenerFuentesFoto } from "../utils/helpers";

const MENU_URL = "/menu";
const ADMIN_URL = "/almuerzos/admin";

export default function MainLayout() {
  const location = useLocation();
  const navigate = useNavigate();

  // 1. Usar nuestros custom hooks
  const { authUser, ejecutarCierreSesion, cambiarPassword } = useAuth();
  const { pendingCount, syncLoading, sincronizarPendientes } = useSync(authUser);

  // 2. Estados locales de la UI
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [showLogoutModal, setShowLogoutModal] = useState(false);
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [nuevaPassword, setNuevaPassword] = useState("");
  const [passwordAlert, setPasswordAlert] = useState(null);
  const [passwordLoading, setPasswordLoading] = useState(false);
  const [photoIndex, setPhotoIndex] = useState(0);
  const [photoLoaded, setPhotoLoaded] = useState(false);

  const userMenuRef = useRef(null);

  const currentPage = useMemo(() => {
    return location.pathname.toLowerCase().replace(/\/$/, "").replace(/\.html$/, "");
  }, [location.pathname]);

  const isMenuPage = currentPage === "/menu" || currentPage.includes("/menu-opciones/menu");
  const isPedidosPage = currentPage.includes("/almuerzos/pedidos");
  const isAdminPage = currentPage.includes("/almuerzos/admin");
  const isListaPage = currentPage.includes("/almuerzos/lista_platillo");

  const { tituloCabecera, subtituloCabecera } = useMemo(() => {
    if (isMenuPage) return { tituloCabecera: "Menú Principal", subtituloCabecera: "Opciones del sistema" };
    if (isPedidosPage) return { tituloCabecera: "Almuerzo", subtituloCabecera: "Registro de almuerzos" };
    if (isAdminPage) return { tituloCabecera: "Administración Global", subtituloCabecera: "Supervisión de pedidos y reportes" };
    if (isListaPage) return { tituloCabecera: "Editar Menú", subtituloCabecera: "Gestión semanal de platillos" };
    return { tituloCabecera: "Sistema de Control", subtituloCabecera: "Panel principal de operaciones" };
  }, [isMenuPage, isPedidosPage, isAdminPage, isListaPage]);

  const nombreUsuario = String(authUser?.nombre || "Usuario").trim();
  const cargoRaw = authUser?.cargo?.nombre || authUser?.cargo || "Sin cargo asignado";
  const cargoUsuario = String(cargoRaw).trim();
  const rolUsuario = String(authUser?.rol || "").trim().toUpperCase();
  
  const inicialesUsuario = obtenerIniciales(nombreUsuario);
  const fuentesFoto = useMemo(() => obtenerFuentesFoto(authUser), [authUser]);
  const photoSrc = fuentesFoto[photoIndex] || "";

  const puedeAdministrar = (rolUsuario === "SUPERADMIN" || rolUsuario === "SUPERVISOR") && isPedidosPage;

  useEffect(() => {
    setPhotoIndex(0);
    setPhotoLoaded(false);
  }, [authUser]);

  useEffect(() => {
    setPhotoLoaded(false);
  }, [photoSrc]);

  useEffect(() => {
    if (!dropdownOpen) return;
    function handleClickOutside(event) {
      if (userMenuRef.current && !userMenuRef.current.contains(event.target)) setDropdownOpen(false);
    }
    function handleEscape(event) {
      if (event.key === "Escape") setDropdownOpen(false);
    }
    document.addEventListener("click", handleClickOutside);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("click", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [dropdownOpen]);

  // ==========================================
  // VIGILANTE DE VERSIONES (FORCE UPDATE)
  // ==========================================
  useEffect(() => {
    async function comprobarVersion() {
      try {
        // Le agregamos un timestamp (?t=...) para engañar a la caché y obligar
        // al celular a leer el archivo version.json real del servidor
        const response = await fetch(`/version.json?t=${new Date().getTime()}`);
        const data = await response.json();
        
        const versionLocal = localStorage.getItem('hco_app_version');

        // Si es la primera vez que entra, solo guarda la versión
        if (!versionLocal) {
          localStorage.setItem('hco_app_version', data.version);
          return;
        }

        // ¡SI LA VERSIÓN ES DIFERENTE, OCURRE LA MAGIA!
        if (versionLocal !== data.version) {
          console.warn("¡Nueva versión detectada! Limpiando caché y cerrando sesión...");
          
          alert("🚀 Hemos implementado una nueva actualización importante. Tu sesión se cerrará para aplicar los cambios.");

          // 1. Borramos la caché de HTML, CSS y JS (La basura antigua)
          if ('caches' in window) {
            const nombresCaches = await caches.keys();
            await Promise.all(nombresCaches.map(cache => caches.delete(cache)));
          }

          // 2. Apagamos el Service Worker actual
          if ('serviceWorker' in navigator) {
            const registros = await navigator.serviceWorker.getRegistrations();
            for (let registro of registros) {
              await registro.unregister();
            }
          }

          // 3. Actualizamos el número de versión en el celular
          localStorage.setItem('hco_app_version', data.version);

          // 4. Los expulsamos del sistema (cierra sesión en Supabase y borra authUser)
          ejecutarCierreSesion(); 

          // 5. Recargamos la página forzosamente para que descargue lo nuevo
          window.location.reload(true);
        }
      } catch (error) {
        console.log("Modo offline, no se pudo comprobar la versión.");
      }
    }

    // Comprueba la versión al entrar a la pantalla principal
    comprobarVersion();

    // Opcional: Que el celular compruebe si hay nueva versión cada 15 minutos en segundo plano
    const intervalo = setInterval(comprobarVersion, 15 * 60 * 1000); 
    return () => clearInterval(intervalo);
  }, []);
  
  async function limpiarCacheYActualizar() {
    // Protección: Evitar que borren la caché si hay datos sin enviar al servidor
    if (pendingCount > 0) {
      alert("⚠️ Tienes registros pendientes por sincronizar. Por favor, haz clic en el botón 'Sincronizar' primero para no perder tu trabajo.");
      return;
    }

    const confirmar = window.confirm(
      "¿Deseas limpiar la memoria de la aplicación? Esto descargará la versión más reciente del sistema y solucionará problemas visuales."
    );

    if (!confirmar) return;

    try {
      // 1. Borrar la caché de la PWA (Archivos HTML, CSS, JS e imágenes estancadas)
      if ('caches' in window) {
        const nombresCaches = await caches.keys();
        await Promise.all(nombresCaches.map(cache => caches.delete(cache)));
      }

      // 2. Eliminar el "Service Worker" (El motor que hace funcionar el modo offline)
      if ('serviceWorker' in navigator) {
        const registros = await navigator.serviceWorker.getRegistrations();
        for (let registro of registros) {
          await registro.unregister();
        }
      }

      // 3. Borrar la base de datos local (IndexedDB de Dexie)
      if (window.indexedDB) {
        // Asegúrate de que el nombre coincida con tu db en Dexie (ej. HCO_OfflineDB)
        indexedDB.deleteDatabase('HCO_OfflineDB'); 
      }

      // 4. Limpiar basuras secundarias del localStorage (sin borrar la sesión)
      localStorage.removeItem('popup_almuerzo_cache_v2');

      // 5. Forzar recarga completa saltándose la caché
      window.location.reload(true);
    } catch (error) {
      console.error("Error al limpiar la caché:", error);
      alert("Hubo un problema al limpiar la caché. Intenta reiniciar tu navegador.");
    }
  }

  function abrirModalPassword() {
    setDropdownOpen(false);
    setNuevaPassword("");
    setPasswordAlert(null);
    setShowPasswordModal(true);
  }

  async function handleGuardarPassword() {
    setPasswordLoading(true);
    try {
      await cambiarPassword(nuevaPassword);
      setPasswordAlert({ message: "¡Contraseña actualizada exitosamente!", type: "alert-success" });
      setTimeout(() => {
        setShowPasswordModal(false);
        setPasswordLoading(false);
        setNuevaPassword("");
      }, 1500);
    } catch (error) {
      setPasswordAlert({ message: error.message || "Error al cambiar la contraseña.", type: "alert-danger" });
      setPasswordLoading(false);
    }
  }

  if (!authUser) return null;

  return (
    <div className="layout-wrapper">
      <div id="contenedor-cabecera" className="header-container">
        <div className="header-wrapper">
          <header className="topbar">
            <div className="topbar-left">
              {!isMenuPage && (
                <button type="button" id="backBtn" className="btn-atras" onClick={() => navigate(-1)}>
                  <FaArrowLeft className="back-icon-svg" />
                  <span className="back-text">Atrás</span>
                </button>
              )}
              <div className="brand-block">
                <div className="brand-mark">
                  <img src="/img/logo.png" alt="Logo" />
                </div>
                <div className="brand-text">
                  <h1>{tituloCabecera}</h1>
                  <p>{subtituloCabecera}</p>
                </div>
              </div>
            </div>

            <div className="session-box">
              <div className="session-text">
                <strong>{nombreUsuario}</strong>
                <span className="role-pill">{cargoUsuario}</span>
              </div>

              <div className="user-menu-container" ref={userMenuRef}>
                <button
                  type="button"
                  id="avatarTrigger"
                  className="avatar-trigger"
                  aria-label="Abrir menú de usuario"
                  onClick={(e) => {
                    e.stopPropagation();
                    setDropdownOpen((prev) => !prev);
                  }}
                >
                <div className="session-avatar">
                    {photoSrc && (
                        <img
                        key={photoSrc}
                        id="topUserPhoto"
                        src={photoSrc}
                        alt="Usuario"
                        referrerPolicy="no-referrer"
                        onLoad={() => setPhotoLoaded(true)}
                        onError={() => {
                            setPhotoLoaded(false);
                            setPhotoIndex((prev) => prev + 1 < fuentesFoto.length ? prev + 1 : prev);
                        }}
                        />
                    )}
                    {(!photoSrc || !photoLoaded) && (
                        <div id="topUserInitials" className="session-avatar-fallback">
                        {inicialesUsuario}
                        </div>
                    )}
                </div>
                </button>

                                <div className={`user-dropdown-card ${dropdownOpen ? "active" : ""}`} id="dropdownMenu">
                    <div className="user-dropdown-info">
                        <span className="user-dropdown-name">{nombreUsuario}</span>
                        <span className="user-dropdown-role">{cargoUsuario}</span>
                    </div>
                    <div className="user-dropdown-divider"></div>
                    <button type="button" className="user-dropdown-item" onClick={ejecutarCierreSesion}>
                        <FaExchangeAlt className="user-dropdown-icon" />
                        <span>Cambiar Cuenta</span>
                    </button>
                    <button type="button" className="user-dropdown-item" onClick={abrirModalPassword}>
                        <FaKey className="user-dropdown-icon" />
                        <span>Cambiar Contraseña</span>
                    </button>

                    {/* NUEVO BOTÓN PARA LIMPIAR CACHÉ */}
                    <button type="button" className="user-dropdown-item" onClick={limpiarCacheYActualizar}>
                        <FaBroom className="user-dropdown-icon" style={{ color: '#0284c7' }} />
                        <span>Limpiar Caché y Actualizar</span>
                    </button>

                    <button type="button" className="user-dropdown-item user-dropdown-danger" onClick={() => { setDropdownOpen(false); setShowLogoutModal(true); }}>
                        <FaSignOutAlt className="user-dropdown-icon" />
                        <span>Cerrar sesión</span>
                    </button>
                </div>

              </div>

                <button type="button" id="logoutBtnDesktop" className="logout-btn-desktop header-logout-button" onClick={() => setShowLogoutModal(true)}>
                Cerrar sesión
                </button>
            </div>
          </header>

          <div className="sub-topbar">
            <div className="sub-left">
              <Link to={MENU_URL} className="home-link">
                <FaHome className="layout-icon" />
                <span>PE / 3M</span>
              </Link>
            </div>
            <div className="sub-right">
              <button
                type="button"
                className={`btn-sync-pendientes ${pendingCount > 0 ? "has-pending" : ""} ${syncLoading ? "is-loading" : ""}`}
                title="Sincronizar registros pendientes"
                disabled={syncLoading}
                onClick={() => sincronizarPendientes(false)}
              >
                <FaSyncAlt className="layout-icon" />
                <span className="btn-sync-text">Sincronizar</span>
                <span className={`sync-badge ${pendingCount <= 0 ? "is-hidden" : ""}`}>
                  {pendingCount}
                </span>
              </button>
              {puedeAdministrar && (
                <button type="button" className="btn-administrar" onClick={() => navigate(ADMIN_URL)}>
                  <FaCog className="layout-icon" />
                  <span>Administrar</span>
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      <main className="main-content">
        <Outlet />
      </main>

      {showLogoutModal && (
        <div className="custom-modal-overlay">
            <div className="custom-logout-modal">
                <div className="custom-modal-header custom-modal-danger">
                <h5><FaSignOutAlt /> Cerrar Sesión</h5>
                <button type="button" className="custom-modal-close" onClick={() => setShowLogoutModal(false)}>×</button>
                </div>
                <div className="custom-modal-body">
                ¿Estás seguro que deseas cerrar tu sesión?
                </div>
                <div className="custom-modal-footer">
                <button type="button" className="custom-btn custom-btn-cancel" onClick={() => setShowLogoutModal(false)}>Cancelar</button>
                <button type="button" className="custom-btn custom-btn-danger" onClick={ejecutarCierreSesion}>Sí, salir</button>
                </div>
            </div>
        </div>
        )}

      {showPasswordModal && (
        <>
          <div className="modal fade show d-block cabecera-modal" tabIndex="-1">
            <div className="modal-dialog modal-dialog-centered">
              <div className="modal-content border-0 shadow">
                <div className="modal-header bg-primary text-white border-0">
                  <h5 className="modal-title fw-bold">
                    <FaKey className="modal-title-icon" />
                    Cambiar Contraseña
                  </h5>
                  <button type="button" className="btn-close btn-close-white" onClick={() => setShowPasswordModal(false)}></button>
                </div>
                <div className="modal-body py-4">
                  {passwordAlert && (
                    <div className={`alert ${passwordAlert.type} text-center fw-bold`}>
                      {passwordAlert.message}
                    </div>
                  )}
                  <form onSubmit={(e) => { e.preventDefault(); handleGuardarPassword(); }}>
                    <div className="mb-3">
                      <label className="form-label fw-bold">Ingrese nueva contraseña (Mín. 6)</label>
                      <input
                        type="password"
                        className="form-control text-center"
                        placeholder=""
                        required
                        value={nuevaPassword}
                        onChange={(e) => setNuevaPassword(e.target.value)}
                      />
                    </div>
                  </form>
                </div>
                <div className="modal-footer border-0 justify-content-center bg-light">
                  <button type="button" className="btn btn-secondary px-4 fw-bold" onClick={() => setShowPasswordModal(false)}>Cancelar</button>
                  <button type="button" className="btn btn-primary px-4 fw-bold" disabled={passwordLoading} onClick={handleGuardarPassword}>
                    {passwordLoading ? "Actualizando..." : "Actualizar"}
                  </button>
                </div>
              </div>
            </div>
          </div>
          <div className="modal-backdrop fade show cabecera-modal-backdrop"></div>
        </>
      )}
    </div>
  );
}