/**
 * Connect Pro — subcontratar una asistencia a otra plataforma.
 *
 * Es la pantalla que cierra el círculo: hasta ahora el enrutado se podía
 * simular y los acuerdos se podían configurar, pero encargar de verdad desde
 * Central había que hacerlo por API.
 *
 * ── El orden de la pantalla es el orden de la decisión ──────────────────────
 *
 * Primero **a quién** (la sugerencia, con su motivo y los descartados), luego
 * **con qué condiciones** (referencia y tope), y solo entonces el botón. Al
 * revés —el formulario arriba y la sugerencia abajo— se acaba eligiendo por el
 * desplegable sin leer nada, que es exactamente lo que se quería evitar.
 *
 * ── Lo que esta pantalla NO hace ────────────────────────────────────────────
 *
 * No decide. La sugerencia la calcula el servidor con las reglas y los pesos
 * de la central, y aquí solo se enseña —con el motivo y con los descartados,
 * que es lo que permite discutirla—. El operador puede elegir otro destino: la
 * sugerencia es una recomendación, no una orden, y la decisión queda guardada
 * con lo que se propuso y lo que se hizo.
 *
 * Tampoco enseña ningún coste del destino. Lo que se manda es un TOPE
 * autorizado, que es nuestro; lo que a ellos les cueste no es asunto nuestro
 * ni cabe en esta pantalla.
 */

import { useCallback, useEffect, useState } from "react";

import { boFetch } from "../services/api";
import { Card, Badge, Button, Input, ErrorBanner, EmptyState } from "../components/ui";

type Destino = {
  id: number;
  name: string;
  estado: string;
  motivos?: string[];
  capabilities?: string[];
  active?: boolean;
};

type Puntuado = {
  candidato: { authorizationId: number; nombre: string; requierePresupuesto: boolean };
  puntos: number;
  motivo: string;
};

type Sugerencia = {
  modo: string;
  elegido: Puntuado | null;
  candidatos: Puntuado[];
  descartados: { authorizationId: number; nombre: string; motivos: string[] }[];
  exigePresupuesto: boolean;
};

/* Los nombres son los que devuelve `aApi` en `server/dispatch/servicio.ts`. */
type Despacho = {
  id: number;
  status: string;
  destino?: { id: number; nombre?: string | null; plataforma?: string | null };
  referenciaDestino?: string | null;
  correlationId?: string | null;
  lastError?: string | null;
  retryCount?: number;
  sentAtMs?: number | null;
  /** Lo calcula el servidor: no se duplica aquí la regla de qué se reintenta. */
  sePuedeReintentar?: boolean;
  eventos?: { evento: string; occurredAtMs?: number | null }[];
};

/**
 * Los seis estados de un destino, dichos en la lengua del operador.
 *
 * «Cero destinos» y «un destino sin credencial» llevan a sitios distintos
 * —dar de alta uno, o crear una variable en Render— y confundirlos hace perder
 * media hora buscando donde no es.
 */
