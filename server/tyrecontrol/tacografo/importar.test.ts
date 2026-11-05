import { describe, expect, it } from "vitest";
import { marcarKmSospechoso, preparar, type OpcionesPreparar } from "./importar.ts";
import type { FilaTacografo } from "./parser.ts";
import type { VehiculoRef } from "./simular.ts";

const CAL = "Calibrado o Parametrización / Control / Reparación";

const fila = (p: Partial<FilaTacografo> & { idOrigen: string; matriculaNorm: string }): FilaTacografo => ({
  fila: 4, fecha: "2026-01-15", tipoOperacion: CAL, resultado: "Favorable", ordenTrabajo: null,
  matriculaOrigen: p.matriculaNorm, bastidor: null, marca: null, modelo: null, categoria: null,
  clienteNombre: "PLANA", medidaOrigen: "295/80R22.5", medidaNorm: "295/80R22.5",
  medidaSospechosa: false, medidaAnteriorOrigen: null, medidaAnteriorNorm: null,
  kmAnterior: null, kmNuevo: null, paramL: null, paramW: null, paramK: null,
  paramLAnterior: null, paramWAnterior: null, tipoTacografo: null, fabricante: null,
  referencia: null, version: null, versionMapa: null, numSerie: null, numSensor: null,
  gnss: null, dsrc: null, precintos: null, bRodillos: null, eqCalibrado: null,
  manometro: null, cronometro: null, tecnico: null, tecnicoTarjeta: null,
  tecnicoTarjetaCad: null, tecnicoTarjetaVer: null, observaciones: null, tgdFichero: null,
  comprobaciones: null, ...p,
});

const veh = (m: string): VehiculoRef =>
  ({ id: `v-${m}`, matricula: m, matriculaNorm: m, bastidor: null, activo: true, medidaId: null, medida: null });

const op = (p: Partial<OpcionesPreparar> = {}): OpcionesPreparar => ({
  empresa: "emp-1", loteId: "lote-1", sistemaOrigen: "informe_intervenciones",
  archivo: "taco.xlsx", hoja: "Hoja1", usuarioId: "u-1",
  vehiculos: [], yaImportados: new Set(), ...p,
});

describe("qué se graba", () => {
  it("una fila completa con vehículo conocido", () => {
    const p = preparar([fila({ idOrigen: "A", matriculaNorm: "1234ABC" })],
      op({ vehiculos: [veh("1234ABC")] }));
    expect(p.insertar).toHaveLength(1);
    expect(p.insertar[0]).toMatchObject({
      empresa_id: "emp-1", vehiculo_id: "v-1234ABC", id_origen: "A",
      fecha: "2026-01-15", lote_id: "lote-1", fila_origen: 4, importado_por: "u-1",
      matricula_norm: "1234ABC", medida_neumatico_norm: "295/80R22.5",
    });
    expect(p.bloqueadas).toHaveLength(0);
    expect(p.saltadas).toHaveLength(0);
  });

  /**
   * El punto 2 de las comprobaciones: las de matrícula desconocida ENTRAN,
   * sin vincular. Son historia del centro y el vehículo puede darse de alta
   * mañana; dejarlas fuera sería perderlas.
   */
  it("una matrícula desconocida entra SIN vincular, no se bloquea", () => {
    const p = preparar([fila({ idOrigen: "A", matriculaNorm: "9999ZZZ" })], op());
    expect(p.insertar).toHaveLength(1);
    expect(p.insertar[0].vehiculo_id).toBeNull();
    expect(p.insertar[0].matricula_norm).toBe("9999ZZZ");
    expect(p.sinVehiculo).toBe(1);
    expect(p.bloqueadas).toHaveLength(0);
  });

  it("se conserva el nombre de cliente original de cada fila", () => {
    const p = preparar([
      fila({ idOrigen: "A", matriculaNorm: "1111AAA", clienteNombre: "CINTOI BUS S.L" }),
      fila({ idOrigen: "B", matriculaNorm: "2222BBB", clienteNombre: "PLANA" }),
    ], op({ empresa: "emp-plana" }));
    expect(p.insertar.map((f) => f.cliente_nombre_origen)).toEqual(["CINTOI BUS S.L", "PLANA"]);
    // …pero las dos van a la MISMA empresa, la elegida.
    expect(new Set(p.insertar.map((f) => f.empresa_id))).toEqual(new Set(["emp-plana"]));
  });
});

