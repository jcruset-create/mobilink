/**
 * ¿El vehículo de esta cita ya está en el taller con un trabajo abierto?
 *
 * Una cita se da por llegada cuando se pulsa «Llegó» o cuando la recepción
 * de la APK la enlaza. Pero el vehículo puede entrar por otra puerta —una
 * entrada rápida tecleada a mano— y entonces el trabajo existe, el técnico
 * está en ello, y la cita sigue en «Llegadas» como si nadie hubiera venido.
 * Se cruza por matrícula: un trabajo abierto con esa matrícula es el vehículo
 * en el patio, venga de donde venga.
 */
const CERRADOS = new Set(["cerrado", "eliminado", "cancelado"]);

export function matriculaClave(plate: unknown): string {
  return String(plate ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function citaYaEnTaller(
  cita: { plate?: string | null },
  jobs: { plate?: string | null; status?: string | null }[]
): boolean {
  const clave = matriculaClave(cita.plate);
  if (clave.length < 4) return false;
  return jobs.some(
    (j) => matriculaClave(j.plate) === clave && !CERRADOS.has(String(j.status ?? "").toLowerCase())
  );
}
