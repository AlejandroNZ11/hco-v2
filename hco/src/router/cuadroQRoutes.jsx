import { lazy } from "react";
import LazyRoute from "../components/LazyRoute";

const TrackingCuadroQ = lazy(() => import("../features/cuadro_q/trackingCuadroQ"));
const RegistroCuadroQ = lazy(() => import("../features/cuadro_q/Registro-cuadroQ"));
const PizarraCuadroQ = lazy(() => import("../features/cuadro_q/pizarra-cuadro-Q"));

export const cuadroQRoutes = [
  { path: "cuadro_q/trackingCuadroQ", element: <LazyRoute><TrackingCuadroQ /></LazyRoute> },
  { path: "cuadro_q/Registro-cuadroQ", element: <LazyRoute><RegistroCuadroQ /></LazyRoute> },
  { path: "cuadro_q/pizarraCuadroQ", element: <LazyRoute><PizarraCuadroQ /></LazyRoute> },
];
