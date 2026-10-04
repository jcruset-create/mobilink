/**
 * Asistente IA → Configuración (por empresa): activación, modo (IA / humano /
 * híbrido), idiomas, escalado a persona, protección de datos (transcripción y
 * resumen) y límite de turnos. La marca, la web y el centro por defecto son los
 * del Call Center. Las claves de los proveedores NUNCA están aquí.
 */

import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import * as api from "../../services/api";
import type { Ajustes } from "../../types";
import { Aviso, Cabecera, Cargando, CheckField, ErrorBox, SelectField, TextField, btnPrimary, msgError } from "../../components/ui";
import { useEstadoAsistente } from "./useEstadoAsistente";

export default function ConfigIA() {
  const { estado, recargar } = useEstadoAsistente();
  const [a, setA] = useState<Ajustes | null>(null);
  const [f, setF] = useState({ mode: "hybrid", es: true, ca: true, escalado: true, transcripciones: false, resumen: true, turnos: "30" });
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const cargar = useCallback(async () => {
    try {
      const r = await api.ajustes();
      setA(r);
      const idiomas = r["ai_assistant.languages"].value;
      setF({
        mode: r["ai_assistant.mode"].value,
        es: idiomas.includes("es"),
        ca: idiomas.includes("ca"),
        escalado: r["ai_assistant.human_escalation"].value,
        transcripciones: r["ai_assistant.store_transcripts"].value,
        resumen: r["ai_assistant.store_summary"].value,
        turnos: String(r["ai_assistant.max_turns"].value),
      });
    } catch (e) {
      setError(msgError(e));
    }
  }, []);
  useEffect(() => {
    void cargar();
  }, [cargar]);
  const guardar = async (fn: () => Promise<unknown>, que: string) => {
    setOk(null);
    setError(null);
    try {
      await fn();
      setOk(`${que}: guardado.`);
      await cargar();
      recargar();
    } catch (e) {
      setError(`${que}: ${msgError(e)}`);
    }
  };
  if (!a && !error) return <Cargando />;
  const activo = a?.["ai_assistant.enabled"].value ?? false;
  const enlaces = a?.["call_center.links"].value;
  return (
    <div className="space-y-4">
      <Cabecera titulo="Configuración del Asistente IA" descripcion="Por empresa. Apagarlo no afecta al Call Center." />
      {error && <ErrorBox>{error}</ErrorBox>}
      {ok && <Aviso tono="bien">{ok}</Aviso>}
      {estado && !estado.global && <Aviso tono="aviso">El interruptor global del servidor está apagado (SELF_STORAGE_AI_ASSISTANT_ENABLED=0).</Aviso>}
      {a && (
        <>
          <section className="space-y-2 rounded-xl border border-slate-700 bg-slate-800 p-4">
            <h2 className="text-sm font-bold">Activación</h2>
            <p className="text-[12px] text-slate-300">
              Marca: <b>{enlaces?.brandName ?? "sin configurar"}</b> · Web: {enlaces?.web ?? "sin configurar"} · Proveedor: {estado?.provider ?? "—"}{" "}
              {estado && !estado.providerAvailable && <span className="text-amber-300">(no disponible)</span>}.{" "}
              <Link className="underline" to="/self-storage/call-center/configuracion">
                Marca, web y centro
              </Link>{" "}
              ·{" "}
              <Link className="underline" to="/self-storage/asistente/proveedores">
                Proveedores
              </Link>
            </p>
            <button className={btnPrimary} onClick={() => void guardar(() => api.guardarAjuste("ai_assistant.enabled", !activo), activo ? "Asistente desactivado" : "Asistente activado")}>
              {activo ? "Desactivar el Asistente IA" : "Activar el Asistente IA"}
            </button>
          </section>
          <section className="space-y-2 rounded-xl border border-slate-700 bg-slate-800 p-4">
            <h2 className="text-sm font-bold">Cómo atiende</h2>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <SelectField label="Modo" value={f.mode} onChange={(v) => setF((x) => ({ ...x, mode: v }))}>
                <option value="hybrid">Híbrido: la IA atiende y escala a una persona</option>
                <option value="ai">Sólo IA</option>
                <option value="human">Sólo humano (la IA no atiende llamadas)</option>
              </SelectField>
              <TextField label="Máximo de turnos por sesión" type="number" value={f.turnos} onChange={(v) => setF((x) => ({ ...x, turnos: v }))} />
              <CheckField label="Castellano" checked={f.es} onChange={(v) => setF((x) => ({ ...x, es: v }))} />
              <CheckField label="Català" checked={f.ca} onChange={(v) => setF((x) => ({ ...x, ca: v }))} />
              <CheckField label="Escalado a una persona" checked={f.escalado} onChange={(v) => setF((x) => ({ ...x, escalado: v }))} />
            </div>
            <h3 className="pt-2 text-sm font-bold">Protección de datos</h3>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <CheckField label="Guardar la conversación (transcripción)" checked={f.transcripciones} onChange={(v) => setF((x) => ({ ...x, transcripciones: v }))} />
              <CheckField label="Guardar el resumen" checked={f.resumen} onChange={(v) => setF((x) => ({ ...x, resumen: v }))} />
            </div>
            <p className="text-[12px] text-slate-400">Sin guardar la conversación, se borra al terminar la sesión. Si se guarda, avisa a quien llama: se borra pasados los días de retención del Call Center. El audio no se graba.</p>
            <button
              className={btnPrimary}
              disabled={!f.es && !f.ca}
              onClick={() =>
                void guardar(async () => {
                  await api.guardarAjuste("ai_assistant.mode", f.mode as "ai" | "human" | "hybrid");
                  await api.guardarAjuste("ai_assistant.languages", [f.es && "es", f.ca && "ca"].filter(Boolean) as string[]);
                  await api.guardarAjuste("ai_assistant.human_escalation", f.escalado);
                  await api.guardarAjuste("ai_assistant.store_transcripts", f.transcripciones);
                  await api.guardarAjuste("ai_assistant.store_summary", f.resumen);
                  await api.guardarAjuste("ai_assistant.max_turns", Number(f.turnos));
                }, "Configuración del asistente")
              }
            >
              Guardar
            </button>
          </section>
        </>
      )}
    </div>
  );
}
