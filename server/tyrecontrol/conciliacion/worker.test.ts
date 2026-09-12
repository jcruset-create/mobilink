/**
 * El repaso quincenal.
 *
 * Lo que hay que fijar aquí no es que concilie —eso ya está probado— sino las
 * decisiones que toma solo, de madrugada y sin nadie mirando: a quién repasa,
 * qué enlaza, qué NO toca nunca, y cuándo merece la pena molestar a alguien
 * con un correo.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../../supabase.ts", () => ({
  supabase: { from: vi.fn() },
}));
vi.mock("../../mail.ts", () => ({ getMailTransport: vi.fn() }));
vi.mock("./acciones.ts", async () => {
  const real: any = await vi.importActual("./acciones.ts");
  return { ...real, vincularLote: vi.fn() };
});
vi.mock("./estado.ts", async () => {
  const real: any = await vi.importActual("./estado.ts");
  return { ...real, leerEstado: vi.fn(), guardarEstado: vi.fn() };
});
vi.mock("../../integration-hub/connectors/ConnectorRegistry.ts", () => ({
  resolveTelematicsConnectors: vi.fn(),
  knownTelematicsConnectorKeys: () => ["movertis", "webfleet"],
}));
vi.mock("../../integration-hub/application/services/VehicleReconciliationService.ts", () => ({
  conciliarFlota: vi.fn(),
}));
vi.mock("../../integration-hub/infrastructure/repositories.ts", () => ({
  listTenantsWithConnectors: vi.fn(),
  nextCorrelationId: vi.fn(async () => "COR-1"),
}));
vi.mock("./flota.ts", () => ({ leerFlotaInterna: vi.fn(async () => []) }));

const { supabase } = await import("../../supabase.ts");
const { getMailTransport } = await import("../../mail.ts");
const { vincularLote } = await import("./acciones.ts");
const { leerEstado, guardarEstado } = await import("./estado.ts");
const { resolveTelematicsConnectors } = await import(
  "../../integration-hub/connectors/ConnectorRegistry.ts"
);
const { conciliarFlota } = await import(
  "../../integration-hub/application/services/VehicleReconciliationService.ts"
);
const { listTenantsWithConnectors } = await import(
  "../../integration-hub/infrastructure/repositories.ts"
);
const { ErrorConciliacion } = await import("./acciones.ts");
const { PERIODO_MS, redactarAviso, repasarEmpresa, tickConciliacionQuincenal } = await import(
  "./worker.ts"
);

/** Una conciliación con el resultado que se le diga. */
function conciliacion(over: Record<string, unknown> = {}) {
  return {
    enlazados: [],
    soloProveedor: [],
    soloTyreControl: [],
    discrepancias: [],
    noEvaluados: [],
    externosVistos: [],
    resumen: {
      status: "complete",
      cuentas: [{ connectorKey: "movertis", accountKey: "buses", ok: true, vehiculos: 0 }],
      providerOnlyCount: 0,
      tyrecontrolOnlyCount: 0,
      discrepancyCount: 0,
    },
    ...over,
  };
}

function estadoGuardado(over: Record<string, unknown> = {}): any {
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

/** Un transporte de correo que apunta lo que se le manda. */
function buzon() {
  const enviados: any[] = [];
  vi.mocked(getMailTransport).mockReturnValue({
    sendMail: vi.fn(async (m: any) => { enviados.push(m); }),
  } as any);
  return enviados;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(resolveTelematicsConnectors).mockResolvedValue([
    { key: "movertis", accountKey: "buses", nombre: "Autobuses" },
  ] as any);
  vi.mocked(leerEstado).mockResolvedValue(null);
  vi.mocked(guardarEstado).mockResolvedValue(undefined);
  vi.mocked(conciliarFlota).mockResolvedValue(conciliacion() as any);
  vi.mocked(vincularLote).mockResolvedValue({ enlazados: 0, fallidos: [] } as any);
  vi.mocked(getMailTransport).mockReturnValue(null);
  vi.mocked(supabase.from).mockReturnValue({
    select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { nombre: "Plana", email: "flota@plana.example" } }) }) }),
  } as any);
});

