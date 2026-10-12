import { createBrowserRouter, Navigate } from "react-router-dom";

import Login from "../features/auth/Login"; // Asegúrate de que la ruta sea correcta
import MainLayout from "../layouts/MainLayout";
import Menu from "../features/dashboard/Menu";

// Importamos los arrays de rutas de cada módulo
import { almuerzosRoutes } from "./almuerzosRoutes";
import { usuariosRoutes } from "./usuariosRoutes";
import { mheRoutes } from "./mheRoutes";

export const router = createBrowserRouter([
  {
    path: "/",
    element: <Login />,
  },
  {
    // Rutas protegidas que comparten el MainLayout
    element: <MainLayout />,
    children: [
      { path: "menu", element: <Menu /> },
      ...almuerzosRoutes,
      ...usuariosRoutes,
      ...mheRoutes,
      // Si en el futuro agregas "inventario", solo sumas: ...inventarioRoutes
    ],
  },
  {
    // Ruta no encontrada (Catch-all)
    path: "*",
    element: <Navigate to="/menu" replace />,
  },
]);