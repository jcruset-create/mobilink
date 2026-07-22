/**
 * Connect Pro — Incidencias: bandeja con filtros, alta y gestión
 * (estado, gravedad, responsable, vencimiento, resolución).
 */

import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { boFetch } from "../services/api";
import { PageTitle, Card, Th, Td, Badge, Input, Select, Button, ErrorBanner, EmptyState } from "../components/ui";
import { fmtDateTime } from "../types";

export type Incident = {
  id: number; assistanceId: number | null; expedientNumber: string | null; customerName: string | null;
  providerName: string | null; type: string; severity: string; status: string;
  ownerName: string | null; description: string; resolution: string | null;
  dueAtMs: number | null; createdAtMs: number; createdByName: string | null;
};

export const INCIDENT_TYPE_LABELS: Record<string, string> = {
  delay: "Retraso", no_response: "Falta de respuesta", rejection: "Rechazo",
  wrong_data: "Datos incorrectos", customer_not_found: "Cliente no localizado",
  tech_not_found: "Técnico no localizado", unit_breakdown: "Unidad averiada",
  access_problem: "Problema de acceso", not_feasible: "Servicio no realizable",
  incomplete_service: "Servicio incompleto", incomplete_docs: "Documentación incompleta",
  insufficient_photos: "Fotografías insuficientes", complaint: "Reclamación",
  damages: "Daños", tariff_conflict: "Conflicto de tarifa", duplicate: "Duplicado",
  integration_error: "Error de integración", other: "Otro",
};

export const INCIDENT_STATUS_LABELS: Record<string, string> = {
  open: "Abierta", investigating: "En investigación", pending_provider: "Pendiente del proveedor",
  pending_client: "Pendiente del cliente", escalated: "Escalada", resolved: "Resuelta", closed: "Cerrada",
};

const SEVERITY: Record<string, { label: string; cls: string }> = {
  low: { label: "Baja", cls: "border-slate-600 text-slate-400" },
  medium: { label: "Media", cls: "border-sky-500/40 bg-sky-500/10 text-sky-300" },
  high: { label: "Alta", cls: "border-amber-500/40 bg-amber-500/10 text-amber-300" },
  critical: { label: "Crítica", cls: "border-red-500/60 bg-red-500/15 text-red-300" },
};

const STATUS_CLS: Record<string, string> = {
  open: "border-amber-500/40 bg-amber-500/10 text-amber-300",
  investigating: "border-sky-500/40 bg-sky-500/10 text-sky-300",
  pending_provider: "border-fuchsia-500/40 bg-fuchsia-500/10 text-fuchsia-300",
  pending_client: "border-violet-500/40 bg-violet-500/10 text-violet-300",
  escalated: "border-red-500/40 bg-red-500/10 text-red-300",
  resolved: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
  closed: "border-slate-600 text-slate-400",
};

