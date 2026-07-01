import { Navigate, Outlet } from "react-router-dom";
import { useTyreAuth } from "../contexts/TyreAuthContext";
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

/** Requiere sesión + perfil activo + acceso al panel web. */
export function ProtectedRoute() {
  const { user, perfil, loading } = useTyreAuth();
  if (loading) {
    return <div className="flex min-h-screen items-center justify-center bg-slate-900 text-slate-400">Cargando…</div>;
  }
  if (!user) return <Navigate to="/tyrecontrol/login" replace />;
  if (!perfil || !perfil.activo) {
    return <Pantalla>No hay un perfil activo vinculado a esta cuenta. Contacta con el administrador.</Pantalla>;
  }
  if (!perfil.es_superadmin && !perfil.acceso_panel) {
    return <Pantalla>Tu cuenta no tiene acceso al panel web (solo APK).</Pantalla>;
  }
  return <Outlet />;
}

/** Requiere un rol concreto (el super-admin siempre pasa). */
export function RoleRoute({ roles }: { roles: Rol[] }) {
  const { perfil } = useTyreAuth();
  const ok = perfil && (perfil.es_superadmin || roles.includes(perfil.rol));
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
