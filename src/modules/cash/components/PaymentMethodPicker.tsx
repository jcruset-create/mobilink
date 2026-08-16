/**
 * Botones de forma de cobro.
 *
 * Lo primero que se toca al cobrar: se pulsa cómo paga el cliente y la pantalla
 * se adapta. Es el mismo componente en cobros y en pagos para que el botón de
 * «Efectivo» esté siempre en el mismo sitio y con el mismo aspecto.
 *
 * Las formas salen del catálogo de la empresa, así que aquí no hay ninguna
 * lista escrita a mano. Si la forma tiene imagen se enseña la imagen —que es lo
 * que se localiza de un vistazo en un mostrador con prisa— y si no, el nombre.
 *
 * «Mixto» va aparte y al final: no es una forma de pago, es un reparto entre
 * varias, y solo tiene sentido si hay al menos dos.
 */

import { Layers } from "lucide-react";
import type { FormaPagoConfig } from "../types";

/** Valor especial: el cobro se reparte entre varias formas. */
export const MIXTO = "__MIXTO__";

type Props = {
  formas: FormaPagoConfig[];
  valor: string;
  onChange: (valor: string) => void;
  /** En pagos no se ofrece: se paga por una sola vía. */
  permitirMixto?: boolean;
  deshabilitado?: boolean;
};

const BASE =
  "flex min-h-[64px] min-w-[104px] flex-1 flex-col items-center justify-center gap-1 rounded-xl border px-3 py-2 text-[13px] font-bold transition disabled:opacity-50";

export default function PaymentMethodPicker({
  formas,
  valor,
  onChange,
  permitirMixto = true,
  deshabilitado = false,
}: Props) {
  const mostrarMixto = permitirMixto && formas.length > 1;

  return (
    <div className="flex flex-wrap gap-2" role="group" aria-label="Forma de cobro">
      {formas.map((f) => {
        const activo = valor === f.codigo;
        return (
          <button
            key={f.codigo}
            type="button"
            onClick={() => onChange(f.codigo)}
            disabled={deshabilitado}
            aria-pressed={activo}
            title={f.nombre}
            className={`${BASE} ${
              activo
                ? "border-sky-400 bg-sky-500/20 text-sky-100"
                : "border-slate-700 bg-slate-800 text-slate-300 hover:border-slate-500"
            }`}
          >
            {f.imagenUrl ? (
              // El nombre viaja en el `title` y en el alt: sin texto visible, un
              // lector de pantalla se quedaría sin saber qué botón es.
              <img src={f.imagenUrl} alt={f.nombre} className="h-8 max-w-[88px] object-contain" />
            ) : (
              <span className="text-center leading-tight">{f.nombre}</span>
            )}
          </button>
        );
      })}

      {mostrarMixto && (
        <button
          type="button"
          onClick={() => onChange(MIXTO)}
          disabled={deshabilitado}
          aria-pressed={valor === MIXTO}
          className={`${BASE} ${
            valor === MIXTO
              ? "border-sky-400 bg-sky-500/20 text-sky-100"
              : "border-slate-700 bg-slate-800 text-slate-300 hover:border-slate-500"
          }`}
        >
          <Layers className="h-5 w-5" />
          <span className="leading-tight">Mixto</span>
        </button>
      )}
    </div>
  );
}
