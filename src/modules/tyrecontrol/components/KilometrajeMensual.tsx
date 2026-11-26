import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { useTyreAuth } from "../contexts/TyreAuthContext";
import {
  kilometrajeDeVehiculo, nombreDeMes, sincronizarKilometraje,
  type KilometrajeVehiculo,
} from "../services/kilometrajeMensual";
import { listarCuentas } from "../services/conciliacion";
import KmEnFecha from "./KmEnFecha";

/**
 * Kilómetros mensuales del vehículo, según la telemática.
 *
 * Lee de nuestra base: abrir la ficha NO pregunta a Movertis. Lo que se ve es
 * lo que dejó la última sincronización (diaria, de madrugada), con su fecha.
 * El botón de sincronizar es la excepción explícita, y solo para
 * administradores: pide al servidor el mes en curso y el anterior de ESTE
 * vehículo, que son dos peticiones al proveedor y no setecientas.
 *
 * Sin telemática configurada, el bloque no se enseña: un cliente sin Movertis
 * no tiene por qué ver un cuadro vacío con un aviso.
 */
export default function KilometrajeMensual({ vehiculoId }: { vehiculoId: string }) {
  const { perfil } = useTyreAuth();
  const esAdmin = !!(perfil?.es_superadmin || perfil?.rol === "administrador");
  const [datos, setDatos] = useState<KilometrajeVehiculo | null>(null);
  const [error, setError] = useState("");
  const [sincronizando, setSincronizando] = useState(false);
  const [msg, setMsg] = useState("");
  const [verTodos, setVerTodos] = useState(false);

  async function cargar() {
    try {
      setDatos(await kilometrajeDeVehiculo(vehiculoId));
      setError("");
    } catch (e: any) {
      setError(e?.message ?? "No se pudieron leer los kilómetros");
    }
  }

  useEffect(() => { void cargar(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [vehiculoId]);

  async function sincronizar() {
    if (!datos) return;
    setSincronizando(true); setMsg("");
    try {
      // La cuenta se elige sola si hay una; con varias, se sincroniza en todas
      // las que tengan a este vehículo enlazado (las demás no lo tendrán y
      // contestan «0 enlazados», que no cuesta ninguna petición).
      const { cuentas } = await listarCuentas(datos.empresaId);
      if (cuentas.length === 0) { setMsg("La empresa no tiene cuenta de telemática."); return; }
      const ahora = new Date();
      const actual = { year: ahora.getFullYear(), month: ahora.getMonth() + 1 };
      const anterior = actual.month === 1 ? { year: actual.year - 1, month: 12 } : { year: actual.year, month: actual.month - 1 };
      const partes: string[] = [];
      for (const c of cuentas) {
        const r = await sincronizarKilometraje({
          empresaId: datos.empresaId, connectorKey: c.connectorKey, accountKey: c.accountKey,
          desde: anterior, hasta: actual, vehiculoIds: [vehiculoId], forzar: true,
        });
        for (const cu of r.cuentas) {
          if (cu.vehiculosEnlazados === 0) continue;
          partes.push(
            cu.abandonada
              ? `${cu.nombre ?? cu.accountKey}: ${cu.abandonada}`
              : `${cu.nombre ?? cu.accountKey}: ${cu.peticiones} peticiones, ${Math.round(cu.kmTotales).toLocaleString("es-ES")} km` +
                (cu.errores ? ` · ${cu.errores} errores (${cu.muestraErrores[0] ?? ""})` : ""),
          );
        }
      }
      setMsg(partes.length ? `✔ ${partes.join(" · ")}` : "Este vehículo no está enlazado con ninguna cuenta de telemática.");
      await cargar();
    } catch (e: any) {
      setMsg(e?.message ?? "Error al sincronizar");
    } finally {
      setSincronizando(false);
    }
  }

  if (!datos || !datos.hayTelemetria) {
    // Sin telemática, no hay cuadro de meses; «km en una fecha» sí, que sale
    // también de las revisiones y los montajes. Un error de red no se grita.
    return (
      <div className="mt-3">
        {error && esAdmin && <div className="mb-2 text-[11px] text-slate-500">Kilómetros mensuales: {error}</div>}
        {datos && <div className="max-w-xs"><KmEnFecha vehiculoId={vehiculoId} /></div>}
      </div>
    );
  }

  const km = (v: number | null | undefined) => (v == null ? "—" : `${Math.round(v).toLocaleString("es-ES")} km`);
  const odo = (v: number) => Math.round(v).toLocaleString("es-ES");
  const hoy = new Date();
  const esMesActual = (m: { year: number; month: number }) => m.year === hoy.getFullYear() && m.month === hoy.getMonth() + 1;
  const meses = verTodos ? datos.meses : datos.meses.slice(0, 6);
  const ultimaSync = datos.meses.length ? Math.max(...datos.meses.map((m) => m.sincronizadoMs)) : null;

  return (
    <div className="mt-3 rounded-lg bg-slate-800 p-3">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <div className="text-[11px] font-bold uppercase text-slate-400">Kilómetros mensuales</div>
        <span className="rounded-full bg-slate-700 px-2 py-0.5 text-[10px] text-slate-300">telemetría</span>
        {ultimaSync && (
          <span className="text-[10px] text-slate-500">
            actualizado {new Date(ultimaSync).toLocaleString("es-ES", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
          </span>
        )}
        {esAdmin && (
          <button
            onClick={() => void sincronizar()}
            disabled={sincronizando}
            title="Pide al proveedor el mes en curso y el anterior de este vehículo"
            className="ml-auto flex items-center gap-1 rounded-lg border border-sky-600 px-2 py-1 text-[11px] font-bold text-sky-300 hover:bg-sky-500/10 disabled:opacity-40"
          >
            <RefreshCw className={`h-3 w-3 ${sincronizando ? "animate-spin" : ""}`} /> Sincronizar
          </button>
        )}
      </div>

      {datos.meses.length === 0 ? (
        <div className="grid gap-3 md:grid-cols-[1fr_auto]">
          <div className="text-xs text-slate-500">
            Todavía sin datos: la sincronización diaria los trae de madrugada, o pulsa «Sincronizar».
          </div>
          <div className="md:min-w-[180px]"><KmEnFecha vehiculoId={vehiculoId} /></div>
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-[1fr_auto]">
          <table className="text-xs">
            <thead>
              <tr className="text-[10px] text-slate-500">
                <th className="pb-1 pr-4 text-left font-normal">Mes</th>
                <th className="pb-1 pr-3 text-right font-normal">Recorridos</th>
                <th className="pb-1" />
                <th className="pb-1 pr-3 text-right font-normal">Odómetro al empezar</th>
                <th className="pb-1 text-right font-normal">Odómetro al cerrar</th>
              </tr>
            </thead>
            <tbody>
              {meses.map((m) => (
                <tr key={`${m.year}-${m.month}`} className="border-b border-slate-700/60 last:border-0">
                  <td className="py-1 pr-4 capitalize text-slate-300">{nombreDeMes(m.year, m.month)}</td>
                  <td className="py-1 pr-3 text-right font-bold tabular-nums text-slate-100">
                    {m.estado === "ok" ? km(m.km) : (
                      <span className="font-normal text-slate-500"
                        title={m.estado === "empty"
                          ? "El proveedor contestó, pero no tiene viajes de este vehículo ese mes: estuvo parado, con el equipo apagado o sin enlazar."
                          : undefined}>
                        {m.estado === "empty" && !esMesActual(m) ? "sin viajes" : "sin datos"}
                      </span>
                    )}
                  </td>
                  <td className="py-1 text-[10px] text-slate-500">
                    {/* «En curso» solo el mes de hoy: un mes pasado sin viajes no se
                        marca cerrado (no hay con qué contrastarlo) y salía «en curso». */}
                    {esMesActual(m) && m.estado !== "error" && "en curso"}
                    {m.estado === "error" && <span className="text-amber-400" title={m.error ?? ""}>error al sincronizar</span>}
                  </td>
                  {/* El cierre del mes en curso no es el del último día: es el de la
                      última sincronización. Se deja en blanco hasta que cierre. */}
                  <td className="py-1 pr-3 text-right tabular-nums text-slate-300">{m.estado === "ok" && m.odometroInicial ? odo(m.odometroInicial) : <span className="text-slate-600">—</span>}</td>
                  <td className="py-1 text-right tabular-nums text-slate-300">{m.estado === "ok" && !esMesActual(m) && m.odometroFinal ? odo(m.odometroFinal) : <span className="text-slate-600">—</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="flex flex-col gap-2 md:min-w-[180px]">
            <KmEnFecha vehiculoId={vehiculoId} />
            <div className="rounded-lg border border-slate-600 bg-slate-900 px-3 py-2">
              <div className="text-[10px] text-slate-400">Año {datos.anioActual.year}</div>
              <div className="text-sm font-black text-slate-100">{km(datos.anioActual.km)}</div>
              <div className="text-[10px] text-slate-500">{datos.anioActual.mesesConDato} meses con dato</div>
            </div>
            <div className="rounded-lg border border-slate-600 bg-slate-900 px-3 py-2">
              <div className="text-[10px] text-slate-400">Media mensual</div>
              <div className="text-sm font-black text-slate-100">{km(datos.mediaMensual.km)}</div>
              <div className="text-[10px] text-slate-500">
                {datos.mediaMensual.meses ? `sobre ${datos.mediaMensual.meses} meses completos` : "sin meses completos"}
              </div>
            </div>
          </div>
        </div>
      )}

      {datos.meses.length > 6 && (
        <button className="mt-2 text-[11px] text-sky-300 underline" onClick={() => setVerTodos((v) => !v)}>
          {verTodos ? "Ver menos" : `Ver los ${datos.meses.length} meses`}
        </button>
      )}
      {msg && <div className="mt-2 text-[11px] text-slate-300">{msg}</div>}
    </div>
  );
}
