/**
 * Connect Pro — salud de la red Mobilink Assist Lite.
 *
 * Reúne lo que hasta ahora no se veía desde ningún sitio: si la API falla, si
 * se están perdiendo posiciones, si los avisos push llegan, qué móviles tienen
 * la cola atascada, qué versiones de la APK hay en la calle y qué servicios en
 * curso llevan rato sin dar señal. Todo agregado: aquí no hay ni un dato de
 * cliente.
 */

import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { boFetch } from "../services/api";
import { PageTitle, Card, KpiCard, Th, Td, Badge, Button, ErrorBanner, EmptyState } from "../components/ui";
import { fmtDateTime } from "../types";

type EndpointStats = {
  endpoint: string; total: number; errores: number; rechazos: number;
  limitados: number; errorRate: number; p50Ms: number | null; p95Ms: number | null;
};

type Health = {
  generadoEnMs: number;
  metricas: {
    ventanaMin: number;
    api: EndpointStats[];
    totales: { peticiones: number; errores: number; rechazos: number; limitados: number };
    posiciones: { recibidas: number; guardadas: number; perdidas: number; perdidaRate: number };
    push: { intentados: number; entregados: number; fallidos: number; tokensInvalidos: number; falloRate: number };
    conflictos: { total: number; porTaller: { workshopId: number; total: number }[] };
  };
  versiones: { version: string; dispositivos: number; ultimoUsoMs: number | null }[];
  colasAtascadas: {
    id: number; deviceId: string; appVersion: string | null;
    queuePending: number | null; queueFailed: number | null;
    queueOldestAtMs: number | null; queueReportedAtMs: number | null;
    userName: string; workshopId: number; workshopName: string;
  }[];
  dispositivosSinPush: number;
  seguimientoMudo: {
    id: number; expedientNumber: string | null; status: string; liteUserName: string | null;
    workshopId: number; workshopName: string; operatorLocationAtMs: number | null;
  }[];
};

function pct(v: number): string {
  return `${(v * 100).toFixed(1)} %`;
}

function hace(ms: number | null): string {
  if (!ms) return "nunca";
  const min = Math.round((Date.now() - ms) / 60000);
  if (min < 1) return "ahora mismo";
  if (min < 60) return `hace ${min} min`;
  const h = Math.round(min / 60);
  return h < 48 ? `hace ${h} h` : `hace ${Math.round(h / 24)} días`;
}

