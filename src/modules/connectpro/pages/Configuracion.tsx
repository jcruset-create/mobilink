/** Connect Pro — Configuración: catálogos editables (crear, renombrar, activar/desactivar, eliminar). */

import { useCallback, useEffect, useState } from "react";
import { boFetch } from "../services/api";
import { useConnectAuth, hasRole } from "../contexts/ConnectAuthContext";
import { PageTitle, Card, Th, Td, Badge, Input, Button, ErrorBanner } from "../components/ui";
import type { ServiceType, RejectionReason, VehicleType } from "../types";

type CatalogKind = "service-types" | "rejection-reasons" | "vehicle-types";

function EstadoBadge({ active }: { active: boolean }) {
  return (
    <Badge className={active ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300" : "border-slate-600 text-slate-500"}>
      {active ? "Activo" : "Inactivo"}
    </Badge>
  );
}

export default function Configuracion() {
  const { user } = useConnectAuth();
  const canEdit = hasRole(user, "cc_admin");
  const [types, setTypes] = useState<ServiceType[]>([]);
  const [reasons, setReasons] = useState<RejectionReason[]>([]);
  const [vehicles, setVehicles] = useState<VehicleType[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [newType, setNewType] = useState({ code: "", name: "" });
  const [newReason, setNewReason] = useState({ code: "", label: "" });
  const [newVehicle, setNewVehicle] = useState({ code: "", name: "" });
  // Edición en línea: clave "st-<id>" o "rr-<id>" → texto en curso
  const [editKey, setEditKey] = useState<string | null>(null);
  const [editText, setEditText] = useState("");

  const load = useCallback(() => {
    boFetch<{ service_types: ServiceType[]; rejection_reasons: RejectionReason[]; vehicle_types?: VehicleType[] }>("/catalogs")
      .then((r) => { setTypes(r.service_types); setReasons(r.rejection_reasons); setVehicles(r.vehicle_types ?? []); })
      .catch((e) => setError(e.message));
  }, []);
  useEffect(load, [load]);

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true); setError(null);
    try { await fn(); setEditKey(null); load(); }
    catch (e: any) { setError(e.message); } finally { setBusy(false); }
  };

  const eliminar = (kind: CatalogKind, id: number, label: string) => {
    if (!window.confirm(`¿Eliminar "${label}" definitivamente?\n(Si ya se usó en el histórico, el sistema lo impedirá y bastará con desactivarlo.)`)) return;
    act(() => boFetch(`/catalogs/${kind}/${id}`, { method: "DELETE" }));
  };

  const guardarNombre = (kind: CatalogKind, id: number) => {
    if (!editText.trim()) return;
    const body = kind === "service-types" ? { name: editText.trim() } : { label: editText.trim() };
    act(() => boFetch(`/catalogs/${kind}/${id}`, { method: "PATCH", body }));
  };

  const NameCell = ({ kind, id, value }: { kind: CatalogKind; id: number; value: string }) => {
    const key = `${kind}-${id}`;
    if (editKey === key) {
      return (
        <div className="flex items-center gap-1">
          <Input value={editText} onChange={(e) => setEditText(e.target.value)} autoFocus
            onKeyDown={(e) => { if (e.key === "Enter") guardarNombre(kind, id); if (e.key === "Escape") setEditKey(null); }}
            className="w-48" />
          <Button disabled={busy || !editText.trim()} onClick={() => guardarNombre(kind, id)}>OK</Button>
          <Button variant="ghost" onClick={() => setEditKey(null)}>✕</Button>
        </div>
      );
    }
    return (
      <span className="text-slate-100">
        {value}
        {canEdit && (
          <button className="ml-2 text-slate-500 hover:text-cyan-300" title="Editar nombre"
            onClick={() => { setEditKey(key); setEditText(value); }}>✎</button>
        )}
      </span>
    );
  };

  return (
    <div>
      <PageTitle title="Configuración" subtitle="Catálogos del centro de control. Los elementos usados en el histórico no se pueden eliminar, solo desactivar." />
      {error && <ErrorBanner message={error} onClose={() => setError(null)} />}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="overflow-x-auto">
          <h2 className="border-b border-slate-700 px-4 py-3 text-sm font-semibold text-slate-300">Tipos de vehículo / activo</h2>
          {canEdit && (
            <div className="flex gap-2 border-b border-slate-700/50 p-3">
              <Input placeholder="código" value={newVehicle.code} onChange={(e) => setNewVehicle({ ...newVehicle, code: e.target.value })} className="w-32" />
              <Input placeholder="Nombre" value={newVehicle.name} onChange={(e) => setNewVehicle({ ...newVehicle, name: e.target.value })} />
              <Button disabled={busy || !newVehicle.code.trim() || !newVehicle.name.trim()}
                onClick={() => act(async () => { await boFetch("/catalogs/vehicle-types", { method: "POST", body: newVehicle }); setNewVehicle({ code: "", name: "" }); })}>
                Añadir
              </Button>
            </div>
          )}
          <table className="w-full">
            <thead><tr className="border-b border-slate-700"><Th>Código</Th><Th>Nombre</Th><Th>Estado</Th>{canEdit && <Th></Th>}</tr></thead>
            <tbody>
              {vehicles.map((v) => (
                <tr key={v.id} className="border-b border-slate-700/50">
                  <Td className="font-mono text-[12px]">{v.code}</Td>
                  <Td><NameCell kind="vehicle-types" id={v.id} value={v.name} /></Td>
                  <Td><EstadoBadge active={v.active} /></Td>
                  {canEdit && (
                    <Td>
                      <div className="flex gap-1">
                        <Button variant="ghost" disabled={busy}
                          onClick={() => act(() => boFetch(`/catalogs/vehicle-types/${v.id}`, { method: "PATCH", body: { active: !v.active } }))}>
                          {v.active ? "Desactivar" : "Activar"}
                        </Button>
                        <Button variant="danger" disabled={busy} onClick={() => eliminar("vehicle-types", v.id, v.name)}>Eliminar</Button>
                      </div>
                    </Td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </Card>

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
                  <Td><NameCell kind="service-types" id={t.id} value={t.name} /></Td>
                  <Td><EstadoBadge active={t.active} /></Td>
                  {canEdit && (
                    <Td>
                      <div className="flex gap-1">
                        <Button variant="ghost" disabled={busy}
                          onClick={() => act(() => boFetch(`/catalogs/service-types/${t.id}`, { method: "PATCH", body: { active: !t.active } }))}>
                          {t.active ? "Desactivar" : "Activar"}
                        </Button>
                        <Button variant="danger" disabled={busy} onClick={() => eliminar("service-types", t.id, t.name)}>Eliminar</Button>
                      </div>
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
                  <Td><NameCell kind="rejection-reasons" id={r.id} value={r.label} /></Td>
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
                  <Td><EstadoBadge active={r.active} /></Td>
                  {canEdit && (
                    <Td>
                      <div className="flex gap-1">
                        <Button variant="ghost" disabled={busy}
                          onClick={() => act(() => boFetch(`/catalogs/rejection-reasons/${r.id}`, { method: "PATCH", body: { active: !r.active } }))}>
                          {r.active ? "Desactivar" : "Activar"}
                        </Button>
                        <Button variant="danger" disabled={busy} onClick={() => eliminar("rejection-reasons", r.id, r.label)}>Eliminar</Button>
                      </div>
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
