import { useEffect, useState } from "react";
import { Search } from "lucide-react";
import { supabase } from "../services/supabase";
import { TableWrap, thCls, tdCls, inputCls, Pill, EmptyRow, ErrorBox } from "../components/ui";
import { fmtFecha, CENTRO_LABELS, type Centro } from "../types";

type OtEstado = {
  id: string;
  ot_number: string | null;
  vehicle_plate: string | null;
  status: string;
  center: Centro;
  created_at: string;
  customer_name: string;
};

/** Vista para técnicos: estado de las OTs sin información económica. */
export default function EstadoOts() {
  const [ots, setOts] = useState<OtEstado[]>([]);
  const [filtro, setFiltro] = useState("");
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      const { data, error: err } = await supabase
        .from("adm_ot_estado")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(200);
      if (err) setError(err.message);
      else setOts((data ?? []) as OtEstado[]);
      setCargando(false);
    })();
  }, []);

  const visibles = filtro.trim()
    ? ots.filter((o) =>
        [o.ot_number, o.vehicle_plate, o.customer_name].some((v) => v?.toLowerCase().includes(filtro.trim().toLowerCase()))
      )
    : ots;

  return (
    <div>
      <h1 className="mb-1 text-lg font-black">Estado de OTs</h1>
      <p className="mb-3 text-sm text-slate-400">Consulta si una orden de trabajo está abierta o cerrada.</p>

      {error && <ErrorBox>{error}</ErrorBox>}

      <div className="relative mb-3 max-w-md">
        <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-500" />
        <input
          value={filtro}
          onChange={(e) => setFiltro(e.target.value)}
          placeholder="Buscar por OT, matrícula o cliente…"
          className={`${inputCls} pl-9`}
        />
      </div>

      <TableWrap>
        <thead>
          <tr className="border-b border-slate-700">
            <th className={thCls}>Nº OT</th>
            <th className={thCls}>Matrícula</th>
            <th className={thCls}>Cliente</th>
            <th className={thCls}>Centro</th>
            <th className={thCls}>Fecha</th>
            <th className={thCls}>Estado</th>
          </tr>
        </thead>
        <tbody>
          {cargando && <EmptyRow cols={6} text="Cargando…" />}
          {!cargando && visibles.length === 0 && <EmptyRow cols={6} text="No hay órdenes de trabajo." />}
          {!cargando && visibles.map((o) => (
            <tr key={o.id} className="border-b border-slate-700/50 hover:bg-slate-700/30">
              <td className={`${tdCls} font-semibold`}>{o.ot_number ?? o.id.slice(0, 8)}</td>
              <td className={tdCls}>{o.vehicle_plate ?? "—"}</td>
              <td className={tdCls}>{o.customer_name}</td>
              <td className={tdCls}>{CENTRO_LABELS[o.center]}</td>
              <td className={tdCls}>{fmtFecha(o.created_at)}</td>
              <td className={tdCls}>
                <Pill className={o.status === "abierta" ? "bg-sky-500/20 text-sky-300" : o.status === "cerrada" ? "bg-emerald-500/20 text-emerald-300" : "bg-slate-700 text-slate-400"}>
                  {o.status}
                </Pill>
              </td>
            </tr>
          ))}
        </tbody>
      </TableWrap>
    </div>
  );
}
