import { useEffect, useState } from "react";
import { Gauge, History, Hourglass } from "lucide-react";
import {
  estadoKilometraje, estadoRelleno, estadoRevisiones, pararRelleno, pararRevisiones,
  rellenarKilometraje, rellenarRevisiones, sincronizarKilometraje,
  type EstadoCuenta, type ResumenCuentaMensual, type TareaRelleno, type TareaRevisiones,
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
 *
 * Debajo, la otra herramienta: rellenar meses viejos de la flota entera a
 * gotas, una unidad cada veinte segundos. Son horas —o días, con varios
 * meses—, así que la lleva el servidor y aquí solo se arranca, se mira el
 * progreso y se para.
 */
export default function SincronizacionKilometraje({ empresaId, cuenta }: { empresaId: string; cuenta: CuentaTelematica | null }) {
  const [estado, setEstado] = useState<EstadoCuenta | null>(null);
  const [resultado, setResultado] = useState<ResumenCuentaMensual | null>(null);
  const [mesAnterior, setMesAnterior] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState("");
  // Relleno lento: un mes viejo de la flota entera, a gotas.
  const [tarea, setTarea] = useState<TareaRelleno | null>(null);
  const mesAnteriorClave = () => {
    const a = new Date();
    const m = a.getMonth() === 0 ? 12 : a.getMonth();
    const y = a.getMonth() === 0 ? a.getFullYear() - 1 : a.getFullYear();
    return `${y}-${String(m).padStart(2, "0")}`;
  };
  const [desdeRelleno, setDesdeRelleno] = useState(mesAnteriorClave);
  const [hastaRelleno, setHastaRelleno] = useState(mesAnteriorClave);
  // El otro relleno: el odómetro que marcaba cada autobús en cada revisión.
  const [revs, setRevs] = useState<TareaRevisiones | null>(null);

  async function cargarEstado() {
    if (!cuenta) return;
    try {
      const { cuentas } = await estadoKilometraje(empresaId);
      setEstado(cuentas.find((c) => c.connectorKey === cuenta.connectorKey && c.accountKey === cuenta.accountKey) ?? null);
    } catch { setEstado(null); }
  }

  async function cargarTarea() {
    if (!cuenta) return;
    try {
      const { tareas } = await estadoRelleno(empresaId);
      setTarea(tareas.find((t) => t.connectorKey === cuenta.connectorKey && t.accountKey === cuenta.accountKey) ?? null);
    } catch { /* que no se pierda el panel por no poder mirar el progreso */ }
  }

  async function cargarRevs() {
    try {
      setRevs((await estadoRevisiones(empresaId)).tarea);
    } catch { /* que no se pierda el panel por no poder mirar el progreso */ }
  }

  useEffect(() => {
    void cargarEstado(); void cargarTarea(); void cargarRevs();
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [empresaId, cuenta?.connectorKey, cuenta?.accountKey]);

  useEffect(() => {
    if (revs?.estado !== "en_curso") return;
    const t = setInterval(() => void cargarRevs(), 10_000);
    return () => clearInterval(t);
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [revs?.estado, empresaId]);

  async function lanzarRevisiones() {
    if (!confirm(
      "Se buscará en la telemática el odómetro que marcaba cada autobús en el momento de cada " +
      "revisión que no tenga kilometraje, de UNA EN UNA y a una revisión cada 20 segundos.\n\n" +
      "Primero se le pregunta al proveedor hasta dónde llega su histórico, y no se pide nada " +
      "anterior: preguntar por años que no guarda no es lento, es imposible.\n\n" +
      "Un número solo se escribe si dos consultas distintas coinciden y encaja con las revisiones " +
      "vecinas y con el mes ya sincronizado. Nunca pisa un kilometraje puesto a mano.\n\n" +
      "Son horas, sigue en el servidor y puedes pararlo. ¿Seguir?",
    )) return;
    setError("");
    try {
      setRevs((await rellenarRevisiones({ empresaId })).tarea);
    } catch (e: any) {
      setError(e?.message ?? "No se pudo arrancar el relleno de revisiones");
    }
  }

  async function detenerRevisiones() {
    try {
      setRevs((await pararRevisiones({ empresaId })).tarea);
    } catch (e: any) {
      setError(e?.message ?? "No se pudo parar");
    }
  }

  // Mientras hay relleno, se refresca solo: son horas, y nadie va a estar
  // pulsando F5. Cada diez segundos es a nuestra base, no al proveedor.
  useEffect(() => {
    if (tarea?.estado !== "en_curso") return;
    const t = setInterval(() => void cargarTarea(), 10_000);
    return () => clearInterval(t);
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [tarea?.estado, empresaId, cuenta?.connectorKey, cuenta?.accountKey]);

  const aMes = (clave: string) => {
    const [y, m] = clave.split("-").map(Number);
    return y && m ? { year: y, month: m } : null;
  };

  async function lanzarRelleno() {
    if (!cuenta) return;
    const desde = aMes(desdeRelleno);
    const hasta = aMes(hastaRelleno);
    if (!desde || !hasta) { setError("Mes inválido"); return; }
    const cuantos = (hasta.year - desde.year) * 12 + (hasta.month - desde.month) + 1;
    if (cuantos < 1) { setError("«Desde» es posterior a «hasta»"); return; }
    const rango = desdeRelleno === hastaRelleno ? desdeRelleno : `${desdeRelleno} a ${hastaRelleno}`;
    if (!confirm(
      `Se pedirán a ${cuenta.connectorKey} los kilómetros de ${rango} (${cuantos} ${cuantos === 1 ? "mes" : "meses"}) ` +
      `de TODOS los vehículos enlazados que aún no los tengan, de UNO EN UNO y a un vehículo cada 20 segundos.\n\n` +
      `Con una flota grande y varios meses esto son DÍAS, no horas. Sigue en el servidor aunque cierres la ` +
      `pantalla y aunque se despliegue, y puedes pararlo cuando quieras. ¿Seguir?`,
    )) return;
    setError("");
    try {
      const r = await rellenarKilometraje({
        empresaId, connectorKey: cuenta.connectorKey, accountKey: cuenta.accountKey, desde, hasta,
      });
      setTarea(r.tarea);
    } catch (e: any) {
      setError(e?.message ?? "No se pudo arrancar el relleno");
    }
  }

  async function detenerRelleno() {
    if (!cuenta) return;
    try {
      const r = await pararRelleno({ empresaId, connectorKey: cuenta.connectorKey, accountKey: cuenta.accountKey });
      setTarea(r.tarea);
    } catch (e: any) {
      setError(e?.message ?? "No se pudo parar el relleno");
    }
  }

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

      {/* Relleno lento de un mes viejo: lo contrario del botón de arriba. */}
      <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-slate-700 pt-3">
        <div className="flex items-center gap-1 font-bold text-slate-200">
          <Hourglass className="h-4 w-4" /> Rellenar meses, a gotas
        </div>
        <input
          type="month"
          value={desdeRelleno}
          onChange={(e) => setDesdeRelleno(e.target.value)}
          disabled={tarea?.estado === "en_curso"}
          className="rounded-lg border border-slate-600 bg-slate-900 px-2 py-1 text-slate-200 disabled:opacity-40"
        />
        <span className="text-slate-400">a</span>
        <input
          type="month"
          value={hastaRelleno}
          onChange={(e) => setHastaRelleno(e.target.value)}
          disabled={tarea?.estado === "en_curso"}
          className="rounded-lg border border-slate-600 bg-slate-900 px-2 py-1 text-slate-200 disabled:opacity-40"
        />
        <span className="text-slate-400">un vehículo cada 20 s</span>
        {tarea?.estado === "en_curso" ? (
          <button
            onClick={() => void detenerRelleno()}
            className="ml-auto rounded-lg border border-amber-600 px-3 py-1.5 font-bold text-amber-300 hover:bg-amber-500/10"
          >
            Parar
          </button>
        ) : (
          <button
            onClick={() => void lanzarRelleno()}
            className="ml-auto rounded-lg border border-sky-600 px-3 py-1.5 font-bold text-sky-300 hover:bg-sky-500/10"
          >
            Rellenar
          </button>
        )}
      </div>

      {tarea && (
        <div className="mt-2 grid gap-x-4 gap-y-1 text-slate-300 sm:grid-cols-3 lg:grid-cols-4">
          <span>
            Estado: <b className={tarea.estado === "abandonada" ? "text-amber-300" : ""}>{tarea.estado.replace("_", " ")}</b>
          </span>
          <span>Con km: <b>{tarea.hechos}</b> · sin datos: <b>{tarea.sinDatos}</b></span>
          <span>Pendientes: <b>{tarea.pendientes}</b> de {tarea.total}</span>
          <span>Queda: <b>{tarea.restanteEnPalabras}</b></span>
          {tarea.ultimo && (
            <span className="sm:col-span-3 lg:col-span-4">
              Último: <b>{tarea.ultimo.vehiculo}</b> ({tarea.ultimo.mes}) → {tarea.ultimo.resultado}
            </span>
          )}
          {!!tarea.fallidos && <span className="text-amber-300">Fallidos: <b>{tarea.fallidos}</b></span>}
          {tarea.nota && <span className="text-slate-400 sm:col-span-3 lg:col-span-4">{tarea.nota}</span>}
          {!!tarea.muestraErrores?.length && (
            <span className="text-amber-300 sm:col-span-3 lg:col-span-4">Primer error: {tarea.muestraErrores[0]}</span>
          )}
        </div>
      )}

      {/* El odómetro de cada revisión del histórico. */}
      <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-slate-700 pt-3">
        <div className="flex items-center gap-1 font-bold text-slate-200">
          <History className="h-4 w-4" /> Kilómetros del histórico de revisiones
        </div>
        <span className="text-slate-400">una revisión cada 20 s</span>
        {revs?.estado === "en_curso" ? (
          <button
            onClick={() => void detenerRevisiones()}
            className="ml-auto rounded-lg border border-amber-600 px-3 py-1.5 font-bold text-amber-300 hover:bg-amber-500/10"
          >
            Parar
          </button>
        ) : (
          <button
            onClick={() => void lanzarRevisiones()}
            className="ml-auto rounded-lg border border-sky-600 px-3 py-1.5 font-bold text-sky-300 hover:bg-sky-500/10"
          >
            Rellenar revisiones
          </button>
        )}
      </div>

      {revs && (
        <div className="mt-2 grid gap-x-4 gap-y-1 text-slate-300 sm:grid-cols-3 lg:grid-cols-4">
          <span>Estado: <b>{revs.estado.replace("_", " ")}</b></span>
          <span>Escritas: <b>{revs.escritas}</b> de {revs.totalAlEmpezar}</span>
          <span>
            Sin lectura: <b>{revs.sinLectura}</b>
            {" · "}rechazadas: <b className={revs.rechazadas ? "text-amber-300" : ""}>{revs.rechazadas}</b>
          </span>
          <span>Queda: <b>{revs.restanteEnPalabras}</b></span>
          {revs.ultima && (
            <span className="sm:col-span-3 lg:col-span-4">
              Última: <b>{revs.ultima.fecha}</b> → {revs.ultima.resultado}
            </span>
          )}
          {revs.notaHorizonte && (
            <span className="text-slate-400 sm:col-span-3 lg:col-span-4">
              Desde <b>{revs.desde ?? "el principio"}</b> · {revs.notaHorizonte}
            </span>
          )}
          {revs.nota && <span className="text-slate-400 sm:col-span-3 lg:col-span-4">{revs.nota}</span>}
          {!!revs.muestraMotivos?.length && (
            <span className="text-amber-300 sm:col-span-3 lg:col-span-4">
              Primer descarte: {revs.muestraMotivos[0]}
            </span>
          )}
        </div>
      )}

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
          <span>
            Lote: <b>{d.unidadesPorPeticion ?? "—"}</b> uds
            {d.ritmo && <> · ritmo <b>{d.ritmo.maximo}</b>/{Math.round(d.ritmo.ventanaMs / 60000)} min</>}
            {d.zonaHoraria ? ` · ${d.zonaHoraria}` : ""}
          </span>
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
