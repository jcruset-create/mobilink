import { describe, expect, it } from "vitest";
import { accionesDisponibles, reglaParaRecordar } from "./liquidacion";

const CAJERO = ["cash.view", "cash.expense_claim.view", "cash.expense_claim.create"];
const RESPONSABLE = [...CAJERO, "cash.expense_claim.approve", "cash.expense_claim.pay"];
const CONSULTA = ["cash.view", "cash.expense_claim.view"];

const lista = (...a: Parameters<typeof accionesDisponibles>) => [...accionesDisponibles(...a)].sort();

describe("qué botones salen", () => {
  it("el cajero prepara y presenta, nada más", () => {
    expect(lista("BORRADOR", CAJERO, 0)).toEqual(["EDITAR", "PRESENTAR"]);
    expect(lista("PRESENTADA", CAJERO, 0)).toEqual([]);
    expect(lista("RECHAZADA", CAJERO, 0)).toEqual(["REABRIR"]);
  });

  it("con algo pendiente no se ofrece presentar", () => {
    expect(lista("BORRADOR", CAJERO, 2)).toEqual(["EDITAR"]);
  });

  it("el responsable aprueba, rechaza y anula", () => {
    expect(lista("PRESENTADA", RESPONSABLE, 0)).toEqual(["ANULAR", "APROBAR", "RECHAZAR"]);
    expect(lista("BORRADOR", RESPONSABLE, 0)).toEqual(["ACEPTAR_DUPLICADO", "ANULAR", "EDITAR", "PRESENTAR"]);
  });

  it("una aprobada y sin pagar todavía se puede rechazar", () => {
    expect(lista("APROBADA", RESPONSABLE, 0)).toEqual(["ANULAR", "RECHAZAR"]);
    expect(lista("APROBADA", CAJERO, 0)).toEqual([]);
  });

  it("una pagada no se anula desde aquí, y una anulada ya no tiene nada", () => {
    expect(lista("PAGADA", RESPONSABLE, 0)).toEqual([]);
    expect(lista("ANULADA", RESPONSABLE, 0)).toEqual([]);
  });

  it("la consulta solo mira", () => {
    for (const e of ["BORRADOR", "PRESENTADA", "APROBADA", "RECHAZADA"] as const) {
      expect(lista(e, CONSULTA, 0)).toEqual([]);
    }
  });
});

describe("aprender de lo que se elige a mano", () => {
  const sinRegla = (tipo: string) => ({ tipoEstablecimiento: tipo, conceptoPropuesto: { conceptoId: null } });
  const serranita = { nombre: "BAR LA SERRANITA", nif: "47.171.127-J" };

  it("por tipo de establecimiento cuando la lectura lo sabe", () => {
    expect(reglaParaRecordar(sinRegla("PEAJE"), 7, { nombre: "AUTOPISTES DE CATALUNYA", nif: "A-62026950" })).toEqual({
      campo: "TIPO_ESTABLECIMIENTO",
      patron: "PEAJE",
      que: "los tickets de peaje",
    });
    expect(reglaParaRecordar(sinRegla("RESTAURANTE"), 3, serranita)?.que).toBe("los tickets de bar o restaurante");
  });

  it("si el tipo no dice nada, por el NIF sin puntuación", () => {
    for (const tipo of ["OTRO", "DESCONOCIDO"]) {
      expect(reglaParaRecordar(sinRegla(tipo), 3, serranita)).toEqual({
        campo: "NIF_EMISOR",
        patron: "47171127J",
        que: "los tickets de BAR LA SERRANITA",
      });
    }
  });

  it("sin tipo ni NIF, nada: por nombre casaría con cualquiera", () => {
    expect(reglaParaRecordar(sinRegla("OTRO"), 3, { nombre: "Bar", nif: null })).toBeNull();
    expect(reglaParaRecordar(sinRegla("OTRO"), 3, { nombre: "Bar", nif: "12" })).toBeNull();
  });

  it("ni sin lectura, ni sin concepto elegido, ni si una regla ya lo reconoció", () => {
    expect(reglaParaRecordar(null, 3, serranita)).toBeNull();
    expect(reglaParaRecordar(sinRegla("PEAJE"), null, serranita)).toBeNull();
    expect(
      reglaParaRecordar({ tipoEstablecimiento: "PEAJE", conceptoPropuesto: { conceptoId: 9 } }, 3, serranita)
    ).toBeNull();
  });
});