export default function Incidencias() {
  const [rows, setRows] = useState<Incident[]>([]);
  const [fStatus, setFStatus] = useState("");
  const [fSeverity, setFSeverity] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [form, setForm] = useState({ type: "delay", severity: "medium", assistanceId: "", description: "", dueHours: "" });
  const [editing, setEditing] = useState<Incident | null>(null);
  const [edit, setEdit] = useState({ status: "", resolution: "", note: "" });

  const load = useCallback(() => {
    const q = new URLSearchParams();
    if (fStatus) q.set("status", fStatus);
    if (fSeverity) q.set("severity", fSeverity);
    boFetch<{ data: Incident[] }>(`/incidents?${q}`).then((r) => setRows(r.data)).catch((e) => setError(e.message));
  }, [fStatus, fSeverity]);

  useEffect(() => {
    load();
    const t = setInterval(load, 20000);
    return () => clearInterval(t);
  }, [load]);

  const crear = async () => {
    if (!form.description.trim()) { setError("La descripción es obligatoria."); return; }
    setBusy(true); setError(null);
    try {
      await boFetch("/incidents", {
        method: "POST",
        body: {
          type: form.type, severity: form.severity,
          assistanceId: form.assistanceId ? Number(form.assistanceId) : null,
          description: form.description.trim(),
          dueAtMs: form.dueHours ? Date.now() + Number(form.dueHours) * 3600_000 : null,
        },
      });
      setForm({ type: "delay", severity: "medium", assistanceId: "", description: "", dueHours: "" });
      setShowNew(false);
      load();
    } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  };

  const guardar = async () => {
    if (!editing) return;
    setBusy(true); setError(null);
    try {
      await boFetch(`/incidents/${editing.id}`, {
        method: "PATCH",
        body: {
          status: edit.status || undefined,
          resolution: edit.resolution || undefined,
          note: edit.note || undefined,
        },
      });
      setEditing(null);
      load();
    } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  };

  return (
    <div>
      <PageTitle
        title="Incidencias"
        subtitle="Bandeja de incidencias operativas de la red."
        actions={
          <div className="flex gap-2">
            <Select value={fStatus} onChange={(e) => setFStatus(e.target.value)}>
              <option value="">Todos los estados</option>
              {Object.entries(INCIDENT_STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </Select>
            <Select value={fSeverity} onChange={(e) => setFSeverity(e.target.value)}>
              <option value="">Toda gravedad</option>
              {Object.entries(SEVERITY).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </Select>
            <Button onClick={() => setShowNew((v) => !v)}>{showNew ? "Cerrar" : "Nueva incidencia"}</Button>
          </div>
        }
      />
      {error && <ErrorBanner message={error} onClose={() => setError(null)} />}

      {showNew && (
        <Card className="mb-4 p-4">
          <div className="flex flex-wrap gap-2">
            <Select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
              {Object.entries(INCIDENT_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </Select>
            <Select value={form.severity} onChange={(e) => setForm({ ...form, severity: e.target.value })}>
              {Object.entries(SEVERITY).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </Select>
            <Input placeholder="Nº asistencia (opcional)" value={form.assistanceId} onChange={(e) => setForm({ ...form, assistanceId: e.target.value })} className="w-40" />
            <Input placeholder="Límite (horas)" value={form.dueHours} onChange={(e) => setForm({ ...form, dueHours: e.target.value })} className="w-32" />
            <Input placeholder="Descripción de la incidencia" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className="w-full" />
            <Button onClick={crear} disabled={busy}>Crear incidencia</Button>
          </div>
        </Card>
      )}

      {editing && (
        <Card className="mb-4 border-cyan-500/30 p-4">
          <h3 className="mb-2 text-sm font-semibold text-cyan-300">
            Incidencia #{editing.id} — {INCIDENT_TYPE_LABELS[editing.type] ?? editing.type}
          </h3>
          <p className="mb-3 text-[13px] text-slate-300">{editing.description}</p>
          <div className="flex flex-wrap gap-2">
            <Select value={edit.status} onChange={(e) => setEdit({ ...edit, status: e.target.value })}>
              <option value="">— Cambiar estado —</option>
              {Object.entries(INCIDENT_STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </Select>
            <Input placeholder="Resolución (obligatoria al resolver/cerrar)" value={edit.resolution} onChange={(e) => setEdit({ ...edit, resolution: e.target.value })} className="w-80" />
            <Input placeholder="Nota interna" value={edit.note} onChange={(e) => setEdit({ ...edit, note: e.target.value })} className="w-64" />
            <Button onClick={guardar} disabled={busy}>Guardar</Button>
            <Button variant="ghost" onClick={() => setEditing(null)}>Cancelar</Button>
          </div>
        </Card>
      )}

      {rows.length === 0 ? (
        <EmptyState message="No hay incidencias con este filtro." />
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full">
            <thead><tr className="border-b border-slate-700">
              <Th>Abierta</Th><Th>Tipo</Th><Th>Gravedad</Th><Th>Asistencia</Th><Th>Proveedor</Th>
              <Th>Responsable</Th><Th>Vence</Th><Th>Estado</Th><Th></Th>
            </tr></thead>
            <tbody>
              {rows.map((i) => {
                const sev = SEVERITY[i.severity] ?? SEVERITY.medium;
                const overdue = i.dueAtMs && i.dueAtMs < Date.now() && !["resolved", "closed"].includes(i.status);
                return (
                  <tr key={i.id} className="border-b border-slate-700/50 hover:bg-slate-700/30" title={i.description}>
                    <Td className="whitespace-nowrap">{fmtDateTime(i.createdAtMs)}</Td>
                    <Td className="text-slate-100">{INCIDENT_TYPE_LABELS[i.type] ?? i.type}</Td>
                    <Td><Badge className={sev.cls}>{sev.label}</Badge></Td>
                    <Td>
                      {i.assistanceId
                        ? <Link className="text-cyan-300 hover:underline" to={`/connect/asistencias/${i.assistanceId}`}>#{i.assistanceId}{i.expedientNumber ? ` · ${i.expedientNumber}` : ""}</Link>
                        : "-"}
                    </Td>
                    <Td>{i.providerName ?? "-"}</Td>
                    <Td>{i.ownerName ?? "-"}</Td>
                    <Td className={overdue ? "font-bold text-red-300" : ""}>{fmtDateTime(i.dueAtMs)}</Td>
                    <Td><Badge className={STATUS_CLS[i.status] ?? "border-slate-600 text-slate-400"}>{INCIDENT_STATUS_LABELS[i.status] ?? i.status}</Badge></Td>
                    <Td><Button variant="ghost" onClick={() => { setEditing(i); setEdit({ status: "", resolution: i.resolution ?? "", note: "" }); }}>Gestionar</Button></Td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
