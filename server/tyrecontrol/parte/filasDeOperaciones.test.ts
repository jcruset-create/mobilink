/**
 * El caso real que lo motiva: parte OP-2026-000301, del R1234ABC. El técnico
 * desmontó dos gomas del eje 1 y montó dos, el parte quedó bien guardado, la
 * ficha de la intervención en el panel las enseñaba… y el PDF salía con las
 * dos tablas EN BLANCO, porque leía de tc_operacion_movimientos, que
 * tc_desmontar_neumatico y tc_montar_desde_catalogo no escriben.
 */
import { describe, it, expect } from "vitest";
import { filasDeOperaciones, tipoEnElPapel, serieDe, esNuevo, esDeclarado,
         type OperacionFila } from "./filasDeOperaciones.ts";
import { armarParte } from "./armarParte.ts";

const op = (o: Partial<OperacionFila> = {}): OperacionFila => ({
  tipo_operacion: "desmontaje", status: "completada", is_anulada: false,
  estado_anterior: "montado", motivo: "desgaste", destino: "desechado",
  neumatico: { marca: "Hankook", modelo: "AL10", medida: "385/65R22.5",
               numero_serie: null, dot: null, numero_interno: "NT-2026-000063" },
  posicion_origen: { codigo_posicion: "E1_IZQ" },
  ...o,
});

describe("qué es cada operación en el papel", () => {
  it("desmontaje y montaje, lo obvio", () => {
    expect(tipoEnElPapel(op())).toBe("desmontaje");
    expect(tipoEnElPapel(op({ tipo_operacion: "montaje" }))).toBe("montaje");
  });
  it("una sustitución es la que SALE si estaba montada", () => {
    expect(tipoEnElPapel(op({ tipo_operacion: "sustitucion", estado_anterior: "montado" })))
      .toBe("desmontaje");
  });
  it("y la que ENTRA si venía del almacén", () => {
    expect(tipoEnElPapel(op({ tipo_operacion: "sustitucion", estado_anterior: "almacen" })))
      .toBe("montaje");
  });
  it("un cambio de posición es las dos cosas: va a las dos tablas", () => {
    const p = armarParte({}, filasDeOperaciones([op({
      tipo_operacion: "cambio_posicion",
      posicion_origen: { codigo_posicion: "E1_IZQ" },
      posicion_destino: { codigo_posicion: "E3_DER" },
    })]));
    expect(p.desmontados).toHaveLength(1);
    expect(p.montados).toHaveLength(1);
    expect(p.desmontados![0].posicion).toBe("E1_IZQ");
    expect(p.montados![0].posicion).toBe("E3_DER");
  });
  it("una reparación no es ni montaje ni desmontaje: no va en esas tablas", () => {
    expect(tipoEnElPapel(op({ tipo_operacion: "reparacion" }))).toBeNull();
    expect(filasDeOperaciones([op({ tipo_operacion: "reparacion" })])).toHaveLength(0);
  });
});

describe("el número que identifica la goma", () => {
  it("manda el número de serie", () => {
    expect(serieDe({ numero_serie: "S-99", dot: "2325", numero_interno: "NT-1" })).toBe("S-99");
  });
  it("sin serie, el DOT", () => {
    expect(serieDe({ numero_serie: null, dot: "2325", numero_interno: "NT-1" })).toBe("2325");
  });
  it("sin ninguno de los dos, el número interno: antes quedaba en blanco", () => {
    expect(serieDe({ numero_serie: null, dot: null, numero_interno: "NT-2026-000063" }))
      .toBe("NT-2026-000063");
  });
  it("una cadena vacía no cuenta como dato", () => {
    expect(serieDe({ numero_serie: "  ", dot: "", numero_interno: "NT-1" })).toBe("NT-1");
  });
  it("sin neumático no se inventa nada", () => {
    expect(serieDe(null)).toBeNull();
  });
});

describe("lo que NO va al papel", () => {
  it("una operación anulada no se cuenta", () => {
    expect(filasDeOperaciones([op({ is_anulada: true })])).toHaveLength(0);
  });
  it("una prevista sin ejecutar tampoco", () => {
    expect(filasDeOperaciones([op({ status: "planificada" })])).toHaveLength(0);
  });
  it("sin status se cuenta: las filas viejas no lo tenían", () => {
    expect(filasDeOperaciones([op({ status: null })])).toHaveLength(1);
  });
});

