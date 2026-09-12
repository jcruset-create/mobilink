/**
 * Pruebas del mapeo de Movertis.
 *
 * Son pruebas puras: ni red ni base. El mapeo es la parte que decide si un
 * kilometraje es de fiar, y lo que se fija aquí es el comportamiento que el
 * contrato exige pase lo que pase: no inventar, no perder la fecha, no dar por
 * buena una posición que no lo es.
 *
 * La segunda mitad son las formas REALES, con literales copiados de respuestas
 * de `devapi.hellomovertis.com`. Para lo que hace falta la API de verdad está
 * `MovertisConnector.integration.test.ts` (RUN_MOVERTIS=1).
 */

import { describe, expect, it } from "vitest";
import {
  aKilometros,
  aProviderVehicle,
  aVehicleTelemetry,
  fecha,
  filasDe,
  aLecturaDeFlota,
  aLecturaDePunto,
  aPosicionDeFlota,
  aVehiculoDeFlota,
  masCercana,
  matriculaDeNombre,
  numero,
  odometroDeCounters,
  puntosDeUnidad,
  resumenesDe,
  valorMovertis,
  type OpcionesMapeo,
} from "./mapeo.ts";
import type { VehicleTelemetry } from "../../../domain/telematics.ts";

const OPCIONES: OpcionesMapeo = {
  provider: "movertis",
  accountKey: "autobuses",
  unidadOdometro: "km",
};

describe("numero()", () => {
  it("no convierte la ausencia en cero", () => {
    // El punto entero del modelo: un cero de relleno es indistinguible de un
    // cero real, y en esta flota eso ya significó «no hay CAN».
    expect(numero(undefined)).toBeUndefined();
    expect(numero(null)).toBeUndefined();
    expect(numero("")).toBeUndefined();
    expect(numero("no disponible")).toBeUndefined();
  });

  it("acepta el cero real y la coma decimal", () => {
    expect(numero(0)).toBe(0);
    expect(numero("684327,4")).toBe(684327.4);
  });
});

describe("fecha()", () => {
  it("entiende ISO, epoch en segundos y epoch en milisegundos", () => {
    const esperado = Date.UTC(2026, 6, 15, 9, 40, 0);
    expect(fecha("2026-07-15T09:40:00Z")?.getTime()).toBe(esperado);
    expect(fecha(esperado / 1000)?.getTime()).toBe(esperado);
    expect(fecha(esperado)?.getTime()).toBe(esperado);
  });

  it("descarta lo que no es fecha en vez de propagar Invalid Date", () => {
    expect(fecha("cualquier cosa")).toBeUndefined();
    expect(fecha("")).toBeUndefined();
    expect(fecha(new Date("nada"))).toBeUndefined();
  });
});

describe("aKilometros()", () => {
  it("convierte según la unidad declarada y no redondea", () => {
    expect(aKilometros(684327.4, "km")).toBe(684327.4);
    expect(aKilometros(684327400, "m")).toBe(684327.4);
    expect(aKilometros(6843274, "hm")).toBe(684327.4);
  });

  it("deja pasar la ausencia", () => {
    expect(aKilometros(undefined, "m")).toBeUndefined();
  });

  it("sin unidad declarada no devuelve número", () => {
    // No hay unidad por defecto: 900.000 km y 900.000 m son indistinguibles
    // por magnitud, así que asumir una convertiría el error en silencioso.
    expect(aKilometros(684327.4, undefined)).toBeUndefined();
  });
});

describe("aProviderVehicle()", () => {
  it("lee los campos por sus nombres candidatos, en inglés o castellano", () => {
    const v = aProviderVehicle({
      id: "TSVETAN2",
      nombre: "Bus 14",
      matricula: "2321HZT",
      bastidor: "VF1234567890",
      marca: "Volvo",
      modelo: "9700",
      activo: "si",
    });
    expect(v).toMatchObject({
      providerVehicleId: "TSVETAN2",
      name: "Bus 14",
      plate: "2321HZT",
      vin: "VF1234567890",
      brand: "Volvo",
      model: "9700",
      active: true,
    });
  });

  it("acepta un vehículo sin matrícula", () => {
    // En el ejemplo de Movertis la unidad se llama TSVETAN2, que es un alias.
    // Sin matrícula no hay emparejamiento automático, pero el vehículo existe.
    const v = aProviderVehicle({ id: "TSVETAN2", name: "TSVETAN2" });
    expect(v?.providerVehicleId).toBe("TSVETAN2");
    expect(v?.plate).toBeUndefined();
  });

  it("descarta el registro sin identificador", () => {
    expect(aProviderVehicle({ nombre: "Sin id" })).toBeNull();
  });

  it("respeta los nombres de campo fijados en config", () => {
    const v = aProviderVehicle(
      { codigo_interno: "X9", id: "no-es-este" },
      { vehicleId: ["codigo_interno"] },
    );
    expect(v?.providerVehicleId).toBe("X9");
  });
});

