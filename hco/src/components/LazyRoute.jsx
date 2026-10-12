import React, { Suspense } from "react";
import Loading from "../layouts/Loading"; // Usando tu componente Loading existente
import ErrorBoundary from "./ErrorBoundary";

const LazyRoute = ({ children }) => (
  <ErrorBoundary>
    <Suspense fallback={<Loading />}>{children}</Suspense>
  </ErrorBoundary>
);

export default LazyRoute;
