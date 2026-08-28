/**
 * Connect Pro — Empresas de asistencia: lista de la red. Toda la gestión
 * (datos, autorización, tarifas, talleres, unidades, operarios) vive en la
 * ficha de cada empresa. Las delegaciones han desaparecido: solo talleres.
 */

import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { boFetch } from "../services/api";
import { useConnectAuth, hasRole } from "../contexts/ConnectAuthContext";
import { PageTitle, Card, Th, Td, Badge, Input, Button, ErrorBanner, EmptyState } from "../components/ui";
import type { ProviderCompany, Authorization } from "../types";
import { fmtDateTime } from "../types";
import EstadoErp from "../components/EstadoErp";

export default function Empresas() {
  const { user } = useConnectAuth();
  const canEdit = hasRole(user, "cc_admin");
  const navigate = useNavigate();
  const [rows, setRows] = useState<ProviderCompany[]>([]);
  const [auths, setAuths] = useState<Authorization[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ name: "", contactEmail: "", contactPhone: "" });
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    boFetch<{ data: ProviderCompany[] }>("/providers").then((r) => setRows(r.data)).catch((e) => setError(e.message));
    boFetch<{ data: Authorization[] }>("/authorizations").then((r) => setAuths(r.data)).catch(() => {});
  }, []);
  useEffect(load, [load]);

  const crear = async () => {
    if (!form.name.trim()) return;
    setBusy(true);
    try {
      const nueva = await boFetch<{ id: number }>("/providers", { method: "POST", body: form });
      setForm({ name: "", contactEmail: "", contactPhone: "" });
      // Directo a la ficha, para completar datos fiscales y talleres
      navigate(`/connect/empresas/${nueva.id}`);
    } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  };

  const authFor = (pcId: number) => auths.find((a) => a.providerCompanyId === pcId && !a.branchId);

  return (
    <div>
      <PageTitle
        title="Empresas de asistencia"
        subtitle="Red de empresas proveedoras. Entra en una empresa para gestionar sus talleres, unidades móviles y operarios."
      />
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

      {rows.length === 0 ? (
        <EmptyState message="Sin empresas proveedoras todavía." />
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full">
            <thead><tr className="border-b border-slate-700">
              <Th>Empresa</Th><Th>CIF</Th><Th>Localidad</Th><Th>Contacto</Th><Th>Talleres</Th><Th>ERP</Th><Th>Autorización</Th><Th>Alta</Th><Th></Th>
            </tr></thead>
            <tbody>
              {rows.map((p) => {
                const a = authFor(p.id);
                return (
                  <tr key={p.id} className="border-b border-slate-700/50 hover:bg-slate-700/30">
                    <Td className="font-semibold text-slate-100">
                      <Link className="hover:text-cyan-300" to={`/connect/empresas/${p.id}`}>{p.name}</Link>
                      {p.status !== "active" && (
                        <Badge className="ml-2 border-red-500/40 bg-red-500/10 text-red-300">Suspendida</Badge>
                      )}
                    </Td>
                    <Td>{(p as any).taxId ?? "—"}</Td>
                    <Td>{[(p as any).city, (p as any).province].filter(Boolean).join(", ") || "—"}</Td>
                    <Td>
                      {p.contactPhone
                        ? <a className="text-cyan-300 hover:underline" href={`tel:${p.contactPhone}`}>{p.contactPhone}</a>
                        : (p.contactEmail ?? "-")}
                    </Td>
                    <Td>{p.workshops}</Td>
                    <Td><EstadoErp datos={p as any} /></Td>
                    <Td>
                      {a ? (
                        <Badge className={a.status === "active" ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300" : "border-slate-600 text-slate-400"}>
                          {a.status === "active" ? (a.preferred ? "Autorizada · preferente" : "Autorizada") : a.status}
                        </Badge>
                      ) : (
                        <Badge className="border-amber-500/40 bg-amber-500/10 text-amber-300">Sin autorización</Badge>
                      )}
                    </Td>
                    <Td className="whitespace-nowrap text-[12px] text-slate-500">{fmtDateTime(p.createdAtMs)}</Td>
                    <Td>
                      <Link
                        className="rounded-lg border border-slate-600 px-3 py-1.5 text-[12px] text-slate-300 hover:bg-slate-700"
                        to={`/connect/empresas/${p.id}`}
                      >
                        Abrir ficha →
                      </Link>
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
