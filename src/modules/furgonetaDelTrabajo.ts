/**
 * La furgoneta de un trabajo, para ponerla al lado del nombre del operario.
 *
 * Un trabajo móvil lleva la furgoneta por su id (`assignedVehicleId`); una
 * asistencia en carretera la lleva por su nombre (`assignedVehicleName`), que
 * es como se eligió al asignarla. En los dos casos lo que se quiere ver es
 * la MATRÍCULA: es lo que está pintado en la furgoneta y lo que se busca en
 * el patio. Si la ficha no tiene matrícula, el nombre; si no hay furgoneta,
 * nada.
 */

export type FurgonetaConocida = {
  id: number;
  name: string;
  plate?: string | null;
};

export type ReferenciaAFurgoneta = {
  assignedVehicleId?: number | null;
  assignedVehicleName?: string | null;
};

const limpio = (v: unknown) => String(v ?? "").trim();

export function matriculaDeFurgoneta(
  ref: ReferenciaAFurgoneta,
  furgonetas: FurgonetaConocida[]
): string | null {
  if (ref.assignedVehicleId != null) {
    const f = furgonetas.find((x) => x.id === ref.assignedVehicleId);
    if (f) return limpio(f.plate) || limpio(f.name) || null;
  }

  const nombre = limpio(ref.assignedVehicleName);
  if (!nombre) return null;
  const porNombre = furgonetas.find(
    (x) => limpio(x.name).toLowerCase() === nombre.toLowerCase() || limpio(x.plate).toLowerCase() === nombre.toLowerCase()
  );
  // Sin ficha, lo que haya escrito: a veces ya es la matrícula.
  return porNombre ? limpio(porNombre.plate) || limpio(porNombre.name) || null : nombre;
}
