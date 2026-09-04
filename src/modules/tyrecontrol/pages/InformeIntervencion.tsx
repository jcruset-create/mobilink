import { useEffect, useMemo, useState } from "react";
import { useParams, Link } from "react-router-dom";
import {
  obtenerIntervencion, listarOperaciones, listarCatOperaciones, estadoIntervencion,
  listarMovimientosOperacion, listarHistorialEstados, listarAuditoriaOperacion, listarAdjuntosOperacion,
  enlaceParteInterventionPdf,
} from "../services/data";
import type { Intervencion, EstadoHistorialEntry, AuditoriaEntry } from "../services/data";
import type { OperacionNeumatico, OperacionMovimiento, OperacionAdjunto, CatDestino } from "../types";
import { TIPO_OPERACION_LABELS, MOTIVO_OPERACION_LABELS, ESTADO_OPERACION_LABELS } from "../types";
import PlanoSnapshot from "../components/PlanoSnapshot";
import { TableWrap, tdCls, thCls } from "../components/ui";

/**
 * El INFORME de una intervención (fase 6 del rediseño). Tres niveles, una
 * sola fuente de datos: RÁPIDO (una vista, para dirección/cliente),
 * COMPLETO (responsable de flota) y TRAZABILIDAD (ids, tiempos,
 * movimientos, historial y auditoría).
 *
 * Regla innegociable: los hechos —operaciones, cantidades, destinos,
 * stock— salen de datos estructurados; la única prosa de IA es el
 * resumen_ia ya guardado al cierre, que REDACTA lo que las operaciones
 * dicen, nunca decide. Las tablas de stock vienen del snapshot capturado
 * al cerrar (fase 5): son el stock DE ENTONCES.
 */
type Nivel = "rapido" | "completo" | "trazabilidad";

const ESTADOS_ACTIVOS = new Set(["borrador", "pendiente", "planificada", "asignada", "en_proceso", "pausada"]);
const ORIGEN_SIN_CONTROL = new Set(["montaje_directo_cliente", "catalogo_sin_stock"]);

function fmtDur(seg?: number | null): string {
  if (seg == null) return "—";
  const h = Math.floor(seg / 3600), m = Math.round((seg % 3600) / 60);
  return h > 0 ? `${h} h ${m} min` : `${m} min`;
}
const fmtHora = (ts?: string | null) =>
  ts ? new Date(ts).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" }) : "—";

