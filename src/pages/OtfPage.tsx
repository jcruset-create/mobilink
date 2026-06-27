import { useEffect, useState } from "react";
import {
  fetchOtfList,
  fetchOtf,
  createOtf,
  addOtfTrabajo,
  updateOtfTrabajo,
  deleteOtfTrabajo,
  fetchKnownPlaces,
} from "../modules/roadsideAssistanceApi";
import type { KnownPlace } from "../modules/roadsideAssistanceTypes";

const STATUS_OTF: Record<string, string> = {
  planificada: "border-amber-200 bg-amber-50 text-amber-800",
  en_curso: "border-blue-200 bg-blue-50 text-blue-800",
  finalizada: "border-emerald-200 bg-emerald-50 text-emerald-800",
  cancelada: "border-red-200 bg-red-50 text-red-800",
};

const STATUS_TRABAJO: Record<string, string> = {
  pendiente: "bg-slate-100 text-slate-700",
  en_proceso: "bg-blue-100 text-blue-800",
  finalizado: "bg-emerald-100 text-emerald-800",
  no_realizado: "bg-red-100 text-red-700",
};

const TIPOS_VEHICULO = ["Tractora", "Remolque", "Camión rígido", "Furgoneta", "Turismo", "Maquinaria", "Otros"];

export default function OtfPage() {
  const [list, setList] = useState<any[]>([]);
  const [places, setPlaces] = useState<KnownPlace[]>([]);
  const [sel, setSel] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);

  async function loadList() {
    setLoading(true);
    try {
      setList(await fetchOtfList());
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadList();
    fetchKnownPlaces().then(setPlaces).catch(() => {});
  }, []);

  async function openOtf(id: number) {
    setSel(await fetchOtf(id));
  }

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-5 text-slate-900">
      <div className="mx-auto max-w-[1400px]">
        <header className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-2xl">🚛</span>
            <div>
              <h1 className="text-xl font-black">Órdenes de Trabajo de Flota (OTF)</h1>
              <div className="text-sm text-slate-500">{list.length} órdenes</div>
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={() => setShowNew(true)} className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-black text-white hover:bg-slate-800">+ Nueva OTF</button>
            <a href="/otf-tv" target="_blank" rel="noopener noreferrer" className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50">📺 Panel TV</a>
            <button onClick={loadList} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50">↻ Actualizar</button>
            <a href="/" className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50">← Volver</a>
          </div>
        </header>

        <div className="grid gap-4 lg:grid-cols-[380px_minmax(0,1fr)]">
          {/* Lista */}
          <div className="space-y-2">
            {loading ? (
              <div className="rounded-lg border border-slate-200 bg-white p-6 text-center text-sm text-slate-400">Cargando…</div>
            ) : list.length === 0 ? (
              <div className="rounded-lg border border-slate-200 bg-white p-6 text-center text-sm text-slate-400">Sin OTF. Crea una nueva.</div>
            ) : (
              list.map((o) => (
                <button
                  key={o.id}
                  onClick={() => openOtf(o.id)}
                  className={`w-full rounded-lg border bg-white p-3 text-left hover:bg-slate-50 ${sel?.id === o.id ? "border-slate-900" : "border-slate-200"}`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-black">{o.clientName || "Sin cliente"}</span>
                    <span className={`rounded-full border px-2 py-0.5 text-[11px] font-bold ${STATUS_OTF[o.status] ?? ""}`}>{o.status}</span>
                  </div>
                  <div className="mt-1 text-xs text-slate-500">{o.baseName || o.direccion || "—"}</div>
                  <div className="mt-1 text-xs font-bold text-slate-600">
                    Progreso: {o.progreso?.hechos ?? 0} / {o.progreso?.total ?? 0}
                    {o.assignedTechName ? ` · ${o.assignedTechName}` : ""}
                  </div>
                </button>
              ))
            )}
          </div>

          {/* Detalle */}
          <div>
            {sel ? (
              <OtfDetail otf={sel} onChange={async () => { setSel(await fetchOtf(sel.id)); loadList(); }} />
            ) : (
              <div className="rounded-lg border border-slate-200 bg-white p-10 text-center text-sm text-slate-400">Selecciona una OTF</div>
            )}
          </div>
        </div>
      </div>

      {showNew && (
        <NewOtfModal places={places} onClose={() => setShowNew(false)} onCreated={(o) => { setShowNew(false); loadList(); openOtf(o.id); }} />
      )}
    </div>
  );
}

function NewOtfModal({ places, onClose, onCreated }: { places: KnownPlace[]; onClose: () => void; onCreated: (o: any) => void }) {
  const [clientName, setClientName] = useState("");
  const [placeId, setPlaceId] = useState("");
  const [tech, setTech] = useState("");
  const [vehicle, setVehicle] = useState("");
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!clientName.trim()) return;
    setSaving(true);
    try {
      const place = places.find((p) => String(p.id) === placeId);
      const o = await createOtf({
        clientName: clientName.trim(),
        knownPlaceId: place?.id ?? null,
        baseName: place?.nombre ?? null,
        direccion: place?.direccion ?? null,
        lat: place?.lat ?? null,
        lng: place?.lng ?? null,
        assignedTechName: tech.trim() || null,
        assignedVehicleName: vehicle.trim() || null,
      });
      onCreated(o);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 p-4 pt-12">
      <div className="w-full max-w-lg rounded-2xl bg-white p-5 shadow-2xl">
        <h2 className="mb-3 text-lg font-black">Nueva OTF</h2>
        <div className="space-y-3">
          <Field label="Cliente *"><input value={clientName} onChange={(e) => setClientName(e.target.value)} className={inputCls} /></Field>
          <Field label="Base (lugar conocido)">
            <select value={placeId} onChange={(e) => setPlaceId(e.target.value)} className={inputCls}>
              <option value="">— Elegir base —</option>
              {places.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
            </select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Operario"><input value={tech} onChange={(e) => setTech(e.target.value)} className={inputCls} /></Field>
            <Field label="Furgoneta"><input value={vehicle} onChange={(e) => setVehicle(e.target.value)} className={inputCls} /></Field>
          </div>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-bold text-slate-600">Cancelar</button>
          <button onClick={save} disabled={saving} className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-black text-white disabled:opacity-50">{saving ? "…" : "Crear"}</button>
        </div>
      </div>
    </div>
  );
}

