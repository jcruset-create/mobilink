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
  MOTIVOS_BAJA_BLOQUEADA,
  PERIODO_REPASO_MS,
  LATIDO_REPASO_MS,
  VENTANA_FRESCURA_MS,
  permisoDeBaja,
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

/**
 * `permisoDeBaja` — la regla que decide si se puede afirmar una ausencia.
 *
 * Es pura y está aparte de la acción a propósito: la decisión de «este vehículo
 * ya no está en el proveedor» es la que arrastra neumáticos montados, histórico
 * y facturación, y tiene que poder probarse sin base ni red.
 */
describe("permisoDeBaja()", () => {
  const AHORA = 1_800_000_000_000;
  const CUENTA = { connectorKey: "movertis", accountKey: "buses" };

  const completo = (over: Record<string, unknown> = {}): any => ({
    version: 1,
    ejecutadoMs: AHORA - 60_000,
    status: "complete",
    enlazadosAuto: 0,
    pendientes: { soloProveedor: 0, soloTyreControl: 0, discrepancias: 0 },
    cuentas: [{ ...CUENTA, ok: true }],
    externosVistos: [],
    externosCompletos: true,
    ...over,
  });

  const pedir = (estado: any, over: Record<string, unknown> = {}) =>
    permisoDeBaja({ estado, ...CUENTA, ahoraMs: AHORA, ...over });

  it("permite con la última pasada completa, reciente y esa cuenta respondiendo", () => {
    const r = pedir(completo());
    expect(r.estado).toBe("permitido");
  });

  it("sin ninguna conciliación previa, no", () => {
    const r = pedir(null);
    expect(r).toMatchObject({ estado: "bloqueado", codigo: MOTIVOS_BAJA_BLOQUEADA.SIN_CONCILIACION });
  });

  it("incompleta, no: no se sabe qué ha desaparecido", () => {
    expect(pedir(completo({ status: "incomplete" }))).toMatchObject({
      codigo: MOTIVOS_BAJA_BLOQUEADA.INCOMPLETA,
    });
  });

  it("con error, no: que no se pueda preguntar no es que hayan desaparecido", () => {
    expect(pedir(completo({ status: "error" }))).toMatchObject({
      codigo: MOTIVOS_BAJA_BLOQUEADA.CON_ERROR,
    });
  });

  it("la cuenta que pide la baja tiene que estar en la pasada", () => {
    // Con dos cuentas, que conteste la de autobuses no dice nada de la auxiliar.
    expect(pedir(completo({ cuentas: [{ connectorKey: "movertis", accountKey: "auxiliar", ok: true }] })))
      .toMatchObject({ codigo: MOTIVOS_BAJA_BLOQUEADA.CUENTA_NO_CONCILIADA });
    // Y estar no basta: tiene que haber respondido.
    expect(pedir(completo({ cuentas: [{ ...CUENTA, ok: false }] })))
      .toMatchObject({ codigo: MOTIVOS_BAJA_BLOQUEADA.CUENTA_NO_CONCILIADA });
    // Ni vale la de otro proveedor con el mismo nombre de cuenta.
    expect(pedir(completo({ cuentas: [{ connectorKey: "webfleet", accountKey: "buses", ok: true }] })))
      .toMatchObject({ codigo: MOTIVOS_BAJA_BLOQUEADA.CUENTA_NO_CONCILIADA });
  });

  it("la ventana de frescura sale de la cadencia del repaso, no de un número a dedo", () => {
    // Catorce días de periodo más seis horas de latido: eso es lo que puede
    // tardar el proceso en volver a pasar sin que nada esté roto.
    expect(VENTANA_FRESCURA_MS).toBe(PERIODO_REPASO_MS + LATIDO_REPASO_MS);
  });

  it("dentro de la ventana vale, y un milisegundo más allá no", () => {
    expect(pedir(completo({ ejecutadoMs: AHORA - VENTANA_FRESCURA_MS })).estado).toBe("permitido");
    expect(pedir(completo({ ejecutadoMs: AHORA - VENTANA_FRESCURA_MS - 1 }))).toMatchObject({
      codigo: MOTIVOS_BAJA_BLOQUEADA.CADUCADA,
    });
  });

  it("una pasada de hace trece días sigue valiendo", () => {
    // Lo normal con un repaso quincenal. Si esto fallara, la pantalla pediría
    // conciliar de nuevo cada día sin motivo.
    const trece = AHORA - 13 * 24 * 3600_000;
    expect(pedir(completo({ ejecutadoMs: trece })).estado).toBe("permitido");
  });

  it("sin fecha de ejecución, no: una foto sin fecha no demuestra nada", () => {
    expect(pedir(completo({ ejecutadoMs: 0 }))).toMatchObject({
      codigo: MOTIVOS_BAJA_BLOQUEADA.CADUCADA,
    });
  });

  it("el mensaje explica qué hacer y NO lleva datos de nadie", () => {
    const r = pedir(completo({ status: "incomplete" }));
    if (r.estado !== "bloqueado") throw new Error("debería estar bloqueado");
    expect(r.mensaje).toContain("Vuelve a conciliar");
    // Ni matrículas, ni identificadores de vehículo, ni nada de otra empresa.
    expect(r.mensaje).not.toMatch(/[0-9]{4}[A-Z]{3}/);
    expect(r.mensaje).not.toContain("empresa-");
  });

  it("el orden de las comprobaciones: el estado global manda sobre la cuenta", () => {
    // Una pasada incompleta se rechaza por incompleta aunque la cuenta que pide
    // la baja sí haya contestado: el resto de la flota sigue sin saberse.
    expect(pedir(completo({ status: "incomplete", cuentas: [{ ...CUENTA, ok: true }] })))
      .toMatchObject({ codigo: MOTIVOS_BAJA_BLOQUEADA.INCOMPLETA });
  });
});
