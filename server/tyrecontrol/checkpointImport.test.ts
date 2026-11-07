import { describe, expect, it } from "vitest";
import { leerExistentes, type RevisionExistente } from "./checkpointImport.ts";

/**
 * La comprobación de duplicados del CheckPoint.
 *
 * Esto existe por un fallo real en producción: la consulta que miraba qué
 * revisiones ya había pedía TODAS las de 200 vehículos de golpe, sin paginar
 * y sin acotar por fecha. PostgREST cortaba la respuesta en su tope, el mapa
 * llegaba incompleto, y el importador volvía a crear revisiones que ya
 * existían. Se acumularon **8.180 revisiones sobrantes**, con un vehículo
 * repetido 51 veces el mismo día.
 *
 * Lo que se fija aquí es lo que habría cazado aquello: que se recorren TODAS
 * las páginas, y que si no se puede llegar al final se LANZA en vez de
 * seguir con un mapa a medias. Una importación que falla se repite; una que
 * duplica en silencio no se nota hasta que alguien abre una ficha y ve
 * veinticinco revisiones iguales.
 */

const PAGINA = 500;

const fila = (p: Partial<RevisionExistente> & { id: string }): RevisionExistente => ({
  vehiculo_id: "v1", fecha_revision: "2026-10-09", medido_at: null, ...p,
});

/** Una base falsa que corta cada respuesta en `PAGINA` filas, como PostgREST. */
function base(filas: RevisionExistente[]) {
  const llamadas: Array<{ lote: number; desde: number }> = [];
  const consultar = async (lote: string[], _min: string, _max: string, desde: number, hasta: number) => {
    llamadas.push({ lote: lote.length, desde });
    const suyas = filas.filter((f) => lote.includes(f.vehiculo_id));
    return suyas.slice(desde, hasta + 1);
  };
  return { consultar, llamadas };
}

describe("leerExistentes", () => {
  it("una sola página: se lee y se para", async () => {
    const { consultar, llamadas } = base([fila({ id: "a" }), fila({ id: "b", fecha_revision: "2026-10-10" })]);
    const r = await leerExistentes(["v1"], "2026-10-09", "2026-10-10", consultar);
    expect(r.mapRev.size).toBe(2);
    expect(llamadas).toHaveLength(1);
  });

  it("más de una página: se recorren TODAS, que es el fallo que esto arregla", async () => {
    // 1.200 filas con páginas de 500: sin paginar se habrían visto 500 y las
    // otras 700 revisiones se habrían vuelto a crear.
    const filas = Array.from({ length: 1200 }, (_, i) =>
      fila({ id: `r${i}`, fecha_revision: `2026-10-${String((i % 28) + 1).padStart(2, "0")}` }));
    const { consultar, llamadas } = base(filas);
    const r = await leerExistentes(["v1"], "2026-10-01", "2026-10-28", consultar);
    expect(llamadas.map((l) => l.desde)).toEqual([0, 500, 1000]);
    // 28 fechas distintas para un vehículo: 28 claves.
    expect(r.mapRev.size).toBe(28);
  });

  it("una página exactamente llena pide la siguiente y no se queda corta", async () => {
    const filas = Array.from({ length: PAGINA }, (_, i) => fila({ id: `r${i}` }));
    const { consultar, llamadas } = base(filas);
    await leerExistentes(["v1"], "2026-10-09", "2026-10-09", consultar);
    expect(llamadas.map((l) => l.desde)).toEqual([0, 500]);
  });

  it("si no se llega al final, LANZA en vez de seguir con el mapa a medias", async () => {
    // Una base que siempre devuelve página llena: nunca termina.
    const consultar = async () => Array.from({ length: PAGINA }, (_, i) => fila({ id: `x${i}` }));
    await expect(leerExistentes(["v1"], "2026-01-01", "2026-12-31", consultar))
      .rejects.toThrow(/duplicados|crearía copias/i);
  });

  it("los vehículos van por lotes, no todos en una petición", async () => {
    const vehIds = Array.from({ length: 450 }, (_, i) => `v${i}`);
    const { consultar, llamadas } = base([]);
    await leerExistentes(vehIds, "2026-10-09", "2026-10-09", consultar);
    expect(llamadas.map((l) => l.lote)).toEqual([200, 200, 50]);
  });

  it("con duplicados ya en la base, la PRIMERA gana y no se añade otra", async () => {
    // Si ya hay tres copias del mismo día, se reutiliza una; el importador
    // no debe crear una cuarta.
    const { consultar } = base([
      fila({ id: "vieja" }), fila({ id: "copia1" }), fila({ id: "copia2" }),
    ]);
    const r = await leerExistentes(["v1"], "2026-10-09", "2026-10-09", consultar);
    expect(r.mapRev.size).toBe(1);
    expect(r.mapRev.get("v1|2026-10-09")).toBe("vieja");
  });

  it("se acota por fecha: el rango se le pasa a la consulta", async () => {
    let visto: { min: string; max: string } | null = null;
    const consultar = async (_l: string[], min: string, max: string) => {
      visto = { min, max }; return [];
    };
    await leerExistentes(["v1"], "2026-10-01", "2026-10-31", consultar);
    expect(visto).toEqual({ min: "2026-10-01", max: "2026-10-31" });
  });

  it("marca para corregir solo las de medianoche, no las de hora real", async () => {
    const { consultar } = base([
      fila({ id: "a", vehiculo_id: "v1", medido_at: "2026-10-09T00:00:00Z" }),
      fila({ id: "b", vehiculo_id: "v2", medido_at: "2026-10-09T13:31:00Z" }),
    ]);
    const r = await leerExistentes(["v1", "v2"], "2026-10-09", "2026-10-09", consultar);
    expect(r.aMedianoche).toEqual(["v1|2026-10-09"]);
  });

  it("sin vehículos no se consulta nada", async () => {
    const { consultar, llamadas } = base([fila({ id: "a" })]);
    const r = await leerExistentes([], "2026-10-09", "2026-10-09", consultar);
    expect(llamadas).toHaveLength(0);
    expect(r.mapRev.size).toBe(0);
  });
});
