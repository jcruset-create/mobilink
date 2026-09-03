/**
 * Estado técnico del vehículo.
 *
 * Lo que se fija aquí es sobre todo lo que NO se debe fundir: las dos
 * profundidades y la presión. Y el testigo de cambio por posición, que es la
 * pieza de la que dependerá la detección de conflictos en la fase siguiente.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

let tablas: Record<string, any[]> = {};
let consultas: string[] = [];

vi.mock("../supabase.ts", () => {
  function from(tabla: string) {
    consultas.push(tabla);
    const resultado = () => ({ data: tablas[tabla] ?? [], error: null });
    const api: any = {
      select: () => api,
      eq: () => api,
      in: () => api,
      order: () => api,
      limit: () => Promise.resolve(resultado()),
      maybeSingle: () => Promise.resolve({ data: (tablas[tabla] ?? [])[0] ?? null, error: null }),
      then: (r: any) => Promise.resolve(resultado()).then(r),
    };
    return api;
  }
  return { supabase: { from } };
});

const { estadoDeVehiculo } = await import("./estadoVehiculo.ts");

const VEHICULO = {
  tcVehicleId: "veh-1", empresaId: "emp-1", empresaNombre: "Transportes Uno",
  matricula: "1234ABC", tipoVehiculoId: "tipo-1", tipoVehiculo: "tractora",
  marca: "Volvo", modelo: "FH", kmActual: 250000, origenKm: "webfleet",
  activo: true, updatedAt: "2026-08-01T10:00:00Z",
};

beforeEach(() => { tablas = {}; consultas = []; });

describe("Configuración y posiciones", () => {
  it("un vehículo sin tipo no tiene plano de ruedas, y eso no es un error", async () => {
    const e = await estadoDeVehiculo({ ...VEHICULO, tipoVehiculoId: null, tipoVehiculo: null });
    expect(e!.posiciones).toEqual([]);
    expect(e!.resumen.posiciones).toBe(0);
    // Y no se ha preguntado por posiciones que no existen.
    expect(consultas).not.toContain("tc_posiciones_vehiculo");
  });

  it("devuelve las posiciones del tipo, ordenadas y con su código", async () => {
    tablas.tc_posiciones_vehiculo = [
      { id: "pos-1", codigo_posicion: "E1_IZQ", nombre: "Eje 1 izq", eje: 1, lado: "izq", interior_exterior: null, orden_visual: 1, activo: true },
      { id: "pos-2", codigo_posicion: "E1_DER", nombre: "Eje 1 der", eje: 1, lado: "der", interior_exterior: null, orden_visual: 2, activo: true },
    ];
    const e = await estadoDeVehiculo(VEHICULO);
    expect(e!.posiciones.map((p) => p.codigoPosicion)).toEqual(["E1_IZQ", "E1_DER"]);
    expect(e!.posiciones[0].eje).toBe(1);
    expect(e!.resumen.posiciones).toBe(2);
  });

  it("una posición desactivada en TC no se pinta", async () => {
    tablas.tc_posiciones_vehiculo = [
      { id: "pos-1", codigo_posicion: "E1_IZQ", eje: 1, orden_visual: 1, activo: true },
      { id: "pos-vieja", codigo_posicion: "E9_X", eje: 9, orden_visual: 9, activo: false },
    ];
    const e = await estadoDeVehiculo(VEHICULO);
    expect(e!.posiciones).toHaveLength(1);
  });

  it("una posición sin neumático se devuelve vacía, no se omite", async () => {
    tablas.tc_posiciones_vehiculo = [{ id: "pos-1", codigo_posicion: "E1_IZQ", eje: 1, orden_visual: 1, activo: true }];
    const e = await estadoDeVehiculo(VEHICULO);
    expect(e!.posiciones[0].neumatico).toBeNull();
    expect(e!.posiciones[0].montajeActualId).toBeNull();
    expect(e!.resumen.montados).toBe(0);
  });
});

describe("Montaje y neumático", () => {
  beforeEach(() => {
    tablas.tc_posiciones_vehiculo = [{ id: "pos-1", codigo_posicion: "E1_IZQ", eje: 1, orden_visual: 1, activo: true }];
    tablas.tc_montajes_actuales = [
      { id: "mon-1", neumatico_id: "neu-1", posicion_id: "pos-1", fecha_montaje: "2026-01-15", km_montaje: 210000 },
    ];
    tablas.tc_neumaticos = [
      { id: "neu-1", marca: "Michelin", modelo: "X Multi", medida: "315/70R22.5", dot: "1425",
        numero_serie: "SN-9", rfid_epc: null, estado: "montado", profundidad_actual_mm: 8.5,
        reesculturado: false, girado_en_llanta: false },
    ];
  });

  it("pega el neumático a su posición con los datos del montaje", async () => {
    const e = await estadoDeVehiculo(VEHICULO);
    const p = e!.posiciones[0];
    expect(p.neumatico!.marca).toBe("Michelin");
    expect(p.neumatico!.medida).toBe("315/70R22.5");
    expect(p.fechaMontaje).toBe("2026-01-15");
    expect(p.kmMontaje).toBe(210000);
    expect(e!.resumen.montados).toBe(1);
  });

  /*
   * `tc_montajes_actuales` tiene unique(vehiculo_id, posicion_id) y la fila se
   * borra al desmontar: un cambio SIEMPRE produce un id distinto. Es el dato
   * del que dependerá la detección de conflictos.
   */
  it("cada posición expone el testigo de cambio", async () => {
    const e = await estadoDeVehiculo(VEHICULO);
    expect(e!.posiciones[0].montajeActualId).toBe("mon-1");
  });
});

