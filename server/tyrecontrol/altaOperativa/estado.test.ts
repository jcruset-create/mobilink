/**
 * Lo que se fija aquí es LA LÍNEA: qué impide trabajar y qué no.
 *
 * El caso que más importa es el que parece raro: un vehículo sin marca, sin
 * modelo y sin bastidor, pero con su plano cubierto y medido, NO sale en esta
 * lista. Si saliera, el técnico se encontraría en la cola vehículos que no
 * puede arreglar —esos datos los pone oficina— y dejaría de mirar la cola.
 */

import { describe, expect, it } from "vitest";

import { accionDe, estadoDeAlta, pendientes, type VehiculoParaAlta } from "./estado.ts";

const veh = (p: Partial<VehiculoParaAlta> = {}): VehiculoParaAlta => ({
  id: "v1",
  matricula: "0000AAA",
  tipoId: "tipo-1",
  posicionesDelTipo: 6,
  posicionesConNeumatico: 6,
  posicionesConProfundidad: 6,
  ...p,
});

describe("estadoDeAlta", () => {
  it("sin tipo, lo primero es el tipo", () => {
    const e = estadoDeAlta(veh({ tipoId: null, posicionesDelTipo: 0, posicionesConNeumatico: 0, posicionesConProfundidad: 0 }));
    expect(e.operativo).toBe(false);
    expect(e.motivo).toBe("SIN_TIPO");
    expect(e.texto).toBe("Pendiente: tipo y configuración");
    // Sin plano no se enseña progreso: un "0 de 0" no dice nada.
    expect(e.progreso).toBeNull();
  });

  it("con tipo pero sin plano se dice, aunque el técnico no pueda arreglarlo", () => {
    const e = estadoDeAlta(veh({ posicionesDelTipo: 0, posicionesConNeumatico: 0, posicionesConProfundidad: 0 }));
    expect(e.motivo).toBe("TIPO_SIN_PLANO");
    // Las posiciones cuelgan del TIPO y las comparten todos sus vehículos: no
    // es algo que se resuelva desde la tablet, así que el botón no promete
    // que se pueda completar.
    expect(accionDe(e)).toBe("Ver el problema");
  });

  it("con el plano puesto y sin neumáticos, el progreso empieza en cero", () => {
    const e = estadoDeAlta(veh({ posicionesConNeumatico: 0, posicionesConProfundidad: 0 }));
    expect(e.motivo).toBe("INVENTARIO_INCOMPLETO");
    expect(e.texto).toBe("Inventario: 0 de 6 neumáticos informados");
    expect(e.progreso).toEqual({ hechas: 0, total: 6 });
    expect(accionDe(e)).toBe("Continuar inventario");
  });

  it("el inventario a medias cuenta posiciones, no neumáticos sueltos", () => {
    const e = estadoDeAlta(veh({ posicionesConNeumatico: 3, posicionesConProfundidad: 3 }));
    expect(e.texto).toBe("Inventario: 3 de 6 neumáticos informados");
    expect(e.progreso).toEqual({ hechas: 3, total: 6 });
  });

  it("con todos los neumáticos pero sin medir, lo que falta es la profundidad", () => {
    const e = estadoDeAlta(veh({ posicionesConProfundidad: 4 }));
    expect(e.motivo).toBe("SIN_MEDICION_INICIAL");
    expect(e.texto).toBe("Faltan profundidades: 4 de 6 medidos");
  });

  it("con el plano cubierto y medido, el vehículo es operativo", () => {
    expect(estadoDeAlta(veh()).operativo).toBe(true);
  });

  /*
   * La prueba que define el encargo: los datos de oficina no bloquean.
   *
   * Por eso este módulo NO recibe marca, modelo, año, bastidor ni delegación:
   * no es que se ignoren, es que no se pueden consultar desde aquí. Un cambio
   * que quisiera bloquear por ellos tendría que ampliar el tipo, y se vería.
   */
  it("no existe forma de bloquear por marca, modelo o bastidor", () => {
    const campos = Object.keys(veh());
    expect(campos).toEqual([
      "id", "matricula", "tipoId",
      "posicionesDelTipo", "posicionesConNeumatico", "posicionesConProfundidad",
    ]);
  });

  it("un recuento imposible no enseña «7 de 6»", () => {
    // Un montaje sobre una posición ya desactivada cuenta en la consulta y no
    // en el plano. Se recorta en vez de enseñar un número que no cuadra.
    const e = estadoDeAlta(veh({ posicionesDelTipo: 6, posicionesConNeumatico: 7, posicionesConProfundidad: 7 }));
    expect(e.operativo).toBe(true);
    expect(e.progreso).toEqual({ hechas: 6, total: 6 });
  });

  it("más profundidades que neumáticos tampoco: la profundidad no puede adelantar al montaje", () => {
    const e = estadoDeAlta(veh({ posicionesConNeumatico: 2, posicionesConProfundidad: 5 }));
    expect(e.motivo).toBe("INVENTARIO_INCOMPLETO");
    expect(e.progreso).toEqual({ hechas: 2, total: 6 });
  });
});

