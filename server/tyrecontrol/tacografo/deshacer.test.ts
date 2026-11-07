import { describe, expect, it } from "vitest";
import { evaluar, type FilaDelLote, type LoteParaDeshacer, type PropuestaDelLote } from "./deshacer.ts";

const LOTE: LoteParaDeshacer = { id: "l1", empresaId: "emp-1", estado: "aplicado", importadas: 3 };
const T0 = "2026-11-05T10:00:00.000Z";
const fila = (p: Partial<FilaDelLote> & { idOrigen: string }): FilaDelLote =>
  ({ id: `i-${p.idOrigen}`, importadoEn: T0, actualizadoEn: T0, vinculadoEn: null, ...p });

describe("cuándo SÍ se puede deshacer", () => {
  it("un lote recién importado que nadie ha tocado", () => {
    const v = evaluar(LOTE, "emp-1", [fila({ idOrigen: "A" }), fila({ idOrigen: "B" })], []);
    expect(v.puede).toBe(true);
    expect(v.aBorrar).toBe(2);
  });

  /**
   * El disparador toca `actualizado_en` en cada UPDATE, y la propia
   * importación puede hacer uno justo después del INSERT. Eso no es una
   * edición.
   */
  it("una diferencia de milisegundos entre importar y actualizar no cuenta", () => {
    const v = evaluar(LOTE, "emp-1",
      [fila({ idOrigen: "A", actualizadoEn: "2026-11-05T10:00:00.400Z" })], []);
    expect(v.puede).toBe(true);
  });

  it("propuestas pendientes o rechazadas no estorban", () => {
    const props: PropuestaDelLote[] = [
      { id: "p1", estado: "pendiente", matriculaNorm: "1111AAA" },
      { id: "p2", estado: "rechazada", matriculaNorm: "2222BBB" },
    ];
    expect(evaluar(LOTE, "emp-1", [fila({ idOrigen: "A" })], props).puede).toBe(true);
  });

  it("un lote sin filas se puede deshacer: no borra nada y se marca", () => {
    const v = evaluar(LOTE, "emp-1", [], []);
    expect(v.puede).toBe(true);
    expect(v.aBorrar).toBe(0);
  });
});

describe("cuándo se NIEGA, y lo dice", () => {
  it("si el lote no existe", () => {
    const v = evaluar(null, "emp-1", [], []);
    expect(v.puede).toBe(false);
    expect(v.motivo).toBe("no_existe");
  });

  /** Aislamiento entre clientes: no basta con que te sepas el id del lote. */
  it("si el lote es de otra empresa", () => {
    const v = evaluar(LOTE, "emp-OTRA", [fila({ idOrigen: "A" })], []);
    expect(v.puede).toBe(false);
    expect(v.motivo).toBe("otra_empresa");
  });

  it("si ya se deshizo", () => {
    const v = evaluar({ ...LOTE, estado: "deshecho" }, "emp-1", [], []);
    expect(v.puede).toBe(false);
    expect(v.motivo).toBe("ya_deshecho");
  });

  it("si alguien vinculó a mano una intervención que entró sin vehículo", () => {
    const v = evaluar(LOTE, "emp-1", [
      fila({ idOrigen: "A" }),
      fila({ idOrigen: "B", vinculadoEn: "2026-11-05T12:00:00.000Z" }),
    ], []);
    expect(v.puede).toBe(false);
    expect(v.motivo).toBe("vinculadas_a_mano");
    expect(v.estorban).toEqual(["B"]);
    expect(v.explicacion).toMatch(/trabajo de una persona/i);
  });

  it("si una propuesta de medida de este lote ya se aceptó", () => {
    const v = evaluar(LOTE, "emp-1", [fila({ idOrigen: "A" })],
      [{ id: "p1", estado: "aceptada", matriculaNorm: "1234ABC" }]);
    expect(v.puede).toBe(false);
    expect(v.motivo).toBe("propuestas_aceptadas");
    expect(v.estorban).toEqual(["1234ABC"]);
    expect(v.explicacion).toMatch(/medida puesta sin nada que la explique/i);
  });

  it("si alguien editó una fila después de importarla", () => {
    const v = evaluar(LOTE, "emp-1", [
      fila({ idOrigen: "A" }),
      fila({ idOrigen: "B", actualizadoEn: "2026-11-05T18:30:00.000Z" }),
    ], []);
    expect(v.puede).toBe(false);
    expect(v.motivo).toBe("filas_modificadas");
    expect(v.estorban).toEqual(["B"]);
  });

  it("manda el estorbo más grave: la vinculación a mano antes que la edición", () => {
    const v = evaluar(LOTE, "emp-1", [
      fila({ idOrigen: "A", actualizadoEn: "2026-11-05T18:30:00.000Z",
             vinculadoEn: "2026-11-05T18:30:00.000Z" }),
    ], []);
    expect(v.motivo).toBe("vinculadas_a_mano");
  });

  it("negarse nunca dice cero a borrar: se ve lo que había en juego", () => {
    const v = evaluar(LOTE, "emp-1",
      [fila({ idOrigen: "A" }), fila({ idOrigen: "B", vinculadoEn: T0 })], []);
    expect(v.aBorrar).toBe(2);
  });

  /*
   * El adjunto llegó después que el deshacer, y es la misma clase de estorbo
   * que una vinculación a mano: alguien abrió la ficha y subió el papel.
   */
  describe("los informes en PDF adjuntos", () => {
    it("un lote con informes adjuntos no se deshace", () => {
      const v = evaluar(LOTE, "emp-1", [fila({ idOrigen: "A" })], [], 2);
      expect(v.puede).toBe(false);
      expect(v.motivo).toBe("informes_adjuntos");
      expect(v.explicacion).toContain("2 intervención(es)");
    });

    it("y sin informes se deshace como siempre", () => {
      expect(evaluar(LOTE, "emp-1", [fila({ idOrigen: "A" })], [], 0).puede).toBe(true);
    });

    // Que el lote no exista se dice antes: es un error más básico.
    it("pero un lote que no existe sigue diciendo que no existe", () => {
      expect(evaluar(null, "emp-1", [], [], 5).motivo).toBe("no_existe");
    });
  });
});
