/**
 * Asistente IA → Proveedores: IA (y su respaldo), voz y telefonía.
 * Intercambiables: cambiar de proveedor no cambia el asistente. Las claves
 * NUNCA están aquí: viven en variables de entorno del servidor (aquí sólo se
 * ve si están o no).
 */

import { useCallback, useEffect, useState } from "react";
import * as api from "../../services/api";
import type { ProveedoresIA } from "../../types";
import { Aviso, Cabecera, ErrorBox, Pill, SelectField, TableWrap, btnPrimary, msgError, tdCls, thCls } from "../../components/ui";
import { useSelfStorage } from "../../contexts/SelfStorageContext";
import { ConEstadoAsistente } from "./comun";

const NOMBRE: Record<string, string> = { mock: "Simulado (sin coste, para pruebas)", openai: "OpenAI (capa única de IA de Mobilink)" };

function Contenido() {
  const { puede } = useSelfStorage();
  const [p, setP] = useState<ProveedoresIA | null>(null);
  const [sel, setSel] = useState({ provider: "mock", fallback: "", voice: "", telephony: "" });
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const cargar = useCallback(() => {
    api.proveedoresIA().then(
      (x) => {
        setP(x);
        setSel({ provider: x.selected.provider, fallback: x.selected.fallbackProvider ?? "", voice: x.selected.voiceProvider ?? "", telephony: x.selected.telephonyProvider ?? "" });
      },
      (e) => setError(msgError(e))
    );
  }, []);
  useEffect(() => {
    cargar();
  }, [cargar]);
  const guardar = async () => {
    setOk(null);
    try {
      await api.guardarAjuste("ai_assistant.provider", sel.provider);
      await api.guardarAjuste("ai_assistant.fallback_provider", sel.fallback || null);
      await api.guardarAjuste("ai_assistant.voice_provider", sel.voice || null);
      await api.guardarAjuste("ai_assistant.telephony_provider", sel.telephony || null);
      setOk("Proveedores guardados.");
      cargar();
    } catch (e) {
      setError(msgError(e));
    }
  };
  if (!p) return error ? <ErrorBox>{error}</ErrorBox> : null;
  return (
    <div className="space-y-3">
      <Cabecera titulo="Proveedores" descripcion="Piezas sustituibles. Mobilink es la fuente de verdad; el proveedor sólo decide qué decir." />
      {error && <ErrorBox>{error}</ErrorBox>}
      {ok && <Aviso tono="bien">{ok}</Aviso>}
      <TableWrap>
        <thead>
          <tr>
            <th className={thCls}>IA</th>
            <th className={thCls}>Modelo</th>
            <th className={thCls}>Disponible</th>
          </tr>
        </thead>
        <tbody>
          {p.ai.map((a) => (
            <tr key={a.nombre} className="border-t border-slate-700">
              <td className={tdCls}>{NOMBRE[a.nombre] ?? a.nombre}</td>
              <td className={`${tdCls} font-mono text-[12px]`}>{a.modelo}</td>
              <td className={tdCls}>{a.disponible ? <Pill className="bg-emerald-500/20 text-emerald-300">Sí</Pill> : <Pill className="bg-rose-500/20 text-rose-300">No (falta la clave en el servidor)</Pill>}</td>
            </tr>
          ))}
        </tbody>
      </TableWrap>
      <p className="text-[12px] text-slate-400">
        El modelo de OpenAI lo fija el servidor (OPENAI_ASSISTANT_MODEL, con su respaldo OPENAI_FALLBACK_MODEL): es la capa única de IA de Mobilink y nadie elige modelo por su cuenta. Para otro proveedor, su modelo irá en su propia configuración.
      </p>
      <section className="grid grid-cols-1 gap-2 rounded-xl border border-slate-700 bg-slate-800 p-4 sm:grid-cols-2">
        <SelectField label="Proveedor de IA" value={sel.provider} onChange={(v) => setSel((x) => ({ ...x, provider: v }))}>
          {p.available.ai.map((n) => (
            <option key={n} value={n}>
              {NOMBRE[n] ?? n}
            </option>
          ))}
        </SelectField>
        <SelectField label="Respaldo si falla" value={sel.fallback} onChange={(v) => setSel((x) => ({ ...x, fallback: v }))}>
          <option value="">Ninguno (si falla, pasa a una persona)</option>
          {p.available.ai
            .filter((n) => n !== sel.provider)
            .map((n) => (
              <option key={n} value={n}>
                {NOMBRE[n] ?? n}
              </option>
            ))}
        </SelectField>
        <SelectField label="Voz (preparado)" value={sel.voice} onChange={(v) => setSel((x) => ({ ...x, voice: v }))}>
          <option value="">Ninguno</option>
          {p.available.voice.map((n) => (
            <option key={n} value={n}>
              {n === "mock" ? "Simulado" : n}
            </option>
          ))}
        </SelectField>
        <SelectField label="Telefonía (preparado)" value={sel.telephony} onChange={(v) => setSel((x) => ({ ...x, telephony: v }))}>
          <option value="">Ninguno (sin telefonía conectada)</option>
          {p.available.telephony.map((n) => (
            <option key={n} value={n}>
              {n === "mock" ? "Simulado" : n}
            </option>
          ))}
        </SelectField>
        <p className="text-[12px] text-slate-400 sm:col-span-2">Voz y telefonía están preparadas (interfaces y simulados) pero no conectadas: hoy el asistente se prueba en la consola de texto.</p>
        {puede("ss.settings.manage") && (
          <div className="sm:col-span-2">
            <button className={btnPrimary} onClick={() => void guardar()}>
              Guardar
            </button>
          </div>
        )}
      </section>
    </div>
  );
}

export default function Proveedores() {
  return <ConEstadoAsistente>{() => <Contenido />}</ConEstadoAsistente>;
}