describe("aVehicleTelemetry()", () => {
  it("exige los tres campos que hacen la lectura auditable", () => {
    // Sin fecha no se puede casar con el momento de una operación.
    expect(aVehicleTelemetry({ id: "A1", odometer: 100 }, OPCIONES)).toBeNull();
    // Sin vehículo no se sabe de qué es la lectura.
    expect(aVehicleTelemetry({ timestamp: "2026-07-15T09:40:00Z" }, OPCIONES)).toBeNull();
  });

  it("usa el id del vehículo pedido cuando la fila no lo trae", () => {
    // Las rutas por vehículo suelen omitirlo: ya está en la URL.
    const l = aVehicleTelemetry({ timestamp: "2026-07-15T09:40:00Z" }, OPCIONES, "A1");
    expect(l?.providerVehicleId).toBe("A1");
    expect(l?.provider).toBe("movertis");
    expect(l?.accountKey).toBe("autobuses");
  });

  it("no anuncia odómetro cuando no lo hay", () => {
    const l = aVehicleTelemetry({ id: "A1", timestamp: "2026-07-15T09:40:00Z" }, OPCIONES);
    expect(l?.odometerKm).toBeUndefined();
    expect(l?.odometerSource).toBeUndefined();
  });

  it("declara la procedencia del odómetro en vez de adivinarla", () => {
    const sinDeclarar = aVehicleTelemetry(
      { id: "A1", timestamp: "2026-07-15T09:40:00Z", odometer: 684327.4 },
      OPCIONES,
    );
    expect(sinDeclarar?.odometerSource).toBe("unknown");

    const declarado = aVehicleTelemetry(
      { id: "A1", timestamp: "2026-07-15T09:40:00Z", odometer: 684327.4 },
      { ...OPCIONES, origenOdometro: "gps" },
    );
    expect(declarado?.odometerSource).toBe("gps");
  });

  it("sin unidad declarada entrega la lectura pero sin odómetro", () => {
    // Lo que se protege: quien no ha pensado la unidad se queda sin el número,
    // no con uno mil veces menor. La lectura sigue sirviendo para la posición.
    const l = aVehicleTelemetry(
      {
        id: "A1",
        timestamp: "2026-07-15T09:40:00Z",
        odometer: 684327400,
        latitud: 41.1189,
        longitud: 1.2445,
      },
      { provider: "movertis", accountKey: "autobuses" },
    );
    expect(l).not.toBeNull();
    expect(l?.odometerKm).toBeUndefined();
    expect(l?.odometerSource).toBeUndefined();
    expect(l?.latitude).toBeCloseTo(41.1189);
  });

  it("convierte el odómetro a km sin perder decimales", () => {
    const l = aVehicleTelemetry(
      { id: "A1", timestamp: "2026-07-15T09:40:00Z", odometer: 684327400 },
      { ...OPCIONES, unidadOdometro: "m" },
    );
    expect(l?.odometerKm).toBe(684327.4);
  });

  it("descarta 0,0 como posición", () => {
    // Es válida en el Golfo de Guinea y, en telemática, significa «sin GPS».
    // Darla por buena pone autobuses de Tarragona en mitad del Atlántico.
    const l = aVehicleTelemetry(
      { id: "A1", timestamp: "2026-07-15T09:40:00Z", lat: 0, lon: 0 },
      OPCIONES,
    );
    expect(l?.latitude).toBeUndefined();
    expect(l?.longitude).toBeUndefined();
  });

  it("acepta una posición real", () => {
    const l = aVehicleTelemetry(
      { id: "A1", timestamp: "2026-07-15T09:40:00Z", latitud: 41.1189, longitud: 1.2445 },
      OPCIONES,
    );
    expect(l?.latitude).toBeCloseTo(41.1189);
    expect(l?.longitude).toBeCloseTo(1.2445);
  });

  it("solo fecha el odómetro aparte si el proveedor lo fecha aparte", () => {
    const sinFechaPropia = aVehicleTelemetry(
      { id: "A1", timestamp: "2026-07-15T09:40:00Z", odometer: 100 },
      OPCIONES,
    );
    // No se da por hecho que coincida con capturedAt: son sensores distintos.
    expect(sinFechaPropia?.odometerAt).toBeUndefined();

    const conFechaPropia = aVehicleTelemetry(
      {
        id: "A1",
        timestamp: "2026-07-15T09:40:00Z",
        odometer: 100,
        odometerTime: "2026-07-15T09:35:00Z",
      },
      OPCIONES,
    );
    expect(conFechaPropia?.odometerAt?.toISOString()).toBe("2026-07-15T09:35:00.000Z");
  });
});

