import { useEffect, useState } from "react";
import SafetyMenu from "../components/SafetyMenu";
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
  compra:     "bg-green-100 text-green-800",
  reposicion: "bg-blue-100 text-blue-800",
  devolucion: "bg-cyan-100 text-cyan-800",
  entrega:    "bg-orange-100 text-orange-800",
  perdida:    "bg-red-100 text-red-800",
  baja:       "bg-gray-200 text-gray-600",
  ajuste:     "bg-purple-100 text-purple-800",
};

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
    <div className="p-6 space-y-4">
      <SafetyMenu />
      <div>
        <h1 className="text-2xl font-bold">Movimientos de stock</h1>
        <p className="text-sm text-gray-500">Historial de entradas, salidas y ajustes de EPIs</p>
      </div>

      {/* Resumen */}
      <div className="grid grid-cols-3 gap-4">
        <div className="rounded-xl border bg-green-50 p-4">
          <div className="text-2xl font-black text-green-800">+{totalEntradas}</div>
          <div className="text-xs text-green-600 mt-1">Total entradas</div>
        </div>
        <div className="rounded-xl border bg-red-50 p-4">
          <div className="text-2xl font-black text-red-800">-{totalSalidas}</div>
          <div className="text-xs text-red-600 mt-1">Total salidas</div>
        </div>
        <div className="rounded-xl border bg-gray-50 p-4">
          <div className="text-2xl font-black text-gray-800">{filtrados.length}</div>
          <div className="text-xs text-gray-500 mt-1">Movimientos</div>
        </div>
      </div>

      {/* Filtros */}
      <div className="flex flex-wrap gap-2">
        <input value={filtroTexto} onChange={(e) => setFiltroTexto(e.target.value)}
          placeholder="Buscar EPI..." className="rounded-lg border px-3 py-2 text-sm w-56" />
        <select value={filtroTipo} onChange={(e) => setFiltroTipo(e.target.value)} className="rounded-lg border px-3 py-2 text-sm">
          <option value="">Todos los tipos</option>
          {["compra","reposicion","devolucion","entrega","perdida","baja","ajuste"].map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
        {(filtroTipo || filtroTexto) && (
          <button onClick={() => { setFiltroTipo(""); setFiltroTexto(""); }}
            className="rounded-lg border px-3 py-2 text-sm text-gray-500 hover:bg-gray-50">Limpiar</button>
        )}
      </div>

      {cargando ? <div className="py-10 text-center text-gray-400">Cargando...</div> : (
        <div className="overflow-auto rounded-xl border bg-white">
          <table className="w-full min-w-[700px] text-sm">
            <thead className="bg-gray-50 text-left">
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
                <tr key={m.id} className="border-t hover:bg-gray-50">
                  <td className="p-3 text-xs text-gray-500 whitespace-nowrap">
                    {new Date(m.created_at).toLocaleString("es-ES")}
                  </td>
                  <td className="p-3">
                    <div className="font-medium">{(m.sm_epis as any)?.nombre ?? "—"}</div>
                    <div className="text-xs text-gray-400">{(m.sm_epis as any)?.codigo ?? ""}</div>
                  </td>
                  <td className="p-3">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${TIPO_BADGE[m.tipo] ?? "bg-gray-100"}`}>
                      {m.tipo}
                    </span>
                  </td>
                  <td className={`p-3 text-right font-bold ${m.cantidad > 0 ? "text-green-600" : "text-red-600"}`}>
                    {m.cantidad > 0 ? `+${m.cantidad}` : m.cantidad}
                  </td>
                  <td className="p-3 text-right text-gray-500">{m.stock_antes}</td>
                  <td className="p-3 text-right font-semibold">{m.stock_despues}</td>
                  <td className="p-3 text-gray-500 text-xs">{m.observaciones ?? "—"}</td>
                </tr>
              ))}
              {filtrados.length === 0 && (
                <tr><td colSpan={7} className="p-8 text-center text-gray-400">Sin movimientos.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
