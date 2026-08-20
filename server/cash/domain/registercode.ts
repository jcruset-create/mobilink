/**
 * Código de caja: las iniciales que abren el número de todo documento.
 *
 * `TAR1-IB-26-001` — `TAR1` es esto. Es lo que permite conciliar un ingreso
 * contra el extracto del banco, porque dice de qué CAJA salió el dinero, no
 * solo de qué taller: un mismo taller puede tener mostrador y taller
 * ingresando por separado el mismo día.
 *
 * Vive en su propio módulo, y no dentro de la configuración, porque hay dos
 * sitios que tienen que estar de acuerdo sobre qué es un código válido: la
 * migración que pone código a las cajas que ya existían y el alta de una caja
 * nueva. Cuando la regla estaba escrita dos veces, la segunda se quedaba atrás.
 */

/** Longitud máxima. Cabe en la cabecera de un listado y se dicta por teléfono. */
export const CODIGO_MAX = 6;
const CODIGO_MIN = 2;

/**
 * ¿Vale como código?
 *
 * Solo mayúsculas y dígitos. Nada de espacios, guiones ni tildes: el guion es
 * el separador del número —`TAR-1-IB-26-001` no se podría partir— y el código
 * acaba escrito a mano en un resguardo del banco, donde no hay tildes.
 */
export function codigoValido(codigo: string): boolean {
  return new RegExp(`^[A-Z0-9]{${CODIGO_MIN},${CODIGO_MAX}}$`).test(codigo);
}

/** Deja el texto como se teclee: `tar 1` → `TAR1`, `Alcañiz` → `ALCANIZ`. */
export function normalizarCodigo(codigo: string): string {
  return codigo
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9]/g, "")
    .toUpperCase()
    .slice(0, CODIGO_MAX);
}

/**
 * Propone un código libre para una caja: tres letras del centro y un ordinal.
 *
 * Es solo una PROPUESTA de arranque; se edita en Configuración. El ordinal
 * salta por encima de los que ya existen, así que la segunda caja de Tarragona
 * sale `TAR2` aunque `TAR1` se lo hubieran puesto a mano.
 *
 * Se toma el centro y no el nombre porque «Caja Mostrador» se repite en todos
 * los talleres y daría `CAJ1`, `CAJ2`, `CAJ3`… sin decir dónde está ninguna.
 */
export function proponerCodigo(
  centro: string,
  nombre: string,
  ocupados: ReadonlySet<string>
): string {
  const raiz = normalizarCodigo(centro || nombre).replace(/[0-9]/g, "").slice(0, 3) || "CAJ";
  let n = 1;
  while (ocupados.has(`${raiz}${n}`)) n++;
  return `${raiz}${n}`;
}
