import { describe, it, expect } from "vitest";
import {
  esPosteriorAlMontaje, mapaUltimasMediciones, revisionesConTodasLasRuedas,
  type DetalleParaMedicion, type MontajeEnPosicion, type RevisionParaMedicion,
} from "./ultimaMedicion";

/** Las revisiones vienen de la consulta ya ordenadas: la más reciente primero. */
const REVS: RevisionParaMedicion[] = [
  { id: "r3", fecha_revision: "2026-11-05", created_at: "2026-11-05T13:37:00Z" },
  { id: "r2", fecha_revision: "2026-10-30", created_at: "2026-10-31T07:00:00Z" },
  { id: "r1", fecha_revision: "2026-10-29", created_at: "2026-10-30T07:00:00Z" },
];

function det(revision: string, neumatico: string, prof: number | null, presion: number | null = null): DetalleParaMedicion {
  return { revision_id: revision, neumatico_id: neumatico, posicion_id: `p-${neumatico}`, profundidad_mm: prof, presion_bar: presion };
}

describe("revisionesConTodasLasRuedas", () => {
  it("la que mide todas sus ruedas cuenta", () => {
    const completas = revisionesConTodasLasRuedas([det("r1", "a", 9), det("r1", "b", 8)]);
    expect([...completas]).toEqual(["r1"]);
  });

  it("a la que le falta una, no", () => {
    const completas = revisionesConTodasLasRuedas([det("r1", "a", 9), det("r1", "b", null)]);
    expect(completas.size).toBe(0);
  });

  it("la que no trae ninguna profundidad, tampoco", () => {
    const completas = revisionesConTodasLasRuedas([det("r1", "a", null), det("r1", "b", null)]);
    expect(completas.size).toBe(0);
  });

  it("cada revisión se juzga sola", () => {
    const completas = revisionesConTodasLasRuedas([
      det("r1", "a", 9), det("r1", "b", 8),
      det("r2", "a", 7), det("r2", "b", null),
    ]);
    expect([...completas]).toEqual(["r1"]);
  });

  it("sin filas, ninguna completa", () => {
    expect(revisionesConTodasLasRuedas([]).size).toBe(0);
  });
});

describe("mapaUltimasMediciones · el caso del 4300GZD", () => {
  /*
   * La rueda E2_IZQ_INT medía 12,7 mm el 30/10 con las seis ruedas medidas, y
   * el 05/11 el arco —con lluvia— devolvió 1,9 mm midiendo solo ésa. En seis
   * días no se gastan 11 mm.
   */
  const detalles: DetalleParaMedicion[] = [
    // r3: parcial, solo una rueda con profundidad, las seis con presión
    det("r3", "n-int", 1.9, 7.9), det("r3", "n-ext", null, 7.7),
    // r2: completa
    det("r2", "n-int", 12.7, 8.0), det("r2", "n-ext", 12.1, 8.1),
    // r1: completa y más vieja
    det("r1", "n-int", 12.2, 8.0), det("r1", "n-ext", 12.0, 8.0),
  ];
  const mapa = mapaUltimasMediciones(REVS, detalles, new Map());

  it("la profundidad vuelve a la de la última revisión completa", () => {
    expect(mapa["n-int"].profundidad_mm).toBe(12.7);
    expect(mapa["n-ext"].profundidad_mm).toBe(12.1);
  });

  it("y con ella su fecha, la del 30/10 y no la del 05/11", () => {
    expect(mapa["n-int"].medido_en).toBe("2026-10-31T07:00:00Z");
  });

  it("la PRESIÓN sí sale de la parcial: con lluvia el arco la mide bien", () => {
    expect(mapa["n-int"].presion_bar).toBe(7.9);
    expect(mapa["n-ext"].presion_bar).toBe(7.7);
  });
});

