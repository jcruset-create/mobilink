import { describe, it, expect } from "vitest";
import {
  ejesDeTipo, medidaDeTipo, codigoPosicion, senasPosicion, fechaHora, leerCheckpoint, filtrarNuevas,
  esAdjuntoInforme,
} from "./checkpoint";

// Una fila del informe tal cual sale del Excel del arco.
const fila = (o: Partial<Record<string, any>>) => ({
  "Matrícula": "0008JDJ",
  "ID de flota": "1590",
  "Tipo de vehículo": "BUS 2X4 22,5",
  "Estado": "Measured",
  "Fecha de la última medición": new Date(2026, 7, 5),
  "Hora de la última medición": "13:14:52",
  "Eje": 1,
  "Posición de la rueda": "Exterior izquierda",
  "Presión medida [bar]": 8.7,
  "Profundidad de la banda de rodadura medida [mm]": 5.2,
  ...o,
});

describe("ejesDeTipo", () => {
  it("saca la configuración del nombre del tipo", () => {
    expect(ejesDeTipo("BUS 2x4x2 295-80R22.5")).toEqual([2, 4, 2]);
    expect(ejesDeTipo("BUS 2X4 22,5")).toEqual([2, 4]);
    expect(ejesDeTipo("BUS 2x4x4 315-80R22.5")).toEqual([2, 4, 4]);
    expect(ejesDeTipo("2x2 turismos")).toEqual([2, 2]);
  });
  it("un nombre sin configuración no se inventa", () => {
    expect(ejesDeTipo("Autobús urbano")).toEqual([]);
    expect(ejesDeTipo("")).toEqual([]);
  });
});

describe("medidaDeTipo", () => {
  it("el arco escribe la medida con guion", () => {
    expect(medidaDeTipo("BUS 2x4x2 295-80R22.5")).toBe("295/80R22.5");
    expect(medidaDeTipo("BUS 2x4x4 315-80R22.5")).toBe("315/80R22.5");
  });
  it("cuando solo dice la llanta, no hay medida", () => {
    // "BUS 2X4 22,5" da el diámetro, no la medida: no vale para nada.
    expect(medidaDeTipo("BUS 2X4 22,5")).toBeNull();
    expect(medidaDeTipo("BUS 2x4 17,5-19,5")).toBeNull();
  });
});

describe("codigoPosicion", () => {
  it("eje de rueda simple", () => {
    expect(codigoPosicion(1, "Exterior izquierda", 2)).toBe("E1_IZQ");
    expect(codigoPosicion(1, "Exterior derecha", 2)).toBe("E1_DER");
  });

  it("eje gemelo", () => {
    expect(codigoPosicion(2, "Exterior izquierda", 4)).toBe("E2_IZQ_EXT");
    expect(codigoPosicion(2, "Interior izquierda", 4)).toBe("E2_IZQ_INT");
    expect(codigoPosicion(2, "Interior derecha", 4)).toBe("E2_DER_INT");
    expect(codigoPosicion(2, "Exterior derecha", 4)).toBe("E2_DER_EXT");
  });

  it("la rueda única del tercer eje viene en el hueco Interior", () => {
    // Éste es el detalle que rompe todo si se numeran las posiciones por
    // orden de fila: en un 2x4x2 el arco manda cuatro huecos para el eje 3 y
    // la rueda de verdad está en el interior.
    expect(codigoPosicion(3, "Interior izquierda", 2)).toBe("E3_IZQ");
    expect(codigoPosicion(3, "Interior derecha", 2)).toBe("E3_DER");
  });
});

