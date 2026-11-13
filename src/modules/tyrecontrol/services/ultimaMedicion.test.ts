import { describe, it, expect } from "vitest";
import {
  mapaUltimasMediciones, revisionesConTodasLasRuedas,
  type DetalleParaMedicion, type RevisionParaMedicion,
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

  it("una fila sin neumatico_id se atribuye al que hoy está en su posición", () => {
    const detalles: DetalleParaMedicion[] = [
      { revision_id: "r2", neumatico_id: null, posicion_id: "pos-1", profundidad_mm: 8.4, presion_bar: 7.5 },
    ];
    const mapa = mapaUltimasMediciones(REVS, detalles, new Map([["pos-1", "n-montado"]]));
    expect(mapa["n-montado"].profundidad_mm).toBe(8.4);
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
