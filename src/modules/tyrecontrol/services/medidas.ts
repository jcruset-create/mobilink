/**
 * Medida base canónica (ancho/perfil R llanta), ignorando índice de carga y
 * código de velocidad, para casar "385/65R22.5" (ficha del vehículo) con
 * "385/65 R22.5 158L" (almacén), que es la misma medida escrita distinto.
 */
export function baseMedida(s?: string | null): string {
  const t = (s ?? "").toUpperCase().replace(/\s+/g, "");
  const m = t.match(/(\d{2,3})(?:\/(\d{2,3}))?R?(\d{1,2}(?:[.,]\d)?)/);
  if (!m) return t;
  return `${m[1]}${m[2] ? "/" + m[2] : ""}R${m[3].replace(",", ".")}`;
}

/**
 * Forma canónica de escribir una medida, sin perder nada.
 *
 * Gemela de `tc_medida_normalizada()` en la base de datos, que es quien manda:
 * hay un disparador que la aplica a todo lo que entra. Aquí se repite para que
 * el panel compare y cree con el mismo criterio; si no, buscaría
 * "295/80R22,5" en el catálogo, no lo encontraría, intentaría crearlo y
 * chocaría contra el unique de `valor` una vez el disparador lo convirtiera en
 * "295/80R22.5".
 *
 * A diferencia de `baseMedida()`, esto NO extrae la medida base: conserva el
 * índice de carga y el código de velocidad. "315/80 R 22,5  156/150 L" queda
 * en "315/80R22.5 156/150 L", no en "315/80R22.5".
 */
export function medidaCanonica(s?: string | null): string {
  const t = (s ?? "").replace(/\s+/g, " ").trim().toUpperCase();
  if (!t) return "";
  return t
    .replace(/(\d) *\/ *(\d)/g, "$1/$2") // espacios pegados a la barra
    .replace(/(\d) *R *(\d)/g, "$1R$2") // y a la R
    .replace(/(\d),(\d)/g, "$1.$2") // coma decimal a punto
    .replace(/(R\d{1,2})-(\d)/g, "$1.$2") // "295/80R22-5" del import viejo
    .replace(/ +/g, " ");
}

/** ¿Son la misma medida, aunque estén escritas de otra forma? */
export function mismaMedida(a?: string | null, b?: string | null): boolean {
  if (!a || !b) return false;
  return baseMedida(a) === baseMedida(b);
}
