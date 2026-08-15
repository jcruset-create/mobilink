/**
 * Connect Pro — administración de tarifarios.
 *
 * Es la pantalla que faltaba: hasta ahora un tarifario solo se cambiaba
 * editando un fichero de datos y ejecutando un script.
 *
 * La pantalla está construida alrededor de una idea, y conviene que se note al
 * usarla: **una versión publicada no se toca**. Cuando estás sobre una versión
 * publicada, los campos no se editan y el único botón que hay es "Duplicar".
 * Editar un precio es duplicar la versión, cambiar la copia y publicarla con su
 * fecha de entrada en vigor. Las dos quedan: la vieja sigue explicando las
 * facturas viejas.
 */

import { useCallback, useEffect, useState } from "react";
import { boFetch } from "../services/api";
import { PageTitle, Card, Th, Td, Badge, Input, Select, Button, ErrorBanner, EmptyState } from "../components/ui";
import Contratos from "../components/Contratos";
import CatalogoNeumaticos from "../components/CatalogoNeumaticos";


type Plan = {
  id: number; code: string; name: string; description: string | null;
  currency: string; timezone: string; calendarName: string | null;
  versiones: number; publicadas: number; contratos: number;
};

type Version = {
  id: number; version: string; status: "draft" | "published" | "archived";
  validFromMs: number; validToMs: number | null; publishedAtMs: number | null;
  notes: string | null; reglas: number; extras: number; neumaticos: number;
};

type Regla = {
  id: number; code: string; name: string;
  serviceTypeCode: string | null; vehicleTypeCode: string | null;
  zoneCode: string | null; timeBandCode: string | null; dayClasses: string[] | null;
  maxDistanceKm: string | null; maxDurationMin: number | null;
  amount: string; includedDistanceKm: string | null; includedDurationMin: number | null;
  extraKmCode: string | null; extraTimeCode: string | null;
  extraTriggerType: string; extraThresholdPercent: string | null;
  priority: number; active: boolean;
};

type Extra = {
  id: number; code: string; name: string; calculationType: string;
  amount: string | null; percentage: string | null; unit: string | null;
  appliesTo: string; lineKind: string | null; active: boolean;
};

type Franja = {
  id: number; code: string; name: string; desde: string; hasta: string;
  weekdays: number[]; weekdayAnchor: string; active: boolean; enUsoPublicado: boolean;
};

type Problema = { gravedad: "error" | "aviso"; mensaje: string };

type Detalle = {
  version: Version & { planName: string; planCode: string; currency: string; timezone: string; calendarId: number | null };
  editable: boolean;
  reglas: Regla[];
  extras: Extra[];
  franjas: Franja[];
  zonas: { id: number; code: string; name: string; type: string; miembros: any[] }[];
  calendario: { id: number; date: string; scope: string; dayClass: string; name: string | null; yearly: boolean }[];
  problemas: Problema[];
};

const ESTADOS: Record<string, { texto: string; clase: string }> = {
  draft: { texto: "Borrador", clase: "border-amber-500/40 text-amber-300" },
  published: { texto: "Publicada", clase: "border-emerald-500/40 text-emerald-300" },
  archived: { texto: "Archivada", clase: "border-slate-600 text-slate-500" },
};

const DIAS = ["L", "M", "X", "J", "V", "S", "D"];
const SECCIONES = ["Reglas", "Suplementos", "Neumáticos", "Franjas", "Zonas", "Calendario", "Contratos"] as const;

const fecha = (ms: number | null) => (ms == null ? "—" : new Date(ms).toLocaleDateString("es-ES"));
const aMs = (iso: string) => new Date(`${iso}T00:00:00`).getTime();
const hoy = () => new Date().toISOString().slice(0, 10);

