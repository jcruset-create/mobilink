import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Download, Gauge, RefreshCw, TriangleAlert } from "lucide-react";
import { kmDeFlota, rellenarKilometraje, type KmDeFlota, type MesDeFlota } from "../services/kilometrajeMensual";
import { listarEmpresas } from "../services/data";
import type { Empresa } from "../types";
import KmActualFlota from "../components/KmActualFlota";

/**
 * Km recorridos por TODA la flota, por meses y por años.
 *
 * Solo suma lo AUTÉNTICO: meses cerrados (pedidos después de acabar) y
 * coherentes con el odómetro, de vehículos activos. Lo provisional, lo
 * descartado y lo que no tiene dato se enseña aparte, sin sumar. La regla y
 * los números salen del backend (`server/tyrecontrol/kilometrajeMensual/flota.ts`);
 * aquí no se suma nada que no venga ya separado.
 *
 * La empresa y el año viven en la URL, como en «Kilómetros por vehículo».
 */

const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const MESES_CORTOS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const num = (n: number | null | undefined) => (n == null ? "—" : Math.round(n).toLocaleString("es-ES"));
const nombreMes = (m: { month: number }) => MESES[m.month - 1];

const ESTADO: Record<MesDeFlota["estado"], { texto: string; clase: string }> = {
  cerrado: { texto: "Cerrado", clase: "bg-emerald-500/15 text-emerald-300" },
  incompleto: { texto: "Incompleto", clase: "bg-amber-500/15 text-amber-300" },
  en_curso: { texto: "En curso", clase: "bg-sky-500/15 text-sky-300" },
};

