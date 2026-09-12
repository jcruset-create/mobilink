/**
 * Pruebas de la clasificación de flotas.
 *
 * Se prueba la función pura, sin base ni proveedor, porque es donde viven las
 * decisiones que pueden hacer daño: enlazar el camión de otro cliente, proponer
 * una coincidencia que no lo es, o meter media flota en la lista de candidatos
 * a baja porque una API no contestó.
 *
 * El normalizador que se inyecta es el REAL de TyreControl, no uno de mentira:
 * si mañana cambia la forma de comparar matrículas, estas pruebas tienen que
 * enterarse.
 */

import { describe, expect, it } from "vitest";
import { normalizarMatricula } from "../../tyrecontrol/matricula.ts";
import type { ProviderVehicle } from "./telematics.ts";
import {
  clasificarFlota,
  MOTIVOS_DISCREPANCIA,
  resumir,
  type EnlaceVehiculo,
  type VehiculoInterno,
} from "./reconciliation.ts";

function interno(over: Partial<VehiculoInterno> & { id: string; matricula: string }): VehiculoInterno {
  return {
    numeroUnidad: null,
    bastidor: null,
    marca: null,
    modelo: null,
    activo: true,
    neumaticosMontados: 0,
    ...over,
  };
}

function externo(over: Partial<ProviderVehicle> & { providerVehicleId: string }): ProviderVehicle {
  return { ...over };
}

const clasificar = (
  externos: ProviderVehicle[],
  internos: VehiculoInterno[],
  enlaces: EnlaceVehiculo[] = [],
  ignorados?: Set<string>,
) => clasificarFlota({ externos, internos, enlaces, ignorados, normalizarMatricula });

describe("emparejamiento por matrícula", () => {
  it("propone el candidato cuando la matrícula coincide exactamente", () => {
    const r = clasificar(
      [externo({ providerVehicleId: "25269015", plate: "1234ABC" })],
      [interno({ id: "v1", matricula: "1234ABC" })],
    );
    expect(r.soloProveedor).toHaveLength(1);
    expect(r.soloProveedor[0].propuesta?.id).toBe("v1");
    // La propuesta NO cuenta como «solo en TyreControl»: es el mismo trabajo.
    expect(r.soloTyreControl).toHaveLength(0);
  });

  it.each([
    ["espacios", "1234 ABC"],
    ["guiones", "1234-ABC"],
    ["minúsculas", "1234abc"],
    ["todo junto y sucio", " 1234 - abc "],
  ])("empareja pese a los %s", (_caso, matriculaExterna) => {
    const r = clasificar(
      [externo({ providerVehicleId: "E1", plate: matriculaExterna })],
      [interno({ id: "v1", matricula: "1234ABC" })],
    );
    expect(r.soloProveedor[0]?.propuesta?.id).toBe("v1");
  });

  it("empareja cuando la sucia es la de TyreControl", () => {
    const r = clasificar(
      [externo({ providerVehicleId: "E1", plate: "1234ABC" })],
      [interno({ id: "v1", matricula: "1234-ABC" })],
    );
    expect(r.soloProveedor[0]?.propuesta?.id).toBe("v1");
  });

  it("no propone nada cuando el proveedor no da matrícula", () => {
    // El alias TSVETAN2 del contrato: adivinar por él es lo que no se hace.
    const r = clasificar(
      [externo({ providerVehicleId: "E1", name: "TSVETAN2" })],
      [interno({ id: "v1", matricula: "1234ABC" })],
    );
    expect(r.soloProveedor).toHaveLength(1);
    expect(r.soloProveedor[0].propuesta).toBeUndefined();
    // Y el vehículo interno sí queda como pendiente por el otro lado.
    expect(r.soloTyreControl.map((f) => f.interno.id)).toEqual(["v1"]);
  });

  it("con dos candidatos manda a discrepancias, nunca elige", () => {
    const r = clasificar(
      [externo({ providerVehicleId: "E1", plate: "1234ABC" })],
      [interno({ id: "v1", matricula: "1234ABC" }), interno({ id: "v2", matricula: "1234-abc" })],
    );
    expect(r.soloProveedor).toHaveLength(0);
    expect(r.discrepancias).toHaveLength(1);
    expect(r.discrepancias[0].motivo).toBe(MOTIVOS_DISCREPANCIA.CANDIDATOS_AMBIGUOS);
    expect(r.discrepancias[0].candidatos?.map((c) => c.id).sort()).toEqual(["v1", "v2"]);
  });

  it("dos externos que apuntan al mismo interno son discrepancia los dos", () => {
    const r = clasificar(
      [
        externo({ providerVehicleId: "E1", plate: "1234ABC" }),
        externo({ providerVehicleId: "E2", plate: "1234-ABC" }),
      ],
      [interno({ id: "v1", matricula: "1234ABC" })],
    );
    expect(r.soloProveedor).toHaveLength(0);
    expect(r.discrepancias).toHaveLength(2);
    expect(new Set(r.discrepancias.map((d) => d.motivo))).toEqual(
      new Set([MOTIVOS_DISCREPANCIA.EXTERNOS_DUPLICADOS]),
    );
  });

  it("un vehículo interno sin matrícula no se empareja con nada", () => {
    const r = clasificar(
      [externo({ providerVehicleId: "E1", plate: "1234ABC" })],
      [interno({ id: "v1", matricula: "" })],
    );
    expect(r.soloProveedor[0].propuesta).toBeUndefined();
    expect(r.soloTyreControl).toHaveLength(1);
  });
});

