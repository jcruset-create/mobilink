/**
 * Panel de «♻ Sustituir» dentro del plan de trabajo del plano.
 *
 * Por cada rueda marcada: a dónde va la vieja (papelera, almacén de usados o
 * reparación) y qué se monta (nueva del almacén del cliente, del catálogo o una
 * usada concreta del almacén de usados). Nada se guarda aquí: lo aplica el plan.
 */
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { listarReferenciasNeumatico, listarUsadosAlmacen, stockAlmacenEmpresa, type StockAlmacenLinea } from "../services/data";
import type { ReferenciaNeumatico, UsadoEnAlmacen } from "../types";
import {
  asignarMontar, DESTINOS_SUSTITUCION, fmtMm, mismaMedidaBase, motivoSugerencia, nuevasQueQuedan,
  siguienteSinMontar, usadaCogidaPor, type DestinoSustitucion, type MontarEnSustitucion, type SustitucionPlan,
} from "../services/sustitucionPlan";
import { inputCls } from "./ui";

export interface RuedaASustituir {
  montajeId: string;
  codigo: string;
  etiqueta: string;     // «Eje 2 izq ext»
  goma: string;         // «Bridgestone COACH 295/80R22.5»
  medida: string | null;
  mm: number | null;
  minimo: number | null;
}

interface Props {
  empresaId: string;
  ruedas: RuedaASustituir[];
  plan: Record<string, SustitucionPlan>;
  onPlan: (p: Record<string, SustitucionPlan>) => void;
  onQuitar: (montajeId: string) => void;
}

const nombreUsada = (u: UsadoEnAlmacen) =>
  `${u.numero_serie || u.numero_interno || "sin nº"} · ${[u.marca, u.modelo].filter(Boolean).join(" ")}`.trim();

