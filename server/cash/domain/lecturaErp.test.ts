import { describe, expect, it } from "vitest";
import { importeAEnteros, interpretarLecturaErp } from "./lecturaErp.ts";

describe("leer un importe del ERP", () => {
  it("el formato que imprime: coma decimal", () => {
    expect(importeAEnteros("29,69")).toBe(2969);
    expect(importeAEnteros("887,40")).toBe(88740);
    expect(importeAEnteros("0,01")).toBe(1);
  });

  it("con separador de miles", () => {
    expect(importeAEnteros("1.234,56")).toBe(123456);
    expect(importeAEnteros("12.345.678,90")).toBe(1234567890);
  });

  it("tolera el euro y los espacios, que el modelo a veces añade", () => {
    expect(importeAEnteros(" 377,24 € ")).toBe(37724);
    expect(importeAEnteros("377,24 EUR")).toBe(37724);
  });

  it("un entero sin decimales es euros: el «0» de la columna de pagos", () => {
    expect(importeAEnteros("0")).toBe(0);
    expect(importeAEnteros("50")).toBe(5000);
  });

  it("una sola cifra decimal se completa, no se descarta", () => {
    /* «29,7» son 29,70 y no 29,07: la cifra que falta va a la derecha. */
    expect(importeAEnteros("29,7")).toBe(2970);
  });

  it("RECHAZA el punto decimal, porque es ambiguo", () => {
    /*
     * «377.24» son 377,24 si el modelo tradujo al formato inglés, y 377.240 si
     * el punto es separador de miles. Las dos lecturas son plausibles y se
     * llevan tres órdenes de magnitud. Adivinar aquí no falla: cuadra mal.
     */
    expect(importeAEnteros("377.24")).toBeNull();
    expect(importeAEnteros("1.234")).toBeNull();
  });

  it("rechaza lo que no es un importe", () => {
    expect(importeAEnteros("")).toBeNull();
    expect(importeAEnteros("   ")).toBeNull();
    expect(importeAEnteros("varios")).toBeNull();
    expect(importeAEnteros("29,699")).toBeNull(); // tres decimales: no es dinero
    expect(importeAEnteros("1,2,3")).toBeNull();
    expect(importeAEnteros("1.23,45")).toBeNull(); // miles mal agrupados
  });
});

/** Lo que el modelo debería devolver de la captura del 10/09. */
const RESPUESTA_BUENA = JSON.stringify({
  lineas: [
    { justificante: "20765", referencia: "B2_26/611", forma: "Datáfono Clearone ta...", importe: "29,69", tipo: "COBRO", concepto: "JAVIER AMILCAR GAUNA" },
    { justificante: "20764", referencia: "B2_26/610", forma: "Datáfono Clearone ta...", importe: "160,69", tipo: "COBRO", concepto: "UBALDO SERRANO GONZALEZ" },
    { justificante: "20762", referencia: null, forma: "CONTADO", importe: "137,09", tipo: "COBRO", concepto: "RAMON BERENGUER" },
    { justificante: "20760", referencia: null, forma: "TPV CAIXA", importe: "50,00", tipo: "COBRO", concepto: "RAMON BERENGUER" },
    { justificante: "20759", referencia: "B2_26/608", forma: "Datáfono Clearone ta...", importe: "104,16", tipo: "COBRO", concepto: "EXCAVACIONES Y ROCALLAS" },
    { justificante: "20758", referencia: "B2_26/607", forma: "TPV CAIXA", importe: "377,24", tipo: "COBRO", concepto: "AGUSTI BUSQUET BES" },
    { justificante: "20757", referencia: "B2_26/606", forma: "Datáfono Clearone ta...", importe: "28,53", tipo: "COBRO", concepto: "PEDRO CANO DE LA VEGA" },
  ],
  totalCobros: "887,40",
  totalPagos: "0",
});

