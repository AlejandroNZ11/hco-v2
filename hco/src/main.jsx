import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import "bootstrap/dist/css/bootstrap.min.css";
import "./index.css";

import App from "./App.jsx";

// Seguridad: sesiones guardadas por versiones anteriores incluían la contraseña (`cl`) dentro de
// authUser. Se limpia una vez al arrancar, antes de que cualquier pantalla lo lea.
for (const almacen of [localStorage, sessionStorage]) {
  try {
    const raw = almacen.getItem("authUser");
    const user = raw ? JSON.parse(raw) : null;
    if (user && typeof user === "object" && "cl" in user) {
      delete user.cl;
      almacen.setItem("authUser", JSON.stringify(user));
    }
  } catch {
    // authUser corrupto: useAuth ya lo descarta
  }
}

// Seguridad: la huella de versiones anteriores guardaba la contraseña en base64 (`_p`). Se borra;
// ahora la huella reutiliza la sesión de Supabase del dispositivo.
try {
  const bio = JSON.parse(localStorage.getItem("hco_bio") || "null");
  if (bio && typeof bio === "object" && "_p" in bio) {
    delete bio._p;
    localStorage.setItem("hco_bio", JSON.stringify(bio));
  }
} catch {
  localStorage.removeItem("hco_bio");
}

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <App />
  </StrictMode>
);
