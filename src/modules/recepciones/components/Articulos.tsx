/**
 * Lo que trae un albarán o lo que se pidió, en grande.
 *
 * Es lo primero que se lee en la bandeja y en la lista de pedidos: quien está
 * en el muelle mira los neumáticos, no el número del documento. En una tabla
 * caben pocas líneas sin romper la fila, así que a partir de `tope` se resume.
 */

import { fmtCantidad, type ArticuloBandeja } from "../types";

export default function Articulos({ articulos, tope = 4, compacto = false }: { articulos: ArticuloBandeja[]; tope?: number; compacto?: boolean }) {
  if (articulos.length === 0) return <span className="text-slate-500">—</span>;
  const visibles = articulos.slice(0, tope);
  const resto = articulos.length - visibles.length;
  return (
    <div className={compacto ? "space-y-0.5" : "space-y-1"}>
      {visibles.map((l, i) => (
        <div key={i} className="flex items-baseline gap-2">
          <span className={`tabular-nums font-black ${compacto ? "text-[13px]" : "text-base"} ${l.cantidadPendiente > 0 ? "text-emerald-300" : "text-slate-500"}`}>
            {fmtCantidad(l.cantidadPendiente > 0 ? l.cantidadPendiente : l.cantidadExpedida)}×
          </span>
          <span className={`${compacto ? "text-[13px]" : "text-base font-semibold"} leading-tight text-slate-100`}>{l.articuloLeido}</span>
        </div>
      ))}
      {resto > 0 && <div className="text-[12px] text-slate-400">y {resto} artículo(s) más</div>}
    </div>
  );
}
