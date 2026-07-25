/**
 * Centro de Inteligencia Operacional — Configuración.
 *
 * Tres bloques: objetivos y umbrales del semáforo por KPI, gobierno de los
 * modelos de IA con su precisión medida, e inventario de datos (qué KPIs no
 * pueden calcularse todavía y qué falta para poder hacerlo).
 */

import { useCallback, useEffect, useState } from "react";
import { Brain, Database, Target } from "lucide-react";
import { Card, ErrorBanner, Th, Td, Button, Input, Badge, Select } from "../../components/ui";
import { useConnectAuth, hasRole } from "../../contexts/ConnectAuthContext";
import { oiFetch, fmtDateTime } from "../../services/oiApi";

type CatalogKpi = {
  code: string; name: string; category: string; unit: string; formula: string; direction: string;
  targetValue: number | null; warningThreshold: number | null; criticalThreshold: number | null;
  available?: boolean; missingData?: string; configured?: boolean;
};

type Model = {
  id: number; modelName: string; modelType: string; version: string; status: string;
  accuracyMetrics: Record<string, unknown>; configuration: { description?: string };
  deploymentAtMs: number | null; lastEvaluatedAtMs: number | null;
};

type Accuracy = {
  predictionType: string; modelVersion: string; evaluated: number;
  mae: number | null; mape: number | null; bias: number | null;
};

type Inventory = {
  totals: { total: number; available: number; missing: number };
  available: Array<{ code: string; name: string; category: string; formula: string }>;
  missing: Array<{ code: string; name: string; category: string; missingData: string }>;
};

const CATEGORY_LABELS: Record<string, string> = {
  operational: "Operacionales", provider: "Proveedores", fleet: "Flota",
  driver: "Conductores", economic: "Económicos", quality: "Calidad",
};

