import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { listarUnidadesPorIdentificar, listarCandidatasFicha, identificarUnidad, listarEmpresas } from "../services/data";
import type { UnidadPorIdentificar } from "../services/data";
import type { Neumatico, Empresa } from "../types";
import { Modal, TableWrap, tdCls, thCls } from "../components/ui";

/**
 * Bandeja de unidades históricas sin ficha: usados y recauchutados que se
 * montaron según el albarán pero que no se pueden identificar solos.
 *
 * El sistema NO adivina: enseña candidatas de la misma medida y espera a que
 * una persona decida y diga en qué se basa. Coincidir en marca, medida o
 * fecha no demuestra que sea la misma goma.
 */
export default function UnidadesPorIdentificar() {
  const [empresas, setEmpresas] = useState<Empresa[]>([]);
  const [empresaId, setEmpresaId] = useState("");
  const [unidades, setUnidades] = useState<UnidadPorIdentificar[]>([]);
  const [cargando, setCargando] = useState(true);
  const [msg, setMsg] = useState("");
  const [sel, setSel] = useState<UnidadPorIdentificar | null>(null);
  const [candidatas, setCandidatas] = useState<Neumatico[]>([]);
  const [elegida, setElegida] = useState<string>("");
  const [motivo, setMotivo] = useState("");
  const [guardando, setGuardando] = useState(false);

  async function cargar() {
    if (!empresaId) return;
    setCargando(true);
    try { setUnidades(await listarUnidadesPorIdentificar(empresaId)); }
    catch (e: any) { setMsg(e?.message || "Error al cargar la bandeja"); }
    finally { setCargando(false); }
  }
  useEffect(() => {
    listarEmpresas().then((es) => { setEmpresas(es); if (!empresaId && es[0]) setEmpresaId(es[0].id); })
      .catch(() => setEmpresas([]));
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, []);
  useEffect(() => { cargar(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [empresaId]);

  async function abrir(u: UnidadPorIdentificar) {
    setSel(u); setElegida(""); setMotivo(""); setMsg("");
    try { setCandidatas(await listarCandidatasFicha(empresaId, u.medida_txt)); }
    catch { setCandidatas([]); }
  }

  async function confirmar(crear: boolean) {
    if (!sel) return;
    if (!motivo.trim()) { setMsg("Hace falta decir en qué se basa la identificación"); return; }
    setGuardando(true); setMsg("");
    try {
      await identificarUnidad(sel.id, crear ? null : (elegida || null), crear, motivo.trim());
      setSel(null); await cargar();
    } catch (e: any) { setMsg(e?.message || "No se ha podido identificar"); }
    finally { setGuardando(false); }
  }

  const porCondicion = useMemo(() => {
    const m = new Map<string, number>();
    for (const u of unidades) m.set(u.condicion ?? "—", (m.get(u.condicion ?? "—") ?? 0) + 1);
    return [...m.entries()];
  }, [unidades]);

  return (
    <div className="p-4">
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <h1 className="text-lg font-semibold text-slate-100">Unidades por identificar</h1>
        <Link to="/tyrecontrol/importar" className="text-xs text-sky-300 hover:underline">← Importar</Link>
        <select value={empresaId} onChange={(e) => setEmpresaId(e.target.value)}
          className="rounded-lg border border-slate-600 bg-slate-900 px-2 py-1 text-xs text-slate-200">
          {empresas.map((e) => <option key={e.id} value={e.id}>{e.nombre}</option>)}
        </select>
        <span className="ml-auto text-xs text-slate-400">
          {unidades.length} sin ficha {porCondicion.length > 0 && <>· {porCondicion.map(([c, n]) => `${n} ${c}`).join(" · ")}</>}
        </span>
      </div>

      <p className="mb-3 max-w-3xl text-xs text-slate-400">
        Son montajes del histórico de albaranes cuya goma no se puede identificar: usados y recauchutados que
        el albarán no describe. Cuentan como montaje, pero no tienen ficha y no entran en nada que dependa de
        la identidad. Enlazar una ficha es una decisión humana y queda auditada.
      </p>

      {msg && <div className="mb-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-200">{msg}</div>}
      {cargando ? <div className="text-slate-400">Cargando…</div> : (
        <TableWrap>
          <table className="min-w-full text-sm">
            <thead><tr>
              <th className={thCls}>Fecha</th><th className={thCls}>Albarán</th><th className={thCls}>Vehículo</th>
              <th className={thCls}>Condición</th><th className={thCls}>Neumático</th><th className={thCls}></th>
            </tr></thead>
            <tbody>
              {unidades.map((u) => (
                <tr key={u.id} className="border-t border-slate-700">
                  <td className={tdCls}>{u.fecha_operacion}</td>
                  <td className={tdCls}>{(u.intervencion?.origen_doc ?? "—").split("|")[0]}</td>
                  <td className={tdCls}>{u.vehiculo?.matricula ?? "—"}</td>
                  <td className={tdCls}>{u.condicion ?? "—"}</td>
                  <td className={tdCls + " text-slate-400"}>
                    {[u.marca_txt, u.modelo_txt, u.medida_txt].filter(Boolean).join(" ") || "sin referencia"}
                  </td>
                  <td className={tdCls}>
                    <button onClick={() => abrir(u)} className="rounded border border-slate-600 px-2 py-1 text-xs text-slate-200 hover:bg-slate-700">Identificar…</button>
                  </td>
                </tr>
              ))}
              {unidades.length === 0 && <tr><td className={tdCls} colSpan={6}>No queda ninguna unidad por identificar.</td></tr>}
            </tbody>
          </table>
        </TableWrap>
      )}

      {sel && (
        <Modal title="Identificar la unidad" onClose={() => setSel(null)}>
          <div className="mb-3 text-sm text-slate-300">
            {sel.fecha_operacion} · {sel.vehiculo?.matricula ?? "—"} ·{" "}
            {[sel.marca_txt, sel.modelo_txt, sel.medida_txt].filter(Boolean).join(" ") || "sin referencia"}
          </div>
          <div className="mb-2 text-[11px] font-semibold uppercase text-slate-400">Fichas candidatas (misma medida, sin vehículo)</div>
          <select value={elegida} onChange={(e) => setElegida(e.target.value)}
            className="mb-3 w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-slate-200">
            <option value="">— ninguna —</option>
            {candidatas.map((c) => (
              <option key={c.id} value={c.id}>
                {c.numero_interno ?? c.codigo_interno} · {[c.marca, c.modelo, c.medida].filter(Boolean).join(" ")} · {c.estado}
              </option>
            ))}
          </select>
          <div className="mb-2 text-[11px] font-semibold uppercase text-slate-400">¿En qué te basas?</div>
          <input value={motivo} onChange={(e) => setMotivo(e.target.value)}
            placeholder="Ej.: el técnico la reconoció por el número grabado"
            className="mb-3 w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-slate-200 placeholder:text-slate-500" />
          {msg && <div className="mb-3 rounded-lg border border-rose-500/40 bg-rose-500/10 p-2 text-xs text-rose-200">{msg}</div>}
          <div className="flex flex-wrap gap-2">
            <button disabled={guardando || !elegida} onClick={() => confirmar(false)}
              className="rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-40">Enlazar esta ficha</button>
            <button disabled={guardando} onClick={() => confirmar(true)}
              className="rounded-lg border border-slate-600 px-3 py-2 text-sm text-slate-200 hover:bg-slate-700 disabled:opacity-40">Crear ficha nueva</button>
            <button onClick={() => setSel(null)} className="ml-auto rounded-lg px-3 py-2 text-sm text-slate-400 hover:text-slate-200">Cancelar</button>
          </div>
          <p className="mt-3 text-[11px] text-slate-500">
            Crear una ficha le da un número interno del sistema, no una identificación física: queda marcada como
            identidad reconstruida y no cuenta como existencias.
          </p>
        </Modal>
      )}
    </div>
  );
}
