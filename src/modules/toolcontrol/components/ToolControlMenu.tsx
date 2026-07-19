import { Link, NavLink } from "react-router-dom";
import { Home } from "lucide-react";

const links = [
  { to: "/toolcontrol", label: "Dashboard", exact: true },
  { to: "/toolcontrol/herramientas", label: "Herramientas" },
  { to: "/toolcontrol/maquinas", label: "Máquinas" },
  { to: "/toolcontrol/movimientos", label: "Movimientos" },
  { to: "/toolcontrol/mantenimiento", label: "Mantenimiento" },
  { to: "/toolcontrol/inventario", label: "Inventario" },
  { to: "/toolcontrol/incidencias", label: "Incidencias" },
  { to: "/toolcontrol/ubicaciones", label: "Ubicaciones" },
  { to: "/toolcontrol/categorias", label: "Categorías" },
];

export default function ToolControlMenu() {
  return (
    <nav className="flex flex-wrap gap-2 border-b pb-3 mb-4">
      <span className="flex items-center gap-1 font-bold text-blue-700 mr-2">
        🔧 Mobilink ToolControl
      </span>
      {links.map((l) => (
        <NavLink
          key={l.to}
          to={l.to}
          end={l.exact}
          className={({ isActive }) =>
            `rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
              isActive
                ? "bg-blue-600 text-white"
                : "bg-gray-100 text-gray-700 hover:bg-blue-50 hover:text-blue-700"
            }`
          }
        >
          {l.label}
        </NavLink>
      ))}
      <Link
        to="/inicio"
        title="Volver al menú principal"
        className="ml-auto flex items-center gap-1 rounded-lg bg-gray-100 px-3 py-1.5 text-sm font-medium text-gray-700 transition-colors hover:bg-blue-50 hover:text-blue-700"
      >
        <Home className="h-4 w-4" /> Inicio
      </Link>
    </nav>
  );
}
