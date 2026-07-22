/**
 * Connect Pro — pestaña "Asignación" de la ficha: comparador de candidatos
 * con score y explicación, historial de ofertas y acciones de oferta/rechazo.
 */

import { useCallback, useEffect, useState } from "react";
import { boFetch } from "../services/api";
import { Card, Th, Td, Badge, Button, Select, ErrorBanner, EmptyState } from "./ui";
import { fmtDateTime, type RejectionReason } from "../types";

type Candidate = {
  workshopId: number; name: string; providerName: string | null; requiresAcceptance: boolean;
  distanceKm: number; etaMinutes: number; score: number; explanation: string;
};

type Assignment = {
  id: number; workshopName: string; providerName: string | null; mode: string; status: string;
  score: number | null; explanation: string | null; sentAtMs: number; respondedAtMs: number | null;
  respondedBy: string | null; acceptDeadlineMs: number | null;
  reasonCode: string | null; rejectionComment: string | null;
};

const ASG_STATUS: Record<string, { label: string; cls: string }> = {
  sent: { label: "Enviada", cls: "border-fuchsia-500/40 bg-fuchsia-500/10 text-fuchsia-300" },
  accepted: { label: "Aceptada", cls: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300" },
  rejected: { label: "Rechazada", cls: "border-red-500/40 bg-red-500/10 text-red-300" },
  expired: { label: "Expirada", cls: "border-amber-500/40 bg-amber-500/10 text-amber-300" },
  withdrawn: { label: "Retirada", cls: "border-slate-600 text-slate-400" },
};

export default function AsignacionTab({
  assistanceId, status, canOperate, onChanged,
}: { assistanceId: number; status: string; canOperate: boolean; onChanged: () => void }) {
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [reasons, setReasons] = useState<RejectionReason[]>([]);
  const [rejectingId, setRejectingId] = useState<number | null>(null);
  const [reasonCode, setReasonCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const assignable = ["pending", "searching", "no_coverage", "assignment_failed"].includes(status);
  const awaiting = status === "awaiting_acceptance";

  const load = useCallback(() => {
    boFetch<{ data: Assignment[] }>(`/assistances/${assistanceId}/assignments`).then((r) => setAssignments(r.data)).catch(() => {});
    if (assignable) {
      boFetch<{ data: Candidate[] }>(`/assistances/${assistanceId}/candidates`)
        .then((r) => setCandidates(r.data))
        .catch((e) => { setCandidates([]); setError(e.message); });
    }
    boFetch<{ rejection_reasons: RejectionReason[] }>("/catalogs").then((r) => setReasons(r.rejection_reasons.filter((x) => x.active))).catch(() => {});
  }, [assistanceId, assignable]);
  useEffect(load, [load]);

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true); setError(null);
    try { await fn(); load(); onChanged(); }
    catch (e: any) { setError(e.message); } finally { setBusy(false); }
  };

  const asignar = (workshopId: number, mode: "auto" | "offer" | "direct") =>
    act(() => boFetch(`/assistances/${assistanceId}/assign`, { method: "POST", body: { workshopId, mode } }));

  const pendingOffer = assignments.find((a) => a.status === "sent");

  return (
    <div className="flex flex-col gap-4">
      {error && <ErrorBanner message={error} onClose={() => setError(null)} />}

      {awaiting && pendingOffer && canOperate && (
        <Card className="border-fuchsia-500/30 p-4">
          <h3 className="mb-2 text-sm font-semibold text-fuchsia-300">
            Oferta pendiente en {pendingOffer.workshopName}
            {pendingOffer.acceptDeadlineMs && ` · vence ${fmtDateTime(pendingOffer.acceptDeadlineMs)}`}
          </h3>
          <p className="mb-3 text-[12px] text-slate-400">
            Si el proveedor responde por teléfono, registra aquí su respuesta.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={() => act(() => boFetch(`/assignments/${pendingOffer.id}/accept`, { method: "POST" }))} disabled={busy}>
              Aceptación telefónica
            </Button>
            {rejectingId === pendingOffer.id ? (
              <>
                <Select value={reasonCode} onChange={(e) => setReasonCode(e.target.value)}>
                  <option value="">— Motivo del rechazo —</option>
                  {reasons.map((r) => <option key={r.code} value={r.code}>{r.label}</option>)}
                </Select>
                <Button
                  variant="danger" disabled={busy || !reasonCode}
                  onClick={() => act(() => boFetch(`/assignments/${pendingOffer.id}/reject`, { method: "POST", body: { reasonCode } }))}
                >
                  Confirmar rechazo
                </Button>
                <Button variant="ghost" onClick={() => setRejectingId(null)}>Cancelar</Button>
              </>
            ) : (
              <Button variant="ghost" onClick={() => { setRejectingId(pendingOffer.id); setReasonCode(""); }}>Registrar rechazo…</Button>
            )}
          </div>
        </Card>
      )}

      {assignable && (
        <Card className="overflow-x-auto">
          <h3 className="border-b border-slate-700 px-4 py-3 text-sm font-semibold text-slate-300">
            Comparador de proveedores {candidates ? `(${candidates.length} candidatos)` : ""}
          </h3>
          {!candidates ? (
            <p className="p-4 text-sm text-slate-500">Buscando candidatos…</p>
          ) : candidates.length === 0 ? (
            <EmptyState message="Ningún taller elegible cubre esta zona/servicio (los ya descartados no se reofertan)." />
          ) : (
            <table className="w-full">
              <thead><tr className="border-b border-slate-700">
                <Th>#</Th><Th>Taller</Th><Th>Empresa</Th><Th>Distancia</Th><Th>ETA</Th><Th>Score</Th><Th>Motivo</Th><Th></Th>
              </tr></thead>
              <tbody>
                {candidates.map((c, i) => (
                  <tr key={c.workshopId} className="border-b border-slate-700/50 hover:bg-slate-700/30">
                    <Td>{i + 1}</Td>
                    <Td className="font-semibold text-slate-100">{c.name}</Td>
                    <Td>{c.providerName ?? "-"}</Td>
                    <Td>{c.distanceKm} km</Td>
                    <Td>~{c.etaMinutes} min</Td>
                    <Td><Badge className={c.score >= 80 ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300" : c.score >= 60 ? "border-amber-500/40 bg-amber-500/10 text-amber-300" : "border-red-500/40 bg-red-500/10 text-red-300"}>{c.score}</Badge></Td>
                    <Td className="max-w-[260px] text-[12px] text-slate-400">{c.explanation}</Td>
                    <Td>
                      {canOperate && (
                        <div className="flex gap-1">
                          <Button onClick={() => asignar(c.workshopId, "auto")} disabled={busy} title={c.requiresAcceptance ? "Enviará oferta (la autorización exige aceptación)" : "Asignación directa"}>
                            {c.requiresAcceptance ? "Enviar oferta" : "Asignar"}
                          </Button>
                          {!c.requiresAcceptance && (
                            <Button variant="ghost" onClick={() => asignar(c.workshopId, "offer")} disabled={busy} title="Forzar oferta con aceptación">
                              Ofertar
                            </Button>
                          )}
                        </div>
                      )}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      )}

      <Card className="overflow-x-auto">
        <h3 className="border-b border-slate-700 px-4 py-3 text-sm font-semibold text-slate-300">Historial de ofertas y asignaciones</h3>
        {assignments.length === 0 ? (
          <EmptyState message="Todavía no se ha ofertado esta asistencia." />
        ) : (
          <table className="w-full">
            <thead><tr className="border-b border-slate-700">
              <Th>Enviada</Th><Th>Taller</Th><Th>Empresa</Th><Th>Modo</Th><Th>Estado</Th><Th>Respuesta</Th>
            </tr></thead>
            <tbody>
              {assignments.map((a) => {
                const st = ASG_STATUS[a.status] ?? { label: a.status, cls: "border-slate-600 text-slate-400" };
                return (
                  <tr key={a.id} className="border-b border-slate-700/50">
                    <Td className="whitespace-nowrap">{fmtDateTime(a.sentAtMs)}</Td>
                    <Td className="font-semibold text-slate-100">{a.workshopName}</Td>
                    <Td>{a.providerName ?? "-"}</Td>
                    <Td>{a.mode === "offer" ? "Oferta" : "Directa"}</Td>
                    <Td><Badge className={st.cls}>{st.label}</Badge></Td>
                    <Td className="text-[12px] text-slate-400">
                      {a.respondedAtMs ? `${fmtDateTime(a.respondedAtMs)}${a.respondedBy ? ` · ${a.respondedBy}` : ""}` : "-"}
                      {a.reasonCode && <div className="text-red-300">Motivo: {a.reasonCode}{a.rejectionComment ? ` — ${a.rejectionComment}` : ""}</div>}
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
