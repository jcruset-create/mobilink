/**
 * Cuadro de mando de satisfacción.
 *
 * Pantalla propia y no una pestaña más del panel general: `DashboardPage` son
 * 118 líneas de barras de operación diaria y meterle esto la volvería
 * inmanejable. Aquí manda otra pregunta —«¿qué tal lo estamos haciendo?»— y se
 * mira en otro momento.
 *
 * ── Todo lo agrega el servidor ──────────────────────────────────────────────
 *
 * De `/api/calidad/metricas` llegan cifras ya calculadas. No se traen
 * respuestas ni expedientes para sumarlos en el navegador: un año de servicio
 * son miles de filas y el cálculo se repetiría en cada render.
 *
 * ── Los gráficos son CSS ────────────────────────────────────────────────────
 *
 * Barras con `width` y una línea de columnas, como el resto del panel. Meter
 * una librería de gráficos por cinco distribuciones y una tendencia sería
 * añadir 200 kB al bundle para dibujar rectángulos.
 *
 * ── Y lo que no se puede contar ─────────────────────────────────────────────
 *
 * El servidor devuelve sus propias limitaciones y se pintan al final. El día
 * que exista el campo que falta, desaparecen solas.
 */

import { useEffect, useMemo, useState } from "react";

import AssistSidebar from "../components/AssistSidebar";
import { API_BASE, getAdminHeaders } from "../modules/workshopApi";
import { MOTIVO_NEGATIVO, ROL as ROL_ETIQUETA } from "../modules/satisfaction/etiquetas";
import {
  type Granularidad, type Media, type PuntoTendencia,
  SIN_DATOS, anchosDeBarras, construirSerie, distribucionCompleta, etiquetaPeriodo,
  formatearDuracion, formatearEntero, formatearMedia, formatearPct, muestraSuficiente,
  textoDanos, textoMuestra, textoPorCada100, textoTasaRespuesta,
} from "../modules/satisfaction/formatoMetricas";

/* ── Lo que devuelve el endpoint ─────────────────────────────────────────── */

type MetricasRol = {
  overall: Media; professional: Media | null; speed: Media | null; tracking: Media | null;
  resolucion: { si: number; parcial: number; no: number; siPct: number | null;
                parcialPct: number | null; noPct: number | null };
  negativasPct: number | null; conComentario: number;
  distribucion: { estrella: number; n: number; pct: number }[];
};

type Metricas = {
  periodo: { desdeMs: number; hastaMs: number; dias: number };
  resumen: {
    asistenciasFinalizadas: number; encuestasGeneradas: number; respuestas: number;
    tasaRespuestaPct: number | null;
    envio: { hayEntregas: boolean; entregadas: number; motivo: string | null };
    casosAbiertos: number; casosCriticos: number;
  };
  driver: MetricasRol;
  customer: MetricasRol;
  calidad: {
    creados: number; abiertos: number; resueltos: number; cerrados: number;
    criticos: number; altos: number;
    porMotivo: { motivo: string; n: number }[];
    porResolucion: { resolution: string; n: number }[];
    porAccion: { actionTaken: string; n: number }[];
    danos: { alegados: number; confirmados: number; descartados: number; sinCerrar: number };
    tiempos: { hastaResolverMs: number | null; hastaCerrarMs: number | null;
               resueltos: number; cerrados: number };
    porCada100Respuestas: number | null; porCada100Asistencias: number | null;
  };
  motivosNegativos: { motivo: string; n: number; pctSobreRespuestas: number | null }[];
  tendencia: { granularidad: Granularidad; puntos: PuntoTendencia[] };
  proveedores: {
    proveedorId: number | null; nombre: string | null; asistencias: number;
    respuestasDriver: number; satisfaccionDriver: number | null; resolucionSiPct: number | null;
    casos: number; criticos: number; casosPor100: number | null; suficiente: boolean;
  }[];
  clientes: {
    clienteId: number | null; nombre: string | null; asistencias: number;
    respuestasCustomer: number; satisfaccionCustomer: number | null;
    respuestasDriver: number; satisfaccionDriver: number | null;
    casos: number; casosPor100: number | null;
  }[];
  franjas: { franja: string; asistencias: number; driver: Media }[];
  limitaciones: string[];
};

/* ── Piezas ──────────────────────────────────────────────────────────────── */

function Bloque({ titulo, nota, children }: {
  titulo: string; nota?: string | null; children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
      <h2 className="text-sm font-black uppercase tracking-wide text-slate-300">{titulo}</h2>
      {nota && <p className="mt-1 text-[11px] text-slate-500">{nota}</p>}
      <div className="mt-3">{children}</div>
    </section>
  );
}

