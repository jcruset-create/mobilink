/**
 * La hora de cada paso del seguimiento.
 *
 * Lo que se defiende aquí es que la hora salga de la columna del propio estado
 * —la misma que la ficha enseña como «Salida» o «Llegada al punto»— y que el
 * respaldo por eventos no se cuele cuando la columna sí tiene valor. Dos horas
 * distintas para el mismo hecho en la misma pantalla es justo lo que no puede
 * pasar.
 */

import { describe, expect, it } from "vitest";

import { horaDelPaso, type EventoSeguimiento } from "./seguimientoPasos";
import type { RoadsideAssistance } from "./roadsideAssistanceTypes";

const T = (h: number, m: number) => new Date(2026, 8, 3, h, m).getTime();

const ASISTENCIA = {
  createdAtMs: T(22, 30),
  assignedAtMs: T(22, 40),
  departedAtMs: T(22, 46),
  arrivedAtPointMs: null,
  inicioReparacionAtMs: null,
  finishedAtMs: null,
  enCaminoBaseAtMs: null,
  arrivedAtWorkshopMs: null,
} as unknown as RoadsideAssistance;

describe("hora de cada paso", () => {
  it("sale de la columna del estado", () => {
    expect(horaDelPaso("pendiente", ASISTENCIA)).toBe(T(22, 30));
    expect(horaDelPaso("asignada", ASISTENCIA)).toBe(T(22, 40));
    expect(horaDelPaso("en_camino", ASISTENCIA)).toBe(T(22, 46));
  });

  it("los pasos que aún no han ocurrido no tienen hora", () => {
    expect(horaDelPaso("en_punto", ASISTENCIA)).toBeNull();
    expect(horaDelPaso("finalizada", ASISTENCIA)).toBeNull();
  });

  it("la columna manda sobre el registro de eventos", () => {
    const eventos: EventoSeguimiento[] = [{ status: "en_camino", createdAtMs: T(23, 59) }];
    expect(horaDelPaso("en_camino", ASISTENCIA, eventos)).toBe(T(22, 46));
  });

  it("sin columna, se recurre al evento", () => {
    const eventos: EventoSeguimiento[] = [{ status: "en_punto", createdAtMs: T(23, 5) }];
    expect(horaDelPaso("en_punto", ASISTENCIA, eventos)).toBe(T(23, 5));
  });

  /*
   * Una asistencia redirigida vuelve a pasar por el mismo estado. En una barra
   * de progreso lo que interesa es cuándo se llegó, no la última repetición.
   */
  it("del respaldo se toma la primera vez que se entró en el estado", () => {
    const eventos: EventoSeguimiento[] = [
      { status: "en_punto", createdAtMs: T(23, 40) },
      { status: "en_punto", createdAtMs: T(23, 5) },
      { status: "en_camino", createdAtMs: T(23, 20) },
    ];
    expect(horaDelPaso("en_punto", ASISTENCIA, eventos)).toBe(T(23, 5));
  });

  it("sin columna y sin eventos, no se inventa una hora", () => {
    expect(horaDelPaso("llegada_taller", ASISTENCIA, [])).toBeNull();
    expect(horaDelPaso("llegada_taller", ASISTENCIA)).toBeNull();
  });
});
