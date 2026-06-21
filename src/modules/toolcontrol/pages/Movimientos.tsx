import { useEffect, useState } from "react";
import ToolControlMenu from "../components/ToolControlMenu";
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
    <div className="p-6 space-y-4">
      <ToolControlMenu />
      <div>
        <h1 className="text-2xl font-bold">Movimientos</h1>
        <p className="text-sm text-gray-500">Historial de salidas y devoluciones</p>
      </div>

      <div className="flex flex-wrap gap-2">
        <input
          value={filtroTexto}
          onChange={(e) => setFiltroTexto(e.target.value)}
          placeholder="Buscar herramienta, operario, OT..."
          className="rounded-lg border px-3 py-2 text-sm w-64"
        />
        <select
          value={filtroTipo}
          onChange={(e) => setFiltroTipo(e.target.value)}
          className="rounded-lg border px-3 py-2 text-sm"
        >
          <option value="">Todos</option>
          <option value="salida">Salida</option>
          <option value="devolucion">Devolución</option>
        </select>
        {(filtroTipo || filtroTexto) && (
          <button onClick={() => { setFiltroTipo(""); setFiltroTexto(""); }}
            className="rounded-lg border px-3 py-2 text-sm text-gray-500 hover:bg-gray-50">
            Limpiar
          </button>
        )}
      </div>

      {cargando ? (
        <div className="py-10 text-center text-gray-400">Cargando...</div>
      ) : (
        <div className="overflow-auto rounded-xl border bg-white">
          <table className="w-full min-w-[800px] text-sm">
            <thead className="bg-gray-50 text-left">
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
                <tr key={m.id} className="border-t hover:bg-gray-50">
                  <td className="p-3 text-xs text-gray-500 whitespace-nowrap">
                    {new Date(m.fecha_salida).toLocaleString("es-ES")}
                  </td>
                  <td className="p-3">
                    <div className="font-medium">{(m.tc_tools as any)?.nombre ?? "—"}</div>
                    <div className="text-xs text-gray-400">{(m.tc_tools as any)?.codigo ?? ""}</div>
                  </td>
                  <td className="p-3">{(m.sea_employees as any)?.nombre ?? "—"}</td>
                  <td className="p-3">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                      m.tipo === "salida" ? "bg-blue-100 text-blue-800" : "bg-green-100 text-green-800"
                    }`}>
                      {m.tipo}
                    </span>
                  </td>
                  <td className="p-3 font-mono text-gray-500">{m.orden_trabajo ?? "—"}</td>
                  <td className="p-3 text-xs text-gray-500">
                    {m.fecha_devolucion ? new Date(m.fecha_devolucion).toLocaleString("es-ES") : "Pendiente"}
                  </td>
                  <td className="p-3 text-gray-500">{m.estado_final ?? "—"}</td>
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
