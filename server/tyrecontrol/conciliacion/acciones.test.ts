/**
 * Pruebas de las acciones de la conciliación.
 *
 * Lo que se fija aquí no es que las funciones «funcionen»: es que las que
 * pueden hacer daño se niegan a hacerlo. Vincular el camión de otro cliente,
 * dar de baja un vehículo ajeno, o desmontar gomas sin querer son fallos que
 * no dan error, dan un dato creíble y falso en la ficha equivocada.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../../supabase.ts", () => ({ supabase: { from: vi.fn(), auth: {} } }));
vi.mock("../../integration-hub/infrastructure/repositories.ts", () => ({
  upsertMapping: vi.fn(),
  listVehicleMappings: vi.fn(),
  setVehicleMappingActive: vi.fn(),
  ignoreExternal: vi.fn(),
  unignoreExternal: vi.fn(),
  nextCorrelationId: vi.fn(async () => "COR-1"),
}));
// El estado guardado se finge para poder decidir, prueba a prueba, si la última
// conciliación permite afirmar ausencias. `permisoDeBaja` es puro y se prueba
// aparte en estado.test.ts; lo que se fija aquí es que `darDeBaja` lo EXIJA.
vi.mock("./estado.ts", async () => {
  const real: any = await vi.importActual("./estado.ts");
  return { ...real, leerEstado: vi.fn() };
});
// El servicio de conciliación se finge entero: aquí no se prueba QUÉ propone
// —eso está en reconciliation.test.ts— sino qué hace el lote con lo propuesto.
vi.mock("../../integration-hub/application/services/VehicleReconciliationService.ts", () => ({
  conciliarFlota: vi.fn(),
}));
// El registro de conectores: es la fuente de verdad de «esta cuenta existe, está
// habilitada y es de esta empresa», y de ella sale la flota con la que se
// comprueba que el vehículo externo existe de verdad.
vi.mock("../../integration-hub/connectors/ConnectorRegistry.ts", () => ({
  resolveTelematicsConnectors: vi.fn(),
}));

const { supabase } = await import("../../supabase.ts");
const { upsertMapping, listVehicleMappings, setVehicleMappingActive, unignoreExternal, ignoreExternal } =
  await import("../../integration-hub/infrastructure/repositories.ts");
const { conciliarFlota } = await import(
  "../../integration-hub/application/services/VehicleReconciliationService.ts"
);
const { resolveTelematicsConnectors } = await import(
  "../../integration-hub/connectors/ConnectorRegistry.ts"
);
const { leerEstado, MOTIVOS_BAJA_BLOQUEADA, PERIODO_REPASO_MS, VENTANA_FRESCURA_MS } =
  await import("./estado.ts");
const {
  vincular, desvincular, darDeBaja, crearPendiente, dejarDeIgnorar, vincularLote, ErrorConciliacion,
  crearPendientesLote, ignorarLote,
} = await import("./acciones.ts");

const AMBITO = { empresaId: "empresa-A", connectorKey: "movertis", accountKey: "buses" };

/**
 * Finge la cuenta telemática de `AMBITO` con la flota indicada.
 *
 * `externos` son los identificadores que el proveedor devuelve AHORA: lo que
 * decide si un enlace apunta a un vehículo que existe.
 */
function fingirCuenta(externos: string[] = ["EXT-1"], over: Record<string, unknown> = {}) {
  vi.mocked(resolveTelematicsConnectors).mockResolvedValue([
    {
      key: "movertis",
      accountKey: "buses",
      usingDefault: false,
      config: {},
      connector: {
        listVehicles: vi.fn(async () => externos.map((id) => ({ providerVehicleId: id }))),
      },
      ...over,
    },
  ] as any);
}

/** Finge lo que devuelve la conciliación, con el molde en un solo sitio. */
function fingirConciliacion(r: Record<string, unknown>) {
  vi.mocked(conciliarFlota).mockResolvedValue({
    enlazados: [], soloTyreControl: [], discrepancias: [], noEvaluados: [], soloProveedor: [],
    ...r,
  } as any);
}

/** Un resumen de conciliación completo, que es lo que permite autoenlazar. */
const RESUMEN_COMPLETO = {
  status: "complete",
  cuentas: [{ connectorKey: "movertis", accountKey: "buses", ok: true, vehiculos: 1 }],
};

/** Una última conciliación completa, reciente y con ESTA cuenta respondiendo. */
function estadoQuePermiteBaja(sobrescribir: Record<string, unknown> = {}): any {
  return {
    version: 1 as const,
    ejecutadoMs: Date.now() - 60_000,
    status: "complete",
    enlazadosAuto: 0,
    pendientes: { soloProveedor: 0, soloTyreControl: 0, discrepancias: 0 },
    cuentas: [{ connectorKey: "movertis", accountKey: "buses", ok: true }],
    externosVistos: [],
    externosCompletos: true,
    ...sobrescribir,
  };
}

/**
 * Finge `supabase.from(tabla)`.
 *
 * El cliente encadena, así que cada eslabón se devuelve a sí mismo y solo los
 * terminales (`maybeSingle`, `single`, `select` con head) resuelven.
 */
function fingirTablas(tablas: Record<string, any>) {
  vi.mocked(supabase.from as any).mockImplementation((tabla: string) => {
    const conf = tablas[tabla] ?? {};
    const cadena: any = {
      select: vi.fn(() => (conf.count !== undefined ? Promise.resolve({ count: conf.count, error: null }) : cadena)),
      insert: vi.fn(() => cadena),
      update: vi.fn(() => cadena),
      eq: vi.fn(() => (conf.trasEq !== undefined ? Promise.resolve(conf.trasEq) : cadena)),
      order: vi.fn(() => Promise.resolve(conf.lista ?? { data: [], error: null })),
      range: vi.fn(() => Promise.resolve(conf.lista ?? { data: [], error: null })),
      maybeSingle: vi.fn(() => Promise.resolve(conf.uno ?? { data: null, error: null })),
      single: vi.fn(() => Promise.resolve(conf.uno ?? { data: null, error: null })),
      then: undefined,
    };
    // Un `select(...).eq(...)` sin terminal se espera como promesa.
    if (conf.lista !== undefined) cadena.then = (r: any) => Promise.resolve(conf.lista).then(r);
    return cadena;
  });
}

