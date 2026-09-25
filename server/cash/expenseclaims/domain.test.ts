import { describe, expect, it } from "vitest";
import {
  type AccionLiquidacion,
  type EstadoLiquidacion,
  type LineaParaReglas,
  bloqueosParaPresentar,
  claveDeDuplicado,
  destinoDerivado,
  lineasEditables,
  nifNormalizado,
  periodoDe,
  totalesPorConcepto,
  transicion,
} from "./domain.ts";

const ESTADOS: EstadoLiquidacion[] = ["BORRADOR", "PRESENTADA", "APROBADA", "RECHAZADA", "PAGADA", "ANULADA"];
const ACCIONES: AccionLiquidacion[] = ["PRESENTAR", "APROBAR", "RECHAZAR", "REABRIR", "PAGAR", "ANULAR", "DESHACER_PAGO"];

/** El grafo esperado, escrito aparte del código para que se contrasten. */
const PERMITIDAS: Record<string, EstadoLiquidacion> = {
  "BORRADOR:PRESENTAR": "PRESENTADA",
  "BORRADOR:ANULAR": "ANULADA",
  "PRESENTADA:APROBAR": "APROBADA",
  "PRESENTADA:RECHAZAR": "RECHAZADA",
  "PRESENTADA:ANULAR": "ANULADA",
  "APROBADA:PAGAR": "PAGADA",
  "APROBADA:RECHAZAR": "RECHAZADA",
  "APROBADA:ANULAR": "ANULADA",
  "RECHAZADA:REABRIR": "BORRADOR",
  "RECHAZADA:ANULAR": "ANULADA",
  "PAGADA:DESHACER_PAGO": "APROBADA",
};

describe("transiciones de una liquidación", () => {
  it("cada par estado × acción, sin excepción", () => {
    /*
     * La tabla entera y no unos cuantos casos: una transición de más —pagar
     * desde BORRADOR, anular una PAGADA— es exactamente el fallo que no se ve
     * probando solo el camino feliz.
     */
    for (const e of ESTADOS) {
      for (const a of ACCIONES) {
        expect(transicion(e, a), `${e} + ${a}`).toBe(PERMITIDAS[`${e}:${a}`] ?? null);
      }
    }
  });

  it("una liquidación pagada no se anula: primero se anula el pago", () => {
    expect(transicion("PAGADA", "ANULAR")).toBeNull();
  });

  it("presentada no vuelve a borrador sin que la rechacen", () => {
    expect(transicion("PRESENTADA", "REABRIR")).toBeNull();
  });

  it("solo en borrador se tocan las líneas", () => {
    expect(ESTADOS.filter(lineasEditables)).toEqual(["BORRADOR"]);
  });
});

let siguiente = 1;
const linea = (extra: Partial<LineaParaReglas> = {}): LineaParaReglas => ({
  id: siguiente++,
  situacion: "INCLUIDA",
  fecha: "2026-09-22",
  importeCentimos: 1000,
  conceptoId: 1,
  conceptoNombre: "Dietas",
  moneda: "EUR",
  revisada: true,
  ...extra,
});

/** El ejemplo del encargo: Dietas 66,40 + Peajes 15,88 = 82,28. */
const EJEMPLO = [
  linea({ importeCentimos: 2440, conceptoId: 1, conceptoNombre: "Dietas", fecha: "2026-09-22" }),
  linea({ importeCentimos: 4200, conceptoId: 1, conceptoNombre: "Dietas", fecha: "2026-09-23" }),
  linea({ importeCentimos: 1024, conceptoId: 2, conceptoNombre: "Peajes", fecha: "2026-09-22" }),
  linea({ importeCentimos: 564, conceptoId: 2, conceptoNombre: "Peajes", fecha: "2026-09-21" }),
];

describe("totales", () => {
  it("el ejemplo del encargo: 66,40 + 15,88 = 82,28", () => {
    const t = totalesPorConcepto(EJEMPLO);
    expect(t.totalCentimos).toBe(8228);
    expect(t.lineas).toBe(4);
    expect(t.porConcepto).toEqual([
      { conceptoId: 1, nombre: "Dietas", importeCentimos: 6640, lineas: 2 },
      { conceptoId: 2, nombre: "Peajes", importeCentimos: 1588, lineas: 2 },
    ]);
  });

  it("una línea excluida se ve, pero no suma", () => {
    const t = totalesPorConcepto([...EJEMPLO, linea({ importeCentimos: 9999, situacion: "EXCLUIDA" })]);
    expect(t.totalCentimos).toBe(8228);
    expect(t.lineas).toBe(4);
  });

  it("lo que no tiene concepto sale aparte y al final, aunque sea lo más grande", () => {
    const t = totalesPorConcepto([linea({ importeCentimos: 100 }), linea({ importeCentimos: 5000, conceptoId: null })]);
    expect(t.porConcepto.map((p) => p.nombre)).toEqual(["Dietas", "Sin concepto"]);
    expect(t.totalCentimos).toBe(5100);
  });

  it("el periodo es de las incluidas con fecha", () => {
    expect(periodoDe(EJEMPLO)).toEqual({ desde: "2026-09-21", hasta: "2026-09-23" });
    expect(
      periodoDe([...EJEMPLO, linea({ fecha: "2026-01-01", situacion: "EXCLUIDA" }), linea({ fecha: null })])
    ).toEqual({ desde: "2026-09-21", hasta: "2026-09-23" });
    expect(periodoDe([])).toEqual({ desde: null, hasta: null });
  });
});

