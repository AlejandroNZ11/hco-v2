import { lazy } from "react";
import LazyRoute from "../components/LazyRoute";

const Generar_rdr = lazy(() => import("../features/generacion_rdr/generar_rdr.jsx"));

export const generar_rdrRoutes = [
  { path: "generar_rdr/track", element: <LazyRoute><Generar_rdr /></LazyRoute> },
];