describe("los cuatro cuadrantes", () => {
  it("un enlace activo con los dos presentes es un enlazado", () => {
    const r = clasificar(
      [externo({ providerVehicleId: "E1", plate: "1234ABC", name: "Bus 245" })],
      [interno({ id: "v1", matricula: "1234ABC" })],
      [{ mobilinkId: "v1", externalCode: "E1", activo: true, metodo: "manual", ultimaVezVistoMs: 1000 }],
    );
    expect(r.enlazados).toHaveLength(1);
    expect(r.enlazados[0].metodo).toBe("manual");
    expect(r.enlazados[0].ultimaVezVistoMs).toBe(1000);
    expect(r.soloProveedor).toHaveLength(0);
    expect(r.soloTyreControl).toHaveLength(0);
  });

  it("el enlace manda sobre la matrícula: no se re-empareja lo ya decidido", () => {
    // Alguien enlazó a mano dos vehículos con matrículas distintas. Sabía algo.
    const r = clasificar(
      [externo({ providerVehicleId: "E1", plate: "9999ZZZ" })],
      [interno({ id: "v1", matricula: "1234ABC" }), interno({ id: "v2", matricula: "9999ZZZ" })],
      [{ mobilinkId: "v1", externalCode: "E1", activo: true }],
    );
    // No se propone v2 para E1: E1 ya está enlazado.
    expect(r.soloProveedor).toHaveLength(0);
    // Sale como discrepancia de matrícula, para que una persona lo mire.
    expect(r.discrepancias[0].motivo).toBe(MOTIVOS_DISCREPANCIA.MATRICULA_DISTINTA);
    // Y v2 sigue libre.
    expect(r.soloTyreControl.map((f) => f.interno.id)).toEqual(["v2"]);
  });

  it("un vehículo del proveedor sin nada en TyreControl es solo-proveedor", () => {
    const r = clasificar([externo({ providerVehicleId: "E9", plate: "0000XXX" })], []);
    expect(r.soloProveedor).toHaveLength(1);
    expect(r.soloProveedor[0].propuesta).toBeUndefined();
  });

  it("un vehículo de TyreControl que el proveedor no tiene es solo-TyreControl", () => {
    const r = clasificar([], [interno({ id: "v1", matricula: "8543LZZ", neumaticosMontados: 6 })]);
    expect(r.soloTyreControl).toHaveLength(1);
    expect(r.soloTyreControl[0].interno.neumaticosMontados).toBe(6);
  });

  it("un enlace inactivo no enlaza, pero cuenta cuándo se le vio por última vez", () => {
    const r = clasificar(
      [],
      [interno({ id: "v1", matricula: "8543LZZ" })],
      [{ mobilinkId: "v1", externalCode: "E1", activo: false, ultimaVezVistoMs: 42 }],
    );
    expect(r.enlazados).toHaveLength(0);
    expect(r.soloTyreControl).toHaveLength(1);
    expect(r.soloTyreControl[0].ultimaVezVistoMs).toBe(42);
    expect(r.soloTyreControl[0].externoAnterior).toBe("E1");
  });

  it("de dos enlaces históricos se queda con el más reciente", () => {
    const r = clasificar(
      [],
      [interno({ id: "v1", matricula: "8543LZZ" })],
      [
        { mobilinkId: "v1", externalCode: "VIEJO", activo: false, ultimaVezVistoMs: 10 },
        { mobilinkId: "v1", externalCode: "NUEVO", activo: false, ultimaVezVistoMs: 99 },
      ],
    );
    expect(r.soloTyreControl[0].externoAnterior).toBe("NUEVO");
  });

  it("un vehículo de TyreControl inactivo que reaparece se propone igual", () => {
    // Un inactivo que vuelve a emitir es información, no ruido: por eso se
    // clasifica en vez de descartarse.
    const r = clasificar(
      [externo({ providerVehicleId: "E1", plate: "1234ABC" })],
      [interno({ id: "v1", matricula: "1234ABC", activo: false })],
    );
    expect(r.soloProveedor[0].propuesta?.id).toBe("v1");
    expect(r.soloProveedor[0].propuesta?.activo).toBe(false);
  });

  it("un externo ignorado desaparece de la lista sin tocar nada más", () => {
    const r = clasificar(
      [externo({ providerVehicleId: "AUX1", plate: "0000AUX" }), externo({ providerVehicleId: "E1", plate: "1234ABC" })],
      [interno({ id: "v1", matricula: "1234ABC" })],
      [],
      new Set(["AUX1"]),
    );
    expect(r.soloProveedor.map((f) => f.externo.providerVehicleId)).toEqual(["E1"]);
  });
});

