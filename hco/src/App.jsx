import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";

import Login from "./features/auth/Login";
import MainLayout from "./layouts/MainLayout";
import Menu from "./features/dashboard/Menu";
import Pedidos from "./features/almuerzos/Pedidos";
import Admin from "./features/almuerzos/Admin";
import ListaPlatillo from "./features/almuerzos/ListaPlatillo";
import RegistrarUsuario from "./features/usuarios/registra_usuario";
import TrackingUsuarios from "./features/usuarios/tracking_usuarios";


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
          {/* MÓDULO DE USUARIOS (NUEVO)                */}
          {/* ========================================= */}
          <Route path="/usuarios/tracking_usuarios" element={<TrackingUsuarios />} />
          <Route path="/usuarios/registra_usuario" element={<RegistrarUsuario />} />
          
          
          {/* Redirección para usuarios si es que lo tenían mapeado en HTML antes */}
          <Route path="/Usuarios/tracking_usuarios.html" element={<Navigate to="/usuarios/tracking_usuarios" replace />} />
        </Route>

        {/* Ruta no encontrada */}
        <Route path="*" element={<Navigate to="/menu" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
