import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { getAdminHeaders } from "../../adminHeaders";

/**
 * Panel de integraciones del Mobilink Integration Hub (§2.11).
 *
 * Opera contra /api/v1/admin/*:
 *  - Conectores: activar/desactivar, editar config NO sensible, probar conexión.
 *  - Operaciones: listado con filtros, detalle con audit log, reprocesar fallidas.
 *
 * Los SECRETOS no se gestionan aquí: van al gestor de secretos vía variables
 * de entorno (IH_SECRET__<TENANT>__<CONECTOR>__<NOMBRE>), nunca a la BD.
 */

const TENANT_STORAGE_KEY = "mobilink-tenant-id";

type ConnectorKind = "erp" | "technical" | "supplier";

const CONNECTOR_META: Record<string, { nombre: string; kind: ConnectorKind; descripcion: string; secretos: string[] }> = {
  "business-central": {
    nombre: "Business Central",
    kind: "erp",
    descripcion: "ERP Microsoft Dynamics 365. Config: baseUrl, companyId, aadTenantId, defaultCurrency.",
    secretos: ["client_id", "client_secret", "aad_tenant_id"],
  },
  autodata: {
    nombre: "Autodata",
    kind: "technical",
    descripcion: "Datos técnicos: tiempos de reparación, mantenimiento, medidas. Config: baseUrl.",
    secretos: ["api_key"],
  },
  tecdoc: {
    nombre: "TecDoc",
    kind: "technical",
    descripcion: "Catálogo de recambios y referencias OE. Config: baseUrl, providerId.",
    secretos: ["api_key"],
  },
  "recambista-generico": {
    nombre: "Recambista genérico",
    kind: "supplier",
    descripcion: "Proveedor de recambios (SUP-001). Config: baseUrl, leadDays.",
    secretos: ["api_key"],
  },
};

const KIND_LABEL: Record<ConnectorKind, { label: string; clase: string }> = {
  erp: { label: "ERP", clase: "bg-blue-500/15 text-blue-300" },
  technical: { label: "Datos técnicos", clase: "bg-emerald-500/15 text-emerald-300" },
  supplier: { label: "Proveedor", clase: "bg-amber-500/15 text-amber-300" },
};

const ESTADOS = [
  "RECEIVED",
  "VALIDATING",
  "PROCESSING",
  "COMPLETED",
  "FAILED",
  "RETRY_PENDING",
  "MANUAL_REVIEW",
  "CANCELLED",
] as const;

const ESTADO_CLASE: Record<string, string> = {
  COMPLETED: "bg-emerald-500/15 text-emerald-300",
  FAILED: "bg-rose-500/15 text-rose-300",
  MANUAL_REVIEW: "bg-orange-500/15 text-orange-300",
  RETRY_PENDING: "bg-amber-500/15 text-amber-300",
  PROCESSING: "bg-sky-500/15 text-sky-300",
  RECEIVED: "bg-slate-500/15 text-slate-300",
  VALIDATING: "bg-slate-500/15 text-slate-300",
  CANCELLED: "bg-slate-500/15 text-slate-400",
};

type ConfigRow = {
  connector_key: string;
  enabled: boolean;
  config: Record<string, unknown> | null;
};

type OperationRow = {
  id: number;
  operation_type: string;
  connector_key: string | null;
  source_system: string;
  target_system: string;
  correlation_id: string;
  status: string;
  retry_count: number;
  error_code: string | null;
  error_message: string | null;
  created_at_ms: number;
};

type LogRow = {
  id: number;
  level: string;
  status: string | null;
  message: string;
  data: unknown;
  created_at_ms: number;
};

function fmtFecha(ms: number): string {
  if (!ms) return "—";
  const d = new Date(Number(ms));
  return d.toLocaleString("es-ES", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: getAdminHeaders({ "Content-Type": "application/json", ...(init?.headers ?? {}) }),
  });
  if (res.status === 401) throw new Error("401: token de administrador inválido o ausente");
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error((body as any)?.message || (body as any)?.error || `Error ${res.status}`);
  }
  return (await res.json()) as T;
}

