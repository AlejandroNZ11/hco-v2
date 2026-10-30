import { lazy } from "react";
import LazyRoute from "../components/LazyRoute";

const TrackingLup = lazy(() => import("../features/lup/tracking_lup"));

export const lupRoutes = [
  { path: "lup/tracking", element: <LazyRoute><TrackingLup /></LazyRoute> },
];
