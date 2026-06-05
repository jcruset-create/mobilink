import { useEffect, useState } from "react";
import AlmacenMenu from "../components/AlmacenMenu";
import { supabase } from "../services/supabase";
import {
  exportarCsv,
  exportarExcel,
  type FilaExportacion,
} from "../services/exportAlmacen";

type AuditoriaTraspaso = {
  id: string;
  traspaso_id: string;
  accion: string;
  codigo_personal: string;
  estado_anterior: string | null;
  estado_nuevo: string | null;
  created_at: string;
  traspaso_codigo: string | null;
};

function formatearFecha(fecha: string) {
  return new Date(fecha).toLocaleString("es-ES");
}

function fechaHastaFinDia(fecha: string) {
  return `${fecha}T23:59:59`;
}

function accionTexto(accion: string) {
  if (accion === "recogida") return "Recogida";
  if (accion === "recepcion") return "Recepción";
  return accion;
}

export default function AuditoriaTraspasos() {
  const [registros, setRegistros] = useState<AuditoriaTraspaso[]>([]);
  const [mensaje, setMensaje] = useState("");
  const [cargando, setCargando] = useState(false);

  const [fechaDesde, setFechaDesde] = useState("");
  const [fechaHasta, setFechaHasta] = useState("");
  const [filtroCodigoPersonal, setFiltroCodigoPersonal] = useState("");
  const [filtroTraspaso, setFiltroTraspaso] = useState("");
  const [filtroAccion, setFiltroAccion] = useState("");
  const [filtroTexto, setFiltroTexto] = useState("");

  useEffect(() => {
    cargarAuditoria();
  }, []);

  async function cargarAuditoria() {
    setMensaje("");
    setCargando(true);

    let query = supabase
      .from("traspasos_auditoria_detalle")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(500);

    if (fechaDesde) {
      query = query.gte("created_at", `${fechaDesde}T00:00:00`);
    }

    if (fechaHasta) {
      query = query.lte("created_at", fechaHastaFinDia(fechaHasta));
    }

    if (filtroCodigoPersonal.trim()) {
      query = query.ilike(
        "codigo_personal",
        `%${filtroCodigoPersonal.trim()}%`
      );
    }

    if (filtroTraspaso.trim()) {
      query = query.ilike("traspaso_codigo", `%${filtroTraspaso.trim()}%`);
    }

    if (filtroAccion) {
      query = query.eq("accion", filtroAccion);
    }

    const { data, error } = await query;

    setCargando(false);

    if (error) {
      setMensaje(`Error cargando auditoría de traspasos: ${error.message}`);
      return;
    }

    setRegistros((data || []) as AuditoriaTraspaso[]);
  }

  function limpiarFiltros() {
    setFechaDesde("");
    setFechaHasta("");
    setFiltroCodigoPersonal("");
    setFiltroTraspaso("");
    setFiltroAccion("");
    setFiltroTexto("");
  }

  const registrosFiltrados = registros.filter((registro) => {
    if (!filtroTexto.trim()) return true;

    const texto = [
      registro.traspaso_codigo || "",
      registro.accion || "",
      registro.codigo_personal || "",
      registro.estado_anterior || "",
      registro.estado_nuevo || "",
      registro.created_at || "",
      registro.traspaso_id || "",
    ]
      .join(" ")
      .toLowerCase();

    return texto.includes(filtroTexto.trim().toLowerCase());
  });

  const totalRecogidas = registrosFiltrados.filter(
    (x) => x.accion === "recogida"
  ).length;

  const totalRecepciones = registrosFiltrados.filter(
    (x) => x.accion === "recepcion"
  ).length;

  function filasExportacion(): FilaExportacion[] {
    return registrosFiltrados.map((registro) => ({
      fecha: registro.created_at,
      traspaso_codigo: registro.traspaso_codigo || "",
      accion: accionTexto(registro.accion),
      codigo_personal: registro.codigo_personal || "",
      estado_anterior: registro.estado_anterior || "",
      estado_nuevo: registro.estado_nuevo || "",
      traspaso_id: registro.traspaso_id || "",
    }));
  }

  function exportarAuditoriaCsv() {
    const filas = filasExportacion();

    if (filas.length === 0) {
      setMensaje("No hay registros de auditoría para exportar.");
      return;
    }

    exportarCsv("auditoria-traspasos", filas);
  }

  async function exportarAuditoriaExcel() {
    const filas = filasExportacion();

    if (filas.length === 0) {
      setMensaje("No hay registros de auditoría para exportar.");
      return;
    }

    await exportarExcel("auditoria-traspasos", "Auditoria", filas);
  }

  return (
    <div className="p-6 space-y-6">
      <AlmacenMenu />

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Auditoría de traspasos</h1>
          <p className="text-sm text-gray-500">
            Consulta de recogidas y recepciones confirmadas desde móvil. Se
            cargan hasta 500 registros según filtros.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={exportarAuditoriaCsv}
            className="rounded-xl border px-4 py-2 text-sm font-semibold disabled:opacity-50"
            disabled={registrosFiltrados.length === 0}
          >
            Exportar CSV
          </button>

          <button
            type="button"
            onClick={exportarAuditoriaExcel}
            className="rounded-xl bg-black px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            disabled={registrosFiltrados.length === 0}
          >
            Exportar Excel
          </button>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <div className="rounded-xl border bg-white p-4">
          <div className="text-sm text-gray-500">Registros</div>
          <div className="text-3xl font-bold">{registrosFiltrados.length}</div>
        </div>

        <div className="rounded-xl border bg-blue-50 p-4">
          <div className="text-sm text-blue-700">Recogidas</div>
          <div className="text-3xl font-bold text-blue-800">
            {totalRecogidas}
          </div>
        </div>

        <div className="rounded-xl border bg-green-50 p-4">
          <div className="text-sm text-green-700">Recepciones</div>
          <div className="text-3xl font-bold text-green-800">
            {totalRecepciones}
          </div>
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
            value={filtroCodigoPersonal}
            onChange={(e) => setFiltroCodigoPersonal(e.target.value)}
            placeholder="Código personal"
            className="rounded-lg border px-3 py-2 text-sm"
          />

          <input
            value={filtroTraspaso}
            onChange={(e) => setFiltroTraspaso(e.target.value)}
            placeholder="Código traspaso"
            className="rounded-lg border px-3 py-2 text-sm"
          />

          <select
            value={filtroAccion}
            onChange={(e) => setFiltroAccion(e.target.value)}
            className="rounded-lg border px-3 py-2 text-sm"
          >
            <option value="">Todas las acciones</option>
            <option value="recogida">Recogidas</option>
            <option value="recepcion">Recepciones</option>
          </select>

          <input
            value={filtroTexto}
            onChange={(e) => setFiltroTexto(e.target.value)}
            placeholder="Búsqueda libre"
            className="rounded-lg border px-3 py-2 text-sm md:col-span-3"
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
        Mostrando <strong>{registrosFiltrados.length}</strong> registros de{" "}
        <strong>{registros.length}</strong> cargados.
      </div>

      <div className="overflow-auto rounded-xl border bg-white">
        <table className="w-full min-w-[1000px] text-sm">
          <thead className="bg-gray-50 text-left">
            <tr>
              <th className="p-3">Fecha</th>
              <th className="p-3">Traspaso</th>
              <th className="p-3">Acción</th>
              <th className="p-3">Código personal</th>
              <th className="p-3">Estado anterior</th>
              <th className="p-3">Estado nuevo</th>
              <th className="p-3">ID traspaso</th>
            </tr>
          </thead>

          <tbody>
            {registrosFiltrados.map((registro) => (
              <tr key={registro.id} className="border-t align-top">
                <td className="p-3 whitespace-nowrap">
                  {formatearFecha(registro.created_at)}
                </td>
                <td className="p-3 font-medium">
                  {registro.traspaso_codigo || "Sin código"}
                </td>
                <td className="p-3">{accionTexto(registro.accion)}</td>
                <td className="p-3">{registro.codigo_personal || "-"}</td>
                <td className="p-3">{registro.estado_anterior || "-"}</td>
                <td className="p-3">{registro.estado_nuevo || "-"}</td>
                <td className="p-3 text-xs">{registro.traspaso_id}</td>
              </tr>
            ))}

            {registrosFiltrados.length === 0 && (
              <tr>
                <td colSpan={7} className="p-6 text-center text-gray-500">
                  No hay registros de auditoría de traspasos con los filtros
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