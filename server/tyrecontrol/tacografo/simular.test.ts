import { describe, expect, it } from "vitest";
import { casoDeMedida, simular, type Entrada, type VehiculoRef } from "./simular.ts";
import type { FilaTacografo } from "./parser.ts";
import { REGLA_POR_DEFECTO } from "./vencimiento.ts";

const HOY = "2026-11-04";
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

const veh = (p: Partial<VehiculoRef> & { matriculaNorm: string }): VehiculoRef => ({
  id: `v-${p.matriculaNorm}`, matricula: p.matriculaNorm, bastidor: null, activo: true,
  medidaId: null, medida: null, ...p,
});

const sim = (p: Partial<Entrada> = {}) => simular({
  filas: [], problemas: [], vehiculos: [], yaImportados: new Set(),
  regla: REGLA_POR_DEFECTO, hoy: HOY, ...p,
});

describe("quién entra y quién no", () => {
  it("una matrícula conocida se vincula", () => {
    const s = sim({ filas: [fila({ idOrigen: "A", matriculaNorm: "1234ABC" })],
                    vehiculos: [veh({ matriculaNorm: "1234ABC" })] });
    expect(s.nuevas).toBe(1);
    expect(s.filas[0].vehiculoId).toBe("v-1234ABC");
    expect(s.vehiculosEncontrados).toBe(1);
  });

  /**
   * Lo que hace que pasar el mismo Excel dos veces no duplique nada, y que
   * una exportación más larga el mes que viene solo traiga lo nuevo.
   */
  it("un id ya importado sale como duplicada, no como nueva", () => {
    const s = sim({ filas: [fila({ idOrigen: "A", matriculaNorm: "1234ABC" })],
                    vehiculos: [veh({ matriculaNorm: "1234ABC" })],
                    yaImportados: new Set(["A"]) });
    expect(s.nuevas).toBe(0);
    expect(s.duplicadas).toBe(1);
  });

  it("si TODO está ya importado, se dice en vez de enseñar ceros", () => {
    const s = sim({ filas: [fila({ idOrigen: "A", matriculaNorm: "1234ABC" })],
                    vehiculos: [veh({ matriculaNorm: "1234ABC" })],
                    yaImportados: new Set(["A"]) });
    expect(s.avisos.join(" ")).toMatch(/ya está importado/i);
  });

  it("una matrícula desconocida entra sin vincular, y NO se crea el vehículo", () => {
    const s = sim({ filas: [fila({ idOrigen: "A", matriculaNorm: "9999ZZZ" })] });
    expect(s.sinVehiculo).toBe(1);
    expect(s.filas[0].vehiculoId).toBeNull();
    expect(s.matriculasSinVehiculo).toEqual(["9999ZZZ"]);
    expect(s.avisos.join(" ")).toMatch(/No se crean vehículos/i);
  });

  it("un vehículo de baja recibe su historia igual, avisando", () => {
    const s = sim({ filas: [fila({ idOrigen: "A", matriculaNorm: "1234ABC" })],
                    vehiculos: [veh({ matriculaNorm: "1234ABC", activo: false })] });
    expect(s.nuevas).toBe(1);
    expect(s.vehiculosInactivos).toBe(1);
    expect(s.avisos.join(" ")).toMatch(/dados de baja/i);
  });
});

describe("el bastidor", () => {
  it("si no casa, se vincula igual pero se dice", () => {
    const s = sim({
      filas: [fila({ idOrigen: "A", matriculaNorm: "1234ABC", bastidor: "VF1AAAA" })],
      vehiculos: [veh({ matriculaNorm: "1234ABC", bastidor: "WDB9999" })],
    });
    expect(s.filas[0].vehiculoId).toBe("v-1234ABC");
    expect(s.conflictosBastidor).toHaveLength(1);
    expect(s.filas[0].avisos.join(" ")).toMatch(/bastidor/i);
  });

  it("si uno de los dos no lo trae, no hay conflicto que inventar", () => {
    const s = sim({ filas: [fila({ idOrigen: "A", matriculaNorm: "1234ABC", bastidor: "VF1" })],
                    vehiculos: [veh({ matriculaNorm: "1234ABC", bastidor: null })] });
    expect(s.conflictosBastidor).toHaveLength(0);
  });
});

