/**
 * Custodia de los archivos transferidos y trámites pendientes.
 *
 * Ésta es la pantalla que justifica el módulo frente a una hoja de cálculo: un
 * Excel puede calcular la fecha límite, pero no avisar de que se ha pasado. Las
 * dos colas son obligaciones del centro con plazo, y lo que se ve al abrir es
 * lo que está vencido.
 */

import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, Clock, FileCheck2, Landmark, ShieldCheck } from "lucide-react";
import * as api from "../services/api";
import { useTacografos } from "../contexts/TacografosContext";
import type { Expediente, FilaCustodia } from "../types";

function fechaEs(v: string | null): string {
  if (!v) return "—";
  return v.split("-").reverse().join("/");
}

/** Cuánto queda o cuánto se lleva de retraso, dicho en cristiano. */
function plazo(dias: number | null): string {
  if (dias === null) return "";
  if (dias > 1) return `faltan ${dias} días`;
  if (dias === 1) return "falta 1 día";
  if (dias === 0) return "vence hoy";
  return `${Math.abs(dias)} día${Math.abs(dias) === 1 ? "" : "s"} de retraso`;
}

export default function Custodia() {
  const { puede } = useTacografos();
  const [custodia, setCustodia] = useState<FilaCustodia[]>([]);
  const [pendientes, setPendientes] = useState<Expediente[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    const [c, p] = await Promise.all([api.listarCustodia(), api.pendientesComunicar()]);
    setCustodia(c.custodia);
    setPendientes(p.pendientes);
  }, []);

  useEffect(() => {
    let vivo = true;
    void (async () => {
      try {
        const [c, p] = await Promise.all([api.listarCustodia(), api.pendientesComunicar()]);
        if (!vivo) return;
        setCustodia(c.custodia);
        setPendientes(p.pendientes);
        setError(null);
      } catch (e) {
        if (vivo) setError(e instanceof Error ? e.message : "No se han podido cargar las colas");
      } finally {
        if (vivo) setCargando(false);
      }
    })();
    return () => {
      vivo = false;
    };
  }, []);

  async function destruir(f: FilaCustodia) {
    const hoy = new Date().toISOString().slice(0, 10);
    const fecha = prompt("Fecha de destrucción (aaaa-mm-dd):", hoy)?.trim();
    if (!fecha) return;
    const metodo = prompt("Método de destrucción:", "Borrado seguro y destrucción del soporte")?.trim();
    if (!metodo) return;
    const persona = prompt("Persona que la realiza:")?.trim();
    if (!persona) return;
    // El hash del fichero destruido lo calcula quien custodia el archivo: aquí
    // sólo se anota, porque el módulo no tiene el fichero.
    const hash = prompt("Firma digital (SHA-256) del archivo destruido:")?.trim();
    if (!hash) return;
    setError(null);
    try {
      await api.registrarDestruccion(f.expediente.id, { fecha, metodo, persona, hash });
      await cargar();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se ha podido registrar la destrucción");
    }
  }

  async function comunicar(e: Expediente) {
    const hoy = new Date().toISOString().slice(0, 10);
    const fechaPresentacion = prompt("Fecha de presentación (aaaa-mm-dd):", hoy)?.trim();
    if (!fechaPresentacion) return;
    const referencia = prompt("Referencia o nº de registro devuelto por la Generalitat:")?.trim() ?? "";
    setError(null);
    try {
      await api.registrarComunicacion(e.id, { fechaPresentacion, referencia, notas: "" });
      await cargar();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se ha podido registrar la comunicación");
    }
  }

  if (cargando) return <p className="text-[13px] text-slate-400">Cargando…</p>;

  const vencidos = custodia.filter((c) => c.estado === "pendiente_destruir");

  return (
    <div className="max-w-4xl">
      <h1 className="mb-4 text-lg font-bold">Custodia y trámites</h1>

      {error && (
        <p className="mb-3 rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-[13px] text-red-200">
          {error}
        </p>
      )}

      <section className="mb-5 overflow-hidden rounded-xl border border-slate-800">
        <h2 className="flex items-center gap-2 bg-slate-800/70 px-3 py-2 text-[12px] font-bold uppercase tracking-wide text-slate-200">
          <ShieldCheck className="h-4 w-4" /> Archivos bajo custodia
          {vencidos.length > 0 && (
            <span className="ml-auto flex items-center gap-1 rounded-md bg-red-500/20 px-2 py-0.5 text-red-300">
              <AlertTriangle className="h-3.5 w-3.5" /> {vencidos.length} por destruir
            </span>
          )}
        </h2>
        <div className="p-3">
          <p className="mb-3 text-[12px] text-slate-400">
            Un año desde la transferencia (nota F del anexo II del Real decreto 125/2017). Pasado
            el plazo hay que destruirlos y levantar acta.
          </p>
          {custodia.length === 0 ? (
            <p className="text-[13px] text-slate-400">No hay archivos bajo custodia.</p>
          ) : (
            <ul className="space-y-2">
              {custodia.map((f) => (
                <li
                  key={f.expediente.id}
                  className={`flex flex-wrap items-center gap-2 rounded-lg border p-2 text-[13px] ${
                    f.estado === "pendiente_destruir"
                      ? "border-red-500/40 bg-red-500/5"
                      : "border-slate-700"
                  }`}
                >
                  <Link
                    to={`/tacografos/expedientes/${f.expediente.id}`}
                    className="font-semibold text-sky-400 hover:underline"
                  >
                    {f.expediente.matricula}
                  </Link>
                  <span className="text-slate-300">{f.expediente.numInforme}</span>
                  <span className="flex items-center gap-1 text-slate-400">
                    <Clock className="h-3.5 w-3.5" /> límite {fechaEs(f.fechaLimite)}
                  </span>
                  <span
                    className={
                      f.estado === "pendiente_destruir" ? "text-red-300" : "text-slate-400"
                    }
                  >
                    {plazo(f.diasRestantes)}
                  </span>
                  {puede("tacografos.custodia.destruir") && f.estado === "pendiente_destruir" && (
                    <button
                      onClick={() => void destruir(f)}
                      className="ml-auto flex items-center gap-1.5 rounded-lg border border-red-500/50 px-2 py-1 text-red-300 hover:bg-red-500/10"
                    >
                      <FileCheck2 className="h-4 w-4" /> Registrar destrucción
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <section className="overflow-hidden rounded-xl border border-slate-800">
        <h2 className="flex items-center gap-2 bg-slate-800/70 px-3 py-2 text-[12px] font-bold uppercase tracking-wide text-slate-200">
          <Landmark className="h-4 w-4" /> Pendientes de comunicar a la administración
          {pendientes.length > 0 && (
            <span className="ml-auto rounded-md bg-amber-500/20 px-2 py-0.5 text-amber-300">
              {pendientes.length}
            </span>
          )}
        </h2>
        <div className="p-3">
          <p className="mb-3 text-[12px] text-slate-400">
            Certificados de intransferibilidad ya emitidos de los que todavía no consta la
            presentación ante la Generalitat.
          </p>
          {pendientes.length === 0 ? (
            <p className="text-[13px] text-slate-400">Nada pendiente de presentar.</p>
          ) : (
            <ul className="space-y-2">
              {pendientes.map((e) => (
                <li
                  key={e.id}
                  className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-700 p-2 text-[13px]"
                >
                  <Link
                    to={`/tacografos/expedientes/${e.id}`}
                    className="font-semibold text-sky-400 hover:underline"
                  >
                    {e.matricula}
                  </Link>
                  <span className="text-slate-300">{e.numInforme}</span>
                  <span className="text-slate-400">{fechaEs(e.fechaInforme)}</span>
                  {puede("tacografos.comunicacion.register") && (
                    <button
                      onClick={() => void comunicar(e)}
                      className="ml-auto rounded-lg border border-sky-500/50 px-2 py-1 text-sky-300 hover:bg-sky-500/10"
                    >
                      Anotar presentación
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}
