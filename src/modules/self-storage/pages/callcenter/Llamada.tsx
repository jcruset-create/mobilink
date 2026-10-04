/**
 * Call Center → pantalla de la llamada. Pensada para registrar una llamada en
 * 20–30 segundos: teléfono → ficha automática → motivo → un botón de
 * resultado. La puede usar una persona, una supervisora o, más adelante, la
 * IA (por la misma API).
 *
 *   /call-center/llamada       alta: teléfono, sentido, idioma, motivo
 *   /call-center/llamada/:id   la llamada: ficha mínima, centro, enlaces,
 *                              disponibilidad, resumen y acciones rápidas
 *
 * «El Call Center informa y ayuda; la web vende»: los enlaces de la web, la
 * calculadora y la contratación están a mano, y la disponibilidad sale de
 * Mobilink en tiempo real, sin precios.
 */

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import * as api from "../../services/api";
import {
  CALL_DIRECTIONS,
  INCIDENT_TYPES,
  PRIORITIES,
  URGENT_INCIDENT_TYPES,
  type CallDirection,
  type DisponibilidadCentro,
  type EntradaCatalogo,
  type EstadoCallCenter,
  type Identificacion,
  type IncidentType,
  type InfoCentroCallCenter,
  type LlamadaDetalle,
  type Priority,
} from "../../types";
import {
  Aviso,
  Cabecera,
  Cargando,
  CheckField,
  ErrorBox,
  Modal,
  Pill,
  SelectField,
  TextAreaField,
  TextField,
  btnDanger,
  btnMini,
  btnPrimary,
  btnSecondary,
  fechaHora,
  msgError,
} from "../../components/ui";
import { useSelfStorage } from "../../contexts/SelfStorageContext";
import { ChipLlamada, ChipPrioridad, SiCallCenterActivo } from "./comun";
import { IDIOMAS, duracion, etqIdioma } from "./formato";

const Caja = ({ titulo, children, accion }: { titulo: string; children: ReactNode; accion?: ReactNode }) => (
  <section className="rounded-xl border border-slate-700 bg-slate-800 p-3">
    <div className="mb-2 flex items-center justify-between gap-2">
      <h2 className="text-[11px] font-bold uppercase tracking-wide text-slate-400">{titulo}</h2>
      {accion}
    </div>
    {children}
  </section>
);

