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
  fetchOtfPlantillas,
  createOtfPlantilla,
  updateOtfPlantilla,
  fetchTyreControlInfo,
  type OtfPlantilla,
  type TyreControlInfo,
} from "../modules/roadsideAssistanceApi";
import type { KnownPlace } from "../modules/roadsideAssistanceTypes";
import KnownPlaceMapModal from "../components/KnownPlaceMapModal";
import AssistSidebar from "../components/AssistSidebar";

const STATUS_OTF: Record<string, string> = {
  planificada: "border-amber-500/40 bg-amber-500/15 text-amber-300",
  en_curso: "border-blue-500/40 bg-blue-500/15 text-blue-300",
  finalizada: "border-emerald-500/40 bg-emerald-500/15 text-emerald-300",
  cancelada: "border-red-500/40 bg-red-500/15 text-red-300",
};

const STATUS_TRABAJO: Record<string, string> = {
  pendiente: "border-slate-600 bg-slate-700 text-slate-200",
  en_proceso: "border-blue-500/40 bg-blue-500/20 text-blue-300",
  finalizado: "border-emerald-500/40 bg-emerald-500/20 text-emerald-300",
  no_realizado: "border-red-500/40 bg-red-500/20 text-red-300",
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
  const [plantillas, setPlantillas] = useState<OtfPlantilla[]>([]);
  const [showPlantillas, setShowPlantillas] = useState(false);

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
    fetchOtfPlantillas().then(setPlantillas).catch(() => {});
  }, []);

  async function openOtf(id: number) {
    setSel(await fetchOtf(id));
  }

  return (
    <div className="flex min-h-screen bg-slate-900 text-slate-100">
      <AssistSidebar active="otf" />

      <div className="flex min-w-0 flex-1 flex-col">
      <header className="sticky top-0 z-20 flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 bg-slate-900/95 px-4 py-2.5 pl-14 backdrop-blur md:pl-4">
        <div className="flex items-center gap-3">
          <img src="/logo_horizontal.png" alt="Mobilink Assist" className="h-9 md:h-12" />
          <div>
            <h1 className="text-sm font-bold md:text-base">Órdenes de Trabajo de Flota (OTF)</h1>
            <div className="text-xs text-slate-400">{list.length} órdenes</div>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={() => setShowNew(true)} className="rounded-lg bg-orange-600 px-4 py-2 text-sm font-black text-white hover:bg-orange-500">+ Nueva OTF</button>
          <button onClick={() => setShowPlantillas(true)} className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm font-bold text-slate-200 hover:bg-slate-700">🧩 Plantillas</button>
          <a href="/otf-tv" target="_blank" rel="noopener noreferrer" className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm font-bold text-slate-200 hover:bg-slate-700">📺 Panel TV</a>
          <button onClick={loadList} className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm font-bold text-slate-200 hover:bg-slate-700">↻ Actualizar</button>
        </div>
      </header>

      <div className="mx-auto w-full max-w-[1400px] p-4">
        <div className="grid gap-4 lg:grid-cols-[380px_minmax(0,1fr)]">
          {/* Lista */}
          <div className="space-y-2">
            {loading ? (
              <div className="rounded-xl border border-slate-700 bg-slate-800/60 p-6 text-center text-sm text-slate-500">Cargando…</div>
            ) : list.length === 0 ? (
              <div className="rounded-xl border border-slate-700 bg-slate-800/60 p-6 text-center text-sm text-slate-500">Sin OTF. Crea una nueva.</div>
            ) : (
              list.map((o) => (
                <button
                  key={o.id}
                  onClick={() => openOtf(o.id)}
                  className={`w-full rounded-xl border bg-slate-800/60 p-3 text-left transition hover:bg-slate-800 ${sel?.id === o.id ? "border-orange-500" : "border-slate-700"}`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-black text-slate-100">{o.clientName || "Sin cliente"}</span>
                    <span className={`rounded-full border px-2 py-0.5 text-[11px] font-bold ${STATUS_OTF[o.status] ?? ""}`}>{o.status}</span>
                  </div>
                  <div className="mt-1 text-xs text-slate-400">{o.baseName || o.direccion || "—"}</div>
                  <div className="mt-1 text-xs font-bold text-slate-300">
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
              <OtfDetail otf={sel} plantillas={plantillas} onChange={async () => { setSel(await fetchOtf(sel.id)); loadList(); }} />
            ) : (
              <div className="rounded-xl border border-slate-700 bg-slate-800/60 p-10 text-center text-sm text-slate-500">Selecciona una OTF</div>
            )}
          </div>
        </div>
      </div>

      {showPlantillas && (
        <PlantillasModal
          onClose={() => setShowPlantillas(false)}
          onChanged={() => fetchOtfPlantillas().then(setPlantillas).catch(() => {})}
        />
      )}

      {showNew && (
        <NewOtfModal
          places={places}
          techs={techs}
          vehicles={vehicles}
          onPlaceCreated={(p) => setPlaces((prev) => [p, ...prev])}
          onClose={() => setShowNew(false)}
          onCreated={(o) => { setShowNew(false); loadList(); openOtf(o.id); }}
        />
      )}
      </div>
    </div>
  );
}

function NewOtfModal({ places, techs, vehicles, onPlaceCreated, onClose, onCreated }: { places: KnownPlace[]; techs: any[]; vehicles: any[]; onPlaceCreated: (p: KnownPlace) => void; onClose: () => void; onCreated: (o: any) => void }) {
  const [clientName, setClientName] = useState("");
  const [placeId, setPlaceId] = useState("");
  const [tech, setTech] = useState("");
  const [vehicleName, setVehicleName] = useState("");
  const [saving, setSaving] = useState(false);
  const [showPlaceMap, setShowPlaceMap] = useState(false);
  const [error, setError] = useState("");

  async function save() {
    if (!clientName.trim()) return;
    setSaving(true);
    setError("");
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
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo crear la OTF");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 p-4 pt-12">
      <div className="w-full max-w-lg rounded-2xl border border-slate-700 bg-slate-800 p-5 text-slate-100 shadow-2xl">
        <h2 className="mb-3 text-lg font-black">Nueva OTF</h2>
        <div className="space-y-3">
          <Field label="Cliente *"><input value={clientName} onChange={(e) => setClientName(e.target.value)} className={inputCls} /></Field>
          <Field label="Base (lugar conocido)">
            <div className="flex gap-2">
              <select value={placeId} onChange={(e) => setPlaceId(e.target.value)} className={inputCls}>
                <option value="">— Elegir base —</option>
                {places.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
              </select>
              <button
                type="button"
                onClick={() => setShowPlaceMap(true)}
                title="Crear una base nueva marcándola en el mapa"
                className="shrink-0 rounded-lg border border-slate-600 bg-slate-700 px-3 py-2 text-sm font-black text-slate-100 hover:bg-slate-600"
              >
                + Mapa
              </button>
            </div>
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
        {error && (
          <div className="mt-3 rounded-lg border border-red-500/40 bg-red-500/15 px-3 py-2 text-sm font-bold text-red-300">
            {error}
          </div>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg border border-slate-600 px-4 py-2 text-sm font-bold text-slate-300 hover:bg-slate-700">Cancelar</button>
          <button onClick={save} disabled={saving} className="rounded-lg bg-orange-600 px-4 py-2 text-sm font-black text-white hover:bg-orange-500 disabled:opacity-50">{saving ? "…" : "Crear"}</button>
        </div>
      </div>

      {/* Crear base nueva con pin en el mapa: queda seleccionada al guardar */}
      {showPlaceMap && (
        <KnownPlaceMapModal
          onClose={() => setShowPlaceMap(false)}
          onSaved={(p) => {
            onPlaceCreated(p);
            setPlaceId(String(p.id));
          }}
        />
      )}
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="max-h-[85vh] w-full max-w-2xl overflow-auto rounded-2xl border border-slate-700 bg-slate-800 p-5 text-slate-100" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-lg font-black">Presupuestar en Business Central</h3>
          <button onClick={onClose} className="rounded-lg border border-slate-600 px-2 py-1 text-sm text-slate-300 hover:bg-slate-700">✕</button>
        </div>

        {error && <div className="mb-3 rounded-lg border border-red-500/40 bg-red-500/15 p-2 text-sm text-red-300">{error}</div>}

        {resultado ? (
          <div className="space-y-2">
            <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/15 p-3 text-sm text-emerald-300">
              <div className="font-black">Presupuesto creado</div>
              <div className="mt-1">
                Número en Business Central: <span className="font-mono font-black">{resultado.businessCentralQuoteNumber}</span>
              </div>
              <div>Total: {resultado.totalAmount} {resultado.currency}</div>
              {resultado.simulated && (
                <div className="mt-1 font-bold text-amber-300">
                  Atención: generado en modo simulación, no existe en Business Central.
                </div>
              )}
            </div>
            <div className="text-xs text-slate-500">Referencia interna: {resultado.mobilinkQuoteId} · {resultado.correlationId}</div>
            <button onClick={onClose} className="mt-2 rounded-lg bg-orange-600 px-4 py-2 text-sm font-black text-white hover:bg-orange-500">Cerrar</button>
          </div>
        ) : !preview ? (
          <div className="py-6 text-center text-sm text-slate-500">Cargando…</div>
        ) : (
          <div className="space-y-3">
            <div className="text-sm">
              <span className="text-slate-400">Cliente:</span>{" "}
              <span className="font-black">{preview.clientName}</span>{" "}
              <span className="font-mono text-xs text-slate-500">
                {preview.customer.mobilinkId} → {preview.customer.externalCode}
              </span>
            </div>

            <table className="w-full text-left text-sm">
              <thead className="text-xs text-slate-400">
                <tr>
                  <th className="py-1">Trabajo</th>
                  <th className="py-1">Código en el ERP</th>
                  <th className="py-1">Cant.</th>
                </tr>
              </thead>
              <tbody>
                {preview.lines.map((l: any) => (
                  <tr key={l.trabajoId} className="border-t border-slate-700">
                    <td className="py-1.5">
                      <div>{l.description}</div>
                      {l.plate && <div className="text-xs text-slate-500">{l.plate}</div>}
                    </td>
                    <td className="py-1.5 font-mono text-xs">
                      <span className={l.mapped ? "text-emerald-300" : "text-amber-300"}>{l.externalCode}</span>
                      {!l.mapped && <div className="text-[10px] text-amber-300">sin mapear</div>}
                    </td>
                    <td className="py-1.5">{l.quantity}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            {preview.lines.length === 0 && (
              <div className="rounded-lg border border-slate-700 bg-slate-900 p-3 text-sm text-slate-400">
                Esta OT no tiene trabajos facturables (los no realizados se excluyen).
              </div>
            )}

            {preview.sinMapear.length > 0 && (
              <div className="rounded-lg border border-amber-500/40 bg-amber-500/15 p-3 text-sm text-amber-300">
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
              className="rounded-lg bg-orange-600 px-4 py-2 text-sm font-black text-white hover:bg-orange-500 disabled:opacity-40"
            >
              {creando ? "Creando…" : "Crear presupuesto"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function OtfDetail({ otf, plantillas, onChange }: { otf: any; plantillas: OtfPlantilla[]; onChange: () => void }) {
  const [presupuestando, setPresupuestando] = useState(false);
  const [plate, setPlate] = useState("");
  const [tipo, setTipo] = useState("Tractora");
  const [trabajoPlantilla, setTP] = useState("");
  const [detalle, setDetalle] = useState("");
  const [observaciones, setObservaciones] = useState("");
  const [adding, setAdding] = useState(false);
  const [tyreInfo, setTyreInfo] = useState<TyreControlInfo | null>(null);

  // Tarjeta TyreControl: al escribir una matrícula completa (>= 6 caracteres)
  // se consulta el vehículo y su última revisión. Con debounce para no
  // disparar una petición por tecla.
  useEffect(() => {
    const p = plate.trim();
    if (p.replace(/[^A-Z0-9]/gi, "").length < 6) { setTyreInfo(null); return; }
    const timer = setTimeout(() => {
      fetchTyreControlInfo(p).then(setTyreInfo).catch(() => setTyreInfo(null));
    }, 600);
    return () => clearTimeout(timer);
  }, [plate]);

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
    <div className="rounded-xl border border-slate-700 bg-slate-800/60 p-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-black text-slate-100">{otf.clientName}</h2>
          <div className="text-sm text-slate-400">{otf.baseName || otf.direccion || "—"}{otf.assignedTechName ? ` · ${otf.assignedTechName}` : ""}</div>
        </div>
        <div className="text-right">
          <span className={`rounded-full border px-2 py-0.5 text-xs font-bold ${STATUS_OTF[otf.status] ?? ""}`}>{otf.status}</span>
          <div className="mt-1 text-sm font-black text-orange-400">{otf.progreso?.hechos ?? 0} / {otf.progreso?.total ?? 0}</div>
          <button
            onClick={() => {
              const token = localStorage.getItem("sea-admin-token") ?? "";
              window.open(`/api/otf/${otf.id}/report.pdf?token=${encodeURIComponent(token)}`, "_blank");
            }}
            className="mt-2 rounded-lg border border-slate-600 bg-slate-800 px-3 py-1.5 text-xs font-black text-slate-200 hover:bg-slate-700"
          >
            📄 Informe PDF
          </button>
          <button
            onClick={() => setPresupuestando(true)}
            className="mt-2 ml-2 rounded-lg border border-slate-600 bg-slate-800 px-3 py-1.5 text-xs font-black text-slate-200 hover:bg-slate-700"
          >
            💶 Presupuestar en BC
          </button>
        </div>
      </div>

      {presupuestando && <PresupuestarModal otf={otf} onClose={() => setPresupuestando(false)} />}

      {/* Lista de trabajos */}
      <div className="mt-4 space-y-2">
        {(otf.trabajos ?? []).map((t: any) => (
          <div key={t.id} className="flex items-center gap-3 rounded-xl border border-slate-700 bg-slate-900/60 px-3 py-2">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                {t.plate ? (
                  <a href={`/vehiculo?plate=${encodeURIComponent(t.plate)}`} target="_blank" rel="noopener noreferrer" className="font-black text-slate-100 underline decoration-dotted hover:text-orange-400">{t.plate}</a>
                ) : <span className="font-black text-slate-100">—</span>}
                <span className="text-xs text-slate-400">{t.tipoVehiculo}</span>
                {t.origen === "tecnico_campo" && (
                  <span className="rounded-full border border-orange-500/40 bg-orange-500/15 px-2 py-0.5 text-[10px] font-black text-orange-300">AÑADIDO EN CAMPO{t.creadoPorTecnico ? ` · ${t.creadoPorTecnico}` : ""}</span>
                )}
              </div>
              <div className="text-sm text-slate-200">{t.trabajo}</div>
              {t.observaciones && <div className="text-xs font-semibold text-amber-300">📌 {t.observaciones}</div>}
              {t.motivoAltaCampo && <div className="text-xs italic text-slate-500">Motivo: {t.motivoAltaCampo}</div>}
              {(t.fotos ?? []).length > 0 && (
                <div className="mt-1 flex gap-1">
                  {t.fotos.map((f: any) => (
                    <a key={f.id} href={f.url} target="_blank" rel="noreferrer"><img src={f.url} className="h-10 w-10 rounded border border-slate-700 object-cover" /></a>
                  ))}
                </div>
              )}
            </div>
            <select
              value={t.status}
              onChange={async (e) => { await updateOtfTrabajo(t.id, { status: e.target.value }); onChange(); }}
              className={`rounded border px-2 py-1 text-xs font-bold ${STATUS_TRABAJO[t.status] ?? ""}`}
            >
              <option value="pendiente">Pendiente</option>
              <option value="en_proceso">En proceso</option>
              <option value="finalizado">Finalizado</option>
              <option value="no_realizado">No realizado</option>
            </select>
            <button onClick={async () => { if (confirm("¿Eliminar trabajo?")) { await deleteOtfTrabajo(t.id); onChange(); } }} className="rounded-lg border border-red-500/40 bg-red-500/15 px-2 py-1 text-xs font-black text-red-300 hover:bg-red-500/25">✕</button>
          </div>
        ))}
        {(otf.trabajos ?? []).length === 0 && <div className="py-4 text-center text-sm text-slate-500">Sin trabajos. Añade el primero.</div>}
      </div>

      {/* Añadir trabajo (oficina) */}
      <div className="mt-4 rounded-xl border border-slate-700 bg-slate-900/40 p-3">
        <div className="mb-2 text-xs font-black uppercase tracking-wide text-slate-400">Añadir trabajo</div>
        <div className="grid grid-cols-2 gap-2">
          <input placeholder="Matrícula" value={plate} onChange={(e) => setPlate(e.target.value.toUpperCase())} className={inputCls} />
          <select value={tipo} onChange={(e) => setTipo(e.target.value)} className={inputCls}>
            {TIPOS_VEHICULO.map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
          <select value={trabajoPlantilla} onChange={(e) => setTP(e.target.value)} className={inputCls}>
            <option value="">— Trabajo (plantilla) —</option>
            {plantillas.map((p) => <option key={p.id} value={p.nombre}>{p.nombre}</option>)}
          </select>
          <input placeholder="Detalle manual" value={detalle} onChange={(e) => setDetalle(e.target.value)} className={inputCls} />
          <input
            placeholder="Observaciones (p. ej. remolque en plaza 27)"
            value={observaciones}
            onChange={(e) => setObservaciones(e.target.value)}
            className={`${inputCls} col-span-2`}
          />
        </div>
        {tyreInfo?.found && tyreInfo.vehiculo && (
          <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-cyan-500/40 bg-cyan-500/10 px-3 py-2 text-xs">
            <span className="font-black text-cyan-300">🛞 TyreControl</span>
            <span className="font-bold text-cyan-200">
              {tyreInfo.vehiculo.matricula}
              {tyreInfo.vehiculo.marca ? ` · ${tyreInfo.vehiculo.marca}${tyreInfo.vehiculo.modelo ? ` ${tyreInfo.vehiculo.modelo}` : ""}` : ""}
              {tyreInfo.vehiculo.kmActual != null ? ` · ${tyreInfo.vehiculo.kmActual.toLocaleString("es-ES")} km` : ""}
            </span>
            {tyreInfo.ultimaRevision ? (
              <span className={tyreInfo.ultimaRevision.alertas > 0 ? "font-bold text-red-300" : "text-cyan-300"}>
                Última revisión {new Date(tyreInfo.ultimaRevision.fecha).toLocaleDateString("es-ES")}
                {tyreInfo.ultimaRevision.minProfundidadMm != null ? ` · mín. ${tyreInfo.ultimaRevision.minProfundidadMm} mm` : ""}
                {tyreInfo.ultimaRevision.alertas > 0 ? ` · ⚠ ${tyreInfo.ultimaRevision.alertas} alerta${tyreInfo.ultimaRevision.alertas !== 1 ? "s" : ""}` : " · sin alertas"}
              </span>
            ) : (
              <span className="text-cyan-300">Sin revisiones registradas</span>
            )}
          </div>
        )}
        {tyreInfo && !tyreInfo.found && (
          <div className="mt-2 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-slate-500">
            🛞 Matrícula no encontrada en TyreControl
          </div>
        )}
        <button onClick={add} disabled={adding} className="mt-2 w-full rounded-lg bg-orange-600 px-3 py-2 text-sm font-black text-white hover:bg-orange-500 disabled:opacity-50">
          {adding ? "Añadiendo…" : "+ Añadir trabajo"}
        </button>
      </div>
    </div>
  );
}

/** Gestor del catálogo de plantillas de trabajos OTF. */
function PlantillasModal({ onClose, onChanged }: { onClose: () => void; onChanged: () => void }) {
  const [items, setItems] = useState<OtfPlantilla[]>([]);
  const [nuevo, setNuevo] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function load() {
    setItems(await fetchOtfPlantillas(true));
  }
  useEffect(() => { load().catch(() => {}); }, []);

  async function crear() {
    const nombre = nuevo.trim();
    if (!nombre || busy) return;
    setBusy(true);
    setError("");
    try {
      await createOtfPlantilla(nombre);
      setNuevo("");
      await load();
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo crear");
    } finally { setBusy(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 p-4 pt-12">
      <div className="flex max-h-[80vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-slate-700 bg-slate-800 p-5 text-slate-100 shadow-2xl">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-black">🧩 Plantillas de trabajos</h2>
          <button onClick={onClose} className="rounded-lg border border-slate-600 px-3 py-1.5 text-sm font-bold text-slate-300 hover:bg-slate-700">Cerrar</button>
        </div>
        <div className="mb-3 flex gap-2">
          <input
            value={nuevo}
            onChange={(e) => setNuevo(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") void crear(); }}
            placeholder="P. ej. Revisar presiones"
            className={inputCls}
          />
          <button onClick={() => void crear()} disabled={busy} className="shrink-0 rounded-lg bg-orange-600 px-4 py-2 text-sm font-black text-white hover:bg-orange-500 disabled:opacity-50">+ Crear</button>
        </div>
        {error && <div className="mb-2 rounded-lg border border-red-500/40 bg-red-500/15 px-3 py-2 text-sm font-bold text-red-300">{error}</div>}
        <div className="flex-1 space-y-2 overflow-y-auto">
          {items.length === 0 ? (
            <div className="py-8 text-center text-sm text-slate-500">Sin plantillas. Crea la primera arriba.</div>
          ) : items.map((p) => (
            <div key={p.id} className={`flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-900/60 px-3 py-2 ${p.activo ? "" : "opacity-50"}`}>
              <input
                defaultValue={p.nombre}
                onBlur={async (e) => {
                  const nombre = e.target.value.trim();
                  if (nombre && nombre !== p.nombre) {
                    await updateOtfPlantilla(p.id, { nombre });
                    await load();
                    onChanged();
                  }
                }}
                className="w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 text-sm font-bold text-slate-100 outline-none focus:border-orange-500"
              />
              <button
                onClick={async () => {
                  await updateOtfPlantilla(p.id, { activo: !p.activo });
                  await load();
                  onChanged();
                }}
                className={`shrink-0 rounded-lg border px-3 py-1.5 text-xs font-bold ${p.activo ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-300" : "border-slate-600 bg-slate-700/40 text-slate-400"}`}
              >
                {p.activo ? "Activa" : "Inactiva"}
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

const inputCls = "w-full rounded-lg border border-slate-600 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-500/40";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-bold text-slate-400">{label}</span>
      {children}
    </label>
  );
}
