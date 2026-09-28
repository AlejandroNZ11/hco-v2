import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, Outlet, useLocation, useNavigate } from "react-router-dom";
import {
  FaHome,
  FaSyncAlt,
  FaCog,
  FaKey,
  FaSignOutAlt,
  FaExchangeAlt,
  FaArrowLeft,
} from "react-icons/fa";

// IMPORTANTE: Importamos Supabase para el cambio de contraseña real
import { supabase } from "../supabaseClient";
import "./MainLayout.css";

const LOGIN_URL = "/";
const MENU_URL = "/menu";
const ADMIN_URL = "/almuerzos/admin";

function getStoredAuthUser() {
  const local = localStorage.getItem("authUser");
  const session = sessionStorage.getItem("authUser");
  const raw = local || session;

  if (!raw) return null;

  try {
    return JSON.parse(raw);
  } catch {
    localStorage.removeItem("authUser");
    sessionStorage.removeItem("authUser");
    return null;
  }
}

function syncSessionFromLocal(user) {
  const text = JSON.stringify(user);
  localStorage.setItem("authUser", text);
  sessionStorage.setItem("authUser", text);
}

function obtenerIniciales(nombre) {
  const partes = String(nombre || "").trim().split(/\s+/).filter(Boolean);
  if (!partes.length) return "US";
  if (partes.length === 1) return partes[0].slice(0, 2).toUpperCase();
  return `${partes[0][0]}${partes[1][0]}`.toUpperCase();
}

function convertirGoogleDriveUrl(url) {
  if (!url || typeof url !== "string") return "";
  const cleanUrl = url.trim();
  const matchFile = cleanUrl.match(/\/file\/d\/([^/]+)/);
  if (matchFile?.[1]) {
    return `https://drive.google.com/thumbnail?id=${matchFile[1]}&sz=w200`;
  }
  const matchId = cleanUrl.match(/[?&]id=([^&]+)/);
  if (matchId?.[1]) {
    return `https://drive.google.com/thumbnail?id=${matchId[1]}&sz=w200`;
  }
  return cleanUrl;
}

function obtenerFuentesFoto(user) {
  return [
    user?.foto_url, // <-- AGREGADO: Nombre exacto de tu columna en Supabase
    user?.fotoDataUrl,
    user?.fotoWeb,
    user?.foto,
    user?.fotoUrl,
    user?.urlFoto,
    user?.imagen,
    user?.avatar,
    user?.photo,
    user?.picture,
  ]
    .map((v) => (typeof v === "string" ? convertirGoogleDriveUrl(v) : ""))
    .filter(Boolean);
}

function leerCountLocal() {
  return Number(localStorage.getItem("offlineAnomaliasCount") || "0");
}