describe("fechaHora", () => {
  it("junta la fecha y la hora", () => {
    const d = fechaHora(new Date(2026, 7, 5), "13:14:52")!;
    expect(d.getFullYear()).toBe(2026);
    expect(d.getHours()).toBe(13);
    expect(d.getMinutes()).toBe(14);
    expect(d.getSeconds()).toBe(52);
  });
  // El libro se lee con cellDates: una celda con formato de hora NO llega
  // como texto. Este test se escribió con la cadena "13:14:52" y por eso pasó
  // mientras en producción todas las mediciones se guardaban a medianoche.
  it("acepta la hora como Date, que es como la manda Excel", () => {
    const d = fechaHora(new Date(2026, 7, 5), new Date(1899, 11, 30, 13, 14, 52))!;
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(7);
    expect(d.getDate()).toBe(5);
    expect(d.getHours()).toBe(13);
    expect(d.getMinutes()).toBe(14);
    expect(d.getSeconds()).toBe(52);
  });
  it("acepta la hora como fracción de día de Excel", () => {
    const d = fechaHora(new Date(2026, 7, 5), 0.5)!;
    expect(d.getHours()).toBe(12);
    expect(d.getMinutes()).toBe(0);
  });
  it("sin hora se queda a medianoche, no se inventa", () => {
    expect(fechaHora(new Date(2026, 7, 5), "N/A")!.getHours()).toBe(0);
  });
  it("sin fecha no hay momento", () => {
    expect(fechaHora("N/A", "13:14:52")).toBeNull();
    expect(fechaHora(null, null)).toBeNull();
  });
});

describe("leerCheckpoint", () => {
  it("traduce un autobús de 6 ruedas entero", () => {
    const filas = [
      fila({ "Eje": 1, "Posición de la rueda": "Exterior izquierda" }),
      fila({ "Eje": 1, "Posición de la rueda": "Exterior derecha" }),
      fila({ "Eje": 2, "Posición de la rueda": "Exterior izquierda" }),
      fila({ "Eje": 2, "Posición de la rueda": "Interior izquierda" }),
      fila({ "Eje": 2, "Posición de la rueda": "Interior derecha" }),
      fila({ "Eje": 2, "Posición de la rueda": "Exterior derecha" }),
    ];
    const r = leerCheckpoint(filas);
    expect(r.filas.map((f) => f.codigoPosicion)).toEqual([
      "E1_IZQ", "E1_DER", "E2_IZQ_EXT", "E2_IZQ_INT", "E2_DER_INT", "E2_DER_EXT",
    ]);
    expect(r.avisos).toEqual([]);
    expect(r.vehiculos[0].ruedasMedidas).toBe(6);
  });

  it("los huecos del tercer eje de un 2x4x2 no entran", () => {
    // El arco manda diez filas; dos son huecos que nunca traen dato.
    const base = { "Tipo de vehículo": "BUS 2x4x2 295-80R22.5" };
    const hueco = { ...base, "Presión medida [bar]": "N/A", "Profundidad de la banda de rodadura medida [mm]": "N/A" };
    const filas = [
      fila({ ...base, "Eje": 1, "Posición de la rueda": "Exterior izquierda" }),
      fila({ ...base, "Eje": 1, "Posición de la rueda": "Exterior derecha" }),
      fila({ ...base, "Eje": 2, "Posición de la rueda": "Exterior izquierda" }),
      fila({ ...base, "Eje": 2, "Posición de la rueda": "Interior izquierda" }),
      fila({ ...base, "Eje": 2, "Posición de la rueda": "Interior derecha" }),
      fila({ ...base, "Eje": 2, "Posición de la rueda": "Exterior derecha" }),
      fila({ ...hueco, "Eje": 3, "Posición de la rueda": "Exterior izquierda" }),
      fila({ ...base, "Eje": 3, "Posición de la rueda": "Interior izquierda" }),
      fila({ ...base, "Eje": 3, "Posición de la rueda": "Interior derecha" }),
      fila({ ...hueco, "Eje": 3, "Posición de la rueda": "Exterior derecha" }),
    ];
    const r = leerCheckpoint(filas);
    expect(r.filas).toHaveLength(8);
    expect(r.filas.slice(6).map((f) => f.codigoPosicion)).toEqual(["E3_IZQ", "E3_DER"]);
  });

  it("un 2x4x4 sí usa las cuatro del tercer eje", () => {
    const base = { "Tipo de vehículo": "BUS 2x4x4 315-80R22.5" };
    const filas = ["Exterior izquierda", "Interior izquierda", "Interior derecha", "Exterior derecha"]
      .map((p) => fila({ ...base, "Eje": 3, "Posición de la rueda": p }));
    const r = leerCheckpoint(filas);
    expect(r.filas.map((f) => f.codigoPosicion)).toEqual([
      "E3_IZQ_EXT", "E3_IZQ_INT", "E3_DER_INT", "E3_DER_EXT",
    ]);
  });

  it("el estado no decide: manda si hay valor", () => {
    const r = leerCheckpoint([
      // "Awaiting Measurement" con medición vieja: entra.
      fila({ "Estado": "Awaiting Measurement", "Fecha de la última medición": new Date(2025, 8, 20) }),
      // "Measured" sin dato: no entra.
      fila({
        "Estado": "Measured", "Eje": 1, "Posición de la rueda": "Exterior derecha",
        "Presión medida [bar]": "N/A", "Profundidad de la banda de rodadura medida [mm]": "N/A",
      }),
    ]);
    expect(r.filas).toHaveLength(1);
    expect(r.filas[0].codigoPosicion).toBe("E1_IZQ");
  });

  it("una rueda con solo presión (sin profundidad) también cuenta", () => {
    const r = leerCheckpoint([
      fila({ "Profundidad de la banda de rodadura medida [mm]": "N/A" }),
    ]);
    expect(r.filas).toHaveLength(1);
    expect(r.filas[0].profundidadMm).toBeNull();
    expect(r.filas[0].presionBar).toBe(8.7);
  });

  it("los que no han cruzado nunca se listan aparte, no se pierden", () => {
    const r = leerCheckpoint([
      fila({
        "Matrícula": "0020KFW", "Estado": "Awaiting Measurement",
        "Fecha de la última medición": "N/A", "Hora de la última medición": "N/A",
        "Presión medida [bar]": "N/A", "Profundidad de la banda de rodadura medida [mm]": "N/A",
      }),
    ]);
    expect(r.filas).toHaveLength(0);
    expect(r.sinMedir).toEqual(["0020KFW"]);
    expect(r.vehiculos).toHaveLength(1); // se conoce el vehículo aunque no se haya medido
  });

  it("un tipo que no dice su configuración se salta con aviso", () => {
    const r = leerCheckpoint([fila({ "Tipo de vehículo": "Autobús raro" })]);
    expect(r.filas).toHaveLength(0);
    expect(r.avisos[0]).toContain("configuración de ejes");
  });
});

