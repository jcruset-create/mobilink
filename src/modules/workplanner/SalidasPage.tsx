import { useCallback, useEffect, useMemo, useState } from "react";
import { MapPin, Plus, RefreshCw, Settings2, Truck } from "lucide-react";
import { getAdminHeaders } from "../adminHeaders";
import { apiFetch } from "../apiFetch";
import { API_BASE, loadTechsFromBackend } from "../workshopApi";
import {
  createRoadsideAssistanceInBackend,
  fetchKnownPlaces,
  geocodeAddress,
  loadRoadsideAssistancesFromBackend,
  loadRoadsideVehiclesFromBackend,
  updateRoadsideAssistanceStatusInBackend,
} from "../roadsideAssistanceApi";
import type { KnownPlace, RoadsideAssistance, RoadsideVehicle } from "../roadsideAssistanceTypes";
import { DEFAULT_WORKSHOP_ID, WORKSHOPS, normalizeWorkshopId } from "../workshops";
import { tecnicosDelTaller } from "../tecnicosPorTaller";
import { getTodayDateValue } from "../techStatusScheduleHelpers";
import {
  ETIQUETA_PASO_SALIDA,
  FLUJO_SALIDA,
  MOTIVOS_SALIDA,
  TIPO_SALIDA,
  destinoDeSalida,
  esSalida,
  etiquetaDeMotivo,
  siguientePasoForzable,
  ultimosDestinos,
  validarSalida,
  type DestinoReciente,
  type MotivoSalida,
} from "../salidasTaller";
import SeguimientoAsistenciaCard from "../../components/SeguimientoAsistenciaCard";
import LocationPickerModal from "../../components/LocationPickerModal";
import KnownPlaceMapModal from "../../components/KnownPlaceMapModal";

/**
 * Salidas de taller: un operario sale con una furgoneta a repartir neumáticos,
 * buscar recambios… y vuelve. Se guardan como asistencias de tipo «salida»
 * (src/modules/salidasTaller.ts) y se siguen por el GPS de la furgoneta: los
 * pasos de carretera los pone el servidor, y aquí cada uno tiene su «forzar»
 * por si el GPS no lo detecta.
 */

type Vista = "lista" | "nueva";

const fechaCorta = (ms?: number | null) =>
  ms ? new Date(ms).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" }) : "";

const CLASE_ESTADO: Record<string, string> = {
  asignada: "bg-slate-600 text-white",
  en_camino: "bg-blue-600 text-white",
  en_punto: "bg-violet-600 text-white",
  en_camino_base: "bg-teal-600 text-white",
  llegada_taller: "bg-slate-700 text-slate-300",
  cancelada: "bg-rose-700 text-white",
};

function esDeHoy(a: RoadsideAssistance, hoy: string): boolean {
  const ms = a.createdAtMs ?? 0;
  return ms > 0 && new Date(ms).toISOString().slice(0, 10) === hoy;
}

