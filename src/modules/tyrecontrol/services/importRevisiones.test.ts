import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Lo que se fija aquí son las dos opciones que hacen falta para traer un
 * informe de un tercero sin estropear nada: medir solo lo que ya está montado
 * y no pisar la revisión de un técnico. Sin ellas el motor crea neumáticos y
 * montajes genéricos y reescribe las mediciones del día.
 */

const V1 = { id: "v1", matricula: "1111AAA", empresa_id: "e1", tipo_vehiculo_id: "t1", empresa: { nombre: "Plana" } };
const V2 = { id: "v2", matricula: "2222BBB", empresa_id: "e1", tipo_vehiculo_id: "t1", empresa: { nombre: "Plana" } };
const POSICIONES = [
  { id: "p1", codigo_posicion: "E1_IZQ", eje: 1, lado: "izq", interior_exterior: null, orden_visual: 1 },
  { id: "p2", codigo_posicion: "E1_DER", eje: 1, lado: "der", interior_exterior: null, orden_visual: 2 },
];

let montajes: { vehiculo_id: string; posicion_id: string; neumatico_id: string }[] = [];
let revisiones: { id: string; vehiculo_id: string; fecha_revision: string }[] = [];
const escrito: Record<string, unknown[]> = {};

vi.mock("./data", () => ({
  listarVehiculos: async () => [V1, V2],
  listarPosiciones: async () => POSICIONES.map((p) => ({ ...p })),
}));

vi.mock("./supabase", () => {
  function tabla(nombre: string) {
    const api: Record<string, unknown> = {};
    const filas = () => (nombre === "tc_montajes_actuales" ? montajes : nombre === "revisiones_vehiculo" ? revisiones : []);
    api.select = () => api;
    api.in = () => Promise.resolve({ data: filas(), error: null });
    api.insert = (v: unknown[]) => {
      (escrito[nombre] ??= []).push(...v);
      const creadas = (v as { vehiculo_id: string; fecha_revision: string }[])
        .map((x, i) => ({ id: `nueva-${i}`, vehiculo_id: x.vehiculo_id, fecha_revision: x.fecha_revision }));
      return { select: () => Promise.resolve({ data: creadas, error: null }) };
    };
    api.upsert = (v: unknown[]) => {
      (escrito[nombre] ??= []).push(...v);
      return Object.assign(Promise.resolve({ data: [], error: null }), { select: () => Promise.resolve({ data: [], error: null }) });
    };
    api.update = () => ({ eq: () => ({ is: () => Promise.resolve({ error: null }) }) });
    return api;
  }
  return { supabase: { from: tabla } };
});

const { importRevisiones } = await import("./importRevisiones");

const fila = (matricula: string, codigo: string, prof: number, pres: number | null = 9) => ({
  matricula, fecha_revision: "2026-11-16", codigo_posicion: codigo, profundidad_mm: prof, presion_bar: pres,
});
const INFORME = [fila("1111AAA", "E1_IZQ", 7), fila("1111AAA", "E1_DER", 6.5), fila("2222BBB", "E1_IZQ", 9), fila("2222BBB", "E1_DER", 8)];
const TERCERO = { soloMontados: true, respetarExistentes: true, tipoRevision: "profundidades_presiones" as const, observaciones: "De fuera" };

beforeEach(() => {
  montajes = [
    { vehiculo_id: "v1", posicion_id: "p1", neumatico_id: "n1" },
    { vehiculo_id: "v1", posicion_id: "p2", neumatico_id: "n2" },
    { vehiculo_id: "v2", posicion_id: "p1", neumatico_id: "n3" },
  ];
  revisiones = [];
  for (const k of Object.keys(escrito)) delete escrito[k];
});

describe("importRevisiones con un informe de un tercero", () => {
  it("la posición sin neumático no se importa y se devuelve en su lista", async () => {
    const r = await importRevisiones(INFORME, false, TERCERO);
    expect(r.resumen).toMatchObject({ revisiones: 2, detalles: 3, neumaticosNuevos: 0 });
    expect(r.sinNeumatico).toEqual([{ matricula: "2222BBB", posiciones: ["E1_DER"] }]);
  });

  it("al ejecutar no crea neumáticos ni montajes", async () => {
    const r = await importRevisiones(INFORME, true, TERCERO);
    expect(escrito.tc_neumaticos).toBeUndefined();
    expect(escrito.tc_montajes_actuales).toBeUndefined();
    expect(escrito.revisiones_vehiculo).toHaveLength(2);
    expect(escrito.revisiones_neumaticos_detalle).toHaveLength(3);
    expect(r.resumen.detalles).toBe(3);
  });

  it("la revisión lleva su procedencia, qué se midió y ningún kilometraje", async () => {
    await importRevisiones(INFORME, true, { ...TERCERO, notaPorMatricula: new Map([["1111AAA", "Km del informe: 486.164"]]) });
    const [a, b] = escrito.revisiones_vehiculo as Record<string, unknown>[];
    expect(a).toMatchObject({ vehiculo_id: "v1", tipo_revision: "profundidades_presiones", observaciones: "De fuera · Km del informe: 486.164", estado_revision: "completada" });
    expect(b.observaciones).toBe("De fuera");
    expect("km_vehiculo" in a).toBe(false);
  });

  it("cada medición va con el neumático que ya estaba montado", async () => {
    await importRevisiones(INFORME, true, TERCERO);
    const d = escrito.revisiones_neumaticos_detalle as Record<string, unknown>[];
    expect(d.map((x) => [x.vehiculo_id, x.posicion_id, x.neumatico_id, x.profundidad_mm, x.presion_bar])).toEqual([
      ["v1", "p1", "n1", 7, 9], ["v1", "p2", "n2", 6.5, 9], ["v2", "p1", "n3", 9, 9],
    ]);
  });

  it("si ya había una revisión ese día, ese vehículo no se toca", async () => {
    revisiones = [{ id: "r-tecnico", vehiculo_id: "v1", fecha_revision: "2026-11-16" }];
    const r = await importRevisiones(INFORME, true, TERCERO);
    expect(r.yaRevisados).toEqual(["1111AAA"]);
    expect((escrito.revisiones_neumaticos_detalle as { vehiculo_id: string }[]).every((x) => x.vehiculo_id === "v2")).toBe(true);
    expect(escrito.revisiones_vehiculo).toHaveLength(1);
  });

  it("un vehículo sin ningún neumático montado no abre una revisión vacía", async () => {
    montajes = montajes.filter((m) => m.vehiculo_id !== "v2");
    const r = await importRevisiones(INFORME, true, TERCERO);
    expect(escrito.revisiones_vehiculo).toHaveLength(1);
    expect(r.sinNeumatico).toEqual([{ matricula: "2222BBB", posiciones: ["E1_IZQ", "E1_DER"] }]);
  });
});

describe("importRevisiones como siempre (el Excel propio)", () => {
  it("sin las opciones sigue creando el neumático genérico que falta", async () => {
    const r = await importRevisiones(INFORME, false);
    expect(r.resumen).toMatchObject({ revisiones: 2, detalles: 4, neumaticosNuevos: 1 });
    expect(r.sinNeumatico).toBeUndefined();
    expect(r.yaRevisados).toBeUndefined();
  });
});
