import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { listarRevisionesHistorico, listarEmpresas, listarUsuarios, listarDetalleRevision, listarIncidenciasDeRevision, listarTiposIncidencia, listarMotivosPendiente } from "../services/data";
import type { Empresa, Perfil, RevisionDetalle } from "../types";
import type { MontajeSnapshot } from "../services/data";
import { presionTxt } from "../types";
import { TableWrap, tdCls, thCls, inputCls, Modal } from "../components/ui";
import PlanoSnapshot from "../components/PlanoSnapshot";

// ── Estado de la revisión → etiqueta y color ─────────────────
const ESTADO_META: Record<string, { label: string; cls: string }> = {
  completada: { label: "Completada", cls: "bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/30" },
  completada_con_incidencias: { label: "Con incidencias solucionadas", cls: "bg-amber-500/15 text-amber-300 ring-1 ring-amber-500/30" },
  completada_incidencia_pendiente: { label: "Con incidencia pendiente", cls: "bg-orange-500/20 text-orange-300 ring-1 ring-orange-500/40" },
};

// ── Incidencias dentro de la ficha ───────────────────────────
const GRAV_INC: Record<string, { label: string; cls: string }> = {
  critica: { label: "Crítica", cls: "bg-rose-500/20 text-rose-300 ring-1 ring-rose-500/40" },
  importante: { label: "Importante", cls: "bg-orange-500/20 text-orange-300 ring-1 ring-orange-500/40" },
  leve: { label: "Leve", cls: "bg-amber-500/20 text-amber-300 ring-1 ring-amber-500/40" },
};
const ESTADO_INC: Record<string, string> = {
  detectada: "Detectada", pendiente_autorizacion: "Pendiente de autorización", autorizada: "Autorizada",
  planificada: "Planificada", pendiente_material: "Pendiente de material", pendiente_vehiculo: "Pendiente de vehículo",
  en_curso: "En curso", solucionada: "Solucionada", cancelada: "Cancelada", no_procede: "No procede",
};
const RESUELTA = new Set(["solucionada", "cancelada", "no_procede"]);

// Orden de las posiciones en la ficha: por eje y, dentro del eje, derecha
// antes que izquierda (E1_DER, E1_IZQ, E2_DER, E2_IZQ, …).
type PosLike = { eje?: number | null; codigo_posicion?: string | null; lado?: string | null } | null | undefined;
function ejeDe(p: PosLike): number {
  if (p?.eje != null) return p.eje;
  const m = /E(\d+)/i.exec(p?.codigo_posicion ?? "");
  return m ? Number(m[1]) : 99;
}
function ladoRank(p: PosLike): number {
  const s = `${p?.lado ?? ""} ${p?.codigo_posicion ?? ""}`.toUpperCase();
  return /DER/.test(s) ? 0 : /IZQ/.test(s) ? 1 : 2; // derecha primero
}
function ordenPos(a: PosLike, b: PosLike): number {
  return ejeDe(a) - ejeDe(b) || ladoRank(a) - ladoRank(b)
    || (a?.codigo_posicion ?? "").localeCompare(b?.codigo_posicion ?? "");
}

type Fila = {
  id: string;
  fecha: string;
  hora: string;
  matricula: string;
  unidad: string | null;
  cliente: string;
  base: string;
  tecnico: string;
  /** true si la midió el arco: no hay operario a quien nombrar. */
  esArco: boolean;
  km: number | null;
  estado: string;
  incidencias: number;
  incidenciasAbiertas: number;
  vehiculoId?: string;
  chasisImg: string | null;
};

function hoyISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function haceDiasISO(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function inicioMesISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}
function fechaCorta(iso: string): string {
  const [y, m, dd] = iso.split("-");
  return y && m && dd ? `${dd}/${m}/${y}` : iso;
}

