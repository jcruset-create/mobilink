/**
 * Cuentas bancarias de la empresa: a dónde va el dinero de un ingreso.
 *
 * El número de cuenta acaba escrito a mano en el resguardo que se lleva al
 * banco y en la conciliación contra el extracto, así que un dígito bailado no
 * es un detalle estético: es un ingreso que no se puede casar. De ahí que aquí
 * no se guarde el texto tal cual, sino normalizado y comprobado.
 */

/** Longitud del IBAN por país, para los que se usan por aquí. */
const LONGITUD_IBAN: Record<string, number> = {
  ES: 24, PT: 25, FR: 27, IT: 27, DE: 22, AD: 24, GB: 22, NL: 18, BE: 16,
};

/** Quita espacios y guiones y pasa a mayúsculas: como se dicta, no como se teclea. */
export function normalizarIban(texto: string): string {
  return (texto ?? "").replace(/[\s.-]/g, "").toUpperCase();
}

/**
 * Comprueba el IBAN con su dígito de control (norma ISO 13616, resto 97 = 1).
 *
 * Es lo que caza el error de verdad: un IBAN con un número cambiado tiene la
 * pinta correcta —mismas letras, misma longitud— y solo el módulo 97 lo delata.
 */
export function ibanValido(texto: string): boolean {
  const iban = normalizarIban(texto);
  if (!/^[A-Z]{2}[0-9]{2}[A-Z0-9]+$/.test(iban)) return false;

  const largo = LONGITUD_IBAN[iban.slice(0, 2)];
  // País desconocido: se acepta con un largo razonable en vez de rechazarlo.
  // Preferimos dejar pasar una cuenta rara a bloquear un ingreso legítimo.
  if (largo == null ? iban.length < 15 || iban.length > 34 : iban.length !== largo) return false;

  // Los cuatro primeros se van al final y cada letra pasa a número (A=10…Z=35).
  const movido = iban.slice(4) + iban.slice(0, 4);
  let resto = 0;
  for (const c of movido) {
    const valor = c >= "A" ? String(c.charCodeAt(0) - 55) : c;
    // De cifra en cifra: el número entero se sale del rango seguro de JS.
    for (const d of valor) resto = (resto * 10 + Number(d)) % 97;
  }
  return resto === 1;
}

/**
 * Cómo se enseña: en grupos de cuatro, que es como viene impreso y como se
 * compara contra un extracto sin perder el sitio.
 */
export function formatearIban(texto: string): string {
  return normalizarIban(texto).replace(/(.{4})/g, "$1 ").trim();
}

/**
 * Los últimos cuatro dígitos, para los listados donde el IBAN entero es ruido.
 * No es un enmascarado de seguridad: es la cuenta de la propia empresa y quien
 * la ve ya puede abrirla; es que no cabe y no aporta.
 */
export function colaIban(texto: string): string {
  const iban = normalizarIban(texto);
  return iban.length <= 4 ? iban : `···${iban.slice(-4)}`;
}

/**
 * Código de entidad de un IBAN español: las cuatro primeras cifras del BBAN.
 *
 * `ES91 2100 0418…` → `2100`, que es CaixaBank. Es lo que permite reconocer el
 * banco solo con teclear la cuenta, sin que nadie tenga que elegirlo de una
 * lista y sin que se equivoque al hacerlo.
 *
 * Solo tiene sentido en España: en otros países esas posiciones significan
 * otra cosa, así que fuera de ES se devuelve null en vez de inventarse una
 * correspondencia.
 */
export function entidadDeIban(texto: string): string | null {
  const iban = normalizarIban(texto);
  if (!iban.startsWith("ES") || iban.length !== 24) return null;
  const entidad = iban.slice(4, 8);
  return /^[0-9]{4}$/.test(entidad) ? entidad : null;
}
