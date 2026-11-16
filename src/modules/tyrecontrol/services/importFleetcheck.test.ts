import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LecturaFleetcheck, RuedaFleetcheck } from "./fleetcheck";

/**
 * El alta de un vehículo sin plano es lo único de esta importación que crea
 * neumáticos. Se fija qué se propone, qué se rechaza antes de empezar y en
 * qué orden se llama a las funciones de la base.
 */

const POS = (tipo: string, n: number) => {
  const base = [
    { id: `${tipo}-1i`, eje: 1, lado: "izq", interior_exterior: null },
    { id: `${tipo}-1d`, eje: 1, lado: "der", interior_exterior: null },
    { id: `${tipo}-2ie`, eje: 2, lado: "izq", interior_exterior: "ext" },
    { id: `${tipo}-2ii`, eje: 2, lado: "izq", interior_exterior: "int" },
    { id: `${tipo}-2di`, eje: 2, lado: "der", interior_exterior: "int" },
    { id: `${tipo}-2de`, eje: 2, lado: "der", interior_exterior: "ext" },
    { id: `${tipo}-3i`, eje: 3, lado: "izq", interior_exterior: null },
    { id: `${tipo}-3d`, eje: 3, lado: "der", interior_exterior: null },
  ];
  return base.slice(0, n);
};

let vehiculos: Record<string, unknown>[] = [];
let montajes: { vehiculo_id: string }[] = [];
let llamadas: { nombre: string; args: Record<string, unknown> }[] = [];
let actualizaciones: Record<string, unknown>[] = [];
let fallaEn: string | null = null;

vi.mock("./data", () => ({
  listarVehiculos: async () => vehiculos,
  listarTiposVehiculo: async () => [{ id: "t-bus", nombre: "autobus" }, { id: "t-car", nombre: "autocar" }],
  listarPosiciones: async (t: string) => POS(t, t === "t-bus" ? 6 : 8),
}));

