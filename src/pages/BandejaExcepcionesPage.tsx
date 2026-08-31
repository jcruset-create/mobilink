/**
 * Bandeja de excepciones: lo que está atascado.
 *
 * No es un listado de asistencias. Un listado obliga a mirarlas una a una para
 * encontrar las tres que necesitan algo; aquí cada línea es una cosa que se
 * puede resolver, con lo que le pasa escrito al lado.
 *
 * Vacía es una buena noticia y se dice así, no con una tabla en blanco.
 */

import { useCallback, useEffect, useState } from "react";
import { API_BASE, getAdminHeaders } from "../modules/workshopApi";

type Entrada = {
  cajon: string;
  assistanceId: number;
  referencia: string;
  matricula: string | null;
  cliente: string | null;
  detalle: string;
  desdeMs: number | null;
};

type Bandeja = { total: number; porCajon: Record<string, number>; data: Entrada[] };

const ETIQUETA: Record<string, string> = {
  sin_aceptar: "Sin aceptar",
  sla_vencido: "SLA vencido",
  error_integracion: "Errores de integración",
  documentacion_pendiente: "Documentación pendiente",
  coste_desviado: "Coste desviado",
  webhook_fallido: "Avisos sin entregar",
  facturacion_bloqueada: "Facturación bloqueada",
};

/** El color dice la urgencia sin tener que leer. */
const TONO: Record<string, string> = {
  sla_vencido: "border-red-500/40 bg-red-500/10 text-red-300",
  sin_aceptar: "border-red-500/40 bg-red-500/10 text-red-300",
  error_integracion: "border-amber-500/40 bg-amber-500/10 text-amber-300",
  webhook_fallido: "border-amber-500/40 bg-amber-500/10 text-amber-300",
  coste_desviado: "border-violet-500/40 bg-violet-500/10 text-violet-300",
  facturacion_bloqueada: "border-violet-500/40 bg-violet-500/10 text-violet-300",
  documentacion_pendiente: "border-sky-500/40 bg-sky-500/10 text-sky-300",
};

function desde(ms: number | null): string {
  if (!ms) return "";
  const horas = Math.floor((Date.now() - ms) / 3_600_000);
  if (horas < 1) return "hace menos de una hora";
  if (horas < 24) return `hace ${horas} h`;
  return `hace ${Math.floor(horas / 24)} días`;
}

export default function BandejaExcepcionesPage() {
  const [b, setB] = useState<Bandeja | null>(null);
  const [filtro, setFiltro] = useState("");
  const [error, setError] = useState("");

  const cargar = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/excepciones/bandeja`, { headers: getAdminHeaders() });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "Error de servidor");
      setB(data);
      setError("");
    } catch (e: any) { setError(e.message); }
  }, []);

  useEffect(() => { void cargar(); }, [cargar]);

  const visibles = (b?.data ?? []).filter((e) => !filtro || e.cajon === filtro);

  return (
    <div className="p-4">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h1 className="text-lg font-black text-slate-100">Bandeja de excepciones</h1>
        <span className="text-[12px] text-slate-500">
          Solo lo que está atascado
        </span>
        <button
          onClick={() => void cargar()}
          className="ml-auto rounded-lg border border-slate-600 px-3 py-1.5 text-xs font-bold text-slate-300 hover:bg-slate-700"
        >
          Actualizar
        </button>
      </div>

      {error && (
        <div className="mb-3 rounded-lg border border-red-500/40 bg-red-500/15 px-3 py-2 text-sm text-red-300">
          {error}
        </div>
      )}

      {/* Los contadores son también el filtro: se pulsa lo que se quiere atacar. */}
      {b && (
        <div className="mb-4 flex flex-wrap gap-2">
          <button
            onClick={() => setFiltro("")}
            className={`rounded-lg border px-3 py-1.5 text-xs font-bold ${
              filtro === "" ? "border-orange-500 bg-orange-500/15 text-orange-300"
                            : "border-slate-700 text-slate-400 hover:bg-slate-800"
            }`}
          >
            Todo · {b.total}
          </button>
          {Object.entries(b.porCajon).map(([cajon, n]) => (
            <button
              key={cajon}
              onClick={() => setFiltro(filtro === cajon ? "" : cajon)}
              className={`rounded-lg border px-3 py-1.5 text-xs font-bold ${
                filtro === cajon ? "border-orange-500 bg-orange-500/15 text-orange-300" : TONO[cajon] ?? ""
              }`}
            >
              {ETIQUETA[cajon] ?? cajon} · {n}
            </button>
          ))}
        </div>
      )}

      {!b ? (
        <p className="text-sm text-slate-500">Cargando…</p>
      ) : b.total === 0 ? (
        /* Vacía es una buena noticia: se dice, no se enseña una tabla en blanco. */
        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-6 text-center">
          <p className="text-sm font-bold text-emerald-300">No hay nada pendiente.</p>
          <p className="mt-1 text-[12px] text-slate-500">
            Ninguna asistencia espera una decisión ni un documento.
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {visibles.map((e, i) => (
            <li
              key={`${e.cajon}-${e.assistanceId}-${i}`}
              className="rounded-xl border border-slate-700 bg-slate-800/60 px-3 py-2"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className={`rounded border px-1.5 py-0.5 text-[10px] font-bold ${TONO[e.cajon] ?? ""}`}>
                  {ETIQUETA[e.cajon] ?? e.cajon}
                </span>
                <span className="font-bold text-slate-100">{e.referencia}</span>
                {e.matricula && <span className="text-slate-300">{e.matricula}</span>}
                {e.cliente && <span className="truncate text-[12px] text-slate-500">{e.cliente}</span>}
                {e.desdeMs && (
                  <span className="ml-auto text-[11px] text-slate-500">{desde(e.desdeMs)}</span>
                )}
              </div>
              <div className="mt-0.5 text-[13px] text-slate-400">{e.detalle}</div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
