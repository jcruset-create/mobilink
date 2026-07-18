import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { listarIncidencias, resolverIncidencia, listarMontajesVehiculo, listarTiposIncidencia } from "../services/data";
import type { MontajeActual } from "../types";
import { Modal, Field, inputCls } from "../components/ui";
import ModalMontarDesdeFicha from "../components/ModalMontarDesdeFicha";

// ── Catálogos ────────────────────────────────────────────────
// Etiquetas por defecto (fallback si el catálogo tc_cat_tipos_incidencia
// aún no ha cargado o no incluye una clave concreta).
const PROBLEMA_LABELS_DEFAULT: Record<string, string> = {
  profundidad_baja: "Profundidad baja", presion_baja: "Presión baja", presion_alta: "Presión alta",
  pinchazo: "Pinchazo / pérdida de aire", objeto_clavado: "Objeto clavado", desgaste_irregular: "Desgaste irregular",
  desgaste_interior: "Desgaste interior", desgaste_exterior: "Desgaste exterior", diferencia_gemelos: "Diferencia entre gemelos",
  corte_grieta: "Corte o grieta", dano_flanco: "Daño en flanco", deformacion: "Deformación", valvula_danada: "Válvula dañada",
  no_coincide_ficha: "No coincide con la ficha", cambiado_posicion: "Cambiado de posición", no_identificado: "No identificado",
  necesita_sustitucion: "Necesita sustitución", necesita_reparacion: "Necesita reparación", necesita_equilibrado: "Necesita equilibrado",
  necesita_alineacion: "Necesita alineación", otra: "Otra incidencia",
};
// Etiquetas efectivas: se rellenan desde el catálogo al cargar la página.
let PROBLEMA_LABELS: Record<string, string> = { ...PROBLEMA_LABELS_DEFAULT };
const OPERACIONES: { key: string; label: string; sustitucion?: boolean }[] = [
  { key: "corregir_presion", label: "Corregir presión" },
  { key: "reparar_pinchazo", label: "Reparar pinchazo" },
  { key: "cambiar_valvula", label: "Cambiar válvula" },
  { key: "equilibrar", label: "Equilibrar" },
  { key: "solicitar_alineacion", label: "Solicitar alineación" },
  { key: "reapretar", label: "Reapretar rueda" },
  { key: "actualizar_neumatico", label: "Actualizar neumático instalado" },
  { key: "sustituir_neumatico", label: "Sustituir neumático", sustitucion: true },
  { key: "otra", label: "Otra operación" },
];
const ESTADO_LABELS: Record<string, string> = {
  detectada: "Detectada", pendiente_autorizacion: "Pendiente de autorización", autorizada: "Autorizada",
  planificada: "Planificada", pendiente_material: "Pendiente de material", pendiente_vehiculo: "Pendiente de vehículo",
  en_curso: "En curso", solucionada: "Solucionada", cancelada: "Cancelada", no_procede: "No procede",
};

type Gravedad = "leve" | "importante" | "critica";
const GRAV_PESO: Record<Gravedad, number> = { critica: 0, importante: 1, leve: 2 };
const GRAV_LABEL: Record<Gravedad, string> = { critica: "Crítica", importante: "Importante", leve: "Leve" };
const GRAV_BADGE: Record<Gravedad, string> = {
  critica: "bg-rose-500/20 text-rose-300 ring-1 ring-rose-500/40",
  importante: "bg-orange-500/20 text-orange-300 ring-1 ring-orange-500/40",
  leve: "bg-amber-500/20 text-amber-300 ring-1 ring-amber-500/40",
};
const GRAV_DOT: Record<Gravedad, string> = { critica: "bg-rose-500", importante: "bg-orange-500", leve: "bg-amber-400" };

type Problema = { id: string; tipo: string; estado: string };
type Incidencia = {
  id: string; vehiculo_id: string; posicion_id: string | null;
  gravedad: Gravedad; estado: string; detectada_at: string; foto_url: string | null;
  revision_id: string | null;
  matricula: string | null; cliente: string | null; base: string | null;
  posicionNombre: string | null; revisionFecha: string | null; revisionHora: string | null;
  revisionEstado: string | null; tecnico: string | null; problemas: Problema[];
};