describe("cuando no se puede afirmar una ausencia", () => {
  it("un vehículo sin enlace NO cae en solo-TyreControl si falta una respuesta", () => {
    // El caso real: primera conciliación, ningún enlace todavía, y el proveedor
    // no contesta. Sin esto la flota entera aparecía como candidata a baja.
    const r = clasificarFlota({
      externos: [],
      internos: [interno({ id: "v1", matricula: "1234ABC" }), interno({ id: "v2", matricula: "5678DEF" })],
      enlaces: [],
      puedeAfirmarAusencias: false,
      normalizarMatricula,
    });
    expect(r.soloTyreControl).toHaveLength(0);
    expect(r.noEvaluados.map((v) => v.id)).toEqual(["v1", "v2"]);
  });

  it("con respuesta completa sí se afirma, que es el caso normal", () => {
    const r = clasificar([], [interno({ id: "v1", matricula: "1234ABC" })]);
    expect(r.soloTyreControl).toHaveLength(1);
    expect(r.noEvaluados).toHaveLength(0);
  });

  it("un enlace roto SIGUE siendo discrepancia: de esa cuenta sí hubo respuesta", () => {
    // Apartar lo de las cuentas caídas es cosa del servicio; lo que llega aquí
    // ya viene filtrado, así que un enlace presente se juzga igual.
    const r = clasificarFlota({
      externos: [],
      internos: [interno({ id: "v1", matricula: "1234ABC" })],
      enlaces: [{ mobilinkId: "v1", externalCode: "E1", activo: true }],
      puedeAfirmarAusencias: false,
      normalizarMatricula,
    });
    expect(r.discrepancias[0].motivo).toBe(MOTIVOS_DISCREPANCIA.EXTERNO_DESAPARECIDO);
    expect(r.noEvaluados).toHaveLength(0);
  });
});

