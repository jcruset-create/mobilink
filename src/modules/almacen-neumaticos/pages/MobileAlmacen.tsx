import { useEffect, useState } from "react";
import { supabase } from "../services/supabase";

type Traspaso = {
  id: string;
  codigo: string | null;
  estado: string;
  fecha_salida: string | null;
  fecha_recepcion: string | null;
  cantidad: number;
  cantidad_recibida: number | null;
  ubicacion_origen: string | null;
  ubicacion_destino: string | null;
  productos_neumaticos:
    | {
        marca: string;
        modelo: string | null;
        medida: string;
        dot: string | null;
      }
    | {
        marca: string;
        modelo: string | null;
        medida: string;
        dot: string | null;
      }[]
    | null;
};

function estadoTexto(estado: string) {
  if (estado === "pendiente_salida") return "Pendiente salida";
  if (estado === "preparado") return "Pendiente salida";
  if (estado === "en_camino") return "Pendiente de recepción";
  if (estado === "recibido_parcial") return "Recibido parcial";
  if (estado === "recibido") return "Recibido";
  return estado;
}

function estadoClase(estado: string) {
  if (estado === "pendiente_salida") return "bg-yellow-100 text-yellow-800";
  if (estado === "preparado") return "bg-yellow-100 text-yellow-800";
  if (estado === "en_camino") return "bg-blue-100 text-blue-800";
  if (estado === "recibido_parcial") return "bg-orange-100 text-orange-800";
  if (estado === "recibido") return "bg-green-100 text-green-800";
  return "bg-gray-100 text-gray-800";
}

function obtenerPrimero<T>(valor: T | T[] | null): T | null {
  if (!valor) return null;
  if (Array.isArray(valor)) return valor[0] || null;
  return valor;
}

function textoProducto(
  producto:
    | {
        marca: string;
        modelo: string | null;
        medida: string;
        dot: string | null;
      }
    | null
) {
  if (!producto) return "-";

  return `${producto.medida} - ${producto.marca}${
    producto.modelo ? ` ${producto.modelo}` : ""
  }${producto.dot ? ` - DOT ${producto.dot}` : ""}`;
}

function codigoTraspaso(traspaso: Traspaso) {
  return traspaso.codigo || `TR-${traspaso.id.slice(0, 8).toUpperCase()}`;
}

function cantidadPendiente(traspaso: Traspaso) {
  const pendiente = traspaso.cantidad - (traspaso.cantidad_recibida || 0);
  return pendiente > 0 ? pendiente : 0;
}

export default function MobileAlmacen() {
  const [traspasos, setTraspasos] = useState<Traspaso[]>([]);
  const [loading, setLoading] = useState(true);
  const [mensaje, setMensaje] = useState("");

  async function cargarTraspasos() {
    setLoading(true);
    setMensaje("");

    const { data, error } = await supabase
      .from("traspasos")
      .select(`
        id,
        codigo,
        fecha_salida,
        fecha_recepcion,
        cantidad,
        cantidad_recibida,
        ubicacion_origen,
        ubicacion_destino,
        estado,
        productos_neumaticos (
          marca,
          modelo,
          medida,
          dot
        )
      `)
      .in("estado", [
        "pendiente_salida",
        "preparado",
        "en_camino",
        "recibido_parcial",
      ])
      .order("fecha_salida", { ascending: false });

    if (error) {
      setMensaje(`Error cargando traspasos: ${error.message}`);
      setLoading(false);
      return;
    }

    setTraspasos((data || []) as unknown as Traspaso[]);
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
            Aceptación de transporte y recepción de traspasos.
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
            {(() => {
              const producto = obtenerPrimero(tr.productos_neumaticos);

              return (
                <>
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-bold">
                  {codigoTraspaso(tr)}
                </h2>

                <p className="text-sm text-gray-500">
                  {tr.ubicacion_origen || "-"} → {tr.ubicacion_destino || "-"}
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

            <div className="mt-3 rounded-xl bg-gray-50 p-3">
              <p className="text-sm">
                Cantidad: <strong>{tr.cantidad}</strong>
              </p>

              <p className="mt-1 text-sm">
                Pendiente: <strong>{cantidadPendiente(tr)}</strong>
              </p>

              <p className="mt-1 text-sm text-gray-600">
                Neumático: <strong>{textoProducto(producto)}</strong>
              </p>
            </div>

            <div className="mt-4 grid gap-2">
              <a
                href={`/almacen-neumaticos/mobile/traspaso/${tr.id}`}
                className="rounded-xl bg-black px-4 py-3 text-center text-sm font-semibold text-white"
              >
                Ver traspaso
              </a>
            </div>
                </>
              );
            })()}
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
