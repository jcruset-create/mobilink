import { describe, expect, it } from "vitest";
import { cotejar, type Equivalencias, type LineaErp, type LineaMobilink } from "./cotejo.ts";

/** Las etiquetas del ERP de este taller, tal cual las escribe Genes. */
const EQUIV: Equivalencias = new Map([
  ["CONTADO", "EFECTIVO"],
  ["DATÁFONO CLEARONE TA...", "CLEARONE"],
  ["TPV CAIXA", "TARJETA"],
]);

/**
 * El cierre real del 10/09/2026, leído de la pantalla de Genes.
 *
 * Se usa como caso principal a propósito: siete líneas, tres formas de pago
 * distintas, dos cobros al mismo cliente y una suma que tiene que dar 887,40.
 * Un caso inventado de dos líneas no habría enseñado nada de lo que este
 * cotejo tiene que resolver.
 */
const GENES_10_09: LineaErp[] = [
  { justificante: "20765", referencia: "B2_26/611", formaErp: "Datáfono Clearone ta...", importeCentimos: 2969, tipo: "COBRO", concepto: "JAVIER AMILCAR GAUNA" },
  { justificante: "20764", referencia: "B2_26/610", formaErp: "Datáfono Clearone ta...", importeCentimos: 16069, tipo: "COBRO", concepto: "UBALDO SERRANO GONZALEZ" },
  { justificante: "20762", referencia: null, formaErp: "CONTADO", importeCentimos: 13709, tipo: "COBRO", concepto: "RAMON BERENGUER" },
  { justificante: "20760", referencia: null, formaErp: "TPV CAIXA", importeCentimos: 5000, tipo: "COBRO", concepto: "RAMON BERENGUER" },
  { justificante: "20759", referencia: "B2_26/608", formaErp: "Datáfono Clearone ta...", importeCentimos: 10416, tipo: "COBRO", concepto: "EXCAVACIONES Y ROCALLAS CATALUNYA S.L." },
  { justificante: "20758", referencia: "B2_26/607", formaErp: "TPV CAIXA", importeCentimos: 37724, tipo: "COBRO", concepto: "AGUSTI BUSQUET BES" },
  { justificante: "20757", referencia: "B2_26/606", formaErp: "Datáfono Clearone ta...", importeCentimos: 2853, tipo: "COBRO", concepto: "PEDRO CANO DE LA VEGA" },
];

/** Lo mismo, como lo tendría Mobilink si estuviera todo metido. */
const MOBILINK_10_09: LineaMobilink[] = [
  { id: 1, numero: "MC-CO-2026-000101", referencia: "B2_26/611", formaCodigo: "CLEARONE", importeCentimos: 2969, tipo: "COBRO" },
  { id: 2, numero: "MC-CO-2026-000102", referencia: "B2_26/610", formaCodigo: "CLEARONE", importeCentimos: 16069, tipo: "COBRO" },
  { id: 3, numero: "MC-CO-2026-000103", referencia: null, formaCodigo: "EFECTIVO", importeCentimos: 13709, tipo: "COBRO" },
  { id: 4, numero: "MC-CO-2026-000104", referencia: null, formaCodigo: "TARJETA", importeCentimos: 5000, tipo: "COBRO" },
  { id: 5, numero: "MC-CO-2026-000105", referencia: "B2_26/608", formaCodigo: "CLEARONE", importeCentimos: 10416, tipo: "COBRO" },
  { id: 6, numero: "MC-CO-2026-000106", referencia: "B2_26/607", formaCodigo: "TARJETA", importeCentimos: 37724, tipo: "COBRO" },
  { id: 7, numero: "MC-CO-2026-000107", referencia: "B2_26/606", formaCodigo: "CLEARONE", importeCentimos: 2853, tipo: "COBRO" },
];

