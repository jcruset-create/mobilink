import { useEffect, useState } from "react";
import { MapContainer, Polyline, TileLayer, Tooltip } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import { useTyreAuth } from "../contexts/TyreAuthContext";
import {
  activarAnalisisVias, analizarDiaVias, COLOR_TIPO, kmDe, NOMBRE_TIPO, porDondeRuedaVehiculo, TIPOS_VIA, velocidadMedia,
  type AnalisisDia, type PorDondeRuedaVehiculo, type PorTipo, type TipoVia,
} from "../services/porDondeRueda";
import { Modal } from "./ui";

/**
 * «Por dónde rueda» en la ficha del vehículo: la casilla para analizarlo y,
 * si está marcado, el reparto de km por tipo de vía (autopista, autovía,
 * nacional, autonómica, local, urbana). Lo calcula el servidor cada mañana con
 * el GPS de Movertis y el mapa de OpenStreetMap; abrir la ficha no pide nada
 * a Movertis.
 */

const km = (v: number) => `${Math.round(v).toLocaleString("es-ES")} km`;
const pct = (v: number, total: number) => (total > 0 ? `${Math.round((v / total) * 100)} %` : "—");
const nombreMes = (mes: string) => {
  const [y, m] = mes.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("es-ES", { month: "short", year: "2-digit" });
};
const ayer = () => {
  const d = new Date(); d.setDate(d.getDate() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/** Una barra apilada por tipo. */
export function BarraTipos({ porTipo, alto = "h-3" }: { porTipo: PorTipo; alto?: string }) {
  const total = kmDe(porTipo);
  if (total <= 0) return <div className={`${alto} w-full rounded bg-slate-700/50`} />;
  return (
    <div className={`flex ${alto} w-full overflow-hidden rounded`}>
      {TIPOS_VIA.filter((t) => porTipo[t].km > 0).map((t) => (
        <div key={t} title={`${NOMBRE_TIPO[t]}: ${km(porTipo[t].km)} (${pct(porTipo[t].km, total)})`}
          style={{ width: `${(porTipo[t].km / total) * 100}%`, background: COLOR_TIPO[t] }} />
      ))}
    </div>
  );
}

export function Leyenda() {
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-slate-400">
      {TIPOS_VIA.map((t) => (
        <span key={t} className="flex items-center gap-1">
          <span className="inline-block h-2 w-2 rounded-sm" style={{ background: COLOR_TIPO[t] }} />{NOMBRE_TIPO[t]}
        </span>
      ))}
    </div>
  );
}

export default function PorDondeRueda({ vehiculoId, matricula }: { vehiculoId: string; matricula?: string | null }) {
  const { perfil } = useTyreAuth();
  const esAdmin = !!(perfil?.es_superadmin || perfil?.rol === "administrador");
  const [d, setD] = useState<PorDondeRuedaVehiculo | null>(null);
  const [error, setError] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [verDia, setVerDia] = useState(false);

  const [recarga, setRecarga] = useState(0);
  const cargar = () => setRecarga((x) => x + 1);
  useEffect(() => {
    let vivo = true;
    porDondeRuedaVehiculo(vehiculoId)
      .then((r) => { if (vivo) { setD(r); setError(""); } })
      .catch((e) => { if (vivo) setError(e instanceof Error ? e.message : "No se pudo leer"); });
    return () => { vivo = false; };
  }, [vehiculoId, recarga]);

  async function cambiar(activo: boolean) {
    setGuardando(true);
    try { await activarAnalisisVias(vehiculoId, activo); cargar(); }
    catch (e) { setError(e instanceof Error ? e.message : "No se pudo guardar"); }
    finally { setGuardando(false); }
  }

  if (!d) return error && esAdmin ? <div className="mt-3 text-[11px] text-slate-500">Por dónde rueda: {error}</div> : null;
  const hayDatos = kmDe(d.total) > 0;
  // Sin marcar y sin historia: solo la casilla, y solo para quien puede marcarla.
  if (!d.activo && !hayDatos && !d.puedeAdministrar) return null;

  const totalConVia = kmDe(d.total) - d.total.sin_via.km;
  const meses = d.meses.slice(-6);
  const diasOk = d.ultimosDias.filter((x) => x.estado === "ok");
  const ultimo = d.ultimosDias[0];

  return (
    <div className="mt-3 rounded-lg bg-slate-800 p-3">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <div className="text-[11px] font-bold uppercase text-slate-400">Por dónde rueda</div>
        <span className="rounded-full bg-slate-700 px-2 py-0.5 text-[10px] text-slate-300">GPS + OpenStreetMap</span>
        {ultimo && <span className="text-[10px] text-slate-500">último día analizado {ultimo.fecha.split("-").reverse().join("/")}</span>}
        <div className="ml-auto flex items-center gap-2">
          {d.puedeAdministrar && (
            <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-slate-300">
              <input id={`vias-${vehiculoId}`} type="checkbox" checked={d.activo} disabled={guardando}
                onChange={(e) => void cambiar(e.target.checked)} className="h-3.5 w-3.5 accent-sky-500" />
              Analizar por dónde rueda
            </label>
          )}
          {d.puedeAdministrar && d.activo && (
            <button onClick={() => setVerDia(true)}
              className="rounded-lg border border-sky-600 px-2 py-1 text-[11px] font-bold text-sky-300 hover:bg-sky-500/10">
              🗺 Analizar un día
            </button>
          )}
        </div>
      </div>
      {error && <div className="mb-2 text-[11px] text-amber-400">{error}</div>}

      {!hayDatos ? (
        <div className="text-xs text-slate-500">
          {d.activo
            ? "Marcado. Cada mañana se analiza el día anterior (y hasta 7 días atrás); los primeros datos salen mañana, o pulsa «Analizar un día»."
            : "Márcalo para saber cada día cuántos km hace por autopista, autovía, nacional, comarcal, local y ciudad."}
        </div>
      ) : (
        <div className="grid gap-3 lg:grid-cols-[1fr_1fr]">
          <div className="space-y-2">
            <BarraTipos porTipo={d.total} alto="h-4" />
            <Leyenda />
            <table className="w-full text-xs">
              <thead>
                <tr className="text-[10px] uppercase text-slate-500">
                  <th className="py-1 text-left font-semibold">Tipo de vía</th>
                  <th className="py-1 text-right font-semibold">Km</th>
                  <th className="py-1 text-right font-semibold">%</th>
                  <th className="py-1 text-right font-semibold">Vel. media</th>
                </tr>
              </thead>
              <tbody>
                {TIPOS_VIA.filter((t) => d.total[t].km > 0).map((t) => (
                  <tr key={t} className="border-t border-slate-700/60">
                    <td className="py-1 text-slate-300">
                      <span className="mr-1.5 inline-block h-2 w-2 rounded-sm" style={{ background: COLOR_TIPO[t] }} />{NOMBRE_TIPO[t]}
                    </td>
                    <td className="py-1 text-right font-bold tabular-nums text-slate-100">{km(d.total[t].km)}</td>
                    <td className="py-1 text-right tabular-nums text-slate-400">{t === "sin_via" ? "" : pct(d.total[t].km, totalConVia)}</td>
                    <td className="py-1 text-right tabular-nums text-slate-400">{velocidadMedia(d.total[t]) != null ? `${velocidadMedia(d.total[t])} km/h` : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="text-[10px] text-slate-500">
              {diasOk.length} días analizados en los últimos {d.ultimosDias.length}. El % es sobre los km con vía conocida.
            </div>
          </div>
          <div className="space-y-3">
            <div>
              <div className="mb-1 text-[10px] font-semibold uppercase text-slate-500">Por meses</div>
              <div className="space-y-1">
                {meses.map((m) => (
                  <div key={m.mes} className="grid grid-cols-[52px_1fr_70px] items-center gap-2 text-[11px]">
                    <span className="capitalize text-slate-400">{nombreMes(m.mes)}</span>
                    <BarraTipos porTipo={m.porTipo} />
                    <span className="text-right tabular-nums text-slate-300">{km(kmDe(m.porTipo))}</span>
                  </div>
                ))}
              </div>
            </div>
            {d.carreteras.length > 0 && (
              <div>
                <div className="mb-1 text-[10px] font-semibold uppercase text-slate-500">Carreteras más usadas</div>
                <div className="flex flex-wrap gap-1.5">
                  {d.carreteras.map((c) => (
                    <span key={c.ref} className="rounded border border-slate-600 px-1.5 py-0.5 text-[11px] text-slate-200"
                      title={NOMBRE_TIPO[c.tipo]}>
                      <span className="mr-1 inline-block h-2 w-2 rounded-sm" style={{ background: COLOR_TIPO[c.tipo] }} />
                      <b>{c.ref}</b> <span className="tabular-nums text-slate-400">{km(c.km)}</span>
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {verDia && <AnalizarDia vehiculoId={vehiculoId} matricula={matricula} onClose={() => { setVerDia(false); cargar(); }} />}
    </div>
  );
}

function AnalizarDia({ vehiculoId, matricula, onClose }: { vehiculoId: string; matricula?: string | null; onClose: () => void }) {
  const [fecha, setFecha] = useState(ayer());
  const [r, setR] = useState<AnalisisDia | null>(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState("");

  async function analizar() {
    setCargando(true); setError(""); setR(null);
    try { setR(await analizarDiaVias(vehiculoId, fecha)); }
    catch (e) { setError(e instanceof Error ? e.message : "No se pudo analizar"); }
    finally { setCargando(false); }
  }

  const todos = r?.tramos.flatMap((t) => t.puntos) ?? [];
  const filas = r?.resumen?.filas ?? [];
  const porTipo = Object.fromEntries(TIPOS_VIA.map((t) => [t, {
    km: filas.filter((f) => f.tipo === t).reduce((s, f) => s + f.km, 0),
    segundos: filas.filter((f) => f.tipo === t).reduce((s, f) => s + f.segundos, 0),
  }])) as PorTipo;

  return (
    <Modal title={`Por dónde rueda · ${matricula ?? ""}`} onClose={onClose} size="lg">
      <div className="space-y-3">
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-xs text-slate-300">
            Día
            <input id="vias-fecha" type="date" value={fecha} max={ayer()} onChange={(e) => setFecha(e.target.value)}
              className="ml-2 rounded border border-slate-600 bg-slate-900 px-2 py-1 text-xs text-slate-100" />
          </label>
          <button onClick={() => void analizar()} disabled={cargando}
            className="rounded-lg bg-sky-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-sky-500 disabled:opacity-50">
            {cargando ? "Analizando… (el mapa puede tardar la primera vez)" : "Analizar"}
          </button>
          <span className="text-[10px] text-slate-500">2 peticiones a Movertis. El resultado se guarda.</span>
        </div>
        {error && <div className="rounded border border-rose-500/50 bg-rose-500/10 px-3 py-2 text-xs text-rose-100">{error}</div>}
        {r && r.estado !== "ok" && (
          <div className="rounded border border-amber-500/50 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">
            {r.estado === "sin_puntos" && "Movertis no da recorrido ese día (¿no se movió?)."}
            {/* El motivo ya viene redactado y sin punto final (overpass.ts):
                aquí solo se encadena para que la frase se lea de corrido. */}
            {r.estado === "mapa_pendiente" && `Falta el mapa de la zona${r.error ? `: ${r.error.replace(/\.$/, "")}` : ""}. No se pierde nada: se reintenta solo, o vuelve a pulsar «Analizar» en un rato.`}
            {r.estado === "error" && `Error: ${r.error ?? ""}`}
          </div>
        )}
        {r?.estado === "ok" && r.resumen && (
          <>
            <BarraTipos porTipo={porTipo} alto="h-4" />
            <Leyenda />
            <div className="text-xs text-slate-300">
              {km(r.resumen.kmPuntos)} con los puntos{r.kmResumen != null ? ` · ${km(r.kmResumen)} según el resumen de viajes de Movertis` : ""} · {r.puntos.toLocaleString("es-ES")} puntos
            </div>
            <div className="flex flex-wrap gap-1.5">
              {filas.slice(0, 14).map((f) => (
                <span key={`${f.tipo}|${f.ref}`} className="rounded border border-slate-600 px-1.5 py-0.5 text-[11px] text-slate-200">
                  <span className="mr-1 inline-block h-2 w-2 rounded-sm" style={{ background: COLOR_TIPO[f.tipo as TipoVia] }} />
                  <b>{f.ref || NOMBRE_TIPO[f.tipo as TipoVia]}</b> <span className="tabular-nums text-slate-400">{km(f.km)}</span>
                </span>
              ))}
            </div>
            {todos.length > 1 && (
              <div className="h-[420px] overflow-hidden rounded-lg border border-slate-700">
                <MapContainer bounds={todos} style={{ height: "100%", width: "100%" }} scrollWheelZoom>
                  <TileLayer attribution="&copy; OpenStreetMap" url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
                  {r.tramos.map((t, i) => (
                    <Polyline key={i} positions={t.puntos} pathOptions={{ color: COLOR_TIPO[t.tipo], weight: 4 }}>
                      <Tooltip sticky>{NOMBRE_TIPO[t.tipo]}{t.ref ? ` · ${t.ref}` : ""}{t.nombre ? ` · ${t.nombre}` : ""}</Tooltip>
                    </Polyline>
                  ))}
                </MapContainer>
              </div>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}
