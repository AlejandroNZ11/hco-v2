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

const API_URL =
  "https://script.google.com/macros/s/AKfycbyzQ67a7Fk4_U5ODe41GnIrQCezaQdpFInH_VFzLjHgQ1Yq99xxYZdXVFVovcV8gloW/exec";

const CACHE_KEY = "almuerzo_cache_v1";
const REMINDER_KEY_PREFIX = "almuerzo_recordatorio_";
const AUTO_PERMISSION_KEY = "almuerzo_auto_permission_prompt_v1";

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
  const response = await fetch(API_URL, {
    method: "POST",
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error("Error HTTP: " + response.status);
  }

  return await response.json();
}

function guardarCacheLocal(data) {
  localStorage.setItem(CACHE_KEY, JSON.stringify(data));
}

function cargarCacheLocal(user) {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
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

  const diaDelPedido =
    pedidoActualUsuario?.dia ||
    pedidoActualUsuario?.diaMenu ||
    diaActivoServidor;

  const hayPedidoEsteDia = Boolean(
    pedidoActualUsuario && diaVisible === diaDelPedido
  );

  const sistemaActivo = estadoServidor === "Activo";
  const esDiaActivo = diaVisible === diaActivoServidor;
  const puedeVerFormulario = sistemaActivo && esDiaActivo;

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
      data: {
        url: "/almuerzos/pedidos",
      },
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
      console.warn("No se pudo mostrar la notificación:", error);
      return false;
    }
  }, [dniUsuario]);

  const enviarRecordatorioSiHaceFalta = useCallback(
    async ({ forzar = false, estado, diaActivo, pedido }) => {
      if (!navigator.onLine) return;
      if (estado !== "Activo") return;
      if (!diaActivo) return;
      if (pedido) return;

      const clave = `${REMINDER_KEY_PREFIX}${diaActivo}_${dniUsuario}`;
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
            setDiaVisible(cache.diaActivoServidor || "Lunes");
            setOffline(true);
            setLoading(false);
            return;
          }

          throw new Error("Sin conexión y sin caché local");
        }

        const result = await apiPost({
          action: "getInitData",
          dni: dniUsuario,
          cuenta: cuentaUsuario,
        });

        if (result.status !== "success") {
          throw new Error("No se pudo obtener la información inicial.");
        }

        const nuevoMenu = result.menu || {};
        const nuevoDiaActivo = result.diaActivo || "";
        const nuevoEstado = result.estado || "";
        const nuevoPedido = result.pedido || null;

        setMenuGlobal(nuevoMenu);
        setDiaActivoServidor(nuevoDiaActivo);
        setEstadoServidor(nuevoEstado);
        setPedidoActualUsuario(nuevoPedido);
        setDiaVisible(nuevoDiaActivo || "Lunes");
        setOffline(false);
        setLoading(false);

        guardarCacheLocal({
          menuGlobal: nuevoMenu,
          diaActivoServidor: nuevoDiaActivo,
          estadoServidor: nuevoEstado,
          pedidoActualUsuario: nuevoPedido,
          dni: dniUsuario,
          timestamp: Date.now(),
        });

        await enviarRecordatorioSiHaceFalta({
          estado: nuevoEstado,
          diaActivo: nuevoDiaActivo,
          pedido: nuevoPedido,
          forzar: false,
        });
      } catch (error) {
        console.error("Error al refrescar:", error);

        const cache = cargarCacheLocal(usuarioLogueado);

        if (cache?.menuGlobal) {
          setMenuGlobal(cache.menuGlobal);
          setDiaActivoServidor(cache.diaActivoServidor);
          setEstadoServidor(cache.estadoServidor);
          setPedidoActualUsuario(cache.pedidoActualUsuario);
          setDiaVisible(cache.diaActivoServidor || "Lunes");
          setOffline(true);
          setLoading(false);
          return;
        }

        setLoading(false);

        if (!silencioso) {
          mostrarOverlay("warning", "No se pudo cargar la información del almuerzo.");
        }
      }
    },
    [
      usuarioLogueado,
      dniUsuario,
      cuentaUsuario,
      enviarRecordatorioSiHaceFalta,
      mostrarOverlay,
    ]
  );

  useEffect(() => {
    if (!usuarioLogueado) {
      window.location.href = "/";
      return;
    }

    refrescarTodo(false);

    const intervaloRevision = setInterval(() => {
      refrescarTodo(true);
    }, 60000);

    const handleOnline = () => {
      setOffline(false);
      refrescarTodo(true);
    };

    const handleOffline = () => {
      setOffline(true);
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      clearInterval(intervaloRevision);
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [usuarioLogueado, refrescarTodo]);

  useEffect(() => {
    if (hayPedidoEsteDia && pedidoActualUsuario?.plato) {
      setPlatoSeleccionado(pedidoActualUsuario.plato);
    } else {
      setPlatoSeleccionado("");
    }
  }, [hayPedidoEsteDia, pedidoActualUsuario, diaVisible]);

  useEffect(() => {
    if (!("Notification" in window)) return;
    if (Notification.permission !== "default") return;
    if (localStorage.getItem(AUTO_PERMISSION_KEY) === "done") return;

    let ejecutado = false;

    const handler = async () => {
      if (ejecutado) return;
      ejecutado = true;

      document.removeEventListener("click", handler);
      document.removeEventListener("touchstart", handler);
      document.removeEventListener("keydown", handler);

      localStorage.setItem(AUTO_PERMISSION_KEY, "done");

      try {
        const permiso = await Notification.requestPermission();
        setNotificationPermission(permiso);

        if (permiso === "granted") {
          await window.registrarPushTokenAlmuerzo?.();
          await enviarRecordatorioSiHaceFalta({
            estado: estadoServidor,
            diaActivo: diaActivoServidor,
            pedido: pedidoActualUsuario,
            forzar: true,
          });
        }
      } catch (error) {
        console.warn("No se pudo solicitar permiso automático:", error);
      }
    };

    document.addEventListener("click", handler, { once: true });
    document.addEventListener("touchstart", handler, { once: true });
    document.addEventListener("keydown", handler, { once: true });

    return () => {
      document.removeEventListener("click", handler);
      document.removeEventListener("touchstart", handler);
      document.removeEventListener("keydown", handler);
    };
  }, [
    estadoServidor,
    diaActivoServidor,
    pedidoActualUsuario,
    enviarRecordatorioSiHaceFalta,
  ]);

  async function solicitarPermisoNotificacionesManual() {
    if (!("Notification" in window)) {
      mostrarOverlay("warning", "Este navegador no soporta notificaciones.");
      return;
    }

    if (esIOS() && !esSafariIOS()) {
      mostrarOverlay("warning", "En iPhone o iPad, abre HCO desde Safari.");
      return;
    }

    if (esIOS() && !estaInstaladaComoApp()) {
      mostrarOverlay(
        "warning",
        "En iPhone o iPad, agrega HCO a la pantalla de inicio y ábrela como app."
      );
      return;
    }

    try {
      const permiso = await Notification.requestPermission();
      setNotificationPermission(permiso);

      if (permiso === "granted") {
        await window.registrarPushTokenAlmuerzo?.();

        mostrarOverlay("success", "Recordatorios activados correctamente.");

        await enviarRecordatorioSiHaceFalta({
          estado: estadoServidor,
          diaActivo: diaActivoServidor,
          pedido: pedidoActualUsuario,
          forzar: true,
        });

        return;
      }

      if (permiso === "denied") {
        mostrarOverlay(
          "warning",
          "Has bloqueado las notificaciones. Debes habilitarlas manualmente."
        );
        return;
      }

      mostrarOverlay("warning", "No se activaron las notificaciones.");
    } catch (error) {
      console.warn(error);
      mostrarOverlay("warning", "No se pudo solicitar el permiso de notificaciones.");
    }
  }

  async function confirmarPedido() {
    if (!navigator.onLine) {
      mostrarOverlay("warning", "No tienes conexión. No se puede enviar el almuerzo.");
      return;
    }

    if (estadoServidor !== "Activo") {
      mostrarOverlay(
        "warning",
        "El consolidado está cerrado y no se permiten nuevos envíos."
      );
      return;
    }

    if (!platoSeleccionado) {
      mostrarOverlay("warning", "Selecciona un plato antes de enviar.");
      return;
    }

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
        const nuevoPedido = result.pedido || null;

        setPedidoActualUsuario(nuevoPedido);

        guardarCacheLocal({
          menuGlobal,
          diaActivoServidor,
          estadoServidor,
          pedidoActualUsuario: nuevoPedido,
          dni: dniUsuario,
          timestamp: Date.now(),
        });

        mostrarOverlay(
          "success",
          result.mode === "updated"
            ? "Almuerzo actualizado correctamente."
            : "Almuerzo registrado correctamente."
        );

        return;
      }

      mostrarOverlay("warning", result.message || "No se pudo registrar el almuerzo.");
    } catch (error) {
      console.error(error);
      mostrarOverlay("warning", "No se pudo conectar con la API.");
    } finally {
      setSubmitting(false);
    }
  }

  function renderPlato(id, label, texto, calorias) {
    return (
      <div className="row g-0 py-2 border-bottom border-dark align-items-center px-2">
        <div className="col-12 col-md-2 text-start">{label} :</div>

        <div
          id={id}
          className={`col-12 col-md-8 text-center fst-italic text-uppercase ${
            loading ? "loading-dots" : ""
          }`}
        >
          {loading ? "CARGANDO" : texto || "-"}
        </div>

        <div className="col-12 col-md-2 text-md-end text-center">
          (<FaFire className="text-danger" /> {calorias || "0"}.00 Cal)
        </div>
      </div>
    );
  }

  function renderMensajeEstado() {
    if (offline) {
      return (
        <div className="pedido-status pedido-status-secondary">
          {pedidoActualUsuario
            ? `Sin conexión. Último almuerzo registrado para ${diaActivoServidor}: ${pedidoActualUsuario.plato}.`
            : `Sin conexión. No se puede validar ni enviar tu almuerzo del ${diaActivoServidor}.`}
        </div>
      );
    }

    if (!sistemaActivo) {
      return (
        <div className="pedido-status pedido-status-warning">
          El sistema de pedidos está actualmente inactivo.
        </div>
      );
    }

    if (!esDiaActivo) {
      return (
        <div className="pedido-status pedido-status-warning">
          Estás viendo el menú del {diaVisible}. Solo se reciben pedidos para el{" "}
          {diaActivoServidor}.
        </div>
      );
    }

    if (pedidoActualUsuario) {
      return (
        <div className="pedido-status pedido-status-success">
          Ya enviaste tu almuerzo para el {diaActivoServidor}:{" "}
          {pedidoActualUsuario.plato}.
        </div>
      );
    }

    return (
      <div className="pedido-status pedido-status-warning">
        No has enviado tu almuerzo del {diaActivoServidor}.
      </div>
    );
  }


  if (!usuarioLogueado) return null;

  return (
    <div className="pedidos-page bg-light">
      <main className="pedidos-container">

        <div className="card shadow-sm border-dark">
          <div className="card-header text-center fw-bold fs-5 menu-title">
            <FaUtensils /> Menú del Día
          </div>

          <div className="row g-0 text-center border-bottom border-dark days-header">
            {DIAS.map((dia, index) => (
              <div
                key={dia.value}
                className={`col py-2 tab-dia ${
                  index < DIAS.length - 1 ? "border-end border-dark" : ""
                } ${
                  diaVisible === dia.value ? "day-active text-white fw-bold" : ""
                }`}
                onClick={() => setDiaVisible(dia.value)}
              >
                {dia.label}
              </div>
            ))}
          </div>

          <div className="card-body p-0 menu-body fw-bold">
            {renderPlato(
              "txtEntrada",
              "ENTRADA 1",
              menuDia.entrada,
              menuDia.calEntrada
            )}

            {renderPlato(
              "txtFondo1",
              "FONDO 1",
              menuDia.fondo1,
              menuDia.calFondo1
            )}

            {renderPlato(
              "txtFondo2",
              "FONDO 2",
              menuDia.fondo2,
              menuDia.calFondo2
            )}

            <div className="row g-0 py-2 align-items-center px-2">
              <div className="col-12 col-md-2 text-start">DIETA :</div>

              <div
                className={`col-12 col-md-8 text-center fst-italic text-uppercase ${
                  loading ? "loading-dots" : ""
                }`}
              >
                {loading ? "CARGANDO" : menuDia.dieta || "-"}
              </div>

              <div className="col-12 col-md-2 text-md-end text-center">
                (<FaFire className="text-danger" /> {menuDia.calDieta || "0"}.00 Cal)
              </div>
            </div>
          </div>
        </div>

        {puedeVerFormulario && (
        <div id="seccionPedido" className="pedidos-actions">
          <button
            type="button"
            className="btn-notificaciones"
            onClick={solicitarPermisoNotificacionesManual}
          >
            <FaBell />
            <span>{textoNotificaciones}</span>
          </button>

          <label className="pedidos-label">
            Selecciona tu almuerzo del{" "}
            <span>{diaActivoServidor || "..."}</span>:
          </label>

          <select
            className="form-select select-custom"
            value={platoSeleccionado}
            disabled={offline}
            onChange={(e) => setPlatoSeleccionado(e.target.value)}
          >
            <option value="">-- Selecciona una opción --</option>
            <option value="PLATO DE FONDO 01">PLATO DE FONDO 01</option>
            <option value="PLATO DE FONDO 02">PLATO DE FONDO 02</option>
            <option value="DIETA">DIETA</option>
          </select>

          <button
            type="button"
            className="btn-confirmar-pedido"
            disabled={!puedeConfirmar || submitting}
            onClick={confirmarPedido}
          >
            {submitting ? <FaSpinner className="spin" /> : <FaCheck />}
          </button>
        </div>
      )}


        {renderMensajeEstado()}
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
