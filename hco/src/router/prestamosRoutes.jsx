import { lazy } from "react";
import LazyRoute from "../components/LazyRoute";

const TrackingPrestamos = lazy(() => import("../features/prestamos_pallet/trackingprestamos"));
const ModalPrestamo = lazy(() => import("../features/prestamos_pallet/modal-prestamo"));

export const prestamosRoutes = [
  { path: "prestamos/tracking", element: <LazyRoute><TrackingPrestamos /></LazyRoute> },
  { path: "prestamos/nuevo", element: <LazyRoute><ModalPrestamo /></LazyRoute> },
];
