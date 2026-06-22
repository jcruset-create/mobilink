import { NavLink } from "react-router-dom";

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
    </nav>
  );
}