describe("una lectura buena", () => {
  it("saca las siete líneas del 10/09 y se declara fiable", () => {
    const r = interpretarLecturaErp(RESPUESTA_BUENA);
    expect(r.avisos).toEqual([]);
    expect(r.fiable).toBe(true);
    expect(r.bloqueante).toBe(false);
    expect(r.lineas).toHaveLength(7);
    expect(r.totalCobrosDeclarado).toBe(88740);
    expect(r.lineas[0]!.importeCentimos).toBe(2969);
    expect(r.lineas[0]!.referencia).toBe("B2_26/611");
  });

  it("aguanta el ```json con el que algunos modelos la envuelven", () => {
    const r = interpretarLecturaErp("```json\n" + RESPUESTA_BUENA + "\n```");
    expect(r.fiable).toBe(true);
    expect(r.lineas).toHaveLength(7);
  });
});

describe("la comprobación contra el total impreso", () => {
  it("una línea que el modelo NO vio se caza con el total de la pantalla", () => {
    /*
     * Es la razón de ser de esta comprobación. Sin ella, el modelo se salta el
     * cobro de 377,24 €, el cotejo lo da por ausente en Genes, y alguien acaba
     * buscando un error que no existe — o peor, metiéndolo dos veces.
     */
    const crudo = JSON.parse(RESPUESTA_BUENA);
    crudo.lineas = crudo.lineas.filter((l: { importe: string }) => l.importe !== "377,24");
    const r = interpretarLecturaErp(JSON.stringify(crudo));

    expect(r.fiable).toBe(false);
    /* Esto SÍ para: sabemos que está mal, no que no se ha podido comprobar. */
    expect(r.bloqueante).toBe(true);
    expect(r.avisos.join(" ")).toMatch(/510,16 €.*887,40 €/);
    expect(r.avisos.join(" ")).toMatch(/no es de fiar/);
  });

  it("un importe mal leído también se caza, aunque estén las siete líneas", () => {
    const r = interpretarLecturaErp(RESPUESTA_BUENA.replace('"377,24"', '"377,42"'));
    expect(r.fiable).toBe(false);
    expect(r.lineas).toHaveLength(7);
    expect(r.avisos.join(" ")).toMatch(/no es de fiar/);
  });

  it("sin total impreso NO se bloquea, pero se dice", () => {
    /*
     * La distinción que decide si la pantalla sirve o estorba: una captura
     * recortada puede estar perfectamente leída, solo que no hay con qué
     * contrastarla. Se avisa y se deja cotejar; bloquear aquí sería inventarse
     * un problema y tirar a la basura un recorte que vale.
     */
    const r = interpretarLecturaErp(RESPUESTA_BUENA.replace('"887,40"', "null"));
    expect(r.lineas).toHaveLength(7);
    expect(r.fiable).toBe(false);
    expect(r.bloqueante).toBe(false);
    expect(r.avisos.join(" ")).toMatch(/no enseña el total de cobros/);
  });

  it("los pagos se comprueban por su lado", () => {
    const crudo = JSON.parse(RESPUESTA_BUENA);
    crudo.lineas.push({ forma: "CONTADO", importe: "40,00", tipo: "PAGO", referencia: null });
    /* El total de pagos sigue diciendo 0: hay un pago que la pantalla no suma. */
    const r = interpretarLecturaErp(JSON.stringify(crudo));
    expect(r.fiable).toBe(false);
    expect(r.avisos.join(" ")).toMatch(/pagos/);
  });
});

