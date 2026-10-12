import Pedidos from "../features/almuerzos/Pedidos";
import Admin from "../features/almuerzos/Admin";
import ListaPlatillo from "../features/almuerzos/ListaPlatillo";

export const almuerzosRoutes = [
  { path: "almuerzos/pedidos", element: <Pedidos /> },
  { path: "almuerzos/admin", element: <Admin /> },
  { path: "almuerzos/lista_platillo", element: <ListaPlatillo /> },
];
