import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useInformesFiltros } from "./InformesLayout";
import { buscarVehiculos } from "../../services/data";
import type { Vehiculo } from "../../types";
import { inputCls } from "../../components/ui";

// Informe 4 — Historial del vehículo. Busca por matrícula o nº de unidad y
// abre su ficha, con las revisiones (inspecciones) y las operaciones.
export default function InformeHistorialVehiculo() {
  const { filtros } = useInformesFiltros();
  const [texto, setTexto] = useState("");
  const [resultados, setResultados] = useState<Vehiculo[]>([]);
  const [buscando, setBuscando] = useState(false);
  const [error, setError] = useState("");
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounce.current) clearTimeout(debounce.current);
    if (texto.trim().length < 2) { setResultados([]); return; }
    debounce.current = setTimeout(async () => {
      setBuscando(true); setError("");
      try { setResultados(await buscarVehiculos(texto, filtros.empresaId)); }
      catch (e: any) { setError(e?.message || "Error en la búsqueda"); }
      finally { setBuscando(false); }
    }, 300);
    return () => { if (debounce.current) clearTimeout(debounce.current); };
  }, [texto, filtros.empresaId]);

  return (
    <div>
      <input
        className={`${inputCls} max-w-md`}
        placeholder="Matrícula o nº de unidad…"
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
        {resultados.map((v) => (
          <Link
            key={v.id}
            to={`/tyrecontrol/vehiculos/${v.id}`}
            className="flex items-center justify-between rounded-lg bg-slate-800 px-3 py-2 hover:bg-slate-700/70"
          >
            <div className="min-w-0">
              <div className="text-[13px] font-bold text-slate-100">{v.matricula}{v.numero_unidad ? ` · Unidad ${v.numero_unidad}` : ""}</div>
              <div className="truncate text-[12px] text-slate-400">
                {[v.empresa?.nombre, v.tipo?.nombre, [v.marca, v.modelo].filter(Boolean).join(" ")].filter(Boolean).join(" · ") || "—"}
              </div>
            </div>
            <span className="shrink-0 text-[12px] text-sky-300">Ver historial →</span>
          </Link>
        ))}
      </div>

      {texto.trim().length < 2 && (
        <div className="mt-3 text-[11px] text-slate-500">Escribe al menos 2 caracteres. La ficha del vehículo muestra sus inspecciones y operaciones.</div>
      )}
    </div>
  );
}
