/**
 * Connect Pro — contratos: qué cliente se factura con qué tarifario y qué
 * empresa proveedora cobra con cuál.
 *
 * Es el eslabón que más se olvida al configurar todo esto. Se monta el
 * tarifario, se ponen los precios, se publica… y no pasa nada, porque nadie ha
 * dicho qué cliente usa cuál. El motor no falla: devuelve "sin tarifa de
 * venta" y la asistencia se queda sin precio.
 *
 * Los dos lados están separados en la pantalla a propósito. No son dos vistas
 * del mismo papel: el de venta dice lo que la central cobra a su cliente y el
 * de compra lo que el taller le cobra a ella, y pueden apuntar a tarifarios
 * distintos con importes distintos.
 */

import { useCallback, useEffect, useState } from "react";
import { boFetch } from "../services/api";
import { Card, Th, Td, Badge, Input, Select, Button, ErrorBanner, EmptyState } from "./ui";

type Contrato = {
  id: number; role: "sale" | "purchase"; name: string; status: string;
  validFromMs: number; validToMs: number | null; priority: number;
  clientId: number | null; clientName: string | null;
  providerCompanyId: number | null; providerName: string | null;
  workshopId: number | null; workshopName: string | null;
  tariffPlanId: number; tariffPlanName: string; versionesPublicadas: number;
};

type Plan = { id: number; name: string };
type Cliente = { id: number; name: string };
type Empresa = { id: number; name: string };

const ESTADOS: Record<string, { texto: string; clase: string }> = {
  draft: { texto: "Borrador", clase: "border-amber-500/40 text-amber-300" },
  active: { texto: "Activo", clase: "border-emerald-500/40 text-emerald-300" },
  ended: { texto: "Terminado", clase: "border-slate-600 text-slate-500" },
};

const fecha = (ms: number | null) => (ms == null ? "—" : new Date(ms).toLocaleDateString("es-ES"));
const hoy = () => new Date().toISOString().slice(0, 10);

