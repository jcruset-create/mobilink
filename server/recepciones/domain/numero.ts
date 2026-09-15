/**
 * Números de pedido y albarán del proveedor: cómo se normalizan para cruzarlos.
 *
 * Soledad escribe el pedido como `B-2026-5688837` en el correo del pedido y
 * como `5688837` en el del albarán. Son el mismo. Aquí se guarda el literal
 * tal cual y se calcula un NÚCLEO con el que se cruzan: la última tirada de
 * al menos tres dígitos, sin ceros a la izquierda. Es el mismo criterio que
 * `therefore/domain/albaran.ts`, y por el mismo motivo: aguantar prefijos,
 * guiones y ceros sin dar por iguales dos números parecidos.
 *
 * Y este mismo núcleo es el que llevará el UNIQUE cuando los correos entren
 * solos: un pedido que llegue dos veces con dos formas de escribirlo no puede
 * crear dos pedidos.
 */

const MIN_DIGITOS = 3;

export function normalizarNumero(raw: unknown): string | null {
  if (typeof raw !== "string" && typeof raw !== "number") return null;
  const limpio = String(raw).trim();
  if (!limpio) return null;
  const encontradas: string[] = limpio.match(/\d+/g) ?? [];
  const tiradas = encontradas.filter((n) => n.length >= MIN_DIGITOS);
  if (tiradas.length === 0) {
    // «ALB-A» no tiene número: se cruza por el literal en mayúsculas, que es
    // mejor que nada y nunca casará con un número de verdad.
    const letras = limpio.toUpperCase().replace(/[^A-Z0-9]/g, "");
    return letras || null;
  }
  const ultima = tiradas[tiradas.length - 1].replace(/^0+/, "");
  return ultima === "" ? "0" : ultima;
}

/** ¿Son el mismo número aunque estén escritos distinto? */
export function mismoNumero(a: unknown, b: unknown): boolean {
  const na = normalizarNumero(a);
  const nb = normalizarNumero(b);
  return na !== null && na === nb;
}
