/**
 * Normalización de la ficha del vehículo de una asistencia.
 *
 * El vehículo viaja como JSON dentro de `connect_assistances.vehicle`, y la
 * matrícula se copia además a `roadside_assistances.plate`. Si cada sitio la
 * escribe a su manera —con espacios, en minúsculas— la misma matrícula deja de
 * cruzar con el histórico del taller. Por eso la normalización vive aquí, en
 * una función pura y con pruebas, y no repartida por el router.
 */

export interface VehicleData {
  type?: string | null;
  make?: string | null;
  model?: string | null;
  plate?: string | null;
  vin?: string | null;
  color?: string | null;
  fuel?: string | null;
  electric?: boolean;
  trailer?: boolean;
  weight?: string | null;
  cargo?: string | null;
  dangerousGoods?: boolean;
  [extra: string]: unknown;
}

function texto(value: unknown, max: number): string | null {
  const s = String(value ?? "").trim();
  return s ? s.slice(0, max) : null;
}

/** Matrícula sin espacios ni guiones y en mayúsculas: `1234 abc` → `1234ABC`. */
export function normalizarMatricula(value: unknown): string | null {
  const s = String(value ?? "").toUpperCase().replace(/[\s.-]/g, "").trim();
  return s ? s.slice(0, 15) : null;
}

/**
 * Mezcla lo que llega con lo que ya había. Los campos que el formulario no
 * manda se ponen a null a propósito: es una ficha completa, no un parche, y
 * así se puede borrar un dato mal metido. Lo que NO se toca son las claves
 * ajenas a la ficha (las que otro proceso haya podido dejar ahí).
 */
export function normalizarVehiculo(anterior: VehicleData, entrada: VehicleData): VehicleData {
  return {
    ...anterior,
    type: texto(entrada.type, 30) ?? anterior.type ?? "car",
    make: texto(entrada.make, 40),
    model: texto(entrada.model, 60),
    plate: normalizarMatricula(entrada.plate),
    vin: texto(entrada.vin, 25)?.toUpperCase() ?? null,
    color: texto(entrada.color, 30),
    fuel: texto(entrada.fuel, 20),
    electric: !!entrada.electric,
    trailer: !!entrada.trailer,
    weight: texto(entrada.weight, 20),
    cargo: texto(entrada.cargo, 120),
    dangerousGoods: !!entrada.dangerousGoods,
  };
}

/** "Renault Kangoo" para el `vehicleDescription` del core. */
export function descripcionVehiculo(v: VehicleData): string | null {
  return [v.make, v.model].filter(Boolean).join(" ") || null;
}
