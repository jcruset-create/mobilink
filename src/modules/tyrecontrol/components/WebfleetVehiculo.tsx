import { useState } from "react";
import { actualizarVehiculo, authHeaders } from "../services/data";
import { inputCls } from "./ui";
import { useTyreAuth } from "../contexts/TyreAuthContext";
import type { Vehiculo } from "../types";

const API_BASE = import.meta.env.PROD ? "" : "http://localhost:4000";

type Estado = {
  objectname?: string;
  odometer_km: number | null;
  lat: number | null;
  lng: number | null;
  postext: string | null;
  speed_kmh: number | null;
  pos_time: string | null;
};

// Conexión del vehículo con Webfleet: guarda su Webfleet ID y sincroniza
// kilómetros y posición en tiempo real. Solo para administradores.
export default function WebfleetVehiculo({ vehiculo, onUpdated }: { vehiculo: Vehiculo; onUpdated: () => void }) {
  const { perfil } = useTyreAuth();
  const puedeEditar = !!(perfil?.es_superadmin || perfil?.rol === "administrador");

  const [wfId, setWfId] = useState(vehiculo.webfleet_vehicle_id ?? "");
  const [guardandoId, setGuardandoId] = useState(false);
  const [sincronizando, setSincronizando] = useState(false);
  const [estado, setEstado] = useState<Estado | null>(null);
  const [msg, setMsg] = useState("");
  const [guardandoKm, setGuardandoKm] = useState(false);

  const idGuardado = (vehiculo.webfleet_vehicle_id ?? "").trim();

  async function guardarId() {
    setGuardandoId(true); setMsg("");
    try {
      await actualizarVehiculo(vehiculo.id, { webfleet_vehicle_id: wfId.trim() || null });
      setMsg("✔ Webfleet ID guardado");
      onUpdated();
    } catch (e: any) { setMsg(e?.message || "Error al guardar"); } finally { setGuardandoId(false); }
  }

  async function sincronizar() {
    const objectno = (wfId.trim() || idGuardado);
    if (!objectno) { setMsg("Introduce el Webfleet ID primero"); return; }
    setSincronizando(true); setMsg(""); setEstado(null);
    try {
      const url = `${API_BASE}/api/tyrecontrol/webfleet/odometer?empresa=${encodeURIComponent(vehiculo.empresa_id)}&objectno=${encodeURIComponent(objectno)}`;
      const r = await fetch(url, { headers: await authHeaders() });
      const data = await r.json();
      if (!r.ok) { setMsg(data?.error || `Error ${r.status}`); return; }
      setEstado(data);
      if (data.odometer_km == null) setMsg("Conectado. Este objeto no reporta odómetro (km).");
    } catch (e: any) { setMsg(e?.message || "Error de conexión"); } finally { setSincronizando(false); }
  }

  async function guardarKm() {
    if (!estado?.odometer_km) return;
    setGuardandoKm(true); setMsg("");
    try {
      await actualizarVehiculo(vehiculo.id, { km_actual: estado.odometer_km, origen_km: "webfleet" });
      setMsg(`✔ Kilometraje actualizado a ${estado.odometer_km.toLocaleString("es-ES")} km`);
      onUpdated();
    } catch (e: any) { setMsg(e?.message || "Error al guardar km"); } finally { setGuardandoKm(false); }
  }

  const conectado = !!idGuardado;

  return (
    <div className="rounded-lg bg-slate-800 p-3">
      <div className="mb-1 flex items-center gap-2">
        <div className="text-[11px] font-bold uppercase text-slate-400">Webfleet</div>
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${conectado ? "bg-emerald-500/20 text-emerald-300" : "bg-slate-700 text-slate-400"}`}>
          {conectado ? "Enlazado" : "Sin enlazar"}
        </span>
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <div className="flex-1 min-w-[160px]">
          <div className="mb-1 text-[10px] text-slate-400">Webfleet Vehicle ID (objectno)</div>
          <input className={inputCls} value={wfId} disabled={!puedeEditar} onChange={(e) => setWfId(e.target.value)} placeholder="p. ej. 2321HZT" />
        </div>
        {puedeEditar && (
          <button onClick={guardarId} disabled={guardandoId || wfId.trim() === idGuardado} className="rounded bg-slate-700 px-3 py-1.5 text-[12px] font-bold text-slate-100 disabled:opacity-40">
            {guardandoId ? "Guardando…" : "Guardar ID"}
          </button>
        )}
        <button onClick={sincronizar} disabled={sincronizando || !(wfId.trim() || idGuardado)} className="rounded bg-sky-600 px-3 py-1.5 text-[12px] font-bold text-white disabled:opacity-40">
          {sincronizando ? "Sincronizando…" : "Sincronizar"}
        </button>
      </div>

      {estado && (
        <div className="mt-3 grid gap-2 rounded bg-slate-900/60 p-2 text-[12px] sm:grid-cols-2">
          <div><span className="text-slate-500">Objeto: </span><span className="text-slate-200">{estado.objectname}</span></div>
          <div>
            <span className="text-slate-500">Odómetro: </span>
            <span className="font-bold text-slate-100">{estado.odometer_km != null ? `${estado.odometer_km.toLocaleString("es-ES")} km` : "no disponible"}</span>
          </div>
          <div><span className="text-slate-500">Posición: </span><span className="text-slate-200">{estado.postext ?? (estado.lat != null ? `${estado.lat.toFixed(5)}, ${estado.lng?.toFixed(5)}` : "—")}</span></div>
          <div><span className="text-slate-500">Velocidad: </span><span className="text-slate-200">{estado.speed_kmh != null ? `${estado.speed_kmh} km/h` : "—"}</span></div>
          {estado.pos_time && <div className="sm:col-span-2 text-[11px] text-slate-500">Última posición: {new Date(estado.pos_time).toLocaleString("es-ES")}</div>}
          {puedeEditar && estado.odometer_km != null && (
            <div className="sm:col-span-2">
              <button onClick={guardarKm} disabled={guardandoKm} className="rounded bg-emerald-600 px-3 py-1.5 text-[12px] font-bold text-white disabled:opacity-50">
                {guardandoKm ? "Guardando…" : `Actualizar km del vehículo a ${estado.odometer_km.toLocaleString("es-ES")} km`}
              </button>
            </div>
          )}
        </div>
      )}

      {msg && <div className={`mt-2 text-[12px] ${msg.startsWith("✔") ? "text-emerald-400" : "text-amber-300"}`}>{msg}</div>}
      {!conectado && <div className="mt-2 text-[11px] text-slate-500">Introduce el ID del objeto en Webfleet y pulsa Sincronizar para traer km y posición.</div>}
    </div>
  );
}