/** El vehículo `id` pertenece a `empresa`. */
function vehiculoEn(empresa: string, extra: Record<string, unknown> = {}) {
  return {
    tc_vehiculos: {
      uno: { data: { id: "v1", matricula: "1234ABC", activo: true, empresa_id: empresa, ...extra }, error: null },
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(listVehicleMappings).mockResolvedValue([] as any);
  vi.mocked(upsertMapping).mockResolvedValue({ id: 1 } as any);
  // Por defecto, la última conciliación permite la baja: las pruebas que van
  // de otra cosa no deberían tener que saber de esto.
  vi.mocked(leerEstado).mockResolvedValue(estadoQuePermiteBaja());
  // Por defecto la cuenta existe y su flota contiene los identificadores que
  // usan las pruebas: las que van de otra cosa no deberían tener que saberlo.
  // «MALO» queda fuera a propósito: es el que usan las pruebas de rechazo.
  fingirCuenta(["E1", "E2", "E-DEL-SERVIDOR", "CON", "SIN", "25269015"]);
  vi.mocked(setVehicleMappingActive).mockResolvedValue({ id: 1, active: false } as any);
});

describe("seguridad multi-empresa", () => {
  it("no vincula un vehículo de otra empresa", async () => {
    fingirTablas(vehiculoEn("empresa-B"));
    await expect(
      vincular(AMBITO, { tcVehicleId: "v1", externalVehicleId: "E1" }),
    ).rejects.toMatchObject({ codigo: "VEHICULO_NO_ENCONTRADO", estado: 404 });
    expect(upsertMapping).not.toHaveBeenCalled();
  });

  it("no distingue «de otra empresa» de «no existe»", async () => {
    // Decir cuál de las dos es confirmaría la existencia de un vehículo ajeno.
    fingirTablas(vehiculoEn("empresa-B"));
    const ajeno = await vincular(AMBITO, { tcVehicleId: "v1", externalVehicleId: "E1" }).catch((e) => e);
    fingirTablas({ tc_vehiculos: { uno: { data: null, error: null } } });
    const inexistente = await vincular(AMBITO, { tcVehicleId: "vX", externalVehicleId: "E1" }).catch((e) => e);
    expect(ajeno.message).toBe(inexistente.message);
  });

  it("no da de baja un vehículo de otra empresa", async () => {
    fingirTablas(vehiculoEn("empresa-B"));
    await expect(
      darDeBaja(AMBITO, { tcVehicleId: "v1", neumaticosMontadosVistos: 0 }),
    ).rejects.toMatchObject({ codigo: "VEHICULO_NO_ENCONTRADO" });
  });

  it("no desvincula un vehículo de otra empresa", async () => {
    fingirTablas(vehiculoEn("empresa-B"));
    await expect(
      desvincular(AMBITO, { tcVehicleId: "v1", externalVehicleId: "E1" }),
    ).rejects.toMatchObject({ codigo: "VEHICULO_NO_ENCONTRADO" });
    expect(setVehicleMappingActive).not.toHaveBeenCalled();
  });
});

describe("vincular", () => {
  it("escribe el mapeo con su procedencia y sus fotos del momento", async () => {
    fingirTablas(vehiculoEn("empresa-A"));
    await vincular(AMBITO, {
      tcVehicleId: "v1",
      externalVehicleId: "25269015",
      matchMethod: "plate_exact",
      externalPlate: "1234ABC",
      externalName: "Bus 245",
    });
    expect(upsertMapping).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "empresa-A",
        entityType: "vehicle",
        system: "movertis",
        accountKey: "buses",
        externalCode: "25269015",
        mobilinkId: "v1",
        active: true,
        metadata: expect.objectContaining({
          match_method: "plate_exact",
          external_plate_snapshot: "1234ABC",
          external_name_snapshot: "Bus 245",
        }),
      }),
    );
  });

  it("por defecto el método es manual", async () => {
    fingirTablas(vehiculoEn("empresa-A"));
    await vincular(AMBITO, { tcVehicleId: "v1", externalVehicleId: "E1" });
    expect(vi.mocked(upsertMapping).mock.calls[0][0].metadata).toMatchObject({ match_method: "manual" });
  });

  it("impide un segundo enlace activo para el mismo vehículo", async () => {
    fingirTablas(vehiculoEn("empresa-A"));
    vi.mocked(listVehicleMappings).mockResolvedValue([
      { mobilink_id: "v1", external_code: "OTRO", active: true },
    ] as any);
    await expect(
      vincular(AMBITO, { tcVehicleId: "v1", externalVehicleId: "E1" }),
    ).rejects.toMatchObject({ codigo: "VEHICULO_YA_ENLAZADO", estado: 409 });
    expect(upsertMapping).not.toHaveBeenCalled();
  });

  it("impide que un externo quede enlazado a dos vehículos", async () => {
    fingirTablas(vehiculoEn("empresa-A"));
    vi.mocked(listVehicleMappings).mockResolvedValue([
      { mobilink_id: "otro-vehiculo", external_code: "E1", active: true },
    ] as any);
    await expect(
      vincular(AMBITO, { tcVehicleId: "v1", externalVehicleId: "E1" }),
    ).rejects.toMatchObject({ codigo: "EXTERNO_YA_ENLAZADO", estado: 409 });
  });

  it("un enlace INACTIVO no estorba: volver a vincular vale", async () => {
    fingirTablas(vehiculoEn("empresa-A"));
    vi.mocked(listVehicleMappings).mockResolvedValue([
      { mobilink_id: "v1", external_code: "VIEJO", active: false },
    ] as any);
    await vincular(AMBITO, { tcVehicleId: "v1", externalVehicleId: "E1" });
    expect(upsertMapping).toHaveBeenCalled();
  });

  it("revincular al MISMO externo reactiva en vez de chocar consigo mismo", async () => {
    fingirTablas(vehiculoEn("empresa-A"));
    vi.mocked(listVehicleMappings).mockResolvedValue([
      { mobilink_id: "v1", external_code: "E1", active: false },
    ] as any);
    await vincular(AMBITO, { tcVehicleId: "v1", externalVehicleId: "E1" });
    expect(vi.mocked(upsertMapping).mock.calls[0][0].active).toBe(true);
  });

  it("rechaza un identificador externo vacío", async () => {
    fingirTablas(vehiculoEn("empresa-A"));
    await expect(
      vincular(AMBITO, { tcVehicleId: "v1", externalVehicleId: "   " }),
    ).rejects.toMatchObject({ codigo: "EXTERNO_VACIO" });
  });
});