function parse(row: any): Incidencia {
  const v = row.vehiculo, pos = row.posicion, rev = row.revision;
  const d = rev?.created_at ? new Date(rev.created_at) : null;
  return {
    id: row.id, vehiculo_id: row.vehiculo_id, posicion_id: row.posicion_id,
    gravedad: (row.gravedad ?? "leve") as Gravedad, estado: row.estado ?? "detectada",
    detectada_at: row.detectada_at ?? "", foto_url: row.foto_url ?? null, revision_id: row.revision_id ?? null,
    matricula: v?.matricula ?? null, cliente: v?.empresa?.nombre ?? null, base: v?.delegacion?.nombre ?? null,
    posicionNombre: pos?.nombre ?? pos?.codigo_posicion ?? null,
    revisionFecha: rev?.fecha_revision ?? null,
    revisionHora: d ? `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}` : null,
    revisionEstado: rev?.estado_revision ?? null, tecnico: rev?.tecnico?.nombre ?? null,
    problemas: (row.problemas ?? []).map((p: any) => ({ id: p.id, tipo: p.tipo, estado: p.estado })),
  };
}

const TABS = ["Pendientes", "Planificadas", "En curso", "Solucionadas"] as const;
const ESTADOS_TAB: string[][] = [
  ["detectada", "pendiente_autorizacion", "autorizada", "pendiente_material", "pendiente_vehiculo"],
  ["planificada"], ["en_curso"], ["solucionada"],
];

type Grupo = {
  clave: string; revisionId: string | null; vehiculoId: string;
  matricula: string | null; cliente: string | null; base: string | null; tecnico: string | null;
  fecha: string | null; hora: string | null; incidencias: Incidencia[]; gravedadMax: Gravedad;
};

function agrupar(deTab: Incidencia[]): Grupo[] {
  const map = new Map<string, Incidencia[]>();
  for (const i of deTab) {
    if (i.revisionEstado === "anulada") continue;
    const clave = i.revision_id ?? `sin-${i.vehiculo_id}`;
    (map.get(clave) ?? map.set(clave, []).get(clave)!).push(i);
  }
  const out: Grupo[] = [];
  for (const [clave, lista] of map) {
    lista.sort((a, b) => GRAV_PESO[a.gravedad] - GRAV_PESO[b.gravedad] || (a.posicionNombre ?? "").localeCompare(b.posicionNombre ?? ""));
    const p = lista[0];
    const gravedadMax = lista.reduce<Gravedad>((m, i) => (GRAV_PESO[i.gravedad] < GRAV_PESO[m] ? i.gravedad : m), "leve");
    out.push({
      clave, revisionId: p.revision_id, vehiculoId: p.vehiculo_id, matricula: p.matricula, cliente: p.cliente,
      base: p.base, tecnico: p.tecnico, fecha: p.revisionFecha, hora: p.revisionHora, incidencias: lista, gravedadMax,
    });
  }
  out.sort((a, b) => GRAV_PESO[a.gravedadMax] - GRAV_PESO[b.gravedadMax]
    || (b.fecha ?? "").localeCompare(a.fecha ?? "")
    || a.incidencias[0].detectada_at.localeCompare(b.incidencias[0].detectada_at));
  return out;
}

function fechaCorta(iso: string | null): string {
  if (!iso) return "Fecha no disponible";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "Fecha no disponible";
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
}
function diasTexto(iso: string): string {
  const d = new Date(iso); if (isNaN(d.getTime())) return "—";
  const n = Math.floor((Date.now() - d.getTime()) / 86400000);
  return n <= 0 ? "Hoy" : n === 1 ? "1 día" : `${n} días`;
}

