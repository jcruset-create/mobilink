import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { listarOperacionesPagina, listarOperacionesTodas, listarEmpresas, listarVehiculos, actualizarCosteOperacion, planificarOperacion, cambiarEstadoOperacion, listarUsuarios, listarReservas, liberarReserva, anularOperacion, listarHistorialEstados, listarAuditoriaOperacion, listarMovimientosOperacion, listarAdjuntosOperacion, listarEjecucionesDePrevista, obtenerPrevistaDe } from "../services/data";
import type { EstadoHistorialEntry, AuditoriaEntry, OperacionVinculada } from "../services/data";
import type { Empresa, OperacionNeumatico, TipoOperacion, Vehiculo, EstadoOperacion, Perfil, ReservaNeumatico, PrioridadOperacion, OperacionMovimiento, OperacionAdjunto } from "../types";
import { TIPO_OPERACION_LABELS, MOTIVO_OPERACION_LABELS, ESTADO_OPERACION_LABELS, ESTADO_OPERACION_BADGE, PRIORIDAD_OPERACION_LABELS } from "../types";
import { TableWrap, tdCls, thCls, inputCls, Modal, Field } from "../components/ui";
import { useTyreAuth } from "../contexts/TyreAuthContext";

// Acciones de estado disponibles según el estado actual (transiciones simples).
// El grafo también vive en la base de datos (trg_op_valida_transicion): esto
// solo decide qué botones se enseñan.
const ACCIONES_ESTADO: Partial<Record<EstadoOperacion, { estado: EstadoOperacion; label: string; cls: string }[]>> = {
  pendiente: [{ estado: "asignada", label: "Asignar", cls: "text-sky-300" }, { estado: "cancelada", label: "Cancelar", cls: "text-rose-300" }],
  planificada: [{ estado: "asignada", label: "Asignar", cls: "text-sky-300" }, { estado: "cancelada", label: "Cancelar", cls: "text-rose-300" }],
  asignada: [{ estado: "en_proceso", label: "Iniciar", cls: "text-amber-300" }, { estado: "cancelada", label: "Cancelar", cls: "text-rose-300" }],
  en_proceso: [{ estado: "completada", label: "Completar", cls: "text-emerald-300" }, { estado: "pausada", label: "Pausar", cls: "text-amber-300" }],
  pausada: [{ estado: "en_proceso", label: "Reanudar", cls: "text-amber-300" }, { estado: "cancelada", label: "Cancelar", cls: "text-rose-300" }],
};

// Tipos FÍSICOS (es_fisica en tc_cat_tipos_operacion): no se completan a mano
// —la BD lo rechaza (EJECUCION_REQUERIDA)—, se cierran solos al registrar la
// ejecución real, que queda vinculada. Las correcciones sí se completan a mano.
const TIPOS_FISICOS = new Set<TipoOperacion>([
  "sustitucion", "montaje", "desmontaje", "cambio_posicion", "intercambio",
  "reparacion", "retirada_stock", "retirada_definitiva",
]);

const ESTADOS_ACTIVOS = new Set<EstadoOperacion>(["borrador", "pendiente", "planificada", "asignada", "en_proceso", "pausada"]);

function accionesPara(o: OperacionNeumatico): { estado: EstadoOperacion; label: string; cls: string }[] {
  if (!o.status || o.is_anulada) return [];
  const base = ACCIONES_ESTADO[o.status] ?? [];
  // "Completar" a mano solo para lo no físico; lo físico se completa ejecutando.
  return base.filter((a) => a.estado !== "completada" || !TIPOS_FISICOS.has(o.tipo_operacion));
}

const COLOR_TIPO: Record<TipoOperacion, string> = {
  montaje: "bg-emerald-500/30 text-emerald-200",
  desmontaje: "bg-slate-600 text-slate-100",
  sustitucion: "bg-sky-500/30 text-sky-200",
  rotacion: "bg-indigo-500/30 text-indigo-200",
  reparacion: "bg-purple-500/30 text-purple-200",
  descarte: "bg-rose-500/30 text-rose-200",
  entrada_almacen: "bg-teal-500/30 text-teal-200",
  salida_almacen: "bg-amber-500/30 text-amber-200",
  revision_vehiculo: "bg-cyan-500/30 text-cyan-200",
  cambio_posicion: "bg-indigo-500/30 text-indigo-200",
  intercambio: "bg-violet-500/30 text-violet-200",
  retirada_stock: "bg-teal-500/30 text-teal-200",
  retirada_definitiva: "bg-rose-500/30 text-rose-200",
  correccion_posicion: "bg-orange-500/30 text-orange-200",
  correccion_montado: "bg-orange-500/30 text-orange-200",
};

