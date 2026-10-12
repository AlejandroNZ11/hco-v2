import React from "react";
import { RouterProvider } from "react-router-dom";
import { router } from "./router"; // Importa el index.jsx por defecto de la carpeta router

function App() {
  return <RouterProvider router={router} />;
}

export default App;
