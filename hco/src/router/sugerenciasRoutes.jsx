import { lazy } from "react";
import LazyRoute from "../components/LazyRoute";

const TrackingSugerencias = lazy(() => import("../features/tarjetas_sugerencias/trackingSugerencias.jsx"));
const RegistrarSugerencias = lazy(() => import("../features/tarjetas_sugerencias/registrarSugerencias.jsx"));

export const sugerenciasRoutes = [
  { path: "sugerencias/tracking", element: <LazyRoute><TrackingSugerencias /></LazyRoute> },
  { path: "sugerencias/registrar", element: <LazyRoute><RegistrarSugerencias /></LazyRoute> },
];

