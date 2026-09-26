import { describe, expect, it } from "vitest";
import { accionesDisponibles } from "./liquidacion";

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