describe("mapaUltimasMediciones", () => {
  it("sin ninguna revisión completa, la goma se queda sin profundidad", () => {
    const mapa = mapaUltimasMediciones(REVS, [det("r3", "n", 1.9, 7.9), det("r3", "m", null, 7.7)], new Map());
    expect(mapa["n"].profundidad_mm).toBeNull();
    expect(mapa["n"].medido_en).toBeNull();
    // Pero la presión que sí trae no se pierde.
    expect(mapa["n"].presion_bar).toBe(7.9);
  });

  it("manda la revisión más reciente de las completas, no la primera que aparezca", () => {
    const detalles = [det("r1", "n", 12.2), det("r2", "n", 12.7), det("r3", "n", 1.9), det("r3", "otro", null)];
    expect(mapaUltimasMediciones(REVS, detalles, new Map())["n"].profundidad_mm).toBe(12.7);
  });


  it("una fila sin neumático y sin posición no se puede atribuir: se descarta", () => {
    const mapa = mapaUltimasMediciones(REVS, [
      { revision_id: "r2", neumatico_id: null, posicion_id: null, profundidad_mm: 8.4, presion_bar: null },
    ], new Map());
    expect(Object.keys(mapa)).toEqual([]);
  });

  it("una fila de una revisión que no está en la lista no se cuela la primera", () => {
    const detalles = [det("rX", "n", 1.0), det("r2", "n", 12.7)];
    expect(mapaUltimasMediciones(REVS, detalles, new Map())["n"].profundidad_mm).toBe(12.7);
  });

  it("el cero es una medición: una goma lisa se dice", () => {
    const mapa = mapaUltimasMediciones(REVS, [det("r2", "n", 0, 8)], new Map());
    expect(mapa["n"].profundidad_mm).toBe(0);
  });

  it("sin revisiones, mapa vacío", () => {
    expect(mapaUltimasMediciones([], [], new Map())).toEqual({});
  });
});

describe("esPosteriorAlMontaje", () => {
  it("solo los días posteriores al del montaje", () => {
    expect(esPosteriorAlMontaje("2026-10-30", "2026-08-05")).toBe(true);
    expect(esPosteriorAlMontaje("2026-08-06", "2026-08-05")).toBe(true);
    expect(esPosteriorAlMontaje("2026-08-04", "2026-08-05")).toBe(false);
  });

  it("el mismo día NO: esa lectura suele ser de la goma que salía", () => {
    expect(esPosteriorAlMontaje("2026-08-17", "2026-08-17")).toBe(false);
  });

  it("compara días aunque una de las dos venga con hora", () => {
    expect(esPosteriorAlMontaje("2026-08-17T22:00:00Z", "2026-08-17")).toBe(false);
    expect(esPosteriorAlMontaje("2026-08-18T00:10:00Z", "2026-08-17")).toBe(true);
  });

  it("sin fecha de montaje no hay con qué acotar: se hereda, como siempre", () => {
    expect(esPosteriorAlMontaje("2026-08-17", null)).toBe(true);
  });

  it("sin fecha de la lectura no se puede saber: no se hereda", () => {
    expect(esPosteriorAlMontaje(null, "2026-08-17")).toBe(false);
  });
});

