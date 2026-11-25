/** Cabecera que ordena la lista al tocarla. Ver `hooks/useOrdenColumnas.ts`. */
import type { ReactNode } from "react";
import type { ColumnaOrden, OrdenColumnas } from "../hooks/useOrdenColumnas";

export function CabeceraOrden<T>({ col, orden, children, className = "" }: {
  col: ColumnaOrden; orden: OrdenColumnas<T>; children: ReactNode; className?: string;
}) {
  const s = orden.col === col ? orden.sentido : null;
  return (
    <button
      type="button"
      onClick={() => orden.tocar(col)}
      title={s === null ? "Ordenar de mayor a menor" : s === "desc" ? "Ordenar de menor a mayor" : "Volver al orden de la lista"}
      // Sin mayúsculas ni tamaño propios: hereda los de la cabecera de cada
      // tabla. La flecha no sale al imprimir (hay informes que se imprimen).
      className={`inline-flex items-center gap-1 hover:text-slate-100 print:text-inherit ${s ? "text-sky-300" : ""} ${className}`}
    >
      {children} <span aria-hidden className="print:hidden">{s === "desc" ? "▼" : s === "asc" ? "▲" : "↕"}</span>
    </button>
  );
}
