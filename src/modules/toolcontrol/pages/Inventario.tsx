import { useEffect, useState } from "react";
import ToolControlLayout from "../components/ToolControlLayout";
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
  localizada:    "bg-emerald-500/15 text-emerald-300",
  no_localizada: "bg-red-500/15 text-red-300",
  danada:        "bg-orange-500/15 text-orange-300",
  en_uso:        "bg-sky-500/15 text-sky-300",
  en_reparacion: "bg-purple-500/15 text-purple-300",
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
    <ToolControlLayout
      title="Inventario"
      subtitle="Verificación periódica de herramientas"
      actions={
        <>
          {!inventarioActivo && (
            <button onClick={iniciarInventario} disabled={creando}
              className="rounded-lg bg-amber-500 px-2.5 py-1.5 text-xs font-bold text-amber-950 hover:bg-amber-400 disabled:opacity-50">
              {creando ? "Creando..." : "Iniciar inventario"}
            </button>
          )}
          {inventarioActivo && (
            <button onClick={cerrarInventario}
              className="rounded-lg bg-amber-500 px-2.5 py-1.5 text-xs font-bold text-amber-950 hover:bg-amber-400">
              ✓ Cerrar inventario
            </button>
          )}
        </>
      }
    >
      {mensaje && <p className="rounded-lg bg-emerald-500/10 p-3 text-sm text-emerald-300">{mensaje}</p>}

      {/* Inventario activo */}
      {inventarioActivo && (
        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 space-y-3">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse"></span>
            <h2 className="font-semibold text-emerald-300">Inventario en curso</h2>
            <span className="text-xs text-emerald-400/80">
              {itemsActual.length} / {herramientas.length} verificadas
            </span>
          </div>
          <div className="overflow-auto max-h-96 rounded-lg border border-slate-800">
            <table className="w-full text-sm bg-slate-900">
              <thead className="bg-slate-800 text-left text-xs uppercase tracking-wide text-slate-400">
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
                    <tr key={h.id} className="border-t border-slate-800">
                      <td className="p-2 font-mono text-xs text-slate-400">{h.codigo}</td>
                      <td className="p-2 font-medium text-slate-100">{h.nombre}</td>
                      <td className="p-2 text-xs text-slate-400">{h.estado}</td>
                      <td className="p-2">
                        {item ? (
                          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${RESULTADO_BADGE[item.estado_verificado] ?? "bg-slate-500/15 text-slate-300"}`}>
                            {item.estado_verificado}
                          </span>
                        ) : (
                          <div className="flex flex-wrap gap-1">
                            {["localizada","no_localizada","danada","en_uso","en_reparacion"].map((r) => (
                              <button key={r} onClick={() => verificar(h.id, r)}
                                className="rounded-full border border-slate-700 bg-slate-800 px-2 py-0.5 text-xs text-slate-300 hover:bg-slate-700">
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
        <h2 className="font-semibold mb-3 text-slate-100">Histórico de inventarios</h2>
        {cargando ? (
          <div className="py-8 text-center text-slate-500">Cargando...</div>
        ) : (
          <div className="overflow-auto rounded-xl border border-slate-800 bg-slate-800/60">
            <table className="w-full text-sm">
              <thead className="bg-slate-800 text-left text-xs uppercase tracking-wide text-slate-400">
                <tr>
                  <th className="p-3">Fecha inicio</th>
                  <th className="p-3">Tipo</th>
                  <th className="p-3">Estado</th>
                  <th className="p-3">Fecha fin</th>
                </tr>
              </thead>
              <tbody>
                {inventarios.map((inv) => (
                  <tr key={inv.id} className="border-t border-slate-800 hover:bg-slate-800/50">
                    <td className="p-3 text-xs text-slate-300">{new Date(inv.fecha_inicio).toLocaleString("es-ES")}</td>
                    <td className="p-3 text-slate-200">{inv.tipo}</td>
                    <td className="p-3">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                        inv.estado === "completado" ? "bg-emerald-500/15 text-emerald-300" :
                        inv.estado === "en_curso" ? "bg-sky-500/15 text-sky-300" :
                        "bg-slate-500/15 text-slate-300"
                      }`}>{inv.estado}</span>
                    </td>
                    <td className="p-3 text-xs text-slate-400">
                      {inv.fecha_fin ? new Date(inv.fecha_fin).toLocaleString("es-ES") : "—"}
                    </td>
                  </tr>
                ))}
                {inventarios.length === 0 && (
                  <tr><td colSpan={4} className="p-8 text-center text-slate-500">Sin inventarios realizados.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </ToolControlLayout>
  );
}
