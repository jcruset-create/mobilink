/**
 * Lista de expedientes.
 *
 * Cada fila avisa de si al expediente le faltan campos obligatorios: es el
 * equivalente al semáforo de la hoja `DATOS` del libro, y sirve para lo mismo
 * —ver de un vistazo qué está listo para emitir y qué no— sin tener que abrir
 * uno por uno.
 */

import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, Check, Plus } from "lucide-react";
import * as api from "../services/api";
import { useTacografos } from "../contexts/TacografosContext";
import type { Expediente, TipoOperacion } from "../types";

const ETIQUETA_TIPO: Record<TipoOperacion, string> = {
  transferencia: "Transferencia correcta",
  intransferibilidad: "Intransferibilidad",
};

/** `aaaa-mm-dd` a `dd/mm/aaaa`, que es como se leen las fechas en España. */
function fechaEs(v: string | null): string {
  if (!v) return "—";
  const [a, m, d] = v.split("-");
  return `${d}/${m}/${a}`;
}

export default function Expedientes() {
  const { puede } = useTacografos();
  const [texto, setTexto] = useState("");
  const [tipo, setTipo] = useState("");
  const [lista, setLista] = useState<Expediente[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      const { expedientes } = await api.listarExpedientes({ texto, tipo });
      setLista(expedientes);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se han podido cargar los expedientes");
    } finally {
      setCargando(false);
    }
  }, [texto, tipo]);

  // Se espera a que el usuario deje de teclear: una petición por letra contra
  // una base con años de expedientes no aporta nada.
  useEffect(() => {
    const t = setTimeout(() => void cargar(), 250);
    return () => clearTimeout(t);
  }, [cargar]);

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <h1 className="mr-auto text-lg font-bold">Expedientes</h1>
        {puede("tacografos.expediente.create") && (
          <Link
            to="/tacografos/expedientes/nuevo"
            className="flex items-center gap-1.5 rounded-lg bg-sky-600 px-3 py-2 text-[13px] font-semibold text-white hover:bg-sky-500"
          >
            <Plus className="h-4 w-4" /> Nuevo expediente
          </Link>
        )}
      </div>

      <div className="mb-3 flex flex-wrap gap-2">
        <input
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          placeholder="Nº informe, matrícula, empresa o nº de serie"
          className="min-w-[16rem] flex-1 rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-[13px] outline-none focus:ring-2 focus:ring-sky-500"
        />
        <select
          value={tipo}
          onChange={(e) => setTipo(e.target.value)}
          aria-label="Tipo de operación"
          className="rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-[13px] outline-none focus:ring-2 focus:ring-sky-500"
        >
          <option value="">Todos los tipos</option>
          <option value="transferencia">Transferencia correcta</option>
          <option value="intransferibilidad">Intransferibilidad</option>
        </select>
      </div>

      {error && (
        <p className="mb-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-[13px] text-amber-200">
          {error}
        </p>
      )}

      {cargando ? (
        <p className="text-[13px] text-slate-400">Cargando…</p>
      ) : lista.length === 0 ? (
        <p className="text-[13px] text-slate-400">No hay expedientes que coincidan.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-800">
          <table className="w-full text-[13px]">
            <thead className="bg-slate-800/60 text-left text-slate-300">
              <tr>
                <th className="px-3 py-2">Nº informe</th>
                <th className="px-3 py-2">Fecha</th>
                <th className="px-3 py-2">Matrícula</th>
                <th className="px-3 py-2">Empresa</th>
                <th className="px-3 py-2">Tipo</th>
                <th className="px-3 py-2">Estado</th>
              </tr>
            </thead>
            <tbody>
              {lista.map((e) => (
                <tr key={e.id} className="border-t border-slate-800 hover:bg-slate-800/40">
                  <td className="px-3 py-2">
                    <Link to={`/tacografos/expedientes/${e.id}`} className="text-sky-400 hover:underline">
                      {e.numInforme || "(sin número)"}
                    </Link>
                  </td>
                  <td className="px-3 py-2 text-slate-300">{fechaEs(e.fechaInforme)}</td>
                  <td className="px-3 py-2 font-semibold">{e.matricula}</td>
                  <td className="px-3 py-2 text-slate-300">{e.empresaCliente}</td>
                  <td className="px-3 py-2 text-slate-300">{ETIQUETA_TIPO[e.tipo]}</td>
                  <td className="px-3 py-2">
                    {e.estado === "anulado" ? (
                      <span className="text-slate-500">Anulado</span>
                    ) : e.camposQueFaltan.length > 0 ? (
                      <span
                        className="flex items-center gap-1 text-amber-300"
                        title={e.camposQueFaltan.map((c) => c.etiqueta).join(", ")}
                      >
                        <AlertTriangle className="h-3.5 w-3.5" />
                        Faltan {e.camposQueFaltan.length}
                      </span>
                    ) : (
                      <span className="flex items-center gap-1 text-emerald-400">
                        <Check className="h-3.5 w-3.5" /> Completo
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