describe("Profundidad y presión: no se funden", () => {
  beforeEach(() => {
    tablas.tc_posiciones_vehiculo = [{ id: "pos-1", codigo_posicion: "E1_IZQ", eje: 1, orden_visual: 1, activo: true }];
    tablas.tc_montajes_actuales = [{ id: "mon-1", neumatico_id: "neu-1", posicion_id: "pos-1", fecha_montaje: "2026-01-15", km_montaje: 1 }];
    tablas.tc_neumaticos = [{ id: "neu-1", estado: "montado", profundidad_actual_mm: 8.5 }];
    tablas.revisiones_vehiculo = [{ id: "rev-1", fecha_revision: "2026-07-20", km_vehiculo: 240000 }];
    tablas.revisiones_neumaticos_detalle = [
      { posicion_id: "pos-1", profundidad_mm: 6.2, presion_bar: 8.1, estado_visual: "desgaste_irregular",
        alerta_generada: true, no_accesible: false, neumatico_ausente: false, foto_url: null },
    ];
  });

  /*
   * Son dos datos distintos: lo que TC mantiene como actual y lo que se midió
   * el día de la revisión. Fundirlos inventaría una «profundidad definitiva»
   * y escondería justo la discrepancia que interesa.
   */
  it("la profundidad de TC y la de la revisión van por separado", async () => {
    const e = await estadoDeVehiculo(VEHICULO);
    const p = e!.posiciones[0];
    expect(p.neumatico!.profundidadActualMm).toBe(8.5);
    expect(p.ultimaRevision!.profundidadMm).toBe(6.2);
    expect(p.ultimaRevision!.fecha).toBe("2026-07-20");
  });

  /* TC no guarda presión actual: solo la medida en una revisión. */
  it("la presión se llama «última registrada» y lleva su fecha", async () => {
    const e = await estadoDeVehiculo(VEHICULO);
    const r = e!.posiciones[0].ultimaRevision!;
    expect(r.ultimaPresionBar).toBe(8.1);
    expect(r.fecha).toBe("2026-07-20");
    // No existe ningún campo que se llame «presión actual».
    expect(JSON.stringify(e)).not.toMatch(/presionActual/i);
  });

  it("las alertas se cuentan en el resumen", async () => {
    const e = await estadoDeVehiculo(VEHICULO);
    expect(e!.resumen.alertas).toBe(1);
    expect(e!.resumen.ultimaRevisionFecha).toBe("2026-07-20");
  });

  it("la profundidad mínima sale de lo que TC tiene como actual", async () => {
    const e = await estadoDeVehiculo(VEHICULO);
    expect(e!.resumen.profundidadMinimaMm).toBe(8.5);
  });

  it("una posición sin revisar lo dice con null, no con ceros", async () => {
    tablas.revisiones_neumaticos_detalle = [];
    const e = await estadoDeVehiculo(VEHICULO);
    expect(e!.posiciones[0].ultimaRevision).toBeNull();
    expect(e!.resumen.alertas).toBe(0);
  });
});

describe("Rendimiento", () => {
  /*
   * Un N+1 aquí se notaría justo cuando molesta: un camión de doce posiciones
   * con alguien esperando.
   */
  it("no hace una consulta por rueda", async () => {
    tablas.tc_posiciones_vehiculo = Array.from({ length: 12 }, (_, i) => ({
      id: `pos-${i}`, codigo_posicion: `P${i}`, eje: 1 + Math.floor(i / 4), orden_visual: i, activo: true,
    }));
    tablas.tc_montajes_actuales = Array.from({ length: 12 }, (_, i) => ({
      id: `mon-${i}`, neumatico_id: `neu-${i}`, posicion_id: `pos-${i}`, fecha_montaje: "2026-01-15", km_montaje: 1,
    }));
    tablas.tc_neumaticos = Array.from({ length: 12 }, (_, i) => ({ id: `neu-${i}`, estado: "montado" }));

    consultas = [];
    const e = await estadoDeVehiculo(VEHICULO);
    expect(e!.posiciones).toHaveLength(12);
    expect(e!.resumen.montados).toBe(12);
    // Seis consultas fijas, no doce ni veinticuatro.
    expect(consultas.length).toBeLessThanOrEqual(7);
  });
});
