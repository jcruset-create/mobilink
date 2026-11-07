import { describe, expect, it } from "vitest";
import {
  construirControl, datosTecnicos, fichaDe, filaDe, ordenarPorVencimiento,
  type IntervencionTac, type VehiculoTac,
} from "./control.ts";
import { REGLA_POR_DEFECTO, type Regla } from "./vencimiento.ts";

const HOY = "2026-11-05";
const CAL = "Calibrado o Parametrización / Control / Reparación";
const INS = "Instalación / Activación";
const TRA = "Transferencia / Certificado de intransferibilidad / Sustitución";

const regla = (p: Partial<Regla> = {}): Regla => ({ ...REGLA_POR_DEFECTO, ...p });

const i = (p: Partial<IntervencionTac> & { idOrigen: string; fecha: string }): IntervencionTac => ({
  id: `i-${p.idOrigen}`, vehiculoId: "v1", tipoOperacion: CAL, resultado: "Favorable",
  medidaNorm: null, medidaOrigen: null, kmNuevo: null, kmSospechoso: false,
  paramL: null, paramW: null, paramK: null, referencia: null, version: null,
  numSerie: null, numSensor: null, tipoTacografo: null, fabricante: null,
  tecnico: null, observaciones: null, ...p,
});

const veh = (p: Partial<VehiculoTac> & { id: string }): VehiculoTac => ({
  matricula: p.id.toUpperCase(), numeroUnidad: null, baseId: null, base: null,
  activo: true, ...p,
});

describe("el estado de un vehículo", () => {
  it("vigente, con la fecha y el tipo de la intervención que la fijó", () => {
    const f = filaDe(veh({ id: "v1" }),
      [i({ idOrigen: "A", fecha: "2025-06-10" }), i({ idOrigen: "B", fecha: "2026-03-20" })],
      regla(), HOY);
    expect(f.estado).toBe("vigente");
    expect(f.ultima).toBe("2026-03-20");
    expect(f.proxima).toBe("2028-03-20");
    expect(f.ultimoTipo).toBe(CAL);
    expect(f.intervenciones).toBe(2);
  });

  it("vencida cuenta los días de retraso en negativo", () => {
    const f = filaDe(veh({ id: "v1" }), [i({ idOrigen: "A", fecha: "2023-01-10" })], regla(), HOY);
    expect(f.estado).toBe("vencida");
    expect(f.diasRestantes).toBeLessThan(0);
  });

  it("sin intervenciones es «sin datos», no «vencida»", () => {
    const f = filaDe(veh({ id: "v1" }), [], regla(), HOY);
    expect(f.estado).toBe("sin_datos");
    expect(f.ultima).toBeNull();
    expect(f.ultimoTipo).toBeNull();
  });

  /**
   * Con un filtro de tipos, la última del histórico y la que fija la fecha
   * pueden no ser la misma. Enseñar la otra haría que el tipo que se lee al
   * lado no cuadrase con la fecha.
   */
  it("el tipo que se enseña es el de la que FIJÓ la fecha", () => {
    const f = filaDe(veh({ id: "v1" }), [
      i({ idOrigen: "A", fecha: "2026-01-10", tipoOperacion: CAL }),
      i({ idOrigen: "B", fecha: "2026-08-02", tipoOperacion: TRA, resultado: "-----" }),
    ], regla({ tiposReinician: [CAL, INS] }), HOY);
    expect(f.ultima).toBe("2026-01-10");
    expect(f.ultimoTipo).toBe(CAL);
  });
});

