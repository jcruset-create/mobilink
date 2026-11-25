/**
 * Las piezas de la pantalla de estadísticas de asistencias y de la ficha de
 * cliente: tarjetas de cifras, barras por día, fases, mapa de calor, tramos
 * de distancia, tablas y control de calidad. Solo pintan: los números llegan
 * hechos del servidor (server/assist/estadisticas.ts).
 */

import { useState, type ReactNode } from "react";
import { FileText } from "lucide-react";
import { comparacion, etiquetaDia, fmtMin, fmtNum, intensidad } from "../../modules/estadisticasAsist";
import { API_BASE } from "../../modules/workshopApi";
import { apiFetch } from "../../modules/apiFetch";
import { abrirPdfConSesion } from "../../modules/pdfConSesion";
import MovimientosFurgonetaModal from "../MovimientosFurgonetaModal";

/* ── Tipos de lo que devuelve el servidor ─────────────────────────────── */

export type Resumen = {
  total: number; realizadas: number; anuladas: number;
  llegadaMediaMin: number | null; reparacionMediaMin: number | null; servicioMedioMin: number | null;
  kmMedio: number | null; kmConDato: number; distanciaMediaKm: number | null; distanciaMaxKm: number | null;
  pctLlegadaObjetivo: number | null; valoracionMedia: number | null; encuestas: number;
};
export type Fase = { clave: string; nombre: string; min: number | null; objetivoMin: number | null };
export type Celda = { n: number; llegadaMediaMin: number | null };
export type FilaCliente = {
  cliente: string; asistencias: number; pct: number; llegadaMediaMin: number | null; llegadaLenta: boolean;
  reparacionMediaMin: number | null; kmMedio: number | null; distanciaMediaKm: number | null; anuladas: number;
  remolques: number; valoracionMedia: number | null; encuestas: number;
};
export type FilaOperario = {
  operario: string; furgoneta: string | null; asistencias: number; salidaMediaMin: number | null;
  llegadaMediaMin: number | null; reparacionMediaMin: number | null; kmTotal: number; horasServicio: number | null;
};
export type Alerta = { clave: string; texto: string; nivel: "alto" | "medio" | "bajo"; n: number; ids: number[] };
export type FichaAlerta = { id: number; createdAtMs: number; cliente: string; matricula: string; operario: string | null };

export type Estadisticas = {
  desdeMs: number; hastaMs: number;
  objetivos: { llegadaMin: number; llegadaAlertaMin: number; asignarMin: number; salirMin: number };
  resumen: Resumen; anterior: Resumen;
  porDia: { dia: string; realizadas: number; anuladas: number }[];
  fases: Fase[];
  franjas: { etiquetas: string[]; dias: string[]; celdas: Celda[][] };
  distancias: { tramo: string; n: number; llegadaMediaMin: number | null }[];
  clientes: FilaCliente[];
  operarios: FilaOperario[];
  averias: { tipo: string; asistencias: number; reparacionMediaMin: number | null }[];
  alertas: Alerta[];
  fichas?: Record<string, FichaAlerta>;
};

/* ── Piezas ──────────────────────────────────────────────────────────── */

