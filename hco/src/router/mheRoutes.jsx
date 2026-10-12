import { lazy } from "react";
import LazyRoute from "../components/LazyRoute";

const TrackingMHE = lazy(() => import("../features/mhe_piv/tracking_mhe"));
const MheEvaluar = lazy(() => import("../features/mhe_piv/mhe_evaluar"));

export const mheRoutes = [
  { path: "mhe/tracking_mhe", element: <LazyRoute><TrackingMHE /></LazyRoute> },
  { path: "mhe/mhe_evaluar", element: <LazyRoute><MheEvaluar /></LazyRoute> },
];