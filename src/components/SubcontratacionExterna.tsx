/**
 * Subcontratación de una asistencia a una plataforma externa (Central).
 *
 * Lo que esta pantalla tiene que dejar claro de un vistazo, porque es lo que
 * se pregunta cuando llama el cliente:
 *
 *   · a quién se le mandó y a qué plataforma
 *   · con qué expediente lo tienen ELLOS (el número por el que preguntar)
 *   · si ya lo han aceptado, y cuándo
 *   · si algo falló, qué falló y desde cuándo
 *
 * El expediente de Assist NO cambia al subcontratar. Son dos expedientes
 * distintos a propósito: cada sistema manda en sus estados, sus costes y sus
 * documentos, y aquí se ven los dos lados juntos sin mezclarlos.
 */

import { useCallback, useEffect, useState } from "react";
import { API_BASE, getAdminHeaders } from "../modules/workshopApi";

type EstadoDestino =
  | "NO_DESTINATIONS" | "DISABLED" | "MISCONFIGURED"
  | "AUTH_ERROR" | "UNREACHABLE" | "AVAILABLE";

type Destino = {
  id: number;
  name: string;
  remoteTenant: string | null;
  system: string | null;
  apiKeyEnvName: string | null;
  estado: EstadoDestino;
  mensaje: string;
  motivos: string[];
  lastOkAtMs: number | null;
  lastError: string | null;
  notes: string | null;
};

type Cartera = { estadoGlobal: EstadoDestino; disponibles: number; data: Destino[] };

type Evento = { evento: string; remoteStatus: string | null; direccion: string; occurredAtMs: number | null };

type Despacho = {
  id: number;
  destino: { id: number; nombre: string; plataforma: string | null };
  correlationId: string;
  referenciaOrigen: string | null;
  referenciaDestino: string | null;
  status: string;
  ultimoEvento: string | null;
  sentAtMs: number | null;
  acceptedAtMs: number | null;
  rejectedAtMs: number | null;
  completedAtMs: number | null;
  lastSyncAtMs: number | null;
  lastError: string | null;
  retryCount: number;
  sePuedeReintentar: boolean;
  eventos: Evento[];
};

const ETIQUETA_ESTADO: Record<string, string> = {
  PENDING: "Pendiente de enviar",
  SENDING: "Enviando…",
  SENT: "Enviada",
  RECEIVED: "Recibida por el destino",
  ACCEPTED: "Aceptada",
  REJECTED: "Rechazada",
  COMPLETED: "Finalizada",
  CANCELLED: "Anulada",
  ERROR: "Error de envío",
};

const TONO_ESTADO: Record<string, string> = {
  PENDING: "border-slate-500/40 bg-slate-500/10 text-slate-300",
  SENDING: "border-sky-500/40 bg-sky-500/10 text-sky-300",
  SENT: "border-sky-500/40 bg-sky-500/10 text-sky-300",
  RECEIVED: "border-indigo-500/40 bg-indigo-500/10 text-indigo-300",
  ACCEPTED: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
  REJECTED: "border-red-500/40 bg-red-500/10 text-red-300",
  COMPLETED: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
  CANCELLED: "border-slate-500/40 bg-slate-500/10 text-slate-400",
  ERROR: "border-red-500/40 bg-red-500/10 text-red-300",
};

const ETIQUETA_EVENTO: Record<string, string> = {
  REQUESTED: "Enviada", RECEIVED: "Recibida", ACCEPTED: "Aceptada",
  REJECTED: "Rechazada", INFO_REQUESTED: "Piden información",
  ASSIGNED: "Proveedor asignado", EN_ROUTE: "De camino", ON_SITE: "En el lugar",
  IN_PROGRESS: "En servicio", COMPLETED: "Finalizada", CANCELLED: "Anulada",
  DOCUMENTED: "Documentada", BILLABLE: "Lista para facturar",
};

function hora(ms: number | null): string {
  if (!ms) return "—";
  return new Date(ms).toLocaleString("es-ES", {
    day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
  });
}

