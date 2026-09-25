import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  FaArrowRight,
  FaBoxOpen,
  FaBoxes,
  FaCog,
  FaExclamationTriangle,
  FaPallet,
  FaSignOutAlt,
  FaUtensils,
  FaClipboardCheck,
  FaSearch,
  FaWarehouse,
  FaRoute,
  FaMobileAlt,
  FaBusAlt,
  FaBus,
  FaUsers,


} from "react-icons/fa";

import "./Menu.css";

const LOGIN_URL = "/";
const API_ALMUERZO_URL =
  "https://script.google.com/macros/s/AKfycbyzQ67a7Fk4_U5ODe41GnIrQCezaQdpFInH_VFzLjHgQ1Yq99xxYZdXVFVovcV8gloW/exec";

const PEDIDOS_URL_MENU = "/almuerzos/pedidos";
const POPUP_CACHE_KEY = "popup_almuerzo_cache_v2";

function getStoredAuthUser() {
  const raw = localStorage.getItem("authUser") || sessionStorage.getItem("authUser");
  if (!raw) return null;

  try {
    return JSON.parse(raw);
  } catch {
    localStorage.removeItem("authUser");
    sessionStorage.removeItem("authUser");
    return null;
  }
}

function syncSession(user) {
  const text = JSON.stringify(user);
  localStorage.setItem("authUser", text);
  sessionStorage.setItem("authUser", text);
}

function formatDisplayName(fullName) {
  const text = String(fullName || "").trim();
  if (!text) return "Usuario";

  if (text.includes(",")) {
    const parts = text.split(",");
    const apellidos = String(parts[0] || "").trim().split(/\s+/).filter(Boolean);
    const nombres = String(parts[1] || "").trim().split(/\s+/).filter(Boolean);
    return toTitleCase(`${nombres[0] || ""} ${apellidos[0] || ""}`.trim());
  }

  const tokens = text.split(/\s+/).filter(Boolean);
  if (tokens.length === 1) return toTitleCase(tokens[0]);

  return toTitleCase(`${tokens[0]} ${tokens[1] || ""}`.trim());
}

function getRoleLabel(role) {
  const roles = {
    SUPERADMIN: "Superadministrador",
    ADMIN: "Administrador",
    SUPERVISOR: "Supervisor",
    USUARIO: "Usuario",
    EXTERNO: "Externo",
  };

  return roles[role] || "Usuario";
}

function toTitleCase(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/\b([a-záéíóúñ])/g, (m) => m.toUpperCase());
}

function capitalizeWords(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/\b([a-záéíóúñ])/g, (m) => m.toUpperCase());
}

function getTimeTheme(date) {
  const hour = date.getHours();

  if (hour >= 5 && hour < 12) {
    return {
      className: "theme-dia",
      label: "Buenos días",
      icon: "☀️",
      message: "Le deseamos una excelente jornada.",
      description: "Empiece su día accediendo rápidamente a sus módulos.",
    };
  }

  if (hour >= 12 && hour < 19) {
    return {
      className: "theme-tarde",
      label: "Buenas tardes",
      icon: "🌇",
      message: "Continúe con sus operaciones.",
      description: "Continúe su jornada accediendo rápidamente a sus módulos.",
    };
  }

  return {
    className: "theme-noche",
    label: "Buenas noches",
    icon: "✨",
    message: "Gracias por continuar con el sistema.",
    description: "Acceda a sus herramientas y mantenga el control de sus procesos.",
  };
}

