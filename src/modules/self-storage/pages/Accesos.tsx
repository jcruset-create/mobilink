/**
 * Accesos: el registro de aperturas (quién, qué puerta, cómo, decisión y
 * respuesta del equipo) y los accesos temporales del centro.
 *
 * El registro es de sólo lectura (la base no deja reescribirlo). Los accesos
 * temporales usan el mismo motor que todos: fechas, usos, puertas y, si van
 * ligados a un contrato, sus bloqueos.
 */

import { useCallback, useEffect, useState } from "react";
import * as api from "../services/api";
import { ACCESS_METHODS, type AccesoTemporal, type EventoAcceso, type Puerta } from "../types";
import { EnlaceCreado, FormTemporal, TablaEventos, TablaTemporales } from "../components/Accesos";
import { Aviso, Cabecera, ErrorBox, SelectField, btnPrimary, btnSecondary, msgError } from "../components/ui";
import { useSelfStorage } from "../contexts/SelfStorageContext";

export default function Accesos() {
  const { centroId, puede, etqMetodoAcceso } = useSelfStorage();
  const [pestana, setPestana] = useState<"registro" | "temporales">("registro");
  const [puertas, setPuertas] = useState<Puerta[]>([]);
  const [eventos, setEventos] = useState<EventoAcceso[] | null>(null);
  const [temporales, setTemporales] = useState<AccesoTemporal[] | null>(null);
  const [filtro, setFiltro] = useState({ doorId: "", decision: "", method: "" });
  const [error, setError] = useState<string | null>(null);
  const [nuevo, setNuevo] = useState(false);
  const [creado, setCreado] = useState<AccesoTemporal | null>(null);
  const gestiona = puede("ss.access.manage");

  const cargar = useCallback(async () => {
    if (!centroId) return;
    try {
      const [p, e, t] = await Promise.all([
        api.puertas(centroId),
        api.eventosAcceso({ centerId: centroId, doorId: filtro.doorId || undefined, decision: filtro.decision || undefined, method: filtro.method || undefined, limit: 200 }),
        api.temporales({ centerId: centroId }),
      ]);
      setPuertas(p);
      setEventos(e);
      setTemporales(t);
      setError(null);
    } catch (e) {
      setError(msgError(e));
    }
  }, [centroId, filtro]);
  useEffect(() => {
    void cargar();
  }, [cargar]);

  const revocar = async (t: AccesoTemporal) => {
    if (!window.confirm(`¿Revocar el acceso de ${t.fullName}? Dejará de abrir al momento.`)) return;
    try {
      await api.revocarTemporal(t.id);
      await cargar();
    } catch (e) {
      setError(msgError(e));
    }
  };

  if (!centroId) return <Aviso tono="info">Elige o crea un centro.</Aviso>;

  return (
    <div className="space-y-3">
      <Cabecera titulo="Accesos" descripcion="Registro de aperturas y accesos temporales. Todo intento queda anotado, abra o no.">
        <button className={btnSecondary} onClick={() => void cargar()}>
          Actualizar
        </button>
        {gestiona && pestana === "temporales" && (
          <button className={btnPrimary} onClick={() => setNuevo(true)}>
            Nuevo acceso temporal
          </button>
        )}
      </Cabecera>
      <div className="flex gap-1 text-[13px]">
        {(["registro", "temporales"] as const).map((p) => (
          <button key={p} className={`rounded-lg px-3 py-1.5 ${pestana === p ? "bg-orange-600 text-white" : "bg-slate-800 text-slate-300"}`} onClick={() => setPestana(p)}>
            {p === "registro" ? "Registro de aperturas" : "Accesos temporales"}
          </button>
        ))}
      </div>
      {error && <ErrorBox>{error}</ErrorBox>}

      {pestana === "registro" && (
        <>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <SelectField label="Puerta" value={filtro.doorId} onChange={(v) => setFiltro((f) => ({ ...f, doorId: v }))}>
              <option value="">Todas</option>
              {puertas.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </SelectField>
            <SelectField label="Decisión" value={filtro.decision} onChange={(v) => setFiltro((f) => ({ ...f, decision: v }))}>
              <option value="">Todas</option>
              <option value="granted">Concedidas</option>
              <option value="denied">Denegadas</option>
            </SelectField>
            <SelectField label="Cómo" value={filtro.method} onChange={(v) => setFiltro((f) => ({ ...f, method: v }))}>
              <option value="">Todos</option>
              {ACCESS_METHODS.map((m) => (
                <option key={m} value={m}>
                  {etqMetodoAcceso(m)}
                </option>
              ))}
            </SelectField>
          </div>
          <TablaEventos eventos={eventos} />
        </>
      )}

      {pestana === "temporales" && <TablaTemporales lista={temporales} gestiona={gestiona} onRevocar={(t) => void revocar(t)} />}

      {nuevo && (
        <FormTemporal
          puertas={puertas.filter((p) => p.enabled)}
          centerId={centroId}
          onCerrar={() => setNuevo(false)}
          onHecho={(t) => {
            setNuevo(false);
            setCreado(t);
            void cargar();
          }}
        />
      )}
      {creado && <EnlaceCreado t={creado} onCerrar={() => setCreado(null)} />}
    </div>
  );
}
