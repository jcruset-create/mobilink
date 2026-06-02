import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { supabase } from "../services/supabase";
import { cerrarSesion } from "../services/authAlmacen";
import { usePermisosAlmacen } from "../hooks/usePermisosAlmacen";

type AlertasMenu = {
  traspasos: number;
  reposiciones: number;
  inventarios: number;
  incidencias: number;
};

const alertasIniciales: AlertasMenu = {
  traspasos: 0,
  reposiciones: 0,
  inventarios: 0,
  incidencias: 0,
};

function Badge({ valor }: { valor: number }) {
  if (valor <= 0) return null;

  return (
    <span className="ml-2 rounded-full bg-red-100 px-2 py-0.5 text-xs font-bold text-red-700">
      {valor}
    </span>
  );
}

function EnlaceMenu({
  href,
  children,
}: {
  href: string;
  children: ReactNode;
}) {
  return (
    <a
      href={href}
      className="rounded-lg border px-3 py-2 text-sm hover:bg-gray-50"
    >
      {children}
    </a>
  );
}

export default function AlmacenMenu() {
  const { permisos, cargandoPermisos } = usePermisosAlmacen();
  const [alertas, setAlertas] = useState<AlertasMenu>(alertasIniciales);

  const esAdmin = permisos.esAdmin;
  const esResponsable = permisos.esResponsable;
  const esOperario = permisos.esOperario;

  const puedeVerOperativo = esAdmin || esResponsable || esOperario;
  const puedeVerEntradas = esAdmin || esResponsable;
  const puedeVerReposiciones = esAdmin || esResponsable;
  const puedeVerMaestros = esAdmin;
  const puedeVerAdmin = esAdmin;

  useEffect(() => {
    if (permisos.perfil) {
      cargarAlertas();
    }
  }, [permisos.perfil?.id]);

  async function cargarAlertas() {
    const { data: traspasosData } = await supabase
      .from("traspasos")
      .select("id,estado")
      .in("estado", ["pendiente_salida", "en_camino", "recibido_parcial"]);

    const { data: reposicionesData } = await supabase
      .from("solicitudes_reposicion")
      .select("id,estado")
      .in("estado", ["pendiente", "aprobada", "en_traspaso"]);

    const { data: inventariosData } = await supabase
      .from("inventarios")
      .select("id,estado")
      .in("estado", ["pendiente_conteo", "pendiente_revision"]);

    const { data: incidenciasData } = await supabase
      .from("incidencias")
      .select("id,estado")
      .neq("estado", "resuelta");

    setAlertas({
      traspasos: traspasosData?.length || 0,
      reposiciones: reposicionesData?.length || 0,
      inventarios: inventariosData?.length || 0,
      incidencias: incidenciasData?.length || 0,
    });
  }

  async function salir() {
    await cerrarSesion();
    window.location.href = "/login";
  }

  return (
    <nav className="flex flex-wrap gap-2 rounded-xl border bg-white p-3">
      <EnlaceMenu href="/almacen-neumaticos">Dashboard</EnlaceMenu>

      {puedeVerOperativo && (
        <EnlaceMenu href="/almacen-neumaticos/stock">Stock</EnlaceMenu>
      )}

      {puedeVerEntradas && (
        <EnlaceMenu href="/almacen-neumaticos/entradas">Entradas</EnlaceMenu>
      )}

      {puedeVerOperativo && (
        <EnlaceMenu href="/almacen-neumaticos/salidas">
          Salidas / Montajes
        </EnlaceMenu>
      )}

      {puedeVerOperativo && (
        <EnlaceMenu href="/almacen-neumaticos/traspasos">
          Traspasos
          <Badge valor={alertas.traspasos} />
        </EnlaceMenu>
      )}

      {puedeVerReposiciones && (
        <EnlaceMenu href="/almacen-neumaticos/reposiciones">
          Reposiciones
          <Badge valor={alertas.reposiciones} />
        </EnlaceMenu>
      )}

      {puedeVerOperativo && (
        <EnlaceMenu href="/almacen-neumaticos/inventarios">
          Inventarios
          <Badge valor={alertas.inventarios} />
        </EnlaceMenu>
      )}

      {puedeVerOperativo && (
        <EnlaceMenu href="/almacen-neumaticos/incidencias">
          Incidencias
          <Badge valor={alertas.incidencias} />
        </EnlaceMenu>
      )}

      {puedeVerOperativo && (
        <EnlaceMenu href="/almacen-neumaticos/historial">Historial</EnlaceMenu>
      )}

      {puedeVerMaestros && (
        <>
          <EnlaceMenu href="/almacen-neumaticos/productos">Productos</EnlaceMenu>
          <EnlaceMenu href="/almacen-neumaticos/clientes">Clientes</EnlaceMenu>
          <EnlaceMenu href="/almacen-neumaticos/vehiculos">Vehículos</EnlaceMenu>
          <EnlaceMenu href="/almacen-neumaticos/centros">Centros</EnlaceMenu>
        </>
      )}

      {puedeVerAdmin && (
        <>
          <EnlaceMenu href="/almacen-neumaticos/usuarios">Usuarios</EnlaceMenu>
          <EnlaceMenu href="/almacen-neumaticos/auditoria">Auditoría</EnlaceMenu>
          <EnlaceMenu href="/almacen-neumaticos/sistema">Sistema</EnlaceMenu>
        </>
      )}

      {cargandoPermisos && (
        <span className="rounded-lg border px-3 py-2 text-sm text-gray-500">
          Cargando permisos...
        </span>
      )}

      {permisos.perfil && (
        <span className="rounded-lg bg-gray-50 px-3 py-2 text-sm text-gray-600">
          {permisos.perfil.nombre || "-"} · {permisos.perfil.rol || "-"}
        </span>
      )}

      <button
        type="button"
        onClick={salir}
        className="rounded-lg border px-3 py-2 text-sm hover:bg-gray-50"
      >
        Salir
      </button>
    </nav>
  );
}