describe("los datos técnicos", () => {
  /**
   * El caso real: la última intervención es una transferencia que no trae
   * número de serie. Dejarlo vacío escondería un dato que existe.
   */
  it("toma el valor más reciente de CADA campo, no los de la última", () => {
    const t = datosTecnicos([
      i({ idOrigen: "A", fecha: "2025-02-01", numSerie: "944005", fabricante: "VDO", paramK: "11076" }),
      i({ idOrigen: "B", fecha: "2026-07-14", tipoOperacion: TRA, resultado: "-----" }),
    ]);
    expect(t.numSerie).toEqual({ valor: "944005", fecha: "2025-02-01", idOrigen: "A" });
    expect(t.fabricante!.valor).toBe("VDO");
    expect(t.paramK!.valor).toBe("11076");
  });

  it("gana el más reciente cuando el campo viene en varias", () => {
    const t = datosTecnicos([
      i({ idOrigen: "A", fecha: "2024-01-01", numSerie: "VIEJO" }),
      i({ idOrigen: "B", fecha: "2026-01-01", numSerie: "NUEVO" }),
    ]);
    expect(t.numSerie).toEqual({ valor: "NUEVO", fecha: "2026-01-01", idOrigen: "B" });
  });

  it("cada valor lleva la fecha de la que sale: un nº de serie sin fecha no dice nada", () => {
    const t = datosTecnicos([i({ idOrigen: "A", fecha: "2026-04-14", numSerie: "944005" })]);
    expect(t.numSerie!.fecha).toBe("2026-04-14");
  });

  it("un campo que nunca se informó queda a null", () => {
    const t = datosTecnicos([i({ idOrigen: "A", fecha: "2026-01-01" })]);
    expect(t.numSerie).toBeNull();
    expect(t.medida).toBeNull();
  });

  it("una cadena vacía no es un valor", () => {
    const t = datosTecnicos([
      i({ idOrigen: "B", fecha: "2026-05-01", numSerie: "   " }),
      i({ idOrigen: "A", fecha: "2024-01-01", numSerie: "944005" }),
    ]);
    expect(t.numSerie!.valor).toBe("944005");
  });

  it("la medida sale normalizada si la hay, y en crudo si no", () => {
    expect(datosTecnicos([i({ idOrigen: "A", fecha: "2026-01-01",
      medidaNorm: "295/80R22.5", medidaOrigen: "295/80 R22,5" })]).medida!.valor).toBe("295/80R22.5");
    expect(datosTecnicos([i({ idOrigen: "A", fecha: "2026-01-01",
      medidaNorm: null, medidaOrigen: "la de siempre" })]).medida!.valor).toBe("la de siempre");
  });
});

describe("el orden", () => {
  it("vencidos, luego próximos, luego vigentes, y los sin datos al final", () => {
    const filas = ordenarPorVencimiento([
      { ...filaDe(veh({ id: "d" }), [], regla(), HOY) },
      { ...filaDe(veh({ id: "a" }), [i({ idOrigen: "1", fecha: "2020-01-01" })], regla(), HOY) },
      { ...filaDe(veh({ id: "c" }), [i({ idOrigen: "2", fecha: "2026-06-01" })], regla(), HOY) },
      { ...filaDe(veh({ id: "b" }), [i({ idOrigen: "3", fecha: "2024-12-20" })], regla(), HOY) },
    ]);
    expect(filas.map((f) => f.estado))
      .toEqual(["vencida", "proxima", "vigente", "sin_datos"]);
  });

  it("dentro del mismo estado, el que lleva más retraso primero", () => {
    const filas = ordenarPorVencimiento([
      filaDe(veh({ id: "poco" }), [i({ idOrigen: "1", fecha: "2024-10-01" })], regla(), HOY),
      filaDe(veh({ id: "mucho" }), [i({ idOrigen: "2", fecha: "2020-01-01" })], regla(), HOY),
    ]);
    expect(filas.map((f) => f.matricula)).toEqual(["MUCHO", "POCO"]);
  });
});