function Kpi({ titulo, valor, pie, tono }: {
  titulo: string; valor: string; pie?: string | null; tono?: "rojo" | "ambar";
}) {
  const color = tono === "rojo" ? "text-rose-300" : tono === "ambar" ? "text-amber-300" : "text-slate-100";
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-3">
      <div className="text-[11px] uppercase tracking-wide text-slate-500">{titulo}</div>
      <div className={`mt-1 text-2xl font-black ${valor === SIN_DATOS ? "text-slate-500" : color}`}>
        {valor}
      </div>
      {pie && <div className="mt-1 text-[11px] leading-snug text-slate-500">{pie}</div>}
    </div>
  );
}

/** Una barra horizontal. El ancho es relativo al mayor de su grupo. */
function Barra({ etiqueta, valor, ancho, tono = "bg-sky-500" }: {
  etiqueta: string; valor: string; ancho: number; tono?: string;
}) {
  return (
    <div className="flex items-center gap-2 py-0.5 text-xs">
      <div className="w-40 shrink-0 truncate text-slate-400" title={etiqueta}>{etiqueta}</div>
      <div className="h-2.5 flex-1 rounded bg-slate-800">
        <div className={`h-2.5 rounded ${tono}`} style={{ width: `${ancho}%` }} />
      </div>
      <div className="w-24 shrink-0 text-right tabular-nums text-slate-300">{valor}</div>
    </div>
  );
}

function ListaBarras({ filas, tono }: {
  filas: { etiqueta: string; n: number; valor: string }[]; tono?: string;
}) {
  const anchos = anchosDeBarras(filas.map((f) => f.n));
  if (!filas.length) return <p className="text-xs text-slate-500">{SIN_DATOS}</p>;
  return (
    <div>
      {filas.map((f, i) => (
        <Barra key={f.etiqueta} etiqueta={f.etiqueta} valor={f.valor} ancho={anchos[i]} tono={tono} />
      ))}
    </div>
  );
}

/** La ficha de un rol: media, muestra, distribución y resolución. */
function PanelRol({ titulo, m }: { titulo: string; m: MetricasRol }) {
  const dist = distribucionCompleta(m.distribucion);
  const anchos = anchosDeBarras(dist.map((f) => f.n));
  const corta = m.overall.respuestas > 0 && !muestraSuficiente(m.overall);
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-black text-slate-200">{titulo}</h3>
        <span className="text-[11px] text-slate-500">{textoMuestra(m.overall)}</span>
      </div>
      <div className="mt-1 flex items-baseline gap-2">
        <span className={`text-3xl font-black ${m.overall.media == null ? "text-slate-500" : "text-slate-100"}`}>
          {formatearMedia(m.overall)}
        </span>
        {m.overall.media != null && <span className="text-sm text-slate-500">★</span>}
      </div>
      {corta && (
        <p className="mt-1 text-[11px] text-amber-400">
          Muestra pequeña: todavía no da para sacar conclusiones.
        </p>
      )}

      <div className="mt-3 space-y-0.5">
        {dist.map((f, i) => (
          <Barra
            key={f.estrella} etiqueta={`${f.estrella} ★`}
            valor={`${formatearEntero(f.n)} · ${formatearPct(f.pct)}`}
            ancho={anchos[i]}
            tono={f.estrella >= 4 ? "bg-emerald-500" : f.estrella === 3 ? "bg-amber-500" : "bg-rose-500"}
          />
        ))}
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
        <Dato k="Profesionalidad" v={formatearMedia(m.professional)} />
        <Dato k="Rapidez" v={formatearMedia(m.speed)} />
        <Dato k="Seguimiento" v={formatearMedia(m.tracking)} />
        <Dato k="Con comentario" v={formatearEntero(m.conComentario)} />
        <Dato k="Resolvió" v={formatearPct(m.resolucion.siPct)} />
        <Dato k="No resolvió" v={formatearPct(m.resolucion.noPct)} />
        <Dato k="Parcial" v={formatearPct(m.resolucion.parcialPct)} />
        <Dato k="Valoraciones negativas" v={formatearPct(m.negativasPct)} />
      </dl>
    </div>
  );
}

function Dato({ k, v }: { k: string; v: string }) {
  return (
    <>
      <dt className="text-slate-500">{k}</dt>
      <dd className={`text-right tabular-nums ${v === SIN_DATOS ? "text-slate-600" : "text-slate-200"}`}>{v}</dd>
    </>
  );
}

