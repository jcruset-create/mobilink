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
  etiquetaBase,
  ubicacionDeVehiculo,
  coordenadasDeVehiculo,
  enlaceDeMapa,
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

/**
 * En qué base está un vehículo, para el aviso de los dados de alta en tablet.
 *
 * Hay dos fuentes y no dicen lo mismo: el barrido del Hub vale para cualquier
 * proveedor y la sincronización Webfleet solo para los suyos.
 */
describe("etiquetaBase()", () => {
  const enBase = { vehiculo_id: "v", estado: "IN_BASE" as const, delegacion: { id: "b", nombre: "Reus" } };
  const wfEnBase = { vehiculo_id: "v", empresa_id: "e", estado: "en_base" as const, delegacion: { id: "b2", nombre: "Vilanova" } };

  it("con posición reciente dice que está ahí ahora", () => {
    expect(etiquetaBase(enBase, undefined)).toEqual({ base: "Reus", ahora: true });
  });

  it("con posición vieja dice dónde se le vio, no que esté", () => {
    // La diferencia importa: alguien va a bajar al patio a buscarlo.
    expect(etiquetaBase({ ...enBase, estado: "STALE_POSITION" }, undefined)).toEqual({
      base: "Reus",
      ahora: false,
    });
  });

  it("fuera de las bases o sin posición no se etiqueta", () => {
    expect(etiquetaBase({ ...enBase, estado: "OUTSIDE_BASES", delegacion: null }, undefined)).toBeNull();
    expect(etiquetaBase({ ...enBase, estado: "NO_POSITION", delegacion: null }, undefined)).toBeNull();
    expect(etiquetaBase(undefined, undefined)).toBeNull();
  });

  it("sin dato del Hub vale el de Webfleet, que es el de los clientes de siempre", () => {
    expect(etiquetaBase(undefined, wfEnBase)).toEqual({ base: "Vilanova", ahora: true });
    expect(etiquetaBase(undefined, { ...wfEnBase, estado: "otra_base" })).toEqual({
      base: "Vilanova",
      ahora: true,
    });
    expect(etiquetaBase(undefined, { ...wfEnBase, estado: "en_ruta" })).toBeNull();
  });

  it("manda el Hub cuando los dos dicen algo", () => {
    expect(etiquetaBase(enBase, wfEnBase)).toEqual({ base: "Reus", ahora: true });
  });
});

/**
 * La chapa de ubicación de la ficha del vehículo.
 *
 * Lo que se fija aquí es que no se confunda nunca «está» con «se le vio», y
 * que un vehículo del que no se sabe nada lo diga en vez de parecer en ruta.
 */
describe("ubicacionDeVehiculo()", () => {
  const AHORA = new Date("2026-09-16T12:00:00Z").getTime();
  const hace = (min: number) => new Date(AHORA - min * 60_000).toISOString();

  it("en base dice en cuál y de cuándo es la posición", () => {
    const u = ubicacionDeVehiculo({
      presencia: {
        vehiculo_id: "v",
        estado: "IN_BASE",
        posicion_at: hace(4),
        delegacion: { id: "b", nombre: "Reus" },
      },
      ahora: AHORA,
    });
    expect(u.texto).toBe("En base · Reus");
    expect(u.detalle).toBe("posición de hace 4 min");
    expect(u.tono).toBe("base");
  });

  it("fuera de las bases es «En ruta»", () => {
    const u = ubicacionDeVehiculo({
      presencia: { vehiculo_id: "v", estado: "OUTSIDE_BASES", posicion_at: hace(7), delegacion: null },
      ahora: AHORA,
    });
    expect(u.texto).toBe("En ruta");
    expect(u.tono).toBe("ruta");
  });

  it("posición vieja dice «última vez», no que esté ahí", () => {
    const u = ubicacionDeVehiculo({
      presencia: {
        vehiculo_id: "v",
        estado: "STALE_POSITION",
        posicion_at: hace(60 * 50),
        delegacion: { id: "b", nombre: "Reus" },
      },
      ahora: AHORA,
    });
    expect(u.texto).toBe("Última vez en Reus");
    expect(u.detalle).toContain("hace 2 d");
    expect(u.tono).toBe("viejo");
  });

  it("sin nada de nada no se inventa una ruta", () => {
    const u = ubicacionDeVehiculo({ ahora: AHORA });
    expect(u.texto).toBe("Sin posición");
    expect(u.tono).toBe("desconocido");
  });

  it("un NO_POSITION del Hub cae al mismo «sin posición»", () => {
    const u = ubicacionDeVehiculo({
      presencia: { vehiculo_id: "v", estado: "NO_POSITION", delegacion: null },
      ahora: AHORA,
    });
    expect(u.texto).toBe("Sin posición");
  });

  it("sin dato del Hub vale el de Webfleet", () => {
    const u = ubicacionDeVehiculo({
      webfleet: {
        vehiculo_id: "v",
        empresa_id: "e",
        estado: "en_base",
        pos_time: hace(10),
        delegacion: { id: "b", nombre: "Vilanova" },
      },
      ahora: AHORA,
    });
    expect(u.texto).toBe("En base · Vilanova");
    expect(u.detalle).toBe("posición de hace 10 min");
  });

  it("manda el Hub cuando los dos dicen algo", () => {
    const u = ubicacionDeVehiculo({
      presencia: { vehiculo_id: "v", estado: "OUTSIDE_BASES", posicion_at: hace(3), delegacion: null },
      webfleet: {
        vehiculo_id: "v",
        empresa_id: "e",
        estado: "en_base",
        pos_time: hace(3),
        delegacion: { id: "b", nombre: "Vilanova" },
      },
      ahora: AHORA,
    });
    expect(u.texto).toBe("En ruta");
  });
});

