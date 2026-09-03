import { describe, it, expect } from "vitest";
import { armarParte, agruparNuevos, descripcion, hora, fechaCorta,
         type MovimientoFila } from "./armarParte.ts";

const mov = (o: Partial<MovimientoFila> = {}): MovimientoFila => ({
  movimiento_tipo: "desmontaje", posicion: "E1_IZQ",
  marca: "Michelin", modelo: "X Multi D", medida: "315/80R22.5",
  serie: "DOT2325", profundidad_anterior: 3.2, profundidad_final: 14.0,
  presion_bar: 9, motivo: "desgaste", destino: "carcasa_continental", ...o,
});

describe("la hora y la fecha del papel", () => {
  it("la hora sale en HH:MM", () => {
    expect(hora("2026-09-01T08:05:00")).toBe("08:05");
  });
  it("una hora que no existe no se inventa", () => {
    expect(hora(null)).toBeNull();
    expect(hora("no es una fecha")).toBeNull();
  });
  it("la fecha va como en el papel: dd/mm/aaaa", () => {
    expect(fechaCorta("2026-09-01")).toBe("01/09/2026");
  });
});

describe("la descripción, que en el papel es UNA columna", () => {
  it("medida primero: es lo que se busca al repasar el parte", () => {
    expect(descripcion(mov())).toBe("315/80R22.5 Michelin X Multi D");
  });
  it("lo que no se sabe se omite, sin guiones sueltos que parezcan un dato", () => {
    expect(descripcion(mov({ modelo: null, marca: null }))).toBe("315/80R22.5");
    expect(descripcion(mov({ medida: null, modelo: null, marca: null }))).toBe("");
  });
});

describe("qué va en cada tabla", () => {
  it("un desmontaje va a desmontados, con su razón y su destino", () => {
    const p = armarParte({}, [mov()]);
    expect(p.desmontados).toHaveLength(1);
    expect(p.montados).toHaveLength(0);
    expect(p.desmontados![0].razon).toBe("desgaste");
    expect(p.desmontados![0].destino).toBe("carcasa_continental");
  });
  it("un montaje va a montados, con su origen", () => {
    const p = armarParte({}, [mov({ movimiento_tipo: "montaje", origen: "Nuevo" })]);
    expect(p.montados).toHaveLength(1);
    expect(p.montados![0].origen).toBe("Nuevo");
    expect(p.desmontados).toHaveLength(0);
  });
  it("un cambio de posición sale en LAS DOS tablas", () => {
    // En la base de datos es un movimiento; en el papel el tecnico tiene que
    // ver de donde salio la goma y donde acabo.
    const p = armarParte({}, [mov({ movimiento_tipo: "cambio_posicion" })]);
    expect(p.desmontados).toHaveLength(1);
    expect(p.montados).toHaveLength(1);
  });
});

describe("los milímetros: son dos medidas distintas", () => {
  it("el desmontado lleva con cuánto SE RETIRÓ", () => {
    expect(armarParte({}, [mov()]).desmontados![0].mm).toBe("3.2");
  });
  it("el montado, con cuánto ENTRA", () => {
    expect(armarParte({}, [mov({ movimiento_tipo: "montaje" })]).montados![0].mm).toBe("14.0");
  });
  it("sin medida no se pone un cero que parecería una goma gastada", () => {
    const p = armarParte({}, [mov({ profundidad_anterior: null })]);
    expect(p.desmontados![0].mm).toBeNull();
  });
});

describe("neumáticos nuevos, agrupados como los pide el papel", () => {
  it("tres iguales son una línea con 3 unidades, no tres líneas", () => {
    const n = agruparNuevos([
      mov({ movimiento_tipo: "montaje", es_nuevo: true }),
      mov({ movimiento_tipo: "montaje", es_nuevo: true }),
      mov({ movimiento_tipo: "montaje", es_nuevo: true }),
    ]);
    expect(n).toHaveLength(1);
    expect(n[0].unidades).toBe(3);
  });
  it("distinto modelo, línea distinta", () => {
    const n = agruparNuevos([
      mov({ movimiento_tipo: "montaje", es_nuevo: true }),
      mov({ movimiento_tipo: "montaje", es_nuevo: true, modelo: "X Multi Z" }),
    ]);
    expect(n).toHaveLength(2);
  });
  it("los usados NO cuentan como nuevos", () => {
    expect(agruparNuevos([mov({ movimiento_tipo: "montaje", es_nuevo: false })])).toHaveLength(0);
  });
  it("un desmontaje no cuenta aunque venga marcado como nuevo", () => {
    expect(agruparNuevos([mov({ movimiento_tipo: "desmontaje", es_nuevo: true })])).toHaveLength(0);
  });
  it("la grafía no parte el recuento", () => {
    const n = agruparNuevos([
      mov({ movimiento_tipo: "montaje", es_nuevo: true, marca: "Michelin" }),
      mov({ movimiento_tipo: "montaje", es_nuevo: true, marca: " MICHELIN " }),
    ]);
    expect(n).toHaveLength(1);
    expect(n[0].unidades).toBe(2);
  });
});

describe("servicios y cabecera", () => {
  it("un servicio con cantidad 0 no se imprime: una casilla vacía dice más", () => {
    const p = armarParte({}, [], [{ servicio: "equilibrado", cantidad: 0 },
                                  { servicio: "valvulas", cantidad: 4 }]);
    expect(p.servicios).toEqual({ valvulas: 4 });
  });
  it("la cabecera sale de la intervención", () => {
    const p = armarParte({
      numero: "NT-2026-000123", matricula: "1234ABC", flota: "PLANA", km: 245817,
      fecha: "2026-09-01", lugar_servicio: "carretera",
      inicio_at: "2026-09-01T08:15:00", mecanico_km: 42,
      firma_cliente_nombre: "Jordi", firma_cliente_dni: "12345678Z",
    }, []);
    expect(p.numero).toBe("NT-2026-000123");
    expect(p.km).toBe("245817");
    expect(p.fecha).toBe("01/09/2026");
    expect(p.lugar).toBe("carretera");
    expect(p.inicio_servicio).toBe("08:15");
    expect(p.km_mecanico).toBe("42");
    expect(p.cliente_dni).toBe("12345678Z");
  });
  it("una intervención vacía da un parte vacío, no revienta", () => {
    const p = armarParte({}, []);
    expect(p.desmontados).toEqual([]);
    expect(p.montados).toEqual([]);
    expect(p.nuevos).toEqual([]);
  });
});
