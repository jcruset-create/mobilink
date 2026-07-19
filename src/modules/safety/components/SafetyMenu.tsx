import { Link, NavLink } from "react-router-dom";
import { Home } from "lucide-react";

const links = [
  { to: "/safety", label: "Dashboard", exact: true },
  { to: "/safety/epis", label: "EPIs" },
  { to: "/safety/entregas", label: "Entregas" },
  { to: "/safety/stock", label: "Stock" },
  { to: "/safety/documentos", label: "Documentos" },
  { to: "/safety/reuniones", label: "Reuniones" },
  { to: "/safety/formacion", label: "Formación" },
  { to: "/safety/inspecciones", label: "Inspecciones" },
];

export default function SafetyMenu() {
  return (
    <nav className="flex flex-wrap gap-2 border-b pb-3 mb-4">
      <span className="flex items-center gap-1 font-bold text-yellow-700 mr-2">
        🦺 Mobilink Safety Manager
      </span>
      {links.map((l) => (
        <NavLink
          key={l.to}
          to={l.to}
          end={l.exact}
          className={({ isActive }) =>
            `rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
              isActive
                ? "bg-yellow-500 text-white"
                : "bg-gray-100 text-gray-700 hover:bg-yellow-50 hover:text-yellow-700"
            }`
          }
        >
          {l.label}
        </NavLink>
      ))}
      <Link
        to="/inicio"
        title="Volver al menú principal"
        className="ml-auto flex items-center gap-1 rounded-lg bg-gray-100 px-3 py-1.5 text-sm font-medium text-gray-700 transition-colors hover:bg-yellow-50 hover:text-yellow-700"
      >
        <Home className="h-4 w-4" /> Inicio
      </Link>
    </nav>
  );
}
