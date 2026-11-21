/**
 * «✨ Completar fichas con IA»: elegir referencias con huecos, buscar de una
 * en una y aceptar campo a campo. Nada se escribe en el catálogo sin aceptar.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { ExternalLink, Sparkles } from "lucide-react";
import { Modal, inputCls } from "./ui";
import { CAMPOS, CAMPO_POR_CLAVE } from "../services/completarFicha";
import {
  aceptarPropuestasIA, completarReferenciaIA, descartarPropuestasIA, huecosCatalogo, mismoModeloIA, propuestasIA,
  type FilaHueco, type Propuesta, type ResumenHuecos,
} from "../services/completarFichaIA";

const MAX_TANDA = 20;
const FUENTE: Record<string, { t: string; cls: string }> = {
  oficial: { t: "Oficial", cls: "bg-emerald-500/15 text-emerald-300" },
  eprel: { t: "EPREL (UE)", cls: "bg-sky-500/15 text-sky-300" },
  distribuidor: { t: "Distribuidor", cls: "bg-amber-500/15 text-amber-300" },
};
const etiqueta = (c: string) => CAMPO_POR_CLAVE.get(c)?.etiqueta ?? c;
const valorBonito = (p: Propuesta) => {
  const c = CAMPO_POR_CLAVE.get(p.campo);
  if (c?.tipo === "bool") return p.valor === "true" ? "Sí" : "No";
  return `${String(p.valor).replace(".", ",")}${c?.unidad ? ` ${c.unidad}` : ""}`;
};
const host = (u: string | null) => { try { return u ? new URL(u).hostname.replace(/^www\./, "") : ""; } catch { return ""; } };

export default function CompletarFichasIA({ onClose, onCambio }: { onClose: () => void; onCambio: () => void }) {
  const [marca, setMarca] = useState("");
  const [campo, setCampo] = useState("profundidad_dibujo_mm");
  const [soloFlota, setSoloFlota] = useState(false);
  const [filas, setFilas] = useState<FilaHueco[]>([]);
  const [resumen, setResumen] = useState<ResumenHuecos | null>(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState("");
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [progreso, setProgreso] = useState<{ hechas: number; total: number; actual: string; avisos: string[] } | null>(null);
  const parar = useRef(false);
  const [propuestas, setPropuestas] = useState<Propuesta[] | null>(null);
  const [marcadas, setMarcadas] = useState<Set<string>>(new Set());
  const [corregir, setCorregir] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [msg, setMsg] = useState("");

  async function cargar() {
    setCargando(true); setError("");
    try {
      const r = await huecosCatalogo({ marca: marca.trim() || undefined, campo: campo || undefined, soloFlota });
      setFilas(r.filas); setResumen(r.resumen); setSel(new Set());
    } catch (e) { setError(e instanceof Error ? e.message : "Error"); }
    finally { setCargando(false); }
  }
  // Primera carga, con el filtro por defecto (las que no tienen profundidad).
  useEffect(() => {
    let vivo = true;
    huecosCatalogo({ campo: "profundidad_dibujo_mm" })
      .then((r) => { if (vivo) { setFilas(r.filas); setResumen(r.resumen); } })
      .catch((e) => { if (vivo) setError(e instanceof Error ? e.message : "Error"); });
    return () => { vivo = false; };
  }, []);

  const elegidas = useMemo(() => filas.filter((f) => sel.has(f.id)), [filas, sel]);

  async function buscar() {
    parar.current = false;
    const avisos: string[] = [];
    setProgreso({ hechas: 0, total: elegidas.length, actual: "", avisos });
    for (let i = 0; i < elegidas.length; i++) {
      if (parar.current) break;
      const f = elegidas[i];
      setProgreso({ hechas: i, total: elegidas.length, actual: f.referenciaCompleta, avisos: [...avisos] });
      try {
        const r = await completarReferenciaIA(f.id);
        if (r.aviso) avisos.push(`${f.referenciaCompleta}: ${r.aviso}`);
      } catch (e) { avisos.push(`${f.referenciaCompleta}: ${e instanceof Error ? e.message : "error"}`); }
    }
    setProgreso((p) => (p ? { ...p, hechas: p.total, actual: "", avisos } : p));
    const ps = await propuestasIA(elegidas.map((f) => f.id)).catch(() => [] as Propuesta[]);
    setPropuestas(ps);
    // Oficiales y EPREL vienen marcadas; las de distribuidor, no.
    setMarcadas(new Set(ps.filter((p) => p.estado === "pendiente" && p.tipo_fuente !== "distribuidor").map((p) => p.id)));
  }

  /** Confirmar que el nombre de la ficha es el mismo modelo: alias y nueva comprobación. */
  async function esMismoModelo(refId: string) {
    setMsg("");
    try {
      const r = await mismoModeloIA(refId);
      const ps = await propuestasIA([...new Set((propuestas ?? []).map((p) => p.referencia_id))]);
      setPropuestas(ps);
      // Las rescatadas se marcan con la regla de siempre (oficial y EPREL sí).
      setMarcadas((s) => {
        const n = new Set(s);
        for (const p of ps) if (p.referencia_id === refId && p.estado === "pendiente" && p.tipo_fuente !== "distribuidor") n.add(p.id);
        return n;
      });
      setMsg(`✔ «${r.alias}» guardado como otro nombre del modelo · ${r.rescatadas} datos recuperados` +
        (r.siguenDescartadas ? ` · ${r.siguenDescartadas} siguen descartados por otro motivo` : ""));
    } catch (e) { setMsg(e instanceof Error ? e.message : "Error"); }
  }

  async function guardar() {
    setGuardando(true); setMsg("");
    try {
      const ids = [...marcadas];
      const r = await aceptarPropuestasIA(ids, corregir);
      const sobran = (propuestas ?? []).filter((p) => p.estado === "pendiente" && !marcadas.has(p.id)).map((p) => p.id);
      if (sobran.length) await descartarPropuestasIA(sobran);
      setMsg(`✔ ${r.aceptadas} datos guardados en el catálogo${r.saltadas ? ` · ${r.saltadas} saltados porque el campo ya tenía dato` : ""}.`);
      setPropuestas(null); setProgreso(null);
      onCambio(); await cargar();
    } catch (e) { setMsg(e instanceof Error ? e.message : "Error al guardar"); }
    finally { setGuardando(false); }
  }

  const porRef = useMemo(() => {
    const m = new Map<string, Propuesta[]>();
    for (const p of propuestas ?? []) m.set(p.referencia_id, [...(m.get(p.referencia_id) ?? []), p]);
    return m;
  }, [propuestas]);
  const nombreRef = (id: string) => filas.find((f) => f.id === id)?.referenciaCompleta ?? id;
  const toggle = (s: Set<string>, id: string) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; };

  return (
    <Modal title="✨ Completar fichas con IA" size="xl" onClose={onClose}>
      <div className="space-y-3 text-sm">
        {resumen && (
          <div className="grid gap-2 sm:grid-cols-4">
            {[["Referencias activas", resumen.referencias, ""], ["Sin profundidad de nuevo", resumen.sinProfundidad, "text-rose-300"],
              ["Sin etiqueta UE", resumen.sinEtiqueta, "text-rose-300"], ["Con algún hueco", resumen.conHueco, ""]].map(([t, v, c]) => (
              <div key={String(t)} className="rounded-lg border border-slate-700 bg-slate-900/40 p-2.5">
                <div className="text-[10px] font-bold uppercase text-slate-400">{t}</div>
                <div className={`text-lg font-black ${c}`}>{v}</div>
              </div>
            ))}
          </div>
        )}

        {!propuestas && (
          <>
            <div className="flex flex-wrap items-end gap-2">
              <label className="block"><span className="mb-1 block text-[10px] font-semibold uppercase text-slate-400">Marca</span>
                <input className={`${inputCls} w-40`} value={marca} onChange={(e) => setMarca(e.target.value)} placeholder="todas" /></label>
              <label className="block"><span className="mb-1 block text-[10px] font-semibold uppercase text-slate-400">Le falta</span>
                <select className={inputCls} value={campo} onChange={(e) => setCampo(e.target.value)}>
                  <option value="">cualquier dato</option>
                  {CAMPOS.map((c) => <option key={c.clave} value={c.clave}>{c.etiqueta}</option>)}
                </select></label>
              <label className="flex items-center gap-1.5 pb-2 text-[12px] text-slate-300">
                <input type="checkbox" checked={soloFlota} onChange={(e) => setSoloFlota(e.target.checked)} /> Solo con neumáticos en la flota</label>
              <button onClick={() => void cargar()} disabled={cargando} className="rounded-lg border border-slate-600 px-3 py-2 text-[12px] text-slate-200">
                {cargando ? "Cargando…" : "Filtrar"}</button>
              <button onClick={() => void buscar()} disabled={!elegidas.length || !!progreso && progreso.hechas < progreso.total}
                className="ml-auto inline-flex items-center gap-1.5 rounded-lg bg-violet-600 px-3 py-2 text-[13px] font-bold text-white disabled:opacity-40">
                <Sparkles size={14} /> Buscar datos de {elegidas.length || "las"} marcada{elegidas.length === 1 ? "" : "s"}</button>
            </div>
            {error && <div className="text-rose-300">{error}</div>}

            {progreso && (
              <div className="rounded-lg border border-violet-500/40 bg-violet-500/10 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <b>{progreso.hechas < progreso.total ? `Buscando ${progreso.hechas + 1} de ${progreso.total}` : "Búsqueda terminada"}</b>
                  {progreso.actual && <span className="text-[12px] text-slate-400">{progreso.actual}</span>}
                  {progreso.hechas < progreso.total && (
                    <button onClick={() => { parar.current = true; }} className="ml-auto rounded border border-slate-600 px-2 py-1 text-[11px]">Parar</button>)}
                </div>
                <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-800">
                  <div className="h-full bg-violet-500" style={{ width: `${(progreso.hechas / Math.max(1, progreso.total)) * 100}%` }} />
                </div>
              </div>
            )}

            <div className="max-h-[50vh] overflow-auto rounded-lg border border-slate-700">
              <table className="w-full min-w-[720px] text-[12px]">
                <thead className="sticky top-0 bg-slate-900 text-slate-400"><tr className="text-left">
                  <th className="p-2" /><th>Referencia</th><th>En flota</th><th>Rellenos</th><th>Le falta</th>
                </tr></thead>
                <tbody>
                  {filas.map((f) => {
                    const on = sel.has(f.id);
                    const lleno = !on && sel.size >= MAX_TANDA;
                    return (
                      <tr key={f.id} className="border-t border-slate-700/50">
                        <td className="p-2"><input type="checkbox" checked={on} disabled={lleno} onChange={() => setSel((s) => toggle(s, f.id))} /></td>
                        <td className="font-semibold text-slate-200">{f.referenciaCompleta}</td>
                        <td>{f.enFlota}</td>
                        <td>{f.rellenos}/{f.total}</td>
                        <td className="text-slate-400">{f.vacios.slice(0, 5).map(etiqueta).join(", ")}{f.vacios.length > 5 ? "…" : ""}</td>
                      </tr>
                    );
                  })}
                  {!filas.length && !cargando && <tr><td colSpan={5} className="p-3 text-slate-500">Nada que completar con este filtro.</td></tr>}
                </tbody>
              </table>
            </div>
            <div className="text-[11px] text-slate-500">Primero, las de más neumáticos en la flota. Como mucho {MAX_TANDA} por tanda. Se busca una referencia cada vez y nada se escribe en el catálogo hasta que lo aceptes.</div>
          </>
        )}

        {propuestas && (
          <>
            {progreso?.avisos.length ? (
              <div className="rounded border border-amber-500/40 bg-amber-500/10 p-2 text-[12px] text-amber-200">
                {progreso.avisos.map((a) => <div key={a}>{a}</div>)}
              </div>
            ) : null}
            {[...porRef.entries()].map(([refId, ps]) => (
              <div key={refId} className="rounded-lg border border-slate-700">
                <div className="flex flex-wrap items-center gap-2 border-b border-slate-700 p-2.5">
                  <b className="text-slate-100">{nombreRef(refId)}</b>
                  <span className="rounded-full bg-violet-500/15 px-2 py-0.5 text-[11px] font-bold text-violet-300">
                    {ps.filter((p) => p.estado === "pendiente").length} propuestas</span>
                </div>
                {(() => {
                  // Descartadas SOLO por el nombre del modelo: una persona puede decir que es el mismo.
                  const porNombre = ps.filter((p) => p.estado === "invalida" && p.causa === "modelo");
                  if (!porNombre.length) return null;
                  const leido = porNombre[0].modelo_leido ?? "?";
                  const ref = filas.find((f) => f.id === refId);
                  return (
                    <div className="flex flex-wrap items-center gap-2 border-b border-slate-700 bg-amber-500/10 p-2.5 text-[12px] text-amber-200">
                      <span>La ficha llama a este modelo <b>«{leido}»</b> y en el catálogo es <b>«{ref?.modelo ?? "?"}»</b>.
                        Si es el mismo neumático, se guarda «{leido}» como otro nombre del modelo y se recuperan sus {porNombre.length} datos
                        (vuelven a comprobarse medida, índice de carga, fuente y valor).</span>
                      <button onClick={() => void esMismoModelo(refId)}
                        className="ml-auto rounded-lg border border-amber-500 px-3 py-1.5 font-bold text-amber-200 hover:bg-amber-500/10">Es el mismo modelo</button>
                    </div>
                  );
                })()}
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[680px] text-[12px]">
                    <thead className="text-slate-400"><tr className="text-left"><th className="p-2" /><th>Campo</th><th>Propuesto</th><th>De dónde sale</th><th>Fuente</th></tr></thead>
                    <tbody>
                      {ps.map((p) => (
                        <tr key={p.id} className="border-t border-slate-800">
                          <td className="p-2">{p.estado === "pendiente" &&
                            <input type="checkbox" checked={marcadas.has(p.id)} onChange={() => setMarcadas((s) => toggle(s, p.id))} />}</td>
                          <td>{etiqueta(p.campo)}</td>
                          <td className={p.estado === "pendiente" ? "font-bold text-emerald-300" : "text-slate-500 line-through"}>{valorBonito(p)}</td>
                          <td>{p.estado === "invalida"
                            ? <span className="text-rose-300">Descartado: {p.motivo}</span>
                            : p.tipo_fuente && <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${FUENTE[p.tipo_fuente].cls}`}>{FUENTE[p.tipo_fuente].t}</span>}</td>
                          <td>{p.url && <a href={p.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sky-300 hover:underline">
                            <ExternalLink size={11} /> {host(p.url)}</a>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
            {!porRef.size && <div className="text-slate-400">No se ha encontrado ningún dato con fuente para estas referencias.</div>}
            <div className="flex flex-wrap items-center gap-2">
              <button onClick={() => setMarcadas(new Set((propuestas ?? []).filter((p) => p.estado === "pendiente" && p.tipo_fuente === "oficial").map((p) => p.id)))}
                className="rounded border border-slate-600 px-3 py-1.5 text-[12px]">Aceptar solo oficiales</button>
              <label className="flex items-center gap-1.5 text-[12px] text-slate-300">
                <input type="checkbox" checked={corregir} onChange={(e) => setCorregir(e.target.checked)} /> Corregir también los que ya tienen dato</label>
              <button onClick={() => { setPropuestas(null); setProgreso(null); }} className="ml-auto rounded border border-slate-600 px-3 py-1.5 text-[12px]">Volver</button>
              <button onClick={() => void guardar()} disabled={guardando || !marcadas.size}
                className="rounded-lg bg-emerald-600 px-4 py-2 text-[13px] font-bold text-white disabled:opacity-40">
                {guardando ? "Guardando…" : `Guardar ${marcadas.size} marcado${marcadas.size === 1 ? "" : "s"}`}</button>
            </div>
          </>
        )}
        {msg && <div className="text-[12px] font-semibold text-emerald-300">{msg}</div>}
      </div>
    </Modal>
  );
}
