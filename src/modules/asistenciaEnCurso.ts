/**
 * Qué asistencias en carretera cuentan como trabajo en curso en Pantalla
 * técnicos: salen en «Trabajos asignados» y pintan al técnico como trabajando.
 *
 * Hasta que el técnico LLEGA AL TALLER. Antes se quitaban al pasar a «vuelve
 * al taller» y el técnico aparecía disponible mientras conducía de vuelta;
 * la furgoneta sigue fuera y el trabajo no ha terminado hasta que entra.
 */
export const ETIQUETA_ASISTENCIA_EN_CURSO: Record<string, string> = {
  asignada: "Asignada",
  en_camino: "En camino",
  en_punto: "En el punto",
  inicio_reparacion: "Reparando",
  finalizada: "Finalizada · vuelve",
  en_camino_base: "Vuelve al taller",
};

export function asistenciaEnCurso(status: string | null | undefined): boolean {
  return Boolean(status) && ETIQUETA_ASISTENCIA_EN_CURSO[String(status)] != null;
}