describe("el día que todo cuadra", () => {
  it("empareja las siete y dice que cuadra", () => {
    const r = cotejar(GENES_10_09, MOBILINK_10_09, EQUIV);
    expect(r.cuadra).toBe(true);
    expect(r.emparejadas).toHaveLength(7);
    expect(r.soloEnErp).toEqual([]);
    expect(r.soloEnMobilink).toEqual([]);
    expect(r.ambiguas).toEqual([]);
  });

  it("los totales son los de la pantalla de Genes", () => {
    const r = cotejar(GENES_10_09, MOBILINK_10_09, EQUIV);
    expect(r.totales.erpCobros).toBe(88740); // 887,40 €
    expect(r.totales.erpPagos).toBe(0);
    expect(r.totales.diferenciaCobros).toBe(0);
  });

  it("dice CÓMO emparejó cada una, que no es lo mismo", () => {
    const r = cotejar(GENES_10_09, MOBILINK_10_09, EQUIV);
    /* Cinco tienen referencia; las dos de RAMON BERENGUER, no. */
    expect(r.emparejadas.filter((e) => e.por === "referencia")).toHaveLength(5);
    expect(r.emparejadas.filter((e) => e.por === "importe")).toHaveLength(2);
  });
});

describe("lo que falta y lo que sobra", () => {
  it("un cobro que está en Genes y no en Mobilink", () => {
    const r = cotejar(GENES_10_09, MOBILINK_10_09.filter((m) => m.id !== 6), EQUIV);
    expect(r.cuadra).toBe(false);
    expect(r.soloEnErp).toHaveLength(1);
    expect(r.soloEnErp[0]!.justificante).toBe("20758");
    expect(r.totales.diferenciaCobros).toBe(37724);
  });

  it("un cobro que está en Mobilink y no en Genes", () => {
    const extra: LineaMobilink = {
      id: 99, numero: "MC-CO-2026-000199", referencia: "B2_26/612",
      formaCodigo: "EFECTIVO", importeCentimos: 1000, tipo: "COBRO",
    };
    const r = cotejar(GENES_10_09, [...MOBILINK_10_09, extra], EQUIV);
    expect(r.cuadra).toBe(false);
    expect(r.soloEnMobilink).toHaveLength(1);
    expect(r.soloEnMobilink[0]!.id).toBe(99);
    expect(r.totales.diferenciaCobros).toBe(-1000);
  });

  it("los totales solos NO bastan: el mismo importe por la forma equivocada", () => {
    /*
     * El cobro de AGUSTI BUSQUET, 377,24 €, metido en Mobilink como EFECTIVO
     * cuando en Genes fue TPV CAIXA. Los totales dan cero —el dinero está— y
     * sin embargo hay un error que descuadrará el arqueo de la tarde, porque
     * Mobilink cree que hay 377,24 € más en el cajón de los que hay.
     *
     * Es el caso que obliga a exigir líneas Y totales.
     *
     * La primera versión de esta prueba no valía: quitaba un cobro de 50 € por
     * tarjeta y metía otro de 50 € por tarjeta con otra referencia, y el cotejo
     * los emparejaba por importe —con razón, porque la línea de Genes no tenía
     * referencia y eran indistinguibles—. Comprobaba que el código hacía algo
     * mal cuando lo estaba haciendo bien.
     */
    const torcido = MOBILINK_10_09.map((m) =>
      m.id === 6 ? { ...m, formaCodigo: "EFECTIVO", referencia: null } : m
    );
    const r = cotejar(GENES_10_09, torcido, EQUIV);
    expect(r.totales.diferenciaCobros).toBe(0);
    expect(r.cuadra).toBe(false);

    /*
     * Sale como discrepancia de forma y no como dos huérfanas. Es la misma
     * operación con la forma cambiada, y decirlo así ahorra el trabajo de
     * cruzar dos tablas para darse cuenta de que el importe es el mismo.
     */
    expect(r.soloEnErp).toEqual([]);
    expect(r.soloEnMobilink).toEqual([]);
    expect(r.discrepanciasDeForma).toHaveLength(1);
    expect(r.discrepanciasDeForma[0]!.erp.justificante).toBe("20758");
    expect(r.discrepanciasDeForma[0]!.mobilink.id).toBe(6);
  });

  it("un importe mal por un céntimo sale como dos líneas sueltas, no como cuadrado", () => {
    const torcido = MOBILINK_10_09.map((m) =>
      m.id === 6 ? { ...m, importeCentimos: 37725 } : m
    );
    const r = cotejar(GENES_10_09, torcido, EQUIV);
    /*
     * Empareja igual, porque la referencia manda y es la misma operación. Lo
     * que no puede es decir que cuadra: el total delata el céntimo.
     */
    expect(r.emparejadas).toHaveLength(7);
    expect(r.totales.diferenciaCobros).toBe(-1);
    expect(r.cuadra).toBe(false);
  });
});