describe("la pantalla de control", () => {
  const flota = [
    veh({ id: "v1", matricula: "1111AAA", numeroUnidad: "10", baseId: "b1", base: "Tarragona" }),
    veh({ id: "v2", matricula: "2222BBB", numeroUnidad: "20", baseId: "b2", base: "Reus" }),
    veh({ id: "v3", matricula: "3333CCC", numeroUnidad: "30", baseId: "b1", base: "Tarragona" }),
    veh({ id: "v4", matricula: "4444DDD", activo: false }),
  ];
  const interv = [
    i({ idOrigen: "A", fecha: "2020-01-01", vehiculoId: "v1" }),   // vencida
    i({ idOrigen: "B", fecha: "2026-06-01", vehiculoId: "v2" }),   // vigente
    i({ idOrigen: "C", fecha: "2024-12-20", vehiculoId: "v3" }),   // próxima
    i({ idOrigen: "D", fecha: "2026-01-01", vehiculoId: "v4" }),
  ];

  it("por defecto deja fuera los de baja", () => {
    const c = construirControl(flota, interv, regla(), HOY);
    expect(c.total).toBe(3);
    expect(c.filas.map((f) => f.matricula)).toEqual(["1111AAA", "3333CCC", "2222BBB"]);
  });

  it("se pueden incluir los de baja si se pide", () => {
    expect(construirControl(flota, interv, regla(), HOY, { incluirBaja: true }).total).toBe(4);
  });

  /**
   * Si el resumen se calculara sobre lo filtrado, al elegir una base el
   * contador de vencidos bajaría y parecería que se han arreglado solos.
   */
  it("el resumen NO se encoge al filtrar", () => {
    const todo = construirControl(flota, interv, regla(), HOY);
    const unaBase = construirControl(flota, interv, regla(), HOY, { baseId: "b2" });
    expect(unaBase.resumen).toEqual(todo.resumen);
    expect(unaBase.mostrados).toBe(1);
    expect(unaBase.total).toBe(3);
  });

  it("filtra por base", () => {
    const c = construirControl(flota, interv, regla(), HOY, { baseId: "b1" });
    expect(c.filas.map((f) => f.matricula)).toEqual(["1111AAA", "3333CCC"]);
  });

  it("filtra por estado", () => {
    const c = construirControl(flota, interv, regla(), HOY, { estados: ["vencida"] });
    expect(c.filas.map((f) => f.matricula)).toEqual(["1111AAA"]);
  });

  it("filtra por matrícula y por número de unidad, sin distinguir formato", () => {
    expect(construirControl(flota, interv, regla(), HOY, { texto: "2222-bbb" })
      .filas.map((f) => f.matricula)).toEqual(["2222BBB"]);
    expect(construirControl(flota, interv, regla(), HOY, { texto: "30" })
      .filas.map((f) => f.matricula)).toEqual(["3333CCC"]);
  });

  it("filtra por fecha de vencimiento", () => {
    // v1 vence 2022-01-01 y v3 el 2026-12-20; v2, en 2028.
    const c = construirControl(flota, interv, regla(), HOY, { venceAntesDe: "2027-01-01" });
    expect(c.filas.map((f) => f.matricula)).toEqual(["1111AAA", "3333CCC"]);
  });

  it("un vehículo sin tacógrafo no desaparece: sale como «sin datos»", () => {
    const c = construirControl([...flota, veh({ id: "v9", matricula: "9999ZZZ" })], interv, regla(), HOY);
    expect(c.filas.find((f) => f.matricula === "9999ZZZ")?.estado).toBe("sin_datos");
    expect(c.resumen.sin_datos).toBe(1);
  });

  it("una intervención sin vehículo no cuenta para nadie", () => {
    const c = construirControl(flota,
      [...interv, i({ idOrigen: "Z", fecha: "2026-10-01", vehiculoId: null })], regla(), HOY);
    expect(c.filas.reduce((s, f) => s + f.intervenciones, 0)).toBe(3);
  });

  it("sin flota devuelve ceros, no un fallo", () => {
    const c = construirControl([], [], regla(), HOY);
    expect(c).toMatchObject({ total: 0, mostrados: 0, filas: [] });
    expect(c.resumen).toEqual({ vigente: 0, proxima: 0, vencida: 0, sin_datos: 0 });
  });
});

/**
 * La condición que pediste: la ficha y la pantalla no pueden discrepar. No se
 * comprueba leyendo las dos, se comprueba porque la ficha ES una fila de la
 * lista.
 */
describe("la ficha y el control salen del mismo cálculo", () => {
  const v = veh({ id: "v1", matricula: "1111AAA", baseId: "b1", base: "Tarragona" });
  const hist = [
    i({ idOrigen: "A", fecha: "2024-05-10", numSerie: "944005" }),
    i({ idOrigen: "B", fecha: "2026-02-18", paramK: "11076" }),
  ];

  it("la fila de la ficha es idéntica a la de la pantalla", () => {
    const ficha = fichaDe(v, hist, regla(), HOY);
    const control = construirControl([v], hist, regla(), HOY);
    expect(ficha.fila).toEqual(control.filas[0]);
  });

  it("el histórico va de la más nueva a la más vieja", () => {
    expect(fichaDe(v, hist, regla(), HOY).historico.map((h) => h.idOrigen)).toEqual(["B", "A"]);
  });

  it("y trae los datos técnicos de todo el histórico, no solo de la última", () => {
    const t = fichaDe(v, hist, regla(), HOY).tecnicos;
    expect(t.numSerie!.valor).toBe("944005");
    expect(t.paramK!.valor).toBe("11076");
  });
});