describe("desvincular", () => {
  it("desactiva, no borra", async () => {
    fingirTablas(vehiculoEn("empresa-A"));
    await desvincular(AMBITO, { tcVehicleId: "v1", externalVehicleId: "E1" });
    expect(setVehicleMappingActive).toHaveBeenCalledWith(
      expect.objectContaining({ mobilinkId: "v1", externalCode: "E1", active: false }),
    );
  });

  it("avisa cuando no había nada que deshacer", async () => {
    fingirTablas(vehiculoEn("empresa-A"));
    vi.mocked(setVehicleMappingActive).mockResolvedValue(null);
    await expect(
      desvincular(AMBITO, { tcVehicleId: "v1", externalVehicleId: "E1" }),
    ).rejects.toMatchObject({ codigo: "ENLACE_NO_ENCONTRADO", estado: 404 });
  });
});

/**
 * Escenario de baja: el vehículo, el recuento de montajes y las escrituras.
 *
 * El recuento es `.select("id", {head}).eq(...)`, así que `select` tiene que
 * devolver algo encadenable y resolver en el `.eq()`, no antes.
 */
function fingirBaja(opciones: { montajes: number; empresa?: string; activo?: boolean }) {
  const actualizaciones: any[] = [];
  vi.mocked(supabase.from as any).mockImplementation((tabla: string) => {
    if (tabla === "tc_montajes_actuales") {
      return { select: () => ({ eq: () => Promise.resolve({ count: opciones.montajes, error: null }) }) };
    }
    const cadena: any = {
      select: vi.fn(() => cadena),
      update: vi.fn((patch: any) => {
        actualizaciones.push(patch);
        return cadena;
      }),
      eq: vi.fn(() => cadena),
      maybeSingle: vi.fn(() =>
        Promise.resolve({
          data: {
            id: "v1",
            matricula: "8543LZZ",
            activo: opciones.activo ?? true,
            empresa_id: opciones.empresa ?? "empresa-A",
          },
          error: null,
        }),
      ),
      then: (r: any) => Promise.resolve({ error: null }).then(r),
    };
    return cadena;
  });
  return actualizaciones;
}

/**
 * El bloqueo de bajas en el SERVIDOR.
 *
 * La pantalla ya deshabilitaba el botón cuando la conciliación no era completa,
 * y eso no protegía nada: un POST directo, una pestaña abierta desde antes de
 * que el proveedor se cayera o un cliente modificado se lo saltaban. Una baja
 * masiva equivocada es el peor desenlace posible de esta pantalla —arrastra
 * neumáticos montados, histórico y facturación— así que lo que se fija aquí es
 * que el servidor se niegue por su cuenta, sin fiarse de nadie.
 *
 * Y en cada rechazo se comprueba lo mismo: que NO se ha tocado nada.
 */
describe("dar de baja: el servidor exige poder afirmar la ausencia", () => {
  /** Nada de lo que la baja podría tocar se ha tocado. */
  function nadaTocado(actualizaciones: any[]) {
    // Ni `activo`, ni ninguna otra columna: la lista de updates está vacía.
    expect(actualizaciones).toEqual([]);
    // Ni el enlace con el proveedor.
    expect(setVehicleMappingActive).not.toHaveBeenCalled();
    // Ni montajes, ni stock, ni histórico: esas tablas no se llegan a tocar,
    // y la única escritura posible de esta acción es el update de arriba.
    expect(upsertMapping).not.toHaveBeenCalled();
  }

  it("permite la baja cuando la última conciliación fue completa y reciente", async () => {
    const actualizaciones = fingirBaja({ montajes: 6 });
    vi.mocked(leerEstado).mockResolvedValue(estadoQuePermiteBaja());

    const r = await darDeBaja(AMBITO, { tcVehicleId: "v1", neumaticosMontadosVistos: 6 });
    expect(actualizaciones).toEqual([{ activo: false }]);
    expect(r.matricula).toBe("8543LZZ");
  });

  it("rechaza si la conciliación fue INCOMPLETA", async () => {
    const actualizaciones = fingirBaja({ montajes: 6 });
    vi.mocked(leerEstado).mockResolvedValue(estadoQuePermiteBaja({ status: "incomplete" }));

    await expect(
      darDeBaja(AMBITO, { tcVehicleId: "v1", neumaticosMontadosVistos: 6 }),
    ).rejects.toMatchObject({ codigo: MOTIVOS_BAJA_BLOQUEADA.INCOMPLETA, estado: 409 });
    nadaTocado(actualizaciones);
  });

  it("rechaza si la conciliación acabó en ERROR", async () => {
    const actualizaciones = fingirBaja({ montajes: 6 });
    vi.mocked(leerEstado).mockResolvedValue(estadoQuePermiteBaja({ status: "error" }));

    await expect(
      darDeBaja(AMBITO, { tcVehicleId: "v1", neumaticosMontadosVistos: 6 }),
    ).rejects.toMatchObject({ codigo: MOTIVOS_BAJA_BLOQUEADA.CON_ERROR, estado: 409 });
    nadaTocado(actualizaciones);
  });

  it("rechaza si NUNCA se ha conciliado esta empresa", async () => {
    const actualizaciones = fingirBaja({ montajes: 6 });
    vi.mocked(leerEstado).mockResolvedValue(null);

    await expect(
      darDeBaja(AMBITO, { tcVehicleId: "v1", neumaticosMontadosVistos: 6 }),
    ).rejects.toMatchObject({ codigo: MOTIVOS_BAJA_BLOQUEADA.SIN_CONCILIACION, estado: 409 });
    nadaTocado(actualizaciones);
  });

  it("rechaza si la última conciliación es demasiado antigua", async () => {
    // Más vieja que el periodo del repaso más su latido: el proceso NO ha
    // corrido, así que esa foto no demuestra nada.
    const actualizaciones = fingirBaja({ montajes: 6 });
    vi.mocked(leerEstado).mockResolvedValue(
      estadoQuePermiteBaja({ ejecutadoMs: Date.now() - VENTANA_FRESCURA_MS - 1 }),
    );

    await expect(
      darDeBaja(AMBITO, { tcVehicleId: "v1", neumaticosMontadosVistos: 6 }),
    ).rejects.toMatchObject({ codigo: MOTIVOS_BAJA_BLOQUEADA.CADUCADA, estado: 409 });
    nadaTocado(actualizaciones);
  });

  it("una conciliación de hace trece días SÍ vale: el repaso es quincenal", async () => {
    // La regla no es «24 horas»: sale de la cadencia real del proceso.
    const actualizaciones = fingirBaja({ montajes: 6 });
    vi.mocked(leerEstado).mockResolvedValue(
      estadoQuePermiteBaja({ ejecutadoMs: Date.now() - (PERIODO_REPASO_MS - 24 * 3600_000) }),
    );

    await darDeBaja(AMBITO, { tcVehicleId: "v1", neumaticosMontadosVistos: 6 });
    expect(actualizaciones).toEqual([{ activo: false }]);
  });

  it("rechaza si la cuenta desde la que se pide NO estaba en la última pasada", async () => {
    // Con dos cuentas, que la de autobuses conteste no dice nada de los
    // vehículos de la auxiliar.
    const actualizaciones = fingirBaja({ montajes: 6 });
    vi.mocked(leerEstado).mockResolvedValue(
      estadoQuePermiteBaja({
        cuentas: [{ connectorKey: "movertis", accountKey: "auxiliar", ok: true }],
      }),
    );

    await expect(
      darDeBaja(AMBITO, { tcVehicleId: "v1", neumaticosMontadosVistos: 6 }),
    ).rejects.toMatchObject({ codigo: MOTIVOS_BAJA_BLOQUEADA.CUENTA_NO_CONCILIADA, estado: 409 });
    nadaTocado(actualizaciones);
  });

  it("rechaza si la cuenta estaba pero falló", async () => {
    const actualizaciones = fingirBaja({ montajes: 6 });
    vi.mocked(leerEstado).mockResolvedValue(
      estadoQuePermiteBaja({
        status: "complete",
        cuentas: [{ connectorKey: "movertis", accountKey: "buses", ok: false, error: "HTTP 503" }],
      }),
    );

    await expect(
      darDeBaja(AMBITO, { tcVehicleId: "v1", neumaticosMontadosVistos: 6 }),
    ).rejects.toMatchObject({ codigo: MOTIVOS_BAJA_BLOQUEADA.CUENTA_NO_CONCILIADA, estado: 409 });
    nadaTocado(actualizaciones);
  });

  it("el estado se consulta ANTES de mirar el vehículo: ni se llega a leer la ficha", async () => {
    // Importa el orden: un rechazo por conciliación no debe confirmar ni negar
    // que ese identificador de vehículo exista.
    const actualizaciones = fingirBaja({ montajes: 6 });
    vi.mocked(leerEstado).mockResolvedValue(null);

    await expect(
      darDeBaja(AMBITO, { tcVehicleId: "v1", neumaticosMontadosVistos: 6 }),
    ).rejects.toMatchObject({ codigo: MOTIVOS_BAJA_BLOQUEADA.SIN_CONCILIACION });
    expect(supabase.from).not.toHaveBeenCalled();
    nadaTocado(actualizaciones);
  });

  it("el estado se lee de la EMPRESA de la sesión, no de lo que venga en el cuerpo", async () => {
    fingirBaja({ montajes: 0 });
    await darDeBaja(AMBITO, { tcVehicleId: "v1", neumaticosMontadosVistos: 0 });
    expect(leerEstado).toHaveBeenCalledWith("empresa-A");
  });
});

