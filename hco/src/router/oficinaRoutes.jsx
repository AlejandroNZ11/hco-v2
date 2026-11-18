import { lazy } from "react";
import LazyRoute from "../components/LazyRoute";

const OficinaLogistica = lazy(() => import("../features/oficina_logistica/oficina_logistica.jsx"));

export const oficinaRoutes = [
  { path: "oficina/logistica", element: <LazyRoute><OficinaLogistica /></LazyRoute> },
];
