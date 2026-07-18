import { useEffect, useMemo, useState } from "react";
import {
  Ruler, ArrowDown, ArrowUp, CircleDot, Pin, Waves, ArrowLeftToLine, ArrowRightToLine,
  ArrowRightLeft, Scissors, AlertTriangle, Triangle, Wind, ClipboardCheck, Replace, HelpCircle,
  RefreshCw, Wrench, Scale, GitCommitHorizontal, MoreHorizontal, AlertCircle, Gauge, Thermometer,
  Droplet, Snowflake, Flame, Settings, type LucideIcon,
} from "lucide-react";
import {
  listarTiposIncidencia, crearTipoIncidencia, actualizarTipoIncidencia, eliminarTipoIncidencia,
  listarMotivosPendiente, crearMotivoPendiente, actualizarMotivoPendiente, eliminarMotivoPendiente,
} from "../services/data";
import type { TipoIncidencia, GravedadIncidencia, MotivoPendiente } from "../types";
import { Modal, Field, inputCls, TableWrap, tdCls, thCls } from "../components/ui";

// Registro de iconos: la clave (string) se guarda en BD y la comparten web y APK.
const ICONOS: Record<string, LucideIcon> = {
  straighten: Ruler, south: ArrowDown, north: ArrowUp, tire_repair: CircleDot, push_pin: Pin,
  blur_linear: Waves, align_horizontal_left: ArrowLeftToLine, align_horizontal_right: ArrowRightToLine,
  compare_arrows: ArrowRightLeft, content_cut: Scissors, report_gmailerrorred: AlertTriangle,
  change_history: Triangle, air: Wind, rule: ClipboardCheck, swap_horiz: Replace, help_outline: HelpCircle,
  autorenew: RefreshCw, build: Wrench, balance: Scale, linear_scale: GitCommitHorizontal, more_horiz: MoreHorizontal,
  // extras disponibles para nuevos tipos
  gauge: Gauge, thermometer: Thermometer, droplet: Droplet, snowflake: Snowflake, flame: Flame, settings: Settings,
};
const ICONOS_KEYS = Object.keys(ICONOS);
function IconoTipo({ nombre, className }: { nombre: string | null; className?: string }) {
  const Ico = (nombre && ICONOS[nombre]) || AlertCircle;
  return <Ico className={className ?? "h-4 w-4"} />;
}

const GRAVEDADES: { key: GravedadIncidencia; label: string; badge: string }[] = [
  { key: "leve", label: "Leve", badge: "bg-amber-500/20 text-amber-300" },
  { key: "importante", label: "Importante", badge: "bg-orange-500/20 text-orange-300" },
  { key: "critica", label: "Crítica", badge: "bg-rose-500/20 text-rose-300" },
];
const GRAV_BADGE = Object.fromEntries(GRAVEDADES.map((g) => [g.key, g.badge])) as Record<GravedadIncidencia, string>;
const GRAV_LABEL = Object.fromEntries(GRAVEDADES.map((g) => [g.key, g.label])) as Record<GravedadIncidencia, string>;

// Operaciones que se pueden proponer al resolver (mismo catálogo que Incidencias.tsx).
const OPERACIONES: { key: string; label: string }[] = [
  { key: "", label: "— Ninguna —" },
  { key: "corregir_presion", label: "Corregir presión" },
  { key: "reparar_pinchazo", label: "Reparar pinchazo" },
  { key: "cambiar_valvula", label: "Cambiar válvula" },
  { key: "equilibrar", label: "Equilibrar" },
  { key: "solicitar_alineacion", label: "Solicitar alineación" },
  { key: "reapretar", label: "Reapretar rueda" },
  { key: "actualizar_neumatico", label: "Actualizar neumático instalado" },
  { key: "sustituir_neumatico", label: "Sustituir neumático" },
  { key: "otra", label: "Otra operación" },
];
const OP_LABEL = Object.fromEntries(OPERACIONES.map((o) => [o.key, o.label]));