export default function SaludLite() {
  const [d, setD] = useState<Health | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    boFetch<Health>("/lite/health")
      .then(setD)
      .catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    load();
    // La ventana es de una hora: refrescar cada minuto sobra para verlo cambiar.
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, [load]);

  const m = d?.metricas;
  const conProblema = (d?.colasAtascadas.length ?? 0) + (d?.seguimientoMudo.length ?? 0);

  return (
    <div>
      <PageTitle
        title="Salud de Mobilink Assist Lite"
        subtitle={
          d
            ? `Última hora · ${m!.totales.peticiones} peticiones · ${conProblema} avisos abiertos · actualizado ${hace(d.generadoEnMs)}`
            : "Cargando…"
        }
        actions={<Button variant="ghost" onClick={load}>Actualizar</Button>}
      />
      {error && <ErrorBanner message={error} onClose={() => setError(null)} />}

      {m && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 mb-4">
          <KpiCard
            label="Fallos de API (1 h)"
            value={m.totales.errores}
            tone={m.totales.errores > 0 ? "bad" : "ok"}
          />
          <KpiCard
            label="Posiciones descartadas"
            value={`${m.posiciones.perdidas} · ${pct(m.posiciones.perdidaRate)}`}
            tone={m.posiciones.perdidaRate > 0.1 ? "warn" : "ok"}
          />
          <KpiCard
            label="Avisos push fallidos"
            value={m.push.intentados === 0 ? "sin envíos" : `${m.push.fallidos} · ${pct(m.push.falloRate)}`}
            tone={m.push.falloRate > 0.2 ? "bad" : "ok"}
          />
          <KpiCard
            label="Conflictos de estado"
            value={m.conflictos.total}
            tone={m.conflictos.total > 0 ? "warn" : "ok"}
          />
        </div>
      )}

      {/* Lo urgente primero: un móvil con la cola atascada es documentación que
          no va a llegar sola. */}
      <Card className="mb-4">
        <h3 className="px-4 pt-4 pb-2 text-sm font-semibold text-slate-200">
          Colas offline atascadas
        </h3>
        {d && d.colasAtascadas.length === 0 ? (
          <EmptyState message="Ningún dispositivo con evidencias pendientes de subir." />
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr>
                <Th>Taller</Th><Th>Operario</Th><Th>Pendientes</Th><Th>Fallidas</Th>
                <Th>Más antigua</Th><Th>Último parte</Th><Th>Versión</Th>
              </tr>
            </thead>
            <tbody>
              {d?.colasAtascadas.map((c) => (
                <tr key={c.id}>
                  <Td><Link className="text-sky-400 hover:underline" to={`../talleres/${c.workshopId}`}>{c.workshopName}</Link></Td>
                  <Td>{c.userName}</Td>
                  <Td>{c.queuePending ?? 0}</Td>
                  <Td className={c.queueFailed ? "text-red-400" : ""}>{c.queueFailed ?? 0}</Td>
                  <Td>{hace(c.queueOldestAtMs)}</Td>
                  <Td>{hace(c.queueReportedAtMs)}</Td>
                  <Td>{c.appVersion ?? "—"}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Card className="mb-4">
        <h3 className="px-4 pt-4 pb-2 text-sm font-semibold text-slate-200">
          Servicios en curso sin señal de GPS (más de 15 min)
        </h3>
        {d && d.seguimientoMudo.length === 0 ? (
          <EmptyState message="Todos los servicios activos están reportando posición." />
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr><Th>Expediente</Th><Th>Taller</Th><Th>Operario</Th><Th>Estado</Th><Th>Última posición</Th></tr>
            </thead>
            <tbody>
              {d?.seguimientoMudo.map((a) => (
                <tr key={a.id}>
                  <Td><Link className="text-sky-400 hover:underline" to={`../asistencias/${a.id}`}>{a.expedientNumber ?? `#${a.id}`}</Link></Td>
                  <Td>{a.workshopName}</Td>
                  <Td>{a.liteUserName ?? "—"}</Td>
                  <Td>{a.status}</Td>
                  <Td>{hace(a.operatorLocationAtMs)}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <h3 className="px-4 pt-4 pb-2 text-sm font-semibold text-slate-200">
            Versiones de la APK en uso (30 días)
          </h3>
          {d && d.versiones.length === 0 ? (
            <EmptyState message="Ningún dispositivo activo." />
          ) : (
            <table className="w-full text-sm">
              <thead><tr><Th>Versión</Th><Th>Dispositivos</Th><Th>Último uso</Th></tr></thead>
              <tbody>
                {d?.versiones.map((v, i) => (
                  <tr key={v.version}>
                    <Td>
                      {v.version}{" "}
                      {/* La más usada no es necesariamente la última publicada,
                          pero sirve para ver de un vistazo quién se ha quedado atrás. */}
                      {i > 0 && <Badge className="border-amber-500/40 bg-amber-500/10 text-amber-300">anterior</Badge>}
                    </Td>
                    <Td>{v.dispositivos}</Td>
                    <Td>{hace(v.ultimoUsoMs ? Number(v.ultimoUsoMs) : null)}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {d != null && (
            <p className="px-4 pb-4 pt-2 text-xs text-slate-400">
              {d.dispositivosSinPush} dispositivo(s) activos sin token de notificaciones:
              no recibirán avisos de asignación.
            </p>
          )}
        </Card>

        <Card>
          <h3 className="px-4 pt-4 pb-2 text-sm font-semibold text-slate-200">
            API de la APK · última hora
          </h3>
          {m && m.api.length === 0 ? (
            <EmptyState message="Sin tráfico en la última hora." />
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr><Th>Endpoint</Th><Th>Total</Th><Th>Fallos</Th><Th>Frenados</Th><Th>p95</Th></tr>
              </thead>
              <tbody>
                {m?.api.slice(0, 15).map((e) => (
                  <tr key={e.endpoint}>
                    <Td className="font-mono text-xs">{e.endpoint}</Td>
                    <Td>{e.total}</Td>
                    <Td className={e.errores ? "text-red-400" : ""}>{e.errores}</Td>
                    <Td>{e.limitados || "—"}</Td>
                    <Td>{e.p95Ms != null ? `${e.p95Ms} ms` : "—"}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="px-4 pb-4 pt-2 text-xs text-slate-400">
            Los contadores viven en memoria del servidor: un reinicio los pone a
            cero y cada instancia lleva los suyos. Para el histórico está la
            auditoría, que sí es persistente.
          </p>
        </Card>
      </div>

      {d && (
        <p className="mt-4 text-xs text-slate-500">
          Generado {fmtDateTime(d.generadoEnMs)}
        </p>
      )}
    </div>
  );
}
