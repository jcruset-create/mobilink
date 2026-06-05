import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "../services/supabase";

type Traspaso = {
  id: string;
  codigo: string | null;
  estado: string;
  origen_nombre: string | null;
  destino_nombre: string | null;
};

type Linea = {
  id: string;
  producto_id: string;
  cantidad_enviada: number;
  cantidad_recibida: number | null;
  marca: string | null;
  modelo: string | null;
  medida: string | null;
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

export default function MobileTraspasoDetalle() {
  const { id } = useParams();
  const [traspaso, setTraspaso] = useState<Traspaso | null>(null);
  const [lineas, setLineas] = useState<Linea[]>([]);
  const [codigoPersonal, setCodigoPersonal] = useState("");
  const [mensaje, setMensaje] = useState("");
  const [loading, setLoading] = useState(true);
  const [guardando, setGuardando] = useState(false);

  async function cargarDatos() {
    if (!id) return;

    setLoading(true);
    setMensaje("");

    const { data: traspasoData, error: traspasoError } = await supabase
      .from("traspasos_detalle")
      .select("*")
      .eq("id", id)
      .single();

    if (traspasoError) {
      setMensaje(`Error cargando traspaso: ${traspasoError.message}`);
      setLoading(false);
      return;
    }

    const { data: lineasData, error: lineasError } = await supabase
      .from("traspasos_lineas_detalle")
      .select("*")
      .eq("traspaso_id", id);

    if (lineasError) {
      setMensaje(`Error cargando líneas: ${lineasError.message}`);
      setLoading(false);
      return;
    }

    setTraspaso(traspasoData as Traspaso);
    setLineas((lineasData || []) as Linea[]);
    setLoading(false);
  }

  async function confirmarRecogida() {
    if (!id || guardando) return;

    const codigo = codigoPersonal.trim();

    if (codigo.length < 3) {
      setMensaje("Introduce un código personal válido.");
      return;
    }

    if (traspaso?.estado !== "preparado") {
      setMensaje("Este traspaso no está pendiente de recogida.");
      await cargarDatos();
      return;
    }

    setGuardando(true);

    const { data, error } = await supabase
      .from("traspasos")
      .update({
        estado: "en_camino",
        recogido_por_codigo: codigo,
        recogido_at: new Date().toISOString(),
      })
      .eq("id", id)
      .eq("estado", "preparado")
      .select("id")
      .maybeSingle();

    if (error || !data) {
      setMensaje(
        "No se pudo confirmar. Puede que el traspaso ya haya cambiado de estado."
      );
      setGuardando(false);
      await cargarDatos();
      return;
    }

    const { error: auditoriaError } = await supabase
  .from("traspasos_auditoria")
  .insert({
    traspaso_id: id,
    accion: "recogida",
    codigo_personal: codigo,
    estado_anterior: "preparado",
    estado_nuevo: "en_camino",
  });

if (auditoriaError) {
  setMensaje(`Recogida hecha, pero error guardando auditoría: ${auditoriaError.message}`);
  setGuardando(false);
  await cargarDatos();
  return;
}

await supabase.from("traspasos_auditoria").insert({
  traspaso_id: id,
  accion: "recogida",
  codigo_personal: codigo,
  estado_anterior: "preparado",
  estado_nuevo: "en_camino",
});

    setMensaje("Recogida confirmada correctamente.");
    setCodigoPersonal("");
    await cargarDatos();
    setGuardando(false);
  }

  async function confirmarRecepcion() {
    if (!id || guardando) return;

    const codigo = codigoPersonal.trim();

    if (codigo.length < 3) {
      setMensaje("Introduce un código personal válido.");
      return;
    }

    if (traspaso?.estado !== "en_camino") {
      setMensaje("Este traspaso no está pendiente de recepción.");
      await cargarDatos();
      return;
    }

    setGuardando(true);

    const { data, error } = await supabase.rpc("recibir_traspaso_completo", {
      p_traspaso_id: id,
      p_codigo_personal: codigo,
    });

    if (error) {
      setMensaje(`Error confirmando recepción: ${error.message}`);
      setGuardando(false);
      return;
    }

    if (!data) {
      setMensaje(
        "No se pudo confirmar. Puede que el traspaso ya haya cambiado de estado."
      );
      setGuardando(false);
      await cargarDatos();
      return;
    }

    setMensaje("Recepción confirmada correctamente.");
    setCodigoPersonal("");
    await cargarDatos();
    setGuardando(false);
  }

  useEffect(() => {
    cargarDatos();
  }, [id]);

  if (loading) {
    return <div className="p-4">Cargando...</div>;
  }

  return (
    <div className="min-h-screen bg-gray-100 p-4">
      <div className="mx-auto max-w-md space-y-4">
        <div className="rounded-2xl bg-white p-4 shadow-sm">
          <h1 className="text-2xl font-bold">
            {traspaso?.codigo || "Traspaso"}
          </h1>

          <p className="text-sm text-gray-500">
            {traspaso?.origen_nombre || "-"} → {traspaso?.destino_nombre || "-"}
          </p>

          <div className="mt-3">
            <span
              className={`inline-block rounded-full px-3 py-1 text-xs font-semibold ${
                traspaso
                  ? estadoClase(traspaso.estado)
                  : "bg-gray-100 text-gray-800"
              }`}
            >
              {traspaso ? estadoTexto(traspaso.estado) : "-"}
            </span>
          </div>
        </div>

        <div className="rounded-2xl bg-white p-4 shadow-sm">
          <h2 className="mb-3 text-lg font-bold">Líneas</h2>

          {lineas.length === 0 && (
            <p className="text-sm text-gray-500">No hay líneas.</p>
          )}

          <div className="space-y-3">
            {lineas.map((linea) => (
              <div key={linea.id} className="rounded-xl border p-3">
                <p className="font-semibold">
                  {linea.marca || "-"} {linea.modelo || ""}
                </p>

                <p className="text-sm text-gray-500">
                  Medida: {linea.medida || "-"}
                </p>

                <p className="text-sm">
                  Enviada: <strong>{linea.cantidad_enviada}</strong>
                </p>

                <p className="text-sm">
                  Recibida: <strong>{linea.cantidad_recibida ?? 0}</strong>
                </p>
              </div>
            ))}
          </div>
        </div>

        {traspaso?.estado !== "recibido" && (
          <div className="rounded-2xl bg-white p-4 shadow-sm">
            <label className="text-sm font-semibold">Código personal</label>

            <input
              value={codigoPersonal}
              onChange={(e) => setCodigoPersonal(e.target.value)}
              disabled={guardando}
              className="mt-2 w-full rounded-xl border px-4 py-3 text-lg disabled:bg-gray-100"
              placeholder="Ej: 1234"
            />

            {traspaso?.estado === "preparado" && (
              <button
                onClick={confirmarRecogida}
                disabled={guardando}
                className="mt-4 w-full rounded-xl bg-black px-4 py-4 font-semibold text-white disabled:opacity-50"
              >
                {guardando ? "Guardando..." : "Confirmar recogida"}
              </button>
            )}

            {traspaso?.estado === "en_camino" && (
              <button
                onClick={confirmarRecepcion}
                disabled={guardando}
                className="mt-4 w-full rounded-xl bg-green-700 px-4 py-4 font-semibold text-white disabled:opacity-50"
              >
                {guardando ? "Guardando..." : "Confirmar recepción"}
              </button>
            )}
          </div>
        )}

        {traspaso?.estado === "recibido" && (
          <div className="rounded-2xl bg-green-50 p-4 text-sm text-green-700 shadow-sm">
            Este traspaso ya ha sido recibido.
          </div>
        )}

        {mensaje && (
          <div className="rounded-2xl bg-white p-4 text-sm shadow-sm">
            {mensaje}
          </div>
        )}

        <button
          onClick={cargarDatos}
          disabled={guardando}
          className="w-full rounded-2xl bg-white p-4 text-center text-sm font-semibold shadow-sm disabled:opacity-50"
        >
          Actualizar
        </button>

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