describe("pendientes", () => {
  it("deja fuera a los operativos", () => {
    const lista = pendientes([veh({ id: "ok" }), veh({ id: "no", tipoId: null, posicionesDelTipo: 0, posicionesConNeumatico: 0, posicionesConProfundidad: 0 })]);
    expect(lista.map((v) => v.id)).toEqual(["no"]);
  });

  it("primero lo que está a punto de terminarse, no lo que no se ha tocado", () => {
    // Terminar un vehículo al que le falta una rueda lo saca de la cola hoy;
    // empezar uno de cero deja dos a medias.
    const lista = pendientes([
      veh({ id: "sin-tipo", matricula: "AAA", tipoId: null, posicionesDelTipo: 0, posicionesConNeumatico: 0, posicionesConProfundidad: 0 }),
      veh({ id: "casi", matricula: "BBB", posicionesConNeumatico: 5, posicionesConProfundidad: 5 }),
      veh({ id: "medido-a-medias", matricula: "CCC", posicionesConProfundidad: 1 }),
    ]);
    expect(lista.map((v) => v.id)).toEqual(["medido-a-medias", "casi", "sin-tipo"]);
  });

  it("a igual motivo, primero el más adelantado", () => {
    const lista = pendientes([
      veh({ id: "poco", matricula: "AAA", posicionesConNeumatico: 1, posicionesConProfundidad: 1 }),
      veh({ id: "mucho", matricula: "BBB", posicionesConNeumatico: 5, posicionesConProfundidad: 5 }),
    ]);
    expect(lista.map((v) => v.id)).toEqual(["mucho", "poco"]);
  });

  it("el tipo sin plano va al final: no lo desbloquea el técnico", () => {
    const lista = pendientes([
      veh({ id: "sin-plano", matricula: "AAA", posicionesDelTipo: 0, posicionesConNeumatico: 0, posicionesConProfundidad: 0 }),
      veh({ id: "sin-tipo", matricula: "BBB", tipoId: null, posicionesDelTipo: 0, posicionesConNeumatico: 0, posicionesConProfundidad: 0 }),
    ]);
    expect(lista.map((v) => v.id)).toEqual(["sin-tipo", "sin-plano"]);
  });

  it("el orden no baila entre recargas", () => {
    const a = veh({ id: "1", matricula: "1111BBB", tipoId: null, posicionesDelTipo: 0, posicionesConNeumatico: 0, posicionesConProfundidad: 0 });
    const b = veh({ id: "2", matricula: "1111AAA", tipoId: null, posicionesDelTipo: 0, posicionesConNeumatico: 0, posicionesConProfundidad: 0 });
    expect(pendientes([a, b]).map((v) => v.id)).toEqual(pendientes([b, a]).map((v) => v.id));
  });
});