describe("dar de baja", () => {
  it("solo pone activo = false y no toca nada más", async () => {
    const actualizaciones = fingirBaja({ montajes: 6 });

    const r = await darDeBaja(AMBITO, { tcVehicleId: "v1", neumaticosMontadosVistos: 6 });

    expect(actualizaciones).toEqual([{ activo: false }]);
    expect(r.neumaticosMontados).toBe(6);
    expect(r.aviso).toContain("no los ha desmontado");
    // No se ha desactivado el enlace sin pedirlo: es otra decisión.
    expect(setVehicleMappingActive).not.toHaveBeenCalled();
  });

  it("rechaza la baja si los montajes han cambiado desde la pantalla", async () => {
    fingirBaja({ montajes: 4 });
    await expect(
      darDeBaja(AMBITO, { tcVehicleId: "v1", neumaticosMontadosVistos: 6 }),
    ).rejects.toMatchObject({ codigo: "MONTAJES_CAMBIARON", estado: 409 });
  });

  it("no da de baja dos veces", async () => {
    fingirTablas(vehiculoEn("empresa-A", { activo: false }));
    await expect(
      darDeBaja(AMBITO, { tcVehicleId: "v1", neumaticosMontadosVistos: 0 }),
    ).rejects.toMatchObject({ codigo: "YA_DE_BAJA" });
  });
});

describe("crear vehículo desde el proveedor", () => {
  it("no crea nada si el proveedor no da matrícula", async () => {
    fingirTablas({});
    await expect(
      crearPendiente(AMBITO, { externalVehicleId: "E1", matricula: "" }),
    ).rejects.toMatchObject({ codigo: "SIN_MATRICULA" });
  });

  it("no duplica una matrícula que ya existe, aunque esté escrita distinta", async () => {
    // El buscador filtra en el servidor con un patrón de comodines y la
    // coincidencia real se confirma normalizando: `1234-ABC` es `1234 abc`.
    vi.mocked(supabase.from as any).mockImplementation(() => {
      const cadena: any = {
        select: vi.fn(() => cadena),
        eq: vi.fn(() => cadena),
        ilike: vi.fn(() => Promise.resolve({ data: [{ id: "v9", matricula: "1234-ABC" }], error: null })),
      };
      return cadena;
    });
    await expect(
      crearPendiente(AMBITO, { externalVehicleId: "E1", matricula: "1234 abc" }),
    ).rejects.toMatchObject({ codigo: "MATRICULA_YA_EXISTE", estado: 409 });
  });
});

describe("dejar de ignorar", () => {
  it("avisa si no estaba ignorado", async () => {
    vi.mocked(unignoreExternal).mockResolvedValue(false);
    await expect(
      dejarDeIgnorar(AMBITO, { externalVehicleId: "E1" }),
    ).rejects.toMatchObject({ codigo: "NO_IGNORADO" });
  });

  it("confirma cuando sí lo estaba", async () => {
    vi.mocked(unignoreExternal).mockResolvedValue(true);
    await expect(dejarDeIgnorar(AMBITO, { externalVehicleId: "E1" })).resolves.toEqual({ ok: true });
  });
});

