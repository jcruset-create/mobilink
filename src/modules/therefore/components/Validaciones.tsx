/**
 * Por qué un albarán está en revisión.
 *
 * Es la contrapartida de la pantalla de al lado: allí están los datos, aquí el
 * motivo de que no se den por buenos. Cada fila enseña lo que se esperaba y lo
 * que se obtuvo, porque «revisar» a secas obliga a quien lo recibe a repetir a
 * mano el trabajo del parser para averiguar qué mirar.
 *
 * Las que están OK se enseñan también, en gris y plegadas al final. Ver que
 * nueve comprobaciones pasaron y una no es lo que permite fiarse del resto del
 * análisis en vez de desconfiar de todo.
 */

import { useState } from "react";
import { AlertTriangle, CheckCircle2, ChevronDown, XCircle } from "lucide-react";
import { Pill } from "./ui";
import { ETIQUETA_VALIDACION, type ValidacionAnalisis } from "../types";

function Icono({ estado }: { estado: string }) {
  if (estado === "OK") return <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />;
  if (estado === "ERROR") return <XCircle className="h-4 w-4 shrink-0 text-rose-400" />;
  return <AlertTriangle className="h-4 w-4 shrink-0 text-amber-400" />;
}

function Fila({ v }: { v: ValidacionAnalisis }) {
  const hayValores = v.valorEsperado !== null || v.valorObtenido !== null;
  return (
    <li className="flex items-start gap-2 py-1.5">
      <Icono estado={v.estado} />
      <div className="min-w-0">
        <p className="text-[13px]">
          <span className="font-bold">{ETIQUETA_VALIDACION[v.tipo] ?? v.tipo}</span>
          <span className="text-slate-300"> · {v.mensaje}</span>
        </p>
        {hayValores && (
          <p className="text-[12px] text-slate-500">
            Se esperaba <span className="font-mono text-slate-400">{v.valorEsperado ?? "—"}</span>, se
            ha obtenido <span className="font-mono text-slate-400">{v.valorObtenido ?? "—"}</span>
          </p>
        )}
      </div>
    </li>
  );
}

export default function Validaciones({ validaciones }: { validaciones: ValidacionAnalisis[] }) {
  const [verTodas, setVerTodas] = useState(false);
  const problemas = validaciones.filter((v) => v.estado !== "OK");
  const conformes = validaciones.filter((v) => v.estado === "OK");

  if (validaciones.length === 0) {
    return <p className="text-[12px] text-slate-500">Todavía no se ha comprobado nada.</p>;
  }

  return (
    <div>
      {problemas.length === 0 ? (
        <p className="flex items-center gap-2 text-[13px] text-emerald-300">
          <CheckCircle2 className="h-4 w-4" />
          Las {conformes.length} comprobaciones han salido bien.
        </p>
      ) : (
        <ul className="divide-y divide-slate-700/60">
          {problemas.map((v) => (
            <Fila key={v.id} v={v} />
          ))}
        </ul>
      )}

      {conformes.length > 0 && problemas.length > 0 && (
        <div className="mt-2">
          <button
            onClick={() => setVerTodas((v) => !v)}
            className="flex items-center gap-1 text-[12px] text-slate-400 hover:text-slate-200"
          >
            <ChevronDown className={`h-3 w-3 transition-transform ${verTodas ? "rotate-180" : ""}`} />
            <Pill className="bg-slate-700 text-slate-300">{conformes.length}</Pill>
            comprobaciones que sí han salido bien
          </button>
          {verTodas && (
            <ul className="mt-1 divide-y divide-slate-700/60 opacity-70">
              {conformes.map((v) => (
                <Fila key={v.id} v={v} />
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
