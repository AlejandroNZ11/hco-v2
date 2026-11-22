import { lazy } from "react";
import LazyRoute from "../components/LazyRoute";

// Visión Artificial: un solo componente con selector de 3 módulos (?modulo=epp|conteo|aforo)
// eslint-disable-next-line react-refresh/only-export-components -- archivo de rutas, no se recarga en caliente
const VisionIA = lazy(() => import("../features/vision_ia/vision_ia.jsx"));

export const visionRoutes = [
  { path: "vision/ia", element: <LazyRoute><VisionIA /></LazyRoute> },
];
