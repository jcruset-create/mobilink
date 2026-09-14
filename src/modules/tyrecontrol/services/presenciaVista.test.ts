/**
 * Pruebas de los criterios de «Vehículos en bases».
 *
 * Lo que se fija es lo que se le promete a quien organiza el taller: que el
 * primero de la lista sea el que más falta le hace, y que un vehículo con la
 * posición vieja NO aparezca como si estuviera ahí esperando.
 */

import { describe, expect, it } from "vitest";
import {
  agruparPorBase,
  desde,
  fechaCorta,
  dormidosPorBase,
  minutosEnPalabras,
  prioridadRevision,
  quienRevisó,
  sinPeriodicidad,
  sinPeriodicidadEnBase,
  revisablesEnBase,
  revisablesPorBase,
  tieneRevisionPendiente,
} from "./presenciaVista";
import type { VehiculoPresencia } from "./presenciaBases";
import type { RevisionEstado } from "../types";

function veh(id: string, over: Partial<VehiculoPresencia> = {}): VehiculoPresencia {
  return {
    vehiculo_id: id,
    estado: "IN_BASE",
    delegacion_id: "reus",
    es_su_base: true,
    distancia_m: 40,
    antiguedad_min: 3,
    lat: 41.12,
    lng: 1.18,
    velocidad_kmh: 0,
    posicion_at: "2026-09-13T10:00:00Z",
    entrada_base_at: "2026-09-13T08:00:00Z",
    proveedor: "movertis",
    cuenta: "buses",
    externo: "E1",
    motivo: null,
    calculado_at: "2026-09-13T10:05:00Z",
    vehiculo: { id, matricula: `MAT-${id}` },
    ...over,
  };
}

function rev(estado: RevisionEstado["estado"], diasVencido = 0): RevisionEstado {
  return { vehiculo_id: "", estado, dias_vencido: diasVencido };
}

describe("prioridadRevision()", () => {
  it("nunca revisado va antes que vencida, y vencida antes que próxima", () => {
    expect(prioridadRevision("sin_revision")).toBeLessThan(prioridadRevision("vencida"));
    expect(prioridadRevision("vencida")).toBeLessThan(prioridadRevision("proxima"));
    expect(prioridadRevision("al_dia")).toBeGreaterThan(prioridadRevision("proxima"));
    expect(prioridadRevision(undefined)).toBeGreaterThan(prioridadRevision("proxima"));
  });
});

describe("tieneRevisionPendiente()", () => {
  it("al día no es pendiente, y sin datos tampoco", () => {
    expect(tieneRevisionPendiente(rev("vencida"))).toBe(true);
    expect(tieneRevisionPendiente(rev("sin_revision"))).toBe(true);
    expect(tieneRevisionPendiente(rev("proxima"))).toBe(true);
    expect(tieneRevisionPendiente(rev("al_dia"))).toBe(false);
    expect(tieneRevisionPendiente(undefined)).toBe(false);
  });
});

describe("agruparPorBase()", () => {
  it("agrupa por base y deja arriba al que más falta le hace", () => {
    const vs = [
      veh("alDia"),
      veh("proxima"),
      veh("nunca"),
      veh("vilanova1", { delegacion_id: "vilanova" }),
    ];
    const revisiones = new Map([
      ["alDia", rev("al_dia")],
      ["proxima", rev("proxima")],
      ["nunca", rev("sin_revision")],
    ]);

    const m = agruparPorBase(vs, revisiones);
    expect(m.get("reus")?.map((v) => v.vehiculo_id)).toEqual(["nunca", "proxima", "alDia"]);
    expect(m.get("vilanova")).toHaveLength(1);
  });

  it("a igualdad de revisión, primero el que lleva más tiempo en la base", () => {
    const vs = [
      veh("reciente", { entrada_base_at: "2026-09-13T09:50:00Z" }),
      veh("antiguo", { entrada_base_at: "2026-09-12T20:00:00Z" }),
    ];
    const m = agruparPorBase(vs, new Map());
    expect(m.get("reus")?.map((v) => v.vehiculo_id)).toEqual(["antiguo", "reciente"]);
  });

  it("un vehículo con posición vieja NO se cuenta como presente en la base", () => {
    const vs = [veh("dormido", { estado: "STALE_POSITION", antiguedad_min: 4000 })];
    expect(agruparPorBase(vs, new Map()).size).toBe(0);
    expect(dormidosPorBase(vs).get("reus")).toBe(1);
  });

  it("fuera de las bases o sin posición no entra en ninguna base", () => {
    const vs = [
      veh("fuera", { estado: "OUTSIDE_BASES", delegacion_id: null }),
      veh("sinPos", { estado: "NO_POSITION", delegacion_id: null, motivo: "sin_enlace" }),
    ];
    expect(agruparPorBase(vs, new Map()).size).toBe(0);
    expect(dormidosPorBase(vs).size).toBe(0);
  });
});

