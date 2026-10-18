import { lazy } from "react";
import LazyRoute from "../components/LazyRoute";

const TrackingCuadroQ = lazy(() => import("../features/cuadro_q/trackingCuadroQ"));
const RegistroCuadroQ = lazy(() => import("../features/cuadro_q/Registro-cuadroQ"));

export const cuadroQRoutes = [
  { path: "cuadro_q/trackingCuadroQ", element: <LazyRoute><TrackingCuadroQ /></LazyRoute> },
  { path: "cuadro_q/Registro-cuadroQ", element: <LazyRoute><RegistroCuadroQ /></LazyRoute> },
];
