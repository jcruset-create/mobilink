/**
 * De lo que dice el correo a la ficha del vehículo.
 *
 * Los casos no son inventados: son los siete vehículos reales que aparecieron
 * en los diez avisos que se miraron antes de escribir esto, con sus posiciones
 * tal como están hoy en `tc_posiciones_vehiculo`. Dos de los siete no casan por
 * código de posición, y ésa es la razón de que este fichero exista.
 */

import { describe, expect, it } from "vitest";

import { casarPosicion, casarVehiculo, severidadDe, type PosicionFicha, type VehiculoFicha } from "./casado.ts";

/** Las seis ruedas de un autobús de dos ejes con gemelas detrás (1467HJS). */
const BUS_6: PosicionFicha[] = [
  { id: "p1", codigo_posicion: "E1_IZQ", eje: 1, lado: "izq", interior_exterior: null },
  { id: "p2", codigo_posicion: "E1_DER", eje: 1, lado: "der", interior_exterior: null },
  { id: "p3", codigo_posicion: "E2_IZQ_EXT", eje: 2, lado: "izq", interior_exterior: "ext" },
  { id: "p4", codigo_posicion: "E2_IZQ_INT", eje: 2, lado: "izq", interior_exterior: "int" },
  { id: "p5", codigo_posicion: "E2_DER_INT", eje: 2, lado: "der", interior_exterior: "int" },
  { id: "p6", codigo_posicion: "E2_DER_EXT", eje: 2, lado: "der", interior_exterior: "ext" },
];

/** Las cuatro de una furgoneta (4568JXB). Ojo al OTRO esquema de nombres. */
const FURGO_4: PosicionFicha[] = [
  { id: "f1", codigo_posicion: "DEL_IZQ", eje: 1, lado: "izq", interior_exterior: null },
  { id: "f2", codigo_posicion: "DEL_DER", eje: 1, lado: "der", interior_exterior: null },
  { id: "f3", codigo_posicion: "TRAS_IZQ", eje: 2, lado: "izq", interior_exterior: null },
  { id: "f4", codigo_posicion: "TRAS_DER", eje: 2, lado: "der", interior_exterior: null },
];

/** Las ocho de un tres ejes (7436KVK): gemelas en el 2, simples en el 3. */
const TRES_EJES_8: PosicionFicha[] = [
  ...BUS_6,
  { id: "p7", codigo_posicion: "E3_IZQ", eje: 3, lado: "izq", interior_exterior: null },
  { id: "p8", codigo_posicion: "E3_DER", eje: 3, lado: "der", interior_exterior: null },
];

const veh = (over: Partial<VehiculoFicha> = {}): VehiculoFicha => ({
  id: "v1", empresa_id: "plana", matricula: "1467HJS",
  numero_unidad: "854", tipo_vehiculo_id: "t1", ...over,
});

describe("qué vehículo es", () => {
  it("una matrícula y su ID de flota coincidiendo: casa", () => {
    const r = casarVehiculo([veh()], { matricula: "1467HJS", idFlota: "854" });
    expect("motivo" in r ? r.motivo : r.id).toBe("v1");
  });

  it("una matrícula que no está en ninguna flota", () => {
    const r = casarVehiculo([], { matricula: "0000AAA", idFlota: "1" });
    expect("motivo" in r && r.motivo).toContain("no está en ninguna flota");
  });

  it("la misma matrícula en dos empresas NO se elige", () => {
    // Hoy no se repite ninguna de las 909, pero el índice único es
    // (empresa_id, matricula): la base lo permite. Elegir una sería abrir la
    // alerta en la empresa equivocada sin que nada fallara a la vista.
    const r = casarVehiculo(
      [veh(), veh({ id: "v2", empresa_id: "otra" })],
      { matricula: "1467HJS", idFlota: "854" },
    );
    expect("motivo" in r && r.motivo).toContain("2 empresas");
  });

  it("si la matrícula y el ID de flota se contradicen, se aparta", () => {
    // La matrícula manda y el ID de flota contrasta. Que apunten a sitios
    // distintos es justo el caso en que elegir uno sería inventar.
    const r = casarVehiculo([veh()], { matricula: "1467HJS", idFlota: "999" });
    expect("motivo" in r && r.motivo).toContain("999");
    expect("motivo" in r && r.motivo).toContain("854");
  });

  it("sin ID de flota en el correo, la matrícula basta", () => {
    const r = casarVehiculo([veh()], { matricula: "1467HJS", idFlota: null });
    expect("motivo" in r ? r.motivo : r.id).toBe("v1");
  });

  it("si la ficha no tiene número de unidad, no se exige", () => {
    const r = casarVehiculo([veh({ numero_unidad: null })], { matricula: "1467HJS", idFlota: "854" });
    expect("motivo" in r ? r.motivo : r.id).toBe("v1");
  });
});