describe("mismo importe, distinta forma de pago", () => {
  /*
   * EL CASO REAL DEL 10/09, y el que destapó que faltaba esta categoría.
   *
   * El modelo leyó la fila 20762 —que en Genes pone CONTADO— como «Datáfono
   * Clearone ta...», copiando la etiqueta de las filas de al lado. Los importes
   * estaban todos bien, así que la comprobación contra el total impreso no lo
   * cazó: 887,40 € a los dos lados.
   *
   * El resultado era que los 137,09 € salían DOS VECES —uno en «falta en
   * Mobilink» y otro en «sobra en Mobilink»— sin que nada dijera que eran el
   * mismo importe. La información estaba; el trabajo de verla se le dejaba
   * entero a quien miraba, que es justo lo que este cotejo venía a evitar.
   */
  it("el cobro de RAMON BERENGUER: el modelo leyó mal la forma", () => {
    const erp: LineaErp[] = [
      {
        justificante: "20762",
        referencia: null,
        /* Lo que el modelo leyó, MAL. En Genes pone CONTADO. */
        formaErp: "Datáfono Clearone ta...",
        importeCentimos: 13709,
        tipo: "COBRO",
        concepto: "RAMON BERENGUER",
      },
    ];
    const mob: LineaMobilink[] = [
      {
        id: 59,
        numero: "TAR1-C-26-059",
        referencia: "B0020000609",
        formaCodigo: "EFECTIVO",
        importeCentimos: 13709,
        tipo: "COBRO",
      },
    ];

    const r = cotejar(erp, mob, EQUIV);

    /* Ya NO salen como dos huérfanas por cada lado. */
    expect(r.soloEnErp).toEqual([]);
    expect(r.soloEnMobilink).toEqual([]);

    expect(r.discrepanciasDeForma).toHaveLength(1);
    const d = r.discrepanciasDeForma[0]!;
    expect(d.erp.justificante).toBe("20762");
    expect(d.mobilink.numero).toBe("TAR1-C-26-059");
    expect(d.formaEsperada).toBe("CLEARONE");

    /* Y NO se da por cuadrado: hay algo que mirar, sea del modelo o del cobro. */
    expect(r.cuadra).toBe(false);
    expect(r.totales.diferenciaCobros).toBe(0);
  });

  it("también caza el error de verdad: un cobro metido con la forma equivocada", () => {
    /*
     * La otra causa de lo mismo, y la que de verdad cuesta dinero: el dinero
     * está, pero Mobilink cree que hay 377,24 € más en el cajón de los que hay,
     * y el arqueo de la tarde descuadrará por esa cifra exacta.
     */
    const erp: LineaErp[] = [
      { referencia: "B2_26/607", formaErp: "TPV CAIXA", importeCentimos: 37724, tipo: "COBRO" },
    ];
    const mob: LineaMobilink[] = [
      { id: 6, numero: "A", referencia: null, formaCodigo: "EFECTIVO", importeCentimos: 37724, tipo: "COBRO" },
    ];
    const r = cotejar(erp, mob, EQUIV);
    expect(r.discrepanciasDeForma).toHaveLength(1);
    expect(r.discrepanciasDeForma[0]!.formaEsperada).toBe("TARJETA");
    expect(r.cuadra).toBe(false);
  });

  it("va la ÚLTIMA: no le roba la pareja buena a nadie", () => {
    /*
     * Si esta pasada fuera antes, el cobro de 50 € por tarjeta del ERP podría
     * emparejarse con el de 50 € en efectivo de Mobilink —por importe— y dejar
     * huérfanos a los dos que sí se correspondían.
     */
    const erp: LineaErp[] = [
      { formaErp: "TPV CAIXA", importeCentimos: 5000, tipo: "COBRO", concepto: "el de tarjeta" },
      { formaErp: "CONTADO", importeCentimos: 5000, tipo: "COBRO", concepto: "el de efectivo" },
    ];
    const mob: LineaMobilink[] = [
      { id: 1, numero: "EFECTIVO", formaCodigo: "EFECTIVO", importeCentimos: 5000, tipo: "COBRO" },
      { id: 2, numero: "TARJETA", formaCodigo: "TARJETA", importeCentimos: 5000, tipo: "COBRO" },
    ];
    const r = cotejar(erp, mob, EQUIV);

    expect(r.cuadra).toBe(true);
    expect(r.discrepanciasDeForma).toEqual([]);
    expect(r.emparejadas).toHaveLength(2);
    /* Cada uno con el suyo, no cruzados. */
    expect(r.emparejadas.find((x) => x.erp.concepto === "el de tarjeta")!.mobilink.numero).toBe("TARJETA");
    expect(r.emparejadas.find((x) => x.erp.concepto === "el de efectivo")!.mobilink.numero).toBe("EFECTIVO");
  });

  it("con dos candidatos del mismo importe sigue sin elegir", () => {
    /* La regla de no inventar emparejamientos no se relaja aquí. Lo que se
       relaja es la forma de pago, no la exigencia de que no haya dudas. */
    const erp: LineaErp[] = [
      { formaErp: "BIZUM DEL MOVIL", importeCentimos: 5000, tipo: "COBRO" },
    ];
    const mob: LineaMobilink[] = [
      { id: 1, numero: "A", formaCodigo: "EFECTIVO", importeCentimos: 5000, tipo: "COBRO" },
      { id: 2, numero: "B", formaCodigo: "TARJETA", importeCentimos: 5000, tipo: "COBRO" },
    ];
    const r = cotejar(erp, mob, EQUIV);
    expect(r.discrepanciasDeForma).toEqual([]);
    expect(r.ambiguas).toHaveLength(1);
  });

  it("y un cobro contra un pago del mismo importe NO se empareja ni aquí", () => {
    const erp: LineaErp[] = [
      { formaErp: "CONTADO", importeCentimos: 5000, tipo: "PAGO" },
    ];
    const mob: LineaMobilink[] = [
      { id: 1, numero: "A", formaCodigo: "TARJETA", importeCentimos: 5000, tipo: "COBRO" },
    ];
    const r = cotejar(erp, mob, EQUIV);
    expect(r.discrepanciasDeForma).toEqual([]);
    expect(r.soloEnErp).toHaveLength(1);
    expect(r.soloEnMobilink).toHaveLength(1);
  });
});