/** Ficha mínima de quien llama: cliente(s), persona autorizada o interesado. */
function FichaLlamante({ ident, elegido, onElegir }: { ident: Identificacion | null; elegido?: string | null; onElegir?: (customerId: string) => void }) {
  const { etqCliente, etqContrato, etqEstadoLlamada } = useSelfStorage();
  if (!ident) return <p className="text-[12px] text-slate-500">Escribe el teléfono para identificar a quien llama.</p>;
  return (
    <div className="space-y-2 text-[13px]">
      {ident.interested ? (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-2 text-amber-100">
          <b>Interesado</b> · no es cliente{ident.phone ? ` (${ident.phone})` : ""}. No se crea ninguna ficha por llamar.
        </div>
      ) : (
        ident.matches.map((m) => (
          <div key={m.customerId} className={`rounded-lg border p-2 ${elegido === m.customerId ? "border-orange-500 bg-orange-500/10" : "border-slate-700 bg-slate-900"}`}>
            <div className="flex flex-wrap items-center justify-between gap-1">
              <span className="font-bold">{m.name}</span>
              <span className="flex flex-wrap gap-1">
                <Pill className="bg-slate-700 text-slate-200">{etqCliente(m.status)}</Pill>
                {m.accessBlocked && <Pill className="bg-rose-500/20 text-rose-300">Acceso bloqueado</Pill>}
                {m.hasPendingPayments && <Pill className="bg-amber-500/20 text-amber-300">Pagos pendientes</Pill>}
                {m.openIncidents > 0 && <Pill className="bg-rose-500/20 text-rose-300">{m.openIncidents} incidencia(s) abiertas</Pill>}
              </span>
            </div>
            {m.match === "authorized_person" && <div className="text-[12px] text-sky-300">Llama {m.matchedPersonName}, persona autorizada de sus contratos.</div>}
            <ul className="mt-1 space-y-0.5 text-[12px] text-slate-300">
              {m.contracts.map((k) => (
                <li key={k.id}>
                  {k.contractNumber} · trastero {k.unitCode}
                  {k.zoneName ? ` (${k.zoneName})` : ""} · {k.centerName} · {etqContrato(k.status)}
                </li>
              ))}
              {m.contracts.length === 0 && <li className="text-slate-500">Sin contratos.</li>}
            </ul>
            {onElegir && ident.matches.length > 1 && elegido !== m.customerId && (
              <button className={`${btnMini} mt-1`} onClick={() => onElegir(m.customerId)}>
                Es esta persona
              </button>
            )}
          </div>
        ))
      )}
      {ident.previousCalls.length > 0 && (
        <div>
          <div className="text-[11px] font-semibold uppercase text-slate-500">Llamadas anteriores de este número</div>
          <ul className="text-[12px] text-slate-400">
            {ident.previousCalls.slice(0, 5).map((c) => (
              <li key={c.id}>
                <Link className="underline" to={`/self-storage/call-center/llamada/${c.id}`}>
                  {fechaHora(c.startedAt)}
                </Link>{" "}
                · {c.reasonCode ?? "—"} · {etqEstadoLlamada(c.status)}
                {c.summary ? ` · ${c.summary.slice(0, 80)}` : ""}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// ── Alta ────────────────────────────────────────────────────────────────────

function NuevaLlamada() {
  const nav = useNavigate();
  const { centros, centroId, etqSentido } = useSelfStorage();
  const [phone, setPhone] = useState("");
  const [callerName, setCallerName] = useState("");
  const [direction, setDirection] = useState<CallDirection>("incoming");
  const [language, setLanguage] = useState("es");
  const [reasonCode, setReasonCode] = useState("");
  const [centerId, setCenterId] = useState(centroId ?? "");
  const [ident, setIdent] = useState<Identificacion | null>(null);
  const [catalogo, setCatalogo] = useState<EntradaCatalogo[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    api.catalogoLlamadas().then(setCatalogo, (e) => setError(msgError(e)));
  }, []);
  const identificar = useCallback(async () => {
    if (phone.replace(/\D/g, "").length < 6) return setIdent(null);
    try {
      setIdent(await api.identificarTelefono(phone));
    } catch (e) {
      setError(msgError(e));
    }
  }, [phone]);

  const empezar = async () => {
    setEnviando(true);
    try {
      const l = await api.crearLlamada({
        phone: phone.trim() || null,
        callerName: callerName.trim() || null,
        direction,
        language,
        reasonCode: reasonCode || null,
        centerId: centerId || null,
        answered: true,
      });
      nav(`/self-storage/call-center/llamada/${l.id}`, { replace: true });
    } catch (e) {
      setError(msgError(e));
      setEnviando(false);
    }
  };
  const motivos = catalogo.filter((c) => c.kind === "reason" && c.active);

  return (
    <div className="space-y-3">
      <Cabecera titulo="Nueva llamada" descripcion="Teléfono, motivo y empezar. La ficha de quien llama aparece sola." />
      {error && <ErrorBox>{error}</ErrorBox>}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <Caja titulo="Llamada">
          <div className="space-y-2">
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <label className="block text-[12px] text-slate-300">
                Teléfono
                <input
                  autoFocus
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  onBlur={() => void identificar()}
                  onKeyDown={(e) => e.key === "Enter" && void identificar()}
                  placeholder="600 000 000 · vacío si es oculto"
                  className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-lg tracking-wide outline-none focus:ring-2 focus:ring-orange-500"
                />
              </label>
              <TextField label="Nombre (si no es cliente)" value={callerName} onChange={setCallerName} />
            </div>
            <div className="flex flex-wrap gap-1 text-[12px]">
              {CALL_DIRECTIONS.map((d) => (
                <button key={d} className={`rounded-lg px-3 py-1.5 ${direction === d ? "bg-orange-600 text-white" : "bg-slate-700 text-slate-300"}`} onClick={() => setDirection(d)}>
                  {etqSentido(d)}
                </button>
              ))}
              <span className="mx-1" />
              {IDIOMAS.map((i) => (
                <button key={i.code} className={`rounded-lg px-3 py-1.5 ${language === i.code ? "bg-orange-600 text-white" : "bg-slate-700 text-slate-300"}`} onClick={() => setLanguage(i.code)}>
                  {i.label}
                </button>
              ))}
            </div>
            <div>
              <div className="mb-1 text-[12px] text-slate-300">Motivo</div>
              <div className="flex flex-wrap gap-1">
                {motivos.map((m) => (
                  <button
                    key={m.id}
                    className={`rounded-lg px-2 py-1 text-[12px] ${reasonCode === m.code ? "bg-orange-600 text-white" : "bg-slate-700 text-slate-300 hover:bg-slate-600"}`}
                    onClick={() => setReasonCode(reasonCode === m.code ? "" : m.code)}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
            </div>
            {centros.length > 1 && (
              <SelectField label="Centro" value={centerId} onChange={setCenterId}>
                <option value="">— El de la configuración —</option>
                {centros.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </SelectField>
            )}
            <button className={`${btnPrimary} w-full py-3`} disabled={enviando} onClick={() => void empezar()}>
              {enviando ? "Registrando…" : "Empezar llamada"}
            </button>
          </div>
        </Caja>
        <Caja titulo="Quién llama">
          <FichaLlamante ident={ident} />
        </Caja>
      </div>
    </div>
  );
}

// ── La llamada ──────────────────────────────────────────────────────────────

type Dialogo = null | "incidencia" | "escalar" | "seguimiento";

function LaLlamada({ id, estado }: { id: string; estado: EstadoCallCenter }) {
  const { puede, etqAtendida, etqSentido, etqPrioridad } = useSelfStorage();
  const [l, setL] = useState<LlamadaDetalle | null>(null);
  const [ident, setIdent] = useState<Identificacion | null>(null);
  const [centro, setCentro] = useState<InfoCentroCallCenter | null>(null);
  const [disp, setDisp] = useState<DisponibilidadCentro | null>(null);
  const [catalogo, setCatalogo] = useState<EntradaCatalogo[]>([]);
  const [borrador, setBorrador] = useState({ summary: "", notes: "", callerName: "" });
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [dialogo, setDialogo] = useState<Dialogo>(null);
  const [ocupado, setOcupado] = useState(false);

  const cargar = useCallback(async () => {
    try {
      const x = await api.llamada(id);
      setL(x);
      setBorrador({ summary: x.summary ?? "", notes: x.notes ?? "", callerName: x.callerName ?? "" });
      setError(null);
      if (x.phone) api.identificarTelefono(x.phone).then(setIdent, () => {});
      else setIdent({ phone: null, interested: true, matches: [], previousCalls: [] });
      api.infoCentroCallCenter(x.centerId).then(setCentro, () => setCentro(null));
    } catch (e) {
      setError(msgError(e));
    }
  }, [id]);
  useEffect(() => {
    void cargar();
    api.catalogoLlamadas().then(setCatalogo, () => {});
  }, [cargar]);

  const accion = async (fn: () => Promise<LlamadaDetalle | unknown>, ok?: string) => {
    setOcupado(true);
    try {
      await fn();
      if (ok) setAviso(ok);
      await cargar();
    } catch (e) {
      setError(msgError(e));
    } finally {
      setOcupado(false);
    }
  };
  if (error && !l) return <ErrorBox>{error}</ErrorBox>;
  if (!l) return <Cargando />;

  const editable = l.status !== "closed" && puede("ss.callcenter.edit");
  const activos = catalogo.filter((c) => c.active);
  const motivos = activos.filter((c) => c.kind === "reason");
  const resultados = activos.filter((c) => c.kind === "result");
  const hay = (code: string) => resultados.some((r) => r.code === code);
  const textos = () => ({ summary: borrador.summary.trim() || null, notes: borrador.notes.trim() || null });
  const resultado = (resultCode: string, extra: Record<string, unknown> = {}) =>
    accion(() => api.resultadoLlamada(l.id, { resultCode, ...textos(), ...extra }), `Resultado: ${resultados.find((r) => r.code === resultCode)?.label ?? resultCode}.`);
  const guardarTexto = (campo: "summary" | "notes" | "callerName") => {
    const v = borrador[campo].trim() || null;
    if (v === (l[campo] ?? null)) return;
    void accion(() => api.editarLlamada(l.id, { [campo]: v }));
  };
  const enlaces = centro?.links ?? estado.links;

  const RAPIDAS: [string, string][] = [
    ["resuelto", "Marcar resuelta"],
    ["enviado_web", "Enviar a la web"],
    ["enviado_calculadora", "Enviar a calculadora"],
    ["enviado_contratacion", "Enviar a contratación online"],
    ["visita_virtual_solicitada", "Solicitar visita virtual"],
    ["visita_guiada_solicitada", "Solicitar visita guiada"],
  ];

  return (
    <div className="space-y-3">
      <Cabecera
        titulo={l.customerName ?? l.callerName ?? (l.phone ? `Interesado ${l.phone}` : "Número oculto")}
        descripcion={`${etqSentido(l.direction)} · ${fechaHora(l.startedAt)} · ${etqAtendida(l.handledBy)}${l.operatorName ? ` (${l.operatorName})` : ""} · ${l.centerName ?? "sin centro"}`}
      >
        <ChipLlamada estado={l.status} />
        <ChipPrioridad p={l.priority} />
        <Link className={btnSecondary} to="/self-storage/call-center/llamadas">
          Volver
        </Link>
      </Cabecera>
      {error && <ErrorBox>{error}</ErrorBox>}
      {aviso && <Aviso tono="bien">{aviso}</Aviso>}
      {l.status === "escalated" && (
        <Aviso tono="mal">
          <b>Escalada</b> {fechaHora(l.escalatedAt)}: {l.escalationReason}
          {l.summary && <div className="mt-1">Resumen hasta ahora: {l.summary}</div>}
        </Aviso>
      )}
      {l.followUpAt && !l.followUpDoneAt && (
        <Aviso tono="aviso">
          Seguimiento pendiente para el {fechaHora(l.followUpAt)}.{" "}
          {editable || puede("ss.callcenter.edit") ? (
            <button className={btnMini} disabled={ocupado} onClick={() => void accion(() => api.seguimientoLlamada(l.id, { done: true, notes: textos().notes }), "Seguimiento hecho: llamada cerrada.")}>
              Seguimiento hecho
            </button>
          ) : null}
        </Aviso>
      )}

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <div className="space-y-3">
          <Caja titulo={`Quién llama · ${l.phone ?? l.phoneRaw ?? "número oculto"}`}>
            <FichaLlamante ident={ident} elegido={l.customerId} onElegir={editable ? (c) => void accion(() => api.editarLlamada(l.id, { customerId: c })) : undefined} />
          </Caja>
          <Caja titulo="Centro y enlaces">
            {centro ? (
              <div className="space-y-1 text-[13px]">
                <div className="font-bold">{enlaces.brandName ?? centro.name}</div>
                <div className="text-slate-300">
                  {[centro.address, [centro.postalCode, centro.city].filter(Boolean).join(" ")].filter(Boolean).join(", ") || "Sin dirección"}
                </div>
                <div className="flex flex-wrap gap-1 pt-1">
                  {(
                    [
                      ["Web", enlaces.web],
                      ["Calculadora de espacio", enlaces.calculator],
                      ["Contratación online", enlaces.contracting],
                      ["Visita virtual", enlaces.virtualVisit],
                    ] as const
                  ).map(([t, u]) =>
                    u ? (
                      <a key={t} href={u} target="_blank" rel="noreferrer" className={btnMini} title={u}>
                        {t} ↗
                      </a>
                    ) : null
                  )}
                  {!enlaces.web && <span className="text-[12px] text-slate-500">Sin enlaces configurados (Configuración del Call Center).</span>}
                </div>
              </div>
            ) : (
              <p className="text-[12px] text-slate-500">La llamada no tiene centro.</p>
            )}
          </Caja>
          {l.centerId && (
            <Caja
              titulo="Disponibilidad (ahora, sin precios)"
              accion={
                <button className={btnMini} onClick={() => api.disponibilidadCentro(l.centerId!).then(setDisp, (e) => setError(msgError(e)))}>
                  {disp ? "Actualizar" : "Consultar"}
                </button>
              }
            >
              {disp ? (
                <div className="space-y-1 text-[13px]">
                  {disp.types.length === 0 && <p className="text-slate-500">El centro no tiene tipos de trastero.</p>}
                  {disp.types.map((t) => (
                    <div key={t.unitTypeId} className="flex items-center justify-between">
                      <span>
                        {t.name} <span className="text-[11px] text-slate-500">({t.areaM2} m²)</span>
                      </span>
                      {t.available ? <Pill className="bg-emerald-500/20 text-emerald-300">Hay disponibilidad</Pill> : <Pill className="bg-slate-700 text-slate-300">Sin disponibilidad ahora</Pill>}
                    </div>
                  ))}
                  <p className="pt-1 text-[11px] text-slate-400">{disp.notice}</p>
                </div>
              ) : (
                <p className="text-[12px] text-slate-500">Se consulta en Mobilink en el momento. Precio y contratación, siempre en la web.</p>
              )}
            </Caja>
          )}
        </div>

        <div className="space-y-3">
          <Caja titulo="Atención">
            <div className="space-y-2">
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                <SelectField label="Motivo" value={l.reasonCode ?? ""} onChange={(v) => editable && void accion(() => api.editarLlamada(l.id, { reasonCode: v || null }))}>
                  <option value="">— Sin motivo —</option>
                  {motivos.map((m) => (
                    <option key={m.id} value={m.code}>
                      {m.label}
                    </option>
                  ))}
                  {l.reasonCode && !motivos.some((m) => m.code === l.reasonCode) && <option value={l.reasonCode}>{l.reasonLabel ?? l.reasonCode}</option>}
                </SelectField>
                <SelectField label="Idioma" value={l.language ?? ""} onChange={(v) => editable && void accion(() => api.editarLlamada(l.id, { language: v || null }))}>
                  <option value="">—</option>
                  {IDIOMAS.map((i) => (
                    <option key={i.code} value={i.code}>
                      {i.label}
                    </option>
                  ))}
                  {l.language && !IDIOMAS.some((i) => i.code === l.language) && <option value={l.language}>{etqIdioma(l.language)}</option>}
                </SelectField>
                <SelectField label="Prioridad" value={l.priority} onChange={(v) => editable && void accion(() => api.editarLlamada(l.id, { priority: v as Priority }))}>
                  {PRIORITIES.map((p) => (
                    <option key={p} value={p}>
                      {etqPrioridad(p)}
                    </option>
                  ))}
                </SelectField>
              </div>
              {!l.customerId && (
                <label className="block text-[12px] text-slate-300">
                  Nombre de quien llama
                  <input
                    disabled={!editable}
                    value={borrador.callerName}
                    onChange={(e) => setBorrador((b) => ({ ...b, callerName: e.target.value }))}
                    onBlur={() => guardarTexto("callerName")}
                    className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-orange-500"
                  />
                </label>
              )}
              <label className="block text-[12px] text-slate-300">
                Resumen
                <textarea
                  disabled={!editable}
                  rows={3}
                  value={borrador.summary}
                  onChange={(e) => setBorrador((b) => ({ ...b, summary: e.target.value }))}
                  onBlur={() => guardarTexto("summary")}
                  placeholder="Qué quería y qué se le ha dicho"
                  className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-orange-500"
                />
              </label>
              <label className="block text-[12px] text-slate-300">
                Observaciones
                <textarea
                  disabled={!editable}
                  rows={2}
                  value={borrador.notes}
                  onChange={(e) => setBorrador((b) => ({ ...b, notes: e.target.value }))}
                  onBlur={() => guardarTexto("notes")}
                  className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-orange-500"
                />
              </label>
            </div>
          </Caja>

          {editable && (
            <Caja titulo="Acciones rápidas">
              <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
                {RAPIDAS.filter(([c]) => hay(c)).map(([c, t]) => (
                  <button key={c} className={c === "resuelto" ? btnPrimary : btnSecondary} disabled={ocupado} onClick={() => void resultado(c)}>
                    {t}
                  </button>
                ))}
                {puede("ss.incidents.create") && (
                  <button className={btnSecondary} disabled={ocupado} onClick={() => setDialogo("incidencia")}>
                    Crear incidencia
                  </button>
                )}
                {puede("ss.callcenter.escalate") && l.status !== "escalated" && (
                  <button className={btnDanger} disabled={ocupado} onClick={() => setDialogo("escalar")}>
                    Escalar a la empresa
                  </button>
                )}
                <button className={btnSecondary} disabled={ocupado} onClick={() => setDialogo("seguimiento")}>
                  Marcar seguimiento
                </button>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-[12px]">
                <select
                  className="rounded-lg border border-slate-600 bg-slate-900 px-2 py-1"
                  value=""
                  disabled={ocupado}
                  onChange={(e) => e.target.value && void resultado(e.target.value)}
                  aria-label="Otro resultado"
                >
                  <option value="">Otro resultado…</option>
                  {resultados.map((r) => (
                    <option key={r.id} value={r.code}>
                      {r.label}
                    </option>
                  ))}
                </select>
                {!l.endedAt && (
                  <button className={btnMini} disabled={ocupado} onClick={() => void accion(() => api.finalizarLlamada(l.id), "Llamada terminada.")}>
                    Colgar sin resultado
                  </button>
                )}
                {l.status !== "closed" && l.endedAt && (
                  <button className={btnMini} disabled={ocupado} onClick={() => void accion(() => api.cerrarLlamada(l.id), "Llamada cerrada.")}>
                    Cerrar
                  </button>
                )}
              </div>
            </Caja>
          )}

          {l.incidents.length > 0 && (
            <Caja titulo="Incidencias de esta llamada">
              <ul className="space-y-1 text-[13px]">
                {l.incidents.map((n) => (
                  <li key={n.id} className="flex items-center justify-between gap-2">
                    <Link className="underline" to={`/self-storage/incidencias?id=${n.id}`}>
                      {n.title}
                    </Link>
                    <ChipPrioridad p={n.priority} />
                  </li>
                ))}
              </ul>
            </Caja>
          )}

          <Caja titulo={`Cronología · ${duracion(l.durationSeconds)}${l.resultLabel ? ` · ${l.resultLabel}` : ""}`}>
            <ol className="space-y-1 text-[12px]">
              {l.events.map((e) => (
                <li key={e.id} className="flex gap-2">
                  <span className="whitespace-nowrap text-slate-500">{fechaHora(e.occurredAt)}</span>
                  <span className="text-slate-300">
                    {NOMBRE_EVENTO[e.eventType] ?? e.eventType}
                    {e.actorName ? ` · ${e.actorName}` : ""}
                    {typeof e.data?.reason === "string" ? ` · ${e.data.reason}` : ""}
                  </span>
                </li>
              ))}
            </ol>
            {l.transcript && (
              <details className="mt-2 text-[12px] text-slate-300">
                <summary className="cursor-pointer text-slate-400">Transcripción</summary>
                <pre className="mt-1 whitespace-pre-wrap font-sans">{l.transcript}</pre>
              </details>
            )}
          </Caja>
        </div>
      </div>

      {dialogo === "incidencia" && (
        <NuevaIncidencia
          l={l}
          conResultado={hay("incidencia_creada") && editable}
          onCerrar={() => setDialogo(null)}
          onHecho={async (conResultado) => {
            setDialogo(null);
            if (conResultado) await resultado("incidencia_creada");
            else await accion(async () => undefined, "Incidencia creada.");
          }}
        />
      )}
      {dialogo === "escalar" && (
        <Escalar
          resumen={borrador.summary}
          onCerrar={() => setDialogo(null)}
          onAceptar={(reason, summary) => {
            setDialogo(null);
            void accion(() => api.escalarLlamada(l.id, { reason, summary: summary || null }), "Llamada escalada a la empresa.");
          }}
        />
      )}
      {dialogo === "seguimiento" && (
        <Seguimiento
          onCerrar={() => setDialogo(null)}
          onAceptar={(cuando) => {
            setDialogo(null);
            const followUpAt = cuando ? new Date(cuando).toISOString() : null;
            if (hay("requiere_seguimiento")) void resultado("requiere_seguimiento", { followUpAt });
            else void accion(() => api.seguimientoLlamada(l.id, { followUpAt }), "Seguimiento programado.");
          }}
        />
      )}
    </div>
  );
}

const NOMBRE_EVENTO: Record<string, string> = {
  created: "Registrada",
  answered: "Contestada",
  updated: "Datos actualizados",
  customer_linked: "Vinculada a la ficha del cliente",
  result_set: "Resultado registrado",
  escalated: "Escalada",
  follow_up_scheduled: "Seguimiento programado",
  follow_up_done: "Seguimiento hecho",
  incident_created: "Incidencia creada",
  finished: "Terminada",
  closed: "Cerrada",
};

function NuevaIncidencia({ l, conResultado, onCerrar, onHecho }: { l: LlamadaDetalle; conResultado: boolean; onCerrar: () => void; onHecho: (conResultado: boolean) => void }) {
  const { centros, etqTipoIncidencia } = useSelfStorage();
  const [tipo, setTipo] = useState<IncidentType>("no_access");
  const [titulo, setTitulo] = useState("");
  const [desc, setDesc] = useState(l.summary ?? "");
  const [centerId, setCenterId] = useState(l.centerId ?? "");
  const [cerrar, setCerrar] = useState(conResultado);
  const [error, setError] = useState<string | null>(null);
  const urgente = URGENT_INCIDENT_TYPES.includes(tipo);
  const crear = async () => {
    try {
      await api.incidenciaDesdeLlamada(l.id, { centerId, incidentType: tipo, title: titulo.trim() || etqTipoIncidencia(tipo), description: desc.trim() || null });
      onHecho(cerrar);
    } catch (e) {
      setError(msgError(e));
    }
  };
  return (
    <Modal
      title="Crear incidencia"
      onClose={onCerrar}
      footer={
        <div className="flex justify-end gap-2">
          <button className={btnSecondary} onClick={onCerrar}>
            Cancelar
          </button>
          <button className={btnPrimary} disabled={!centerId} onClick={() => void crear()}>
            Crear
          </button>
        </div>
      }
    >
      <div className="space-y-2">
        <SelectField label="Tipo" value={tipo} onChange={(v) => setTipo(v as IncidentType)}>
          {INCIDENT_TYPES.map((t) => (
            <option key={t} value={t}>
              {etqTipoIncidencia(t)}
              {URGENT_INCIDENT_TYPES.includes(t) ? " (urgente)" : ""}
            </option>
          ))}
        </SelectField>
        {urgente && <Aviso tono="mal">Urgente: acceso, seguridad, emergencia o fallo grave. Se avisa con prioridad máxima.</Aviso>}
        <SelectField label="Centro" value={centerId} onChange={setCenterId}>
          <option value="">— Elige —</option>
          {centros.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </SelectField>
        <TextField label="Título" value={titulo} onChange={setTitulo} placeholder={etqTipoIncidencia(tipo)} />
        <TextAreaField label="Descripción" value={desc} onChange={setDesc} rows={3} />
        <p className="text-[12px] text-slate-400">Queda enlazada a esta llamada{l.customerName ? `, a ${l.customerName}` : ""}{l.contractNumber ? ` y al contrato ${l.contractNumber}` : ""}.</p>
        {conResultado && <CheckField label="Registrar el resultado «Incidencia creada» y cerrar la llamada" checked={cerrar} onChange={setCerrar} />}
        {error && <ErrorBox>{error}</ErrorBox>}
      </div>
    </Modal>
  );
}

function Escalar({ resumen, onCerrar, onAceptar }: { resumen: string; onCerrar: () => void; onAceptar: (motivo: string, resumen: string) => void }) {
  const [motivo, setMotivo] = useState("");
  const [r, setR] = useState(resumen);
  const MOTIVOS = ["Pide hablar con una persona de la empresa", "Reclamación compleja", "Problema de acceso", "Posible fraude", "Consulta fuera de lo que sabemos", "Acción no autorizada desde el teléfono"];
  return (
    <Modal
      title="Escalar a la empresa"
      onClose={onCerrar}
      footer={
        <div className="flex justify-end gap-2">
          <button className={btnSecondary} onClick={onCerrar}>
            Cancelar
          </button>
          <button className={btnDanger} disabled={!motivo.trim()} onClick={() => onAceptar(motivo.trim(), r.trim())}>
            Escalar
          </button>
        </div>
      }
    >
      <div className="space-y-2">
        <div className="flex flex-wrap gap-1">
          {MOTIVOS.map((m) => (
            <button key={m} className={`rounded-lg px-2 py-1 text-[12px] ${motivo === m ? "bg-orange-600 text-white" : "bg-slate-700 text-slate-300"}`} onClick={() => setMotivo(m)}>
              {m}
            </button>
          ))}
        </div>
        <TextField label="Motivo" value={motivo} onChange={setMotivo} />
        <TextAreaField label="Resumen para quien la recoja" value={r} onChange={setR} rows={4} />
      </div>
    </Modal>
  );
}

function Seguimiento({ onCerrar, onAceptar }: { onCerrar: () => void; onAceptar: (cuando: string) => void }) {
  const [cuando, setCuando] = useState(() => {
    const manana = new Date(Date.now() + 24 * 3600_000);
    return new Date(manana.getTime() - manana.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
  });
  return (
    <Modal
      title="Marcar seguimiento"
      onClose={onCerrar}
      footer={
        <div className="flex justify-end gap-2">
          <button className={btnSecondary} onClick={onCerrar}>
            Cancelar
          </button>
          <button className={btnPrimary} onClick={() => onAceptar(cuando)}>
            Guardar
          </button>
        </div>
      }
    >
      <TextField label="Cuándo" type="datetime-local" value={cuando} onChange={setCuando} />
    </Modal>
  );
}

export default function Llamada() {
  const { id } = useParams();
  return <SiCallCenterActivo>{(e) => (id ? <LaLlamada key={id} id={id} estado={e} /> : <NuevaLlamada />)}</SiCallCenterActivo>;
}
