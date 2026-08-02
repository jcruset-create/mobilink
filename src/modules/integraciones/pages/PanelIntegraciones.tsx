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

type ConnectorKind = "erp" | "technical" | "supplier" | "communication";

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
  "mobilink-historico": {
    nombre: "Histórico de Mobilink",
    kind: "technical",
    descripcion:
      "Identifica el vehículo con los datos propios del taller (asistencias y OT): marca, modelo, VIN y medida de neumático. Sin credenciales ni coste. Config: {\"maxAntiguedadDias\": 365}.",
    secretos: [],
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
  "twilio-whatsapp": {
    nombre: "WhatsApp Business (Twilio)",
    kind: "communication",
    descripcion: 'Envío de presupuestos, citas y avisos por WhatsApp. Config: {"sendReal": true, "from": "whatsapp:+34..."} — sin sendReal, simula.',
    secretos: ["account_sid", "auth_token"],
  },
  "smtp-email": {
    nombre: "Email (SMTP)",
    kind: "communication",
    descripcion: 'Envío por email. Config: {"sendReal": true, "from": "Mobilink <taller@...>"} — sin sendReal, simula.',
    secretos: ["host", "user", "pass"],
  },
};

const KIND_LABEL: Record<ConnectorKind, { label: string; clase: string }> = {
  erp: { label: "ERP", clase: "bg-blue-500/15 text-blue-300" },
  technical: { label: "Datos técnicos", clase: "bg-emerald-500/15 text-emerald-300" },
  supplier: { label: "Proveedor", clase: "bg-amber-500/15 text-amber-300" },
  communication: { label: "Comunicación", clase: "bg-violet-500/15 text-violet-300" },
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
      const health = await api<{
        erpConnectors: string[];
        technicalConnectors: string[];
        supplierConnectors: string[];
        communicationConnectors?: string[];
      }>("/api/v1/health");
      setKeys([
        ...health.erpConnectors,
        ...health.technicalConnectors,
        ...health.supplierConnectors,
        ...(health.communicationConnectors ?? []),
      ]);
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

// ── Pestaña Mapeos ───────────────────────────────────────────────────────────

type MappingRow = {
  id: number;
  entity_type: string;
  system: string;
  external_code: string;
  mobilink_id: string;
  updated_at_ms: number;
};

const TIPOS_ENTIDAD = ["customer", "product", "vehicle", "warehouse"] as const;

const TIPO_LABEL: Record<string, string> = {
  customer: "Cliente",
  product: "Artículo",
  vehicle: "Vehículo",
  warehouse: "Almacén",
};

/**
 * Mapeos entre identificadores de Mobilink y códigos del sistema externo.
 *
 * Sin mapeo, el Hub envía el identificador tal cual (modo permisivo); con
 * "strictMappings": true en la config del conector, un id sin mapear manda la
 * operación a MANUAL_REVIEW en lugar de arriesgarse a apuntar al registro
 * equivocado en el ERP.
 */
function PestanaMapeos({ tenantId }: { tenantId: string }) {
  const [mappings, setMappings] = useState<MappingRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [filtroTipo, setFiltroTipo] = useState("");
  const [busqueda, setBusqueda] = useState("");

  // Formulario de alta.
  const [entityType, setEntityType] = useState<string>("product");
  const [system, setSystem] = useState("business-central");
  const [mobilinkId, setMobilinkId] = useState("");
  const [externalCode, setExternalCode] = useState("");
  const [guardando, setGuardando] = useState(false);

  const cargar = useCallback(async () => {
    setError(null);
    try {
      const params = new URLSearchParams({ tenantId });
      if (filtroTipo) params.set("entityType", filtroTipo);
      if (busqueda.trim()) params.set("search", busqueda.trim());
      const data = await api<{ mappings: MappingRow[] }>(`/api/v1/admin/mappings?${params}`);
      setMappings(data.mappings);
    } catch (e: any) {
      setError(e.message);
    }
  }, [tenantId, filtroTipo, busqueda]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  const anadir = async () => {
    if (!mobilinkId.trim() || !externalCode.trim()) {
      setError("Faltan el id de Mobilink y el código externo");
      return;
    }
    setGuardando(true);
    setError(null);
    try {
      await api(`/api/v1/admin/mappings?tenantId=${encodeURIComponent(tenantId)}`, {
        method: "POST",
        body: JSON.stringify({
          entityType,
          system,
          mobilinkId: mobilinkId.trim(),
          externalCode: externalCode.trim(),
        }),
      });
      setMobilinkId("");
      setExternalCode("");
      await cargar();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setGuardando(false);
    }
  };

  const borrar = async (id: number) => {
    setError(null);
    try {
      await api(`/api/v1/admin/mappings/${id}?tenantId=${encodeURIComponent(tenantId)}`, { method: "DELETE" });
      await cargar();
    } catch (e: any) {
      setError(e.message);
    }
  };

  return (
    <div>
      {error && <div className="mb-3 rounded-lg bg-rose-500/10 p-2 text-xs text-rose-300">{error}</div>}

      <div className="mb-3 rounded-xl border border-slate-700 bg-slate-800/60 p-4">
        <p className="mb-2 text-sm font-black">Nuevo mapeo</p>
        <p className="mb-3 text-[11px] text-slate-400">
          Traduce un identificador de Mobilink al código que usa el sistema externo. Sin mapeo, el Hub
          envía el identificador tal cual.
        </p>
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1 text-[11px] text-slate-400">
            Tipo
            <select
              value={entityType}
              onChange={(e) => setEntityType(e.target.value)}
              className="rounded border border-slate-700 bg-slate-900 px-2 py-1.5 text-xs text-slate-200"
            >
              {TIPOS_ENTIDAD.map((t) => (
                <option key={t} value={t}>
                  {TIPO_LABEL[t]}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-[11px] text-slate-400">
            Sistema
            <input
              value={system}
              onChange={(e) => setSystem(e.target.value)}
              className="w-40 rounded border border-slate-700 bg-slate-900 px-2 py-1.5 text-xs text-slate-200"
            />
          </label>
          <label className="flex flex-col gap-1 text-[11px] text-slate-400">
            Id en Mobilink
            <input
              value={mobilinkId}
              onChange={(e) => setMobilinkId(e.target.value)}
              placeholder="CLI-00125"
              className="w-40 rounded border border-slate-700 bg-slate-900 px-2 py-1.5 text-xs text-slate-200"
            />
          </label>
          <label className="flex flex-col gap-1 text-[11px] text-slate-400">
            Código externo
            <input
              value={externalCode}
              onChange={(e) => setExternalCode(e.target.value)}
              placeholder="10000"
              className="w-40 rounded border border-slate-700 bg-slate-900 px-2 py-1.5 text-xs text-slate-200"
            />
          </label>
          <button
            onClick={anadir}
            disabled={guardando}
            className="rounded-lg bg-sky-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-sky-500 disabled:opacity-50"
          >
            {guardando ? "Guardando…" : "Añadir"}
          </button>
        </div>
      </div>

      <div className="mb-2 flex flex-wrap items-center gap-2">
        <select
          value={filtroTipo}
          onChange={(e) => setFiltroTipo(e.target.value)}
          className="rounded border border-slate-700 bg-slate-900 px-2 py-1.5 text-xs text-slate-200"
        >
          <option value="">Todos los tipos</option>
          {TIPOS_ENTIDAD.map((t) => (
            <option key={t} value={t}>
              {TIPO_LABEL[t]}
            </option>
          ))}
        </select>
        <input
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          placeholder="Buscar por id o código…"
          className="w-56 rounded border border-slate-700 bg-slate-900 px-2 py-1.5 text-xs text-slate-200"
        />
        <button
          onClick={() => void cargar()}
          className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-bold text-slate-200 hover:bg-slate-800"
        >
          Refrescar
        </button>
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-700">
        <table className="w-full text-left text-xs">
          <thead className="bg-slate-800/80 text-slate-300">
            <tr>
              <th className="px-3 py-2">Tipo</th>
              <th className="px-3 py-2">Id en Mobilink</th>
              <th className="px-3 py-2">Código externo</th>
              <th className="px-3 py-2">Sistema</th>
              <th className="px-3 py-2">Actualizado</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {mappings.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-slate-500">
                  Sin mapeos. El Hub enviará los identificadores tal cual.
                </td>
              </tr>
            )}
            {mappings.map((m) => (
              <tr key={m.id} className="border-t border-slate-800">
                <td className="px-3 py-2">{TIPO_LABEL[m.entity_type] ?? m.entity_type}</td>
                <td className="px-3 py-2 font-mono text-slate-200">{m.mobilink_id}</td>
                <td className="px-3 py-2 font-mono text-sky-300">{m.external_code}</td>
                <td className="px-3 py-2 text-slate-400">{m.system}</td>
                <td className="px-3 py-2 text-slate-500">{fmtFecha(m.updated_at_ms)}</td>
                <td className="px-3 py-2 text-right">
                  <button
                    onClick={() => void borrar(m.id)}
                    className="rounded border border-slate-700 px-2 py-1 text-[11px] text-rose-300 hover:bg-slate-800"
                  >
                    Borrar
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Pestaña Catálogo (SPEC WorkPlanner §4) ───────────────────────────────────

type CatalogRow = {
  id: number;
  bc_number: string;
  tipo: string | null;
  descripcion: string;
  um_base: string | null;
  categoria: string | null;
  precio_orientativo: string | number | null;
  activo: boolean;
  motivo_inactivo: string | null;
};

const MOTIVO_INACTIVO_LABEL: Record<string, string> = {
  bloqueado: "Bloqueado en BC",
  fuera_de_filtro: "Fuera del filtro de categorías",
  huerfano: "Ya no existe en BC",
};

/**
 * Catálogo controlado: copia local de los artículos de BC aptos para trabajos
 * de campo. BC es el maestro — aquí no se crea ni se edita nada, sólo se
 * sincroniza y se consulta.
 */
function PestanaCatalogo({ tenantId }: { tenantId: string }) {
  const [items, setItems] = useState<CatalogRow[]>([]);
  const [estado, setEstado] = useState<any | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sincronizando, setSincronizando] = useState(false);
  const [busqueda, setBusqueda] = useState("");
  const [verInactivos, setVerInactivos] = useState(false);

  const cargar = useCallback(async () => {
    setError(null);
    try {
      const params = new URLSearchParams({ tenantId, limit: "500" });
      if (verInactivos) params.set("todos", "1");
      if (busqueda.trim()) params.set("search", busqueda.trim());
      const [cat, st] = await Promise.all([
        api<{ items: CatalogRow[] }>(`/api/v1/catalog?${params}`),
        api<any>(`/api/v1/admin/catalog/status?tenantId=${encodeURIComponent(tenantId)}`),
      ]);
      setItems(cat.items);
      setEstado(st);
    } catch (e: any) {
      setError(e.message);
    }
  }, [tenantId, busqueda, verInactivos]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  const sincronizar = async (full: boolean) => {
    setSincronizando(true);
    setError(null);
    try {
      await api(`/api/v1/admin/catalog/sync?tenantId=${encodeURIComponent(tenantId)}`, {
        method: "POST",
        body: JSON.stringify({ full }),
      });
      await cargar();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSincronizando(false);
    }
  };

  return (
    <div>
      {error && <div className="mb-3 rounded-lg bg-rose-500/10 p-2 text-xs text-rose-300">{error}</div>}

      <div className="mb-3 flex flex-wrap items-center gap-3 rounded-xl border border-slate-700 bg-slate-800/60 p-3">
        <div className="text-xs text-slate-300">
          <span className="font-black">{estado?.activos ?? "—"}</span> activos de{" "}
          <span className="font-black">{estado?.total ?? "—"}</span>
          {estado?.lastSyncMs ? (
            <span className="ml-2 text-slate-500">Última sync: {fmtFecha(estado.lastSyncMs)}</span>
          ) : (
            <span className="ml-2 text-amber-400">Sin sincronizar todavía</span>
          )}
          {estado?.status === "error" && (
            <span className="ml-2 text-rose-400" title={estado?.detail ?? ""}>Última sync con error</span>
          )}
        </div>
        <div className="ml-auto flex gap-2">
          <button
            onClick={() => void sincronizar(false)}
            disabled={sincronizando}
            className="rounded-lg bg-sky-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-sky-500 disabled:opacity-50"
          >
            {sincronizando ? "Sincronizando…" : "Sincronizar ahora"}
          </button>
          <button
            onClick={() => void sincronizar(true)}
            disabled={sincronizando}
            title="Trae todo el catálogo y desactiva lo que ya no exista en BC"
            className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-bold text-slate-200 hover:bg-slate-800 disabled:opacity-50"
          >
            Sync completa
          </button>
        </div>
      </div>

      <div className="mb-2 flex flex-wrap items-center gap-2">
        <input
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          placeholder="Buscar por número o descripción…"
          className="w-64 rounded border border-slate-700 bg-slate-900 px-2 py-1.5 text-xs text-slate-200"
        />
        <label className="flex items-center gap-1.5 text-xs text-slate-400">
          <input type="checkbox" checked={verInactivos} onChange={(e) => setVerInactivos(e.target.checked)} className="h-3.5 w-3.5 accent-sky-500" />
          Ver también inactivos
        </label>
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-700">
        <table className="w-full text-left text-xs">
          <thead className="bg-slate-800/80 text-slate-300">
            <tr>
              <th className="px-3 py-2">Nº BC</th>
              <th className="px-3 py-2">Descripción</th>
              <th className="px-3 py-2">Tipo</th>
              <th className="px-3 py-2">Categoría</th>
              <th className="px-3 py-2">UM</th>
              <th className="px-3 py-2">Precio orient.</th>
              <th className="px-3 py-2">Estado</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-slate-500">
                  Catálogo vacío. Pulsa «Sincronizar ahora» para traerlo de Business Central.
                </td>
              </tr>
            )}
            {items.map((it) => (
              <tr key={it.id} className={`border-t border-slate-800 ${it.activo ? "" : "opacity-50"}`}>
                <td className="px-3 py-2 font-mono text-sky-300">{it.bc_number}</td>
                <td className="px-3 py-2">{it.descripcion}</td>
                <td className="px-3 py-2 text-slate-400">{it.tipo ?? "—"}</td>
                <td className="px-3 py-2 text-slate-400">{it.categoria ?? "—"}</td>
                <td className="px-3 py-2 text-slate-400">{it.um_base ?? "—"}</td>
                <td className="px-3 py-2">{it.precio_orientativo != null ? `${Number(it.precio_orientativo).toFixed(2)} €` : "—"}</td>
                <td className="px-3 py-2">
                  {it.activo ? (
                    <span className="rounded bg-emerald-500/15 px-2 py-0.5 text-[10px] font-bold text-emerald-300">Activo</span>
                  ) : (
                    <span className="rounded bg-slate-500/15 px-2 py-0.5 text-[10px] font-bold text-slate-400">
                      {MOTIVO_INACTIVO_LABEL[it.motivo_inactivo ?? ""] ?? "Inactivo"}
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-[11px] text-slate-500">
        El precio es orientativo (última tarifa base sincronizada); el definitivo lo calcula Business
        Central al facturar. Filtro por categorías: añade{" "}
        <code className="rounded bg-slate-900 px-1">{"\"catalogCategories\": [\"FRENOS\"]"}</code> a la config del
        conector Business Central.
      </p>
    </div>
  );
}

export default function PanelIntegraciones() {
  const [tenantId, setTenantId] = useState(() => localStorage.getItem(TENANT_STORAGE_KEY) || "default");
  const [pestana, setPestana] = useState<"conectores" | "operaciones" | "mapeos" | "catalogo">("conectores");

  useEffect(() => {
    localStorage.setItem(TENANT_STORAGE_KEY, tenantId);
  }, [tenantId]);

  const pestanas = useMemo(
    () => [
      { id: "conectores" as const, label: "🔌 Conectores" },
      { id: "operaciones" as const, label: "📋 Operaciones" },
      { id: "mapeos" as const, label: "🔗 Mapeos" },
      { id: "catalogo" as const, label: "📦 Catálogo" },
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
        {pestana === "conectores" && <PestanaConectores tenantId={tenantId} />}
        {pestana === "operaciones" && <PestanaOperaciones tenantId={tenantId} />}
        {pestana === "mapeos" && <PestanaMapeos tenantId={tenantId} />}
        {pestana === "catalogo" && <PestanaCatalogo tenantId={tenantId} />}
      </main>
    </div>
  );
}
