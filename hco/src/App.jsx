import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";

import Login from "./features/auth/Login";
import MainLayout from "./layouts/MainLayout";
import Menu from "./features/dashboard/Menu";
import Pedidos from "./features/almuerzos/Pedidos";
import Admin from "./features/almuerzos/Admin";


function PaginaTemporal({ titulo, descripcion }) {
  return (
    <div
      style={{
        padding: "40px 18px",
        minHeight: "calc(100vh - var(--header-total-height))",
        background: "#eef3f8",
      }}
    >
      <div
        style={{
          maxWidth: "1200px",
          margin: "0 auto",
          background: "#ffffff",
          borderRadius: "18px",
          padding: "28px",
          boxShadow: "0 8px 24px rgba(15, 23, 42, 0.08)",
          border: "1px solid #dbe5ef",
          textAlign: "center",
        }}
      >
        <h2
          style={{
            margin: "0 0 10px",
            color: "#0f172a",
            fontSize: "28px",
            fontWeight: "900",
          }}
        >
          {titulo}
        </h2>

        <p
          style={{
            margin: 0,
            color: "#64748b",
            fontSize: "15px",
          }}
        >
          {descripcion || "Módulo pendiente de migración a React."}
        </p>
      </div>
    </div>
  );
}

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

          {/* Redirección de ruta antigua del menú */}
          <Route
            path="/Menu-Opciones/menu"
            element={<Navigate to="/menu" replace />}
          />

          {/* Almuerzos */}
          <Route path="/almuerzos/pedidos" element={<Pedidos />} />


          <Route path="/almuerzos/admin" element={<Admin />} />


          <Route
            path="/almuerzos/lista_platillo"
            element={
              <PaginaTemporal
                titulo="Editar Menú"
                descripcion="Aquí irá la gestión semanal de platillos."
              />
            }
          />

          {/* Tarjetas */}
          <Route
            path="/apps-tarjetas/anomalias"
            element={
              <PaginaTemporal
                titulo="Tarjetas de Anomalía"
                descripcion="Aquí irá el módulo de creación y seguimiento de anomalías."
              />
            }
          />

          <Route
            path="/apps-tarjetas/sugerencias"
            element={
              <PaginaTemporal
                titulo="Tarjetas de Sugerencia"
                descripcion="Aquí irá el módulo de registro y seguimiento de sugerencias."
              />
            }
          />

          {/* Cuadro Q */}
          <Route
            path="/cuadro-q"
            element={
              <PaginaTemporal
                titulo="Cuadro Q"
                descripcion="Aquí irá el módulo de registro y seguimiento de Cuadro Q."
              />
            }
          />

          {/* Reporte de discrepancia */}
          <Route
            path="/reporte-discrepancia"
            element={
              <PaginaTemporal
                titulo="Reporte de Discrepancia"
                descripcion="Aquí irá el módulo de reportes de discrepancias."
              />
            }
          />

          {/* Préstamos de pallet */}
          <Route
            path="/prestamos-pallet"
            element={
              <PaginaTemporal
                titulo="Préstamos de Pallet"
                descripcion="Aquí irá el módulo de control de préstamos de pallets."
              />
            }
          />

          {/* Configuración */}
          <Route
            path="/configuracion"
            element={
              <PaginaTemporal
                titulo="Configuración"
                descripcion="Aquí irá el módulo de administración de parámetros y accesos."
              />
            }
          />

          {/* Rutas antiguas HTML */}
          <Route
            path="/almuerzos/pedidos.html"
            element={<Navigate to="/almuerzos/pedidos" replace />}
          />

          <Route
            path="/almuerzos/admin.html"
            element={<Navigate to="/almuerzos/admin" replace />}
          />

          <Route
            path="/almuerzos/lista_platillo.html"
            element={<Navigate to="/almuerzos/lista_platillo" replace />}
          />

          <Route
            path="/Prestamos-Pallet/trackingprestamos.html"
            element={<Navigate to="/prestamos-pallet" replace />}
          />

          <Route
            path="/Cuadro-Q/trackingCuadroQ.html"
            element={<Navigate to="/cuadro-q" replace />}
          />

          <Route
            path="/Configuracion/configuracion.html"
            element={<Navigate to="/configuracion" replace />}
          />
        </Route>

        {/* Ruta no encontrada */}
        <Route path="*" element={<Navigate to="/menu" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
