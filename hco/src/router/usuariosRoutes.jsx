import { lazy } from "react";
import LazyRoute from "../components/LazyRoute"; // Asegúrate de que la ruta coincida con donde creaste el componente

// 1. Convertimos las importaciones estáticas a dinámicas (Lazy Loading)
const TrackingUsuarios = lazy(() => import("../features/usuarios/tracking_usuarios"));
const RegistrarUsuario = lazy(() => import("../features/usuarios/registra_usuario"));

// 2. Envolvemos cada componente con <LazyRoute> para aplicar el ErrorBoundary y el Suspense
export const usuariosRoutes = [
  { path: "usuarios/tracking_usuarios", element: (<LazyRoute><TrackingUsuarios /></LazyRoute>)},
  { path: "usuarios/registra_usuario", element: (<LazyRoute><RegistrarUsuario /></LazyRoute>)},
];
