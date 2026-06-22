import { NavLink, Link } from "react-router-dom";

const links = [
  { to: "/sea-core",              label: "Dashboard",         exact: true, icon: "▪" },
  { to: "/sea-core/empleados",    label: "Empleados",         exact: false, icon: "▪" },
  { to: "/sea-core/empresas",     label: "Empresas",          exact: false, icon: "▪" },
  { to: "/sea-core/centros",      label: "Centros de trabajo",exact: false, icon: "▪" },
  { to: "/sea-core/competencias", label: "Competencias",      exact: false, icon: "▪" },
  { to: "/sea-core/autorizaciones",label: "Autorizaciones",   exact: false, icon: "▪" },
];

export default function CoreMenu() {
  return (
    <div className="bg-white border-b">
      {/* Topbar */}
      <div className="max-w-7xl mx-auto px-6 flex items-center justify-between h-14">
        <Link to="/sea-core" className="flex items-center gap-2.5">
          <div className="h-7 w-7 rounded-lg bg-gray-900 flex items-center justify-center">
            <span className="text-white text-xs font-black">SC</span>
          </div>
          <span className="font-bold text-gray-900 text-sm tracking-tight">SEA Core</span>
        </Link>

        <nav className="flex items-center gap-1">
          {links.map((l) => (
            <NavLink
              key={l.to}
              to={l.to}
              end={l.exact}
              className={({ isActive }) =>
                `px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                  isActive
                    ? "bg-gray-900 text-white shadow-sm"
                    : "text-gray-500 hover:text-gray-900 hover:bg-gray-100"
                }`
              }
            >
              {l.label}
            </NavLink>
          ))}
        </nav>

        <Link to="/sea" className="text-xs text-gray-400 hover:text-gray-600 transition-colors flex items-center gap-1">
          ← Hub
        </Link>
      </div>
    </div>
  );
}
