/**
 * «Probar con Movertis»: el resumen de viajes de UN vehículo pedido con
 * varias ventanas, y el de otra unidad que funciona como control. No guarda
 * nada. Sirve para estar seguro de qué falla antes de escribir al proveedor,
 * y «Copiar para Movertis» deja en el portapapeles las peticiones exactas y lo
 * que contestó cada una.
 */
import { useState } from "react";
import { probarVehiculo, type PruebaVehiculo, type RespuestaPrueba } from "../services/kilometrajeMensual";
import { Modal } from "./ui";

const fmt = (n: number | null | undefined) => (n == null ? "—" : Math.round(n).toLocaleString("es-ES"));
const fecha = (iso: string) => new Date(iso).toLocaleString("es-ES", { timeZone: "Europe/Madrid", dateStyle: "short", timeStyle: "short" });

function textoRespuesta(r: RespuestaPrueba): string {
  if (r.tipo === "ok") return `${fmt(r.km)} km${r.viajes != null ? ` · ${r.viajes} viajes` : ""}${r.odometroInicial != null ? ` · odómetro ${fmt(r.odometroInicial)} → ${fmt(r.odometroFinal)}` : ""}`;
  if (r.tipo === "vacio") return "Contesta, pero sin datos de esta unidad";
  if (r.tipo === "sin_turno") return "No pedida: límite de peticiones (repite en unos minutos)";
  return r.mensaje;
}

/** Mes por defecto: el primero con error de este vehículo o, si no, el anterior al actual. */
function mesPorDefecto(conError?: Array<{ year: number; month: number }>): string {
  const m = conError?.[0];
  if (m) return `${m.year}-${String(m.month).padStart(2, "0")}`;
  const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export default function ProbarMovertis({ vehiculoId, matricula, empresaId, mesesConError, onClose }: {
  vehiculoId: string; matricula: string | null; empresaId: string;
  mesesConError?: Array<{ year: number; month: number }>;
  onClose: () => void;
}) {
  const [mes, setMes] = useState(mesPorDefecto(mesesConError));
  const [probando, setProbando] = useState(false);
  const [error, setError] = useState("");
  const [prueba, setPrueba] = useState<PruebaVehiculo | null>(null);
  const [copiado, setCopiado] = useState(false);

  async function probar() {
    const [year, month] = mes.split("-").map(Number);
    setProbando(true); setError(""); setPrueba(null); setCopiado(false);
    try {
      setPrueba(await probarVehiculo({ empresaId, vehiculoId, year, month }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo hacer la prueba");
    } finally {
      setProbando(false);
    }
  }

  async function copiar() {
    if (!prueba) return;
    const lineas = [
      `Prueba de POST /vehicle/summarytrips — ${prueba.matricula ?? ""} (unidad ${prueba.unidad}) — ${fecha(prueba.probadoEn)}`,
      "",
      ...prueba.resultados.map((r) =>
        `· ${r.etiqueta} [unidad ${r.unidad}]\n  petición: ${JSON.stringify(r.peticion)}\n  resultado: ${r.respuesta.tipo.toUpperCase()} — ${textoRespuesta(r.respuesta)}`),
      "",
      `Conclusión: ${prueba.conclusion}`,
    ];
    try {
      await navigator.clipboard.writeText(lineas.join("\n"));
      setCopiado(true);
    } catch {
      setError("No se ha podido copiar al portapapeles");
    }
  }

  return (
    <Modal title={`Probar con Movertis · ${matricula ?? "vehículo"}`} onClose={onClose} size="lg"
      footer={
        <div className="flex flex-wrap items-center justify-end gap-2">
          {prueba && (
            <button onClick={() => void copiar()} className="rounded-lg border border-sky-600 px-3 py-2 text-sm font-bold text-sky-300 hover:bg-sky-500/10">
              {copiado ? "✔ Copiado" : "Copiar para Movertis"}
            </button>
          )}
          <button onClick={onClose} className="rounded-lg border border-slate-600 px-4 py-2 text-sm text-slate-200">Cerrar</button>
        </div>
      }>
      <div className="grid gap-3 text-sm">
        <p className="text-[12px] text-slate-400">
          Pide a Movertis el resumen de viajes de este vehículo con varias ventanas (el mes entero, las dos quincenas,
          una semana, un día y el mes anterior) y el mismo mes de otra unidad que sí funciona, para comparar.
          <b className="text-slate-300"> No guarda nada.</b> Son 7 peticiones, por el mismo límite que la sincronización de la noche.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor="probar-mes" className="text-[12px] text-slate-400">Mes</label>
          <input id="probar-mes" type="month" value={mes} onChange={(e) => setMes(e.target.value)}
            className="rounded-lg border border-slate-600 bg-slate-900 px-2 py-1 text-base text-slate-100 sm:text-sm" />
          <button onClick={() => void probar()} disabled={probando || !mes}
            className="rounded-lg bg-sky-600 px-4 py-1.5 text-sm font-bold text-white disabled:opacity-50">
            {probando ? "Probando… (hasta un par de minutos)" : "🔬 Probar"}
          </button>
        </div>
        {error && <div className="rounded-lg bg-red-500/10 p-3 text-red-300">{error}</div>}

        {prueba && (
          <>
            <div className={`rounded-lg border p-3 ${/problema es de Movertis|fallo general/.test(prueba.conclusion) ? "border-rose-500/50 bg-rose-500/10 text-rose-100" : "border-emerald-500/40 bg-emerald-500/10 text-emerald-100"}`}>
              <b>Conclusión:</b> {prueba.conclusion}
            </div>
            <div className="text-[12px] text-slate-400">
              Unidad Movertis <b className="text-slate-200">{prueba.unidad}</b>
              {prueba.unidadControl && <> · control: unidad <b className="text-slate-200">{prueba.unidadControl}</b></>}
              {" "}· cuenta {prueba.cuenta.connectorKey}/{prueba.cuenta.accountKey} · {fecha(prueba.probadoEn)}
            </div>
            <div className="overflow-x-auto rounded-lg border border-slate-700">
              <table className="w-full min-w-[640px] text-[12px]">
                <thead className="bg-slate-900/60 text-[10px] uppercase tracking-wide text-slate-400">
                  <tr><th className="px-3 py-2 text-left">Ventana</th><th className="px-3 py-2 text-left">Resultado</th><th className="px-3 py-2 text-left">Lo que contestó Movertis</th></tr>
                </thead>
                <tbody>
                  {prueba.resultados.map((r) => (
                    <tr key={r.clave} className={`border-t border-slate-800 ${r.clave === "control" ? "bg-slate-900/40" : ""}`}>
                      <td className="px-3 py-2 align-top">
                        <div className="font-bold text-slate-100">{r.etiqueta}</div>
                        <div className="text-[10px] text-slate-500">{fecha(r.desde)} → {fecha(r.hasta)}</div>
                      </td>
                      <td className="px-3 py-2 align-top">
                        <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${
                          r.respuesta.tipo === "ok" ? "bg-emerald-500/15 text-emerald-300"
                            : r.respuesta.tipo === "error" ? "bg-rose-500/15 text-rose-300"
                              : "bg-slate-600/30 text-slate-300"}`}>
                          {r.respuesta.tipo === "ok" ? "Funciona" : r.respuesta.tipo === "error" ? "Error" : r.respuesta.tipo === "vacio" ? "Sin datos" : "Sin turno"}
                        </span>
                      </td>
                      <td className="px-3 py-2 align-top break-words text-slate-300">{textoRespuesta(r.respuesta)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
