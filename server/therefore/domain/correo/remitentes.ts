/**
 * Quién puede escribir al buzón, y cómo se lee el cuerpo de lo que manda.
 *
 * Vive en `domain/` porque es lógica pura: sin base de datos, sin IMAP y sin
 * red. Esa separación no es estética. `buzon.ts` y `config.ts` importan
 * `db.ts`, que **lanza al cargarse** si falta `DATABASE_URL`, así que un test
 * que importara estas funciones desde allí fallaba siempre en CI, donde no hay
 * PostgreSQL. Aquí se prueban sin levantar nada.
 *
 * `buzon.ts` y `config.ts` las reexportan, de modo que quien las importe de
 * allí sigue funcionando igual.
 */

/** Con forma de dominio: «proveedor.com», sin arroba ni espacios. */
const DOMINIO = /^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/;

/**
 * Direcciones o dominios, en minúsculas y sin espacios. Una lista vacía
 * significa «todas».
 *
 * Un dominio se guarda como «@proveedor.com», se escriba con arroba o sin
 * ella, y admite cualquier buzón de ese dominio (y de sus subdominios). Lo
 * que no es ni dirección ni dominio se descarta: un filtro mal escrito que se
 * colara dejaría el buzón sordo sin que nadie lo viera.
 */
export function partirRemitentes(valor: string | null | undefined): string[] {
  return (valor ?? "")
    .split(/[,;\s]+/)
    .map((v) => v.trim().toLowerCase())
    .map((v) => (DOMINIO.test(v) ? `@${v}` : v))
    .filter((v) => v.includes("@") && (v.startsWith("@") ? DOMINIO.test(v.slice(1)) : true));
}

/**
 * ¿Se acepta este remitente? Lista vacía = todos.
 *
 * Una entrada «@proveedor.com» acepta cualquier dirección de ese dominio y de
 * sus subdominios; el resto se compara exacta.
 */
export function remitenteAceptado(de: string, remitentes: readonly string[]): boolean {
  if (remitentes.length === 0) return true;
  const direccion = de.toLowerCase().trim();
  const dominio = direccion.slice(direccion.lastIndexOf("@") + 1);
  return remitentes.some((r) =>
    r.startsWith("@") ? dominio === r.slice(1) || dominio.endsWith(`.${r.slice(1)}`) : r === direccion
  );
}

/**
 * El cuerpo de un correo, en la forma en que lo deja `mailparser`.
 *
 * Se declara por su forma y no importando el tipo de la librería: el dominio
 * no tiene por qué saber quién parsea el correo.
 */
export type CuerpoDeCorreo = {
  text?: string | null;
  html?: string | false | null;
};

/**
 * El cuerpo en texto plano.
 *
 * Therefore manda texto; si algún día llegara sólo HTML, se le quitan las
 * etiquetas y ya. No se intenta interpretar el HTML: el parser del correo lee
 * líneas, y una tabla HTML aplanada sigue teniendo sus líneas.
 */
export function cuerpoEnTexto(correo: CuerpoDeCorreo): string {
  if (correo.text?.trim()) return correo.text;
  if (typeof correo.html === "string" && correo.html.trim()) {
    return correo.html
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|tr|li|h\d)>/gi, "\n")
      .replace(/<[^>]+>/g, "")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">");
  }
  return "";
}
