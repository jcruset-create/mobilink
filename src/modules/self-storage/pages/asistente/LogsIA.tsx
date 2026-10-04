/**
 * Asistente IA → Logs: cada herramienta ejecutada (bien, con error o
 * bloqueada), con parámetros saneados. Registro de sólo inserción.
 */

import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import * as api from "../../services/api";
import type { LlamadaHerramienta } from "../../types";
import { Cabecera, EmptyRow, ErrorBox, SelectField, TableWrap, fechaHora, msgError, tdCls, thCls } from "../../components/ui";
import { ChipResultado, ChipRiesgo, ConEstadoAsistente } from "./comun";

function Contenido() {
  const [outcome, setOutcome] = useState("");
  const [lista, setLista] = useState<LlamadaHerramienta[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api.logsHerramientasIA({ outcome: outcome || undefined, limit: 300 }).then(
      (x) => (setLista(x), setError(null)),
      (e) => setError(msgError(e))
    );
  }, [outcome]);
  return (
    <div className="space-y-3">
      <Cabecera titulo="Logs del asistente" descripcion="Herramientas ejecutadas, fallidas y bloqueadas. No se pueden modificar ni borrar." />
      <div className="sm:w-64">
        <SelectField label="Resultado" value={outcome} onChange={setOutcome}>
          <option value="">Todos</option>
          <option value="success">Bien</option>
          <option value="error">Error</option>
          <option value="blocked">Bloqueadas</option>
        </SelectField>
      </div>
      {error && <ErrorBox>{error}</ErrorBox>}
      <TableWrap>
        <thead>
          <tr>
            <th className={thCls}>Cuándo</th>
            <th className={thCls}>Herramienta</th>
            <th className={thCls}>Resultado</th>
            <th className={thCls}>Parámetros (saneados)</th>
            <th className={thCls}>Sesión</th>
          </tr>
        </thead>
        <tbody>
          {!lista && <EmptyRow cols={5} text="Cargando…" />}
          {lista?.length === 0 && <EmptyRow cols={5} text="Sin registros." />}
          {lista?.map((t) => (
            <tr key={t.id} className="border-t border-slate-700 align-top">
              <td className={`${tdCls} whitespace-nowrap`}>{fechaHora(t.createdAt)}</td>
              <td className={tdCls}>
                <span className="font-mono text-[12px]">{t.tool}</span> <ChipRiesgo r={t.risk} />
              </td>
              <td className={tdCls}>
                <ChipResultado o={t.outcome} />
                {t.error && <div className="text-[11px] text-rose-300">{t.error}</div>}
                <div className="text-[11px] text-slate-500">{t.durationMs} ms</div>
              </td>
              <td className={`${tdCls} max-w-sm break-words font-mono text-[11px] text-slate-400`}>{JSON.stringify(t.params)}</td>
              <td className={tdCls}>
                <Link className="underline" to={`/self-storage/asistente/sesiones/${t.sessionId}`}>
                  {t.provider ?? "sesión"}
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </TableWrap>
    </div>
  );
}

export default function LogsIA() {
  return <ConEstadoAsistente>{() => <Contenido />}</ConEstadoAsistente>;
}
