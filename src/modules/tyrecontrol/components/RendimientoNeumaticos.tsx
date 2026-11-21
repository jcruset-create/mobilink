/**
 * Seguimiento de RENDIMIENTO kilométrico: el diálogo para activarlo, el
 * bloque de la ficha del vehículo y la tarjeta de la ficha del neumático.
 *
 * No es el «en seguimiento» de tc_vehiculos (contar en informes): este vive
 * en tc_seguimiento_rendimiento. Las cuentas, en services/rendimiento.ts.
 */
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  activarSeguimientoRendimiento, calcularRendimiento, datosRendimiento, desactivarSeguimientoRendimiento,
  miles, type DatosRendimiento, type Rendimiento,
} from "../services/rendimiento";
import { Modal, inputCls } from "./ui";

const numero = (s: string): number | null => {
  const t = s.trim().replace(",", ".");
  if (!t) return null;
  const x = Number(t);
  return Number.isFinite(x) ? x : NaN;
};

/** Diálogo «Seguir el rendimiento»: desde el origen o desde un montaje posterior. */
export function DialogoSeguirRendimiento({
  vehiculoId, matricula, kmActual, onClose, onHecho,
}: {
  vehiculoId: string; matricula?: string | null; kmActual?: number | null;
  onClose: () => void; onHecho: () => void;
}) {
  const [origen, setOrigen] = useState(true);
  const [kmInicio, setKmInicio] = useState("");
  const [fecha, setFecha] = useState("");
  const [minimo, setMinimo] = useState("3");
  const [profOrigen, setProfOrigen] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");

  async function guardar() {
    const km = numero(kmInicio), min = numero(minimo), prof = numero(profOrigen);
    if (Number.isNaN(km) || Number.isNaN(min) || Number.isNaN(prof)) { setError("Hay un número mal escrito"); return; }
    setGuardando(true); setError("");
    try {
      await activarSeguimientoRendimiento({
        vehiculoId, desdeOrigen: origen, kmInicio: origen ? 0 : km, fechaInicio: fecha || null,
        minimoMm: min ?? 3, profundidadOrigen: prof,
      });
      onHecho();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se ha podido activar");
    } finally { setGuardando(false); }
  }

  const opcion = (on: boolean, titulo: string, texto: string, click: () => void) => (
    <button type="button" onClick={click}
      className={`flex w-full gap-2 rounded-lg border p-3 text-left ${on ? "border-sky-500 bg-sky-500/10" : "border-slate-700"}`}>
      <span className={`mt-1 h-3.5 w-3.5 shrink-0 rounded-full border-2 ${on ? "border-sky-400 bg-sky-400" : "border-slate-500"}`} />
      <span><b className="text-slate-100">{titulo}</b><span className="block text-[12px] text-slate-400">{texto}</span></span>
    </button>
  );

  return (
    <Modal title={`Seguir el rendimiento de los neumáticos${matricula ? ` · ${matricula}` : ""}`} onClose={onClose}
      footer={<div className="flex justify-end gap-2">
        <button onClick={onClose} className="rounded-lg border border-slate-600 px-4 py-2 text-sm text-slate-200">Cancelar</button>
        <button onClick={() => void guardar()} disabled={guardando}
          className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">
          {guardando ? "Activando…" : "Empezar el seguimiento"}
        </button>
      </div>}>
      <div className="space-y-3 text-sm">
        {opcion(origen, "Son las gomas de origen",
          `Se cuenta desde 0 km y desde la profundidad de nuevo del catálogo.${kmActual ? ` Lleva ${miles(kmActual)} km con ellas.` : ""}`,
          () => setOrigen(true))}
        {opcion(!origen, "Se montaron más tarde",
          "Se cuenta desde el km del montaje (o desde hoy si no se sabe), con la profundidad de nuevo.",
          () => setOrigen(false))}
        {!origen && (
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="block"><span className="mb-1 block text-[10px] font-semibold uppercase text-slate-400">Km del vehículo al montarlas</span>
              <input className={inputCls} inputMode="numeric" value={kmInicio} onChange={(e) => setKmInicio(e.target.value)}
                placeholder={kmActual != null ? `${kmActual} (hoy)` : "del montaje"} /></label>
            <label className="block"><span className="mb-1 block text-[10px] font-semibold uppercase text-slate-400">Fecha</span>
              <input className={inputCls} type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} /></label>
          </div>
        )}
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="block"><span className="mb-1 block text-[10px] font-semibold uppercase text-slate-400">Profundidad de origen (mm)</span>
            <input className={inputCls} inputMode="decimal" value={profOrigen} onChange={(e) => setProfOrigen(e.target.value)}
              placeholder="la del catálogo" />
            <span className="mt-1 block text-[11px] text-slate-500">En blanco: la de cada referencia del catálogo.</span></label>
          <label className="block"><span className="mb-1 block text-[10px] font-semibold uppercase text-slate-400">Retirar a (mm)</span>
            <input className={inputCls} inputMode="decimal" value={minimo} onChange={(e) => setMinimo(e.target.value)} />
            <span className="mt-1 block text-[11px] text-slate-500">El legal es 1,6 mm.</span></label>
        </div>
        {error && <div className="rounded border border-rose-500/40 bg-rose-500/10 p-2 text-[12px] text-rose-200">{error}</div>}
      </div>
    </Modal>
  );
}

