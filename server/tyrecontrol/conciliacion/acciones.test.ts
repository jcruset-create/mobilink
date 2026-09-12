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
// El servicio de conciliación se finge entero: aquí no se prueba QUÉ propone
// —eso está en reconciliation.test.ts— sino qué hace el lote con lo propuesto.
vi.mock("../../integration-hub/application/services/VehicleReconciliationService.ts", () => ({
  conciliarFlota: vi.fn(),
}));

const { supabase } = await import("../../supabase.ts");
const { upsertMapping, listVehicleMappings, setVehicleMappingActive, unignoreExternal, ignoreExternal } =
  await import("../../integration-hub/infrastructure/repositories.ts");
const { conciliarFlota } = await import(
  "../../integration-hub/application/services/VehicleReconciliationService.ts"
);
const {
  vincular, desvincular, darDeBaja, crearPendiente, dejarDeIgnorar, vincularLote, ErrorConciliacion,
  crearPendientesLote, ignorarLote,
} = await import("./acciones.ts");

const AMBITO = { empresaId: "empresa-A", connectorKey: "movertis", accountKey: "buses" };

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
    vi.mocked(conciliarFlota).mockResolvedValue({
      enlazados: [], soloTyreControl: [], discrepancias: [], noEvaluados: [],
      soloProveedor: pares.map((p) => ({
        externo: { providerVehicleId: p.externo, plate: p.plate ?? "1234ABC" },
        propuesta: { id: p.id, matricula: p.plate ?? "1234ABC", activo: true, neumaticosMontados: 0 },
      })),
      resumen: {},
    } as any);
  }

  it("enlaza todas las propuestas con el método de matrícula exacta", async () => {
    proponer([{ id: "v1", externo: "E1" }, { id: "v2", externo: "E2" }]);
    fingirTablas(vehiculoEn("empresa-A"));

    const r = await vincularLote(AMBITO);

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

    await vincularLote(AMBITO);

    expect(vi.mocked(upsertMapping).mock.calls[0][0].externalCode).toBe("E-DEL-SERVIDOR");
  });

  it("no toca las filas sin propuesta", async () => {
    vi.mocked(conciliarFlota).mockResolvedValue({
      enlazados: [], soloTyreControl: [], discrepancias: [], noEvaluados: [],
      soloProveedor: [
        { externo: { providerVehicleId: "CON", plate: "1234ABC" },
          propuesta: { id: "v1", matricula: "1234ABC", activo: true, neumaticosMontados: 0 } },
        // Sin matrícula y sin candidato: este no se enlaza jamás solo.
        { externo: { providerVehicleId: "SIN", name: "TSVETAN2" } },
      ],
      resumen: {},
    } as any);
    fingirTablas(vehiculoEn("empresa-A"));

    const r = await vincularLote(AMBITO);

    expect(r.enlazados).toBe(1);
    expect(vi.mocked(upsertMapping).mock.calls[0][0].externalCode).toBe("CON");
  });

  it("rechaza el lote si la pantalla estaba desfasada", async () => {
    proponer([{ id: "v1", externo: "E1" }]);
    fingirTablas(vehiculoEn("empresa-A"));

    await expect(vincularLote(AMBITO, { esperados: 615 })).rejects.toMatchObject({
      codigo: "PROPUESTAS_CAMBIARON",
      estado: 409,
    });
    expect(upsertMapping).not.toHaveBeenCalled();
  });

  it("con el recuento correcto sí procede", async () => {
    proponer([{ id: "v1", externo: "E1" }]);
    fingirTablas(vehiculoEn("empresa-A"));
    await expect(vincularLote(AMBITO, { esperados: 1 })).resolves.toMatchObject({ enlazados: 1 });
  });

  it("avisa cuando no hay nada que enlazar en vez de decir que sí", async () => {
    proponer([]);
    fingirTablas(vehiculoEn("empresa-A"));
    await expect(vincularLote(AMBITO)).rejects.toMatchObject({ codigo: "SIN_PROPUESTAS" });
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

    const r = await vincularLote(AMBITO);
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
    vi.mocked(conciliarFlota).mockResolvedValue({
      enlazados: [], soloTyreControl: [], discrepancias: [], noEvaluados: [], externosVistos: [],
      soloProveedor: externos.map((e) => ({
        externo: { providerVehicleId: e.id, plate: e.plate, vin: e.vin, name: e.name },
      })),
      resumen: {},
    } as any);
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
