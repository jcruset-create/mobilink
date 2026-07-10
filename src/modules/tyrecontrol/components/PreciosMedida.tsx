import { useEffect, useState } from "react";
import { listarPreciosMedida, guardarPrecioMedida, eliminarPrecioMedida, listarMedidas } from "../services/data";
import type { PrecioMedida, MedidaNeumatico } from "../types";
import { inputCls, TableWrap, tdCls, thCls } from "./ui";
import { useTyreAuth } from "../contexts/TyreAuthContext";

// Precios de referencia por medida (neumático nuevo / recauchutado). Se usan
// para calcular los ahorros del informe económico (ahorro por reparación =
// precio nuevo − coste de la reparación).
export default function PreciosMedida({ empresaId }: { empresaId: string }) {
  const { perfil } = useTyreAuth();
  const puedeEditar = !!(perfil?.es_superadmin || perfil?.rol === "administrador");

  const [precios, setPrecios] = useState<PrecioMedida[]>([]);
  const [medidas, setMedidas] = useState<MedidaNeumatico[]>([]);
  const [nuevaMedida, setNuevaMedida] = useState("");
  const [nuevoNuevo, setNuevoNuevo] = useState("");
  const [nuevoRecau, setNuevoRecau] = useState("");
  const [msg, setMsg] = useState("");

  async function cargar() {
    const [p, meds] = await Promise.all([
      listarPreciosMedida(empresaId).catch(() => [] as PrecioMedida[]),
      listarMedidas().catch(() => [] as MedidaNeumatico[]),
    ]);
    setPrecios(p); setMedidas(meds);
  }
  useEffect(() => { void cargar(); /* eslint-disable-next-line */ }, [empresaId]);

  const num = (s: string) => (s.trim() === "" ? null : Number(s.replace(",", ".")));

  async function anadir() {
    if (!nuevaMedida) return;
    setMsg("");
    try {
      await guardarPrecioMedida(empresaId, nuevaMedida, { precio_nuevo: num(nuevoNuevo), precio_recauchutado: num(nuevoRecau) });
      setNuevaMedida(""); setNuevoNuevo(""); setNuevoRecau("");
      setPrecios(await listarPreciosMedida(empresaId));
    } catch (e: any) { setMsg(e?.message || "Error al guardar"); }
  }

  async function borrar(medida: string) {
    if (!window.confirm(`¿Eliminar el precio de referencia de ${medida}?`)) return;
    await eliminarPrecioMedida(empresaId, medida);
    setPrecios(await listarPreciosMedida(empresaId));
  }

  return (
    <div className="rounded-lg bg-slate-800 p-3">
      <div className="mb-1 text-[11px] font-bold uppercase text-slate-400">Precios de referencia por medida</div>
      <div className="mb-2 text-[11px] text-slate-500">Precio de un neumático nuevo y recauchutado por medida. Se usan para calcular los ahorros del informe económico.</div>

      {puedeEditar && (
        <div className="mb-2 flex flex-wrap items-end gap-2">
          <div className="min-w-[150px]">
            <div className="mb-1 text-[11px] text-slate-400">Medida</div>
            <select className={inputCls} value={nuevaMedida} onChange={(e) => setNuevaMedida(e.target.value)}>
              <option value="">Selecciona…</option>
              {medidas.map((m) => <option key={m.id} value={m.valor}>{m.valor}</option>)}
            </select>
          </div>
          <div className="w-32"><div className="mb-1 text-[11px] text-slate-400">Nuevo (€)</div><input type="number" step="1" className={inputCls} value={nuevoNuevo} onChange={(e) => setNuevoNuevo(e.target.value)} /></div>
          <div className="w-32"><div className="mb-1 text-[11px] text-slate-400">Recauchutado (€)</div><input type="number" step="1" className={inputCls} value={nuevoRecau} onChange={(e) => setNuevoRecau(e.target.value)} /></div>
          <button onClick={anadir} className="rounded bg-sky-600 px-3 py-1.5 text-[12px] font-bold text-white">Añadir / actualizar</button>
          {msg && <span className="text-[12px] text-rose-300">{msg}</span>}
        </div>
      )}

      <TableWrap>
        <thead className="bg-slate-900"><tr>
          <th className={thCls}>Medida</th><th className={thCls}>Nuevo (€)</th><th className={thCls}>Recauchutado (€)</th><th className={thCls}></th>
        </tr></thead>
        <tbody>
          {precios.length === 0 ? <tr><td className={tdCls + " text-slate-500"} colSpan={4}>Sin precios de referencia.</td></tr>
          : precios.map((p) => (
            <tr key={p.medida} className="border-t border-slate-700/60">
              <td className={tdCls + " font-semibold text-slate-200"}>{p.medida}</td>
              <td className={tdCls + " text-slate-300"}>{p.precio_nuevo ?? "—"}</td>
              <td className={tdCls + " text-slate-300"}>{p.precio_recauchutado ?? "—"}</td>
              <td className={tdCls}>{puedeEditar && <button onClick={() => borrar(p.medida)} className="text-rose-400 hover:underline">Eliminar</button>}</td>
            </tr>
          ))}
        </tbody>
      </TableWrap>
    </div>
  );
}