/*
 * La generación va en la fila de la flota porque la pregunta que se hace con
 * ella es de flota: cuántos autobuses llevan todavía un digital del
 * reglamento viejo.
 */
describe("la generación del tacógrafo en la fila", () => {
  it("sale de la versión, y de la intervención más reciente que la traía", () => {
    const f = filaDe(veh({ id: "v1" }), [
      i({ idOrigen: "A", fecha: "2026-11-04", version: null, fabricante: null }),
      i({ idOrigen: "B", fecha: "2026-05-01", version: "41026", fabricante: "VDO" }),
    ], regla(), HOY);
    expect(f.generacion.generacion).toBe("inteligente_v2");
    expect(f.generacion.etiqueta).toBe("DTCO 4.1 · inteligente 2.ª gen.");
  });

  it("sin ninguna versión en el histórico, desconocida", () => {
    const f = filaDe(veh({ id: "v1" }), [i({ idOrigen: "A", fecha: "2026-05-01" })], regla(), HOY);
    expect(f.generacion.generacion).toBe("desconocida");
  });

  // Y sigue cumpliéndose lo de siempre: la ficha y el control dicen lo mismo,
  // porque salen de la misma función.
  it("la ficha dice exactamente lo mismo que la flota", () => {
    const is = [i({ idOrigen: "A", fecha: "2026-05-01", version: "30041", fabricante: "VDO" })];
    expect(fichaDe(veh({ id: "v1" }), is, regla(), HOY).fila.generacion)
      .toEqual(filaDe(veh({ id: "v1" }), is, regla(), HOY).generacion);
  });
});

describe("filtrar la flota por generación", () => {
  const flota = () => construirControl(
    [veh({ id: "v1" }), veh({ id: "v2" }), veh({ id: "v3" }), veh({ id: "v4" })],
    [
      i({ idOrigen: "A", fecha: "2026-05-01", vehiculoId: "v1", version: "30041", fabricante: "VDO" }),
      i({ idOrigen: "B", fecha: "2026-05-01", vehiculoId: "v2", version: "40042", fabricante: "VDO" }),
      i({ idOrigen: "C", fecha: "2026-05-01", vehiculoId: "v3", version: "41026", fabricante: "VDO" }),
      i({ idOrigen: "D", fecha: "2026-05-01", vehiculoId: "v4", version: null }),
    ],
    regla(), HOY, {});

  it("cuenta la flota por generación", () => {
    expect(flota().porGeneracion).toEqual({
      digital: 1, inteligente_v1: 1, inteligente_v2: 1, desconocida: 1,
    });
  });

  // La pregunta real: cuántos autobuses llevan todavía un digital del
  // reglamento viejo, para saber cuántos hay que renovar.
  it("se puede uno quedar solo con los digitales", () => {
    const c = construirControl(
      [veh({ id: "v1" }), veh({ id: "v2" })],
      [
        i({ idOrigen: "A", fecha: "2026-05-01", vehiculoId: "v1", version: "30041", fabricante: "VDO" }),
        i({ idOrigen: "B", fecha: "2026-05-01", vehiculoId: "v2", version: "41026", fabricante: "VDO" }),
      ],
      regla(), HOY, { generaciones: ["digital"] });
    expect(c.filas.map((f) => f.vehiculoId)).toEqual(["v1"]);
  });

  /*
   * Y el recuento NO se encoge al filtrar, igual que el de estados: si al
   * quedarse con los digitales el contador dijera «1 inteligente», parecería
   * que los otros han desaparecido.
   */
  it("pero el recuento sigue siendo el de la flota entera", () => {
    const c = construirControl(
      [veh({ id: "v1" }), veh({ id: "v2" })],
      [
        i({ idOrigen: "A", fecha: "2026-05-01", vehiculoId: "v1", version: "30041", fabricante: "VDO" }),
        i({ idOrigen: "B", fecha: "2026-05-01", vehiculoId: "v2", version: "41026", fabricante: "VDO" }),
      ],
      regla(), HOY, { generaciones: ["digital"] });
    expect(c.filas).toHaveLength(1);
    expect(c.porGeneracion.inteligente_v2).toBe(1);
    expect(c.total).toBe(2);
  });

  it("sin filtro de generación, salen todos", () => {
    expect(flota().filas).toHaveLength(4);
  });
});
