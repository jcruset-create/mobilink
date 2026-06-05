import { useEffect, useState } from "react";
import { supabase } from "../services/supabase";

type Traspaso = {
  id: string;
  codigo: string | null;
  tipo_entrega: string | null;
  estado: string;
  created_at: string;
  origen_nombre: string | null;
  destino_nombre: string | null;
};

function estadoTexto(estado: string) {
  if (estado === "preparado") return "Pendiente de recogida";
  if (estado === "en_camino") return "Pendiente de recepción";
  if (estado === "recibido") return "Recibido";
  return estado;
}

function estadoClase(estado: string) {
  if (estado === "preparado") return "bg-yellow-100 text-yellow-800";
  if (estado === "en_camino") return "bg-blue-100 text-blue-800";
  if (estado === "recibido") return "bg-green-100 text-green-800";
  return "bg-gray-100 text-gray-800";
}

export default function MobileAlmacen() {
  const [traspasos, setTraspasos] = useState<Traspaso[]>([]);
  const [loading, setLoading] = useState(true);
  const [mensaje, setMensaje] = useState("");

  async function cargarTraspasos() {
    setLoading(true);
    setMensaje("");

    const { data, error } = await supabase
      .from("traspasos_detalle")
      .select("*")
      .in("estado", ["preparado", "en_camino"])
      .order("created_at", { ascending: false });

    if (error) {
      setMensaje(`Error cargando traspasos: ${error.message}`);
      setLoading(false);
      return;
    }

    setTraspasos((data || []) as Traspaso[]);
    setLoading(false);
  }

  useEffect(() => {
    cargarTraspasos();
  }, []);

  return (
    <div className="min-h-screen bg-gray-100 p-4">
      <div className="mx-auto max-w-md space-y-4">
        <div className="rounded-2xl bg-white p-4 shadow-sm">
          <h1 className="text-2xl font-bold">Almacén móvil</h1>
          <p className="text-sm text-gray-500">
            Recogida y recepción de traspasos.
          </p>
        </div>

        <button
          onClick={cargarTraspasos}
          className="w-full rounded-2xl bg-black p-4 text-center text-sm font-semibold text-white shadow-sm"
        >
          Actualizar traspasos
        </button>

        <div className="grid grid-cols-2 gap-3">
          <a
            href="/almacen-neumaticos/stock"
            className="rounded-2xl bg-white p-4 text-center text-sm font-semibold shadow-sm"
          >
            Stock
          </a>

          <a
            href="/almacen-neumaticos/incidencias"
            className="rounded-2xl bg-white p-4 text-center text-sm font-semibold shadow-sm"
          >
            Incidencias
          </a>

          <a
            href="/almacen-neumaticos/mobile/auditoria"
            className="rounded-2xl bg-white p-4 text-center text-sm font-semibold shadow-sm"
          >
            Auditoría
          </a>
        </div>

        {loading && (
          <div className="rounded-2xl bg-white p-4 text-sm text-gray-500 shadow-sm">
            Cargando traspasos...
          </div>
        )}

        {mensaje && (
          <div className="rounded-2xl bg-white p-4 text-sm text-red-600 shadow-sm">
            {mensaje}
          </div>
        )}

        {!loading && traspasos.length === 0 && (
          <div className="rounded-2xl bg-white p-4 text-sm text-gray-500 shadow-sm">
            No hay traspasos pendientes.
          </div>
        )}

        {traspasos.map((tr) => (
          <div key={tr.id} className="rounded-2xl bg-white p-4 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-bold">
                  {tr.codigo || "Sin código"}
                </h2>

                <p className="text-sm text-gray-500">
                  {tr.origen_nombre || "-"} → {tr.destino_nombre || "-"}
                </p>
              </div>

              <span
                className={`rounded-full px-3 py-1 text-xs font-semibold ${estadoClase(
                  tr.estado
                )}`}
              >
                {estadoTexto(tr.estado)}
              </span>
            </div>

            <div className="mt-4 grid gap-2">
              <a
                href={`/almacen-neumaticos/mobile/traspaso/${tr.id}`}
                className="rounded-xl bg-black px-4 py-3 text-center text-sm font-semibold text-white"
              >
                Ver traspaso
              </a>
            </div>
          </div>
        ))}

        <a
          href="/"
          className="block rounded-2xl bg-white p-4 text-center text-sm font-semibold shadow-sm"
        >
          Volver
        </a>
      </div>
    </div>
  );
}