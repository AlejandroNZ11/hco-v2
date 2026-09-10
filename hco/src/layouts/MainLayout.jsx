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

import "./MainLayout.css";

const LOGIN_URL = "/";
const MENU_URL = "/menu";
const ADMIN_URL = "/almuerzos/admin";

const APP_SCRIPT_URL_PASSWORD =
  import.meta.env.VITE_APP_SCRIPT_URL_PASSWORD ||
  "https://script.google.com/macros/s/AKfycbw4EHmCBr5HKvZ1S2ugMD_FFNj5g5PGmF8Y8iZVEZQz9YmQZug85CjKzA8Wc8uEquBz/exec";

const APP_SCRIPT_URL_ANOMALIAS =
  import.meta.env.VITE_APP_SCRIPT_URL_ANOMALIAS ||
  "https://script.google.com/macros/s/AKfycbyLDzIgbgG_4st1XAqQfAVxoOqxhZPeU5MEl_tjSxr4c2YJh0mXNk2l9kC05ea2TBkNSQ/exec";

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
    user?.fotoDataUrl,
    user?.fotoWeb,
    user?.foto,
    user?.fotoUrl,
    user?.urlFoto,
    user?.imagen,
    user?.imagenUrl,
    user?.avatar,
    user?.avatarUrl,
    user?.photo,
    user?.photoUrl,
    user?.photoURL,
    user?.picture,
    user?.pictureUrl,
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

  const isMenuPage =
    currentPage === "/menu" || currentPage.includes("/menu-opciones/menu");

  const isPedidosPage = currentPage.includes("/almuerzos/pedidos");
  const isAdminPage = currentPage.includes("/almuerzos/admin");
  const isListaPage = currentPage.includes("/almuerzos/lista_platillo");

  const { tituloCabecera, subtituloCabecera } = useMemo(() => {
    if (isMenuPage) {
      return {
        tituloCabecera: "Menú Principal",
        subtituloCabecera: "Opciones del sistema",
      };
    }

    if (isPedidosPage) {
      return {
        tituloCabecera: "Almuerzo",
        subtituloCabecera: "Registro de almuerzos",
      };
    }

    if (isAdminPage) {
      return {
        tituloCabecera: "Administración Global",
        subtituloCabecera: "Supervisión de pedidos y reportes",
      };
    }

    if (isListaPage) {
      return {
        tituloCabecera: "Editar Menú",
        subtituloCabecera: "Gestión semanal de platillos",
      };
    }

    return {
      tituloCabecera: "Sistema de Control",
      subtituloCabecera: "Panel principal de operaciones",
    };
  }, [isMenuPage, isPedidosPage, isAdminPage, isListaPage]);

  const nombreUsuario = String(authUser?.nombre || "Usuario").trim();
  const cargoUsuario = String(authUser?.cargo || "Sin cargo asignado").trim();
  const rolUsuario = String(authUser?.rol || "").trim().toUpperCase();

  const identificadorUsuario = String(
    authUser?.email || authUser?.dni || authUser?.usuario || ""
  ).trim();

  const inicialesUsuario = obtenerIniciales(nombreUsuario);

  const fuentesFoto = useMemo(() => obtenerFuentesFoto(authUser), [authUser]);
  const photoSrc = fuentesFoto[photoIndex] || "";

  const puedeAdministrar =
    (rolUsuario === "SUPERADMIN" || rolUsuario === "SUPERVISOR") &&
    isPedidosPage;

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
  if (!authUser) return;

  if (window.__pushFirebaseScriptsLoaded) return;
  window.__pushFirebaseScriptsLoaded = true;

  const scripts = [
    "/vendor/firebase/firebase-app-compat.js",
    "/vendor/firebase/firebase-messaging-compat.js",
    "/part/firebaseConfig.js",
    "/part/pushAlmuerzo.js",
  ];

  function loadNext(index) {
    if (index >= scripts.length) return;

    const script = document.createElement("script");
    script.src = `${scripts[index]}?v=3`;
    script.defer = true;

    script.onload = () => {
      loadNext(index + 1);
    };

    script.onerror = () => {
      console.error("No se pudo cargar:", scripts[index]);
    };

    document.head.appendChild(script);
  }

  loadNext(0);
}, [authUser]);



  useEffect(() => {
    if (!dropdownOpen) return;

    function handleClickOutside(event) {
      if (userMenuRef.current && !userMenuRef.current.contains(event.target)) {
        setDropdownOpen(false);
      }
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

  const actualizarBadgePendientes = useCallback((count) => {
    setPendingCount(Number(count || 0));
  }, []);

  const refrescarPendientesCabecera = useCallback(async () => {
    try {
      if (
        window.offlineQueue &&
        typeof window.offlineQueue.refreshPendingCount === "function"
      ) {
        const count = await window.offlineQueue.refreshPendingCount();
        actualizarBadgePendientes(count);
        return;
      }
    } catch (error) {
      console.error("No se pudo refrescar pendientes:", error);
    }

    actualizarBadgePendientes(leerCountLocal());
  }, [actualizarBadgePendientes]);

  const sincronizarPendientesDesdeCabecera = useCallback(
    async (esAutomatico = false) => {
      if (
        !window.offlineQueue ||
        typeof window.offlineQueue.syncPendingAnomalias !== "function"
      ) {
        actualizarBadgePendientes(leerCountLocal());
        return;
      }

      if (!navigator.onLine) {
        if (!esAutomatico) alert("No hay conexión a internet.");
        return;
      }

      setSyncLoading(true);

      try {
        const result = await window.offlineQueue.syncPendingAnomalias(
          APP_SCRIPT_URL_ANOMALIAS
        );

        actualizarBadgePendientes(result.pending);

        if (!esAutomatico) {
          if (result.synced > 0 && result.failed === 0) {
            alert(`Se sincronizaron ${result.synced} registros pendientes.`);
          } else if (result.synced > 0 || result.failed > 0) {
            alert(`Sincronizados: ${result.synced} | Pendientes: ${result.pending}`);
          } else {
            alert("No hay registros pendientes por sincronizar.");
          }
        }
      } catch (error) {
        console.error("Error sincronizando pendientes:", error);
        if (!esAutomatico) alert("No se pudo sincronizar en este momento.");
      } finally {
        setSyncLoading(false);
      }
    },
    [actualizarBadgePendientes]
  );

  useEffect(() => {
    if (!authUser) return;

    refrescarPendientesCabecera();

    function handleQueueCount(event) {
      const detail = event?.detail || {};
      actualizarBadgePendientes(Number(detail.count || 0));
    }

    function handleOnline() {
      sincronizarPendientesDesdeCabecera(true);
    }

    window.addEventListener("offline-queue-count", handleQueueCount);
    window.addEventListener("online", handleOnline);

    return () => {
      window.removeEventListener("offline-queue-count", handleQueueCount);
      window.removeEventListener("online", handleOnline);
    };
  }, [
    authUser,
    refrescarPendientesCabecera,
    actualizarBadgePendientes,
    sincronizarPendientesDesdeCabecera,
  ]);

  function ejecutarCierreSesion() {
    localStorage.removeItem("authUser");
    sessionStorage.removeItem("authUser");
    navigate(LOGIN_URL, { replace: true });
  }

  function abrirModalPassword() {
    setDropdownOpen(false);
    setNuevaPassword("");
    setPasswordAlert(null);
    setShowPasswordModal(true);
  }

  async function guardarPassword() {
    const nuevaPass = String(nuevaPassword || "").trim();

    if (!identificadorUsuario) {
      setPasswordAlert({
        message: "No se encontró identificador del usuario.",
        type: "alert-danger",
      });
      return;
    }

    if (!nuevaPass || nuevaPass.length < 4) {
      setPasswordAlert({
        message: "La contraseña debe tener al menos 4 caracteres.",
        type: "alert-danger",
      });
      return;
    }

    setPasswordLoading(true);

    try {
      const response = await fetch(APP_SCRIPT_URL_PASSWORD, {
        method: "POST",
        headers: {
          "Content-Type": "text/plain;charset=utf-8",
        },
        body: JSON.stringify({
          action: "cambiarPassword",
          usuario: identificadorUsuario,
          nuevaPassword: nuevaPass,
        }),
      });

      const data = await response.json();
      const ok = data.ok === true || data.status === "success";

      if (ok) {
        setPasswordAlert({
          message: "¡Contraseña actualizada exitosamente!",
          type: "alert-success",
        });

        setTimeout(() => {
          setShowPasswordModal(false);
          setPasswordLoading(false);
          setNuevaPassword("");
        }, 1500);
      } else {
        setPasswordAlert({
          message: data.message || "Error al cambiar la contraseña.",
          type: "alert-danger",
        });
        setPasswordLoading(false);
      }
    } catch (error) {
      console.error("Error al cambiar contraseña:", error);
      setPasswordAlert({
        message: "Error de conexión con el servidor.",
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
                <button
                type="button"
                id="backBtn"
                className="btn-atras"
                onClick={() => navigate(-1)}
                >
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
                            setPhotoIndex((prev) =>
                            prev + 1 < fuentesFoto.length ? prev + 1 : prev
                            );
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

                <div
                    className={`user-dropdown-card ${dropdownOpen ? "active" : ""}`}
                    id="dropdownMenu"
                    >
                    <div className="user-dropdown-info">
                        <span className="user-dropdown-name">{nombreUsuario}</span>
                        <span className="user-dropdown-role">{cargoUsuario}</span>
                    </div>

                    <div className="user-dropdown-divider"></div>

                    <button
                        type="button"
                        id="btnCambiarCuenta"
                        className="user-dropdown-item"
                        onClick={ejecutarCierreSesion}
                    >
                        <FaExchangeAlt className="user-dropdown-icon" />
                        <span>Cambiar Cuenta</span>
                    </button>

                    <button
                        type="button"
                        id="btnAbrirModalPassword"
                        className="user-dropdown-item"
                        onClick={abrirModalPassword}
                    >
                        <FaKey className="user-dropdown-icon" />
                        <span>Cambiar Contraseña</span>
                    </button>

                    <button
                        type="button"
                        id="logoutBtnDropdown"
                        className="user-dropdown-item user-dropdown-danger"
                        onClick={() => {
                        setDropdownOpen(false);
                        setShowLogoutModal(true);
                        }}
                    >
                        <FaSignOutAlt className="user-dropdown-icon" />
                        <span>Cerrar sesión</span>
                    </button>
                    </div>

              </div>

                <button
                type="button"
                id="logoutBtnDesktop"
                className="logout-btn-desktop header-logout-button"
                onClick={() => setShowLogoutModal(true)}
                >
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
                id="btnSyncPendientes"
                className={`btn-sync-pendientes ${
                  pendingCount > 0 ? "has-pending" : ""
                } ${syncLoading ? "is-loading" : ""}`}
                title="Sincronizar registros pendientes"
                disabled={syncLoading}
                onClick={() => sincronizarPendientesDesdeCabecera(false)}
              >
                <FaSyncAlt className="layout-icon" />
                <span className="btn-sync-text">Sincronizar</span>
                <span
                  id="pendingSyncBadge"
                  className={`sync-badge ${
                    pendingCount <= 0 ? "is-hidden" : ""
                  }`}
                >
                  {pendingCount}
                </span>
              </button>

              {puedeAdministrar && (
                <button
                  type="button"
                  id="btnAdministrarGlobal"
                  className="btn-administrar"
                  onClick={() => navigate(ADMIN_URL)}
                >
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
            <div className="custom-modal-overlay">
            <div className="custom-logout-modal">
                <div className="custom-modal-header custom-modal-danger">
                <h5>
                    <FaSignOutAlt />
                    Cerrar Sesión
                </h5>

                <button
                    type="button"
                    className="custom-modal-close"
                    onClick={() => setShowLogoutModal(false)}
                    aria-label="Cerrar"
                >
                    ×
                </button>
                </div>

                <div className="custom-modal-body">
                ¿Estás seguro que deseas cerrar tu sesión?
                </div>

                <div className="custom-modal-footer">
                <button
                    type="button"
                    className="custom-btn custom-btn-cancel"
                    onClick={() => setShowLogoutModal(false)}
                >
                    Cancelar
                </button>

                <button
                    type="button"
                    className="custom-btn custom-btn-danger"
                    onClick={ejecutarCierreSesion}
                >
                    Sí, salir
                </button>
                </div>
            </div>
            </div>
        </>
        )}


      {showPasswordModal && (
        <>
          <div
            className="modal fade show d-block cabecera-modal"
            tabIndex="-1"
            role="dialog"
            aria-modal="true"
          >
            <div className="modal-dialog modal-dialog-centered">
              <div className="modal-content border-0 shadow">
                <div className="modal-header bg-primary text-white border-0">
                  <h5 className="modal-title fw-bold">
                    <FaKey className="modal-title-icon" />
                    Cambiar Contraseña
                  </h5>

                  <button
                    type="button"
                    className="btn-close btn-close-white"
                    aria-label="Cerrar"
                    onClick={() => setShowPasswordModal(false)}
                  ></button>
                </div>

                <div className="modal-body py-4">
                  {passwordAlert && (
                    <div
                      className={`alert ${passwordAlert.type} text-center fw-bold`}
                      role="alert"
                    >
                      {passwordAlert.message}
                    </div>
                  )}

                  <form
                    id="formPassword"
                    onSubmit={(e) => {
                      e.preventDefault();
                      guardarPassword();
                    }}
                  >
                    <div className="mb-3">
                      <label
                        htmlFor="nuevaPassword"
                        className="form-label fw-bold"
                      >
                        Ingrese nueva contraseña
                      </label>

                      <input
                        type="password"
                        className="form-control text-center"
                        id="nuevaPassword"
                        placeholder="••••••••"
                        required
                        value={nuevaPassword}
                        onChange={(e) => setNuevaPassword(e.target.value)}
                      />
                    </div>
                  </form>
                </div>

                <div className="modal-footer border-0 justify-content-center bg-light">
                  <button
                    type="button"
                    className="btn btn-secondary px-4 fw-bold"
                    onClick={() => setShowPasswordModal(false)}
                  >
                    Cancelar
                  </button>

                  <button
                    type="button"
                    className="btn btn-primary px-4 fw-bold"
                    id="btnGuardarPassword"
                    disabled={passwordLoading}
                    onClick={guardarPassword}
                  >
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