export default function Tarifas() {
  const [planes, setPlanes] = useState<Plan[]>([]);
  const [planId, setPlanId] = useState<number | null>(null);
  const [versiones, setVersiones] = useState<Version[]>([]);
  const [versionId, setVersionId] = useState<number | null>(null);
  const [detalle, setDetalle] = useState<Detalle | null>(null);
  const [seccion, setSeccion] = useState<(typeof SECCIONES)[number]>("Reglas");
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    boFetch<{ data: Plan[] }>("/tariffs")
      .then((r) => { setPlanes(r.data); if (r.data[0]) setPlanId(r.data[0].id); })
      .catch((e) => setError(e.message));
  }, []);

  const cargarVersiones = useCallback(() => {
    if (planId == null) return;
    boFetch<{ data: Version[] }>(`/tariffs/${planId}/versions`)
      .then((r) => {
        setVersiones(r.data);
        setVersionId((actual) => (r.data.some((v) => v.id === actual) ? actual : r.data[0]?.id ?? null));
      })
      .catch((e) => setError(e.message));
  }, [planId]);
  useEffect(cargarVersiones, [cargarVersiones]);

  const cargarDetalle = useCallback(() => {
    if (versionId == null) { setDetalle(null); return; }
    boFetch<Detalle>(`/tariffs/versions/${versionId}`).then(setDetalle).catch((e) => setError(e.message));
  }, [versionId]);
  useEffect(cargarDetalle, [cargarDetalle]);

  const refrescar = () => { cargarVersiones(); cargarDetalle(); };

  const duplicar = async () => {
    if (!detalle) return;
    const version = window.prompt(
      "Nombre de la versión nueva (por ejemplo 2027):",
      `${detalle.version.version}-copia`);
    if (!version) return;
    const desde = window.prompt("¿Desde qué fecha entra en vigor? (AAAA-MM-DD)", hoy());
    if (!desde) return;

    setBusy(true); setError(null); setAviso(null);
    try {
      const r = await boFetch<any>(`/tariffs/versions/${detalle.version.id}/duplicate`, {
        method: "POST", body: { version, validFromMs: aMs(desde) },
      });
      setAviso(`Copiada como borrador "${version}": ${r.copiado.reglas} reglas, ` +
        `${r.copiado.extras} suplementos y ${r.copiado.neumaticos} precios de neumático.`);
      setVersionId(r.id);
      cargarVersiones();
    } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  };

  const publicar = async () => {
    if (!detalle) return;
    const errores = detalle.problemas.filter((p) => p.gravedad === "error");
    if (errores.length > 0) {
      setError(`No se puede publicar: ${errores.map((p) => p.mensaje).join("; ")}`);
      return;
    }
    if (!window.confirm(
      `Publicar la versión "${detalle.version.version}".\n\n` +
      `A partir de su fecha de entrada en vigor empieza a facturar, y ya no se podrá modificar.\n\n` +
      `¿Seguro?`)) return;

    setBusy(true); setError(null);
    try {
      await boFetch(`/tariffs/versions/${detalle.version.id}/publish`, { method: "POST", body: {} });
      setAviso("Publicada. A partir de ahora factura.");
      refrescar();
    } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  };

  const plan = planes.find((p) => p.id === planId);

  return (
    <div>
      <PageTitle
        title="Tarifas"
        subtitle="Tarifarios, versiones y reglas. Una versión publicada no se modifica: se duplica, se edita la copia y se publica."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Select value={planId ?? ""} onChange={(e) => setPlanId(Number(e.target.value) || null)}>
              {planes.length === 0 && <option value="">Sin tarifarios</option>}
              {planes.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </Select>
            <Select value={versionId ?? ""} onChange={(e) => setVersionId(Number(e.target.value) || null)}>
              {versiones.length === 0 && <option value="">Sin versiones</option>}
              {versiones.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.version} · {ESTADOS[v.status]?.texto ?? v.status} · desde {fecha(v.validFromMs)}
                </option>
              ))}
            </Select>
          </div>
        }
      />

      {error && <ErrorBanner message={error} onClose={() => setError(null)} />}
      {aviso && <p className="mb-3 text-[13px] text-emerald-300">{aviso}</p>}

      {planes.length === 0 ? (
        <EmptyState message="Este centro de control todavía no tiene ningún tarifario cargado." />
      ) : !detalle ? (
        <p className="text-sm text-slate-500">Cargando…</p>
      ) : (
        <>
          <Card className="mb-4">
            <div className="flex flex-wrap items-center gap-3 border-b border-slate-700 px-4 py-3">
              <span className="text-sm font-semibold text-slate-100">
                {detalle.version.planName} · {detalle.version.version}
              </span>
              <Badge className={ESTADOS[detalle.version.status]?.clase ?? ""}>
                {ESTADOS[detalle.version.status]?.texto ?? detalle.version.status}
              </Badge>
              <span className="text-[12px] text-slate-500">
                Vigente desde {fecha(detalle.version.validFromMs)}
                {detalle.version.validToMs ? ` hasta ${fecha(detalle.version.validToMs)}` : ""}
                {" · "}{detalle.version.currency} · {detalle.version.timezone}
                {plan?.contratos ? ` · ${plan.contratos} contrato(s)` : ""}
              </span>
              <div className="ml-auto flex gap-2">
                <Button variant="ghost" onClick={duplicar} disabled={busy}>Duplicar en un borrador</Button>
                {detalle.editable && (
                  <Button onClick={publicar} disabled={busy}>Publicar</Button>
                )}
              </div>
            </div>

            {!detalle.editable && (
              <p className="px-4 py-2 text-[12px] text-slate-400">
                Esta versión está publicada y no se puede modificar: cambiarla alteraría el
                importe de asistencias ya facturadas con ella. Para cambiar un precio,
                duplícala, edita el borrador y publícalo con su fecha de entrada en vigor.
              </p>
            )}

            {detalle.problemas.length > 0 && (
              <ul className="border-t border-slate-700 px-4 py-2 text-[12px]">
                {detalle.problemas.map((p, i) => (
                  <li key={i} className={p.gravedad === "error" ? "text-rose-300" : "text-amber-300"}>
                    {p.gravedad === "error" ? "✕" : "⚠"} {p.mensaje}
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <div className="mb-4 flex flex-wrap gap-1">
            {SECCIONES.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setSeccion(s)}
                className={`rounded-lg px-3 py-1.5 text-[13px] font-medium ${
                  seccion === s ? "bg-cyan-600/20 text-cyan-300" : "text-slate-400 hover:bg-slate-800"}`}
              >
                {s}
              </button>
            ))}
          </div>

          {seccion === "Reglas" && (
            <Reglas detalle={detalle} onCambio={refrescar} onError={setError} />
          )}
          {seccion === "Suplementos" && (
            <Suplementos detalle={detalle} onCambio={refrescar} onError={setError} />
          )}
          {seccion === "Franjas" && (
            <Franjas detalle={detalle} onCambio={refrescar} onError={setError} />
          )}
          {seccion === "Neumáticos" && (
            <CatalogoNeumaticos versionId={detalle.version.id} editable={detalle.editable} />
          )}
          {seccion === "Contratos" && <Contratos planes={planes} />}
          {seccion === "Zonas" && <Zonas detalle={detalle} />}
          {seccion === "Calendario" && <Calendario detalle={detalle} />}
        </>
      )}
    </div>
  );
}