export default function ConfiguracionIA() {
  const { user } = useConnectAuth();
  const [kpis, setKpis] = useState<CatalogKpi[]>([]);
  const [models, setModels] = useState<Model[]>([]);
  const [accuracy, setAccuracy] = useState<Accuracy[]>([]);
  const [inventory, setInventory] = useState<Inventory | null>(null);
  const [category, setCategory] = useState("operational");
  const [edits, setEdits] = useState<Record<string, { target: string; warn: string; crit: string }>>({});
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const canEdit = hasRole(user, "cc_admin");

  const load = useCallback(() => {
    Promise.all([
      oiFetch<{ data: CatalogKpi[] }>("/kpis/catalog"),
      oiFetch<{ models: Model[]; accuracy: Accuracy[] }>("/models"),
      oiFetch<Inventory>("/data-inventory"),
    ])
      .then(([k, m, i]) => { setKpis(k.data); setModels(m.models); setAccuracy(m.accuracy); setInventory(i); })
      .catch((e) => setError(e.message));
  }, []);

  useEffect(load, [load]);

  async function save(kpi: CatalogKpi) {
    const e = edits[kpi.code];
    try {
      await oiFetch("/kpis/configuration", {
        method: "POST",
        body: {
          code: kpi.code,
          targetValue: e?.target === "" ? null : Number(e?.target ?? kpi.targetValue),
          warningThreshold: e?.warn === "" ? null : Number(e?.warn ?? kpi.warningThreshold),
          criticalThreshold: e?.crit === "" ? null : Number(e?.crit ?? kpi.criticalThreshold),
        },
      });
      setSaved(kpi.code);
      setTimeout(() => setSaved(null), 2000);
      load();
    } catch (err: any) {
      setError(err.message);
    }
  }

  async function setModelStatus(model: Model, status: string) {
    await oiFetch(`/models/${model.id}`, { method: "PATCH", body: { status } }).catch((e) => setError(e.message));
    load();
  }

  const visible = kpis.filter((k) => k.category === category);

  return (
    <div className="space-y-4">
      {error && <ErrorBanner message={error} onClose={() => setError(null)} />}

      <Card className="overflow-x-auto">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-700 px-3 py-2">
          <div className="flex items-center gap-2">
            <Target className="h-4 w-4 text-cyan-400" />
            <div>
              <div className="text-sm font-black text-slate-100">Objetivos y umbrales del semáforo</div>
              <div className="text-[11px] text-slate-500">
                Los umbrales son desviaciones relativas sobre el objetivo (0,1 = 10 %). Ámbar a partir del primero, rojo del segundo.
              </div>
            </div>
          </div>
          <Select value={category} onChange={(e) => setCategory(e.target.value)}>
            {Object.entries(CATEGORY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
        </div>
        <table className="w-full">
          <thead><tr className="border-b border-slate-700">
            <Th>KPI</Th><Th>Cálculo</Th><Th>Unidad</Th><Th>Objetivo</Th><Th>Umbral ámbar</Th><Th>Umbral rojo</Th><Th></Th>
          </tr></thead>
          <tbody>
            {visible.map((k) => {
              const e = edits[k.code] ?? {
                target: k.targetValue?.toString() ?? "",
                warn: k.warningThreshold?.toString() ?? "",
                crit: k.criticalThreshold?.toString() ?? "",
              };
              const update = (field: "target" | "warn" | "crit", value: string) =>
                setEdits({ ...edits, [k.code]: { ...e, [field]: value } });
              return (
                <tr key={k.code} className="border-b border-slate-700/50">
                  <Td className="font-semibold text-slate-100">
                    {k.name}
                    {k.available === false && <Badge className="ml-1 border-slate-600 bg-slate-700/40 text-slate-400">sin datos</Badge>}
                    {k.configured && <Badge className="ml-1 border-cyan-500/40 bg-cyan-500/10 text-cyan-300">personalizado</Badge>}
                    <div className="text-[11px] font-normal text-slate-500">{k.code}</div>
                  </Td>
                  <Td className="max-w-[260px] text-[11px] text-slate-400">{k.formula}</Td>
                  <Td>{k.unit}</Td>
                  <Td><Input value={e.target} onChange={(ev) => update("target", ev.target.value)} disabled={!canEdit} className="w-20" /></Td>
                  <Td><Input value={e.warn} onChange={(ev) => update("warn", ev.target.value)} disabled={!canEdit} className="w-20" /></Td>
                  <Td><Input value={e.crit} onChange={(ev) => update("crit", ev.target.value)} disabled={!canEdit} className="w-20" /></Td>
                  <Td>
                    {canEdit && (
                      <Button variant="ghost" onClick={() => save(k)}>{saved === k.code ? "Guardado" : "Guardar"}</Button>
                    )}
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>

      <Card className="overflow-x-auto">
        <div className="flex items-center gap-2 border-b border-slate-700 px-3 py-2">
          <Brain className="h-4 w-4 text-cyan-400" />
          <div>
            <div className="text-sm font-black text-slate-100">Modelos de IA y precisión medida</div>
            <div className="text-[11px] text-slate-500">
              La precisión se calcula comparando cada predicción con el resultado real de los últimos 30 días.
            </div>
          </div>
        </div>
        <table className="w-full">
          <thead><tr className="border-b border-slate-700">
            <Th>Modelo</Th><Th>Tipo</Th><Th>Versión</Th><Th>Estado</Th><Th>Evaluadas</Th>
            <Th>Error medio</Th><Th>Error relativo</Th><Th>Sesgo</Th><Th>Última evaluación</Th><Th></Th>
          </tr></thead>
          <tbody>
            {models.map((m) => {
              const acc = accuracy.find((a) => a.predictionType === m.modelType);
              return (
                <tr key={m.id} className="border-b border-slate-700/50">
                  <Td className="font-semibold text-slate-100">
                    {m.modelName}
                    <div className="text-[11px] font-normal text-slate-500">{m.configuration?.description}</div>
                  </Td>
                  <Td>{m.modelType}</Td>
                  <Td>{m.version}</Td>
                  <Td>
                    <Badge className={m.status === "active"
                      ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
                      : "border-slate-600 bg-slate-700/40 text-slate-400"}>{m.status}</Badge>
                  </Td>
                  <Td>{acc?.evaluated ?? 0}</Td>
                  <Td>{acc?.mae ?? "—"}</Td>
                  <Td>{acc?.mape == null ? "—" : `${acc.mape} %`}</Td>
                  <Td>{acc?.bias ?? "—"}</Td>
                  <Td className="text-[11px]">{fmtDateTime(m.lastEvaluatedAtMs)}</Td>
                  <Td>
                    {canEdit && (
                      <Select value={m.status} onChange={(e) => setModelStatus(m, e.target.value)}>
                        <option value="active">Activo</option>
                        <option value="shadow">En sombra</option>
                        <option value="retired">Retirado</option>
                      </Select>
                    )}
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>

      {inventory && (
        <Card className="p-4">
          <div className="mb-2 flex items-center gap-2">
            <Database className="h-4 w-4 text-cyan-400" />
            <div>
              <div className="text-sm font-black text-slate-100">Inventario de datos</div>
              <div className="text-[11px] text-slate-500">
                {inventory.totals.available} de {inventory.totals.total} KPIs se calculan hoy con los datos existentes.
                Los {inventory.totals.missing} restantes necesitan capturar antes información que la plataforma aún no registra.
              </div>
            </div>
          </div>
          <ul className="space-y-1.5">
            {inventory.missing.map((m) => (
              <li key={m.code} className="rounded-lg border border-amber-500/25 bg-amber-500/5 px-3 py-2 text-[12px]">
                <b className="text-slate-200">{m.name}</b>
                <span className="ml-1 text-slate-500">({CATEGORY_LABELS[m.category] ?? m.category})</span>
                <div className="text-slate-400">{m.missingData}</div>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