export default function SalidasPage() {
  const hoy = getTodayDateValue();
  const [workshopId, setWorkshopId] = useState<string>(() => {
    const guardado = window.localStorage.getItem("sea-selected-workshop");
    return normalizeWorkshopId(guardado ?? DEFAULT_WORKSHOP_ID) as string;
  });

  const [vista, setVista] = useState<Vista>("lista");
  const [salidas, setSalidas] = useState<RoadsideAssistance[]>([]);
  const [tecnicos, setTecnicos] = useState<{ name: string }[]>([]);
  const [furgonetas, setFurgonetas] = useState<RoadsideVehicle[]>([]);
  const [lugares, setLugares] = useState<KnownPlace[]>([]);
  const [abierta, setAbierta] = useState<number | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");
  const [aviso, setAviso] = useState("");

  const cargar = useCallback(async () => {
    setError("");
    try {
      const [asist, techs, vehs, places] = await Promise.all([
        loadRoadsideAssistancesFromBackend(true),
        loadTechsFromBackend().catch(() => []),
        loadRoadsideVehiclesFromBackend(false).catch(() => []),
        fetchKnownPlaces().catch(() => []),
      ]);
      setSalidas(asist.filter((a) => esSalida(a) && normalizeWorkshopId(a.workshopId) === normalizeWorkshopId(workshopId)));
      setTecnicos(tecnicosDelTaller(techs as any, workshopId).map((t) => ({ name: t.nombre })));
      setFurgonetas((vehs as RoadsideVehicle[]).filter((v) => v.active !== false && normalizeWorkshopId(v.workshopId) === normalizeWorkshopId(workshopId)));
      setLugares(places.filter((p) => p.active !== false && p.lat != null && p.lng != null));
    } catch (e: any) {
      setError(e?.message || "No se pudieron cargar las salidas.");
    } finally {
      setCargando(false);
    }
  }, [workshopId]);

  useEffect(() => {
    void cargar();
    const t = window.setInterval(() => void cargar(), 20_000);
    return () => window.clearInterval(t);
  }, [cargar]);

  const enMarcha = useMemo(
    () => salidas.filter((a) => a.status !== "llegada_taller" && a.status !== "cancelada" && a.status !== "redirigida"),
    [salidas]
  );
  const terminadas = useMemo(
    () => salidas.filter((a) => (a.status === "llegada_taller" || a.status === "cancelada") && esDeHoy(a, hoy)),
    [salidas, hoy]
  );

  async function forzar(a: RoadsideAssistance, status: string) {
    setAviso("");
    try {
      await updateRoadsideAssistanceStatusInBackend(a.id, status as any);
      setAviso(`${a.assignedTechName}: marcado «${ETIQUETA_PASO_SALIDA[status as keyof typeof ETIQUETA_PASO_SALIDA] ?? status}» a mano.`);
      await cargar();
    } catch (e: any) {
      setError(e?.message || "No se pudo cambiar el paso.");
    }
  }

  async function cancelar(a: RoadsideAssistance) {
    if (!window.confirm(`¿Cancelar la salida de ${a.assignedTechName} a ${destinoDeSalida(a)}?`)) return;
    await forzar(a, "cancelada");
  }

  const btn = "flex items-center gap-2 rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-sm font-semibold hover:bg-slate-700";
  const input = "rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none focus:ring-2 focus:ring-sky-500";

  return (
    <div className="min-h-full bg-slate-900 p-4 text-slate-100">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-bold"><Truck className="h-5 w-5 text-sky-400" /> Salidas de taller</h1>
          <p className="text-xs text-slate-400">
            Un operario sale con una furgoneta y vuelve. El recorrido se sigue por el GPS de la furgoneta; cada paso se puede forzar si el GPS no lo detecta.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select value={workshopId} onChange={(e) => { setWorkshopId(e.target.value); setAbierta(null); }} className={input}>
            {WORKSHOPS.map((w) => <option key={w.id} value={w.id}>{w.shortName}</option>)}
          </select>
          <button type="button" className={btn} onClick={() => void cargar()}><RefreshCw className="h-4 w-4" /> Recargar</button>
          <CoordenadasDelTaller workshopId={workshopId} input={input} btn={btn} />
          <button type="button" onClick={() => setVista("nueva")} className="flex items-center gap-2 rounded-lg bg-sky-600 px-3 py-2 text-sm font-bold text-white hover:bg-sky-500">
            <Plus className="h-4 w-4" /> Nueva salida
          </button>
        </div>
      </div>

      {error && <div className="mb-3 rounded-xl border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-300">{error}</div>}
      {aviso && <div className="mb-3 rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-300">{aviso}</div>}

      {vista === "nueva" && (
        <NuevaSalida
          workshopId={workshopId}
          tecnicos={tecnicos}
          furgonetas={furgonetas}
          lugares={lugares}
          recientes={ultimosDestinos(salidas, 3)}
          input={input}
          btn={btn}
          onCancelar={() => setVista("lista")}
          // Un lugar creado desde aquí entra en la lista sin recargar, como en Assist.
          onLugarCreado={(p) => setLugares((prev) => [p, ...prev.filter((x) => x.id !== p.id)])}
          onCreada={async (a) => {
            setVista("lista");
            setAviso(`Salida creada: ${a.assignedTechName} → ${destinoDeSalida(a)}.`);
            await cargar();
          }}
        />
      )}

      {vista === "lista" && (
        <div className="space-y-2">
          {cargando && <div className="text-sm text-slate-400">Cargando…</div>}
          {!cargando && enMarcha.length === 0 && terminadas.length === 0 && (
            <div className="rounded-2xl border border-slate-700 bg-slate-800 p-6 text-center text-sm text-slate-400">
              No hay salidas hoy en este taller. Pulsa «Nueva salida» para crear una.
            </div>
          )}
          {[...enMarcha, ...terminadas].map((a) => {
            const abiertaEsta = abierta === a.id;
            const siguiente = siguientePasoForzable(a.status);
            const motivo = MOTIVOS_SALIDA.find((m) => m.key === a.motivo);
            return (
              <div key={a.id} className={`rounded-2xl border border-slate-700 bg-slate-800 ${a.status === "llegada_taller" ? "opacity-70" : ""}`}>
                <button type="button" onClick={() => setAbierta(abiertaEsta ? null : a.id)} className="grid w-full grid-cols-[auto_1fr_auto] items-center gap-3 px-3 py-2.5 text-left">
                  <span className="text-2xl leading-none">{motivo?.icono ?? "🚐"}</span>
                  <span className="min-w-0">
                    <b className="block truncate text-sm">{etiquetaDeMotivo(a.motivo)} · {destinoDeSalida(a)}</b>
                    <span className="block truncate text-xs text-slate-400">
                      <i className="not-italic text-slate-100">{a.assignedTechName}</i>
                      {a.assignedVehicleName ? ` · 🚐 ${a.assignedVehicleName}` : ""}
                      {a.departedAtMs ? ` · salió ${fechaCorta(a.departedAtMs)}` : a.assignedAtMs ? ` · asignada ${fechaCorta(a.assignedAtMs)}` : ""}
                      {a.arrivedAtPointMs ? ` · llegó ${fechaCorta(a.arrivedAtPointMs)}` : ""}
                      {a.arrivedAtWorkshopMs ? ` · en taller ${fechaCorta(a.arrivedAtWorkshopMs)}` : ""}
                      {!a.webfleetVehicleId && a.status !== "llegada_taller" ? " · ⚠ sin GPS" : ""}
                    </span>
                  </span>
                  <span className="text-right">
                    <span className={`inline-block rounded-full px-2.5 py-1 text-[10.5px] font-black uppercase tracking-wide ${CLASE_ESTADO[a.status] ?? "bg-slate-600 text-white"}`}>
                      {ETIQUETA_PASO_SALIDA[a.status as keyof typeof ETIQUETA_PASO_SALIDA] ?? a.status}
                    </span>
                    {a.etaMinutos != null && (a.status === "en_camino" || a.status === "en_camino_base") && (
                      <span className="block font-mono text-xs text-sky-300">ETA {a.etaMinutos} min{a.etaKm ? ` · ${a.etaKm} km` : ""}</span>
                    )}
                  </span>
                </button>

                {abiertaEsta && (
                  <div className="border-t border-slate-700 px-3 py-3">
                    {a.notes && <p className="mb-2 text-sm text-slate-300">📝 {a.notes}</p>}
                    {a.trackingToken ? (
                      <div className="rounded-2xl bg-white p-3 text-slate-900">
                        <SeguimientoAsistenciaCard trackingToken={a.trackingToken} status={a.status} etaMinutos={a.etaMinutos} etaKm={a.etaKm} flujo={FLUJO_SALIDA} />
                      </div>
                    ) : null}
                    <div className="mt-3 flex flex-wrap gap-2">
                      {siguiente && (
                        <button type="button" className={btn} onClick={() => void forzar(a, siguiente)}>
                          Forzar «{ETIQUETA_PASO_SALIDA[siguiente]}»
                        </button>
                      )}
                      {a.status !== "llegada_taller" && a.status !== "cancelada" && (
                        <button type="button" onClick={() => void cancelar(a)} className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm font-semibold text-rose-300 hover:bg-rose-500/20">
                          Cancelar salida
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ── Nueva salida ───────────────────────────────────────────────────────── */

function NuevaSalida({
  workshopId, tecnicos, furgonetas, lugares, recientes, input, btn, onCancelar, onLugarCreado, onCreada,
}: {
  workshopId: string;
  tecnicos: { name: string }[];
  furgonetas: RoadsideVehicle[];
  lugares: KnownPlace[];
  /** Los últimos destinos usados, para repetirlos con un clic. */
  recientes: DestinoReciente[];
  input: string;
  btn: string;
  onCancelar: () => void;
  onLugarCreado: (p: KnownPlace) => void;
  onCreada: (a: RoadsideAssistance) => void | Promise<void>;
}) {
  const [motivo, setMotivo] = useState<MotivoSalida>("repartir_neumaticos");
  const [modoDestino, setModoDestino] = useState<"lugar" | "recientes" | "direccion" | "mapa">("lugar");
  const [recienteIdx, setRecienteIdx] = useState<number>(-1);
  const [lugarId, setLugarId] = useState<string>("");
  const [direccion, setDireccion] = useState("");
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [mapaAbierto, setMapaAbierto] = useState(false);
  const [nuevoLugarAbierto, setNuevoLugarAbierto] = useState(false);
  const [tecnico, setTecnico] = useState("");
  const [furgonetaId, setFurgonetaId] = useState<string>("");
  const [notas, setNotas] = useState("");
  const [errores, setErrores] = useState<string[]>([]);
  const [guardando, setGuardando] = useState(false);

  const furgoneta = furgonetas.find((f) => String(f.id) === furgonetaId) ?? null;
  const lugar = lugares.find((p) => String(p.id) === lugarId) ?? null;

  async function crear() {
    setErrores([]);
    let address = "";
    let latitude: number | null = null;
    let longitude: number | null = null;
    let knownPlaceId: number | null = null;

    try {
      if (modoDestino === "lugar") {
        if (!lugar) return setErrores(["Elige un lugar conocido."]);
        address = [lugar.nombre, lugar.direccion].filter(Boolean).join(" · ");
        latitude = lugar.lat; longitude = lugar.lng; knownPlaceId = lugar.id;
      } else if (modoDestino === "recientes") {
        const r = recientes[recienteIdx];
        if (!r) return setErrores(["Elige uno de los últimos destinos."]);
        address = r.address; latitude = r.latitude; longitude = r.longitude;
      } else if (modoDestino === "direccion") {
        if (!direccion.trim()) return setErrores(["Escribe la dirección."]);
        setGuardando(true);
        const g = await geocodeAddress(direccion.trim());
        address = g.formattedAddress || direccion.trim();
        latitude = g.lat; longitude = g.lng;
      } else {
        if (!coords) return setErrores(["Marca el punto en el mapa."]);
        address = direccion.trim();
        latitude = coords.lat; longitude = coords.lng;
      }

      const faltan = validarSalida({ motivo, assignedTechName: tecnico, address, latitude, longitude, knownPlaceId });
      if (faltan.length) { setErrores(faltan); return; }
      if (!furgoneta) { setErrores(["Elige la furgoneta."]); return; }

      setGuardando(true);
      const creada = await createRoadsideAssistanceInBackend({
        solicitanteEmpresa: "", solicitanteClienteId: null, solicitanteContactoId: null,
        solicitanteNombre: "", solicitanteTelefono: "", solicitanteAutorizacion: "",
        customerName: "", customerPhone: "", conductorNombre: "",
        address, googleMapsUrl: "",
        latitude: latitude != null ? String(latitude) : "",
        longitude: longitude != null ? String(longitude) : "",
        plate: furgoneta.plate ?? "", plateRemolque: "", esRemolque: false,
        descripcionAveria: "", trabajosARealizar: etiquetaDeMotivo(motivo), vehicleDescription: "",
        webfleetVehicleId: furgoneta.webfleetVehicleId ?? "",
        assignedTechName: tecnico,
        assignedVehicleName: furgoneta.plate || furgoneta.name,
        priority: "normal" as any,
        notes: notas.trim(),
        sendTrackingWhatsapp: false,
        workshopId,
        // Lo que convierte la asistencia en salida de taller.
        ...({ tipo: TIPO_SALIDA, motivo, knownPlaceId } as object),
      });
      await onCreada(creada);
    } catch (e: any) {
      setErrores([e?.message || "No se pudo crear la salida."]);
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="rounded-2xl border border-slate-700 bg-slate-800 p-4">
      <h2 className="text-base font-bold">Nueva salida</h2>
      <p className="text-xs text-slate-400">Motivo, destino, operario y furgoneta. Sin cliente ni WhatsApp.</p>

      {errores.length > 0 && (
        <ul className="mt-3 list-disc rounded-lg border border-rose-500/40 bg-rose-500/10 px-6 py-2 text-xs text-rose-300">
          {errores.map((e) => <li key={e}>{e}</li>)}
        </ul>
      )}

      <div className="mt-4 grid max-w-2xl gap-4">
        <div>
          <div className="text-xs font-medium text-slate-300">Motivo</div>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {MOTIVOS_SALIDA.map((m) => (
              <button key={m.key} type="button" onClick={() => setMotivo(m.key)}
                className={`rounded-full border px-3 py-1.5 text-sm ${motivo === m.key ? "border-sky-500 bg-sky-600 font-bold text-white" : "border-slate-600 text-slate-200 hover:bg-slate-700"}`}>
                {m.icono} {m.label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <div className="text-xs font-medium text-slate-300">Destino</div>
          <div className="mt-1 rounded-xl border border-slate-700 bg-slate-900/60 p-3">
            <div className="mb-2 flex gap-1.5 text-xs">
              {(["lugar", "recientes", "direccion", "mapa"] as const).map((m) => (
                <button key={m} type="button" onClick={() => setModoDestino(m)}
                  className={`rounded-md border px-2.5 py-1 ${modoDestino === m ? "border-slate-500 bg-slate-700 font-bold text-white" : "border-slate-700 text-slate-400"}`}>
                  {m === "lugar" ? "Lugar conocido" : m === "recientes" ? "Últimos 3 lugares" : m === "direccion" ? "Dirección" : "En el mapa"}
                </button>
              ))}
            </div>
            {modoDestino === "lugar" && (
              <>
                <div className="flex gap-2">
                  <select id="salida-lugar" value={lugarId} onChange={(e) => setLugarId(e.target.value)} className={`min-w-0 flex-1 ${input}`}>
                    <option value="">— elige un lugar —</option>
                    {lugares.map((p) => <option key={p.id} value={p.id}>{p.nombre}{p.direccion ? ` · ${p.direccion}` : ""}</option>)}
                  </select>
                  <button type="button" className={`${btn} shrink-0`} onClick={() => setNuevoLugarAbierto(true)}><Plus className="h-4 w-4" /> Nuevo lugar</button>
                </div>
                <p className="mt-1 text-[11px] text-slate-400">Los mismos lugares que Assist. Un lugar nuevo se guarda para las dos pantallas.</p>
              </>
            )}
            {modoDestino === "recientes" && (
              recientes.length === 0 ? (
                <p className="text-sm text-slate-400">Todavía no hay salidas en este taller: los últimos destinos saldrán aquí.</p>
              ) : (
                <div className="grid gap-1.5">
                  {recientes.map((r, i) => (
                    <button key={`${r.latitude},${r.longitude}`} type="button" onClick={() => setRecienteIdx(i)}
                      className={`flex items-center justify-between gap-3 rounded-lg border px-3 py-2 text-left text-sm ${recienteIdx === i ? "border-sky-500 bg-sky-600/20 font-bold text-white" : "border-slate-700 text-slate-200 hover:bg-slate-800"}`}>
                      <span className="min-w-0 truncate">📍 {r.address}</span>
                      <span className="shrink-0 font-mono text-[11px] text-slate-400">{r.veces > 1 ? `${r.veces} veces` : "1 vez"}</span>
                    </button>
                  ))}
                </div>
              )
            )}
            {modoDestino === "direccion" && (
              <input id="salida-direccion" value={direccion} onChange={(e) => setDireccion(e.target.value)} placeholder="Calle, número, población" className={`w-full ${input}`} />
            )}
            {modoDestino === "mapa" && (
              <div className="flex flex-wrap items-center gap-2">
                <button type="button" className={btn} onClick={() => setMapaAbierto(true)}><MapPin className="h-4 w-4" /> {coords ? "Cambiar punto" : "Marcar en el mapa"}</button>
                {coords && <span className="font-mono text-xs text-slate-300">{coords.lat.toFixed(5)}, {coords.lng.toFixed(5)}</span>}
                <input value={direccion} onChange={(e) => setDireccion(e.target.value)} placeholder="Nombre del sitio (opcional)" className={`min-w-[200px] flex-1 ${input}`} />
              </div>
            )}
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-xs font-medium text-slate-300">Operario
            <select id="salida-operario" value={tecnico} onChange={(e) => setTecnico(e.target.value)} className={`mt-1 w-full ${input}`}>
              <option value="">— elige —</option>
              {tecnicos.map((t) => <option key={t.name} value={t.name}>{t.name}</option>)}
            </select>
          </label>
          <label className="block text-xs font-medium text-slate-300">Furgoneta
            <select id="salida-furgoneta" value={furgonetaId} onChange={(e) => setFurgonetaId(e.target.value)} className={`mt-1 w-full ${input}`}>
              <option value="">— elige —</option>
              {furgonetas.map((f) => <option key={f.id} value={f.id}>{f.plate ? `${f.plate} · ` : ""}{f.name}{!f.webfleetVehicleId ? " (sin GPS)" : ""}</option>)}
            </select>
            {furgoneta && !furgoneta.webfleetVehicleId && (
              <span className="mt-1 block text-[11px] text-amber-300">⚠ Sin GPS: en camino, llegada y vuelta habrá que marcarlos a mano.</span>
            )}
          </label>
        </div>

        <label className="block text-xs font-medium text-slate-300">Notas (opcional)
          <input id="salida-notas" value={notas} onChange={(e) => setNotas(e.target.value)} placeholder="4 × 385/65 R22.5, preguntar por Marc" className={`mt-1 w-full ${input}`} />
        </label>

        <div className="flex gap-2">
          <button type="button" disabled={guardando} onClick={() => void crear()} className="rounded-xl bg-sky-600 px-4 py-2 text-sm font-bold text-white hover:bg-sky-500 disabled:opacity-50">{guardando ? "Creando…" : "Crear salida"}</button>
          <button type="button" onClick={onCancelar} className="rounded-xl border border-slate-600 px-4 py-2 text-sm font-semibold">Cancelar</button>
        </div>
      </div>

      {nuevoLugarAbierto && (
        <KnownPlaceMapModal
          onClose={() => setNuevoLugarAbierto(false)}
          onSaved={(p) => {
            onLugarCreado(p);
            setModoDestino("lugar");
            setLugarId(String(p.id));
            setNuevoLugarAbierto(false);
          }}
        />
      )}

      {mapaAbierto && (
        <LocationPickerModal
          initialLat={coords?.lat ?? null}
          initialLng={coords?.lng ?? null}
          initialQuery={direccion}
          onClose={() => setMapaAbierto(false)}
          onPick={(lat, lng, dir) => { setCoords({ lat, lng }); if (dir && !direccion) setDireccion(dir); setMapaAbierto(false); }}
        />
      )}
    </div>
  );
}

/* ── Coordenadas del taller (por taller) ───────────────────────────────── */

function CoordenadasDelTaller({ workshopId, input, btn }: { workshopId: string; input: string; btn: string }) {
  const [abierto, setAbierto] = useState(false);
  const [lat, setLat] = useState("");
  const [lng, setLng] = useState("");
  const [direccion, setDireccion] = useState("");
  const [radio, setRadio] = useState("300");
  const [msg, setMsg] = useState("");

  useEffect(() => {
    if (!abierto) return;
    let activo = true;
    (async () => {
      try {
        const res = await apiFetch(`${API_BASE}/api/workshop-config?workshopId=${encodeURIComponent(workshopId)}`, { headers: getAdminHeaders() });
        const c = await res.json();
        if (!activo) return;
        setLat(String(c?.taller_lat ?? "")); setLng(String(c?.taller_lng ?? "")); setDireccion(String(c?.taller_direccion ?? "")); setRadio(String(c?.taller_radio_m ?? "300"));
      } catch { /* sin permisos de admin no se abre nada */ }
    })();
    return () => { activo = false; };
  }, [abierto, workshopId]);

  async function guardar() {
    setMsg("");
    try {
      const res = await apiFetch(`${API_BASE}/api/workshop-config`, {
        method: "POST",
        headers: getAdminHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ workshopId, taller_lat: lat, taller_lng: lng, taller_direccion: direccion, taller_radio_m: radio }),
      });
      if (!res.ok) throw new Error("Solo un administrador puede guardarlas.");
      setMsg("Guardadas.");
    } catch (e: any) {
      setMsg(e?.message || "No se pudieron guardar.");
    }
  }

  return (
    <>
      <button type="button" className={btn} onClick={() => setAbierto(true)} title="Coordenadas del taller (para la salida y la llegada automáticas)"><Settings2 className="h-4 w-4" /> Taller</button>
      {abierto && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md rounded-2xl border border-slate-700 bg-slate-800 p-5 text-slate-100">
            <h3 className="text-lg font-bold">Coordenadas del taller · {WORKSHOPS.find((w) => w.id === workshopId)?.shortName ?? workshopId}</h3>
            <p className="mt-1 text-xs text-slate-400">Con ellas el servidor detecta la salida y la llegada al taller. Cada taller lleva las suyas; en blanco, se usan las generales.</p>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <label className="text-xs text-slate-300">Latitud<input id="taller-lat" value={lat} onChange={(e) => setLat(e.target.value)} className={`mt-1 w-full ${input}`} /></label>
              <label className="text-xs text-slate-300">Longitud<input id="taller-lng" value={lng} onChange={(e) => setLng(e.target.value)} className={`mt-1 w-full ${input}`} /></label>
            </div>
            <label className="mt-2 block text-xs text-slate-300">Dirección<input id="taller-dir" value={direccion} onChange={(e) => setDireccion(e.target.value)} className={`mt-1 w-full ${input}`} /></label>
            <label className="mt-2 block text-xs text-slate-300">Radio (m)<input id="taller-radio" value={radio} onChange={(e) => setRadio(e.target.value)} className={`mt-1 w-32 ${input}`} /></label>
            {msg && <div className="mt-2 text-xs text-emerald-300">{msg}</div>}
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={() => setAbierto(false)} className="rounded-xl border border-slate-600 px-4 py-2 text-sm font-semibold">Cerrar</button>
              <button type="button" onClick={() => void guardar()} className="rounded-xl bg-sky-600 px-4 py-2 text-sm font-bold text-white hover:bg-sky-500">Guardar</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