describe("qué se salta", () => {
  /** Punto 3: volver a pasar el mismo fichero no duplica nada. */
  it("lo ya importado se salta, y no es un error", () => {
    const p = preparar([fila({ idOrigen: "A", matriculaNorm: "1234ABC" })],
      op({ vehiculos: [veh("1234ABC")], yaImportados: new Set(["A"]) }));
    expect(p.insertar).toHaveLength(0);
    expect(p.saltadas).toEqual(["A"]);
    expect(p.bloqueadas).toHaveLength(0);
  });

  /** Punto 4: una exportación más larga trae solo lo nuevo. */
  it("de un fichero con lo viejo y lo nuevo, solo entra lo nuevo", () => {
    const p = preparar([
      fila({ idOrigen: "VIEJA1", matriculaNorm: "1111AAA" }),
      fila({ idOrigen: "VIEJA2", matriculaNorm: "2222BBB" }),
      fila({ idOrigen: "NUEVA1", matriculaNorm: "3333CCC" }),
    ], op({ yaImportados: new Set(["VIEJA1", "VIEJA2"]) }));
    expect(p.insertar.map((f) => f.id_origen)).toEqual(["NUEVA1"]);
    expect(p.saltadas).toEqual(["VIEJA1", "VIEJA2"]);
  });
});

describe("qué se bloquea, y se dice por qué", () => {
  it("sin fecha: la tabla no la admite y sin ella no cuenta para nada", () => {
    const p = preparar([fila({ idOrigen: "A", matriculaNorm: "1234ABC", fecha: null })], op());
    expect(p.insertar).toHaveLength(0);
    expect(p.bloqueadas[0]).toMatchObject({ fila_origen: 4, id_origen: "A" });
    expect(p.bloqueadas[0].motivo).toMatch(/Sin fecha/);
  });

  it("sin matrícula: no hay a quién vincular, ni ahora ni después", () => {
    const p = preparar([fila({ idOrigen: "A", matriculaNorm: "" })], op());
    expect(p.bloqueadas[0].motivo).toMatch(/Sin matrícula/);
  });

  it("sin identificador no se puede ni saber si ya está", () => {
    const p = preparar([fila({ idOrigen: "", matriculaNorm: "1234ABC" })], op());
    expect(p.bloqueadas[0].motivo).toMatch(/Sin identificador/);
  });

  it("una fila a medias pero con lo esencial SÍ entra", () => {
    const p = preparar([fila({
      idOrigen: "A", matriculaNorm: "1234ABC",
      numSensor: null, referencia: null, tecnico: null, observaciones: null,
    })], op());
    expect(p.insertar).toHaveLength(1);
  });

  it("se bloquea la fila, no el fichero: las demás entran", () => {
    const p = preparar([
      fila({ idOrigen: "A", matriculaNorm: "1111AAA" }),
      fila({ idOrigen: "B", matriculaNorm: "2222BBB", fecha: null }),
      fila({ idOrigen: "C", matriculaNorm: "3333CCC" }),
    ], op());
    expect(p.insertar.map((f) => f.id_origen)).toEqual(["A", "C"]);
    expect(p.bloqueadas).toHaveLength(1);
  });
});

describe("el kilometraje que baja", () => {
  const dos = (km1: number, km2: number) => [
    fila({ idOrigen: "A", matriculaNorm: "1234ABC", fecha: "2024-01-01", kmNuevo: km1 }),
    fila({ idOrigen: "B", matriculaNorm: "1234ABC", fecha: "2025-01-01", kmNuevo: km2 }),
  ];

  it("se marca la que baja, no la anterior", () => {
    expect(marcarKmSospechoso(dos(1_700_000, 760_000))).toEqual(new Set(["B"]));
  });

  it("si sube, ninguna", () => {
    expect(marcarKmSospechoso(dos(100_000, 180_000)).size).toBe(0);
  });

  it("la marca llega a la fila que se graba, y la fila entra igual", () => {
    const p = preparar(dos(1_700_000, 760_000), op({ vehiculos: [veh("1234ABC")] }));
    expect(p.insertar).toHaveLength(2);
    expect(p.insertar.find((f) => f.id_origen === "B")!.km_sospechoso).toBe(true);
    expect(p.insertar.find((f) => f.id_origen === "A")!.km_sospechoso).toBe(false);
  });

  it("vehículos distintos no se mezclan", () => {
    const m = marcarKmSospechoso([
      fila({ idOrigen: "A", matriculaNorm: "1111AAA", fecha: "2024-01-01", kmNuevo: 900_000 }),
      fila({ idOrigen: "B", matriculaNorm: "2222BBB", fecha: "2025-01-01", kmNuevo: 100_000 }),
    ]);
    expect(m.size).toBe(0);
  });
});

describe("lo que la preparación NO toca", () => {
  it("no hay ningún campo de montaje, neumático, eje ni km del vehículo", () => {
    const p = preparar([fila({ idOrigen: "A", matriculaNorm: "1234ABC" })],
      op({ vehiculos: [veh("1234ABC")] }));
    const campos = Object.keys(p.insertar[0]);
    for (const prohibido of ["montaje", "neumatico_id", "eje", "config_ejes_id",
                             "km_actual", "medida_id", "posicion"]) {
      expect(campos.filter((c) => c.includes(prohibido)), `aparece «${prohibido}»`).toEqual([]);
    }
  });
});
