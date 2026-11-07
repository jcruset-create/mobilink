import { describe, expect, it } from "vitest";
import {
  aFilaInsert, marcarKmSospechoso, parcheParaCompletar, preparar,
  type OpcionesPreparar,
} from "./importar.ts";
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

describe("aFilaInsert(), el único mapeo de fila a columna", () => {
  /*
   * Está fuera de `preparar()` porque hay DOS caminos que acaban en la misma
   * tabla: el Excel del centro y el informe técnico en PDF. Con dos mapeos, el
   * día que se añada una columna se añadiría en uno y no en el otro.
   */
  it("la misma fila da la misma columna por los dos caminos", () => {
    const f = fila({ idOrigen: "A1", matriculaNorm: "1234ABC" });
    const porExcel = aFilaInsert(f, {
      empresa: "emp-1", sistemaOrigen: "informe_intervenciones", vehiculoId: "v-1",
      loteId: "lote-1", archivo: "taco.xlsx", hoja: "Hoja1", usuarioId: "u-1",
      kmSospechoso: false,
    });
    const porPdf = aFilaInsert(f, {
      empresa: "emp-1", sistemaOrigen: "informe_intervenciones", vehiculoId: "v-1",
      loteId: null, archivo: "InfTec_A1.pdf", hoja: null, usuarioId: "u-1",
      kmSospechoso: false, creadaDePdf: true,
    });
    // Todo lo que describe la intervención es idéntico; lo que cambia es de
    // dónde vino.
    expect(porPdf.medida_neumatico_norm).toBe(porExcel.medida_neumatico_norm);
    expect(porPdf.resultado).toBe(porExcel.resultado);
    expect(porPdf.tipo_operacion).toBe(porExcel.tipo_operacion);
    expect(porExcel.lote_id).toBe("lote-1");
    expect(porExcel.creada_de_pdf).toBe(false);
    expect(porPdf.lote_id).toBeNull();
    expect(porPdf.creada_de_pdf).toBe(true);
  });

  // La clave es la misma por los dos caminos, y de eso vive que el Excel no
  // pueda duplicar lo que creó un PDF.
  it("el sistema_origen NO cambia por venir de un PDF", () => {
    const porPdf = aFilaInsert(fila({ idOrigen: "A1", matriculaNorm: "1234ABC" }), {
      empresa: "emp-1", sistemaOrigen: "informe_intervenciones", vehiculoId: "v-1",
      loteId: null, archivo: null, hoja: null, usuarioId: null,
      kmSospechoso: false, creadaDePdf: true,
    });
    expect(porPdf.sistema_origen).toBe("informe_intervenciones");
  });
});

describe("el Excel completa lo que creó un PDF", () => {
  const nueva = () => aFilaInsert(
    fila({ idOrigen: "A1", matriculaNorm: "1234ABC", version: "30041", numSensor: "15105011" }), {
      empresa: "emp-1", sistemaOrigen: "informe_intervenciones", vehiculoId: "v-1",
      loteId: "lote-9", archivo: "taco.xlsx", hoja: "Hoja1", usuarioId: "u-1",
      kmSospechoso: true,
    });

  it("se preparan para completar, no se saltan en silencio", () => {
    const f = fila({ idOrigen: "A1", matriculaNorm: "1234ABC" });
    const prep = preparar([f], op({
      vehiculos: [veh("1234ABC")],
      yaImportados: new Set(["A1"]),
      creadasDePdf: new Set(["A1"]),
    }));
    expect(prep.insertar).toHaveLength(0);
    expect(prep.saltadas).toEqual(["A1"]);
    expect(prep.completar.map((c) => c.idOrigen)).toEqual(["A1"]);
  });

  it("una que ya estaba del Excel sí se salta del todo", () => {
    const prep = preparar([fila({ idOrigen: "A1", matriculaNorm: "1234ABC" })], op({
      vehiculos: [veh("1234ABC")], yaImportados: new Set(["A1"]), creadasDePdf: new Set(),
    }));
    expect(prep.saltadas).toEqual(["A1"]);
    expect(prep.completar).toEqual([]);
  });

  // El impreso no trae la versión de software de las unidades VDO: ese hueco
  // es justo lo que viene a rellenar el Excel.
  it("rellena lo que estaba a null", () => {
    const parche = parcheParaCompletar({ version: null, num_sensor: null }, nueva());
    expect(parche.version).toBe("30041");
    expect(parche.num_sensor).toBe("15105011");
    expect(parche.creada_de_pdf).toBe(false);
  });

  /*
   * Y NO pisa lo que ya tenía valor. Si el Excel dice una cosa y la fila otra,
   * no es trabajo de un importador decidir cuál es la buena: pisarlo borraría
   * la evidencia sin que nadie se enterara.
   */
  it("pero no pisa lo que ya tenía valor, aunque sea distinto", () => {
    const parche = parcheParaCompletar({ version: "OTRA", resultado: "Favorable" }, nueva());
    expect(parche.version).toBeUndefined();
    expect(parche.resultado).toBeUndefined();
  });

  // La vinculación puede haberla hecho una persona a mano, igual que protege
  // `deshacer.ts`. Y la identidad, por razones obvias.
  it("nunca toca el vehículo ni la identidad de la fila", () => {
    const parche = parcheParaCompletar(
      { vehiculo_id: null, empresa_id: null, id_origen: null, sistema_origen: null }, nueva());
    expect(parche).not.toHaveProperty("vehiculo_id");
    expect(parche).not.toHaveProperty("empresa_id");
    expect(parche).not.toHaveProperty("id_origen");
    expect(parche).not.toHaveProperty("sistema_origen");
  });

  /*
   * Y sí manda en la trazabilidad y en las sospechas. `km_sospechoso` se
   * decide comparando con las lecturas anteriores del mismo vehículo, y un
   * PDF suelto no tiene con qué comparar: el Excel sí.
   */
  it("la trazabilidad y las sospechas pasan a ser las del Excel", () => {
    const parche = parcheParaCompletar(
      { lote_id: null, fila_origen: 1, km_sospechoso: false, archivo_nombre: "InfTec.pdf" }, nueva());
    expect(parche.lote_id).toBe("lote-9");
    expect(parche.fila_origen).toBe(4);
    expect(parche.km_sospechoso).toBe(true);
    expect(parche.archivo_nombre).toBe("taco.xlsx");
  });
});