describe("revisablesEnBase()", () => {
  it("solo los que están en base Y tienen algo pendiente", () => {
    const vs = [
      veh("enBaseVencida"),
      veh("enBaseAlDia"),
      veh("fueraVencida", { estado: "OUTSIDE_BASES", delegacion_id: null }),
      veh("dormidoVencida", { estado: "STALE_POSITION" }),
    ];
    const revisiones = new Map([
      ["enBaseVencida", rev("vencida", 10)],
      ["enBaseAlDia", rev("al_dia")],
      ["fueraVencida", rev("vencida", 90)],
      ["dormidoVencida", rev("vencida", 80)],
    ]);

    const r = revisablesEnBase(vs, revisiones);
    expect(r.map((v) => v.vehiculo_id)).toEqual(["enBaseVencida"]);
  });

  it("entre vencidas, la más atrasada primero", () => {
    const vs = [veh("poco"), veh("mucho")];
    const revisiones = new Map([
      ["poco", rev("vencida", 3)],
      ["mucho", rev("vencida", 40)],
    ]);
    expect(revisablesEnBase(vs, revisiones).map((v) => v.vehiculo_id)).toEqual(["mucho", "poco"]);
  });
});

describe("desde() y minutosEnPalabras()", () => {
  const ahora = new Date("2026-09-13T12:00:00Z").getTime();

  it("sin instante no inventa una duración", () => {
    expect(desde(null, ahora)).toBe("—");
    expect(desde(undefined, ahora)).toBe("—");
    expect(minutosEnPalabras(null)).toBe("—");
  });

  it("minutos, horas y días", () => {
    expect(desde("2026-09-13T11:30:00Z", ahora)).toBe("30 min");
    expect(desde("2026-09-13T09:15:00Z", ahora)).toBe("2 h 45 min");
    expect(desde("2026-09-10T06:00:00Z", ahora)).toBe("3 d 6 h");
    expect(minutosEnPalabras(45)).toBe("45 min");
    expect(minutosEnPalabras(200)).toBe("3 h");
    expect(minutosEnPalabras(5000)).toBe("3 d");
  });

  it("un instante en el futuro no se enseña como una duración negativa", () => {
    expect(desde("2026-09-13T12:30:00Z", ahora)).toBe("—");
  });
});

describe("fechaCorta()", () => {
  it("da la fecha en formato de aquí", () => {
    expect(fechaCorta("2026-03-12T09:30:00Z")).toBe("12/03/2026");
  });

  it("sin fecha, una raya: el distintivo de al lado ya dice «Sin revisión»", () => {
    expect(fechaCorta(null)).toBe("—");
    expect(fechaCorta(undefined)).toBe("—");
    expect(fechaCorta("no es una fecha")).toBe("—");
  });
});

/**
 * El recuento de pendientes por base.
 *
 * Es el número que decide a qué patio bajar, así que tiene que contar
 * exactamente lo mismo que la lista que se abre al pulsar la tarjeta: ni los
 * de posición vieja, ni los que están al día.
 */
describe("revisablesPorBase()", () => {
  const revisiones = new Map<string, RevisionEstado>([
    ["v1", rev("vencida", 40)],
    ["v2", rev("sin_revision")],
    ["v3", rev("al_dia")],
    ["v4", rev("vencida", 3)],
    ["v5", rev("proxima")],
  ]);

  it("cuenta por base solo los que están dentro y tienen algo pendiente", () => {
    const m = revisablesPorBase(
      [
        veh("v1"), veh("v2"), veh("v3"),                       // Reus: 2 de 3
        veh("v4", { delegacion_id: "vilanova" }),              // Vilanova: 1
      ],
      revisiones,
    );
    expect(m.get("reus")).toBe(2);
    expect(m.get("vilanova")).toBe(1);
  });

  it("un vehículo con la posición vieja NO cuenta, aunque esté vencido", () => {
    // Es la misma regla que `agruparPorBase`: «probablemente siga ahí» no es a
    // quien se manda buscar al patio.
    const m = revisablesPorBase([veh("v1", { estado: "STALE_POSITION" })], revisiones);
    expect(m.get("reus")).toBeUndefined();
  });

  it("los que están fuera o sin posición tampoco", () => {
    const m = revisablesPorBase(
      [veh("v1", { estado: "OUTSIDE_BASES" }), veh("v2", { estado: "NO_POSITION" })],
      revisiones,
    );
    expect(m.size).toBe(0);
  });

  it("sin base asignada no se cuenta en ninguna", () => {
    const m = revisablesPorBase([veh("v1", { delegacion_id: null })], revisiones);
    expect(m.size).toBe(0);
  });

  it("una base donde todos están al día no aparece: cero es no tener entrada", () => {
    const m = revisablesPorBase([veh("v3")], revisiones);
    expect(m.get("reus")).toBeUndefined();
  });

  it("la suma por base coincide con el total de revisablesEnBase()", () => {
    const flota = [veh("v1"), veh("v2"), veh("v3"), veh("v4", { delegacion_id: "vilanova" }), veh("v5")];
    const porBase = revisablesPorBase(flota, revisiones);
    const total = [...porBase.values()].reduce((a, b) => a + b, 0);
    expect(total).toBe(revisablesEnBase(flota, revisiones).length);
  });
});