export default function HistoricoRevisiones() {
  const navigate = useNavigate();
  const [empresas, setEmpresas] = useState<Empresa[]>([]);
  const [usuarios, setUsuarios] = useState<Perfil[]>([]);
  const [filas, setFilas] = useState<Fila[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Ficha de revisión completa (modal)
  const [ficha, setFicha] = useState<Fila | null>(null);
  const [fichaDetalle, setFichaDetalle] = useState<RevisionDetalle[]>([]);
  const [fichaIncidencias, setFichaIncidencias] = useState<any[]>([]);
  const [cargandoFicha, setCargandoFicha] = useState(false);
  const fichaDetalleOrden = useMemo(() => [...fichaDetalle].sort((a, b) => ordenPos(a.posicion, b.posicion)), [fichaDetalle]);
  const fichaIncidenciasOrden = useMemo(() => [...fichaIncidencias].sort((a, b) => ordenPos(a.posicion, b.posicion)), [fichaIncidencias]);
  // Etiquetas configurables (tipos de problema y motivos pendientes)
  const [tipoLabels, setTipoLabels] = useState<Record<string, string>>({});
  const [motivoLabels, setMotivoLabels] = useState<Record<string, string>>({});

  async function verFicha(f: Fila) {
    setFicha(f); setCargandoFicha(true); setFichaDetalle([]); setFichaIncidencias([]);
    try {
      const [det, incs] = await Promise.all([listarDetalleRevision(f.id), listarIncidenciasDeRevision(f.id)]);
      setFichaDetalle(det); setFichaIncidencias(incs);
    } catch { setFichaDetalle([]); setFichaIncidencias([]); }
    finally { setCargandoFicha(false); }
  }

  // Filtros (por defecto: últimos 7 días)
  const [desde, setDesde] = useState(haceDiasISO(7));
  const [hasta, setHasta] = useState(hoyISO());
  const [fEmpresa, setFEmpresa] = useState("");
  const [fTecnico, setFTecnico] = useState("");

  useEffect(() => {
    Promise.all([listarEmpresas(), listarUsuarios()])
      .then(([e, u]) => { setEmpresas(e); setUsuarios(u); })
      .catch(() => {/* los filtros quedan vacíos, la tabla sigue */});
    // Etiquetas de tipos de problema y motivos (para la ficha); si falla, se usan las claves.
    Promise.all([listarTiposIncidencia(false), listarMotivosPendiente(false)])
      .then(([tipos, motivos]) => {
        setTipoLabels(Object.fromEntries(tipos.map((t) => [t.clave, t.etiqueta])));
        setMotivoLabels(Object.fromEntries(motivos.map((m) => [m.clave, m.etiqueta])));
      })
      .catch(() => {/* sin catálogo: se muestran las claves crudas */});
  }, []);

  async function cargar() {
    setLoading(true); setError("");
    try {
      const data = await listarRevisionesHistorico({
        desde: desde || null,
        hasta: hasta || null,
        empresaId: fEmpresa || null,
        tecnicoId: fTecnico || null,
      });
      setFilas(data.map((r: any) => {
        // La hora de la MEDICIÓN, no la de la grabación. El CheckPoint la
        // trae en el informe (13:14:52) y se guarda en medido_at; sin ella,
        // una importación pintaba la misma hora —la de la importación— en
        // todas sus revisiones. created_at sigue valiendo para lo que se hace
        // con la APK, donde el técnico guarda al terminar.
        const cuando = r.medido_at ?? r.created_at;
        const d = cuando ? new Date(cuando) : null;
        const incs = (r.incidencias ?? []) as { estado: string }[];
        // Misma regla que tc_informe_control_revisiones: es del arco cuando
        // TODAS sus mediciones vienen del arco. Si un técnico repasó una sola
        // rueda, la revisión ya no es del CheckPoint y lleva su nombre.
        const dets = (r.detalles ?? []) as { metodo_profundidad: string | null; metodo_presion: string | null }[];
        const esArco = dets.length > 0
          && dets.every((d) => d.metodo_profundidad === "checkpoint" || d.metodo_presion === "checkpoint");
        return {
          id: r.id,
          fecha: r.fecha_revision ?? "",
          hora: d ? `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}` : "",
          matricula: r.vehiculo?.matricula ?? "—",
          unidad: r.vehiculo?.numero_unidad ?? null,
          cliente: r.vehiculo?.empresa?.nombre ?? "—",
          base: r.vehiculo?.delegacion?.nombre ?? "—",
          tecnico: r.tecnico?.nombre ?? (esArco ? "CheckPoint" : "—"),
          esArco,
          km: r.km_vehiculo != null ? Number(r.km_vehiculo) : null,
          estado: r.estado_revision ?? "completada",
          incidencias: incs.length,
          incidenciasAbiertas: incs.filter((i) => !["solucionada", "cancelada", "no_procede"].includes(i.estado)).length,
          vehiculoId: r.vehiculo?.id ?? undefined,
          chasisImg: r.vehiculo?.tipo?.imagen_chasis_url ?? null,
        };
      }));
    } catch (e: any) { setError(e?.message || "Error"); }
    finally { setLoading(false); }
  }
  // Recarga al cambiar cualquier filtro (la consulta filtra en el servidor).
  useEffect(() => { void cargar(); /* eslint-disable-next-line */ }, [desde, hasta, fEmpresa, fTecnico]);

  const rango = (d: string, h: string) => { setDesde(d); setHasta(h); };
  const esHoy = desde === hoyISO() && hasta === hoyISO();
  const es7 = desde === haceDiasISO(7) && hasta === hoyISO();
  const esMes = desde === inicioMesISO() && hasta === hoyISO();

  const resumen = useMemo(() => {
    const conInc = filas.filter((f) => f.incidencias > 0).length;
    const pend = filas.filter((f) => f.incidenciasAbiertas > 0).length;
    return { total: filas.length, conInc, pend };
  }, [filas]);

  // Cuántas ha hecho cada uno, con los MISMOS filtros que la tabla — se cuenta
  // sobre las filas ya cargadas, así que no puede discrepar de lo que se ve.
  // El arco va aparte: no es un operario, y mezclarlo escondería cuánto hace
  // cada persona.
  const porQuien = useMemo(() => {
    const m = new Map<string, { quien: string; esArco: boolean; n: number; conInc: number }>();
    for (const f of filas) {
      const quien = f.esArco ? "CheckPoint" : (f.tecnico && f.tecnico !== "—" ? f.tecnico : "Sin operario");
      const e = m.get(quien) ?? { quien, esArco: f.esArco, n: 0, conInc: 0 };
      e.n++; if (f.incidencias > 0) e.conInc++;
      m.set(quien, e);
    }
    // De más a menos; a igualdad, por nombre, para que no baile entre recargas.
    return [...m.values()].sort((a, b) => b.n - a.n || a.quien.localeCompare(b.quien));
  }, [filas]);

  // La consulta trae como mucho 200 filas. Si se alcanza el tope, el desglose
  // (y el total) son de lo cargado, no de todo lo que cumple el filtro: se
  // dice, en vez de dar un número que parece completo y no lo es.
  const topeAlcanzado = filas.length >= 200;

  const btnCls = (activo: boolean) =>
    `rounded-lg px-3 py-1.5 text-sm font-bold ${activo ? "bg-sky-600 text-white" : "bg-slate-800 text-slate-300 hover:bg-slate-700"}`;

  return (
    <div>
      <h1 className="mb-1 text-lg font-black">Histórico de revisiones</h1>
      <p className="mb-3 text-sm text-slate-400">Revisiones realizadas, con filtro por fechas, cliente y operario.</p>

      {/* Filtros */}
      <div className="mb-3 flex flex-wrap items-end gap-2">
        <button onClick={() => rango(hoyISO(), hoyISO())} className={btnCls(esHoy)}>Hoy</button>
        <button onClick={() => rango(haceDiasISO(7), hoyISO())} className={btnCls(es7)}>Últimos 7 días</button>
        <button onClick={() => rango(inicioMesISO(), hoyISO())} className={btnCls(esMes)}>Este mes</button>
        <label className="flex flex-col text-[10px] text-slate-500">Desde
          <input type="date" className={`${inputCls} w-auto`} value={desde} onChange={(e) => setDesde(e.target.value)} />
        </label>
        <label className="flex flex-col text-[10px] text-slate-500">Hasta
          <input type="date" className={`${inputCls} w-auto`} value={hasta} onChange={(e) => setHasta(e.target.value)} />
        </label>
        <select className={`${inputCls} w-auto`} value={fEmpresa} onChange={(e) => setFEmpresa(e.target.value)}>
          <option value="">Todos los clientes</option>
          {empresas.filter((e) => e.activo !== false).map((e) => <option key={e.id} value={e.id}>{e.nombre}</option>)}
        </select>
        <select className={`${inputCls} w-auto`} value={fTecnico} onChange={(e) => setFTecnico(e.target.value)}>
          <option value="">Todos los operarios</option>
          {usuarios.map((u) => <option key={u.id} value={u.id}>{u.nombre}</option>)}
        </select>
        <span className="pb-2 text-xs text-slate-500">
          {topeAlcanzado ? "Primeras " : ""}{resumen.total} revisión(es) · {resumen.conInc} con incidencias · {resumen.pend} con incidencia pendiente
          {topeAlcanzado && <span className="ml-1 text-amber-400">· hay más: acota las fechas</span>}
        </span>
      </div>

      {porQuien.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <span className="text-[11px] font-bold uppercase text-slate-500">Quién las ha hecho</span>
          {porQuien.map((p) => (
            <span key={p.quien}
              className={`rounded-full px-2.5 py-1 text-[12px] font-semibold ${
                p.esArco ? "bg-sky-500/15 text-sky-300" : "bg-slate-700/60 text-slate-200"}`}>
              {p.quien} <span className="font-black">{p.n}</span>
              {p.conInc > 0 && <span className="ml-1 text-amber-300">({p.conInc} con incid.)</span>}
            </span>
          ))}
        </div>
      )}

      {error && (
        <div className="mb-3 rounded-lg bg-rose-500/10 p-3 text-sm text-rose-300">
          {error} <button onClick={cargar} className="ml-2 rounded bg-slate-700 px-2 py-0.5 text-slate-200">Reintentar</button>
        </div>
      )}

      <TableWrap>
        <thead className="bg-slate-900"><tr>
          <th className={thCls}>Fecha</th><th className={thCls}>Hora</th><th className={thCls}>Matrícula</th>
          <th className={thCls}>Cliente</th><th className={thCls}>Base</th><th className={thCls}>Operario</th>
          <th className={thCls}>Km</th><th className={thCls}>Incidencias</th><th className={thCls}>Estado</th>
          <th className={thCls}></th>
        </tr></thead>
        <tbody>
          {loading ? (
            <tr><td className={tdCls + " text-slate-500"} colSpan={10}>Cargando…</td></tr>
          ) : filas.length === 0 ? (
            <tr><td className={tdCls + " text-slate-500"} colSpan={10}>Sin revisiones en este periodo.</td></tr>
          ) : filas.map((f) => {
            const meta = ESTADO_META[f.estado] ?? { label: f.estado, cls: "bg-slate-500/15 text-slate-300" };
            return (
              <tr key={f.id} className="border-t border-slate-700/60">
                <td className={tdCls + " text-slate-300"}>{fechaCorta(f.fecha)}</td>
                <td className={tdCls + " text-slate-400"}>{f.hora || "—"}</td>
                <td className={tdCls + " font-bold"}>{f.matricula}{f.unidad ? <span className="ml-1 text-[11px] font-normal text-slate-500">· {f.unidad}</span> : null}</td>
                <td className={tdCls + " text-slate-400"}>{f.cliente}</td>
                <td className={tdCls + " text-slate-400"}>{f.base}</td>
                <td className={tdCls + " text-slate-300"}>
                  {/* En chip y no como texto: "CheckPoint" no es una persona,
                      y puesto igual que un nombre se lee como si lo fuera. */}
                  {f.esArco
                    ? <span className="rounded-full bg-sky-500/15 px-2 py-0.5 text-[11px] font-bold text-sky-300">CheckPoint</span>
                    : f.tecnico}
                </td>
                <td className={tdCls + " text-slate-400"}>{f.km != null ? f.km.toLocaleString("es-ES") : "—"}</td>
                <td className={tdCls}>
                  {f.incidencias === 0 ? <span className="text-slate-500">—</span> : (
                    <button onClick={() => navigate("/tyrecontrol/incidencias")}
                      className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${f.incidenciasAbiertas > 0 ? "bg-rose-500/20 text-rose-300" : "bg-emerald-500/15 text-emerald-300"}`}
                      title={f.incidenciasAbiertas > 0 ? `${f.incidenciasAbiertas} abiertas` : "Todas solucionadas"}>
                      {f.incidencias}{f.incidenciasAbiertas > 0 ? ` (${f.incidenciasAbiertas} abiertas)` : " ✓"}
                    </button>
                  )}
                </td>
                <td className={tdCls}>
                  <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${meta.cls}`}>{meta.label}</span>
                </td>
                <td className={tdCls}>
                  <button onClick={() => verFicha(f)}
                    className="rounded-lg border border-slate-600 px-3 py-1 text-[12px] font-bold text-slate-200 hover:bg-slate-700">
                    Ver revisión
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </TableWrap>

      {ficha && (
        <Modal title={`Revisión ${ficha.matricula} · ${fechaCorta(ficha.fecha)}${ficha.hora ? ` · ${ficha.hora}` : ""}`} onClose={() => setFicha(null)} size="xl">
          <div className="mb-2 text-[12px] text-slate-400">
            {ficha.cliente} · Base {ficha.base} · {ficha.esArco ? "Medido por el CheckPoint" : `Operario: ${ficha.tecnico}`}
            {ficha.km != null ? ` · ${ficha.km.toLocaleString("es-ES")} km` : ""}
            {" · "}Estado: {ESTADO_META[ficha.estado]?.label ?? ficha.estado}
          </div>

          {/* Plano visual del vehículo con las mediciones de esta revisión */}
          {!cargandoFicha && fichaDetalle.length > 0 && (
            <div className="mb-4 rounded-lg bg-slate-950/40 p-3">
              <PlanoSnapshot
                imagen={ficha.chasisImg}
                snap={fichaDetalle.map((d): MontajeSnapshot => ({
                  posicion_id: d.posicion_id ?? null,
                  codigo: d.posicion?.codigo_posicion ?? null,
                  eje: d.posicion?.eje ?? null,
                  x: d.posicion?.pos_x ?? null, y: d.posicion?.pos_y ?? null,
                  w: d.posicion?.pos_w ?? null, h: d.posicion?.pos_h ?? null,
                  marca: d.neumatico?.marca ?? (d.neumatico_ausente ? "Ausente" : null),
                  modelo: d.neumatico?.modelo ?? null,
                  medida: d.neumatico?.medida ?? null,
                  mm: d.no_accesible ? null : d.profundidad_mm ?? null,
                  presion: d.no_accesible ? null : d.presion_bar ?? null,
                  averias: null,
                }))}
              />
            </div>
          )}

          {/* Incidencias detectadas en esta revisión */}
          {fichaIncidencias.length > 0 && (
            <div className="mb-4">
              <div className="mb-1 text-[11px] font-bold uppercase text-slate-400">Incidencias ({fichaIncidencias.length})</div>
              <div className="space-y-1.5">
                {fichaIncidenciasOrden.map((inc) => {
                  const grav = GRAV_INC[inc.gravedad] ?? { label: inc.gravedad, cls: "bg-slate-500/15 text-slate-300" };
                  const pos = inc.posicion?.nombre ?? inc.posicion?.codigo_posicion ?? "General del vehículo";
                  const problemas = (inc.problemas ?? []).map((p: any) => tipoLabels[p.tipo] ?? p.tipo).join(" · ");
                  const resuelta = RESUELTA.has(inc.estado);
                  return (
                    <div key={inc.id} className="flex items-start gap-2 rounded-lg border border-slate-700/60 bg-slate-800/40 p-2">
                      <span className={`mt-0.5 shrink-0 rounded-full px-2 py-0.5 text-[10px] font-black ${grav.cls}`}>{grav.label}</span>
                      <div className="flex-1">
                        <div className="text-sm font-bold text-slate-200">{pos}</div>
                        {problemas && <div className="text-[12px] text-slate-300">{problemas}</div>}
                        <div className="text-[11px] text-slate-500">
                          {ESTADO_INC[inc.estado] ?? inc.estado}
                          {inc.motivo_pendiente && !resuelta ? ` · ${motivoLabels[inc.motivo_pendiente] ?? inc.motivo_pendiente}` : ""}
                          {inc.foto_url ? " · 📷" : ""}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <div className="mb-1 text-[11px] font-bold uppercase text-slate-400">Mediciones por posición</div>
          <TableWrap>
            <thead className="bg-slate-900"><tr>
              <th className={thCls}>Posición</th><th className={thCls}>Neumático</th>
              <th className={thCls}>Marca y modelo</th><th className={thCls}>Profundidad</th>
              <th className={thCls}>Presión</th><th className={thCls}>Estado visual</th><th className={thCls}>Observaciones</th>
            </tr></thead>
            <tbody>
              {cargandoFicha ? <tr><td className={tdCls + " text-slate-500"} colSpan={7}>Cargando…</td></tr>
              : fichaDetalleOrden.length === 0 ? <tr><td className={tdCls + " text-slate-500"} colSpan={7}>Sin datos de posiciones para esta revisión.</td></tr>
              : fichaDetalleOrden.map((d) => (
                <tr key={d.id} className="border-t border-slate-700/60">
                  <td className={tdCls + " font-semibold"}>{d.posicion?.codigo_posicion ?? "—"}</td>
                  <td className={tdCls + " text-slate-400"}>{d.neumatico ? (d.neumatico.numero_interno ?? d.neumatico.codigo_interno) : (d.neumatico_ausente ? "Ausente" : "—")}</td>
                  {/* El número interno identifica la goma pero no dice cuál es:
                      con dos modelos de la misma marca y medida, un
                      "IMP-1492HPW-P2" no le sirve a nadie. Solo lo informado. */}
                  <td className={tdCls + " text-slate-300"}>
                    {[d.neumatico?.marca, d.neumatico?.modelo].filter(Boolean).join(" ") || "—"}
                    {d.neumatico?.medida ? <span className="ml-1 text-[11px] text-slate-500">{d.neumatico.medida}</span> : null}
                  </td>
                  <td className={tdCls + " text-slate-400"}>{d.no_accesible ? "No accesible" : d.profundidad_mm != null ? `${d.profundidad_mm} mm` : "—"}</td>
                  <td className={tdCls + " text-slate-400"}>{d.no_accesible ? "—" : d.presion_bar != null ? `${presionTxt(d.presion_bar)} bar` : "—"}</td>
                  <td className={tdCls + " text-slate-400"}>{d.estado_visual ?? "—"}</td>
                  <td className={tdCls + " text-slate-400"}>{d.observaciones ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        </Modal>
      )}
    </div>
  );
}