describe("las propuestas de medida", () => {
  const conMedida = (medidaVeh: string | null, medidaTac = "295/80R22.5") => sim({
    filas: [fila({ idOrigen: "A", matriculaNorm: "1234ABC", medidaNorm: medidaTac, medidaOrigen: medidaTac })],
    vehiculos: [veh({ matriculaNorm: "1234ABC", medida: medidaVeh, medidaId: medidaVeh ? "m1" : null })],
  });

  it("coincide: no se propone nada", () => {
    expect(conMedida("295/80R22.5").propuestas).toHaveLength(0);
  });

  it("sin medida: se propone, y es segura para aceptar en bloque", () => {
    const s = conMedida(null);
    expect(s.propuestasPorCaso.sin_medida).toBe(1);
    expect(s.propuestas[0].seguraParaBloque).toBe(true);
    expect(s.propuestas[0].medidaNorm).toBe("295/80R22.5");
  });

  /**
   * De las 55 diferencias del fichero real, 36 son solo esto. Ni se esconde
   * —el dato del tacógrafo dice C y el catálogo no— ni se trata como una
   * discrepancia que haya que ir a mirar.
   */
  it("solo el marcado C: caso propio, y NO entra en el aceptar todo", () => {
    const s = conMedida("225/75R16", "225/75R16C");
    expect(s.propuestasPorCaso.solo_marcado).toBe(1);
    expect(s.propuestas[0].seguraParaBloque).toBe(false);
  });

  it("discrepa de verdad: una a una, nunca en bloque", () => {
    const s = conMedida("315/80R22.5");
    expect(s.propuestasPorCaso.discrepa).toBe(1);
    expect(s.propuestas[0].seguraParaBloque).toBe(false);
    expect(s.propuestas[0].medidaActual).toBe("315/80R22.5");
  });

  it("sin vehículo no se propone nada que escribir", () => {
    const s = sim({ filas: [fila({ idOrigen: "A", matriculaNorm: "9999ZZZ" })] });
    expect(s.propuestasPorCaso.sin_vehiculo).toBe(1);
    expect(s.propuestas[0].vehiculoId).toBeNull();
    expect(s.propuestas[0].seguraParaBloque).toBe(false);
  });

  it("manda la medida MÁS RECIENTE, no la primera que aparezca", () => {
    const s = sim({
      filas: [
        fila({ idOrigen: "A", matriculaNorm: "1234ABC", fecha: "2023-01-01", medidaNorm: "315/80R22.5" }),
        fila({ idOrigen: "B", matriculaNorm: "1234ABC", fecha: "2026-01-01", medidaNorm: "295/80R22.5" }),
      ],
      vehiculos: [veh({ matriculaNorm: "1234ABC" })],
    });
    expect(s.propuestas).toHaveLength(1);
    expect(s.propuestas[0].medidaNorm).toBe("295/80R22.5");
    expect(s.propuestas[0].idOrigen).toBe("B");
  });

  it("una propuesta de un vehículo con avisos no se acepta en bloque", () => {
    const s = sim({
      filas: [fila({ idOrigen: "A", matriculaNorm: "1234ABC", bastidor: "VF1" })],
      vehiculos: [veh({ matriculaNorm: "1234ABC", bastidor: "OTRO" })],
    });
    expect(s.propuestas[0].caso).toBe("sin_medida");
    expect(s.propuestas[0].seguraParaBloque).toBe(false);
  });

  it("una medida ilegible no genera propuesta: no hay qué proponer", () => {
    const s = sim({
      filas: [fila({ idOrigen: "A", matriculaNorm: "1234ABC",
                     medidaOrigen: "la de siempre", medidaNorm: null, medidaSospechosa: true })],
      vehiculos: [veh({ matriculaNorm: "1234ABC" })],
    });
    expect(s.propuestas).toHaveLength(0);
    expect(s.filas[0].avisos.join(" ")).toMatch(/no se sabe leer/i);
  });
});

describe("casoDeMedida", () => {
  it("resuelve los cuatro casos", () => {
    expect(casoDeMedida("295/80R22.5", null, true).caso).toBe("sin_medida");
    expect(casoDeMedida("295/80R22.5", "295/80R22.5", true).caso).toBe("sin_medida");
    expect(casoDeMedida("225/75R16C", "225/75R16", true).caso).toBe("solo_marcado");
    expect(casoDeMedida("295/80R22.5", "315/80R22.5", true).caso).toBe("discrepa");
    expect(casoDeMedida("295/80R22.5", null, false).caso).toBe("sin_vehiculo");
  });
});