describe("cuándo NO se elige", () => {
  it("dos candidatos igual de buenos se declaran ambiguos, no se empareja uno", () => {
    /* Dos cobros de 50 € por tarjeta el mismo día: por importe son gemelos. */
    const erp: LineaErp[] = [
      { formaErp: "TPV CAIXA", importeCentimos: 5000, tipo: "COBRO" },
    ];
    const mob: LineaMobilink[] = [
      { id: 1, numero: "A", formaCodigo: "TARJETA", importeCentimos: 5000, tipo: "COBRO" },
      { id: 2, numero: "B", formaCodigo: "TARJETA", importeCentimos: 5000, tipo: "COBRO" },
    ];
    const r = cotejar(erp, mob, EQUIV);
    expect(r.emparejadas).toEqual([]);
    expect(r.ambiguas).toHaveLength(1);
    expect(r.ambiguas[0]!.candidatos.map((c) => c.id)).toEqual([1, 2]);
    expect(r.cuadra).toBe(false);
  });

  it("una referencia repetida en Mobilink es un aviso, no un emparejamiento", () => {
    /* Dos operaciones con la misma referencia es un cobro duplicado, y taparlo
       emparejando una al azar es lo contrario de lo que se pide. */
    const erp: LineaErp[] = [
      { referencia: "B2_26/611", formaErp: "TPV CAIXA", importeCentimos: 5000, tipo: "COBRO" },
    ];
    const mob: LineaMobilink[] = [
      { id: 1, numero: "A", referencia: "B2_26/611", formaCodigo: "TARJETA", importeCentimos: 5000, tipo: "COBRO" },
      { id: 2, numero: "B", referencia: "B2_26/611", formaCodigo: "TARJETA", importeCentimos: 5000, tipo: "COBRO" },
    ];
    const r = cotejar(erp, mob, EQUIV);
    expect(r.ambiguas).toHaveLength(1);
    expect(r.emparejadas).toEqual([]);
  });
});

