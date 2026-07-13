import { useEffect, useState } from "react";
import {
  listarOperacionesMantenimiento, listarPlanesMantenimiento, listarPlanEstado,
  guardarPlanMantenimiento, eliminarPlanMantenimiento, registrarMantenimiento,
  listarMantenimientoRealizadas, listarDelegaciones, listarUsuarios, listarRevisiones,
} from "../services/data";
import type {
  PlanMantenimiento, PlanEstado, OperacionMantenimiento, MantenimientoRealizada,
  Delegacion, Perfil, Vehiculo, EstadoPlan, PlanMantenimientoInput,
} from "../types";

type UltimaRev = { fecha: string | null; km: number | null };
import { ESTADO_PLAN_LABELS, ESTADO_PLAN_BADGE, ESTADO_PLAN_ICONO, PRIORIDAD_PLAN_LABELS } from "../types";
import { Modal, inputCls, Field, TextField } from "./ui";

export function BadgePlan({ estado }: { estado: EstadoPlan }) {
  return (
    <span className={`whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-bold ${ESTADO_PLAN_BADGE[estado]}`}>
      {ESTADO_PLAN_ICONO[estado]} {ESTADO_PLAN_LABELS[estado].toUpperCase()}
    </span>
  );
}

function diasTexto(dias?: number | null): string {
  if (dias == null) return "—";
  if (dias < 0) return `${Math.abs(dias)} d de retraso`;
  if (dias === 0) return "hoy";
  return `${dias} d`;
}
const hoyISO = () => new Date().toISOString().slice(0, 10);

const RESULTADOS: { v: string; l: string }[] = [
  { v: "correcta", l: "Correcta" }, { v: "correcta_obs", l: "Correcta con observaciones" },
  { v: "requiere_reparacion", l: "Requiere reparación" }, { v: "incompleta", l: "Revisión incompleta" },
  { v: "no_disponible", l: "Vehículo no disponible" }, { v: "reprogramar", l: "Reprogramar" }, { v: "inmovilizar", l: "Inmovilizar" },
];

// ── Modal: registrar revisión realizada ────────────────────────
export function ModalRegistrar({ plan, tecnicos, onClose, onDone }: {
  plan: PlanMantenimiento; tecnicos: Perfil[]; onClose: () => void; onDone: () => void;
}) {
  const [fecha, setFecha] = useState(hoyISO());
  const [tecnicoId, setTecnicoId] = useState("");
  const [km, setKm] = useState("");
  const [horas, setHoras] = useState("");
  const [resultado, setResultado] = useState("correcta");
  const [obs, setObs] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  async function guardar() {
    setSaving(true); setErr("");
    try {
      await registrarMantenimiento({
        plan, fecha, tecnicoId: tecnicoId || null,
        km: km === "" ? null : Number(km), horas: horas === "" ? null : Number(horas),
        resultado, observaciones: obs.trim() || null,
      });
      onDone();
    } catch (e: any) { setErr(e?.message || "Error"); } finally { setSaving(false); }
  }

  const titulo = plan.nombre || plan.operacion?.nombre || "Revisión";
  return (
    <Modal title={`Registrar: ${titulo}`} onClose={onClose}
      footer={<div className="flex justify-end gap-2">
        <button onClick={onClose} className="rounded-lg border border-slate-600 px-4 py-2 text-sm text-slate-200">Cancelar</button>
        <button onClick={guardar} disabled={saving} className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">{saving ? "Guardando…" : "Registrar"}</button>
      </div>}>
      <div className="grid gap-2 sm:grid-cols-2">
        <Field label="Fecha"><input type="date" className={inputCls} value={fecha} onChange={(e) => setFecha(e.target.value)} /></Field>
        <Field label="Técnico">
          <select className={inputCls} value={tecnicoId} onChange={(e) => setTecnicoId(e.target.value)}>
            <option value="">—</option>
            {tecnicos.map((t) => <option key={t.id} value={t.id}>{t.nombre}</option>)}
          </select>
        </Field>
        <Field label="Kilómetros"><input type="number" className={inputCls} value={km} onChange={(e) => setKm(e.target.value)} placeholder={plan.ultima_km != null ? `anterior: ${plan.ultima_km}` : ""} /></Field>
        <Field label="Horas de motor"><input type="number" className={inputCls} value={horas} onChange={(e) => setHoras(e.target.value)} /></Field>
        <Field label="Resultado">
          <select className={inputCls} value={resultado} onChange={(e) => setResultado(e.target.value)}>
            {RESULTADOS.map((r) => <option key={r.v} value={r.v}>{r.l}</option>)}
          </select>
        </Field>
        <div className="sm:col-span-2"><Field label="Observaciones"><input className={inputCls} value={obs} onChange={(e) => setObs(e.target.value)} /></Field></div>
      </div>
      <div className="mt-2 text-[11px] text-slate-500">Al registrar se recalcula automáticamente la próxima revisión.</div>
      {err && <div className="mt-2 text-[12px] text-rose-300">{err}</div>}
    </Modal>
  );
}