export default function InformeIntervencion() {
  const { id } = useParams<{ id: string }>();
  const [nivel, setNivel] = useState<Nivel>("completo");
  const [interv, setInterv] = useState<Intervencion | null>(null);
  const [ops, setOps] = useState<OperacionNeumatico[]>([]);
  const [destinos, setDestinos] = useState<CatDestino[]>([]);
  const [msg, setMsg] = useState("");
  const [loading, setLoading] = useState(true);
  const [pdf, setPdf] = useState(false);

  // Cargas perezosas por nivel (mismos datos, más profundidad).
  const [adjuntos, setAdjuntos] = useState<Map<string, OperacionAdjunto[]> | null>(null);
  const [traza, setTraza] = useState<Map<string, { mov: OperacionMovimiento[]; hist: EstadoHistorialEntry[]; aud: AuditoriaEntry[]; error?: string }> | null>(null);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    Promise.all([
      obtenerIntervencion(id),
      listarOperaciones({ intervencionId: id }),
      listarCatOperaciones().catch(() => null),
    ]).then(([iv, o, cat]) => {
      setInterv(iv);
      setOps([...o].sort((a, b) => String(a.created_at ?? "").localeCompare(String(b.created_at ?? ""))));
      if (cat) setDestinos(cat.destinos);
      if (!iv) setMsg("Intervención no encontrada (o sin permiso para verla).");
    }).catch((e: any) => setMsg(e?.message || "Error cargando el informe"))
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => {
    if (nivel === "rapido" || adjuntos !== null || ops.length === 0) return;
    Promise.allSettled(ops.map((o) => listarAdjuntosOperacion(o.id).then((a) => [o.id, a] as const)))
      .then((rs) => {
        const m = new Map<string, OperacionAdjunto[]>();
        for (const r of rs) if (r.status === "fulfilled" && r.value[1].length) m.set(r.value[0], r.value[1]);
        setAdjuntos(m);
      });
  }, [nivel, ops, adjuntos]);

  useEffect(() => {
    if (nivel !== "trazabilidad" || traza !== null || ops.length === 0) return;
    Promise.all(ops.map(async (o) => {
      const [mov, hist, aud] = await Promise.allSettled([
        listarMovimientosOperacion(o.id), listarHistorialEstados(o.id), listarAuditoriaOperacion(o.id),
      ]);
      const val = <T,>(r: PromiseSettledResult<T[]>): T[] => (r.status === "fulfilled" ? r.value : []);
      const err = [mov, hist, aud].find((r) => r.status === "rejected") as PromiseRejectedResult | undefined;
      return [o.id, { mov: val(mov), hist: val(hist), aud: val(aud), error: err ? ((err.reason as any)?.message || "carga incompleta") : undefined }] as const;
    })).then((entries) => setTraza(new Map(entries)));
  }, [nivel, ops, traza]);

  // ── Hechos derivados (deterministas, de las operaciones) ──────────────────
  const hechos = useMemo(() => {
    const activas = ops.filter((o) => !o.is_anulada && o.status === "completada");
    const montadosAlmacen = activas.filter((o) =>
      (o.tipo_operacion === "montaje" || o.tipo_operacion === "sustitucion") && o.estado_anterior === "almacen");
    const esUsado = (o: OperacionNeumatico) => (o.observaciones ?? "").includes("[USADO]");
    const sinControl = activas.filter((o) =>
      (o.tipo_operacion === "montaje" || o.tipo_operacion === "sustitucion")
      && o.estado_anterior !== "almacen" && o.estado_anterior !== "montado"
      && ORIGEN_SIN_CONTROL.has(o.neumatico?.origen ?? ""));
    const retirados = activas.filter((o) =>
      (o.tipo_operacion === "desmontaje" || o.tipo_operacion === "sustitucion") && o.estado_anterior === "montado");
    const pendientes = ops.filter((o) => !o.is_anulada && ESTADOS_ACTIVOS.has(o.status ?? ""));
    return {
      activas,
      montadosAlmacen,
      montadosNuevos: montadosAlmacen.filter((o) => !esUsado(o)),
      montadosUsados: montadosAlmacen.filter(esUsado),
      sinControl,
      retirados,
      recuperados: retirados.filter((o) => o.destino === "almacen"),
      reparados: activas.filter((o) => o.tipo_operacion === "reparacion"),
      movidos: activas.filter((o) => o.tipo_operacion === "cambio_posicion" || o.tipo_operacion === "intercambio"),
      anuladas: ops.filter((o) => o.is_anulada),
      pendientes,
      km: ops.reduce<number | null>((acc, o) => (o.km_vehiculo != null && (acc == null || o.km_vehiculo > acc) ? o.km_vehiculo : acc), null),
      esUsado,
    };
  }, [ops]);

  const destinoLabel = (codigo?: string | null) => {
    if (!codigo) return "—";
    return destinos.find((d) => d.codigo === codigo)?.nombre
      ?? ({ vehiculo: "Vehículo", almacen: "Almacén (usado)", reparacion: "Reparación", descarte: "Descarte", reciclaje: "Reciclaje" } as Record<string, string>)[codigo]
      ?? codigo;
  };

  const origenMontado = (o: OperacionNeumatico) => {
    if (o.estado_anterior === "almacen") return hechos.esUsado(o) ? "Almacén del cliente (usado)" : "Almacén del cliente (nuevo)";
    if (ORIGEN_SIN_CONTROL.has(o.neumatico?.origen ?? "")) return "SIN CONTROL DE STOCK";
    return "Ya existente";
  };

  if (loading) return <div className="text-sm text-slate-500">Cargando informe…</div>;
  if (!interv) return <div className="text-sm text-red-300">{msg || "Intervención no encontrada."}</div>;

  const est = estadoIntervencion(interv);
  const snap = interv.stock_snapshot;

  const Chip = ({ n, label, tone = "text-slate-200" }: { n: number; label: string; tone?: string }) =>
    n > 0 ? (
      <div className="rounded-lg bg-slate-800 px-3 py-2 text-center">
        <div className={`text-xl font-black ${tone}`}>{n}</div>
        <div className="text-[10px] uppercase tracking-wide text-slate-400">{label}</div>
      </div>
    ) : null;

  return (
    <div className="mx-auto max-w-4xl">
      {/* Controles (fuera del papel al imprimir) */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 print:hidden">
        <Link to="/tyrecontrol/intervenciones" className="text-xs text-sky-300 hover:underline">← Intervenciones</Link>
        <div className="flex gap-1">
          {(["rapido", "completo", "trazabilidad"] as Nivel[]).map((v) => (
            <button key={v} onClick={() => setNivel(v)}
              className={`rounded-lg px-3 py-1.5 text-xs font-bold ${nivel === v ? "bg-sky-600 text-white" : "border border-slate-600 text-slate-300 hover:bg-slate-700"}`}>
              {v === "rapido" ? "Rápido" : v === "completo" ? "Completo" : "Trazabilidad"}
            </button>
          ))}
          <button onClick={() => window.print()} className="rounded-lg border border-slate-600 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-slate-700">Imprimir</button>
          {/*
            El parte en la plantilla Conti360, que es el papel que se le da al
            cliente. "Imprimir" saca ESTA pantalla, que es otra cosa: un
            informe interno con trazabilidad. Hasta ahora el PDF solo se podía
            sacar desde la tablet, y desde la oficina no había manera.
          */}
          <button
            onClick={async () => {
              setPdf(true); setMsg("");
              try {
                // Se abre en una pestaña, no se descarga: lo normal es mirarlo
                // y decidir, y una descarga deja un fichero suelto por medio.
                window.open(await enlaceParteInterventionPdf(id!), "_blank", "noopener");
              } catch (e: any) {
                setMsg(e?.message || "No se ha podido generar el PDF");
              } finally { setPdf(false); }
            }}
            disabled={pdf}
            className="rounded-lg border border-slate-600 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-slate-700 disabled:opacity-50">
            {pdf ? "Generando…" : "Parte en PDF"}
          </button>
        </div>
      </div>
      {msg && <div className="mb-3 text-sm text-red-300">{msg}</div>}

      {/* ── Cabecera ── */}
      <div className="rounded-lg bg-slate-800 p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h1 className="text-lg font-black text-slate-100">
            Parte de trabajo <span className="font-mono text-sky-300">{interv.numero ?? "(sin nº)"}</span>
          </h1>
          <span className="text-xs font-semibold uppercase text-slate-400">
            {est === "cerrada" ? "Cerrada" : est === "en_curso" ? "En curso" : "Planificada"}
          </span>
        </div>
        <div className="mt-2 grid gap-x-6 gap-y-1 text-sm text-slate-300 sm:grid-cols-2">
          <div><span className="text-slate-500">Cliente:</span> {interv.empresa?.nombre ?? "—"}</div>
          <div><span className="text-slate-500">Vehículo:</span> {interv.vehiculo?.matricula ?? "—"}</div>
          <div><span className="text-slate-500">Fecha:</span> {interv.fecha}</div>
          <div><span className="text-slate-500">Técnico:</span> {interv.tecnico?.nombre ?? "—"}</div>
          <div><span className="text-slate-500">Km:</span> {hechos.km ?? "—"}</div>
          <div>
            <span className="text-slate-500">Horario:</span> {fmtHora(interv.inicio_at)}–{fmtHora(interv.fin_at)}
            {" · "}<span className="text-slate-500">duración</span> {fmtDur(interv.duracion_seg)}
            {(interv.pausa_seg ?? 0) > 0 ? <> · <span className="text-slate-500">pausas</span> {fmtDur(interv.pausa_seg)}</> : null}
          </div>
        </div>
        {interv.observaciones && <div className="mt-2 text-[12px] text-slate-400">{interv.observaciones}</div>}
      </div>

      {/* ── Por qué: la avería de origen ── */}
      {interv.incidencias && interv.incidencias.length > 0 && (
        <div className="mt-3 rounded-lg border border-red-600/30 bg-red-500/5 p-3 text-sm">
          <div className="mb-1 text-[11px] font-semibold uppercase text-red-300">Por qué se intervino</div>
          <ul className="space-y-0.5 text-slate-200">
            {interv.incidencias.map((i, k) => (
              <li key={k}>{i.codigo ?? "—"}: <span className="text-red-300">{(i.averias ?? []).join(" · ")}</span>{i.gravedad ? ` (${i.gravedad})` : ""}</li>
            ))}
          </ul>
        </div>
      )}

      {/* ── Qué se hizo, en lenguaje normal ── */}
      <div className="mt-3 rounded-lg border border-emerald-600/30 bg-emerald-500/5 p-3">
        <div className="mb-1 text-[11px] font-semibold uppercase text-emerald-300">Qué se hizo</div>
        <div className="whitespace-pre-line text-sm text-slate-200">{interv.resumen_ia || interv.resumen || "Sin resumen."}</div>
        {interv.resumen_ia && interv.resumen && interv.resumen_ia !== interv.resumen && (
          <div className="mt-2 whitespace-pre-line border-t border-emerald-600/20 pt-2 text-[12px] text-slate-400">{interv.resumen}</div>
        )}
      </div>

      {/* ── Indicadores ── */}
      <div className="mt-3 flex flex-wrap gap-2">
        <Chip n={hechos.retirados.filter((o) => o.tipo_operacion === "sustitucion").length} label="Sustituidos" tone="text-sky-300" />
        <Chip n={hechos.montadosNuevos.length} label="Nuevos montados" tone="text-emerald-300" />
        <Chip n={hechos.montadosUsados.length} label="Usados montados" tone="text-emerald-300" />
        <Chip n={hechos.sinControl.length} label="Sin control de stock" tone="text-amber-300" />
        <Chip n={hechos.recuperados.length} label="Recuperados al almacén" tone="text-teal-300" />
        <Chip n={hechos.movidos.length} label="Movidos de posición" tone="text-indigo-300" />
        <Chip n={hechos.reparados.length} label="Reparados" tone="text-purple-300" />
        <Chip n={hechos.pendientes.length} label="Pendientes" tone="text-amber-300" />
      </div>

      {/* ── Esquema del vehículo: antes / después ── */}
      {(interv.montaje_antes?.length || interv.montaje_despues?.length) ? (() => {
        const antes = interv.montaje_antes ?? [];
        const despues = interv.montaje_despues ?? [];
        const antesPorPos = new Map(antes.map((s) => [s.posicion_id ?? "", s]));
        const cambiadas = new Set(
          despues.filter((d) => {
            const a = antesPorPos.get(d.posicion_id ?? "");
            return !a || a.marca !== d.marca || a.medida !== d.medida || a.mm !== d.mm;
          }).map((d) => d.posicion_id ?? ""));
        return (
          <div className="mt-3 flex gap-4 rounded-lg border border-slate-700 bg-slate-900/40 p-3">
            <PlanoSnapshot titulo="Antes" snap={antes} imagen={interv.imagen_chasis} conAveria />
            <div className="flex items-center text-slate-500">→</div>
            <PlanoSnapshot titulo="Después" snap={despues} imagen={interv.imagen_chasis} cambiadas={cambiadas} />
          </div>
        );
      })() : null}

      {/* ── Pendiente (siempre visible: es lo que no hay que ocultar, §4.7) ── */}
      {hechos.pendientes.length > 0 && (
        <div className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm">
          <div className="mb-1 text-[11px] font-semibold uppercase text-amber-300">
            Quedan {hechos.pendientes.length} operación(es) previstas sin realizar
          </div>
          <ul className="list-disc space-y-0.5 pl-5 text-slate-200 marker:text-amber-400">
            {hechos.pendientes.map((o) => (
              <li key={o.id}>
                {TIPO_OPERACION_LABELS[o.tipo_operacion]}{o.posicion_destino?.nombre ? ` — ${o.posicion_destino.nombre}` : ""}
                {o.motivo ? ` (${MOTIVO_OPERACION_LABELS[o.motivo] ?? o.motivo})` : ""}
                {o.status ? ` · ${ESTADO_OPERACION_LABELS[o.status]}` : ""}
              </li>
            ))}
          </ul>
        </div>
      )}

      {nivel !== "rapido" && (
        <>
          {/* ── Neumáticos montados, con su ORIGEN ── */}
          {(hechos.montadosAlmacen.length > 0 || hechos.sinControl.length > 0) && (
            <div className="mt-3 rounded-lg bg-slate-800 p-3">
              <div className="mb-2 text-[11px] font-bold uppercase text-slate-400">Neumáticos montados</div>
              <TableWrap>
                <thead className="bg-slate-900"><tr>
                  <th className={thCls}>Neumático</th><th className={thCls}>Marca y medida</th>
                  <th className={thCls}>Posición</th><th className={thCls}>Origen</th>
                </tr></thead>
                <tbody>
                  {[...hechos.montadosAlmacen, ...hechos.sinControl].map((o) => (
                    <tr key={o.id} className="border-t border-slate-700/60">
                      <td className={tdCls + " text-slate-200"}>{o.neumatico?.numero_interno ?? o.neumatico?.codigo_interno ?? "—"}</td>
                      <td className={tdCls + " text-slate-400"}>{o.neumatico?.marca ?? ""} {o.neumatico?.modelo ?? ""} {o.neumatico?.medida ?? ""}</td>
                      <td className={tdCls + " text-slate-400"}>{o.posicion_destino?.nombre ?? o.posicion_destino?.codigo_posicion ?? "—"}</td>
                      <td className={tdCls}>
                        {origenMontado(o) === "SIN CONTROL DE STOCK"
                          ? <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[11px] font-bold text-amber-300">SIN CONTROL DE STOCK</span>
                          : <span className="text-slate-300">{origenMontado(o)}</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </TableWrap>
            </div>
          )}

          {/* ── Retirados: qué pasó con cada uno ── */}
          {hechos.retirados.length > 0 && (
            <div className="mt-3 rounded-lg bg-slate-800 p-3">
              <div className="mb-2 text-[11px] font-bold uppercase text-slate-400">Neumáticos retirados</div>
              <TableWrap>
                <thead className="bg-slate-900"><tr>
                  <th className={thCls}>Neumático</th><th className={thCls}>Posición</th>
                  <th className={thCls}>Motivo</th><th className={thCls}>Qué pasó con él</th>
                </tr></thead>
                <tbody>
                  {hechos.retirados.map((o) => (
                    <tr key={o.id} className="border-t border-slate-700/60">
                      <td className={tdCls + " text-slate-200"}>{o.neumatico?.numero_interno ?? o.neumatico?.codigo_interno ?? "—"}</td>
                      <td className={tdCls + " text-slate-400"}>{o.posicion_origen?.nombre ?? o.posicion_origen?.codigo_posicion ?? "—"}</td>
                      <td className={tdCls + " text-slate-400"}>{o.motivo ? MOTIVO_OPERACION_LABELS[o.motivo] ?? o.motivo : "—"}</td>
                      <td className={tdCls + " text-slate-300"}>{destinoLabel(o.estado_nuevo === "pendiente_reciclaje" ? "reciclaje" : o.destino)}</td>
                    </tr>
                  ))}
                </tbody>
              </TableWrap>
            </div>
          )}

          {/* ── Stock: la foto DE ENTONCES (fase 5), nunca calculada por IA ── */}
          <div className="mt-3 rounded-lg bg-slate-800 p-3">
            <div className="mb-2 text-[11px] font-bold uppercase text-slate-400">Stock del almacén del cliente</div>
            {!snap ? (
              <div className="text-[12px] text-slate-500">
                Sin foto de stock: esta intervención se cerró antes de que el cierre la capturara, o aún está abierta.
                No se recalcula con el stock de hoy para no mentir.
              </div>
            ) : (
              <>
                {snap.efecto && snap.efecto.length > 0 && (
                  <TableWrap>
                    <thead className="bg-slate-900"><tr>
                      <th className={thCls}>Producto</th><th className={thCls}>Antes</th>
                      <th className={thCls}>Montados</th><th className={thCls}>Devueltos</th><th className={thCls}>Después</th>
                    </tr></thead>
                    <tbody>
                      {snap.efecto.map((e, i) => (
                        <tr key={i} className="border-t border-slate-700/60">
                          <td className={tdCls + " text-slate-200"}>{e.medida ?? "—"} {e.marca ?? ""} {e.modelo ?? ""}</td>
                          <td className={tdCls + " text-slate-400"}>{e.antes_nuevo ?? 0} nuevos · {e.antes_usado ?? 0} usados</td>
                          <td className={tdCls + " text-slate-400"}>{(e.montados_nuevo ?? 0) + (e.montados_usado ?? 0)}</td>
                          <td className={tdCls + " text-slate-400"}>{e.devueltos_usado ?? 0}</td>
                          <td className={tdCls + " text-slate-200"}>{e.despues_nuevo ?? 0} nuevos · {e.despues_usado ?? 0} usados</td>
                        </tr>
                      ))}
                    </tbody>
                  </TableWrap>
                )}
                {snap.lineas && snap.lineas.length > 0 && (
                  <details className="mt-2">
                    <summary className="cursor-pointer text-[11px] font-semibold uppercase text-slate-400">
                      Stock completo al cierre ({snap.lineas.length} productos)
                    </summary>
                    <div className="mt-1 space-y-0.5">
                      {snap.lineas.map((l, i) => (
                        <div key={i} className="text-[12px] text-slate-300">• {l.medida ?? "—"} {l.marca ?? ""} {l.modelo ?? ""} — {l.nuevo ?? 0} nuevos · {l.usado ?? 0} usados</div>
                      ))}
                    </div>
                  </details>
                )}
                {(!snap.efecto || snap.efecto.length === 0) && (!snap.lineas || snap.lineas.length === 0) && (
                  <div className="text-[12px] text-slate-500">Esta intervención no tocó el stock del almacén.</div>
                )}
              </>
            )}
          </div>

          {/* ── Fotos, asociadas a la operación que explican ── */}
          {adjuntos && adjuntos.size > 0 && (
            <div className="mt-3 rounded-lg bg-slate-800 p-3">
              <div className="mb-2 text-[11px] font-bold uppercase text-slate-400">Fotos</div>
              <div className="space-y-2">
                {ops.filter((o) => adjuntos.has(o.id)).map((o) => (
                  <div key={o.id}>
                    <div className="mb-1 text-[12px] text-slate-400">
                      {TIPO_OPERACION_LABELS[o.tipo_operacion]}
                      {o.posicion_destino?.codigo_posicion || o.posicion_origen?.codigo_posicion
                        ? ` · ${o.posicion_origen?.codigo_posicion ?? ""}${o.posicion_origen && o.posicion_destino ? "→" : ""}${o.posicion_destino?.codigo_posicion ?? ""}` : ""}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {(adjuntos.get(o.id) ?? []).map((f) => (
                        <a key={f.id} href={f.file_url} target="_blank" rel="noreferrer">
                          <img src={f.file_url} alt={f.descripcion ?? ""} title={f.file_type ?? ""} className="h-24 w-24 rounded bg-slate-950 object-cover" />
                        </a>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {/* ── TRAZABILIDAD: ids, tiempos, movimientos, historial, auditoría ── */}
      {nivel === "trazabilidad" && (
        <div className="mt-3 rounded-lg bg-slate-800 p-3">
          <div className="mb-2 text-[11px] font-bold uppercase text-slate-400">
            Trazabilidad · intervención <span className="font-mono normal-case">{interv.id}</span>
          </div>
          {!traza ? <div className="text-sm text-slate-500">Cargando trazabilidad…</div> : (
            <div className="space-y-3">
              {ops.map((o) => {
                const t = traza.get(o.id);
                return (
                  <div key={o.id} className={`rounded-lg border border-slate-700 bg-slate-900/60 p-2 ${o.is_anulada ? "opacity-70" : ""}`}>
                    <div className="flex flex-wrap items-baseline gap-x-3 text-[12px]">
                      <span className="font-mono font-bold text-sky-300">#{o.numero_operacion ?? "—"}</span>
                      <span className="text-slate-200">{TIPO_OPERACION_LABELS[o.tipo_operacion]}</span>
                      {o.status && <span className="text-slate-400">{ESTADO_OPERACION_LABELS[o.status]}</span>}
                      {o.is_anulada && <span className="font-bold text-rose-300">ANULADA</span>}
                      {o.is_correccion && <span className="font-bold text-orange-300">CORRECCIÓN</span>}
                      <span className="font-mono text-[10px] text-slate-500">{o.id}</span>
                    </div>
                    <div className="mt-1 text-[11px] text-slate-400">
                      creada {o.created_at ? new Date(o.created_at).toLocaleString("es-ES") : "—"}
                      {o.started_at ? ` · iniciada ${new Date(o.started_at).toLocaleString("es-ES")}` : ""}
                      {o.completed_at ? ` · completada ${new Date(o.completed_at).toLocaleString("es-ES")}` : ""}
                      {o.cancelled_at ? ` · cancelada ${new Date(o.cancelled_at).toLocaleString("es-ES")}` : ""}
                      {o.source ? ` · origen ${o.source}` : ""}
                      {o.operacion_prevista_id ? " · ejecuta un plan" : ""}
                      {o.incidencia_id ? " · ligada a incidencia" : ""}
                    </div>
                    {t?.error && <div className="mt-1 text-[11px] text-amber-300">⚠ Trazabilidad incompleta: {t.error}</div>}
                    {t && t.mov.length > 0 && (
                      <div className="mt-1 text-[11px] text-slate-300">
                        {t.mov.map((m) => (
                          <div key={m.id}>↳ {m.movimiento_tipo}{m.estado_anterior || m.estado_nuevo ? `: ${m.estado_anterior ?? "?"} → ${m.estado_nuevo ?? "?"}` : ""}{(m as any).neumatico ? ` · ${(m as any).neumatico.numero_interno ?? ""}` : ""}</div>
                        ))}
                      </div>
                    )}
                    {t && t.hist.length > 0 && (
                      <div className="mt-1 text-[11px] text-slate-400">
                        {t.hist.map((h) => (
                          <div key={h.id}>Δ {new Date(h.created_at).toLocaleString("es-ES")} — {h.estado_anterior ?? "—"} → {h.estado_nuevo}</div>
                        ))}
                      </div>
                    )}
                    {t && t.aud.length > 0 && (
                      <div className="mt-1 text-[11px] text-slate-500">
                        {t.aud.map((a) => (
                          <div key={a.id}>✎ {new Date(a.created_at).toLocaleString("es-ES")} — {a.accion}{a.motivo ? `: ${a.motivo}` : ""}</div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
              {hechos.anuladas.length > 0 && (
                <div className="text-[11px] text-slate-500">
                  {hechos.anuladas.length} operación(es) anuladas se muestran atenuadas: no cuentan en el informe, pero no se borran nunca.
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <div className="mt-4 text-center text-[10px] text-slate-600 print:text-slate-500">
        Mobilink TyreControl · Parte {interv.numero ?? "sin número"} · Los hechos salen de las operaciones registradas;
        el texto redactado no añade datos. Stock: foto tomada al cierre.
      </div>
    </div>
  );
}