describe("enlaces rotos", () => {
  it("el externo ya no aparece: discrepancia, no baja", () => {
    const r = clasificar(
      [],
      [interno({ id: "v1", matricula: "1234ABC" })],
      [{ mobilinkId: "v1", externalCode: "E1", activo: true }],
    );
    expect(r.discrepancias[0].motivo).toBe(MOTIVOS_DISCREPANCIA.EXTERNO_DESAPARECIDO);
    // Y NO cae además en solo-TyreControl: un enlace roto es un caso, no dos.
    expect(r.soloTyreControl).toHaveLength(0);
  });

  it("el interno ya no está en la empresa: discrepancia", () => {
    const r = clasificar(
      [externo({ providerVehicleId: "E1", plate: "1234ABC" })],
      [],
      [{ mobilinkId: "fantasma", externalCode: "E1", activo: true }],
    );
    expect(r.discrepancias[0].motivo).toBe(MOTIVOS_DISCREPANCIA.INTERNO_DESAPARECIDO);
    expect(r.soloProveedor).toHaveLength(0);
  });

  it("no queda ninguno de los dos: enlace huérfano", () => {
    const r = clasificar([], [], [{ mobilinkId: "x", externalCode: "y", activo: true }]);
    expect(r.discrepancias[0].motivo).toBe(MOTIVOS_DISCREPANCIA.ENLACE_HUERFANO);
  });
});

describe("resumen y estado de la sincronización", () => {
  const vacio = { enlazados: [], soloProveedor: [], soloTyreControl: [], discrepancias: [] };
  const fechas = { startedAt: new Date(0), completedAt: new Date(1000) };

  it("todas las cuentas bien: completa y con bajas permitidas", () => {
    const r = resumir({
      cuadrantes: vacio,
      cuentas: [{ connectorKey: "movertis", accountKey: "a", ok: true, vehiculos: 10 }],
      internos: 10,
      externos: 10,
      ...fechas,
    });
    expect(r.status).toBe("complete");
    expect(r.bajasPermitidas).toBe(true);
  });

  it("una cuenta de dos falla: incompleta y sin bajas", () => {
    const r = resumir({
      cuadrantes: vacio,
      cuentas: [
        { connectorKey: "movertis", accountKey: "a", ok: true, vehiculos: 10 },
        { connectorKey: "movertis", accountKey: "b", ok: false, vehiculos: 0, error: "HTTP 503" },
      ],
      internos: 20,
      externos: 10,
      desconocidos: 8,
      ...fechas,
    });
    expect(r.status).toBe("incomplete");
    expect(r.bajasPermitidas).toBe(false);
    expect(r.tyrecontrolUnknownCount).toBe(8);
  });

  it("todas fallan: error, y el cero de vehículos no se confunde con una flota vacía", () => {
    const r = resumir({
      cuadrantes: vacio,
      cuentas: [{ connectorKey: "movertis", accountKey: "a", ok: false, vehiculos: 0, error: "timeout" }],
      internos: 20,
      externos: 0,
      ...fechas,
    });
    expect(r.status).toBe("error");
    expect(r.bajasPermitidas).toBe(false);
    expect(r.cuentas[0].error).toBe("timeout");
  });

  it("sin ninguna cuenta configurada es error, no una flota conciliada a cero", () => {
    const r = resumir({ cuadrantes: vacio, cuentas: [], internos: 20, externos: 0, ...fechas });
    expect(r.status).toBe("error");
    expect(r.bajasPermitidas).toBe(false);
  });

  it("una respuesta vacía VÁLIDA es completa: cero vehículos es un dato", () => {
    const r = resumir({
      cuadrantes: vacio,
      cuentas: [{ connectorKey: "movertis", accountKey: "a", ok: true, vehiculos: 0 }],
      internos: 0,
      externos: 0,
      ...fechas,
    });
    expect(r.status).toBe("complete");
    expect(r.bajasPermitidas).toBe(true);
  });
});

