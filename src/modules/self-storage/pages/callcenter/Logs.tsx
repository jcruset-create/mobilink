/**
 * Call Center → Logs: la cronología de todas las llamadas (sólo inserción):
 * quién hizo qué, cuándo y en qué llamada. La auditoría completa (antes y
 * después de cada cambio) está además en `self_storage_audit_logs`.
 */

import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import * as api from "../../services/api";
import type { EventoCallCenter } from "../../types";
import { Cabecera, EmptyRow, ErrorBox, SelectField, TableWrap, fechaHora, msgError, tdCls, thCls } from "../../components/ui";
import { SiCallCenterActivo } from "./comun";

const TIPOS: [string, string][] = [
  ["", "Todos"],
  ["created", "Registrada"],
  ["answered", "Contestada"],
  ["updated", "Datos actualizados"],
  ["customer_linked", "Vinculada a cliente"],
  ["result_set", "Resultado"],
  ["escalated", "Escalada"],
  ["follow_up_scheduled", "Seguimiento programado"],
  ["follow_up_done", "Seguimiento hecho"],
  ["incident_created", "Incidencia creada"],
  ["finished", "Terminada"],
  ["closed", "Cerrada"],
];

function Contenido() {
  const [tipo, setTipo] = useState("");
  const [lista, setLista] = useState<EventoCallCenter[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api.eventosCallCenter({ eventType: tipo || undefined, limit: 300 }).then(
      (x) => (setLista(x), setError(null)),
      (e) => setError(msgError(e))
    );
  }, [tipo]);
  const nombre = (t: string) => TIPOS.find(([k]) => k === t)?.[1] ?? t;
  const actor = (t: string) => ({ staff: "Persona", ai: "IA", system: "Sistema", telephony: "Telefonía" })[t] ?? t;
  return (
    <div className="space-y-3">
      <Cabecera titulo="Logs del Call Center" descripcion="Cronología de las llamadas. No se puede modificar ni borrar." />
      <div className="sm:w-72">
        <SelectField label="Evento" value={tipo} onChange={setTipo}>
          {TIPOS.map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </SelectField>
      </div>
      {error && <ErrorBox>{error}</ErrorBox>}
      <TableWrap>
        <thead>
          <tr>
            <th className={thCls}>Cuándo</th>
            <th className={thCls}>Evento</th>
            <th className={thCls}>Quién</th>
            <th className={thCls}>Llamada</th>
            <th className={thCls}>Detalle</th>
          </tr>
        </thead>
        <tbody>
          {!lista && <EmptyRow cols={5} text="Cargando…" />}
          {lista?.length === 0 && <EmptyRow cols={5} text="Sin eventos." />}
          {lista?.map((e) => (
            <tr key={e.id} className="border-t border-slate-700 align-top">
              <td className={`${tdCls} whitespace-nowrap`}>{fechaHora(e.occurredAt)}</td>
              <td className={tdCls}>{nombre(e.eventType)}</td>
              <td className={tdCls}>
                {e.actorName ?? "—"}
                <div className="text-[11px] text-slate-400">{actor(e.actorType)}</div>
              </td>
              <td className={tdCls}>
                <Link className="underline" to={`/self-storage/call-center/llamada/${e.callId}`}>
                  {e.phone ?? "número oculto"}
                </Link>
              </td>
              <td className={`${tdCls} max-w-md break-words font-mono text-[11px] text-slate-400`}>{Object.keys(e.data ?? {}).length ? JSON.stringify(e.data) : ""}</td>
            </tr>
          ))}
        </tbody>
      </TableWrap>
    </div>
  );
}

export default function Logs() {
  return <SiCallCenterActivo>{() => <Contenido />}</SiCallCenterActivo>;
}