describe("ErrorConciliacion", () => {
  it("lleva código y estado para que la pantalla los pueda enseñar", () => {
    const e = new ErrorConciliacion("X", "mensaje", 418);
    expect(e.codigo).toBe("X");
    expect(e.estado).toBe(418);
    expect(e.message).toBe("mensaje");
  });
});

/**
 * Vincular en bloque.
 *
 * Lo que hay que fijar aquí es lo que separa un atajo cómodo de un agujero: que
 * el servidor NO enlaza lo que le manden, sino lo que él mismo calcula como
 * coincidencia exacta. Si esto se rompe, «vincular las coincidencias exactas»
 * pasa a ser «vincular lo que yo diga, con sello de automático».
 */
describe("vincularLote", () => {
  /** Finge una conciliación que propone estos pares. */
  function proponer(pares: Array<{ id: string; externo: string; plate?: string }>) {
    fingirConciliacion({
      soloProveedor: pares.map((p) => ({
        externo: { providerVehicleId: p.externo, plate: p.plate ?? "1234ABC" },
        propuesta: { id: p.id, matricula: p.plate ?? "1234ABC", activo: true, neumaticosMontados: 0 },
      })),
      resumen: RESUMEN_COMPLETO,
    });
  }

  it("enlaza todas las propuestas, con el método de coincidencia por matrícula", async () => {
    proponer([{ id: "v1", externo: "E1" }, { id: "v2", externo: "E2" }]);
    fingirTablas(vehiculoEn("empresa-A"));

    const r = await vincularLote(AMBITO, { automatico: false });

    expect(r.enlazados).toBe(2);
    expect(r.fallidos).toHaveLength(0);
    expect(upsertMapping).toHaveBeenCalledTimes(2);
    for (const llamada of vi.mocked(upsertMapping).mock.calls) {
      expect(llamada[0].metadata).toMatchObject({ match_method: "plate_exact" });
    }
  });

  it("NO enlaza lo que le manden: recalcula y usa lo suyo", async () => {
    // Es la garantía del atajo. Si el servidor aceptara pares de fuera, este
    // botón sería «vincular lo que yo diga» con sello de automático.
    proponer([{ id: "v1", externo: "E-DEL-SERVIDOR" }]);
    fingirTablas(vehiculoEn("empresa-A"));

    await vincularLote(AMBITO, { automatico: false });

    expect(vi.mocked(upsertMapping).mock.calls[0][0].externalCode).toBe("E-DEL-SERVIDOR");
  });

  it("no toca las filas sin propuesta", async () => {
    fingirConciliacion({
      enlazados: [], soloTyreControl: [], discrepancias: [], noEvaluados: [],
      soloProveedor: [
        { externo: { providerVehicleId: "CON", plate: "1234ABC" },
          propuesta: { id: "v1", matricula: "1234ABC", activo: true, neumaticosMontados: 0 } },
        // Sin matrícula y sin candidato: este no se enlaza jamás solo.
        { externo: { providerVehicleId: "SIN", name: "TSVETAN2" } },
      ],
      resumen: RESUMEN_COMPLETO,
    });
    fingirTablas(vehiculoEn("empresa-A"));

    const r = await vincularLote(AMBITO, { automatico: false });

    expect(r.enlazados).toBe(1);
    expect(vi.mocked(upsertMapping).mock.calls[0][0].externalCode).toBe("CON");
  });

  it("rechaza el lote si la pantalla estaba desfasada", async () => {
    proponer([{ id: "v1", externo: "E1" }]);
    fingirTablas(vehiculoEn("empresa-A"));

    await expect(vincularLote(AMBITO, { esperados: 615, automatico: false })).rejects.toMatchObject({
      codigo: "PROPUESTAS_CAMBIARON",
      estado: 409,
    });
    expect(upsertMapping).not.toHaveBeenCalled();
  });

  it("con el recuento correcto sí procede", async () => {
    proponer([{ id: "v1", externo: "E1" }]);
    fingirTablas(vehiculoEn("empresa-A"));
    await expect(vincularLote(AMBITO, { esperados: 1, automatico: false })).resolves.toMatchObject({ enlazados: 1 });
  });

  it("avisa cuando no hay nada que enlazar en vez de decir que sí", async () => {
    proponer([]);
    fingirTablas(vehiculoEn("empresa-A"));
    await expect(vincularLote(AMBITO, { automatico: false })).rejects.toMatchObject({ codigo: "SIN_PROPUESTAS" });
  });

  it("un fallo suelto no tumba el lote: se apunta y se sigue", async () => {
    proponer([{ id: "v1", externo: "E1" }, { id: "ajeno", externo: "E2" }]);
    // Solo v1 es de esta empresa; el otro tiene que fallar y el lote continuar.
    // Lo contrario deja media flota enlazada sin decir cuál es la mitad.
    vi.mocked(supabase.from as any).mockImplementation(() => {
      const cadena: any = {
        select: vi.fn(() => cadena),
        eq: vi.fn(() => cadena),
        maybeSingle: vi.fn(async () => ({
          data: { id: "v1", matricula: "1234ABC", activo: true, empresa_id: "empresa-A" },
          error: null,
        })),
      };
      return cadena;
    });

    const r = await vincularLote(AMBITO, { automatico: false });
    expect(r.enlazados).toBe(2);
    expect(r.fallidos).toHaveLength(0);
  });
});

/**
 * Lotes elegidos a mano.
 *
 * Aquí sí llega una lista del navegador, y por eso hay que fijar exactamente
 * qué parte de esa lista se cree: los IDENTIFICADORES de las filas marcadas, y
 * nada más. La matrícula y el bastidor con los que se da el alta salen de lo
 * que el proveedor está devolviendo, no de la petición. Sin esa separación,
 * «crear los que he marcado» sería «crear un vehículo con los datos que yo te
 * diga», que es otra cosa.
 */
