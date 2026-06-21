import { useEffect, useState } from "react";
import ToolControlMenu from "../components/ToolControlMenu";
import { supabase } from "../services/supabase";

type Inventario = {
  id: string;
  tipo: string;
  estado: string;
  fecha_inicio: string;
  fecha_fin: string | null;
  observaciones: string | null;
};

const RESULTADO_BADGE: Record<string, string> = {
  localizada:    "bg-green-100 text-green-800",
  no_localizada: "bg-red-100 text-red-800",
  danada:        "bg-orange-100 text-orange-800",
  en_uso:        "bg-blue-100 text-blue-800",
  en_reparacion: "bg-purple-100 text-purple-800",
};

export default function Inventario() {
  const [inventarios, setInventarios] = useState<Inventario[]>([]);
  const [herramientas, setHerramientas] = useState<any[]>([]);
  const [itemsActual, setItemsActual] = useState<any[]>([]);
  const [inventarioActivo, setInventarioActivo] = useState<Inventario | null>(null);
  const [cargando, setCargando] = useState(true);
  const [creando, setCreando] = useState(false);
  const [mensaje, setMensaje] = useState("");

  useEffect(() => { cargar(); }, []);

  async function cargar() {
    setCargando(true);
    const [{ data: inv }, { data: herr }] = await Promise.all([
      supabase.from("tc_inventory_checks").select("*").order("fecha_inicio", { ascending: false }),
      supabase.from("tc_tools").select("id, nombre, codigo, estado, tc_locations!tc_tools_ubicacion_actual_id_fkey(nombre)").eq("activa", true).order("nombre"),
    ]);
    setInventarios(inv ?? []);
    setHerramientas(herr ?? []);
    const activo = (inv ?? []).find((i: any) => i.estado === "en_curso");
    if (activo) {
      setInventarioActivo(activo as any);
      const { data: items } = await supabase.from("tc_inventory_items").select("*, tc_tools(nombre, codigo)").eq("inventory_id", activo.id);
      setItemsActual(items ?? []);
    }
    setCargando(false);
  }

  async function iniciarInventario() {
    setCreando(true);
    const { data, error } = await supabase.from("tc_inventory_checks").insert({
      tipo: "manual", estado: "en_curso",
    }).select().single();
    setCreando(false);
    if (error || !data) return;
    setInventarioActivo(data as any);
    setItemsActual([]);
    setMensaje("Inventario iniciado. Verifica cada herramienta.");
    setTimeout(() => setMensaje(""), 4000);
    cargar();
  }

  async function verificar(toolId: string, resultado: string) {
    if (!inventarioActivo) return;
    // Upsert: si ya existe el item lo actualiza
    const existente = itemsActual.find((i) => i.tool_id === toolId);
    if (existente) {
      await supabase.from("tc_inventory_items").update({ estado_verificado: resultado }).eq("id", existente.id);
    } else {
      await supabase.from("tc_inventory_items").insert({
        inventory_id: inventarioActivo.id,
        tool_id: toolId,
        estado_verificado: resultado,
      });
    }
    const { data: items } = await supabase.from("tc_inventory_items").select("*, tc_tools(nombre, codigo)").eq("inventory_id", inventarioActivo.id);
    setItemsActual(items ?? []);
  }

  async function cerrarInventario() {
    if (!inventarioActivo) return;
    await supabase.from("tc_inventory_checks").update({ estado: "completado", fecha_fin: new Date().toISOString() }).eq("id", inventarioActivo.id);
    setInventarioActivo(null);
    setItemsActual([]);
    setMensaje("Inventario completado.");
    setTimeout(() => setMensaje(""), 3000);
    cargar();
  }

  return (
    <div className="p-6 space-y-4">
      <ToolControlMenu />
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Inventario</h1>
          <p className="text-sm text-gray-500">Verificación periódica de herramientas</p>
        </div>
        {!inventarioActivo && (
          <button onClick={iniciarInventario} disabled={creando}
            className="rounded-xl bg-green-600 px-4 py-2 text-sm font-semibold text-white hover:bg-green-700 disabled:opacity-50">
            {creando ? "Creando..." : "Iniciar inventario"}
          </button>
        )}
        {inventarioActivo && (
          <button onClick={cerrarInventario}
            className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700">
            ✓ Cerrar inventario
          </button>
        )}
      </div>

      {mensaje && <p className="rounded-lg bg-green-50 p-3 text-sm text-green-700">{mensaje}</p>}

      {/* Inventario activo */}
      {inventarioActivo && (
        <div className="rounded-xl border border-green-300 bg-green-50 p-4 space-y-3">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-green-500 animate-pulse"></span>
            <h2 className="font-semibold text-green-800">Inventario en curso</h2>
            <span className="text-xs text-green-600">
              {itemsActual.length} / {herramientas.length} verificadas
            </span>
          </div>
          <div className="overflow-auto max-h-96">
            <table className="w-full text-sm bg-white rounded-lg overflow-hidden">
              <thead className="bg-gray-50 text-left">
                <tr>
                  <th className="p-2">Código</th>
                  <th className="p-2">Herramienta</th>
                  <th className="p-2">Estado sistema</th>
                  <th className="p-2">Resultado verificación</th>
                </tr>
              </thead>
              <tbody>
                {herramientas.map((h) => {
                  const item = itemsActual.find((i) => i.tool_id === h.id);
                  return (
                    <tr key={h.id} className="border-t">
                      <td className="p-2 font-mono text-xs">{h.codigo}</td>
                      <td className="p-2 font-medium">{h.nombre}</td>
                      <td className="p-2 text-xs text-gray-500">{h.estado}</td>
                      <td className="p-2">
                        {item ? (
                          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${RESULTADO_BADGE[item.estado_verificado] ?? "bg-gray-100"}`}>
                            {item.estado_verificado}
                          </span>
                        ) : (
                          <div className="flex flex-wrap gap-1">
                            {["localizada","no_localizada","danada","en_uso","en_reparacion"].map((r) => (
                              <button key={r} onClick={() => verificar(h.id, r)}
                                className="rounded-full border px-2 py-0.5 text-xs hover:bg-gray-100">
                                {r}
                              </button>
                            ))}
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Historial */}
      <div>
        <h2 className="font-semibold mb-3">Histórico de inventarios</h2>
        {cargando ? (
          <div className="py-8 text-center text-gray-400">Cargando...</div>
        ) : (
          <div className="overflow-auto rounded-xl border bg-white">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-left">
                <tr>
                  <th className="p-3">Fecha inicio</th>
                  <th className="p-3">Tipo</th>
                  <th className="p-3">Estado</th>
                  <th className="p-3">Fecha fin</th>
                </tr>
              </thead>
              <tbody>
                {inventarios.map((inv) => (
                  <tr key={inv.id} className="border-t hover:bg-gray-50">
                    <td className="p-3 text-xs">{new Date(inv.fecha_inicio).toLocaleString("es-ES")}</td>
                    <td className="p-3">{inv.tipo}</td>
                    <td className="p-3">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                        inv.estado === "completado" ? "bg-green-100 text-green-800" :
                        inv.estado === "en_curso" ? "bg-blue-100 text-blue-800" :
                        "bg-gray-100 text-gray-600"
                      }`}>{inv.estado}</span>
                    </td>
                    <td className="p-3 text-xs text-gray-500">
                      {inv.fecha_fin ? new Date(inv.fecha_fin).toLocaleString("es-ES") : "—"}
                    </td>
                  </tr>
                ))}
                {inventarios.length === 0 && (
                  <tr><td colSpan={4} className="p-8 text-center text-gray-400">Sin inventarios realizados.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