describe("repasarEmpresa()", () => {
  it("una empresa sin telemática no se repasa ni deja estado", async () => {
    vi.mocked(resolveTelematicsConnectors).mockResolvedValue([] as any);

    expect(await repasarEmpresa("empresa-A")).toBeNull();
    // Guardar un cero haría que el menú dijera «todo al día» sin haber mirado.
    expect(guardarEstado).not.toHaveBeenCalled();
  });

  it("enlaza las coincidencias exactas y las cuenta", async () => {
    vi.mocked(vincularLote).mockResolvedValue({ enlazados: 615, fallidos: [] } as any);

    const r = await repasarEmpresa("empresa-A");

    expect(r?.estado.enlazadosAuto).toBe(615);
    expect(vincularLote).toHaveBeenCalledWith({
      empresaId: "empresa-A", connectorKey: "movertis", accountKey: "buses",
    });
  });

  it("el lote se pide SIN «esperados»: no hay pantalla que pueda ir desfasada", async () => {
    await repasarEmpresa("empresa-A");
    expect(vi.mocked(vincularLote).mock.calls[0][1]).toBeUndefined();
  });

  it("que no haya nada que enlazar es lo normal, no un fallo", async () => {
    vi.mocked(vincularLote).mockRejectedValue(
      new ErrorConciliacion("SIN_PROPUESTAS", "No hay ninguna coincidencia exacta que enlazar."),
    );

    const r = await repasarEmpresa("empresa-A");
    expect(r?.estado.enlazadosAuto).toBe(0);
    expect(r?.estado.status).toBe("complete");
  });

  it("si el enlace en bloque revienta, la conciliación se hace igual", async () => {
    vi.mocked(vincularLote).mockRejectedValue(new Error("la base se cayó a media tanda"));

    const r = await repasarEmpresa("empresa-A");
    expect(r).not.toBeNull();
    expect(guardarEstado).toHaveBeenCalled();
  });

  it("NUNCA da de baja ni crea vehículos: solo guarda el recuento", async () => {
    // Un vehículo que desaparece del proveedor no cambia de estado en
    // TyreControl. Lo único que se hace es contarlo.
    vi.mocked(conciliarFlota).mockResolvedValue(
      conciliacion({
        resumen: {
          status: "complete",
          cuentas: [{ connectorKey: "movertis", accountKey: "buses", ok: true, vehiculos: 10 }],
          providerOnlyCount: 0,
          tyrecontrolOnlyCount: 12,
          discrepancyCount: 0,
        },
      }) as any,
    );

    const r = await repasarEmpresa("empresa-A");
    expect(r?.estado.pendientes.soloTyreControl).toBe(12);
    // No hay ningún camino a las acciones destructivas desde aquí.
    const acciones: any = await import("./acciones.ts");
    expect(acciones.darDeBaja).toBeTypeOf("function");
    expect(vi.isMockFunction(acciones.darDeBaja)).toBe(false);
  });

  it("una pasada incompleta no vale como referencia para la siguiente", async () => {
    vi.mocked(conciliarFlota).mockResolvedValue(
      conciliacion({
        externosVistos: ["E1"],
        resumen: {
          status: "incomplete",
          cuentas: [{ connectorKey: "movertis", accountKey: "aux", ok: false, vehiculos: 0, error: "timeout" }],
          providerOnlyCount: 0, tyrecontrolOnlyCount: 0, discrepancyCount: 0,
        },
      }) as any,
    );

    const r = await repasarEmpresa("empresa-A");
    expect(r?.estado.externosCompletos).toBe(false);
  });
});

describe("cuándo se manda el correo", () => {
  it("el primer repaso se cuenta siempre", async () => {
    const enviados = buzon();
    await repasarEmpresa("empresa-A");
    expect(enviados).toHaveLength(1);
  });

  it("sin cambios y sin enlaces nuevos, no se molesta a nadie", async () => {
    const enviados = buzon();
    vi.mocked(leerEstado).mockResolvedValue(estadoGuardado({ externosVistos: ["E1"] }));
    vi.mocked(conciliarFlota).mockResolvedValue(conciliacion({ externosVistos: ["E1"] }) as any);

    const r = await repasarEmpresa("empresa-A");
    expect(enviados).toHaveLength(0);
    expect(r?.motivoSinCorreo).toBe("sin cambios");
  });

  it("un alta en el proveedor sí es noticia", async () => {
    const enviados = buzon();
    vi.mocked(leerEstado).mockResolvedValue(estadoGuardado({ externosVistos: ["E1"] }));
    vi.mocked(conciliarFlota).mockResolvedValue(
      conciliacion({
        externosVistos: ["E1", "E2"],
        soloProveedor: [{ externo: { providerVehicleId: "E2", plate: "9999ZZZ" } }],
        resumen: {
          status: "complete",
          cuentas: [{ connectorKey: "movertis", accountKey: "buses", ok: true, vehiculos: 2 }],
          providerOnlyCount: 1, tyrecontrolOnlyCount: 0, discrepancyCount: 0,
        },
      }) as any,
    );

    const r = await repasarEmpresa("empresa-A");
    expect(r?.cambios.altas).toEqual(["E2"]);
    expect(enviados).toHaveLength(1);
    // La matrícula, no el identificador interno del proveedor.
    expect(enviados[0].text).toContain("9999ZZZ");
  });

  it("una cuenta caída es noticia aunque no haya cambiado nada", async () => {
    const enviados = buzon();
    vi.mocked(leerEstado).mockResolvedValue(estadoGuardado());
    vi.mocked(conciliarFlota).mockResolvedValue(
      conciliacion({
        resumen: {
          status: "error",
          cuentas: [{ connectorKey: "movertis", accountKey: "buses", ok: false, vehiculos: 0, error: "fetch failed" }],
          providerOnlyCount: 0, tyrecontrolOnlyCount: 0, discrepancyCount: 0,
        },
      }) as any,
    );

    await repasarEmpresa("empresa-A");
    expect(enviados[0].text).toContain("fetch failed");
  });

  it("sin SMTP el repaso se guarda igual y se dice por qué no salió", async () => {
    vi.mocked(getMailTransport).mockReturnValue(null);
    const r = await repasarEmpresa("empresa-A");
    expect(guardarEstado).toHaveBeenCalled();
    expect(r?.correoEnviado).toBe(false);
    expect(r?.motivoSinCorreo).toBe("SMTP no configurado");
  });

  it("sin destinatario tampoco se pierde el repaso", async () => {
    buzon();
    vi.mocked(supabase.from).mockReturnValue({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { nombre: "Plana", email: null } }) }) }),
    } as any);

    const r = await repasarEmpresa("empresa-A");
    expect(guardarEstado).toHaveBeenCalled();
    expect(r?.motivoSinCorreo).toBe("sin destinatario");
  });

  it("un correo que no sale no deshace lo hecho", async () => {
    vi.mocked(getMailTransport).mockReturnValue({
      sendMail: vi.fn(async () => { throw new Error("SMTP 421"); }),
    } as any);

    const r = await repasarEmpresa("empresa-A");
    expect(r?.correoEnviado).toBe(false);
    expect(guardarEstado).toHaveBeenCalled();
  });
});

