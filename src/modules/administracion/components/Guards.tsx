import { Navigate, Outlet } from "react-router-dom";
import { useAdminAuth } from "../contexts/AdminAuthContext";
import type { Rol } from "../types";

function Pantalla({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-900 p-6">
      <div className="max-w-md rounded-2xl border border-amber-500/40 bg-amber-500/10 p-6 text-sm text-amber-300">
        {children}
      </div>
    </div>
  );
}

/** Requiere sesión + perfil activo. */
export function ProtectedRoute() {
  const { user, perfil, loading } = useAdminAuth();
  if (loading) {
    return <div className="flex min-h-screen items-center justify-center bg-slate-900 text-slate-400">Cargando…</div>;
  }
  if (!user) return <Navigate to="/administracion/login" replace />;
  if (!perfil || !perfil.activo) {
    return <Pantalla>No hay un perfil activo vinculado a esta cuenta. Contacta con el administrador.</Pantalla>;
  }
  return <Outlet />;
}

/** Requiere uno de estos roles (el admin siempre pasa). */
export function RoleRoute({ roles }: { roles: Rol[] }) {
  const { perfil } = useAdminAuth();
  const ok = perfil && (perfil.rol === "admin" || roles.includes(perfil.rol));
  if (!ok) {
    return (
      <div className="p-4">
        <div className="max-w-md rounded-2xl border border-amber-500/40 bg-amber-500/10 p-6 text-sm text-amber-300">
          No tienes permiso para acceder a esta pantalla.
        </div>
      </div>
    );
  }
  return <Outlet />;
}
