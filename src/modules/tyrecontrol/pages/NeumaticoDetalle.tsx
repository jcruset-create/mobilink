import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { obtenerNeumatico, montajeActualDeNeumatico, repararNeumatico, descartarNeumaticoStd, actualizarNeumatico, listarFotosCatalogoPorModelo, claveModeloCatalogo, listarOperaciones, medicionesNeumatico } from "../services/data";
import type { MedicionNeumatico } from "../services/data";
import type { MontajeActual, Neumatico, OperacionNeumatico } from "../types";
import { ESTADO_NEUMATICO_LABELS, TIPO_OPERACION_LABELS, MOTIVO_OPERACION_LABELS } from "../types";
import { Modal, Field, inputCls } from "../components/ui";
import { useTyreAuth } from "../contexts/TyreAuthContext";

type CamposEditables = "dot" | "rfid_epc" | "marca" | "modelo" | "medida" | "indice_carga" | "indice_velocidad" | "proveedor" | "fecha_compra" | "coste_compra";

// Un punto en la línea temporal del neumático.
interface EventoNeumatico { ts: number; fecha: string; icono: string; titulo: string; detalle: string; km: number | null; }

const ICONO_OPERACION: Record<string, string> = {
  montaje: "▲", desmontaje: "▼", sustitucion: "♻", rotacion: "⇄", reparacion: "🔧",
  descarte: "🗑", entrada_almacen: "📥", salida_almacen: "📤", revision_vehiculo: "✓",
};

function fmtFechaHora(fecha?: string | null, createdAt?: string | null): string {
  const f = fecha || (createdAt ? createdAt.slice(0, 10) : "");
  const h = createdAt ? new Date(createdAt).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" }) : "";
  return h ? `${f} · ${h}` : f;
}