// ── Reglas ──────────────────────────────────────────────────────────────────

function Reglas({ detalle, onCambio, onError }: {
  detalle: Detalle; onCambio: () => void; onError: (m: string) => void;
}) {
  const [editando, setEditando] = useState<Partial<Regla> | null>(null);
  const [busy, setBusy] = useState(false);

  const guardar = async () => {
    if (!editando) return;
    setBusy(true);
    try {
      await boFetch(`/tariffs/versions/${detalle.version.id}/rules`, {
        method: "PUT",
        body: {
          ...editando,
          timeBandId: detalle.franjas.find((f) => f.code === editando.timeBandCode)?.id ?? null,
          zoneId: detalle.zonas.find((z) => z.code === editando.zoneCode)?.id ?? null,
          extraDistanceExtraId: detalle.extras.find((e) => e.code === editando.extraKmCode)?.id ?? null,
          extraDurationExtraId: detalle.extras.find((e) => e.code === editando.extraTimeCode)?.id ?? null,
        },
      });
      setEditando(null);
      onCambio();
    } catch (e: any) { onError(e.message); } finally { setBusy(false); }
  };

  const borrar = async (r: Regla) => {
    if (!window.confirm(`¿Borrar la regla ${r.code}?`)) return;
    try {
      await boFetch(`/tariffs/versions/${detalle.version.id}/rules/${r.id}`, { method: "DELETE" });
      onCambio();
    } catch (e: any) { onError(e.message); }
  };

  return (
    <div className="flex flex-col gap-3">
      {detalle.editable && !editando && (
        <div>
          <Button onClick={() => setEditando({
            code: "", name: "", amount: "0", priority: 0, active: true,
            extraTriggerType: "THRESHOLD_PERCENT", extraThresholdPercent: "20",
          })}>
            Añadir una regla
          </Button>
        </div>
      )}

      {editando && (
        <Card className="p-4">
          <p className="mb-3 text-[13px] font-medium text-slate-200">
            {editando.id ? `Editar ${editando.code}` : "Regla nueva"}
          </p>
          <div className="grid gap-3 sm:grid-cols-3">
            <Campo label="Código">
              <Input value={editando.code ?? ""} disabled={!!editando.id}
                     onChange={(e) => setEditando({ ...editando, code: e.target.value.toUpperCase() })}
                     placeholder="NOCTURNO" />
            </Campo>
            <Campo label="Nombre">
              <Input value={editando.name ?? ""} onChange={(e) => setEditando({ ...editando, name: e.target.value })} />
            </Campo>
            <Campo label="Importe del forfait">
              <Input value={editando.amount ?? ""} onChange={(e) => setEditando({ ...editando, amount: e.target.value })} />
            </Campo>

            <Campo label="Franja horaria">
              <Select value={editando.timeBandCode ?? ""}
                      onChange={(e) => setEditando({ ...editando, timeBandCode: e.target.value || null })}>
                <option value="">Cualquiera</option>
                {detalle.franjas.map((f) => (
                  <option key={f.id} value={f.code}>{f.name} ({f.desde}–{f.hasta})</option>
                ))}
              </Select>
            </Campo>
            <Campo label="Clases de día (separadas por comas)">
              <Input value={(editando.dayClasses ?? []).join(",")}
                     onChange={(e) => setEditando({
                       ...editando,
                       dayClasses: e.target.value.split(",").map((s) => s.trim()).filter(Boolean),
                     })}
                     placeholder="holiday, saturday, sunday" />
            </Campo>
            <Campo label="Zona">
              <Select value={editando.zoneCode ?? ""}
                      onChange={(e) => setEditando({ ...editando, zoneCode: e.target.value || null })}>
                <option value="">Cualquiera</option>
                {detalle.zonas.map((z) => <option key={z.id} value={z.code}>{z.name}</option>)}
              </Select>
            </Campo>

            <Campo label="Tipo de servicio">
              <Input value={editando.serviceTypeCode ?? ""}
                     onChange={(e) => setEditando({ ...editando, serviceTypeCode: e.target.value || null })}
                     placeholder="tyres (vacío = cualquiera)" />
            </Campo>
            <Campo label="Tipo de vehículo">
              <Input value={editando.vehicleTypeCode ?? ""}
                     onChange={(e) => setEditando({ ...editando, vehicleTypeCode: e.target.value || null })}
                     placeholder="truck (vacío = cualquiera)" />
            </Campo>
            <Campo label="Prioridad (gana la más alta)">
              <Input value={String(editando.priority ?? 0)}
                     onChange={(e) => setEditando({ ...editando, priority: Number(e.target.value) || 0 })} />
            </Campo>

            <Campo label="Km incluidos">
              <Input value={editando.includedDistanceKm ?? ""}
                     onChange={(e) => setEditando({ ...editando, includedDistanceKm: e.target.value })} />
            </Campo>
            <Campo label="Minutos incluidos">
              <Input value={String(editando.includedDurationMin ?? "")}
                     onChange={(e) => setEditando({ ...editando, includedDurationMin: Number(e.target.value) || null })} />
            </Campo>
            <Campo label="Km máximos (para reglas de proximidad)">
              <Input value={editando.maxDistanceKm ?? ""}
                     onChange={(e) => setEditando({ ...editando, maxDistanceKm: e.target.value })} />
            </Campo>

            <Campo label="Suplemento de km">
              <Select value={editando.extraKmCode ?? ""}
                      onChange={(e) => setEditando({ ...editando, extraKmCode: e.target.value || null })}>
                <option value="">Ninguno</option>
                {detalle.extras.map((x) => <option key={x.id} value={x.code}>{x.name}</option>)}
              </Select>
            </Campo>
            <Campo label="Suplemento de tiempo">
              <Select value={editando.extraTimeCode ?? ""}
                      onChange={(e) => setEditando({ ...editando, extraTimeCode: e.target.value || null })}>
                <option value="">Ninguno</option>
                {detalle.extras.map((x) => <option key={x.id} value={x.code}>{x.name}</option>)}
              </Select>
            </Campo>
            <Campo label="Umbral para cobrar el suplemento (%)">
              <Input value={editando.extraThresholdPercent ?? ""}
                     onChange={(e) => setEditando({ ...editando, extraThresholdPercent: e.target.value })}
                     placeholder="20" />
            </Campo>
          </div>

          <div className="mt-4 flex gap-2">
            <Button onClick={guardar} disabled={busy || !editando.code?.trim()}>Guardar</Button>
            <Button variant="ghost" onClick={() => setEditando(null)} disabled={busy}>Cancelar</Button>
          </div>
        </Card>
      )}

      <Card className="overflow-x-auto">
        <table className="w-full text-[13px]">
          <thead><tr className="border-b border-slate-700">
            <Th>Prio.</Th><Th>Código</Th><Th>Cuándo aplica</Th><Th>Importe</Th>
            <Th>Incluye</Th><Th>Suplementos</Th><Th></Th>
          </tr></thead>
          <tbody>
            {detalle.reglas.map((r) => (
              <tr key={r.id} className={`border-b border-slate-700/50 ${r.active ? "" : "opacity-50"}`}>
                <Td className="tabular-nums">{r.priority}</Td>
                <Td>
                  <span className="font-semibold text-slate-100">{r.code}</span>
                  <div className="text-[11px] text-slate-500">{r.name}</div>
                </Td>
                <Td className="text-[12px] text-slate-400">
                  {[
                    r.timeBandCode, (r.dayClasses ?? []).join("/"),
                    r.zoneCode, r.serviceTypeCode, r.vehicleTypeCode,
                    r.maxDistanceKm ? `≤ ${Number(r.maxDistanceKm)} km` : null,
                  ].filter(Boolean).join(" · ") || "Siempre"}
                </Td>
                <Td className="tabular-nums font-semibold text-slate-100">
                  {Number(r.amount).toFixed(2)} {detalle.version.currency}
                </Td>
                <Td className="text-[12px] text-slate-400">
                  {[r.includedDistanceKm ? `${Number(r.includedDistanceKm)} km` : null,
                    r.includedDurationMin ? `${r.includedDurationMin} min` : null].filter(Boolean).join(" / ") || "—"}
                </Td>
                <Td className="text-[12px] text-slate-400">
                  {[r.extraKmCode, r.extraTimeCode].filter(Boolean).join(" · ") || "—"}
                  {r.extraTriggerType === "THRESHOLD_PERCENT" && r.extraThresholdPercent != null &&
                    <span className="ml-1 text-slate-500">(&gt;{Number(r.extraThresholdPercent)}%)</span>}
                </Td>
                <Td>
                  {detalle.editable && (
                    <div className="flex gap-2">
                      <button className="text-[12px] text-cyan-300 hover:underline"
                              onClick={() => setEditando(r)}>Editar</button>
                      <button className="text-[12px] text-rose-300 hover:underline"
                              onClick={() => borrar(r)}>Borrar</button>
                    </div>
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

// ── Suplementos ─────────────────────────────────────────────────────────────

const CALCULOS = [
  ["FIXED", "Importe fijo"], ["PER_UNIT", "Por unidad"], ["PER_KM", "Por kilómetro"],
  ["PER_MINUTE", "Por minuto"], ["PER_HOUR", "Por hora"], ["PERCENTAGE", "Porcentaje"],
] as const;

function Suplementos({ detalle, onCambio, onError }: {
  detalle: Detalle; onCambio: () => void; onError: (m: string) => void;
}) {
  const [editando, setEditando] = useState<Partial<Extra> | null>(null);
  const [busy, setBusy] = useState(false);

  const guardar = async () => {
    if (!editando) return;
    setBusy(true);
    try {
      await boFetch(`/tariffs/versions/${detalle.version.id}/extras`, { method: "PUT", body: editando });
      setEditando(null);
      onCambio();
    } catch (e: any) { onError(e.message); } finally { setBusy(false); }
  };

  return (
    <div className="flex flex-col gap-3">
      {detalle.editable && !editando && (
        <div>
          <Button onClick={() => setEditando({ code: "", name: "", calculationType: "FIXED", active: true })}>
            Añadir un suplemento
          </Button>
        </div>
      )}

      {editando && (
        <Card className="p-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <Campo label="Código">
              <Input value={editando.code ?? ""} disabled={!!editando.id}
                     onChange={(e) => setEditando({ ...editando, code: e.target.value.toUpperCase() })} />
            </Campo>
            <Campo label="Nombre">
              <Input value={editando.name ?? ""} onChange={(e) => setEditando({ ...editando, name: e.target.value })} />
            </Campo>
            <Campo label="Cómo se calcula">
              <Select value={editando.calculationType ?? "FIXED"}
                      onChange={(e) => setEditando({ ...editando, calculationType: e.target.value })}>
                {CALCULOS.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
              </Select>
            </Campo>
            {editando.calculationType === "PERCENTAGE" ? (
              <Campo label="Porcentaje">
                <Input value={editando.percentage ?? ""}
                       onChange={(e) => setEditando({ ...editando, percentage: e.target.value })} />
              </Campo>
            ) : (
              <Campo label="Importe">
                <Input value={editando.amount ?? ""}
                       onChange={(e) => setEditando({ ...editando, amount: e.target.value })} />
              </Campo>
            )}
            <Campo label="Unidad">
              <Input value={editando.unit ?? ""} onChange={(e) => setEditando({ ...editando, unit: e.target.value })}
                     placeholder="km, h, ud" />
            </Campo>
            <Campo label="Tipo de línea que genera">
              <Input value={editando.lineKind ?? ""} onChange={(e) => setEditando({ ...editando, lineKind: e.target.value })}
                     placeholder="EXTRA_KM, TOLL…" />
            </Campo>
          </div>
          <div className="mt-4 flex gap-2">
            <Button onClick={guardar} disabled={busy || !editando.code?.trim()}>Guardar</Button>
            <Button variant="ghost" onClick={() => setEditando(null)} disabled={busy}>Cancelar</Button>
          </div>
        </Card>
      )}

      <Card className="overflow-x-auto">
        <table className="w-full text-[13px]">
          <thead><tr className="border-b border-slate-700">
            <Th>Código</Th><Th>Nombre</Th><Th>Cálculo</Th><Th>Valor</Th><Th>Unidad</Th><Th></Th>
          </tr></thead>
          <tbody>
            {detalle.extras.map((x) => (
              <tr key={x.id} className="border-b border-slate-700/50">
                <Td className="font-semibold text-slate-100">{x.code}</Td>
                <Td>{x.name}</Td>
                <Td className="text-slate-400">
                  {CALCULOS.find(([v]) => v === x.calculationType)?.[1] ?? x.calculationType}
                </Td>
                <Td className="tabular-nums">
                  {x.calculationType === "PERCENTAGE"
                    ? `${Number(x.percentage ?? 0)} %`
                    : `${Number(x.amount ?? 0).toFixed(2)} ${detalle.version.currency}`}
                </Td>
                <Td>{x.unit ?? "—"}</Td>
                <Td>
                  {detalle.editable && (
                    <button className="text-[12px] text-cyan-300 hover:underline"
                            onClick={() => setEditando(x)}>Editar</button>
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

// ── Franjas ─────────────────────────────────────────────────────────────────

function Franjas({ detalle, onCambio, onError }: {
  detalle: Detalle; onCambio: () => void; onError: (m: string) => void;
}) {
  const [editando, setEditando] = useState<Partial<Franja> | null>(null);
  const [busy, setBusy] = useState(false);

  const guardar = async () => {
    if (!editando) return;
    setBusy(true);
    try {
      await boFetch("/tariffs/time-bands", { method: "PUT", body: editando });
      setEditando(null);
      onCambio();
    } catch (e: any) { onError(e.message); } finally { setBusy(false); }
  };

  return (
    <div className="flex flex-col gap-3">
      <p className="text-[12px] text-slate-500">
        Las franjas se comparten entre todos los tarifarios del centro. Una que
        ya usa una versión publicada no se puede cambiar —alteraría cómo
        resuelve esa tarifa sin pasar por el duplicado—: hay que crear otra.
      </p>

      {!editando && (
        <div>
          <Button onClick={() => setEditando({
            code: "", name: "", desde: "08:00", hasta: "19:00",
            weekdays: [1, 2, 3, 4, 5], weekdayAnchor: "moment", active: true,
          })}>
            Añadir una franja
          </Button>
        </div>
      )}

      {editando && (
        <Card className="p-4">
          <div className="grid gap-3 sm:grid-cols-4">
            <Campo label="Código">
              <Input value={editando.code ?? ""} onChange={(e) => setEditando({ ...editando, code: e.target.value.toUpperCase() })} />
            </Campo>
            <Campo label="Nombre">
              <Input value={editando.name ?? ""} onChange={(e) => setEditando({ ...editando, name: e.target.value })} />
            </Campo>
            <Campo label="Desde">
              <Input value={editando.desde ?? ""} onChange={(e) => setEditando({ ...editando, desde: e.target.value })} placeholder="19:00" />
            </Campo>
            <Campo label="Hasta">
              <Input value={editando.hasta ?? ""} onChange={(e) => setEditando({ ...editando, hasta: e.target.value })} placeholder="08:00" />
            </Campo>
          </div>

          <div className="mt-3">
            <span className="mb-1 block text-xs text-slate-500">Días</span>
            <div className="flex gap-1">
              {DIAS.map((d, i) => {
                const n = i + 1;
                const puesto = (editando.weekdays ?? []).includes(n);
                return (
                  <button
                    key={d}
                    type="button"
                    onClick={() => setEditando({
                      ...editando,
                      weekdays: puesto
                        ? (editando.weekdays ?? []).filter((x) => x !== n)
                        : [...(editando.weekdays ?? []), n].sort(),
                    })}
                    className={`h-8 w-8 rounded-lg text-[13px] font-medium ${
                      puesto ? "bg-cyan-600/30 text-cyan-200" : "bg-slate-800 text-slate-500"}`}
                  >
                    {d}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="mt-3 max-w-md">
            <Campo label="Una franja que cruza la medianoche, ¿de qué día es?">
              <Select value={editando.weekdayAnchor ?? "moment"}
                      onChange={(e) => setEditando({ ...editando, weekdayAnchor: e.target.value })}>
                <option value="moment">Del día real (el sábado a las 02:00 es sábado)</option>
                <option value="band_start">Del día en que empezó (esas 02:00 son del viernes)</option>
              </Select>
            </Campo>
          </div>

          <div className="mt-4 flex gap-2">
            <Button onClick={guardar} disabled={busy || !editando.code?.trim()}>Guardar</Button>
            <Button variant="ghost" onClick={() => setEditando(null)} disabled={busy}>Cancelar</Button>
          </div>
        </Card>
      )}

      <Card className="overflow-x-auto">
        <table className="w-full text-[13px]">
          <thead><tr className="border-b border-slate-700">
            <Th>Código</Th><Th>Nombre</Th><Th>Horario</Th><Th>Días</Th><Th>Medianoche</Th><Th></Th>
          </tr></thead>
          <tbody>
            {detalle.franjas.map((f) => (
              <tr key={f.id} className="border-b border-slate-700/50">
                <Td className="font-semibold text-slate-100">{f.code}</Td>
                <Td>{f.name}</Td>
                <Td className="tabular-nums">{f.desde} – {f.hasta}</Td>
                <Td>{(f.weekdays ?? []).map((d) => DIAS[d - 1]).join(" ")}</Td>
                <Td className="text-[12px] text-slate-400">
                  {f.weekdayAnchor === "band_start" ? "Del día en que empezó" : "Del día real"}
                </Td>
                <Td>
                  {f.enUsoPublicado
                    ? <Badge className="border-slate-600 text-slate-500" title="La usa una tarifa publicada">bloqueada</Badge>
                    : <button className="text-[12px] text-cyan-300 hover:underline"
                              onClick={() => setEditando(f)}>Editar</button>}
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

// ── Zonas y calendario (consulta) ───────────────────────────────────────────

function Zonas({ detalle }: { detalle: Detalle }) {
  return (
    <Card className="overflow-x-auto">
      <table className="w-full text-[13px]">
        <thead><tr className="border-b border-slate-700">
          <Th>Código</Th><Th>Nombre</Th><Th>Tipo</Th><Th>Miembros</Th>
        </tr></thead>
        <tbody>
          {detalle.zonas.map((z) => (
            <tr key={z.id} className="border-b border-slate-700/50">
              <Td className="font-semibold text-slate-100">{z.code}</Td>
              <Td>{z.name}</Td>
              <Td className="text-slate-400">{z.type}</Td>
              <Td className="text-[12px] text-slate-400">
                {(z.miembros ?? []).map((m: any) => `${m.matchType}:${m.value}`).join(", ") || "—"}
              </Td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

function Calendario({ detalle }: { detalle: Detalle }) {
  if (detalle.calendario.length === 0) {
    return <EmptyState message="Este tarifario no tiene calendario asociado." />;
  }
  return (
    <Card className="overflow-x-auto">
      <p className="border-b border-slate-700 px-4 py-2 text-[12px] text-slate-500">
        Los festivos autonómicos y locales hay que añadirlos según dónde opere la
        central: el calendario cargado es el estatal.
      </p>
      <table className="w-full text-[13px]">
        <thead><tr className="border-b border-slate-700">
          <Th>Fecha</Th><Th>Nombre</Th><Th>Ámbito</Th><Th>Clase</Th><Th>Anual</Th>
        </tr></thead>
        <tbody>
          {detalle.calendario.map((d) => (
            <tr key={d.id} className="border-b border-slate-700/50">
              <Td className="tabular-nums">{String(d.date).slice(0, 10)}</Td>
              <Td>{d.name ?? "—"}</Td>
              <Td className="text-slate-400">{d.scope}</Td>
              <Td className="text-slate-400">{d.dayClass}</Td>
              <Td>{d.yearly ? "Sí" : "No"}</Td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

function Campo({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs text-slate-500">{label}</span>
      {children}
    </label>
  );
}