export default function MainLayout() {
  const location = useLocation();
  const navigate = useNavigate();

  const [authUser] = useState(() => getStoredAuthUser());

  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [showLogoutModal, setShowLogoutModal] = useState(false);
  const [showPasswordModal, setShowPasswordModal] = useState(false);

  const [nuevaPassword, setNuevaPassword] = useState("");
  const [passwordAlert, setPasswordAlert] = useState(null);
  const [passwordLoading, setPasswordLoading] = useState(false);

  const [pendingCount, setPendingCount] = useState(leerCountLocal());
  const [syncLoading, setSyncLoading] = useState(false);

  const [photoIndex, setPhotoIndex] = useState(0);
  const [photoLoaded, setPhotoLoaded] = useState(false);

  const userMenuRef = useRef(null);

  const currentPage = useMemo(() => {
    return location.pathname
      .toLowerCase()
      .replace(/\/$/, "")
      .replace(/\.html$/, "");
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

  // --- CORRECCIÓN EN LA EXTRACCIÓN DE DATOS DE SUPABASE ---
  const nombreUsuario = String(authUser?.nombre || "Usuario").trim();
  // Extraemos el nombre del cargo si viene como objeto relacional, sino usamos el texto plano
  const cargoRaw = authUser?.cargo?.nombre || authUser?.cargo || "Sin cargo asignado";
  const cargoUsuario = String(cargoRaw).trim();
  const rolUsuario = String(authUser?.rol || "").trim().toUpperCase();
  
  const inicialesUsuario = obtenerIniciales(nombreUsuario);
  const fuentesFoto = useMemo(() => obtenerFuentesFoto(authUser), [authUser]);
  const photoSrc = fuentesFoto[photoIndex] || "";

  const puedeAdministrar = (rolUsuario === "SUPERADMIN" || rolUsuario === "SUPERVISOR") && isPedidosPage;

  useEffect(() => {
    if (!authUser) {
      navigate(LOGIN_URL, { replace: true });
      return;
    }
    syncSessionFromLocal(authUser);
  }, [authUser, navigate]);

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

  // ========================================================
  // FUNCIONES DE SINCRONIZACIÓN (Pendientes de migrar API)
  // ========================================================
  const actualizarBadgePendientes = useCallback((count) => {
    setPendingCount(Number(count || 0));
  }, []);

  const refrescarPendientesCabecera = useCallback(async () => {
    try {
      if (window.offlineQueue && typeof window.offlineQueue.refreshPendingCount === "function") {
        const count = await window.offlineQueue.refreshPendingCount();
        actualizarBadgePendientes(count);
        return;
      }
    } catch (error) {
      console.error("No se pudo refrescar pendientes:", error);
    }
    actualizarBadgePendientes(leerCountLocal());
  }, [actualizarBadgePendientes]);

  const sincronizarPendientesDesdeCabecera = useCallback(async (esAutomatico = false) => {
    // Mantenemos la lógica de anomalías hasta que migres ese módulo específico
    if (!window.offlineQueue || typeof window.offlineQueue.syncPendingAnomalias !== "function") {
      actualizarBadgePendientes(leerCountLocal());
      return;
    }
    if (!navigator.onLine) {
      if (!esAutomatico) alert("No hay conexión a internet.");
      return;
    }
    setSyncLoading(true);
    try {
      // Reemplazar URL por la de Supabase cuando migres Anomalías
      const result = await window.offlineQueue.syncPendingAnomalias("PENDIENTE_DE_MIGRAR_API");
      actualizarBadgePendientes(result.pending);
      if (!esAutomatico) {
        if (result.synced > 0 && result.failed === 0) alert(`Se sincronizaron ${result.synced} registros pendientes.`);
        else if (result.synced > 0 || result.failed > 0) alert(`Sincronizados: ${result.synced} | Pendientes: ${result.pending}`);
        else alert("No hay registros pendientes por sincronizar.");
      }
    } catch (error) {
      console.error("Error sincronizando pendientes:", error);
      if (!esAutomatico) alert("No se pudo sincronizar en este momento.");
    } finally {
      setSyncLoading(false);
    }
  }, [actualizarBadgePendientes]);

  useEffect(() => {
    if (!authUser) return;
    refrescarPendientesCabecera();
    function handleQueueCount(event) { actualizarBadgePendientes(Number(event?.detail?.count || 0)); }
    function handleOnline() { sincronizarPendientesDesdeCabecera(true); }
    window.addEventListener("offline-queue-count", handleQueueCount);
    window.addEventListener("online", handleOnline);
    return () => {
      window.removeEventListener("offline-queue-count", handleQueueCount);
      window.removeEventListener("online", handleOnline);
    };
  }, [authUser, refrescarPendientesCabecera, actualizarBadgePendientes, sincronizarPendientesDesdeCabecera]);

  // ========================================================
  // ACCIONES DE USUARIO
  // ========================================================
  function ejecutarCierreSesion() {
    localStorage.removeItem("authUser");
    sessionStorage.removeItem("authUser");
    supabase.auth.signOut(); // Cierra sesión oficial en Supabase
    navigate(LOGIN_URL, { replace: true });
  }

  function abrirModalPassword() {
    setDropdownOpen(false);
    setNuevaPassword("");
    setPasswordAlert(null);
    setShowPasswordModal(true);
  }

  // NUEVA FUNCIÓN: Usa Supabase Auth en lugar de Apps Script
  async function guardarPassword() {
    const nuevaPass = String(nuevaPassword || "").trim();

    if (!nuevaPass || nuevaPass.length < 6) { // Supabase pide mín 6 caracteres
      setPasswordAlert({
        message: "La contraseña debe tener al menos 6 caracteres.",
        type: "alert-danger",
      });
      return;
    }

    setPasswordLoading(true);

    try {
      const { error } = await supabase.auth.updateUser({
        password: nuevaPass
      });

      if (error) throw error;

      setPasswordAlert({
        message: "¡Contraseña actualizada exitosamente!",
        type: "alert-success",
      });

      setTimeout(() => {
        setShowPasswordModal(false);
        setPasswordLoading(false);
        setNuevaPassword("");
      }, 1500);

    } catch (error) {
      console.error("Error al cambiar contraseña:", error);
      setPasswordAlert({
        message: error.message || "Error al cambiar la contraseña.",
        type: "alert-danger",
      });
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
                onClick={() => sincronizarPendientesDesdeCabecera(false)}
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
                  <form onSubmit={(e) => { e.preventDefault(); guardarPassword(); }}>
                    <div className="mb-3">
                      <label className="form-label fw-bold">Ingrese nueva contraseña (Mín. 6)</label>
                      <input
                        type="password"
                        className="form-control text-center"
                        placeholder="••••••••"
                        required
                        value={nuevaPassword}
                        onChange={(e) => setNuevaPassword(e.target.value)}
                      />
                    </div>
                  </form>
                </div>
                <div className="modal-footer border-0 justify-content-center bg-light">
                  <button type="button" className="btn btn-secondary px-4 fw-bold" onClick={() => setShowPasswordModal(false)}>Cancelar</button>
                  <button type="button" className="btn btn-primary px-4 fw-bold" disabled={passwordLoading} onClick={guardarPassword}>
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