describe("las formas de pago no se adivinan", () => {
  it("una etiqueta sin equivalencia NO se empareja por importe a secas", () => {
    /*
     * Colar un cobro por tarjeta contra uno en efectivo del mismo importe es
     * justo el error que este cotejo tiene que encontrar, no cometer.
     */
    const erp: LineaErp[] = [
      { formaErp: "BIZUM DEL MOVIL", importeCentimos: 5000, tipo: "COBRO" },
    ];
    const mob: LineaMobilink[] = [
      { id: 1, numero: "A", formaCodigo: "EFECTIVO", importeCentimos: 5000, tipo: "COBRO" },
    ];
    const r = cotejar(erp, mob, EQUIV);

    /*
     * Lo esencial se mantiene: NO se da por emparejado, y la etiqueta sin
     * configurar se sigue diciendo. Lo que cambia es dónde aparece — como
     * discrepancia de forma, con `formaEsperada` a null para que la pantalla
     * pueda decir «esta etiqueta ni siquiera está configurada» en vez de
     * «la forma no coincide», que sería engañoso.
     */
    expect(r.emparejadas).toEqual([]);
    expect(r.formasSinEquivalencia).toEqual(["BIZUM DEL MOVIL"]);
    expect(r.cuadra).toBe(false);
    expect(r.discrepanciasDeForma).toHaveLength(1);
    expect(r.discrepanciasDeForma[0]!.formaEsperada).toBeNull();
  });

  it("la etiqueta se busca sin depender de mayúsculas ni espacios de más", () => {
    const erp: LineaErp[] = [
      { formaErp: "  contado  ", importeCentimos: 5000, tipo: "COBRO" },
    ];
    const mob: LineaMobilink[] = [
      { id: 1, numero: "A", formaCodigo: "EFECTIVO", importeCentimos: 5000, tipo: "COBRO" },
    ];
    expect(cotejar(erp, mob, EQUIV).emparejadas).toHaveLength(1);
  });
});

/**
 * El ERP corta la columna de forma de pago según la resolución del monitor.
 *
 * No es un detalle cosmético: la misma etiqueta se lee «Datáfono Clearon...» en
 * un PC y «Datáfono Clearone ta...» en otro, así que comparar letra a letra
 * hace que el cotejo dependa de con qué ordenador se hizo la captura.
 */