describe("líneas que no se pueden usar", () => {
  it("una fila ilegible viene con importe null y se aparta con su aviso", () => {
    const crudo = JSON.parse(RESPUESTA_BUENA);
    crudo.lineas[2].importe = null;
    const r = interpretarLecturaErp(JSON.stringify(crudo));
    expect(r.lineas).toHaveLength(6);
    expect(r.fiable).toBe(false);
    expect(r.bloqueante).toBe(true);
    expect(r.avisos.join(" ")).toMatch(/Línea 3.*no se ha podido leer/);
  });

  it("un importe con punto decimal se aparta en vez de adivinarse", () => {
    const crudo = JSON.parse(RESPUESTA_BUENA);
    crudo.lineas[5].importe = "377.24";
    const r = interpretarLecturaErp(JSON.stringify(crudo));
    expect(r.lineas).toHaveLength(6);
    expect(r.avisos.join(" ")).toMatch(/no es un importe que se pueda leer sin dudas/);
    /* Y NO se ha colado como 37724 ni como 377: el total lo confirma. */
    expect(r.lineas.some((l) => l.importeCentimos === 37724)).toBe(false);
  });

  it("sin saber si es cobro o pago, fuera", () => {
    const crudo = JSON.parse(RESPUESTA_BUENA);
    crudo.lineas[0].tipo = "OTRA COSA";
    const r = interpretarLecturaErp(JSON.stringify(crudo));
    expect(r.lineas).toHaveLength(6);
    expect(r.avisos.join(" ")).toMatch(/Línea 1.*cobro o un pago/);
  });

  it("sin forma de pago, fuera: sin ella no se puede emparejar", () => {
    const crudo = JSON.parse(RESPUESTA_BUENA);
    crudo.lineas[0].forma = "  ";
    const r = interpretarLecturaErp(JSON.stringify(crudo));
    expect(r.lineas).toHaveLength(6);
    expect(r.avisos.join(" ")).toMatch(/sin forma de pago/);
  });

  it("un importe negativo no se da por bueno", () => {
    const crudo = JSON.parse(RESPUESTA_BUENA);
    crudo.lineas[0].importe = "-29,69";
    const r = interpretarLecturaErp(JSON.stringify(crudo));
    expect(r.lineas).toHaveLength(6);
    expect(r.avisos.join(" ")).toMatch(/negativo/);
  });

  it("una referencia vacía queda en null, no en cadena vacía", () => {
    const crudo = JSON.parse(RESPUESTA_BUENA);
    crudo.lineas[0].referencia = "   ";
    const r = interpretarLecturaErp(JSON.stringify(crudo));
    expect(r.lineas[0]!.referencia).toBeNull();
  });
});

describe("qué para y qué solo avisa", () => {
  /*
   * Estas dos pruebas son la red de la distinción entera. Si alguien las
   * fusiona —o hace que `bloqueante` sea `!fiable`— la pantalla vuelve a
   * rechazar capturas recortadas que están bien, y nadie entenderá por qué.
   */
  it("no poder comprobar NO es lo mismo que saber que está mal", () => {
    const sinTotal = interpretarLecturaErp(RESPUESTA_BUENA.replace('"887,40"', "null"));
    const malLeido = interpretarLecturaErp(RESPUESTA_BUENA.replace('"377,24"', '"377,42"'));

    /* Las dos tienen avisos... */
    expect(sinTotal.fiable).toBe(false);
    expect(malLeido.fiable).toBe(false);
    /* ...pero solo una para. */
    expect(sinTotal.bloqueante).toBe(false);
    expect(malLeido.bloqueante).toBe(true);
  });

  it("una respuesta ilegible para, evidentemente", () => {
    expect(interpretarLecturaErp("no puedo leer esto").bloqueante).toBe(true);
    expect(interpretarLecturaErp('{"lineas":[]}').bloqueante).toBe(true);
  });
});

describe("cuando la respuesta no sirve para nada", () => {
  it("no es JSON", () => {
    const r = interpretarLecturaErp("Lo siento, no puedo leer esta imagen.");
    expect(r.fiable).toBe(false);
    expect(r.lineas).toEqual([]);
    expect(r.avisos[0]).toMatch(/no se ha podido leer como JSON/);
  });

  it("es JSON pero sin líneas", () => {
    const r = interpretarLecturaErp('{"resultado":"vacio"}');
    expect(r.fiable).toBe(false);
    expect(r.avisos[0]).toMatch(/ninguna lista de líneas/);
  });

  it("una tabla vacía se dice, no se da por cuadrada", () => {
    const r = interpretarLecturaErp('{"lineas":[],"totalCobros":null,"totalPagos":null}');
    expect(r.fiable).toBe(false);
    expect(r.lineas).toEqual([]);
  });

  it("no revienta con basura dentro de las líneas", () => {
    const r = interpretarLecturaErp('{"lineas":[null,42,"hola",{}],"totalCobros":"0"}');
    expect(r.fiable).toBe(false);
    expect(r.lineas).toEqual([]);
    expect(r.avisos.length).toBeGreaterThan(0);
  });
});