vi.mock("./supabase", () => {
  function tabla(nombre: string) {
    const api: Record<string, unknown> = {};
    api.select = () => (nombre === "tc_medidas_tipo_vehiculo"
      ? Promise.resolve({ data: [{ tipo_vehiculo_id: "t-bus", medida: { valor: "295/80R22.5" } }], error: null })
      : api);
    api.in = () => (nombre === "tc_montajes_actuales" ? Promise.resolve({ data: montajes, error: null }) : api);
    api.eq = () => api;
    api.then = (ok: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(ok);
    api.update = (v: Record<string, unknown>) => ({ eq: (_c: string, id: string) => { actualizaciones.push({ ...v, id }); return Promise.resolve({ error: null }); } });
    return api;
  }
  return {
    supabase: {
      from: tabla,
      rpc: async (nombre: string, args: Record<string, unknown>) => {
        llamadas.push({ nombre, args });
        if (fallaEn && args.p_vehiculo === fallaEn && nombre === "tc_inventario_inicial_posicion") {
          return { data: null, error: { message: "MEDIDA_INCOMPATIBLE" } };
        }
        if (nombre === "tc_crear_referencia_provisional") return { data: { referencia_id: `ref-${args.p_modelo}`, creado: { referencia: args.p_modelo === "Nuevo" } }, error: null };
        if (nombre === "tc_inventario_inicial_finalizar") return { data: { revision_id: `rev-${args.p_vehiculo}`, ya_estaba: false }, error: null };
        return { data: {}, error: null };
      },
    },
  };
});

const { altasPosibles, darDeAlta } = await import("./importFleetcheck");

const rueda = (posicion: string, neumatico = "Hankook 295/80 R22.5 Smart Flex AH51 3PMSF 154M", perfiles = [8, 7.5]): RuedaFleetcheck => ({
  posicion, eje: Number(posicion[0]), lado: posicion[2] === "I" ? "izq" : "der",
  dentroFuera: posicion[3] === "I" ? "int" : "ext",
  neumatico, serie: null, perfiles, presionAntes: 9, presionDespues: null, comentario: null,
});
const BUS = ["1-IE", "1-DE", "2-IE", "2-II", "2-DI", "2-DE"];
const lectura = (vs: { matricula: string; ruedas: RuedaFleetcheck[] }[]): LecturaFleetcheck => ({
  fecha: "2026-11-16", avisos: [], vehiculos: vs.map((v) => ({ ...v, km: null })),
});
const veh = (id: string, matricula: string, tipo: string | null = null) => ({ id, matricula, empresa_id: "e1", tipo_vehiculo_id: tipo });

beforeEach(() => { vehiculos = []; montajes = []; llamadas = []; actualizaciones = []; fallaEn = null; });

describe("altasPosibles", () => {
  it("propone los que no tienen tipo, con el tipo que dicen sus ejes", async () => {
    vehiculos = [veh("v1", "1111AAA"), veh("v2", "2222BBB", "t-bus")];
    const p = await altasPosibles(lectura([{ matricula: "1111AAA", ruedas: BUS.map((x) => rueda(x)) }, { matricula: "2222BBB", ruedas: BUS.map((x) => rueda(x)) }]));
    expect(p).toHaveLength(1);
    expect(p[0]).toMatchObject({ matricula: "1111AAA", firma: "2x4", tipoNombre: "autobus", ruedas: 6, motivo: null });
  });

  it("un reparto sin tipo claro no se adivina", async () => {
    vehiculos = [veh("v1", "1111AAA")];
    const p = await altasPosibles(lectura([{ matricula: "1111AAA", ruedas: ["1-IE", "1-DE", "2-IE", "2-DE"].map((x) => rueda(x)) }]));
    expect(p[0].tipoId).toBeNull();
    expect(p[0].motivo).toContain("2x2");
  });

  it("una medida que el tipo no admite se dice antes de empezar", async () => {
    vehiculos = [veh("v1", "3362NSV")];
    const p = await altasPosibles(lectura([{ matricula: "3362NSV", ruedas: BUS.map((x) => rueda(x, "Continental 205/75 R16 VanContact 100 113R")) }]));
    expect(p[0].motivo).toContain("205/75 R16");
  });

  it("sin índice de carga no se puede dar de alta la rueda, y se dice cuál", async () => {
    vehiculos = [veh("v1", "1111AAA")];
    const ruedas = BUS.map((x) => rueda(x));
    ruedas[3] = rueda("2-II", "InsaTruck 295/80 R22.5 K25");
    const p = await altasPosibles(lectura([{ matricula: "1111AAA", ruedas }]));
    expect(p[0].motivo).toContain("2-II");
  });

  it("sin tipo pero con neumáticos ya montados: a mano", async () => {
    vehiculos = [veh("v1", "1111AAA")];
    montajes = [{ vehiculo_id: "v1" }];
    const p = await altasPosibles(lectura([{ matricula: "1111AAA", ruedas: BUS.map((x) => rueda(x)) }]));
    expect(p[0].motivo).toContain("a mano");
  });
});

describe("darDeAlta", () => {
  const informe = lectura([
    { matricula: "1111AAA", ruedas: BUS.map((x) => rueda(x)) },
    { matricula: "2222BBB", ruedas: BUS.map((x) => rueda(x, "Marca 295/80 R22.5 Nuevo 154M")) },
  ]);
  const propuesta = (id: string, matricula: string, motivo: string | null = null) => ({
    matricula, vehiculoId: id, empresaId: "e1", firma: "2x4", tipoId: "t-bus", tipoNombre: "autobus", ruedas: 6, motivo,
  });

  it("tipo, referencia, una posición por rueda y cierre, en ese orden", async () => {
    const r = await darDeAlta(informe, "2026-11-16", [propuesta("v1", "1111AAA")]);
    expect(r).toMatchObject({ hechas: ["1111AAA"], fallos: [] });
    expect(llamadas.map((l) => l.nombre)).toEqual([
      "tc_alta_operativa_tipo", "tc_crear_referencia_provisional",
      ...Array(6).fill("tc_inventario_inicial_posicion"), "tc_inventario_inicial_finalizar",
    ]);
  });

  it("cada rueda va a SU posición, con la menor lectura y sin serie inventada", async () => {
    await darDeAlta(informe, "2026-11-16", [propuesta("v1", "1111AAA")]);
    const pos = llamadas.filter((l) => l.nombre === "tc_inventario_inicial_posicion");
    expect(pos.map((l) => l.args.p_posicion)).toEqual(["t-bus-1i", "t-bus-1d", "t-bus-2ie", "t-bus-2ii", "t-bus-2di", "t-bus-2de"]);
    const datos = pos[0].args.p_datos as Record<string, string>;
    expect(datos.profundidad_mm).toBe("7.5");
    expect(datos.presion_bar).toBe("9");
    expect(datos.observaciones).toContain("Lecturas: 8,0 / 7,5 mm");
    expect("numero_serie" in datos).toBe(false);
  });

  it("el catálogo recibe el modelo sin el 3PMSF y los índices por separado", async () => {
    await darDeAlta(informe, "2026-11-16", [propuesta("v1", "1111AAA")]);
    expect(llamadas[1].args).toMatchObject({
      p_empresa: "e1", p_marca: "Hankook", p_modelo: "Smart Flex AH51", p_medida: "295/80 R22.5",
      p_carga_simple: "154", p_carga_doble: null, p_velocidad: "M",
    });
  });

  it("cierra sin kilómetros y deja la revisión con la fecha del informe", async () => {
    await darDeAlta(informe, "2026-11-16", [propuesta("v1", "1111AAA")]);
    expect(llamadas.at(-1)!.args).toEqual({ p_vehiculo: "v1", p_km: null, p_origen_km: null });
    expect(actualizaciones).toEqual([{ fecha_revision: "2026-11-16", id: "rev-v1" }]);
  });

  it("un vehículo que falla no detiene a los demás, y se dice por qué", async () => {
    fallaEn = "v1";
    const r = await darDeAlta(informe, "2026-11-16", [propuesta("v1", "1111AAA"), propuesta("v2", "2222BBB")]);
    expect(r.hechas).toEqual(["2222BBB"]);
    expect(r.fallos).toEqual([{ matricula: "1111AAA", error: "MEDIDA_INCOMPATIBLE" }]);
    expect(r.avisos.join(" ")).toContain("pendiente de validar");
  });

  it("los que traen motivo no se tocan", async () => {
    const r = await darDeAlta(informe, "2026-11-16", [propuesta("v1", "1111AAA", "no")]);
    expect(r.hechas).toEqual([]);
    expect(llamadas).toEqual([]);
  });
});
