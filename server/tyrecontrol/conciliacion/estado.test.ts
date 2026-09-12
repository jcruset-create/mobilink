/**
 * Lo que se guarda entre una conciliación y la siguiente.
 *
 * El punto delicado no es guardar: es cuándo la comparación SIGNIFICA algo. Una
 * diferencia entre dos listas solo es un alta o una baja si las dos listas
 * están completas; si no, es un hueco, y llamarlo baja llenaría el correo de
 * vehículos que no se han ido a ninguna parte.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../../integration-hub/infrastructure/repositories.ts", () => ({
  getSyncState: vi.fn(),
  upsertSyncState: vi.fn(),
}));

const { getSyncState, upsertSyncState } = await import(
  "../../integration-hub/infrastructure/repositories.ts"
);
const {
  calcularCambios,
  guardarEstado,
  leerEstado,
  ENTIDAD_CONCILIACION,
  MAX_EXTERNOS_GUARDADOS,
} = await import("./estado.ts");

function estado(over: Record<string, unknown> = {}): any {
  return {
    version: 1,
    ejecutadoMs: 1_000,
    status: "complete",
    enlazadosAuto: 0,
    pendientes: { soloProveedor: 0, soloTyreControl: 0, discrepancias: 0 },
    cuentas: [],
    externosVistos: [],
    externosCompletos: true,
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("leerEstado()", () => {
  it("sin fila devuelve null, que no es lo mismo que cero pendientes", async () => {
    vi.mocked(getSyncState).mockResolvedValue(null as any);
    expect(await leerEstado("empresa-A")).toBeNull();
  });

  it("un detalle corrupto se trata como si no hubiera pasada anterior", async () => {
    vi.mocked(getSyncState).mockResolvedValue({ detail: "{esto no es json" } as any);
    expect(await leerEstado("empresa-A")).toBeNull();
  });

  it("una versión desconocida no se interpreta a la fuerza", async () => {
    vi.mocked(getSyncState).mockResolvedValue({ detail: JSON.stringify({ version: 9 }) } as any);
    expect(await leerEstado("empresa-A")).toBeNull();
  });

  it("lee los contadores y la lista de externos", async () => {
    vi.mocked(getSyncState).mockResolvedValue({
      detail: JSON.stringify(
        estado({
          pendientes: { soloProveedor: 3, soloTyreControl: 2, discrepancias: 1 },
          externosVistos: ["E1", "E2"],
        }),
      ),
    } as any);

    const e = await leerEstado("empresa-A");
    expect(e?.pendientes).toEqual({ soloProveedor: 3, soloTyreControl: 2, discrepancias: 1 });
    expect(e?.externosVistos).toEqual(["E1", "E2"]);
    expect(getSyncState).toHaveBeenCalledWith("empresa-A", ENTIDAD_CONCILIACION);
  });
});

describe("guardarEstado()", () => {
  it("guarda el resumen y la marca de tiempo", async () => {
    await guardarEstado("empresa-A", estado({ ejecutadoMs: 7_000, externosVistos: ["E1"] }));

    const arg = vi.mocked(upsertSyncState).mock.calls[0][0];
    expect(arg.tenantId).toBe("empresa-A");
    expect(arg.entity).toBe(ENTIDAD_CONCILIACION);
    expect(arg.lastSyncMs).toBe(7_000);
    expect(JSON.parse(arg.detail!).externosVistos).toEqual(["E1"]);
  });

  it("una flota desmesurada no se guarda a medias: se guarda vacía y marcada", async () => {
    // Guardar media lista sería peor que no guardar ninguna: la mitad que falta
    // saldría como baja en la siguiente pasada.
    const muchos = Array.from({ length: MAX_EXTERNOS_GUARDADOS + 1 }, (_, i) => `E${i}`);
    await guardarEstado("empresa-A", estado({ externosVistos: muchos }));

    const guardado = JSON.parse(vi.mocked(upsertSyncState).mock.calls[0][0].detail!);
    expect(guardado.externosVistos).toEqual([]);
    expect(guardado.externosCompletos).toBe(false);
  });
});

describe("calcularCambios()", () => {
  it("sin pasada anterior no hay nada que comparar", () => {
    const c = calcularCambios(null, estado({ externosVistos: ["E1"] }));
    expect(c).toEqual({ altas: [], bajas: [], comparable: false });
  });

  it("con las dos completas, saca altas y bajas", () => {
    const c = calcularCambios(
      estado({ externosVistos: ["E1", "E2"] }),
      estado({ externosVistos: ["E2", "E3"] }),
    );
    expect(c.comparable).toBe(true);
    expect(c.altas).toEqual(["E3"]);
    expect(c.bajas).toEqual(["E1"]);
  });

  it("si la pasada de ahora no fue completa, no se afirma ninguna baja", () => {
    // Es el caso de Movertis sin contestar: los 751 vehículos no están porque
    // no hay respuesta, no porque los hayan retirado.
    const c = calcularCambios(
      estado({ externosVistos: ["E1", "E2"] }),
      estado({ status: "error", externosVistos: [], externosCompletos: false }),
    );
    expect(c.comparable).toBe(false);
    expect(c.bajas).toEqual([]);
  });

  it("si la anterior estaba recortada, tampoco", () => {
    const c = calcularCambios(
      estado({ externosVistos: [], externosCompletos: false }),
      estado({ externosVistos: ["E1"] }),
    );
    expect(c.comparable).toBe(false);
    expect(c.altas).toEqual([]);
  });

  it("una cuenta caída en la anterior invalida la comparación aunque hubiera lista", () => {
    const c = calcularCambios(
      estado({ status: "incomplete", externosVistos: ["E1"] }),
      estado({ externosVistos: ["E1", "E2"] }),
    );
    expect(c.comparable).toBe(false);
  });

  it("sin cambios, dos listas iguales no dan noticia", () => {
    const c = calcularCambios(
      estado({ externosVistos: ["E1", "E2"] }),
      estado({ externosVistos: ["E2", "E1"] }),
    );
    expect(c.comparable).toBe(true);
    expect(c.altas).toEqual([]);
    expect(c.bajas).toEqual([]);
  });
});