/** Gráfico mm–km: lo medido, continuo; la proyección, a trazos. */
export function GraficoRendimiento({ r }: { r: Rendimiento }) {
  const W = 620, H = 250, x0 = 50, x1 = 600, y0 = 210, y1 = 20;
  const maxKm = Math.max(r.vidaKm ?? 0, r.kmGoma ?? 0, 10000) * 1.08;
  const maxMm = Math.max(r.origenMm ?? 0, 16);
  const X = (km: number) => x0 + (km / maxKm) * (x1 - x0);
  const Y = (mm: number) => y0 - (mm / maxMm) * (y0 - y1);
  const paso = maxKm > 150000 ? 50000 : maxKm > 60000 ? 30000 : 10000;
  const ticks: number[] = [];
  for (let k = 0; k <= maxKm; k += paso) ticks.push(k);
  const hoy = r.kmGoma != null && r.actualMm != null ? { km: r.kmGoma, mm: r.actualMm } : null;
  const fin = hoy && r.vidaKm != null ? { km: r.vidaKm, mm: r.minimoMm } : null;
  const linea = r.puntos.map((p) => `${X(p.km)},${Y(p.mm)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Profundidad frente a kilómetros">
      <line x1={x0} y1={y0} x2={x1} y2={y0} stroke="#334155" />
      <line x1={x0} y1={y1} x2={x0} y2={y0} stroke="#334155" />
      {ticks.map((k) => <text key={k} x={X(k)} y={y0 + 18} textAnchor="middle" fill="#94a3b8" fontSize="11">{miles(k)}</text>)}
      {[0, 5, 10, 15].filter((m) => m <= maxMm).map((m) => (
        <text key={m} x={x0 - 8} y={Y(m) + 4} textAnchor="end" fill="#94a3b8" fontSize="11">{m}</text>))}
      <text x={(x0 + x1) / 2} y={H - 4} textAnchor="middle" fill="#94a3b8" fontSize="11">km del neumático</text>
      <line x1={x0} y1={Y(r.minimoMm)} x2={x1} y2={Y(r.minimoMm)} stroke="#f59e0b" strokeDasharray="5 4" />
      <text x={x0 + 6} y={Y(r.minimoMm) - 5} textAnchor="start" fill="#f59e0b" fontSize="11">retirar {String(r.minimoMm).replace(".", ",")} mm</text>
      <line x1={x0} y1={Y(1.6)} x2={x1} y2={Y(1.6)} stroke="#f43f5e" strokeDasharray="2 4" />
      {r.puntos.length > 1 && <polyline points={linea} fill="none" stroke="#38bdf8" strokeWidth="2.5" />}
      {hoy && fin && <line x1={X(hoy.km)} y1={Y(hoy.mm)} x2={X(fin.km)} y2={Y(fin.mm)} stroke="#38bdf8" strokeWidth="2" strokeDasharray="6 5" />}
      {r.puntos.map((p, i) => <circle key={i} cx={X(p.km)} cy={Y(p.mm)} r={i === 0 ? 4 : 5} fill={i === 0 ? "#94a3b8" : "#38bdf8"} />)}
      {fin && <circle cx={X(fin.km)} cy={Y(fin.mm)} r={6} fill="#f59e0b" />}
      {fin && <text x={X(fin.km)} y={Y(fin.mm) - 12} textAnchor="end" fill="#e2e8f0" fontSize="11">≈ {miles(fin.km)} km</text>}
    </svg>
  );
}

const Kpi = ({ t, v, s, cls = "" }: { t: string; v: string; s?: string; cls?: string }) => (
  <div className="rounded-lg border border-slate-700 bg-slate-900/40 p-2.5">
    <div className="text-[10px] font-bold uppercase text-slate-400">{t}</div>
    <div className={`text-lg font-black tabular-nums ${cls}`}>{v}</div>
    {s && <div className="text-[11px] text-slate-500">{s}</div>}
  </div>
);

const mm = (v: number | null) => (v == null ? "—" : String(Math.round(v * 10) / 10).replace(".", ","));

/** Bloque de la ficha del vehículo. No pinta nada si el vehículo no está en seguimiento. */
export function BloqueRendimientoVehiculo({
  vehiculoId, activo, esAdmin, onCambio,
}: { vehiculoId: string; activo: boolean; esAdmin: boolean; onCambio: () => void }) {
  const [filas, setFilas] = useState<DatosRendimiento[]>([]);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!activo) return;
    let vivo = true;
    datosRendimiento({ vehiculoId })
      .then((d) => { if (vivo) setFilas(d); })
      .catch((e) => { if (vivo) setError(e?.message ?? "Error"); });
    return () => { vivo = false; };
  }, [vehiculoId, activo]);
  if (!activo) return null;

  const conCalculo = filas.map((f) => ({ f, r: calcularRendimiento(f) }));
  const proximo = conCalculo.filter((x) => x.r.vidaKm != null)
    .sort((a, b) => (a.r.quedanKm ?? 0) - (b.r.quedanKm ?? 0))[0];
  const origen = filas[0];

  async function dejar() {
    if (!confirm("¿Dejar de seguir el rendimiento de este vehículo? Lo medido se conserva.")) return;
    try { await desactivarSeguimientoRendimiento(vehiculoId); onCambio(); }
    catch (e) { setError(e instanceof Error ? e.message : "Error"); }
  }

  return (
    <div className="mt-3 rounded-lg border border-amber-600/40 bg-slate-800 p-3">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <div className="text-[11px] font-bold uppercase text-amber-300">★ Rendimiento de neumáticos</div>
        {origen && <span className="text-[11px] text-slate-400">
          {origen.desde_origen ? "desde 0 km (gomas de origen)" : `desde ${miles(origen.km_vehiculo_inicio)} km`} · retirar a {mm(origen.minimo_mm)} mm
        </span>}
        {esAdmin && <button onClick={() => void dejar()} className="ml-auto rounded border border-slate-600 px-2 py-1 text-[11px] text-slate-300">Dejar de seguir</button>}
      </div>
      {error && <div className="text-[12px] text-rose-300">{error}</div>}
      {proximo && (
        <div className="mb-2 text-[12px] text-slate-300">
          Siguiente cambio previsto: <b>{proximo.f.posicion}</b> hacia los <b>{miles(proximo.r.vidaKm)} km</b> (le quedan ≈ {miles(proximo.r.quedanKm)} km).
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-[12px] tabular-nums">
          <thead className="text-slate-400"><tr className="border-b border-slate-700 text-left">
            <th className="py-1.5">Posición</th><th>Goma</th><th>Origen</th><th>Hoy</th><th>Gastado</th><th>Km</th><th>km/mm</th><th>Vida proyectada</th><th>Le quedan</th>
          </tr></thead>
          <tbody>
            {conCalculo.map(({ f, r }) => (
              <tr key={f.neumatico_id} className="border-b border-slate-700/50">
                <td className="py-1.5 font-semibold text-slate-200">{f.posicion}</td>
                <td><Link className="text-sky-300 hover:underline" to={`/tyrecontrol/neumaticos/${f.neumatico_id}`}>{f.modelo ?? "—"}</Link>
                  {f.recauchutado && <span className="ml-1 text-[10px] font-bold text-violet-300">RECAUCH.</span>}
                  {f.reesculturado && <span className="ml-1 text-[10px] font-bold text-sky-300">REESC.</span>}</td>
                <td>{mm(r.origenMm)}</td><td>{mm(r.actualMm)}</td><td>{mm(r.gastadoMm)}</td><td>{miles(r.kmGoma)}</td>
                <td className="font-bold text-emerald-300">{miles(r.kmPorMm)}</td>
                <td>{r.vidaKm != null ? `≈ ${miles(r.vidaKm)}` : <span className="text-slate-500">{r.sinProyeccion}</span>}</td>
                <td>{r.quedanKm != null ? `≈ ${miles(r.quedanKm)}` : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Tarjeta de la ficha del neumático. No pinta nada si su vehículo no está en seguimiento. */
export function TarjetaRendimientoNeumatico({ neumaticoId }: { neumaticoId: string }) {
  const [fila, setFila] = useState<DatosRendimiento | null>(null);
  useEffect(() => {
    let vivo = true;
    datosRendimiento()
      .then((d) => { if (vivo) setFila(d.find((x) => x.neumatico_id === neumaticoId) ?? null); })
      .catch(() => { if (vivo) setFila(null); });
    return () => { vivo = false; };
  }, [neumaticoId]);
  if (!fila) return null;
  const r = calcularRendimiento(fila);
  return (
    <div className="mt-3 rounded-lg border border-amber-600/40 bg-slate-800 p-3">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <div className="text-[11px] font-bold uppercase text-amber-300">★ Rendimiento y proyección</div>
        <span className="text-[11px] text-slate-400">{fila.posicion} · {fila.matricula}{fila.desde_origen ? " · goma de origen" : ""}</span>
      </div>
      <div className="mb-3 grid gap-2 sm:grid-cols-4">
        <Kpi t="Origen → hoy" v={`${mm(r.origenMm)} → ${mm(r.actualMm)} mm`} s={`gastados ${mm(r.gastadoMm)} mm`} />
        <Kpi t="Km con esta goma" v={`${miles(r.kmGoma)} km`} s={fila.fuente_inicio === "manual" ? "origen indicado a mano" : "origen del catálogo"} />
        <Kpi t="Rendimiento" v={r.kmPorMm != null ? `${miles(r.kmPorMm)} km/mm` : "—"} cls="text-emerald-300"
          s={r.metodo === "recta" ? `recta con ${r.puntos.length} mediciones` : r.metodo === "origen" ? "del origen a hoy" : undefined} />
        <Kpi t={`Proyección a ${mm(r.minimoMm)} mm`} v={r.vidaKm != null ? `≈ ${miles(r.vidaKm)} km` : "—"}
          s={r.quedanKm != null ? `le quedan ≈ ${miles(r.quedanKm)} km` : r.sinProyeccion ?? undefined} />
      </div>
      <GraficoRendimiento r={r} />
      <div className="text-[11px] text-slate-500">Continuo: lo medido. A trazos: la proyección. Cada revisión añade un punto; con 3 o más se ajusta una recta a todos.</div>
    </div>
  );
}