function buildFallbackSvg(title, accent) {
  const themes = {
    "accent-blue": ["#0f4c81", "#1a73e8"],
    "accent-cyan": ["#38bdf8", "#0284c7"],
    "accent-slate": ["#64748b", "#475569"],
    "accent-violet": ["#7c3aed", "#5b21b6"],
    "accent-red": ["#f87171", "#dc2626"],
  };

  const colors = themes[accent] || ["#0f4c81", "#1a73e8"];

  return (
    "data:image/svg+xml;charset=UTF-8," +
    encodeURIComponent(`
      <svg xmlns="http://www.w3.org/2000/svg" width="800" height="800" viewBox="0 0 800 800">
        <defs>
          <linearGradient id="bg" x1="0" x2="1" y1="0" y2="1">
            <stop offset="0%" stop-color="${colors[0]}"/>
            <stop offset="100%" stop-color="${colors[1]}"/>
          </linearGradient>
        </defs>
        <rect width="800" height="800" rx="40" fill="url(#bg)"/>
        <circle cx="650" cy="140" r="110" fill="rgba(255,255,255,0.10)"/>
        <circle cx="130" cy="670" r="140" fill="rgba(255,255,255,0.08)"/>
        <text x="50%" y="52%" text-anchor="middle" fill="#ffffff"
          font-family="Arial, sans-serif" font-size="40" font-weight="700">
          ${title}
        </text>
      </svg>
    `)
  );
}

function getDniMenu(user) {
  return String(user?.dni || user?.DNI || user?.id || user?.ID || "").trim();
}

function getCuentaMenu(user) {
  return String(
    user?.email ||
      user?.correo ||
      user?.usuario ||
      getDniMenu(user)
  ).trim();
}

function getUsuarioKeyMenu(user) {
  return getDniMenu(user) || getCuentaMenu(user) || "anon";
}