export default function Incidencias() {
  const navigate = useNavigate();
  const [rows, setRows] = useState<Incidencia[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [tab, setTab] = useState(0);
  const [resolver, setResolver] = useState<Incidencia | null>(null);

  async function cargar() {
    setLoading(true); setError("");
    try {
      // Etiquetas configurables (no bloquea si falla: quedan las por defecto).
      try {
        const tipos = await listarTiposIncidencia(false);
        PROBLEMA_LABELS = { ...PROBLEMA_LABELS_DEFAULT, ...Object.fromEntries(tipos.map((t) => [t.clave, t.etiqueta])) };
      } catch { /* se mantienen las etiquetas por defecto */ }
      setRows((await listarIncidencias()).map(parse));
    }
    catch (e: any) { setError(e?.message || "Error"); }
    finally { setLoading(false); }
  }
  useEffect(() => { void cargar(); }, []);

  const deTab = useMemo(() => rows.filter((i) => ESTADOS_TAB[tab].includes(i.estado)), [rows, tab]);
  const grupos = useMemo(() => agrupar(deTab), [deTab]);
  const conteo = (t: number) => {
    const f = rows.filter((i) => ESTADOS_TAB[t].includes(i.estado) && i.revisionEstado !== "anulada");
    const claves = new Set(f.map((i) => i.revision_id ?? `sin-${i.vehiculo_id}`));
    return { rev: claves.size, inc: f.length };
  };

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <h1 className="text-lg font-black">Incidencias</h1>
      </div>

      <div className="mb-3 flex flex-wrap gap-2">
        {TABS.map((t, i) => {
          const c = conteo(i);
          return (
            <button key={t} onClick={() => setTab(i)}
              className={`rounded-lg px-3 py-1.5 text-sm font-bold ${tab === i ? "bg-sky-600 text-white" : "bg-slate-800 text-slate-300 hover:bg-slate-700"}`}>
              {t}{c.inc > 0 ? ` (${c.rev} rev · ${c.inc} inc)` : ""}
            </button>
          );
        })}
      </div>

      {loading ? <div className="text-slate-400">Cargando…</div>
        : error ? (
          <div className="rounded-lg bg-rose-500/10 p-4 text-sm text-rose-300">
            No se pudieron cargar las incidencias: {error}
            <button onClick={cargar} className="ml-3 rounded bg-slate-700 px-3 py-1 text-slate-200">Reintentar</button>
          </div>
        ) : grupos.length === 0 ? (
          <div className="rounded-lg bg-slate-800 p-8 text-center text-slate-500">
            {["No hay revisiones con incidencias pendientes.", "No hay soluciones planificadas.", "No hay trabajos en curso.", "No hay incidencias solucionadas."][tab]}
          </div>
        ) : (
          <div className="grid gap-3 lg:grid-cols-2">
            {grupos.map((g) => <TarjetaGrupo key={g.clave} grupo={g} tab={tab} onResolver={setResolver} onVer={() => navigate(`/tyrecontrol/vehiculos/${g.vehiculoId}`)} />)}
          </div>
        )}

      {resolver && (
        <ModalResolver incidencia={resolver} onClose={() => setResolver(null)} onDone={async () => { setResolver(null); await cargar(); }} />
      )}
    </div>
  );
}

