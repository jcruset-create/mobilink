/** Connect Pro — Talleres de la red (FULL / LITE / EXTERNAL). */

import { Fragment, useCallback, useEffect, useState } from "react";
import { boFetch } from "../services/api";
import { useConnectAuth, hasRole } from "../contexts/ConnectAuthContext";
import { PageTitle, Card, Th, Td, Badge, Input, Select, Button, ErrorBanner, EmptyState } from "../components/ui";
import {
  WORKSHOP_TIER, WORKSHOP_TIER_LABELS, WORKSHOP_TIER_STYLES, fmtDateTime,
  type ProviderCompany, type WorkshopIntegrationType,
} from "../types";

type Workshop = {
  id: number; name: string; phone: string | null; latitude: number; longitude: number;
  radiusKm: number; connectStatus: string; currentScore: number;
  providerName: string | null; branchName: string | null; providerCompanyId: number | null;
  networkParticipation: boolean; integrationType: WorkshopIntegrationType;
  networkChangedBy: string | null; liteCode: string | null;
};

type LiteUser = {
  id: number; name: string; username: string; email: string | null; phone: string | null;
  role: "workshop_admin" | "operator"; active: boolean; lastLoginAtMs: number | null; devices: number;
};

type LiteDevice = {
  id: number; deviceId: string; platform: string | null; osVersion: string | null; appVersion: string | null;
  gpsPermission: string | null; notifPermission: string | null; pushEnabled: boolean;
  lastSeenAtMs: number | null; revokedAtMs: number | null; userName: string;
};

const TIERS: WorkshopIntegrationType[] = ["assist", "lite", "external"];

