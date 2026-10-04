/**
 * Call Center → Operadores: quién atiende y cuánto. Son los usuarios de
 * Mobilink (no hay otro sistema de usuarios); la IA aparece como «IA» y lo
 * híbrido como tal. Dar o quitar el rol `call_center` se hace en la gestión de
 * usuarios de Mobilink, módulo Self Storage.
 */

import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import * as api from "../../services/api";
import type { OperadorCallCenter } from "../../types";
import { Aviso, Cabecera, EmptyRow, ErrorBox, TableWrap, TextField, btnMini, fechaHora, msgError, tdCls, thCls } from "../../components/ui";
import { useSelfStorage } from "../../contexts/SelfStorageContext";
import { SiCallCenterActivo } from "./comun";
import { duracion, haceDias } from "./formato";

function Contenido() {
  const { etqAtendida } = useSelfStorage();
  const [f, setF] = useState({ from: haceDias(29), to: "" });
  const [lista, setLista] = useState<OperadorCallCenter[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api.operadoresCallCenter({ from: f.from || undefined, to: f.to || undefined }).then(
      (x) => (setLista(x), setError(null)),
      (e) => setError(msgError(e))
    );
  }, [f]);
  return (
    <div className="space-y-3">
      <Cabecera titulo="Operadores" descripcion="Quién ha atendido las llamadas del periodo." />
      <Aviso tono="info">Los operadores son usuarios de Mobilink con el rol «Call Center» (o empleado/administrador) en Self Storage. Se gestionan en Usuarios.</Aviso>
      <div className="grid grid-cols-2 gap-2 sm:w-96">
        <TextField label="Desde" type="date" value={f.from} onChange={(v) => setF((x) => ({ ...x, from: v }))} />
        <TextField label="Hasta" type="date" value={f.to} onChange={(v) => setF((x) => ({ ...x, to: v }))} />
      </div>
      {error && <ErrorBox>{error}</ErrorBox>}
      <TableWrap>
        <thead>
          <tr>
            <th className={thCls}>Quién</th>
            <th className={thCls}>Atendidas</th>
            <th className={thCls}>Cerradas</th>
            <th className={thCls}>Escaladas</th>
            <th className={thCls}>Duración media</th>
            <th className={thCls}>Última</th>
            <th className={thCls} />
          </tr>
        </thead>
        <tbody>
          {!lista && <EmptyRow cols={7} text="Cargando…" />}
          {lista?.length === 0 && <EmptyRow cols={7} text="Sin llamadas en el periodo." />}
          {lista?.map((o) => (
            <tr key={`${o.operatorUserId}-${o.handledBy}`} className="border-t border-slate-700">
              <td className={tdCls}>
                <span className="font-semibold">{o.operatorName ?? etqAtendida(o.handledBy)}</span>
                <div className="text-[11px] text-slate-400">{etqAtendida(o.handledBy)}</div>
              </td>
              <td className={tdCls}>{o.calls}</td>
              <td className={tdCls}>{o.closed}</td>
              <td className={tdCls}>{o.escalated}</td>
              <td className={tdCls}>{duracion(o.avgDurationSeconds)}</td>
              <td className={tdCls}>{fechaHora(o.lastCallAt)}</td>
              <td className={`${tdCls} text-right`}>
                {o.operatorUserId && (
                  <Link className={btnMini} to={`/self-storage/call-center/llamadas?operatorUserId=${o.operatorUserId}`}>
                    Ver llamadas
                  </Link>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </TableWrap>
    </div>
  );
}

export default function Operadores() {
  return <SiCallCenterActivo>{() => <Contenido />}</SiCallCenterActivo>;
}