describe("qué impide presentar", () => {
  const codigos = (l: LineaParaReglas[], pendientes: number[] = []) =>
    bloqueosParaPresentar(l, new Set(pendientes)).map((b) => b.codigo);

  it("el ejemplo, revisado y completo, se presenta", () => {
    expect(codigos(EJEMPLO)).toEqual([]);
  });

  it("sin líneas incluidas no hay nada que presentar", () => {
    expect(codigos([])).toEqual(["SIN_LINEAS"]);
    expect(codigos([linea({ situacion: "EXCLUIDA" })])).toEqual(["SIN_LINEAS"]);
  });

  it("cada dato obligatorio, por separado", () => {
    expect(codigos([linea({ fecha: null })])).toEqual(["LINEA_SIN_FECHA"]);
    expect(codigos([linea({ importeCentimos: 0 })])).toEqual(["LINEA_SIN_IMPORTE"]);
    expect(codigos([linea({ conceptoId: null })])).toEqual(["LINEA_SIN_CONCEPTO"]);
    expect(codigos([linea({ moneda: "GBP" })])).toEqual(["LINEA_EN_OTRA_MONEDA"]);
    expect(codigos([linea({ revisada: false })])).toEqual(["LINEA_SIN_REVISAR"]);
  });

  it("los enseña TODOS, no solo el primero", () => {
    expect(codigos([linea({ fecha: null, revisada: false }), linea({ conceptoId: null })])).toEqual([
      "LINEA_SIN_FECHA",
      "LINEA_SIN_REVISAR",
      "LINEA_SIN_CONCEPTO",
    ]);
  });

  it("un duplicado sin resolver bloquea; en una línea excluida, no", () => {
    const a = linea();
    const b = linea({ situacion: "EXCLUIDA" });
    expect(codigos([a], [a.id])).toEqual(["DUPLICADO_SIN_RESOLVER"]);
    expect(codigos([a, b], [b.id])).toEqual([]);
  });

  it("a una línea excluida no se le pide nada", () => {
    expect(codigos([linea(), linea({ situacion: "EXCLUIDA", fecha: null, revisada: false, conceptoId: null })])).toEqual([]);
  });

  it("el total a cero solo se dice cuando no hay otra causa", () => {
    // Con la línea sin importe, lo que hay que arreglar es la línea.
    expect(codigos([linea({ importeCentimos: 0 })])).toEqual(["LINEA_SIN_IMPORTE"]);
  });
});

describe("a quién se imputa cada gasto", () => {
  it("PERSONA → el trabajador de la liquidación, diga lo que diga la línea", () => {
    expect(destinoDerivado("PERSONA", 7, null)).toBe(7);
    expect(destinoDerivado("PERSONA", 7, 99)).toBe(7);
  });

  it("CENTRO_COSTE → el de la línea, o nadie", () => {
    expect(destinoDerivado("CENTRO_COSTE", 7, 12)).toBe(12);
    expect(destinoDerivado("CENTRO_COSTE", 7, null)).toBeNull();
  });

  it("NINGUNO → nadie", () => {
    expect(destinoDerivado("NINGUNO", 7, 12)).toBeNull();
  });
});

describe("clave de duplicado", () => {
  const base = { emisorNif: null as string | null, emisorNombre: "", fecha: "2026-09-22", importeCentimos: 1024 };

  it("el NIF, con o sin puntuación, es el mismo", () => {
    expect(nifNormalizado("B-43.044.379")).toBe("B43044379");
    expect(claveDeDuplicado({ ...base, emisorNif: "b-43.044.379" })).toBe(
      claveDeDuplicado({ ...base, emisorNif: "B43044379" })
    );
  });

  it("sin NIF, el nombre sin tildes ni mayúsculas", () => {
    expect(claveDeDuplicado({ ...base, emisorNombre: "Autopistas AUMAR, S.A." })).toBe(
      claveDeDuplicado({ ...base, emisorNombre: "autopistas aumar s a" })
    );
    expect(claveDeDuplicado({ ...base, emisorNombre: "Restaurante Él Cañón" })).toBe(
      claveDeDuplicado({ ...base, emisorNombre: "RESTAURANTE EL CANON" })
    );
  });

  it("otro día u otro importe es otro gasto", () => {
    const k = claveDeDuplicado({ ...base, emisorNif: "B43044379" });
    expect(claveDeDuplicado({ ...base, emisorNif: "B43044379", fecha: "2026-09-23" })).not.toBe(k);
    expect(claveDeDuplicado({ ...base, emisorNif: "B43044379", importeCentimos: 1025 })).not.toBe(k);
  });

  it("sin fecha, sin importe o sin emisor no se afirma nada", () => {
    expect(claveDeDuplicado({ ...base, emisorNif: "B43044379", fecha: null })).toBeNull();
    expect(claveDeDuplicado({ ...base, emisorNif: "B43044379", importeCentimos: 0 })).toBeNull();
    expect(claveDeDuplicado({ ...base, emisorNombre: "  " })).toBeNull();
  });
});
