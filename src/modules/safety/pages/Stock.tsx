import { useEffect, useState } from "react";
import SafetyLayout from "../components/SafetyLayout";
import { supabase } from "../services/supabase";

type Movimiento = {
  id: string;
  tipo: string;
  cantidad: number;
  stock_antes: number;
  stock_despues: number;
  observaciones: string | null;
  created_at: string;
  sm_epis: { nombre: string; codigo: string } | null;
};

const TIPO_BADGE: Record<string, string> = {
  compra:     "border-emerald-500/30 bg-emerald-500/15 text-emerald-300",
  reposicion: "border-sky-500/30 bg-sky-500/15 text-sky-300",
  devolucion: "border-cyan-500/30 bg-cyan-500/15 text-cyan-300",
  entrega:    "border-orange-500/30 bg-orange-500/15 text-orange-300",
  perdida:    "border-red-500/30 bg-red-500/15 text-red-300",
  baja:       "border-slate-500/30 bg-slate-500/20 text-slate-300",
  ajuste:     "border-violet-500/30 bg-violet-500/15 text-violet-300",
};

const FIELD = "rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500/40";

export default function Stock() {
  const [items, setItems] = useState<Movimiento[]>([]);
  const [cargando, setCargando] = useState(true);
  const [filtroTipo, setFiltroTipo] = useState("");
  const [filtroTexto, setFiltroTexto] = useState("");

  useEffect(() => { cargar(); }, []);

  async function cargar() {
    setCargando(true);
    const { data } = await supabase
      .from("sm_epi_stock_movements")
      .select("id, tipo, cantidad, stock_antes, stock_despues, observaciones, created_at, sm_epis(nombre, codigo)")
      .order("created_at", { ascending: false })
      .limit(300);
    setItems((data ?? []) as any);
    setCargando(false);
  }

  const filtrados = items.filter((m) => {
    if (filtroTipo && m.tipo !== filtroTipo) return false;
    if (filtroTexto.trim()) {
      const t = filtroTexto.toLowerCase();
      if (![(m.sm_epis as any)?.nombre, (m.sm_epis as any)?.codigo].join(" ").toLowerCase().includes(t)) return false;
    }
    return true;
  });

  const totalEntradas = filtrados.filter((m) => m.cantidad > 0).reduce((s, m) => s + m.cantidad, 0);
  const totalSalidas = filtrados.filter((m) => m.cantidad < 0).reduce((s, m) => s + Math.abs(m.cantidad), 0);

  return (
    <SafetyLayout
      title="Movimientos de stock"
      subtitle="Historial de entradas, salidas y ajustes de EPIs"
    >
      {/* Resumen */}
      <section className="grid grid-cols-3 gap-2">
        <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/15 px-2 py-1.5 text-emerald-300">
          <div className="text-[9px] font-bold uppercase leading-tight">Total entradas</div>
          <div className="text-lg font-black leading-none">+{totalEntradas}</div>
        </div>
        <div className="rounded-lg border border-red-500/30 bg-red-500/15 px-2 py-1.5 text-red-300">
          <div className="text-[9px] font-bold uppercase leading-tight">Total salidas</div>
          <div className="text-lg font-black leading-none">-{totalSalidas}</div>
        </div>
        <div className="rounded-lg border border-slate-500/30 bg-slate-500/15 px-2 py-1.5 text-slate-300">
          <div className="text-[9px] font-bold uppercase leading-tight">Movimientos</div>
          <div className="text-lg font-black leading-none">{filtrados.length}</div>
        </div>
      </section>

      {/* Filtros */}
      <div className="flex flex-wrap gap-2">
        <input value={filtroTexto} onChange={(e) => setFiltroTexto(e.target.value)}
          placeholder="Buscar EPI..." className={`w-56 ${FIELD}`} />
        <select value={filtroTipo} onChange={(e) => setFiltroTipo(e.target.value)} className={FIELD}>
          <option value="">Todos los tipos</option>
          {["compra","reposicion","devolucion","entrega","perdida","baja","ajuste"].map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
        {(filtroTipo || filtroTexto) && (
          <button onClick={() => { setFiltroTipo(""); setFiltroTexto(""); }}
            className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-300 hover:bg-slate-700">Limpiar</button>
        )}
      </div>

      {cargando ? <div className="py-10 text-center text-slate-500">Cargando...</div> : (
        <div className="overflow-auto rounded-xl border border-slate-700 bg-slate-800 shadow-sm">
          <table className="w-full min-w-[700px] text-sm">
            <thead className="bg-slate-950/60 text-left text-xs uppercase tracking-wide text-slate-400">
              <tr>
                <th className="p-3">Fecha</th>
                <th className="p-3">EPI</th>
                <th className="p-3">Tipo</th>
                <th className="p-3 text-right">Cantidad</th>
                <th className="p-3 text-right">Stock antes</th>
                <th className="p-3 text-right">Stock después</th>
                <th className="p-3">Observaciones</th>
              </tr>
            </thead>
            <tbody>
              {filtrados.map((m) => (
                <tr key={m.id} className="border-t border-slate-700/70 hover:bg-slate-700/40">
                  <td className="whitespace-nowrap p-3 text-xs text-slate-400">
                    {new Date(m.created_at).toLocaleString("es-ES")}
                  </td>
                  <td className="p-3">
                    <div className="font-medium text-slate-100">{(m.sm_epis as any)?.nombre ?? "—"}</div>
                    <div className="text-xs text-slate-500">{(m.sm_epis as any)?.codigo ?? ""}</div>
                  </td>
                  <td className="p-3">
                    <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${TIPO_BADGE[m.tipo] ?? "border-slate-500/30 bg-slate-500/15 text-slate-300"}`}>
                      {m.tipo}
                    </span>
                  </td>
                  <td className={`p-3 text-right font-bold ${m.cantidad > 0 ? "text-emerald-400" : "text-red-400"}`}>
                    {m.cantidad > 0 ? `+${m.cantidad}` : m.cantidad}
                  </td>
                  <td className="p-3 text-right text-slate-400">{m.stock_antes}</td>
                  <td className="p-3 text-right font-semibold text-slate-200">{m.stock_despues}</td>
                  <td className="p-3 text-xs text-slate-400">{m.observaciones ?? "—"}</td>
                </tr>
              ))}
              {filtrados.length === 0 && (
                <tr><td colSpan={7} className="p-8 text-center text-slate-500">Sin movimientos.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </SafetyLayout>
  );
}