describe("redactarAviso()", () => {
  it("sin pasada anterior lo dice, en vez de fingir que no hay altas", () => {
    const { texto } = redactarAviso(
      "Plana",
      estadoGuardado(),
      { altas: [], bajas: [], comparable: false },
    );
    expect(texto).toContain("No hay con qué comparar");
    expect(texto).not.toContain("Altas en el proveedor: ninguna");
  });

  it("las bajas dejan claro que no se ha dado de baja nada", () => {
    const { texto } = redactarAviso(
      "Plana",
      estadoGuardado(),
      { altas: [], bajas: ["E1"], comparable: true },
      new Map([["E1", "1234ABC"]]),
    );
    expect(texto).toContain("1234ABC");
    expect(texto).toContain("no se ha dado de baja ninguno");
  });

  it("una lista larga se recorta y se dice cuántas faltan", () => {
    const muchas = Array.from({ length: 120 }, (_, i) => `E${i}`);
    const { texto } = redactarAviso(
      "Plana",
      estadoGuardado(),
      { altas: muchas, bajas: [], comparable: true },
    );
    expect(texto).toContain("y 70 más");
  });

  it("el asunto lleva el total por revisar", () => {
    const { asunto } = redactarAviso(
      "Plana",
      estadoGuardado({ pendientes: { soloProveedor: 100, soloTyreControl: 12, discrepancias: 4 } }),
      { altas: [], bajas: [], comparable: true },
    );
    expect(asunto).toContain("Plana");
    expect(asunto).toContain("116");
  });
});

describe("tickConciliacionQuincenal()", () => {
  it("repasa a quien no se ha repasado nunca", async () => {
    vi.mocked(listTenantsWithConnectors).mockResolvedValue(["empresa-A"]);

    const r = await tickConciliacionQuincenal(10_000);
    expect(r.repasados).toEqual(["empresa-A"]);
  });

  it("no repasa a quien se repasó hace menos de quince días", async () => {
    vi.mocked(listTenantsWithConnectors).mockResolvedValue(["empresa-A"]);
    vi.mocked(leerEstado).mockResolvedValue(estadoGuardado({ ejecutadoMs: 1_000 }));

    const r = await tickConciliacionQuincenal(1_000 + PERIODO_MS - 1);
    expect(r.repasados).toEqual([]);
    expect(r.omitidos).toBe(1);
    // Y no se ha hablado con el proveedor solo para mirar el reloj.
    expect(conciliarFlota).not.toHaveBeenCalled();
  });

  it("al cumplirse el plazo, vuelve a tocar", async () => {
    vi.mocked(listTenantsWithConnectors).mockResolvedValue(["empresa-A"]);
    vi.mocked(leerEstado).mockResolvedValue(estadoGuardado({ ejecutadoMs: 1_000 }));

    const r = await tickConciliacionQuincenal(1_000 + PERIODO_MS);
    expect(r.repasados).toEqual(["empresa-A"]);
  });

  it("una empresa que falla no deja sin repasar a las siguientes", async () => {
    vi.mocked(listTenantsWithConnectors).mockResolvedValue(["mala", "buena"]);
    vi.mocked(conciliarFlota).mockImplementation(async (ctx: any) => {
      if (ctx.tenantId === "mala") throw new Error("se cayó");
      return conciliacion() as any;
    });

    const r = await tickConciliacionQuincenal(10_000);
    expect(r.repasados).toEqual(["buena"]);
  });
});
