/**
 * Ficha de un cliente en las estadísticas de asistencias: sus cifras del
 * periodo comparadas con el anterior, su evolución de los últimos doce meses,
 * los vehículos y los sitios donde más se le atiende, los tiempos, los
 * operarios que le dan servicio y sus últimas asistencias.
 */

import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ArrowLeft, FileText } from "lucide-react";
import AssistSidebar from "../components/AssistSidebar";
import { API_BASE, getAdminHeaders } from "../modules/workshopApi";
import { apiFetch } from "../modules/apiFetch";
import { abrirPdfConSesion } from "../modules/pdfConSesion";
import { etiquetaMes, fmtMin, fmtNum, periodo, RANGOS, type Rango } from "../modules/estadisticasAsist";
import {
  CifrasClave, ControlCalidad, Distancias, Fases, MapaCalor, Tarjeta, TablaOperarios, TiposAveria, type Estadisticas,
} from "../components/estadisticas/Graficos";
import MovimientosFurgonetaModal from "../components/MovimientosFurgonetaModal";
import Matricula from "../components/Matricula";

type Ficha = Estadisticas & {
  cliente: string;
  porMes: { mes: string; asistencias: number; anuladas: number; llegadaMediaMin: number | null }[];
  vehiculos: { matricula: string; asistencias: number }[];
  lugares: { lugar: string; asistencias: number }[];
  ultimas: {
    id: number; createdAtMs: number; plate: string | null; estado: string; tipoAveria: string;
    llegadaMin: number | null; reparacionMin: number | null; kmRecorridos: number | null; valoracion: number | null; operario: string | null;
  }[];
};

const ESTADO: Record<string, string> = {
  llegada_taller: "En taller", cancelada: "Anulada", finalizada: "Finalizada", en_camino_base: "Volviendo",
  redirigida: "Redirigida", pendiente: "Gestionada", asignada: "Asignada", en_camino: "En camino", en_punto: "En punto", inicio_reparacion: "Reparando",
};

