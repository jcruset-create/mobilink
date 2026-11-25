/**
 * «🗺 Recorrido»: lo que da Movertis del recorrido de UN vehículo en UN día,
 * en el mapa y con números. Fase 1 de «por qué tipo de carretera va»: dice si
 * hay puntos suficientes para pegarlos a la carretera. No guarda nada.
 */
import { useMemo, useState } from "react";
import { CircleMarker, MapContainer, Polyline, TileLayer, Tooltip } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import { probarRecorrido, type PruebaRecorrido } from "../services/kilometrajeMensual";
import { Modal } from "./ui";

const ayer = () => {
  const d = new Date(); d.setDate(d.getDate() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const hora = (iso: string | number | null) => iso == null ? "—"
  : new Date(iso).toLocaleTimeString("es-ES", { timeZone: "Europe/Madrid", hour: "2-digit", minute: "2-digit" });
const seg = (s: number | null) => s == null ? "—" : s < 120 ? `${s} s` : `${Math.round(s / 60)} min`;

const COLOR: Record<PruebaRecorrido["estadistica"]["veredicto"], string> = {
  suficiente: "border-emerald-500/50 bg-emerald-500/10 text-emerald-100",
  justo: "border-amber-500/50 bg-amber-500/10 text-amber-100",
  insuficiente: "border-rose-500/50 bg-rose-500/10 text-rose-100",
  sin_datos: "border-slate-600 bg-slate-800 text-slate-200",
};
const TITULO: Record<PruebaRecorrido["estadistica"]["veredicto"], string> = {
  suficiente: "Suficiente para saber la carretera",
  justo: "Justo",
  insuficiente: "No basta",
  sin_datos: "Sin datos",
};

export default function ProbarRecorrido({ vehiculoId, matricula, empresaId, onClose }: {
  vehiculoId: string; matricula: string | null; empresaId: string; onClose: () => void;
}) {
  const [fecha, setFecha] = useState(ayer());
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState("");
  const [r, setR] = useState<PruebaRecorrido | null>(null);

  async function probar() {
    setCargando(true); setError(""); setR(null);
    try { setR(await probarRecorrido({ empresaId, vehiculoId, fecha })); }
    catch (e) { setError(e instanceof Error ? e.message : "No se pudo pedir el recorrido"); }
    finally { setCargando(false); }
  }

  const linea = useMemo(() => (r?.puntos ?? []).map((p) => [p.lat, p.lng] as [number, number]), [r]);
  const e = r?.estadistica;

  return (
    <Modal title={`Recorrido · ${matricula ?? "vehículo"}`} onClose={onClose} size="lg"
      footer={<div className="flex justify-end"><button onClick={onClose} className="rounded-lg border border-slate-600 px-4 py-2 text-sm text-slate-200">Cerrar</button></div>}>
      <div className="grid gap-3 text-sm">
        <p className="text-[12px] text-slate-400">
          Pide a Movertis los puntos GPS de este vehículo en un día y mira si son suficientes para saber por qué carretera
          va (autopista, autovía, nacional, comarcal, urbana). <b className="text-slate-300">No guarda nada.</b> Son 2 peticiones.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor="recorrido-fecha" className="text-[12px] text-slate-400">Día</label>
          <input id="recorrido-fecha" type="date" value={fecha} onChange={(ev) => setFecha(ev.target.value)}
            className="rounded-lg border border-slate-600 bg-slate-900 px-2 py-1 text-base text-slate-100 sm:text-sm" />
          <button onClick={() => void probar()} disabled={cargando || !fecha}
            className="rounded-lg bg-sky-600 px-4 py-1.5 text-sm font-bold text-white disabled:opacity-50">
            {cargando ? "Pidiendo…" : "🗺 Ver recorrido"}
          </button>
        </div>
        {error && <div className="rounded-lg bg-red-500/10 p-3 text-red-300">{error}</div>}

        {r && e && (
          <>
            <div className={`rounded-lg border p-3 ${COLOR[e.veredicto]}`}>
              <b>{TITULO[e.veredicto]}.</b> {e.explicacion}
              {r.errorPuntos && <div className="mt-1 text-rose-300">Puntos: {r.errorPuntos}</div>}
              {r.errorResumen && <div className="mt-1 text-amber-300">Resumen de viajes: {r.errorResumen}</div>}
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Dato t="Puntos" v={e.puntos.toLocaleString("es-ES")} s={`${hora(e.primero)} → ${hora(e.ultimo)}`} />
              <Dato t="Cada cuánto, en marcha" v={seg(e.intervaloMediana)} s={`9 de cada 10 en menos de ${seg(e.intervaloP90)} · máx. ${seg(e.intervaloMaximo)}`} />
              <Dato t="Km sumando puntos" v={`${e.kmPorPuntos.toLocaleString("es-ES")} km`} s={r.kmResumen != null ? `resumen de viajes: ${r.kmResumen.toLocaleString("es-ES")} km` : "sin resumen"} />
              <Dato t="Huecos de +5 min" v={String(e.huecos)} s={e.huecos ? `${e.minutosEnHuecos} min sin puntos en marcha` : `con velocidad: ${e.conVelocidad} de ${e.puntos}`} />
            </div>
            {linea.length > 1 && (
              <div className="h-80 overflow-hidden rounded-lg border border-slate-700">
                <MapContainer bounds={linea} style={{ height: "100%", width: "100%" }} scrollWheelZoom>
                  <TileLayer attribution="&copy; OpenStreetMap" url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
                  <Polyline positions={linea} pathOptions={{ color: "#38bdf8", weight: 3 }} />
                  {r.puntos.map((p, i) => (
                    <CircleMarker key={i} center={[p.lat, p.lng]} radius={2} pathOptions={{ color: "#f59e0b", weight: 1 }}>
                      <Tooltip>{hora(p.t)}{p.velocidad != null ? ` · ${Math.round(p.velocidad)} km/h` : ""}</Tooltip>
                    </CircleMarker>
                  ))}
                </MapContainer>
              </div>
            )}
            <div className="text-[11px] text-slate-500">
              Unidad Movertis {r.unidad} · {r.puntos.length < e.puntos ? `se dibujan ${r.puntos.length} de ${e.puntos} puntos` : "puntos naranjas = lo que da Movertis; la línea los une en recto"}
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

function Dato({ t, v, s }: { t: string; v: string; s: string }) {
  return (
    <div className="rounded-lg border border-slate-700 bg-slate-900/60 px-3 py-2">
      <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{t}</div>
      <div className="text-lg font-black tabular-nums text-slate-100">{v}</div>
      <div className="text-[11px] text-slate-500">{s}</div>
    </div>
  );
}
