import { usePermisosAlmacen } from "../hooks/usePermisosAlmacen";

type RolPermitido = "admin" | "responsable" | "operario";

type RequireRoleProps = {
  roles: RolPermitido[];
  children: React.ReactNode;
};

export default function RequireRole({ roles, children }: RequireRoleProps) {
  const { permisos, cargandoPermisos, errorPermisos } = usePermisosAlmacen();

  if (cargandoPermisos) {
    return (
      <div className="min-h-screen bg-slate-900 p-6 text-slate-100">
        <div className="rounded-xl border border-slate-700 bg-slate-800 p-6 text-sm text-slate-300">
          Comprobando permisos...
        </div>
      </div>
    );
  }

  if (errorPermisos || !permisos.perfil) {
    return (
      <div className="min-h-screen bg-slate-900 p-6 text-slate-100">
        <div className="rounded-xl border border-red-700 bg-red-500/10 p-6 text-sm text-red-300">
          No hay perfil activo vinculado al usuario conectado.
        </div>
      </div>
    );
  }

  const rolActual = permisos.perfil.rol as RolPermitido | null;

  if (!rolActual || !roles.includes(rolActual)) {
    return (
      <div className="min-h-screen bg-slate-900 p-6 text-slate-100">
        <div className="rounded-xl border border-amber-600 bg-amber-500/10 p-6 text-sm text-amber-300">
          No tienes permiso para acceder a esta pantalla.
        </div>
      </div>
    );
  }

  return <>{children}</>;
}