describe("el kilometraje", () => {
  const dos = (km1: number, km2: number) => sim({
    filas: [
      fila({ idOrigen: "A", matriculaNorm: "1234ABC", fecha: "2024-01-01", kmNuevo: km1 }),
      fila({ idOrigen: "B", matriculaNorm: "1234ABC", fecha: "2025-01-01", kmNuevo: km2 }),
    ],
    vehiculos: [veh({ matriculaNorm: "1234ABC" })],
  });

  it("si sube, no hay nada que decir", () => {
    expect(dos(100_000, 180_000).kmSospechosos).toHaveLength(0);
  });

  it("si baja, se marca pero la fila entra igual: puede ser un cambio de cuentakm", () => {
    const s = dos(1_700_000, 760_000);
    expect(s.kmSospechosos).toHaveLength(1);
    expect(s.kmSospechosos[0]).toMatchObject({ km: 760_000, kmAnterior: 1_700_000 });
    expect(s.nuevas).toBe(2);
    expect(s.avisos.join(" ")).toMatch(/no tocan el kilómetro actual/i);
  });

  it("el orden del fichero no importa: se mira por fecha", () => {
    const s = sim({
      filas: [
        fila({ idOrigen: "B", matriculaNorm: "1234ABC", fecha: "2025-01-01", kmNuevo: 760_000 }),
        fila({ idOrigen: "A", matriculaNorm: "1234ABC", fecha: "2024-01-01", kmNuevo: 1_700_000 }),
      ],
      vehiculos: [veh({ matriculaNorm: "1234ABC" })],
    });
    expect(s.kmSospechosos).toHaveLength(1);
  });

  it("las filas sin lectura no rompen la cadena", () => {
    const s = sim({
      filas: [
        fila({ idOrigen: "A", matriculaNorm: "1234ABC", fecha: "2024-01-01", kmNuevo: 100_000 }),
        fila({ idOrigen: "B", matriculaNorm: "1234ABC", fecha: "2024-06-01", kmNuevo: null }),
        fila({ idOrigen: "C", matriculaNorm: "1234ABC", fecha: "2025-01-01", kmNuevo: 120_000 }),
      ],
      vehiculos: [veh({ matriculaNorm: "1234ABC" })],
    });
    expect(s.kmSospechosos).toHaveLength(0);
  });
});

describe("los clientes del fichero", () => {
  it("se cuentan y se conservan, aunque todo vaya a una sola empresa", () => {
    const s = sim({
      filas: [
        fila({ idOrigen: "A", matriculaNorm: "1111AAA", clienteNombre: "PLANA" }),
        fila({ idOrigen: "B", matriculaNorm: "2222BBB", clienteNombre: "CINTOI BUS S.L" }),
        fila({ idOrigen: "C", matriculaNorm: "3333CCC", clienteNombre: "CINTOI BUS S.L" }),
      ],
    });
    expect(s.clientes).toEqual([
      { nombre: "CINTOI BUS S.L", filas: 2 },
      { nombre: "PLANA", filas: 1 },
    ]);
    expect(s.avisos.join(" ")).toMatch(/conservando el nombre original/i);
  });
});

describe("el vencimiento sale en la simulación", () => {
  it("cuenta los vehículos por estado", () => {
    const s = sim({
      filas: [
        fila({ idOrigen: "A", matriculaNorm: "1111AAA", fecha: "2026-01-01" }), // vigente
        fila({ idOrigen: "B", matriculaNorm: "2222BBB", fecha: "2022-01-01" }), // vencida
      ],
      vehiculos: [veh({ matriculaNorm: "1111AAA" }), veh({ matriculaNorm: "2222BBB" })],
    });
    expect(s.vencimientos.vigente).toBe(1);
    expect(s.vencimientos.vencida).toBe(1);
  });
});

describe("no escribe nada", () => {
  it("la simulación es una función: entra lo que entra y sale el informe", () => {
    const filas = [fila({ idOrigen: "A", matriculaNorm: "1234ABC" })];
    const vehiculos = [veh({ matriculaNorm: "1234ABC" })];
    const antes = JSON.stringify({ filas, vehiculos });
    simular({ filas, problemas: [], vehiculos, yaImportados: new Set(),
              regla: REGLA_POR_DEFECTO, hoy: HOY });
    expect(JSON.stringify({ filas, vehiculos })).toBe(antes);
  });
});
