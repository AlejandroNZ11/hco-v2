import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../config/supabaseClient';
import { guardarClaveEmpleado } from '../services/empleadosService';

const LOGIN_URL = "/";

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

export function useAuth() {
  const navigate = useNavigate();
  const [authUser] = useState(() => getStoredAuthUser());

  useEffect(() => {
    if (!authUser) {
      navigate(LOGIN_URL, { replace: true });
      return;
    }
    syncSessionFromLocal(authUser);
  }, [authUser, navigate]);

  const ejecutarCierreSesion = () => {
    localStorage.removeItem("authUser");
    sessionStorage.removeItem("authUser");
    // Con huella activa la sesión de Supabase se conserva en el dispositivo: la huella la vuelve a
    // abrir sin guardar la contraseña. Sin huella, se cierra también en el servidor.
    if (!localStorage.getItem("hco_bio")) supabase.auth.signOut();
    navigate(LOGIN_URL, { replace: true });
  };

  const cambiarPassword = async (nuevaPassword) => {
    const nuevaPass = String(nuevaPassword || "").trim();
    if (!nuevaPass || nuevaPass.length < 6) {
      throw new Error("La contraseña debe tener al menos 6 caracteres.");
    }

    // 1. ACTUALIZA LA BÓVEDA DE SEGURIDAD (Supabase Auth)
    const { error: authError } = await supabase.auth.updateUser({
      password: nuevaPass
    });
    if (authError) throw authError;

    // 2. Copia la clave a empleados.cl (para que el SUPERADMIN pueda recordársela al usuario).
    //    No se guarda en authUser: la contraseña no queda en el navegador.
    if (authUser?.id) {
      try {
        await guardarClaveEmpleado(authUser.id, nuevaPass);
      } catch (err) {
        throw new Error("Auth actualizado, pero falló la tabla: " + err.message, { cause: err });
      }
    }
  };

  return { authUser, ejecutarCierreSesion, cambiarPassword };
}