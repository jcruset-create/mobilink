/**
 * Qué rueda es cada fila del parte de papel de Grupo Soledad.
 *
 * Es la parte del importador que puede equivocarse SIN DAR UN ERROR: si la
 * fila 3 se casa con el gemelo que no es, la profundidad entra en el histórico
 * del neumático equivocado y nadie lo nota nunca. Por eso los planos de estas
 * pruebas no están inventados: son los tres tipos de vehículo reales de
 * Empresa Plana, copiados de `tc_posiciones_vehiculo` en producción.
 */

import { describe, expect, it } from "vitest";

import {
  discrepanciaDeCroquis, ejesDelPlano, esIdem, filasConDatos,
  numeracionDelParteFlotas, pareceNota, resolverIdem,
  type FilaLeidaFlotas, type PosicionDelParte,
} from "./parteFlotas";

const p = (
  codigo_posicion: string, eje: number, lado: string, interior_exterior: string | null = null,
): PosicionDelParte => ({ id: codigo_posicion, codigo_posicion, eje, lado, interior_exterior });

/** `autobus`: 586 vehículos de Plana. Croquis C2-4. */
const AUTOBUS: PosicionDelParte[] = [
  p("E1_IZQ", 1, "izq"), p("E1_DER", 1, "der"),
  p("E2_IZQ_EXT", 2, "izq", "ext"), p("E2_IZQ_INT", 2, "izq", "int"),
  p("E2_DER_INT", 2, "der", "int"), p("E2_DER_EXT", 2, "der", "ext"),
];

/** `autocar`: 106 vehículos. Tercer eje simple. Croquis C2-4-2. */
const AUTOCAR: PosicionDelParte[] = [
  ...AUTOBUS,
  p("E3_IZQ", 3, "izq"), p("E3_DER", 3, "der"),
];

/** `furgoneta` y `turismo`: 32 vehículos. Croquis R2-2. */
const FURGONETA: PosicionDelParte[] = [
  p("E1_IZQ", 1, "izq"), p("E1_DER", 1, "der"),
  p("E2_IZQ", 2, "izq"), p("E2_DER", 2, "der"),
];

const comoLista = (m: Map<number, PosicionDelParte> | null) =>
  m == null ? null : [...m.keys()].sort((a, b) => a - b).map((k) => m.get(k)!.codigo_posicion);

describe("la numeración del papel, en los planos reales de Plana", () => {
  it("un autobús: el eje directriz y luego los cuatro gemelos", () => {
    // Confirmado por quien rellena el papel: el par 3-4 es el izquierdo, con
    // 3 interior y 4 exterior; el 5-6 el derecho, igual.
    expect(comoLista(numeracionDelParteFlotas(AUTOBUS))).toEqual([
      "E1_IZQ", "E1_DER", "E2_IZQ_INT", "E2_IZQ_EXT", "E2_DER_INT", "E2_DER_EXT",
    ]);
  });

  it("un autocar: el tercer eje es 7 y 8, CONSECUTIVO", () => {
    // El otro impreso, el de Comercial Sea, numeraría esas dos como 7 y 10
    // porque reserva cuatro huecos por eje trasero. Éste no: su croquis está
    // impreso «1 2 / 3 4 5 6 / 7 8» y la tabla solo tiene ocho filas.
    expect(comoLista(numeracionDelParteFlotas(AUTOCAR))).toEqual([
      "E1_IZQ", "E1_DER", "E2_IZQ_INT", "E2_IZQ_EXT", "E2_DER_INT", "E2_DER_EXT",
      "E3_IZQ", "E3_DER",
    ]);
  });

  it("una furgoneta: cuatro ruedas simples", () => {
    expect(comoLista(numeracionDelParteFlotas(FURGONETA)))
      .toEqual(["E1_IZQ", "E1_DER", "E2_IZQ", "E2_DER"]);
  });

  it("el par IZQUIERDO va cruzado respecto al orden_visual de Mobilink", () => {
    // Ésta es la prueba que justifica que exista este módulo. En la base,
    // E2_IZQ_EXT tiene orden_visual 3 y E2_IZQ_INT el 4, porque ese orden es
    // geométrico. En el papel es al revés. Usar orden_visual —lo que uno hace
    // sin mirar— habría intercambiado las profundidades de los dos gemelos
    // izquierdos en los 586 autobuses.
    const m = numeracionDelParteFlotas(AUTOBUS)!;
    expect(m.get(3)!.codigo_posicion).toBe("E2_IZQ_INT");
    expect(m.get(4)!.codigo_posicion).toBe("E2_IZQ_EXT");
    // Y en el derecho SÍ coinciden, que es lo que hace el fallo tan difícil
    // de ver: la mitad de la hoja saldría bien.
    expect(m.get(5)!.codigo_posicion).toBe("E2_DER_INT");
    expect(m.get(6)!.codigo_posicion).toBe("E2_DER_EXT");
  });

  it("el orden de entrada da igual", () => {
    // Las posiciones llegan como las devuelva la consulta, no ordenadas.
    const revuelto = [...AUTOCAR].reverse();
    expect(comoLista(numeracionDelParteFlotas(revuelto)))
      .toEqual(comoLista(numeracionDelParteFlotas(AUTOCAR)));
  });
});

