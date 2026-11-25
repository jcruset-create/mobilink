import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Route as IconoRuta } from "lucide-react";
import { listarEmpresas } from "../services/data";
import type { Empresa } from "../types";
import {
  COLOR_TIPO, NOMBRE_TIPO, porDondeRuedanFlota, TIPOS_VIA, type PorTipo, type VehiculoFlotaVias,
} from "../services/porDondeRueda";
import { BarraTipos, Leyenda } from "../components/PorDondeRueda";
import { useOrdenColumnas } from "../hooks/useOrdenColumnas";
import { CabeceraOrden } from "../components/OrdenColumnas";

/**
 * «Por dónde ruedan»: el reparto de km por tipo de vía de cada vehículo
 * marcado, en un periodo. Para comparar el desgaste: un autobús que hace 60 %
 * de ciudad no gasta la goma como uno de autovía. Los vehículos se marcan en
 * su ficha («Analizar por dónde rueda»).
 */

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const num = (n: number) => Math.round(n).toLocaleString("es-ES");

function periodo(clave: string): { desde: string; hasta: string } {
  const hoy = new Date();
  if (clave === "mes") return { desde: iso(new Date(hoy.getFullYear(), hoy.getMonth(), 1)), hasta: iso(hoy) };
  if (clave === "mes-pasado") {
    return { desde: iso(new Date(hoy.getFullYear(), hoy.getMonth() - 1, 1)), hasta: iso(new Date(hoy.getFullYear(), hoy.getMonth(), 0)) };
  }
  if (clave === "90") return { desde: iso(new Date(Date.now() - 90 * 86_400_000)), hasta: iso(hoy) };
  if (clave === "ano") return { desde: iso(new Date(hoy.getFullYear(), 0, 1)), hasta: iso(hoy) };
  return { desde: iso(new Date(Date.now() - 30 * 86_400_000)), hasta: iso(hoy) };
}
const PERIODOS = [["30", "Últimos 30 días"], ["mes", "Este mes"], ["mes-pasado", "Mes pasado"], ["90", "90 días"], ["ano", "Este año"]] as const;

/** % de un tipo sobre los km con vía conocida. */
const pctDe = (p: PorTipo | null, tipos: readonly string[]) => {
  if (!p) return null;
  const conVia = TIPOS_VIA.filter((t) => t !== "sin_via").reduce((s, t) => s + p[t].km, 0);
  if (conVia <= 0) return null;
  return Math.round((tipos.reduce((s, t) => s + p[t as keyof PorTipo].km, 0) / conVia) * 100);
};