describe("filasDe()", () => {
  it("saca la lista venga pelada o envuelta", () => {
    expect(filasDe([{ a: 1 }])).toHaveLength(1);
    expect(filasDe({ data: [{ a: 1 }, { a: 2 }] })).toHaveLength(2);
    expect(filasDe({ vehiculos: [{ a: 1 }] })).toHaveLength(1);
  });

  it("devuelve vacío ante algo que no contiene filas", () => {
    expect(filasDe(null)).toEqual([]);
    expect(filasDe("texto")).toEqual([]);
    expect(filasDe({ error: "vaya" })).toEqual([]);
  });
});

describe("masCercana()", () => {
  const lectura = (iso: string, km: number): VehicleTelemetry => ({
    provider: "movertis",
    accountKey: "autobuses",
    providerVehicleId: "A1",
    capturedAt: new Date(iso),
    odometerKm: km,
  });

  it("elige la más próxima al instante pedido", () => {
    const lecturas = [
      lectura("2026-07-15T09:00:00Z", 100),
      lectura("2026-07-15T09:50:00Z", 140),
      lectura("2026-07-15T10:30:00Z", 180),
    ];
    const r = masCercana(lecturas, new Date("2026-07-15T09:40:00Z"), 60);
    expect(r?.odometerKm).toBe(140);
  });

  it("devuelve null si nada cae dentro de la tolerancia", () => {
    // Un autobús parado en el taller puede no emitir en horas, y ese es justo
    // el momento en que se le cambian los neumáticos. El null es legítimo.
    const lecturas = [lectura("2026-07-15T06:00:00Z", 100)];
    expect(masCercana(lecturas, new Date("2026-07-15T09:40:00Z"), 15)).toBeNull();
  });

  it("no interpola entre dos lecturas", () => {
    // Devuelve una que existió, nunca un valor intermedio fabricado.
    const lecturas = [
      lectura("2026-07-15T09:30:00Z", 100),
      lectura("2026-07-15T09:50:00Z", 200),
    ];
    const r = masCercana(lecturas, new Date("2026-07-15T09:40:00Z"), 60);
    expect([100, 200]).toContain(r?.odometerKm);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Las formas reales de Movertis
// ════════════════════════════════════════════════════════════════════════════

describe("valorMovertis()", () => {
  it("los dos centinelas son ausencia, no lectura", () => {
    expect(valorMovertis(-348201.3876)).toBeUndefined();
    // El cero también: 17 de los 751 vehículos de la cuenta tienen odometer 0 y
    // son los marcados «Desinstalado» o «sin uso». Un odómetro total a cero no
    // existe en una flota que rueda.
    expect(valorMovertis(0)).toBeUndefined();
  });

  it("un valor real pasa, con sus decimales", () => {
    expect(valorMovertis(809052.369502)).toBe(809052.369502);
    expect(valorMovertis(809052)).toBe(809052);
  });
});

describe("matriculaDeNombre()", () => {
  it("saca la matrícula con cualquiera de los separadores que usa la cuenta", () => {
    // Los cuatro estilos que conviven en los 751 nombres reales.
    expect(matriculaDeNombre("604 - 1678 GCM")).toBe("1678GCM");
    expect(matriculaDeNombre("848 5053-HKC")).toBe("5053HKC");
    expect(matriculaDeNombre("977-4008-GWS")).toBe("4008GWS");
    expect(matriculaDeNombre("1260 -- 2001-JJR")).toBe("2001JJR");
  });

  it("no confunde el número de unidad con la matrícula", () => {
    // «1244» es la unidad y «5324-KLN» la matrícula: los dos son cuatro
    // dígitos, y lo que decide es que solo uno lleve tres letras detrás.
    expect(matriculaDeNombre("1244-5324-KLN")).toBe("5324KLN");
  });

  it("aguanta la cola que algunos nombres llevan detrás", () => {
    expect(matriculaDeNombre("1231- 4468-GJK- Desinstalado")).toBe("4468GJK");
    expect(matriculaDeNombre("1485 - 3639 GWM sin uso")).toBe("3639GWM");
  });

  it("no inventa matrícula donde no hay: son equipos sin vehículo", () => {
    for (const n of ["0000", "NO FUNCIONA", "Nueva_60007", "BUS 4 (1534)", "", null, 7]) {
      expect(matriculaDeNombre(n)).toBeUndefined();
    }
  });
});

describe("aVehiculoDeFlota()", () => {
  const FILA = { name: "604 - 1678 GCM", idVehicle: 26134116, classId: 2 };

  it("lee el id y el nombre por sus nombres reales y deduce la matrícula", () => {
    const v = aVehiculoDeFlota(FILA)!;
    expect(v.providerVehicleId).toBe("26134116");
    expect(v.name).toBe("604 - 1678 GCM");
    expect(v.plate).toBe("1678GCM");
  });

  it("sin matrícula deducible, el vehículo sigue valiendo", () => {
    const v = aVehiculoDeFlota({ name: "Nueva_60007", idVehicle: 1 })!;
    expect(v.providerVehicleId).toBe("1");
    expect(v.plate).toBeUndefined();
  });
});

describe("odometroDeCounters()", () => {
  it("lee counters.odometer con la unidad declarada", () => {
    expect(odometroDeCounters({ odometer: 809052, engineHours: 3394.15 }, "km")).toBe(809052);
  });

  it("un odometer a 0 es sin dato, no un vehículo a estrenar", () => {
    expect(odometroDeCounters({ odometer: 0, engineHours: 3240.28 }, "km")).toBeUndefined();
  });

  it("sin unidad declarada no hay odómetro, aunque el número esté ahí", () => {
    expect(odometroDeCounters({ odometer: 809052 }, undefined)).toBeUndefined();
  });

  it("sin counters no se cae", () => {
    expect(odometroDeCounters(undefined, "km")).toBeUndefined();
    expect(odometroDeCounters(null, "km")).toBeUndefined();
  });
});

describe("aLecturaDeFlota()", () => {
  it("la lectura actual trae odómetro y NO posición: showvehicles no la da", () => {
    const cuando = new Date("2026-09-12T08:35:50Z");
    const l = aLecturaDeFlota(
      { name: "604 - 1678 GCM", idVehicle: 26134116, counters: { odometer: 809052 } },
      OPCIONES,
      "26134116",
      cuando,
    );
    expect(l.odometerKm).toBe(809052);
    expect(l.capturedAt).toEqual(cuando);
    expect(l.latitude).toBeUndefined();
    expect(l.longitude).toBeUndefined();
  });
});

describe("aLecturaDePunto()", () => {
  const PUNTO = {
    time: 1789202150000,
    timeString: "2026-09-12T08:35:50.000Z",
    pos: "41.1299667358,1.18569278717",
  };

  it("parte la cadena «lat,lng», que es UN campo y no dos", () => {
    const l = aLecturaDePunto(PUNTO, OPCIONES, "26134116")!;
    expect(l.latitude).toBeCloseTo(41.1299667358, 8);
    expect(l.longitude).toBeCloseTo(1.18569278717, 8);
    expect(l.positionAt).toEqual(l.capturedAt);
  });

  it("el epoch viene en milisegundos", () => {
    const l = aLecturaDePunto(PUNTO, OPCIONES, "26134116")!;
    expect(l.capturedAt.toISOString()).toBe("2026-09-12T08:35:50.000Z");
  });

  it("NUNCA trae odómetro: es la ausencia sobre la que se decidió la fase", () => {
    expect(aLecturaDePunto(PUNTO, OPCIONES, "26134116")!.odometerKm).toBeUndefined();
  });

  it("sin fecha no hay lectura: el instante es lo que la hace auditable", () => {
    expect(aLecturaDePunto({ pos: "41.1,1.1" }, OPCIONES, "1")).toBeNull();
  });

  it("una posición imposible se descarta y la lectura sobrevive sin ella", () => {
    const l = aLecturaDePunto({ time: 1789202150000, pos: "0,0" }, OPCIONES, "1")!;
    expect(l.capturedAt).toBeInstanceOf(Date);
    expect(l.latitude).toBeUndefined();
  });

  it("aguanta un pos que no tiene la forma esperada", () => {
    for (const pos of ["41.1", "", "a,b", null, 41.1]) {
      const l = aLecturaDePunto({ time: 1789202150000, pos }, OPCIONES, "1")!;
      expect(l.latitude).toBeUndefined();
    }
  });
});

describe("puntosDeUnidad()", () => {
  const RESP = [{ unit: 26134116, coords: [{ time: 1, pos: "41,1" }, { time: 2, pos: "41,1" }] }];

  it("saca los puntos de la unidad pedida", () => {
    expect(puntosDeUnidad(RESP, "26134116")).toHaveLength(2);
  });

  it("con varias unidades elige la suya", () => {
    const dos = [{ unit: 1, coords: [{ time: 1 }] }, { unit: 2, coords: [{ time: 1 }, { time: 2 }] }];
    expect(puntosDeUnidad(dos, "2")).toHaveLength(2);
  });

  it("con una sola unidad no exige que el id case", () => {
    // Movertis no promete el tipo del id —número en la respuesta, cadena en su
    // documentación— y tirar la única respuesta buena por eso sería absurdo.
    expect(puntosDeUnidad(RESP, "26134116  ")).toHaveLength(2);
  });

  it("un vehículo que no ha emitido devuelve vacío, no un fallo", () => {
    // Pasa constantemente: de 10 vehículos con ventana de 15 minutos, 3
    // volvieron sin un solo punto. Están parados.
    expect(puntosDeUnidad([{ unit: 1, coords: [] }], "1")).toEqual([]);
    expect(puntosDeUnidad([], "1")).toEqual([]);
    expect(puntosDeUnidad(null, "1")).toEqual([]);
  });
});

/**
 * `summarytrips`: la forma con varias unidades NO está confirmada por la
 * sonda. Se fijan las tres formas que puede tener y, sobre todo, lo que no se
 * hace: colgarle a la primera unidad un objeto suelto cuando se pidieron dos.
 */
describe("resumenesDe()", () => {
  const RESUMEN = { initial_mileage: 512480, final_mileage: 520322, total_mileage: 7842, max_speed: 96, trips: 41 };

  it("forma 1: lista con `unit` por entrada", () => {
    const r = resumenesDe(
      [{ unit: 26053725, ...RESUMEN }, { unit: 30089320, ...RESUMEN, total_mileage: 8104 }],
      ["26053725", "30089320"],
    );
    expect(r.map((x) => [x.unit, x.total])).toEqual([["26053725", 7842], ["30089320", 8104]]);
    expect(r[0].inicial).toBe(512480);
    expect(r[0].final).toBe(520322);
    expect(r[0].viajes).toBe(41);
  });

  it("forma 1 con `trips` como lista: se cuenta la lista", () => {
    const r = resumenesDe([{ unit: 1, ...RESUMEN, trips: [{}, {}, {}] }], ["1"]);
    expect(r[0].viajes).toBe(3);
  });

  it("forma 2: objeto indexado por unidad", () => {
    const r = resumenesDe({ "26053725": RESUMEN, "30089320": { ...RESUMEN, total_mileage: 1 } }, ["26053725", "30089320"]);
    expect(r.map((x) => [x.unit, x.total])).toEqual([["26053725", 7842], ["30089320", 1]]);
  });

  it("forma 3: un objeto suelto se atribuye SOLO si se pidió una unidad", () => {
    expect(resumenesDe(RESUMEN, ["26053725"])).toMatchObject([{ unit: "26053725", total: 7842 }]);
    // Con dos pedidas, ¿de quién es? De nadie: vacío en vez de adivinar.
    expect(resumenesDe(RESUMEN, ["26053725", "30089320"])).toEqual([]);
  });

  it("una entrada sin ningún kilometraje no es un resumen", () => {
    expect(resumenesDe([{ unit: 1, max_speed: 90 }], ["1"])).toEqual([]);
  });

  it("respuesta vacía, nula o rara: vacío, no excepción", () => {
    expect(resumenesDe([], ["1"])).toEqual([]);
    expect(resumenesDe(null, ["1"])).toEqual([]);
    expect(resumenesDe("nada", ["1"])).toEqual([]);
    expect(resumenesDe({ data: [] }, ["1"])).toEqual([]);
  });

  it("los números vienen como cadena con coma y se leen igual", () => {
    const r = resumenesDe([{ unit: "7", total_mileage: "7842,5" }], ["7"]);
    expect(r[0].total).toBe(7842.5);
  });
});

describe("aPosicionDeFlota()", () => {
  /**
   * La fila tal como la devuelve `showvehicles` con `lastMessagePosition`,
   * copiada de la respuesta real de la cuenta. Los nombres son los que son:
   * `lon` (no `lng`), `date` en segundos, y ni contacto ni precisión.
   */
  const FILA = {
    idVehicle: 26053725,
    name: "604 - 1678 GCM",
    counters: { odometer: 809052 },
    lastPosition: {
      date: 1789229448,
      lat: 41.1299667358,
      lon: 1.18569278717,
      speed: 0,
      course: 166,
      lastMessage: 1789230829,
    },
  };

  it("lee la posición real, con `lon` y epoch en segundos", () => {
    const r = aPosicionDeFlota(FILA, OPCIONES, "26053725");
    expect(r?.latitude).toBeCloseTo(41.1299667358);
    expect(r?.longitude).toBeCloseTo(1.18569278717);
    // 1789229448 son segundos: si se tomaran por milisegundos saldría 1970.
    expect(r?.capturedAt.getUTCFullYear()).toBe(2026);
    expect(r?.positionAt?.getTime()).toBe(r?.capturedAt.getTime());
  });

  it("velocidad 0 es un dato, no una ausencia: el autobús está parado", () => {
    expect(aPosicionDeFlota(FILA, OPCIONES, "26053725")?.speedKmh).toBe(0);
  });

  it("el odómetro viene de propina y fechado con la posición", () => {
    const r = aPosicionDeFlota(FILA, OPCIONES, "26053725");
    expect(r?.odometerKm).toBe(809052);
    expect(r?.odometerAt?.getTime()).toBe(r?.capturedAt.getTime());
  });

  it("sin contadores hay posición pero no odómetro, y sin instante de odómetro", () => {
    const r = aPosicionDeFlota({ ...FILA, counters: undefined }, OPCIONES, "26053725");
    expect(r?.latitude).toBeCloseTo(41.1299667358);
    expect(r?.odometerKm).toBeUndefined();
    expect(r?.odometerAt).toBeUndefined();
  });

  it("sin `lastPosition`, sin fecha o en 0,0 devuelve null: mejor ausencia que invento", () => {
    expect(aPosicionDeFlota({ ...FILA, lastPosition: undefined }, OPCIONES, "1")).toBeNull();
    expect(
      aPosicionDeFlota({ ...FILA, lastPosition: { ...FILA.lastPosition, date: null } }, OPCIONES, "1"),
    ).toBeNull();
    expect(
      aPosicionDeFlota({ ...FILA, lastPosition: { ...FILA.lastPosition, lat: 0, lon: 0 } }, OPCIONES, "1"),
    ).toBeNull();
  });

  it("el centinela de «sin dato» no se cuela como coordenada", () => {
    const conCentinela = {
      ...FILA,
      lastPosition: { ...FILA.lastPosition, lat: -348201.3876, lon: -348201.3876 },
    };
    expect(aPosicionDeFlota(conCentinela, OPCIONES, "1")).toBeNull();
  });
});
