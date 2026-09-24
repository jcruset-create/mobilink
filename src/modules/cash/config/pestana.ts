/**
 * Cómo se presenta Mobilink Cash en la pestaña del navegador.
 *
 * Los iconos son el móvil con el símbolo del dólar del propio logotipo de Cash,
 * recortado aparte: el emblema entero (la M con el móvil y la cartera) no se
 * distingue a 32 px, que es el tamaño al que se ve un favicon de verdad.
 */

import type { IdentidadPestana } from "../../identidadPestana";

export const PESTANA_CASH: IdentidadPestana = {
  titulo: "Mobilink Cash",
  iconos: [
    { rel: "icon", type: "image/png", sizes: "32x32", href: "/favicon-cash-32x32.png" },
    { rel: "icon", type: "image/png", sizes: "16x16", href: "/favicon-cash-16x16.png" },
    { rel: "apple-touch-icon", href: "/apple-touch-icon-cash.png" },
  ],
};
