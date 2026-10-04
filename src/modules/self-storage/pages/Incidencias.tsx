/**
 * Incidencias de Self Storage (la ÚNICA entidad de incidencias del módulo).
 * Se abren desde una llamada o desde aquí. Las de acceso, seguridad,
 * emergencia y fallo grave son siempre urgentes y salen las primeras.
 * No dependen de que el Call Center esté activo.
 */

import { useCallback, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import * as api from "../services/api";
import { INCIDENT_STATUSES, INCIDENT_TYPES, PRIORITIES, URGENT_INCIDENT_TYPES, type Incidencia, type IncidentStatus, type IncidentType, type Pagina, type Priority } from "../types";
import { Aviso, Cabecera, EmptyRow, ErrorBox, Modal, SelectField, TableWrap, TextAreaField, TextField, btnMini, btnPrimary, btnSecondary, fechaHora, msgError, tdCls, thCls } from "../components/ui";
import { useSelfStorage } from "../contexts/SelfStorageContext";
import { ChipIncidencia, ChipPrioridad } from "./callcenter/comun";

export default function Incidencias() {
  const { centros, centroId, puede, etqTipoIncidencia, etqEstadoIncidencia, etqPrioridad } = useSelfStorage();
  const [params] = useSearchParams();
  const [f, setF] = useState({ centerId: "", open: params.get("id") ? "" : "1", status: "", priority: "", incidentType: "" });
  const [datos, setDatos] = useState<Pagina<Incidencia> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editar, setEditar] = useState<Incidencia | "nueva" | null>(null);
  const [abiertaDeEnlace, setAbiertaDeEnlace] = useState(false);

  const cargar = useCallback(async () => {
    try {
      const filtro: Record<string, string> = {};
      for (const [k, v] of Object.entries(f)) if (v) filtro[k] = v;
      const d = await api.incidencias({ ...filtro, limit: 200 });
      setDatos(d);
      setError(null);
      return d;
    } catch (e) {
      setError(msgError(e));
      return null;
    }
  }, [f]);
  useEffect(() => {
    void cargar().then((d) => {
      // Enlace directo desde una llamada: ?id=… abre esa incidencia una vez.
      const id = params.get("id");
      if (d && id && !abiertaDeEnlace) {
        const n = d.items.find((x) => x.id === id);
        if (n) {
          setEditar(n);
          setAbiertaDeEnlace(true);
        }
      }
    });
  }, [cargar, params, abiertaDeEnlace]);

  const set = (k: keyof typeof f) => (v: string) => setF((x) => ({ ...x, [k]: v }));
  return (
    <div className="space-y-3">
      <Cabecera titulo="Incidencias" descripcion="Acceso, seguridad, emergencias y fallos graves: siempre urgentes.">
        {puede("ss.incidents.create") && (
          <button className={btnPrimary} onClick={() => setEditar("nueva")}>
            Nueva incidencia
          </button>
        )}
      </Cabecera>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
        <SelectField label="Centro" value={f.centerId} onChange={set("centerId")}>
          <option value="">Todos</option>
          {centros.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </SelectField>
        <SelectField label="Abiertas" value={f.open} onChange={set("open")}>
          <option value="1">Sólo abiertas</option>
          <option value="">Todas</option>
        </SelectField>
        <SelectField label="Estado" value={f.status} onChange={set("status")}>
          <option value="">Todos</option>
          {INCIDENT_STATUSES.map((s) => (
            <option key={s} value={s}>
              {etqEstadoIncidencia(s)}
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
        <SelectField label="Tipo" value={f.incidentType} onChange={set("incidentType")}>
          <option value="">Todos</option>
          {INCIDENT_TYPES.map((t) => (
            <option key={t} value={t}>
              {etqTipoIncidencia(t)}
            </option>
          ))}
        </SelectField>
      </div>
      {error && <ErrorBox>{error}</ErrorBox>}
      <TableWrap>
        <thead>
          <tr>
            <th className={thCls}>Abierta</th>
            <th className={thCls}>Incidencia</th>
            <th className={thCls}>Cliente · centro</th>
            <th className={thCls}>Prioridad</th>
            <th className={thCls}>Estado</th>
            <th className={thCls} />
          </tr>
        </thead>
        <tbody>
          {!datos && <EmptyRow cols={6} text="Cargando…" />}
          {datos?.items.length === 0 && <EmptyRow cols={6} text="Sin incidencias." />}
          {datos?.items.map((n) => (
            <tr key={n.id} className="border-t border-slate-700 align-top">
              <td className={`${tdCls} whitespace-nowrap`}>
                {fechaHora(n.createdAt)}
                <div className="text-[11px] text-slate-400">{n.openedByName ?? (n.source === "call" ? "Call Center" : n.source)}</div>
              </td>
              <td className={tdCls}>
                <div className="font-semibold">{n.title}</div>
                <div className="text-[11px] text-slate-400">
                  {etqTipoIncidencia(n.incidentType)}
                  {n.callId && puede("ss.callcenter.view") && (
                    <>
                      {" · "}
                      <Link className="underline" to={`/self-storage/call-center/llamada/${n.callId}`}>
                        ver llamada
                      </Link>
                    </>
                  )}
                </div>
              </td>
              <td className={tdCls}>
                {n.customerName ?? "—"}
                <div className="text-[11px] text-slate-400">
                  {n.centerName}
                  {n.contractNumber ? ` · ${n.contractNumber}` : ""}
                </div>
              </td>
              <td className={tdCls}>
                <ChipPrioridad p={n.priority} />
              </td>
              <td className={tdCls}>
                <ChipIncidencia estado={n.status} />
                {n.assignedToName && <div className="text-[11px] text-slate-400">{n.assignedToName}</div>}
              </td>
              <td className={`${tdCls} text-right`}>
                <button className={btnMini} onClick={() => setEditar(n)}>
                  {puede("ss.incidents.manage") ? "Gestionar" : "Ver"}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </TableWrap>
      {editar === "nueva" && (
        <Alta
          centroInicial={f.centerId || centroId || ""}
          onCerrar={() => setEditar(null)}
          onHecho={() => {
            setEditar(null);
            void cargar();
          }}
        />
      )}
      {editar && editar !== "nueva" && (
        <Gestion
          n={editar}
          puedeGestionar={puede("ss.incidents.manage")}
          onCerrar={() => setEditar(null)}
          onHecho={() => {
            setEditar(null);
            void cargar();
          }}
        />
      )}
    </div>
  );
}

function Alta({ centroInicial, onCerrar, onHecho }: { centroInicial: string; onCerrar: () => void; onHecho: () => void }) {
  const { centros, etqTipoIncidencia, etqPrioridad } = useSelfStorage();
  const [d, setD] = useState({ centerId: centroInicial, incidentType: "other" as IncidentType, priority: "normal" as Priority, title: "", description: "" });
  const [error, setError] = useState<string | null>(null);
  const urgente = URGENT_INCIDENT_TYPES.includes(d.incidentType);
  const crear = async () => {
    try {
      await api.crearIncidencia({ ...d, description: d.description.trim() || null, priority: urgente ? "urgent" : d.priority });
      onHecho();
    } catch (e) {
      setError(msgError(e));
    }
  };
  return (
    <Modal
      title="Nueva incidencia"
      onClose={onCerrar}
      footer={
        <div className="flex justify-end gap-2">
          <button className={btnSecondary} onClick={onCerrar}>
            Cancelar
          </button>
          <button className={btnPrimary} disabled={!d.centerId || !d.title.trim()} onClick={() => void crear()}>
            Crear
          </button>
        </div>
      }
    >
      <div className="space-y-2">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <SelectField label="Centro" value={d.centerId} onChange={(v) => setD((x) => ({ ...x, centerId: v }))}>
            <option value="">— Elige —</option>
            {centros.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </SelectField>
          <SelectField label="Tipo" value={d.incidentType} onChange={(v) => setD((x) => ({ ...x, incidentType: v as IncidentType }))}>
            {INCIDENT_TYPES.map((t) => (
              <option key={t} value={t}>
                {etqTipoIncidencia(t)}
              </option>
            ))}
          </SelectField>
          {!urgente && (
            <SelectField label="Prioridad" value={d.priority} onChange={(v) => setD((x) => ({ ...x, priority: v as Priority }))}>
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {etqPrioridad(p)}
                </option>
              ))}
            </SelectField>
          )}
        </div>
        {urgente && <Aviso tono="mal">Este tipo es siempre urgente.</Aviso>}
        <TextField label="Título" value={d.title} onChange={(v) => setD((x) => ({ ...x, title: v }))} />
        <TextAreaField label="Descripción" value={d.description} onChange={(v) => setD((x) => ({ ...x, description: v }))} rows={3} />
        {error && <ErrorBox>{error}</ErrorBox>}
      </div>
    </Modal>
  );
}

function Gestion({ n, puedeGestionar, onCerrar, onHecho }: { n: Incidencia; puedeGestionar: boolean; onCerrar: () => void; onHecho: () => void }) {
  const { etqTipoIncidencia, etqEstadoIncidencia, etqPrioridad } = useSelfStorage();
  const [status, setStatus] = useState<IncidentStatus>(n.status);
  const [priority, setPriority] = useState<Priority>(n.priority);
  const [resolution, setResolution] = useState(n.resolution ?? "");
  const [error, setError] = useState<string | null>(null);
  const urgente = URGENT_INCIDENT_TYPES.includes(n.incidentType);
  const guardar = async () => {
    try {
      await api.editarIncidencia(n.id, { status, priority, resolution: resolution.trim() || null });
      onHecho();
    } catch (e) {
      setError(msgError(e));
    }
  };
  return (
    <Modal
      title={n.title}
      onClose={onCerrar}
      footer={
        <div className="flex justify-end gap-2">
          <button className={btnSecondary} onClick={onCerrar}>
            Cerrar
          </button>
          {puedeGestionar && (
            <button className={btnPrimary} onClick={() => void guardar()}>
              Guardar
            </button>
          )}
        </div>
      }
    >
      <div className="space-y-2 text-[13px]">
        <div className="text-slate-300">
          {etqTipoIncidencia(n.incidentType)} · {n.centerName}
          {n.customerName ? ` · ${n.customerName}` : ""}
          {n.contractNumber ? ` · ${n.contractNumber}` : ""}
        </div>
        <div className="text-[12px] text-slate-400">
          Abierta {fechaHora(n.createdAt)}
          {n.openedByName ? ` por ${n.openedByName}` : ""}
          {n.resolvedAt ? ` · resuelta ${fechaHora(n.resolvedAt)}` : ""}
          {n.closedAt ? ` · cerrada ${fechaHora(n.closedAt)}` : ""}
        </div>
        {n.description && <p className="whitespace-pre-wrap rounded-lg bg-slate-900 p-2">{n.description}</p>}
        {puedeGestionar ? (
          <>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <SelectField label="Estado" value={status} onChange={(v) => setStatus(v as IncidentStatus)}>
                {INCIDENT_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {etqEstadoIncidencia(s)}
                  </option>
                ))}
              </SelectField>
              <SelectField label="Prioridad" value={priority} onChange={(v) => setPriority(v as Priority)}>
                {(urgente ? (["urgent"] as Priority[]) : PRIORITIES).map((p) => (
                  <option key={p} value={p}>
                    {etqPrioridad(p)}
                  </option>
                ))}
              </SelectField>
            </div>
            <TextAreaField label="Resolución" value={resolution} onChange={setResolution} rows={3} />
          </>
        ) : (
          <div>
            Estado: {etqEstadoIncidencia(n.status)}
            {n.resolution && <p className="mt-1 whitespace-pre-wrap">{n.resolution}</p>}
          </div>
        )}
        {error && <ErrorBox>{error}</ErrorBox>}
      </div>
    </Modal>
  );
}