/*
 * Llevar el vehículo al mapa.
 *
 * Lo que se fija aquí es cuándo NO se ofrece el mapa: un botón que lleva al
 * sitio equivocado es peor que no tener botón, porque alguien se sube al
 * coche a buscarlo.
 */
describe("coordenadasDeVehiculo", () => {
  const pres = (lat: any, lng: any, posicion_at?: string) =>
    ({ vehiculo_id: "v1", estado: "OUTSIDE_BASES", lat, lng, posicion_at } as any);
  const wf = (lat: any, lng: any, pos_time?: string) =>
    ({ vehiculo_id: "v1", empresa_id: "e1", estado: "en_ruta", lat, lng, pos_time } as any);

  it("sin ninguna fuente no hay mapa", () => {
    expect(coordenadasDeVehiculo({})).toBeNull();
  });

  it("una fila sin coordenadas no da mapa aunque diga dónde está", () => {
    expect(coordenadasDeVehiculo({ presencia: pres(null, null) })).toBeNull();
  });

  it("el 0,0 se descarta: es la falta de fijación GPS, no el golfo de Guinea", () => {
    expect(coordenadasDeVehiculo({ presencia: pres(0, 0) })).toBeNull();
  });

  it("una coordenada fuera de rango tampoco vale", () => {
    expect(coordenadasDeVehiculo({ presencia: pres(91, 2) })).toBeNull();
    expect(coordenadasDeVehiculo({ presencia: pres(41, 181) })).toBeNull();
    expect(coordenadasDeVehiculo({ presencia: pres("no es un número", 2) })).toBeNull();
  });

  it("con una sola fuente, esa manda", () => {
    expect(coordenadasDeVehiculo({ webfleet: wf(41.1, 1.25) })).toMatchObject({
      lat: 41.1, lng: 1.25, fuente: "webfleet",
    });
  });

  it("con las dos, manda la posición MÁS RECIENTE, no una fuente fija", () => {
    const vieja = "2026-09-16T08:00:00.000Z";
    const nueva = "2026-09-16T12:00:00.000Z";
    expect(coordenadasDeVehiculo({ presencia: pres(41, 1, vieja), webfleet: wf(42, 2, nueva) }))
      .toMatchObject({ lat: 42, fuente: "webfleet" });
    expect(coordenadasDeVehiculo({ presencia: pres(41, 1, nueva), webfleet: wf(42, 2, vieja) }))
      .toMatchObject({ lat: 41, fuente: "hub" });
  });

  it("la que trae fecha gana a la que no la trae", () => {
    expect(coordenadasDeVehiculo({ presencia: pres(41, 1), webfleet: wf(42, 2, "2026-09-16T12:00:00.000Z") }))
      .toMatchObject({ fuente: "webfleet" });
  });

  it("sin fechas en ninguna manda el Hub, que cubre a toda la flota", () => {
    expect(coordenadasDeVehiculo({ presencia: pres(41, 1), webfleet: wf(42, 2) }))
      .toMatchObject({ fuente: "hub" });
  });

  it("si la única fuente con coordenadas es la otra, da igual la fecha", () => {
    expect(coordenadasDeVehiculo({ presencia: pres(null, null, "2026-09-16T12:00:00.000Z"), webfleet: wf(42, 2) }))
      .toMatchObject({ lat: 42, fuente: "webfleet" });
  });
});

describe("enlaceDeMapa", () => {
  it("lleva la coordenada y nada más: ni matrícula, ni cliente, ni clave", () => {
    const url = enlaceDeMapa({ lat: 41.118_92, lng: 1.244_74, fuente: "hub" });
    expect(url).toBe("https://www.google.com/maps?q=41.118920,1.244740");
    expect(url).not.toMatch(/key|token|api_key/i);
  });
});
