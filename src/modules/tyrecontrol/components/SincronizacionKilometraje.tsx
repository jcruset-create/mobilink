import { useEffect, useState } from "react";
import { Gauge } from "lucide-react";
import {
  estadoKilometraje, sincronizarKilometraje,
  type EstadoCuenta, type ResumenCuentaMensual,
} from "../services/kilometrajeMensual";
import type { CuentaTelematica } from "../services/conciliacion";

/**
 * Kilómetros mensuales de la flota: estado de la última pasada y el botón para
 * lanzarla a mano sobre la cuenta elegida.
 *
 * Es la herramienta de la prueba controlada y de la resincronización: el job
 * diario hace lo mismo solo, de madrugada. Cada pasada va por lotes y al
 * ritmo del limitador, así que una flota grande con varios meses puede tardar
 * minutos; si el navegador se cansa antes, el servidor sigue y el resultado
 * queda en «Última pasada».
 */
export default function SincronizacionKilometraje({ empresaId, cuenta }: { empresaId: string; cuenta: CuentaTelematica | null }) {
  const [estado, setEstado] = useState<EstadoCuenta | null>(null);
  const [resultado, setResultado] = useState<ResumenCuentaMensual | null>(null);
  const [mesAnterior, setMesAnterior] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState("");

  async function cargarEstado() {
    if (!cuenta) return;
    try {
      const { cuentas } = await estadoKilometraje(empresaId);
      setEstado(cuentas.find((c) => c.connectorKey === cuenta.connectorKey && c.accountKey === cuenta.accountKey) ?? null);
    } catch { setEstado(null); }
  }

  useEffect(() => { void cargarEstado(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [empresaId, cuenta?.connectorKey, cuenta?.accountKey]);

  async function lanzar() {
    if (!cuenta) return;
    const ahora = new Date();
    const actual = { year: ahora.getFullYear(), month: ahora.getMonth() + 1 };
    const anterior = actual.month === 1 ? { year: actual.year - 1, month: 12 } : { year: actual.year, month: actual.month - 1 };
    if (!confirm(
      `Se pedirán a ${cuenta.connectorKey} los kilómetros ${mesAnterior ? "del mes anterior y del mes en curso" : "del mes en curso"} ` +
      `de TODOS los vehículos enlazados de esta cuenta, por lotes y respetando el límite del proveedor.\n\n¿Seguir?`,
    )) return;
    setOcupado(true); setError(""); setResultado(null);
    try {
      const r = await sincronizarKilometraje({
        empresaId, connectorKey: cuenta.connectorKey, accountKey: cuenta.accountKey,
        desde: mesAnterior ? anterior : actual, hasta: actual, forzar: mesAnterior,
      });
      setResultado(r.cuentas[0] ?? null);
      await cargarEstado();
    } catch (e: any) {
      setError(e?.message ?? "Error al sincronizar");
    } finally {
      setOcupado(false);
    }
  }

  if (!cuenta) return null;

  const d = resultado ?? (estado?.detalle as ResumenCuentaMensual | null);
  const fecha = (ms?: number | null) => (ms ? new Date(ms).toLocaleString("es-ES", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—");

  return (
    <div className="mb-3 rounded-2xl border border-slate-700 bg-slate-800 p-3 text-xs">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1 font-bold text-slate-200"><Gauge className="h-4 w-4" /> Kilómetros mensuales</div>
        <div className="text-slate-400">
          Última pasada: {fecha(estado?.ultimaMs)}
          {estado?.status && <span className={`ml-1 rounded px-1.5 py-0.5 text-[10px] ${estado.status === "ok" ? "bg-emerald-500/20 text-emerald-300" : "bg-amber-500/20 text-amber-300"}`}>{estado.status}</span>}
        </div>
        <label className="ml-auto flex items-center gap-1 text-slate-300">
          <input type="checkbox" className="accent-sky-500" checked={mesAnterior} onChange={(e) => setMesAnterior(e.target.checked)} />
          también el mes anterior
        </label>
        <button
          onClick={() => void lanzar()}
          disabled={ocupado}
          className="rounded-lg border border-sky-600 px-3 py-1.5 font-bold text-sky-300 hover:bg-sky-500/10 disabled:opacity-40"
        >
          {ocupado ? "Sincronizando…" : "Sincronizar flota"}
        </button>
      </div>

      {error && <div className="mt-2 text-amber-300">{error}</div>}

      {d && (
        <div className="mt-2 grid gap-x-4 gap-y-1 text-slate-300 sm:grid-cols-3 lg:grid-cols-5">
          <span>Enlazados: <b>{d.vehiculosEnlazados ?? "—"}</b></span>
          <span>Procesados: <b>{d.vehiculosProcesados ?? "—"}</b></span>
          <span>Con km: <b>{d.vehiculosConKm ?? "—"}</b></span>
          <span>Sin datos: <b>{d.vehiculosSinDatos ?? "—"}</b></span>
          <span>Lotes / peticiones: <b>{d.lotes ?? "—"} / {d.peticiones ?? "—"}</b></span>
          <span>Errores: <b className={d.errores ? "text-amber-300" : ""}>{d.errores ?? "—"}</b></span>
          <span>Tiempo: <b>{d.inicioMs && d.finMs ? `${Math.round((d.finMs - d.inicioMs) / 1000)} s` : "—"}</b></span>
          <span>Km del conjunto: <b>{d.kmTotales != null ? `${Math.round(d.kmTotales).toLocaleString("es-ES")} km` : "—"}</b></span>
          <span>Lote: <b>{d.unidadesPorPeticion ?? "—"}</b> uds · {d.zonaHoraria ?? ""}</span>
          <span>Meses: <b>{(d.meses ?? []).join(", ") || "—"}</b></span>
          {d.abandonada && <span className="text-amber-300 sm:col-span-3 lg:col-span-5">Abandonada: {d.abandonada}</span>}
          {!!d.muestraErrores?.length && (
            <span className="text-amber-300 sm:col-span-3 lg:col-span-5">Primer error: {d.muestraErrores[0]}</span>
          )}
        </div>
      )}
    </div>
  );
}
