/**
 * Lo que la pantalla de estadísticas calcula por su cuenta: el periodo de
 * cada botón, cómo se escriben los minutos y si un cambio respecto al periodo
 * anterior es a mejor o a peor. El resto llega hecho del servidor
 * (server/assist/estadisticas.ts).
 */

export type Rango = "hoy" | "7d" | "mes" | "anio" | "personalizado";

export const RANGOS: { clave: Rango; etiqueta: string }[] = [
  { clave: "hoy", etiqueta: "Hoy" },
  { clave: "7d", etiqueta: "7 días" },
  { clave: "mes", etiqueta: "Mes" },
  { clave: "anio", etiqueta: "Año" },
  { clave: "personalizado", etiqueta: "Personalizado" },
];

/** Inicio del día (hora local del navegador) de una fecha «aaaa-mm-dd». */
export function inicioDeDia(iso: string): number {
  const [a, m, d] = iso.split("-").map(Number);
  return new Date(a, m - 1, d).getTime();
}

/** El periodo [desde, hasta] de cada botón. Personalizado: los dos días, enteros. */
export function periodo(
  r: Rango,
  ahora: Date = new Date(),
  personal?: { desde: string; hasta: string },
): { desdeMs: number; hastaMs: number } | null {
  const hoy = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate()).getTime();
  const hastaMs = ahora.getTime();
  switch (r) {
    case "hoy":
      return { desdeMs: hoy, hastaMs };
    case "7d":
      return { desdeMs: hoy - 6 * 86_400_000, hastaMs };
    case "mes":
      return { desdeMs: new Date(ahora.getFullYear(), ahora.getMonth(), 1).getTime(), hastaMs };
    case "anio":
      return { desdeMs: new Date(ahora.getFullYear(), 0, 1).getTime(), hastaMs };
    case "personalizado": {
      if (!personal?.desde || !personal?.hasta) return null;
      const d = inicioDeDia(personal.desde);
      const h = inicioDeDia(personal.hasta) + 86_400_000 - 1;
      return h > d ? { desdeMs: d, hastaMs: h } : null;
    }
  }
}

/** «41 min», «2 h 47»; «—» si no hay dato. */
export function fmtMin(m: number | null | undefined): string {
  if (m == null || !Number.isFinite(m)) return "—";
  const t = Math.round(m);
  if (t < 60) return `${t} min`;
  return `${Math.floor(t / 60)} h ${String(t % 60).padStart(2, "0")}`;
}

export function fmtNum(n: number | null | undefined, sufijo = ""): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${n.toLocaleString("es-ES", { maximumFractionDigits: 1 })}${sufijo}`;
}

/**
 * La comparación con el periodo anterior. `menosEsMejor`: en tiempos y km,
 * bajar es bueno; en asistencias o valoración, subir.
 */
export function comparacion(
  actual: number | null | undefined,
  anterior: number | null | undefined,
  opciones: { menosEsMejor?: boolean; unidad?: "min" | "pct" | "puntos" | "km" | "num" } = {},
): { texto: string; tono: "bien" | "mal" | "igual" } | null {
  if (actual == null || anterior == null) return null;
  const dif = actual - anterior;
  if (Math.abs(dif) < 0.05) return { texto: "= igual que antes", tono: "igual" };
  const sube = dif > 0;
  const bien = opciones.menosEsMejor ? !sube : sube;
  const flecha = sube ? "▲" : "▼";
  const u = opciones.unidad ?? "num";
  let cuanto: string;
  if (u === "min") cuanto = fmtMin(Math.abs(dif));
  else if (u === "puntos") cuanto = `${fmtNum(Math.abs(dif))} puntos`;
  else if (u === "km") cuanto = `${fmtNum(Math.abs(dif))} km`;
  else if (anterior > 0) cuanto = `${Math.round((Math.abs(dif) / anterior) * 100)} %`;
  else cuanto = fmtNum(Math.abs(dif));
  return { texto: `${flecha} ${cuanto}`, tono: bien ? "bien" : "mal" };
}

/** Intensidad (0–1) de una casilla del mapa de calor. */
export function intensidad(n: number, max: number): number {
  if (!n || !max) return 0;
  return 0.18 + (n / max) * 0.72;
}

/** «aaaa-mm-dd» → «23 nov»; «aaaa-mm» → «nov 26». */
export function etiquetaDia(dia: string): string {
  const [a, m, d] = dia.split("-").map(Number);
  return new Date(a, m - 1, d).toLocaleDateString("es-ES", { day: "numeric", month: "short" });
}
export function etiquetaMes(mes: string): string {
  const [a, m] = mes.split("-").map(Number);
  return new Date(a, m - 1, 1).toLocaleDateString("es-ES", { month: "short", year: "2-digit" });
}
