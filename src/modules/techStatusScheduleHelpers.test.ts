import { describe, it, expect } from "vitest";
import {
  applyScheduledStatusesToTechs,
  getExpiredScheduledStatusForTech,
  type ScheduledTechStatus,
} from "./techStatusScheduleHelpers";
import type { Tech, TechStatus } from "./workshopTypes";

function tech(name: string, status: TechStatus, extra: Partial<Tech> = {}): Tech {
  return {
    name,
    status,
    currentJobId: null,
    blocked: false,
    competencies: {} as Tech["competencies"],
    priorities: {} as Tech["priorities"],
    ...extra,
  };
}

function programado(
  techName: string,
  startDate: string,
  endDate: string,
  status: TechStatus = "vacaciones"
): ScheduledTechStatus {
  return {
    id: `${techName}-${startDate}-${status}`,
    techName,
    status,
    startDate,
    endDate,
    createdAtMs: Date.parse(`${startDate}T00:00:00Z`),
    workshopId: null,
  };
}

const HOY = "2026-09-09";

describe("getExpiredScheduledStatusForTech", () => {
  it("encuentra el rango terminado que coincide con el estado guardado", () => {
    const estados = [programado("Alejandro", "2026-09-01", "2026-09-08")];

    const caducado = getExpiredScheduledStatusForTech({
      techName: "Alejandro",
      status: "vacaciones",
      scheduledStatuses: estados,
      dateValue: HOY,
    });

    expect(caducado?.endDate).toBe("2026-09-08");
  });

  it("no da por caducado un rango que aún está vigente hoy", () => {
    const estados = [programado("Albert", "2026-08-31", "2026-09-13")];

    expect(
      getExpiredScheduledStatusForTech({
        techName: "Albert",
        status: "vacaciones",
        scheduledStatuses: estados,
        dateValue: HOY,
      })
    ).toBeNull();
  });

  it("solo mira los rangos del MISMO estado", () => {
    const estados = [programado("Andrés", "2026-09-01", "2026-09-05", "baja")];

    expect(
      getExpiredScheduledStatusForTech({
        techName: "Andrés",
        status: "permiso",
        scheduledStatuses: estados,
        dateValue: HOY,
      })
    ).toBeNull();
  });
});

describe("applyScheduledStatusesToTechs", () => {
  it("aplica el estado del rango vigente y bloquea al técnico", () => {
    const [albert] = applyScheduledStatusesToTechs({
      techs: [tech("Albert", "disponible")],
      scheduledStatuses: [programado("Albert", "2026-08-31", "2026-09-13")],
      dateValue: HOY,
    });

    expect(albert.status).toBe("vacaciones");
    expect(albert.blocked).toBe(true);
  });

  it("devuelve a disponible al técnico que arrastra un estado de un rango ya terminado", () => {
    const [alejandro] = applyScheduledStatusesToTechs({
      techs: [tech("Alejandro", "vacaciones", { blocked: true })],
      scheduledStatuses: [programado("Alejandro", "2026-09-01", "2026-09-08")],
      dateValue: HOY,
    });

    expect(alejandro.status).toBe("disponible");
    expect(alejandro.blocked).toBe(false);
  });

  it("no toca un estado puesto a mano, sin ningún rango que lo explique", () => {
    const [jesus] = applyScheduledStatusesToTechs({
      techs: [tech("Jesús", "otro_taller")],
      scheduledStatuses: [],
      dateValue: HOY,
    });

    expect(jesus.status).toBe("otro_taller");
  });

  it("un rango terminado de otro estado no devuelve a disponible", () => {
    const [andres] = applyScheduledStatusesToTechs({
      techs: [tech("Andrés", "permiso")],
      scheduledStatuses: [programado("Andrés", "2026-09-01", "2026-09-05", "baja")],
      dateValue: HOY,
    });

    expect(andres.status).toBe("permiso");
  });

  it("con un rango terminado y otro vigente manda el vigente", () => {
    const [ivan] = applyScheduledStatusesToTechs({
      techs: [tech("Iván", "disponible")],
      scheduledStatuses: [
        programado("Iván", "2026-08-01", "2026-08-10"),
        programado("Iván", "2026-09-05", "2026-09-15", "permiso"),
      ],
      dateValue: HOY,
    });

    expect(ivan.status).toBe("permiso");
    expect(ivan.blocked).toBe(true);
  });

  it("no toca a quien está trabajando ni a quien está disponible", () => {
    const resultado = applyScheduledStatusesToTechs({
      techs: [tech("Ramón", "ocupado", { currentJobId: 7 }), tech("José", "disponible")],
      scheduledStatuses: [],
      dateValue: HOY,
    });

    expect(resultado[0].status).toBe("ocupado");
    expect(resultado[0].currentJobId).toBe(7);
    expect(resultado[1].status).toBe("disponible");
  });
});