describe("las etiquetas que el ERP corta", () => {
  const mob = (formaCodigo: string): LineaMobilink[] => [
    { id: 1, numero: "A", referencia: null, formaCodigo, importeCentimos: 5000, tipo: "COBRO" },
  ];
  const erp = (formaErp: string): LineaErp[] => [
    { formaErp, importeCentimos: 5000, tipo: "COBRO" },
  ];

  it("la captura recortada encaja con la equivalencia entera", () => {
    const equiv: Equivalencias = new Map([["DATÁFONO CLEARONE TARJETA", "CLEARONE"]]);
    const r = cotejar(erp("Datáfono Clearon..."), mob("CLEARONE"), equiv);

    expect(r.emparejadas).toHaveLength(1);
    expect(r.cuadra).toBe(true);
    expect(r.formasSinEquivalencia).toEqual([]);
  });

  it("y al revés: la equivalencia guardada también puede venir recortada", () => {
    /*
     * Quien la configuró la copió de SU pantalla, que corta antes. Luego llega
     * una captura de un monitor más ancho y lo largo es lo leído.
     */
    const equiv: Equivalencias = new Map([["DATÁFONO CLEARON...", "CLEARONE"]]);
    const r = cotejar(erp("Datáfono Clearone tarjeta"), mob("CLEARONE"), equiv);

    expect(r.emparejadas).toHaveLength(1);
    expect(r.cuadra).toBe(true);
  });

  it("la tilde no decide, porque el modelo la pone y la quita", () => {
    const equiv: Equivalencias = new Map([["DATAFONO CLEARONE TARJETA", "CLEARONE"]]);
    const r = cotejar(erp("Datáfono Clearone ta..."), mob("CLEARONE"), equiv);

    expect(r.emparejadas).toHaveLength(1);
  });

  it("se dice que se ha emparejado por el principio de la etiqueta", () => {
    /*
     * Es una deducción, no un dato, y se enseña como tal: el día que empareje
     * con la equivalencia equivocada tiene que haber dónde verlo.
     */
    const equiv: Equivalencias = new Map([["DATÁFONO CLEARONE TARJETA", "CLEARONE"]]);
    const r = cotejar(erp("Datáfono Clearon..."), mob("CLEARONE"), equiv);

    expect(r.formasPorRecorte).toEqual([
      { etiqueta: "Datáfono Clearon...", configurada: "DATÁFONO CLEARONE TARJETA" },
    ]);
  });

  it("la que casa exacta NO se anuncia como recortada", () => {
    const r = cotejar(erp("CONTADO"), mob("EFECTIVO"), EQUIV);

    expect(r.emparejadas).toHaveLength(1);
    expect(r.formasPorRecorte).toEqual([]);
  });

  it("con dos equivalencias que encajan no se elige ninguna", () => {
    /*
     * LA REGLA QUE NO SE RELAJA. «Datáfono...» con dos datáfonos configurados
     * podría ser cualquiera de los dos, y elegir uno mandaría cobros contra la
     * forma equivocada sin que nada chirriara. Se dice y lo mira una persona.
     */
    const equiv: Equivalencias = new Map([
      ["DATÁFONO CLEARONE TARJETA", "CLEARONE"],
      ["DATÁFONO CAIXA TARJETA", "TARJETA"],
    ]);
    const r = cotejar(erp("Datáfono..."), mob("CLEARONE"), equiv);

    expect(r.emparejadas).toEqual([]);
    expect(r.formasAmbiguas).toEqual([
      { etiqueta: "Datáfono...", candidatas: ["DATÁFONO CAIXA TARJETA", "DATÁFONO CLEARONE TARJETA"] },
    ]);
    expect(r.cuadra).toBe(false);
  });

  it("ambigua NO es lo mismo que sin configurar", () => {
    /*
     * Decir «sin configurar» mandaría a alguien a crear una equivalencia que ya
     * existe, y a no entender por qué la nueva tampoco arregla nada.
     */
    const equiv: Equivalencias = new Map([
      ["DATÁFONO CLEARONE TARJETA", "CLEARONE"],
      ["DATÁFONO CAIXA TARJETA", "TARJETA"],
    ]);
    const r = cotejar(erp("Datáfono..."), mob("CLEARONE"), equiv);

    expect(r.formasSinEquivalencia).toEqual([]);
  });

  it("dos equivalencias que apuntan a la MISMA forma no son ninguna duda", () => {
    /* Da igual cuál se coja: la respuesta es la misma. */
    const equiv: Equivalencias = new Map([
      ["DATÁFONO CLEARONE TARJETA", "CLEARONE"],
      ["DATAFONO CLEARONE TA", "CLEARONE"],
    ]);
    const r = cotejar(erp("Datáfono Clearon..."), mob("CLEARONE"), equiv);

    expect(r.emparejadas).toHaveLength(1);
    expect(r.formasAmbiguas).toEqual([]);
  });

  it("la exacta gana a la que solo encaja por prefijo", () => {
    /*
     * Si alguien se tomó la molestia de configurar la etiqueta entera, eso es
     * lo que quería decir. Ponerlas a competir convertiría una equivalencia
     * bien puesta en ambigua por culpa de otra que solo se le parece.
     */
    const equiv: Equivalencias = new Map([
      ["TPV CAIXA", "TARJETA"],
      ["TPV CAIXA COMERCIO 702", "CLEARONE"],
    ]);
    const r = cotejar(erp("TPV CAIXA"), mob("TARJETA"), equiv);

    expect(r.emparejadas).toHaveLength(1);
    expect(r.formasAmbiguas).toEqual([]);
    expect(r.formasPorRecorte).toEqual([]);
  });

  it("un trozo demasiado corto no empareja nada", () => {
    /*
     * Con dos letras el emparejamiento diría más del azar que de la etiqueta, y
     * una lectura así de corta es señal de que la captura vino mal. Ahí lo que
     * toca es decirlo, no adivinar.
     */
    const equiv: Equivalencias = new Map([["TPV CAIXA", "TARJETA"]]);
    const r = cotejar(erp("TP..."), mob("TARJETA"), equiv);

    expect(r.emparejadas).toEqual([]);
    expect(r.formasSinEquivalencia).toEqual(["TP..."]);
  });
});

