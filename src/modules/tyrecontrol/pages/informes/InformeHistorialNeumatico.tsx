import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useInformesFiltros } from "./InformesLayout";
import { buscarNeumaticos } from "../../services/data";
import type { Neumatico } from "../../types";
import { ESTADO_NEUMATICO_LABELS } from "../../types";
import type { EstadoNeumatico } from "../../types";
import { inputCls } from "../../components/ui";

// Informe 3 — Historial del neumático. Busca por nº de serie, código o RFID y
// abre su ficha, donde está la línea temporal completa (alta, montajes,
// rotaciones, reparaciones, revisiones, desmontajes…).
export default function InformeHistorialNeumatico() {
  const { filtros } = useInformesFiltros();
  const [texto, setTexto] = useState("");
  const [resultados, setResultados] = useState<Neumatico[]>([]);
  const [buscando, setBuscando] = useState(false);
  const [error, setError] = useState("");
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounce.current) clearTimeout(debounce.current);
    if (texto.trim().length < 2) { setResultados([]); return; }
    debounce.current = setTimeout(async () => {
      setBuscando(true); setError("");
      try { setResultados(await buscarNeumaticos(texto, filtros.empresaId)); }
      catch (e: any) { setError(e?.message || "Error en la búsqueda"); }
      finally { setBuscando(false); }
    }, 300);
    return () => { if (debounce.current) clearTimeout(debounce.current); };
  }, [texto, filtros.empresaId]);

  return (
    <div>
      <input
        className={`${inputCls} max-w-md`}
        placeholder="Nº de serie, código interno o RFID…"
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        autoFocus
      />
      {error && <div className="mt-2 text-sm text-rose-300">{error}</div>}

      <div className="mt-3 flex flex-col gap-1">
        {buscando && <div className="text-sm text-slate-500">Buscando…</div>}
        {!buscando && texto.trim().length >= 2 && resultados.length === 0 && (
          <div className="text-sm text-slate-500">Sin resultados para «{texto}».</div>
        )}
        {resultados.map((n) => (
          <Link
            key={n.id}
            to={`/tyrecontrol/neumaticos/${n.id}`}
            className="flex items-center justify-between rounded-lg bg-slate-800 px-3 py-2 hover:bg-slate-700/70"
          >
            <div className="min-w-0">
              <div className="text-[13px] font-bold text-slate-100">{n.numero_interno ?? n.codigo_interno ?? n.numero_serie ?? "—"}</div>
              <div className="truncate text-[12px] text-slate-400">
                {[n.marca, n.modelo, n.medida].filter(Boolean).join(" ") || "—"}
                {n.rfid_epc ? ` · RFID ${n.rfid_epc}` : ""}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-3">
              <span className="rounded-full bg-slate-700 px-2 py-0.5 text-[11px] font-bold text-slate-200">{ESTADO_NEUMATICO_LABELS[n.estado as EstadoNeumatico] ?? n.estado}</span>
              <span className="text-[12px] text-sky-300">Ver historial →</span>
            </div>
          </Link>
        ))}
      </div>

      {texto.trim().length < 2 && (
        <div className="mt-3 text-[11px] text-slate-500">Escribe al menos 2 caracteres. La ficha del neumático muestra su cronología completa.</div>
      )}
    </div>
  );
}
