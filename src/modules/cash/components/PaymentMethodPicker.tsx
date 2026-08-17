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

/*
 * El botón mide igual lleve imagen o texto: en un mostrador con prisa se pulsa
 * por posición y por tamaño, y una fila de botones desiguales se lee peor.
 * `relative` + `overflow-hidden` son para la imagen a sangre; el relleno se
 * añade solo en los de texto, porque la imagen no lo quiere.
 */
const BASE =
  "relative flex min-h-[72px] min-w-[112px] flex-1 flex-col items-center justify-center gap-1 overflow-hidden rounded-xl border text-[13px] font-bold transition disabled:opacity-50";
const RELLENO = "px-3 py-2";

/**
 * Marco del botón según esté pulsado o no.
 *
 * Con la imagen tapando el botón entero, el fondo azul del estado activo no se
 * vería: el aro va por fuera del borde, que es lo único que queda a la vista.
 */
function marco(activo: boolean): string {
  return activo
    ? "border-sky-400 bg-sky-500/20 text-sky-100 ring-2 ring-sky-400"
    : "border-slate-700 bg-slate-800 text-slate-300 hover:border-slate-500";
}

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
            className={`${BASE} ${f.imagenUrl ? "" : RELLENO} ${marco(activo)}`}
          >
            {f.imagenUrl ? (
              /*
               * A sangre: la imagen ES el botón. `object-cover` recorta lo que
               * sobre por el lado largo antes que dejar franjas de fondo, que
               * es lo que hacía que el logotipo se viera diminuto en medio de
               * un botón vacío.
               *
               * El nombre viaja en el `title` y en el `alt`: sin texto visible,
               * un lector de pantalla se quedaría sin saber qué botón es.
               */
              <img
                src={f.imagenUrl}
                alt={f.nombre}
                className="absolute inset-0 h-full w-full object-cover"
              />
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
          className={`${BASE} ${RELLENO} ${marco(valor === MIXTO)}`}
        >
          <Layers className="h-5 w-5" />
          <span className="leading-tight">Mixto</span>
        </button>
      )}
    </div>
  );
}
