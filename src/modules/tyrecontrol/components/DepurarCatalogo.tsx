/**
 * «🧹 Depurar catálogo»: que las gomas de flota encajen con una referencia del
 * catálogo (equivalencias), quitar marcas y modelos vacíos y aclarar parecidos.
 * Nunca cambia una goma: guarda «así escrito en flota → esta referencia».
 */
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Modal, inputCls } from "./ui";
import BuscadorIACatalogo from "./BuscadorIACatalogo";
import type { Diagnostico, GrupoSinReferencia, TipoSugerencia } from "../services/depurarCatalogo";
import {
  cambiarActivoCatalogo, diagnosticoCatalogo, guardarEquivalencias, marcarDistintos, quitarEquivalencias,
} from "../services/depurarCatalogoApi";

type Pestana = "sin" | "sobra" | "parecidos" | "incompletas";
const TIPO: Record<TipoSugerencia, { t: string; cls: string }> = {
  auto: { t: "Automática", cls: "bg-emerald-500/15 text-emerald-300" },
  parecido: { t: "Parecido", cls: "bg-sky-500/15 text-sky-300" },
  sin_medida: { t: "Falta la medida", cls: "bg-amber-500/15 text-amber-300" },
  sin_modelo: { t: "Falta el modelo", cls: "bg-rose-500/15 text-rose-300" },
  sin_marca: { t: "Falta la marca", cls: "bg-rose-500/15 text-rose-300" },
};
const n = (x: number) => x.toLocaleString("es-ES");
const btn = "rounded-lg border border-slate-600 px-2.5 py-1 text-xs font-semibold text-slate-200 hover:bg-slate-700 disabled:opacity-40";

