import { Link, NavLink } from "react-router-dom";
import { Home } from "lucide-react";

const LINKS = [
  { to: "/presencia",          label: "Dashboard" },
  { to: "/presencia/fichajes", label: "Fichajes" },
];

export default function PresenciaMenu() {
  return (
    <nav className="flex flex-wrap gap-1 mb-2">
      {LINKS.map((l) => (
        <NavLink key={l.to} to={l.to} end={l.to === "/presencia"}
          className={({ isActive }) =>
            `rounded-lg px-4 py-1.5 text-sm font-medium transition-colors ${
              isActive ? "bg-gray-800 text-white" : "text-gray-600 hover:bg-gray-100"
            }`
          }>
          {l.label}
        </NavLink>
      ))}
      <Link
        to="/inicio"
        title="Volver al menú principal"
        className="ml-auto flex items-center gap-1 rounded-lg px-4 py-1.5 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-100"
      >
        <Home className="h-4 w-4" /> Inicio
      </Link>
    </nav>
  );
}
