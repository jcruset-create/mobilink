import { useEffect, useState } from "react";
import {
  listarPlantillas, guardarPlantilla, eliminarPlantilla, guardarPlantillaItem, eliminarPlantillaItem,
  listarOperacionesMantenimiento, listarTiposVehiculo,
} from "../services/data";
import type { PlantillaMantenimiento, PlantillaItem, OperacionMantenimiento, TipoVehiculo } from "../types";
import { Modal, inputCls, Field, TextField } from "../components/ui";

export default function PlantillasMantenimiento() {
  const [plantillas, setPlantillas] = useState<PlantillaMantenimiento[]>([]);
  const [operaciones, setOperaciones] = useState<OperacionMantenimiento[]>([]);
  const [tipos, setTipos] = useState<TipoVehiculo[]>([]);
  const [loading, setLoading] = useState(true);
  const [editar, setEditar] = useState<null | PlantillaMantenimiento | "nueva">(null);
  const [itemDe, setItemDe] = useState<null | { plantillaId: string; item: PlantillaItem | null }>(null);
  const [msg, setMsg] = useState("");

  async function cargar() {
    setLoading(true);
    try {
      const [pl, op, ti] = await Promise.all([listarPlantillas(), listarOperacionesMantenimiento(), listarTiposVehiculo()]);
      setPlantillas(pl); setOperaciones(op); setTipos(ti);
    } catch (e: any) { setMsg(e?.message || "Error"); } finally { setLoading(false); }
  }
  useEffect(() => { void cargar(); }, []);

  const opNombre = (id: string) => operaciones.find((o) => o.id === id)?.nombre ?? "—";
  const freqTxt = (it: PlantillaItem) => [
    it.frecuencia_dias ? `${it.frecuencia_dias} d` : null,
    it.frecuencia_meses ? `${it.frecuencia_meses} m` : null,
    it.frecuencia_km ? `${it.frecuencia_km.toLocaleString("es-ES")} km` : null,
    it.frecuencia_horas ? `${it.frecuencia_horas} h` : null,
  ].filter(Boolean).join(" · ") || "—";

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <h1 className="text-lg font-black">Plantillas de mantenimiento</h1>
        <button onClick={() => setEditar("nueva")} className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-500">+ Nueva plantilla</button>
      </div>
      {msg && <div className="mb-3 text-sm text-red-300">{msg}</div>}
      <p className="mb-3 text-xs text-slate-500">Define un conjunto de operaciones y frecuencias reutilizable (p. ej. "Autocar", "Remolque"). Luego se aplica a varios vehículos desde Planificación.</p>

      {loading ? <div className="text-slate-500">Cargando…</div> : plantillas.length === 0 ? (
        <div className="rounded-2xl border border-slate-700 bg-slate-800 p-8 text-center text-slate-400">Aún no hay plantillas.</div>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {plantillas.map((p) => (
            <div key={p.id} className="rounded-2xl border border-slate-700 bg-slate-800 p-4">
              <div className="mb-2 flex items-start justify-between gap-2">
                <div>
                  <div className="text-base font-black text-slate-100">{p.nombre}</div>
                  {p.descripcion && <div className="text-[12px] text-slate-400">{p.descripcion}</div>}
                  {p.tipo_vehiculo_id && <div className="text-[11px] text-slate-500">Tipo: {tipos.find((t) => t.id === p.tipo_vehiculo_id)?.nombre ?? "—"}</div>}
                </div>
                <div className="flex gap-2 text-[12px]">
                  <button onClick={() => setEditar(p)} className="text-slate-300 hover:underline">Editar</button>
                  <button onClick={async () => { if (window.confirm("¿Eliminar plantilla?")) { await eliminarPlantilla(p.id); cargar(); } }} className="text-rose-300 hover:underline">Eliminar</button>
                </div>
              </div>
              <div className="flex flex-col gap-1">
                {(p.items ?? []).map((it) => (
                  <div key={it.id} className="flex items-center justify-between gap-2 rounded bg-slate-900/50 px-2 py-1 text-[12px]">
                    <span className="text-slate-200">{it.nombre || opNombre(it.operacion_id)}</span>
                    <span className="text-slate-500">{freqTxt(it)}</span>
                    <div className="flex gap-2">
                      <button onClick={() => setItemDe({ plantillaId: p.id, item: it })} className="text-slate-400 hover:underline">✎</button>
                      <button onClick={async () => { await eliminarPlantillaItem(it.id!); cargar(); }} className="text-rose-300 hover:underline">✕</button>
                    </div>
                  </div>
                ))}
                <button onClick={() => setItemDe({ plantillaId: p.id, item: null })} className="mt-1 self-start text-[12px] font-bold text-emerald-300 hover:underline">+ Añadir operación</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {editar && (
        <ModalPlantilla plantilla={editar === "nueva" ? null : editar} tipos={tipos}
          onClose={() => setEditar(null)} onDone={() => { setEditar(null); cargar(); }} />
      )}
      {itemDe && (
        <ModalItem plantillaId={itemDe.plantillaId} item={itemDe.item} operaciones={operaciones}
          onClose={() => setItemDe(null)} onDone={() => { setItemDe(null); cargar(); }} />
      )}
    </div>
  );
}

function ModalPlantilla({ plantilla, tipos, onClose, onDone }: {
  plantilla: PlantillaMantenimiento | null; tipos: TipoVehiculo[]; onClose: () => void; onDone: () => void;
}) {
  const [nombre, setNombre] = useState(plantilla?.nombre ?? "");
  const [descripcion, setDescripcion] = useState(plantilla?.descripcion ?? "");
  const [tipo, setTipo] = useState(plantilla?.tipo_vehiculo_id ?? "");
  const [saving, setSaving] = useState(false);
  async function guardar() {
    if (!nombre.trim()) return;
    setSaving(true);
    try { await guardarPlantilla({ id: plantilla?.id, nombre: nombre.trim(), descripcion: descripcion.trim() || null, tipo_vehiculo_id: tipo || null }); onDone(); }
    finally { setSaving(false); }
  }
  return (
    <Modal title={plantilla ? "Editar plantilla" : "Nueva plantilla"} onClose={onClose}
      footer={<div className="flex justify-end gap-2"><button onClick={onClose} className="rounded-lg border border-slate-600 px-4 py-2 text-sm text-slate-200">Cancelar</button><button onClick={guardar} disabled={saving} className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">Guardar</button></div>}>
      <div className="grid gap-2">
        <TextField label="Nombre *" value={nombre} onChange={setNombre} />
        <TextField label="Descripción" value={descripcion} onChange={setDescripcion} />
        <Field label="Tipo de vehículo sugerido">
          <select className={inputCls} value={tipo} onChange={(e) => setTipo(e.target.value)}>
            <option value="">—</option>
            {tipos.map((t) => <option key={t.id} value={t.id}>{t.descripcion ?? t.nombre}</option>)}
          </select>
        </Field>
      </div>
    </Modal>
  );
}

function ModalItem({ plantillaId, item, operaciones, onClose, onDone }: {
  plantillaId: string; item: PlantillaItem | null; operaciones: OperacionMantenimiento[]; onClose: () => void; onDone: () => void;
}) {
  const [d, setD] = useState<PlantillaItem>(item ?? { operacion_id: "", margen_aviso_dias: 15 });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const set = (p: Partial<PlantillaItem>) => setD({ ...d, ...p });
  const num = (v: string) => (v === "" ? null : Number(v));
  async function guardar() {
    if (!d.operacion_id) { setErr("Elige la operación"); return; }
    setSaving(true); setErr("");
    try { await guardarPlantillaItem({ ...d, plantilla_id: plantillaId }); onDone(); }
    catch (e: any) { setErr(e?.message || "Error"); } finally { setSaving(false); }
  }
  return (
    <Modal title={item ? "Editar operación" : "Añadir operación"} onClose={onClose}
      footer={<div className="flex justify-end gap-2"><button onClick={onClose} className="rounded-lg border border-slate-600 px-4 py-2 text-sm text-slate-200">Cancelar</button><button onClick={guardar} disabled={saving} className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">Guardar</button></div>}>
      <div className="grid gap-2 sm:grid-cols-2">
        <Field label="Operación *">
          <select className={inputCls} value={d.operacion_id} onChange={(e) => set({ operacion_id: e.target.value })}>
            <option value="">Selecciona…</option>
            {operaciones.map((o) => <option key={o.id} value={o.id}>{o.nombre}</option>)}
          </select>
        </Field>
        <TextField label="Nombre (opcional)" value={d.nombre ?? ""} onChange={(v) => set({ nombre: v })} />
        <Field label="Cada (días)"><input type="number" className={inputCls} value={d.frecuencia_dias ?? ""} onChange={(e) => set({ frecuencia_dias: num(e.target.value) })} /></Field>
        <Field label="Cada (meses)"><input type="number" className={inputCls} value={d.frecuencia_meses ?? ""} onChange={(e) => set({ frecuencia_meses: num(e.target.value) })} /></Field>
        <Field label="Cada (km)"><input type="number" className={inputCls} value={d.frecuencia_km ?? ""} onChange={(e) => set({ frecuencia_km: num(e.target.value) })} /></Field>
        <Field label="Cada (horas)"><input type="number" className={inputCls} value={d.frecuencia_horas ?? ""} onChange={(e) => set({ frecuencia_horas: num(e.target.value) })} /></Field>
        <Field label="Margen aviso (días)"><input type="number" className={inputCls} value={d.margen_aviso_dias ?? 15} onChange={(e) => set({ margen_aviso_dias: Number(e.target.value) || 0 })} /></Field>
        <Field label="Tiempo estimado (min)"><input type="number" className={inputCls} value={d.tiempo_estimado_min ?? ""} onChange={(e) => set({ tiempo_estimado_min: num(e.target.value) })} /></Field>
      </div>
      {err && <div className="mt-2 text-[12px] text-rose-300">{err}</div>}
    </Modal>
  );
}