const ESTADO_DESTINO: Record<string, { texto: string; tono: string; puedeEnviar: boolean }> = {
  AVAILABLE: { texto: "Disponible", tono: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300", puedeEnviar: true },
  MISCONFIGURED: { texto: "Sin credencial configurada", tono: "border-amber-500/40 bg-amber-500/10 text-amber-300", puedeEnviar: false },
  AUTH_ERROR: { texto: "La credencial no vale", tono: "border-red-500/40 bg-red-500/10 text-red-300", puedeEnviar: false },
  UNREACHABLE: { texto: "No responde", tono: "border-red-500/40 bg-red-500/10 text-red-300", puedeEnviar: false },
  DISABLED: { texto: "Desactivado", tono: "border-slate-600 text-slate-400", puedeEnviar: false },
};

const ESTADO_ENVIO: Record<string, { texto: string; tono: string }> = {
  PENDING: { texto: "Pendiente de enviar", tono: "border-slate-600 text-slate-400" },
  SENDING: { texto: "Enviando", tono: "border-sky-500/40 bg-sky-500/10 text-sky-300" },
  SENT: { texto: "Enviada", tono: "border-sky-500/40 bg-sky-500/10 text-sky-300" },
  RECEIVED: { texto: "Recibida", tono: "border-sky-500/40 bg-sky-500/10 text-sky-300" },
  ACCEPTED: { texto: "Aceptada", tono: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300" },
  REJECTED: { texto: "Rechazada", tono: "border-red-500/40 bg-red-500/10 text-red-300" },
  COMPLETED: { texto: "Terminada", tono: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300" },
  CANCELLED: { texto: "Cancelada", tono: "border-slate-600 text-slate-400" },
  ERROR: { texto: "Error de envío", tono: "border-red-500/40 bg-red-500/10 text-red-300" },
};

function cuando(ms?: number | null): string {
  if (!ms) return "";
  return new Date(Number(ms)).toLocaleString("es-ES", {
    day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
  });
}

export default function SubcontratacionTab({ assistanceId, canOperate }: {
  assistanceId: number;
  canOperate: boolean;
}) {
  const [destinos, setDestinos] = useState<Destino[]>([]);
  const [estadoGlobal, setEstadoGlobal] = useState<string>("");
  const [despachos, setDespachos] = useState<Despacho[]>([]);
  const [sugerencia, setSugerencia] = useState<Sugerencia | null>(null);
  const [destinoId, setDestinoId] = useState<number | "">("");
  const [referencia, setReferencia] = useState("");
  const [limite, setLimite] = useState("");
  const [error, setError] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [recarga, setRecarga] = useState(0);

  const refrescar = useCallback(() => setRecarga((n) => n + 1), []);

  useEffect(() => {
    let vivo = true;
    Promise.all([
      boFetch<{ data: Destino[]; estadoGlobal?: string }>("/envios/destinos"),
      boFetch<{ data: Despacho[] }>(`/envios/asistencias/${assistanceId}/despachos`),
    ])
      .then(([d, p]) => {
        if (!vivo) return;
        setDestinos(d.data ?? []);
        setEstadoGlobal(d.estadoGlobal ?? "");
        setDespachos(p.data ?? []);
        setError("");
      })
      .catch((e) => { if (vivo) setError(e.message); });
    return () => { vivo = false; };
  }, [assistanceId, recarga]);

  async function pedirSugerencia() {
    setOcupado(true);
    try {
      const s = await boFetch<Sugerencia>(`/enrutado/asistencias/${assistanceId}/sugerencia`, {
        method: "POST", body: {},
      });
      setSugerencia(s);
      setError("");
    } catch (e: any) { setError(e.message); }
    finally { setOcupado(false); }
  }

  async function subcontratar() {
    if (!destinoId) return;
    setOcupado(true);
    try {
      await boFetch(`/envios/asistencias/${assistanceId}/subcontratar`, {
        method: "POST",
        body: {
          destinationId: destinoId,
          referenciaCliente: referencia.trim() || null,
          limiteAutorizado: limite.trim() === "" ? null : Number(limite),
        },
      });
      setDestinoId(""); setReferencia(""); setLimite("");
      setError("");
      refrescar();
    } catch (e: any) { setError(e.message); }
    finally { setOcupado(false); }
  }

  async function reintentar(id: number) {
    setOcupado(true);
    try {
      await boFetch(`/envios/despachos/${id}/reintentar`, { method: "POST" });
      setError("");
      refrescar();
    } catch (e: any) { setError(e.message); }
    finally { setOcupado(false); }
  }

  const utilizables = destinos.filter(
    (d) => ESTADO_DESTINO[d.estado]?.puedeEnviar && d.active !== false);

  return (
    <div className="space-y-4">
      {error && <ErrorBanner message={error} onClose={() => setError("")} />}

      {/* Sin destinos utilizables no hay nada que hacer aquí, y hay que decir
          exactamente qué falta: no es lo mismo no tener ninguno que tenerlo
          sin credencial. */}
      {destinos.length === 0 ? (
        <Card className="p-4">
          <p className="text-sm font-bold text-slate-200">No hay plataformas de destino dadas de alta.</p>
          <p className="mt-1 text-[13px] text-slate-400">
            Se configuran en Integraciones. Hasta entonces esta asistencia solo se puede
            atender con talleres propios.
          </p>
        </Card>
      ) : utilizables.length === 0 ? (
        <Card className="p-4">
          <p className="text-sm font-bold text-amber-300">
            Hay {destinos.length} plataforma(s), pero ninguna está lista para recibir.
          </p>
          <ul className="mt-2 space-y-1 text-[13px]">
            {destinos.map((d) => (
              <li key={d.id}>
                <span className="text-slate-300">{d.name}</span>
                <span className="text-slate-500"> — {ESTADO_DESTINO[d.estado]?.texto ?? d.estado}</span>
                {d.motivos?.length ? (
                  <span className="text-slate-600">: {d.motivos.join("; ")}</span>
                ) : null}
              </li>
            ))}
          </ul>
        </Card>
      ) : (
        <>
          {/* 1 · A quién */}
          <Card className="p-4">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-bold text-slate-200">¿A quién se manda?</h3>
              <Button variant="ghost" onClick={() => void pedirSugerencia()} disabled={ocupado}>
                {sugerencia ? "Recalcular" : "Pedir sugerencia"}
              </Button>
            </div>

            {!sugerencia ? (
              <p className="text-[13px] text-slate-500">
                La calcula el servidor con los acuerdos, las reglas y los criterios de esta central.
              </p>
            ) : sugerencia.elegido ? (
              <div className="space-y-2">
                <div className="flex flex-wrap items-baseline gap-3">
                  <span className="text-base font-black text-slate-100">
                    {sugerencia.elegido.candidato.nombre}
                  </span>
                  <span className="text-[13px] text-slate-400">{sugerencia.elegido.puntos} puntos</span>
                  <span className="text-[13px] text-slate-500">{sugerencia.elegido.motivo}</span>
                  {sugerencia.exigePresupuesto && (
                    <Badge className="border-violet-500/40 bg-violet-500/10 text-violet-300">
                      hay que pedirle presupuesto antes
                    </Badge>
                  )}
                </div>

                {sugerencia.candidatos.length > 1 && (
                  <div className="text-[12px] text-slate-500">
                    También pueden:{" "}
                    {sugerencia.candidatos.slice(1).map((c) => c.candidato.nombre).join(", ")}
                  </div>
                )}

                {/* Los descartados con su motivo: es lo que permite discutir la
                    sugerencia en vez de aceptarla a ciegas. */}
                {sugerencia.descartados.length > 0 && (
                  <details className="text-[12px]">
                    <summary className="cursor-pointer text-slate-500">
                      {sugerencia.descartados.length} descartado(s) — por qué
                    </summary>
                    <ul className="mt-1 space-y-0.5 pl-3">
                      {sugerencia.descartados.map((d) => (
                        <li key={d.authorizationId}>
                          <span className="text-slate-400">{d.nombre}</span>
                          <span className="text-slate-600"> — {d.motivos.join("; ")}</span>
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </div>
            ) : (
              <div>
                <p className="text-sm font-bold text-red-300">Ningún partner puede hacerse cargo.</p>
                <ul className="mt-1 space-y-0.5 text-[12px]">
                  {sugerencia.descartados.map((d) => (
                    <li key={d.authorizationId}>
                      <span className="text-slate-400">{d.nombre}</span>
                      <span className="text-slate-600"> — {d.motivos.join("; ")}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </Card>

          {/* 2 · Con qué condiciones, y 3 · el botón */}
          {canOperate && (
            <Card className="p-4">
              <h3 className="mb-2 text-sm font-bold text-slate-200">Encargar</h3>
              <div className="flex flex-wrap items-end gap-3">
                <label className="text-[12px] text-slate-400">
                  <div className="mb-1">Plataforma</div>
                  <select
                    value={destinoId}
                    onChange={(e) => setDestinoId(e.target.value === "" ? "" : Number(e.target.value))}
                    className="rounded-lg border border-slate-600 bg-slate-800 px-2 py-1.5 text-sm text-slate-200"
                  >
                    <option value="">Elige…</option>
                    {utilizables.map((d) => (
                      <option key={d.id} value={d.id}>{d.name}</option>
                    ))}
                  </select>
                </label>
                <label className="text-[12px] text-slate-400">
                  <div className="mb-1">Referencia del cliente</div>
                  <Input
                    value={referencia} onChange={(e) => setReferencia(e.target.value)}
                    placeholder="póliza, pedido, autorización"
                  />
                </label>
                <label className="text-[12px] text-slate-400">
                  <div className="mb-1">Tope autorizado (€)</div>
                  <Input
                    value={limite} onChange={(e) => setLimite(e.target.value)}
                    placeholder="sin tope"
                  />
                </label>
                <Button onClick={() => void subcontratar()} disabled={!destinoId || ocupado}>
                  {ocupado ? "Enviando…" : "Subcontratar"}
                </Button>
              </div>
              <p className="mt-2 text-[11px] text-slate-500">
                Sin tope, el destino no puede decidir por su cuenta y tendrá que llamar.
                No se manda ningún dato económico nuestro más que ese tope.
              </p>
            </Card>
          )}
        </>
      )}

      {/* Lo ya enviado */}
      <Card className="p-4">
        <h3 className="mb-2 text-sm font-bold text-slate-200">Envíos</h3>
        {despachos.length === 0 ? (
          <EmptyState message="Esta asistencia no se ha subcontratado." />
        ) : (
          <ul className="space-y-3">
            {despachos.map((d) => {
              const e = ESTADO_ENVIO[d.status] ?? { texto: d.status, tono: "border-slate-600 text-slate-400" };
              return (
                <li key={d.id} className="rounded-lg border border-slate-700 p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge className={e.tono}>{e.texto}</Badge>
                    <span className="font-semibold text-slate-100">{d.destino?.nombre ?? "—"}</span>
                    {/* El expediente del destino es el número por el que hay que
                        preguntar al llamar. No es el nuestro. */}
                    {d.referenciaDestino && (
                      <span className="text-[13px] text-slate-300">
                        expediente allí: <strong>{d.referenciaDestino}</strong>
                      </span>
                    )}
                    <span className="ml-auto text-[11px] text-slate-500">{cuando(d.sentAtMs)}</span>
                  </div>

                  {d.lastError && (
                    <div className="mt-1 text-[12px] text-red-300">
                      {d.lastError}
                      {d.retryCount ? ` · ${d.retryCount} intento(s)` : ""}
                    </div>
                  )}

                  {d.correlationId && (
                    <div className="mt-1 text-[11px] text-slate-600">
                      correlación {d.correlationId}
                    </div>
                  )}

                  {d.eventos && d.eventos.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {d.eventos.map((ev, i) => (
                        <Badge key={i} className="border-slate-700 text-slate-400">
                          {ev.evento} {cuando(ev.occurredAtMs)}
                        </Badge>
                      ))}
                    </div>
                  )}

                  {canOperate && d.sePuedeReintentar && (
                    <div className="mt-2">
                      <Button variant="ghost" onClick={() => void reintentar(d.id)} disabled={ocupado}>
                        Reintentar
                      </Button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {estadoGlobal && estadoGlobal !== "AVAILABLE" && despachos.length > 0 && (
          <p className="mt-2 text-[11px] text-slate-500">
            Estado de las integraciones: {estadoGlobal}
          </p>
        )}
      </Card>
    </div>
  );
}
