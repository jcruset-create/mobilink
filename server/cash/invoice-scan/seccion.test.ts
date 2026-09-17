import { describe, expect, it } from "vitest";
import {
  clasificarSeccion,
  ivaCuadra,
  UMBRAL_SECCION,
  type EvidenciaSeccion,
  type ReglaSeccion,
} from "./seccion.ts";

const TALLER = 1;
const GASOLINERA = 2;
const CATALOGO = new Set([TALLER, GASOLINERA]);

/**
 * El ticket del surtidor del 17/09/2026, con sus cifras.
 *
 * Es el caso que originó todo esto, y va con los números de verdad: 41,32 de
 * base y 8,68 de cuota dan 50,00 justos, que es lo que hace comprobable la
 * lectura.
 */
const TICKET_GASOLINERA: EvidenciaSeccion = {
  cifEmisor: "A43044379",
  nombreEmisor: "E.S CONFORTAUTO",
  numeroFactura: "T5-155",
  concepto: "GAS-OIL A DIESEL",
  baseCentimos: 4132,
  ivaCentimos: 868,
  totalCentimos: 5000,
  confianzaEmisor: 0.95,
};

/** Una factura del taller, del ERP. Nada que ver con el surtidor. */
const FACTURA_TALLER: EvidenciaSeccion = {
  cifEmisor: "B43999111",
  nombreEmisor: "COMERCIAL SEA S.A.",
  numeroFactura: "B2_26/611",
  concepto: "Montaje de 2 neumáticos",
  baseCentimos: 10000,
  ivaCentimos: 2100,
  totalCentimos: 12100,
  confianzaEmisor: 0.95,
};

/** La regla que el taller configuraría: por el NIF del surtidor. */
const REGLA_CIF: ReglaSeccion = {
  id: 10,
  campo: "CIF_EMISOR",
  patron: "A43044379",
  sectionId: GASOLINERA,
  confianza: 0.95,
  autoSeleccionar: true,
  prioridad: 100,
};

describe("el ticket del surtidor se reconoce", () => {
  it("propone gasolinera y cambia el chip solo", () => {
    /*
     * Esto es literalmente lo que se pidió: aunque se escanee con el taller
     * puesto, tiene que proponer gasolinera automáticamente.
     */
    const r = clasificarSeccion(TICKET_GASOLINERA, [REGLA_CIF], CATALOGO, TALLER);

    expect(r.sectionId).toBe(GASOLINERA);
    expect(r.autoSeleccionar).toBe(true);
    expect(r.reglaId).toBe(10);
    expect(r.confianza).toBeGreaterThanOrEqual(UMBRAL_SECCION);
  });

  it("el NIF casa aunque el papel lo imprima con guion", () => {
    /*
     * «A-43044379» y «A43044379» son la misma empresa. Sin normalizar, la regla
     * fallaría según cómo lo imprimiera el TPV ese día: a ratos, que es la peor
     * manera de fallar.
     */
    const r = clasificarSeccion(
      { ...TICKET_GASOLINERA, cifEmisor: "A-43044379" },
      [REGLA_CIF],
      CATALOGO,
      TALLER
    );
    expect(r.sectionId).toBe(GASOLINERA);
  });

  it("el NIF se compara ENTERO, no por trozos", () => {
    /*
     * Mismo criterio que el número de comercio en la forma de cobro: un NIF que
     * CONTIENE al otro es de otra empresa, no de la misma.
     */
    const r = clasificarSeccion(
      { ...TICKET_GASOLINERA, cifEmisor: "A430443790" },
      [REGLA_CIF],
      CATALOGO,
      TALLER
    );
    expect(r.sectionId).toBe(TALLER);
    expect(r.reglaId).toBeNull();
  });

  it("también vale reconocerlo por la serie o por el concepto", () => {
    const porSerie: ReglaSeccion = { ...REGLA_CIF, id: 11, campo: "SERIE", patron: "T5-" };
    const porConcepto: ReglaSeccion = { ...REGLA_CIF, id: 12, campo: "CONCEPTO", patron: "gas-oil" };

    expect(clasificarSeccion(TICKET_GASOLINERA, [porSerie], CATALOGO, TALLER).sectionId).toBe(
      GASOLINERA
    );
    expect(clasificarSeccion(TICKET_GASOLINERA, [porConcepto], CATALOGO, TALLER).sectionId).toBe(
      GASOLINERA
    );
  });
});

