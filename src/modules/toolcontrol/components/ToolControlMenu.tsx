import { NavLink } from "react-router-dom";

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
        🔧 SEA ToolControl
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
    </nav>
  );
}
