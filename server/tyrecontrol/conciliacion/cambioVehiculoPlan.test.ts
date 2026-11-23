import { describe, expect, it } from "vitest";
import { cambiosPendientes, planDeCambio } from "./cambioVehiculoPlan.ts";
import { MOTIVOS_DISCREPANCIA } from "../../integration-hub/domain/reconciliation.ts";

const fila = (motivo: string, plate: string | null = "5192GTN") => ({
  motivo,
  detalle: "",
  interno: { id: "tc-1439", matricula: "4032JMT", activo: true, neumaticosMontados: 8 },
  externo: { providerVehicleId: "26263013", plate, name: "974-5192-GTN" },
  enlace: { mobilinkId: "tc-1439", externalCode: "26263013", activo: true },
}) as never;

describe("cambiosPendientes", () => {
  it("solo los de «el proveedor ha cambiado la matrícula», con matrícula nueva", () => {
    const r = cambiosPendientes([
      fila(MOTIVOS_DISCREPANCIA.MATRICULA_CAMBIO_PROVEEDOR),
      fila(MOTIVOS_DISCREPANCIA.MATRICULA_CAMBIO_TYRECONTROL),
      fila(MOTIVOS_DISCREPANCIA.MATRICULA_CAMBIO_PROVEEDOR, null),
    ]);
    expect(r).toEqual([{
      tcVehicleId: "tc-1439", externalVehicleId: "26263013", matriculaAntigua: "4032JMT",
      matriculaNueva: "5192GTN", nombreProveedor: "974-5192-GTN", neumaticosMontados: 8,
    }]);
  });
});

describe("planDeCambio", () => {
  const base = { darDeBajaAntiguo: true, antiguoActivo: true, tcVehicleId: "tc-1439" };
  it("el nuevo existe inactivo: baja del antiguo y reactivar", () => {
    expect(planDeCambio({ ...base, objetivo: { id: "tc-974", activo: false } }))
      .toEqual({ antiguo: "baja_y_desvincular", nuevo: "reactivar_y_vincular" });
  });
  it("el nuevo no existe: alta pendiente", () => {
    expect(planDeCambio({ ...base, objetivo: null })?.nuevo).toBe("alta_pendiente");
  });
  it("el nuevo existe activo: solo vincular", () => {
    expect(planDeCambio({ ...base, objetivo: { id: "tc-974", activo: true } })?.nuevo).toBe("vincular");
  });
  it("sin baja, o antiguo ya de baja: solo desvincular", () => {
    expect(planDeCambio({ ...base, darDeBajaAntiguo: false, objetivo: null })?.antiguo).toBe("desvincular");
    expect(planDeCambio({ ...base, antiguoActivo: false, objetivo: null })?.antiguo).toBe("desvincular");
  });
  it("si el «nuevo» es el mismo vehículo, no hay plan", () => {
    expect(planDeCambio({ ...base, objetivo: { id: "tc-1439", activo: true } })).toBeNull();
  });
});
