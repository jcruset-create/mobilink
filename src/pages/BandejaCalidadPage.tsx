/**
 * Bandeja de calidad: los expedientes abiertos y lo que hay que hacer con ellos.
 *
 * Sigue el patrón de la bandeja de excepciones — barra lateral, filtros arriba,
 * tabla — porque quien la usa ya conoce esa pantalla y no tiene por qué
 * aprender otra.
 *
 * ── El filtrado va en el servidor ───────────────────────────────────────────
 *
 * No se traen todos los casos para filtrarlos aquí. Hoy serían pocos, pero un
 * año de servicio son miles y la pantalla se moriría justo cuando empiece a
 * hacer falta de verdad.
 */

import { useEffect, useMemo, useState } from "react";

import AssistSidebar from "../components/AssistSidebar";
import { API_BASE, getAdminHeaders } from "../modules/workshopApi";
import {
  ACCION_CASO, ESTADO_CASO, EVENTO_CASO, MOTIVO_CASO, MOTIVO_NEGATIVO, PRIORIDAD,
  RESOLUCION_CASO, RESPUESTA, ROL, duracion, etiqueta, tramos,
} from "../modules/satisfaction/etiquetas";

type Fila = {
  id: number; assistanceId: number; creadoEnMs: number;
  clienteNombre: string | null; proveedorNombre: string | null; matricula: string | null;
  originRecipientRole: string | null; valoracion: number | null;
  motivo: string; prioridad: string; estado: string; responsable: string | null;
};

type Bandeja = {
  data: Fila[]; total: number; pagina: number; porPagina: number;
  contadores: { abiertos: number; criticos: number; sinResponsable: number };
};

type Detalle = {
  id: number; assistanceId: number; estado: string; prioridad: string; motivo: string;
  responsable: string | null; resolution: string | null; actionTaken: string | null;
  creadoEnMs: number;
  contexto: {
    clienteNombre: string | null; proveedorNombre: string | null;
    matricula: string | null; descripcion: string | null;
    tiempos: Record<string, number | null>;
  };
  satisfaction: {
    driver: EncuestaDet | null; customer: EncuestaDet | null;
  };
  cronologia: {
    eventType: string; actorNombre: string | null; fromValue: string | null;
    toValue: string | null; note: string | null; occurredAtMs: number;
  }[];
};

type EncuestaDet = {
  estado: string;
  respuesta: {
    overallRating: number | null; professionalRating: number | null;
    speedRating: number | null; trackingRating: number | null;
    resolution: string | null; negativeReasons: string[]; comment: string | null;
  } | null;
};

const fechaCorta = (ms: number) =>
  new Date(ms).toLocaleDateString("es-ES", { day: "2-digit", month: "2-digit", year: "2-digit" });