export default function PorDondeRuedan() {
  const [params, setParams] = useSearchParams();
  const [empresas, setEmpresas] = useState<Empresa[]>([]);
  const [datos, setDatos] = useState<{ empresaId: string; clave: string; vehiculos: VehiculoFlotaVias[] } | null>(null);
  const [error, setError] = useState("");
  const empresaId = params.get("empresa") || empresas[0]?.id || "";
  const clave = params.get("periodo") || "30";
  const poner = (k: string, v: string) => setParams((p) => { const n = new URLSearchParams(p); n.set(k, v); return n; }, { replace: true });

  useEffect(() => { listarEmpresas().then(setEmpresas).catch((e) => setError(e.message)); }, []);
  useEffect(() => {
    if (!empresaId) return;
    let vivo = true;
    porDondeRuedanFlota({ empresaId, ...periodo(clave) })
      .then((r) => { if (vivo) { setDatos({ empresaId, clave, vehiculos: r.vehiculos }); setError(""); } })
      .catch((e) => { if (vivo) setError(e?.message ?? "No se pudo cargar"); });
    return () => { vivo = false; };
  }, [empresaId, clave]);
  const cargando = !error && (datos?.empresaId !== empresaId || datos?.clave !== clave);

  // Por defecto, los que más ciudad hacen arriba.
  const base = useMemo(
    () => [...(datos?.vehiculos ?? [])].sort((a, b) => (b.pctUrbana ?? -1) - (a.pctUrbana ?? -1)),
    [datos],
  );
  const orden = useOrdenColumnas(base, { matricula: (v) => v.matricula, unidad: (v) => v.numero_unidad });

  const flota = useMemo(() => {
    const p = Object.fromEntries(TIPOS_VIA.map((t) => [t, { km: 0, segundos: 0 }])) as PorTipo;
    for (const v of base) for (const t of TIPOS_VIA) { p[t].km += v.porTipo?.[t].km ?? 0; p[t].segundos += v.porTipo?.[t].segundos ?? 0; }
    return p;
  }, [base]);
  const kmFlota = TIPOS_VIA.reduce((s, t) => s + flota[t].km, 0);

  return (
    <div className="p-4 text-slate-200">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h1 className="flex items-center gap-2 text-lg font-bold"><IconoRuta className="h-5 w-5" /> Por dónde ruedan</h1>
        <select className="rounded-lg border border-slate-600 bg-slate-900 px-3 py-1.5 text-xs text-slate-200"
          value={empresaId} onChange={(e) => poner("empresa", e.target.value)} aria-label="Empresa">
          {empresas.length === 0 && <option value="">Cargando empresas…</option>}
          {empresas.map((e) => <option key={e.id} value={e.id}>{e.nombre}</option>)}
        </select>
        <div className="flex flex-wrap gap-1.5">
          {PERIODOS.map(([k, t]) => (
            <button key={k} onClick={() => poner("periodo", k)}
              className={`rounded-full border px-3 py-1 text-xs font-bold ${clave === k ? "border-sky-500 bg-sky-500/15 text-sky-300" : "border-slate-600 text-slate-400"}`}>
              {t}
            </button>
          ))}
        </div>
      </div>

      {error && <div className="mb-3 rounded-lg bg-red-500/10 p-3 text-sm text-red-300">{error}</div>}
      {cargando && <div className="text-sm text-slate-400">Cargando…</div>}

      {!cargando && base.length === 0 && (
        <div className="rounded-lg border border-slate-700 bg-slate-800/50 p-4 text-sm text-slate-400">
          Ningún vehículo de esta empresa está marcado. Se marca en la ficha del vehículo: «Analizar por dónde rueda».
        </div>
      )}

      {!cargando && base.length > 0 && (
        <div className="grid gap-4">
          <div className="rounded-lg bg-slate-800 p-3">
            <div className="mb-2 flex flex-wrap items-baseline gap-2">
              <span className="text-[11px] font-bold uppercase text-slate-400">Todos los marcados</span>
              <span className="text-sm font-black tabular-nums">{num(kmFlota)} km</span>
              <span className="text-xs text-slate-500">{base.length} vehículos</span>
            </div>
            <BarraTipos porTipo={flota} alto="h-4" />
            <div className="mt-2"><Leyenda /></div>
          </div>

          <div className="overflow-x-auto rounded-lg border border-slate-700">
            <table className="w-full text-xs">
              <thead className="bg-slate-800 text-[10px] uppercase text-slate-400">
                <tr>
                  <th className="px-2 py-2 text-left"><CabeceraOrden col="unidad" orden={orden}>Nº unidad</CabeceraOrden></th>
                  <th className="px-2 py-2 text-left"><CabeceraOrden col="matricula" orden={orden}>Matrícula</CabeceraOrden></th>
                  <th className="px-2 py-2 text-right">Días</th>
                  <th className="px-2 py-2 text-right">Km</th>
                  <th className="min-w-[180px] px-2 py-2 text-left">Reparto</th>
                  <th className="px-2 py-2 text-right" style={{ color: COLOR_TIPO.urbana }}>% {NOMBRE_TIPO.urbana}</th>
                  <th className="px-2 py-2 text-right">% Autopista + autovía</th>
                  <th className="px-2 py-2 text-right">% Carretera</th>
                </tr>
              </thead>
              <tbody>
                {orden.filas.map((v) => (
                  <tr key={v.vehiculoId} className="border-t border-slate-700/60 hover:bg-slate-800/60">
                    <td className="px-2 py-1.5 tabular-nums text-slate-300">{v.numero_unidad ?? "—"}</td>
                    <td className="px-2 py-1.5">
                      <Link to={`/tyrecontrol/vehiculos/${v.vehiculoId}`} className="font-bold text-sky-300 hover:underline">{v.matricula ?? "—"}</Link>
                      {!v.activo && <span className="ml-1 text-[10px] text-slate-500">(desmarcado)</span>}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{v.dias}</td>
                    <td className="px-2 py-1.5 text-right font-bold tabular-nums">{num(v.km)}</td>
                    <td className="px-2 py-1.5">{v.porTipo ? <BarraTipos porTipo={v.porTipo} /> : <span className="text-slate-500">sin datos todavía</span>}</td>
                    <td className="px-2 py-1.5 text-right font-bold tabular-nums">{v.pctUrbana == null ? "—" : `${Math.round(v.pctUrbana)} %`}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{pctDe(v.porTipo, ["autopista", "autovia"]) ?? "—"}{v.porTipo ? " %" : ""}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{pctDe(v.porTipo, ["nacional", "autonomica", "local"]) ?? "—"}{v.porTipo ? " %" : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="text-[11px] text-slate-500">
            Calculado cada mañana con el GPS de Movertis (un punto cada ~10 s) pegado al mapa de OpenStreetMap.
            Los % son sobre los km con vía conocida; «sin vía» (cocheras, saltos del GPS) no cuenta.
          </div>
        </div>
      )}
    </div>
  );
}
