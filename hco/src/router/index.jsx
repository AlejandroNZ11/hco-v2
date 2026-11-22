import { createBrowserRouter, Navigate } from "react-router-dom";

import Login from "../features/auth/Login";
import MainLayout from "../layouts/MainLayout";
import Menu from "../features/dashboard/Menu";

import { almuerzosRoutes } from "./almuerzosRoutes";
import { usuariosRoutes } from "./usuariosRoutes";
import { mheRoutes } from "./mheRoutes";
import { cuadroQRoutes } from "./cuadroQRoutes"; 
import { prestamosRoutes } from './prestamosRoutes';
import { sugerenciasRoutes } from "./sugerenciasRoutes";
import { lupRoutes } from "./lupRoutes";
import { oficinaRoutes } from "./oficinaRoutes";
import { lotesRoutes } from "./lotesRoutes";
import { generar_rdrRoutes } from "./generar_rdrRoutes";
import { visionRoutes } from "./visionRoutes";

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
      ...cuadroQRoutes, 
      ...prestamosRoutes,
      ...sugerenciasRoutes,
      ...lupRoutes,
      ...oficinaRoutes,
      ...lotesRoutes,
      ...generar_rdrRoutes,
      ...visionRoutes,
    
    ],
  },
  {
    path: "*",
    element: <Navigate to="/menu" replace />,
  },
]);
