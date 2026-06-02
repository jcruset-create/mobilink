import { useEffect, useState } from "react";
import AlmacenMenu from "../components/AlmacenMenu";
import { supabase } from "../services/supabase";
import {
  exportarCsv,
  exportarExcel,
  type FilaExportacion,
} from "../services/exportAlmacen";

type AuditoriaAccion = {
  id: string;
  created_at: string;
  user_id: string | null;
  perfil_usuario_id: string | null;
  codigo_operario: string | null;
  email: string | null;
  rol: string | null;
  modulo: string;
  accion: string;
  tabla_afectada: string | null;
  registro_id: string | null;
  descripcion: string | null;
  datos: Record<string, unknown> | null;
};

const ROLES = ["admin", "responsable", "operario"];

function formatearFecha(fecha: string) {
  return new Date(fecha).toLocaleString("es-ES");
}

function formatearDatos(datos: Record<string, unknown> | null) {
  if (!datos) return "-";

  try {
    return JSON.stringify(datos, null, 2);
  } catch {
    return "-";
  }
}

function fechaHastaFinDia(fecha: string) {
  return `${fecha}T23:59:59`;
}

export default function AuditoriaAlmacen() {
  const [acciones, setAcciones] = useState<AuditoriaAccion[]>([]);
  const [mensaje, setMensaje] = useState("");
  const [cargando, setCargando] = useState(false);

  const [fechaDesde, setFechaDesde] = useState("");
  const [fechaHasta, setFechaHasta] = useState("");
  const [filtroModulo, setFiltroModulo] = useState("");
  const [filtroAccion, setFiltroAccion] = useState("");
  const [filtroEmail, setFiltroEmail] = useState("");
  const [filtroRol, setFiltroRol] = useState("");
  const [filtroTabla, setFiltroTabla] = useState("");
  const [filtroTexto, setFiltroTexto] = useState("");

  useEffect(() => {
    cargarAuditoria();
  }, []);

  async function cargarAuditoria() {
    setMensaje("");
    setCargando(true);

    let query = supabase
      .from("auditoria_acciones")
      .select(`
        id,
        created_at,
        user_id,
        perfil_usuario_id,
        codigo_operario,
        email,
        rol,
        modulo,
        accion,
        tabla_afectada,
        registro_id,
        descripcion,
        datos
      `)
      .order("created_at", { ascending: false })
      .limit(200);

    if (fechaDesde) {
      query = query.gte("created_at", `${fechaDesde}T00:00:00`);
    }

    if (fechaHasta) {
      query = query.lte("created_at", fechaHastaFinDia(fechaHasta));
    }

    if (filtroModulo.trim()) {
      query = query.ilike("modulo", `%${filtroModulo.trim()}%`);
    }

    if (filtroAccion.trim()) {
      query = query.ilike("accion", `%${filtroAccion.trim()}%`);
    }

    if (filtroEmail.trim()) {
      query = query.ilike("email", `%${filtroEmail.trim()}%`);
    }

    if (filtroRol) {
      query = query.eq("rol", filtroRol);
    }

    if (filtroTabla.trim()) {
      query = query.ilike("tabla_afectada", `%${filtroTabla.trim()}%`);
    }

    const { data, error } = await query;

    setCargando(false);

    if (error) {
      setMensaje(`Error cargando auditoría: ${error.message}`);
      return;
    }

    setAcciones((data || []) as AuditoriaAccion[]);
  }

  function limpiarFiltros() {
    setFechaDesde("");
    setFechaHasta("");
    setFiltroModulo("");
    setFiltroAccion("");
    setFiltroEmail("");
    setFiltroRol("");
    setFiltroTabla("");
    setFiltroTexto("");
  }

  const accionesFiltradas = acciones.filter((accion) => {
    if (!filtroTexto.trim()) return true;

    const texto = [
      accion.created_at,
      accion.email || "",
      accion.codigo_operario || "",
      accion.rol || "",
      accion.modulo || "",
      accion.accion || "",
      accion.tabla_afectada || "",
      accion.registro_id || "",
      accion.descripcion || "",
      accion.datos ? JSON.stringify(accion.datos) : "",
      accion.user_id || "",
      accion.perfil_usuario_id || "",
    ]
      .join(" ")
      .toLowerCase();

    return texto.includes(filtroTexto.trim().toLowerCase());
  });

  function filasExportacionAuditoria(): FilaExportacion[] {
    return accionesFiltradas.map((accion) => ({
      fecha: accion.created_at,
      email: accion.email || "",
      codigo_operario: accion.codigo_operario || "",
      rol: accion.rol || "",
      modulo: accion.modulo || "",
      accion: accion.accion || "",
      tabla_afectada: accion.tabla_afectada || "",
      registro_id: accion.registro_id || "",
      descripcion: accion.descripcion || "",
      datos: accion.datos ? JSON.stringify(accion.datos) : "",
      user_id: accion.user_id || "",
      perfil_usuario_id: accion.perfil_usuario_id || "",
    }));
  }

  function exportarAuditoriaCsv() {
    const filas = filasExportacionAuditoria();

    if (filas.length === 0) {
      setMensaje("No hay registros de auditoría para exportar.");
      return;
    }

    exportarCsv("auditoria-almacen", filas);
  }

  async function exportarAuditoriaExcel() {
    const filas = filasExportacionAuditoria();

    if (filas.length === 0) {
      setMensaje("No hay registros de auditoría para exportar.");
      return;
    }

    await exportarExcel("auditoria-almacen", "Auditoria", filas);
  }

  return (
    <div className="p-6 space-y-6">
      <AlmacenMenu />

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Auditoría</h1>
          <p className="text-sm text-gray-500">
            Consulta de acciones críticas realizadas en el módulo de almacén. Se
            cargan los últimos 200 registros según filtros.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={exportarAuditoriaCsv}
            className="rounded-xl border px-4 py-2 text-sm font-semibold disabled:opacity-50"
            disabled={accionesFiltradas.length === 0}
          >
            Exportar CSV
          </button>

          <button
            type="button"
            onClick={exportarAuditoriaExcel}
            className="rounded-xl bg-black px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            disabled={accionesFiltradas.length === 0}
          >
            Exportar Excel
          </button>
        </div>
      </div>

      <div className="rounded-xl border bg-white p-4 space-y-4">
        <h2 className="font-semibold">Filtros</h2>

        <div className="grid gap-3 md:grid-cols-4">
          <input
            type="date"
            value={fechaDesde}
            onChange={(e) => setFechaDesde(e.target.value)}
            className="rounded-lg border px-3 py-2 text-sm"
          />

          <input
            type="date"
            value={fechaHasta}
            onChange={(e) => setFechaHasta(e.target.value)}
            className="rounded-lg border px-3 py-2 text-sm"
          />

          <input
            value={filtroModulo}
            onChange={(e) => setFiltroModulo(e.target.value)}
            placeholder="Filtrar por módulo"
            className="rounded-lg border px-3 py-2 text-sm"
          />

          <input
            value={filtroAccion}
            onChange={(e) => setFiltroAccion(e.target.value)}
            placeholder="Filtrar por acción"
            className="rounded-lg border px-3 py-2 text-sm"
          />

          <input
            value={filtroEmail}
            onChange={(e) => setFiltroEmail(e.target.value)}
            placeholder="Filtrar por email"
            className="rounded-lg border px-3 py-2 text-sm"
          />

          <select
            value={filtroRol}
            onChange={(e) => setFiltroRol(e.target.value)}
            className="rounded-lg border px-3 py-2 text-sm"
          >
            <option value="">Todos los roles</option>
            {ROLES.map((rol) => (
              <option key={rol} value={rol}>
                {rol}
              </option>
            ))}
          </select>

          <input
            value={filtroTabla}
            onChange={(e) => setFiltroTabla(e.target.value)}
            placeholder="Filtrar por tabla"
            className="rounded-lg border px-3 py-2 text-sm"
          />

          <input
            value={filtroTexto}
            onChange={(e) => setFiltroTexto(e.target.value)}
            placeholder="Búsqueda libre"
            className="rounded-lg border px-3 py-2 text-sm"
          />
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={cargarAuditoria}
            className="rounded-xl bg-black px-4 py-2 text-sm font-semibold text-white"
          >
            {cargando ? "Buscando..." : "Buscar"}
          </button>

          <button
            type="button"
            onClick={limpiarFiltros}
            className="rounded-xl border px-4 py-2 text-sm font-semibold"
          >
            Limpiar filtros
          </button>
        </div>

        {mensaje && <p className="text-sm text-red-600">{mensaje}</p>}
      </div>

      <div className="rounded-xl border bg-white p-3 text-sm text-gray-600">
        Mostrando <strong>{accionesFiltradas.length}</strong> registros de{" "}
        <strong>{acciones.length}</strong> cargados.
      </div>

      <div className="overflow-auto rounded-xl border bg-white">
        <table className="w-full min-w-[1200px] text-sm">
          <thead className="bg-gray-50 text-left">
            <tr>
              <th className="p-3">Fecha</th>
              <th className="p-3">Usuario</th>
              <th className="p-3">Rol</th>
              <th className="p-3">Módulo</th>
              <th className="p-3">Acción</th>
              <th className="p-3">Tabla</th>
              <th className="p-3">Registro</th>
              <th className="p-3">Descripción</th>
              <th className="p-3">Datos</th>
            </tr>
          </thead>

          <tbody>
            {accionesFiltradas.map((accion) => (
              <tr key={accion.id} className="border-t align-top">
                <td className="p-3 whitespace-nowrap">
                  {formatearFecha(accion.created_at)}
                </td>
                <td className="p-3">
                  <div>{accion.email || "-"}</div>
                  <div className="text-xs text-gray-500">
                    {accion.codigo_operario || "-"}
                  </div>
                </td>
                <td className="p-3">{accion.rol || "-"}</td>
                <td className="p-3">{accion.modulo}</td>
                <td className="p-3 font-medium">{accion.accion}</td>
                <td className="p-3">{accion.tabla_afectada || "-"}</td>
                <td className="p-3 text-xs">{accion.registro_id || "-"}</td>
                <td className="p-3">{accion.descripcion || "-"}</td>
                <td className="p-3">
                  <pre className="max-w-md whitespace-pre-wrap rounded-lg bg-gray-50 p-2 text-xs">
                    {formatearDatos(accion.datos)}
                  </pre>
                </td>
              </tr>
            ))}

            {accionesFiltradas.length === 0 && (
              <tr>
                <td colSpan={9} className="p-6 text-center text-gray-500">
                  No hay acciones de auditoría visibles con los filtros
                  actuales.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}