const fechaHora = (ms: number) =>
  new Date(ms).toLocaleString("es-ES", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

const input = "rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-slate-100";

export default function BandejaCalidadPage() {
  const [bandeja, setBandeja] = useState<Bandeja | null>(null);
  const [filtros, setFiltros] = useState({ estado: "", prioridad: "", motivo: "", rol: "", abiertos: true });
  const [pagina, setPagina] = useState(1);
  const [abierto, setAbierto] = useState<number | null>(() => {
    const q = new URLSearchParams(window.location.search).get("caso");
    return q ? Number(q) : null;
  });
  const [recarga, setRecarga] = useState(0);

  const consulta = useMemo(() => {
    const p = new URLSearchParams();
    if (filtros.estado) p.set("estado", filtros.estado);
    if (filtros.prioridad) p.set("prioridad", filtros.prioridad);
    if (filtros.motivo) p.set("motivo", filtros.motivo);
    if (filtros.rol) p.set("rol", filtros.rol);
    if (filtros.abiertos) p.set("abiertos", "1");
    p.set("pagina", String(pagina));
    return p.toString();
  }, [filtros, pagina]);

  useEffect(() => {
    let vivo = true;
    fetch(`${API_BASE}/api/calidad/casos?${consulta}`, { headers: getAdminHeaders() })
      .then((r) => r.json())
      .then((b) => { if (vivo) setBandeja(b); })
      .catch(() => { if (vivo) setBandeja(null); });
    return () => { vivo = false; };
  }, [consulta, recarga]);

  const total = bandeja?.total ?? 0;
  const paginas = Math.max(1, Math.ceil(total / (bandeja?.porPagina ?? 25)));

  return (
    <div className="flex min-h-screen bg-slate-950 text-slate-100">
      <AssistSidebar active="calidad" />
      <main className="flex-1 overflow-x-auto p-4">
        <header className="mb-4 flex flex-wrap items-center gap-3">
          <h1 className="text-lg font-black">Calidad</h1>
          {bandeja && (
            <div className="flex gap-2 text-xs">
              <Contador texto="abiertos" n={bandeja.contadores.abiertos} />
              <Contador texto="críticos" n={bandeja.contadores.criticos} tono="rojo" />
              <Contador texto="sin responsable" n={bandeja.contadores.sinResponsable} tono="ambar" />
            </div>
          )}
        </header>

        <div className="mb-3 flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-300">
            <input
              type="checkbox" checked={filtros.abiertos}
              onChange={(e) => { setFiltros({ ...filtros, abiertos: e.target.checked }); setPagina(1); }}
            />
            Solo abiertos
          </label>
          <Selector valor={filtros.prioridad} mapa={PRIORIDAD} vacio="Toda prioridad"
                    onCambio={(v) => { setFiltros({ ...filtros, prioridad: v }); setPagina(1); }} />
          <Selector valor={filtros.estado} mapa={ESTADO_CASO} vacio="Todo estado"
                    onCambio={(v) => { setFiltros({ ...filtros, estado: v }); setPagina(1); }} />
          <Selector valor={filtros.motivo} mapa={MOTIVO_CASO} vacio="Todo motivo"
                    onCambio={(v) => { setFiltros({ ...filtros, motivo: v }); setPagina(1); }} />
          <Selector valor={filtros.rol} mapa={ROL} vacio="Conductor y cliente"
                    onCambio={(v) => { setFiltros({ ...filtros, rol: v }); setPagina(1); }} />
        </div>

        <table className="w-full min-w-[900px] text-left text-sm">
          <thead className="text-[11px] uppercase text-slate-500">
            <tr>
              <th className="py-2">Asistencia</th><th>Fecha</th><th>Cliente</th>
              <th>Origen</th><th>Valoración</th><th>Motivo</th><th>Proveedor</th>
              <th>Prioridad</th><th>Estado</th><th>Responsable</th>
            </tr>
          </thead>
          <tbody>
            {(bandeja?.data ?? []).map((f) => (
              <tr
                key={f.id}
                onClick={() => setAbierto(f.id)}
                className="cursor-pointer border-t border-slate-800 hover:bg-slate-900"
              >
                <td className="py-2 font-bold">
                  AST-{f.assistanceId}
                  {f.matricula && <span className="ml-1 text-xs text-slate-500">{f.matricula}</span>}
                </td>
                <td className="text-xs text-slate-400">{fechaCorta(f.creadoEnMs)}</td>
                <td className="text-xs">{f.clienteNombre ?? "—"}</td>
                <td className="text-xs">{etiqueta(ROL, f.originRecipientRole)}</td>
                <td className="text-xs">
                  {f.valoracion != null
                    ? <span className="font-bold text-amber-400">{f.valoracion}/5</span>
                    : "—"}
                </td>
                <td className="text-xs">{etiqueta(MOTIVO_CASO, f.motivo)}</td>
                <td className="text-xs">{f.proveedorNombre ?? "—"}</td>
                <td><ChapaPrioridad valor={f.prioridad} /></td>
                <td><ChapaEstado valor={f.estado} /></td>
                <td className="text-xs">
                  {f.responsable ?? (
                    <span className="font-bold text-amber-400">· Sin asignar</span>
                  )}
                </td>
              </tr>
            ))}
            {bandeja?.data.length === 0 && (
              <tr><td colSpan={10} className="py-8 text-center text-slate-500">
                No hay casos con estos filtros.
              </td></tr>
            )}
          </tbody>
        </table>

        {paginas > 1 && (
          <div className="mt-3 flex items-center gap-2 text-sm">
            <button disabled={pagina <= 1} onClick={() => setPagina((p) => p - 1)}
                    className="rounded border border-slate-700 px-3 py-1 disabled:opacity-30">Anterior</button>
            <span className="text-slate-400">{pagina} / {paginas} · {total} casos</span>
            <button disabled={pagina >= paginas} onClick={() => setPagina((p) => p + 1)}
                    className="rounded border border-slate-700 px-3 py-1 disabled:opacity-30">Siguiente</button>
          </div>
        )}
      </main>

      {abierto != null && (
        <PanelCaso
          casoId={abierto}
          onCerrar={() => setAbierto(null)}
          onCambio={() => setRecarga((n) => n + 1)}
        />
      )}
    </div>
  );
}

/* ── Piezas ──────────────────────────────────────────────────────────────── */

function Contador({ texto, n, tono }: { texto: string; n: number; tono?: "rojo" | "ambar" }) {
  const clase = tono === "rojo" ? "border-red-500/40 bg-red-500/10 text-red-300"
    : tono === "ambar" ? "border-amber-500/40 bg-amber-500/10 text-amber-300"
    : "border-slate-700 text-slate-300";
  return (
    <span className={`rounded-full border px-2 py-0.5 font-bold ${clase}`}>{n} {texto}</span>
  );
}

function Selector({ valor, mapa, vacio, onCambio }: {
  valor: string; mapa: Record<string, string>; vacio: string; onCambio: (v: string) => void;
}) {
  return (
    <select value={valor} onChange={(e) => onCambio(e.target.value)} className={input}>
      <option value="">{vacio}</option>
      {Object.entries(mapa).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
    </select>
  );
}

/** Prioridad con texto e icono, no solo color. */
function ChapaPrioridad({ valor }: { valor: string }) {
  const critico = valor === "CRITICAL";
  const alto = valor === "HIGH";
  const clase = critico ? "border-red-500/50 bg-red-500/15 text-red-200"
    : alto ? "border-amber-500/50 bg-amber-500/15 text-amber-200"
    : "border-slate-700 text-slate-400";
  return (
    <span className={`rounded border px-1.5 py-0.5 text-[10px] font-black ${clase}`}>
      {critico ? "⚠ " : alto ? "▲ " : ""}{etiqueta(PRIORIDAD, valor)}
    </span>
  );
}

function ChapaEstado({ valor }: { valor: string }) {
  const nuevo = valor === "NEW";
  const cerrado = valor === "CLOSED" || valor === "RESOLVED";
  const clase = nuevo ? "border-sky-500/50 bg-sky-500/15 text-sky-200"
    : cerrado ? "border-slate-700 text-slate-500"
    : "border-slate-600 text-slate-300";
  return (
    <span className={`rounded border px-1.5 py-0.5 text-[10px] font-bold ${clase}`}>
      {nuevo ? "● " : ""}{etiqueta(ESTADO_CASO, valor)}
    </span>
  );
}

/* ── Panel de detalle ────────────────────────────────────────────────────── */

function PanelCaso({ casoId, onCerrar, onCambio }: {
  casoId: number; onCerrar: () => void; onCambio: () => void;
}) {
  const [d, setD] = useState<Detalle | null>(null);
  const [nota, setNota] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recarga, setRecarga] = useState(0);
  const [resolucion, setResolucion] = useState("");
  const [accion, setAccion] = useState("");

  useEffect(() => {
    let vivo = true;
    fetch(`${API_BASE}/api/calidad/casos/${casoId}`, { headers: getAdminHeaders() })
      .then((r) => r.json())
      .then((x) => { if (vivo) setD(x); })
      .catch(() => { if (vivo) setD(null); });
    return () => { vivo = false; };
  }, [casoId, recarga]);

  async function accionar(cuerpo: Record<string, unknown>, ruta = "") {
    if (ocupado) return;
    setOcupado(true); setError(null);
    try {
      const r = await fetch(`${API_BASE}/api/calidad/casos/${casoId}${ruta}`, {
        method: ruta ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json", ...getAdminHeaders() },
        body: JSON.stringify(cuerpo),
      });
      const b = await r.json();
      if (!r.ok) { setError(b?.error ?? "No se ha podido guardar."); return; }
      setD(b); setNota(""); setRecarga((n) => n + 1); onCambio();
    } catch {
      setError("No hemos podido guardar el cambio.");
    } finally { setOcupado(false); }
  }

  if (!d) return null;
  const cerrado = d.estado === "CLOSED";
  const tramosReales = tramos(d.contexto.tiempos);

  return (
    <aside className="w-[420px] shrink-0 overflow-y-auto border-l border-slate-800 bg-slate-900 p-4">
      <div className="mb-3 flex items-start justify-between gap-2">
        <div>
          <div className="text-xs text-slate-500">Caso #{d.id}</div>
          <h2 className="text-base font-black">AST-{d.assistanceId}</h2>
          <div className="mt-1 flex flex-wrap gap-1">
            <ChapaPrioridad valor={d.prioridad} />
            <ChapaEstado valor={d.estado} />
          </div>
        </div>
        <button onClick={onCerrar} className="text-slate-500 hover:text-slate-200">✕</button>
      </div>

      <Seccion titulo="Motivo">
        <p className="text-sm">{etiqueta(MOTIVO_CASO, d.motivo)}</p>
        {d.motivo === "VEHICLE_DAMAGE" && (
          // Lo que dice la encuesta es una alegación. Que hubiera daños se
          // decide al cerrar, con DAMAGE_CONFIRMED o DAMAGE_NOT_CONFIRMED.
          <p className="mt-1 text-[11px] italic text-slate-500">
            Es lo que alega quien respondió. Los daños se confirman o se descartan al cerrar el caso.
          </p>
        )}
      </Seccion>

      <Seccion titulo="Contexto">
        <Dato k="Cliente" v={d.contexto.clienteNombre} />
        <Dato k="Proveedor" v={d.contexto.proveedorNombre} />
        <Dato k="Matrícula" v={d.contexto.matricula} />
        <Dato k="Avería" v={d.contexto.descripcion} />
      </Seccion>

      {tramosReales.length > 0 && (
        <Seccion titulo="Tiempos reales">
          {tramosReales.map((t) => (
            <div key={t.etiqueta} className="flex justify-between text-xs">
              <span className="text-slate-500">{t.etiqueta}</span>
              <span className="font-bold">{duracion(t.ms)}</span>
            </div>
          ))}
        </Seccion>
      )}

      <Seccion titulo="Valoraciones">
        <Encuesta rol="DRIVER" e={d.satisfaction.driver} />
        <Encuesta rol="CUSTOMER" e={d.satisfaction.customer} />
      </Seccion>

      {!cerrado && (
        <Seccion titulo="Acciones">
          {error && <p role="alert" className="mb-2 text-xs font-semibold text-amber-300">{error}</p>}
          <div className="mb-2 flex flex-wrap gap-1.5">
            <Boton onClick={() => void accionar({ responsable: "me" })} ocupado={ocupado}>Asignarme</Boton>
            {d.estado === "NEW" && (
              <Boton onClick={() => void accionar({ estado: "IN_REVIEW" })} ocupado={ocupado}>
                Empezar a revisar
              </Boton>
            )}
            {d.estado === "RESOLVED" && (
              <Boton onClick={() => void accionar({ estado: "CLOSED" })} ocupado={ocupado}>Cerrar</Boton>
            )}
          </div>

          <textarea
            value={nota} onChange={(e) => setNota(e.target.value)} rows={2} maxLength={4000}
            placeholder="Nota interna…"
            className={`${input} mb-1.5 w-full`}
          />
          <Boton onClick={() => void accionar({ nota }, "/notas")} ocupado={ocupado || !nota.trim()}>
            Añadir nota
          </Boton>

          {d.estado !== "RESOLVED" && (
            <div className="mt-3 border-t border-slate-800 pt-2">
              <div className="mb-1.5 text-[11px] font-black uppercase text-slate-500">Resolver</div>
              <select value={resolucion} onChange={(e) => setResolucion(e.target.value)}
                      className={`${input} mb-1.5 w-full`}>
                <option value="">¿En qué ha quedado?</option>
                {Object.entries(RESOLUCION_CASO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
              <select value={accion} onChange={(e) => setAccion(e.target.value)}
                      className={`${input} mb-1.5 w-full`}>
                <option value="">Acción tomada (opcional)</option>
                {Object.entries(ACCION_CASO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
              <Boton
                onClick={() => void accionar({
                  estado: "RESOLVED", resolution: resolucion, actionTaken: accion || null, nota,
                })}
                ocupado={ocupado || !resolucion}
              >
                Resolver caso
              </Boton>
            </div>
          )}
        </Seccion>
      )}

      {d.resolution && (
        <Seccion titulo="Conclusión">
          <p className="text-sm">{etiqueta(RESOLUCION_CASO, d.resolution)}</p>
          {d.actionTaken && (
            <p className="text-xs text-slate-400">{etiqueta(ACCION_CASO, d.actionTaken)}</p>
          )}
        </Seccion>
      )}

      <Seccion titulo="Historial">
        <ol className="space-y-2">
          {d.cronologia.map((e, i) => (
            <li key={i} className="border-l-2 border-slate-700 pl-2.5 text-xs">
              <div className="font-bold text-slate-200">{etiqueta(EVENTO_CASO, e.eventType)}</div>
              {(e.fromValue || e.toValue) && (
                <div className="text-slate-500">
                  {e.fromValue ?? "—"} → {e.toValue ?? "—"}
                </div>
              )}
              {e.note && <p className="whitespace-pre-line italic text-slate-400">{e.note}</p>}
              <div className="text-[10px] text-slate-600">
                {e.actorNombre ?? "sistema"} · {fechaHora(e.occurredAtMs)}
              </div>
            </li>
          ))}
        </ol>
      </Seccion>
    </aside>
  );
}

function Seccion({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <section className="mb-4">
      <h3 className="mb-1.5 text-[11px] font-black uppercase tracking-wide text-slate-500">{titulo}</h3>
      {children}
    </section>
  );
}

function Dato({ k, v }: { k: string; v: string | null }) {
  if (!v) return null;
  return (
    <div className="flex justify-between gap-3 text-xs">
      <span className="shrink-0 text-slate-500">{k}</span>
      <span className="text-right text-slate-200">{v}</span>
    </div>
  );
}

function Boton({ children, onClick, ocupado }: {
  children: React.ReactNode; onClick: () => void; ocupado: boolean;
}) {
  return (
    <button
      type="button" onClick={onClick} disabled={ocupado}
      className="rounded-lg border border-slate-600 bg-slate-800 px-3 py-1.5 text-xs font-bold text-slate-100 hover:bg-slate-700 disabled:opacity-40"
    >
      {children}
    </button>
  );
}

function Encuesta({ rol, e }: { rol: string; e: EncuestaDet | null }) {
  if (!e?.respuesta) {
    return (
      <div className="mb-2 text-xs text-slate-500">
        {ROL[rol]}: <span className="italic">sin respuesta</span>
      </div>
    );
  }
  const r = e.respuesta;
  return (
    <div className="mb-2 rounded border border-slate-800 bg-slate-950/50 p-2">
      <div className="mb-1 text-[11px] font-black uppercase text-slate-400">{ROL[rol]}</div>
      <div className="space-y-0.5 text-xs">
        {r.overallRating != null && <Linea k="General" v={`${r.overallRating}/5`} />}
        {r.professionalRating != null && <Linea k="Profesional" v={`${r.professionalRating}/5`} />}
        {r.speedRating != null && <Linea k="Rapidez" v={`${r.speedRating}/5`} />}
        {r.trackingRating != null && <Linea k="Seguimiento" v={`${r.trackingRating}/5`} />}
        {r.resolution && <Linea k="Resuelto" v={etiqueta(RESPUESTA, r.resolution)} />}
      </div>
      {r.negativeReasons.length > 0 && (
        <div className="mt-1 flex flex-wrap gap-1">
          {r.negativeReasons.map((m) => (
            <span key={m} className="rounded border border-amber-500/40 px-1.5 py-0.5 text-[10px] text-amber-300">
              {etiqueta(MOTIVO_NEGATIVO, m)}
            </span>
          ))}
        </div>
      )}
      {r.comment && (
        <p className="mt-1.5 whitespace-pre-line rounded bg-slate-800/60 p-1.5 text-[11px] italic text-slate-300">
          «{r.comment}»
        </p>
      )}
    </div>
  );
}

function Linea({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justifyate-between gap-2">
      <span className="w-24 shrink-0 text-slate-500">{k}</span>
      <span className="font-bold text-slate-200">{v}</span>
    </div>
  );
}