type Draft = {
  id: string | null; clave: string; etiqueta: string; icono: string;
  gravedad_sugerida: GravedadIncidencia; operacion_sugerida: string; orden: number; es_sistema: boolean;
};
const VACIO: Draft = { id: null, clave: "", etiqueta: "", icono: "more_horiz", gravedad_sugerida: "leve", operacion_sugerida: "", orden: 0, es_sistema: false };

// Genera una clave slug a partir de la etiqueta (solo para tipos nuevos).
function slugify(s: string): string {
  return s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40);
}

export default function ConfiguracionIncidencias() {
  const [tab, setTab] = useState<"tipos" | "motivos">("tipos");
  return (
    <div>
      <div className="mb-4 flex gap-2">
        <button onClick={() => setTab("tipos")}
          className={`rounded-lg px-3 py-1.5 text-sm font-bold ${tab === "tipos" ? "bg-sky-600 text-white" : "bg-slate-800 text-slate-300 hover:bg-slate-700"}`}>
          Tipos de incidencia
        </button>
        <button onClick={() => setTab("motivos")}
          className={`rounded-lg px-3 py-1.5 text-sm font-bold ${tab === "motivos" ? "bg-sky-600 text-white" : "bg-slate-800 text-slate-300 hover:bg-slate-700"}`}>
          Motivos pendientes
        </button>
      </div>
      {tab === "tipos" ? <PanelTipos /> : <PanelMotivos />}
    </div>
  );
}

