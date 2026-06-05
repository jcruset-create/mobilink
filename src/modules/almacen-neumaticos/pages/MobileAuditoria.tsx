import { useEffect, useState } from "react";
import { supabase } from "../services/supabase";

type Auditoria = {
  id: string;
  traspaso_id: string;
  accion: string;
  codigo_personal: string;
  estado_anterior: string | null;
  estado_nuevo: string | null;
  created_at: string;
  traspaso_codigo: string | null;
};

function accionTexto(accion: string) {
  if (accion === "recogida") return "Recogida";
  if (accion === "recepcion") return "Recepción";
  return accion;
}

function accionClase(accion: string) {
  if (accion === "recogida") return "bg-blue-100 text-blue-800";
  if (accion === "recepcion") return "bg-green-100 text-green-800";
  return "bg-gray-100 text-gray-800";
}

function limpiarCsv(valor: string | null | undefined) {
  return `"${String(valor ?? "").replace(/"/g, '""')}"`;
}

export default function MobileAuditoria() {
  const [items, setItems] = useState<Auditoria[]>([]);
  const [loading, setLoading] = useState(true);
  const [mensaje, setMensaje] = useState("");
  const [filtroCodigo, setFiltroCodigo] = useState("");
  const [filtroTraspaso, setFiltroTraspaso] = useState("");
  const [fechaDesde, setFechaDesde] = useState("");
  const [fechaHasta, setFechaHasta] = useState("");
  const [filtroAccion, setFiltroAccion] = useState("");
  const [pagina, setPagina] = useState(0);
  const [hayMas, setHayMas] = useState(true);

  const totalRecogidas = items.filter((x) => x.accion === "recogida").length;
  const totalRecepciones = items.filter((x) => x.accion === "recepcion").length;
  const ultimoMovimiento = items[0];

  function aplicarFiltrosBase(query: any, desde?: string, hasta?: string) {
    if (filtroCodigo.trim()) {
      query = query.ilike("codigo_personal", `%${filtroCodigo.trim()}%`);
    }

    if (filtroTraspaso.trim()) {
      query = query.ilike("traspaso_codigo", `%${filtroTraspaso.trim()}%`);
    }

    if (filtroAccion) {
      query = query.eq("accion", filtroAccion);
    }

    const desdeFinal = desde ?? fechaDesde;
    const hastaFinal = hasta ?? fechaHasta;

    if (desdeFinal) {
      query = query.gte("created_at", `${desdeFinal}T00:00:00`);
    }

    if (hastaFinal) {
      query = query.lte("created_at", `${hastaFinal}T23:59:59`);
    }

    return query;
  }

  async function ejecutarConsulta(desde?: string, hasta?: string) {
    setLoading(true);
    setMensaje("");

    let query = supabase
      .from("traspasos_auditoria_detalle")
      .select("*")
      .order("created_at", { ascending: false })
      .range(0, 49);

    query = aplicarFiltrosBase(query, desde, hasta);

    const { data, error } = await query;

    if (error) {
      setMensaje(`Error cargando auditoría: ${error.message}`);
      setLoading(false);
      return;
    }

    const registros = (data || []) as Auditoria[];

    setItems(registros);
    setPagina(0);
    setHayMas(registros.length === 50);
    setLoading(false);
  }

  async function cargarAuditoria() {
    await ejecutarConsulta();
  }

  async function cargarMas() {
    const siguientePagina = pagina + 1;
    const desde = siguientePagina * 50;
    const hasta = desde + 49;

    setLoading(true);
    setMensaje("");

    let query = supabase
      .from("traspasos_auditoria_detalle")
      .select("*")
      .order("created_at", { ascending: false })
      .range(desde, hasta);

    query = aplicarFiltrosBase(query);

    const { data, error } = await query;

    if (error) {
      setMensaje(`Error cargando más registros: ${error.message}`);
      setLoading(false);
      return;
    }

    const nuevos = (data || []) as Auditoria[];

    setItems((actuales) => [...actuales, ...nuevos]);
    setPagina(siguientePagina);
    setHayMas(nuevos.length === 50);
    setLoading(false);
  }

  async function limpiarFiltros() {
    setFiltroCodigo("");
    setFiltroTraspaso("");
    setFechaDesde("");
    setFechaHasta("");
    setFiltroAccion("");
    setLoading(true);
    setMensaje("");

    const { data, error } = await supabase
      .from("traspasos_auditoria_detalle")
      .select("*")
      .order("created_at", { ascending: false })
      .range(0, 49);

    if (error) {
      setMensaje(`Error cargando auditoría: ${error.message}`);
      setLoading(false);
      return;
    }

    const registros = (data || []) as Auditoria[];

    setItems(registros);
    setPagina(0);
    setHayMas(registros.length === 50);
    setLoading(false);
  }

  async function cargarPorRango(
    fechaDesdeTexto: string,
    fechaHastaTexto: string
  ) {
    setFechaDesde(fechaDesdeTexto);
    setFechaHasta(fechaHastaTexto);
    await ejecutarConsulta(fechaDesdeTexto, fechaHastaTexto);
  }

  async function filtrarHoy() {
    const hoy = new Date().toISOString().slice(0, 10);
    await cargarPorRango(hoy, hoy);
  }

  async function filtrarUltimos7Dias() {
    const hasta = new Date();
    const desde = new Date();

    desde.setDate(hasta.getDate() - 6);

    await cargarPorRango(
      desde.toISOString().slice(0, 10),
      hasta.toISOString().slice(0, 10)
    );
  }

  async function filtrarUltimos30Dias() {
    const hasta = new Date();
    const desde = new Date();

    desde.setDate(hasta.getDate() - 29);

    await cargarPorRango(
      desde.toISOString().slice(0, 10),
      hasta.toISOString().slice(0, 10)
    );
  }

  async function exportarCsv() {
    setMensaje("");

    let query = supabase
      .from("traspasos_auditoria_detalle")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(5000);

    query = aplicarFiltrosBase(query);

    const { data, error } = await query;

    if (error) {
      setMensaje(`Error exportando CSV: ${error.message}`);
      return;
    }

    const registros = (data || []) as Auditoria[];

    if (registros.length === 0) {
      setMensaje("No hay registros para exportar.");
      return;
    }

    const cabeceras = [
      "traspaso_codigo",
      "accion",
      "codigo_personal",
      "estado_anterior",
      "estado_nuevo",
      "fecha",
    ];

    const filas = registros.map((item) => [
      limpiarCsv(item.traspaso_codigo || "Traspaso sin código"),
      limpiarCsv(accionTexto(item.accion)),
      limpiarCsv(item.codigo_personal),
      limpiarCsv(item.estado_anterior),
      limpiarCsv(item.estado_nuevo),
      limpiarCsv(new Date(item.created_at).toLocaleString("es-ES")),
    ]);

    const contenido = [
      cabeceras.join(";"),
      ...filas.map((fila) => fila.join(";")),
    ].join("\n");

    const blob = new Blob([`\uFEFF${contenido}`], {
      type: "text/csv;charset=utf-8;",
    });

    const url = URL.createObjectURL(blob);
    const enlace = document.createElement("a");

    enlace.href = url;
    enlace.download = `auditoria-traspasos-${new Date()
      .toISOString()
      .slice(0, 10)}.csv`;

    enlace.click();
    URL.revokeObjectURL(url);

    setMensaje(`CSV exportado con ${registros.length} registros.`);
  }

  useEffect(() => {
    cargarAuditoria();
  }, []);

  return (
    <div className="min-h-screen bg-gray-100 p-4">
      <div className="mx-auto max-w-md space-y-4">
        <div className="rounded-2xl bg-white p-4 shadow-sm">
          <h1 className="text-2xl font-bold">Auditoría móvil</h1>
          <p className="text-sm text-gray-500">
            Últimas recogidas y recepciones.
          </p>
        </div>

        <div className="rounded-2xl bg-white p-4 shadow-sm">
          <label className="text-sm font-semibold">
            Filtrar por código personal
          </label>

          <input
            value={filtroCodigo}
            onChange={(e) => setFiltroCodigo(e.target.value)}
            className="mt-2 w-full rounded-xl border px-4 py-3"
            placeholder="Ej: 1234"
          />

          <label className="mt-3 block text-sm font-semibold">
            Filtrar por código de traspaso
          </label>

          <input
            value={filtroTraspaso}
            onChange={(e) => setFiltroTraspaso(e.target.value)}
            className="mt-2 w-full rounded-xl border px-4 py-3"
            placeholder="Ej: TR-REUS-000001"
          />

          <div className="mt-3">
            <label className="text-sm font-semibold">Tipo de acción</label>

            <select
              value={filtroAccion}
              onChange={(e) => setFiltroAccion(e.target.value)}
              className="mt-2 w-full rounded-xl border px-4 py-3"
            >
              <option value="">Todas las acciones</option>
              <option value="recogida">Recogidas</option>
              <option value="recepcion">Recepciones</option>
            </select>
          </div>

          <div className="mt-3 grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm font-semibold">Desde</label>
              <input
                type="date"
                value={fechaDesde}
                onChange={(e) => setFechaDesde(e.target.value)}
                className="mt-2 w-full rounded-xl border px-4 py-3"
              />
            </div>

            <div>
              <label className="text-sm font-semibold">Hasta</label>
              <input
                type="date"
                value={fechaHasta}
                onChange={(e) => setFechaHasta(e.target.value)}
                className="mt-2 w-full rounded-xl border px-4 py-3"
              />
            </div>
          </div>

          <button
            onClick={cargarAuditoria}
            className="mt-3 w-full rounded-xl bg-black px-4 py-3 font-semibold text-white"
          >
            Buscar
          </button>

          <button
            onClick={limpiarFiltros}
            className="mt-2 w-full rounded-xl bg-gray-100 px-4 py-3 font-semibold"
          >
            Limpiar filtros
          </button>

          <button
            onClick={exportarCsv}
            className="mt-2 w-full rounded-xl bg-gray-100 px-4 py-3 font-semibold"
          >
            Exportar CSV
          </button>

          <div className="mt-3 grid grid-cols-3 gap-2">
            <button
              onClick={filtrarHoy}
              className="rounded-xl bg-gray-100 px-3 py-3 text-xs font-semibold"
            >
              Hoy
            </button>

            <button
              onClick={filtrarUltimos7Dias}
              className="rounded-xl bg-gray-100 px-3 py-3 text-xs font-semibold"
            >
              7 días
            </button>

            <button
              onClick={filtrarUltimos30Dias}
              className="rounded-xl bg-gray-100 px-3 py-3 text-xs font-semibold"
            >
              30 días
            </button>
          </div>
        </div>

        {!loading && (
          <div className="rounded-2xl bg-white p-4 text-sm text-gray-600 shadow-sm">
            Registros encontrados: <strong>{items.length}</strong>
          </div>
        )}

        {!loading && (
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-2xl bg-blue-50 p-4 text-center shadow-sm">
              <div className="text-2xl font-bold text-blue-700">
                {totalRecogidas}
              </div>
              <div className="text-xs text-blue-600">Recogidas</div>
            </div>

            <div className="rounded-2xl bg-green-50 p-4 text-center shadow-sm">
              <div className="text-2xl font-bold text-green-700">
                {totalRecepciones}
              </div>
              <div className="text-xs text-green-600">Recepciones</div>
            </div>
          </div>
        )}

        {!loading && ultimoMovimiento && (
          <div className="rounded-2xl bg-white p-4 shadow-sm">
            <h2 className="text-sm font-semibold text-gray-500">
              Último movimiento
            </h2>

            <div className="mt-2">
              <div className="font-bold">
                {ultimoMovimiento.traspaso_codigo || "Traspaso sin código"}
              </div>

              <span
                className={`mt-2 inline-block rounded-full px-3 py-1 text-xs font-semibold ${accionClase(
                  ultimoMovimiento.accion
                )}`}
              >
                {accionTexto(ultimoMovimiento.accion)}
              </span>

              <p className="mt-2 text-sm text-gray-600">
                Usuario: {ultimoMovimiento.codigo_personal}
              </p>

              <p className="mt-1 text-xs text-gray-500">
                {new Date(ultimoMovimiento.created_at).toLocaleString("es-ES")}
              </p>
            </div>
          </div>
        )}

        {loading && (
          <div className="rounded-2xl bg-white p-4 text-sm text-gray-500 shadow-sm">
            Cargando auditoría...
          </div>
        )}

        {mensaje && (
          <div className="rounded-2xl bg-white p-4 text-sm text-red-600 shadow-sm">
            {mensaje}
          </div>
        )}

        {!loading && items.length === 0 && (
          <div className="rounded-2xl bg-white p-4 text-sm text-gray-500 shadow-sm">
            No hay registros de auditoría.
          </div>
        )}

        {items.map((item) => (
          <div key={item.id} className="rounded-2xl bg-white p-4 shadow-sm">
            <h2 className="text-lg font-bold">
              {item.traspaso_codigo || "Traspaso sin código"}
            </h2>

            <span
              className={`mt-2 inline-block rounded-full px-3 py-1 text-xs font-semibold ${accionClase(
                item.accion
              )}`}
            >
              {accionTexto(item.accion)}
            </span>

            <p className="mt-2 text-sm text-gray-500">
              Usuario: {item.codigo_personal}
            </p>

            <p className="mt-2 text-sm">
              {item.estado_anterior || "-"} → {item.estado_nuevo || "-"}
            </p>

            <p className="mt-2 text-xs text-gray-500">
              {new Date(item.created_at).toLocaleString("es-ES")}
            </p>
          </div>
        ))}

        {!loading && hayMas && items.length > 0 && (
          <button
            onClick={cargarMas}
            className="w-full rounded-2xl bg-white p-4 text-center text-sm font-semibold shadow-sm"
          >
            Cargar más
          </button>
        )}

        <a
          href="/almacen-neumaticos/mobile"
          className="block rounded-2xl bg-white p-4 text-center text-sm font-semibold shadow-sm"
        >
          Volver
        </a>
      </div>
    </div>
  );
}