describe("quienRevisó()", () => {
  it("una persona sale con su nombre", () => {
    expect(quienRevisó({ ...rev("al_dia"), ultima_revision_origen: "tecnico", ultima_revision_por: "David" })).toBe("David");
  });

  it("el arco sale como CheckPoint, no como un técnico sin nombre", () => {
    expect(quienRevisó({ ...rev("al_dia"), ultima_revision_origen: "checkpoint", ultima_revision_por: null })).toBe("CheckPoint");
  });

  it("un técnico cuyo nombre no se puede ver no se convierte en «nadie»", () => {
    // Pasa si los permisos esconden ese usuario: la revisión la hizo alguien,
    // y decirlo genérico es más cierto que dejarlo en blanco.
    expect(quienRevisó({ ...rev("al_dia"), ultima_revision_origen: "tecnico", ultima_revision_por: null })).toBe("Técnico");
  });

  it("sin origen conocido no se inventa nada", () => {
    expect(quienRevisó(rev("sin_revision"))).toBe("—");
    expect(quienRevisó(undefined)).toBe("—");
  });
});

/**
 * El «al día» que no significa nada.
 *
 * Un vehículo sin periodicidad —ni la suya ni la de su tipo— sale «al día» por
 * descarte en cuanto se le hace una revisión, y ya no vuelve a aparecer como
 * pendiente nunca. Es el caso de los que se dan de alta desde la tablet, que
 * nacen sin tipo.
 */
describe("sinPeriodicidad()", () => {
  it("al día sin intervalo es un al día vacío", () => {
    expect(sinPeriodicidad({ ...rev("al_dia"), intervalo_dias: null })).toBe(true);
    expect(sinPeriodicidad({ ...rev("al_dia"), intervalo_dias: undefined })).toBe(true);
  });

  it("al día CON intervalo es un al día de verdad", () => {
    expect(sinPeriodicidad({ ...rev("al_dia"), intervalo_dias: 180 })).toBe(false);
  });

  it("los pendientes no se marcan como huérfanos: ya salen por su cuenta", () => {
    expect(sinPeriodicidad({ ...rev("vencida"), intervalo_dias: null })).toBe(false);
    expect(sinPeriodicidad({ ...rev("sin_revision"), intervalo_dias: null })).toBe(false);
    expect(sinPeriodicidad({ ...rev("proxima"), intervalo_dias: 30 })).toBe(false);
    expect(sinPeriodicidad(undefined)).toBe(false);
  });
});

describe("sinPeriodicidadEnBase()", () => {
  it("solo los que están en base ahora", () => {
    const vs = [
      veh("enBase"),
      veh("fuera", { estado: "OUTSIDE_BASES", delegacion_id: null }),
      veh("dormido", { estado: "STALE_POSITION" }),
    ];
    const revisiones = new Map([
      ["enBase", { ...rev("al_dia"), intervalo_dias: null }],
      ["fuera", { ...rev("al_dia"), intervalo_dias: null }],
      ["dormido", { ...rev("al_dia"), intervalo_dias: null }],
    ]);
    expect(sinPeriodicidadEnBase(vs, revisiones).map((v) => v.vehiculo_id)).toEqual(["enBase"]);
  });

  it("un vehículo con periodicidad no entra en la lista", () => {
    const revisiones = new Map([["v", { ...rev("al_dia"), intervalo_dias: 90 }]]);
    expect(sinPeriodicidadEnBase([veh("v")], revisiones)).toEqual([]);
  });
});