function PanelTipos() {
  const [items, setItems] = useState<TipoIncidencia[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState("");
  const [modal, setModal] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [claveTocada, setClaveTocada] = useState(false);

  async function cargar() {
    setLoading(true);
    try { setItems(await listarTiposIncidencia(false)); }
    catch (e: any) { setMsg(e?.message || "Error"); } finally { setLoading(false); }
  }
  useEffect(() => { void cargar(); }, []);

  const nuevoOrden = useMemo(() => (items.reduce((m, i) => Math.max(m, i.orden), 0) + 10), [items]);

  function abrirNuevo() { setClaveTocada(false); setModal({ ...VACIO, orden: nuevoOrden }); }
  function abrirEditar(t: TipoIncidencia) {
    setClaveTocada(true);
    setModal({
      id: t.id, clave: t.clave, etiqueta: t.etiqueta, icono: t.icono ?? "more_horiz",
      gravedad_sugerida: t.gravedad_sugerida, operacion_sugerida: t.operacion_sugerida ?? "",
      orden: t.orden, es_sistema: t.es_sistema,
    });
  }

  async function guardar() {
    if (!modal) return;
    const etiqueta = modal.etiqueta.trim();
    const clave = (modal.clave || slugify(etiqueta)).trim();
    if (!etiqueta) { setMsg("La etiqueta es obligatoria."); return; }
    if (!clave) { setMsg("No se pudo generar una clave; escribe una manualmente."); return; }
    setSaving(true); setMsg("");
    try {
      const payload = {
        clave, etiqueta, icono: modal.icono || null,
        gravedad_sugerida: modal.gravedad_sugerida,
        operacion_sugerida: modal.operacion_sugerida || null, orden: Number(modal.orden) || 0,
      };
      if (modal.id) await actualizarTipoIncidencia(modal.id, payload);
      else await crearTipoIncidencia(payload);
      setModal(null); setMsg("✔ Guardado"); await cargar();
    } catch (e: any) {
      setMsg(/duplicate|unique/i.test(e?.message || "") ? "Ya existe un tipo con esa clave." : (e?.message || "Error"));
    } finally { setSaving(false); }
  }

  async function alternarActivo(t: TipoIncidencia) {
    try {
      if (t.activo) { await eliminarTipoIncidencia(t.id); }
      else { await actualizarTipoIncidencia(t.id, { activo: true } as any); }
      await cargar();
    } catch (e: any) { setMsg(e?.message || "Error"); }
  }

  return (
    <div>
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-black">Tipos de incidencia</h1>
        <button onClick={abrirNuevo} className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-500">+ Nuevo tipo</button>
      </div>
      <p className="mb-3 text-[12px] text-slate-400">
        Los tipos que el técnico puede marcar en una incidencia durante la revisión (web y APK). Desactivar uno
        lo oculta en nuevas incidencias, pero no altera las ya registradas.
      </p>
      {msg && <div className={`mb-3 text-sm ${msg.startsWith("✔") ? "text-emerald-400" : "text-red-300"}`}>{msg}</div>}

      <TableWrap>
        <thead className="bg-slate-900"><tr>
          <th className={thCls}>Orden</th><th className={thCls}>Tipo</th><th className={thCls}>Gravedad sugerida</th>
          <th className={thCls}>Operación sugerida</th><th className={thCls}>Estado</th><th className={thCls}>Acciones</th>
        </tr></thead>
        <tbody>
          {loading ? <tr><td className={tdCls + " text-slate-500"} colSpan={6}>Cargando…</td></tr>
          : items.length === 0 ? <tr><td className={tdCls + " text-slate-500"} colSpan={6}>Sin tipos.</td></tr>
          : items.map((t) => (
            <tr key={t.id} className={`border-t border-slate-700/60 ${t.activo ? "" : "opacity-50"}`}>
              <td className={tdCls + " text-slate-500"}>{t.orden}</td>
              <td className={tdCls}>
                <div className="flex items-center gap-2 font-bold">
                  <IconoTipo nombre={t.icono} className="h-4 w-4 text-slate-300" />
                  {t.etiqueta}
                  {t.es_sistema && <span className="rounded bg-slate-700 px-1.5 py-0.5 text-[10px] font-bold text-slate-300">sistema</span>}
                </div>
                <div className="text-[11px] text-slate-500">{t.clave}</div>
              </td>
              <td className={tdCls}><span className={`rounded-full px-2 py-0.5 text-xs font-bold ${GRAV_BADGE[t.gravedad_sugerida]}`}>{GRAV_LABEL[t.gravedad_sugerida]}</span></td>
              <td className={tdCls + " text-slate-400"}>{OP_LABEL[t.operacion_sugerida ?? ""] ?? t.operacion_sugerida ?? "—"}</td>
              <td className={tdCls}>
                {t.activo
                  ? <span className="rounded-full bg-emerald-500/20 px-2 py-0.5 text-xs font-bold text-emerald-300">Activo</span>
                  : <span className="rounded-full bg-slate-600/40 px-2 py-0.5 text-xs font-bold text-slate-400">Inactivo</span>}
              </td>
              <td className={tdCls}>
                <div className="flex gap-3">
                  <button onClick={() => abrirEditar(t)} className="text-sky-400 hover:underline">Editar</button>
                  <button onClick={() => alternarActivo(t)} className={t.activo ? "text-rose-400 hover:underline" : "text-emerald-400 hover:underline"}>
                    {t.activo ? "Desactivar" : "Activar"}
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </TableWrap>

      {modal && (
        <Modal title={modal.id ? "Editar tipo de incidencia" : "Nuevo tipo de incidencia"} onClose={() => setModal(null)}
          footer={<div className="flex justify-end gap-2">
            <button onClick={() => setModal(null)} className="rounded-lg border border-slate-600 px-4 py-2 text-sm text-slate-200">Cancelar</button>
            <button onClick={guardar} disabled={saving} className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">
              {saving ? "Guardando…" : "Guardar"}
            </button>
          </div>}>
          <div className="space-y-3">
            <Field label="Etiqueta *">
              <input className={inputCls} value={modal.etiqueta} autoFocus
                onChange={(e) => setModal((m) => m && { ...m, etiqueta: e.target.value, clave: claveTocada ? m.clave : slugify(e.target.value) })}
                placeholder="Ej. Desgaste en hombro" />
            </Field>
            <Field label="Clave (identificador estable)">
              <input className={`${inputCls} ${modal.es_sistema ? "opacity-60" : ""}`} value={modal.clave} disabled={modal.es_sistema}
                onChange={(e) => { setClaveTocada(true); setModal((m) => m && { ...m, clave: slugify(e.target.value) }); }}
                placeholder="desgaste_hombro" />
              <span className="mt-1 block text-[11px] text-slate-500">
                {modal.es_sistema ? "Tipo de sistema: la clave no se puede cambiar." : "Se genera sola desde la etiqueta. Solo letras, números y guion bajo."}
              </span>
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Gravedad sugerida">
                <select className={inputCls} value={modal.gravedad_sugerida} onChange={(e) => setModal((m) => m && { ...m, gravedad_sugerida: e.target.value as GravedadIncidencia })}>
                  {GRAVEDADES.map((g) => <option key={g.key} value={g.key}>{g.label}</option>)}
                </select>
              </Field>
              <Field label="Orden">
                <input type="number" className={inputCls} value={modal.orden} onChange={(e) => setModal((m) => m && { ...m, orden: Number(e.target.value) })} />
              </Field>
            </div>
            <Field label="Operación sugerida al resolver">
              <select className={inputCls} value={modal.operacion_sugerida} onChange={(e) => setModal((m) => m && { ...m, operacion_sugerida: e.target.value })}>
                {OPERACIONES.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
              </select>
            </Field>
            <Field label="Icono">
              <div className="flex flex-wrap gap-1.5 rounded-lg border border-slate-700 bg-slate-900/50 p-2">
                {ICONOS_KEYS.map((k) => {
                  const sel = modal.icono === k;
                  return (
                    <button key={k} type="button" onClick={() => setModal((m) => m && { ...m, icono: k })}
                      title={k}
                      className={`flex h-9 w-9 items-center justify-center rounded-lg border ${sel ? "border-sky-500 bg-sky-600/30 text-sky-200" : "border-slate-700 text-slate-400 hover:bg-slate-800"}`}>
                      <IconoTipo nombre={k} className="h-4 w-4" />
                    </button>
                  );
                })}
              </div>
            </Field>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ── Panel: motivos por los que una incidencia queda pendiente ─
type DraftMotivo = { id: string | null; clave: string; etiqueta: string; orden: number; es_sistema: boolean };
const VACIO_MOTIVO: DraftMotivo = { id: null, clave: "", etiqueta: "", orden: 0, es_sistema: false };

function PanelMotivos() {
  const [items, setItems] = useState<MotivoPendiente[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState("");
  const [modal, setModal] = useState<DraftMotivo | null>(null);
  const [saving, setSaving] = useState(false);
  const [claveTocada, setClaveTocada] = useState(false);

  async function cargar() {
    setLoading(true);
    try { setItems(await listarMotivosPendiente(false)); }
    catch (e: any) { setMsg(e?.message || "Error"); } finally { setLoading(false); }
  }
  useEffect(() => { void cargar(); }, []);

  const nuevoOrden = useMemo(() => (items.reduce((m, i) => Math.max(m, i.orden), 0) + 10), [items]);

  function abrirNuevo() { setClaveTocada(false); setModal({ ...VACIO_MOTIVO, orden: nuevoOrden }); }
  function abrirEditar(m: MotivoPendiente) {
    setClaveTocada(true);
    setModal({ id: m.id, clave: m.clave, etiqueta: m.etiqueta, orden: m.orden, es_sistema: m.es_sistema });
  }

  async function guardar() {
    if (!modal) return;
    const etiqueta = modal.etiqueta.trim();
    const clave = (modal.clave || slugify(etiqueta)).trim();
    if (!etiqueta) { setMsg("La etiqueta es obligatoria."); return; }
    if (!clave) { setMsg("No se pudo generar una clave; escribe una manualmente."); return; }
    setSaving(true); setMsg("");
    try {
      const payload = { clave, etiqueta, orden: Number(modal.orden) || 0 };
      if (modal.id) await actualizarMotivoPendiente(modal.id, payload);
      else await crearMotivoPendiente(payload);
      setModal(null); setMsg("✔ Guardado"); await cargar();
    } catch (e: any) {
      setMsg(/duplicate|unique/i.test(e?.message || "") ? "Ya existe un motivo con esa clave." : (e?.message || "Error"));
    } finally { setSaving(false); }
  }

  async function alternarActivo(m: MotivoPendiente) {
    try {
      if (m.activo) await eliminarMotivoPendiente(m.id);
      else await actualizarMotivoPendiente(m.id, { activo: true });
      await cargar();
    } catch (e: any) { setMsg(e?.message || "Error"); }
  }

  return (
    <div>
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-black">Motivos pendientes</h1>
        <button onClick={abrirNuevo} className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-500">+ Nuevo motivo</button>
      </div>
      <p className="mb-3 text-[12px] text-slate-400">
        Los motivos que el técnico puede elegir al dejar una incidencia «pendiente» (pantalla de la APK). Desactivar
        uno lo oculta en nuevas incidencias, pero no altera las ya registradas.
      </p>
      {msg && <div className={`mb-3 text-sm ${msg.startsWith("✔") ? "text-emerald-400" : "text-red-300"}`}>{msg}</div>}

      <TableWrap>
        <thead className="bg-slate-900"><tr>
          <th className={thCls}>Orden</th><th className={thCls}>Motivo</th><th className={thCls}>Estado</th><th className={thCls}>Acciones</th>
        </tr></thead>
        <tbody>
          {loading ? <tr><td className={tdCls + " text-slate-500"} colSpan={4}>Cargando…</td></tr>
          : items.length === 0 ? <tr><td className={tdCls + " text-slate-500"} colSpan={4}>Sin motivos.</td></tr>
          : items.map((m) => (
            <tr key={m.id} className={`border-t border-slate-700/60 ${m.activo ? "" : "opacity-50"}`}>
              <td className={tdCls + " text-slate-500"}>{m.orden}</td>
              <td className={tdCls}>
                <div className="flex items-center gap-2 font-bold">
                  {m.etiqueta}
                  {m.es_sistema && <span className="rounded bg-slate-700 px-1.5 py-0.5 text-[10px] font-bold text-slate-300">sistema</span>}
                </div>
                <div className="text-[11px] text-slate-500">{m.clave}</div>
              </td>
              <td className={tdCls}>
                {m.activo
                  ? <span className="rounded-full bg-emerald-500/20 px-2 py-0.5 text-xs font-bold text-emerald-300">Activo</span>
                  : <span className="rounded-full bg-slate-600/40 px-2 py-0.5 text-xs font-bold text-slate-400">Inactivo</span>}
              </td>
              <td className={tdCls}>
                <div className="flex gap-3">
                  <button onClick={() => abrirEditar(m)} className="text-sky-400 hover:underline">Editar</button>
                  <button onClick={() => alternarActivo(m)} className={m.activo ? "text-rose-400 hover:underline" : "text-emerald-400 hover:underline"}>
                    {m.activo ? "Desactivar" : "Activar"}
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </TableWrap>

      {modal && (
        <Modal title={modal.id ? "Editar motivo" : "Nuevo motivo"} onClose={() => setModal(null)}
          footer={<div className="flex justify-end gap-2">
            <button onClick={() => setModal(null)} className="rounded-lg border border-slate-600 px-4 py-2 text-sm text-slate-200">Cancelar</button>
            <button onClick={guardar} disabled={saving} className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">
              {saving ? "Guardando…" : "Guardar"}
            </button>
          </div>}>
          <div className="space-y-3">
            <Field label="Etiqueta *">
              <input className={inputCls} value={modal.etiqueta} autoFocus
                onChange={(e) => setModal((m) => m && { ...m, etiqueta: e.target.value, clave: claveTocada ? m.clave : slugify(e.target.value) })}
                placeholder="Ej. Pendiente de recambio" />
            </Field>
            <Field label="Clave (identificador estable)">
              <input className={`${inputCls} ${modal.es_sistema ? "opacity-60" : ""}`} value={modal.clave} disabled={modal.es_sistema}
                onChange={(e) => { setClaveTocada(true); setModal((m) => m && { ...m, clave: slugify(e.target.value) }); }}
                placeholder="pendiente_recambio" />
              <span className="mt-1 block text-[11px] text-slate-500">
                {modal.es_sistema ? "Motivo de sistema: la clave no se puede cambiar." : "Se genera sola desde la etiqueta. Solo letras, números y guion bajo."}
              </span>
            </Field>
            <Field label="Orden">
              <input type="number" className={inputCls} value={modal.orden} onChange={(e) => setModal((m) => m && { ...m, orden: Number(e.target.value) })} />
            </Field>
          </div>
        </Modal>
      )}
    </div>
  );
}
