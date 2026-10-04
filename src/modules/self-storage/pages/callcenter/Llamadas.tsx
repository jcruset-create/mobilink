/**
 * Call Center → Llamadas: registro con filtros (fechas, centro, idioma,
 * motivo, resultado, estado, prioridad, quién atiende, sentido…), paginado y
 * exportable a CSV con los mismos filtros.
 */

import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import * as api from "../../services/api";
import { CALL_DIRECTIONS, CALL_HANDLERS, CALL_STATUSES, PRIORITIES, type EntradaCatalogo, type Llamada, type Pagina } from "../../types";
import { Cabecera, EmptyRow, ErrorBox, SelectField, TableWrap, TextField, btnMini, btnPrimary, btnSecondary, fechaHora, msgError, tdCls, thCls } from "../../components/ui";
import { useSelfStorage } from "../../contexts/SelfStorageContext";
import { ChipLlamada, ChipPrioridad, SiCallCenterActivo } from "./comun";
import { IDIOMAS, duracion, etqIdioma, haceDias } from "./formato";

const POR_PAGINA = 50;

function Contenido() {
  const { centros, puede, etqEstadoLlamada, etqPrioridad, etqAtendida, etqSentido } = useSelfStorage();
  const [params] = useSearchParams();
  const [f, setF] = useState<Record<string, string>>(() => ({
    from: params.get("from") ?? haceDias(29),
    to: params.get("to") ?? "",
    centerId: "",
    phone: "",
    language: "",
    reasonCode: "",
    resultCode: "",
    status: params.get("status") ?? "",
    priority: "",
    handledBy: "",
    direction: "",
    pendingFollowUp: params.get("pendingFollowUp") ?? "",
    interested: "",
    operatorUserId: params.get("operatorUserId") ?? "",
  }));
  const [pagina, setPagina] = useState(0);
  const [datos, setDatos] = useState<Pagina<Llamada> | null>(null);
  const [catalogo, setCatalogo] = useState<EntradaCatalogo[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.catalogoLlamadas().then(setCatalogo, () => {});
  }, []);
  const filtro = useMemo(() => {
    const o: api.FiltroLlamadas = {};
    for (const [k, v] of Object.entries(f)) if (v) o[k as keyof api.FiltroLlamadas] = v;
    return o;
  }, [f]);
  useEffect(() => {
    let vivo = true;
    api.llamadas({ ...filtro, limit: POR_PAGINA, offset: pagina * POR_PAGINA }).then(
      (d) => vivo && (setDatos(d), setError(null)),
      (e) => vivo && setError(msgError(e))
    );
    return () => {
      vivo = false;
    };
  }, [filtro, pagina]);

  const set = (k: string) => (v: string) => {
    setPagina(0);
    setF((x) => ({ ...x, [k]: v }));
  };
  const motivos = catalogo.filter((c) => c.kind === "reason");
  const resultados = catalogo.filter((c) => c.kind === "result");
  const total = datos?.total ?? 0;

  return (
    <div className="space-y-3">
      <Cabecera titulo="Llamadas" descripcion={`${total} llamada${total === 1 ? "" : "s"} con estos filtros`}>
        <button className={btnSecondary} onClick={() => void api.exportarLlamadas(filtro).catch((e) => setError(msgError(e)))}>
          Exportar CSV
        </button>
        {puede("ss.callcenter.create") && (
          <Link to="/self-storage/call-center/llamada" className={btnPrimary}>
            Nueva llamada
          </Link>
        )}
      </Cabecera>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-7">
        <TextField label="Desde" type="date" value={f.from} onChange={set("from")} />
        <TextField label="Hasta" type="date" value={f.to} onChange={set("to")} />
        <TextField label="Teléfono" value={f.phone} onChange={set("phone")} placeholder="600 000 000" />
        <SelectField label="Centro" value={f.centerId} onChange={set("centerId")}>
          <option value="">Todos</option>
          {centros.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </SelectField>
        <SelectField label="Motivo" value={f.reasonCode} onChange={set("reasonCode")}>
          <option value="">Todos</option>
          {motivos.map((m) => (
            <option key={m.id} value={m.code}>
              {m.label}
            </option>
          ))}
        </SelectField>
        <SelectField label="Resultado" value={f.resultCode} onChange={set("resultCode")}>
          <option value="">Todos</option>
          {resultados.map((m) => (
            <option key={m.id} value={m.code}>
              {m.label}
            </option>
          ))}
        </SelectField>
        <SelectField label="Estado" value={f.status} onChange={set("status")}>
          <option value="">Todos</option>
          {CALL_STATUSES.map((s) => (
            <option key={s} value={s}>
              {etqEstadoLlamada(s)}
            </option>
          ))}
        </SelectField>
        <SelectField label="Prioridad" value={f.priority} onChange={set("priority")}>
          <option value="">Todas</option>
          {PRIORITIES.map((p) => (
            <option key={p} value={p}>
              {etqPrioridad(p)}
            </option>
          ))}
        </SelectField>
        <SelectField label="Atendida por" value={f.handledBy} onChange={set("handledBy")}>
          <option value="">Todos</option>
          {CALL_HANDLERS.map((h) => (
            <option key={h} value={h}>
              {etqAtendida(h)}
            </option>
          ))}
        </SelectField>
        <SelectField label="Sentido" value={f.direction} onChange={set("direction")}>
          <option value="">Todos</option>
          {CALL_DIRECTIONS.map((d) => (
            <option key={d} value={d}>
              {etqSentido(d)}
            </option>
          ))}
        </SelectField>
        <SelectField label="Idioma" value={f.language} onChange={set("language")}>
          <option value="">Todos</option>
          {IDIOMAS.map((i) => (
            <option key={i.code} value={i.code}>
              {i.label}
            </option>
          ))}
        </SelectField>
        <SelectField label="Quién llama" value={f.interested} onChange={set("interested")}>
          <option value="">Todos</option>
          <option value="1">Sólo interesados (sin ficha)</option>
        </SelectField>
        <SelectField label="Seguimiento" value={f.pendingFollowUp} onChange={set("pendingFollowUp")}>
          <option value="">Todos</option>
          <option value="1">Pendientes</option>
        </SelectField>
      </div>
      {error && <ErrorBox>{error}</ErrorBox>}
      <TableWrap>
        <thead>
          <tr>
            <th className={thCls}>Inicio</th>
            <th className={thCls}>Quién llama</th>
            <th className={thCls}>Motivo · resultado</th>
            <th className={thCls}>Estado</th>
            <th className={thCls}>Prioridad</th>
            <th className={thCls}>Atiende</th>
            <th className={thCls}>Duración</th>
            <th className={thCls} />
          </tr>
        </thead>
        <tbody>
          {!datos && <EmptyRow cols={8} text="Cargando…" />}
          {datos?.items.length === 0 && <EmptyRow cols={8} text="Sin llamadas con estos filtros." />}
          {datos?.items.map((l) => (
            <tr key={l.id} className="border-t border-slate-700 align-top">
              <td className={`${tdCls} whitespace-nowrap`}>
                {fechaHora(l.startedAt)}
                <div className="text-[11px] text-slate-400">
                  {etqSentido(l.direction)} · {etqIdioma(l.language)}
                </div>
              </td>
              <td className={tdCls}>
                {l.customerName ? <span className="font-semibold">{l.customerName}</span> : <span className="text-amber-300">{l.callerName || "Interesado"}</span>}
                <div className="text-[11px] text-slate-400">
                  {l.phone ?? l.phoneRaw ?? "Número oculto"}
                  {l.centerName ? ` · ${l.centerName}` : ""}
                </div>
              </td>
              <td className={tdCls}>
                {l.reasonLabel ?? "—"}
                <div className="text-[11px] text-slate-400">{l.resultLabel ?? "sin resultado"}</div>
              </td>
              <td className={tdCls}>
                <ChipLlamada estado={l.status} />
                {l.followUpAt && !l.followUpDoneAt && <div className="text-[11px] text-amber-300">seguimiento {fechaHora(l.followUpAt)}</div>}
              </td>
              <td className={tdCls}>
                <ChipPrioridad p={l.priority} />
              </td>
              <td className={tdCls}>
                {etqAtendida(l.handledBy)}
                {l.operatorName && <div className="text-[11px] text-slate-400">{l.operatorName}</div>}
              </td>
              <td className={tdCls}>{duracion(l.durationSeconds)}</td>
              <td className={`${tdCls} text-right`}>
                <Link className={btnMini} to={`/self-storage/call-center/llamada/${l.id}`}>
                  Abrir
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </TableWrap>
      {total > POR_PAGINA && (
        <div className="flex items-center justify-end gap-2 text-[12px] text-slate-400">
          <button className={btnMini} disabled={pagina === 0} onClick={() => setPagina((p) => p - 1)}>
            Anterior
          </button>
          Página {pagina + 1} de {Math.ceil(total / POR_PAGINA)}
          <button className={btnMini} disabled={(pagina + 1) * POR_PAGINA >= total} onClick={() => setPagina((p) => p + 1)}>
            Siguiente
          </button>
        </div>
      )}
    </div>
  );
}

export default function Llamadas() {
  return <SiCallCenterActivo>{() => <Contenido />}</SiCallCenterActivo>;
}
