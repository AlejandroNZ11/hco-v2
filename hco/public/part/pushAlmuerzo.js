(function () {
  if (window.__pushAlmuerzoStarted) return;
  window.__pushAlmuerzoStarted = true;

  let firebaseReady = false;
  let messagingInstance = null;

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initPushAlmuerzo);
  } else {
    initPushAlmuerzo();
  }

  async function initPushAlmuerzo() {
    try {
      if (!window.firebase) return;
      if (!window.FIREBASE_CONFIG) return;
      if (!window.FIREBASE_VAPID_KEY) return;
      if (!("serviceWorker" in navigator)) return;
      if (!("Notification" in window)) return;

      if (!firebase.apps.length) {
        firebase.initializeApp(window.FIREBASE_CONFIG);
      }

      messagingInstance = firebase.messaging();
      firebaseReady = true;

      configurarMensajesEnPrimerPlano(messagingInstance);

      if (Notification.permission === "granted") {
        await registrarPushToken();
      }
    } catch (error) {
      console.error("Push init error:", error);
    }
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

  function getCanonicalUsuario(user) {
    return String(
      user?.usuario ||
      user?.email ||
      user?.dni ||
      ""
    ).trim();
  }

  function getDni(user) {
    return String(
      user?.dni ||
      user?.DNI ||
      user?.id ||
      user?.ID ||
      ""
    ).trim();
  }

  function getNombre(user) {
    return String(user?.nombre || "").trim();
  }

  function getTokenCacheKey(user) {
    return "push_token_almuerzo_" + getCanonicalUsuario(user);
  }

  async function registrarPushToken() {
    if (!firebaseReady || !messagingInstance) return;
    if (Notification.permission !== "granted") return;

    const user = getAuthUser();
    if (!user) return;

    try {
      const registration = await navigator.serviceWorker.ready;

      const token = await messagingInstance.getToken({
        vapidKey: window.FIREBASE_VAPID_KEY,
        serviceWorkerRegistration: registration
      });

      if (!token) {
        console.warn("No se obtuvo token FCM.");
        return;
      }

      const cacheKey = getTokenCacheKey(user);
      const oldToken = localStorage.getItem(cacheKey);

      if (oldToken === token) {
        console.log("Token FCM sin cambios.");
        return;
      }

      const response = await fetch(window.ALMUERZO_PUSH_API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "text/plain;charset=utf-8"
        },
        body: JSON.stringify({
          action: "registrarPushToken",
          usuarioLogin: getCanonicalUsuario(user),
          dni: getDni(user),
          nombre: getNombre(user),
          token,
          userAgent: navigator.userAgent
        })
      });

      const data = await response.json();

      if (!data.ok && data.status !== "success") {
        console.error("No se pudo guardar token:", data.message || data.detail);
        return;
      }

      localStorage.setItem(cacheKey, token);
      console.log("Token push guardado correctamente.");
    } catch (error) {
      console.error("Error registrando token push:", error);
    }
  }

  function configurarMensajesEnPrimerPlano(messaging) {
    if (!messaging) return;

    messaging.onMessage(async function (payload) {
      try {
        const title =
          payload?.notification?.title ||
          payload?.data?.title ||
          "Recordatorio";

        const body =
          payload?.notification?.body ||
          payload?.data?.body ||
          "Tienes una notificación pendiente.";

        const url =
          payload?.data?.url ||
          "/almuerzos/pedidos";

        const reg = await navigator.serviceWorker.ready;

        await reg.showNotification(title, {
          body,
          icon: "/img/logo.png",
          badge: "/img/logo.png",
          tag: "almuerzo-push-foreground",
          renotify: true,
          requireInteraction: true,
          data: { url }
        });
      } catch (error) {
        console.error("Error mostrando push en primer plano:", error);
      }
    });
  }

  window.registrarPushTokenAlmuerzo = registrarPushToken;
})();