// ── Pestaña Conectores ───────────────────────────────────────────────────────

function TarjetaConector({
  connectorKey,
  row,
  tenantId,
  onSaved,
}: {
  connectorKey: string;
  row: ConfigRow | undefined;
  tenantId: string;
  onSaved: () => void;
}) {
  const meta = CONNECTOR_META[connectorKey] ?? {
    nombre: connectorKey,
    kind: "erp" as ConnectorKind,
    descripcion: "",
    secretos: [],
  };
  const [enabled, setEnabled] = useState(row?.enabled ?? false);
  const [configText, setConfigText] = useState(JSON.stringify(row?.config ?? {}, null, 2));
  const [guardando, setGuardando] = useState(false);
  const [probando, setProbando] = useState(false);
  const [mensaje, setMensaje] = useState<{ ok: boolean; texto: string } | null>(null);

  useEffect(() => {
    setEnabled(row?.enabled ?? false);
    setConfigText(JSON.stringify(row?.config ?? {}, null, 2));
  }, [row]);

  const guardar = async () => {
    setGuardando(true);
    setMensaje(null);
    try {
      let config: Record<string, unknown>;
      try {
        config = JSON.parse(configText || "{}");
      } catch {
        throw new Error("La configuración no es JSON válido");
      }
      await api(`/api/v1/admin/connectors/${connectorKey}?tenantId=${encodeURIComponent(tenantId)}`, {
        method: "PUT",
        body: JSON.stringify({ enabled, config }),
      });
      setMensaje({ ok: true, texto: "Guardado" });
      onSaved();
    } catch (e: any) {
      setMensaje({ ok: false, texto: e.message });
    } finally {
      setGuardando(false);
    }
  };

  const probar = async () => {
    setProbando(true);
    setMensaje(null);
    try {
      const r = await api<{ ok: boolean; message: string }>(
        `/api/v1/admin/connectors/${connectorKey}/test?tenantId=${encodeURIComponent(tenantId)}`,
        { method: "POST", body: "{}" }
      );
      setMensaje({ ok: r.ok, texto: r.message });
    } catch (e: any) {
      setMensaje({ ok: false, texto: e.message });
    } finally {
      setProbando(false);
    }
  };

  const kind = KIND_LABEL[meta.kind];

  return (
    <div className="rounded-xl border border-slate-700 bg-slate-800/60 p-4">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-sm font-black">{meta.nombre}</span>
          <span className={`rounded px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${kind.clase}`}>{kind.label}</span>
        </div>
        <label className="flex cursor-pointer items-center gap-2 text-xs text-slate-300">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} className="h-4 w-4 accent-sky-500" />
          Activo
        </label>
      </div>
      <p className="mb-2 text-[11px] text-slate-400">{meta.descripcion}</p>
      <p className="mb-2 text-[11px] text-slate-500">
        Sin credenciales configuradas opera en <span className="font-semibold text-slate-300">modo simulación</span>. Secretos por entorno:{" "}
        {meta.secretos.map((s) => (
          <code key={s} className="mr-1 rounded bg-slate-900 px-1 py-0.5 text-[10px] text-slate-300">
            IH_SECRET__{connectorKey.toUpperCase().replace(/-/g, "_")}__{s.toUpperCase()}
          </code>
        ))}
      </p>
      <textarea
        value={configText}
        onChange={(e) => setConfigText(e.target.value)}
        rows={4}
        spellCheck={false}
        className="mb-2 w-full rounded-lg border border-slate-700 bg-slate-900 p-2 font-mono text-[11px] text-slate-200"
      />
      <div className="flex items-center gap-2">
        <button
          onClick={guardar}
          disabled={guardando}
          className="rounded-lg bg-sky-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-sky-500 disabled:opacity-50"
        >
          {guardando ? "Guardando…" : "Guardar"}
        </button>
        <button
          onClick={probar}
          disabled={probando}
          className="rounded-lg border border-slate-600 px-3 py-1.5 text-xs font-bold text-slate-200 hover:bg-slate-700 disabled:opacity-50"
        >
          {probando ? "Probando…" : "Probar conexión"}
        </button>
        {mensaje && (
          <span className={`text-[11px] ${mensaje.ok ? "text-emerald-300" : "text-rose-300"}`}>{mensaje.texto}</span>
        )}
      </div>
    </div>
  );
}