function OtfDetail({ otf, onChange }: { otf: any; onChange: () => void }) {
  const [plate, setPlate] = useState("");
  const [tipo, setTipo] = useState("Tractora");
  const [trabajoPlantilla, setTP] = useState("");
  const [detalle, setDetalle] = useState("");

  async function add() {
    if (!plate.trim() || (!trabajoPlantilla.trim() && !detalle.trim())) return;
    await addOtfTrabajo(otf.id, { plate, tipoVehiculo: tipo, trabajoPlantilla, detalleManual: detalle });
    setPlate(""); setTP(""); setDetalle("");
    onChange();
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-black">{otf.clientName}</h2>
          <div className="text-sm text-slate-500">{otf.baseName || otf.direccion || "—"}{otf.assignedTechName ? ` · ${otf.assignedTechName}` : ""}</div>
        </div>
        <div className="text-right">
          <span className={`rounded-full border px-2 py-0.5 text-xs font-bold ${STATUS_OTF[otf.status] ?? ""}`}>{otf.status}</span>
          <div className="mt-1 text-sm font-black">{otf.progreso?.hechos ?? 0} / {otf.progreso?.total ?? 0}</div>
          <button
            onClick={() => {
              const token = localStorage.getItem("sea-admin-token") ?? "";
              window.open(`/api/otf/${otf.id}/report.pdf?token=${encodeURIComponent(token)}`, "_blank");
            }}
            className="mt-2 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-black text-slate-700 hover:bg-slate-50"
          >
            📄 Informe PDF
          </button>
        </div>
      </div>

      {/* Lista de trabajos */}
      <div className="mt-4 space-y-2">
        {(otf.trabajos ?? []).map((t: any) => (
          <div key={t.id} className="flex items-center gap-3 rounded-lg border border-slate-100 bg-slate-50 px-3 py-2">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-black">{t.plate || "—"}</span>
                <span className="text-xs text-slate-500">{t.tipoVehiculo}</span>
                {t.origen === "tecnico_campo" && (
                  <span className="rounded-full bg-orange-100 px-2 py-0.5 text-[10px] font-black text-orange-800">AÑADIDO EN CAMPO{t.creadoPorTecnico ? ` · ${t.creadoPorTecnico}` : ""}</span>
                )}
              </div>
              <div className="text-sm text-slate-700">{t.trabajo}</div>
              {t.motivoAltaCampo && <div className="text-xs italic text-slate-400">Motivo: {t.motivoAltaCampo}</div>}
              {(t.fotos ?? []).length > 0 && (
                <div className="mt-1 flex gap-1">
                  {t.fotos.map((f: any) => (
                    <a key={f.id} href={f.url} target="_blank" rel="noreferrer"><img src={f.url} className="h-10 w-10 rounded object-cover border border-slate-200" /></a>
                  ))}
                </div>
              )}
            </div>
            <select
              value={t.status}
              onChange={async (e) => { await updateOtfTrabajo(t.id, { status: e.target.value }); onChange(); }}
              className={`rounded px-2 py-1 text-xs font-bold ${STATUS_TRABAJO[t.status] ?? ""}`}
            >
              <option value="pendiente">Pendiente</option>
              <option value="en_proceso">En proceso</option>
              <option value="finalizado">Finalizado</option>
              <option value="no_realizado">No realizado</option>
            </select>
            <button onClick={async () => { if (confirm("¿Eliminar trabajo?")) { await deleteOtfTrabajo(t.id); onChange(); } }} className="rounded-lg border border-red-200 bg-red-50 px-2 py-1 text-xs font-black text-red-700">✕</button>
          </div>
        ))}
        {(otf.trabajos ?? []).length === 0 && <div className="py-4 text-center text-sm text-slate-400">Sin trabajos. Añade el primero.</div>}
      </div>

      {/* Añadir trabajo (oficina) */}
      <div className="mt-4 rounded-lg border border-slate-200 p-3">
        <div className="mb-2 text-xs font-black uppercase text-slate-500">Añadir trabajo</div>
        <div className="grid grid-cols-2 gap-2">
          <input placeholder="Matrícula" value={plate} onChange={(e) => setPlate(e.target.value.toUpperCase())} className={inputCls} />
          <select value={tipo} onChange={(e) => setTipo(e.target.value)} className={inputCls}>
            {TIPOS_VEHICULO.map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
          <input placeholder="Trabajo (plantilla)" value={trabajoPlantilla} onChange={(e) => setTP(e.target.value)} className={inputCls} />
          <input placeholder="Detalle manual" value={detalle} onChange={(e) => setDetalle(e.target.value)} className={inputCls} />
        </div>
        <button onClick={add} className="mt-2 w-full rounded-lg bg-slate-900 px-3 py-2 text-sm font-black text-white">+ Añadir trabajo</button>
      </div>
    </div>
  );
}

const inputCls = "w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-300";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-bold text-slate-600">{label}</span>
      {children}
    </label>
  );
}
