/**
 * Connect Pro — Ofertas (portal de la empresa proveedora).
 * El usuario provider_user ve las ofertas de su empresa y acepta/rechaza con motivo.
 * Los roles del centro de control ven todas (solo lectura + gestión desde la ficha).
 */

import { useCallback, useEffect, useState } from "react";
import { boFetch } from "../services/api";
import { PageTitle, Card, Th, Td, Badge, Select, Button, ErrorBanner, EmptyState } from "../components/ui";
import { useConnectAuth } from "../contexts/ConnectAuthContext";
import { fmtDateTime, type RejectionReason } from "../types";

type Offer = {
  id: number; status: string; sentAtMs: number; acceptDeadlineMs: number | null;
  explanation: string | null; assistanceId: number; serviceType: string; priority: string;
  address: string; customerName: string; description: string | null; workshopName: string;
};

const ST: Record<string, { label: string; cls: string }> = {
  sent: { label: "Pendiente de respuesta", cls: "border-fuchsia-500/40 bg-fuchsia-500/10 text-fuchsia-300" },
  accepted: { label: "Aceptada", cls: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300" },
  rejected: { label: "Rechazada", cls: "border-red-500/40 bg-red-500/10 text-red-300" },
  expired: { label: "Expirada", cls: "border-amber-500/40 bg-amber-500/10 text-amber-300" },
  withdrawn: { label: "Retirada", cls: "border-slate-600 text-slate-400" },
};

export default function Ofertas() {
  const { user } = useConnectAuth();
  const isProvider = user?.role === "provider_user";
  const [rows, setRows] = useState<Offer[]>([]);
  const [reasons, setReasons] = useState<RejectionReason[]>([]);
  const [rejecting, setRejecting] = useState<number | null>(null);
  const [reasonCode, setReasonCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    boFetch<{ data: Offer[] }>("/provider/offers").then((r) => setRows(r.data)).catch((e) => setError(e.message));
    boFetch<{ rejection_reasons: RejectionReason[] }>("/catalogs").then((r) => setReasons(r.rejection_reasons.filter((x) => x.active))).catch(() => {});
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 10000);
    return () => clearInterval(t);
  }, [load]);

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true); setError(null);
    try { await fn(); setRejecting(null); load(); }
    catch (e: any) { setError(e.message); } finally { setBusy(false); }
  };

  return (
    <div>
      <PageTitle
        title="Ofertas de asistencia"
        subtitle={isProvider ? "Asistencias ofrecidas a tu empresa. Responde antes del vencimiento." : "Ofertas enviadas a las empresas proveedoras."}
      />
      {error && <ErrorBanner message={error} onClose={() => setError(null)} />}

      {rows.length === 0 ? (
        <EmptyState message="No hay ofertas." />
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full">
            <thead><tr className="border-b border-slate-700">
              <Th>Enviada</Th><Th>Vence</Th><Th>Servicio</Th><Th>Cliente</Th><Th>Dirección</Th><Th>Taller</Th><Th>Estado</Th><Th></Th>
            </tr></thead>
            <tbody>
              {rows.map((o) => {
                const st = ST[o.status] ?? { label: o.status, cls: "border-slate-600 text-slate-400" };
                const expiresSoon = o.status === "sent" && o.acceptDeadlineMs && o.acceptDeadlineMs - Date.now() < 3 * 60000;
                return (
                  <tr key={o.id} className="border-b border-slate-700/50 hover:bg-slate-700/30" title={o.description ?? undefined}>
                    <Td className="whitespace-nowrap">{fmtDateTime(o.sentAtMs)}</Td>
                    <Td className={`whitespace-nowrap ${expiresSoon ? "font-bold text-red-300" : ""}`}>{fmtDateTime(o.acceptDeadlineMs)}</Td>
                    <Td>
                      {o.serviceType}
                      {o.priority === "urgente" && <Badge className="ml-1 border-red-500/40 bg-red-500/10 text-red-300">urgente</Badge>}
                    </Td>
                    <Td className="text-slate-100">{o.customerName}</Td>
                    <Td className="max-w-[240px] truncate">{o.address}</Td>
                    <Td>{o.workshopName}</Td>
                    <Td><Badge className={st.cls}>{st.label}</Badge></Td>
                    <Td>
                      {isProvider && o.status === "sent" && (
                        rejecting === o.id ? (
                          <div className="flex items-center gap-1">
                            <Select value={reasonCode} onChange={(e) => setReasonCode(e.target.value)}>
                              <option value="">— Motivo —</option>
                              {reasons.map((r) => <option key={r.code} value={r.code}>{r.label}</option>)}
                            </Select>
                            <Button variant="danger" disabled={busy || !reasonCode}
                              onClick={() => act(() => boFetch(`/provider/offers/${o.id}/reject`, { method: "POST", body: { reasonCode } }))}>
                              Rechazar
                            </Button>
                            <Button variant="ghost" onClick={() => setRejecting(null)}>✕</Button>
                          </div>
                        ) : (
                          <div className="flex gap-1">
                            <Button disabled={busy} onClick={() => act(() => boFetch(`/provider/offers/${o.id}/accept`, { method: "POST" }))}>
                              Aceptar
                            </Button>
                            <Button variant="ghost" disabled={busy} onClick={() => { setRejecting(o.id); setReasonCode(""); }}>
                              Rechazar…
                            </Button>
                          </div>
                        )
                      )}
                    </Td>
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
