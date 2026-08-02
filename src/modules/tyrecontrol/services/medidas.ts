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

/** ¿Son la misma medida, aunque estén escritas de otra forma? */
export function mismaMedida(a?: string | null, b?: string | null): boolean {
  if (!a || !b) return false;
  return baseMedida(a) === baseMedida(b);
}