export default function Contratos({ planes, centro }: { planes: Plan[]; centro: number | null }) {
  const [contratos, setContratos] = useState<Contrato[]>([]);
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [empresas, setEmpresas] = useState<Empresa[]>([]);
  const [editando, setEditando] = useState<Partial<Contrato> & { desde?: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const cargar = useCallback(() => {
    if (centro == null) { setContratos([]); return; }
    boFetch<{ data: Contrato[] }>("/contracts", { centro })
      .then((r) => setContratos(r.data)).catch((e) => setError(e.message));
  }, [centro]);
  useEffect(cargar, [cargar]);

  useEffect(() => {
    boFetch<{ data: Cliente[] }>("/clients").then((r) => setClientes(r.data)).catch(() => {});
    boFetch<{ data: Empresa[] }>("/providers").then((r) => setEmpresas(r.data)).catch(() => {});
  }, []);

  const guardar = async () => {
    if (!editando) return;
    setBusy(true); setError(null);
    try {
      await boFetch("/contracts", {
        method: "PUT", centro,
        body: {
          ...editando,
          validFromMs: new Date(`${editando.desde ?? hoy()}T00:00:00`).getTime(),
        },
      });
      setEditando(null);
      cargar();
    } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  };

  const terminar = async (c: Contrato) => {
    if (!window.confirm(
      `Terminar el contrato "${c.name}".\n\n` +
      `No se borra: las asistencias que se tarificaron con él tienen que poder seguir ` +
      `explicándose.\n\n¿Seguro?`)) return;
    try {
      await boFetch(`/contracts/${c.id}`, { method: "DELETE", centro });
      cargar();
    } catch (e: any) { setError(e.message); }
  };

  const nuevo = (role: "sale" | "purchase") => setEditando({
    role, name: role === "sale" ? "Contrato de venta" : "Contrato de compra",
    status: "active", desde: hoy(), priority: 0,
    tariffPlanId: planes[0]?.id,
  });

  const porLado = (role: "sale" | "purchase") => contratos.filter((c) => c.role === role);

  return (
    <div className="flex flex-col gap-4">
      {error && <ErrorBanner message={error} onClose={() => setError(null)} />}

      <p className="text-[12px] text-slate-500">
        Sin contrato, el motor no sabe qué tarifario aplicarle a un cliente y la
        asistencia se queda sin precio. El de venta es lo que la central cobra;
        el de compra, lo que el taller le cobra a ella.
      </p>

      {editando && (
        <Card className="p-4">
          <p className="mb-3 text-[13px] font-medium text-slate-200">
            {editando.id ? "Editar contrato" : editando.role === "sale"
              ? "Contrato de venta (a un cliente)" : "Contrato de compra (a una empresa proveedora)"}
          </p>

          <div className="grid gap-3 sm:grid-cols-3">
            {editando.role === "sale" ? (
              <label className="block">
                <span className="mb-1 block text-xs text-slate-500">Cliente al que se factura</span>
                <Select value={editando.clientId ?? ""}
                        onChange={(e) => setEditando({ ...editando, clientId: Number(e.target.value) })}>
                  <option value="">Elegir…</option>
                  {clientes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </Select>
              </label>
            ) : (
              <label className="block">
                <span className="mb-1 block text-xs text-slate-500">Empresa proveedora que factura</span>
                <Select value={editando.providerCompanyId ?? ""}
                        onChange={(e) => setEditando({ ...editando, providerCompanyId: Number(e.target.value) })}>
                  <option value="">Elegir…</option>
                  {empresas.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </Select>
              </label>
            )}

            <label className="block">
              <span className="mb-1 block text-xs text-slate-500">Tarifario que se le aplica</span>
              <Select value={editando.tariffPlanId ?? ""}
                      onChange={(e) => setEditando({ ...editando, tariffPlanId: Number(e.target.value) })}>
                <option value="">Elegir…</option>
                {planes.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </Select>
            </label>

            <label className="block">
              <span className="mb-1 block text-xs text-slate-500">Nombre del contrato</span>
              <Input value={editando.name ?? ""}
                     onChange={(e) => setEditando({ ...editando, name: e.target.value })} />
            </label>

            <label className="block">
              <span className="mb-1 block text-xs text-slate-500">En vigor desde</span>
              <Input type="date" value={editando.desde ?? hoy()}
                     onChange={(e) => setEditando({ ...editando, desde: e.target.value })} />
            </label>

            <label className="block">
              <span className="mb-1 block text-xs text-slate-500">Estado</span>
              <Select value={editando.status ?? "active"}
                      onChange={(e) => setEditando({ ...editando, status: e.target.value })}>
                <option value="draft">Borrador (no se aplica todavía)</option>
                <option value="active">Activo</option>
              </Select>
            </label>
          </div>

          <div className="mt-4 flex gap-2">
            <Button onClick={guardar} disabled={busy || !editando.tariffPlanId}>Guardar</Button>
            <Button variant="ghost" onClick={() => setEditando(null)} disabled={busy}>Cancelar</Button>
          </div>
        </Card>
      )}

      {([["sale", "Venta — lo que la central cobra a sus clientes"],
         ["purchase", "Compra — lo que los talleres le cobran a la central"]] as const).map(([role, titulo]) => (
        <Card key={role} className="overflow-x-auto">
          <div className="flex items-center gap-2 border-b border-slate-700 px-4 py-3">
            <h3 className="text-sm font-semibold text-slate-300">{titulo}</h3>
            {!editando && (
              <button className="ml-auto text-[12px] text-cyan-300 hover:underline"
                      onClick={() => nuevo(role)}>
                Añadir
              </button>
            )}
          </div>

          {porLado(role).length === 0 ? (
            <div className="p-4">
              <EmptyState message={role === "sale"
                ? "Ningún cliente tiene tarifario asignado: sus asistencias saldrán sin precio de venta."
                : "Ninguna empresa proveedora tiene tarifario: el margen quedará indeterminado."} />
            </div>
          ) : (
            <table className="w-full text-[13px]">
              <thead><tr className="border-b border-slate-700">
                <Th>{role === "sale" ? "Cliente" : "Empresa"}</Th>
                <Th>Tarifario</Th><Th>Desde</Th><Th>Estado</Th><Th></Th>
              </tr></thead>
              <tbody>
                {porLado(role).map((c) => (
                  <tr key={c.id} className="border-b border-slate-700/50">
                    <Td className="font-semibold text-slate-100">
                      {c.clientName ?? c.providerName ?? "—"}
                      {c.workshopName && <div className="text-[11px] text-slate-500">Solo {c.workshopName}</div>}
                    </Td>
                    <Td>
                      {c.tariffPlanName}
                      {c.versionesPublicadas === 0 && (
                        <div className="text-[11px] text-amber-300">
                          sin ninguna versión publicada: no va a tarificar
                        </div>
                      )}
                    </Td>
                    <Td className="whitespace-nowrap">{fecha(c.validFromMs)}</Td>
                    <Td>
                      <Badge className={ESTADOS[c.status]?.clase ?? ""}>
                        {ESTADOS[c.status]?.texto ?? c.status}
                      </Badge>
                    </Td>
                    <Td>
                      {c.status !== "ended" && (
                        <div className="flex gap-2">
                          <button className="text-[12px] text-cyan-300 hover:underline"
                                  onClick={() => setEditando({
                                    ...c, desde: new Date(c.validFromMs).toISOString().slice(0, 10),
                                  })}>
                            Editar
                          </button>
                          <button className="text-[12px] text-rose-300 hover:underline"
                                  onClick={() => terminar(c)}>Terminar</button>
                        </div>
                      )}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      ))}
    </div>
  );
}
