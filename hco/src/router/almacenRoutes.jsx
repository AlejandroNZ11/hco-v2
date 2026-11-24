import { lazy } from "react";
import LazyRoute from "../components/LazyRoute";

const Almacen3D = lazy(() => import("../features/almacen_3d/Almacen3D.jsx"));

export const almacenRoutes = [
  { path: "almacen/3d", element: <LazyRoute><Almacen3D /></LazyRoute> },
];
