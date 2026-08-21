/**
 * Firma de los webhooks. Sin base de datos y sin red.
 *
 * Va aparte del resto por la misma razón que el motor de la caja: esta función
 * es la que un integrador va a implementar del otro lado, así que tiene que
 * poder probarse sola y en un milisegundo. Cuando vivía junto al envío, no se
 * podía ni importar sin `DATABASE_URL`.
 *
 * El formato es `t=<ms>,v1=<hmac>`, el mismo que usan Stripe y GitHub: quien
 * haya integrado uno de esos ya sabe verificarlo sin leer documentación.
 *
 * **La marca de tiempo entra en la firma**, no solo el cuerpo. Sin eso, un
 * envío legítimo capturado se podría reenviar para siempre y el receptor no
 * tendría forma de saber que es viejo.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

export function firmar(secreto: string, marcaMs: number, cuerpo: string): string {
  return createHmac("sha256", secreto).update(`${marcaMs}.${cuerpo}`).digest("hex");
}

export function cabeceraFirma(secreto: string, marcaMs: number, cuerpo: string): string {
  return `t=${marcaMs},v1=${firmar(secreto, marcaMs, cuerpo)}`;
}

/**
 * Verificación, para quien recibe.
 *
 * Comparación en tiempo constante: con `===`, el tiempo de respuesta filtra
 * cuántos caracteres van bien, y con suficientes intentos eso es adivinar la
 * firma carácter a carácter.
 */
export function firmaValida(
  secreto: string,
  marcaMs: number,
  cuerpo: string,
  firma: string
): boolean {
  const esperada = Buffer.from(firmar(secreto, marcaMs, cuerpo), "utf8");
  const recibida = Buffer.from(firma, "utf8");
  return esperada.length === recibida.length && timingSafeEqual(esperada, recibida);
}