describe("cuándo se dice que NO se sabe numerar", () => {
  it("sin plano", () => {
    expect(numeracionDelParteFlotas([])).toBeNull();
  });

  it("sin número de eje", () => {
    expect(numeracionDelParteFlotas([p("X", 0, "izq"), { id: "y", codigo_posicion: "Y", lado: "der" }]))
      .toBeNull();
  });

  it("sin lado: no se puede saber si es la 3 o la 5", () => {
    expect(numeracionDelParteFlotas([p("A", 1, ""), p("B", 1, "der")])).toBeNull();
  });

  it("un eje con los gemelos a medias", () => {
    // Un plano a medio rellenar. Adivinar cuál de las dos es la interior
    // sería inventarse el dato que más caro sale equivocar.
    expect(numeracionDelParteFlotas([
      p("E1_IZQ", 1, "izq"), p("E1_DER", 1, "der"),
      p("E2_IZQ_EXT", 2, "izq", "ext"), p("E2_IZQ_INT", 2, "izq", "int"),
      p("E2_DER", 2, "der"), p("E2_DER_2", 2, "der"),
    ])).toBeNull();
  });

  it("un eje de tres ruedas", () => {
    expect(numeracionDelParteFlotas([
      p("E1_IZQ", 1, "izq"), p("E1_DER", 1, "der"), p("E1_X", 1, "der"),
    ])).toBeNull();
  });

  it("más ruedas que filas tiene el impreso", () => {
    // El `autocar_2x4x4` de Plana tiene diez posiciones y el papel ocho filas.
    // Son 4 vehículos, pero su hoja no se puede pasar por aquí.
    const diez: PosicionDelParte[] = [
      ...AUTOBUS,
      p("E3_IZQ_EXT", 3, "izq", "ext"), p("E3_IZQ_INT", 3, "izq", "int"),
      p("E3_DER_INT", 3, "der", "int"), p("E3_DER_EXT", 3, "der", "ext"),
    ];
    expect(diez).toHaveLength(10);
    expect(numeracionDelParteFlotas(diez)).toBeNull();
  });
});

