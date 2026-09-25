/**
 * Pone el título y el favicon del módulo en el que se esté.
 *
 * Va dentro del router y sin pintar nada: mira la ruta y aplica lo que diga
 * `pestanasModulos`. Al salir a una ruta sin identidad propia -el hub, el
 * login, una página pública- el hook restaura la pestaña genérica, así que
 * nadie se queda con el nombre del módulo anterior.
 */

import { useLocation } from "react-router-dom";
import { useIdentidadPestana } from "../modules/identidadPestana";
import { identidadParaRuta } from "../modules/pestanasModulos";

export default function PestanaDelModulo() {
  const { pathname } = useLocation();
  useIdentidadPestana(identidadParaRuta(pathname));
  return null;
}