export default function EstadisticasClientePage() {
  const navigate = useNavigate();
  const [sp] = useSearchParams();
  const cliente = sp.get("nombre") ?? "";
  const rangoInicial = (sp.get("rango") as Rango) || "anio";
  const [rango, setRango] = useState<Rango>(rangoInicial === "personalizado" ? "personalizado" : rangoInicial);
  const desdeUrl = Number(sp.get("desde"));
  const hastaUrl = Number(sp.get("hasta"));
  const [datos, setDatos] = useState<Ficha | null>(null);
  const [error, setError] = useState("");
  const [recorrido, setRecorrido] = useState<number | null>(null);

  const p = useMemo(() => {
    // El personalizado viene ya calculado de la pantalla general.
    if (rango === "personalizado" && Number.isFinite(desdeUrl) && Number.isFinite(hastaUrl)) return { desdeMs: desdeUrl, hastaMs: hastaUrl };
    return periodo(rango === "personalizado" ? "anio" : rango);
  }, [rango, desdeUrl, hastaUrl]);

  useEffect(() => {
    if (!p || !cliente) return;
    let vivo = true;
    setDatos(null);
    const qs = new URLSearchParams({ cliente, desde: String(p.desdeMs), hasta: String(p.hastaMs) });
    apiFetch(`${API_BASE}/api/roadside-assistances/estadisticas/cliente?${qs}`, { headers: getAdminHeaders() })
      .then(async (r) => {
        const d = await r.json().catch(() => null);
        if (!r.ok) throw new Error(d?.error ?? "Error de servidor");
        if (vivo) { setDatos(d); setError(""); }
      })
      .catch((e) => vivo && setError(e.message));
    return () => { vivo = false; };
  }, [p, cliente]);

  const maxMes = Math.max(1, ...(datos?.porMes ?? []).map((m) => m.asistencias));

  return (
    <div className="flex min-h-screen bg-slate-950 text-slate-100">
      <AssistSidebar active="estadisticas" />
      <main className="min-w-0 flex-1 p-4 pt-16 md:pt-4">
        <div className="mx-auto flex max-w-[1400px] flex-col gap-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="flex flex-col gap-1">
              <button type="button" onClick={() => navigate("/asistencias/estadisticas")} className="inline-flex w-fit items-center gap-1.5 text-sm font-semibold text-sky-300 hover:text-sky-200">
                <ArrowLeft className="h-4 w-4" /> Estadísticas
              </button>
              <div className="text-xs font-bold uppercase tracking-wider text-slate-400">Ficha de cliente</div>
              <h1 className="text-2xl font-black">{cliente || "Sin cliente"}</h1>
              {p && <div className="text-sm text-slate-400">{new Date(p.desdeMs).toLocaleDateString("es-ES")} – {new Date(p.hastaMs).toLocaleDateString("es-ES")}</div>}
            </div>
            <div className="flex flex-wrap gap-2">
              {RANGOS.filter((r) => r.clave !== "personalizado" || rangoInicial === "personalizado").map((r) => (
                <button
                  key={r.clave}
                  type="button"
                  onClick={() => setRango(r.clave)}
                  className={`min-h-[40px] rounded-lg border px-3.5 text-sm font-semibold ${rango === r.clave ? "border-sky-500 bg-sky-600 text-white" : "border-slate-700 bg-slate-900 text-slate-300 hover:bg-slate-800"}`}
                >
                  {r.etiqueta}
                </button>
              ))}
            </div>
          </div>

          {error && <div className="rounded-xl border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-300">{error}</div>}
          {!datos && !error && <div className="p-10 text-center text-slate-400">Calculando…</div>}

          {datos && (
            <>
              <CifrasClave r={datos.resumen} a={datos.anterior} objetivoMin={datos.objetivos.llegadaMin} />

              <div className="flex flex-wrap gap-4">
                <Tarjeta titulo="Evolución de los últimos 12 meses" ayuda="Asistencias al mes · debajo, la llegada media" className="flex-[999_1_560px]">
                  <div className="flex h-44 items-end gap-2 border-b border-slate-700">
                    {datos.porMes.map((m) => (
                      <div key={m.mes} className="flex h-full flex-1 flex-col items-center justify-end gap-1" title={`${etiquetaMes(m.mes)}: ${m.asistencias} asistencias, ${m.anuladas} anuladas`}>
                        <span className="text-xs font-bold">{m.asistencias}</span>
                        <div className="w-full rounded-t-md bg-sky-500" style={{ height: `${(m.asistencias / maxMes) * 80}%` }} />
                      </div>
                    ))}
                  </div>
                  <div className="flex gap-2">
                    {datos.porMes.map((m) => (
                      <div key={m.mes} className="flex-1 text-center text-[11px] text-slate-400">
                        <div>{etiquetaMes(m.mes)}</div>
                        <div className="font-semibold text-slate-300">{fmtMin(m.llegadaMediaMin)}</div>
                      </div>
                    ))}
                  </div>
                </Tarjeta>
                <div className="min-w-0 flex-[1_1_360px]"><Fases fases={datos.fases} /></div>
              </div>

              <div className="flex flex-wrap gap-4">
                <Tarjeta titulo="Vehículos más atendidos" className="flex-[1_1_320px]">
                  <ul className="flex flex-col gap-2">
                    {datos.vehiculos.map((v) => (
                      <li key={v.matricula} className="flex items-center justify-between gap-2 text-sm">
                        <a href={`/vehiculo?plate=${encodeURIComponent(v.matricula)}`} target="_blank" rel="noopener noreferrer" title="Historial del vehículo"><Matricula plate={v.matricula} /></a>
                        <span className="font-bold">{v.asistencias}</span>
                      </li>
                    ))}
                    {datos.vehiculos.length === 0 && <li className="text-sm text-slate-500">Sin matrículas en el periodo</li>}
                  </ul>
                </Tarjeta>
                <Tarjeta titulo="Dónde se le atiende" ayuda="Municipio de la avería" className="flex-[1_1_320px]">
                  <ul className="flex flex-col gap-2">
                    {datos.lugares.map((l) => (
                      <li key={l.lugar} className="flex justify-between gap-2 text-sm"><span className="text-slate-300">{l.lugar}</span><span className="font-bold">{l.asistencias}</span></li>
                    ))}
                    {datos.lugares.length === 0 && <li className="text-sm text-slate-500">Sin direcciones en el periodo</li>}
                  </ul>
                </Tarjeta>
                <div className="min-w-0 flex-[1_1_320px]"><TiposAveria averias={datos.averias} /></div>
              </div>

              <div className="flex flex-wrap gap-4">
                <div className="min-w-0 flex-[999_1_560px]"><MapaCalor franjas={datos.franjas} /></div>
                <div className="min-w-0 flex-[1_1_360px]"><Distancias tramos={datos.distancias} r={datos.resumen} /></div>
              </div>

              <TablaOperarios filas={datos.operarios} objetivoSalirMin={datos.objetivos.salirMin} />

              <Tarjeta titulo="Últimas asistencias" ayuda="Las 25 más recientes del periodo">
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[900px] border-collapse text-sm">
                    <thead>
                      <tr className="text-left text-[11px] font-bold uppercase tracking-wide text-slate-400">
                        <th className="px-2 py-2">#</th><th className="px-2 py-2">Fecha</th><th className="px-2 py-2">Matrícula</th>
                        <th className="px-2 py-2">Estado</th><th className="px-2 py-2">Avería</th><th className="px-2 py-2">Operario</th>
                        <th className="px-2 py-2">Llegada</th><th className="px-2 py-2">Reparación</th><th className="px-2 py-2">Km</th>
                        <th className="px-2 py-2">Valoración</th><th className="px-2 py-2" />
                      </tr>
                    </thead>
                    <tbody>
                      {datos.ultimas.map((a) => (
                        <tr key={a.id} className="border-t border-slate-800 text-slate-200">
                          <td className="px-2 py-2.5">#{a.id}</td>
                          <td className="px-2 py-2.5">{new Date(a.createdAtMs).toLocaleString("es-ES", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" })}</td>
                          <td className="px-2 py-2.5">{a.plate ? <Matricula plate={a.plate} /> : "—"}</td>
                          <td className="px-2 py-2.5">{ESTADO[a.estado] ?? a.estado}</td>
                          <td className="px-2 py-2.5">{a.tipoAveria}</td>
                          <td className="px-2 py-2.5">{a.operario ?? "—"}</td>
                          <td className="px-2 py-2.5">{fmtMin(a.llegadaMin)}</td>
                          <td className="px-2 py-2.5">{fmtMin(a.reparacionMin)}</td>
                          <td className="px-2 py-2.5">{fmtNum(a.kmRecorridos, " km")}</td>
                          <td className="px-2 py-2.5">{a.valoracion ?? "—"}</td>
                          <td className="whitespace-nowrap px-2 py-2.5 text-right">
                            <button
                              type="button"
                              onClick={() => void abrirPdfConSesion(apiFetch, `${API_BASE}/api/roadside-assistances/${a.id}/report.pdf`, `asistencia_${a.id}.pdf`).catch((e) => setError(e?.message ?? "No se pudo abrir"))}
                              className="mr-1 inline-flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-800 px-2 py-1 text-xs font-semibold hover:bg-slate-700"
                            >
                              <FileText className="h-3.5 w-3.5" /> Informe
                            </button>
                            <button type="button" onClick={() => setRecorrido(a.id)} className="rounded-lg border border-sky-500/40 bg-sky-500/15 px-2 py-1 text-xs font-semibold text-sky-300 hover:bg-sky-500/25">
                              Recorrido
                            </button>
                          </td>
                        </tr>
                      ))}
                      {datos.ultimas.length === 0 && (
                        <tr><td colSpan={11} className="px-2 py-6 text-center text-slate-500">Sin asistencias en el periodo</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </Tarjeta>

              <ControlCalidad alertas={datos.alertas} fichas={Object.fromEntries(datos.ultimas.map((a) => [String(a.id), { id: a.id, createdAtMs: a.createdAtMs, cliente: datos.cliente, matricula: a.plate ?? "", operario: a.operario }]))} />
            </>
          )}
        </div>
      </main>
      {recorrido != null && <MovimientosFurgonetaModal assistanceId={recorrido} conTablet onClose={() => setRecorrido(null)} />}
    </div>
  );
}
