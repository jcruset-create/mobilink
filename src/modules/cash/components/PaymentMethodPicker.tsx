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
  /** Imagen del botón «Mixto». Sin ella, el icono y el texto de siempre. */
  imagenMixto?: string | null;
  deshabilitado?: boolean;
};

/**
 * Proporción del botón, fija y documentada: **3:2 apaisado**.
 *
 * Es fija a propósito. Con los botones estirándose para llenar la fila, su
 * proporción cambiaba según cuántos hubiera, y entonces no existe ninguna
 * medida de imagen que cuadre siempre: la misma foto se recortaba distinto en
 * cobros y en pagos. Clavándola en 3:2, una imagen 3:2 encaja exacta y sin
 * recorte, mida lo que mida la pantalla.
 *
 * Si algún día se cambia, hay que cambiar también lo que dice la pantalla de
 * Configuración y `ALTO_MAXIMO` en `server/cash/images.ts`.
 */
export const PROPORCION_BOTON = "3:2";
/** Medida recomendada al usuario, en la proporción de arriba. */
export const MEDIDA_RECOMENDADA = "480 × 320 px";

/*
 * El botón mide igual lleve imagen o texto: en un mostrador con prisa se pulsa
 * por posición y por tamaño, y una fila de botones desiguales se lee peor.
 * `relative` + `overflow-hidden` son para la imagen a sangre; el relleno se
 * añade solo en los de texto, porque la imagen no lo quiere.
 */
const BASE =
  "relative flex aspect-[3/2] w-full flex-col items-center justify-center gap-1 overflow-hidden rounded-xl border text-[13px] font-bold transition disabled:opacity-50";
const RELLENO = "px-2 py-2";

/*
 * Cuatro por fila, siempre. Con `flex-wrap` la última fila estiraba los
 * botones que quedaran sueltos y ninguno medía igual que otro; con cuatro
 * columnas fijas y proporción 3:2, todos miden exactamente lo mismo y quedan
 * alineados en cuadrícula. El quinto botón abre fila nueva, el noveno otra.
 */
const REJILLA = "grid grid-cols-4 gap-2";

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
  imagenMixto = null,
  deshabilitado = false,
}: Props) {
  const mostrarMixto = permitirMixto && formas.length > 1;

  return (
    <div className={REJILLA} role="group" aria-label="Forma de cobro">
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
              /*
               * Con el botón de ancho fijo, un nombre largo —«Cobro por
               * transferencia»— se salía por los lados. `break-words` lo mete
               * dentro, y 11 px hacen que las palabras largas quepan enteras
               * en vez de partirse a la mitad («transferen / cia»).
               */
              <span className="w-full break-words text-center text-[11px] leading-tight">
                {f.nombre}
              </span>
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
          title="Mixto"
          className={`${BASE} ${imagenMixto ? "" : RELLENO} ${marco(valor === MIXTO)}`}
        >
          {imagenMixto ? (
            // Mismo tratamiento a sangre que las formas de cobro: si no, el
            // botón de Mixto desentonaría en medio de una fila de logotipos.
            <img
              src={imagenMixto}
              alt="Mixto"
              className="absolute inset-0 h-full w-full object-cover"
            />
          ) : (
            <>
              <Layers className="h-5 w-5" />
              <span className="leading-tight">Mixto</span>
            </>
          )}
        </button>
      )}
    </div>
  );
}