/** Panel de gestión del taller Lite: operarios, dispositivos y código de acceso. */
export function LitePanel({ workshop, canEdit, onError }: {
  workshop: Workshop; canEdit: boolean; onError: (m: string) => void;
}) {
  const [users, setUsers] = useState<LiteUser[]>([]);
  const [devices, setDevices] = useState<LiteDevice[]>([]);
  const [busy, setBusy] = useState(false);
  const [nuevo, setNuevo] = useState({ name: "", username: "", pin: "", role: "operator" });

  const load = useCallback(() => {
    boFetch<{ data: LiteUser[] }>(`/workshops/${workshop.id}/lite-users`).then((r) => setUsers(r.data)).catch((e) => onError(e.message));
    boFetch<{ data: LiteDevice[] }>(`/workshops/${workshop.id}/lite-devices`).then((r) => setDevices(r.data)).catch(() => {});
  }, [workshop.id, onError]);
  useEffect(load, [load]);

  const crearUsuario = async () => {
    if (!nuevo.name.trim() || !nuevo.username.trim() || !/^\d{4,8}$/.test(nuevo.pin)) {
      onError("Nombre, usuario y un PIN de 4 a 8 dígitos son obligatorios.");
      return;
    }
    setBusy(true);
    try {
      await boFetch(`/workshops/${workshop.id}/lite-users`, { method: "POST", body: nuevo });
      setNuevo({ name: "", username: "", pin: "", role: "operator" });
      load();
    } catch (e: any) { onError(e.message); } finally { setBusy(false); }
  };

  const patchUser = async (id: number, body: Record<string, unknown>) => {
    setBusy(true);
    try { await boFetch(`/lite-users/${id}`, { method: "PATCH", body }); load(); }
    catch (e: any) { onError(e.message); } finally { setBusy(false); }
  };

  return (
    <Card className="mt-2 border-violet-500/30 p-4">
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <h3 className="text-sm font-semibold text-violet-300">Mobilink Assist Lite · {workshop.name}</h3>
        <span className="rounded-lg border border-slate-600 bg-slate-900 px-2 py-1 font-mono text-[13px] text-slate-100">
          Código de taller: {workshop.liteCode ?? "—"}
        </span>
        <span className="text-[12px] text-slate-400">
          El operario introduce este código, su usuario y su PIN en la app.
        </span>
      </div>

      {canEdit && (
        <div className="mb-3 flex flex-wrap gap-2">
          <Input placeholder="Nombre y apellidos" value={nuevo.name} onChange={(e) => setNuevo({ ...nuevo, name: e.target.value })} className="w-48" />
          <Input placeholder="Usuario" value={nuevo.username} onChange={(e) => setNuevo({ ...nuevo, username: e.target.value })} className="w-36" />
          <Input placeholder="PIN (4-8 dígitos)" value={nuevo.pin} onChange={(e) => setNuevo({ ...nuevo, pin: e.target.value })} className="w-36" />
          <Select value={nuevo.role} onChange={(e) => setNuevo({ ...nuevo, role: e.target.value })}>
            <option value="operator">Operario</option>
            <option value="workshop_admin">Administrador del taller</option>
          </Select>
          <Button onClick={crearUsuario} disabled={busy}>Añadir usuario</Button>
        </div>
      )}

      {users.length === 0 ? (
        <EmptyState message="El taller aún no tiene usuarios de la app." />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead><tr className="border-b border-slate-700">
              <Th>Usuario</Th><Th>Acceso</Th><Th>Rol</Th><Th>Último acceso</Th><Th>Dispositivos</Th><Th>Estado</Th>{canEdit && <Th>Acciones</Th>}
            </tr></thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className="border-b border-slate-700/50">
                  <Td className="font-semibold text-slate-100">{u.name}</Td>
                  <Td className="font-mono">{u.username}</Td>
                  <Td>{u.role === "workshop_admin" ? "Administrador" : "Operario"}</Td>
                  <Td>{fmtDateTime(u.lastLoginAtMs)}</Td>
                  <Td>{u.devices}</Td>
                  <Td>
                    <Badge className={u.active ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300" : "border-red-500/40 bg-red-500/10 text-red-300"}>
                      {u.active ? "Activo" : "Bloqueado"}
                    </Badge>
                  </Td>
                  {canEdit && (
                    <Td>
                      <div className="flex gap-2">
                        <button
                          className="rounded-lg border border-slate-600 px-2 py-1 text-[12px] text-slate-300 hover:bg-slate-700"
                          disabled={busy}
                          onClick={() => {
                            const pin = window.prompt(`Nuevo PIN para ${u.name} (4-8 dígitos)`);
                            if (pin) patchUser(u.id, { pin });
                          }}
                        >
                          Cambiar PIN
                        </button>
                        <button
                          className="rounded-lg border border-slate-600 px-2 py-1 text-[12px] text-slate-300 hover:bg-slate-700"
                          disabled={busy}
                          onClick={() => patchUser(u.id, { active: !u.active })}
                        >
                          {u.active ? "Bloquear" : "Activar"}
                        </button>
                      </div>
                    </Td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h4 className="mb-2 mt-4 text-[13px] font-semibold text-slate-300">Dispositivos</h4>
      {devices.length === 0 ? (
        <p className="text-[13px] text-slate-400">Ningún dispositivo ha iniciado sesión todavía.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead><tr className="border-b border-slate-700">
              <Th>Operario</Th><Th>Plataforma</Th><Th>Versión</Th><Th>GPS</Th><Th>Avisos</Th><Th>Última actividad</Th>{canEdit && <Th></Th>}
            </tr></thead>
            <tbody>
              {devices.map((d) => (
                <tr key={d.id} className="border-b border-slate-700/50">
                  <Td>{d.userName}</Td>
                  <Td>{d.platform ?? "-"} {d.osVersion ?? ""}</Td>
                  <Td>{d.appVersion ?? "-"}</Td>
                  <Td>{d.gpsPermission ?? "?"}</Td>
                  <Td>{d.pushEnabled ? "Sí" : "No"}</Td>
                  <Td>{d.revokedAtMs ? "Sesión revocada" : fmtDateTime(d.lastSeenAtMs)}</Td>
                  {canEdit && (
                    <Td>
                      {!d.revokedAtMs && (
                        <button
                          className="rounded-lg border border-slate-600 px-2 py-1 text-[12px] text-slate-300 hover:bg-slate-700"
                          disabled={busy}
                          onClick={async () => {
                            setBusy(true);
                            try { await boFetch(`/lite-devices/${d.id}/revoke`, { method: "POST" }); load(); }
                            catch (e: any) { onError(e.message); } finally { setBusy(false); }
                          }}
                        >
                          Revocar sesión
                        </button>
                      )}
                    </Td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

export default function Talleres() {
  const { user } = useConnectAuth();
  const canEdit = hasRole(user, "cc_admin");
  const [rows, setRows] = useState<Workshop[]>([]);
  const [providers, setProviders] = useState<ProviderCompany[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [openLite, setOpenLite] = useState<number | null>(null);
  const [form, setForm] = useState({ name: "", providerCompanyId: "", latitude: "", longitude: "", radiusKm: "60", phone: "", integrationType: "assist" });

  const load = useCallback(() => {
    boFetch<{ data: Workshop[] }>("/workshops").then((r) => setRows(r.data)).catch((e) => setError(e.message));
    boFetch<{ data: ProviderCompany[] }>("/providers").then((r) => setProviders(r.data)).catch(() => {});
  }, []);
  useEffect(load, [load]);

  const crear = async () => {
    const lat = Number(form.latitude); const lng = Number(form.longitude);
    if (!form.name.trim() || Number.isNaN(lat) || Number.isNaN(lng)) {
      setError("Nombre, latitud y longitud son obligatorios (punto decimal).");
      return;
    }
    setBusy(true);
    try {
      await boFetch("/workshops", {
        method: "POST",
        body: {
          name: form.name.trim(), latitude: lat, longitude: lng,
          radiusKm: Number(form.radiusKm) || 60, phone: form.phone || null,
          providerCompanyId: form.providerCompanyId ? Number(form.providerCompanyId) : null,
          integrationType: form.integrationType,
        },
      });
      setForm({ name: "", providerCompanyId: "", latitude: "", longitude: "", radiusKm: "60", phone: "", integrationType: "assist" });
      load();
    } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  };

  const cambiarTipo = async (w: Workshop, integrationType: WorkshopIntegrationType) => {
    setBusy(true);
    try {
      await boFetch(`/workshops/${w.id}`, { method: "PATCH", body: { integrationType } });
      load();
    } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  };

  return (
    <div>
      <PageTitle
        title="Talleres"
        subtitle="Talleres de la red con cobertura, producto contratado y capacidades para recibir asistencias."
      />
      {error && <ErrorBanner message={error} onClose={() => setError(null)} />}

      {canEdit && (
        <Card className="mb-4 p-4">
          <h2 className="mb-3 text-sm font-semibold text-slate-300">Añadir taller</h2>
          <div className="flex flex-wrap gap-2">
            <Input placeholder="Nombre del taller" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <Select value={form.providerCompanyId} onChange={(e) => setForm({ ...form, providerCompanyId: e.target.value })}>
              <option value="">— Empresa —</option>
              {providers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </Select>
            <Input placeholder="Latitud" value={form.latitude} onChange={(e) => setForm({ ...form, latitude: e.target.value })} className="w-28" />
            <Input placeholder="Longitud" value={form.longitude} onChange={(e) => setForm({ ...form, longitude: e.target.value })} className="w-28" />
            <Input placeholder="Radio km" value={form.radiusKm} onChange={(e) => setForm({ ...form, radiusKm: e.target.value })} className="w-24" />
            <Input placeholder="Teléfono" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className="w-36" />
            <Select value={form.integrationType} onChange={(e) => setForm({ ...form, integrationType: e.target.value })}>
              {TIERS.map((t) => <option key={t} value={t}>{WORKSHOP_TIER_LABELS[t]}</option>)}
            </Select>
            <Button onClick={crear} disabled={busy}>Añadir</Button>
          </div>
        </Card>
      )}

      {rows.length === 0 ? (
        <EmptyState message="Sin talleres en la red todavía." />
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full">
            <thead><tr className="border-b border-slate-700">
              <Th>Taller</Th><Th>Empresa</Th><Th>Producto</Th><Th>Red Mobilink</Th><Th>Teléfono</Th><Th>Radio</Th><Th>Estado</Th><Th>Score</Th>
            </tr></thead>
            <tbody>
              {rows.map((w) => (
                <Fragment key={w.id}>
                  <tr className="border-b border-slate-700/50 hover:bg-slate-700/30">
                    <Td className="font-semibold text-slate-100">
                      {w.name}
                      {w.integrationType === "lite" && (
                        <button
                          className="ml-2 rounded-lg border border-violet-500/40 px-2 py-0.5 text-[11px] text-violet-300 hover:bg-violet-500/10"
                          onClick={() => setOpenLite(openLite === w.id ? null : w.id)}
                        >
                          {openLite === w.id ? "Ocultar Lite" : "Gestionar Lite"}
                        </button>
                      )}
                    </Td>
                    <Td>{w.providerName ?? "-"}{w.branchName ? ` · ${w.branchName}` : ""}</Td>
                    <Td>
                      {canEdit ? (
                        <Select
                          value={w.integrationType}
                          disabled={busy}
                          onChange={(e) => cambiarTipo(w, e.target.value as WorkshopIntegrationType)}
                          className="w-40"
                        >
                          {TIERS.map((t) => <option key={t} value={t}>{WORKSHOP_TIER_LABELS[t]}</option>)}
                        </Select>
                      ) : (
                        <Badge className={WORKSHOP_TIER_STYLES[w.integrationType]}>
                          {WORKSHOP_TIER[w.integrationType]} · {WORKSHOP_TIER_LABELS[w.integrationType]}
                        </Badge>
                      )}
                    </Td>
                    <Td>
                      {canEdit ? (
                        <button
                          disabled={busy}
                          title={w.networkChangedBy ? `Último cambio: ${w.networkChangedBy}` : undefined}
                          onClick={async () => {
                            setBusy(true);
                            try { await boFetch(`/workshops/${w.id}`, { method: "PATCH", body: { networkParticipation: !w.networkParticipation } }); load(); }
                            catch (e: any) { setError(e.message); } finally { setBusy(false); }
                          }}
                          className={`rounded-full border px-2 py-0.5 text-[11px] ${w.networkParticipation ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300" : "border-red-500/40 bg-red-500/10 text-red-300"}`}
                        >
                          {w.networkParticipation ? "Adherido ✓" : "No adherido"}
                        </button>
                      ) : (
                        <Badge className={w.networkParticipation ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300" : "border-red-500/40 bg-red-500/10 text-red-300"}>
                          {w.networkParticipation ? "Adherido" : "No adherido"}
                        </Badge>
                      )}
                    </Td>
                    <Td>{w.phone ?? "-"}</Td>
                    <Td>{w.radiusKm} km</Td>
                    <Td>
                      <Badge className={w.connectStatus === "active" ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300" : "border-slate-600 text-slate-400"}>
                        {w.connectStatus === "active" ? "Activo" : w.connectStatus}
                      </Badge>
                    </Td>
                    <Td>{Math.round(w.currentScore)}/100</Td>
                  </tr>
                  {openLite === w.id && (
                    <tr>
                      <td colSpan={8} className="bg-slate-900/40 p-2">
                        <LitePanel workshop={w} canEdit={canEdit} onError={setError} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
