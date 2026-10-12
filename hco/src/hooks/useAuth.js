import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../config/supabaseClient';

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
  const [authUser, setAuthUser] = useState(() => getStoredAuthUser());

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
    supabase.auth.signOut();
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

    // 2. ACTUALIZA LA TABLA VISUAL 'EMPLEADOS'
    if (authUser?.id) {
      const { error: dbError } = await supabase.from('empleados')
        .update({ clave: nuevaPass })
        .eq('id', authUser.id);
      
      if (dbError) throw new Error("Auth actualizado, pero falló la tabla: " + dbError.message);
      
      const sessionActual = { ...authUser, clave: nuevaPass };
      localStorage.setItem("authUser", JSON.stringify(sessionActual));
      sessionStorage.setItem("authUser", JSON.stringify(sessionActual));
      setAuthUser(sessionActual); // Actualizar estado local
    }
  };

  return { authUser, ejecutarCierreSesion, cambiarPassword };
}