describe("el parte del R1234ABC, entero", () => {
  const ops = [
    op({ posicion_origen: { codigo_posicion: "E1_IZQ" },
         neumatico: { marca: "Hankook", modelo: "AL10", medida: "385/65R22.5",
                      numero_serie: "SER-0063", dot: null, numero_interno: "NT-2026-000063" } }),
    op({ posicion_origen: { codigo_posicion: "E1_DER" },
         neumatico: { marca: "Hankook", modelo: "AL10", medida: "385/65R22.5",
                      numero_serie: null, dot: null, numero_interno: "NT-2026-000070" } }),
    op({ tipo_operacion: "montaje", estado_anterior: "almacen", motivo: null, destino: "vehiculo",
         posicion_origen: null, posicion_destino: { codigo_posicion: "E1_IZQ" },
         neumatico: { marca: "Continental", modelo: "HDR", medida: "385/65R22.5",
                      numero_serie: null, dot: "2325", numero_interno: "NT-2026-000055" } }),
    op({ tipo_operacion: "montaje", estado_anterior: "almacen", observaciones: "montaje [USADO]",
         motivo: null, destino: "vehiculo",
         posicion_origen: null, posicion_destino: { codigo_posicion: "E1_DER" },
         neumatico: { marca: "Continental", modelo: "HDR", medida: "385/65R22.5",
                      numero_serie: null, dot: "1224", numero_interno: "NT-2026-000056" } }),
  ];
  const medidas = { E1_IZQ: { profundidad_mm: 3.2, presion_bar: 9 },
                    E1_DER: { profundidad_mm: 2.8, presion_bar: 8.5 } };
  const p = armarParte({ numero: "OP-2026-000301", matricula: "R1234ABC" },
                       filasDeOperaciones(ops, medidas));

  it("los dos desmontados salen, con su razón y su destino", () => {
    expect(p.desmontados).toHaveLength(2);
    expect(p.desmontados![0].razon).toBe("desgaste");
    expect(p.desmontados![0].destino).toBe("desechado");
  });
  it("con la descripción de la goma que salió", () => {
    expect(p.desmontados![0].descripcion).toBe("385/65R22.5 Hankook AL10");
  });
  it("y el número de serie de la que lo tiene", () => {
    expect(p.desmontados![0].serie).toBe("SER-0063");
  });
  it("la que no tiene serie cae al número interno, no queda en blanco", () => {
    expect(p.desmontados![1].serie).toBe("NT-2026-000070");
  });
  it("los milímetros del desmontado son los medidos en la revisión", () => {
    expect(p.desmontados![0].mm).toBe("3.2");
    expect(p.desmontados![1].mm).toBe("2.8");
  });
  it("la presión también", () => {
    expect(p.desmontados![0].bar).toBe("9.0");
  });
  it("los dos montados salen en su tabla", () => {
    expect(p.montados).toHaveLength(2);
    expect(p.montados![0].posicion).toBe("E1_IZQ");
  });
  it("y en «nuevos montados» solo el que no venía marcado como usado", () => {
    expect(p.nuevos).toHaveLength(1);
    expect(p.nuevos![0].marca).toBe("Continental");
    expect(p.nuevos![0].unidades).toBe(1);
  });
  it("la cabecera sigue siendo la de la intervención", () => {
    expect(p.numero).toBe("OP-2026-000301");
    expect(p.matricula).toBe("R1234ABC");
  });
});

/**
 * El parte OP-2026-000302: un camión que llegó sin ninguna goma fichada. El
 * técnico declaró las seis que llevaba y cambió UNA. El papel salió con las
 * seis en «Neumáticos Montados» y con «6 Sailun» en neumáticos nuevos, como si
 * las hubiéramos puesto nosotros. Ese papel se le da al cliente.
 */
describe("lo que el camión ya llevaba no es trabajo", () => {
  const declarada = (pos: string) => op({
    tipo_operacion: "montaje", estado_anterior: "almacen",
    observaciones: "Lo que ya llevaba, declarado en el parte [DECLARADO]",
    motivo: null, destino: "vehiculo",
    posicion_origen: null, posicion_destino: { codigo_posicion: pos },
    neumatico: { marca: "Sailun", modelo: "STL1", medida: "385/55R22.5",
                 numero_serie: null, dot: null, numero_interno: `NT-${pos}` },
  });

  it("una goma declarada se reconoce", () => {
    expect(esDeclarado(declarada("E1_IZQ"))).toBe(true);
    expect(esDeclarado(op({ tipo_operacion: "montaje" }))).toBe(false);
  });

  it("y también en los partes guardados antes de que existiera el marcador", () => {
    expect(esDeclarado(op({ observaciones: "Lo que ya llevaba, declarado en el parte" })))
      .toBe(true);
  });

  it("las declaradas NO salen en montados", () => {
    const p = armarParte({}, filasDeOperaciones([
      declarada("E1_IZQ"), declarada("E1_DER"), declarada("E2_IZQ"),
    ]));
    expect(p.montados).toHaveLength(0);
  });

  it("ni cuentan como neumáticos nuevos montados", () => {
    const p = armarParte({}, filasDeOperaciones([
      declarada("E1_IZQ"), declarada("E1_DER"),
    ]));
    expect(p.nuevos).toHaveLength(0);
  });

  it("pero DESMONTAR una de ellas sí es trabajo y sale", () => {
    const p = armarParte({}, filasDeOperaciones([
      declarada("E1_IZQ"),
      op({ posicion_origen: { codigo_posicion: "E1_IZQ" } }),   // desmontaje
    ]));
    expect(p.desmontados).toHaveLength(1);
    expect(p.montados).toHaveLength(0);
  });

  it("y la que se monta DE VERDAD en su sitio sí sale", () => {
    const p = armarParte({}, filasDeOperaciones([
      declarada("E1_IZQ"),
      op({ posicion_origen: { codigo_posicion: "E1_IZQ" } }),
      op({ tipo_operacion: "montaje", estado_anterior: "almacen",
           observaciones: "montaje desde almacén", motivo: null, destino: "vehiculo",
           posicion_origen: null, posicion_destino: { codigo_posicion: "E1_IZQ" },
           neumatico: { marca: "Continental", modelo: "HDR", medida: "385/55R22.5",
                        numero_serie: "S-1", dot: null, numero_interno: "NT-9" } }),
    ]));
    expect(p.montados).toHaveLength(1);
    expect(p.montados![0].descripcion).toContain("Continental");
    expect(p.nuevos).toHaveLength(1);
    expect(p.nuevos![0].unidades).toBe(1);
  });
});
