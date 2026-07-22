/** Connect Pro — Usuarios del centro de control y de empresas proveedoras. */

import { useCallback, useEffect, useState } from "react";
import { boFetch } from "../services/api";
import { PageTitle, Card, Th, Td, Badge, Input, Select, Button, ErrorBanner } from "../components/ui";
import { ROLE_LABELS, fmtDateTime, type ConnectRole, type ProviderCompany } from "../types";

type UserRow = {
  id: number; email: string; name: string; role: ConnectRole;
  providerCompanyId: number | null; active: boolean; createdAtMs: number;
};

const ASSIGNABLE: ConnectRole[] = ["cc_admin", "supervisor", "operator", "analyst", "provider_user"];

export default function Usuarios() {
  const [rows, setRows] = useState<UserRow[]>([]);
  const [providers, setProviders] = useState<ProviderCompany[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ email: "", name: "", role: "operator" as ConnectRole, providerCompanyId: "" });

  const load = useCallback(() => {
    boFetch<{ data: UserRow[] }>("/users").then((r) => setRows(r.data)).catch((e) => setError(e.message));
    boFetch<{ data: ProviderCompany[] }>("/providers").then((r) => setProviders(r.data)).catch(() => {});
  }, []);
  useEffect(load, [load]);

  const crear = async () => {
    if (!form.email.trim()) return;
    setBusy(true);
    try {
      await boFetch("/users", {
        method: "POST",
        body: {
          email: form.email.trim(), name: form.name, role: form.role,
          providerCompanyId: form.role === "provider_user" && form.providerCompanyId ? Number(form.providerCompanyId) : null,
        },
      });
      setForm({ email: "", name: "", role: "operator", providerCompanyId: "" });
      load();
    } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  };

  const toggle = async (u: UserRow) => {
    setBusy(true);
    try {
      await boFetch(`/users/${u.id}`, { method: "PATCH", body: { active: !u.active } });
      load();
    } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  };

  return (
    <div>
      <PageTitle title="Usuarios" subtitle="El email debe coincidir con el usuario del hub de Mobilink (sesión unificada)." />
      {error && <ErrorBanner message={error} onClose={() => setError(null)} />}

      <Card className="mb-4 p-4">
        <h2 className="mb-3 text-sm font-semibold text-slate-300">Nuevo usuario</h2>
        <div className="flex flex-wrap gap-2">
          <Input placeholder="email@empresa.com" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="w-64" />
          <Input placeholder="Nombre" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <Select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as ConnectRole })}>
            {ASSIGNABLE.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
          </Select>
          {form.role === "provider_user" && (
            <Select value={form.providerCompanyId} onChange={(e) => setForm({ ...form, providerCompanyId: e.target.value })}>
              <option value="">— Empresa —</option>
              {providers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </Select>
          )}
          <Button onClick={crear} disabled={busy || !form.email.trim()}>Crear usuario</Button>
        </div>
      </Card>

      <Card className="overflow-x-auto">
        <table className="w-full">
          <thead><tr className="border-b border-slate-700">
            <Th>Email</Th><Th>Nombre</Th><Th>Rol</Th><Th>Estado</Th><Th>Alta</Th><Th></Th>
          </tr></thead>
          <tbody>
            {rows.map((u) => (
              <tr key={u.id} className="border-b border-slate-700/50 hover:bg-slate-700/30">
                <Td className="font-semibold text-slate-100">{u.email}</Td>
                <Td>{u.name || "-"}</Td>
                <Td><Badge className="border-sky-500/40 bg-sky-500/10 text-sky-300">{ROLE_LABELS[u.role]}</Badge></Td>
                <Td>
                  <Badge className={u.active ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300" : "border-red-500/40 bg-red-500/10 text-red-300"}>
                    {u.active ? "Activo" : "Desactivado"}
                  </Badge>
                </Td>
                <Td>{fmtDateTime(u.createdAtMs)}</Td>
                <Td>
                  {u.role !== "superadmin" && (
                    <Button variant="ghost" onClick={() => toggle(u)} disabled={busy}>
                      {u.active ? "Desactivar" : "Activar"}
                    </Button>
                  )}
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