describe("filtrarNuevas", () => {
  const f = (matricula: string, t: Date) => ({
    matricula, idFlota: null, tipoCheckpoint: "BUS 2X4 22,5", ejes: [2, 4],
    codigoPosicion: "E1_IZQ", eje: 1, lado: "izq" as const, interiorExterior: null,
    medidoAt: t, profundidadMm: 5, presionBar: 8,
  });

  it("lo ya cargado no se vuelve a importar", () => {
    // El informe es una foto: cada semana reenvía la misma medición vieja de
    // los que no han vuelto a cruzar.
    const filas = [f("AAA", new Date(2026, 7, 5)), f("BBB", new Date(2026, 7, 10))];
    const ya = new Map([["AAA", new Date(2026, 7, 5)], ["BBB", new Date(2026, 7, 3)]]);
    const r = filtrarNuevas(filas, ya);
    expect(r.nuevas.map((x) => x.matricula)).toEqual(["BBB"]);
    expect(r.yaEstaban).toEqual(["AAA"]);
  });

  it("un vehículo sin nada guardado entra entero", () => {
    const r = filtrarNuevas([f("CCC", new Date(2026, 7, 5))], new Map());
    expect(r.nuevas).toHaveLength(1);
  });

  it("una medición del mismo día pero más tarde sí es nueva", () => {
    // Por eso hace falta la hora y no basta la fecha: un autobús puede cruzar
    // el arco dos veces en un día.
    const r = filtrarNuevas(
      [f("DDD", new Date(2026, 7, 5, 18, 30))],
      new Map([["DDD", new Date(2026, 7, 5, 9, 0)]]),
    );
    expect(r.nuevas).toHaveLength(1);
  });

  it("sin momento no se puede saber si es nueva: fuera", () => {
    const sinFecha = { ...f("EEE", new Date()), medidoAt: null };
    expect(filtrarNuevas([sinFecha], new Map()).nuevas).toHaveLength(0);
  });
});