function TarjetaGrupo({ grupo, tab, onResolver, onVer }: { grupo: Grupo; tab: number; onResolver: (i: Incidencia) => void; onVer: () => void }) {
  const g = grupo;
  const estadoGeneral = tab === 1 ? "PLANIFICADO" : tab === 2 ? "EN CURSO" : tab === 3 ? "SOLUCIONADO" : GRAV_LABEL[g.gravedadMax].toUpperCase();
  const badge = tab >= 1 ? "bg-slate-600 text-white" : GRAV_BADGE[g.gravedadMax];
  return (
    <div className="rounded-xl border border-slate-700 bg-slate-800 p-4">
      <div className="mb-3 flex items-start justify-between gap-2">
        <div>
          <div className="text-xl font-black">{g.matricula ?? "—"}</div>
          <div className="text-[12px] text-slate-400">Revisión: {fechaCorta(g.fecha)}{g.hora ? ` · ${g.hora}` : ""}</div>
          <div className="text-[12px] text-slate-400">{g.cliente ?? "Cliente no informado"} · {g.base ? `Base ${g.base}` : "Base no informada"}</div>
          {g.tecnico && <div className="text-[11px] text-slate-500">Técnico: {g.tecnico}</div>}
        </div>
        <div className="text-right">
          <span className={`inline-block rounded-full px-2.5 py-1 text-[11px] font-black ${badge}`}>{estadoGeneral}</span>
          <div className="mt-1 text-[11px] font-bold text-slate-400">{g.incidencias.length} {g.incidencias.length === 1 ? "incidencia" : "incidencias"}</div>
        </div>
      </div>
      <div className="space-y-2 border-t border-slate-700 pt-3">
        {g.incidencias.map((inc) => (
          <div key={inc.id} className="flex items-start gap-2">
            <span className={`mt-1 h-3 w-3 shrink-0 rounded-full ${GRAV_DOT[inc.gravedad]}`} />
            <div className="flex-1">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-bold">{inc.posicionNombre ?? "Incidencia general del vehículo"}</span>
                <span className="text-[10px] font-bold text-slate-500">{GRAV_LABEL[inc.gravedad]}</span>
              </div>
              <div className="text-[12px] text-slate-300">{inc.problemas.filter((p) => p.estado !== "solucionado").map((p) => PROBLEMA_LABELS[p.tipo] ?? p.tipo).join(" · ")}</div>
              <div className="text-[11px] text-slate-500">{ESTADO_LABELS[inc.estado] ?? inc.estado} · {diasTexto(inc.detectada_at)}{inc.foto_url ? " · 📷" : ""}</div>
            </div>
            {tab === 0 && inc.problemas.some((p) => p.estado !== "solucionado") && (
              <button onClick={() => onResolver(inc)} className="rounded bg-emerald-600 px-2.5 py-1 text-[12px] font-bold text-white hover:bg-emerald-500">Solucionar</button>
            )}
          </div>
        ))}
      </div>
      <div className="mt-3 flex gap-2 border-t border-slate-700 pt-3">
        <button onClick={onVer} className="flex-1 rounded-lg border border-slate-600 px-3 py-2 text-[13px] font-bold text-slate-200 hover:bg-slate-700">Ver revisión</button>
      </div>
    </div>
  );
}