async function pedir(ruta: string, init?: RequestInit) {
  const res = await fetch(`${API_BASE}${ruta}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...getAdminHeaders() },
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error ?? "Error de servidor");
  return data;
}

export default function SubcontratacionExterna({ assistanceId }: { assistanceId: number }) {
  const [cartera, setCartera] = useState<Cartera | null>(null);
  const destinos = cartera?.data ?? [];
  const [probando, setProbando] = useState<number | null>(null);
  const [despachos, setDespachos] = useState<Despacho[]>([]);
  const [destinoId, setDestinoId] = useState<number | "">("");
  const [referenciaCliente, setReferenciaCliente] = useState("");
  const [limite, setLimite] = useState("");
  const [incluirObservaciones, setIncluirObservaciones] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const cargar = useCallback(async () => {
    try {
      const d = await pedir(`/api/dispatch/asistencias/${assistanceId}/despachos`);
      setDespachos(d.data);
    } catch (e: any) { setError(e.message); }
  }, [assistanceId]);

  useEffect(() => {
    pedir("/api/dispatch/destinos").then(setCartera).catch((e) => setError(e.message));
    void cargar();
  }, [cargar]);

  const enviar = async () => {
    if (!destinoId) return;
    setBusy(true); setError("");
    try {
      await pedir(`/api/dispatch/asistencias/${assistanceId}/subcontratar`, {
        method: "POST",
        body: JSON.stringify({
          destinationId: destinoId,
          referenciaCliente: referenciaCliente.trim() || null,
          limiteAutorizado: limite.trim() === "" ? null : Number(limite),
          incluirObservaciones,
        }),
      });
      setDestinoId(""); setReferenciaCliente(""); setLimite("");
      await cargar();
    } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  };

  const reintentar = async (id: number) => {
    setBusy(true); setError("");
    try {
      await pedir(`/api/dispatch/despachos/${id}/reintentar`, { method: "POST" });
      await cargar();
    } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  };

  const elegido = destinos.find((d) => d.id === destinoId);
  const disponibles = destinos.filter((d) => d.estado === "AVAILABLE");
  const noDisponibles = destinos.filter((d) => d.estado !== "AVAILABLE");

  const probar = async (id: number) => {
    setProbando(id); setError("");
    try {
      const r = await pedir(`/api/dispatch/destinos/${id}/probar`, { method: "POST" });
      if (!r.ok) setError(`${r.estado}: ${r.mensaje}`);
      setCartera(await pedir("/api/dispatch/destinos"));
    } catch (e: any) { setError(e.message); } finally { setProbando(null); }
  };
  const yaEnviadaA = new Set(despachos.filter((d) => !d.sePuedeReintentar).map((d) => d.destino.id));

  return (
    <div className="rounded-lg border border-slate-700 bg-slate-900/50 p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-xs font-bold uppercase tracking-wide text-slate-300">
          Subcontratación externa
        </span>
        <span className="text-[11px] text-slate-500">Enviar la asistencia a otra plataforma</span>
      </div>

      {error && <p className="mb-2 text-[12px] text-red-300">{error}</p>}

      {despachos.map((d) => (
        <div key={d.id} className="mb-2 rounded-lg border border-slate-700 bg-slate-950/60 px-3 py-2 text-[13px]">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-slate-100">{d.destino.nombre}</span>
            {d.destino.plataforma && (
              <span className="rounded border border-slate-600 px-1.5 text-[10px] text-slate-400">
                {d.destino.plataforma}
              </span>
            )}
            <span className={`rounded border px-1.5 text-[10px] font-bold ${TONO_ESTADO[d.status] ?? ""}`}>
              {ETIQUETA_ESTADO[d.status] ?? d.status}
            </span>
          </div>

          <div className="mt-1 grid grid-cols-1 gap-x-4 gap-y-0.5 text-slate-400 sm:grid-cols-2">
            {/* El número por el que preguntar si hay que llamar al destino. */}
            <div>
              Expediente en destino:{" "}
              <span className="font-bold text-slate-200">{d.referenciaDestino ?? "—"}</span>
            </div>
            <div>Nuestro expediente: <span className="text-slate-300">{d.referenciaOrigen ?? "—"}</span></div>
            <div>Enviada: {hora(d.sentAtMs)}</div>
            <div>Aceptada: {hora(d.acceptedAtMs)}</div>
            {d.rejectedAtMs && <div className="text-red-300">Rechazada: {hora(d.rejectedAtMs)}</div>}
            <div>Última sincronización: {hora(d.lastSyncAtMs)}</div>
            {d.ultimoEvento && (
              <div>
                Estado comunicado:{" "}
                <span className="text-slate-300">{ETIQUETA_EVENTO[d.ultimoEvento] ?? d.ultimoEvento}</span>
              </div>
            )}
          </div>

          {d.lastError && (
            <div className="mt-1.5 rounded border border-red-500/40 bg-red-500/10 px-2 py-1 text-[12px] text-red-300">
              {d.lastError}
              {d.retryCount > 0 && <span className="text-red-400/70"> · {d.retryCount} intento(s)</span>}
            </div>
          )}

          {d.eventos.length > 0 && (
            <details className="mt-1.5">
              <summary className="cursor-pointer text-[11px] text-slate-500 hover:text-orange-400">
                Historial ({d.eventos.length})
              </summary>
              <ul className="mt-1 space-y-0.5 text-[11px] text-slate-500">
                {d.eventos.map((e, i) => (
                  <li key={i}>
                    {hora(e.occurredAtMs)} · {ETIQUETA_EVENTO[e.evento] ?? e.evento}
                    {e.remoteStatus ? ` (${e.remoteStatus})` : ""}
                  </li>
                ))}
              </ul>
            </details>
          )}

          {d.sePuedeReintentar && (
            <button
              onClick={() => void reintentar(d.id)}
              disabled={busy}
              className="mt-1.5 rounded border border-orange-500/40 bg-orange-500/10 px-2 py-1 text-[11px] font-bold text-orange-300 hover:bg-orange-500/20 disabled:opacity-50"
            >
              Reintentar envío
            </button>
          )}
        </div>
      ))}

      {/*
          Tres situaciones distintas, tres mensajes distintos. Confundirlas hacía
          buscar en el sitio equivocado: «no hay ninguna» se arregla dando de alta
          un destino, «mal configurada» se arregla poniendo una variable de
          entorno en el servidor.
      */}
      {cartera?.estadoGlobal === "NO_DESTINATIONS" ? (
        <p className="text-[12px] text-slate-500">
          No hay plataformas configuradas.
        </p>
      ) : disponibles.length === 0 ? (
        <p className="text-[12px] text-amber-300">
          Ninguna plataforma disponible ahora mismo. Revisa su configuración más abajo.
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <select
            value={destinoId}
            onChange={(e) => setDestinoId(e.target.value ? Number(e.target.value) : "")}
            className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-orange-500"
          >
            <option value="">— Plataforma de destino —</option>
            {disponibles.map((d) => (
              <option key={d.id} value={d.id} disabled={yaEnviadaA.has(d.id)}>
                {d.name}{d.remoteTenant ? ` · ${d.remoteTenant}` : ""}
                {yaEnviadaA.has(d.id) ? " (ya enviada)" : ""}
              </option>
            ))}
          </select>

          <input
            value={referenciaCliente}
            onChange={(e) => setReferenciaCliente(e.target.value)}
            placeholder="Referencia del cliente (póliza, pedido…)"
            className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-orange-500"
          />

          <input
            value={limite}
            onChange={(e) => setLimite(e.target.value)}
            type="number"
            min="0"
            placeholder="Límite autorizado (€)"
            className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-orange-500"
          />

          <div className="flex items-center gap-3">
            {/* Las observaciones suelen llevar notas internas y datos de
                terceros: no salen salvo que se marque a conciencia. */}
            <label className="flex items-center gap-1.5 text-[12px] text-slate-400">
              <input
                type="checkbox"
                checked={incluirObservaciones}
                onChange={(e) => setIncluirObservaciones(e.target.checked)}
              />
              Enviar observaciones
            </label>
            <button
              onClick={() => void enviar()}
              disabled={busy || !destinoId || (elegido != null && elegido.estado !== "AVAILABLE")}
              className="ml-auto rounded-lg bg-orange-600 px-3 py-2 text-xs font-bold text-white hover:bg-orange-500 disabled:opacity-50"
            >
              {busy ? "Enviando…" : "Subcontratar"}
            </button>
          </div>
        </div>
      )}

      {elegido && elegido.estado !== "AVAILABLE" && (
        <p className="mt-2 text-[12px] text-amber-300">{elegido.mensaje}</p>
      )}

      {/* Las plataformas que NO se pueden usar, con el motivo concreto y el
          nombre de la variable que hay que crear. Sin el nombre, quien lo
          configura tiene que adivinarlo. */}
      {noDisponibles.length > 0 && (
        <div className="mt-3 space-y-1.5">
          {noDisponibles.map((d) => (
            <div key={d.id} className="rounded-lg border border-slate-700 bg-slate-950/40 px-3 py-2 text-[12px]">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold text-slate-300">{d.name}</span>
                <span className={`rounded border px-1.5 text-[10px] font-bold ${
                  d.estado === "DISABLED"
                    ? "border-slate-600 text-slate-400"
                    : "border-amber-500/40 bg-amber-500/10 text-amber-300"
                }`}>
                  {d.estado}
                </span>
                <button
                  onClick={() => void probar(d.id)}
                  disabled={probando === d.id}
                  className="ml-auto text-[11px] text-slate-500 hover:text-orange-400 disabled:opacity-50"
                >
                  {probando === d.id ? "probando…" : "probar conexión"}
                </button>
              </div>
              <div className="text-slate-500">{d.mensaje}</div>
              {d.motivos.length > 0 && (
                <ul className="mt-0.5 list-inside list-disc text-slate-500">
                  {d.motivos.map((m, i) => <li key={i}>{m}</li>)}
                </ul>
              )}
              {d.apiKeyEnvName && d.estado === "MISCONFIGURED" && (
                <div className="mt-0.5 text-slate-500">
                  Variable esperada: <code className="text-slate-400">{d.apiKeyEnvName}</code>
                </div>
              )}
              {d.lastError && <div className="mt-0.5 text-red-300/80">{d.lastError}</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