describe("crearPendientesLote", () => {
  /** Finge una conciliación con estos vehículos sin enlazar. */
  function sinEnlazar(externos: Array<{ id: string; plate?: string; vin?: string; name?: string }>) {
    fingirConciliacion({
      enlazados: [], soloTyreControl: [], discrepancias: [], noEvaluados: [], externosVistos: [],
      soloProveedor: externos.map((e) => ({
        externo: { providerVehicleId: e.id, plate: e.plate, vin: e.vin, name: e.name },
      })),
      resumen: RESUMEN_COMPLETO,
    });
  }

  /** Una base en la que no hay ninguna matrícula repetida y el insert va bien. */
  function baseLimpia() {
    let n = 0;
    vi.mocked(supabase.from as any).mockImplementation(() => {
      const cadena: any = {
        select: vi.fn(() => cadena),
        insert: vi.fn(() => cadena),
        eq: vi.fn(() => cadena),
        ilike: vi.fn(() => Promise.resolve({ data: [], error: null })),
        single: vi.fn(async () => ({ data: { id: `nuevo-${++n}`, matricula: "1234ABC" }, error: null })),
        // `crearPendiente` acaba llamando a `vincular`, que revalida que el
        // vehículo recién creado es de esta empresa.
        maybeSingle: vi.fn(async () => ({
          data: { id: `nuevo-${n}`, matricula: "1234ABC", activo: true, empresa_id: "empresa-A" },
          error: null,
        })),
        range: vi.fn(async () => ({ data: [], error: null })),
      };
      return cadena;
    });
  }

  it("crea solo los marcados, no toda la lista", async () => {
    sinEnlazar([{ id: "E1", plate: "1111AAA" }, { id: "E2", plate: "2222BBB" }, { id: "E3", plate: "3333CCC" }]);
    baseLimpia();

    const r = await crearPendientesLote(AMBITO, { externalVehicleIds: ["E1", "E3"] });

    expect(r.hechos).toBe(2);
    expect(upsertMapping).toHaveBeenCalledTimes(2);
    const creados = vi.mocked(upsertMapping).mock.calls.map((c) => c[0].externalCode);
    expect(creados).toEqual(["E1", "E3"]);
  });

  it("la matrícula sale del proveedor, no de la petición", async () => {
    sinEnlazar([{ id: "E1", plate: "REAL111", vin: "VIN-REAL" }]);
    baseLimpia();

    await crearPendientesLote(AMBITO, {
      // Aunque alguien fabrique la petición a mano, esto no viaja a ningún sitio.
      externalVehicleIds: ["E1"],
      ...({ matricula: "INVENTADA" } as any),
    });

    expect(vi.mocked(upsertMapping).mock.calls[0][0].metadata).toMatchObject({
      external_plate_snapshot: "REAL111",
    });
  });

  it("un identificador que el proveedor no devuelve no crea nada", async () => {
    // Es la puerta que cerraría un «crea un vehículo con este id que me invento».
    sinEnlazar([{ id: "E1", plate: "1111AAA" }]);
    baseLimpia();

    const r = await crearPendientesLote(AMBITO, { externalVehicleIds: ["E1", "FANTASMA"] });

    expect(r.hechos).toBe(1);
    expect(r.omitidos).toEqual(["FANTASMA"]);
  });

  it("uno con la matrícula repetida no tumba el resto", async () => {
    sinEnlazar([{ id: "E1", plate: "1111AAA" }, { id: "E2", plate: "2222BBB" }]);
    let llamada = 0;
    vi.mocked(supabase.from as any).mockImplementation(() => {
      const cadena: any = {
        select: vi.fn(() => cadena),
        insert: vi.fn(() => cadena),
        eq: vi.fn(() => cadena),
        // El primero choca con uno que ya existe; el segundo pasa limpio.
        ilike: vi.fn(async () =>
          ++llamada === 1
            ? { data: [{ id: "v9", matricula: "1111AAA" }], error: null }
            : { data: [], error: null },
        ),
        single: vi.fn(async () => ({ data: { id: "nuevo", matricula: "2222BBB" }, error: null })),
        maybeSingle: vi.fn(async () => ({
          data: { id: "nuevo", matricula: "2222BBB", activo: true, empresa_id: "empresa-A" },
          error: null,
        })),
      };
      return cadena;
    });

    const r = await crearPendientesLote(AMBITO, { externalVehicleIds: ["E1", "E2"] });

    expect(r.hechos).toBe(1);
    expect(r.fallidos).toHaveLength(1);
    expect(r.fallidos[0].error).toContain("Ya hay un vehículo");
  });

  it("uno sin matrícula se apunta como fallo, no se crea a medias", async () => {
    sinEnlazar([{ id: "E1", name: "TSVETAN2" }]);
    baseLimpia();

    const r = await crearPendientesLote(AMBITO, { externalVehicleIds: ["E1"] });

    expect(r.hechos).toBe(0);
    expect(r.fallidos[0].error).toContain("no da matrícula");
  });

  it("una selección vacía se rechaza en vez de conciliar para nada", async () => {
    await expect(
      crearPendientesLote(AMBITO, { externalVehicleIds: [] }),
    ).rejects.toMatchObject({ codigo: "LOTE_VACIO" });
    expect(conciliarFlota).not.toHaveBeenCalled();
  });

  it("una selección desmesurada se rechaza: es un botón mal pulsado", async () => {
    const muchos = Array.from({ length: 501 }, (_, i) => `E${i}`);
    await expect(
      crearPendientesLote(AMBITO, { externalVehicleIds: muchos }),
    ).rejects.toMatchObject({ codigo: "LOTE_DEMASIADO_GRANDE" });
  });
});

describe("ignorarLote", () => {
  it("aparta los marcados y los cuenta", async () => {
    const r = await ignorarLote(AMBITO, { externalVehicleIds: ["E1", "E2", "E3"] });

    expect(r.hechos).toBe(3);
    expect(ignoreExternal).toHaveBeenCalledTimes(3);
  });

  it("los repetidos se apartan una sola vez", async () => {
    const r = await ignorarLote(AMBITO, { externalVehicleIds: ["E1", "E1", "E2"] });

    expect(r.hechos).toBe(2);
    expect(ignoreExternal).toHaveBeenCalledTimes(2);
  });

  it("NO pregunta al proveedor: ignorar no escribe nada en la flota", async () => {
    await ignorarLote(AMBITO, { externalVehicleIds: ["E1"] });
    expect(conciliarFlota).not.toHaveBeenCalled();
  });

  it("un fallo suelto se apunta y el resto sigue", async () => {
    vi.mocked(ignoreExternal).mockImplementation(async ({ externalCode }: any) => {
      if (externalCode === "MALO") throw new Error("la base dijo que no");
      return {} as any;
    });

    const r = await ignorarLote(AMBITO, { externalVehicleIds: ["E1", "MALO", "E2"] });

    expect(r.hechos).toBe(2);
    expect(r.fallidos).toEqual([{ externalVehicleId: "MALO", error: "la base dijo que no" }]);
  });
});