function PestanaConectores({ tenantId }: { tenantId: string }) {
  const [keys, setKeys] = useState<string[]>([]);
  const [configs, setConfigs] = useState<ConfigRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    setError(null);
    try {
      const health = await api<{ erpConnectors: string[]; technicalConnectors: string[]; supplierConnectors: string[] }>(
        "/api/v1/health"
      );
      setKeys([...health.erpConnectors, ...health.technicalConnectors, ...health.supplierConnectors]);
      const data = await api<{ configs: ConfigRow[] }>(`/api/v1/admin/connectors?tenantId=${encodeURIComponent(tenantId)}`);
      setConfigs(data.configs);
    } catch (e: any) {
      setError(e.message);
    }
  }, [tenantId]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  return (
    <div>
      {error && <div className="mb-3 rounded-lg bg-rose-500/10 p-2 text-xs text-rose-300">{error}</div>}
      <div className="grid gap-3 md:grid-cols-2">
        {keys.map((k) => (
          <TarjetaConector
            key={k}
            connectorKey={k}
            row={configs.find((c) => c.connector_key === k)}
            tenantId={tenantId}
            onSaved={cargar}
          />
        ))}
      </div>
    </div>
  );
}

// ── Pestaña Operaciones ──────────────────────────────────────────────────────