/**
 * La tendencia, en columnas.
 *
 * Escala fija de 1 a 5 (la decide `construirSerie`) y hueco donde no hubo
 * respuestas. Una columna a ras de suelo significa 1 ★; la ausencia se ve
 * porque no hay columna.
 */
function Tendencia({ puntos, granularidad }: {
  puntos: PuntoTendencia[]; granularidad: Granularidad;
}) {
  const driver = construirSerie(puntos, "driver", granularidad);
  const customer = construirSerie(puntos, "customer", granularidad);
  if (!driver.length) return <p className="text-xs text-slate-500">{SIN_DATOS}</p>;

  return (
    <div className="overflow-x-auto">
      <div className="flex min-w-max items-end gap-1" style={{ height: 140 }}>
        {driver.map((p, i) => (
          <div key={p.desdeMs} className="flex w-10 shrink-0 flex-col items-center justify-end gap-0.5">
            <div className="flex h-full w-full items-end justify-center gap-0.5">
              <Columna p={p} tono="bg-sky-500" rol="Conductor" />
              <Columna p={customer[i]} tono="bg-violet-500" rol="Cliente" />
            </div>
          </div>
        ))}
      </div>
      <div className="mt-1 flex min-w-max gap-1">
        {driver.map((p) => (
          <div key={p.desdeMs} className="w-10 shrink-0 text-center text-[9px] leading-tight text-slate-500">
            {p.etiqueta}
          </div>
        ))}
      </div>
      <div className="mt-2 flex gap-4 text-[11px] text-slate-400">
        <Leyenda tono="bg-sky-500" texto="Conductor" />
        <Leyenda tono="bg-violet-500" texto="Cliente" />
        <span className="text-slate-600">Escala 1–5 ★. Sin columna = sin respuestas ese tramo.</span>
      </div>
    </div>
  );
}

function Columna({ p, tono, rol }: {
  p: { valor: number | null; altura: number; respuestas: number; etiqueta: string } | undefined;
  tono: string; rol: string;
}) {
  if (!p || p.valor == null) return <div className="w-3" />;
  return (
    <div
      className={`w-3 rounded-t ${tono}`}
      // Un mínimo de 3 px para que un 1 ★ se vea: si no, sería idéntico a un hueco.
      style={{ height: `${Math.max(3, p.altura)}%` }}
      title={`${rol} · ${p.etiqueta}: ${p.valor.toFixed(2).replace(".", ",")} ★ (${p.respuestas})`}
    />
  );
}

function Leyenda({ tono, texto }: { tono: string; texto: string }) {
  return <span className="flex items-center gap-1"><i className={`h-2 w-2 rounded-sm ${tono}`} />{texto}</span>;
}

/* ── Pantalla ────────────────────────────────────────────────────────────── */

const DIA = 86_400_000;
const RANGOS: { texto: string; dias: number }[] = [
  { texto: "7 días", dias: 7 }, { texto: "30 días", dias: 30 },
  { texto: "90 días", dias: 90 }, { texto: "1 año", dias: 365 },
];

