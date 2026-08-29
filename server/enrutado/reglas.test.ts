/**
 * Motor de reglas: cuándo dispara una regla y qué hace.
 *
 * Lo que más se prueba aquí es lo que un usuario espera al escribirla, que no
 * siempre es lo que un programador implementaría: rellenar solo la provincia
 * significa «en esa provincia», y dos reglas que se contradicen no se suman.
 */

import { describe, expect, it } from "vitest";

import { aplica, decidir, leerRegla, type Regla } from "./reglas.ts";

function regla(cambios: Partial<Regla> = {}): Regla {
  return {
    id: 1, controlCenterId: 1, nombre: "R", orden: 100, activa: true,
    condicion: {}, accion: "preferir", partners: [], ajuste: 10, ...cambios,
  };
}

describe("Cuándo aplica una regla", () => {
  /* Es como se escribe «a este partner nunca». */
  it("una regla sin condiciones aplica siempre", () => {
    expect(aplica(regla(), {})).toBe(true);
  });

  it("una regla desactivada no aplica aunque encaje", () => {
    expect(aplica(regla({ activa: false }), {})).toBe(false);
  });

  /* Poner solo «Teruel» significa «en Teruel», no «en Teruel o donde sea». */
  it("los campos rellenos se exigen todos; los vacíos no opinan", () => {
    const r = regla({ condicion: { provincias: ["Teruel"], servicios: ["tow_truck"] } });
    expect(aplica(r, { provincia: "Teruel", servicio: "tow_truck" })).toBe(true);
    expect(aplica(r, { provincia: "Teruel", servicio: "tyres" })).toBe(false);
    expect(aplica(r, { provincia: "Soria", servicio: "tow_truck" })).toBe(false);
  });

  it("si la regla exige un campo y el caso no lo trae, no aplica", () => {
    expect(aplica(regla({ condicion: { provincias: ["Teruel"] } }), {})).toBe(false);
  });

  it("compara sin distinguir mayúsculas", () => {
    expect(aplica(regla({ condicion: { servicios: ["TOW_TRUCK"] } }), { servicio: "tow_truck" })).toBe(true);
  });

  it("los códigos postales admiten prefijo", () => {
    const r = regla({ condicion: { codigosPostales: ["43"] } });
    expect(aplica(r, { codigoPostal: "43201" })).toBe(true);
    expect(aplica(r, { codigoPostal: "08001" })).toBe(false);
  });

  it("la franja nocturna cruza la medianoche", () => {
    const r = regla({ condicion: { desdeMinuto: 22 * 60, hastaMinuto: 6 * 60 } });
    expect(aplica(r, { cuando: new Date(2026, 0, 5, 23, 30) })).toBe(true);
    expect(aplica(r, { cuando: new Date(2026, 0, 6, 3, 0) })).toBe(true);
    expect(aplica(r, { cuando: new Date(2026, 0, 6, 12, 0) })).toBe(false);
  });

  it("el importe mínimo se compara como umbral, no como igualdad", () => {
    const r = regla({ condicion: { importeDesde: 500 } });
    expect(aplica(r, { importeEstimado: 500 })).toBe(true);
    expect(aplica(r, { importeEstimado: 499 })).toBe(false);
  });

  it("filtra por cliente concreto", () => {
    const r = regla({ condicion: { clientes: [7] } });
    expect(aplica(r, { clienteId: 7 })).toBe(true);
    expect(aplica(r, { clienteId: 8 })).toBe(false);
  });
});

describe("Qué hace la decisión", () => {
  const todos = [1, 2, 3];

  it("excluir deja fuera a los partners que nombra", () => {
    const d = decidir([regla({ accion: "excluir", partners: [2] })], {}, todos);
    expect(d.excluidos.has(2)).toBe(true);
    expect(d.excluidos.has(1)).toBe(false);
  });

  it("excluir sin partners concretos deja fuera a todos los que encajan", () => {
    const d = decidir([regla({ accion: "excluir" })], {}, todos);
    expect([...d.excluidos.keys()].sort()).toEqual([1, 2, 3]);
  });

  it("forzar deja solo a los suyos", () => {
    const d = decidir([regla({ accion: "forzar", partners: [3] })], {}, todos);
    expect(d.forzados).toEqual([3]);
  });

  /*
   * Sumar las dos listas convertiría un «siempre a éste» en «a cualquiera de
   * estos dos», que es lo contrario de lo que se pidió.
   */
  it("dos reglas que fuerzan distinto no se suman: gana la de menor orden", () => {
    const d = decidir([
      regla({ id: 1, orden: 50, accion: "forzar", partners: [1], nombre: "Primera" }),
      regla({ id: 2, orden: 10, accion: "forzar", partners: [2], nombre: "Más prioritaria" }),
    ], {}, todos);
    expect(d.forzados).toEqual([2]);
  });

  it("forzar «a todos» no significa nada y se ignora", () => {
    const d = decidir([regla({ accion: "forzar", partners: [] })], {}, todos);
    expect(d.forzados).toEqual([]);
  });

  it("preferir y penalizar se acumulan sobre el mismo partner", () => {
    const d = decidir([
      regla({ id: 1, accion: "preferir", partners: [1], ajuste: 10 }),
      regla({ id: 2, accion: "penalizar", partners: [1], ajuste: 4 }),
    ], {}, todos);
    expect(d.ajustes.get(1)).toBe(6);
  });

  it("el signo del ajuste lo pone la acción, no el número", () => {
    const d = decidir([regla({ accion: "penalizar", partners: [1], ajuste: -5 })], {}, todos);
    expect(d.ajustes.get(1)).toBe(-5);
  });

  it("exigir presupuesto es una bandera, no un filtro", () => {
    const d = decidir([regla({ accion: "exigir_presupuesto" })], {}, todos);
    expect(d.exigirPresupuesto).toBe(true);
    expect(d.excluidos.size).toBe(0);
  });

  it("una regla que no encaja no deja rastro", () => {
    const d = decidir([regla({ condicion: { provincias: ["Teruel"] } })], { provincia: "Soria" }, todos);
    expect(d.aplicadas).toHaveLength(0);
  });

  it("anota todo lo aplicado, para poder contarlo después", () => {
    const d = decidir([regla({ nombre: "Camiones a Pesadas", accion: "preferir", partners: [1] })], {}, todos);
    expect(d.aplicadas[0].regla.nombre).toBe("Camiones a Pesadas");
    expect(d.aplicadas[0].partners).toEqual([1]);
  });
});

describe("Lectura de lo guardado", () => {
  it("una condición corrupta se lee como vacía en vez de tumbar el enrutado", () => {
    const r = leerRegla({ id: 1, controlCenterId: 1, name: "X", condition: "{roto", action: "excluir" });
    expect(r.condicion).toEqual({});
    expect(r.accion).toBe("excluir");
  });

  /* Interpretarla como «excluir» dejaría un partner fuera por un error de datos. */
  it("una acción desconocida se degrada a algo inofensivo", () => {
    const r = leerRegla({ id: 1, controlCenterId: 1, name: "X", action: "borrar_todo" });
    expect(r.accion).toBe("penalizar");
    expect(r.ajuste).toBe(0);
  });

  it("los partners no numéricos se descartan", () => {
    const r = leerRegla({ id: 1, controlCenterId: 1, name: "X", partners: '[1,"dos",3]' });
    expect(r.partners).toEqual([1, 3]);
  });

  it("una regla sin `active` se considera activa", () => {
    expect(leerRegla({ id: 1, controlCenterId: 1, name: "X" }).activa).toBe(true);
  });
});
