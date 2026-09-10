(function () {
  if (window.__almuerzoGlobalReminderManaged) return;
  window.__almuerzoGlobalReminderManaged = true;

  const API_URL = "https://script.google.com/macros/s/AKfycbyzQ67a7Fk4_U5ODe41GnIrQCezaQdpFInH_VFzLjHgQ1Yq99xxYZdXVFVovcV8gloW/exec";
  const CACHE_KEY_PREFIX = "almuerzo_global_cache_v1:";
  const REMINDER_KEY_PREFIX = "almuerzo_global_recordatorio_";
  const AUTO_PERMISSION_KEY = "almuerzo_global_auto_permission_prompt_v1";
  const CHECK_INTERVAL_MS = 60 * 1000;
  const REMINDER_INTERVAL_MS = 30 * 60 * 1000;
  const TARGET_URL = "/almuerzos/pedidos.html";

  let syncInterval = null;
  let usuario = null;

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  async function init() {
    usuario = getAuthUser();
    if (!usuario) return;

    conectarBotonManual();
    actualizarTextoBotonNotificacionesSegunEstado();
    cargarCache();
    await refrescarEstadoYRecordar(false);
    iniciarTemporizadores();
    configurarSolicitudAutomaticaPermiso();

    window.addEventListener("online", function () {
      refrescarEstadoYRecordar(true);
    });

    window.addEventListener("focus", function () {
      refrescarEstadoYRecordar(false);
    });

    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "visible") {
        refrescarEstadoYRecordar(false);
      }
    });
  }

  function getAuthUser() {
    const raw = localStorage.getItem("authUser") || sessionStorage.getItem("authUser");
    if (!raw) return null;

    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  function getDniUsuario() {
    return String(
      usuario?.dni ||
      usuario?.DNI ||
      usuario?.id ||
      usuario?.ID ||
      ""
    ).trim();
  }

  function getCuentaUsuario() {
    return String(
      usuario?.email ||
      usuario?.correo ||
      usuario?.usuario ||
      getDniUsuario()
    ).trim();
  }

  function getUsuarioKey() {
    return getDniUsuario() || getCuentaUsuario() || "anon";
  }

  function getCacheKey() {
    return CACHE_KEY_PREFIX + getUsuarioKey();
  }

  function cargarCache() {
    try {
      const raw = localStorage.getItem(getCacheKey());
      if (!raw) return null;
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  function guardarCache(data) {
    try {
      localStorage.setItem(getCacheKey(), JSON.stringify(data));
    } catch (_e) {}
  }

  async function apiPost(payload) {
    const url = API_URL + (API_URL.includes("?") ? "&" : "?") + "_ts=" + Date.now();

    const response = await fetch(url, {
        method: "POST",
        cache: "no-store",
        redirect: "follow",
        headers: {
        "Content-Type": "text/plain;charset=utf-8"
        },
        body: JSON.stringify(payload)
    });

    if (!response.ok) {
        throw new Error("Error HTTP: " + response.status);
    }

    return await response.json();
  }


  async function obtenerEstadoActual() {
    const [menuInfo, pedido] = await Promise.all([
      apiPost({ action: "getMenuInfo" }),
      apiPost({
        action: "getPedidoUsuario",
        dni: getDniUsuario(),
        cuenta: getCuentaUsuario()
      })
    ]);

    if (menuInfo.status !== "success") {
      throw new Error(menuInfo.message || "No se pudo obtener el menú.");
    }

    return {
      diaActivo: String(menuInfo.diaActivo || "").trim(),
      estado: String(menuInfo.estado || "").trim(),
      enviado: !!(pedido.status === "success" && pedido.enviado === true),
      pedido: pedido && pedido.pedido ? pedido.pedido : null,
      timestamp: Date.now()
    };
  }

  async function refrescarEstadoYRecordar(forzar) {
    if (!usuario) return;

    if (!navigator.onLine) {
      actualizarTextoBotonNotificacionesSegunEstado();
      return;
    }

    try {
      const estado = await obtenerEstadoActual();
      guardarCache(estado);
      actualizarTextoBotonNotificacionesSegunEstado();
      actualizarMensajeLocalSiExiste(estado);
      await enviarRecordatorioSiHaceFalta(estado, forzar);
    } catch (error) {
      console.warn("No se pudo refrescar recordatorio global:", error);
      actualizarTextoBotonNotificacionesSegunEstado();
    }
  }

  function actualizarMensajeLocalSiExiste(estado) {
    const msgEstadoPedido = document.getElementById("msgEstadoPedido");
    if (!msgEstadoPedido) return;

    if (estado.estado !== "Activo") return;
    if (!estado.diaActivo) return;

    if (estado.enviado) {
      msgEstadoPedido.className = "alert alert-success text-center mt-3 fw-bold";
      msgEstadoPedido.textContent =
        "Ya enviaste tu almuerzo del " +
        estado.diaActivo +
        ": " +
        String((estado.pedido && estado.pedido.plato) || "").trim() +
        ".";
      msgEstadoPedido.style.display = "block";
    } else {
      msgEstadoPedido.className = "alert alert-warning text-center mt-3 fw-bold";
      msgEstadoPedido.textContent =
        "No has enviado tu almuerzo del " + estado.diaActivo + ".";
      msgEstadoPedido.style.display = "block";
    }
  }

  function iniciarTemporizadores() {
    if (syncInterval) clearInterval(syncInterval);

    syncInterval = setInterval(function () {
      refrescarEstadoYRecordar(false);
    }, CHECK_INTERVAL_MS);
  }

  async function enviarRecordatorioSiHaceFalta(estado, forzar) {
    if (!estado) return;
    if (estado.estado !== "Activo") return;
    if (!estado.diaActivo) return;
    if (estado.enviado) return;

    const clave = REMINDER_KEY_PREFIX + estado.diaActivo + "_" + getUsuarioKey();
    const ultimo = Number(localStorage.getItem(clave) || "0");
    const ahora = Date.now();

    if (!forzar && ahora - ultimo < REMINDER_INTERVAL_MS) {
      return;
    }

    localStorage.setItem(clave, String(ahora));

    await lanzarNotificacionLocal(
      "Recordatorio de almuerzo",
      "No has enviado tu almuerzo del " + estado.diaActivo + ". Regístralo a tiempo."
    );
  }

  async function lanzarNotificacionLocal(titulo, mensaje) {
    if (!("Notification" in window)) return false;
    if (Notification.permission !== "granted") return false;

    const opciones = {
      body: mensaje,
      icon: "/img/recordatorio-almuerzo.png",
      badge: "/img/record-almuerzo.png",
      tag: "recordatorio-almuerzo-" + getUsuarioKey(),
      renotify: true,
      requireInteraction: true,
      vibrate: [200, 100, 200],
      data: {
        url: TARGET_URL
      }
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
  }

  function esIOS() {
    return /iPad|iPhone|iPod/.test(navigator.userAgent) ||
      (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  }

  function esSafariIOS() {
    const ua = navigator.userAgent;
    return esIOS() && /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS/.test(ua);
  }

  function estaInstaladaComoApp() {
    return window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
  }

  function conectarBotonManual() {
    const btn = document.getElementById("btnActivarNotificaciones");
    if (!btn || btn.dataset.globalReminderBound === "1") return;

    btn.dataset.globalReminderBound = "1";
    btn.addEventListener("click", solicitarPermisoNotificacionesManual);
  }

  function actualizarTextoBotonNotificaciones(texto) {
    const btn = document.getElementById("btnActivarNotificaciones");
    if (!btn) return;
    btn.innerHTML = '<i class="fas fa-bell me-2"></i>' + texto;
  }

  function actualizarTextoBotonNotificacionesSegunEstado() {
    const btn = document.getElementById("btnActivarNotificaciones");
    if (!btn) return;

    if (!("Notification" in window)) {
      actualizarTextoBotonNotificaciones("No compatible");
      return;
    }

    if (Notification.permission === "granted") {
      actualizarTextoBotonNotificaciones("Recordatorios activados");
      return;
    }

    if (Notification.permission === "denied") {
      actualizarTextoBotonNotificaciones("Notificaciones bloqueadas");
      return;
    }

    actualizarTextoBotonNotificaciones("Activar recordatorios");
  }

  async function solicitarPermisoNotificacionesManual() {
    if (!("Notification" in window)) return;

    if (esIOS() && !esSafariIOS()) return;
    if (esIOS() && !estaInstaladaComoApp()) return;

    try {
      const permiso = await Notification.requestPermission();
      actualizarTextoBotonNotificacionesSegunEstado();

      if (permiso === "granted") {
        await refrescarEstadoYRecordar(true);
      }
    } catch (error) {
      console.warn("No se pudo solicitar permiso manual:", error);
    }
  }

  function configurarSolicitudAutomaticaPermiso() {
    if (!("Notification" in window)) return;
    if (Notification.permission !== "default") return;
    if (localStorage.getItem(AUTO_PERMISSION_KEY) === "done") return;

    let ejecutado = false;

    const handler = async function () {
      if (ejecutado) return;
      ejecutado = true;

      document.removeEventListener("click", handler);
      document.removeEventListener("touchstart", handler);
      document.removeEventListener("keydown", handler);

      localStorage.setItem(AUTO_PERMISSION_KEY, "done");
      await solicitarPermisoNotificacionesAutomatica();
    };

    document.addEventListener("click", handler, { once: true });
    document.addEventListener("touchstart", handler, { once: true });
    document.addEventListener("keydown", handler, { once: true });
  }

  async function solicitarPermisoNotificacionesAutomatica() {
    if (!("Notification" in window)) return;
    if (Notification.permission !== "default") return;

    if (esIOS() && !esSafariIOS()) return;
    if (esIOS() && !estaInstaladaComoApp()) return;

    try {
      const permiso = await Notification.requestPermission();
      actualizarTextoBotonNotificacionesSegunEstado();

      if (permiso === "granted") {
        await refrescarEstadoYRecordar(true);
      }
    } catch (error) {
      console.warn("No se pudo solicitar permiso automático:", error);
    }
  }
})();