export function Tarjeta({ titulo, ayuda, children, className = "" }: { titulo: string; ayuda?: string; children: ReactNode; className?: string }) {
  return (
    <section className={`flex min-w-0 flex-col gap-3 rounded-2xl border border-slate-800 bg-slate-900 p-4 ${className}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-base font-bold text-slate-100">{titulo}</h2>
        {ayuda && <span className="text-xs text-slate-400">{ayuda}</span>}
      </div>
      {children}
    </section>
  );
}

const TONO = { bien: "text-emerald-400", mal: "text-red-400", igual: "text-slate-400" };

export function CifrasClave({ r, a, objetivoMin }: { r: Resumen; a: Resumen; objetivoMin: number }) {
  const kpis = [
    { label: "Asistencias", valor: String(r.total), cmp: comparacion(r.total, a.total), ayuda: `${r.realizadas} realizadas · ${r.anuladas} anuladas` },
    { label: "Llegada media", valor: fmtMin(r.llegadaMediaMin), cmp: comparacion(r.llegadaMediaMin, a.llegadaMediaMin, { menosEsMejor: true, unidad: "min" }), ayuda: "De la asignación al «en punto»" },
    { label: "Reparación media", valor: fmtMin(r.reparacionMediaMin), cmp: comparacion(r.reparacionMediaMin, a.reparacionMediaMin, { menosEsMejor: true, unidad: "min" }), ayuda: "Del «en punto» a «finalizada»" },
    { label: "Servicio completo", valor: fmtMin(r.servicioMedioMin), cmp: comparacion(r.servicioMedioMin, a.servicioMedioMin, { menosEsMejor: true, unidad: "min" }), ayuda: "De la llamada a la llegada al taller" },
    { label: "Km por asistencia", valor: fmtNum(r.kmMedio, " km"), cmp: comparacion(r.kmMedio, a.kmMedio, { menosEsMejor: true, unidad: "km" }), ayuda: r.realizadas ? `Ida y vuelta · ${r.kmConDato} de ${r.realizadas} con km` : "Ida y vuelta" },
    { label: `Llegadas en < ${objetivoMin} min`, valor: r.pctLlegadaObjetivo == null ? "—" : `${r.pctLlegadaObjetivo} %`, cmp: comparacion(r.pctLlegadaObjetivo, a.pctLlegadaObjetivo, { unidad: "puntos" }), ayuda: "Del total con hora de llegada" },
    { label: "Valoración cliente", valor: r.valoracionMedia == null ? "—" : fmtNum(r.valoracionMedia), cmp: comparacion(r.valoracionMedia, a.valoracionMedia, { unidad: "puntos" }), ayuda: `${r.encuestas} encuestas respondidas` },
  ];
  return (
    <div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-3">
      {kpis.map((k) => (
        <div key={k.label} className="flex flex-col gap-1.5 rounded-2xl border border-slate-800 bg-slate-900 p-4">
          <div className="text-[11px] font-bold uppercase tracking-wide text-slate-400">{k.label}</div>
          <div className="text-3xl font-black leading-none text-slate-100">{k.valor}</div>
          <div className={`text-xs font-bold ${k.cmp ? TONO[k.cmp.tono] : "text-slate-500"}`}>
            {k.cmp ? `${k.cmp.texto} vs periodo anterior` : "Sin datos para comparar"}
          </div>
          <div className="text-xs text-slate-400">{k.ayuda}</div>
        </div>
      ))}
    </div>
  );
}

export function BarrasPorDia({ dias }: { dias: Estadisticas["porDia"] }) {
  const max = Math.max(1, ...dias.map((d) => d.realizadas + d.anuladas));
  const marcas = dias.length > 1 ? [0, Math.floor((dias.length - 1) / 2), dias.length - 1] : [0];
  return (
    <Tarjeta titulo="Asistencias por día">
      <div className="flex gap-4 text-xs text-slate-300">
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-sky-500" />Realizadas</span>
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-amber-500" />Anuladas</span>
      </div>
      <div className="flex h-48 items-end gap-[3px] border-b border-slate-700 pb-0.5">
        {dias.map((d) => (
          <div
            key={d.dia}
            title={`${etiquetaDia(d.dia)}: ${d.realizadas} realizadas, ${d.anuladas} anuladas`}
            className="flex h-full min-w-0 flex-1 flex-col justify-end"
          >
            <div className="rounded-t-sm bg-amber-500" style={{ height: `${(d.anuladas / max) * 100}%` }} />
            <div className={`bg-sky-500 ${d.anuladas ? "" : "rounded-t-sm"}`} style={{ height: `${(d.realizadas / max) * 100}%` }} />
          </div>
        ))}
      </div>
      <div className="flex justify-between text-[11px] text-slate-400">
        {marcas.map((i) => <span key={i}>{dias[i] ? etiquetaDia(dias[i].dia) : ""}</span>)}
      </div>
    </Tarjeta>
  );
}

const COLOR_FASE: Record<string, string> = {
  asignar: "#64748b", salir: "#a78bfa", trayecto: "#0ea5e9", reparacion: "#f59e0b", vuelta: "#14b8a6",
};

export function Fases({ fases }: { fases: Fase[] }) {
  const con = fases.filter((f) => f.min != null && f.min > 0);
  return (
    <Tarjeta titulo="¿Dónde se va el tiempo?" ayuda="Media de cada fase, de la llamada al taller">
      <div className="flex h-6 overflow-hidden rounded-lg bg-slate-800">
        {con.map((f) => (
          <div key={f.clave} title={`${f.nombre}: ${fmtMin(f.min)}`} style={{ flex: `${f.min} 1 0`, background: COLOR_FASE[f.clave] }} />
        ))}
      </div>
      <ul className="flex flex-col gap-2.5">
        {fases.map((f) => {
          const pasa = f.objetivoMin != null && f.min != null && f.min > f.objetivoMin;
          return (
            <li key={f.clave} className="flex items-center gap-2.5 text-sm">
              <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: COLOR_FASE[f.clave] }} />
              <span className="flex-1 text-slate-300">{f.nombre}</span>
              <span className={`font-bold ${pasa ? "text-orange-400" : "text-slate-100"}`}>{fmtMin(f.min)}</span>
              <span className="w-16 text-right text-xs text-slate-400">{f.objetivoMin != null ? `obj. ${f.objetivoMin}` : ""}</span>
            </li>
          );
        })}
      </ul>
    </Tarjeta>
  );
}

export function MapaCalor({ franjas }: { franjas: Estadisticas["franjas"] }) {
  const max = Math.max(0, ...franjas.celdas.flat().map((c) => c.n));
  return (
    <Tarjeta titulo="Cuándo entran: día y franja horaria" ayuda="Nº de asistencias · debajo, la llegada media">
      <div className="overflow-x-auto">
        <div className="grid min-w-[600px] gap-1 text-[11px]" style={{ gridTemplateColumns: "48px repeat(8, minmax(0, 1fr))" }}>
          <div />
          {franjas.etiquetas.map((e) => <div key={e} className="pb-1 text-center text-slate-400">{e} h</div>)}
          {franjas.celdas.map((fila, d) => (
            <div key={d} className="contents">
              <div className="flex items-center font-semibold text-slate-300">{franjas.dias[d]}</div>
              {fila.map((c, h) => {
                const a = intensidad(c.n, max);
                return (
                  <div
                    key={h}
                    title={`${franjas.dias[d]} ${franjas.etiquetas[h]} h: ${c.n} asistencias${c.llegadaMediaMin != null ? `, llegada media ${fmtMin(c.llegadaMediaMin)}` : ""}`}
                    className="flex h-11 flex-col items-center justify-center rounded-md"
                    style={{ background: c.n ? `rgba(14,165,233,${a.toFixed(2)})` : "rgba(148,163,184,0.06)", color: a > 0.5 ? "#fff" : "#cbd5e1" }}
                  >
                    <span className="text-sm font-black">{c.n || "·"}</span>
                    {c.llegadaMediaMin != null && <span className="text-[10px] opacity-90">{fmtMin(c.llegadaMediaMin)}</span>}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </Tarjeta>
  );
}

export function Distancias({ tramos, r }: { tramos: Estadisticas["distancias"]; r: Resumen }) {
  const max = Math.max(1, ...tramos.map((t) => t.n));
  return (
    <Tarjeta
      titulo="Distancia hasta la avería"
      ayuda={`En línea recta desde la base · media ${fmtNum(r.distanciaMediaKm, " km")} · máx. ${fmtNum(r.distanciaMaxKm, " km")}`}
    >
      <div className="flex h-40 items-end gap-2.5 border-b border-slate-700">
        {tramos.map((t) => (
          <div key={t.tramo} className="flex h-full flex-1 flex-col items-center justify-end gap-1">
            <span className="text-xs font-bold text-slate-100">{t.n}</span>
            <div className="w-full rounded-t-md bg-sky-500" style={{ height: `${(t.n / max) * 80}%` }} />
          </div>
        ))}
      </div>
      <div className="flex gap-2.5">
        {tramos.map((t) => (
          <div key={t.tramo} className="flex-1 text-center text-[11px] text-slate-400">
            <div>{t.tramo}</div>
            <div className="font-semibold text-slate-300">{fmtMin(t.llegadaMediaMin)}</div>
          </div>
        ))}
      </div>
      <div className="text-xs text-slate-400">Debajo de cada tramo, la llegada media.</div>
    </Tarjeta>
  );
}

const th = "px-2 py-2 text-left text-[11px] font-bold uppercase tracking-wide text-slate-400";
const td = "px-2 py-2.5 text-slate-200";

type ColCli = keyof FilaCliente;

export function TablaClientes({ filas, onAbrir }: { filas: FilaCliente[]; onAbrir?: (cliente: string) => void }) {
  const [orden, setOrden] = useState<{ col: ColCli; desc: boolean }>({ col: "asistencias", desc: true });
  const ordenadas = [...filas].sort((a, b) => {
    const x = a[orden.col] ?? -Infinity;
    const y = b[orden.col] ?? -Infinity;
    const c = typeof x === "string" ? String(x).localeCompare(String(y), "es") : Number(x) - Number(y);
    return orden.desc ? -c : c;
  });
  const max = Math.max(1, ...filas.map((f) => f.asistencias));
  const cab = (col: ColCli, texto: string) => (
    <th className={th}>
      <button
        type="button"
        className="font-bold uppercase hover:text-slate-200"
        onClick={() => setOrden((o) => ({ col, desc: o.col === col ? !o.desc : true }))}
      >
        {texto}{orden.col === col ? (orden.desc ? " ▼" : " ▲") : ""}
      </button>
    </th>
  );
  return (
    <Tarjeta titulo="Por cliente" ayuda={onAbrir ? "Pulsa un cliente para ver su ficha · pulsa una columna para ordenar" : undefined}>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[900px] border-collapse text-sm">
          <thead>
            <tr>
              {cab("cliente", "Cliente")}{cab("asistencias", "Asistencias")}{cab("pct", "% del total")}
              {cab("llegadaMediaMin", "Llegada media")}{cab("reparacionMediaMin", "Reparación")}{cab("kmMedio", "Km medios")}
              {cab("distanciaMediaKm", "Distancia")}{cab("anuladas", "Anuladas")}{cab("remolques", "Remolques")}{cab("valoracionMedia", "Valoración")}
            </tr>
          </thead>
          <tbody>
            {ordenadas.map((c) => (
              <tr key={c.cliente} className="border-t border-slate-800">
                <td className={`${td} font-bold`}>
                  {onAbrir ? (
                    <button type="button" onClick={() => onAbrir(c.cliente)} className="text-left font-bold text-sky-300 hover:text-sky-200 hover:underline">
                      {c.cliente}
                    </button>
                  ) : c.cliente}
                </td>
                <td className={td}>{c.asistencias}</td>
                <td className={td}>
                  <div className="flex items-center gap-2">
                    <div className="h-2 w-20 overflow-hidden rounded bg-slate-800"><div className="h-full bg-sky-500" style={{ width: `${(c.asistencias / max) * 100}%` }} /></div>
                    <span>{fmtNum(c.pct, " %")}</span>
                  </div>
                </td>
                <td className={`${td} font-bold ${c.llegadaLenta ? "text-orange-400" : ""}`}>{fmtMin(c.llegadaMediaMin)}</td>
                <td className={td}>{fmtMin(c.reparacionMediaMin)}</td>
                <td className={td}>{fmtNum(c.kmMedio, " km")}</td>
                <td className={td}>{fmtNum(c.distanciaMediaKm, " km")}</td>
                <td className={td}>{c.anuladas}</td>
                <td className={td}>{c.remolques}</td>
                <td className={td}>{c.valoracionMedia == null ? "—" : `${fmtNum(c.valoracionMedia)} (${c.encuestas})`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Tarjeta>
  );
}

export function TablaOperarios({ filas, objetivoSalirMin }: { filas: FilaOperario[]; objetivoSalirMin: number }) {
  return (
    <Tarjeta titulo="Por operario y furgoneta">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[680px] border-collapse text-sm">
          <thead>
            <tr>
              <th className={th}>Operario</th><th className={th}>Furgoneta</th><th className={th}>Asist.</th>
              <th className={th}>Asignar → salir</th><th className={th}>Llegada media</th><th className={th}>Reparación</th>
              <th className={th}>Km totales</th><th className={th}>Horas en servicio</th>
            </tr>
          </thead>
          <tbody>
            {filas.map((o) => (
              <tr key={`${o.operario}|${o.furgoneta}`} className="border-t border-slate-800">
                <td className={`${td} font-bold`}>{o.operario}</td>
                <td className={`${td} text-slate-300`}>{o.furgoneta ?? "—"}</td>
                <td className={td}>{o.asistencias}</td>
                <td className={`${td} ${o.salidaMediaMin != null && o.salidaMediaMin > objetivoSalirMin ? "font-bold text-orange-400" : ""}`}>{fmtMin(o.salidaMediaMin)}</td>
                <td className={td}>{fmtMin(o.llegadaMediaMin)}</td>
                <td className={td}>{fmtMin(o.reparacionMediaMin)}</td>
                <td className={td}>{o.kmTotal ? `${o.kmTotal.toLocaleString("es-ES")} km` : "—"}</td>
                <td className={td}>{fmtNum(o.horasServicio, " h")}</td>
              </tr>
            ))}
            {filas.length === 0 && (
              <tr><td colSpan={8} className="px-2 py-6 text-center text-slate-500">Sin asistencias asignadas en el periodo</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </Tarjeta>
  );
}

export function TiposAveria({ averias }: { averias: Estadisticas["averias"] }) {
  const max = Math.max(1, ...averias.map((a) => a.asistencias));
  return (
    <Tarjeta titulo="Tipo de avería" ayuda="Leído de la descripción · con la reparación media">
      {averias.map((a) => (
        <div key={a.tipo} className="flex flex-col gap-1">
          <div className="flex justify-between text-sm">
            <span className="text-slate-300">{a.tipo}</span>
            <span className="font-bold text-slate-100">{a.asistencias} · {fmtMin(a.reparacionMediaMin)}</span>
          </div>
          <div className="h-2 overflow-hidden rounded bg-slate-800"><div className="h-full bg-sky-500" style={{ width: `${(a.asistencias / max) * 100}%` }} /></div>
        </div>
      ))}
      {averias.length === 0 && <div className="text-sm text-slate-500">Sin asistencias en el periodo</div>}
    </Tarjeta>
  );
}

const BORDE: Record<Alerta["nivel"], string> = { alto: "border-t-red-400 text-red-300", medio: "border-t-orange-400 text-orange-300", bajo: "border-t-amber-300 text-amber-200" };

export function ControlCalidad({ alertas, fichas }: { alertas: Alerta[]; fichas: Record<string, FichaAlerta> }) {
  const [abierta, setAbierta] = useState<string | null>(null);
  const [recorrido, setRecorrido] = useState<number | null>(null);
  const [error, setError] = useState("");
  const sel = alertas.find((a) => a.clave === abierta);
  return (
    <Tarjeta titulo="Control de calidad" ayuda="Pulsa un contador para ver esas asistencias">
      <div className="grid grid-cols-[repeat(auto-fit,minmax(210px,1fr))] gap-2.5">
        {alertas.map((a) => (
          <button
            key={a.clave}
            type="button"
            disabled={a.n === 0}
            onClick={() => setAbierta(abierta === a.clave ? null : a.clave)}
            className={`flex min-h-[44px] flex-col gap-1 rounded-xl border border-slate-800 border-t-[3px] bg-slate-950 p-3.5 text-left disabled:opacity-50 ${BORDE[a.nivel]} ${abierta === a.clave ? "ring-2 ring-sky-500" : ""}`}
          >
            <span className="text-2xl font-black">{a.n}</span>
            <span className="text-sm text-slate-200">{a.texto}</span>
          </button>
        ))}
      </div>
      {error && <div className="rounded-lg border border-red-500/40 bg-red-500/10 p-2 text-sm text-red-300">{error}</div>}
      {sel && (
        <div className="overflow-x-auto rounded-xl border border-slate-800">
          <table className="w-full min-w-[620px] border-collapse text-sm">
            <thead><tr><th className={th}>#</th><th className={th}>Fecha</th><th className={th}>Cliente</th><th className={th}>Matrícula</th><th className={th}>Operario</th><th className={th} /></tr></thead>
            <tbody>
              {sel.ids.map((id) => {
                const f = fichas[String(id)];
                return (
                  <tr key={id} className="border-t border-slate-800">
                    <td className={td}>#{id}</td>
                    <td className={td}>{f ? new Date(f.createdAtMs).toLocaleString("es-ES", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—"}</td>
                    <td className={td}>{f?.cliente ?? "—"}</td>
                    <td className={`${td} font-mono`}>{f?.matricula || "—"}</td>
                    <td className={td}>{f?.operario ?? "—"}</td>
                    <td className={`${td} whitespace-nowrap text-right`}>
                      <button
                        type="button"
                        onClick={() => void abrirPdfConSesion(apiFetch, `${API_BASE}/api/roadside-assistances/${id}/report.pdf`, `asistencia_${id}.pdf`).catch((e) => setError(e?.message ?? "No se pudo abrir"))}
                        className="mr-1 inline-flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-800 px-2 py-1 text-xs font-semibold hover:bg-slate-700"
                      >
                        <FileText className="h-3.5 w-3.5" /> Informe
                      </button>
                      <button
                        type="button"
                        onClick={() => setRecorrido(id)}
                        className="rounded-lg border border-sky-500/40 bg-sky-500/15 px-2 py-1 text-xs font-semibold text-sky-300 hover:bg-sky-500/25"
                      >
                        Recorrido
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {recorrido != null && (
        <MovimientosFurgonetaModal assistanceId={recorrido} conTablet onClose={() => setRecorrido(null)} />
      )}
    </Tarjeta>
  );
}
