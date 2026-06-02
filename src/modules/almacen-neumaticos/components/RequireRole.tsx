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
      <div className="p-6">
        <div className="rounded-xl border bg-white p-6 text-sm text-gray-600">
          Comprobando permisos...
        </div>
      </div>
    );
  }

  if (errorPermisos || !permisos.perfil) {
    return (
      <div className="p-6">
        <div className="rounded-xl border bg-red-50 p-6 text-sm text-red-700">
          No hay perfil activo vinculado al usuario conectado.
        </div>
      </div>
    );
  }

  const rolActual = permisos.perfil.rol as RolPermitido | null;

  if (!rolActual || !roles.includes(rolActual)) {
    return (
      <div className="p-6">
        <div className="rounded-xl border bg-yellow-50 p-6 text-sm text-yellow-800">
          No tienes permiso para acceder a esta pantalla.
        </div>
      </div>
    );
  }

  return <>{children}</>;
}