/**
 * Las manipulaciones de texto que el parser de correo repite en todas partes.
 *
 * Están aquí y no repartidas porque cada una tiene una decisión detrás que hay
 * que poder leer una vez y no tres veces distintas.
 */

/** Sin acentos y en mayúsculas: para comparar, nunca para guardar. */
export function normalizar(v: string): string {
  return v
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase();
}

/** Las líneas, sin el `\r` de los correos y sin espacios en los extremos. */
export function lineas(texto: string): string[] {
  return texto.replace(/\r\n?/g, "\n").split("\n").map((l) => l.trim());
}

/**
 * Quita el punto con el que la plantilla termina cada campo, **sólo cuando se
 * puede saber que sobra**.
 *
 * La plantilla escribe `Código Proveedor: 8.` y también
 * `Razón Social: PROVEEDOR UNO, S.L..`: el punto final es suyo. Pero a veces
 * la razón social viene recortada por el ancho del campo del ERP y llega
 * `PROVEEDOR DOS S.A.` con UN solo punto, que es parte del nombre.
 *
 * De modo que:
 *
 * · en un campo NUMÉRICO se quitan todos los puntos finales, porque un número
 *   no termina en punto;
 * · en un campo de TEXTO sólo se quita uno cuando hay dos seguidos, que es la
 *   única situación en la que se sabe de quién es cada uno. Con un punto solo
 *   se deja: equivocarse ahí es cambiarle el nombre a un proveedor.
 */
export function sinPuntoFinal(valor: string, tipo: "numero" | "texto"): string {
  const v = valor.trim();
  if (tipo === "numero") return v.replace(/\.+$/, "").trim();
  return v.endsWith("..") ? v.slice(0, -1) : v;
}

/** ¿La línea empieza por una fecha `d/m/aaaa`? Entonces no es un albarán. */
export function empiezaPorFecha(linea: string): boolean {
  return /^\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b/.test(linea);
}

/**
 * Cuenta palabras de verdad: las que llevan alguna letra o dígito.
 *
 * Sirve para separar una CABECERA de acción («Costes (modificar):») de una
 * frase que la menciona de pasada («Necesitamos que gestionéis los siguientes
 * albaranes:»). Sin esto, la segunda se trataría como cabecera y la acción
 * quedaría pegada al texto equivocado.
 */
export function palabras(linea: string): string[] {
  return linea.split(/\s+/).filter((p) => /[\p{L}\p{N}]/u.test(p));
}
