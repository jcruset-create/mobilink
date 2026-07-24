import { useEffect, useState } from "react";
import ToolControlLayout from "../components/ToolControlLayout";
import { supabase } from "../services/supabase";

type Movimiento = {
  id: string;
  tipo: string;
  orden_trabajo: string | null;
  fecha_salida: string;
  fecha_devolucion: string | null;
  estado_inicial: string | null;
  estado_final: string | null;
  observaciones: string | null;
  tc_tools: { nombre: string; codigo: string } | null;
  sea_employees: { nombre: string } | null;
};

const FIELD = "rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500/40";

export default function Movimientos() {
  const [items, setItems] = useState<Movimiento[]>([]);
  const [cargando, setCargando] = useState(true);
  const [filtroTipo, setFiltroTipo] = useState("");
  const [filtroTexto, setFiltroTexto] = useState("");

  useEffect(() => { cargar(); }, []);

  async function cargar() {
    setCargando(true);
    const { data } = await supabase
      .from("tc_tool_movements")
      .select(`
        id, tipo, orden_trabajo, fecha_salida, fecha_devolucion,
        estado_inicial, estado_final, observaciones,
        tc_tools ( nombre, codigo ),
        sea_employees ( nombre )
      `)
      .order("fecha_salida", { ascending: false })
      .limit(200);
    setItems((data ?? []) as any);
    setCargando(false);
  }

  const filtrados = items.filter((m) => {
    if (filtroTipo && m.tipo !== filtroTipo) return false;
    if (filtroTexto.trim()) {
      const t = filtroTexto.toLowerCase();
      const campos = [
        (m.tc_tools as any)?.nombre,
        (m.tc_tools as any)?.codigo,
        (m.sea_employees as any)?.nombre,
        m.orden_trabajo,
      ].join(" ").toLowerCase();
      if (!campos.includes(t)) return false;
    }
    return true;
  });

  return (
    <ToolControlLayout title="Movimientos" subtitle="Historial de salidas y devoluciones">
      <div className="flex flex-wrap gap-2">
        <input
          value={filtroTexto}
          onChange={(e) => setFiltroTexto(e.target.value)}
          placeholder="Buscar herramienta, operario, OT..."
          className={`w-64 ${FIELD}`}
        />
        <select
          value={filtroTipo}
          onChange={(e) => setFiltroTipo(e.target.value)}
          className={FIELD}
        >
          <option value="">Todos</option>
          <option value="salida">Salida</option>
          <option value="devolucion">Devolución</option>
        </select>
        {(filtroTipo || filtroTexto) && (
          <button onClick={() => { setFiltroTipo(""); setFiltroTexto(""); }}
            className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-300 hover:bg-slate-700">
            Limpiar
          </button>
        )}
      </div>

      {cargando ? (
        <div className="py-10 text-center text-slate-500">Cargando...</div>
      ) : (
        <div className="overflow-auto rounded-xl border border-slate-800 bg-slate-800/60">
          <table className="w-full min-w-[800px] text-sm">
            <thead className="bg-slate-800 text-left text-xs uppercase tracking-wide text-slate-400">
              <tr>
                <th className="p-3">Fecha salida</th>
                <th className="p-3">Herramienta</th>
                <th className="p-3">Operario</th>
                <th className="p-3">Tipo</th>
                <th className="p-3">OT</th>
                <th className="p-3">Devolución</th>
                <th className="p-3">Estado final</th>
              </tr>
            </thead>
            <tbody>
              {filtrados.map((m) => (
                <tr key={m.id} className="border-t border-slate-800 hover:bg-slate-800/50">
                  <td className="p-3 text-xs text-slate-400 whitespace-nowrap">
                    {new Date(m.fecha_salida).toLocaleString("es-ES")}
                  </td>
                  <td className="p-3">
                    <div className="font-medium text-slate-100">{(m.tc_tools as any)?.nombre ?? "—"}</div>
                    <div className="text-xs text-slate-500">{(m.tc_tools as any)?.codigo ?? ""}</div>
                  </td>
                  <td className="p-3 text-slate-200">{(m.sea_employees as any)?.nombre ?? "—"}</td>
                  <td className="p-3">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                      m.tipo === "salida" ? "bg-sky-500/15 text-sky-300" : "bg-emerald-500/15 text-emerald-300"
                    }`}>
                      {m.tipo}
                    </span>
                  </td>
                  <td className="p-3 font-mono text-slate-400">{m.orden_trabajo ?? "—"}</td>
                  <td className="p-3 text-xs text-slate-400">
                    {m.fecha_devolucion ? new Date(m.fecha_devolucion).toLocaleString("es-ES") : "Pendiente"}
                  </td>
                  <td className="p-3 text-slate-400">{m.estado_final ?? "—"}</td>
                </tr>
              ))}
              {filtrados.length === 0 && (
                <tr><td colSpan={7} className="p-8 text-center text-slate-500">Sin movimientos.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </ToolControlLayout>
  );
}