describe("qué rueda es", () => {
  it("la terna exacta, en un eje de gemelas", () => {
    const r = casarPosicion(BUS_6, { eje: 2, lado: "der", interiorExterior: "int" });
    expect("motivo" in r ? r.motivo : r.codigo_posicion).toBe("E2_DER_INT");
  });

  it("un eje de rueda simple: el «exterior» del correo sobra", () => {
    // Caso real de 4568JXB. El correo dice «Eje 2 - izquierdo exterior» de una
    // furgoneta cuyo eje trasero lleva UNA rueda por lado. Si se exigiera la
    // terna exacta, este aviso se perdería.
    const r = casarPosicion(FURGO_4, { eje: 2, lado: "izq", interiorExterior: "ext" });
    expect("motivo" in r ? r.motivo : r.codigo_posicion).toBe("TRAS_IZQ");
  });

  it("y el «interior» del eje 3, igual", () => {
    // Caso real de 7436KVK: el eje 3 es simple y el correo dice «interior».
    const r = casarPosicion(TRES_EJES_8, { eje: 3, lado: "der", interiorExterior: "int" });
    expect("motivo" in r ? r.motivo : r.codigo_posicion).toBe("E3_DER");
  });

  it("no se casa por el código: hay dos esquemas de nombres", () => {
    // DEL_/TRAS_ en la furgoneta y E1_/E2_/E3_ en el autobús. Casar por el
    // código habría fallado en 2 de los 7 vehículos reales.
    const codigos = [...FURGO_4, ...TRES_EJES_8].map((p) => p.codigo_posicion);
    expect(codigos).toContain("TRAS_IZQ");
    expect(codigos).toContain("E3_DER");
  });

  it("en un eje de gemelas SIN decir interior/exterior, no se adivina", () => {
    // Hay dos candidatas y elegir una es tirar una moneda. Entre avisar de la
    // rueda equivocada y no avisar, no avisar es lo honesto.
    const r = casarPosicion(BUS_6, { eje: 2, lado: "der", interiorExterior: null });
    expect("motivo" in r && r.motivo).toContain("No hay una sola posición");
  });

  it("un eje que el vehículo no tiene", () => {
    const r = casarPosicion(FURGO_4, { eje: 3, lado: "der", interiorExterior: null });
    expect("motivo" in r && r.motivo).toContain("no tiene eje 3");
  });

  it("los siete vehículos reales, con su rueda real", () => {
    const casos: Array<[string, PosicionFicha[], number, "izq" | "der", "int" | "ext" | null, string]> = [
      ["1467HJS", BUS_6, 2, "der", "int", "E2_DER_INT"],
      ["5015HKC", BUS_6, 2, "der", "int", "E2_DER_INT"],
      ["4568JXB", FURGO_4, 2, "izq", "ext", "TRAS_IZQ"],
      ["6439LJS", BUS_6, 2, "der", "int", "E2_DER_INT"],
      ["7436KVK", TRES_EJES_8, 3, "der", "int", "E3_DER"],
      ["4452MSG", BUS_6, 2, "der", "int", "E2_DER_INT"],
      ["2343JDD", BUS_6, 2, "izq", "ext", "E2_IZQ_EXT"],
    ];
    for (const [matricula, ruedas, eje, lado, intExt, esperado] of casos) {
      const r = casarPosicion(ruedas, { eje, lado, interiorExterior: intExt });
      expect("motivo" in r ? r.motivo : r.codigo_posicion, matricula).toBe(esperado);
    }
  });
});

describe("con qué severidad entra", () => {
  it("los dos tipos conocidos son altos", () => {
    expect(severidadDe("desinflado")).toBe("alta");
    expect(severidadDe("presion_baja")).toBe("alta");
  });

  it("la severidad sale del tipo, no del porcentaje", () => {
    // El desinflado no trae porcentaje y es el más grave: deducirla del número
    // dejaría el peor aviso sin severidad.
    expect(severidadDe("desinflado")).toBe("alta");
  });
});
