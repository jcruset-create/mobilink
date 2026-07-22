/** Connect Pro — Configuración: catálogos editables (tipos de asistencia y motivos de rechazo). */

import { useCallback, useEffect, useState } from "react";
import { boFetch } from "../services/api";
import { useConnectAuth, hasRole } from "../contexts/ConnectAuthContext";
import { PageTitle, Card, Th, Td, Badge, Input, Button, ErrorBanner } from "../components/ui";
import type { ServiceType, RejectionReason } from "../types";

export default function Configuracion() {
  const { user } = useConnectAuth();
  const canEdit = hasRole(user, "cc_admin");
  const [types, setTypes] = useState<ServiceType[]>([]);
  const [reasons, setReasons] = useState<RejectionReason[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [newType, setNewType] = useState({ code: "", name: "" });
  const [newReason, setNewReason] = useState({ code: "", label: "" });

  const load = useCallback(() => {
    boFetch<{ service_types: ServiceType[]; rejection_reasons: RejectionReason[] }>("/catalogs")
      .then((r) => { setTypes(r.service_types); setReasons(r.rejection_reasons); })
      .catch((e) => setError(e.message));
  }, []);
  useEffect(load, [load]);

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true); setError(null);
    try { await fn(); load(); }
    catch (e: any) { setError(e.message); } finally { setBusy(false); }
  };

  return (
    <div>
      <PageTitle title="Configuración" subtitle="Catálogos del centro de control." />
      {error && <ErrorBanner message={error} onClose={() => setError(null)} />}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="overflow-x-auto">
          <h2 className="border-b border-slate-700 px-4 py-3 text-sm font-semibold text-slate-300">Tipos de asistencia</h2>
          {canEdit && (
            <div className="flex gap-2 border-b border-slate-700/50 p-3">
              <Input placeholder="código" value={newType.code} onChange={(e) => setNewType({ ...newType, code: e.target.value })} className="w-32" />
              <Input placeholder="Nombre" value={newType.name} onChange={(e) => setNewType({ ...newType, name: e.target.value })} />
              <Button disabled={busy || !newType.code.trim() || !newType.name.trim()}
                onClick={() => act(async () => { await boFetch("/catalogs/service-types", { method: "POST", body: newType }); setNewType({ code: "", name: "" }); })}>
                Añadir
              </Button>
            </div>
          )}
          <table className="w-full">
            <thead><tr className="border-b border-slate-700"><Th>Código</Th><Th>Nombre</Th><Th>Estado</Th>{canEdit && <Th></Th>}</tr></thead>
            <tbody>
              {types.map((t) => (
                <tr key={t.id} className="border-b border-slate-700/50">
                  <Td className="font-mono text-[12px]">{t.code}</Td>
                  <Td className="text-slate-100">{t.name}</Td>
                  <Td><Badge className={t.active ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300" : "border-slate-600 text-slate-500"}>{t.active ? "Activo" : "Inactivo"}</Badge></Td>
                  {canEdit && (
                    <Td>
                      <Button variant="ghost" disabled={busy}
                        onClick={() => act(() => boFetch(`/catalogs/service-types/${t.id}`, { method: "PATCH", body: { active: !t.active } }))}>
                        {t.active ? "Desactivar" : "Activar"}
                      </Button>
                    </Td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </Card>

        <Card className="overflow-x-auto">
          <h2 className="border-b border-slate-700 px-4 py-3 text-sm font-semibold text-slate-300">Motivos de rechazo</h2>
          {canEdit && (
            <div className="flex gap-2 border-b border-slate-700/50 p-3">
              <Input placeholder="código" value={newReason.code} onChange={(e) => setNewReason({ ...newReason, code: e.target.value })} className="w-32" />
              <Input placeholder="Motivo" value={newReason.label} onChange={(e) => setNewReason({ ...newReason, label: e.target.value })} />
              <Button disabled={busy || !newReason.code.trim() || !newReason.label.trim()}
                onClick={() => act(async () => { await boFetch("/catalogs/rejection-reasons", { method: "POST", body: newReason }); setNewReason({ code: "", label: "" }); })}>
                Añadir
              </Button>
            </div>
          )}
          <table className="w-full">
            <thead><tr className="border-b border-slate-700"><Th>Código</Th><Th>Motivo</Th><Th>Afecta al score</Th><Th>Estado</Th>{canEdit && <Th></Th>}</tr></thead>
            <tbody>
              {reasons.map((r) => (
                <tr key={r.id} className="border-b border-slate-700/50">
                  <Td className="font-mono text-[12px]">{r.code}</Td>
                  <Td className="text-slate-100">{r.label}</Td>
                  <Td>
                    {canEdit ? (
                      <button
                        disabled={busy}
                        onClick={() => act(() => boFetch(`/catalogs/rejection-reasons/${r.id}`, { method: "PATCH", body: { affectsScoreDefault: !r.affectsScoreDefault } }))}
                        className="text-[13px] text-cyan-300 hover:underline"
                      >
                        {r.affectsScoreDefault ? "Sí" : "No"}
                      </button>
                    ) : (r.affectsScoreDefault ? "Sí" : "No")}
                  </Td>
                  <Td><Badge className={r.active ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300" : "border-slate-600 text-slate-500"}>{r.active ? "Activo" : "Inactivo"}</Badge></Td>
                  {canEdit && (
                    <Td>
                      <Button variant="ghost" disabled={busy}
                        onClick={() => act(() => boFetch(`/catalogs/rejection-reasons/${r.id}`, { method: "PATCH", body: { active: !r.active } }))}>
                        {r.active ? "Desactivar" : "Activar"}
                      </Button>
                    </Td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>
    </div>
  );
}
