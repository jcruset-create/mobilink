import { NavLink } from "react-router-dom";

const links = [
  { to: "/sea-core", label: "Dashboard", exact: true },
  { to: "/sea-core/empleados", label: "Empleados" },
  { to: "/sea-core/empresas", label: "Empresas" },
  { to: "/sea-core/centros", label: "Centros de trabajo" },
  { to: "/sea-core/competencias", label: "Competencias" },
  { to: "/sea-core/autorizaciones", label: "Autorizaciones" },
];

export default function CoreMenu() {
  return (
    <nav className="flex flex-wrap gap-2 border-b pb-3 mb-4">
      <span className="flex items-center gap-1 font-bold text-gray-800 mr-2">
        🏢 SEA Core
      </span>
      {links.map((l) => (
        <NavLink
          key={l.to}
          to={l.to}
          end={l.exact}
          className={({ isActive }) =>
            `rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
              isActive
                ? "bg-gray-800 text-white"
                : "bg-gray-100 text-gray-700 hover:bg-gray-200"
            }`
          }
        >
          {l.label}
        </NavLink>
      ))}
    </nav>
  );
}
