/**
 * Almacén de usados → «Pendientes de clasificar»: mandar en lote al almacén, a
 * reciclaje o dar de baja las gomas en estado pendiente_clasificacion.
 */
import { useMemo, useState } from "react";
import { TableWrap, tdCls, thCls, inputCls } from "./ui";
import {
  clasificarPendientes, type DestinoClasificacion, type GrupoPendiente, type PendienteClasificar,
} from "../services/clasificarUsados";

const GRUPOS: Record<GrupoPendiente, { t: string; d: string }> = {
  provisional: { t: "Fichas provisionales «IMP-…»", d: "De la carga inicial; sobraron al informar las gomas reales. Sin profundidad ni nº de serie." },
  excel: { t: "Importación de Excel", d: "Hay que mirar si existen." },
  catalogo_usado: { t: "Catálogo usado", d: "Con profundidad: candidatas al almacén." },
  otros: { t: "Otras", d: "Almacén genérico, carga inicial…" },
};
const SUG: Record<string, { t: string; cls: string }> = {
  almacen: { t: "almacén", cls: "bg-emerald-500/15 text-emerald-300" },
  baja: { t: "baja", cls: "bg-rose-500/15 text-rose-300" },
  decidir: { t: "decidir", cls: "bg-amber-500/15 text-amber-300" },
};
const n = (x: number) => x.toLocaleString("es-ES");

