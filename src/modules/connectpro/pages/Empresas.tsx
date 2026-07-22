/** Connect Pro — Empresas de asistencia: CRUD, delegaciones y autorizaciones. */

import { useCallback, useEffect, useState } from "react";
import { boFetch } from "../services/api";
import { useConnectAuth, hasRole } from "../contexts/ConnectAuthContext";
import { PageTitle, Card, Th, Td, Badge, Input, Button, ErrorBanner, EmptyState } from "../components/ui";
import type { ProviderCompany, Branch, Authorization } from "../types";
import { fmtDateTime } from "../types";
import TarifasEditor from "../components/TarifasEditor";

export default function Empresas() {
  const { user } = useConnectAuth();
  const canEdit = hasRole(user, "cc_admin");
  const [rows, setRows] = useState<ProviderCompany[]>([]);
  const [auths, setAuths] = useState<Authorization[]>([]);
  const [selected, setSelected] = useState<ProviderCompany | null>(null);
  const [tariffAuth, setTariffAuth] = useState<Authorization | null>(null);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ name: "", contactEmail: "", contactPhone: "" });
  const [branchForm, setBranchForm] = useState({ name: "", address: "", latitude: "", longitude: "", phone: "" });
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    boFetch<{ data: ProviderCompany[] }>("/providers").then((r) => setRows(r.data)).catch((e) => setError(e.message));
    boFetch<{ data: Authorization[] }>("/authorizations").then((r) => setAuths(r.data)).catch(() => {});
  }, []);
  useEffect(load, [load]);

  useEffect(() => {
    if (!selected) return;
    boFetch<{ data: Branch[] }>(`/providers/${selected.id}/branches`).then((r) => setBranches(r.data)).catch(() => setBranches([]));
  }, [selected]);

  const crear = async () => {
    if (!form.name.trim()) return;
    setBusy(true);
    try {
      await boFetch("/providers", { method: "POST", body: form });
      setForm({ name: "", contactEmail: "", contactPhone: "" });
      load();
    } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  };

  const autorizar = async (providerCompanyId: number) => {
    setBusy(true);
    try {
      await boFetch("/authorizations", { method: "POST", body: { providerCompanyId } });
      load();
    } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  };

  const crearDelegacion = async () => {
    if (!selected || !branchForm.name.trim()) return;
    setBusy(true);
    try {
      await boFetch(`/providers/${selected.id}/branches`, {
        method: "POST",
        body: {
          name: branchForm.name.trim(), address: branchForm.address || null,
          latitude: branchForm.latitude ? Number(branchForm.latitude) : null,
          longitude: branchForm.longitude ? Number(branchForm.longitude) : null,
          phone: branchForm.phone || null,
        },
      });
      setBranchForm({ name: "", address: "", latitude: "", longitude: "", phone: "" });
      boFetch<{ data: Branch[] }>(`/providers/${selected.id}/branches`).then((r) => setBranches(r.data));
      load();
    } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  };

  const authFor = (pcId: number) => auths.find((a) => a.providerCompanyId === pcId && !a.branchId);

  return (
    <div>
      <PageTitle title="Empresas de asistencia" subtitle="Red de empresas proveedoras y sus autorizaciones para este centro de control." />
      {error && <ErrorBanner message={error} onClose={() => setError(null)} />}

      {canEdit && (
        <Card className="mb-4 p-4">
          <h2 className="mb-3 text-sm font-semibold text-slate-300">Nueva empresa proveedora</h2>
          <div className="flex flex-wrap gap-2">
            <Input placeholder="Nombre de la empresa" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <Input placeholder="Email de contacto" value={form.contactEmail} onChange={(e) => setForm({ ...form, contactEmail: e.target.value })} />
            <Input placeholder="Teléfono" value={form.contactPhone} onChange={(e) => setForm({ ...form, contactPhone: e.target.value })} className="w-40" />
            <Button onClick={crear} disabled={busy || !form.name.trim()}>Crear empresa</Button>
          </div>
        </Card>
      )}

      <Card className="overflow-x-auto">
        <table className="w-full">
          <thead><tr className="border-b border-slate-700">
            <Th>Empresa</Th><Th>Contacto</Th><Th>Delegaciones</Th><Th>Talleres</Th><Th>Autorización</Th><Th>Alta</Th><Th></Th>
          </tr></thead>
          <tbody>
            {rows.map((p) => {
              const a = authFor(p.id);
              return (
                <tr key={p.id} className="border-b border-slate-700/50 hover:bg-slate-700/30">
                  <Td className="font-semibold text-slate-100">{p.name}</Td>
                  <Td>{p.contactEmail ?? "-"}{p.contactPhone ? ` · ${p.contactPhone}` : ""}</Td>
                  <Td>{p.branches}</Td>
                  <Td>{p.workshops}</Td>
                  <Td>
                    {a ? (
                      <Badge className={a.status === "active" ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300" : "border-slate-600 text-slate-400"}>
                        {a.status === "active" ? (a.preferred ? "Autorizada · preferente" : "Autorizada") : a.status}
                      </Badge>
                    ) : canEdit ? (
                      <Button variant="ghost" onClick={() => autorizar(p.id)} disabled={busy}>Autorizar</Button>
                    ) : (
                      <Badge className="border-slate-600 text-slate-500">Sin autorización</Badge>
                    )}
                  </Td>
                  <Td>{fmtDateTime(p.createdAtMs)}</Td>
                  <Td>
                    <div className="flex gap-1">
                      <Button variant="ghost" onClick={() => setSelected(selected?.id === p.id ? null : p)}>{selected?.id === p.id ? "Cerrar" : "Delegaciones"}</Button>
                      {a && (
                        <Button variant="ghost" onClick={() => setTariffAuth(tariffAuth?.id === a.id ? null : a)}>
                          {tariffAuth?.id === a.id ? "Cerrar tarifas" : "Tarifas"}
                        </Button>
                      )}
                    </div>
                  </Td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr><Td className="py-8 text-center" >Sin empresas todavía.</Td></tr>
            )}
          </tbody>
        </table>
      </Card>

      {tariffAuth && (
        <TarifasEditor authorizationId={tariffAuth.id} providerName={tariffAuth.providerName} canEdit={canEdit} />
      )}

      {selected && (
        <Card className="mt-4 p-4">
          <h2 className="mb-3 text-sm font-semibold text-slate-300">Delegaciones de {selected.name}</h2>
          {canEdit && (
            <div className="mb-3 flex flex-wrap gap-2">
              <Input placeholder="Nombre" value={branchForm.name} onChange={(e) => setBranchForm({ ...branchForm, name: e.target.value })} />
              <Input placeholder="Dirección" value={branchForm.address} onChange={(e) => setBranchForm({ ...branchForm, address: e.target.value })} className="w-64" />
              <Input placeholder="Lat" value={branchForm.latitude} onChange={(e) => setBranchForm({ ...branchForm, latitude: e.target.value })} className="w-24" />
              <Input placeholder="Lng" value={branchForm.longitude} onChange={(e) => setBranchForm({ ...branchForm, longitude: e.target.value })} className="w-24" />
              <Input placeholder="Teléfono" value={branchForm.phone} onChange={(e) => setBranchForm({ ...branchForm, phone: e.target.value })} className="w-36" />
              <Button onClick={crearDelegacion} disabled={busy || !branchForm.name.trim()}>Añadir</Button>
            </div>
          )}
          {branches.length === 0 ? (
            <EmptyState message="Esta empresa no tiene delegaciones registradas." />
          ) : (
            <table className="w-full">
              <thead><tr className="border-b border-slate-700"><Th>Nombre</Th><Th>Dirección</Th><Th>Coordenadas</Th><Th>Teléfono</Th></tr></thead>
              <tbody>
                {branches.map((b) => (
                  <tr key={b.id} className="border-b border-slate-700/50">
                    <Td className="font-semibold text-slate-100">{b.name}</Td>
                    <Td>{b.address ?? "-"}</Td>
                    <Td>{b.latitude != null ? `${b.latitude.toFixed(4)}, ${b.longitude?.toFixed(4)}` : "-"}</Td>
                    <Td>{b.phone ?? "-"}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      )}
    </div>
  );
}