/**
 * El snapshot de matrícula, usado de verdad.
 *
 * Se guardaba desde el principio y no se leía nunca: la discrepancia se
 * calculaba comparando el proveedor contra TyreControl, con dos consecuencias
 * que se notan a la semana de usar la pantalla. Una, que no se sabía de qué lado
 * se había movido la matrícula. Y dos, peor: un enlace hecho a mano entre dos
 * vehículos con matrículas distintas salía como discrepancia en cada pasada,
 * para siempre, y una lista que repite lo ya decidido se deja de leer.
 */
describe("discrepancias de matrícula con snapshot", () => {
  const enlaceCon = (over: Partial<EnlaceVehiculo> = {}): EnlaceVehiculo => ({
    mobilinkId: "v1",
    externalCode: "E1",
    activo: true,
    metodo: "plate_exact",
    ...over,
  });

  it("caso A: cambió la del PROVEEDOR", () => {
    const r = clasificar(
      [externo({ providerVehicleId: "E1", plate: "1234ABD" })],
      [interno({ id: "v1", matricula: "1234ABC" })],
      [enlaceCon({ matriculaSnapshot: "1234ABC", matriculaInternaSnapshot: "1234ABC" })],
    );
    expect(r.enlazados).toHaveLength(0);
    expect(r.discrepancias).toHaveLength(1);
    const d = r.discrepancias[0];
    expect(d.motivo).toBe(MOTIVOS_DISCREPANCIA.MATRICULA_CAMBIO_PROVEEDOR);
    expect(d.matriculas).toEqual({
      snapshotProveedor: "1234ABC",
      snapshotTyreControl: "1234ABC",
      proveedor: "1234ABD",
      tyrecontrol: "1234ABC",
    });
    expect(d.detalle).toContain("El proveedor ha cambiado");
    expect(d.detalle).toContain("no se toca");
  });

  it("caso B: cambió la de TYRECONTROL", () => {
    const r = clasificar(
      [externo({ providerVehicleId: "E1", plate: "1234ABC" })],
      [interno({ id: "v1", matricula: "1234ABD" })],
      [enlaceCon({ matriculaSnapshot: "1234ABC", matriculaInternaSnapshot: "1234ABC" })],
    );
    expect(r.discrepancias[0].motivo).toBe(MOTIVOS_DISCREPANCIA.MATRICULA_CAMBIO_TYRECONTROL);
    expect(r.discrepancias[0].detalle).toContain("TyreControl ha cambiado");
  });

  it("caso C: las dos siguen coincidiendo, ninguna discrepancia", () => {
    const r = clasificar(
      [externo({ providerVehicleId: "E1", plate: "1234ABC" })],
      [interno({ id: "v1", matricula: "1234ABC" })],
      [enlaceCon({ matriculaSnapshot: "1234ABC", matriculaInternaSnapshot: "1234ABC" })],
    );
    expect(r.discrepancias).toHaveLength(0);
    expect(r.enlazados).toHaveLength(1);
    expect(r.enlazados[0].diferenciaAceptada).toBeUndefined();
  });

  it("caso D: diferencia ACEPTADA al enlazar, no se repite cada pasada", () => {
    // Alguien enlazó a mano dos matrículas distintas porque sabía algo que el
    // sistema no. Sigue siendo un enlace, no una discrepancia nueva.
    const r = clasificar(
      [externo({ providerVehicleId: "E1", plate: "9999ZZZ" })],
      [interno({ id: "v1", matricula: "1234ABC" })],
      [enlaceCon({
        metodo: "manual",
        matriculaSnapshot: "9999ZZZ",
        matriculaInternaSnapshot: "1234ABC",
      })],
    );
    expect(r.discrepancias).toHaveLength(0);
    expect(r.enlazados).toHaveLength(1);
    // Pero se marca, para que la pantalla lo pueda enseñar sin preguntar otra vez.
    expect(r.enlazados[0].diferenciaAceptada).toBe(true);
  });

  it("cambiaron las DOS, cada una por su lado", () => {
    const r = clasificar(
      [externo({ providerVehicleId: "E1", plate: "5555EEE" })],
      [interno({ id: "v1", matricula: "7777FFF" })],
      [enlaceCon({ matriculaSnapshot: "1234ABC", matriculaInternaSnapshot: "1234ABC" })],
    );
    expect(r.discrepancias[0].motivo).toBe(MOTIVOS_DISCREPANCIA.MATRICULA_CAMBIO_AMBOS);
  });

  it("enlace ANTIGUO sin snapshots: difieren y NO se atribuye el cambio", () => {
    // Los enlaces de antes de guardar los snapshots. La única respuesta honesta
    // es decir que no coinciden sin inventar quién cambió.
    const r = clasificar(
      [externo({ providerVehicleId: "E1", plate: "1234ABD" })],
      [interno({ id: "v1", matricula: "1234ABC" })],
      [enlaceCon()],
    );
    expect(r.discrepancias[0].motivo).toBe(MOTIVOS_DISCREPANCIA.MATRICULA_DISTINTA);
    expect(r.discrepancias[0].detalle).toContain("no se puede saber cuál de las dos cambió");
    expect(r.discrepancias[0].matriculas?.snapshotTyreControl).toBeNull();
  });

  it("con solo el snapshot del proveedor tampoco se atribuye a TyreControl", () => {
    // El estado de los enlaces creados hasta ahora: media referencia no basta
    // para decir que el que cambió fue el otro.
    const r = clasificar(
      [externo({ providerVehicleId: "E1", plate: "1234ABC" })],
      [interno({ id: "v1", matricula: "1234ABD" })],
      [enlaceCon({ matriculaSnapshot: "1234ABC" })],
    );
    expect(r.discrepancias[0].motivo).toBe(MOTIVOS_DISCREPANCIA.MATRICULA_DISTINTA);
  });

  it("los separadores no cuentan: la comparación va normalizada", () => {
    // «1234-ABC» y «1234 ABC» son la misma matrícula, y un cambio de formato en
    // la plataforma del proveedor no es un cambio de vehículo.
    const r = clasificar(
      [externo({ providerVehicleId: "E1", plate: "1234-ABC" })],
      [interno({ id: "v1", matricula: "1234 ABC" })],
      [enlaceCon({ matriculaSnapshot: "1234ABC", matriculaInternaSnapshot: "1234abc" })],
    );
    expect(r.discrepancias).toHaveLength(0);
    expect(r.enlazados).toHaveLength(1);
  });

  it("un externo sin matrícula legible no contradice a nadie", () => {
    const r = clasificar(
      [externo({ providerVehicleId: "E1", name: "Nueva_60007" })],
      [interno({ id: "v1", matricula: "1234ABC" })],
      [enlaceCon({ matriculaSnapshot: "1234ABC", matriculaInternaSnapshot: "1234ABC" })],
    );
    expect(r.discrepancias).toHaveLength(0);
    expect(r.enlazados).toHaveLength(1);
  });

  it("si las dos cambian pero acaban IGUALES, no hay nada que resolver", () => {
    // Le cambiaron la matrícula al autobús y se actualizó en los dos sitios.
    const r = clasificar(
      [externo({ providerVehicleId: "E1", plate: "5555EEE" })],
      [interno({ id: "v1", matricula: "5555EEE" })],
      [enlaceCon({ matriculaSnapshot: "1234ABC", matriculaInternaSnapshot: "1234ABC" })],
    );
    expect(r.discrepancias).toHaveLength(0);
    expect(r.enlazados).toHaveLength(1);
  });
});