export default function PendientesClasificar({ empresaId, items, puedeEditar, onCambio }: {
  empresaId: string; items: PendienteClasificar[]; puedeEditar: boolean; onCambio: (msg: string) => void;
}) {
  const [grupo, setGrupo] = useState<"" | GrupoPendiente>("");
  const [medida, setMedida] = useState("");
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [almacen, setAlmacen] = useState<"almacen_flota" | "almacen_taller">("almacen_flota");
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState("");

  const porGrupo = useMemo(() => {
    const m = new Map<GrupoPendiente, { n: number; mm: number }>();
    for (const i of items) {
      const g = m.get(i.grupo) ?? { n: 0, mm: 0 };
      g.n++; if (i.profundidad_actual_mm != null) g.mm++;
      m.set(i.grupo, g);
    }
    return m;
  }, [items]);
  const medidas = useMemo(() => Array.from(new Set(items.map((i) => i.medida).filter(Boolean))).sort() as string[], [items]);
  const visibles = useMemo(
    () => items.filter((i) => (!grupo || i.grupo === grupo) && (!medida || i.medida === medida)),
    [items, grupo, medida],
  );
  const LIMITE = 300;

  const marcar = (f: (i: PendienteClasificar) => boolean) => setSel(new Set(items.filter(f).map((i) => i.neumatico_id)));
  const alternar = (id: string) => setSel((s) => { const x = new Set(s); if (x.has(id)) x.delete(id); else x.add(id); return x; });

  async function hacer(destino: DestinoClasificacion) {
    const ids = [...sel];
    const texto = destino === "baja" ? "dar de baja (fichas que sobran: dejan de contar, no se borran)"
      : destino === "reciclaje" ? "mandar a reciclaje"
      : `mandar al ${destino === "almacen_flota" ? "almacén de flota" : "almacén de taller"}`;
    if (!window.confirm(`¿${texto.charAt(0).toUpperCase()}${texto.slice(1)} ${n(ids.length)} neumático${ids.length === 1 ? "" : "s"}?`)) return;
    setOcupado(true); setError("");
    try {
      const hechas = await clasificarPendientes(empresaId, ids, destino, destino === "baja" ? "Ficha provisional sobrante (Almacén de usados)" : undefined);
      setSel(new Set());
      onCambio(`✔ ${n(hechas)} neumático${hechas === 1 ? "" : "s"}: ${texto}.`);
    } catch (e) { setError(e instanceof Error ? e.message : "Error al clasificar"); }
    finally { setOcupado(false); }
  }

  if (!items.length) return <div className="rounded-lg bg-slate-800 p-4 text-sm text-slate-400">No hay neumáticos pendientes de clasificar en esta empresa.</div>;

  return (
    <div className="space-y-3">
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {(Object.keys(GRUPOS) as GrupoPendiente[]).filter((g) => porGrupo.get(g)).map((g) => (
          <button key={g} onClick={() => setGrupo(grupo === g ? "" : g)}
            className={`rounded-lg border p-3 text-left ${grupo === g ? "border-sky-500 bg-sky-500/10" : "border-slate-700 bg-slate-800 hover:border-slate-500"}`}>
            <div className="text-[12px] font-bold text-slate-200">{GRUPOS[g].t}</div>
            <div className="text-xl font-black tabular-nums text-slate-100">{n(porGrupo.get(g)!.n)}</div>
            <div className="text-[11px] text-slate-400">{GRUPOS[g].d}</div>
            <div className="mt-1 text-[10px] text-slate-500">{n(porGrupo.get(g)!.mm)} con profundidad</div>
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col text-[10px] text-slate-500">Medida
          <select className={`${inputCls} max-w-[170px]`} value={medida} onChange={(e) => setMedida(e.target.value)}>
            <option value="">Todas</option>
            {medidas.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </label>
        <button className="rounded-lg border border-slate-600 px-3 py-2 text-[12px] text-slate-200 hover:bg-slate-700"
          onClick={() => marcar((i) => i.profundidad_actual_mm != null)}>Marcar las {n(items.filter((i) => i.profundidad_actual_mm != null).length)} con profundidad</button>
        {porGrupo.get("provisional") && (
          <button className="rounded-lg border border-slate-600 px-3 py-2 text-[12px] text-slate-200 hover:bg-slate-700"
            onClick={() => marcar((i) => i.grupo === "provisional")}>Marcar las {n(porGrupo.get("provisional")!.n)} provisionales</button>
        )}
        <button className="rounded-lg border border-slate-600 px-3 py-2 text-[12px] text-slate-200 hover:bg-slate-700"
          onClick={() => setSel(new Set(visibles.map((i) => i.neumatico_id)))}>Marcar las {n(visibles.length)} filtradas</button>
        {sel.size > 0 && <button className="px-2 py-2 text-[12px] text-slate-400 hover:underline" onClick={() => setSel(new Set())}>Quitar marcas</button>}
      </div>

      {puedeEditar && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-700 bg-slate-900/60 p-2.5">
          <span className="text-sm text-slate-200"><b>{n(sel.size)}</b> marcadas</span>
          <span className="flex flex-wrap items-center gap-2">
            <select className={`${inputCls} max-w-[180px]`} value={almacen} onChange={(e) => setAlmacen(e.target.value as "almacen_flota" | "almacen_taller")}>
              <option value="almacen_flota">Almacén de flota</option>
              <option value="almacen_taller">Almacén de taller</option>
            </select>
            <button disabled={!sel.size || ocupado} onClick={() => void hacer(almacen)}
              className="rounded-lg bg-emerald-600 px-3 py-2 text-[12px] font-bold text-white disabled:opacity-40">→ Al almacén</button>
            <button disabled={!sel.size || ocupado} onClick={() => void hacer("reciclaje")}
              className="rounded-lg border border-violet-500 px-3 py-2 text-[12px] font-bold text-violet-300 disabled:opacity-40">→ Reciclaje</button>
            <button disabled={!sel.size || ocupado} onClick={() => void hacer("baja")}
              className="rounded-lg border border-rose-500 px-3 py-2 text-[12px] font-bold text-rose-300 disabled:opacity-40">Dar de baja (ficha que sobra)</button>
          </span>
        </div>
      )}
      {error && <div className="text-sm text-red-300">{error}</div>}

      <TableWrap>
        <thead className="bg-slate-900"><tr>
          <th className={thCls}></th>
          <th className={thCls}>Neumático</th>
          <th className={thCls}>Marca y medida</th>
          <th className={thCls}>mm</th>
          <th className={thCls}>Grupo</th>
          <th className={thCls}>Sugerido</th>
        </tr></thead>
        <tbody>
          {visibles.slice(0, LIMITE).map((i) => (
            <tr key={i.neumatico_id} className="border-t border-slate-700/60">
              <td className={tdCls}>{puedeEditar && <input type="checkbox" checked={sel.has(i.neumatico_id)} onChange={() => alternar(i.neumatico_id)} />}</td>
              <td className={tdCls + " font-mono text-[12px] text-slate-200"}>{i.codigo ?? "—"}</td>
              <td className={tdCls + " text-slate-400"}>{[i.marca, i.modelo].filter(Boolean).join(" ")}<div className="text-[10px] text-slate-500">{i.medida ?? "—"}</div></td>
              <td className={tdCls + " tabular-nums " + (i.profundidad_actual_mm != null ? "text-emerald-300" : "text-slate-500")}>{i.profundidad_actual_mm ?? "—"}</td>
              <td className={tdCls + " text-slate-400"}>{GRUPOS[i.grupo]?.t ?? i.grupo}</td>
              <td className={tdCls}><span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${SUG[i.sugerido]?.cls ?? ""}`}>{SUG[i.sugerido]?.t ?? i.sugerido}</span></td>
            </tr>
          ))}
        </tbody>
      </TableWrap>
      {visibles.length > LIMITE && (
        <div className="text-[12px] text-slate-500">Se enseñan {n(LIMITE)} de {n(visibles.length)}. Los botones de «Marcar» marcan todas, también las que no se ven.</div>
      )}
    </div>
  );
}