describe("la referencia, normalizada", () => {
  it("el mismo documento escrito de tres formas empareja igual", () => {
    const mob: LineaMobilink[] = [
      { id: 1, numero: "A", referencia: "B2_26/611", formaCodigo: "TARJETA", importeCentimos: 5000, tipo: "COBRO" },
    ];
    for (const escrito of ["B2_26/611", "b2 26-611", "B2.26.611"]) {
      const r = cotejar(
        [{ referencia: escrito, formaErp: "TPV CAIXA", importeCentimos: 5000, tipo: "COBRO" }],
        mob,
        EQUIV
      );
      expect(r.emparejadas, escrito).toHaveLength(1);
      expect(r.emparejadas[0]!.por).toBe("referencia");
    }
  });

  it("una referencia vacía no empareja con otra vacía", () => {
    /* Sin este cuidado, dos operaciones sin referencia se emparejarían por
       «tener las dos ninguna», que no es tener la misma. */
    const erp: LineaErp[] = [
      { referencia: "", formaErp: "CONTADO", importeCentimos: 5000, tipo: "COBRO" },
      { referencia: null, formaErp: "CONTADO", importeCentimos: 7000, tipo: "COBRO" },
    ];
    const mob: LineaMobilink[] = [
      { id: 1, numero: "A", referencia: null, formaCodigo: "EFECTIVO", importeCentimos: 5000, tipo: "COBRO" },
      { id: 2, numero: "B", referencia: "", formaCodigo: "EFECTIVO", importeCentimos: 7000, tipo: "COBRO" },
    ];
    const r = cotejar(erp, mob, EQUIV);
    /* Emparejan, pero por IMPORTE, que es lo honesto: no había clave. */
    expect(r.emparejadas.every((e) => e.por === "importe")).toBe(true);
    expect(r.emparejadas).toHaveLength(2);
  });
});

describe("los pagos", () => {
  it("se cotejan aparte de los cobros y no se cruzan entre sí", () => {
    /*
     * Un cobro de 50 € y un pago de 50 € no son la misma operación. Sin separar
     * por tipo, el cotejo los emparejaría y diría que cuadra un día en el que
     * falta un cobro y sobra un pago.
     */
    const erp: LineaErp[] = [
      { formaErp: "CONTADO", importeCentimos: 5000, tipo: "COBRO" },
      { formaErp: "CONTADO", importeCentimos: 5000, tipo: "PAGO" },
    ];
    const mob: LineaMobilink[] = [
      { id: 1, numero: "A", formaCodigo: "EFECTIVO", importeCentimos: 5000, tipo: "PAGO" },
      { id: 2, numero: "B", formaCodigo: "EFECTIVO", importeCentimos: 5000, tipo: "COBRO" },
    ];
    const r = cotejar(erp, mob, EQUIV);
    expect(r.cuadra).toBe(true);
    expect(r.emparejadas.find((e) => e.erp.tipo === "COBRO")!.mobilink.id).toBe(2);
    expect(r.emparejadas.find((e) => e.erp.tipo === "PAGO")!.mobilink.id).toBe(1);
  });

  it("un pago que falta no se compensa con un cobro que sobra", () => {
    const erp: LineaErp[] = [
      { formaErp: "CONTADO", importeCentimos: 5000, tipo: "PAGO" },
    ];
    const mob: LineaMobilink[] = [
      { id: 1, numero: "A", formaCodigo: "EFECTIVO", importeCentimos: 5000, tipo: "COBRO" },
    ];
    const r = cotejar(erp, mob, EQUIV);
    expect(r.cuadra).toBe(false);
    expect(r.totales.diferenciaPagos).toBe(5000);
    expect(r.totales.diferenciaCobros).toBe(-5000);
  });
});

describe("el día vacío", () => {
  it("sin nada por ninguno de los dos lados, cuadra", () => {
    const r = cotejar([], [], EQUIV);
    expect(r.cuadra).toBe(true);
    expect(r.totales.erpCobros).toBe(0);
  });
});