const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export default function SatisfaccionPage() {
  const [dias, setDias] = useState(30);
  const [m, setM] = useState<Metricas | null>(null);
  const [error, setError] = useState<string | null>(null);
  // El «hoy» se congela al montar: leer el reloj en cada render haría impura la
  // consulta y la recalcularía sola cada milisegundo.
  const [hoyMs] = useState(() => Date.now());

  const consulta = useMemo(() => {
    const p = new URLSearchParams();
    p.set("from", iso(hoyMs - dias * DIA));
    p.set("to", iso(hoyMs));
    return p.toString();
  }, [dias, hoyMs]);

  useEffect(() => {
    let vivo = true;
    fetch(`${API_BASE}/api/calidad/metricas?${consulta}`, { headers: getAdminHeaders() })
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j?.error || "No se han podido cargar las métricas");
        return j as Metricas;
      })
      .then((j) => { if (vivo) { setM(j); setError(null); } })
      .catch((e) => { if (vivo) { setM(null); setError((e as Error).message); } });
    return () => { vivo = false; };
  }, [consulta]);

  // Nada de un indicador de carga en estado: mientras llega el periodo nuevo se
  // dejan las cifras anteriores en pantalla, que es menos brusco que vaciarla.
  const cargando = m === null && error === null;

  const tasa = textoTasaRespuesta(m?.resumen.tasaRespuestaPct, m?.resumen.envio);

  return (
    <div className="flex min-h-screen bg-slate-950 text-slate-100">
      <AssistSidebar active="satisfaccion" />
      <main className="flex-1 overflow-x-auto p-4">
        <header className="mb-4 flex flex-wrap items-center gap-3">
          <h1 className="text-lg font-black">Satisfacción</h1>
          {m && (
            <span className="text-xs text-slate-500">
              {etiquetaPeriodo(m.periodo.desdeMs, m.periodo.hastaMs)}
            </span>
          )}
          <div className="ml-auto flex gap-1">
            {RANGOS.map((r) => (
              <button
                key={r.dias} onClick={() => setDias(r.dias)}
                className={`rounded-lg px-2.5 py-1 text-xs font-semibold ${
                  dias === r.dias ? "bg-sky-600 text-white" : "bg-slate-800 text-slate-300 hover:bg-slate-700"
                }`}
              >{r.texto}</button>
            ))}
          </div>
        </header>

        {error && (
          <p className="rounded-lg border border-rose-900 bg-rose-950/40 p-3 text-sm text-rose-200">{error}</p>
        )}
        {cargando && !m && <p className="text-sm text-slate-500">Cargando…</p>}

        {m && (
          <div className="space-y-4">
            {/* 1 · La fila de KPIs */}
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">
              <Kpi titulo="Asistencias finalizadas" valor={formatearEntero(m.resumen.asistenciasFinalizadas)} />
              <Kpi titulo="Encuestas generadas" valor={formatearEntero(m.resumen.encuestasGeneradas)} />
              <Kpi titulo="Respuestas" valor={formatearEntero(m.resumen.respuestas)} />
              <Kpi titulo="Tasa de respuesta" valor={tasa.valor} pie={tasa.nota} />
              <Kpi titulo="Satisfacción conductor" valor={formatearMedia(m.driver.overall)}
                   pie={textoMuestra(m.driver.overall) || null} />
              <Kpi titulo="Satisfacción cliente" valor={formatearMedia(m.customer.overall)}
                   pie={textoMuestra(m.customer.overall) || null} />
              <Kpi titulo="Expedientes abiertos" valor={formatearEntero(m.resumen.casosAbiertos)} tono="ambar" />
              <Kpi titulo="Críticos" valor={formatearEntero(m.resumen.casosCriticos)} tono="rojo" />
            </div>

            {/* 2 · La tendencia */}
            <Bloque
              titulo="Evolución"
              nota={`Agrupado por ${m.tendencia.granularidad === "dia" ? "día"
                : m.tendencia.granularidad === "semana" ? "semana" : "mes"}. Conductor y cliente por separado: son dos poblaciones distintas y mezclarlas daría una media que no describe a ninguna.`}
            >
              <Tendencia puntos={m.tendencia.puntos} granularidad={m.tendencia.granularidad} />
            </Bloque>

            {/* 3 · Las distribuciones, un panel por rol */}
            <div className="grid gap-4 lg:grid-cols-2">
              <PanelRol titulo={ROL_ETIQUETA.DRIVER ?? "Conductor"} m={m.driver} />
              <PanelRol titulo={ROL_ETIQUETA.CUSTOMER ?? "Cliente"} m={m.customer} />
            </div>

            {/* 4 · Por qué se valora mal */}
            <Bloque
              titulo="Motivos de las valoraciones negativas"
              nota="Selección múltiple: los porcentajes son sobre respuestas y pueden sumar más de 100 %."
            >
              <ListaBarras
                tono="bg-rose-500"
                filas={m.motivosNegativos.map((x) => ({
                  etiqueta: MOTIVO_NEGATIVO[x.motivo] ?? x.motivo,
                  n: x.n,
                  valor: `${formatearEntero(x.n)} · ${formatearPct(x.pctSobreRespuestas)}`,
                }))}
              />
            </Bloque>

            {/* 5 · Proveedores */}
            <Bloque
              titulo="Proveedores"
              nota="Solo la valoración del conductor. Lo que opina el cliente de su seguro o de su factura no es mérito ni culpa del taller que fue a la carretera."
            >
              <Tabla
                cabeceras={["Proveedor", "Asistencias", "Respuestas", "Satisfacción", "Resolvió", "Expedientes", "Por 100"]}
                filas={m.proveedores.map((p) => [
                  <span className="flex items-center gap-1.5">
                    {p.nombre ?? "Sin proveedor"}
                    {!p.suficiente && (
                      <span className="rounded bg-slate-800 px-1 text-[9px] uppercase text-amber-400" title="Menos de 5 respuestas: no comparable">
                        pocas
                      </span>
                    )}
                  </span>,
                  formatearEntero(p.asistencias),
                  formatearEntero(p.respuestasDriver),
                  formatearMedia({ media: p.satisfaccionDriver, respuestas: p.respuestasDriver }),
                  formatearPct(p.resolucionSiPct),
                  `${formatearEntero(p.casos)}${p.criticos ? ` (${p.criticos} crít.)` : ""}`,
                  p.casosPor100 == null ? SIN_DATOS : p.casosPor100.toFixed(1).replace(".", ","),
                ])}
              />
            </Bloque>

            {/* 6 · Clientes y expedientes */}
            <div className="grid gap-4 xl:grid-cols-2">
              <Bloque titulo="Clientes">
                <Tabla
                  cabeceras={["Cliente", "Asistencias", "Cliente ★", "Conductor ★", "Expedientes"]}
                  filas={m.clientes.map((c) => [
                    c.nombre ?? "Sin cliente",
                    formatearEntero(c.asistencias),
                    formatearMedia({ media: c.satisfaccionCustomer, respuestas: c.respuestasCustomer }),
                    formatearMedia({ media: c.satisfaccionDriver, respuestas: c.respuestasDriver }),
                    formatearEntero(c.casos),
                  ])}
                />
              </Bloque>

              <Bloque
                titulo="Expedientes de calidad"
                nota={[
                  textoPorCada100(m.calidad.porCada100Respuestas, "respuestas"),
                  textoPorCada100(m.calidad.porCada100Asistencias, "asistencias"),
                ].filter((t) => t !== SIN_DATOS).join(" · ") || null}
              >
                <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                  <Dato k="Creados" v={formatearEntero(m.calidad.creados)} />
                  <Dato k="Abiertos" v={formatearEntero(m.calidad.abiertos)} />
                  <Dato k="Resueltos" v={formatearEntero(m.calidad.resueltos)} />
                  <Dato k="Cerrados" v={formatearEntero(m.calidad.cerrados)} />
                  <Dato k="Críticos" v={formatearEntero(m.calidad.criticos)} />
                  <Dato k="Altos" v={formatearEntero(m.calidad.altos)} />
                  <Dato k="Tiempo hasta resolver" v={formatearDuracion(m.calidad.tiempos.hastaResolverMs)} />
                  <Dato k="Tiempo hasta cerrar" v={formatearDuracion(m.calidad.tiempos.hastaCerrarMs)} />
                </dl>

                <h3 className="mt-4 text-[11px] uppercase tracking-wide text-slate-500">Daños</h3>
                <dl className="mt-1 grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                  {textoDanos(m.calidad.danos).map((f) => <Dato key={f.etiqueta} k={f.etiqueta} v={f.valor} />)}
                </dl>
                <p className="mt-1 text-[11px] text-slate-600">
                  «Alegados» es lo que dijo quien contestó; «confirmados» es lo que decidió un
                  supervisor al cerrar el expediente. No son el mismo número.
                </p>
              </Bloque>
            </div>

            {/* 7 · Franjas horarias */}
            <Bloque titulo="Por franja horaria" nota="Por hora de la solicitud. Esto separa, no explica: que la nota baje de madrugada puede ser el turno, el tipo de avería o la hora en sí.">
              <ListaBarras
                filas={m.franjas.map((f) => ({
                  etiqueta: f.franja,
                  n: f.asistencias,
                  valor: `${formatearEntero(f.asistencias)} · ${formatearMedia(f.driver)} ★`,
                }))}
              />
            </Bloque>

            {m.limitaciones.length > 0 && (
              <section className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
                <h2 className="text-[11px] uppercase tracking-wide text-slate-500">Lo que todavía no se puede segmentar</h2>
                <ul className="mt-2 space-y-1 text-[11px] leading-relaxed text-slate-500">
                  {m.limitaciones.map((t) => <li key={t}>· {t}</li>)}
                </ul>
              </section>
            )}
          </div>
        )}
      </main>
    </div>
  );
}

function Tabla({ cabeceras, filas }: { cabeceras: string[]; filas: React.ReactNode[][] }) {
  if (!filas.length) return <p className="text-xs text-slate-500">{SIN_DATOS}</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[560px] text-left text-xs">
        <thead className="text-[10px] uppercase text-slate-500">
          <tr>{cabeceras.map((c, i) => (
            <th key={c} className={`py-1.5 ${i ? "text-right" : ""}`}>{c}</th>
          ))}</tr>
        </thead>
        <tbody>
          {filas.map((f, i) => (
            <tr key={i} className="border-t border-slate-800">
              {f.map((celda, j) => (
                <td key={j} className={`py-1.5 ${j ? "text-right tabular-nums text-slate-300" : "text-slate-200"}`}>
                  {celda}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