export default function NeumaticoDetalle() {
  const { perfil } = useTyreAuth();
  const puedeEditar = !!(perfil?.es_superadmin || perfil?.rol === "administrador");
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const [n, setN] = useState<Neumatico | null>(null);
  const [montaje, setMontaje] = useState<MontajeActual | null>(null);
  const [operaciones, setOperaciones] = useState<OperacionNeumatico[]>([]);
  const [mediciones, setMediciones] = useState<MedicionNeumatico[]>([]);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  const [editando, setEditando] = useState(false);
  const [form, setForm] = useState<Record<CamposEditables, string>>({
    dot: "", rfid_epc: "", marca: "", modelo: "", medida: "", indice_carga: "", indice_velocidad: "",
    proveedor: "", fecha_compra: "", coste_compra: "",
  });

  function abrirEdicion() {
    if (!n) return;
    setForm({
      dot: n.dot ?? "", rfid_epc: n.rfid_epc ?? "", marca: n.marca ?? "", modelo: n.modelo ?? "",
      medida: n.medida ?? "", indice_carga: n.indice_carga ?? "", indice_velocidad: n.indice_velocidad ?? "",
      proveedor: n.proveedor ?? "", fecha_compra: n.fecha_compra ?? "",
      coste_compra: n.coste_compra != null ? String(n.coste_compra) : "",
    });
    setMsg(""); setEditando(true);
  }

  async function guardarEdicion() {
    setSaving(true); setMsg("");
    try {
      await actualizarNeumatico(id, {
        dot: form.dot.trim() || null, rfid_epc: form.rfid_epc.trim() || null,
        marca: form.marca.trim() || null, modelo: form.modelo.trim() || null, medida: form.medida.trim() || null,
        indice_carga: form.indice_carga.trim() || null, indice_velocidad: form.indice_velocidad.trim() || null,
        proveedor: form.proveedor.trim() || null, fecha_compra: form.fecha_compra || null,
        coste_compra: form.coste_compra.trim() === "" ? null : Number(form.coste_compra),
      });
      setEditando(false); await cargar();
    } catch (e: any) { setMsg(e?.message || "Error al guardar"); } finally { setSaving(false); }
  }

  const [fotoModelo, setFotoModelo] = useState<string | null>(null);

  async function cargar() {
    const neu = await obtenerNeumatico(id);
    setN(neu);
    setMontaje(await montajeActualDeNeumatico(id));
    const [ops, meds] = await Promise.all([
      listarOperaciones({ neumaticoId: id }).catch(() => [] as OperacionNeumatico[]),
      medicionesNeumatico(id).catch(() => [] as MedicionNeumatico[]),
    ]);
    setOperaciones(ops);
    setMediciones(meds);

    // Foto heredada del modelo de catálogo (se sube una vez en Catálogo de
    // neumáticos y sirve para todos los neumáticos de esa marca+modelo).
    if (neu?.marca && neu?.modelo) {
      const fotos = await listarFotosCatalogoPorModelo().catch(() => ({} as Record<string, string>));
      setFotoModelo(fotos[claveModeloCatalogo(neu.marca, neu.modelo)] ?? null);
    } else {
      setFotoModelo(null);
    }
  }
  useEffect(() => { void cargar(); /* eslint-disable-next-line */ }, [id]);

  async function reparar() {
    const motivo = window.prompt("Motivo de la reparación:", "reparacion");
    if (!motivo) return;
    setSaving(true); setMsg("");
    try { await repararNeumatico(id, motivo); await cargar(); }
    catch (e: any) { setMsg(e?.message || "Error"); } finally { setSaving(false); }
  }

  async function descartar() {
    if (!window.confirm("¿Confirmas el descarte definitivo de este neumático?")) return;
    const motivo = window.prompt("Motivo del descarte:", "fin_vida");
    if (!motivo) return;
    setSaving(true); setMsg("");
    try { await descartarNeumaticoStd(id, motivo); await cargar(); }
    catch (e: any) { setMsg(e?.message || "Error"); } finally { setSaving(false); }
  }

  // Línea temporal: operaciones (montaje inicial, rotaciones, reparaciones,
  // sustituciones, descartes, entradas/salidas de almacén) + mediciones de
  // revisión + alta del neumático con su profundidad inicial. Todo cronológico.
  const eventos = useMemo<EventoNeumatico[]>(() => {
    const ev: EventoNeumatico[] = [];

    for (const op of operaciones) {
      const posO = op.posicion_origen?.codigo_posicion;
      const posD = op.posicion_destino?.codigo_posicion;
      const ruta = posO && posD ? `${posO} → ${posD}` : posD ? `→ ${posD}` : posO ?? "";
      const detalle = [op.vehiculo?.matricula, ruta, op.motivo ? MOTIVO_OPERACION_LABELS[op.motivo] : "", op.observaciones].filter(Boolean).join(" · ");
      ev.push({
        ts: new Date(op.created_at ?? op.fecha_operacion ?? 0).getTime(),
        fecha: fmtFechaHora(op.fecha_operacion, op.created_at),
        icono: ICONO_OPERACION[op.tipo_operacion] ?? "•",
        titulo: TIPO_OPERACION_LABELS[op.tipo_operacion] ?? op.tipo_operacion,
        detalle,
        km: op.km_vehiculo ?? null,
      });
    }

    for (const m of mediciones) {
      const detalle = [m.posicion, m.profundidad_mm != null ? `${m.profundidad_mm} mm` : "", m.presion_bar != null ? `${m.presion_bar} bar` : "", m.estado_visual].filter(Boolean).join(" · ");
      ev.push({
        ts: new Date(m.created_at ?? m.fecha_revision ?? 0).getTime(),
        fecha: fmtFechaHora(m.fecha_revision, m.created_at),
        icono: "📏",
        titulo: "Revisión",
        detalle,
        km: m.km_vehiculo ?? null,
      });
    }

    if (n?.fecha_compra || n?.created_at) {
      const prof = n?.profundidad_actual_mm;
      ev.push({
        ts: new Date(n?.fecha_compra ?? n?.created_at ?? 0).getTime(),
        fecha: fmtFechaHora(n?.fecha_compra, n?.created_at),
        icono: "🏭",
        titulo: "Alta del neumático",
        detalle: [n?.marca, n?.modelo, prof != null ? `${prof} mm iniciales` : ""].filter(Boolean).join(" · "),
        km: null,
      });
    }

    return ev.sort((a, b) => b.ts - a.ts);
  }, [operaciones, mediciones, n]);

  const dato = (l: string, v?: string | null) => (
    <div><div className="text-[10px] text-slate-400">{l}</div><div className="text-sm text-slate-200">{v || "—"}</div></div>
  );
  if (!n) return <div className="text-slate-400">Cargando…</div>;

  return (
    <div>
      <div className="mb-3 flex items-center gap-2">
        <button onClick={() => navigate("/tyrecontrol/neumaticos")} className="rounded bg-slate-800 px-3 py-1 text-[12px] text-slate-200">← Neumáticos</button>
        <h1 className="text-lg font-black">{n.numero_interno ?? n.codigo_interno ?? n.numero_serie ?? "Neumático"}</h1>
        <span className="rounded-full bg-slate-700 px-2 py-0.5 text-xs font-bold text-slate-200">{ESTADO_NEUMATICO_LABELS[n.estado]}</span>
        <div className="ml-auto flex gap-2">
          {puedeEditar && <button onClick={abrirEdicion} className="rounded bg-sky-600 px-3 py-1 text-[12px] font-bold text-white">Editar datos</button>}
          {n.estado !== "montado" && n.estado !== "descartado" && (
            <>
              {n.estado !== "reparacion" && <button onClick={reparar} disabled={saving} className="rounded bg-purple-600 px-3 py-1 text-[12px] font-bold text-white disabled:opacity-50">Enviar a reparación</button>}
              <button onClick={descartar} disabled={saving} className="rounded bg-rose-600 px-3 py-1 text-[12px] font-bold text-white disabled:opacity-50">Descartar</button>
            </>
          )}
        </div>
      </div>
      {msg && <div className="mb-3 text-sm text-red-300">{msg}</div>}

      <div className="grid gap-3 lg:grid-cols-[220px_1fr_1fr]">
        <div className="rounded-lg bg-slate-800 p-3">
          <div className="mb-2 text-[11px] font-bold uppercase text-slate-400">Modelo</div>
          {fotoModelo ? (
            <a href={fotoModelo} target="_blank" rel="noreferrer" title="Ver a tamaño completo">
              <img src={fotoModelo} alt={`${n.marca ?? ""} ${n.modelo ?? ""}`.trim()} className="mx-auto max-h-44 rounded bg-slate-950 object-contain" />
            </a>
          ) : (
            <div className="flex h-32 items-center justify-center rounded border border-dashed border-slate-700 px-3 text-center text-[11px] text-slate-500">
              Sin foto de modelo. Súbela en Catálogo de neumáticos y la heredan todos los neumáticos de ese modelo.
            </div>
          )}
          <div className="mt-1 text-center text-[11px] text-slate-400">{[n.marca, n.modelo].filter(Boolean).join(" ") || "—"}</div>
        </div>
        <div className="rounded-lg bg-slate-800 p-3">
          <div className="mb-2 text-[11px] font-bold uppercase text-slate-400">Datos técnicos</div>
          <div className="grid gap-2 sm:grid-cols-2">
            {dato("Empresa", n.empresa?.nombre)}{dato("Nº serie", n.numero_serie)}{dato("DOT", n.dot)}
            {dato("RFID", n.rfid_epc)}{dato("Marca", n.marca)}{dato("Modelo", n.modelo)}
            {dato("Medida", n.medida)}{dato("Índice carga", n.indice_carga)}{dato("Índice velocidad", n.indice_velocidad)}
            {dato("Proveedor", n.proveedor)}{dato("Fecha compra", n.fecha_compra)}
            {dato("Coste", n.coste_compra != null ? `${n.coste_compra} €` : null)}
          </div>
        </div>
        <div className="rounded-lg bg-slate-800 p-3">
          <div className="mb-2 text-[11px] font-bold uppercase text-slate-400">Estado y almacén</div>
          <div className="grid gap-2 sm:grid-cols-2">
            {dato("Estado técnico", ESTADO_NEUMATICO_LABELS[n.estado])}
            {dato("Referencia almacén", n.referencia_almacen)}
            {dato("Sincronizado almacén", n.sincronizado_almacen ? "Sí" : "No")}
            {dato("Montaje actual", montaje ? `${montaje.posicion?.codigo_posicion ?? ""} · desde ${montaje.fecha_montaje}` : "No montado")}
          </div>
          <div className="mt-2 text-[11px] text-slate-500">El stock físico y los movimientos se gestionan en el módulo de Almacén.</div>
        </div>
      </div>

      <div className="mt-3 rounded-lg bg-slate-800 p-3">
        <div className="mb-3 text-[11px] font-bold uppercase text-slate-400">Historial del neumático ({eventos.length})</div>
        {eventos.length === 0 ? (
          <div className="text-sm text-slate-500">Sin movimientos registrados todavía.</div>
        ) : (
          <div className="flex flex-col">
            {eventos.map((e, i) => (
              <div key={i} className="flex gap-3">
                <div className="flex flex-col items-center">
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-900 text-[13px]">{e.icono}</div>
                  {i < eventos.length - 1 && <div className="w-px flex-1 bg-slate-700" />}
                </div>
                <div className="pb-4">
                  <div className="text-[13px] font-semibold text-slate-100">{e.titulo}{e.km != null ? ` · ${e.km} km` : ""}</div>
                  {e.detalle && <div className="text-[12px] text-slate-400">{e.detalle}</div>}
                  <div className="text-[10px] text-slate-500">{e.fecha}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {editando && (
        <Modal title="Editar datos técnicos" onClose={() => setEditando(false)}
          footer={<div className="flex justify-end gap-2">
            <button onClick={() => setEditando(false)} className="rounded-lg border border-slate-600 px-4 py-2 text-sm text-slate-200">Cancelar</button>
            <button onClick={guardarEdicion} disabled={saving} className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">
              {saving ? "Guardando…" : "Guardar"}
            </button>
          </div>}>
          <div className="grid gap-2 sm:grid-cols-2">
            <Field label="Marca"><input className={inputCls} value={form.marca} onChange={(e) => setForm({ ...form, marca: e.target.value })} /></Field>
            <Field label="Modelo"><input className={inputCls} value={form.modelo} onChange={(e) => setForm({ ...form, modelo: e.target.value })} /></Field>
            <Field label="Medida"><input className={inputCls} value={form.medida} onChange={(e) => setForm({ ...form, medida: e.target.value })} /></Field>
            <Field label="Índice carga"><input className={inputCls} value={form.indice_carga} onChange={(e) => setForm({ ...form, indice_carga: e.target.value })} /></Field>
            <Field label="Índice velocidad"><input className={inputCls} value={form.indice_velocidad} onChange={(e) => setForm({ ...form, indice_velocidad: e.target.value })} /></Field>
            <Field label="DOT"><input className={inputCls} value={form.dot} onChange={(e) => setForm({ ...form, dot: e.target.value })} /></Field>
            <Field label="RFID"><input className={inputCls} value={form.rfid_epc} onChange={(e) => setForm({ ...form, rfid_epc: e.target.value })} /></Field>
            <Field label="Proveedor"><input className={inputCls} value={form.proveedor} onChange={(e) => setForm({ ...form, proveedor: e.target.value })} /></Field>
            <Field label="Fecha compra"><input type="date" className={inputCls} value={form.fecha_compra} onChange={(e) => setForm({ ...form, fecha_compra: e.target.value })} /></Field>
            <Field label="Coste (€)"><input type="number" step="0.01" className={inputCls} value={form.coste_compra} onChange={(e) => setForm({ ...form, coste_compra: e.target.value })} /></Field>
          </div>
          {msg && <div className="mt-2 text-xs text-red-300">{msg}</div>}
        </Modal>
      )}
    </div>
  );
}