describe("mapaUltimasMediciones · las lecturas siguen a la posición", () => {
  const montajes = (fecha: string | null): Map<string, MontajeEnPosicion> =>
    new Map([["pos-1", { neumatico_id: "nueva", fecha_montaje: fecha }]]);
  /** La fila del arco, a nombre de la goma que la base creía montada. */
  const delArco = (rev: string, prof: number | null, presion: number | null = 8, neumatico: string | null = "vieja"): DetalleParaMedicion =>
    ({ revision_id: rev, neumatico_id: neumatico, posicion_id: "pos-1", profundidad_mm: prof, presion_bar: presion });

  it("el 4310JYJ: la goma dada de alta tarde hereda lo medido desde su montaje", () => {
    // Montada el 05/08, dada de alta en noviembre: las lecturas del 29 y 30/10
    // están a nombre de la anterior.
    const mapa = mapaUltimasMediciones(REVS.slice(1), [delArco("r2", 11.5), delArco("r1", 11.6)], montajes("2026-08-05"));
    expect(mapa["nueva"].profundidad_mm).toBe(11.5);
    expect(mapa["nueva"].presion_bar).toBe(8);
    // Y la anterior no pierde las suyas: son las mismas filas.
    expect(mapa["vieja"].profundidad_mm).toBe(11.5);
  });

  it("el 9232HMK: la lectura del MISMO día del montaje es de la goma que salía", () => {
    const mapa = mapaUltimasMediciones(REVS.slice(1), [delArco("r2", 3.9)], montajes("2026-10-30"));
    expect(mapa["nueva"]).toBeUndefined();
    expect(mapa["vieja"].profundidad_mm).toBe(3.9);
  });

  it("lo medido ANTES del montaje no es de esta goma", () => {
    const mapa = mapaUltimasMediciones(REVS.slice(1), [delArco("r2", 3.9), delArco("r1", 4.1)], montajes("2026-11-02"));
    expect(mapa["nueva"]).toBeUndefined();
  });

  it("solo hereda las posteriores, no la serie entera", () => {
    // r2 es del 30/10 y r1 del 29/10; montada el 29/10 → solo vale la del 30.
    const mapa = mapaUltimasMediciones(REVS.slice(1), [delArco("r1", 2.0), delArco("r2", 9.0)], montajes("2026-10-29"));
    expect(mapa["nueva"].profundidad_mm).toBe(9.0);
  });

  it("una fila sin neumático también sigue a la posición, con la misma regla", () => {
    const sinNombre = (rev: string, prof: number) => delArco(rev, prof, 7.5, null);
    expect(mapaUltimasMediciones(REVS.slice(1), [sinNombre("r2", 2.6)], montajes("2026-08-10"))["nueva"].profundidad_mm).toBe(2.6);
    // Antes se atribuía sin mirar la fecha: una lectura anterior al montaje
    // acababa siendo de una goma que todavía no estaba.
    expect(mapaUltimasMediciones(REVS.slice(1), [sinNombre("r2", 2.6)], montajes("2026-10-30"))["nueva"]).toBeUndefined();
  });

  it("manda la más reciente, sea propia o heredada", () => {
    // La goma tiene una lectura suya del 29/10 y la posición una más nueva,
    // del 30/10, sin nombre: gana la del 30.
    const detalles: DetalleParaMedicion[] = [
      { revision_id: "r1", neumatico_id: "nueva", posicion_id: "pos-1", profundidad_mm: 5.9, presion_bar: 8 },
      delArco("r2", 2.6, 7.5, null),
    ];
    expect(mapaUltimasMediciones(REVS.slice(1), detalles, montajes("2026-08-10"))["nueva"].profundidad_mm).toBe(2.6);
  });

  it("una revisión parcial tampoco vale heredada", () => {
    const detalles: DetalleParaMedicion[] = [
      delArco("r3", 1.9),
      { revision_id: "r3", neumatico_id: "otra", posicion_id: "pos-2", profundidad_mm: null, presion_bar: 8 },
      delArco("r2", 12.7),
    ];
    expect(mapaUltimasMediciones(REVS, detalles, montajes("2026-08-05"))["nueva"].profundidad_mm).toBe(12.7);
  });

  it("no se apunta dos veces la fila de la propia goma", () => {
    const detalles: DetalleParaMedicion[] = [
      { revision_id: "r2", neumatico_id: "nueva", posicion_id: "pos-1", profundidad_mm: 7, presion_bar: 8 },
    ];
    const mapa = mapaUltimasMediciones(REVS.slice(1), detalles, montajes("2026-08-05"));
    expect(Object.keys(mapa)).toEqual(["nueva"]);
  });

  it("la fecha que cuenta es la de la revisión, no la de su entrada en la base", () => {
    // El arco entra al día siguiente: revisión del 30/10, creada el 31/10. Con
    // el montaje el mismo 30/10 no se hereda, aunque el sello diga 31.
    const revs: RevisionParaMedicion[] = [{ id: "r2", fecha_revision: "2026-10-30", created_at: "2026-10-31T07:00:00Z" }];
    expect(mapaUltimasMediciones(revs, [delArco("r2", 3.9)], montajes("2026-10-30"))["nueva"]).toBeUndefined();
  });
});