export default function DepurarCatalogo({ onClose, onCambio }: { onClose: () => void; onCambio: () => void }) {
  const [d, setD] = useState<Diagnostico | null>(null);
  const [error, setError] = useState("");
  const [pestana, setPestana] = useState<Pestana>("sin");
  const [msg, setMsg] = useState("");
  const [ocupado, setOcupado] = useState(false);
  // Pestaña «sin referencia».
  const [tipo, setTipo] = useState<"" | TipoSugerencia>("");
  const [marca, setMarca] = useState("");
  const [elegida, setElegida] = useState<Record<string, string>>({});
  const [marcadas, setMarcadas] = useState<Set<string>>(new Set());
  const [alta, setAlta] = useState<{ marca: string; medida: string } | null>(null);
  // Pestaña «sobra».
  const [selMarcas, setSelMarcas] = useState<Set<string>>(new Set());
  const [selModelos, setSelModelos] = useState<Set<string>>(new Set());

  async function cargar() {
    setError("");
    try {
      setD(await diagnosticoCatalogo());
      setMarcadas(new Set()); setElegida({}); setSelMarcas(new Set()); setSelModelos(new Set());
    } catch (e) { setError(e instanceof Error ? e.message : "Error"); }
  }
  useEffect(() => {
    let vivo = true;
    diagnosticoCatalogo()
      .then((r) => { if (vivo) setD(r); })
      .catch((e) => { if (vivo) setError(e instanceof Error ? e.message : "Error"); });
    return () => { vivo = false; };
  }, []);

  async function hacer(accion: () => Promise<string>) {
    setOcupado(true); setMsg("");
    try { setMsg(await accion()); onCambio(); await cargar(); }
    catch (e) { setMsg(e instanceof Error ? e.message : "Error"); }
    finally { setOcupado(false); }
  }

  const refDe = (g: GrupoSinReferencia) => elegida[g.clave] ?? g.referenciaId ?? "";
  const grupos = useMemo(() => {
    const m = marca.trim().toUpperCase();
    return (d?.sinReferencia ?? []).filter((g) => (!tipo || g.tipo === tipo) && (!m || g.marca.toUpperCase().includes(m)));
  }, [d, tipo, marca]);
  const aGuardar = (d?.sinReferencia ?? []).filter((g) => marcadas.has(g.clave) && refDe(g));
  const gomasAGuardar = aGuardar.reduce((s, g) => s + g.gomas, 0);

  const marcarAutomaticas = () =>
    setMarcadas(new Set((d?.sinReferencia ?? []).filter((g) => g.tipo === "auto").map((g) => g.clave)));
  const alternar = (set: Set<string>, id: string) => { const x = new Set(set); if (x.has(id)) x.delete(id); else x.add(id); return x; };

  const guardar = () => hacer(async () => {
    const r = await guardarEquivalencias(aGuardar.map((g) => ({ marca: g.marca, modelo: g.modelo, medida: g.medida, referenciaId: refDe(g) })));
    return `✔ ${n(r.guardadas)} equivalencias guardadas · ${n(gomasAGuardar)} gomas ya encajan con su referencia.`;
  });

  const r = d?.resumen;
  const pct = r && r.gomas ? Math.round((r.encajan / r.gomas) * 100) : 0;

  return (
    <Modal title="🧹 Depurar catálogo" size="xl" onClose={onClose}>
      {error && <div className="mb-3 rounded-lg border border-rose-600/40 bg-rose-600/10 px-3 py-2 text-xs text-rose-300">{error}</div>}
      {!d && !error && <p className="text-sm text-slate-400">Comparando la flota con el catálogo…</p>}
      {d && r && (
        <div className="grid gap-3">
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <Kpi l="Gomas activas en flota" v={n(r.gomas)} />
            <Kpi l="Encajan con una referencia" v={`${n(r.encajan)} · ${pct}%`} cls="text-emerald-300"
              nota={r.porEquivalencia ? `${n(r.porEquivalencia)} por equivalencia` : undefined} />
            <Kpi l="Encajarían con las automáticas" v={`+${n(r.gomasAutomaticas)}`} cls="text-sky-300" nota={`${n(r.automaticas)} combinaciones`} />
            <Kpi l="Modelos que faltan en catálogo" v={n(r.modelosQueFaltan)} cls="text-rose-300" />
          </div>

          <div className="flex flex-wrap gap-1 border-b border-slate-700 pb-2">
            {([
              ["sin", "Gomas sin referencia", d.sinReferencia.length],
              ["sobra", "Sobra en el catálogo", d.sobrante.marcas.length + d.sobrante.modelos.length],
              ["parecidos", "Parecidos", d.parecidos.length],
              ["incompletas", "Gomas sin marca, modelo o medida", d.incompletas.length],
            ] as [Pestana, string, number][]).map(([k, t, c]) => (
              <button key={k} onClick={() => { setPestana(k); setMsg(""); }}
                className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${pestana === k ? "bg-slate-700 text-white" : "text-slate-400 hover:text-slate-200"}`}>
                {t} <span className="ml-1 tabular-nums text-amber-300">{n(c)}</span>
              </button>
            ))}
          </div>

          {msg && <div className="rounded-lg border border-emerald-600/40 bg-emerald-600/10 px-3 py-2 text-xs text-emerald-300">{msg}</div>}

          {pestana === "sin" && (
            <div className="grid gap-3">
              {r.automaticas > 0 && (
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-emerald-600/40 bg-emerald-600/10 px-3 py-2 text-xs text-emerald-200">
                  <span><b>Automáticas:</b> el nombre en flota es el del catálogo con el índice pegado («AH51 154M» → AH51) o escrito de otra forma. {n(r.automaticas)} combinaciones, {n(r.gomasAutomaticas)} gomas.</span>
                  <button onClick={marcarAutomaticas} className="rounded-lg bg-emerald-600 px-3 py-1.5 font-bold text-white hover:bg-emerald-500">Marcar las automáticas</button>
                </div>
              )}
              <div className="flex flex-wrap items-end gap-2">
                <label className="text-xs text-slate-400">Tipo
                  <select value={tipo} onChange={(e) => setTipo(e.target.value as "" | TipoSugerencia)} className={`${inputCls} mt-1 block`}>
                    <option value="">Todas</option>
                    {(Object.keys(TIPO) as TipoSugerencia[]).map((k) => <option key={k} value={k}>{TIPO[k].t}</option>)}
                  </select>
                </label>
                <label className="text-xs text-slate-400">Marca
                  <input value={marca} onChange={(e) => setMarca(e.target.value)} placeholder="Hankook…" className={`${inputCls} mt-1 block`} />
                </label>
                <span className="ml-auto text-xs text-slate-400">{n(grupos.length)} combinaciones · {n(grupos.reduce((s, g) => s + g.gomas, 0))} gomas</span>
              </div>

              <div className="overflow-x-auto rounded-lg border border-slate-700">
                <table className="w-full min-w-[900px] text-xs">
                  <thead className="bg-slate-900/60 text-[10px] uppercase tracking-wide text-slate-400">
                    <tr><th className="p-2" /><th className="p-2 text-left">Cómo está escrito en flota</th><th className="p-2 text-right">Gomas</th><th className="p-2 text-left">Qué es</th><th className="p-2 text-left">Referencia del catálogo</th><th className="p-2" /></tr>
                  </thead>
                  <tbody>
                    {grupos.map((g) => {
                      const ref = refDe(g);
                      return (
                        <tr key={g.clave} className="border-t border-slate-700/60">
                          <td className="p-2"><input type="checkbox" disabled={!ref} checked={marcadas.has(g.clave)} onChange={() => setMarcadas((s) => alternar(s, g.clave))} /></td>
                          <td className="p-2 font-mono text-slate-200">{g.marca} · {g.modelo} · {g.medida}</td>
                          <td className="p-2 text-right font-bold tabular-nums">{n(g.gomas)}</td>
                          <td className="p-2"><span className={`rounded-full px-2 py-0.5 font-semibold ${TIPO[g.tipo].cls}`}>{TIPO[g.tipo].t}</span>
                            <div className="mt-1 text-[11px] text-slate-400">{g.motivo}</div></td>
                          <td className="p-2">
                            <select value={ref} onChange={(e) => { const v = e.target.value; setElegida((x) => ({ ...x, [g.clave]: v })); setMarcadas((s) => { const z = new Set(s); if (v) z.add(g.clave); else z.delete(g.clave); return z; }); }}
                              className={`${inputCls} w-full max-w-[340px]`}>
                              <option value="">— Elegir referencia —</option>
                              {g.opciones.map((o) => <option key={o.referenciaId} value={o.referenciaId}>{o.texto}</option>)}
                            </select>
                            {g.opciones.length === 0 && <div className="mt-1 text-[11px] text-slate-500">No hay ninguna referencia en {g.medida}</div>}
                          </td>
                          <td className="p-2 text-right">
                            {(g.tipo === "sin_modelo" || g.tipo === "sin_medida" || g.tipo === "sin_marca") && (
                              <button onClick={() => setAlta({ marca: g.marcaCatalogo ?? g.marca, medida: g.medida })}
                                className="whitespace-nowrap rounded-lg border border-violet-500 px-2.5 py-1 text-xs font-semibold text-violet-200 hover:bg-violet-600/20">✨ Dar de alta con IA</button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                    {grupos.length === 0 && <tr><td colSpan={6} className="p-4 text-center text-slate-400">Nada pendiente con este filtro.</td></tr>}
                  </tbody>
                </table>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs text-slate-400">Las gomas no se tocan: se guarda «así escrito en flota → esta referencia». Se puede deshacer.</span>
                <button disabled={!aGuardar.length || ocupado} onClick={() => void guardar()}
                  className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-500 disabled:opacity-40">
                  {ocupado ? "Guardando…" : `Guardar ${n(aGuardar.length)} equivalencias (${n(gomasAGuardar)} gomas)`}
                </button>
              </div>

              {d.equivalencias.length > 0 && (
                <details className="rounded-lg border border-slate-700 p-3">
                  <summary className="cursor-pointer text-xs font-semibold text-slate-300">Equivalencias guardadas ({n(d.equivalencias.length)})</summary>
                  <table className="mt-2 w-full text-xs">
                    <tbody>
                      {d.equivalencias.map((e) => (
                        <tr key={e.id} className="border-t border-slate-700/60">
                          <td className="p-1.5 font-mono text-slate-300">{e.marca} · {e.modelo} · {e.medida}</td>
                          <td className="p-1.5 text-slate-400">→ {e.texto}</td>
                          <td className="p-1.5 text-right tabular-nums">{n(e.gomas)} gomas</td>
                          <td className="p-1.5 text-right"><button disabled={ocupado} className={btn}
                            onClick={() => void hacer(async () => { await quitarEquivalencias([e.id]); return "✔ Equivalencia deshecha."; })}>Deshacer</button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </details>
              )}
            </div>
          )}

          {pestana === "sobra" && (
            <div className="grid gap-3">
              <p className="text-xs text-slate-400">Marcas sin ningún modelo y modelos sin ninguna referencia, que además no tienen gomas en flota. Se <b>desactivan</b> (dejan de salir en los desplegables); no se borra nada y se pueden reactivar abajo.</p>
              <div className="grid gap-3 md:grid-cols-2">
                <Lista titulo={`Marcas vacías (${d.sobrante.marcas.length})`} items={d.sobrante.marcas.map((m) => ({ id: m.id, t: m.nombre }))}
                  sel={selMarcas} onSel={(id) => setSelMarcas((s) => alternar(s, id))} onTodas={(v) => setSelMarcas(new Set(v ? d.sobrante.marcas.map((m) => m.id) : []))} />
                <Lista titulo={`Modelos sin referencias (${d.sobrante.modelos.length})`} items={d.sobrante.modelos.map((m) => ({ id: m.id, t: `${m.marca} · ${m.nombre}` }))}
                  sel={selModelos} onSel={(id) => setSelModelos((s) => alternar(s, id))} onTodas={(v) => setSelModelos(new Set(v ? d.sobrante.modelos.map((m) => m.id) : []))} />
              </div>
              <div className="flex justify-end">
                <button disabled={ocupado || (!selMarcas.size && !selModelos.size)}
                  onClick={() => void hacer(async () => {
                    const x = await cambiarActivoCatalogo({ marcas: [...selMarcas], modelos: [...selModelos], activo: false });
                    return `✔ Desactivadas ${x.marcas} marcas y ${x.modelos} modelos${x.saltadas ? ` · ${x.saltadas} saltados porque ya no están vacíos` : ""}.`;
                  })}
                  className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-bold text-white hover:bg-amber-500 disabled:opacity-40">
                  Desactivar {selMarcas.size + selModelos.size} marcados
                </button>
              </div>
              <details className="rounded-lg border border-slate-700 p-3">
                <summary className="cursor-pointer text-xs font-semibold text-slate-300">Referencias sin ninguna goma en flota ({d.sobrante.refsSinGomas.length}) — solo informativo</summary>
                <p className="mt-2 text-[11px] text-slate-400">No se desactivan: pueden servir para compras futuras.</p>
                <ul className="mt-1 columns-1 text-xs text-slate-300 md:columns-2">{d.sobrante.refsSinGomas.map((x) => <li key={x.id}>{x.texto}</li>)}</ul>
              </details>
              {(d.desactivadas.marcas.length > 0 || d.desactivadas.modelos.length > 0) && (
                <details className="rounded-lg border border-slate-700 p-3">
                  <summary className="cursor-pointer text-xs font-semibold text-slate-300">Desactivadas ({d.desactivadas.marcas.length + d.desactivadas.modelos.length})</summary>
                  <ul className="mt-2 grid gap-1 text-xs">
                    {[...d.desactivadas.marcas.map((m) => ({ id: m.id, t: `Marca · ${m.nombre}`, marca: true })),
                      ...d.desactivadas.modelos.map((m) => ({ id: m.id, t: `Modelo · ${m.marca} ${m.nombre}`, marca: false }))].map((x) => (
                      <li key={x.id} className="flex items-center justify-between gap-2 border-t border-slate-700/60 pt-1">
                        <span className="text-slate-300">{x.t}</span>
                        <button disabled={ocupado} className={btn} onClick={() => void hacer(async () => {
                          await cambiarActivoCatalogo({ marcas: x.marca ? [x.id] : [], modelos: x.marca ? [] : [x.id], activo: true });
                          return "✔ Reactivado.";
                        })}>Reactivar</button>
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
          )}

          {pestana === "parecidos" && (
            <div className="grid gap-2">
              <p className="text-xs text-slate-400">Nombres que solo se diferencian en espacios, guiones o «+», y medidas con la misma medida base. Casi siempre son productos distintos (HD3 y HD3+): márcalos «Son distintos» y no vuelven a salir.</p>
              {d.parecidos.length === 0 && <p className="text-sm text-slate-400">No queda ningún parecido por revisar.</p>}
              {d.parecidos.map((p) => (
                <div key={`${p.tipo}${p.a.id}${p.b.id}`} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-700 px-3 py-2 text-sm">
                  <span><span className="mr-2 text-[10px] uppercase text-slate-500">{p.tipo === "modelo" ? `Modelo${p.marca ? ` · ${p.marca}` : ""}` : "Medida"}</span>
                    <b>{p.a.nombre}</b>{p.tipo === "modelo" && <span className="text-slate-500"> ({p.a.refs} ref.)</span>}
                    <span className="mx-2 text-slate-500">y</span>
                    <b>{p.b.nombre}</b>{p.tipo === "modelo" && <span className="text-slate-500"> ({p.b.refs} ref.)</span>}</span>
                  <span className="flex flex-wrap gap-1">
                    <button disabled={ocupado} className={btn} onClick={() => void hacer(async () => { await marcarDistintos(p.tipo, p.a.id, p.b.id); return "✔ Marcados como distintos."; })}>Son distintos</button>
                    {p.tipo === "modelo" && [p.a, p.b].filter((x) => x.refs === 0).map((x) => (
                      <button key={x.id} disabled={ocupado} className={btn} onClick={() => void hacer(async () => {
                        await cambiarActivoCatalogo({ marcas: [], modelos: [x.id], activo: false }); return `✔ «${x.nombre}» desactivado.`;
                      })}>Desactivar «{x.nombre}»</button>
                    ))}
                  </span>
                </div>
              ))}
            </div>
          )}

          {pestana === "incompletas" && (
            <div className="grid gap-2">
              <p className="text-xs text-slate-400">A estas gomas les falta la marca, el modelo o la medida. Aquí no se cambian las gomas: ábrelas y corrígelas desde su ficha.</p>
              <div className="overflow-x-auto rounded-lg border border-slate-700">
                <table className="w-full min-w-[760px] text-xs">
                  <thead className="bg-slate-900/60 text-[10px] uppercase tracking-wide text-slate-400">
                    <tr><th className="p-2 text-left">Goma</th><th className="p-2 text-left">Vehículo</th><th className="p-2 text-left">Empresa</th><th className="p-2 text-left">Marca</th><th className="p-2 text-left">Modelo</th><th className="p-2 text-left">Medida</th></tr>
                  </thead>
                  <tbody>
                    {d.incompletas.map((g) => (
                      <tr key={g.id} className="border-t border-slate-700/60">
                        <td className="p-2"><Link to={`/tyrecontrol/neumaticos/${g.id}`} className="text-sky-300 hover:underline">{g.codigo || "Ficha"}</Link></td>
                        <td className="p-2">{g.matricula ?? "—"}</td>
                        <td className="p-2 text-slate-400">{g.empresa ?? "—"}</td>
                        <td className={`p-2 ${g.marca?.trim() ? "" : "text-rose-300"}`}>{g.marca?.trim() || "falta"}</td>
                        <td className={`p-2 ${g.modelo?.trim() ? "" : "text-rose-300"}`}>{g.modelo?.trim() || "falta"}</td>
                        <td className={`p-2 ${g.medida?.trim() ? "" : "text-rose-300"}`}>{g.medida?.trim() || "falta"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {alta && (
        <BuscadorIACatalogo inicial={alta} onClose={() => { setAlta(null); void cargar(); }} onCreado={() => { onCambio(); void cargar(); }} />
      )}
    </Modal>
  );
}

function Kpi({ l, v, cls = "", nota }: { l: string; v: string; cls?: string; nota?: string }) {
  return (
    <div className="rounded-lg border border-slate-700 bg-slate-900/40 px-3 py-2">
      <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{l}</div>
      <div className={`text-xl font-extrabold tabular-nums ${cls}`}>{v}</div>
      {nota && <div className="text-[11px] text-slate-500">{nota}</div>}
    </div>
  );
}

function Lista({ titulo, items, sel, onSel, onTodas }: {
  titulo: string; items: { id: string; t: string }[]; sel: Set<string>; onSel: (id: string) => void; onTodas: (v: boolean) => void;
}) {
  return (
    <div className="rounded-lg border border-slate-700 p-3">
      <div className="mb-2 flex items-center justify-between text-xs font-semibold text-slate-300">
        <span>{titulo}</span>
        {items.length > 0 && <label className="flex items-center gap-1 font-normal text-slate-400">
          <input type="checkbox" checked={items.every((i) => sel.has(i.id))} onChange={(e) => onTodas(e.target.checked)} /> Todos</label>}
      </div>
      {items.length === 0 ? <p className="text-xs text-slate-500">Nada que quitar.</p> : (
        <ul className="grid max-h-72 gap-1 overflow-y-auto text-xs">
          {items.map((i) => (
            <li key={i.id}><label className="flex items-center gap-2 text-slate-200">
              <input type="checkbox" checked={sel.has(i.id)} onChange={() => onSel(i.id)} /> {i.t}</label></li>
          ))}
        </ul>
      )}
    </div>
  );
}