describe("senasPosicion — el fallo de los 116 avisos", () => {
  // La búsqueda por código dejaba fuera a turismos y furgonetas: los tipos
  // sembrados en la Fase 3 llaman DEL_IZQ y TRAS_IZQ a lo que
  // generarPosiciones() llama E1_IZQ y E2_IZQ. Las señas (eje, lado,
  // interior/exterior) son las mismas se llame como se llame la posición, y
  // son las que permiten casar una con otra.
  it("da las señas además del código", () => {
    expect(senasPosicion(1, "Exterior izquierda", 2))
      .toEqual({ codigo: "E1_IZQ", lado: "izq", interiorExterior: null });
    expect(senasPosicion(2, "Exterior derecha", 2))
      .toEqual({ codigo: "E2_DER", lado: "der", interiorExterior: null });
  });

  it("en un eje gemelo distingue interior de exterior", () => {
    expect(senasPosicion(2, "Interior izquierda", 4))
      .toEqual({ codigo: "E2_IZQ_INT", lado: "izq", interiorExterior: "int" });
    expect(senasPosicion(2, "Exterior izquierda", 4))
      .toEqual({ codigo: "E2_IZQ_EXT", lado: "izq", interiorExterior: "ext" });
  });

  it("las señas casan con DEL_IZQ y TRAS_IZQ, que es de lo que se trata", () => {
    // Así están sembradas turismo y furgoneta en la Fase 3.
    const posiciones = [
      { codigo_posicion: "DEL_IZQ", eje: 1, lado: "izq", interior_exterior: null },
      { codigo_posicion: "DEL_DER", eje: 1, lado: "der", interior_exterior: null },
      { codigo_posicion: "TRAS_IZQ", eje: 2, lado: "izq", interior_exterior: null },
      { codigo_posicion: "TRAS_DER", eje: 2, lado: "der", interior_exterior: null },
    ];
    const buscar = (eje: number, texto: string) => {
      const s = senasPosicion(eje, texto, 2)!;
      return posiciones.find((p) => p.eje === eje && p.lado === s.lado
        && p.interior_exterior === s.interiorExterior)?.codigo_posicion;
    };
    expect(buscar(1, "Exterior izquierda")).toBe("DEL_IZQ");
    expect(buscar(2, "Exterior derecha")).toBe("TRAS_DER");
  });

  it("un hueco sin lado no tiene señas", () => {
    expect(senasPosicion(1, "N/A", 2)).toBeNull();
  });
});

describe("esAdjuntoInforme", () => {
  // Un correo reenviado arrastra la firma del remitente, logos incrustados y
  // a veces el mismo informe en PDF. Coger el adjunto equivocado haría que la
  // importación fallara cada semana con un error que no dice nada.
  it("el informe del arco es un Excel", () => {
    expect(esAdjuntoInforme("Estado_general Informe general de la flota.xlsx")).toBe(true);
    expect(esAdjuntoInforme("informe.xlsm")).toBe(true);
    expect(esAdjuntoInforme("INFORME.XLSX")).toBe(true);
  });

  it("la firma, el logo y el PDF que acompaña no valen", () => {
    for (const n of ["image001.png", "logo.jpg", "informe.pdf", "firma.gif", "detalle.csv"]) {
      expect(esAdjuntoInforme(n)).toBe(false);
    }
  });

  it("sin nombre no se toma por el informe", () => {
    expect(esAdjuntoInforme(undefined)).toBe(false);
    expect(esAdjuntoInforme(null)).toBe(false);
    expect(esAdjuntoInforme("")).toBe(false);
  });

  it("no basta con que la extensión aparezca en medio del nombre", () => {
    expect(esAdjuntoInforme("informe.xlsx.exe")).toBe(false);
  });
});