function DetalleOperacion({ id, onClose, onReprocesada }: { id: number; onClose: () => void; onReprocesada: () => void }) {
  const [data, setData] = useState<{ operation: OperationRow & { request_payload: unknown; response_payload: unknown }; logs: LogRow[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reprocesando, setReprocesando] = useState(false);

  const cargar = useCallback(async () => {
    try {
      setData(await api(`/api/v1/admin/operations/${id}`));
    } catch (e: any) {
      setError(e.message);
    }
  }, [id]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  const reprocesar = async () => {
    setReprocesando(true);
    try {
      await api(`/api/v1/admin/operations/${id}/reprocess`, { method: "POST", body: "{}" });
      await cargar();
      onReprocesada();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setReprocesando(false);
    }
  };

  const op = data?.operation;
  const reprocesable = op && ["FAILED", "MANUAL_REVIEW", "RETRY_PENDING"].includes(op.status);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        className="max-h-[85vh] w-full max-w-3xl overflow-y-auto rounded-xl border border-slate-700 bg-slate-900 p-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-black">Operación #{id}</h3>
          <button onClick={onClose} className="rounded px-2 py-1 text-xs text-slate-400 hover:bg-slate-800">✕ Cerrar</button>
        </div>
        {error && <div className="mb-2 rounded bg-rose-500/10 p-2 text-xs text-rose-300">{error}</div>}
        {op && (
          <>
            <div className="mb-3 grid grid-cols-2 gap-2 text-xs md:grid-cols-3">
              <div><span className="text-slate-500">Tipo:</span> {op.operation_type}</div>
              <div>
                <span className="text-slate-500">Estado:</span>{" "}
                <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${ESTADO_CLASE[op.status] ?? ""}`}>{op.status}</span>
              </div>
              <div><span className="text-slate-500">Reintentos:</span> {op.retry_count}</div>
              <div className="col-span-2"><span className="text-slate-500">Correlación:</span> <code className="text-[10px]">{op.correlation_id}</code></div>
              <div><span className="text-slate-500">Fecha:</span> {fmtFecha(op.created_at_ms)}</div>
            </div>
            {op.error_message && (
              <div className="mb-3 rounded bg-rose-500/10 p-2 text-xs text-rose-300">
                <b>{op.error_code}</b>: {op.error_message}
              </div>
            )}
            {reprocesable && (
              <button
                onClick={reprocesar}
                disabled={reprocesando}
                className="mb-3 rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-amber-500 disabled:opacity-50"
              >
                {reprocesando ? "Reprocesando…" : "Marcar para reproceso"}
              </button>
            )}
            <h4 className="mb-1 text-[11px] font-bold uppercase tracking-wide text-slate-400">Audit log</h4>
            <div className="mb-3 space-y-1">
              {data!.logs.map((l) => (
                <div key={l.id} className="rounded bg-slate-800/70 px-2 py-1 text-[11px]">
                  <span className="mr-2 text-slate-500">{fmtFecha(l.created_at_ms)}</span>
                  <span className={l.level === "error" ? "text-rose-300" : l.level === "warn" ? "text-amber-300" : "text-slate-200"}>
                    {l.message}
                  </span>
                  {l.status && <span className={`ml-2 rounded px-1 py-0.5 text-[9px] font-bold ${ESTADO_CLASE[l.status] ?? ""}`}>{l.status}</span>}
                </div>
              ))}
            </div>
            <details className="mb-2">
              <summary className="cursor-pointer text-[11px] font-bold text-slate-400">Petición</summary>
              <pre className="mt-1 overflow-x-auto rounded bg-slate-950 p-2 text-[10px] text-slate-300">{JSON.stringify(op.request_payload, null, 2)}</pre>
            </details>
            <details>
              <summary className="cursor-pointer text-[11px] font-bold text-slate-400">Respuesta</summary>
              <pre className="mt-1 overflow-x-auto rounded bg-slate-950 p-2 text-[10px] text-slate-300">{JSON.stringify(op.response_payload, null, 2)}</pre>
            </details>
          </>
        )}
      </div>
    </div>
  );
}

function PestanaOperaciones({ tenantId }: { tenantId: string }) {
  const [ops, setOps] = useState<OperationRow[]>([]);
  const [estado, setEstado] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [detalleId, setDetalleId] = useState<number | null>(null);
  const [workerMsg, setWorkerMsg] = useState<string | null>(null);
  const [workerRunning, setWorkerRunning] = useState(false);

  const cargar = useCallback(async () => {
    setError(null);
    try {
      const qs = new URLSearchParams({ tenantId });
      if (estado) qs.set("status", estado);
      const data = await api<{ operations: OperationRow[] }>(`/api/v1/admin/operations?${qs}`);
      setOps(data.operations);
    } catch (e: any) {
      setError(e.message);
    }
  }, [tenantId, estado]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  return (
    <div>
      <div className="mb-3 flex items-center gap-2">
        <select
          value={estado}
          onChange={(e) => setEstado(e.target.value)}
          className="rounded-lg border border-slate-700 bg-slate-900 px-2 py-1.5 text-xs text-slate-200"
        >
          <option value="">Todos los estados</option>
          {ESTADOS.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        <button onClick={cargar} className="rounded-lg border border-slate-600 px-3 py-1.5 text-xs font-bold text-slate-200 hover:bg-slate-700">
          ⟳ Actualizar
        </button>
        <button
          onClick={async () => {
            setWorkerRunning(true);
            setWorkerMsg(null);
            try {
              const r = await api<{ claimed: number; succeeded: number; failed: number; noHandler: number }>(
                "/api/v1/admin/worker/run",
                { method: "POST", body: "{}" }
              );
              setWorkerMsg(
                r.claimed === 0
                  ? "Worker: nada pendiente de reproceso"
                  : `Worker: ${r.claimed} reclamadas · ${r.succeeded} ok · ${r.failed} fallidas`
              );
              await cargar();
            } catch (e: any) {
              setWorkerMsg(e.message);
            } finally {
              setWorkerRunning(false);
            }
          }}
          disabled={workerRunning}
          className="rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-amber-500 disabled:opacity-50"
        >
          {workerRunning ? "Ejecutando…" : "▶ Ejecutar worker"}
        </button>
        <span className="text-[11px] text-slate-500">{ops.length} operaciones</span>
        {workerMsg && <span className="text-[11px] text-sky-300">{workerMsg}</span>}
      </div>
      {error && <div className="mb-3 rounded-lg bg-rose-500/10 p-2 text-xs text-rose-300">{error}</div>}
      <div className="overflow-x-auto rounded-xl border border-slate-700">
        <table className="w-full text-left text-xs">
          <thead className="bg-slate-800 text-[10px] uppercase tracking-wide text-slate-400">
            <tr>
              <th className="px-2 py-2">#</th>
              <th className="px-2 py-2">Fecha</th>
              <th className="px-2 py-2">Tipo</th>
              <th className="px-2 py-2">Destino</th>
              <th className="px-2 py-2">Estado</th>
              <th className="px-2 py-2">Correlación</th>
              <th className="px-2 py-2">Error</th>
            </tr>
          </thead>
          <tbody>
            {ops.map((o) => (
              <tr
                key={o.id}
                onClick={() => setDetalleId(o.id)}
                className="cursor-pointer border-t border-slate-800 hover:bg-slate-800/60"
              >
                <td className="px-2 py-1.5 text-slate-400">{o.id}</td>
                <td className="px-2 py-1.5 whitespace-nowrap">{fmtFecha(o.created_at_ms)}</td>
                <td className="px-2 py-1.5">{o.operation_type}</td>
                <td className="px-2 py-1.5">{o.target_system}</td>
                <td className="px-2 py-1.5">
                  <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${ESTADO_CLASE[o.status] ?? ""}`}>{o.status}</span>
                  {o.retry_count > 0 && <span className="ml-1 text-[10px] text-amber-300">×{o.retry_count}</span>}
                </td>
                <td className="px-2 py-1.5"><code className="text-[10px] text-slate-400">{o.correlation_id}</code></td>
                <td className="px-2 py-1.5 max-w-[16rem] truncate text-rose-300">{o.error_message ?? ""}</td>
              </tr>
            ))}
            {ops.length === 0 && (
              <tr>
                <td colSpan={7} className="px-2 py-6 text-center text-slate-500">Sin operaciones para este filtro.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {detalleId != null && (
        <DetalleOperacion id={detalleId} onClose={() => setDetalleId(null)} onReprocesada={cargar} />
      )}
    </div>
  );
}

// ── Página ───────────────────────────────────────────────────────────────────

export default function PanelIntegraciones() {
  const [tenantId, setTenantId] = useState(() => localStorage.getItem(TENANT_STORAGE_KEY) || "default");
  const [pestana, setPestana] = useState<"conectores" | "operaciones">("conectores");

  useEffect(() => {
    localStorage.setItem(TENANT_STORAGE_KEY, tenantId);
  }, [tenantId]);

  const pestanas = useMemo(
    () => [
      { id: "conectores" as const, label: "🔌 Conectores" },
      { id: "operaciones" as const, label: "📋 Operaciones" },
    ],
    []
  );

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100">
      <header className="border-b border-slate-800 bg-slate-950/60 px-4 py-3">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Link to="/sea" className="text-xs text-slate-400 hover:text-slate-200">← Hub</Link>
            <span className="text-sm font-black">Mobilink Integration Hub</span>
            <span className="rounded bg-sky-500/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-sky-300">
              Panel de integraciones
            </span>
          </div>
          <label className="flex items-center gap-2 text-[11px] text-slate-400">
            Tenant
            <input
              value={tenantId}
              onChange={(e) => setTenantId(e.target.value)}
              className="w-28 rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-200"
            />
          </label>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-4">
        <div className="mb-4 flex gap-1">
          {pestanas.map((p) => (
            <button
              key={p.id}
              onClick={() => setPestana(p.id)}
              className={`rounded-lg px-3 py-1.5 text-xs font-bold ${
                pestana === p.id ? "bg-sky-600 text-white" : "text-slate-300 hover:bg-slate-800"
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
        {pestana === "conectores" ? <PestanaConectores tenantId={tenantId} /> : <PestanaOperaciones tenantId={tenantId} />}
      </main>
    </div>
  );
}
