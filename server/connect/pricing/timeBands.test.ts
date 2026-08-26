import { describe, it, expect } from "vitest";
import { instanteLocal, minutosDeHora, diaSemanaDe } from "./time.ts";
import {
  describirFranja, franjaAplica, franjasAplicables, horaEnFranja, type FranjaHoraria,
} from "./timeBands.ts";

const ZONA = "Europe/Madrid";

const diurno: FranjaHoraria = {
  id: 1, code: "DIURNO", name: "Diurno",
  startMinute: minutosDeHora("08:00"), endMinute: minutosDeHora("19:00"),
  weekdays: [1, 2, 3, 4, 5],
};

const nocturno: FranjaHoraria = {
  id: 2, code: "NOCTURNO", name: "Nocturno",
  startMinute: minutosDeHora("19:00"), endMinute: minutosDeHora("08:00"),
  weekdays: [1, 2, 3, 4, 5],
};

/** Instante local a partir de una fecha y hora españolas. */
function enMadrid(iso: string): ReturnType<typeof instanteLocal> {
  return instanteLocal(new Date(iso).getTime(), ZONA);
}

describe("franjas horarias", () => {
  it("el diurno cubre su horario y no el resto", () => {
    expect(horaEnFranja(diurno, minutosDeHora("08:00"))).toBe(true);
    expect(horaEnFranja(diurno, minutosDeHora("18:59"))).toBe(true);
    // El final es abierto: a las 19:00 ya manda el nocturno, y no pueden
    // solaparse o habría dos precios válidos a la misma hora.
    expect(horaEnFranja(diurno, minutosDeHora("19:00"))).toBe(false);
    expect(horaEnFranja(diurno, minutosDeHora("07:59"))).toBe(false);
  });

  it("el nocturno cruza la medianoche sin partirse en dos franjas", () => {
    expect(horaEnFranja(nocturno, minutosDeHora("19:00"))).toBe(true);
    expect(horaEnFranja(nocturno, minutosDeHora("23:59"))).toBe(true);
    expect(horaEnFranja(nocturno, minutosDeHora("00:00"))).toBe(true);
    expect(horaEnFranja(nocturno, minutosDeHora("07:59"))).toBe(true);
    expect(horaEnFranja(nocturno, minutosDeHora("08:00"))).toBe(false);
    expect(horaEnFranja(nocturno, minutosDeHora("12:00"))).toBe(false);
  });

  it("el viernes a las 22:17 es nocturno", () => {
    // El caso del enunciado: el forfait que se congela en la orden de salida
    const viernes = enMadrid("2026-08-14T22:17:00+02:00");
    expect(viernes.diaSemana).toBe(5);
    expect(viernes.hora).toBe("22:17");
    expect(franjaAplica(nocturno, viernes)).toBe(true);
    expect(franjaAplica(diurno, viernes)).toBe(false);
  });

  it("el martes a las 10:30 es diurno", () => {
    const martes = enMadrid("2026-08-11T10:30:00+02:00");
    expect(martes.diaSemana).toBe(2);
    expect(franjaAplica(diurno, martes)).toBe(true);
    expect(franjaAplica(nocturno, martes)).toBe(false);
  });

  it("el sábado de madrugada depende de dónde se ancle el día", () => {
    // La ambigüedad real de "L-V 19:00-08:00". Las dos lecturas son
    // defendibles y cuestan distinto, así que decide el tarifario.
    const sabadoMadrugada = enMadrid("2026-08-15T02:00:00+02:00");
    expect(sabadoMadrugada.diaSemana).toBe(6);

    // Por el día real: es sábado, no está en L-V
    expect(franjaAplica(nocturno, sabadoMadrugada)).toBe(false);

    // Anclado al inicio: la noche pertenece al viernes en que empezó
    const anclado = { ...nocturno, weekdayAnchor: "band_start" as const };
    expect(franjaAplica(anclado, sabadoMadrugada)).toBe(true);
  });

  it("el anclaje al inicio no cambia nada en la parte de noche", () => {
    // A las 22:00 del viernes los dos anclajes coinciden: no hay ayer que valga
    const viernesNoche = enMadrid("2026-08-14T22:00:00+02:00");
    const anclado = { ...nocturno, weekdayAnchor: "band_start" as const };
    expect(franjaAplica(nocturno, viernesNoche)).toBe(true);
    expect(franjaAplica(anclado, viernesNoche)).toBe(true);
  });

  it("una franja sin días de la semana vale todos los días", () => {
    const siempre: FranjaHoraria = { ...nocturno, id: 3, weekdays: [] };
    const domingo = enMadrid("2026-08-16T03:00:00+02:00");
    expect(domingo.diaSemana).toBe(7);
    expect(franjaAplica(siempre, domingo)).toBe(true);
  });

  it("una franja desactivada no aplica aunque encaje la hora", () => {
    expect(franjaAplica({ ...diurno, active: false }, enMadrid("2026-08-11T10:00:00+02:00"))).toBe(false);
  });

  it("en el cambio de hora de marzo la franja se resuelve en local, no en UTC", () => {
    // El cambio de 2026 es el domingo 29 de marzo: se toma el viernes anterior
    // (aún en horario de invierno) y el lunes siguiente (ya en verano).
    // Las 21:00 locales son las 19:00 UTC; en UTC parecería que el nocturno
    // empieza dos horas antes de lo que dice el contrato.
    const antesDelCambio = instanteLocal(Date.parse("2026-03-27T21:00:00+01:00"), ZONA);
    expect(antesDelCambio.hora).toBe("21:00");
    expect(franjaAplica(nocturno, antesDelCambio)).toBe(true);

    const despuesDelCambio = instanteLocal(Date.parse("2026-03-30T21:00:00+02:00"), ZONA);
    expect(despuesDelCambio.hora).toBe("21:00");
    expect(franjaAplica(nocturno, despuesDelCambio)).toBe(true);
  });

  it("en el cambio de octubre tampoco se desplaza", () => {
    const octubre = instanteLocal(Date.parse("2026-10-26T18:30:00+01:00"), ZONA);
    expect(octubre.hora).toBe("18:30");
    // 18:30 sigue siendo diurno: en UTC serían las 17:30 y daría igual, pero
    // con un desfase fijo de verano se habría leído 19:30 → nocturno.
    expect(franjaAplica(diurno, octubre)).toBe(true);
    expect(franjaAplica(nocturno, octubre)).toBe(false);
  });

  it("devuelve todas las franjas aplicables, en orden estable", () => {
    const solapada: FranjaHoraria = {
      id: 9, code: "TARDE", name: "Tarde",
      startMinute: minutosDeHora("14:00"), endMinute: minutosDeHora("20:00"),
      weekdays: [1, 2, 3, 4, 5],
    };
    const martesTarde = enMadrid("2026-08-11T15:00:00+02:00");
    const aplicables = franjasAplicables([solapada, diurno, nocturno], martesTarde);
    // No se elige ganadora aquí: eso lo decide la prioridad de las reglas
    expect(aplicables.map((f) => f.code)).toEqual(["DIURNO", "TARDE"]);
  });

  it("el día de la semana se calcula sin desplazar la fecha", () => {
    expect(diaSemanaDe("2026-08-14")).toBe(5); // viernes
    expect(diaSemanaDe("2026-08-16")).toBe(7); // domingo
    expect(diaSemanaDe("2026-12-25")).toBe(5); // Navidad de 2026, viernes
  });

  it("describe la franja para la explicación de la tarifa", () => {
    expect(describirFranja(nocturno)).toBe("19:00–08:00 (L-V)");
    expect(describirFranja({ ...diurno, weekdays: [6, 7] })).toBe("08:00–19:00 (S,D)");
    expect(describirFranja({ ...diurno, weekdays: [] })).toBe("08:00–19:00");
  });
});
