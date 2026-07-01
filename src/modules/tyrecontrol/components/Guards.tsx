import { Navigate, Outlet } from "react-router-dom";
import { useTyreAuth } from "../contexts/TyreAuthContext";
import type { Rol } from "../types";

function Cargando() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 text-slate-500">
      Cargando…
    </div>
  );
}

/** Requiere sesión + perfil activo + acceso al panel web. */
export function ProtectedRoute() {
  const { user, perfil, loading } = useTyreAuth();
  if (loading) return <Cargando />;
  if (!user) return <Navigate to="/tyrecontrol/login" replace />;
  if (!perfil || !perfil.activo) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 p-6">
        <div className="max-w-md rounded-2xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-800">
          No hay un perfil activo vinculado a esta cuenta. Contacta con el administrador.
        </div>
      </div>
    );
  }
  if (!perfil.es_superadmin && !perfil.acceso_panel) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 p-6">
        <div className="max-w-md rounded-2xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-800">
          Tu cuenta no tiene acceso al panel web (solo APK).
        </div>
      </div>
    );
  }
  return <Outlet />;
}

/** Requiere un rol concreto (el super-admin siempre pasa). */
export function RoleRoute({ roles }: { roles: Rol[] }) {
  const { perfil } = useTyreAuth();
  const ok = perfil && (perfil.es_superadmin || roles.includes(perfil.rol));
  if (!ok) {
    return (
      <div className="p-6">
        <div className="max-w-md rounded-2xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-800">
          No tienes permiso para acceder a esta pantalla.
        </div>
      </div>
    );
  }
  return <Outlet />;
}
