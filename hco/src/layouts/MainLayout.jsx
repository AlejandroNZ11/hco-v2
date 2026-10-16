import { useMemo, useRef, useState, useEffect } from "react";
import { Link, Outlet, useLocation, useNavigate } from "react-router-dom";
import {
  FaHome, FaSyncAlt, FaCog, FaKey, FaSignOutAlt, FaExchangeAlt, FaArrowLeft, FaBroom, FaBell
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
  const [showClearCacheModal, setShowClearCacheModal] = useState(false);
  const [showUpdateModal, setShowUpdateModal] = useState(false);


  const userMenuRef = useRef(null);

  const currentPage = useMemo(() => {
    return location.pathname.toLowerCase().replace(/\/$/, "").replace(/\.html$/, "");
  }, [location.pathname]);

const isMenuPage = currentPage === "/menu" || currentPage.includes("/menu-opciones/menu");
  const isPedidosPage = currentPage.includes("/almuerzos/pedidos");

  const { tituloCabecera, subtituloCabecera } = useMemo(() => {
    if (isMenuPage) {
      return { 
        tituloCabecera: "Menú Principal", 
        subtituloCabecera: "Opciones del sistema" 
      };
    }
    return { 
      tituloCabecera: "HCO", 
      subtituloCabecera: "Smart life is automated" 
    };
  }, [isMenuPage]);


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
        const response = await fetch(`/version.json?t=${new Date().getTime()}`);
        const data = await response.json();
        
        const versionLocal = localStorage.getItem('hco_app_version');

        if (!versionLocal) {
          localStorage.setItem('hco_app_version', data.version);
          return;
        }

        if (versionLocal !== data.version) {
          console.warn("¡Nueva versión detectada!");
          // Guardamos temporalmente la nueva versión para aplicarla al cerrar el modal
          localStorage.setItem('hco_nueva_version', data.version);
          setShowUpdateModal(true); // Muestra nuestro modal bonito
        }
      } catch (error) {
        console.log("Modo offline, no se pudo comprobar la versión.");
      }
    }

    comprobarVersion();
    const intervalo = setInterval(comprobarVersion, 15 * 60 * 1000); 
    return () => clearInterval(intervalo);
  }, []);

  function limpiarCacheYActualizar() {
    setDropdownOpen(false);
    // Protección: Evitar que borren la caché si hay datos sin enviar al servidor
    if (pendingCount > 0) {
      alert("⚠️ Tienes registros pendientes por sincronizar. Por favor, haz clic en el botón 'Sincronizar' primero para no perder tu trabajo.");
      return;
    }
    setShowClearCacheModal(true);
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

    async function ejecutarLimpiezaCache() {
    try {
      if ('caches' in window) {
        const nombresCaches = await caches.keys();
        await Promise.all(nombresCaches.map(cache => caches.delete(cache)));
      }
      if ('serviceWorker' in navigator) {
        const registros = await navigator.serviceWorker.getRegistrations();
        for (let registro of registros) {
          await registro.unregister();
        }
      }
      if (window.indexedDB) {
        indexedDB.deleteDatabase('HCO_OfflineDB');
      }
      localStorage.removeItem('popup_almuerzo_cache_v2');
      window.location.reload(true);
    } catch (error) {
      console.error("Error al limpiar la caché:", error);
      alert("Hubo un problema al limpiar la caché. Intenta reiniciar tu navegador.");
    }
  }

  async function aplicarActualizacionYSalir() {
    try {
      if ('caches' in window) {
        const nombresCaches = await caches.keys();
        await Promise.all(nombresCaches.map(cache => caches.delete(cache)));
      }
      if ('serviceWorker' in navigator) {
        const registros = await navigator.serviceWorker.getRegistrations();
        for (let registro of registros) {
          await registro.unregister();
        }
      }

      const nuevaVersion = localStorage.getItem('hco_nueva_version') || '1.0.0';
      localStorage.setItem('hco_app_version', nuevaVersion);
      localStorage.removeItem('hco_nueva_version');

      ejecutarCierreSesion();
      window.location.reload(true);
    } catch (error) {
      console.error("Error al actualizar versión:", error);
      window.location.reload(true);
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

                {/* BOTÓN DE NOTIFICACIONES (Visible en Laptop y Móvil) */}
              <button
                type="button"
                id="notificationBtn"
                className="btn-notificaciones"
                aria-label="Notificaciones"
                title="Notificaciones"
                onClick={() => console.log("Abrir notificaciones")}
              >
                <FaBell className="bell-icon-svg" />
                {/* Punto rojo indicador (puedes ocultarlo si no hay alertas) */}
                <span className="notif-dot"></span>
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
        <>
          <style>{`
            @keyframes floatLogout {
              0%, 100% { transform: translateY(0); }
              50% { transform: translateY(-6px); }
            }
            .animated-logout {
              animation: floatLogout 2.5s ease-in-out infinite;
            }
          `}</style>

          <div className="modal fade show d-block cabecera-modal" tabIndex="-1">
            <div className="modal-dialog modal-dialog-centered px-3">
              <div className="modal-content border-0 shadow-lg rounded-4 overflow-hidden p-4 bg-white position-relative">
                
                {/* Botón de cerrar discreto en la esquina superior */}
                <div className="position-absolute top-0 end-0 p-3" style={{ zIndex: 10 }}>
                  <button 
                    type="button" 
                    className="btn-close shadow-none" 
                    onClick={() => setShowLogoutModal(false)}
                    aria-label="Cerrar"
                  ></button>
                </div>

                {/* Icono de salida con animación flotante y fondo rojo suave */}
                <div className="text-center pt-3 pb-2">
                  <div className="d-inline-flex align-items-center justify-content-center text-danger rounded-circle shadow-sm animated-logout" style={{ width: '60px', height: '60px', fontSize: '24px', background: 'rgba(229, 47, 71, 0.1)' }}>
                    <FaSignOutAlt />
                  </div>
                </div>

                {/* Título */}
                <div className="text-center px-3 pb-2">
                  <h4 className="fw-bold text-dark m-0" style={{ fontSize: '19px' }}>
                    Cerrar Sesión
                  </h4>
                </div>

                {/* Cuerpo del mensaje */}
                <div className="modal-body text-center px-2 py-2">
                  <p className="text-muted fs-6 mb-0" style={{ lineHeight: '1.5' }}>
                    ¿Estás seguro que deseas cerrar tu sesión actual?
                  </p>
                </div>

                {/* Botones inferiores armónicos y de tamaño ideal para móvil */}
                <div className="modal-footer border-0 justify-content-center gap-2 pb-2 pt-3">
                  <button 
                    type="button" 
                    className="btn px-4 py-2.5 fw-bold text-secondary bg-light border-0 shadow-sm" 
                    style={{ fontSize: '14px', borderRadius: '12px' }}
                    onClick={() => setShowLogoutModal(false)}
                  >
                    Cancelar
                  </button>
                  <button 
                    type="button" 
                    className="btn px-4 py-2.5 fw-bold text-white shadow-sm" 
                    style={{ 
                      background: '#e52f47', 
                      fontSize: '14px', 
                      borderRadius: '12px' 
                    }}
                    onClick={ejecutarCierreSesion}
                  >
                    Sí, salir
                  </button>
                </div>

              </div>
            </div>
          </div>
          <div className="modal-backdrop fade show cabecera-modal-backdrop" style={{ backdropFilter: 'blur(4px)', background: 'rgba(0,0,0,0.6)' }}></div>
        </>
      )}

      {showPasswordModal && (
        <>
          <style>{`
            @keyframes floatKey {
              0%, 100% { transform: translateY(0) rotate(0deg); }
              50% { transform: translateY(-6px) rotate(-5deg); }
            }
            .animated-key {
              animation: floatKey 2.5s ease-in-out infinite;
            }
          `}</style>

          <div className="modal fade show d-block cabecera-modal" tabIndex="-1">
            <div className="modal-dialog modal-dialog-centered px-3">
              <div className="modal-content border-0 shadow-lg rounded-4 overflow-hidden p-4 bg-white position-relative">
                
                {/* Botón de cerrar discreto en la esquina superior */}
                <div className="position-absolute top-0 end-0 p-3" style={{ zIndex: 10 }}>
                  <button 
                    type="button" 
                    className="btn-close shadow-none" 
                    onClick={() => setShowPasswordModal(false)}
                    aria-label="Cerrar"
                  ></button>
                </div>

                {/* Icono de llave con animación flotante y colores corporativos */}
                <div className="text-center pt-3 pb-2">
                  <div className="d-inline-flex align-items-center justify-content-center text-white rounded-circle shadow-sm animated-key" style={{ width: '60px', height: '60px', fontSize: '24px', background: 'linear-gradient(135deg, #0b3055 0%, #0d3a66 100%)' }}>
                    <FaKey />
                  </div>
                </div>

                {/* Título */}
                <div className="text-center px-3 pb-2">
                  <h4 className="fw-bold text-dark m-0" style={{ fontSize: '19px' }}>
                    Cambiar Contraseña
                  </h4>
                </div>

                {/* Cuerpo del formulario */}
                <div className="modal-body py-3">
                  {passwordAlert && (
                    <div className={`alert ${passwordAlert.type} text-center fw-bold rounded-3 py-2 fs-6`}>
                      {passwordAlert.message}
                    </div>
                  )}
                  <form onSubmit={(e) => { e.preventDefault(); handleGuardarPassword(); }}>
                    <div className="mb-2">
                      <label className="form-label text-muted fw-semibold small d-block text-center mb-2">
                        Ingrese nueva contraseña (Mín. 6 caracteres)
                      </label>
                      <input
                        type="password"
                        className="form-control text-center py-2.5 shadow-none border-secondary-subtle"
                        style={{ borderRadius: '12px', fontSize: '16px' }}
                        placeholder="******"
                        required
                        value={nuevaPassword}
                        onChange={(e) => setNuevaPassword(e.target.value)}
                      />
                    </div>
                  </form>
                </div>

                {/* Botones inferiores armónicos */}
                <div className="modal-footer border-0 justify-content-center gap-2 pb-2 pt-2">
                  <button 
                    type="button" 
                    className="btn px-4 py-2.5 fw-bold text-secondary bg-light border-0 shadow-sm" 
                    style={{ fontSize: '14px', borderRadius: '12px' }}
                    onClick={() => setShowPasswordModal(false)}
                  >
                    Cancelar
                  </button>
                  <button 
                    type="button" 
                    className="btn px-4 py-2.5 fw-bold text-white shadow-sm" 
                    style={{ 
                      background: 'linear-gradient(135deg, #0b3055 0%, #0d3a66 100%)', 
                      fontSize: '14px', 
                      borderRadius: '12px' 
                    }}
                    disabled={passwordLoading} 
                    onClick={handleGuardarPassword}
                  >
                    {passwordLoading ? "Actualizando..." : "Actualizar"}
                  </button>
                </div>

              </div>
            </div>
          </div>
          <div className="modal-backdrop fade show cabecera-modal-backdrop" style={{ backdropFilter: 'blur(4px)', background: 'rgba(0,0,0,0.6)' }}></div>
        </>
      )}

      {showClearCacheModal && (
        <>
          <style>{`
            @keyframes floatIcon {
              0%, 100% { transform: translateY(0); }
              50% { transform: translateY(-6px); }
            }
            .animated-broom {
              animation: floatIcon 2.5s ease-in-out infinite;
            }
          `}</style>

          <div className="modal fade show d-block cabecera-modal" tabIndex="-1">
            <div className="modal-dialog modal-dialog-centered px-3">
              <div className="modal-content border-0 shadow-lg rounded-4 overflow-hidden p-4 bg-white position-relative">
                
                {/* Botón de cerrar discreto en la esquina superior */}
                <div className="position-absolute top-0 end-0 p-3" style={{ zIndex: 10 }}>
                  <button 
                    type="button" 
                    className="btn-close shadow-none" 
                    onClick={() => setShowClearCacheModal(false)}
                    aria-label="Cerrar"
                  ></button>
                </div>

                {/* Icono de escoba con animación flotante y celeste profesional */}
                <div className="text-center pt-3 pb-2">
                  <div className="d-inline-flex align-items-center justify-content-center text-white rounded-circle shadow-sm animated-broom" style={{ width: '60px', height: '60px', fontSize: '24px', background: 'linear-gradient(135deg, #0284c7 0%, #0369a1 100%)' }}>
                    <FaBroom />
                  </div>
                </div>

                {/* Título */}
                <div className="text-center px-3 pb-2">
                  <h4 className="fw-bold text-dark m-0" style={{ fontSize: '19px' }}>
                    Limpiar Caché y Actualizar
                  </h4>
                </div>

                {/* Cuerpo del mensaje */}
                <div className="modal-body text-center px-2 py-2">
                  <p className="text-muted fs-6 mb-0" style={{ lineHeight: '1.5' }}>
                    ¿Deseas limpiar la memoria de la aplicación? Esto descargará la versión más reciente del sistema y solucionará problemas visuales.
                  </p>
                </div>

                {/* Botones inferiores con estilo sobrio y esquinas de 12px */}
                <div className="modal-footer border-0 justify-content-center gap-2 pb-2 pt-3">
                  <button 
                    type="button" 
                    className="btn px-4 py-2.5 fw-bold text-secondary bg-light border-0 shadow-sm" 
                    style={{ fontSize: '14px', borderRadius: '12px' }}
                    onClick={() => setShowClearCacheModal(false)}
                  >
                    Cancelar
                  </button>
                  <button 
                    type="button" 
                    className="btn px-4 py-2.5 fw-bold text-white shadow-sm" 
                    style={{ 
                      background: 'linear-gradient(135deg, #0284c7 0%, #0369a1 100%)', 
                      fontSize: '14px', 
                      borderRadius: '12px' 
                    }}
                    onClick={ejecutarLimpiezaCache}
                  >
                    Sí, limpiar y actualizar
                  </button>
                </div>

              </div>
            </div>
          </div>
          <div className="modal-backdrop fade show cabecera-modal-backdrop" style={{ backdropFilter: 'blur(4px)', background: 'rgba(0,0,0,0.6)' }}></div>
        </>
      )}

      {showUpdateModal && (
        <>
          <style>{`
            @keyframes floatRocket {
              0%, 100% { transform: translateY(0); }
              50% { transform: translateY(-8px); }
            }
            .animated-rocket {
              animation: floatRocket 2.5s ease-in-out infinite;
            }
          `}</style>
          
          <div className="modal fade show d-block cabecera-modal" tabIndex="-1">
            <div className="modal-dialog modal-dialog-centered px-3">
              <div className="modal-content border-0 shadow-lg rounded-4 overflow-hidden p-4 bg-white">
                
                {/* Icono con animación de movimiento */}
                <div className="text-center pt-3 pb-2">
                  <div className="d-inline-flex align-items-center justify-content-center bg-primary bg-opacity-10 text-primary rounded-circle animated-rocket" style={{ width: '64px', height: '64px', fontSize: '28px' }}>
                    🚀
                  </div>
                </div>

                {/* Título */}
                <div className="text-center px-3 pb-2">
                  <h4 className="fw-bold text-dark m-0" style={{ fontSize: '20px' }}>
                    Actualización Disponible
                  </h4>
                </div>

                {/* Cuerpo del mensaje */}
                <div className="modal-body text-center px-2 py-2">
                  <p className="text-muted fs-6 mb-0" style={{ lineHeight: '1.5' }}>
                    Hemos implementado mejoras importantes en el sistema. Tu sesión se cerrará de forma segura para aplicar los cambios y sincronizar la nueva versión.
                  </p>
                </div>

                {/* Botón inferior con menos curvatura (borderRadius: 12px) */}
                <div className="modal-footer border-0 justify-content-center pb-2 pt-3">
                  <button 
                    type="button" 
                    className="btn w-100 py-3 fw-bold shadow-sm text-white" 
                    style={{ 
                      background: 'linear-gradient(135deg, #0b3055 0%, #0d3a66 100%)', 
                      fontSize: '15px', 
                      borderRadius: '12px' 
                    }}
                    onClick={aplicarActualizacionYSalir}
                  >
                    ACTUALIZAR
                  </button>
                </div>

              </div>
            </div>
          </div>
          <div className="modal-backdrop fade show cabecera-modal-backdrop" style={{ backdropFilter: 'blur(4px)', background: 'rgba(0,0,0,0.6)' }}></div>
        </>
      )}

    </div>
  );
}