export default function KmFlota() {
  const [params, setParams] = useSearchParams();
  const [empresas, setEmpresas] = useState<Empresa[]>([]);
  const [datos, setDatos] = useState<KmDeFlota | null>(null);
  const [sinEmpresas, setSinEmpresas] = useState(false);
  const [error, setError] = useState("");
  const [aviso, setAviso] = useState("");
  const [pidiendo, setPidiendo] = useState<string | null>(null);

  const empresaId = params.get("empresa") || empresas[0]?.id || "";
  const anoUrl = params.get("ano");
  const ponerFiltro = (clave: string, valor: string) =>
    setParams((p) => {
      const n = new URLSearchParams(p);
      if (valor) n.set(clave, valor); else n.delete(clave);
      return n;
    }, { replace: true });

  useEffect(() => {
    listarEmpresas()
      .then((e) => { setEmpresas(e); if (!e.length) setSinEmpresas(true); })
      .catch((e) => { setError(e.message); setSinEmpresas(true); });
  }, []);

  useEffect(() => {
    if (!empresaId) return;
    let vivo = true;
    kmDeFlota(empresaId)
      .then((r) => { if (vivo) { setDatos(r); setError(""); } })
      .catch((e) => { if (vivo) { setError(e?.message ?? "No se pudieron cargar los km"); setDatos(null); } });
    return () => { vivo = false; };
  }, [empresaId]);
  // Cargando mientras lo que hay en pantalla no es de la empresa elegida.
  const cargando = !sinEmpresas && !error && datos?.empresaId !== empresaId;

  const anos = datos?.anos ?? [];
  // «todos» = todos los años; sin nada en la URL, el último con datos.
  const ano = anoUrl === "todos" ? null : Number(anoUrl) || anos[anos.length - 1]?.year || new Date().getFullYear();
  const meses = useMemo(
    () => (datos?.meses ?? []).filter((m) => ano == null || m.year === ano),
    [datos, ano],
  );
  const cerrados = meses.filter((m) => m.estado === "cerrado");
  const totalAutentico = meses.reduce((a, m) => a + m.kmAutenticos, 0);
  const totalProvisional = meses.reduce((a, m) => a + m.kmProvisionales, 0);
  const media = cerrados.length ? cerrados.reduce((a, m) => a + m.kmAutenticos, 0) / cerrados.length : null;
  const mejor = cerrados.reduce<MesDeFlota | null>((a, m) => (!a || m.kmAutenticos > a.kmAutenticos ? m : a), null);
  const incompletos = meses.filter((m) => m.estado === "incompleto");
  const nombreEmpresa = empresas.find((e) => e.id === empresaId)?.nombre ?? "";

  async function volverAPedir(m: MesDeFlota) {
    const clave = `${m.year}-${m.month}`;
    setPidiendo(clave); setAviso(""); setError("");
    try {
      for (const c of m.cuentasSinCerrar) {
        await rellenarKilometraje({
          empresaId, connectorKey: c.connectorKey, accountKey: c.accountKey,
          desde: { year: m.year, month: m.month }, hasta: { year: m.year, month: m.month },
        });
      }
      setAviso(`Se está volviendo a pedir ${nombreMes(m)} ${m.year} de los ${m.vehiculosProvisionales} vehículos sin cerrar, `
        + "de uno en uno y al ritmo del proveedor. Se puede seguir en «Kilómetros por vehículo». "
        + "Lo que el proveedor no sepa resumir seguirá saliendo como provisional.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo lanzar la petición");
    } finally {
      setPidiendo(null);
    }
  }

  function exportar() {
    const cab = "año;mes;estado;km_autenticos;vehiculos;media_por_vehiculo;km_provisionales;vehiculos_provisionales;descartados;km_descartados;sin_dato";
    const filas = meses.map((m) => [
      m.year, m.month, ESTADO[m.estado].texto, m.kmAutenticos, m.vehiculosAutenticos,
      m.vehiculosAutenticos ? Math.round(m.kmAutenticos / m.vehiculosAutenticos) : "",
      m.kmProvisionales, m.vehiculosProvisionales, m.descartados, m.kmDescartados, m.sinDato,
    ].join(";"));
    const url = URL.createObjectURL(new Blob([`${String.fromCharCode(0xfeff)}${[cab, ...filas].join("\n")}`], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    const suf = nombreEmpresa ? `-${nombreEmpresa.toLowerCase().replace(/[^a-z0-9]+/g, "-")}` : "";
    a.download = `km-flota${suf}-${ano ?? "todos"}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="p-4 text-slate-200">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h1 className="flex items-center gap-2 text-lg font-bold"><Gauge className="h-5 w-5" /> Km de la flota</h1>
        <select className="rounded-lg border border-slate-600 bg-slate-900 px-3 py-1.5 text-xs text-slate-200"
          value={empresaId} onChange={(e) => ponerFiltro("empresa", e.target.value)} aria-label="Empresa">
          {empresas.length === 0 && <option value="">Cargando empresas…</option>}
          {empresas.map((e) => <option key={e.id} value={e.id}>{e.nombre}</option>)}
        </select>
        <div className="flex flex-wrap gap-1.5">
          {anos.map((a) => (
            <button key={a.year} onClick={() => ponerFiltro("ano", String(a.year))}
              className={`rounded-full border px-3 py-1 text-xs font-bold ${ano === a.year ? "border-sky-500 bg-sky-500/15 text-sky-300" : "border-slate-600 text-slate-400"}`}>
              {a.year}
            </button>
          ))}
          {anos.length > 1 && (
            <button onClick={() => ponerFiltro("ano", "todos")}
              className={`rounded-full border px-3 py-1 text-xs font-bold ${ano == null ? "border-sky-500 bg-sky-500/15 text-sky-300" : "border-slate-600 text-slate-400"}`}>
              Todos los años
            </button>
          )}
        </div>
        {datos && <span className="text-xs text-slate-400">{num(datos.vehiculosActivos)} vehículos activos</span>}
        <button onClick={exportar} disabled={!meses.length}
          className="ml-auto flex items-center gap-1 rounded-lg border border-sky-600 px-3 py-1.5 text-xs font-bold text-sky-300 hover:bg-sky-500/10 disabled:opacity-40">
          <Download className="h-3.5 w-3.5" /> CSV
        </button>
      </div>

      {error && <div className="mb-3 rounded-lg bg-red-500/10 p-3 text-sm text-red-300">{error}</div>}
      {aviso && <div className="mb-3 rounded-lg bg-emerald-500/10 p-3 text-sm text-emerald-300">{aviso}</div>}
      {cargando && <div className="text-sm text-slate-400">Cargando…</div>}

      {/* El km de HOY de cada vehículo: no depende del año elegido. */}
      {empresaId && <div className="mb-4"><KmActualFlota empresaId={empresaId} /></div>}

      {!cargando && datos && meses.length === 0 && (
        <div className="rounded-lg border border-slate-700 bg-slate-800/50 p-4 text-sm text-slate-400">
          Esta empresa no tiene km mensuales de telemática{ano ? ` en ${ano}` : ""}.
        </div>
      )}

      {!cargando && meses.length > 0 && (
        <div className="grid gap-4">
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <Cifra titulo={`Km auténticos ${ano ?? "(todos)"}`} valor={num(totalAutentico)} pie="meses cerrados y coherentes con el odómetro" color="text-emerald-300" />
            <Cifra titulo="Media por mes" valor={num(media)} pie={`sobre ${cerrados.length} mes${cerrados.length === 1 ? "" : "es"} cerrado${cerrados.length === 1 ? "" : "s"}`} />
            <Cifra titulo="Mes con más km" valor={num(mejor?.kmAutenticos)} pie={mejor ? `${nombreMes(mejor)} ${mejor.year}` : "—"} />
            <Cifra titulo="Provisional" valor={num(totalProvisional)} pie="mes en curso o sin cerrar: no suma arriba" color="text-amber-300" />
          </div>

          {incompletos.map((m) => (
            <div key={`${m.year}-${m.month}`} className="flex flex-wrap items-center gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-100">
              <TriangleAlert className="h-4 w-4 text-amber-300" />
              <span className="flex-1">
                <b className="capitalize">{nombreMes(m)} {m.year}</b> está incompleto: {num(m.vehiculosProvisionales)} vehículos solo
                tienen una lectura de mitad de mes ({num(m.kmProvisionales)} km sin sumar). Cada madrugada se vuelven a pedir solos.
              </span>
              {m.cuentasSinCerrar.length > 0 && (
                <button onClick={() => void volverAPedir(m)} disabled={pidiendo != null}
                  className="flex items-center gap-1 rounded-lg border border-amber-400 px-3 py-1.5 text-xs font-bold text-amber-200 hover:bg-amber-500/15 disabled:opacity-40">
                  <RefreshCw className="h-3.5 w-3.5" /> {pidiendo === `${m.year}-${m.month}` ? "Lanzando…" : `Volver a pedir ${nombreMes(m)}`}
                </button>
              )}
            </div>
          ))}

          <Grafico meses={meses} />

          <div>
            <div className="mb-2 text-[11px] font-bold uppercase tracking-wide text-slate-400">Por meses</div>
            <div className="overflow-x-auto rounded-lg border border-slate-700">
              <table className="w-full min-w-[820px] text-sm">
                <thead className="bg-slate-900/60 text-[10px] uppercase tracking-wide text-slate-400">
                  <tr>
                    <th className="px-3 py-2 text-left">Mes</th>
                    <th className="px-3 py-2 text-right">Km auténticos</th>
                    <th className="px-3 py-2 text-right">Vehículos</th>
                    <th className="px-3 py-2 text-right">Media / vehículo</th>
                    <th className="px-3 py-2 text-right">Provisional</th>
                    <th className="px-3 py-2 text-right">Descartados</th>
                    <th className="px-3 py-2 text-right">Sin dato</th>
                    <th className="px-3 py-2 text-left">Estado</th>
                  </tr>
                </thead>
                <tbody className="tabular-nums">
                  {meses.map((m) => (
                    <tr key={`${m.year}-${m.month}`} className="border-t border-slate-800">
                      <td className="px-3 py-2 capitalize">{nombreMes(m)}{ano == null ? ` ${m.year}` : ""}</td>
                      <td className="px-3 py-2 text-right font-bold">{m.kmAutenticos ? num(m.kmAutenticos) : "—"}</td>
                      <td className="px-3 py-2 text-right">{m.vehiculosAutenticos || "—"}</td>
                      <td className="px-3 py-2 text-right">{m.vehiculosAutenticos ? num(m.kmAutenticos / m.vehiculosAutenticos) : "—"}</td>
                      <td className="px-3 py-2 text-right text-amber-200">{m.vehiculosProvisionales ? `${num(m.kmProvisionales)} (${m.vehiculosProvisionales} veh.)` : "—"}</td>
                      <td className="px-3 py-2 text-right text-slate-400">{m.descartados ? `${m.descartados} · ${num(m.kmDescartados)} km` : "—"}</td>
                      <td className="px-3 py-2 text-right text-slate-400">{m.sinDato || "—"}</td>
                      <td className="px-3 py-2"><span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${ESTADO[m.estado].clase}`}>{ESTADO[m.estado].texto}</span></td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="border-t border-slate-600 font-bold tabular-nums">
                  <tr>
                    <td className="px-3 py-2">Total {ano ?? ""}</td>
                    <td className="px-3 py-2 text-right text-emerald-300">{num(totalAutentico)}</td>
                    <td colSpan={2} />
                    <td className="px-3 py-2 text-right text-amber-200">{num(totalProvisional)}</td>
                    <td className="px-3 py-2 text-right text-slate-400">{num(meses.reduce((a, m) => a + m.kmDescartados, 0))} km</td>
                    <td colSpan={2} />
                  </tr>
                </tfoot>
              </table>
            </div>
            <div className="mt-1 text-[11px] text-slate-500">
              Auténtico: km de la telemática de meses cerrados y coherentes con el odómetro. Descartados: distancia de más del doble
              de lo que avanzó el odómetro. Sin dato: el proveedor dio error o no contestó. El detalle por vehículo está en{" "}
              <Link to={`/tyrecontrol/ranking-kilometraje?empresa=${empresaId}`} className="text-sky-300 hover:underline">Kilómetros por vehículo</Link>.
            </div>
          </div>

          <div>
            <div className="mb-2 text-[11px] font-bold uppercase tracking-wide text-slate-400">Por años</div>
            <div className="overflow-x-auto rounded-lg border border-slate-700">
              <table className="w-full min-w-[520px] text-sm">
                <thead className="bg-slate-900/60 text-[10px] uppercase tracking-wide text-slate-400">
                  <tr>
                    <th className="px-3 py-2 text-left">Año</th>
                    <th className="px-3 py-2 text-right">Km auténticos</th>
                    <th className="px-3 py-2 text-right">Meses cerrados</th>
                    <th className="px-3 py-2 text-right">Media mensual</th>
                    <th className="px-3 py-2 text-right">Provisional</th>
                  </tr>
                </thead>
                <tbody className="tabular-nums">
                  {anos.map((a) => (
                    <tr key={a.year} className="border-t border-slate-800">
                      <td className="px-3 py-2 font-bold">{a.year}</td>
                      <td className="px-3 py-2 text-right font-bold text-emerald-300">{num(a.kmAutenticos)}</td>
                      <td className="px-3 py-2 text-right">{a.mesesCerrados}</td>
                      <td className="px-3 py-2 text-right">{num(a.mediaMensual)}</td>
                      <td className="px-3 py-2 text-right text-amber-200">{num(a.kmProvisionales)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Cifra({ titulo, valor, pie, color = "text-slate-100" }: { titulo: string; valor: string; pie: string; color?: string }) {
  return (
    <div className="rounded-lg border border-slate-700 bg-slate-900/60 px-3 py-2">
      <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{titulo}</div>
      <div className={`text-2xl font-black tabular-nums ${color}`}>{valor}</div>
      <div className="text-[11px] text-slate-500">{pie}</div>
    </div>
  );
}

/** Barras por mes: auténtico en verde y, encima, lo provisional rayado. */
function Grafico({ meses }: { meses: MesDeFlota[] }) {
  const max = Math.max(1, ...meses.map((m) => m.kmAutenticos + m.kmProvisionales));
  // Escala redonda: 0,5 M, 1 M, 2 M… para que las líneas digan números limpios.
  const paso = [100_000, 250_000, 500_000, 1_000_000, 2_000_000, 5_000_000].find((p) => max / p <= 5) ?? 10_000_000;
  const tope = Math.ceil(max / paso) * paso;
  const ALTO = 200, BASE = 220, IZQ = 64, ANCHO_COL = 56;
  const ancho = IZQ + meses.length * ANCHO_COL + 10;
  const y = (v: number) => BASE - (v / tope) * ALTO;
  const etiqueta = (v: number) => v >= 1_000_000 ? `${(v / 1_000_000).toLocaleString("es-ES")} M` : `${(v / 1000).toLocaleString("es-ES")} mil`;
  const lineas = Array.from({ length: Math.round(tope / paso) + 1 }, (_, i) => i * paso);
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-700 bg-slate-900/60 p-3">
      <svg viewBox={`0 0 ${ancho} 250`} className="w-full" style={{ minWidth: Math.min(ancho, 640) }} role="img" aria-label="Km por mes">
        <defs>
          <pattern id="km-flota-rayas" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="6" height="6" fill="#0f172a" /><line x1="0" y1="0" x2="0" y2="6" stroke="#f59e0b" strokeWidth="3" />
          </pattern>
        </defs>
        {lineas.map((v) => (
          <g key={v}>
            <line x1={IZQ - 4} x2={ancho} y1={y(v)} y2={y(v)} stroke={v === 0 ? "#475569" : "#1e293b"} />
            <text x={IZQ - 8} y={y(v) + 3} textAnchor="end" fontSize="10" fill="#64748b">{v === 0 ? "0" : etiqueta(v)}</text>
          </g>
        ))}
        {meses.map((m, i) => {
          const x = IZQ + i * ANCHO_COL + 8;
          const hA = (m.kmAutenticos / tope) * ALTO;
          const hP = (m.kmProvisionales / tope) * ALTO;
          return (
            <g key={`${m.year}-${m.month}`}>
              <title>{`${nombreMes(m)} ${m.year}: ${num(m.kmAutenticos)} km auténticos${m.kmProvisionales ? ` + ${num(m.kmProvisionales)} provisionales` : ""}`}</title>
              {hA > 0 && <rect x={x} y={BASE - hA} width={40} height={hA} rx={3} fill="#10b981" />}
              {hP > 0 && <rect x={x} y={BASE - hA - hP} width={40} height={hP} fill="url(#km-flota-rayas)" stroke="#f59e0b" />}
              <text x={x + 20} y={238} textAnchor="middle" fontSize="11" fill="#94a3b8">
                {MESES_CORTOS[m.month - 1]}{meses.some((o) => o.year !== m.year) ? ` ${String(m.year).slice(2)}` : ""}
              </text>
            </g>
          );
        })}
      </svg>
      <div className="mt-1 flex flex-wrap gap-4 text-[11px] text-slate-400">
        <span><span className="mr-1 inline-block h-3 w-3 rounded-sm bg-emerald-500 align-[-2px]" />Auténtico: mes cerrado y coherente con el odómetro</span>
        <span><span className="mr-1 inline-block h-3 w-3 rounded-sm border border-amber-500 align-[-2px]" style={{ background: "repeating-linear-gradient(45deg,#f59e0b 0 3px,#0f172a 3px 6px)" }} />Provisional: mes en curso o sin cerrar</span>
      </div>
    </div>
  );
}
