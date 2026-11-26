import { useState } from "react";
import { kmEnFechaVehiculo, type KmEnFechaRespuesta } from "../services/data";

const km = (n: number) => `${Math.round(n).toLocaleString("es-ES")} km`;
const fecha = (f: string) => `${f.slice(8, 10)}/${f.slice(5, 7)}/${f.slice(0, 4)}`;

const ETIQUETA: Record<string, { texto: string; cls: string }> = {
  lectura: { texto: "lectura real", cls: "bg-emerald-500/15 text-emerald-300" },
  telematica: { texto: "exacto", cls: "bg-emerald-500/15 text-emerald-300" },
  interpolado: { texto: "entre dos lecturas", cls: "bg-amber-500/15 text-amber-300" },
  estimado: { texto: "estimado", cls: "bg-amber-500/15 text-amber-300" },
};

/**
 * «¿Cuántos km tenía en una fecha?» Pregunta al servidor, que prueba por
 * orden: odómetro de la telemática al final del día, lectura real de ese día,
 * entre dos lecturas cercanas o estimado con los km del mes. Las lecturas que
 * no cuadran (un km mal tecleado en un montaje) se apartan y se avisan. Siempre se dice
 * cuál de ellas ha sido: un número sin procedencia invita a creérselo exacto.
 */
export default function KmEnFecha({ vehiculoId }: { vehiculoId: string }) {
  const hoy = new Date().toISOString().slice(0, 10);
  const [dia, setDia] = useState("");
  const [res, setRes] = useState<KmEnFechaRespuesta | null>(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState("");

  async function consultar() {
    if (!dia) return;
    setCargando(true); setError(""); setRes(null);
    try { setRes(await kmEnFechaVehiculo(vehiculoId, dia)); }
    catch (e) { setError(e instanceof Error ? e.message : "Error"); }
    finally { setCargando(false); }
  }

  return (
    <div className="rounded-lg border border-slate-600 bg-slate-900 px-3 py-2">
      <div className="text-[10px] text-slate-400">Km en una fecha</div>
      <div className="mt-1 flex flex-wrap items-center gap-1.5">
        <input type="date" value={dia} max={hoy} onChange={(e) => setDia(e.target.value)}
          className="rounded border border-slate-600 bg-slate-950 px-1.5 py-1 text-[12px] text-slate-100" />
        <button onClick={() => void consultar()} disabled={!dia || cargando}
          className="rounded bg-sky-600 px-2.5 py-1 text-[11px] font-bold text-white disabled:opacity-40">
          {cargando ? "…" : "Ver"}
        </button>
      </div>
      {cargando && <div className="mt-1.5 text-[10px] text-slate-500">Buscando lecturas y preguntando a la telemática…</div>}
      {error && <div className="mt-1.5 text-[11px] text-rose-300">{error}</div>}
      {res && (
        <div className="mt-2 border-t border-slate-700 pt-2">
          <div className="text-[10px] text-slate-500">{fecha(res.fecha)}</div>
          {res.tipo === "sin_datos" ? (
            <div className="text-[11px] text-slate-400">{res.motivo}</div>
          ) : (
            <>
              <div className="text-sm font-black text-slate-100">
                {res.tipo === "interpolado" || res.tipo === "estimado" ? "≈ " : ""}{km(res.km)}
              </div>
              <div className="mt-0.5 text-[10px] leading-snug text-slate-400">
                <span className={`mr-1 rounded-full px-1.5 py-0.5 font-bold ${ETIQUETA[res.tipo].cls}`}>{ETIQUETA[res.tipo].texto}</span>
                {res.tipo === "interpolado"
                  ? `${res.anterior.detalle} (${km(res.anterior.km)}) y ${res.siguiente.detalle} (${km(res.siguiente.km)})`
                  : res.detalle}
              </div>
            </>
          )}
          {res.tipo !== "telematica" && res.telematica && (
            <div className="mt-1 text-[10px] text-slate-500">Telemática: {res.telematica}</div>
          )}
          {(res.avisos ?? []).map((a) => (
            <div key={a} className="mt-1 rounded bg-amber-500/10 px-1.5 py-1 text-[10px] leading-snug text-amber-300">⚠ {a}</div>
          ))}
        </div>
      )}
    </div>
  );
}
