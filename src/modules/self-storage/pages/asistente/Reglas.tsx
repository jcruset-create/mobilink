/**
 * Asistente IA → Reglas: las obligatorias (en el código, no se pueden quitar)
 * y las propias de la empresa (se añaden a las instrucciones).
 */

import { useEffect, useState } from "react";
import * as api from "../../services/api";
import { Aviso, Cabecera, ErrorBox, TextAreaField, btnPrimary, msgError } from "../../components/ui";
import { useSelfStorage } from "../../contexts/SelfStorageContext";
import { ConEstadoAsistente } from "./comun";

function Contenido() {
  const { puede } = useSelfStorage();
  const [fijas, setFijas] = useState<string[]>([]);
  const [extra, setExtra] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  useEffect(() => {
    api.reglasIA().then(
      (r) => (setFijas(r.mandatory), setExtra(r.extra.join("\n"))),
      (e) => setError(msgError(e))
    );
  }, []);
  const guardar = async () => {
    setOk(null);
    try {
      const lineas = extra.split("\n").map((l) => l.trim()).filter(Boolean);
      await api.guardarAjuste("ai_assistant.extra_rules", lineas);
      setOk(`Guardadas ${lineas.length} reglas de la empresa.`);
    } catch (e) {
      setError(msgError(e));
    }
  };
  return (
    <div className="space-y-3">
      <Cabecera titulo="Reglas del asistente" descripcion="Las obligatorias se aplican siempre; las de la empresa se añaden." />
      {error && <ErrorBox>{error}</ErrorBox>}
      {ok && <Aviso tono="bien">{ok}</Aviso>}
      <section className="rounded-xl border border-slate-700 bg-slate-800 p-4">
        <h2 className="mb-2 text-sm font-bold">Obligatorias (no se pueden quitar)</h2>
        <ul className="list-disc space-y-1 pl-5 text-[13px] text-slate-200">
          {fijas.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
        <p className="mt-2 text-[12px] text-slate-400">Además, una guarda en el servidor impide que llegue a quien llama un importe con moneda: se sustituye por la remisión a la web y la sesión queda marcada para revisión.</p>
      </section>
      <section className="space-y-2 rounded-xl border border-slate-700 bg-slate-800 p-4">
        <h2 className="text-sm font-bold">De la empresa (una por línea)</h2>
        <TextAreaField label="Reglas propias" value={extra} onChange={setExtra} rows={6} placeholder="Ej.: Ofrece siempre la visita virtual antes que la guiada." />
        {puede("ss.settings.manage") ? (
          <button className={btnPrimary} onClick={() => void guardar()}>
            Guardar
          </button>
        ) : (
          <p className="text-[12px] text-slate-400">Sólo administración puede cambiarlas.</p>
        )}
      </section>
    </div>
  );
}

export default function Reglas() {
  return <ConEstadoAsistente>{() => <Contenido />}</ConEstadoAsistente>;
}