describe("contrastar con la casilla marcada a mano", () => {
  it("saca del plano los ejes que debería traer marcados", () => {
    expect(ejesDelPlano(AUTOBUS)).toBe("2-4");
    expect(ejesDelPlano(AUTOCAR)).toBe("2-4-2");
    expect(ejesDelPlano(FURGONETA)).toBe("2-2");
  });

  it("cuando cuadra, no dice nada", () => {
    expect(discrepanciaDeCroquis(AUTOBUS, "C2-4")).toBeNull();
    expect(discrepanciaDeCroquis(AUTOCAR, "C2-4-2")).toBeNull();
    // La familia C o R no se compara: del plano no se deduce si lleva
    // recambio dibujado.
    expect(discrepanciaDeCroquis(FURGONETA, "R2-2")).toBeNull();
    expect(discrepanciaDeCroquis(FURGONETA, "C2-2")).toBeNull();
  });

  it("cuando no cuadra, avisa de que la hoja puede ser de otro camión", () => {
    const aviso = discrepanciaDeCroquis(AUTOBUS, "C2-4-2");
    expect(aviso).toContain("C2-4-2");
    expect(aviso).toContain("2+4");
  });

  it("sin marca legible no se inventa un aviso", () => {
    // En 8 de los 14 partes la X está fuera de su recuadro. Que el modelo no
    // sepa cuál es no puede frenar la hoja: manda el plano del vehículo.
    expect(discrepanciaDeCroquis(AUTOBUS, null)).toBeNull();
    expect(discrepanciaDeCroquis(AUTOBUS, "")).toBeNull();
    expect(discrepanciaDeCroquis(AUTOBUS, "   ")).toBeNull();
  });

  it("de un plano que no se sabe numerar tampoco se saca croquis", () => {
    expect(ejesDelPlano([])).toBeNull();
    expect(discrepanciaDeCroquis([], "C2-4")).toBeNull();
  });
});

describe("las comillas de «ídem»", () => {
  const fila = (o: Partial<FilaLeidaFlotas> = {}): FilaLeidaFlotas => ({
    pos: null, medida: null, marca: null, modelo: null,
    numero_serie: null, fecha_dot: null, profundidad_mm: null, ...o,
  });

  it("reconoce las formas en que las lee un modelo", () => {
    // La comilla manuscrita sale como comilla o como una minúscula suelta,
    // según la letra y el escaneo.
    for (const c of ['"', "''", ",,", "“", "”", "u", "n", "v", "id.", "idem", "ídem"]) {
      expect(esIdem(c)).toBe(true);
    }
  });

  it("y no confunde un dato con una comilla", () => {
    // `AH51`, `9` o `X-Multi` son valores reales de la muestra.
    for (const c of ["AH51", "9", "X-Multi", "295/80 R22.5", "KMAX-S", "", null]) {
      expect(esIdem(c)).toBe(false);
    }
  });

  it("ante la duda, NO es comilla", () => {
    // Un `4` puede ser una comilla mal leída, y `XL` un modelo de verdad.
    // Tratarlos como comilla copiaría la fila de arriba sin que se note;
    // dejarlos deja una casilla visiblemente rara, que alguien corrige.
    // La red se queda corta a propósito: los errores que se ven son mejores.
    for (const c of ["4", "XL", "N", "R"]) {
      expect(esIdem(c)).toBe(false);
    }
  });

  it("rellena hacia abajo medida, marca y modelo", () => {
    // La hoja de la unidad 1727 tal cual: la primera fila completa y las
    // siguientes con comillas.
    const r = resolverIdem([
      fila({ pos: 1, medida: "295/80 R22.5", marca: "Hankook", modelo: "AH51", profundidad_mm: 15 }),
      fila({ pos: 2, medida: '"', marca: '"', modelo: '"', profundidad_mm: 15 }),
      fila({ pos: 3, medida: "u", marca: "Michelin", modelo: "Conch", profundidad_mm: 9 }),
      fila({ pos: 4, medida: "u", marca: '"', modelo: '"', profundidad_mm: 9 }),
    ]);
    expect(r.map((f) => f.medida)).toEqual(Array(4).fill("295/80 R22.5"));
    expect(r.map((f) => f.marca)).toEqual(["Hankook", "Hankook", "Michelin", "Michelin"]);
    expect(r.map((f) => f.modelo)).toEqual(["AH51", "AH51", "Conch", "Conch"]);
  });

  it("una comilla en la PRIMERA fila no hereda nada", () => {
    // No hay de dónde copiar. Poner algo sería inventarlo.
    const r = resolverIdem([fila({ pos: 1, marca: '"', profundidad_mm: 11 })]);
    expect(r[0].marca).toBeNull();
  });

  it("NO hereda la profundidad ni el número de serie", () => {
    // Dos ruedas no comparten serie, y heredar una profundidad daría una
    // medición que nadie ha tomado.
    const r = resolverIdem([
      fila({ pos: 1, marca: "Hankook", profundidad_mm: 15, numero_serie: "ABC123" }),
      fila({ pos: 2, marca: '"', profundidad_mm: null, numero_serie: null }),
    ]);
    expect(r[1].profundidad_mm).toBeNull();
    expect(r[1].numero_serie).toBeNull();
  });

  it("la última fila repite la medida entera y eso no estorba", () => {
    // Pasa en casi todos los partes: la fila 8 vuelve a escribir la medida.
    const r = resolverIdem([
      fila({ pos: 7, medida: "315/80 R22.5", marca: "Bridgestone", profundidad_mm: 13 }),
      fila({ pos: 8, medida: "315/80 R22.5", marca: '"', profundidad_mm: 14 }),
    ]);
    expect(r[1].medida).toBe("315/80 R22.5");
    expect(r[1].marca).toBe("Bridgestone");
  });

  it("una medida DISTINTA a media hoja se respeta y arrastra", () => {
    // La unidad 1717 cambia de medida en la fila 8.
    const r = resolverIdem([
      fila({ pos: 1, medida: "315/80 R22.5", profundidad_mm: 16 }),
      fila({ pos: 2, medida: '"', profundidad_mm: 16 }),
      fila({ pos: 3, medida: "295/80 R22.5", profundidad_mm: 10 }),
      fila({ pos: 4, medida: '"', profundidad_mm: 11 }),
    ]);
    expect(r.map((f) => f.medida)).toEqual([
      "315/80 R22.5", "315/80 R22.5", "295/80 R22.5", "295/80 R22.5",
    ]);
  });
});