async function apiPostAlmuerzo(payload) {
  const response = await fetch(API_ALMUERZO_URL, {
    method: "POST",
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error("Error HTTP: " + response.status);
  }

  return await response.json();
}

function leerCachePopup() {
  try {
    return JSON.parse(localStorage.getItem(POPUP_CACHE_KEY) || "null");
  } catch {
    return null;
  }
}

function guardarCachePopup(data) {
  localStorage.setItem(
    POPUP_CACHE_KEY,
    JSON.stringify({
      ...data,
      ts: Date.now(),
    })
  );
}

export default function Menu() {
  const navigate = useNavigate();
  const [authUser] = useState(() => getStoredAuthUser());
  const [now, setNow] = useState(() => new Date());

  const [showRecordatorio, setShowRecordatorio] = useState(false);
  const [recordatorioDia, setRecordatorioDia] = useState("...");
  const [activeTab, setActiveTab] = useState("excelencia");


  useEffect(() => {
    if (!authUser) {
      navigate(LOGIN_URL, { replace: true });
      return;
    }

    syncSession(authUser);
  }, [authUser, navigate]);

  useEffect(() => {
    const timer = setInterval(() => {
      setNow(new Date());
    }, 1000);

    return () => clearInterval(timer);
  }, []);

  const nombreMostrar = useMemo(
    () => formatDisplayName(authUser?.nombre || "Usuario"),
    [authUser]
  );

  const rol = String(authUser?.rol || "USUARIO").trim().toUpperCase();
  const esAdmin = rol === "SUPERADMIN" || rol === "SUPERVISOR";

  const menuTabs = useMemo(() => {
  const tabs = [
    {
      key: "excelencia",
      label: "Excelencia Operativa",
      shortLabel: "BPE",
      items: [
        {
          title: "Tarjetas de Anomalía",
          description: "Crear y dar seguimiento a hallazgos o incidencias.",
          Icon: FaExclamationTriangle,
          accent: "accent-blue",
          buttonText: "Ingresar",
          image: "/img/ANOMALIA.jpg",
          url: "/apps-tarjetas/anomalias",
        },
        {
          title: "Gestión de Pedidos",
          description: "Registrar y revisar pedidos operativos del día.",
          Icon: FaUtensils,
          accent: "accent-cyan",
          buttonText: "Abrir",
          image: "/img/almuerzo.jpg",
          url: "/almuerzos/pedidos",
        },
        {
          title: "Tarjetas de Sugerencia",
          description: "Recolectar y gestionar ideas o propuestas de mejora.",
          Icon: FaBoxes,
          accent: "accent-slate",
          buttonText: "Entrar",
          image: "/img/SUGERENCIA.jpg",
          url: "/tarjetas-sugerencias/sugerencias",
        },
        {
          title: "Cuadro Q",
          description: "Registrar y dar seguimiento a incidencias.",
          Icon: FaExclamationTriangle,
          accent: "accent-slate",
          buttonText: "Entrar",
          image: "/img/cuadro-Q.jpg",
          url: "/Cuadro-Q/trackingCuadroQ.html",
        },
        {
          title: "Inspección PIV",
          description: "Realizar y registrar inspecciones PIV.",
          Icon: FaSearch,
          accent: "accent-violet",
          buttonText: "Entrar",
          image: "/img/insp_piv.jpg",
          url: "#",
        },
        {
          title: "Auditoría 5S",
          description: "Realizar y registrar auditorías 5S.",
          Icon: FaClipboardCheck,
          accent: "accent-violet",
          buttonText: "Entrar",
          image: "/img/5S.jpg",
          url: "#",
        },
        {
          title: "Gestión de Rutas",
          description: "Planificar y optimizar rutas de personal.",
          Icon: FaBus,
          accent: "accent-blue", // Puedes cambiar el color según tu paleta
          buttonText: "Entrar",
          image: "/img/movil.jpg",
          url: "#",
        }
      ],
    },
    {
      key: "inbound",
      label: "Inbound",
      shortLabel: "INB",
      items: [
        {
          title: "Inspección de Contenedores",
          description: "Registrar inspecciones de contenedores.",
          Icon: FaSearch,
          accent: "accent-blue",
          buttonText: "Entrar",
          image: "/img/inspecion-contenedor.jpg",
          url: "#",
        },
      ],
    },
    {
      key: "outbound",
      label: "Outbound",
      shortLabel: "OUT",
      items: [
        {
          title: "Préstamos de Pallet",
          description: "Controlar los préstamos de pallets a transportistas.",
          Icon: FaPallet,
          accent: "accent-slate",
          buttonText: "Entrar",
          image: "/img/palet.jpg",
          url: "/Prestamos-Pallet/trackingprestamos.html",
        },
      ],
    },
    {
      key: "inventario",
      label: "Logistics Support Inventario",
      shortLabel: "LSI",
      items: [
        {
          title: "Conteos Cíclico",
          description: "Gestionar conteos cíclicos de inventario.",
          Icon: FaWarehouse,
          accent: "accent-cyan",
          buttonText: "Entrar",
          image: "/img/ciclico.jpg",
          url: "#",
        },
        {
          title: "Auditoría Ciega Principal",
          description: "Registrar auditorías de Principal.",
          Icon: FaBoxOpen,
          accent: "accent-violet",
          buttonText: "Entrar",
          image: "/img/auditoria-despachos.jpg",
          url: "#",
        },
        {
          title: "Auditoría Retail",
          description: "Registrar auditorías de Retail.",
          Icon: FaBoxOpen,
          accent: "accent-violet",
          buttonText: "Entrar",
          image: "/img/auditoria-despachos.jpg",
          url: "#",
        },
        {
          title: "Auditoría de Costos",
          description: "Registrar auditorías de costos.",
          Icon: FaBoxOpen,
          accent: "accent-violet",
          buttonText: "Entrar",
          image: "/img/auditoria-costos.jpg",
          url: "#",
        },
      ],
    },
    {
      key: "vas",
      label: "VAS",
      shortLabel: "VAS",
      items: [
        {
          title: "Reporte de Discrepancia",
          description: "Gestionar y registrar reportes de Discrepancia.",
          Icon: FaBoxOpen,
          accent: "accent-cyan",
          buttonText: "Entrar",
          image: "/img/discrepancia.jpg",
          url: "#",
        },
        {
          title: "Auditoría de Despachos",
          description: "Registrar auditorías de despachos.",
          Icon: FaBoxOpen,
          accent: "accent-violet",
          buttonText: "Entrar",
          image: "/img/auditoria-despachos.jpg",
          url: "#",
        },
      ],
    },
    {
      key: "aseguramiento_calidad",
      label: "Aseguramiento de la Calidad",
      shortLabel: "ASC",
      items: [
        {
          title: "Inspección del Personal",
          description: "Inspeccionar la limpieza y orden.",
          Icon: FaUsers, 
          accent: "accent-cyan",
          buttonText: "Entrar",
          image: "/img/insp_personal.jpg",
          url: "#",
        },
        {
          title: "Autoinspecciones",
          description: "Autoinspecciones a procesos de almacenamiento de productos regulados.",
          Icon: FaBoxOpen,
          accent: "accent-violet",
          buttonText: "Entrar",
          image: "/img/auditoria-despachos.jpg",
          url: "#",
        },
        {
          title: "Inspección de casilleros",
          description: "Inspeccionar la limpieza y orden de casilleros.",
          Icon: FaBoxOpen,
          accent: "accent-violet",
          buttonText: "Entrar",
          image: "/img/casilleros.jpg",
          url: "#",
        },
      ],
    },
  ];

  let filteredTabs = tabs;

  if (rol === "EXTERNO") {
    filteredTabs = tabs
      .map((tab) => ({
        ...tab,
        items: tab.items.filter((app) => app.title === "Préstamos de Pallet"),
      }))
      .filter((tab) => tab.items.length > 0);
  }

const sistemaTab = {
  key: "sistema",
  label: "Sistema",
  shortLabel: "SIST.",
  items: esAdmin
    ? [
        {
          title: "Configuración",
          description: "Administrar parámetros y accesos del sistema.",
          Icon: FaCog,
          accent: "accent-violet",
          buttonText: "Gestionar",
          image: "/img/conf.jpg",
          url: "/Configuracion/configuracion.html",
        },
        // Nuevo elemento agregado para administradores
        {
          title: "Usuarios y Roles",
          description: "Crear y gestionar usuarios y roles en el sistema.",
          Icon: FaUsers, 
          accent: "accent-slate",
          buttonText: "Entrar",
          image: "../img/useer.jpg",
          url: "/usuarios/tracking_usuarios",
        },
      ]
    : [
        {
          title: "Cerrar Sesión",
          description: "Salir de forma segura del sistema.",
          Icon: FaSignOutAlt,
          accent: "accent-red",
          buttonText: "Salir",
          image: "",
          action: "logout",
        },
      ],
};

  return [...filteredTabs, sistemaTab];
}, [rol, esAdmin]);

const apps = useMemo(() => {
  return menuTabs.flatMap((tab) => tab.items);
}, [menuTabs]);

const currentTab = useMemo(() => {
  return menuTabs.find((tab) => tab.key === activeTab) || menuTabs[0];
}, [menuTabs, activeTab]);

const visibleApps = currentTab?.items || [];

useEffect(() => {
  if (menuTabs.length && !menuTabs.some((tab) => tab.key === activeTab)) {
    setActiveTab(menuTabs[0].key);
  }
}, [menuTabs, activeTab]);


  useEffect(() => {
    if (!authUser) return;

    const cache = leerCachePopup();

    if (cache) {
      const mismoUsuario = cache.usuarioKey === getUsuarioKeyMenu(authUser);
      const cacheVigente = Date.now() - Number(cache.ts || 0) < 2 * 60 * 60 * 1000;

      if (
        mismoUsuario &&
        cacheVigente &&
        cache.estado === "Activo" &&
        !cache.enviado &&
        cache.diaActivo
      ) {
        const claveSesion = `popup_almuerzo_${cache.diaActivo}_${getUsuarioKeyMenu(
          authUser
        )}`;

        if (sessionStorage.getItem(claveSesion) !== "1") {
          setRecordatorioDia(cache.diaActivo);
          setShowRecordatorio(true);
          sessionStorage.setItem(claveSesion, "1");
        }
      }
    }

    let cancelado = false;

    async function validarRecordatorioAlmuerzoMenu() {
      try {
        const [info, pedido] = await Promise.all([
          apiPostAlmuerzo({ action: "getMenuInfo" }),
          apiPostAlmuerzo({
            action: "getPedidoUsuario",
            dni: getDniMenu(authUser),
            cuenta: getCuentaMenu(authUser),
          }),
        ]);

        if (cancelado) return;
        if (info.status !== "success") return;

        const diaActivo = String(info.diaActivo || "").trim();
        const estado = String(info.estado || "").trim();
        const enviado = pedido.status === "success" && pedido.enviado === true;

        guardarCachePopup({
          usuarioKey: getUsuarioKeyMenu(authUser),
          diaActivo,
          estado,
          enviado,
        });

        if (estado !== "Activo" || !diaActivo || enviado) {
          setShowRecordatorio(false);
          return;
        }

        const claveSesion = `popup_almuerzo_${diaActivo}_${getUsuarioKeyMenu(
          authUser
        )}`;

        if (sessionStorage.getItem(claveSesion) !== "1") {
          setRecordatorioDia(diaActivo);
          setShowRecordatorio(true);
          sessionStorage.setItem(claveSesion, "1");
        }
      } catch (error) {
        console.error("Error validando popup de almuerzo:", error);
      }
    }

    validarRecordatorioAlmuerzoMenu();

    return () => {
      cancelado = true;
    };
  }, [authUser]);

  if (!authUser) return null;

  const theme = getTimeTheme(now);

  const fechaCorta = new Intl.DateTimeFormat("es-PE", {
    weekday: "long",
  }).format(now);

  const fechaLarga = new Intl.DateTimeFormat("es-PE", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  }).format(now);

  const horaTexto = new Intl.DateTimeFormat("es-PE", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  }).format(now);

  const hours = now.getHours() % 12;
  const minutes = now.getMinutes();
  const seconds = now.getSeconds();

  const hourDeg = hours * 30 + minutes * 0.5;
  const minuteDeg = minutes * 6 + seconds * 0.1;
  const secondDeg = seconds * 6;

  function cerrarSesion() {
    if (window.confirm("¿Estás seguro que deseas cerrar sesión?")) {
      localStorage.removeItem("authUser");
      sessionStorage.removeItem("authUser");
      navigate(LOGIN_URL, { replace: true });
    }
  }

  function abrirApp(app) {
    if (app.action === "logout") {
      cerrarSesion();
      return;
    }

    if (!app.url || app.url === "#") return;

    if (!app.url.endsWith(".html") && !app.url.includes(" ")) {
      navigate(app.url);
    } else {
      window.location.href = app.url;
    }
  }

  return (
    <div className="dashboard-page">
      <main className="contenedor-principal">
        <section className="hero-panel">
          <div className={`hero-left ${theme.className}`}>
            <div className="hero-scene">{theme.icon}</div>

            <div className="hero-tags">
              <span className="hero-tag">Portal de aplicativos</span>
              <span className="hero-tag soft">{theme.label}</span>
            </div>

            <h1>
              Hola, {nombreMostrar}. {theme.label}.
            </h1>

            <p>{theme.description}</p>

            <div className="hero-mini-cards">
              <div className="hero-mini-card">
                <small>Perfil</small>
                <strong>{getRoleLabel(rol)}</strong>
              </div>

              <div className="hero-mini-card">
                <small>Aplicativos</small>
                <strong>
                  {apps.filter((app) => app.action !== "logout").length} módulos
                </strong>
              </div>
            </div>
          </div>

          <div className={`hero-right ${theme.className}`}>
            <div className="time-card">
              <div className="time-card-left">
                <span className="time-label">Hoy</span>
                <strong>{capitalizeWords(fechaCorta)}</strong>
                <small>{capitalizeWords(fechaLarga)}</small>
                <div className="time-scene-mini">{theme.icon}</div>
              </div>

              <div className="time-card-right">
                <div className="clock-face">
                  <div
                    className="clock-hand hour-hand"
                    style={{
                      transform: `translateX(-50%) rotate(${hourDeg}deg)`,
                    }}
                  ></div>
                  <div
                    className="clock-hand minute-hand"
                    style={{
                      transform: `translateX(-50%) rotate(${minuteDeg}deg)`,
                    }}
                  ></div>
                  <div
                    className="clock-hand second-hand"
                    style={{
                      transform: `translateX(-50%) rotate(${secondDeg}deg)`,
                    }}
                  ></div>
                  <div className="clock-center"></div>
                </div>
              </div>

              <div className="time-card-footer">
                <div className="digital-time">{horaTexto}</div>
                <div className="time-message">{theme.message}</div>
              </div>
            </div>
          </div>
        </section>

        <section className="apps-section apps-section-tabs">
          <div className="app-category-tabs" role="tablist">
            {menuTabs.map((tab) => (
              <button
                key={tab.key}
                type="button"
                className={`app-category-tab ${
                  currentTab?.key === tab.key ? "active" : ""
                }`}
                onClick={() => setActiveTab(tab.key)}
              >
                <span className="tab-label-full">{tab.label}</span>
                <span className="tab-label-short">{tab.shortLabel || tab.label}</span>

              </button>
            ))}
          </div>

          <div className="section-head tabs-section-head">
            <div>
              <h2>{currentTab?.label}</h2>
              <p>Seleccione un módulo para continuar.</p>
            </div>
          </div>

          <div className="apps-grid">
            {visibleApps.map((app) => {
              const Icon = app.Icon;
              const imgSrc = app.image || buildFallbackSvg(app.title, app.accent);

              return (
                <button
                  key={app.title}
                  type="button"
                  className={`app-card ${app.accent || ""}`}
                  aria-label={app.title}
                  onClick={() => abrirApp(app)}
                >
                  <div className="app-media">
                    <img
                      src={imgSrc}
                      alt={app.title}
                      loading="lazy"
                      onError={(e) => {
                        if (e.currentTarget.dataset.fallbackApplied === "1") return;
                        e.currentTarget.dataset.fallbackApplied = "1";
                        e.currentTarget.src = buildFallbackSvg(app.title, app.accent);
                      }}
                    />

                    <div className="app-media-overlay"></div>

                    <div className="app-media-icon">
                      <Icon />
                    </div>
                  </div>

                  <div className="app-card-body">
                    <span className="app-pill">{app.buttonText}</span>
                    <h3>{app.title}</h3>
                    <p>{app.description}</p>

                    <div className="app-card-bottom">
                      <span className="app-link-text">{app.buttonText}</span>
                      <FaArrowRight />
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </section>

      </main>

      {showRecordatorio && (
        <div
          className="recordatorio-overlay"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setShowRecordatorio(false);
            }
          }}
        >
          <div className="recordatorio-card">
            <button
              className="recordatorio-close"
              type="button"
              onClick={() => setShowRecordatorio(false)}
            >
              &times;
            </button>

            <img
              src="/img/recordatorio-almuerzo.png"
              alt="Recordatorio de almuerzo"
              className="recordatorio-img"
              onError={(e) => {
                e.currentTarget.onerror = null;
                e.currentTarget.src = "/img/record-almuerzo.png";
              }}
            />

            <h3 className="recordatorio-title">No olvides tu almuerzo</h3>

            <p className="recordatorio-text">
              Aún no has enviado tu almuerzo del{" "}
              <strong>{recordatorioDia}</strong>.
            </p>

            <button
              className="recordatorio-btn"
              type="button"
              onClick={() => {
                setShowRecordatorio(false);
                navigate(PEDIDOS_URL_MENU);
              }}
            >
              Ir a pedidos
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
