/**
 * Lo que trae un albarán o lo que se pidió, en grande.
 *
 * Es lo primero que se lee en la bandeja y en la lista de pedidos: quien está
 * en el muelle mira los neumáticos, no el número del documento.
 *
 * Se enseñan TODOS. Antes se cortaba en cuatro y el resto se resumía en «y N
 * artículo(s) más», para que la fila no creciera; pero el que va a contar la
 * mercancía necesita saber qué hay que contar, y un albarán de INSA trae cinco
 * líneas de salida. Una fila alta se lee; un artículo escondido detrás de un
 * «y 1 más» se cuenta mal.
 */

import { fmtCantidad, type ArticuloBandeja } from "../types";

export default function Articulos({ articulos, compacto = false }: { articulos: ArticuloBandeja[]; compacto?: boolean }) {
  if (articulos.length === 0) return <span className="text-slate-500">—</span>;
  return (
    <div className={compacto ? "space-y-0.5" : "space-y-1"}>
      {articulos.map((l, i) => (
        <div key={i} className="flex items-baseline gap-2">
          <span className={`tabular-nums font-black ${compacto ? "text-[13px]" : "text-base"} ${l.cantidadPendiente > 0 ? "text-emerald-300" : "text-slate-500"}`}>
            {fmtCantidad(l.cantidadPendiente > 0 ? l.cantidadPendiente : l.cantidadExpedida)}×
          </span>
          <span className={`${compacto ? "text-[13px]" : "text-base font-semibold"} leading-tight text-slate-100`}>{l.articuloLeido}</span>
        </div>
      ))}
    </div>
  );
}
