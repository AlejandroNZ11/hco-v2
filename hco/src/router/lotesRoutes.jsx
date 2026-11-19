import { lazy } from "react";
import LazyRoute from "../components/LazyRoute";

const Toma_Lotes = lazy(() => import("../features/toma_lotes/toma_lotes.jsx"));

export const lotesRoutes = [
  { path: "toma/lotes", element: <LazyRoute><Toma_Lotes /></LazyRoute> },
];
