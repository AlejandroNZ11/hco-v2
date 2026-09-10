import { useCallback, useEffect, useMemo, useState } from "react";
import {
  FaBell,
  FaCheck,
  FaCheckCircle,
  FaExclamationTriangle,
  FaFire,
  FaSpinner,
  FaUtensils,
} from "react-icons/fa";
import "./Pedidos.css";

const APIURL = "https://script.google.com/macros/s/AKfycbyzQ67a7Fk4_U5ODe41GnIrQCezaQdpFInH_VFzLjHgQ1Yq99xxYZdXVFVovcV8gloW/exec";
const CACHEKEY = "almuerzocachev1";
const REMINDERKEYPREFIX = "almuerzorecordatorio";
const AUTOPERMISSIONKEY = "almuerzoautopermissionpromptv1";

const DIAS = [
  { label: "Lun", value: "Lunes" },
  { label: "Mar", value: "Martes" },
  { label: "Mie", value: "Miercoles" },
  { label: "Jue", value: "Jueves" },
  { label: "Vie", value: "Viernes" },
];

function getAuthUser() {
  const raw = localStorage.getItem("authUser") || sessionStorage.getItem("authUser");
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function getDniUsuario(user) {
  return String(user?.dni || user?.DNI || user?.id || user?.ID || "").trim();
}

function getCuentaUsuario(user) {
  return String(
    user?.email || user?.correo || user?.usuario || getDniUsuario(user)
  ).trim();
}

function getNombreUsuario(user) {
  return String(user?.nombre || user?.NOMBRE || "Usuario Desconocido").trim();
}

function getFotoUsuario(user) {
  const fotoThumb = String(user?.foto || "").trim();
  const fotoWeb = String(user?.fotoWeb || "").trim();
  const fotoRaw = String(user?.fotoRaw || "").trim();
  if (fotoThumb) return fotoThumb;
  if (fotoRaw) return fotoRaw;
  if (fotoWeb) return fotoWeb;
  return "";
}

async function apiPost(payload) {
  const response = await fetch(APIURL, {
    method: "POST",
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    throw new Error("Error HTTP: " + response.status);
  }
  return await response.json();
}

function guardarCacheLocal(data) {
  localStorage.setItem(CACHEKEY, JSON.stringify(data));
}

function cargarCacheLocal(user) {
  try {
    const raw = localStorage.getItem(CACHEKEY);
    if (!raw) return null;
    const cache = JSON.parse(raw);
    const dniActual = getDniUsuario(user);
    return {
      menuGlobal: cache.menuGlobal || null,
      diaActivoServidor: cache.diaActivoServidor || "",
      estadoServidor: cache.estadoServidor || "",
      pedidoActualUsuario:
        cache.dni === dniActual ? cache.pedidoActualUsuario || null : null,
      timestamp: cache.timestamp || Date.now(),
    };
  } catch {
    return null;
  }
}

function esIOS() {
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}

function esSafariIOS() {
  const ua = navigator.userAgent;
  return esIOS() && /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS/.test(ua);
}

function estaInstaladaComoApp() {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    window.navigator.standalone === true
  );
}

export default function Pedidos() {
  const [usuarioLogueado] = useState(() => getAuthUser());
  const [menuGlobal, setMenuGlobal] = useState(null);
  const [diaActivoServidor, setDiaActivoServidor] = useState("");
  const [estadoServidor, setEstadoServidor] = useState("");
  const [pedidoActualUsuario, setPedidoActualUsuario] = useState(null);
  const [diaVisible, setDiaVisible] = useState("Lunes");
  const [platoSeleccionado, setPlatoSeleccionado] = useState("");
  const [loading, setLoading] = useState(true);
  const [offline, setOffline] = useState(!navigator.onLine);
  const [submitting, setSubmitting] = useState(false);
  const [overlay, setOverlay] = useState(null);
  const [notificationPermission, setNotificationPermission] = useState(
    "Notification" in window ? Notification.permission : "unsupported"
  );

  const dniUsuario = useMemo(
    () => getDniUsuario(usuarioLogueado),
    [usuarioLogueado]
  );
  const cuentaUsuario = useMemo(
    () => getCuentaUsuario(usuarioLogueado),
    [usuarioLogueado]
  );

  const menuDia = menuGlobal?.[diaVisible] || {};
  
  // LÓGICA CORREGIDA PARA VISUALIZAR SIEMPRE EL DÍA CORRECTO
  const diaDelPedido = pedidoActualUsuario?.dia || pedidoActualUsuario?.diaMenu || diaActivoServidor;
  const diaMostrar = diaActivoServidor || diaDelPedido || diaVisible;
  
  const hayPedidoEsteDia = Boolean(pedidoActualUsuario && diaVisible === diaDelPedido);

  const sistemaActivo = estadoServidor === "Activo";
  const esDiaActivo = diaVisible === (diaActivoServidor || diaDelPedido);

  // Deshabilitamos el select si no es el día activo o el sistema está inactivo
  const disableSelect = offline || !sistemaActivo || !esDiaActivo;

  const puedeConfirmar = Boolean(
    navigator.onLine &&
      sistemaActivo &&
      esDiaActivo &&
      platoSeleccionado &&
      (!pedidoActualUsuario ||
        platoSeleccionado !== String(pedidoActualUsuario?.plato || "").trim())
  );

  const textoNotificaciones = useMemo(() => {
    if (!("Notification" in window)) return "No compatible";
    if (notificationPermission === "granted") return "Recordatorios activados";
    if (notificationPermission === "denied") return "Notificaciones bloqueadas";
    return "Activar recordatorios";
  }, [notificationPermission]);

  const mostrarOverlay = useCallback((tipo, mensaje) => {
    setOverlay({ tipo, mensaje });
    setTimeout(() => {
      setOverlay(null);
    }, tipo === "success" ? 1800 : 2200);
  }, []);

  const lanzarNotificacionLocal = useCallback(async (titulo, mensaje) => {
    if (!("Notification" in window)) return false;
    if (Notification.permission !== "granted") return false;
    const opciones = {
      body: mensaje,
      icon: "/img/icon-192.png",
      badge: "/img/icon-192.png",
      tag: `recordatorio-almuerzo-${dniUsuario}`,
      renotify: true,
      requireInteraction: true,
      vibrate: [200, 100, 200],
      data: { url: "/almuerzos/pedidos" },
    };
    try {
      if ("serviceWorker" in navigator) {
        const reg = await navigator.serviceWorker.ready;
        await reg.showNotification(titulo, opciones);
      } else {
        new Notification(titulo, opciones);
      }
      return true;
    } catch (error) {
      console.warn("Error notificaciones:", error);
      return false;
    }
  }, [dniUsuario]);

  const enviarRecordatorioSiHaceFalta = useCallback(
    async ({ forzar = false, estado, diaActivo, pedido }) => {
      if (!navigator.onLine || estado !== "Activo" || !diaActivo || pedido) return;
      const clave = `${REMINDERKEYPREFIX}${diaActivo}${dniUsuario}`;
      const ultimo = Number(localStorage.getItem(clave) || "0");
      const ahora = Date.now();
      if (!forzar && ahora - ultimo < 30 * 60 * 1000) return;
      localStorage.setItem(clave, String(ahora));
      await lanzarNotificacionLocal(
        "Recordatorio de almuerzo",
        `No has enviado tu almuerzo del ${diaActivo}. Regístralo a tiempo.`
      );
    },
    [dniUsuario, lanzarNotificacionLocal]
  );

  const refrescarTodo = useCallback(
    async (silencioso = false) => {
      if (!usuarioLogueado) return;
      try {
        if (!navigator.onLine) {
          const cache = cargarCacheLocal(usuarioLogueado);
          if (cache?.menuGlobal) {
            setMenuGlobal(cache.menuGlobal);
            setDiaActivoServidor(cache.diaActivoServidor);
            setEstadoServidor(cache.estadoServidor);
            setPedidoActualUsuario(cache.pedidoActualUsuario);
            setDiaVisible(cache.diaActivoServidor || cache.pedidoActualUsuario?.dia || "Lunes");
            setOffline(true);
            setLoading(false);
            return;
          }
          throw new Error("Sin conexión");
        }
        const result = await apiPost({ action: "getInitData", dni: dniUsuario, cuenta: cuentaUsuario });
        if (result.status !== "success") throw new Error("Error inicial.");
        
        setMenuGlobal(result.menu || {});
        setDiaActivoServidor(result.diaActivo || "");
        setEstadoServidor(result.estado || "");
        setPedidoActualUsuario(result.pedido || null);
        setDiaVisible(result.diaActivo || result.pedido?.dia || "Lunes");
        setOffline(false);
        setLoading(false);
        
        guardarCacheLocal({
          menuGlobal: result.menu || {},
          diaActivoServidor: result.diaActivo || "",
          estadoServidor: result.estado || "",
          pedidoActualUsuario: result.pedido || null,
          dni: dniUsuario,
          timestamp: Date.now(),
        });
        
        await enviarRecordatorioSiHaceFalta({
          estado: result.estado || "",
          diaActivo: result.diaActivo || "",
          pedido: result.pedido || null,
          forzar: false,
        });
      } catch (error) {
        console.error("Error al refrescar:", error);
        setLoading(false);
      }
    },
    [usuarioLogueado, dniUsuario, cuentaUsuario, enviarRecordatorioSiHaceFalta]
  );

  useEffect(() => {
    if (!usuarioLogueado) {
      window.location.href = "/";
      return;
    }
    refrescarTodo(false);
    const intRev = setInterval(() => refrescarTodo(true), 60000);
    const onLine = () => { setOffline(false); refrescarTodo(true); };
    const offLine = () => setOffline(true);
    window.addEventListener("online", onLine);
    window.addEventListener("offline", offLine);
    return () => {
      clearInterval(intRev);
      window.removeEventListener("online", onLine);
      window.removeEventListener("offline", offLine);
    };
  }, [usuarioLogueado, refrescarTodo]);

  useEffect(() => {
    if (hayPedidoEsteDia && pedidoActualUsuario?.plato) {
      setPlatoSeleccionado(pedidoActualUsuario.plato);
    } else {
      setPlatoSeleccionado("");
    }
  }, [hayPedidoEsteDia, pedidoActualUsuario, diaVisible]);

  async function solicitarPermisoNotificacionesManual() {
    if (!("Notification" in window)) {
      mostrarOverlay("warning", "Este navegador no soporta notificaciones.");
      return;
    }
    try {
      const permiso = await Notification.requestPermission();
      setNotificationPermission(permiso);
      if (permiso === "granted") {
        mostrarOverlay("success", "Recordatorios activados correctamente.");
      } else {
        mostrarOverlay("warning", "No se activaron las notificaciones.");
      }
    } catch (error) {
      console.warn(error);
    }
  }

  async function confirmarPedido() {
    if (!navigator.onLine || estadoServidor !== "Activo" || !platoSeleccionado) return;
    setSubmitting(true);
    try {
      const result = await apiPost({
        action: "guardarPedido",
        cuenta: cuentaUsuario,
        dni: dniUsuario,
        nombre: getNombreUsuario(usuarioLogueado),
        plato: platoSeleccionado,
        foto: getFotoUsuario(usuarioLogueado),
      });
      if (result.status === "success") {
        setPedidoActualUsuario(result.pedido || null);
        mostrarOverlay("success", "Almuerzo registrado correctamente.");
      } else {
        mostrarOverlay("warning", result.message || "Error al registrar.");
      }
    } catch (error) {
      mostrarOverlay("warning", "Error de conexión.");
    } finally {
      setSubmitting(false);
    }
  }

  function renderPlato(id, label, texto, calorias) {
    return (
      <div className="row g-0 py-2 border-bottom border-dark align-items-center px-2">
        <div className="col-12 col-md-2 text-start">{label} :</div>
        <div className={`col-12 col-md-8 text-center fst-italic text-uppercase ${loading ? "loading-dots" : ""}`}>
          {loading ? "CARGANDO" : texto || "-"}
        </div>
        <div className="col-12 col-md-2 text-md-end text-center">
          (<FaFire className="text-danger" /> {calorias || "0"}.00 Cal)
        </div>
      </div>
    );
  }

  // LÓGICA CORREGIDA PARA LAS BARRAS DE ESTADO 
  // Ahora permite que aparezcan ambas barras a la vez para poder visualizar tu pedido enviado siempre
  function renderMensajesEstado() {
    const mensajes = [];

    if (offline) {
      mensajes.push(
        <div key="off" className="pedido-status pedido-status-secondary">
          {pedidoActualUsuario
            ? `Sin conexión. Último almuerzo registrado para ${diaVisible}: ${pedidoActualUsuario.plato}.`
            : `Sin conexión. No se puede enviar pedido.`}
        </div>
      );
      return <div className="mensajes-container">{mensajes}</div>;
    }

    if (!sistemaActivo) {
      if (hayPedidoEsteDia) {
        mensajes.push(
          <div key="ok" className="pedido-status pedido-status-success">
            Tu almuerzo registrado para {diaVisible}: {pedidoActualUsuario.plato}.
          </div>
        );
      }
      mensajes.push(
        <div key="warn" className="pedido-status pedido-status-warning">
          El sistema de pedidos está actualmente inactivo.
        </div>
      );
    } else if (!esDiaActivo) {
      if (hayPedidoEsteDia) {
        mensajes.push(
          <div key="ok" className="pedido-status pedido-status-success">
            Tu almuerzo registrado para {diaVisible}: {pedidoActualUsuario.plato}.
          </div>
        );
      }
      mensajes.push(
        <div key="warn" className="pedido-status pedido-status-warning">
          Estás viendo el menú del {diaVisible}. Solo se reciben pedidos para el {diaMostrar}.
        </div>
      );
    } else {
      if (pedidoActualUsuario) {
        mensajes.push(
          <div key="ok" className="pedido-status pedido-status-success">
            Ya enviaste tu almuerzo para el {diaMostrar}: {pedidoActualUsuario.plato}.
          </div>
        );
      } else {
        mensajes.push(
          <div key="info" className="pedido-status pedido-status-info">
            Selecciona tu almuerzo para el {diaMostrar} y confirma.
          </div>
        );
      }
    }

    return <div className="mensajes-container">{mensajes}</div>;
  }

  if (!usuarioLogueado) return null;

  return (
    <div className="pedidos-page">
      <main className="pedidos-container">
        
        <div className="card shadow-sm border-dark">
          <div className="card-header text-center fw-bold fs-5 menu-title">
            <FaUtensils className="me-2" /> Menú del Día
          </div>
          
          <div className="row g-0 text-center border-bottom border-dark days-header">
            {DIAS.map((dia, index) => (
              <div
                key={dia.value}
                className={`col py-2 tab-dia ${index < DIAS.length - 1 ? "border-end border-dark" : ""} ${
                  diaVisible === dia.value ? "day-active text-white" : ""
                }`}
                onClick={() => setDiaVisible(dia.value)}
              >
                {dia.label}
              </div>
            ))}
          </div>
          
          <div className="card-body p-0 menu-body fw-bold">
            {renderPlato("txtEntrada", "ENTRADA 1", menuDia.entrada, menuDia.calEntrada)}
            {renderPlato("txtFondo1", "FONDO 1", menuDia.fondo1, menuDia.calFondo1)}
            {renderPlato("txtFondo2", "FONDO 2", menuDia.fondo2, menuDia.calFondo2)}
            
            <div className="row g-0 py-2 align-items-center px-2">
              <div className="col-12 col-md-2 text-start">DIETA :</div>
              <div className={`col-12 col-md-8 text-center fst-italic text-uppercase ${loading ? "loading-dots" : ""}`}>
                {loading ? "CARGANDO" : menuDia.dieta || "-"}
              </div>
              <div className="col-12 col-md-2 text-md-end text-center">
                (<FaFire className="text-danger" /> {menuDia.calDieta || "0"}.00 Cal)
              </div>
            </div>
          </div>
        </div>
        
        {/* Siempre mostramos la sección del formulario para visualizar, pero lo deshabilitamos si no se debe interactuar */}
        <div id="seccionPedido" className="pedidos-actions">
          <button type="button" className="btn-notificaciones" onClick={solicitarPermisoNotificacionesManual}>
            <FaBell /> {textoNotificaciones}
          </button>
          
          <label className="pedidos-label">
            Selecciona tu almuerzo del <span className="text-danger">{diaMostrar}</span>:
          </label>
          
          <select
            className="form-select select-custom"
            value={platoSeleccionado}
            disabled={disableSelect}
            onChange={(e) => setPlatoSeleccionado(e.target.value)}
          >
            <option value="">-- Selecciona una opción --</option>
            <option value="PLATO DE FONDO 01">PLATO DE FONDO 01</option>
            <option value="PLATO DE FONDO 02">PLATO DE FONDO 02</option>
            <option value="DIETA">DIETA</option>
          </select>
          
          <button type="button" className="btn-confirmar-pedido" disabled={!puedeConfirmar || submitting} onClick={confirmarPedido}>
            {submitting ? <FaSpinner className="spin" /> : <FaCheck />}
          </button>
        </div>
        
        {renderMensajesEstado()}
      </main>

      {overlay && (
        <div className="overlay-custom">
          {overlay.tipo === "success" ? (
            <FaCheckCircle className="icon-size check-animado" />
          ) : (
            <FaExclamationTriangle className="icon-size alerta-animada" />
          )}
          <h1 className="fw-bold mt-3 title-size">
            {overlay.tipo === "success" ? "¡Éxito!" : "¡Atención!"}
          </h1>
          <p className="text-muted text-size">{overlay.mensaje}</p>
        </div>
      )}
    </div>
  );
}