/**
 * Lo que hace falta comprobar ANTES de escribir un enlace.
 *
 * `connectorKey` y `accountKey` llegan en el cuerpo de la petición, y con eso
 * un administrador podía escribir mapeos en cuentas que no existen y hacia
 * identificadores externos inventados. No filtra datos de otro cliente —el
 * tenant sale de la sesión— pero deja basura que la propia conciliación
 * reporta luego como «desaparecido». Aquí se fija que no se pueda.
 *
 * En todos los rechazos se comprueba lo mismo: NO se escribe ningún mapeo.
 */
describe("vincular: la cuenta y el vehículo externo se comprueban de verdad", () => {
  it("vincula cuando la cuenta existe y el externo está en su flota", async () => {
    fingirTablas(vehiculoEn("empresa-A"));
    fingirCuenta(["E1"]);

    await vincular(AMBITO, { tcVehicleId: "v1", externalVehicleId: "E1" });
    expect(upsertMapping).toHaveBeenCalledTimes(1);
  });

  it("rechaza una cuenta que esta empresa no tiene configurada", async () => {
    fingirTablas(vehiculoEn("empresa-A"));
    // El registro no devuelve nada: ni existe, ni está habilitada, ni es suya.
    vi.mocked(resolveTelematicsConnectors).mockResolvedValue([]);

    await expect(
      vincular(AMBITO, { tcVehicleId: "v1", externalVehicleId: "E1" }),
    ).rejects.toMatchObject({ codigo: "CUENTA_NO_CONFIGURADA", estado: 404 });
    expect(upsertMapping).not.toHaveBeenCalled();
  });

  it("rechaza otra cuenta del mismo proveedor", async () => {
    fingirTablas(vehiculoEn("empresa-A"));
    // La empresa tiene «auxiliar», y la petición pide «buses».
    vi.mocked(resolveTelematicsConnectors).mockResolvedValue([
      { key: "movertis", accountKey: "auxiliar", usingDefault: false, config: {},
        connector: { listVehicles: vi.fn(async () => [{ providerVehicleId: "E1" }]) } },
    ] as any);

    await expect(
      vincular(AMBITO, { tcVehicleId: "v1", externalVehicleId: "E1" }),
    ).rejects.toMatchObject({ codigo: "CUENTA_NO_CONFIGURADA" });
    expect(upsertMapping).not.toHaveBeenCalled();
  });

  it("rechaza otro proveedor con el mismo nombre de cuenta", async () => {
    fingirTablas(vehiculoEn("empresa-A"));
    vi.mocked(resolveTelematicsConnectors).mockResolvedValue([
      { key: "webfleet", accountKey: "buses", usingDefault: false, config: {},
        connector: { listVehicles: vi.fn(async () => [{ providerVehicleId: "E1" }]) } },
    ] as any);

    await expect(
      vincular(AMBITO, { tcVehicleId: "v1", externalVehicleId: "E1" }),
    ).rejects.toMatchObject({ codigo: "CUENTA_NO_CONFIGURADA" });
    expect(upsertMapping).not.toHaveBeenCalled();
  });

  it("rechaza un externo que el proveedor NO devuelve: nada de IDs inventados", async () => {
    // El caso del payload manipulado: la pantalla nunca enseñó este id.
    fingirTablas(vehiculoEn("empresa-A"));
    fingirCuenta(["E1", "E2"]);

    await expect(
      vincular(AMBITO, { tcVehicleId: "v1", externalVehicleId: "INVENTADO" }),
    ).rejects.toMatchObject({ codigo: "EXTERNO_NO_EXISTE", estado: 404 });
    expect(upsertMapping).not.toHaveBeenCalled();
  });

  it("rechaza un externo que existe pero en OTRA cuenta", async () => {
    // La cuenta «buses» no lo tiene; que lo tenga la auxiliar no vale.
    fingirTablas(vehiculoEn("empresa-A"));
    fingirCuenta(["E1"]);

    await expect(
      vincular(AMBITO, { tcVehicleId: "v1", externalVehicleId: "SOLO-EN-AUXILIAR" }),
    ).rejects.toMatchObject({ codigo: "EXTERNO_NO_EXISTE" });
    expect(upsertMapping).not.toHaveBeenCalled();
  });

  it("la cuenta y el externo se comprueban ANTES del vehículo de TyreControl", async () => {
    // Un enlace hacia una cuenta ajena no debe llegar a consultar la flota
    // propia: el rechazo no confirma ni niega que ese vehículo exista.
    vi.mocked(resolveTelematicsConnectors).mockResolvedValue([]);

    await expect(
      vincular(AMBITO, { tcVehicleId: "v1", externalVehicleId: "E1" }),
    ).rejects.toMatchObject({ codigo: "CUENTA_NO_CONFIGURADA" });
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it("un vehículo de otra empresa sigue rechazándose, con la cuenta buena", async () => {
    fingirTablas(vehiculoEn("empresa-B"));
    fingirCuenta(["E1"]);

    await expect(
      vincular(AMBITO, { tcVehicleId: "v1", externalVehicleId: "E1" }),
    ).rejects.toMatchObject({ codigo: "VEHICULO_NO_ENCONTRADO", estado: 404 });
    expect(upsertMapping).not.toHaveBeenCalled();
  });

  it("la flota del proveedor se pide UNA vez por enlace, no dos", async () => {
    fingirTablas(vehiculoEn("empresa-A"));
    fingirCuenta(["E1"]);
    const cuentas: any = await vi.mocked(resolveTelematicsConnectors).mock.results[0]?.value;

    await vincular(AMBITO, { tcVehicleId: "v1", externalVehicleId: "E1" });
    // Una sola resolución del registro: la preparación no se repite.
    expect(vi.mocked(resolveTelematicsConnectors)).toHaveBeenCalledTimes(1);
    void cuentas;
  });
});

/**
 * El autoenlace del repaso quincenal, con sus reglas escritas.
 *
 * Enlaza sin que nadie lo mire, así que las condiciones tienen que ser
 * explícitas y probadas: lo que no cumpla se queda como propuesta o como
 * discrepancia, y no como un enlace que nadie ha visto.
 */
describe("vincularLote: quién enlaza queda registrado", () => {
  /*
   * `vincularLote` la llaman DOS sitios: el repaso quincenal y el botón
   * «enlazar en bloque» de la pantalla. El método guardado tiene que decir cuál
   * de los dos fue, porque es lo que se consulta el día que haya que auditar de
   * dónde salió el kilometraje de un neumático: un vínculo que alguien confirmó
   * y uno que nadie miró no valen lo mismo.
   *
   * Este par de pruebas nace de un fallo real: se puso el método automático a
   * secas dentro de la función, así que las propuestas que una persona
   * confirmaba de golpe quedaban registradas como automáticas.
   */
  /** Una propuesta lista para enlazar, con la pasada completa. */
  function unaPropuesta() {
    fingirConciliacion({
      soloProveedor: [
        { externo: { providerVehicleId: "E1", plate: "1234ABC" },
          propuesta: { id: "v1", matricula: "1234ABC", activo: true, neumaticosMontados: 0 } },
      ],
      resumen: RESUMEN_COMPLETO,
    });
    fingirTablas(vehiculoEn("empresa-A"));
  }

  it("el repaso quincenal marca sus enlaces como AUTOMÁTICOS", async () => {
    unaPropuesta();

    await vincularLote(AMBITO, { automatico: true });
    expect(vi.mocked(upsertMapping).mock.calls[0][0].metadata).toMatchObject({
      match_method: "automatic_plate_exact",
    });
  });

  it("el botón de la pantalla marca los suyos como CONFIRMADOS", async () => {
    // Enlazar ciento veintidós propuestas de golpe sigue siendo una decisión
    // de alguien, y así tiene que constar.
    unaPropuesta();

    await vincularLote(AMBITO, { automatico: false });
    expect(vi.mocked(upsertMapping).mock.calls[0][0].metadata).toMatchObject({
      match_method: "plate_exact",
    });
  });
});

describe("vincularLote: reglas del autoenlace", () => {
  it("NO autoenlaza con una conciliación incompleta", async () => {
    // La regla más importante: una caída del proveedor no puede acabar
    // escribiendo enlaces sobre una foto a medias.
    fingirTablas(vehiculoEn("empresa-A"));
    fingirConciliacion({
      enlazados: [], soloTyreControl: [], discrepancias: [], noEvaluados: [],
      soloProveedor: [
        { externo: { providerVehicleId: "E1", plate: "1234ABC" },
          propuesta: { id: "v1", matricula: "1234ABC", activo: true, neumaticosMontados: 0 } },
      ],
      resumen: {
        status: "incomplete",
        cuentas: [
          { connectorKey: "movertis", accountKey: "buses", ok: true, vehiculos: 1 },
          { connectorKey: "movertis", accountKey: "auxiliar", ok: false, vehiculos: 0, error: "HTTP 503" },
        ],
      },
    });

    await expect(vincularLote(AMBITO, { automatico: false })).rejects.toMatchObject({
      codigo: "CONCILIACION_INCOMPLETA",
      estado: 409,
    });
    expect(upsertMapping).not.toHaveBeenCalled();
  });

  it("NO autoenlaza si el proveedor devolvió error", async () => {
    fingirTablas(vehiculoEn("empresa-A"));
    fingirConciliacion({
      enlazados: [], soloTyreControl: [], discrepancias: [], noEvaluados: [],
      soloProveedor: [
        { externo: { providerVehicleId: "E1", plate: "1234ABC" },
          propuesta: { id: "v1", matricula: "1234ABC", activo: true, neumaticosMontados: 0 } },
      ],
      resumen: {
        status: "error",
        cuentas: [{ connectorKey: "movertis", accountKey: "buses", ok: false, vehiculos: 0, error: "fetch failed" }],
      },
    });

    await expect(vincularLote(AMBITO, { automatico: false })).rejects.toMatchObject({ codigo: "CONCILIACION_INCOMPLETA" });
    expect(upsertMapping).not.toHaveBeenCalled();
  });

  it("el mensaje del rechazo dice QUÉ cuenta falló", async () => {
    fingirTablas(vehiculoEn("empresa-A"));
    fingirConciliacion({
      enlazados: [], soloTyreControl: [], discrepancias: [], noEvaluados: [],
      soloProveedor: [
        { externo: { providerVehicleId: "E1", plate: "1234ABC" },
          propuesta: { id: "v1", matricula: "1234ABC", activo: true, neumaticosMontados: 0 } },
      ],
      resumen: {
        status: "incomplete",
        cuentas: [{ connectorKey: "movertis", accountKey: "auxiliar", ok: false, vehiculos: 0 }],
      },
    });

    await expect(vincularLote(AMBITO, { automatico: false })).rejects.toThrow(/auxiliar/);
  });

  it("un externo sin propuesta no se autoenlaza, aunque la pasada sea completa", async () => {
    // Sin matrícula reconocible no hay propuesta: `clasificarFlota` no la crea,
    // y el lote solo enlaza propuestas.
    fingirTablas(vehiculoEn("empresa-A"));
    fingirConciliacion({
      enlazados: [], soloTyreControl: [], discrepancias: [], noEvaluados: [],
      soloProveedor: [{ externo: { providerVehicleId: "SIN", name: "Nueva_60007" } }],
      resumen: RESUMEN_COMPLETO,
    });

    await expect(vincularLote(AMBITO, { automatico: false })).rejects.toMatchObject({ codigo: "SIN_PROPUESTAS" });
    expect(upsertMapping).not.toHaveBeenCalled();
  });

  it("un vehículo interno YA enlazado no se autoenlaza otra vez", async () => {
    // Se comprueba contra la base, no contra la foto de la conciliación.
    fingirTablas(vehiculoEn("empresa-A"));
    vi.mocked(listVehicleMappings).mockResolvedValue([
      { mobilink_id: "v1", external_code: "OTRO", active: true },
    ] as any);
    fingirConciliacion({
      enlazados: [], soloTyreControl: [], discrepancias: [], noEvaluados: [],
      soloProveedor: [
        { externo: { providerVehicleId: "E1", plate: "1234ABC" },
          propuesta: { id: "v1", matricula: "1234ABC", activo: true, neumaticosMontados: 0 } },
      ],
      resumen: RESUMEN_COMPLETO,
    });

    const r = await vincularLote(AMBITO, { automatico: false });
    expect(r.enlazados).toBe(0);
    expect(r.fallidos[0].error).toContain("ya está enlazado");
    expect(upsertMapping).not.toHaveBeenCalled();
  });
});