export default function PanelSustituirPlan({ empresaId, ruedas, plan, onPlan, onQuitar }: Props) {
  const [activaElegida, setActiva] = useState<string | null>(null);
  const [pestana, setPestana] = useState<"nuevas" | "usadas">("nuevas");
  const [misma, setMisma] = useState(true);
  const [todasMedidas, setTodasMedidas] = useState(false);
  const [stock, setStock] = useState<StockAlmacenLinea[] | null>(null);
  const [usados, setUsados] = useState<UsadoEnAlmacen[] | null>(null);
  const [error, setError] = useState("");
  const [verCatalogo, setVerCatalogo] = useState(false);
  const [refs, setRefs] = useState<ReferenciaNeumatico[] | null>(null);
  const [qCat, setQCat] = useState("");

  useEffect(() => {
    if (!empresaId) return;
    let vivo = true;
    stockAlmacenEmpresa(empresaId).then((s) => { if (vivo) setStock(s); }).catch((e) => { if (vivo) { setStock([]); setError(e?.message ?? "No se pudo leer el stock"); } });
    listarUsadosAlmacen(empresaId).then((u) => { if (vivo) setUsados(u); }).catch(() => { if (vivo) setUsados([]); });
    return () => { vivo = false; };
  }, [empresaId]);

  useEffect(() => {
    if (!verCatalogo || refs) return;
    listarReferenciasNeumatico().then(setRefs).catch(() => setRefs([]));
  }, [verCatalogo, refs]);

  // La rueda activa: la elegida, si sigue en el plan; si no, la primera.
  const activa = activaElegida && plan[activaElegida] ? activaElegida : ruedas[0]?.montajeId ?? null;

  const ruedaActiva = ruedas.find((r) => r.montajeId === activa) ?? null;
  const medidasObjetivo = useMemo(() => {
    const rs = misma && pestana === "nuevas" ? ruedas : ruedaActiva ? [ruedaActiva] : [];
    return rs.map((r) => r.medida).filter(Boolean) as string[];
  }, [misma, pestana, ruedas, ruedaActiva]);
  const encajaMedida = (m?: string | null) =>
    todasMedidas || medidasObjetivo.length === 0 || medidasObjetivo.some((x) => mismaMedidaBase(x, m));

  const nuevas = (stock ?? [])
    .filter((l) => Number(l.nuevo) > 0 && encajaMedida(l.medida))
    .sort((a, b) => Number(b.nuevo) - Number(a.nuevo));
  const usadas = (usados ?? []).filter((u) => encajaMedida(u.medida));
  const refsVisibles = useMemo(() => {
    const q = qCat.trim().toLowerCase();
    return (refs ?? [])
      .filter((r) => encajaMedida(r.tyre_size?.medida))
      .filter((r) => !q || `${r.modelo?.marca?.nombre ?? ""} ${r.modelo?.nombre ?? ""} ${r.tyre_size?.medida ?? ""}`.toLowerCase().includes(q))
      .slice(0, 15);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refs, qCat, medidasObjetivo, todasMedidas]);

  const orden = ruedas.map((r) => r.montajeId);
  const codigoDe = (mid: string) => ruedas.find((r) => r.montajeId === mid)?.codigo ?? "—";

  function elegir(montar: MontarEnSustitucion) {
    const destinos = montar.tipo !== "usado" && misma ? orden : activa ? [activa] : [];
    if (!destinos.length) return;
    const next = asignarMontar(plan, destinos, montar);
    onPlan(next);
    if (montar.tipo === "usado" || !misma) {
      const sig = siguienteSinMontar(orden, next, activa);
      if (sig) setActiva(sig);
    }
  }

  function cambiarDestino(mid: string, destino: DestinoSustitucion) {
    onPlan({ ...plan, [mid]: { ...plan[mid], destino } });
  }

  const btnTab = (k: "nuevas" | "usadas", txt: string, n: number | null) => (
    <button type="button" onClick={() => setPestana(k)}
      className={`rounded-lg px-3 py-1.5 text-[12px] font-bold ${pestana === k ? "bg-slate-700 text-white" : "text-slate-400 hover:text-slate-200"}`}>
      {txt} <span className="tabular-nums text-amber-300">{n ?? "…"}</span>
    </button>
  );

  if (!ruedas.length) {
    return <div className="mt-2 text-[12px] text-sky-200">Toca en el plano las ruedas que se cambian.</div>;
  }

  return (
    <div className="mt-2 grid gap-3 rounded-lg border border-sky-800/60 bg-slate-950/60 p-2.5">
      <div>
        <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-400">1 · Qué se hace con las que salen</div>
        <div className="grid gap-2">
          {ruedas.map((r) => {
            const s = plan[r.montajeId];
            if (!s) return null;
            const on = activa === r.montajeId;
            return (
              <div key={r.montajeId} onClick={() => setActiva(r.montajeId)}
                className={`grid cursor-pointer gap-1.5 rounded-lg border p-2 ${on ? "border-sky-500 bg-sky-500/10" : "border-slate-700 bg-slate-900"}`}>
                <div className="flex flex-wrap items-center justify-between gap-2 text-[12px]">
                  <span className="text-slate-100"><b>{r.etiqueta}</b> · {r.goma}</span>
                  <span className="flex items-center gap-2">
                    <span className={`font-black tabular-nums ${s.destino === "pendiente_reciclaje" ? "text-rose-300" : "text-slate-100"}`}>{r.mm != null ? `${fmtMm(r.mm)} mm` : "sin mm"}</span>
                    <button type="button" onClick={(e) => { e.stopPropagation(); onQuitar(r.montajeId); }} className="text-slate-500 hover:text-white" aria-label="Quitar del plan">✕</button>
                  </span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {(Object.keys(DESTINOS_SUSTITUCION) as DestinoSustitucion[]).map((d) => {
                    const sel = s.destino === d;
                    const color = d === "pendiente_reciclaje" ? "border-rose-400 bg-rose-500/15 text-rose-200"
                      : d === "almacen" ? "border-emerald-500 bg-emerald-500/15 text-emerald-200" : "border-violet-400 bg-violet-500/15 text-violet-200";
                    return (
                      <button key={d} type="button" onClick={(e) => { e.stopPropagation(); cambiarDestino(r.montajeId, d); }}
                        className={`rounded-lg border px-2.5 py-1 text-[11px] font-bold ${sel ? color : "border-slate-600 text-slate-400 hover:text-slate-200"}`}>
                        {DESTINOS_SUSTITUCION[d].icono} {DESTINOS_SUSTITUCION[d].label}
                      </button>
                    );
                  })}
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
                  <span className="text-amber-300">Sugerido: {motivoSugerencia(r.mm, r.minimo)}</span>
                  <span className={s.montar ? "text-emerald-300" : "text-slate-500"}>
                    Entra: {s.montar ? `${s.montar.tipo === "usado" ? "usada" : "nueva"} ${s.montar.nombre}${s.montar.tipo === "usado" && s.montar.mm != null ? ` (${fmtMm(s.montar.mm)} mm)` : ""}` : "falta elegir"}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div>
        <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
          <span className="text-[11px] font-bold uppercase tracking-wide text-slate-400">
            2 · Qué se monta{(pestana === "usadas" || !misma) && ruedaActiva ? ` en ${ruedaActiva.etiqueta}` : misma ? " en todas" : ""}
          </span>
          <div className="flex gap-1">
            {btnTab("nuevas", "Nuevas", stock ? nuevas.reduce((a, l) => a + Number(l.nuevo), 0) : null)}
            {btnTab("usadas", "Usadas", usados ? usadas.length : null)}
          </div>
        </div>

        {pestana === "nuevas" && (
          <div className="grid gap-1.5">
            {stock == null && <div className="text-[12px] text-slate-400">Leyendo el almacén del cliente…</div>}
            {stock != null && nuevas.length === 0 && (
              <div className="rounded-lg border border-dashed border-slate-600 p-2 text-[12px] text-slate-400">
                El cliente no tiene nuevas de {medidasObjetivo[0] ?? "esta medida"} en su almacén. Búscala en el catálogo (se monta sin descontar stock).
              </div>
            )}
            {nuevas.map((l) => {
              const nombre = `${l.marca} ${l.modelo ?? ""}`.replace(/\s+/g, " ").trim();
              const elegida = Object.values(plan).some((s) => s.montar?.tipo === "nuevo" && s.montar.productoId === l.producto_id);
              const quedan = nuevasQueQuedan(Number(l.nuevo), plan, l.producto_id);
              return (
                <button key={l.producto_id} type="button" disabled={quedan <= 0 && !elegida}
                  onClick={() => elegir({ tipo: "nuevo", productoId: l.producto_id, nombre })}
                  className={`flex flex-wrap items-center justify-between gap-2 rounded-lg border px-2.5 py-2 text-left text-[12px] disabled:opacity-40 ${elegida ? "border-emerald-500 bg-emerald-500/10" : "border-slate-700 hover:border-slate-500"}`}>
                  <span className="text-slate-100">{nombre} · {l.medida}</span>
                  <span className="font-black tabular-nums text-slate-100">
                    {Number(l.nuevo)} uds{elegida ? <span className="ml-1 font-semibold text-emerald-300">→ quedarán {quedan}</span> : null}
                  </span>
                </button>
              );
            })}
            <button type="button" onClick={() => setVerCatalogo((v) => !v)} className="justify-self-start text-[11px] font-bold text-sky-300 hover:underline">
              {verCatalogo ? "▾" : "▸"} Buscar otra en el catálogo (sin stock: se monta sin descontar)
            </button>
            {verCatalogo && (
              <div className="grid gap-1.5">
                <input className={`${inputCls} text-base sm:text-[12px]`} placeholder="Marca, modelo o medida…" value={qCat} onChange={(e) => setQCat(e.target.value)} />
                {refs == null && <div className="text-[12px] text-slate-400">Leyendo el catálogo…</div>}
                {refs != null && refsVisibles.length === 0 && <div className="text-[12px] text-slate-400">Nada en el catálogo con esa búsqueda.</div>}
                {refsVisibles.map((r) => {
                  const nombre = `${r.modelo?.marca?.nombre ?? ""} ${r.modelo?.nombre ?? ""}`.replace(/\s+/g, " ").trim();
                  const elegida = Object.values(plan).some((s) => s.montar?.tipo === "catalogo" && s.montar.referenciaId === r.id);
                  return (
                    <button key={r.id} type="button" onClick={() => elegir({ tipo: "catalogo", referenciaId: r.id, nombre })}
                      className={`flex flex-wrap items-center justify-between gap-2 rounded-lg border px-2.5 py-1.5 text-left text-[12px] ${elegida ? "border-emerald-500 bg-emerald-500/10" : "border-slate-700 hover:border-slate-500"}`}>
                      <span className="text-slate-100">{nombre} · {r.tyre_size?.medida ?? "—"}</span>
                      <span className="text-[11px] text-slate-500">catálogo</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {pestana === "usadas" && (
          <div className="grid gap-1.5">
            {usados == null && <div className="text-[12px] text-slate-400">Leyendo el almacén de usados…</div>}
            {usados != null && usadas.length === 0 && (
              <div className="rounded-lg border border-dashed border-slate-600 p-2 text-[12px] text-slate-400">
                No hay usadas de {medidasObjetivo[0] ?? "esta medida"} en el almacén. Si hay gomas esperando en «Pendientes de clasificar», pásalas antes al almacén en{" "}
                <Link to="/tyrecontrol/almacen-usados" className="font-bold text-sky-300 hover:underline">Almacén de usados</Link>.
              </div>
            )}
            {usadas.map((u) => {
              const cogida = usadaCogidaPor(plan, u.neumatico_id);
              const aqui = cogida === activa;
              const mm = u.profundidad_actual_mm != null ? Number(u.profundidad_actual_mm) : null;
              return (
                <button key={u.neumatico_id} type="button" disabled={!!cogida && !aqui}
                  onClick={() => elegir({ tipo: "usado", neumaticoId: u.neumatico_id, nombre: nombreUsada(u), mm })}
                  className={`flex flex-wrap items-center justify-between gap-2 rounded-lg border px-2.5 py-2 text-left text-[12px] disabled:opacity-50 ${aqui ? "border-emerald-500 bg-emerald-500/10" : "border-slate-700 hover:border-slate-500"}`}>
                  <span className="text-slate-100">
                    <span className="font-mono text-[11px]">{nombreUsada(u)}</span> · {u.medida ?? "—"}
                    {u.estado === "reservado" && <span className="ml-1 text-amber-300">· reservada</span>}
                    {u.reesculturado && <span className="ml-1 text-violet-300">· reesculturada</span>}
                    {u.matricula_anterior && <span className="ml-1 text-slate-500">· venía de {u.matricula_anterior}</span>}
                    {cogida && !aqui && <span className="ml-1 text-sky-300">· ya va en {codigoDe(cogida)}</span>}
                  </span>
                  <span className="font-black tabular-nums text-slate-100">{mm != null ? `${fmtMm(mm)} mm` : "sin mm"}</span>
                </button>
              );
            })}
          </div>
        )}

        <div className="mt-2 flex flex-col gap-1 text-[11px] text-slate-400">
          {pestana === "nuevas" && ruedas.length > 1 && (
            <label className="flex items-center gap-2"><input type="checkbox" checked={misma} onChange={(e) => setMisma(e.target.checked)} /> La misma para todas las ruedas</label>
          )}
          <label className="flex items-center gap-2"><input type="checkbox" checked={todasMedidas} onChange={(e) => setTodasMedidas(e.target.checked)} /> Ver todas las medidas</label>
          {error && <span className="text-rose-300">{error}</span>}
        </div>
      </div>
    </div>
  );
}
