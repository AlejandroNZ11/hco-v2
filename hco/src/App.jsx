import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";

import Login from "./features/auth/Login";
import MainLayout from "./layouts/MainLayout";
import Menu from "./features/dashboard/Menu";

function PaginaTemporal({ titulo }) {
  return (
    <div style={{ padding: "40px", textAlign: "center" }}>
      <h2>{titulo}</h2>
      <p>Contenido temporal.</p>
    </div>
  );
}

function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* Login */}
        <Route path="/" element={<Login />} />

        {/* Rutas con cabecera */}
        <Route element={<MainLayout />}>
          <Route path="/menu" element={<Menu />} />

          <Route
            path="/Menu-Opciones/menu"
            element={<Navigate to="/menu" replace />}
          />

          <Route
            path="/almuerzos/pedidos"
            element={<PaginaTemporal titulo="Pedidos de Almuerzo" />}
          />

          <Route
            path="/almuerzos/admin"
            element={<PaginaTemporal titulo="Administración Global" />}
          />

          <Route
            path="/almuerzos/lista_platillo"
            element={<PaginaTemporal titulo="Editar Menú" />}
          />
        </Route>

        {/* Ruta no encontrada */}
        <Route path="*" element={<Navigate to="/menu" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
