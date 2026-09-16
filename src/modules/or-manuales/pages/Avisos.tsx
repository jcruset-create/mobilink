/**
 * Los avisos: qué blocs están incompletos y a quién hay que decírselo.
 *
 * Los crea el módulo solo cuando recalcula un bloc, y se resuelven solos en
 * cuanto llegan las hojas que faltaban. Aquí sólo se decide a quién se avisa y
 * qué se da por zanjado.
 *
 * ── Qué hace hoy «Avisar al responsable» ────────────────────────────────────
 *
 * Deja constancia de que se ha avisado y lo apunta en el histórico del bloc.
 * No manda WhatsApp ni correo: el encargo pide no estrenar integraciones
 * externas todavía. El canal se guarda en cada aviso, así que el día que se
 * quiera mandar de verdad no hay que tocar ni la tabla ni esta pantalla.
 */

import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { BellRing, CheckCircle2, RefreshCw } from "lucide-react";
import * as api from "../services/api";
import { useOrManuales } from "../contexts/OrManualesContext";
import { Aviso as Recuadro, Cabecera, ChipEstadoAviso, ErrorBox, btnMini, btnSecondary } from "../components/ui";
import type { Aviso } from "../types";
import { fmtFechaHora } from "../../administracion/types";

export default function Avisos() {
  const { puede, vocabulario, refrescarIndicadores } = useOrManuales();
  const [avisos, setAvisos] = useState<Aviso[]>([]);
  const [todos, setTodos] = useState(false);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      const r = await api.avisos(todos);
      setAvisos(r.avisos);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se han podido cargar los avisos");
    } finally {
      setCargando(false);
    }
  }, [todos]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  async function accion(fn: () => Promise<unknown>) {
    setError(null);
    try {
      await fn();
      await cargar();
      await refrescarIndicadores();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se ha podido completar la acción");
    }
  }

  const gestiona = puede("or-manuales.aviso.gestionar");

  return (
    <div>
      <Cabecera titulo="Avisos" descripcion="Blocs a los que les faltan hojas. Se abren y se cierran solos.">
        <button
          className={`${btnSecondary} ${todos ? "ring-1 ring-teal-500" : ""}`}
          onClick={() => setTodos((v) => !v)}
        >
          {todos ? "Ver sólo los abiertos" : "Ver también los resueltos"}
        </button>
        <button className={`${btnSecondary} flex items-center gap-2`} onClick={() => void cargar()} disabled={cargando}>
          <RefreshCw className={`h-4 w-4 ${cargando ? "animate-spin" : ""}`} /> Actualizar
        </button>
      </Cabecera>

      {error && <ErrorBox>{error}</ErrorBox>}

      {avisos.length === 0 && !cargando && <Recuadro tono="bien">No hay ningún aviso abierto.</Recuadro>}

      <div className="space-y-2">
        {avisos.map((a) => (
          <div key={a.id} className="rounded-2xl border border-slate-700 bg-slate-800 p-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="text-[14px] font-bold text-slate-100">
                  {vocabulario?.etiquetas.tipoAviso[a.tipo] ?? a.tipo}
                  {a.numeroBloc && <span className="ml-2 font-normal text-slate-400">Bloc {a.numeroBloc}</span>}
                </div>
                <p className="mt-1 text-[13px] text-slate-300">{a.mensaje}</p>
                <div className="mt-1 text-[11px] text-slate-500">
                  Responsable: {a.responsableNombre ?? "sin asignar"} · abierto {fmtFechaHora(a.fechaCreacion)}
                  {a.fechaNotificacion ? ` · avisado ${fmtFechaHora(a.fechaNotificacion)}` : ""}
                </div>
              </div>
              <ChipEstadoAviso estado={a.estado} />
            </div>

            <div className="mt-3 flex flex-wrap gap-2">
              {a.blocId && (
                <Link to={`/or-manuales/blocs/${a.blocId}`} className={btnMini}>
                  Abrir el bloc
                </Link>
              )}
              {gestiona && a.estado === "ABIERTO" && (
                <button className={`${btnMini} flex items-center gap-1`} onClick={() => void accion(() => api.notificarAviso(a.id))}>
                  <BellRing className="h-3.5 w-3.5" /> Avisar al responsable
                </button>
              )}
              {gestiona && a.estado !== "RESUELTO" && (
                <button className={`${btnMini} flex items-center gap-1`} onClick={() => void accion(() => api.resolverAviso(a.id))}>
                  <CheckCircle2 className="h-3.5 w-3.5" /> Dar por resuelto
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