// ── Modal: crear / editar plan ─────────────────────────────────
function ModalPlan({ vehiculo, plan, operaciones, delegaciones, tecnicos, ultimaRev, onClose, onDone }: {
  vehiculo: Vehiculo; plan: PlanMantenimiento | null;
  operaciones: OperacionMantenimiento[]; delegaciones: Delegacion[]; tecnicos: Perfil[];
  ultimaRev: UltimaRev; onClose: () => void; onDone: () => void;
}) {
  const [d, setD] = useState<Partial<PlanMantenimientoInput>>(plan ?? {
    empresa_id: vehiculo.empresa_id, vehiculo_id: vehiculo.id, operacion_id: "",
    margen_aviso_dias: 15, delegacion_id: vehiculo.delegacion_id ?? null, activo: true,
    // Precarga con la última inspección del vehículo (la que aparece en la ficha).
    ultima_fecha: ultimaRev.fecha, ultima_km: ultimaRev.km,
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const set = (p: Partial<PlanMantenimientoInput>) => setD({ ...d, ...p });
  const num = (v: string): number | null => (v === "" ? null : Number(v));

  async function guardar() {
    if (!d.operacion_id) { setErr("Elige el tipo de revisión"); return; }
    setSaving(true); setErr("");
    try {
      await guardarPlanMantenimiento({ ...d, id: plan?.id, empresa_id: vehiculo.empresa_id, vehiculo_id: vehiculo.id } as any);
      onDone();
    } catch (e: any) { setErr(e?.message || "Error"); } finally { setSaving(false); }
  }

  return (
    <Modal title={plan ? "Editar plan" : "Nuevo plan de mantenimiento"} onClose={onClose}
      footer={<div className="flex justify-end gap-2">
        <button onClick={onClose} className="rounded-lg border border-slate-600 px-4 py-2 text-sm text-slate-200">Cancelar</button>
        <button onClick={guardar} disabled={saving} className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">{saving ? "Guardando…" : "Guardar"}</button>
      </div>}>
      <div className="grid gap-2 sm:grid-cols-2">
        <Field label="Tipo de revisión *">
          <select className={inputCls} value={d.operacion_id ?? ""} onChange={(e) => set({ operacion_id: e.target.value })}>
            <option value="">Selecciona…</option>
            {operaciones.map((o) => <option key={o.id} value={o.id}>{o.nombre}</option>)}
          </select>
        </Field>
        <TextField label="Nombre (opcional)" value={d.nombre ?? ""} onChange={(v) => set({ nombre: v })} />
      </div>

      <div className="mt-2 rounded-lg border border-slate-700 p-3">
        <div className="mb-1 text-[11px] font-bold uppercase text-slate-400">Frecuencia</div>
        <div className="mb-2 text-[11px] text-slate-500">Rellena los que apliquen. Si informas varios, vence el que ocurra primero (p. ej. cada 30 días o cada 10.000 km).</div>
        <div className="grid gap-2 sm:grid-cols-3">
          <Field label="Cada (días)"><input type="number" className={inputCls} value={d.frecuencia_dias ?? ""} onChange={(e) => set({ frecuencia_dias: num(e.target.value) })} /></Field>
          <Field label="Cada (meses)"><input type="number" className={inputCls} value={d.frecuencia_meses ?? ""} onChange={(e) => set({ frecuencia_meses: num(e.target.value) })} /></Field>
          <Field label="Cada (km)"><input type="number" className={inputCls} value={d.frecuencia_km ?? ""} onChange={(e) => set({ frecuencia_km: num(e.target.value) })} /></Field>
          <Field label="Cada (horas)"><input type="number" className={inputCls} value={d.frecuencia_horas ?? ""} onChange={(e) => set({ frecuencia_horas: num(e.target.value) })} /></Field>
          <Field label="Fecha fija (ITV…)"><input type="date" className={inputCls} value={d.fecha_fija ?? ""} onChange={(e) => set({ fecha_fija: e.target.value || null })} /></Field>
          <Field label="Margen de aviso (días)"><input type="number" className={inputCls} value={d.margen_aviso_dias ?? 15} onChange={(e) => set({ margen_aviso_dias: Number(e.target.value) || 0 })} /></Field>
        </div>
      </div>

      <div className="mt-2 grid gap-2 sm:grid-cols-3">
        <Field label="Última revisión"><input type="date" className={inputCls} value={d.ultima_fecha ?? ""} onChange={(e) => set({ ultima_fecha: e.target.value || null })} /></Field>
        <Field label="Km última"><input type="number" className={inputCls} value={d.ultima_km ?? ""} onChange={(e) => set({ ultima_km: num(e.target.value) })} /></Field>
        <Field label="Horas última"><input type="number" className={inputCls} value={d.ultima_horas ?? ""} onChange={(e) => set({ ultima_horas: num(e.target.value) })} /></Field>
        <Field label="Base habitual">
          <select className={inputCls} value={d.delegacion_id ?? ""} onChange={(e) => set({ delegacion_id: e.target.value || null })}>
            <option value="">—</option>
            {delegaciones.filter((x) => x.empresa_id === vehiculo.empresa_id).map((x) => <option key={x.id} value={x.id}>{x.nombre}</option>)}
          </select>
        </Field>
        <Field label="Técnico asignado">
          <select className={inputCls} value={d.tecnico_id ?? ""} onChange={(e) => set({ tecnico_id: e.target.value || null })}>
            <option value="">—</option>
            {tecnicos.map((t) => <option key={t.id} value={t.id}>{t.nombre}</option>)}
          </select>
        </Field>
        <div className="sm:col-span-3"><Field label="Observaciones"><input className={inputCls} value={d.observaciones ?? ""} onChange={(e) => set({ observaciones: e.target.value })} /></Field></div>
      </div>
      {err && <div className="mt-2 text-[12px] text-rose-300">{err}</div>}
    </Modal>
  );
}

// ── Sección "Plan de mantenimiento" en la ficha del vehículo ───
export default function PlanMantenimientoVehiculo({ vehiculo, puedeEditar }: { vehiculo: Vehiculo; puedeEditar: boolean }) {
  const [planes, setPlanes] = useState<PlanMantenimiento[]>([]);
  const [estados, setEstados] = useState<Map<string, PlanEstado>>(new Map());
  const [operaciones, setOperaciones] = useState<OperacionMantenimiento[]>([]);
  const [delegaciones, setDelegaciones] = useState<Delegacion[]>([]);
  const [tecnicos, setTecnicos] = useState<Perfil[]>([]);
  const [historial, setHistorial] = useState<MantenimientoRealizada[]>([]);
  const [ultimaRev, setUltimaRev] = useState<UltimaRev>({ fecha: null, km: null });
  const [editar, setEditar] = useState<null | PlanMantenimiento | "nuevo">(null);
  const [registrar, setRegistrar] = useState<null | PlanMantenimiento>(null);

  async function cargar() {
    const [pl, est, op, del, tec, hist, revs] = await Promise.all([
      listarPlanesMantenimiento(vehiculo.id), listarPlanEstado(), listarOperacionesMantenimiento(),
      listarDelegaciones(), listarUsuarios(), listarMantenimientoRealizadas(vehiculo.id), listarRevisiones(vehiculo.id),
    ]);
    setPlanes(pl);
    setEstados(new Map(est.filter((e) => e.vehiculo_id === vehiculo.id).map((e) => [e.plan_id, e])));
    setOperaciones(op); setDelegaciones(del); setTecnicos(tec); setHistorial(hist);
    // Última inspección completada del vehículo (la más reciente que sale en la ficha).
    const ult = revs.filter((r) => r.estado_revision === "completada")
      .sort((a, b) => (a.fecha_revision < b.fecha_revision ? 1 : -1))[0];
    setUltimaRev({ fecha: ult?.fecha_revision ?? null, km: ult?.km_vehiculo ?? null });
  }
  useEffect(() => { void cargar(); /* eslint-disable-next-line */ }, [vehiculo.id]);

  const tecNombre = (id?: string | null) => tecnicos.find((t) => t.id === id)?.nombre ?? "—";

  return (
    <div className="mt-3 rounded-lg bg-slate-800 p-3">
      <div className="mb-2 flex items-center justify-between">
        <div className="text-[11px] font-bold uppercase text-slate-400">Plan de mantenimiento</div>
        {puedeEditar && <button onClick={() => setEditar("nuevo")} className="rounded-lg bg-emerald-600 px-3 py-1 text-[12px] font-bold text-white hover:bg-emerald-500">+ Añadir</button>}
      </div>

      {planes.length === 0 ? (
        <div className="text-[12px] text-slate-500">Sin operaciones planificadas.</div>
      ) : (
        <div className="flex flex-col gap-2">
          {planes.map((p) => {
            const e = estados.get(p.id);
            return (
              <div key={p.id} className="flex flex-wrap items-center gap-2 rounded-lg bg-slate-900/50 p-2">
                <div className="min-w-[140px] flex-1">
                  <div className="text-[13px] font-semibold text-slate-100">{p.nombre || p.operacion?.nombre}</div>
                  <div className="text-[11px] text-slate-500">
                    Próx: {e?.proxima_fecha_efec ? new Date(e.proxima_fecha_efec).toLocaleDateString("es-ES") : "—"}
                    {e?.proxima_km_efec != null ? ` · ${Number(e.proxima_km_efec).toLocaleString("es-ES")} km` : ""}
                    {e?.dias_restantes != null ? ` · ${diasTexto(e.dias_restantes)}` : ""}
                  </div>
                </div>
                {e && <BadgePlan estado={e.estado} />}
                {e && <span className="text-[10px] text-slate-500">{PRIORIDAD_PLAN_LABELS[e.prioridad]}</span>}
                {puedeEditar && (
                  <div className="flex gap-2 text-[12px]">
                    <button onClick={() => setRegistrar(p)} className="font-bold text-emerald-300 hover:underline">Registrar</button>
                    <button onClick={() => setEditar(p)} className="text-slate-300 hover:underline">Editar</button>
                    <button onClick={async () => { await eliminarPlanMantenimiento(p.id); cargar(); }} className="text-rose-300 hover:underline">Quitar</button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Historial de revisiones */}
      <div className="mt-3">
        <div className="mb-1 text-[11px] font-bold uppercase text-slate-400">Historial de revisiones</div>
        {historial.length === 0 ? (
          <div className="text-[12px] text-slate-500">Sin revisiones registradas.</div>
        ) : (
          <div className="flex flex-col gap-1">
            {historial.map((h) => (
              <div key={h.id} className="flex flex-wrap items-center gap-2 rounded bg-slate-900/40 px-2 py-1 text-[12px]">
                <span className="text-slate-400">{new Date(h.fecha).toLocaleDateString("es-ES")}</span>
                <span className="font-semibold text-slate-200">{h.operacion?.nombre ?? "Revisión"}</span>
                {h.km != null && <span className="text-slate-500">{Number(h.km).toLocaleString("es-ES")} km</span>}
                <span className="text-slate-500">· {tecNombre(h.tecnico_id)}</span>
                {h.resultado && <span className="text-slate-500">· {RESULTADOS.find((r) => r.v === h.resultado)?.l ?? h.resultado}</span>}
              </div>
            ))}
          </div>
        )}
      </div>

      {editar && (
        <ModalPlan vehiculo={vehiculo} plan={editar === "nuevo" ? null : editar}
          operaciones={operaciones} delegaciones={delegaciones} tecnicos={tecnicos} ultimaRev={ultimaRev}
          onClose={() => setEditar(null)} onDone={() => { setEditar(null); cargar(); }} />
      )}
      {registrar && (
        <ModalRegistrar plan={registrar} tecnicos={tecnicos}
          onClose={() => setRegistrar(null)} onDone={() => { setRegistrar(null); cargar(); }} />
      )}
    </div>
  );
}
