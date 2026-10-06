import React, { Suspense, lazy } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";

// IMPORTACIONES TRADICIONALES (Módulos Core que siempre deben cargar rápido)
import Login from "./features/auth/Login";
import MainLayout from "./layouts/MainLayout";
import Menu from "./features/dashboard/Menu";
import Pedidos from "./features/almuerzos/Pedidos";
import Admin from "./features/almuerzos/Admin";
import ListaPlatillo from "./features/almuerzos/ListaPlatillo";
import RegistrarUsuario from "./features/usuarios/registra_usuario";
import TrackingUsuarios from "./features/usuarios/tracking_usuarios";

// IMPORTANTE: Un componente visual de carga mientras se baja el pedazo de código
import Loading from "./layouts/Loading"; 

// ========================================================
// IMPORTACIONES LAZY (Arquitectura "Anti-caídas" / Micro-frontends)
// ========================================================
// Estos archivos NO se descargan en el celular del usuario hasta que 
// hacen clic en su botón correspondiente en el menú.
const TrackingMHE = lazy(() => import("./features/mhe_piv/tracking_mhe"));
const MheEvaluar = lazy(() => import("./features/mhe_piv/mhe_evaluar"));

function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* Login */}
        <Route path="/" element={<Login />} />

        {/* Rutas protegidas con cabecera */}
        <Route element={<MainLayout />}>
        
          {/* Menú principal */}
          <Route path="/menu" element={<Menu />} />

          {/* ========================================= */}
          {/* MÓDULO DE ALMUERZOS                       */}
          {/* ========================================= */}
          <Route path="/almuerzos/pedidos" element={<Pedidos />} />
          <Route path="/almuerzos/admin" element={<Admin />} />
          <Route path="/almuerzos/lista_platillo" element={<ListaPlatillo />} />

          {/* ========================================= */}
          {/* MÓDULO DE USUARIOS                        */}
          {/* ========================================= */}
          <Route path="/usuarios/tracking_usuarios" element={<TrackingUsuarios />} />
          <Route path="/usuarios/registra_usuario" element={<RegistrarUsuario />} />

          {/* ========================================= */}
          {/* MÓDULO DE MHE (PIV) AISLADO CON SUSPENSE  */}
          {/* ========================================= */}
          <Route path="/mhe/tracking_mhe" element={<Suspense fallback={<Loading />}><TrackingMHE /></Suspense>}/>
          <Route path="/mhe/mhe_evaluar" element={<Suspense fallback={<Loading />}><MheEvaluar /></Suspense>}/>
 
        </Route>

        {/* Ruta no encontrada */}
        <Route path="*" element={<Navigate to="/menu" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