// ── Modal de resolución ──────────────────────────────────────
function ModalResolver({ incidencia, onClose, onDone }: { incidencia: Incidencia; onClose: () => void; onDone: () => void }) {
  const abiertos = incidencia.problemas.filter((p) => p.estado !== "solucionado");
  const [sel, setSel] = useState<Set<string>>(new Set(abiertos.map((p) => p.id)));
  const [operacion, setOperacion] = useState<string>(() => sugerida(abiertos.map((p) => p.tipo)));
  const [presion, setPresion] = useState("");
  const [material, setMaterial] = useState("");
  const [resultado, setResultado] = useState("");
  const [obs, setObs] = useState("");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  const [montaje, setMontaje] = useState<MontajeActual | null>(null);
  const [modalSust, setModalSust] = useState(false);

  const esSust = OPERACIONES.find((o) => o.key === operacion)?.sustitucion;

  // Para la sustitución necesitamos el montaje actual de la posición.
  useEffect(() => {
    if (!esSust || !incidencia.posicion_id) { setMontaje(null); return; }
    listarMontajesVehiculo(incidencia.vehiculo_id)
      .then((ms) => setMontaje(ms.find((m) => m.posicion_id === incidencia.posicion_id) ?? null))
      .catch(() => setMontaje(null));
  }, [esSust, incidencia.vehiculo_id, incidencia.posicion_id]);

  async function marcarResuelta(tipo: string, medicionFinal?: Record<string, unknown>) {
    await resolverIncidencia({
      incidenciaId: incidencia.id, problemaIds: [...sel], tipo,
      medicionFinal: medicionFinal ?? null,
      material: material.trim() || null, resultado: resultado.trim() || null, observaciones: obs.trim() || null,
    });
  }

  async function guardar() {
    if (sel.size === 0) { setMsg("Selecciona al menos un problema"); return; }
    setSaving(true); setMsg("");
    try {
      const medicion = presion.trim() ? { presion_bar: parseFloat(presion.replace(",", ".")) } : undefined;
      await marcarResuelta(operacion, medicion);
      onDone();
    } catch (e: any) { setMsg(e?.message || "Error"); setSaving(false); }
  }

  return (
    <>
      <Modal title={`Resolver · ${incidencia.posicionNombre ?? "vehículo"}`} onClose={onClose}
        footer={
          <div className="flex justify-between">
            <span className="text-[12px] text-rose-300">{msg}</span>
            <div className="flex gap-2">
              <button onClick={onClose} className="rounded-lg border border-slate-600 px-4 py-2 text-sm text-slate-200">Cancelar</button>
              {esSust ? (
                <button
                  onClick={() => montaje ? setModalSust(true) : setMsg("Esta posición no tiene neumático montado")}
                  className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">
                  Sustituir neumático…
                </button>
              ) : (
                <button onClick={guardar} disabled={saving} className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">
                  {saving ? "Guardando…" : sel.size === abiertos.length ? "Resolver incidencia" : `Resolver ${sel.size} de ${abiertos.length}`}
                </button>
              )}
            </div>
          </div>
        }>
        <div className="space-y-3">
          <div>
            <div className="mb-1 text-[11px] font-bold uppercase text-slate-400">Problemas a resolver</div>
            {abiertos.map((p) => (
              <label key={p.id} className="flex items-center gap-2 py-1 text-sm text-slate-200">
                <input type="checkbox" checked={sel.has(p.id)} onChange={(e) => setSel((s) => { const n = new Set(s); e.target.checked ? n.add(p.id) : n.delete(p.id); return n; })} />
                {PROBLEMA_LABELS[p.tipo] ?? p.tipo}
              </label>
            ))}
          </div>
          <Field label="Operación">
            <select className={inputCls} value={operacion} onChange={(e) => setOperacion(e.target.value)}>
              {OPERACIONES.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
            </select>
          </Field>
          {esSust ? (
            <div className="rounded-lg bg-slate-800 p-3 text-[12px] text-slate-400">
              {montaje ? "Al pulsar «Sustituir neumático…» se abre el proceso de sustitución (desmonta el actual y monta el nuevo). Al terminar, la incidencia queda solucionada." : "Cargando montaje de la posición…"}
            </div>
          ) : (
            <>
              {operacion === "corregir_presion" || operacion === "reparar_pinchazo" ? (
                <Field label="Presión final (bar)"><input className={inputCls} value={presion} onChange={(e) => setPresion(e.target.value)} placeholder="8.5" /></Field>
              ) : null}
              {operacion === "reparar_pinchazo" ? (
                <Field label="Material utilizado"><input className={inputCls} value={material} onChange={(e) => setMaterial(e.target.value)} /></Field>
              ) : null}
              <Field label={operacion === "otra" ? "Descripción / resultado" : "Resultado"}><input className={inputCls} value={resultado} onChange={(e) => setResultado(e.target.value)} /></Field>
              <Field label="Observación"><input className={inputCls} value={obs} onChange={(e) => setObs(e.target.value)} /></Field>
            </>
          )}
        </div>
      </Modal>

      {modalSust && montaje && incidencia.posicion_id && (
        <ModalMontarDesdeFicha
          posicionNombre={incidencia.posicionNombre ?? "posición"}
          vehiculoId={incidencia.vehiculo_id}
          empresaId={montaje.empresa_id}
          posicionId={incidencia.posicion_id}
          montajeActualId={montaje.id}
          medidaActual={montaje.neumatico?.medida}
          onClose={() => setModalSust(false)}
          onDone={async () => {
            // Hecha la sustitución (montaje cambiado): marcamos la incidencia.
            try { await marcarResuelta("sustituir_neumatico"); } catch { /* la sustitución ya se hizo */ }
            setModalSust(false);
            onDone();
          }}
        />
      )}
    </>
  );
}

function sugerida(tipos: string[]): string {
  for (const t of tipos) {
    if (t === "presion_baja" || t === "presion_alta") return "corregir_presion";
    if (t === "pinchazo" || t === "objeto_clavado") return "reparar_pinchazo";
    if (t === "valvula_danada") return "cambiar_valvula";
    if (t === "necesita_sustitucion" || t === "profundidad_baja" || t === "dano_flanco" || t === "deformacion") return "sustituir_neumatico";
    if (t === "necesita_equilibrado" || t === "diferencia_gemelos") return "equilibrar";
    if (t === "necesita_alineacion" || t.startsWith("desgaste")) return "solicitar_alineacion";
  }
  return "otra";
}