describe("qué filas cuentan", () => {
  const fila = (o: Partial<FilaLeidaFlotas> = {}): FilaLeidaFlotas => ({
    pos: null, medida: null, marca: null, modelo: null,
    numero_serie: null, fecha_dot: null, profundidad_mm: null, ...o,
  });

  it("las ocho filas del impreso casi nunca van llenas", () => {
    // La unidad 1727: seis ruedas, dos filas vacías. Una fila vacía no es
    // una rueda sin medir, es una fila que ese vehículo no tiene.
    const hoja = [
      ...[15, 15, 9, 9, 9, 9].map((mm, i) => fila({ pos: i + 1, marca: i ? '"' : "Hankook", profundidad_mm: mm })),
      fila({ pos: 7 }), fila({ pos: 8 }),
    ];
    expect(filasConDatos(hoja)).toHaveLength(6);
  });

  it("una goma identificada sin medir cuenta", () => {
    // Sigue siendo una goma que el sistema no tenía.
    expect(filasConDatos([fila({ pos: 1, marca: "Hankook", modelo: "AH51" })])).toHaveLength(1);
  });

  it("una profundidad sin identificación también", () => {
    expect(filasConDatos([fila({ pos: 1, profundidad_mm: 9 })])).toHaveLength(1);
  });

  it("y devuelve las comillas ya resueltas", () => {
    const r = filasConDatos([
      fila({ pos: 1, marca: "Michelin", profundidad_mm: 12 }),
      fila({ pos: 2, marca: '"', profundidad_mm: 12 }),
    ]);
    expect(r[1].marca).toBe("Michelin");
  });
});

describe("la columna del número de serie se usa como margen", () => {
  it("reconoce una nota escrita donde va el serie", () => {
    // Literal de la unidad 2018: «Cambio y alinear». Guardar eso como número
    // de serie dejaría una goma buscada para siempre por una frase.
    expect(pareceNota("Cambio y alinear")).toBe(true);
    expect(pareceNota("CAMBIO Y ALINEAR")).toBe(true);
  });

  it("y no toma por nota un serie de verdad", () => {
    expect(pareceNota("ABC123456")).toBe(false);
    expect(pareceNota("1234-5678")).toBe(false);
    expect(pareceNota("")).toBe(false);
    expect(pareceNota(null)).toBe(false);
  });
});