export default function Operaciones() {
  const { perfil } = useTyreAuth();
  const esCliente = perfil?.rol === "cliente" && !perfil?.es_superadmin;
  const [items, setItems] = useState<OperacionNeumatico[]>([]);
  const [empresas, setEmpresas] = useState<Empresa[]>([]);
  const [vehiculos, setVehiculos] = useState<Vehiculo[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState("");
  const [editCoste, setEditCoste] = useState<null | { id: string; material: string; mano: string }>(null);
  const [savingCoste, setSavingCoste] = useState(false);

  // Fase 5: planificar operación + reservas
  const [tecnicos, setTecnicos] = useState<Perfil[]>([]);
  const vacioPlan = { empresaId: "", tipo: "desmontaje" as TipoOperacion, vehiculoId: "", fechaPrevista: "", prioridad: "normal" as PrioridadOperacion, tecnicoId: "", motivo: "", obs: "" };
  const [plan, setPlan] = useState<typeof vacioPlan | null>(null);
  const [guardandoPlan, setGuardandoPlan] = useState(false);
  const [accionando, setAccionando] = useState<string | null>(null);
  const [reservas, setReservas] = useState<ReservaNeumatico[] | null>(null);
  const [cargandoRes, setCargandoRes] = useState(false);

  // Fase 6: detalle (historial/auditoría/movimientos/adjuntos) + anulación + export
  const [detalle, setDetalle] = useState<null | {
    op: OperacionNeumatico; movimientos: OperacionMovimiento[]; adjuntos: OperacionAdjunto[];
    historial: EstadoHistorialEntry[]; auditoria: AuditoriaEntry[];
    // Vínculo plan ↔ ejecución (fase 2): qué plan ejecuta esta fila y qué
    // ejecuciones cierran este plan.
    ejecuciones: OperacionVinculada[]; prevista: OperacionVinculada | null;
    // Por sección: un fallo de permisos o de red no puede parecer "no hay nada".
    errores: Partial<Record<"movimientos" | "adjuntos" | "historial" | "auditoria" | "vinculo", string>>;
  }>(null);
  const [cargandoDet, setCargandoDet] = useState(false);
  const [motivoAnular, setMotivoAnular] = useState("");
  const [anulando, setAnulando] = useState(false);

  async function abrirDetalle(o: OperacionNeumatico) {
    setDetalle({ op: o, movimientos: [], adjuntos: [], historial: [], auditoria: [], ejecuciones: [], prevista: null, errores: {} });
    setMotivoAnular(""); setCargandoDet(true);
    try {
      // allSettled y no all: que falle una sección no puede tumbar las otras,
      // pero tampoco puede desaparecer. Cada una dice lo suyo.
      const [mov, adj, hist, aud, ejec, prev] = await Promise.allSettled([
        listarMovimientosOperacion(o.id),
        listarAdjuntosOperacion(o.id),
        listarHistorialEstados(o.id),
        listarAuditoriaOperacion(o.id),
        listarEjecucionesDePrevista(o.id),
        obtenerPrevistaDe(o),
      ]);
      const err = (r: PromiseSettledResult<unknown>) =>
        r.status === "rejected" ? ((r.reason as any)?.message || "No se ha podido cargar") : undefined;
      const val = <T,>(r: PromiseSettledResult<T[]>): T[] => (r.status === "fulfilled" ? r.value : []);
      setDetalle({
        op: o,
        movimientos: val(mov), adjuntos: val(adj), historial: val(hist), auditoria: val(aud),
        ejecuciones: val(ejec),
        prevista: prev.status === "fulfilled" ? prev.value : null,
        errores: {
          movimientos: err(mov), adjuntos: err(adj), historial: err(hist), auditoria: err(aud),
          vinculo: err(ejec) ?? err(prev),
        },
      });
    } finally { setCargandoDet(false); }
  }

  async function confirmarAnular() {
    if (!detalle || !motivoAnular.trim()) { setMsg("Indica el motivo de anulación"); return; }
    setAnulando(true); setMsg("");
    try { await anularOperacion(detalle.op.id, motivoAnular.trim()); setDetalle(null); await cargar(); }
    catch (e: any) { setMsg(e?.message || "Error al anular"); } finally { setAnulando(false); }
  }

  const [exportando, setExportando] = useState(false);
  async function exportarExcel() {
    setExportando(true); setMsg("");
    try {
      const XLSX = await import("xlsx");
      // Lo que cumple el filtro, no lo que hay en pantalla. Antes exportaba
      // `items`, así que el Excel se quedaba en la página actual y el usuario
      // no tenía forma de notar lo que faltaba.
      const { filas: todas, total: n, truncado } = await listarOperacionesTodas(filtros);
      if (truncado) {
        setMsg(`El filtro devuelve ${n} operaciones y se han exportado ${todas.length}. Acota el rango de fechas o la empresa para llevártelas todas.`);
      }
      const filas = todas.map((o) => ({
        Nº: o.numero_operacion ?? "", Fecha: o.fecha_operacion ?? "", Empresa: o.empresa?.nombre ?? "",
        Vehículo: o.vehiculo?.matricula ?? "", Tipo: TIPO_OPERACION_LABELS[o.tipo_operacion] ?? o.tipo_operacion,
        Estado: o.status ? ESTADO_OPERACION_LABELS[o.status] : "", Prioridad: o.prioridad ? PRIORIDAD_OPERACION_LABELS[o.prioridad] : "",
        Neumático: o.neumatico?.numero_interno ?? o.neumatico?.codigo_interno ?? "",
        Motivo: o.motivo ? MOTIVO_OPERACION_LABELS[o.motivo] : "", Destino: o.destino ?? "",
        Proveedor: o.proveedor ?? "", Coste: (o.coste ?? ((o.coste_material ?? 0) + (o.coste_mano_obra ?? 0))) || "",
        Anulada: o.is_anulada ? "Sí" : "", Observaciones: o.observaciones ?? "",
      }));
      const ws = XLSX.utils.json_to_sheet(filas);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Operaciones");
      XLSX.writeFile(wb, `operaciones_${new Date().toISOString().slice(0, 10)}.xlsx`);
    } catch (e: any) { setMsg(e?.message || "Error al exportar"); } finally { setExportando(false); }
  }

  async function abrirPlan() {
    setPlan({ ...vacioPlan, empresaId: esCliente ? (perfil?.empresa_id ?? "") : (fEmpresa || "") });
    if (tecnicos.length === 0) listarUsuarios().then(setTecnicos).catch(() => {});
  }

  async function guardarPlan() {
    if (!plan || !plan.empresaId || !plan.tipo) { setMsg("Empresa y tipo son obligatorios"); return; }
    setGuardandoPlan(true); setMsg("");
    try {
      await planificarOperacion({
        empresaId: plan.empresaId, tipoOperacion: plan.tipo, vehiculoId: plan.vehiculoId || null,
        fechaPrevista: plan.fechaPrevista || null, prioridad: plan.prioridad,
        tecnicoId: plan.tecnicoId || null, motivo: plan.motivo.trim() || null, observaciones: plan.obs.trim() || null,
      });
      setPlan(null); await cargar();
    } catch (e: any) { setMsg(e?.message || "Error al planificar"); } finally { setGuardandoPlan(false); }
  }

  async function accionEstado(o: OperacionNeumatico, estado: EstadoOperacion) {
    setAccionando(o.id); setMsg("");
    try { await cambiarEstadoOperacion({ operacionId: o.id, nuevoEstado: estado }); await cargar(); }
    catch (e: any) { setMsg(e?.message || "Error"); } finally { setAccionando(null); }
  }

  async function abrirReservas() {
    setReservas([]); setCargandoRes(true);
    try { setReservas(await listarReservas({ empresaId: fEmpresa || undefined, status: "activa" })); }
    catch { setReservas([]); } finally { setCargandoRes(false); }
  }
  async function quitarReserva(r: ReservaNeumatico) {
    try { await liberarReserva(r.id); setReservas((prev) => (prev ?? []).filter((x) => x.id !== r.id)); }
    catch (e: any) { setMsg(e?.message || "Error"); }
  }

  const [fEmpresa, setFEmpresa] = useState(esCliente ? (perfil?.empresa_id ?? "") : "");
  const [fVehiculo, setFVehiculo] = useState("");
  const [fTipo, setFTipo] = useState<TipoOperacion | "">("");
  const [fEstado, setFEstado] = useState<EstadoOperacion | "">("");
  const [fDesde, setFDesde] = useState("");
  const [fHasta, setFHasta] = useState("");
  const [pagina, setPagina] = useState(0);
  const [total, setTotal] = useState(0);
  const TAMANO = 50;
  const ultimaPagina = Math.max(0, Math.ceil(total / TAMANO) - 1);

  const filtros = {
    empresaId: fEmpresa || undefined, vehiculoId: fVehiculo || undefined,
    tipo: fTipo || undefined, estado: fEstado || undefined, desde: fDesde || undefined, hasta: fHasta || undefined,
  };

  async function cargar() {
    setLoading(true);
    try {
      const [pag, veh] = await Promise.all([
        listarOperacionesPagina(filtros, pagina, TAMANO),
        listarVehiculos(fEmpresa ? { empresaId: fEmpresa } : undefined),
      ]);
      setItems(pag.filas); setTotal(pag.total); setVehiculos(veh);
    } catch (e: any) { setMsg(e?.message || "Error"); } finally { setLoading(false); }
  }
  useEffect(() => { if (!esCliente) listarEmpresas().then(setEmpresas); }, [esCliente]);
  // Cambiar un filtro vuelve a la primera página: quedarse en la 7 de un
  // resultado que ahora tiene 2 enseña una tabla vacía que parece un fallo.
  useEffect(() => { setPagina(0); }, [fEmpresa, fVehiculo, fTipo, fEstado, fDesde, fHasta]);
  useEffect(() => { void cargar(); /* eslint-disable-next-line */ }, [fEmpresa, fVehiculo, fTipo, fEstado, fDesde, fHasta, pagina]);

  const num = (s: string) => (s.trim() === "" ? null : Number(s.replace(",", ".")));
  async function guardarCoste() {
    if (!editCoste) return;
    setSavingCoste(true);
    try {
      await actualizarCosteOperacion(editCoste.id, { coste_material: num(editCoste.material), coste_mano_obra: num(editCoste.mano) });
      setEditCoste(null); await cargar();
    } catch (e: any) { setMsg(e?.message || "Error al guardar el coste"); } finally { setSavingCoste(false); }
  }

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-black">Operaciones de neumáticos</h1>
        <div className="flex gap-2">
          <button onClick={exportarExcel} disabled={exportando} className="rounded-lg border border-slate-600 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-slate-700 disabled:opacity-50">{exportando ? "Exportando…" : "Exportar Excel"}</button>
          <button onClick={abrirReservas} className="rounded-lg border border-sky-600 px-3 py-1.5 text-xs font-semibold text-sky-300 hover:bg-sky-600/10">Reservas activas</button>
          <button onClick={abrirPlan} className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-500">+ Nueva operación</button>
        </div>
      </div>
      {msg && <div className="mb-3 text-sm text-red-300">{msg}</div>}

      <div className="mb-3 flex flex-wrap items-center gap-2">
        {!esCliente && (
          <select className={`${inputCls} w-auto`} value={fEmpresa} onChange={(e) => { setFEmpresa(e.target.value); setFVehiculo(""); }}>
            <option value="">Todas las empresas</option>{empresas.map((e) => <option key={e.id} value={e.id}>{e.nombre}</option>)}
          </select>
        )}
        <select className={`${inputCls} w-auto`} value={fVehiculo} onChange={(e) => setFVehiculo(e.target.value)}>
          <option value="">Todos los vehículos</option>{vehiculos.map((v) => <option key={v.id} value={v.id}>{v.matricula}</option>)}
        </select>
        <select className={`${inputCls} w-auto`} value={fTipo} onChange={(e) => setFTipo(e.target.value as TipoOperacion | "")}>
          <option value="">Todos los tipos</option>
          {(Object.keys(TIPO_OPERACION_LABELS) as TipoOperacion[]).map((t) => <option key={t} value={t}>{TIPO_OPERACION_LABELS[t]}</option>)}
        </select>
        <select className={`${inputCls} w-auto`} value={fEstado} onChange={(e) => setFEstado(e.target.value as EstadoOperacion | "")}>
          <option value="">Todos los estados</option>
          {(Object.keys(ESTADO_OPERACION_LABELS) as EstadoOperacion[]).map((s) => <option key={s} value={s}>{ESTADO_OPERACION_LABELS[s]}</option>)}
        </select>
        <input type="date" className={`${inputCls} w-auto`} value={fDesde} onChange={(e) => setFDesde(e.target.value)} />
        <span className="text-xs text-slate-500">a</span>
        <input type="date" className={`${inputCls} w-auto`} value={fHasta} onChange={(e) => setFHasta(e.target.value)} />
        {/* Antes decía items.length: las filas cargadas, no las que hay. Con el
            tope de 200 el número era además falso justo cuando importaba. */}
        <span className="text-xs text-slate-500">
          {total === 0 ? "0" : `${pagina * TAMANO + 1}–${Math.min((pagina + 1) * TAMANO, total)} de ${total}`}
        </span>
      </div>

      <TableWrap>
        <thead className="bg-slate-900"><tr>
          {/* "Nº" a secas se confundía con el número de intervención, que es
              otra serie distinta (tc_intervenciones.numero, texto). */}
          <th className={thCls} title="Número de operación. No es el número de intervención.">Nº operación</th>
          <th className={thCls}>Fecha</th><th className={thCls}>Empresa</th><th className={thCls}>Vehículo</th>
          <th className={thCls}>Tipo</th><th className={thCls}>Estado</th><th className={thCls}>Neumático</th><th className={thCls}>Posición</th>
          <th className={thCls}>Km</th><th className={thCls}>Motivo</th><th className={thCls}>Destino</th><th className={thCls}>Coste</th><th className={thCls}>Acciones</th>
        </tr></thead>
        <tbody>
          {loading ? <tr><td className={tdCls + " text-slate-500"} colSpan={13}>Cargando…</td></tr>
          : items.length === 0 ? <tr><td className={tdCls + " text-slate-500"} colSpan={13}>Sin operaciones.</td></tr>
          : items.map((o) => (
            <tr key={o.id} className="border-t border-slate-700/60">
              <td className={tdCls + " font-mono text-slate-500"}>{o.numero_operacion ? `#${o.numero_operacion}` : "—"}</td>
              <td className={tdCls + " text-slate-400"}>{o.fecha_operacion}</td>
              <td className={tdCls + " text-slate-400"}>{o.empresa?.nombre ?? "—"}</td>
              <td className={tdCls + " text-slate-400"}>{o.vehiculo?.matricula ?? "—"}</td>
              <td className={tdCls}><span className={`rounded-full px-2 py-0.5 text-xs font-bold ${COLOR_TIPO[o.tipo_operacion]}`}>{TIPO_OPERACION_LABELS[o.tipo_operacion]}</span></td>
              <td className={tdCls}>
                {o.status ? <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${ESTADO_OPERACION_BADGE[o.status]}`}>{ESTADO_OPERACION_LABELS[o.status]}</span> : "—"}
                {o.prioridad && o.prioridad !== "normal" && <span className="ml-1 text-[10px] uppercase text-amber-300">{PRIORIDAD_OPERACION_LABELS[o.prioridad]}</span>}
              </td>
              <td className={tdCls + " text-slate-400"}>{o.neumatico?.numero_interno ?? o.neumatico?.codigo_interno ?? "—"}</td>
              <td className={tdCls + " text-slate-400"}>{o.posicion_origen?.codigo_posicion ?? ""}{o.posicion_origen && o.posicion_destino ? " → " : ""}{o.posicion_destino?.codigo_posicion ?? ""}</td>
              <td className={tdCls + " text-slate-400"}>{o.km_vehiculo ?? "—"}</td>
              <td className={tdCls + " text-slate-400"}>{o.motivo ? MOTIVO_OPERACION_LABELS[o.motivo] : "—"}</td>
              <td className={tdCls + " text-slate-400"}>{o.destino ?? "—"}</td>
              <td className={tdCls}>
                {(() => {
                  const total = (o.coste_material ?? 0) + (o.coste_mano_obra ?? 0);
                  const tiene = o.coste_material != null || o.coste_mano_obra != null;
                  return (
                    <div className="flex items-center gap-2">
                      <span className="text-slate-300">{tiene ? total.toLocaleString("es-ES", { style: "currency", currency: "EUR" }) : "—"}</span>
                      {!esCliente && (
                        <button
                          onClick={() => setEditCoste({ id: o.id, material: o.coste_material != null ? String(o.coste_material) : "", mano: o.coste_mano_obra != null ? String(o.coste_mano_obra) : "" })}
                          className="text-[11px] text-sky-300 hover:underline"
                        >editar</button>
                      )}
                    </div>
                  );
                })()}
              </td>
              <td className={tdCls}>
                <div className="flex flex-wrap gap-1">
                  <button onClick={() => abrirDetalle(o)} className="rounded border border-slate-600 px-1.5 py-0.5 text-[11px] font-semibold text-slate-200 hover:bg-slate-700">Detalle</button>
                  {accionesPara(o).map((a) => (
                    <button key={a.estado} onClick={() => accionEstado(o, a.estado)} disabled={accionando === o.id}
                      className={`rounded border border-slate-600 px-1.5 py-0.5 text-[11px] font-semibold hover:bg-slate-700 disabled:opacity-50 ${a.cls}`}>
                      {a.label}
                    </button>
                  ))}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </TableWrap>

      {total > TAMANO && (
        <div className="mt-3 flex items-center justify-end gap-2 text-xs">
          <button onClick={() => setPagina((p) => Math.max(0, p - 1))} disabled={pagina === 0 || loading}
            className="rounded-lg border border-slate-600 px-3 py-1.5 font-semibold text-slate-200 hover:bg-slate-700 disabled:opacity-40">
            ← Anterior
          </button>
          <span className="text-slate-400">Página {pagina + 1} de {ultimaPagina + 1}</span>
          <button onClick={() => setPagina((p) => Math.min(ultimaPagina, p + 1))} disabled={pagina >= ultimaPagina || loading}
            className="rounded-lg border border-slate-600 px-3 py-1.5 font-semibold text-slate-200 hover:bg-slate-700 disabled:opacity-40">
            Siguiente →
          </button>
        </div>
      )}

      {editCoste && (
        <Modal title="Coste de la operación" onClose={() => setEditCoste(null)}
          footer={<div className="flex justify-end gap-2">
            <button onClick={() => setEditCoste(null)} className="rounded-lg border border-slate-600 px-4 py-2 text-sm text-slate-200">Cancelar</button>
            <button onClick={guardarCoste} disabled={savingCoste} className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">{savingCoste ? "Guardando…" : "Guardar"}</button>
          </div>}>
          <div className="grid gap-2 sm:grid-cols-2">
            <Field label="Coste material (€)"><input type="number" step="0.01" className={inputCls} value={editCoste.material} onChange={(e) => setEditCoste({ ...editCoste, material: e.target.value })} /></Field>
            <Field label="Coste mano de obra (€)"><input type="number" step="0.01" className={inputCls} value={editCoste.mano} onChange={(e) => setEditCoste({ ...editCoste, mano: e.target.value })} /></Field>
          </div>
        </Modal>
      )}

      {plan && (
        <Modal title="Planificar operación" onClose={() => setPlan(null)}
          footer={<div className="flex justify-end gap-2">
            <button onClick={() => setPlan(null)} className="rounded-lg border border-slate-600 px-4 py-2 text-sm text-slate-200">Cancelar</button>
            <button onClick={guardarPlan} disabled={guardandoPlan || !plan.empresaId} className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">{guardandoPlan ? "Guardando…" : "Planificar"}</button>
          </div>}>
          <p className="mb-3 text-xs text-slate-400">La operación queda pendiente/planificada. Se cerrará sola cuando se registre su ejecución real (montaje, desmontaje, sustitución…) desde la ficha del vehículo o la APK, y quedará vinculada a ella. Las operaciones físicas no se completan a mano.</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {!esCliente && (
              <Field label="Empresa">
                <select className={inputCls} value={plan.empresaId} onChange={(e) => setPlan({ ...plan, empresaId: e.target.value, vehiculoId: "" })}>
                  <option value="">Elegir…</option>{empresas.map((e) => <option key={e.id} value={e.id}>{e.nombre}</option>)}
                </select>
              </Field>
            )}
            <Field label="Tipo de operación">
              <select className={inputCls} value={plan.tipo} onChange={(e) => setPlan({ ...plan, tipo: e.target.value as TipoOperacion })}>
                {(Object.keys(TIPO_OPERACION_LABELS) as TipoOperacion[]).map((t) => <option key={t} value={t}>{TIPO_OPERACION_LABELS[t]}</option>)}
              </select>
            </Field>
            <Field label="Vehículo (opc.)">
              <select className={inputCls} value={plan.vehiculoId} onChange={(e) => setPlan({ ...plan, vehiculoId: e.target.value })}>
                <option value="">—</option>{vehiculos.map((v) => <option key={v.id} value={v.id}>{v.matricula}</option>)}
              </select>
            </Field>
            <Field label="Fecha prevista"><input type="date" className={inputCls} value={plan.fechaPrevista} onChange={(e) => setPlan({ ...plan, fechaPrevista: e.target.value })} /></Field>
            <Field label="Prioridad">
              <select className={inputCls} value={plan.prioridad} onChange={(e) => setPlan({ ...plan, prioridad: e.target.value as PrioridadOperacion })}>
                {(Object.keys(PRIORIDAD_OPERACION_LABELS) as PrioridadOperacion[]).map((p) => <option key={p} value={p}>{PRIORIDAD_OPERACION_LABELS[p]}</option>)}
              </select>
            </Field>
            <Field label="Técnico (opc.)">
              <select className={inputCls} value={plan.tecnicoId} onChange={(e) => setPlan({ ...plan, tecnicoId: e.target.value })}>
                <option value="">—</option>{tecnicos.filter((t) => !plan.empresaId || t.empresa_id === plan.empresaId).map((t) => <option key={t.id} value={t.id}>{t.nombre}</option>)}
              </select>
            </Field>
          </div>
          <div className="mt-2 grid gap-2">
            <Field label="Motivo (opc.)"><input className={inputCls} value={plan.motivo} onChange={(e) => setPlan({ ...plan, motivo: e.target.value })} /></Field>
            <Field label="Observaciones"><textarea className={inputCls} rows={2} value={plan.obs} onChange={(e) => setPlan({ ...plan, obs: e.target.value })} /></Field>
          </div>
        </Modal>
      )}

      {reservas !== null && (
        <Modal title="Reservas de neumático activas" onClose={() => setReservas(null)}>
          {cargandoRes ? (
            <div className="text-sm text-slate-500">Cargando…</div>
          ) : reservas.length === 0 ? (
            <div className="text-sm text-slate-500">No hay reservas activas.</div>
          ) : (
            <TableWrap>
              <thead className="bg-slate-900"><tr>
                <th className={thCls}>Neumático</th><th className={thCls}>Empresa</th><th className={thCls}>Vehículo</th>
                <th className={thCls}>Prevista</th><th className={thCls}></th>
              </tr></thead>
              <tbody>
                {reservas.map((r) => (
                  <tr key={r.id} className="border-t border-slate-700/60">
                    <td className={tdCls + " text-slate-200"}>{r.neumatico?.numero_interno ?? r.neumatico?.codigo_interno ?? "—"}{r.neumatico ? ` · ${r.neumatico.marca ?? ""} ${r.neumatico.medida ?? ""}` : ""}</td>
                    <td className={tdCls + " text-slate-400"}>{(r as any).empresa?.nombre ?? "—"}</td>
                    <td className={tdCls + " text-slate-400"}>{(r as any).vehiculo?.matricula ?? "—"}</td>
                    <td className={tdCls + " text-slate-400"}>{r.fecha_prevista ?? "—"}</td>
                    <td className={tdCls}><button onClick={() => quitarReserva(r)} className="rounded border border-rose-600 px-2 py-0.5 text-[11px] text-rose-300 hover:bg-rose-600/10">Liberar</button></td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
          )}
        </Modal>
      )}

      {detalle && (
        <Modal title={`Operación ${detalle.op.numero_operacion ? `nº ${detalle.op.numero_operacion}` : "(sin numerar)"}`} onClose={() => setDetalle(null)}>
          <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
            <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${COLOR_TIPO[detalle.op.tipo_operacion]}`}>{TIPO_OPERACION_LABELS[detalle.op.tipo_operacion]}</span>
            {detalle.op.status && <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${ESTADO_OPERACION_BADGE[detalle.op.status]}`}>{ESTADO_OPERACION_LABELS[detalle.op.status]}</span>}
            {detalle.op.is_anulada && <span className="rounded-full bg-slate-600 px-2 py-0.5 text-xs font-bold text-slate-200">ANULADA</span>}
            <span className="text-slate-400">{detalle.op.fecha_operacion} · {detalle.op.vehiculo?.matricula ?? "—"}</span>
          </div>
          {cargandoDet ? <div className="text-sm text-slate-500">Cargando…</div> : (
            <div className="space-y-3 text-sm">
              {/* Vínculo plan ↔ ejecución (fase 2). Solo sale cuando hay algo
                  que decir: qué plan ejecuta esta fila, qué ejecuciones
                  cerraron este plan, o cómo se completa una física activa. */}
              {detalle.errores.vinculo ? (
                <div className="rounded-lg bg-slate-800/60 p-2 text-[12px] text-amber-300">⚠ Vínculo plan↔ejecución: {detalle.errores.vinculo}</div>
              ) : (
                <>
                  {detalle.prevista && (
                    <div className="rounded-lg bg-sky-500/10 p-2 text-[12px] text-sky-200">
                      Ejecuta la operación planificada <span className="font-mono font-bold">#{detalle.prevista.numero_operacion ?? "—"}</span>
                      {detalle.prevista.fecha_operacion ? ` (${detalle.prevista.fecha_operacion})` : ""}
                    </div>
                  )}
                  {detalle.ejecuciones.length > 0 && (
                    <div className="rounded-lg bg-emerald-500/10 p-2 text-[12px] text-emerald-200">
                      Ejecutada en: {detalle.ejecuciones.map((e) => `#${e.numero_operacion ?? "—"} (${TIPO_OPERACION_LABELS[e.tipo_operacion as TipoOperacion] ?? e.tipo_operacion})`).join(", ")}
                    </div>
                  )}
                  {detalle.ejecuciones.length === 0 && !detalle.op.is_anulada
                    && TIPOS_FISICOS.has(detalle.op.tipo_operacion)
                    && !!detalle.op.status && ESTADOS_ACTIVOS.has(detalle.op.status) && (
                    <div className="rounded-lg bg-slate-800/60 p-2 text-[12px] text-slate-400">
                      Esta operación es física: no se completa a mano. Se cerrará sola al registrar la
                      ejecución real desde la ficha del vehículo o la APK, y quedará vinculada aquí.
                    </div>
                  )}
                </>
              )}
              <Seccion titulo="Movimientos" n={detalle.movimientos.length} error={detalle.errores.movimientos}>
                {detalle.movimientos.map((m) => (
                  <div key={m.id} className="text-[12px] text-slate-300">• {m.movimiento_tipo}{m.estado_anterior || m.estado_nuevo ? `: ${m.estado_anterior ?? "?"} → ${m.estado_nuevo ?? "?"}` : ""}{(m as any).neumatico ? ` · ${(m as any).neumatico.numero_interno ?? (m as any).neumatico.codigo_interno ?? ""}` : ""}</div>
                ))}
              </Seccion>
              <Seccion titulo="Historial de estados" n={detalle.historial.length} error={detalle.errores.historial}>
                {detalle.historial.map((h) => (
                  <div key={h.id} className="text-[12px] text-slate-300">• {new Date(h.created_at).toLocaleString("es-ES")} — {h.estado_anterior ?? "—"} → <span className="font-semibold">{h.estado_nuevo}</span></div>
                ))}
              </Seccion>
              <Seccion titulo="Auditoría" n={detalle.auditoria.length} error={detalle.errores.auditoria}>
                {detalle.auditoria.map((a) => (
                  <div key={a.id} className="text-[12px] text-slate-300">• {new Date(a.created_at).toLocaleString("es-ES")} — <span className="font-semibold">{a.accion}</span>{a.motivo ? `: ${a.motivo}` : ""}</div>
                ))}
              </Seccion>
              <Seccion titulo="Fotos" n={detalle.adjuntos.length} error={detalle.errores.adjuntos}>
                <div className="flex flex-wrap gap-2">
                  {detalle.adjuntos.map((f) => (
                    <a key={f.id} href={f.file_url} target="_blank" rel="noreferrer"><img src={f.file_url} alt="" className="h-20 w-20 rounded bg-slate-950 object-cover" /></a>
                  ))}
                </div>
              </Seccion>

              {!esCliente && !detalle.op.is_anulada && (
                <div className="mt-2 border-t border-slate-700 pt-3">
                  <div className="mb-1 text-xs font-semibold text-rose-300">Anular operación</div>
                  <div className="flex gap-2">
                    <input className={`${inputCls} flex-1`} placeholder="Motivo de anulación…" value={motivoAnular} onChange={(e) => setMotivoAnular(e.target.value)} />
                    <button onClick={confirmarAnular} disabled={anulando || !motivoAnular.trim()} className="rounded-lg border border-rose-600 bg-rose-600/20 px-3 py-2 text-xs font-bold text-rose-200 hover:bg-rose-600/30 disabled:opacity-50">{anulando ? "Anulando…" : "Anular"}</button>
                  </div>
                </div>
              )}
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}

/**
 * Tres estados distintos, no dos: con datos, vacía de verdad, y rota.
 * Antes las dos últimas se veían igual — un guion — y un fallo de permisos
 * pasaba por "aquí no hay nada".
 */
function Seccion({ titulo, n, error, children }: { titulo: string; n: number; error?: string; children: ReactNode }) {
  return (
    <div className="rounded-lg bg-slate-800/60 p-2">
      <div className="mb-1 text-[11px] font-bold uppercase text-slate-400">
        {titulo}{error ? "" : ` (${n})`}
      </div>
      {error ? (
        <div className="text-[12px] text-amber-300">⚠ No se ha podido cargar: {error}</div>
      ) : n === 0 ? (
        <div className="text-[12px] text-slate-500">Sin datos</div>
      ) : (
        <div className="space-y-0.5">{children}</div>
      )}
    </div>
  );
}
