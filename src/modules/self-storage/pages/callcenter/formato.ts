/** Formatos del Call Center. */

export function duracion(s: number | null | undefined): string {
  if (s == null) return "—";
  const m = Math.floor(s / 60);
  return m ? `${m} min ${String(s % 60).padStart(2, "0")} s` : `${s} s`;
}

/** «AAAA-MM-DD» de hace `dias` días (hora local). */
export function haceDias(dias: number): string {
  const d = new Date(Date.now() - dias * 86400_000);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}

export const IDIOMAS: { code: string; label: string }[] = [
  { code: "es", label: "Castellano" },
  { code: "ca", label: "Català" },
];
export const etqIdioma = (c: string | null | undefined) => (c ? (IDIOMAS.find((i) => i.code === c)?.label ?? c.toUpperCase()) : "—");
