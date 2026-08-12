import { useEffect, useState } from "react";
import {
  fetchOtfList,
  fetchOtf,
  createOtf,
  addOtfTrabajo,
  updateOtfTrabajo,
  deleteOtfTrabajo,
  fetchKnownPlaces,
  fetchRoadsideVehiclesSimple,
  fetchRoadsideTechsSimple,
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
  const [techs, setTechs] = useState<any[]>([]);
  const [vehicles, setVehicles] = useState<any[]>([]);

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
    fetchRoadsideTechsSimple().then(setTechs).catch(() => {});
    fetchRoadsideVehiclesSimple().then(setVehicles).catch(() => {});
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
            <a href="/asistencias" className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50">← Volver</a>
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
        <NewOtfModal places={places} techs={techs} vehicles={vehicles} onClose={() => setShowNew(false)} onCreated={(o) => { setShowNew(false); loadList(); openOtf(o.id); }} />
      )}
    </div>
  );
}

function NewOtfModal({ places, techs, vehicles, onClose, onCreated }: { places: KnownPlace[]; techs: any[]; vehicles: any[]; onClose: () => void; onCreated: (o: any) => void }) {
  const [clientName, setClientName] = useState("");
  const [placeId, setPlaceId] = useState("");
  const [tech, setTech] = useState("");
  const [vehicleName, setVehicleName] = useState("");
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!clientName.trim()) return;
    setSaving(true);
    try {
      const place = places.find((p) => String(p.id) === placeId);
      const veh = vehicles.find((v) => v.name === vehicleName);
      const o = await createOtf({
        clientName: clientName.trim(),
        knownPlaceId: place?.id ?? null,
        baseName: place?.nombre ?? null,
        direccion: place?.direccion ?? null,
        lat: place?.lat ?? null,
        lng: place?.lng ?? null,
        assignedTechName: tech || null,
        assignedVehicleName: vehicleName || null,
        webfleetVehicleId: veh?.webfleetVehicleId ?? null,
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
            <Field label="Operario">
              <select value={tech} onChange={(e) => setTech(e.target.value)} className={inputCls}>
                <option value="">— Sin asignar —</option>
                {techs.map((t) => <option key={t.name} value={t.name}>{t.name}</option>)}
              </select>
            </Field>
            <Field label="Furgoneta">
              <select value={vehicleName} onChange={(e) => setVehicleName(e.target.value)} className={inputCls}>
                <option value="">— Sin asignar —</option>
                {vehicles.map((v) => <option key={v.id} value={v.name}>{v.name}{v.plate ? ` (${v.plate})` : ""}</option>)}
              </select>
            </Field>
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

/**
 * Presupuestar la OT en el ERP a través del Integration Hub.
 *
 * Primero enseña el preview (qué líneas se enviarían y qué falta por mapear) y sólo
 * después permite crear: un trabajo sin mapear enviado al ERP produce un error críptico,
 * y aquí el usuario ve exactamente qué le falta y dónde arreglarlo.
 */
function PresupuestarModal({ otf, onClose }: { otf: any; onClose: () => void }) {
  const [preview, setPreview] = useState<any | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creando, setCreando] = useState(false);
  const [resultado, setResultado] = useState<any | null>(null);
  const [forzar, setForzar] = useState(false);

  const tenant = localStorage.getItem("mobilink-tenant-id") || "default";
  const headers = { "Content-Type": "application/json", "x-tenant-id": tenant };

  useEffect(() => {
    let vivo = true;
    (async () => {
      try {
        const res = await fetch(`/api/v1/erp/work-orders/${otf.id}/quote-preview`, { headers });
        const data = await res.json();
        if (!vivo) return;
        if (!res.ok) throw new Error(data?.message || data?.error || `Error ${res.status}`);
        setPreview(data);
      } catch (e: any) {
        if (vivo) setError(e.message);
      }
    })();
    return () => {
      vivo = false;
    };
  }, [otf.id]);

  async function crear() {
    setCreando(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/erp/work-orders/${otf.id}/sales-quote`, {
        method: "POST",
        headers,
        body: JSON.stringify({ permitirSinMapear: forzar }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.message || data?.error || `Error ${res.status}`);
      setResultado(data);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setCreando(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="max-h-[85vh] w-full max-w-2xl overflow-auto rounded-xl bg-white p-5" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-lg font-black">Presupuestar en Business Central</h3>
          <button onClick={onClose} className="rounded-lg border border-slate-200 px-2 py-1 text-sm">✕</button>
        </div>

        {error && <div className="mb-3 rounded-lg bg-red-50 p-2 text-sm text-red-700">{error}</div>}

        {resultado ? (
          <div className="space-y-2">
            <div className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">
              <div className="font-black">Presupuesto creado</div>
              <div className="mt-1">
                Número en Business Central: <span className="font-mono font-black">{resultado.businessCentralQuoteNumber}</span>
              </div>
              <div>Total: {resultado.totalAmount} {resultado.currency}</div>
              {resultado.simulated && (
                <div className="mt-1 font-bold text-amber-700">
                  Atención: generado en modo simulación, no existe en Business Central.
                </div>
              )}
            </div>
            <div className="text-xs text-slate-500">Referencia interna: {resultado.mobilinkQuoteId} · {resultado.correlationId}</div>
            <button onClick={onClose} className="mt-2 rounded-lg bg-slate-900 px-4 py-2 text-sm font-black text-white">Cerrar</button>
          </div>
        ) : !preview ? (
          <div className="py-6 text-center text-sm text-slate-500">Cargando…</div>
        ) : (
          <div className="space-y-3">
            <div className="text-sm">
              <span className="text-slate-500">Cliente:</span>{" "}
              <span className="font-black">{preview.clientName}</span>{" "}
              <span className="font-mono text-xs text-slate-500">
                {preview.customer.mobilinkId} → {preview.customer.externalCode}
              </span>
            </div>

            <table className="w-full text-left text-sm">
              <thead className="text-xs text-slate-500">
                <tr>
                  <th className="py-1">Trabajo</th>
                  <th className="py-1">Código en el ERP</th>
                  <th className="py-1">Cant.</th>
                </tr>
              </thead>
              <tbody>
                {preview.lines.map((l: any) => (
                  <tr key={l.trabajoId} className="border-t border-slate-100">
                    <td className="py-1.5">
                      <div>{l.description}</div>
                      {l.plate && <div className="text-xs text-slate-400">{l.plate}</div>}
                    </td>
                    <td className="py-1.5 font-mono text-xs">
                      <span className={l.mapped ? "text-emerald-700" : "text-amber-700"}>{l.externalCode}</span>
                      {!l.mapped && <div className="text-[10px] text-amber-700">sin mapear</div>}
                    </td>
                    <td className="py-1.5">{l.quantity}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            {preview.lines.length === 0 && (
              <div className="rounded-lg bg-slate-50 p-3 text-sm text-slate-600">
                Esta OT no tiene trabajos facturables (los no realizados se excluyen).
              </div>
            )}

            {preview.sinMapear.length > 0 && (
              <div className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
                <div className="font-black">Faltan mapeos</div>
                <div className="mt-1">{preview.sinMapear.join(", ")}</div>
                <div className="mt-2 text-xs">
                  Añádelos en <a href="/integraciones" target="_blank" rel="noreferrer" className="underline">Integraciones → Mapeos</a>{" "}
                  para que el ERP reciba los códigos correctos.
                </div>
                <label className="mt-2 flex items-center gap-2 text-xs">
                  <input type="checkbox" checked={forzar} onChange={(e) => setForzar(e.target.checked)} />
                  Enviar igualmente (sólo si los códigos ya coinciden con los del ERP)
                </label>
              </div>
            )}

            <button
              onClick={crear}
              disabled={creando || preview.lines.length === 0 || (preview.sinMapear.length > 0 && !forzar)}
              className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-black text-white disabled:opacity-40"
            >
              {creando ? "Creando…" : "Crear presupuesto"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function OtfDetail({ otf, onChange }: { otf: any; onChange: () => void }) {
  const [presupuestando, setPresupuestando] = useState(false);
  const [plate, setPlate] = useState("");
  const [tipo, setTipo] = useState("Tractora");
  const [trabajoPlantilla, setTP] = useState("");
  const [detalle, setDetalle] = useState("");
  const [observaciones, setObservaciones] = useState("");
  const [adding, setAdding] = useState(false);

  async function add() {
    if (adding) return; // evita el doble clic → trabajo duplicado
    if (!plate.trim() || (!trabajoPlantilla.trim() && !detalle.trim())) return;
    setAdding(true);
    try {
      await addOtfTrabajo(otf.id, {
        plate,
        tipoVehiculo: tipo,
        trabajoPlantilla,
        detalleManual: detalle,
        observaciones: observaciones.trim() || null,
      });
      setPlate(""); setTP(""); setDetalle(""); setObservaciones("");
      onChange();
    } finally {
      setAdding(false);
    }
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
          <button
            onClick={() => setPresupuestando(true)}
            className="mt-2 ml-2 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-black text-slate-700 hover:bg-slate-50"
          >
            💶 Presupuestar en BC
          </button>
        </div>
      </div>

      {presupuestando && <PresupuestarModal otf={otf} onClose={() => setPresupuestando(false)} />}

      {/* Lista de trabajos */}
      <div className="mt-4 space-y-2">
        {(otf.trabajos ?? []).map((t: any) => (
          <div key={t.id} className="flex items-center gap-3 rounded-lg border border-slate-100 bg-slate-50 px-3 py-2">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                {t.plate ? (
                  <a href={`/vehiculo?plate=${encodeURIComponent(t.plate)}`} target="_blank" rel="noopener noreferrer" className="font-black underline decoration-dotted hover:text-blue-700">{t.plate}</a>
                ) : <span className="font-black">—</span>}
                <span className="text-xs text-slate-500">{t.tipoVehiculo}</span>
                {t.origen === "tecnico_campo" && (
                  <span className="rounded-full bg-orange-100 px-2 py-0.5 text-[10px] font-black text-orange-800">AÑADIDO EN CAMPO{t.creadoPorTecnico ? ` · ${t.creadoPorTecnico}` : ""}</span>
                )}
              </div>
              <div className="text-sm text-slate-700">{t.trabajo}</div>
              {t.observaciones && <div className="text-xs font-semibold text-amber-700">📌 {t.observaciones}</div>}
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
          <input
            placeholder="Observaciones (p. ej. remolque en plaza 27)"
            value={observaciones}
            onChange={(e) => setObservaciones(e.target.value)}
            className={`${inputCls} col-span-2`}
          />
        </div>
        <button onClick={add} disabled={adding} className="mt-2 w-full rounded-lg bg-slate-900 px-3 py-2 text-sm font-black text-white disabled:opacity-50">
          {adding ? "Añadiendo…" : "+ Añadir trabajo"}
        </button>
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