describe("lo que no se reconoce se propone, pero no se afirma", () => {
  it("una factura del taller cae en la sección por defecto", () => {
    const r = clasificarSeccion(FACTURA_TALLER, [REGLA_CIF], CATALOGO, TALLER);
    expect(r.sectionId).toBe(TALLER);
  });

  it("pero NO cambia el chip solo, y lo dice", () => {
    /*
     * LA REGLA QUE SOSTIENE ESTO: «no lo reconozco» ≠ «es del taller». Un
     * ticket de gasolinera fotografiado torcido tampoco se reconoce, y si eso
     * cambiara el chip solo, las ventas de gasoil se irían al taller cada vez
     * que saliera mal la foto — y el descuadre por sección saldría en el cierre
     * sin nada que lo explicara.
     */
    const r = clasificarSeccion(FACTURA_TALLER, [REGLA_CIF], CATALOGO, TALLER);

    expect(r.autoSeleccionar).toBe(false);
    expect(r.confianza).toBeLessThan(UMBRAL_SECCION);
    expect(r.motivo).toContain("Ninguna regla reconoce");
  });
});

describe("la aritmética del papel manda sobre las reglas", () => {
  it("si base + IVA no da el total, no se propone nada", () => {
    /*
     * Con una cifra mal leída, lo que se haya entendido del emisor tampoco es
     * de fiar. Una propuesta apoyada en una lectura que YA SE SABE mala es peor
     * que ninguna: se acepta sin mirar.
     */
    const mal = { ...TICKET_GASOLINERA, totalCentimos: 6000 };
    expect(ivaCuadra(mal)).toBe(false);

    const r = clasificarSeccion(mal, [REGLA_CIF], CATALOGO, TALLER);
    expect(r.sectionId).toBeNull();
    expect(r.autoSeleccionar).toBe(false);
    expect(r.motivo).toContain("no cuadran");
  });

  it("no poder comprobarlo NO es lo mismo que no cuadrar", () => {
    /*
     * La lección del `bloqueante` frente al `fiable` del cotejo con el ERP: un
     * ticket recortado del que no se ve la base puede estar perfectamente bien
     * leído. Bloquear aquí sería inventarse un problema.
     */
    const recortado = { ...TICKET_GASOLINERA, baseCentimos: null, ivaCentimos: null };
    expect(ivaCuadra(recortado)).toBeNull();

    const r = clasificarSeccion(recortado, [REGLA_CIF], CATALOGO, TALLER);
    expect(r.sectionId).toBe(GASOLINERA);
  });
});

describe("la confianza no se hereda entera", () => {
  it("una regla infalible sobre un emisor mal leído no es una certeza", () => {
    const r = clasificarSeccion(
      { ...TICKET_GASOLINERA, confianzaEmisor: 0.4 },
      [REGLA_CIF],
      CATALOGO,
      TALLER
    );
    expect(r.sectionId).toBe(GASOLINERA);
    expect(r.confianza).toBe(0.4);
    expect(r.autoSeleccionar).toBe(false);
  });
});

describe("el orden y el catálogo", () => {
  it("manda la de prioridad más baja", () => {
    const primera: ReglaSeccion = { ...REGLA_CIF, id: 20, prioridad: 10, sectionId: GASOLINERA };
    const segunda: ReglaSeccion = { ...REGLA_CIF, id: 21, prioridad: 50, sectionId: TALLER };

    expect(clasificarSeccion(TICKET_GASOLINERA, [segunda, primera], CATALOGO, TALLER).reglaId).toBe(
      20
    );
  });

  it("una regla que apunta a una sección de baja no propone, y se dice", () => {
    /*
     * Esconderlo sería lo cómodo y lo peor: el escáner dejaría de proponer y en
     * Configuración no habría ni rastro del motivo.
     */
    const r = clasificarSeccion(TICKET_GASOLINERA, [REGLA_CIF], new Set([TALLER]), TALLER);

    expect(r.sectionId).toBeNull();
    expect(r.motivo).toContain("ya no está activa");
  });

  it("sin sección por defecto tampoco se inventa una", () => {
    const r = clasificarSeccion(FACTURA_TALLER, [REGLA_CIF], CATALOGO, null);
    expect(r.sectionId).toBeNull();
  });
});
