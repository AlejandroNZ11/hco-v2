import { lazy } from "react";
import LazyRoute from "../components/LazyRoute";

const TrackingPrestamos = lazy(() => import("../features/prestamos_pallet/trackingprestamos"));
const ModalPrestamo = lazy(() => import("../features/prestamos_pallet/modal-prestamo"));
const DashboardPrestamosOperacional = lazy(() => import("../features/prestamos_pallet/dashboard/DashboardPrestamosOperacional"));
const DashboardPrestamosFinanciero = lazy(() => import("../features/prestamos_pallet/dashboard/DashboardPrestamosFinanciero"));
const TrackingConductores = lazy(() => import("../features/conductores/tracking_conductores"));
const TrackingPlacas = lazy(() => import("../features/placas/tracking_placas"));
const TrackingClientes = lazy(() => import("../features/clientes/tracking_clientes"));
const TrackingEmpresasTransporte = lazy(() => import("../features/empresas_transporte/tracking_empresas_transporte"));

export const prestamosRoutes = [
  { path: "prestamos/tracking", element: <LazyRoute><TrackingPrestamos /></LazyRoute> },
  { path: "prestamos/dashboard", element: <LazyRoute><DashboardPrestamosOperacional /></LazyRoute> },
  { path: "prestamos/dashboard/financiero", element: <LazyRoute><DashboardPrestamosFinanciero /></LazyRoute> },
  { path: "prestamos/nuevo",element: <LazyRoute><ModalPrestamo /></LazyRoute> },
  { path: "conductores/tracking", element: <LazyRoute><TrackingConductores /></LazyRoute> },
  { path: "placas/tracking", element: <LazyRoute><TrackingPlacas /></LazyRoute> },
  { path: "clientes/tracking", element: <LazyRoute><TrackingClientes /></LazyRoute> },
  { path: "empresas-transporte/tracking", element: <LazyRoute><TrackingEmpresasTransporte /></LazyRoute> },
];
