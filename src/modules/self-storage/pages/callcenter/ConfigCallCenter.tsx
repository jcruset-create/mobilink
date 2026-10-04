/**
 * Call Center → Configuración (por empresa). Dos llaves:
 *   · global (variable SELF_STORAGE_CALL_CENTER_ENABLED): la del servidor;
 *   · de la empresa (aquí): activar o no el Call Center.
 * Más el centro por defecto, los enlaces que se dan a quien llama (marca,
 * web, calculadora, contratación, visita virtual) y la protección de datos.
 * Nada de esto está escrito en el código: cada empresa pone los suyos.
 */

import { useCallback, useEffect, useState } from "react";
import * as api from "../../services/api";
import type { Ajustes, EnlacesCallCenter } from "../../types";
import { Aviso, Cabecera, Cargando, CheckField, ErrorBox, SelectField, TextField, btnPrimary, msgError } from "../../components/ui";
import { useSelfStorage } from "../../contexts/SelfStorageContext";
import { useEstadoCallCenter } from "./useEstadoCallCenter";

const VACIO: EnlacesCallCenter = { brandName: null, web: null, calculator: null, contracting: null, virtualVisit: null };

export default function ConfigCallCenter() {
  const { centros } = useSelfStorage();
  const { estado, recargar } = useEstadoCallCenter();
  const [a, setA] = useState<Ajustes | null>(null);
  const [enlaces, setEnlaces] = useState<EnlacesCallCenter>(VACIO);
  const [centro, setCentro] = useState("");
  const [guardarTrans, setGuardarTrans] = useState(false);
  const [dias, setDias] = useState("90");
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    try {
      const r = await api.ajustes();
      setA(r);
      setEnlaces(r["call_center.links"].value);
      setCentro(r["call_center.default_center_id"].value ?? "");
      setGuardarTrans(r["call_center.store_transcripts"].value);
      setDias(String(r["call_center.transcript_retention_days"].value));
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
  const url = (v: string) => v.trim() || null;
  const activo = a?.["call_center.enabled"].value ?? false;

  return (
    <div className="space-y-4">
      <Cabecera titulo="Configuración del Call Center" descripcion="Por empresa. Los cambios quedan en la auditoría." />
      {error && <ErrorBox>{error}</ErrorBox>}
      {ok && <Aviso tono="bien">{ok}</Aviso>}
      {estado && !estado.global && <Aviso tono="aviso">El interruptor global del servidor está apagado (SELF_STORAGE_CALL_CENTER_ENABLED=0): aunque lo actives aquí, no funcionará.</Aviso>}
      {a && (
        <>
          <section className="space-y-2 rounded-xl border border-slate-700 bg-slate-800 p-4">
            <h2 className="text-sm font-bold">Activación</h2>
            <p className="text-[12px] text-slate-400">Funciona sin el Asistente IA: con este interruptor, las llamadas las registran personas desde el panel.</p>
            <button className={btnPrimary} onClick={() => void guardar(() => api.guardarAjuste("call_center.enabled", !activo), activo ? "Call Center desactivado" : "Call Center activado")}>
              {activo ? "Desactivar el Call Center" : "Activar el Call Center"}
            </button>
            <span className="ml-2 text-[12px] text-slate-300">Ahora: {activo ? "activado" : "desactivado"} para esta empresa.</span>
          </section>

          <section className="space-y-2 rounded-xl border border-slate-700 bg-slate-800 p-4">
            <h2 className="text-sm font-bold">Marca, centro y enlaces</h2>
            <p className="text-[12px] text-slate-400">«El Call Center informa y ayuda; la web vende.» Son los enlaces que el operador tiene a mano para dar a quien llama.</p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <TextField label="Nombre comercial" value={enlaces.brandName ?? ""} onChange={(v) => setEnlaces((e) => ({ ...e, brandName: v || null }))} placeholder="TLC - Trasteros-Low Cost" />
              <SelectField label="Centro por defecto" value={centro} onChange={setCentro}>
                <option value="">— Ninguno (el único activo, si sólo hay uno) —</option>
                {centros.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </SelectField>
              <TextField label="Web" value={enlaces.web ?? ""} onChange={(v) => setEnlaces((e) => ({ ...e, web: v || null }))} placeholder="https://www.trasteros-lowcost.com" />
              <TextField label="Calculadora de espacio" value={enlaces.calculator ?? ""} onChange={(v) => setEnlaces((e) => ({ ...e, calculator: v || null }))} placeholder="https://…" />
              <TextField label="Contratación online" value={enlaces.contracting ?? ""} onChange={(v) => setEnlaces((e) => ({ ...e, contracting: v || null }))} placeholder="https://…" />
              <TextField label="Visita virtual" value={enlaces.virtualVisit ?? ""} onChange={(v) => setEnlaces((e) => ({ ...e, virtualVisit: v || null }))} placeholder="https://…" />
            </div>
            <p className="text-[12px] text-slate-400">La dirección y el teléfono salen de la ficha del centro (Centros y zonas).</p>
            <button
              className={btnPrimary}
              onClick={() =>
                void guardar(async () => {
                  await api.guardarAjuste("call_center.links", {
                    brandName: enlaces.brandName?.trim() || null,
                    web: url(enlaces.web ?? ""),
                    calculator: url(enlaces.calculator ?? ""),
                    contracting: url(enlaces.contracting ?? ""),
                    virtualVisit: url(enlaces.virtualVisit ?? ""),
                  });
                  await api.guardarAjuste("call_center.default_center_id", centro || null);
                }, "Marca y enlaces")
              }
            >
              Guardar
            </button>
          </section>

          <section className="space-y-2 rounded-xl border border-slate-700 bg-slate-800 p-4">
            <h2 className="text-sm font-bold">Protección de datos</h2>
            <p className="text-[12px] text-slate-400">
              La grabación de audio no está disponible (no hay telefonía conectada) y queda desactivada. Las transcripciones, por defecto, tampoco se guardan; si las activas, avisa a
              quien llama y se borran solas pasados los días indicados. Desactivarlas borra las que haya.
            </p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <CheckField label="Guardar transcripciones" checked={guardarTrans} onChange={setGuardarTrans} />
              <TextField label="Conservar transcripciones (días)" type="number" value={dias} onChange={setDias} />
            </div>
            <CheckField label="Grabar audio (no disponible)" checked={false} onChange={() => {}} />
            <button
              className={btnPrimary}
              onClick={() =>
                void guardar(async () => {
                  await api.guardarAjuste("call_center.transcript_retention_days", Number(dias));
                  await api.guardarAjuste("call_center.store_transcripts", guardarTrans);
                }, "Protección de datos")
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
