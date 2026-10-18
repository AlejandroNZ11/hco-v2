import { createBrowserRouter, Navigate } from "react-router-dom";

import Login from "../features/auth/Login";
import MainLayout from "../layouts/MainLayout";
import Menu from "../features/dashboard/Menu";

import { almuerzosRoutes } from "./almuerzosRoutes";
import { usuariosRoutes } from "./usuariosRoutes";
import { mheRoutes } from "./mheRoutes";
import { cuadroQRoutes } from "./cuadroQRoutes"; // <-- 1. Importar

export const router = createBrowserRouter([
  {
    path: "/",
    element: <Login />,
  },
  {
    element: <MainLayout />,
    children: [
      { path: "menu", element: <Menu /> },
      ...almuerzosRoutes,
      ...usuariosRoutes,
      ...mheRoutes,
      ...cuadroQRoutes, // <-- 2. Agregar aquí
    ],
  },
  {
    path: "*",
    element: <Navigate to="/menu" replace />,
  },
]);
