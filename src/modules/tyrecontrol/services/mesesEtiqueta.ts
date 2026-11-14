/**
 * Cómo se escribe un mes y una lista de meses en pantalla.
 *
 * Vive aparte de `kilometrajeMensual.ts` porque eso es la capa que habla con
 * el servidor y esto es texto puro: así se puede probar sin levantar nada.
 */

/** «sep 2026». */
export function nombreDeMes(year: number, month: number): string {
  return new Date(Date.UTC(year, month - 1, 15))
    .toLocaleDateString("es-ES", { month: "short", year: "numeric", timeZone: "UTC" });
}

/** «sep» a secas, para cuando el año ya está dicho. */
export function mesCorto(year: number, month: number): string {
  return new Date(Date.UTC(year, month - 1, 15))
    .toLocaleDateString("es-ES", { month: "short", timeZone: "UTC" });
}

/**
 * Una lista de meses en una línea: «mar, jul 2026».
 *
 * El año se escribe UNA vez cuando todos son del mismo, y en cada uno cuando
 * la lista cruza de año («dic 2025, ene 2026»). Decir el año doce veces en
 * una celda la hace ilegible; no decirlo nunca convierte «dic, ene» en una
 * adivinanza.
 *
 * Con muchos meses se corta y se dice cuántos quedan, en vez de romper la
 * tabla: el detalle completo va en el `title`.
 */
export function listaDeMeses(
  meses: Array<{ year: number; month: number }>,
  maximo = 3,
): string {
  if (meses.length === 0) return "";
  const mismoAnio = meses.every((m) => m.year === meses[0].year);
  const visibles = meses.slice(0, maximo);
  const restantes = meses.length - visibles.length;

  const texto = mismoAnio
    ? `${visibles.map((m) => mesCorto(m.year, m.month)).join(", ")}${restantes === 0 ? ` ${meses[0].year}` : ""}`
    : visibles.map((m) => nombreDeMes(m.year, m.month)).join(", ");

  return restantes > 0 ? `${texto} y ${restantes} más` : texto;
}

/**
 * El detalle largo, para el `title`: un mes por línea con lo que contestó el
 * proveedor. Un mes sin mensaje se queda sin él en vez de inventar uno.
 */
export function detalleDeMeses(
  meses: Array<{ year: number; month: number; error?: string | null }>,
): string {
  return meses
    .map((m) => {
      const cabecera = nombreDeMes(m.year, m.month);
      const motivo = (m.error ?? "").trim();
      return motivo ? `${cabecera}: ${motivo}` : cabecera;
    })
    .join("\n");
}
